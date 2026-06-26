'use strict';

const dataFetcher = require('./data-fetcher');
const injuries = require('./injuries');
const predictor = require('./predictor');
const { assessDataQuality, buildInjuriesFromTeamList } = require('./data-quality');
const { decide, DECISION_TYPES } = require('./decision-engine');
const { buildInsights } = require('./insight-engine');
const { buildAlerts, snapshotDecisions, getPreviousSnapshot } = require('./alert-engine');
const { explain } = require('./explanation-engine');
const { runWhatIf } = require('./what-if-engine');
const { recordPrediction } = require('./prediction-history');
const { volatilityIndex } = require('./volatility');
const { computeHomeSpreadEdge } = require('./edge-math');

const { MODEL_VERSION } = require('./model-config');

const REASON_TEXT = {
  NET_RATING_EDGE: 'Net rating favors one side',
  MODEL_SPREAD_EDGE: 'Model spread edge vs market',
  MODEL_WIN_PROB_EDGE: 'Win probability edge',
  HOME_COURT_ADVANTAGE: 'Home court advantage',
  RECENT_FORM_EDGE: 'Recent form edge',
  STRONG_COMPOSITE_EDGE: 'Strong composite edge',
  MODERATE_EDGE: 'Moderate edge',
  NO_ACTIONABLE_EDGE: 'No actionable edge',
  HIGH_VARIANCE_MATCHUP: 'High variance matchup',
  KEY_INJURY_UNCERTAINTY: 'Injury uncertainty',
  ODDS_MISSING_LIMITS_EDGE: 'Odds unavailable limits edge',
  INSUFFICIENT_TEAM_DATA: 'Insufficient team data',
  LINEUP_UNCONFIRMED_BLOCK: 'Lineup unconfirmed',
};

function americanMoneylineFromProbability(probability) {
  if (typeof probability !== 'number' || !Number.isFinite(probability)) return null;
  const capped = Math.min(0.999, Math.max(0.001, probability));
  if (capped >= 0.5) {
    return -Math.round((capped / (1 - capped)) * 100);
  }
  return Math.round(((1 - capped) / capped) * 100);
}

function impliedProbabilityFromMoneyline(line) {
  if (typeof line !== 'number' || !Number.isFinite(line) || line === 0) return null;
  if (line < 0) {
    const absLine = Math.abs(line);
    return absLine / (absLine + 100);
  }
  return 100 / (line + 100);
}

function normalizeMarketOdds(odds) {
  if (!odds) return null;
  const homeMoneyline = odds.homeMoneyline ?? odds.moneyline?.home ?? null;
  const awayMoneyline = odds.awayMoneyline ?? odds.moneyline?.away ?? null;
  const openingHomeMoneyline = odds.openingHomeMoneyline ?? odds.openingMoneyline?.home ?? null;
  const openingAwayMoneyline = odds.openingAwayMoneyline ?? odds.openingMoneyline?.away ?? null;
  const hasOdds =
    typeof odds.spread === 'number' ||
    typeof odds.total === 'number' ||
    typeof homeMoneyline === 'number' ||
    typeof awayMoneyline === 'number';

  if (!hasOdds) return null;

  return {
    provider: odds.provider ?? null,
    spread: odds.spread ?? null,
    total: odds.total ?? null,
    homeMoneyline,
    awayMoneyline,
    openingSpread: odds.openingSpread ?? null,
    openingTotal: odds.openingTotal ?? null,
    openingHomeMoneyline,
    openingAwayMoneyline,
    source: odds.source ?? null,
    deepLink: odds.deepLink ?? null,
  };
}

