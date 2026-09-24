// Plays every scenario × day × difficulty with the scripted autopilot and
// prints how it went. Use it when tuning data/ or js/config.js.
// Run: `node tools/balance-report.js [difficulty]`
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../js/config.js';
import { createState, step } from '../js/sim.js';
import { buildWorld, validateDays, validateScenario, validateUnitTypes } from '../js/scenarios.js';
import { computeScore } from '../js/score.js';
import { autopilot } from './autopilot.js';

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

export function loadLocalData() {
  const types = read('data/unit-types.json');
  const scenarios = read('data/scenarios/index.json').scenarios.map((id) => read(`data/scenarios/${id}.json`));
  const days = read('data/days.json');
  const problems = [
    ...validateUnitTypes(types),
    ...scenarios.flatMap((s) => validateScenario(s, types)),
    ...validateDays(days),
  ];
  if (problems.length) throw new Error(problems.join('\n'));
  return { types, scenarios, days: days.days };
}

export function playDay(world, seed = 1) {
  let state = createState(world, config, seed);
  let minHz = 60;
  let maxHz = 60;
  while (state.status === 'running') {
    state = step(autopilot(state, world, config), world, config);
    minHz = Math.min(minHz, state.frequencyHz);
    maxHz = Math.max(maxHz, state.frequencyHz);
  }
  return { state, minHz, maxHz, score: computeScore(state, config) };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const difficulty = process.argv[2] ?? 'normal';
  const { types, scenarios, days } = loadLocalData();
  console.log(`difficulty: ${difficulty}`);
  console.log('scenario      day             status    points  normal%  minHz   maxHz   shed  curtail%  RE%');
  for (const scenario of scenarios) {
    for (const day of days) {
      const world = buildWorld({ scenario, day, types, difficulty });
      const { state, minHz, maxHz, score } = playDay(world);
      console.log(
        `${scenario.id.padEnd(13)} ${day.id.padEnd(15)} ${state.status.padEnd(9)} ${String(score.points).padStart(6)}  ${score.normalPct.toFixed(1).padStart(6)}  ${minHz.toFixed(2)}  ${maxHz.toFixed(2)}  ${String(score.shedStages).padStart(4)}  ${score.curtailedPct.toFixed(1).padStart(7)}  ${score.renewableSharePct.toFixed(1).padStart(4)}` +
          (state.status === 'blackout' ? `  @${Math.floor(state.minute / 60)}:${String(state.minute % 60).padStart(2, '0')}` : ''),
      );
    }
  }
}
