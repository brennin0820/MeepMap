import Foundation

enum MockDataProvider {
    static let intelligenceResponse = IntelligenceResponse(
        generatedAt: ISO8601DateFormatter().string(from: Date()),
        summary: IntelligenceSummary(
            strongPicks: 1,
            leans: 0,
            pass: 1,
            wait: 1,
            highRisk: 1,
            insufficient: 0,
            alertCount: 2
        ),
        games: sampleGames,
        alerts: sampleAlerts,
        health: SourceHealth(live: false, cacheAgeSeconds: 120, sources: ["espn": "cached", "injuries": "partial", "odds": "mock"])
    )

    static let injuriesResponse = InjuriesResponse(
        injuries: [
            InjuryEntry(teamKey: "las", teamName: "Las Vegas Aces", player: "A'ja Wilson", status: "Probable", note: "Ankle"),
            InjuryEntry(teamKey: "min", teamName: "Minnesota Lynx", player: "Napheesa Collier", status: "Questionable", note: "Knee"),
            InjuryEntry(teamKey: "ind", teamName: "Indiana Fever", player: "Caitlin Clark", status: "Out", note: "Ankle"),
        ],
        lastUpdated: ISO8601DateFormatter().string(from: Date())
    )

    private static let sampleGames: [GameIntelligence] = [
        GameIntelligence(
            game: GameInfo(
                gameId: "401760001",
                date: "2026-06-22",
                time: "8:00 PM ET",
                homeKey: "min",
                awayKey: "las",
                homeName: "Minnesota Lynx",
                awayName: "Las Vegas Aces",
                status: "scheduled",
                dateValid: true
            ),
            decision: Decision(
                decision: .strongPick,
                confidence: "High",
                risk: "low",
                edgeScore: 78,
                action: "Lean Minnesota Lynx -5.5",
                reasonCodes: ["NET_RATING_EDGE", "LINEUP_CONFIRMED"],
                humanReasons: ["Clear net-rating edge with confirmed lineups."]
            ),
            dataQuality: DataQuality(
                score: 91,
                grade: .a,
                confidenceCap: 92,
                reasonCodes: ["TEAM_STATS_PRESENT", "LINEUP_CONFIRMED"],
                flags: DataQualityFlags(
                    hasHomeStats: true,
                    hasAwayStats: true,
                    lineupConfirmed: true,
                    hasOdds: true,
                    hasInjuries: true,
                    hasModelProjection: true,
                    sampleSizeAdequate: true,
                    isStale: false
                ),
                isSafeToPredict: true
            ),
            prediction: Prediction(
                projections: Projection(
                    homeWinProb: 0.68,
                    projectedMargin: -5.5,
                    projectedTotal: 165.0,
                    projectedScore: ProjectedScore(home: 84.5, away: 79.0),
                    pick: "MIN"
                ),
                picks: nil,
                winner: "Minnesota Lynx",
                confidence: "High",
                spread: -5.5,
                total: 165.0,
                winProb: 0.68,
                lineStatus: "mock",
                lineWarning: "Sample projection only.",
                moneylinePick: "Minnesota Lynx ML",
                moneylineWinProb: 0.68,
                fairMoneyline: -213,
                marketMoneyline: -165,
                moneylineEdge: 0.057,
                moneylineNote: "Sample fair line only.",
                marketOdds: MarketOdds(
                    provider: "DraftKings",
                    spread: -5.5,
                    total: 165.0,
                    homeMoneyline: -165,
                    awayMoneyline: 140,
                    openingSpread: -4.5,
                    openingTotal: 163.5,
                    openingHomeMoneyline: -150,
                    openingAwayMoneyline: 130,
                    source: "mock",
                    deepLink: nil
                )
            ),
            homeTeam: nil,
            awayTeam: nil,
            alerts: [],
            insights: nil,
            explanation: Explanation(summary: "Lynx +6.8 net rating edge; Aces on second night of back-to-back.", bullets: nil)
        ),
        GameIntelligence(
            game: GameInfo(
                gameId: "401760002",
                date: "2026-06-22",
                time: "10:00 PM ET",
                homeKey: "ind",
                awayKey: "chi",
                homeName: "Indiana Fever",
                awayName: "Chicago Sky",
                status: "scheduled",
                dateValid: true
            ),
            decision: Decision(
                decision: .waitForLineup,
                confidence: "Low",
                risk: "medium",
                edgeScore: 55,
                action: "Wait for official lineup",
                reasonCodes: ["LINEUP_UNCONFIRMED", "INJURY_REPORT_PRESENT"],
                humanReasons: ["Star injury status unresolved."]
            ),
            dataQuality: DataQuality(
                score: 64,
                grade: .c,
                confidenceCap: 70,
                reasonCodes: ["INJURY_REPORT_PRESENT"],
                flags: nil,
                isSafeToPredict: false
            ),
            prediction: nil,
            homeTeam: nil,
            awayTeam: nil,
            alerts: [
                Alert(id: "a1", gameId: "401760002", severity: .critical, code: "INJURY", title: "Star Out", message: "Caitlin Clark listed Out.", timestamp: nil)
            ],
            insights: nil,
            explanation: nil
        ),
        GameIntelligence(
            game: GameInfo(
                gameId: "401760003",
                date: "2026-06-23",
                time: "8:30 PM ET",
                homeKey: "ny",
                awayKey: "phx",
                homeName: "New York Liberty",
                awayName: "Phoenix Mercury",
                status: "scheduled",
                dateValid: true
            ),
            decision: Decision(
                decision: .pass,
                confidence: "Medium",
                risk: "low",
                edgeScore: 42,
                action: "No actionable edge",
                reasonCodes: ["EDGE_BELOW_THRESHOLD"],
                humanReasons: ["Projected margin within noise band."]
            ),
            dataQuality: DataQuality(score: 80, grade: .b, confidenceCap: 82, reasonCodes: ["TEAM_STATS_PRESENT"], flags: nil, isSafeToPredict: true),
            prediction: nil,
            homeTeam: nil,
            awayTeam: nil,
            alerts: [],
            insights: nil,
            explanation: nil
        ),
        GameIntelligence(
            game: GameInfo(
                gameId: "401760004",
                date: "2026-06-23",
                time: "7:00 PM ET",
                homeKey: "was",
                awayKey: "dal",
                homeName: "Washington Mystics",
                awayName: "Dallas Wings",
                status: "scheduled",
                dateValid: true
            ),
            decision: Decision(
                decision: .highRiskOnly,
                confidence: "Low",
                risk: "high",
                edgeScore: 71,
                action: "High risk only — stale data",
                reasonCodes: ["TEAM_STATS_STALE"],
                humanReasons: ["Large model edge but grade D data."]
            ),
            dataQuality: DataQuality(score: 48, grade: .d, confidenceCap: 55, reasonCodes: ["TEAM_STATS_STALE"], flags: nil, isSafeToPredict: false),
            prediction: nil,
            homeTeam: nil,
            awayTeam: nil,
            alerts: [
                Alert(id: "a2", gameId: "401760004", severity: .warning, code: "DATA_QUALITY", title: "Stale Stats", message: "Washington team stats older than 48h.", timestamp: nil)
            ],
            insights: nil,
            explanation: nil
        ),
    ]

    private static let sampleAlerts: [Alert] = [
        Alert(id: "a1", gameId: "401760002", severity: .critical, code: "INJURY", title: "Star Out", message: "Caitlin Clark listed Out — Fever spread impact.", timestamp: nil),
        Alert(id: "a2", gameId: "401760004", severity: .warning, code: "DATA_QUALITY", title: "Stale Stats", message: "Washington team stats stale (>48h).", timestamp: nil),
        Alert(id: "a3", gameId: nil, severity: .info, code: "SOURCE", title: "Odds Unavailable", message: "Odds feed unavailable — edge based on model spread only.", timestamp: nil),
    ]
}
