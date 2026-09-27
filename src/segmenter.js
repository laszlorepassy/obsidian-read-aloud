'use strict';

/**
 * Cuts a Markdown note into the sentences that are read aloud one at a time.
 *
 * Each sentence knows its block: the paragraph, heading, list item or table
 * row it is in, which is what gets highlighted, so the highlight follows the
 * note's own structure. Speaking sentence by sentence means Piper never gets
 * more than a sentence at once, the first words sound almost immediately,
 * and the reader can step back and forth by sentences. An endless sentence
 * is cut at commas and finally between words at `maxLength` characters.
 *
 * Each sentence keeps its [from, to) offsets in the source, for the
 * highlight, and the plain text that is spoken: the Markdown syntax, links'
 * targets, embeds, code and comments are left out.
 */

const FENCE = /^\s*(```+|~~~+)/;
const MATH_FENCE = /^\s*\$\$\s*$/;
const COMMENT_FENCE = /^\s*%%\s*$/;
const HEADING = /^(\s{0,3}#{1,6}\s+)/;
const LIST_ITEM = /^(\s*(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?)/;
const QUOTE = /^(\s*(?:>\s?)+)/;
const CALLOUT = /^\s*(?:>\s?)+\[!\w[\w-]*\][+-]?\s*/;
const TABLE_ROW = /^\s*\|/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;

/** Splits text into lines with their start offsets. */
function lines(text) {
  const result = [];
  let start = 0;
  while (start <= text.length) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    result.push({ start, end, text: text.slice(start, end) });
    start = end + 1;
  }
  return result;
}

/** Length of the YAML front matter at the start of a note, if any. */
function frontMatterEnd(text) {
  const m = /^---\r?\n[\s\S]*?\r?\n(---|\.\.\.)[ \t]*(\r?\n|$)/.exec(text);
  return m ? m[0].length : 0;
}

/**
 * The note's blocks: paragraphs, headings, list items, quote paragraphs and
 * table rows, as source ranges starting after their Markdown prefix.
 */
function blocks(text) {
  const result = [];
  let current = null;
  let skipUntil = null;           // closing line of a code/math/comment block
  const close = () => {
    if (current) result.push(current);
    current = null;
  };
  const open = (from, to, kind) => {
    close();
    current = { from, to, kind };
  };

  const bodyStart = frontMatterEnd(text);
  for (const line of lines(text)) {
    if (line.end < bodyStart) continue;
    const t = line.text;

    if (skipUntil) {
      if (skipUntil.test(t)) skipUntil = null;
      continue;
    }
    const fence = FENCE.exec(t);
    if (fence) {
      close();
      skipUntil = new RegExp('^\\s*' + fence[1][0].replace(/[$^*+?.()|[\]{}\\]/g, '\\$&') +
        '{' + fence[1].length + ',}\\s*$');
      continue;
    }
    if (MATH_FENCE.test(t)) { close(); skipUntil = MATH_FENCE; continue; }
    if (COMMENT_FENCE.test(t)) { close(); skipUntil = COMMENT_FENCE; continue; }

    if (!t.trim() || RULE.test(t) || /^\s*(?:>\s?)+$/.test(t)) { close(); continue; }

    let m;
    if ((m = HEADING.exec(t))) {
      open(line.start + m[1].length, line.end, 'heading');
      close();
    } else if (TABLE_ROW.test(t)) {
      close();
      if (!TABLE_SEPARATOR.test(t)) result.push({ from: line.start, to: line.end, kind: 'table' });
    } else if ((m = CALLOUT.exec(t))) {
      open(line.start + m[0].length, line.end, 'callout');
      close();
    } else if ((m = QUOTE.exec(t))) {
      const rest = t.slice(m[1].length);
      const item = LIST_ITEM.exec(rest);
      const prefix = m[1].length + (item ? item[1].length : 0);
      if (current && current.kind === 'quote' && !item) current.to = line.end;
      else open(line.start + prefix, line.end, 'quote');
    } else if ((m = LIST_ITEM.exec(t))) {
      open(line.start + m[1].length, line.end, 'item');
    } else if (current && current.kind !== 'quote') {
      current.to = line.end;      // a paragraph or list item going on
    } else {
      open(line.start + (t.length - t.trimStart().length), line.end, 'paragraph');
    }
  }
  close();
  return result;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…' };

/** Turns a piece of Markdown source into the words that are spoken. */
function speakable(source) {
  let s = source;
  s = s.replace(/^\[\^[^\]]*\]:\s*/, '');                         // footnote definition
  s = s.replace(/\s+#+\s*$/, '');                                 // closing #s of a heading
  s = s.replace(/%%[\s\S]*?%%/g, ' ');                         // Obsidian comments
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/!\[\[[^\]]*\]\]/g, ' ');                      // embeds
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');                 // images
  s = s.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2');          // [[note|alias]]
  s = s.replace(/\[\[([^\]]*)\]\]/g, (_, target) =>            // [[note#heading]]
    target.replace(/#\^.*$/, '').replace(/#/g, ' ').split('/').pop());
  s = s.replace(/\[\^[^\]]*\]/g, '');                          // footnote marks
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');               // [text](url)
  s = s.replace(/<https?:[^>]*>/g, ' ');
  s = s.replace(/\bhttps?:\/\/\S+/g, ' ');
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, ' ');                    // HTML tags
  s = s.replace(/`([^`]*)`/g, '$1');
  s = s.replace(/\$([^$\n]+)\$/g, '$1');
  s = s.replace(/(^|\s)\^[\w-]+\s*$/gm, '$1');                  // block ids
  s = s.replace(/^[ \t]*(?:>[ \t]?)+/gm, '');                   // quote marks on later lines
  // List marks on later lines of a quote; the first line's mark is already
  // outside the piece, and there "2026. szeptember" is just a date.
  s = s.replace(/\n[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[.\][ \t]+)?/g, '\n');
  s = s.replace(/(\*\*|__|~~|==)/g, '');
  s = s.replace(/(^|[^\w*])\*(?=\S)|(\S)\*(?=[^\w*]|$)/g, '$1$2');
  s = s.replace(/(^|[^\p{L}\p{N}_])_(?=\S)|(\S)_(?=[^\p{L}\p{N}_]|$)/gu, '$1$2');
  s = s.replace(/(^|\s)#([\p{L}\p{N}_/-]+)/gu, '$1$2');         // #tags
  s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {       // HTML entities
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()] || m;
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    try { return String.fromCodePoint(code); } catch (err) { return ' '; }
  });
  s = s.replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}]/gu, ' '); // emoji
  if (/^\s*\|/.test(s)) {                                       // table row
    s = s.split('|').map((c) => c.trim()).filter(Boolean).join(', ');
  }
  s = s.replace(/\s+/g, ' ').trim();
  return /[\p{L}\p{N}]/u.test(s) ? s : '';
}

