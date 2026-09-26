import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { config } from '../js/config.js';
import { techAction } from '../js/fleet.js';
import { ACTION_CODES, gameOptions, isRanked, replayDay, usesDefaultOptions } from '../js/replay.js';
import { buildWorld } from '../js/scenarios.js';
import { computeScore } from '../js/score.js';
import { createState, nextRandom, step } from '../js/sim.js';

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const types = read('data/unit-types.json');
const scenario = read('data/scenarios/taiwan-2025.json');
const day = read('data/days.json').days[0];

/** Plays a day the way the game does: moves between steps, recorded as [minute, tech, code]. */
function playRecorded(difficulty, seed, options = {}) {
  const world = buildWorld({ scenario, day, types, difficulty, ...options, cfg: config });
  let state = createState(world, config, seed);
  const moves = [];
  let r = 7;
  while (state.status === 'running') {
    if (state.minute % 15 === 0) {
      const [a, s1] = nextRandom(r);
      const [b, s2] = nextRandom(s1);
      r = s2;
      const tech = Math.floor(a * world.techs.length);
      const code = Math.floor(b * ACTION_CODES.length);
      moves.push([state.minute, tech, code]);
      state = techAction(state, world, tech, ACTION_CODES[code], config);
    }
    state = step(state, world, config);
  }
  return { state, moves, points: computeScore(state, config).points };
}

test('replaying the recorded moves reproduces the day exactly', () => {
  for (const difficulty of ['easy', 'hard']) {
    const original = playRecorded(difficulty, 12345);
    const { state, score } = replayDay({ scenario, day, types, difficulty, seed: 12345, moves: original.moves, cfg: config });
    assert.equal(score.points, original.points);
    assert.equal(state.minute, original.state.minute);
    assert.equal(state.frequencyHz, original.state.frequencyHz);
  }
});

test('a different seed or edited moves give a different result', () => {
  const original = playRecorded('normal', 42);
  const otherSeed = replayDay({ scenario, day, types, difficulty: 'normal', seed: 43, moves: original.moves, cfg: config });
  assert.notEqual(otherSeed.state.stats.costNTD, original.state.stats.costNTD);
  // Replace one move with "take a coal unit offline" (tech 0 is coal in Taiwan 2025).
  const edited = original.moves.map((m, i) => (i === 3 ? [m[0], 0, ACTION_CODES.indexOf('onlineDown')] : m));
  const replayed = replayDay({ scenario, day, types, difficulty: 'normal', seed: 42, moves: edited, cfg: config });
  assert.notEqual(replayed.state.stats.costNTD, original.state.stats.costNTD);
});

test('malformed or out-of-order moves are rejected', () => {
  const base = { scenario, day, types, difficulty: 'normal', seed: 1, cfg: config };
  assert.throws(() => replayDay({ ...base, moves: [[10, 99, 0]] }), /invalid move/);
  assert.throws(() => replayDay({ ...base, moves: [[10, 0, 0], [5, 0, 0]] }), /out of order/);
  assert.throws(() => replayDay({ ...base, moves: [[5000, 0, 0]] }), /after the end/);
});

test('every difficulty on a Taiwan fleet is ranked, whatever the options; not a custom fleet or the demo', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) {
    assert.equal(isRanked({ scenarioId: 'taiwan-2025', difficulty }), true);
  }
  const ranked = { scenarioId: 'taiwan-2025', difficulty: 'normal' };
  assert.equal(isRanked({ ...ranked, scenarioId: 'custom' }), false);
  assert.equal(isRanked({ ...ranked, difficulty: 'impossible' }), false);
  assert.equal(isRanked({ ...ranked, demo: true }), false);
});

test('options other than the difficulty defaults are recognised (for the "custom options" tag)', () => {
  const d = config.difficulties.normal;
  assert.equal(usesDefaultOptions('normal', gameOptions(d)), true);
  assert.equal(usesDefaultOptions('normal', null), true, 'no options = defaults (older submissions)');
  assert.equal(usesDefaultOptions('normal', { ...gameOptions(d), assist: !d.assist }), false);
  assert.equal(usesDefaultOptions('normal', { ...gameOptions(d), accidents: 'both' }), false);
  assert.equal(usesDefaultOptions('easy', gameOptions(d)), false);
});

test('a game with custom options replays exactly only with those options', () => {
  const options = { assist: true, accidents: 'both', autoStorage: true, autoBackup: true, autoFollow: true, autoRenewables: true };
  const original = playRecorded('hard', 2024, options);
  const replayed = replayDay({ scenario, day, types, difficulty: 'hard', options, seed: 2024, moves: original.moves, cfg: config });
  assert.equal(replayed.score.points, original.points);
  assert.equal(replayed.state.frequencyHz, original.state.frequencyHz);
  const withDefaults = replayDay({ scenario, day, types, difficulty: 'hard', seed: 2024, moves: original.moves, cfg: config });
  assert.notEqual(withDefaults.state.stats.costNTD, original.state.stats.costNTD);
  // Unknown keys cannot change what is replayed.
  const sneaky = replayDay({ scenario, day, types, difficulty: 'hard', options: { ...options, cfg: {}, scenario: null }, seed: 2024, moves: original.moves, cfg: config });
  assert.equal(sneaky.score.points, original.points);
});
