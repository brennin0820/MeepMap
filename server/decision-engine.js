/**
 * Betting decision engine — maps model edge + data quality to actionable decisions.
 *
 * Pure functions. Never fabricates odds or confidence; confidence is capped by
 * caller-supplied dataQuality.confidenceCap and edge grade caps.
 *
 * @module decision-engine
 */

const {
  scoreToGrade,
  CONFIDENCE_CAPS,
  buildInjuriesFromRosters,
  deriveLineupState,
  modelProjectionFromPrediction,
} = require('./data-quality');
const { computeHomeSpreadEdge } = require('./edge-math');

/** @readonly */
const DECISION_TYPES = Object.freeze({
  STRONG_PICK: 'STRONG_PICK',
  LEAN: 'LEAN',
  PASS: 'PASS',
  WAIT_FOR_LINEUP: 'WAIT_FOR_LINEUP',
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
  HIGH_RISK_ONLY: 'HIGH_RISK_ONLY',
});

/** @readonly */
const REASON_CODES = Object.freeze({
  NET_RATING_EDGE: 'NET_RATING_EDGE',
  MODEL_SPREAD_EDGE: 'MODEL_SPREAD_EDGE',
  MODEL_WIN_PROB_EDGE: 'MODEL_WIN_PROB_EDGE',
  HOME_COURT_ADVANTAGE: 'HOME_COURT_ADVANTAGE',
  RECENT_FORM_EDGE: 'RECENT_FORM_EDGE',
  LINEUP_UNCONFIRMED_BLOCK: 'LINEUP_UNCONFIRMED_BLOCK',
  INSUFFICIENT_TEAM_DATA: 'INSUFFICIENT_TEAM_DATA',
  NO_ACTIONABLE_EDGE: 'NO_ACTIONABLE_EDGE',
  HIGH_VARIANCE_MATCHUP: 'HIGH_VARIANCE_MATCHUP',
  KEY_INJURY_UNCERTAINTY: 'KEY_INJURY_UNCERTAINTY',
  ODDS_MISSING_LIMITS_EDGE: 'ODDS_MISSING_LIMITS_EDGE',
  STRONG_COMPOSITE_EDGE: 'STRONG_COMPOSITE_EDGE',
  MODERATE_EDGE: 'MODERATE_EDGE',
  SAMPLE_SIZE_PENALTY: 'SAMPLE_SIZE_PENALTY',
  FATIGUE_EDGE: 'FATIGUE_EDGE',
  PREDICTION_DISABLED: 'PREDICTION_DISABLED',
});

const DECISION_RANK = Object.freeze({
  STRONG_PICK: 5,
  LEAN: 4,
  HIGH_RISK_ONLY: 3,
  WAIT_FOR_LINEUP: 2,
  PASS: 1,
  INSUFFICIENT_DATA: 0,
});

/**
 * Parse "W-L" last5 string into win rate or null.
 * @param {string|undefined} last5
 * @returns {number|null}
 */
function parseLast5WinRate(last5) {
  if (!last5 || typeof last5 !== 'string') return null;
  const m = last5.trim().match(/^(\d+)-(\d+)$/);
  if (!m) return null;
  const wins = Number(m[1]);
  const losses = Number(m[2]);
  const total = wins + losses;
  if (total === 0) return null;
  return wins / total;
}

/**
 * Normalize intelligence-layer params into decide() shape.
 * @param {Object} params
 * @returns {Object}
 */
function normalizeDecideParams(params = {}) {
  const homeTeam = params.homeTeam;
  const awayTeam = params.awayTeam;
  const game = { ...(params.game || {}) };
  if (!game.homeKey && homeTeam?.key) game.homeKey = homeTeam.key;
  if (!game.awayKey && awayTeam?.key) game.awayKey = awayTeam.key;

  const modelProjection =
    params.modelProjection || modelProjectionFromPrediction(params.prediction);
  const injuries =
    params.injuries ||
    (params.homeRoster || params.awayRoster
      ? buildInjuriesFromRosters(params.homeRoster, params.awayRoster)
      : undefined);
  const lineup = params.lineup || deriveLineupState(params.homeRoster, params.awayRoster);
  const odds = params.odds || params.prediction?.odds || null;

  return {
    ...params,
    game,
    homeTeam,
    awayTeam,
    modelProjection,
    injuries,
    lineup,
    odds,
  };
}

/**
 * @param {string} decision
 * @param {number} edgeScore
 * @returns {'Low'|'Medium'|'High'|'Extreme'}
 */
function deriveRisk(decision, edgeScore) {
  if (decision === DECISION_TYPES.HIGH_RISK_ONLY) return 'High';
  if (decision === DECISION_TYPES.INSUFFICIENT_DATA) return 'Extreme';
  if (decision === DECISION_TYPES.WAIT_FOR_LINEUP) return 'Medium';
  if (edgeScore >= 72) return 'Low';
  if (edgeScore >= 55) return 'Medium';
  return 'High';
}

/**
 * @param {string} decision
 * @returns {string}
 */
