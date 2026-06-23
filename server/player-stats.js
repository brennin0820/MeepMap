'use strict';

const cache = require('./cache');
const dataFetcher = require('./data-fetcher');
const espn = require('./espn');

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba';
const ESPN_STATS_V3 = 'https://site.api.espn.com/apis/common/v3/sports/basketball/wnba/athletes';

const AVG_LABELS = [
  'gamesPlayed', 'gamesStarted', 'mpg', 'ppg', 'oreb', 'dreb', 'rpg',
  'apg', 'spg', 'bpg', 'topg', 'fg', 'fgPct', 'fg3', 'fg3Pct', 'ft', 'ftPct', 'pf',
];
const AVG_KEYS = [
  'GP', 'GS', 'MIN', 'PTS', 'OR', 'DR', 'REB', 'AST', 'STL', 'BLK', 'TO', 'FG', 'FG%', '3PT', '3P%', 'FT', 'FT%', 'PF',
];

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

function parseFgLine(line) {
  if (!line || typeof line !== 'string') return { made: null, attempted: null };
  const [made, attempted] = line.split('-').map((n) => parseFloat(n));
  return {
    made: Number.isFinite(made) ? made : null,
    attempted: Number.isFinite(attempted) ? attempted : null,
  };
}

function parseV3Averages(statsArr) {
  if (!Array.isArray(statsArr)) return null;
  const out = {};
  AVG_KEYS.forEach((label, i) => {
    const key = AVG_LABELS[i];
    const raw = statsArr[i];
    if (raw == null || raw === '') {
      out[key] = null;
      return;
    }
    if (key === 'fg' || key === 'fg3' || key === 'ft') {
      const line = parseFgLine(raw);
      out[`${key}Made`] = line.made;
      out[`${key}Attempted`] = line.attempted;
      out[key] = raw;
      return;
    }
    const num = parseFloat(raw);
    out[key] = Number.isFinite(num) ? num : raw;
  });
  return out;
}

function parseLeaderStatBlocks(statistics) {
  const map = {};
  for (const cat of statistics || []) {
    for (const s of cat.stats || []) {
      map[s.name] = s.value;
    }
  }
  return {
    gamesPlayed: map.gamesPlayed ?? null,
    mpg: map.avgMinutes ?? null,
    ppg: map.avgPoints ?? null,
    rpg: map.avgRebounds ?? null,
    apg: map.avgAssists ?? null,
    spg: map.avgSteals ?? null,
    bpg: map.avgBlocks ?? null,
    topg: map.avgTurnovers ?? null,
    oreb: map.avgOffensiveRebounds ?? null,
    dreb: map.avgDefensiveRebounds ?? null,
    fgPct: map.fieldGoalPct ?? null,
    fg3Pct: map.threePointPct ?? null,
    ftPct: map.freeThrowPct ?? null,
    pf: map.avgFouls ?? null,
    statsAvailable: Object.keys(map).length > 0,
    statsSource: 'espn-leaders',
  };
}

async function fetchTeamLeaderStats(espnId) {
  const res = await fetch(`${ESPN_BASE}/teams/${espnId}/athletes/statistics`, {
    headers: { Accept: 'application/json', 'User-Agent': 'WNBA-Bet-Predictor/1.5' },
  });
  if (!res.ok) throw new Error(`ESPN team athlete stats ${res.status}`);
  const data = await res.json();
  const leaders = data.results?.['0']?.leaders || [];
  const byId = {};
  for (const leader of leaders) {
    const id = String(leader.athlete?.id || '');
    if (!id) continue;
    byId[id] = parseLeaderStatBlocks(leader.statistics);
  }
  return byId;
}

async function fetchAthleteSeasonStats(athleteId) {
  const res = await fetch(`${ESPN_STATS_V3}/${athleteId}/stats`, {
    headers: { Accept: 'application/json', 'User-Agent': 'WNBA-Bet-Predictor/1.5' },
  });
  if (!res.ok) throw new Error(`ESPN athlete stats ${res.status}`);
  const data = await res.json();
  const avg = (data.categories || []).find((c) => c.name === 'averages');
  const row = avg?.statistics?.[0];
  if (!row?.stats) return null;
  const parsed = parseV3Averages(row.stats);
  return parsed
    ? { ...parsed, statsAvailable: true, statsSource: 'espn-athlete' }
    : null;
}


