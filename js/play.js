// Step 3: the live game. Owns the game loop and renders the top bar, chart,
// side panel, unit cards, event log and end-of-day dialog.
import { createChart } from './chart.js';
import { computeScore, pickLesson } from './score.js';
import { createState, setSetpoint, startCommand, step, stopCommand } from './sim.js';
import { formatClock, formatDuration, formatEnergy, formatNumber, t } from './strings.js';
import { canAdjust, canStart, canStop, setpointRange } from './units.js';

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Sets text only when it changed, to keep DOM work low. */
function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

const mw = (v) => `${formatNumber(v)} MW`;
const gwText = (v) => `${formatNumber(v / 1000, 1)} GW`;

export function createPlay({ cfg, onQuit }) {
  const chart = createChart({
    canvas: $('chart'),
    freqCanvas: $('freq-chart'),
    tooltip: $('chart-tooltip'),
    legend: $('legend'),
    cfg,
  });
  $('chart').setAttribute('aria-label', t('chart.label'));

  let world = null;
  let meta = null;
  let state = null;
  let speedIndex = cfg.time.defaultSpeedIndex;
  let resumeIndex = speedIndex;
  let stepCarry = 0;
  let lastFrameMs = 0;
  let running = false;
  let rendered = null;
  let renderedSpeed = -1;
  let selected = 0;
  let cards = [];
  let logCount = 0;
  let toastTimer = null;
  let holdBlocked = false; // true while a dialog or the tutorial owns the screen
  const groupOf = {};
  cfg.ui.chartGroups.forEach((g) => g.types.forEach((type) => (groupOf[type] = g.id)));
  const pauseIndex = cfg.time.speeds.indexOf(0);

  // ---- Top bar ------------------------------------------------------------

  const speedButtons = cfg.time.speeds.map((speed, index) => {
    const b = el('button', '', speed === 0 ? t('speed.pause') : t('speed.x', { n: speed }));
    b.type = 'button';
    b.addEventListener('click', () => setSpeed(index));
    $('speeds').append(b);
    return b;
  });
  $('speeds').setAttribute('aria-label', t('speed.label'));
  $('menu-restart').setAttribute('aria-label', t('play.restart'));
  $('menu-restart').title = t('play.restart');
  $('menu-quit').setAttribute('aria-label', t('play.quit'));
  $('menu-quit').title = t('play.quit');
  $('help-btn').setAttribute('aria-label', t('play.help'));
  $('help-btn').title = t('play.help');

  // Gauge zones proportional to the configured bands.
  {
    const [lo, hi] = cfg.ui.gaugeRangeHz;
    const b = cfg.bands;
    const zones = [
      [lo, b.warningLowHz, 'z-crit'],
      [b.warningLowHz, b.normalLowHz, 'z-warn'],
      [b.normalLowHz, b.normalHighHz, 'z-ok'],
      [b.normalHighHz, b.warningHighHz, 'z-warn'],
      [b.warningHighHz, hi, 'z-crit'],
    ];
    $('gauge-zones').replaceChildren(
      ...zones.map(([from, to, cls]) => {
        const span = el('span', cls);
        span.style.width = `${((to - from) / (hi - lo)) * 100}%`;
        return span;
      }),
    );
    $('gauge').setAttribute('aria-valuemin', String(lo));
    $('gauge').setAttribute('aria-valuemax', String(hi));
    $('gauge').setAttribute('aria-label', t('freq.label'));
  }

  function setSpeed(index) {
    if (index === pauseIndex && speedIndex !== pauseIndex) resumeIndex = speedIndex;
    speedIndex = index;
  }

  function togglePause() {
    setSpeed(speedIndex === pauseIndex ? resumeIndex : pauseIndex);
  }

  // ---- Unit cards --------------------------------------------------------------

  function holdButton(button, action) {
    let timer = null;
    const stop = () => {
      clearTimeout(timer);
      clearInterval(timer);
      timer = null;
    };
    button.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || button.disabled) return;
      e.preventDefault();
      stop();
      action();
      timer = setTimeout(() => {
        timer = setInterval(() => (button.disabled ? stop() : action()), cfg.ui.holdRepeatMs);
      }, cfg.ui.holdDelayMs);
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) button.addEventListener(ev, stop);
    // Keyboard activation (Enter/Space on a focused button) arrives as a click with detail 0.
    button.addEventListener('click', (e) => {
      if (e.detail === 0) action();
    });
  }

  function buildCards() {
    const list = $('units');
    list.replaceChildren();
    cards = state.units.map((unit, i) => {
      const type = world.types[unit.type];
      const group = groupOf[unit.type] ?? 'other';
      const li = el('li', 'unit');
      li.setAttribute('role', 'group');
      li.setAttribute('aria-label', unit.name);
      li.style.setProperty('--key', `var(--series-${group})`);

      const head = el('div', 'unit-head');
      const sw = el('span', 'swatch');
      const name = el('span', 'unit-name', unit.name);
      head.append(sw, name);
      if (i < 10) head.append(el('span', 'unit-key', `[${(i + 1) % 10}]`));
      const status = el('span', 'status');
      head.append(status);

      const typeLine = el('div', 'unit-type', t(`unitType.${unit.type}`));
      const output = el('div', 'unit-output');
      const outNow = el('strong');
      const outInfo = el('span');
      output.append(outNow, outInfo);

      const bar = el('div', 'bar');
      const fill = el('div', 'bar-fill');
      const target = el('div', 'bar-target');
      bar.append(fill);
      if (!type.storage && !type.variable && type.minStablePct > 0) {
        const min = el('div', 'bar-min');
        min.style.left = `${type.minStablePct}%`;
        bar.append(min);
      }
      bar.append(target);

      const detail = el('div', 'unit-detail');
      const buttons = el('div', 'unit-buttons');
      const minus = el('button', 'adj', '−');
      const plus = el('button', 'adj', '+');
      minus.type = plus.type = 'button';
      minus.setAttribute('aria-label', t('unit.decrease', { name: unit.name }));
      plus.setAttribute('aria-label', t('unit.increase', { name: unit.name }));
      holdButton(minus, () => nudge(i, -1));
      holdButton(plus, () => nudge(i, 1));
      buttons.append(minus, plus);
      let power = null;
      if (!type.alwaysOnline) {
        power = el('button', 'power');
        power.type = 'button';
        power.addEventListener('click', () => togglePower(i));
        buttons.append(power);
      } else {
        buttons.style.gridTemplateColumns = '1fr 1fr';
      }
      li.addEventListener('pointerdown', () => select(i));
      li.append(head, typeLine, output, bar, detail, buttons);
      list.append(li);
      return { li, status, outNow, outInfo, fill, target, detail, minus, plus, power };
    });
    select(Math.min(selected, cards.length - 1));
  }

  function select(i) {
    selected = i;
    cards.forEach((c, k) => c.li.classList.toggle('selected', k === i));
  }

  function nudge(i, dir) {
    const unit = state.units[i];
    const type = world.types[unit.type];
    if (!canAdjust(unit) || state.status !== 'running') return;
    const stepMW = (cfg.ui.setpointStepPct / 100) * unit.maxMW;
    const base = type.variable ? Math.min(unit.setpointMW, unit.availableMW) : unit.setpointMW;
    state = setSetpoint(state, world, i, base + dir * stepMW, cfg);
  }

  function togglePower(i) {
    if (state.status !== 'running') return;
    const unit = state.units[i];
    const type = world.types[unit.type];
    if (unit.status === 'online' || unit.status === 'starting') state = stopCommand(state, world, i, cfg);
    else if (canStart(unit, type)) state = startCommand(state, world, i, cfg);
  }

  function renderCard(c, unit) {
    const type = world.types[unit.type];
    c.li.dataset.status = unit.status;
    c.status.dataset.status = unit.status;
    setText(c.status, t(`unit.status.${unit.status}`));
    setText(c.outNow, t('unit.output', { output: formatNumber(unit.outputMW) }));
    setText(c.outInfo, t('unit.setpoint', { setpoint: formatNumber(unit.setpointMW), max: formatNumber(unit.maxMW) }));
    c.fill.style.width = `${Math.min(100, (Math.abs(unit.outputMW) / unit.maxMW) * 100)}%`;
    c.fill.classList.toggle('charging', unit.outputMW < -0.5);
    c.target.hidden = !canAdjust(unit);
    c.target.style.left = `${Math.min(100, (Math.abs(unit.setpointMW) / unit.maxMW) * 100)}%`;

    let detail;
    if (unit.status === 'starting') detail = t('unit.startsIn', { time: formatDuration(unit.timer) });
    else if (unit.status === 'stopping') detail = t('unit.stopping');
    else if (unit.lockedOut) detail = t('unit.lockedOut');
    else if (type.variable) detail = t('unit.variable', { available: formatNumber(unit.availableMW), curtailed: formatNumber(unit.curtailedMW) });
    else if (type.storage) detail = t('unit.soc', { pct: formatNumber((unit.socMWh / unit.energyMWh) * 100), energy: formatEnergy(unit.socMWh) });
    else if (type.energyLimited) detail = t('unit.water', { pct: formatNumber((unit.budgetMWh / unit.energyMWh) * 100) });
    else if (type.activationLimited) detail = t('unit.dsm', { time: formatDuration(unit.maxActivationMin - unit.activeMin) });
    else if (unit.status === 'offline') detail = t('unit.startupTakes', { time: formatDuration(type.startupMin) });
    else detail = t('unit.thermal', { ramp: formatNumber((type.rampPctPerMin / 100) * unit.maxMW), min: formatNumber(setpointRange(unit, type)[0]) });
    setText(c.detail, detail);

    const [lo, hi] = canAdjust(unit) ? setpointRange(unit, type) : [0, 0];
    const current = type.variable ? Math.min(unit.setpointMW, unit.availableMW) : unit.setpointMW;
    const live = state.status === 'running';
    c.minus.disabled = !live || !canAdjust(unit) || current <= lo + 0.5;
    c.plus.disabled = !live || !canAdjust(unit) || unit.setpointMW >= hi - 0.5;
    if (c.power) {
      const label = unit.status === 'online' ? t('unit.stop') : unit.status === 'starting' ? t('unit.cancel') : t('unit.start');
      setText(c.power, label);
      c.power.disabled = !live || !(canStop(unit, type) || canStart(unit, type));
      c.power.setAttribute('aria-label', `${label} ${unit.name}`);
    }
  }

  // ---- Side panel and log ---------------------------------------------------------

  function renderSide() {
    const s = state;
    // Demand includes storage charging and supply includes automatic response,
    // so supply − demand is exactly the imbalance.
    setText($('s-demand'), mw(s.servedLoadMW + s.chargingMW));
    setText($('s-demand-hint'), s.chargingMW > 0.5 ? t('stat.demandHint', { mw: formatNumber(s.chargingMW) }) : '');
    setText($('s-supply'), mw(s.generationMW + s.governorMW));
    const imb = Math.round(s.imbalanceMW) || 0;
    const imbLabel = Math.abs(imb) < 1 ? t('imbalance.balanced') : imb > 0 ? t('imbalance.surplus') : t('imbalance.shortfall');
    setText($('s-imbalance'), `${imb > 0 ? '+' : ''}${formatNumber(imb)} MW · ${imbLabel}`);
    setText($('s-inertia'), `${formatNumber(s.inertia.hSys, 1)} s`);
    setText($('s-inertia-hint'), t('stat.inertiaHint', { kinetic: formatNumber(s.inertia.kineticMWs / 1000) }));
    $('inertia-stat').classList.toggle('low-inertia', s.inertia.hSys < 3);
    setText($('s-reserve'), gwText(s.reserve.upMW));
    setText($('s-reserve-hint'), t('stat.reserveHint', { up: gwText(s.reserve.upMW), down: gwText(s.reserve.downMW) }));
    setText($('s-auto'), `${s.governorMW > 0 ? '+' : ''}${formatNumber(s.governorMW)} MW`);
    setText($('s-curtailed'), mw(s.curtailedMW));
    setText($('s-cost'), `NT$ ${formatNumber(s.stats.costNTD / 1e6)} M`);
    setText($('s-co2'), `${formatNumber(s.stats.co2Tonnes / 1000, 1)} kt`);
    $('shed-stat').hidden = s.shedStage === 0;
    setText($('s-shed'), `${s.shedStage * cfg.ufls.stagePct}%`);
  }

  function describeEvent(e) {
    switch (e.type) {
      case 'trip':
        return [t('event.trip', { unit: e.unit, mw: formatNumber(e.lostMW) }), e.note ? t(`note.${e.note}`) : ''];
      case 'clouds':
        return [t('event.clouds'), ''];
      case 'windCutout':
        return [t('event.windCutout'), ''];
      case 'warning':
        return [t(`event.warning.${e.about}`, { time: formatClock(e.atMin) }), ''];
      case 'shed':
        return [t('event.shed', { stage: e.stage, pct: e.stage * cfg.ufls.stagePct }), ''];
      case 'restore':
        return [t('event.restore', { stage: e.stage }), ''];
      default:
        return [e.type, ''];
    }
  }

  function renderLog() {
    const log = state.eventLog;
    if (log.length === logCount) return;
    const list = $('log');
    if (logCount === 0) list.replaceChildren();
    for (let i = logCount; i < log.length; i++) {
      const e = log[i];
      const [text, note] = describeEvent(e);
      const li = el('li');
      const time = el('time', '', formatClock(e.minute));
      li.append(time, el('span', '', text));
      if (note) li.append(el('span', 'log-note', note));
      list.prepend(li);
      if (e.type !== 'restore') showToast(text, note);
    }
    logCount = log.length;
  }

  function clearLog() {
    logCount = 0;
    $('log').replaceChildren(el('li', 'empty', t('events.empty')));
  }

  function showToast(text, note) {
    const toast = $('toast');
    toast.replaceChildren(document.createTextNode(text));
    if (note) toast.append(el('small', '', note));
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), cfg.ui.toastMs);
  }

  // ---- Top bar render ------------------------------------------------------------------

  function renderTop() {
    const s = state;
    setText($('clock'), formatClock(Math.min(s.minute, cfg.time.dayMinutes)));
    $('freq-block').dataset.band = s.band;
    setText($('freq-value'), formatNumber(s.frequencyHz, 2));
    setText($('freq-band'), s.shedStage > 0 && s.band !== 'blackout' ? t('band.shedding') : t(`band.${s.band}`));
    const [lo, hi] = cfg.ui.gaugeRangeHz;
    const pos = Math.min(1, Math.max(0, (s.frequencyHz - lo) / (hi - lo)));
    $('gauge-needle').style.left = `${pos * 100}%`;
    $('gauge').setAttribute('aria-valuenow', s.frequencyHz.toFixed(2));
    $('gauge').setAttribute('aria-valuetext', `${s.frequencyHz.toFixed(2)} Hz, ${t(`band.${s.band}`)}`);
    speedButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === speedIndex)));
  }

  function render() {
    rendered = state;
    renderedSpeed = speedIndex;
    renderTop();
    renderSide();
    state.units.forEach((unit, i) => renderCard(cards[i], unit));
    renderLog();
    if (state.status !== 'running' && $('end-overlay').hidden) showEnd();
  }

  // ---- End of day ---------------------------------------------------------------------

  function showEnd() {
    const score = computeScore(state, cfg);
    const lesson = pickLesson(state, world, cfg);
    const blackout = state.status === 'blackout';
    $('end-title').textContent = blackout ? t('end.blackout') : t('end.finished');
    $('end-sub').textContent = blackout ? t('end.blackoutSub', { time: formatClock(state.minute) }) : t('end.finishedSub');
    const stars = $('end-stars');
    stars.replaceChildren(
      ...[0, 1, 2].map((i) => el('span', i < score.stars ? 'on' : 'off', '★')),
    );
    stars.setAttribute('aria-label', t('end.stars', { n: score.stars }));
    $('end-points').textContent = t('end.score', { points: formatNumber(score.points) });
    const rows = [
      [t('end.normal'), `${formatNumber(score.normalPct, 1)}%`],
      [t('end.shed'), formatNumber(score.shedStages)],
      [t('end.unserved'), formatEnergy(score.unservedMWh)],
      [t('end.cost'), `NT$ ${formatNumber(score.costNTD / 1e6)} M`],
      [t('end.co2'), `${formatNumber(score.co2Tonnes / 1000, 1)} kt`],
      [t('end.intensity'), `${formatNumber(score.co2Intensity, 2)} kg/kWh`],
      [t('end.re'), `${formatNumber(score.renewableSharePct, 1)}%`],
      [t('end.curtailed'), `${formatEnergy(score.curtailedMWh)} (${formatNumber(score.curtailedPct, 1)}%)`],
    ];
    $('end-metrics').replaceChildren(
      ...rows.map(([k, v]) => {
        const d = el('div');
        d.append(el('dt', '', k), el('dd', '', v));
        return d;
      }),
    );
    $('end-lesson').textContent = t(lesson.key, lesson.vars);
    $('end-overlay').hidden = false;
    holdBlocked = true;
    $('end-again').focus();
  }

  $('end-again').addEventListener('click', () => {
    $('end-overlay').hidden = true;
    holdBlocked = false;
    start(world, meta);
  });
  $('end-setup').addEventListener('click', () => {
    $('end-overlay').hidden = true;
    holdBlocked = false;
    stop();
    onQuit();
  });
  $('menu-restart').addEventListener('click', () => start(world, meta));
  $('menu-quit').addEventListener('click', () => {
    stop();
    onQuit();
  });

  // ---- Keyboard ------------------------------------------------------------------------

  document.addEventListener('keydown', (e) => {
    if (!running || holdBlocked || e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (state.status === 'running') togglePause();
    } else if (/^Digit[0-9]$/.test(e.code)) {
      const n = Number(e.code.slice(5));
      const i = n === 0 ? 9 : n - 1;
      if (i < cards.length) {
        select(i);
        cards[i].li.scrollIntoView({ block: 'nearest' });
      }
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (target === $('chart')) return;
      e.preventDefault();
      nudge(selected, e.key === 'ArrowUp' ? 1 : -1);
    }
  });

  // ---- Loop -----------------------------------------------------------------------------

  function frame(nowMs) {
    if (!running) return;
    const elapsed = Math.min(nowMs - lastFrameMs, cfg.time.maxFrameMs);
    lastFrameMs = nowMs;
    const { speeds, gameMinutesPerRealSecond, stepMinutes, maxStepsPerFrame } = cfg.time;
    stepCarry += ((elapsed / 1000) * gameMinutesPerRealSecond * speeds[speedIndex]) / stepMinutes;
    const steps = Math.floor(stepCarry);
    stepCarry -= steps;
    for (let i = 0; i < Math.min(steps, maxStepsPerFrame) && state.status === 'running'; i++) {
      state = step(state, world, cfg);
      chart.record(state);
    }
    if (state !== rendered || speedIndex !== renderedSpeed) {
      render();
      chart.draw(state);
    }
    requestAnimationFrame(frame);
  }

  function start(newWorld, newMeta) {
    world = newWorld;
    meta = newMeta;
    state = createState(world, cfg, (Date.now() >>> 0) || 1);
    speedIndex = cfg.time.defaultSpeedIndex;
    stepCarry = 0;
    rendered = null;
    clearTimeout(toastTimer);
    $('toast').hidden = true;
    setText($('day-label'), newMeta.label);
    chart.reset(world);
    chart.record(state);
    buildCards();
    clearLog();
    render();
    chart.draw(state, true);
    if (!running) {
      running = true;
      requestAnimationFrame((ms) => {
        lastFrameMs = ms;
        frame(ms);
      });
    }
  }

  function stop() {
    running = false;
    clearTimeout(toastTimer);
  }

  /** Pauses the game while something else (the tutorial) owns the screen. */
  function hold(on) {
    holdBlocked = on;
    if (on) setSpeed(pauseIndex);
    else setSpeed(resumeIndex);
  }

  return { start, stop, hold, redrawChart: () => state && chart.draw(state, true) };
}

