import { test } from 'node:test';
import assert from 'node:assert/strict';

import { config } from '../js/config.js';
import { computeScore, pickLesson } from '../js/score.js';

function finished(stats, extra = {}) {
  return {
    minute: 1440,
    status: 'finished',
    blackoutCause: null,
    inertia: { hSys: 4 },
    stats: {
      minutesNormal: 0,
      minutesWarning: 0,
      minutesCritical: 0,
      shedStages: 0,
      unservedMWh: 0,
      servedMWh: 1000,
      generationMWh: 1000,
      costNTD: 0,
      co2Tonnes: 0,
      curtailedMWh: 0,
      renewableMWh: 0,
      lowMinutes: 0,
      highMinutes: 0,
      worstDeviationHz: 0,
      worstDeviationMinute: 0,
      ...stats,
    },
    ...extra,
  };
}

test('a perfect day scores full points and three stars', () => {
  const score = computeScore(finished({ minutesNormal: 1440 }), config);
  assert.equal(score.points, 1000);
  assert.equal(score.stars, 3);
  assert.equal(pickLesson(finished({ minutesNormal: 1440 }), {}, config).key, 'lesson.wellDone');
});

test('warning minutes earn half, shedding costs points', () => {
  const score = computeScore(finished({ minutesNormal: 720, minutesWarning: 720, shedStages: 2 }), config);
  assert.equal(score.points, 750 - 50);
});

test('a blackout earns no stars and a blackout lesson', () => {
  const state = finished({ minutesNormal: 1000, worstDeviationMinute: 1140 }, { status: 'blackout', blackoutCause: 'low', minute: 1140 });
  assert.equal(computeScore(state, config).stars, 0);
  assert.equal(pickLesson(state, {}, config).key, 'lesson.blackoutEvening');
  const high = { ...state, blackoutCause: 'high' };
  assert.equal(pickLesson(high, {}, config).key, 'lesson.blackoutHigh');
});

test('lessons point at what went wrong', () => {
  assert.equal(pickLesson(finished({ minutesNormal: 1400, shedStages: 1 }), {}, config).key, 'lesson.shedding');
  assert.equal(
    pickLesson(finished({ minutesNormal: 900, lowMinutes: 500, worstDeviationMinute: 1110 }), {}, config).key,
    'lesson.eveningRamp',
  );
  assert.equal(pickLesson(finished({ minutesNormal: 900, highMinutes: 500 }), {}, config).key, 'lesson.tooMuch');
  assert.equal(
    pickLesson(finished({ minutesNormal: 1440, renewableMWh: 800, curtailedMWh: 200 }), {}, config).key,
    'lesson.curtailment',
  );
});
