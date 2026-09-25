// All UI text. Each language is a table with the same keys (see
// strings-zh-TW.js); missing keys fall back to English.
import { zhTW } from './strings-zh-TW.js';

const en = {
  title: 'Follow the Load',
  skip: 'Skip to main content',
  tagline: 'Keep Taiwan’s island grid at 60 Hz for one day.',
  loading: 'Loading…',
  'version.title': 'Version {version}, released {date}. Open the changelog.',
  'error.title': 'The game data could not be loaded',
  'error.hint': 'If you opened index.html directly from a folder, run `npm start` and open http://localhost:8000 instead.',

  'steps.label': 'Steps',
  'step.1': 'About',
  'step.2': 'Set up',
  'step.3': 'Operate',

  // ---- Step 1: about
  'intro.heading': 'You are the grid operator',
  'intro.p1': 'Taiwan’s power grid is an island: there are no neighbours to borrow electricity from. Every moment, power stations must produce exactly as much electricity as everyone is using.',
  'intro.p2': 'That balance shows up as the grid frequency. Too little generation and it falls below 60 Hz; too much and it rises. Stray too far and automatic protection starts cutting customers off, or the whole grid collapses.',
  'intro.goalHeading': 'Your goal',
  'intro.goal1': 'Keep frequency in the green band (59.8–60.2 Hz) for a whole day.',
  'intro.goal2': 'Watch the demand forecast and start slow power stations hours before you need them.',
  'intro.goal3': 'Use fast units, storage and demand response to follow the ups and downs.',
  'intro.lessonHeading': 'The big idea',
  'intro.lesson': 'Stability comes from flexibility, the ability to follow the load, not from running big plants flat out.',
  'intro.next': 'Next: set up your grid',

  // ---- Step 2: setup
  'setup.heading': 'Set up your grid',
  'money.big': 'NT$ {v} bn',
  'money.bigDivisor': '1000000000',
  'cost.heading': 'Overall system cost',
  'cost.perYear': '{money} per year',
  'cost.note': 'The capital to build this fleet ({overnight}), levelised over each technology’s lifetime at a {rate}% discount rate. Fuel is not included: you see it while you play. Build costs are rough, illustrative figures.',
  'cost.rate': 'Discount rate',
  'cost.byTech': 'By technology',
  'cost.col.tech': 'Technology',
  'cost.col.build': 'Build cost',
  'cost.col.life': 'Life',
  'cost.col.year': 'Per year',
  'cost.years': '{n} yr',
  'setup.withEfficiency': '{name} (efficiency {pct}%)',
  'setup.fleet': 'Generation fleet',
  'setup.day': 'Which day?',
  'setup.difficulty': 'Difficulty and options',
  'setup.accidents': 'Accidents',
  'accidents.none': 'None',
  'accidents.none.hint': 'A calm day.',
  'accidents.scheduled': 'Scheduled',
  'accidents.scheduled.hint': 'Events that must happen at set times: the typhoon, historic unit trips.',
  'accidents.random': 'Random',
  'accidents.random.hint': 'Surprises at random times: unit trips, clouds, wind drops, demand surges.',
  'accidents.both': 'Both',
  'accidents.both.hint': 'Scheduled events plus random surprises.',
  'setup.autoStorage': 'Auto: storage and demand response',
  'setup.autoStorageHint': 'Batteries and pumped hydro charge and discharge by themselves; demand response steps in when supply is short. You can switch it per card.',
  'setup.autoAll': 'Auto for everything',
  'setup.autoAllHint': 'Put every technology on Auto: you only decide how many thermal units are online. You can still switch any card back to manual.',
  'setup.autoFollow': 'Auto: nuclear, coal and gas (incl. gas/H₂) follow the load',
  'setup.autoFollowHint': 'Online nuclear, coal and combined-cycle gas units adjust their output by themselves, within their ramp limits. You still decide how many units are online or on standby.',
  'setup.autoRenewables': 'Auto: hydro, solar and wind',
  'setup.autoRenewablesHint': 'Hydro covers shortfalls while saving water for later; solar and wind run flat out and are curtailed only when there is more power than anything can use.',
  'setup.autoBackup': 'Auto: gas peakers and oil as backup',
  'setup.autoBackupHint': 'Peakers and oil units wait warm on standby and start by themselves when supply runs short, cheapest first.',
  'setup.assist': 'Assist: automatic governor response',
  'setup.assistHint': 'Online power stations automatically nudge their output when frequency drifts. Covers small mistakes.',
  'setup.summary': 'Your grid today',
  'setup.peakToday': 'Peak demand today',
  'setup.firm': 'Firm capacity',
  'setup.flexible': 'Storage and demand response',
  'setup.renewable': 'Solar and wind capacity',
  'setup.margin': 'Firm + storage margin over peak',
  'setup.marginLow': 'Not enough firm and storage capacity for today’s peak: expect load shedding.',
  'setup.data': 'About the data',
  'setup.back': 'Back',
  'setup.start': 'Start the day',
  'setup.customHeading': 'Build your own mix (GW)',
  'setup.customBase': 'Start from',
  'setup.customPeak': 'Annual peak demand',
  'setup.meterFirm': 'Firm',
  'setup.meterFlex': 'Storage + DSM',
  'setup.meterPeak': 'Peak',
  'fleet.custom.name': 'Custom mix',
  'fleet.custom.description': 'Set the capacity of each technology yourself and see what it takes.',
  'data.partial': 'Real totals',
  'data.placeholder': 'Projection',
  'data.custom': 'Your numbers',
  'setup.fleetFacts': 'Annual peak {peak} · solar + wind {re}',
  'data.daysNote': 'Daily demand shapes are placeholders scaled to the real annual peak.',

  'difficulty.easy': 'Easy',
  'difficulty.easy.hint': 'Assist on, no surprises.',
  'difficulty.normal': 'Normal',
  'difficulty.normal.hint': 'No assist. Scenario events happen.',
  'difficulty.hard': 'Hard',
  'difficulty.hard.hint': 'No assist, forecast errors and a surprise trip.',

  // ---- Step 3: play
  'play.clockLabel': 'Time of day',
  'speed.label': 'Speed',
  'speed.pause': 'Pause',
  'speed.play': 'Play',
  'speed.x': '{n}×',
  'play.help': 'Show tutorial',
  'play.restart': 'Restart day',
  'play.quit': 'Change setup',
  'freq.label': 'Grid frequency',
  'band.normal': 'Normal',
  'band.warning': 'Warning',
  'band.critical': 'Critical',
  'band.blackout': 'Blackout',
  'band.shedding': 'Load shedding',

  'chart.title': 'Demand and supply',
  'chart.label': 'Chart of demand and supply by technology over the day. Use the left and right arrow keys to read values.',
  'chart.demand': 'Demand',
  'chart.forecast': 'Demand forecast',
  'chart.netForecast': 'Net demand forecast (after solar and wind)',
  'chart.charging': 'Demand + storage charging',
  'chart.now': 'Now',
  'chart.mini': 'Demand and supply (tap to see the full chart)',
  'chart.freqTitle': 'Frequency',
  'chart.hz': '{v} Hz',

  'group.nuclear': 'Nuclear',
  'group.coal': 'Coal',
  'group.gas': 'Gas',
  'group.hydro': 'Hydro',
  'group.wind': 'Wind',
  'group.solar': 'Solar',
  'group.storage': 'Storage',
  'group.other': 'Oil, DSM, auto response',

  'stat.demand': 'Demand',
  'stat.demandHint': 'incl. {mw} MW storage charging',
  'stat.supply': 'Supply',
  'stat.imbalance': 'Imbalance',
  'stat.inertia': 'Inertia',
  'stat.inertiaHint': '{kinetic} GW·s spinning',
  'stat.reserve': 'Spinning reserve',
  'stat.reserveHint': 'up {up} · down {down}',
  'stat.auto': 'Auto response',
  'meter.co2': 'CO₂ intensity now',
  'meter.co2Value': '{v} g/kWh',
  'meter.co2Foot': 'Today {avg} g/kWh on average · {kt} kt CO₂ so far',
  'meter.cost': 'Fuel cost now',
  'meter.costValue': 'NT$ {v}/kWh',
  'meter.costFoot': 'NT$ {rate} M per hour · today NT$ {total} M, of which gas and oil NT$ {gasOil} M',
  'fuel.nuclear': 'Nuclear',
  'fuel.coal': 'Coal',
  'fuel.gas': 'Gas',
  'fuel.oil': 'Oil',
  'fuel.other': 'Hydro, DSM',
  'fuel.renewable': 'Solar, wind',
  'fuel.storage': 'Storage',
  'fuel.costPerKWh': 'NT$ {v}/kWh',
  'fuel.free': 'NT$ 0 · no fuel',
  'meter.bySource': 'Fuel cost per kWh, by source',
  'meter.share': 'Share now',
  'stat.curtailed': 'Curtailed now',
  'stat.shed': 'Customers cut off',
  'imbalance.surplus': 'surplus',
  'imbalance.shortfall': 'shortfall',
  'imbalance.balanced': 'balanced',
  'events.heading': 'Control room log',
  'events.empty': 'All quiet.',
  'events.more': 'Show all {n} messages',
  'events.less': 'Show fewer',

  'unit.status.offline': 'Offline',
  'unit.status.warming': 'Warming up',
  'unit.status.standby': 'Standby',
  'unit.status.starting': 'Starting',
  'unit.status.online': 'Online',
  'unit.status.stopping': 'Stopping',
  'unit.fleet': '{count} units × {size} MW',
  'unit.fleetStatus': '{online}/{count} online',
  'unit.fleetTarget': 'target {setpoint} · online {online} MW',
  'unit.pending': '{n} starting, next online in {time}',
  'unit.warmingUp': '{n} warming up',
  'unit.stoppingN': '{n} shutting down',
  'unit.offlineCount': '{n} offline',
  'unit.startTimes': 'start: cold {cold}, from standby {warm}',
  'unit.onlinePlus': 'One more {name} unit online',
  'unit.onlineMinus': 'One fewer {name} unit online',
  'unit.standbyPlus': 'Warm one more {name} unit to standby',
  'unit.standbyMinus': 'Let one {name} unit on standby cool down',
  'unit.auto': 'Auto',
  'unit.autoOn': 'Automatic',
  'unit.output': '{output} MW',
  'unit.setpoint': 'target {setpoint} · max {max}',
  'unit.startsIn': 'Online in {time}',
  'unit.startupTakes': 'Start-up takes {time}',
  'unit.lockedOut': 'Cannot restart today',
  'unit.stopping': 'Ramping down to shut off',
  'unit.storageType': '{type} · storage efficiency {pct}%',
  'unit.lost': 'lost {energy} today',
  'unit.soc': 'Charge {pct}% · {energy} left',
  'unit.water': 'Water left today {pct}%',
  'unit.dsm': 'Activation left {time}',
  'unit.variable': 'Available {available} MW · curtailed {curtailed} MW',
  'unit.thermal': 'Ramp ±{ramp} MW/min · min {min} MW',
  'unit.decrease': 'Lower {name}',
  'unit.increase': 'Raise {name}',
  'unit.start': 'Start',
  'unit.stop': 'Stop',
  'unit.cancel': 'Cancel',
  'units.heading': 'Power stations',
  'units.hint': 'Space pauses · number keys pick a unit · ↑/↓ adjust it',

  'unitType.nuclear': 'Nuclear',
  'unitType.coal': 'Coal',
  'unitType.gasCcgt': 'Gas (combined cycle)',
  'unitType.gasOcgt': 'Gas (peaker)',
  'unitType.oil': 'Oil',
  'unitType.hydro': 'Hydro',
  'unitType.pumpedHydro': 'Pumped hydro',
  'unitType.battery': 'Battery',
  'unitType.dsm': 'Demand response',
  'unitType.solar': 'Solar',
  'unitType.wind': 'Wind',

  'time.hm': '{h} h {m} min',
  'time.h': '{h} h',
  'time.m': '{m} min',

  // ---- Events
  'event.trip': '{n} × {tech} tripped! {mw} MW lost in an instant.',
  'event.windLull': 'The wind suddenly drops: wind output falls.',
  'event.demandSurge': 'Demand surges above the forecast.',
  'event.clouds': 'Clouds roll over the west coast: solar output drops.',
  'event.windCutout': 'Typhoon winds exceed turbine limits: wind farms shut down to protect themselves.',
  'event.warning.windCutout': 'Typhoon warning: wind farms will start shutting down around {time}. Plan replacement capacity now.',
  'event.warning.clouds': 'Weather warning: clouds expected around {time}.',
  'event.shed': 'Under-frequency relays disconnected customers (stage {stage}, {pct}% of demand).',
  'event.restore': 'Frequency recovered: customers reconnected (stage {stage} remaining).',
  'note.datan2017': 'Something similar happened on 15 August 2017, when a gas-supply fault tripped units at Datan power plant and rotating outages hit millions of households.',
  'note.hsinta2022': 'Something similar happened on 3 March 2022, when a substation fault near Hsinta power plant set off a wide blackout.',

  // ---- End of day
  'end.finished': 'Day complete',
  'end.blackout': 'Blackout',
  'end.blackoutSub': 'Frequency left the safe range at {time} and the grid collapsed.',
  'end.finishedSub': 'You ran Taiwan’s grid for 24 hours.',
  'end.score': '{points} / {max} points',
  'kpi.reliability': 'Reliability: time in normal band',
  'kpi.reliabilityHint': 'no load shedding',
  'kpi.reliabilityShed': '{n} load-shedding stage(s)',
  'kpi.cost': 'Cost: generation cost',
  'kpi.costHint': 'NT$ {total} M in total',
  'kpi.carbon': 'Carbon: CO₂ intensity',
  'kpi.carbonHint': '{kt} kt CO₂ in total',
  'kpi.score': '{score}/100 · weight {weight}%',
  'end.stars': '{n} of 3 stars',
  'end.shed': 'Load-shedding stages',
  'end.unserved': 'Energy not delivered',
  'end.storageLoss': 'Lost in storage (round trip)',
  'end.gasOil': 'Spent on gas and oil',
  'end.re': 'Solar and wind share',
  'end.curtailed': 'Renewables curtailed',
  'end.lesson': 'Lesson',
  'end.again': 'Play again',
  'end.setup': 'Change setup',

  'lesson.blackoutHigh': 'Too much generation. When demand falls or the wind picks up, something has to ramp down, charge, or be curtailed, and big baseload plants cannot turn down quickly.',
  'lesson.blackoutLowInertia': 'Few spinning machines were online, so the grid had little inertia and frequency fell too fast to catch. Low-inertia grids need fast responders such as batteries ready before trouble starts.',
  'lesson.blackoutEvening': 'The evening peak caught you short. As solar fades, demand stays high. Start slow units hours before sunset and keep fast reserves ready.',
  'lesson.blackoutLow': 'Generation fell behind demand. Watch the forecast and keep spinning reserve (online headroom) for surprises.',
  'lesson.shedding': 'Automatic load shedding saved the grid {stages} time(s), but customers lost power. Keep more reserve online before steep ramps and risky moments.',
  'lesson.tooMuch': 'You often had too much power. Flexible grids turn down, store, or curtail when demand dips, and inflexible baseload makes that hard.',
  'lesson.eveningRamp': 'The evening ramp was your hardest moment: solar fades while demand stays high. Bring gas units online before sunset.',
  'lesson.morningRamp': 'The morning ramp was your hardest moment. Demand climbs fast as the island wakes up; raise output ahead of it.',
  'lesson.tooLittle': 'You were often short of power. Follow the forecast line and start units early; slow plants need hours of notice.',
  'lesson.curtailment': 'You kept the lights on but threw away {pct}% of solar and wind. Charging storage and pumping water at midday could have saved it for the evening.',
  'lesson.expensive': 'Reliable, but expensive: gas and oil made up {pct}% of the fuel bill. Commit cheaper units earlier and keep peakers and oil for real emergencies.',
  'lesson.carbon': 'Reliable, but dirty: {g} g of CO₂ per kWh. More solar, wind and storage, and less coal and oil, would cut emissions.',
  'lesson.wellDone': 'Well balanced! You followed the load: steady plants for the base, flexible ones for the swings.',

  // ---- Tutorial
  'tutorial.next': 'Next',
  'tutorial.done': 'Let’s go',
  'tutorial.skip': 'Skip tutorial',
  'tutorial.step': 'Tip {n} of {total}',
  'tutorial.1': 'This is the grid frequency. Keep it in the green band. It falls when demand is higher than supply and rises when supply is higher.',
  'tutorial.2': 'The chart shows supply stacked by technology against the demand line. The dashed lines ahead are the forecast: plan for them.',
  'tutorial.3': 'Each card is one technology. − and + change the output of all its online units; the Online and Standby counts bring units on or off. Slow plants need hours to start from cold, much less from standby.',
  'tutorial.4': 'Inertia and spinning reserve tell you how robust the grid is right now. Fewer spinning machines means frequency moves faster.',
  'tutorial.5': 'Control time here. Pause any time (Space) to think. Good luck, operator!',
};

