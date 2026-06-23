import Foundation

actor RosterIntelService {
    static let shared = RosterIntelService()

    private static let rosterTrackerURL = URL(string: "https://www.wnba.com/players/roster-tracker")!
    private static let officialSiteByTeamKey: [String: String] = [
        "atl": "https://dream.wnba.com/",
        "chi": "https://sky.wnba.com/",
        "con": "https://sun.wnba.com/",
        "dal": "https://wings.wnba.com/",
        "ind": "https://fever.wnba.com/",
        "las": "https://aces.wnba.com/",
        "min": "https://lynx.wnba.com/",
        "ny": "https://liberty.wnba.com/",
        "phx": "https://mercury.wnba.com/",
        "sea": "https://storm.wnba.com/",
        "was": "https://mystics.wnba.com/",
        "gs": "https://valkyries.wnba.com/",
        "tor": "https://tempo.wnba.com/",
        "fire": "https://fire.wnba.com/",
        "la": "https://sparks.wnba.com/",
        "sparks": "https://sparks.wnba.com/"
    ]

    private let session: URLSession
    private let isoFormatter = ISO8601DateFormatter()
    private let dossierCacheTTL: TimeInterval = 15 * 60
    private var dossierCache: [String: CachedDossier] = [:]

    init(session: URLSession = .shared) {
        self.session = session
    }

    func buildDossier(
        team: LocalTeam,
        detail: TeamStatsDetailPayload?,
        players: TeamPlayersPayload?,
        injuries: [InjuryEntry]
    ) async -> TeamRosterDossier {
        let cacheKey = team.key.lowercased()
        let fingerprint = dossierFingerprint(team: team, detail: detail, players: players, injuries: injuries)
        if let cached = dossierCache[cacheKey],
           cached.fingerprint == fingerprint,
           Date().timeIntervalSince(cached.createdAt) < dossierCacheTTL {
            return cached.dossier
        }

        let databaseEvidence = buildDatabaseEvidence(team: team, detail: detail, players: players, injuries: injuries)
        async let officialResult = fetchOfficialSiteEvidence(team: team, players: players, injuries: injuries)
        async let transactionResult = fetchRosterTrackerEvidence(team: team)
        async let newsResult = fetchNewsEvidence(team: team, players: players, injuries: injuries)

        let official = await officialResult
        let transactions = await transactionResult
        let news = await newsResult

        let sourceResults = [official, transactions, news]
        let evidence = (databaseEvidence + sourceResults.flatMap(\.evidence)).sorted { lhs, rhs in
            (lhs.publishedAt ?? "") > (rhs.publishedAt ?? "")
        }
        let findings = buildFindings(team: team, detail: detail, players: players, injuries: injuries, evidence: evidence)
        let confidence = dossierConfidence(findings: findings, evidence: evidence)
        let verification = dossierVerification(findings: findings)

        let coverage = [
            RosterIntelCoverage(
                kind: .database,
                status: .verified,
                count: databaseEvidence.count,
                note: "Built from live or cached team stats, roster, and injury datasets already inside the app."
            )
        ] + sourceResults.map { result in
            RosterIntelCoverage(
                kind: result.kind,
                status: result.status,
                count: result.evidence.count,
                note: result.note
            )
        }

        let summary = buildSummary(team: team, findings: findings, coverage: coverage)

        var gaps = coverage
            .filter { $0.status == .unavailable || $0.count == 0 }
            .map(\.note)
        gaps.append("Social collection is intentionally disabled until a real public-source collector is wired.")
        gaps.append("Regulatory and ownership filing collection is not mapped in this standalone iOS app.")

        let dossier = TeamRosterDossier(
            teamKey: team.key,
            teamName: team.name,
            generatedAt: isoFormatter.string(from: Date()),
            summary: summary,
            confidence: confidence,
            verification: verification,
            findings: findings,
            evidence: evidence,
            coverage: coverage,
            gaps: uniqueStrings(gaps)
        )

        dossierCache[cacheKey] = CachedDossier(
            fingerprint: fingerprint,
            createdAt: Date(),
            dossier: dossier
        )
        return dossier
    }

    private func buildDatabaseEvidence(
        team: LocalTeam,
        detail: TeamStatsDetailPayload?,
        players: TeamPlayersPayload?,
        injuries: [InjuryEntry]
    ) -> [RosterIntelEvidence] {
        var evidence: [RosterIntelEvidence] = []

        let net = detail?.stats?.netRating ?? team.netRating
        let pace = detail?.stats?.pace ?? team.pace
        let off = detail?.stats?.ppg ?? team.ppg
        let opp = detail?.stats?.oppPpg ?? team.oppPpg
        evidence.append(RosterIntelEvidence(
            id: "\(team.key)-team-profile",
            kind: .database,
            sourceName: detail?.source ?? "WNBA data stack",
            title: "Team profile baseline",
            summary: [
                "Record \(team.record ?? "—")",
                "Net \(fmt(net))",
                "Pace \(fmt(pace))",
                "PPG \(fmt(off))",
                "Opp PPG \(fmt(opp))"
            ].joined(separator: " · "),
            url: nil,
            publishedAt: detail?.lastUpdated,
            confidence: 88,
            verification: .verified
        ))

        if let players, !players.players.isEmpty {
            let topPlayers = players.players.prefix(3)
            let names = topPlayers.map { player in
                "\(player.name) \(fmt(player.ppg)) ppg"
            }.joined(separator: ", ")
            evidence.append(RosterIntelEvidence(
                id: "\(team.key)-player-production",
                kind: .database,
                sourceName: players.source ?? "ESPN roster stats",
                title: "Top player production",
                summary: names,
                url: nil,
                publishedAt: players.lastUpdated,
                confidence: players.isLive == true ? 84 : 72,
                verification: .verified
            ))
        }

        let severeInjuries = injuries.filter { injury in
            let status = injury.status.lowercased()
            return status.contains("out") || status.contains("doubt")
        }
        evidence.append(RosterIntelEvidence(
            id: "\(team.key)-availability",
            kind: .database,
            sourceName: "Injury feed",
            title: "Availability status",
            summary: severeInjuries.isEmpty
                ? "No severe injury entries currently listed."
                : "\(severeInjuries.count) severe availability flags: \(severeInjuries.prefix(3).map(\.player).joined(separator: ", "))",
            url: nil,
            publishedAt: nil,
            confidence: injuries.isEmpty ? 68 : 82,
            verification: injuries.isEmpty ? .singleSource : .verified
        ))

        return evidence
    }

    private func fetchOfficialSiteEvidence(
        team: LocalTeam,
        players: TeamPlayersPayload?,
        injuries: [InjuryEntry]
    ) async -> SourceCollectionResult {
        guard let urlString = Self.officialSiteByTeamKey[team.key.lowercased()] ?? Self.officialSiteByTeamKey[team.name.lowercased()],
              let url = URL(string: urlString) else {
            return SourceCollectionResult(
                kind: .official,
                evidence: [],
                status: .unavailable,
                note: "No official team site mapping is configured for \(team.name)."
            )
        }

        do {
            let html = try await fetchHTML(url: url)
            let evidence = parseOfficialHeadlines(from: html, siteURL: url, team: team, players: players, injuries: injuries)
            return SourceCollectionResult(
                kind: .official,
                evidence: evidence,
                status: .verified,
                note: evidence.isEmpty
                    ? "Official team site loaded, but no roster-relevant headlines matched the current query."
                    : "Collected roster-relevant official team site headlines."
            )
        } catch {
            return SourceCollectionResult(
                kind: .official,
                evidence: [],
                status: .unavailable,
                note: "Official team site could not be collected during this pass."
            )
        }
    }

    private func fetchRosterTrackerEvidence(team: LocalTeam) async -> SourceCollectionResult {
        do {
            let html = try await fetchHTML(url: Self.rosterTrackerURL)
            guard let tile = parseRosterTrackerTile(from: html, team: team) else {
                return SourceCollectionResult(
                    kind: .transactions,
                    evidence: [],
                    status: .unavailable,
                    note: "Official WNBA roster tracker did not return a team tile for \(team.name)."
                )
            }

            let summaryParts = [
                tile.record.map { "Record \($0)" },
                tile.rosterSize.map { "Roster size \($0)" },
                tile.draftPicks.map { "Draft picks \($0)" }
            ].compactMap { $0 }

            let evidence = [
                RosterIntelEvidence(
                    id: "\(team.key)-roster-tracker",
                    kind: .transactions,
                    sourceName: "WNBA roster tracker",
                    title: "Official roster tracker snapshot",
                    summary: summaryParts.joined(separator: " · "),
                    url: tile.transactionsURL,
                    publishedAt: nil,
                    confidence: 86,
                    verification: .verified
                )
            ]

            return SourceCollectionResult(
                kind: .transactions,
                evidence: evidence,
                status: .verified,
                note: "Collected official WNBA roster tracker data and direct team transactions link."
            )
        } catch {
            return SourceCollectionResult(
                kind: .transactions,
                evidence: [],
                status: .unavailable,
                note: "Official WNBA roster tracker could not be collected during this pass."
            )
        }
    }

    private func fetchNewsEvidence(
        team: LocalTeam,
        players: TeamPlayersPayload?,
        injuries: [InjuryEntry]
    ) async -> SourceCollectionResult {
        let queryTerms = [
            team.name,
            injuries.first?.player,
            players?.players.first?.name,
            "WNBA roster injuries transactions"
        ].compactMap { $0 }.joined(separator: " ")

        guard let encoded = queryTerms.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let url = URL(string: "https://news.google.com/rss/search?q=\(encoded)&hl=en-US&gl=US&ceid=US:en") else {
            return SourceCollectionResult(
                kind: .news,
                evidence: [],
                status: .unavailable,
                note: "News archive query could not be constructed."
            )
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = 20
        request.setValue("Mozilla/5.0", forHTTPHeaderField: "User-Agent")

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                return SourceCollectionResult(
                    kind: .news,
                    evidence: [],
                    status: .unavailable,
                    note: "News archive request returned a non-success response."
                )
            }
            let items = GoogleNewsRSSParser.parse(data: data)
            let evidence = items.prefix(10).enumerated().compactMap { index, item -> RosterIntelEvidence? in
                let confidence = newsConfidence(title: item.title, players: players, injuries: injuries)
                guard confidence >= 70 else { return nil }
                return RosterIntelEvidence(
                    id: "\(team.key)-news-\(index)",
                    kind: .news,
                    sourceName: item.sourceName ?? "Google News",
                    title: item.title,
                    summary: item.description.isEmpty ? "Public archive hit related to roster, injuries, or transactions." : item.description,
                    url: item.link,
                    publishedAt: item.pubDate,
                    confidence: confidence,
                    verification: confidence >= 82 ? .crossReferenced : .singleSource
                )
            }

            let status: IntelVerificationStatus
            if evidence.contains(where: { $0.verification == .crossReferenced }) {
                status = .crossReferenced
            } else if !items.isEmpty {
                status = .verified
            } else {
                status = .verified
            }

            return SourceCollectionResult(
                kind: .news,
                evidence: evidence,
                status: status,
                note: evidence.isEmpty
                    ? "Public archive feed loaded, but no roster-relevant headlines matched the current query."
                    : "Public archive headlines collected from Google News RSS."
            )
        } catch {
            return SourceCollectionResult(
                kind: .news,
                evidence: [],
                status: .unavailable,
                note: "Public archive feed could not be collected during this pass."
            )
        }
    }

    private func buildFindings(
        team: LocalTeam,
        detail: TeamStatsDetailPayload?,
        players: TeamPlayersPayload?,
        injuries: [InjuryEntry],
        evidence: [RosterIntelEvidence]
    ) -> [RosterIntelFinding] {
        var findings: [RosterIntelFinding] = []

        let severeInjuries = injuries.filter { entry in
            let status = entry.status.lowercased()
            return status.contains("out") || status.contains("doubt")
        }
        let availabilityKinds = sourceKindsForAvailability(injuries: severeInjuries, evidence: evidence)
        findings.append(RosterIntelFinding(
            id: "\(team.key)-availability-finding",
            title: "Availability picture",
            narrative: severeInjuries.isEmpty
                ? "\(team.name) has no severe availability flags in the collected public dataset."
                : "\(team.name) is carrying \(severeInjuries.count) severe availability concern(s), led by \(severeInjuries.prefix(2).map(\.player).joined(separator: ", ")).",
            confidence: availabilityKinds.count > 1 ? 86 : (severeInjuries.isEmpty ? 72 : 82),
            verification: availabilityKinds.count > 1 ? .crossReferenced : (severeInjuries.isEmpty ? .singleSource : .verified),
            sourceKinds: Array(availabilityKinds)
        ))

        if let players, !players.players.isEmpty {
            let lead = players.players.sorted { ($0.ppg ?? 0) > ($1.ppg ?? 0) }
            let topThree = lead.prefix(3)
            let totalTop = topThree.reduce(0.0) { $0 + ($1.ppg ?? 0) }
            let teamPoints = detail?.stats?.ppg ?? team.ppg ?? 82
            let share = teamPoints > 0 ? (totalTop / teamPoints) : 0
            findings.append(RosterIntelFinding(
                id: "\(team.key)-scoring-finding",
                title: "Scoring concentration",
                narrative: share >= 0.55
                    ? "The offense is concentrated: top producers account for roughly \(Int((share * 100).rounded()))% of team scoring, which raises roster fragility."
                    : "Scoring is more distributed: top producers account for roughly \(Int((share * 100).rounded()))% of team scoring.",
                confidence: 82,
                verification: .verified,
                sourceKinds: [.database]
            ))
        }

        if let tracker = evidence.first(where: { $0.kind == .transactions }) {
            findings.append(RosterIntelFinding(
                id: "\(team.key)-transactions-finding",
                title: "Roster transactions lane",
                narrative: "Official roster-tracker snapshot: \(tracker.summary).",
                confidence: tracker.confidence,
                verification: tracker.verification,
                sourceKinds: [.transactions]
            ))
        }

        let narrativeEvidence = evidence.filter { $0.kind == .official || $0.kind == .news }
        let narrativeKinds = Set(narrativeEvidence.map(\.kind))
        findings.append(RosterIntelFinding(
            id: "\(team.key)-news-finding",
            title: "Public narrative",
            narrative: narrativeEvidence.isEmpty
                ? "No roster-relevant official or archive headlines were collected in this pass."
                : "Recent public-source headlines: \(narrativeEvidence.prefix(2).map(\.title).joined(separator: " | ")).",
            confidence: narrativeKinds.count > 1 ? 80 : (narrativeEvidence.isEmpty ? 58 : 72),
            verification: narrativeKinds.count > 1 ? .crossReferenced : (narrativeEvidence.isEmpty ? .singleSource : .verified),
            sourceKinds: narrativeKinds.isEmpty ? [.news] : Array(narrativeKinds)
        ))

        return findings
    }

    private func dossierConfidence(findings: [RosterIntelFinding], evidence: [RosterIntelEvidence]) -> Int {
        let findingScore = findings.isEmpty ? 0 : findings.map(\.confidence).reduce(0, +) / findings.count
        let evidenceScore = evidence.isEmpty ? 0 : evidence.map(\.confidence).reduce(0, +) / evidence.count
        return Int(((Double(findingScore) * 0.65) + (Double(evidenceScore) * 0.35)).rounded())
    }

    private func dossierVerification(findings: [RosterIntelFinding]) -> IntelVerificationStatus {
        if findings.contains(where: { Set($0.sourceKinds).count > 1 }) {
            return .crossReferenced
        }
        if findings.allSatisfy({ $0.verification == .verified }) {
            return .verified
        }
        return .singleSource
    }

    private func buildSummary(
        team: LocalTeam,
        findings: [RosterIntelFinding],
        coverage: [RosterIntelCoverage]
    ) -> String {
        let leading = findings.prefix(3).map(\.title).joined(separator: ", ")
        let collectedKinds = coverage
            .filter { $0.count > 0 }
            .map(\.kind)
            .filter { $0 != .database }
        let sourceLine: String
        if collectedKinds.isEmpty {
            sourceLine = "internal roster datasets only"
        } else {
            let labels = collectedKinds.map { $0.rawValue.lowercased() }
            sourceLine = "internal roster data plus \(joinedSourceLabels(labels))"
        }
        return "\(team.name) dossier synthesized from \(sourceLine). Primary watch items: \(leading)."
    }

    private func dossierFingerprint(
        team: LocalTeam,
        detail: TeamStatsDetailPayload?,
        players: TeamPlayersPayload?,
        injuries: [InjuryEntry]
    ) -> String {
        let injuryFingerprint = injuries
            .map { "\($0.id)|\($0.status)|\($0.note ?? "")" }
            .sorted()
            .joined(separator: "#")
        let playerFingerprint = players?.players
            .prefix(8)
            .map { "\($0.id)|\($0.name)|\(fmt($0.ppg))" }
            .joined(separator: "#") ?? "no-players"
        return [
            team.key.lowercased(),
            team.record ?? "no-record",
            detail?.lastUpdated ?? "no-detail-date",
            players?.lastUpdated ?? "no-players-date",
            playerFingerprint,
            injuryFingerprint.isEmpty ? "no-injuries" : injuryFingerprint
        ].joined(separator: "::")
    }

    private func joinedSourceLabels(_ labels: [String]) -> String {
        let unique = uniqueStrings(labels)
        switch unique.count {
        case 0:
            return "internal data"
        case 1:
            return unique[0]
        case 2:
            return "\(unique[0]) and \(unique[1])"
        default:
            let head = unique.dropLast().joined(separator: ", ")
            return "\(head), and \(unique.last ?? "")"
        }
    }

    private func fetchHTML(url: URL) async throws -> String {
        var request = URLRequest(url: url)
        request.timeoutInterval = 20
        request.setValue("Mozilla/5.0", forHTTPHeaderField: "User-Agent")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return String(decoding: data, as: UTF8.self)
    }

    private func parseOfficialHeadlines(
        from html: String,
        siteURL: URL,
        team: LocalTeam,
        players: TeamPlayersPayload?,
        injuries: [InjuryEntry]
    ) -> [RosterIntelEvidence] {
        let pattern = #"<a[^>]+href=\"([^\"]*\/news\/[^\"]+)\"[^>]*>(.*?)<\/a>"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
            return []
        }
        let nsRange = NSRange(html.startIndex..., in: html)
        let matches = regex.matches(in: html, options: [], range: nsRange)
        var seen = Set<String>()
        var evidence: [RosterIntelEvidence] = []

        for (index, match) in matches.enumerated() {
            guard let hrefRange = Range(match.range(at: 1), in: html),
                  let textRange = Range(match.range(at: 2), in: html) else {
                continue
            }
            let rawURL = String(html[hrefRange])
            let url = normalizedURL(rawURL, baseURL: siteURL)
            let title = cleanHTML(String(html[textRange]))
            guard !title.isEmpty, title.count >= 12 else { continue }
            guard isRosterRelevant(title: title, team: team, players: players, injuries: injuries) else { continue }

            let identity = "\(url ?? title)"
            guard seen.insert(identity).inserted else { continue }

            let searchWindow = surroundingSnippet(in: html, around: match.range, radius: 220)
            let publishedAt = firstMatch(in: searchWindow, pattern: monthDatePattern)
            let confidence = officialConfidence(title: title, players: players, injuries: injuries)
            evidence.append(RosterIntelEvidence(
                id: "\(team.key)-official-\(index)",
                kind: .official,
                sourceName: "\(team.name) official site",
                title: title,
                summary: "Official team-site headline relevant to roster, availability, or transactions.",
                url: url,
                publishedAt: publishedAt,
                confidence: confidence,
                verification: confidence >= 86 ? .crossReferenced : .singleSource
            ))
        }

        return Array(evidence.prefix(5))
    }

    private func parseRosterTrackerTile(from html: String, team: LocalTeam) -> RosterTrackerTile? {
        guard let marker = transactionQueryValue(for: team) else { return nil }
        guard let snippet = surroundingSnippet(in: html, marker: "/players/transactions?team=\(marker)", radiusBefore: 1400, radiusAfter: 300) else {
            return nil
        }

        let rosterSize = firstMatch(in: snippet, pattern: #"Curent Roster Size:<\/p><p[^>]*>(\d+)"#).flatMap(Int.init)
        let draftPicks = firstMatch(in: snippet, pattern: #"Draft Picks:<\/p><p[^>]*>(\d+)"#).flatMap(Int.init)
        let wins = firstMatch(in: snippet, pattern: #"Record:\s*<!-- -->\s*(\d+)\s*<!-- --> - <!-- -->\s*(\d+)"#, group: 1)
        let losses = firstMatch(in: snippet, pattern: #"Record:\s*<!-- -->\s*(\d+)\s*<!-- --> - <!-- -->\s*(\d+)"#, group: 2)
        let record: String?
        if let wins, let losses {
            record = "\(wins)-\(losses)"
        } else {
            record = nil
        }

        guard rosterSize != nil || draftPicks != nil || record != nil else { return nil }

        return RosterTrackerTile(
            record: record,
            rosterSize: rosterSize,
            draftPicks: draftPicks,
            transactionsURL: "https://www.wnba.com/players/transactions?team=\(marker)"
        )
    }

    private func sourceKindsForAvailability(injuries: [InjuryEntry], evidence: [RosterIntelEvidence]) -> Set<IntelSourceKind> {
        var kinds: Set<IntelSourceKind> = [.database]
        guard !injuries.isEmpty else { return kinds }

        let playerTokens = injuries.map { $0.player.lowercased() }
        let statusTokens = ["injury", "out", "doubtful", "questionable", "available", "return", "returns"]

        for item in evidence where item.kind != .database {
            let haystack = "\(item.title) \(item.summary)".lowercased()
            if playerTokens.contains(where: { haystack.contains($0) }) || statusTokens.contains(where: { haystack.contains($0) }) {
                kinds.insert(item.kind)
            }
        }

        return kinds
    }

    private func isRosterRelevant(
        title: String,
        team: LocalTeam,
        players: TeamPlayersPayload?,
        injuries: [InjuryEntry]
    ) -> Bool {
        let lower = title.lowercased()
        let playerNames = (players?.players ?? []).prefix(10).map { $0.name.lowercased() }
        let injuryNames = injuries.prefix(10).map { $0.player.lowercased() }
        let tokens = [
            "waive", "waived", "sign", "signed", "trade", "transaction", "roster",
            "hardship", "contract", "injury", "out", "doubtful", "questionable",
            "available", "return", "returns", "activate", "activated", "suspend", "suspension"
        ]
        return playerNames.contains(where: { lower.contains($0) })
            || injuryNames.contains(where: { lower.contains($0) })
            || tokens.contains(where: { lower.contains($0) })
            || lower.contains(team.name.lowercased()) && tokens.contains(where: { lower.contains($0) })
    }

    private func officialConfidence(title: String, players: TeamPlayersPayload?, injuries: [InjuryEntry]) -> Int {
        let lower = title.lowercased()
        let playerNames = Set((players?.players ?? []).prefix(8).map { $0.name.lowercased() })
        let injuryNames = Set(injuries.prefix(8).map { $0.player.lowercased() })
        if playerNames.contains(where: { lower.contains($0) }) || injuryNames.contains(where: { lower.contains($0) }) {
            return 88
        }
        if isTransactionHeadline(title) {
            return 84
        }
        return 76
    }

    private func newsConfidence(title: String, players: TeamPlayersPayload?, injuries: [InjuryEntry]) -> Int {
        let lower = title.lowercased()
        let playerNames = Set((players?.players ?? []).prefix(8).map { $0.name.lowercased() })
        let injuryNames = Set(injuries.prefix(8).map { $0.player.lowercased() })
        if playerNames.contains(where: { lower.contains($0) }) || injuryNames.contains(where: { lower.contains($0) }) {
            return 82
        }
        if isTransactionHeadline(title) {
            return 74
        }
        return 64
    }

    private func isTransactionHeadline(_ title: String) -> Bool {
        let lower = title.lowercased()
        let tokens = ["waive", "waived", "signed", "signs", "trade", "roster", "injury", "out", "doubtful", "questionable", "transaction", "contract", "hardship"]
        return tokens.contains { lower.contains($0) }
    }

    private func normalizedURL(_ raw: String, baseURL: URL) -> String? {
        if raw.hasPrefix("http://") || raw.hasPrefix("https://") {
            return raw
        }
        return URL(string: raw, relativeTo: baseURL)?.absoluteURL.absoluteString
    }

    private func surroundingSnippet(in text: String, marker: String, radiusBefore: Int, radiusAfter: Int) -> String? {
        guard let range = text.range(of: marker) else { return nil }
        let lower = text.index(range.lowerBound, offsetBy: -radiusBefore, limitedBy: text.startIndex) ?? text.startIndex
        let upper = text.index(range.upperBound, offsetBy: radiusAfter, limitedBy: text.endIndex) ?? text.endIndex
        return String(text[lower..<upper])
    }

    private func surroundingSnippet(in text: String, around range: NSRange, radius: Int) -> String {
        guard let stringRange = Range(range, in: text) else { return text }
        let lower = text.index(stringRange.lowerBound, offsetBy: -radius, limitedBy: text.startIndex) ?? text.startIndex
        let upper = text.index(stringRange.upperBound, offsetBy: radius, limitedBy: text.endIndex) ?? text.endIndex
        return String(text[lower..<upper])
    }

    private func firstMatch(in text: String, pattern: String, group: Int = 1) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
            return nil
        }
        let nsRange = NSRange(text.startIndex..., in: text)
        guard let match = regex.firstMatch(in: text, options: [], range: nsRange),
              let range = Range(match.range(at: group), in: text) else {
            return nil
        }
        return cleanHTML(String(text[range]))
    }

    private func cleanHTML(_ value: String) -> String {
        value
            .replacingOccurrences(of: "<[^>]+>", with: " ", options: .regularExpression)
            .replacingOccurrences(of: "&nbsp;", with: " ")
            .replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&#39;", with: "'")
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func transactionQueryValue(for team: LocalTeam) -> String? {
        team.name.components(separatedBy: .whitespacesAndNewlines).last?
            .addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)
    }

    private func fmt(_ value: Double?) -> String {
        guard let value else { return "—" }
        return String(format: "%.1f", value)
    }

    private func uniqueStrings(_ values: [String]) -> [String] {
        var seen = Set<String>()
        var ordered: [String] = []
        for value in values where seen.insert(value).inserted {
            ordered.append(value)
        }
        return ordered
    }

    private var monthDatePattern: String {
        #"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s+\d{4}"#
    }
}

private struct SourceCollectionResult: Sendable {
    let kind: IntelSourceKind
    let evidence: [RosterIntelEvidence]
    let status: IntelVerificationStatus
    let note: String
}

private struct CachedDossier: Sendable {
    let fingerprint: String
    let createdAt: Date
    let dossier: TeamRosterDossier
}

private struct RosterTrackerTile: Sendable {
    let record: String?
    let rosterSize: Int?
    let draftPicks: Int?
    let transactionsURL: String
}

private struct GoogleNewsRSSItem: Sendable {
    let title: String
    let link: String?
    let pubDate: String?
    let description: String
    let sourceName: String?
}

private final class GoogleNewsRSSParser: NSObject, XMLParserDelegate {
    private var items: [GoogleNewsRSSItem] = []
    private var currentElement = ""
    private var title = ""
    private var link = ""
    private var pubDate = ""
    private var descriptionText = ""
    private var insideItem = false
    private var content = ""

    static func parse(data: Data) -> [GoogleNewsRSSItem] {
        let parser = GoogleNewsRSSParser()
        let xml = XMLParser(data: data)
        xml.delegate = parser
        xml.parse()
        return parser.items
    }

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String : String] = [:]) {
        currentElement = elementName
        if elementName == "item" {
            insideItem = true
            title = ""
            link = ""
            pubDate = ""
            descriptionText = ""
        }
        content = ""
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        content += string
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
        guard insideItem else { return }
        let value = content.trimmingCharacters(in: .whitespacesAndNewlines)
        switch elementName {
        case "title":
            title = value
        case "link":
            link = value
        case "pubDate":
            pubDate = value
        case "description":
            descriptionText = strippedHTML(value)
        case "item":
            insideItem = false
            items.append(
                GoogleNewsRSSItem(
                    title: title,
                    link: link.isEmpty ? nil : link,
                    pubDate: pubDate.isEmpty ? nil : pubDate,
                    description: descriptionText,
                    sourceName: sourceName(from: descriptionText)
                )
            )
        default:
            break
        }
    }

    private func strippedHTML(_ value: String) -> String {
        value.replacingOccurrences(of: "<[^>]+>", with: " ", options: .regularExpression)
            .replacingOccurrences(of: "&nbsp;", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func sourceName(from description: String) -> String? {
        let parts = description.components(separatedBy: " · ")
        return parts.first?.isEmpty == false ? parts.first : nil
    }
}
