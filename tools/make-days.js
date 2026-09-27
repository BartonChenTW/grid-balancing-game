// Generates data/days.json: hourly demand shapes and renewable capacity
// factors for each day type. Run: `node tools/make-days.js`
//
// DEMAND IS PLACEHOLDER DATA. The demand shapes are hand-drawn to resemble
// typical Taiwanese daily load curves (night trough, lunchtime dip, afternoon
// peak in summer, evening peak in winter) and are scaled in-game to the real
// annual peak of each scenario. Replace them with measured Taipower curves
// when available (see README "Data sources").
//
// SUN AND WIND FOLLOW REAL DATES. data/weather-days.json (from
// tools/import-weather.js) holds 4-hour capacity factors for one real date per
// day type from the Taiwan energy model's weather years. Wind follows those
// windows through the day; the solar curve keeps its smooth shape and is
// scaled to that date's solar energy.
import { readFileSync, writeFileSync } from 'node:fs';

const round = (x) => Math.round(x * 1000) / 1000;

/** Solar capacity factor at hour h for a clear-ish day: a sine hump between sunrise and sunset. */
function solarCurve(h, sunrise, sunset, peak) {
  if (h <= sunrise || h >= sunset) return 0;
  return peak * Math.sin((Math.PI * (h - sunrise)) / (sunset - sunrise)) ** 1.3;
}

const hours = [...Array(24).keys()];
const WEATHER = JSON.parse(readFileSync(new URL('../data/weather-days.json', import.meta.url), 'utf8')).days;
const OFFSHORE_SHARE = 0.8; // offshore/onshore mix of Taiwan's wind fleet (0.78 in 2025, 0.82 in 2050)
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Solar curve between sunrise and sunset, scaled so its daily mean is the real date's. */
function solar(id, sunrise, sunset) {
  const shape = hours.map((h) => solarCurve(h, sunrise, sunset, 1));
  const peak = mean(WEATHER[id].solar) / mean(shape);
  return shape.map((x) => round(x * peak));
}

/**
 * Hourly wind from the six 4-hour windows of the real date: each window's mean
 * sits at its middle hour (02:00, 06:00, …, 22:00) and hours in between are
 * interpolated; the day wraps around, as profiles do in the game.
 */
function wind(id) {
  const w = WEATHER[id];
  const windows = w.offwind.map((off, k) => OFFSHORE_SHARE * off + (1 - OFFSHORE_SHARE) * w.onwind[k]);
  return hours.map((h) => {
    const pos = (((h - 2) / 4) % 6 + 6) % 6;
    const k = Math.floor(pos);
    return round(windows[k] + (windows[(k + 1) % 6] - windows[k]) * (pos - k));
  });
}
const weather = (id) => ({ date: WEATHER[id].date, source: WEATHER[id].source });

