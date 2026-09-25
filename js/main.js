// App shell: loads data, moves between the three steps
// (1 About → 2 Set up → 3 Operate) and wires the tutorial.
import { config } from './config.js';
import { createPlay } from './play.js';
import { isRanked } from './replay.js';
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
  for (const node of document.querySelectorAll('[data-i18n-title]')) node.title = t(node.dataset.i18nTitle);
  document.title = `${t('title')} — ${t('tagline')}`;
  const version = $('version');
  const number = document.createElement('span');
  number.textContent = `v${VERSION}`;
  const date = document.createElement('span');
  date.textContent = RELEASE_DATE;
  version.replaceChildren(number, date);
  version.title = t('version.title', { version: VERSION, date: RELEASE_DATE });
}

/** Footer: author, contact and project links (from config.about). */
function setupFooter() {
  const a = config.about;
  $('footer-author').textContent = a.author;
  $('link-issues').href = a.issues;
  $('link-email').href = `mailto:${a.email}`;
  $('link-email').title = a.email;
  $('link-repo').href = a.repo;
  $('link-model').href = a.model;
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
  setupFooter();
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
    onStart: ({ scenario, day, difficulty, assist, accidents, autoStorage, autoBackup, autoFollow, autoRenewables, discountRatePct }) => {
      const world = buildWorld({ scenario, day, types: data.types, difficulty, assist, accidents, autoStorage, autoBackup, autoFollow, autoRenewables, cfg: config });
      const dayName = tOr(`day.${day.id}.name`, day.name);
      const fleetName = scenario.id === 'custom' ? t('fleet.custom.name') : tOr(`scenario.${scenario.id}.name`, scenario.name);
      const difficultyName = t(`difficulty.${difficulty}`);
      const label = [dayName, fleetName, difficultyName].join(' · ');
      show('play');
      // Ranked = a Taiwan fleet with the difficulty's default options, not in demo mode.
      const ranked = isRanked({ scenarioId: scenario.id, difficulty, assist: world.assist, accidents: world.accidents,
        autoStorage: world.autoStorage, autoBackup: world.autoBackup, autoFollow: world.autoFollow,
        autoRenewables: world.autoRenewables, demo }, config);
      play.start(world, { label, dayName, fleetName, difficultyName, discountRatePct, ranked });
      if (!tutorialSeen() && !demo) tutorial.start();
    },
  });

  $('intro-next').addEventListener('click', () => show('setup'));
  show('intro');
}

main();
