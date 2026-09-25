import { test } from 'node:test';
import assert from 'node:assert/strict';

import { config } from '../js/config.js';
import { computeScore, pickLesson } from '../js/score.js';

// 1,000 MWh generated; cost and CO₂ set per test through NT$/kWh and g/kWh.
function finished(stats, extra = {}, { ntdPerKWh = 1.5, gPerKWh = 0 } = {}) {
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
      costNTD: ntdPerKWh * 1000 * 1000,
      costByFuel: {},
      co2Tonnes: (gPerKWh / 1000) * 1000,
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

test('the score has three KPIs: reliability, cost and carbon', () => {
  const score = computeScore(finished({ minutesNormal: 1440 }, {}, { ntdPerKWh: 3, gPerKWh: 450 }), config);
  assert.equal(score.kpis.reliability.score, 100);
  assert.ok(Math.abs(score.kpis.cost.value - 3) < 1e-9);
  assert.equal(score.kpis.cost.score, 50); // halfway between NT$1.5 and NT$4.5
  assert.ok(Math.abs(score.kpis.carbon.value - 450) < 1e-9);
  assert.equal(score.kpis.carbon.score, 50); // halfway between 0 and 900 g/kWh
  assert.equal(score.points, 1000 * (0.5 * 100 + 0.25 * 50 + 0.25 * 50) / 100);
});

test('a perfect, cheap, clean day scores full points and three stars', () => {
  const score = computeScore(finished({ minutesNormal: 1440 }), config);
  assert.equal(score.points, 1000);
  assert.equal(score.stars, 3);
  assert.equal(pickLesson(finished({ minutesNormal: 1440 }), {}, config).key, 'lesson.wellDone');
});

test('warning minutes count half for reliability; shedding costs reliability points', () => {
  const score = computeScore(finished({ minutesNormal: 720, minutesWarning: 720, shedStages: 2 }), config);
  assert.equal(score.kpis.reliability.score, 75 - 2 * config.score.shedStagePenalty);
});

test('a blackout earns no stars, and no cost or carbon points', () => {
  const state = finished({ minutesNormal: 1000, worstDeviationMinute: 1140 }, { status: 'blackout', blackoutCause: 'low', minute: 1140 });
  const score = computeScore(state, config);
  assert.equal(score.stars, 0);
  assert.equal(score.kpis.cost.score, 0);
  assert.equal(score.kpis.carbon.score, 0);
  assert.equal(pickLesson(state, {}, config).key, 'lesson.blackoutEvening');
  assert.equal(pickLesson({ ...state, blackoutCause: 'high' }, {}, config).key, 'lesson.blackoutHigh');
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
  const expensive = pickLesson(finished({ minutesNormal: 1440, costByFuel: { gas: 3e6, oil: 1e6 } }, {}, { ntdPerKWh: 4 }), {}, config);
  assert.equal(expensive.key, 'lesson.expensive');
  assert.equal(expensive.vars.pct, 100);
  assert.equal(pickLesson(finished({ minutesNormal: 1440 }, {}, { gPerKWh: 700 }), {}, config).key, 'lesson.carbon');
});
