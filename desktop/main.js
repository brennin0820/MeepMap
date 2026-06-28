'use strict';

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const log = require('electron-log');
const { createTray, showMainWindow, destroyTray } = require('./tray');
const { buildApplicationMenu } = require('./menu');
const { setupNotifications } = require('./notifications');
const pm = require('./process-manager');
const windowState = require('./window-state');

const DEFAULT_PORT = 3847;
const APP_ID = 'com.meepmap.wnba-bet-predictor';

app.setName('MeepMap');
app.setAppUserModelId(APP_ID);

log.transports.file.level = 'info';
log.transports.console.level = app.isPackaged ? false : 'debug';
log.transports.file.resolvePathFn = () => path.join(app.getPath('userData'), 'logs', 'main.log');
Object.assign(console, log.functions);

let port = Number(process.env.PORT) || DEFAULT_PORT;
let mainWindow = null;
let isQuitting = false;

function getMainWindow() {
  return mainWindow;
}

function requestQuit() {
  isQuitting = true;
  app.quit();
}

function focusAlert(alertId) {
  showMainWindow(mainWindow);
  mainWindow?.webContents.send('focus:alert', alertId);
}

function installIpcHandlers() {
  ipcMain.on('app:get-version', (event) => {
    event.returnValue = app.getVersion();
  });

  ipcMain.on('app:set-autolaunch', (_event, on) => {
    app.setLoginItemSettings({ openAtLogin: Boolean(on), openAsHidden: true });
  });

  ipcMain.on('app:get-autolaunch', (event) => {
    event.returnValue = app.getLoginItemSettings().openAtLogin;
  });
}

function createWindow() {
  const savedState = windowState.load({ width: 1280, height: 860, x: undefined, y: undefined });

  mainWindow = new BrowserWindow({
    ...savedState,
    minWidth: 960,
    minHeight: 640,
    title: 'MeepMap - WNBA Bet Predictor',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (savedState.isMaximized) mainWindow.maximize();
  windowState.track(mainWindow);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL();
    if (!current) return;
    try {
      const target = new URL(url);
      const here = new URL(current);
      if (target.origin !== here.origin) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}/`);

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  buildApplicationMenu(getMainWindow);
  createTray({ getMainWindow, onQuit: requestQuit });
}

async function startServerOrShowError() {
  try {
    port = await pm.start(port, path.join(app.getPath('userData'), 'data'), () => {
      mainWindow?.reload();
    });
    console.log(`MeepMap desktop server ready at http://127.0.0.1:${port}/`);
    return true;
  } catch (err) {
    console.error(err);
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: 'MeepMap could not start',
      message: 'The embedded server did not pass its health check.',
      detail: `${err.message}\n\nLog: ${path.join(app.getPath('userData'), 'logs', 'main.log')}`,
      buttons: ['Retry', 'Quit'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) return startServerOrShowError();
    app.quit();
    return false;
  }
}

async function bootstrap() {
  installIpcHandlers();
  setupNotifications({ onAlertClick: focusAlert });

  if (process.env.MEEPMAP_SMOKE === '1') {
    try {
      const smokePort = await pm.start(DEFAULT_PORT, app.getPath('temp'));
      pm.stop();
      app.exit(smokePort ? 0 : 1);
    } catch (err) {
      console.error(err);
      pm.stop();
      app.exit(1);
    }
    return;
  }

  if (await startServerOrShowError()) createWindow();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow(mainWindow);
  });

  app.whenReady().then(bootstrap);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !isQuitting) return;
  });

  app.on('before-quit', () => {
    isQuitting = true;
    destroyTray();
    pm.stop();
  });

  app.on('activate', async () => {
    if (mainWindow) {
      showMainWindow(mainWindow);
      return;
    }
    if (BrowserWindow.getAllWindows().length === 0 && await startServerOrShowError()) {
      createWindow();
    }
  });
}
