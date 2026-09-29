import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cleanNickname, validateSubmission } from '../leaderboard/validate.js';

const good = {
  nickname: '  Grid  Master ',
  scenario: 'taiwan-2025',
  day: 'summerWeekday',
  difficulty: 'normal',
  version: '0.6.0',
  seed: 12345,
  points: 780,
  stars: 2,
  moves: [[0, 1, 0], [15, 2, 3], [15, 0, 1]],
};

test('a valid submission is accepted and the nickname cleaned', () => {
  const r = validateSubmission(good);
  assert.equal(r.ok, true);
  assert.equal(r.value.nickname, 'Grid Master');
});

test('nicknames: control characters removed, Chinese allowed, length limited', () => {
  assert.equal(cleanNickname('a\u0000b‮c'), 'abc');
  assert.equal(validateSubmission({ ...good, nickname: '調度員小明' }).ok, true);
  assert.equal(validateSubmission({ ...good, nickname: '   ' }).ok, false);
  assert.equal(validateSubmission({ ...good, nickname: 'x'.repeat(21) }).ok, false);
});

test('bad fields are rejected with a reason', () => {
  const bad = [
    { scenario: 'custom' },
    { day: 'summer weekday; DROP TABLE' },
    { difficulty: 'insane' },
    { version: 'latest' },
    { seed: -1 },
    { points: 1001 },
    { stars: 4 },
    { moves: 'lots' },
    { moves: [[10, 0, 0], [5, 0, 0]] },
    { moves: [[10, 0, 9]] },
    { moves: [[10, 0]] },
  ];
  for (const patch of bad) {
    const r = validateSubmission({ ...good, ...patch });
    assert.equal(r.ok, false, JSON.stringify(patch));
    assert.ok(r.error.length > 0);
  }
});

test('options: optional, and when given all six must be valid', () => {
  assert.equal(validateSubmission(good).value.options, null);
  const options = { assist: true, accidents: 'both', autoStorage: false, autoBackup: true, autoFollow: false, autoRenewables: true };
  assert.deepEqual(validateSubmission({ ...good, options }).value.options, options);
  assert.deepEqual(validateSubmission({ ...good, options: { ...options, extra: 1 } }).value.options, options, 'unknown keys dropped');
  for (const bad of [[], 'x', { ...options, accidents: 'many' }, { ...options, assist: 'yes' }, { accidents: 'none' }]) {
    const r = validateSubmission({ ...good, options: bad });
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.match(r.error, /options/);
  }
});

test('kpis: optional, and when given all three must be numbers in range', () => {
  assert.equal(validateSubmission(good).value.kpis, null);
  const kpis = { reliability: 97.3, cost: 1.42, carbon: 452 };
  assert.deepEqual(validateSubmission({ ...good, kpis }).value.kpis, kpis);
  assert.deepEqual(validateSubmission({ ...good, kpis: { ...kpis, extra: 1 } }).value.kpis, kpis, 'unknown keys dropped');
  for (const bad of [[], 'x', { ...kpis, reliability: 101 }, { ...kpis, cost: -1 }, { ...kpis, carbon: '452' }, { reliability: 90 }]) {
    const r = validateSubmission({ ...good, kpis: bad });
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.match(r.error, /kpis/);
  }
});

test('the verifier finds a version without a tag; an unknown version gives null', async () => {
  const { revisionOf } = await import('../tools/verify-scores.js');
  const { execFileSync } = await import('node:child_process');
  const committed = JSON.parse(execFileSync('git', ['show', 'HEAD:package.json'], { encoding: 'utf8' })).version;
  assert.ok(revisionOf(committed), 'the committed version resolves (tag or HEAD)');
  assert.equal(revisionOf('0.0.0'), null);
});
