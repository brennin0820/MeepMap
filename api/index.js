'use strict';

/**
 * Vercel serverless entry — re-exports the Express app from server/index.js.
 * All HTTP traffic (API + SPA fallback) is routed here via vercel.json rewrites.
 * Static assets (index.html, js/, styles.css) are served from the CDN when present;
 * everything else falls through to this function.
 */
module.exports = require('../server/index');
