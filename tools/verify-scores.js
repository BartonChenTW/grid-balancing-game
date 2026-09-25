// Verifies pending leaderboard scores by replaying each game with the exact
// game version it was played on (checked out from that version's git tag).
// Run by .github/workflows/verify-scores.yml; needs LEADERBOARD_URL and
// LEADERBOARD_ADMIN_TOKEN. Without them it does nothing.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const BASE = (process.env.LEADERBOARD_URL ?? '').replace(/\/$/, '');
const TOKEN = process.env.LEADERBOARD_ADMIN_TOKEN ?? '';
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

async function api(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${options.method ?? 'GET'} ${path}: HTTP ${res.status}`);
  return res.json();
}

/** Game code and data for a version: the working tree for the current version, else its tag. */
const versions = new Map();
async function loadVersion(version) {
  if (versions.has(version)) return versions.get(version);
  let dir = ROOT;
  const current = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  if (version !== current) {
    dir = mkdtempSync(join(tmpdir(), `ftl-v${version}-`));
    const tar = join(dir, 'src.tar');
    execFileSync('git', ['-C', ROOT, 'archive', '--format=tar', '-o', tar, `v${version}`, 'js', 'data', 'package.json']);
    execFileSync('tar', ['-xf', tar, '-C', dir]);
  }
  if (!existsSync(join(dir, 'js', 'replay.js'))) throw new Error(`version ${version} has no replay support`);
  const url = (p) => pathToFileURL(join(dir, p)).href;
  const game = {
    replay: await import(url('js/replay.js')),
    config: (await import(url('js/config.js'))).config,
    types: JSON.parse(readFileSync(join(dir, 'data', 'unit-types.json'), 'utf8')),
    days: JSON.parse(readFileSync(join(dir, 'data', 'days.json'), 'utf8')).days,
    dir,
  };
  versions.set(version, game);
  return game;
}

async function verify(entry) {
  let game;
  try {
    game = await loadVersion(entry.version);
  } catch (err) {
    return { id: entry.id, status: 'rejected', reason: `unknown game version ${entry.version}` };
  }
  const scenarioFile = join(game.dir, 'data', 'scenarios', `${entry.scenario}.json`);
  const day = game.days.find((d) => d.id === entry.day);
  if (!existsSync(scenarioFile) || !day) return { id: entry.id, status: 'rejected', reason: 'unknown fleet or day' };
  try {
    const scenario = JSON.parse(readFileSync(scenarioFile, 'utf8'));
    const { score } = game.replay.replayDay({
      scenario, day, types: game.types, difficulty: entry.difficulty, seed: entry.seed, moves: entry.moves, cfg: game.config,
    });
    if (score.points !== entry.points || score.stars !== entry.stars) {
      return { id: entry.id, status: 'rejected', reason: `replay gives ${score.points} points, ${score.stars} stars` };
    }
    return { id: entry.id, status: 'verified' };
  } catch (err) {
    return { id: entry.id, status: 'rejected', reason: `replay failed: ${err.message}`.slice(0, 200) };
  }
}

async function main() {
  if (!BASE || !TOKEN) {
    console.log('LEADERBOARD_URL / LEADERBOARD_ADMIN_TOKEN not set: nothing to verify.');
    return;
  }
  let total = 0;
  for (let round = 0; round < 20; round++) {
    const { scores } = await api('/pending?limit=100');
    if (!scores.length) break;
    const verdicts = [];
    for (const entry of scores) {
      const v = await verify(entry);
      verdicts.push(v);
      console.log(`#${v.id} ${entry.scenario}/${entry.day}/${entry.difficulty} v${entry.version}: ${v.status}${v.reason ? ` (${v.reason})` : ''}`);
    }
    await api('/verdicts', { method: 'POST', body: JSON.stringify({ verdicts }) });
    total += verdicts.length;
  }
  console.log(`Checked ${total} score(s).`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
