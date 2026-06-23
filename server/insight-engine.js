/**
 * Insight generation — contextual bullets derived from team/model/quality signals.
 *
 * Pure functions. Insights cite only data present in input; no fabricated lines.
 *
 * @module insight-engine
 */

const { rosterPlayers } = require('./data-quality');

/**
 * @typedef {Object} Insight
 * @property {string} id
 * @property {string} [type]
 * @property {string} [severity]
 * @property {string} [message]
 * @property {'strength'|'weakness'|'neutral'|'watch'} tone
 * @property {string} title
 * @property {string} detail
 * @property {number} priority 1 (highest) – 5
 */

/**
 * @param {Insight} insight
 * @returns {Insight}
 */
function withChipFields(insight) {
  const severityMap = {
    strength: 'Info',
    weakness: 'Medium',
    watch: 'Low',
    neutral: 'Info',
  };
  return {
    ...insight,
    type: insight.type || insight.id?.replace(/-/g, '_').toUpperCase(),
    severity: insight.severity || severityMap[insight.tone] || 'Info',
    message: insight.message || insight.detail || insight.title,
  };
}

/**
 * @param {Object} input
 * @returns {Insight[]}
 */
function buildInsights(input = {}) {
  /** @type {Insight[]} */
  const insights = [];
  const home = input.homeTeam;
  const away = input.awayTeam;
  const decision = input.decision;
  const decisionType =
    typeof decision === 'string' ? decision : decision?.decision;

  if (home && away && typeof home.netRating === 'number' && typeof away.netRating === 'number') {
    const diff = home.netRating - away.netRating;
    const favored = diff >= 0 ? home.name || 'Home' : away.name || 'Away';
    insights.push(
      withChipFields({
        id: 'net-rating',
        type: 'NET_RATING',
        tone: Math.abs(diff) >= 6 ? 'strength' : 'neutral',
        title: 'Net rating gap',
        detail: `${favored} holds a ${Math.abs(diff).toFixed(1)} net-rating edge (${home.netRating.toFixed(1)} vs ${away.netRating.toFixed(1)}).`,
        priority: Math.abs(diff) >= 6 ? 1 : 3,
      })
    );
  }

  if (home?.last5 && away?.last5) {
    insights.push(
      withChipFields({
        id: 'recent-form',
        type: 'RECENT_FORM',
        tone: 'neutral',
        title: 'Last 5 games',
        detail: `${home.name || 'Home'} ${home.last5}, ${away.name || 'Away'} ${away.last5}.`,
        priority: 2,
      })
    );
  }

  if (home?.homeRecord && input.game?.homeKey) {
    insights.push(
      withChipFields({
        id: 'home-record',
        type: 'HOME_RECORD',
        tone: 'neutral',
        title: 'Home floor',
        detail: `${home.name || 'Home'} is ${home.homeRecord} at home this season.`,
        priority: 3,
      })
    );
  }

  if (away?.awayRecord) {
    insights.push(
      withChipFields({
        id: 'away-record',
        type: 'AWAY_RECORD',
        tone: 'neutral',
        title: 'Road profile',
        detail: `${away.name || 'Away'} is ${away.awayRecord} on the road.`,
        priority: 3,
      })
    );
  }

  const proj = input.modelProjection || input.prediction?.projections;
  if (proj && typeof proj.projectedMargin === 'number') {
    const side = proj.projectedMargin >= 0 ? home?.name || 'Home' : away?.name || 'Away';
    insights.push(
      withChipFields({
        id: 'model-margin',
        type: 'MODEL_MARGIN',
        tone: Math.abs(proj.projectedMargin) >= 4 ? 'strength' : 'neutral',
        title: 'Model margin',
        detail: `Model projects ${side} by ${Math.abs(proj.projectedMargin).toFixed(1)} points.`,
        priority: 1,
      })
    );
  }

  if (proj && typeof proj.spreadEdge === 'number' && input.odds && typeof input.odds.spread === 'number') {
    insights.push(
      withChipFields({
        id: 'spread-edge',
        type: 'SPREAD_EDGE',
        tone: Math.abs(proj.spreadEdge) >= 2 ? 'strength' : 'neutral',
        title: 'Spread vs model',
        detail: `Model spread edge ${proj.spreadEdge > 0 ? '+' : ''}${proj.spreadEdge.toFixed(1)} vs market ${input.odds.spread}.`,
        priority: 1,
      })
    );
  } else if (!input.odds?.spread && proj?.spreadEdge != null) {
    insights.push(
      withChipFields({
        id: 'no-market-line',
        type: 'NO_MARKET_LINE',
        tone: 'watch',
        title: 'Market line unavailable',
        detail: 'Spread edge computed internally; no live line attached for comparison.',
        priority: 2,
      })
    );
  }

  const fatigue = input.fatigue;
  if (fatigue?.home?.notes?.length || fatigue?.away?.notes?.length) {
    const notes = [
      ...(fatigue.home?.notes || []).map((n) => `${home?.name || 'Home'}: ${n}`),
      ...(fatigue.away?.notes || []).map((n) => `${away?.name || 'Away'}: ${n}`),
    ];
    insights.push(
      withChipFields({
        id: 'fatigue',
        type: 'FATIGUE',
        tone: 'watch',
        title: 'Schedule fatigue',
        detail: notes.join('; '),
        priority: 2,
      })
    );
  }

  const homeInjured = rosterPlayers(input.homeRoster).filter(
    (p) => p.status && !['active', 'healthy', 'available'].includes(String(p.status).toLowerCase())
  );
  const awayInjured = rosterPlayers(input.awayRoster).filter(
    (p) => p.status && !['active', 'healthy', 'available'].includes(String(p.status).toLowerCase())
  );
  if (homeInjured.length || awayInjured.length) {
    const highImpact = [...homeInjured, ...awayInjured].filter((p) =>
      String(p.status).toLowerCase().includes('out')
    );
    insights.push(
      withChipFields({
        id: 'roster-injuries',
        type: highImpact.length ? 'ROSTER_RISK' : 'INJURY_ADVANTAGE',
        severity: highImpact.length ? 'High' : 'Medium',
        tone: highImpact.length ? 'weakness' : 'watch',
        title: 'Injury report',
        detail: `${homeInjured.length} home and ${awayInjured.length} away players listed with non-active status.`,
        priority: highImpact.length ? 1 : 2,
      })
    );
  }

  const dq = input.dataQuality;
  if (dq && !dq.flags?.lineupConfirmed) {
    insights.push(
      withChipFields({
        id: 'lineup-pending',
        type: 'LINEUP_PENDING',
        tone: 'watch',
        title: 'Lineup not confirmed',
        detail: 'Rotation uncertainty may shift efficiency and pace assumptions.',
        priority: 1,
      })
    );
  }

  if (dq && dq.flags?.isStale) {
    insights.push(
      withChipFields({
        id: 'stale-data',
        type: 'STALE_DATA',
        tone: 'weakness',
        title: 'Stale inputs',
        detail: 'Team or game timestamps exceed freshness threshold; re-fetch before locking.',
        priority: 1,
      })
    );
  }

  if (decisionType === 'HIGH_RISK_ONLY') {
    insights.push(
      withChipFields({
        id: 'high-variance',
        type: 'HIGH_VARIANCE',
        tone: 'weakness',
        title: 'High-variance spot',
        detail: 'Pace or matchup volatility elevates blowout/collapse risk — size accordingly.',
        priority: 1,
      })
    );
  }

  return insights.sort((a, b) => a.priority - b.priority);
}

module.exports = {
  buildInsights,
  withChipFields,
};
