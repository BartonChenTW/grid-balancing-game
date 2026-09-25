// Automatic control for units the player has put on "Auto" (pure).
//
// needMW is how much the automatic units together should produce this
// minute: positive = supply is short, negative = surplus to absorb.
// Order of use:
//   A. Solar and wind (role "curtail") are counted at their full available
//      output first: they cost nothing.
//   0. Load following (nuclear, coal, gas CCGT; role "follow"): online units
//      move their output towards the need, as far as their ramp rate allows
//      this minute, and never below minimum stable load.
//   1. Hydro (role "hydro"): covers a shortfall, paced so the day's water
//      lasts until midnight.
//   2. Storage (batteries, pumped hydro): charges or discharges, within its
//      power and state of charge. Offline pumped hydro is started when useful.
//   3. Backup (gas peakers, oil; role "backup"): covers what is still short.
//      Starts more units (standby first, cheapest first, one to spare) when
//      short, and sends one back to standby when a surplus remains while they
//      sit at minimum output. Backup units wait on warm standby (see
//      autoCommit) so they respond in minutes.
//   4. Demand response: last resort for a shortfall.
//   B. A surplus left after all that is curtailed from solar and wind; with
//      no surplus they run at full output again.
// Only backup units, pumped hydro, hydro and demand response are started or
// stopped automatically; how many thermal units are online stays with the
// player.
import { canStart, canStop, clamp, setpointRange, setUnitSetpoint, startUnit, stopUnit } from './units.js';

/** Output range a storage unit can actually deliver this minute, given its charge. */
function storageRange(unit, type, hours) {
  const eff = type.efficiency ?? 1;
  const lo = Math.max(-unit.maxMW, -(unit.energyMWh - unit.socMWh) / (eff * hours));
  const hi = Math.min(unit.maxMW, unit.socMWh / hours);
  return [Math.min(lo, 0), Math.max(hi, 0)];
}

/** Shares `need` over units with ranges [lo_i, hi_i] in proportion to each range; returns the total set. */
function share(out, types, indices, ranges, need) {
  const lo = ranges.reduce((sum, r) => sum + r[0], 0);
  const hi = ranges.reduce((sum, r) => sum + r[1], 0);
  const target = clamp(need, lo, hi);
  const f = hi > lo ? (target - lo) / (hi - lo) : 0;
  indices.forEach((i, k) => {
    const [a, b] = ranges[k];
    out[i] = setUnitSetpoint(out[i], types[out[i].type], a + f * (b - a));
  });
  return target;
}

/**
 * minute: the current time of day (for pacing hydro's daily water).
 */
export function autoDispatch(units, types, needMW, cfg, minute = 0) {
  const out = units.slice();
  const hours = cfg.time.stepMinutes / 60;
  const pick = (test) => out.map((_, i) => i).filter((i) => out[i].auto && test(types[out[i].type]));
  let need = needMW;

  // ---- A. Solar and wind first, at full available output
  const renewables = pick((t) => t.autoRole === 'curtail');
  let renewableMW = 0;
  for (const i of renewables) renewableMW += out[i].availableMW ?? 0;
  need -= renewableMW;

  // ---- 0. Load following
  const followers = pick((t) => t.autoRole === 'follow').filter((i) => out[i].status === 'online');
  if (followers.length) {
    // Output each unit can reach this minute, given its ramp rate and limits
    // (a unit still ramping up to minimum load counts at what it can reach).
    const reach = followers.map((i) => {
      const u = out[i];
      const type = types[u.type];
      const [lo, hi] = setpointRange(u, type);
      const ramp = (type.rampPctPerMin / 100) * u.maxMW * cfg.time.stepMinutes;
      return [Math.max(Math.min(lo, u.outputMW), u.outputMW - ramp), Math.min(hi, u.outputMW + ramp)];
    });
    need -= share(out, types, followers, reach, need);
  }

  // ---- 1. Hydro, paced so the water lasts the day
  const hydro = pick((t) => t.autoRole === 'hydro');
  for (const i of hydro) {
    if (out[i].status === 'offline' && need > 0 && canStart(out[i], types[out[i].type])) out[i] = startUnit(out[i], types[out[i].type]);
  }
  const onlineHydro = hydro.filter((i) => out[i].status === 'online');
  if (onlineHydro.length) {
    const hoursLeft = Math.max(1, (cfg.time.dayMinutes - minute) / 60);
    const ranges = onlineHydro.map((i) => {
      const u = out[i];
      const [lo, hi] = setpointRange(u, types[u.type]);
      const paced = (u.budgetMWh / hoursLeft) * cfg.auto.hydroPaceFactor;
      return [lo, Math.max(lo, Math.min(hi, paced))];
    });
    need -= share(out, types, onlineHydro, ranges, need);
  }

  // ---- 2. Storage
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

  // ---- 3. Backup: gas peakers and oil
  const backups = pick((t) => t.autoRole === 'backup');
  if (backups.length) {
    const online = backups.filter((i) => out[i].status === 'online');
    const target = online.length
      ? share(out, types, online, online.map((i) => setpointRange(out[i], types[out[i].type])), need)
      : 0;
    const lo = online.reduce((sum, i) => sum + setpointRange(out[i], types[out[i].type])[0], 0);
    need -= target;

    const coming = backups.filter((i) => out[i].status === 'starting' || (out[i].status === 'warming' && out[i].goal === 'online'));
    let comingMW = coming.reduce((sum, i) => sum + out[i].maxMW, 0);
    const spareMW = Math.min(...backups.map((i) => out[i].maxMW));
    if (need > 0 && need + spareMW > comingMW) {
      // Short: bring more units online, quickest first, then cheapest, with one to spare.
      const rank = { stopping: 0, standby: 1, warming: 2, offline: 3 };
      const candidates = backups
        .filter((i) => canStart(out[i], types[out[i].type]))
        .sort((a, b) => rank[out[a].status] - rank[out[b].status] ||
          types[out[a].type].costPerMWh - types[out[b].type].costPerMWh);
      for (const i of candidates) {
        if (need + spareMW <= comingMW) break;
        out[i] = startUnit(out[i], types[out[i].type]);
        comingMW += out[i].maxMW;
      }
    } else if (need < 0 && online.length && target <= lo) {
      // Surplus while every backup unit sits at minimum: send the most expensive back to standby.
      const idle = online
        .filter((i) => canStop(out[i], types[out[i].type]))
        .sort((a, b) => types[out[b].type].costPerMWh - types[out[a].type].costPerMWh || out[a].outputMW - out[b].outputMW)[0];
      if (idle !== undefined && -need >= setpointRange(out[idle], types[out[idle].type])[0]) {
        out[idle] = stopUnit(out[idle], types[out[idle].type], 'standby');
      }
    }
  }

  // ---- 4. Demand response
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

  // ---- B. Curtail solar and wind only for a surplus nothing else could absorb
  if (renewables.length) {
    const cut = need < 0 ? Math.min(-need, renewableMW) : 0;
    for (const i of renewables) {
      const u = out[i];
      const available = u.availableMW ?? 0;
      const cap = cut > 0 && renewableMW > 0 ? available - cut * (available / renewableMW) : u.maxMW;
      out[i] = setUnitSetpoint(u, types[u.type], cap);
    }
  }
  return out;
}
