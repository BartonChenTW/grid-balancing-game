# Notes for AI coding assistants

Follow the Load is a browser game about balancing Taiwan's power grid. Humans: see [CONTRIBUTING.md](CONTRIBUTING.md); this file sums up the same rules for assistants such as Claude Code.

## Commands

```sh
npm start                          # http://localhost:8000; add ?demo to let the autopilot play
npm test                           # must pass before any commit
node tools/balance-report.js       # every fleet × day must finish; also run with easy and hard
```

## Rules

- No build step and no dependencies: plain HTML, CSS and JavaScript modules.
- The simulation (`js/sim.js`, `units.js`, `auto.js`, `fleet.js`, `score.js`, `economics.js`, validation in `scenarios.js`) is pure: state in, state out, no DOM, no `Math.random` (use the seeded RNG).
- Tunable numbers go in `js/config.js` or `data/unit-types.json`, not in code.
- All UI text goes in `js/strings.js` and `js/strings-zh-TW.js`. Repository documents come in pairs (README, CONTRIBUTING, CHANGELOG): update both languages.
- Data needs `dataNotes` and `sources`, and must say honestly what is official, modelled or illustrative. Much of it comes from the [Taiwan energy model](https://github.com/BartonChenTW/taiwan-energy-model); CONTRIBUTING has the table.
- Anything that changes how a day plays needs a version bump and entries in both changelogs: leaderboard scores are replayed with the version they were played on. Never change what an old version replays.
- `leaderboard/` is deployed separately (see `leaderboard/DEPLOY.md`); never commit secrets or tokens.
- Charts: series colours are validated for colour-blind readers; keep categorical colours as CSS tokens in `css/style.css`.
- Ideas for what to build next are in [IDEAS.md](IDEAS.md).
