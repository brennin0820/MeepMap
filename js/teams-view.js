/**
 * Team/s tab — league scouting board + drill-in team profile.
 *
 * Answers "what kind of team am I dealing with before I price a bet?"
 * Board reads enriched team list from /api/teams; profile lazy-loads
 * /api/teams/:key/stats and /api/teams/:key/players on demand.
 * Pure GUI: derives trend, health, and betting-relevance labels from
 * existing metrics. No new backend endpoints required.
 */
(function (global) {
  const { escapeHtml } = global.AlertsUI || { escapeHtml: (s) => String(s ?? '') };

  const SEGMENTS = [
    { id: 'all', label: 'All' },
    { id: 'contenders', label: 'Contenders' },
    { id: 'midtable', label: 'Mid-table' },
    { id: 'fade', label: 'Fade watch' },
  ];

  const SORTS = [
    { id: 'netRating', label: 'Net Rating' },
    { id: 'last5', label: 'Last 5' },
    { id: 'offRating', label: 'Offense' },
    { id: 'defRating', label: 'Defense' },
    { id: 'pace', label: 'Pace' },
    { id: 'injuryRisk', label: 'Injury Risk' },
  ];

  function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function fmtNum(value, digits = 1) {
    const n = num(value);
    if (n == null) return '—';
    if (Number.isInteger(n) && digits === 1) return String(n);
    return n.toFixed(digits);
  }

  function fmtSigned(value, digits = 1) {
    const n = num(value);
    if (n == null) return '—';
    return `${n > 0 ? '+' : ''}${n.toFixed(digits)}`;
  }

  function fmtPct(value) {
    const n = num(value);
    if (n == null) return '—';
    if (n > 0 && n <= 1) return `${(n * 100).toFixed(1)}%`;
    return `${n.toFixed(1)}%`;
  }

  function winRate(record) {
    if (!record || typeof record !== 'string') return null;
    const m = record.match(/^(\d+)-(\d+)$/);
    if (!m) return null;
    const w = Number(m[1]);
    const l = Number(m[2]);
    if (w + l === 0) return null;
    return w / (w + l);
  }

  /** Derive a scouting net-rating-style value used for sorting/segmentation. */
  function netRatingOf(team) {
    return num(team.netRating) ?? num(team.avgMargin) ?? 0;
  }

  /** Contenders / Mid-table / Fade watch segmentation from net strength. */
  function segmentOf(team) {
    const net = netRatingOf(team);
    if (net >= 5) return 'contenders';
    if (net <= -5) return 'fade';
    return 'midtable';
  }

  /** Trend badge: Rising / Stable / Sliding from recent form vs season. */
  function trendOf(team) {
    const momentum = team.profile?.momentum;
    if (momentum === 'Hot') return { label: 'Rising', cls: 'is-up' };
    if (momentum === 'Cold') return { label: 'Sliding', cls: 'is-down' };
    const recent = winRate(team.profile?.last5 || team.last5);
    const season = winRate(team.record);
    if (recent != null && season != null) {
      if (recent - season >= 0.18) return { label: 'Rising', cls: 'is-up' };
      if (season - recent >= 0.18) return { label: 'Sliding', cls: 'is-down' };
    }
    return { label: 'Stable', cls: 'is-flat' };
  }

  /** Health badge: Clean / Watch / Thin from active injuries for the team. */
  function injuryCountFor(team, injuries) {
    const list = (injuries && injuries.injuries) || [];
    if (!list.length) return { out: 0, dtd: 0, known: false };
    const name = (team.name || '').toLowerCase();
    const key = (team.key || '').toLowerCase();
    let out = 0;
    let dtd = 0;
    let matched = 0;
    list.forEach((entry) => {
      const tName = String(entry.teamName || '').toLowerCase();
      const tKey = String(entry.teamKey || '').toLowerCase();
      const match = (name && tName && tName === name) || (key && tKey && tKey === key);
      if (!match) return;
      matched += 1;
      const status = String(entry.status || '').toLowerCase();
      if (status === 'out' || status === 'suspended' || status === 'doubtful') out += 1;
      else dtd += 1;
    });
    return { out, dtd, known: matched > 0 || list.length > 0 };
  }

  function healthOf(team, injuries) {
    const { out, dtd } = injuryCountFor(team, injuries);
    const total = out + dtd;
    if (out >= 3 || total >= 4) return { label: 'Thin', cls: 'is-down', out, dtd };
    if (total >= 1) return { label: 'Watch', cls: 'is-warn', out, dtd };
    return { label: 'Clean', cls: 'is-up', out, dtd };
  }

  /**
   * Betting-relevance scouting labels derived from existing metrics.
   * Short, explicit, decision-useful — not decorative prose.
   */
  function bettingRelevance(team) {
    const labels = [];
    const off = num(team.offRating);
    const def = num(team.defRating);
    const net = netRatingOf(team);
    const pace = num(team.pace);
    const recent = winRate(team.profile?.last5 || team.last5);
    const season = winRate(team.record);

    if (off != null && off >= 109) labels.push('Elite offense — total/over leans');
    if (def != null && def <= 101) labels.push('Elite defense — under-friendly');
    if (def != null && def >= 108) labels.push('Leaky defense — fade in shootouts');
    if (pace != null && pace >= 97) labels.push('Fast pace creates volatile totals');
    if (pace != null && pace <= 93.5) labels.push('Slow pace suppresses totals');
    if (net >= 8) labels.push('Strong favorite profile');
    if (net <= -6) labels.push('Weak underdog cover profile');

    if (recent != null && season != null) {
      if (season - recent >= 0.2) labels.push('Record stronger than recent form');
      if (recent - season >= 0.2) labels.push('Trending above season baseline');
    }
    if (!labels.length) labels.push('Balanced profile — matchup dependent');
    return labels.slice(0, 4);
  }

  function trendBadge(trend) {
    return `<span class="scout-badge scout-badge--${trend.cls}" title="Recent trend">${escapeHtml(trend.label)}</span>`;
  }

  function healthBadge(health) {
    const detail = health.out || health.dtd
      ? `${health.out} out${health.dtd ? `, ${health.dtd} DTD` : ''}`
      : 'No reported absences';
    return `<span class="scout-badge scout-badge--${health.cls}" title="${escapeHtml(detail)}">${escapeHtml(health.label)}</span>`;
  }

  function statMini(label, value) {
    return `
      <div class="team-card__stat">
        <span class="team-card__stat-label">${escapeHtml(label)}</span>
        <span class="team-card__stat-value">${escapeHtml(value)}</span>
      </div>`;
  }

  function renderTeamCard(team, injuries) {
    const key = escapeHtml(team.key || '');
    const trend = trendOf(team);
    const health = healthOf(team, injuries);
    const net = netRatingOf(team);
    const netCls = net > 1.5 ? 'is-pos' : net < -1.5 ? 'is-neg' : '';
    return `
      <button type="button" class="team-card" data-team-key="${key}" aria-label="Open ${escapeHtml(team.name || team.key)} profile">
        <header class="team-card__header">
          <div class="team-card__identity">
            <span class="team-card__name">${escapeHtml(team.name || team.key)}</span>
            <span class="team-card__record">${escapeHtml(team.record || '—')}</span>
          </div>
          <div class="team-card__badges">
            ${trendBadge(trend)}
            ${healthBadge(health)}
          </div>
        </header>
        <div class="team-card__net ${netCls}">
          <span class="team-card__net-value">${fmtSigned(net)}</span>
          <span class="team-card__net-label">Net rating</span>
        </div>
        <div class="team-card__stats">
          ${statMini('Last 5', team.profile?.last5 || team.last5 || '—')}
          ${statMini('Last 10', team.profile?.last10 || team.last10 || '—')}
          ${statMini('OFF', fmtNum(team.offRating))}
          ${statMini('DEF', fmtNum(team.defRating))}
          ${statMini('Pace', fmtNum(team.pace))}
          ${statMini('Home', team.profile?.homeRecord || team.homeRecord || '—')}
        </div>
      </button>`;
  }

  function sortTeams(teams, sortKey, injuries) {
    const copy = [...teams];
    const get = (t) => {
      switch (sortKey) {
        case 'last5': return winRate(t.profile?.last5 || t.last5) ?? -1;
        case 'offRating': return num(t.offRating) ?? -Infinity;
        case 'defRating': return num(t.defRating) ?? Infinity;
        case 'pace': return num(t.pace) ?? -Infinity;
        case 'injuryRisk': {
          const h = injuryCountFor(t, injuries);
          return h.out * 2 + h.dtd;
        }
        case 'netRating':
        default:
          return netRatingOf(t);
      }
    };
    // Defense sorts ascending (lower is better); everything else descending.
    const ascending = sortKey === 'defRating';
    copy.sort((a, b) => (ascending ? get(a) - get(b) : get(b) - get(a)));
    return copy;
  }

  function filterTeams(teams, ui, playingTodayKeys) {
    const search = (ui.search || '').trim().toLowerCase();
    return teams.filter((t) => {
      if (ui.segment && ui.segment !== 'all' && segmentOf(t) !== ui.segment) return false;
      if (ui.todayOnly && playingTodayKeys && !playingTodayKeys.has((t.key || '').toLowerCase())) return false;
      if (search) {
        const hay = `${t.name || ''} ${t.key || ''}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
  }

  function renderBoardControls(ui, total, shown) {
    return `
      <div class="teams-controls">
        <div class="teams-controls__search">
          <input id="teams-search" class="teams-search" type="search" placeholder="Search teams…"
                 value="${escapeHtml(ui.search || '')}" aria-label="Search teams" />
        </div>
        <div class="teams-controls__segments" role="group" aria-label="Filter segment">
          ${SEGMENTS.map((s) => `
            <button type="button" class="filter-btn ${s.id === (ui.segment || 'all') ? 'filter-btn--active' : ''}" data-segment="${s.id}">${escapeHtml(s.label)}</button>
          `).join('')}
        </div>
        <div class="teams-controls__row">
          <label class="teams-sort">
            <span>Sort</span>
            <select id="teams-sort" class="teams-sort__select">
              ${SORTS.map((s) => `<option value="${s.id}"${s.id === (ui.sort || 'netRating') ? ' selected' : ''}>${escapeHtml(s.label)}</option>`).join('')}
            </select>
          </label>
          <label class="teams-today">
            <input id="teams-today" type="checkbox" ${ui.todayOnly ? 'checked' : ''} />
            <span>Playing today</span>
          </label>
          <span class="teams-count">${shown} of ${total}</span>
        </div>
      </div>`;
  }

  function renderBoard(state) {
    const ui = state.teamsUI || {};
    const teams = state.teams || [];
    const injuries = state.injuries;
    const playingTodayKeys = state.playingTodayKeys || null;

    const filtered = filterTeams(teams, ui, playingTodayKeys);
    const sorted = sortTeams(filtered, ui.sort || 'netRating', injuries);

    const grid = sorted.length
      ? `<div class="teams-grid">${sorted.map((t) => renderTeamCard(t, injuries)).join('')}</div>`
      : '<p class="empty-state">No teams match these filters.</p>';

    return `
      <div class="teams-panel">
        <header class="panel-header">
          <h2 class="panel-title">Team Scouting</h2>
          <p class="panel-desc">Read the league before you price a bet — form, efficiency, health, and betting relevance.</p>
        </header>
        ${renderBoardControls(ui, teams.length, sorted.length)}
        ${grid}
      </div>`;
  }

  function profileStat(label, value, sub) {
    return `
      <div class="team-profile__stat">
        <span class="team-profile__stat-value">${escapeHtml(value)}</span>
        <span class="team-profile__stat-label">${escapeHtml(label)}</span>
        ${sub ? `<span class="team-profile__stat-sub">${escapeHtml(sub)}</span>` : ''}
      </div>`;
  }

  function renderProfileLoading(team) {
    return `
      <div class="teams-panel teams-panel--profile">
        <div class="team-profile__topbar">
          <button type="button" class="btn btn--sm btn--ghost" data-teams-back>← League board</button>
        </div>
        <header class="team-profile__header">
          <h2 class="panel-title">${escapeHtml(team?.name || 'Team')}</h2>
          <p class="panel-desc">Loading scouting profile…</p>
        </header>
        <p class="loading-inline">Fetching team stats…</p>
      </div>`;
  }

  function renderProfile(state) {
    const key = state.teamsUI?.selectedTeamKey;
    const boardTeam = (state.teams || []).find((t) => (t.key || '').toLowerCase() === String(key).toLowerCase());
    const detail = state.teamsDetails?.[key];

    if (!detail || detail.loading) {
      return renderProfileLoading(boardTeam || { name: key });
    }
    if (detail.error) {
      return `
        <div class="teams-panel teams-panel--profile">
          <div class="team-profile__topbar">
            <button type="button" class="btn btn--sm btn--ghost" data-teams-back>← League board</button>
          </div>
          <header class="team-profile__header">
            <h2 class="panel-title">${escapeHtml(boardTeam?.name || key)}</h2>
          </header>
          <p class="panel-warning">${escapeHtml(detail.error)}</p>
        </div>`;
    }

    const stats = detail.stats || {};
    const merged = { ...boardTeam, ...stats, record: stats.record || boardTeam?.record, name: detail.name || boardTeam?.name, key };
    const profile = detail.profile || boardTeam?.profile || {};
    merged.profile = profile;
    const trend = trendOf(merged);
    const health = healthOf(merged, state.injuries);
    const relevance = bettingRelevance(merged);
    const players = state.teamsPlayers?.[key];

    return `
      <div class="teams-panel teams-panel--profile">
        <div class="team-profile__topbar">
          <button type="button" class="btn btn--sm btn--ghost" data-teams-back>← League board</button>
          ${detail.warning ? `<span class="team-profile__warn" title="${escapeHtml(detail.warning)}">data caveats</span>` : ''}
        </div>

        <header class="team-profile__header">
          <div>
            <h2 class="panel-title">${escapeHtml(merged.name || key)}</h2>
            <p class="panel-desc">${escapeHtml(merged.record || '—')} · ${escapeHtml(profile.healthGrade ? `Health grade ${profile.healthGrade}` : 'Season scouting profile')}</p>
          </div>
          <div class="team-profile__badges">
            ${trendBadge(trend)}
            ${healthBadge(health)}
          </div>
        </header>

        <section class="team-profile__section">
          <h3 class="section-title">Snapshot</h3>
          <div class="team-profile__grid">
            ${profileStat('Net rating', fmtSigned(netRatingOf(merged)))}
            ${profileStat('Pace', fmtNum(merged.pace))}
            ${profileStat('Last 5', merged.profile?.last5 || merged.last5 || '—')}
            ${profileStat('Last 10', merged.profile?.last10 || merged.last10 || '—')}
            ${profileStat('Home', merged.profile?.homeRecord || merged.homeRecord || '—')}
            ${profileStat('Away', merged.profile?.awayRecord || merged.awayRecord || '—')}
          </div>
        </section>

        <section class="team-profile__section">
          <h3 class="section-title">Style profile</h3>
          <div class="team-profile__grid">
            ${profileStat('Off rating', fmtNum(merged.offRating))}
            ${profileStat('Def rating', fmtNum(merged.defRating))}
            ${profileStat('PPG', fmtNum(merged.ppg ?? merged.pointsPerGame))}
            ${profileStat('Opp PPG', fmtNum(merged.oppPpg))}
            ${profileStat('FG%', fmtPct(merged.fgPct))}
            ${profileStat('3P%', fmtPct(merged.threePtPct))}
            ${profileStat('FT%', fmtPct(merged.ftPct))}
            ${profileStat('REB', fmtNum(merged.reboundsPerGame))}
            ${profileStat('AST', fmtNum(merged.assistsPerGame))}
            ${profileStat('TO', fmtNum(merged.turnoversPerGame))}
          </div>
        </section>

        <section class="team-profile__section team-profile__section--relevance">
          <h3 class="section-title">Betting relevance</h3>
          <ul class="team-profile__relevance">
            ${relevance.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}
          </ul>
        </section>

        <section class="team-profile__section">
          <div class="section-heading">
            <h3 class="section-title">Player production</h3>
            ${players && players.loading ? '<span class="loading-inline">loading…</span>' : ''}
          </div>
          <div class="team-profile__players">
            ${renderPlayers(players)}
          </div>
        </section>
      </div>`;
  }

  function renderPlayers(players) {
    if (!players || players.loading) {
      return '<p class="loading-inline">Loading rotation…</p>';
    }
    if (players.error) {
      return `<p class="panel-warning">${escapeHtml(players.error)}</p>`;
    }
    const list = players.players || players.roster || [];
    if (!list.length) {
      return `<p class="empty-state">${escapeHtml(players.warning || 'No player production data available.')}</p>`;
    }
    const stat = (p, ...keys) => {
      const sources = [p.stats, p.season, p];
      for (const s of sources) {
        if (!s) continue;
        for (const k of keys) {
          if (s[k] != null && s[k] !== '') return s[k];
        }
      }
      return null;
    };
    const sorted = [...list].sort((a, b) =>
      Number(stat(b, 'ppg', 'pointsPerGame', 'pts') || 0) - Number(stat(a, 'ppg', 'pointsPerGame', 'pts') || 0)
    ).slice(0, 12);
    return `
      ${players.warning ? `<p class="panel-warning">${escapeHtml(players.warning)}</p>` : ''}
      <div class="table-wrap">
        <table class="sb-players-table">
          <thead>
            <tr><th>Player</th><th>Pos</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>FG%</th></tr>
          </thead>
          <tbody>
            ${sorted.map((p) => `
              <tr>
                <td>${escapeHtml(p.name || p.player || p.displayName || '—')}</td>
                <td>${escapeHtml(p.position || p.pos || '—')}</td>
                <td>${escapeHtml(fmtNum(stat(p, 'mpg', 'minutesPerGame', 'min')))}</td>
                <td>${escapeHtml(fmtNum(stat(p, 'ppg', 'pointsPerGame', 'pts')))}</td>
                <td>${escapeHtml(fmtNum(stat(p, 'rpg', 'reboundsPerGame', 'reb')))}</td>
                <td>${escapeHtml(fmtNum(stat(p, 'apg', 'assistsPerGame', 'ast')))}</td>
                <td>${escapeHtml(fmtPct(stat(p, 'fgPct', 'fieldGoalPct')))}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function renderTeamsPanel(state) {
    if (state.teamsUI?.selectedTeamKey) {
      return renderProfile(state);
    }
    return renderBoard(state);
  }

  function bindTeamsActions(panel, handlers = {}) {
    if (!panel) return;

    const searchEl = panel.querySelector('#teams-search');
    if (searchEl) {
      searchEl.addEventListener('input', (e) => handlers.onSearch?.(e.target.value));
    }

    panel.querySelectorAll('[data-segment]').forEach((btn) => {
      btn.addEventListener('click', () => handlers.onSegment?.(btn.dataset.segment));
    });

    const sortEl = panel.querySelector('#teams-sort');
    if (sortEl) {
      sortEl.addEventListener('change', (e) => handlers.onSort?.(e.target.value));
    }

    const todayEl = panel.querySelector('#teams-today');
    if (todayEl) {
      todayEl.addEventListener('change', (e) => handlers.onTodayToggle?.(e.target.checked));
    }

    panel.querySelectorAll('.team-card').forEach((card) => {
      card.addEventListener('click', () => handlers.onOpenTeam?.(card.dataset.teamKey));
    });

    const backBtn = panel.querySelector('[data-teams-back]');
    if (backBtn) {
      backBtn.addEventListener('click', () => handlers.onBack?.());
    }
  }

  global.TeamsView = {
    renderTeamsPanel,
    bindTeamsActions,
    segmentOf,
    trendOf,
    healthOf,
    bettingRelevance,
  };
})(window);
