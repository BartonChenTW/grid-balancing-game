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

/** The setup options a leaderboard score records, so the game can be replayed with them. */
export const OPTION_KEYS = ['assist', 'accidents', 'autoStorage', 'autoBackup', 'autoFollow', 'autoRenewables'];

/** The recorded options of a game (a world or a setup selection). */
export function gameOptions(source) {
  const o = {};
  for (const key of OPTION_KEYS) o[key] = key === 'accidents' ? source.accidents : Boolean(source[key]);
  return o;
}

/**
 * A game is ranked when it uses a Taiwan fleet, on any difficulty and with
 * any options, without the demo operator.
 * options: { scenarioId, difficulty, demo }
 */
export function isRanked(options, cfg = defaultConfig) {
  return Boolean(cfg.difficulties[options.difficulty]) && !options.demo && isRankedScenario(options.scenarioId);
}

/**
 * True when the options are exactly the difficulty's defaults. Scores with
 * other options are still ranked but tagged "custom options" on the board.
 * No options (older submissions) means the defaults.
 */
export function usesDefaultOptions(difficulty, options, cfg = defaultConfig) {
  const d = cfg.difficulties[difficulty];
  if (!d || !options) return Boolean(d);
  if (options.accidents !== d.accidents) return false;
  return OPTION_KEYS.filter((key) => key !== 'accidents').every((key) => Boolean(options[key]) === Boolean(d[key]));
}

/** replayDay accepts the recorded options (tools/verify-scores.js checks this per game version). */
export const REPLAYS_OPTIONS = true;

/**
 * Plays the day again from the seed, options and moves. `options` (see
 * OPTION_KEYS) override the difficulty's defaults; leave it out for the defaults.
 * Throws if the moves are malformed or out of order.
 */
export function replayDay({ scenario, day, types, difficulty, options, seed, moves, cfg = defaultConfig }) {
  const picked = {};
  for (const key of OPTION_KEYS) if (options?.[key] !== undefined) picked[key] = options[key];
  const world = buildWorld({ scenario, day, types, difficulty, ...picked, cfg });
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
