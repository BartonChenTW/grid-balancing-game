import { test } from 'node:test';
import assert from 'node:assert/strict';

import { config } from '../js/config.js';
import { createState, frequencyBand, profileAt, setSetpoint, step } from '../js/sim.js';
import { MINI_SCENARIO } from '../js/scenarios.js';

// No load noise, so imbalance is fully controlled by the test.
const quiet = { ...config, load: { ...config.load, noiseStdPct: 0 } };
// Also no blackout, for tests of unit mechanics on a deliberately unbalanced grid.
const sandbox = { ...quiet, bands: { ...quiet.bands, blackoutLowHz: -Infinity, blackoutHighHz: Infinity } };

function flatScenario(loadMW, units) {
  return { id: 'test', peakLoadMW: loadMW, profiles: { load: [1] }, units };
}

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-9, message ?? `expected ${expected}, got ${actual}`);
}

function run(state, scenario, steps, cfg = quiet) {
  for (let i = 0; i < steps; i++) state = step(state, scenario, cfg);
  return state;
}

test('coal ramps up at no more than 1.5% of max per minute', () => {
  const scenario = flatScenario(1000, [{ type: 'coal', name: 'C', maxMW: 1000, initialPct: 50 }]);
  let state = setSetpoint(createState(scenario, sandbox), 0, 1000);

  state = step(state, scenario, sandbox);
  near(state.units[0].outputMW, 515);

  state = run(state, scenario, 9, sandbox);
  near(state.units[0].outputMW, 650);
});

test('coal ramps down at the same limit and stops at the setpoint', () => {
  const scenario = flatScenario(1000, [{ type: 'coal', name: 'C', maxMW: 1000, initialPct: 50 }]);
  let state = setSetpoint(createState(scenario, sandbox), 0, 480);

  state = step(state, scenario, sandbox);
  near(state.units[0].outputMW, 485);
  state = step(state, scenario, sandbox);
  near(state.units[0].outputMW, 480);
  state = step(state, scenario, sandbox);
  near(state.units[0].outputMW, 480);
});

test('gas peaker ramps ten times faster than coal', () => {
  const scenario = flatScenario(1000, [{ type: 'gasOcgt', name: 'G', maxMW: 1000, initialPct: 50 }]);
  const state = step(setSetpoint(createState(scenario, quiet), 0, 1000), scenario, quiet);
  near(state.units[0].outputMW, 650);
});

test('setpoints are clamped to [min stable, max]', () => {
  const scenario = flatScenario(1000, [{ type: 'coal', name: 'C', maxMW: 1000, initialPct: 50 }]);
  const state = createState(scenario, quiet);
  assert.equal(setSetpoint(state, 0, 0).units[0].setpointMW, 400);
  assert.equal(setSetpoint(state, 0, 5000).units[0].setpointMW, 1000);
});

test('frequency rises with surplus and falls with shortfall', () => {
  const units = [{ type: 'coal', name: 'C', maxMW: 1000, initialPct: 60 }];

  const surplus = flatScenario(550, units);
  assert.ok(step(createState(surplus, quiet), surplus, quiet).frequencyHz > 60);

  const shortfall = flatScenario(650, units);
  assert.ok(step(createState(shortfall, quiet), shortfall, quiet).frequencyHz < 60);

  const balanced = flatScenario(600, units);
  assert.equal(step(createState(balanced, quiet), balanced, quiet).frequencyHz, 60);
});

test('less inertia: the same shortfall moves frequency further', () => {
  const coal = flatScenario(650, [{ type: 'coal', name: 'C', maxMW: 1000, initialPct: 60 }]);
  const gas = flatScenario(650, [{ type: 'gasOcgt', name: 'G', maxMW: 1000, initialPct: 60 }]);
  const coalDrop = 60 - step(createState(coal, quiet), coal, quiet).frequencyHz;
  const gasDrop = 60 - step(createState(gas, quiet), gas, quiet).frequencyHz;
  assert.ok(gasDrop > coalDrop, `gas drop ${gasDrop} should exceed coal drop ${coalDrop}`);
});

test('frequency settles back towards 60 Hz once balance is restored', () => {
  const scenario = flatScenario(600, [{ type: 'gasOcgt', name: 'G', maxMW: 1000, initialPct: 60 }]);
  let state = { ...createState(scenario, quiet), frequencyHz: 59.7 };
  state = run(state, scenario, 20);
  assert.ok(Math.abs(state.frequencyHz - 60) < 0.001);
  assert.equal(state.band, 'normal');
});

test('a large shortfall causes a blackout and stops the simulation', () => {
  const scenario = flatScenario(900, [{ type: 'coal', name: 'C', maxMW: 1000, initialPct: 50 }]);
  const state = run(createState(scenario, quiet), scenario, 30);
  assert.equal(state.status, 'blackout');
  assert.equal(step(state, scenario, quiet), state);
});

test('frequency bands', () => {
  assert.equal(frequencyBand(60.1), 'normal');
  assert.equal(frequencyBand(59.7), 'warning');
  assert.equal(frequencyBand(60.3), 'warning');
  assert.equal(frequencyBand(59.4), 'critical');
  assert.equal(frequencyBand(58.4), 'blackout');
  assert.equal(frequencyBand(61.6), 'blackout');
});

test('battery cannot discharge when empty or charge when full', () => {
  const unit = { type: 'battery', name: 'B', maxMW: 100, energyMWh: 100 };

  const empty = flatScenario(0, [{ ...unit, initialSocPct: 0 }]);
  let state = step(setSetpoint(createState(empty, quiet), 0, 100), empty, quiet);
  near(state.units[0].outputMW, 0);
  assert.equal(state.units[0].socMWh, 0);

  const full = flatScenario(0, [{ ...unit, initialSocPct: 100 }]);
  state = step(setSetpoint(createState(full, quiet), 0, -100), full, quiet);
  near(state.units[0].outputMW, 0);
  assert.equal(state.units[0].socMWh, 100);
});

test('battery discharge drains state of charge', () => {
  const scenario = flatScenario(60, [{ type: 'battery', name: 'B', maxMW: 60, energyMWh: 100, initialSocPct: 50 }]);
  const state = run(setSetpoint(createState(scenario, quiet), 0, 60), scenario, 10);
  near(state.units[0].socMWh, 40); // 60 MW for 10 min = 10 MWh
});

test('profiles interpolate linearly and wrap at midnight', () => {
  assert.equal(profileAt([0, 1], 0, 1440), 0);
  assert.equal(profileAt([0, 1], 360, 1440), 0.5);
  assert.equal(profileAt([0, 1], 1080, 1440), 0.5);
});

test('the same seed reproduces the same day; a different seed does not', () => {
  const a = run(createState(MINI_SCENARIO, config, 42), MINI_SCENARIO, 100, config);
  const b = run(createState(MINI_SCENARIO, config, 42), MINI_SCENARIO, 100, config);
  const c = run(createState(MINI_SCENARIO, config, 7), MINI_SCENARIO, 100, config);
  assert.equal(a.loadMW, b.loadMW);
  assert.notEqual(a.loadMW, c.loadMW);
});

test('the mini scenario starts roughly balanced and ends after one day', () => {
  let state = createState(MINI_SCENARIO, quiet);
  assert.ok(Math.abs(state.imbalanceMW) < 1);

  // Nobody dispatches here, so disable blackout to reach the end of the day.
  state = run(state, MINI_SCENARIO, 1440, sandbox);
  assert.equal(state.status, 'finished');
  assert.equal(state.minute, 1440);
});
