// Leaderboard client: talks to the Cloudflare Worker in leaderboard/ and
// renders a board. Everything here is off while config.leaderboard.url is empty.
import { formatNumber, t } from './strings.js';

export function leaderboardEnabled(cfg) {
  return Boolean(cfg.leaderboard?.url);
}

async function call(cfg, path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.leaderboard.timeoutMs);
  try {
    const res = await fetch(`${cfg.leaderboard.url.replace(/\/$/, '')}${path}`, { ...options, signal: controller.signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/** Top scores of one board: { scenario, day, difficulty }. */
export function fetchTop(cfg, board, limit) {
  const q = new URLSearchParams({ ...board, limit: String(limit) });
  return call(cfg, `/scores?${q}`).then((r) => r.scores ?? []);
}

/** Submits a score; resolves to { id, rank, status }. */
export function submitScore(cfg, payload) {
  return call(cfg, '/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
}

/** Fills an <ol> with scores; `highlightId` marks the player's own entry. */
export function renderBoard(list, scores, highlightId = null) {
  if (!scores.length) {
    const li = document.createElement('li');
    li.className = 'lb-empty';
    li.textContent = t('lb.empty');
    list.replaceChildren(li);
    return;
  }
  list.replaceChildren(
    ...scores.map((s, i) => {
      const li = document.createElement('li');
      if (s.id === highlightId) li.className = 'lb-you';
      const rank = document.createElement('span');
      rank.className = 'lb-rank';
      rank.textContent = `${i + 1}`;
      const name = document.createElement('span');
      name.className = 'lb-name';
      name.textContent = s.nickname; // player-supplied: always as text
      const points = document.createElement('strong');
      points.className = 'lb-points';
      points.textContent = formatNumber(s.points);
      const status = document.createElement('span');
      status.className = `lb-state lb-${s.status}`;
      status.textContent = s.status === 'verified' ? `✓ ${t('lb.verified')}` : t('lb.checking');
      li.append(rank, name, points, status);
      return li;
    }),
  );
}

const NICK_KEY = 'ftl.nickname';
export function savedNickname() {
  try {
    return localStorage.getItem(NICK_KEY) ?? '';
  } catch {
    return '';
  }
}
export function saveNickname(name) {
  try {
    localStorage.setItem(NICK_KEY, name);
  } catch {
    // Without storage the nickname is simply not remembered.
  }
}
