// Overall system cost of a fleet (pure): the capital cost of building every
// generating and storage unit, levelised over its lifetime at a discount
// rate, in NT$ per year.
//
//   overnight cost  = capexNTDPerKW × kW  (+ capexNTDPerKWh × kWh for storage)
//   annual cost     = overnight cost × CRF(r, n)
//   CRF(r, n)       = r (1 + r)^n / ((1 + r)^n − 1)   (capital recovery factor)
//
// This is the yearly payment that repays the investment with interest over
// the technology's life. Fuel is not included (the game measures it while you
// play); nor are maintenance, grid or financing details. Cost figures in
// data/unit-types.json are rough and illustrative.

/** Capital recovery factor: share of the overnight cost to pay each year. */
export function capitalRecoveryFactor(rate, years) {
  if (years <= 0) return 0;
  if (rate === 0) return 1 / years;
  const g = (1 + rate) ** years;
  return (rate * g) / (g - 1);
}

/**
 * Levelised capital cost of a scenario's fleet.
 * Returns { overnightNTD, annualNTD, rate, byTech: [{ type, name, maxMW,
 * energyMWh, overnightNTD, lifeYears, annualNTD }] }, largest annual cost first.
 */
export function capitalCost(scenario, types, rate) {
  const byTech = [];
  for (const u of scenario.units) {
    const type = types[u.type];
    const overnightNTD = (type.capexNTDPerKW ?? 0) * u.maxMW * 1000 + (type.capexNTDPerKWh ?? 0) * (u.energyMWh ?? 0) * 1000;
    if (overnightNTD <= 0 || !type.lifeYears) continue;
    byTech.push({
      type: u.type,
      name: u.name,
      maxMW: u.maxMW,
      energyMWh: u.energyMWh ?? 0,
      overnightNTD,
      lifeYears: type.lifeYears,
      annualNTD: overnightNTD * capitalRecoveryFactor(rate, type.lifeYears),
    });
  }
  byTech.sort((a, b) => b.annualNTD - a.annualNTD);
  return {
    rate,
    overnightNTD: byTech.reduce((sum, x) => sum + x.overnightNTD, 0),
    annualNTD: byTech.reduce((sum, x) => sum + x.annualNTD, 0),
    byTech,
  };
}
