import SwiftUI

struct ContentView: View {
    @ObservedObject var apiClient: APIClient
    @State private var intelligenceStore: IntelligenceStore
    @State private var scoreboardStore: ScoreboardStore
    @State private var injuriesStore: InjuriesStore
    @State private var matchupStore: MatchupStore
    @State private var teamsStore: TeamsStore

    init(apiClient: APIClient) {
        self.apiClient = apiClient
        _intelligenceStore = State(initialValue: IntelligenceStore(api: apiClient))
        _scoreboardStore = State(initialValue: ScoreboardStore(api: apiClient))
        _injuriesStore = State(initialValue: InjuriesStore(api: apiClient))
        _matchupStore = State(initialValue: MatchupStore(api: apiClient))
        _teamsStore = State(initialValue: TeamsStore(api: apiClient))
    }

    var body: some View {
        TabView {
            NavigationStack {
                IntelligenceDashboardView(store: intelligenceStore)
                    .navigationDestination(for: GameIntelligence.self) { game in
                        GameDetailView(game: game, api: apiClient)
                    }
            }
            .tabItem {
                Label("Command Center", systemImage: "command.circle.fill")
            }

            NavigationStack {
                GamesListView(store: intelligenceStore)
                    .navigationDestination(for: GameIntelligence.self) { game in
                        GameDetailView(game: game, api: apiClient)
                    }
            }
            .tabItem {
                Label("Games", systemImage: "sportscourt.fill")
            }

            NavigationStack {
                ScoreboardView(store: scoreboardStore)
            }
            .tabItem {
                Label("Scoreboard", systemImage: "list.bullet.rectangle.fill")
            }

            NavigationStack {
                TeamsView(store: teamsStore)
            }
            .tabItem {
                Label("Team/s", systemImage: "person.3.sequence.fill")
            }

            NavigationStack {
                MatchupView(store: matchupStore)
            }
            .tabItem {
                Label("Matchup", systemImage: "arrow.left.arrow.right.circle.fill")
            }

            NavigationStack {
                ModelLabView(api: apiClient)
            }
            .tabItem {
                Label("Lab", systemImage: "chart.xyaxis.line")
            }

            NavigationStack {
                InjuriesView(store: injuriesStore)
            }
            .tabItem {
                Label("Injuries", systemImage: "cross.case.fill")
            }

            NavigationStack {
                JournalView(api: apiClient)
            }
            .tabItem {
                Label("Journal", systemImage: "book.closed.fill")
            }

            NavigationStack {
                BankrollView(api: apiClient)
            }
            .tabItem {
                Label("Bankroll", systemImage: "dollarsign.circle.fill")
            }

            NavigationStack {
                SettingsView(api: apiClient)
            }
            .tabItem {
                Label("Settings", systemImage: "gearshape.fill")
            }
        }
        .tint(AppTheme.accent)
    }
}

#Preview {
    ContentView(apiClient: APIClient())
        .preferredColorScheme(.dark)
}
