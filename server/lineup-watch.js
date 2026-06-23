'use strict';

const { DECISION_TYPES } = require('./decision-engine');

/**
 * Games held for official starting lineups.
 */
function filterLineupWatch(games = []) {
  return games.filter((g) => {
    const decision =
      typeof g.decision === 'object' && g.decision != null
        ? g.decision.decision
        : g.decision;
    return decision === DECISION_TYPES.WAIT_FOR_LINEUP;
  });
}

function buildLineupWatchPayload(intel) {
  const games = filterLineupWatch(intel.games || []);
  const alerts = (intel.alerts || []).filter(
    (a) => a.type === 'LINEUP_WAIT' || a.code === 'LINEUP_WAIT'
  );

  return {
    generatedAt: intel.generatedAt || new Date().toISOString(),
    count: games.length,
    games,
    alerts,
    summary: {
      waitForLineup: games.length,
      alertCount: alerts.length,
    },
    meta: intel.meta || null,
  };
}

module.exports = {
  filterLineupWatch,
  buildLineupWatchPayload,
};
