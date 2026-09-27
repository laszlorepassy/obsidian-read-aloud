"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  DEFAULT_SETTINGS: () => DEFAULT_SETTINGS,
  ReadAloudSettingTab: () => ReadAloudSettingTab,
  default: () => main_default
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var fs3 = __toESM(require("fs"));
var os2 = __toESM(require("os"));
var path3 = __toESM(require("path"));

// src/segmenter.ts
var FENCE = /^\s*(```+|~~~+)/;
var MATH_FENCE = /^\s*\$\$\s*$/;
var COMMENT_FENCE = /^\s*%%\s*$/;
var HEADING = /^(\s{0,3}#{1,6}\s+)/;
var LIST_ITEM = /^(\s*(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?)/;
var QUOTE = /^(\s*(?:>\s?)+)/;
var CALLOUT = /^\s*(?:>\s?)+\[!\w[\w-]*\][+-]?\s*/;
var TABLE_ROW = /^\s*\|/;
var TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
var RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
function lines(text) {
  const result = [];
  let start = 0;
  while (start <= text.length) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = text.length;
    result.push({ start, end, text: text.slice(start, end) });
    start = end + 1;
  }
  return result;
}
function frontMatterEnd(text) {
  const m = /^---\r?\n[\s\S]*?\r?\n(---|\.\.\.)[ \t]*(\r?\n|$)/.exec(text);
  return m ? m[0].length : 0;
}
function blocks(text) {
  const result = [];
  const state = { current: null };
  let skipUntil = null;
  const close = () => {
    if (state.current) result.push(state.current);
    state.current = null;
  };
  const open = (from, to, kind) => {
    close();
    state.current = { from, to, kind };
  };
  const bodyStart = frontMatterEnd(text);
  for (const line of lines(text)) {
    if (line.end < bodyStart) continue;
    const t = line.text;
    if (skipUntil) {
      if (skipUntil.test(t)) skipUntil = null;
      continue;
    }
    const fence = FENCE.exec(t);
    if (fence) {
      close();
      skipUntil = new RegExp("^\\s*" + fence[1][0].replace(/[$^*+?.()|[\]{}\\]/g, "\\$&") + "{" + fence[1].length + ",}\\s*$");
      continue;
    }
    if (MATH_FENCE.test(t)) {
      close();
      skipUntil = MATH_FENCE;
      continue;
    }
    if (COMMENT_FENCE.test(t)) {
      close();
      skipUntil = COMMENT_FENCE;
      continue;
    }
    if (!t.trim() || RULE.test(t) || /^\s*(?:>\s?)+$/.test(t)) {
      close();
      continue;
    }
    let m;
    if (m = HEADING.exec(t)) {
      open(line.start + m[1].length, line.end, "heading");
      close();
    } else if (TABLE_ROW.test(t)) {
      close();
      if (!TABLE_SEPARATOR.test(t)) result.push({ from: line.start, to: line.end, kind: "table" });
    } else if (m = CALLOUT.exec(t)) {
      open(line.start + m[0].length, line.end, "callout");
      close();
    } else if (m = QUOTE.exec(t)) {
      const rest = t.slice(m[1].length);
      const item = LIST_ITEM.exec(rest);
      const prefix = m[1].length + (item ? item[1].length : 0);
      if (state.current && state.current.kind === "quote" && !item) state.current.to = line.end;
      else open(line.start + prefix, line.end, "quote");
    } else if (m = LIST_ITEM.exec(t)) {
      open(line.start + m[1].length, line.end, "item");
    } else if (state.current && state.current.kind !== "quote") {
      state.current.to = line.end;
    } else {
      open(line.start + (t.length - t.trimStart().length), line.end, "paragraph");
    }
  }
  close();
  return result;
}
var ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "\u2013", mdash: "\u2014", hellip: "\u2026" };
function speakable(source) {
  let s = source;
  s = s.replace(/^\[\^[^\]]*\]:\s*/, "");
  s = s.replace(/\s+#+\s*$/, "");
  s = s.replace(/%%[\s\S]*?%%/g, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/!\[\[[^\]]*\]\]/g, " ");
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  s = s.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2");
  s = s.replace(/\[\[([^\]]*)\]\]/g, (_, target) => (
    // [[note#heading]]
    target.replace(/#\^.*$/, "").replace(/#/g, " ").split("/").pop() ?? ""
  ));
  s = s.replace(/\[\^[^\]]*\]/g, "");
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  s = s.replace(/<https?:[^>]*>/g, " ");
  s = s.replace(/\bhttps?:\/\/\S+/g, " ");
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, " ");
  s = s.replace(/`([^`]*)`/g, "$1");
  s = s.replace(/\$([^$\n]+)\$/g, "$1");
  s = s.replace(/(^|\s)\^[\w-]+\s*$/gm, "$1");
  s = s.replace(/^[ \t]*(?:>[ \t]?)+/gm, "");
  s = s.replace(/\n[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[.\][ \t]+)?/g, "\n");
  s = s.replace(/(\*\*|__|~~|==)/g, "");
  s = s.replace(/(^|[^\w*])\*(?=\S)|(\S)\*(?=[^\w*]|$)/g, "$1$2");
  s = s.replace(/(^|[^\p{L}\p{N}_])_(?=\S)|(\S)_(?=[^\p{L}\p{N}_]|$)/gu, "$1$2");
  s = s.replace(/(^|\s)#([\p{L}\p{N}_/-]+)/gu, "$1$2");
  s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] !== "#") return ENTITIES[e.toLowerCase()] || m;
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    try {
      return String.fromCodePoint(code);
    } catch {
      return " ";
    }
  });
  s = s.replace(/\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|\u{FE0F}|\u{200D}/gu, " ");
  if (/^\s*\|/.test(s)) {
    s = s.split("|").map((c) => c.trim()).filter(Boolean).join(", ");
  }
  s = s.replace(/\s+/g, " ").trim();
  return /[\p{L}\p{N}]/u.test(s) ? s : "";
}
var UNCUTTABLE = [
  /%%[\s\S]*?%%/g,
  /<!--[\s\S]*?-->/g,
  /!?\[\[[^\]]*\]\]/g,
  /!?\[[^\]]*\]\([^)]*\)/g,
  /`[^`]*`/g,
  /\$[^$\n]+\$/g,
  /<[^>\n]*>/g,
  /\bhttps?:\/\/\S+/g
];
function mask(text) {
  let masked = text;
  for (const re of UNCUTTABLE) masked = masked.replace(re, (m) => "X".repeat(m.length));
  return masked;
}
function endsInNumber(text) {
  let i = text.length;
  while (i > 0 && text.charCodeAt(i - 1) >= 48 && text.charCodeAt(i - 1) <= 57) i--;
  return i < text.length && (i === 0 || /\s/.test(text[i - 1]));
}
function sentenceStarts(text) {
  const starts = [];
  const re = /[.!?…]+["'”’»)\]]*\s+|[。！？．]+["'”’」』)]*\s*/g;
  let m;
  while (m = re.exec(text)) {
    const next = m.index + m[0].length;
    if (next >= text.length) break;
    if (/^[.!?…]/.test(m[0])) {
      if (m[0][0] === "." && endsInNumber(text.slice(Math.max(0, m.index - 40), m.index))) continue;
      if (/^\p{Ll}/u.test(text.slice(next, next + 2))) continue;
    }
    starts.push(next);
  }
  return starts;
}
function clauseStarts(text) {
  const starts = [];
  const re = /(?:[,;:]|\s[–—-])\s+|[，、；：]\s*/g;
  let m;
  while (m = re.exec(text)) {
    const next = m.index + m[0].length;
    if (next < text.length) starts.push(next);
  }
  return starts;
}
function wordStarts(text) {
  const starts = [];
  const re = /\s+/g;
  let m;
  while (m = re.exec(text)) {
    const next = m.index + m[0].length;
    if (next < text.length && m.index > 0) starts.push(next);
  }
  return starts;
}
function hardStarts(text, max) {
  const starts = [];
  for (let i = max; i < text.length; i += max) starts.push(i);
  return starts;
}
function cut(text, max, masked = mask(text)) {
  if (text.length <= max) return [[0, text.length]];
  const finders = [sentenceStarts, clauseStarts, wordStarts, (t) => hardStarts(t, max)];
  for (const finder of finders) {
    const points = finder(masked).filter((i) => masked[i - 1] !== "X" || masked[i] !== "X" || finder !== finders[3]);
    if (!points.length) continue;
    const bounds = [0, ...points, text.length];
    const pieces = [];
    let start = 0;
    for (let i = 1; i < bounds.length; i++) {
      if (bounds[i] - start > max && bounds[i - 1] > start) {
        pieces.push([start, bounds[i - 1]]);
        start = bounds[i - 1];
      }
    }
    pieces.push([start, text.length]);
    const result = [];
    for (const [a, b] of pieces) {
      if (b - a > max && finder !== finders[3]) {
        for (const [c, d] of cut(text.slice(a, b), max, masked.slice(a, b))) result.push([a + c, a + d]);
      } else {
        result.push([a, b]);
      }
    }
    return result;
  }
  return [[0, text.length]];
}
function segment(source, { maxLength = 300 } = {}) {
  const result = [];
  for (const b of blocks(source)) {
    const body = source.slice(b.from, b.to);
    const masked = mask(body);
    const block = { from: b.from, to: b.from + body.trimEnd().length };
    const bounds = [0, ...sentenceStarts(masked), body.length];
    for (let i = 1; i < bounds.length; i++) {
      const start = bounds[i - 1];
      for (const [x, y] of cut(body.slice(start, bounds[i]), maxLength, masked.slice(start, bounds[i]))) {
        const piece = body.slice(start + x, start + y);
        const text = speakable(piece);
        if (!text) continue;
        const lead = piece.length - piece.trimStart().length;
        const trail = piece.length - piece.trimEnd().length;
        result.push({ from: b.from + start + x + lead, to: b.from + start + y - trail, text, block });
      }
    }
  }
  return result;
}

// src/text-match.ts
function matchText(pieces, text, hint = 0) {
  let hay = "";
  const where = [];
  pieces.forEach((piece2, p) => {
    let i = 0;
    for (const ch of piece2) {
      if (isKey(ch)) {
        hay += foldCase(ch);
        where.push([p, i]);
      }
      i += ch.length;
    }
  });
  let needle = "";
  for (const ch of text) if (isKey(ch)) needle += foldCase(ch);
  if (!needle) return null;
  const hayPoints = [...hay];
  const needlePoints = [...needle];
  const joinedAt = (i) => hayPoints.slice(i, i + needlePoints.length).join("");
  hint = Math.min(hint, hayPoints.length);
  let best = -1;
  for (let at = 0; at + needlePoints.length <= hayPoints.length; at++) {
    if (hayPoints[at] !== needlePoints[0] || joinedAt(at) !== needle) continue;
    if (best === -1 || Math.abs(at - hint) < Math.abs(best - hint)) best = at;
  }
  if (best === -1) return null;
  const [endPiece, endOffset] = where[best + needlePoints.length - 1];
  const piece = pieces[endPiece];
  let end = endOffset + ((piece.codePointAt(endOffset) ?? 0) > 65535 ? 2 : 1);
  while (end < piece.length && /[.!?…,;:"'”’»)\]。！？，、；：」』）]/.test(piece[end])) end++;
  return { start: where[best], end: [endPiece, end] };
}
function isKey(ch) {
  return /[\p{L}\p{N}]/u.test(ch);
}
function foldCase(ch) {
  const lower = ch.toLowerCase();
  return [...lower].length === 1 ? lower : ch;
}
function keyLength(text) {
  let n = 0;
  for (const ch of text) if (/[\p{L}\p{N}]/u.test(ch)) n++;
  return n;
}

// src/piper-client.ts
var import_child_process = require("child_process");
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var PiperClient = class {
  constructor({
    serverSource,
    scriptDir,
    onAudio,
    onError,
    isBusy,
    timers = window,
    idleMinutes = 10,
    startSeconds = 90
  }) {
    this.startReject = null;
    this.timers = timers;
    this.serverSource = serverSource;
    this.scriptDir = scriptDir;
    this.info = null;
    this.catalogWaiters = [];
    this.downloads = /* @__PURE__ */ new Map();
    this.onAudio = onAudio;
    this.onError = onError;
    this.isBusy = isBusy || (() => false);
    this.idleMs = idleMinutes * 60 * 1e3;
    this.startMs = startSeconds * 1e3;
    this.proc = null;
    this.ready = null;
    this.voiceKey = null;
    this.idleTimer = void 0;
  }
  scriptPath(dir) {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "piper_server.py");
    let current = null;
    try {
      current = fs.readFileSync(file, "utf8");
    } catch {
    }
    if (current !== this.serverSource) fs.writeFileSync(file, this.serverSource);
    return file;
  }
  /**
   * Starts the server if needed with `calibre` (from findCalibre); resolves
   * with its "ready" message once Piper is initialized.
   */
  start(calibre) {
    if (this.ready) return this.ready;
    const ready = new Promise((resolve, reject) => {
      if (!calibre) {
        reject(new Error("calibre was not found. Install calibre 8.8 or newer, or set the path of calibre-debug in the settings."));
        return;
      }
      let command = calibre.command;
      let args = [...calibre.args, "-e", this.scriptPath(calibre.scriptDir || this.scriptDir)];
      if (process.env.FLATPAK_ID) {
        args = ["--host", command, ...args];
        command = "flatpak-spawn";
      }
      const proc = (0, import_child_process.spawn)(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: Object.assign({}, process.env, { PYTHONUNBUFFERED: "1" }),
        windowsHide: true
      });
      this.proc = proc;
      this.touch();
      this.voiceKey = null;
      let buffer = Buffer.alloc(0);
      let header = null;
      let stderr = "";
      let started = false;
      this.startReject = (err) => {
        if (!started) reject(err);
      };
      proc.stdin.on("error", () => {
      });
      const timeout = this.timers.setTimeout(() => {
        if (started) return;
        reject(new Error(`Piper did not start in ${this.startMs / 1e3} seconds.
