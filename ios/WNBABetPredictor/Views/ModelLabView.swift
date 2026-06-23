import SwiftUI

struct ModelLabView: View {
    @ObservedObject var api: APIClient
    @State private var lab: PerformanceLab?
    @State private var accuracy: AccuracySummary?
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if isLoading && lab == nil {
                    ProgressView("Loading model lab…")
                        .frame(maxWidth: .infinity, minHeight: 180)
                } else if let errorMessage, lab == nil {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(AppTheme.warning)
                        .cardStyle()
                } else {
                    summarySection
                    marketSection
                    calibrationSection
                    auditSection
                }
            }
            .padding()
        }
        .appBackground()
        .navigationTitle("Model Lab")
        .refreshable { await load() }
        .task { await load() }
    }

    @ViewBuilder
    private var summarySection: some View {
        if let accuracy, let lab {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Backtest Snapshot")
                        .font(.headline)
                    Spacer()
                    Text("\(lab.gradedCount) graded")
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)
                }

                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    metricCard("Model score", accuracy.localScore.map(String.init) ?? "—")
                    metricCard("Beat close", percent(accuracy.beatClosingRate))
                    metricCard("Brier", decimal(accuracy.brierScore))
                    metricCard("Log loss", decimal(accuracy.logLoss))
                    metricCard("Spread CLV", signed(accuracy.averageSpreadCLV))
                    metricCard("Total CLV", signed(accuracy.averageTotalCLV))
                }
            }
            .cardStyle()
        }
    }

    @ViewBuilder
    private var marketSection: some View {
        if let lab, !lab.markets.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text("Per-market grading")
                    .font(.headline)

                ForEach(lab.markets) { market in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(market.label)
                                .font(.subheadline.weight(.semibold))
                            Spacer()
                            Text("\(market.gradedCount) graded")
                                .font(.caption)
                                .foregroundStyle(AppTheme.textSecondary)
                        }

                        HStack {
                            metricPill("Overall", percent(market.overallAccuracy))
                            metricPill("High", percent(market.highConfidenceAccuracy))
                            metricPill("CLV", signed(market.averageCLV))
                            metricPill("Beat close", percent(market.beatCloseRate))
                        }
                    }
                    .padding(12)
                    .background(AppTheme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(AppTheme.border, lineWidth: 1)
                    )
                }
            }
            .cardStyle()
        }
    }

    @ViewBuilder
    private var calibrationSection: some View {
        if let lab, !lab.calibration.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text("Calibration")
                    .font(.headline)

                ForEach(lab.calibration) { bucket in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(bucket.label)
                                .font(.subheadline.weight(.semibold))
                            Spacer()
                            Text("\(bucket.count) picks")
                                .font(.caption)
                                .foregroundStyle(AppTheme.textSecondary)
                        }

                        HStack {
                            Text("Pred \(percent(bucket.averagePredicted * 100))")
                            Spacer()
                            Text("Actual \(percent(bucket.actualWinRate.map { $0 * 100 }))")
                        }
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)

                        GeometryReader { proxy in
                            ZStack(alignment: .leading) {
                                Capsule().fill(AppTheme.surfaceElevated)
                                Capsule()
                                    .fill(AppTheme.accentSecondary)
                                    .frame(width: proxy.size.width * CGFloat(bucket.averagePredicted))
                                if let actual = bucket.actualWinRate {
                                    Capsule()
                                        .fill(AppTheme.success.opacity(0.8))
                                        .frame(width: proxy.size.width * CGFloat(actual), height: 4)
                                        .offset(y: 8)
                                }
                            }
                        }
                        .frame(height: 12)
                    }
                    .padding(12)
                    .background(AppTheme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(AppTheme.border, lineWidth: 1)
                    )
                }
            }
            .cardStyle()
        }
    }

    @ViewBuilder
    private var auditSection: some View {
        if let lab, !lab.audits.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text("Postgame audits")
                    .font(.headline)

                ForEach(lab.audits.prefix(10)) { audit in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(audit.matchup)
                                .font(.subheadline.weight(.semibold))
                            Spacer()
                            Text(audit.result.uppercased())
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(audit.result == "win" ? AppTheme.success : AppTheme.warning)
                        }
                        Text(audit.summary)
                            .font(.caption)
                            .foregroundStyle(AppTheme.textSecondary)
                        if let clvNote = audit.clvNote {
                            Text(clvNote)
                                .font(.caption2)
                                .foregroundStyle(AppTheme.textSecondary)
                        }
                    }
                    .padding(12)
                    .background(AppTheme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(AppTheme.border, lineWidth: 1)
                    )
                }
            }
            .cardStyle()
        }
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            async let labResult = api.fetchPerformanceLab()
            async let accuracyResult = api.fetchAccuracy()
            lab = try await labResult
            accuracy = try await accuracyResult
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func metricCard(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption)
                .foregroundStyle(AppTheme.textSecondary)
            Text(value)
                .font(.title3.weight(.bold))
                .foregroundStyle(AppTheme.textPrimary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(AppTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(AppTheme.border, lineWidth: 1)
        )
    }

    private func metricPill(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(AppTheme.textSecondary)
            Text(value)
                .font(.caption.weight(.semibold))
                .foregroundStyle(AppTheme.textPrimary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(AppTheme.surfaceElevated)
        .clipShape(Capsule())
    }

    private func percent(_ value: Double?) -> String {
        guard let value else { return "—" }
        return String(format: "%.1f%%", value)
    }

    private func decimal(_ value: Double?) -> String {
        guard let value else { return "—" }
        return String(format: "%.3f", value)
    }

    private func signed(_ value: Double?) -> String {
        guard let value else { return "—" }
        return String(format: "%+.1f", value)
    }
}

#Preview {
    NavigationStack {
        ModelLabView(api: APIClient())
    }
    .preferredColorScheme(.dark)
}
