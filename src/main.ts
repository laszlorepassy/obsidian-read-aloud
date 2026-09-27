import {
  Plugin, PluginSettingTab, Notice, MarkdownView, FileSystemAdapter, Modal, MarkdownRenderer,
  Component, setIcon, setTooltip, getLanguage,
} from 'obsidian';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { segment, speakable as segmentText } from './segmenter.ts';
import { matchText, keyLength } from './text-match.ts';
import { PiperClient } from './piper-client.ts';
import { findCalibre } from './calibre.ts';
import * as voices from './voices.ts';
import { readingField, showReading, readingRange } from './highlight.ts';
import type { App, Setting, SettingDefinitionItem, SettingGroupItem, TFile } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import type { Sentence } from './segmenter.ts';
import type { Voice } from './voices.ts';
import type { Calibre } from './calibre.ts';
import type { ErrorInfo, ServerInfo, Catalog } from './piper-client.ts';
import HELP from '../HELP.md';
import SERVER_SOURCE from './piper_server.py';

interface ReadAloudSettings {
  calibreDebug: string;
  voicesDir: string;
  voice: string;
  speed: number;
  maxLength: number;
  paragraphPause: number;
  follow: boolean;
}

/** A piece of a sentence's audio, as Piper sends it. */
interface Chunk {
  samples: Float32Array;
  rate: number;
}

/** A sentence being synthesized and played. */
interface Track {
  id: number;
  seg: Sentence;
  playing: boolean;
  done: boolean;
  pending: number;
  queued: Chunk[];
  sources: AudioBufferSourceNode[];
  startAt?: number;
  finished?: boolean;
}

/** Reading one note. */
interface Session {
  view: MarkdownView;
  cm: EditorView;
  file: TFile | null;
  current: Track | null;
  next: Track | null;
  paused: boolean;
  loading: boolean;
  model: string | null;
}

/** What the speech server said about calibre and the voices. */
type EngineState =
  | { status: 'checking' }
  | { status: 'error'; error: string }
  | { status: 'ok'; info: ServerInfo; voices: Voice[]; dir: string };

/** A voice's sample playing in the settings. */
interface TestPlayback {
  id: number;
  head: number;
  sources: AudioBufferSourceNode[];
  model: string;
}

/** A block of the reading view, as Obsidian's renderer keeps it (not public API). */
interface PreviewSection {
  lineStart: number;
  lineEnd: number;
  el: HTMLElement;
}

/** The parts of Obsidian used here that are not in its public API. */
interface PreviewInternals {
  renderer: { sections: PreviewSection[] };
}

/** A window with the CSS custom highlight API, which every window of Obsidian has. */
type PageWindow = Window & { CSS: typeof CSS; Highlight: typeof Highlight };

interface SettingInternals {
  setting?: { open(): void; openTabById(id: string): void };
}

