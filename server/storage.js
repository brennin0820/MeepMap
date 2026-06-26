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

const BUNDLED_DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : BUNDLED_DATA_DIR;

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

/** Absolute path to a state file within the active DATA_DIR. */
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
/** Read and parse a shipped seed file from the bundled ./data directory. */
function readBundled(name) {
  return JSON.parse(fs.readFileSync(path.join(BUNDLED_DATA_DIR, name), 'utf8'));
}

function readJson(name, fallback) {
  seedIfMissing(name);
  try {
    return JSON.parse(fs.readFileSync(filePath(name), 'utf8'));
  } catch (err) {
    // A SyntaxError means the file exists but is corrupt — warn so it is
    // observable rather than being silently reset on the next write. A missing
    // file (ENOENT) is normal on first run and stays quiet.
    if (err instanceof SyntaxError) {
      console.warn(`[storage] ${name} is corrupt and will be ignored: ${err.message}`);
    }
    // DATA_DIR copy missing/unreadable — e.g. a read-only volume that could
    // not be seeded. Serve the bundled seed file before the empty default so
    // the app still shows shipped state (e.g. prediction history).
    if (DATA_DIR !== BUNDLED_DATA_DIR) {
      try {
        return readBundled(name);
      } catch {
        /* no bundled seed — fall through to the default */
      }
    }
    return typeof fallback === 'function' ? fallback() : fallback;
  }
}

/**
 * Persist JSON state. Returns true on success, false when the filesystem is
 * read-only (persistence is then disabled for the rest of the session).
 */
function writeJson(name, data) {
  if (!writable) return false;
  const target = filePath(name);
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    // Write to a temp file then rename, so an interrupted write can't leave a
    // truncated/corrupt JSON file behind (rename is atomic on most filesystems).
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, target);
    return true;
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* ignore cleanup failure */
    }
    // Latch persistence off only for read-only / permission errors — those
    // won't recover within the session. Transient failures (disk full, I/O,
    // interrupted) just fail this write and let the next one retry.
    const readOnly = err.code === 'EROFS' || err.code === 'EACCES' || err.code === 'EPERM';
    if (readOnly) writable = false;
    console.warn(
      `[storage] Write failed for ${name} (${err.message}).` +
        (readOnly ? ' Persistence disabled for this session.' : ' Will retry on next write.')
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
