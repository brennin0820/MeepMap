'use strict';

const storage = require('./storage');

const JOURNAL_FILE = 'journal.json';

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

function getEntries() {
  return loadJournal();
}

function addEntry(entry) {
  const journal = loadJournal();
  const record = {
    id: `j-${Date.now()}`,
    createdAt: new Date().toISOString(),
    gameId: entry.gameId || null,
    matchup: entry.matchup || null,
    betType: entry.betType || 'moneyline',
    pick: entry.pick || null,
    units: typeof entry.units === 'number' ? entry.units : 1,
    odds: entry.odds ?? null,
    notes: entry.notes || '',
    result: entry.result || 'pending',
    profit: entry.profit ?? null,
  };
  journal.entries.unshift(record);
  saveJournal(journal);
  return record;
}

module.exports = { getEntries, addEntry, loadJournal, saveJournal };
