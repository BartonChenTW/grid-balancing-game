// End-of-day report and data export (pure string building, testable in Node).
// The page turns these strings into downloadable files; nothing is uploaded.

/** Escapes text for safe use inside HTML. */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function csvCell(value) {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Minute-by-minute data as CSV.
 * history: { until, groupIds, demand, charging, freq, series: [values per group] }
 */
export function reportCsv(history, formatTime) {
  const header = ['time', 'demand_MW', 'storage_charging_MW', 'frequency_Hz', ...history.groupIds.map((id) => `${id}_MW`)];
  const lines = [header.join(',')];
  for (let m = 0; m <= history.until; m++) {
    const row = [
      formatTime(m),
      history.demand[m].toFixed(1),
      history.charging[m].toFixed(1),
      history.freq[m].toFixed(3),
      ...history.series.map((values) => values[m].toFixed(1)),
    ];
    lines.push(row.map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}

const table = (rows) =>
  `<table>${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join('')}</table>`;

/**
 * A self-contained HTML report.
 * r: { lang, title, subtitle, generated, playUrl, labels: {...section titles},
 *      setup: [[label, value]], points, stars, kpis: [{ label, value, hint, score }],
 *      metrics: [[label, value]], lesson, systemCost: { total, note }, chartPng, freqPng,
 *      events: [{ time, text, note }], dataNote }
 */
export function reportHtml(r) {
  const L = r.labels;
  const stars = '★'.repeat(r.stars) + '☆'.repeat(3 - r.stars);
  const kpis = r.kpis
    .map((k) => `<div class="kpi"><div class="kpi-head"><span>${escapeHtml(k.label)}</span><strong>${escapeHtml(k.value)}</strong></div>` +
      `<div class="bar"><span style="width:${Math.max(0, Math.min(100, Number(k.score) || 0))}%"></span></div>` +
      `<div class="kpi-foot"><span>${escapeHtml(k.hint)}</span><span>${escapeHtml(k.scoreText)}</span></div></div>`)
    .join('');
  const events = r.events.length
    ? `<ol class="log">${r.events.map((e) => `<li><time>${escapeHtml(e.time)}</time> ${escapeHtml(e.text)}${e.note ? `<br><small>${escapeHtml(e.note)}</small>` : ''}</li>`).join('')}</ol>`
    : `<p>${escapeHtml(L.noEvents)}</p>`;
  const img = (src, alt) => (src && src.startsWith('data:image/png;base64,') ? `<img src="${src}" alt="${escapeHtml(alt)}">` : '');
  return `<!doctype html>
<html lang="${escapeHtml(r.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(r.title)}</title>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", sans-serif; color: #0b0b0b; background: #fff; max-width: 880px; margin: 0 auto; padding: 24px 16px 48px; line-height: 1.5; }
  h1 { margin: 0 0 4px; font-size: 1.6rem; } h2 { font-size: 1.1rem; margin: 28px 0 8px; border-bottom: 1px solid #e1e0d9; padding-bottom: 4px; }
  .sub { color: #52514e; margin: 0 0 4px; } .meta { color: #7a7873; font-size: 0.85rem; }
  table { border-collapse: collapse; width: 100%; font-size: 0.92rem; } th, td { text-align: left; padding: 5px 8px 5px 0; border-bottom: 1px solid #eee; vertical-align: top; } td { font-variant-numeric: tabular-nums; }
  .score { display: flex; align-items: baseline; gap: 16px; } .score .stars { font-size: 1.6rem; color: #d99a00; letter-spacing: 3px; } .score strong { font-size: 1.5rem; }
  .kpi { margin: 10px 0; } .kpi-head, .kpi-foot { display: flex; justify-content: space-between; gap: 8px; } .kpi-foot { font-size: 0.82rem; color: #52514e; }
  .bar { height: 8px; background: #eeede8; border-radius: 4px; overflow: hidden; margin: 4px 0 2px; } .bar span { display: block; height: 100%; background: #2a78d6; }
  .lesson { background: #eaf1fb; border-radius: 8px; padding: 10px 14px; }
  img { max-width: 100%; border: 1px solid #e1e0d9; border-radius: 6px; margin-top: 6px; }
  .log { padding-left: 0; list-style: none; font-size: 0.9rem; } .log li { margin: 6px 0; } .log time { color: #7a7873; font-variant-numeric: tabular-nums; margin-right: 6px; } .log small { color: #52514e; }
  a { color: #2a78d6; }
  @media print { body { padding: 0; } a { color: inherit; } }
</style>
</head>
<body>
<h1>${escapeHtml(r.title)}</h1>
<p class="sub">${escapeHtml(r.subtitle)}</p>
<p class="meta">${escapeHtml(r.generated)} · <a href="${escapeHtml(r.playUrl)}">${escapeHtml(r.playUrl)}</a></p>

<h2>${escapeHtml(L.setup)}</h2>
${table(r.setup)}

<h2>${escapeHtml(L.score)}</h2>
<div class="score"><span class="stars" aria-label="${escapeHtml(r.starsLabel)}">${stars}</span><strong>${escapeHtml(r.points)}</strong></div>
${kpis}

<h2>${escapeHtml(L.metrics)}</h2>
${table(r.metrics)}

<h2>${escapeHtml(L.lesson)}</h2>
<p class="lesson">${escapeHtml(r.lesson)}</p>

<h2>${escapeHtml(L.chart)}</h2>
${img(r.chartPng, L.chart)}
${img(r.freqPng, L.freq)}
<p class="meta">${escapeHtml(r.dataNote)}</p>

<h2>${escapeHtml(L.systemCost)}</h2>
<p><strong>${escapeHtml(r.systemCost.total)}</strong><br><span class="meta">${escapeHtml(r.systemCost.note)}</span></p>

<h2>${escapeHtml(L.events)}</h2>
${events}
</body>
</html>
`;
}
