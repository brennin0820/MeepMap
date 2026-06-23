'use strict';

const DEFAULT_TTL_MS = 3 * 60 * 1000;
const REFRESH_THROTTLE_MS = 30 * 1000;

const store = new Map();
const refreshLocks = new Map();

function cacheKey(namespace, key) {
  return `${namespace}:${key}`;
}

function get(namespace, key) {
  const entry = store.get(cacheKey(namespace, key));
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(cacheKey(namespace, key));
    return null;
  }
  return {
    value: entry.value,
    cachedAt: entry.cachedAt,
    cacheAgeSeconds: Math.floor((Date.now() - entry.cachedAt) / 1000),
    expiresAt: entry.expiresAt,
  };
}

function set(namespace, key, value, ttlMs = DEFAULT_TTL_MS) {
  const now = Date.now();
  store.set(cacheKey(namespace, key), {
    value,
    cachedAt: now,
    expiresAt: now + ttlMs,
  });
}

function canRefresh(namespace, key) {
  const lockKey = cacheKey(namespace, key);
  const last = refreshLocks.get(lockKey);
  if (!last) return true;
  return Date.now() - last >= REFRESH_THROTTLE_MS;
}

function markRefresh(namespace, key) {
  refreshLocks.set(cacheKey(namespace, key), Date.now());
}

function wrapWithMeta(cached, sourceMeta) {
  if (!cached) return null;
  return {
    data: cached.value,
    cacheAgeSeconds: cached.cacheAgeSeconds,
    ...sourceMeta,
  };
}

function clear(namespace) {
  if (!namespace) {
    store.clear();
    refreshLocks.clear();
    return;
  }
  for (const key of store.keys()) {
    if (key.startsWith(`${namespace}:`)) store.delete(key);
  }
}

module.exports = {
  DEFAULT_TTL_MS,
  REFRESH_THROTTLE_MS,
  get,
  set,
  canRefresh,
  markRefresh,
  wrapWithMeta,
  clear,
};
