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
/** A place in the text nodes: [piece index, offset]. */
export type TextPoint = [number, number];

function matchText(pieces: string[], text: string, hint = 0): { start: TextPoint; end: TextPoint } | null {
  // One entry per letter or digit, walking code points (not UTF-16 units),
  // each lowercased to a single code point ("İ" lowercases to two).
  let hay = '';
  const where: TextPoint[] = [];
  pieces.forEach((piece, p) => {
    let i = 0;
    for (const ch of piece) {
      if (isKey(ch)) {
        hay += foldCase(ch);
        where.push([p, i]);
      }
      i += ch.length;
    }
  });
  let needle = '';
  for (const ch of text) if (isKey(ch)) needle += foldCase(ch);
  if (!needle) return null;
  // Positions count code points, like `where`.
  const hayPoints = [...hay];
  const needlePoints = [...needle];
  const joinedAt = (i: number) => hayPoints.slice(i, i + needlePoints.length).join('');
  hint = Math.min(hint, hayPoints.length);
  // The occurrence closest to where the sentence should be.
  let best = -1;
  for (let at = 0; at + needlePoints.length <= hayPoints.length; at++) {
    if (hayPoints[at] !== needlePoints[0] || joinedAt(at) !== needle) continue;
    if (best === -1 || Math.abs(at - hint) < Math.abs(best - hint)) best = at;
  }
  if (best === -1) return null;
  const [endPiece, endOffset] = where[best + needlePoints.length - 1];
  // Take the closing punctuation along: "mondat!" rather than "mondat".
  const piece = pieces[endPiece];
  let end = endOffset + ((piece.codePointAt(endOffset) ?? 0) > 0xffff ? 2 : 1);
  while (end < piece.length && /[.!?…,;:"'”’»)\]。！？，、；：」』）]/.test(piece[end])) end++;
  return { start: where[best], end: [endPiece, end] };
}

function isKey(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch);
}

/** A lowercase code point for `ch`, even where lowercasing makes two. */
function foldCase(ch: string): string {
  const lower = ch.toLowerCase();
  return [...lower].length === 1 ? lower : ch;
}

/** How many letters and digits `text` has. */
function keyLength(text: string): number {
  let n = 0;
  for (const ch of text) if (/[\p{L}\p{N}]/u.test(ch)) n++;
  return n;
}

export { matchText, keyLength };
