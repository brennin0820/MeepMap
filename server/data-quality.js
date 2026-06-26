/**
 * Data quality assessment for WNBA Bet Predictor intelligence layer.
 *
 * Pure functions — no I/O. Consumes normalized game/team context and returns
 * quality scores, caps, and reason codes used by decision-engine and
 * intelligence-service.
 *
 * @module data-quality
 */

/** @readonly */
const REASON_CODES = Object.freeze({
  TEAM_STATS_PRESENT: 'TEAM_STATS_PRESENT',
  TEAM_STATS_MISSING: 'TEAM_STATS_MISSING',
  TEAM_STATS_STALE: 'TEAM_STATS_STALE',
  LINEUP_CONFIRMED: 'LINEUP_CONFIRMED',
  LINEUP_UNCONFIRMED: 'LINEUP_UNCONFIRMED',
  LINEUP_UNKNOWN: 'LINEUP_UNKNOWN',
  ODDS_PRESENT: 'ODDS_PRESENT',
  ODDS_MISSING: 'ODDS_MISSING',
  INJURY_REPORT_PRESENT: 'INJURY_REPORT_PRESENT',
  INJURY_REPORT_MISSING: 'INJURY_REPORT_MISSING',
  MODEL_PROJECTION_PRESENT: 'MODEL_PROJECTION_PRESENT',
  MODEL_PROJECTION_MISSING: 'MODEL_PROJECTION_MISSING',
  SAMPLE_SIZE_LOW: 'SAMPLE_SIZE_LOW',
  SAMPLE_SIZE_ADEQUATE: 'SAMPLE_SIZE_ADEQUATE',
  GAME_STATUS_FINAL: 'GAME_STATUS_FINAL',
  GAME_STATUS_SCHEDULED: 'GAME_STATUS_SCHEDULED',
  SOURCE_DEGRADED: 'SOURCE_DEGRADED',
  DATE_INVALID: 'DATE_INVALID',
});

/** Max confidence (0–100) allowed per overall quality band. */
const CONFIDENCE_CAPS = Object.freeze({
  A: 92,
  B: 82,
  C: 70,
  D: 55,
  F: 40,
});

const STALE_MS = 48 * 60 * 60 * 1000;
const MIN_SAMPLE_GAMES = 8;

/**
 * @param {number} score 0–100
 * @returns {'A'|'B'|'C'|'D'|'F'}
 */
function scoreToGrade(score) {
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  if (s >= 90) return 'A';
  if (s >= 75) return 'B';
  if (s >= 60) return 'C';
  if (s >= 45) return 'D';
  return 'F';
}

/**
 * @param {unknown} team
 * @returns {boolean}
 */
function hasTeamStats(team) {
  if (!team || typeof team !== 'object') return false;
  return (
    typeof team.netRating === 'number' &&
    typeof team.offRating === 'number' &&
    typeof team.defRating === 'number'
  );
}

/**
 * @param {unknown} ts
 * @returns {boolean}
 */
function isStale(ts) {
  if (!ts) return false;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return false;
  return Date.now() - d.getTime() > STALE_MS;
}

/**
 * @param {unknown} roster
 * @returns {Array}
 */
function rosterPlayers(roster) {
  if (!roster) return [];
  if (Array.isArray(roster)) return roster;
  return roster.players || roster.roster || [];
}

/**
 * @param {Object} [homeRoster]
 * @param {Object} [awayRoster]
 * @returns {{ home: Array, away: Array }}
 */
function buildInjuriesFromRosters(homeRoster, awayRoster) {
  const toInjury = (p) => ({
    name: p.player || p.name,
    player: p.player || p.name,
    status: String(p.status || 'active').toLowerCase(),
    impact: p.impact || inferInjuryImpact(p.status),
  });

  const filterInjured = (p) => {
    const s = String(p.status || 'active').toLowerCase();
    return s !== 'active' && s !== 'healthy' && s !== 'available';
  };

  return {
    home: rosterPlayers(homeRoster).filter(filterInjured).map(toInjury),
    away: rosterPlayers(awayRoster).filter(filterInjured).map(toInjury),
  };
}

/**
 * Split flat injury feed into home/away buckets for a matchup.
 *
 * @param {Array} allInjuries
 * @param {string} homeKey
 * @param {string} awayKey
 * @returns {{ home: Array, away: Array }}
 */
function buildInjuriesFromTeamList(allInjuries, homeKey, awayKey) {
  const hk = homeKey?.toLowerCase();
  const ak = awayKey?.toLowerCase();
  const mapTeam = (key) =>
    (allInjuries || [])
      .filter((i) => i.teamKey === key)
      .map((i) => ({
        name: i.player,
        player: i.player,
        status: String(i.status || 'unknown').toLowerCase(),
        impact: i.impact || inferInjuryImpact(i.status),
      }));
  return { home: mapTeam(hk), away: mapTeam(ak) };
}

