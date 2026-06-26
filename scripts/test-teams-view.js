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

console.log('Teams view tests passed');
