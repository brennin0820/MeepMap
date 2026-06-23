/**
 * Alert engine — actionable flags for lineup, injuries, data gaps, and decision shifts.
 *
 * Pure functions. Alerts reference only supplied context.
 *
 * @module alert-engine
 */

const { DECISION_RANK } = require('./decision-engine');

/** @readonly */
const ALERT_SEVERITY = Object.freeze({
  CRITICAL: 'Critical',
  HIGH: 'High',
  WARNING: 'Medium',
  INFO: 'Info',
});

/** @readonly */
const ALERT_TYPES = Object.freeze({
  LINEUP_PENDING: 'LINEUP_WAIT',
  KEY_INJURY: 'QUESTIONABLE_PLAYER',
  STALE_DATA: 'CACHE_STALE',
  ODDS_MISSING: 'ODDS_MISSING',
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
  DECISION_DOWNGRADE: 'DECISION_DOWNGRADE',
  DECISION_UPGRADE: 'DECISION_UPGRADE',
  PICK_CHANGED: 'PICK_CHANGED',
  HIGH_RISK: 'HIGH_RISK_PICK',
  GAME_FINAL: 'GAME_FINAL',
  STRONG_PICK_FOUND: 'STRONG_PICK_FOUND',
  SOURCE_DEGRADED: 'DATA_SOURCE_FAILED',
});

/** @type {Array|null} */
let _previousSnapshot = null;
/** @type {Array|null} */
let _currentSnapshot = null;

/**
 * @param {Object} entry
 * @returns {string}
 */
function gameSnapshotKey(entry) {
  const g = entry.game || entry;
  return g.id || `${g.away}@${g.home}`;
}

/**
 * @param {Object} row
 * @returns {string}
 */
function resolveDecision(row) {
  if (typeof row.decision === 'string') return row.decision;
  return row.decision?.decision || row.decisionDetail?.decision || 'PASS';
}

/**
 * Persist current decisions for pick-change diff on next run.
 * @param {Array} gamesIntel
 * @returns {Array}
 */
function snapshotDecisions(gamesIntel) {
  _previousSnapshot = _currentSnapshot;
  _currentSnapshot = (gamesIntel || []).map((row) => ({
    gameId: gameSnapshotKey(row),
    home: row.game?.home || row.home,
    away: row.game?.away || row.away,
    decision: resolveDecision(row),
    recommendedPick: row.recommendedPick ?? null,
    edgeScore: row.edgeScore ?? row.decision?.edgeScore ?? row.decisionDetail?.edgeScore ?? 0,
    confidence: row.confidence ?? row.decision?.confidence ?? row.decisionDetail?.confidence ?? 0,
  }));
  return _currentSnapshot;
}

/**
 * @returns {Array|null} Last persisted decision snapshot (for pick-change diff).
 */
function getPreviousSnapshot() {
  return _currentSnapshot;
}

/** Reset in-memory snapshot store (for tests). */
function resetSnapshotStore() {
  _previousSnapshot = null;
  _currentSnapshot = null;
}

/**
 * Compare current vs previous snapshots and emit pick-change alerts.
 * @param {Array} current
 * @param {Array|null} previous
 * @returns {Array}
 */
