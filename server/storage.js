'use strict';

/**
 * Centralized persistence helper.
 *
 * Writable state (journal, bankroll, prediction-history) lives in DATA_DIR.
 * Locally this defaults to the bundled ./data folder so behaviour is unchanged.
 * In hosted deployments, point DATA_DIR at a persistent, writable volume
 * (e.g. a Render disk mounted at /var/data) so state survives restarts.
 *
 * Writes are fail-safe: on a read-only filesystem the app keeps serving from
 * in-memory/seed data instead of crashing — persistence is simply disabled.
 */

const fs = require('fs');
const path = require('path');
const { BUNDLED_DATA_DIR, getDataDir } = require('./paths');

const DATA_DIR = getDataDir();

let writable = true;

if (DATA_DIR !== BUNDLED_DATA_DIR) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`[storage] Using DATA_DIR: ${DATA_DIR}`);
  } catch (err) {
    writable = false;
    console.warn(
      `[storage] Could not create DATA_DIR (${DATA_DIR}): ${err.message}. ` +
        'Persistence disabled — serving from seed data only.'
    );
  }
}

function filePath(name) {
  return path.join(DATA_DIR, name);
}

/**
 * Copy a bundled seed file into DATA_DIR the first time it is needed, so a
 * fresh persistent volume starts from the shipped defaults (e.g. the existing
 * prediction history) instead of an empty state.
 */
function seedIfMissing(name) {
  if (DATA_DIR === BUNDLED_DATA_DIR || !writable) return;
  const target = filePath(name);
  if (fs.existsSync(target)) return;
  const seed = path.join(BUNDLED_DATA_DIR, name);
  if (!fs.existsSync(seed)) return;
  try {
    fs.copyFileSync(seed, target);
  } catch (err) {
    console.warn(`[storage] Could not seed ${name}: ${err.message}`);
  }
}

/**
 * Read JSON state, falling back to `fallback` (value or factory) when the file
 * is missing or unreadable.
 */
function readJson(name, fallback) {
  seedIfMissing(name);
  try {
    return JSON.parse(fs.readFileSync(filePath(name), 'utf8'));
  } catch {
    return typeof fallback === 'function' ? fallback() : fallback;
  }
}

/**
 * Persist JSON state. Returns true on success, false when the filesystem is
 * read-only (persistence is then disabled for the rest of the session).
 */
function writeJson(name, data) {
  if (!writable) return false;
  try {
    fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2));
    return true;
  } catch (err) {
    writable = false;
    console.warn(
      `[storage] Write failed for ${name} (${err.message}). ` +
        'Persistence disabled for this session.'
    );
    return false;
  }
}

module.exports = {
  DATA_DIR,
  readJson,
  writeJson,
  filePath,
  isWritable: () => writable,
};
