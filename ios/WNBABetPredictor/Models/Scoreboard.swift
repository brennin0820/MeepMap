import Foundation

struct ScoreboardTeamRef: Codable, Hashable, Sendable {
    var key: String?
    var name: String?
    var abbreviation: String?
    var record: String?
}

struct ScoreboardGame: Codable, Identifiable, Hashable, Sendable {
    var id: String
    var date: String?
    var name: String?
    var status: String?
    var statusState: String?
    var period: Int?
    var clock: String?
    var homeTeam: ScoreboardTeamRef?
    var awayTeam: ScoreboardTeamRef?
    var homeKey: String?
    var awayKey: String?
    var homeScore: Int?
    var awayScore: Int?
    var venue: String?
    var odds: MarketOdds?

    var isLive: Bool {
        statusState?.lowercased() == "in"
    }

    var isFinal: Bool {
        let state = statusState?.lowercased() ?? ""
        if state == "post" { return true }
        return status?.lowercased().contains("final") == true
    }

    var statusLabel: String {
        if let period, let clock, !clock.isEmpty, isLive {
            return "Q\(period) · \(clock)"
        }
        if let period, isLive {
            return "Q\(period)"
        }
        if let clock, isLive, !clock.isEmpty {
            return clock
        }
        return status ?? "Scheduled"
    }
}

enum ESPNOddsParser {
    static func parse(from competition: [String: Any]) -> MarketOdds? {
        guard let rawOdds = (competition["odds"] as? [[String: Any]])?.first else { return nil }

        let pointSpread = rawOdds["pointSpread"] as? [String: Any]
        let total = rawOdds["total"] as? [String: Any]
        let moneyline = rawOdds["moneyline"] as? [String: Any]

        let homeFavorite = ((rawOdds["homeTeamOdds"] as? [String: Any])?["favorite"] as? Bool) == true
        let awayFavorite = ((rawOdds["awayTeamOdds"] as? [String: Any])?["favorite"] as? Bool) == true
        let rawSpread = number(from: rawOdds["spread"])
        let derivedHomeSpread = rawSpread.map { spread -> Double in
            if homeFavorite { return -abs(spread) }
            if awayFavorite { return abs(spread) }
            return spread
        }

        let closeSpread = number(from: ((pointSpread?["home"] as? [String: Any])?["close"] as? [String: Any])?["line"])
            ?? derivedHomeSpread
        let openSpread = number(from: ((pointSpread?["home"] as? [String: Any])?["open"] as? [String: Any])?["line"])

        let closeTotal = number(from: ((total?["over"] as? [String: Any])?["close"] as? [String: Any])?["line"])
            ?? number(from: rawOdds["overUnder"])
        let openTotal = number(from: ((total?["over"] as? [String: Any])?["open"] as? [String: Any])?["line"])

        let homeMoneyline = americanOdds(from: ((moneyline?["home"] as? [String: Any])?["close"] as? [String: Any])?["odds"])
        let awayMoneyline = americanOdds(from: ((moneyline?["away"] as? [String: Any])?["close"] as? [String: Any])?["odds"])
        let openHomeMoneyline = americanOdds(from: ((moneyline?["home"] as? [String: Any])?["open"] as? [String: Any])?["odds"])
        let openAwayMoneyline = americanOdds(from: ((moneyline?["away"] as? [String: Any])?["open"] as? [String: Any])?["odds"])

        let hasAnyLine = closeSpread != nil || closeTotal != nil || homeMoneyline != nil || awayMoneyline != nil
        guard hasAnyLine else { return nil }

        return MarketOdds(
            provider: ((rawOdds["provider"] as? [String: Any])?["displayName"] as? String)
                ?? ((rawOdds["provider"] as? [String: Any])?["name"] as? String),
            spread: closeSpread,
            total: closeTotal,
            homeMoneyline: homeMoneyline,
            awayMoneyline: awayMoneyline,
            openingSpread: openSpread,
            openingTotal: openTotal,
            openingHomeMoneyline: openHomeMoneyline,
            openingAwayMoneyline: openAwayMoneyline,
            source: "espn",
            deepLink: (rawOdds["link"] as? [String: Any])?["href"] as? String
        )
    }

