'use strict';

const {
  Plugin, PluginSettingTab, Setting, Notice, MarkdownView, FileSystemAdapter, Modal, MarkdownRenderer,
  Component, setIcon, setTooltip,
} = require('obsidian');
const os = require('os');
const path = require('path');
const { segment, speakable: segmentText } = require('./segmenter');
const { matchText, keyLength } = require('./text-match');
const { PiperClient } = require('./piper-client');
const { findCalibre } = require('./calibre');
const voices = require('./voices');
const { readingField, showReading, readingRange } = require('./highlight');
const HELP = require('../HELP.md');

const DEFAULT_SETTINGS = {
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
function userLocales() {
  const list = [...(navigator.languages || []), navigator.language || ''];
  try { list.push(window.localStorage.getItem('language') || ''); } catch (e) { /* no storage */ }
  return list.filter(Boolean);
}

class ReadAloudPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.session = null;
    this.audio = null;
    this.nextTrackId = 1;

    this.piper = new PiperClient({
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
      name: 'Read from cursor',
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return false;
        if (!checking) this.startInView(view, 'cursor');
        return true;
      },
    });
    this.addCommand({
      id: 'read-note',
      name: 'Read note from the start',
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return false;
        if (!checking) this.startInView(view, 'start');
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
    const skipCommand = (id, name, direction, by) => this.addCommand({
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

    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, view) => {
      if (!(view instanceof MarkdownView)) return;
      menu.addItem((item) => item
        .setTitle('Read aloud from here')
        .setIcon('volume-2')
        .onClick(() => this.startInView(view, 'cursor')));
    }));

    // Reading a note that is closed or replaced in its tab makes no sense.
    this.registerEvent(this.app.workspace.on('layout-change', () => this.checkView()));
    this.registerEvent(this.app.workspace.on('file-open', () => this.checkView()));

    this.addSettingTab(new ReadAloudSettingTab(this.app, this));
  }

  onunload() {
    this.stop();
    this.piper.stop();
    if (this.audio) this.audio.close();
  }

  pluginDir() {
    const adapter = this.app.vault.adapter;
    const base = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : '';
    return path.join(base, this.manifest.dir);
  }

  // ------------------------------------------------------------ speech engine

  /**
   * How to run calibre, looked up once: in a Flatpak sandbox every look asks
   * the host. `forgetCalibre` makes the next start look again.
   */
  calibre() {
    if (this.foundCalibre === undefined) this.foundCalibre = findCalibre(this.settings.calibreDebug);
    return this.foundCalibre;
  }

  forgetCalibre() {
    this.foundCalibre = undefined;
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
    const key = voices.chooseVoice(list, this.settings.voice, userLocales());
    return key ? path.join(dir, key + '.onnx') : null;
  }

  /** Reads a sample sentence with a voice, for the settings. */
  async testVoice(voice) {
    this.stop();
    this.stopTest();
    const { dir } = await this.catalog();   // (re)starts the server, and the folder may have changed
    if (!this.audio || this.audio.state === 'closed') this.audio = new AudioContext();
    this.audio.resume();
    const model = path.join(dir, voice.key + '.onnx');
    this.test = { id: this.nextTrackId++, head: 0, sources: [], model };
    this.piper.setVoice(model, this.settings.speed);
    this.piper.speak(this.test.id, voices.sampleText(voice));
  }

  stopTest() {
    if (!this.test) return;
    for (const s of this.test.sources) {
      try { s.stop(); } catch (e) { /* not started */ }
    }
    this.test = null;
    this.piper.cancel();
  }

  openSettings() {
    try {
      this.app.setting.open();
      this.app.setting.openTabById(this.manifest.id);
    } catch (e) { /* internal API changed */ }
  }

  // ------------------------------------------------------------ starting

  toggle() {
    if (this.session) {
      this.togglePause();
      return;
    }
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice('Open a note to read it aloud.');
      return;
    }
    this.startInView(view, 'cursor');
  }

  async startInView(view, where) {
    const cm = view.editor && view.editor.cm;
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
    const session = { view, cm, file: view.file, current: null, next: null, paused: false, loading: true };
    this.session = session;
    this.updateStatus();

    if (!this.audio || this.audio.state === 'closed') this.audio = new AudioContext();
    this.audio.resume();
    this.playhead = 0;

    try {
      session.model = await this.voiceModel();
    } catch (err) {
      if (this.session === session) this.stop();
      new Notice('Read Aloud could not start: ' + err.message
        + '\n\nSee Settings → Read Aloud and the help there.', 15000);
      console.error('Read Aloud:', err);
      return;
    }
    if (this.session !== session) return;   // stopped while loading
    if (!session.model) {
      this.stop();
      new Notice('No voice is installed yet. Download one in Settings → Read Aloud.', 10000);
      this.openSettings();
      return;
    }
    this.play(seg);
  }

  /** In reading view, the note offset of the first section on screen. */
  previewTopOffset(view, cm) {
    try {
      const renderer = view.previewMode.renderer;
      const top = view.previewMode.containerEl.getBoundingClientRect().top;
      for (const s of renderer.sections) {
        if (s.el && s.el.isConnected && s.el.getBoundingClientRect().bottom > top + 10) {
          return cm.state.doc.line(Math.min(s.lineStart + 1, cm.state.doc.lines)).from;
        }
      }
    } catch (e) { /* internal API changed; start from the top */ }
    return 0;
  }

  // ------------------------------------------------------------ pieces

  request(seg) {
    const track = { id: this.nextTrackId++, seg, playing: false, done: false, pending: 0, queued: [] };
    this.piper.setVoice(this.session.model, this.settings.speed);
    this.piper.speak(track.id, seg.text);
    return track;
  }

  /** Starts reading the sentence `seg`, using its audio if it was prepared. */
  play(seg) {
    const session = this.session;
    let track = session.next;
    session.next = null;
    if (!track || track.seg.text !== seg.text) {
      if (track) this.piper.cancel();
      track = this.request(seg);
    }
    track.seg = seg;
    track.playing = true;
    session.current = track;
    this.highlight(seg);
    this.updateStatus();

    // Prepare the following sentence while this one is read.
    const following = this.sentenceAfter(seg.to);
    if (following) session.next = this.request(following);

    for (const chunk of track.queued) this.schedule(track, chunk);
    track.queued = [];
    this.checkFinished(track);
  }

  /**
   * The sentences of the note as it is now. A document state never changes,
   * so they are only worked out again after an edit.
   */
  sentences() {
    const doc = this.session.cm.state.doc;
    const max = this.settings.maxLength;
    const cache = this.sentenceCache;
    if (!cache || cache.doc !== doc || cache.max !== max) {
      this.sentenceCache = { doc, max, sentences: segment(doc.toString(), { maxLength: max }) };
    }
    return this.sentenceCache.sentences;
  }

  /** The first sentence starting at or after `offset` in the note as it is now. */
  sentenceAfter(offset) {
    return this.sentences().find((p) => p.from >= offset) || null;
  }

  onAudio(id, samples, rate, last) {
    if (this.test && this.test.id === id) {
      this.playTest(samples, rate);
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

  schedule(track, { samples, rate }) {
    if (!samples.length) return;
    const ctx = this.audio;
    const buffer = ctx.createBuffer(1, samples.length, rate);
    buffer.copyToChannel(samples, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const at = Math.max(ctx.currentTime + 0.03, this.playhead);
    source.start(at);
    this.playhead = at + buffer.duration;
    if (track.startAt === undefined) track.startAt = at;
    track.pending++;
    track.sources = track.sources || [];
    track.sources.push(source);
    source.onended = () => {
      track.pending--;
      this.checkFinished(track);
    };
  }

  playTest(samples, rate) {
    if (!samples.length) return;
    const ctx = this.audio;
    const buffer = ctx.createBuffer(1, samples.length, rate);
    buffer.copyToChannel(samples, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const at = Math.max(ctx.currentTime + 0.03, this.test.head);
    source.start(at);
    this.test.head = at + buffer.duration;
    this.test.sources.push(source);
  }

  checkFinished(track) {
    const session = this.session;
    if (!session || session.current !== track || !track.done || track.pending > 0) return;
    if (track.finished) return;
    track.finished = true;
    this.advance();
  }

  advance() {
    const session = this.session;
    if (!this.viewAlive()) { this.stop(); return; }
    const range = readingRange(session.cm) || session.current.seg;
    const seg = this.sentenceAfter(range.to);
    if (!seg) {
      this.stop();
      return;
    }
    // Piper pauses after each sentence itself; a new paragraph gets more.
    const newBlock = seg.block.from >= range.block.to;
    this.playhead = this.audio.currentTime + (newBlock ? this.settings.paragraphPause / this.settings.speed : 0);
    this.play(seg);
  }

  /**
   * Jumps to the next (+1) or previous (-1) sentence or paragraph. Going back
   * a sentence more than a couple of seconds into one starts it again, like
   * the back button of a player; pressed right after, it goes one further.
   */
  skip(direction, by = 'sentence') {
    const session = this.session;
    if (!session || !session.current) return;
    const range = readingRange(session.cm) || session.current.seg;
    const sentences = this.sentences();
    let target;
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
      const track = session.current;
      const heard = track.startAt === undefined ? 0 : this.audio.currentTime - track.startAt;
      const before = sentences.filter((p) => p.to <= range.from);
      target = heard > 2 || !before.length
        ? sentences.find((p) => p.to > range.from)
        : before[before.length - 1];
    }
    if (!target) return;
    this.silence();
    this.piper.cancel();
    session.next = null;
    this.playhead = 0;
    if (session.paused) {
      session.paused = false;
      this.audio.resume();
    }
    this.play(target);
  }

  // ------------------------------------------------------------ pause / stop

  togglePause() {
    const session = this.session;
    if (!session || !session.current) return;
    session.paused = !session.paused;
    if (session.paused) this.audio.suspend();
    else this.audio.resume();
    this.updateStatus();
  }

  /** Stops the sounds already handed to the speakers. */
  silence() {
    const session = this.session;
    if (!session) return;
    for (const track of [session.current, session.next]) {
      if (!track) continue;
      track.finished = true;
      for (const s of track.sources || []) {
        s.onended = null;
        try { s.stop(); } catch (e) { /* not started */ }
      }
    }
  }

  stop() {
    const session = this.session;
    if (!session) return;
    this.silence();
    this.session = null;
    this.piper.cancel();
    if (this.audio && session.paused) this.audio.resume();
    try { showReading(session.cm, null, false); } catch (e) { /* editor gone */ }
    this.clearPreviewHighlight();
    this.updateStatus();
  }

  /**
   * An error from the speech server. Reading stops only for what breaks it:
   * the server crashing, the sentence being read failing, or the voice it
   * reads with failing to load. A voice tried in the settings says so.
   */
  onPiperError(err, info = {}) {
    console.error('Read Aloud:', err);
    const test = this.test;
    if (test && ((info.id !== undefined && info.id === test.id)
      || (info.voiceFailed && info.model === test.model) || info.crashed)) {
      this.test = null;
      new Notice('Read Aloud: ' + err.message, 10000);
    }
    const session = this.session;
    if (!session) return;
    let fatal = info.crashed;
    if (info.id !== undefined) {
      if (session.next && session.next.id === info.id) session.next = null;
      fatal = session.current && session.current.id === info.id;
    } else if (info.voiceFailed) {
      fatal = info.model === session.model;
    }
    if (!fatal) return;
    new Notice('Read Aloud error: ' + err.message, 8000);
    this.stop();
  }

  viewAlive() {
    const s = this.session;
    return s && s.cm.dom.isConnected && s.view.file === s.file;
  }

  checkView() {
    if (!this.session) return;
    if (!this.viewAlive()) this.stop();
    else if (this.session.current) this.highlightPreview(this.session.current.seg, false);
  }

  // ------------------------------------------------------------ showing it

  highlight(seg) {
    const session = this.session;
    showReading(session.cm, { from: seg.from, to: seg.to, block: seg.block }, this.settings.follow);
    this.highlightPreview(seg, this.settings.follow);
  }

  /**
   * In reading view, the editor's highlight is not visible, so the sentence
   * is found in the rendered text and marked with a CSS custom highlight,
   * which leaves the rendered page itself untouched.
   */
  highlightPreview(seg, scroll) {
    this.clearPreviewHighlight();
    const session = this.session;
    if (!session || session.view.getMode() !== 'preview') return;
    try {
      const doc = session.cm.state.doc;
      const range = readingRange(session.cm) || seg;
      const first = doc.lineAt(range.block.from).number - 1;
      const last = doc.lineAt(range.to).number - 1;
      const preview = session.view.previewMode;
      const sections = preview.renderer.sections.filter((s) => s.lineEnd >= first && s.lineStart <= last);
      if (!sections.length) return;
      if (scroll && !sections[0].el.isConnected) preview.applyScroll(first);
      // The note may be in a pop-out window, which has its own document and
      // its own highlights.
      const page = sections[0].el.ownerDocument;
      const win = page.defaultView;
      if (!win || !win.CSS || !win.CSS.highlights) return;
      const nodes = [];
      for (const s of sections) {
        const walker = page.createTreeWalker(s.el, win.NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
      }
      const hint = keyLength(segmentText(doc.sliceString(doc.line(sections[0].lineStart + 1).from, range.from)));
      const found = matchText(nodes.map((n) => n.nodeValue), seg.text, hint);
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
    } catch (e) { /* reading view internals changed; just no highlight there */ }
  }

  clearPreviewHighlight() {
    try { if (this.previewWin) this.previewWin.CSS.highlights.delete('readaloud-current'); } catch (e) { /* closed */ }
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
    this.status.addClass('readaloud-status');
    this.statusLabel = this.status.createSpan({ cls: 'readaloud-status-label' });
    const button = (icon, tooltip, onClick) => {
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

  updateStatus() {
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

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    // Version 0.1 saved the Linux paths it assumed; now they are found.
    if (this.settings.calibreDebug === '/opt/calibre/calibre-debug') this.settings.calibreDebug = '';
    if (this.settings.voicesDir === path.join(os.homedir(), '.cache', 'calibre', 'piper-voices')) {
      this.settings.voicesDir = '';
    }
  }

  /** The voice setting changed: read on with it from the next piece. */
  async voiceChanged() {
    if (!this.session || this.session.loading) return;
    try {
      const model = await this.voiceModel();
      if (model && this.session) this.session.model = model;
    } catch (e) { /* keep the voice it had */ }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class ReadAloudSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    // What the speech server told: { status: 'checking' | 'ok' | 'error',
    // info, voices, dir, error }, plus the download section's choices.
    this.engine = null;
    this.downloadLang = null;
    this.downloadKey = null;
    this.downloading = null;    // { key, text }
  }

  /**
   * Asks the speech server about calibre and the voices, then redraws. What
   * was known stays on screen meanwhile, unless `fresh`.
   */
  async check(fresh) {
    if (fresh || !this.engine || this.engine.status !== 'ok') {
      this.engine = { status: 'checking' };
      this.render();
    }
    let engine;
    try {
      const { voices: list, dir } = await this.plugin.catalog();
      engine = { status: 'ok', info: this.plugin.piper.info, voices: list, dir };
    } catch (err) {
      engine = { status: 'error', error: err.message };
    }
    this.engine = engine;
    this.render();
  }

  hide() {
    this.plugin.stopTest();
  }

  /** Starts the speech server anew, e.g. after calibre was installed. */
  restartEngine() {
    this.plugin.stop();
    this.plugin.piper.stop();
    this.plugin.forgetCalibre();
    this.autoCalibre = undefined;
    this.check(true);
  }

  /** Obsidian opens the tab: look again, voices may have come or gone. */
  display() {
    this.check();
  }

  render() {
    const { containerEl } = this;
    const scroll = containerEl.scrollTop;
    containerEl.empty();

    new Setting(containerEl)
      .setName('User guide')
      .setDesc('Installing calibre and voices on Windows, macOS and Linux, and using Read Aloud.')
      .addButton((b) => b
        .setButtonText('Open help')
        .onClick(() => new HelpModal(this.app, this.plugin).open()));

    this.engineSection(containerEl);
    if (this.engine.status === 'ok') {
      this.voiceSection(containerEl);
      this.downloadSection(containerEl);
    }
    this.readingSection(containerEl);
    this.advancedSection(containerEl);
    containerEl.scrollTop = scroll;
  }

  engineSection(containerEl) {
    new Setting(containerEl).setName('Speech engine').setHeading();
    const e = this.engine;
    const setting = new Setting(containerEl).setName('calibre with Piper');
    if (e.status === 'checking') {
      setting.setDesc('Looking for calibre…');
    } else if (e.status === 'ok') {
      const where = this.plugin.calibre();
      setting.setDesc(`✓ calibre ${e.info.calibre} found: ${where ? where.label : ''}`);
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
      .onClick(() => {
        this.restartEngine();
      }));
  }

  voiceSection(containerEl) {
    const settings = this.plugin.settings;
    new Setting(containerEl).setName('Voice').setHeading();
    const installed = this.engine.voices.filter((v) => v.installed).sort(voices.byLanguageThenName);
    const current = voices.chooseVoice(this.engine.voices, settings.voice, userLocales());

    const setting = new Setting(containerEl).setName('Voice');
    if (!installed.length) {
      setting.setDesc('No voice is installed yet. Download one below.');
      return;
    }
    setting
      .setDesc('The voice that reads your notes.')
      .addDropdown((dd) => {
        for (const v of installed) dd.addOption(v.key, voices.voiceLabel(v));
        dd.setValue(current);
        dd.onChange(async (value) => {
          settings.voice = value;
          await this.plugin.saveSettings();
          this.plugin.voiceChanged();
        });
      })
      .addExtraButton((b) => b
        .setIcon('play')
        .setTooltip('Listen to this voice')
        .onClick(() => {
          const key = settings.voice && installed.some((v) => v.key === settings.voice) ? settings.voice : current;
          this.plugin.testVoice(installed.find((v) => v.key === key))
            .catch((err) => new Notice('Read Aloud: ' + err.message));
        }));

    new Setting(containerEl)
      .setName('Speed')
      .setDesc('1 is the voice\'s own pace. Changing it reloads the voice (a few seconds).')
      .addSlider((sl) => sl
        .setLimits(0.6, 2, 0.05)
        .setValue(settings.speed)
        .setDynamicTooltip()
        .onChange(async (value) => {
          settings.speed = value;
          await this.plugin.saveSettings();
        }));
  }

  downloadSection(containerEl) {
    new Setting(containerEl).setName('Download voices').setHeading();
    const all = this.engine.voices.filter((v) => v.lang);
    const langs = voices.languages(all);
    if (!this.downloadLang || !langs.some((l) => l.lang === this.downloadLang)) {
      this.downloadLang = voices.preferredLanguage(all, userLocales());
    }
    const inLang = all.filter((v) => v.lang === this.downloadLang).sort(voices.byLanguageThenName);
    if (!inLang.some((v) => v.key === this.downloadKey)) {
      this.downloadKey = (inLang.find((v) => !v.installed) || inLang[0] || {}).key;
    }

    new Setting(containerEl)
      .setName('Language')
      .setDesc(`${langs.length} languages, from the voices of the Piper project (huggingface.co/rhasspy/piper-voices).`)
      .addDropdown((dd) => {
        for (const l of langs) dd.addOption(l.lang, l.label);
        dd.setValue(this.downloadLang);
        dd.onChange((value) => {
          this.downloadLang = value;
          this.downloadKey = null;
          this.render();
        });
      });

    const chosen = inLang.find((v) => v.key === this.downloadKey);
    const busy = this.downloading;
    const setting = new Setting(containerEl)
      .setName('Voice to download')
      .setDesc(busy ? busy.text : (chosen && chosen.installed ? '✓ Installed.'
        : 'Most voices are 20–120 MB. "medium" is a good balance of quality and speed.'))
      .addDropdown((dd) => {
        for (const v of inLang) dd.addOption(v.key, voices.voiceName(v) + (v.installed ? ' ✓' : ''));
        if (this.downloadKey) dd.setValue(this.downloadKey);
        dd.onChange((value) => {
          this.downloadKey = value;
          this.render();
        });
      });
    if (busy) setting.descEl.addClass('readaloud-download-progress');
    setting.addButton((b) => {
      b.setButtonText(chosen && chosen.installed ? 'Download again' : 'Download')
        .setDisabled(!chosen || !!busy)
        .onClick(() => this.download(chosen));
      if (chosen && !chosen.installed) b.setCta();
    });
  }

  async download(voice) {
    const settings = this.plugin.settings;
    const mb = (n) => (n / 1048576).toFixed(0);
    this.downloading = { key: voice.key, text: 'Starting the download…' };
    this.render();
    try {
      await this.plugin.startPiper();    // it stops after 10 idle minutes
      await this.plugin.piper.download(voice.key, settings.voicesDir, (done, total) => {
        this.downloading.text = total
          ? `Downloading… ${Math.floor((100 * done) / total)}% of ${mb(total)} MB`
          : `Downloading… ${mb(done)} MB`;
        const desc = this.containerEl.querySelector('.readaloud-download-progress');
        if (desc) desc.setText(this.downloading.text);
        else this.render();
      });
      settings.voice = voice.key;   // a voice just downloaded is the one wanted
      await this.plugin.saveSettings();
      this.plugin.voiceChanged();
      new Notice(`Read Aloud: ${voices.voiceLabel(voice)} is installed and selected.`);
    } catch (err) {
      new Notice(`Read Aloud: could not download ${voice.key}: ${err.message}`, 10000);
    }
    this.downloading = null;
    await this.check();
  }

  readingSection(containerEl) {
    const settings = this.plugin.settings;
    new Setting(containerEl).setName('Reading').setHeading();

    new Setting(containerEl)
      .setName('Longest piece spoken at once (characters)')
      .setDesc('Notes are read sentence by sentence; a sentence longer than this is cut at commas.')
      .addSlider((sl) => sl
        .setLimits(120, 800, 20)
        .setValue(settings.maxLength)
        .setDynamicTooltip()
        .onChange(async (value) => {
          settings.maxLength = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Pause between paragraphs (seconds)')
      .addSlider((sl) => sl
        .setLimits(0, 2, 0.1)
        .setValue(settings.paragraphPause)
        .setDynamicTooltip()
        .onChange(async (value) => {
          settings.paragraphPause = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Scroll along')
      .setDesc('Keep the highlighted paragraph in view.')
      .addToggle((t) => t
        .setValue(settings.follow)
        .onChange(async (value) => {
          settings.follow = value;
          await this.plugin.saveSettings();
        }));
  }

  advancedSection(containerEl) {
    const settings = this.plugin.settings;
    new Setting(containerEl).setName('Advanced').setHeading();

    if (this.autoCalibre === undefined) this.autoCalibre = findCalibre('');
    const found = this.autoCalibre;
    new Setting(containerEl)
      .setName('Path of calibre-debug')
      .setDesc('Leave empty to find calibre automatically. Needed only for calibre in an unusual place, '
        + 'such as the portable version on Windows.')
      .addText((t) => t
        .setPlaceholder(found ? found.label : 'calibre not found')
        .setValue(settings.calibreDebug)
        .onChange(async (value) => {
          settings.calibreDebug = value.trim();
          this.plugin.forgetCalibre();
          await this.plugin.saveSettings();
        }))
      .addExtraButton((b) => b
        .setIcon('refresh-cw')
        .setTooltip('Check again')
        .onClick(() => {
          this.restartEngine();
        }));

    new Setting(containerEl)
      .setName('Voices folder')
      .setDesc('Leave empty to share the voices with calibre\'s e-book viewer. Voices from elsewhere '
        + '(an .onnx file with its .onnx.json) can be put in this folder too.')
      .addText((t) => t
        .setPlaceholder((this.engine && this.engine.info && this.engine.info.voicesDir) || 'calibre\'s folder')
        .setValue(settings.voicesDir)
        .onChange(async (value) => {
          settings.voicesDir = value.trim();
          await this.plugin.saveSettings();
        }))
      .addExtraButton((b) => b
        .setIcon('refresh-cw')
        .setTooltip('Look for voices again')
        .onClick(() => this.check(true)));
  }
}

class HelpModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    this.modalEl.addClass('readaloud-help');
    this.contentEl.empty();
    this.component = new Component();
    this.component.load();
    MarkdownRenderer.render(this.app, HELP, this.contentEl, '', this.component);
  }

  onClose() {
    this.component.unload();
    this.contentEl.empty();
  }
}

module.exports = ReadAloudPlugin;
