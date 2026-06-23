#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'WNBA-Bet-Predictor.exe');

const REQUIRED = ['server', 'js', 'data', 'index.html', 'app.js'];

function ensureAssets() {
  for (const item of REQUIRED) {
    if (!fs.existsSync(path.join(ROOT, item))) {
      throw new Error(`Missing required path for packaging: ${item}`);
    }
  }
}

function main() {
  ensureAssets();

  try {
    require.resolve('pkg');
  } catch {
    console.log('Installing pkg…');
    execSync('npm install pkg --save-dev', { cwd: ROOT, stdio: 'inherit' });
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  console.log('Building Windows EXE (bundles server/, js/, data/)…');
  try {
    execSync(
      `npx pkg server/index.js --targets node18-win-x64 --output "${OUT}"`,
      { cwd: ROOT, stdio: 'inherit' }
    );
    console.log(`EXE: ${OUT}`);
  } catch (err) {
  if (process.platform === 'darwin') {
      console.warn('Windows EXE build failed on macOS (pkg win-x64 cross-compile). Run on Windows or CI for the .exe.');
    } else {
      throw err;
    }
  }
}

main();

