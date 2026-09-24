// Pure simulation: state in → state out. No DOM, no globals, no Math.random,
// so the same code runs in the browser and in `node --test`.
//
// A `world` holds everything fixed for one game (built by scenarios.js):
//   { types, units, techs, peakLoadMW, profiles: { load, solar, wind },
//     events, randomAccidents, assist, forecastErrorPct }
// Each unit is one generating unit; units of one technology share a `tech`
// index (see fleet.js for technology-level commands).
// A `state` holds everything that changes minute to minute.
//
// Simplifications, for educators:
// - "Copper plate" grid: one node, no transmission limits, losses or voltage.
// - Frequency comes from a single-mass swing equation with time compressed
//   from seconds to game minutes, so inertia effects are visible at game speed
//   (see stepFrequency).
// - The optional assist is a proportional governor on online dispatchable
//   units. Its response is counted in the balance but not in unit outputs.
// - Load shedding removes whole 5% blocks of demand, like real UFLS relays.
// - Automatic storage, demand-response and peaker control (auto.js) reacts to
//   the previous minute's imbalance and frequency.

import { autoDispatch } from './auto.js';
import { config as defaultConfig } from './config.js';
import {
  canAdjust,
  clamp,
  createUnit,
  isSynchronised,
  setpointRange,
  setUnitSetpoint,
  startUnit,
  stopUnit,
  tripUnit,
  updateUnit,
} from './units.js';

// ---- Helpers -------------------------------------------------------------

/** Linear interpolation of an evenly spaced daily profile; wraps at midnight. */
export function profileAt(profile, minute, dayMinutes) {
  const n = profile.length;
  if (n === 1) return profile[0];
  const pos = ((((minute / dayMinutes) * n) % n) + n) % n;
  const i = Math.floor(pos);
  return profile[i] + (profile[(i + 1) % n] - profile[i]) * (pos - i);
}

/** mulberry32 seeded PRNG. Returns [value in [0, 1), next seed]. */
export function nextRandom(seed) {
  const a = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}

/** AR(1) step with long-run standard deviation `std`. The uniform shock is scaled by √3 for unit variance. */
function ar1(previous, r, persistence, std) {
  const shock = (r * 2 - 1) * Math.sqrt(3);
  return persistence * previous + Math.sqrt(1 - persistence * persistence) * std * shock;
}

/** 'normal' | 'warning' | 'critical' | 'blackout' */
export function frequencyBand(frequencyHz, cfg = defaultConfig) {
  const b = cfg.bands;
  if (frequencyHz < b.blackoutLowHz || frequencyHz > b.blackoutHighHz) return 'blackout';
  if (frequencyHz < b.warningLowHz || frequencyHz > b.warningHighHz) return 'critical';
  if (frequencyHz < b.normalLowHz || frequencyHz > b.normalHighHz) return 'warning';
  return 'normal';
}

/** Demand the operator is shown ahead of time (no noise, no forecast error). */
export function forecastLoad(world, minute, cfg = defaultConfig) {
  return world.peakLoadMW * profileAt(world.profiles.load, minute, cfg.time.dayMinutes);
}

const capacityCache = new WeakMap();

/** Total renewable capacity of a kind ('solar' | 'wind') in the fleet (cached per unit list). */
export function variableCapacity(world, kind) {
  let byKind = capacityCache.get(world.units);
  if (!byKind) {
    byKind = {};
    for (const u of world.units) {
      const v = world.types[u.type].variable;
      if (v) byKind[v] = (byKind[v] ?? 0) + u.maxMW;
    }
    capacityCache.set(world.units, byKind);
  }
  return byKind[kind] ?? 0;
}

/**
 * Forecast renewable output of a kind, from its capacity-factor profile.
 * With a state, active and already-announced events (typhoon warnings) are
 * included, so the forecast shows what operators have been told.
 */
