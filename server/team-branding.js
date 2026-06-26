'use strict';

/**
 * Team branding loader & merge helper.
 *
 * PREP SCAFFOLD — built but NOT yet wired into the live data path.
 * `data/team-branding.json` currently holds only null placeholders, so every function
 * here is effectively a no-op until that file is populated. When you're ready to turn it
 * on, follow BRANDING.md: import this module in server/data-fetcher.js (or server/index.js's
 * /api/teams handler) and run each team through `attachBranding`.
 *
 * Design goals:
 *  - Zero behavior change while branding data is empty (degrades to today's text-only UI).
 *  - Per-source resolution: inlineSvg > local file > cdn url (see resolveAsset).
 *  - Tolerant of missing keys, missing file, and partially-populated teams.
 */

const fs = require('fs');
const path = require('path');

const { BUNDLED_DATA_DIR } = require('./paths');
const BRANDING_FILE = path.join(BUNDLED_DATA_DIR, 'team-branding.json');

let _cache = null;

/** Read and cache data/team-branding.json. Returns {} on any error (fail-soft). */
function loadBranding() {
  if (_cache) return _cache;
  try {
    const raw = fs.readFileSync(BRANDING_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    _cache = parsed.branding || {};
  } catch {
    _cache = {};
  }
  return _cache;
}

/** Clear the in-memory cache (call after editing the JSON during dev). */
function clearCache() {
  _cache = null;
}

/** True if a value is a usable, non-empty string. */
function present(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Resolve a sigil/livery asset block to the single source the UI should use.
 * Priority: inlineSvg > local > cdn. Returns null when nothing is populated,
 * which signals the renderer to fall back to the current text-only treatment.
 */
function resolveAsset(asset) {
  if (!asset || typeof asset !== 'object') return null;
  if (present(asset.inlineSvg)) return { kind: 'inline', value: asset.inlineSvg, alt: asset.alt || null };
  if (present(asset.local)) return { kind: 'local', value: asset.local, alt: asset.alt || null };
  if (present(asset.cdn)) return { kind: 'cdn', value: asset.cdn, alt: asset.alt || null };
  return null;
}

/** Strip null/empty colors so consumers can use `?? fallbackVar` cleanly. */
function resolveColors(colors) {
  if (!colors || typeof colors !== 'object') return null;
  const out = {};
  for (const k of ['primary', 'secondary', 'accent', 'text']) {
    if (present(colors[k])) out[k] = colors[k];
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Build a normalized branding object for one team key, or null if nothing is set.
 * Shape (when populated):
 *   { colors: {primary,...}|null, sigil: {kind,value,alt}|null, livery: {...}|null, hasBranding: bool }
 */
function getTeamBranding(teamKey) {
  if (!teamKey) return null;
  const entry = loadBranding()[String(teamKey).toLowerCase()];
  if (!entry) return null;
  const colors = resolveColors(entry.colors);
  const sigil = resolveAsset(entry.sigil);
  const livery = resolveAsset(entry.livery);
  if (!colors && !sigil && !livery) return null;
  return { colors, sigil, livery, hasBranding: true };
}

/**
 * Attach a `.branding` field to a single team object. No-op (returns the team
 * unchanged) when that team has no populated branding, so it's safe to map over
 * every team unconditionally.
 */
function attachBranding(team) {
  if (!team || !team.key) return team;
  const branding = getTeamBranding(team.key);
  if (!branding) return team;
  return { ...team, branding };
}

/** Map attachBranding over an array of teams. */
function attachBrandingToTeams(teams) {
  return (teams || []).map(attachBranding);
}

module.exports = {
  loadBranding,
  clearCache,
  resolveAsset,
  resolveColors,
  getTeamBranding,
  attachBranding,
  attachBrandingToTeams,
};
