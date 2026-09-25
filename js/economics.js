// Overall system cost of a fleet (pure): the capital cost of building every
// generating and storage unit, levelised over its lifetime at a discount
// rate, in NT$ per year — as a range, because build costs are uncertain.
//
//   overnight cost  = capex per kW × kW  (+ capex per kWh × kWh for storage)
//   annual cost     = overnight cost × CRF(r, n)
//   CRF(r, n)       = r (1 + r)^n / ((1 + r)^n − 1)   (capital recovery factor)
//   range           = central × (1 ± spread)
//
// Build costs and lifetimes are the technology-data 2030 projections used by
// the Taiwan PyPSA-Earth model (EUR, 2013 prices), converted to NT$ at
// cfg.economics.eurToTwd, with the same ±30% investment uncertainty and 5–10%
// discount-rate range as that model's sandbox. Wind blends onshore and
// offshore costs by the fleet's offshore share. Fuel is not included (the game
// measures it while you play); nor are maintenance, grid connection or
// financing details.
import { config as defaultConfig } from './config.js';

/** Capital recovery factor: share of the overnight cost to pay each year. */
export function capitalRecoveryFactor(rate, years) {
  if (years <= 0) return 0;
  if (rate === 0) return 1 / years;
  const g = (1 + rate) ** years;
  return (rate * g) / (g - 1);
}

/** Build cost per kW in EUR for a scenario entry (wind blends onshore and offshore). */
function capexPerKW(entry, type, cfg) {
  const onshore = type.capexEURPerKW ?? 0;
  if (type.capexOffshoreEURPerKW === undefined) return onshore;
  const share = entry.offshoreShare ?? cfg.economics.windOffshoreShare;
  return (1 - share) * onshore + share * type.capexOffshoreEURPerKW;
}

const range = (central, spread) => ({ low: central * (1 - spread), central, high: central * (1 + spread) });

/**
 * Levelised capital cost of a scenario's fleet at discount rate `rate` (0.071 = 7.1%).
 * Returns { rate, overnightNTD, annualNTD, byTech } where each cost is
 * { low, central, high } in NT$; byTech is sorted by central annual cost.
 */
export function capitalCost(scenario, types, rate, cfg = defaultConfig) {
  const fx = cfg.economics.eurToTwd;
  const byTech = [];
  for (const u of scenario.units) {
    const type = types[u.type];
    if (!type.lifeYears) continue;
    const kW = u.maxMW * 1000;
    const kWh = (u.energyMWh ?? 0) * 1000;
    const powerNTD = capexPerKW(u, type, cfg) * kW * fx;
    const energyNTD = (type.capexEURPerKWh ?? 0) * kWh * fx;
    if (powerNTD + energyNTD <= 0) continue;
    const annual = powerNTD * capitalRecoveryFactor(rate, type.lifeYears) +
      energyNTD * capitalRecoveryFactor(rate, type.energyLifeYears ?? type.lifeYears);
    const spread = (type.capexSpreadPct ?? cfg.economics.investmentSpreadPct) / 100;
    byTech.push({
      type: u.type,
      name: u.name,
      maxMW: u.maxMW,
      energyMWh: u.energyMWh ?? 0,
      lifeYears: type.lifeYears,
      overnightNTD: range(powerNTD + energyNTD, spread),
      annualNTD: range(annual, spread),
    });
  }
  byTech.sort((a, b) => b.annualNTD.central - a.annualNTD.central);
  const sum = (key, part) => byTech.reduce((total, x) => total + x[key][part], 0);
  const total = (key) => ({ low: sum(key, 'low'), central: sum(key, 'central'), high: sum(key, 'high') });
  return { rate, overnightNTD: total('overnightNTD'), annualNTD: total('annualNTD'), byTech };
}
