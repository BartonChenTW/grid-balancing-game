# Changelog

**English** | [繁體中文](CHANGELOG.zh-TW.md)

The version and release date are shown in the game's header, so you can check which version you are playing.

## 0.6.2 — 2026-09-26

- **Every difficulty counts on the leaderboard, whatever the options.** Any game on a Taiwan fleet can submit its score. Games played with options other than the difficulty’s defaults (assist, accidents, Auto) are ranked on the same board with a “custom options” tag, and are verified by replaying them with those options.

## 0.6.1 — 2026-09-26

- **The leaderboard is live.** Ranked games can now submit their score; it is checked by replaying the day within about 30 minutes.

## 0.6.0 — 2026-09-25

- **Leaderboard (ready, switched on after deployment).** Ranked games (a Taiwan fleet with the difficulty’s default options) can submit a nickname and score at the end of the day. Scores appear at once, marked “checking”, and are replayed move by move by a GitHub Action every 30 minutes using the exact game version they were played on; verified scores get a ✓, fakes are removed. The setup screen previews the top scores for the chosen fleet, day and difficulty and says whether your options are ranked. Backend: a Cloudflare Worker with a D1 database in `leaderboard/` (deploy steps in `leaderboard/DEPLOY.md`). Stored: nickname, score, settings and moves; no email, no IP addresses.
- The game records your moves so a day can be replayed exactly (`js/replay.js`).

## 0.5.0 — 2026-09-25

- **Download a report** when the day ends: a self-contained HTML page (setup, score and the three KPIs, key numbers, lesson, system cost, the day’s chart and frequency strip, and the control-room log) that you can open anywhere or print to PDF, plus **minute-by-minute data as CSV**. Made in your browser; nothing is uploaded.
- Keyboard: ↑/↓ change the output of the selected technology; **←/→ take a unit offline or bring one online**. The keys act on the card you are in, and the changed number flashes.
- Unit counts are clearer: Online and Standby show units actually in that state, with “+1 starting”, “−1 stopping” or “+1 warming up” shown next to them.
- Shorter side panel: imbalance moved into the top bar next to the frequency; inertia, spinning reserve, auto response and curtailment removed from the panel; the fuel-cost breakdown by source folds open on request.

## 0.4.5 — 2026-09-25

- The LinkedIn link is removed from the game and the READMEs.

## 0.4.4 — 2026-09-25

- The core lesson is shortened to: “Stability comes from flexibility, the ability to follow the load.”

## 0.4.3 — 2026-09-25

- Contact and source links on every screen of the game: the author, email, feedback via GitHub issues, and the source code on GitHub.
- The GitHub repository is bilingual: README, contributing guide and changelog in English and Traditional Chinese, and bilingual issue forms for feedback and bug reports.

## 0.4.2 — 2026-09-25

- The overall system cost is now a **range** (e.g. NT$ 141–262 bn per year for Taiwan 2025, central 201) using the cost data of the Taiwan PyPSA-Earth model (https://bartonchentw.github.io/pypsa-earth/): technology-data 2030 build costs and lifetimes (2013 euros at NT$ 36.185/€), its ±30% investment uncertainty and its 5–10% discount-rate range (default 7.1%). Batteries count inverter and storage separately; wind blends onshore and offshore costs by each fleet’s offshore share.

## 0.4.1 — 2026-09-25

- **Overall system cost** on the setup screen: the capital cost of building the fleet, levelised over each technology’s lifetime at a discount rate (slider, default 5%), in NT$ per year, with a breakdown by technology. Works for every fleet and updates live in the custom mix. Build costs are rough, illustrative figures.
- Storage losses are shown: storage cards show their round-trip efficiency (battery 90%, pumped hydro 75%) and the energy lost so far today; the setup summary lists each storage type’s efficiency; the end screen shows the total lost in storage.
- “Auto for everything” switch in setup.

## 0.4.0 — 2026-09-25

- **Score from three KPIs**, each 0–100: reliability (time in the normal band, minus load shedding, weight 50%), cost (NT$/kWh, weight 25%) and carbon (g CO₂/kWh, weight 25%). The end screen shows each KPI with its value and sub-score.
- **Every technology can be put on Auto**: nuclear, coal and gas follow the load; gas peakers and oil are backup; hydro covers shortfalls while pacing its water; solar and wind are curtailed only when there is a surplus nothing else can absorb. New setup options for load following and for hydro, solar and wind.
- Wind is simply “Wind” (onshore and offshore) in the 2050 fleet.
- Side panel: live **CO₂ intensity** bar (g/kWh, split into coal, gas and oil) with today’s average and total.
- Side panel: live **fuel cost** bar (NT$/kWh, split into nuclear, coal, gas, oil and hydro/DSM) with the cost per hour, today’s total and how much of it went on gas and oil. Units kept warm on standby count as burning fuel.
- Under the bars, each source’s own fuel cost per kWh and share of generation right now; solar, wind and storage show NT$ 0 (no fuel).
- End-of-day summary shows generation cost in NT$/kWh, CO₂ intensity in g/kWh and the amount spent on gas and oil.
- The control-room log shows the newest 3 messages, with “Show all” to expand.
- The load-shedding label is shown in red even after frequency recovers.

## 0.3.0 — 2026-09-24

Player feedback round 1.

- One card per technology (e.g. 27 coal units): set how many units are online, on warm standby or offline. Standby units start much faster (coal 1 h instead of 8 h) but cost money to keep warm.
- Auto mode for storage and demand response, and gas peakers as automatic backup (switch per card, defaults in setup).
- Accidents setting: none, scheduled, random, or both. Random accidents: unit trips, clouds, sudden wind drops, demand surges.
- Setup summary breaks down firm, storage and renewable capacity by technology.
- A compact demand/supply chart stays in view while scrolling through the unit cards.
- Version and release date shown in the header.

## 0.2.0 — 2026-09-24

The full game.

- Three steps: About → Set up → Operate.
- Taiwan 2016 and 2025 fleets from official annual figures, a 2050 net-zero what-if, and a custom mix.
- Six day types: summer and winter weekday and weekend, Lunar New Year, typhoon day.
- All unit types (nuclear, coal, gas, oil, hydro, pumped hydro, batteries, demand response, solar, wind) with start-up times, ramp limits, storage and energy limits.
- Demand/supply chart with forecasts and a frequency strip; unit cards; control-room log.
- Automatic battery frequency response, optional assist, under-frequency load shedding, blackout.
- Scheduled events: typhoon wind cut-out with warning, clouds, unit trips inspired by 2017 Datan and 2022 Hsinta.
- Score, stars and an end-of-day lesson; five-step tutorial; demo mode (`?demo`).
- English and 繁體中文; works on phones; dark mode.

## 0.1.0 — 2026-09-24

First playable core loop: one small grid (coal, gas peaker, battery), frequency from the swing equation, ramp limits, minimal controls.
