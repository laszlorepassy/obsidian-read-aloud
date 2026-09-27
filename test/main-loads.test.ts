// The bundled main.js must load with only what Obsidian provides, and the
// committed one must be what the source builds to (as the release checks).
import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { root, build, loadBundle, obsidianStub } from './bundle.ts';

test('main.js builds and exports the plugin class', () => {
  const obsidian = obsidianStub();
  const bundle = loadBundle<{ default: new (...args: unknown[]) => unknown }>(obsidian);
  const ReadAloud = bundle.default;
  assert.strictEqual(typeof ReadAloud, 'function');
  assert.ok(ReadAloud.prototype instanceof (obsidian.Plugin as new () => unknown));
});

test('the committed main.js is up to date with the source', () => {
  const { code, dir } = build();
  fs.rmSync(dir, { recursive: true, force: true });
  const committed = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert.ok(committed === code, 'main.js is out of date: run `npm run build`');
});
