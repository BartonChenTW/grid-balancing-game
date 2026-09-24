import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createState, setSetpoint } from '../js/sim.js';
import { makeWorld, quiet, run } from './helpers.js';

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
