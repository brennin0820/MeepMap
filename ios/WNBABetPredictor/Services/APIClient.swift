import Foundation

@MainActor
final class APIClient: ObservableObject {
    static let defaultBaseURL = "http://localhost:3847"
    static let allowsRemoteServer = false
    private static let onDeviceEngineKey = "useOnDeviceEngine"
    private static let localJournalKey = "localJournalEntries"
    private static let localBankrollKey = "localBankrollState"
    private static let localHistoryKey = "localPredictionHistory"

    @Published var baseURL: String {
        didSet { UserDefaults.standard.set(baseURL, forKey: "apiBaseURL") }
    }

    /// When true (default), all intelligence runs on-device via LocalIntelligenceEngine.
    @Published var useOnDeviceEngine: Bool {
        didSet {
            if !Self.allowsRemoteServer && !useOnDeviceEngine {
                useOnDeviceEngine = true
                return
            }
            UserDefaults.standard.set(useOnDeviceEngine, forKey: Self.onDeviceEngineKey)
        }
    }

    private let session: URLSession
    private let decoder: JSONDecoder
    private let localEngine = LocalIntelligenceEngine.shared
    private let localData = LocalDataService.shared
    private let localScoreboard = LocalScoreboardService.shared

    @Published var useMockWhenOffline: Bool = true

    init(baseURL: String? = nil) {
        let stored = UserDefaults.standard.string(forKey: "apiBaseURL")
        self.baseURL = baseURL ?? stored ?? Self.defaultBaseURL
        if !Self.allowsRemoteServer {
            self.useOnDeviceEngine = true
            UserDefaults.standard.set(true, forKey: Self.onDeviceEngineKey)
        } else if UserDefaults.standard.object(forKey: Self.onDeviceEngineKey) != nil {
            self.useOnDeviceEngine = UserDefaults.standard.bool(forKey: Self.onDeviceEngineKey)
        } else {
            self.useOnDeviceEngine = true
            UserDefaults.standard.set(true, forKey: Self.onDeviceEngineKey)
        }
        self.session = URLSession.shared
        self.decoder = JSONDecoder()
    }

    func fetchIntelligence(days: Int = 7) async throws -> IntelligenceResponse {
        if useOnDeviceEngine {
            let response = await localEngine.getIntelligence(days: days)
            saveLocalHistory(from: response)
            return response
        }
        return try await get("/api/intelligence", query: [URLQueryItem(name: "days", value: "\(days)")])
    }

    func fetchGameIntelligence(gameId: String) async throws -> GameIntelligence {
        if useOnDeviceEngine {
            guard let game = await localEngine.getGameIntelligence(gameId: gameId) else {
                throw APIError.invalidResponse
            }
            return game
        }
        return try await get("/api/intelligence/game/\(gameId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? gameId)")
    }

    func fetchAlerts(days: Int = 7) async throws -> [Alert] {
        if useOnDeviceEngine {
            return await localEngine.getAlerts(days: days)
        }
        let response: AlertsResponse = try await get("/api/intelligence/alerts", query: [
            URLQueryItem(name: "days", value: "\(days)")
        ])
        return response.alerts
    }

    func fetchHealth() async throws -> SourceHealth {
        if useOnDeviceEngine {
            return await localEngine.getHealth()
        }
        struct HealthPayload: Codable {
            let status: String?
            let modelVersion: String?
        }
        let payload: HealthPayload = try await get("/api/intelligence/health")
        return SourceHealth(
            live: payload.status == "ok",
            cacheAgeSeconds: nil,
            sources: ["model": payload.modelVersion ?? "unknown", "status": payload.status ?? "unknown"]
        )
    }

    func fetchInjuries() async throws -> [InjuryEntry] {
        if useOnDeviceEngine {
            let payload = await localData.getInjuries()
            return payload.injuries
        }
        let response: InjuriesResponse = try await get("/api/injuries")
        return response.injuries
    }

    func fetchTeams() async throws -> TeamsPayload {
        if useOnDeviceEngine {
            return await localData.getTeams()
        }
        return try await get("/api/teams")
    }

    func fetchScoreboard(date: String? = nil) async throws -> ScoreboardResponse {
        if useOnDeviceEngine {
            return await localScoreboard.getScoreboard(date: date)
        }
        var query: [URLQueryItem] = []
        if let date {
            query.append(URLQueryItem(name: "date", value: date))
        }
        return try await get("/api/scoreboard", query: query)
    }

    func fetchTeamSeasonStats(teamKey: String) async throws -> TeamStatsDetailPayload {
        if useOnDeviceEngine {
            return await localScoreboard.getTeamStats(teamKey: teamKey)
        }
        let encoded = teamKey.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? teamKey
        return try await get("/api/teams/\(encoded)/stats")
    }

    func fetchTeamPlayerStats(teamKey: String) async throws -> TeamPlayersPayload {
        if useOnDeviceEngine {
            return await localScoreboard.getTeamPlayers(teamKey: teamKey)
        }
        let encoded = teamKey.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? teamKey
        return try await get("/api/teams/\(encoded)/players")
    }

