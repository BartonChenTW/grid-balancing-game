# PLAN.md — "Follow the Load" grid balancing game

## 1. Goal
A browser game where the player is a grid operator. Demand and renewables change
over a day; the player keeps supply = demand by dispatching units with realistic
start-up times and ramp rates. Core lesson: **grid stability comes from flexibility
(ability to follow load), not from constant baseload output.**
Context: Taiwan's isolated 60 Hz grid. Language: English for now (keep strings
separate so zh-TW can be added later).

## 2. Hard constraints
- 100% free and open: vanilla HTML/CSS/JS (ES modules), no build step, no backend,
  no paid services, no trackers.
- Runs as static files on GitHub Pages. Online only: ES modules and `fetch()` of
  JSON do not work from `file://`, so local development uses a static server
  (`npm start` runs the zero-dependency `tools/serve.js`).
- Libraries only if essential, loaded from a CDN with pinned versions (prefer none).
  Keep it light: charts drawn directly on `<canvas>`, rendering throttled
  separately from the simulation step.
- License: MIT for code, CC BY 4.0 for `data/` and text.
- Works on desktop and tablet (touch-friendly buttons ≥ 44px).

## 3. File structure
```
index.html
css/style.css
js/main.js          # UI wiring, game loop, rendering
js/config.js        # the single config object (all tunable numbers)
js/sim.js           # pure simulation logic (no DOM) — testable
js/units.js         # unit type definitions and state machine
js/scenarios.js     # loads + validates scenario JSON
js/strings.js       # all UI text (en), ready for zh-TW
data/unit-types.json
data/scenarios/taiwan-2016.json
data/scenarios/taiwan-2025.json
data/scenarios/taiwan-2050.json
tests/sim.test.js   # run with `node --test`
tools/serve.js      # local static server for development
package.json        # {"type": "module"} + scripts only, no dependencies
README.md, LICENSE, CONTRIBUTING.md
```

## 4. Simulation model
- **Time**: one in-game day (24 h) at 1-minute steps; default speed 1 real second =
  5 in-game minutes (day ≈ 5 min). Speeds: pause, 1×, 2×, 4×.
- **Balance**: `imbalance = Σ generation + discharge + DSM − (load + pumping + charging)`.
- **Frequency** (simplified swing equation):
  `df/dt = (f0 / (2 · H_sys · S_online)) · imbalance − D · (f − f0)`
  - f0 = 60 Hz; D = small load-damping term.
  - `H_sys` = capacity-weighted inertia of online *synchronous* units
    (coal/gas/nuclear/hydro high; solar/wind/battery ≈ 0).
    → High-renewable mixes have lower inertia, so frequency moves faster. This is a
    key teaching point; show inertia on screen.
  - Tune constants for playability, not physical accuracy. Keep them in one
    config object.
- **Frequency bands**:
  - 59.8–60.2 Hz: normal (green).
  - 59.5–59.8 or 60.2–60.5: warning (amber).
  - < 59.5: automatic under-frequency load shedding (drop 5% load per stage,
    penalty).
  - < 58.5 or > 61.5: blackout → game over.
- **Optional assist (toggle, default ON in Easy)**: automatic governor response that
  covers small imbalances from online units' headroom, so beginners are not
  overwhelmed.

## 5. Unit types (data/unit-types.json)
Each type has: `startupMin`, `shutdownMin`, `rampPctPerMin`, `minStablePct`,
`inertiaH`, `costPerMWh`, `co2PerMWh`, `dispatchable`, plus special fields.
Starting values (illustrative, tune for gameplay):

| Type | Start-up | Ramp (%/min) | Min stable | Inertia | Special |
|---|---|---|---|---|---|
| Nuclear | 48 h (effectively fixed) | 0.5 | 70% | high | cannot restart within the day |
| Coal | 8 h | 1.5 | 40% | high | |
| Gas CCGT | 2 h | 4 | 45% | high | |
| Gas OCGT | 15 min | 15 | 30% | medium | expensive |
| Hydro (run-of-river/dam) | 5 min | 50 | 10% | medium | limited daily energy |
| Pumped hydro | 5 min | 50 | 0% | medium | can pump (negative), storage in MWh |
| Battery | instant | 100 | 0% | 0 | charge/discharge, state of charge (SOC) limits |
| DSM | 2 min | 50 | 0% | 0 | max MW, max total activation minutes/day |
| Solar | – | – | – | 0 | follows profile; player can only curtail |
| Wind | – | – | – | 0 | follows profile + noise; curtail only |

Unit states: `offline → starting → online → stopping → offline`.
Players can only change output of `online` units, within
[minStable, max] and at the ramp rate toward a **setpoint**.

