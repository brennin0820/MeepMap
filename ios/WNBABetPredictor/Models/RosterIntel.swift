import Foundation

enum IntelSourceKind: String, Codable, CaseIterable, Sendable {
    case database = "Database"
    case official = "Official"
    case transactions = "Transactions"
    case news = "News"
    case social = "Social"
    case regulatory = "Regulatory"
}

enum IntelVerificationStatus: String, Codable, Sendable {
    case verified = "Verified"
    case crossReferenced = "Cross-referenced"
    case singleSource = "Single source"
    case unavailable = "Unavailable"
}

struct RosterIntelEvidence: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let kind: IntelSourceKind
    let sourceName: String
    let title: String
    let summary: String
    let url: String?
    let publishedAt: String?
    let confidence: Int
    let verification: IntelVerificationStatus
}

struct RosterIntelFinding: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let title: String
    let narrative: String
    let confidence: Int
    let verification: IntelVerificationStatus
    let sourceKinds: [IntelSourceKind]
}

struct RosterIntelCoverage: Codable, Hashable, Sendable {
    let kind: IntelSourceKind
    let status: IntelVerificationStatus
    let count: Int
    let note: String
}

struct TeamRosterDossier: Codable, Hashable, Sendable {
    let teamKey: String
    let teamName: String
    let generatedAt: String
    let summary: String
    let confidence: Int
    let verification: IntelVerificationStatus
    let findings: [RosterIntelFinding]
    let evidence: [RosterIntelEvidence]
    let coverage: [RosterIntelCoverage]
    let gaps: [String]
}
