'use strict';

// Bundles src/ into a single, self-contained main.js at the repo root, the
// file Obsidian loads. The speech server (piper_server.py) is bundled as a
// string and written next to main.js when it is first needed, so installing
// the plugin still means copying just manifest.json, main.js and styles.css.
const esbuild = require('esbuild');

esbuild.buildSync({
  entryPoints: ['src/main.js'],
  outfile: 'main.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'es2020',
  loader: { '.py': 'text' },
  external: ['obsidian', 'electron', '@codemirror/state', '@codemirror/view'],
});

console.log('Built main.js from src/');
