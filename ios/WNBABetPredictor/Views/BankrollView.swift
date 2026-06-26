import SwiftUI

struct BankrollView: View {
    @ObservedObject var api: APIClient
    @State private var bankroll: BankrollState?
    @State private var bankrollStarting = ""
    @State private var bankrollCurrent = ""
    @State private var bankrollUnit = ""
    @State private var journalEntries: [JournalEntry] = []
    @State private var trackingMessage: String?

    var body: some View {
        Form {
            Section("Bankroll") {
                TextField("Starting bankroll", text: $bankrollStarting)
                    .keyboardType(.decimalPad)
                TextField("Current bankroll", text: $bankrollCurrent)
                    .keyboardType(.decimalPad)
                TextField("Unit size", text: $bankrollUnit)
                    .keyboardType(.decimalPad)

                Button("Save Bankroll") {
                    Task { await saveBankroll() }
                }

                if let trackingMessage {
                    Text(trackingMessage)
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)
                }
            }

            Section("Performance") {
                if let bankroll {
                    LabeledContent("ROI", value: String(format: "%.1f%%", bankroll.roi ?? 0))
                    LabeledContent("Unit", value: String(format: "$%.0f", bankroll.unitSize))
                    LabeledContent("Current", value: String(format: "$%.0f", bankroll.currentBankroll))
                } else {
                    Text("Bankroll not loaded.")
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)
                }
                LabeledContent("Exposure today", value: "\(exposureToday)")
            }
        }
        .scrollContentBackground(.hidden)
        .appBackground()
        .navigationTitle("Bankroll")
        .refreshable { await loadTracking() }
        .task { await loadTracking() }
    }

    /// Count of journal entries whose `createdAt` date is today.
    private var exposureToday: Int {
        let calendar = Calendar.current
        let formatter = ISO8601DateFormatter()
        return journalEntries.filter { entry in
            guard let createdAt = entry.createdAt,
                  let date = formatter.date(from: createdAt) else { return false }
            return calendar.isDateInToday(date)
        }.count
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

    private func numberField(_ value: Double) -> String {
        value.rounded() == value ? String(format: "%.0f", value) : String(value)
    }
}

#Preview {
    NavigationStack {
        BankrollView(api: APIClient())
    }
    .preferredColorScheme(.dark)
}
