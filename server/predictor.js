'use strict';

const fatigue = require('./fatigue');
const playerImpact = require('./player-impact');
const odds = require('./odds');
const { computeHomeSpreadEdge } = require('./edge-math');

const MODEL_VERSION = 'v1.5.0';
const SIM_MARGIN_STDDEV = 8.5;

function isValidDate(dateInput) {
  if (!dateInput) return false;
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return false;
  const iso = d.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  return true;
}

function normalizeDate(dateInput) {
  if (!isValidDate(dateInput)) return null;
  return new Date(dateInput).toISOString().slice(0, 10);
}

function findTeam(teams, key) {
  return teams.find((t) => t.key === key.toLowerCase());
}

function teamOffense(team) {
  return team?.ppg ?? (team?.offRating ? team.offRating * 0.75 : 82);
}

function teamDefense(team) {
  return team?.oppPpg ?? (team?.defRating ? team.defRating * 0.75 : 82);
}

function logisticWinProb(margin) {
  return 1 / (1 + Math.exp(-margin / 6));
}

function buildDisabledPrediction(reason, meta = {}) {
  return {
    enabled: false,
    disabledReason: reason,
    projections: null,
    winProb: null,
    margin: null,
    total: null,
    odds: null,
    ...meta,
  };
}

async function predictMatchup({
  homeTeamKey,
  awayTeamKey,
  date,
  teams,
  priorGames = [],
  eventId = null,
}) {
  const homeKey = homeTeamKey?.toLowerCase();
  const awayKey = awayTeamKey?.toLowerCase();
  const gameDate = normalizeDate(date);

  if (!gameDate) {
    return buildDisabledPrediction('Invalid or missing game date — prediction disabled');
  }

  const home = findTeam(teams, homeKey);
  const away = findTeam(teams, awayKey);

  if (!home || !away) {
    return buildDisabledPrediction(
      `Unknown team(s): ${!home ? homeKey : ''} ${!away ? awayKey : ''}`.trim()
    );
  }

  const { home: homeFatigue, away: awayFatigue } = fatigue.assessMatchupFatigue(
    homeKey,
    awayKey,
    gameDate,
    priorGames
  );

  const impact = await playerImpact.getMatchupImpact(homeKey, awayKey);

  const homeBase = teamOffense(home);
  const awayBase = teamOffense(away);
  const homeDef = teamDefense(home);
  const awayDef = teamDefense(away);

  let homeScore = (homeBase + awayDef) / 2 + homeFatigue.homeCourtBonus;
  let awayScore = (awayBase + homeDef) / 2;

  homeScore -= homeFatigue.fatiguePenalty;
  awayScore -= awayFatigue.fatiguePenalty;

  const injuryCap = 6;
  homeScore -= Math.min(injuryCap, impact.home.impactPoints * 0.35);
  awayScore -= Math.min(injuryCap, impact.away.impactPoints * 0.35);

  homeScore = +Math.max(72, Math.min(105, homeScore)).toFixed(1);
  awayScore = +Math.max(72, Math.min(105, awayScore)).toFixed(1);

  const margin = +(homeScore - awayScore).toFixed(1);
  const total = +(homeScore + awayScore).toFixed(1);
  const winProb = {
    home: +logisticWinProb(margin).toFixed(3),
    away: +logisticWinProb(-margin).toFixed(3),
  };

  const oddsData = eventId
    ? await odds.getOddsForEvent(eventId)
    : await odds.getOddsForMatchup(homeKey, awayKey, gameDate);

  return {
    enabled: true,
    disabledReason: null,
    gameDate,
    homeTeam: { key: homeKey, name: home.name },
    awayTeam: { key: awayKey, name: away.name },
    projections: {
      homeScore,
      awayScore,
    },
    winProb,
    margin,
    total,
    odds: oddsData.available ? oddsData.lines : null,
    oddsWarning: oddsData.warning,
    factors: {
      fatigue: { home: homeFatigue, away: awayFatigue },
      injuryImpact: impact,
    },
    modelVersion: MODEL_VERSION,
  };
}

function randomNormal() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

