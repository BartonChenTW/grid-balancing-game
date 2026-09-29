// Loads and validates game data (unit types, scenarios, day types) and turns
// a chosen scenario + day + options into a `world` for sim.js.
// Validation is pure so it can be tested in Node; only loadGameData fetches.
//
// A scenario lists one entry per technology: its total capacity and how many
// identical units it has. buildWorld expands that into individual units.

import { config as defaultConfig } from './config.js';
import { forecastLoad, profileAt } from './sim.js';

export class DataError extends Error {
  constructor(file, problems) {
    super(`${file}:\n  - ${problems.join('\n  - ')}`);
    this.name = 'DataError';
    this.file = file;
    this.problems = problems;
  }
}

const UNIT_STATES = ['online', 'standby', 'offline'];
export const EVENT_TYPES = ['trip', 'clouds', 'windCutout', 'windLull', 'demandSurge'];
export const ACCIDENT_MODES = ['none', 'scheduled', 'random', 'both'];
const TYPE_NUMBERS = ['startupMin', 'shutdownMin', 'rampPctPerMin', 'minStablePct', 'inertiaH', 'costPerMWh', 'co2PerMWh'];

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

function checkProfile(problems, where, profile, max) {
  if (!Array.isArray(profile) || profile.length < 1) {
    problems.push(`${where} must be a non-empty array of numbers`);
    return;
  }
  if (1440 % profile.length !== 0) problems.push(`${where} has ${profile.length} values; use a length that divides 1440 (24, 48, 96…)`);
  profile.forEach((v, i) => {
    if (!isNum(v) || v < 0 || v > max) problems.push(`${where}[${i}] = ${JSON.stringify(v)} is not a number between 0 and ${max}`);
  });
}

function checkEvents(problems, where, events, techTypes) {
  if (events === undefined) return;
  if (!Array.isArray(events)) {
    problems.push(`${where} must be an array`);
    return;
  }
  events.forEach((e, i) => {
    const at = `${where}[${i}]`;
    if (!isObj(e)) return problems.push(`${at} must be an object`);
    if (!isNum(e.timeMin) || e.timeMin < 0 || e.timeMin >= 1440) problems.push(`${at}.timeMin must be a minute of the day (0–1439)`);
    if (!EVENT_TYPES.includes(e.type)) problems.push(`${at}.type must be one of ${EVENT_TYPES.join(', ')}`);
    if (e.type === 'trip') {
      if (techTypes && !techTypes.includes(e.unitType)) problems.push(`${at}.unitType "${e.unitType}" is not a technology in this scenario`);
      if (e.units !== undefined && (!Number.isInteger(e.units) || e.units < 1)) problems.push(`${at}.units must be a whole number ≥ 1`);
      if (e.lossMW !== undefined && (!isNum(e.lossMW) || e.lossMW <= 0)) problems.push(`${at}.lossMW must be a positive number`);
      if (e.namePrefix !== undefined && (typeof e.namePrefix !== 'string' || !e.namePrefix)) problems.push(`${at}.namePrefix must be a non-empty string`);
    }
    const maxFactor = e.type === 'demandSurge' ? 2 : 1;
    if (e.factor !== undefined && (!isNum(e.factor) || e.factor < 0 || e.factor > maxFactor)) problems.push(`${at}.factor must be between 0 and ${maxFactor}`);
    if (e.durationMin !== undefined && (!isNum(e.durationMin) || e.durationMin <= 0)) problems.push(`${at}.durationMin must be a positive number`);
  });
}

