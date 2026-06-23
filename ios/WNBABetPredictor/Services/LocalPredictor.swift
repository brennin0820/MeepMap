import Foundation

struct LocalFatigueTeam: Sendable {
    var teamKey: String
    var fatiguePenalty: Double
    var homeCourtBonus: Double
    var notes: [String]
}

struct LocalFatigueResult: Sendable {
    var home: LocalFatigueTeam
    var away: LocalFatigueTeam
}

struct LocalPredictionFactors: Sendable {
    var expectedPace: Double?
    var homeBaseScore: Double
    var awayBaseScore: Double
    var homeVenueAdjustment: Double
    var awayVenueAdjustment: Double
    var homeFormAdjustment: Double
    var awayFormAdjustment: Double
    var homeMarginAdjustment: Double
    var awayMarginAdjustment: Double
    var homeFatiguePenalty: Double
    var awayFatiguePenalty: Double
    var homeInjuryPenalty: Double
    var awayInjuryPenalty: Double
    var homeRosterImpact: Double
    var awayRosterImpact: Double
    var notes: [String]
}

enum LocalPredictor {
    static let modelVersion = "v1.6.0"

    private static let homeCourtAdv = 2.5
    private static let b2bPenalty = 3.0
    private static let threeInFourPenalty = 1.5
    private static let injuryCap = 6.0
    private static let leagueAveragePace = 96.0
    private static let leagueAveragePoints = 82.0

    struct WinProbPair: Sendable {
        var home: Double?
        var away: Double?
    }

    struct MatchupResult: Sendable {
        var enabled: Bool
        var disabledReason: String?
        var gameDate: String?
        var homeScore: Double?
        var awayScore: Double?
        var margin: Double?
        var total: Double?
        var homeWinProb: Double?
        var awayWinProb: Double?
        var winProb: WinProbPair?
        var projections: ProjectedScore?
        var fatigue: LocalFatigueResult?
        var factors: LocalPredictionFactors?
    }

    typealias LocalPredictionResult = MatchupResult

    static func isValidDate(_ dateInput: String?) -> Bool {
        guard let dateInput, !dateInput.isEmpty else { return false }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        if formatter.date(from: dateInput) != nil { return true }
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.dateFormat = "yyyy-MM-dd"
        return df.date(from: String(dateInput.prefix(10))) != nil
    }

    static func predictMatchup(
        homeTeamKey: String,
        awayTeamKey: String,
        date: String?,
        teams: [LocalTeam],
        priorGames: [LocalScheduleEvent],
        injuries: [InjuryEntry] = []
    ) -> MatchupResult {
        let homeKey = homeTeamKey.lowercased()
        let awayKey = awayTeamKey.lowercased()
        guard isValidDate(date) else {
            return MatchupResult(enabled: false, disabledReason: "Invalid or missing game date — prediction disabled", gameDate: nil, homeScore: nil, awayScore: nil, margin: nil, total: nil, homeWinProb: nil, awayWinProb: nil, winProb: nil, projections: nil, fatigue: nil, factors: nil)
        }

        guard let home = teams.first(where: { $0.key == homeKey }),
              let away = teams.first(where: { $0.key == awayKey }) else {
            return MatchupResult(enabled: false, disabledReason: "Unknown team(s)", gameDate: nil, homeScore: nil, awayScore: nil, margin: nil, total: nil, homeWinProb: nil, awayWinProb: nil, winProb: nil, projections: nil, fatigue: nil, factors: nil)
        }

        let gameDate = String((date ?? "").prefix(10))
        let fatigue = assessMatchupFatigue(homeKey: homeKey, awayKey: awayKey, gameDate: gameDate, priorGames: priorGames)

        let homeImpact = injuryImpactPoints(injuries.filter { $0.teamKey.lowercased() == homeKey })
        let awayImpact = injuryImpactPoints(injuries.filter { $0.teamKey.lowercased() == awayKey })
        let pace = expectedPace(home: home, away: away)
        let baseline = baselineScores(home: home, away: away, expectedPace: pace)
        let venue = venueAdjustment(home: home, away: away)
        let form = formAdjustment(home: home, away: away)
        let marginAdj = marginAdjustment(home: home, away: away)
        let homeInjuryPenalty = min(injuryCap, homeImpact * 0.35)
        let awayInjuryPenalty = min(injuryCap, awayImpact * 0.35)

        var homeScore = baseline.home + fatigue.home.homeCourtBonus
        var awayScore = baseline.away

        homeScore -= fatigue.home.fatiguePenalty
        awayScore -= fatigue.away.fatiguePenalty
        homeScore -= homeInjuryPenalty
        awayScore -= awayInjuryPenalty
        homeScore += venue.home + form.home + marginAdj.home
        awayScore += venue.away + form.away + marginAdj.away

        homeScore = max(64, min(112, homeScore)).rounded(toPlaces: 1)
        awayScore = max(64, min(112, awayScore)).rounded(toPlaces: 1)

        let margin = (homeScore - awayScore).rounded(toPlaces: 1)
        let total = (homeScore + awayScore).rounded(toPlaces: 1)
        let homeWin = logisticWinProb(margin).rounded(toPlaces: 3)
        let awayWin = logisticWinProb(-margin).rounded(toPlaces: 3)
        let factors = LocalPredictionFactors(
            expectedPace: pace,
            homeBaseScore: baseline.home.rounded(toPlaces: 1),
            awayBaseScore: baseline.away.rounded(toPlaces: 1),
            homeVenueAdjustment: venue.home.rounded(toPlaces: 1),
            awayVenueAdjustment: venue.away.rounded(toPlaces: 1),
            homeFormAdjustment: form.home.rounded(toPlaces: 1),
            awayFormAdjustment: form.away.rounded(toPlaces: 1),
            homeMarginAdjustment: marginAdj.home.rounded(toPlaces: 1),
            awayMarginAdjustment: marginAdj.away.rounded(toPlaces: 1),
            homeFatiguePenalty: fatigue.home.fatiguePenalty,
            awayFatiguePenalty: fatigue.away.fatiguePenalty,
            homeInjuryPenalty: homeInjuryPenalty.rounded(toPlaces: 1),
            awayInjuryPenalty: awayInjuryPenalty.rounded(toPlaces: 1),
            homeRosterImpact: homeImpact.rounded(toPlaces: 1),
            awayRosterImpact: awayImpact.rounded(toPlaces: 1),
            notes: factorNotes(home: home, away: away, fatigue: fatigue, homeImpact: homeImpact, awayImpact: awayImpact, pace: pace)
        )

        return MatchupResult(
            enabled: true,
            disabledReason: nil,
            gameDate: gameDate,
            homeScore: homeScore,
            awayScore: awayScore,
            margin: margin,
            total: total,
            homeWinProb: homeWin,
            awayWinProb: awayWin,
            winProb: WinProbPair(home: homeWin, away: awayWin),
            projections: ProjectedScore(home: homeScore, away: awayScore),
            fatigue: fatigue,
            factors: factors
        )
    }

