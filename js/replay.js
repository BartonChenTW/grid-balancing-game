// Replays a recorded game (pure): the same world, seed and moves always give
// the same day, so a leaderboard score can be checked by playing it again.
//
// A move is [minute, tech, code]: at game minute `minute` (before that
// minute's step) the player did ACTION_CODES[code] on technology `tech`.
import { config as defaultConfig } from './config.js';
import { techAction } from './fleet.js';
import { buildWorld } from './scenarios.js';
import { computeScore } from './score.js';
import { createState, step } from './sim.js';

export const ACTION_CODES = ['up', 'down', 'onlineUp', 'onlineDown', 'standbyUp', 'standbyDown', 'toggleAuto'];

/** Scenarios whose scores can be compared on a leaderboard (the Taiwan fleets). */
export function isRankedScenario(scenarioId) {
  return /^taiwan-\d{4}$/.test(scenarioId);
}

/**
 * A game is ranked when it uses a Taiwan fleet and exactly the difficulty's
 * default options (assist, accidents, Auto modes), without the demo operator.
 * options: { scenarioId, difficulty, assist, accidents, autoStorage, autoBackup, autoFollow, autoRenewables, demo }
 */
export function isRanked(options, cfg = defaultConfig) {
  const d = cfg.difficulties[options.difficulty];
  if (!d || options.demo || !isRankedScenario(options.scenarioId)) return false;
  if (options.accidents !== d.accidents) return false;
  return ['assist', 'autoStorage', 'autoBackup', 'autoFollow', 'autoRenewables']
    .every((key) => Boolean(options[key]) === Boolean(d[key]));
}

/**
 * Plays the day again from the seed and moves.
 * Throws if the moves are malformed or out of order.
 */
export function replayDay({ scenario, day, types, difficulty, seed, moves, cfg = defaultConfig }) {
  const world = buildWorld({ scenario, day, types, difficulty, cfg });
  let state = createState(world, cfg, seed);
  let i = 0;
  const techCount = world.techs.length;
  while (state.status === 'running') {
    while (i < moves.length && moves[i][0] === state.minute) {
      const [, tech, code] = moves[i];
      if (!Number.isInteger(tech) || tech < 0 || tech >= techCount || !ACTION_CODES[code]) {
        throw new Error(`invalid move ${i}: ${JSON.stringify(moves[i])}`);
      }
      state = techAction(state, world, tech, ACTION_CODES[code], cfg);
      i++;
    }
    if (i < moves.length && moves[i][0] < state.minute) throw new Error(`move ${i} is out of order`);
    state = step(state, world, cfg);
  }
  if (i < moves.length) throw new Error(`${moves.length - i} move(s) after the end of the day`);
  return { state, score: computeScore(state, cfg) };
}
