/**
 * Finds a sentence in rendered text, for the highlight in reading view.
 *
 * The rendered text differs from the source in its markup (a #tag shows its
 * #, a list its bullets, punctuation may be typographic), so only letters
 * and digits are compared, ignoring case. `pieces` are the texts of the text
 * nodes in order; the result gives the start and end (exclusive) as
 * [piece index, offset], or null. `hint` is roughly how many letters and
 * digits come before the sentence, so the right one of repeated sentences
 * is found.
 */
function matchText(pieces, text, hint = 0) {
  const isKey = (ch) => /[\p{L}\p{N}]/u.test(ch);
  let hay = '';
  const where = [];
  pieces.forEach((piece, p) => {
    for (let i = 0; i < piece.length; i++) {
      if (isKey(piece[i])) {
        hay += piece[i].toLowerCase();
        where.push([p, i]);
      }
    }
  });
  let needle = '';
  for (const ch of text) if (isKey(ch)) needle += ch.toLowerCase();
  if (!needle) return null;
  // The occurrence closest to where the sentence should be.
  let best = -1;
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + 1)) {
    if (best === -1 || Math.abs(at - hint) < Math.abs(best - hint)) best = at;
  }
  if (best === -1) return null;
  const [endPiece, endOffset] = where[best + needle.length - 1];
  // Take the closing punctuation along: "mondat!" rather than "mondat".
  let end = endOffset + 1;
  const piece = pieces[endPiece];
  while (end < piece.length && /[.!?…,;:"'”’»)\]]/.test(piece[end])) end++;
  return { start: where[best], end: [endPiece, end] };
}

/** How many letters and digits `text` has. */
function keyLength(text) {
  let n = 0;
  for (const ch of text) if (/[\p{L}\p{N}]/u.test(ch)) n++;
  return n;
}

export { matchText, keyLength };
