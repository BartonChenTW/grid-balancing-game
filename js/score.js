// End-of-day score and the tailored one-line lesson (pure, testable).
//
// The score combines three KPIs, each 0–100:
//   reliability — share of the day in the normal frequency band (a minute in
//                 the warning band counts half), minus a penalty per
//                 load-shedding stage;
//   cost        — average generation cost in NT$/kWh, on a linear scale from
//                 cfg.score.cost.best (100) to cfg.score.cost.worst (0);
//   carbon      — average CO₂ intensity in g/kWh, on a linear scale from
//                 cfg.score.carbon.best (100) to cfg.score.carbon.worst (0).
// Points = maxPoints × the weighted average of the three. A blackout scores 0
// for cost and carbon: the day did not finish.
import { config as defaultConfig } from './config.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** 100 at `best`, 0 at `worst`, linear in between (works for best < worst). */
function scale(value, best, worst) {
  return 100 * clamp01((worst - value) / (worst - best));
}

export function computeScore(state, cfg = defaultConfig) {
  const st = state.stats;
  const sc = cfg.score;
  const day = cfg.time.dayMinutes;
  const blackout = state.status === 'blackout';

  const costPerKWh = st.generationMWh > 0 ? st.costNTD / st.generationMWh / 1000 : 0; // NT$/kWh
  const co2GPerKWh = st.generationMWh > 0 ? (st.co2Tonnes / st.generationMWh) * 1000 : 0; // g/kWh

  const inBand = (st.minutesNormal + sc.warningWeight * st.minutesWarning) / day;
  const kpis = {
    reliability: {
      value: (100 * st.minutesNormal) / Math.max(1, state.minute),
      score: Math.max(0, 100 * inBand - sc.shedStagePenalty * st.shedStages),
      weight: sc.weights.reliability,
    },
    cost: {
      value: costPerKWh,
      score: blackout ? 0 : scale(costPerKWh, sc.cost.bestNTDPerKWh, sc.cost.worstNTDPerKWh),
      weight: sc.weights.cost,
    },
    carbon: {
      value: co2GPerKWh,
      score: blackout ? 0 : scale(co2GPerKWh, sc.carbon.bestGPerKWh, sc.carbon.worstGPerKWh),
      weight: sc.weights.carbon,
    },
  };
  const totalWeight = Object.values(kpis).reduce((sum, k) => sum + k.weight, 0);
  const weighted = Object.values(kpis).reduce((sum, k) => sum + k.score * k.weight, 0) / totalWeight;
  const points = Math.round((sc.maxPoints * weighted) / 100);
  const stars = blackout ? 0 : sc.starThresholds.filter((t) => points >= t).length;

  const renewableAvailable = st.renewableMWh + st.curtailedMWh;
  return {
    points,
    stars,
    kpis,
    normalPct: kpis.reliability.value,
    shedStages: st.shedStages,
    unservedMWh: st.unservedMWh,
    costNTD: st.costNTD,
    costPerKWh,
    gasOilCostNTD: (st.costByFuel?.gas ?? 0) + (st.costByFuel?.oil ?? 0),
    co2Tonnes: st.co2Tonnes,
    co2GPerKWh,
    curtailedMWh: st.curtailedMWh,
    curtailedPct: renewableAvailable > 0 ? (100 * st.curtailedMWh) / renewableAvailable : 0,
    renewableSharePct: st.generationMWh > 0 ? (100 * st.renewableMWh) / st.generationMWh : 0,
  };
}

function hourOf(minute) {
  return Math.floor(minute / 60) % 24;
}

/**
 * Picks the most useful lesson for what happened. Returns a strings.js key
 * and the values to fill in.
 */
export function pickLesson(state, world, cfg = defaultConfig) {
  const st = state.stats;
  const score = computeScore(state, cfg);
  const hour = hourOf(st.worstDeviationMinute);
  const eveningRamp = hour >= 16 && hour <= 21;

  if (state.status === 'blackout') {
    if (state.blackoutCause === 'high') return { key: 'lesson.blackoutHigh', vars: {} };
    if (state.inertia.hSys < 3) return { key: 'lesson.blackoutLowInertia', vars: {} };
    if (eveningRamp) return { key: 'lesson.blackoutEvening', vars: {} };
    return { key: 'lesson.blackoutLow', vars: {} };
  }
  if (st.shedStages > 0) return { key: 'lesson.shedding', vars: { stages: st.shedStages } };
  if (score.normalPct < 80) {
    if (st.highMinutes > st.lowMinutes) return { key: 'lesson.tooMuch', vars: {} };
    if (eveningRamp) return { key: 'lesson.eveningRamp', vars: {} };
    if (hour >= 5 && hour <= 10) return { key: 'lesson.morningRamp', vars: {} };
    return { key: 'lesson.tooLittle', vars: {} };
  }
  if (score.curtailedPct > 5) return { key: 'lesson.curtailment', vars: { pct: Math.round(score.curtailedPct) } };
  // Reliable day: point at the weaker of cost and carbon.
  const { cost, carbon } = score.kpis;
  if (Math.min(cost.score, carbon.score) < 50) {
    if (cost.score <= carbon.score) {
      const pct = score.costNTD > 0 ? Math.round((100 * score.gasOilCostNTD) / score.costNTD) : 0;
      return { key: 'lesson.expensive', vars: { pct } };
    }
    return { key: 'lesson.carbon', vars: { g: Math.round(score.co2GPerKWh) } };
  }
  return { key: 'lesson.wellDone', vars: {} };
}
