/**
 * Alert banners and alert list rendering.
 */
(function (global) {
  const SEVERITY_CLASS = {
    Critical: 'alert--critical',
    High: 'alert--high',
    Medium: 'alert--medium',
    Low: 'alert--low',
    Info: 'alert--info',
  };

  const TYPE_ICON = {
    PLAYER_RULED_OUT: '🚫',
    QUESTIONABLE_PLAYER: '❓',
    ROSTER_LOW_CONFIDENCE: '⚠️',
    DATA_SOURCE_FAILED: '📡',
    CACHE_STALE: '⏱',
    STRONG_PICK_FOUND: '★',
    PICK_CHANGED: '↻',
    LINEUP_WAIT: '⏳',
    HIGH_RISK_PICK: '⚡',
    DATA_MISMATCH: '≠',
    DATE_INVALID: '📅',
  };

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function alertClass(severity) {
    return SEVERITY_CLASS[severity] || 'alert--info';
  }

  function alertIcon(type) {
    return TYPE_ICON[type] || '•';
  }

  function renderAlertItem(alert) {
    const sev = alert.severity || 'Info';
    const type = alert.type || 'INFO';
    const game = alert.gameId || alert.game
      ? `<span class="alert__game">${escapeHtml(alert.away && alert.home ? `${alert.away} @ ${alert.home}` : alert.gameId || '')}</span>`
      : '';
    return `
      <li class="alert ${alertClass(sev)}" data-alert-type="${escapeHtml(type)}">
        <span class="alert__icon" aria-hidden="true">${alertIcon(type)}</span>
        <div class="alert__body">
          <span class="alert__type">${escapeHtml(type.replace(/_/g, ' '))}</span>
          <p class="alert__message">${escapeHtml(alert.message || alert.text || '')}</p>
          ${game}
        </div>
      </li>`;
  }

  function renderAlertBanner(alert) {
    const sev = alert.severity || 'Medium';
    return `
      <div class="banner ${alertClass(sev)}" role="alert">
        <span class="banner__icon" aria-hidden="true">${alertIcon(alert.type)}</span>
        <div class="banner__text">
          <strong>${escapeHtml((alert.type || 'ALERT').replace(/_/g, ' '))}</strong>
          <span>${escapeHtml(alert.message || alert.text || '')}</span>
        </div>
        ${alert.dismissible !== false ? '<button class="banner__dismiss" type="button" aria-label="Dismiss">×</button>' : ''}
      </div>`;
  }

  function renderAlertsList(alerts, { emptyMessage = 'No active alerts.' } = {}) {
    if (!alerts || alerts.length === 0) {
      return `<p class="empty-state">${escapeHtml(emptyMessage)}</p>`;
    }
    const sorted = [...alerts].sort((a, b) => {
      const order = { Critical: 0, High: 1, Medium: 2, Low: 3, Info: 4 };
      return (order[a.severity] ?? 5) - (order[b.severity] ?? 5);
    });
    return `<ul class="alert-list">${sorted.map(renderAlertItem).join('')}</ul>`;
  }

  function mountGlobalAlerts(container, alerts) {
    if (!container) return;
    const critical = (alerts || []).filter((a) =>
      ['Critical', 'High'].includes(a.severity)
    );
    container.innerHTML = critical.slice(0, 3).map(renderAlertBanner).join('');
    container.querySelectorAll('.banner__dismiss').forEach((btn) => {
      btn.addEventListener('click', () => btn.closest('.banner')?.remove());
    });
  }

  global.AlertsUI = {
    renderAlertItem,
    renderAlertBanner,
    renderAlertsList,
    mountGlobalAlerts,
    alertClass,
    escapeHtml,
  };
})(window);