const TABLES = { en, 'zh-TW': zhTW };
export const LANGUAGES = [
  { code: 'en', label: 'English', htmlLang: 'en' },
  { code: 'zh-TW', label: '繁體中文', htmlLang: 'zh-Hant-TW' },
];
const LANG_KEY = 'ftl.lang';
let lang = 'en';

export function setLanguage(code) {
  if (TABLES[code]) lang = code;
}

export function getLanguage() {
  return lang;
}

/** Saved choice, else the browser's language (any Chinese → zh-TW), else English. */
export function detectLanguage() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && TABLES[saved]) return saved;
  } catch {
    // Storage unavailable: fall through to the browser language.
  }
  const browser = (typeof navigator !== 'undefined' && navigator.language) || 'en';
  return browser.toLowerCase().startsWith('zh') ? 'zh-TW' : 'en';
}

export function saveLanguage(code) {
  try {
    localStorage.setItem(LANG_KEY, code);
  } catch {
    // Without storage the choice lasts for this page only.
  }
}

/**
 * Display name of a unit. Scenario files name units in English ("Gas CCGT A");
 * in other languages show the translated type plus the block letter or number.
 */
export function unitName(name, type) {
  if (lang === 'en') return name;
  const suffix = name.match(/\s([A-Z0-9])$/);
  return suffix ? `${t(`unitType.${type}`)} ${suffix[1]}` : t(`unitType.${type}`);
}

