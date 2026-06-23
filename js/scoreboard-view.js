/**
 * Scoreboard tab — live games, team stats, expandable player stats.
 */
(function (global) {
  const { escapeHtml } = global.AlertsUI;

  function gamesFromPayload(data) {
    if (!data) return [];
    return data.games || data.events || [];
  }

  function teamKey(team) {
    return team?.key || team?.teamKey || null;
  }

  function teamLabel(team, fallback) {
    return team?.abbreviation || team?.abbr || team?.name || fallback || '—';
  }

  function statusClass(state) {
    const s = String(state || '').toLowerCase();
    if (s === 'in' || s.includes('progress')) return 'sb-status--live';
    if (s === 'post' || s.includes('final')) return 'sb-status--final';
    if (s === 'pre' || s.includes('sched')) return 'sb-status--pre';
    return 'sb-status--other';
  }

  function formatClock(game) {
    const period = game.period ?? game.quarter;
    const clock = game.clock ?? game.displayClock ?? '';
    if (period != null && clock) return `Q${period} · ${clock}`;
    if (period != null) return `Q${period}`;
    if (clock) return clock;
    return game.status || 'Scheduled';
  }

  function statVal(obj, ...keys) {
    if (!obj) return null;
    for (const k of keys) {
      if (obj[k] != null && obj[k] !== '') return obj[k];
    }
    return null;
  }

  function fmtNum(val, digits = 1) {
    if (val == null || val === '' || Number.isNaN(Number(val))) return '—';
    const n = Number(val);
    if (Number.isInteger(n) && digits === 1) return String(n);
    return n.toFixed(digits);
  }

  function fmtPct(val) {
    if (val == null || val === '') return '—';
    const n = Number(val);
    if (Number.isNaN(n)) return '—';
    if (n > 0 && n <= 1) return `${(n * 100).toFixed(1)}%`;
    return `${n.toFixed(1)}%`;
  }

  function renderStatusBadge(game) {
    const state = game.statusState || game.state;
    const label = formatClock(game);
    const live = String(state || '').toLowerCase() === 'in';
    return `<span class="sb-status ${statusClass(state)}${live ? ' sb-status--pulse' : ''}">${escapeHtml(label)}</span>`;
  }

  function renderScoreLine(game) {
    const away = game.awayTeam || {};
    const home = game.homeTeam || {};
    const awayScore = game.awayScore ?? away.score ?? '—';
    const homeScore = game.homeScore ?? home.score ?? '—';
    return `
      <div class="sb-scoreline">
        <div class="sb-scoreline__team ${Number(awayScore) > Number(homeScore) ? 'sb-scoreline__team--leading' : ''}">
          <span class="sb-scoreline__abbr">${escapeHtml(teamLabel(away, game.away))}</span>
          <span class="sb-scoreline__pts">${escapeHtml(String(awayScore))}</span>
        </div>
        <span class="sb-scoreline__at">@</span>
        <div class="sb-scoreline__team ${Number(homeScore) > Number(awayScore) ? 'sb-scoreline__team--leading' : ''}">
          <span class="sb-scoreline__abbr">${escapeHtml(teamLabel(home, game.home))}</span>
          <span class="sb-scoreline__pts">${escapeHtml(String(homeScore))}</span>
        </div>
      </div>`;
  }

  function renderStatGrid(stats, rows) {
    const items = rows
      .map(([label, ...keys]) => {
        const raw = statVal(stats, ...keys);
        const display = keys.some((k) => String(k).toLowerCase().includes('pct') || String(k).includes('Percent'))
          ? fmtPct(raw)
          : fmtNum(raw);
        return `<div class="sb-stat"><span class="sb-stat__label">${escapeHtml(label)}</span><span class="sb-stat__value">${escapeHtml(display)}</span></div>`;
      })
      .join('');
    return `<div class="sb-stat-grid">${items}</div>`;
  }

  function teamStatsRows() {
    return [
      ['PPG', 'ppg', 'pointsPerGame', 'avgPoints'],
      ['OPP PPG', 'oppPpg', 'oppPointsPerGame', 'avgPointsAgainst'],
      ['FG%', 'fgPct', 'fieldGoalPct', 'fieldGoalPercentage'],
      ['3P%', 'fg3Pct', 'threePointPct', 'threePointPercentage'],
      ['FT%', 'ftPct', 'freeThrowPct', 'freeThrowPercentage'],
      ['REB', 'reb', 'rebounds', 'reboundsPerGame', 'rpg'],
      ['AST', 'ast', 'assists', 'assistsPerGame', 'apg'],
      ['TO', 'to', 'turnovers', 'turnoversPerGame'],
      ['Net', 'netRating', 'avgMargin', 'differential'],
      ['Pace', 'pace'],
    ];
  }

  function renderTeamStatCard(side, teamData, loading) {
    const t = teamData?.team || teamData || {};
    const stats = teamData?.stats || t.stats || t;
    const name = t.name || teamData?.teamName || teamLabel(t, side);
    const record = t.record || teamData?.record || '—';
    const key = teamKey(t) || teamData?.teamKey || '';

    if (loading) {
      return `
        <article class="sb-team-card" data-team-key="${escapeHtml(key)}">
          <header class="sb-team-card__header">
            <h4 class="sb-team-card__name">${escapeHtml(name)}</h4>
            <span class="sb-team-card__record">${escapeHtml(record)}</span>
          </header>
          <p class="loading-inline">Loading stats…</p>
        </article>`;
    }

    if (teamData?.error) {
      return `
        <article class="sb-team-card sb-team-card--error" data-team-key="${escapeHtml(key)}">
          <header class="sb-team-card__header">
            <h4 class="sb-team-card__name">${escapeHtml(name)}</h4>
          </header>
          <p class="panel-warning">${escapeHtml(teamData.error)}</p>
        </article>`;
    }

    const warning = teamData?.warning;
    return `
      <article class="sb-team-card" data-team-key="${escapeHtml(key)}">
        <header class="sb-team-card__header">
          <h4 class="sb-team-card__name">${escapeHtml(name)}</h4>
          <span class="sb-team-card__record">${escapeHtml(record)}</span>
        </header>
        ${warning ? `<p class="panel-warning sb-team-card__warn">${escapeHtml(warning)}</p>` : ''}
        ${renderStatGrid(stats, teamStatsRows())}
        <button type="button" class="btn btn--sm sb-players-toggle" data-team-key="${escapeHtml(key)}" aria-expanded="false">
          Player stats
        </button>
        <div class="sb-players" data-players-for="${escapeHtml(key)}" hidden></div>
      </article>`;
  }

  function playerStatCells(p) {
    const s = p.stats || p;
    return `
      <td>${escapeHtml(p.position || p.pos || '—')}</td>
      <td>${escapeHtml(fmtNum(statVal(s, 'mpg', 'minutesPerGame', 'min'), 1))}</td>
      <td>${escapeHtml(fmtNum(statVal(s, 'ppg', 'pointsPerGame', 'pts'), 1))}</td>
      <td>${escapeHtml(fmtNum(statVal(s, 'rpg', 'reboundsPerGame', 'reb'), 1))}</td>
      <td>${escapeHtml(fmtNum(statVal(s, 'apg', 'assistsPerGame', 'ast'), 1))}</td>
      <td>${escapeHtml(fmtPct(statVal(s, 'fgPct', 'fieldGoalPct')))}</td>`;
  }

  function renderPlayersTable(players, warning) {
    const list = players || [];
    if (!list.length) {
      return `<p class="empty-state">${escapeHtml(warning || 'No player stats available.')}</p>`;
    }
    const sorted = [...list].sort((a, b) => {
      const ap = statVal(a.stats || a, 'ppg', 'pointsPerGame', 'pts') || 0;
      const bp = statVal(b.stats || b, 'ppg', 'pointsPerGame', 'pts') || 0;
      return Number(bp) - Number(ap);
    });
    return `
      ${warning ? `<p class="panel-warning sb-players__warn">${escapeHtml(warning)}</p>` : ''}
      <div class="table-wrap">
        <table class="sb-players-table">
          <thead>
            <tr><th>Player</th><th>Pos</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>FG%</th></tr>
          </thead>
          <tbody>
            ${sorted.map((p) => `
              <tr>
                <td>${escapeHtml(p.name || p.player || p.displayName || '—')}</td>
                ${playerStatCells(p)}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function renderGameCard(game, { expanded = false, teamDetails = {} } = {}) {
    const id = game.id || `${game.away}-${game.home}`;
    const awayKey = teamKey(game.awayTeam) || game.awayKey;
    const homeKey = teamKey(game.homeTeam) || game.homeKey;
    const dateStr = (game.date || '').slice(0, 16).replace('T', ' ');

    return `
      <article class="sb-game-card${expanded ? ' sb-game-card--expanded' : ''}" data-game-id="${escapeHtml(id)}">
        <button type="button" class="sb-game-card__toggle" data-game-id="${escapeHtml(id)}" aria-expanded="${expanded ? 'true' : 'false'}">
          <div class="sb-game-card__top">
            ${renderStatusBadge(game)}
            ${dateStr ? `<time class="sb-game-card__time">${escapeHtml(dateStr)}</time>` : ''}
          </div>
          ${renderScoreLine(game)}
          ${game.venue ? `<p class="sb-game-card__venue">${escapeHtml(game.venue)}</p>` : ''}
        </button>
        <div class="sb-game-card__detail" ${expanded ? '' : 'hidden'}>
          <div class="sb-team-cards">
            ${renderTeamStatCard('away', teamDetails[awayKey] || { team: game.awayTeam, teamKey: awayKey }, teamDetails[awayKey]?.loading)}
            ${renderTeamStatCard('home', teamDetails[homeKey] || { team: game.homeTeam, teamKey: homeKey }, teamDetails[homeKey]?.loading)}
          </div>
        </div>
      </article>`;
  }

  function renderSummaryTiles(games) {
    const live = games.filter((g) => String(g.statusState || g.state || '').toLowerCase() === 'in').length;
    const final = games.filter((g) => {
      const s = String(g.statusState || g.state || '').toLowerCase();
      return s === 'post' || String(g.status || '').toLowerCase().includes('final');
    }).length;
    const upcoming = games.length - live - final;
    return `
      <div class="summary-tiles summary-tiles--compact sb-summary">
        <div class="summary-tile tile--live"><span class="summary-tile__count">${live}</span><span class="summary-tile__label">Live</span></div>
        <div class="summary-tile tile--wait"><span class="summary-tile__count">${upcoming}</span><span class="summary-tile__label">Upcoming</span></div>
        <div class="summary-tile tile--pass"><span class="summary-tile__count">${final}</span><span class="summary-tile__label">Final</span></div>
      </div>`;
  }

  function renderScoreboardPanel(data, options = {}) {
    const games = gamesFromPayload(data);
    const { expandedGameId = null, teamDetails = {} } = options;
    const meta = data?.meta || {};
    const source = data?.source || meta.source;
    const updated = data?.lastUpdated || meta.lastUpdated;

    return `
      <div class="scoreboard-panel">
        <header class="panel-header">
          <h2 class="panel-title">Scoreboard</h2>
          <p class="panel-desc">
            ${games.length} game${games.length === 1 ? '' : 's'}
            ${source ? ` · ${escapeHtml(source)}` : ''}
            ${updated ? ` · ${escapeHtml(new Date(updated).toLocaleTimeString())}` : ''}
            ${data?.isLive === false ? ' · cached' : ''}
          </p>
        </header>
        ${data?.warning ? `<p class="panel-warning">${escapeHtml(data.warning)}</p>` : ''}
        ${data?.error ? `<p class="panel-warning">${escapeHtml(data.error)}</p>` : ''}
        ${games.length ? renderSummaryTiles(games) : ''}
        ${games.length === 0
          ? '<p class="empty-state">No games on today\'s scoreboard.</p>'
          : `<div class="sb-game-grid">${games.map((g) => renderGameCard(g, {
              expanded: (g.id || `${g.away}-${g.home}`) === expandedGameId,
              teamDetails,
            })).join('')}</div>`}
      </div>`;
  }

  function bindScoreboardActions(panel, callbacks = {}) {
    if (!panel) return;

    panel.querySelectorAll('.sb-game-card__toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const gameId = btn.dataset.gameId;
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        if (callbacks.onToggleGame) callbacks.onToggleGame(gameId, !expanded);
      });
    });

    panel.querySelectorAll('.sb-players-toggle').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const key = btn.dataset.teamKey;
        const container = panel.querySelector(`[data-players-for="${key}"]`);
        if (!container) return;
        const open = btn.getAttribute('aria-expanded') === 'true';
        if (open) {
          container.hidden = true;
          btn.setAttribute('aria-expanded', 'false');
          return;
        }
        btn.setAttribute('aria-expanded', 'true');
        container.hidden = false;
        if (container.dataset.loaded === '1') return;
        container.innerHTML = '<p class="loading-inline">Loading players…</p>';
        try {
          const data = callbacks.onLoadPlayers ? await callbacks.onLoadPlayers(key) : null;
          const players = data?.players || data?.roster || [];
          container.innerHTML = renderPlayersTable(players, data?.warning);
          container.dataset.loaded = '1';
        } catch (err) {
          container.innerHTML = `<p class="panel-warning">${escapeHtml(err.message || 'Failed to load players')}</p>`;
        }
      });
    });
  }

  global.ScoreboardView = {
    renderScoreboardPanel,
    bindScoreboardActions,
    gamesFromPayload,
    renderPlayersTable,
  };
})(window);
