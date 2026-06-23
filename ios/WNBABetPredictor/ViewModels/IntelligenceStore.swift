import Foundation

@MainActor
@Observable
final class IntelligenceStore {
    var response: IntelligenceResponse?
    var alerts: [Alert] = []
    var isLoading = false
    var errorMessage: String?
    var lastRefreshed: Date?

    private let api: APIClient

    var client: APIClient { api }

    init(api: APIClient = APIClient()) {
        self.api = api
    }

    var games: [GameIntelligence] { response?.games ?? [] }

    var groupedByDecision: [DecisionType: [GameIntelligence]] {
        Dictionary(grouping: games, by: { $0.decision.decision })
    }

    func refresh() async {
        isLoading = true
        errorMessage = nil
        defer {
            isLoading = false
            lastRefreshed = Date()
        }

        do {
            response = try await api.fetchIntelligence()
            if let embedded = response?.alerts {
                alerts = embedded
            } else {
                alerts = (try? await api.fetchAlerts()) ?? []
            }
            if api.useOnDeviceEngine, let warning = localDataWarning(from: response) {
                errorMessage = warning
            }
        } catch {
            if api.useMockWhenOffline && !api.useOnDeviceEngine {
                response = MockDataProvider.intelligenceResponse
                alerts = response?.alerts ?? []
                errorMessage = "Offline — showing sample data."
                return
            }
            if api.useOnDeviceEngine {
                errorMessage = error.localizedDescription
            } else {
                do {
                    response = try await api.fetchPredictionsFallback()
                    alerts = []
                    errorMessage = "Remote intelligence API unavailable — showing predictions fallback."
                } catch {
                    errorMessage = error.localizedDescription
                }
            }
        }
    }

    private func localDataWarning(from response: IntelligenceResponse?) -> String? {
        guard let health = response?.health, health.live != true else { return nil }
        return "Using bundled fallback data — connect to network for live ESPN feeds."
    }

    func game(withId id: String) -> GameIntelligence? {
        games.first { $0.id == id }
    }
}

@MainActor
@Observable
final class InjuriesStore {
    var injuries: [InjuryEntry] = []
    var isLoading = false
    var errorMessage: String?

    private let api: APIClient

    init(api: APIClient = APIClient()) {
        self.api = api
    }

    func refresh() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            injuries = try await api.fetchInjuries()
        } catch {
            if api.useMockWhenOffline && !api.useOnDeviceEngine {
                injuries = MockDataProvider.injuriesResponse.injuries
                errorMessage = "Offline — showing sample injury data."
            } else {
                errorMessage = error.localizedDescription
            }
        }
    }
}

@MainActor
@Observable
final class MatchupStore {
    var result: GameIntelligence?
    var isLoading = false
    var errorMessage: String?

    private let api: APIClient

    init(api: APIClient = APIClient()) {
        self.api = api
    }

    func analyze(homeKey: String, awayKey: String) async {
        guard homeKey != awayKey, !homeKey.isEmpty, !awayKey.isEmpty else {
            errorMessage = "Select two different teams."
            return
        }
        isLoading = true
        errorMessage = nil
        result = nil
        defer { isLoading = false }
        do {
            let response = try await api.analyzeMatchup(homeKey: homeKey, awayKey: awayKey)
            result = response.game
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

@MainActor
@Observable
final class ScoreboardStore {
    var scoreboard: ScoreboardResponse?
    var expandedGameId: String?
    var teamDetails: [String: TeamStatsDetailPayload] = [:]
    var teamLoadingKeys: Set<String> = []
    var playersCache: [String: TeamPlayersPayload] = [:]
    var playersLoadingKeys: Set<String> = []
    var isLoading = false
    var errorMessage: String?

    private let api: APIClient

    init(api: APIClient = APIClient()) {
        self.api = api
    }

    func refresh() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            scoreboard = try await api.fetchScoreboard()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func toggleGame(_ game: ScoreboardGame) {
        if expandedGameId == game.id {
            expandedGameId = nil
            return
        }
        expandedGameId = game.id
        Task { await loadTeamDetails(for: game) }
    }

    func loadTeamDetails(for game: ScoreboardGame) async {
        let keys = [game.awayKey ?? game.awayTeam?.key, game.homeKey ?? game.homeTeam?.key]
            .compactMap { $0 }
            .filter { !$0.isEmpty }

        for key in keys {
            teamLoadingKeys.insert(key)
        }

        await withTaskGroup(of: (String, TeamStatsDetailPayload).self) { group in
            for key in keys {
                group.addTask { [api] in
                    do {
                        let detail = try await api.fetchTeamSeasonStats(teamKey: key)
                        return (key, detail)
                    } catch {
                        return (key, TeamStatsDetailPayload(teamKey: key, error: error.localizedDescription))
                    }
                }
            }
            for await (key, detail) in group {
                teamDetails[key] = detail
                teamLoadingKeys.remove(key)
            }
        }
    }

    func loadPlayers(teamKey: String) async {
        let key = teamKey.lowercased()
        if playersCache[key] != nil { return }

        playersLoadingKeys.insert(key)
        defer { playersLoadingKeys.remove(key) }

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
}
