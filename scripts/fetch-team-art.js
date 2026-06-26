'use strict';

/**
 * Fetch WNBA team logos from ESPN, save under assets/teams/, and populate
 * data/team-branding.json with colors + sigil paths.
 *
 * Run: npm run fetch:team-art
 */

const fs = require('fs');
const path = require('path');
const { teamKeyFromAbbrev } = require('../server/espn');

const ROOT = path.join(__dirname, '..');
const TEAMS_FALLBACK = path.join(ROOT, 'data', 'teams-fallback.json');
const BRANDING_OUT = path.join(ROOT, 'data', 'team-branding.json');
const ASSETS_TEAMS = path.join(ROOT, 'assets', 'teams');
const ESPN_TEAMS_URL =
  'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/teams?limit=50';

/** ESPN CDN slug differs from our canonical key for some teams. */
const CDN_SLUG = { las: 'lv', was: 'wsh' };

function cdnSlug(key) {
  return CDN_SLUG[key] || key;
}

function cdnUrl(key) {
  return `https://a.espncdn.com/i/teamlogos/wnba/500/${cdnSlug(key)}.png`;
}

function toHex(color) {
  if (!color) return null;
  const c = String(color).replace(/^#/, '').trim();
  if (!c) return null;
  return `#${c.toLowerCase()}`;
}

function hexToRgb(hex) {
  const h = hex.replace(/^#/, '');
  const n = parseInt(h, 16);
  if (!Number.isFinite(n)) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function relativeLuminance(r, g, b) {
  const lin = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function textColorForBg(hex) {
  const { r, g, b } = hexToRgb(hex);
  return relativeLuminance(r, g, b) > 0.5 ? '#000000' : '#ffffff';
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'WNBA-Bet-Predictor/1.6' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

async function downloadFile(url, dest) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'WNBA-Bet-Predictor/1.6' },
  });
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

function readCanonicalKeys() {
  const fb = JSON.parse(fs.readFileSync(TEAMS_FALLBACK, 'utf8'));
  return fb.teams.map((t) => ({ key: t.key, name: t.name }));
}

function mapEspnTeams(data) {
  const entries = data.sports?.[0]?.leagues?.[0]?.teams || [];
  const byKey = {};
  for (const entry of entries) {
    const team = entry.team;
    const key = teamKeyFromAbbrev(team.abbreviation);
    if (!key) continue;
    byKey[key] = team;
  }
  return byKey;
}

function buildBrandingEntry(key, name, espnTeam) {
  const primary = toHex(espnTeam?.color) || '#333333';
  const secondary = toHex(espnTeam?.alternateColor) || primary;
  const accent = secondary;
  const text = textColorForBg(primary);
  const logoUrl =
    espnTeam?.logos?.find((l) => l.href)?.href ||
    espnTeam?.logos?.[0]?.href ||
    cdnUrl(key);

  return {
    name,
    colors: { primary, secondary, accent, text },
    sigil: {
      local: `assets/teams/${key}/sigil.png`,
      cdn: cdnUrl(key),
      inlineSvg: null,
      alt: `${name} logo`,
    },
    livery: {
      local: null,
      cdn: null,
      inlineSvg: null,
      pattern: null,
    },
    _logoUrl: logoUrl,
  };
}

async function main() {
  const canonical = readCanonicalKeys();
  console.log(`Canonical teams: ${canonical.length}`);

  const espnData = await fetchJson(ESPN_TEAMS_URL);
  const espnByKey = mapEspnTeams(espnData);

  const branding = {};
  const errors = [];

  for (const { key, name } of canonical) {
    const espnTeam = espnByKey[key];
    if (!espnTeam) {
      errors.push(`No ESPN match for key "${key}"`);
      continue;
    }

    const entry = buildBrandingEntry(key, name, espnTeam);
    const dir = path.join(ASSETS_TEAMS, key);
    const sigilPath = path.join(dir, 'sigil.png');

    fs.mkdirSync(dir, { recursive: true });
    try {
      await downloadFile(entry._logoUrl, sigilPath);
      console.log(`  ✓ ${key}: ${sigilPath}`);
    } catch (err) {
      errors.push(`${key}: logo download failed (${err.message})`);
    }

    delete entry._logoUrl;
    branding[key] = entry;
  }

  const payload = {
    _schemaVersion: 1,
    source: 'espn',
    lastUpdated: new Date().toISOString(),
    branding,
  };

  fs.writeFileSync(BRANDING_OUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${BRANDING_OUT}`);

  if (errors.length) {
    console.error('\nWarnings:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log(`\nDone — ${Object.keys(branding).length} teams branded.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