${stderr.trim()}`));
        this.stop();
      }, this.startMs);
      proc.stdout.on("data", (data) => {
        if (this.proc !== proc) return;
        buffer = buffer.length ? Buffer.concat([buffer, data]) : data;
        for (; ; ) {
          if (!header) {
            const nl = buffer.indexOf(10);
            if (nl === -1) return;
            const line = buffer.subarray(0, nl).toString("utf8");
            buffer = buffer.subarray(nl + 1);
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
            this.info = { calibre: h.calibre ?? "", voicesDir: h.voicesDir ?? "" };
            resolve(this.info);
            continue;
          }
          if (h.voiceFailed) this.voiceKey = null;
          if (h.fatal) {
            reject(new Error(h.error ?? "Piper failed to start."));
            continue;
          }
          if (h.catalog) {
            this.gotCatalog(h);
            continue;
          }
          if (h.download !== void 0) {
            this.gotDownload({ ...h, download: h.download });
            continue;
          }
          if (h.error) {
            this.onError(new Error(h.error), h);
            continue;
          }
          if (h.id === void 0) continue;
          this.onAudio(h.id, toFloat32(pcm), h.rate ?? 22050, h.last === true);
        }
      });
      proc.stderr.on("data", (d) => {
        stderr = (stderr + d.toString()).slice(-4e3);
      });
      proc.on("error", (err) => {
        this.timers.clearTimeout(timeout);
        if (!started) reject(err);
        this.forget(proc, err);
      });
      proc.on("exit", (code, signal) => {
        this.timers.clearTimeout(timeout);
        const how = signal ? `signal ${signal}` : `exit code ${code}`;
        const gone = new Error(`Piper stopped (${how}).
${stderr.trim()}`);
        this.forget(proc, gone);
        if (!started) {
          reject(new Error(`Piper did not start (${how}).