    static func assessMatchupFatigue(
        homeKey: String,
        awayKey: String,
        gameDate: String,
        priorGames: [LocalScheduleEvent]
    ) -> LocalFatigueResult {
        var home = assessTeamFatigue(teamKey: homeKey, gameDate: gameDate, priorGames: priorGames)
        let away = assessTeamFatigue(teamKey: awayKey, gameDate: gameDate, priorGames: priorGames)
        home.homeCourtBonus = homeCourtAdv
        return LocalFatigueResult(home: home, away: away)
    }

    private static func assessTeamFatigue(
        teamKey: String,
        gameDate: String,
        priorGames: [LocalScheduleEvent]
    ) -> LocalFatigueTeam {
        let key = teamKey.lowercased()
        let teamDates = priorGames
            .filter { event in
                event.homeTeam?.key?.lowercased() == key || event.awayTeam?.key?.lowercased() == key
            }
            .compactMap { $0.date.isEmpty ? nil : $0.date }
            .sorted(by: >)

        var penalty = 0.0
        var notes: [String] = []

        if let lastPlayed = teamDates.first, let rest = daysBetween(gameDate, lastPlayed) {
            if rest <= 1 {
                penalty += b2bPenalty
                notes.append("Back-to-back")
            } else if rest == 2, teamDates.count >= 2 {
                let secondLast = teamDates[1]
                if let gap = daysBetween(lastPlayed, secondLast), gap <= 2 {
                    penalty += threeInFourPenalty
                    notes.append("3-in-4 stretch")
                }
            }
        }

        return LocalFatigueTeam(teamKey: key, fatiguePenalty: penalty, homeCourtBonus: 0, notes: notes)
    }

    private static func expectedPace(home: LocalTeam, away: LocalTeam) -> Double? {
        switch (home.pace, away.pace) {
        case let (.some(homePace), .some(awayPace)):
            return ((homePace + awayPace) / 2).rounded(toPlaces: 1)
        case let (.some(homePace), nil):
            return ((homePace + leagueAveragePace) / 2).rounded(toPlaces: 1)
        case let (nil, .some(awayPace)):
            return ((leagueAveragePace + awayPace) / 2).rounded(toPlaces: 1)
        default:
            return nil
        }
    }

