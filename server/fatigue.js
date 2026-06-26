'use strict';

const {
  HOME_COURT_ADV,
  B2B_PENALTY,
  THREE_IN_FOUR_PENALTY,
} = require('./model-config');

function parseDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function daysBetween(a, b) {
  const da = parseDate(a);
  const db = parseDate(b);
  if (!da || !db) return null;
  const ms = Math.abs(da.getTime() - db.getTime());
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

/**
 * @param {string} teamKey
 * @param {string} gameDate
 * @param {Array} priorGames
 * @returns {Object}
 */
function assessTeamFatigue(teamKey, gameDate, priorGames) {
  const key = teamKey?.toLowerCase();
  const teamGames = (priorGames || [])
    .filter(
      (g) => g.homeTeam?.key === key || g.awayTeam?.key === key || g.homeKey === key || g.awayKey === key
    )
    .map((g) => g.date)
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a));

  let penalty = 0;
  const notes = [];

  if (teamGames.length > 0 && gameDate) {
    const lastPlayed = teamGames[0];
    const restDays = daysBetween(gameDate, lastPlayed);
    if (restDays != null && restDays <= 1) {
      penalty += B2B_PENALTY;
      notes.push('Back-to-back');
    } else if (restDays === 2 && teamGames.length >= 2) {
      const secondLast = teamGames[1];
      if (daysBetween(lastPlayed, secondLast) != null && daysBetween(lastPlayed, secondLast) <= 2) {
        penalty += THREE_IN_FOUR_PENALTY;
        notes.push('3-in-4 stretch');
      }
    }
  }

  return {
    teamKey: key,
    fatiguePenalty: penalty,
    homeCourtBonus: 0,
    notes,
    restDays: teamGames.length && gameDate ? daysBetween(gameDate, teamGames[0]) : null,
  };
}

function assessMatchupFatigue(homeKey, awayKey, gameDate, priorGames) {
  const home = assessTeamFatigue(homeKey, gameDate, priorGames);
  const away = assessTeamFatigue(awayKey, gameDate, priorGames);
  home.homeCourtBonus = HOME_COURT_ADV;
  return { home, away };
}

/**
 * Index.js helper — derive fatigue for one team from schedule events.
 * @param {Object} team
 * @param {Array} schedule
 * @param {string} [teamName]
 * @param {string} [gameDate]
 * @returns {Object}
 */
function computeFatigue(team, schedule, teamName, gameDate) {
  const teamKey = team?.key || teamName?.toLowerCase();
  const priorGames = (schedule || []).filter(
    (e) => e.statusState === 'post' || e.status === 'final' || e.statusState === 'final'
  );
  const refDate =
    gameDate ||
    (schedule || []).find(
      (e) =>
        e.homeTeam?.key === teamKey ||
        e.awayTeam?.key === teamKey ||
        e.homeKey === teamKey ||
        e.awayKey === teamKey
    )?.date ||
    new Date().toISOString().slice(0, 10);

  return assessTeamFatigue(teamKey, refDate, priorGames);
}

module.exports = {
  HOME_COURT_ADV,
  B2B_PENALTY,
  THREE_IN_FOUR_PENALTY,
  assessMatchupFatigue,
  assessTeamFatigue,
  computeFatigue,
  daysBetween,
};
