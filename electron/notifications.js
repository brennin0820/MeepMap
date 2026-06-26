'use strict';

const { ipcMain, Notification } = require('electron');

function setupNotifications() {
  ipcMain.handle('show-notification', (_event, payload) => {
    if (!Notification.isSupported()) return false;

    const title = payload?.title || 'MeepMap';
    const body = payload?.body || '';

    const notification = new Notification({ title, body });
    notification.show();
    return true;
  });
}

module.exports = { setupNotifications };
