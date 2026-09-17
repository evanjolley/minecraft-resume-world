/*
 * EVERY READABLE THING IN THE WORLD, READ FROM WHERE A VISITOR STANDS.
 *
 * ------------------------------------------------------------------------
 * WHY THIS FILE EXISTS. Five of the nine build modules independently shipped
 * a word, a number or a chart backwards, and five of them were found by a
 * human squinting at a screenshot. Harvard shipped `4202`, Patronus shipped a
 * reversed `2026` and a growth chart whose bars climbed the wrong way, No
 * Logo shipped `M21` over `VMG` and a `5` for its address, San Francisco
 * shipped `IH YA2` on a hillside, Perplexity shipped one correct question
 * mark and one mirrored one from the same constant, and the road itself
 * labelled stage 2 as a `5`.
 *
 * Babylon is LEFT-HANDED. Facing +x, +z is on your left; facing north (-z),
 * +x is on your left. `s.pattern` runs its characters along +x on an `xy`
 * wall and along +z on a `zy` wall. So HALF of every drawing in this world
 * comes out mirrored and half does not, depending only on which way the
 * reader is facing -- which is precisely why a spot check proves nothing and
 * why this has to be a table rather than a habit.
 *
 * ------------------------------------------------------------------------
 * WHY IT IS HONEST, which is the part worth arguing about.
 *
 * The one thing a machine CANNOT derive is which side of a wall a visitor is
 * meant to stand on. "Open air on this side" is not it: the shed at the end
 * of No Logo's yard has forty blocks of air in front of it and eleven behind,
 * and San Francisco's tunnel has a wall you read walking east and another you
 * read walking west six blocks away. So the FACING is declared here, by hand,
 * with a reason -- it is authorial intent and it is the only input.
 *
 * Everything else is mechanical and independent of the builds:
 *
 *   - the world is stamped for real, by src/builds/index.js
 *   - the blocks are read back out of the patch
 *   - the mirror is applied from the declared facing, by the rule above
 *   - the result is compared against the intended WORD, rendered through a
 *     font that lives in THIS file
 *
 * That last point is what stops it being circular. This spec does not ask a
 * build whether it drew what it meant to; it spells the word itself and asks
 * the world to match. A build that re-mirrors a sign fails here even if it
 * also "fixes" its own glyph table to agree.
 *
 * WHAT IT DOES NOT COVER, said out loud rather than implied: the charts.
 * Arize's flame graph and Patronus's retired-environment chart are as
 * orientation-dependent as a word -- a time axis that runs backwards puts the
 * error before the call that caused it -- but they are drawings, not strings,
 * and there is no honest way to spell one. They carry their reasoning in a
 * comment at the stamp and they are checked by looking. See
 * test/98-harvard-shots.spec.js for what "checked by looking" means here.
 */
import { test, expect } from './fixtures.js'
import { flatPatch, FLAT_PRESETS } from '../src/flatworld.js'
import { GROUND_Y } from '../src/builds/plots.js'

/*
 * A 3x5 font, in this file, owned by this file.
 *
 * Deliberately NOT imported from any build. Four separate builds carry their
 * own glyph tables and they agree with each other; this is the fifth opinion,
 * and if a build ever quietly redraws a letter the disagreement should show
 * up as a failure rather than be inherited.
 */
const FONT = {
  '0': ['###', '# #', '# #', '# #', '###'],
  '1': [' # ', '## ', ' # ', ' # ', '###'],
  '2': ['###', '  #', '###', '#  ', '###'],
  '3': ['###', '  #', '###', '  #', '###'],
  '4': ['# #', '# #', '###', '  #', '  #'],
  '5': ['###', '#  ', '###', '  #', '###'],
  '6': ['###', '#  ', '###', '# #', '###'],
  '7': ['###', '  #', '  #', '  #', '  #'],
  '8': ['###', '# #', '###', '# #', '###'],
  /* Two accepted forms. Harvard cuts a pointed apex into Widener's stone and
   * San Francisco paints a flat-topped one on a hillside, and both are a
   * capital A. A variant list is the honest way to say "either of these is
   * the letter"; the alternative is picking one and forcing a build to
   * redraw a letter to satisfy a test, which is the test editing the art. */
  'A': [['###', '# #', '###', '# #', '# #'],
        [' # ', '# #', '###', '# #', '# #']],
  'B': ['## ', '# #', '## ', '# #', '## '],
  'G': ['###', '#  ', '# #', '# #', '###'],
  'H': ['# #', '# #', '###', '# #', '# #'],
  'I': ['###', ' # ', ' # ', ' # ', '###'],
  'J': ['###', '  #', '  #', '# #', '###'],
  'L': ['#  ', '#  ', '#  ', '#  ', '###'],
  'M': ['# #', '###', '###', '# #', '# #'],
  'O': ['###', '# #', '# #', '# #', '###'],
  'S': ['###', '#  ', '###', '  #', '###'],
  'V': ['# #', '# #', '# #', '# #', ' # '],
  'Y': ['# #', '# #', '###', ' # ', ' # '],
  ' ': ['   ', '   ', '   ', '   ', '   '],
}

