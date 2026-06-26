'use strict';

const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');

/** @type {import('electron').Tray|null} */
let tray = null;

function loadTrayIcon() {
  const iconPath = path.join(__dirname, 'tray-icon.png');
  const image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    return nativeImage.createEmpty();
  }
  return image.resize({ width: 16, height: 16 });
}

/**
 * @param {import('electron').BrowserWindow|null} win
 */
function showMainWindow(win) {
  if (!win || win.isDestroyed()) return;
  if (!win.isVisible()) win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
}

/**
 * @param {{ getMainWindow: () => import('electron').BrowserWindow|null, onQuit: () => void }} opts
 * @returns {import('electron').Tray}
 */
function createTray({ getMainWindow, onQuit }) {
  if (tray) return tray;

  tray = new Tray(loadTrayIcon());
  tray.setToolTip('MeepMap — WNBA Bet Predictor');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show MeepMap',
      click: () => showMainWindow(getMainWindow()),
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
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

module.exports = {
  createTray,
  showMainWindow,
  destroyTray,
};
