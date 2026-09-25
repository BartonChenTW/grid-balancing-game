// Step 3: the live game. Owns the game loop and renders the top bar, chart,
// side panel, unit cards, event log and end-of-day dialog.
import { createChart } from './chart.js';
import { computeScore, pickLesson } from './score.js';
import { canTechAction, techAction, techSummary } from './fleet.js';
import { createState, step } from './sim.js';
import { formatClock, formatDuration, formatEnergy, formatNumber, t, unitName } from './strings.js';
import { hasStandby } from './units.js';

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

/** operator (optional): (state, world, cfg) => state, run before every step (demo mode). */
export function createPlay({ cfg, onQuit, operator = null }) {
  const chart = createChart({
    canvas: $('chart'),
    freqCanvas: $('freq-chart'),
    miniCanvas: $('mini-chart'),
    tooltip: $('chart-tooltip'),
    legend: $('legend'),
    cfg,
  });
  $('chart').setAttribute('aria-label', t('chart.label'));

  // Show a compact chart in the sticky top bar once the full chart scrolls
  // out of view, so the player can follow demand and supply from the unit cards.
  const playBar = document.querySelector('.play-bar');
  const miniWrap = $('mini-chart-wrap');
  miniWrap.setAttribute('aria-label', t('chart.mini'));
  miniWrap.title = t('chart.mini');
  // The full chart sits right under the sticky bar at the top of the page.
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  miniWrap.addEventListener('click', () => window.scrollTo({ top: 0, behavior: reduceMotion.matches ? 'auto' : 'smooth' }));
  new IntersectionObserver(
    ([entry]) => {
      const hidden = !entry.isIntersecting && running;
      playBar.classList.toggle('show-mini', hidden);
      if (hidden && state) chart.draw(state, true);
    },
    { rootMargin: `-${Math.round(playBar.getBoundingClientRect().height || 120)}px 0px 0px 0px`, threshold: 0 },
  ).observe($('chart-wrap'));

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

  // ---- Technology cards --------------------------------------------------------

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

  function techLabel(tech) {
    const info = world.techs[tech];
    return info.name !== info.type ? unitName(info.name, info.type) : t(`unitType.${info.type}`);
  }

  function smallButton(text, label, action, hold = false) {
    const b = el('button', 'adj', text);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    if (hold) holdButton(b, action);
    else b.addEventListener('click', action);
    return b;
  }

  function countControl(kindKey, name, downAction, upAction, tech) {
    const box = el('div', 'count');
    const label = el('span', 'count-label', t(kindKey));
    const value = el('strong', 'count-value', '0');
    const minus = smallButton('−', t(`${downAction === 'onlineDown' ? 'unit.onlineMinus' : 'unit.standbyMinus'}`, { name }), () => act(tech, downAction), true);
    const plus = smallButton('+', t(`${upAction === 'onlineUp' ? 'unit.onlinePlus' : 'unit.standbyPlus'}`, { name }), () => act(tech, upAction), true);
    box.append(label, value, minus, plus);
    return { box, value, minus, plus };
  }

  function buildCards() {
    const list = $('units');
    list.replaceChildren();
    cards = world.techs.map((info, tech) => {
      const type = world.types[info.type];
      const group = groupOf[info.type] ?? 'other';
      const name = techLabel(tech);
      const multi = info.count > 1;
      const li = el('li', 'unit');
      li.setAttribute('role', 'group');
      li.setAttribute('aria-label', name);
      li.style.setProperty('--key', `var(--series-${group})`);

      const head = el('div', 'unit-head');
      head.append(el('span', 'swatch'), el('span', 'unit-name', name));
      if (tech < 10) head.append(el('span', 'unit-key', `[${(tech + 1) % 10}]`));
      const status = el('span', 'status');
      head.append(status);

      const sub = multi
        ? t('unit.fleet', { count: info.count, size: formatNumber(info.maxMW / info.count) })
        : t(`unitType.${info.type}`);
      const typeLine = el('div', 'unit-type', sub);
      const output = el('div', 'unit-output');
      const outNow = el('strong');
      const outInfo = el('span');
      output.append(outNow, outInfo);

      const bar = el('div', 'bar');
      const onlineBand = el('div', 'bar-online');
      const fill = el('div', 'bar-fill');
      const target = el('div', 'bar-target');
      bar.append(onlineBand, fill, target);

      const detail = el('div', 'unit-detail');
      const nodes = [head, typeLine, output, bar, detail];

      // Unit counts: online / standby (multi-unit thermal fleets).
      let online = null;
      let standby = null;
      if (multi) {
        const counts = el('div', 'counts');
        online = countControl('unit.status.online', name, 'onlineDown', 'onlineUp', tech);
        counts.append(online.box);
        if (hasStandby(type)) {
          standby = countControl('unit.status.standby', name, 'standbyDown', 'standbyUp', tech);
          counts.append(standby.box);
        }
        nodes.push(counts);
      }

      // Output −/+, Start/Stop for single units, Auto switch.
      const buttons = el('div', 'unit-buttons');
      const minus = smallButton('−', t('unit.decrease', { name }), () => act(tech, 'down'), true);
      const plus = smallButton('+', t('unit.increase', { name }), () => act(tech, 'up'), true);
      buttons.append(minus, plus);
      let power = null;
      if (!multi && !type.alwaysOnline) {
        power = el('button', 'power');
        power.type = 'button';
        power.addEventListener('click', () => togglePower(tech));
        buttons.append(power);
      }
      let auto = null;
      if (type.autoCapable) {
        auto = el('button', 'power auto-btn', t('unit.auto'));
        auto.type = 'button';
        auto.addEventListener('click', () => act(tech, 'toggleAuto'));
        buttons.append(auto);
      }
      buttons.style.gridTemplateColumns = `1fr 1fr${power ? ' 1.3fr' : ''}${auto ? ' 1.3fr' : ''}`;
      nodes.push(buttons);

      li.addEventListener('pointerdown', () => select(tech));
      li.append(...nodes);
      list.append(li);
      return { li, status, outNow, outInfo, onlineBand, fill, target, detail, online, standby, minus, plus, power, auto, name };
    });
    select(Math.min(selected, cards.length - 1));
  }

  function select(i) {
    selected = i;
    cards.forEach((c, k) => c.li.classList.toggle('selected', k === i));
  }

  function act(tech, action) {
    if (state.status !== 'running') return;
    state = techAction(state, world, tech, action, cfg);
  }

  function togglePower(tech) {
    const sum = techSummary(state, world, tech);
    act(tech, sum.online > 0 || sum.starting > 0 ? 'onlineDown' : 'onlineUp');
  }

  function renderCard(c, tech) {
    const type = world.types[world.techs[tech].type];
    const s = techSummary(state, world, tech);
    const multi = s.count > 1;
    const live = state.status === 'running';

    // Status badge.
    let statusKey;
    if (multi) statusKey = s.online > 0 ? 'online' : s.starting > 0 ? 'starting' : s.standby > 0 ? 'standby' : 'offline';
    else statusKey = s.online ? 'online' : s.starting ? 'starting' : s.stopping ? 'stopping' : s.standby ? 'standby' : s.warming ? 'warming' : 'offline';
    c.li.dataset.status = s.online > 0 || type.variable ? 'online' : 'offline';
    c.status.dataset.status = statusKey;
    setText(c.status, multi ? t('unit.fleetStatus', { online: s.online, count: s.count }) : t(`unit.status.${statusKey}`));

    setText(c.outNow, t('unit.output', { output: formatNumber(s.outputMW) }));
    if (multi) setText(c.outInfo, t('unit.fleetTarget', { setpoint: formatNumber(s.setpointMW), online: formatNumber(s.onlineMW) }));
    else setText(c.outInfo, t('unit.setpoint', { setpoint: formatNumber(s.setpointMW), max: formatNumber(s.maxMW) }));

    const pct = (v) => `${Math.min(100, (Math.abs(v) / s.maxMW) * 100)}%`;
    c.onlineBand.style.width = type.variable ? pct(s.availableMW) : pct(s.onlineMW);
    c.fill.style.width = pct(s.outputMW);
    c.fill.classList.toggle('charging', s.outputMW < -0.5);
    c.target.hidden = s.online === 0 || s.auto;
    c.target.style.left = pct(s.setpointMW);

    // Detail line.
    const parts = [];
    if (s.auto) parts.push(t('unit.autoOn'));
    if (s.starting > 0) parts.push(t('unit.pending', { n: s.starting, time: formatDuration(s.nextOnlineMin ?? 0) }));
    if (s.warming > 0) parts.push(t('unit.warmingUp', { n: s.warming }));
    if (s.stopping > 0) parts.push(t('unit.stoppingN', { n: s.stopping }));
    if (s.lockedOut > 0) parts.push(t('unit.lockedOut'));
    if (type.variable) parts.push(t('unit.variable', { available: formatNumber(s.availableMW), curtailed: formatNumber(s.curtailedMW) }));
    else if (type.storage) parts.push(t('unit.soc', { pct: formatNumber((s.socMWh / s.energyMWh) * 100), energy: formatEnergy(s.socMWh) }));
    else if (type.energyLimited) parts.push(t('unit.water', { pct: formatNumber((s.budgetMWh / s.energyMWh) * 100) }));
    else if (type.activationLimited) parts.push(t('unit.dsm', { time: formatDuration(s.maxActivationMin - s.activeMin) }));
    else if (multi) {
      parts.push(t('unit.offlineCount', { n: s.offline }));
      if (s.starting === 0) {
        parts.push(hasStandby(type)
          ? t('unit.startTimes', { cold: formatDuration(type.startupMin + type.syncMin), warm: formatDuration(type.syncMin) })
          : t('unit.startupTakes', { time: formatDuration(type.startupMin) }));
      }
    } else if (s.online === 0 && s.starting === 0) parts.push(t('unit.startupTakes', { time: formatDuration(type.startupMin) }));
    setText(c.detail, parts.join(' · '));

    // Buttons.
    const can = (action) => live && canTechAction(state, world, tech, action);
    c.minus.disabled = !can('down');
    c.plus.disabled = !can('up');
    if (c.online) {
      setText(c.online.value, String(s.online + s.starting));
      c.online.minus.disabled = !can('onlineDown');
      c.online.plus.disabled = !can('onlineUp');
    }
    if (c.standby) {
      setText(c.standby.value, String(s.standby + s.warming));
      c.standby.minus.disabled = !can('standbyDown');
      c.standby.plus.disabled = !can('standbyUp');
    }
    if (c.power) {
      const on = s.online > 0 || s.starting > 0;
      const label = s.online > 0 ? t('unit.stop') : s.starting > 0 ? t('unit.cancel') : t('unit.start');
      setText(c.power, label);
      c.power.disabled = !live || !(on ? can('onlineDown') : can('onlineUp'));
      c.power.setAttribute('aria-label', `${label} ${c.name}`);
    }
    if (c.auto) {
      c.auto.setAttribute('aria-pressed', String(s.auto));
      c.auto.disabled = !live;
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
    renderFuelBars();
    $('shed-stat').hidden = s.shedStage === 0;
    setText($('s-shed'), `${s.shedStage * cfg.ufls.stagePct}%`);
  }

  // ---- CO₂ intensity and fuel cost bars ------------------------------------------

  // Bar colours follow the chart (coal, gas, nuclear); oil takes the "other" red
  // of the chart, and hydro/DSM costs are a neutral grey.
  const FUEL_COLOR = { nuclear: '--series-nuclear', coal: '--series-coal', gas: '--series-gas', oil: '--series-other', other: '--muted' };
  const fuelSegments = {};
  for (const [barId, kind] of [['co2-bar', 'co2'], ['cost-bar', 'cost']]) {
    fuelSegments[kind] = {};
    for (const f of cfg.fuels) {
      const seg = el('span', 'hbar-seg');
      seg.style.background = `var(${FUEL_COLOR[f]})`;
      $(barId).append(seg);
      fuelSegments[kind][f] = seg;
    }
  }
  $('co2-max').textContent = `${formatNumber(cfg.ui.co2BarMaxGPerKWh)} g/kWh`;
  $('cost-max').textContent = `NT$ ${formatNumber(cfg.ui.costBarMaxNTDPerKWh)}/kWh`;
  // One row per source in this fleet: its own fuel cost per kWh right now and
  // its share of generation. Solar, wind and storage burn no fuel (NT$ 0).
  // The rows double as the colour legend for both bars.
  let fuelRows = [];

  function buildFuelRows() {
    const fleetTypes = [...new Set(world.units.map((u) => u.type))].map((type) => world.types[type]);
    const rows = [];
    for (const f of cfg.fuels) {
      const typesOfFuel = fleetTypes.filter((type) => type.fuel === f);
      if (typesOfFuel.length === 0) continue;
      // Listed cost of the cheapest type, shown while this fuel is idle.
      const nominal = Math.min(...typesOfFuel.map((type) => type.costPerMWh)) / 1000;
      rows.push({ id: f, label: t(`fuel.${f}`), color: `var(${FUEL_COLOR[f]})`, nominal });
    }
    if (fleetTypes.some((type) => type.variable)) {
      rows.push({ id: 'renewable', label: t('fuel.renewable'), color: 'linear-gradient(90deg, var(--series-solar) 50%, var(--series-wind) 50%)', free: true });
    }
    if (fleetTypes.some((type) => type.storage)) {
      rows.push({ id: 'storage', label: t('fuel.storage'), color: 'var(--series-storage)', free: true });
    }
    fuelRows = rows.map((row) => {
      const li = el('li');
      const key = el('span', 'swatch');
      key.style.background = row.color;
      const value = el('span', 'fuel-cost');
      const share = el('span', 'fuel-share');
      li.append(key, el('span', 'fuel-name', row.label), value, share);
      return { ...row, li, value, share };
    });
    $('fuel-legend').replaceChildren(...fuelRows.map((r) => r.li));
  }

  function renderFuelRows() {
    const s = state;
    const total = s.generationMW;
    let storageMW = 0;
    for (const u of s.units) if (world.types[u.type].storage && u.outputMW > 0) storageMW += u.outputMW;
    for (const row of fuelRows) {
      let mw;
      let perKWh;
      if (row.id === 'renewable') {
        mw = s.renewableMW;
        perKWh = 0;
      } else if (row.id === 'storage') {
        mw = storageMW;
        perKWh = 0;
      } else {
        mw = s.fuel.gen[row.id];
        perKWh = mw > 0.5 ? s.fuel.cost[row.id] / mw / 1000 : row.nominal;
      }
      const idle = mw <= 0.5;
      row.li.classList.toggle('idle', idle && !row.free);
      setText(row.value, t(row.free ? 'fuel.free' : 'fuel.costPerKWh', { v: formatNumber(perKWh, 2) }));
      setText(row.share, total > 0 && !idle ? `${formatNumber((100 * mw) / total)}%` : '–');
    }
  }

  function renderFuelBars() {
    const s = state;
    const gen = s.generationMW;
    // Each fuel's share of the current intensity / cost per kWh generated.
    const describe = [];
    for (const [kind, max, perKWh] of [
      ['co2', cfg.ui.co2BarMaxGPerKWh, (f) => (gen > 0 ? (s.fuel.co2[f] / gen) * 1000 : 0)],
      ['cost', cfg.ui.costBarMaxNTDPerKWh, (f) => (gen > 0 ? s.fuel.cost[f] / gen / 1000 : 0)],
    ]) {
      const parts = [];
      for (const f of cfg.fuels) {
        const v = perKWh(f);
        fuelSegments[kind][f].style.width = `${Math.min(100, (v / max) * 100)}%`;
        if (v > 0.005) parts.push(`${t(`fuel.${f}`)} ${formatNumber(v, kind === 'co2' ? 0 : 2)}`);
      }
      describe.push(parts.join(', '));
    }
    renderFuelRows();
    setText($('co2-value'), t('meter.co2Value', { v: formatNumber(s.co2IntensityKgPerKWh * 1000) }));
    setText($('cost-value'), t('meter.costValue', { v: formatNumber(s.costNTDPerKWh, 2) }));
    $('co2-bar').setAttribute('aria-label', `${t('meter.co2')}: ${describe[0] || '0'} g/kWh`);
    $('cost-bar').setAttribute('aria-label', `${t('meter.cost')}: ${describe[1] || '0'} NT$/kWh`);

    const st = s.stats;
    const avgCo2 = st.generationMWh > 0 ? st.co2Tonnes / st.generationMWh : s.co2IntensityKgPerKWh;
    setText($('co2-foot'), t('meter.co2Foot', { avg: formatNumber(avgCo2 * 1000), kt: formatNumber(st.co2Tonnes / 1000, 1) }));
    const gasOil = (st.costByFuel?.gas ?? 0) + (st.costByFuel?.oil ?? 0);
    setText($('cost-foot'), t('meter.costFoot', {
      rate: formatNumber(s.fuel.costTotal / 1e6, 1),
      total: formatNumber(st.costNTD / 1e6),
      gasOil: formatNumber(gasOil / 1e6),
    }));
  }

  function describeEvent(e) {
    switch (e.type) {
      case 'trip':
        return [t('event.trip', { n: e.units, tech: techLabel(e.tech), mw: formatNumber(e.lostMW) }), e.note ? t(`note.${e.note}`) : ''];
      case 'clouds':
        return [t('event.clouds'), ''];
      case 'windCutout':
        return [t('event.windCutout'), ''];
      case 'windLull':
        return [t('event.windLull'), ''];
      case 'demandSurge':
        return [t('event.demandSurge'), ''];
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
    updateLogToggle();
  }

  function clearLog() {
    logCount = 0;
    logExpanded = false;
    $('log').replaceChildren(el('li', 'empty', t('events.empty')));
    updateLogToggle();
  }

  // Only the newest few messages show until the player expands the log,
  // so a busy day does not push the power-station cards far down.
  let logExpanded = false;
  $('log-toggle').addEventListener('click', () => {
    logExpanded = !logExpanded;
    updateLogToggle();
  });

  function updateLogToggle() {
    const button = $('log-toggle');
    const hiddenCount = logCount - cfg.ui.logCollapsedCount;
    [...$('log').children].forEach((li, i) => {
      li.hidden = !logExpanded && i >= cfg.ui.logCollapsedCount;
    });
    button.hidden = hiddenCount <= 0;
    button.setAttribute('aria-expanded', String(logExpanded));
    setText(button, logExpanded ? t('events.less') : t('events.more', { n: logCount }));
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
    $('freq-block').dataset.shed = String(s.shedStage > 0 && s.band !== 'blackout');
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
    cards.forEach((c, tech) => renderCard(c, tech));
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
    $('end-points').textContent = t('end.score', { points: formatNumber(score.points), max: formatNumber(cfg.score.maxPoints) });

    // The three KPIs that make up the score.
    const k = score.kpis;
    const kpiRows = [
      ['reliability', t('kpi.reliability'), `${formatNumber(k.reliability.value, 1)}%`,
        score.shedStages > 0 ? t('kpi.reliabilityShed', { n: score.shedStages }) : t('kpi.reliabilityHint')],
      ['cost', t('kpi.cost'), t('fuel.costPerKWh', { v: formatNumber(k.cost.value, 2) }), t('kpi.costHint', { total: formatNumber(score.costNTD / 1e6) })],
      ['carbon', t('kpi.carbon'), `${formatNumber(k.carbon.value)} g/kWh`, t('kpi.carbonHint', { kt: formatNumber(score.co2Tonnes / 1000, 1) })],
    ];
    $('end-kpis').replaceChildren(
      ...kpiRows.map(([id, label, value, hint]) => {
        const li = el('li', 'kpi');
        const head = el('div', 'kpi-head');
        head.append(el('span', 'kpi-label', label), el('strong', 'kpi-value', value));
        const bar = el('div', 'kpi-bar');
        const fill = el('span');
        fill.style.width = `${k[id].score}%`;
        bar.append(fill);
        const foot = el('div', 'kpi-foot');
        foot.append(
          el('span', '', hint),
          el('span', 'kpi-score', t('kpi.score', { score: formatNumber(k[id].score), weight: formatNumber(k[id].weight * 100) })),
        );
        li.append(head, bar, foot);
        return li;
      }),
    );

    const rows = [
      [t('end.shed'), formatNumber(score.shedStages)],
      [t('end.unserved'), formatEnergy(score.unservedMWh)],
      [t('end.gasOil'), `NT$ ${formatNumber(score.gasOilCostNTD / 1e6)} M`],
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
      act(selected, e.key === 'ArrowUp' ? 'up' : 'down');
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
      if (operator) state = operator(state, world, cfg);
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
    buildFuelRows();
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

