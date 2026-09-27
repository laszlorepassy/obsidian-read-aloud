import { spawn } from 'child_process';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { Calibre } from './calibre.ts';
import type { Voice } from './voices.ts';

/**
 * The timers the client uses: the window's in Obsidian (as it asks, for
 * pop-out windows); the tests, which run without a window, pass Node's.
 */
export interface Timers {
  setTimeout(handler: () => void, ms: number): number;
  clearTimeout(id: number | undefined): void;
}


/**
 * Talks to piper_server.py running in calibre's Python. The server is started
 * on first use and kept alive, so the voice is loaded only once; after
 * `idleMinutes` without speech, while nothing is being read, it is stopped to
 * give its memory back.
 *
 * Audio comes back sentence by sentence through `onAudio(id, samples, rate,
 * last)`, samples as a Float32Array in [-1, 1]. Errors go to `onError(err,
 * info)`, where `info` is the server's message ({ id } for a sentence,
 * { model, voiceFailed } for a voice) or { crashed: true }.
 */
/** A message from the server: a JSON header, followed by `bytes` bytes of audio. */
export interface ServerMessage {
  bytes: number;
  id?: number;
  rate?: number;
  last?: boolean;
  error?: string;
  fatal?: boolean;
  ready?: boolean;
  calibre?: string;
  voicesDir?: string;
  voiceFailed?: boolean;
  model?: string;
  catalog?: Voice[];
  catalogError?: string;
  dir?: string;
  download?: string;
  done?: number;
  total?: number;
  finished?: boolean;
}

/** What an error concerns: the server's message, or the server crashing. */
export type ErrorInfo = Partial<ServerMessage> & { crashed?: boolean };

/** The server's "ready" message. */
export interface ServerInfo {
  calibre: string;
  voicesDir: string;
}

export interface Catalog {
  voices: Voice[];
  dir: string;
}

interface Waiter<T> {
  resolve: (value: T) => void;
  reject: (err: Error) => void;
}

interface Download extends Waiter<void> {
  promise: Promise<void>;
  onProgress?: (done: number, total: number) => void;
}

type ServerProcess = ChildProcessWithoutNullStreams & { killedByUs?: boolean };

export interface PiperClientOptions {
  /** The text of piper_server.py. */
  serverSource: string;
  /** Where the script is written, unless calibre needs it elsewhere. */
  scriptDir: string;
  onAudio: (id: number, samples: Float32Array, rate: number, last: boolean) => void;
  onError: (err: Error, info?: ErrorInfo) => void;
  isBusy?: () => boolean;
  timers?: Timers;
  idleMinutes?: number;
  startSeconds?: number;
}

class PiperClient {
  serverSource: string;
  scriptDir: string;
  info: ServerInfo | null;
  catalogWaiters: Waiter<Catalog>[];
  downloads: Map<string, Download>;
  onAudio: PiperClientOptions['onAudio'];
  onError: PiperClientOptions['onError'];
  isBusy: () => boolean;
  idleMs: number;
  startMs: number;
  proc: ServerProcess | null;
  ready: Promise<ServerInfo> | null;
  voiceKey: string | null;
  idleTimer: number | undefined;
  startReject: ((err: Error) => void) | null = null;
  timers: Timers;

  constructor({
    serverSource, scriptDir, onAudio, onError, isBusy, timers = window, idleMinutes = 10, startSeconds = 90,
  }: PiperClientOptions) {
    this.timers = timers;
    this.serverSource = serverSource;   // the text of piper_server.py
    this.scriptDir = scriptDir;
    this.info = null;           // the server's "ready" message: calibre version, voices folder
    this.catalogWaiters = [];
    this.downloads = new Map(); // voice key -> { promise, resolve, reject, onProgress }
    this.onAudio = onAudio;
    this.onError = onError;
    this.isBusy = isBusy || (() => false);
    this.idleMs = idleMinutes * 60 * 1000;
    this.startMs = startSeconds * 1000;
    this.proc = null;
    this.ready = null;
    this.voiceKey = null;
    this.idleTimer = undefined;
  }