async function getTeamPlayers(teamKey) {
  const key = teamKey.toLowerCase();
  const cached = cache.get('player-stats', key);
  if (cached) return attachMeta(cached.value, cached);

  if (!cache.canRefresh('player-stats', key)) {
    const stale = cache.get('player-stats', `${key}:stale`);
    if (stale) {
      return attachMeta(stale.value, stale, {
        warning: 'Refresh throttled — serving stale player stats',
        isLive: false,
      });
    }
  }

  cache.markRefresh('player-stats', key);

  const rosterResult = await dataFetcher.getRoster(key);
  if (!rosterResult.teamKey && !rosterResult.roster?.length) {
    return {
      teamKey: key,
      players: [],
      count: 0,
      statsCount: 0,
      source: 'none',
      sources: [],
      lastUpdated: new Date().toISOString(),
      isLive: false,
      warning: 'Team not found',
      meta: { source: 'none', warning: 'Team not found' },
    };
  }

  const espnId = await espn.resolveTeamId(key);
  let leaderMap = {};
  const sources = [rosterResult.source || 'espn'];
  const warnings = [];
  const errors = [];

  if (espnId) {
    try {
      leaderMap = await fetchTeamLeaderStats(espnId);
      if (Object.keys(leaderMap).length) sources.push('espn-leaders');
    } catch (err) {
      errors.push(`ESPN leaders: ${err.message}`);
    }
  }

  const roster = rosterResult.roster || [];
  const players = [];
  let statsCount = 0;

  for (const member of roster) {
    const player = {
      id: String(member.id || member.playerId || ''),
      name: member.name || member.player,
      position: member.position || '',
      jersey: member.jersey ?? null,
      status: member.status || 'active',
      injured: member.injured === true,
      injuryStatus: member.injuryStatus || null,
      headshot: member.headshot || null,
    };

    let season = leaderMap[player.id] || null;
    if (!season?.statsAvailable && player.id) {
      try {
        const individual = await fetchAthleteSeasonStats(player.id);
        if (individual) {
          season = individual;
          if (!sources.includes('espn-athlete')) sources.push('espn-athlete');
        }
      } catch (err) {
        errors.push(`${player.name}: ${err.message}`);
      }
    }

    const statsAvailable = season?.statsAvailable === true;
    if (statsAvailable) statsCount += 1;

    players.push({
      ...player,
      season: statsAvailable ? season : null,
      statsAvailable,
      statsSource: statsAvailable ? season.statsSource : null,
    });
  }

  if (statsCount === 0) {
    warnings.push('No season stats available from ESPN for this roster');
  } else if (statsCount < players.length) {
    warnings.push(`Season stats missing for ${players.length - statsCount} player(s)`);
  }
  if (errors.length) warnings.push(errors.slice(0, 3).join('; '));

  const primarySource = sources.includes('espn') ? 'espn' : sources[0] || rosterResult.source;
  const payload = {
    teamKey: key,
    players,
    count: players.length,
    statsCount,
    source: primarySource,
    sources: [...new Set(sources)],
    lastUpdated: new Date().toISOString(),
    isLive: rosterResult.isLive !== false,
    warning: warnings.length ? warnings.join('; ') : rosterResult.warning,
    meta: {
      source: primarySource,
      sources: [...new Set(sources)],
      lastUpdated: new Date().toISOString(),
      isLive: rosterResult.isLive !== false,
      warning: warnings.length ? warnings.join('; ') : rosterResult.warning,
      cacheAgeSeconds: rosterResult.cacheAgeSeconds || 0,
    },
  };

  cache.set('player-stats', key, payload);
  cache.set('player-stats', `${key}:stale`, payload);
  return attachMeta(payload, { cacheAgeSeconds: 0 });
}

module.exports = {
  getTeamPlayers,
  parseV3Averages,
  parseLeaderStatBlocks,
};
