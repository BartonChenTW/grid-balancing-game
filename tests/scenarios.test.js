import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { config } from '../js/config.js';
import { createState } from '../js/sim.js';
import {
  DataError,
  assertValid,
  buildWorld,
  capacityByType,
  customScenario,
  dayDemand,
  dayPeakMW,
  loadGameData,
  peakAfterSolarMW,
  validateDays,
  validateScenario,
} from '../js/scenarios.js';
import { playDay } from '../tools/balance-report.js';
import { TYPES, quiet } from './helpers.js';
import { canStart } from '../js/units.js';

const readJson = async (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

test('all shipped data files are valid', async () => {
  const data = await loadGameData(readJson);
  assert.equal(data.scenarios.length, 4);
  assert.ok(data.days.length >= 6);
});

test('invalid scenarios give clear, specific errors', () => {
  const problems = validateScenario(
    {
      id: 'x',
      name: 'Broken',
      peakLoadMW: -5,
      units: [
        { type: 'fusion', maxMW: 100 },
        { type: 'coal', maxMW: 'big', count: 2.5 },
        { type: 'battery', maxMW: 10, count: 3 },
        { type: 'coal', maxMW: 100 },
      ],
      events: [{ timeMin: 2000, type: 'trip', unitType: 'nuclear' }],
    },
    TYPES,
  );
  const text = problems.join('\n');
  assert.match(text, /peakLoadMW/);
  assert.match(text, /units\[0\]\.type "fusion" is not a known unit type/);
  assert.match(text, /units\[1\]\.maxMW must be a positive number/);
  assert.match(text, /units\[1\]\.count must be a whole number/);
  assert.match(text, /units\[2\]\.count must be 1 for battery/);
  assert.match(text, /units\[2\]\.energyMWh must be a positive number for battery/);
  assert.match(text, /units\[3\]\.type "coal" appears twice/);
  assert.match(text, /events\[0\]\.timeMin/);
  assert.match(text, /events\[0\]\.unitType "nuclear" is not a technology in this scenario/);
});

test('assertValid throws a DataError naming the file', () => {
  assert.throws(
    () => assertValid('data/scenarios/bad.json', { id: 'bad' }, validateScenario, TYPES),
    (err) => err instanceof DataError && err.message.startsWith('data/scenarios/bad.json') && err.problems.length > 0,
  );
});

test('a file that is not JSON gives a clear error', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{ "id": "oops", }', { status: 200 });
  try {
    await assert.rejects(loadGameData(), (err) => err instanceof DataError && /data\/unit-types\.json/.test(err.message) && /not valid JSON/.test(err.message));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('day profiles must divide the day evenly', () => {
  const problems = validateDays({ days: [{ id: 'd', peakRatio: 1, load: [1, 1, 1, 1, 1, 1, 1], solar: [0], wind: [0] }] });
  assert.match(problems.join('\n'), /7 values/);
});

test('every scenario × day starts balanced at 60 Hz', async () => {
  const { types, scenarios, days } = await loadGameData(readJson);
  for (const scenario of scenarios) {
    for (const day of days) {
      const world = buildWorld({ scenario, day, types });
      const state = createState(world, quiet);
      const pct = Math.abs(state.imbalanceMW) / state.demandMW;
      assert.ok(pct < 0.005, `${scenario.id}/${day.id} starts ${state.imbalanceMW.toFixed(0)} MW out of balance`);
    }
  }
});

test('the scripted operator survives every scenario × day on Normal', async () => {
  const { types, scenarios, days } = await loadGameData(readJson);
  for (const scenario of scenarios) {
    for (const day of days) {
      const world = buildWorld({ scenario, day, types, difficulty: 'normal' });
      const { state } = playDay(world, 3);
      assert.equal(state.status, 'finished', `${scenario.id}/${day.id} ended in ${state.status} at minute ${state.minute}`);
    }
  }
});

test('auto-commitment keeps nuclear online and brings enough capacity for midnight', async () => {
  const { types, scenarios, days } = await loadGameData(readJson);
  const world = buildWorld({ scenario: scenarios[0], day: days[0], types });
  const online = world.units.filter((u) => u.initialState === 'online');
  assert.ok(online.some((u) => u.type === 'nuclear'));
  const onlineMW = online.reduce((sum, u) => sum + u.maxMW, 0);
  assert.ok(onlineMW > world.peakLoadMW * 0.8);
});

test('difficulty sets defaults for assist, accidents and auto modes; options override them', async () => {
  const { types, scenarios, days } = await loadGameData(readJson);
  const typhoon = days.find((d) => d.id === 'typhoon');
  const easy = buildWorld({ scenario: scenarios[1], day: typhoon, types, difficulty: 'easy' });
  const hard = buildWorld({ scenario: scenarios[1], day: typhoon, types, difficulty: 'hard' });
  assert.equal(easy.assist, true);
  assert.equal(easy.events.length, 0);
  assert.equal(easy.randomAccidents, false);
  assert.ok(easy.units.filter((u) => u.type === 'battery' || u.type === 'dsm').every((u) => u.auto));
  assert.ok(easy.units.filter((u) => u.type === 'gasOcgt').every((u) => u.auto));
  assert.equal(hard.assist, false);
  assert.ok(hard.events.length > 0);
  assert.equal(hard.randomAccidents, true);
  assert.ok(hard.units.every((u) => !u.auto));
  const custom = buildWorld({ scenario: scenarios[1], day: typhoon, types, difficulty: 'hard', assist: true, accidents: 'none', autoBackup: true });
  assert.equal(custom.assist, true);
  assert.equal(custom.events.length, 0);
  assert.equal(custom.randomAccidents, false);
  assert.ok(custom.units.filter((u) => u.type === 'gasOcgt').every((u) => u.auto));
});

test('accident modes: scheduled only, random only, both', async () => {
  const { types, scenarios, days } = await loadGameData(readJson);
  const day = days[0];
  const count = (accidents) => {
    const state = createState(buildWorld({ scenario: scenarios[1], day, types, accidents }), config, 5);
    return { scheduled: state.events.filter((e) => !e.random).length, random: state.events.filter((e) => e.random).length };
  };
  assert.deepEqual(count('none'), { scheduled: 0, random: 0 });
  assert.ok(count('scheduled').scheduled > 0 && count('scheduled').random === 0);
  assert.ok(count('random').scheduled === 0 && count('random').random === config.events.random.count);
  assert.ok(count('both').scheduled > 0 && count('both').random > 0);
});

test('scenarios expand into individual units, one technology per card', async () => {
  const { types, scenarios, days } = await loadGameData(readJson);
  const world = buildWorld({ scenario: scenarios[1], day: days[0], types });
  const coal = scenarios[1].units.find((u) => u.type === 'coal');
  const coalUnits = world.units.filter((u) => u.type === 'coal');
  const count = coal.unitList?.length ?? coal.count;
  assert.equal(coalUnits.length, count);
  assert.ok(Math.abs(coalUnits.reduce((sum, u) => sum + u.maxMW, 0) - coal.maxMW) < 1e-6);
  assert.equal(world.techs.length, scenarios[1].units.length);
  // Auto-commitment brings only part of the coal fleet online at midnight.
  const online = coalUnits.filter((u) => u.initialState === 'online').length;
  assert.ok(online > 0 && online <= count);
});

test('a unitList gives real units their names and sizes', async () => {
  const { types, scenarios, days } = await loadGameData(readJson);
  const scenario = scenarios.find((x) => x.id === 'taiwan-2025');
  const world = buildWorld({ scenario, day: days[0], types });
  const coal = world.units.filter((u) => u.type === 'coal');
  assert.equal(coal[0].name, 'Linkou 1');
  assert.equal(coal[0].nameZh, '林口 1號機');
  assert.equal(coal[0].maxMW, 800);
  assert.ok(!('unitList' in coal[0]), 'the list itself is not copied into every unit');
  const tech = world.techs[coal[0].tech];
  assert.equal(tech.named, true);
  assert.equal(tech.minUnitMW, 550);
  assert.equal(tech.maxUnitMW, 800);
});

test('unitList is checked: sizes must add up to maxMW, and names are required', () => {
  const base = { id: 'x', name: 'X', peakLoadMW: 1000 };
  const ok = { ...base, units: [{ type: 'coal', maxMW: 1300, unitList: [{ name: 'A 1', mw: 800 }, { name: 'A 2', mw: 500 }] }] };
  assert.deepEqual(validateScenario(ok, TYPES), []);
  const sum = validateScenario({ ...base, units: [{ ...ok.units[0], maxMW: 2000 }] }, TYPES);
  assert.match(sum.join('\n'), /must equal the sum of unitList/);
  const nameless = validateScenario({ ...base, units: [{ type: 'coal', maxMW: 800, unitList: [{ mw: 800 }] }] }, TYPES);
  assert.match(nameless.join('\n'), /unitList\[0\]\.name/);
  const count = validateScenario({ ...base, units: [{ ...ok.units[0], count: 3 }] }, TYPES);
  assert.match(count.join('\n'), /count must equal the length of unitList/);
  const solar = validateScenario({ ...base, units: [{ type: 'solar', maxMW: 800, unitList: [{ name: 'S', mw: 800 }] }] }, TYPES);
  assert.match(solar.join('\n'), /unitList is not allowed for solar/);
});

test('custom mix uses typical unit sizes', () => {
  const scenario = customScenario({ coal: 21, solar: 30, battery: 5 }, 40, TYPES);
  const coal = scenario.units.find((u) => u.type === 'coal');
  assert.equal(coal.count, 30); // 21 GW / 700 MW
  assert.equal(scenario.units.find((u) => u.type === 'solar').count, 1);
  assert.equal(scenario.units.find((u) => u.type === 'battery').energyMWh, 5000 * 4);
  assert.deepEqual(validateScenario(scenario, TYPES), []);
  const gw = capacityByType(scenario);
  assert.ok(Math.abs(gw.coal - 21) < 0.01);
});

test('switching scenarios gives an independent fresh state', async () => {
  const { types, scenarios, days } = await loadGameData(readJson);
  const a = createState(buildWorld({ scenario: scenarios[0], day: days[0], types }), config, 1);
  const b = createState(buildWorld({ scenario: scenarios[2], day: days[0], types }), config, 1);
  assert.notDeepEqual(a.units.map((u) => u.name), b.units.map((u) => u.name));
  assert.equal(b.minute, 0);
  assert.equal(b.eventLog.length, 0);
});

test('LNG blockade day: only a share of the gas fleet has fuel, and demand is rationed', async () => {
  const { types, scenarios, days } = await loadGameData(readJson);
  const day = days.find((d) => d.id === 'lngBlockade');
  const scenario = scenarios.find((x) => x.id === 'taiwan-2025');
  const world = buildWorld({ scenario, day, types, difficulty: 'normal' });
  const gas = world.units.filter((u) => types[u.type].fuel === 'gas');
  const fuelled = gas.filter((u) => !u.noFuel).reduce((sum, u) => sum + u.maxMW, 0);
  const total = gas.reduce((sum, u) => sum + u.maxMW, 0);
  assert.ok(fuelled > 0 && fuelled <= day.fuelLimits.gas * total + 1e-6, `${fuelled} of ${total} MW has fuel`);
  assert.ok(gas.filter((u) => u.noFuel).every((u) => u.initialState === 'offline'));
  // Units without fuel cannot be started.
  const state = createState(world, quiet);
  const dry = state.units.find((u) => u.noFuel);
  assert.equal(canStart(dry, types[dry.type]), false);
  // Rationing lowers the day's peak.
  assert.ok(Math.abs(world.peakLoadMW - scenario.peakLoadMW * day.peakRatio * 0.6) < 1e-6);
  assert.equal(dayPeakMW(scenario, day), world.peakLoadMW);
  // Other fuels are untouched.
  assert.ok(world.units.filter((u) => u.type === 'coal').every((u) => !u.noFuel));
});

test('a flat load is the same every hour; the rest follows the day shape', async () => {
  const { types, scenarios, days } = await loadGameData(readJson);
  const scenario = scenarios.find((x) => x.id === 'taiwan-2050');
  const day = days.find((d) => d.id === 'summerWeekday');
  const flat = scenario.flatLoadMW;
  assert.ok(flat > 0);
  const { peakMW, load } = dayDemand(scenario, day);
  assert.ok(Math.abs(peakMW - ((scenario.peakLoadMW - flat) * day.peakRatio + flat)) < 1e-6);
  const shape = day.load.map((v) => v / Math.max(...day.load));
  load.forEach((v, i) => assert.ok(Math.abs(v * peakMW - ((scenario.peakLoadMW - flat) * day.peakRatio * shape[i] + flat)) < 1e-6));
  const world = buildWorld({ scenario, day, types, difficulty: 'normal' });
  assert.equal(world.peakLoadMW, peakMW);
  assert.deepEqual(world.profiles.load, load);
  // Without a flat load the day is as before: the annual peak × the day's ratio, the day's own shape.
  const today = scenarios.find((x) => x.id === 'taiwan-2025');
  assert.equal(dayPeakMW(today, day), today.peakLoadMW * day.peakRatio);
  assert.deepEqual(dayDemand(today, day).load, shape);
  // Solar covers the midday peak, so firm plants face less than the peak.
  const after = peakAfterSolarMW(scenario, day);
  assert.ok(after > 0 && after < peakMW);
  assert.match(validateScenario({ ...scenario, flatLoadMW: scenario.peakLoadMW }, types).join('\n'), /flatLoadMW/);
  assert.match(validateScenario({ ...scenario, flatLoadMW: -1 }, types).join('\n'), /flatLoadMW/);
});

test('day fuel limits and rationing are checked', () => {
  const base = { id: 'd', peakRatio: 1, load: [1], solar: [0], wind: [0] };
  assert.deepEqual(validateDays({ days: [{ ...base, rationingPct: 40, fuelLimits: { gas: 0.2 } }] }), []);
  assert.match(validateDays({ days: [{ ...base, rationingPct: 90 }] }).join('\n'), /rationingPct/);
  assert.match(validateDays({ days: [{ ...base, fuelLimits: { lng: 0.2 } }] }).join('\n'), /fuel must be one of/);
  assert.match(validateDays({ days: [{ ...base, fuelLimits: { gas: 2 } }] }).join('\n'), /share between 0 and 1/);
});

test('days follow the real weather they were built from', async () => {
  const { days } = await loadGameData(readJson);
  const weather = (await readJson('data/weather-days.json')).days;
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  for (const day of days) {
    const w = weather[day.id];
    assert.ok(w, `${day.id} has a real date`);
    assert.equal(day.weather.date, w.date);
    // The solar curve carries the real day's solar energy (within rounding).
    assert.ok(Math.abs(mean(day.solar) - mean(w.solar)) < 0.005, day.id);
    // Wind follows the windows' mix of 80% offshore and 20% onshore.
    const windows = w.offwind.map((off, k) => 0.8 * off + 0.2 * w.onwind[k]);
    assert.ok(Math.abs(day.wind[2] - windows[0]) < 0.002, `${day.id} wind at 02:00`);
  }
});
