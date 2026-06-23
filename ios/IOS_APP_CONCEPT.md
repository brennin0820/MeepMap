# WNBA Bet Predictor iOS Concept

## Product North Star

Build the iOS app as a daily decision cockpit for WNBA betting research. The app should help a user answer three questions quickly:

1. Is there a real edge?
2. Is the data good enough to act on?
3. What could change the decision before tipoff?

The app is not a betting terminal. It is an intelligence and discipline layer: model projection, data quality, risk, alerts, what-if stress tests, bankroll context, and responsible-betting reminders.

## Core Experience

- Command Center: daily read, summary counts, active alerts, accuracy, and decision buckets.
- Games: filterable queue by decision type, with each row showing action, edge, quality, risk, and whether the pick is model-only or line-backed.
- Game Detail: decision, readiness, data quality, model projection, reasons, alerts, and what-if analysis.
- Team/s: league-wide team board plus drill-in profiles for form, efficiency, availability, and roster context.
- Matchup: manual team comparison for games outside the current schedule window.
- Injuries: team-grouped player availability scanner.
- Settings: backend connection, mock fallback, bankroll, accuracy, and safety context.

## Team/s Tab Concept

### Purpose

The Team/s tab should answer a different question than Games or Matchup: "What kind of team am I dealing with before I even price a bet?"

This screen is a scouting layer, not a schedule layer. It should help the user spot:

- teams outperforming their record,
- teams sliding despite headline win-loss numbers,
- fragile contenders with injury or rotation risk,
- bad teams that are still usable in the right matchup because of pace, shooting, or home/away split.

### Information Architecture

Use a two-level structure:

1. Team Board
2. Team Profile

The Team Board is the default landing state. It works like a sortable, filterable league map.
The Team Profile is the drill-in destination for deeper scouting on one club.

### Team Board

The first screen should feel dense and practical, closer to a watchlist than a marketing page.

Recommended header controls:

- Search by team name
- Segment picker: All, Contenders, Mid-table, Fade watch
- Sort: Net Rating, Last 5, Offensive Rating, Defensive Rating, Pace, Injury Risk
- Toggle: show only teams playing today

Recommended card content for each team:

- team name and record
- last 5 and last 10 form
- net rating
- offensive and defensive rating
- home and away splits
- one quick badge for trend: Rising, Stable, Sliding
- one quick badge for health: Clean, Watch, Thin

This screen should allow fast league scanning. A bettor should be able to open the app and immediately see which teams deserve deeper review before looking at individual games.

### Team Profile

Selecting a team opens a full profile. The profile should be organized around decision-useful sections rather than generic franchise facts.

Recommended section order:

1. Snapshot
2. Form and Splits
3. Style Profile
4. Availability
5. Player Production
6. Betting Relevance

Snapshot should include:

- record
- net rating
- pace
- last 5
- home and away record
- next game if available later

Form and Splits should include:

- last 5 / last 10 trend
- average margin
- home vs away record
- offense and defense split callouts when available

Style Profile should explain how the team wins or loses:

- offensive rating
- defensive rating
- pace
- shooting efficiency
- rebounding / turnover context if available later

Availability should combine injuries and rotation confidence:

- current injury list
- simple team health grade
- note when player data is fallback-derived or incomplete

Player Production should reuse the existing player-stats payload:

- top rotation players
- minutes, points, rebounds, assists
- shooting efficiency where available

Betting Relevance is the differentiator. This section should convert stats into scouting language:

- "Good favorite, weak underdog cover profile"
- "Fast pace creates volatile totals"
- "Elite defense but poor recent form"
- "Record stronger than underlying efficiency"

These labels should be short, explicit, and derived from existing team metrics rather than decorative prose.

### Relationship To Other Tabs

- Command Center answers: what matters today?
- Games answers: what should I consider betting?
- Team/s answers: what are these teams really like?
- Matchup answers: what happens when two specific teams meet?

That separation matters. The Team/s tab should not collapse into a duplicate of Injuries or Matchup.

### Minimum Build For This Repo

Version 1 can ship without new backend endpoints if it uses existing pieces:

- local fallback team list from `teams-fallback.json`
- `fetchTeamSeasonStats(teamKey:)`
- `fetchTeamPlayerStats(teamKey:)`
- injury data already used by `InjuriesStore`

Suggested V1 composition:

- new `TeamsView`
- new `TeamsStore`
- team list sourced from local/fallback team catalog plus on-demand detail fetch
- drill-in destination `TeamProfileView`
- reuse `TeamStatsDetailPayload` and `TeamPlayersPayload`

V1 can stay read-only. No manual notes or tagging are required for the first pass.

### UI Direction

Keep the visual language consistent with the current app theme:

- dark scouting-console feel
- compact cards
- monospaced digits for metrics
- strong semantic color only for meaningful status: health, trend, risk

Avoid oversized hero headers or empty spacing. This tab should reward scanning.

### Success Criteria

The Team/s tab is successful if a user can do these three things in under 20 seconds:

1. identify the hottest and coldest teams in the league,
2. open one team and understand its real strength beyond record,
3. decide whether the team deserves matchup-level analysis or a pass.

## Gaps Filled In This Pass

- What-if iOS request now sends `homeKey`, `awayKey`, optional spread, and a nested player-status scenario payload expected by the Node backend.
- What-if response now renders outcome comparisons instead of expecting full `Decision` objects.
- Game rows now show action text plus projection and line-availability context.
- Game detail now includes a readiness checklist for model projection, market line, sample size, and stale input risk.
- Games tab now supports decision filters.
- Command Center now surfaces a daily read for top action, lineup watch, and risk flag.

## Next Expansion Backlog

- Add a dedicated Journal tab for manual result grading and postgame notes.
- Add a Bankroll screen with unit sizing, exposure by day, and local-only persistence controls.
- Add push-style local notifications for player status, stale data, and decision changes.
- Build the Team/s tab with a league board, sortable scouting cards, and drill-in team profiles.
- Add iPad split-view layout with game list on the left and detail on the right.
- Add a clear model card screen that explains inputs, confidence caps, and limitations.

## Future-Agent Prompt

Use this prompt for the next improvement loop:

```text
Analyze the WNBA Bet Predictor iOS app in ios/WNBABetPredictor. Treat it as a daily betting-research cockpit, not a sportsbook. Preserve responsible-betting language and the Node backend contract. Improve one high-impact area end to end: SwiftUI screen composition, data model/API contract, scenario simulation, bankroll/journal workflow, or iPad layout. Make scoped code changes, keep views small, update mock data when models change, and verify with XcodeBuildMCP build/run on the WNBABetPredictor scheme.
```
