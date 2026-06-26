import SwiftUI

struct JournalView: View {
    @ObservedObject var api: APIClient
    @State private var journalEntries: [JournalEntry] = []
    @State private var journalMatchup = ""
    @State private var journalPick = ""
    @State private var journalUnits = "1"
    @State private var journalNotes = ""
    @State private var trackingMessage: String?

    var body: some View {
        Form {
            Section("Record") {
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
            }

            Section("Summary") {
                LabeledContent("Record", value: recordSummary)
                LabeledContent("Units", value: String(format: "%+.1f", netUnits))
                LabeledContent("Entries", value: "\(journalEntries.count)")
            }

            Section("History") {
                if journalEntries.isEmpty {
                    Text("No local journal entries yet.")
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)
                } else {
                    ForEach(journalEntries.prefix(20)) { entry in
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
        }
        .scrollContentBackground(.hidden)
        .appBackground()
        .navigationTitle("Journal")
        .refreshable { await loadJournal() }
        .task { await loadJournal() }
    }

    private var wins: Int {
        journalEntries.filter { ($0.result ?? "").lowercased() == "win" }.count
    }

    private var losses: Int {
        journalEntries.filter { ($0.result ?? "").lowercased() == "loss" }.count
    }

    private var recordSummary: String {
        "\(wins)-\(losses)"
    }

    private var netUnits: Double {
        journalEntries.reduce(0) { partial, entry in
            let units = entry.units ?? 0
            switch (entry.result ?? "").lowercased() {
            case "win": return partial + units
            case "loss": return partial - units
            default: return partial
            }
        }
    }

    private func loadJournal() async {
        do {
            journalEntries = try await api.fetchJournal().entries
            trackingMessage = nil
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
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}

#Preview {
    NavigationStack {
        JournalView(api: APIClient())
    }
    .preferredColorScheme(.dark)
}
