import Foundation

enum QualityGrade: String, Codable, CaseIterable, Sendable {
    case a = "A"
    case b = "B"
    case c = "C"
    case d = "D"
    case f = "F"

    var displayName: String { rawValue }
}

struct DataQualityFlags: Codable, Hashable, Sendable {
    let hasHomeStats: Bool?
    let hasAwayStats: Bool?
    let lineupConfirmed: Bool?
    let hasOdds: Bool?
    let hasInjuries: Bool?
    let hasModelProjection: Bool?
    let sampleSizeAdequate: Bool?
    let isStale: Bool?
}

struct DataQuality: Codable, Hashable, Sendable {
    let score: Int
    let grade: QualityGrade
    let confidenceCap: Int
    let reasonCodes: [String]
    let flags: DataQualityFlags?
    let isSafeToPredict: Bool?

    var gradeLabel: String { "Grade \(grade.displayName)" }
}
