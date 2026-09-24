import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { RELEASE_DATE, VERSION } from '../js/version.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the version in the game matches package.json', () => {
  assert.equal(JSON.parse(read('package.json')).version, VERSION);
});

test('the changelog has an entry for this version and date', () => {
  assert.match(read('CHANGELOG.md'), new RegExp(`^## ${VERSION.replace(/\./g, '\\.')} — ${RELEASE_DATE}$`, 'm'));
});