    func fetchAccuracy() async throws -> AccuracySummary {
        if useOnDeviceEngine {
            let history = await gradeLocalHistory()
            let lab = buildPerformanceLab(from: history)
            let completed = history.filter { $0.wasCorrect != nil }
            let high = completed.filter { confidenceTier($0.confidence) == "High" }
            let medium = completed.filter { confidenceTier($0.confidence) == "Medium" }
            let low = completed.filter { confidenceTier($0.confidence) == "Low" }
            let overall = pctCorrect(completed)
            let highAccuracy = pctCorrect(high)
            let score = localModelScore(
                overall: overall,
                highConfidence: highAccuracy,
                completedCount: completed.count,
                brierScore: lab.brierScore,
                beatClosingRate: lab.beatClosingRate
            )
            return AccuracySummary(
                totalPredictions: history.count,
                completedGames: completed.count,
                moneylineAccuracy: overall,
                highConfidenceAccuracy: highAccuracy,
                mediumConfidenceAccuracy: pctCorrect(medium),
                lowConfidenceAccuracy: pctCorrect(low),
                spreadAccuracy: accuracy(for: history, keyPath: \.spreadCorrect),
                totalAccuracy: accuracy(for: history, keyPath: \.totalCorrect),
                brierScore: lab.brierScore,
                logLoss: lab.logLoss,
                beatClosingRate: lab.beatClosingRate,
                averageSpreadCLV: lab.averageSpreadCLV,
                averageTotalCLV: lab.averageTotalCLV,
                averageMoneylineCLV: lab.averageMoneylineCLV,
                localScore: score,
                pendingPredictions: history.count - completed.count,
                modelVersion: LocalPredictor.modelVersion,
                note: history.isEmpty
                    ? "Local engine is ready. Refresh the Command Center to start recording predictions."
                    : completed.isEmpty
                        ? "Predictions are being tracked locally. Accuracy populates after matching completed final scores."
                        : "Local score blends hit rate, calibration, CLV, and graded sample size."
            )
        }
        return try await get("/api/accuracy")
    }

    func fetchPerformanceLab() async throws -> PerformanceLab {
        if useOnDeviceEngine {
            let history = await gradeLocalHistory()
            return buildPerformanceLab(from: history)
        }
        let history = try await fetchHistory()
        return buildPerformanceLab(from: history.predictions)
    }

    func fetchHistory() async throws -> HistoryResponse {
        if useOnDeviceEngine {
            let history = await gradeLocalHistory()
            return HistoryResponse(predictions: history, count: history.count)
        }
        return try await get("/api/history")
    }

    func fetchJournal() async throws -> JournalResponse {
        if useOnDeviceEngine {
            return JournalResponse(entries: loadLocalJournal())
        }
        return try await get("/api/journal")
    }

    func addJournalEntry(_ entry: JournalEntryRequest) async throws -> JournalEntry {
        if useOnDeviceEngine {
            let record = JournalEntry(
                id: "local-\(UUID().uuidString)",
                createdAt: ISO8601DateFormatter().string(from: Date()),
                matchup: entry.matchup,
                pick: entry.pick,
                units: entry.units,
                notes: entry.notes,
                result: "pending"
            )
            var entries = loadLocalJournal()
            entries.insert(record, at: 0)
            saveLocalJournal(entries)
            return record
        }
        return try await post("/api/journal", body: entry)
    }

    func fetchBankroll() async throws -> BankrollState {
        if useOnDeviceEngine {
            return loadLocalBankroll()
        }
        return try await get("/api/bankroll")
    }

    func updateBankroll(_ update: BankrollUpdate) async throws -> BankrollState {
        if useOnDeviceEngine {
            let current = loadLocalBankroll()
            let updated = BankrollState(
                startingBankroll: update.startingBankroll ?? current.startingBankroll,
                currentBankroll: update.currentBankroll ?? current.currentBankroll,
                unitSize: update.unitSize ?? current.unitSize,
                totalUnitsWagered: current.totalUnitsWagered,
                totalUnitsWon: current.totalUnitsWon,
                roi: Self.roi(
                    startingBankroll: update.startingBankroll ?? current.startingBankroll,
                    currentBankroll: update.currentBankroll ?? current.currentBankroll
                )
            )
            saveLocalBankroll(updated)
            return updated
        }
        return try await put("/api/bankroll", body: update)
    }

    func analyzeMatchup(homeKey: String, awayKey: String, date: String? = nil) async throws -> MatchupResponse {
        if useOnDeviceEngine {
            return await localEngine.analyzeMatchup(homeKey: homeKey, awayKey: awayKey, date: date)
        }
        let body = MatchupRequest(homeKey: homeKey, awayKey: awayKey, date: date)
        return try await post("/api/intelligence/matchup", body: body)
    }

    func runWhatIf(_ request: WhatIfRequest) async throws -> WhatIfResponse {
        if useOnDeviceEngine {
            return await localEngine.runWhatIf(request: request)
        }
        return try await post("/api/intelligence/what-if", body: request)
    }

    func fetchPredictionsFallback(days: Int = 7) async throws -> IntelligenceResponse {
        if useOnDeviceEngine {
            return await localEngine.getIntelligence(days: days)
        }
        struct FlatGame: Codable {
            let eventId: String?
            let date: String?
            let homeTeam: TeamRef?
            let awayTeam: TeamRef?
            let enabled: Bool?
            let margin: Double?
            let total: Double?
            let winProb: WinProbRef?
        }
        struct TeamRef: Codable { let key: String?; let name: String? }
        struct WinProbRef: Codable { let home: Double? }
        struct PredictionsPayload: Codable {
            let predictions: [FlatGame]
        }

        let payload: PredictionsPayload = try await get("/api/predictions", query: [
            URLQueryItem(name: "days", value: "\(days)")
        ])

        let games = payload.predictions.compactMap { p -> GameIntelligence? in
            guard let homeKey = p.homeTeam?.key, let awayKey = p.awayTeam?.key else { return nil }
            let game = GameInfo(
                gameId: p.eventId,
                date: p.date,
                time: nil,
                homeKey: homeKey,
                awayKey: awayKey,
                homeName: p.homeTeam?.name,
                awayName: p.awayTeam?.name,
                status: nil,
                dateValid: p.date != nil
            )
            let decision = Decision(
                decision: .pass,
                confidence: "—",
                risk: "Medium",
                edgeScore: 0,
                action: "Predictions fallback",
                reasonCodes: [],
                humanReasons: []
            )
            let dq = DataQuality(score: 50, grade: .c, confidenceCap: 70, reasonCodes: [], flags: nil, isSafeToPredict: nil)
            return GameIntelligence(
                game: game,
                decision: decision,
                dataQuality: dq,
                prediction: nil,
                homeTeam: nil,
                awayTeam: nil,
                alerts: nil,
                insights: nil,
                explanation: nil
            )
        }

        return IntelligenceResponse(
            generatedAt: nil,
            summary: nil,
            games: games,
            alerts: nil,
            health: nil
        )
    }

