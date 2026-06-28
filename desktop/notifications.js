'use strict';

const { ipcMain, Notification } = require('electron');

const DEDUP_TTL_MS = 6 * 60 * 60 * 1000;
const seen = new Map();

function normalizeSeverity(severity) {
  const raw = String(severity || '').toLowerCase();
  if (raw === 'critical') return 'Critical';
  if (raw === 'high') return 'High';
  if (raw === 'medium' || raw === 'warning') return 'Medium';
  if (raw === 'low') return 'Low';
  return 'Info';
}

function alertId(alert) {
  if (typeof alert?.id === 'string' && alert.id) return alert.id;
  return [
    alert?.type || 'alert',
    alert?.gameId || alert?.game || '',
    alert?.message || alert?.text || alert?.body || '',
  ].join('|');
}

function toNotificationPayload(alert) {
  const type = String(alert?.type || alert?.title || 'MeepMap Alert').replace(/_/g, ' ');
  return {
    id: alertId(alert),
    title: alert?.title || type,
    body: alert?.body || alert?.message || alert?.text || '',
    severity: normalizeSeverity(alert?.severity),
  };
}

function shouldNotify(id) {
  const now = Date.now();
  const last = seen.get(id);
  if (last && now - last < DEDUP_TTL_MS) return false;
  seen.set(id, now);
  return true;
}

function maybeNotify(alert, { onClick } = {}) {
  if (!Notification.isSupported()) return false;
  const payload = toNotificationPayload(alert);
  if (!payload.body || !shouldNotify(payload.id)) return false;

  const notification = new Notification({
    title: payload.title,
    body: payload.body,
    silent: false,
  });
  notification.on('click', () => onClick?.(payload.id));
  notification.show();
  return true;
}

function setupNotifications({ onAlertClick } = {}) {
  ipcMain.on('notify:alerts', (_event, alerts) => {
    if (!Array.isArray(alerts)) return;
    for (const alert of alerts) {
      if (!alert || typeof alert !== 'object') continue;
      const payload = toNotificationPayload(alert);
      if (!payload.id || !payload.title) continue;
      maybeNotify(alert, { onClick: onAlertClick });
    }
  });

  ipcMain.on('notify:one', (_event, payload) => {
    if (!payload || typeof payload !== 'object') return;
    maybeNotify({
      id: typeof payload.alertId === 'string' ? payload.alertId : undefined,
      title: typeof payload.title === 'string' ? payload.title : 'MeepMap',
      body: typeof payload.body === 'string' ? payload.body : '',
    }, { onClick: onAlertClick });
  });
}

setInterval(() => {
  const cutoff = Date.now() - DEDUP_TTL_MS;
  for (const [id, timestamp] of seen) {
    if (timestamp < cutoff) seen.delete(id);
  }
}, 10 * 60 * 1000).unref?.();

module.exports = { setupNotifications, maybeNotify };
