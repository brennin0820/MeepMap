#!/usr/bin/env node
'use strict';

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, 'WNBA-Bet-Predictor.exe');

const REQUIRED = ['server', 'js', 'data', 'index.html', 'app.js', 'styles.css'];

const COPY_TO_DIST = ['index.html', 'app.js', 'styles.css', 'js', 'data', 'assets', 'SHARE.txt'];

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dest, name));
    }
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyRuntimeAssets() {
  for (const item of COPY_TO_DIST) {
    const src = path.join(ROOT, item);
    if (!fs.existsSync(src)) continue;
    copyRecursive(src, path.join(DIST, item));
  }
}

function ensureAssets() {
  for (const item of REQUIRED) {
    if (!fs.existsSync(path.join(ROOT, item))) {
      throw new Error(`Missing required path for packaging: ${item}`);
    }
  }
}

function copyCompanionFiles() {
  const shareSrc = path.join(ROOT, 'SHARE.txt');
  if (fs.existsSync(shareSrc)) {
    fs.copyFileSync(shareSrc, path.join(DIST, 'SHARE.txt'));
  }

  const readme = `WNBA Bet Predictor — Windows build

Distribute the entire "dist" folder (or zip it). The .exe needs the
HTML/JS/CSS/data files in the same directory.

Run:
  Double-click Run-WNBA-Bet-Predictor.bat
  Or: WNBA-Bet-Predictor.exe

Then open http://localhost:3847 in your browser.

Writable data (journal, bankroll, predictions) is stored in:
  .\\data\\   (next to the exe)

Optional: set DATA_DIR to use a different folder.
Optional: set PORT to change the listen port (default 3847).

Predictions are statistical estimates only — not financial advice.
`;
  fs.writeFileSync(path.join(DIST, 'README.txt'), readme);

  const bat = `@echo off
cd /d "%~dp0"
start "" "http://localhost:3847"
"WNBA-Bet-Predictor.exe"
`;
  fs.writeFileSync(path.join(DIST, 'Run-WNBA-Bet-Predictor.bat'), bat);
}

function waitForHealth(port, timeoutMs = 20000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    function attempt() {
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else retry();
      });
      req.on('error', retry);
      req.setTimeout(2000, () => {
        req.destroy();
        retry();
      });
    }
    function retry() {
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Health check timed out after ${timeoutMs}ms`));
        return;
      }
      setTimeout(attempt, 500);
    }
    attempt();
  });
}

async function verifyExe() {
  const testPort = String(38470 + Math.floor(Math.random() * 100));
  console.log(`Smoke test: starting exe on port ${testPort}…`);
  const child = spawn(OUT, [], {
    cwd: DIST,
    env: { ...process.env, PORT: testPort },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  try {
    await waitForHealth(testPort);
    await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${testPort}/`, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else reject(new Error(`GET / returned ${res.statusCode}`));
      }).on('error', reject);
    });
    console.log('Smoke test passed: /api/health and / OK');
  } finally {
    child.kill();
    if (process.platform === 'win32') {
      try {
        execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' });
      } catch {
        /* already exited */
      }
    }
  }
}

async function main() {
  ensureAssets();

  try {
    require.resolve('pkg');
  } catch {
    console.log('Installing pkg…');
    execSync('npm install pkg --save-dev', { cwd: ROOT, stdio: 'inherit' });
  }

  fs.mkdirSync(DIST, { recursive: true });
  console.log('Building Windows EXE (bundles server/, js/, data/, static assets)…');
  try {
    execSync(
      `npx pkg server/index.js --targets node18-win-x64 --output "${OUT}"`,
      { cwd: ROOT, stdio: 'inherit' }
    );
  } catch (err) {
    if (process.platform === 'darwin') {
      console.warn(
        'Windows EXE build failed on macOS (pkg win-x64 cross-compile). Run on Windows or CI for the .exe.'
      );
      return;
    }
    throw err;
  }

  copyRuntimeAssets();
  copyCompanionFiles();
  console.log(`EXE: ${OUT}`);
  console.log(`Also: ${path.join(DIST, 'Run-WNBA-Bet-Predictor.bat')}`);

  if (process.platform === 'win32') {
    try {
      await verifyExe();
    } catch (err) {
      console.warn(`Smoke test failed: ${err.message}`);
    }
  } else {
    console.log('Smoke test skipped (not on Windows).');
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
