'use strict';

const cache = require('./cache');
const dataFetcher = require('./data-fetcher');
const espn = require('./espn');
const bbref = require('./bbref');
const { enrichTeam } = require('./team-profile');

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba';

function attachMeta(payload, cached, overrides = {}) {
  return {
    ...payload,
    source: overrides.source ?? payload.source,
    sources: overrides.sources ?? payload.sources,
    lastUpdated: overrides.lastUpdated ?? payload.lastUpdated ?? new Date().toISOString(),
    cacheAgeSeconds: cached?.cacheAgeSeconds ?? 0,
    isLive: overrides.isLive ?? payload.isLive ?? false,
    warning: overrides.warning ?? payload.warning ?? null,
  };
}

function statMapFromCategories(categories) {
  const map = {};
  for (const cat of categories || []) {
    for (const s of cat.stats || []) {
      map[s.name] = s.value;
    }
  }
  return map;
}

async function fetchEspnTeamStatistics(espnId) {
  const res = await fetch(`${ESPN_BASE}/teams/${espnId}/statistics`, {
    headers: { Accept: 'application/json', 'User-Agent': 'WNBA-Bet-Predictor/1.5' },
  });
  if (!res.ok) throw new Error(`ESPN team statistics ${res.status}`);
  const data = await res.json();
  return statMapFromCategories(data.results?.stats?.categories);
}