${stderr.trim()}`));
        } else if (!proc.killedByUs) {
          this.onError(gone, { crashed: true });
        }
      });
    });
    this.ready = ready;
    ready.catch(() => {
      if (this.ready === ready) this.ready = null;
    });
    return ready;
  }
  /**
   * Lets go of a server that stopped or is being stopped, failing what was
   * still waiting for its answer. A server started since is left alone.
   */
  forget(proc, why) {
    if (this.proc !== proc) return;
    this.proc = null;
    this.ready = null;
    this.voiceKey = null;
    this.info = null;
    const err = why || new Error("Piper was stopped.");
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
  catalog(dir) {
    this.touch();
    return new Promise((resolve, reject) => {
      if (!this.proc) {
        reject(new Error("Piper is not running."));
        return;
      }
      let settled = false;
      const timer = this.timers.setTimeout(() => {
        settled = true;
        reject(new Error("Piper did not answer with the list of voices."));
      }, 3e4);
      const settle = (fn) => {
        if (settled) return;
        settled = true;
        this.timers.clearTimeout(timer);
        fn();
      };
      this.catalogWaiters.push({
        resolve: (value) => settle(() => resolve(value)),
        reject: (err) => settle(() => reject(err))
      });
      this.send({ cmd: "catalog", dir: dir || void 0 });
    });
  }
  gotCatalog(h) {
    const w = this.catalogWaiters.shift();
    if (!w) return;
    if (h.catalogError) w.reject(new Error(h.catalogError));
    else w.resolve({ voices: h.catalog ?? [], dir: h.dir ?? "" });
  }
  /** Downloads a voice from calibre's list into `dir`. */
  download(key, dir, onProgress) {
    if (!this.proc) return Promise.reject(new Error("Piper is not running."));
    const running = this.downloads.get(key);
    if (running) return running.promise;
    let settle;
    const promise = new Promise((resolve, reject) => {
      settle = { resolve, reject };
    });
    if (!settle) throw new Error("unreachable");
    const entry = { ...settle, promise, onProgress };
    this.downloads.set(key, entry);
    this.touch();
    this.send({ cmd: "download", key, dir: dir || void 0 });
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
      entry.onProgress(h.done ?? 0, h.total ?? 0);
    }
  }
  send(obj) {
    if (this.proc && this.proc.stdin.writable) this.proc.stdin.write(JSON.stringify(obj) + "\n");
  }
  /** Loads a voice (a Piper .onnx model) at a speed, unless already loaded. */
  setVoice(model, speed) {
    const key = model + "@" + speed;
    if (key === this.voiceKey) return;
    this.voiceKey = key;
    this.send({ cmd: "voice", model, speed });
  }
  speak(id, text) {
    this.touch();
    this.send({ cmd: "speak", id, text });
  }
  cancel() {
    this.send({ cmd: "cancel" });
  }
  touch() {
    this.timers.clearTimeout(this.idleTimer);
    this.idleTimer = this.timers.setTimeout(
      () => this.isBusy() || this.downloads.size ? this.touch() : this.stop(),
      this.idleMs
    );
  }
  stop() {
    this.timers.clearTimeout(this.idleTimer);
    const proc = this.proc;
    if (!proc) return;
    proc.killedByUs = true;
    this.forget(proc);
    try {
      proc.stdin.end();
    } catch {
    }
    this.timers.setTimeout(() => {
      if (proc.exitCode === null) proc.kill();
    }, 1e3);
  }
};
function parseHeader(line) {
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const bytes = value.bytes;
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes < 0) return null;
  return value;
}
function toFloat32(pcm) {
  const samples = new Float32Array(pcm.length >> 1);
  for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768;
  return samples;
}

// src/calibre.ts
var fs2 = __toESM(require("fs"));
var os = __toESM(require("os"));
var path2 = __toESM(require("path"));
var import_child_process2 = require("child_process");
var FLATPAK_ID = "com.calibre_ebook.calibre";
function candidates({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const direct = (file) => ({ file, command: file, args: [], label: file });
  const list = [];
  if (platform === "win32") {
    for (const base of [
      env.ProgramFiles,
      env["ProgramFiles(x86)"],
      env.ProgramW6432,
      env.LOCALAPPDATA && path2.win32.join(env.LOCALAPPDATA, "Programs")
    ]) {
      if (base) list.push(direct(path2.win32.join(base, "Calibre2", "calibre-debug.exe")));
    }
    list.push(direct("C:\\Program Files\\Calibre2\\calibre-debug.exe"));
  } else if (platform === "darwin") {
    list.push(direct("/Applications/calibre.app/Contents/MacOS/calibre-debug"));
    list.push(direct(path2.join(home, "Applications", "calibre.app", "Contents", "MacOS", "calibre-debug")));
  } else {
    list.push(direct("/opt/calibre/calibre-debug"));
    list.push(direct(path2.join(home, "calibre-bin", "calibre", "calibre-debug")));
    list.push(direct("/usr/bin/calibre-debug"));
    list.push(direct("/usr/local/bin/calibre-debug"));
    for (const root of [path2.join(home, ".local", "share", "flatpak"), "/var/lib/flatpak"]) {
      list.push({
        file: path2.join(root, "app", FLATPAK_ID),
        command: "flatpak",
        args: ["run", "--command=calibre-debug", FLATPAK_ID],
        scriptDir: path2.join(home, ".var", "app", FLATPAK_ID, "data", "obsidian-read-aloud"),
        label: `Flatpak (${FLATPAK_ID})`
      });
    }
  }
  const seen = /* @__PURE__ */ new Set();
  return list.filter((c) => !seen.has(c.file) && seen.add(c.file));
}
function defaultExists(file) {
  if (!process.env.FLATPAK_ID) return fs2.existsSync(file);
  try {
    return (0, import_child_process2.spawnSync)("flatpak-spawn", ["--host", "test", "-e", file], { timeout: 5e3 }).status === 0;
  } catch {
    return false;
  }
}
function configuredPath(typed, platform = process.platform, isDir = defaultIsDir) {
  let file = typed.trim().replace(/^["']+|["']+$/g, "").trim();
  const join4 = (...parts) => platform === "win32" ? path2.win32.join(...parts) : path2.posix.join(...parts);
  if (platform === "darwin" && /\.app\/?$/.test(file)) {
    file = join4(file, "Contents", "MacOS", "calibre-debug");
  } else if (isDir(file)) {
    file = join4(file, platform === "win32" ? "calibre-debug.exe" : "calibre-debug");
  }
  return file;
}
function defaultIsDir(file) {
  try {
    return fs2.statSync(file).isDirectory();
  } catch {
    return false;
  }
}
function findCalibre(configured, opts = {}) {
  const exists = opts.exists ?? defaultExists;
  if (configured && configured.trim()) {
    const file = configuredPath(configured, opts.platform, opts.isDir);
    return { file, command: file, args: [], label: file };
  }
  return candidates(opts).find((c) => exists(c.file)) || null;
}

// src/voices.ts
var QUALITY_ORDER = ["medium", "high", "low", "x_low", ""];
var languageNames = /* @__PURE__ */ new Map();
function languageName(lang) {
  if (!lang) return "Other";
  if (!languageNames.has(lang)) {
    let name = lang;
    try {
      name = new Intl.DisplayNames(["en"], { type: "language" }).of(lang.replace("_", "-")) || lang;
    } catch {
    }
    languageNames.set(lang, name);
  }
  return languageNames.get(lang) ?? lang;
}
function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
function voiceName(v) {
  const name = capitalize(v.name.replace(/_/g, " "));
  return v.quality ? `${name} (${v.quality.replace("_", " ")})` : name;
}
function voiceLabel(v) {
  return `${languageName(v.lang)} \u2013 ${voiceName(v)}`;
}
function byLanguageThenName(a, b) {
  return languageName(a.lang).localeCompare(languageName(b.lang)) || a.name.localeCompare(b.name) || QUALITY_ORDER.indexOf(a.quality) - QUALITY_ORDER.indexOf(b.quality);
}
function languages(voices) {
  const langs = [...new Set(voices.map((v) => v.lang))];
  return langs.map((lang) => ({ lang, label: languageName(lang) })).sort((a, b) => a.label.localeCompare(b.label));
}
function preferredLanguage(voices, locales) {
  const langs = voices.map((v) => v.lang);
  for (const locale of locales) {
    const [language, country] = locale.split(/[-_]/);
    const exact = country !== void 0 && langs.find((l) => l === `${language}_${country.toUpperCase()}`);
    if (exact) return exact;
    const same = langs.find((l) => l.split("_")[0] === language);
    if (same) return same;
  }
  return langs.find((l) => l === "en_US") || langs[0] || null;
}
function chooseVoice(voices, chosen, locales) {
  const installed = voices.filter((v) => v.installed);
  if (installed.some((v) => v.key === chosen)) return chosen;
  if (!installed.length) return null;
  const lang = preferredLanguage(installed, locales);
  const fitting = installed.filter((v) => v.lang === lang).sort(byLanguageThenName);
  return (fitting[0] || installed[0]).key;
}
var SAMPLES = {
  ar: "\u0645\u0631\u062D\u0628\u0627\u060C \u0647\u0630\u0627 \u0647\u0648 \u0635\u0648\u062A\u064A.",
  ca: "Hola, aix\xED sona aquesta veu.",
  cs: "Dobr\xFD den, takto zn\xED tento hlas.",
  cy: "Helo, dyma sut mae'r llais hwn yn swnio.",
  da: "Hej, s\xE5dan lyder denne stemme.",
  de: "Hallo, so klingt diese Stimme.",
  el: "\u0393\u03B5\u03B9\u03B1 \u03C3\u03B1\u03C2, \u03AD\u03C4\u03C3\u03B9 \u03B1\u03BA\u03BF\u03CD\u03B3\u03B5\u03C4\u03B1\u03B9 \u03B1\u03C5\u03C4\u03AE \u03B7 \u03C6\u03C9\u03BD\u03AE.",
  en: "Hello, this is how this voice sounds.",
  es: "Hola, as\xED suena esta voz.",
  fi: "Hei, t\xE4lt\xE4 t\xE4m\xE4 \xE4\xE4ni kuulostaa.",
  fr: "Bonjour, voici comment sonne cette voix.",
  hu: "J\xF3 napot, \xEDgy sz\xF3l ez a hang.",
  is: "Hall\xF3, svona hlj\xF3mar \xFEessi r\xF6dd.",
  it: "Ciao, ecco come suona questa voce.",
  nl: "Hallo, zo klinkt deze stem.",
  no: "Hei, slik h\xF8res denne stemmen ut.",
  pl: "Dzie\u0144 dobry, tak brzmi ten g\u0142os.",
  pt: "Ol\xE1, \xE9 assim que esta voz soa.",
  ro: "Bun\u0103 ziua, a\u0219a sun\u0103 aceast\u0103 voce.",
  ru: "\u0417\u0434\u0440\u0430\u0432\u0441\u0442\u0432\u0443\u0439\u0442\u0435, \u0442\u0430\u043A \u0437\u0432\u0443\u0447\u0438\u0442 \u044D\u0442\u043E\u0442 \u0433\u043E\u043B\u043E\u0441.",
  sk: "Dobr\xFD de\u0148, takto znie tento hlas.",
  sl: "Pozdravljeni, tako zveni ta glas.",
  sr: "\u0417\u0434\u0440\u0430\u0432\u043E, \u043E\u0432\u0430\u043A\u043E \u0437\u0432\u0443\u0447\u0438 \u043E\u0432\u0430\u0458 \u0433\u043B\u0430\u0441.",
  sv: "Hej, s\xE5 h\xE4r l\xE5ter den h\xE4r r\xF6sten.",
  tr: "Merhaba, bu ses b\xF6yle duyuluyor.",
  uk: "\u0414\u043E\u0431\u0440\u0438\u0439 \u0434\u0435\u043D\u044C, \u0442\u0430\u043A \u0437\u0432\u0443\u0447\u0438\u0442\u044C \u0446\u0435\u0439 \u0433\u043E\u043B\u043E\u0441.",
  vi: "Xin ch\xE0o, \u0111\xE2y l\xE0 gi\u1ECDng n\xF3i n\xE0y.",
  zh: "\u4F60\u597D\uFF0C\u8FD9\u662F\u8FD9\u4E2A\u58F0\u97F3\u7684\u6548\u679C\u3002"
};
function sampleText(v) {
  const language = (v.lang || "").split("_")[0];
  return SAMPLES[language] || `${capitalize(v.name)}.`;
}

// src/highlight.ts
var import_state = require("@codemirror/state");
var import_view = require("@codemirror/view");
var setReading = import_state.StateEffect.define();
var mark = import_view.Decoration.mark({ class: "readaloud-current" });
function decorations(range) {
  return range && range.from < range.to ? import_view.Decoration.set([mark.range(range.from, range.to)]) : import_view.Decoration.none;
}
function mapRange(changes, r) {
  const from = changes.mapPos(r.from, 1);
  return { from, to: Math.max(from, changes.mapPos(r.to, -1)) };
}
var readingField = import_state.StateField.define({
  create: () => ({ range: null, deco: import_view.Decoration.none }),
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setReading)) {
        const r = e.value;
        if (!r) return { range: null, deco: import_view.Decoration.none };
        const range2 = { from: r.from, to: r.to, block: { from: r.block.from, to: r.block.to } };
        return { range: range2, deco: decorations(range2) };
      }
    }
    if (!value.range || !tr.docChanged) return value;
    const range = { ...mapRange(tr.changes, value.range), block: mapRange(tr.changes, value.range.block) };
    return { range, deco: decorations(range) };
  },
  provide: (f) => import_view.EditorView.decorations.from(f, (v) => v.deco)
});
function showReading(view, range, scroll) {
  const effects = [setReading.of(range)];
  if (range && scroll) effects.push(import_view.EditorView.scrollIntoView(range.from, { y: "nearest", yMargin: 80 }));
  view.dispatch({ effects });
}
function readingRange(view) {
  const value = view.state.field(readingField, false);
  return value ? value.range : null;
}

// HELP.md
var HELP_default = '# Read Aloud \u2013 user guide\n\nRead Aloud reads the open note aloud, sentence by sentence, and softly\nhighlights the sentence being read. The voice is **Piper**, a neural text-to-speech\nengine that runs on your own computer: no internet connection is needed\nwhile reading, and your notes never leave your computer.\n\nRead Aloud works on **Windows, macOS and Linux** desktops (not on phones or\ntablets), with **Obsidian 1.13.1 or newer** (Settings \u2192 About shows your\nversion; update it there if needed). Setting it up takes three steps:\n\n1. Install calibre, which brings Piper with it.\n2. Install the plugin in your vault.\n3. Download a voice in the plugin\'s settings.\n\n## Why calibre?\n\nPiper exists for Windows, macOS and Linux as a program of its own too, but\nRead Aloud uses the Piper built into **calibre**, the free e-book manager\n(calibre-ebook.com). calibre has a one-click installer on every system,\nkeeps Piper up to date, and knows where to download voices from, in 58\nlanguages. You don\'t have to use calibre itself for anything; it only has\nto be installed. If you already listen to books with calibre\'s e-book\nviewer, Read Aloud uses the same voices.\n\n**calibre 8.8 or newer** is needed (from August 2025); the newest version is\nbest.\n\n## 1. Install calibre\n\n### Windows\n\n1. Go to calibre-ebook.com/download_windows and download the installer\n   (*calibre 64bit*).\n2. Run it and click through with the default settings. calibre goes to\n   `C:\\Program Files\\Calibre2`, where Read Aloud finds it by itself.\n\n**Portable calibre** (e.g. on a USB drive or without admin rights) works\ntoo, but Read Aloud cannot find it by itself: enter the full path of its\n`calibre-debug.exe` in the settings, under *Advanced \u2192 Path of\ncalibre-debug*, e.g. `D:\\Calibre Portable\\Calibre\\calibre-debug.exe`.\n\n### macOS\n\n1. Go to calibre-ebook.com/download_osx and download the `.dmg` file.\n2. Open it and drag **calibre** into **Applications**.\n3. Start calibre once from Applications, so macOS lets it run. After that\n   you can close it.\n\nRead Aloud finds calibre in `/Applications` (or in `Applications` in your\nhome folder).\n\n### Linux\n\nMost distributions\' own calibre packages are **too old** (Debian 13 and\nUbuntu 24.04, for example, have calibre versions without the built-in\nPiper). Check with `calibre --version` in a terminal: if it says 8.8 or\nmore, you are done. Otherwise use one of these:\n\n**Official installer (recommended).** In a terminal:\n\n```bash\nsudo -v && wget -nv -O- https://download.calibre-ebook.com/linux-installer.sh | sudo sh /dev/stdin\n```\n\nThis puts calibre in `/opt/calibre`, and running it again later updates it.\nIf it complains about missing libraries, install them first; on\nDebian/Ubuntu:\n\n```bash\nsudo apt install wget xz-utils xdg-utils libegl1 libopengl0 libxcb-cursor0\n```\n\nWithout admin rights, calibre can go into your home folder instead:\n\n```bash\nwget -nv -O- https://download.calibre-ebook.com/linux-installer.sh | sh /dev/stdin install_dir=~/calibre-bin isolated=y\n```\n\n**Flatpak** (from Flathub):\n\n```bash\nflatpak install flathub com.calibre_ebook.calibre\n```\n\nRead Aloud finds calibre in any of these places by itself.\n\n**If Obsidian itself is a Flatpak:** Obsidian\'s sandbox cannot start\nprograms outside it unless you allow it. Allow it once with:\n\n```bash\nflatpak override --user --talk-name=org.freedesktop.Flatpak md.obsidian.Obsidian\n```\n\nThen restart Obsidian. (The AppImage or `.deb` version of Obsidian needs\nnone of this.)\n\n## 2. Install the plugin\n\nRead Aloud is not in Obsidian\'s community plugin list, so it is installed\nby hand:\n\n1. In your vault, open the hidden `.obsidian` folder, then `plugins` in it\n   (create `plugins` if it is not there). Hidden folders are shown with\n   Ctrl+H in most Linux file managers and Cmd+Shift+. in the macOS Finder;\n   on Windows, `.obsidian` is visible as it is.\n2. In it, create a folder named `read-aloud`.\n3. Put these three files from the plugin\'s GitHub page\n   (github.com/laszlorepassy/obsidian-read-aloud) into that folder:\n   `main.js`, `manifest.json` and `styles.css`.\n4. In Obsidian: **Settings \u2192 Community plugins**. If community plugins are\n   off, turn them on ("Turn on community plugins"). Click the refresh\n   button next to *Installed plugins*, then turn on **Read Aloud**.\n\nTo update the plugin later, replace the three files, then turn Read Aloud\noff and on again (or restart Obsidian).\n\n## 3. Download a voice\n\nOpen **Settings \u2192 Read Aloud**.\n\n1. Under **Speech engine**, a \u2713 with calibre\'s version shows that calibre\n   was found. If it shows \u2717, see Troubleshooting.\n2. Under **Download voices**, choose a **language**. Read Aloud offers the\n   language of your system first.\n3. Choose a **voice to download** and click **Download**. Voices are\n   20\u2013120 MB; the progress is shown under the voice.\n   - Quality: *medium* is a good balance of sound and speed; *high* sounds\n     a bit better but is slower; *low* and *x low* are the smallest.\n   - A \u2713 after a name means that voice is already installed.\n4. The voice just downloaded becomes the one that reads. Click **Listen\n   to this voice** to hear it.\n\nYou can download as many voices as you like and switch between them under\n**Voice**. The voices are stored in calibre\'s own folder, so calibre\'s\ne-book viewer can use them too, and they need downloading only once per\ncomputer.\n\n## Reading\n\n### Starting\n\n- **Speaker icon** in the left ribbon: starts at the cursor.\n- **Right-click** in the text \u2192 **Read aloud from here**: starts at the\n  sentence you clicked.\n- **Command palette** (Ctrl+P, Cmd+P on a Mac):\n  - *Read Aloud: Read from the cursor*\n  - *Read Aloud: Read note from the start*\n\nIn reading view, reading starts at the top of the screen.\n\nThe first start takes a few seconds while calibre starts and the voice\nloads; meanwhile the status bar shows "Starting\u2026". After that, reading\nstarts almost immediately, and the next sentence is prepared while the\ncurrent one is read, so there are no waits between them.\n\n### Controls while reading\n\nWhile reading, the controls appear in the status bar at the bottom right:\n\n| Button | What it does |\n|---|---|\n| \u2039 | Back one sentence (or, more than two seconds into a sentence, to its start) |\n| \u23F8 / \u25B6 | Pause / resume |\n| \u203A | Forward one sentence |\n| \u23F9 | Stop |\n\nThe speaker icon in the ribbon also pauses and resumes.\n\nThese are commands too, and you can give them hotkeys under\n**Settings \u2192 Hotkeys** (search for "Read Aloud"):\n\n- *Pause / resume*\n- *Stop reading*\n- *Next sentence* / *Previous sentence*\n- *Next paragraph* / *Previous paragraph* \u2013 skips to the start of the next\n  paragraph, or back to the start of the previous one\n\nTip: Ctrl+Alt+Space for pause/resume, Ctrl+Alt+\u2192 / Ctrl+Alt+\u2190 for next and\nprevious sentence, and Ctrl+Alt+\u2193 / Ctrl+Alt+\u2191 for next and previous\nparagraph work well.\n\n### What is read, and what is not\n\nParagraphs, headings, list items, quotes and table rows are read, sentence\nby sentence. An unusually long sentence is cut at commas (at 300\ncharacters by default), so reading never slows down.\n\nLeft out:\n\n- the properties at the top of the note (front matter),\n- code blocks, math and `%% comments %%`,\n- embedded images and notes,\n- link addresses (the link text is read),\n- Markdown syntax (`**`, `#`, `-` and so on).\n\n### Editing while reading\n\nYou can keep typing in the note while it is read: the highlight and the\nreading position move along with your edits.\n\nIn reading view, the sentence is highlighted in the rendered text too. Opening another note in the\nsame tab stops reading.\n\n## Settings\n\nAll of these can also be found with the search box at the top of\nObsidian\'s settings.\n\n**Speech engine**\n\n- **calibre with Piper** \u2013 whether calibre was found, and which version.\n  *Check again* looks again, e.g. after installing or updating calibre.\n\n**Voice**\n\n- **Voice** \u2013 the installed voice that reads.\n- **Listen to this voice** \u2013 click it to hear a sample sentence.\n- **Speed** \u2013 1 is the voice\'s own pace. Changing it while reading reloads\n  the voice, which causes a short pause.\n\n**Download voices** \u2013 see step 3.\n\n**Reading**\n\n- **Longest piece spoken at once** \u2013 a sentence longer than this many\n  characters is cut at commas.\n- **Pause between paragraphs** \u2013 in seconds; sentences within a paragraph\n  follow each other with Piper\'s own short pause.\n- **Scroll along** \u2013 keeps the sentence being read on screen.\n\n**Advanced** \u2013 both can be left empty:\n\n- **Path of calibre-debug** \u2013 for calibre in an unusual place, such as the\n  portable version on Windows.\n- **Voices folder** \u2013 where the voices are kept; empty means calibre\'s own\n  folder, which is shown under *Speech engine*. Piper voices from\n  anywhere else (an `.onnx` file together with its `.onnx.json`) can be\n  copied into this folder too; they then appear under **Voice**.\n\n## Troubleshooting\n\n**"calibre was not found"** \u2013 calibre is not installed, or not in its usual\nplace. Install it as in step 1, then click *Check\nagain* in the settings. For portable or unusual installs, enter the path of\n`calibre-debug` (`calibre-debug.exe` on Windows) under *Advanced*.\n\n**"calibre \u2026 has no built-in Piper; Read Aloud needs calibre 8.8 or\nnewer"** \u2013 update calibre. On Linux, a distribution package is usually the\ncause: use the official installer or Flatpak instead (see\nLinux).\n\n**"No voice is installed yet"** \u2013 download one under *Download voices*.\n\n**The download fails** \u2013 it needs an internet connection to\nhuggingface.co. A firewall or proxy may block it. You can also download a\nvoice by hand from huggingface.co/rhasspy/piper-voices (both the `.onnx`\nand the `.onnx.json` file) and copy them into the voices folder.\n\n**"Piper did not start"** or **"Piper stopped"** \u2013 the message shows\ncalibre\'s own error below. Try *Check again*; if it persists, reinstalling\nor updating calibre usually helps. On Linux with Obsidian as a Flatpak, see\nthe note at the end of Linux.\n\n**No sound** \u2013 check that the system volume is not muted and that the right\noutput device is selected; try *Listen to this voice* in the settings.\n\n**The first paragraph takes long** \u2013 only the very first start after\nopening Obsidian (or after 10 idle minutes, when Read Aloud frees the\nmemory it used) needs a few seconds to load the voice.\n';

