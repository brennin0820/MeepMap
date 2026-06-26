'use strict';

const { decide, normalizeDecideParams } = require('./decision-engine');
const { modelProjectionFromPrediction } = require('./data-quality');
const { statusImpact } = require('./player-impact');
const config = require('./model-config');

function rosterHasPlayer(roster, playerName) {
  if (!roster || !playerName) return false;
  const needle = playerName.toLowerCase();
  const players = roster.players || roster.roster || [];
  return players.some((p) => {
    const name = (p.player || p.name || '').toLowerCase();
    return name && (name.includes(needle) || needle.includes(name));
  });
}

function injuryPenaltiesFromScenario(homeTeam, awayTeam, homeRoster, awayRoster, setPlayerStatus = []) {
  let extraHome = 0;
  let extraAway = 0;
  for (const override of setPlayerStatus) {
    const player = (override.player || '').trim();
    if (!player) continue;
    const impact = statusImpact(override.status) * config.INJURY_SCALE;
    if (rosterHasPlayer(homeRoster, player)) {
      extraHome += impact;
    } else if (rosterHasPlayer(awayRoster, player)) {
      extraAway += impact;
    }
  }
  return { extraHome, extraAway };
}

function buildScenarioProjection(predictor, ctx, options = {}) {
  if (!predictor?.projectMatchup || !ctx.homeTeam || !ctx.awayTeam) {
    return ctx.modelProjection || modelProjectionFromPrediction(ctx.prediction);
  }
  const raw = predictor.projectMatchup({
    homeTeam: ctx.homeTeam,
    awayTeam: ctx.awayTeam,
    fatigue: ctx.fatigue,
    odds: ctx.odds,
    neutralCourt: options.neutralCourt === true,
    homeInjuryPenalty: options.extraHomeInjuryPenalty || 0,
    awayInjuryPenalty: options.extraAwayInjuryPenalty || 0,
  });
  if (!raw?.enabled) return ctx.modelProjection;
  return {
    winProb: raw.projections?.homeWinProb,
    projectedMargin: raw.projections?.projectedMargin,
    projectedTotal: raw.projections?.projectedTotal,
    spreadEdge: raw.projections?.spreadEdge,
  };
}

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
  const scenario = ctx.scenario || {};

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

  if (scenario.setPlayerStatus?.length || scenario.neutralCourt) {
    const { extraHome, extraAway } = injuryPenaltiesFromScenario(
      ctx.homeTeam,
      ctx.awayTeam,
      ctx.homeRoster,
      ctx.awayRoster,
      scenario.setPlayerStatus || []
    );
    const adjustedProjection = buildScenarioProjection(ctx.predictor, ctx, {
      neutralCourt: scenario.neutralCourt === true,
      extraHomeInjuryPenalty: extraHome,
      extraAwayInjuryPenalty: extraAway,
    });
    const adjusted = buildWhatIfScenarios({
      game: ctx.game,
      homeTeam: ctx.homeTeam,
      awayTeam: ctx.awayTeam,
      odds: ctx.odds,
      modelProjection: adjustedProjection,
      prediction: ctx.prediction,
      dataQuality: ctx.dataQuality,
      lineup: ctx.lineup,
      homeRoster: ctx.homeRoster,
      awayRoster: ctx.awayRoster,
      fatigue: ctx.fatigue,
      injuries: ctx.injuries,
    });
    const label = scenario.neutralCourt ? 'Neutral court' : 'Injury adjustment';
    const summary = `${label} shifts decision from ${baseline.baseline.decision} to ${adjusted.baseline.decision}.`;
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
