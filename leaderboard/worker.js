// Follow the Load leaderboard: a Cloudflare Worker with a D1 database.
//
// Public:
//   GET  /scores?scenario=&day=&difficulty=&limit=   top scores (pending + verified), with their options
//   POST /scores                                      submit a score (stored as pending)
// Admin (Authorization: Bearer ADMIN_TOKEN), used by the verification job:
//   GET    /pending?limit=                            pending scores with seed and moves
//   POST   /verdicts  { verdicts: [{ id, status, reason }] }
//   DELETE /scores/:id                                remove a score (moderation)
//
// Stored per score: nickname, board (fleet, day, difficulty), options (assist,
// accidents, Auto modes; null = the difficulty's defaults), game version,
// seed, moves, points, stars, status. No email and no IP address.
import { validateSubmission } from './validate.js';

const MAX_BODY_BYTES = 400_000;

const parseOptions = (text) => (text ? JSON.parse(text) : null);
const RESUBMIT_SECONDS = 20;

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const headers = { 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', Vary: 'Origin' };
  if (allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors } });
}

/** Constant-time comparison of the admin token. */
function isAdmin(request, env) {
  const expected = env.ADMIN_TOKEN ?? '';
  const got = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!expected || got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new Error('request too large');
  return JSON.parse(text);
}

async function topScores(url, env, cors) {
  const scenario = url.searchParams.get('scenario') ?? '';
  const day = url.searchParams.get('day') ?? '';
  const difficulty = url.searchParams.get('difficulty') ?? '';
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 10));
  const { results } = await env.DB.prepare(
    `SELECT id, nickname, options, points, stars, status, created_at FROM scores
     WHERE scenario = ? AND day = ? AND difficulty = ? AND status != 'rejected'
     ORDER BY points DESC, created_at ASC LIMIT ?`,
  ).bind(scenario, day, difficulty, limit).all();
  const scores = results.map((r) => ({ ...r, options: parseOptions(r.options) }));
  return json({ scores }, 200, { ...cors, 'Cache-Control': 'no-store' });
}

async function submit(request, env, cors) {
  let body;
  try {
    body = await readJson(request);
  } catch (err) {
    return json({ error: err.message === 'request too large' ? err.message : 'invalid JSON' }, 400, cors);
  }
  const checked = validateSubmission(body);
  if (!checked.ok) return json({ error: checked.error }, 400, cors);
  const s = checked.value;

  // Light flood control: the same nickname on the same board at most once per RESUBMIT_SECONDS.
  const recent = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM scores WHERE nickname = ? AND scenario = ? AND day = ? AND difficulty = ?
     AND created_at > datetime('now', ?)`,
  ).bind(s.nickname, s.scenario, s.day, s.difficulty, `-${RESUBMIT_SECONDS} seconds`).first();
  if (recent && recent.n > 0) return json({ error: 'please wait a moment before submitting again' }, 429, cors);

  const inserted = await env.DB.prepare(
    `INSERT INTO scores (nickname, scenario, day, difficulty, options, version, seed, moves, points, stars)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(s.nickname, s.scenario, s.day, s.difficulty, s.options ? JSON.stringify(s.options) : null,
    s.version, s.seed, JSON.stringify(s.moves), s.points, s.stars).first();
  const better = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM scores WHERE scenario = ? AND day = ? AND difficulty = ?
     AND status != 'rejected' AND points > ?`,
  ).bind(s.scenario, s.day, s.difficulty, s.points).first();
  return json({ id: inserted.id, status: 'pending', rank: (better?.n ?? 0) + 1 }, 201, cors);
}

async function pending(url, env, cors) {
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
  const { results } = await env.DB.prepare(
    `SELECT id, scenario, day, difficulty, options, version, seed, moves, points, stars FROM scores
     WHERE status = 'pending' ORDER BY id ASC LIMIT ?`,
  ).bind(limit).all();
  return json({ scores: results.map((r) => ({ ...r, options: parseOptions(r.options), moves: JSON.parse(r.moves) })) }, 200, cors);
}

async function verdicts(request, env, cors) {
  let body;
  try {
    body = await readJson(request);
  } catch {
    return json({ error: 'invalid JSON' }, 400, cors);
  }
  const list = Array.isArray(body?.verdicts) ? body.verdicts : [];
  const statements = list
    .filter((v) => Number.isInteger(v.id) && (v.status === 'verified' || v.status === 'rejected'))
    .map((v) => env.DB.prepare(
      `UPDATE scores SET status = ?, reason = ?, verified_at = datetime('now') WHERE id = ? AND status = 'pending'`,
    ).bind(v.status, typeof v.reason === 'string' ? v.reason.slice(0, 200) : null, v.id));
  if (statements.length) await env.DB.batch(statements);
  return json({ updated: statements.length }, 200, cors);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (url.pathname === '/scores' && request.method === 'GET') return await topScores(url, env, cors);
      if (url.pathname === '/scores' && request.method === 'POST') return await submit(request, env, cors);
      if (url.pathname === '/pending' || url.pathname === '/verdicts' || request.method === 'DELETE') {
        if (!isAdmin(request, env)) return json({ error: 'unauthorized' }, 401, cors);
        if (url.pathname === '/pending' && request.method === 'GET') return await pending(url, env, cors);
        if (url.pathname === '/verdicts' && request.method === 'POST') return await verdicts(request, env, cors);
        const del = url.pathname.match(/^\/scores\/(\d+)$/);
        if (del && request.method === 'DELETE') {
          await env.DB.prepare('DELETE FROM scores WHERE id = ?').bind(Number(del[1])).run();
          return json({ deleted: Number(del[1]) }, 200, cors);
        }
      }
      if (url.pathname === '/' && request.method === 'GET') return json({ ok: true, service: 'follow-the-load leaderboard' }, 200, cors);
      return json({ error: 'not found' }, 404, cors);
    } catch (err) {
      return json({ error: 'server error' }, 500, cors);
    }
  },
};
