// Verifies pending leaderboard scores by replaying each game with the exact
// game version it was played on (checked out from that version's git tag).
// Run by .github/workflows/verify-scores.yml; needs LEADERBOARD_URL and
// LEADERBOARD_ADMIN_TOKEN. Without them it does nothing.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/**
 * The git revision of a released version: its tag vX.Y.Z, or, without a tag,
 * the last commit on the main line (first parents) whose package.json has
 * that version. Null if neither exists.
 */
export function revisionOf(version) {
  try {
    git('rev-parse', '--verify', '--quiet', `refs/tags/v${version}`);
    return `v${version}`;
  } catch {
    // No tag: search the history of package.json.
  }
  const commits = git('log', '--first-parent', '--format=%H', 'HEAD', '--', 'package.json').split('\n').filter(Boolean);
  let newer = null;
  for (const commit of commits) {
    let at;
    try {
      at = JSON.parse(git('show', `${commit}:package.json`)).version;
    } catch {
      at = null;
    }
    // The version lasted until the next newer commit changed package.json.
    if (at === version) return newer ? `${newer}^1` : 'HEAD';
    newer = commit;
  }
  return null;
}

/** Game code and data for a version: the working tree for the current version, else its git revision. */
const versions = new Map();
async function loadVersion(version) {
  if (versions.has(version)) return versions.get(version);
  let dir = ROOT;
  const current = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  if (version !== current) {
    const revision = revisionOf(version);
    if (!revision) throw new Error(`no tag or commit for version ${version}`);
    dir = mkdtempSync(join(tmpdir(), `ftl-v${version}-`));
    const tar = join(dir, 'src.tar');
    execFileSync('git', ['-C', ROOT, 'archive', '--format=tar', '-o', tar, revision, 'js', 'data', 'package.json']);
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
  // Versions before options were recorded can only replay the difficulty's defaults.
  if (entry.options && !game.replay.REPLAYS_OPTIONS) {
    return { id: entry.id, status: 'rejected', reason: `version ${entry.version} cannot replay custom options` };
  }
  try {
    const scenario = JSON.parse(readFileSync(scenarioFile, 'utf8'));
    const { score } = game.replay.replayDay({
      scenario, day, types: game.types, difficulty: entry.difficulty, options: entry.options ?? undefined,
      seed: entry.seed, moves: entry.moves, cfg: game.config,
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

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
