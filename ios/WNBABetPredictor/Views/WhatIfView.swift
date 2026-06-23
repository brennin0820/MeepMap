import SwiftUI

struct WhatIfView: View {
    let game: GameIntelligence
    let api: APIClient

    init(game: GameIntelligence, api: APIClient = APIClient()) {
        self.game = game
        self.api = api
    }

    @State private var homePlayerOut = ""
    @State private var awayPlayerOut = ""
    @State private var manualSpread = ""
    @State private var result: WhatIfResponse?
    @State private var isRunning = false
    @State private var errorMessage: String?


    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("What-If Scenario")
                .font(.headline)
                .foregroundStyle(AppTheme.textPrimary)

            TextField("Home player out (optional)", text: $homePlayerOut)
                .textFieldStyle(.roundedBorder)

            TextField("Away player out (optional)", text: $awayPlayerOut)
                .textFieldStyle(.roundedBorder)

            TextField("Manual spread (optional, e.g. -2.5)", text: $manualSpread)
                .keyboardType(.decimalPad)
                .textFieldStyle(.roundedBorder)

            Button {
                Task { await runScenario() }
            } label: {
                HStack {
                    if isRunning { ProgressView().tint(.white) }
                    Text("Run Scenario")
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
                .padding()
                .background(AppTheme.accentSecondary)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .disabled(isRunning)

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(AppTheme.danger)
            }

            if let result {
                comparisonSection(title: "Baseline", outcome: result.original ?? result.baseline)
                if let scenario = result.scenario ?? result.adjusted ?? result.scenarios?.first?.outcome {
                    comparisonSection(title: "Scenario", outcome: scenario)
                }
                if let summary = result.summary {
                    Text(summary)
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)
                }
                scenarioList(result.scenarios ?? [])
            }
        }
        .cardStyle()
    }

    private func comparisonSection(title: String, outcome: WhatIfOutcome) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(AppTheme.textSecondary)
            HStack {
                DecisionBadge(decision: outcome.decision)
                RiskBadge(risk: outcome.risk ?? "Medium")
                Spacer()
                Text(outcome.confidenceLabel)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AppTheme.textSecondary)
            }
            EdgeMeterView(score: outcome.edgeScore)
        }
    }

    @ViewBuilder
    private func scenarioList(_ scenarios: [WhatIfScenarioResult]) -> some View {
        if !scenarios.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Built-in stress tests")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AppTheme.textSecondary)
                ForEach(scenarios) { scenario in
                    HStack(spacing: 8) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(scenario.label ?? scenario.id)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(AppTheme.textPrimary)
                            if let assumption = scenario.assumption {
                                Text(assumption)
                                    .font(.caption2)
                                    .foregroundStyle(AppTheme.textSecondary)
                            }
                        }
                        Spacer()
                        DecisionBadge(decision: scenario.outcome.decision, compact: true)
                    }
                    .padding(.vertical, 4)
                }
            }
            .padding(.top, 4)
        }
    }

    private func runScenario() async {
        isRunning = true
        errorMessage = nil
        defer { isRunning = false }

        let spread = Double(manualSpread.trimmingCharacters(in: .whitespaces))
        let overrides = [
            homePlayerOut.isEmpty ? nil : PlayerStatusOverride(player: homePlayerOut, status: "Out"),
            awayPlayerOut.isEmpty ? nil : PlayerStatusOverride(player: awayPlayerOut, status: "Out")
        ].compactMap { $0 }
        let request = WhatIfRequest(
            homeKey: game.game.homeKey,
            awayKey: game.game.awayKey,
            date: game.game.date,
            scenario: overrides.isEmpty ? nil : WhatIfScenarioRequest(setPlayerStatus: overrides),
            spread: spread
        )

        do {
            result = try await api.runWhatIf(request)
        } catch {
            if api.useMockWhenOffline {
                result = mockWhatIf(for: request)
            } else {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func mockWhatIf(for request: WhatIfRequest) -> WhatIfResponse {
        let baseline = WhatIfOutcome(
            decision: game.decision.decision,
            edgeScore: game.decision.edgeScore,
            confidence: Int(game.decision.confidence.filter(\.isNumber)),
            grade: game.dataQuality.grade.rawValue,
            risk: game.decision.risk
        )
        let scenario = WhatIfOutcome(
            decision: request.scenario == nil ? .lean : .waitForLineup,
            edgeScore: max(30, baseline.edgeScore - 12),
            confidence: 35,
            grade: game.dataQuality.grade.rawValue,
            risk: "medium"
        )
        return WhatIfResponse(
            baseline: baseline,
            original: baseline,
            scenario: scenario,
            adjusted: scenario,
            scenarios: [
                WhatIfScenarioResult(
                    id: "offline-injury",
                    label: "Player availability change",
                    assumption: "Offline mock reduces edge by 12 points.",
                    outcome: scenario
                )
            ],
            summary: "Offline mock: changing player availability reduces edge. Verify live injury reports before acting."
        )
    }
}

#Preview {
    WhatIfView(game: MockDataProvider.intelligenceResponse.games[0])
        .padding()
        .background(AppTheme.background)
        .preferredColorScheme(.dark)
}
