import { StateField, StateEffect } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';

/**
 * The editor side of the highlight: one soft mark over the sentence being
 * spoken. The sentence's range, and its paragraph's, live in the editor
 * state, so they move along when the note is edited while it is read, and
 * the plugin reads them back from there to know where the next sentence (or
 * paragraph) starts. Only the sentence is marked.
 */
const setReading = StateEffect.define();

const mark = Decoration.mark({ class: 'readaloud-current' });

function decorations(range) {
  return range && range.from < range.to ? Decoration.set([mark.range(range.from, range.to)]) : Decoration.none;
}

function mapRange(changes, r) {
  const from = changes.mapPos(r.from, 1);
  return { from, to: Math.max(from, changes.mapPos(r.to, -1)) };
}

const readingField = StateField.define({
  create: () => ({ range: null, deco: Decoration.none }),
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setReading)) {
        const r = e.value;
        if (!r) return { range: null, deco: Decoration.none };
        const range = { from: r.from, to: r.to, block: { from: r.block.from, to: r.block.to } };
        return { range, deco: decorations(range) };
      }
    }
    if (!value.range || !tr.docChanged) return value;
    const range = { ...mapRange(tr.changes, value.range), block: mapRange(tr.changes, value.range.block) };
    return { range, deco: decorations(range) };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

/**
 * Highlights the sentence { from, to, block: { from, to } } (null clears it),
 * scrolling it into view if asked.
 */
function showReading(view, range, scroll) {
  const effects = [setReading.of(range)];
  if (range && scroll) effects.push(EditorView.scrollIntoView(range.from, { y: 'nearest', yMargin: 80 }));
  view.dispatch({ effects });
}

/** The highlighted sentence and block as they are now, after any edits, or null. */
function readingRange(view) {
  const value = view.state.field(readingField, false);
  return value ? value.range : null;
}

/** The effect that sets the highlight, for the tests. */
function setReadingForTest(range) {
  return setReading.of(range);
}

export { readingField, showReading, readingRange, setReadingForTest };
