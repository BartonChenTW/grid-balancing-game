import { test } from 'node:test';
import assert from 'node:assert/strict';

import { config } from '../js/config.js';
import { createState, forecastVariable, frequencyBand, profileAt, setSetpoint, step } from '../js/sim.js';
import { makeWorld, near, quiet, run, sandbox } from './helpers.js';

const coal = (maxMW = 1000, extra = {}) => ({ type: 'coal', name: 'C', maxMW, initialState: 'online', ...extra });
const gas = (maxMW = 1000, name = 'G') => ({ type: 'gasOcgt', name, maxMW, initialState: 'online' });

test('initial dispatch balances demand with online thermal units', () => {
  const world = makeWorld([coal(1000)], { loadMW: 700 });
  const state = createState(world, quiet);
  near(state.units[0].outputMW, 700);
  near(state.imbalanceMW, 0, 1e-6);
});

test('coal ramps up at no more than 1.5% of max per minute', () => {
  const world = makeWorld([coal(1000)], { loadMW: 500 });
  let state = setSetpoint(createState(world, sandbox), world, 0, 1000, sandbox);
  state = step(state, world, sandbox);
  near(state.units[0].outputMW, 515);
  state = run(state, world, 9, sandbox);
  near(state.units[0].outputMW, 650);
});

test('coal ramps down at the same limit and stops at the setpoint', () => {
  const world = makeWorld([coal(1000)], { loadMW: 500 });
  let state = setSetpoint(createState(world, sandbox), world, 0, 480, sandbox);
  state = step(state, world, sandbox);
  near(state.units[0].outputMW, 485);
  state = run(state, world, 2, sandbox);
  near(state.units[0].outputMW, 480);
});

test('gas peaker ramps ten times faster than coal', () => {
  const world = makeWorld([gas(1000)], { loadMW: 500 });
  const state = step(setSetpoint(createState(world, sandbox), world, 0, 1000, sandbox), world, sandbox);
  near(state.units[0].outputMW, 650);
});

test('frequency rises with surplus and falls with shortfall', () => {
  const world = makeWorld([coal(1000)], { loadMW: 600 });
  const up = setSetpoint(createState(world, quiet), world, 0, 650, quiet);
  assert.ok(run(up, world, 5).frequencyHz > 60);
  const down = setSetpoint(createState(world, quiet), world, 0, 550, quiet);
  assert.ok(run(down, world, 5).frequencyHz < 60);
  near(run(createState(world, quiet), world, 5).frequencyHz, 60, 1e-9);
});

test('less inertia: the same shortfall moves frequency further', () => {
  const drop = (spec) => {
    const world = makeWorld([spec], { loadMW: 600 });
    return 60 - step(setSetpoint(createState(world, quiet), world, 0, 560, quiet), world, quiet).frequencyHz;
  };
  const coalDrop = drop(coal(1000));
  const gasDrop = drop(gas(1000));
  assert.ok(gasDrop > coalDrop, `gas drop ${gasDrop} should exceed coal drop ${coalDrop}`);
});

test('assist governor reduces the frequency deviation', () => {
  const deviation = (assist) => {
    const world = makeWorld([coal(1000), gas(1000)], { loadMW: 1200, assist });
    let state = createState(world, quiet);
    state = { ...state, demandMW: state.demandMW };
    // A sudden 50 MW shortfall: raise demand by lowering a setpoint.
    state = setSetpoint(state, world, 1, state.units[1].setpointMW - 50, quiet);
    return 60 - run(state, world, 10).frequencyHz;
  };
  const without = deviation(false);
  const withAssist = deviation(true);
  assert.ok(withAssist < without / 2, `assist ${withAssist} vs none ${without}`);
});

test('batteries respond to frequency automatically, even without assist', () => {
  const world = makeWorld(
    [coal(1000), { type: 'battery', name: 'B', maxMW: 500, energyMWh: 1000 }],
    { loadMW: 600 },
  );
  const noBattery = makeWorld([coal(1000)], { loadMW: 600 });
  const shortfall = (w) => 60 - run(setSetpoint(createState(w, quiet), w, 0, 560, quiet), w, 10).frequencyHz;
  assert.ok(shortfall(world) < shortfall(noBattery) / 2);
});

test('frequency settles back towards 60 Hz once balance is restored', () => {
  const world = makeWorld([gas(1000)], { loadMW: 600 });
  const state = run({ ...createState(world, quiet), frequencyHz: 59.7 }, world, 20);
  near(state.frequencyHz, 60, 0.001);
  assert.equal(state.band, 'normal');
});

test('under-frequency load shedding disconnects 5% stages, then restores them', () => {
  const world = makeWorld([coal(1000), gas(400, 'G')], { loadMW: 1200 });
  let state = createState(world, quiet);
  state = setSetpoint(state, world, 0, state.units[0].outputMW - 100, quiet);
  state = setSetpoint(state, world, 1, state.units[1].outputMW - 60, quiet);
  state = run(state, world, 20);
  assert.ok(state.stats.shedStages >= 1, 'should have shed load');
  assert.ok(state.servedLoadMW < state.demandMW);
  assert.notEqual(state.status, 'blackout');
  // Restore balance with headroom to spare: customers are reconnected.
  state = setSetpoint(state, world, 0, 1000, quiet);
  for (let i = 0; i < 200 && state.shedStage > 0; i++) {
    state = step(state, world, quiet);
    // Keep the gas unit following the returning load.
    state = setSetpoint(state, world, 1, state.units[1].outputMW + (60 - state.frequencyHz) * 2000, quiet);
  }
  assert.equal(state.shedStage, 0);
  assert.ok(state.eventLog.some((e) => e.type === 'restore'));
});

