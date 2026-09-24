// All UI text. Add a `zhTW` table with the same keys to translate.

const STRINGS = {
  en: {
    title: 'Follow the Load',
    'speed.pause': 'Pause',
    'speed.x': '{n}×',
    'freq.label': 'Grid frequency',
    'band.normal': 'Normal',
    'band.warning': 'Warning',
    'band.critical': 'Critical',
    'band.blackout': 'Blackout',
    'stat.demand': 'Demand',
    'stat.supply': 'Supply',
    'stat.imbalance': 'Imbalance',
    'stat.inertia': 'System inertia',
    'imbalance.surplus': 'surplus',
    'imbalance.shortfall': 'shortfall',
    'unit.output': '{output} / {max} MW · setpoint {setpoint} MW',
    'unit.soc': 'Charge {soc}%',
    'unit.decrease': 'Lower {name}',
    'unit.increase': 'Raise {name}',
    'unitType.coal': 'Coal',
    'unitType.gasOcgt': 'Gas (OCGT)',
    'unitType.battery': 'Battery',
    'units.heading': 'Units',
    'end.blackout': 'Blackout! Frequency left the safe range and the grid collapsed.',
    'end.finished': 'Day complete. You kept the lights on.',
    'end.restart': 'Play again',
    'hint': 'Keep supply equal to demand. Space pauses.',
  },
};

let lang = 'en';

export function setLanguage(code) {
  if (STRINGS[code]) lang = code;
}

/** Looks up a string and fills {placeholders} from vars. */
export function t(key, vars = {}) {
  const text = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''));
}
