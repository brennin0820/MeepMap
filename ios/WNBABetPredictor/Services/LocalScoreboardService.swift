import Foundation

actor LocalScoreboardService {
    static let shared = LocalScoreboardService()

    private static let espnBase = "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba"
    private static let coreBase = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/wnba/seasons/2026/types/2"
    private static let userAgent = "WNBA-Bet-Predictor/1.5"

    private static let abbrToKey: [String: String] = [
        "ATL": "atl", "CHI": "chi", "CON": "con", "DAL": "dal", "IND": "ind",
        "LV": "las", "LVA": "las", "LAS": "las", "MIN": "min", "NY": "ny",
        "NYL": "ny", "PHX": "phx", "PHO": "phx", "SEA": "sea", "WAS": "was",
        "WSH": "was", "GS": "gs", "GSV": "gs", "TOR": "tor"
    ]

    private let session: URLSession
    private let dataService = LocalDataService.shared
    private var scoreboardCache: (payload: ScoreboardResponse, fetchedAt: Date, dateKey: String)?
    private var teamStatsCache: [String: (payload: TeamStatsDetailPayload, fetchedAt: Date)] = [:]
    private var playersCache: [String: (payload: TeamPlayersPayload, fetchedAt: Date)] = [:]
    private let cacheTTL: TimeInterval = 5 * 60

    init(session: URLSession = .shared) {
        self.session = session
    }

    func getScoreboard(date: String? = nil) async -> ScoreboardResponse {
        let dateKey = date ?? todayDateString()
        if let cached = scoreboardCache,
           cached.dateKey == dateKey,
           Date().timeIntervalSince(cached.fetchedAt) < cacheTTL {
            return cached.payload
        }

        do {
            let payload = try await fetchScoreboardFromESPN(dateStr: dateKey)
            scoreboardCache = (payload, Date(), dateKey)
            return payload
        } catch {
            let schedule = await dataService.getScheduleForDate(dateKey)
            let games = schedule.events.map { mapScheduleEvent($0) }
            let payload = ScoreboardResponse(
                games: games,
                source: schedule.source ?? "fallback",
                lastUpdated: schedule.lastUpdated,
                isLive: schedule.isLive,
                warning: schedule.warning ?? "ESPN scoreboard unavailable (\(error.localizedDescription))."
            )
            scoreboardCache = (payload, Date(), dateKey)
            return payload
        }
    }

    func getTeamStats(teamKey: String) async -> TeamStatsDetailPayload {
        let key = teamKey.lowercased()
        if let cached = teamStatsCache[key], Date().timeIntervalSince(cached.fetchedAt) < cacheTTL {
            return cached.payload
        }

        let teamsPayload = await dataService.getTeams()
        guard let team = teamsPayload.teams.first(where: { $0.key == key }) else {
            return TeamStatsDetailPayload(
                teamKey: key,
                error: "Unknown team key: \(key)"
            )
        }

        var stats = teamSeasonStats(from: team)
        var warning = teamsPayload.warning
        var source = teamsPayload.source ?? "espn"
        var isLive = teamsPayload.isLive

        if let espnId = team.espnId {
            do {
                let detailed = try await fetchTeamStatistics(espnId: espnId)
                stats = mergeTeamStats(base: stats, detailed: detailed)
                source = "espn"
                isLive = true
            } catch {
                warning = warning ?? "Detailed team stats unavailable (\(error.localizedDescription))."
            }
        }

        let teamRef = ScoreboardTeamRef(
            key: team.key,
            name: team.name,
            abbreviation: team.abbreviation,
            record: team.record
        )
        let payload = TeamStatsDetailPayload(
            teamKey: key,
            teamName: team.name,
            record: team.record,
            abbreviation: team.abbreviation,
            stats: stats,
            team: teamRef,
            source: source,
            lastUpdated: ISO8601DateFormatter().string(from: Date()),
            isLive: isLive,
            warning: warning
        )
        teamStatsCache[key] = (payload, Date())
        return payload
    }

    func getTeamPlayers(teamKey: String) async -> TeamPlayersPayload {
        let key = teamKey.lowercased()
        if let cached = playersCache[key], Date().timeIntervalSince(cached.fetchedAt) < cacheTTL {
            return cached.payload
        }

        let teamsPayload = await dataService.getTeams()
        guard let team = teamsPayload.teams.first(where: { $0.key == key }),
              let espnId = team.espnId else {
            return TeamPlayersPayload(
                teamKey: key,
                players: [],
                source: "local",
                warning: "Could not resolve ESPN team id for \(key)."
            )
        }

        do {
            let roster = try await fetchRoster(espnId: espnId)
            var players: [PlayerSeasonStats] = []
            await withTaskGroup(of: PlayerSeasonStats?.self) { group in
                for athlete in roster.prefix(18) {
                    group.addTask { [self] in
                        await self.fetchPlayerStats(athlete: athlete)
                    }
                }
                for await result in group {
                    if let player = result {
                        players.append(player)
                    }
                }
            }
            players.sort { ($0.ppg ?? 0) > ($1.ppg ?? 0) }

            let payload = TeamPlayersPayload(
                teamKey: key,
                players: players,
                source: "espn",
                lastUpdated: ISO8601DateFormatter().string(from: Date()),
                isLive: true,
                warning: players.isEmpty ? "No player season stats returned from ESPN." : nil
            )
            playersCache[key] = (payload, Date())
            return payload
        } catch {
            return TeamPlayersPayload(
                teamKey: key,
                players: [],
                source: "espn",
                warning: "ESPN roster/stats unavailable (\(error.localizedDescription))."
            )
        }
    }

    // MARK: - ESPN scoreboard

    private func fetchScoreboardFromESPN(dateStr: String) async throws -> ScoreboardResponse {
        let compact = dateStr.replacingOccurrences(of: "-", with: "")
        let data = try await fetchJSON(url: "\(Self.espnBase)/scoreboard?dates=\(compact)")
        let eventsRaw = data["events"] as? [[String: Any]] ?? []
        let games = eventsRaw.compactMap { parseScoreboardGame($0) }

        return ScoreboardResponse(
            games: games,
            source: "espn",
            lastUpdated: ISO8601DateFormatter().string(from: Date()),
            isLive: true,
            warning: games.isEmpty ? "No games on scoreboard for \(dateStr)." : nil
        )
    }

    private func parseScoreboardGame(_ event: [String: Any]) -> ScoreboardGame? {
        guard let id = event["id"].map({ String(describing: $0) }) else { return nil }
        let comp = (event["competitions"] as? [[String: Any]])?.first
        let competitors = comp?["competitors"] as? [[String: Any]] ?? []
        let home = competitors.first { ($0["homeAway"] as? String) == "home" }
        let away = competitors.first { ($0["homeAway"] as? String) == "away" }
        let statusBlock = (comp?["status"] as? [String: Any]) ?? (event["status"] as? [String: Any])
        let statusType = statusBlock?["type"] as? [String: Any]

        let homeTeamDict = home?["team"] as? [String: Any]
        let awayTeamDict = away?["team"] as? [String: Any]
        let homeTeam = homeTeamDict.map { normalizeTeamRef($0) }
        let awayTeam = awayTeamDict.map { normalizeTeamRef($0) }

        return ScoreboardGame(
            id: id,
            date: event["date"] as? String,
            name: event["name"] as? String,
            status: statusType?["description"] as? String ?? statusType?["shortDetail"] as? String,
            statusState: statusType?["state"] as? String ?? "pre",
            period: statusBlock?["period"] as? Int,
            clock: statusBlock?["displayClock"] as? String,
            homeTeam: homeTeam,
            awayTeam: awayTeam,
            homeKey: homeTeam?.key,
            awayKey: awayTeam?.key,
            homeScore: home?["score"].flatMap { Int(String(describing: $0)) } ?? 0,
            awayScore: away?["score"].flatMap { Int(String(describing: $0)) } ?? 0,
            venue: (comp?["venue"] as? [String: Any])?["fullName"] as? String,
            odds: comp.flatMap(ESPNOddsParser.parse(from:))
        )
    }

    private func mapScheduleEvent(_ event: LocalScheduleEvent) -> ScoreboardGame {
        ScoreboardGame(
            id: event.id,
            date: event.date,
            name: event.name,
            status: event.status,
            statusState: event.statusState ?? "pre",
            period: nil,
            clock: nil,
            homeTeam: event.homeTeam.map { ScoreboardTeamRef(key: $0.key, name: $0.name, abbreviation: nil, record: nil) },
            awayTeam: event.awayTeam.map { ScoreboardTeamRef(key: $0.key, name: $0.name, abbreviation: nil, record: nil) },
            homeKey: event.homeTeam?.key,
            awayKey: event.awayTeam?.key,
            homeScore: event.homeScore,
            awayScore: event.awayScore,
            venue: event.venue,
            odds: event.odds
        )
    }

    // MARK: - Team statistics

    private func fetchTeamStatistics(espnId: String) async throws -> TeamSeasonStats {
        let data = try await fetchJSON(url: "\(Self.espnBase)/teams/\(espnId)/statistics")
        let categories = ((data["results"] as? [String: Any])?["stats"] as? [String: Any])?["categories"] as? [[String: Any]] ?? []
        var flat: [String: Double] = [:]
        var gamesPlayed: Int?

        for category in categories {
            for stat in category["stats"] as? [[String: Any]] ?? [] {
                guard let name = stat["name"] as? String else { continue }
                if let value = doubleValue(stat["value"]) {
                    flat[name] = value
                }
                if name == "gamesPlayed", let gp = stat["value"] as? Int {
                    gamesPlayed = gp
                } else if name == "gamesPlayed", let gp = doubleValue(stat["value"]) {
                    gamesPlayed = Int(gp)
                }
            }
        }

        return TeamSeasonStats(
            ppg: flat["avgPoints"],
            oppPpg: nil,
            fgPct: flat["fieldGoalPct"],
            fg3Pct: flat["threePointPct"],
            ftPct: flat["freeThrowPct"],
            rebounds: flat["avgRebounds"],
            assists: flat["avgAssists"],
            turnovers: flat["avgTurnovers"],
            netRating: nil,
            pace: nil,
            gamesPlayed: gamesPlayed
        )
    }

    private func teamSeasonStats(from team: LocalTeam) -> TeamSeasonStats {
        TeamSeasonStats(
            ppg: team.ppg,
            oppPpg: team.oppPpg,
            fgPct: nil,
            fg3Pct: nil,
            ftPct: nil,
            rebounds: nil,
            assists: nil,
            turnovers: nil,
            netRating: team.netRating ?? team.avgMargin,
            pace: team.pace,
            gamesPlayed: nil
        )
    }

    private func mergeTeamStats(base: TeamSeasonStats, detailed: TeamSeasonStats) -> TeamSeasonStats {
        TeamSeasonStats(
            ppg: detailed.ppg ?? base.ppg,
            oppPpg: base.oppPpg,
            fgPct: detailed.fgPct,
            fg3Pct: detailed.fg3Pct,
            ftPct: detailed.ftPct,
            rebounds: detailed.rebounds,
            assists: detailed.assists,
            turnovers: detailed.turnovers,
            netRating: base.netRating,
            pace: base.pace,
            gamesPlayed: detailed.gamesPlayed
        )
    }

    // MARK: - Player statistics

    private struct RosterAthlete: Sendable {
        let id: String
        let name: String
        let position: String?
        let jersey: String?
    }

    private func fetchRoster(espnId: String) async throws -> [RosterAthlete] {
        let data = try await fetchJSON(url: "\(Self.espnBase)/teams/\(espnId)/roster")
        return (data["athletes"] as? [[String: Any]] ?? []).compactMap { athlete in
            guard let id = athlete["id"].map({ String(describing: $0) }) else { return nil }
            let position = (athlete["position"] as? [String: Any])?["abbreviation"] as? String
            return RosterAthlete(
                id: id,
                name: (athlete["displayName"] as? String) ?? (athlete["fullName"] as? String) ?? "Unknown",
                position: position,
                jersey: athlete["jersey"].map { String(describing: $0) }
            )
        }
    }

    private func fetchPlayerStats(athlete: RosterAthlete) async -> PlayerSeasonStats? {
        do {
            let data = try await fetchJSON(url: "\(Self.coreBase)/athletes/\(athlete.id)/statistics")
            let categories = (data["splits"] as? [String: Any])?["categories"] as? [[String: Any]] ?? []
            var flat: [String: Double] = [:]
            for category in categories {
                for stat in category["stats"] as? [[String: Any]] ?? [] {
                    guard let name = stat["name"] as? String,
                          let value = doubleValue(stat["value"]) else { continue }
                    flat[name] = value
                }
            }

            let gamesPlayed = flat["gamesPlayed"] ?? 0
            let mpg = flat["avgMinutes"] ?? 0
            let ppg = flat["avgPoints"] ?? 0
            guard gamesPlayed > 0 || mpg > 0 || ppg > 0 else { return nil }

            return PlayerSeasonStats(
                id: athlete.id,
                name: athlete.name,
                position: athlete.position,
                jersey: athlete.jersey,
                mpg: mpg > 0 ? mpg : nil,
                ppg: ppg > 0 ? ppg : nil,
                rpg: flat["avgRebounds"],
                apg: flat["avgAssists"],
                fgPct: flat["fieldGoalPct"]
            )
        } catch {
            return nil
        }
    }

    // MARK: - Parsing helpers

    private func normalizeTeamRef(_ team: [String: Any]) -> ScoreboardTeamRef {
        let abbr = (team["abbreviation"] as? String) ?? (team["shortDisplayName"] as? String) ?? ""
        let key = Self.abbrToKey[abbr.uppercased()] ?? abbr.lowercased()
        let recordSummary = ((team["record"] as? [String: Any])?["items"] as? [[String: Any]])?.first?["summary"] as? String
            ?? (team["record"] as? [String: Any])?["summary"] as? String

        return ScoreboardTeamRef(
            key: key,
            name: (team["displayName"] as? String) ?? (team["name"] as? String),
            abbreviation: abbr,
            record: recordSummary
        )
    }

    private func fetchJSON(url: String) async throws -> [String: Any] {
        guard let requestURL = URL(string: url) else { throw LocalDataError.invalidURL }
        var request = URLRequest(url: requestURL)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")
        request.timeoutInterval = 25

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw LocalDataError.httpFailed
        }
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw LocalDataError.parseFailed
        }
        return json
    }

    private func doubleValue(_ value: Any?) -> Double? {
        guard let value else { return nil }
        if let d = value as? Double { return d }
        if let i = value as? Int { return Double(i) }
        if let s = value as? String, let d = Double(s) { return d }
        return nil
    }

    private func todayDateString() -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        return String(formatter.string(from: Date()).prefix(10))
    }
}
