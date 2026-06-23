import SwiftUI

struct TeamsView: View {
    @Bindable var store: TeamsStore

    var body: some View {
        List {
            controlsSection
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)

            if let warning = store.teamsPayload?.warning ?? store.errorMessage {
                Text(warning)
                    .font(.caption)
                    .foregroundStyle(AppTheme.warning)
                    .listRowBackground(Color.clear)
            }

            if !store.filteredTeams.isEmpty {
                summaryRow
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            if store.isLoading && store.teams.isEmpty {
                ProgressView("Loading teams…")
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
            } else if store.filteredTeams.isEmpty {
                ContentUnavailableView(
                    "No Teams",
                    systemImage: "person.3.sequence.fill",
                    description: Text(emptyDescription)
                )
                .listRowBackground(Color.clear)
            } else {
                ForEach(store.filteredTeams, id: \.key) { team in
                    NavigationLink {
                        TeamProfileView(store: store, team: team)
                    } label: {
                        TeamBoardCard(store: store, team: team)
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
        .navigationTitle("Team/s")
        .refreshable { await store.refresh() }
        .task {
            if store.teams.isEmpty {
                await store.refresh()
            }
        }
    }

    private var controlsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField("Search teams", text: $store.searchText)
                .textInputAutocapitalization(.never)
                .disableAutocorrection(true)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(AppTheme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(AppTheme.border, lineWidth: 1)
                )

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(TeamBoardSegment.allCases) { segment in
                        Button {
                            store.selectedSegment = segment
                        } label: {
                            filterChip(
                                label: segment.rawValue,
                                isSelected: store.selectedSegment == segment
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            HStack(spacing: 10) {
                Picker("Sort", selection: $store.selectedSort) {
                    ForEach(TeamBoardSort.allCases) { sort in
                        Text(sort.rawValue).tag(sort)
                    }
                }
                .pickerStyle(.menu)
                .tint(AppTheme.accentSecondary)

                Spacer()

                Toggle(isOn: $store.showOnlyPlayingToday) {
                    Text("Today")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(AppTheme.textSecondary)
                }
                .toggleStyle(.switch)
                .labelsHidden()

                Text("Today")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AppTheme.textSecondary)
            }
        }
        .padding(.vertical, 4)
    }

    private var summaryRow: some View {
        HStack(spacing: 10) {
            summaryTile(title: "Visible", value: "\(store.filteredTeams.count)", color: AppTheme.accent)
            summaryTile(title: "Playing", value: "\(store.filteredTeams.filter { store.todayStatus(for: $0.key) }.count)", color: AppTheme.warning)
            summaryTile(title: "Thin", value: "\(store.filteredTeams.filter { store.healthLabel(for: $0) == "Thin" }.count)", color: AppTheme.danger)
        }
    }

    private var emptyDescription: String {
        if let error = store.errorMessage {
            return error
        }
        return "Adjust the search or segment filters."
    }

    private func filterChip(label: String, isSelected: Bool) -> some View {
        Text(label)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(isSelected ? AppTheme.accent.opacity(0.22) : AppTheme.surface)
            .foregroundStyle(isSelected ? AppTheme.textPrimary : AppTheme.textSecondary)
            .clipShape(Capsule())
            .overlay(
                Capsule()
                    .stroke(isSelected ? AppTheme.accent : AppTheme.border, lineWidth: 1)
            )
    }

    private func summaryTile(title: String, value: String, color: Color) -> some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.title3.weight(.bold).monospacedDigit())
                .foregroundStyle(color)
            Text(title)
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

private struct TeamBoardCard: View {
    @Bindable var store: TeamsStore
    let team: LocalTeam

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(team.name)
                        .font(.headline.weight(.semibold))
                        .foregroundStyle(AppTheme.textPrimary)
                    Text(team.record ?? "—")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(AppTheme.textSecondary)
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 6) {
                    badge(text: store.trendLabel(for: team), color: trendColor)
                    badge(text: store.healthLabel(for: team), color: healthColor)
                    if store.todayStatus(for: team.key) {
                        badge(text: "Today", color: AppTheme.warning)
                    }
                }
            }

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                metric(label: "Last 5", value: team.last5 ?? "—")
                metric(label: "Last 10", value: team.last10 ?? "—")
                metric(label: "Net", value: formatStat(team.netRating))
                metric(label: "Pace", value: formatStat(team.pace))
                metric(label: "Home", value: team.homeRecord ?? "—")
                metric(label: "Away", value: team.awayRecord ?? "—")
            }

            HStack(spacing: 10) {
                miniBar(label: "Off", value: formatStat(team.offRating))
                miniBar(label: "Def", value: formatStat(team.defRating))
            }
        }
        .cardStyle()
    }

    private var trendColor: Color {
        switch store.trendLabel(for: team) {
        case "Rising": return AppTheme.success
        case "Sliding": return AppTheme.danger
        default: return AppTheme.accentSecondary
        }
    }

    private var healthColor: Color {
        switch store.healthLabel(for: team) {
        case "Thin": return AppTheme.danger
        case "Watch": return AppTheme.warning
        default: return AppTheme.success
        }
    }

    private func badge(text: String, color: Color) -> some View {
        Text(text)
            .font(.caption2.weight(.bold))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color.opacity(0.18))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }

    private func metric(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(AppTheme.textSecondary)
            Text(value)
                .font(.subheadline.weight(.semibold).monospacedDigit())
                .foregroundStyle(AppTheme.textPrimary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func miniBar(label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(AppTheme.textSecondary)
            Spacer()
            Text(value)
                .font(.caption.weight(.bold).monospacedDigit())
                .foregroundStyle(AppTheme.textPrimary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(AppTheme.surfaceElevated)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func formatStat(_ value: Double?) -> String {
        guard let value else { return "—" }
        return String(format: "%.1f", value)
    }
}

private struct TeamProfileView: View {
    @Bindable var store: TeamsStore
    let team: LocalTeam
    @State private var dossier: TeamRosterDossier?
    @State private var dossierLoading = false
    @State private var dossierError: String?

    var body: some View {
        List {
            snapshotSection
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)

            sectionCard(title: "Form and Splits") {
                profileGrid([
                    ("Last 5", team.last5 ?? "—"),
                    ("Last 10", team.last10 ?? "—"),
                    ("Home", team.homeRecord ?? "—"),
                    ("Away", team.awayRecord ?? "—"),
                    ("Avg Margin", formatStat(team.avgMargin)),
                    ("Record", team.record ?? "—")
                ])
            }

            sectionCard(title: "Style Profile") {
                profileGrid([
                    ("Off Rating", formatStat(team.offRating)),
                    ("Def Rating", formatStat(team.defRating)),
                    ("Net Rating", formatStat(detail?.stats?.netRating ?? team.netRating)),
                    ("Pace", formatStat(detail?.stats?.pace ?? team.pace)),
                    ("PPG", formatStat(detail?.stats?.ppg ?? team.ppg)),
                    ("Opp PPG", formatStat(detail?.stats?.oppPpg ?? team.oppPpg))
                ])
            }

            sectionCard(title: "Availability") {
                availabilityContent
            }

            sectionCard(title: "Player Production") {
                playerContent
            }

            sectionCard(title: "Roster Intel Dossier") {
                dossierContent
            }

            sectionCard(title: "Betting Relevance") {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(store.bettingNotes(for: team, detail: detail), id: \.self) { note in
                        Text(note)
                            .font(.subheadline)
                            .foregroundStyle(AppTheme.textPrimary)
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(AppTheme.background)
        .navigationTitle(team.name)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await store.loadProfile(teamKey: team.key)
            await loadDossier()
        }
    }

    private var detail: TeamStatsDetailPayload? {
        store.teamDetails[team.key.lowercased()]
    }

    private var playersPayload: TeamPlayersPayload? {
        store.playersCache[team.key.lowercased()]
    }

    private var injuries: [InjuryEntry] {
        store.injuries(for: team.key)
    }

    private var snapshotSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(team.name)
                        .font(.title3.weight(.bold))
                        .foregroundStyle(AppTheme.textPrimary)
                    Text(team.record ?? "—")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(AppTheme.textSecondary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 6) {
                    profileBadge(store.trendLabel(for: team), color: trendColor)
                    profileBadge(store.healthLabel(for: team), color: healthColor)
                }
            }

            profileGrid([
                ("Net", formatStat(detail?.stats?.netRating ?? team.netRating)),
                ("Pace", formatStat(detail?.stats?.pace ?? team.pace)),
                ("Last 5", team.last5 ?? "—"),
                ("Today", store.todayStatus(for: team.key) ? "Yes" : "No")
            ])
        }
        .cardStyle()
    }

    @ViewBuilder
    private var availabilityContent: some View {
        if let warning = detail?.warning {
            Text(warning)
                .font(.caption)
                .foregroundStyle(AppTheme.warning)
        }

        if injuries.isEmpty {
            Text("No active injury entries for this team.")
                .font(.subheadline)
                .foregroundStyle(AppTheme.textSecondary)
        } else {
            ForEach(injuries) { injury in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(injury.player)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(AppTheme.textPrimary)
                        Spacer()
                        Text(injury.status)
                            .font(.caption.weight(.bold))
                            .foregroundStyle(statusColor(injury.status))
                    }
                    if let note = injury.note, !note.isEmpty {
                        Text(note)
                            .font(.caption)
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                }
                if injury.id != injuries.last?.id {
                    Divider().overlay(AppTheme.border)
                }
            }
        }
    }

    @ViewBuilder
    private var playerContent: some View {
        if store.loadingPlayerKeys.contains(team.key.lowercased()) && playersPayload == nil {
            ProgressView("Loading players…")
                .font(.caption)
        } else if let players = playersPayload?.players, !players.isEmpty {
            if let warning = playersPayload?.warning {
                Text(warning)
                    .font(.caption2)
                    .foregroundStyle(AppTheme.warning)
            }
            PlayerStatsHeaderRow()
            ForEach(players.prefix(8)) { player in
                PlayerStatsRow(player: player)
                if player.id != players.prefix(8).last?.id {
                    Divider().overlay(AppTheme.border)
                }
            }
        } else {
            Text(playersPayload?.warning ?? "No player stats available.")
                .font(.subheadline)
                .foregroundStyle(AppTheme.textSecondary)
        }
    }

    @ViewBuilder
    private var dossierContent: some View {
        if dossierLoading && dossier == nil {
            ProgressView("Collecting public-source dossier…")
                .font(.caption)
        } else if let dossier {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    dossierBadge(text: dossier.verification.rawValue, color: dossierVerificationColor(dossier.verification))
                    Spacer()
                    Text("Conf. \(dossier.confidence)")
                        .font(.caption.monospacedDigit().weight(.bold))
                        .foregroundStyle(AppTheme.textSecondary)
                }

                Text("Generated \(formatTimestamp(dossier.generatedAt))")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(AppTheme.textSecondary)

                Text(dossier.summary)
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.textPrimary)

                ForEach(dossier.findings) { finding in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(finding.title)
                                .font(.subheadline.weight(.semibold))
                            Spacer()
                            Text("\(finding.confidence)")
                                .font(.caption.monospacedDigit().weight(.bold))
                                .foregroundStyle(AppTheme.textSecondary)
                        }
                        Text(finding.narrative)
                            .font(.caption)
                            .foregroundStyle(AppTheme.textSecondary)
                    }
                }

                Divider().overlay(AppTheme.border)

                VStack(alignment: .leading, spacing: 6) {
                    Text("Collection Coverage")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(AppTheme.textSecondary)
                    ForEach(dossier.coverage, id: \.kind) { coverage in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(alignment: .center) {
                                Text(coverage.kind.rawValue)
                                    .font(.caption.weight(.semibold))
                                    .frame(width: 72, alignment: .leading)
                                Text("\(coverage.count)")
                                    .font(.caption.monospacedDigit())
                                    .frame(width: 28, alignment: .leading)
                                dossierBadge(
                                    text: coverage.status.rawValue,
                                    color: dossierVerificationColor(coverage.status)
                                )
                                Spacer(minLength: 0)
                            }
                            Text(coverage.note)
                                .font(.caption)
                                .foregroundStyle(AppTheme.textSecondary)
                        }
                    }
                }

                if !dossier.evidence.isEmpty {
                    Divider().overlay(AppTheme.border)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Evidence")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(AppTheme.textSecondary)
                        ForEach(dossier.evidence.prefix(5)) { item in
                            VStack(alignment: .leading, spacing: 3) {
                                HStack {
                                    dossierBadge(text: item.kind.rawValue, color: dossierKindColor(item.kind))
                                    Text(item.sourceName)
                                        .font(.caption2)
                                        .foregroundStyle(AppTheme.textSecondary)
                                    Spacer()
                                    if let publishedAt = item.publishedAt, !publishedAt.isEmpty {
                                        Text(formatTimestamp(publishedAt))
                                            .font(.caption2.monospacedDigit())
                                            .foregroundStyle(AppTheme.textSecondary)
                                    }
                                }
                                if let url = item.url, let link = URL(string: url) {
                                    Link(item.title, destination: link)
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(AppTheme.accent)
                                } else {
                                    Text(item.title)
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(AppTheme.textPrimary)
                                }
                                Text(item.summary)
                                    .font(.caption2)
                                    .foregroundStyle(AppTheme.textSecondary)
                            }
                        }
                    }
                }

                if !dossier.gaps.isEmpty {
                    Divider().overlay(AppTheme.border)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Gaps")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(AppTheme.textSecondary)
                        ForEach(dossier.gaps, id: \.self) { gap in
                            Text(gap)
                                .font(.caption2)
                                .foregroundStyle(AppTheme.warning)
                        }
                    }
                }
            }
        } else if let dossierError {
            Text(dossierError)
                .font(.caption)
                .foregroundStyle(AppTheme.warning)
        } else {
            Text("No dossier available.")
                .font(.caption)
                .foregroundStyle(AppTheme.textSecondary)
        }
    }

    private var trendColor: Color {
        switch store.trendLabel(for: team) {
        case "Rising": return AppTheme.success
        case "Sliding": return AppTheme.danger
        default: return AppTheme.accentSecondary
        }
    }

    private var healthColor: Color {
        switch store.healthLabel(for: team) {
        case "Thin": return AppTheme.danger
        case "Watch": return AppTheme.warning
        default: return AppTheme.success
        }
    }

    private func profileBadge(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.caption.weight(.bold))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(color.opacity(0.18))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }

    private func profileGrid(_ pairs: [(String, String)]) -> some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
            ForEach(pairs, id: \.0) { pair in
                VStack(alignment: .leading, spacing: 3) {
                    Text(pair.0)
                        .font(.caption2)
                        .foregroundStyle(AppTheme.textSecondary)
                    Text(pair.1)
                        .font(.subheadline.weight(.semibold).monospacedDigit())
                        .foregroundStyle(AppTheme.textPrimary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func sectionCard<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.headline.weight(.semibold))
                .foregroundStyle(AppTheme.textPrimary)
            content()
        }
        .cardStyle()
    }

    private func dossierBadge(text: String, color: Color) -> some View {
        Text(text)
            .font(.caption2.weight(.bold))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color.opacity(0.16))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }

    private func dossierKindColor(_ kind: IntelSourceKind) -> Color {
        switch kind {
        case .database: return AppTheme.success
        case .official: return AppTheme.accent
        case .transactions: return AppTheme.warning
        case .news: return AppTheme.accentSecondary
        case .social: return AppTheme.warning
        case .regulatory: return AppTheme.danger
        }
    }

    private func dossierVerificationColor(_ verification: IntelVerificationStatus) -> Color {
        switch verification {
        case .verified: return AppTheme.success
        case .crossReferenced: return AppTheme.accentSecondary
        case .singleSource: return AppTheme.warning
        case .unavailable: return AppTheme.danger
        }
    }

    private func statusColor(_ status: String) -> Color {
        let lower = status.lowercased()
        if lower.contains("out") { return AppTheme.danger }
        if lower.contains("question") || lower.contains("doubt") { return AppTheme.warning }
        return AppTheme.success
    }

    private func formatStat(_ value: Double?) -> String {
        guard let value else { return "—" }
        return String(format: "%.1f", value)
    }

    private func formatTimestamp(_ value: String) -> String {
        if let date = ISO8601DateFormatter().date(from: value) {
            return date.formatted(date: .abbreviated, time: .shortened)
        }
        if let date = Self.rfc822Formatter.date(from: value) {
            return date.formatted(date: .abbreviated, time: .omitted)
        }
        return value
    }

    private func loadDossier() async {
        dossierLoading = true
        dossierError = nil
        defer { dossierLoading = false }

        let dossierPlayers = playersPayload
        let dossierDetail = detail
        let dossierInjuries = injuries
        dossier = await RosterIntelService.shared.buildDossier(
            team: team,
            detail: dossierDetail,
            players: dossierPlayers,
            injuries: dossierInjuries
        )
    }

    private static let rfc822Formatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss Z"
        return formatter
    }()
}

#Preview {
    NavigationStack {
        TeamsView(store: TeamsStore())
    }
    .preferredColorScheme(.dark)
}
