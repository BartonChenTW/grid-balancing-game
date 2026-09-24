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
    // while dampingPerMin * stepMinutes / substeps is well below 1).
    substeps: 10,
    // Floor on stored kinetic energy so a grid with no synchronous machines
    // online does not divide by zero.
    minKineticMWs: 100,
  },

  bands: {
    normalLowHz: 59.8,
    normalHighHz: 60.2,
    warningLowHz: 59.5, // below this: under-frequency load shedding (M4)
    warningHighHz: 60.5,
    blackoutLowHz: 58.5,
    blackoutHighHz: 61.5,
  },

  load: {
    // Load noise is a smoothed random walk (AR(1)) around the profile.
    noiseStdPct: 0.4, // long-run standard deviation, % of load
    noisePersistence: 0.9, // 0 = white noise, closer to 1 = slower wander
  },

  ui: {
    setpointStepPct: 5, // one +/− press moves the setpoint by 5% of unit max
  },
};
