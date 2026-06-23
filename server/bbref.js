'use strict';

const WNBA_TEAM_SLUGS = {
  atl: 'ATL',
  chi: 'CHI',
  con: 'CON',
  dal: 'DAL',
  ind: 'IND',
  las: 'LVA',
  min: 'MIN',
  ny: 'NYL',
  phx: 'PHO',
  sea: 'SEA',
  was: 'WAS',
  gs: 'GSV',
  tor: 'TOR',
};

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'WNBA-Bet-Predictor/1.5 (research)' },
  });
  if (!res.ok) throw new Error(`BBRef ${res.status}: ${url}`);
  return res.text();
}

function parseTableStats(html) {
  const winsMatch = html.match(/<strong>(\d+)<\/strong>-<strong>(\d+)<\/strong>/);
  const ppgMatch = html.match(/<td[^>]*data-stat="pts_per_g"[^>]*>([\d.]+)<\/td>/);
  const oppPpgMatch = html.match(/<td[^>]*data-stat="opp_pts_per_g"[^>]*>([\d.]+)<\/td>/);
  const offRtgMatch = html.match(/<td[^>]*data-stat="off_rtg"[^>]*>([\d.]+)<\/td>/);
  const defRtgMatch = html.match(/<td[^>]*data-stat="def_rtg"[^>]*>([\d.]+)<\/td>/);
  const paceMatch = html.match(/<td[^>]*data-stat="pace"[^>]*>([\d.]+)<\/td>/);

  if (!winsMatch) return null;

  const wins = parseInt(winsMatch[1], 10);
  const losses = parseInt(winsMatch[2], 10);
  const ppg = ppgMatch ? parseFloat(ppgMatch[1]) : null;
  const oppPpg = oppPpgMatch ? parseFloat(oppPpgMatch[1]) : null;
  const offRating = offRtgMatch ? parseFloat(offRtgMatch[1]) : null;
  const defRating = defRtgMatch ? parseFloat(defRtgMatch[1]) : null;
  const pace = paceMatch ? parseFloat(paceMatch[1]) : null;
  const netRating = offRating != null && defRating != null ? offRating - defRating : null;
  const avgMargin = ppg != null && oppPpg != null ? +(ppg - oppPpg).toFixed(1) : null;

  return { wins, losses, ppg, oppPpg, offRating, defRating, netRating, pace, avgMargin };
}

async function getTeamStats(teamKey) {
  const slug = WNBA_TEAM_SLUGS[teamKey.toLowerCase()];
  if (!slug) throw new Error(`Unknown team key for BBRef: ${teamKey}`);

  const url = `https://www.basketball-reference.com/wnba/teams/${slug}/2026.html`;
  const html = await fetchText(url);
  const stats = parseTableStats(html);
  if (!stats) throw new Error(`Could not parse BBRef stats for ${teamKey}`);

  return {
    key: teamKey.toLowerCase(),
    record: `${stats.wins}-${stats.losses}`,
    ...stats,
    source: 'bbref',
    lastUpdated: new Date().toISOString(),
    isLive: true,
    warning: 'BBRef scrape — verify against primary source',
  };
}

async function getTeams() {
  const keys = Object.keys(WNBA_TEAM_SLUGS);
  const results = await Promise.allSettled(keys.map((key) => getTeamStats(key)));
  const teams = [];
  const failures = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      teams.push(result.value);
    } else {
      failures.push(keys[i]);
    }
  }

  return {
    teams,
    source: 'bbref',
    lastUpdated: new Date().toISOString(),
    isLive: failures.length === 0,
    warning: failures.length
      ? `BBRef partial: missing ${failures.join(', ')}`
      : 'BBRef fallback — prefer ESPN when available',
  };
}

module.exports = {
  getTeams,
  getTeamStats,
  WNBA_TEAM_SLUGS,
};
