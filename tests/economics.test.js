import { test } from 'node:test';
import assert from 'node:assert/strict';

import { capitalCost, capitalRecoveryFactor } from '../js/economics.js';
import { TYPES, near } from './helpers.js';

test('capital recovery factor matches the annuity formula', () => {
  near(capitalRecoveryFactor(0.05, 25), 0.0709525, 1e-6);
  near(capitalRecoveryFactor(0.05, 1), 1.05, 1e-12);
  near(capitalRecoveryFactor(0, 20), 0.05, 1e-12); // no discounting: straight line
});

test('overall system cost levelises each technology over its lifetime', () => {
  const scenario = {
    units: [
      { type: 'solar', maxMW: 1000 }, // 1 GW × NT$26,000/kW, 25 years
      { type: 'battery', maxMW: 100, energyMWh: 400 }, // per kW and per kWh, 15 years
      { type: 'dsm', maxMW: 500 }, // a programme, nothing to build
    ],
  };
  const cost = capitalCost(scenario, TYPES, 0.05);
  const solar = cost.byTech.find((x) => x.type === 'solar');
  near(solar.overnightNTD, 26000 * 1e6);
  near(solar.annualNTD, 26000 * 1e6 * capitalRecoveryFactor(0.05, 25));
  const battery = cost.byTech.find((x) => x.type === 'battery');
  near(battery.overnightNTD, 6400 * 1e5 + 8000 * 4e5);
  assert.equal(cost.byTech.some((x) => x.type === 'dsm'), false);
  near(cost.annualNTD, solar.annualNTD + battery.annualNTD);
});

test('a higher discount rate makes long-lived, capital-heavy fleets cost more per year', () => {
  const scenario = { units: [{ type: 'nuclear', maxMW: 1000 }] };
  assert.ok(capitalCost(scenario, TYPES, 0.08).annualNTD > capitalCost(scenario, TYPES, 0.03).annualNTD);
});
