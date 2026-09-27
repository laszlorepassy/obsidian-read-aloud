'use strict';

/**
 * Helpers for the list of Piper voices the speech server sends: entries of
 * { key: 'hu_HU-anna-medium', lang: 'hu_HU', name: 'anna', quality: 'medium',
 * installed: true }.
 */

const QUALITY_ORDER = ['medium', 'high', 'low', 'x_low', ''];

const languageNames = new Map();

/** "hu_HU" → "Hungarian (Hungary)", in English. */
function languageName(lang) {
  if (!lang) return 'Other';
  if (!languageNames.has(lang)) {
    let name = lang;
    try {
      name = new Intl.DisplayNames(['en'], { type: 'language' }).of(lang.replace('_', '-')) || lang;
    } catch (e) { /* not a language code Intl knows */ }
    languageNames.set(lang, name);
  }
  return languageNames.get(lang);
}

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** "Anna (medium)" */
function voiceName(v) {
  const name = capitalize(v.name.replace(/_/g, ' '));
  return v.quality ? `${name} (${v.quality.replace('_', ' ')})` : name;
}

/** "Hungarian (Hungary) – Anna (medium)" */
function voiceLabel(v) {
  return `${languageName(v.lang)} – ${voiceName(v)}`;
}

function byLanguageThenName(a, b) {
  return languageName(a.lang).localeCompare(languageName(b.lang))
    || a.name.localeCompare(b.name)
    || QUALITY_ORDER.indexOf(a.quality) - QUALITY_ORDER.indexOf(b.quality);
}

/** The languages in the list, as [{ lang, label }], sorted by name. */
function languages(voices) {
  const langs = [...new Set(voices.map((v) => v.lang))];
  return langs.map((lang) => ({ lang, label: languageName(lang) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The language of the list that best fits the user's locales (e.g.
 * ['hu-HU', 'en-US']): the same language and country, else the same
 * language, else English, else the first one.
 */
function preferredLanguage(voices, locales) {
  const langs = voices.map((v) => v.lang);
  for (const locale of locales) {
    const [language, country] = locale.split(/[-_]/);
    const exact = country && langs.find((l) => l === `${language}_${country.toUpperCase()}`);
    if (exact) return exact;
    const same = langs.find((l) => l.split('_')[0] === language);
    if (same) return same;
  }
  return langs.find((l) => l === 'en_US') || langs[0] || null;
}

/**
 * The voice to read with: the chosen one if it is installed, else an
 * installed voice in the user's language, else any installed voice.
 */
function chooseVoice(voices, chosen, locales) {
  const installed = voices.filter((v) => v.installed);
  if (installed.some((v) => v.key === chosen)) return chosen;
  if (!installed.length) return null;
  const lang = preferredLanguage(installed, locales);
  const fitting = installed.filter((v) => v.lang === lang).sort(byLanguageThenName);
  return (fitting[0] || installed[0]).key;
}

const SAMPLES = {
  ar: 'مرحبا، هذا هو صوتي.',
  ca: 'Hola, així sona aquesta veu.',
  cs: 'Dobrý den, takto zní tento hlas.',
  cy: 'Helo, dyma sut mae\'r llais hwn yn swnio.',
  da: 'Hej, sådan lyder denne stemme.',
  de: 'Hallo, so klingt diese Stimme.',
  el: 'Γεια σας, έτσι ακούγεται αυτή η φωνή.',
  en: 'Hello, this is how this voice sounds.',
  es: 'Hola, así suena esta voz.',
  fi: 'Hei, tältä tämä ääni kuulostaa.',
  fr: 'Bonjour, voici comment sonne cette voix.',
  hu: 'Jó napot, így szól ez a hang.',
  is: 'Halló, svona hljómar þessi rödd.',
  it: 'Ciao, ecco come suona questa voce.',
  nl: 'Hallo, zo klinkt deze stem.',
  no: 'Hei, slik høres denne stemmen ut.',
  pl: 'Dzień dobry, tak brzmi ten głos.',
  pt: 'Olá, é assim que esta voz soa.',
  ro: 'Bună ziua, așa sună această voce.',
  ru: 'Здравствуйте, так звучит этот голос.',
  sk: 'Dobrý deň, takto znie tento hlas.',
  sl: 'Pozdravljeni, tako zveni ta glas.',
  sr: 'Здраво, овако звучи овај глас.',
  sv: 'Hej, så här låter den här rösten.',
  tr: 'Merhaba, bu ses böyle duyuluyor.',
  uk: 'Добрий день, так звучить цей голос.',
  vi: 'Xin chào, đây là giọng nói này.',
  zh: '你好，这是这个声音的效果。',
};

/** A short sentence to try a voice with, in its language. */
function sampleText(v) {
  const language = (v.lang || '').split('_')[0];
  return SAMPLES[language] || `${capitalize(v.name)}.`;
}

module.exports = {
  languageName, voiceName, voiceLabel, languages, preferredLanguage, chooseVoice, sampleText,
  byLanguageThenName,
};
