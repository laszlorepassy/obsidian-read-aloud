'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { matchText, keyLength } = require('../src/text-match.ts');

const cut = (pieces, m) => {
  // The matched text, across pieces.
  let out = '';
  for (let p = m.start[0]; p <= m.end[0]; p++) {
    out += pieces[p].slice(p === m.start[0] ? m.start[1] : 0, p === m.end[0] ? m.end[1] : undefined);
  }
  return out;
};

test('finds a sentence across text nodes, ignoring markup and case', () => {
  const pieces = ['Első mondat. ', 'Ez egy ', 'fontos', ' #címke mondat!', ' Vége.'];
  const m = matchText(pieces, 'Ez egy fontos címke mondat!');
  assert.strictEqual(cut(pieces, m), 'Ez egy fontos #címke mondat!');
});

test('picks the repeated sentence nearest to the hint', () => {
  const pieces = ['Igen. Nem. Igen.'];
  const second = matchText(pieces, 'Igen.', keyLength('Igen. Nem. '));
  assert.deepStrictEqual(second.start, [0, 11]);
  assert.deepStrictEqual(matchText(pieces, 'Igen.', 0).start, [0, 0]);
});

test('no match, or nothing to match', () => {
  assert.strictEqual(matchText(['abc'], 'xyz'), null);
  assert.strictEqual(matchText(['abc'], '...'), null);
});

test('letters whose lowercase is longer, and letters outside the BMP', () => {
  const tr = ['İzmir güzel. ', 'Ankara başkent.'];
  const m = matchText(tr, 'İzmir güzel.');
  assert.strictEqual(cut(tr, m), 'İzmir güzel.');
  const after = matchText(['İyi günler. ', 'Ankara başkent.'], 'Ankara başkent.', keyLength('İyi günler. '));
  assert.deepStrictEqual(after.start, [1, 0]);
  const cjk = ['前文。', '𠀀字在此。'];
  const c = matchText(cjk, '𠀀字在此。');
  assert.strictEqual(cut(cjk, c), '𠀀字在此。');
});