async function fetchEspnTeamDetail(espnId) {
  const res = await fetch(`${ESPN_BASE}/teams/${espnId}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'WNBA-Bet-Predictor/1.5' },
  });
  if (!res.ok) throw new Error(`ESPN team detail ${res.status}`);
  const data = await res.json();
  return data.team || data;
}

function teamFromFallback(teamKey) {
  const fb = dataFetcher.readFallback('teams-fallback.json');
  return (fb.teams || []).find((t) => t.key === teamKey.toLowerCase()) || null;
}

function mergeTeamStats(teamKey, base, espnDetail, espnStats, bbrefStats) {
  const sources = [];
  const warnings = [];

  const recordItem = espnDetail?.record?.items?.find((i) => i.type === 'total')
    || espnDetail?.record?.items?.[0];
  const recordStats = recordItem?.stats || [];
  const recVal = (name) => {
    const item = recordStats.find((s) => s.name === name);
    return item != null ? parseFloat(item.value) : null;
  };

  if (base) sources.push(base.source || 'teams-cache');
  if (espnDetail) sources.push('espn');
  if (espnStats && Object.keys(espnStats).length) sources.push('espn-statistics');
  if (bbrefStats) sources.push('bbref');

  const ppg = recVal('avgPointsFor') ?? base?.ppg ?? bbrefStats?.ppg ?? null;
  const oppPpg = recVal('avgPointsAgainst') ?? base?.oppPpg ?? bbrefStats?.oppPpg ?? null;
  const gamesPlayed = recVal('gamesPlayed') ?? espnStats?.gamesPlayed ?? null;

  const stats = {
    record: recordItem?.summary || base?.record || bbrefStats?.record || null,
    wins: recVal('wins') ?? base?.wins ?? bbrefStats?.wins ?? null,
    losses: recVal('losses') ?? base?.losses ?? bbrefStats?.losses ?? null,
    homeRecord: base?.homeRecord ?? null,
    awayRecord: base?.awayRecord ?? null,
    last5: base?.last5 ?? null,
    last10: base?.last10 ?? null,
    gamesPlayed,
    ppg,
    oppPpg,
    avgMargin: recVal('differential') ?? base?.avgMargin ?? bbrefStats?.avgMargin ?? (
      ppg != null && oppPpg != null ? +(ppg - oppPpg).toFixed(1) : null
    ),
    offRating: recVal('offensiveRating') ?? base?.offRating ?? bbrefStats?.offRating ?? null,
    defRating: recVal('defensiveRating') ?? base?.defRating ?? bbrefStats?.defRating ?? null,
    netRating: recVal('netRating') ?? base?.netRating ?? bbrefStats?.netRating ?? null,
    pace: recVal('pace') ?? base?.pace ?? bbrefStats?.pace ?? null,
    fgPct: espnStats?.fieldGoalPct ?? null,
    threePtPct: espnStats?.threePointPct ?? null,
    ftPct: espnStats?.freeThrowPct ?? null,
    reboundsPerGame: espnStats?.avgRebounds ?? null,
    offensiveReboundsPerGame: espnStats?.avgOffensiveRebounds ?? null,
    defensiveReboundsPerGame: espnStats?.avgDefensiveRebounds ?? null,
    assistsPerGame: espnStats?.avgAssists ?? null,
    turnoversPerGame: espnStats?.avgTurnovers ?? null,
    stealsPerGame: espnStats?.avgSteals ?? null,
    blocksPerGame: espnStats?.avgBlocks ?? null,
    foulsPerGame: espnStats?.avgFouls ?? null,
    assistTurnoverRatio: espnStats?.assistTurnoverRatio ?? null,
    pointsPerGame: espnStats?.avgPoints ?? ppg,
  };

  const missingCore = ['ppg', 'oppPpg', 'fgPct', 'reboundsPerGame'].filter((k) => stats[k] == null);
  if (missingCore.length && !bbrefStats) {
    warnings.push(`ESPN missing: ${missingCore.join(', ')}`);
  }
  if (bbrefStats) {
    warnings.push('BBRef used to supplement missing ESPN fields');
  }
  if (!espnDetail && !base) {
    warnings.push('Team identity from local fallback only');
  }

  const uniqueSources = [...new Set(sources.filter(Boolean))];
  const primarySource = uniqueSources.includes('espn') ? 'espn' : uniqueSources[0] || 'unknown';

  return {
    teamKey: teamKey.toLowerCase(),
    name: espnDetail?.displayName || base?.name || teamFromFallback(teamKey)?.name || teamKey,
    abbreviation: espnDetail?.abbreviation || base?.abbreviation || null,
    espnId: espnDetail?.id || base?.espnId || null,
    stats,
    source: primarySource,
    sources: uniqueSources,
    lastUpdated: new Date().toISOString(),
    isLive: uniqueSources.includes('espn'),
    warning: warnings.length ? warnings.join('; ') : null,
  };
}

async function getTeamStats(teamKey) {
  const key = teamKey.toLowerCase();
  const cached = cache.get('team-stats', key);
  if (cached) return attachMeta(cached.value, cached);

  if (!cache.canRefresh('team-stats', key)) {
    const stale = cache.get('team-stats', `${key}:stale`);
    if (stale) {
      return attachMeta(stale.value, stale, {
        warning: 'Refresh throttled — serving stale team stats',
        isLive: false,
      });
    }
  }

  cache.markRefresh('team-stats', key);

  const teamsResult = await dataFetcher.getTeams();
  const baseTeam = (teamsResult.teams || []).find((t) => t.key === key);
  if (!baseTeam) {
    const fb = teamFromFallback(key);
    if (!fb) {
      return {
        teamKey: key,
        error: 'Team not found',
        source: 'none',
        sources: [],
        lastUpdated: new Date().toISOString(),
        isLive: false,
        warning: `Unknown team key: ${key}`,
      };
    }
  }

  let espnId = baseTeam?.espnId;
  if (!espnId) {
    espnId = await espn.resolveTeamId(key);
  }

  let espnDetail = null;
  let espnStats = null;
  let bbrefStats = null;
  const errors = [];

  if (espnId) {
    try {
      espnDetail = await fetchEspnTeamDetail(espnId);
    } catch (err) {
      errors.push(`ESPN detail: ${err.message}`);
    }
    try {
      espnStats = await fetchEspnTeamStatistics(espnId);
    } catch (err) {
      errors.push(`ESPN statistics: ${err.message}`);
    }
  } else {
    errors.push('No ESPN team id');
  }

  const needsBbref = !espnStats?.fieldGoalPct || baseTeam?.ppg == null;
  if (needsBbref) {
    try {
      bbrefStats = await bbref.getTeamStats(key);
    } catch (err) {
      errors.push(`BBRef: ${err.message}`);
    }
  }

  const merged = mergeTeamStats(key, baseTeam, espnDetail, espnStats, bbrefStats);
  if (errors.length) {
    merged.warning = [merged.warning, errors.join('; ')].filter(Boolean).join('; ');
  }
  if (!merged.isLive) merged.isLive = false;

  const enriched = enrichTeam({
    key: merged.teamKey,
    name: merged.name,
    abbreviation: merged.abbreviation,
    espnId: merged.espnId,
    ...merged.stats,
  });

  const payload = {
    ...merged,
    profile: enriched.profile,
    meta: {
      source: merged.source,
      sources: merged.sources,
      lastUpdated: merged.lastUpdated,
      isLive: merged.isLive,
      warning: merged.warning,
    },
  };

  cache.set('team-stats', key, payload);
  cache.set('team-stats', `${key}:stale`, payload);
  return attachMeta(payload, { cacheAgeSeconds: 0 });
}

module.exports = {
  getTeamStats,
  mergeTeamStats,
  statMapFromCategories,
};