export function forecastVariable(world, kind, minute, cfg = defaultConfig, state = null) {
  const profile = world.profiles[kind];
  if (!profile) return 0;
  const cf = profileAt(profile, minute, cfg.time.dayMinutes);
  const factor = state ? effectFactor(knownEffects(state, cfg), kind, minute) : 1;
  return variableCapacity(world, kind) * cf * factor;
}

const EFFECT_KIND = { clouds: 'solar', windCutout: 'wind', windLull: 'wind', demandSurge: 'load' };

function effectOf(event, cfg) {
  return {
    kind: EFFECT_KIND[event.type],
    factor: event.factor ?? 0,
    start: event.timeMin,
    until: event.timeMin + (event.durationMin ?? 60),
    rampMin: event.rampMin ?? cfg.events.defaultRampMin,
  };
}

/** Effects that are active now or have been announced for later. */
function knownEffects(state, cfg) {
  const upcoming = state.events
    .slice(state.nextEvent)
    .filter((e) => EFFECT_KIND[e.type] && e.warnMin && e.timeMin - e.warnMin <= state.minute)
    .map((e) => effectOf(e, cfg));
  return upcoming.length ? [...state.effects, ...upcoming] : state.effects;
}

/** Multiplier from active events (clouds, typhoon cut-out, demand surge) that fade in and out. */
function effectFactor(effects, kind, minute) {
  let factor = 1;
  for (const e of effects) {
    if (e.kind !== kind || minute < e.start) continue;
    const fadeIn = clamp((minute - e.start) / e.rampMin, 0, 1);
    const fadeOut = clamp((e.until - minute) / e.rampMin, 0, 1);
    factor *= 1 - (1 - e.factor) * Math.min(fadeIn, fadeOut);
  }
  return factor;
}

function capacityFactor(state, world, kind, minute, cfg) {
  const profile = world.profiles[kind];
  if (!profile) return 0;
  let cf = profileAt(profile, minute, cfg.time.dayMinutes);
  if (kind === 'wind') cf += state.windNoise;
  return clamp(cf, 0, 1) * effectFactor(state.effects, kind, minute);
}

// ---- Derived quantities ----------------------------------------------------

/**
 * System inertia.
 * kineticMWs = Σ H_i · S_i over synchronised machines (MW·s). Inverter-based
 * units (solar, wind, batteries) have H = 0.
 * hSys = kineticMWs / demand: seconds of demand stored as spinning energy.
 * Replacing spinning machines with inverters lowers it.
 */
export function systemInertia(units, types, demandMW) {
  let kineticMWs = 0;
  for (const unit of units) {
    if (isSynchronised(unit)) kineticMWs += types[unit.type].inertiaH * unit.maxMW;
  }
  return { kineticMWs, hSys: demandMW > 0 ? kineticMWs / demandMW : 0 };
}

/** Headroom of online dispatchable units: how much they could still raise or lower output. */
export function reserves(units, types) {
  let upMW = 0;
  let downMW = 0;
  let ratingMW = 0;
  const fast = { upMW: 0, downMW: 0, ratingMW: 0 };
  for (const unit of units) {
    const type = types[unit.type];
    if (!canAdjust(unit) || type.variable || type.activationLimited) continue;
    const [lo, hi] = setpointRange(unit, type);
    let up = hi - unit.outputMW;
    let down = unit.outputMW - lo;
    if (type.storage && unit.socMWh <= 0) up = Math.min(up, -unit.outputMW);
    if (type.energyLimited && unit.budgetMWh <= 0) up = 0;
    upMW += Math.max(0, up);
    downMW += Math.max(0, down);
    ratingMW += unit.maxMW;
    if (type.fastResponse) {
      fast.upMW += Math.max(0, up);
      fast.downMW += Math.max(0, down);
      fast.ratingMW += unit.maxMW;
    }
  }
  return { upMW, downMW, ratingMW, fast };
}

