/**
 * Injuries tab.
 */
(function (global) {
  const { escapeHtml } = global.AlertsUI;

  function statusClass(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'out' || s === 'suspended') return 'injury--out';
    if (s === 'questionable' || s === 'doubtful') return 'injury--questionable';
    return 'injury--other';
  }

  function renderInjuryRow(entry) {
    return `
      <tr class="injury-row ${statusClass(entry.status)}">
        <td>${escapeHtml(entry.teamName || entry.teamKey || '—')}</td>
        <td>${escapeHtml(entry.player || entry.playerName || '—')}</td>
        <td><span class="injury-status">${escapeHtml(entry.status || '—')}</span></td>
        <td class="injury-note">${escapeHtml(entry.note || '—')}</td>
      </tr>`;
  }

  function renderInjuriesPanel(data) {
    const injuries = data.injuries || [];
    return `
      <div class="injuries-panel">
        <header class="panel-header">
          <h2 class="panel-title">Injury Report</h2>
          <p class="panel-desc">${injuries.length} reported · ${data.isLive ? 'live' : 'cached'} source</p>
        </header>
        ${data.warning ? `<p class="panel-warning">${escapeHtml(data.warning)}</p>` : ''}
        ${injuries.length === 0
          ? '<p class="empty-state">No injuries reported in the current feed.</p>'
          : `
          <div class="table-wrap">
            <table class="injury-table">
              <thead>
                <tr><th>Team</th><th>Player</th><th>Status</th><th>Note</th></tr>
              </thead>
              <tbody>${injuries.map(renderInjuryRow).join('')}</tbody>
            </table>
          </div>`}
      </div>`;
  }

  global.InjuriesView = { renderInjuriesPanel };
})(window);
