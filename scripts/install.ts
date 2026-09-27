
// Builds the plugin and copies it into Obsidian vaults: the ones given on the
// command line, or else every vault Obsidian has open right now. Afterwards,
// turn it on (or reload it) under Settings → Community plugins.
//
// Usage:
//   npm run install-plugin
//   npm run install-plugin -- ~/Dokumentumok/2026-27-tanév

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.join(import.meta.dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')) as { id: string };

/** Obsidian's own settings folder, which lists the vaults. */
function obsidianConfigDir(): string {
  if (process.platform === 'win32') return path.join(process.env.APPDATA || '', 'obsidian');
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'obsidian');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'obsidian');
}

/** The vaults Obsidian has open, from its obsidian.json. */
function openVaults(): string[] {
  const config = path.join(obsidianConfigDir(), 'obsidian.json');
  try {
    const { vaults } = JSON.parse(fs.readFileSync(config, 'utf8')) as {
      vaults?: Record<string, { path: string; open?: boolean }>;
    };
    return Object.values(vaults ?? {}).filter((v) => v.open).map((v) => v.path);
  } catch {
    return [];
  }
}

const vaults = process.argv.slice(2).map((v) => path.resolve(v));
if (!vaults.length) vaults.push(...openVaults());
if (!vaults.length) {
  console.error('No vault given and none open in Obsidian.');
  process.exit(1);
}

execFileSync(process.execPath, [path.join(root, 'build.js')], { stdio: 'inherit' });

for (const vault of vaults) {
  if (!fs.existsSync(path.join(vault, '.obsidian'))) {
    console.error(`Not a vault (no .obsidian folder): ${vault}`);
    continue;
  }
  const dir = path.join(vault, '.obsidian', 'plugins', manifest.id);
  fs.mkdirSync(dir, { recursive: true });
  for (const file of ['manifest.json', 'main.js', 'styles.css']) {
    fs.copyFileSync(path.join(root, file), path.join(dir, file));
  }
  console.log(`Installed into ${dir}`);
}
