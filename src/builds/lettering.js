/*
 * BLOCK LETTERING WITH DIGITS AND A FEW SIGNS, for chapters 4 to 6.
 *
 * src/builds/font.js is A-Z and a space, which was enough for the chapter
 * markers. These three chapters have numbers to show -- employee #2, a $100K
 * to $8M run rate, a 20-person office, stage 3 of 5 -- so this file adds the
 * ten digits and the handful of symbols those need, on the SAME 3x5 grid and
 * with the same one-column gap, so a word and a number set side by side are
 * one line of type.
 *
 * Ch1 keeps its own private digit table and is not touched: its build is
 * frozen. These glyphs match its shapes where they overlap, so a 2 in New
 * York is the same 2 as the one on the roof in Omaha.
 *
 * MIRRORING. `wordRows(text, mirror)` does what font.js's `textRows` does:
 * with `mirror` it reverses every row. Which walls need it is NOT decided
 * here -- see docs/builds/README.md. Every readable wall in chapters 4 to 6
 * states its reasoning beside the call and is decoded by
 * test/99-chapters-4-6.spec.js, which reads the blocks back out of the world.
 */
import { GLYPHS } from './font.js'

export const EXTRA = {
  0: ['###', '#.#', '#.#', '#.#', '###'],
  1: ['.#.', '##.', '.#.', '.#.', '###'],
  2: ['###', '..#', '###', '#..', '###'],
  3: ['###', '..#', '.##', '..#', '###'],
  4: ['#.#', '#.#', '###', '..#', '..#'],
  5: ['###', '#..', '###', '..#', '###'],
  6: ['###', '#..', '###', '#.#', '###'],
  7: ['###', '..#', '..#', '..#', '..#'],
  8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '###'],
  '#': ['#.#', '###', '#.#', '###', '#.#'],
  $: ['.##', '##.', '.#.', '.##', '##.'],
  '+': ['...', '.#.', '###', '.#.', '...'],
  '-': ['...', '...', '###', '...', '...'],
  '>': ['#..', '.#.', '..#', '.#.', '#..'],
  '.': ['...', '...', '...', '...', '.#.'],
  '/': ['..#', '..#', '.#.', '#..', '#..'],
}

export const ALL_GLYPHS = { ...GLYPHS, ...EXTRA }

/** 3 per glyph plus a gap between, no trailing -- identical to font.js. */
export const wordWidth = (text) => text.length * 4 - 1

/** Five strings, top row first, which is what `pattern` wants for a wall. */
export function wordRows(text, mirror = false) {
  const rows = ['', '', '', '', '']
  ;[...text].forEach((ch, i) => {
    const g = ALL_GLYPHS[ch]
    if (!g) throw new Error(`no glyph for ${JSON.stringify(ch)} in ${JSON.stringify(text)}`)
    for (let r = 0; r < 5; r++) rows[r] += (i ? '.' : '') + g[r]
  })
  return mirror ? rows.map(r => [...r].reverse().join('')) : rows
}

/**
 * Decode a 5-row grid of '#' and '.' back into text. The specs use it to read
 * a wall out of the world; it lives here so the decoder and the encoder can
 * never disagree about a glyph.
 */
export function decodeRows(grid, length) {
  let out = ''
  for (let i = 0; i < length; i++) {
    const cell = grid.map(row => row.slice(i * 4, i * 4 + 3)).join('')
    const hit = Object.entries(ALL_GLYPHS).find(([, g]) => g.join('') === cell)
    out += hit ? hit[0] : '?'
  }
  return out
}
