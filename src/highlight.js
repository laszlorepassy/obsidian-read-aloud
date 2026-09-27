'use strict';

const { StateField, StateEffect } = require('@codemirror/state');
const { Decoration, EditorView } = require('@codemirror/view');

/**
 * The editor side of the highlight: one soft mark over the piece being read.
 * The range lives in the editor state, so it moves along when the note is
 * edited while it is read, and the plugin reads it back from there to know
 * where the next piece starts.
 */
const setReading = StateEffect.define();

const mark = Decoration.mark({ class: 'readaloud-current' });

const readingField = StateField.define({
  create: () => ({ range: null, deco: Decoration.none }),
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setReading)) {
        const r = e.value;
        if (!r || r.from >= r.to) return { range: null, deco: Decoration.none };
        return { range: { from: r.from, to: r.to }, deco: Decoration.set([mark.range(r.from, r.to)]) };
      }
    }
    if (!value.range || !tr.docChanged) return value;
    const from = tr.changes.mapPos(value.range.from, 1);
    const to = Math.max(from, tr.changes.mapPos(value.range.to, -1));
    return { range: { from, to }, deco: from < to ? Decoration.set([mark.range(from, to)]) : Decoration.none };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

/** Highlights [from, to) (null clears it), scrolling it into view if asked. */
function showReading(view, range, scroll) {
  const effects = [setReading.of(range)];
  if (range && scroll) effects.push(EditorView.scrollIntoView(range.from, { y: 'nearest', yMargin: 80 }));
  view.dispatch({ effects });
}

/** The highlighted range as it is now, after any edits, or null. */
function readingRange(view) {
  const value = view.state.field(readingField, false);
  return value ? value.range : null;
}

module.exports = {
  readingField, showReading, readingRange, setReadingForTest: (range) => setReading.of(range),
};
