'use strict';

// The bundled main.js must load with only what Obsidian provides, and the
// committed one must be what the source builds to (as the release checks).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { root, build, loadBundle, obsidianStub } = require('./bundle');

test('main.js builds and exports the plugin class', () => {
  const obsidian = obsidianStub();
  const bundle = loadBundle(obsidian);
  const ReadAloud = bundle.default || bundle;
  assert.strictEqual(typeof ReadAloud, 'function');
  assert.ok(ReadAloud.prototype instanceof obsidian.Plugin);
});

test('the committed main.js is up to date with the source', () => {
  const { code, dir } = build();
  fs.rmSync(dir, { recursive: true, force: true });
  const committed = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert.ok(committed === code, 'main.js is out of date: run `npm run build`');
});