function deriveAction(decision) {
  const map = {
    [DECISION_TYPES.STRONG_PICK]: 'Bet with standard unit sizing after line check.',
    [DECISION_TYPES.LEAN]: 'Small unit only — confirm lineups and injury news.',
    [DECISION_TYPES.PASS]: 'No bet — edge or data quality insufficient.',
    [DECISION_TYPES.WAIT_FOR_LINEUP]: 'Hold until starting lineups are official.',
    [DECISION_TYPES.INSUFFICIENT_DATA]: 'Do not wager — required inputs missing.',
    [DECISION_TYPES.HIGH_RISK_ONLY]: 'Reduced stake only — high variance matchup.',
  };
  return map[decision] || 'Review all signals before acting.';
}

/**
 * Compute 0–100 edge score from available signals (no invented odds).
 *
 * @param {Object} params
 * @returns {{ edgeScore: number, grade: string, reasonCodes: string[] }}
 */
function computeEdgeScore(params = {}) {
  const normalized = normalizeDecideParams(params);
  const reasonCodes = [];
  let raw = 0;
  let weightSum = 0;

  const home = normalized.homeTeam;
  const away = normalized.awayTeam;

  if (normalized.prediction?.enabled === false) {
    reasonCodes.push(REASON_CODES.PREDICTION_DISABLED);
  }

  if (home && away && typeof home.netRating === 'number' && typeof away.netRating === 'number') {
    const netDiff = Math.abs(home.netRating - away.netRating);
    const netComponent = Math.min(100, netDiff * 4);
    raw += netComponent * 0.35;
    weightSum += 0.35;
    if (netDiff >= 6) reasonCodes.push(REASON_CODES.NET_RATING_EDGE);
  }

  const proj = normalized.modelProjection;
  const derivedSpreadEdge =
    proj && typeof proj.spreadEdge === 'number'
      ? proj.spreadEdge
      : computeHomeSpreadEdge(proj?.projectedMargin, normalized.odds?.spread);

  if (typeof derivedSpreadEdge === 'number') {
    const spreadComponent = Math.min(100, Math.abs(derivedSpreadEdge) * 12);
    raw += spreadComponent * 0.3;
    weightSum += 0.3;
    reasonCodes.push(REASON_CODES.MODEL_SPREAD_EDGE);
  } else if (proj && typeof proj.winProb === 'number') {
    const probEdge = Math.abs(proj.winProb - 0.5) * 200;
    raw += Math.min(100, probEdge) * 0.25;
    weightSum += 0.25;
    reasonCodes.push(REASON_CODES.MODEL_WIN_PROB_EDGE);
  } else if (proj && typeof proj.projectedMargin === 'number') {
    const marginComponent = Math.min(100, Math.abs(proj.projectedMargin) * 8);
    raw += marginComponent * 0.2;
    weightSum += 0.2;
  }

  const homeForm = parseLast5WinRate(home?.last5);
  const awayForm = parseLast5WinRate(away?.last5);
  if (homeForm !== null && awayForm !== null) {
    const formDiff = Math.abs(homeForm - awayForm);
    raw += Math.min(100, formDiff * 200) * 0.15;
    weightSum += 0.15;
    if (formDiff >= 0.3) reasonCodes.push(REASON_CODES.RECENT_FORM_EDGE);
  }

  if (normalized.game?.homeKey || normalized.game?.home) {
    raw += 8 * 0.1;
    weightSum += 0.1;
    reasonCodes.push(REASON_CODES.HOME_COURT_ADVANTAGE);
  }

  const fatigue = normalized.fatigue;
  if (fatigue?.home?.fatiguePenalty > 0 || fatigue?.away?.fatiguePenalty > 0) {
    const fatigueDiff = Math.abs(
      (fatigue.home?.fatiguePenalty || 0) - (fatigue.away?.fatiguePenalty || 0)
    );
    if (fatigueDiff >= 1.5) {
      raw += Math.min(100, fatigueDiff * 15) * 0.05;
      weightSum += 0.05;
      reasonCodes.push(REASON_CODES.FATIGUE_EDGE);
    }
  }

  if (
    !normalized.odds ||
    (typeof normalized.odds.spread !== 'number' && typeof normalized.odds.total !== 'number')
  ) {
    reasonCodes.push(REASON_CODES.ODDS_MISSING_LIMITS_EDGE);
  }

  const injuries = normalized.injuries;
  const hasQuestionable =
    injuries &&
    [...(injuries.home || []), ...(injuries.away || [])].some(
      (p) =>
        p &&
        (p.status === 'questionable' ||
          p.status === 'doubtful' ||
          String(p.status).toLowerCase().includes('question') ||
          String(p.status).toLowerCase().includes('doubt'))
    );
  if (hasQuestionable) {
    raw *= 0.85;
    reasonCodes.push(REASON_CODES.KEY_INJURY_UNCERTAINTY);
  }

  if (normalized.dataQuality && !normalized.dataQuality.flags?.sampleSizeAdequate) {
    raw *= 0.9;
    reasonCodes.push(REASON_CODES.SAMPLE_SIZE_PENALTY);
  }

  let edgeScore = weightSum > 0 ? Math.round(raw / weightSum) : 0;
  edgeScore = Math.max(0, Math.min(100, edgeScore));

  if (edgeScore >= 72) reasonCodes.push(REASON_CODES.STRONG_COMPOSITE_EDGE);
  else if (edgeScore >= 55) reasonCodes.push(REASON_CODES.MODERATE_EDGE);
  else reasonCodes.push(REASON_CODES.NO_ACTIONABLE_EDGE);

  const paceDiff =
    home && away && typeof home.pace === 'number' && typeof away.pace === 'number'
      ? Math.abs(home.pace - away.pace)
      : 0;
  if (paceDiff > 4 && edgeScore >= 50) {
    reasonCodes.push(REASON_CODES.HIGH_VARIANCE_MATCHUP);
  }

  return {
    edgeScore,
    grade: scoreToGrade(edgeScore),
    reasonCodes: [...new Set(reasonCodes)],
  };
}

