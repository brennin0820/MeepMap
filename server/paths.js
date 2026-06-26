'use strict';

const path = require('path');

/** True when running inside a pkg-produced executable. */
const IS_PKG = Boolean(process.pkg);

const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

/** Directory containing the .exe when packaged; cwd otherwise. */
function getRuntimeDir() {
  if (IS_PKG) return path.dirname(process.execPath);
  return process.cwd();
}

/**
 * App root for static files. When packaged, assets live next to the exe
 * (copied at build time) because express.static cannot read pkg snapshots.
 */
function getAppRoot() {
  if (IS_PKG) return getRuntimeDir();
  return path.join(__dirname, '..');
}

const ROOT = getAppRoot();

/** Bundled/read fallback JSON (./data next to exe when packaged). */
const BUNDLED_DATA_DIR = path.join(ROOT, 'data');

/** Writable persistence directory (journal, bankroll, prediction-history). */
function getDataDir() {
  if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR);
  if (IS_SERVERLESS) return path.join('/tmp', 'meepmap-data');
  if (IS_PKG) return path.join(getRuntimeDir(), 'data');
  return BUNDLED_DATA_DIR;
}

module.exports = {
  IS_PKG,
  IS_SERVERLESS,
  ROOT,
  BUNDLED_DATA_DIR,
  getRuntimeDir,
  getDataDir,
};
