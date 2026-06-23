'use strict';

const injuries = require('./injuries');

const IMPACT_TIERS = {
  out: 4.0,
  doubtful: 2.5,
  questionable: 1.0,
  probable: 0.25,
  dayToDay: 1.0,
};

/**
 * Pure status → impact points (unit-testable, no I/O).
 * @param {string|undefined} status
 * @returns {number}
 */
function statusImpact(status) {
  if (!status) return 0;
  const s = String(status).toLowerCase();
  if (s.includes('out')) return IMPACT_TIERS.out;
  if (s.includes('doubt')) return IMPACT_TIERS.doubtful;
  if (s.includes('question')) return IMPACT_TIERS.questionable;
  if (s.includes('probable')) return IMPACT_TIERS.probable;
  if (s.includes('day')) return IMPACT_TIERS.dayToDay;
  return 0.5;
}

/**
 * Pure roster impact from player list — no network calls.
 * @param {Array} players
 * @returns {{ impactPoints: number, affectedPlayers: Array }}
 */
function computeRosterImpact(players = []) {
  let totalImpact = 0;
  const affected = [];

  for (const inj of players) {
    const impact = statusImpact(inj.status);
    if (impact > 0) {
      totalImpact += impact;
      affected.push({
        player: inj.player || inj.name,
        status: inj.status,
        impact,
      });
    }
  }

  return {
    impactPoints: +totalImpact.toFixed(2),
    affectedPlayers: affected,
  };
}

/**
 * Pure matchup impact from rosters — no network calls.
 * @param {Object} [homeRoster]
 * @param {Object} [awayRoster]
 * @returns {Object}
 */
function computeMatchupImpactFromRosters(homeRoster, awayRoster) {
  const homePlayers = homeRoster?.players || homeRoster?.roster || [];
  const awayPlayers = awayRoster?.players || awayRoster?.roster || [];
  const home = computeRosterImpact(homePlayers);
  const away = computeRosterImpact(awayPlayers);

  return {
    home: {
      teamKey: homeRoster?.teamKey,
      ...home,
    },
    away: {
      teamKey: awayRoster?.teamKey,
      ...away,
    },
    netAdjustment: +(away.impactPoints - home.impactPoints).toFixed(2),
  };
}

async function getTeamImpact(teamKey) {
  const injuryData = await injuries.getInjuriesForTeam(teamKey);
  const computed = computeRosterImpact(
    (injuryData.injuries || []).map((inj) => ({
      player: inj.player,
      status: inj.status,
    }))
  );

  return {
    teamKey,
    impactPoints: computed.impactPoints,
    affectedPlayers: computed.affectedPlayers,
    source: injuryData.source,
    warning: injuryData.warning,
  };
}

async function getMatchupImpact(homeKey, awayKey) {
  const [home, away] = await Promise.all([getTeamImpact(homeKey), getTeamImpact(awayKey)]);
  return {
    home,
    away,
    netAdjustment: +(away.impactPoints - home.impactPoints).toFixed(2),
  };
}

module.exports = {
  IMPACT_TIERS,
  getTeamImpact,
  getMatchupImpact,
  statusImpact,
  computeRosterImpact,
  computeMatchupImpactFromRosters,
};
