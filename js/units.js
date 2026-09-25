// Per-unit rules (pure, no DOM). One unit is one generating unit; a
// technology's fleet (e.g. 27 coal units) is a list of identical units.
//
// State machine:
//   offline ──warm up (startupMin)──▶ standby ──sync (syncMin)──▶ online
//      ▲                                 ▲                          │
//      └──────── cool down ──────────────┴──── stopping (ramp) ◀────┘
// Types without syncMin have no standby: offline ──startupMin──▶ online.
// A cold start straight to online passes through warming and starting.
//
// Simplifications, for educators:
// - A unit that finishes starting is synchronised at 0 MW and then ramps up
//   to its minimum stable load; it cannot be turned down below it while online.
// - Standby means "kept warm": no output and no inertia, but a short start.
// - Storage losses are applied on charging only (round-trip efficiency).
// - A trip disconnects the whole unit instantly; it can be restarted.

export function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

export function hasStandby(type) {
  return (type.syncMin ?? 0) > 0;
}

/** Allowed setpoint range in MW for an online unit. */
export function setpointRange(unit, type) {
  if (type.storage) return [-unit.maxMW, unit.maxMW];
  if (type.variable || type.activationLimited) return [0, unit.maxMW];
  return [(type.minStablePct / 100) * unit.maxMW, unit.maxMW];
}

/** Spinning and synchronised with the grid (contributes inertia and output). */
export function isSynchronised(unit) {
  return unit.status === 'online' || unit.status === 'stopping';
}

/** Can be told to come online (from offline, warming, standby, or cancelling a stop). */
export function canStart(unit, type) {
  if (type.alwaysOnline || unit.lockedOut) return false;
  if (unit.status === 'warming') return unit.goal !== 'online';
  return unit.status === 'offline' || unit.status === 'standby' || unit.status === 'stopping';
}

export function canStop(unit, type) {
  return !type.alwaysOnline && (unit.status === 'online' || unit.status === 'starting');
}

/** Can be warmed from offline to standby. */
export function canWarm(unit, type) {
  return hasStandby(type) && !unit.lockedOut && unit.status === 'offline';
}

/** Can be let go from standby (or warming towards standby) to offline. */
export function canCool(unit) {
  return unit.status === 'standby' || (unit.status === 'warming' && unit.goal === 'standby');
}

export function canAdjust(unit) {
  return unit.status === 'online';
}

/** Builds a unit's runtime state from its (expanded) scenario entry. Output starts at 0; sim.js sets the initial dispatch. */
export function createUnit(spec, type) {
  let status = 'offline';
  if (type.alwaysOnline || spec.initialState === 'online') status = 'online';
  else if (spec.initialState === 'standby' && hasStandby(type)) status = 'standby';
  const unit = {
    name: spec.name,
    type: spec.type,
    tech: spec.tech ?? 0,
    maxMW: spec.maxMW,
    status,
    timer: 0,
    goal: null,
    stopTo: null,
    setpointMW: 0,
    outputMW: 0,
    lockedOut: false,
    starts: 0,
    auto: Boolean(spec.auto && type.autoCapable),
  };
  if (type.variable) {
    unit.setpointMW = spec.maxMW; // no curtailment
    unit.availableMW = 0;
    unit.curtailedMW = 0;
  }
  if (type.storage) {
    unit.energyMWh = spec.energyMWh;
    unit.socMWh = spec.energyMWh * ((spec.initialSocPct ?? 50) / 100);
    unit.lossMWh = 0; // energy lost to round-trip inefficiency so far today
  }
  if (type.energyLimited) {
    unit.energyMWh = spec.energyMWh; // daily water budget
    unit.budgetMWh = spec.energyMWh;
  }
  if (type.activationLimited) {
    unit.maxActivationMin = spec.maxActivationMin ?? 240;
    unit.activeMin = 0;
  }
  return unit;
}

function goOnline(unit, type) {
  const [lo] = setpointRange(unit, type);
  return { ...unit, status: 'online', timer: 0, goal: null, outputMW: 0, setpointMW: lo };
}

/** Bring a unit online: cold start, sync from standby, or cancel a shutdown. */
export function startUnit(unit, type) {
  if (!canStart(unit, type)) return unit;
  switch (unit.status) {
    case 'stopping': {
      const [lo, hi] = setpointRange(unit, type);
      return { ...unit, status: 'online', stopTo: null, setpointMW: clamp(unit.outputMW, lo, hi) };
    }
    case 'warming':
      return { ...unit, goal: 'online' };
    case 'standby':
      return { ...unit, status: 'starting', timer: type.syncMin, starts: unit.starts + 1 };
    default: {
      const started = { ...unit, starts: unit.starts + 1 };
      if (hasStandby(type)) return { ...started, status: 'warming', timer: type.startupMin, goal: 'online' };
      if (type.startupMin <= 0) return goOnline(started, type);
      return { ...started, status: 'starting', timer: type.startupMin };
    }
  }
}

