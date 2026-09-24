// UI wiring, game loop and rendering. All game rules live in sim.js.
import { config } from './config.js';
import { createState, setSetpoint, step } from './sim.js';
import { MINI_SCENARIO } from './scenarios.js';
import { t } from './strings.js';

const scenario = MINI_SCENARIO;
const $ = (id) => document.getElementById(id);
const numberFormat = new Intl.NumberFormat('en');
const mw = (value) => numberFormat.format(Math.round(value) || 0); // `|| 0` avoids "-0"

let state;
let speedIndex;
let pausedFromIndex = config.time.defaultSpeedIndex;
let stepCarry = 0;
let lastFrameMs = 0;
let renderedState = null;
let renderedSpeedIndex = -1;

// ---- Static text --------------------------------------------------------

for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);

// ---- Speed controls -----------------------------------------------------

const speedButtons = config.time.speeds.map((speed, index) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = speed === 0 ? t('speed.pause') : t('speed.x', { n: speed });
  button.addEventListener('click', () => setSpeed(index));
  $('speeds').append(button);
  return button;
});

function setSpeed(index) {
  if (config.time.speeds[index] === 0 && config.time.speeds[speedIndex] !== 0) pausedFromIndex = speedIndex;
  speedIndex = index;
}

function togglePause() {
  const pauseIndex = config.time.speeds.indexOf(0);
  setSpeed(speedIndex === pauseIndex ? pausedFromIndex : pauseIndex);
}

// ---- Unit rows ----------------------------------------------------------

const unitViews = scenario.units.map((spec, index) => {
  const li = document.createElement('li');
  li.className = 'unit';
  li.innerHTML = `
    <div><span class="unit-name"></span><span class="unit-type"></span></div>
    <div class="unit-buttons">
      <button type="button" data-dir="-1">−</button>
      <button type="button" data-dir="1">+</button>
    </div>
    <div class="unit-numbers"></div>
    <div class="bar"><div class="bar-fill"></div><div class="bar-setpoint"></div></div>`;
  li.querySelector('.unit-name').textContent = spec.name;
  li.querySelector('.unit-type').textContent = t(`unitType.${spec.type}`);
  for (const button of li.querySelectorAll('button')) {
    const dir = Number(button.dataset.dir);
    button.setAttribute('aria-label', t(dir < 0 ? 'unit.decrease' : 'unit.increase', { name: spec.name }));
    button.addEventListener('click', () => nudge(index, dir));
  }
  $('units').append(li);
  return {
    numbers: li.querySelector('.unit-numbers'),
    fill: li.querySelector('.bar-fill'),
    setpoint: li.querySelector('.bar-setpoint'),
  };
});

function nudge(index, dir) {
  const unit = state.units[index];
  const stepMW = (config.ui.setpointStepPct / 100) * unit.maxMW;
  state = setSetpoint(state, index, unit.setpointMW + dir * stepMW);
}

// ---- Keyboard -----------------------------------------------------------

document.addEventListener('keydown', (event) => {
  if (event.code === 'Space') {
    event.preventDefault();
    if (state.status === 'running') togglePause();
  }
});

// ---- Game loop ----------------------------------------------------------

function reset() {
  state = createState(scenario, config, Date.now() >>> 0);
  speedIndex = config.time.defaultSpeedIndex;
  stepCarry = 0;
  $('overlay').hidden = true;
}

$('restart').addEventListener('click', reset);

function frame(nowMs) {
  const elapsedMs = Math.min(nowMs - lastFrameMs, config.time.maxFrameMs);
  lastFrameMs = nowMs;

  const { speeds, gameMinutesPerRealSecond, stepMinutes, maxStepsPerFrame } = config.time;
  stepCarry += (elapsedMs / 1000) * gameMinutesPerRealSecond * speeds[speedIndex] / stepMinutes;
  const steps = Math.floor(stepCarry);
  stepCarry -= steps;
  for (let i = 0; i < Math.min(steps, maxStepsPerFrame) && state.status === 'running'; i++) {
    state = step(state, scenario, config);
  }

  // Only touch the DOM when something changed.
  if (state !== renderedState || speedIndex !== renderedSpeedIndex) render();
  requestAnimationFrame(frame);
}

// ---- Rendering ----------------------------------------------------------

function formatClock(minute) {
  const h = Math.floor(minute / 60);
  const m = Math.floor(minute % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function render() {
  renderedState = state;
  renderedSpeedIndex = speedIndex;

  $('clock').textContent = formatClock(state.minute);
  speedButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === speedIndex)));

  $('freq').dataset.band = state.band;
  $('freq-value').textContent = state.frequencyHz.toFixed(2);
  $('freq-band').textContent = t(`band.${state.band}`);

  $('demand').textContent = `${mw(state.loadMW)} MW`;
  $('supply').textContent = `${mw(state.generationMW)} MW`;
  const imbalance = Math.round(state.imbalanceMW) || 0;
  const direction = imbalance >= 0 ? t('imbalance.surplus') : t('imbalance.shortfall');
  $('imbalance').textContent = `${imbalance > 0 ? '+' : ''}${mw(imbalance)} MW ${imbalance === 0 ? '' : direction}`;
  $('inertia').textContent = `${state.inertia.hSys.toFixed(1)} s`;

  state.units.forEach((unit, i) => {
    const view = unitViews[i];
    let text = t('unit.output', { output: mw(unit.outputMW), max: mw(unit.maxMW), setpoint: mw(unit.setpointMW) });
    if (unit.energyMWh) text += ` · ${t('unit.soc', { soc: Math.round((unit.socMWh / unit.energyMWh) * 100) })}`;
    view.numbers.textContent = text;
    view.fill.style.width = `${(Math.abs(unit.outputMW) / unit.maxMW) * 100}%`;
    view.fill.classList.toggle('charging', unit.outputMW < 0);
    view.setpoint.style.left = `${(Math.abs(unit.setpointMW) / unit.maxMW) * 100}%`;
  });

  if (state.status !== 'running' && $('overlay').hidden) {
    $('overlay-text').textContent = t(state.status === 'blackout' ? 'end.blackout' : 'end.finished');
    $('overlay').hidden = false;
    $('restart').focus();
  }
}

reset();
requestAnimationFrame((nowMs) => {
  lastFrameMs = nowMs;
  frame(nowMs);
});
