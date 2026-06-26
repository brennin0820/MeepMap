# MeepMap desktop app icons

Source vector: `icon.svg` (diamond gem on dark gradient — matches app `--accent` / topbar branding).

Generated raster assets (for electron-builder):

| File | Purpose |
|------|---------|
| `icon.png` | Primary icon (512×512); electron-builder fallback |
| `icon.ico` | Windows NSIS / portable installer |
| `icons/*.png` | Linux AppImage size set |

Regenerate after editing `icon.svg`:

```bash
node scripts/generate-app-icons.js
```
