'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const exe = path.join(root, 'dist-electron', 'win-unpacked', 'MeepMap.exe');
const asar = path.join(root, 'dist-electron', 'win-unpacked', 'resources', 'app.asar');

let failed = false;
function check(ok, message) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`);
  if (!ok) failed = true;
}

check(fs.existsSync(exe), `MeepMap.exe exists at ${exe}`);
check(fs.existsSync(asar), 'app.asar present');

if (!failed) {
  const result = spawnSync(exe, [], {
    env: { ...process.env, MEEPMAP_SMOKE: '1' },
    timeout: 45_000,
  });
  check(result.status === 0, `packaged app boots and server health passes (exit ${result.status})`);
}

process.exit(failed ? 1 : 0);
