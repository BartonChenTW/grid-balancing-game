import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { RELEASE_DATE, VERSION } from '../js/version.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the version in the game matches package.json', () => {
  assert.equal(JSON.parse(read('package.json')).version, VERSION);
});

test('both changelogs (English and 繁體中文) have an entry for this version and date', () => {
  const heading = `## ${VERSION} — ${RELEASE_DATE}`;
  for (const file of ['CHANGELOG.md', 'CHANGELOG.zh-TW.md']) {
    assert.ok(read(file).split(/\r?\n/).includes(heading), `${file} is missing "${heading}"`);
  }
});
