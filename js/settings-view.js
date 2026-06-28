/**
 * Settings panel — accuracy, prediction journal, bankroll, what-if.
 */
(function (global) {
  const { escapeHtml } = global.AlertsUI || { escapeHtml: (s) => String(s ?? '') };
  const IV = global.IntelligenceView;

  function pct(val) {
    return val != null ? `${val}%` : '—';
  }

  function resolveAccuracy(accuracy) {
    if (!accuracy) return null;
    return {
      ...accuracy,
      moneylineAccuracy: accuracy.moneylineAccuracy ?? accuracy.moneyline?.overall ?? null,
      highConfidenceAccuracy: accuracy.highConfidenceAccuracy ?? accuracy.moneyline?.high ?? null,
      mediumConfidenceAccuracy: accuracy.mediumConfidenceAccuracy ?? accuracy.moneyline?.medium ?? null,
      lowConfidenceAccuracy: accuracy.lowConfidenceAccuracy ?? accuracy.moneyline?.low ?? null,
    };
  }

  function renderAccuracyCard(accuracy) {
    const a = resolveAccuracy(accuracy);
    if (!a) {
      return `
        <section class="settings-card settings-card--muted">
          <h3 class="section-title">Accuracy</h3>
          <p class="empty-state">Accuracy data unavailable — server may be offline.</p>
        </section>`;
    }
    return `
      <section class="settings-card">
        <h3 class="section-title">Accuracy</h3>
        <p class="settings-card__desc">Tracked picks from prediction journal · model ${escapeHtml(a.modelVersion || '—')}</p>
        <div class="accuracy-grid">
          <div class="accuracy-stat accuracy-stat--hero">
            <span class="accuracy-stat__value">${pct(a.moneylineAccuracy)}</span>
            <span class="accuracy-stat__label">Moneyline hit rate</span>
            <span class="accuracy-stat__sub">${a.completedGames ?? 0} completed</span>
          </div>
          <div class="accuracy-stat">
            <span class="accuracy-stat__value">${pct(a.highConfidenceAccuracy)}</span>
            <span class="accuracy-stat__label">High confidence</span>
          </div>
          <div class="accuracy-stat">
            <span class="accuracy-stat__value">${pct(a.mediumConfidenceAccuracy)}</span>
            <span class="accuracy-stat__label">Medium confidence</span>
          </div>
          <div class="accuracy-stat">
            <span class="accuracy-stat__value">${pct(a.lowConfidenceAccuracy)}</span>
            <span class="accuracy-stat__label">Low confidence</span>
          </div>
          <div class="accuracy-stat">
            <span class="accuracy-stat__value">${a.averageMarginError ?? '—'}</span>
            <span class="accuracy-stat__label">Avg margin error</span>
          </div>
          <div class="accuracy-stat">
            <span class="accuracy-stat__value">${a.totalPredictions ?? 0}</span>
            <span class="accuracy-stat__label">Total logged</span>
          </div>
        </div>
      </section>`;
  }

  function renderJournal(history) {
    const rows = (history || []).slice(-20).reverse();
    if (!rows.length) {
      return `
        <section class="settings-card">
          <h3 class="section-title">Prediction Journal</h3>
          <p class="empty-state">No predictions logged yet. Journal fills as games are analyzed.</p>
        </section>`;
    }
    return `
      <section class="settings-card">
        <h3 class="section-title">Prediction Journal</h3>
        <p class="settings-card__desc">Recent model outputs · ${rows.length} shown</p>
        <div class="journal-table-wrap">
          <table class="journal-table">
            <thead>
              <tr>
                <th>Game</th>
                <th>Pick</th>
                <th>Decision</th>
                <th>Conf</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((p) => {
                const g = p.game || {};
                const result = p.wasCorrect === true ? '✓' : p.wasCorrect === false ? '✗' : '—';
                const resultCls = p.wasCorrect === true ? 'journal--win' : p.wasCorrect === false ? 'journal--loss' : '';
                return `
                  <tr class="${resultCls}">
                    <td>${escapeHtml(g.away || '?')} @ ${escapeHtml(g.home || '?')}</td>
                    <td>${escapeHtml(p.moneylinePick || '—')}</td>
                    <td>${IV ? IV.renderDecisionBadge(p.decision) : `<span class="badge badge--decision badge--${(p.decision || 'pass').toLowerCase().replace(/_/g, '-')}">${escapeHtml(p.decision || '—')}</span>`}</td>
                    <td>${escapeHtml(p.confidence || '—')}</td>
                    <td>${result}</td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  function renderBankroll(bankroll) {
    const b = bankroll || {};
    return `
      <section class="settings-card">
        <h3 class="section-title">Bankroll</h3>
        <p class="settings-card__desc">Local tracking only — stored in your browser.</p>
        <form id="bankroll-form" class="bankroll-form">
          <div class="form-row">
            <label for="bankroll-start">Starting bankroll ($)</label>
            <input id="bankroll-start" name="starting" type="number" min="0" step="1" value="${b.starting ?? ''}" placeholder="1000" />
          </div>
          <div class="form-row">
            <label for="bankroll-current">Current bankroll ($)</label>
            <input id="bankroll-current" name="current" type="number" min="0" step="1" value="${b.current ?? ''}" placeholder="1000" />
          </div>
          <div class="form-row">
            <label for="bankroll-unit">Unit size ($)</label>
            <input id="bankroll-unit" name="unit" type="number" min="1" step="1" value="${b.unit ?? ''}" placeholder="25" />
          </div>
          <button type="submit" class="btn btn--primary btn--sm">Save bankroll</button>
          <p id="bankroll-saved" class="form-hint" hidden>Saved locally.</p>
        </form>
      </section>`;
  }

  function renderWhatIfSection(games, selectedGameId) {
    return `
      <section id="what-if-section" class="settings-card">
        <h3 class="section-title">What-if Simulator</h3>
        <p class="settings-card__desc">Test injury, lineup, and line scenarios before betting.</p>
        ${global.WhatIfView.renderWhatIfForm(games, selectedGameId)}
      </section>`;
  }

  function renderEngineHealth(health) {
    if (!health) return '';
    const sources = health.sources || {};
    const rows = [
      { label: 'Engine status', value: health.status || 'unknown' },
      { label: 'Model', value: health.modelVersion || health.model || '—' },
      { label: 'Data quality', value: health.dataQualityEngine || '—' },
      { label: 'ESPN', value: sources.espn || '—' },
      { label: 'BBRef', value: sources.bbref || sources.basketballReference || '—' },
      { label: 'Injuries', value: sources.injuries || '—' },
      { label: 'Odds', value: sources.odds || '—' },
    ];
    return `
      <section class="settings-card">
        <h3 class="section-title">Intelligence Engine</h3>
        <p class="settings-card__desc">Decision, insight, alert, and explanation engines — live health from the server.</p>
        <dl class="engine-health">
          ${rows.map((row) => `
            <div class="engine-health__row">
              <dt>${escapeHtml(row.label)}</dt>
              <dd>${escapeHtml(String(row.value))}</dd>
            </div>`).join('')}
        </dl>
      </section>`;
  }

  function desktopSetting(key, fallback) {
    return localStorage.getItem(key) ?? fallback;
  }

  function renderDesktopSettings() {
    if (!global.meepmap?.isDesktop) return '';
    const autoLaunch = global.meepmap.getAutoLaunch?.() ? 'checked' : '';
    return `
      <section class="settings-card">
        <h3 class="section-title">Desktop</h3>
        <p class="settings-card__desc">Native refresh, notification, and startup behavior.</p>
        <div class="form-row form-row--checkbox">
          <label><input id="set-notif-enabled" type="checkbox" ${desktopSetting('meepmap_notifications_enabled', '1') === '1' ? 'checked' : ''}> Enable notifications</label>
        </div>
        <div class="form-row">
          <label for="set-notif-severity">Minimum notification severity</label>
          <select id="set-notif-severity">
            <option value="high" ${desktopSetting('meepmap_notifications_min_severity', 'high') === 'high' ? 'selected' : ''}>High and Critical</option>
            <option value="critical" ${desktopSetting('meepmap_notifications_min_severity', 'high') === 'critical' ? 'selected' : ''}>Critical only</option>
          </select>
        </div>
        <div class="form-row">
          <label for="set-refresh">Auto-refresh interval</label>
          <select id="set-refresh">
            <option value="180000" ${desktopSetting('meepmap_refresh_interval', '300000') === '180000' ? 'selected' : ''}>3 minutes</option>
            <option value="300000" ${desktopSetting('meepmap_refresh_interval', '300000') === '300000' ? 'selected' : ''}>5 minutes</option>
            <option value="600000" ${desktopSetting('meepmap_refresh_interval', '300000') === '600000' ? 'selected' : ''}>10 minutes</option>
          </select>
        </div>
        <div class="form-row form-row--checkbox">
          <label><input id="set-pause-hidden" type="checkbox" ${desktopSetting('meepmap_pause_when_hidden', '0') === '1' ? 'checked' : ''}> Pause refresh when hidden</label>
        </div>
        <div class="form-row form-row--checkbox">
          <label><input id="set-autolaunch" type="checkbox" ${autoLaunch}> Open at login</label>
        </div>
      </section>`;
  }

  function render({ accuracy, history, bankroll, meta, games = [], selectedGameId = null, engineHealth = null } = {}) {
    return `
      <div class="settings-panel">
        <header class="panel-header">
          <h2 class="panel-title">Settings</h2>
          <p class="panel-desc">Accuracy tracking, journal, bankroll, and scenario tools.</p>
        </header>
        ${renderDesktopSettings()}
        ${renderEngineHealth(engineHealth)}
        ${renderAccuracyCard(accuracy)}
        ${renderJournal(history)}
        ${renderBankroll(bankroll)}
        ${renderWhatIfSection(games, selectedGameId)}
        ${meta?.warning ? `<p class="settings-warning">${escapeHtml(meta.warning)}</p>` : ''}
      </div>`;
  }

  function bind(container, { onSaveBankroll, onReload } = {}) {
    if (!container || container.dataset.settingsBound) return;
    container.dataset.settingsBound = '1';

    const bankrollForm = container.querySelector('#bankroll-form');
    if (bankrollForm) {
      bankrollForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(bankrollForm);
        onSaveBankroll?.({
          starting: Number(fd.get('starting')) || 0,
          current: Number(fd.get('current')) || 0,
          unit: Number(fd.get('unit')) || 0,
        });
        const hint = container.querySelector('#bankroll-saved');
        if (hint) {
          hint.hidden = false;
          setTimeout(() => { hint.hidden = true; }, 2500);
        }
      });
    }

    const bindDesktop = (id, handler) => container.querySelector(`#${id}`)?.addEventListener('change', handler);
    bindDesktop('set-notif-enabled', (e) => localStorage.setItem('meepmap_notifications_enabled', e.target.checked ? '1' : '0'));
    bindDesktop('set-notif-severity', (e) => localStorage.setItem('meepmap_notifications_min_severity', e.target.value));
    bindDesktop('set-refresh', (e) => {
      localStorage.setItem('meepmap_refresh_interval', e.target.value);
      global.startDesktopAutoRefresh?.();
    });
    bindDesktop('set-pause-hidden', (e) => localStorage.setItem('meepmap_pause_when_hidden', e.target.checked ? '1' : '0'));
    bindDesktop('set-autolaunch', (e) => global.meepmap?.setAutoLaunch?.(e.target.checked));
  }

  global.SettingsView = { render, bind, renderAccuracyCard, renderJournal, renderBankroll };
})(window);
