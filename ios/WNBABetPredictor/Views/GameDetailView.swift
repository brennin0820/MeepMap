import SwiftUI

struct GameDetailView: View {
    let game: GameIntelligence
    let api: APIClient

    init(game: GameIntelligence, api: APIClient = APIClient()) {
        self.game = game
        self.api = api
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                headerSection
                decisionSection
                bettingWinSection
                readinessSection
                qualitySection
                projectionSection
                reasonsSection
                insightsSection
                alertsSection
                WhatIfView(game: game, api: api)
                ResponsibleBettingDisclaimer()
            }
            .padding()
        }
        .appBackground()
        .navigationTitle("Game Detail")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var headerSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(matchupTitle)
                .font(.title2.weight(.bold))
                .foregroundStyle(AppTheme.textPrimary)
            if let date = game.game.date {
                Label(date, systemImage: "calendar")
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textSecondary)
            }
            if let status = game.game.status {
                Text(status.capitalized)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AppTheme.accentSecondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardStyle()
    }

    private var decisionSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Decision")
                .font(.headline)
                .foregroundStyle(AppTheme.textPrimary)
            HStack {
                DecisionBadge(decision: game.decision.decision)
                RiskBadge(risk: game.decision.risk)
                Spacer()
            }
            Text(game.decision.action)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(AppTheme.textPrimary)
            EdgeMeterView(score: game.decision.edgeScore)
            HStack {
                Label("Confidence \(game.decision.confidence)", systemImage: "gauge.with.dots.needle.50percent")
                Spacer()
                Text("Edge \(game.decision.edgeScore)")
            }
            .font(.caption)
            .foregroundStyle(AppTheme.textSecondary)
        }
        .cardStyle()
    }

    @ViewBuilder
    private var bettingWinSection: some View {
        if let prediction = game.prediction,
           prediction.moneylinePick != nil || prediction.winner != nil || prediction.moneylineWinProb != nil {
            VStack(alignment: .leading, spacing: 10) {
                Text("Betting Win Prediction")
                    .font(.headline)
                    .foregroundStyle(AppTheme.textPrimary)

                if let pick = prediction.moneylinePick ?? prediction.winner.map({ "\($0) ML" }) {
                    row("Model ML pick", pick)
                }

                if let probability = prediction.moneylineWinProb ?? bestWinProbability(from: prediction) {
                    row("Win probability", String(format: "%.0f%%", probability * 100))
                }

                if let fairLine = prediction.fairMoneyline {
                    row("Fair moneyline", formatAmericanLine(fairLine))
                }

                if let marketLine = prediction.marketMoneyline {
                    row("Market moneyline", formatAmericanLine(marketLine))
                }

                if let edge = prediction.moneylineEdge {
                    row("Model edge", String(format: "%+.1f pts", edge * 100))
                }

                Text(prediction.moneylineNote ?? "Model-only fair line. Compare against real sportsbook odds before deciding whether there is value.")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
            }
            .foregroundStyle(AppTheme.textPrimary)
            .cardStyle()
        }
    }

    private var readinessSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Readiness")
                .font(.headline)
            readinessRow(
                "Model projection",
                ok: game.dataQuality.flags?.hasModelProjection == true,
                detail: game.dataQuality.flags?.hasModelProjection == true ? "Available" : "Missing"
            )
            readinessRow(
                "Market line",
                ok: game.dataQuality.flags?.hasOdds == true,
                detail: game.dataQuality.flags?.hasOdds == true ? "Attached" : "Model-only"
            )
            readinessRow(
                "Sample size",
                ok: game.dataQuality.flags?.sampleSizeAdequate == true,
                detail: game.dataQuality.flags?.sampleSizeAdequate == true ? "Adequate" : "Low"
            )
            readinessRow(
                "Fresh inputs",
                ok: game.dataQuality.flags?.isStale != true,
                detail: game.dataQuality.flags?.isStale == true ? "Stale" : "Current enough"
            )
        }
        .foregroundStyle(AppTheme.textPrimary)
        .cardStyle()
    }

    private var qualitySection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Data Quality")
                .font(.headline)
            HStack {
                DataQualityBadge(quality: game.dataQuality)
                Text("Cap \(game.dataQuality.confidenceCap)%")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
            }
            if let flags = game.dataQuality.flags {
                qualityFlag("Team stats", flags.hasHomeStats == true && flags.hasAwayStats == true)
                qualityFlag("Lineup confirmed", flags.lineupConfirmed == true)
                qualityFlag("Odds available", flags.hasOdds == true)
                qualityFlag("Injury report", flags.hasInjuries == true)
                qualityFlag("Projection", flags.hasModelProjection == true)
            }
        }
        .foregroundStyle(AppTheme.textPrimary)
        .cardStyle()
    }

    @ViewBuilder
    private var projectionSection: some View {
        if let prediction = game.prediction, let proj = prediction.projections {
            VStack(alignment: .leading, spacing: 8) {
                Text("Model Projection")
                    .font(.headline)
                if let margin = proj.projectedMargin {
                    row("Projected margin", String(format: "%+.1f", margin))
                }
                if let total = proj.projectedTotal {
                    row("Projected total", String(format: "%.1f", total))
                }
                if let prob = proj.homeWinProb {
                    row("Home win prob", String(format: "%.0f%%", prob * 100))
                }
                if let score = proj.projectedScore, let home = score.home, let away = score.away {
                    row("Projected score", "\(String(format: "%.1f", away)) - \(String(format: "%.1f", home))")
                }
                if let odds = prediction.marketOdds {
                    if let provider = odds.provider {
                        row("Odds provider", provider)
                    }
                    if let spread = odds.spread {
                        row("Market spread", homeSpreadLabel(spread))
                    }
                    if let openingSpread = odds.openingSpread {
                        row("Opening spread", homeSpreadLabel(openingSpread))
                    }
                    if let total = odds.total {
                        row("Market total", String(format: "%.1f", total))
                    }
                    if let openingTotal = odds.openingTotal {
                        row("Opening total", String(format: "%.1f", openingTotal))
                    }
                    if let homeML = odds.homeMoneyline {
                        row("\(game.game.homeName ?? "Home") ML", formatAmericanLine(homeML))
                    }
                    if let awayML = odds.awayMoneyline {
                        row("\(game.game.awayName ?? "Away") ML", formatAmericanLine(awayML))
                    }
                    if let open = odds.openingSpread, let current = odds.spread, open != current {
                        row("Spread move", String(format: "%+.1f", current - open))
                    }
                    if let open = odds.openingTotal, let current = odds.total, open != current {
                        row("Total move", String(format: "%+.1f", current - open))
                    }
                }
                if let lineWarning = prediction.lineWarning {
                    Label(lineWarning, systemImage: "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(AppTheme.warning)
                } else if game.dataQuality.flags?.hasOdds != true {
                    Label("No market line attached; verify sportsbook line before acting.", systemImage: "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(AppTheme.warning)
                }
            }
            .foregroundStyle(AppTheme.textPrimary)
            .cardStyle()
        }
    }

    @ViewBuilder
    private var reasonsSection: some View {
        if !game.decision.humanReasons.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Reasoning")
                    .font(.headline)
                ForEach(game.decision.humanReasons, id: \.self) { reason in
                    Label(reason, systemImage: "text.quote")
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)
                }
            }
            .foregroundStyle(AppTheme.textPrimary)
            .cardStyle()
        }

        if let explanation = game.explanation {
            VStack(alignment: .leading, spacing: 8) {
                Text("Explanation")
                    .font(.headline)
                if let summary = explanation.summary {
                    Text(summary)
                        .font(.subheadline)
                        .foregroundStyle(AppTheme.textSecondary)
                }
                if let bullets = explanation.bullets {
                    ForEach(bullets, id: \.self) { bullet in
                        Text("• \(bullet)")
                            .font(.caption)
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                }
            }
            .foregroundStyle(AppTheme.textPrimary)
            .cardStyle()
        }
    }

    @ViewBuilder
    private var insightsSection: some View {
        if let insights = game.insights, !insights.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Insights")
                    .font(.headline)
                ForEach(insights.sorted(by: { $0.priority < $1.priority })) { insight in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(insight.title)
                            .font(.subheadline.weight(.semibold))
                        Text(insight.detail)
                            .font(.caption)
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                    .padding(.vertical, 4)
                }
            }
            .foregroundStyle(AppTheme.textPrimary)
            .cardStyle()
        }
    }

    @ViewBuilder
    private var alertsSection: some View {
        if let alerts = game.alerts, !alerts.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Game Alerts")
                    .font(.headline)
                ForEach(alerts) { alert in
                    AlertRow(alert: alert)
                }
            }
            .cardStyle()
        }
    }

    private var matchupTitle: String {
        let home = game.game.homeName ?? game.game.homeKey.uppercased()
        let away = game.game.awayName ?? game.game.awayKey.uppercased()
        return "\(away) @ \(home)"
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
                .font(.caption)
                .foregroundStyle(AppTheme.textSecondary)
            Spacer()
            Text(value)
                .font(.subheadline.weight(.semibold))
        }
    }

    private func bestWinProbability(from prediction: Prediction) -> Double? {
        if let homeProb = prediction.projections?.homeWinProb ?? prediction.winProb {
            return max(homeProb, 1 - homeProb)
        }
        return nil
    }

    private func formatAmericanLine(_ line: Int) -> String {
        line > 0 ? "+\(line)" : "\(line)"
    }

    private func homeSpreadLabel(_ spread: Double) -> String {
        "\(game.game.homeName ?? "Home") \(String(format: "%+.1f", spread))"
    }

    private func qualityFlag(_ label: String, _ ok: Bool) -> some View {
        Label(label, systemImage: ok ? "checkmark.circle.fill" : "xmark.circle")
            .font(.caption)
            .foregroundStyle(ok ? AppTheme.success : AppTheme.textSecondary)
    }

    private func readinessRow(_ label: String, ok: Bool, detail: String) -> some View {
        HStack {
            Label(label, systemImage: ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                .font(.caption)
                .foregroundStyle(ok ? AppTheme.success : AppTheme.warning)
            Spacer()
            Text(detail)
                .font(.caption.weight(.semibold))
                .foregroundStyle(AppTheme.textSecondary)
        }
    }
}