    func healthCheck() async -> Bool {
        if useOnDeviceEngine || !Self.allowsRemoteServer {
            return true
        }
        do {
            struct Health: Codable { let status: String? }
            let h: Health = try await get("/api/health")
            return h.status == "healthy" || h.status == "ok"
        } catch {
            return false
        }
    }

    private func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        let request = try makeRequest(path: path, method: "GET", query: query)
        return try await perform(request)
    }

    private func post<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        var request = try makeRequest(path: path, method: "POST")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return try await perform(request)
    }

    private func put<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        var request = try makeRequest(path: path, method: "PUT")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return try await perform(request)
    }

    private func makeRequest(path: String, method: String, query: [URLQueryItem] = []) throws -> URLRequest {
        guard var components = URLComponents(string: baseURL.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            throw APIError.invalidURL
        }
        components.path = path.hasPrefix("/") ? path : "/\(path)"
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else { throw APIError.invalidURL }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 30
        return request
    }

    private func perform<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200...299).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8)
            throw APIError.httpStatus(http.statusCode, body)
        }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }

    private func loadLocalJournal() -> [JournalEntry] {
        guard let data = UserDefaults.standard.data(forKey: Self.localJournalKey),
              let entries = try? decoder.decode([JournalEntry].self, from: data) else {
            return []
        }
        return entries
    }

    private func saveLocalJournal(_ entries: [JournalEntry]) {
        if let data = try? JSONEncoder().encode(entries) {
            UserDefaults.standard.set(data, forKey: Self.localJournalKey)
        }
    }

    private func loadLocalBankroll() -> BankrollState {
        guard let data = UserDefaults.standard.data(forKey: Self.localBankrollKey),
              let state = try? decoder.decode(BankrollState.self, from: data) else {
            return BankrollState(
                startingBankroll: 1000,
                currentBankroll: 1000,
                unitSize: 10,
                totalUnitsWagered: 0,
                totalUnitsWon: 0,
                roi: 0
            )
        }
        return BankrollState(
            startingBankroll: state.startingBankroll,
            currentBankroll: state.currentBankroll,
            unitSize: state.unitSize,
            totalUnitsWagered: state.totalUnitsWagered,
            totalUnitsWon: state.totalUnitsWon,
            roi: Self.roi(startingBankroll: state.startingBankroll, currentBankroll: state.currentBankroll)
        )
    }

    private func saveLocalBankroll(_ state: BankrollState) {
        if let data = try? JSONEncoder().encode(state) {
            UserDefaults.standard.set(data, forKey: Self.localBankrollKey)
        }
    }

    private func loadLocalHistory() -> [HistoryEntry] {
        guard let data = UserDefaults.standard.data(forKey: Self.localHistoryKey),
              let entries = try? decoder.decode([HistoryEntry].self, from: data) else {
            return []
        }
        return entries
    }

    private func saveLocalHistory(from response: IntelligenceResponse) {
        let entries = response.games.compactMap { game -> HistoryEntry? in
            guard let pick = game.recommendedMoneylinePick else { return nil }
            let market = game.prediction?.marketOdds
            let pickedSide = pickedSide(for: pick, game: game.game)
            let projectedMargin = game.prediction?.projections?.projectedMargin ?? game.prediction?.spread
            let projectedTotal = game.prediction?.projections?.projectedTotal ?? game.prediction?.total
            let spreadPick = spreadPickLabel(for: game, projectedMargin: projectedMargin, marketSpread: market?.spread)
            let totalPick = totalPickLabel(projectedTotal: projectedTotal, marketTotal: market?.total)
            return HistoryEntry(
                idField: "\(game.id)-\(game.game.date ?? "undated")",
                game: game.game,
                moneylinePick: pick,
                decision: game.decision.decision.rawValue,
                confidence: game.decision.confidence,
                projectedWinner: game.prediction?.winner,
                projectedHomeWinProb: game.prediction?.projections?.homeWinProb ?? game.prediction?.winProb,
                pickedWinProb: pickedWinProbability(for: game),
                projectedMargin: projectedMargin,
                projectedTotal: projectedTotal,
                marketSpread: market?.spread,
                marketTotal: market?.total,
                openingSpread: market?.openingSpread ?? market?.spread,
                openingTotal: market?.openingTotal ?? market?.total,
                homeMoneyline: market?.homeMoneyline,
                awayMoneyline: market?.awayMoneyline,
                openingHomeMoneyline: market?.openingHomeMoneyline ?? market?.homeMoneyline,
                openingAwayMoneyline: market?.openingAwayMoneyline ?? market?.awayMoneyline,
                pickedSide: pickedSide,
                spreadPick: spreadPick,
                totalPick: totalPick,
                wasCorrect: nil,
                spreadCorrect: nil,
                totalCorrect: nil,
                result: "pending"
                ,
                finalHomeScore: nil,
                finalAwayScore: nil,
                marginError: nil,
                totalError: nil,
                closingSpread: market?.spread,
                closingTotal: market?.total,
                closingHomeMoneyline: market?.homeMoneyline,
                closingAwayMoneyline: market?.awayMoneyline,
                moneylineCLV: nil,
                spreadCLV: nil,
                totalCLV: nil,
                edgeScore: game.decision.edgeScore,
                dataQualityScore: game.dataQuality.score,
                reasonCodes: game.decision.reasonCodes,
                postgameSummary: nil
            )
        }

        guard !entries.isEmpty else { return }

        var existing = loadLocalHistory()
        for entry in entries {
            guard let id = entry.idField else {
                existing.insert(entry, at: 0)
                continue
            }

            if let index = existing.firstIndex(where: { $0.idField == id && ($0.result == nil || $0.result == "pending") }) {
                let prior = existing[index]
                existing[index] = mergedHistoryEntry(prior: prior, current: entry)
            } else if !existing.contains(where: { $0.idField == id }) {
                existing.insert(entry, at: 0)
            }
        }
        existing = Array(existing.prefix(200))

        if let data = try? JSONEncoder().encode(existing) {
            UserDefaults.standard.set(data, forKey: Self.localHistoryKey)
        }
    }

    private func gradeLocalHistory() async -> [HistoryEntry] {
        let history = loadLocalHistory()
        guard !history.isEmpty else { return [] }

        let schedule = await localData.getScheduleWindow(daysBack: 45, daysForward: 0)
        let finals = schedule.events.filter { event in
            let state = event.statusState?.lowercased() ?? ""
            let status = event.status?.lowercased() ?? ""
            return (state == "post" || status.contains("final")) &&
                event.homeScore != nil &&
                event.awayScore != nil
        }

        guard !finals.isEmpty else { return history }

        var changed = false
        let graded = history.map { entry -> HistoryEntry in
            if entry.wasCorrect != nil { return entry }
            guard let final = matchingFinal(for: entry, finals: finals),
                  let homeScore = final.homeScore,
                  let awayScore = final.awayScore,
                  homeScore != awayScore else {
                return entry
            }

            let homeWon = homeScore > awayScore
            let winnerKey = homeWon ? final.homeTeam?.key : final.awayTeam?.key
            let winnerName = homeWon ? final.homeTeam?.name : final.awayTeam?.name
            let correct = pickMatches(entry.moneylinePick, matchesKey: winnerKey, name: winnerName)
            let closingSpread = final.odds?.spread ?? entry.closingSpread ?? entry.marketSpread
            let closingTotal = final.odds?.total ?? entry.closingTotal ?? entry.marketTotal
            let closingHomeMoneyline = final.odds?.homeMoneyline ?? entry.closingHomeMoneyline ?? entry.homeMoneyline
            let closingAwayMoneyline = final.odds?.awayMoneyline ?? entry.closingAwayMoneyline ?? entry.awayMoneyline
            let spreadCorrect = gradeSpread(entry: entry, homeScore: homeScore, awayScore: awayScore)
            let totalCorrect = gradeTotal(entry: entry, homeScore: homeScore, awayScore: awayScore)
            let moneylineCLV = moneylineCLV(
                pickedSide: entry.pickedSide,
                openingHome: entry.openingHomeMoneyline ?? entry.homeMoneyline,
                openingAway: entry.openingAwayMoneyline ?? entry.awayMoneyline,
                closingHome: closingHomeMoneyline,
                closingAway: closingAwayMoneyline
            )
            let spreadCLV = spreadCLV(
                pick: entry.spreadPick,
                openingSpread: entry.openingSpread ?? entry.marketSpread,
                closingSpread: closingSpread
            )
            let totalCLV = totalCLV(
                pick: entry.totalPick,
                openingTotal: entry.openingTotal ?? entry.marketTotal,
                closingTotal: closingTotal
            )
            changed = true
            return HistoryEntry(
                idField: entry.idField,
                game: entry.game,
                moneylinePick: entry.moneylinePick,
                decision: entry.decision,
                confidence: entry.confidence,
                projectedWinner: entry.projectedWinner,
                projectedHomeWinProb: entry.projectedHomeWinProb,
                pickedWinProb: entry.pickedWinProb,
                projectedMargin: entry.projectedMargin,
                projectedTotal: entry.projectedTotal,
                marketSpread: entry.marketSpread,
                marketTotal: entry.marketTotal,
                openingSpread: entry.openingSpread,
                openingTotal: entry.openingTotal,
                homeMoneyline: entry.homeMoneyline,
                awayMoneyline: entry.awayMoneyline,
                openingHomeMoneyline: entry.openingHomeMoneyline,
                openingAwayMoneyline: entry.openingAwayMoneyline,
                pickedSide: entry.pickedSide,
                spreadPick: entry.spreadPick,
                totalPick: entry.totalPick,
                wasCorrect: correct,
                spreadCorrect: spreadCorrect,
                totalCorrect: totalCorrect,
                result: correct ? "win" : "loss",
                finalHomeScore: homeScore,
                finalAwayScore: awayScore,
                marginError: marginError(entry: entry, homeScore: homeScore, awayScore: awayScore),
                totalError: totalError(entry: entry, homeScore: homeScore, awayScore: awayScore),
                closingSpread: closingSpread,
                closingTotal: closingTotal,
                closingHomeMoneyline: closingHomeMoneyline,
                closingAwayMoneyline: closingAwayMoneyline,
                moneylineCLV: moneylineCLV,
                spreadCLV: spreadCLV,
                totalCLV: totalCLV,
                edgeScore: entry.edgeScore,
                dataQualityScore: entry.dataQualityScore,
                reasonCodes: entry.reasonCodes,
                postgameSummary: postgameSummary(
                    entry: entry,
                    moneylineCorrect: correct,
                    spreadCorrect: spreadCorrect,
                    totalCorrect: totalCorrect,
                    moneylineCLV: moneylineCLV,
                    spreadCLV: spreadCLV,
                    totalCLV: totalCLV
                )
            )
        }

        if changed, let data = try? JSONEncoder().encode(graded) {
            UserDefaults.standard.set(data, forKey: Self.localHistoryKey)
        }
        return graded
    }

    private func matchingFinal(for entry: HistoryEntry, finals: [LocalScheduleEvent]) -> LocalScheduleEvent? {
        guard let game = entry.game else { return nil }
        if let gameId = game.gameId,
           let exact = finals.first(where: { $0.id == gameId }) {
            return exact
        }
        return finals.first { event in
            let sameTeams =
                event.homeTeam?.key?.lowercased() == game.homeKey.lowercased() &&
                event.awayTeam?.key?.lowercased() == game.awayKey.lowercased()
            let sameDate = event.date.prefix(10) == (game.date ?? "").prefix(10)
            return sameTeams && sameDate
        }
    }

    private func pickMatches(_ pick: String?, matchesKey key: String?, name: String?) -> Bool {
        let pickText = normalizedPickText(pick)
        guard !pickText.isEmpty else { return false }
        let candidates = [key, name].compactMap { normalizedPickText($0) }.filter { !$0.isEmpty }
        return candidates.contains { candidate in
            pickText == candidate || pickText.contains(candidate)
        }
    }

    private func normalizedPickText(_ value: String?) -> String {
        (value ?? "")
            .lowercased()
            .replacingOccurrences(of: "moneyline", with: "")
            .replacingOccurrences(of: "ml", with: "")
            .replacingOccurrences(of: "@", with: " ")
            .replacingOccurrences(of: ".", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func pctCorrect(_ entries: [HistoryEntry]) -> Double? {
        let graded = entries.filter { $0.wasCorrect != nil }
        guard !graded.isEmpty else { return nil }
        let wins = graded.filter { $0.wasCorrect == true }.count
        return (Double(wins) / Double(graded.count) * 1000).rounded() / 10
    }

    private func confidenceTier(_ confidence: String?) -> String {
        let number = Int((confidence ?? "").filter(\.isNumber)) ?? 0
        if number >= 65 { return "High" }
        if number >= 45 { return "Medium" }
        return "Low"
    }

    private func accuracy(for entries: [HistoryEntry], keyPath: KeyPath<HistoryEntry, Bool?>) -> Double? {
        let graded = entries.filter { $0[keyPath: keyPath] != nil }
        guard !graded.isEmpty else { return nil }
        let wins = graded.filter { $0[keyPath: keyPath] == true }.count
        return (Double(wins) / Double(graded.count) * 1000).rounded() / 10
    }

    private func mergedHistoryEntry(prior: HistoryEntry, current: HistoryEntry) -> HistoryEntry {
        HistoryEntry(
            idField: prior.idField ?? current.idField,
            game: current.game ?? prior.game,
            moneylinePick: current.moneylinePick ?? prior.moneylinePick,
            decision: current.decision ?? prior.decision,
            confidence: current.confidence ?? prior.confidence,
            projectedWinner: current.projectedWinner ?? prior.projectedWinner,
            projectedHomeWinProb: current.projectedHomeWinProb ?? prior.projectedHomeWinProb,
            pickedWinProb: current.pickedWinProb ?? prior.pickedWinProb,
            projectedMargin: current.projectedMargin ?? prior.projectedMargin,
            projectedTotal: current.projectedTotal ?? prior.projectedTotal,
            marketSpread: current.marketSpread ?? prior.marketSpread,
            marketTotal: current.marketTotal ?? prior.marketTotal,
            openingSpread: prior.openingSpread ?? current.openingSpread ?? current.marketSpread,
            openingTotal: prior.openingTotal ?? current.openingTotal ?? current.marketTotal,
            homeMoneyline: current.homeMoneyline ?? prior.homeMoneyline,
            awayMoneyline: current.awayMoneyline ?? prior.awayMoneyline,
            openingHomeMoneyline: prior.openingHomeMoneyline ?? current.openingHomeMoneyline ?? current.homeMoneyline,
            openingAwayMoneyline: prior.openingAwayMoneyline ?? current.openingAwayMoneyline ?? current.awayMoneyline,
            pickedSide: current.pickedSide ?? prior.pickedSide,
            spreadPick: current.spreadPick ?? prior.spreadPick,
            totalPick: current.totalPick ?? prior.totalPick,
            wasCorrect: prior.wasCorrect,
            spreadCorrect: prior.spreadCorrect,
            totalCorrect: prior.totalCorrect,
            result: prior.result ?? current.result,
            finalHomeScore: prior.finalHomeScore,
            finalAwayScore: prior.finalAwayScore,
            marginError: prior.marginError,
            totalError: prior.totalError,
            closingSpread: current.marketSpread ?? prior.closingSpread ?? prior.marketSpread,
            closingTotal: current.marketTotal ?? prior.closingTotal ?? prior.marketTotal,
            closingHomeMoneyline: current.homeMoneyline ?? prior.closingHomeMoneyline ?? prior.homeMoneyline,
            closingAwayMoneyline: current.awayMoneyline ?? prior.closingAwayMoneyline ?? prior.awayMoneyline,
            moneylineCLV: prior.moneylineCLV,
            spreadCLV: prior.spreadCLV,
            totalCLV: prior.totalCLV,
            edgeScore: current.edgeScore ?? prior.edgeScore,
            dataQualityScore: current.dataQualityScore ?? prior.dataQualityScore,
            reasonCodes: current.reasonCodes ?? prior.reasonCodes,
            postgameSummary: prior.postgameSummary
        )
    }

    private func pickedSide(for pick: String?, game: GameInfo) -> String? {
        if pickMatches(pick, matchesKey: game.homeKey, name: game.homeName) { return "home" }
        if pickMatches(pick, matchesKey: game.awayKey, name: game.awayName) { return "away" }
        return nil
    }

    private func pickedWinProbability(for game: GameIntelligence) -> Double? {
        guard let homeProb = game.prediction?.projections?.homeWinProb ?? game.prediction?.winProb else { return nil }
        switch pickedSide(for: game.recommendedMoneylinePick, game: game.game) {
        case "home":
            return homeProb
        case "away":
            return 1 - homeProb
        default:
            return nil
        }
    }

    private func spreadPickLabel(for game: GameIntelligence, projectedMargin: Double?, marketSpread: Double?) -> String? {
        guard let projectedMargin, let marketSpread else { return nil }
        let edge = projectedMargin + marketSpread
        if abs(edge) < 0.5 { return nil }
        return edge > 0 ? "home" : "away"
    }

    private func totalPickLabel(projectedTotal: Double?, marketTotal: Double?) -> String? {
        guard let projectedTotal, let marketTotal else { return nil }
        if abs(projectedTotal - marketTotal) < 0.5 { return nil }
        return projectedTotal > marketTotal ? "over" : "under"
    }

    private func gradeSpread(entry: HistoryEntry, homeScore: Int, awayScore: Int) -> Bool? {
        guard let pick = entry.spreadPick, let line = entry.marketSpread else { return nil }
        let adjustedHome = Double(homeScore) + line
        if adjustedHome == Double(awayScore) { return nil }
        let homeCovered = adjustedHome > Double(awayScore)
        return pick == "home" ? homeCovered : !homeCovered
    }

    private func gradeTotal(entry: HistoryEntry, homeScore: Int, awayScore: Int) -> Bool? {
        guard let pick = entry.totalPick, let line = entry.marketTotal else { return nil }
        let finalTotal = Double(homeScore + awayScore)
        if finalTotal == line { return nil }
        let overHit = finalTotal > line
        return pick == "over" ? overHit : !overHit
    }

    private func marginError(entry: HistoryEntry, homeScore: Int, awayScore: Int) -> Double? {
        guard let projected = entry.projectedMargin else { return nil }
        return (abs(Double(homeScore - awayScore) - projected) * 10).rounded() / 10
    }

    private func totalError(entry: HistoryEntry, homeScore: Int, awayScore: Int) -> Double? {
        guard let projected = entry.projectedTotal else { return nil }
        return (abs(Double(homeScore + awayScore) - projected) * 10).rounded() / 10
    }

    private func impliedProbability(fromAmerican line: Int) -> Double {
        if line < 0 {
            let price = Double(-line)
            return price / (price + 100)
        }
        let price = Double(line)
        return 100 / (price + 100)
    }

    private func moneylineCLV(
        pickedSide: String?,
        openingHome: Int?,
        openingAway: Int?,
        closingHome: Int?,
        closingAway: Int?
    ) -> Double? {
        let opening: Int?
        let closing: Int?
        switch pickedSide {
        case "home":
            opening = openingHome
            closing = closingHome
        case "away":
            opening = openingAway
            closing = closingAway
        default:
            return nil
        }
        guard let opening, let closing else { return nil }
        let delta = (impliedProbability(fromAmerican: closing) - impliedProbability(fromAmerican: opening)) * 100
        return (delta * 10).rounded() / 10
    }

    private func spreadCLV(pick: String?, openingSpread: Double?, closingSpread: Double?) -> Double? {
        guard let pick, let openingSpread, let closingSpread else { return nil }
        let openLine = pick == "home" ? openingSpread : -openingSpread
        let closeLine = pick == "home" ? closingSpread : -closingSpread
        return ((openLine - closeLine) * 10).rounded() / 10
    }

    private func totalCLV(pick: String?, openingTotal: Double?, closingTotal: Double?) -> Double? {
        guard let pick, let openingTotal, let closingTotal else { return nil }
        let delta = pick == "over" ? (closingTotal - openingTotal) : (openingTotal - closingTotal)
        return (delta * 10).rounded() / 10
    }

    private func postgameSummary(
        entry: HistoryEntry,
        moneylineCorrect: Bool?,
        spreadCorrect: Bool?,
        totalCorrect: Bool?,
        moneylineCLV: Double?,
        spreadCLV: Double?,
        totalCLV: Double?
    ) -> String {
        let side = moneylineCorrect == true ? "Moneyline right" : "Moneyline missed"
        let spread = spreadCorrect == true ? "spread right" : spreadCorrect == false ? "spread missed" : "spread push/no grade"
        let total = totalCorrect == true ? "total right" : totalCorrect == false ? "total missed" : "total push/no grade"
        let clv = [moneylineCLV, spreadCLV, totalCLV]
            .compactMap { $0 }
            .map { $0 >= 0 ? "beat close \(String(format: "%+.1f", $0))" : "lost close \(String(format: "%+.1f", $0))" }
            .first
        return [side, spread, total, clv].compactMap { $0 }.joined(separator: " · ")
    }

    private func buildPerformanceLab(from history: [HistoryEntry]) -> PerformanceLab {
        let completed = history.filter { $0.wasCorrect != nil }
        let moneylineEntries = completed.filter { $0.pickedWinProb != nil }
        let spreadEntries = history.filter { $0.spreadCorrect != nil }
        let totalEntries = history.filter { $0.totalCorrect != nil }

        let calibration = calibrationBuckets(from: moneylineEntries)
        let brier = brierScore(from: moneylineEntries)
        let logLoss = logLoss(from: moneylineEntries)
        let moneylineCLVValues = completed.compactMap(\.moneylineCLV)
        let spreadCLVValues = history.compactMap(\.spreadCLV)
        let totalCLVValues = history.compactMap(\.totalCLV)

        return PerformanceLab(
            generatedAt: ISO8601DateFormatter().string(from: Date()),
            gradedCount: completed.count,
            brierScore: brier,
            logLoss: logLoss,
            beatClosingRate: beatCloseRate(values: moneylineCLVValues + spreadCLVValues + totalCLVValues),
            averageSpreadCLV: average(spreadCLVValues),
            averageTotalCLV: average(totalCLVValues),
            averageMoneylineCLV: average(moneylineCLVValues),
            markets: [
                marketPerformance(
                    id: "moneyline",
                    label: "Moneyline",
                    entries: completed,
                    keyPath: \.wasCorrect,
                    clv: moneylineCLVValues
                ),
                marketPerformance(
                    id: "spread",
                    label: "Spread",
                    entries: spreadEntries,
                    keyPath: \.spreadCorrect,
                    clv: spreadCLVValues
                ),
                marketPerformance(
                    id: "total",
                    label: "Total",
                    entries: totalEntries,
                    keyPath: \.totalCorrect,
                    clv: totalCLVValues
                )
            ],
            calibration: calibration,
            audits: buildPostgameAudits(from: completed)
        )
    }

    private func marketPerformance(
        id: String,
        label: String,
        entries: [HistoryEntry],
        keyPath: KeyPath<HistoryEntry, Bool?>,
        clv: [Double]
    ) -> MarketPerformance {
        let high = entries.filter { confidenceTier($0.confidence) == "High" }
        let medium = entries.filter { confidenceTier($0.confidence) == "Medium" }
        let low = entries.filter { confidenceTier($0.confidence) == "Low" }
        return MarketPerformance(
            id: id,
            label: label,
            overallAccuracy: accuracy(for: entries, keyPath: keyPath),
            highConfidenceAccuracy: accuracy(for: high, keyPath: keyPath),
            mediumConfidenceAccuracy: accuracy(for: medium, keyPath: keyPath),
            lowConfidenceAccuracy: accuracy(for: low, keyPath: keyPath),
            gradedCount: entries.filter { $0[keyPath: keyPath] != nil }.count,
            averageCLV: average(clv),
            beatCloseRate: beatCloseRate(values: clv)
        )
    }

    private func calibrationBuckets(from entries: [HistoryEntry]) -> [CalibrationBucket] {
        let bucketStarts = Array(stride(from: 50, through: 90, by: 5))
        return bucketStarts.map { start in
            let end = start + 4
            let members = entries.filter { entry in
                guard let probability = entry.pickedWinProb else { return false }
                let pct = Int((probability * 100).rounded(.down))
                return pct >= start && pct <= end
            }
            let averagePredicted = members.isEmpty ? Double(start + end) / 200 : members.compactMap(\.pickedWinProb).reduce(0, +) / Double(members.count)
            let actual = members.isEmpty ? nil : Double(members.filter { $0.wasCorrect == true }.count) / Double(members.count)
            return CalibrationBucket(
                id: "bucket-\(start)",
                label: "\(start)-\(end)%",
                averagePredicted: averagePredicted,
                actualWinRate: actual,
                count: members.count
            )
        }.filter { $0.count > 0 }
    }

    private func brierScore(from entries: [HistoryEntry]) -> Double? {
        let pairs = entries.compactMap { entry -> (Double, Double)? in
            guard let probability = entry.pickedWinProb, let result = entry.wasCorrect else { return nil }
            return (probability, result ? 1 : 0)
        }
        guard !pairs.isEmpty else { return nil }
        let value = pairs.reduce(0.0) { partial, pair in
            partial + pow(pair.0 - pair.1, 2)
        } / Double(pairs.count)
        return (value * 1000).rounded() / 1000
    }

    private func logLoss(from entries: [HistoryEntry]) -> Double? {
        let pairs = entries.compactMap { entry -> (Double, Double)? in
            guard let probability = entry.pickedWinProb, let result = entry.wasCorrect else { return nil }
            return (min(max(probability, 0.001), 0.999), result ? 1 : 0)
        }
        guard !pairs.isEmpty else { return nil }
        let value = pairs.reduce(0.0) { partial, pair in
            partial - ((pair.1 * log(pair.0)) + ((1 - pair.1) * log(1 - pair.0)))
        } / Double(pairs.count)
        return (value * 1000).rounded() / 1000
    }

    private func beatCloseRate(values: [Double]) -> Double? {
        let comparable = values.filter { !$0.isNaN }
        guard !comparable.isEmpty else { return nil }
        let wins = comparable.filter { $0 > 0 }.count
        return (Double(wins) / Double(comparable.count) * 1000).rounded() / 10
    }

    private func average(_ values: [Double]) -> Double? {
        guard !values.isEmpty else { return nil }
        return ((values.reduce(0, +) / Double(values.count)) * 10).rounded() / 10
    }

    private func buildPostgameAudits(from entries: [HistoryEntry]) -> [PostgameAudit] {
        entries.prefix(20).map { entry in
            let away = entry.game?.awayName ?? entry.game?.awayKey.uppercased() ?? "Away"
            let home = entry.game?.homeName ?? entry.game?.homeKey.uppercased() ?? "Home"
            let clvPieces = [
                entry.moneylineCLV.map { "ML \(String(format: "%+.1f", $0))" },
                entry.spreadCLV.map { "Spread \(String(format: "%+.1f", $0))" },
                entry.totalCLV.map { "Total \(String(format: "%+.1f", $0))" }
            ].compactMap { $0 }
            return PostgameAudit(
                id: entry.id,
                matchup: "\(away) @ \(home)",
                result: entry.result ?? "pending",
                summary: entry.postgameSummary ?? "Postgame audit pending.",
                confidence: entry.confidence,
                clvNote: clvPieces.isEmpty ? nil : clvPieces.joined(separator: " · ")
            )
        }
    }

    private func localModelScore(
        overall: Double?,
        highConfidence: Double?,
        completedCount: Int,
        brierScore: Double?,
        beatClosingRate: Double?
    ) -> Int? {
        guard let overall else { return nil }
        let high = highConfidence ?? overall
        let sample = min(1.0, Double(completedCount) / 25.0)
        let calibration = brierScore.map { max(0, 1 - $0) * 100 } ?? overall
        let clv = beatClosingRate ?? 50
        let score = (overall * 0.45) + (high * 0.2) + (calibration * 0.2) + (clv * 0.05) + (sample * 10)
        return Int(max(0, min(100, score)).rounded())
    }

    private static func roi(startingBankroll: Double, currentBankroll: Double) -> Double {
        guard startingBankroll > 0 else { return 0 }
        return (((currentBankroll - startingBankroll) / startingBankroll) * 10000).rounded() / 100
    }
}

enum APIError: LocalizedError {
    case invalidURL
    case invalidResponse
    case httpStatus(Int, String?)
    case decoding(Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid API URL."
        case .invalidResponse:
            return "Invalid response from API."
        case let .httpStatus(statusCode, body):
            if let body, !body.isEmpty {
                return "API request failed with status \(statusCode): \(body)"
            }
            return "API request failed with status \(statusCode)."
        case let .decoding(error):
            return "Failed to decode API response: \(error.localizedDescription)"
        }
    }
}