export function validateUnitTypes(types) {
  const problems = [];
  if (!isObj(types)) return ['must be an object mapping type ids to parameters'];
  for (const [id, t] of Object.entries(types)) {
    if (id.startsWith('_')) continue;
    if (!isObj(t)) {
      problems.push(`${id} must be an object`);
      continue;
    }
    for (const key of TYPE_NUMBERS) {
      if (!isNum(t[key]) || t[key] < 0) problems.push(`${id}.${key} must be a number ≥ 0`);
    }
    if (isNum(t.minStablePct) && t.minStablePct > 100) problems.push(`${id}.minStablePct must be ≤ 100`);
    if (t.syncMin !== undefined && (!isNum(t.syncMin) || t.syncMin <= 0)) problems.push(`${id}.syncMin must be a positive number`);
    if (t.storage && (!isNum(t.efficiency) || t.efficiency <= 0 || t.efficiency > 1)) problems.push(`${id}.efficiency must be in (0, 1] for storage`);
    if (t.variable !== undefined && !['solar', 'wind'].includes(t.variable)) problems.push(`${id}.variable must be "solar" or "wind"`);
    for (const key of ['capexEURPerKW', 'capexEURPerKWh', 'capexOffshoreEURPerKW', 'capexSpreadPct']) {
      if (t[key] !== undefined && (!isNum(t[key]) || t[key] < 0)) problems.push(`${id}.${key} must be a number ≥ 0`);
    }
    if ((t.capexEURPerKW || t.capexEURPerKWh) && (!isNum(t.lifeYears) || t.lifeYears <= 0)) problems.push(`${id}.lifeYears must be a positive number when it has a build cost`);
    if (t.fuel !== undefined && !defaultConfig.fuels.includes(t.fuel)) problems.push(`${id}.fuel must be one of ${defaultConfig.fuels.join(', ')}`);
  }
  return problems;
}

/** Types whose fleet is modelled as one unit (no unit count). */
export function singleUnitType(type) {
  return Boolean(type.storage || type.energyLimited || type.activationLimited || type.variable);
}

/**
 * Optional list of real units, e.g. [{ "name": "Taichung 1", "nameZh": "台中 1", "mw": 550 }]:
 * units get these names and sizes instead of `count` equal units.
 */
function checkUnitList(problems, at, u, type) {
  const list = u.unitList;
  if (!Array.isArray(list) || list.length === 0) return problems.push(`${at}.unitList must be a non-empty array`);
  if (type && singleUnitType(type)) problems.push(`${at}.unitList is not allowed for ${u.type}`);
  list.forEach((x, k) => {
    if (!isObj(x) || typeof x.name !== 'string' || !x.name) problems.push(`${at}.unitList[${k}].name must be a non-empty string`);
    else if (x.nameZh !== undefined && (typeof x.nameZh !== 'string' || !x.nameZh)) problems.push(`${at}.unitList[${k}].nameZh must be a non-empty string`);
    if (!isObj(x) || !isNum(x.mw) || x.mw <= 0) problems.push(`${at}.unitList[${k}].mw must be a positive number`);
  });
  if (u.count !== undefined && u.count !== list.length) problems.push(`${at}.count must equal the length of unitList (${list.length})`);
  const sum = list.reduce((a, x) => a + (isNum(x?.mw) ? x.mw : 0), 0);
  if (isNum(u.maxMW) && Math.abs(sum - u.maxMW) > 1) problems.push(`${at}.maxMW (${u.maxMW}) must equal the sum of unitList (${Math.round(sum)})`);
}

