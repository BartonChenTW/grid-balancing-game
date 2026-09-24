// A simple scripted operator used by tests and tools/balance-report.js to
// check that every scenario × day is winnable. It plays like a careful
// beginner: follow the load with thermal units, start slow units ahead of
// forecast peaks, use storage and demand response for the gaps, and curtail
// renewables only when nothing else can absorb a surplus.
import { forecastLoad, forecastVariable, setSetpoint, startCommand, stopCommand } from '../js/sim.js';
import { canStart, clamp, setpointRange } from '../js/units.js';

const isThermal = (type) =>
  type.dispatchable && !type.storage && !type.activationLimited && !type.energyLimited;

function netForecast(world, minute, cfg, state) {
  return (
    forecastLoad(world, minute, cfg) -
    forecastVariable(world, 'solar', minute, cfg, state) -
    forecastVariable(world, 'wind', minute, cfg, state)
  );
}

function maxNet(world, from, to, cfg, state) {
  let max = -Infinity;
  for (let m = from; m <= to; m += 10) max = Math.max(max, netForecast(world, m, cfg, state));
  return max;
}

function minNet(world, from, to, cfg, state) {
  let min = Infinity;
  for (let m = from; m <= to; m += 10) min = Math.min(min, netForecast(world, m, cfg, state));
  return min;
}

/** Output range a non-thermal unit can actually deliver now (storage limited by its charge). */
function deliverable(u, type, cfg) {
  let [a, b] = setpointRange(u, type);
  const hours = cfg.time.stepMinutes / 60;
  if (type.storage) {
    b = Math.min(b, u.socMWh / hours);
    a = Math.max(a, -(u.energyMWh - u.socMWh) / ((type.efficiency ?? 1) * hours));
  }
  if (type.energyLimited && u.budgetMWh <= 0) b = 0;
  if (type.activationLimited && u.activeMin >= u.maxActivationMin) b = 0;
  return [Math.min(a, b), b];
}