function diffPickChanges(current, previous) {
  if (!previous || !previous.length) return [];

  const prevById = Object.fromEntries(previous.map((p) => [p.gameId, p]));
  const alerts = [];

  for (const row of current || []) {
    const gameId = gameSnapshotKey(row);
    const prev = prevById[gameId];
    if (!prev) continue;

    const currDecision = resolveDecision(row);
    const prevDecision = prev.decision;
    const currPick = row.recommendedPick ?? null;
    const prevPick = prev.recommendedPick ?? null;

    const currRank = DECISION_RANK[currDecision] ?? 0;
    const prevRank = DECISION_RANK[prevDecision] ?? 0;

    if (currDecision !== prevDecision) {
      const upgraded = currRank > prevRank;
      alerts.push({
        type: upgraded ? ALERT_TYPES.DECISION_UPGRADE : ALERT_TYPES.DECISION_DOWNGRADE,
        severity: upgraded ? ALERT_SEVERITY.INFO : ALERT_SEVERITY.HIGH,
        message: upgraded
          ? `Decision upgraded from ${prevDecision} to ${currDecision} for ${row.game?.away || row.away} @ ${row.game?.home || row.home}.`
          : `Decision downgraded from ${prevDecision} to ${currDecision} for ${row.game?.away || row.away} @ ${row.game?.home || row.home}.`,
        action: upgraded ? 'Re-evaluate stake sizing.' : 'Review new data before acting.',
        gameId,
        home: row.game?.home || row.home,
        away: row.game?.away || row.away,
        previousDecision: prevDecision,
        currentDecision: currDecision,
      });
    }

    if (currPick && prevPick && currPick !== prevPick) {
      alerts.push({
        type: ALERT_TYPES.PICK_CHANGED,
        severity: ALERT_SEVERITY.HIGH,
        message: `Recommended pick changed from "${prevPick}" to "${currPick}" (${row.game?.away || row.away} @ ${row.game?.home || row.home}).`,
        action: 'Confirm the move against latest line and injury news.',
        gameId,
        home: row.game?.home || row.home,
        away: row.game?.away || row.away,
        previousPick: prevPick,
        currentPick: currPick,
      });
    }

    if (currDecision === 'STRONG_PICK' && prevDecision !== 'STRONG_PICK') {
      alerts.push({
        type: ALERT_TYPES.STRONG_PICK_FOUND,
        severity: ALERT_SEVERITY.INFO,
        message: `New strong pick: ${row.game?.away || row.away} @ ${row.game?.home || row.home}${currPick ? ` — ${currPick}` : ''}.`,
        action: 'Validate line before wagering.',
        gameId,
        home: row.game?.home || row.home,
        away: row.game?.away || row.away,
      });
    }
  }

  return alerts;
}

/**
 * @typedef {Object} Alert
 * @property {string} type
 * @property {string} severity
 * @property {string} message
 * @property {string} [action]
 */

/**
 * Build alerts for a single game context.
 * @param {Object} input
 * @returns {Alert[]}
 */
function buildAlertsForGame(input = {}) {
  /** @type {Alert[]} */
  const alerts = [];
  const game = input.game || {};
  const decisionType = resolveDecision(input);

  if (game.status === 'final') {
    alerts.push({
      type: ALERT_TYPES.GAME_FINAL,
      severity: ALERT_SEVERITY.INFO,
      message: 'Game has finished — intelligence is post-hoc only.',
      action: 'Archive or compare to closing line if available.',
      gameId: gameSnapshotKey(input),
      home: game.home,
      away: game.away,
    });
    return alerts;
  }

  const lineup =
    input.lineup ||
    deriveLineupFromRosters(input.homeRoster, input.awayRoster);
  if (!lineup || lineup.confirmed !== true) {
    alerts.push({
      type: ALERT_TYPES.LINEUP_PENDING,
      severity: ALERT_SEVERITY.WARNING,
      message: 'Starting lineup not confirmed.',
      action: 'Re-run intelligence after official lineups post (~30 min pre-tip).',
      gameId: gameSnapshotKey(input),
      home: game.home,
      away: game.away,
    });
  }

  const injuries = input.injuries || collectInjuries(input);
  const criticalInjuries = [
    ...(injuries?.home || []),
    ...(injuries?.away || []),
  ].filter(
    (p) =>
      p &&
      (p.impact === 'high' ||
        String(p.status).toLowerCase().includes('out') ||
        String(p.status).toLowerCase().includes('doubt'))
  );

  if (criticalInjuries.length > 0) {
    const names = criticalInjuries.map((p) => p.name || p.player).filter(Boolean).join(', ');
    alerts.push({
      type: ALERT_TYPES.KEY_INJURY,
      severity: ALERT_SEVERITY.CRITICAL,
      message: names
        ? `Material injury uncertainty: ${names}.`
        : 'Material injury uncertainty on one or more teams.',
      action: 'Verify status and adjust stake or wait for confirmation.',
      gameId: gameSnapshotKey(input),
      home: game.home,
      away: game.away,
    });
  }

  const dq = input.dataQuality;
  if (dq?.flags?.isStale) {
    alerts.push({
      type: ALERT_TYPES.STALE_DATA,
      severity: ALERT_SEVERITY.WARNING,
      message: 'Input data exceeds freshness window.',
      action: 'Refresh team stats and odds before betting.',
      gameId: gameSnapshotKey(input),
      home: game.home,
      away: game.away,
    });
  }

  if (dq && !dq.flags?.hasOdds) {
    alerts.push({
      type: ALERT_TYPES.ODDS_MISSING,
      severity: ALERT_SEVERITY.INFO,
      message: 'No market odds attached — edge vs line cannot be validated.',
      action: 'Attach live spread/total when available.',
      gameId: gameSnapshotKey(input),
      home: game.home,
      away: game.away,
    });
  }

  if (decisionType === 'INSUFFICIENT_DATA') {
    alerts.push({
      type: ALERT_TYPES.INSUFFICIENT_DATA,
      severity: ALERT_SEVERITY.CRITICAL,
      message: 'Data quality too low for a supported pick.',
      action: 'Do not wager until minimum inputs are present.',
      gameId: gameSnapshotKey(input),
      home: game.home,
      away: game.away,
    });
  }

  if (decisionType === 'WAIT_FOR_LINEUP') {
    alerts.push({
      type: ALERT_TYPES.DECISION_DOWNGRADE,
      severity: ALERT_SEVERITY.WARNING,
      message: 'Decision held pending lineup confirmation.',
      action: 'Check back after starters are announced.',
      gameId: gameSnapshotKey(input),
      home: game.home,
      away: game.away,
    });
  }

  if (decisionType === 'HIGH_RISK_ONLY') {
    alerts.push({
      type: ALERT_TYPES.HIGH_RISK,
      severity: ALERT_SEVERITY.WARNING,
      message: 'Edge exists but variance flags recommend reduced stake only.',
      action: 'Consider quarter/half lines or pass if bankroll-sensitive.',
      gameId: gameSnapshotKey(input),
      home: game.home,
      away: game.away,
    });
  }

  return alerts;
}

