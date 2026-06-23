import Foundation

actor LocalIntelligenceEngine {
    static let shared = LocalIntelligenceEngine()

    private let dataService = LocalDataService.shared
    private var previousDecisions: [String: (decision: DecisionType, pick: String?)] = [:]

    func getIntelligence(days: Int = 7) async -> IntelligenceResponse {
        async let teamsResult = dataService.getTeams()
        async let scheduleResult = dataService.getScheduleRange(days: days)
        async let injuriesResult = dataService.getInjuries()

        let teams = await teamsResult
        let schedule = await scheduleResult
        let injuries = await injuriesResult

        let priorGames = schedule.events.filter { $0.statusState == "post" }
        let upcoming = schedule.events.filter { $0.statusState != "post" }
        let isLive = (schedule.isLive ?? false) && (teams.isLive ?? false)
        let warning = [schedule.warning, teams.warning, injuries.warning].compactMap { $0 }.joined(separator: "; ")
        let oddsAttachedCount = upcoming.filter { $0.odds != nil }.count
        let oddsStatus: String = {
            guard !upcoming.isEmpty else { return "idle" }
            if oddsAttachedCount == upcoming.count { return "healthy" }
            if oddsAttachedCount > 0 { return "partial" }
            return "unavailable"
        }()

        var games: [GameIntelligence] = []
        for event in upcoming {
            if let game = buildGame(
                event: event,
                teams: teams.teams,
                priorGames: priorGames,
                injuries: injuries.injuries,
                sourceDegraded: !isLive,
                metaWarning: warning.nilIfEmpty
            ) {
                games.append(game)
            }
        }

        games.sort { ($0.decision.edgeScore) > ($1.decision.edgeScore) }

        let summary = IntelligenceSummary(
            strongPicks: games.filter { $0.decision.decision == .strongPick }.count,
            leans: games.filter { $0.decision.decision == .lean }.count,
            pass: games.filter { $0.decision.decision == .pass }.count,
            wait: games.filter { $0.decision.decision == .waitForLineup }.count,
            highRisk: games.filter { $0.decision.decision == .highRiskOnly }.count,
            insufficient: games.filter { $0.decision.decision == .insufficientData }.count,
            alertCount: nil
        )

        let sourceHealth = SourceHealth(
            live: isLive,
            cacheAgeSeconds: 0,
            sources: [
                "espn": isLive ? "healthy" : "fallback",
                "wnbaStats": teams.source?.contains("wnba-stats") == true ? "healthy" : "unavailable",
                "injuries": injuries.isLive == true ? "healthy" : "fallback",
                "odds": oddsStatus,
                "model": LocalPredictor.modelVersion
            ]
        )

        let alerts = buildAlerts(games: games, isLive: isLive, warning: warning.nilIfEmpty)
        snapshotDecisions(games: games)

        return IntelligenceResponse(
            generatedAt: ISO8601DateFormatter().string(from: Date()),
            summary: summary,
            games: games,
            alerts: alerts,
            health: sourceHealth
        )
    }

    func getGameIntelligence(gameId: String, days: Int = 14) async -> GameIntelligence? {
        let payload = await getIntelligence(days: days)
        return payload.games.first {
            $0.id == gameId || "\($0.game.awayKey)@\($0.game.homeKey)" == gameId
        }
    }

    func getAlerts(days: Int = 7) async -> [Alert] {
        let payload = await getIntelligence(days: days)
        return payload.alerts ?? []
    }

    func analyzeMatchup(homeKey: String, awayKey: String, date: String? = nil) async -> MatchupResponse {
        let teams = await dataService.getTeams()
        let injuries = await dataService.getInjuries()
        let gameDate = date ?? ISO8601DateFormatter().string(from: Date())
        let schedule = await dataService.getScheduleWindow(daysBack: 0, daysForward: 14)
        let targetDatePrefix = String(gameDate.prefix(10))
        let event = schedule.events.first(where: { event in
            let matchesTeams =
                event.homeTeam?.key?.lowercased() == homeKey.lowercased() &&
                event.awayTeam?.key?.lowercased() == awayKey.lowercased()
            guard matchesTeams else { return false }
            guard date != nil else { return true }
            return String(event.date.prefix(10)) == targetDatePrefix
        }) ?? LocalScheduleEvent(
            id: "matchup-\(awayKey.lowercased())-\(homeKey.lowercased())",
            date: gameDate,
            name: nil,
            status: "Scheduled",
            statusState: "pre",
            homeTeam: LocalTeamRef(key: homeKey.lowercased(), name: nil),
            awayTeam: LocalTeamRef(key: awayKey.lowercased(), name: nil),
            homeScore: 0,
            awayScore: 0,
            venue: nil,
            odds: nil
        )

        guard let game = buildGame(
            event: event,
            teams: teams.teams,
            priorGames: schedule.events.filter { $0.statusState == "post" },
            injuries: injuries.injuries,
            sourceDegraded: teams.isLive != true || schedule.isLive != true,
            metaWarning: [teams.warning, schedule.warning].compactMap { $0 }.joined(separator: "; ").nilIfEmpty
        ) else {
            return MatchupResponse(game: nil, generatedAt: ISO8601DateFormatter().string(from: Date()))
        }

        return MatchupResponse(game: game, generatedAt: ISO8601DateFormatter().string(from: Date()))
    }

    func runWhatIf(request: WhatIfRequest) async -> WhatIfResponse {
        let teams = await dataService.getTeams()
        let injuries = await dataService.getInjuries()
        let homeKey = request.homeKey.lowercased()
        let awayKey = request.awayKey.lowercased()

        let baselinePrediction = LocalPredictor.predictMatchup(
            homeTeamKey: homeKey,
            awayTeamKey: awayKey,
            date: request.date,
            teams: teams.teams,
            priorGames: [],
            injuries: injuries.injuries
        )

        guard let home = teams.teams.first(where: { $0.key == homeKey }),
              let away = teams.teams.first(where: { $0.key == awayKey }) else {
            return WhatIfResponse(
                baseline: WhatIfOutcome(decision: .insufficientData, edgeScore: 0, confidence: 0, grade: "F", risk: "Extreme"),
                original: nil,
                scenario: nil,
                adjusted: nil,
                scenarios: nil,
                summary: "Unknown team key(s)"
            )
        }

        var adjustedInjuries = injuries.injuries
        for override in request.scenario?.setPlayerStatus ?? [] {
            adjustedInjuries.append(InjuryEntry(
                teamKey: homeKey,
                teamName: home.name,
                player: override.player,
                status: override.status,
                note: "What-if override"
            ))
        }

        let adjustedPrediction = LocalPredictor.predictMatchup(
            homeTeamKey: homeKey,
            awayTeamKey: awayKey,
            date: request.date,
            teams: teams.teams,
            priorGames: [],
            injuries: adjustedInjuries
        )

        let manualOdds = LocalOdds(spread: request.spread, total: nil, moneyline: nil)
        let baselineOutcome = outcomeFrom(
            home: home,
            away: away,
            homeKey: homeKey,
            awayKey: awayKey,
            prediction: baselinePrediction,
            odds: nil,
            sourceDegraded: false,
            metaWarning: nil
        )
        let scenarioOutcome = outcomeFrom(
            home: home,
            away: away,
            homeKey: homeKey,
            awayKey: awayKey,
            prediction: adjustedPrediction,
            odds: manualOdds,
            sourceDegraded: false,
            metaWarning: nil
        )

        return WhatIfResponse(
            baseline: baselineOutcome,
            original: baselineOutcome,
            scenario: scenarioOutcome,
            adjusted: scenarioOutcome,
            scenarios: [
                WhatIfScenarioResult(
                    id: "scenario-1",
                    label: "Adjusted scenario",
                    assumption: "Injury overrides applied",
                    outcome: scenarioOutcome
                )
            ],
            summary: "On-device what-if — no market odds unless manual spread supplied."
        )
    }

    func getHealth() async -> SourceHealth {
        async let teamsResult = dataService.getTeams()
        async let injuriesResult = dataService.getInjuries()
        async let scheduleResult = dataService.getScheduleRange(days: 1)

        let teams = await teamsResult
        let injuries = await injuriesResult
        let schedule = await scheduleResult
        let live = teams.isLive == true && injuries.isLive == true
        let upcoming = schedule.events.filter { $0.statusState != "post" }
        let oddsAttachedCount = upcoming.filter { $0.odds != nil }.count
        let oddsStatus: String = {
            guard !upcoming.isEmpty else { return "idle" }
            if oddsAttachedCount == upcoming.count { return "healthy" }
            if oddsAttachedCount > 0 { return "partial" }
            return "unavailable"
        }()

        return SourceHealth(
            live: live,
            cacheAgeSeconds: 0,
            sources: [
                "engine": "on-device",
                "espn": teams.isLive == true ? "healthy" : "fallback",
                "wnbaStats": teams.source?.contains("wnba-stats") == true ? "healthy" : "unavailable",
                "injuries": injuries.isLive == true ? "healthy" : "fallback",
                "odds": oddsStatus,
                "model": LocalPredictor.modelVersion
            ]
        )
    }

    // MARK: - Game builder

    private func buildGame(
        event: LocalScheduleEvent,
        teams: [LocalTeam],
        priorGames: [LocalScheduleEvent],
        injuries: [InjuryEntry],
        sourceDegraded: Bool,
        metaWarning: String?
    ) -> GameIntelligence? {
        guard let homeKey = event.homeTeam?.key?.lowercased(),
              let awayKey = event.awayTeam?.key?.lowercased(),
              let homeTeam = teams.first(where: { $0.key == homeKey }),
              let awayTeam = teams.first(where: { $0.key == awayKey }) else {
            return nil
        }

        let prediction = LocalPredictor.predictMatchup(
            homeTeamKey: homeKey,
            awayTeamKey: awayKey,
            date: event.date,
            teams: teams,
            priorGames: priorGames,
            injuries: injuries
        )
        let marketOdds = event.odds
        let oddsInput = marketOdds != nil ? normalizedLocalOdds(from: marketOdds!) : nil

        let gameInfo = GameInfo(
            gameId: event.id,
            date: prediction.gameDate ?? String(event.date.prefix(10)),
            time: nil,
            homeKey: homeKey,
            awayKey: awayKey,
            homeName: homeTeam.name,
            awayName: awayTeam.name,
            status: event.status,
            dateValid: LocalPredictor.isValidDate(event.date)
        )

        let injurySplit = splitInjuries(injuries: injuries, homeKey: homeKey, awayKey: awayKey)
        let modelProjection = buildModelProjection(prediction: prediction, odds: oddsInput)
        let dataQuality = LocalDataQuality.assess(LocalDataQuality.AssessInput(
            game: LocalGameContext(
                id: event.id,
                homeKey: homeKey,
                awayKey: awayKey,
                homeName: homeTeam.name,
                awayName: awayTeam.name,
                date: gameInfo.date,
                status: event.statusState,
                dateValid: gameInfo.dateValid ?? false
            ),
            homeTeam: homeTeam,
            awayTeam: awayTeam,
            lineupConfirmed: nil,
            odds: oddsInput,
            injuries: injurySplit,
            modelProjection: modelProjection,
            predictionEnabled: prediction.enabled,
            sampleSize: min((homeTeam.wins ?? 0) + (homeTeam.losses ?? 0), (awayTeam.wins ?? 0) + (awayTeam.losses ?? 0)),
            sourceDegraded: sourceDegraded,
            metaWarning: metaWarning
        ))

        let decideResult = LocalDecisionEngine.decide(LocalDecisionEngine.DecideInput(
            homeTeam: homeTeam,
            awayTeam: awayTeam,
            homeKey: homeKey,
            awayKey: awayKey,
            modelProjection: modelProjection,
            odds: oddsInput,
            dataQuality: dataQuality,
            predictionEnabled: prediction.enabled,
            lineupConfirmed: nil,
            injuries: injurySplit,
            fatigue: prediction.fatigue
        ))

        let pick = recommendedPick(decision: decideResult.decision, prediction: prediction, homeTeam: homeTeam, awayTeam: awayTeam)
        let humanReasons = LocalDecisionEngine.humanReasons(from: decideResult.reasonCodes)
        let insights = buildInsights(
            homeTeam: homeTeam,
            awayTeam: awayTeam,
            game: gameInfo,
            modelProjection: modelProjection,
            odds: oddsInput,
            dataQuality: dataQuality,
            decision: decideResult.decision,
            fatigue: prediction.fatigue,
            factors: prediction.factors,
            injuries: injurySplit
        )
        let explanation = buildExplanation(
            homeTeam: homeTeam,
            awayTeam: awayTeam,
            prediction: prediction,
            decision: decideResult,
            dataQuality: dataQuality,
            insights: insights
        )

        let decision = Decision(
            decision: decideResult.decision,
            confidence: "\(decideResult.confidence)%",
            risk: decideResult.risk,
            edgeScore: decideResult.edgeScore,
            action: pick.map { "Lean \($0)" } ?? decideResult.action,
            reasonCodes: decideResult.reasonCodes,
            humanReasons: humanReasons
        )

        let moneyline = bettingWinPrediction(
            prediction: prediction,
            homeTeam: homeTeam,
            awayTeam: awayTeam,
            marketOdds: marketOdds
        )
        let fairLine = moneyline?.fairLine
        let lineWarning = marketOdds == nil
            ? "No market odds provider available for this game — verify sportsbook lines before wagering."
            : nil
        let predictionModel: Prediction? = prediction.enabled ? Prediction(
            projections: Projection(
                homeWinProb: prediction.winProb?.home,
                projectedMargin: prediction.margin,
                projectedTotal: prediction.total,
                projectedScore: prediction.projections,
                pick: pick
            ),
            picks: PredictionPicks(
                spread: PickDetail(
                    pick: nil,
                    confidence: nil,
                    line: marketOdds?.spread
                ),
                total: PickDetail(
                    pick: nil,
                    confidence: nil,
                    line: marketOdds?.total
                ),
                moneyline: PickDetail(
                    pick: moneyline?.pick,
                    confidence: "\(decideResult.confidence)%",
                    line: moneyline?.marketLine.map(Double.init)
                )
            ),
            winner: moneyline?.winner,
            confidence: "\(decideResult.confidence)%",
            spread: prediction.margin,
            total: prediction.total,
            winProb: prediction.winProb?.home,
            lineStatus: marketOdds == nil ? "model-only" : "espn-live",
            lineWarning: lineWarning,
            moneylinePick: moneyline?.pick,
            moneylineWinProb: moneyline?.winProb,
            fairMoneyline: fairLine,
            marketMoneyline: moneyline?.marketLine,
            moneylineEdge: moneyline?.edge,
            moneylineNote: moneylineNote(for: moneyline, marketOdds: marketOdds),
            marketOdds: marketOdds
        ) : nil

        return GameIntelligence(
            game: gameInfo,
            decision: decision,
            dataQuality: dataQuality,
            prediction: predictionModel,
            homeTeam: teamSnapshot(homeTeam),
            awayTeam: teamSnapshot(awayTeam),
            alerts: nil,
            insights: insights,
            explanation: explanation
        )
    }

    private func outcomeFrom(
        home: LocalTeam,
        away: LocalTeam,
        homeKey: String,
        awayKey: String,
        prediction: LocalPredictor.MatchupResult,
        odds: LocalOdds?,
        sourceDegraded: Bool,
        metaWarning: String?
    ) -> WhatIfOutcome {
        let injurySplit = LocalInjurySplit(home: [], away: [])
        let modelProjection = buildModelProjection(prediction: prediction, odds: odds)
        let dq = LocalDataQuality.assess(LocalDataQuality.AssessInput(
            game: LocalGameContext(id: nil, homeKey: homeKey, awayKey: awayKey, homeName: home.name, awayName: away.name, date: prediction.gameDate, status: "pre", dateValid: true),
            homeTeam: home,
            awayTeam: away,
            lineupConfirmed: nil,
            odds: odds,
            injuries: injurySplit,
            modelProjection: modelProjection,
            predictionEnabled: prediction.enabled,
            sampleSize: nil,
            sourceDegraded: sourceDegraded,
            metaWarning: metaWarning
        ))
        let result = LocalDecisionEngine.decide(LocalDecisionEngine.DecideInput(
            homeTeam: home,
            awayTeam: away,
            homeKey: homeKey,
            awayKey: awayKey,
            modelProjection: modelProjection,
            odds: odds,
            dataQuality: dq,
            predictionEnabled: prediction.enabled,
            lineupConfirmed: nil,
            injuries: injurySplit,
            fatigue: prediction.fatigue
        ))
        return WhatIfOutcome(
            decision: result.decision,
            edgeScore: result.edgeScore,
            confidence: result.confidence,
            grade: result.grade.rawValue,
            risk: result.risk
        )
    }

    private func buildModelProjection(prediction: LocalPredictor.MatchupResult, odds: LocalOdds?) -> LocalDataQuality.ModelProjection? {
        guard prediction.enabled else { return nil }
        let spreadEdge: Double?
        if let marketSpread = odds?.spread, let margin = prediction.margin {
            spreadEdge = LocalDecisionEngine.computeHomeSpreadEdge(
                projectedMargin: margin,
                marketSpread: marketSpread
            )
        } else {
            spreadEdge = nil
        }
        return LocalDataQuality.ModelProjection(
            spreadEdge: spreadEdge,
            winProb: prediction.winProb?.home,
            projectedMargin: prediction.margin,
            projectedTotal: prediction.total
        )
    }

    private func round1(_ value: Double) -> Double { (value * 10).rounded() / 10 }

    private struct BettingWinPrediction {
        let winner: String
        let pick: String
        let winProb: Double
        let fairLine: Int
        let marketLine: Int?
        let edge: Double?
    }

    private func bettingWinPrediction(
        prediction: LocalPredictor.MatchupResult,
        homeTeam: LocalTeam,
        awayTeam: LocalTeam,
        marketOdds: MarketOdds?
    ) -> BettingWinPrediction? {
        guard prediction.enabled,
              let homeProb = prediction.winProb?.home,
              let awayProb = prediction.winProb?.away else { return nil }
        let homeIsWinner = homeProb >= awayProb
        let winner = homeIsWinner ? homeTeam.name : awayTeam.name
        let winProb = homeIsWinner ? homeProb : awayProb
        let marketLine = homeIsWinner ? marketOdds?.homeMoneyline : marketOdds?.awayMoneyline
        return BettingWinPrediction(
            winner: winner,
            pick: "\(winner) ML",
            winProb: winProb,
            fairLine: fairAmericanMoneyline(probability: winProb),
            marketLine: marketLine,
            edge: marketLine.map { winProb - impliedProbability(fromAmerican: $0) }
        )
    }

    private func fairAmericanMoneyline(probability: Double) -> Int {
        let p = min(max(probability, 0.01), 0.99)
        if p >= 0.5 {
            return Int((-(p / (1 - p)) * 100).rounded())
        }
        return Int((((1 - p) / p) * 100).rounded())
    }

    private func impliedProbability(fromAmerican line: Int) -> Double {
        if line < 0 {
            let value = Double(-line)
            return value / (value + 100)
        }
        let value = Double(line)
        return 100 / (value + 100)
    }

    private func normalizedLocalOdds(from market: MarketOdds) -> LocalOdds {
        var moneyline: [String: Double] = [:]
        if let home = market.homeMoneyline { moneyline["home"] = Double(home) }
        if let away = market.awayMoneyline { moneyline["away"] = Double(away) }
        return LocalOdds(
            spread: market.spread,
            total: market.total,
            moneyline: moneyline.isEmpty ? nil : moneyline
        )
    }

    private func moneylineNote(for market: BettingWinPrediction?, marketOdds: MarketOdds?) -> String {
        guard let market else {
            return marketOdds == nil
                ? "Model fair line only — compare against a real sportsbook price before wagering."
                : "Live sportsbook lines attached. Compare the model fair line against the current market before wagering."
        }
        guard let edge = market.edge, let line = market.marketLine else {
            return "Model fair line \(formatAmericanLine(market.fairLine)) — compare against the attached market price before wagering."
        }
        let direction = edge >= 0 ? "better" : "worse"
        let points = String(format: "%.1f", abs(edge) * 100)
        return "Model fair line \(formatAmericanLine(market.fairLine)) versus market \(formatAmericanLine(line)) — \(points) points \(direction) than implied market probability."
    }

    private func formatAmericanLine(_ line: Int) -> String {
        line > 0 ? "+\(line)" : "\(line)"
    }

    private func recommendedPick(
        decision: DecisionType,
        prediction: LocalPredictor.MatchupResult,
        homeTeam: LocalTeam,
        awayTeam: LocalTeam
    ) -> String? {
        if [.pass, .insufficientData, .waitForLineup].contains(decision) { return nil }
        guard prediction.enabled, let homeProb = prediction.winProb?.home else { return nil }
        let fav = homeProb >= 0.5 ? homeTeam.name : awayTeam.name
        return fav.isEmpty ? nil : "\(fav) ML"
    }

    private func teamSnapshot(_ team: LocalTeam) -> TeamSnapshot {
        TeamSnapshot(
            key: team.key,
            name: team.name,
            record: team.record,
            last5: team.last5,
            netRating: team.netRating,
            offRating: team.offRating,
            defRating: team.defRating
        )
    }

    private func splitInjuries(injuries: [InjuryEntry], homeKey: String, awayKey: String) -> LocalInjurySplit {
        let home = injuries.filter { $0.teamKey.lowercased() == homeKey }.map {
            LocalInjuryPlayer(name: $0.player, status: $0.status, impact: inferImpact($0.status))
        }
        let away = injuries.filter { $0.teamKey.lowercased() == awayKey }.map {
            LocalInjuryPlayer(name: $0.player, status: $0.status, impact: inferImpact($0.status))
        }
        return LocalInjurySplit(home: home, away: away)
    }

    private func inferImpact(_ status: String) -> String {
        let s = status.lowercased()
        if s.contains("out") || s.contains("doubt") { return "high" }
        if s.contains("question") || s.contains("day") { return "medium" }
        return "low"
    }

    // MARK: - Insights

    private func buildInsights(
        homeTeam: LocalTeam,
        awayTeam: LocalTeam,
        game: GameInfo,
        modelProjection: LocalDataQuality.ModelProjection?,
        odds: LocalOdds?,
        dataQuality: DataQuality,
        decision: DecisionType,
        fatigue: LocalFatigueResult?,
        factors: LocalPredictionFactors?,
        injuries: LocalInjurySplit
    ) -> [Insight] {
        var insights: [Insight] = []

        if let homeNet = homeTeam.netRating, let awayNet = awayTeam.netRating {
            let diff = homeNet - awayNet
            let favored = diff >= 0 ? homeTeam.name : awayTeam.name
            insights.append(Insight(
                id: "net-rating",
                tone: abs(diff) >= 6 ? "strength" : "neutral",
                title: "Net rating gap",
                detail: "\(favored) holds a \(String(format: "%.1f", abs(diff))) net-rating edge (\(String(format: "%.1f", homeNet)) vs \(String(format: "%.1f", awayNet))).",
                priority: abs(diff) >= 6 ? 1 : 3
            ))
        }

        if let homeL5 = homeTeam.last5, let awayL5 = awayTeam.last5 {
            insights.append(Insight(
                id: "recent-form",
                tone: "neutral",
                title: "Last 5 games",
                detail: "\(homeTeam.name) \(homeL5), \(awayTeam.name) \(awayL5).",
                priority: 2
            ))
        }

        if let margin = modelProjection?.projectedMargin {
            let side = margin >= 0 ? homeTeam.name : awayTeam.name
            insights.append(Insight(
                id: "model-margin",
                tone: abs(margin) >= 4 ? "strength" : "neutral",
                title: "Model margin",
                detail: "Model projects \(side) by \(String(format: "%.1f", abs(margin))) points.",
                priority: 1
            ))
        }

        if let factors {
            let homePositive = factors.homeVenueAdjustment + factors.homeFormAdjustment + factors.homeMarginAdjustment
            let awayPositive = factors.awayVenueAdjustment + factors.awayFormAdjustment + factors.awayMarginAdjustment
            let detail = [
                "Pace \(factors.expectedPace.map { String(format: "%.1f", $0) } ?? "n/a")",
                "Base \(String(format: "%.1f", factors.awayBaseScore))-\(String(format: "%.1f", factors.homeBaseScore))",
                "Adj home \(String(format: "%+.1f", homePositive - factors.homeFatiguePenalty - factors.homeInjuryPenalty))",
                "away \(String(format: "%+.1f", awayPositive - factors.awayFatiguePenalty - factors.awayInjuryPenalty))"
            ].joined(separator: " · ")
            insights.append(Insight(
                id: "engine-factor-stack",
                tone: "neutral",
                title: "Engine factor stack",
                detail: detail,
                priority: 1
            ))
        }

        if odds?.spread == nil {
            insights.append(Insight(
                id: "no-market-line",
                tone: "watch",
                title: "Market line unavailable",
                detail: "Spread edge computed internally; no live line attached for comparison.",
                priority: 2
            ))
        }

        if let fatigue, !fatigue.home.notes.isEmpty || !fatigue.away.notes.isEmpty {
            let notes = fatigue.home.notes.map { "\(homeTeam.name): \($0)" } + fatigue.away.notes.map { "\(awayTeam.name): \($0)" }
            insights.append(Insight(
                id: "fatigue",
                tone: "watch",
                title: "Schedule fatigue",
                detail: notes.joined(separator: "; "),
                priority: 2
            ))
        }

        let injuryCount = injuries.home.count + injuries.away.count
        if injuryCount > 0 {
            insights.append(Insight(
                id: "roster-injuries",
                tone: "watch",
                title: "Injury report",
                detail: "\(injuries.home.count) home and \(injuries.away.count) away players listed with non-active status.",
                priority: 2
            ))
        }

        if dataQuality.flags?.lineupConfirmed != true {
            insights.append(Insight(
                id: "lineup-pending",
                tone: "watch",
                title: "Lineup not confirmed",
                detail: "Rotation uncertainty may shift efficiency and pace assumptions.",
                priority: 1
            ))
        }

        if decision == .highRiskOnly {
            insights.append(Insight(
                id: "high-variance",
                tone: "weakness",
                title: "High-variance spot",
                detail: "Pace or matchup volatility elevates blowout/collapse risk — size accordingly.",
                priority: 1
            ))
        }

        return insights.sorted { $0.priority < $1.priority }
    }

    private func buildExplanation(
        homeTeam: LocalTeam,
        awayTeam: LocalTeam,
        prediction: LocalPredictor.MatchupResult,
        decision: LocalDecisionEngine.DecideResult,
        dataQuality: DataQuality,
        insights: [Insight]
    ) -> Explanation {
        var pros: [String] = []
        var cons: [String] = []

        if let homeNet = homeTeam.netRating, let awayNet = awayTeam.netRating {
            let diff = homeNet - awayNet
            let favored = diff >= 0 ? homeTeam.name : awayTeam.name
            if abs(diff) >= 4 {
                pros.append("\(favored) holds a \(String(format: "%.1f", abs(diff))) net-rating edge")
            }
        }

        if let homeProb = prediction.winProb?.home {
            let fav = homeProb >= 0.5 ? homeTeam.name : awayTeam.name
            let pct = Int((homeProb >= 0.5 ? homeProb : 1 - homeProb) * 100)
            pros.append("Model win probability favors \(fav) (\(pct)%)")
        }

        cons.append("Market lines unavailable — edge based on model only")
        if dataQuality.flags?.lineupConfirmed != true {
            cons.append("Lineup not confirmed")
        }
        if dataQuality.score < 60 {
            cons.append("Data quality below recommended threshold")
        }
        if !prediction.enabled {
            cons.append(prediction.disabledReason ?? "Prediction disabled for this matchup")
        }

        let summary = "\(decision.decision.displayName) — \(decision.action)"
        let bullets = (pros + cons.prefix(3)).prefix(6).map { String($0) }

        return Explanation(summary: summary, bullets: Array(bullets))
    }

    // MARK: - Alerts

    private func buildAlerts(games: [GameIntelligence], isLive: Bool, warning: String?) -> [Alert] {
        var alerts: [Alert] = []
        var index = 0

        if !isLive {
            alerts.append(Alert(
                id: "alert-source-\(index)",
                gameId: nil,
                severity: .warning,
                code: "DATA_SOURCE_FAILED",
                title: "DATA_SOURCE_FAILED",
                message: warning ?? "One or more data sources are degraded.",
                timestamp: ISO8601DateFormatter().string(from: Date())
            ))
            index += 1
        }

        for game in games {
            if game.decision.decision == .waitForLineup {
                alerts.append(Alert(
                    id: "alert-\(index)-lineup",
                    gameId: game.id,
                    severity: .warning,
                    code: "LINEUP_WAIT",
                    title: "LINEUP_WAIT",
                    message: "Starting lineup not confirmed for \(game.game.awayName ?? game.game.awayKey) @ \(game.game.homeName ?? game.game.homeKey).",
                    timestamp: ISO8601DateFormatter().string(from: Date())
                ))
                index += 1
            }

            if game.dataQuality.flags?.hasOdds != true {
                alerts.append(Alert(
                    id: "alert-\(index)-odds",
                    gameId: game.id,
                    severity: .info,
                    code: "ODDS_MISSING",
                    title: "ODDS_MISSING",
                    message: "No market odds attached — edge vs line cannot be validated.",
                    timestamp: ISO8601DateFormatter().string(from: Date())
                ))
                index += 1
            } else if let market = game.prediction?.marketOdds {
                if let open = market.openingSpread, let current = market.spread, abs(current - open) >= 1 {
                    alerts.append(Alert(
                        id: "alert-\(index)-spread-move",
                        gameId: game.id,
                        severity: .warning,
                        code: "LINE_MOVE",
                        title: "LINE_MOVE",
                        message: "Spread moved \(String(format: "%+.1f", current - open)) points from open for \(game.game.awayName ?? game.game.awayKey) @ \(game.game.homeName ?? game.game.homeKey).",
                        timestamp: ISO8601DateFormatter().string(from: Date())
                    ))
                    index += 1
                }

                if let open = market.openingTotal, let current = market.total, abs(current - open) >= 2 {
                    alerts.append(Alert(
                        id: "alert-\(index)-total-move",
                        gameId: game.id,
                        severity: .info,
                        code: "TOTAL_MOVE",
                        title: "TOTAL_MOVE",
                        message: "Total moved \(String(format: "%+.1f", current - open)) points from open.",
                        timestamp: ISO8601DateFormatter().string(from: Date())
                    ))
                    index += 1
                }
            }

            if let edge = game.prediction?.moneylineEdge, edge >= 0.04 {
                alerts.append(Alert(
                    id: "alert-\(index)-value",
                    gameId: game.id,
                    severity: .info,
                    code: "VALUE_EDGE",
                    title: "VALUE_EDGE",
                    message: "Model moneyline edge is \(String(format: "%.1f", edge * 100)) points above market implied probability.",
                    timestamp: ISO8601DateFormatter().string(from: Date())
                ))
                index += 1
            }

            if game.decision.decision == .strongPick {
                alerts.append(Alert(
                    id: "alert-\(index)-strong",
                    gameId: game.id,
                    severity: .info,
                    code: "STRONG_PICK_FOUND",
                    title: "STRONG_PICK_FOUND",
                    message: "Strong pick: \(game.game.awayName ?? game.game.awayKey) @ \(game.game.homeName ?? game.game.homeKey).",
                    timestamp: ISO8601DateFormatter().string(from: Date())
                ))
                index += 1
            }

            if game.decision.decision == .insufficientData {
                alerts.append(Alert(
                    id: "alert-\(index)-data",
                    gameId: game.id,
                    severity: .critical,
                    code: "INSUFFICIENT_DATA",
                    title: "INSUFFICIENT_DATA",
                    message: "Data quality too low for a supported pick.",
                    timestamp: ISO8601DateFormatter().string(from: Date())
                ))
                index += 1
            }
        }

        alerts.append(contentsOf: diffPickChanges(games: games, startIndex: index))
        return alerts
    }

    private func diffPickChanges(games: [GameIntelligence], startIndex: Int) -> [Alert] {
        var alerts: [Alert] = []
        var index = startIndex
        for game in games {
            let key = game.id
            let current = game.decision.decision
            let currentPick = game.prediction?.projections?.pick
            if let prev = previousDecisions[key], prev.decision != current {
                let upgraded = decisionRank(current) > decisionRank(prev.decision)
                alerts.append(Alert(
                    id: "alert-\(index)-decision",
                    gameId: key,
                    severity: upgraded ? .info : .warning,
                    code: upgraded ? "DECISION_UPGRADE" : "DECISION_DOWNGRADE",
                    title: "Decision changed",
                    message: "Decision changed from \(prev.decision.displayName) to \(current.displayName).",
                    timestamp: ISO8601DateFormatter().string(from: Date())
                ))
                index += 1
            }
            previousDecisions[key] = (current, currentPick)
        }
        return alerts
    }

    private func snapshotDecisions(games: [GameIntelligence]) {
        for game in games {
            previousDecisions[game.id] = (game.decision.decision, game.prediction?.projections?.pick)
        }
    }

    private func decisionRank(_ type: DecisionType) -> Int {
        switch type {
        case .strongPick: return 5
        case .lean: return 4
        case .highRiskOnly: return 3
        case .waitForLineup: return 2
        case .pass: return 1
        case .insufficientData: return 0
        }
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
