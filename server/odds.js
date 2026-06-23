'use strict';

/**
 * Odds module — returns real lines only when available from upstream.
 * Never fabricates spreads, totals, or moneylines.
 */

const scoreboard = require('./scoreboard');

function searchDates(days = 10) {
  const dates = [];
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i < days; i += 1) {
    const current = new Date(start);
    current.setUTCDate(start.getUTCDate() + i);
    dates.push(current.toISOString().slice(0, 10));
  }
  return dates;
}

function normalizeOdds(game) {
  const odds = game?.odds || null;
  const hasLines =
    odds &&
    (typeof odds.spread === 'number' ||
      typeof odds.total === 'number' ||
      typeof odds.homeMoneyline === 'number' ||
      typeof odds.awayMoneyline === 'number');

  if (!hasLines) return null;

  return {
    spread: odds.spread ?? null,
    total: odds.total ?? null,
    moneyline: {
      home: odds.homeMoneyline ?? null,
      away: odds.awayMoneyline ?? null,
    },
    provider: odds.provider ?? null,
    openingSpread: odds.openingSpread ?? null,
    openingTotal: odds.openingTotal ?? null,
    openingMoneyline: {
      home: odds.openingHomeMoneyline ?? null,
      away: odds.openingAwayMoneyline ?? null,
    },
    deepLink: odds.deepLink ?? null,
  };
}

async function findGames(date) {
  const board = await scoreboard.getScoreboard(date ? String(date).slice(0, 10) : undefined);
  return board.games || [];
}

async function getOddsForEvent(eventId) {
  if (!eventId) {
    return {
      available: false,
      lines: null,
      source: null,
      lastUpdated: new Date().toISOString(),
      cacheAgeSeconds: 0,
      isLive: false,
      warning: 'No event id provided for odds lookup',
    };
  }

  let game = null;
  for (const date of searchDates()) {
    const games = await findGames(date);
    game = games.find((entry) => String(entry.id) === String(eventId));
    if (game) break;
  }
  const lines = normalizeOdds(game);

  if (lines) {
    return {
      available: true,
      lines,
      source: 'espn',
      lastUpdated: new Date().toISOString(),
      cacheAgeSeconds: 0,
      isLive: true,
      warning: null,
    };
  }

  return {
    available: false,
    lines: null,
    source: null,
    lastUpdated: new Date().toISOString(),
    cacheAgeSeconds: 0,
    isLive: false,
    warning: 'No odds provider configured — predictions exclude market lines',
  };
}

async function getOddsForMatchup(homeKey, awayKey, date) {
  const games = await findGames(date);
  const game = games.find(
    (entry) =>
      entry.homeTeam?.key === homeKey?.toLowerCase() &&
      entry.awayTeam?.key === awayKey?.toLowerCase()
  );
  const lines = normalizeOdds(game);

  if (lines) {
    return {
      available: true,
      lines,
      source: 'espn',
      lastUpdated: new Date().toISOString(),
      cacheAgeSeconds: 0,
      isLive: true,
      warning: null,
    };
  }

  return {
    available: false,
    lines: null,
    source: null,
    lastUpdated: new Date().toISOString(),
    cacheAgeSeconds: 0,
    isLive: false,
    warning: 'No live market line returned for this matchup',
  };
}

/**
 * Line movement history — only returned when a real odds provider is wired.
 */
async function getOddsMovement(homeKey, awayKey, date) {
  const matchup = await getOddsForMatchup(homeKey, awayKey, date);
  if (matchup.available) {
    const openSpread = matchup.lines?.openingSpread;
    const closeSpread = matchup.lines?.spread;
    const openTotal = matchup.lines?.openingTotal;
    const closeTotal = matchup.lines?.total;
    const movement = [];

    if (typeof openSpread === 'number' && typeof closeSpread === 'number' && openSpread !== closeSpread) {
      movement.push({
        market: 'spread',
        open: openSpread,
        current: closeSpread,
        delta: +(closeSpread - openSpread).toFixed(1),
      });
    }

    if (typeof openTotal === 'number' && typeof closeTotal === 'number' && openTotal !== closeTotal) {
      movement.push({
        market: 'total',
        open: openTotal,
        current: closeTotal,
        delta: +(closeTotal - openTotal).toFixed(1),
      });
    }

    return {
      available: movement.length > 0,
      movement,
      clv: null,
      source: 'espn',
      lastUpdated: new Date().toISOString(),
      warning: movement.length > 0 ? null : 'Live odds available, but no opening-to-current movement was present.',
    };
  }

  return {
    available: false,
    movement: [],
    clv: null,
    source: null,
    lastUpdated: new Date().toISOString(),
    warning: 'No odds provider configured — line movement and CLV unavailable',
  };
}

module.exports = {
  getOddsForEvent,
  getOddsForMatchup,
  getOddsMovement,
};
