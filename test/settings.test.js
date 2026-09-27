'use strict';

// The settings are declared for Obsidian 1.13's settings API; this checks the
// declarations against a stand-in for Obsidian, in each state of calibre.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const Module = require('module');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');

function load() {
  execFileSync(process.execPath, [path.join(root, 'build.js')]);
  class PluginSettingTab {
    constructor(app, plugin) { this.app = app; this.plugin = plugin; this.updates = 0; }
    getControlValue(key) { return this.plugin.settings[key]; }
    update() { this.updates++; }
    hide() {}
  }
  const obsidian = {
    Plugin: class {}, PluginSettingTab, Notice: class {}, MarkdownView: class {},
    FileSystemAdapter: class {}, Modal: class {}, MarkdownRenderer: {}, Component: class {},
    setIcon() {}, setTooltip() {}, getLanguage: () => 'en',
  };
  const original = Module._load;
  Module._load = function (request, ...rest) {
    return request === 'obsidian' ? obsidian : original.call(this, request, ...rest);
  };
  try {
    delete require.cache[path.join(root, 'main.js')];
    return require(path.join(root, 'main.js'));
  } finally {
    Module._load = original;
  }
}

const { ReadAloudSettingTab, DEFAULT_SETTINGS } = load();

function tab(engine, settings = {}) {
  const plugin = { settings: { ...DEFAULT_SETTINGS, ...settings }, calibre: () => ({ label: '/opt/calibre' }) };
  const t = new ReadAloudSettingTab({}, plugin);
  if (engine) t.engine = engine;
  return t;
}

/** Every setting row, flattened, with its group heading. */
function rows(defs, heading = '') {
  return defs.flatMap((d) => (d.type ? rows(d.items || [], d.heading) : [{ ...d, heading }]));
}

const voicesList = [
  { key: 'hu_HU-anna-medium', lang: 'hu_HU', name: 'anna', quality: 'medium', installed: true },
  { key: 'en_US-amy-low', lang: 'en_US', name: 'amy', quality: 'low', installed: false },
];

for (const [state, engine] of [
  ['checking', null],
  ['error', { status: 'error', error: 'calibre was not found.' }],
  ['no voice', { status: 'ok', info: { calibre: '9.15.0' }, dir: '/v', voices: [{ ...voicesList[1] }] }],
  ['ready', { status: 'ok', info: { calibre: '9.15.0' }, dir: '/v', voices: voicesList }],
]) {
  test(`settings declarations are well formed while ${state}`, () => {
    const all = rows(tab(engine).getSettingDefinitions());
    for (const r of all) {
      assert.ok(r.name, 'every row has a name, for search');
      const kinds = ['control', 'action', 'render'].filter((k) => r[k]);
      assert.ok(kinds.length <= 1, `${r.name}: one of control, action, render`);
      if (r.control) assert.ok(r.control.key in DEFAULT_SETTINGS, `${r.name}: ${r.control.key} is a setting`);
    }
    // The groups are always there, so the search finds them.
    const headings = new Set(all.map((r) => r.heading));
    for (const h of ['Speech engine', 'Voice', 'Download voices', 'Reading', 'Advanced']) assert.ok(headings.has(h), h);
    assert.ok(all.some((r) => r.name === 'Speed'));
  });
}

test('the voice setting offers the installed voices, and shows the one read with', () => {
  const t = tab({ status: 'ok', info: { calibre: '9' }, dir: '/v', voices: voicesList });
  const voice = rows(t.getSettingDefinitions()).find((r) => r.control && r.control.key === 'voice');
  assert.deepStrictEqual(Object.keys(voice.control.options), ['hu_HU-anna-medium']);
  assert.strictEqual(t.getControlValue('voice'), 'hu_HU-anna-medium');   // none chosen yet
  assert.strictEqual(t.getControlValue('speed'), 1);
});

test('a changed setting is saved, trimmed', async () => {
  const t = tab(null);
  let saved = 0;
  let forgot = 0;
  t.plugin.saveSettings = async () => { saved++; };
  t.plugin.forgetCalibre = () => { forgot++; };
  await t.setControlValue('calibreDebug', '  /opt/calibre  ');
  assert.strictEqual(t.plugin.settings.calibreDebug, '/opt/calibre');
  assert.deepStrictEqual([saved, forgot], [1, 1]);
});
