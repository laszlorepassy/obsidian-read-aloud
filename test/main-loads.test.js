'use strict';

// The bundled main.js must load with only what Obsidian provides.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const Module = require('module');
const { execFileSync } = require('child_process');

test('main.js builds and exports the plugin class', () => {
  const root = path.join(__dirname, '..');
  execFileSync(process.execPath, [path.join(root, 'build.js')]);
  class Plugin {}
  const obsidian = { Plugin, PluginSettingTab: class {}, Setting: class {}, Notice: class {},
    MarkdownView: class {}, FileSystemAdapter: class {}, Modal: class {}, MarkdownRenderer: {},
    PluginSettingTab: class {},
    setIcon() {}, setTooltip() {} };
  const load = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'obsidian') return obsidian;
    return load.call(this, request, ...rest);
  };
  try {
    const ReadAloud = require(path.join(root, 'main.js'));
    assert.strictEqual(typeof ReadAloud, 'function');
    assert.ok(ReadAloud.prototype instanceof Plugin);
  } finally {
    Module._load = load;
  }
});
