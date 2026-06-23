import SwiftUI

struct TeamStatsDetailView: View {
    let detail: TeamStatsDetailPayload
    let isLoading: Bool
    let playersPayload: TeamPlayersPayload?
    let playersLoading: Bool
    let onLoadPlayers: () -> Void

    @State private var showPlayers = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text(detail.teamName ?? detail.team?.name ?? detail.teamKey.uppercased())
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                Spacer()
                Text(detail.record ?? detail.team?.record ?? "—")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(AppTheme.textSecondary)
            }

            if isLoading {
                ProgressView("Loading stats…")
                    .font(.caption)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else if let error = detail.error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(AppTheme.danger)
            } else {
                if let warning = detail.warning {
                    Text(warning)
                        .font(.caption2)
                        .foregroundStyle(AppTheme.warning)
                }
                statGrid
            }

            Button {
                if !showPlayers {
                    onLoadPlayers()
                }
                showPlayers.toggle()
            } label: {
                HStack(spacing: 6) {
                    Text(showPlayers ? "Hide player stats" : "Player stats")
                        .font(.caption.weight(.semibold))
                    Image(systemName: showPlayers ? "chevron.up" : "chevron.down")
                        .font(.caption2.weight(.bold))
                }
                .foregroundStyle(AppTheme.accentSecondary)
            }
            .buttonStyle(.plain)

            if showPlayers {
                playersSection
            }
        }
        .cardStyle()
    }

    private var statGrid: some View {
        let stats = detail.stats
        let rows: [(String, String)] = [
            ("PPG", formatStat(stats?.ppg)),
            ("OPP PPG", formatStat(stats?.oppPpg)),
            ("FG%", formatPct(stats?.fgPct)),
            ("3P%", formatPct(stats?.fg3Pct)),
            ("FT%", formatPct(stats?.ftPct)),
            ("REB", formatStat(stats?.rebounds)),
            ("AST", formatStat(stats?.assists)),
            ("TO", formatStat(stats?.turnovers)),
            ("Net", formatStat(stats?.netRating)),
            ("Pace", formatStat(stats?.pace))
        ]

        return LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
            ForEach(rows, id: \.0) { row in
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.0)
                        .font(.caption2)
                        .foregroundStyle(AppTheme.textSecondary)
                    Text(row.1)
                        .font(.subheadline.weight(.semibold).monospacedDigit())
                        .foregroundStyle(AppTheme.textPrimary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    @ViewBuilder
    private var playersSection: some View {
        if playersLoading {
            ProgressView("Loading players…")
                .font(.caption)
        } else if let players = playersPayload?.players, !players.isEmpty {
            if let warning = playersPayload?.warning {
                Text(warning)
                    .font(.caption2)
                    .foregroundStyle(AppTheme.warning)
            }
            PlayerStatsHeaderRow()
            ForEach(players) { player in
                PlayerStatsRow(player: player)
                if player.id != players.last?.id {
                    Divider().overlay(AppTheme.border)
                }
            }
        } else {
            Text(playersPayload?.warning ?? "No player stats available.")
                .font(.caption)
                .foregroundStyle(AppTheme.textSecondary)
        }
    }

    private func formatStat(_ value: Double?) -> String {
        guard let value else { return "—" }
        if value == value.rounded() && abs(value) < 1000 {
            return String(format: "%.0f", value)
        }
        return String(format: "%.1f", value)
    }

    private func formatPct(_ value: Double?) -> String {
        guard let value else { return "—" }
        if value > 0 && value <= 1 {
            return String(format: "%.1f%%", value * 100)
        }
        return String(format: "%.1f%%", value)
    }
}

#Preview {
    ScrollView {
        TeamStatsDetailView(
            detail: TeamStatsDetailPayload(
                teamKey: "las",
                teamName: "Las Vegas Aces",
                record: "12-3",
                stats: TeamSeasonStats(
                    ppg: 88.4,
                    oppPpg: 79.5,
                    fgPct: 48.0,
                    fg3Pct: 36.2,
                    ftPct: 74.7,
                    rebounds: 36.4,
                    assists: 23.5,
                    turnovers: 12.7,
                    netRating: 11.3,
                    pace: 95.8,
                    gamesPlayed: 15
                ),
                source: "espn"
            ),
            isLoading: false,
            playersPayload: nil,
            playersLoading: false,
            onLoadPlayers: {}
        )
        .padding()
    }
    .background(AppTheme.background)
    .preferredColorScheme(.dark)
}
