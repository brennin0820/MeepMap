'use strict';

const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');

let tray = null;

function loadTrayIcon() {
  const iconPath = path.join(__dirname, 'tray-icon.png');
  const image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) return nativeImage.createEmpty();
  return image.resize({ width: 16, height: 16 });
}

function showMainWindow(win) {
  if (!win || win.isDestroyed()) return;
  if (!win.isVisible()) win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
}

function createTray({ getMainWindow, onQuit }) {
  if (tray) return tray;

  tray = new Tray(loadTrayIcon());
  tray.setToolTip('MeepMap - WNBA Bet Predictor');

  const sendToRenderer = (channel, value) => {
    const win = getMainWindow();
    showMainWindow(win);
    win?.webContents.send(channel, value);
  };

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show MeepMap',
      click: () => showMainWindow(getMainWindow()),
    },
    {
      label: 'Refresh data',
      click: () => sendToRenderer('tray:refresh'),
    },
    {
      label: 'Open Command Center',
      click: () => sendToRenderer('focus:alert', null),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => onQuit(),
    },
  ]);
  tray.setContextMenu(contextMenu);

  tray.on('click', () => showMainWindow(getMainWindow()));

  return tray;
}

function destroyTray() {
  if (!tray) return;
  tray.destroy();
  tray = null;
}

module.exports = {
  createTray,
  showMainWindow,
  destroyTray,
};