/**
 * @param {Object} input
 * @returns {Object}
 */
function deriveLineupFromRosters(homeRoster, awayRoster) {
  const homeC = homeRoster?.confirmed ?? homeRoster?.lineupConfirmed;
  const awayC = awayRoster?.confirmed ?? awayRoster?.lineupConfirmed;
  if (homeC === true && awayC === true) return { confirmed: true };
  if (homeC === false || awayC === false) return { confirmed: false };
  return {};
}

/**
 * @param {Object} input
 * @returns {{ home: Array, away: Array }}
 */
function collectInjuries(input) {
  if (input.injuries && (input.injuries.home || input.injuries.away)) {
    return input.injuries;
  }
  const homePlayers = input.homeRoster?.players || input.homeRoster?.roster || [];
  const awayPlayers = input.awayRoster?.players || input.awayRoster?.roster || [];
  const mapInj = (p) => ({
    name: p.player || p.name,
    status: p.status,
    impact: p.impact,
  });
  return {
    home: homePlayers.filter((p) => p.status && p.status !== 'active').map(mapInj),
    away: awayPlayers.filter((p) => p.status && p.status !== 'active').map(mapInj),
  };
}

/**
 * @param {Object} input
 * @returns {Alert[]}
 */
function buildAlerts(input = {}) {
  if (input.gamesIntel) {
    const alerts = [];

    if (input.sourceHealth?.espn === 'failed' || input.sourceHealth?.cache === 'stale') {
      alerts.push({
        type: ALERT_TYPES.SOURCE_DEGRADED,
        severity: ALERT_SEVERITY.WARNING,
        message: input.meta?.warning || 'One or more data sources are degraded.',
        action: 'Refresh live data before locking picks.',
      });
    }

    for (const row of input.gamesIntel) {
      alerts.push(
        ...buildAlertsForGame({
          game: row.game,
          lineup: row.lineup,
          homeRoster: row.homeRoster,
          awayRoster: row.awayRoster,
          injuries: row.injuries,
          dataQuality: row.dataQuality,
          decision: row.decision || row.decisionDetail,
          odds: row.odds,
          recommendedPick: row.recommendedPick,
        })
      );
    }

    alerts.push(...diffPickChanges(input.gamesIntel, input.previousSnapshot));

    const seen = new Set();
    return alerts.filter((a) => {
      const key = `${a.type}|${a.gameId || ''}|${a.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return buildAlertsForGame(input);
}

module.exports = {
  buildAlerts,
  buildAlertsForGame,
  diffPickChanges,
  snapshotDecisions,
  getPreviousSnapshot,
  resetSnapshotStore,
  ALERT_SEVERITY,
  ALERT_TYPES,
};
