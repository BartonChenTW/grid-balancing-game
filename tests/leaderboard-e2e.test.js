// End-to-end leaderboard test without Cloudflare: the real Worker code runs
// against Node's built-in SQLite (standing in for D1) behind a local HTTP
// server, and the real verifier (tools/verify-scores.js) replays the games.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';

import worker from '../leaderboard/worker.js';
import { config } from '../js/config.js';
import { techAction } from '../js/fleet.js';
import { ACTION_CODES } from '../js/replay.js';
import { buildWorld } from '../js/scenarios.js';
import { computeScore } from '../js/score.js';
import { createState, step } from '../js/sim.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/** Minimal D1-compatible wrapper around node:sqlite. */
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(read('leaderboard/schema.sql'));
  const statement = (sql, args = []) => ({
    bind: (...a) => statement(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    run: async () => db.prepare(sql).run(...args),
  });
  return {
    prepare: (sql) => statement(sql),
    batch: async (list) => Promise.all(list.map((s) => s.run())),
    raw: db,
  };
}

function startServer(env) {
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request(`http://localhost${req.url}`, { method: req.method, headers: req.headers, body: req.method === 'GET' ? undefined : body });
    const response = await worker.fetch(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** A played day with its seed, moves and score, as the game would submit it. */
function playDay() {
  const types = JSON.parse(read('data/unit-types.json'));
  const scenario = JSON.parse(read('data/scenarios/taiwan-2016.json'));
  const day = JSON.parse(read('data/days.json')).days[0];
  const world = buildWorld({ scenario, day, types, difficulty: 'easy', cfg: config });
  const seed = 777;
  let state = createState(world, config, seed);
  const moves = [];
  while (state.status === 'running') {
    if (state.minute % 60 === 30) {
      const code = ACTION_CODES.indexOf(state.minute < 720 ? 'up' : 'down');
      moves.push([state.minute, 1, code]);
      state = techAction(state, world, 1, ACTION_CODES[code], config);
    }
    state = step(state, world, config);
  }
  const score = computeScore(state, config);
  const version = JSON.parse(read('package.json')).version;
  return { scenario: 'taiwan-2016', day: day.id, difficulty: 'easy', version, seed, moves, points: score.points, stars: score.stars };
}

test('submit → shows as checking → verifier replays → verified or rejected', async () => {
  const env = { DB: fakeD1(), ADMIN_TOKEN: 'test-admin-token-123', ALLOWED_ORIGINS: 'https://bartonchentw.github.io' };
  const server = await startServer(env);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const game = playDay();
    const post = (body) => fetch(`${base}/scores`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://bartonchentw.github.io' }, body: JSON.stringify(body) });

    const honest = await post({ ...game, nickname: 'Honest' });
    assert.equal(honest.status, 201);
    assert.equal(honest.headers.get('access-control-allow-origin'), 'https://bartonchentw.github.io');
    const cheat = await post({ ...game, nickname: 'Cheater', points: Math.min(1000, game.points + 50) });
    assert.equal(cheat.status, 201);
    assert.equal((await post({ ...game, nickname: 'Honest' })).status, 429); // flood control

    const boardUrl = `${base}/scores?scenario=taiwan-2016&day=${game.day}&difficulty=easy`;
    let board = (await (await fetch(boardUrl)).json()).scores;
    assert.equal(board.length, 2);
    assert.ok(board.every((s) => s.status === 'pending'));
    assert.equal((await fetch(`${base}/pending`)).status, 401); // admin only

    const out = await new Promise((resolve, reject) => {
      execFile(process.execPath, ['tools/verify-scores.js'], {
        cwd: new URL('..', import.meta.url),
        env: { ...process.env, LEADERBOARD_URL: base, LEADERBOARD_ADMIN_TOKEN: env.ADMIN_TOKEN },
      }, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)));
    });
    assert.match(out, /Checked 2 score/);

    board = (await (await fetch(boardUrl)).json()).scores;
    assert.equal(board.length, 1, 'the rejected score leaves the board');
    assert.equal(board[0].nickname, 'Honest');
    assert.equal(board[0].status, 'verified');
    const rejected = env.DB.raw.prepare("SELECT reason FROM scores WHERE nickname = 'Cheater'").get();
    assert.match(rejected.reason, /replay gives/);
  } finally {
    server.close();
  }
});
