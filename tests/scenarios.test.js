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
  loadGameData,
  validateDays,
  validateScenario,
} from '../js/scenarios.js';
import { playDay } from '../tools/balance-report.js';
import { TYPES, quiet } from './helpers.js';

const readJson = async (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

test('all shipped data files are valid', async () => {
  const data = await loadGameData(readJson);
  assert.equal(data.scenarios.length, 3);
  assert.ok(data.days.length >= 6);
});

test('invalid scenarios give clear, specific errors', () => {
  const problems = validateScenario(
    {
      id: 'x',
      name: 'Broken',
      peakLoadMW: -5,
      units: [
        { type: 'fusion', name: 'Reactor', maxMW: 100 },
        { type: 'coal', name: 'Reactor', maxMW: 'big' },
        { type: 'battery', name: 'B', maxMW: 10 },
      ],
      events: [{ timeMin: 2000, type: 'trip', unit: 'Nobody' }],
    },
    TYPES,
  );
  const text = problems.join('\n');
  assert.match(text, /peakLoadMW/);
  assert.match(text, /units\[0\]\.type "fusion" is not a known unit type/);
  assert.match(text, /units\[1\]\.name "Reactor" is used twice/);
  assert.match(text, /units\[1\]\.maxMW must be a positive number/);
  assert.match(text, /units\[2\]\.energyMWh must be a positive number for battery/);
  assert.match(text, /events\[0\]\.timeMin/);
  assert.match(text, /events\[0\]\.unit "Nobody" is not a unit/);
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

test('difficulty controls assist and events', async () => {
  const { types, scenarios, days } = await loadGameData(readJson);
  const typhoon = days.find((d) => d.id === 'typhoon');
  const easy = buildWorld({ scenario: scenarios[1], day: typhoon, types, difficulty: 'easy' });
  const hard = buildWorld({ scenario: scenarios[1], day: typhoon, types, difficulty: 'hard' });
  assert.equal(easy.assist, true);
  assert.equal(easy.events.length, 0);
  assert.equal(hard.assist, false);
  assert.ok(hard.events.length > 0);
  assert.equal(buildWorld({ scenario: scenarios[1], day: typhoon, types, difficulty: 'hard', assist: true }).assist, true);
});

test('custom mix splits large technologies into named blocks', () => {
  const scenario = customScenario({ coal: 20, solar: 30, battery: 5 }, 40, (type) => type.toUpperCase());
  const coal = scenario.units.filter((u) => u.type === 'coal');
  assert.equal(coal.length, 3);
  assert.deepEqual(coal.map((u) => u.name), ['COAL A', 'COAL B', 'COAL C']);
  assert.equal(scenario.units.find((u) => u.type === 'battery').energyMWh, 5000 * 4);
  assert.deepEqual(validateScenario(scenario, TYPES), []);
  const gw = capacityByType(scenario);
  assert.ok(Math.abs(gw.coal - 20) < 0.01);
});

test('switching scenarios gives an independent fresh state', async () => {
  const { types, scenarios, days } = await loadGameData(readJson);
  const a = createState(buildWorld({ scenario: scenarios[0], day: days[0], types }), config, 1);
  const b = createState(buildWorld({ scenario: scenarios[2], day: days[0], types }), config, 1);
  assert.notDeepEqual(a.units.map((u) => u.name), b.units.map((u) => u.name));
  assert.equal(b.minute, 0);
  assert.equal(b.eventLog.length, 0);
});
