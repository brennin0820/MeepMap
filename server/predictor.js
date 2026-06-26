'use strict';

const fatigue = require('./fatigue');
const playerImpact = require('./player-impact');
const odds = require('./odds');
const { computeHomeSpreadEdge } = require('./edge-math');
const config = require('./model-config');

const { MODEL_VERSION, SIM_MARGIN_STDDEV } = config;

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
  return (
    team?.ppg ??
    (team?.offRating
      ? team.offRating * (config.LEAGUE_AVERAGE_PACE / 100)
      : config.LEAGUE_AVERAGE_POINTS)
  );
}

function teamDefense(team) {
  return (
    team?.oppPpg ??
    (team?.defRating
      ? team.defRating * (config.LEAGUE_AVERAGE_PACE / 100)
      : config.LEAGUE_AVERAGE_POINTS)
  );
}

function recordWinRate(record) {
  if (!record || typeof record !== 'string') return null;
  const m = record.trim().match(/^(\d+)-(\d+)$/);
  if (!m) return null;
  const wins = Number(m[1]);
  const losses = Number(m[2]);
  const total = wins + losses;
  if (total === 0) return null;
  return wins / total;
}

function expectedPace(home, away) {
  const homePace = home?.pace;
  const awayPace = away?.pace;
  if (typeof homePace === 'number' && typeof awayPace === 'number') {
    return +((homePace + awayPace) / 2).toFixed(1);
  }
  if (typeof homePace === 'number') {
    return +((homePace + config.LEAGUE_AVERAGE_PACE) / 2).toFixed(1);
  }
  if (typeof awayPace === 'number') {
    return +((config.LEAGUE_AVERAGE_PACE + awayPace) / 2).toFixed(1);
  }
  return null;
}

function baselineScores(home, away, pace) {
  const homeOff = home?.offRating;
  const awayDef = away?.defRating;
  const awayOff = away?.offRating;
  const homeDef = home?.defRating;
  if (
    homeOff != null &&
    awayDef != null &&
    awayOff != null &&
    homeDef != null
  ) {
    const p = pace ?? config.LEAGUE_AVERAGE_PACE;
    const homePer100 = homeOff * config.OFFENSE_WEIGHT + awayDef * config.DEFENSE_WEIGHT;
    const awayPer100 = awayOff * config.OFFENSE_WEIGHT + homeDef * config.DEFENSE_WEIGHT;
    return {
      home: (homePer100 * p) / 100,
      away: (awayPer100 * p) / 100,
    };
  }
  return {
    home: (teamOffense(home) + teamDefense(away)) / 2,
    away: (teamDefense(home) + teamOffense(away)) / 2,
  };
}

function venueAdjustment(home, away) {
  const homeRate = recordWinRate(home?.homeRecord);
  const awayRate = recordWinRate(away?.awayRecord);
  if (homeRate == null || awayRate == null) return { home: 0, away: 0 };
  const diff = Math.max(
    -config.WIN_RATE_DIFF_CAP,
    Math.min(config.WIN_RATE_DIFF_CAP, homeRate - awayRate)
  );
  return {
    home: diff * config.VENUE_HOME_MULT,
    away: -diff * config.VENUE_AWAY_MULT,
  };
}

function formAdjustment(home, away) {
  const homeForm = recordWinRate(home?.last5);
  const awayForm = recordWinRate(away?.last5);
  if (homeForm == null || awayForm == null) return { home: 0, away: 0 };
  const diff = Math.max(
    -config.WIN_RATE_DIFF_CAP,
    Math.min(config.WIN_RATE_DIFF_CAP, homeForm - awayForm)
  );
  return { home: diff * config.FORM_MULT, away: -diff * config.FORM_MULT };
}

function marginAdjustment(home, away) {
  const homeMargin = home?.avgMargin;
  const awayMargin = away?.avgMargin;
  if (homeMargin == null || awayMargin == null) return { home: 0, away: 0 };
  const diff = Math.max(
    -config.MARGIN_DIFF_CAP,
    Math.min(config.MARGIN_DIFF_CAP, homeMargin - awayMargin)
  );
  const adj = Math.max(
    -config.MARGIN_ADJ_CAP,
    Math.min(config.MARGIN_ADJ_CAP, diff * config.MARGIN_ADJ_RATE)
  );
  return { home: adj, away: -adj };
}

function logisticWinProb(margin) {
  return 1 / (1 + Math.exp(-margin / config.LOGISTIC_MARGIN_DIVISOR));
}

function clampScore(score) {
  return +Math.max(config.SCORE_MIN, Math.min(config.SCORE_MAX, score)).toFixed(1);
}

