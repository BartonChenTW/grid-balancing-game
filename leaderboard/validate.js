// Checks a score submission before it is stored (pure, shared by the Worker
// and the tests). The replay check itself runs later, in GitHub Actions.

export const LIMITS = {
  nicknameMax: 20,
  movesMax: 20000,
  minuteMax: 1440,
  techMax: 30,
  codeMax: 6, // index into ACTION_CODES in js/replay.js
  pointsMax: 1000,
  seedMax: 4294967295,
};

const DIFFICULTIES = ['easy', 'normal', 'hard'];

// Invisible and control characters: C0/C1 controls, zero-width and bidi marks,
// line/paragraph separators, byte-order mark.
const HIDDEN_RANGES = [[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2066, 0x2069], [0xfeff, 0xfeff]];
const isHidden = (codePoint) => HIDDEN_RANGES.some(([a, b]) => codePoint >= a && codePoint <= b);

/** Removes control and invisible characters and surrounding space; collapses inner runs of space. */
export function cleanNickname(value) {
  if (typeof value !== 'string') return '';
  const kept = [...value].filter((ch) => !isHidden(ch.codePointAt(0))).join('');
  return kept.replace(/\s+/g, ' ').trim();
}

/** Returns { ok: true, value } with the cleaned submission, or { ok: false, error }. */
export function validateSubmission(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'body must be a JSON object' };
  const nickname = cleanNickname(body.nickname);
  if (nickname.length < 1 || [...nickname].length > LIMITS.nicknameMax) return { ok: false, error: `nickname must be 1–${LIMITS.nicknameMax} characters` };
  if (typeof body.scenario !== 'string' || !/^taiwan-\d{4}$/.test(body.scenario)) return { ok: false, error: 'scenario must be a Taiwan fleet' };
  if (typeof body.day !== 'string' || !/^[A-Za-z]{1,40}$/.test(body.day)) return { ok: false, error: 'invalid day' };
  if (!DIFFICULTIES.includes(body.difficulty)) return { ok: false, error: 'invalid difficulty' };
  if (typeof body.version !== 'string' || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(body.version)) return { ok: false, error: 'invalid version' };
  if (!Number.isInteger(body.seed) || body.seed < 0 || body.seed > LIMITS.seedMax) return { ok: false, error: 'invalid seed' };
  if (!Number.isInteger(body.points) || body.points < 0 || body.points > LIMITS.pointsMax) return { ok: false, error: 'invalid points' };
  if (!Number.isInteger(body.stars) || body.stars < 0 || body.stars > 3) return { ok: false, error: 'invalid stars' };
  if (!Array.isArray(body.moves) || body.moves.length > LIMITS.movesMax) return { ok: false, error: `moves must be an array of at most ${LIMITS.movesMax}` };
  let last = 0;
  for (const m of body.moves) {
    if (!Array.isArray(m) || m.length !== 3 || !m.every(Number.isInteger)) return { ok: false, error: 'each move must be [minute, tech, code]' };
    const [minute, tech, code] = m;
    if (minute < last || minute > LIMITS.minuteMax || tech < 0 || tech > LIMITS.techMax || code < 0 || code > LIMITS.codeMax) {
      return { ok: false, error: 'move out of range or out of order' };
    }
    last = minute;
  }
  return {
    ok: true,
    value: {
      nickname,
      scenario: body.scenario,
      day: body.day,
      difficulty: body.difficulty,
      version: body.version,
      seed: body.seed,
      points: body.points,
      stars: body.stars,
      moves: body.moves,
    },
  };
}