  scriptPath(dir: string): string {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'piper_server.py');
    let current: string | null = null;
    try { current = fs.readFileSync(file, 'utf8'); } catch { /* not written yet */ }
    if (current !== this.serverSource) fs.writeFileSync(file, this.serverSource);
    return file;
  }

  /**
   * Starts the server if needed with `calibre` (from findCalibre); resolves
   * with its "ready" message once Piper is initialized.
   */
  start(calibre: Calibre | null): Promise<ServerInfo> {
    if (this.ready) return this.ready;
    const ready = new Promise<ServerInfo>((resolve, reject) => {
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
      const proc: ServerProcess = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: Object.assign({}, process.env, { PYTHONUNBUFFERED: '1' }),
        windowsHide: true,
      });
      this.proc = proc;
      this.touch();
      this.voiceKey = null;
      let buffer: Buffer = Buffer.alloc(0);
      let header: ServerMessage | null = null;
      let stderr = '';
      let started = false;
      this.startReject = (err: Error) => { if (!started) reject(err); };
      // Writing to a server that just died fails with EPIPE; the exit
      // handler reports that, the stream must not throw it into Obsidian.
      proc.stdin.on('error', () => {});
      const timeout = this.timers.setTimeout(() => {
        if (started) return;
        reject(new Error(`Piper did not start in ${this.startMs / 1000} seconds.\n${stderr.trim()}`));
        this.stop();
      }, this.startMs);

      proc.stdout.on('data', (data: Buffer) => {
        if (this.proc !== proc) return;    // stopped; a newer server may be running
        buffer = buffer.length ? Buffer.concat([buffer, data]) : data;
        for (;;) {
          if (!header) {
            const nl = buffer.indexOf(10);
            if (nl === -1) return;
            const line = buffer.subarray(0, nl).toString('utf8');
            buffer = buffer.subarray(nl + 1);
            // Skip anything else calibre prints, even without a line end.
            const brace = line.indexOf('{"');
            if (brace === -1) continue;
            header = parseHeader(line.slice(brace));
            if (!header) continue;
          }
          if (buffer.length < header.bytes) return;
          const pcm = buffer.subarray(0, header.bytes);
          buffer = buffer.subarray(header.bytes);
          const h = header;
          header = null;
          if (h.ready) {
            started = true;
            this.timers.clearTimeout(timeout);
            this.info = { calibre: h.calibre ?? '', voicesDir: h.voicesDir ?? '' };
            resolve(this.info);
            continue;
          }
          if (h.voiceFailed) this.voiceKey = null;   // so it is tried again
          if (h.fatal) { reject(new Error(h.error ?? 'Piper failed to start.')); continue; }
          if (h.catalog) { this.gotCatalog(h); continue; }
          if (h.download !== undefined) { this.gotDownload({ ...h, download: h.download }); continue; }
          if (h.error) { this.onError(new Error(h.error), h); continue; }
          if (h.id === undefined) continue;
          this.onAudio(h.id, toFloat32(pcm), h.rate ?? 22050, h.last === true);
        }
      });
      proc.stderr.on('data', (d: Buffer) => { stderr = (stderr + d.toString()).slice(-4000); });
      proc.on('error', (err: Error) => {
        this.timers.clearTimeout(timeout);
        if (!started) reject(err);
        this.forget(proc, err);
      });
      proc.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
        this.timers.clearTimeout(timeout);
        const how = signal ? `signal ${signal}` : `exit code ${code}`;
        const gone = new Error(`Piper stopped (${how}).\n${stderr.trim()}`);
        this.forget(proc, gone);
        if (!started) {
          reject(new Error(`Piper did not start (${how}).\n${stderr.trim()}`));
        } else if (!proc.killedByUs) {
          this.onError(gone, { crashed: true });
        }
      });
    });
    this.ready = ready;
    // A failed start is forgotten, unless another start has taken its place.
    ready.catch(() => { if (this.ready === ready) this.ready = null; });
    return ready;
  }

  /**
   * Lets go of a server that stopped or is being stopped, failing what was
   * still waiting for its answer. A server started since is left alone.
   */
  forget(proc: ServerProcess, why?: Error): void {
    if (this.proc !== proc) return;
    this.proc = null;
    this.ready = null;
    this.voiceKey = null;
    this.info = null;
    const err = why || new Error('Piper was stopped.');
    if (this.startReject) this.startReject(err);
    this.startReject = null;
    for (const w of this.catalogWaiters.splice(0)) w.reject(err);
    for (const d of this.downloads.values()) d.reject(err);
    this.downloads.clear();
  }

  /**
   * The voices calibre knows, with `installed` set for those in `dir`. Fails
   * after 30 seconds without an answer; a late answer still goes to this
   * request (answers come in order), just to nobody waiting.
   */
  catalog(dir = ''): Promise<Catalog> {
    this.touch();
    return new Promise<Catalog>((resolve, reject) => {
      if (!this.proc) {
        reject(new Error('Piper is not running.'));
        return;
      }
      let settled = false;
      const timer = this.timers.setTimeout(() => {
        settled = true;
        reject(new Error('Piper did not answer with the list of voices.'));
      }, 30000);
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        this.timers.clearTimeout(timer);
        fn();
      };
      this.catalogWaiters.push({
        resolve: (value) => settle(() => resolve(value)),
        reject: (err) => settle(() => reject(err)),
      });
      this.send({ cmd: 'catalog', dir: dir || undefined });
    });
  }

  gotCatalog(h: ServerMessage): void {
    const w = this.catalogWaiters.shift();
    if (!w) return;
    if (h.catalogError) w.reject(new Error(h.catalogError));
    else w.resolve({ voices: h.catalog ?? [], dir: h.dir ?? '' });
  }

  /** Downloads a voice from calibre's list into `dir`. */
  download(key: string, dir: string, onProgress?: (done: number, total: number) => void): Promise<void> {
    if (!this.proc) return Promise.reject(new Error('Piper is not running.'));
    const running = this.downloads.get(key);
    if (running) return running.promise;
    let settle: Waiter<void> | undefined;
    const promise = new Promise<void>((resolve, reject) => { settle = { resolve, reject }; });
    if (!settle) throw new Error('unreachable');   // the executor runs at once
    const entry: Download = { ...settle, promise, onProgress };
    this.downloads.set(key, entry);
    this.touch();
    this.send({ cmd: 'download', key, dir: dir || undefined });
    return entry.promise;
  }

  gotDownload(h: ServerMessage & { download: string }): void {
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
      entry.onProgress(h.done ?? 0, h.total ?? 0);
    }
  }

  send(obj: Record<string, unknown>): void {
    if (this.proc && this.proc.stdin.writable) this.proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  /** Loads a voice (a Piper .onnx model) at a speed, unless already loaded. */
  setVoice(model: string, speed: number): void {
    const key = model + '@' + speed;
    if (key === this.voiceKey) return;
    this.voiceKey = key;
    this.send({ cmd: 'voice', model, speed });
  }

  speak(id: number, text: string): void {
    this.touch();
    this.send({ cmd: 'speak', id, text });
  }

  cancel(): void {
    this.send({ cmd: 'cancel' });
  }

  touch(): void {
    this.timers.clearTimeout(this.idleTimer);
    this.idleTimer = this.timers.setTimeout(() => (this.isBusy() || this.downloads.size ? this.touch() : this.stop()),
      this.idleMs);
  }

  stop(): void {
    this.timers.clearTimeout(this.idleTimer);
    const proc = this.proc;
    if (!proc) return;
    proc.killedByUs = true;
    this.forget(proc);
    try { proc.stdin.end(); } catch { /* already closed */ }
    this.timers.setTimeout(() => { if (proc.exitCode === null) proc.kill(); }, 1000);
  }
}

/**
 * A frame header, or null for anything else (a line some part of calibre
 * printed, or a header without a valid length).
 */
function parseHeader(line: string): ServerMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const bytes = (value as { bytes?: unknown }).bytes;
  if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes < 0) return null;
  return value as ServerMessage;
}

/** 16-bit PCM samples as floats in [-1, 1]. */
function toFloat32(pcm: Buffer): Float32Array {
  const samples = new Float32Array(pcm.length >> 1);
  for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768;
  return samples;
}

export { PiperClient };