/**
 * Map edge + quality to decision with capped confidence.
 *
 * @param {Object} params
 * @returns {Object}
 */
function decide(params = {}) {
  const normalized = normalizeDecideParams(params);
  const dataQuality = normalized.dataQuality || {
    score: 0,
    confidenceCap: 40,
    grade: 'F',
    flags: {},
  };
  const flags = dataQuality.flags || {};
  const reasonCodes = [];

  if (!flags.hasHomeStats || !flags.hasAwayStats) {
    return {
      decision: DECISION_TYPES.INSUFFICIENT_DATA,
      edgeScore: 0,
      grade: 'F',
      confidence: 0,
      confidenceCap: dataQuality.confidenceCap ?? CONFIDENCE_CAPS.F,
      risk: deriveRisk(DECISION_TYPES.INSUFFICIENT_DATA, 0),
      action: deriveAction(DECISION_TYPES.INSUFFICIENT_DATA),
      reasonCodes: [REASON_CODES.INSUFFICIENT_TEAM_DATA],
    };
  }

  if (normalized.lineup?.confirmed === false && !flags.lineupConfirmed) {
    const edge = computeEdgeScore(normalized);
    const cap = dataQuality.confidenceCap ?? CONFIDENCE_CAPS.F;
    return {
      decision: DECISION_TYPES.WAIT_FOR_LINEUP,
      edgeScore: edge.edgeScore,
      grade: edge.grade,
      confidence: Math.min(cap, CONFIDENCE_CAPS.D, 35),
      confidenceCap: cap,
      risk: deriveRisk(DECISION_TYPES.WAIT_FOR_LINEUP, edge.edgeScore),
      action: deriveAction(DECISION_TYPES.WAIT_FOR_LINEUP),
      reasonCodes: [...new Set([...edge.reasonCodes, REASON_CODES.LINEUP_UNCONFIRMED_BLOCK])],
    };
  }

  const { edgeScore, grade, reasonCodes: edgeReasons } = computeEdgeScore(normalized);
  reasonCodes.push(...edgeReasons);

  const dqCap = dataQuality.confidenceCap ?? CONFIDENCE_CAPS[dataQuality.grade] ?? CONFIDENCE_CAPS.F;
  const edgeCap = CONFIDENCE_CAPS[grade] ?? CONFIDENCE_CAPS.F;
  const rawConfidence = Math.round(edgeScore * 0.6 + (dataQuality.score ?? 0) * 0.4);
  const confidence = Math.min(rawConfidence, dqCap, edgeCap);

  let decision;

  if (dataQuality.score < 45 || normalized.prediction?.enabled === false) {
    decision = DECISION_TYPES.INSUFFICIENT_DATA;
    if (normalized.prediction?.enabled === false) {
      reasonCodes.push(REASON_CODES.PREDICTION_DISABLED);
    }
  } else if (
    reasonCodes.includes(REASON_CODES.HIGH_VARIANCE_MATCHUP) &&
    edgeScore >= 55 &&
    edgeScore < 72
  ) {
    decision = DECISION_TYPES.HIGH_RISK_ONLY;
  } else if (edgeScore >= 72 && confidence >= 65) {
    decision = DECISION_TYPES.STRONG_PICK;
  } else if (edgeScore >= 55 && confidence >= 45) {
    decision = DECISION_TYPES.LEAN;
  } else {
    decision = DECISION_TYPES.PASS;
  }

  const finalConfidence =
    decision === DECISION_TYPES.INSUFFICIENT_DATA ? Math.min(confidence, 30) : confidence;

  return {
    decision,
    edgeScore,
    grade,
    confidence: finalConfidence,
    confidenceCap: dqCap,
    risk: deriveRisk(decision, edgeScore),
    action: deriveAction(decision),
    reasonCodes: [...new Set(reasonCodes)],
  };
}

module.exports = {
  DECISION_TYPES,
  REASON_CODES,
  DECISION_RANK,
  computeEdgeScore,
  decide,
  normalizeDecideParams,
  parseLast5WinRate,
  deriveRisk,
  deriveAction,
};