/**
 * `text` with the spans that must never be cut (comments, links, embeds,
 * inline code and math, HTML tags, URLs) filled with "X" of the same length,
 * so the offsets found in it are the offsets in `text`, and no sentence end,
 * comma or space inside those spans counts.
 */
const UNCUTTABLE = [
  /%%[\s\S]*?%%/g, /<!--[\s\S]*?-->/g, /!?\[\[[^\]]*\]\]/g, /!?\[[^\]]*\]\([^)]*\)/g,
  /`[^`]*`/g, /\$[^$\n]+\$/g, /<[^>\n]*>/g, /\bhttps?:\/\/\S+/g,
];

function mask(text) {
  let masked = text;
  for (const re of UNCUTTABLE) masked = masked.replace(re, (m) => 'X'.repeat(m.length));
  return masked;
}

/** Whether `text` ends in a number standing on its own, as in "2026" or "3". */
function endsInNumber(text) {
  let i = text.length;
  while (i > 0 && text.charCodeAt(i - 1) >= 48 && text.charCodeAt(i - 1) <= 57) i--;
  return i < text.length && (i === 0 || /\s/.test(text[i - 1]));
}

/**
 * Offsets inside `text` where a new sentence starts. A full stop after a
 * number ("2026. szeptember", "3. fejezet") or before a lowercase word
 * ("pl. a", "stb. is") does not end a sentence. Chinese and Japanese full
 * stops need no space after them.
 */
function sentenceStarts(text) {
  const starts = [];
  const re = /[.!?…]+["'”’»)\]]*\s+|[。！？．]+["'”’」』)]*\s*/g;
  let m;
  while ((m = re.exec(text))) {
    const next = m.index + m[0].length;
    if (next >= text.length) break;
    if (/^[.!?…]/.test(m[0])) {
      if (m[0][0] === '.' && endsInNumber(text.slice(Math.max(0, m.index - 40), m.index))) continue;
      if (/^\p{Ll}/u.test(text.slice(next, next + 2))) continue;
    }
    starts.push(next);
  }
  return starts;
}

/** Offsets where a too long sentence may be cut: after , ; : or a dash. */
function clauseStarts(text) {
  const starts = [];
  const re = /(?:[,;:]|\s[–—-])\s+|[，、；：]\s*/g;
  let m;
  while ((m = re.exec(text))) {
    const next = m.index + m[0].length;
    if (next < text.length) starts.push(next);
  }
  return starts;
}

function wordStarts(text) {
  const starts = [];
  const re = /\s+/g;
  let m;
  while ((m = re.exec(text))) {
    const next = m.index + m[0].length;
    if (next < text.length && m.index > 0) starts.push(next);
  }
  return starts;
}

/** Every `max` characters, for text without any spaces (Chinese, Japanese). */
function hardStarts(text, max) {
  const starts = [];
  for (let i = max; i < text.length; i += max) starts.push(i);
  return starts;
}

/**
 * Cuts [0, text.length) into ranges of at most `max` characters where it can,
 * preferring sentence ends, then clause ends, then spaces, and only then
 * anywhere outside links and the like. `masked` is `mask(text)`.
 */
function cut(text, max, masked = mask(text)) {
  if (text.length <= max) return [[0, text.length]];
  const finders = [sentenceStarts, clauseStarts, wordStarts, (t) => hardStarts(t, max)];
  for (const finder of finders) {
    const points = finder(masked).filter((i) => masked[i - 1] !== 'X' || masked[i] !== 'X'
      || finder !== finders[3]);
    if (!points.length) continue;
    const bounds = [0, ...points, text.length];
    const pieces = [];
    let start = 0;
    for (let i = 1; i < bounds.length; i++) {
      // Close the piece before a bound that would make it too long.
      if (bounds[i] - start > max && bounds[i - 1] > start) {
        pieces.push([start, bounds[i - 1]]);
        start = bounds[i - 1];
      }
    }
    pieces.push([start, text.length]);
    // A piece still too long (one huge sentence) is cut again, more finely.
    const result = [];
    for (const [a, b] of pieces) {
      if (b - a > max && finder !== finders[3]) {
        for (const [c, d] of cut(text.slice(a, b), max, masked.slice(a, b))) result.push([a + c, a + d]);
      } else {
        result.push([a, b]);
      }
    }
    return result;
  }
  return [[0, text.length]];
}

/**
 * The sentences of a note, in reading order: { from, to, text, block }.
 * `from`/`to` are the sentence's source offsets without surrounding
 * whitespace, `text` is what is spoken, and `block` is { from, to } of the
 * paragraph (heading, list item…) it belongs to. A sentence longer than
 * `maxLength` characters is cut at commas, or else between words.
 */
function segment(source, { maxLength = 300 } = {}) {
  const result = [];
  for (const b of blocks(source)) {
    const body = source.slice(b.from, b.to);
    const masked = mask(body);
    const block = { from: b.from, to: b.from + body.trimEnd().length };
    const bounds = [0, ...sentenceStarts(masked), body.length];
    for (let i = 1; i < bounds.length; i++) {
      const start = bounds[i - 1];
      for (const [x, y] of cut(body.slice(start, bounds[i]), maxLength, masked.slice(start, bounds[i]))) {
        const piece = body.slice(start + x, start + y);
        const text = speakable(piece);
        if (!text) continue;
        const lead = piece.length - piece.trimStart().length;
        const trail = piece.length - piece.trimEnd().length;
        result.push({ from: b.from + start + x + lead, to: b.from + start + y - trail, text, block });
      }
    }
  }
  return result;
}

module.exports = { segment, speakable, blocks, cut, sentenceStarts };
