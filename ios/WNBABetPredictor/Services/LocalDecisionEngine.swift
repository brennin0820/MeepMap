import Foundation

enum LocalDecisionEngine {
  static func computeHomeSpreadEdge(projectedMargin: Double?, marketSpread: Double?) -> Double? {
    guard let projectedMargin, let marketSpread else { return nil }
    return ((projectedMargin + marketSpread) * 10).rounded() / 10
  }

  static func parseLast5WinRate(_ last5: String?) -> Double? {
    guard let last5 else { return nil }
    let parts = last5.trimmingCharacters(in: .whitespaces).split(separator: "-")
    guard parts.count == 2,
          let wins = Int(parts[0]),
          let losses = Int(parts[1]),
          wins + losses > 0 else { return nil }
    return Double(wins) / Double(wins + losses)
  }

  struct EdgeResult: Sendable {
    var edgeScore: Int
    var grade: QualityGrade
    var reasonCodes: [String]
  }

  struct DecideResult: Sendable {
    var decision: DecisionType
    var edgeScore: Int
    var grade: QualityGrade
    var confidence: Int
    var confidenceCap: Int
    var risk: String
    var action: String
    var reasonCodes: [String]
  }

  struct DecideInput: Sendable {
    var homeTeam: LocalTeam?
    var awayTeam: LocalTeam?
    var homeKey: String?
    var awayKey: String?
    var modelProjection: LocalDataQuality.ModelProjection?
    var odds: LocalOdds?
    var dataQuality: DataQuality
    var predictionEnabled: Bool
    var lineupConfirmed: Bool?
    var injuries: LocalInjurySplit?
    var fatigue: LocalFatigueResult?
  }

  static func computeEdgeScore(_ input: DecideInput) -> EdgeResult {
    var reasonCodes: [String] = []
    var raw = 0.0
    var weightSum = 0.0

    if !input.predictionEnabled {
      reasonCodes.append("PREDICTION_DISABLED")
    }

    if let home = input.homeTeam, let away = input.awayTeam,
       let homeNet = home.netRating, let awayNet = away.netRating {
      let netDiff = abs(homeNet - awayNet)
      let netComponent = min(100.0, netDiff * 4)
      raw += netComponent * 0.35
      weightSum += 0.35
      if netDiff >= 6 { reasonCodes.append("NET_RATING_EDGE") }
    }

    if let proj = input.modelProjection {
      if let spreadEdge = proj.spreadEdge ?? computeHomeSpreadEdge(
        projectedMargin: proj.projectedMargin,
        marketSpread: input.odds?.spread
      ) {
        let spreadComponent = min(100.0, abs(spreadEdge) * 12)
        raw += spreadComponent * 0.3
        weightSum += 0.3
        reasonCodes.append("MODEL_SPREAD_EDGE")
      } else if let winProb = proj.winProb {
        let probEdge = abs(winProb - 0.5) * 200
        raw += min(100.0, probEdge) * 0.25
        weightSum += 0.25
        reasonCodes.append("MODEL_WIN_PROB_EDGE")
      } else if let margin = proj.projectedMargin {
        let marginComponent = min(100.0, abs(margin) * 8)
        raw += marginComponent * 0.2
        weightSum += 0.2
      }
    }

    let homeForm = parseLast5WinRate(input.homeTeam?.last5)
    let awayForm = parseLast5WinRate(input.awayTeam?.last5)
    if let homeForm, let awayForm {
      let formDiff = abs(homeForm - awayForm)
      raw += min(100.0, formDiff * 200) * 0.15
      weightSum += 0.15
      if formDiff >= 0.3 { reasonCodes.append("RECENT_FORM_EDGE") }
    }

    if input.homeKey != nil || input.awayKey != nil {
      raw += 8 * 0.1
      weightSum += 0.1
      reasonCodes.append("HOME_COURT_ADVANTAGE")
    }

    if let fatigue = input.fatigue {
      let homePenalty = fatigue.home.fatiguePenalty
      let awayPenalty = fatigue.away.fatiguePenalty
      let fatigueDiff = abs(homePenalty - awayPenalty)
      if fatigueDiff >= 1.5 {
        raw += min(100.0, fatigueDiff * 15) * 0.05
        weightSum += 0.05
        reasonCodes.append("FATIGUE_EDGE")
      }
    }

    let hasOddsLine = input.odds?.spread != nil || input.odds?.total != nil
    if !hasOddsLine {
      reasonCodes.append("ODDS_MISSING_LIMITS_EDGE")
    }

    let questionable = (input.injuries?.home ?? []) + (input.injuries?.away ?? [])
    let hasQuestionable = questionable.contains { player in
      let s = player.status.lowercased()
      return s.contains("question") || s.contains("doubt")
    }
    if hasQuestionable {
      raw *= 0.85
      reasonCodes.append("KEY_INJURY_UNCERTAINTY")
    }

    if input.dataQuality.flags?.sampleSizeAdequate == false {
      raw *= 0.9
      reasonCodes.append("SAMPLE_SIZE_PENALTY")
    }

    var edgeScore = weightSum > 0 ? Int((raw / weightSum).rounded()) : 0
    edgeScore = max(0, min(100, edgeScore))

    if edgeScore >= 72 { reasonCodes.append("STRONG_COMPOSITE_EDGE") }
    else if edgeScore >= 55 { reasonCodes.append("MODERATE_EDGE") }
    else { reasonCodes.append("NO_ACTIONABLE_EDGE") }

    if let home = input.homeTeam, let away = input.awayTeam,
       let homePace = home.pace, let awayPace = away.pace,
       abs(homePace - awayPace) > 4, edgeScore >= 50 {
      reasonCodes.append("HIGH_VARIANCE_MATCHUP")
    }

    return EdgeResult(
      edgeScore: edgeScore,
      grade: LocalDataQuality.scoreToGrade(edgeScore),
      reasonCodes: Array(Set(reasonCodes))
    )
  }