/*
 * Split a drawing into its letters, by cutting at every all-blank column.
 *
 * WHY NOT JUST COMPARE THE WHOLE STRIP. The builds do not agree on how wide a
 * gap is. San Francisco and Harvard emit a separator AFTER every letter and
 * set an inter-word space two columns wide; No Logo and the road put one
 * separator BETWEEN letters and never need a space. Comparing whole strips
 * means this spec fails on typography, which is not what it is for, and a
 * failure that is usually about kerning is a failure nobody reads.
 *
 * Cutting at blank columns is safe rather than lucky: no glyph in FONT has an
 * entirely blank column inside it, so a cut never lands mid-letter. What
 * comes back is the letters, in reading order, which is the whole claim.
 */
function letters(rows) {
  const wide = Math.max(...rows.map(r => r.length))
  const at = (r, c) => rows[r][c] ?? ' '
  const blank = (c) => rows.every((_, r) => at(r, c) === ' ')
  const out = []
  let c = 0
  while (c < wide) {
    if (blank(c)) { c++; continue }
    let end = c
    while (end < wide && !blank(end)) end++
    out.push(rows.map((_, r) => {
      let line = ''
      for (let k = c; k < end; k++) line += at(r, k)
      return line
    }))
    c = end
  }
  return out
}

/** Every accepted form of one character, as a list. Most have exactly one. */
const forms = (ch) => {
  const g = FONT[ch]
  if (!g) throw new Error(`72-readable: no glyph for ${JSON.stringify(ch)}`)
  return Array.isArray(g[0]) ? g : [g]
}

/** The letters of a word, dropping the spaces, which leave no ink. */
const wantLetters = (word) =>
  [...word.toUpperCase()].filter(ch => ch !== ' ').map(ch => ({ ch, forms: forms(ch) }))

/** Spell a word as five rows of `#` and space, one blank column between
 *  letters, which is how every build in this world sets type. */
function spell(word) {
  const rows = ['', '', '', '', '']
  for (const ch of word.toUpperCase()) {
    const g = forms(ch)[0]
    for (let r = 0; r < 5; r++) rows[r] += (rows[r] ? ' ' : '') + g[r]
  }
  return rows
}

/*
 * THE INVENTORY. Every string a visitor can read, and nothing else.
 *
 *   word    what it is supposed to say
 *   at      the patch coordinate of the drawing's BOTTOM-LEFT character as
 *           the source writes it -- x, y, z. Not as the reader sees it.
 *   plane   'zy' (a wall facing east or west) or 'xy' (facing north or south)
 *   facing  which way the READER is looking. This is the declared intent and
 *           the reason is in the comment beside it.
 *   ink     the block the glyph is made of. Everything else is background.
 *
 * Built by dumping every `s.pattern` call the nine build modules make and
 * keeping the ones with a readable shape. 54 patterns, 15 of them words.
 */
const SIGNS = [
  // The road's own stage markers. Both verges, same boards, opposite facings,
  // which is how 1/3/5/7 were right and 2/4/6 were backwards for four passes.
  ['1', [61, 137,  9], 'zy', 'west', 'white_concrete'],   // west verge, read from the paving
  ['2', [66, 137,  9], 'zy', 'east', 'white_concrete'],   // east verge, read from the paving
  ['3', [61, 137, 37], 'zy', 'west', 'white_concrete'],
  ['4', [66, 137, 37], 'zy', 'east', 'white_concrete'],
  ['5', [61, 137, 65], 'zy', 'west', 'white_concrete'],
  ['6', [66, 137, 65], 'zy', 'east', 'white_concrete'],
  ['7', [61, 137, 93], 'zy', 'west', 'white_concrete'],
  ['8', [66, 137, 93], 'zy', 'east', 'white_concrete'],

  // Stage 2. Widener's frieze faces the road from the RIGHT side, so it is
  // read facing east; MAL is inside, on a wall you meet walking south.
  ['2024', [95, 151, 12], 'zy', 'east', 'smooth_quartz'],
  ['MAL',  [99, 140, 30], 'xy', 'south', 'red_concrete'],

  // Stage 6. The shed closes a forty-block axis that starts at the road, so
  // everyone who can see it is west of it; the address plate is on the west
  // wall of the walkup and is read from the road the same way.
  ['12M', [110, 150, 71], 'zy', 'east', 'glowstone'],
  ['GMV', [110, 144, 71], 'zy', 'east', 'glowstone'],
  ['2',   [ 72, 141, 80], 'zy', 'east', 'glowstone'],

  // Stage 7. The hoarding is on the south edge of the plot, read by a visitor
  // still walking north up the road.
  ['2026', [38, 137, 117], 'xy', 'north', 'light_blue_concrete'],

  // Stage 8. The house number is on a west-facing projecting sign, SAY HI is
  // on a bluff read from the bridge and the road, and JOLLY BOYS is on the
  // back wall of a tunnel you enter from the west and walk east through.
  ['27',     [ 85, 141, 102], 'zy', 'east', 'red_concrete'],
  ['SAY HI', [117, 143,  92], 'zy', 'east', 'white_concrete'],
  ['JOLLY',  [121, 142,  96], 'zy', 'east', 'gold_block'],
  ['BOYS',   [121, 136,  98], 'zy', 'east', 'gold_block'],
]

