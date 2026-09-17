/*
 * A 3x5 BLOCK ALPHABET, because this world has no signs.
 *
 * docs/FUTURE.md item 1 is the sign feature and it is not this pass's job, so
 * every label on the walk is block lettering -- the same thing the previous
 * builds did for `2024`, `12M` and `N`, at a size that fits a plot edge.
 *
 * 3x5 AND NOT 5x7. A chapter marker has to carry up to thirteen characters
 * ("SAN FRANCISCO") across a plot that is 52 blocks wide. At 4 columns per
 * character (3 of letter, 1 of gap) that is 51 blocks and it fits with one to
 * spare; at 6 it would be 77 and would not fit on any plot in the table. The
 * cost is that 3x5 is the smallest grid an alphabet is legible in at all, so
 * a few letters (M, N, W) are compromises -- they are distinguishable in
 * context, which for seven known words is all they have to be.
 *
 * Rows read TOP DOWN, which is the order `pattern` wants for a vertical
 * plane: its first row is the top one.
 */
export const GLYPHS = {
  ' ': ['...', '...', '...', '...', '...'],
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  N: ['#.#', '###', '###', '###', '#.#'],
  O: ['###', '#.#', '#.#', '#.#', '###'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  Q: ['###', '#.#', '#.#', '###', '..#'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#.#', '#.#', '###', '###', '#.#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
}

/** How wide a word comes out: 3 per glyph plus a gap between, no trailing. */
export const textWidth = (text) => text.length * 4 - 1

/**
 * Lay a word out as five rows of characters, ready for `pattern`.
 *
 * @param text   the word, upper case
 * @param mirror reverse every row, for a wall whose +x runs right-to-left for
 *               the reader. WHICH ONE YOU NEED IS NOT GUESSABLE -- see the
 *               mirrored-text warning in docs/builds/README.md, which is
 *               there because three separate agents shipped backwards text in
 *               this repo. Draw it, screenshot it, read it.
 */
export function textRows(text, mirror = false) {
  const rows = ['', '', '', '', '']
  ;[...text].forEach((ch, i) => {
    const g = GLYPHS[ch]
    if (!g) throw new Error(`no glyph for ${JSON.stringify(ch)} in ${JSON.stringify(text)}`)
    for (let r = 0; r < 5; r++) rows[r] += (i ? '.' : '') + g[r]
  })
  return mirror ? rows.map(r => [...r].reverse().join('')) : rows
}
