# Deploying the leaderboard

After the first setup, the Worker deploys itself from GitHub Actions (see
“Updating the live Worker”). Run the first setup in a **Claude Code cloud
session** (claude.ai/code) or on a personal computer, not on a work computer.
Nothing here is needed to play the game;
the leaderboard stays hidden until `leaderboard.url` is set in `js/config.js`.

## How it works

- `worker.js` (Cloudflare Worker) stores submitted scores in a D1 database as
  **pending** and serves the top scores. Pending scores show as “checking”.
- `.github/workflows/verify-scores.yml` runs every 30 minutes: it fetches
  pending scores, replays each game with the exact game version it was played
  on (from that version's git tag) and marks it **verified** or **rejected**.
  Rejected scores disappear from the board. It also replays verified scores
  saved without KPIs (before 0.9.0) and fills their KPIs in.
- `.github/workflows/deploy-leaderboard.yml` applies new database migrations
  and redeploys the Worker whenever `worker.js`, `validate.js`,
  `wrangler.toml` or `migrations/` change on `main`. New game versions alone
  need no redeploy.

## Before you start

1. A Cloudflare account with a `workers.dev` subdomain (Dashboard → Compute →
   Workers & Pages; set it up there if asked).
2. A Cloudflare API token (profile → API Tokens → Create Token → Custom token)
   with **Account › Workers Scripts › Edit** and **Account › D1 › Edit**,
   limited to your account, with an expiry date.
3. In the Claude Code cloud environment for this repo, secret environment
   variables `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
   Never paste the token into a chat.

## Steps (cloud session)

```sh
cd leaderboard

# 1. Create the database, then put its id into wrangler.toml (database_id).
npx wrangler@4 d1 create follow-the-load

# 2. Create the table (applies migrations/ in order).
npx wrangler@4 d1 migrations apply follow-the-load --remote

# 3. Admin token for the verification job: generate it and store it as a
#    Worker secret without printing it.
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" > /tmp/admin_token
npx wrangler@4 secret put ADMIN_TOKEN < /tmp/admin_token

# 4. Deploy. Note the URL it prints (https://follow-the-load-leaderboard.<subdomain>.workers.dev).
npx wrangler@4 deploy

# 5. Smoke test.
curl -s https://follow-the-load-leaderboard.<subdomain>.workers.dev/
curl -s "https://follow-the-load-leaderboard.<subdomain>.workers.dev/scores?scenario=taiwan-2025&day=summerWeekday&difficulty=normal"
```

6. **GitHub repository secrets** (Settings → Secrets and variables → Actions):
   - `LEADERBOARD_URL`: the Worker URL from step 4.
   - `LEADERBOARD_ADMIN_TOKEN`: the contents of `/tmp/admin_token`.
   If the GitHub CLI is signed in with admin rights, from the session:
   `gh secret set LEADERBOARD_ADMIN_TOKEN < /tmp/admin_token` and
   `gh secret set LEADERBOARD_URL --body "<url>"`. Then `rm /tmp/admin_token`.
7. Turn the leaderboard on: set `leaderboard.url` in `js/config.js` to the
   Worker URL, commit `wrangler.toml` (database id) and `js/config.js`, release
   a new version (see CONTRIBUTING.md), and push.
8. Run the verification job once by hand to check it: Actions →
   “verify leaderboard scores” → Run workflow (or `gh workflow run verify-scores.yml`).

## Updating the live Worker

Automatic: merging a change to the Worker's files into `main` runs
*deploy leaderboard* (`.github/workflows/deploy-leaderboard.yml`). It needs two
repository secrets (Settings → Secrets and variables → Actions):
`CLOUDFLARE_API_TOKEN` (the token above) and `CLOUDFLARE_ACCOUNT_ID`. To run
it by hand: Actions → “deploy leaderboard” → Run workflow.

A database change is a new numbered file in `migrations/` (e.g.
`0003_something.sql`). Never edit a migration that has been applied: Cloudflare
remembers which ones ran and applies only the new ones, before the deploy.

## Moderation

Remove a score (e.g. an offensive nickname):

```sh
curl -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" https://<worker-url>/scores/<id>
```

or delete the row in the Cloudflare dashboard (Storage & databases → D1 → follow-the-load → Console).

## Privacy

Stored per score: nickname, fleet, day, difficulty, options, game version, seed, moves,
points, stars, the three KPI values (reliability, cost, CO₂ intensity) and
status. No email. Request logging is off (`[observability]
enabled = false`), so the leaderboard keeps no IP addresses.
