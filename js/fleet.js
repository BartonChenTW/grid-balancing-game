// Technology-level view and commands (pure). The UI shows one card per
// technology; these functions translate card actions into unit commands and
// summarise a technology's units for display.
import { config as defaultConfig } from './config.js';
import { refresh } from './sim.js';
import {
  canAdjust,
  canCool,
  canStart,
  canStop,
  canWarm,
  coolUnit,
  hasStandby,
  setpointRange,
  setUnitSetpoint,
  startUnit,
  stopUnit,
  warmUnit,
} from './units.js';

function techIndices(state, tech) {
  const list = [];
  state.units.forEach((u, i) => {
    if (u.tech === tech) list.push(i);
  });
  return list;
}

/** Counts, totals and limits of one technology, for its card. */
export function techSummary(state, world, tech) {
  const idx = techIndices(state, tech);
  const type = world.types[state.units[idx[0]].type];
  const s = {
    type: state.units[idx[0]].type,
    count: idx.length,
    online: 0,
    starting: 0, // on the way to online (warming with goal online, or syncing)
    standby: 0,
    warming: 0, // on the way to standby
    stopping: 0,
    offline: 0,
    lockedOut: 0,
    outputMW: 0,
    setpointMW: 0,
    onlineMW: 0, // capacity of units that can produce now
    minMW: 0,
    maxMW: 0,
    availableMW: 0,
    curtailedMW: 0,
    socMWh: 0,
    energyMWh: 0,
    lossMWh: 0,
    efficiency: type.efficiency ?? null,
    budgetMWh: 0,
    activeMin: 0,
    maxActivationMin: 0,
    nextOnlineMin: null, // minutes until the next starting unit is online
    auto: false,
    hasStandby: hasStandby(type),
    alwaysOnline: Boolean(type.alwaysOnline),
  };
  for (const i of idx) {
    const u = state.units[i];
    s.maxMW += u.maxMW;
    s.outputMW += u.outputMW;
    if (u.lockedOut) s.lockedOut++;
    if (u.auto) s.auto = true;
    switch (u.status) {
      case 'online':
        s.online++;
        s.onlineMW += u.maxMW;
        s.setpointMW += u.setpointMW;
        s.minMW += setpointRange(u, type)[0];
        break;
      case 'stopping':
        s.stopping++;
        break;
      case 'standby':
        s.standby++;
        break;
      case 'warming':
        if (u.goal === 'online') s.starting++;
        else s.warming++;
        break;
      case 'starting':
        s.starting++;
        break;
      default:
        s.offline++;
    }
    if (u.status === 'starting' || (u.status === 'warming' && u.goal === 'online')) {
      const left = u.status === 'warming' ? u.timer + (type.syncMin ?? 0) : u.timer;
      s.nextOnlineMin = s.nextOnlineMin === null ? left : Math.min(s.nextOnlineMin, left);
    }
    if (type.variable) {
      s.availableMW += u.availableMW;
      s.curtailedMW += u.curtailedMW;
    }
    if (type.storage) {
      s.socMWh += u.socMWh;
      s.energyMWh += u.energyMWh;
      s.lossMWh += u.lossMWh ?? 0;
    }
    if (type.energyLimited) {
      s.budgetMWh += u.budgetMWh;
      s.energyMWh += u.energyMWh;
    }
    if (type.activationLimited) {
      s.activeMin = Math.max(s.activeMin, u.activeMin);
      s.maxActivationMin = Math.max(s.maxActivationMin, u.maxActivationMin);
    }
  }
  return s;
}

/**
 * Applies one card action to a technology and returns the new state.
 * Actions: 'up' / 'down' (output of all online units by one step),
 * 'onlineUp' / 'onlineDown' (one unit more / fewer online),
 * 'standbyUp' / 'standbyDown' (warm one cold unit / let one cool),
 * 'toggleAuto'.
 */
export function techAction(state, world, tech, action, cfg = defaultConfig) {
  const idx = techIndices(state, tech);
  if (idx.length === 0) return state;
  const units = state.units.slice();
  const type = world.types[units[idx[0]].type];
  const find = (test, order = idx) => order.find((i) => test(units[i]));

  switch (action) {
    case 'up':
    case 'down': {
      const dir = action === 'up' ? 1 : -1;
      for (const i of idx) {
        const u = units[i];
        if (!canAdjust(u) || u.auto) continue;
        const stepMW = (cfg.ui.setpointStepPct / 100) * u.maxMW;
        const base = type.variable ? Math.min(u.setpointMW, u.availableMW) : u.setpointMW;
        units[i] = setUnitSetpoint(u, type, base + dir * stepMW);
      }
      break;
    }
    case 'onlineUp': {
      // Quickest first: cancel a shutdown, sync a standby unit, then a cold start.
      const i =
        find((u) => u.status === 'stopping') ??
        find((u) => u.status === 'standby') ??
        find((u) => u.status === 'warming' && u.goal !== 'online') ??
        find((u) => u.status === 'offline' && canStart(u, type));
      if (i !== undefined) units[i] = startUnit(units[i], type);
      break;
    }
    case 'onlineDown': {
      // Cancel a start first; otherwise take the least-loaded online unit off.
      const starting = find((u) => u.status === 'starting') ?? find((u) => u.status === 'warming' && u.goal === 'online');
      if (starting !== undefined) {
        const u = units[starting];
        units[starting] = u.status === 'warming' ? { ...u, goal: 'standby' } : stopUnit(u, type);
        break;
      }
      const online = idx.filter((i) => canStop(units[i], type)).sort((a, b) => units[a].outputMW - units[b].outputMW);
      if (online.length) units[online[0]] = stopUnit(units[online[0]], type, 'standby');
      break;
    }
    case 'standbyUp': {
      const i = find((u) => canWarm(u, type));
      if (i !== undefined) units[i] = warmUnit(units[i], type);
      break;
    }
    case 'standbyDown': {
      const i = find((u) => u.status === 'warming' && u.goal === 'standby') ?? find((u) => canCool(u));
      if (i !== undefined) units[i] = coolUnit(units[i]);
      break;
    }
    case 'toggleAuto': {
      if (!type.autoCapable) break;
      const on = !units[idx[0]].auto;
      for (const i of idx) units[i] = { ...units[i], auto: on };
      break;
    }
    default:
      return state;
  }
  return refresh({ ...state, units }, world, cfg);
}

/** Whether a card action would do anything right now (to enable/disable buttons). */
export function canTechAction(state, world, tech, action) {
  const idx = techIndices(state, tech);
  const type = world.types[state.units[idx[0]].type];
  const units = idx.map((i) => state.units[i]);
  switch (action) {
    case 'up':
      return units.some((u) => canAdjust(u) && !u.auto && (type.variable ? Math.min(u.setpointMW, u.availableMW) : u.setpointMW) < setpointRange(u, type)[1] - 0.5);
    case 'down':
      return units.some((u) => canAdjust(u) && !u.auto && (type.variable ? Math.min(u.setpointMW, u.availableMW) : u.setpointMW) > setpointRange(u, type)[0] + 0.5);
    case 'onlineUp':
      return units.some((u) => canStart(u, type));
    case 'onlineDown':
      return units.some((u) => canStop(u, type) || (u.status === 'warming' && u.goal === 'online'));
    case 'standbyUp':
      return units.some((u) => canWarm(u, type));
    case 'standbyDown':
      return units.some((u) => canCool(u));
    case 'toggleAuto':
      return Boolean(type.autoCapable);
    default:
      return false;
  }
}
