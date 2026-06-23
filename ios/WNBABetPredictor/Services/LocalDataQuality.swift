import Foundation

enum LocalDataQuality {
    static let confidenceCaps: [QualityGrade: Int] = [
        .a: 92, .b: 82, .c: 70, .d: 55, .f: 40
    ]

    private static let staleInterval: TimeInterval = 48 * 60 * 60
    private static let minSampleGames = 8

    static func scoreToGrade(_ score: Int) -> QualityGrade {
        let s = max(0, min(100, score))
        if s >= 90 { return .a }
        if s >= 75 { return .b }
        if s >= 60 { return .c }
        if s >= 45 { return .d }
        return .f
    }

    static func hasTeamStats(_ team: LocalTeam?) -> Bool {
        guard let team else { return false }
        return team.netRating != nil && team.offRating != nil && team.defRating != nil
    }

    struct ModelProjection: Sendable {
        var spreadEdge: Double?
        var winProb: Double?
        var projectedMargin: Double?
        var projectedTotal: Double?
    }

    struct AssessInput: Sendable {
        var game: LocalGameContext?
        var homeTeam: LocalTeam?
        var awayTeam: LocalTeam?
        var lineupConfirmed: Bool?
        var odds: LocalOdds?
        var injuries: LocalInjurySplit?
        var modelProjection: ModelProjection?
        var predictionEnabled: Bool?
        var sampleSize: Int?
        var sourceDegraded: Bool
        var metaWarning: String?
    }

    static func splitInjuries(_ entries: [InjuryEntry], homeKey: String, awayKey: String) -> LocalInjurySplit {
        let hk = homeKey.lowercased()
        let ak = awayKey.lowercased()
        let home = entries
            .filter { $0.teamKey.lowercased() == hk }
            .map { LocalInjuryPlayer(name: $0.player, status: $0.status, impact: inferInjuryImpact($0.status)) }
        let away = entries
            .filter { $0.teamKey.lowercased() == ak }
            .map { LocalInjuryPlayer(name: $0.player, status: $0.status, impact: inferInjuryImpact($0.status)) }
        return LocalInjurySplit(home: home, away: away)
    }

    private static func inferInjuryImpact(_ status: String) -> String {
        let s = status.lowercased()
        if s.contains("out") || s.contains("doubt") { return "high" }
        if s.contains("question") || s.contains("day") { return "medium" }
        return "low"
    }

    static func assess(_ input: AssessInput) -> DataQuality {
        var reasonCodes: [String] = []
        var warnings: [String] = []
        var score = 0

        let homeOk = hasTeamStats(input.homeTeam)
        let awayOk = hasTeamStats(input.awayTeam)

        if homeOk && awayOk {
            score += 30
            reasonCodes.append("TEAM_STATS_PRESENT")
        } else {
            reasonCodes.append("TEAM_STATS_MISSING")
            warnings.append("Team efficiency stats missing for one or both teams.")
        }

        var lineupConfirmed = false
        if input.lineupConfirmed == true {
            score += 25
            lineupConfirmed = true
            reasonCodes.append("LINEUP_CONFIRMED")
        } else if input.lineupConfirmed == false {
            score += 5
            reasonCodes.append("LINEUP_UNCONFIRMED")
            warnings.append("Starting lineup explicitly unconfirmed.")
        } else {
            reasonCodes.append("LINEUP_UNKNOWN")
        }

        let hasOdds = input.odds.map {
            $0.spread != nil || $0.total != nil || $0.moneyline != nil
        } ?? false
        if hasOdds {
            score += 15
            reasonCodes.append("ODDS_PRESENT")
        } else {
            reasonCodes.append("ODDS_MISSING")
        }

        let injuryCount = (input.injuries?.home.count ?? 0) + (input.injuries?.away.count ?? 0)
        let hasInjuries = injuryCount > 0
        if hasInjuries {
            score += 10
            reasonCodes.append("INJURY_REPORT_PRESENT")
        } else {
            reasonCodes.append("INJURY_REPORT_MISSING")
        }

        let proj = input.modelProjection
        let hasModel = proj.map {
            $0.spreadEdge != nil || $0.winProb != nil || $0.projectedMargin != nil
        } ?? false
        if hasModel {
            score += 15
            reasonCodes.append("MODEL_PROJECTION_PRESENT")
        } else {
            reasonCodes.append("MODEL_PROJECTION_MISSING")
            warnings.append("Model projection unavailable — decision edge limited.")
        }

        let sampleSize = input.sampleSize ?? min(
            (input.homeTeam?.wins ?? 0) + (input.homeTeam?.losses ?? 0),
            (input.awayTeam?.wins ?? 0) + (input.awayTeam?.losses ?? 0)
        )
        let sampleSizeAdequate = sampleSize >= minSampleGames
        if sampleSizeAdequate {
            score += 5
            reasonCodes.append("SAMPLE_SIZE_ADEQUATE")
        } else {
            reasonCodes.append("SAMPLE_SIZE_LOW")
            warnings.append("Sample size below \(minSampleGames) games — early-season caution.")
        }

        if input.game?.dateValid == false {
            score = max(0, score - 10)
            reasonCodes.append("DATE_INVALID")
            warnings.append("Game date invalid or missing.")
        }

        if input.sourceDegraded {
            score = max(0, score - 10)
            reasonCodes.append("SOURCE_DEGRADED")
            warnings.append(input.metaWarning ?? "One or more live data sources degraded — verify before wagering.")
        }

        score = max(0, min(100, score))
        let grade = scoreToGrade(score)
        let confidenceCap = confidenceCaps[grade] ?? 40

        return DataQuality(
            score: score,
            grade: grade,
            confidenceCap: confidenceCap,
            reasonCodes: Array(Set(reasonCodes)),
            flags: DataQualityFlags(
                hasHomeStats: homeOk,
                hasAwayStats: awayOk,
                lineupConfirmed: lineupConfirmed,
                hasOdds: hasOdds,
                hasInjuries: hasInjuries,
                hasModelProjection: hasModel,
                sampleSizeAdequate: sampleSizeAdequate,
                isStale: false
            ),
            isSafeToPredict: score >= 60 && homeOk && awayOk
        )
    }
}

struct LocalGameContext: Sendable {
    var id: String?
    var homeKey: String
    var awayKey: String
    var homeName: String?
    var awayName: String?
    var date: String?
    var status: String?
    var dateValid: Bool
}

struct LocalOdds: Sendable {
    var spread: Double?
    var total: Double?
    var moneyline: [String: Double]?
}

struct LocalInjurySplit: Sendable {
    var home: [LocalInjuryPlayer]
    var away: [LocalInjuryPlayer]
}

struct LocalInjuryPlayer: Sendable {
    var name: String
    var status: String
    var impact: String?
}