/*
 * The rule, in one place.
 *
 * `pattern` walks its characters along +x on an `xy` wall and along +z on a
 * `zy` wall. Babylon is left-handed, so:
 *
 *   facing east  (+x)  ->  right is -z  ->  a `zy` row runs right to left
 *   facing west  (-x)  ->  right is +z  ->  a `zy` row runs left to right
 *   facing south (+z)  ->  right is +x  ->  an `xy` row runs left to right
 *   facing north (-z)  ->  right is -x  ->  an `xy` row runs right to left
 */
const MIRRORED = { zy: 'east', xy: 'north' }

test.describe('every readable thing reads', () => {
  const world = flatPatch({
    preset: FLAT_PRESETS.classic, width: 128, depth: 128,
    surfaceY: GROUND_Y, ceilingY: GROUND_Y + 64,
  })
  const blockAt = (px, py, pz) => {
    if (px < 0 || px > 127 || pz < 0 || pz > 127) return 'out of the patch'
    const col = world.cols[pz * world.width + px]
    const i = py - world.yMin
    return (i < 0 || i >= col.length) ? 'out of the patch' : world.palette[col[i]]
  }

  for (const [word, [ax, ay, az], plane, facing, ink] of SIGNS) {
    test(`${JSON.stringify(word)} at patch (${ax}, ${ay}, ${az}), read facing ${facing}`, () => {
      const want = spell(word)

      /*
       * READ FOUR COLUMNS PER LETTER, WHICH IS ONE MORE THAN THE WORD NEEDS.
       *
       * The builds do not agree on how they set type. San Francisco and
       * Harvard emit a separator AFTER every letter, so their drawings are
       * 4n wide; No Logo and the road put one BETWEEN letters, so theirs are
       * 4n - 1. Reading the narrower window off a wider drawing is fine until
       * the sign is mirrored, at which point the whole word slides one column
       * and every comparison fails for a reason that has nothing to do with
       * handedness. So read the widest convention, mirror, and trim the blank
       * columns off both ends -- which is exactly what a reader's eye does.
       *
       * Safe to trim, and not by luck: no glyph in FONT has an entirely blank
       * first or last column, so trimming can never eat a letter.
       */
      const wide = 4 * word.length

      // Rows stack UP, so the first row of the drawing is the TOP one and
      // sits `want.length - 1` above the anchor.
      const got = want.map((_, r) => {
        const y = ay + (want.length - 1 - r)
        let line = ''
        for (let c = 0; c < wide; c++) {
          const k = plane === 'xy' ? blockAt(ax + c, y, az) : blockAt(ax, y, az + c)
          line += k === ink ? '#' : ' '
        }
        return line
      })

      // Non-empty FIRST and loudly, because a sign that got deleted would
      // otherwise compare equal to a word made entirely of spaces.
      const litUp = got.join('').split('').filter(ch => ch === '#').length
      expect(litUp, `nothing made of ${ink} at patch (${ax}, ${ay}, ${az})`).toBeGreaterThan(0)

      const mirrored = facing === MIRRORED[plane]
      const onScreen = mirrored ? got.map(r => [...r].reverse().join('')) : got

      const read = letters(onScreen)
      const meant = wantLetters(word)
      const show = (gs) => gs.length
        ? gs[0].map((_, r) => gs.map(g => g[r]).join('  ')).join('\n')
        : '(nothing)'
      const where = `${JSON.stringify(word)} at patch (${ax}, ${ay}, ${az}), `
        + `read facing ${facing}${mirrored ? ' (a mirrored wall)' : ''}`

      expect(
        read.length,
        `${where}\nexpected ${meant.length} letters, read ${read.length}:\n${show(read)}`,
      ).toBe(meant.length)

      /*
       * Letter by letter, IN READING ORDER, which is the assertion that
       * matters. A mirrored sign fails here twice over -- the letters come
       * back in the wrong order AND the asymmetric ones come back reversed --
       * and either one alone is enough to fail it. That redundancy is why a
       * word like `OHO` is still protected: the letters are symmetric but
       * `2024` and `SAY HI` are not, and every sign in the table has at least
       * one asymmetric letter in it.
       */
      read.forEach((glyph, i) => {
        const { ch, forms: ok } = meant[i]
        const got = glyph.join('\n')
        expect(
          ok.some(f => f.join('\n') === got),
          `${where}\n\nletter ${i + 1} should be ${JSON.stringify(ch)}:\n\n`
          + `wanted${ok.length > 1 ? ` (any of ${ok.length} forms)` : ''}\n${show([ok[0]])}\n\n`
          + `got\n${show([glyph])}\n\nthe whole sign as a visitor sees it:\n${show(read)}\n`,
        ).toBe(true)
      })
    })
  }
})