function buildMoneylinePrediction(prediction, homeTeam, awayTeam) {
  if (!prediction?.enabled) return null;

  const homeWinProb = prediction.winProb?.home;
  const awayWinProb = prediction.winProb?.away;
  if (typeof homeWinProb !== 'number' && typeof awayWinProb !== 'number') {
    return null;
  }

  const homeIsWinner = (homeWinProb ?? 0.5) >= (awayWinProb ?? 0.5);
  const winner = homeIsWinner ? homeTeam?.name : awayTeam?.name;
  const winProb = homeIsWinner ? homeWinProb : awayWinProb;
  const marketOdds = normalizeMarketOdds(prediction.odds);
  const marketLine = homeIsWinner ? marketOdds?.homeMoneyline : marketOdds?.awayMoneyline;
  const fairLine = americanMoneylineFromProbability(winProb);
  const impliedProbability = impliedProbabilityFromMoneyline(marketLine);
  const edge =
    typeof winProb === 'number' && typeof impliedProbability === 'number'
      ? +(winProb - impliedProbability).toFixed(3)
      : null;

  let note = 'Model-only fair line. Compare against real sportsbook odds before deciding whether there is value.';
  if (marketLine != null && edge != null) {
    if (edge >= 0.015) {
      note = `Model win probability is ${(edge * 100).toFixed(1)} points above market implied probability.`;
    } else if (edge <= -0.015) {
      note = `Market implies ${(Math.abs(edge) * 100).toFixed(1)} more win-probability points than the model.`;
    } else {
      note = 'Model fair line is close to market price, so moneyline value looks limited.';
    }
  } else if (marketLine != null) {
    note = 'Market moneyline attached, but fair-line comparison is incomplete.';
  }

  return {
    winner,
    pick: winner ? `${winner} ML` : null,
    winProb,
    fairLine,
    marketLine,
    edge,
    note,
    marketOdds,
  };
}

function findTeam(teams, key) {
  return teams.find((t) => t.key === key?.toLowerCase());
}

function riskFromDecision(decision, edgeScore) {
  if (decision === DECISION_TYPES.HIGH_RISK_ONLY) return 'High';
  if (decision === DECISION_TYPES.INSUFFICIENT_DATA) return 'Extreme';
  if (edgeScore >= 72) return 'Low';
  if (edgeScore >= 55) return 'Medium';
  return 'High';
}

function recommendedPick(decision, prediction, homeTeam, awayTeam) {
  if ([DECISION_TYPES.PASS, DECISION_TYPES.INSUFFICIENT_DATA, DECISION_TYPES.WAIT_FOR_LINEUP].includes(decision)) {
    return null;
  }
  if (!prediction?.enabled) return null;
  const homeProb = prediction.winProb?.home ?? 0.5;
  const awayProb = prediction.winProb?.away ?? 0.5;
  const fav = homeProb >= awayProb ? homeTeam?.name : awayTeam?.name;
  return fav ? `${fav} ML` : null;
}

function buildModelProjection(prediction) {
  if (!prediction?.enabled) return null;
  const spreadEdge =
    prediction.odds?.spread != null && prediction.margin != null
      ? computeHomeSpreadEdge(prediction.margin, prediction.odds.spread)
      : undefined;
  return {
    winProb: prediction.winProb?.home,
    projectedMargin: prediction.margin,
    projectedTotal: prediction.total,
    spreadEdge,
  };
}

function mapAlertsForApi(alerts) {
  return (alerts || []).map((a, i) => ({
    id: a.id || `alert-${i}-${a.type || 'info'}`,
    type: a.type,
    severity: a.severity || 'Info',
    title: a.title || (a.type || 'ALERT').replace(/_/g, ' '),
    message: a.message,
    gameId: a.gameId || a.game || null,
    home: a.home || null,
    away: a.away || null,
    code: a.type,
    action: a.action || null,
  }));
}

function toNestedGame(g) {
  return {
    ...g,
    game: g.gameInfo,
    decision: g.decisionDetail,
  };
}

function toApiGame(row) {
  const gi = row.apiGame;
  return gi;
}

