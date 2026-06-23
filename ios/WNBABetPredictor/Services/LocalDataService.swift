import Foundation

struct LocalTeam: Codable, Sendable, Hashable {
    var key: String
    var espnId: String?
    var name: String
    var abbreviation: String?
    var record: String?
    var wins: Int?
    var losses: Int?
    var homeRecord: String?
    var awayRecord: String?
    var last5: String?
    var last10: String?
    var ppg: Double?
    var oppPpg: Double?
    var avgMargin: Double?
    var offRating: Double?
    var defRating: Double?
    var netRating: Double?
    var pace: Double?
}

struct LocalScheduleEvent: Codable, Sendable, Hashable {
    var id: String
    var date: String
    var name: String?
    var status: String?
    var statusState: String?
    var homeTeam: LocalTeamRef?
    var awayTeam: LocalTeamRef?
    var homeScore: Int?
    var awayScore: Int?
    var venue: String?
    var odds: MarketOdds?
}

struct LocalTeamRef: Codable, Sendable, Hashable {
    var key: String?
    var name: String?
}

struct TeamsPayload: Codable, Sendable {
    var teams: [LocalTeam]
    var source: String?
    var lastUpdated: String?
    var isLive: Bool?
    var warning: String?
}

struct SchedulePayload: Codable, Sendable {
    var events: [LocalScheduleEvent]
    var source: String?
    var lastUpdated: String?
    var isLive: Bool?
    var warning: String?
}

struct InjuriesPayload: Codable, Sendable {
    var injuries: [InjuryEntry]
    var source: String?
    var lastUpdated: String?
    var isLive: Bool?
    var warning: String?
}