export function validateScenario(s, types) {
  const problems = [];
  if (!isObj(s)) return ['must be a JSON object'];
  for (const key of ['id', 'name']) if (typeof s[key] !== 'string' || !s[key]) problems.push(`"${key}" must be a non-empty string`);
  if (!isNum(s.peakLoadMW) || s.peakLoadMW <= 0) problems.push('"peakLoadMW" must be a positive number');
  if (s.flatLoadMW !== undefined && (!isNum(s.flatLoadMW) || s.flatLoadMW < 0 || !(s.flatLoadMW < s.peakLoadMW))) {
    problems.push('"flatLoadMW" must be a number from 0 to below peakLoadMW');
  }
  if (!Array.isArray(s.units) || s.units.length === 0) {
    problems.push('"units" must be a non-empty array');
    return problems;
  }
  const seen = new Set();
  s.units.forEach((u, i) => {
    const at = `units[${i}]`;
    if (!isObj(u)) return problems.push(`${at} must be an object`);
    const type = types[u.type];
    if (!type || u.type.startsWith('_')) problems.push(`${at}.type "${u.type}" is not a known unit type (${Object.keys(types).filter((k) => !k.startsWith('_')).join(', ')})`);
    else if (seen.has(u.type)) problems.push(`${at}.type "${u.type}" appears twice; list each technology once and use "count" for its units`);
    seen.add(u.type);
    if (u.name !== undefined && (typeof u.name !== 'string' || !u.name)) problems.push(`${at}.name must be a non-empty string`);
    if (!isNum(u.maxMW) || u.maxMW <= 0) problems.push(`${at}.maxMW must be a positive number (total capacity of the technology)`);
    if (u.count !== undefined && (!Number.isInteger(u.count) || u.count < 1)) problems.push(`${at}.count must be a whole number ≥ 1`);
    if (u.unitList !== undefined) checkUnitList(problems, at, u, type);
    if (type && singleUnitType(type) && (u.count ?? 1) !== 1) problems.push(`${at}.count must be 1 for ${u.type}`);
    if (u.initialState !== undefined && !UNIT_STATES.includes(u.initialState)) problems.push(`${at}.initialState must be one of ${UNIT_STATES.join(', ')}`);
    if (u.initialPct !== undefined && (!isNum(u.initialPct) || u.initialPct < 0 || u.initialPct > 100)) problems.push(`${at}.initialPct must be between 0 and 100`);
    if (u.offshoreShare !== undefined && (!isNum(u.offshoreShare) || u.offshoreShare < 0 || u.offshoreShare > 1)) problems.push(`${at}.offshoreShare must be between 0 and 1`);
    if (type && (type.storage || type.energyLimited) && (!isNum(u.energyMWh) || u.energyMWh <= 0)) problems.push(`${at}.energyMWh must be a positive number for ${u.type}`);
  });
  checkEvents(problems, 'events', s.events, [...seen]);
  return problems;
}

/**
 * The day's demand for a fleet: { peakMW, load } with load as a fraction of
 * peakMW. The fleet's flat load (flatLoadMW, e.g. round-the-clock industry)
 * is the same every hour of every day; the rest of its annual peak follows the
 * day's shape × the day's ratio. Planned rationing cuts both.
 */
export function dayDemand(scenario, day) {
  const shape = normalise(day.load);
  const keep = 1 - (day.rationingPct ?? 0) / 100;
  const flat = scenario.flatLoadMW ?? 0;
  if (!flat) return { peakMW: scenario.peakLoadMW * day.peakRatio * keep, load: shape };
  const mw = shape.map((v) => ((scenario.peakLoadMW - flat) * day.peakRatio * v + flat) * keep);
  const peakMW = Math.max(...mw);
  return { peakMW, load: mw.map((v) => v / peakMW) };
}

export function dayPeakMW(scenario, day) {
  return dayDemand(scenario, day).peakMW;
}

/** The day's highest demand minus what solar can give at that moment: what firm plants and storage face after sunset. */
export function peakAfterSolarMW(scenario, day, cfg = defaultConfig) {
  const { peakMW, load } = dayDemand(scenario, day);
  const solarMW = scenario.units.filter((u) => u.type === 'solar').reduce((sum, u) => sum + u.maxMW, 0);
  let worst = 0;
  for (let minute = 0; minute < cfg.time.dayMinutes; minute += 10) {
    const need = peakMW * profileAt(load, minute, cfg.time.dayMinutes) - solarMW * profileAt(day.solar, minute, cfg.time.dayMinutes);
    worst = Math.max(worst, need);
  }
  return worst;
}

/**
 * A fuel shortage (e.g. an LNG blockade): only a share of each limited fuel's
 * capacity has fuel. Units are given fuel in fleet order until the share is
 * used up (at least one unit); the rest are marked `noFuel` and cannot start.
 */
