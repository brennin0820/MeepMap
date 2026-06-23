import SwiftUI

struct AlertsView: View {
    let alerts: [Alert]

    var body: some View {
        List {
            if alerts.isEmpty {
                ContentUnavailableView(
                    "No Alerts",
                    systemImage: "bell.slash",
                    description: Text("All clear — no active warnings.")
                )
                .listRowBackground(Color.clear)
            } else {
                ForEach(sortedAlerts) { alert in
                    AlertRow(alert: alert)
                        .listRowBackground(AppTheme.surface)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(AppTheme.background)
        .navigationTitle("Alerts")
    }

    private var sortedAlerts: [Alert] {
        alerts.sorted { severityRank($0.severity) < severityRank($1.severity) }
    }

    private func severityRank(_ severity: AlertSeverity) -> Int {
        switch severity {
        case .critical: return 0
        case .warning: return 1
        case .info: return 2
        }
    }
}

struct AlertRow: View {
    let alert: Alert

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: iconName)
                .foregroundStyle(iconColor)
                .font(.title3)
            VStack(alignment: .leading, spacing: 4) {
                Text(alert.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                Text(alert.message)
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                if let code = alert.code.isEmpty ? nil : alert.code {
                    Text(code)
                        .font(.caption2.monospaced())
                        .foregroundStyle(AppTheme.textSecondary.opacity(0.7))
                }
            }
        }
        .padding(.vertical, 4)
    }

    private var iconName: String {
        switch alert.severity {
        case .critical: return "exclamationmark.octagon.fill"
        case .warning: return "exclamationmark.triangle.fill"
        case .info: return "info.circle.fill"
        }
    }

    private var iconColor: Color {
        switch alert.severity {
        case .critical: return AppTheme.danger
        case .warning: return AppTheme.warning
        case .info: return AppTheme.accentSecondary
        }
    }
}