actor LocalDataService {
    static let shared = LocalDataService()

    private static let espnBase = "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba"
    private static let wnbaStatsBase = "https://stats.wnba.com/stats"
    private static let currentSeason = "2026"
    private static let userAgent = "WNBA-Bet-Predictor/1.5"

    private static let abbrToKey: [String: String] = [
        "ATL": "atl", "CHI": "chi", "CON": "con", "DAL": "dal", "IND": "ind",
        "LV": "las", "LVA": "las", "LAS": "las", "MIN": "min", "NY": "ny",
        "NYL": "ny", "PHX": "phx", "PHO": "phx", "SEA": "sea", "WAS": "was",
        "WSH": "was", "GS": "gs", "GSV": "gs", "TOR": "tor"
    ]

    private let session: URLSession
    private var teamsCache: (payload: TeamsPayload, fetchedAt: Date)?
    private var injuriesCache: (payload: InjuriesPayload, fetchedAt: Date)?
    private var scheduleCache: [String: (payload: SchedulePayload, fetchedAt: Date)] = [:]
    private let cacheTTL: TimeInterval = 15 * 60

    init(session: URLSession = .shared) {
        self.session = session
    }

    func getTeams() async -> TeamsPayload {
        if let cached = teamsCache, Date().timeIntervalSince(cached.fetchedAt) < cacheTTL {
            return cached.payload
        }
        do {
            let payload = try await fetchTeamsFromESPN()
            let enriched = await enrichTeamsFromLiveStats(payload)
            teamsCache = (enriched, Date())
            return enriched
        } catch {
            var fallback = loadBundleTeams()
            fallback.warning = "ESPN teams unavailable (\(error.localizedDescription)). Using bundled fallback."
            fallback.isLive = false
            teamsCache = (fallback, Date())
            return fallback
        }
    }

    func getInjuries() async -> InjuriesPayload {
        if let cached = injuriesCache, Date().timeIntervalSince(cached.fetchedAt) < cacheTTL {
            return cached.payload
        }
        do {
            let payload = try await fetchInjuriesFromESPN()
            injuriesCache = (payload, Date())
            return payload
        } catch {
            var fallback = loadBundleInjuries()
            fallback.warning = "ESPN injuries unavailable (\(error.localizedDescription)). Using bundled fallback."
            fallback.isLive = false
            injuriesCache = (fallback, Date())
            return fallback
        }
    }

    func getScheduleRange(days: Int = 7) async -> SchedulePayload {
        await getSchedule(for: dateRange(days: days))
    }

    func getScheduleWindow(daysBack: Int = 14, daysForward: Int = 0) async -> SchedulePayload {
        let startOffset = -max(0, daysBack)
        let count = max(1, max(0, daysBack) + max(0, daysForward) + 1)
        return await getSchedule(for: dateRange(startOffset: startOffset, days: count))
    }

    private func getSchedule(for dates: [String]) async -> SchedulePayload {
        var allEvents: [LocalScheduleEvent] = []
        var source = "espn"
        var warning: String?
        var isLive = true

        for dateStr in dates {
            let day = await getScheduleForDate(dateStr)
            allEvents.append(contentsOf: day.events)
            if day.source != "espn" { source = day.source ?? source }
            if let w = day.warning { warning = w }
            if day.isLive == false { isLive = false }
        }

        return SchedulePayload(
            events: allEvents,
            source: source,
            lastUpdated: ISO8601DateFormatter().string(from: Date()),
            isLive: isLive,
            warning: warning
        )
    }

    func getScheduleForDate(_ dateStr: String) async -> SchedulePayload {
        if let cached = scheduleCache[dateStr], Date().timeIntervalSince(cached.fetchedAt) < cacheTTL {
            return cached.payload
        }
        do {
            let payload = try await fetchScoreboardFromESPN(dateStr: dateStr)
            scheduleCache[dateStr] = (payload, Date())
            return payload
        } catch {
            var fallback = loadBundleSchedule()
            let target = ISO8601DateFormatter().string(from: parseDate(dateStr) ?? Date()).prefix(10)
            fallback.events = fallback.events.filter { event in
                guard let d = event.date.prefix(10) as Substring? else { return false }
                return d == target
            }
            if fallback.events.isEmpty {
                fallback.events = loadBundleSchedule().events
            }
            fallback.warning = "ESPN schedule unavailable (\(error.localizedDescription)). Using bundled fallback."
            fallback.isLive = false
            scheduleCache[dateStr] = (fallback, Date())
            return fallback
        }
    }

    // MARK: - ESPN

    private func fetchTeamsFromESPN() async throws -> TeamsPayload {
        let data = try await fetchJSON(url: "\(Self.espnBase)/teams?limit=50")
        guard let sports = data["sports"] as? [[String: Any]],
              let leagues = sports.first?["leagues"] as? [[String: Any]],
              let teamsRaw = leagues.first?["teams"] as? [[String: Any]] else {
            throw LocalDataError.parseFailed
        }
        let teams = teamsRaw.compactMap { entry -> LocalTeam? in
            guard let team = entry["team"] as? [String: Any] else { return nil }
            return normalizeTeam(team)
        }.filter { !$0.key.isEmpty }

        return TeamsPayload(
            teams: teams,
            source: "espn",
            lastUpdated: ISO8601DateFormatter().string(from: Date()),
            isLive: true,
            warning: nil
        )
    }

    private func fetchScoreboardFromESPN(dateStr: String) async throws -> SchedulePayload {
        let compact = dateStr.replacingOccurrences(of: "-", with: "")
        let data = try await fetchJSON(url: "\(Self.espnBase)/scoreboard?dates=\(compact)")
        let eventsRaw = data["events"] as? [[String: Any]] ?? []
        let events = eventsRaw.compactMap { parseEvent($0) }

        return SchedulePayload(
            events: events,
            source: "espn",
            lastUpdated: ISO8601DateFormatter().string(from: Date()),
            isLive: true,
            warning: nil
        )
    }

    private func fetchInjuriesFromESPN() async throws -> InjuriesPayload {
        let data = try await fetchJSON(url: "\(Self.espnBase)/injuries")
        let teamsPayload = try await fetchTeamsFromESPN()
        let idToKey = Dictionary(uniqueKeysWithValues: teamsPayload.teams.compactMap { team -> (String, String)? in
            guard let id = team.espnId else { return nil }
            return (id, team.key)
        })

        var injuries: [InjuryEntry] = []
        for teamBlock in data["injuries"] as? [[String: Any]] ?? [] {
            let teamId = String(describing: teamBlock["id"] ?? "")
            let abbr = teamBlock["abbreviation"] as? String
            let teamKey = idToKey[teamId] ?? Self.abbrToKey[abbr?.uppercased() ?? ""] ?? abbr?.lowercased()
            let teamName = teamBlock["displayName"] as? String
            for item in teamBlock["injuries"] as? [[String: Any]] ?? [] {
                let athlete = item["athlete"] as? [String: Any]
                let player = athlete?["displayName"] as? String ?? "Unknown"
                let status = (item["status"] as? String) ?? ((item["type"] as? [String: Any])?["description"] as? String) ?? "Unknown"
                let detail = (item["longComment"] as? String) ?? (item["shortComment"] as? String) ?? ""
                injuries.append(InjuryEntry(
                    teamKey: teamKey ?? "unknown",
                    teamName: teamName,
                    player: player,
                    status: status,
                    note: detail.isEmpty ? nil : detail
                ))
            }
        }

        return InjuriesPayload(
            injuries: injuries,
            source: "espn",
            lastUpdated: ISO8601DateFormatter().string(from: Date()),
            isLive: true,
            warning: injuries.isEmpty ? "ESPN returned no injury records" : nil
        )
    }

    private struct WNBATeamMetrics: Sendable {
        var teamId: String?
        var name: String
        var wins: Int?
        var losses: Int?
        var offRating: Double?
        var defRating: Double?
        var netRating: Double?
        var pace: Double?
    }

    private func fetchTeamMetricsFromWNBAStats() async throws -> [WNBATeamMetrics] {
        var components = URLComponents(string: "\(Self.wnbaStatsBase)/leaguedashteamstats")
        components?.queryItems = [
            URLQueryItem(name: "Conference", value: ""),
            URLQueryItem(name: "DateFrom", value: ""),
            URLQueryItem(name: "DateTo", value: ""),
            URLQueryItem(name: "Division", value: ""),
            URLQueryItem(name: "GameScope", value: ""),
            URLQueryItem(name: "GameSegment", value: ""),
            URLQueryItem(name: "LastNGames", value: "0"),
            URLQueryItem(name: "LeagueID", value: "10"),
            URLQueryItem(name: "Location", value: ""),
            URLQueryItem(name: "MeasureType", value: "Advanced"),
            URLQueryItem(name: "Month", value: "0"),
            URLQueryItem(name: "OpponentTeamID", value: "0"),
            URLQueryItem(name: "Outcome", value: ""),
            URLQueryItem(name: "PORound", value: "0"),
            URLQueryItem(name: "PaceAdjust", value: "N"),
            URLQueryItem(name: "PerMode", value: "PerGame"),
            URLQueryItem(name: "Period", value: "0"),
            URLQueryItem(name: "PlayerExperience", value: ""),
            URLQueryItem(name: "PlayerPosition", value: ""),
            URLQueryItem(name: "PlusMinus", value: "N"),
            URLQueryItem(name: "Rank", value: "N"),
            URLQueryItem(name: "Season", value: Self.currentSeason),
            URLQueryItem(name: "SeasonSegment", value: ""),
            URLQueryItem(name: "SeasonType", value: "Regular Season"),
            URLQueryItem(name: "ShotClockRange", value: ""),
            URLQueryItem(name: "StarterBench", value: ""),
            URLQueryItem(name: "TeamID", value: "0"),
            URLQueryItem(name: "TwoWay", value: "0"),
            URLQueryItem(name: "VsConference", value: ""),
            URLQueryItem(name: "VsDivision", value: "")
        ]
        guard let url = components?.url else { throw LocalDataError.invalidURL }

        let data = try await fetchJSON(url: url.absoluteString, extraHeaders: [
            "Origin": "https://www.wnba.com",
            "Referer": "https://www.wnba.com/stats/team-stats"
        ])

        let resultSet = (data["resultSets"] as? [[String: Any]])?.first
            ?? data["resultSet"] as? [String: Any]
        guard let headers = resultSet?["headers"] as? [String],
              let rows = resultSet?["rowSet"] as? [[Any]] else {
            throw LocalDataError.parseFailed
        }

        func index(_ name: String) -> Int? { headers.firstIndex(of: name) }
        let teamIdIdx = index("TEAM_ID")
        let nameIdx = index("TEAM_NAME")
        let winsIdx = index("W")
        let lossesIdx = index("L")
        let offIdx = index("OFF_RATING") ?? index("E_OFF_RATING")
        let defIdx = index("DEF_RATING") ?? index("E_DEF_RATING")
        let netIdx = index("NET_RATING") ?? index("E_NET_RATING")
        let paceIdx = index("PACE") ?? index("E_PACE")

        return rows.compactMap { row in
            guard let nameIdx,
                  row.indices.contains(nameIdx),
                  let name = row[nameIdx] as? String,
                  !name.isEmpty else { return nil }
            return WNBATeamMetrics(
                teamId: valueString(row, teamIdIdx),
                name: name,
                wins: valueInt(row, winsIdx),
                losses: valueInt(row, lossesIdx),
                offRating: valueDouble(row, offIdx),
                defRating: valueDouble(row, defIdx),
                netRating: valueDouble(row, netIdx),
                pace: valueDouble(row, paceIdx)
            )
        }
    }

    private func fetchJSON(url: String, extraHeaders: [String: String] = [:]) async throws -> [String: Any] {
        guard let requestURL = URL(string: url) else { throw LocalDataError.invalidURL }
        var request = URLRequest(url: requestURL)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")
        for (key, value) in extraHeaders {
            request.setValue(value, forHTTPHeaderField: key)
        }
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

    // MARK: - Parsing helpers

    private func normalizeTeam(_ team: [String: Any]) -> LocalTeam {
        let abbr = (team["abbreviation"] as? String) ?? (team["shortDisplayName"] as? String) ?? ""
        let key = Self.abbrToKey[abbr.uppercased()] ?? abbr.lowercased()
        let recordSummary = ((team["record"] as? [String: Any])?["items"] as? [[String: Any]])?.first?["summary"] as? String
            ?? (team["record"] as? [String: Any])?["summary"] as? String
            ?? "0-0"
        let parts = recordSummary.split(separator: "-")
        let wins = parts.count > 0 ? Int(parts[0]) ?? 0 : 0
        let losses = parts.count > 1 ? Int(parts[1]) ?? 0 : 0
        let stats = ((team["record"] as? [String: Any])?["items"] as? [[String: Any]])?.first?["stats"] as? [[String: Any]] ?? []

        func statVal(_ name: String) -> Double? {
            guard let item = stats.first(where: { ($0["name"] as? String) == name || ($0["abbreviation"] as? String) == name }),
                  let value = item["value"] else { return nil }
            if let d = value as? Double { return d }
            if let s = value as? String, let d = Double(s) { return d }
            if let i = value as? Int { return Double(i) }
            return nil
        }

        return LocalTeam(
            key: key,
            espnId: team["id"].map { String(describing: $0) },
            name: (team["displayName"] as? String) ?? (team["name"] as? String) ?? key,
            abbreviation: abbr,
            record: recordSummary,
            wins: wins,
            losses: losses,
            homeRecord: statVal("Home").map { String(format: "%.0f", $0) },
            awayRecord: statVal("Road").map { String(format: "%.0f", $0) },
            last5: nil,
            last10: nil,
            ppg: statVal("avgPointsFor") ?? statVal("pointsFor"),
            oppPpg: statVal("avgPointsAgainst") ?? statVal("pointsAgainst"),
            avgMargin: statVal("differential"),
            offRating: statVal("offensiveRating"),
            defRating: statVal("defensiveRating"),
            netRating: statVal("netRating"),
            pace: statVal("pace")
        )
    }

    private func parseEvent(_ event: [String: Any]) -> LocalScheduleEvent? {
        guard let id = event["id"].map({ String(describing: $0) }) else { return nil }
        let comp = (event["competitions"] as? [[String: Any]])?.first
        let competitors = comp?["competitors"] as? [[String: Any]] ?? []
        let home = competitors.first { ($0["homeAway"] as? String) == "home" }
        let away = competitors.first { ($0["homeAway"] as? String) == "away" }
        let homeTeamDict = home?["team"] as? [String: Any]
        let awayTeamDict = away?["team"] as? [String: Any]
        let homeTeam = homeTeamDict.map { normalizeTeam($0) }
        let awayTeam = awayTeamDict.map { normalizeTeam($0) }
        let statusType = (event["status"] as? [String: Any])?["type"] as? [String: Any]

        return LocalScheduleEvent(
            id: id,
            date: event["date"] as? String ?? "",
            name: event["name"] as? String,
            status: statusType?["description"] as? String,
            statusState: statusType?["state"] as? String ?? "pre",
            homeTeam: homeTeam.map { LocalTeamRef(key: $0.key, name: $0.name) },
            awayTeam: awayTeam.map { LocalTeamRef(key: $0.key, name: $0.name) },
            homeScore: home?["score"].flatMap { Int(String(describing: $0)) } ?? 0,
            awayScore: away?["score"].flatMap { Int(String(describing: $0)) } ?? 0,
            venue: (comp?["venue"] as? [String: Any])?["fullName"] as? String,
            odds: comp.flatMap(ESPNOddsParser.parse(from:))
        )
    }

    // MARK: - Bundle fallbacks

    private func loadBundleTeams() -> TeamsPayload {
        decodeBundle("teams-fallback", as: TeamsPayload.self) ?? TeamsPayload(teams: [], source: "local-fallback", lastUpdated: nil, isLive: false, warning: nil)
    }

    private func loadBundleSchedule() -> SchedulePayload {
        decodeBundle("schedule-fallback", as: SchedulePayload.self) ?? SchedulePayload(events: [], source: "local-fallback", lastUpdated: nil, isLive: false, warning: nil)
    }

    private func loadBundleInjuries() -> InjuriesPayload {
        decodeBundle("injuries-fallback", as: InjuriesPayload.self) ?? InjuriesPayload(injuries: [], source: "local-fallback", lastUpdated: nil, isLive: false, warning: nil)
    }

    private func decodeBundle<T: Decodable>(_ name: String, as type: T.Type) -> T? {
        guard let url = Bundle.main.url(forResource: name, withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    private func enrichTeamsFromFallback(_ result: TeamsPayload) -> TeamsPayload {
        guard let fallback = loadBundleTeams().teams.nilIfEmpty else { return result }
        let fbMap = Dictionary(uniqueKeysWithValues: fallback.map { ($0.key, $0) })
        var warning = result.warning
        let teams = result.teams.map { team -> LocalTeam in
            guard let fb = fbMap[team.key] else { return team }
            let needsStats = team.ppg == nil && team.offRating == nil
            guard needsStats else { return team }
            if warning == nil {
                warning = "Team stats enriched from bundled fallback where ESPN lacked detail"
            }
            var enriched = team
            if team.record == "0-0" { enriched.record = fb.record }
            enriched.wins = team.wins ?? fb.wins
            enriched.losses = team.losses ?? fb.losses
            enriched.homeRecord = team.homeRecord ?? fb.homeRecord
            enriched.awayRecord = team.awayRecord ?? fb.awayRecord
            enriched.last5 = fb.last5
            enriched.last10 = fb.last10
            enriched.ppg = fb.ppg
            enriched.oppPpg = fb.oppPpg
            enriched.avgMargin = fb.avgMargin
            enriched.offRating = fb.offRating
            enriched.defRating = fb.defRating
            enriched.netRating = fb.netRating
            enriched.pace = fb.pace
            return enriched
        }
        return TeamsPayload(teams: teams, source: result.source, lastUpdated: result.lastUpdated, isLive: result.isLive, warning: warning)
    }

    private func enrichTeamsFromLiveStats(_ result: TeamsPayload) async -> TeamsPayload {
        var result = result
        do {
            let metrics = try await fetchTeamMetricsFromWNBAStats()
            result = mergeTeams(result, withWNBAStats: metrics)
        } catch {
            let suffix = "WNBA Stats advanced metrics unavailable (\(error.localizedDescription))"
            let warning = [result.warning, suffix].compactMap { $0 }.joined(separator: "; ")
            result.warning = warning.isEmpty ? nil : warning
        }
        return enrichTeamsFromFallback(result)
    }

    private func mergeTeams(_ result: TeamsPayload, withWNBAStats metrics: [WNBATeamMetrics]) -> TeamsPayload {
        guard !metrics.isEmpty else { return result }
        var metricsByName: [String: WNBATeamMetrics] = [:]
        var metricsById: [String: WNBATeamMetrics] = [:]
        for metric in metrics {
            metricsByName[normalizedTeamName(metric.name)] = metric
            if let teamId = metric.teamId {
                metricsById[teamId] = metric
            }
        }

        var matchedCount = 0
        let teams = result.teams.map { team -> LocalTeam in
            let metric = team.espnId.flatMap { metricsById[$0] }
                ?? metricsByName[normalizedTeamName(team.name)]
            guard let metric else { return team }

            matchedCount += 1
            var enriched = team
            enriched.wins = metric.wins ?? enriched.wins
            enriched.losses = metric.losses ?? enriched.losses
            if let wins = enriched.wins, let losses = enriched.losses {
                enriched.record = "\(wins)-\(losses)"
            }
            enriched.offRating = metric.offRating ?? enriched.offRating
            enriched.defRating = metric.defRating ?? enriched.defRating
            enriched.netRating = metric.netRating ?? enriched.netRating
            enriched.pace = metric.pace ?? enriched.pace
            if let off = enriched.offRating, let def = enriched.defRating {
                enriched.avgMargin = enriched.avgMargin ?? ((off - def) * 10).rounded() / 10
            }
            return enriched
        }

        let source = [result.source, "wnba-stats"].compactMap { $0 }.joined(separator: "+")
        let warning = matchedCount == 0
            ? [result.warning, "WNBA Stats returned metrics but no teams matched"].compactMap { $0 }.joined(separator: "; ")
            : result.warning

        return TeamsPayload(
            teams: teams,
            source: source,
            lastUpdated: ISO8601DateFormatter().string(from: Date()),
            isLive: result.isLive == true,
            warning: warning?.isEmpty == true ? nil : warning
        )
    }

    private func normalizedTeamName(_ value: String) -> String {
        value.lowercased()
            .replacingOccurrences(of: ".", with: "")
            .replacingOccurrences(of: "the ", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func valueString(_ row: [Any], _ index: Int?) -> String? {
        guard let index, row.indices.contains(index) else { return nil }
        return String(describing: row[index])
    }

    private func valueDouble(_ row: [Any], _ index: Int?) -> Double? {
        guard let index, row.indices.contains(index) else { return nil }
        if let value = row[index] as? Double { return value }
        if let value = row[index] as? Int { return Double(value) }
        if let value = row[index] as? String { return Double(value) }
        return nil
    }

    private func valueInt(_ row: [Any], _ index: Int?) -> Int? {
        guard let value = valueDouble(row, index) else { return nil }
        return Int(value)
    }

    private func dateRange(startOffset: Int = 0, days: Int) -> [String] {
        let cal = Calendar.current
        let start = cal.startOfDay(for: Date())
        return (0..<days).compactMap { offset in
            guard let d = cal.date(byAdding: .day, value: startOffset + offset, to: start) else { return nil }
            return ISO8601DateFormatter().string(from: d).prefix(10).description
        }
    }

    private func parseDate(_ dateStr: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        return formatter.date(from: dateStr) ?? ISO8601DateFormatter().date(from: dateStr)
    }
}

enum LocalDataError: Error {
    case invalidURL
    case httpFailed
    case parseFailed
}

private extension Array {
    var nilIfEmpty: Self? { isEmpty ? nil : self }
}
