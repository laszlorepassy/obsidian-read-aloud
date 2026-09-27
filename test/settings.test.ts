// The settings are declared for Obsidian 1.13's settings API; this checks the
// declarations against a stand-in for Obsidian, in each state of calibre.
import test from 'node:test';
import assert from 'node:assert';
import type { SettingDefinitionItem } from 'obsidian';
import type { ReadAloudSettingTab, EngineState, ReadAloudSettings } from '../src/main.ts';
import type { Voice } from '../src/voices.ts';
import { loadBundle, obsidianStub } from './bundle.ts';
import { must } from './must.ts';

class PluginSettingTab {
  app: unknown;
  plugin: { settings: Record<string, unknown> };
  updates = 0;
  constructor(app: unknown, plugin: { settings: Record<string, unknown> }) {
    this.app = app;
    this.plugin = plugin;
  }
  getControlValue(key: string): unknown { return this.plugin.settings[key]; }
  update(): void { this.updates++; }
  hide(): void {}
}

const { ReadAloudSettingTab: Tab, DEFAULT_SETTINGS } = loadBundle<{
  ReadAloudSettingTab: typeof ReadAloudSettingTab;
  DEFAULT_SETTINGS: ReadAloudSettings;
}>(obsidianStub({ PluginSettingTab }));

function tab(engine: EngineState | null, settings: Partial<ReadAloudSettings> = {}): ReadAloudSettingTab {
  const plugin = { settings: { ...DEFAULT_SETTINGS, ...settings }, calibre: () => ({ label: '/opt/calibre' }) };
  // The stand-in plugin has only what the settings tab uses.
  const t = new Tab({} as never, plugin as never);
  if (engine) t.engine = engine;
  return t;
}

/** A setting row, as the tests look at it. */
interface Row {
  name?: string;
  heading: string;
  control?: { key: string; options?: Record<string, string> };
  action?: unknown;
  render?: unknown;
}

/** Every setting row, flattened, with its group heading. */
function rows(defs: SettingDefinitionItem[], heading = ''): Row[] {
  return defs.flatMap((d): Row[] => {
    if ('type' in d && (d.type === 'group' || d.type === 'list')) {
      return rows((d.items ?? []) as SettingDefinitionItem[], d.heading ?? '');
    }
    return [{ ...(d as Omit<Row, 'heading'>), heading }];
  });
}

const voicesList: Voice[] = [
  { key: 'hu_HU-anna-medium', lang: 'hu_HU', name: 'anna', quality: 'medium', installed: true },
  { key: 'en_US-amy-low', lang: 'en_US', name: 'amy', quality: 'low', installed: false },
];
const info = { calibre: '9.15.0', voicesDir: '/v' };

const states: [string, EngineState | null][] = [
  ['checking', null],
  ['error', { status: 'error', error: 'calibre was not found.' }],
  ['no voice', { status: 'ok', info, dir: '/v', voices: [{ ...must(voicesList[1]) }] }],
  ['ready', { status: 'ok', info, dir: '/v', voices: voicesList }],
];

for (const [state, engine] of states) {
  test(`settings declarations are well formed while ${state}`, () => {
    const all = rows(tab(engine).getSettingDefinitions());
    for (const r of all) {
      assert.ok(r.name, 'every row has a name, for search');
      const kinds = [r.control, r.action, r.render].filter((k) => k !== undefined);
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
  const t = tab({ status: 'ok', info, dir: '/v', voices: voicesList });
  const voice = must(rows(t.getSettingDefinitions()).find((r) => r.control?.key === 'voice'));
  assert.deepStrictEqual(Object.keys(must(voice.control?.options)), ['hu_HU-anna-medium']);
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
