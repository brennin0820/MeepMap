import SwiftUI

struct IntelligenceDashboardView: View {
    @Bindable var store: IntelligenceStore
    @State private var accuracy: AccuracySummary?

    private let priorityDecisions: [DecisionType] = [
        .strongPick, .lean, .pass, .waitForLineup, .highRiskOnly, .insufficientData
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ResponsibleBettingDisclaimer(compact: true)

                if store.isLoading && store.response == nil {
                    ProgressView("Loading intelligence…")
                        .frame(maxWidth: .infinity, minHeight: 200)
                } else if let error = store.errorMessage, store.games.isEmpty {
                    errorCard(error)
                } else {
                    if let warning = store.errorMessage {
                        offlineBanner(warning)
                    }
                    summarySection
                    dailyReadSection
                    accuracySection
                    alertsPreview
                    decisionSections
                }
            }
            .padding()
        }
        .background(AppTheme.background)
        .navigationTitle("Command Center")
        .refreshable { await store.refresh() }
        .task {
            await store.refresh()
            accuracy = try? await store.client.fetchAccuracy()
        }
    }

    @ViewBuilder
    private var dailyReadSection: some View {
        if !store.games.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Label("Daily Read", systemImage: "scope")
                        .font(.headline)
                    Spacer()
                    Text("\(store.games.count) games")
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)
                }

                if let best = firstGame(for: .strongPick) ?? firstGame(for: .lean) {
                    dailyReadRow(
                        title: "Top action",
                        game: best,
                        icon: "checkmark.seal.fill",
                        color: AppTheme.success
                    )
                }

                if let wait = firstGame(for: .waitForLineup) {
                    dailyReadRow(
                        title: "Lineup watch",
                        game: wait,
                        icon: "clock.badge.exclamationmark",
                        color: AppTheme.warning
                    )
                }

                if let risk = store.games.first(where: { $0.decision.decision == .highRiskOnly || $0.decision.risk.lowercased().contains("high") }) {
                    dailyReadRow(
                        title: "Risk flag",
                        game: risk,
                        icon: "exclamationmark.triangle.fill",
                        color: AppTheme.danger
                    )
                }
            }
            .cardStyle()
        }
    }

    @ViewBuilder
    private var accuracySection: some View {
        if let accuracy {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Model Accuracy")
                        .font(.headline)
                    Spacer()
                    if let score = accuracy.localScore {
                        Text("Score \(score)")
                            .font(.headline.monospacedDigit())
                            .foregroundStyle(score >= 60 ? AppTheme.success : AppTheme.warning)
                    }
                }

                HStack {
                    accuracyMetric("Moneyline", accuracy.moneylineAccuracy.map { String(format: "%.0f%%", $0) } ?? "—")
                    Spacer()
                    accuracyMetric("Spread", accuracy.spreadAccuracy.map { String(format: "%.0f%%", $0) } ?? "—")
                    Spacer()
                    accuracyMetric("CLV", accuracy.beatClosingRate.map { String(format: "%.0f%%", $0) } ?? "—")
                    Spacer()
                    accuracyMetric("High conf.", accuracy.highConfidenceAccuracy.map { String(format: "%.0f%%", $0) } ?? "—")
                    Spacer()
                    accuracyMetric("Graded", "\(accuracy.completedGames ?? 0)")
                }

                HStack {
                    accuracyMetric("Brier", accuracy.brierScore.map { String(format: "%.3f", $0) } ?? "—")
                    Spacer()
                    accuracyMetric("Log loss", accuracy.logLoss.map { String(format: "%.3f", $0) } ?? "—")
                    Spacer()
                    accuracyMetric("Pending", "\(accuracy.pendingPredictions ?? 0)")
                    Spacer()
                    accuracyMetric("Total", accuracy.totalAccuracy.map { String(format: "%.0f%%", $0) } ?? "—")
                }

                if let note = accuracy.note {
                    Text(note)
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)
                }
            }
            .cardStyle()
        }
    }

    private func accuracyMetric(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption)
                .foregroundStyle(AppTheme.textSecondary)
            Text(value)
                .font(.title3.weight(.bold))
                .monospacedDigit()
        }
    }

    private func firstGame(for decision: DecisionType) -> GameIntelligence? {
        store.groupedByDecision[decision]?.first
    }

    private func dailyReadRow(title: String, game: GameIntelligence, icon: String, color: Color) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .foregroundStyle(color)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AppTheme.textSecondary)
                Text(matchupTitle(for: game))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                Text(game.decision.action)
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                    .lineLimit(2)
            }
            Spacer()
            Text("\(game.decision.edgeScore)")
                .font(.caption.monospacedDigit().weight(.bold))
                .foregroundStyle(AppTheme.textPrimary)
        }
    }

    private func matchupTitle(for game: GameIntelligence) -> String {
        let home = game.game.homeName ?? game.game.homeKey.uppercased()
        let away = game.game.awayName ?? game.game.awayKey.uppercased()
        return "\(away) @ \(home)"
    }

    @ViewBuilder
    private var summarySection: some View {
        if let summary = store.response?.summary {
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                summaryTile("Best Bets", value: summary.strongPicks ?? 0, color: AppTheme.success)
                summaryTile("Lean", value: summary.leans ?? 0, color: AppTheme.accentSecondary)
                summaryTile("Pass", value: summary.pass ?? 0, color: AppTheme.textSecondary)
                summaryTile("Wait", value: summary.wait ?? 0, color: AppTheme.warning)
            }
        }

        if let health = store.response?.health {
            HStack {
                Circle()
                    .fill((health.live ?? false) ? AppTheme.success : AppTheme.warning)
                    .frame(width: 8, height: 8)
                Text((health.live ?? false) ? "Live sources connected" : "Using cached data")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                if let age = health.cacheAgeSeconds {
                    Text("· \(age)s cache")
                        .font(.caption2)
                        .foregroundStyle(AppTheme.textSecondary)
                }
            }
            .cardStyle()
        }
    }

    @ViewBuilder
    private var alertsPreview: some View {
        if !store.alerts.isEmpty {
            NavigationLink {
                AlertsView(alerts: store.alerts)
            } label: {
                HStack {
                    Image(systemName: "bell.badge.fill")
                        .foregroundStyle(AppTheme.warning)
                    Text("\(store.alerts.count) active alert\(store.alerts.count == 1 ? "" : "s")")
                        .font(.subheadline.weight(.semibold))
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)
                }
                .foregroundStyle(AppTheme.textPrimary)
                .cardStyle()
            }
        }
    }

    @ViewBuilder
    private var decisionSections: some View {
        ForEach(priorityDecisions, id: \.self) { type in
            if let items = store.groupedByDecision[type], !items.isEmpty {
                sectionHeader(type)
                ForEach(items) { game in
                    NavigationLink(value: game) {
                        GameRowView(game: game)
                    }
                    .buttonStyle(.plain)
                }
            }
        }

        if store.games.isEmpty, store.errorMessage == nil {
            Text("No games in the intelligence window.")
                .font(.subheadline)
                .foregroundStyle(AppTheme.textSecondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 40)
        }
    }

    private func sectionHeader(_ type: DecisionType) -> some View {
        HStack {
            DecisionBadge(decision: type)
            Text("\(store.groupedByDecision[type]?.count ?? 0) games")
                .font(.caption)
                .foregroundStyle(AppTheme.textSecondary)
        }
        .padding(.top, 8)
    }

    private func summaryTile(_ title: String, value: Int, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.caption)
                .foregroundStyle(AppTheme.textSecondary)
            Text("\(value)")
                .font(.title2.weight(.bold))
                .foregroundStyle(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardStyle()
    }

    private func errorCard(_ message: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.largeTitle)
                .foregroundStyle(AppTheme.warning)
            Text("Could not load intelligence")
                .font(.headline)
            Text(message)
                .font(.caption)
                .foregroundStyle(AppTheme.textSecondary)
                .multilineTextAlignment(.center)
            Text("Pull to refresh. On-device engine uses ESPN when online or bundled data offline.")
                .font(.caption2)
                .foregroundStyle(AppTheme.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
        .cardStyle()
    }

    private func offlineBanner(_ message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "icloud.slash")
                .foregroundStyle(AppTheme.warning)
            Text(message)
                .font(.caption)
                .foregroundStyle(AppTheme.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardStyle()
    }
}