/** Warm a cold unit up to standby. */
export function warmUnit(unit, type) {
  if (!canWarm(unit, type)) return unit;
  return { ...unit, status: 'warming', timer: type.startupMin, goal: 'standby' };
}

/** Let a standby (or warming) unit cool to offline. */
export function coolUnit(unit) {
  if (!canCool(unit)) return unit;
  return { ...unit, status: 'offline', timer: 0, goal: null };
}

/**
 * Take a unit off the grid. An online unit ramps down, then goes to standby
 * (or offline if the type has no standby, or `to` is 'offline').
 * A unit still starting goes back where it came from.
 */
export function stopUnit(unit, type, to = 'standby') {
  if (!canStop(unit, type)) return unit;
  if (unit.status === 'starting') {
    return { ...unit, status: hasStandby(type) ? 'standby' : 'offline', timer: 0, goal: null };
  }
  return { ...unit, status: 'stopping', setpointMW: 0, stopTo: hasStandby(type) ? to : 'offline' };
}

export function setUnitSetpoint(unit, type, setpointMW) {
  if (!canAdjust(unit)) return unit;
  const [lo, hi] = setpointRange(unit, type);
  return { ...unit, setpointMW: clamp(setpointMW, lo, hi) };
}

/** A fault disconnects the unit instantly. */
export function tripUnit(unit) {
  return { ...unit, status: 'offline', timer: 0, goal: null, stopTo: null, outputMW: 0, setpointMW: 0 };
}

/**
 * Advances one unit by one step.
 * ctx: { stepMinutes, availableMW } (availableMW only for variable renewables).
 */
export function updateUnit(unit, type, ctx) {
  const { stepMinutes } = ctx;
  const hours = stepMinutes / 60;

  if (type.variable) {
    const outputMW = Math.min(ctx.availableMW, unit.setpointMW);
    return { ...unit, availableMW: ctx.availableMW, outputMW, curtailedMW: ctx.availableMW - outputMW };
  }

  switch (unit.status) {
    case 'offline':
    case 'standby':
      return unit.outputMW === 0 ? unit : { ...unit, outputMW: 0 };
    case 'warming': {
      const timer = unit.timer - stepMinutes;
      if (timer > 0) return { ...unit, timer };
      if (unit.goal === 'online') return { ...unit, status: 'starting', timer: type.syncMin, goal: null };
      return { ...unit, status: 'standby', timer: 0, goal: null };
    }
    case 'starting': {
      const timer = unit.timer - stepMinutes;
      return timer > 0 ? { ...unit, timer } : goOnline(unit, type);
    }
    default:
      break;
  }

  // Online or stopping: ramp towards the setpoint.
  let rampMW = (type.rampPctPerMin / 100) * unit.maxMW * stepMinutes;
  let target = unit.setpointMW;
  if (unit.status === 'stopping') {
    target = 0;
    if (type.shutdownMin > 0) {
      rampMW = Math.max(rampMW, ((type.minStablePct / 100) * unit.maxMW * stepMinutes) / type.shutdownMin);
    }
  }
  let outputMW = unit.outputMW + clamp(target - unit.outputMW, -rampMW, rampMW);
  const next = { ...unit };

  if (type.storage) {
    // Charging stores only `efficiency` of the energy drawn from the grid.
    const eff = type.efficiency ?? 1;
    outputMW = clamp(outputMW, (unit.socMWh - unit.energyMWh) / (eff * hours), unit.socMWh / hours);
    const storedMWh = outputMW >= 0 ? -outputMW * hours : -outputMW * eff * hours;
    next.socMWh = clamp(unit.socMWh + storedMWh, 0, unit.energyMWh);
    if (outputMW < 0) next.lossMWh = (unit.lossMWh ?? 0) - outputMW * (1 - eff) * hours;
  }

  if (type.energyLimited) {
    outputMW = Math.min(outputMW, unit.budgetMWh / hours);
    next.budgetMWh = Math.max(0, unit.budgetMWh - Math.max(outputMW, 0) * hours);
  }

  if (type.activationLimited) {
    if (unit.activeMin >= unit.maxActivationMin) {
      outputMW = 0;
      next.setpointMW = 0;
    } else if (outputMW > 0) {
      next.activeMin = unit.activeMin + stepMinutes;
    }
  }

  next.outputMW = outputMW;
  if (unit.status === 'stopping' && outputMW <= 0) {
    next.outputMW = 0;
    next.status = unit.stopTo === 'standby' ? 'standby' : 'offline';
    next.stopTo = null;
    if (type.restartable === false) next.lockedOut = true;
  }
  return next;
}
