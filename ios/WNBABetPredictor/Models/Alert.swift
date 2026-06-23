import Foundation

enum AlertSeverity: String, Codable, Sendable {
    case critical
    case warning
    case info

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let raw = try container.decode(String.self).lowercased()
        self = AlertSeverity(rawValue: raw) ?? .info
    }
}

struct Alert: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let gameId: String?
    let severity: AlertSeverity
    let code: String
    let title: String
    let message: String
    let timestamp: String?

    enum CodingKeys: String, CodingKey {
        case id
        case gameId
        case severity
        case code
        case title
        case message
        case timestamp
    }
}

struct AlertsResponse: Codable, Sendable {
    let alerts: [Alert]
    let generatedAt: String?
}
