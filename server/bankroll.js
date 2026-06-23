'use strict';

const fs = require('fs');
const path = require('path');
const journal = require('./journal');

const BANKROLL_PATH = path.join(__dirname, '..', 'data', 'bankroll.json');

const DEFAULTS = {
  startingBankroll: 1000,
  currentBankroll: 1000,
  unitSize: 10,
  totalUnitsWagered: 0,
  totalUnitsWon: 0,
  roi: 0,
  updatedAt: new Date().toISOString(),
};

function loadBankroll() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(BANKROLL_PATH, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveBankroll(data) {
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(BANKROLL_PATH, JSON.stringify(data, null, 2));
  return data;
}

function computeRoi(state) {
  const start = state.startingBankroll || 0;
  if (start <= 0) return 0;
  const current = state.currentBankroll ?? start;
  return Math.round(((current - start) / start) * 10000) / 100;
}

function getBankroll() {
  const state = loadBankroll();
  state.roi = computeRoi(state);
  return state;
}

function updateBankroll(updates) {
  const state = loadBankroll();
  if (typeof updates.startingBankroll === 'number') state.startingBankroll = updates.startingBankroll;
  if (typeof updates.currentBankroll === 'number') state.currentBankroll = updates.currentBankroll;
  if (typeof updates.unitSize === 'number') state.unitSize = updates.unitSize;
  if (typeof updates.totalUnitsWagered === 'number') state.totalUnitsWagered = updates.totalUnitsWagered;
  if (typeof updates.totalUnitsWon === 'number') state.totalUnitsWon = updates.totalUnitsWon;
  state.roi = computeRoi(state);
  saveBankroll(state);
  return state;
}

function syncFromJournal() {
  const { entries } = journal.getEntries();
  const settled = entries.filter((e) => e.result && e.result !== 'pending' && e.profit != null);
  const totalUnitsWagered = settled.reduce((s, e) => s + (e.units || 0), 0);
  const totalUnitsWon = settled.reduce((s, e) => s + (e.profit || 0), 0);
  const state = loadBankroll();
  const profitDollars = totalUnitsWon * (state.unitSize || 10);
  state.totalUnitsWagered = totalUnitsWagered;
  state.totalUnitsWon = totalUnitsWon;
  state.currentBankroll = state.startingBankroll + profitDollars;
  state.roi = computeRoi(state);
  saveBankroll(state);
  return state;
}

module.exports = { getBankroll, updateBankroll, syncFromJournal, loadBankroll };
