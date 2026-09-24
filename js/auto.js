// Automatic control for units the player has put on "Auto" (pure).
//
// needMW is how much the automatic units together should produce this
// minute: positive = supply is short, negative = surplus to absorb.
// Order of use:
//   1. Storage (batteries, pumped hydro): charges or discharges, within its
//      power and state of charge. Offline pumped hydro is started when useful.
//   2. Gas-peaker backup: covers what is still short. Starts more units
//      (standby first, one to spare) when short, and sends one back to
//      standby when a surplus remains while they sit at minimum output.
//      Backup peakers wait on warm standby (see autoCommit) so they respond
//      in minutes.
//   3. Demand response: last resort for a shortfall.
// Automatic units never curtail renewables; surplus beyond storage is left to
// the player.
import { canStart, canStop, clamp, setpointRange, setUnitSetpoint, startUnit, stopUnit } from './units.js';

/** Output range a storage unit can actually deliver this minute, given its charge. */
function storageRange(unit, type, hours) {
  const eff = type.efficiency ?? 1;
  const lo = Math.max(-unit.maxMW, -(unit.energyMWh - unit.socMWh) / (eff * hours));
  const hi = Math.min(unit.maxMW, unit.socMWh / hours);
  return [Math.min(lo, 0), Math.max(hi, 0)];
}

export function autoDispatch(units, types, needMW, cfg) {
  const out = units.slice();
  const hours = cfg.time.stepMinutes / 60;
  const pick = (test) => out.map((_, i) => i).filter((i) => out[i].auto && test(types[out[i].type]));
  let need = needMW;

  // ---- 1. Storage
  const storage = pick((t) => t.storage);
  for (const i of storage) {
    const u = out[i];
    const type = types[u.type];
    if (u.status === 'offline' && canStart(u, type) && Math.abs(need) > (u.maxMW * cfg.auto.startThresholdPct) / 100) {
      out[i] = startUnit(u, type);
    }
  }
  const onlineStorage = storage.filter((i) => out[i].status === 'online');
  if (onlineStorage.length) {
    const ranges = onlineStorage.map((i) => storageRange(out[i], types[out[i].type], hours));
    const lo = ranges.reduce((sum, r) => sum + r[0], 0);
    const hi = ranges.reduce((sum, r) => sum + r[1], 0);
    const target = clamp(need, lo, hi);
    onlineStorage.forEach((i, k) => {
      const [a, b] = ranges[k];
      const mw = target >= 0 ? (hi > 0 ? (b / hi) * target : 0) : (lo < 0 ? (a / lo) * target : 0);
      out[i] = setUnitSetpoint(out[i], types[out[i].type], mw);
    });
    need -= target;
  }

  // ---- 2. Gas-peaker backup
  const peakers = pick((t) => !t.storage && !t.activationLimited);
  if (peakers.length) {
    const online = peakers.filter((i) => out[i].status === 'online');
    let lo = 0;
    let hi = 0;
    for (const i of online) {
      const [a, b] = setpointRange(out[i], types[out[i].type]);
      lo += a;
      hi += b;
    }
    const target = online.length ? clamp(need, lo, hi) : 0;
    const share = hi > lo ? (target - lo) / (hi - lo) : 0;
    for (const i of online) {
      const [a, b] = setpointRange(out[i], types[out[i].type]);
      out[i] = setUnitSetpoint(out[i], types[out[i].type], a + share * (b - a));
    }
    need -= target;

    const coming = peakers.filter((i) => out[i].status === 'starting' || (out[i].status === 'warming' && out[i].goal === 'online'));
    let comingMW = coming.reduce((sum, i) => sum + out[i].maxMW, 0);
    const spareMW = peakers.length ? out[peakers[0]].maxMW : 0;
    if (need > 0 && need + spareMW > comingMW) {
      // Short: bring more peakers online, quickest first, with one unit to spare.
      const rank = { stopping: 0, standby: 1, warming: 2, offline: 3 };
      const candidates = peakers
        .filter((i) => canStart(out[i], types[out[i].type]))
        .sort((a, b) => rank[out[a].status] - rank[out[b].status]);
      for (const i of candidates) {
        if (need + spareMW <= comingMW) break;
        out[i] = startUnit(out[i], types[out[i].type]);
        comingMW += out[i].maxMW;
      }
    } else if (need < 0 && online.length && target <= lo) {
      // Surplus while every peaker sits at minimum: send one back to standby.
      const idle = online
        .filter((i) => canStop(out[i], types[out[i].type]))
        .sort((a, b) => out[a].outputMW - out[b].outputMW)[0];
      if (idle !== undefined && -need >= setpointRange(out[idle], types[out[idle].type])[0]) {
        out[idle] = stopUnit(out[idle], types[out[idle].type], 'standby');
      }
    }
  }

  // ---- 3. Demand response
  for (const i of pick((t) => t.activationLimited)) {
    const u = out[i];
    const type = types[u.type];
    if (need > 0) {
      if (u.status === 'offline' && canStart(u, type)) out[i] = startUnit(u, type);
      else if (u.status === 'online') {
        const mw = clamp(need, 0, u.maxMW);
        out[i] = setUnitSetpoint(u, type, mw);
        need -= mw;
      }
    } else if (u.status === 'online' && u.setpointMW > 0) {
      out[i] = setUnitSetpoint(u, type, 0);
    }
  }
  return out;
}
