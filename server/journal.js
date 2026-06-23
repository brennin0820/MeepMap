'use strict';

const fs = require('fs');
const path = require('path');

const JOURNAL_PATH = path.join(__dirname, '..', 'data', 'journal.json');

function loadJournal() {
  try {
    return JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf8'));
  } catch {
    return { entries: [], updatedAt: new Date().toISOString() };
  }
}

function saveJournal(data) {
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(JOURNAL_PATH, JSON.stringify(data, null, 2));
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
