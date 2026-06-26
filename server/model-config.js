'use strict';

/** Frozen production model — v1.6.0 (aligned with iOS LocalPredictor). */
const MODEL_VERSION = 'v1.6.0';
const MODEL_STATUS = 'finalized';
const MODEL_FINALIZED_AT = '2026-06-25';

const HOME_COURT_ADV = 2.5;
const B2B_PENALTY = 3.0;
const THREE_IN_FOUR_PENALTY = 1.5;
const INJURY_CAP = 6.0;
const INJURY_SCALE = 0.35;
const LEAGUE_AVERAGE_PACE = 96.0;
const LEAGUE_AVERAGE_POINTS = 82.0;
const LOGISTIC_MARGIN_DIVISOR = 6.4;
const SIM_MARGIN_STDDEV = 8.5;

const SCORE_MIN = 64;
const SCORE_MAX = 112;

const OFFENSE_WEIGHT = 0.58;
const DEFENSE_WEIGHT = 0.42;

const VENUE_HOME_MULT = 1.2;
const VENUE_AWAY_MULT = 0.6;
const FORM_MULT = 1.4;
const MARGIN_DIFF_CAP = 15.0;
const MARGIN_ADJ_CAP = 1.8;
const MARGIN_ADJ_RATE = 0.08;
const WIN_RATE_DIFF_CAP = 1.0;

function modelInfo() {
  return {
    modelVersion: MODEL_VERSION,
    modelStatus: MODEL_STATUS,
    modelFinalizedAt: MODEL_FINALIZED_AT,
    predictionEngine: 'rule-based',
  };
}

module.exports = {
  MODEL_VERSION,
  MODEL_STATUS,
  MODEL_FINALIZED_AT,
  HOME_COURT_ADV,
  B2B_PENALTY,
  THREE_IN_FOUR_PENALTY,
  INJURY_CAP,
  INJURY_SCALE,
  LEAGUE_AVERAGE_PACE,
  LEAGUE_AVERAGE_POINTS,
  LOGISTIC_MARGIN_DIVISOR,
  SIM_MARGIN_STDDEV,
  SCORE_MIN,
  SCORE_MAX,
  OFFENSE_WEIGHT,
  DEFENSE_WEIGHT,
  VENUE_HOME_MULT,
  VENUE_AWAY_MULT,
  FORM_MULT,
  MARGIN_DIFF_CAP,
  MARGIN_ADJ_CAP,
  MARGIN_ADJ_RATE,
  WIN_RATE_DIFF_CAP,
  modelInfo,
};
