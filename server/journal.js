'use strict';

const storage = require('./storage');

const JOURNAL_FILE = 'journal.json';

const RESULTS = ['pending', 'won', 'lost', 'push'];

function loadJournal() {
  return storage.readJson(JOURNAL_FILE, () => ({
    entries: [],
    updatedAt: new Date().toISOString(),
  }));
}

function saveJournal(data) {
  data.updatedAt = new Date().toISOString();
  storage.writeJson(JOURNAL_FILE, data);
  return data;
}

/**
 * Net unit profit for a settled bet.
 * - won: derived from American odds when provided, otherwise even money (stake).
 * - lost: minus the staked units.
 * - push: zero (stake returned).
 * - pending/unknown: null.
 */
function settleProfit(result, units, odds) {
  const u = Number(units);
  const stake = Number.isFinite(u) ? u : 0;
  if (result === 'won') {
    const o = Number(odds);
    if (odds == null || odds === '' || Number.isNaN(o) || o === 0) {
      return Number(stake.toFixed(2));
    }
    const mult = o > 0 ? o / 100 : 100 / Math.abs(o);
    return Number((stake * mult).toFixed(2));
  }
  if (result === 'lost') return Number((-stake).toFixed(2));
  if (result === 'push') return 0;
  return null;
}

function summarize(entries) {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let pending = 0;
  let netUnits = 0;
  let unitsRisked = 0;
  for (const e of entries) {
    const profit = typeof e.profit === 'number' ? e.profit : 0;
    if (e.result === 'won') {
      wins++;
      netUnits += profit;
      unitsRisked += Number(e.units) || 0;
    } else if (e.result === 'lost') {
      losses++;
      netUnits += profit;
      unitsRisked += Number(e.units) || 0;
    } else if (e.result === 'push') {
      pushes++;
    } else {
      pending++;
    }
  }
  const decided = wins + losses;
  return {
    total: entries.length,
    settled: wins + losses + pushes,
    pending,
    wins,
    losses,
    pushes,
    record: pushes ? `${wins}-${losses}-${pushes}` : `${wins}-${losses}`,
    netUnits: Number(netUnits.toFixed(2)),
    unitsRisked: Number(unitsRisked.toFixed(2)),
    roi: unitsRisked > 0 ? Number(((netUnits / unitsRisked) * 100).toFixed(1)) : null,
    winRate: decided > 0 ? Number(((wins / decided) * 100).toFixed(1)) : null,
  };
}

function getEntries() {
  const journal = loadJournal();
  return { ...journal, summary: summarize(journal.entries || []) };
}

function normalizeResult(value) {
  const r = String(value || '').toLowerCase();
  return RESULTS.includes(r) ? r : null;
}

function addEntry(entry) {
  const journal = loadJournal();
  const result = normalizeResult(entry.result) || 'pending';
  const units = typeof entry.units === 'number' ? entry.units : 1;
  const odds = entry.odds ?? null;
  const record = {
    id: `j-${Date.now()}`,
    createdAt: new Date().toISOString(),
    gameId: entry.gameId || null,
    matchup: entry.matchup || null,
    betType: entry.betType || 'moneyline',
    pick: entry.pick || null,
    units,
    odds,
    notes: entry.notes || '',
    result,
    profit: settleProfit(result, units, odds),
  };
  journal.entries.unshift(record);
  saveJournal(journal);
  return record;
}

function updateEntry(id, patch = {}) {
  const journal = loadJournal();
  const entry = journal.entries.find((e) => e.id === id);
  if (!entry) return null;

  if (patch.matchup !== undefined) entry.matchup = patch.matchup;
  if (patch.pick !== undefined) entry.pick = patch.pick;
  if (patch.notes !== undefined) entry.notes = patch.notes;
  if (patch.betType !== undefined) entry.betType = patch.betType;
  if (patch.units !== undefined && Number.isFinite(Number(patch.units))) {
    entry.units = Number(patch.units);
  }
  if (patch.odds !== undefined) {
    entry.odds = patch.odds === null || patch.odds === '' ? null : Number(patch.odds);
  }
  if (patch.result !== undefined) {
    const result = normalizeResult(patch.result);
    if (!result) throw new Error('Invalid result — use pending, won, lost, or push');
    entry.result = result;
  }

  entry.profit = settleProfit(entry.result, entry.units, entry.odds);
  saveJournal(journal);
  return entry;
}

function deleteEntry(id) {
  const journal = loadJournal();
  const before = journal.entries.length;
  journal.entries = journal.entries.filter((e) => e.id !== id);
  if (journal.entries.length === before) return false;
  saveJournal(journal);
  return true;
}

module.exports = {
  getEntries,
  addEntry,
  updateEntry,
  deleteEntry,
  summarize,
  settleProfit,
  loadJournal,
  saveJournal,
};
