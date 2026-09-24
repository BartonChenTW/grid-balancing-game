// Pure simulation: state in → state out. No DOM, no globals, no Math.random,
// so the same code runs in the browser and in `node --test`.
//
// Simplifications, for educators:
// - "Copper plate" grid: one node, no transmission limits, losses or voltage.
// - Frequency comes from a single-mass swing equation with time compressed
//   from seconds to game minutes, so inertia effects are visible at game speed
//   (see stepFrequency).
// - Units follow their setpoints at a fixed ramp rate. There is no automatic
//   governor response yet (the optional assist arrives in a later milestone).

import { config as defaultConfig } from './config.js';
import { clamp, createUnit, rampUnit, setpointRange, unitType } from './units.js';

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

/**
 * System inertia of the online fleet.
 * kineticMWs = Σ H_i · S_i (stored kinetic energy, MW·s), counting only
 * synchronous machines (inverter-based units have H = 0).
 * hSys = kineticMWs / S_online: adding inverter capacity dilutes it.
 */
export function systemInertia(units) {
  let kineticMWs = 0;
  let onlineMW = 0;
  for (const unit of units) {
    kineticMWs += unitType(unit).inertiaH * unit.maxMW;
    onlineMW += unit.maxMW;
  }
  return { kineticMWs, onlineMW, hSys: onlineMW > 0 ? kineticMWs / onlineMW : 0 };
}

/** 'normal' | 'warning' | 'critical' | 'blackout' */
export function frequencyBand(frequencyHz, cfg = defaultConfig) {
  const b = cfg.bands;
  if (frequencyHz < b.blackoutLowHz || frequencyHz > b.blackoutHighHz) return 'blackout';
  if (frequencyHz < b.warningLowHz || frequencyHz > b.warningHighHz) return 'critical';
  if (frequencyHz < b.normalLowHz || frequencyHz > b.normalHighHz) return 'warning';
  return 'normal';
}

/**
 * Swing equation for one lumped machine:
 *   df/dt = swingGain · f0 / (2 · H_sys · S_online) · imbalance − D · (f − f0)
 * 2 · H_sys · S_online is twice the stored kinetic energy. A real grid settles
 * within seconds; here t is in game minutes and swingGain and D are tuned so
 * the player can watch it happen. Less inertia → the same imbalance moves
 * frequency faster and further.
 */
function stepFrequency(frequencyHz, imbalanceMW, kineticMWs, cfg) {
  const { nominalHz, swingGain, dampingPerMin, substeps, minKineticMWs } = cfg.frequency;
  const gain = (swingGain * nominalHz) / (2 * Math.max(kineticMWs, minKineticMWs));
  const dt = cfg.time.stepMinutes / substeps;
  let f = frequencyHz;
  for (let i = 0; i < substeps; i++) {
    f += dt * (gain * imbalanceMW - dampingPerMin * (f - nominalHz));
  }
  return f;
}

/** Recomputes the derived quantities (load, generation, imbalance, inertia). */
function measure(state, scenario, cfg) {
  const shape = profileAt(scenario.profiles.load, state.minute, cfg.time.dayMinutes);
  const loadMW = scenario.peakLoadMW * shape * (1 + state.loadNoise);
  const generationMW = state.units.reduce((sum, unit) => sum + unit.outputMW, 0);
  return {
    ...state,
    loadMW,
    generationMW,
    imbalanceMW: generationMW - loadMW,
    inertia: systemInertia(state.units),
  };
}

export function createState(scenario, cfg = defaultConfig, seed = 1) {
  const frequencyHz = cfg.frequency.nominalHz;
  return measure(
    {
      minute: 0,
      seed,
      loadNoise: 0,
      frequencyHz,
      band: frequencyBand(frequencyHz, cfg),
      status: 'running', // 'running' | 'blackout' | 'finished'
      units: scenario.units.map(createUnit),
    },
    scenario,
    cfg,
  );
}

/** Advances the simulation by one step (cfg.time.stepMinutes). */
export function step(state, scenario, cfg = defaultConfig) {
  if (state.status !== 'running') return state;

  const minute = state.minute + cfg.time.stepMinutes;

  // AR(1) load noise with long-run standard deviation noiseStdPct.
  // The uniform shock is scaled by √3 to give it unit variance.
  const [r, seed] = nextRandom(state.seed);
  const a = cfg.load.noisePersistence;
  const shock = (r * 2 - 1) * Math.sqrt(3);
  const loadNoise = a * state.loadNoise + Math.sqrt(1 - a * a) * (cfg.load.noiseStdPct / 100) * shock;

  const units = state.units.map((unit) => rampUnit(unit, cfg.time.stepMinutes));
  const next = measure({ ...state, minute, seed, loadNoise, units }, scenario, cfg);

  const frequencyHz = stepFrequency(state.frequencyHz, next.imbalanceMW, next.inertia.kineticMWs, cfg);
  const band = frequencyBand(frequencyHz, cfg);
  let status = 'running';
  if (band === 'blackout') status = 'blackout';
  else if (minute >= cfg.time.dayMinutes) status = 'finished';

  return { ...next, frequencyHz, band, status };
}

/** Sets a unit's setpoint, clamped to its allowed range. Output follows at the ramp rate. */
export function setSetpoint(state, unitIndex, setpointMW) {
  const units = state.units.map((unit, i) => {
    if (i !== unitIndex) return unit;
    const [lo, hi] = setpointRange(unit);
    return { ...unit, setpointMW: clamp(setpointMW, lo, hi) };
  });
  return { ...state, units };
}
