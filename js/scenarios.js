// Scenarios. M1 uses one hard-coded mini scenario in the same shape as the
// JSON format in PLAN.md §6. M3 adds loading and validation of
// data/scenarios/*.json.

export const MINI_SCENARIO = {
  id: 'mini',
  name: 'Mini grid',
  description: 'A small island grid: one coal block, one gas peaker, one battery.',
  dataStatus: 'placeholder',
  peakLoadMW: 900,
  profiles: {
    // Hourly, normalised to peak: night trough, lunchtime dip, evening peak.
    load: [
      0.66, 0.62, 0.6, 0.58, 0.58, 0.6, 0.66, 0.74, 0.82, 0.87, 0.9, 0.91,
      0.86, 0.9, 0.92, 0.92, 0.91, 0.92, 0.96, 1.0, 0.98, 0.92, 0.82, 0.73,
    ],
  },
  units: [
    { type: 'coal', name: 'Coal block A', maxMW: 700, initialPct: 72 },
    { type: 'gasOcgt', name: 'Gas peaker B', maxMW: 300, initialPct: 30 },
    { type: 'battery', name: 'Battery C', maxMW: 150, energyMWh: 300, initialPct: 0, initialSocPct: 50 },
  ],
};
