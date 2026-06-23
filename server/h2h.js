'use strict';

const dataFetcher = require('./data-fetcher');

function normalizeKey(key) {
  return (key || '').toLowerCase();
}

function isMatchup(event, teamA, teamB) {
  const a = normalizeKey(teamA);
  const b = normalizeKey(teamB);
  const home = normalizeKey(event.homeTeam?.key);
  const away = normalizeKey(event.awayTeam?.key);
  return (home === a && away === b) || (home === b && away === a);
}

async function getHeadToHead(teamA, teamB, days = 60) {
  const keyA = normalizeKey(teamA);
  const keyB = normalizeKey(teamB);
  if (!keyA || !keyB || keyA === keyB) {
    return { error: 'Two distinct team keys required' };
  }

  const [teamsResult, scheduleResult] = await Promise.all([
    dataFetcher.getTeams(),
    dataFetcher.getScheduleRange(days),
  ]);

  const teamAInfo = teamsResult.teams.find((t) => t.key === keyA);
  const teamBInfo = teamsResult.teams.find((t) => t.key === keyB);
  if (!teamAInfo || !teamBInfo) {
    return { error: 'Unknown team key(s)' };
  }

  const matchups = scheduleResult.events
    .filter((e) => isMatchup(e, keyA, keyB))
    .map((e) => ({
      id: e.id,
      date: e.date,
      status: e.status,
      statusState: e.statusState,
      homeTeam: e.homeTeam,
      awayTeam: e.awayTeam,
      homeScore: e.homeScore ?? null,
      awayScore: e.awayScore ?? null,
      venue: e.venue || null,
    }));

  const completed = matchups.filter((m) => m.statusState === 'post' && m.homeScore != null);
  let teamAWins = 0;
  let teamBWins = 0;
  for (const m of completed) {
    const aIsHome = normalizeKey(m.homeTeam?.key) === keyA;
    const aScore = aIsHome ? m.homeScore : m.awayScore;
    const bScore = aIsHome ? m.awayScore : m.homeScore;
    if (aScore > bScore) teamAWins++;
    else if (bScore > aScore) teamBWins++;
  }

  return {
    teamA: { key: keyA, name: teamAInfo.name },
    teamB: { key: keyB, name: teamBInfo.name },
    matchups,
    scheduledCount: matchups.filter((m) => m.statusState !== 'post').length,
    completedCount: completed.length,
    record: completed.length ? `${teamAWins}-${teamBWins}` : null,
    source: scheduleResult.source,
    isLive: scheduleResult.isLive,
    warning: matchups.length ? scheduleResult.warning : 'No scheduled 2026 matchups found between these teams in the loaded window.',
  };
}

module.exports = { getHeadToHead };