struct AccuracySummary: Codable, Sendable {
    let totalPredictions: Int?
    let completedGames: Int?
    let moneylineAccuracy: Double?
    let highConfidenceAccuracy: Double?
    let mediumConfidenceAccuracy: Double?
    let lowConfidenceAccuracy: Double?
    let spreadAccuracy: Double?
    let totalAccuracy: Double?
    let brierScore: Double?
    let logLoss: Double?
    let beatClosingRate: Double?
    let averageSpreadCLV: Double?
    let averageTotalCLV: Double?
    let averageMoneylineCLV: Double?
    let localScore: Int?
    let pendingPredictions: Int?
    let modelVersion: String?
    let note: String?
}

struct HistoryResponse: Codable, Sendable {
    let predictions: [HistoryEntry]
    let count: Int?
}

struct HistoryEntry: Codable, Identifiable, Sendable {
    var id: String { self.idField ?? UUID().uuidString }
    let idField: String?
    let game: GameInfo?
    let moneylinePick: String?
    let decision: String?
    let confidence: String?
    let projectedWinner: String?
    let projectedHomeWinProb: Double?
    let pickedWinProb: Double?
    let projectedMargin: Double?
    let projectedTotal: Double?
    let marketSpread: Double?
    let marketTotal: Double?
    let openingSpread: Double?
    let openingTotal: Double?
    let homeMoneyline: Int?
    let awayMoneyline: Int?
    let openingHomeMoneyline: Int?
    let openingAwayMoneyline: Int?
    let pickedSide: String?
    let spreadPick: String?
    let totalPick: String?
    let wasCorrect: Bool?
    let spreadCorrect: Bool?
    let totalCorrect: Bool?
    let result: String?
    let finalHomeScore: Int?
    let finalAwayScore: Int?
    let marginError: Double?
    let totalError: Double?
    let closingSpread: Double?
    let closingTotal: Double?
    let closingHomeMoneyline: Int?
    let closingAwayMoneyline: Int?
    let moneylineCLV: Double?
    let spreadCLV: Double?
    let totalCLV: Double?
    let edgeScore: Int?
    let dataQualityScore: Int?
    let reasonCodes: [String]?
    let postgameSummary: String?

