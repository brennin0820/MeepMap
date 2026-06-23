'use strict';

/**
 * Compute edge for a home-team spread line.
 *
 * projectedMargin is home score minus away score. marketSpread is the home
 * team's handicap, so -3.5 means home must win by more than 3.5 and +3.5
 * means home can lose by fewer than 3.5.
 */
function computeHomeSpreadEdge(projectedMargin, marketSpread) {
  if (typeof projectedMargin !== 'number' || typeof marketSpread !== 'number') {
    return null;
  }
  return +(projectedMargin + marketSpread).toFixed(1);
}

module.exports = {
  computeHomeSpreadEdge,
};
