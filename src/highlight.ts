import { StateField, StateEffect } from '@codemirror/state';
import type { ChangeDesc, StateEffect as Effect } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';

/** The sentence being read, and its paragraph, as source ranges. */
export interface ReadingRange {
  from: number;
  to: number;
  block: { from: number; to: number };
}

interface Reading {
  range: ReadingRange | null;
  deco: DecorationSet;
}

/**
 * The editor side of the highlight: one soft mark over the sentence being
 * spoken. The sentence's range, and its paragraph's, live in the editor
 * state, so they move along when the note is edited while it is read, and
 * the plugin reads them back from there to know where the next sentence (or
 * paragraph) starts. Only the sentence is marked.
 */
const setReading = StateEffect.define<ReadingRange | null>();

const mark = Decoration.mark({ class: 'readaloud-current' });

function decorations(range: ReadingRange | null): DecorationSet {
  return range && range.from < range.to ? Decoration.set([mark.range(range.from, range.to)]) : Decoration.none;
}

function mapRange(changes: ChangeDesc, r: { from: number; to: number }): { from: number; to: number } {
  const from = changes.mapPos(r.from, 1);
  return { from, to: Math.max(from, changes.mapPos(r.to, -1)) };
}

const readingField = StateField.define<Reading>({
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
function showReading(view: EditorView, range: ReadingRange | null, scroll: boolean): void {
  const effects: Effect<unknown>[] = [setReading.of(range)];
  if (range && scroll) effects.push(EditorView.scrollIntoView(range.from, { y: 'nearest', yMargin: 80 }));
  view.dispatch({ effects });
}

/** The highlighted sentence and block as they are now, after any edits, or null. */
function readingRange(view: EditorView): ReadingRange | null {
  const value = view.state.field(readingField, false);
  return value ? value.range : null;
}

/** The effect that sets the highlight, for the tests. */
function setReadingForTest(range: ReadingRange | null): Effect<ReadingRange | null> {
  return setReading.of(range);
}

export { readingField, showReading, readingRange, setReadingForTest };
