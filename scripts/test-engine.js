'use strict';

const assert = require('assert');
const { computeHomeSpreadEdge } = require('../server/edge-math');
const { computeEdgeScore } = require('../server/decision-engine');
const { pickMatches, normalizePickText } = require('../server/prediction-history');
const { toIntelligencePrediction } = require('../server/predictor');

function baseInput(marketSpread, projectedMargin) {
  return {
    game: { homeKey: 'las', awayKey: 'min' },
    homeTeam: {
      key: 'las',
      name: 'Las Vegas Aces',
      netRating: 8,
      offRating: 108,
      defRating: 100,
      last5: '4-1',
      pace: 78,
    },
    awayTeam: {
      key: 'min',
      name: 'Minnesota Lynx',
      netRating: 3,
      offRating: 104,
      defRating: 101,
      last5: '3-2',
      pace: 77,
    },
    modelProjection: {
      projectedMargin,
      winProb: 0.62,
    },
    odds: { spread: marketSpread },
    dataQuality: {
      score: 80,
      confidenceCap: 82,
      grade: 'B',
      flags: {
        hasHomeStats: true,
        hasAwayStats: true,
        sampleSizeAdequate: true,
      },
    },
  };
}

assert.strictEqual(computeHomeSpreadEdge(5, -3.5), 1.5);
assert.strictEqual(computeHomeSpreadEdge(1, 3.5), 4.5);
assert.strictEqual(computeHomeSpreadEdge(-2, 3.5), 1.5);
assert.strictEqual(computeHomeSpreadEdge(-5, 3.5), -1.5);
assert.strictEqual(computeHomeSpreadEdge(5, null), null);

const favoriteEdge = computeEdgeScore(baseInput(-3.5, 5));
assert(favoriteEdge.reasonCodes.includes('MODEL_SPREAD_EDGE'));

const underdogEdge = computeEdgeScore(baseInput(3.5, 1));
assert(underdogEdge.reasonCodes.includes('MODEL_SPREAD_EDGE'));
assert(
  underdogEdge.edgeScore >= favoriteEdge.edgeScore,
  'home underdog cover edge should be at least as strong in this fixture'
);

assert.strictEqual(normalizePickText('Minnesota Lynx ML'), 'minnesota lynx');
assert(pickMatches('Minnesota Lynx ML', { key: 'min', name: 'Minnesota Lynx' }));
assert(pickMatches('Las Vegas Aces', { key: 'las', name: 'Las Vegas Aces' }));
assert(!pickMatches('Minnesota Lynx ML', { key: 'las', name: 'Las Vegas Aces' }));

const noOddsProjection = toIntelligencePrediction(
  {
    enabled: true,
    projections: { homeScore: 85, awayScore: 80 },
    winProb: { home: 0.62, away: 0.38 },
    margin: 5,
    total: 165,
  },
  { name: 'Las Vegas Aces' },
  { name: 'Minnesota Lynx' },
  null
);
assert.strictEqual(noOddsProjection.projections.spreadEdge, null);

console.log('Engine tests passed');