export function has(key) {
  return key in TABLES[lang] || key in en;
}

/** Looks up a string and fills {placeholders} from vars. */
export function t(key, vars = {}) {
  const text = TABLES[lang][key] ?? en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''));
}

/** Like t(), but returns `fallback` when the key is missing (for names that live in data files). */
export function tOr(key, fallback, vars = {}) {
  return has(key) ? t(key, vars) : fallback;
}

/** "1 h 42 min", "8 h", "5 min" */
export function formatDuration(minutes) {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return t('time.hm', { h, m });
  if (h) return t('time.h', { h });
  return t('time.m', { m });
}

const numberFormat = new Intl.NumberFormat('en');
/** Rounded, thousands-separated number; never "-0". */
export function formatNumber(value, digits = 0) {
  const f = 10 ** digits;
  const rounded = Math.round(value * f) / f || 0;
  return digits ? rounded.toLocaleString('en', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : numberFormat.format(rounded);
}

/** Large NT$ amounts: "NT$ 262.4 bn" in English, "NT$ 2,624 億" in Chinese. */
export function formatBigMoney(ntd) {
  const divisor = Number(t('money.bigDivisor'));
  const v = ntd / divisor;
  return t('money.big', { v: formatNumber(v, v < 100 ? 1 : 0) });
}

/** "12.3 GWh" or "850 MWh" */
export function formatEnergy(mwh) {
  return mwh >= 1000 ? `${formatNumber(mwh / 1000, 1)} GWh` : `${formatNumber(mwh)} MWh`;
}

export function formatClock(minute) {
  const h = Math.floor(minute / 60);
  const m = Math.floor(minute % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
