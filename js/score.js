// End-of-day score and the tailored one-line lesson (pure, testable).
import { config as defaultConfig } from './config.js';

/**
 * Points: one per minute in the normal band, `warningWeight` per minute in the
 * warning band, minus a penalty per load-shedding stage. A blackout keeps
 * only the points earned before it.
 */
export function computeScore(state, cfg = defaultConfig) {
  const st = state.stats;
  const day = cfg.time.dayMinutes;
  const raw = (st.minutesNormal + cfg.score.warningWeight * st.minutesWarning) / day;
  const points = Math.max(0, Math.round(cfg.score.maxPoints * raw - cfg.score.shedStagePenalty * st.shedStages));
  const stars = state.status === 'blackout' ? 0 : cfg.score.starThresholds.filter((t) => points >= t).length;
  const renewableAvailable = st.renewableMWh + st.curtailedMWh;
  return {
    points,
    stars,
    normalPct: (100 * st.minutesNormal) / Math.max(1, state.minute),
    shedStages: st.shedStages,
    unservedMWh: st.unservedMWh,
    costNTD: st.costNTD,
    co2Tonnes: st.co2Tonnes,
    co2Intensity: st.servedMWh > 0 ? st.co2Tonnes / st.servedMWh : 0, // t/MWh
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
  return { key: 'lesson.wellDone', vars: {} };
}