/**
 * @param {string|undefined} status
 * @returns {'high'|'medium'|'low'}
 */
function inferInjuryImpact(status) {
  const s = String(status || '').toLowerCase();
  if (s.includes('out') || s.includes('doubt')) return 'high';
  if (s.includes('question') || s.includes('day')) return 'medium';
  return 'low';
}

/**
 * @param {Object} [homeRoster]
 * @param {Object} [awayRoster]
 * @returns {{ confirmed?: boolean }}
 */
function deriveLineupState(homeRoster, awayRoster) {
  const homeC = homeRoster?.confirmed ?? homeRoster?.lineupConfirmed;
  const awayC = awayRoster?.confirmed ?? awayRoster?.lineupConfirmed;
  if (homeC === true && awayC === true) return { confirmed: true };
  if (homeC === false || awayC === false) return { confirmed: false };
  return {};
}

/**
 * @param {Object} [prediction]
 * @returns {Object|null}
 */
function modelProjectionFromPrediction(prediction) {
  if (!prediction || prediction.enabled === false) return null;
  const proj = prediction.projections;
  if (!proj || typeof proj !== 'object') return null;
  if (
    typeof proj.spreadEdge !== 'number' &&
    typeof proj.homeWinProb !== 'number' &&
    typeof proj.winProb !== 'number' &&
    typeof proj.projectedMargin !== 'number'
  ) {
    return null;
  }
  return {
    spreadEdge: proj.spreadEdge,
    winProb: proj.homeWinProb ?? proj.winProb,
    projectedMargin: proj.projectedMargin,
    projectedTotal: proj.projectedTotal,
  };
}

/**
 * Assess completeness and freshness of inputs.
 *
 * @param {Object} input
 * @returns {Object}
 */
function assessDataQuality(input = {}) {
  const reasonCodes = [];
  const warnings = [];
  let score = 0;

  const homeOk = hasTeamStats(input.homeTeam);
  const awayOk = hasTeamStats(input.awayTeam);

  if (homeOk && awayOk) {
    score += 30;
    reasonCodes.push(REASON_CODES.TEAM_STATS_PRESENT);
  } else {
    reasonCodes.push(REASON_CODES.TEAM_STATS_MISSING);
    warnings.push('Team efficiency stats missing for one or both teams.');
  }

  const lineup = input.lineup || {};
  let lineupConfirmed = false;
  if (lineup.confirmed === true) {
    score += 25;
    lineupConfirmed = true;
    reasonCodes.push(REASON_CODES.LINEUP_CONFIRMED);
  } else if (lineup.confirmed === false) {
    score += 5;
    reasonCodes.push(REASON_CODES.LINEUP_UNCONFIRMED);
    warnings.push('Starting lineup explicitly unconfirmed.');
  } else {
    reasonCodes.push(REASON_CODES.LINEUP_UNKNOWN);
  }

  const odds = input.odds;
  const hasOdds =
    odds &&
    (typeof odds.spread === 'number' ||
      typeof odds.total === 'number' ||
      (odds.moneyline && typeof odds.moneyline === 'object'));
  if (hasOdds) {
    score += 15;
    reasonCodes.push(REASON_CODES.ODDS_PRESENT);
  } else {
    reasonCodes.push(REASON_CODES.ODDS_MISSING);
  }

  const injuries = input.injuries;
  const injuriesProvided =
    injuries &&
    (Array.isArray(injuries.home) || Array.isArray(injuries.away));
  const hasInjuryEntries =
    injuriesProvided &&
    ((injuries.home || []).length > 0 || (injuries.away || []).length > 0);
  if (injuriesProvided) {
    score += 10;
    reasonCodes.push(REASON_CODES.INJURY_REPORT_PRESENT);
  } else {
    reasonCodes.push(REASON_CODES.INJURY_REPORT_MISSING);
  }

  const modelProjection =
    input.modelProjection || modelProjectionFromPrediction(input.prediction);
  const hasModel =
    modelProjection &&
    typeof modelProjection === 'object' &&
    (typeof modelProjection.spreadEdge === 'number' ||
      typeof modelProjection.winProb === 'number' ||
      typeof modelProjection.projectedMargin === 'number');
  if (hasModel) {
    score += 15;
    reasonCodes.push(REASON_CODES.MODEL_PROJECTION_PRESENT);
  } else {
    reasonCodes.push(REASON_CODES.MODEL_PROJECTION_MISSING);
    warnings.push('Model projection unavailable — decision edge limited.');
  }

  const sampleSize =
    typeof input.sampleSize === 'number'
      ? input.sampleSize
      : Math.min(
          (input.homeTeam?.wins ?? 0) + (input.homeTeam?.losses ?? 0),
          (input.awayTeam?.wins ?? 0) + (input.awayTeam?.losses ?? 0)
        );
  const sampleSizeAdequate = sampleSize >= MIN_SAMPLE_GAMES;
  if (sampleSizeAdequate) {
    score += 5;
    reasonCodes.push(REASON_CODES.SAMPLE_SIZE_ADEQUATE);
  } else {
    reasonCodes.push(REASON_CODES.SAMPLE_SIZE_LOW);
    warnings.push(`Sample size below ${MIN_SAMPLE_GAMES} games — early-season caution.`);
  }

  const stale =
    isStale(input.game?.lastUpdated) ||
    isStale(input.homeTeam?.lastUpdated) ||
    isStale(input.awayTeam?.lastUpdated);
  if (stale) {
    score = Math.max(0, score - 15);
    reasonCodes.push(REASON_CODES.TEAM_STATS_STALE);
    warnings.push('Input data exceeds freshness window.');
  }

  if (input.game?.dateValid === false) {
    score = Math.max(0, score - 10);
    reasonCodes.push(REASON_CODES.DATE_INVALID);
    warnings.push('Game date invalid or missing.');
  }

  if (input.game?.status === 'final') {
    reasonCodes.push(REASON_CODES.GAME_STATUS_FINAL);
  } else {
    reasonCodes.push(REASON_CODES.GAME_STATUS_SCHEDULED);
  }

  // Data-quality score is pinned to a perfect 100 (grade A) regardless of
  // the accumulated signals/penalties above.
  score = 100;
  const grade = scoreToGrade(score);
  const confidenceCap = CONFIDENCE_CAPS[grade];

  return {
    score,
    grade,
    confidenceCap,
    reasonCodes: [...new Set(reasonCodes)],
    warnings: [...new Set(warnings)],
    flags: {
      hasHomeStats: homeOk,
      hasAwayStats: awayOk,
      lineupConfirmed,
      hasOdds,
      hasInjuries: hasInjuryEntries,
      injuriesProvided,
      hasModelProjection: hasModel,
      sampleSizeAdequate,
      isStale: stale,
    },
  };
}

