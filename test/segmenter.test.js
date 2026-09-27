'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { segment, speakable } = require('../src/segmenter');

const texts = (src, opts) => segment(src, opts).map((s) => s.text);

test('skips front matter, code, math and comments', () => {
  const src = [
    '---', 'tags: [x]', '---',
    'Első bekezdés.', '',
    '```js', 'const a = 1;', '```', '',
    '$$', 'x^2', '$$', '',
    '%%', 'rejtett', '%%', '',
    'Utolsó bekezdés.',
  ].join('\n');
  assert.deepStrictEqual(texts(src), ['Első bekezdés.', 'Utolsó bekezdés.']);
});

test('headings, list items, callouts and table rows are separate pieces', () => {
  const src = [
    '# Cím', '',
    '- első', '- [x] második', '  folytatás', '1. harmadik', '',
    '> [!note] Megjegyzés', '> Szöveg.', '> Még egy sor.', '',
    '| Név | Kor |', '|---|---|', '| Anna | 30 |',
  ].join('\n');
  assert.deepStrictEqual(texts(src), [
    'Cím', 'első', 'második folytatás', 'harmadik',
    'Megjegyzés', 'Szöveg. Még egy sor.', 'Név, Kor', 'Anna, 30',
  ]);
});

test('lines of one paragraph stay together', () => {
  assert.deepStrictEqual(texts('Egy sor\nmásik sor.\n\nÚj bekezdés.'),
    ['Egy sor másik sor.', 'Új bekezdés.']);
});

test('ranges point at the source text without its Markdown prefix', () => {
  const src = 'Bevezető.\n\n## Második *rész*\n\n- elem';
  const pieces = segment(src);
  assert.deepStrictEqual(pieces.map((p) => src.slice(p.from, p.to)),
    ['Bevezető.', 'Második *rész*', 'elem']);
});

test('Markdown syntax is not spoken', () => {
  assert.strictEqual(
    speakable('**Félkövér** és _dőlt_ [[Jegyzet#Fejezet|alias]] [[Mappa/Másik]] [link](https://x.hu) `kód` #címke ^id1'),
    'Félkövér és dőlt alias Másik link kód címke');
  assert.strictEqual(speakable('Nézd: https://example.com/a?b=1 itt ![[kép.png]]'), 'Nézd: itt');
  assert.strictEqual(speakable('snake_case_nev marad'), 'snake_case_nev marad');
  assert.strictEqual(speakable('---'), '');
});

test('long paragraphs are cut between sentences', () => {
  const sentence = 'Ez egy mondat, amely körülbelül hatvan karakter hosszú lesz. ';
  const pieces = segment(sentence.repeat(10).trim(), { maxLength: 200 });
  assert.ok(pieces.length >= 4);
  for (const p of pieces) {
    assert.ok(p.to - p.from <= 200, `${p.to - p.from} > 200`);
    assert.match(p.text, /^Ez egy mondat.*hosszú lesz\.$/);
  }
});

test('ordinal numbers and abbreviations do not end a sentence', () => {
  const src = ('Tegnap, 2026. szeptember 27-én pl. a 3. fejezetet olvastuk el együtt. ').repeat(6).trim();
  for (const p of segment(src, { maxLength: 150 })) {
    assert.match(p.text, /^Tegnap, 2026\. szeptember.*együtt\.$/);
  }
});

test('an endless sentence is cut at commas, then between words', () => {
  const pieces = segment('szó, '.repeat(200).trim(), { maxLength: 100 });
  assert.ok(pieces.every((p) => p.to - p.from <= 100));
  const words = segment('szó '.repeat(200).trim(), { maxLength: 100 });
  assert.ok(words.every((p) => p.to - p.from <= 100));
  assert.strictEqual(words.map((p) => p.text).join(' ').split(' ').length, 200);
});
