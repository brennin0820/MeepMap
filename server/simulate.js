'use strict';

const predictor = require('./predictor');
const dataFetcher = require('./data-fetcher');

function scoringStdDev(team) {
  if (!team || typeof team.ppg !== 'number' || typeof team.oppPpg !== 'number') return 8;
  const volatility = Math.abs(team.ppg - team.oppPpg);
  return Math.max(5, Math.min(14, volatility * 0.45 + 4));
}

function randomNormal(mean, stdDev) {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + z * stdDev;
}

async function runSimulation({ homeTeamKey, awayTeamKey, date, iterations = 5000 }) {
  const hKey = homeTeamKey?.toLowerCase();
  const aKey = awayTeamKey?.toLowerCase();
  const teamsResult = await dataFetcher.getTeams();
  const homeTeam = teamsResult.teams.find((t) => t.key === hKey);
  const awayTeam = teamsResult.teams.find((t) => t.key === aKey);

  if (!homeTeam || !awayTeam) {
    return { error: 'Unknown team key(s)' };
  }

  const base = await predictor.predictMatchup({
    homeTeamKey: hKey,
    awayTeamKey: aKey,
    date: date || new Date().toISOString(),
    teams: teamsResult.teams,
  });

  if (!base.enabled) {
    return { error: base.disabledReason || 'Prediction disabled' };
  }

  const homeMean = base.projections.homeScore;
  const awayMean = base.projections.awayScore;
  const homeStd = scoringStdDev(homeTeam);
  const awayStd = scoringStdDev(awayTeam);
  const n = Math.min(Math.max(iterations, 1000), 10000);

  let homeWins = 0;
  let totalSum = 0;
  let marginSum = 0;
  const marginBuckets = { blowout: 0, close: 0 };

  for (let i = 0; i < n; i++) {
    const hs = Math.max(65, randomNormal(homeMean, homeStd));
    const as = Math.max(65, randomNormal(awayMean, awayStd));
    if (hs > as) homeWins++;
    const margin = hs - as;
    marginSum += margin;
    totalSum += hs + as;
    if (Math.abs(margin) >= 10) marginBuckets.blowout++;
    else marginBuckets.close++;
  }

  return {
    iterations: n,
    homeTeam: { key: hKey, name: homeTeam.name },
    awayTeam: { key: aKey, name: awayTeam.name },
    baseline: {
      homeScore: homeMean,
      awayScore: awayMean,
      margin: base.margin,
      total: base.total,
      homeWinProb: base.winProb?.home,
    },
    simulation: {
      homeWinPct: Math.round((homeWins / n) * 1000) / 10,
      avgMargin: Math.round((marginSum / n) * 10) / 10,
      avgTotal: Math.round((totalSum / n) * 10) / 10,
      blowoutPct: Math.round((marginBuckets.blowout / n) * 1000) / 10,
      closePct: Math.round((marginBuckets.close / n) * 1000) / 10,
    },
    varianceSource: {
      homeStdDev: Math.round(homeStd * 10) / 10,
      awayStdDev: Math.round(awayStd * 10) / 10,
      note: 'Std dev derived from each team verified PPG vs Opp PPG — not market odds.',
    },
    modelVersion: base.modelVersion,
  };
}

module.exports = { runSimulation };
