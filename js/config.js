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

  // Leaderboard (Cloudflare Worker in leaderboard/). Empty url = leaderboard hidden.
  leaderboard: {
    url: 'https://follow-the-load-leaderboard.barton-chen-energy.workers.dev',
    boardSize: 10, // entries on the end screen
    previewSize: 5, // entries on the setup screen
    timeoutMs: 8000,
    maxMoves: 20000, // must match leaderboard/validate.js
  },

  // Author and project links shown in the footer.
  about: {
    author: 'Barton Chen',
    email: 'barton.chen.energy@gmail.com',
    repo: 'https://github.com/BartonChenTW/grid-balancing-game',
    issues: 'https://github.com/BartonChenTW/grid-balancing-game/issues/new/choose',
    model: 'https://bartonchentw.github.io/pypsa-earth/',
  },

  // Fuel groups for the cost and CO₂ bars (unit types name theirs in "fuel").
  fuels: ['nuclear', 'coal', 'gas', 'oil', 'other'],

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
  // customers in stages to stop a frequency collapse. Each stage trips the
  // moment frequency crosses its threshold, even mid-step.
  ufls: {
    stagePct: 5, // % of demand disconnected per stage
    thresholdsHz: [59.5, 59.3, 59.1, 58.9],
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
    // Random accidents: how many per day, when, and what they do.
    random: {
      count: 3,
      windowMin: [300, 1320],
      minGapMin: 120,
      weights: { trip: 4, clouds: 2, windLull: 2, demandSurge: 2 },
      tripUnits: [1, 3], // how many units of one technology trip together
      clouds: { factor: 0.4, durationMin: 60 },
      windLull: { factor: 0.35, durationMin: 90, rampMin: 30 },
      demandSurge: { factor: 1.05, durationMin: 120, rampMin: 30 },
    },
  },

  // Automatic control of storage, demand response and gas-peaker backup.
  auto: {
    freqGainPerHz: 0.05, // extra response per Hz of deviation, as a share of demand
    startThresholdPct: 5, // start an offline storage unit when the need exceeds this % of its size
    hydroPaceFactor: 2, // auto hydro may run at up to this × the rate that spreads its water evenly over the rest of the day
  },

  difficulties: {
    easy: { assist: true, forecastErrorPct: 0, accidents: 'none', autoStorage: true, autoBackup: true, autoFollow: false, autoRenewables: false },
    normal: { assist: false, forecastErrorPct: 0, accidents: 'scheduled', autoStorage: false, autoBackup: false, autoFollow: false, autoRenewables: false },
    hard: { assist: false, forecastErrorPct: 3, accidents: 'both', autoStorage: false, autoBackup: false, autoFollow: false, autoRenewables: false },
  },

  // Overall system cost on the setup screen: capital levelised at a discount rate,
  // shown as a range. Follows the Taiwan PyPSA-Earth model's sandbox
  // (pypsa_tw/sandbox/levers.py): investment ±30%, discount rate 5–10%, base 7.1%.
  economics: {
    discountRatePct: 7.1,
    discountRateRangePct: [5, 10],
    investmentSpreadPct: 30,
    eurToTwd: 36.185, // Bank of Taiwan rate used by the model's dashboard (2026-09-24)
    windOffshoreShare: 0.8, // custom mix: share of wind capacity offshore
  },

  // Custom mix: slider limits (GW) and storage hours. Unit sizes come from unit-types.json.
  custom: {
    peakRangeGW: [25, 90],
    defaultScenario: 'taiwan-2025',
    reserveMarginPct: 5, // auto-commitment brings this much spare capacity online at midnight
    techs: [
      { type: 'nuclear', maxGW: 12 },
      { type: 'coal', maxGW: 30 },
      { type: 'gasCcgt', maxGW: 50 },
      { type: 'gasOcgt', maxGW: 15 },
      { type: 'oil', maxGW: 5 },
      { type: 'hydro', maxGW: 3, hours: 7 },
      { type: 'pumpedHydro', maxGW: 10, hours: 6 },
      { type: 'battery', maxGW: 40, hours: 4 },
      { type: 'dsm', maxGW: 8 },
      { type: 'solar', maxGW: 100 },
      { type: 'wind', maxGW: 60 },
    ],
  },

  // Score: three KPIs, each 0–100, weighted into up to maxPoints.
  score: {
    maxPoints: 1000,
    weights: { reliability: 0.5, cost: 0.25, carbon: 0.25 },
    warningWeight: 0.5, // reliability: a minute in the warning band counts half
    shedStagePenalty: 2.5, // reliability points lost per load-shedding stage
    cost: { bestNTDPerKWh: 1.5, worstNTDPerKWh: 4.5 }, // 100 at best, 0 at worst
    carbon: { bestGPerKWh: 0, worstGPerKWh: 900 },
    starThresholds: [600, 750, 850],
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
    co2BarMaxGPerKWh: 1000, // full width of the CO₂-intensity bar (coal alone is ~900 g/kWh)
    costBarMaxNTDPerKWh: 7, // full width of the fuel-cost bar (oil alone is 6.5)
    toastMs: 9000, // how long an event banner stays up (real time)
    logCollapsedCount: 3, // the control-room log shows this many messages until expanded
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
