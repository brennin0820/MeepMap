'use strict';

const dataFetcher = require('./data-fetcher');
const { updateResult, getHistory, getAccuracySummary } = require('./prediction-history');

/**
 * Grade pending predictions against completed schedule results.
 * Never fabricates scores — only uses ESPN/fallback final scores.
 */
async function gradeCompletedGames(days = 14) {
  const scheduleResult = await dataFetcher.getScheduleRange(days);
  const completed = (scheduleResult.events || []).filter(
    (e) => e.statusState === 'post' && e.homeScore != null && e.awayScore != null
  );

  const graded = [];
  const skipped = [];

  for (const event of completed) {
    const gameId = event.id;
    const gameDate = event.date;
    const finalScore = { home: event.homeScore, away: event.awayScore };
    const updated = updateResult(gameId, gameDate, finalScore);
    if (updated) {
      graded.push({
        gameId,
        date: gameDate,
        home: event.homeTeam?.name || event.homeTeam?.key,
        away: event.awayTeam?.name || event.awayTeam?.key,
        finalScore,
        wasCorrect: updated.wasCorrect,
        marginError: updated.marginError,
      });
    } else {
      skipped.push({ gameId, date: gameDate, reason: 'no matching pending prediction' });
    }
  }

  return {
    gradedCount: graded.length,
    skippedCount: skipped.length,
    graded,
    skipped: skipped.slice(0, 20),
    accuracy: getAccuracySummary(),
    source: scheduleResult.source,
    lastUpdated: new Date().toISOString(),
  };
}

module.exports = {
  gradeCompletedGames,
  getHistory,
  getAccuracySummary,
};
