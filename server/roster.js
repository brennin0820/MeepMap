'use strict';

const dataFetcher = require('./data-fetcher');

async function getRoster(teamKey) {
  const result = await dataFetcher.getRoster(teamKey);
  return {
    teamKey: result.teamKey || teamKey.toLowerCase(),
    roster: result.roster || [],
    source: result.source,
    lastUpdated: result.lastUpdated,
    cacheAgeSeconds: result.cacheAgeSeconds,
    isLive: result.isLive,
    warning: result.warning,
  };
}

module.exports = {
  getRoster,
};
