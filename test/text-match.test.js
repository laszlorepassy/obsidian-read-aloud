'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { matchText, keyLength } = require('../src/text-match');

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
