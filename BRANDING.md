# Team Branding — Activation Guide

This documents the **prep scaffold** for team **sigils**, **colors**, and **liveries**, and the
exact steps to turn it on. Nothing in this feature is live yet — the app renders today's
text-only team treatment until you populate data and wire the steps below.

## What's already scaffolded (no behavior change)

| File | Purpose | State |
| --- | --- | --- |
| [`data/team-branding.json`](data/team-branding.json) | Per-team colors + sigil/livery sources, keyed by team key | All 13 teams present, all values `null` |
| [`data/team-branding.README.md`](data/team-branding.README.md) | Field contract & resolution rule | Reference doc |
| [`assets/teams/`](assets/teams/) | Static image files (`<key>/sigil.svg`, `<key>/livery.svg`) | Empty + convention README |
| [`server/team-branding.js`](server/team-branding.js) | Loader + merge helper (`attachBranding`, `getTeamBranding`, `resolveAsset`) | Built, **not imported anywhere** |
| `styles.css` (TEAM BRANDING block) | `.team-sigil`, `.team-badge`, `.team-color-rail`, `.team-livery` + `--team-*` vars | Inert (no markup uses the classes) |

Because the JSON is empty and the loader is unreferenced, every piece is a no-op. Verify with
`npm test` / a server boot — output is identical to before the scaffold.

## Asset source priority

Each `sigil` / `livery` can specify up to three sources; the resolver in
[`server/team-branding.js`](server/team-branding.js) (`resolveAsset`) picks the first present:

1. `inlineSvg` — raw SVG markup (most self-contained)
2. `local` — file under `assets/teams/` served as static content
3. `cdn` — external URL

All empty ⇒ fall back to text-only (initials).

## Activation steps (do these only when told to)

1. **Populate data.** Fill `colors` and at least one `sigil` source per team in
   [`data/team-branding.json`](data/team-branding.json); set `lastUpdated`. Drop any local
   files into [`assets/teams/<key>/`](assets/teams/).

2. **Wire the server merge.** In [`server/data-fetcher.js`](server/data-fetcher.js), import the
   helper and run teams through it inside `getTeams()` (after `enrichTeamsFromFallback`):

   ```js
   const teamBranding = require('./team-branding');
   // ...at the end of getTeams(), before returning:
   result.teams = teamBranding.attachBrandingToTeams(result.teams);
   ```

   This adds a `.branding` field to each team that has populated data; others are untouched.
   (Alternatively wire it only into the `/api/teams` handler in
   [`server/index.js`](server/index.js#L65) if you want branding on that endpoint alone.)

3. **Render on the client.** `state.teams` ([`app.js`](app.js#L317)) will then carry
   `team.branding`. Add a sigil/color treatment where teams are shown — primarily the game
   card matchup line in [`js/intelligence-view.js`](js/intelligence-view.js#L113) (`game.away`
   / `game.home`). A render helper should:
   - look up the team by name/key to get `branding`,
   - emit `.team-badge` with a `.team-sigil` (inline SVG, `<img>` for local/cdn, or initials),
   - set inline `--team-primary` / `--team-text` from `branding.colors`.

   Note game cards currently only have `game.away`/`game.home` **names** — you'll map those to
   keys via the existing `findTeamByName` logic or by passing branding through on the server
   row builder in [`server/intelligence-service.js`](server/intelligence-service.js#L188).

4. **Liveries (optional, last).** Use `.team-livery` on a larger surface (e.g. the matchup
   analyzer hero in [`js/matchup-view.js`](js/matchup-view.js)) once sigils/colors look right.

## Rollback

Delete the import + the one `attachBrandingToTeams` line from step 2. The scaffold files can
stay — with empty data and no import they have no effect.