  static func decide(_ input: DecideInput) -> DecideResult {
    let flags = input.dataQuality.flags
    let dqCap = input.dataQuality.confidenceCap

    if flags?.hasHomeStats != true || flags?.hasAwayStats != true {
      return DecideResult(
        decision: .insufficientData,
        edgeScore: 0,
        grade: .f,
        confidence: 0,
        confidenceCap: dqCap,
        risk: "Extreme",
        action: deriveAction(.insufficientData),
        reasonCodes: ["INSUFFICIENT_TEAM_DATA"]
      )
    }

    if input.lineupConfirmed == false, flags?.lineupConfirmed != true {
      let edge = computeEdgeScore(input)
      let cap = min(dqCap, LocalDataQuality.confidenceCaps[.d] ?? 55, 35)
      return DecideResult(
        decision: .waitForLineup,
        edgeScore: edge.edgeScore,
        grade: edge.grade,
        confidence: cap,
        confidenceCap: dqCap,
        risk: "Medium",
        action: deriveAction(.waitForLineup),
        reasonCodes: Array(Set(edge.reasonCodes + ["LINEUP_UNCONFIRMED_BLOCK"]))
      )
    }

    let edge = computeEdgeScore(input)
    var reasonCodes = edge.reasonCodes
    let edgeCap = LocalDataQuality.confidenceCaps[edge.grade] ?? 40
    let rawConfidence = Int((Double(edge.edgeScore) * 0.6 + Double(input.dataQuality.score) * 0.4).rounded())
    let confidence = min(rawConfidence, dqCap, edgeCap)

    let decision: DecisionType
    if input.dataQuality.score < 45 || !input.predictionEnabled {
      decision = .insufficientData
      if !input.predictionEnabled { reasonCodes.append("PREDICTION_DISABLED") }
    } else if reasonCodes.contains("HIGH_VARIANCE_MATCHUP") && edge.edgeScore >= 55 && edge.edgeScore < 72 {
      decision = .highRiskOnly
    } else if edge.edgeScore >= 72 && confidence >= 65 {
      decision = .strongPick
    } else if edge.edgeScore >= 55 && confidence >= 45 {
      decision = .lean
    } else {
      decision = .pass
    }

    let finalConfidence = decision == .insufficientData ? min(confidence, 30) : confidence

    return DecideResult(
      decision: decision,
      edgeScore: edge.edgeScore,
      grade: edge.grade,
      confidence: finalConfidence,
      confidenceCap: dqCap,
      risk: deriveRisk(decision, edgeScore: edge.edgeScore),
      action: deriveAction(decision),
      reasonCodes: Array(Set(reasonCodes))
    )
  }

  static func deriveRisk(_ decision: DecisionType, edgeScore: Int) -> String {
    switch decision {
    case .highRiskOnly: return "High"
    case .insufficientData: return "Extreme"
    case .waitForLineup: return "Medium"
    default:
      if edgeScore >= 72 { return "Low" }
      if edgeScore >= 55 { return "Medium" }
      return "High"
    }
  }

  static func deriveAction(_ decision: DecisionType) -> String {
    switch decision {
    case .strongPick: return "Bet with standard unit sizing after line check."
    case .lean: return "Small unit only — confirm lineups and injury news."
    case .pass: return "No bet — edge or data quality insufficient."
    case .waitForLineup: return "Hold until starting lineups are official."
    case .insufficientData: return "Do not wager — required inputs missing."
    case .highRiskOnly: return "Reduced stake only — high variance matchup."
    }
  }

  private static let reasonText: [String: String] = [
    "NET_RATING_EDGE": "Net rating favors one side",
    "MODEL_SPREAD_EDGE": "Model spread edge vs market",
    "MODEL_WIN_PROB_EDGE": "Win probability edge",
    "HOME_COURT_ADVANTAGE": "Home court advantage",
    "RECENT_FORM_EDGE": "Recent form edge",
    "STRONG_COMPOSITE_EDGE": "Strong composite edge",
    "MODERATE_EDGE": "Moderate edge",
    "NO_ACTIONABLE_EDGE": "No actionable edge",
    "HIGH_VARIANCE_MATCHUP": "High variance matchup",
    "KEY_INJURY_UNCERTAINTY": "Injury uncertainty",
    "ODDS_MISSING_LIMITS_EDGE": "Odds unavailable limits edge",
    "INSUFFICIENT_TEAM_DATA": "Insufficient team data",
    "LINEUP_UNCONFIRMED_BLOCK": "Lineup unconfirmed",
  ]

  static func humanReasons(from codes: [String]) -> [String] {
    codes.compactMap { reasonText[$0] }.prefix(5).map { String($0) }
  }
}
