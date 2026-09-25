// App shell: loads data, moves between the three steps
// (1 About → 2 Set up → 3 Operate) and wires the tutorial.
import { config } from './config.js';
import { createPlay } from './play.js';
import { buildWorld, loadGameData } from './scenarios.js';
import { createSetup } from './setup.js';
import { LANGUAGES, detectLanguage, getLanguage, saveLanguage, setLanguage, t, tOr } from './strings.js';
import { createTutorial, tutorialSeen } from './tutorial.js';
import { RELEASE_DATE, VERSION } from './version.js';

const $ = (id) => document.getElementById(id);
const SCREENS = ['loading', 'error', 'intro', 'setup', 'play'];

function applyStrings() {
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll('[data-i18n-label]')) node.setAttribute('aria-label', t(node.dataset.i18nLabel));
  document.title = `${t('title')} — ${t('tagline')}`;
  const version = $('version');
  const number = document.createElement('span');
  number.textContent = `v${VERSION}`;
  const date = document.createElement('span');
  date.textContent = RELEASE_DATE;
  version.replaceChildren(number, date);
  version.title = t('version.title', { version: VERSION, date: RELEASE_DATE });
}

function show(screen) {
  for (const name of SCREENS) $(`screen-${name}`).hidden = name !== screen;
  for (const li of document.querySelectorAll('#steps li')) {
    if (li.dataset.step === screen) li.setAttribute('aria-current', 'step');
    else li.removeAttribute('aria-current');
  }
  $('steps').hidden = !['intro', 'setup', 'play'].includes(screen);
  window.scrollTo(0, 0);
}

function setupLanguage() {
  setLanguage(detectLanguage());
  const current = LANGUAGES.find((l) => l.code === getLanguage()) ?? LANGUAGES[0];
  document.documentElement.lang = current.htmlLang;
  const other = LANGUAGES.find((l) => l.code !== current.code);
  const button = $('lang-btn');
  button.textContent = other.label;
  button.lang = other.htmlLang;
  button.addEventListener('click', () => {
    saveLanguage(other.code);
    location.reload();
  });
}

async function main() {
  setupLanguage();
  applyStrings();
  show('loading');

  let data;
  try {
    data = await loadGameData();
  } catch (err) {
    $('error-text').textContent = err.message;
    show('error');
    console.error(err);
    return;
  }

  // ?demo lets the scripted operator from tools/autopilot.js play, to show what good dispatch looks like.
  const demo = new URLSearchParams(location.search).has('demo');
  const operator = demo ? (await import('../tools/autopilot.js')).autopilot : null;
  const play = createPlay({ cfg: config, onQuit: () => show('setup'), operator });

  const tutorial = createTutorial({
    steps: [
      { target: () => $('freq-block'), textKey: 'tutorial.1' },
      { target: () => $('chart-card'), textKey: 'tutorial.2' },
      { target: () => document.querySelector('#units .unit'), textKey: 'tutorial.3' },
      { target: () => $('side'), textKey: 'tutorial.4' },
      { target: () => document.querySelector('.play-bar .controls'), textKey: 'tutorial.5' },
    ],
    onStart: () => play.hold(true),
    onEnd: () => play.hold(false),
  });
  $('help-btn').addEventListener('click', () => tutorial.start());

  createSetup({
    data,
    cfg: config,
    onBack: () => show('intro'),
    onStart: ({ scenario, day, difficulty, assist, accidents, autoStorage, autoBackup, autoFollow, autoRenewables }) => {
      const world = buildWorld({ scenario, day, types: data.types, difficulty, assist, accidents, autoStorage, autoBackup, autoFollow, autoRenewables, cfg: config });
      const label = [
        tOr(`day.${day.id}.name`, day.name),
        scenario.id === 'custom' ? t('fleet.custom.name') : tOr(`scenario.${scenario.id}.name`, scenario.name),
        t(`difficulty.${difficulty}`),
      ].join(' · ');
      show('play');
      play.start(world, { label });
      if (!tutorialSeen() && !demo) tutorial.start();
    },
  });

  $('intro-next').addEventListener('click', () => show('setup'));
  show('intro');
}

main();
