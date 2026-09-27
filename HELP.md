# Read Aloud – user guide

Read Aloud reads the open note aloud, sentence by sentence, and softly
highlights the sentence being read. The voice is **Piper**, a neural text-to-speech
engine that runs on your own computer: no internet connection is needed
while reading, and your notes never leave your computer.

Read Aloud works on **Windows, macOS and Linux** desktops (not on phones or
tablets). Setting it up takes three steps:

1. Install calibre, which brings Piper with it.
2. Install the plugin in your vault.
3. Download a voice in the plugin's settings.

## Why calibre?

Piper exists for Windows, macOS and Linux as a program of its own too, but
Read Aloud uses the Piper built into **calibre**, the free e-book manager
(calibre-ebook.com). calibre has a one-click installer on every system,
keeps Piper up to date, and knows where to download voices from, in 58
languages. You don't have to use calibre itself for anything; it only has
to be installed. If you already listen to books with calibre's e-book
viewer, Read Aloud uses the same voices.

**calibre 8.8 or newer** is needed (from August 2025); the newest version is
best.

## 1. Install calibre

### Windows

1. Go to calibre-ebook.com/download_windows and download the installer
   (*calibre 64bit*).
2. Run it and click through with the default settings. calibre goes to
   `C:\Program Files\Calibre2`, where Read Aloud finds it by itself.

**Portable calibre** (e.g. on a USB drive or without admin rights) works
too, but Read Aloud cannot find it by itself: enter the full path of its
`calibre-debug.exe` in the settings, under *Advanced → Path of
calibre-debug*, e.g. `D:\Calibre Portable\Calibre\calibre-debug.exe`.

### macOS

1. Go to calibre-ebook.com/download_osx and download the `.dmg` file.
2. Open it and drag **calibre** into **Applications**.
3. Start calibre once from Applications, so macOS lets it run. After that
   you can close it.

Read Aloud finds calibre in `/Applications` (or in `Applications` in your
home folder).

### Linux

Most distributions' own calibre packages are **too old** (Debian 13 and
Ubuntu 24.04, for example, have calibre versions without the built-in
Piper). Check with `calibre --version` in a terminal: if it says 8.8 or
more, you are done. Otherwise use one of these:

**Official installer (recommended).** In a terminal:

```bash
sudo -v && wget -nv -O- https://download.calibre-ebook.com/linux-installer.sh | sudo sh /dev/stdin
```

This puts calibre in `/opt/calibre`, and running it again later updates it.
If it complains about missing libraries, install them first; on
Debian/Ubuntu:

```bash
sudo apt install wget xz-utils xdg-utils libegl1 libopengl0 libxcb-cursor0
```

Without admin rights, calibre can go into your home folder instead:

```bash
wget -nv -O- https://download.calibre-ebook.com/linux-installer.sh | sh /dev/stdin install_dir=~/calibre-bin isolated=y
```

**Flatpak** (from Flathub):

```bash
flatpak install flathub com.calibre_ebook.calibre
```

Read Aloud finds calibre in any of these places by itself.

**If Obsidian itself is a Flatpak:** Obsidian's sandbox cannot start
programs outside it unless you allow it. Allow it once with:

```bash
flatpak override --user --talk-name=org.freedesktop.Flatpak md.obsidian.Obsidian
```

Then restart Obsidian. (The AppImage or `.deb` version of Obsidian needs
none of this.)

## 2. Install the plugin

Read Aloud is not in Obsidian's community plugin list, so it is installed
by hand:

1. In your vault, open the hidden `.obsidian` folder, then `plugins` in it
   (create `plugins` if it is not there). Hidden folders are shown with
   Ctrl+H in most Linux file managers and Cmd+Shift+. in the macOS Finder;
   on Windows, `.obsidian` is visible as it is.
2. In it, create a folder named `read-aloud`.
3. Put these three files from the plugin's GitHub page
   (github.com/laszlorepassy/obsidian-read-aloud) into that folder:
   `main.js`, `manifest.json` and `styles.css`.
4. In Obsidian: **Settings → Community plugins**. If community plugins are
   off, turn them on ("Turn on community plugins"). Click the refresh
   button next to *Installed plugins*, then turn on **Read Aloud**.

To update the plugin later, replace the three files, then turn Read Aloud
off and on again (or restart Obsidian).

## 3. Download a voice

Open **Settings → Read Aloud**.

1. Under **Speech engine**, a ✓ with calibre's version shows that calibre
   was found. If it shows ✗, see Troubleshooting.
2. Under **Download voices**, choose a **language**. Read Aloud offers the
   language of your system first.
3. Choose a **voice to download** and click **Download**. Voices are
   20–120 MB; the progress is shown under the voice.
   - Quality: *medium* is a good balance of sound and speed; *high* sounds
     a bit better but is slower; *low* and *x low* are the smallest.
   - A ✓ after a name means that voice is already installed.
