# Changelog

**English** | [繁體中文](CHANGELOG.zh-TW.md)

The version and release date are shown in the game's header, so you can check which version you are playing.

## 0.10.0 — 2026-09-29

- **Taiwan 2050 demand is flatter and its peak lower (61.4 GW instead of 66 GW).** The extra demand over 2025 (about 180 TWh a year) comes mostly from chip fabs and data centres, which run around the clock, so it is now a flat 20.6 GW on top of today's daily curve instead of a scaled-up evening peak. The year's total stays at the model's 471 TWh. Summer evenings are still the hardest part of 2050, but no longer impossible.
- The setup screen now compares firm plants and storage with the highest demand that solar cannot cover (usually the evening), instead of the midday peak that solar covers.

## 0.9.1 — 2026-09-29

- **Older leaderboard scores now show their KPIs too.** The verification job replays scores submitted before 0.9.0 from their saved moves and fills in their reliability, cost and CO₂ intensity.

## 0.9.0 — 2026-09-29

- **The leaderboard shows the three KPIs** under each nickname: reliability (time in the normal band), generation cost (NT$/kWh) and CO₂ intensity (g/kWh), so you can see how a score was earned. They are checked by the same replay as the points. Scores submitted before this version show without them.

## 0.8.0 — 2026-09-27

- **Real power stations in Taiwan 2025.** Every coal, gas and oil unit now has its real name and size from Taipower's unit list (Linkou 1, Taichung 5, Tatan 8…). Cards show the size range, and a trip names the unit that fell off. The fleet is now Taipower's own system, the one its peak load is measured on: 11.4 GW of coal and 22.3 GW of gas, instead of national totals that included industrial self-generation.
- **Real weather.** Each day's sun and wind follow a real date from the Taiwan energy model's weather years, for example 24 July 2018 for the summer weekday, 24 January 2018 for the winter weekday and Typhoon Trami (21 August 2013). Summer days are much calmer and winter days much windier than before.
- **New day: LNG blockade**, from the model's energy-security runs. On day 5 of a blockade only about a fifth of the gas fleet has fuel, and demand is rationed by 40%. Gas-heavy Taiwan 2025 feels it most.
- If a fleet is still short at midnight, warm reserves on standby (such as 2050's coal) are started.

## 0.7.0 — 2026-09-27

- **Taiwan 2050 now follows the [Taiwan energy model](https://github.com/BartonChenTW/taiwan-energy-model)**, from its main 2050 run (net zero, no new nuclear, imported carbon-neutral fuels). It has 80 GW of solar, 61 GW of wind (82% offshore), 15.6 GW of gas and 13.2 GW of ammonia combined cycle, 6.2 GW of geothermal, 2 GW of biomass and 4 GW of coal kept on standby as a reserve. Peak load is about 66 GW. The model builds almost no batteries (its daily steps undervalue them), so batteries use the official 5.5 GW target. With less storage than before, sunset and calm summer nights are now the hard part.
- **New fleet: Taiwan 2030**, the official plan from the MOEA supply-demand report (via the model): 32.4 GW gas, 9.7 GW coal, 31.2 GW solar, 11.9 GW wind (92% offshore), 1.2 GW geothermal, 0.8 GW biomass and 5.5 GW of batteries (official target). Peak load 45.2 GW.
- **Fuel costs and CO₂ come from the model**: its 2030 fuel prices, efficiencies and running costs replace the placeholder costs (e.g. gas combined cycle NT$1.69/kWh instead of 3.20, coal NT$1.09 instead of 1.80). The cost score's range moves with them (NT$0.85–2.6/kWh), so a careful day scores about the same as before.
- New technologies: **geothermal** (baseload), **biomass** and **ammonia turbines** (zero CO₂). They are also in the custom mix, and chart and fuel labels name them when a fleet has them.
- If a fleet is short at midnight, batteries now discharge from the first minute.
- Fix: scores played on a version without a git tag (0.6.2, 0.6.3) were rejected as “unknown game version”. The verifier now finds the version in the history of `main`.

## 0.6.3 — 2026-09-26

- **Storage is now purple** in the chart and everywhere else, so it no longer looks like wind (both were green). The new colour was checked for colour-blind readers against every other series, in light and dark mode.

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
