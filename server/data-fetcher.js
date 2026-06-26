'use strict';

const fs = require('fs');
const path = require('path');
const cache = require('./cache');
const espn = require('./espn');
const bbref = require('./bbref');
const teamBranding = require('./team-branding');

const { BUNDLED_DATA_DIR } = require('./paths');

function readFallback(filename) {
  const filePath = path.join(BUNDLED_DATA_DIR, filename);
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
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

async function fetchWithFallback(namespace, cacheKey, fetchers, fallbackFile, mergeFn) {
  const cached = cache.get(namespace, cacheKey);
  if (cached) {
    return attachMeta(cached.value, cached);
  }

  if (!cache.canRefresh(namespace, cacheKey)) {
    const stale = cache.get(namespace, `${cacheKey}:stale`);
    if (stale) {
      return attachMeta(stale.value, stale, {
        warning: 'Refresh throttled — serving stale cache',
        isLive: false,
      });
    }
  }

  cache.markRefresh(namespace, cacheKey);
  const errors = [];

  for (const { name, fn } of fetchers) {
    try {
      const result = await fn();
      const merged = mergeFn ? mergeFn(result) : result;
      cache.set(namespace, cacheKey, merged);
      cache.set(namespace, `${cacheKey}:stale`, merged);
      return attachMeta(merged, { cacheAgeSeconds: 0 });
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
    }
  }

  const fallback = readFallback(fallbackFile);
  const warning = `All live sources failed (${errors.join('; ')}). Using local fallback.`;
  const payload = { ...fallback, warning, isLive: false };
  cache.set(namespace, cacheKey, payload);
  return attachMeta(payload, { cacheAgeSeconds: 0 }, { warning, isLive: false });
}

async function getTeams() {
  return fetchWithFallback(
    'teams',
    'all',
    [
      { name: 'ESPN', fn: () => espn.getTeams() },
      { name: 'BBRef', fn: () => bbref.getTeams() },
    ],
    'teams-fallback.json',
    (result) => {
      if (result.teams?.[0]?.source === 'bbref') {
        const fb = readFallback('teams-fallback.json');
        const nameMap = Object.fromEntries(fb.teams.map((t) => [t.key, t.name]));
        result.teams = result.teams.map((t) => ({
          ...t,
          name: nameMap[t.key] || t.name,
          key: t.key,
        }));
      }
      return result;
    }
  ).then((result) => {
    result = enrichTeamsFromFallback(result);
    result.teams = teamBranding.attachBrandingToTeams(result.teams);
    return result;
  });
}

function enrichTeamsFromFallback(result) {
  const fb = readFallback('teams-fallback.json');
  const fbMap = Object.fromEntries(fb.teams.map((t) => [t.key, t]));
  result.teams = (result.teams || []).map((team) => {
    const fallback = fbMap[team.key];
    if (!fallback) return team;
    const needsStats = team.ppg == null && team.offRating == null;
    if (!needsStats) return team;
    return {
      ...team,
      record: team.record === '0-0' ? fallback.record : team.record,
      wins: team.wins || fallback.wins,
      losses: team.losses || fallback.losses,
      homeRecord: team.homeRecord || fallback.homeRecord,
      awayRecord: team.awayRecord || fallback.awayRecord,
      last5: fallback.last5,
      last10: fallback.last10,
      ppg: fallback.ppg,
      oppPpg: fallback.oppPpg,
      avgMargin: fallback.avgMargin,
      offRating: fallback.offRating,
      defRating: fallback.defRating,
      netRating: fallback.netRating,
      pace: fallback.pace,
      warning: result.warning
        ? `${result.warning}; stats enriched from local fallback`
        : 'Team stats enriched from local fallback where ESPN lacked detail',
    };
  });
  return result;
}

async function getInjuries() {
  return fetchWithFallback(
    'injuries',
    'all',
    [{ name: 'ESPN', fn: () => espn.getInjuries() }],
    'injuries-fallback.json'
  );
}

function rosterFromFallback(fallback, key) {
  const roster = fallback.rosters?.[key] || [];
  return {
    teamKey: key,
    roster,
    source: fallback.source || 'local-fallback',
    lastUpdated: fallback.lastUpdated,
    isLive: false,
    warning: roster.length
      ? 'Local roster fallback'
      : `No roster fallback for ${key}`,
  };
}

async function getRoster(teamKey) {
  const key = teamKey.toLowerCase();
  const cached = cache.get('roster', key);
  if (cached) {
    return attachMeta(cached.value, cached);
  }

  if (!cache.canRefresh('roster', key)) {
    const stale = cache.get('roster', `${key}:stale`);
    if (stale) {
      return attachMeta(stale.value, stale, {
        warning: 'Refresh throttled — serving stale cache',
        isLive: false,
      });
    }
  }

  cache.markRefresh('roster', key);
  try {
    const espnId = await espn.resolveTeamId(key);
    if (!espnId) throw new Error(`No ESPN id for ${key}`);
    const result = await espn.getTeamRoster(espnId);
    const payload = { teamKey: key, ...result };
    cache.set('roster', key, payload);
    cache.set('roster', `${key}:stale`, payload);
    return attachMeta(payload, { cacheAgeSeconds: 0 });
  } catch (err) {
    const fallback = readFallback('roster-fallback.json');
    const payload = rosterFromFallback(fallback, key);
    payload.warning = `ESPN roster failed (${err.message}). ${payload.warning}`;
    cache.set('roster', key, payload);
    return attachMeta(payload, { cacheAgeSeconds: 0 }, { isLive: false });
  }
}

async function getScheduleForDate(dateStr) {
  return fetchWithFallback(
    'schedule',
    dateStr,
    [{ name: 'ESPN', fn: () => espn.getScoreboard(dateStr) }],
    'schedule-fallback.json',
    (result) => {
      if (result.events) {
        const target = new Date(dateStr).toISOString().slice(0, 10);
        result.events = result.events.filter(
          (e) => new Date(e.date).toISOString().slice(0, 10) === target
        );
      }
      return result;
    }
  );
}

function dateRange(days) {
  const dates = [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

async function getScheduleRange(days = 7) {
  const dates = dateRange(days);
  const allEvents = [];
  let source = 'espn';
  let warning = null;
  let isLive = true;

  for (const dateStr of dates) {
    const day = await getScheduleForDate(dateStr);
    if (day.events) allEvents.push(...day.events);
    if (day.source !== 'espn') source = day.source;
    if (day.warning) warning = day.warning;
    if (!day.isLive) isLive = false;
  }

  return {
    events: allEvents,
    days,
    source,
    lastUpdated: new Date().toISOString(),
    cacheAgeSeconds: 0,
    isLive,
    warning,
  };
}

let sourceHealthState = {
  teams: 'unknown',
  injuries: 'unknown',
  schedule: 'unknown',
};

function findTeamByName(teams, nameOrKey) {
  if (!nameOrKey || !Array.isArray(teams)) return null;
  const q = String(nameOrKey).toLowerCase().trim();
  return (
    teams.find((t) => t.key === q) ||
    teams.find((t) => t.name?.toLowerCase() === q) ||
    teams.find((t) => t.abbr?.toLowerCase() === q) ||
    teams.find((t) => t.name?.toLowerCase().includes(q) || q.includes(t.name?.toLowerCase())) ||
    null
  );
}

function getRosterFromInjuries(teamKey, injuries, teamName) {
  const key = teamKey?.toLowerCase();
  const roster = (injuries || [])
    .filter((i) => i.teamKey === key)
    .map((i) => ({
      player: i.player,
      name: i.player,
      status: i.status,
      note: i.note || i.detail,
      impact: i.impact,
      injured: !['available', 'probable'].includes(String(i.status || '').toLowerCase()),
    }));
  return {
    teamKey: key,
    teamName: teamName || key,
    roster,
    players: roster,
    confirmed: false,
    confidence: roster.length ? 'Medium' : 'Low',
  };
}

async function refreshLiveData(force = false) {
  if (force) {
    cache.clear('teams');
    cache.clear('injuries');
    cache.clear('schedule');
  }
  const [teamsResult, injuriesResult, scheduleResult] = await Promise.all([
    getTeams(),
    getInjuries(),
    getScheduleRange(7),
  ]);

  sourceHealthState = {
    teams: teamsResult.isLive ? 'ok' : 'fallback',
    injuries: injuriesResult.isLive ? 'ok' : 'fallback',
    schedule: scheduleResult.isLive ? 'ok' : 'fallback',
  };

  const warnings = [teamsResult.warning, injuriesResult.warning, scheduleResult.warning]
    .filter(Boolean)
    .join('; ');

  return {
    teams: teamsResult.teams || [],
    injuries: injuriesResult.injuries || [],
    schedule: scheduleResult.events || [],
    meta: {
      source: teamsResult.source,
      lastUpdated: new Date().toISOString(),
      warning: warnings || null,
      cacheAgeSeconds: Math.max(
        teamsResult.cacheAgeSeconds || 0,
        injuriesResult.cacheAgeSeconds || 0
      ),
    },
    throttled: false,
  };
}

function getSourceHealth() {
  const live = Object.values(sourceHealthState).every((s) => s === 'ok');
  return {
    live,
    sources: { ...sourceHealthState },
    lastUpdated: new Date().toISOString(),
  };
}

module.exports = {
  getTeams,
  getInjuries,
  getRoster,
  getRosterFromInjuries,
  getScheduleForDate,
  getScheduleRange,
  readFallback,
  refreshLiveData,
  getSourceHealth,
  findTeamByName,
  getRosterFromInjuries,
};
