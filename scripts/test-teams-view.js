'use strict';

/**
 * Unit tests for the browser-side Team/s board logic (js/teams-view.js).
 * The module is an IIFE that binds to `window`, so we provide a minimal
 * `window` shim (with AlertsUI.escapeHtml) before requiring it. This verifies
 * the port of the iOS TeamsStore logic (segments, sorts, trend/health labels,
 * betting notes) and that rendering escapes untrusted team/player data.
 */

const assert = require('assert');
const path = require('path');

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

global.window = {};
global.window.AlertsUI = { escapeHtml };
require(path.join('..', 'js', 'teams-view.js'));

const TeamsView = global.window.TeamsView;
assert(TeamsView, 'TeamsView should be attached to window');
const T = TeamsView._internal;

// --- parseRecordWins ---------------------------------------------------------
assert.strictEqual(T.parseRecordWins('4-1'), 4);
assert.strictEqual(T.parseRecordWins('0-5'), 0);
assert.strictEqual(T.parseRecordWins(''), 0);
assert.strictEqual(T.parseRecordWins(null), 0);
assert.strictEqual(T.parseRecordWins('garbage'), 0);

// --- severityScore (out > question/doubt > probable > other) -----------------
assert.strictEqual(T.severityScore('Out'), 3);
assert.strictEqual(T.severityScore('Questionable'), 2);
assert.strictEqual(T.severityScore('Doubtful'), 2);
assert.strictEqual(T.severityScore('Probable'), 1);
assert.strictEqual(T.severityScore('Active'), 0);

// --- trendLabel --------------------------------------------------------------
assert.strictEqual(T.trendLabel({ last5: '5-0', last10: '9-1', netRating: 14 }), 'Rising');
assert.strictEqual(T.trendLabel({ last5: '1-4', last10: '3-7', netRating: -8 }), 'Sliding');
assert.strictEqual(T.trendLabel({ last5: '3-2', last10: '6-4', netRating: 1 }), 'Stable');
// last10 <= 3 wins AND negative net => Sliding even if last5 is ok
assert.strictEqual(T.trendLabel({ last5: '2-3', last10: '3-7', netRating: -1 }), 'Sliding');

// --- healthLabel -------------------------------------------------------------
const twoOut = [
  { teamKey: 'min', status: 'Out' },
  { teamKey: 'min', status: 'Out' },
];
assert.strictEqual(T.healthLabel({ key: 'min' }, twoOut), 'Thin');
assert.strictEqual(T.healthLabel({ key: 'min' }, [{ teamKey: 'min', status: 'Questionable' }]), 'Watch');
assert.strictEqual(T.healthLabel({ key: 'min' }, [{ teamKey: 'min', status: 'Probable' }]), 'Watch');
assert.strictEqual(T.healthLabel({ key: 'min' }, []), 'Clean');
// injuries for a different team must not count
assert.strictEqual(T.healthLabel({ key: 'min' }, [{ teamKey: 'las', status: 'Out' }]), 'Clean');

// --- matchesSegment ----------------------------------------------------------
assert.strictEqual(T.matchesSegment({ netRating: 8, wins: 12, last5: '5-0' }, 'contenders'), true);
assert.strictEqual(T.matchesSegment({ netRating: 1, wins: 10, last5: '3-2' }, 'contenders'), true); // wins>=10
assert.strictEqual(T.matchesSegment({ netRating: 1, wins: 5, last5: '3-2' }, 'midTable'), true);
assert.strictEqual(T.matchesSegment({ netRating: -9, wins: 4, last5: '1-4' }, 'fadeWatch'), true);
assert.strictEqual(T.matchesSegment({ netRating: 8, wins: 12, last5: '1-4' }, 'fadeWatch'), true); // last5<=1 win
assert.strictEqual(T.matchesSegment({ netRating: 8, wins: 12, last5: '5-0' }, 'all'), true);

// --- filterTeams sorting -----------------------------------------------------
const teams = [
  { key: 'min', name: 'Minnesota Lynx', netRating: 14.7, last5: '5-0', offRating: 111.2, defRating: 96.5, pace: 94.5, avgMargin: 11.4 },
  { key: 'was', name: 'Washington Mystics', netRating: -12.3, last5: '1-4', offRating: 98.5, defRating: 110.8, pace: 94.0, avgMargin: -9.7 },
  { key: 'sea', name: 'Seattle Storm', netRating: 1.4, last5: '3-2', offRating: 106.2, defRating: 104.8, pace: 93.8, avgMargin: 1.3 },
];
const byNet = T.filterTeams(teams, { sort: 'netRating', segment: 'all', search: '', today: false }, [], new Set());
assert.deepStrictEqual(byNet.map((t) => t.key), ['min', 'sea', 'was'], 'net sort desc');

const byDef = T.filterTeams(teams, { sort: 'defense', segment: 'all', search: '', today: false }, [], new Set());
assert.strictEqual(byDef[0].key, 'min', 'best defense (lowest defRating) sorts first');

const searchMin = T.filterTeams(teams, { sort: 'netRating', segment: 'all', search: 'lynx', today: false }, [], new Set());
assert.deepStrictEqual(searchMin.map((t) => t.key), ['min'], 'search by name');

// --- bettingNotes ------------------------------------------------------------
const notesThin = T.bettingNotes(
  { key: 'min', netRating: 8, avgMargin: 2, offRating: 110, defRating: 100, pace: 98, last5: '5-0', last10: '9-1' },
  null,
  twoOut.map((i) => ({ ...i, teamKey: 'min' }))
);
assert(notesThin.length <= 3, 'at most 3 notes');
assert(notesThin.includes('Underlying efficiency is stronger than the win margin.'));
assert(notesThin.includes('Fast pace increases total volatility.'));