export function applyFuelLimits(units, types, limits = {}) {
  const out = units.map((u) => ({ ...u }));
  for (const [fuel, share] of Object.entries(limits)) {
    const idx = out.map((u, i) => i).filter((i) => types[out[i].type].fuel === fuel && !types[out[i].type].storage);
    const allowanceMW = share * idx.reduce((sum, i) => sum + out[i].maxMW, 0);
    let fuelledMW = 0;
    for (const i of idx) {
      if (share > 0 && (fuelledMW === 0 || fuelledMW + out[i].maxMW <= allowanceMW)) {
        fuelledMW += out[i].maxMW;
      } else {
        out[i].noFuel = true;
        out[i].initialState = 'offline';
      }
    }
  }
  return out;
}

export function validateDays(d) {
  const problems = [];
  if (!isObj(d) || !Array.isArray(d.days) || d.days.length === 0) return ['must be an object with a non-empty "days" array'];
  const ids = new Set();
  d.days.forEach((day, i) => {
    const at = `days[${i}]`;
    if (!isObj(day)) return problems.push(`${at} must be an object`);
    if (typeof day.id !== 'string' || !day.id) problems.push(`${at}.id must be a non-empty string`);
    else if (ids.has(day.id)) problems.push(`${at}.id "${day.id}" is used twice`);
    ids.add(day.id);
    if (!isNum(day.peakRatio) || day.peakRatio <= 0 || day.peakRatio > 1.5) problems.push(`${at}.peakRatio must be a number in (0, 1.5]`);
    if (day.rationingPct !== undefined && (!isNum(day.rationingPct) || day.rationingPct < 0 || day.rationingPct > 60)) problems.push(`${at}.rationingPct must be between 0 and 60`);
    if (day.fuelLimits !== undefined) {
      if (!isObj(day.fuelLimits)) problems.push(`${at}.fuelLimits must be an object such as { "gas": 0.2 }`);
      else {
        for (const [fuel, share] of Object.entries(day.fuelLimits)) {
          if (!defaultConfig.fuels.includes(fuel)) problems.push(`${at}.fuelLimits.${fuel}: fuel must be one of ${defaultConfig.fuels.join(', ')}`);
          if (!isNum(share) || share < 0 || share > 1) problems.push(`${at}.fuelLimits.${fuel} must be a share between 0 and 1`);
        }
      }
    }
    checkProfile(problems, `${at}.load`, day.load, 1.5);
    checkProfile(problems, `${at}.solar`, day.solar, 1);
    checkProfile(problems, `${at}.wind`, day.wind, 1);
    checkEvents(problems, `${at}.events`, day.events, null);
  });
  return problems;
}

/** Throws a DataError listing every problem, or returns the data unchanged. */
export function assertValid(file, data, validate, ...args) {
  const problems = validate(data, ...args);
  if (problems.length > 0) throw new DataError(file, problems);
  return data;
}

/** Fetches and validates all game data. `fetchJson(path)` resolves to parsed JSON. */
export async function loadGameData(fetchJson = browserFetchJson) {
  const types = assertValid('data/unit-types.json', await fetchJson('data/unit-types.json'), validateUnitTypes);
  const index = await fetchJson('data/scenarios/index.json');
  const scenarios = [];
  for (const id of index.scenarios) {
    const file = `data/scenarios/${id}.json`;
    scenarios.push(assertValid(file, await fetchJson(file), validateScenario, types));
  }
  const days = assertValid('data/days.json', await fetchJson('data/days.json'), validateDays);
  return { types, scenarios, days: days.days, daysStatus: days.dataStatus };
}

async function browserFetchJson(path) {
  let response;
  try {
    response = await fetch(path);
  } catch (err) {
    throw new DataError(path, [`could not be downloaded (${err.message})`]);
  }
  if (!response.ok) throw new DataError(path, [`could not be downloaded (HTTP ${response.status})`]);
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new DataError(path, [`is not valid JSON: ${err.message}`]);
  }
}

// ---- Custom mix ------------------------------------------------------------------

/** Capacity in GW per unit type in a scenario. */
export function capacityByType(scenario) {
  const gw = {};
  for (const u of scenario.units) gw[u.type] = (gw[u.type] ?? 0) + u.maxMW / 1000;
  return gw;
}