function derive(state, world, cfg) {
  let generationMW = 0;
  let chargingMW = 0;
  let renewableMW = 0;
  let curtailedMW = 0;
  for (const unit of state.units) {
    if (unit.outputMW >= 0) generationMW += unit.outputMW;
    else chargingMW -= unit.outputMW;
    if (world.types[unit.type].variable) {
      renewableMW += unit.outputMW;
      curtailedMW += unit.curtailedMW;
    }
  }
  const servedLoadMW = state.demandMW * (1 - state.shedStage * (cfg.ufls.stagePct / 100));
  return {
    ...state,
    servedLoadMW,
    generationMW,
    chargingMW,
    renewableMW,
    curtailedMW,
    imbalanceMW: generationMW - chargingMW + state.governorMW - servedLoadMW,
    inertia: systemInertia(state.units, world.types, servedLoadMW),
    reserve: reserves(state.units, world.types),
  };
}

// ---- Frequency -------------------------------------------------------------

/**
 * Swing equation for one lumped machine:
 *   df/dt = swingGain · f0 / (2 · Ek) · (imbalance + governor) − D · (f − f0)
 * Ek = Σ H·S is the stored kinetic energy. A real grid settles within
 * seconds; here t is in game minutes and swingGain and D are tuned so the
 * player can watch it happen. Less inertia → the same imbalance moves
 * frequency faster and further.
 *
 * Automatic response: each responding group adds −(Δf / f0) / droop · S,
 * limited to its headroom. Groups are the assist governor (all online
 * dispatchable units) or, without assist, fast-response units (batteries).
 *
 * Under-frequency relays act inside the step: when f crosses the next stage
 * threshold, that stage's share of demand is disconnected at once.
 * Returns the end-of-step frequency, its extremes and the new shed stage.
 */
function stepFrequency(frequencyHz, imbalanceMW, kineticMWs, groups, cfg, ufls) {
  const { nominalHz, swingGain, dampingPerMin, substeps, minKineticMWs } = cfg.frequency;
  const gain = (swingGain * nominalHz) / (2 * Math.max(kineticMWs, minKineticMWs));
  const perHz = groups.map((g) => g.ratingMW / (nominalHz * g.droop));

  // Use enough sub-steps to keep explicit Euler stable on low-inertia grids.
  const stiffness = dampingPerMin + gain * perHz.reduce((a, b) => a + b, 0);
  const n = Math.max(substeps, Math.ceil((stiffness * cfg.time.stepMinutes) / 0.2));
  const dt = cfg.time.stepMinutes / n;

  let f = frequencyHz;
  let minHz = f;
  let maxHz = f;
  let governorMW = 0;
  let imbalance = imbalanceMW;
  let shedStage = ufls.stage;
  for (let i = 0; i < n; i++) {
    while (shedStage < ufls.thresholdsHz.length && f < ufls.thresholdsHz[shedStage]) {
      shedStage++;
      imbalance += ufls.demandMW * (ufls.stagePct / 100);
    }
    governorMW = 0;
    groups.forEach((g, k) => {
      governorMW += clamp(-(f - nominalHz) * perHz[k], -g.downMW, g.upMW);
    });
    f += dt * (gain * (imbalance + governorMW) - dampingPerMin * (f - nominalHz));
    minHz = Math.min(minHz, f);
    maxHz = Math.max(maxHz, f);
  }
  return { frequencyHz: f, minHz, maxHz, governorMW, shedStage };
}

/** Which units respond automatically to frequency this step. */
function responders(reserve, assist, cfg) {
  if (assist) {
    // Fast units respond with their own (stiffer) droop; the rest with the assist droop.
    const slow = {
      ratingMW: reserve.ratingMW - reserve.fast.ratingMW,
      upMW: reserve.upMW - reserve.fast.upMW,
      downMW: reserve.downMW - reserve.fast.downMW,
      droop: cfg.assist.droop,
    };
    return [slow, { ...reserve.fast, droop: cfg.fastResponse.droop }].filter((g) => g.ratingMW > 0);
  }
  return reserve.fast.ratingMW > 0 ? [{ ...reserve.fast, droop: cfg.fastResponse.droop }] : [];
}

// ---- Initial state -----------------------------------------------------------

