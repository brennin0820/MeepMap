import SwiftUI

struct PlayerStatsRow: View {
    let player: PlayerSeasonStats

    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(player.name)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                    .lineLimit(1)
                if let jersey = player.jersey, !jersey.isEmpty {
                    Text("#\(jersey)")
                        .font(.caption2)
                        .foregroundStyle(AppTheme.textSecondary)
                }
            }
            .frame(minWidth: 88, alignment: .leading)

            statCell(player.position ?? "—", width: 32)
            statCell(formatStat(player.mpg), width: 36)
            statCell(formatStat(player.ppg), width: 36)
            statCell(formatStat(player.rpg), width: 36)
            statCell(formatStat(player.apg), width: 36)
            statCell(formatPct(player.fgPct), width: 40)
        }
        .font(.caption.monospacedDigit())
        .padding(.vertical, 6)
    }

    private func statCell(_ text: String, width: CGFloat) -> some View {
        Text(text)
            .foregroundStyle(AppTheme.textSecondary)
            .frame(width: width, alignment: .trailing)
    }

    private func formatStat(_ value: Double?) -> String {
        guard let value else { return "—" }
        if value == value.rounded() && abs(value) < 100 {
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

struct PlayerStatsHeaderRow: View {
    var body: some View {
        HStack(spacing: 8) {
            Text("Player")
                .frame(minWidth: 88, alignment: .leading)
            headerCell("Pos", width: 32)
            headerCell("MIN", width: 36)
            headerCell("PTS", width: 36)
            headerCell("REB", width: 36)
            headerCell("AST", width: 36)
            headerCell("FG%", width: 40)
        }
        .font(.caption2.weight(.semibold))
        .foregroundStyle(AppTheme.textSecondary)
        .padding(.bottom, 4)
    }

    private func headerCell(_ title: String, width: CGFloat) -> some View {
        Text(title)
            .frame(width: width, alignment: .trailing)
    }
}

#Preview {
    VStack {
        PlayerStatsHeaderRow()
        PlayerStatsRow(player: PlayerSeasonStats(
            id: "1",
            name: "A'ja Wilson",
            position: "F",
            jersey: "22",
            mpg: 31.9,
            ppg: 26.1,
            rpg: 9.1,
            apg: 3.1,
            fgPct: 52.6
        ))
    }
    .padding()
    .background(AppTheme.background)
    .preferredColorScheme(.dark)
}