/** Returns the new state after the operator's decisions for this minute. */
export function autopilot(state, world, cfg) {
  const { types } = world;
  const t = state.minute;
  let s = state;

  // ---- Commitment: start slow units early enough for the coming peak.
  const flexPower = s.units.reduce((sum, u) => {
    const type = types[u.type];
    if (u.status !== 'online') return sum;
    if (type.storage && u.socMWh > u.energyMWh * 0.2) return sum + u.maxMW * 0.8;
    if (type.energyLimited) return sum + u.maxMW * 0.5;
    return sum;
  }, 0);
  const thermalCap = s.units.reduce((sum, u) => {
    const type = types[u.type];
    return isThermal(type) && (u.status === 'online' || u.status === 'starting') ? sum + u.maxMW : sum;
  }, 0);
  // Cheapest first; within a technology, warm standby units before cold ones.
  const candidates = s.units
    .map((u, i) => ({ u, i, type: types[u.type] }))
    .filter(({ u, type }) => isThermal(type) && canStart(u, type) && (u.status === 'offline' || u.status === 'standby'))
    .sort((a, b) => a.type.costPerMWh - b.type.costPerMWh || (a.u.status === 'standby' ? -1 : 0) - (b.u.status === 'standby' ? -1 : 0));
  let planned = thermalCap;
  const needByLead = new Map();
  for (const c of candidates) {
    const lead = c.u.status === 'standby' ? c.type.syncMin : c.type.startupMin + (c.type.syncMin ?? 0);
    if (!needByLead.has(lead)) needByLead.set(lead, maxNet(world, t, Math.min(t + lead + 60, 1439), cfg, s) * 1.08);
    const need = needByLead.get(lead);
    if (need > planned + flexPower) {
      s = startCommand(s, world, c.i, cfg);
      planned += c.u.maxMW;
    }
  }

  // ---- Decommitment: stop the most expensive thermal unit when its minimum output causes a surplus.
  const onlineThermal = s.units
    .map((u, i) => ({ u, i, type: types[u.type] }))
    .filter(({ u, type }) => isThermal(type) && !type.mustRun && u.status === 'online')
    .sort((a, b) => b.type.costPerMWh - a.type.costPerMWh);
  if (onlineThermal.length > 1) {
    const mins = s.units.reduce((sum, u) => {
      const type = types[u.type];
      return u.status === 'online' && isThermal(type) ? sum + setpointRange(u, type)[0] : sum;
    }, 0);
    const lowAhead = minNet(world, t, Math.min(t + 90, 1439), cfg, s);
    const worst = onlineThermal[0];
    const highAhead = maxNet(world, t, Math.min(t + (worst.type.syncMin ?? worst.type.startupMin) + 120, 1439), cfg, s) * 1.08;
    if (mins > lowAhead + 0.3 * flexPower && thermalCap - worst.u.maxMW + flexPower > highAhead) {
      s = stopCommand(s, world, worst.i, cfg);
    }
  }

  // ---- Dispatch: share the expected demand across online units.
  const ahead = forecastLoad(world, Math.min(t + 10, 1439), cfg) - forecastLoad(world, t, cfg);
  let target = s.servedLoadMW + ahead + (cfg.frequency.nominalHz - s.frequencyHz) * 0.05 * s.servedLoadMW;
  for (const u of s.units) if (types[u.type].variable) target -= u.availableMW;

  const thermal = [];
  const reserves = [];
  s.units.forEach((u, i) => {
    const type = types[u.type];
    if (u.status !== 'online' || type.variable) return;
    if (isThermal(type)) thermal.push({ u, i, type });
    else reserves.push({ u, i, type });
  });
  // Reachable output range this minute, given ramp limits.
  const reach = (x) => {
    const [a, b] = setpointRange(x.u, x.type);
    const ramp = (x.type.rampPctPerMin * x.u.maxMW) / 100;
    return [Math.max(Math.min(a, x.u.outputMW), x.u.outputMW - ramp), Math.min(b, x.u.outputMW + ramp)];
  };
  // Minimum output of reserves (e.g. hydro minimum load) is already coming.
  for (const x of reserves) target -= Math.max(0, deliverable(x.u, x.type, cfg)[0]);
  let lo = 0;
  let hi = 0;
  for (const x of thermal) {
    const [a, b] = reach(x);
    lo += a;
    hi += b;
  }
  const share = hi > lo ? clamp((target - lo) / (hi - lo), 0, 1) : 0;
  for (const x of thermal) {
    const [a, b] = reach(x);
    s = setSetpoint(s, world, x.i, a + share * (b - a), cfg);
  }

  // Remaining gap: storage, hydro, demand response (positive = need more).
  let gap = target - clamp(target, lo, hi);
  reserves.sort((a, b) => a.type.costPerMWh - b.type.costPerMWh);
  for (const x of reserves) {
    const [a, b] = deliverable(x.u, x.type, cfg);
    const floor = Math.max(0, a);
    const mw = clamp(gap + floor, a, b);
    s = setSetpoint(s, world, x.i, mw, cfg);
    gap -= mw - floor;
  }
  // Start storage and demand response that are offline if there is still a gap.
  if (Math.abs(gap) > 0) {
    s.units.forEach((u, i) => {
      const type = types[u.type];
      if (!isThermal(type) && !type.variable && canStart(u, type) && u.status === 'offline') {
        if (gap > 0 || type.storage) s = startCommand(s, world, i, cfg);
      }
    });
  }

  // Surplus left over: curtail renewables.
  const surplus = -gap;
  s.units.forEach((u, i) => {
    const type = types[u.type];
    if (!type.variable) return;
    const cap = surplus > 0 ? Math.max(0, u.availableMW - surplus * (u.availableMW / Math.max(1, sumAvailable(s, types)))) : u.maxMW;
    s = setSetpoint(s, world, i, cap, cfg);
  });

  return s;
}

function sumAvailable(s, types) {
  return s.units.reduce((sum, u) => sum + (types[u.type].variable ? u.availableMW : 0), 0);
}
