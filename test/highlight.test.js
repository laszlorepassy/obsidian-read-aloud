'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EditorState } = require('@codemirror/state');
const { readingField, setReadingForTest } = require('../src/highlight');

test('the highlight follows edits made before and inside it', () => {
  let state = EditorState.create({ doc: 'Első bekezdés.\n\nMásodik bekezdés.', extensions: [readingField] });
  state = state.update({ effects: setReadingForTest({ from: 16, to: 33, block: { from: 16, to: 33 } }) }).state;
  assert.deepStrictEqual(state.field(readingField).range, { from: 16, to: 33, block: { from: 16, to: 33 } });

  state = state.update({ changes: { from: 0, insert: 'Új. ' } }).state;
  assert.deepStrictEqual(state.field(readingField).range, { from: 20, to: 37, block: { from: 20, to: 37 } });
  assert.strictEqual(state.sliceDoc(20, 37), 'Második bekezdés.');

  state = state.update({ changes: { from: 28, insert: 'szép ' } }).state;
  const { from, to } = state.field(readingField).range;
  assert.strictEqual(state.sliceDoc(from, to), 'Második szép bekezdés.');

  state = state.update({ effects: setReadingForTest(null) }).state;
  assert.strictEqual(state.field(readingField).range, null);
});