    enum CodingKeys: String, CodingKey {
        case idField = "id"
        case game, moneylinePick, decision, confidence, projectedWinner, projectedHomeWinProb, pickedWinProb
        case projectedMargin, projectedTotal, marketSpread, marketTotal, openingSpread, openingTotal
        case homeMoneyline, awayMoneyline, openingHomeMoneyline, openingAwayMoneyline
        case pickedSide, spreadPick, totalPick, wasCorrect, spreadCorrect, totalCorrect, result
        case finalHomeScore, finalAwayScore, marginError, totalError
        case closingSpread, closingTotal, closingHomeMoneyline, closingAwayMoneyline
        case moneylineCLV, spreadCLV, totalCLV, edgeScore, dataQualityScore, reasonCodes, postgameSummary
    }
}

struct MarketPerformance: Codable, Identifiable, Sendable {
    let id: String
    let label: String
    let overallAccuracy: Double?
    let highConfidenceAccuracy: Double?
    let mediumConfidenceAccuracy: Double?
    let lowConfidenceAccuracy: Double?
    let gradedCount: Int
    let averageCLV: Double?
    let beatCloseRate: Double?
}

struct CalibrationBucket: Codable, Identifiable, Sendable {
    let id: String
    let label: String
    let averagePredicted: Double
    let actualWinRate: Double?
    let count: Int
}