## 6. Scenario format (data/scenarios/*.json)
```json
{
  "id": "taiwan-2025",
  "name": "Taiwan 2025",
  "description": "After nuclear phase-out; LNG-heavy with growing solar.",
  "peakLoadMW": 41000,
  "profiles": {
    "load":  [/* 96 values, 15-min, normalised 0–1 */],
    "solar": [/* 96 values, capacity factor */],
    "wind":  [/* 96 values, capacity factor */]
  },
  "units": [
    { "type": "coal", "name": "Coal block A", "maxMW": 4000, "initialState": "online", "initialPct": 70 }
  ],
  "events": [
    { "timeMin": 900, "type": "trip", "unit": "Gas block C", "message": "Gas block C tripped!" }
  ]
}
```
- Interpolate profiles to 1-min steps; add small random noise to load and wind
  (seeded RNG so a scenario is reproducible).
- Aggregate real fleets into 6–15 blocks per scenario so the UI stays playable.
- Initial capacities are **placeholders to verify** against Taipower open data
  (generation by unit, 10-min resolution) and Taiwan's 2050 net-zero pathway.
  Mark this with `"dataStatus": "placeholder"` and cite sources in README.

Scenarios to ship:
1. **Taiwan 2016**: coal + nuclear heavy, little solar. Relatively easy.
2. **Taiwan 2025**: no nuclear, lots of LNG, solar midday peak → steep evening ramp.
3. **Taiwan 2050**: high solar + offshore wind, large battery/pumped hydro/DSM, low inertia.
4. **Custom mix**: player sets capacity of each type with sliders
   (constraint: total firm + storage capacity shown vs peak load).

Events (optional per scenario): unit trip (e.g. the 2022 Hsinta blackout),
typhoon (wind cut-out), passing clouds (solar drop).

## 7. UI layout
- **Top**: frequency gauge (big, colour-coded) + clock + speed controls.
- **Main chart**: rolling 24-h plot of demand vs total supply, stacked by
  technology; show forecast demand line ahead of current time
  (player can plan ahead).
- **Unit panel**: one card per unit showing name, type icon, state,
  output / setpoint / max, ramp-limited progress bar, buttons
  `−` `+` (step = 5% of max; hold to repeat) and `Start` / `Stop`.
  Storage cards also show SOC; DSM shows remaining activation.
- **Side panel**: current inertia, reserve margin (online headroom), cost, CO₂,
  curtailed RE.
- Keyboard shortcuts: space = pause, number keys select unit, ↑/↓ = +/−.

## 8. Scoring and end screen
- Score components: % of time in normal band, number of load-shedding events,
  total cost, total CO₂, curtailed RE.
- End screen: summary + one-line lesson tailored to what happened
  (e.g. "Your coal was at full output but couldn't ramp for the evening peak.").
- Difficulty: Easy (assist on, forecasts accurate), Normal, Hard (assist off,
  forecast error, events).

## 9. Milestones (implement one at a time, stop after each)
**M1 — Core loop.** `sim.js` with time stepping, balance, frequency, one hard-coded
mini scenario (1 load profile, 3 units: coal, gas OCGT, battery). Minimal UI:
frequency number, demand vs supply numbers, +/− buttons.
Accept: game runs, frequency responds to imbalance, ramp limits enforced,
`node --test` passes for ramping and frequency sign.

**M2 — Unit mechanics.** All unit types, state machine, start-up delays, min stable
load, storage SOC, DSM limits, RE curtailment. Unit cards UI.
Accept: tests for each unit type's constraints.

**M3 — Scenarios.** JSON loading + validation, the 3 Taiwan scenarios + custom mix,
start screen to pick scenario and difficulty.
Accept: invalid JSON gives a clear error; switching scenarios resets cleanly.

**M4 — Visuals and feedback.** Stacked supply chart, frequency gauge with bands,
inertia/reserve indicators, load shedding and blackout states, events.

**M5 — Scoring, end screen, tutorial.** Score, tailored lesson, a 5-step
first-play tutorial overlay explaining "follow the load".

**M6 — Polish and release.** Responsive layout, accessibility (focus states,
colour-blind safe palette, reduced motion), README with screenshots,
play link and data sources, GitHub Pages deployment check, `strings.js` ready for zh-TW.

## 10. Coding guidelines
- Keep `sim.js` pure (state in → state out) so it is testable and reusable.
- All tunable numbers in one `config` object; no magic numbers in UI code.
- Small commits per feature with clear messages.
- Comment the physics simplifications so educators can see what's approximate.
