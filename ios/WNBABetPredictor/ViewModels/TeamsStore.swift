import Foundation

enum TeamBoardSegment: String, CaseIterable, Identifiable {
    case all = "All"
    case contenders = "Contenders"
    case midTable = "Mid-table"
    case fadeWatch = "Fade watch"

    var id: String { rawValue }
}

enum TeamBoardSort: String, CaseIterable, Identifiable {
    case netRating = "Net Rating"
    case last5 = "Last 5"
    case offense = "Off Rating"
    case defense = "Def Rating"
    case pace = "Pace"
    case injuryRisk = "Injury Risk"

    var id: String { rawValue }
}

@MainActor
@Observable
final class TeamsStore {
    var teamsPayload: TeamsPayload?
    var injuries: [InjuryEntry] = []
    var todaysTeamKeys: Set<String> = []
    var teamDetails: [String: TeamStatsDetailPayload] = [:]
    var playersCache: [String: TeamPlayersPayload] = [:]
    var loadingDetailKeys: Set<String> = []
    var loadingPlayerKeys: Set<String> = []
    var isLoading = false
    var errorMessage: String?
    var searchText = ""
    var selectedSegment: TeamBoardSegment = .all
    var selectedSort: TeamBoardSort = .netRating
    var showOnlyPlayingToday = false

    private let api: APIClient

    init(api: APIClient = APIClient()) {
        self.api = api
    }

    var teams: [LocalTeam] {
        teamsPayload?.teams ?? []
    }

    var filteredTeams: [LocalTeam] {
        teams
            .filter(matchesSearch)
            .filter(matchesSegment)
            .filter(matchesToday)
            .sorted(by: sortClosure)
    }

    func refresh() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        async let teamsResult = fetchTeamsPayload()
        async let injuriesResult = fetchInjuriesPayload()
        async let scoreboardResult = fetchTodayKeys()

        let teamsPayload = await teamsResult
        let injuries = await injuriesResult
        let todayKeys = await scoreboardResult

        self.teamsPayload = teamsPayload.payload
        self.injuries = injuries.entries
        self.todaysTeamKeys = todayKeys