async function simulateMatchup({
  homeTeamKey,
  awayTeamKey,
  date,
  teams,
  priorGames = [],
  spread = null,
  iterations = 1000,
}) {
  const n = Math.min(Math.max(parseInt(iterations, 10) || 1000, 100), 10000);
  const prediction = await predictMatchup({
    homeTeamKey,
    awayTeamKey,
    date,
    teams,
    priorGames,
  });

  if (!prediction.enabled) {
    return { error: prediction.disabledReason, modelVersion: MODEL_VERSION };
  }

  const margin = prediction.margin;
  const totalMean = prediction.total;
  let homeWins = 0;
  let homeCovers = 0;
  let overHits = 0;
  const totalLine = typeof spread === 'object' ? spread.total : null;
  const spreadLine = typeof spread === 'number' ? spread : null;

  for (let i = 0; i < n; i++) {
    const simMargin = margin + randomNormal() * SIM_MARGIN_STDDEV;
    if (simMargin > 0) homeWins++;
    if (spreadLine != null && simMargin > spreadLine) homeCovers++;
    if (totalLine != null) {
      const simTotal = totalMean + randomNormal() * 11;
      if (simTotal > totalLine) overHits++;
    }
  }

  return {
    modelVersion: MODEL_VERSION,
    iterations: n,
    homeTeam: prediction.homeTeam,
    awayTeam: prediction.awayTeam,
    gameDate: prediction.gameDate,
    projectedMargin: margin,
    projectedTotal: totalMean,
    homeWinPct: +(homeWins / n * 100).toFixed(1),
    homeCoverPct: spreadLine != null ? +(homeCovers / n * 100).toFixed(1) : null,
    overPct: totalLine != null ? +(overHits / n * 100).toFixed(1) : null,
    spread: spreadLine,
    total: totalLine,
    note: 'Monte Carlo from model projection — not market odds',
  };
}

async function predictSchedule({ events, teams, priorGames = [] }) {
  const predictions = [];

  for (const event of events) {
    if (event.statusState === 'post') continue;
    const homeKey = event.homeTeam?.key;
    const awayKey = event.awayTeam?.key;
    if (!homeKey || !awayKey) continue;

    const prediction = await predictMatchup({
      homeTeamKey: homeKey,
      awayTeamKey: awayKey,
      date: event.date,
      teams,
      priorGames,
      eventId: event.id,
    });

    predictions.push({
      eventId: event.id,
      date: event.date,
      name: event.name,
      status: event.status,
      venue: event.venue,
      ...prediction,
    });
  }

  return predictions;
}

function toIntelligencePrediction(raw, homeTeam, awayTeam, oddsInput) {
  if (!raw || raw.enabled === false) {
    return {
      enabled: false,
      projections: null,
      picks: null,
      winner: null,
      confidence: null,
    };
  }

  const homeWinProb = raw.winProb?.home ?? 0.5;
  const margin = raw.margin ?? 0;
  const marketSpread = oddsInput?.spread;
  const spreadEdge =
    typeof marketSpread === 'number' ? computeHomeSpreadEdge(margin, marketSpread) : margin;

  const favName = homeWinProb >= 0.5 ? homeTeam?.name : awayTeam?.name;

  return {
    enabled: true,
    projections: {
      homeWinProb,
      projectedScore: {
        home: raw.projections?.homeScore,
        away: raw.projections?.awayScore,
      },
      projectedMargin: margin,
      projectedTotal: raw.total,
      spreadEdge,
      winProb: homeWinProb,
    },
    picks: {
      moneyline: { pick: favName, confidence: null, line: null },
      spread:
        typeof marketSpread === 'number'
          ? {
              pick: spreadEdge >= 0 ? homeTeam?.name : awayTeam?.name,
              confidence: null,
              line: marketSpread,
            }
          : null,
      total:
        typeof oddsInput?.total === 'number'
          ? {
              pick: (raw.total ?? 0) > oddsInput.total ? 'Over' : 'Under',
              confidence: null,
              line: oddsInput.total,
            }
          : null,
    },
    winner: favName,
    confidence: null,
  };
}

