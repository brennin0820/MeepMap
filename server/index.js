'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { ROOT } = require('./paths');

const dataFetcher = require('./data-fetcher');
const injuriesMod = require('./injuries');
const rosterMod = require('./roster');
const predictor = require('./predictor');
const intelligenceService = require('./intelligence-service');
const { getHistory, getAccuracySummary } = require('./prediction-history');
const journal = require('./journal');
const bankroll = require('./bankroll');
const h2h = require('./h2h');
const { enrichTeams } = require('./team-profile');
const cache = require('./cache');
const { buildLineupWatchPayload } = require('./lineup-watch');
const { gradeCompletedGames } = require('./post-game-grader');
const oddsMod = require('./odds');
const scoreboardMod = require('./scoreboard');
const modelConfig = require('./model-config');
const teamStatsMod = require('./team-stats');
const playerStatsMod = require('./player-stats');

const PORT = process.env.PORT || 3847;
const app = express();

/** Block direct access to backend/source paths (especially on Vercel static CDN). */
const PRIVATE_PREFIXES = ['/server', '/scripts', '/node_modules', '/data'];
const PRIVATE_FILES = new Set([
  '/package.json',
  '/package-lock.json',
  '/Dockerfile',
  '/render.yaml',
  '/vercel.json',
]);

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  const p = req.path;
  if (PRIVATE_FILES.has(p) || PRIVATE_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`))) {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
});
app.use(express.static(ROOT));

function parseDays(value) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n) || n < 1) return 7;
  return Math.min(n, 30);
}

async function resolveTeams(body = {}) {
  const teamsResult = await dataFetcher.getTeams();
  const teams = teamsResult.teams || [];
  const homeTeam = dataFetcher.findTeamByName(
    teams,
    body.homeTeamKey || body.homeKey || body.home
  );
  const awayTeam = dataFetcher.findTeamByName(
    teams,
    body.awayTeamKey || body.awayKey || body.away
  );
  return { teams, homeTeam, awayTeam, teamsResult };
}

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'wnba-bet-predictor',
    ...modelConfig.modelInfo(),
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/teams', async (req, res) => {
  try {
    if (req.query.refresh === '1') cache.clear('teams');
    const data = await dataFetcher.getTeams();
    res.json({ ...data, teams: enrichTeams(data.teams) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/injuries', async (req, res) => {
  try {
    if (req.query.refresh === '1') cache.clear('injuries');
    const data = await injuriesMod.getInjuries();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/scoreboard/live', async (req, res) => {
  try {
    if (req.query.refresh === '1') cache.clear('scoreboard');
    const date = req.query.date || undefined;
    const data = await scoreboardMod.getLiveScoreboard(date);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/scoreboard', async (req, res) => {
  try {
    if (req.query.refresh === '1') cache.clear('scoreboard');
    const date = req.query.date || undefined;
    const data = await scoreboardMod.getScoreboard(date);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/teams/:teamKey/stats', async (req, res) => {
  try {
    if (req.query.refresh === '1') cache.clear('team-stats');
    const data = await teamStatsMod.getTeamStats(req.params.teamKey);
    if (data.error) {
      return res.status(404).json({ error: data.error, meta: data.meta || data });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/teams/:teamKey/players', async (req, res) => {
  try {
    if (req.query.refresh === '1') cache.clear('player-stats');
    const data = await playerStatsMod.getTeamPlayers(req.params.teamKey);
    if (!data.players?.length && data.warning === 'Team not found') {
      return res.status(404).json({ error: 'Team not found', meta: data.meta || data });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/roster/:teamKey', async (req, res) => {
  try {
    const data = await rosterMod.getRoster(req.params.teamKey);
    if (!data.teamKey) {
      return res.status(404).json({ error: 'Team not found' });
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/predictions', async (req, res) => {
  try {
    const days = parseDays(req.query.days);
    if (req.query.refresh === '1') {
      cache.clear('teams');
      cache.clear('schedule');
    }
    const [teamsResult, scheduleResult] = await Promise.all([
      dataFetcher.getTeams(),
      dataFetcher.getScheduleRange(days),
    ]);
    const priorGames = scheduleResult.events.filter((e) => e.statusState === 'post');
    const predictions = await predictor.predictSchedule({
      events: scheduleResult.events,
      teams: teamsResult.teams,
      priorGames,
    });
    res.json({
      days,
      count: predictions.length,
      predictions,
      source: scheduleResult.source,
      lastUpdated: new Date().toISOString(),
      cacheAgeSeconds: scheduleResult.cacheAgeSeconds,
      isLive: scheduleResult.isLive && teamsResult.isLive,
      warning: scheduleResult.warning || teamsResult.warning,
      meta: {
        source: scheduleResult.source,
        isLive: scheduleResult.isLive && teamsResult.isLive,
        warning: scheduleResult.warning || teamsResult.warning,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/predictions/matchup', async (req, res) => {
  try {
    const { teams, homeTeam, awayTeam, teamsResult } = await resolveTeams(req.body || {});
    if (!homeTeam || !awayTeam) {
      return res.status(404).json({ error: 'Unknown team — verify team name or key' });
    }
    const scheduleResult = await dataFetcher.getScheduleRange(14);
    const priorGames = scheduleResult.events.filter((e) => e.statusState === 'post');
    const prediction = await predictor.predictMatchup({
      homeTeamKey: homeTeam.key,
      awayTeamKey: awayTeam.key,
      date: req.body?.date || new Date().toISOString(),
      teams,
      priorGames,
    });
    res.json({ prediction, meta: teamsResult });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/intelligence', async (req, res) => {
  try {
    const days = parseDays(req.query.days);
    if (req.query.refresh === '1') {
      cache.clear('teams');
      cache.clear('schedule');
      cache.clear('injuries');
      await gradeCompletedGames(parseDays(req.query.gradeDays || 14));
    }
    const intel = await intelligenceService.getIntelligence(days);
    res.json(intel);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/intelligence/game/:gameId', async (req, res) => {
  try {
    const game = await intelligenceService.getGameIntelligence(req.params.gameId, 14);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    res.json(game);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/intelligence/matchup', async (req, res) => {
  try {
    const { homeTeam, awayTeam } = await resolveTeams(req.body || {});
    if (!homeTeam || !awayTeam) {
      return res.status(404).json({ error: 'Unknown team — verify team name or key' });
    }
    const result = await intelligenceService.analyzeMatchup({
      homeTeamKey: homeTeam.key,
      awayTeamKey: awayTeam.key,
      date: req.body?.date,
    });
    if (result.error) {
      return res.status(404).json({ error: result.error });
    }
    res.json({
      game: result.game,
      analysis: result.analysis,
      generatedAt: result.generatedAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/intelligence/what-if', async (req, res) => {
  try {
    const { homeTeam, awayTeam } = await resolveTeams(req.body || {});
    if (!homeTeam || !awayTeam) {
      return res.status(404).json({ error: 'Unknown team' });
    }
    const result = await intelligenceService.runWhatIfScenario({
      homeTeamKey: homeTeam.key,
      awayTeamKey: awayTeam.key,
      date: req.body?.date,
      scenario: req.body?.scenario || {},
      spread: req.body?.spread,
      total: req.body?.total,
    });
    if (result.error) {
      return res.status(404).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/intelligence/alerts', async (req, res) => {
  try {
    const days = parseDays(req.query.days);
    const intel = await intelligenceService.getIntelligence(days);
    res.json({ alerts: intel.alerts, lastUpdated: intel.generatedAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/intelligence/lineup-watch', async (req, res) => {
  try {
    const days = parseDays(req.query.days);
    const intel = await intelligenceService.getIntelligence(days);
    res.json(buildLineupWatchPayload(intel));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/odds/movement', async (req, res) => {
  try {
    const homeKey = req.query.homeKey || req.query.home;
    const awayKey = req.query.awayKey || req.query.away;
    const date = req.query.date || null;
    if (!homeKey || !awayKey) {
      return res.status(400).json({ error: 'homeKey and awayKey are required' });
    }
    const movement = await oddsMod.getOddsMovement(homeKey, awayKey, date);
    res.json(movement);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/grade', async (req, res) => {
  try {
    const days = parseDays(req.body?.days || req.query.days || 14);
    const result = await gradeCompletedGames(days);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/grade', async (req, res) => {
  try {
    const days = parseDays(req.query.days || 14);
    const result = await gradeCompletedGames(days);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/intelligence/health', async (_req, res) => {
  try {
    const teamsResult = await dataFetcher.getTeams();
    res.json({
      sources: dataFetcher.getSourceHealth(),
      meta: teamsResult,
      ...modelConfig.modelInfo(),
      dataQualityEngine: 'v1.1',
      status: intelligenceService.getHealth().status,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/history', (_req, res) => {
  res.json({ predictions: getHistory() });
});

app.get('/api/accuracy', (_req, res) => {
  res.json(getAccuracySummary());
});

app.get('/api/journal', (_req, res) => {
  res.json(journal.getEntries());
});

app.post('/api/journal', (req, res) => {
  try {
    const entry = journal.addEntry(req.body || {});
    res.status(201).json({ entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/journal/:id', (req, res) => {
  try {
    const entry = journal.updateEntry(req.params.id, req.body || {});
    if (!entry) return res.status(404).json({ error: 'Journal entry not found' });
    res.json({ entry });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/journal/:id', (req, res) => {
  try {
    const removed = journal.deleteEntry(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Journal entry not found' });
    res.json({ ok: true, id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/bankroll', (_req, res) => {
  res.json(bankroll.getBankroll());
});

app.put('/api/bankroll', (req, res) => {
  try {
    res.json(bankroll.updateBankroll(req.body || {}));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bankroll/sync', (_req, res) => {
  try {
    res.json(bankroll.syncFromJournal());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/h2h', async (req, res) => {
  try {
    const teamA = req.query.teamA || req.query.team1;
    const teamB = req.query.teamB || req.query.team2;
    const days = parseDays(req.query.days || 60);
    const result = await h2h.getHeadToHead(teamA, teamB, days);
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/simulate', async (req, res) => {
  try {
    const { teams, homeTeam, awayTeam } = await resolveTeams(req.body || {});
    if (!homeTeam || !awayTeam) {
      return res.status(404).json({ error: 'Unknown team — verify team name or key' });
    }
    const scheduleResult = await dataFetcher.getScheduleRange(14);
    const priorGames = scheduleResult.events.filter((e) => e.statusState === 'post');
    const spread =
      req.body?.spread != null
        ? Number(req.body.spread)
        : req.body?.total != null
          ? { total: Number(req.body.total) }
          : null;
    const result = await predictor.simulateMatchup({
      homeTeamKey: homeTeam.key,
      awayTeamKey: awayTeam.key,
      date: req.body?.date || new Date().toISOString(),
      teams,
      priorGames,
      spread,
      iterations: req.body?.iterations,
    });
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/refresh', async (req, res) => {
  try {
    if (!cache.canRefresh('live', 'all')) {
      const waitSeconds = Math.ceil(cache.REFRESH_THROTTLE_MS / 1000);
      return res.status(429).json({
        error: 'Refresh throttled — wait before forcing another live fetch',
        waitSeconds,
        meta: { warning: 'Refresh throttled' },
      });
    }
    cache.markRefresh('live', 'all');
    cache.clear();
    const live = await dataFetcher.refreshLiveData(true);
    const gradeDays = parseDays(req.body?.gradeDays || req.query?.gradeDays || 14);
    const grade = await gradeCompletedGames(gradeDays);
    const intel = await intelligenceService.getIntelligence(7);
    res.json({
      ok: true,
      meta: live.meta,
      summary: intel.summary,
      grade: { gradedCount: grade.gradedCount, skippedCount: grade.skippedCount },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  const indexPath = path.join(ROOT, 'index.html');
  if (fs.existsSync(indexPath)) res.sendFile(indexPath);
  else res.status(404).send('Not found');
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`WNBA Bet Predictor running at http://localhost:${PORT}`);
    console.log('  GET  /api/health');
    console.log('  GET  /api/teams | /api/teams/:teamKey/stats | /api/teams/:teamKey/players');
    console.log('  GET  /api/scoreboard | /api/scoreboard/live | /api/injuries | /api/roster/:teamKey');
    console.log('  GET  /api/predictions | POST /api/predictions/matchup');
    console.log('  GET  /api/intelligence | /api/intelligence/alerts | /api/intelligence/health');
    console.log('  GET  /api/intelligence/lineup-watch | /api/odds/movement | /api/grade');
    console.log('  GET  /api/history | /api/accuracy | /api/h2h | /api/journal | /api/bankroll');
    console.log('  POST /api/simulate | /api/intelligence/matchup | /api/intelligence/what-if');
  });
}

module.exports = app;
