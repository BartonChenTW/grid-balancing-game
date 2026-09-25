// Demand-and-supply chart (stacked areas by technology, demand line and
// forecasts) plus a frequency strip underneath on the same time axis.
// Drawn on <canvas> without libraries. Colours come from CSS tokens so light
// and dark themes both work.
import { forecastLoad, forecastVariable } from './sim.js';
import { formatClock, formatNumber, t } from './strings.js';

const DAY = 1440;

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function niceStep(range, target) {
  const raw = range / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
}

function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: rect.width, height: rect.height };
}

// miniCanvas (optional): a compact copy of the main chart, shown in the
// sticky top bar when the full chart has scrolled out of view.
export function createChart({ canvas, freqCanvas, miniCanvas = null, tooltip, legend, cfg }) {
  const groups = cfg.ui.chartGroups;
  const groupOf = {};
  groups.forEach((g, i) => g.types.forEach((type) => (groupOf[type] = i)));
  const otherIndex = groups.findIndex((g) => g.id === 'other');

  let world = null;
  let history = null;
  let colors = null;
  let latest = null;
  let cursor = null; // minute under the pointer / keyboard cursor
  let yMaxMW = 0;
  let lastDrawMs = 0;
  let forecastCache = { key: '', load: [], net: [] };

  function readColors() {
    colors = {
      surface: css('--chart-surface'),
      ink: css('--text'),
      ink2: css('--text-2'),
      muted: css('--muted'),
      grid: css('--grid'),
      axis: css('--axis'),
      good: css('--status-good'),
      warning: css('--status-warning'),
      critical: css('--status-critical'),
      series: groups.map((g) => css(`--series-${g.id}`)),
    };
  }

  function reset(newWorld) {
    world = newWorld;
    history = {
      groups: groups.map(() => new Float32Array(DAY + 1)),
      demand: new Float32Array(DAY + 1),
      charging: new Float32Array(DAY + 1),
      freq: new Float32Array(DAY + 1),
      until: -1,
    };
    yMaxMW = world.peakLoadMW * 1.15;
    cursor = null;
    forecastCache.key = '';
    hideTooltip();
    buildLegend();
  }

  function buildLegend() {
    legend.replaceChildren();
    const present = new Set(world.units.map((u) => groupOf[u.type]));
    present.add(otherIndex); // automatic response can appear in any fleet
    groups.forEach((g, i) => {
      if (!present.has(i)) return;
      legend.append(legendItem('area', `--series-${g.id}`, t(`group.${g.id}`)));
    });
    legend.append(legendItem('line', '--text', t('chart.demand')));
    legend.append(legendItem('dash', '--text-2', t('chart.forecast')));
    legend.append(legendItem('dot', '--muted', t('chart.netForecast')));
    legend.append(legendItem('line', '--series-storage', t('chart.charging')));
  }

  function legendItem(kind, token, label) {
    const li = document.createElement('li');
    const key = document.createElement('span');
    key.className = `key key-${kind}`;
    key.style.setProperty('--key', `var(${token})`);
    const text = document.createElement('span');
    text.textContent = label;
    li.append(key, text);
    return li;
  }

  /** Stores one minute of history. */
  function record(state) {
    const m = state.minute;
    if (m > DAY) return;
    const byGroup = new Array(groups.length).fill(0);
    for (const unit of state.units) {
      if (unit.outputMW > 0) byGroup[groupOf[unit.type] ?? otherIndex] += unit.outputMW;
    }
    if (state.governorMW > 0) byGroup[otherIndex] += state.governorMW;
    byGroup.forEach((mw, i) => (history.groups[i][m] = mw));
    history.demand[m] = state.servedLoadMW;
    history.charging[m] = state.chargingMW;
    history.freq[m] = state.frequencyHz;
    history.until = Math.max(history.until, m);
    const total = byGroup.reduce((a, b) => a + b, 0);
    yMaxMW = Math.max(yMaxMW, total * 1.05, (state.servedLoadMW + state.chargingMW) * 1.05);
  }

  function forecasts(state) {
    // Recompute when time moves on or the known events change.
    const key = `${Math.floor(state.minute / cfg.ui.forecastStepMin)}:${state.effects.length}:${state.nextEvent}:${state.eventLog.length}`;
    if (forecastCache.key === key) return forecastCache;
    const load = [];
    const net = [];
    for (let m = state.minute; m <= DAY; m += cfg.ui.forecastStepMin) {
      const l = forecastLoad(world, m, cfg);
      load.push([m, l]);
      net.push([m, l - forecastVariable(world, 'solar', m, cfg, state) - forecastVariable(world, 'wind', m, cfg, state)]);
    }
    forecastCache = { key, load, net };
    return forecastCache;
  }

  function draw(state, force = false) {
    latest = state;
    const now = performance.now();
    if (!force && now - lastDrawMs < 1000 / cfg.ui.chartFps) return;
    lastDrawMs = now;
    if (!colors) readColors();
    drawMain(state);
    drawFrequency(state);
    drawMini(state);
    if (cursor !== null) showTooltip();
  }

  // ---- Main chart ---------------------------------------------------------

  function layout(width, height) {
    const narrow = width < 480;
    return { left: narrow ? 46 : 52, right: 12, top: 10, bottom: 24, narrow, width, height };
  }

  function drawMain(state) {
    const { ctx, width, height } = setupCanvas(canvas);
    const L = layout(width, height);
    const plotW = width - L.left - L.right;
    const plotH = height - L.top - L.bottom;
    const x = (m) => L.left + (m / DAY) * plotW;
    const yTop = yMaxMW;
    const y = (mw) => L.top + plotH - (mw / yTop) * plotH;

    ctx.fillStyle = colors.surface;
    ctx.fillRect(0, 0, width, height);

    // Future region: a faint wash so "now" reads clearly.
    ctx.fillStyle = colors.grid;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(x(state.minute), L.top, x(DAY) - x(state.minute), plotH);
    ctx.globalAlpha = 1;

    // Gridlines and y ticks in GW.
    const step = niceStep(yTop / 1000, L.narrow ? 4 : 6) * 1000;
    ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.lineWidth = 1;
    for (let v = 0; v <= yTop; v += step) {
      const yy = Math.round(y(v)) + 0.5;
      ctx.strokeStyle = v === 0 ? colors.axis : colors.grid;
      ctx.beginPath();
      ctx.moveTo(L.left, yy);
      ctx.lineTo(L.left + plotW, yy);
      ctx.stroke();
      ctx.fillStyle = colors.muted;
      ctx.fillText(`${formatNumber(v / 1000)} GW`, L.left - 6, yy);
    }
    drawTimeAxis(ctx, L, x, L.top + plotH);
    drawSeries(ctx, x, y, state);

    // Now marker.
    const nx = drawNow(ctx, x, state, L.top, L.top + plotH);
    ctx.fillStyle = colors.ink2;
    ctx.textAlign = state.minute > DAY * 0.9 ? 'right' : 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(t('chart.now'), nx + (ctx.textAlign === 'left' ? 4 : -4), L.top + 2);

    drawCursor(ctx, L, x, L.top, L.top + plotH);
  }

  /** Stacked supply, demand, storage charging and forecast lines (shared by the full and mini charts). */
  function drawSeries(ctx, x, y, state) {
    const until = Math.min(history.until, state.minute);
    if (until >= 1) {
      const base = new Float32Array(until + 1);
      groups.forEach((g, gi) => {
        const values = history.groups[gi];
        let any = false;
        for (let m = 0; m <= until; m++) if (values[m] > 0) { any = true; break; }
        if (!any) return;
        ctx.beginPath();
        for (let m = 0; m <= until; m++) ctx.lineTo(x(m), y(base[m] + values[m]));
        for (let m = until; m >= 0; m--) ctx.lineTo(x(m), y(base[m]));
        ctx.closePath();
        ctx.fillStyle = colors.series[gi];
        ctx.globalAlpha = 0.85;
        ctx.fill();
        ctx.globalAlpha = 1;
        for (let m = 0; m <= until; m++) base[m] += values[m];
        // 2px surface gap on top of each layer.
        ctx.beginPath();
        for (let m = 0; m <= until; m++) ctx.lineTo(x(m), y(base[m]));
        ctx.strokeStyle = colors.surface;
        ctx.lineWidth = 2;
        ctx.stroke();
      });

      // Demand plus storage charging: what supply actually has to meet.
      let charging = false;
      for (let m = 0; m <= until; m++) if (history.charging[m] > 0.5) { charging = true; break; }
      if (charging) {
        ctx.beginPath();
        for (let m = 0; m <= until; m++) ctx.lineTo(x(m), y(history.demand[m] + history.charging[m]));
        line(ctx, colors.series[groups.findIndex((g) => g.id === 'storage')], 2, []);
      }

      // Demand line.
      ctx.beginPath();
      for (let m = 0; m <= until; m++) ctx.lineTo(x(m), y(history.demand[m]));
      line(ctx, colors.ink, 2, []);
    }

    // Forecast lines ahead of now.
    const f = forecasts(state);
    ctx.beginPath();
    f.load.forEach(([m, v]) => ctx.lineTo(x(m), y(v)));
    line(ctx, colors.ink2, 1.5, [6, 4]);
    ctx.beginPath();
    f.net.forEach(([m, v]) => ctx.lineTo(x(m), y(Math.max(0, v))));
    line(ctx, colors.muted, 1.5, [2, 3]);
  }

  function drawNow(ctx, x, state, top, bottom) {
    const nx = Math.round(x(state.minute)) + 0.5;
    ctx.strokeStyle = colors.muted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(nx, top);
    ctx.lineTo(nx, bottom);
    ctx.stroke();
    return nx;
  }

  // ---- Mini chart (sticky, when the full chart is out of view) ---------------

  function drawMini(state) {
    if (!miniCanvas || miniCanvas.offsetParent === null) return; // hidden
    const { ctx, width, height } = setupCanvas(miniCanvas);
    const L = { left: 34, right: 6, top: 3, bottom: 14 };
    const plotW = width - L.left - L.right;
    const plotH = height - L.top - L.bottom;
    const x = (m) => L.left + (m / DAY) * plotW;
    const y = (mw) => L.top + plotH - (mw / yMaxMW) * plotH;

    ctx.fillStyle = colors.surface;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = colors.grid;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(x(state.minute), L.top, x(DAY) - x(state.minute), plotH);
    ctx.globalAlpha = 1;

    // One mid gridline and the baseline, labelled in GW.
    const step = niceStep(yMaxMW / 1000, 2) * 1000;
    ctx.font = '10px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    for (let v = 0; v <= yMaxMW; v += step) {
      const yy = Math.round(y(v)) + 0.5;
      ctx.strokeStyle = v === 0 ? colors.axis : colors.grid;
      ctx.beginPath();
      ctx.moveTo(L.left, yy);
      ctx.lineTo(L.left + plotW, yy);
      ctx.stroke();
      ctx.fillStyle = colors.muted;
      ctx.fillText(`${formatNumber(v / 1000)} GW`, L.left - 4, yy);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let m = 0; m <= DAY; m += 360) {
      ctx.fillText(formatClock(m).slice(0, 2), Math.min(Math.max(x(m), L.left + 6), L.left + plotW - 6), L.top + plotH + 2);
    }

    drawSeries(ctx, x, y, state);
    drawNow(ctx, x, state, L.top, L.top + plotH);
  }

  function line(ctx, color, width, dash) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.setLineDash(dash);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawTimeAxis(ctx, L, x, yAxis) {
    ctx.fillStyle = colors.muted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const every = L.narrow ? 360 : 180;
    for (let m = 0; m <= DAY; m += every) {
      ctx.fillText(formatClock(m), Math.min(Math.max(x(m), L.left + 14), L.left + (L.width - L.left - L.right) - 14), yAxis + 6);
    }
  }

  function drawCursor(ctx, L, x, top, bottom) {
    if (cursor === null) return;
    const cx = Math.round(x(cursor)) + 0.5;
    ctx.strokeStyle = colors.ink2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, top);
    ctx.lineTo(cx, bottom);
    ctx.stroke();
  }

  // ---- Frequency strip ------------------------------------------------------

  function drawFrequency(state) {
    const { ctx, width, height } = setupCanvas(freqCanvas);
    const L = layout(width, height);
    const top = 6;
    const bottom = height - 6;
    const plotW = width - L.left - L.right;
    const [lo, hi] = cfg.ui.freqStripRangeHz;
    const x = (m) => L.left + (m / DAY) * plotW;
    const y = (hz) => bottom - ((Math.min(hi, Math.max(lo, hz)) - lo) / (hi - lo)) * (bottom - top);
    const b = cfg.bands;

    ctx.fillStyle = colors.surface;
    ctx.fillRect(0, 0, width, height);
    const band = (from, to, color, alpha) => {
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha;
      ctx.fillRect(L.left, y(to), plotW, y(from) - y(to));
      ctx.globalAlpha = 1;
    };
    band(lo, b.warningLowHz, colors.critical, 0.16);
    band(b.warningLowHz, b.normalLowHz, colors.warning, 0.18);
    band(b.normalLowHz, b.normalHighHz, colors.good, 0.14);
    band(b.normalHighHz, b.warningHighHz, colors.warning, 0.18);
    band(b.warningHighHz, hi, colors.critical, 0.16);

    ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = colors.muted;
    for (const hz of [lo + 0.5, cfg.frequency.nominalHz, hi - 0.5]) {
      ctx.fillText(formatNumber(hz, hz % 1 ? 1 : 0), L.left - 6, y(hz));
    }
    ctx.strokeStyle = colors.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(L.left, Math.round(y(cfg.frequency.nominalHz)) + 0.5);
    ctx.lineTo(L.left + plotW, Math.round(y(cfg.frequency.nominalHz)) + 0.5);
    ctx.stroke();

    const until = Math.min(history.until, state.minute);
    if (until >= 1) {
      ctx.beginPath();
      for (let m = 0; m <= until; m++) ctx.lineTo(x(m), y(history.freq[m]));
      line(ctx, colors.ink, 2, []);
    }
    drawCursor(ctx, L, x, top, bottom);
  }

  // ---- Hover and keyboard readout ------------------------------------------

  function minuteAt(clientX) {
    const rect = canvas.getBoundingClientRect();
    const L = layout(rect.width, rect.height);
    const plotW = rect.width - L.left - L.right;
    const m = Math.round(((clientX - rect.left - L.left) / plotW) * DAY);
    return Math.min(DAY, Math.max(0, m));
  }

  function row(value, label, token, kind) {
    const div = document.createElement('div');
    div.className = 'tt-row';
    if (token) {
      const key = document.createElement('span');
      key.className = `key key-${kind}`;
      key.style.setProperty('--key', `var(${token})`);
      div.append(key);
    }
    const v = document.createElement('strong');
    v.textContent = value;
    const l = document.createElement('span');
    l.textContent = label;
    div.append(v, l);
    return div;
  }

  function showTooltip() {
    if (!latest || cursor === null) return;
    const m = cursor;
    const rows = [];
    const head = document.createElement('div');
    head.className = 'tt-head';
    head.textContent = formatClock(m);
    rows.push(head);
    const mw = (v) => `${formatNumber(v)} MW`;
    if (m <= Math.min(history.until, latest.minute)) {
      rows.push(row(mw(history.demand[m]), t('chart.demand'), '--text', 'line'));
      for (let gi = groups.length - 1; gi >= 0; gi--) {
        const v = history.groups[gi][m];
        if (v > 0.5) rows.push(row(mw(v), t(`group.${groups[gi].id}`), `--series-${groups[gi].id}`, 'line'));
      }
      if (history.charging[m] > 0.5) rows.push(row(mw(history.demand[m] + history.charging[m]), t('chart.charging'), '--series-storage', 'line'));
      rows.push(row(t('chart.hz', { v: formatNumber(history.freq[m], 2) }), t('chart.freqTitle')));
    } else {
      const load = forecastLoad(world, m, cfg);
      const net = load - forecastVariable(world, 'solar', m, cfg, latest) - forecastVariable(world, 'wind', m, cfg, latest);
      rows.push(row(mw(load), t('chart.forecast'), '--text-2', 'dash'));
      rows.push(row(mw(net), t('chart.netForecast'), '--muted', 'dot'));
    }
    tooltip.replaceChildren(...rows);
    tooltip.hidden = false;

    const rect = canvas.getBoundingClientRect();
    const L = layout(rect.width, rect.height);
    const px = L.left + (m / DAY) * (rect.width - L.left - L.right);
    const tw = tooltip.offsetWidth;
    const left = px + 12 + tw > rect.width ? px - 12 - tw : px + 12;
    tooltip.style.left = `${Math.max(0, left)}px`;
    tooltip.style.top = `${L.top + 4}px`;
  }

  function hideTooltip() {
    tooltip.hidden = true;
  }

  function setCursor(m) {
    cursor = m;
    if (latest) draw(latest, true);
    if (m === null) hideTooltip();
  }

  for (const el of [canvas, freqCanvas]) {
    el.addEventListener('pointermove', (e) => setCursor(minuteAt(e.clientX)));
    el.addEventListener('pointerdown', (e) => setCursor(minuteAt(e.clientX)));
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') setCursor(null);
    });
  }
  canvas.addEventListener('keydown', (e) => {
    const stepMin = cfg.ui.chartCursorStepMin;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      const from = cursor ?? latest?.minute ?? 0;
      setCursor(Math.min(DAY, Math.max(0, from + (e.key === 'ArrowRight' ? stepMin : -stepMin))));
    } else if (e.key === 'Escape') {
      setCursor(null);
    }
  });
  canvas.addEventListener('blur', () => setCursor(null));

  const resize = new ResizeObserver(() => latest && draw(latest, true));
  resize.observe(canvas);
  if (miniCanvas) resize.observe(miniCanvas);
  const scheme = window.matchMedia('(prefers-color-scheme: dark)');
  scheme.addEventListener('change', () => {
    readColors();
    if (latest) draw(latest, true);
  });

  /** Recorded history, for the CSV export. */
  function exportHistory() {
    return {
      until: history.until,
      groupIds: groups.map((g) => g.id),
      demand: history.demand,
      charging: history.charging,
      freq: history.freq,
      series: history.groups,
    };
  }

  /** PNG images of the chart and the frequency strip, for the report. */
  function snapshot() {
    if (latest) draw(latest, true);
    return { chart: canvas.toDataURL('image/png'), freq: freqCanvas.toDataURL('image/png') };
  }

  return { reset, record, draw, refreshColors: readColors, exportHistory, snapshot };
}