async function buildGameRow(event, teams, priorGames, meta, sourceHealth, injuryList = []) {
  const homeKey = event.homeTeam?.key;
  const awayKey = event.awayTeam?.key;
  const homeTeam = findTeam(teams, homeKey);
  const awayTeam = findTeam(teams, awayKey);
  if (!homeTeam || !awayTeam) return null;

  const prediction = await predictor.predictMatchup({
    homeTeamKey: homeKey,
    awayTeamKey: awayKey,
    date: event.date,
    teams,
    priorGames,
    eventId: event.id,
  });

  const game = {
    id: event.id,
    home: homeTeam.name,
    away: awayTeam.name,
    homeKey,
    awayKey,
    date: event.date,
    dateValid: predictor.isValidDate(event.date),
    status: event.status,
  };

  const odds = prediction.odds || null;
  const modelProjection = buildModelProjection(prediction);
  const matchupInjuries = buildInjuriesFromTeamList(injuryList, homeKey, awayKey);

  const dataQuality = assessDataQuality({
    game: { ...game, status: event.statusState },
    homeTeam,
    awayTeam,
    odds,
    injuries: matchupInjuries,
    modelProjection,
    sampleSize: Math.min(
      (homeTeam.wins || 0) + (homeTeam.losses || 0),
      (awayTeam.wins || 0) + (awayTeam.losses || 0)
    ),
  });

  const decisionResult = decide({
    game: { homeKey, awayKey },
    homeTeam,
    awayTeam,
    modelProjection,
    odds,
    injuries: matchupInjuries,
    dataQuality,
  });

  const insights = buildInsights({
    game,
    homeTeam,
    awayTeam,
    modelProjection,
    odds,
    dataQuality,
    decision: decisionResult,
    fatigue: prediction.fatigue,
  });

  const explanation = explain({
    game,
    homeTeam,
    awayTeam,
    prediction: prediction.enabled
      ? { projections: { homeWinProb: prediction.winProb?.home, projectedMargin: prediction.margin } }
      : null,
    decision: decisionResult,
    dataQuality,
    odds,
    insights,
  });

  const humanReasons = decisionResult.reasonCodes
    .map((c) => REASON_TEXT[c])
    .filter(Boolean)
    .slice(0, 5);

  const pick = recommendedPick(decisionResult.decision, prediction, homeTeam, awayTeam);
  const moneyline = buildMoneylinePrediction(prediction, homeTeam, awayTeam);

  if (prediction.enabled && game.dateValid && decisionResult.decision !== DECISION_TYPES.INSUFFICIENT_DATA) {
    recordPrediction({
      game,
      projectedWinner: pick,
      projectedScore: prediction.projections,
      moneylinePick: pick,
      spreadPick: null,
      totalPick: null,
      confidence: decisionResult.confidence,
      risk: riskFromDecision(decisionResult.decision, decisionResult.edgeScore),
      dataQuality: dataQuality.grade,
      reasonCodes: decisionResult.reasonCodes,
      decision: decisionResult.decision,
      edgeScore: decisionResult.edgeScore,
    });
  }

  const apiGame = {
    id: game.id,
    away: game.away,
    home: game.home,
    awayKey,
    homeKey,
    date: game.date,
    decision: decisionResult.decision,
    confidence: decisionResult.confidence,
    edgeScore: decisionResult.edgeScore,
    risk: riskFromDecision(decisionResult.decision, decisionResult.edgeScore),
    dataQuality,
    prediction: prediction.enabled
      ? {
          spread: prediction.margin,
          total: prediction.total,
          winProb: prediction.winProb?.home,
          lineStatus: prediction.odds ? 'line-attached' : 'model-only',
          lineWarning: prediction.oddsWarning || (prediction.odds ? null : 'No odds provider configured — verify market lines before wagering.'),
          projections: {
            homeWinProb: prediction.winProb?.home,
            projectedMargin: prediction.margin,
            projectedTotal: prediction.total,
            projectedScore: prediction.projections,
          },
          winner: moneyline?.winner ?? null,
          moneylinePick: moneyline?.pick ?? pick,
          moneylineWinProb: moneyline?.winProb ?? null,
          fairMoneyline: moneyline?.fairLine ?? null,
          marketMoneyline: moneyline?.marketLine ?? null,
          moneylineEdge: moneyline?.edge ?? null,
          moneylineNote: moneyline?.note ?? null,
          marketOdds: moneyline?.marketOdds ?? null,
        }
      : null,
    recommendedPick: pick,
    why: explanation.pros,
    warnings: explanation.cons,
    humanReasons,
    insights,
    explanation,
    homeTeam: {
      key: homeKey,
      name: homeTeam.name,
      record: homeTeam.record,
      last5: homeTeam.last5,
      netRating: homeTeam.netRating,
      offRating: homeTeam.offRating,
      defRating: homeTeam.defRating,
      profile: {
        momentum: require('./team-profile').momentumLabel(homeTeam.last5),
        healthGrade: require('./team-profile').healthGrade(homeTeam),
        homeRecord: homeTeam.homeRecord,
        awayRecord: homeTeam.awayRecord,
        last10: homeTeam.last10,
        volatility: volatilityIndex(homeTeam, priorGames),
      },
    },
    awayTeam: {
      key: awayKey,
      name: awayTeam.name,
      record: awayTeam.record,
      last5: awayTeam.last5,
      netRating: awayTeam.netRating,
      offRating: awayTeam.offRating,
      defRating: awayTeam.defRating,
      profile: {
        momentum: require('./team-profile').momentumLabel(awayTeam.last5),
        healthGrade: require('./team-profile').healthGrade(awayTeam),
        homeRecord: awayTeam.homeRecord,
        awayRecord: awayTeam.awayRecord,
        last10: awayTeam.last10,
        volatility: volatilityIndex(awayTeam, priorGames),
      },
    },
    gameInfo: {
      gameId: game.id,
      date: game.date,
      time: null,
      homeKey,
      awayKey,
      homeName: homeTeam.name,
      awayName: awayTeam.name,
      status: game.status,
      dateValid: game.dateValid,
    },
    decisionDetail: {
      decision: decisionResult.decision,
      confidence: `${decisionResult.confidence}%`,
      risk: riskFromDecision(decisionResult.decision, decisionResult.edgeScore),
      edgeScore: decisionResult.edgeScore,
      action: pick ? `Lean ${pick}` : decisionResult.decision.replace(/_/g, ' '),
      reasonCodes: decisionResult.reasonCodes,
      humanReasons,
    },
  };

  const homeRoster = dataFetcher.getRosterFromInjuries(homeKey, injuryList, homeTeam.name);
  const awayRoster = dataFetcher.getRosterFromInjuries(awayKey, injuryList, awayTeam.name);

  return {
    apiGame,
    alertRow: {
      game,
      homeRoster,
      awayRoster,
      injuries: matchupInjuries,
      decision: decisionResult,
      dataQuality,
      recommendedPick: pick,
      edgeScore: decisionResult.edgeScore,
    },
  };
}