        let warnings = [
            teamsPayload.payload?.warning,
            injuries.warning,
            teamsPayload.error,
            injuries.error
        ].compactMap { $0 }.filter { !$0.isEmpty }
        errorMessage = warnings.first
    }

    func loadProfile(teamKey: String) async {
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.loadTeamDetail(teamKey: teamKey) }
            group.addTask { await self.loadPlayers(teamKey: teamKey) }
        }
    }

    func loadTeamDetail(teamKey: String) async {
        let key = teamKey.lowercased()
        if teamDetails[key] != nil || loadingDetailKeys.contains(key) {
            return
        }

        loadingDetailKeys.insert(key)
        defer { loadingDetailKeys.remove(key) }

        do {
            teamDetails[key] = try await api.fetchTeamSeasonStats(teamKey: key)
        } catch {
            teamDetails[key] = TeamStatsDetailPayload(teamKey: key, error: error.localizedDescription)
        }
    }

    func loadPlayers(teamKey: String) async {
        let key = teamKey.lowercased()
        if playersCache[key] != nil || loadingPlayerKeys.contains(key) {
            return
        }

        loadingPlayerKeys.insert(key)
        defer { loadingPlayerKeys.remove(key) }

        do {
            playersCache[key] = try await api.fetchTeamPlayerStats(teamKey: key)
        } catch {
            playersCache[key] = TeamPlayersPayload(
                teamKey: key,
                players: [],
                warning: error.localizedDescription
            )
        }
    }

    func injuries(for teamKey: String) -> [InjuryEntry] {
        injuries
            .filter { $0.teamKey.lowercased() == teamKey.lowercased() }
            .sorted { lhs, rhs in
                severityScore(lhs.status) > severityScore(rhs.status)
            }
    }

    func healthLabel(for team: LocalTeam) -> String {
        let teamInjuries = injuries(for: team.key)
        let severeCount = teamInjuries.filter { severityScore($0.status) >= 2 }.count
        if severeCount >= 2 { return "Thin" }
        if severeCount == 1 || !teamInjuries.isEmpty { return "Watch" }
        return "Clean"
    }

    func trendLabel(for team: LocalTeam) -> String {
        let last5Wins = parseRecordWins(team.last5)
        let last10Wins = parseRecordWins(team.last10)

        if last5Wins >= 4 && (team.netRating ?? 0) >= 4 { return "Rising" }
        if last5Wins <= 1 || ((last10Wins <= 3) && (team.netRating ?? 0) < 0) { return "Sliding" }
        return "Stable"
    }

    func bettingNotes(for team: LocalTeam, detail: TeamStatsDetailPayload?) -> [String] {
        let stats = detail?.stats
        let net = stats?.netRating ?? team.netRating
        let pace = stats?.pace ?? team.pace
        let off = team.offRating
        let def = team.defRating
        let avgMargin = team.avgMargin
        let trend = trendLabel(for: team)

        var notes: [String] = []

        if let net, let avgMargin, net > 6, avgMargin < 4 {
            notes.append("Underlying efficiency is stronger than the win margin.")
        }
        if let pace, pace >= 97 {
            notes.append("Fast pace increases total volatility.")
        }
        if let def, def <= 101 {
            notes.append("Defense travels well when the offense cools off.")
        }
        if let off, off >= 109, trend == "Sliding" {
            notes.append("Scoring ceiling is intact, but recent form is slipping.")
        }
        if healthLabel(for: team) == "Thin" {
            notes.append("Availability risk can invalidate pregame reads quickly.")
        }
        if notes.isEmpty, let net {
            notes.append(net >= 0 ? "Usable team when price matches the profile." : "Price-sensitive team that needs matchup help.")
        }

        return Array(notes.prefix(3))
    }

    func todayStatus(for teamKey: String) -> Bool {
        todaysTeamKeys.contains(teamKey.lowercased())
    }

    private func fetchTeamsPayload() async -> (payload: TeamsPayload?, error: String?) {
        do {
            return (try await api.fetchTeams(), nil)
        } catch {
            return (nil, error.localizedDescription)
        }
    }

    private func fetchInjuriesPayload() async -> (entries: [InjuryEntry], warning: String?, error: String?) {
        do {
            return (try await api.fetchInjuries(), nil, nil)
        } catch {
            return ([], nil, error.localizedDescription)
        }
    }

    private func fetchTodayKeys() async -> Set<String> {
        do {
            let scoreboard = try await api.fetchScoreboard()
            return Set(scoreboard.games.flatMap { game in
                [game.homeKey, game.awayKey].compactMap { $0?.lowercased() }
            })
        } catch {
            return []
        }
    }

    private func matchesSearch(_ team: LocalTeam) -> Bool {
        guard !searchText.isEmpty else { return true }
        let needle = searchText.lowercased()
        return team.name.lowercased().contains(needle)
            || team.key.lowercased().contains(needle)
            || (team.abbreviation?.lowercased().contains(needle) == true)
    }

    private func matchesSegment(_ team: LocalTeam) -> Bool {
        switch selectedSegment {
        case .all:
            return true
        case .contenders:
            return (team.netRating ?? 0) >= 6 || (team.wins ?? 0) >= 10
        case .midTable:
            let net = team.netRating ?? 0
            return net >= -2 && net < 6
        case .fadeWatch:
            return (team.netRating ?? 0) < -2 || parseRecordWins(team.last5) <= 1
        }
    }

    private func matchesToday(_ team: LocalTeam) -> Bool {
        !showOnlyPlayingToday || todayStatus(for: team.key)
    }

    private var sortClosure: (LocalTeam, LocalTeam) -> Bool {
        switch selectedSort {
        case .netRating:
            return { lhs, rhs in
                self.metric(lhs.netRating, fallback: lhs.avgMargin) > self.metric(rhs.netRating, fallback: rhs.avgMargin)
            }
        case .last5:
            return { lhs, rhs in
                self.parseRecordWins(lhs.last5) > self.parseRecordWins(rhs.last5)
            }
        case .offense:
            return { lhs, rhs in
                self.metric(lhs.offRating, fallback: lhs.ppg) > self.metric(rhs.offRating, fallback: rhs.ppg)
            }
        case .defense:
            return { lhs, rhs in
                self.defensiveSortValue(lhs) > self.defensiveSortValue(rhs)
            }
        case .pace:
            return { lhs, rhs in
                self.metric(lhs.pace, fallback: lhs.ppg) > self.metric(rhs.pace, fallback: rhs.ppg)
            }
        case .injuryRisk:
            return { lhs, rhs in
                self.injuryRiskScore(for: lhs) > self.injuryRiskScore(for: rhs)
            }
        }
    }

    private func injuryRiskScore(for team: LocalTeam) -> Int {
        let teamInjuries = injuries(for: team.key)
        return teamInjuries.reduce(0) { partial, entry in
            partial + severityScore(entry.status)
        }
    }

    private func severityScore(_ status: String) -> Int {
        let lower = status.lowercased()
        if lower.contains("out") { return 3 }
        if lower.contains("question") || lower.contains("doubt") { return 2 }
        if lower.contains("probable") { return 1 }
        return 0
    }

    private func parseRecordWins(_ record: String?) -> Int {
        guard let record,
              let wins = Int(record.split(separator: "-").first ?? "") else {
            return 0
        }
        return wins
    }

    private func metric(_ primary: Double?, fallback: Double?) -> Double {
        primary ?? fallback ?? -.greatestFiniteMagnitude
    }

    private func defensiveSortValue(_ team: LocalTeam) -> Double {
        if let defRating = team.defRating {
            return -defRating
        }
        if let oppPpg = team.oppPpg {
            return -oppPpg
        }
        return -.greatestFiniteMagnitude
    }
}
