'use strict';

// Builds the plugin into a file of the test's own and loads it with a
// stand-in for Obsidian, as Obsidian would.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');

/**
 * Builds main.js into a temporary file; returns its path and contents. The
 * file is inside the project, so its require()s find node_modules.
 */
function build() {
  const dir = fs.mkdtempSync(path.join(root, 'test', '.build-'));
  const file = path.join(dir, 'main.js');
  execFileSync(process.execPath, [path.join(root, 'build.js'), file]);
  return { file, code: fs.readFileSync(file, 'utf8'), dir };
}

/** The bundle's exports, with `obsidian` required as `obsidianStub`. */
function loadBundle(obsidianStub) {
  const { file, dir } = build();
  const original = Module._load;
  Module._load = function (request, ...rest) {
    return request === 'obsidian' ? obsidianStub : original.call(this, request, ...rest);
  };
  try {
    return require(file);
  } finally {
    Module._load = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** A stand-in for the parts of Obsidian the plugin touches when loaded. */
function obsidianStub(extra = {}) {
  return {
    Plugin: class {}, PluginSettingTab: class {}, Notice: class {}, MarkdownView: class {},
    FileSystemAdapter: class {}, Modal: class {}, MarkdownRenderer: {}, Component: class {},
    setIcon() {}, setTooltip() {}, getLanguage: () => 'en',
    ...extra,
  };
}

module.exports = { root, build, loadBundle, obsidianStub };
