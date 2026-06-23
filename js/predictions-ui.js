/**
 * Games tab — full prediction cards with filters.
 */
(function (global) {
  const { escapeHtml } = global.AlertsUI;
  const IV = global.IntelligenceView;

  function formatAmericanLine(value) {
    if (value == null || Number.isNaN(Number(value))) return null;
    const line = Number(value);
    return `${line > 0 ? '+' : ''}${line}`;
  }

  function renderFilters(active = 'all') {
    const filters = [
      { id: 'all', label: 'All' },
      { id: 'STRONG_PICK', label: 'Best Bets' },
      { id: 'LEAN', label: 'Lean' },
      { id: 'PASS', label: 'Pass' },
      { id: 'WAIT_FOR_LINEUP', label: 'Wait' },
      { id: 'HIGH_RISK_ONLY', label: 'High Risk' },
    ];
    return `
      <div class="filter-bar" role="group" aria-label="Filter games">
        ${filters.map((f) => `
          <button class="filter-btn ${f.id === active ? 'filter-btn--active' : ''}" type="button" data-filter="${f.id}">${f.label}</button>
        `).join('')}
      </div>`;
  }

  function renderPredictionDetail(game) {
    const pred = game.prediction || {};
    const spread = pred.spread != null ? pred.spread : game.spread;
    const total = pred.total != null ? pred.total : game.total;
    const winProb = pred.moneylineWinProb ?? pred.winProb ?? game.winProb;
    const moneylinePick = pred.moneylinePick || game.recommendedPick;
    const fairMoneyline = formatAmericanLine(pred.fairMoneyline);
    const marketMoneyline = formatAmericanLine(pred.marketMoneyline);
    const moneylineEdge = pred.moneylineEdge;
    const note = pred.moneylineNote || pred.lineWarning;

    let lines = '';
    if (moneylinePick) lines += `<div class="pred-line"><span>Moneyline</span><strong>${escapeHtml(moneylinePick)}</strong></div>`;
    if (spread != null) lines += `<div class="pred-line"><span>Spread</span><strong>${spread > 0 ? '+' : ''}${spread}</strong></div>`;
    if (total != null) lines += `<div class="pred-line"><span>Total</span><strong>${total}</strong></div>`;
    if (winProb != null) lines += `<div class="pred-line"><span>Win prob</span><strong>${Math.round(winProb * (winProb <= 1 ? 100 : 1))}%</strong></div>`;
    if (fairMoneyline) lines += `<div class="pred-line"><span>Fair line</span><strong>${fairMoneyline}</strong></div>`;
    if (marketMoneyline) lines += `<div class="pred-line"><span>Market line</span><strong>${marketMoneyline}</strong></div>`;
    if (moneylineEdge != null) lines += `<div class="pred-line"><span>ML edge</span><strong>${moneylineEdge >= 0 ? '+' : ''}${(moneylineEdge * 100).toFixed(1)} pts</strong></div>`;
    if (note) lines += `<p class="pred-note">${escapeHtml(note)}</p>`;

    return lines || '<p class="pred-line pred-line--muted">No line projections (odds unavailable).</p>';
  }

  function renderGameCardFull(game) {
    const base = IV.renderGameCard(game, { compact: false });
    const warnings = (game.warnings || []).slice(0, 3);
    const insights = (game.insights || []).slice(0, 3);

    return base.replace(
      '</article>',
      `
        <div class="game-card__detail">
          ${renderPredictionDetail(game)}
        </div>
        ${warnings.length ? `
          <ul class="game-card__warnings">
            ${warnings.map((w) => `<li>${escapeHtml(typeof w === 'string' ? w : w.message || w.text || '')}</li>`).join('')}
          </ul>` : ''}
        ${insights.length ? `
          <div class="game-card__insights">
            ${insights.map((i) => `<span class="insight-chip insight-chip--${(i.severity || 'info').toLowerCase()}">${escapeHtml(i.type || i.label || '')}</span>`).join('')}
          </div>` : ''}
      </article>`
    );
  }

  function renderGamesPanel(data, filter = 'all') {
    let games = data.games || [];
    if (filter !== 'all') {
      games = games.filter((g) => IV.decisionType(g) === filter);
    }

    return `
      <div class="games-panel">
        <header class="panel-header">
          <h2 class="panel-title">Upcoming Games</h2>
          <p class="panel-desc">${games.length} game${games.length !== 1 ? 's' : ''} · ${filter === 'all' ? 'all decisions' : IV.decisionLabel(filter)}</p>
        </header>
        ${renderFilters(filter)}
        ${games.length === 0
          ? '<p class="empty-state">No games match this filter. Try refreshing or check back later.</p>'
          : `<div class="game-grid">${games.map(renderGameCardFull).join('')}</div>`
        }
      </div>`;
  }

  function bindFilters(container, onFilter) {
    if (!container || container.dataset.filtersBound) return;
    container.dataset.filtersBound = '1';
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-filter]');
      if (!btn) return;
      onFilter(btn.dataset.filter);
    });
  }

  global.PredictionsUI = {
    renderGamesPanel,
    renderGameCardFull,
    renderFilters,
    bindFilters,
  };
})(window);
