# Changelog

The version and release date are shown in the game's header, so you can check which version you are playing.

## 0.4.0 — 2026-09-25

- Side panel: live **CO₂ intensity** bar (kg/kWh, split into coal, gas and oil) with today’s average and total.
- Side panel: live **fuel cost** bar (NT$/kWh, split into nuclear, coal, gas, oil and hydro/DSM) with the cost per hour, today’s total and how much of it went on gas and oil. Units kept warm on standby count as burning fuel.
- End-of-day summary shows the gas and oil share of the cost.

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
