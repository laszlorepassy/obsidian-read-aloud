import test from 'node:test';
import assert from 'node:assert';
import { segment, speakable } from '../src/segmenter.ts';

const texts = (src: string, opts?: { maxLength?: number }) => segment(src, opts).map((s) => s.text);

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

test('headings, list items, callouts and table rows are separate blocks', () => {
  const src = [
    '# Cím', '',
    '- első', '- [x] második', '  folytatás', '1. harmadik', '',
    '> [!note] Megjegyzés', '> Szöveg.', '> Még egy sor.', '',
    '| Név | Kor |', '|---|---|', '| Anna | 30 |',
  ].join('\n');
  assert.deepStrictEqual(texts(src), [
    'Cím', 'első', 'második folytatás', 'harmadik',
    'Megjegyzés', 'Szöveg.', 'Még egy sor.', 'Név, Kor', 'Anna, 30',
  ]);
});

test('lines of one paragraph stay together', () => {
  assert.deepStrictEqual(texts('Egy sor\nmásik sor.\n\nÚj bekezdés.'),
    ['Egy sor másik sor.', 'Új bekezdés.']);
});

test('sentences know their paragraph', () => {
  const src = 'Első. Második?\n\nHarmadik!';
  const s = segment(src);
  assert.deepStrictEqual(s.map((x) => src.slice(x.from, x.to)), ['Első.', 'Második?', 'Harmadik!']);
  assert.deepStrictEqual(s.map((x) => src.slice(x.block.from, x.block.to)),
    ['Első. Második?', 'Első. Második?', 'Harmadik!']);
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

test('a paragraph is read sentence by sentence', () => {
  const sentence = 'Ez egy mondat, amely körülbelül hatvan karakter hosszú lesz. ';
  const pieces = segment(sentence.repeat(10).trim(), { maxLength: 200 });
  assert.strictEqual(pieces.length, 10);
  for (const p of pieces) assert.strictEqual(p.text, sentence.trim());
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

test('heading closers, HTML entities, emoji and footnote marks are not spoken', () => {
  assert.deepStrictEqual(texts('## Cím ##'), ['Cím']);
  assert.strictEqual(speakable('Tom &amp; Jerry&nbsp;és &lt;b&gt; &#8211; &#x41;'), 'Tom & Jerry és <b> – A');
  assert.strictEqual(speakable('Kész ✅ és 😀 jó 🇭🇺'), 'Kész és jó');
  assert.deepStrictEqual(texts('Szöveg.[^1]\n\n[^1]: A lábjegyzet.'), ['Szöveg.', 'A lábjegyzet.']);
});

test('comments, links, code and math are never cut, so hidden text stays hidden', () => {
  assert.deepStrictEqual(texts('Látható. %%Titkos. Ne olvasd.%% Tovább.'), ['Látható.', 'Tovább.']);
  assert.deepStrictEqual(texts('Lásd [Mi ez? Útmutató](https://x.y/z) most.'), ['Lásd Mi ez? Útmutató most.']);
  assert.deepStrictEqual(texts('Link [[Jegyzet. Kettő|Alias]] vége. `kód. Kód` és $a. B$ vége.'),
    ['Link Alias vége.', 'kód. Kód és a. B vége.']);
});

test('Chinese and Japanese sentences, and text without spaces', () => {
  assert.deepStrictEqual(texts('这是第一句。这是第二句！'), ['这是第一句。', '这是第二句！']);
  const long = segment('没有空格也没有标点'.repeat(40), { maxLength: 120 });
  assert.ok(long.length >= 3 && long.every((p) => p.to - p.from <= 120));
});

test('a big paragraph is cut quickly', () => {
  const start = Date.now();
  segment('Ez egy mondat 123. Másik mondat. '.repeat(3000));
  assert.ok(Date.now() - start < 1000, `${Date.now() - start} ms`);
});