/**
 * Sets a balanced starting dispatch: renewables at their available output,
 * must-run and energy-limited units at initialPct (or minimum), storage idle,
 * and the remaining demand shared by online thermal units across their range.
 * If even their minimum is too much, renewables are curtailed.
 */
function initialDispatch(units, world, demandMW, cfg, state) {
  const specs = world.units;
  const out = units.map((unit, i) => {
    const type = world.types[unit.type];
    if (type.variable) {
      const availableMW = unit.maxMW * capacityFactor(state, world, type.variable, 0, cfg);
      return { ...unit, availableMW, outputMW: availableMW, curtailedMW: 0 };
    }
    if (unit.status !== 'online' || type.storage || type.activationLimited) return unit;
    if (type.mustRun || type.energyLimited) {
      const [lo, hi] = setpointRange(unit, type);
      const mw = clamp(((specs[i].initialPct ?? (type.mustRun ? 100 : 0)) / 100) * unit.maxMW, lo, hi);
      return { ...unit, outputMW: mw, setpointMW: mw };
    }
    return unit;
  });

  const flexible = out
    .map((unit, i) => ({ unit, i, type: world.types[unit.type] }))
    .filter(({ unit, type }) => unit.status === 'online' && type.dispatchable && !type.storage &&
      !type.activationLimited && !type.energyLimited && !type.mustRun);
  const fixedMW = out.reduce((sum, u) => sum + u.outputMW, 0);
  let lo = 0;
  let hi = 0;
  for (const f of flexible) {
    const [a, b] = setpointRange(f.unit, f.type);
    lo += a;
    hi += b;
  }
  const residual = demandMW - fixedMW;
  const share = hi > lo ? clamp((residual - lo) / (hi - lo), 0, 1) : 0;
  for (const f of flexible) {
    const [a, b] = setpointRange(f.unit, f.type);
    const mw = a + share * (b - a);
    out[f.i] = { ...f.unit, outputMW: mw, setpointMW: mw };
  }

  let surplus = lo - residual;
  if (surplus > 0) {
    for (let i = 0; i < out.length && surplus > 0; i++) {
      const u = out[i];
      if (!world.types[u.type].variable) continue;
      const cut = Math.min(surplus, u.outputMW);
      surplus -= cut;
      out[i] = { ...u, outputMW: u.outputMW - cut, setpointMW: u.outputMW - cut, curtailedMW: cut };
    }
  }
  return out;
}

/** Draws the day's random accidents: when, and what kind. */
export function randomAccidents(world, cfg, rand) {
  const r = cfg.events.random;
  const kinds = Object.entries(r.weights).filter(([kind]) => {
    if (kind === 'clouds') return variableCapacity(world, 'solar') > 0;
    if (kind === 'windLull') return variableCapacity(world, 'wind') > 0;
    return true;
  });
  const totalWeight = kinds.reduce((sum, [, w]) => sum + w, 0);
  const times = [];
  const events = [];
  for (let i = 0; i < r.count; i++) {
    let time = null;
    for (let attempt = 0; attempt < 30 && time === null; attempt++) {
      const t = Math.round(r.windowMin[0] + rand() * (r.windowMin[1] - r.windowMin[0]));
      if (times.every((other) => Math.abs(other - t) >= r.minGapMin)) time = t;
    }
    if (time === null) continue;
    times.push(time);
    let pick = rand() * totalWeight;
    const [kind] = kinds.find(([, w]) => (pick -= w) < 0) ?? kinds[0];
    const base = { timeMin: time, type: kind, random: true };
    if (kind === 'trip') {
      const [lo, hi] = r.tripUnits;
      events.push({ ...base, unitType: 'random', units: lo + Math.floor(rand() * (hi - lo + 1)) });
    } else {
      events.push({ ...base, ...r[kind] });
    }
  }
  return events;
}

