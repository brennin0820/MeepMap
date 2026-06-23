'use strict';

const { decide, normalizeDecideParams } = require('./decision-engine');
const { modelProjectionFromPrediction } = require('./data-quality');

function adjustTeamNet(team, delta) {
  if (!team) return team;
  const net = typeof team.netRating === 'number' ? team.netRating + delta : team.netRating;
  return { ...team, netRating: net };
}

function buildDecideInput(input = {}) {
  const normalized = normalizeDecideParams(input);
  return {
    game: normalized.game,
    homeTeam: normalized.homeTeam,
    awayTeam: normalized.awayTeam,
    modelProjection: normalized.modelProjection,
    odds: normalized.odds,
    lineup: normalized.lineup,
    injuries: normalized.injuries,
    dataQuality: normalized.dataQuality,
    fatigue: normalized.fatigue,
    prediction: normalized.prediction,
    homeRoster: input.homeRoster,
    awayRoster: input.awayRoster,
  };
}

function outcomeFromDecision(result) {
  return {
    decision: result.decision,
    edgeScore: result.edgeScore,
    confidence: result.confidence,
    grade: result.grade,
    risk: result.risk,
  };
}

function buildWhatIfScenarios(input = {}) {
  const decideFn = input.decideFn || decide;
  const baseInput = buildDecideInput(input);
  const baselineDecision = decideFn(baseInput);

  const scenarios = [];

  if (input.homeTeam && input.awayTeam) {
    const starOutHome = decideFn({
      ...baseInput,
      homeTeam: adjustTeamNet(input.homeTeam, -4),
    });
    scenarios.push({
      id: 'home-star-out',
      label: 'Home star unavailable',
      assumption: 'Hypothetical −4 net-rating adjustment for home team.',
      outcome: outcomeFromDecision(starOutHome),
    });

    const starOutAway = decideFn({
      ...baseInput,
      awayTeam: adjustTeamNet(input.awayTeam, -4),
    });
    scenarios.push({
      id: 'away-star-out',
      label: 'Away star unavailable',
      assumption: 'Hypothetical −4 net-rating adjustment for away team.',
      outcome: outcomeFromDecision(starOutAway),
    });
  }

  if (input.odds && typeof input.odds.spread === 'number') {
    const movedLine = {
      ...input.odds,
      spread: input.odds.spread + 2,
    };
    const lineMove = decideFn({
      ...baseInput,
      odds: movedLine,
    });
    scenarios.push({
      id: 'line-move-plus2',
      label: 'Spread moves +2 toward home',
      assumption: 'Hypothetical market move only — not a live quote.',
      outcome: outcomeFromDecision(lineMove),
    });
  }

  if (input.lineup && input.lineup.confirmed !== true) {
    const lineupConfirmed = decideFn({
      ...baseInput,
      lineup: { confirmed: true },
      dataQuality: input.dataQuality
        ? {
            ...input.dataQuality,
            flags: { ...input.dataQuality.flags, lineupConfirmed: true },
            score: Math.min(100, (input.dataQuality.score || 0) + 20),
          }
        : input.dataQuality,
    });
    scenarios.push({
      id: 'lineup-confirmed',
      label: 'Lineups confirmed',
      assumption: 'Hypothetical confirmed starters — no further rotation uncertainty.',
      outcome: outcomeFromDecision(lineupConfirmed),
    });
  }

  return {
    baseline: outcomeFromDecision(baselineDecision),
    scenarios,
  };
}

function runWhatIf(ctx = {}) {
  const modelProjection =
    ctx.modelProjection || modelProjectionFromPrediction(ctx.prediction);

  const baseline = buildWhatIfScenarios({
    game: ctx.game,
    homeTeam: ctx.homeTeam,
    awayTeam: ctx.awayTeam,
    odds: ctx.odds,
    modelProjection,
    prediction: ctx.prediction,
    dataQuality: ctx.dataQuality,
    lineup: ctx.lineup,
    homeRoster: ctx.homeRoster,
    awayRoster: ctx.awayRoster,
    fatigue: ctx.fatigue,
    injuries: ctx.injuries,
  });

  const scenario = ctx.scenario || {};
  if (scenario.setPlayerStatus?.length) {
    const adjusted = buildWhatIfScenarios({
      game: ctx.game,
      homeTeam: adjustTeamNet(ctx.homeTeam, -3),
      awayTeam: ctx.awayTeam,
      odds: ctx.odds,
      modelProjection,
      prediction: ctx.prediction,
      dataQuality: ctx.dataQuality,
      homeRoster: ctx.homeRoster,
      awayRoster: ctx.awayRoster,
    });
    const summary = `Injury scenario shifts decision from ${baseline.baseline.decision} toward ${adjusted.baseline.decision}.`;
    return {
      baseline: baseline.baseline,
      original: baseline.baseline,
      scenario: adjusted.baseline,
      adjusted: adjusted.baseline,
      scenarios: adjusted.scenarios,
      delta: {
        decisionChanged: adjusted.baseline.decision !== baseline.baseline.decision,
        edgeScore: adjusted.baseline.edgeScore - baseline.baseline.edgeScore,
      },
      summary,
    };
  }

  const firstShift = baseline.scenarios.find(
    (s) => s.outcome.decision !== baseline.baseline.decision
  );
  const scenarioOutcome = firstShift?.outcome || baseline.scenarios[0]?.outcome || baseline.baseline;
  const summary = firstShift
    ? `${firstShift.label} shifts decision from ${baseline.baseline.decision} to ${firstShift.outcome.decision}.`
    : 'Baseline scenario unchanged across tested hypotheticals.';

  return {
    ...baseline,
    original: baseline.baseline,
    scenario: scenarioOutcome,
    adjusted: scenarioOutcome,
    delta: {
      decisionChanged: scenarioOutcome.decision !== baseline.baseline.decision,
      edgeScore: scenarioOutcome.edgeScore - baseline.baseline.edgeScore,
    },
    summary,
  };
}

function applyScenarioRoster(roster, setPlayerStatus = []) {
  if (!roster) return roster;
  const players = [...(roster.players || roster.roster || [])];
  for (const override of setPlayerStatus) {
    const name = (override.player || '').toLowerCase();
    const idx = players.findIndex((p) =>
      (p.player || p.name || '').toLowerCase().includes(name)
    );
    if (idx >= 0) {
      players[idx] = { ...players[idx], status: override.status };
    }
  }
  return { ...roster, players };
}

module.exports = {
  buildWhatIfScenarios,
  runWhatIf,
  applyScenarioRoster,
  buildDecideInput,
  adjustTeamNet,
};
