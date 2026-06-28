'use strict';

const { fork, spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { app, dialog } = require('electron');
const log = require('electron-log');

const MAX_RESTARTS = 3;
const HEALTHY_RESET_MS = 60_000;
const HEALTH_TIMEOUT_MS = 30_000;

let child = null;
let currentPort = null;
let currentDataDir = null;
let isQuitting = false;
let restartAttempts = 0;
let healthyTimer = null;
let onRecovered = null;

function probe(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitHealthy(port, timeoutMs = HEALTH_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe(`http://127.0.0.1:${port}/api/health`)) return true;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

async function probeExisting(ports) {
  for (const port of ports) {
    if (await probe(`http://127.0.0.1:${port}/api/health`)) return port;
  }
  return null;
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

function getAppRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, 'app') : path.join(__dirname, '..');
}

function getServerEntry() {
  if (!app.isPackaged) return path.join(__dirname, '..', 'server', 'index.js');

  const bundled = path.join(process.resourcesPath, 'app.asar', 'dist-server', 'server.bundle.js');
  if (fs.existsSync(bundled)) return bundled;

  return path.join(process.resourcesPath, 'app', 'server', 'index.js');
}

function attachLogging(proc) {
  proc.stdout?.on('data', (chunk) => log.info(`[server] ${String(chunk).trimEnd()}`));
  proc.stderr?.on('data', (chunk) => log.error(`[server] ${String(chunk).trimEnd()}`));
}

function forkServer(port, dataDir) {
  const appRoot = getAppRoot();
  const serverEntry = getServerEntry();
  const env = {
    ...process.env,
    PORT: String(port),
    DATA_DIR: dataDir,
  };

  if (app.isPackaged) {
    env.ELECTRON_RUN_AS_NODE = '1';
    child = spawn(process.execPath, [serverEntry], {
      cwd: appRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    });
  } else {
    child = fork(serverEntry, [], {
      cwd: appRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    });
  }

  attachLogging(child);

  child.on('error', (err) => {
    log.error('Failed to start MeepMap server', err);
  });

  child.on('exit', (code, signal) => {
    const exitedChild = child;
    child = null;
    if (isQuitting || !currentPort || exitedChild?.killed) return;
    log.error(`MeepMap server exited (code=${code}, signal=${signal})`);
    scheduleRestart();
  });
}

function scheduleHealthyReset() {
  clearTimeout(healthyTimer);
  healthyTimer = setTimeout(() => {
    restartAttempts = 0;
  }, HEALTHY_RESET_MS);
  healthyTimer.unref?.();
}

async function startChild(port, dataDir) {
  forkServer(port, dataDir);
  const healthy = await waitHealthy(port);
  if (!healthy) {
    killChild(false);
    throw new Error(`Server health check timed out (http://127.0.0.1:${port}/api/health)`);
  }
  scheduleHealthyReset();
  return port;
}

function scheduleRestart() {
  if (restartAttempts >= MAX_RESTARTS) {
    dialog.showMessageBox({
      type: 'error',
      title: 'MeepMap server stopped',
      message: 'The embedded server stopped repeatedly.',
      detail: 'Use Retry to start it again, or Quit and check the desktop log.',
      buttons: ['Retry', 'Quit'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) {
        restartAttempts = 0;
        start(currentPort, currentDataDir, onRecovered).catch((err) => log.error(err));
      } else {
        app.quit();
      }
    });
    return;
  }

  restartAttempts += 1;
  setTimeout(() => {
    if (isQuitting || !currentPort || !currentDataDir) return;
    startChild(currentPort, currentDataDir)
      .then(() => onRecovered?.(currentPort))
      .catch((err) => {
        log.error('Server restart failed', err);
        scheduleRestart();
      });
  }, 750 * restartAttempts);
}

async function start(preferredPort, dataDir, recoveredCallback) {
  isQuitting = false;
  currentDataDir = dataDir;
  onRecovered = recoveredCallback;

  const candidatePorts = [preferredPort, ...Array.from({ length: 5 }, (_, index) => preferredPort + index + 1)];
  const existingPort = await probeExisting(candidatePorts);
  if (existingPort) {
    currentPort = existingPort;
    log.info(`Reusing healthy MeepMap server on port ${existingPort}`);
    return existingPort;
  }

  currentPort = await getFreePort(preferredPort);
  await startChild(currentPort, dataDir);
  return currentPort;
}

function killChild(markQuitting) {
  clearTimeout(healthyTimer);
  healthyTimer = null;
  if (markQuitting) isQuitting = true;

  if (!child) return;
  const proc = child;
  child = null;

  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      return;
    } catch {
      proc.kill();
      return;
    }
  }

  proc.kill('SIGTERM');
}

function stop() {
  killChild(true);
}

process.on('exit', stop);

module.exports = {
  start,
  stop,
  getPort: () => currentPort,
};
