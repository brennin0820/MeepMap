'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SHARE = path.join(DIST, 'WNBA-Bet-Predictor-share');

const INCLUDE = [
  'index.html',
  'app.js',
  'styles.css',
  'package.json',
  'package-lock.json',
  'SHARE.txt',
  'vercel.json',
  'api',
  'js',
  'server',
  'data',
  'assets',
  'scripts',
];

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      if (name === 'node_modules') continue;
      copyRecursive(path.join(src, name), path.join(dest, name));
    }
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function main() {
  if (fs.existsSync(SHARE)) {
    fs.rmSync(SHARE, { recursive: true, force: true });
  }
  fs.mkdirSync(SHARE, { recursive: true });

  for (const item of INCLUDE) {
    const src = path.join(ROOT, item);
    if (!fs.existsSync(src)) continue;
    copyRecursive(src, path.join(SHARE, item));
  }

  if (!fs.existsSync(path.join(SHARE, 'SHARE.txt'))) {
    fs.writeFileSync(
      path.join(SHARE, 'SHARE.txt'),
      `WNBA Bet Predictor — share bundle

Local run:
  1. npm install
  2. npm start
  3. Open http://localhost:3847

Deploy to Vercel (linked project):
  1. npm install
  2. npx vercel link   (once)
  3. npm run build && npm run deploy

Or push to GitHub — Vercel auto-deploys when connected.
`
    );
  }

  const zipPath = path.join(DIST, 'WNBA-Bet-Predictor-share.zip');
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  if (process.platform === 'win32') {
    execSync(
      `powershell -NoProfile -Command "Compress-Archive -Path '${SHARE}' -DestinationPath '${zipPath}' -Force"`,
      { stdio: 'inherit' }
    );
  } else {
    execSync(`cd "${DIST}" && zip -r "WNBA-Bet-Predictor-share.zip" "WNBA-Bet-Predictor-share"`, {
      stdio: 'inherit',
    });
  }

  console.log(`Share folder: ${SHARE}`);
  console.log(`Share ZIP:    ${zipPath}`);
}

main();