function computeScores(home, away, options = {}) {
  const {
    homeFatigue = { fatiguePenalty: 0, homeCourtBonus: 0 },
    awayFatigue = { fatiguePenalty: 0, homeCourtBonus: 0 },
    homeInjuryPenalty = 0,
    awayInjuryPenalty = 0,
    neutralCourt = false,
  } = options;

  const pace = expectedPace(home, away);
  const baseline = baselineScores(home, away, pace);
  const venue = venueAdjustment(home, away);
  const form = formAdjustment(home, away);
  const marginAdj = marginAdjustment(home, away);

  let homeScore = baseline.home;
  let awayScore = baseline.away;

  if (!neutralCourt) {
    homeScore += homeFatigue.homeCourtBonus || 0;
  }
  homeScore -= homeFatigue.fatiguePenalty || 0;
  awayScore -= awayFatigue.fatiguePenalty || 0;
  homeScore -= homeInjuryPenalty;
  awayScore -= awayInjuryPenalty;
  homeScore += venue.home + form.home + marginAdj.home;
  awayScore += venue.away + form.away + marginAdj.away;

  return {
    homeScore: clampScore(homeScore),
    awayScore: clampScore(awayScore),
    pace,
    baseline,
    venue,
    form,
    marginAdj,
  };
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
  neutralCourt = false,
  extraHomeInjuryPenalty = 0,
  extraAwayInjuryPenalty = 0,
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

  let impact;
  try {
    impact = await playerImpact.getMatchupImpact(homeKey, awayKey);
  } catch (err) {
    // Injury/roster fetch can fail (network/API). Degrade gracefully to a
    // zero-impact assessment rather than rejecting the whole prediction.
    impact = { home: { impactPoints: 0 }, away: { impactPoints: 0 } };
  }
  const homeInjuryPenalty = Math.min(
    config.INJURY_CAP,
    impact.home.impactPoints * config.INJURY_SCALE + extraHomeInjuryPenalty
  );
  const awayInjuryPenalty = Math.min(
    config.INJURY_CAP,
    impact.away.impactPoints * config.INJURY_SCALE + extraAwayInjuryPenalty
  );

  const scores = computeScores(home, away, {
    homeFatigue,
    awayFatigue,
    homeInjuryPenalty,
    awayInjuryPenalty,
    neutralCourt,
  });

  const { homeScore, awayScore } = scores;
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
      expectedPace: scores.pace,
      baseline: scores.baseline,
      venue: scores.venue,
      form: scores.form,
      marginAdj: scores.marginAdj,
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
  const totalLine = spread && typeof spread === 'object' ? spread.total : null;
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
    homeWinPct: +((homeWins / n) * 100).toFixed(1),
    homeCoverPct: spreadLine != null ? +((homeCovers / n) * 100).toFixed(1) : null,
    overPct: totalLine != null ? +((overHits / n) * 100).toFixed(1) : null,
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
    typeof marketSpread === 'number' ? computeHomeSpreadEdge(margin, marketSpread) : null;

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
  fatigue: fatigueInput,
  odds: oddsInput,
  neutralCourt,
  homeInjuryPenalty = 0,
  awayInjuryPenalty = 0,
}) {
  if (!homeTeam || !awayTeam) {
    return toIntelligencePrediction(
      buildDisabledPrediction('Missing team data'),
      homeTeam,
      awayTeam,
      oddsInput
    );
  }

  const homeFatigue = fatigueInput?.home || {
    fatiguePenalty: 0,
    homeCourtBonus: config.HOME_COURT_ADV,
  };
  const awayFatigue = fatigueInput?.away || { fatiguePenalty: 0, homeCourtBonus: 0 };

  const { homeScore, awayScore } = computeScores(homeTeam, awayTeam, {
    homeFatigue,
    awayFatigue,
    homeInjuryPenalty,
    awayInjuryPenalty,
    neutralCourt,
  });

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

  return toIntelligencePrediction(raw, homeTeam, awayTeam, oddsInput);
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

    const oddsForGame = oddsMap[event.id] || null;

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
      prediction = toIntelligencePrediction(raw, homeTeam, awayTeam, oddsForGame);
    } catch {
      const impact = require('./player-impact').computeMatchupImpactFromRosters(homeRoster, awayRoster);
      prediction = projectMatchup({
        homeTeam,
        awayTeam,
        game,
        homeRoster,
        awayRoster,
        fatigue: fatigueResult,
        odds: oddsForGame,
        homeInjuryPenalty: Math.min(
          config.INJURY_CAP,
          impact.home.impactPoints * config.INJURY_SCALE
        ),
        awayInjuryPenalty: Math.min(
          config.INJURY_CAP,
          impact.away.impactPoints * config.INJURY_SCALE
        ),
      });
    }

    gamesData.push({
      game,
      homeTeam,
      awayTeam,
      homeRoster,
      awayRoster,
      fatigue: fatigueResult,
      odds: oddsForGame,
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
