import SwiftUI

enum AppTheme {
    // MARK: - Base palette
    static let background = Color(red: 0.05, green: 0.06, blue: 0.09)
    static let backgroundRaised = Color(red: 0.08, green: 0.09, blue: 0.13)
    static let surface = Color(red: 0.11, green: 0.12, blue: 0.16)
    static let surfaceElevated = Color(red: 0.16, green: 0.17, blue: 0.22)
    static let border = Color.white.opacity(0.08)
    static let borderStrong = Color.white.opacity(0.16)
    static let textPrimary = Color.white
    static let textSecondary = Color.white.opacity(0.66)
    static let textTertiary = Color.white.opacity(0.42)

    static let accent = Color(red: 0.96, green: 0.41, blue: 0.53)
    static let accentDeep = Color(red: 0.84, green: 0.28, blue: 0.52)
    static let accentSecondary = Color(red: 0.44, green: 0.73, blue: 1.0)
    static let success = Color(red: 0.36, green: 0.86, blue: 0.56)
    static let warning = Color(red: 1.0, green: 0.76, blue: 0.27)
    static let danger = Color(red: 1.0, green: 0.38, blue: 0.40)

    // MARK: - Gradients
    static var appBackgroundGradient: LinearGradient {
        LinearGradient(
            colors: [
                Color(red: 0.09, green: 0.06, blue: 0.13),
                background,
                Color(red: 0.04, green: 0.05, blue: 0.08)
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    static var cardGradient: LinearGradient {
        LinearGradient(
            colors: [surfaceElevated.opacity(0.92), surface],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    static var accentGradient: LinearGradient {
        LinearGradient(
            colors: [accent, accentDeep],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    static var accentSecondaryGradient: LinearGradient {
        LinearGradient(
            colors: [accentSecondary, Color(red: 0.30, green: 0.52, blue: 0.92)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    static func tileGlow(_ color: Color) -> LinearGradient {
        LinearGradient(
            colors: [color.opacity(0.22), color.opacity(0.04)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    static let cardShadow = Color.black.opacity(0.35)

    // MARK: - Semantic color helpers
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

// MARK: - Card surface

struct CardModifier: ViewModifier {
    var padding: CGFloat = 16
    var cornerRadius: CGFloat = 18

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(AppTheme.cardGradient, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(AppTheme.border, lineWidth: 1)
            )
            .shadow(color: AppTheme.cardShadow, radius: 10, x: 0, y: 5)
    }
}

extension View {
    func cardStyle() -> some View {
        modifier(CardModifier())
    }

    func cardStyle(padding: CGFloat, cornerRadius: CGFloat = 18) -> some View {
        modifier(CardModifier(padding: padding, cornerRadius: cornerRadius))
    }
}

// MARK: - Screen background

struct AppBackgroundModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background {
                AppTheme.appBackgroundGradient.ignoresSafeArea()
            }
    }
}

extension View {
    /// Shared dark, subtly-graded backdrop used across primary screens.
    func appBackground() -> some View {
        modifier(AppBackgroundModifier())
    }
}

// MARK: - Reusable building blocks

struct SectionHeader: View {
    let title: String
    var systemImage: String?
    var trailing: String?

    init(_ title: String, systemImage: String? = nil, trailing: String? = nil) {
        self.title = title
        self.systemImage = systemImage
        self.trailing = trailing
    }

    var body: some View {
        HStack(spacing: 8) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(AppTheme.accent)
            }
            Text(title)
                .font(.headline)
                .foregroundStyle(AppTheme.textPrimary)
            Spacer(minLength: 8)
            if let trailing {
                Text(trailing)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AppTheme.textSecondary)
            }
        }
    }
}

/// Compact, scannable metric tile with a tinted glow edge.
struct StatTile: View {
    let title: String
    let value: String
    var color: Color = AppTheme.accent
    var systemImage: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(color)
                }
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AppTheme.textSecondary)
            }
            Text(value)
                .font(.title2.weight(.bold).monospacedDigit())
                .foregroundStyle(color)
                .contentTransition(.numericText())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(AppTheme.tileGlow(color), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(color.opacity(0.35), lineWidth: 1)
        )
    }
}

struct PrimaryActionButtonStyle: ButtonStyle {
    var gradient: LinearGradient = AppTheme.accentGradient

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 15)
            .foregroundStyle(.white)
            .background(gradient, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Color.white.opacity(0.12), lineWidth: 1)
            )
            .shadow(color: AppTheme.cardShadow, radius: 8, x: 0, y: 4)
            .opacity(configuration.isPressed ? 0.86 : 1)
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}