/** Builds a scenario from capacities in GW per type, with typical unit sizes. */
export function customScenario(capacitiesGW, peakLoadGW, types, cfg = defaultConfig) {
  const units = [];
  for (const tech of cfg.custom.techs) {
    const type = types[tech.type];
    const totalMW = Math.round((capacitiesGW[tech.type] ?? 0) * 1000);
    if (!type || totalMW <= 0) continue;
    const count = singleUnitType(type) ? 1 : Math.max(1, Math.round(totalMW / type.unitMW));
    const unit = { type: tech.type, maxMW: totalMW, count };
    if (tech.hours) unit.energyMWh = totalMW * tech.hours;
    if (tech.type === 'nuclear') Object.assign(unit, { initialState: 'online', initialPct: 100 });
    if (tech.type === 'hydro') Object.assign(unit, { initialState: 'online', initialPct: 10 });
    if (type.storage) unit.initialSocPct = 50;
    if (tech.type === 'wind') unit.offshoreShare = cfg.economics.windOffshoreShare;
    units.push(unit);
  }
  return {
    id: 'custom',
    name: 'Custom mix',
    description: '',
    peakLoadMW: Math.round(peakLoadGW * 1000),
    dataStatus: 'custom',
    units,
    events: [],
  };
}

// ---- World -------------------------------------------------------------------------

/**
 * Expands technology entries into individual units. Returns the unit specs
 * and one `tech` record per technology (for the one-card-per-technology UI).
 */
export function expandUnits(scenario, types, options = {}) {
  const units = [];
  const techs = [];
  scenario.units.forEach((entry, techIndex) => {
    const type = types[entry.type];
    const list = entry.unitList;
    const count = list ? list.length : entry.count ?? 1;
    const name = entry.name ?? entry.type;
    let auto = false;
    if (type.storage || type.activationLimited) auto = Boolean(options.autoStorage);
    else if (type.autoRole === 'backup') auto = Boolean(options.autoBackup);
    else if (type.autoRole === 'follow') auto = Boolean(options.autoFollow);
    else if (type.autoRole === 'hydro' || type.autoRole === 'curtail') auto = Boolean(options.autoRenewables);
    const first = units.length;
    const { unitList, ...spec } = entry;
    for (let k = 0; k < count; k++) {
      const real = unitList?.[k];
      units.push({
        ...spec,
        name: real ? real.name : count > 1 ? `${name} ${k + 1}` : name,
        ...(real?.nameZh ? { nameZh: real.nameZh } : {}),
        tech: techIndex,
        maxMW: real ? real.mw : entry.maxMW / count,
        auto,
      });
    }
    const sizes = units.slice(first).map((u) => u.maxMW);
    techs.push({
      type: entry.type, name, count, maxMW: entry.maxMW, first, last: units.length - 1,
      named: Boolean(unitList), minUnitMW: Math.min(...sizes), maxUnitMW: Math.max(...sizes),
    });
  });
  return { units, techs };
}

/**
 * Chooses which thermal units are running at midnight: cheapest first until
 * online capacity covers the midnight net demand plus a reserve margin, then
 * drops expensive units whose minimum output would cause a surplus. Units
 * with an explicit initialState keep it.
 */
