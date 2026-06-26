'use strict';

const { app, BrowserWindow } = require('electron');
const { fork, spawn } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');

app.setName('MeepMap');
const { createTray, showMainWindow, destroyTray } = require('./tray');
const { buildApplicationMenu } = require('./menu');
const { setupNotifications } = require('./notifications');

const DEFAULT_PORT = 3847;
let port = Number(process.env.PORT) || DEFAULT_PORT;
let healthUrl = `http://127.0.0.1:${port}/api/health`;

let mainWindow = null;
let serverProcess = null;
let isQuitting = false;

function getMainWindow() {
  return mainWindow;
}

function requestQuit() {
  isQuitting = true;
  app.quit();
}

function getAppRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app');
  }
  return path.join(__dirname, '..');
}

function getFreePort(preferredPort) {
  function tryPort(portToTry) {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(portToTry, () => {
        const address = server.address();
        const chosenPort = typeof address === 'object' && address ? address.port : portToTry;
        server.close(() => resolve(chosenPort));
      });
    });
  }

  return tryPort(preferredPort).catch(() => tryPort(0));
}

function waitForHealth(timeoutMs = 30000) {
  const started = Date.now();

  return new Promise((resolve, reject) => {
    function attempt() {
      const req = http.get(healthUrl, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
          return;
        }
        retry();
      });
      req.on('error', retry);
      req.setTimeout(2000, () => {
        req.destroy();
        retry();
      });
    }

    function retry() {
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Server health check timed out (${healthUrl})`));
        return;
      }
      setTimeout(attempt, 400);
    }

    attempt();
  });
}

function startServer() {
  const appRoot = getAppRoot();
  const serverEntry = path.join(appRoot, 'server', 'index.js');
  const env = {
    ...process.env,
    PORT: String(port),
    DATA_DIR: path.join(app.getPath('userData'), 'data'),
  };

  if (app.isPackaged) {
    env.ELECTRON_RUN_AS_NODE = '1';
    serverProcess = spawn(process.execPath, [serverEntry], {
      cwd: appRoot,
      env,
      stdio: 'inherit',
      windowsHide: true,
    });
  } else {
    serverProcess = fork(serverEntry, [], {
      cwd: appRoot,
      env,
      stdio: 'inherit',
      windowsHide: true,
    });
  }

  serverProcess.on('error', (err) => {
    console.error('Failed to start MeepMap server:', err);
  });

  serverProcess.on('exit', (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(`MeepMap server exited (code=${code}, signal=${signal})`);
    }
    serverProcess = null;
  });
}

function stopServer() {
  if (!serverProcess) return;

  const proc = serverProcess;
  serverProcess = null;

  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {
      proc.kill();
    }
    return;
  }

  proc.kill('SIGTERM');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'MeepMap — WNBA Bet Predictor',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
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

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow(mainWindow);
  });

  app.whenReady().then(async () => {
    setupNotifications();
    port = await getFreePort(port);
    healthUrl = `http://127.0.0.1:${port}/api/health`;
    startServer();
    try {
      await waitForHealth();
      console.log(`MeepMap desktop ready at http://127.0.0.1:${port}/`);
      createWindow();
    } catch (err) {
      console.error(err.message);
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    // Keep running in the system tray when the window is hidden (Windows/Linux).
    if (process.platform !== 'darwin' && !isQuitting) {
      return;
    }
  });

  app.on('before-quit', () => {
    isQuitting = true;
    destroyTray();
    stopServer();
  });

  app.on('activate', async () => {
    if (mainWindow) {
      showMainWindow(mainWindow);
      return;
    }
    if (BrowserWindow.getAllWindows().length === 0) {
      try {
        if (!serverProcess) startServer();
        await waitForHealth();
        createWindow();
      } catch (err) {
        console.error(err.message);
      }
    }
  });
}
