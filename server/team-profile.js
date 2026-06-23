'use strict';

function parseLast5WinRate(last5) {
  if (!last5 || typeof last5 !== 'string') return null;
  const m = last5.match(/^(\d+)-(\d+)$/);
  if (!m) return null;
  const wins = Number(m[1]);
  const losses = Number(m[2]);
  const total = wins + losses;
  if (total === 0) return null;
  return wins / total;
}

function momentumLabel(last5) {
  const rate = parseLast5WinRate(last5);
  if (rate == null) return 'Unknown';
  if (rate >= 0.7) return 'Hot';
  if (rate <= 0.3) return 'Cold';
  return 'Warm';
}

function healthGrade(team) {
  if (typeof team.netRating !== 'number') return 'Unknown';
  if (team.netRating >= 8) return 'A';
  if (team.netRating >= 3) return 'B';
  if (team.netRating >= -2) return 'C';
  if (team.netRating >= -8) return 'D';
  return 'F';
}

function enrichTeam(team) {
  return {
    ...team,
    profile: {
      homeRecord: team.homeRecord || null,
      awayRecord: team.awayRecord || null,
      last5: team.last5 || null,
      last10: team.last10 || null,
      momentum: momentumLabel(team.last5),
      healthGrade: healthGrade(team),
    },
  };
}

function enrichTeams(teams) {
  return (teams || []).map(enrichTeam);
}

module.exports = { enrichTeam, enrichTeams, momentumLabel, healthGrade };
