# Ideas

Possible next steps for the game, collected on 2026-09-27 after the Taiwan energy model data went in (v0.7.0). Nothing here is planned or promised. Size: **S** is a few hours, **M** a day or two, **L** more.

Several ideas use data from the [Taiwan energy model](https://github.com/BartonChenTW/taiwan-energy-model) (TEM).

## More real data from the Taiwan energy model

| # | Idea | Size | Notes |
|---|---|---|---|
| 1 | **Real power stations for 2025** | S | Use Taipower's unit list (`data/official/taipower_units_20260924.json`, with `data/taipower_plant_mapping.csv`) so cards show actual plants and unit sizes (Taichung, Hsinta, Talin…) instead of illustrative counts. |
| 2 | **Weather-based days** | M | Set each day's wind and sun from TEM's full-year runs for 2013 and 2018 weather (`docs/data/cases/*.json`, demand and availability in 4-hour steps). Too coarse for the minute-by-minute shape, but it can set how windy or sunny each day type is. Note that the timestamps are UTC. |
| 3 | **Fuel blockade scenario** | M | An LNG shortage event or day from TEM's energy-security runs (`docs/data/security/cases/`). Gas units get a fuel budget that runs out, which shows Taiwan's import dependence. |
| 4 | **Taiwan 2034** | S | TEM also has the planned 2034 fleet (`data/fleet/custom_powerplants_tw2034.csv`). It fills the gap between 2030 and 2050. |
| 5 | **2050 choices** | M | Let players pick between TEM's 2050 runs (`docs/data/sector_pathway.json`): official options, the official power mix (gas with carbon capture), high import prices, or nuclear allowed. Each gets its own leaderboard board. |

## Gameplay

| # | Idea | Size | Notes |
|---|---|---|---|
| 6 | **Carbon price slider** | S | An optional NT$ per tonne of CO₂ added to fuel cost, like TEM's €467/t in 2050. Without it, coal is the cheapest fuel in the game and gets started before gas, even in 2050. With it, ammonia turbines make economic sense. |
| 7 | **Grid-forming batteries** | M | Batteries that give synthetic inertia on low-inertia grids. This is the real 2050 fix, and it shows why inverters matter. |
| 8 | **Vehicle-to-grid** | S | EVs as a flexible resource, sized from TEM's 60 GW of V2G in 2050, limited by how many cars are plugged in at each hour. |
| 9 | **Historical incidents as challenges** | M | Scripted days replaying real events, e.g. the 2021 Hsinta trip, the 2022-03-03 blackout, a typhoon cut-out, each with its own leaderboard. |
| 10 | **Week mode** | L | Several days in a row, with reservoir water and battery charge carried over and a weekly score. |

## Learning and sharing

| # | Idea | Size | Notes |
|---|---|---|---|
| 11 | **Compare with the model** | S | The end-of-day report shows the player's mix and costs next to what TEM's optimiser chose for that fleet. |
| 12 | **Daily challenge** | S | The same seed for everyone each day, with its own leaderboard. |
| 13 | **Teacher mode** | M | A shareable link that fixes the fleet, day and options for a class, with a class-only leaderboard. |

## Upkeep

| # | Idea | Size | Notes |
|---|---|---|---|
| 14 | **Tag releases automatically** | S | A GitHub Action that creates the `vX.Y.Z` tag when a new version reaches `main`. The score verifier now finds untagged versions in the history of `main`, but tags are still the clearer record. |

## Suggested order

For impact against effort: **6** (carbon price) first, because it fixes coal-first play in 2050 and ties the game to TEM's economics; then **1** (real power stations) and **12** (daily challenge).
