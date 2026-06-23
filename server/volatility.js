'use strict';

/**
 * Team volatility index from recent game margins (last 5).
 * Labels: Hot (stable positive), Cold (stable negative), Collapsing (high variance / swing).
 */

const VARIANCE_COLLAPSING = 80;
const VARIANCE_STABLE = 55;
const MIN_GAMES = 2;

function teamMarginsFromSchedule(priorGames, teamKey) {
  const key = teamKey?.toLowerCase();
  if (!key || !Array.isArray(priorGames)) return [];

  const sorted = [...priorGames]
    .filter((e) => e.statusState === 'post')
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const margins = [];
  for (const event of sorted) {
    const homeKey = event.homeTeam?.key;
    const awayKey = event.awayTeam?.key;
    if (homeKey === key) {
      margins.push((event.homeScore || 0) - (event.awayScore || 0));
    } else if (awayKey === key) {
      margins.push((event.awayScore || 0) - (event.homeScore || 0));
    }
    if (margins.length >= 5) break;
  }
  return margins;
}

function marginVariance(margins) {
  if (!margins.length) return 0;
  if (margins.length === 1) return 0;
  const mean = margins.reduce((a, b) => a + b, 0) / margins.length;
  return margins.reduce((s, n) => s + (n - mean) ** 2, 0) / margins.length;
}

function isCollapsingPattern(margins) {
  if (margins.length < 3) return false;
  const variance = marginVariance(margins);
  if (variance >= VARIANCE_COLLAPSING) return true;
  const recent = margins.slice(0, 2);
  const older = margins.slice(2);
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
  return olderAvg >= 5 && recentAvg <= -2;
}

/**
 * @param {Object} team
 * @param {Array} [priorGames]
 * @returns {'Hot'|'Cold'|'Collapsing'|null}
 */
function volatilityLabel(team, priorGames = []) {
  const margins = teamMarginsFromSchedule(priorGames, team?.key);
  if (margins.length < MIN_GAMES) {
    if (typeof team?.avgMargin === 'number') {
      if (team.avgMargin >= 5) return 'Hot';
      if (team.avgMargin <= -5) return 'Cold';
    }
    return null;
  }

  const mean = margins.reduce((a, b) => a + b, 0) / margins.length;
  const variance = marginVariance(margins);

  if (isCollapsingPattern(margins)) return 'Collapsing';
  if (variance >= VARIANCE_COLLAPSING) return 'Collapsing';
  if (mean >= 3 && variance <= VARIANCE_STABLE) return 'Hot';
  if (mean <= -3 && variance <= VARIANCE_STABLE) return 'Cold';
  if (mean > 0 && variance > VARIANCE_STABLE) return 'Collapsing';
  if (mean >= 0) return 'Hot';
  return 'Cold';
}

function volatilityIndex(team, priorGames = []) {
  const label = volatilityLabel(team, priorGames);
  const margins = teamMarginsFromSchedule(priorGames, team?.key);
  return {
    label,
    margins,
    variance: margins.length >= 2 ? +marginVariance(margins).toFixed(1) : null,
    avgMargin: margins.length ? +(margins.reduce((a, b) => a + b, 0) / margins.length).toFixed(1) : null,
    sampleSize: margins.length,
  };
}

module.exports = {
  teamMarginsFromSchedule,
  marginVariance,
  volatilityLabel,
  volatilityIndex,
};
