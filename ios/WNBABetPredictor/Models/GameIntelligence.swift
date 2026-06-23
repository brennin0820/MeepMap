import Foundation

struct GameInfo: Codable, Hashable, Sendable, Identifiable {
    var id: String { gameId ?? "\(homeKey)-\(awayKey)-\(date ?? "")" }
    let gameId: String?
    let date: String?
    let time: String?
    let homeKey: String
    let awayKey: String
    let homeName: String?
    let awayName: String?
    let status: String?
    let dateValid: Bool?
}

struct TeamSnapshot: Codable, Hashable, Sendable {
    let key: String?
    let name: String?
    let record: String?
    let last5: String?
    let netRating: Double?
    let offRating: Double?
    let defRating: Double?
}

struct Projection: Codable, Hashable, Sendable {
    let homeWinProb: Double?
    let projectedMargin: Double?
    let projectedTotal: Double?
    let projectedScore: ProjectedScore?
    let pick: String?
}

struct ProjectedScore: Codable, Hashable, Sendable {
    let home: Double?
    let away: Double?
}

struct PredictionPicks: Codable, Hashable, Sendable {
    let spread: PickDetail?
    let total: PickDetail?
    let moneyline: PickDetail?
}

struct PickDetail: Codable, Hashable, Sendable {
    let pick: String?
    let confidence: String?
    let line: Double?
}

struct MarketOdds: Codable, Hashable, Sendable {
    let provider: String?
    let spread: Double?
    let total: Double?
    let homeMoneyline: Int?
    let awayMoneyline: Int?
    let openingSpread: Double?
    let openingTotal: Double?
    let openingHomeMoneyline: Int?
    let openingAwayMoneyline: Int?
    let source: String?
    let deepLink: String?
}

struct Prediction: Codable, Hashable, Sendable {
    let projections: Projection?
    let picks: PredictionPicks?
    let winner: String?
    let confidence: String?
    let spread: Double?
    let total: Double?
    let winProb: Double?
    let lineStatus: String?
    let lineWarning: String?
    let moneylinePick: String?
    let moneylineWinProb: Double?
    let fairMoneyline: Int?
    let marketMoneyline: Int?
    let moneylineEdge: Double?
    let moneylineNote: String?
    let marketOdds: MarketOdds?

    init(
        projections: Projection? = nil,
        picks: PredictionPicks? = nil,
        winner: String? = nil,
        confidence: String? = nil,
        spread: Double? = nil,
        total: Double? = nil,
        winProb: Double? = nil,
        lineStatus: String? = nil,
        lineWarning: String? = nil,
        moneylinePick: String? = nil,
        moneylineWinProb: Double? = nil,
        fairMoneyline: Int? = nil,
        marketMoneyline: Int? = nil,
        moneylineEdge: Double? = nil,
        moneylineNote: String? = nil,
        marketOdds: MarketOdds? = nil
    ) {
        self.projections = projections
        self.picks = picks
        self.winner = winner
        self.confidence = confidence
        self.spread = spread
        self.total = total
        self.winProb = winProb
        self.lineStatus = lineStatus
        self.lineWarning = lineWarning
        self.moneylinePick = moneylinePick
        self.moneylineWinProb = moneylineWinProb
        self.fairMoneyline = fairMoneyline
        self.marketMoneyline = marketMoneyline
        self.moneylineEdge = moneylineEdge
        self.moneylineNote = moneylineNote
        self.marketOdds = marketOdds
    }
}

struct Insight: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let tone: String
    let title: String
    let detail: String
    let priority: Int
}

struct Explanation: Codable, Hashable, Sendable {
    let summary: String?
    let bullets: [String]?
}

struct GameIntelligence: Codable, Identifiable, Hashable, Sendable {
    var id: String { game.gameId ?? game.id }
    let game: GameInfo
    let decision: Decision
    let dataQuality: DataQuality
    let prediction: Prediction?
    let homeTeam: TeamSnapshot?
    let awayTeam: TeamSnapshot?
    let alerts: [Alert]?
    let insights: [Insight]?
    let explanation: Explanation?
}

struct IntelligenceSummary: Codable, Hashable, Sendable {
    let strongPicks: Int?
    let leans: Int?
    let pass: Int?
    let wait: Int?
    let highRisk: Int?
    let insufficient: Int?
    let alertCount: Int?
}

struct SourceHealth: Codable, Hashable, Sendable {
    let live: Bool?
    let cacheAgeSeconds: Int?
    let sources: [String: String]?
}

struct IntelligenceResponse: Codable, Sendable {
    let generatedAt: String?
    let summary: IntelligenceSummary?
    let games: [GameIntelligence]
    let alerts: [Alert]?
    let health: SourceHealth?
}

struct InjuryEntry: Codable, Identifiable, Hashable, Sendable {
    var id: String { "\(teamKey)-\(player)-\(status)" }
    let teamKey: String
    let teamName: String?
    let player: String
    let status: String
    let note: String?
}

struct InjuriesResponse: Codable, Sendable {
    let injuries: [InjuryEntry]
    let lastUpdated: String?
}

struct MatchupRequest: Codable, Sendable {
    let homeKey: String
    let awayKey: String
    let date: String?
}

struct MatchupResponse: Codable, Sendable {
    let game: GameIntelligence?
    let generatedAt: String?
}

struct WhatIfRequest: Codable, Sendable {
    let homeKey: String
    let awayKey: String
    let date: String?
    let scenario: WhatIfScenarioRequest?
    let spread: Double?
}

struct WhatIfScenarioRequest: Codable, Sendable {
    let setPlayerStatus: [PlayerStatusOverride]
}

struct PlayerStatusOverride: Codable, Sendable {
    let player: String
    let status: String
}

struct WhatIfResponse: Codable, Sendable {
    let baseline: WhatIfOutcome
    let original: WhatIfOutcome?
    let scenario: WhatIfOutcome?
    let adjusted: WhatIfOutcome?
    let scenarios: [WhatIfScenarioResult]?
    let summary: String?
}

struct WhatIfScenarioResult: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let label: String?
    let assumption: String?
    let outcome: WhatIfOutcome
}

struct WhatIfOutcome: Codable, Hashable, Sendable {
    let decision: DecisionType
    let edgeScore: Int
    let confidence: Int?
    let grade: String?
    let risk: String?

    var confidenceLabel: String {
        confidence.map { "\($0)%" } ?? "—"
    }
}
