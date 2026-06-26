/**
 * Command Center — Intelligence dashboard (default tab).
 */
(function (global) {
  const { escapeHtml, renderAlertsList } = global.AlertsUI;

  const DECISION_LABELS = {
    STRONG_PICK: 'Best Bet',
    LEAN: 'Lean',
    PASS: 'Pass',
    WAIT_FOR_LINEUP: 'Wait',
    INSUFFICIENT_DATA: 'No Data',
    HIGH_RISK_ONLY: 'High Risk',
  };

  function decisionType(game) {
    if (!game) return 'PASS';
    const d = game.decision;
    if (typeof d === 'object' && d != null) return d.decision || 'PASS';
    return d || 'PASS';
  }

  function decisionConfidence(game) {
    if (game?.confidence != null) return `${Math.round(game.confidence)}%`;
    const d = game?.decision;
    if (typeof d === 'object' && d?.confidence) return d.confidence;
    return '—';
  }

  function decisionRisk(game) {
    if (game?.risk) return game.risk;
    const d = game?.decision;
    if (typeof d === 'object' && d?.risk) return d.risk;
    return 'Medium';
  }

  function decisionEdgeScore(game) {
    if (game?.edgeScore != null) return game.edgeScore;
    const d = game?.decision;
    if (typeof d === 'object' && d?.edgeScore != null) return d.edgeScore;
    return 0;
  }

  function decisionLabel(d) {
    const key = typeof d === 'object' && d != null ? d.decision : d;
    return DECISION_LABELS[key] || key || '—';
  }

  function gradeClass(grade) {
    const g = (grade || 'F').toUpperCase();
    return `grade--${g.toLowerCase()}`;
  }

  function formatGameDate(value) {
    if (!value) return 'TBD';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  }

  function riskClass(risk) {
    const r = String(risk || 'Medium').toLowerCase();
    if (r.includes('low')) return 'risk--low';
    if (r.includes('high')) return 'risk--high';
    return 'risk--medium';
  }

  function edgeMeter(score) {
    const val = Math.max(0, Math.min(100, Number(score) || 0));
    const tier = val >= 70 ? 'high' : val >= 45 ? 'mid' : 'low';
    return `
      <div class="edge-meter edge-meter--${tier}" title="Edge score ${val}">
        <div class="edge-meter__track">
          <div class="edge-meter__fill" style="width:${val}%"></div>
        </div>
        <span class="edge-meter__value">${val}</span>
      </div>`;
  }

  function renderDecisionBadge(decision) {
    const slug = (decision || 'PASS').toLowerCase().replace(/_/g, '-');
    return `<span class="badge badge--decision badge--${slug}">${escapeHtml(decisionLabel(decision))}</span>`;
  }

  function renderQualityBadge(dq) {
    const grade = typeof dq === 'object' ? dq.grade : dq;
    const score = typeof dq === 'object' ? dq.score : null;
    return `<span class="badge badge--grade ${gradeClass(grade)}" title="Data quality ${score ?? ''}">Grade ${escapeHtml(grade || '—')}</span>`;
  }

  function renderRiskBadge(risk) {
    return `<span class="badge badge--risk ${riskClass(risk)}">${escapeHtml(risk || 'Medium')} risk</span>`;
  }

  function renderGameCard(game, { compact = false } = {}) {
    const id = game.id || `${game.away}-${game.home}`;
    const pick = game.recommendedPick || game.pick || game.predictedWinner || '—';
    const conf = decisionConfidence(game);
    const dq = game.dataQuality || game.quality || {};
    const dtype = decisionType(game);
    const homeVol = game.homeTeam?.profile?.volatility?.label;
    const awayVol = game.awayTeam?.profile?.volatility?.label;
    const fatigueInsight = (game.insights || []).find((i) => i.type === 'FATIGUE');

    return `
      <article class="game-card ${compact ? 'game-card--compact' : ''}" data-game-id="${escapeHtml(id)}">
        <header class="game-card__header">
          <div class="game-card__matchup">
            <span class="game-card__away">${escapeHtml(game.away)}</span>
            <span class="game-card__at">@</span>
            <span class="game-card__home">${escapeHtml(game.home)}</span>
          </div>
          <time class="game-card__date">${escapeHtml(formatGameDate(game.date || game.time || 'TBD'))}</time>
        </header>
        <div class="game-card__badges">
          ${renderDecisionBadge(dtype)}
          ${renderQualityBadge(dq)}
          ${renderRiskBadge(decisionRisk(game))}
        </div>
        ${(homeVol || awayVol || fatigueInsight) ? `
        <div class="game-card__signals">
          ${homeVol ? `<span class="signal-chip signal-chip--vol" title="Home volatility">${escapeHtml(game.home)}: ${escapeHtml(homeVol)}</span>` : ''}
          ${awayVol ? `<span class="signal-chip signal-chip--vol" title="Away volatility">${escapeHtml(game.away)}: ${escapeHtml(awayVol)}</span>` : ''}
          ${fatigueInsight ? `<span class="signal-chip signal-chip--fatigue" title="${escapeHtml(fatigueInsight.detail || '')}">Fatigue</span>` : ''}
        </div>` : ''}
        <div class="game-card__metrics">
          <div class="metric">
            <span class="metric__label">Pick</span>
            <span class="metric__value">${escapeHtml(pick)}</span>
          </div>
          <div class="metric">
            <span class="metric__label">Confidence</span>
            <span class="metric__value">${conf}</span>
          </div>
          <div class="metric metric--edge">
            <span class="metric__label">Edge</span>
            ${edgeMeter(decisionEdgeScore(game))}
          </div>
        </div>
        ${!compact ? `
          <footer class="game-card__footer">
            <button class="btn btn--sm btn--ghost" type="button" data-action="explain" data-game-id="${escapeHtml(id)}">Why?</button>
            <button class="btn btn--sm btn--ghost" type="button" data-action="whatif" data-game-id="${escapeHtml(id)}">What-if</button>
            <button class="btn btn--sm btn--ghost" type="button" data-action="analyze" data-game-id="${escapeHtml(id)}">Analyze</button>
          </footer>` : ''}
      </article>`;
  }

  function renderSummaryTiles(summary) {
    const s = summary || {};
    const tiles = [
      { key: 'strongPick', label: 'Best Bets', cls: 'tile--strong', count: s.strongPick ?? s.bestBetCount ?? s.bestBets ?? 0 },
      { key: 'lean', label: 'Lean', cls: 'tile--lean', count: s.lean ?? s.leanCount ?? 0 },
      { key: 'pass', label: 'Pass', cls: 'tile--pass', count: s.pass ?? s.passCount ?? 0 },
      { key: 'waitForLineup', label: 'Wait', cls: 'tile--wait', count: s.waitForLineup ?? s.waitCount ?? s.wait ?? 0 },
    ];
    return `
      <div class="summary-tiles">
        ${tiles.map((t) => `
          <div class="summary-tile ${t.cls}">
            <span class="summary-tile__count">${t.count}</span>
            <span class="summary-tile__label">${t.label}</span>
          </div>`).join('')}
      </div>`;
  }

  function renderSourceHealth(health, meta) {
    const h = health || {};
    const sources = [
      { key: 'espn', label: 'ESPN' },
      { key: 'basketballReference', label: 'BBRef' },
      { key: 'cache', label: 'Cache' },
    ];
    const statusClass = (st) => {
      if (st === 'healthy' || st === 'fresh') return 'health--ok';
      if (st === 'degraded' || st === 'stale') return 'health--warn';
      if (st === 'failed' || st === 'fallback') return 'health--bad';
      return 'health--unknown';
    };
    return `
      <div class="source-health">
        <h3 class="section-title">Source Health</h3>
        <div class="health-grid">
          ${sources.map((s) => `
            <div class="health-item ${statusClass(h[s.key])}">
              <span class="health-item__label">${s.label}</span>
              <span class="health-item__status">${escapeHtml(h[s.key] || 'unknown')}</span>
            </div>`).join('')}
        </div>
        ${meta?.warning ? `<p class="health-warning">${escapeHtml(meta.warning)}</p>` : ''}
        ${meta?.source ? `<p class="health-meta">Data source: ${escapeHtml(meta.source)}${meta.isLive === false ? ' (cached)' : ''}</p>` : ''}
      </div>`;
  }

  function renderOverviewHero({ games, summary, alerts, health, meta }) {
    const totalGames = games.length;
    const activeAlerts = alerts.length;
    const topEdgeGame = [...games].sort((a, b) => (decisionEdgeScore(b) || 0) - (decisionEdgeScore(a) || 0))[0];
    const strongestEdge = topEdgeGame ? `${decisionEdgeScore(topEdgeGame)} · ${topEdgeGame.away} @ ${topEdgeGame.home}` : 'None';
    const watchCount = summary.waitForLineup ?? summary.waitCount ?? summary.wait ?? 0;
    const source = meta?.source || 'local';
    const freshness = meta?.isLive === false || health.cache === 'fresh' ? 'Cached' : 'Live';

    return `
      <section class="hero-strip">
        <div class="hero-strip__main">
          <p class="hero-strip__eyebrow">Trading desk</p>
          <div class="hero-strip__headline-row">
            <h3 class="hero-strip__title">${totalGames} games on board</h3>
            <span class="hero-strip__status hero-strip__status--${freshness.toLowerCase()}">${escapeHtml(freshness)} feed</span>
          </div>
          <p class="hero-strip__text">
            ${summary.strongPick ?? summary.bestBetCount ?? summary.bestBets ?? 0} best bets,
            ${summary.lean ?? summary.leanCount ?? 0} leans,
            ${watchCount} waiting on lineup confirmation.
          </p>
        </div>
        <div class="hero-strip__stats">
          <div class="hero-kpi">
            <span class="hero-kpi__label">Source</span>
            <strong class="hero-kpi__value">${escapeHtml(source)}</strong>
          </div>
          <div class="hero-kpi">
            <span class="hero-kpi__label">Active alerts</span>
            <strong class="hero-kpi__value">${activeAlerts}</strong>
          </div>
          <div class="hero-kpi hero-kpi--wide">
            <span class="hero-kpi__label">Strongest edge</span>
            <strong class="hero-kpi__value">${escapeHtml(strongestEdge)}</strong>
          </div>
        </div>
      </section>`;
  }

  function renderAlertsSnapshot(alerts) {
    const list = alerts || [];
    if (!list.length) {
      return `
        <section class="intel-section intel-card">
          <div class="section-heading">
            <h3 class="section-title">Alerts</h3>
          </div>
          <p class="empty-state">No active alerts.</p>
        </section>`;
    }

    const counts = list.reduce((acc, alert) => {
      const key = alert.type || 'INFO';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const topTypes = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);

    return `
      <section class="intel-section intel-card">
        <div class="section-heading">
          <h3 class="section-title">Alerts</h3>
          <span class="section-count">${list.length}</span>
        </div>
        <div class="alert-summary-chips">
          ${topTypes.map(([type, count]) => `<span class="alert-summary-chip">${escapeHtml(type.replace(/_/g, ' '))} · ${count}</span>`).join('')}
        </div>
        ${renderAlertsList(list.slice(0, 8), { emptyMessage: 'No active alerts.' })}
      </section>`;
  }

  function filterByDecision(games, decision) {
    return (games || []).filter((g) => decisionType(g) === decision);
  }

  function renderSection(title, games, { compact = true, empty = 'None' } = {}) {
    if (!games || games.length === 0) {
      return `
        <section class="intel-section intel-card">
          <div class="section-heading">
            <h3 class="section-title">${escapeHtml(title)}</h3>
          </div>
          <p class="empty-state">${escapeHtml(empty)}</p>
        </section>`;
    }
    return `
      <section class="intel-section intel-card">
        <div class="section-heading">
          <h3 class="section-title">${escapeHtml(title)}</h3>
          <span class="section-count">${games.length}</span>
        </div>
        <div class="game-grid game-grid--compact">
          ${games.map((g) => renderGameCard(g, { compact })).join('')}
        </div>
      </section>`;
  }

  function renderAccuracyCard(accuracy) {
    if (!accuracy) return '';
    const fmt = (v) => (v == null ? '—' : `${v}%`);
    return `
      <section class="accuracy-card">
        <h3 class="section-title">Model Accuracy</h3>
        <div class="summary-tiles summary-tiles--compact">
          <div class="summary-tile tile--strong">
            <span class="summary-tile__count">${fmt(accuracy.moneylineAccuracy)}</span>
            <span class="summary-tile__label">Moneyline</span>
          </div>
          <div class="summary-tile tile--lean">
            <span class="summary-tile__count">${fmt(accuracy.highConfidenceAccuracy)}</span>
            <span class="summary-tile__label">High confidence</span>
          </div>
          <div class="summary-tile tile--pass">
            <span class="summary-tile__count">${accuracy.completedGames ?? 0}</span>
            <span class="summary-tile__label">Graded games</span>
          </div>
        </div>
        ${accuracy.note ? `<p class="accuracy-note">${escapeHtml(accuracy.note)}</p>` : ''}
      </section>`;
  }

  function renderLineupWatch(watch) {
    if (!watch || !watch.count) return '';
    return `
      <section class="intel-section lineup-watch">
        <h3 class="section-title">Lineup Watch <span class="section-count">${watch.count}</span></h3>
        <p class="panel-desc">Hold until official starting lineups post (~30 min pre-tip).</p>
        <div class="game-grid game-grid--compact">
          ${(watch.games || []).map((g) => renderGameCard(g, { compact: true })).join('')}
        </div>
      </section>`;
  }

  function renderCommandCenter(data) {
    const games = data.games || [];
    const summary = data.summary || {};
    const alerts = data.alerts || [];
    const health = data.sourceHealth || data.health || {};
    const meta = data.meta || {};

    const bestBets = filterByDecision(games, 'STRONG_PICK');
    const leans = filterByDecision(games, 'LEAN');
    const passes = filterByDecision(games, 'PASS');
    const waits = filterByDecision(games, 'WAIT_FOR_LINEUP');
    const highRisk = [
      ...filterByDecision(games, 'HIGH_RISK_ONLY'),
      ...games.filter((g) => ['High', 'Extreme'].includes(decisionRisk(g)) && decisionType(g) !== 'HIGH_RISK_ONLY'),
    ].slice(0, 5);
    const topEdge = [...games].sort((a, b) => (decisionEdgeScore(b) || 0) - (decisionEdgeScore(a) || 0)).slice(0, 3);

    return `
      <div class="command-center">
        <header class="panel-header">
          <h2 class="panel-title">Command Center</h2>
          <p class="panel-desc">Decision-driven overview — accuracy before picks.</p>
        </header>

        ${renderOverviewHero({ games, summary, alerts, health, meta })}

        ${renderSummaryTiles(summary)}

        ${data.accuracy ? renderAccuracyCard(data.accuracy) : ''}

        ${data.lineupWatch ? renderLineupWatch(data.lineupWatch) : ''}

        <div class="command-center__grid">
          <div class="command-center__main">
            ${renderSection('Best Bets', bestBets, { empty: 'No strong picks meet criteria today.' })}
            ${renderSection('Lean', leans, { empty: 'No lean plays identified.' })}
            ${renderSection('Pass', passes.slice(0, 6), { empty: 'No pass recommendations.' })}
            ${renderSection('Wait for Lineup', waits, { empty: 'No games waiting on lineup confirmation.' })}
          </div>
          <aside class="command-center__sidebar">
            ${renderAlertsSnapshot(alerts)}
            ${highRisk.length ? renderSection('Highest Risk', highRisk.slice(0, 3)) : ''}
            ${topEdge.length ? `
              <section class="intel-section intel-card">
                <div class="section-heading">
                  <h3 class="section-title">Highest Edge</h3>
                </div>
                <div class="game-grid game-grid--compact">
                  ${topEdge.map((g) => renderGameCard(g, { compact: true })).join('')}
                </div>
              </section>` : ''}
            ${renderSourceHealth(health, meta)}
          </aside>
        </div>
      </div>`;
  }

  function bindActions(container, handlers) {
    if (!container) return;
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const gameId = btn.dataset.gameId;
      if (action === 'explain' && handlers.onExplain) handlers.onExplain(gameId);
      if (action === 'whatif' && handlers.onWhatIf) handlers.onWhatIf(gameId);
      if (action === 'analyze' && handlers.onAnalyze) handlers.onAnalyze(gameId);
    });
  }

  global.IntelligenceView = {
    renderCommandCenter,
    renderGameCard,
    renderDecisionBadge,
    renderQualityBadge,
    renderRiskBadge,
    edgeMeter,
    decisionLabel,
    decisionType,
    bindActions,
    filterByDecision,
  };
})(window);
