/**
 * What-if scenario simulator form and results.
 */
(function (global) {
  const { escapeHtml } = global.AlertsUI || { escapeHtml: (s) => String(s ?? '') };
  const IV = global.IntelligenceView;

  function renderDecisionBadge(decision) {
    if (IV?.renderDecisionBadge) return IV.renderDecisionBadge(decision);
    const slug = (decision || 'pass').toLowerCase().replace(/_/g, '-');
    return `<span class="badge badge--decision badge--${slug}">${escapeHtml(decision || '—')}</span>`;
  }

  function renderWhatIfForm(games, selectedGameId) {
    const options = (games || [])
      .map((g) => {
        const id = g.id || `${g.away}-${g.home}`;
        const sel = id === selectedGameId ? ' selected' : '';
        return `<option value="${escapeHtml(id)}"${sel}>${escapeHtml(g.away)} @ ${escapeHtml(g.home)}</option>`;
      })
      .join('');

    return `
      <form id="what-if-form" class="what-if-form">
        <div class="form-row">
          <label for="what-if-game">Game</label>
          <select id="what-if-game" name="gameId" required>
            <option value="">Select a game…</option>
            ${options}
          </select>
        </div>
        <div class="form-row">
          <label for="what-if-player">Player (optional)</label>
          <input id="what-if-player" name="player" type="text" placeholder="Player name" />
        </div>
        <div class="form-row">
          <label for="what-if-status">Player status</label>
          <select id="what-if-status" name="playerStatus">
            <option value="">No change</option>
            <option value="Out">Out</option>
            <option value="Questionable">Questionable</option>
            <option value="Probable">Probable</option>
            <option value="Available">Available</option>
          </select>
        </div>
        <div class="form-row form-row--checkbox">
          <label>
            <input type="checkbox" name="neutralCourt" value="true" />
            Neutral court
          </label>
        </div>
        <div class="form-row">
          <label for="what-if-spread">Adjusted spread (optional)</label>
          <input id="what-if-spread" name="spread" type="number" step="0.5" placeholder="e.g. -3.5" />
        </div>
        <button type="submit" class="btn btn--primary">Run scenario</button>
      </form>
      <div id="what-if-results" class="what-if-results"></div>`;
  }

  function renderWhatIfResults(result) {
    if (!result) return '';
    if (result.error) {
      return `<div class="what-if-results what-if-results--error"><p>${escapeHtml(result.error)}</p></div>`;
    }

    const orig = result.original || result.baseline || {};
    const scen = result.scenario || result.adjusted || {};
    const delta = result.delta || {};

    return `
      <div class="what-if-results what-if-results--ok">
        <h4 class="what-if-results__title">Scenario comparison</h4>
        <div class="what-if-compare">
          <div class="what-if-col">
            <span class="what-if-col__label">Original</span>
            ${renderDecisionBadge(orig.decision)}
            <span>Edge: ${orig.edgeScore ?? '—'}</span>
            <span>Confidence: ${orig.confidence ?? '—'}%</span>
          </div>
          <div class="what-if-col what-if-col--arrow">→</div>
          <div class="what-if-col">
            <span class="what-if-col__label">Scenario</span>
            ${renderDecisionBadge(scen.decision)}
            <span>Edge: ${scen.edgeScore ?? '—'}</span>
            <span>Confidence: ${scen.confidence ?? '—'}%</span>
          </div>
        </div>
        ${result.summary ? `<p class="what-if-summary">${escapeHtml(result.summary)}</p>` : ''}
        ${delta.decisionChanged ? '<p class="what-if-flag">⚠ Decision changed under this scenario.</p>' : ''}
        ${renderScenarioList(result.scenarios)}
      </div>`;
  }

  function renderScenarioList(scenarios) {
    if (!scenarios?.length) return '';
    return `
      <div class="what-if-scenarios">
        <h5 class="what-if-scenarios__title">Built-in scenarios</h5>
        <ul class="what-if-scenarios__list">
          ${scenarios.map((s) => `
            <li>
              <strong>${escapeHtml(s.label || s.id)}</strong>
              ${renderDecisionBadge(s.outcome?.decision)}
              <span class="what-if-scenarios__edge">Edge ${s.outcome?.edgeScore ?? '—'}</span>
            </li>`).join('')}
        </ul>
      </div>`;
  }

  function bindWhatIfForm(formEl, resultsEl, onSubmit) {
    if (!formEl || formEl.dataset.bound) return;
    formEl.dataset.bound = '1';
    formEl.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(formEl);
      const payload = {
        gameId: fd.get('gameId'),
        player: fd.get('player') || undefined,
        playerStatus: fd.get('playerStatus') || undefined,
        neutralCourt: fd.get('neutralCourt') === 'true',
        spread: fd.get('spread') ? Number(fd.get('spread')) : undefined,
        total: fd.get('total') ? Number(fd.get('total')) : undefined,
      };
      if (resultsEl) {
        resultsEl.innerHTML = '<p class="loading-inline">Running scenario…</p>';
      }
      try {
        const result = await onSubmit(payload);
        if (resultsEl) resultsEl.innerHTML = renderWhatIfResults(result);
      } catch (err) {
        if (resultsEl) {
          resultsEl.innerHTML = renderWhatIfResults({ error: err.message || 'Scenario failed.' });
        }
      }
    });
  }

  global.WhatIfView = {
    renderWhatIfForm,
    renderWhatIfResults,
    bindWhatIfForm,
  };
})(window);
