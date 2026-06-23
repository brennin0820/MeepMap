/**
 * Human-readable explanation panel for game decisions.
 */
(function (global) {
  const { escapeHtml } = global.AlertsUI || { escapeHtml: (s) => String(s ?? '') };

  function renderExplanation(explanation, game) {
    if (!explanation && !game) {
      return '<p class="empty-state">Select a game to view its explanation.</p>';
    }

    const exp = explanation || game?.explanation || {};
    const short = exp.shortSummary || game?.why?.[0] || 'No explanation available.';
    const pros = exp.pros || game?.why || [];
    const cons = exp.cons || game?.warnings || [];
    const advice = exp.finalAdvice || game?.action || game?.decisionLabel || '';

    const matchup = game
      ? `<p class="explanation__matchup">${escapeHtml(game.away)} @ ${escapeHtml(game.home)}</p>`
      : '';

    return `
      ${matchup}
      <p class="explanation__summary">${escapeHtml(short)}</p>
      ${pros.length ? `
        <div class="explanation__section">
          <h3 class="explanation__heading explanation__heading--pro">Supporting factors</h3>
          <ul class="explanation__list">${pros.map((p) => `<li>${escapeHtml(typeof p === 'string' ? p : p.text || p.message || '')}</li>`).join('')}</ul>
        </div>` : ''}
      ${cons.length ? `
        <div class="explanation__section">
          <h3 class="explanation__heading explanation__heading--con">Concerns</h3>
          <ul class="explanation__list explanation__list--con">${cons.map((c) => `<li>${escapeHtml(typeof c === 'string' ? c : c.text || c.message || '')}</li>`).join('')}</ul>
        </div>` : ''}
      ${advice ? `
        <div class="explanation__advice">
          <span class="explanation__advice-label">Recommendation</span>
          <p>${escapeHtml(advice)}</p>
        </div>` : ''}`;
  }

  function openDrawer(drawerEl, contentEl, explanation, game) {
    if (!drawerEl || !contentEl) return;
    contentEl.innerHTML = renderExplanation(explanation, game);
    drawerEl.classList.remove('drawer--closed');
    drawerEl.setAttribute('aria-hidden', 'false');
  }

  function closeDrawer(drawerEl) {
    if (!drawerEl) return;
    drawerEl.classList.add('drawer--closed');
    drawerEl.setAttribute('aria-hidden', 'true');
  }

  function bindDrawer(drawerEl) {
    if (!drawerEl || drawerEl.dataset.bound) return;
    drawerEl.dataset.bound = '1';
    drawerEl.querySelectorAll('[data-close-drawer]').forEach((el) => {
      el.addEventListener('click', () => closeDrawer(drawerEl));
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !drawerEl.classList.contains('drawer--closed')) {
        closeDrawer(drawerEl);
      }
    });
  }

  global.ExplanationUI = {
    renderExplanation,
    openDrawer,
    closeDrawer,
    bindDrawer,
  };
})(window);
