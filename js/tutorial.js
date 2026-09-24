// First-play tutorial: five short tips, each pointing at part of the screen.
import { t } from './strings.js';

const SEEN_KEY = 'ftl.tutorialSeen.v1';

export function tutorialSeen() {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Without storage the tutorial simply shows again next time.
  }
}

/**
 * steps: [{ target: () => Element, textKey }]
 * onStart / onEnd let the game pause while tips are shown.
 */
export function createTutorial({ steps, onStart, onEnd }) {
  const coach = document.getElementById('coach');
  const text = document.getElementById('coach-text');
  const counter = document.getElementById('coach-step');
  const next = document.getElementById('coach-next');
  const skip = document.getElementById('coach-skip');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let index = -1;
  let current = null;

  function show(i) {
    current?.classList.remove('coach-target');
    index = i;
    if (i >= steps.length) return finish();
    const s = steps[i];
    current = s.target();
    current?.classList.add('coach-target');
    current?.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
    counter.textContent = t('tutorial.step', { n: i + 1, total: steps.length });
    text.textContent = t(s.textKey);
    next.textContent = i === steps.length - 1 ? t('tutorial.done') : t('tutorial.next');
    coach.hidden = false;
    next.focus({ preventScroll: true });
  }

  function finish() {
    current?.classList.remove('coach-target');
    current = null;
    coach.hidden = true;
    index = -1;
    markSeen();
    onEnd?.();
  }

  next.addEventListener('click', () => show(index + 1));
  skip.addEventListener('click', finish);
  document.addEventListener('keydown', (e) => {
    if (index >= 0 && e.key === 'Escape') finish();
  });

  return {
    start() {
      onStart?.();
      show(0);
    },
    active: () => index >= 0,
  };
}
