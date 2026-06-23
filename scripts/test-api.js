'use strict';

const http = require('http');

const BASE = process.env.API_BASE || 'http://localhost:3847';

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = { method, hostname: url.hostname, port: url.port, path: url.pathname + url.search };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json;
        try { json = JSON.parse(data); } catch { json = { raw: data.slice(0, 120) }; }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    if (body) {
      req.setHeader('Content-Type', 'application/json');
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

const tests = [
  ['GET /api/health', () => request('GET', '/api/health')],
  ['GET /api/teams', () => request('GET', '/api/teams')],
  ['GET /api/injuries', () => request('GET', '/api/injuries')],
  ['GET /api/roster/las', () => request('GET', '/api/roster/las')],
  ['GET /api/predictions?days=7', () => request('GET', '/api/predictions?days=7')],
  ['POST /api/predictions/matchup', () => request('POST', '/api/predictions/matchup', { homeTeamKey: 'las', awayTeamKey: 'min', date: '2026-06-25' })],
  ['GET /api/intelligence?days=7', () => request('GET', '/api/intelligence?days=7')],
  ['GET /api/intelligence/alerts', () => request('GET', '/api/intelligence/alerts')],
  ['GET /api/intelligence/health', () => request('GET', '/api/intelligence/health')],
  ['POST /api/intelligence/matchup', () => request('POST', '/api/intelligence/matchup', { homeKey: 'las', awayKey: 'min' })],
  ['POST /api/intelligence/what-if', () => request('POST', '/api/intelligence/what-if', { homeKey: 'las', awayKey: 'min' })],
  ['GET /api/history', () => request('GET', '/api/history')],
  ['GET /api/accuracy', () => request('GET', '/api/accuracy')],
  ['GET /api/journal', () => request('GET', '/api/journal')],
  ['GET /api/h2h', () => request('GET', '/api/h2h?teamA=las&teamB=min&days=30')],
  ['GET /api/intelligence/lineup-watch', () => request('GET', '/api/intelligence/lineup-watch?days=7')],
  ['GET /api/odds/movement', () => request('GET', '/api/odds/movement?homeKey=las&awayKey=min')],
  ['GET /api/grade', () => request('GET', '/api/grade?days=14')],
  ['GET /api/scoreboard', () => request('GET', '/api/scoreboard')],
  ['GET /api/scoreboard/live', () => request('GET', '/api/scoreboard/live')],
  ['GET /api/teams/las/stats', () => request('GET', '/api/teams/las/stats')],
  ['GET /api/teams/las/players', () => request('GET', '/api/teams/las/players')],
];

(async () => {
  let passed = 0;
  let failed = 0;
  console.log(`Smoke testing ${BASE}\n`);
  for (const [name, fn] of tests) {
    try {
      const { ok, status, json } = await fn();
      if (ok && !json.error) {
        console.log(`PASS  ${name} (${status})`);
        passed += 1;
      } else {
        console.log(`FAIL  ${name} (${status}) ${json.error || JSON.stringify(json).slice(0, 100)}`);
        failed += 1;
      }
    } catch (e) {
      console.log(`FAIL  ${name} — ${e.message}`);
      failed += 1;
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
