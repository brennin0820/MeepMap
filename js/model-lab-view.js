/**
 * Model Lab tab — backtest snapshot, per-market grading, calibration, audits.
 * Ports the iOS APIClient.buildPerformanceLab + ModelLabView. The performance
 * lab is computed client-side from the prediction history; the accuracy
 * snapshot reuses the server's /api/accuracy summary. Advanced metrics that
 * depend on per-entry fields the server does not persist (win-probability for
 * calibration/Brier, closing-line CLV) degrade gracefully to "—".
 */
(function (global) {
  const { escapeHtml } = global.AlertsUI || { escapeHtml: (s) => String(s ?? '') };

  // ---- formatting -----------------------------------------------------------
  function percent(v) {
    return v == null || Number.isNaN(Number(v)) ? '—' : `${Number(v).toFixed(1)}%`;
  }
  function decimal(v) {
    return v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(3);
  }
  function signed(v) {
    return v == null || Number.isNaN(Number(v)) ? '—' : `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(1)}`;
  }

  // ---- math (mirror iOS APIClient) ------------------------------------------
  function confidenceTier(confidence) {
    const n = typeof confidence === 'number' ? confidence : parseInt(confidence, 10);
    if (Number.isNaN(n)) return 'Unknown';
    if (n >= 70) return 'High';
    if (n >= 50) return 'Medium';
    return 'Low';
  }

  function accuracyPct(entries, field) {
    const scored = entries.filter((e) => e[field] != null);
    if (!scored.length) return null;
    const wins = scored.filter((e) => e[field]).length;
    return Math.round((wins / scored.length) * 1000) / 10;
  }

  function average(values) {
    if (!values.length) return null;
    return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
  }

  function beatCloseRate(values) {
    const comparable = values.filter((v) => !Number.isNaN(v));
    if (!comparable.length) return null;
    const wins = comparable.filter((v) => v > 0).length;
    return Math.round((wins / comparable.length) * 1000) / 10;
  }

  function brierScore(entries) {
    const pairs = entries
      .map((e) => (e.pickedWinProb != null && e.wasCorrect != null ? [e.pickedWinProb, e.wasCorrect ? 1 : 0] : null))
      .filter(Boolean);
    if (!pairs.length) return null;
    const value = pairs.reduce((acc, [p, y]) => acc + (p - y) ** 2, 0) / pairs.length;
    return Math.round(value * 1000) / 1000;
  }

  function logLoss(entries) {
    const pairs = entries
      .map((e) =>
        e.pickedWinProb != null && e.wasCorrect != null
          ? [Math.min(Math.max(e.pickedWinProb, 0.001), 0.999), e.wasCorrect ? 1 : 0]
          : null
      )
      .filter(Boolean);
    if (!pairs.length) return null;
    const value =
      pairs.reduce((acc, [p, y]) => acc - (y * Math.log(p) + (1 - y) * Math.log(1 - p)), 0) / pairs.length;
    return Math.round(value * 1000) / 1000;
  }

  function calibrationBuckets(entries) {
    const starts = [50, 55, 60, 65, 70, 75, 80, 85, 90];
    return starts
      .map((start) => {
        const end = start + 4;
        const members = entries.filter((e) => {
          if (e.pickedWinProb == null) return false;
          const pct = Math.floor(e.pickedWinProb * 100);
          return pct >= start && pct <= end;
        });
        const averagePredicted = members.length
          ? members.reduce((a, e) => a + e.pickedWinProb, 0) / members.length
          : (start + end) / 200;
        const actual = members.length
          ? members.filter((e) => e.wasCorrect === true).length / members.length
          : null;
        return { id: `bucket-${start}`, label: `${start}-${end}%`, averagePredicted, actualWinRate: actual, count: members.length };
      })
      .filter((b) => b.count > 0);
  }

  function marketPerformance(id, label, entries, field, clv) {
    const high = entries.filter((e) => confidenceTier(e.confidence) === 'High');
    return {
      id,
      label,
      overallAccuracy: accuracyPct(entries, field),
      highConfidenceAccuracy: accuracyPct(high, field),
      gradedCount: entries.filter((e) => e[field] != null).length,
      averageCLV: average(clv),
      beatCloseRate: beatCloseRate(clv),
    };
  }

  function buildPostgameAudits(completed) {
    return completed.slice(0, 20).map((e) => {
      const g = e.game || {};
      const away = g.away || (g.awayKey ? String(g.awayKey).toUpperCase() : 'Away');
      const home = g.home || (g.homeKey ? String(g.homeKey).toUpperCase() : 'Home');
      const clvPieces = [
        e.moneylineCLV != null ? `ML ${signed(e.moneylineCLV)}` : null,
        e.spreadCLV != null ? `Spread ${signed(e.spreadCLV)}` : null,
        e.totalCLV != null ? `Total ${signed(e.totalCLV)}` : null,
      ].filter(Boolean);
      const result = e.wasCorrect === true ? 'win' : e.wasCorrect === false ? 'loss' : e.result || 'pending';
      return {
        id: e.id,
        matchup: `${away} @ ${home}`,
        result,
        summary: e.postgameSummary || 'Postgame audit pending.',
        confidence: e.confidence,
        clvNote: clvPieces.length ? clvPieces.join(' · ') : null,
      };
    });
  }

  function localModelScore(overall, high, completedCount, brier, beatClose) {
    if (overall == null) return null;
    const highVal = high ?? overall;
    const sample = Math.min(1, completedCount / 25);
    const calibration = brier != null ? Math.max(0, 1 - brier) * 100 : overall;
    const clv = beatClose ?? 50;
    const score = overall * 0.45 + highVal * 0.2 + calibration * 0.2 + clv * 0.05 + sample * 10;
    return Math.round(Math.max(0, Math.min(100, score)));
  }

  function buildPerformanceLab(history) {
    const list = history || [];
    const completed = list.filter((e) => e.wasCorrect != null);
    const spreadEntries = list.filter((e) => e.spreadCorrect != null);
    const totalEntries = list.filter((e) => e.totalCorrect != null);

    const moneylineCLV = completed.map((e) => e.moneylineCLV).filter((v) => v != null);
    const spreadCLV = list.map((e) => e.spreadCLV).filter((v) => v != null);
    const totalCLV = list.map((e) => e.totalCLV).filter((v) => v != null);

    return {
      gradedCount: completed.length,
      brierScore: brierScore(completed),
      logLoss: logLoss(completed),
      beatClosingRate: beatCloseRate([...moneylineCLV, ...spreadCLV, ...totalCLV]),
      averageSpreadCLV: average(spreadCLV),
      averageTotalCLV: average(totalCLV),
      averageMoneylineCLV: average(moneylineCLV),
      markets: [
        marketPerformance('moneyline', 'Moneyline', completed, 'wasCorrect', moneylineCLV),
        marketPerformance('spread', 'Spread', spreadEntries, 'spreadCorrect', spreadCLV),
        marketPerformance('total', 'Total', totalEntries, 'totalCorrect', totalCLV),
      ],
      calibration: calibrationBuckets(completed),
      audits: buildPostgameAudits(completed),
    };
  }

  // ---- rendering ------------------------------------------------------------
  function metricCard(label, value) {
    return `<div class="lab-metric"><span class="lab-metric__label">${escapeHtml(label)}</span><span class="lab-metric__value">${escapeHtml(value)}</span></div>`;
  }

  function renderSummary(accuracy, lab) {
    const a = accuracy || {};
    const moneyline = a.moneylineAccuracy ?? a.moneyline?.overall ?? null;
    const high = a.highConfidenceAccuracy ?? a.moneyline?.high ?? null;
    const score = localModelScore(moneyline, high, a.completedGames || lab.gradedCount || 0, lab.brierScore, lab.beatClosingRate);
    const cards = [
      ['Model score', score == null ? '—' : String(score)],
      ['Moneyline hit', percent(moneyline)],
      ['Brier', decimal(lab.brierScore)],
      ['Log loss', decimal(lab.logLoss)],
      ['Beat close', percent(lab.beatClosingRate)],
      ['Avg margin err', a.averageMarginError != null ? Number(a.averageMarginError).toFixed(1) : '—'],
      ['Spread CLV', signed(lab.averageSpreadCLV)],
      ['Total CLV', signed(lab.averageTotalCLV)],
    ];
    return `
      <section class="settings-card lab-section">
        <header class="lab-section__head">
          <h3 class="section-title">Backtest Snapshot</h3>
          <span class="lab-section__meta">${lab.gradedCount} graded · model ${escapeHtml(a.modelVersion || '—')}</span>
        </header>
        <div class="lab-metric-grid">${cards.map(([l, v]) => metricCard(l, v)).join('')}</div>
        ${a.note ? `<p class="accuracy-note">${escapeHtml(a.note)}</p>` : ''}
      </section>`;
  }

  function renderMarkets(lab) {
    const rows = lab.markets
      .map(
        (m) => `
        <div class="lab-market">
          <div class="lab-market__head">
            <span class="lab-market__label">${escapeHtml(m.label)}</span>
            <span class="lab-market__graded">${m.gradedCount} graded</span>
          </div>
          <div class="lab-pills">
            <span class="lab-pill"><b>Overall</b> ${escapeHtml(percent(m.overallAccuracy))}</span>
            <span class="lab-pill"><b>High</b> ${escapeHtml(percent(m.highConfidenceAccuracy))}</span>
            <span class="lab-pill"><b>CLV</b> ${escapeHtml(signed(m.averageCLV))}</span>
            <span class="lab-pill"><b>Beat close</b> ${escapeHtml(percent(m.beatCloseRate))}</span>
          </div>
        </div>`
      )
      .join('');
    return `
      <section class="settings-card lab-section">
        <h3 class="section-title">Per-market grading</h3>
        <div class="lab-markets">${rows}</div>
      </section>`;
  }

  function renderCalibration(lab) {
    if (!lab.calibration.length) {
      return `
        <section class="settings-card lab-section">
          <h3 class="section-title">Calibration</h3>
          <p class="empty-state">Calibration populates once predictions store win-probability per pick.</p>
        </section>`;
    }
    const rows = lab.calibration
      .map((b) => {
        const predPct = Math.round(b.averagePredicted * 1000) / 10;
        const actualPct = b.actualWinRate == null ? null : Math.round(b.actualWinRate * 1000) / 10;
        const predW = Math.max(0, Math.min(100, b.averagePredicted * 100));
        const actW = b.actualWinRate == null ? null : Math.max(0, Math.min(100, b.actualWinRate * 100));
        return `
          <div class="lab-cal">
            <div class="lab-cal__head">
              <span class="lab-cal__label">${escapeHtml(b.label)}</span>
              <span class="lab-cal__count">${b.count} pick${b.count === 1 ? '' : 's'}</span>
            </div>
            <div class="lab-cal__nums">
              <span>Pred ${escapeHtml(percent(predPct))}</span>
              <span>Actual ${escapeHtml(percent(actualPct))}</span>
            </div>
            <div class="lab-cal__bar">
              <span class="lab-cal__pred" style="width:${predW}%"></span>
              ${actW == null ? '' : `<span class="lab-cal__actual" style="width:${actW}%"></span>`}
            </div>
          </div>`;
      })
      .join('');
    return `
      <section class="settings-card lab-section">
        <h3 class="section-title">Calibration</h3>
        <div class="lab-cals">${rows}</div>
      </section>`;
  }

  function renderAudits(lab) {
    if (!lab.audits.length) {
      return `
        <section class="settings-card lab-section">
          <h3 class="section-title">Postgame audits</h3>
          <p class="empty-state">No graded games yet — audits fill in as results are recorded.</p>
        </section>`;
    }
    const rows = lab.audits
      .slice(0, 10)
      .map((audit) => {
        const cls = audit.result === 'win' ? 'lab-audit--win' : audit.result === 'loss' ? 'lab-audit--loss' : 'lab-audit--pending';
        return `
          <article class="lab-audit ${cls}">
            <div class="lab-audit__head">
              <span class="lab-audit__matchup">${escapeHtml(audit.matchup)}</span>
              <span class="lab-audit__result">${escapeHtml(String(audit.result).toUpperCase())}</span>
            </div>
            <p class="lab-audit__summary">${escapeHtml(audit.summary)}</p>
            ${audit.clvNote ? `<p class="lab-audit__clv">${escapeHtml(audit.clvNote)}</p>` : ''}
          </article>`;
      })
      .join('');
    return `
      <section class="settings-card lab-section">
        <h3 class="section-title">Postgame audits</h3>
        <div class="lab-audits">${rows}</div>
      </section>`;
  }

  function renderModelLabPanel({ accuracy = null, history = [] } = {}) {
    const lab = buildPerformanceLab(history);
    return `
      <div class="model-lab-panel">
        <header class="panel-header">
          <h2 class="panel-title">Model Lab</h2>
          <p class="panel-desc">Backtest snapshot, per-market grading, calibration, and postgame audits.</p>
        </header>
        ${renderSummary(accuracy, lab)}
        ${renderMarkets(lab)}
        ${renderCalibration(lab)}
        ${renderAudits(lab)}
      </div>`;
  }

  global.ModelLabView = {
    renderModelLabPanel,
    buildPerformanceLab,
    _internal: { confidenceTier, accuracyPct, average, beatCloseRate, brierScore, logLoss, calibrationBuckets, localModelScore },
  };
})(window);
