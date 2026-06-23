import SwiftUI

struct DecisionBadge: View {
    let decision: DecisionType
    var compact = false

    var body: some View {
        Text(compact ? decision.shortLabel : decision.displayName)
            .font(compact ? .caption2.weight(.semibold) : .caption.weight(.bold))
            .foregroundStyle(.white)
            .padding(.horizontal, compact ? 8 : 10)
            .padding(.vertical, compact ? 4 : 6)
            .background(AppTheme.decisionColor(decision).opacity(0.25))
            .clipShape(Capsule())
            .overlay(Capsule().stroke(AppTheme.decisionColor(decision), lineWidth: 1))
    }
}

struct DataQualityBadge: View {
    let quality: DataQuality

    var body: some View {
        HStack(spacing: 6) {
            Text(quality.grade.displayName)
                .font(.caption.weight(.bold))
                .foregroundStyle(AppTheme.gradeColor(quality.grade))
            Text("\(quality.score)")
                .font(.caption2)
                .foregroundStyle(AppTheme.textSecondary)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(AppTheme.gradeColor(quality.grade).opacity(0.15))
        .clipShape(Capsule())
    }
}

struct RiskBadge: View {
    let risk: String

    var body: some View {
        Label(risk, systemImage: "shield.lefthalf.filled")
            .font(.caption2.weight(.semibold))
            .foregroundStyle(AppTheme.riskColor(risk))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(AppTheme.riskColor(risk).opacity(0.12))
            .clipShape(Capsule())
    }
}

struct EdgeMeterView: View {
    let score: Int

    private var normalized: Double { min(max(Double(score) / 100.0, 0), 1) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Edge Score")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
                Spacer()
                Text("\(score)")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(AppTheme.textPrimary)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(AppTheme.surfaceElevated)
                    Capsule()
                        .fill(
                            LinearGradient(
                                colors: [AppTheme.accentSecondary, AppTheme.success],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .frame(width: geo.size.width * normalized)
                }
            }
            .frame(height: 8)
        }
    }
}

struct GameRowView: View {
    let game: GameIntelligence

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(matchupTitle)
                        .font(.headline)
                        .foregroundStyle(AppTheme.textPrimary)
                    if let date = game.game.date {
                        Text(date)
                            .font(.caption)
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                }
                Spacer()
                DecisionBadge(decision: game.decision.decision, compact: true)
            }
            Text(game.decision.action)
                .font(.caption)
                .foregroundStyle(AppTheme.textSecondary)
                .lineLimit(2)

            HStack(spacing: 8) {
                DataQualityBadge(quality: game.dataQuality)
                RiskBadge(risk: game.decision.risk)
                Spacer()
                EdgeMeterView(score: game.decision.edgeScore)
                    .frame(width: 120)
            }
            if projectionSummary != nil || marketCue != nil {
                HStack(spacing: 10) {
                    if let projectionSummary {
                        Label(projectionSummary, systemImage: "chart.line.uptrend.xyaxis")
                    }
                    if let marketCue {
                        Label(marketCue, systemImage: "line.3.horizontal.decrease.circle")
                    }
                }
                .font(.caption2)
                .foregroundStyle(AppTheme.textSecondary)
                .lineLimit(1)
            }
        }
        .cardStyle()
    }

    private var matchupTitle: String {
        let home = game.game.homeName ?? game.game.homeKey.uppercased()
        let away = game.game.awayName ?? game.game.awayKey.uppercased()
        return "\(away) @ \(home)"
    }

    private var projectionSummary: String? {
        let projection = game.prediction?.projections
        if let margin = projection?.projectedMargin ?? game.prediction?.spread {
            return "Margin \(String(format: "%+.1f", margin))"
        }
        if let probability = projection?.homeWinProb ?? game.prediction?.winProb {
            return "Home \(String(format: "%.0f%%", probability * 100))"
        }
        return nil
    }

    private var marketCue: String? {
        if game.dataQuality.flags?.hasOdds == true { return "Line attached" }
        if game.prediction != nil { return "Model only" }
        return nil
    }
}
