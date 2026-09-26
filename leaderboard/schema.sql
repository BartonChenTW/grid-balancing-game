-- Follow the Load leaderboard (Cloudflare D1 / SQLite).
CREATE TABLE IF NOT EXISTS scores (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  nickname    TEXT    NOT NULL,
  scenario    TEXT    NOT NULL,          -- e.g. taiwan-2025
  day         TEXT    NOT NULL,          -- e.g. summerWeekday
  difficulty  TEXT    NOT NULL,          -- easy | normal | hard
  options     TEXT,                      -- JSON {assist, accidents, autoStorage, ...}; NULL = the difficulty's defaults
  version     TEXT    NOT NULL,          -- game version the day was played on
  seed        INTEGER NOT NULL,
  moves       TEXT    NOT NULL,          -- JSON [[minute, tech, code], ...]
  points      INTEGER NOT NULL,
  stars       INTEGER NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
  reason      TEXT,                      -- why a score was rejected
  verified_at TEXT
);

CREATE INDEX IF NOT EXISTS scores_board ON scores (scenario, day, difficulty, status, points DESC);
CREATE INDEX IF NOT EXISTS scores_pending ON scores (status, id);
