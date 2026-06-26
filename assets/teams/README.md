# Team Image Assets

> **STATUS: PREP SCAFFOLD — empty on purpose.** Drop files here when you're ready; nothing
> references them yet. The folder is served as static content (see `express.static(ROOT)` in
> [`../../server/index.js`](../../server/index.js)), so any file placed here is reachable at the
> matching URL path, e.g. `assets/teams/atl/sigil.svg`.

## Convention

One folder per team, named by the lowercase team `key` (matching
[`../../data/teams-fallback.json`](../../data/teams-fallback.json)):

```
assets/teams/
  atl/
    sigil.svg      # team logo / crest — square-ish, transparent background preferred
    livery.svg     # full uniform / banner artwork (optional)
  chi/
    sigil.svg
    ...
```

Team keys: `atl  chi  con  dal  ind  las  min  ny  phx  sea  was  gs  tor`

## Guidelines

- **Format:** SVG preferred (crisp at any size, theming-friendly). PNG acceptable for
  photographic liveries — use a transparent background and ≥ 512px on the short edge.
- **Sigil:** keep it tight to the mark with minimal padding; the UI adds its own spacing.
- **Naming:** `sigil.*` and `livery.*` exactly, so the loader can find them by convention
  without per-file config. If you deviate, set the explicit path in
  [`../../data/team-branding.json`](../../data/team-branding.json) instead.
- **Licensing:** only commit artwork you have the right to use. Official team logos are
  trademarked — prefer original/abstract sigils unless you've cleared usage.

When files are in place, point the branding JSON's `sigil.local` / `livery.local` fields at
them (or rely on convention-based lookup once the loader is wired — see
[`../../BRANDING.md`](../../BRANDING.md)).