async function loadGameRows(days) {
  const [teamsResult, scheduleResult, injuriesResult] = await Promise.all([
    dataFetcher.getTeams(),
    dataFetcher.getScheduleRange(days),
    injuries.getInjuries(),
  ]);

  const priorGames = scheduleResult.events.filter((e) => e.statusState === 'post');
  const upcoming = scheduleResult.events.filter((e) => e.statusState !== 'post');

  const meta = {
    source: scheduleResult.source,
    isLive: scheduleResult.isLive && teamsResult.isLive,
    warning: scheduleResult.warning || teamsResult.warning,
    days,
  };

  const sourceHealth = {
    espn: scheduleResult.source === 'espn' && scheduleResult.isLive ? 'healthy' : 'fallback',
    basketballReference: teamsResult.source === 'bbref' ? 'healthy' : 'unknown',
    cache: meta.isLive ? 'fresh' : 'stale',
    injuries: injuriesResult.isLive ? 'healthy' : 'fallback',
    odds: 'unavailable',
    live: meta.isLive,
    cacheAgeSeconds: scheduleResult.cacheAgeSeconds || 0,
  };

  const injuryList = injuriesResult.injuries || [];
  const rows = [];
  for (const event of upcoming) {
    try {
      const row = await buildGameRow(
        event,
        teamsResult.teams,
        priorGames,
        meta,
        sourceHealth,
        injuryList
      );
      if (row) rows.push(row);
    } catch (err) {
      // One bad game (e.g. transient data fetch failure) must not sink the
      // entire intelligence payload — skip it and keep the rest.
      console.error(`Failed to analyze game ${event.id || event.name || '?'}: ${err.message}`);
    }
  }

  const oddsAttachedCount = rows.filter((row) => row.apiGame?.dataQuality?.flags?.hasOdds === true).length;
  sourceHealth.odds =
    rows.length === 0
      ? 'idle'
      : oddsAttachedCount === rows.length
        ? 'healthy'
        : oddsAttachedCount > 0
          ? 'partial'
          : 'unavailable';

  return { rows, meta, sourceHealth, teams: teamsResult.teams };
}

