# Team Branding — Field Contract

> **STATUS: PREP SCAFFOLD.** Nothing here is wired into the live app yet. All values in
> [`team-branding.json`](team-branding.json) are `null`/empty on purpose. When you are ready,
> populate the fields and follow the activation steps in
> [`../BRANDING.md`](../BRANDING.md). Until then, the loader (`server/team-branding.js`) is a
> no-op merge and the UI renders exactly as it does today.

## Where keys come from

Branding is keyed by the same lowercase team `key` used in
[`teams-fallback.json`](teams-fallback.json) (`atl`, `chi`, `con`, `dal`, `ind`, `las`, `min`,
`ny`, `phx`, `sea`, `was`, `gs`, `tor`). Keep the two files in sync — if a team is added to the
league, add it to both.

## Per-team shape

```jsonc
"atl": {
  "name": "Atlanta Dream",        // human label, mirror of teams-fallback for sanity-checking
  "colors": {
    "primary":   "#E03A3E",        // main team color — drives the accent strip / sigil background
    "secondary": "#000000",        // supporting color
    "accent":    "#C1D32F",        // optional 3rd color (logo detail, highlight)
    "text":      "#FFFFFF"         // legible text color ON the primary color (contrast pairing)
  },
  "sigil": {
    "local":     "assets/teams/atl/sigil.svg",       // path served as a static file (preferred)
    "cdn":       "https://a.espncdn.com/.../atl.png", // external logo URL (fallback / convenience)
    "inlineSvg": "<svg ...>...</svg>",                // raw SVG markup, self-contained
    "alt":       "Atlanta Dream logo"                 // accessibility text
  },
  "livery": {
    "local":     "assets/teams/atl/livery.svg",      // full uniform / banner artwork, static file
    "cdn":       "https://.../atl-livery.png",        // external livery URL
    "inlineSvg": "<svg ...>...</svg>",                // raw SVG markup
    "pattern":   null                                  // optional named CSS pattern (e.g. "stripes")
  }
}
```

## Resolution rule (how the eventual renderer should pick a source)

For both `sigil` and `livery`, the consuming code resolves the first non-empty value in this
priority order:

1. `inlineSvg` — most self-contained, no extra request
2. `local` — self-hosted file under `assets/teams/` (offline-safe)
3. `cdn` — external URL (last resort; depends on the host staying up)

A team with all three empty must render the **current** text-only treatment. This keeps the
feature progressive: partially-populated data degrades gracefully, team by team.

## Colors

`colors.primary` + `colors.text` are the minimum useful pair (an accent strip with legible
text). `secondary`/`accent` are optional. Any `null` color should fall back to the existing
neutral CSS variables — never hard-code a default here.
