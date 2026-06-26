/**
 * Team/s tab — team board + profile drill-in.
 * Ports the iOS TeamsStore/TeamsView (filter segments, sort, trend/health
 * labels, betting notes). Roster Intel Dossier is intentionally skipped (V1).
 */
(function (global) {
  const { escapeHtml } = global.AlertsUI;

  const SEGMENTS = [
    { key: 'all', label: 'All' },
    { key: 'contenders', label: 'Contenders' },
    { key: 'midTable', label: 'Mid-table' },
    { key: 'fadeWatch', label: 'Fade watch' },
  ];

  const SORTS = [
    { key: 'netRating', label: 'Net Rating' },
    { key: 'last5', label: 'Last 5' },
    { key: 'offense', label: 'Off Rating' },
    { key: 'defense', label: 'Def Rating' },
    { key: 'pace', label: 'Pace' },
    { key: 'injuryRisk', label: 'Injury Risk' },
  ];

  const DEFAULT_FILTER = { search: '', segment: 'all', sort: 'netRating', today: false };

  // ---- pure helpers (mirror TeamsStore) -----------------------------------

  function fmtStat(v) {
    if (v == null || v === '' || Number.isNaN(Number(v))) return '—';
    return Number(v).toFixed(1);
  }

  function parseRecordWins(record) {
    if (!record || typeof record !== 'string') return 0;
    const wins = parseInt(record.split('-')[0], 10);
    return Number.isFinite(wins) ? wins : 0;
  }

  function severityScore(status) {
    const s = String(status || '').toLowerCase();
    if (s.includes('out')) return 3;
    if (s.includes('question') || s.includes('doubt')) return 2;
    if (s.includes('probable')) return 1;
    return 0;
  }

  function injuriesForTeam(injuries, teamKey) {
    const key = String(teamKey || '').toLowerCase();
    return (injuries || [])
      .filter((i) => String(i.teamKey || '').toLowerCase() === key)
      .sort((a, b) => severityScore(b.status) - severityScore(a.status));
  }

  function injuryRiskScore(injuries, teamKey) {
    return injuriesForTeam(injuries, teamKey).reduce((sum, i) => sum + severityScore(i.status), 0);
  }

  function healthLabel(team, injuries) {
    const teamInjuries = injuriesForTeam(injuries, team.key);
    const severe = teamInjuries.filter((i) => severityScore(i.status) >= 2).length;
    if (severe >= 2) return 'Thin';
    if (severe === 1 || teamInjuries.length) return 'Watch';
    return 'Clean';
  }

  function trendLabel(team) {
    const last5Wins = parseRecordWins(team.last5);
    const last10Wins = parseRecordWins(team.last10);
    const net = team.netRating ?? 0;
    if (last5Wins >= 4 && net >= 4) return 'Rising';
    if (last5Wins <= 1 || (last10Wins <= 3 && net < 0)) return 'Sliding';
    return 'Stable';
  }

  function bettingNotes(team, detail, injuries) {
    const stats = detail?.stats;
    const net = stats?.netRating ?? team.netRating;
    const pace = stats?.pace ?? team.pace;
    const off = team.offRating;
    const def = team.defRating;
    const avgMargin = team.avgMargin;
    const trend = trendLabel(team);
    const notes = [];

    if (net != null && avgMargin != null && net > 6 && avgMargin < 4) {
      notes.push('Underlying efficiency is stronger than the win margin.');
    }
    if (pace != null && pace >= 97) {
      notes.push('Fast pace increases total volatility.');
    }
    if (def != null && def <= 101) {
      notes.push('Defense travels well when the offense cools off.');
    }
    if (off != null && off >= 109 && trend === 'Sliding') {
      notes.push('Scoring ceiling is intact, but recent form is slipping.');
    }
    if (healthLabel(team, injuries) === 'Thin') {
      notes.push('Availability risk can invalidate pregame reads quickly.');
    }
    if (notes.length === 0 && net != null) {
      notes.push(
        net >= 0
          ? 'Usable team when price matches the profile.'
          : 'Price-sensitive team that needs matchup help.'
      );
    }
    return notes.slice(0, 3);
  }

  function metric(primary, fallback) {
    if (primary != null) return Number(primary);
    if (fallback != null) return Number(fallback);
    return -Infinity;
  }

  function defensiveSortValue(team) {
    if (team.defRating != null) return -Number(team.defRating);
    if (team.oppPpg != null) return -Number(team.oppPpg);
    return -Infinity;
  }

  function sortKey(team, sort, injuries) {
    switch (sort) {
      case 'last5':
        return parseRecordWins(team.last5);
      case 'offense':
        return metric(team.offRating, team.ppg);
      case 'defense':
        return defensiveSortValue(team);
      case 'pace':
        return metric(team.pace, team.ppg);
      case 'injuryRisk':
        return injuryRiskScore(injuries, team.key);
      case 'netRating':
      default:
        return metric(team.netRating, team.avgMargin);
    }
  }

  function matchesSearch(team, needle) {
    if (!needle) return true;
    const n = needle.toLowerCase();
    return (
      String(team.name || '').toLowerCase().includes(n) ||
      String(team.key || '').toLowerCase().includes(n) ||
      String(team.abbreviation || '').toLowerCase().includes(n)
    );
  }

  function matchesSegment(team, segment) {
    const net = team.netRating ?? 0;
    switch (segment) {
      case 'contenders':
        return net >= 6 || (team.wins ?? 0) >= 10;
      case 'midTable':
        return net >= -2 && net < 6;
      case 'fadeWatch':
        return net < -2 || parseRecordWins(team.last5) <= 1;
      case 'all':
      default:
        return true;
    }
  }

  function toTodaySet(todayKeys) {
    if (todayKeys instanceof Set) return todayKeys;
    return new Set((todayKeys || []).map((k) => String(k).toLowerCase()));
  }

  function filterTeams(teams, filter, injuries, todaySet) {
    const f = { ...DEFAULT_FILTER, ...(filter || {}) };
    return (teams || [])
      .filter((t) => matchesSearch(t, f.search))
      .filter((t) => matchesSegment(t, f.segment))
      .filter((t) => !f.today || todaySet.has(String(t.key || '').toLowerCase()))
      .slice()
      .sort((a, b) => sortKey(b, f.sort, injuries) - sortKey(a, f.sort, injuries));
  }

  // ---- rendering ----------------------------------------------------------

  function teamInitials(team) {
    const name = String(team.name || team.key || '');
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    const key = String(team.key || '').toUpperCase();
    return key.slice(0, 2) || '??';
  }

  function brandingStyle(branding) {
    if (!branding?.colors) return '';
    const c = branding.colors;
    const vars = [];
    if (c.primary) vars.push(`--team-primary:${c.primary}`);
    if (c.secondary) vars.push(`--team-secondary:${c.secondary}`);
    if (c.accent) vars.push(`--team-accent:${c.accent}`);
    if (c.text) vars.push(`--team-text:${c.text}`);
    return vars.length ? vars.join(';') : '';
  }

  function renderSigil(branding, team, sizeClass = 'team-sigil--lg') {
    const style = brandingStyle(branding);
    const styleAttr = style ? ` style="${style}"` : '';
    const sigil = branding?.sigil;
    const alt = escapeHtml(sigil?.alt || team.name || 'Team logo');

    if (sigil?.kind === 'inline') {
      return `<span class="team-sigil ${sizeClass}"${styleAttr} role="img" aria-label="${alt}">${sigil.value}</span>`;
    }
    if (sigil?.kind === 'local' || sigil?.kind === 'cdn') {
      const src = escapeHtml(sigil.value);
      return `<span class="team-sigil ${sizeClass}"${styleAttr}><img src="${src}" alt="${alt}" loading="lazy" /></span>`;
    }
    const initials = escapeHtml(teamInitials(team));
    return `<span class="team-sigil team-sigil--initials ${sizeClass}"${styleAttr} aria-label="${escapeHtml(team.name || '')}">${initials}</span>`;
  }

  function trendClass(label) {
    if (label === 'Rising') return 'team-pill--rising';
    if (label === 'Sliding') return 'team-pill--sliding';
    return 'team-pill--stable';
  }

  function healthClass(label) {
    if (label === 'Thin') return 'team-pill--thin';
    if (label === 'Watch') return 'team-pill--watch';
    return 'team-pill--clean';
  }

  function renderControls(filter) {
    const f = { ...DEFAULT_FILTER, ...(filter || {}) };
    const segs = SEGMENTS.map(
      (s) =>
        `<button type="button" class="team-seg${s.key === f.segment ? ' team-seg--active' : ''}" data-seg="${s.key}" aria-pressed="${s.key === f.segment}">${escapeHtml(s.label)}</button>`
    ).join('');
    const sortOpts = SORTS.map(
      (s) => `<option value="${s.key}"${s.key === f.sort ? ' selected' : ''}>${escapeHtml(s.label)}</option>`
    ).join('');
    return `
      <div class="team-board__controls">
        <input id="teams-search" class="team-search" type="search" placeholder="Search teams"
          value="${escapeHtml(f.search)}" autocomplete="off" aria-label="Search teams" />
        <div class="team-segs" role="group" aria-label="Segment filter">${segs}</div>
        <div class="team-board__row">
          <label class="team-sort-label">Sort
            <select id="teams-sort" class="team-sort">${sortOpts}</select>
          </label>
          <label class="team-today">
            <input id="teams-today" type="checkbox"${f.today ? ' checked' : ''} /> Playing today
          </label>
        </div>
      </div>`;
  }

  function renderSummary(filtered, injuries, todaySet) {
    const playing = filtered.filter((t) => todaySet.has(String(t.key || '').toLowerCase())).length;
    const thin = filtered.filter((t) => healthLabel(t, injuries) === 'Thin').length;
    return `
      <div class="summary-tiles summary-tiles--compact team-summary">
        <div class="summary-tile tile--pass"><span class="summary-tile__count">${filtered.length}</span><span class="summary-tile__label">Visible</span></div>
        <div class="summary-tile tile--wait"><span class="summary-tile__count">${playing}</span><span class="summary-tile__label">Playing</span></div>
        <div class="summary-tile tile--live"><span class="summary-tile__count">${thin}</span><span class="summary-tile__label">Thin</span></div>
      </div>`;
  }

  function metricCell(label, value) {
    return `<div class="team-metric"><span class="team-metric__label">${escapeHtml(label)}</span><span class="team-metric__value">${escapeHtml(value)}</span></div>`;
  }

  function renderPlayerProduction(playersPayload) {
    if (!playersPayload || (playersPayload.loading && !playersPayload.players)) {
      return '<p class="loading-inline">Loading players…</p>';
    }
    const players = playersPayload?.players || [];
    if (!players.length) {
      return `<p class="empty-state">${escapeHtml(playersPayload?.warning || 'No player stats available.')}</p>`;
    }
    const statVal = (p, ...keys) => {
      const s = p.stats || p;
      for (const k of keys) {
        if (s[k] != null && s[k] !== '') return s[k];
      }
      return null;
    };
    const sorted = [...players].sort(
      (a, b) => (Number(statVal(b, 'ppg', 'pointsPerGame', 'pts')) || 0) - (Number(statVal(a, 'ppg', 'pointsPerGame', 'pts')) || 0)
    );
    const rows = sorted
      .slice(0, 8)
      .map((p) => {
        const min = statVal(p, 'mpg', 'minutesPerGame', 'min');
        const pts = statVal(p, 'ppg', 'pointsPerGame', 'pts');
        const reb = statVal(p, 'rpg', 'reboundsPerGame', 'reb');
        const ast = statVal(p, 'apg', 'assistsPerGame', 'ast');
        return `<tr>
          <td>${escapeHtml(p.name || p.player || p.displayName || '—')}</td>
          <td>${escapeHtml(p.position || p.pos || '—')}</td>
          <td>${escapeHtml(fmtStat(min))}</td>
          <td>${escapeHtml(fmtStat(pts))}</td>
          <td>${escapeHtml(fmtStat(reb))}</td>
          <td>${escapeHtml(fmtStat(ast))}</td>
        </tr>`;
      })
      .join('');
    return `
      ${playersPayload?.warning ? `<p class="panel-warning">${escapeHtml(playersPayload.warning)}</p>` : ''}
      <div class="table-wrap">
        <table class="team-players-table">
          <thead><tr><th>Player</th><th>Pos</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function renderAvailability(team, injuries, detail) {
    const teamInjuries = injuriesForTeam(injuries, team.key);
    const warn = detail?.warning ? `<p class="panel-warning">${escapeHtml(detail.warning)}</p>` : '';
    if (!teamInjuries.length) {
      return `${warn}<p class="empty-state">No active injury entries for this team.</p>`;
    }
    const items = teamInjuries
      .map((i) => {
        const sev = severityScore(i.status);
        const cls = sev >= 3 ? 'injury--out' : sev >= 2 ? 'injury--questionable' : 'injury--other';
        return `<li class="team-avail ${cls}">
          <span class="team-avail__player">${escapeHtml(i.player || i.playerName || '—')}</span>
          <span class="team-avail__status">${escapeHtml(i.status || '—')}</span>
          ${i.note ? `<span class="team-avail__note">${escapeHtml(i.note)}</span>` : ''}
        </li>`;
      })
      .join('');
    return `${warn}<ul class="team-avail-list">${items}</ul>`;
  }

  function renderProfile(team, model) {
    const detail = model.teamDetails[String(team.key).toLowerCase()] || null;
    const playersPayload = model.playersCache[String(team.key).toLowerCase()] || null;
    const detailLoading = detail?.loading;
    const stats = detail?.stats;

    const styleGrid = [
      ['Off Rating', fmtStat(team.offRating)],
      ['Def Rating', fmtStat(team.defRating)],
      ['Net Rating', fmtStat(stats?.netRating ?? team.netRating)],
      ['Pace', fmtStat(stats?.pace ?? team.pace)],
      ['PPG', fmtStat(stats?.ppg ?? team.ppg)],
      ['Opp PPG', fmtStat(stats?.oppPpg ?? team.oppPpg)],
    ];
    const formGrid = [
      ['Last 5', team.last5 || '—'],
      ['Last 10', team.last10 || '—'],
      ['Home', team.homeRecord || '—'],
      ['Away', team.awayRecord || '—'],
      ['Avg Margin', fmtStat(team.avgMargin)],
      ['Record', team.record || '—'],
    ];
    const notes = bettingNotes(team, detail, model.injuries)
      .map((n) => `<li>${escapeHtml(n)}</li>`)
      .join('');

    return `
      <div class="team-profile">
        ${detail?.error ? `<p class="panel-warning">${escapeHtml(detail.error)}</p>` : ''}
        <section class="team-profile__section">
          <h4 class="team-profile__title">Form &amp; Splits</h4>
          <div class="team-metrics">${formGrid.map(([l, v]) => metricCell(l, v)).join('')}</div>
        </section>
        <section class="team-profile__section">
          <h4 class="team-profile__title">Style Profile ${detailLoading ? '<span class="loading-inline">· refreshing</span>' : ''}</h4>
          <div class="team-metrics">${styleGrid.map(([l, v]) => metricCell(l, v)).join('')}</div>
        </section>
        <section class="team-profile__section">
          <h4 class="team-profile__title">Availability</h4>
          ${renderAvailability(team, model.injuries, detail)}
        </section>
        <section class="team-profile__section">
          <h4 class="team-profile__title">Player Production</h4>
          ${renderPlayerProduction(playersPayload)}
        </section>
        <section class="team-profile__section">
          <h4 class="team-profile__title">Betting Relevance</h4>
          <ul class="team-notes">${notes}</ul>
        </section>
      </div>`;
  }

  function renderCard(team, model, todaySet) {
    const key = String(team.key || '');
    const expanded = model.expandedTeamKey === key.toLowerCase();
    const trend = trendLabel(team);
    const health = healthLabel(team, model.injuries);
    const playingToday = todaySet.has(key.toLowerCase());
    const branding = team.branding || null;
    const branded = Boolean(branding?.hasBranding);
    const cardStyle = branded ? brandingStyle(branding) : '';
    const cardStyleAttr = cardStyle ? ` style="${cardStyle}"` : '';

    const badges = [
      `<span class="team-pill ${trendClass(trend)}">${escapeHtml(trend)}</span>`,
      `<span class="team-pill ${healthClass(health)}">${escapeHtml(health)}</span>`,
      playingToday ? '<span class="team-pill team-pill--today">Today</span>' : '',
    ].join('');

    const metrics = [
      ['Last 5', team.last5 || '—'],
      ['Last 10', team.last10 || '—'],
      ['Net', fmtStat(team.netRating)],
      ['Pace', fmtStat(team.pace)],
      ['Home', team.homeRecord || '—'],
      ['Away', team.awayRecord || '—'],
    ]
      .map(([l, v]) => metricCell(l, v))
      .join('');

    return `
      <article class="team-card${expanded ? ' team-card--expanded' : ''}${branded ? ' team-card--branded' : ''}" data-team-key="${escapeHtml(key.toLowerCase())}"${cardStyleAttr}>
        ${branded ? '<span class="team-color-rail" aria-hidden="true"></span>' : ''}
        <button type="button" class="team-card__toggle" data-team-key="${escapeHtml(key.toLowerCase())}" aria-expanded="${expanded}">
          <div class="team-card__head">
            <div class="team-card__id">
              <div class="team-badge">
                ${renderSigil(branding, team)}
                <div class="team-badge__name">
                  <h3 class="team-card__name">${escapeHtml(team.name || key)}</h3>
                  <span class="team-card__record">${escapeHtml(team.record || '—')}</span>
                </div>
              </div>
            </div>
            <div class="team-card__badges">${badges}</div>
          </div>
          <div class="team-metrics">${metrics}</div>
          <div class="team-ratings">
            <span class="team-rating"><b>Off</b> ${escapeHtml(fmtStat(team.offRating))}</span>
            <span class="team-rating"><b>Def</b> ${escapeHtml(fmtStat(team.defRating))}</span>
          </div>
        </button>
        ${expanded ? `<div class="team-card__detail">${renderProfile(team, model)}</div>` : ''}
      </article>`;
  }

  function renderTeamsPanel(model = {}) {
    const teams = model.teams || [];
    const injuries = model.injuries || [];
    const todaySet = toTodaySet(model.todayKeys);
    const filter = { ...DEFAULT_FILTER, ...(model.filter || {}) };
    const view = { ...model, injuries, expandedTeamKey: model.expandedTeamKey ? String(model.expandedTeamKey).toLowerCase() : null, teamDetails: model.teamDetails || {}, playersCache: model.playersCache || {} };

    const filtered = filterTeams(teams, filter, injuries, todaySet);

    const cards = filtered.length
      ? `<div class="team-board__list">${filtered.map((t) => renderCard(t, view, todaySet)).join('')}</div>`
      : `<p class="empty-state">${teams.length ? 'No teams match the current filters.' : 'Loading teams…'}</p>`;

    return `
      <div class="team-board">
        <header class="panel-header">
          <h2 class="panel-title">Team/s</h2>
          <p class="panel-desc">${teams.length} team${teams.length === 1 ? '' : 's'} · scouting board</p>
        </header>
        ${model.warning ? `<p class="panel-warning">${escapeHtml(model.warning)}</p>` : ''}
        ${renderControls(filter)}
        ${teams.length ? renderSummary(filtered, injuries, todaySet) : ''}
        ${cards}
      </div>`;
  }

  function bindTeamsActions(panel, callbacks = {}) {
    if (!panel) return;

    const search = panel.querySelector('#teams-search');
    if (search) {
      search.addEventListener('input', (e) => {
        callbacks.onFilterChange?.({ search: e.target.value });
      });
    }

    panel.querySelectorAll('.team-seg').forEach((btn) => {
      btn.addEventListener('click', () => {
        callbacks.onFilterChange?.({ segment: btn.dataset.seg });
      });
    });

    const sort = panel.querySelector('#teams-sort');
    if (sort) {
      sort.addEventListener('change', (e) => {
        callbacks.onFilterChange?.({ sort: e.target.value });
      });
    }

    const today = panel.querySelector('#teams-today');
    if (today) {
      today.addEventListener('change', (e) => {
        callbacks.onFilterChange?.({ today: e.target.checked });
      });
    }

    panel.querySelectorAll('.team-card__toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.teamKey;
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        callbacks.onToggleTeam?.(key, !expanded);
      });
    });
  }

  global.TeamsView = {
    renderTeamsPanel,
    bindTeamsActions,
    // exported for tests
    _internal: {
      parseRecordWins,
      severityScore,
      healthLabel,
      trendLabel,
      bettingNotes,
      filterTeams,
      sortKey,
      matchesSegment,
      teamInitials,
      brandingStyle,
      renderSigil,
      renderCard,
    },
  };
})(window);
