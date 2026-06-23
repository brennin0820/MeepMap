import SwiftUI

struct SettingsView: View {
    @ObservedObject var api: APIClient
    @State private var serverURLString: String
    @State private var useOnDevice: Bool
    @State private var showAdvanced = false
    @State private var useRemoteServer = false
    @State private var serverReachable = false
    @State private var accuracy: AccuracySummary?
    @State private var sourceHealth: SourceHealth?
    @State private var statusMessage: String?
    @State private var bankroll: BankrollState?
    @State private var bankrollStarting = ""
    @State private var bankrollCurrent = ""
    @State private var bankrollUnit = ""
    @State private var journalEntries: [JournalEntry] = []
    @State private var journalMatchup = ""
    @State private var journalPick = ""
    @State private var journalUnits = "1"
    @State private var journalNotes = ""
    @State private var trackingMessage: String?

    init(api: APIClient) {
        self.api = api
        _serverURLString = State(initialValue: api.baseURL)
        _useOnDevice = State(initialValue: api.useOnDeviceEngine)
        _useRemoteServer = State(initialValue: APIClient.allowsRemoteServer && !api.useOnDeviceEngine)
    }

    var body: some View {
        Form {
            Section("Intelligence Engine") {
                if APIClient.allowsRemoteServer {
                    Toggle("On-device intelligence", isOn: $useOnDevice)
                        .onChange(of: useOnDevice) { _, newValue in
                            api.useOnDeviceEngine = newValue
                            useRemoteServer = !newValue
                            if !newValue { showAdvanced = true }
                            Task { await loadStatus() }
                        }
                }

                Label("Standalone engine active", systemImage: "iphone.gen3")
                    .font(.caption)
                    .foregroundStyle(AppTheme.success)
                Text("Predictions, matchup analysis, what-if tools, alerts, bankroll, and journal run inside the app. Live WNBA data is fetched directly when online and bundled fallback data is used offline.")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
            }

            Section("Data Source") {
                LabeledContent("Mode", value: APIClient.allowsRemoteServer && !useOnDevice ? "Remote Node server" : "On-device engine")
                if let sourceHealth {
                    LabeledContent(
                        "WNBA data",
                        value: sourceHealth.live == true ? "Live ESPN" : "Bundled fallback"
                    )
                    if let sources = sourceHealth.sources {
                        ForEach(sources.keys.sorted(), id: \.self) { key in
                            LabeledContent(key.capitalized, value: sources[key] ?? "unknown")
                        }
                    }
                } else {
                    Text("Status not loaded.")
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)
                }
                if let statusMessage {
                    Text(statusMessage)
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)
                }
                Button("Refresh Data Status") {
                    Task { await loadStatus() }
                }
            }

