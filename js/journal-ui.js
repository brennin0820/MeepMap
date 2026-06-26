/**
 * Journal + bankroll UI helpers.
 */
(function (global) {
  const { escapeHtml } = global.AlertsUI;

  const RESULT_LABELS = { pending: 'Pending', won: 'Won', lost: 'Lost', push: 'Push' };
  const RESULT_TIPS = {
    pending: 'Bet not settled yet — waiting for the game result.',
    won: 'This bet won — pick was correct.',
    lost: 'This bet lost — pick was incorrect.',
    push: 'Push — bet tied the line; stake is returned.',
  };

  function fmtUnits(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    const sign = n > 0 ? '+' : '';
    return `${sign}${n}u`;
  }

  function fmtOdds(value) {
    if (value == null || value === '') return '';
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    return n > 0 ? `+${n}` : `${n}`;
  }

  function renderJournalSummary(summary) {
    if (!summary || !summary.total) return '';
    const net = Number(summary.netUnits) || 0;
    const netClass = net > 0 ? 'is-positive' : net < 0 ? 'is-negative' : '';
    return `
      <div class="journal-summary">
        <div class="summary-tile tile--strong">
          <span class="summary-tile__count">${escapeHtml(summary.record || '0-0')}</span>
          <span class="summary-tile__label">Record</span>
        </div>
        <div class="summary-tile tile--lean">
          <span class="summary-tile__count ${netClass}">${fmtUnits(net)}</span>
          <span class="summary-tile__label">Net units</span>
        </div>
        <div class="summary-tile tile--pass">
          <span class="summary-tile__count">${summary.roi == null ? '—' : `${summary.roi}%`}</span>
          <span class="summary-tile__label">ROI</span>
        </div>
        <div class="summary-tile tile--pass">
          <span class="summary-tile__count">${summary.pending ?? 0}</span>
          <span class="summary-tile__label">Pending</span>
        </div>
      </div>`;
  }

  function renderEntry(e) {
    const result = e.result || 'pending';
    const profit = typeof e.profit === 'number' ? e.profit : null;
    const profitClass = profit > 0 ? 'is-positive' : profit < 0 ? 'is-negative' : '';
    const odds = fmtOdds(e.odds);
    const settled = result !== 'pending';
    return `
      <article class="journal-entry journal-entry--${result}" data-entry-id="${escapeHtml(e.id || '')}">
        <header class="journal-entry__head">
          <strong>${escapeHtml(e.matchup || '—')}</strong>
          <span class="journal-entry__meta">${escapeHtml(e.createdAt?.slice(0, 10) || '')}</span>
        </header>
        <p class="journal-entry__line">
          ${escapeHtml(e.pick || '')} · ${e.units ?? 1}u${odds ? ` · ${escapeHtml(odds)}` : ''}
          <span class="journal-badge journal-badge--${result}" title="${escapeHtml(RESULT_TIPS[result] || '')}">${RESULT_LABELS[result] || result}</span>
          ${settled && profit != null ? `<span class="journal-entry__profit ${profitClass}">${fmtUnits(profit)}</span>` : ''}
        </p>
        ${e.notes ? `<p class="journal-entry__notes">${escapeHtml(e.notes)}</p>` : ''}
        <div class="journal-entry__actions">
          ${['won', 'lost', 'push']
            .map((r) => `<button type="button" class="btn btn--mini${result === r ? ' btn--mini-active' : ''}" data-settle="${r}" data-id="${escapeHtml(e.id || '')}">${RESULT_LABELS[r]}</button>`)
            .join('')}
          ${settled ? `<button type="button" class="btn btn--mini" data-settle="pending" data-id="${escapeHtml(e.id || '')}">Reset</button>` : ''}
          <button type="button" class="btn btn--mini btn--mini-danger" data-delete="${escapeHtml(e.id || '')}">Delete</button>
        </div>
      </article>`;
  }

  function renderJournalPanel(data) {
    const entries = (data && data.entries) || [];
    const summary = (data && data.summary) || null;
    return `
      <div class="journal-panel">
        <header class="panel-header">
          <h2 class="panel-title">Betting Journal</h2>
          <p class="panel-desc">Track picks locally — not synced to any sportsbook.</p>
        </header>
        ${renderJournalSummary(summary)}
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
          <div class="form-row form-row--split">
            <div>
              <label for="journal-odds">Odds (American, optional)</label>
              <input id="journal-odds" name="odds" type="number" step="1" placeholder="e.g. -110 or +135" />
            </div>
            <div>
              <label for="journal-result">Result</label>
              <select id="journal-result" name="result">
                <option value="pending" selected>Pending</option>
                <option value="won">Won</option>
                <option value="lost">Lost</option>
                <option value="push">Push</option>
              </select>
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
            : entries.map(renderEntry).join('')}
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
      const oddsRaw = fd.get('odds');
      await onSubmit({
        matchup: fd.get('matchup'),
        pick: fd.get('pick'),
        units: Number(fd.get('units')) || 1,
        odds: oddsRaw === '' || oddsRaw == null ? null : Number(oddsRaw),
        result: fd.get('result') || 'pending',
        notes: fd.get('notes') || '',
        betType: 'moneyline',
      });
      formEl.reset();
    });
  }

  function bindEntryActions(panelEl, { onSettle, onDelete } = {}) {
    if (!panelEl || panelEl.dataset.entryActionsBound) return;
    panelEl.dataset.entryActionsBound = '1';
    panelEl.addEventListener('click', async (e) => {
      const settleBtn = e.target.closest('[data-settle]');
      if (settleBtn && onSettle) {
        await onSettle(settleBtn.dataset.id, settleBtn.dataset.settle);
        return;
      }
      const deleteBtn = e.target.closest('[data-delete]');
      if (deleteBtn && onDelete) {
        await onDelete(deleteBtn.dataset.delete);
      }
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
    bindEntryActions,
  };
})(window);