    private static func americanOdds(from raw: Any?) -> Int? {
        guard let string = raw as? String else {
            if let intValue = raw as? Int { return intValue }
            return nil
        }
        return Int(string.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private static func number(from raw: Any?) -> Double? {
        if let value = raw as? Double { return value }
        if let value = raw as? Int { return Double(value) }
        guard let string = raw as? String else { return nil }
        let filtered = string.filter { "-+0123456789.".contains($0) }
        return Double(filtered)
    }
}

struct TeamSeasonStats: Codable, Hashable, Sendable {
    var ppg: Double?
    var oppPpg: Double?
    var fgPct: Double?
    var fg3Pct: Double?
    var ftPct: Double?
    var rebounds: Double?
    var assists: Double?
    var turnovers: Double?
    var netRating: Double?
    var pace: Double?
    var gamesPlayed: Int?
}

struct PlayerSeasonStats: Codable, Identifiable, Hashable, Sendable {
    var id: String
    var name: String
    var position: String?
    var jersey: String?
    var mpg: Double?
    var ppg: Double?
    var rpg: Double?
    var apg: Double?
    var fgPct: Double?
}

struct ScoreboardResponse: Codable, Sendable {
    var games: [ScoreboardGame]
    var source: String?
    var lastUpdated: String?
    var isLive: Bool?
    var warning: String?
    var error: String?

    enum CodingKeys: String, CodingKey {
        case games, events, source, lastUpdated, isLive, warning, error
    }

    init(
        games: [ScoreboardGame],
        source: String? = nil,
        lastUpdated: String? = nil,
        isLive: Bool? = nil,
        warning: String? = nil,
        error: String? = nil
    ) {
        self.games = games
        self.source = source
        self.lastUpdated = lastUpdated
        self.isLive = isLive
        self.warning = warning
        self.error = error
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let games = try container.decodeIfPresent([ScoreboardGame].self, forKey: .games) {
            self.games = games
        } else if let events = try container.decodeIfPresent([ScoreboardGame].self, forKey: .events) {
            self.games = events
        } else {
            self.games = []
        }
        source = try container.decodeIfPresent(String.self, forKey: .source)
        lastUpdated = try container.decodeIfPresent(String.self, forKey: .lastUpdated)
        isLive = try container.decodeIfPresent(Bool.self, forKey: .isLive)
        warning = try container.decodeIfPresent(String.self, forKey: .warning)
        error = try container.decodeIfPresent(String.self, forKey: .error)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(games, forKey: .games)
        try container.encodeIfPresent(source, forKey: .source)
        try container.encodeIfPresent(lastUpdated, forKey: .lastUpdated)
        try container.encodeIfPresent(isLive, forKey: .isLive)
        try container.encodeIfPresent(warning, forKey: .warning)
        try container.encodeIfPresent(error, forKey: .error)
    }
}

struct TeamStatsDetailPayload: Codable, Sendable {
    var teamKey: String
    var teamName: String?
    var record: String?
    var abbreviation: String?
    var stats: TeamSeasonStats?
    var team: ScoreboardTeamRef?
    var source: String?
    var lastUpdated: String?
    var isLive: Bool?
    var warning: String?
    var error: String?
}

struct TeamPlayersPayload: Codable, Sendable {
    var teamKey: String
    var players: [PlayerSeasonStats]
    var source: String?
    var lastUpdated: String?
    var isLive: Bool?
    var warning: String?

    enum CodingKeys: String, CodingKey {
        case teamKey, players, roster, source, lastUpdated, isLive, warning
    }

    init(
        teamKey: String,
        players: [PlayerSeasonStats],
        source: String? = nil,
        lastUpdated: String? = nil,
        isLive: Bool? = nil,
        warning: String? = nil
    ) {
        self.teamKey = teamKey
        self.players = players
        self.source = source
        self.lastUpdated = lastUpdated
        self.isLive = isLive
        self.warning = warning
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        teamKey = try container.decode(String.self, forKey: .teamKey)
        if let players = try container.decodeIfPresent([PlayerSeasonStats].self, forKey: .players) {
            self.players = players
        } else {
            self.players = try container.decodeIfPresent([PlayerSeasonStats].self, forKey: .roster) ?? []
        }
        source = try container.decodeIfPresent(String.self, forKey: .source)
        lastUpdated = try container.decodeIfPresent(String.self, forKey: .lastUpdated)
        isLive = try container.decodeIfPresent(Bool.self, forKey: .isLive)
        warning = try container.decodeIfPresent(String.self, forKey: .warning)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(teamKey, forKey: .teamKey)
        try container.encode(players, forKey: .players)
        try container.encodeIfPresent(source, forKey: .source)
        try container.encodeIfPresent(lastUpdated, forKey: .lastUpdated)
        try container.encodeIfPresent(isLive, forKey: .isLive)
        try container.encodeIfPresent(warning, forKey: .warning)
    }
}
