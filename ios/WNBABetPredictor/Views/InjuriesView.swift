import SwiftUI

struct InjuriesView: View {
    @Bindable var store: InjuriesStore

    var body: some View {
        List {
            if store.isLoading && store.injuries.isEmpty {
                ProgressView("Loading injuries…")
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
            } else if store.injuries.isEmpty {
                ContentUnavailableView(
                    "No Injuries",
                    systemImage: "cross.case",
                    description: Text(store.errorMessage ?? "No injury reports returned.")
                )
                .listRowBackground(Color.clear)
            } else {
                ForEach(grouped.keys.sorted(), id: \.self) { team in
                    Section(team.uppercased()) {
                        ForEach(grouped[team] ?? []) { injury in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(injury.player)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(AppTheme.textPrimary)
                                Text(injury.status)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(statusColor(injury.status))
                                if let note = injury.note {
                                    Text(note)
                                        .font(.caption)
                                        .foregroundStyle(AppTheme.textSecondary)
                                }
                            }
                            .listRowBackground(AppTheme.surface)
                        }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .appBackground()
        .navigationTitle("Injuries")
        .refreshable { await store.refresh() }
        .task { await store.refresh() }
    }

    private var grouped: [String: [InjuryEntry]] {
        Dictionary(grouping: store.injuries, by: { $0.teamName ?? $0.teamKey })
    }

    private func statusColor(_ status: String) -> Color {
        let lower = status.lowercased()
        if lower.contains("out") { return AppTheme.danger }
        if lower.contains("question") || lower.contains("doubt") { return AppTheme.warning }
        return AppTheme.success
    }
}
