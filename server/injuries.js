'use strict';

const dataFetcher = require('./data-fetcher');

async function getInjuries() {
  const result = await dataFetcher.getInjuries();
  return {
    injuries: result.injuries || [],
    source: result.source,
    lastUpdated: result.lastUpdated,
    cacheAgeSeconds: result.cacheAgeSeconds,
    isLive: result.isLive,
    warning: result.warning,
  };
}

async function getInjuriesForTeam(teamKey) {
  const all = await getInjuries();
  const key = teamKey.toLowerCase();
  return {
    ...all,
    injuries: all.injuries.filter((i) => i.teamKey === key),
  };
}

module.exports = {
  getInjuries,
  getInjuriesForTeam,
};
