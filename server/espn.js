'use strict';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba';

const ABBR_TO_KEY = {
  ATL: 'atl',
  CHI: 'chi',
  CON: 'con',
  DAL: 'dal',
  IND: 'ind',
  LV: 'las',
  LVA: 'las',
  LAS: 'las',
  MIN: 'min',
  NY: 'ny',
  NYL: 'ny',
  PHX: 'phx',
  PHO: 'phx',
  SEA: 'sea',
  WAS: 'was',
  WSH: 'was',
  GS: 'gs',
  GSV: 'gs',
  TOR: 'tor',
};

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'WNBA-Bet-Predictor/1.5' },
  });
  if (!res.ok) throw new Error(`ESPN ${res.status}: ${url}`);
  return res.json();
}

function teamKeyFromAbbrev(abbr) {
  if (!abbr) return null;
  return ABBR_TO_KEY[abbr.toUpperCase()] || abbr.toLowerCase();
}

function normalizeTeam(team) {
  const abbr = team.abbreviation || team.shortDisplayName || '';
  const key = teamKeyFromAbbrev(abbr);
  const record = team.record?.items?.[0]?.summary || team.record?.summary || '0-0';
  const [wins, losses] = record.split('-').map((n) => parseInt(n, 10) || 0);
  const stats = team.record?.items?.[0]?.stats || [];

  const statVal = (name) => {
    const item = stats.find((s) => s.name === name || s.abbreviation === name);
    return item ? parseFloat(item.value) : null;
  };

  return {
    key,
    espnId: team.id,
    name: team.displayName || team.name,
    abbreviation: abbr,
    record,
    wins,
    losses,
    homeRecord: statVal('Home') != null ? `${statVal('Home')}` : null,
    awayRecord: statVal('Road') != null ? `${statVal('Road')}` : null,
    ppg: statVal('avgPointsFor') ?? statVal('pointsFor'),
    oppPpg: statVal('avgPointsAgainst') ?? statVal('pointsAgainst'),
    avgMargin: statVal('differential'),
    offRating: statVal('offensiveRating'),
    defRating: statVal('defensiveRating'),
    netRating: statVal('netRating'),
    pace: statVal('pace'),
  };
}

async function getTeams() {
  const data = await fetchJson(`${BASE}/teams?limit=50`);
  const teams = (data.sports?.[0]?.leagues?.[0]?.teams || [])
    .map((entry) => normalizeTeam(entry.team))
    .filter((t) => t.key);

  return {
    teams,
    source: 'espn',
    lastUpdated: new Date().toISOString(),
    isLive: true,
    warning: null,
  };
}

async function getScoreboard(dateStr) {
  const compact = dateStr.replace(/-/g, '');
  const data = await fetchJson(`${BASE}/scoreboard?dates=${compact}`);
  const events = (data.events || []).map((event) => {
    const comp = event.competitions?.[0];
    const home = comp?.competitors?.find((c) => c.homeAway === 'home');
    const away = comp?.competitors?.find((c) => c.homeAway === 'away');
    return {
      id: event.id,
      date: event.date,
      name: event.name,
      status: event.status?.type?.description || 'Scheduled',
      statusState: event.status?.type?.state || 'pre',
      homeTeam: home ? normalizeTeam(home.team) : null,
      awayTeam: away ? normalizeTeam(away.team) : null,
      homeScore: home ? parseInt(home.score, 10) || 0 : 0,
      awayScore: away ? parseInt(away.score, 10) || 0 : 0,
      venue: comp?.venue?.fullName || null,
    };
  });

  return {
    events,
    source: 'espn',
    lastUpdated: new Date().toISOString(),
    isLive: true,
    warning: null,
  };
}

async function getTeamRoster(espnId) {
  const data = await fetchJson(`${BASE}/teams/${espnId}/roster`);
  const athletes = (data.athletes || []).map((a) => ({
    id: a.id,
    name: a.displayName || a.fullName,
    position: a.position?.abbreviation || a.position?.name || '',
    jersey: a.jersey,
    status: a.status?.type || 'active',
    injured: a.injuries?.length > 0,
    injuryStatus: a.injuries?.[0]?.status || null,
  }));

  return {
    roster: athletes,
    source: 'espn',
    lastUpdated: new Date().toISOString(),
    isLive: true,
    warning: null,
  };
}

async function getInjuries() {
  try {
    const data = await fetchJson(`${BASE}/injuries`);
    const teamList = await getTeams();
    const idToKey = Object.fromEntries(
      teamList.teams.map((t) => [String(t.espnId), t.key])
    );
    const injuries = [];
    for (const teamBlock of data.injuries || []) {
      const teamKey =
        idToKey[String(teamBlock.id)] ||
        teamKeyFromAbbrev(teamBlock.abbreviation) ||
        null;
      for (const item of teamBlock.injuries || []) {
        injuries.push({
          teamKey,
          teamName: teamBlock.displayName,
          player: item.athlete?.displayName,
          playerId: item.athlete?.id,
          status: item.status || item.type?.description,
          detail: item.longComment || item.shortComment || item.details?.detail || '',
          date: item.date,
        });
      }
    }
    return {
      injuries,
      source: 'espn',
      lastUpdated: new Date().toISOString(),
      isLive: true,
      warning: injuries.length === 0 ? 'ESPN returned no injury records' : null,
    };
  } catch (err) {
    throw new Error(`ESPN injuries unavailable: ${err.message}`);
  }
}

async function resolveTeamId(teamKey) {
  const { teams } = await getTeams();
  const match = teams.find((t) => t.key === teamKey.toLowerCase());
  return match?.espnId || null;
}

module.exports = {
  getTeams,
  getScoreboard,
  getTeamRoster,
  getInjuries,
  resolveTeamId,
  teamKeyFromAbbrev,
  ABBR_TO_KEY,
};