// src/piper_server.py
var piper_server_default = `# -*- coding: utf-8 -*-
"""
Speech server for the Read Aloud plugin, run inside calibre's Python
(calibre-debug -e piper_server.py), which has Piper built in since calibre
8.8, on Windows, macOS and Linux alike.

It keeps the voice loaded, so a paragraph only costs its synthesis time
(about a quarter of its spoken length), not the seconds of loading the model.

Requests arrive on stdin, one JSON object per line:
    {"cmd": "voice", "model": "/path/voice.onnx", "speed": 1.0}
    {"cmd": "speak", "id": 7, "text": "..."}
    {"cmd": "cancel"}                   drop everything queued or being spoken
    {"cmd": "catalog", "dir": "..."}    the voices calibre knows, and which
                                        of them are in \`dir\` (default: calibre's)
    {"cmd": "download", "key": "hu_HU-anna-medium", "dir": "..."}

Everything goes back on stdout as one JSON header line followed by exactly
"bytes" bytes of payload, which is only ever 16-bit mono PCM of a sentence:
    {"id": 7, "rate": 22050, "bytes": 51200, "last": false}\\n<pcm>
The other messages have no payload: {"ready": ...}, {"voice": ...},
{"catalog": [...]}, {"download": key, ...} and {"error": ..., "id"?: ...}.
"""

import json
import os
import queue
import re
import sys
import threading

# About this share of Piper's speech does not follow its length scale, so
# the length scale is stretched to make the whole come out at the asked speed.
FIXED_SHARE = 0.3
SENTENCE_PAUSE = 0.25
QUALITIES = ("x_low", "low", "medium", "high")


def private_stdout():
    """
    The frames get stdout to themselves: anything else printed there (by
    calibre, Piper, espeak or onnxruntime, from Python or C) would land
    between a header and its audio and garble both. fd 1 is duplicated for
    the frames, and fd 1 itself then goes to stderr.
    """
    fd = os.dup(1)
    if sys.platform == "win32":
        import msvcrt
        msvcrt.setmode(fd, os.O_BINARY)
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    return os.fdopen(fd, "wb")


out = private_stdout()
out_lock = threading.Lock()
requests = queue.Queue()
generation = 0          # bumped by every cancel; older speak requests are dropped


def send(header, pcm=b""):
    header["bytes"] = len(pcm)
    with out_lock:
        out.write(json.dumps(header).encode("utf-8") + b"\\n")
        out.write(pcm)
        out.flush()


def read_stdin():
    global generation
    try:
        for line in sys.stdin.buffer:
            try:
                req = json.loads(line)
                cmd = req.get("cmd")
                if cmd == "cancel":
                    generation += 1
                elif cmd == "catalog":
                    send_catalog(req.get("dir"))
                    continue
                elif cmd == "download":
                    threading.Thread(target=download,
                                     args=(req["key"], req.get("dir")),
                                     daemon=True).start()
                    continue
                req["generation"] = generation
                requests.put(req)
            except Exception as e:
                send({"error": "Bad request: %s" % e})
    finally:
        requests.put(None)  # Obsidian went away, or reading failed


def length_multiplier(speed):
    scale = (1 / speed - FIXED_SHARE) / (1 - FIXED_SHARE)
    return max(-1.0, min(0.9, 1 - scale))


# ------------------------------------------------------------------ voices

def default_voices_dir():
    try:
        from calibre.gui2.tts.piper import piper_cache_dir
        return piper_cache_dir()
    except Exception:
        from calibre.constants import cache_dir
        return os.path.join(cache_dir(), "piper-voices")


def known_voices():
    """{key: {lang, name, quality, model_url, config_url}} from calibre's list."""
    from calibre.utils.resources import get_path
    with open(get_path("piper-voices.json"), "rb") as f:
        lang_map = json.load(f)["lang_map"]
    voices = {}
    for lang, names in lang_map.items():
        for name, qualities in names.items():
            for quality, urls in qualities.items():
                key = "%s-%s-%s" % (lang, name, quality)
                voices[key] = {"lang": lang, "name": name, "quality": quality,
                               "model_url": urls["model"],
                               "config_url": urls["config"]}
    return voices


def send_catalog(folder):
    """Always answers, so a request never waits forever: on failure, with
    an empty list and "catalogError"."""
    try:
        catalog, folder = make_catalog(folder)
        send({"catalog": catalog, "dir": folder})
    except Exception as e:
        send({"catalog": [], "dir": folder or "",
              "catalogError": "Could not list the voices: %s" % e})


def make_catalog(folder):
    folder = folder or default_voices_dir()
    try:
        voices = known_voices()
    except Exception as e:
        raise RuntimeError("could not read calibre's list of voices: %s" % e)
    try:
        files = set(os.listdir(folder))
    except OSError:
        files = set()
    catalog = []
    for key, v in voices.items():
        catalog.append({"key": key, "lang": v["lang"], "name": v["name"],
                        "quality": v["quality"],
                        "installed": key + ".onnx" in files
                        and key + ".onnx.json" in files})
    # Voices put in the folder by hand, from anywhere.
    for f in sorted(files):
        key = f[:-5]
        if f.endswith(".onnx") and key not in voices and key + ".onnx.json" in files:
            m = re.match(r"^([a-z]{2,3}_[A-Z]{2})-(.+?)(?:-(%s))?$"
                         % "|".join(QUALITIES), key)
            catalog.append({"key": key, "lang": m.group(1) if m else "",
                            "name": m.group(2) if m else key,
                            "quality": (m.group(3) or "") if m else "",
                            "installed": True})
    return catalog, folder


def open_url(url):
    try:
        # calibre's browser brings its own certificates on every platform.
        from calibre import browser
        return browser().open(url, timeout=60)
    except ImportError:
        import urllib.request
        return urllib.request.urlopen(url, timeout=60)


def fetch(url, path, report):
    part = path + ".part"
    r = open_url(url)
    try:
        total = int(r.info().get("Content-Length") or 0)
        done = 0
        with open(part, "wb") as f:
            while True:
                data = r.read(256 * 1024)
                if not data:
                    break
                f.write(data)
                done += len(data)
                report(done, total)
    finally:
        r.close()
    os.replace(part, path)


def download(key, folder):
    folder = folder or default_voices_dir()
    try:
        voice = known_voices().get(key)
        if not voice:
            raise ValueError("calibre does not know the voice %s" % key)
        os.makedirs(folder, exist_ok=True)
        model = os.path.join(folder, key + ".onnx")
        fetch(voice["config_url"], model + ".json", lambda d, t: None)
        last = [-1]

        def report(done, total):
            # Every percent, or every megabyte when the size is not known.
            step = int(100 * done / total) if total else done // (1 << 20)
            if step != last[0]:
                last[0] = step
                send({"download": key, "done": done, "total": total})
        fetch(voice["model_url"], model, report)
        send({"download": key, "finished": True})
    except Exception as e:
        send({"download": key, "error": str(e)})


# ------------------------------------------------------------------ speech

def main():
    try:
        from calibre.utils.tts import piper
        import calibre_extensions.piper as engine
    except ImportError:
        from calibre.constants import __version__
        send({"error": "calibre %s has no built-in Piper; Read Aloud needs "
                       "calibre 8.8 or newer." % __version__, "fatal": True})
        return
    from calibre.constants import __version__

    engine.initialize(piper.espeak_data_dir())
    threading.Thread(target=read_stdin, daemon=True).start()
    send({"ready": True, "calibre": __version__,
          "voicesDir": default_voices_dir()})

    loaded = None
    while True:
        req = requests.get()
        if req is None:
            return
        cmd = req.get("cmd")
        if cmd == "voice":
            wanted = (req["model"], float(req.get("speed", 1.0)))
            if wanted == loaded:
                continue
            try:
                speed = max(0.5, min(3.0, wanted[1]))
                piper.set_voice(wanted[0] + ".json", wanted[0],
                                length_multiplier(speed),
                                SENTENCE_PAUSE / speed)
                loaded = wanted
                send({"voice": os.path.basename(wanted[0])})
            except Exception as e:
                loaded = None
                send({"error": "Could not load the voice %s: %s"
                      % (wanted[0], e), "voiceFailed": True,
                      "model": wanted[0]})
        elif cmd == "speak":
            speak(engine, req, loaded)


def speak(engine, req, loaded):
    rid = req["id"]
    if req["generation"] != generation:
        return
    if loaded is None:
        send({"id": rid, "error": "No voice is loaded."})
        return
    try:
        engine.start(req["text"])
        while True:
            data, _, rate, last = engine.next(True)
            if req["generation"] != generation:
                # Cancelled: finish the utterance quietly so the engine is
                # ready for the next one, but send nothing more.
                while not last:
                    _, _, _, last = engine.next(True)
                return
            send({"id": rid, "rate": rate, "last": bool(last)}, data)
            if last:
                return
    except Exception as e:
        send({"id": rid, "error": str(e)})


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
`;

