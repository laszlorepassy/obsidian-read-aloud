import test from 'node:test';
import assert from 'node:assert';
import { findCalibre, candidates, configuredPath } from '../src/calibre.ts';
import type { FindOptions } from '../src/calibre.ts';
import { must } from './must.ts';

const only = (...files: string[]) => (f: string) => files.includes(f);

test('a path from the settings is used as it is', () => {
  const c = must(findCalibre('/somewhere/calibre-debug', { exists: () => false }));
  assert.deepStrictEqual([c.command, c.args], ['/somewhere/calibre-debug', []]);
});

test('Windows: Program Files\\Calibre2', () => {
  const env = { ProgramFiles: 'D:\\Programs' };
  const c = must(findCalibre('', { platform: 'win32', env, exists: only('D:\\Programs\\Calibre2\\calibre-debug.exe') }));
  assert.strictEqual(c.command, 'D:\\Programs\\Calibre2\\calibre-debug.exe');
});

test('macOS: the app bundle', () => {
  const c = must(findCalibre('', {
    platform: 'darwin', home: '/Users/x', exists: only('/Applications/calibre.app/Contents/MacOS/calibre-debug'),
  }));
  assert.strictEqual(c.command, '/Applications/calibre.app/Contents/MacOS/calibre-debug');
});

test('Linux: the official installer comes before a distribution package', () => {
  const opts: FindOptions = { platform: 'linux', home: '/home/x' };
  const c = must(findCalibre('', { ...opts, exists: only('/usr/bin/calibre-debug', '/opt/calibre/calibre-debug') }));
  assert.strictEqual(c.command, '/opt/calibre/calibre-debug');
  const user = must(findCalibre('', { ...opts, exists: only('/home/x/calibre-bin/calibre/calibre-debug') }));
  assert.strictEqual(user.command, '/home/x/calibre-bin/calibre/calibre-debug');
});

test('Linux: calibre from Flathub runs through flatpak, with the script in its own folder', () => {
  const c = must(findCalibre('', {
    platform: 'linux', home: '/home/x', exists: only('/var/lib/flatpak/app/com.calibre_ebook.calibre'),
  }));
  assert.strictEqual(c.command, 'flatpak');
  assert.deepStrictEqual(c.args, ['run', '--command=calibre-debug', 'com.calibre_ebook.calibre']);
  assert.strictEqual(c.scriptDir, '/home/x/.var/app/com.calibre_ebook.calibre/data/obsidian-read-aloud');
});

test('nothing found', () => {
  assert.strictEqual(findCalibre('', { platform: 'linux', exists: () => false }), null);
  assert.ok(candidates({ platform: 'win32', env: {} }).length >= 1);
});

test('a typed path may be quoted, or a folder', () => {
  const no = () => false;
  assert.strictEqual(configuredPath('"C:\\Calibre Portable\\Calibre\\calibre-debug.exe"', 'win32', no),
    'C:\\Calibre Portable\\Calibre\\calibre-debug.exe');
  assert.strictEqual(configuredPath('D:\\Calibre2', 'win32', () => true), 'D:\\Calibre2\\calibre-debug.exe');
  assert.strictEqual(configuredPath('/Applications/calibre.app', 'darwin', no),
    '/Applications/calibre.app/Contents/MacOS/calibre-debug');
  assert.strictEqual(configuredPath(' /opt/calibre ', 'linux', (f) => f === '/opt/calibre'), '/opt/calibre/calibre-debug');
});
