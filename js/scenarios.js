// Loads and validates game data (unit types, scenarios, day types) and turns
// a chosen scenario + day + difficulty into a `world` for sim.js.
// Validation is pure so it can be tested in Node; only loadGameData fetches.

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

const UNIT_STATES = ['online', 'offline'];
const EVENT_TYPES = ['trip', 'clouds', 'windCutout'];
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

function checkEvents(problems, where, events, unitNames) {
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
      if (unitNames && !unitNames.includes(e.unit)) problems.push(`${at}.unit "${e.unit}" is not a unit in this scenario`);
      if (e.fraction !== undefined && (!isNum(e.fraction) || e.fraction <= 0 || e.fraction > 1)) problems.push(`${at}.fraction must be in (0, 1]`);
    }
    if (e.factor !== undefined && (!isNum(e.factor) || e.factor < 0 || e.factor > 1)) problems.push(`${at}.factor must be between 0 and 1`);
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
    if (t.storage && (!isNum(t.efficiency) || t.efficiency <= 0 || t.efficiency > 1)) problems.push(`${id}.efficiency must be in (0, 1] for storage`);
    if (t.variable !== undefined && !['solar', 'wind'].includes(t.variable)) problems.push(`${id}.variable must be "solar" or "wind"`);
  }
  return problems;
}

export function validateScenario(s, types) {
  const problems = [];
  if (!isObj(s)) return ['must be a JSON object'];
  for (const key of ['id', 'name']) if (typeof s[key] !== 'string' || !s[key]) problems.push(`"${key}" must be a non-empty string`);
  if (!isNum(s.peakLoadMW) || s.peakLoadMW <= 0) problems.push('"peakLoadMW" must be a positive number');
  if (!Array.isArray(s.units) || s.units.length === 0) {
    problems.push('"units" must be a non-empty array');
    return problems;
  }
  const names = new Set();
  s.units.forEach((u, i) => {
    const at = `units[${i}]`;
    if (!isObj(u)) return problems.push(`${at} must be an object`);
    const type = types[u.type];
    if (!type || u.type.startsWith('_')) problems.push(`${at}.type "${u.type}" is not a known unit type (${Object.keys(types).filter((k) => !k.startsWith('_')).join(', ')})`);
    if (typeof u.name !== 'string' || !u.name) problems.push(`${at}.name must be a non-empty string`);
    else if (names.has(u.name)) problems.push(`${at}.name "${u.name}" is used twice`);
    names.add(u.name);
    if (!isNum(u.maxMW) || u.maxMW <= 0) problems.push(`${at}.maxMW must be a positive number`);
    if (u.initialState !== undefined && !UNIT_STATES.includes(u.initialState)) problems.push(`${at}.initialState must be "online" or "offline"`);
    if (u.initialPct !== undefined && (!isNum(u.initialPct) || u.initialPct < 0 || u.initialPct > 100)) problems.push(`${at}.initialPct must be between 0 and 100`);
    if (type && (type.storage || type.energyLimited) && (!isNum(u.energyMWh) || u.energyMWh <= 0)) problems.push(`${at}.energyMWh must be a positive number for ${u.type}`);
  });
  checkEvents(problems, 'events', s.events, [...names]);
  return problems;
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

/**
 * Builds a scenario from capacities in GW per type. Large technologies are
 * split into blocks so there is something to start and stop.
 * label(type) gives the display name of a type (block letters are appended).
 */
export function customScenario(capacitiesGW, peakLoadGW, label = (type) => type, cfg = defaultConfig) {
  const units = [];
  for (const tech of cfg.custom.techs) {
    const totalMW = Math.round((capacitiesGW[tech.type] ?? 0) * 1000);
    if (totalMW <= 0) continue;
    const blocks = Math.min(cfg.custom.maxBlocksPerTech, Math.ceil(totalMW / tech.blockMW));
    for (let b = 0; b < blocks; b++) {
      const maxMW = Math.round(totalMW / blocks);
      const name = blocks > 1 ? `${label(tech.type)} ${'ABCDEFGH'[b]}` : label(tech.type);
      const unit = { type: tech.type, name, maxMW };
      if (tech.hours) unit.energyMWh = maxMW * tech.hours;
      if (tech.type === 'nuclear') Object.assign(unit, { initialState: 'online', initialPct: 100 });
      if (tech.type === 'hydro') Object.assign(unit, { initialState: 'online', initialPct: 10 });
      if (tech.type === 'pumpedHydro' || tech.type === 'battery') unit.initialSocPct = 50;
      units.push(unit);
    }
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
  const minOf = (i) => (units[i].maxMW * types[units[i].type].minStablePct) / 100;
  while (online.length > 1 && online.reduce((sum, i) => sum + minOf(i), 0) > net) online.pop();
  for (const i of flexible) units[i].initialState = online.includes(i) ? 'online' : 'offline';
  return { ...world, units };
}

/** Combines a scenario (fleet), a day type and a difficulty into a world for sim.js. */
export function buildWorld({ scenario, day, types, difficulty = 'normal', assist, cfg = defaultConfig }) {
  const diff = cfg.difficulties[difficulty] ?? cfg.difficulties.normal;
  const events = diff.events ? [...(day.events ?? []), ...(scenario.events ?? [])] : [];
  const world = {
    scenarioId: scenario.id,
    dayId: day.id,
    difficulty,
    types,
    units: scenario.units,
    annualPeakMW: scenario.peakLoadMW,
    peakLoadMW: scenario.peakLoadMW * day.peakRatio,
    profiles: { load: normalise(day.load), solar: day.solar, wind: day.wind },
    events,
    assist: assist ?? diff.assist,
    forecastErrorPct: diff.forecastErrorPct,
    randomTrip: diff.randomTrip,
  };
  return autoCommit(world, cfg);
}

function normalise(profile) {
  const max = Math.max(...profile);
  return max > 0 ? profile.map((v) => v / max) : profile;
}