    private static func baselineScores(
        home: LocalTeam,
        away: LocalTeam,
        expectedPace: Double?
    ) -> (home: Double, away: Double) {
        if let homeOff = home.offRating,
           let awayDef = away.defRating,
           let awayOff = away.offRating,
           let homeDef = home.defRating {
            let pace = expectedPace ?? leagueAveragePace
            let homePer100 = (homeOff * 0.58) + (awayDef * 0.42)
            let awayPer100 = (awayOff * 0.58) + (homeDef * 0.42)
            return (
                home: homePer100 * pace / 100,
                away: awayPer100 * pace / 100
            )
        }

        return (
            home: (teamOffense(home) + teamDefense(away)) / 2,
            away: (teamDefense(home) + teamOffense(away)) / 2
        )
    }

    private static func teamOffense(_ team: LocalTeam) -> Double {
        team.ppg ?? (team.offRating.map { $0 * (leagueAveragePace / 100) } ?? leagueAveragePoints)
    }

    private static func teamDefense(_ team: LocalTeam) -> Double {
        team.oppPpg ?? (team.defRating.map { $0 * (leagueAveragePace / 100) } ?? leagueAveragePoints)
    }

    private static func venueAdjustment(home: LocalTeam, away: LocalTeam) -> (home: Double, away: Double) {
        let homeRate = recordWinRate(home.homeRecord)
        let awayRate = recordWinRate(away.awayRecord)
        guard let homeRate, let awayRate else { return (0, 0) }
        let diff = max(-1.0, min(1.0, homeRate - awayRate))
        return (home: diff * 1.2, away: -diff * 0.6)
    }

    private static func formAdjustment(home: LocalTeam, away: LocalTeam) -> (home: Double, away: Double) {
        let homeForm = recordWinRate(home.last5)
        let awayForm = recordWinRate(away.last5)
        guard let homeForm, let awayForm else { return (0, 0) }
        let diff = max(-1.0, min(1.0, homeForm - awayForm))
        return (home: diff * 1.4, away: -diff * 1.4)
    }

    private static func marginAdjustment(home: LocalTeam, away: LocalTeam) -> (home: Double, away: Double) {
        guard let homeMargin = home.avgMargin, let awayMargin = away.avgMargin else { return (0, 0) }
        let diff = max(-15.0, min(15.0, homeMargin - awayMargin))
        let adjustment = max(-1.8, min(1.8, diff * 0.08))
        return (home: adjustment, away: -adjustment)
    }

    private static func recordWinRate(_ record: String?) -> Double? {
        guard let record else { return nil }
        let parts = record.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: "-")
        guard parts.count == 2,
              let wins = Double(parts[0]),
              let losses = Double(parts[1]),
              wins + losses > 0 else { return nil }
        return wins / (wins + losses)
    }

    private static func factorNotes(
        home: LocalTeam,
        away: LocalTeam,
        fatigue: LocalFatigueResult,
        homeImpact: Double,
        awayImpact: Double,
        pace: Double?
    ) -> [String] {
        var notes: [String] = []
        if let pace {
            notes.append("Expected pace \(String(format: "%.1f", pace)) possessions")
        }
        if let homeNet = home.netRating, let awayNet = away.netRating {
            let diff = homeNet - awayNet
            let side = diff >= 0 ? home.name : away.name
            notes.append("\(side) net rating edge \(String(format: "%.1f", abs(diff)))")
        }
        if homeImpact > 0 || awayImpact > 0 {
            notes.append("Roster drag \(home.name) \(String(format: "%.1f", homeImpact)), \(away.name) \(String(format: "%.1f", awayImpact))")
        }
        notes.append(contentsOf: fatigue.home.notes.map { "\(home.name): \($0)" })
        notes.append(contentsOf: fatigue.away.notes.map { "\(away.name): \($0)" })
        return notes
    }

    private static func logisticWinProb(_ margin: Double) -> Double {
        1 / (1 + exp(-margin / 6.4))
    }

    private static func injuryImpactPoints(_ entries: [InjuryEntry]) -> Double {
        entries.reduce(0) { partial, entry in
            partial + statusImpact(entry.status)
        }
    }

    private static func statusImpact(_ status: String) -> Double {
        let s = status.lowercased()
        if s.contains("out") { return 4.0 }
        if s.contains("doubt") { return 2.5 }
        if s.contains("question") { return 1.0 }
        if s.contains("probable") { return 0.25 }
        if s.contains("day") { return 1.0 }
        return 0.5
    }

    private static func daysBetween(_ a: String, _ b: String) -> Int? {
        guard let da = parseDate(a), let db = parseDate(b) else { return nil }
        let ms = abs(da.timeIntervalSince(db))
        return Int(ms / (24 * 60 * 60))
    }

    private static func parseDate(_ dateStr: String) -> Date? {
        let trimmed = String(dateStr.prefix(10))
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.dateFormat = "yyyy-MM-dd"
        return df.date(from: trimmed)
    }
}

private extension Double {
    func rounded(toPlaces places: Int) -> Double {
        let factor = pow(10.0, Double(places))
        return (self * factor).rounded() / factor
    }
}
