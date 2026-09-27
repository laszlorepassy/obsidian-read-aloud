'use strict';

const { Plugin, PluginSettingTab, Setting, Notice, MarkdownView, FileSystemAdapter } = require('obsidian');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { segment } = require('./segmenter');
const { PiperClient } = require('./piper-client');
const { readingField, showReading, readingRange } = require('./highlight');

const DEFAULT_SETTINGS = {
  calibreDebug: '/opt/calibre/calibre-debug',
  voicesDir: path.join(os.homedir(), '.cache', 'calibre', 'piper-voices'),
  voice: 'hu_HU-anna-medium',
  speed: 1.0,
  maxLength: 300,
  paragraphPause: 0.5,
  follow: true,
};

/** The Piper voices in a folder: the .onnx models that have their .json. */
function listVoices(dir) {
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.onnx') && fs.existsSync(path.join(dir, f + '.json')))
      .map((f) => f.slice(0, -5))
      .sort();
  } catch (e) {
    return [];
  }
}

function voiceLabel(name) {
  const m = /^([a-z]{2}_[A-Z]{2})-(.+)-(x_low|low|medium|high)$/.exec(name);
  return m ? `${m[2]} (${m[1]}, ${m[3]})` : name;
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
      onError: (err, id) => this.onPiperError(err, id),
      isBusy: () => !!this.session,
    });

    this.registerEditorExtension(readingField);

    this.ribbon = this.addRibbonIcon('volume-2', 'Felolvasás / szünet', () => this.toggle());
    this.status = this.addStatusBarItem();
    this.status.addClass('readaloud-status');
    this.status.addEventListener('click', () => this.togglePause());
    this.updateStatus();

    this.addCommand({
      id: 'read-from-cursor',
      name: 'Felolvasás a kurzortól',
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return false;
        if (!checking) this.startInView(view, 'cursor');
        return true;
      },
    });
    this.addCommand({
      id: 'read-note',
      name: 'Jegyzet felolvasása az elejétől',
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return false;
        if (!checking) this.startInView(view, 'start');
        return true;
      },
    });
    this.addCommand({
      id: 'pause-resume',
      name: 'Szünet / folytatás',
      checkCallback: (checking) => {
        if (!this.session) return false;
        if (!checking) this.togglePause();
        return true;
      },
    });
    this.addCommand({
      id: 'stop',
      name: 'Felolvasás leállítása',
      checkCallback: (checking) => {
        if (!this.session) return false;
        if (!checking) this.stop();
        return true;
      },
    });
    this.addCommand({
      id: 'next',
      name: 'Következő bekezdés',
      checkCallback: (checking) => {
        if (!this.session) return false;
        if (!checking) this.skip(1);
        return true;
      },
    });
    this.addCommand({
      id: 'previous',
      name: 'Előző bekezdés',
      checkCallback: (checking) => {
        if (!this.session) return false;
        if (!checking) this.skip(-1);
        return true;
      },
    });

    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, view) => {
      if (!(view instanceof MarkdownView)) return;
      menu.addItem((item) => item
        .setTitle('Felolvasás innen')
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

  voiceModel() {
    const voices = listVoices(this.settings.voicesDir);
    const name = voices.includes(this.settings.voice) ? this.settings.voice : voices[0];
    return name ? path.join(this.settings.voicesDir, name + '.onnx') : null;
  }

  // ------------------------------------------------------------ starting

  toggle() {
    if (this.session) {
      this.togglePause();
      return;
    }
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice('Nyiss meg egy jegyzetet a felolvasáshoz.');
      return;
    }
    this.startInView(view, 'cursor');
  }

  async startInView(view, where) {
    const cm = view.editor && view.editor.cm;
    if (!cm) {
      new Notice('Ezt a nézetet nem tudom felolvasni.');
      return;
    }
    let offset = 0;
    if (where === 'cursor') {
      offset = view.getMode() === 'preview' ? this.previewTopOffset(view, cm) : cm.state.selection.main.head;
    }
    const pieces = segment(cm.state.doc.toString(), { maxLength: this.settings.maxLength });
    let seg = pieces.find((p) => p.to > offset);
    if (!seg && where === 'cursor') seg = pieces[0];
    if (!seg) {
      new Notice('Nincs felolvasható szöveg ebben a jegyzetben.');
      return;
    }

    this.stop();
    const model = this.voiceModel();
    if (!model) {
      new Notice(`Nem találok Piper hangot itt: ${this.settings.voicesDir}`);
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
      await this.piper.start(this.settings.calibreDebug);
    } catch (err) {
      if (this.session === session) this.stop();
      new Notice('A felolvasó nem indult el: ' + err.message, 10000);
      console.error('Read Aloud:', err);
      return;
    }
    if (this.session !== session) return;   // stopped while loading
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
    this.piper.setVoice(this.voiceModel(), this.settings.speed);
    this.piper.speak(track.id, seg.text);
    return track;
  }

  /** Starts reading `seg`, using the synthesized audio if it was prepared. */
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

    // Prepare the following piece while this one is read.
    const following = this.pieceAfter(seg.to);
    if (following) session.next = this.request(following);

    for (const chunk of track.queued) this.schedule(track, chunk);
    track.queued = [];
    this.checkFinished(track);
  }

  /** The first piece starting at or after `offset` in the note as it is now. */
  pieceAfter(offset) {
    const pieces = segment(this.session.cm.state.doc.toString(), { maxLength: this.settings.maxLength });
    return pieces.find((p) => p.from >= offset) || null;
  }

  onAudio(id, samples, rate, last) {
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
    track.pending++;
    track.sources = track.sources || [];
    track.sources.push(source);
    source.onended = () => {
      track.pending--;
      this.checkFinished(track);
    };
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
    const seg = this.pieceAfter(range.to);
    if (!seg) {
      this.stop();
      return;
    }
    this.playhead = this.audio.currentTime + this.settings.paragraphPause / this.settings.speed;
    this.play(seg);
  }

  /** Jumps to the next (+1) or previous (-1) piece. */
  skip(direction) {
    const session = this.session;
    if (!session || !session.current) return;
    const range = readingRange(session.cm) || session.current.seg;
    const pieces = segment(session.cm.state.doc.toString(), { maxLength: this.settings.maxLength });
    let target;
    if (direction > 0) {
      target = pieces.find((p) => p.from >= range.to);
    } else {
      const before = pieces.filter((p) => p.to <= range.from);
      target = before[before.length - 1] || pieces.find((p) => p.to > range.from);
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

  onPiperError(err, id) {
    console.error('Read Aloud:', err);
    const session = this.session;
    if (!session) return;
    if (id !== undefined && !(session.current && session.current.id === id)) {
      if (session.next && session.next.id === id) session.next = null;
      return;
    }
    new Notice('Felolvasási hiba: ' + err.message, 8000);
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
    showReading(session.cm, { from: seg.from, to: seg.to }, this.settings.follow);
    this.highlightPreview(seg, this.settings.follow);
  }

  /**
   * In reading view, the editor's highlight is not visible, so the rendered
   * block holding the piece gets a soft background instead.
   */
  highlightPreview(seg, scroll) {
    this.clearPreviewHighlight();
    const session = this.session;
    if (!session || session.view.getMode() !== 'preview') return;
    try {
      const doc = session.cm.state.doc;
      const range = readingRange(session.cm) || seg;
      const line = doc.lineAt(range.from).number - 1;
      const preview = session.view.previewMode;
      const section = preview.renderer.sections.find((s) => s.lineStart <= line && line <= s.lineEnd);
      if (!section || !section.el) return;
      section.el.addClass('readaloud-current-block');
      this.previewEl = section.el;
      if (!scroll) return;
      if (section.el.isConnected) section.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      else preview.applyScroll(line);
    } catch (e) { /* reading view internals changed; just no highlight there */ }
  }

  clearPreviewHighlight() {
    if (this.previewEl) this.previewEl.removeClass('readaloud-current-block');
    this.previewEl = null;
  }

  updateStatus() {
    const s = this.session;
    this.status.empty();
    this.status.toggleClass('readaloud-active', !!s);
    if (!s) {
      this.status.hide();
      return;
    }
    this.status.show();
    if (s.loading) this.status.setText('Felolvasás indul…');
    else this.status.setText(s.paused ? '⏸ Szünet' : '🔊 Felolvasás');
    this.status.setAttr('aria-label', s.paused ? 'Folytatás' : 'Szünet');
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class ReadAloudSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    const settings = this.plugin.settings;
    containerEl.empty();

    const voices = listVoices(settings.voicesDir);
    new Setting(containerEl)
      .setName('Hang')
      .setDesc(voices.length ? 'A Piper hangja, amellyel a jegyzet felolvasásra kerül.'
        : `Nincs Piper hang a megadott mappában.`)
      .addDropdown((dd) => {
        for (const v of voices) dd.addOption(v, voiceLabel(v));
        dd.setValue(voices.includes(settings.voice) ? settings.voice : (voices[0] || ''));
        dd.onChange(async (value) => {
          settings.voice = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Sebesség')
      .setDesc('1 = a hang saját tempója. Változtatáskor a hang újratöltődik (néhány másodperc).')
      .addSlider((sl) => sl
        .setLimits(0.6, 2, 0.05)
        .setValue(settings.speed)
        .setDynamicTooltip()
        .onChange(async (value) => {
          settings.speed = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Legfeljebb ennyi karakter egyszerre')
      .setDesc('A hosszabb bekezdéseket mondathatáron ekkora darabokra vágja.')
      .addSlider((sl) => sl
        .setLimits(120, 800, 20)
        .setValue(settings.maxLength)
        .setDynamicTooltip()
        .onChange(async (value) => {
          settings.maxLength = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Szünet a bekezdések között (mp)')
      .addSlider((sl) => sl
        .setLimits(0, 2, 0.1)
        .setValue(settings.paragraphPause)
        .setDynamicTooltip()
        .onChange(async (value) => {
          settings.paragraphPause = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Görgetés a felolvasott részhez')
      .setDesc('A kiemelt bekezdés mindig látható marad.')
      .addToggle((t) => t
        .setValue(settings.follow)
        .onChange(async (value) => {
          settings.follow = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl).setName('Speciális').setHeading();

    new Setting(containerEl)
      .setName('calibre-debug elérési útja')
      .setDesc('A Piper a calibre-be épített változata.')
      .addText((t) => t
        .setPlaceholder(DEFAULT_SETTINGS.calibreDebug)
        .setValue(settings.calibreDebug)
        .onChange(async (value) => {
          settings.calibreDebug = value.trim() || DEFAULT_SETTINGS.calibreDebug;
          this.plugin.piper.stop();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Hangok mappája')
      .setDesc('Ahol a Piper .onnx és .onnx.json fájljai vannak.')
      .addText((t) => t
        .setPlaceholder(DEFAULT_SETTINGS.voicesDir)
        .setValue(settings.voicesDir)
        .onChange(async (value) => {
          settings.voicesDir = value.trim() || DEFAULT_SETTINGS.voicesDir;
          await this.plugin.saveSettings();
        }));
  }
}

module.exports = ReadAloudPlugin;
