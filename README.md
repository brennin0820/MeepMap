# MeepMap

**2026 WNBA Bet Predictor** — a decision-driven betting-intelligence web app.
An Express API serves a single-page frontend (Command Center, Games, Scoreboard,
Matchup, Injuries, Journal, Settings) backed by a rule-based prediction engine.

> Predictions are statistical estimates only. They are not financial advice.
> Never bet money you cannot afford to lose.

## Run locally

```bash
npm install
npm start
# open http://localhost:3847
```

The server listens on `PORT` (default `3847`).

## Desktop app

MeepMap ships two desktop paths. Pick based on need:

| Path | Build | Output | When to use |
| --- | --- | --- | --- |
| **Electron** | `npm run electron:build:win` | `dist-electron/win-unpacked/MeepMap.exe` | Full app: system tray, native notifications, no browser needed |
| **pkg** | `npm run build:exe` | `WNBA-Bet-Predictor.exe` | Lightweight single-exe; launches the browser. Good for quick sharing |

### Run / develop

- Dev: `npm run electron:dev`
- Package for Windows: `npm run electron:build:win`
- Zip for sharing: `npm run electron:build:zip`

### Behavior

- Closing the window hides it to the tray; quit from the tray menu.
- Data persists at `%APPDATA%/MeepMap/data`; logs at `%APPDATA%/MeepMap/logs/main.log`.
- The embedded server picks a free port automatically, starting at `3847`.

### Code signing (Windows)

Unsigned builds trigger SmartScreen warnings. To sign, obtain an Authenticode certificate, set `CSC_LINK` and `CSC_KEY_PASSWORD`, then enable `signAndEditExecutable` in the Windows build config. Until a cert is available this stays disabled and builds remain unsigned.

## Deploy as a web app

The app is a standard long-running Node/Express service, so any host that runs
a Node process works. Writable state (betting journal, bankroll, prediction
history) is stored as JSON files in `DATA_DIR`.

### Environment variables

| Variable   | Default            | Purpose                                                        |
| ---------- | ------------------ | -------------------------------------------------------------- |
| `PORT`     | `3847`             | Port the server binds to (most hosts set this automatically).  |
| `DATA_DIR` | bundled `./data`   | Writable directory for journal / bankroll / prediction history. |

On first start, `DATA_DIR` is seeded from the bundled `./data` files, so a fresh
volume begins with the shipped prediction history rather than an empty state.
Writes are fail-safe: on a read-only filesystem the app keeps serving from seed
data instead of crashing (persistence is simply disabled, with a console
warning).

> **Persistence:** point `DATA_DIR` at a **persistent disk/volume**. Without one,
> hosts with ephemeral filesystems will reset journal/bankroll/history on each
> redeploy or restart.

### Render (one-click via Blueprint)

This repo ships a [`render.yaml`](./render.yaml). In the Render dashboard choose
**New + → Blueprint** and select this repo — Render provisions the web service
and a 1 GB persistent disk mounted at `/var/data` (with `DATA_DIR=/var/data`)
and deploys automatically. Health checks hit `/api/health`.

### Docker (Railway, Fly.io, Cloud Run, self-host)

```bash
docker build -t wnba-bet-predictor .
docker run -p 3847:3847 -v wnba-data:/data wnba-bet-predictor
# open http://localhost:3847
```

The image defaults to `DATA_DIR=/data`; mount a volume there to persist state.

## API highlights

Local server on the configured port:

```
GET  /api/health                     — service status
GET  /api/intelligence               — decision dashboard
GET  /api/intelligence/lineup-watch  — games waiting on lineups
GET  /api/predictions                — model predictions for upcoming games
GET  /api/scoreboard                 — schedule + scores
GET  /api/grade                      — score completed predictions
GET  /api/odds/movement              — line movement (requires odds provider)
```

Live data is fetched from public sources (e.g. ESPN) with bundled local
fallbacks, so the app stays functional even when upstream sources are
unavailable.
