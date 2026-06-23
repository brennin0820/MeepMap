import SwiftUI

struct ResponsibleBettingDisclaimer: View {
    var compact = false

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.shield.fill")
                .foregroundStyle(AppTheme.warning)
                .font(compact ? .caption : .body)
            Text(
                compact
                ? "For entertainment & research only. Never bet more than you can afford to lose."
                : "This app provides analytical decision support — not financial advice. Wager responsibly, verify all lines independently, and never bet more than you can afford to lose. If gambling is a problem, call 1-800-GAMBLER."
            )
            .font(compact ? .caption2 : .caption)
            .foregroundStyle(AppTheme.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(compact ? 10 : 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppTheme.surfaceElevated.opacity(0.8))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(AppTheme.warning.opacity(0.35), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Responsible betting disclaimer")
    }
}
