<h1 align="center">Read Aloud</h1>

<p align="center">
  <strong>Listen to your Obsidian notes, sentence by sentence.</strong><br>
  A natural Piper voice that runs on your own computer, with a soft
  highlight on the sentence being read. For Windows, macOS and Linux.
</p>

<p align="center">
  <img alt="Obsidian 1.4.4+" src="https://img.shields.io/badge/Obsidian-1.4.4%2B-7C3AED?logo=obsidian&logoColor=white">
  <img alt="Windows, macOS, Linux" src="https://img.shields.io/badge/desktop-Windows%20%7C%20macOS%20%7C%20Linux-555">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-green">
  <a href="https://paypal.me/repassyl"><img alt="Buy me a coffee" src="https://img.shields.io/badge/Buy%20me%20a%20coffee-FFDD00?logo=buymeacoffee&logoColor=black"></a>
</p>

---

Read Aloud reads the current note aloud with a
[Piper](https://github.com/rhasspy/piper) voice, sentence by sentence, and
highlights the sentence being read, in the editor and in reading view.
Nothing leaves the computer while reading. The speaking is done by the
Piper built into [calibre](https://calibre-ebook.com) (8.8 or newer), which
installs the same way on every system; voices in 58 languages are
downloaded from the plugin's settings.

**Setting it up, step by step for each system, and using it: see
[HELP.md](HELP.md).** The same guide opens inside Obsidian with the *Help*
command and from the settings page.

## Good to know

Read Aloud needs a few things outside the vault, as Obsidian asks plugins
to disclose:

- **An external program:** calibre (free, open source) must be installed.
  Read Aloud starts calibre's `calibre-debug` in the background to run the
  speech engine, and stops it after 10 idle minutes.
- **Network use:** only when you click *Download* in the settings, to fetch
  the chosen voice from huggingface.co/rhasspy/piper-voices (the address
  comes from calibre's own list). Reading itself works offline; your notes
  are never sent anywhere. No telemetry.
- **Files outside the vault:** voices are read from and downloaded into
  calibre's voices folder (or the folder set in the settings). With
  calibre from Flathub, a small helper script is written into calibre's
  own folder under `~/.var/app`; otherwise it lives in the plugin's
  folder.
- **Desktop only**, as it runs a program; it does not work on phones or
  tablets.

## How it works

- The note is cut into sentences, each knowing its block (paragraph,
  heading, list item, table row); a sentence longer than 300 characters
  (adjustable) is cut at commas. Front matter, code blocks, math,
  comments, embeds and link targets are skipped; Markdown syntax is not
  spoken.
- calibre-debug is found in its usual place on each system
  (`src/calibre.js`), including calibre from Flathub.
- A small speech server (`src/piper_server.py`) runs inside calibre's
  Python and keeps the voice loaded, so only the first start takes a few
  seconds. Reading starts about half a second after a sentence is sent,
  and the next sentence is prepared while the current one is read, so
  there is no gap between them. After
  10 minutes with nothing to read, the server stops and frees its memory.
- The sentence being read gets a light accent-colored background, in the
  editor and (as a CSS custom highlight over the rendered text) in reading
  view too, and is scrolled into view. You can
  keep editing the note while it is read: the highlight and the reading
  position move along with your edits.

## Use

- **Ribbon icon** (speaker): starts reading from the cursor; while
  reading, it pauses and resumes.
- **Right-click in the editor → Read aloud from here.**
- **Commands** (to bind hotkeys to): *Read from the cursor*, *Read note from
  the start*, *Pause / resume*, *Stop reading*, *Next / Previous
  sentence*, *Next / Previous paragraph*, *Help*.
- The **status bar** shows previous sentence, pause/resume, next sentence
  and stop buttons while reading.

In reading view, reading starts at the top of the screen.

Settings: calibre's status, voice (with a sample), voice downloads by
language, speed, maximum piece length, pause between paragraphs, whether
to scroll along, and, optionally, where calibre and the voices are.

## Build and install

```bash
npm install
npm test                          # Obsidian's lint rules (eslint-plugin-obsidianmd), then the tests
npm run lint                      # only the lint
npm run install-plugin            # build, and copy into every vault open in Obsidian
npm run install-plugin -- ~/path/to/vault
```

The server tests run the real calibre when it is installed, and are
skipped otherwise.

`main.js` is committed, so the plugin can be installed on any computer by
copying `main.js`, `manifest.json` and `styles.css` into
`<vault>/.obsidian/plugins/read-aloud/`, without building it.

## Support

If Read Aloud reads you something worth hearing, you can buy me a coffee:

<a href="https://paypal.me/repassyl"><img src="https://img.shields.io/badge/Buy%20me%20a%20coffee-FFDD00?style=for-the-badge&logoColor=black" alt="Buy me a coffee"></a>

Bug reports and pull requests are welcome.

## License

[MIT](LICENSE)
