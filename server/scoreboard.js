'use strict';

const cache = require('./cache');
const dataFetcher = require('./data-fetcher');
const espn = require('./espn');

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba';

function todayDateStr() {
  return new Date().toISOString().slice(0, 10);
}

function attachMeta(payload, cached, overrides = {}) {
  return {
    ...payload,
    source: overrides.source ?? payload.source,
    lastUpdated: overrides.lastUpdated ?? payload.lastUpdated ?? new Date().toISOString(),
    cacheAgeSeconds: cached?.cacheAgeSeconds ?? 0,
    isLive: overrides.isLive ?? payload.isLive ?? false,
    warning: overrides.warning ?? payload.warning ?? null,
  };
}

function normalizeCompetitor(comp) {
  if (!comp) return null;
  const team = comp.team ? espn.teamKeyFromAbbrev(comp.team.abbreviation) : null;
  return {
    key: team,
    name: comp.team?.displayName || comp.team?.name || null,
    abbreviation: comp.team?.abbreviation || null,
    score: parseInt(comp.score, 10) || 0,
    record: comp.records?.[0]?.summary || comp.record || null,
    winner: comp.winner === true,
  };
}

function numberFromLine(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const filtered = value.replace(/[^0-9+-.]/g, '');
    const parsed = parseFloat(filtered);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function americanFromOdds(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeOdds(competition) {
  const raw = competition?.odds?.[0];
  if (!raw) return null;

  const pointSpread = raw.pointSpread || {};
  const total = raw.total || {};
  const moneyline = raw.moneyline || {};
  const homeFavorite = raw.homeTeamOdds?.favorite === true;
  const awayFavorite = raw.awayTeamOdds?.favorite === true;
  const baseSpread = numberFromLine(raw.spread);
  const homeSpread =
    numberFromLine(pointSpread.home?.close?.line) ??
    (baseSpread != null ? (homeFavorite ? -Math.abs(baseSpread) : awayFavorite ? Math.abs(baseSpread) : baseSpread) : null);

  const odds = {
    provider: raw.provider?.displayName || raw.provider?.name || null,
    spread: homeSpread,
    total: numberFromLine(total.over?.close?.line) ?? numberFromLine(raw.overUnder),
    homeMoneyline: americanFromOdds(moneyline.home?.close?.odds),
    awayMoneyline: americanFromOdds(moneyline.away?.close?.odds),
    openingSpread: numberFromLine(pointSpread.home?.open?.line),
    openingTotal: numberFromLine(total.over?.open?.line),
    openingHomeMoneyline: americanFromOdds(moneyline.home?.open?.odds),
    openingAwayMoneyline: americanFromOdds(moneyline.away?.open?.odds),
    source: 'espn',
    deepLink: raw.link?.href || null,
  };

  const hasLine = odds.spread != null || odds.total != null || odds.homeMoneyline != null || odds.awayMoneyline != null;
  return hasLine ? odds : null;
}

function normalizeGame(event) {
  const comp = event.competitions?.[0];
  const statusObj = comp?.status || event.status || {};
  const state = statusObj.type?.state || 'pre';
  const period = statusObj.period ?? null;

  const home = comp?.competitors?.find((c) => c.homeAway === 'home');
  const away = comp?.competitors?.find((c) => c.homeAway === 'away');

  return {
    id: event.id,
    date: event.date,
    name: event.name,
    status: statusObj.type?.description || 'Scheduled',
    statusState: state,
    statusDetail: statusObj.type?.detail || statusObj.type?.shortDetail || null,
    shortStatus: statusObj.type?.shortDetail || null,
    period,
    quarter: period,
    clock: statusObj.displayClock || null,
    clockSeconds: statusObj.clock ?? null,
    isLive: state === 'in',
    completed: statusObj.type?.completed === true || state === 'post',
    homeTeam: normalizeCompetitor(home),
    awayTeam: normalizeCompetitor(away),
    homeScore: home ? parseInt(home.score, 10) || 0 : 0,
    awayScore: away ? parseInt(away.score, 10) || 0 : 0,
    venue: comp?.venue?.fullName || null,
    broadcast: comp?.broadcasts?.[0]?.names?.join(', ') || null,
    odds: normalizeOdds(comp),
  };
}

async function fetchEspnScoreboard(dateStr) {
  const compact = dateStr.replace(/-/g, '');
  const res = await fetch(`${ESPN_BASE}/scoreboard?dates=${compact}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'WNBA-Bet-Predictor/1.5' },
  });
  if (!res.ok) throw new Error(`ESPN scoreboard ${res.status}`);
  const data = await res.json();
  const games = (data.events || []).map(normalizeGame);
  return {
    date: dateStr,
    games,
    count: games.length,
    liveCount: games.filter((g) => g.isLive).length,
    source: 'espn',
    lastUpdated: new Date().toISOString(),
    isLive: true,
    warning: games.length === 0 ? `No games on ESPN scoreboard for ${dateStr}` : null,
  };
}

function scoreboardFromFallback(dateStr) {
  const fallback = dataFetcher.readFallback('schedule-fallback.json');
  const target = dateStr;
  const games = (fallback.events || [])
    .filter((e) => new Date(e.date).toISOString().slice(0, 10) === target)
    .map((e) => ({
      id: e.id,
      date: e.date,
      name: e.name,
      status: e.status || 'Scheduled',
      statusState: e.statusState || 'pre',
      statusDetail: null,
      shortStatus: e.status || null,
      period: null,
      quarter: null,
      clock: null,
      clockSeconds: null,
      isLive: e.statusState === 'in',
      completed: e.statusState === 'post',
      homeTeam: e.homeTeam
        ? { key: e.homeTeam.key, name: e.homeTeam.name, abbreviation: null, score: e.homeScore || 0 }
        : null,
      awayTeam: e.awayTeam
        ? { key: e.awayTeam.key, name: e.awayTeam.name, abbreviation: null, score: e.awayScore || 0 }
        : null,
      homeScore: e.homeScore || 0,
      awayScore: e.awayScore || 0,
      venue: e.venue || null,
      broadcast: null,
      odds: e.odds || null,
    }));

  return {
    date: dateStr,
    games,
    count: games.length,
    liveCount: games.filter((g) => g.isLive).length,
    source: fallback.source || 'local-fallback',
    lastUpdated: fallback.lastUpdated || new Date().toISOString(),
    isLive: false,
    warning: 'Local schedule fallback — live clock/scores unavailable',
  };
}

async function getScoreboardForDate(dateStr) {
  const cacheKey = dateStr;
  const cached = cache.get('scoreboard', cacheKey);
  if (cached) return attachMeta(cached.value, cached);

  if (!cache.canRefresh('scoreboard', cacheKey)) {
    const stale = cache.get('scoreboard', `${cacheKey}:stale`);
    if (stale) {
      return attachMeta(stale.value, stale, {
        warning: 'Refresh throttled — serving stale scoreboard',
        isLive: false,
      });
    }
  }

  cache.markRefresh('scoreboard', cacheKey);
  try {
    const result = await fetchEspnScoreboard(dateStr);
    cache.set('scoreboard', cacheKey, result);
    cache.set('scoreboard', `${cacheKey}:stale`, result);
    return attachMeta(result, { cacheAgeSeconds: 0 });
  } catch (err) {
    const fallback = scoreboardFromFallback(dateStr);
    fallback.warning = `ESPN scoreboard failed (${err.message}). ${fallback.warning}`;
    cache.set('scoreboard', cacheKey, fallback);
    return attachMeta(fallback, { cacheAgeSeconds: 0 }, { isLive: false });
  }
}

async function getScoreboard(dateStr = todayDateStr()) {
  const result = await getScoreboardForDate(dateStr);
  return {
    ...result,
    meta: {
      source: result.source,
      lastUpdated: result.lastUpdated,
      cacheAgeSeconds: result.cacheAgeSeconds,
      isLive: result.isLive,
      warning: result.warning,
    },
  };
}

async function getLiveScoreboard(dateStr = todayDateStr()) {
  const board = await getScoreboard(dateStr);
  const games = (board.games || []).filter((g) => g.isLive || g.statusState === 'in');
  return {
    date: board.date,
    games,
    count: games.length,
    source: board.source,
    lastUpdated: board.lastUpdated,
    cacheAgeSeconds: board.cacheAgeSeconds,
    isLive: board.isLive,
    warning: games.length === 0 ? 'No in-progress games right now' : board.warning,
    meta: {
      source: board.source,
      lastUpdated: board.lastUpdated,
      cacheAgeSeconds: board.cacheAgeSeconds,
      isLive: board.isLive,
      warning: games.length === 0 ? 'No in-progress games right now' : board.warning,
    },
  };
}

module.exports = {
  getScoreboard,
  getLiveScoreboard,
  normalizeGame,
  todayDateStr,
};