const notesFallback = T.bettingNotes({ key: 'sea', netRating: 1.4 }, null, []);
assert.deepStrictEqual(notesFallback, ['Usable team when price matches the profile.']);
const notesNegative = T.bettingNotes({ key: 'was', netRating: -5 }, null, []);
assert.deepStrictEqual(notesNegative, ['Price-sensitive team that needs matchup help.']);

// --- render is XSS-safe ------------------------------------------------------
const evilTeam = {
  key: 'evil',
  name: '<img src=x onerror=alert(1)>',
  record: '1-1',
  last5: '1-0',
  last10: '1-0',
  netRating: 1,
  pace: 95,
  offRating: 100,
  defRating: 100,
};
const html = TeamsView.renderTeamsPanel({
  teams: [evilTeam],
  injuries: [],
  todayKeys: [],
  filter: { search: '', segment: 'all', sort: 'netRating', today: false },
  expandedTeamKey: null,
  teamDetails: {},
  playersCache: {},
});
assert(typeof html === 'string' && html.length > 0, 'render returns html');
assert(html.includes('&lt;img src=x'), 'team name must be HTML-escaped');
assert(!html.includes('<img src=x onerror'), 'raw script payload must not appear');

// render of an expanded profile with malicious player + injury data
const evilHtml = TeamsView.renderTeamsPanel({
  teams: [evilTeam],
  injuries: [{ teamKey: 'evil', player: '<b>x</b>', status: 'Out', note: '<script>1</script>' }],
  todayKeys: ['evil'],
  filter: { search: '', segment: 'all', sort: 'netRating', today: false },
  expandedTeamKey: 'evil',
  teamDetails: { evil: { teamKey: 'evil', loaded: true, stats: { netRating: 1, pace: 95 } } },
  playersCache: { evil: { teamKey: 'evil', loaded: true, players: [{ name: '<i>p</i>', stats: { ppg: 10, mpg: 30, rpg: 5, apg: 4 } }] } },
});
assert(!evilHtml.includes('<script>1</script>'), 'injury note must be escaped');
assert(evilHtml.includes('&lt;b&gt;x&lt;/b&gt;'), 'player injury name must be escaped');
assert(evilHtml.includes('&lt;i&gt;p&lt;/i&gt;'), 'player production name must be escaped');

// --- renderSigil (cdn / local / initials fallback) ---------------------------
const cdnBranding = {
  hasBranding: true,
  colors: { primary: '#e31837', secondary: '#5091cc', accent: '#5091cc', text: '#ffffff' },
  sigil: { kind: 'cdn', value: 'https://a.espncdn.com/i/teamlogos/wnba/500/atl.png', alt: 'Atlanta Dream logo' },
};
const cdnHtml = T.renderSigil(cdnBranding, { key: 'atl', name: 'Atlanta Dream' });
assert(cdnHtml.includes('team-sigil'), 'cdn sigil renders team-sigil');
assert(cdnHtml.includes('https://a.espncdn.com/i/teamlogos/wnba/500/atl.png'), 'cdn sigil uses img src');
assert(cdnHtml.includes('team-sigil--lg'), 'cdn sigil uses large size');

const localBranding = {
  hasBranding: true,
  colors: { primary: '#002d62', secondary: '#e03a3e', accent: '#e03a3e', text: '#ffffff' },
  sigil: { kind: 'local', value: 'assets/teams/ind/sigil.png', alt: 'Indiana Fever logo' },
};
const localHtml = T.renderSigil(localBranding, { key: 'ind', name: 'Indiana Fever' });
assert(localHtml.includes('assets/teams/ind/sigil.png'), 'local sigil uses local path');

const initialsHtml = T.renderSigil(null, { key: 'min', name: 'Minnesota Lynx' });
assert(initialsHtml.includes('team-sigil--initials'), 'missing branding falls back to initials');
assert(initialsHtml.includes('ML'), 'initials derived from team name');

// --- renderCard includes branded sigil ---------------------------------------
const brandedTeam = {
  key: 'min',
  name: 'Minnesota Lynx',
  record: '13-3',
  last5: '5-0',
  last10: '9-1',
  netRating: 14.7,
  pace: 94.5,
  offRating: 111.2,
  defRating: 96.5,
  homeRecord: '7-1',
  awayRecord: '6-2',
  branding: {
    hasBranding: true,
    colors: { primary: '#266092', secondary: '#79bc43', accent: '#79bc43', text: '#ffffff' },
    sigil: { kind: 'local', value: 'assets/teams/min/sigil.png', alt: 'Minnesota Lynx logo' },
  },
};
const cardHtml = T.renderCard(brandedTeam, { injuries: [], expandedTeamKey: null }, new Set());
assert(cardHtml.includes('team-card--branded'), 'branded card has team-card--branded');
assert(cardHtml.includes('team-color-rail'), 'branded card has color rail');
assert(cardHtml.includes('team-badge'), 'branded card has team-badge');
assert(cardHtml.includes('team-sigil'), 'branded card includes sigil');
assert(cardHtml.includes('assets/teams/min/sigil.png'), 'branded card sigil uses local asset');

// escape safety in sigil alt / malicious team name
const evilBranding = {
  hasBranding: true,
  colors: { primary: '#000', secondary: '#fff', accent: '#fff', text: '#fff' },
  sigil: { kind: 'cdn', value: 'https://example.com/logo.png', alt: '<script>evil</script>' },
};
const evilSigil = T.renderSigil(evilBranding, { key: 'x', name: '<b>x</b>' });
assert(evilSigil.includes('&lt;script&gt;evil&lt;/script&gt;'), 'sigil alt must be escaped');
assert(!evilSigil.includes('<script>evil</script>'), 'raw script in alt must not appear');

console.log('Teams view tests passed');
