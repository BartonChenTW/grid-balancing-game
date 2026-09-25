import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createState, setSetpoint } from '../js/sim.js';
import { makeWorld, near, quiet, run } from './helpers.js';

const coal = { type: 'coal', name: 'C', tech: 0, maxMW: 1000, initialState: 'online' };

test('auto storage covers a shortfall', () => {
  const world = makeWorld([coal, { type: 'battery', name: 'B', tech: 1, maxMW: 200, energyMWh: 400, auto: true }], { loadMW: 700 });
  let state = createState(world, quiet);
  state = setSetpoint(state, world, 0, 600, quiet); // 100 MW short once coal ramps down
  state = run(state, world, 30);
  assert.ok(state.units[1].outputMW > 80, `battery gives ${state.units[1].outputMW}`);
  assert.ok(Math.abs(state.frequencyHz - 60) < 0.05, `frequency ${state.frequencyHz}`);
});

test('auto storage soaks up a surplus by charging', () => {
  const world = makeWorld([coal, { type: 'battery', name: 'B', tech: 1, maxMW: 200, energyMWh: 400, auto: true, initialSocPct: 20 }], { loadMW: 700 });
  let state = createState(world, quiet);
  state = setSetpoint(state, world, 0, 800, quiet);
  state = run(state, world, 30);
  assert.ok(state.units[1].outputMW < -80, `battery gives ${state.units[1].outputMW}`);
  assert.ok(state.units[1].socMWh > 80);
});

test('manual storage (auto off) does nothing on its own', () => {
  const world = makeWorld([coal, { type: 'battery', name: 'B', tech: 1, maxMW: 200, energyMWh: 400 }], { loadMW: 700 });
  let state = createState(world, quiet);
  state = setSetpoint(state, world, 0, 600, quiet);
  state = run(state, world, 30);
  assert.equal(state.units[1].setpointMW, 0);
});

test('gas-peaker backup starts peakers when supply falls short, and stands them down after', () => {
  const peakers = [1, 2, 3].map((k) => ({ type: 'gasOcgt', name: `P${k}`, tech: 1, maxMW: 200, auto: true }));
  const world = makeWorld([coal, ...peakers], { loadMW: 900 });
  let state = createState(world, quiet);
  state = setSetpoint(state, world, 0, 650, quiet); // 250 MW short
  state = run(state, world, 40);
  const online = state.units.filter((u) => u.type === 'gasOcgt' && u.status === 'online');
  assert.ok(online.length >= 2, `${online.length} peakers online`);
  assert.ok(Math.abs(state.frequencyHz - 60) < 0.1, `frequency ${state.frequencyHz}`);
  // Coal comes back: the peakers are no longer needed and go to standby.
  state = setSetpoint(state, world, 0, 900, quiet);
  state = run(state, world, 120);
  assert.ok(state.units.filter((u) => u.type === 'gasOcgt').every((u) => u.status !== 'online'));
  assert.ok(state.units.some((u) => u.type === 'gasOcgt' && u.status === 'standby'));
});

test('demand response is used only when storage and peakers are not enough', () => {
  const world = makeWorld([
    coal,
    { type: 'battery', name: 'B', tech: 1, maxMW: 50, energyMWh: 400, auto: true },
    { type: 'dsm', name: 'D', tech: 2, maxMW: 200, auto: true },
  ], { loadMW: 900 });
  let state = createState(world, quiet);
  state = setSetpoint(state, world, 0, 780, quiet); // 120 MW short, battery covers 50
  state = run(state, world, 30);
  assert.ok(state.units[1].outputMW > 45);
  assert.ok(state.units[2].outputMW > 50, `DSM gives ${state.units[2].outputMW}`);
});

test('coal and gas on Auto follow the load within their ramp limits', () => {
  const world = makeWorld([
    { type: 'coal', name: 'C', tech: 0, maxMW: 1000, initialState: 'online', auto: true },
    { type: 'gasCcgt', name: 'G', tech: 1, maxMW: 500, initialState: 'online', auto: true },
  ], { loadMW: 1000, events: [{ timeMin: 10, type: 'demandSurge', factor: 1.2, durationMin: 600, rampMin: 30 }] });
  let state = createState(world, quiet);
  const before = state.units[0].outputMW + state.units[1].outputMW;
  state = run(state, world, 80);
  const after = state.units[0].outputMW + state.units[1].outputMW;
  assert.ok(after > before + 150, `output rose from ${before} to ${after}`);
  assert.ok(Math.abs(state.frequencyHz - 60) < 0.1, `frequency ${state.frequencyHz}`);
});

test('load-following units never start or stop units by themselves', () => {
  const world = makeWorld([
    { type: 'coal', name: 'C1', tech: 0, maxMW: 500, initialState: 'online', auto: true },
    { type: 'coal', name: 'C2', tech: 0, maxMW: 500, initialState: 'offline', auto: true },
  ], { loadMW: 900 });
  const state = run(createState(world, quiet), world, 30);
  assert.equal(state.units[1].status, 'offline');
});

test('auto solar and wind are curtailed only for a surplus, and restored after', () => {
  const world = makeWorld([
    { type: 'coal', name: 'C', tech: 0, maxMW: 1000, initialState: 'online' },
    { type: 'wind', name: 'W', tech: 1, maxMW: 600, auto: true },
  ], { loadMW: 900, wind: [0.5] });
  let state = createState(world, quiet); // coal 600 + wind 300 = 900
  state = setSetpoint(state, world, 0, 400, quiet); // coal at minimum; still 900 needed
  state = run(state, world, 20);
  near(state.units[1].outputMW, 300, 1); // shortfall: wind stays at full output
  state = setSetpoint(state, world, 0, 800, quiet); // coal back up: 200 MW surplus
  state = run(state, world, 40);
  assert.ok(state.units[1].curtailedMW > 150, `curtailed ${state.units[1].curtailedMW}`);
  assert.ok(Math.abs(state.frequencyHz - 60) < 0.1, `frequency ${state.frequencyHz}`);
  state = setSetpoint(state, world, 0, 400, quiet);
  state = run(state, world, 40);
  near(state.units[1].curtailedMW, 0, 1);
});

test('auto hydro covers a shortfall', () => {
  const world = makeWorld([
    { type: 'coal', name: 'C', tech: 0, maxMW: 1000, initialState: 'online' },
    { type: 'hydro', name: 'H', tech: 1, maxMW: 300, energyMWh: 5000, initialState: 'online', initialPct: 10, auto: true },
  ], { loadMW: 900 });
  let state = createState(world, quiet);
  state = setSetpoint(state, world, 0, 700, quiet);
  state = run(state, world, 30);
  assert.ok(state.units[1].outputMW > 150, `hydro gives ${state.units[1].outputMW}`);
});
