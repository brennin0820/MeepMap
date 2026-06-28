'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('meepmap', {
  isDesktop: true,
  platform: process.platform,
  version: ipcRenderer.sendSync('app:get-version'),

  notifyAlerts: (alerts) => ipcRenderer.send('notify:alerts', alerts),
  showNotification: (opts) => ipcRenderer.send('notify:one', opts),
  setAutoLaunch: (on) => ipcRenderer.send('app:set-autolaunch', Boolean(on)),
  getAutoLaunch: () => ipcRenderer.sendSync('app:get-autolaunch'),

  onTrayRefresh: (cb) => {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('tray:refresh', () => cb());
  },
  onFocusAlert: (cb) => {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('focus:alert', (_event, alertId) => cb(alertId));
  },
});