function buildSummary(games) {
  return {
    strongPick: games.filter((g) => g.decision === DECISION_TYPES.STRONG_PICK).length,
    lean: games.filter((g) => g.decision === DECISION_TYPES.LEAN).length,
    pass: games.filter((g) => g.decision === DECISION_TYPES.PASS).length,
    waitForLineup: games.filter((g) => g.decision === DECISION_TYPES.WAIT_FOR_LINEUP).length,
    highRisk: games.filter((g) => g.decision === DECISION_TYPES.HIGH_RISK_ONLY).length,
    insufficient: games.filter((g) => g.decision === DECISION_TYPES.INSUFFICIENT_DATA).length,
    bestBets: games.filter((g) => g.decision === DECISION_TYPES.STRONG_PICK).length,
    wait: games.filter((g) => g.decision === DECISION_TYPES.WAIT_FOR_LINEUP).length,
  };
}

async function getIntelligence(days = 7) {
  const { rows, meta, sourceHealth } = await loadGameRows(days);
  const games = rows.map((r) => r.apiGame).sort((a, b) => (b.edgeScore || 0) - (a.edgeScore || 0));
  const gamesIntel = rows.map((r) => r.alertRow);

  const alerts = mapAlertsForApi(
    buildAlerts({ gamesIntel, meta, sourceHealth, previousSnapshot: getPreviousSnapshot() })
  );
  snapshotDecisions(gamesIntel);

  return {
    generatedAt: new Date().toISOString(),
    modelVersion: MODEL_VERSION,
    summary: {
      strongPick: buildSummary(games).strongPick,
      lean: buildSummary(games).lean,
      pass: buildSummary(games).pass,
      waitForLineup: buildSummary(games).waitForLineup,
      highRisk: buildSummary(games).highRisk,
      insufficient: buildSummary(games).insufficient,
      strongPicks: buildSummary(games).strongPick,
      leans: buildSummary(games).lean,
      wait: buildSummary(games).waitForLineup,
    },
    games: games.map(toNestedGame),
    alerts,
    sourceHealth,
    health: {
      live: sourceHealth.live,
      cacheAgeSeconds: sourceHealth.cacheAgeSeconds,
      sources: {
        espn: sourceHealth.espn,
        bbref: sourceHealth.basketballReference,
        cache: sourceHealth.cache,
      },
    },
    meta,
    bestBetsOfDay: games.filter((g) => g.decision === DECISION_TYPES.STRONG_PICK).slice(0, 5),
    highestEdge: [...games].sort((a, b) => (b.edgeScore || 0) - (a.edgeScore || 0)).slice(0, 5),
  };
}

async function getGameIntelligence(gameId, days = 14) {
  const payload = await getIntelligence(days);
  const game = payload.games.find(
    (g) => g.id === gameId || `${g.awayKey}@${g.homeKey}` === gameId
  );
  return game || null;
}

