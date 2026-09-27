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
    this.onAudio = onAudio;
    this.onError = onError;
    this.isBusy = isBusy || (() => false);
    this.idleMs = idleMinutes * 60 * 1000;
    this.proc = null;
    this.ready = null;
    this.voiceKey = null;
    this.idleTimer = null;
  }

  scriptPath() {
    const file = path.join(this.scriptDir, 'piper_server.py');
    let current = null;
    try { current = fs.readFileSync(file, 'utf8'); } catch (e) { /* not written yet */ }
    if (current !== SERVER_SOURCE) fs.writeFileSync(file, SERVER_SOURCE);
    return file;
  }

  /** Starts the server if needed; resolves once Piper is initialized. */
  start(calibreDebug) {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      if (!fs.existsSync(calibreDebug)) {
        reject(new Error(`calibre not found: ${calibreDebug}`));
        return;
      }
      const proc = spawn(calibreDebug, ['-e', this.scriptPath()], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: Object.assign({}, process.env, { PYTHONUNBUFFERED: '1' }),
      });
      this.proc = proc;
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
          if (h.ready) { started = true; resolve(); continue; }
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
        if (!started) {
          reject(new Error(`Piper did not start (exit code ${code}).\n${stderr.trim()}`));
        } else if (code && code !== 0 && !proc.killedByUs) {
          this.onError(new Error(`Piper stopped (exit code ${code}).\n${stderr.trim()}`));
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
    this.idleTimer = setTimeout(() => (this.isBusy() ? this.touch() : this.stop()), this.idleMs);
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
