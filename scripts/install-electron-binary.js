#!/usr/bin/env node
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { downloadArtifact } = require('@electron/get');

const electronDir = path.join(__dirname, '..', 'node_modules', 'electron');
const { version } = require(path.join(electronDir, 'package.json'));

function getPlatformBinary() {
  return process.platform === 'win32' ? 'electron.exe' : 'electron';
}

function isInstalled() {
  try {
    const dist = path.join(electronDir, 'dist');
    const onDiskVersion = fs.readFileSync(path.join(dist, 'version'), 'utf-8').replace(/^v/, '');
    const pathTxt = fs.readFileSync(path.join(electronDir, 'path.txt'), 'utf-8');
    const binary = path.join(dist, pathTxt.trim());
    return onDiskVersion === version && fs.existsSync(binary);
  } catch {
    return false;
  }
}

async function extractZip(zipPath, distDir) {
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });

  if (process.platform === 'win32') {
    execFileSync(
      'powershell',
      ['-NoProfile', '-Command', `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${distDir.replace(/'/g, "''")}' -Force`],
      { stdio: 'inherit' }
    );
    return;
  }

  const extract = require('extract-zip');
  await extract(zipPath, { dir: distDir });
}

async function main() {
  if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD === '1') {
    return;
  }
  if (isInstalled()) {
    return;
  }

  const dist = path.join(electronDir, 'dist');
  const zipPath = await downloadArtifact({
    version,
    artifactName: 'electron',
    platform: process.platform,
    arch: process.arch,
    force: true,
  });

  await extractZip(zipPath, dist);
  fs.writeFileSync(path.join(electronDir, 'path.txt'), getPlatformBinary());
  fs.writeFileSync(path.join(dist, 'version'), version);

  const exe = path.join(dist, getPlatformBinary());
  if (!fs.existsSync(exe)) {
    throw new Error(`Expected binary missing after extract: ${exe}`);
  }
  console.log('Electron binary installed:', exe);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