async function analyzeMatchup({ homeTeamKey, awayTeamKey, homeKey, awayKey, date }) {
  const hKey = (homeTeamKey || homeKey || '').toLowerCase();
  const aKey = (awayTeamKey || awayKey || '').toLowerCase();
  const teamsResult = await dataFetcher.getTeams();
  const injuriesResult = await injuries.getInjuries();
  const gameDate = date || new Date().toISOString();

  const event = {
    id: `matchup-${aKey}-${hKey}`,
    date: gameDate,
    status: 'Scheduled',
    statusState: 'pre',
    homeTeam: { key: hKey },
    awayTeam: { key: aKey },
  };

  const row = await buildGameRow(
    event,
    teamsResult.teams,
    [],
    {},
    {},
    injuriesResult.injuries || []
  );
  if (!row) {
    return { error: 'Unknown team key(s)' };
  }

  const homeTeam = findTeam(teamsResult.teams, hKey);
  const awayTeam = findTeam(teamsResult.teams, aKey);

  return {
    game: toNestedGame(row.apiGame),
    analysis: row.apiGame,
    awayTeam,
    homeTeam,
    generatedAt: new Date().toISOString(),
  };
}

async function runWhatIfScenario(body) {
  const { homeTeamKey, awayTeamKey, homeKey, awayKey, scenario = {} } = body || {};
  const hKey = (homeTeamKey || homeKey || '').toLowerCase();
  const aKey = (awayTeamKey || awayKey || '').toLowerCase();
  const teamsResult = await dataFetcher.getTeams();
  const injuriesResult = await injuries.getInjuries();
  const homeTeam = findTeam(teamsResult.teams, hKey);
  const awayTeam = findTeam(teamsResult.teams, aKey);
  if (!homeTeam || !awayTeam) return { error: 'Unknown teams' };

  const prediction = await predictor.predictMatchup({
    homeTeamKey: hKey,
    awayTeamKey: aKey,
    date: body.date || new Date().toISOString(),
    teams: teamsResult.teams,
  });

  const fatigueResult = require('./fatigue').assessMatchupFatigue(
    hKey,
    aKey,
    body.date || prediction.gameDate || new Date().toISOString().slice(0, 10),
    []
  );
  const homeRoster = dataFetcher.getRosterFromInjuries(hKey, injuriesResult.injuries || [], homeTeam.name);
  const awayRoster = dataFetcher.getRosterFromInjuries(aKey, injuriesResult.injuries || [], awayTeam.name);

  const modelProjection = buildModelProjection(prediction);
  const manualOdds = {};
  if (body.spread != null && Number.isFinite(Number(body.spread))) {
    manualOdds.spread = Number(body.spread);
  }
  if (body.total != null && Number.isFinite(Number(body.total))) {
    manualOdds.total = Number(body.total);
  }
  const oddsInput = Object.keys(manualOdds).length
    ? { ...(prediction.odds || {}), ...manualOdds }
    : prediction.odds;
  const game = {
    homeKey: hKey,
    awayKey: aKey,
    date: body.date || prediction.gameDate || new Date().toISOString(),
    dateValid: true,
    status: 'scheduled',
  };
  const matchupInjuries = buildInjuriesFromTeamList(
    injuriesResult.injuries || [],
    hKey,
    aKey
  );
  const dataQuality = assessDataQuality({
    game,
    homeTeam,
    awayTeam,
    modelProjection,
    odds: oddsInput,
    injuries: matchupInjuries,
    prediction,
  });

  const whatIf = runWhatIf({
    game,
    homeTeam,
    awayTeam,
    modelProjection,
    odds: oddsInput,
    dataQuality,
    prediction,
    scenario,
    fatigue: fatigueResult,
    homeRoster,
    awayRoster,
    injuries: matchupInjuries,
    predictor,
  });

  return {
    baseline: whatIf.baseline,
    original: whatIf.baseline,
    scenario: whatIf.scenario || whatIf.adjusted || whatIf.scenarios?.[0]?.outcome || null,
    adjusted: whatIf.adjusted || whatIf.scenario || null,
    scenarios: whatIf.scenarios,
    delta: whatIf.delta,
    summary: whatIf.summary || 'No alternate scenarios available without market lines.',
  };
}

function getHealth() {
  return {
    status: 'ok',
    modelVersion: MODEL_VERSION,
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  getIntelligence,
  getGameIntelligence,
  analyzeMatchup,
  runWhatIfScenario,
  getHealth,
  MODEL_VERSION,
  loadGameRows,
};
