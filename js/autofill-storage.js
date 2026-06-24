/**
 * Autofill storage module for matchup form persistence.
 * Saves and restores recent matchups from localStorage.
 */
(function (global) {
  const STORAGE_KEY = 'meepmap_matchup_history';
  const MAX_HISTORY = 10;

  function getHistory() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  function saveHistory(history) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
    } catch (err) {
      console.warn('Failed to save matchup history:', err);
    }
  }

  function addMatchup(matchup) {
    const history = getHistory();
    // Remove exact duplicate if it exists
    const filtered = history.filter((m) => !(m.away === matchup.away && m.home === matchup.home));
    // Add to front
    const updated = [matchup, ...filtered];
    saveHistory(updated);
    return updated;
  }

  function getLastMatchup() {
    const history = getHistory();
    return history[0] || null;
  }

  function getRecentMatchups(count = 5) {
    return getHistory().slice(0, count);
  }

  function clearHistory() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      console.warn('Failed to clear matchup history:', err);
    }
  }

  global.AutofillStorage = {
    getHistory,
    saveHistory,
    addMatchup,
    getLastMatchup,
    getRecentMatchups,
    clearHistory,
  };
})(window);
