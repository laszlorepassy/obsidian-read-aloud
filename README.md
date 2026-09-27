# Read Aloud

An Obsidian plugin that reads the current note aloud with a local
[Piper](https://github.com/rhasspy/piper) voice, one paragraph at a time,
with a soft highlight on the part being read. Works on Windows, macOS and
Linux desktops.

Nothing leaves the computer while reading. The speaking is done by the
Piper built into [calibre](https://calibre-ebook.com) (8.8 or newer), which
installs the same way on every system; voices in 58 languages are
downloaded from the plugin's settings.

**Setting it up, step by step for each system, and using it: see
[HELP.md](HELP.md).** The same guide opens inside Obsidian with the *Help*
command and from the settings page.

## How it works

- The note is cut into pieces: paragraphs, headings, list items, table
  rows. A paragraph longer than 300 characters (adjustable) is cut
  between sentences. Front matter, code blocks, math, comments, embeds
  and link targets are skipped; Markdown syntax is not spoken.
- calibre-debug is found in its usual place on each system
  (`src/calibre.js`), including calibre from Flathub.
- A small speech server (`src/piper_server.py`) runs inside calibre's
  Python and keeps the voice loaded, so only the first start takes a few
  seconds. It sends the audio sentence by sentence, so reading starts
  about half a second after a piece is sent. The next piece is prepared
  while the current one is read, so there is no gap between them. After
  10 minutes with nothing to read, the server stops and frees its memory.
- The piece being read gets a light accent-colored background, in the
  editor and in reading view too, and is scrolled into view. You can
  keep editing the note while it is read: the highlight and the reading
  position move along with your edits.

## Use

- **Ribbon icon** (speaker): starts reading from the cursor; while
  reading, it pauses and resumes.
- **Right-click in the editor → Read aloud from here.**
- **Commands** (to bind hotkeys to): *Read from cursor*, *Read note from
  the start*, *Pause / resume*, *Stop reading*, *Next paragraph*,
  *Previous paragraph*, *Help*.
- The **status bar** shows pause/resume and stop buttons while reading.

In reading view, reading starts at the top of the screen.

Settings: calibre's status, voice (with a sample), voice downloads by
language, speed, maximum piece length, pause between paragraphs, whether
to scroll along, and, optionally, where calibre and the voices are.

## Build and install

```bash
npm install
npm test
npm run install-plugin            # into every vault open in Obsidian
npm run install-plugin -- ~/path/to/vault
```

Then turn on *Read Aloud* under Settings → Community plugins (or reload it
after an update).

`main.js` is committed, so the plugin can be installed on any computer by
copying `main.js`, `manifest.json` and `styles.css` into
`<vault>/.obsidian/plugins/read-aloud/`, without building it.
