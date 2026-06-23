import SwiftUI

enum AppTheme {
    static let background = Color(red: 0.06, green: 0.07, blue: 0.10)
    static let surface = Color(red: 0.11, green: 0.12, blue: 0.16)
    static let surfaceElevated = Color(red: 0.15, green: 0.16, blue: 0.21)
    static let border = Color.white.opacity(0.08)
    static let textPrimary = Color.white
    static let textSecondary = Color.white.opacity(0.65)
    static let accent = Color(red: 0.95, green: 0.45, blue: 0.55)
    static let accentSecondary = Color(red: 0.45, green: 0.75, blue: 1.0)
    static let success = Color(red: 0.35, green: 0.85, blue: 0.55)
    static let warning = Color(red: 1.0, green: 0.75, blue: 0.25)
    static let danger = Color(red: 1.0, green: 0.35, blue: 0.35)

    static func decisionColor(_ type: DecisionType) -> Color {
        switch type {
        case .strongPick: return success
        case .lean: return accentSecondary
        case .pass: return textSecondary
        case .waitForLineup: return warning
        case .insufficientData: return danger.opacity(0.7)
        case .highRiskOnly: return danger
        }
    }

    static func gradeColor(_ grade: QualityGrade) -> Color {
        switch grade {
        case .a: return success
        case .b: return accentSecondary
        case .c: return warning
        case .d, .f: return danger
        }
    }

    static func riskColor(_ risk: String) -> Color {
        switch risk.lowercased() {
        case "low": return success
        case "medium": return warning
        case "high", "extreme": return danger
        default: return textSecondary
        }
    }
}

struct CardModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding()
            .background(AppTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(AppTheme.border, lineWidth: 1)
            )
    }
}

extension View {
    func cardStyle() -> some View {
        modifier(CardModifier())
    }
}