const days = [
  {
    id: 'summerWeekday',
    name: 'Summer weekday',
    description: 'A hot Tuesday in July. Air-conditioning drives demand to the year\'s peak in the early afternoon; solar is strong until sunset.',
    month: 7,
    weekday: 2,
    peakRatio: 1.0,
    load: [0.8, 0.77, 0.75, 0.73, 0.72, 0.72, 0.74, 0.8, 0.88, 0.94, 0.97, 0.98, 0.93, 0.97, 1.0, 1.0, 0.98, 0.96, 0.95, 0.95, 0.94, 0.91, 0.87, 0.83],
    solar: solar('summerWeekday', 5.3, 18.7),
    wind: wind('summerWeekday'),
    weather: weather('summerWeekday'),
    events: [{ timeMin: 780, type: 'clouds', factor: 0.45, durationMin: 50 }],
  },
  {
    id: 'summerWeekend',
    name: 'Summer weekend',
    description: 'A Sunday in July. Offices and factories are quieter; demand peaks in the evening when people are home.',
    month: 7,
    weekday: 0,
    peakRatio: 0.86,
    load: [0.82, 0.78, 0.75, 0.73, 0.71, 0.7, 0.7, 0.73, 0.78, 0.83, 0.87, 0.89, 0.88, 0.89, 0.91, 0.93, 0.94, 0.95, 0.97, 1.0, 0.99, 0.96, 0.92, 0.86],
    solar: solar('summerWeekend', 5.3, 18.7),
    wind: wind('summerWeekend'),
    weather: weather('summerWeekend'),
    events: [],
  },
  {
    id: 'winterWeekday',
    name: 'Winter weekday',
    description: 'A Wednesday in January. Lower demand, short days with weaker sun, and strong northeast-monsoon winds.',
    month: 1,
    weekday: 3,
    peakRatio: 0.78,
    load: [0.7, 0.66, 0.64, 0.63, 0.63, 0.66, 0.72, 0.82, 0.92, 0.97, 0.99, 0.99, 0.92, 0.96, 0.98, 0.97, 0.96, 0.97, 1.0, 0.99, 0.95, 0.89, 0.82, 0.76],
    solar: solar('winterWeekday', 6.5, 17.4),
    wind: wind('winterWeekday'),
    weather: weather('winterWeekday'),
    events: [],
  },
  {
    id: 'winterWeekend',
    name: 'Winter weekend',
    description: 'A Saturday in January. Low demand with plenty of wind and midday sun: watch for too much generation.',
    month: 1,
    weekday: 6,
    peakRatio: 0.68,
    load: [0.76, 0.72, 0.7, 0.68, 0.67, 0.68, 0.71, 0.76, 0.83, 0.88, 0.91, 0.92, 0.9, 0.9, 0.9, 0.9, 0.91, 0.95, 1.0, 0.99, 0.95, 0.9, 0.85, 0.8],
    solar: solar('winterWeekend', 6.5, 17.4),
    wind: wind('winterWeekend'),
    weather: weather('winterWeekend'),
    events: [],
  },
  {
    id: 'lunarNewYear',
    name: 'Lunar New Year',
    description: 'Factories close for the holiday and demand falls to its lowest of the year, while sun and wind keep producing.',
    month: 2,
    weekday: 5,
    peakRatio: 0.56,
    load: [0.82, 0.78, 0.75, 0.73, 0.72, 0.72, 0.73, 0.76, 0.8, 0.85, 0.89, 0.91, 0.9, 0.9, 0.9, 0.9, 0.91, 0.95, 1.0, 0.99, 0.97, 0.94, 0.9, 0.86],
    solar: solar('lunarNewYear', 6.4, 17.7),
    wind: wind('lunarNewYear'),
    weather: weather('lunarNewYear'),
    events: [],
  },
  {
    id: 'typhoon',
    name: 'Typhoon day',
    description: 'A typhoon day off in August. Offices close, clouds block the sun, and in the afternoon the wind becomes too strong: turbines shut down to protect themselves.',
    month: 8,
    weekday: 3,
    peakRatio: 0.8,
    load: [0.84, 0.8, 0.77, 0.75, 0.74, 0.73, 0.74, 0.77, 0.82, 0.87, 0.9, 0.92, 0.91, 0.92, 0.93, 0.94, 0.95, 0.96, 0.98, 1.0, 0.99, 0.96, 0.92, 0.88],
    solar: solar('typhoon', 5.5, 18.5),
    wind: wind('typhoon'),
    weather: weather('typhoon'),
    events: [{ timeMin: 840, type: 'windCutout', factor: 0.1, durationMin: 480, rampMin: 120, warnMin: 240 }],
  },
  {
    id: 'lngBlockade',
    name: 'LNG blockade',
    description: 'Day 5 of a blockade: LNG tankers cannot reach Taiwan. Only about a fifth of the gas fleet has fuel, and the government rations electricity by 40% with rolling cuts. Coal, oil, storage, sun and wind must carry the island through a July day.',
    month: 7,
    weekday: 5,
    peakRatio: 1.0,
    // From the Taiwan energy model's 30-day LNG cut (docs/data/security/cases/3bd80edf7215.json,
    // today's system, summer 2013): gas plants burn 26% of their normal fuel, about 22% of their
    // capacity around the clock, and 40% of demand cannot be served; here that 40% is rationed.
    rationingPct: 40,
    fuelLimits: { gas: 0.22 },
    load: [0.8, 0.77, 0.75, 0.73, 0.72, 0.72, 0.74, 0.8, 0.88, 0.94, 0.97, 0.98, 0.93, 0.97, 1.0, 1.0, 0.98, 0.96, 0.95, 0.95, 0.94, 0.91, 0.87, 0.83],
    solar: solar('lngBlockade', 5.3, 18.7),
    wind: wind('lngBlockade'),
    weather: weather('lngBlockade'),
    events: [],
  },
];

const out = {
  _comment: 'Generated by tools/make-days.js. load: hourly demand as a fraction of the day\'s peak (placeholder); peakRatio: the day\'s peak as a fraction of the annual peak; solar/wind: hourly fleet capacity factors from the real date in weather (Taiwan energy model).',
  dataStatus: 'partial',
  days,
};

// Keep number arrays on one line so the file stays readable.
const json = JSON.stringify(out, null, 2).replace(/\[\s*([-\d.,\s]+?)\s*\]/g, (_, body) => `[${body.split(/\s*,\s*/).join(', ')}]`);
writeFileSync(new URL('../data/days.json', import.meta.url), json + '\n');
console.log(`Wrote ${days.length} day types to data/days.json`);
