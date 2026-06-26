#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LAUNCH = path.join(ROOT, 'launch');
const DIST = path.join(ROOT, 'dist-electron');
const UNPACKED = path.join(DIST, 'win-unpacked');
const EXE_NAME = 'MeepMap.exe';

const COPY_TARGETS = [UNPACKED, DIST];

function copyLaunchAssets() {
  if (!fs.existsSync(LAUNCH)) {
    throw new Error(`Missing launch folder: ${LAUNCH}`);
  }

  let copied = 0;
  for (const target of COPY_TARGETS) {
    if (!fs.existsSync(target)) continue;
    for (const name of fs.readdirSync(LAUNCH)) {
      const src = path.join(LAUNCH, name);
      if (!fs.statSync(src).isFile()) continue;
      fs.copyFileSync(src, path.join(target, name));
      copied += 1;
    }
  }

  if (copied === 0) {
    console.warn('No launch targets found. Run electron-builder first, then retry.');
    return false;
  }
  return true;
}

function resolveExeFromLauncherDir(dir) {
  const candidates = [
    path.join(dir, EXE_NAME),
    path.join(dir, 'win-unpacked', EXE_NAME),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function verify() {
  let verified = false;
  for (const target of COPY_TARGETS) {
    if (!fs.existsSync(target)) continue;
    const exe = resolveExeFromLauncherDir(target);
    if (exe) {
      console.log(`Launcher OK: ${target} -> ${exe}`);
      verified = true;
    }
  }
  if (!verified) {
    throw new Error(`Could not resolve ${EXE_NAME} from launcher directories`);
  }
}

function main() {
  const copied = copyLaunchAssets();
  if (copied) verify();
  console.log('Launchers ready in dist-electron (and win-unpacked when present).');
}

main();
