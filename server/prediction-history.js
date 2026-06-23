const fs = require('fs');
const path = require('path');
const MODEL_VERSION = 'v1.5.0';

const HISTORY_PATH = path.join(__dirname, '..', 'data', 'prediction-history.json');

function loadHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
  } catch {
    return { predictions: [], modelVersion: MODEL_VERSION };
  }
}

function saveHistory(data) {
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(data, null, 2));
}

function recordPrediction(entry) {
  const history = loadHistory();
  const record = {
    id: `${entry.game?.id || entry.game?.home}-${entry.game?.date}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    game: entry.game,
    projectedWinner: entry.projectedWinner,
    projectedScore: entry.projectedScore,
    moneylinePick: entry.moneylinePick,
    spreadPick: entry.spreadPick,
    totalPick: entry.totalPick,
    confidence: entry.confidence,
    risk: entry.risk,
    dataQuality: entry.dataQuality,
    reasonCodes: entry.reasonCodes || [],
    modelVersion: MODEL_VERSION,
    decision: entry.decision,
    edgeScore: entry.edgeScore,
    result: null,
    finalScore: null,
    wasCorrect: null,
    marginError: null,
    totalError: null,
    dataIssueNotes: null
  };
  const exists = history.predictions.find(
    (p) => p.game?.id === entry.game?.id && p.game?.date === entry.game?.date && !p.result
  );
  if (!exists) history.predictions.push(record);
  saveHistory(history);
  return record;
}

function updateResult(gameId, gameDate, finalScore) {
  const history = loadHistory();
  const pred = history.predictions.find(
    (p) => (p.game?.id === gameId || `${p.game?.away}@${p.game?.home}` === gameId) && p.game?.date === gameDate && !p.result
  );
  if (!pred) return null;
  pred.finalScore = finalScore;
  pred.result = 'completed';
  const home = finalScore.home;
  const away = finalScore.away;
  const actualWinner = home > away ? pred.game.home : pred.game.away;
  pred.wasCorrect = pred.moneylinePick === actualWinner;
  if (pred.projectedScore) {
    pred.marginError = Math.abs(home - away - (pred.projectedScore.home - pred.projectedScore.away));
    pred.totalError = Math.abs(home + away - (pred.projectedScore.home + pred.projectedScore.away));
  }
  saveHistory(history);
  return pred;
}

function confidenceTier(confidence) {
  const n = typeof confidence === 'number' ? confidence : parseInt(confidence, 10);
  if (Number.isNaN(n)) return 'Unknown';
  if (n >= 70) return 'High';
  if (n >= 50) return 'Medium';
  return 'Low';
}

function getAccuracySummary() {
  const history = loadHistory();
  const completed = history.predictions.filter((p) => p.result === 'completed');

  const byTier = (tier) =>
    completed.filter((p) => confidenceTier(p.confidence) === tier);

  const pctCorrect = (arr, field) => {
    if (!arr.length) return null;
    const scored = arr.filter((p) => p[field] != null);
    if (!scored.length) return null;
    const wins = scored.filter((p) => p[field]).length;
    return Math.round((wins / scored.length) * 1000) / 10;
  };

  const marginErrors = completed.map((p) => p.marginError).filter((n) => n != null);
  const totalErrors = completed.map((p) => p.totalError).filter((n) => n != null);
  const avg = (arr) =>
    arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : null;

  const passes = history.predictions.filter(
    (p) => p.decision === 'PASS' || p.decision === 'INSUFFICIENT_DATA'
  );

  return {
    totalPredictions: history.predictions.length,
    completedGames: completed.length,
    moneyline: {
      overall: pctCorrect(completed, 'wasCorrect'),
      high: pctCorrect(byTier('High'), 'wasCorrect'),
      medium: pctCorrect(byTier('Medium'), 'wasCorrect'),
      low: pctCorrect(byTier('Low'), 'wasCorrect'),
    },
    spread: {
      overall: pctCorrect(completed, 'spreadCorrect'),
      high: pctCorrect(byTier('High'), 'spreadCorrect'),
      medium: pctCorrect(byTier('Medium'), 'spreadCorrect'),
      low: pctCorrect(byTier('Low'), 'spreadCorrect'),
    },
    total: {
      overall: pctCorrect(completed, 'totalCorrect'),
      high: pctCorrect(byTier('High'), 'totalCorrect'),
      medium: pctCorrect(byTier('Medium'), 'totalCorrect'),
      low: pctCorrect(byTier('Low'), 'totalCorrect'),
    },
    moneylineAccuracy: pctCorrect(completed, 'wasCorrect'),
    highConfidenceAccuracy: pctCorrect(byTier('High'), 'wasCorrect'),
    mediumConfidenceAccuracy: pctCorrect(byTier('Medium'), 'wasCorrect'),
    lowConfidenceAccuracy: pctCorrect(byTier('Low'), 'wasCorrect'),
    passCount: passes.length,
    averageMarginError: avg(marginErrors),
    averageTotalError: avg(totalErrors),
    modelVersion: MODEL_VERSION,
    note: completed.length === 0 ? 'No completed games in history yet — accuracy populates after results are recorded.' : null,
  };
}

module.exports = {
  loadHistory,
  recordPrediction,
  updateResult,
  getAccuracySummary,
  getHistory: () => loadHistory().predictions
};
