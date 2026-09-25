import { test } from 'node:test';
import assert from 'node:assert/strict';

import { config } from '../js/config.js';
import { capitalCost, capitalRecoveryFactor } from '../js/economics.js';
import { TYPES, near } from './helpers.js';

const fx = config.economics.eurToTwd;

test('capital recovery factor matches the annuity formula', () => {
  near(capitalRecoveryFactor(0.05, 25), 0.0709525, 1e-6);
  near(capitalRecoveryFactor(0.05, 1), 1.05, 1e-12);
  near(capitalRecoveryFactor(0, 20), 0.05, 1e-12); // no discounting: straight line
});

test('system cost levelises each technology over its lifetime, as a ±30% range', () => {
  const scenario = { units: [{ type: 'solar', maxMW: 1000 }, { type: 'dsm', maxMW: 500 }] };
  const cost = capitalCost(scenario, TYPES, 0.071);
  const solar = cost.byTech.find((x) => x.type === 'solar');
  const central = 600 * 1e6 * fx * capitalRecoveryFactor(0.071, 25); // €600/kW × 1 GW
  near(solar.annualNTD.central, central, 1e-3);
  near(solar.annualNTD.low, central * 0.7, 1e-3);
  near(solar.annualNTD.high, central * 1.3, 1e-3);
  assert.equal(cost.byTech.some((x) => x.type === 'dsm'), false); // a programme, nothing to build
  near(cost.annualNTD.central, central, 1e-3);
});

test('battery power and energy parts have their own costs and lifetimes', () => {
  const cost = capitalCost({ units: [{ type: 'battery', maxMW: 100, energyMWh: 400 }] }, TYPES, 0.071);
  const power = TYPES.battery.capexEURPerKW * 1e5 * fx;
  const energy = TYPES.battery.capexEURPerKWh * 4e5 * fx;
  near(cost.byTech[0].overnightNTD.central, power + energy, 1e-3);
  near(cost.byTech[0].annualNTD.central,
    power * capitalRecoveryFactor(0.071, TYPES.battery.lifeYears) + energy * capitalRecoveryFactor(0.071, TYPES.battery.energyLifeYears), 1e-3);
});

test('wind blends onshore and offshore costs by the offshore share', () => {
  const onshore = capitalCost({ units: [{ type: 'wind', maxMW: 1000, offshoreShare: 0 }] }, TYPES, 0.071);
  const offshore = capitalCost({ units: [{ type: 'wind', maxMW: 1000, offshoreShare: 1 }] }, TYPES, 0.071);
  near(onshore.overnightNTD.central, TYPES.wind.capexEURPerKW * 1e6 * fx, 1e-3);
  near(offshore.overnightNTD.central, TYPES.wind.capexOffshoreEURPerKW * 1e6 * fx, 1e-3);
});

test('a higher discount rate makes long-lived, capital-heavy fleets cost more per year', () => {
  const scenario = { units: [{ type: 'nuclear', maxMW: 1000 }] };
  assert.ok(capitalCost(scenario, TYPES, 0.10).annualNTD.central > capitalCost(scenario, TYPES, 0.05).annualNTD.central);
});
