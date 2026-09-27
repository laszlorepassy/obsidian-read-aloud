# Read Aloud

An Obsidian plugin that reads the current note aloud with a local
[Piper](https://github.com/rhasspy/piper) voice, one paragraph at a time,
with a soft highlight on the part being read.

Nothing leaves the computer. The Piper built into calibre does the speaking,
with the voices calibre downloaded (here the Hungarian anna, berta and imre),
so there is nothing else to install.

## How it works

- The note is cut into pieces: paragraphs, headings, list items, table
  rows. A paragraph longer than 300 characters (adjustable) is cut
  between sentences. Front matter, code blocks, math, comments, embeds
  and link targets are skipped; Markdown syntax is not spoken.
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

The user guide is in [HELP.md](HELP.md); inside Obsidian it opens with the
*Help* command and from the settings page.

Settings: voice, speed, maximum piece length, pause between paragraphs,
whether to scroll along, and where calibre and the voices are.

## Build and install

```bash
npm install
npm test
npm run install-plugin            # into every vault open in Obsidian
npm run install-plugin -- ~/path/to/vault
```

Then turn on *Read Aloud* under Settings → Community plugins (or reload it
after an update).

Requires calibre in `/opt/calibre` with its Piper voices in
`~/.cache/calibre/piper-voices`; both paths can be changed in the settings.
