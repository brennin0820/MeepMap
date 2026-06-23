import SwiftUI

struct MatchupView: View {
    @Bindable var store: MatchupStore

    @State private var homeKey = "las"
    @State private var awayKey = "min"

    private let teamKeys = [
        "atl", "chi", "con", "dal", "ind", "las", "min", "ny",
        "phx", "sea", "was", "gs", "tor"
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Compare two teams with the intelligence engine.")
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textSecondary)

                teamPicker(title: "Home", selection: $homeKey)
                teamPicker(title: "Away", selection: $awayKey)

                Button {
                    Task { await store.analyze(homeKey: homeKey, awayKey: awayKey) }
                } label: {
                    HStack {
                        if store.isLoading {
                            ProgressView().tint(.white)
                        }
                        Text(store.isLoading ? "Analyzing…" : "Analyze Matchup")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(AppTheme.accent)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .disabled(store.isLoading)

                if let error = store.errorMessage {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(AppTheme.danger)
                        .cardStyle()
                }

                if let result = store.result {
                    NavigationLink(value: result) {
                        GameRowView(game: result)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding()
        }
        .background(AppTheme.background)
        .navigationTitle("Matchup")
        .navigationDestination(for: GameIntelligence.self) { game in
            GameDetailView(game: game)
        }
    }

    private func teamPicker(title: String, selection: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(AppTheme.textSecondary)
            Picker(title, selection: selection) {
                ForEach(teamKeys, id: \.self) { key in
                    Text(key.uppercased()).tag(key)
                }
            }
            .pickerStyle(.menu)
            .tint(AppTheme.accentSecondary)
        }
        .cardStyle()
    }
}
