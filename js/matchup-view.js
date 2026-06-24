/**
 * Matchup analyzer tab.
 */
(function (global) {
  const { escapeHtml } = global.AlertsUI;
  const IV = global.IntelligenceView;

  function teamOptions(teams, selected = '') {
    return (teams || [])
      .map((t) => {
        const name = t.name || t.key;
        const sel = name === selected ? ' selected' : '';
        return `<option value="${escapeHtml(name)}"${sel}>${escapeHtml(name)}</option>`;
      })
      .join('');
  }

  function renderRecentMatchups(matchups) {
    if (!matchups?.length) return '';
    return `
      <div class="matchup-recent">
        <label>Quick access</label>
        <div class="matchup-recent__buttons">
          ${matchups
            .map(
              (m, idx) => `
            <button type="button" class="btn btn--secondary btn--sm matchup-quick" data-matchup-idx="${idx}">
              ${escapeHtml(m.away)} @ ${escapeHtml(m.home)}
            </button>
          `
            )
            .join('')}
        </div>
      </div>`;
  }

  function render(teams) {
    const opts = teamOptions(teams);
    const recentMatchups = window.AutofillStorage?.getRecentMatchups?.(5) || [];
    return `
      <div class="matchup-panel">
        <header class="panel-header">
          <h2 class="panel-title">Matchup Analyzer</h2>
          <p class="panel-desc">Compare two teams with the intelligence engine.</p>
        </header>
        ${renderRecentMatchups(recentMatchups)}
        <form id="matchup-form" class="matchup-form">
          <div class="form-row">
            <label for="matchup-away">Away team</label>
            <select id="matchup-away" name="away" required>
              <option value="">Select away…</option>
              ${opts}
            </select>
          </div>
          <div class="form-row">
            <label for="matchup-home">Home team</label>
            <select id="matchup-home" name="home" required>
              <option value="">Select home…</option>
              ${opts}
            </select>
          </div>
          <div class="form-row form-row--inline">
            <div>
              <label for="matchup-spread">Spread (optional)</label>
              <input id="matchup-spread" name="spread" type="number" step="0.5" placeholder="-3.5" />
            </div>
            <div>
              <label for="matchup-total">Total (optional)</label>
              <input id="matchup-total" name="total" type="number" step="0.5" placeholder="165.5" />
            </div>
          </div>
          <div class="form-row form-row--checkbox">
            <label>
              <input type="checkbox" name="neutralCourt" value="true" />
              Neutral court
            </label>
          </div>
          <button type="submit" class="btn btn--primary">Analyze matchup</button>
        </form>
        <div id="matchup-results" class="matchup-results"></div>
      </div>`;
  }

  function renderResult(game) {
    if (!game) return '';
    const richCard = global.PredictionsUI?.renderGameCardFull?.(game);
    return `
      <div class="matchup-result">
        <h3 class="section-title">Analysis result</h3>
        ${richCard || IV.renderGameCard(game, { compact: false })}
      </div>`;
  }

  function bind(container, { onAnalyze } = {}) {
    if (!container || container.dataset.matchupBound) return;
    container.dataset.matchupBound = '1';
    const form = container.querySelector('#matchup-form');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const payload = {
        away: fd.get('away'),
        home: fd.get('home'),
        spread: fd.get('spread') ? Number(fd.get('spread')) : undefined,
        total: fd.get('total') ? Number(fd.get('total')) : undefined,
        neutralCourt: fd.get('neutralCourt') === 'true',
      };
      if (payload.away === payload.home) {
        const results = container.querySelector('#matchup-results');
        if (results) results.innerHTML = '<p class="empty-state">Away and home must be different teams.</p>';
        return;
      }
      await onAnalyze?.(payload);
    });
  }

  global.MatchupView = {
    render,
    renderResult,
    bind,
    renderMatchupPanel: render,
    renderMatchupResult: renderResult,
    bindMatchupForm(formEl, resultsEl, onSubmit) {
      if (!formEl || formEl.dataset.matchupLegacyBound) return;
      formEl.dataset.matchupLegacyBound = '1';

      // Restore last matchup
      const lastMatchup = window.AutofillStorage?.getLastMatchup?.();
      if (lastMatchup) {
        const awaySelect = formEl.querySelector('select[name="away"]');
        const homeSelect = formEl.querySelector('select[name="home"]');
        const spreadInput = formEl.querySelector('input[name="spread"]');
        const totalInput = formEl.querySelector('input[name="total"]');

        if (awaySelect) awaySelect.value = lastMatchup.away || '';
        if (homeSelect) homeSelect.value = lastMatchup.home || '';
        if (spreadInput && lastMatchup.spread) spreadInput.value = lastMatchup.spread;
        if (totalInput && lastMatchup.total) totalInput.value = lastMatchup.total;
      }

      // Quick access button handlers
      const container = formEl.closest('.matchup-panel');
      if (container) {
        container.addEventListener('click', (e) => {
          if (e.target.classList.contains('matchup-quick')) {
            e.preventDefault();
            const idx = parseInt(e.target.dataset.matchupIdx, 10);
            const matchups = window.AutofillStorage?.getRecentMatchups?.(5) || [];
            const matchup = matchups[idx];
            if (matchup) {
              const awaySelect = formEl.querySelector('select[name="away"]');
              const homeSelect = formEl.querySelector('select[name="home"]');
              if (awaySelect) awaySelect.value = matchup.away || '';
              if (homeSelect) homeSelect.value = matchup.home || '';
            }
          }
        });
      }

      formEl.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(formEl);
        const payload = {
          awayKey: fd.get('away'),
          homeKey: fd.get('home'),
          spread: fd.get('spread') ? Number(fd.get('spread')) : undefined,
          total: fd.get('total') ? Number(fd.get('total')) : undefined,
          neutralCourt: fd.get('neutralCourt') === 'true',
        };
        if (payload.awayKey === payload.homeKey) {
          if (resultsEl) {
            resultsEl.innerHTML = '<p class="empty-state">Away and home must be different teams.</p>';
          }
          return;
        }

        // Save to history before submission
        window.AutofillStorage?.addMatchup?.({
          away: payload.awayKey,
          home: payload.homeKey,
          spread: payload.spread,
          total: payload.total,
        });

        if (resultsEl) {
          resultsEl.innerHTML = '<p class="loading-inline">Analyzing matchup…</p>';
        }
        try {
          const html = await onSubmit?.(payload);
          if (resultsEl) {
            resultsEl.innerHTML = typeof html === 'string' ? html : renderResult(html?.game || html?.analysis || html);
          }
        } catch (err) {
          if (resultsEl) {
            resultsEl.innerHTML = `<p class="panel-warning">${escapeHtml(err.message || 'Analysis failed.')}</p>`;
          }
        }
      });
    },
  };
})(window);
