import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  canStart,
  createUnit,
  setUnitSetpoint,
  startUnit,
  stopUnit,
  tripUnit,
  updateUnit,
} from '../js/units.js';
import { TYPES, near } from './helpers.js';

const ctx = { stepMinutes: 1, availableMW: 0 };

function tick(unit, minutes, extra = {}) {
  for (let i = 0; i < minutes; i++) unit = updateUnit(unit, TYPES[unit.type], { ...ctx, ...extra });
  return unit;
}

function make(type, maxMW = 1000, spec = {}) {
  return createUnit({ type, name: type, maxMW, ...spec }, TYPES[type]);
}

for (const [type, startupMin] of [['coal', 480], ['gasCcgt', 120], ['gasOcgt', 15], ['oil', 30]]) {
  test(`${type} takes ${startupMin} minutes to start, then ramps up to minimum stable load`, () => {
    let unit = startUnit(make(type), TYPES[type]);
    assert.equal(unit.status, 'starting');
    unit = tick(unit, startupMin - 1);
    assert.equal(unit.status, 'starting');
    assert.equal(unit.outputMW, 0);
    unit = tick(unit, 1);
    assert.equal(unit.status, 'online');
    assert.equal(unit.setpointMW, TYPES[type].minStablePct * 10);
    unit = tick(unit, 1);
    near(unit.outputMW, Math.min(TYPES[type].rampPctPerMin * 10, TYPES[type].minStablePct * 10));
  });
}

test('online thermal units cannot be set below minimum stable load', () => {
  const unit = make('gasCcgt', 1000, { initialState: 'online' });
  assert.equal(setUnitSetpoint(unit, TYPES.gasCcgt, 0).setpointMW, 450);
  assert.equal(setUnitSetpoint(unit, TYPES.gasCcgt, 2000).setpointMW, 1000);
});

test('stopping ramps output down to zero, then the unit is offline', () => {
  let unit = { ...make('coal', 1000, { initialState: 'online' }), outputMW: 600, setpointMW: 600 };
  unit = stopUnit(unit, TYPES.coal);
  assert.equal(unit.status, 'stopping');
  unit = tick(unit, 10);
  assert.ok(unit.outputMW < 600 && unit.outputMW > 0);
  unit = tick(unit, 120);
  assert.equal(unit.status, 'offline');
  assert.equal(unit.outputMW, 0);
});

test('a start can be cancelled, and a shutdown can be cancelled', () => {
  let unit = startUnit(make('coal'), TYPES.coal);
  unit = stopUnit(unit, TYPES.coal);
  assert.equal(unit.status, 'offline');

  unit = { ...make('coal', 1000, { initialState: 'online' }), outputMW: 600, setpointMW: 600 };
  unit = startUnit(stopUnit(unit, TYPES.coal), TYPES.coal);
  assert.equal(unit.status, 'online');
  assert.equal(unit.setpointMW, 600);
});

test('nuclear cannot restart within the day once stopped', () => {
  let unit = { ...make('nuclear', 1000, { initialState: 'online' }), outputMW: 1000, setpointMW: 1000 };
  unit = tick(stopUnit(unit, TYPES.nuclear), 200);
  assert.equal(unit.status, 'offline');
  assert.equal(canStart(unit, TYPES.nuclear), false);
  assert.equal(startUnit(unit, TYPES.nuclear).status, 'offline');
});

test('nuclear is limited to 70–100% and ramps slowly', () => {
  let unit = { ...make('nuclear', 1000, { initialState: 'online' }), outputMW: 1000, setpointMW: 1000 };
  unit = setUnitSetpoint(unit, TYPES.nuclear, 0);
  assert.equal(unit.setpointMW, 700);
  near(tick(unit, 1).outputMW, 995);
});

test('offline units cannot change setpoint', () => {
  const unit = make('coal');
  assert.equal(setUnitSetpoint(unit, TYPES.coal, 500).setpointMW, 0);
});

test('battery charging stores 90% of the energy drawn', () => {
  let unit = make('battery', 100, { energyMWh: 400, initialSocPct: 0 });
  unit = setUnitSetpoint(unit, TYPES.battery, -100);
  unit = tick(unit, 60);
  near(unit.socMWh, 90, 1e-9);
});

test('battery cannot discharge when empty or charge when full', () => {
  let empty = setUnitSetpoint(make('battery', 100, { energyMWh: 100, initialSocPct: 0 }), TYPES.battery, 100);
  empty = tick(empty, 1);
  assert.equal(empty.outputMW, 0);
  let full = setUnitSetpoint(make('battery', 100, { energyMWh: 100, initialSocPct: 100 }), TYPES.battery, -100);
  full = tick(full, 1);
  assert.equal(full.outputMW, 0);
  assert.equal(full.socMWh, 100);
});

test('battery discharge drains state of charge', () => {
  let unit = setUnitSetpoint(make('battery', 60, { energyMWh: 100, initialSocPct: 50 }), TYPES.battery, 60);
  unit = tick(unit, 10);
  near(unit.socMWh, 40);
});

test('pumped hydro starts in 5 minutes, pumps at 75% efficiency', () => {
  let unit = startUnit(make('pumpedHydro', 100, { energyMWh: 1000, initialSocPct: 0 }), TYPES.pumpedHydro);
  unit = tick(unit, 5);
  assert.equal(unit.status, 'online');
  // First minute ramps to −50 MW (50%/min), then 60 minutes at −100 MW.
  unit = tick(setUnitSetpoint(unit, TYPES.pumpedHydro, -100), 61);
  near(unit.socMWh, 0.75 * (50 / 60 + 100), 1e-9);
});

test('hydro stops when its daily water budget runs out', () => {
  let unit = make('hydro', 100, { energyMWh: 50, initialState: 'online' });
  unit = setUnitSetpoint({ ...unit, outputMW: 100 }, TYPES.hydro, 100);
  unit = tick(unit, 30);
  near(unit.budgetMWh, 0, 1e-9);
  unit = tick(unit, 1);
  near(unit.outputMW, 0, 1e-6);
});

test('demand response stops after its daily activation limit', () => {
  let unit = startUnit(make('dsm', 100, { maxActivationMin: 30 }), TYPES.dsm);
  unit = tick(unit, 2);
  assert.equal(unit.status, 'online');
  unit = tick(setUnitSetpoint(unit, TYPES.dsm, 100), 40);
  assert.equal(unit.outputMW, 0);
  assert.equal(unit.activeMin, 30);
});

test('solar follows availability; curtailment caps it', () => {
  let unit = make('solar', 1000);
  unit = tick(unit, 1, { availableMW: 600 });
  assert.equal(unit.outputMW, 600);
  unit = tick(setUnitSetpoint(unit, TYPES.solar, 400), 1, { availableMW: 600 });
  assert.equal(unit.outputMW, 400);
  assert.equal(unit.curtailedMW, 200);
});

test('wind cannot be started or stopped, only curtailed', () => {
  const unit = make('wind', 1000);
  assert.equal(unit.status, 'online');
  assert.equal(stopUnit(unit, TYPES.wind), unit);
});

test('a partial trip removes a fraction of capacity; a full trip takes the unit offline', () => {
  const unit = { ...make('coal', 1000, { initialState: 'online' }), outputMW: 800, setpointMW: 800 };
  const partial = tripUnit(unit, 0.25);
  assert.equal(partial.maxMW, 750);
  assert.equal(partial.outputMW, 600);
  const full = tripUnit(unit, 1);
  assert.equal(full.status, 'offline');
  assert.equal(full.outputMW, 0);
});
