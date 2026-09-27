# Read Aloud – user guide

Read Aloud reads the open note aloud with a Piper voice installed on your
computer, one paragraph at a time, and softly highlights where it is. It
needs no internet connection, and the text never leaves your computer.

## Starting

There are several ways to start reading:

- **Speaker icon** in the left ribbon: starts at the cursor.
- **Right-click** in the text → **Read aloud from here**: starts at the
  paragraph you clicked.
- **Command palette** (Ctrl+P):
  - *Read Aloud: Read from cursor*
  - *Read Aloud: Read note from the start*

In reading view, reading starts at the paragraph at the top of the screen.

The first start takes a few seconds while the voice loads. Meanwhile the
status bar shows "Starting…". After that, each paragraph is read almost
immediately.

## Controls while reading

While reading, the controls appear in the status bar at the bottom right:

| Button | What it does |
|---|---|
| ⏸ / ▶ | Pause / resume |
| ⏹ | Stop |

The speaker icon in the ribbon also pauses and resumes.

These are commands too (Ctrl+P), and you can give them hotkeys under
Settings → Hotkeys (search for "Read Aloud"):

- *Pause / resume*
- *Stop reading*
- *Next paragraph* – skips the current one
- *Previous paragraph* – goes back one

Tip: Ctrl+Alt+Space for pause/resume and Ctrl+Alt+→ / Ctrl+Alt+← for next
and previous paragraph work well.

## What is read, and what is not

Paragraphs, headings, list items, quotes and table rows are read, each as a
separate piece. Long paragraphs are cut into smaller pieces between
sentences (300 characters at most by default), so reading never slows down.

Left out:

- the properties at the top of the note (front matter),
- code blocks, math and `%% comments %%`,
- embedded images and notes,
- link addresses (the link text is read),
- Markdown syntax (`**`, `#`, `-` and so on).

## Editing while reading

You can keep typing in the note while it is read: the highlight and the
reading position move along with your edits. Opening another note in the
same tab stops reading.

## Settings

Settings → Read Aloud:

- **Voice** – any Piper voice in the voices folder (calibre's Hungarian
  voices are anna, berta and imre).
- **Speed** – 1 is the voice's own pace. Changing it while reading reloads
  the voice, which causes a short pause.
- **Maximum characters at a time** – longer paragraphs are cut between
  sentences.
- **Pause between paragraphs** – in seconds.
- **Scroll along** – keeps the paragraph being read on screen.

This guide opens from the settings page and with the *Read Aloud: Help*
command.

## Troubleshooting

- **"Read Aloud could not start"** – calibre must be in `/opt/calibre`. If
  it is installed elsewhere, set the path of `calibre-debug` under
  *Advanced* in the settings.
- **"No Piper voice found"** – the voices are in
  `~/.cache/calibre/piper-voices` by default. Start reading aloud once in
  calibre's e-book viewer and download a voice there, or set another
  voices folder in the settings.
- **No sound** – check that the system volume is not muted.