/** The message of something thrown. */
function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The CodeMirror view of a Markdown editor (Obsidian's `editor.cm`). */
function editorView(view: MarkdownView): EditorView | null {
  const editor = view.editor as unknown as { cm?: EditorView } | undefined;
  return editor?.cm ?? null;
}

const DEFAULT_SETTINGS: ReadAloudSettings = {
  calibreDebug: '',   // empty: found automatically
  voicesDir: '',      // empty: calibre's own folder of Piper voices
  voice: '',          // empty: an installed voice in the user's language
  speed: 1.0,
  maxLength: 300,
  paragraphPause: 0.5,
  follow: true,
};

/**
 * The user's languages, most preferred first, e.g. ['hu-HU', 'en-US']: the
 * system's, which notes are most likely written in, then Obsidian's own.
 */
function userLocales(): string[] {
  const list = [...(navigator.languages || []), navigator.language || ''];
  list.push(getLanguage());
  return list.filter(Boolean);
}

class ReadAloudPlugin extends Plugin {
  settings: ReadAloudSettings = { ...DEFAULT_SETTINGS };
  session: Session | null = null;
  audio: AudioContext | null = null;
  nextTrackId = 1;
  playhead = 0;
  piper!: PiperClient;
  test: TestPlayback | null = null;
  foundCalibre: Calibre | null | undefined = undefined;
  lastCatalog: Catalog | null = null;
  sentenceCache: { doc: unknown; max: number; sentences: Sentence[] } | null = null;
  previewWin: PageWindow | null = null;
  status!: HTMLElement;
  statusLabel!: HTMLElement;
  pauseButton!: HTMLElement;
  ribbon!: HTMLElement;

  async onload() {
    await this.loadSettings();
    this.session = null;
    this.audio = null;
    this.nextTrackId = 1;

    this.piper = new PiperClient({
      serverSource: SERVER_SOURCE,
      scriptDir: this.pluginDir(),
      onAudio: (id, samples, rate, last) => this.onAudio(id, samples, rate, last),
      onError: (err, info) => this.onPiperError(err, info),
      isBusy: () => !!this.session,
    });

    this.registerEditorExtension(readingField);

    this.ribbon = this.addRibbonIcon('volume-2', 'Read aloud / pause', () => this.toggle());
    this.buildStatus();
    this.updateStatus();

    this.addCommand({
      id: 'read-from-cursor',
      name: 'Read from the cursor',
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return false;
        if (!checking) void this.startInView(view, 'cursor');
        return true;
      },
    });
    this.addCommand({
      id: 'read-note',
      name: 'Read note from the start',
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return false;
        if (!checking) void this.startInView(view, 'start');
        return true;
      },
    });
    this.addCommand({
      id: 'pause-resume',
      name: 'Pause / resume',
      checkCallback: (checking) => {
        if (!this.session) return false;
        if (!checking) this.togglePause();
        return true;
      },
    });
    this.addCommand({
      id: 'stop',
      name: 'Stop reading',
      checkCallback: (checking) => {
        if (!this.session) return false;
        if (!checking) this.stop();
        return true;
      },
    });
    const skipCommand = (id: string, name: string, direction: 1 | -1, by: 'sentence' | 'paragraph') => this.addCommand({
      id,
      name,
      checkCallback: (checking) => {
        if (!this.session) return false;
        if (!checking) this.skip(direction, by);
        return true;
      },
    });
    skipCommand('next-sentence', 'Next sentence', 1, 'sentence');
    skipCommand('previous-sentence', 'Previous sentence', -1, 'sentence');
    skipCommand('next', 'Next paragraph', 1, 'paragraph');
    skipCommand('previous', 'Previous paragraph', -1, 'paragraph');

    this.addCommand({
      id: 'help',
      name: 'Help',
      callback: () => new HelpModal(this.app, this).open(),
    });

    this.registerEvent(this.app.workspace.on('editor-menu', (menu, _editor, info) => {
      if (!(info instanceof MarkdownView)) return;
      menu.addItem((item) => item
        .setTitle('Read aloud from here')
        .setIcon('volume-2')
        .onClick(() => { void this.startInView(info, 'cursor'); }));
    }));

    // Reading a note that is closed or replaced in its tab makes no sense.
    this.registerEvent(this.app.workspace.on('layout-change', () => this.checkView()));
    this.registerEvent(this.app.workspace.on('file-open', () => this.checkView()));

    this.addSettingTab(new ReadAloudSettingTab(this.app, this));
  }

  onunload(): void {
    this.stop();
    this.piper.stop();
    if (this.audio) void this.audio.close();
  }

  pluginDir(): string {
    const adapter = this.app.vault.adapter;
    const base = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : '';
    return path.join(base, this.manifest.dir ?? '');
  }

  /** The audio output, made on first use (and again if it was closed). */
  audioContext(): AudioContext {
    if (!this.audio || this.audio.state === 'closed') this.audio = new AudioContext();
    return this.audio;
  }

  // ------------------------------------------------------------ speech engine

  /**
   * How to run calibre, looked up once: in a Flatpak sandbox every look asks
   * the host. `forgetCalibre` makes the next start look again.
   */
  calibre(): Calibre | null {
    if (this.foundCalibre === undefined) this.foundCalibre = findCalibre(this.settings.calibreDebug);
    return this.foundCalibre;
  }

  forgetCalibre(): void {
    this.foundCalibre = undefined;
  }

  /** Starts the speech server if needed; resolves with its "ready" message. */
  startPiper(): Promise<ServerInfo> {
    return this.piper.ready || this.piper.start(this.calibre());
  }

  /** The voices calibre knows, marked installed or not; starts the server. */
  async catalog(): Promise<Catalog> {
    await this.startPiper();
    this.lastCatalog = await this.piper.catalog(this.settings.voicesDir);
    return this.lastCatalog;
  }

  /** The .onnx file of the voice to read with, or null if none is installed. */
  async voiceModel(): Promise<string | null> {
    const { voices: list, dir } = await this.catalog();
    const key = voices.chooseVoice(list, this.settings.voice, userLocales());
    return key ? path.join(dir, key + '.onnx') : null;
  }

  /** Reads a sample sentence with a voice, for the settings. */
  async testVoice(voice: Voice): Promise<void> {
    this.stop();
    this.stopTest();
    const { dir } = await this.catalog();   // (re)starts the server, and the folder may have changed
    void this.audioContext().resume();
    const model = path.join(dir, voice.key + '.onnx');
    this.test = { id: this.nextTrackId++, head: 0, sources: [], model };
    this.piper.setVoice(model, this.settings.speed);
    this.piper.speak(this.test.id, voices.sampleText(voice));
  }

  stopTest(): void {
    if (!this.test) return;
    for (const s of this.test.sources) {
      try { s.stop(); } catch { /* not started */ }
    }
    this.test = null;
    this.piper.cancel();
  }

  openSettings(): void {
    try {
      const setting = (this.app as unknown as SettingInternals).setting;
      setting?.open();
      setting?.openTabById(this.manifest.id);
    } catch { /* internal API changed */ }
  }

  // ------------------------------------------------------------ starting

  toggle(): void {
    if (this.session) {
      this.togglePause();
      return;
    }
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice('Open a note to read it aloud.');
      return;
    }
    void this.startInView(view, 'cursor');
  }

  async startInView(view: MarkdownView, where: 'cursor' | 'start'): Promise<void> {
    const cm = editorView(view);
    if (!cm) {
      new Notice('This view cannot be read aloud.');
      return;
    }
    let offset = 0;
    if (where === 'cursor') {
      offset = view.getMode() === 'preview' ? this.previewTopOffset(view, cm) : cm.state.selection.main.head;
    }
    this.stop();
    this.stopTest();
    const sentences = segment(cm.state.doc.toString(), { maxLength: this.settings.maxLength });
    let seg = sentences.find((p) => p.to > offset);
    if (!seg && where === 'cursor') seg = sentences[0];
    if (!seg) {
      new Notice('There is nothing to read in this note.');
      return;
    }

    // `loading` lasts until the first sound: starting calibre and loading the
    // voice takes a few seconds the first time.
    const session: Session = {
      view, cm, file: view.file, current: null, next: null, paused: false, loading: true, model: null,
    };
    this.session = session;
    this.updateStatus();

    void this.audioContext().resume();
    this.playhead = 0;

    try {
      session.model = await this.voiceModel();
    } catch (err) {
      if (this.session === session) this.stop();
      new Notice('Read Aloud could not start: ' + errorText(err)
        + '\n\nSee Settings → Read Aloud and the help there.', 15000);
      console.error('Read Aloud:', err);
      return;
    }
    if (this.session !== session) return;   // stopped while loading
    if (!session.model) {
      this.stop();
      new Notice('No voice is installed yet. Download one in the settings, which open now.', 10000);
      this.openSettings();
      return;
    }
    this.play(session, seg);
  }

  /** In reading view, the note offset of the first section on screen. */
  previewTopOffset(view: MarkdownView, cm: EditorView): number {
    try {
      const { renderer } = view.previewMode as unknown as PreviewInternals;
      const top = view.previewMode.containerEl.getBoundingClientRect().top;
      for (const s of renderer.sections) {
        if (s.el.isConnected && s.el.getBoundingClientRect().bottom > top + 10) {
          return cm.state.doc.line(Math.min(s.lineStart + 1, cm.state.doc.lines)).from;
        }
      }
    } catch { /* internal API changed; start from the top */ }
    return 0;
  }

  // ------------------------------------------------------------ sentences

  request(session: Session, seg: Sentence): Track {
    const track: Track = {
      id: this.nextTrackId++, seg, playing: false, done: false, pending: 0, queued: [], sources: [],
    };
    if (session.model) this.piper.setVoice(session.model, this.settings.speed);
    this.piper.speak(track.id, seg.text);
    return track;
  }

  /** Starts reading the sentence `seg`, using its audio if it was prepared. */
  play(session: Session, seg: Sentence): void {
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

    // Prepare the following sentence while this one is read.
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
  sentences(session: Session): Sentence[] {
    const doc = session.cm.state.doc;
    const max = this.settings.maxLength;
    const cache = this.sentenceCache;
    if (cache && cache.doc === doc && cache.max === max) return cache.sentences;
    const sentences = segment(doc.toString(), { maxLength: max });
    this.sentenceCache = { doc, max, sentences };
    return sentences;
  }

  /** The first sentence starting at or after `offset` in the note as it is now. */
  sentenceAfter(session: Session, offset: number): Sentence | null {
    return this.sentences(session).find((p) => p.from >= offset) ?? null;
  }

  onAudio(id: number, samples: Float32Array, rate: number, last: boolean): void {
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
  playChunk({ samples, rate }: Chunk, at: number): AudioBufferSourceNode {
    const ctx = this.audioContext();
    const buffer = ctx.createBuffer(1, samples.length, rate);
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(Math.max(ctx.currentTime + 0.03, at));
    return source;
  }

  schedule(track: Track, chunk: Chunk): void {
    if (!chunk.samples.length) return;
    const at = Math.max(this.audioContext().currentTime + 0.03, this.playhead);
    const source = this.playChunk(chunk, at);
    this.playhead = at + chunk.samples.length / chunk.rate;
    if (track.startAt === undefined) track.startAt = at;
    track.pending++;
    track.sources.push(source);
    source.onended = () => {
      track.pending--;
      this.checkFinished(track);
    };
  }

  playTest(test: TestPlayback, samples: Float32Array, rate: number): void {
    if (!samples.length) return;
    const at = Math.max(this.audioContext().currentTime + 0.03, test.head);
    test.sources.push(this.playChunk({ samples, rate }, at));
    test.head = at + samples.length / rate;
  }

  checkFinished(track: Track): void {
    const session = this.session;
    if (!session || session.current !== track || !track.done || track.pending > 0) return;
    if (track.finished) return;
    track.finished = true;
    this.advance(session, track);
  }

  advance(session: Session, track: Track): void {
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
    // Piper pauses after each sentence itself; a new paragraph gets more.
    const newBlock = seg.block.from >= range.block.to;
    this.playhead = this.audioContext().currentTime
      + (newBlock ? this.settings.paragraphPause / this.settings.speed : 0);
    this.play(session, seg);
  }

  /**
   * Jumps to the next (+1) or previous (-1) sentence or paragraph. Going back
   * a sentence more than a couple of seconds into one starts it again, like
   * the back button of a player; pressed right after, it goes one further.
   */
  skip(direction: 1 | -1, by: 'sentence' | 'paragraph' = 'sentence'): void {
    const session = this.session;
    const track = session?.current;
    if (!session || !track) return;
    const range = readingRange(session.cm) ?? track.seg;
    const sentences = this.sentences(session);
    let target: Sentence | undefined;
    if (by === 'paragraph') {
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
      const heard = track.startAt === undefined ? 0 : this.audioContext().currentTime - track.startAt;
      const before = sentences.filter((p) => p.to <= range.from);
      target = heard > 2 || !before.length
        ? sentences.find((p) => p.to > range.from)
        : before[before.length - 1];
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

  togglePause(): void {
    const session = this.session;
    if (!session || !session.current) return;
    session.paused = !session.paused;
    if (session.paused) void this.audioContext().suspend();
    else void this.audioContext().resume();
    this.updateStatus();
  }

  /** Stops the sounds already handed to the speakers. */
  silence(session: Session): void {
    for (const track of [session.current, session.next]) {
      if (!track) continue;
      track.finished = true;
      for (const s of track.sources) {
        s.onended = null;
        try { s.stop(); } catch { /* not started */ }
      }
    }
  }

  stop(): void {
    const session = this.session;
    if (!session) return;
    this.silence(session);
    this.session = null;
    this.piper.cancel();
    if (this.audio && session.paused) void this.audio.resume();
    try { showReading(session.cm, null, false); } catch { /* editor gone */ }
    this.clearPreviewHighlight();
    this.updateStatus();
  }

  /**
   * An error from the speech server. Reading stops only for what breaks it:
   * the server crashing, the sentence being read failing, or the voice it
   * reads with failing to load. A voice tried in the settings says so.
   */
  onPiperError(err: Error, info: ErrorInfo = {}): void {
    console.error('Read Aloud:', err);
    const test = this.test;
    if (test && ((info.id !== undefined && info.id === test.id)
      || (info.voiceFailed && info.model === test.model) || info.crashed)) {
      this.test = null;
      new Notice('Read Aloud: ' + err.message, 10000);
    }
    const session = this.session;
    if (!session) return;
    let fatal = info.crashed === true;
    if (info.id !== undefined) {
      if (session.next && session.next.id === info.id) session.next = null;
      fatal = session.current !== null && session.current.id === info.id;
    } else if (info.voiceFailed) {
      fatal = info.model === session.model;
    }
    if (!fatal) return;
    new Notice('Read Aloud error: ' + err.message, 8000);
    this.stop();
  }

  viewAlive(): boolean {
    const s = this.session;
    return !!s && s.cm.dom.isConnected && s.view.file === s.file;
  }

  checkView(): void {
    const session = this.session;
    if (!session) return;
    if (!this.viewAlive()) this.stop();
    else if (session.current) this.highlightPreview(session, session.current.seg, false);
  }

  // ------------------------------------------------------------ showing it

  highlight(session: Session, seg: Sentence): void {
    showReading(session.cm, { from: seg.from, to: seg.to, block: seg.block }, this.settings.follow);
    this.highlightPreview(session, seg, this.settings.follow);
  }

  /**
   * In reading view, the editor's highlight is not visible, so the sentence
   * is found in the rendered text and marked with a CSS custom highlight,
   * which leaves the rendered page itself untouched.
   */
  highlightPreview(session: Session, seg: Sentence, scroll: boolean): void {
    this.clearPreviewHighlight();
    if (session.view.getMode() !== 'preview') return;
    try {
      const doc = session.cm.state.doc;
      const range = readingRange(session.cm) ?? seg;
      const first = doc.lineAt(range.block.from).number - 1;
      const last = doc.lineAt(range.to).number - 1;
      const preview = session.view.previewMode;
      const { renderer } = preview as unknown as PreviewInternals;
      const sections = renderer.sections.filter((s) => s.lineEnd >= first && s.lineStart <= last);
      if (!sections.length) return;
      if (scroll && !sections[0].el.isConnected) preview.applyScroll(first);
      // The note may be in a pop-out window, which has its own document and
      // its own highlights.
      const page = sections[0].el.ownerDocument;
      const win = page.defaultView as PageWindow | null;
      if (!win || !('highlights' in win.CSS)) return;
      const nodes: Text[] = [];
      for (const s of sections) {
        const walker = page.createTreeWalker(s.el, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
      }
      const hint = keyLength(segmentText(doc.sliceString(doc.line(sections[0].lineStart + 1).from, range.from)));
      const found = matchText(nodes.map((n) => n.data), seg.text, hint);
      if (!found) return;
      const marked = page.createRange();
      marked.setStart(nodes[found.start[0]], found.start[1]);
      marked.setEnd(nodes[found.end[0]], found.end[1]);
      win.CSS.highlights.set('readaloud-current', new win.Highlight(marked));
      this.previewWin = win;
      if (scroll) {
        const el = marked.startContainer.parentElement;
        if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    } catch { /* reading view internals changed; just no highlight there */ }
  }

  clearPreviewHighlight(): void {
    try { this.previewWin?.CSS.highlights.delete('readaloud-current'); } catch { /* closed */ }
    this.previewWin = null;
  }

  /**
   * The controls in the status bar: a label, then previous sentence, pause,
   * next sentence and stop buttons. They are built once and only updated,
   * each button with its own tooltip, so a tooltip always points at the
   * button under the mouse.
   */
  buildStatus(): void {
    this.status = this.addStatusBarItem();
    this.status.addClass('readaloud-status');
    this.statusLabel = this.status.createSpan({ cls: 'readaloud-status-label' });
    const button = (icon: string | null, tooltip: string | null, onClick: () => void): HTMLElement => {
      const el = this.status.createDiv({ cls: 'readaloud-status-button clickable-icon' });
      el.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
      if (icon) setIcon(el, icon);
      if (tooltip) setTooltip(el, tooltip, { placement: 'top' });
      return el;
    };
    button('chevron-left', 'Previous sentence', () => this.skip(-1, 'sentence'));
    this.pauseButton = button(null, null, () => this.togglePause());
    button('chevron-right', 'Next sentence', () => this.skip(1, 'sentence'));
    button('square', 'Stop', () => this.stop());
  }

  updateStatus(): void {
    const s = this.session;
    if (!s) {
      this.status.hide();
      return;
    }
    this.status.show();
    this.statusLabel.setText(s.loading ? 'Starting…' : (s.paused ? 'Paused' : 'Reading'));
    const icon = s.paused ? 'play' : 'pause';
    if (this.pauseButton.dataset.icon !== icon) {
      this.pauseButton.dataset.icon = icon;
      setIcon(this.pauseButton, icon);
      setTooltip(this.pauseButton, s.paused ? 'Resume' : 'Pause', { placement: 'top' });
    }
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<ReadAloudSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...saved };
    // Version 0.1 saved the Linux paths it assumed; now they are found.
    if (this.settings.calibreDebug === '/opt/calibre/calibre-debug') this.settings.calibreDebug = '';
    if (this.settings.voicesDir === path.join(os.homedir(), '.cache', 'calibre', 'piper-voices')) {
      this.settings.voicesDir = '';
    }
  }

  /** The voice setting changed: read on with it from the next piece. */
  async voiceChanged(): Promise<void> {
    if (!this.session || this.session.loading) return;
    try {
      const model = await this.voiceModel();
      if (model && this.session) this.session.model = model;
    } catch { /* keep the voice it had */ }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

/**
 * The settings, declared for Obsidian 1.13's settings API, so they show up
 * in the settings search too. What depends on calibre (its status, the
 * installed voices, the voices to download) comes from the speech server,
 * which is asked each time the tab is shown; `update()` redraws the tab
 * with the answer.
 */
class ReadAloudSettingTab extends PluginSettingTab {
  plugin: ReadAloudPlugin;
  // What the speech server told, plus the download section's choices.
  engine: EngineState = { status: 'checking' };
  needsCheck = true;     // look again when the tab is next shown
  downloadLang: string | null = null;
  downloadKey: string | null = null;
  downloading: { key: string; text: string } | null = null;
  progressEl: HTMLElement | null = null;

  constructor(app: App, plugin: ReadAloudPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * Asks the speech server about calibre and the voices, then redraws. What
   * was known stays on screen meanwhile, unless `fresh`.
   */
  async check(fresh = false): Promise<void> {
    if (fresh || this.engine.status !== 'ok') {
      this.engine = { status: 'checking' };
      this.update();
    }
    let engine: EngineState;
    try {
      const { voices: list, dir } = await this.plugin.catalog();
      const info = this.plugin.piper.info ?? { calibre: '', voicesDir: dir };
      engine = { status: 'ok', info, voices: list, dir };
    } catch (err) {
      engine = { status: 'error', error: errorText(err) };
    }
    this.engine = engine;
    this.update();
  }

  hide(): void {
    this.plugin.stopTest();
    this.needsCheck = true;
    super.hide();
  }

  /** Starts the speech server anew, e.g. after calibre was installed. */
  restartEngine(): void {
    this.plugin.stop();
    this.plugin.piper.stop();
    this.plugin.forgetCalibre();
    void this.check(true);
  }

  getControlValue(key: string): unknown {
    if (key === 'voice' && this.engine.status === 'ok') {
      return voices.chooseVoice(this.engine.voices, this.plugin.settings.voice, userLocales()) ?? '';
    }
    return super.getControlValue(key);
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const settings = this.plugin.settings as unknown as Record<string, unknown>;
    settings[key] = typeof value === 'string' ? value.trim() : value;
    await this.plugin.saveSettings();
    if (key === 'voice') void this.plugin.voiceChanged();
    if (key === 'calibreDebug') this.plugin.forgetCalibre();
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: 'User guide',
        desc: 'Setting up calibre and voices on Windows, macOS and Linux, and how to use the plugin.',
        aliases: ['help', 'install'],
        render: (setting) => {
          setting.addButton((b) => b
            .setButtonText('Open help')
            .onClick(() => new HelpModal(this.app, this.plugin).open()));
        },
      },
      {
        type: 'group',
        heading: 'Speech engine',
        items: [{
          name: 'calibre with Piper',
          desc: 'Read Aloud speaks with the Piper built into calibre 8.8 or newer.',
          aliases: ['calibre', 'engine', 'status'],
          render: (setting) => this.renderEngine(setting),
        }],
      },
      {
        type: 'group',
        heading: 'Voice',
        items: this.voiceItems(),
      },
      {
        type: 'group',
        heading: 'Download voices',
        items: this.engine.status !== 'ok' ? [this.waitingItem('Voice to download')] : [
          {
            name: 'Language',
            desc: 'Voices in 58 languages, from the Piper project (huggingface.co/rhasspy/piper-voices).',
            aliases: ['download', 'voices'],
            render: (setting) => this.renderLanguage(setting),
          },
          {
            name: 'Voice to download',
            desc: 'Most voices are 20–120 MB. "medium" is a good balance of quality and speed.',
            aliases: ['download'],
            render: (setting) => this.renderDownload(setting),
          },
        ],
      },
      {
        type: 'group',
        heading: 'Reading',
        items: [
          {
            name: 'Longest piece spoken at once (characters)',
            desc: 'Notes are read sentence by sentence; a sentence longer than this is cut at commas.',
            control: { type: 'slider', key: 'maxLength', min: 120, max: 800, step: 20, defaultValue: 300 },
          },
          {
            name: 'Pause between paragraphs (seconds)',
            control: {
              type: 'slider', key: 'paragraphPause', min: 0, max: 2, step: 0.1, defaultValue: 0.5,
              displayFormat: (v) => `${v.toFixed(1)} s`,
            },
          },
          {
            name: 'Scroll along',
            desc: 'Keep the sentence being read in view.',
            control: { type: 'toggle', key: 'follow', defaultValue: true },
          },
        ],
      },
      {
        type: 'group',
        heading: 'Advanced',
        items: [
          {
            name: 'Path of calibre-debug',
            desc: 'Leave empty to find calibre automatically. Needed only for calibre in an unusual place, '
              + 'such as the portable version on Windows. A folder (Calibre2, calibre.app) is fine too.',
            control: {
              type: 'text', key: 'calibreDebug', placeholder: 'Found automatically',
              validate: (value) => validCalibrePath(value),
            },
          },
          {
            name: 'Voices folder',
            desc: 'Leave empty to share the voices with calibre\'s e-book viewer. Voices from elsewhere '
              + '(an .onnx file with its .onnx.json) can be put in this folder too. Click "Check again" '
              + 'above after changing it.',
            control: { type: 'text', key: 'voicesDir', placeholder: 'calibre\'s voices folder' },
          },
        ],
      },
    ];
  }

  renderEngine(setting: Setting): void {
    // Rendered only while the tab is shown: the moment to look again.
    if (this.needsCheck) {
      this.needsCheck = false;
      window.setTimeout(() => { void this.check(); }, 0);
    }
    const e = this.engine;
    if (e.status === 'checking') {
      setting.setDesc('Looking for calibre…');
    } else if (e.status === 'ok') {
      const where = this.plugin.calibre();
      setting.setDesc(createFragment((f) => {
        f.appendText(`✓ calibre ${e.info.calibre} found: ${where ? where.label : ''}`);
        f.createEl('br');
        f.appendText(`Voices folder: ${e.dir}`);
      }));
    } else {
      setting.setDesc(createFragment((f) => {
        f.createSpan({ cls: 'readaloud-error', text: `✗ ${e.error}` });
        f.createEl('br');
        f.appendText('Install calibre 8.8 or newer from ');
        f.createEl('a', { text: 'calibre-ebook.com', href: 'https://calibre-ebook.com/download' });
        f.appendText(', then click Check again. The help tells how, for each system.');
      }));
    }
    setting.addButton((b) => b
      .setButtonText('Check again')
      .setDisabled(e.status === 'checking')
      .onClick(() => this.restartEngine()));
  }

  /** A row standing in for what needs calibre, until it is found. */
  waitingItem(name: string): SettingGroupItem {
    return {
      name,
      desc: this.engine.status === 'checking' ? 'Looking for calibre…' : 'Available once calibre is found.',
      aliases: ['voice', 'download'],
    };
  }

  voiceItems(): SettingGroupItem[] {
    const speed: SettingGroupItem = {
      name: 'Speed',
      desc: 'At 1, the voice keeps its own pace. Changing the speed reloads the voice (a few seconds).',
      control: {
        type: 'slider', key: 'speed', min: 0.6, max: 2, step: 0.05, defaultValue: 1,
        displayFormat: (v: number) => `${v.toFixed(2)}×`,
      },
    };
    if (this.engine.status !== 'ok') return [this.waitingItem('Voice'), speed];
    const installed = this.engine.voices.filter((v) => v.installed).sort(voices.byLanguageThenName);
    if (!installed.length) {
      return [{ name: 'Voice', desc: 'No voice is installed yet. Download one below.' }, speed];
    }
    const options: Record<string, string> = {};
    for (const v of installed) options[v.key] = voices.voiceLabel(v);
    return [
      {
        name: 'Voice',
        desc: 'The voice that reads your notes.',
        control: { type: 'dropdown', key: 'voice', options },
      },
      {
        name: 'Listen to this voice',
        desc: 'Reads a sample sentence with the voice chosen above.',
        aliases: ['test', 'sample', 'try'],
        action: () => {
          const key = this.getControlValue('voice');
          const voice = installed.find((v) => v.key === key);
          if (voice) this.plugin.testVoice(voice).catch((err: unknown) => new Notice('Read Aloud: ' + errorText(err)));
        },
      },
      speed,
    ];
  }

  /** The voices of the language chosen for download, and that language. */
  downloadChoices(): { langs: { lang: string; label: string }[]; inLang: Voice[] } {
    const all = this.engine.status === 'ok' ? this.engine.voices.filter((v) => v.lang) : [];
    const langs = voices.languages(all);
    if (!this.downloadLang || !langs.some((l) => l.lang === this.downloadLang)) {
      this.downloadLang = voices.preferredLanguage(all, userLocales());
    }
    const inLang = all.filter((v) => v.lang === this.downloadLang).sort(voices.byLanguageThenName);
    if (!inLang.some((v) => v.key === this.downloadKey)) {
      this.downloadKey = (inLang.find((v) => !v.installed) ?? inLang[0])?.key ?? null;
    }
    return { langs, inLang };
  }

  renderLanguage(setting: Setting): void {
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

  renderDownload(setting: Setting): void {
    const { inLang } = this.downloadChoices();
    const chosen = inLang.find((v) => v.key === this.downloadKey);
    const busy = this.downloading;
    if (busy) setting.setDesc(busy.text);
    else if (chosen && chosen.installed) setting.setDesc('This voice is installed.');
    this.progressEl = busy ? setting.descEl : null;
    setting.addDropdown((dd) => {
      for (const v of inLang) dd.addOption(v.key, voices.voiceName(v) + (v.installed ? ' ✓' : ''));
      if (this.downloadKey) dd.setValue(this.downloadKey);
      dd.onChange((value) => {
        this.downloadKey = value;
        this.update();
      });
    });
    setting.addButton((b) => {
      b.setButtonText(chosen && chosen.installed ? 'Download again' : 'Download')
        .setDisabled(!chosen || !!busy)
        .onClick(() => { if (chosen) void this.download(chosen); });
      if (chosen && !chosen.installed) b.setCta();
    });
  }

  async download(voice: Voice): Promise<void> {
    const settings = this.plugin.settings;
    const mb = (n: number) => (n / 1048576).toFixed(0);
    const downloading = { key: voice.key, text: 'Starting the download…' };
    this.downloading = downloading;
    this.update();
    try {
      await this.plugin.startPiper();    // it stops after 10 idle minutes
      await this.plugin.piper.download(voice.key, settings.voicesDir, (done, total) => {
        downloading.text = total
          ? `Downloading… ${Math.floor((100 * done) / total)}% of ${mb(total)} MB`
          : `Downloading… ${mb(done)} MB`;
        if (this.progressEl && this.progressEl.isConnected) this.progressEl.setText(downloading.text);
      });
      settings.voice = voice.key;   // a voice just downloaded is the one wanted
      await this.plugin.saveSettings();
      void this.plugin.voiceChanged();
      new Notice(`Read Aloud: ${voices.voiceLabel(voice)} is installed and selected.`);
    } catch (err) {
      new Notice(`Read Aloud: could not download ${voice.key}: ${errorText(err)}`, 10000);
    }
    this.downloading = null;
    await this.check();
  }
}

/** For the calibre-debug setting: an error message, or nothing if it is fine. */
function validCalibrePath(value: string): string | undefined {
  if (!value.trim() || process.env.FLATPAK_ID) return undefined;
  const found = findCalibre(value);
  if (found && !fs.existsSync(found.file)) return `There is no ${found.file}.`;
  return undefined;
}

class HelpModal extends Modal {
  plugin: ReadAloudPlugin;
  component: Component | null = null;

  constructor(app: App, plugin: ReadAloudPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    this.modalEl.addClass('readaloud-help');
    this.contentEl.empty();
    const component = new Component();
    component.load();
    this.component = component;
    void MarkdownRenderer.render(this.app, HELP, this.contentEl, '', component);
  }

  onClose(): void {
    this.component?.unload();
    this.component = null;
    this.contentEl.empty();
  }
}

export default ReadAloudPlugin;
export { ReadAloudSettingTab, DEFAULT_SETTINGS };