export function autoCommit(world, cfg = defaultConfig) {
  const { types } = world;
  const at0 = (profile) => (profile ? profileAt(profile, 0, cfg.time.dayMinutes) : 0);
  let net = forecastLoad(world, 0, cfg);
  const flexible = [];
  const units = world.units.map((u) => ({ ...u }));
  units.forEach((u, i) => {
    const type = types[u.type];
    if (type.variable) net -= u.maxMW * at0(world.profiles[type.variable]);
    else if (u.initialState === 'online') net -= (u.maxMW * (u.initialPct ?? (type.mustRun ? 100 : 0))) / 100;
    else if (u.initialState === undefined) {
      const isThermal = type.dispatchable && !type.storage && !type.activationLimited && !type.energyLimited && !type.mustRun;
      if (isThermal) flexible.push(i);
      else u.initialState = 'offline';
    }
  });
  flexible.sort((a, b) => types[units[a].type].costPerMWh - types[units[b].type].costPerMWh || units[b].maxMW - units[a].maxMW);

  const target = net * (1 + cfg.custom.reserveMarginPct / 100);
  const online = [];
  let capacity = 0;
  for (const i of flexible) {
    if (capacity >= target) break;
    online.push(i);
    capacity += units[i].maxMW;
  }
  // Still short with every flexible unit committed (a calm night in a fleet with
  // little firm capacity): call in warm reserves the fleet keeps on standby, cheapest first.
  if (capacity < net) {
    const reserves = units
      .map((u, i) => i)
      .filter((i) => units[i].initialState === 'standby' && !units[i].noFuel && types[units[i].type].dispatchable && !types[units[i].type].storage)
      .sort((a, b) => types[units[a].type].costPerMWh - types[units[b].type].costPerMWh);
    for (const i of reserves) {
      if (capacity >= net) break;
      units[i].initialState = 'online';
      capacity += units[i].maxMW;
    }
  }
  const minOf = (i) => (units[i].maxMW * types[units[i].type].minStablePct) / 100;
  while (online.length > 1 && online.reduce((sum, i) => sum + minOf(i), 0) > net) online.pop();
  const onlineSet = new Set(online);
  for (const i of flexible) {
    // Automatic backup peakers wait warm on standby so they can respond within minutes.
    const type = types[units[i].type];
    const spare = units[i].auto && type.autoRole === 'backup' && hasStandbyType(type) ? 'standby' : 'offline';
    units[i].initialState = onlineSet.has(i) ? 'online' : spare;
  }
  return { ...world, units };
}

/**
 * Combines a scenario (fleet), a day type and options into a world for sim.js.
 * options: difficulty ('easy' | 'normal' | 'hard') sets defaults; assist,
 * accidents ('none' | 'scheduled' | 'random' | 'both'), autoStorage,
 * autoBackup, autoFollow (nuclear, coal and gas follow the load) and
 * autoRenewables (hydro, solar and wind) override them.
 */
export function buildWorld({ scenario, day, types, difficulty = 'normal', assist, accidents, autoStorage, autoBackup, autoFollow, autoRenewables, cfg = defaultConfig }) {
  const diff = cfg.difficulties[difficulty] ?? cfg.difficulties.normal;
  const mode = accidents ?? diff.accidents;
  const scheduled = mode === 'scheduled' || mode === 'both';
  const options = {
    autoStorage: autoStorage ?? diff.autoStorage,
    autoBackup: autoBackup ?? diff.autoBackup,
    autoFollow: autoFollow ?? diff.autoFollow,
    autoRenewables: autoRenewables ?? diff.autoRenewables,
  };
  const expanded = expandUnits(scenario, types, options);
  const units = applyFuelLimits(expanded.units, types, day.fuelLimits);
  const { techs } = expanded;
  const demand = dayDemand(scenario, day);
  const world = {
    scenarioId: scenario.id,
    dayId: day.id,
    difficulty,
    types,
    units,
    techs,
    techNames: techs.map((t) => t.name),
    annualPeakMW: scenario.peakLoadMW,
    peakLoadMW: demand.peakMW,
    rationingPct: day.rationingPct ?? 0,
    fuelLimits: day.fuelLimits ?? {},
    profiles: { load: demand.load, solar: day.solar, wind: day.wind },
    events: scheduled ? [...(day.events ?? []), ...(scenario.events ?? [])] : [],
    accidents: mode,
    randomAccidents: mode === 'random' || mode === 'both',
    assist: assist ?? diff.assist,
    autoStorage: options.autoStorage,
    autoBackup: options.autoBackup,
    autoFollow: options.autoFollow,
    autoRenewables: options.autoRenewables,
    forecastErrorPct: diff.forecastErrorPct,
  };
  return autoCommit(world, cfg);
}

function hasStandbyType(type) {
  return (type.syncMin ?? 0) > 0;
}

function normalise(profile) {
  const max = Math.max(...profile);
  return max > 0 ? profile.map((v) => v / max) : profile;
}