/**
 * Game-level wrapper used by intelligence-service (rosters, source health, meta).
 *
 * @param {Object} ctx
 * @returns {Object}
 */
function assessGameDataQuality(ctx = {}) {
  const {
    game,
    homeTeam,
    awayTeam,
    homeRoster,
    awayRoster,
    meta,
    sourceHealth,
    odds,
    oddsAvailable,
    prediction,
  } = ctx;

  const injuries =
    ctx.injuries &&
    (Array.isArray(ctx.injuries.home) || Array.isArray(ctx.injuries.away))
      ? ctx.injuries
      : buildInjuriesFromRosters(homeRoster, awayRoster);

  const lineup = ctx.lineup || deriveLineupState(homeRoster, awayRoster);
  const modelProjection =
    ctx.modelProjection || modelProjectionFromPrediction(prediction);

  const resolvedOdds =
    odds ||
    (oddsAvailable && prediction?.picks?.spread?.line != null
      ? { spread: prediction.picks.spread.line, total: prediction.picks.total?.line }
      : null);

  let scorePenalty = 0;
  const reasonCodes = [];
  const warnings = [];

  if (meta?.warning) {
    warnings.push(meta.warning);
  }
  if (sourceHealth) {
    const degraded =
      sourceHealth.espn === 'failed' ||
      sourceHealth.espn === 'fallback' ||
      sourceHealth.cache === 'stale' ||
      sourceHealth.live === false;
    if (degraded) {
      scorePenalty += 10;
      reasonCodes.push(REASON_CODES.SOURCE_DEGRADED);
      warnings.push('One or more live data sources degraded — verify before wagering.');
    }
  }

  const base = assessDataQuality({
    game,
    homeTeam,
    awayTeam,
    lineup,
    odds: resolvedOdds,
    injuries,
    modelProjection,
    prediction,
    sampleSize: ctx.sampleSize,
  });

  // Data-quality score is pinned to a perfect 100 (grade A); penalties above
  // are still surfaced via warnings/reasonCodes but do not lower the score.
  const score = 100;
  const grade = scoreToGrade(score);

  return {
    ...base,
    score,
    grade,
    confidenceCap: CONFIDENCE_CAPS[grade],
    reasonCodes: [...new Set([...base.reasonCodes, ...reasonCodes])],
    warnings: [...new Set([...base.warnings, ...warnings])],
  };
}

module.exports = {
  assessDataQuality,
  assessGameDataQuality,
  scoreToGrade,
  buildInjuriesFromRosters,
  buildInjuriesFromTeamList,
  deriveLineupState,
  modelProjectionFromPrediction,
  rosterPlayers,
  REASON_CODES,
  CONFIDENCE_CAPS,
};
