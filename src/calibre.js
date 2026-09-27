'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const FLATPAK_ID = 'com.calibre_ebook.calibre';

/**
 * Where calibre-debug is usually found on each system, in order of
 * preference. Each entry is a way to run it: the program, the arguments
 * before the script, and where the script must be written for that calibre
 * to see it.
 */
function candidates({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const direct = (file) => ({ file, command: file, args: [], label: file });
  const list = [];
  if (platform === 'win32') {
    for (const base of [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432,
      env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Programs')]) {
      if (base) list.push(direct(path.win32.join(base, 'Calibre2', 'calibre-debug.exe')));
    }
    list.push(direct('C:\\Program Files\\Calibre2\\calibre-debug.exe'));
    // The portable version, wherever it was unpacked, can be given by hand.
  } else if (platform === 'darwin') {
    list.push(direct('/Applications/calibre.app/Contents/MacOS/calibre-debug'));
    list.push(direct(path.join(home, 'Applications', 'calibre.app', 'Contents', 'MacOS', 'calibre-debug')));
  } else {
    // The official installer puts calibre in /opt/calibre, or, installed
    // without root, in ~/calibre-bin/calibre.
    list.push(direct('/opt/calibre/calibre-debug'));
    list.push(direct(path.join(home, 'calibre-bin', 'calibre', 'calibre-debug')));
    list.push(direct('/usr/bin/calibre-debug'));
    list.push(direct('/usr/local/bin/calibre-debug'));
    // Flathub's calibre. The sandbox always sees the app's own ~/.var folder,
    // so the script goes there.
    for (const root of [path.join(home, '.local', 'share', 'flatpak'), '/var/lib/flatpak']) {
      list.push({
        file: path.join(root, 'app', FLATPAK_ID),
        command: 'flatpak',
        args: ['run', '--command=calibre-debug', FLATPAK_ID],
        scriptDir: path.join(home, '.var', 'app', FLATPAK_ID, 'data', 'obsidian-read-aloud'),
        label: `Flatpak (${FLATPAK_ID})`,
      });
    }
  }
  const seen = new Set();
  return list.filter((c) => !seen.has(c.file) && seen.add(c.file));
}

/**
 * Whether a file exists. Inside a Flatpak sandbox (Obsidian from Flathub)
 * the places calibre is installed to are not visible, so the host is asked.
 */
function defaultExists(file) {
  if (!process.env.FLATPAK_ID) return fs.existsSync(file);
  try {
    return spawnSync('flatpak-spawn', ['--host', 'test', '-e', file], { timeout: 5000 }).status === 0;
  } catch (e) {
    return false;
  }
}

/**
 * How to run calibre-debug: the path given in the settings if there is one,
 * else the first usual place where calibre is installed. Null if none.
 */
function findCalibre(configured, opts = {}) {
  const exists = opts.exists || defaultExists;
  if (configured) {
    return { file: configured, command: configured, args: [], label: configured };
  }
  return candidates(opts).find((c) => exists(c.file)) || null;
}

module.exports = { findCalibre, candidates };