            Section("Accuracy") {
                if let accuracy {
                    LabeledContent("Model", value: accuracy.modelVersion ?? LocalPredictor.modelVersion)
                    LabeledContent("Local picks", value: "\(accuracy.totalPredictions ?? 0)")
                    LabeledContent("Moneyline", value: accuracy.moneylineAccuracy.map { String(format: "%.1f%%", $0) } ?? "—")
                    LabeledContent("Spread", value: accuracy.spreadAccuracy.map { String(format: "%.1f%%", $0) } ?? "—")
                    LabeledContent("Total", value: accuracy.totalAccuracy.map { String(format: "%.1f%%", $0) } ?? "—")
                    LabeledContent("Beat close", value: accuracy.beatClosingRate.map { String(format: "%.1f%%", $0) } ?? "—")
                    LabeledContent("Brier", value: accuracy.brierScore.map { String(format: "%.3f", $0) } ?? "—")
                    if let note = accuracy.note {
                        Text(note).font(.caption).foregroundStyle(AppTheme.textSecondary)
                    }
                } else {
                    Text("Local prediction history appears after the Command Center refreshes.")
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)
                }
            }

            Section("Bankroll") {
                TextField("Starting bankroll", text: $bankrollStarting)
                    .keyboardType(.decimalPad)
                TextField("Current bankroll", text: $bankrollCurrent)
                    .keyboardType(.decimalPad)
                TextField("Unit size", text: $bankrollUnit)
                    .keyboardType(.decimalPad)

                if let bankroll {
                    LabeledContent("ROI", value: String(format: "%.1f%%", bankroll.roi ?? 0))
                    LabeledContent("Unit", value: String(format: "$%.0f", bankroll.unitSize))
                }

                Button("Save Bankroll") {
                    Task { await saveBankroll() }
                }
            }

            Section("Journal") {
                TextField("Matchup", text: $journalMatchup)
                    .textInputAutocapitalization(.words)
                TextField("Pick", text: $journalPick)
                    .textInputAutocapitalization(.words)
                TextField("Units", text: $journalUnits)
                    .keyboardType(.decimalPad)
                TextField("Notes", text: $journalNotes, axis: .vertical)
                    .lineLimit(2...4)

                Button("Add Journal Entry") {
                    Task { await addJournalEntry() }
                }
                .disabled(journalMatchup.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || journalPick.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                if let trackingMessage {
                    Text(trackingMessage)
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)
                }

                if journalEntries.isEmpty {
                    Text("No local journal entries yet.")
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)
                } else {
                    ForEach(journalEntries.prefix(5)) { entry in
                        VStack(alignment: .leading, spacing: 4) {
                            Text("\(entry.matchup ?? "Matchup") · \(entry.pick ?? "Pick")")
                                .font(.subheadline.weight(.semibold))
                            HStack {
                                Text(String(format: "%.1f units", entry.units ?? 0))
                                Text(entry.result ?? "pending")
                            }
                            .font(.caption)
                            .foregroundStyle(AppTheme.textSecondary)
                            if let notes = entry.notes, !notes.isEmpty {
                                Text(notes)
                                    .font(.caption)
                                    .foregroundStyle(AppTheme.textSecondary)
                            }
                        }
                    }
                }
            }

            if APIClient.allowsRemoteServer {
                Section {
                    Toggle("Show advanced options", isOn: $showAdvanced)
                }
            }

            if showAdvanced && APIClient.allowsRemoteServer {
                Section("Remote Server (Dev)") {
                    Toggle("Use remote Node server", isOn: $useRemoteServer)
                        .onChange(of: useRemoteServer) { _, newValue in
                            api.useOnDeviceEngine = !newValue
                            useOnDevice = !newValue
                            Task { await loadStatus() }
                        }

                    if useRemoteServer {
                        TextField("Server URL", text: $serverURLString)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.URL)

                        HStack {
                            Text("Server status")
                            Spacer()
                            Label(
                                serverReachable ? "Connected" : "Unavailable",
                                systemImage: serverReachable ? "checkmark.circle.fill" : "xmark.circle.fill"
                            )
                            .foregroundStyle(serverReachable ? AppTheme.success : AppTheme.warning)
                            .font(.subheadline)
                        }

                        Button("Save & Test Connection") {
                            applyRemoteSettings()
                            Task { await checkHealth() }
                        }

                        Text("For development only. Requires `npm start` on your Mac.")
                            .font(.caption)
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                }
            }

            Section("About") {
                LabeledContent("App", value: "WNBA Bet Predictor 2026")
                LabeledContent("Version", value: "1.5.0")
                LabeledContent("Model", value: LocalPredictor.modelVersion)
                LabeledContent("Min iOS", value: "26.0")
                LabeledContent("Bundle ID", value: "com.brent.wnbabetpredictor")
            }

            Section {
                VStack(alignment: .leading, spacing: 12) {
                    Label("Responsible Betting", systemImage: "exclamationmark.shield.fill")
                        .font(.headline)
                        .foregroundStyle(AppTheme.warning)

                    Text("""
                    This app provides analytical projections and decision support — not financial advice. \
                    Past performance does not guarantee future results. Never bet more than you can afford to lose. \
                    If you or someone you know has a gambling problem, call 1-800-GAMBLER.
                    """)
                    .font(.footnote)
                    .foregroundStyle(AppTheme.textSecondary)
                }
                .padding(.vertical, 4)
            } header: {
                Text("Disclaimer")
            }
        }
        .scrollContentBackground(.hidden)
        .background(AppTheme.background)
        .navigationTitle("Settings")
        .task {
            api.useOnDeviceEngine = true
            useOnDevice = true
            useRemoteServer = false
            await loadStatus()
            await loadTracking()
        }
        .onChange(of: api.baseURL) { _, newValue in
            serverURLString = newValue
        }
    }

    private func loadAccuracy() async {
        accuracy = try? await api.fetchAccuracy()
    }

    private func loadStatus() async {
        statusMessage = nil
        do {
            sourceHealth = try await api.fetchHealth()
        } catch {
            sourceHealth = nil
            statusMessage = error.localizedDescription
        }
        await loadAccuracy()
        if useRemoteServer && APIClient.allowsRemoteServer {
            serverReachable = await api.healthCheck()
        } else {
            serverReachable = true
        }
    }

    private func loadTracking() async {
        do {
            bankroll = try await api.fetchBankroll()
            syncBankrollFields()
            journalEntries = try await api.fetchJournal().entries
            trackingMessage = nil
        } catch {
            trackingMessage = error.localizedDescription
        }
    }

    private func syncBankrollFields() {
        guard let bankroll else { return }
        bankrollStarting = numberField(bankroll.startingBankroll)
        bankrollCurrent = numberField(bankroll.currentBankroll)
        bankrollUnit = numberField(bankroll.unitSize)
    }

    private func saveBankroll() async {
        let update = BankrollUpdate(
            startingBankroll: Double(bankrollStarting),
            currentBankroll: Double(bankrollCurrent),
            unitSize: Double(bankrollUnit)
        )
        do {
            bankroll = try await api.updateBankroll(update)
            syncBankrollFields()
            trackingMessage = "Bankroll saved locally."
        } catch {
            trackingMessage = error.localizedDescription
        }
    }

    private func addJournalEntry() async {
        let request = JournalEntryRequest(
            matchup: journalMatchup.trimmingCharacters(in: .whitespacesAndNewlines),
            pick: journalPick.trimmingCharacters(in: .whitespacesAndNewlines),
            units: Double(journalUnits) ?? 1,
            notes: journalNotes.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
            betType: "moneyline"
        )
        do {
            _ = try await api.addJournalEntry(request)
            journalEntries = try await api.fetchJournal().entries
            journalMatchup = ""
            journalPick = ""
            journalUnits = "1"
            journalNotes = ""
            trackingMessage = "Journal entry saved locally."
        } catch {
            trackingMessage = error.localizedDescription
        }
    }

    private func numberField(_ value: Double) -> String {
        value.rounded() == value ? String(format: "%.0f", value) : String(value)
    }

    private func applyRemoteSettings() {
        guard APIClient.allowsRemoteServer else {
            api.useOnDeviceEngine = true
            useOnDevice = true
            useRemoteServer = false
            return
        }
        let trimmed = serverURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        if URL(string: trimmed)?.scheme != nil {
            api.baseURL = trimmed
        }
        api.useOnDeviceEngine = !useRemoteServer
        useOnDevice = !useRemoteServer
    }

    private func checkHealth() async {
        applyRemoteSettings()
        await loadStatus()
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}

#Preview {
    NavigationStack {
        SettingsView(api: APIClient())
    }
    .preferredColorScheme(.dark)
}
