'use strict';

const test = require('node:test');
const assert = require('node:assert');
const v = require('../src/voices.ts');

const list = [
  { key: 'en_US-amy-low', lang: 'en_US', name: 'amy', quality: 'low', installed: true },
  { key: 'en_US-lessac-medium', lang: 'en_US', name: 'lessac', quality: 'medium', installed: false },
  { key: 'hu_HU-anna-medium', lang: 'hu_HU', name: 'anna', quality: 'medium', installed: true },
  { key: 'hu_HU-imre-medium', lang: 'hu_HU', name: 'imre', quality: 'medium', installed: false },
  { key: 'de_DE-thorsten-high', lang: 'de_DE', name: 'thorsten', quality: 'high', installed: false },
];

test('the chosen voice is kept while it is installed', () => {
  assert.strictEqual(v.chooseVoice(list, 'en_US-amy-low', ['hu-HU']), 'en_US-amy-low');
});

test('otherwise an installed voice in the user\'s language', () => {
  assert.strictEqual(v.chooseVoice(list, '', ['hu-HU', 'en-US']), 'hu_HU-anna-medium');
  assert.strictEqual(v.chooseVoice(list, 'hu_HU-imre-medium', ['en']), 'en_US-amy-low');
  assert.strictEqual(v.chooseVoice(list, '', ['fr-FR']), 'en_US-amy-low');
  assert.strictEqual(v.chooseVoice(list.map((x) => ({ ...x, installed: false })), '', ['en']), null);
});

test('preferred language for downloads', () => {
  assert.strictEqual(v.preferredLanguage(list, ['de']), 'de_DE');
  assert.strictEqual(v.preferredLanguage(list, ['hu-HU']), 'hu_HU');
  assert.strictEqual(v.preferredLanguage(list, ['ja']), 'en_US');
});

test('names and samples', () => {
  assert.strictEqual(v.languageName('hu_HU'), 'Hungarian (Hungary)');
  assert.strictEqual(v.voiceLabel(list[2]), 'Hungarian (Hungary) – Anna (medium)');
  assert.strictEqual(v.voiceName({ name: 'en_voice', quality: 'x_low' }), 'En voice (x low)');
  assert.strictEqual(v.sampleText(list[2]), 'Jó napot, így szól ez a hang.');
  assert.deepStrictEqual(v.languages(list).map((l) => l.lang), ['en_US', 'de_DE', 'hu_HU']);
});
