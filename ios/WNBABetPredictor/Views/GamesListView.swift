import SwiftUI

struct GamesListView: View {
    @Bindable var store: IntelligenceStore
    @State private var selectedFilter = "ALL"

    private let filters: [(id: String, label: String)] = [
        ("ALL", "All"),
        (DecisionType.strongPick.rawValue, DecisionType.strongPick.shortLabel),
        (DecisionType.lean.rawValue, DecisionType.lean.shortLabel),
        (DecisionType.pass.rawValue, DecisionType.pass.shortLabel),
        (DecisionType.waitForLineup.rawValue, DecisionType.waitForLineup.shortLabel),
        (DecisionType.highRiskOnly.rawValue, DecisionType.highRiskOnly.shortLabel),
        (DecisionType.insufficientData.rawValue, DecisionType.insufficientData.shortLabel)
    ]

    var body: some View {
        List {
            filterBar
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)

            if filteredGames.isEmpty {
                ContentUnavailableView(
                    "No Games",
                    systemImage: "line.3.horizontal.decrease.circle",
                    description: Text(emptyDescription)
                )
                .listRowBackground(Color.clear)
            } else {
                ForEach(filteredGames) { game in
                    NavigationLink(value: game) {
                        GameRowView(game: game)
                    }
                    .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(AppTheme.background)
        .navigationTitle("Games")
        .refreshable { await store.refresh() }
    }

    private var filteredGames: [GameIntelligence] {
        guard selectedFilter != "ALL" else { return store.games }
        return store.games.filter { $0.decision.decision.rawValue == selectedFilter }
    }

    private var emptyDescription: String {
        if let error = store.errorMessage { return error }
        if selectedFilter == "ALL" { return "Pull to refresh when the backend is running." }
        return "No games match the selected decision filter."
    }

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(filters, id: \.id) { filter in
                    Button {
                        selectedFilter = filter.id
                    } label: {
                        Text(filter.label)
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(selectedFilter == filter.id ? AppTheme.accent.opacity(0.22) : AppTheme.surface)
                            .foregroundStyle(selectedFilter == filter.id ? AppTheme.textPrimary : AppTheme.textSecondary)
                            .clipShape(Capsule())
                            .overlay(
                                Capsule()
                                    .stroke(selectedFilter == filter.id ? AppTheme.accent : AppTheme.border, lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.vertical, 6)
        }
    }
}