struct PostgameAudit: Codable, Identifiable, Sendable {
    let id: String
    let matchup: String
    let result: String
    let summary: String
    let confidence: String?
    let clvNote: String?
}

struct PerformanceLab: Codable, Sendable {
    let generatedAt: String
    let gradedCount: Int
    let brierScore: Double?
    let logLoss: Double?
    let beatClosingRate: Double?
    let averageSpreadCLV: Double?
    let averageTotalCLV: Double?
    let averageMoneylineCLV: Double?
    let markets: [MarketPerformance]
    let calibration: [CalibrationBucket]
    let audits: [PostgameAudit]
}

struct JournalResponse: Codable, Sendable {
    let entries: [JournalEntry]
}

struct JournalEntry: Codable, Identifiable, Sendable {
    let id: String
    let createdAt: String?
    let matchup: String?
    let pick: String?
    let units: Double?
    let notes: String?
    let result: String?
}

struct JournalEntryRequest: Codable, Sendable {
    let matchup: String
    let pick: String
    let units: Double
    let notes: String?
    let betType: String?
}

struct BankrollState: Codable, Sendable {
    let startingBankroll: Double
    let currentBankroll: Double
    let unitSize: Double
    let totalUnitsWagered: Double?
    let totalUnitsWon: Double?
    let roi: Double?
}

struct BankrollUpdate: Codable, Sendable {
    let startingBankroll: Double?
    let currentBankroll: Double?
    let unitSize: Double?
}

private extension GameIntelligence {
    var recommendedMoneylinePick: String? {
        if let pick = prediction?.picks?.moneyline?.pick, !pick.isEmpty {
            return pick
        }
        if let winner = prediction?.winner, !winner.isEmpty {
            return "\(winner) ML"
        }
        return nil
    }
}
