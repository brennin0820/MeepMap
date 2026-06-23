'use strict';

(function () {
  const API = '';
  let state = {
    intelligence: null,
    teams: [],
    injuries: null,
    journal: null,
    bankroll: null,
    accuracy: null,
    history: [],
    gamesFilter: 'all',
    activeTab: 'intelligence',
    scoreboard: null,
    scoreboardExpandedGameId: null,
    scoreboardTeamDetails: {},
    scoreboardPlayersCache: {},
    teamsUI: { search: '', segment: 'all', sort: 'netRating', todayOnly: false, selectedTeamKey: null },
    teamsDetails: {},
    teamsPlayers: {},
    playingTodayKeys: null,
  };

  async function fetchJson(path, options) {
    const res = await fetch(`${API}${path}`, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText || `HTTP ${res.status}`);
    return data;
  }

  function $(sel) {
    return document.querySelector(sel);
  }

  function computePlayingTodayKeys(games) {
    const keys = new Set();
    const today = new Date().toISOString().slice(0, 10);
    (games || []).forEach((g) => {
      const date = (g.date || g.time || '').slice(0, 10);
      if (date && date !== today) return;
      [g.homeKey, g.awayKey, g.homeTeam?.key, g.awayTeam?.key].forEach((k) => {
        if (k) keys.add(String(k).toLowerCase());
      });
    });
    return keys;
  }

  function setMeta(text) {
    const el = $('#last-updated');
    if (el) el.textContent = text;
  }

  function setSource(text) {
    const el = $('#api-source');
    if (el) el.textContent = text;
  }

  function switchTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll('.tabs__btn').forEach((btn) => {
      const active = btn.dataset.tab === tab;
      btn.classList.toggle('tabs__btn--active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('.panel').forEach((panel) => {
      const active = panel.id === `panel-${tab}`;
      panel.classList.toggle('panel--active', active);
      panel.hidden = !active;
    });
    renderActivePanel();
  }

  function renderActivePanel() {
    switch (state.activeTab) {
      case 'intelligence':
        renderIntelligence();
        break;
      case 'games':
        renderGames();
        break;
      case 'teams':
        renderTeams();
        break;
      case 'scoreboard':
        renderScoreboard();
        break;
      case 'matchup':
        renderMatchup();
        break;
      case 'injuries':
        renderInjuries();
        break;
      case 'journal':
        renderJournal();
        break;
      case 'settings':
        renderSettings();
        break;
      default:
        break;
    }
  }

  function renderIntelligence() {
    const panel = $('#panel-intelligence');
    if (!panel) return;
    if (!state.intelligence) {
      panel.innerHTML = '<p class="empty-state">Loading intelligence…</p>';
      return;
    }
    const data = { ...state.intelligence, accuracy: state.accuracy };
    panel.innerHTML = IntelligenceView.renderCommandCenter(data);
    IntelligenceView.bindActions(panel, {
      onExplain: openExplanation,
      onWhatIf: (gameId) => {
        switchTab('settings');
        const sel = document.querySelector('#what-if-game');
        if (sel) sel.value = gameId;
      },
    });
  }

  function renderGames() {
    const panel = $('#panel-games');
    if (!panel || !state.intelligence) return;
    panel.innerHTML = PredictionsUI.renderGamesPanel(state.intelligence, state.gamesFilter);
    PredictionsUI.bindFilters(panel, (filter) => {
      state.gamesFilter = filter;
      renderGames();
    });
    IntelligenceView.bindActions(panel, { onExplain: openExplanation, onWhatIf: () => switchTab('settings') });
  }

  async function loadTeamProfile(teamKey) {
    if (!teamKey) return;
    const key = teamKey;
    if (state.teamsDetails[key] && !state.teamsDetails[key].error) {
      if (!state.teamsPlayers[key]) loadTeamPlayers(key);
      return;
    }
    state.teamsDetails = { ...state.teamsDetails, [key]: { loading: true } };
    renderTeams();
    try {
      const data = await fetchJson(`/api/teams/${encodeURIComponent(key)}/stats`);
      state.teamsDetails = { ...state.teamsDetails, [key]: { ...data, loading: false } };
    } catch (err) {
      state.teamsDetails = {
        ...state.teamsDetails,
        [key]: { loading: false, error: err.message || 'Team stats unavailable' },
      };
    }
    renderTeams();
    loadTeamPlayers(key);
  }

  async function loadTeamPlayers(teamKey) {
    const key = teamKey;
    if (state.teamsPlayers[key] && !state.teamsPlayers[key].error) return;
    state.teamsPlayers = { ...state.teamsPlayers, [key]: { loading: true } };
    renderTeams();
    try {
      const data = await fetchJson(`/api/teams/${encodeURIComponent(key)}/players`);
      state.teamsPlayers = { ...state.teamsPlayers, [key]: { ...data, loading: false } };
    } catch (err) {
      state.teamsPlayers = {
        ...state.teamsPlayers,
        [key]: { loading: false, error: err.message || 'Player stats unavailable' },
      };
    }
    renderTeams();
  }

  function getTeamsHandlers() {
    return {
      onSearch: (value) => {
        state.teamsUI = { ...state.teamsUI, search: value };
        renderTeams({ keepSearchFocus: true });
      },
      onSegment: (segment) => {
        state.teamsUI = { ...state.teamsUI, segment };
        renderTeams();
      },
      onSort: (sort) => {
        state.teamsUI = { ...state.teamsUI, sort };
        renderTeams();
      },
      onTodayToggle: (todayOnly) => {
        state.teamsUI = { ...state.teamsUI, todayOnly };
        renderTeams();
      },
      onOpenTeam: (teamKey) => {
        state.teamsUI = { ...state.teamsUI, selectedTeamKey: teamKey };
        renderTeams();
        loadTeamProfile(teamKey);
      },
      onBack: () => {
        state.teamsUI = { ...state.teamsUI, selectedTeamKey: null };
        renderTeams();
      },
    };
  }

  function renderTeams(options = {}) {
    const panel = $('#panel-teams');
    if (!panel) return;
    if (!state.teams || !state.teams.length) {
      panel.innerHTML = '<p class="empty-state">Loading teams…</p>';
      return;
    }
    panel.innerHTML = TeamsView.renderTeamsPanel(state);
    TeamsView.bindTeamsActions(panel, getTeamsHandlers());
    if (options.keepSearchFocus) {
      const input = panel.querySelector('#teams-search');
      if (input) {
        input.focus();
        const len = input.value.length;
        input.setSelectionRange(len, len);
      }
    }
  }

  async function loadScoreboardTeamDetails(gameId) {
    const games = ScoreboardView.gamesFromPayload(state.scoreboard);
    const game = games.find((g) => (g.id || `${g.away}-${g.home}`) === gameId);
    if (!game) return;

    const keys = [
      game.awayTeam?.key || game.awayKey,
      game.homeTeam?.key || game.homeKey,
    ].filter(Boolean);

    const details = { ...state.scoreboardTeamDetails };
    keys.forEach((key) => {
      details[key] = { ...(details[key] || {}), loading: true, teamKey: key };
    });
    state.scoreboardTeamDetails = details;
    renderScoreboard();

    await Promise.all(
      keys.map(async (key) => {
        try {
          const data = await fetchJson(`/api/teams/${encodeURIComponent(key)}/stats`);
          details[key] = { ...data, teamKey: key, loading: false };
        } catch (err) {
          details[key] = {
            teamKey: key,
            team: key === game.awayTeam?.key ? game.awayTeam : game.homeTeam,
            loading: false,
            error: err.message || 'Stats unavailable',
          };
        }
      })
    );
    state.scoreboardTeamDetails = { ...details };
    renderScoreboard();
  }

  function renderScoreboard() {
    const panel = $('#panel-scoreboard');
    if (!panel) return;
    if (!state.scoreboard) {
      panel.innerHTML = '<p class="empty-state">Loading scoreboard…</p>';
      return;
    }
    panel.innerHTML = ScoreboardView.renderScoreboardPanel(state.scoreboard, {
      expandedGameId: state.scoreboardExpandedGameId,
      teamDetails: state.scoreboardTeamDetails,
    });
    ScoreboardView.bindScoreboardActions(panel, {
      onToggleGame: (gameId, expand) => {
        if (!expand) {
          state.scoreboardExpandedGameId = null;
          renderScoreboard();
          return;
        }
        state.scoreboardExpandedGameId = gameId;
        loadScoreboardTeamDetails(gameId);
      },
      onLoadPlayers: async (teamKey) => {
        if (state.scoreboardPlayersCache[teamKey]) {
          return state.scoreboardPlayersCache[teamKey];
        }
        const data = await fetchJson(`/api/teams/${encodeURIComponent(teamKey)}/players`);
        state.scoreboardPlayersCache[teamKey] = data;
        return data;
      },
    });
  }

  function renderMatchup() {
    const panel = $('#panel-matchup');
    if (!panel) return;
    panel.innerHTML = MatchupView.renderMatchupPanel(state.teams);
    MatchupView.bindMatchupForm(
      panel.querySelector('#matchup-form'),
      panel.querySelector('#matchup-results'),
      async (payload) => {
        const analysis = await fetchJson('/api/intelligence/matchup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ homeKey: payload.homeKey, awayKey: payload.awayKey, date: new Date().toISOString() }),
        });
        const h2h = await fetchJson(`/api/h2h?teamA=${encodeURIComponent(payload.awayKey)}&teamB=${encodeURIComponent(payload.homeKey)}&days=60`).catch(() => null);
        let html = MatchupView.renderMatchupResult(analysis.analysis || analysis);
        if (h2h?.matchups?.length) {
          html += `<section class="h2h-section"><h4>Head-to-head</h4><ul>${h2h.matchups
            .map((m) => `<li>${(m.date || '').slice(0, 10)} — ${m.awayTeam?.name} @ ${m.homeTeam?.name}</li>`)
            .join('')}</ul></section>`;
        }
        return html;
      }
    );
  }

  function renderInjuries() {
    const panel = $('#panel-injuries');
    if (!panel) return;
    panel.innerHTML = InjuriesView.renderInjuriesPanel(state.injuries || { injuries: [] });
  }

  function renderJournal() {
    const panel = $('#panel-journal');
    if (!panel) return;
    panel.innerHTML = JournalUI.renderJournalPanel(state.journal || { entries: [] });
    JournalUI.bindJournalForm(panel.querySelector('#journal-form'), async (entry) => {
      await fetchJson('/api/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      });
      state.journal = await fetchJson('/api/journal');
      renderJournal();
    });
  }

  function renderSettings() {
    const panel = $('#panel-settings');
    if (!panel) return;
    panel.innerHTML = SettingsView.render({
      accuracy: state.accuracy,
      history: state.history,
      bankroll: {
        starting: state.bankroll?.startingBankroll,
        current: state.bankroll?.currentBankroll,
        unit: state.bankroll?.unitSize,
      },
      meta: state.intelligence?.meta,
      games: state.intelligence?.games || [],
    });
    SettingsView.bind(panel, {
      onSaveBankroll: async (local) => {
        state.bankroll = await fetchJson('/api/bankroll', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            startingBankroll: local.starting,
            currentBankroll: local.current,
            unitSize: local.unit,
          }),
        });
      },
    });
    const whatIfForm = panel.querySelector('#what-if-form');
    const whatIfResults = panel.querySelector('#what-if-results');
    if (whatIfForm && whatIfResults) {
      WhatIfView.bindWhatIfForm(whatIfForm, whatIfResults, async (payload) => {
        const game = state.intelligence?.games?.find((g) => g.id === payload.gameId);
        if (!game) throw new Error('Game not found');
        return fetchJson('/api/intelligence/what-if', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            homeKey: game.homeKey,
            awayKey: game.awayKey,
            scenario: { setPlayerStatus: payload.player ? [{ player: payload.player, status: payload.playerStatus }] : [] },
          }),
        });
      });
    }
  }

  function openExplanation(gameId) {
    const game = state.intelligence?.games?.find((g) => g.id === gameId);
    if (!game) return;
    ExplanationUI.openDrawer($('#explanation-drawer'), $('#explanation-content'), game.explanation, game);
  }

  async function refreshAll() {
    setMeta('Refreshing…');
    try {
      const [intel, teams, injuries, journal, bankroll, accuracy, historyPayload, lineupWatch, gradeResult, scoreboard] = await Promise.all([
        fetchJson('/api/intelligence?days=7'),
        fetchJson('/api/teams'),
        fetchJson('/api/injuries'),
        fetchJson('/api/journal'),
        fetchJson('/api/bankroll'),
        fetchJson('/api/accuracy'),
        fetchJson('/api/history'),
        fetchJson('/api/intelligence/lineup-watch?days=7').catch(() => null),
        fetchJson('/api/grade?days=14').catch(() => null),
        fetchJson('/api/scoreboard').catch((err) => ({
          games: [],
          warning: err.message || 'Scoreboard unavailable',
          isLive: false,
        })),
      ]);
      state.intelligence = { ...intel, lineupWatch };
      state.teams = teams.teams || [];
      state.playingTodayKeys = computePlayingTodayKeys(intel.games);
      state.injuries = injuries;
      state.journal = journal.predictions || journal.entries || journal;
      state.bankroll = bankroll;
      state.accuracy = gradeResult?.accuracy || accuracy;
      state.history = historyPayload.predictions || [];
      state.scoreboard = scoreboard;
      state.scoreboardPlayersCache = {};
      state.scoreboardTeamDetails = {};
      AlertsUI.mountGlobalAlerts($('#global-alerts'), intel.alerts);
      setMeta(`Updated ${new Date().toLocaleTimeString()}`);
      setSource(intel.meta?.source ? `Source: ${intel.meta.source}` : '—');
      renderActivePanel();
    } catch (err) {
      setMeta('Refresh failed — is the server running?');
      console.error(err);
    }
  }

  document.querySelectorAll('.tabs__btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  $('#btn-refresh')?.addEventListener('click', refreshAll);
  $('#btn-grade')?.addEventListener('click', async () => {
    try {
      const result = await fetchJson('/api/grade?days=14');
      state.accuracy = result.accuracy || (await fetchJson('/api/accuracy'));
      state.history = (await fetchJson('/api/history')).predictions || [];
      setMeta(`Graded ${result.gradedCount ?? 0} games · ${new Date().toLocaleTimeString()}`);
      renderActivePanel();
    } catch (err) {
      console.error(err);
    }
  });
  document.querySelectorAll('[data-close-drawer]').forEach((el) => {
    el.addEventListener('click', () => ExplanationUI.closeDrawer($('#explanation-drawer')));
  });

  refreshAll();
})();