function buildEvents(world, cfg, rand) {
  const events = world.events.map((e) => ({ ...e }));
  if (world.randomAccidents) events.push(...randomAccidents(world, cfg, rand));
  // Announced events (e.g. typhoon warnings) get a warning entry ahead of time.
  for (const e of [...events]) {
    if (e.warnMin) events.push({ timeMin: Math.max(1, e.timeMin - e.warnMin), type: 'warning', about: e.type, atMin: e.timeMin });
  }
  return events.sort((a, b) => a.timeMin - b.timeMin);
}

const EMPTY_STATS = {
  minutesNormal: 0,
  minutesWarning: 0,
  minutesCritical: 0,
  shedStages: 0,
  unservedMWh: 0,
  servedMWh: 0,
  generationMWh: 0,
  costNTD: 0,
  co2Tonnes: 0,
  curtailedMWh: 0,
  renewableMWh: 0,
  lowMinutes: 0, // below the normal band
  highMinutes: 0, // above the normal band
  worstDeviationHz: 0,
  worstDeviationMinute: 0,
};

export function createState(world, cfg = defaultConfig, seed = 1) {
  let s = seed;
  const rand = () => {
    const [r, next] = nextRandom(s);
    s = next;
    return r;
  };
  const events = buildEvents(world, cfg, rand);
  const forecastPhase = rand() * 2 * Math.PI;

  const base = {
    minute: 0,
    seed: s,
    loadNoise: 0,
    windNoise: 0,
    forecastPhase,
    effects: [],
    events,
    nextEvent: 0,
    eventLog: [],
    frequencyHz: cfg.frequency.nominalHz,
    band: 'normal',
    status: 'running', // 'running' | 'blackout' | 'finished'
    blackoutCause: null,
    governorMW: 0,
    shedStage: 0,
    restoreTimer: 0,
    stats: { ...EMPTY_STATS },
  };
  const demandMW = actualLoad(base, world, 0, cfg);
  const created = world.units.map((spec, i) => ({ ...createUnit(spec, world.types[spec.type]), tech: spec.tech ?? i }));
  const units = initialDispatch(created, world, demandMW, cfg, base);
  return derive({ ...base, units, demandMW, forecastMW: forecastLoad(world, 0, cfg) }, world, cfg);
}

/** Forecast × noise × (Hard only) a slow forecast error × demand surges. */
function actualLoad(state, world, minute, cfg) {
  const error = (world.forecastErrorPct / 100) *
    Math.sin((4 * Math.PI * minute) / cfg.time.dayMinutes + state.forecastPhase);
  const surge = effectFactor(state.effects, 'load', minute);
  return forecastLoad(world, minute, cfg) * (1 + state.loadNoise) * (1 + error) * surge;
}

// ---- Events ------------------------------------------------------------------

/** Types a random trip can hit: spinning thermal units. */
function isTrippable(type) {
  return type.dispatchable && !type.storage && !type.activationLimited && !type.energyLimited && type.inertiaH > 0;
}

function applyEvent(state, world, event, cfg) {
  const minute = state.minute;
  const log = { minute, type: event.type, note: event.note ?? null };
  switch (event.type) {
    case 'trip': {
      // Trip online units of one technology: `units` of them, or until `lossMW` is lost.
      let s = state;
      let unitType = event.unitType;
      if (!unitType || unitType === 'random') {
        const online = [...new Set(state.units
          .filter((u) => u.status === 'online' && isTrippable(world.types[u.type]))
          .map((u) => u.type))];
        if (online.length === 0) return state;
        const [r, seed] = nextRandom(state.seed);
        unitType = online[Math.floor(r * online.length)];
        s = { ...s, seed };
      }
      const candidates = s.units
        .map((u, i) => i)
        .filter((i) => s.units[i].type === unitType && s.units[i].status === 'online')
        .sort((a, b) => s.units[b].outputMW - s.units[a].outputMW);
      const maxUnits = event.units ?? (event.lossMW ? Infinity : 1);
      const units = s.units.slice();
      let lostMW = 0;
      let count = 0;
      for (const i of candidates) {
        if (count >= maxUnits || (event.lossMW && lostMW >= event.lossMW)) break;
        lostMW += units[i].outputMW;
        units[i] = tripUnit(units[i]);
        count++;
      }
      if (count === 0) return s;
      const tech = units[candidates[0]].tech;
      return { ...s, units, eventLog: [...s.eventLog, { ...log, unitType, tech, units: count, lostMW }] };
    }
    case 'clouds':
    case 'windCutout':
    case 'windLull':
    case 'demandSurge': {
      const effect = { ...effectOf(event, cfg), start: minute, until: minute + (event.durationMin ?? 60) };
      return { ...state, effects: [...state.effects, effect], eventLog: [...state.eventLog, log] };
    }
    case 'warning':
      return { ...state, eventLog: [...state.eventLog, { ...log, about: event.about, atMin: event.atMin }] };
    default:
      return { ...state, eventLog: [...state.eventLog, log] };
  }
}

