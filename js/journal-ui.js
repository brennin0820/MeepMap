/**
 * Journal + bankroll UI helpers.
 */
(function (global) {
  const { escapeHtml } = global.AlertsUI;

  function renderJournalPanel(data) {
    const entries = data.entries || [];
    return `
      <div class="journal-panel">
        <header class="panel-header">
          <h2 class="panel-title">Betting Journal</h2>
          <p class="panel-desc">Track picks locally — not synced to any sportsbook.</p>
        </header>
        <form id="journal-form" class="journal-form">
          <div class="form-row">
            <label for="journal-matchup">Matchup</label>
            <input id="journal-matchup" name="matchup" type="text" placeholder="e.g. MIN @ LVA" required />
          </div>
          <div class="form-row form-row--split">
            <div>
              <label for="journal-pick">Pick</label>
              <input id="journal-pick" name="pick" type="text" required />
            </div>
            <div>
              <label for="journal-units">Units</label>
              <input id="journal-units" name="units" type="number" min="0.5" step="0.5" value="1" />
            </div>
          </div>
          <div class="form-row">
            <label for="journal-notes">Notes</label>
            <textarea id="journal-notes" name="notes" rows="2"></textarea>
          </div>
          <button type="submit" class="btn btn--primary">Add entry</button>
        </form>
        <div class="journal-list">
          ${entries.length === 0
            ? '<p class="empty-state">No journal entries yet.</p>'
            : entries.map((e) => `
              <article class="journal-entry">
                <header>
                  <strong>${escapeHtml(e.matchup || '—')}</strong>
                  <span class="journal-entry__meta">${escapeHtml(e.createdAt?.slice(0, 10) || '')}</span>
                </header>
                <p>${escapeHtml(e.pick || '')} · ${e.units ?? 1}u · ${escapeHtml(e.result || 'pending')}</p>
                ${e.notes ? `<p class="journal-entry__notes">${escapeHtml(e.notes)}</p>` : ''}
              </article>`).join('')}
        </div>
      </div>`;
  }

  function renderBankrollPanel(data) {
    return `
      <div class="bankroll-panel">
        <h3 class="section-title">Bankroll Tracker</h3>
        <form id="bankroll-form" class="bankroll-form">
          <div class="form-row form-row--split">
            <div>
              <label for="bankroll-start">Starting bankroll ($)</label>
              <input id="bankroll-start" name="startingBankroll" type="number" min="0" value="${data.startingBankroll ?? 1000}" />
            </div>
            <div>
              <label for="bankroll-current">Current bankroll ($)</label>
              <input id="bankroll-current" name="currentBankroll" type="number" min="0" value="${data.currentBankroll ?? 1000}" />
            </div>
          </div>
          <div class="form-row">
            <label for="bankroll-unit">Unit size ($)</label>
            <input id="bankroll-unit" name="unitSize" type="number" min="1" value="${data.unitSize ?? 10}" />
          </div>
          <button type="submit" class="btn btn--primary">Save bankroll</button>
        </form>
        <div class="bankroll-stats">
          <div class="summary-tile tile--lean">
            <span class="summary-tile__count">${data.roi ?? 0}%</span>
            <span class="summary-tile__label">ROI</span>
          </div>
          <div class="summary-tile tile--pass">
            <span class="summary-tile__count">${data.totalUnitsWagered ?? 0}</span>
            <span class="summary-tile__label">Units wagered</span>
          </div>
        </div>
      </div>`;
  }

  function renderAccuracyCard(accuracy) {
    const a = accuracy || {};
    const fmt = (v) => (v == null ? '—' : `${v}%`);
    return `
      <section class="accuracy-card">
        <h3 class="section-title">Model Accuracy</h3>
        <div class="summary-tiles summary-tiles--compact">
          <div class="summary-tile tile--strong">
            <span class="summary-tile__count">${fmt(a.moneylineAccuracy)}</span>
            <span class="summary-tile__label">Moneyline</span>
          </div>
          <div class="summary-tile tile--lean">
            <span class="summary-tile__count">${fmt(a.highConfidenceAccuracy)}</span>
            <span class="summary-tile__label">High conf.</span>
          </div>
          <div class="summary-tile tile--pass">
            <span class="summary-tile__count">${a.completedGames ?? 0}</span>
            <span class="summary-tile__label">Graded</span>
          </div>
        </div>
        ${a.note ? `<p class="accuracy-note">${escapeHtml(a.note)}</p>` : ''}
      </section>`;
  }

  function bindJournalForm(formEl, onSubmit) {
    if (!formEl || formEl.dataset.bound) return;
    formEl.dataset.bound = '1';
    formEl.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(formEl);
      await onSubmit({
        matchup: fd.get('matchup'),
        pick: fd.get('pick'),
        units: Number(fd.get('units')) || 1,
        notes: fd.get('notes') || '',
        betType: 'moneyline',
      });
      formEl.reset();
    });
  }

  function bindBankrollForm(formEl, onSubmit) {
    if (!formEl || formEl.dataset.bound) return;
    formEl.dataset.bound = '1';
    formEl.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(formEl);
      await onSubmit({
        startingBankroll: Number(fd.get('startingBankroll')),
        currentBankroll: Number(fd.get('currentBankroll')),
        unitSize: Number(fd.get('unitSize')),
      });
    });
  }

  global.JournalUI = {
    renderJournalPanel,
    renderBankrollPanel,
    renderAccuracyCard,
    bindJournalForm,
    bindBankrollForm,
  };
})(window);
