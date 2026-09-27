'use strict';

// Bundles src/ into a single, self-contained main.js at the repo root, the
// file Obsidian loads. The speech server (piper_server.py) is bundled as a
// string and written next to main.js when it is first needed, and the help
// (HELP.md) is bundled the same way, so installing
// the plugin still means copying just manifest.json, main.js and styles.css.
//
// `node build.js [outfile]`: the tests build into a file of their own, so
// they never read a main.js another test is writing.
const path = require('path');
const esbuild = require('esbuild');

const outfile = process.argv[2] || path.join(__dirname, 'main.js');

esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'src', 'main.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'es2020',
  loader: { '.py': 'text', '.md': 'text' },
  external: ['obsidian', 'electron', '@codemirror/state', '@codemirror/view'],
});

console.log(`Built ${path.relative(process.cwd(), outfile) || outfile} from src/`);