// ---- Step --------------------------------------------------------------------

/** Advances the simulation by one step (cfg.time.stepMinutes). */
export function step(state, world, cfg = defaultConfig) {
  if (state.status !== 'running') return state;
  const stepMin = cfg.time.stepMinutes;
  const hours = stepMin / 60;
  const minute = state.minute + stepMin;

  // Random walks for load and wind.
  const [r1, s1] = nextRandom(state.seed);
  const [r2, seed] = nextRandom(s1);
  let s = {
    ...state,
    minute,
    seed,
    loadNoise: ar1(state.loadNoise, r1, cfg.load.noisePersistence, cfg.load.noiseStdPct / 100),
    windNoise: ar1(state.windNoise, r2, cfg.wind.noisePersistence, cfg.wind.noiseStd),
    effects: state.effects.filter((e) => e.until > minute),
  };

  // Scheduled events.
  let nextEvent = s.nextEvent;
  while (nextEvent < s.events.length && s.events[nextEvent].timeMin <= minute) {
    s = applyEvent(s, world, s.events[nextEvent], cfg);
    nextEvent++;
  }
  s.nextEvent = nextEvent;

  // Automatic storage, demand response and peaker backup, based on the last minute.
  if (s.units.some((u) => u.auto)) {
    let autoOutMW = 0;
    for (const u of s.units) if (u.auto) autoOutMW += u.outputMW;
    const rawImbalance = state.imbalanceMW - state.governorMW;
    const trend = forecastLoad(world, minute, cfg) - forecastLoad(world, state.minute, cfg);
    const needMW = autoOutMW - rawImbalance + trend +
      (cfg.frequency.nominalHz - state.frequencyHz) * cfg.auto.freqGainPerHz * state.servedLoadMW;
    s = { ...s, units: autoDispatch(s.units, world.types, needMW, cfg) };
  }

  // Units.
  const units = s.units.map((unit) => {
    const type = world.types[unit.type];
    const availableMW = type.variable ? unit.maxMW * capacityFactor(s, world, type.variable, minute, cfg) : 0;
    return updateUnit(unit, type, { stepMinutes: stepMin, availableMW });
  });

  const demandMW = actualLoad(s, world, minute, cfg);
  s = derive({ ...s, units, demandMW, forecastMW: forecastLoad(world, minute, cfg), governorMW: 0 }, world, cfg);

  // Frequency.
  const u = cfg.ufls;
  const groups = responders(s.reserve, world.assist, cfg);
  const freq = stepFrequency(state.frequencyHz, s.imbalanceMW, s.inertia.kineticMWs, groups, cfg, {
    demandMW: s.demandMW,
    stage: s.shedStage,
    thresholdsHz: u.thresholdsHz,
    stagePct: u.stagePct,
  });
  let { frequencyHz } = freq;
  const { governorMW } = freq;
  s = { ...s, frequencyHz, governorMW };

  // Under-frequency load shedding (already applied inside the step) and restoration.
  let { shedStage, restoreTimer, eventLog } = s;
  const newStages = freq.shedStage - shedStage;
  if (newStages > 0) {
    for (let k = shedStage + 1; k <= freq.shedStage; k++) eventLog = [...eventLog, { minute, type: 'shed', stage: k }];
    shedStage = freq.shedStage;
    restoreTimer = 0;
  } else if (
    shedStage > 0 &&
    frequencyHz >= u.restoreAboveHz &&
    // Operators reconnect a block only when online headroom can carry it.
    s.reserve.upMW >= s.demandMW * (u.stagePct / 100)
  ) {
    restoreTimer += stepMin;
    if (restoreTimer >= u.restoreDelayMin) {
      shedStage--;
      restoreTimer = 0;
      eventLog = [...eventLog, { minute, type: 'restore', stage: shedStage }];
    }
  } else {
    restoreTimer = 0;
  }

  // A blackout happens if frequency left the safe range at any point in the step.
  if (freq.minHz < cfg.bands.blackoutLowHz) frequencyHz = freq.minHz;
  else if (freq.maxHz > cfg.bands.blackoutHighHz) frequencyHz = freq.maxHz;
  const band = frequencyBand(frequencyHz, cfg);
  let status = 'running';
  let blackoutCause = null;
  if (band === 'blackout') {
    status = 'blackout';
    blackoutCause = frequencyHz < cfg.frequency.nominalHz ? 'low' : 'high';
  } else if (minute >= cfg.time.dayMinutes) {
    status = 'finished';
  }

  // Statistics.
  const st = { ...s.stats };
  if (band === 'normal') st.minutesNormal += stepMin;
  else if (band === 'warning') st.minutesWarning += stepMin;
  else st.minutesCritical += stepMin;
  if (frequencyHz < cfg.bands.normalLowHz) st.lowMinutes += stepMin;
  if (frequencyHz > cfg.bands.normalHighHz) st.highMinutes += stepMin;
  const deviation = Math.abs(frequencyHz - cfg.frequency.nominalHz);
  if (deviation > st.worstDeviationHz) {
    st.worstDeviationHz = deviation;
    st.worstDeviationMinute = minute;
  }
  st.shedStages += newStages;
  st.unservedMWh += (s.demandMW - s.servedLoadMW) * hours;
  st.servedMWh += s.servedLoadMW * hours;
  st.generationMWh += s.generationMW * hours;
  st.curtailedMWh += s.curtailedMW * hours;
  st.renewableMWh += s.renewableMW * hours;
  for (const unit of s.units) {
    const type = world.types[unit.type];
    if (unit.outputMW > 0) {
      st.costNTD += unit.outputMW * type.costPerMWh * hours;
      st.co2Tonnes += unit.outputMW * type.co2PerMWh * hours;
    }
    // Keeping a unit warm (or warming it up) burns some fuel.
    if (unit.status === 'standby' || unit.status === 'warming') {
      st.costNTD += unit.maxMW * (type.standbyCostPerMWh ?? 0) * hours;
    }
  }

  return derive(
    { ...s, frequencyHz, shedStage, restoreTimer, eventLog, band, status, blackoutCause, stats: st },
    world,
    cfg,
  );
}

// ---- Player commands -----------------------------------------------------------

/** Recomputes derived quantities after units were changed outside step(). */
export function refresh(state, world, cfg = defaultConfig) {
  return derive(state, world, cfg);
}

function updateAt(state, world, index, cfg, fn) {
  const units = state.units.map((unit, i) => (i === index ? fn(unit, world.types[unit.type]) : unit));
  return derive({ ...state, units }, world, cfg);
}

/** Sets a unit's setpoint, clamped to its allowed range. Output follows at the ramp rate. */
export function setSetpoint(state, world, index, setpointMW, cfg = defaultConfig) {
  return updateAt(state, world, index, cfg, (unit, type) => setUnitSetpoint(unit, type, setpointMW));
}

export function startCommand(state, world, index, cfg = defaultConfig) {
  return updateAt(state, world, index, cfg, startUnit);
}

export function stopCommand(state, world, index, cfg = defaultConfig) {
  return updateAt(state, world, index, cfg, stopUnit);
}
