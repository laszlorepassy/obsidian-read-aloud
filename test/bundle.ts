// Builds the plugin into a file of the test's own and loads it with a
// stand-in for Obsidian, as Obsidian would.
import * as fs from 'node:fs';
import * as path from 'node:path';
import Module, { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

export const root = path.join(import.meta.dirname, '..');

const requireFrom = createRequire(import.meta.url);

/** Node's module loader, which the stand-in hooks into (not in its types). */
const loader = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };

/**
 * Builds main.js into a temporary file; returns its path and contents. The
 * file is inside the project, so its require()s find node_modules.
 */
export function build(): { file: string; code: string; dir: string } {
  const dir = fs.mkdtempSync(path.join(root, 'test', '.build-'));
  const file = path.join(dir, 'main.js');
  execFileSync(process.execPath, [path.join(root, 'build.js'), file]);
  return { file, code: fs.readFileSync(file, 'utf8'), dir };
}

/** The bundle's exports, with `obsidian` required as `obsidianStub`. */
export function loadBundle<T>(obsidianStub: object): T {
  const { file, dir } = build();
  const original = loader._load;
  loader._load = function (this: unknown, request: string, ...rest: unknown[]) {
    return request === 'obsidian' ? obsidianStub : original.call(this, request, ...rest);
  };
  try {
    return requireFrom(file) as T;
  } finally {
    loader._load = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** A stand-in for the parts of Obsidian the plugin touches when loaded. */
export function obsidianStub(extra: object = {}): Record<string, unknown> {
  return {
    Plugin: class {}, PluginSettingTab: class {}, Notice: class {}, MarkdownView: class {},
    FileSystemAdapter: class {}, Modal: class {}, MarkdownRenderer: {}, Component: class {},
    setIcon() {}, setTooltip() {}, getLanguage: () => 'en',
    ...extra,
  };
}
