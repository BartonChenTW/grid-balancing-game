# Follow the Load

A free browser game about keeping Taiwan's island power grid at 60 Hz for one day.

You are the grid operator. Demand rises and falls, the sun sets, typhoons shut down wind farms, and a power station trips without warning. You dispatch coal, gas, nuclear, hydro, storage, demand response and renewables, each with realistic start-up times and ramp rates, to keep supply equal to demand.

**The lesson:** grid stability comes from *flexibility*, the ability to follow the load, not from running big plants flat out.

![Operating Taiwan's 2025 grid on a summer weekday](docs/screenshots/play.png)

## Play

- **Online:** enable GitHub Pages for this repository (Settings → Pages → deploy from branch `main`, folder `/`). The game is then at `https://<user>.github.io/<repo>/`.
- **Locally:** you need [Node.js](https://nodejs.org/) 20 or newer (no packages to install).

  ```sh
  npm start        # serves the game at http://localhost:8000
  ```

  Opening `index.html` directly from the folder does not work: browsers block ES modules and data files on `file://` pages.

Add `?demo` to the URL (e.g. `http://localhost:8000/?demo`) to watch a scripted operator play.

The game is in **English and Traditional Chinese (繁體中文)**. It follows the browser language, and the button in the header switches between them.

### How a game works

1. **About:** what the game is about and your goal.
2. **Set up:** pick a fleet (Taiwan 2016, 2025, 2050, or your own mix), a day (summer or winter, weekday or weekend, Lunar New Year, typhoon) and a difficulty. Options: accidents (none, scheduled, random, or both), the assist, automatic storage and demand response, and gas peakers as automatic backup.
3. **Operate:** follow the demand forecast. Slow plants need hours to start; fast ones, storage and demand response handle the swings. Keep frequency in the green band until midnight.

At the end you get a score, the key numbers (time in band, load shedding, cost, CO₂, renewable share, curtailment) and a one-line lesson based on what happened.

| Setup | Phone |
|---|---|
| ![Setup screen](docs/screenshots/setup.png) | ![Playing on a phone](docs/screenshots/phone.png) |

Keyboard: **Space** pauses, **1–9, 0** select a unit, **↑/↓** adjust it. On the chart, **←/→** move the readout.

## What is simulated

All game rules are in [js/sim.js](js/sim.js) and [js/units.js](js/units.js), which are pure functions with no browser code, so they can be tested and reused. Every tunable number is in [js/config.js](js/config.js) and [data/unit-types.json](data/unit-types.json).

- **Balance and frequency.** A single-mass swing equation: `df/dt = f0 / (2·Ek) · imbalance − D·(f − f0)`, where `Ek = Σ H·S` is the kinetic energy of spinning (synchronous) machines. Solar, wind and batteries add none, so high-renewable grids move faster. Time is compressed from seconds to game minutes so you can see it happen.
- **Fleets of units.** Each technology is one card made of identical units (e.g. 27 coal units of about 700 MW). You set how many are **online**, on warm **standby**, or **offline**, and move the output of all online units together. Units go `offline → warming → standby → starting → online → stopping`: a cold start takes hours (coal 8 h, gas CCGT 2 h, peakers 15 min), from standby much less (coal 1 h, CCGT 30 min, peakers 5 min), and keeping units warm costs money. Units have ramp limits and minimum stable output; nuclear cannot restart within the day. Hydro has a daily water budget, storage a state of charge and round-trip losses, and demand response a daily activation limit. Solar and wind follow the weather and can only be curtailed.
- **Automatic response.** Batteries respond to frequency on their own, as Taipower's battery frequency-regulation services do. The optional *assist* adds a governor response on all dispatchable units.
- **Auto modes** (a switch on each card, defaults in setup). Storage charges in a surplus and discharges in a shortfall; gas peakers wait on standby and start when supply runs short (backup); demand response steps in last. See [js/auto.js](js/auto.js).
- **Protection.** Below 59.5 Hz, under-frequency relays disconnect 5% of demand per stage; operators reconnect customers only when there is reserve to carry them. Below 58.5 Hz or above 61.5 Hz the grid blacks out.
- **Accidents.** *Scheduled* events happen at fixed times: unit trips inspired by the 2017 Datan and 2022 Hsinta events, passing clouds, and typhoon wind cut-out announced hours ahead. *Random* accidents strike at random times: units tripping, clouds, sudden wind drops and demand surges.

These are deliberate simplifications for teaching: one node with no transmission limits, no voltage, no reactive power, and constants tuned for playability rather than accuracy. The code comments say where.

## Data sources

| What | Status | Source |
|---|---|---|
| Annual peak load (2016, 2025) | Official | Taipower, 歷年尖峰負載及備用容量率, [data.gov.tw/dataset/8307](https://data.gov.tw/dataset/8307) |
| Installed capacity by source (2016, 2025) | Official | Energy Administration, 發電裝置容量年資料, [data.gov.tw/dataset/16480](https://data.gov.tw/dataset/16480) |
| Grid storage target, demand growth | Official outlook | MOEA, 全國電力資源供需報告, [data.gov.tw/dataset/16437](https://data.gov.tw/dataset/16437) |
| 2050 renewable share (60–70%) | Official target, to verify | NDC, 臺灣2050淨零排放路徑, [ncsd.ndc.gov.tw](https://ncsd.ndc.gov.tw/Fore/nsdn/about0/2050Path) |
| Daily demand shapes, solar and wind profiles | **Placeholder** | Hand-drawn in [tools/make-days.js](tools/make-days.js), scaled to the real peaks |
| Unit parameters, costs, storage sizes, the 2050 fleet | **Illustrative** | Chosen for gameplay |

The annual figures were compiled in [BartonChenTW/pypsa-earth (pypsa-taiwan-dev)](https://github.com/BartonChenTW/pypsa-earth/tree/pypsa-taiwan-dev), `docs/data/taiwan_timeseries.csv`, which records the source of every value. Each scenario file in [data/scenarios/](data/scenarios/) has `dataStatus`, `dataNotes` and `sources` fields, and the setup screen shows them under "About the data".

**Wanted:** measured Taipower 10-minute load and solar/wind curves for typical days, to replace the placeholder day shapes. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

```sh
npm test                           # 50+ tests: units, simulation, data validation, scoring
node tools/balance-report.js       # the scripted operator plays every scenario × day
node tools/balance-report.js hard  # …on Hard
node tools/make-days.js            # regenerate data/days.json
```

No build step, no dependencies, no trackers. Plain HTML, CSS and JavaScript modules.

```
index.html            three screens: about, set up, operate
css/style.css         layout, light and dark themes, phone layout
js/main.js            loads data, moves between screens
js/setup.js           step 2: fleet, day, difficulty, custom mix
js/play.js            step 3: game loop, unit cards, side panel, end dialog
js/chart.js           demand/supply chart and frequency strip (canvas)
js/tutorial.js        first-play tips
js/sim.js             simulation (pure)
js/units.js           unit state machine and limits (pure)
js/fleet.js           technology-level commands and summaries for the cards (pure)
js/auto.js            automatic storage, demand response and peaker backup (pure)
js/scenarios.js       data loading, validation, world building, custom mix
js/score.js           score and end-of-day lesson
js/config.js          every tunable number
js/strings.js         all UI text (English) and language switching
js/strings-zh-TW.js   繁體中文 text
data/                 unit types, day types, Taiwan scenarios
tools/                dev server, day generator, autopilot, balance report
tests/                node --test suites
```

## License

- Code: [MIT](LICENSE).
- Data in `data/` and the game text: [CC BY 4.0](LICENSE-DATA.md). Official source data is published under the [Open Government Data License, version 1.0](https://data.gov.tw/license).
