// Step 2: choose a fleet (or build a custom mix), a day and a difficulty.
import { capacityByType, customScenario } from './scenarios.js';
import { formatNumber, t, tOr } from './strings.js';

const STORAGE_KEY = 'ftl.setup.v1';

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? null;
  } catch {
    return null;
  }
}

function save(selection) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Storage may be unavailable (private mode); the setup still works.
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const gw = (mw) => `${formatNumber(mw / 1000, 1)} GW`;

export function createSetup({ data, cfg, onStart, onBack }) {
  const $ = (id) => document.getElementById(id);
  const groupOfType = {};
  cfg.ui.chartGroups.forEach((g) => g.types.forEach((type) => (groupOfType[type] = g.id)));

  const baseScenario = data.scenarios.find((s) => s.id === cfg.custom.defaultScenario) ?? data.scenarios[0];
  const saved = load();
  const selection = {
    fleet: data.scenarios[1]?.id ?? data.scenarios[0].id,
    day: data.days[0].id,
    difficulty: 'easy',
    assist: true,
    customBase: baseScenario.id,
    custom: capacityByType(baseScenario),
    customPeakGW: baseScenario.peakLoadMW / 1000,
    ...saved,
  };
  if (selection.fleet !== 'custom' && !data.scenarios.some((s) => s.id === selection.fleet)) selection.fleet = data.scenarios[0].id;
  if (!data.days.some((d) => d.id === selection.day)) selection.day = data.days[0].id;

  // ---- Choices ------------------------------------------------------------

  function choiceButton(title, description, badge, facts) {
    const b = el('button', 'choice');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.append(el('strong', '', title));
    if (description) b.append(el('small', '', description));
    if (facts) b.append(el('small', 'facts', facts));
    if (badge) b.append(el('span', 'badge', badge));
    return b;
  }

  function radioGroup(container, items, isSelected, onPick) {
    container.setAttribute('role', 'radiogroup');
    container.replaceChildren();
    const buttons = items.map((item) => {
      const b = choiceButton(item.title, item.description, item.badge, item.facts);
      b.addEventListener('click', () => {
        onPick(item.id);
        refresh();
      });
      container.append(b);
      return [item.id, b];
    });
    return () => buttons.forEach(([id, b]) => b.setAttribute('aria-checked', String(isSelected(id))));
  }

  const fleetItems = [
    ...data.scenarios.map((s) => {
      const cap = capacityByType(s);
      const re = (cap.solar ?? 0) + (cap.wind ?? 0);
      return {
        id: s.id,
        title: tOr(`scenario.${s.id}.name`, s.name),
        description: tOr(`scenario.${s.id}.description`, s.description),
        facts: t('setup.fleetFacts', { peak: gw(s.peakLoadMW), re: `${formatNumber(re, 1)} GW` }),
        badge: t(`data.${s.dataStatus}`),
      };
    }),
    { id: 'custom', title: t('fleet.custom.name'), description: t('fleet.custom.description'), badge: t('data.custom') },
  ];
  const refreshFleet = radioGroup($('fleet-options'), fleetItems, (id) => selection.fleet === id, (id) => (selection.fleet = id));

  const dayItems = data.days.map((d) => ({
    id: d.id,
    title: tOr(`day.${d.id}.name`, d.name),
    description: tOr(`day.${d.id}.description`, d.description),
  }));
  const refreshDay = radioGroup($('day-options'), dayItems, (id) => selection.day === id, (id) => (selection.day = id));

  const difficultyItems = Object.keys(cfg.difficulties).map((id) => ({
    id,
    title: t(`difficulty.${id}`),
    description: t(`difficulty.${id}.hint`),
  }));
  const refreshDifficulty = radioGroup(
    $('difficulty-options'),
    difficultyItems,
    (id) => selection.difficulty === id,
    (id) => {
      selection.difficulty = id;
      selection.assist = cfg.difficulties[id].assist;
    },
  );

  $('assist-toggle').addEventListener('change', (e) => {
    selection.assist = e.target.checked;
    refresh();
  });

  // ---- Custom mix -----------------------------------------------------------

  const baseChips = $('custom-base');
  const chipButtons = data.scenarios.map((s) => {
    const b = el('button', '', tOr(`scenario.${s.id}.name`, s.name));
    b.type = 'button';
    b.addEventListener('click', () => {
      selection.customBase = s.id;
      selection.custom = capacityByType(s);
      selection.customPeakGW = s.peakLoadMW / 1000;
      buildSliders();
      refresh();
    });
    baseChips.append(b);
    return [s.id, b];
  });

  function slider(id, label, swatchGroup, max, stepGW, get, set) {
    const wrap = el('div', 'slider');
    const lab = el('label');
    lab.htmlFor = id;
    if (swatchGroup) {
      const sw = el('span', 'swatch');
      sw.style.setProperty('--key', `var(--series-${swatchGroup})`);
      lab.append(sw);
    }
    lab.append(document.createTextNode(label));
    const out = el('output');
    out.htmlFor = id;
    const input = el('input');
    input.type = 'range';
    input.id = id;
    input.min = String(swatchGroup ? 0 : cfg.custom.peakRangeGW[0]);
    input.max = String(max);
    input.step = String(stepGW);
    input.value = String(get());
    const show = () => (out.textContent = `${formatNumber(Number(input.value), 1)} GW`);
    input.addEventListener('input', () => {
      set(Number(input.value));
      show();
      refresh();
    });
    show();
    wrap.append(lab, out, input);
    return wrap;
  }

  function buildSliders() {
    const box = $('custom-sliders');
    box.replaceChildren(
      slider('custom-peak', t('setup.customPeak'), null, cfg.custom.peakRangeGW[1], 0.5,
        () => selection.customPeakGW, (v) => (selection.customPeakGW = v)),
      ...cfg.custom.techs.map((tech) =>
        slider(`custom-${tech.type}`, t(`unitType.${tech.type}`), groupOfType[tech.type], tech.maxGW, tech.maxGW <= 12 ? 0.1 : 0.5,
          () => Math.round((selection.custom[tech.type] ?? 0) * 10) / 10,
          (v) => (selection.custom[tech.type] = v)),
      ),
    );
  }
  buildSliders();

  // ---- Summary ------------------------------------------------------------------

  function currentScenario() {
    if (selection.fleet === 'custom') {
      return customScenario(selection.custom, selection.customPeakGW, (type) => t(`unitType.${type}`), cfg);
    }
    return data.scenarios.find((s) => s.id === selection.fleet);
  }

  function currentDay() {
    return data.days.find((d) => d.id === selection.day);
  }

  function renderSummary() {
    const scenario = currentScenario();
    const day = currentDay();
    const types = data.types;
    let firm = 0;
    let flex = 0;
    let renewable = 0;
    for (const u of scenario.units) {
      const type = types[u.type];
      if (type.variable) renewable += u.maxMW;
      else if (type.storage || type.activationLimited) flex += u.maxMW;
      else firm += u.maxMW;
    }
    const peak = scenario.peakLoadMW * day.peakRatio;
    const margin = ((firm + flex - peak) / peak) * 100;

    const rows = el('dl', 'summary-rows');
    const add = (label, value) => {
      const d = el('div');
      d.append(el('dt', '', label), el('dd', '', value));
      rows.append(d);
    };
    add(t('setup.peakToday'), gw(peak));
    add(t('setup.firm'), gw(firm));
    add(t('setup.flexible'), gw(flex));
    add(t('setup.renewable'), gw(renewable));
    add(t('setup.margin'), `${margin >= 0 ? '+' : ''}${formatNumber(margin)}%`);

    const scale = Math.max(firm + flex, peak) * 1.1 || 1;
    const meter = el('div', 'meter');
    const firmBar = el('span', 'm-firm');
    firmBar.style.width = `${(firm / scale) * 100}%`;
    const flexBar = el('span', 'm-flex');
    flexBar.style.left = `${(firm / scale) * 100}%`;
    flexBar.style.width = `${(flex / scale) * 100}%`;
    meter.append(firmBar, flexBar);
    const peakMark = el('div', 'meter-peak');
    const tick = el('i');
    tick.style.left = `${(peak / scale) * 100}%`;
    peakMark.append(tick);
    const legend = el('div', 'meter-legend');
    for (const [cls, label] of [['--series-hydro', t('setup.meterFirm')], ['--series-storage', t('setup.meterFlex')], ['--text', t('setup.meterPeak')]]) {
      const item = el('span');
      const sw = el('span', 'swatch');
      sw.style.setProperty('--key', `var(${cls})`);
      item.append(sw, document.createTextNode(label));
      legend.append(item);
    }
    const nodes = [rows, meter, peakMark, legend];
    if (firm + flex < peak) nodes.push(el('p', 'warning-text', t('setup.marginLow')));
    $('summary').replaceChildren(...nodes);

    const notes = [];
    if (scenario.dataNotes) notes.push(el('p', '', scenario.dataNotes));
    if (scenario.sources?.length) {
      const ul = el('ul');
      for (const s of scenario.sources) {
        const li = el('li');
        const a = el('a', '', s.what);
        a.href = s.url;
        a.target = '_blank';
        a.rel = 'noopener';
        li.append(a);
        ul.append(li);
      }
      notes.push(ul);
    }
    notes.push(el('p', '', t('data.daysNote')));
    $('data-notes').replaceChildren(...notes);
  }

  function refresh() {
    refreshFleet();
    refreshDay();
    refreshDifficulty();
    $('assist-toggle').checked = selection.assist;
    $('custom-panel').hidden = selection.fleet !== 'custom';
    chipButtons.forEach(([id, b]) => b.setAttribute('aria-pressed', String(selection.customBase === id)));
    renderSummary();
    save(selection);
  }

  $('setup-back').addEventListener('click', onBack);
  $('setup-start').addEventListener('click', () => {
    onStart({
      scenario: currentScenario(),
      day: currentDay(),
      difficulty: selection.difficulty,
      assist: selection.assist,
    });
  });

  refresh();
  return { refresh };
}
