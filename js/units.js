// Per-unit rules (pure, no DOM): the state machine
//   offline → starting → online → stopping → offline
// plus ramping, minimum stable load, storage, energy and activation limits,
// and renewable curtailment. Unit type parameters come from
// data/unit-types.json and are passed in as `type`.
//
// Simplifications, for educators:
// - A unit that finishes starting is synchronised at 0 MW and then ramps up
//   to its minimum stable load; it cannot be turned down below it while online.
// - Storage losses are applied on charging only (round-trip efficiency).
// - A trip removes capacity instantly; tripped capacity can be restarted.

export function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
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

export function canStart(unit, type) {
  return !type.alwaysOnline && !unit.lockedOut && (unit.status === 'offline' || unit.status === 'stopping');
}

export function canStop(unit, type) {
  return !type.alwaysOnline && (unit.status === 'online' || unit.status === 'starting');
}

export function canAdjust(unit) {
  return unit.status === 'online';
}

/** Builds a unit's runtime state from its scenario entry. Output starts at 0; sim.js sets the initial dispatch. */
export function createUnit(spec, type) {
  const online = type.alwaysOnline || spec.initialState === 'online';
  const unit = {
    name: spec.name,
    type: spec.type,
    maxMW: spec.maxMW,
    status: online ? 'online' : 'offline',
    timer: 0,
    setpointMW: 0,
    outputMW: 0,
    lockedOut: false,
    starts: 0,
  };
  if (type.variable) {
    unit.setpointMW = spec.maxMW; // no curtailment
    unit.availableMW = 0;
    unit.curtailedMW = 0;
  }
  if (type.storage) {
    unit.energyMWh = spec.energyMWh;
    unit.socMWh = spec.energyMWh * ((spec.initialSocPct ?? 50) / 100);
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

export function startUnit(unit, type) {
  if (!canStart(unit, type)) return unit;
  if (unit.status === 'stopping') {
    // Cancel the shutdown: stay synchronised and hold current output.
    const [lo, hi] = setpointRange(unit, type);
    return { ...unit, status: 'online', setpointMW: clamp(unit.outputMW, lo, hi) };
  }
  if (type.startupMin <= 0) return goOnline({ ...unit, starts: unit.starts + 1 }, type);
  return { ...unit, status: 'starting', timer: type.startupMin, starts: unit.starts + 1 };
}

export function stopUnit(unit, type) {
  if (!canStop(unit, type)) return unit;
  if (unit.status === 'starting') return { ...unit, status: 'offline', timer: 0 };
  return { ...unit, status: 'stopping', setpointMW: 0 };
}

function goOnline(unit, type) {
  const [lo] = setpointRange(unit, type);
  return { ...unit, status: 'online', timer: 0, outputMW: 0, setpointMW: lo };
}

export function setUnitSetpoint(unit, type, setpointMW) {
  if (!canAdjust(unit)) return unit;
  const [lo, hi] = setpointRange(unit, type);
  return { ...unit, setpointMW: clamp(setpointMW, lo, hi) };
}

/**
 * Removes `fraction` of the unit's capacity instantly (1 = the whole block).
 * A fully tripped unit goes offline and must be restarted.
 */
export function tripUnit(unit, fraction = 1) {
  if (fraction >= 1) {
    return { ...unit, status: 'offline', timer: 0, outputMW: 0, setpointMW: 0 };
  }
  const keep = 1 - fraction;
  return {
    ...unit,
    maxMW: unit.maxMW * keep,
    outputMW: unit.outputMW * keep,
    setpointMW: unit.setpointMW * keep,
  };
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

  if (unit.status === 'offline') return unit.outputMW === 0 ? unit : { ...unit, outputMW: 0 };

  if (unit.status === 'starting') {
    const timer = unit.timer - stepMinutes;
    return timer > 0 ? { ...unit, timer } : goOnline(unit, type);
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
    next.status = 'offline';
    next.outputMW = 0;
    if (type.restartable === false) next.lockedOut = true;
  }
  return next;
}
