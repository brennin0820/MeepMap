import SwiftUI

struct ScoreboardView: View {
    @Bindable var store: ScoreboardStore

    var body: some View {
        List {
            if let warning = store.scoreboard?.warning ?? store.errorMessage {
                Text(warning)
                    .font(.caption)
                    .foregroundStyle(AppTheme.warning)
                    .listRowBackground(Color.clear)
            }

            if !games.isEmpty {
                summaryTiles
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            if store.isLoading && games.isEmpty {
                ProgressView("Loading scoreboard…")
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
            } else if games.isEmpty {
                ContentUnavailableView(
                    "No Games",
                    systemImage: "sportscourt",
                    description: Text(store.errorMessage ?? "No games on today's scoreboard.")
                )
                .listRowBackground(Color.clear)
            } else {
                ForEach(games) { game in
                    ScoreboardGameCard(
                        game: game,
                        isExpanded: store.expandedGameId == game.id,
                        teamDetails: store.teamDetails,
                        teamLoadingKeys: store.teamLoadingKeys,
                        playersCache: store.playersCache,
                        playersLoadingKeys: store.playersLoadingKeys,
                        onToggle: { store.toggleGame(game) },
                        onLoadPlayers: { key in
                            Task { await store.loadPlayers(teamKey: key) }
                        }
                    )
                    .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .appBackground()
        .navigationTitle("Scoreboard")
        .refreshable { await store.refresh() }
        .task { await store.refresh() }
    }

    private var games: [ScoreboardGame] {
        store.scoreboard?.games ?? []
    }

    private var summaryTiles: some View {
        let live = games.filter(\.isLive).count
        let final = games.filter(\.isFinal).count
        let upcoming = max(0, games.count - live - final)

        return HStack(spacing: 10) {
            summaryTile(count: live, label: "Live", color: AppTheme.danger)
            summaryTile(count: upcoming, label: "Upcoming", color: AppTheme.warning)
            summaryTile(count: final, label: "Final", color: AppTheme.textSecondary)
        }
        .padding(.vertical, 4)
    }

    private func summaryTile(count: Int, label: String, color: Color) -> some View {
        VStack(spacing: 4) {
            Text("\(count)")
                .font(.title3.weight(.bold).monospacedDigit())
                .foregroundStyle(color)
            Text(label)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(AppTheme.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(AppTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(AppTheme.border, lineWidth: 1)
        )
    }
}

private struct ScoreboardGameCard: View {
    let game: ScoreboardGame
    let isExpanded: Bool
    let teamDetails: [String: TeamStatsDetailPayload]
    let teamLoadingKeys: Set<String>
    let playersCache: [String: TeamPlayersPayload]
    let playersLoadingKeys: Set<String>
    let onToggle: () -> Void
    let onLoadPlayers: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button(action: onToggle) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        statusBadge
                        Spacer()
                        if let date = formattedDate {
                            Text(date)
                                .font(.caption2)
                                .foregroundStyle(AppTheme.textSecondary)
                        }
                    }
                    scoreLine
                    if let odds = game.odds {
                        oddsLine(odds)
                    }
                    if let venue = game.venue {
                        Text(venue)
                            .font(.caption2)
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                }
            }
            .buttonStyle(.plain)

            if isExpanded {
                VStack(spacing: 12) {
                    if let awayKey = game.awayKey ?? game.awayTeam?.key {
                        TeamStatsDetailView(
                            detail: teamDetails[awayKey] ?? placeholderDetail(key: awayKey, team: game.awayTeam),
                            isLoading: teamLoadingKeys.contains(awayKey),
                            playersPayload: playersCache[awayKey],
                            playersLoading: playersLoadingKeys.contains(awayKey),
                            onLoadPlayers: { onLoadPlayers(awayKey) }
                        )
                    }
                    if let homeKey = game.homeKey ?? game.homeTeam?.key {
                        TeamStatsDetailView(
                            detail: teamDetails[homeKey] ?? placeholderDetail(key: homeKey, team: game.homeTeam),
                            isLoading: teamLoadingKeys.contains(homeKey),
                            playersPayload: playersCache[homeKey],
                            playersLoading: playersLoadingKeys.contains(homeKey),
                            onLoadPlayers: { onLoadPlayers(homeKey) }
                        )
                    }
                }
            }
        }
        .cardStyle()
    }

    private var statusBadge: some View {
        Text(game.statusLabel)
            .font(.caption.weight(.bold))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(statusColor.opacity(0.18))
            .foregroundStyle(statusColor)
            .clipShape(Capsule())
    }

    private var statusColor: Color {
        if game.isLive { return AppTheme.danger }
        if game.isFinal { return AppTheme.textSecondary }
        return AppTheme.accentSecondary
    }

    private var scoreLine: some View {
        let awayLeading = (game.awayScore ?? 0) > (game.homeScore ?? 0)
        let homeLeading = (game.homeScore ?? 0) > (game.awayScore ?? 0)

        return HStack(spacing: 12) {
            teamScore(
                label: teamLabel(game.awayTeam, fallback: "Away"),
                score: game.awayScore,
                leading: awayLeading
            )
            Text("@")
                .font(.caption.weight(.semibold))
                .foregroundStyle(AppTheme.textSecondary)
            teamScore(
                label: teamLabel(game.homeTeam, fallback: "Home"),
                score: game.homeScore,
                leading: homeLeading
            )
        }
    }

    private func teamScore(label: String, score: Int?, leading: Bool) -> some View {
        HStack(spacing: 8) {
            Text(label)
                .font(.subheadline.weight(leading ? .bold : .semibold))
                .foregroundStyle(leading ? AppTheme.textPrimary : AppTheme.textSecondary)
            Text(score.map(String.init) ?? "—")
                .font(.title2.weight(.bold).monospacedDigit())
                .foregroundStyle(leading ? AppTheme.textPrimary : AppTheme.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func oddsLine(_ odds: MarketOdds) -> some View {
        HStack(spacing: 10) {
            if let provider = odds.provider {
                Text(provider)
            }
            if let spread = odds.spread {
                Text("Spread \(String(format: "%+.1f", spread))")
            }
            if let total = odds.total {
                Text("Total \(String(format: "%.1f", total))")
            }
        }
        .font(.caption2.weight(.semibold))
        .foregroundStyle(AppTheme.textSecondary)
    }

    private func teamLabel(_ team: ScoreboardTeamRef?, fallback: String) -> String {
        team?.abbreviation ?? team?.name ?? fallback
    }

    private var formattedDate: String? {
        guard let date = game.date else { return nil }
        let prefix = String(date.prefix(16)).replacingOccurrences(of: "T", with: " ")
        return prefix.isEmpty ? nil : prefix
    }

    private func placeholderDetail(key: String, team: ScoreboardTeamRef?) -> TeamStatsDetailPayload {
        TeamStatsDetailPayload(
            teamKey: key,
            teamName: team?.name,
            record: team?.record,
            abbreviation: team?.abbreviation,
            team: team
        )
    }
}

#Preview {
    NavigationStack {
        ScoreboardView(store: ScoreboardStore())
    }
    .preferredColorScheme(.dark)
}
