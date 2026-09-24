// Every tunable number in the game lives here. Values are tuned for
// playability, not physical accuracy — see the comments in sim.js for what is
// approximated and why.
export const config = {
  time: {
    dayMinutes: 1440,
    stepMinutes: 1,
    gameMinutesPerRealSecond: 5, // at 1× a day takes about 5 real minutes
    speeds: [0, 1, 2, 4], // 0 = paused
    defaultSpeedIndex: 1,
    maxStepsPerFrame: 60, // stops a stalled tab from fast-forwarding hours at once
    maxFrameMs: 250,
  },

  frequency: {
    nominalHz: 60,
    // Scales the swing equation after it is moved from seconds to game minutes.
    swingGain: 1,
    // Load damping D (per game minute): pulls frequency back towards nominal.
    dampingPerMin: 0.5,
    // Integration sub-steps per simulation step (explicit Euler stays stable
    // while the effective damping * stepMinutes / substeps is well below 1).
    substeps: 20,
    // Floor on stored kinetic energy so a grid with no synchronous machines
    // online does not divide by zero.
    minKineticMWs: 1000,
  },

  // Automatic governor response ("assist"): online dispatchable units change
  // output in proportion to the frequency deviation, within their headroom.
  // Real grids use about 5% droop; a softer 20% leaves work for the player.
  assist: {
    droop: 0.2,
  },

  // Units whose type has "fastResponse" (batteries) always respond to
  // frequency, like Taipower's dReg/AFC battery services, even with assist off.
  fastResponse: {
    droop: 0.05,
  },

  bands: {
    normalLowHz: 59.8,
    normalHighHz: 60.2,
    warningLowHz: 59.5, // below this: under-frequency load shedding
    warningHighHz: 60.5,
    blackoutLowHz: 58.5,
    blackoutHighHz: 61.5,
  },

  // Under-frequency load shedding (UFLS): automatic relays disconnect
  // customers in stages to stop a frequency collapse.
  ufls: {
    stagePct: 5, // % of demand disconnected per stage
    maxStages: 4,
    stageDelayMin: 1, // minimum time between stages
    restoreAboveHz: 59.9, // reconnect customers once frequency recovers…
    restoreDelayMin: 5, // …has stayed there this long (per stage), and reserve can carry the block
  },

  load: {
    // Load noise is a smoothed random walk (AR(1)) around the profile.
    noiseStdPct: 0.4, // long-run standard deviation, % of load
    noisePersistence: 0.9, // 0 = white noise, closer to 1 = slower wander
  },

  wind: {
    // A whole wind fleet is smooth minute to minute but drifts over hours.
    noiseStd: 0.04, // long-run standard deviation of capacity factor
    noisePersistence: 0.995, // ≈ 3-hour time constant
  },

  // Effects of events such as typhoon cut-out or clouds fade in and out.
  events: {
    defaultRampMin: 20,
    randomTripFraction: 0.5, // Hard: part of a large block trips at a random time
    randomTripWindowMin: [600, 1200],
  },

  difficulties: {
    easy: { assist: true, forecastErrorPct: 0, events: false, randomTrip: false },
    normal: { assist: false, forecastErrorPct: 0, events: true, randomTrip: false },
    hard: { assist: false, forecastErrorPct: 3, events: true, randomTrip: true },
  },

  // Custom mix: slider limits (GW), how big blocks are, and storage hours.
  custom: {
    peakRangeGW: [25, 90],
    defaultScenario: 'taiwan-2025',
    reserveMarginPct: 5, // auto-commitment brings this much spare capacity online at midnight
    techs: [
      { type: 'nuclear', maxGW: 12, blockMW: 3000 },
      { type: 'coal', maxGW: 30, blockMW: 7000 },
      { type: 'gasCcgt', maxGW: 50, blockMW: 8000 },
      { type: 'gasOcgt', maxGW: 15, blockMW: 15000 },
      { type: 'oil', maxGW: 5, blockMW: 5000 },
      { type: 'hydro', maxGW: 3, blockMW: 3000, hours: 7 },
      { type: 'pumpedHydro', maxGW: 10, blockMW: 10000, hours: 6 },
      { type: 'battery', maxGW: 40, blockMW: 40000, hours: 4 },
      { type: 'dsm', maxGW: 8, blockMW: 8000 },
      { type: 'solar', maxGW: 100, blockMW: 100000 },
      { type: 'wind', maxGW: 60, blockMW: 60000 },
    ],
    maxBlocksPerTech: 4,
  },

  score: {
    maxPoints: 1000,
    warningWeight: 0.5, // a minute in the warning band earns half a point
    shedStagePenalty: 25,
    starThresholds: [500, 750, 900],
  },

  ui: {
    setpointStepPct: 5, // one +/− press moves the setpoint by 5% of unit max
    holdDelayMs: 400, // hold a +/− button this long before it repeats…
    holdRepeatMs: 110, // …then repeat this often
    chartFps: 15,
    freqStripRangeHz: [58.5, 61.5],
    gaugeRangeHz: [58.5, 61.5],
    forecastStepMin: 5, // resolution of forecast lines on the chart
    chartCursorStepMin: 15, // arrow keys move the chart cursor this much
    toastMs: 9000, // how long an event banner stays up (real time)
    // Chart series, stacked bottom to top. Colours are CSS tokens --series-<id>.
    chartGroups: [
      { id: 'nuclear', types: ['nuclear'] },
      { id: 'coal', types: ['coal'] },
      { id: 'gas', types: ['gasCcgt', 'gasOcgt'] },
      { id: 'hydro', types: ['hydro'] },
      { id: 'wind', types: ['wind'] },
      { id: 'solar', types: ['solar'] },
      { id: 'storage', types: ['battery', 'pumpedHydro'] },
      { id: 'other', types: ['oil', 'dsm'] }, // plus automatic response
    ],
  },
};
