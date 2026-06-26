'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/** @type {Set<string>} */
const seenAlertKeys = new Set();

contextBridge.exposeInMainWorld('meepmap', {
  platform: process.platform,
  isDesktop: true,
  showNotification: (payload) => ipcRenderer.invoke('show-notification', payload),
  notifyAlerts: (alerts) => {
    if (!Array.isArray(alerts)) return;
    for (const alert of alerts) {
      const severity = String(alert?.severity || '');
      if (severity !== 'Critical' && severity !== 'High') continue;
      const key = `${alert.type}|${alert.gameId || ''}|${alert.message || alert.text || ''}`;
      if (seenAlertKeys.has(key)) continue;
      seenAlertKeys.add(key);
      ipcRenderer.invoke('show-notification', {
        title: String(alert.type || 'Alert').replace(/_/g, ' '),
        body: alert.message || alert.text || '',
      });
    }
  },
});
