import { readFileSync } from 'node:fs';
import { config } from '../js/config.js';
import { step } from '../js/sim.js';

export const TYPES = JSON.parse(readFileSync(new URL('../data/unit-types.json', import.meta.url), 'utf8'));

// No load or wind noise, so imbalance is fully controlled by the test.
export const quiet = {
  ...config,
  load: { ...config.load, noiseStdPct: 0 },
  wind: { ...config.wind, noiseStd: 0 },
};

// Also no blackout, for tests of unit mechanics on a deliberately unbalanced grid.
export const sandbox = { ...quiet, bands: { ...quiet.bands, blackoutLowHz: -Infinity, blackoutHighHz: Infinity } };

/** A flat-demand world with the given unit specs. */
export function makeWorld(units, { loadMW = 1000, solar = [0], wind = [0], assist = false, events = [] } = {}) {
  return {
    types: TYPES,
    units,
    peakLoadMW: loadMW,
    profiles: { load: [1], solar, wind },
    events,
    assist,
    forecastErrorPct: 0,
    randomTrip: false,
  };
}

export function run(state, world, steps, cfg = quiet) {
  for (let i = 0; i < steps; i++) state = step(state, world, cfg);
  return state;
}

export function near(actual, expected, tolerance = 1e-9) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`expected ${expected} ± ${tolerance}, got ${actual}`);
  }
}