4. The voice just downloaded becomes the one that reads. Click the ▶
   button next to **Voice** to hear it.

You can download as many voices as you like and switch between them under
**Voice**. The voices are stored in calibre's own folder, so calibre's
e-book viewer can use them too, and they need downloading only once per
computer.

## Reading

### Starting

- **Speaker icon** in the left ribbon: starts at the cursor.
- **Right-click** in the text → **Read aloud from here**: starts at the
  sentence you clicked.
- **Command palette** (Ctrl+P, Cmd+P on a Mac):
  - *Read Aloud: Read from the cursor*
  - *Read Aloud: Read note from the start*

In reading view, reading starts at the top of the screen.

The first start takes a few seconds while calibre starts and the voice
loads; meanwhile the status bar shows "Starting…". After that, reading
starts almost immediately, and the next sentence is prepared while the
current one is read, so there are no waits between them.

### Controls while reading

While reading, the controls appear in the status bar at the bottom right:

| Button | What it does |
|---|---|
| ‹ | Back one sentence (or, more than two seconds into a sentence, to its start) |
| ⏸ / ▶ | Pause / resume |
| › | Forward one sentence |
| ⏹ | Stop |

The speaker icon in the ribbon also pauses and resumes.

These are commands too, and you can give them hotkeys under
**Settings → Hotkeys** (search for "Read Aloud"):

- *Pause / resume*
- *Stop reading*
- *Next sentence* / *Previous sentence*
- *Next paragraph* / *Previous paragraph* – skips to the start of the next
  paragraph, or back to the start of the previous one

Tip: Ctrl+Alt+Space for pause/resume, Ctrl+Alt+→ / Ctrl+Alt+← for next and
previous sentence, and Ctrl+Alt+↓ / Ctrl+Alt+↑ for next and previous
paragraph work well.

### What is read, and what is not

Paragraphs, headings, list items, quotes and table rows are read, sentence
by sentence. An unusually long sentence is cut at commas (at 300
characters by default), so reading never slows down.

Left out:

- the properties at the top of the note (front matter),
- code blocks, math and `%% comments %%`,
- embedded images and notes,
- link addresses (the link text is read),
- Markdown syntax (`**`, `#`, `-` and so on).

### Editing while reading

You can keep typing in the note while it is read: the highlight and the
reading position move along with your edits.

In reading view, the sentence is highlighted in the rendered text too. Opening another note in the
same tab stops reading.

## Settings

**Speech engine**

- **calibre with Piper** – whether calibre was found, and which version.
  *Check again* looks again, e.g. after installing or updating calibre.

**Voice**

- **Voice** – the installed voice that reads; ▶ plays a sample sentence.
- **Speed** – 1 is the voice's own pace. Changing it while reading reloads
  the voice, which causes a short pause.

**Download voices** – see step 3.

**Reading**

- **Longest piece spoken at once** – a sentence longer than this many
  characters is cut at commas.
- **Pause between paragraphs** – in seconds; sentences within a paragraph
  follow each other with Piper's own short pause.
- **Scroll along** – keeps the sentence being read on screen.

**Advanced** – both can be left empty:

- **Path of calibre-debug** – for calibre in an unusual place, such as the
  portable version on Windows.
- **Voices folder** – where the voices are kept; empty means calibre's own
  folder, which is shown greyed out in the field. Piper voices from
  anywhere else (an `.onnx` file together with its `.onnx.json`) can be
  copied into this folder too; they then appear under **Voice**.

## Troubleshooting

**"calibre was not found"** – calibre is not installed, or not in its usual
place. Install it as in step 1, then click *Check
again* in the settings. For portable or unusual installs, enter the path of
`calibre-debug` (`calibre-debug.exe` on Windows) under *Advanced*.

**"calibre … has no built-in Piper; Read Aloud needs calibre 8.8 or
newer"** – update calibre. On Linux, a distribution package is usually the
cause: use the official installer or Flatpak instead (see
Linux).

**"No voice is installed yet"** – download one under *Download voices*.

**The download fails** – it needs an internet connection to
huggingface.co. A firewall or proxy may block it. You can also download a
voice by hand from huggingface.co/rhasspy/piper-voices (both the `.onnx`
and the `.onnx.json` file) and copy them into the voices folder.

**"Piper did not start"** or **"Piper stopped"** – the message shows
calibre's own error below. Try *Check again*; if it persists, reinstalling
or updating calibre usually helps. On Linux with Obsidian as a Flatpak, see
the note at the end of Linux.

**No sound** – check that the system volume is not muted and that the right
output device is selected; try the ▶ button next to *Voice*.

**The first paragraph takes long** – only the very first start after
opening Obsidian (or after 10 idle minutes, when Read Aloud frees the
memory it used) needs a few seconds to load the voice.