// src/main.ts
function errorText(err) {
  return err instanceof Error ? err.message : String(err);
}
function editorView(view) {
  const editor = view.editor;
  return editor?.cm ?? null;
}
var DEFAULT_SETTINGS = {
  calibreDebug: "",
  // empty: found automatically
  voicesDir: "",
  // empty: calibre's own folder of Piper voices
  voice: "",
  // empty: an installed voice in the user's language
  speed: 1,
  maxLength: 300,
  paragraphPause: 0.5,
  follow: true
};
function userLocales() {
  const list = [...navigator.languages || [], navigator.language || ""];
  list.push((0, import_obsidian.getLanguage)());
  return list.filter(Boolean);
}
var ReadAloudPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.settings = { ...DEFAULT_SETTINGS };
    this.session = null;
    this.audio = null;
    this.nextTrackId = 1;
    this.playhead = 0;
    this.test = null;
    this.foundCalibre = void 0;
    this.lastCatalog = null;
    this.sentenceCache = null;
    this.previewWin = null;
  }
  async onload() {
    await this.loadSettings();
    this.session = null;
    this.audio = null;
    this.nextTrackId = 1;
    this.piper = new PiperClient({
      serverSource: piper_server_default,
      scriptDir: this.pluginDir(),
      onAudio: (id, samples, rate, last) => this.onAudio(id, samples, rate, last),
      onError: (err, info) => this.onPiperError(err, info),
      isBusy: () => !!this.session
    });
    this.registerEditorExtension(readingField);
    this.ribbon = this.addRibbonIcon("volume-2", "Read aloud / pause", () => this.toggle());
    this.buildStatus();
    this.updateStatus();
    this.addCommand({
      id: "read-from-cursor",
      name: "Read from the cursor",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
        if (!view) return false;
        if (!checking) void this.startInView(view, "cursor");
        return true;
      }
    });
    this.addCommand({
      id: "read-note",
      name: "Read note from the start",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
        if (!view) return false;
        if (!checking) void this.startInView(view, "start");
        return true;
      }
    });
    this.addCommand({
      id: "pause-resume",
      name: "Pause / resume",
      checkCallback: (checking) => {
        if (!this.session) return false;
        if (!checking) this.togglePause();
        return true;
      }
    });
    this.addCommand({
      id: "stop",
      name: "Stop reading",
      checkCallback: (checking) => {
        if (!this.session) return false;
        if (!checking) this.stop();
        return true;
      }
    });
    const skipCommand = (id, name, direction, by) => this.addCommand({
      id,
      name,
      checkCallback: (checking) => {
        if (!this.session) return false;
        if (!checking) this.skip(direction, by);
        return true;
      }
    });
    skipCommand("next-sentence", "Next sentence", 1, "sentence");
    skipCommand("previous-sentence", "Previous sentence", -1, "sentence");
    skipCommand("next", "Next paragraph", 1, "paragraph");
    skipCommand("previous", "Previous paragraph", -1, "paragraph");
    this.addCommand({
      id: "help",
      name: "Help",
      callback: () => new HelpModal(this.app, this).open()
    });
    this.registerEvent(this.app.workspace.on("editor-menu", (menu, _editor, info) => {
      if (!(info instanceof import_obsidian.MarkdownView)) return;
      menu.addItem((item) => item.setTitle("Read aloud from here").setIcon("volume-2").onClick(() => {
        void this.startInView(info, "cursor");
      }));
    }));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.checkView()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.checkView()));
    this.addSettingTab(new ReadAloudSettingTab(this.app, this));
  }
  onunload() {
    this.stop();
    this.piper.stop();
    if (this.audio) void this.audio.close();
  }
  pluginDir() {
    const adapter = this.app.vault.adapter;
    const base = adapter instanceof import_obsidian.FileSystemAdapter ? adapter.getBasePath() : "";
    return path3.join(base, this.manifest.dir ?? "");
  }
  /** The audio output, made on first use (and again if it was closed). */
  audioContext() {
    if (!this.audio || this.audio.state === "closed") this.audio = new AudioContext();
    return this.audio;
  }
  // ------------------------------------------------------------ speech engine
  /**
   * How to run calibre, looked up once: in a Flatpak sandbox every look asks
   * the host. `forgetCalibre` makes the next start look again.
   */
  calibre() {
    if (this.foundCalibre === void 0) this.foundCalibre = findCalibre(this.settings.calibreDebug);
    return this.foundCalibre;
  }
  forgetCalibre() {
    this.foundCalibre = void 0;
  }
  /** Starts the speech server if needed; resolves with its "ready" message. */
  startPiper() {
    return this.piper.ready || this.piper.start(this.calibre());
  }
  /** The voices calibre knows, marked installed or not; starts the server. */
  async catalog() {
    await this.startPiper();
    this.lastCatalog = await this.piper.catalog(this.settings.voicesDir);
    return this.lastCatalog;
  }
  /** The .onnx file of the voice to read with, or null if none is installed. */
  async voiceModel() {
    const { voices: list, dir } = await this.catalog();
    const key = chooseVoice(list, this.settings.voice, userLocales());
    return key ? path3.join(dir, key + ".onnx") : null;
  }
  /** Reads a sample sentence with a voice, for the settings. */
  async testVoice(voice) {
    this.stop();
    this.stopTest();
    const { dir } = await this.catalog();
    void this.audioContext().resume();
    const model = path3.join(dir, voice.key + ".onnx");
    this.test = { id: this.nextTrackId++, head: 0, sources: [], model };
    this.piper.setVoice(model, this.settings.speed);
    this.piper.speak(this.test.id, sampleText(voice));
  }
  stopTest() {
    if (!this.test) return;
    for (const s of this.test.sources) {
      try {
        s.stop();
      } catch {
      }
    }
    this.test = null;
    this.piper.cancel();
  }
  openSettings() {
    try {
      const setting = this.app.setting;
      setting?.open();
      setting?.openTabById(this.manifest.id);
    } catch {
    }
  }
  // ------------------------------------------------------------ starting
  toggle() {
    if (this.session) {
      this.togglePause();
      return;
    }
    const view = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
    if (!view) {
      new import_obsidian.Notice("Open a note to read it aloud.");
      return;
    }
    void this.startInView(view, "cursor");
  }
  async startInView(view, where) {
    const cm = editorView(view);
    if (!cm) {
      new import_obsidian.Notice("This view cannot be read aloud.");
      return;
    }
    let offset = 0;
    if (where === "cursor") {
      offset = view.getMode() === "preview" ? this.previewTopOffset(view, cm) : cm.state.selection.main.head;
    }
    this.stop();
    this.stopTest();
    const sentences = segment(cm.state.doc.toString(), { maxLength: this.settings.maxLength });
    let seg = sentences.find((p) => p.to > offset);
    if (!seg && where === "cursor") seg = sentences[0];
    if (!seg) {
      new import_obsidian.Notice("There is nothing to read in this note.");
      return;
    }
    const session = {
      view,
      cm,
      file: view.file,
      current: null,
      next: null,
      paused: false,
      loading: true,
      model: null
    };
    this.session = session;
    this.updateStatus();
    void this.audioContext().resume();
    this.playhead = 0;
    try {
      session.model = await this.voiceModel();
    } catch (err) {
      if (this.session === session) this.stop();
      new import_obsidian.Notice("Read Aloud could not start: " + errorText(err) + "\n\nSee Settings \u2192 Read Aloud and the help there.", 15e3);
      console.error("Read Aloud:", err);
      return;
    }
    if (this.session !== session) return;
    if (!session.model) {
      this.stop();
      new import_obsidian.Notice("No voice is installed yet. Download one in the settings, which open now.", 1e4);
      this.openSettings();
      return;
    }
    this.play(session, seg);
  }
  /** In reading view, the note offset of the first section on screen. */
  previewTopOffset(view, cm) {
    try {
      const { renderer } = view.previewMode;
      const top = view.previewMode.containerEl.getBoundingClientRect().top;
      for (const s of renderer.sections) {
        if (s.el.isConnected && s.el.getBoundingClientRect().bottom > top + 10) {
          return cm.state.doc.line(Math.min(s.lineStart + 1, cm.state.doc.lines)).from;
        }
      }
    } catch {
    }
    return 0;
  }
  // ------------------------------------------------------------ sentences
  request(session, seg) {
    const track = {
      id: this.nextTrackId++,
      seg,
      playing: false,
      done: false,
      pending: 0,
      queued: [],
      sources: []
    };
    if (session.model) this.piper.setVoice(session.model, this.settings.speed);
    this.piper.speak(track.id, seg.text);
    return track;
  }
  /** Starts reading the sentence `seg`, using its audio if it was prepared. */
  play(session, seg) {
    let track = session.next;
    session.next = null;
    if (!track || track.seg.text !== seg.text) {
      if (track) this.piper.cancel();
      track = this.request(session, seg);
    }
    track.seg = seg;
    track.playing = true;
    session.current = track;
    this.highlight(session, seg);
    this.updateStatus();
    const following = this.sentenceAfter(session, seg.to);
    if (following) session.next = this.request(session, following);
    for (const chunk of track.queued) this.schedule(track, chunk);
    track.queued = [];
    this.checkFinished(track);
  }
  /**
   * The sentences of the note as it is now. A document state never changes,
   * so they are only worked out again after an edit.
   */
  sentences(session) {
    const doc = session.cm.state.doc;
    const max = this.settings.maxLength;
    const cache = this.sentenceCache;
    if (cache && cache.doc === doc && cache.max === max) return cache.sentences;
    const sentences = segment(doc.toString(), { maxLength: max });
    this.sentenceCache = { doc, max, sentences };
    return sentences;
  }
  /** The first sentence starting at or after `offset` in the note as it is now. */
  sentenceAfter(session, offset) {
    return this.sentences(session).find((p) => p.from >= offset) ?? null;
  }
  onAudio(id, samples, rate, last) {
    if (this.test && this.test.id === id) {
      this.playTest(this.test, samples, rate);
      return;
    }
    const session = this.session;
    if (!session) return;
    const track = [session.current, session.next].find((t) => t && t.id === id);
    if (!track) return;
    const chunk = { samples, rate };
    if (last) track.done = true;
    if (track.playing) {
      if (session.loading) {
        session.loading = false;
        this.updateStatus();
      }
      this.schedule(track, chunk);
      this.checkFinished(track);
    } else {
      track.queued.push(chunk);
    }
  }
  /** Hands a piece of audio to the speakers, at `at` or right away. */
  playChunk({ samples, rate }, at) {
    const ctx = this.audioContext();
    const buffer = ctx.createBuffer(1, samples.length, rate);
    buffer.copyToChannel(samples, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(Math.max(ctx.currentTime + 0.03, at));
    return source;
  }
  schedule(track, chunk) {
    if (!chunk.samples.length) return;
    const at = Math.max(this.audioContext().currentTime + 0.03, this.playhead);
    const source = this.playChunk(chunk, at);
    this.playhead = at + chunk.samples.length / chunk.rate;
    if (track.startAt === void 0) track.startAt = at;
    track.pending++;
    track.sources.push(source);
    source.onended = () => {
      track.pending--;
      this.checkFinished(track);
    };
  }
  playTest(test, samples, rate) {
    if (!samples.length) return;
    const at = Math.max(this.audioContext().currentTime + 0.03, test.head);
    test.sources.push(this.playChunk({ samples, rate }, at));
    test.head = at + samples.length / rate;
  }
  checkFinished(track) {
    const session = this.session;
    if (!session || session.current !== track || !track.done || track.pending > 0) return;
    if (track.finished) return;
    track.finished = true;
    this.advance(session, track);
  }
  advance(session, track) {
    if (!this.viewAlive()) {
      this.stop();
      return;
    }
    const range = readingRange(session.cm) ?? track.seg;
    const seg = this.sentenceAfter(session, range.to);
    if (!seg) {
      this.stop();
      return;
    }
    const newBlock = seg.block.from >= range.block.to;
    this.playhead = this.audioContext().currentTime + (newBlock ? this.settings.paragraphPause / this.settings.speed : 0);
    this.play(session, seg);
  }
  /**
   * Jumps to the next (+1) or previous (-1) sentence or paragraph. Going back
   * a sentence more than a couple of seconds into one starts it again, like
   * the back button of a player; pressed right after, it goes one further.
   */
  skip(direction, by = "sentence") {
    const session = this.session;
    const track = session?.current;
    if (!session || !track) return;
    const range = readingRange(session.cm) ?? track.seg;
    const sentences = this.sentences(session);
    let target;
    if (by === "paragraph") {
      if (direction > 0) {
        target = sentences.find((p) => p.block.from >= range.block.to);
      } else {
        const before = sentences.filter((p) => p.block.to <= range.block.from);
        const block = before.length ? before[before.length - 1].block : range.block;
        target = sentences.find((p) => p.block.from === block.from);
      }
    } else if (direction > 0) {
      target = sentences.find((p) => p.from >= range.to);
    } else {
      const heard = track.startAt === void 0 ? 0 : this.audioContext().currentTime - track.startAt;
      const before = sentences.filter((p) => p.to <= range.from);
      target = heard > 2 || !before.length ? sentences.find((p) => p.to > range.from) : before[before.length - 1];
    }
    if (!target) return;
    this.silence(session);
    this.piper.cancel();
    session.next = null;
    this.playhead = 0;
    if (session.paused) {
      session.paused = false;
      void this.audioContext().resume();
    }
    this.play(session, target);
  }
  // ------------------------------------------------------------ pause / stop
  togglePause() {
    const session = this.session;
    if (!session || !session.current) return;
    session.paused = !session.paused;
    if (session.paused) void this.audioContext().suspend();
    else void this.audioContext().resume();
    this.updateStatus();
  }
  /** Stops the sounds already handed to the speakers. */
  silence(session) {
    for (const track of [session.current, session.next]) {
      if (!track) continue;
      track.finished = true;
      for (const s of track.sources) {
        s.onended = null;
        try {
          s.stop();
        } catch {
        }
      }
    }
  }
  stop() {
    const session = this.session;
    if (!session) return;
    this.silence(session);
    this.session = null;
    this.piper.cancel();
    if (this.audio && session.paused) void this.audio.resume();
    try {
      showReading(session.cm, null, false);
    } catch {
    }
    this.clearPreviewHighlight();
    this.updateStatus();
  }
  /**
   * An error from the speech server. Reading stops only for what breaks it:
   * the server crashing, the sentence being read failing, or the voice it
   * reads with failing to load. A voice tried in the settings says so.
   */
  onPiperError(err, info = {}) {
    console.error("Read Aloud:", err);
    const test = this.test;
    if (test && (info.id !== void 0 && info.id === test.id || info.voiceFailed && info.model === test.model || info.crashed)) {
      this.test = null;
      new import_obsidian.Notice("Read Aloud: " + err.message, 1e4);
    }
    const session = this.session;
    if (!session) return;
    let fatal = info.crashed === true;
    if (info.id !== void 0) {
      if (session.next && session.next.id === info.id) session.next = null;
      fatal = session.current !== null && session.current.id === info.id;
    } else if (info.voiceFailed) {
      fatal = info.model === session.model;
    }
    if (!fatal) return;
    new import_obsidian.Notice("Read Aloud error: " + err.message, 8e3);
    this.stop();
  }
  viewAlive() {
    const s = this.session;
    return !!s && s.cm.dom.isConnected && s.view.file === s.file;
  }
  checkView() {
    const session = this.session;
    if (!session) return;
    if (!this.viewAlive()) this.stop();
    else if (session.current) this.highlightPreview(session, session.current.seg, false);
  }
  // ------------------------------------------------------------ showing it
  highlight(session, seg) {
    showReading(session.cm, { from: seg.from, to: seg.to, block: seg.block }, this.settings.follow);
    this.highlightPreview(session, seg, this.settings.follow);
  }
  /**
   * In reading view, the editor's highlight is not visible, so the sentence
   * is found in the rendered text and marked with a CSS custom highlight,
   * which leaves the rendered page itself untouched.
   */
  highlightPreview(session, seg, scroll) {
    this.clearPreviewHighlight();
    if (session.view.getMode() !== "preview") return;
    try {
      const doc = session.cm.state.doc;
      const range = readingRange(session.cm) ?? seg;
      const first = doc.lineAt(range.block.from).number - 1;
      const last = doc.lineAt(range.to).number - 1;
      const preview = session.view.previewMode;
      const { renderer } = preview;
      const sections = renderer.sections.filter((s) => s.lineEnd >= first && s.lineStart <= last);
      if (!sections.length) return;
      if (scroll && !sections[0].el.isConnected) preview.applyScroll(first);
      const page = sections[0].el.ownerDocument;
      const win = page.defaultView;
      if (!win || !("highlights" in win.CSS)) return;
      const nodes = [];
      for (const s of sections) {
        const walker = page.createTreeWalker(s.el, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
      }
      const hint = keyLength(speakable(doc.sliceString(doc.line(sections[0].lineStart + 1).from, range.from)));
      const found = matchText(nodes.map((n) => n.data), seg.text, hint);
      if (!found) return;
      const marked = page.createRange();
      marked.setStart(nodes[found.start[0]], found.start[1]);
      marked.setEnd(nodes[found.end[0]], found.end[1]);
      win.CSS.highlights.set("readaloud-current", new win.Highlight(marked));
      this.previewWin = win;
      if (scroll) {
        const el = marked.startContainer.parentElement;
        if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    } catch {
    }
  }
  clearPreviewHighlight() {
    try {
      this.previewWin?.CSS.highlights.delete("readaloud-current");
    } catch {
    }
    this.previewWin = null;
  }
  /**
   * The controls in the status bar: a label, then previous sentence, pause,
   * next sentence and stop buttons. They are built once and only updated,
   * each button with its own tooltip, so a tooltip always points at the
   * button under the mouse.
   */
  buildStatus() {
    this.status = this.addStatusBarItem();
    this.status.addClass("readaloud-status");
    this.statusLabel = this.status.createSpan({ cls: "readaloud-status-label" });
    const button = (icon, tooltip, onClick) => {
      const el = this.status.createDiv({ cls: "readaloud-status-button clickable-icon" });
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onClick();
      });
      if (icon) (0, import_obsidian.setIcon)(el, icon);
      if (tooltip) (0, import_obsidian.setTooltip)(el, tooltip, { placement: "top" });
      return el;
    };
    button("chevron-left", "Previous sentence", () => this.skip(-1, "sentence"));
    this.pauseButton = button(null, null, () => this.togglePause());
    button("chevron-right", "Next sentence", () => this.skip(1, "sentence"));
    button("square", "Stop", () => this.stop());
  }
  updateStatus() {
    const s = this.session;
    if (!s) {
      this.status.hide();
      return;
    }
    this.status.show();
    this.statusLabel.setText(s.loading ? "Starting\u2026" : s.paused ? "Paused" : "Reading");
    const icon = s.paused ? "play" : "pause";
    if (this.pauseButton.dataset.icon !== icon) {
      this.pauseButton.dataset.icon = icon;
      (0, import_obsidian.setIcon)(this.pauseButton, icon);
      (0, import_obsidian.setTooltip)(this.pauseButton, s.paused ? "Resume" : "Pause", { placement: "top" });
    }
  }
  async loadSettings() {
    const saved = await this.loadData();
    this.settings = { ...DEFAULT_SETTINGS, ...saved };
    if (this.settings.calibreDebug === "/opt/calibre/calibre-debug") this.settings.calibreDebug = "";
    if (this.settings.voicesDir === path3.join(os2.homedir(), ".cache", "calibre", "piper-voices")) {
      this.settings.voicesDir = "";
    }
  }
  /** The voice setting changed: read on with it from the next piece. */
  async voiceChanged() {
    if (!this.session || this.session.loading) return;
    try {
      const model = await this.voiceModel();
      if (model && this.session) this.session.model = model;
    } catch {
    }
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
var ReadAloudSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    // What the speech server told, plus the download section's choices.
    this.engine = { status: "checking" };
    this.needsCheck = true;
    // look again when the tab is next shown
    this.downloadLang = null;
    this.downloadKey = null;
    this.downloading = null;
    this.progressEl = null;
    this.plugin = plugin;
  }
  /**
   * Asks the speech server about calibre and the voices, then redraws. What
   * was known stays on screen meanwhile, unless `fresh`.
   */
  async check(fresh = false) {
    if (fresh || this.engine.status !== "ok") {
      this.engine = { status: "checking" };
      this.update();
    }
    let engine;
    try {
      const { voices: list, dir } = await this.plugin.catalog();
      const info = this.plugin.piper.info ?? { calibre: "", voicesDir: dir };
      engine = { status: "ok", info, voices: list, dir };
    } catch (err) {
      engine = { status: "error", error: errorText(err) };
    }
    this.engine = engine;
    this.update();
  }
  hide() {
    this.plugin.stopTest();
    this.needsCheck = true;
    super.hide();
  }
  /** Starts the speech server anew, e.g. after calibre was installed. */
  restartEngine() {
    this.plugin.stop();
    this.plugin.piper.stop();
    this.plugin.forgetCalibre();
    void this.check(true);
  }
  getControlValue(key) {
    if (key === "voice" && this.engine.status === "ok") {
      return chooseVoice(this.engine.voices, this.plugin.settings.voice, userLocales()) ?? "";
    }
    return super.getControlValue(key);
  }
  async setControlValue(key, value) {
    const settings = this.plugin.settings;
    settings[key] = typeof value === "string" ? value.trim() : value;
    await this.plugin.saveSettings();
    if (key === "voice") void this.plugin.voiceChanged();
    if (key === "calibreDebug") this.plugin.forgetCalibre();
  }
  getSettingDefinitions() {
    return [
      {
        name: "User guide",
        desc: "Setting up calibre and voices on Windows, macOS and Linux, and how to use the plugin.",
        aliases: ["help", "install"],
        render: (setting) => {
          setting.addButton((b) => b.setButtonText("Open help").onClick(() => new HelpModal(this.app, this.plugin).open()));
        }
      },
      {
        type: "group",
        heading: "Speech engine",
        items: [{
          name: "calibre with Piper",
          desc: "Read Aloud speaks with the Piper built into calibre 8.8 or newer.",
          aliases: ["calibre", "engine", "status"],
          render: (setting) => this.renderEngine(setting)
        }]
      },
      {
        type: "group",
        heading: "Voice",
        items: this.voiceItems()
      },
      {
        type: "group",
        heading: "Download voices",
        items: this.engine.status !== "ok" ? [this.waitingItem("Voice to download")] : [
          {
            name: "Language",
            desc: "Voices in 58 languages, from the Piper project (huggingface.co/rhasspy/piper-voices).",
            aliases: ["download", "voices"],
            render: (setting) => this.renderLanguage(setting)
          },
          {
            name: "Voice to download",
            desc: 'Most voices are 20\u2013120 MB. "medium" is a good balance of quality and speed.',
            aliases: ["download"],
            render: (setting) => this.renderDownload(setting)
          }
        ]
      },
      {
        type: "group",
        heading: "Reading",
        items: [
          {
            name: "Longest piece spoken at once (characters)",
            desc: "Notes are read sentence by sentence; a sentence longer than this is cut at commas.",
            control: { type: "slider", key: "maxLength", min: 120, max: 800, step: 20, defaultValue: 300 }
          },
          {
            name: "Pause between paragraphs (seconds)",
            control: {
              type: "slider",
              key: "paragraphPause",
              min: 0,
              max: 2,
              step: 0.1,
              defaultValue: 0.5,
              displayFormat: (v) => `${v.toFixed(1)} s`
            }
          },
          {
            name: "Scroll along",
            desc: "Keep the sentence being read in view.",
            control: { type: "toggle", key: "follow", defaultValue: true }
          }
        ]
      },
      {
        type: "group",
        heading: "Advanced",
        items: [
          {
            name: "Path of calibre-debug",
            desc: "Leave empty to find calibre automatically. Needed only for calibre in an unusual place, such as the portable version on Windows. A folder (Calibre2, calibre.app) is fine too.",
            control: {
              type: "text",
              key: "calibreDebug",
              placeholder: "Found automatically",
              validate: (value) => validCalibrePath(value)
            }
          },
          {
            name: "Voices folder",
            desc: `Leave empty to share the voices with calibre's e-book viewer. Voices from elsewhere (an .onnx file with its .onnx.json) can be put in this folder too. Click "Check again" above after changing it.`,
            control: { type: "text", key: "voicesDir", placeholder: "calibre's voices folder" }
          }
        ]
      }
    ];
  }
  renderEngine(setting) {
    if (this.needsCheck) {
      this.needsCheck = false;
      window.setTimeout(() => {
        void this.check();
      }, 0);
    }
    const e = this.engine;
    if (e.status === "checking") {
      setting.setDesc("Looking for calibre\u2026");
    } else if (e.status === "ok") {
      const where = this.plugin.calibre();
      setting.setDesc(createFragment((f) => {
        f.appendText(`\u2713 calibre ${e.info.calibre} found: ${where ? where.label : ""}`);
        f.createEl("br");
        f.appendText(`Voices folder: ${e.dir}`);
      }));
    } else {
      setting.setDesc(createFragment((f) => {
        f.createSpan({ cls: "readaloud-error", text: `\u2717 ${e.error}` });
        f.createEl("br");
        f.appendText("Install calibre 8.8 or newer from ");
        f.createEl("a", { text: "calibre-ebook.com", href: "https://calibre-ebook.com/download" });
        f.appendText(", then click Check again. The help tells how, for each system.");
      }));
    }
    setting.addButton((b) => b.setButtonText("Check again").setDisabled(e.status === "checking").onClick(() => this.restartEngine()));
  }
  /** A row standing in for what needs calibre, until it is found. */
  waitingItem(name) {
    return {
      name,
      desc: this.engine.status === "checking" ? "Looking for calibre\u2026" : "Available once calibre is found.",
      aliases: ["voice", "download"]
    };
  }
  voiceItems() {
    const speed = {
      name: "Speed",
      desc: "At 1, the voice keeps its own pace. Changing the speed reloads the voice (a few seconds).",
      control: {
        type: "slider",
        key: "speed",
        min: 0.6,
        max: 2,
        step: 0.05,
        defaultValue: 1,
        displayFormat: (v) => `${v.toFixed(2)}\xD7`
      }
    };
    if (this.engine.status !== "ok") return [this.waitingItem("Voice"), speed];
    const installed = this.engine.voices.filter((v) => v.installed).sort(byLanguageThenName);
    if (!installed.length) {
      return [{ name: "Voice", desc: "No voice is installed yet. Download one below." }, speed];
    }
    const options = {};
    for (const v of installed) options[v.key] = voiceLabel(v);
    return [
      {
        name: "Voice",
        desc: "The voice that reads your notes.",
        control: { type: "dropdown", key: "voice", options }
      },
      {
        name: "Listen to this voice",
        desc: "Reads a sample sentence with the voice chosen above.",
        aliases: ["test", "sample", "try"],
        action: () => {
          const key = this.getControlValue("voice");
          const voice = installed.find((v) => v.key === key);
          if (voice) this.plugin.testVoice(voice).catch((err) => new import_obsidian.Notice("Read Aloud: " + errorText(err)));
        }
      },
      speed
    ];
  }
  /** The voices of the language chosen for download, and that language. */
  downloadChoices() {
    const all = this.engine.status === "ok" ? this.engine.voices.filter((v) => v.lang) : [];
    const langs = languages(all);
    if (!this.downloadLang || !langs.some((l) => l.lang === this.downloadLang)) {
      this.downloadLang = preferredLanguage(all, userLocales());
    }
    const inLang = all.filter((v) => v.lang === this.downloadLang).sort(byLanguageThenName);
    if (!inLang.some((v) => v.key === this.downloadKey)) {
      this.downloadKey = (inLang.find((v) => !v.installed) ?? inLang[0])?.key ?? null;
    }
    return { langs, inLang };
  }
  renderLanguage(setting) {
    const { langs } = this.downloadChoices();
    setting.addDropdown((dd) => {
      for (const l of langs) dd.addOption(l.lang, l.label);
      if (this.downloadLang) dd.setValue(this.downloadLang);
      dd.onChange((value) => {
        this.downloadLang = value;
        this.downloadKey = null;
        this.update();
      });
    });
  }
  renderDownload(setting) {
    const { inLang } = this.downloadChoices();
    const chosen = inLang.find((v) => v.key === this.downloadKey);
    const busy = this.downloading;
    if (busy) setting.setDesc(busy.text);
    else if (chosen && chosen.installed) setting.setDesc("This voice is installed.");
    this.progressEl = busy ? setting.descEl : null;
    setting.addDropdown((dd) => {
      for (const v of inLang) dd.addOption(v.key, voiceName(v) + (v.installed ? " \u2713" : ""));
      if (this.downloadKey) dd.setValue(this.downloadKey);
      dd.onChange((value) => {
        this.downloadKey = value;
        this.update();
      });
    });
    setting.addButton((b) => {
      b.setButtonText(chosen && chosen.installed ? "Download again" : "Download").setDisabled(!chosen || !!busy).onClick(() => {
        if (chosen) void this.download(chosen);
      });
      if (chosen && !chosen.installed) b.setCta();
    });
  }
  async download(voice) {
    const settings = this.plugin.settings;
    const mb = (n) => (n / 1048576).toFixed(0);
    const downloading = { key: voice.key, text: "Starting the download\u2026" };
    this.downloading = downloading;
    this.update();
    try {
      await this.plugin.startPiper();
      await this.plugin.piper.download(voice.key, settings.voicesDir, (done, total) => {
        downloading.text = total ? `Downloading\u2026 ${Math.floor(100 * done / total)}% of ${mb(total)} MB` : `Downloading\u2026 ${mb(done)} MB`;
        if (this.progressEl && this.progressEl.isConnected) this.progressEl.setText(downloading.text);
      });
      settings.voice = voice.key;
      await this.plugin.saveSettings();
      void this.plugin.voiceChanged();
      new import_obsidian.Notice(`Read Aloud: ${voiceLabel(voice)} is installed and selected.`);
    } catch (err) {
      new import_obsidian.Notice(`Read Aloud: could not download ${voice.key}: ${errorText(err)}`, 1e4);
    }
    this.downloading = null;
    await this.check();
  }
};
function validCalibrePath(value) {
  if (!value.trim() || process.env.FLATPAK_ID) return void 0;
  const found = findCalibre(value);
  if (found && !fs3.existsSync(found.file)) return `There is no ${found.file}.`;
  return void 0;
}
var HelpModal = class extends import_obsidian.Modal {
  constructor(app, plugin) {
    super(app);
    this.component = null;
    this.plugin = plugin;
  }
  onOpen() {
    this.modalEl.addClass("readaloud-help");
    this.contentEl.empty();
    const component = new import_obsidian.Component();
    component.load();
    this.component = component;
    void import_obsidian.MarkdownRenderer.render(this.app, HELP_default, this.contentEl, "", component);
  }
  onClose() {
    this.component?.unload();
    this.component = null;
    this.contentEl.empty();
  }
};
var main_default = ReadAloudPlugin;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_SETTINGS,
  ReadAloudSettingTab
});
