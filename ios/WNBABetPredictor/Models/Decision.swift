import Foundation

enum DecisionType: String, Codable, CaseIterable, Sendable {
    case strongPick = "STRONG_PICK"
    case lean = "LEAN"
    case pass = "PASS"
    case waitForLineup = "WAIT_FOR_LINEUP"
    case insufficientData = "INSUFFICIENT_DATA"
    case highRiskOnly = "HIGH_RISK_ONLY"

    var displayName: String {
        switch self {
        case .strongPick: return "Strong Pick"
        case .lean: return "Lean"
        case .pass: return "Pass"
        case .waitForLineup: return "Wait for Lineup"
        case .insufficientData: return "Insufficient Data"
        case .highRiskOnly: return "High Risk Only"
        }
    }

    var shortLabel: String {
        switch self {
        case .strongPick: return "Best Bet"
        case .lean: return "Lean"
        case .pass: return "Pass"
        case .waitForLineup: return "Wait"
        case .insufficientData: return "No Data"
        case .highRiskOnly: return "Risky"
        }
    }
}

struct Decision: Codable, Hashable, Sendable {
    let decision: DecisionType
    let confidence: String
    let risk: String
    let edgeScore: Int
    let action: String
    let reasonCodes: [String]
    let humanReasons: [String]

    init(
        decision: DecisionType,
        confidence: String,
        risk: String,
        edgeScore: Int,
        action: String,
        reasonCodes: [String],
        humanReasons: [String]
    ) {
        self.decision = decision
        self.confidence = confidence
        self.risk = risk
        self.edgeScore = edgeScore
        self.action = action
        self.reasonCodes = reasonCodes
        self.humanReasons = humanReasons
    }

    init(from decoder: Decoder) throws {
        if let type = try? decoder.singleValueContainer().decode(DecisionType.self) {
            self.init(
                decision: type,
                confidence: "—",
                risk: "Medium",
                edgeScore: 0,
                action: type.displayName,
                reasonCodes: [],
                humanReasons: []
            )
            return
        }

        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decisionType: DecisionType
        if let nested = try? container.decode(DecisionType.self, forKey: .decision) {
            decisionType = nested
        } else if let raw = try? container.decode(String.self, forKey: .decision) {
            decisionType = DecisionType(rawValue: raw) ?? .pass
        } else {
            decisionType = .pass
        }

    let confidenceValue: String
    if let stringConf = try? container.decode(String.self, forKey: .confidence) {
      confidenceValue = stringConf
    } else if let intConf = try? container.decode(Int.self, forKey: .confidence) {
      confidenceValue = "\(intConf)%"
    } else {
      confidenceValue = "—"
    }

    self.init(
      decision: decisionType,
      confidence: confidenceValue,
      risk: try container.decodeIfPresent(String.self, forKey: .risk) ?? "Medium",
      edgeScore: try container.decodeIfPresent(Int.self, forKey: .edgeScore) ?? 0,
      action: try container.decodeIfPresent(String.self, forKey: .action) ?? decisionType.displayName,
      reasonCodes: try container.decodeIfPresent([String].self, forKey: .reasonCodes) ?? [],
      humanReasons: try container.decodeIfPresent([String].self, forKey: .humanReasons) ?? []
    )
  }

  private enum CodingKeys: String, CodingKey {
    case decision, confidence, risk, edgeScore, action, reasonCodes, humanReasons
  }
}