function projectMatchup({
  homeTeam,
  awayTeam,
  game,
  homeRoster,
  awayRoster,
  fatigue,
  odds,
  neutralCourt,
}) {
  if (!homeTeam || !awayTeam) {
    return toIntelligencePrediction(
      buildDisabledPrediction('Missing team data'),
      homeTeam,
      awayTeam,
      odds
    );
  }

  const homeBase = teamOffense(homeTeam);
  const awayBase = teamOffense(awayTeam);
  const homeDef = teamDefense(homeTeam);
  const awayDef = teamDefense(awayTeam);

  const homeFatigue = fatigue?.home || { fatiguePenalty: 0, homeCourtBonus: 2.5 };
  const awayFatigue = fatigue?.away || { fatiguePenalty: 0, homeCourtBonus: 0 };

  let homeScore = (homeBase + awayDef) / 2;
  let awayScore = (awayBase + homeDef) / 2;

  if (!neutralCourt) {
    homeScore += homeFatigue.homeCourtBonus || 2.5;
  }
  homeScore -= homeFatigue.fatiguePenalty || 0;
  awayScore -= awayFatigue.fatiguePenalty || 0;

  homeScore = +Math.max(72, Math.min(105, homeScore)).toFixed(1);
  awayScore = +Math.max(72, Math.min(105, awayScore)).toFixed(1);

  const margin = +(homeScore - awayScore).toFixed(1);
  const total = +(homeScore + awayScore).toFixed(1);

  const raw = {
    enabled: true,
    projections: { homeScore, awayScore },
    winProb: {
      home: +logisticWinProb(margin).toFixed(3),
      away: +logisticWinProb(-margin).toFixed(3),
    },
    margin,
    total,
  };

  return toIntelligencePrediction(raw, homeTeam, awayTeam, odds);
}

async function predictUpcomingGames({
  teams,
  schedule,
  injuries,
  getRosterForTeam,
  oddsMap = {},
}) {
  const gamesData = [];
  const priorGames = (schedule || []).filter((e) => e.statusState === 'post');

  for (const event of schedule || []) {
    if (event.statusState === 'post') continue;

    const homeKey = event.homeTeam?.key;
    const awayKey = event.awayTeam?.key;
    if (!homeKey || !awayKey) continue;

    const homeTeam = findTeam(teams, homeKey);
    const awayTeam = findTeam(teams, awayKey);
    if (!homeTeam || !awayTeam) continue;

    const homeRoster = getRosterForTeam ? getRosterForTeam(homeTeam) : null;
    const awayRoster = getRosterForTeam ? getRosterForTeam(awayTeam) : null;

    const gameDate = normalizeDate(event.date) || event.date?.slice(0, 10);
    const game = {
      id: event.id || `${awayTeam.name}@${homeTeam.name}`,
      home: homeTeam.name,
      away: awayTeam.name,
      homeKey,
      awayKey,
      date: gameDate,
      dateValid: Boolean(gameDate),
      status: event.statusState === 'post' ? 'final' : 'upcoming',
    };

    const fatigueResult = fatigue.assessMatchupFatigue(
      homeKey,
      awayKey,
      gameDate,
      priorGames
    );

    const odds = oddsMap[event.id] || null;

    let prediction;
    try {
      const raw = await predictMatchup({
        homeTeamKey: homeKey,
        awayTeamKey: awayKey,
        date: gameDate,
        teams,
        priorGames,
        eventId: event.id,
      });
      prediction = toIntelligencePrediction(raw, homeTeam, awayTeam, odds);
    } catch {
      prediction = projectMatchup({
        homeTeam,
        awayTeam,
        game,
        homeRoster,
        awayRoster,
        fatigue: fatigueResult,
        odds,
      });
    }

    gamesData.push({
      game,
      homeTeam,
      awayTeam,
      homeRoster,
      awayRoster,
      fatigue: fatigueResult,
      odds,
      prediction,
    });
  }

  return gamesData;
}


module.exports = {
  MODEL_VERSION,
  isValidDate,
  normalizeDate,
  predictMatchup,
  predictSchedule,
  simulateMatchup,
  predictUpcomingGames,
  projectMatchup,
  toIntelligencePrediction,
  buildDisabledPrediction,
};
