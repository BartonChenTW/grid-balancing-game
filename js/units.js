// Unit type definitions and per-unit update rules (pure, no DOM).
//
// M1 ships only the three types of the mini scenario, and every unit is
// always online. M2 adds the remaining types, the
// offline → starting → online → stopping state machine, and moves these
// definitions to data/unit-types.json.

export const UNIT_TYPES = {
  coal: {
    rampPctPerMin: 1.5,
    minStablePct: 40,
    inertiaH: 5, // seconds of stored kinetic energy per MW of rating
    costPerMWh: 60,
    co2PerMWh: 0.9,
  },
  gasOcgt: {
    rampPctPerMin: 15,
    minStablePct: 30,
    inertiaH: 3,
    costPerMWh: 180,
    co2PerMWh: 0.6,
  },
  battery: {
    rampPctPerMin: 100,
    minStablePct: 0,
    inertiaH: 0, // inverter-based: no spinning mass
    costPerMWh: 0,
    co2PerMWh: 0,
    storage: true, // output may be negative (charging); limited by state of charge
  },
};

export function unitType(unit) {
  const type = UNIT_TYPES[unit.type];
  if (!type) throw new Error(`Unknown unit type "${unit.type}" for unit "${unit.name}"`);
  return type;
}

export function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

/** Allowed setpoint range in MW: [min stable, max], or [−max, max] for storage. */
export function setpointRange(unit) {
  const type = unitType(unit);
  if (type.storage) return [-unit.maxMW, unit.maxMW];
  return [(type.minStablePct / 100) * unit.maxMW, unit.maxMW];
}

/** Builds a unit's runtime state from its scenario entry. */
export function createUnit(spec) {
  const type = unitType(spec);
  const [lo, hi] = setpointRange(spec);
  const outputMW = clamp(((spec.initialPct ?? 0) / 100) * spec.maxMW, lo, hi);
  const unit = { name: spec.name, type: spec.type, maxMW: spec.maxMW, setpointMW: outputMW, outputMW };
  if (type.storage) {
    unit.energyMWh = spec.energyMWh;
    unit.socMWh = spec.energyMWh * ((spec.initialSocPct ?? 50) / 100);
  }
  return unit;
}

/**
 * Moves output towards the setpoint, at most rampPctPerMin of max per minute.
 * Storage output is further limited so the state of charge stays within
 * [0, energyMWh]. Batteries are lossless for now.
 */
export function rampUnit(unit, stepMinutes) {
  const type = unitType(unit);
  const maxDelta = (type.rampPctPerMin / 100) * unit.maxMW * stepMinutes;
  let outputMW = unit.outputMW + clamp(unit.setpointMW - unit.outputMW, -maxDelta, maxDelta);
  if (!type.storage) return { ...unit, outputMW };

  const hours = stepMinutes / 60;
  outputMW = clamp(outputMW, (unit.socMWh - unit.energyMWh) / hours, unit.socMWh / hours);
  const socMWh = clamp(unit.socMWh - outputMW * hours, 0, unit.energyMWh);
  return { ...unit, outputMW, socMWh };
}