test('customers are not reconnected without reserve to carry them', () => {
  const world = makeWorld([coal(1000)], { loadMW: 1000 });
  let state = setSetpoint(createState(world, quiet), world, 0, 900, quiet);
  state = run(state, world, 15);
  const stage = state.shedStage;
  assert.ok(stage >= 1);
  state = setSetpoint(state, world, 0, 1000, quiet); // at max: no headroom left
  state = run(state, world, 120);
  assert.ok(state.shedStage >= 1, 'should stay shed while there is no reserve');
});

test('a large shortfall causes a blackout and stops the simulation', () => {
  const world = makeWorld([coal(1000)], { loadMW: 1000 });
  const cfg = { ...quiet, ufls: { ...quiet.ufls, thresholdsHz: [] } };
  const state = run(setSetpoint(createState(world, cfg), world, 0, 400, cfg), world, 30, cfg);
  assert.equal(state.status, 'blackout');
  assert.equal(state.blackoutCause, 'low');
  assert.equal(step(state, world, cfg), state);
});

test('frequency bands', () => {
  assert.equal(frequencyBand(60.1), 'normal');
  assert.equal(frequencyBand(59.7), 'warning');
  assert.equal(frequencyBand(60.3), 'warning');
  assert.equal(frequencyBand(59.4), 'critical');
  assert.equal(frequencyBand(58.4), 'blackout');
  assert.equal(frequencyBand(61.6), 'blackout');
});

test('profiles interpolate linearly and wrap at midnight', () => {
  assert.equal(profileAt([0, 1], 0, 1440), 0);
  assert.equal(profileAt([0, 1], 360, 1440), 0.5);
  assert.equal(profileAt([0, 1], 1080, 1440), 0.5);
});

test('a trip event removes capacity and is logged', () => {
  const world = makeWorld([coal(1000, { name: 'Coal A' }), gas(1000)], {
    loadMW: 1200,
    events: [{ timeMin: 5, type: 'trip', unit: 'Coal A', fraction: 0.5 }],
  });
  const state = run(createState(world, sandbox), world, 5, sandbox);
  assert.equal(state.units[0].maxMW, 500);
  assert.equal(state.eventLog[0].type, 'trip');
  assert.ok(state.eventLog[0].lostMW > 0);
});

test('clouds reduce solar output while they pass', () => {
  const world = makeWorld([coal(1000), { type: 'solar', name: 'S', maxMW: 500 }], {
    loadMW: 800,
    solar: [0.6],
    events: [{ timeMin: 10, type: 'clouds', factor: 0.5, durationMin: 60, rampMin: 1 }],
  });
  let state = run(createState(world, sandbox), world, 9, sandbox);
  near(state.units[1].outputMW, 300);
  state = run(state, world, 10, sandbox);
  near(state.units[1].outputMW, 150);
  state = run(state, world, 60, sandbox);
  near(state.units[1].outputMW, 300);
});

test('announced typhoon cut-out appears in the wind forecast after the warning', () => {
  const world = makeWorld([coal(1000), { type: 'wind', name: 'W', maxMW: 1000 }], {
    wind: [0.5],
    events: [{ timeMin: 600, type: 'windCutout', factor: 0, durationMin: 300, rampMin: 1, warnMin: 120 }],
  });
  let state = createState(world, sandbox);
  near(forecastVariable(world, 'wind', 700, sandbox, state), 500);
  state = run(state, world, 480, sandbox);
  assert.ok(state.eventLog.some((e) => e.type === 'warning'));
  near(forecastVariable(world, 'wind', 700, sandbox, state), 0);
});

test('the same seed reproduces the same day; a different seed does not', () => {
  const world = makeWorld([coal(1000), gas(1000)], { loadMW: 1200 });
  const a = run(createState(world, config, 42), world, 100, config);
  const b = run(createState(world, config, 42), world, 100, config);
  const c = run(createState(world, config, 7), world, 100, config);
  assert.equal(a.demandMW, b.demandMW);
  assert.notEqual(a.demandMW, c.demandMW);
});

test('the day ends at 24:00', () => {
  const world = makeWorld([coal(1000)], { loadMW: 600 });
  const state = run(createState(world, sandbox), world, 1440, sandbox);
  assert.equal(state.status, 'finished');
  assert.equal(state.minute, 1440);
});

test('stats count cost and CO₂ of generation', () => {
  const world = makeWorld([coal(1000)], { loadMW: 600 });
  const state = run(createState(world, quiet), world, 60);
  near(state.stats.costNTD, 600 * 1800, 1e-3);
  near(state.stats.co2Tonnes, 600 * 0.9, 1e-6);
});
