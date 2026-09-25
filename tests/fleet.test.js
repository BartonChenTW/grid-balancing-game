import { test } from 'node:test';
import assert from 'node:assert/strict';

import { canTechAction, techAction, techSummary } from '../js/fleet.js';
import { createState } from '../js/sim.js';
import { TYPES, makeWorld, run, sandbox } from './helpers.js';

// A coal fleet of 4 × 500 MW: 2 online, 1 on standby, 1 cold.
function coalFleet() {
  const units = [
    { type: 'coal', name: 'Coal 1', tech: 0, maxMW: 500, initialState: 'online' },
    { type: 'coal', name: 'Coal 2', tech: 0, maxMW: 500, initialState: 'online' },
    { type: 'coal', name: 'Coal 3', tech: 0, maxMW: 500, initialState: 'standby' },
    { type: 'coal', name: 'Coal 4', tech: 0, maxMW: 500, initialState: 'offline' },
  ];
  const world = makeWorld(units, { loadMW: 700 });
  return { world, state: createState(world, sandbox) };
}

test('a technology summary counts units by state', () => {
  const { world, state } = coalFleet();
  const s = techSummary(state, world, 0);
  assert.equal(s.count, 4);
  assert.equal(s.online, 2);
  assert.equal(s.standby, 1);
  assert.equal(s.offline, 1);
  assert.equal(s.onlineMW, 1000);
  assert.ok(Math.abs(s.outputMW - 700) < 1e-6);
});

test('Online + syncs a standby unit first, then cold-starts', () => {
  const { world, state } = coalFleet();
  let s = techAction(state, world, 0, 'onlineUp', sandbox);
  assert.equal(s.units[2].status, 'starting'); // the standby unit
  s = techAction(s, world, 0, 'onlineUp', sandbox);
  assert.equal(s.units[3].status, 'warming'); // then the cold one
  s = run(s, world, TYPES.coal.syncMin, sandbox);
  assert.equal(techSummary(s, world, 0).online, 3);
});

test('Online − sends the least-loaded unit to standby', () => {
  const { world, state } = coalFleet();
  let s = techAction(state, world, 0, 'onlineDown', sandbox);
  assert.equal(s.units.filter((u) => u.status === 'stopping').length, 1);
  s = run(s, world, 120, sandbox);
  const sum = techSummary(s, world, 0);
  assert.equal(sum.online, 1);
  assert.equal(sum.standby, 2);
});

test('Standby + warms a cold unit; Standby − lets one cool', () => {
  const { world, state } = coalFleet();
  let s = techAction(state, world, 0, 'standbyUp', sandbox);
  assert.equal(techSummary(s, world, 0).warming, 1);
  s = techAction(s, world, 0, 'standbyDown', sandbox); // cancels the warm-up first
  assert.equal(techSummary(s, world, 0).offline, 1);
  s = techAction(s, world, 0, 'standbyDown', sandbox); // then cools the standby unit
  assert.equal(techSummary(s, world, 0).standby, 0);
  assert.equal(canTechAction(s, world, 0, 'standbyDown'), false);
});

test('output +/− moves every online unit by one step', () => {
  const { world, state } = coalFleet();
  const before = state.units.slice(0, 2).map((u) => u.setpointMW);
  const s = techAction(state, world, 0, 'up', sandbox);
  s.units.slice(0, 2).forEach((u, i) => assert.equal(u.setpointMW, before[i] + 25));
  assert.equal(s.units[2].setpointMW, 0); // standby unit untouched
});

test('every technology can be switched to Auto and back', () => {
  for (const type of Object.keys(TYPES).filter((k) => !k.startsWith('_'))) {
    assert.equal(TYPES[type].autoCapable, true, `${type} should be auto-capable`);
  }
  const world = makeWorld([
    { type: 'nuclear', name: 'N', tech: 0, maxMW: 1000, initialState: 'online' },
    { type: 'wind', name: 'W', tech: 1, maxMW: 100 },
  ], { loadMW: 600 });
  let state = createState(world, sandbox);
  state = techAction(state, world, 0, 'toggleAuto', sandbox);
  state = techAction(state, world, 1, 'toggleAuto', sandbox);
  assert.equal(state.units[0].auto, true);
  assert.equal(state.units[1].auto, true);
  assert.equal(techAction(state, world, 1, 'toggleAuto', sandbox).units[1].auto, false);
});
