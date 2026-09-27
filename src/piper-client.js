'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const SERVER_SOURCE = require('./piper_server.py');

/**
 * Talks to piper_server.py running in calibre's Python. The server is started
 * on first use and kept alive, so the voice is loaded only once; after
 * `idleMinutes` without speech, while nothing is being read, it is stopped to
 * give its memory back.
 *
 * Audio comes back sentence by sentence through `onAudio(id, samples, rate,
 * last)`, samples as a Float32Array in [-1, 1].
 */
class PiperClient {
  constructor({ scriptDir, onAudio, onError, isBusy, idleMinutes = 10 }) {
    this.scriptDir = scriptDir;
    this.info = null;           // the server's "ready" message: calibre version, voices folder
    this.catalogWaiters = [];
    this.downloads = new Map(); // voice key -> { promise, resolve, reject, onProgress }
    this.onAudio = onAudio;
    this.onError = onError;
    this.isBusy = isBusy || (() => false);
    this.idleMs = idleMinutes * 60 * 1000;
    this.proc = null;
    this.ready = null;
    this.voiceKey = null;
    this.idleTimer = null;
  }

  scriptPath(dir) {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'piper_server.py');
    let current = null;
    try { current = fs.readFileSync(file, 'utf8'); } catch (e) { /* not written yet */ }
    if (current !== SERVER_SOURCE) fs.writeFileSync(file, SERVER_SOURCE);
    return file;
  }

  /**
   * Starts the server if needed with `calibre` (from findCalibre); resolves
   * with its "ready" message once Piper is initialized.
   */
  start(calibre) {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      if (!calibre) {
        reject(new Error('calibre was not found. Install calibre 8.8 or newer, '
          + 'or set the path of calibre-debug in the settings.'));
        return;
      }
      let command = calibre.command;
      let args = [...calibre.args, '-e', this.scriptPath(calibre.scriptDir || this.scriptDir)];
      if (process.env.FLATPAK_ID) {
        // Obsidian itself runs in a Flatpak sandbox: calibre is outside it.
        args = ['--host', command, ...args];
        command = 'flatpak-spawn';
      }
      const proc = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: Object.assign({}, process.env, { PYTHONUNBUFFERED: '1' }),
        windowsHide: true,
      });
      this.proc = proc;
      this.touch();
      this.voiceKey = null;
      let buffer = Buffer.alloc(0);
      let header = null;
      let stderr = '';
      let started = false;

      proc.stdout.on('data', (data) => {
        buffer = buffer.length ? Buffer.concat([buffer, data]) : data;
        for (;;) {
          if (!header) {
            const nl = buffer.indexOf(10);
            if (nl === -1) return;
            const line = buffer.subarray(0, nl).toString('utf8');
            buffer = buffer.subarray(nl + 1);
            if (!line.startsWith('{')) continue;   // anything calibre prints
            try { header = JSON.parse(line); } catch (e) { continue; }
          }
          if (buffer.length < header.bytes) return;
          const pcm = buffer.subarray(0, header.bytes);
          buffer = buffer.subarray(header.bytes);
          const h = header;
          header = null;
          if (h.ready) { started = true; this.info = h; resolve(h); continue; }
          if (h.fatal) { reject(new Error(h.error)); continue; }
          if (h.catalog) { this.gotCatalog(h); continue; }
          if (h.download) { this.gotDownload(h); continue; }
          if (h.error) { this.onError(new Error(h.error), h.id); continue; }
          if (h.id === undefined) continue;
          this.onAudio(h.id, toFloat32(pcm), h.rate, h.last);
        }
      });
      proc.stderr.on('data', (d) => { stderr = (stderr + d.toString()).slice(-4000); });
      proc.on('error', (err) => {
        if (!started) reject(err);
        this.forget(proc);
      });
      proc.on('exit', (code) => {
        this.forget(proc);
        const gone = new Error(`Piper stopped (exit code ${code}).\n${stderr.trim()}`);
        for (const w of this.catalogWaiters.splice(0)) w.reject(gone);
        for (const d of this.downloads.values()) d.reject(gone);
        this.downloads.clear();
        if (!started) {
          reject(new Error(`Piper did not start (exit code ${code}).\n${stderr.trim()}`));
        } else if (code && code !== 0 && !proc.killedByUs) {
          this.onError(gone);
        }
      });
    });
    this.ready.catch(() => { this.ready = null; });
    return this.ready;
  }

  forget(proc) {
    if (this.proc !== proc) return;
    this.proc = null;
    this.ready = null;
    this.voiceKey = null;
    this.info = null;
  }

  /** The voices calibre knows, with `installed` set for those in `dir`. */
  catalog(dir) {
    return new Promise((resolve, reject) => {
      this.catalogWaiters.push({ resolve, reject });
      this.send({ cmd: 'catalog', dir: dir || undefined });
    });
  }

  gotCatalog(h) {
    const w = this.catalogWaiters.shift();
    if (w) w.resolve({ voices: h.catalog, dir: h.dir });
  }

  /** Downloads a voice from calibre's list into `dir`. */
  download(key, dir, onProgress) {
    if (this.downloads.has(key)) return this.downloads.get(key).promise;
    const entry = { onProgress };
    entry.promise = new Promise((resolve, reject) => {
      entry.resolve = resolve;
      entry.reject = reject;
    });
    this.downloads.set(key, entry);
    this.touch();
    this.send({ cmd: 'download', key, dir: dir || undefined });
    return entry.promise;
  }

  gotDownload(h) {
    const entry = this.downloads.get(h.download);
    if (!entry) return;
    this.touch();
    if (h.error) {
      this.downloads.delete(h.download);
      entry.reject(new Error(h.error));
    } else if (h.finished) {
      this.downloads.delete(h.download);
      entry.resolve();
    } else if (entry.onProgress) {
      entry.onProgress(h.done, h.total);
    }
  }

  send(obj) {
    if (this.proc && this.proc.stdin.writable) this.proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  /** Loads a voice (a Piper .onnx model) at a speed, unless already loaded. */
  setVoice(model, speed) {
    const key = model + '@' + speed;
    if (key === this.voiceKey) return;
    this.voiceKey = key;
    this.send({ cmd: 'voice', model, speed });
  }

  speak(id, text) {
    this.touch();
    this.send({ cmd: 'speak', id, text });
  }

  cancel() {
    this.send({ cmd: 'cancel' });
  }

  touch() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => (this.isBusy() || this.downloads.size ? this.touch() : this.stop()),
      this.idleMs);
  }

  stop() {
    clearTimeout(this.idleTimer);
    const proc = this.proc;
    if (!proc) return;
    proc.killedByUs = true;
    this.forget(proc);
    try { proc.stdin.end(); } catch (e) { /* already closed */ }
    setTimeout(() => { if (proc.exitCode === null) proc.kill(); }, 1000);
  }
}

function toFloat32(pcm) {
  const samples = new Float32Array(pcm.length >> 1);
  for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768;
  return samples;
}

module.exports = { PiperClient };
