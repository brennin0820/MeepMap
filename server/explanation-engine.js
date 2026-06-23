'use strict';

const BANNED = /\b(lock|guaranteed|free money|sure win|100%|must bet)\b/i;

function sanitize(text) {
  if (!text) return '';
  return String(text).replace(BANNED, '[removed]');
}

function formatDecision(d) {
  const map = {
    STRONG_PICK: 'Strong Pick',
    LEAN: 'Lean',
    PASS: 'Pass',
    WAIT_FOR_LINEUP: 'Wait for Lineup',
    INSUFFICIENT_DATA: 'Insufficient Data',
    HIGH_RISK_ONLY: 'High Risk Only',
  };
  return map[d] || d || 'Pass';
}

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

function explain(ctx = {}) {
  const { game, homeTeam, awayTeam, prediction, decision, dataQuality, odds, insights } = ctx;
  const decisionType =
    typeof decision === 'string' ? decision : decision?.decision;
  const pros = [];
  const cons = [];

  if (homeTeam && awayTeam && typeof homeTeam.netRating === 'number' && typeof awayTeam.netRating === 'number') {
    const diff = homeTeam.netRating - awayTeam.netRating;
    const favored = diff >= 0 ? homeTeam.name : awayTeam.name;
    if (Math.abs(diff) >= 4) {
      pros.push(`${favored} holds a ${Math.abs(diff).toFixed(1)} net-rating edge`);
    }
  }

  if (homeTeam?.last5 && awayTeam?.last5) {
    pros.push(
      `Recent form: ${homeTeam.name || 'Home'} ${homeTeam.last5}, ${awayTeam.name || 'Away'} ${awayTeam.last5}`
    );
  }

  const homeWinProb =
    prediction?.projections?.homeWinProb ??
    prediction?.projections?.winProb ??
    prediction?.winProb?.home;
  if (typeof homeWinProb === 'number') {
    const fav = homeWinProb >= 0.5 ? homeTeam?.name : awayTeam?.name;
    if (fav) {
      pros.push(`Model win probability favors ${fav} (${Math.round(homeWinProb >= 0.5 ? homeWinProb * 100 : (1 - homeWinProb) * 100)}%)`);
    }
  }

  if (!odds?.spread && !odds?.total) {
    cons.push('Market lines unavailable — edge based on model only');
  }

  if (dataQuality && !dataQuality.flags?.lineupConfirmed) {
    cons.push('Lineup not confirmed');
  }

  if (dataQuality && dataQuality.score < 60) {
    cons.push('Data quality below recommended threshold');
  }

  if (prediction?.enabled === false) {
    cons.push(prediction.disabledReason || 'Prediction disabled for this matchup');
  }

  for (const ins of insights || []) {
    if (ins.tone === 'strength') pros.push(ins.detail || ins.title || ins.message);
    if (ins.tone === 'weakness' || ins.tone === 'watch') {
      cons.push(ins.detail || ins.title || ins.message);
    }
  }

  const favorite =
    (homeWinProb ?? 0.5) >= 0.5 ? homeTeam?.name : awayTeam?.name;
  const decisionLabel = formatDecision(decisionType);

  const shortSummary = sanitize(
    `${favorite || 'This matchup'} is a ${decisionLabel.toLowerCase()} because ${
      pros.slice(0, 2).join(' and ') || 'model signals are mixed'
    }${cons.length ? `, but ${cons[0].toLowerCase()}` : ''}.`
  );

  let finalAdvice = 'Review all warnings before acting.';
  switch (decisionType) {
    case 'STRONG_PICK':
      finalAdvice = 'Strong pick based on verified data. Still use disciplined unit sizing.';
      break;
    case 'LEAN':
      finalAdvice = dataQuality?.flags?.lineupConfirmed
        ? 'Lean play — use reduced units and monitor line movement.'
        : 'Lean only. Wait for lineup confirmation before trusting this pick.';
      break;
    case 'PASS':
      finalAdvice = 'Pass — edge is too weak or risk is too high.';
      break;
    case 'WAIT_FOR_LINEUP':
      finalAdvice = 'Wait for confirmed starters and injury updates.';
      break;
    case 'INSUFFICIENT_DATA':
      finalAdvice = 'Do not bet — insufficient verified data.';
      break;
    case 'HIGH_RISK_ONLY':
      finalAdvice = 'High risk only. Proceed with minimal units if at all.';
      break;
    default:
      break;
  }

  const humanReasons = [...new Set(pros)].slice(0, 5);

  return {
    shortSummary,
    summary: shortSummary,
    humanReasons,
    bullets: [...new Set([...pros, ...cons.map((c) => `Caution: ${c}`)])].map(sanitize),
    pros: [...new Set(pros)].map(sanitize),
    cons: [...new Set(cons)].map(sanitize),
    finalAdvice: sanitize(finalAdvice),
  };
}

module.exports = { explain, sanitize, formatDecision, parseLast5WinRate };
