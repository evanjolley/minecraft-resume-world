/*
 * THE SEVEN PLOTS, SKETCHED AND LEFT EMPTY.
 *
 * ------------------------------------------------------------------------
 * "Just build the path and sketch out the plots, no building within the plots
 * other than maybe a sign to label each."
 *
 * So this file is the ONLY thing that writes inside a chapter, and it writes
 * four things and stops:
 *
 *   1. A BORDER at ground level -- one ring of pale stone where the grass
 *      would be. A plot has to read as a reserved SITE rather than as a hole
 *      in the forest, and a change of ground does that without taking any
 *      height the owner might want.
 *   2. POSTS along that ring, two blocks high, every seventh block. A line on
 *      the floor disappears at eye level; a post is visible from the path,
 *      and a sparse line of them reads as a survey rather than as a fence.
 *      Two blocks, so you can see the whole plot over them and step over one.
 *   3. AN ENTRANCE: a paved gap in the border where the spur arrives, so the
 *      way in is somewhere in particular.
 *   4. A MARKER, which is the label, and is the only thing here taller than
 *      two blocks.
 *
 * Nothing else. Every chapter is 52 x 24 of flat grass with a frame around
 * it, which is the deliverable.
 * ------------------------------------------------------------------------
 * WHY THE MARKER FACES NORTH, all seven of them, on both sides of the path.
 *
 * The visitor walks SOUTH. Everything ahead of them is +z, so a wall standing
 * on a plot's NORTH edge faces the oncoming walk -- and it does so whether
 * the plot is east or west of the path, which is the property that mattered.
 * The alternative, facing each marker at the path, means an east-facing wall
 * on one side and a west-facing wall on the other; those are `zy` planes, and
 * a `zy` marker can only be as wide as the plot is DEEP, which is 24 blocks.
 * "SAN FRANCISCO" is 51 blocks of lettering. It does not fit on any wall in
 * this world except one that spans x.
 *
 * It also makes the mirroring ONE question instead of two. Babylon is
 * left-handed and a row of pattern characters can run right-to-left for the
 * reader; with all seven markers in the same plane facing the same way, one
 * screenshot settles it for all seven. See MIRROR below.
 * ------------------------------------------------------------------------
 * THE MARKER IS ITS OWN LIGHT. docs/builds/README.md: "a sign, a chart or a
 * plaque has to be its own light, or carry a lit valance" -- Harvard
 * photographed every unlit sign as grey and had to go back. The letters are
 * glowstone on dark stone brick, so the thing that makes them legible is the
 * thing that makes them visible at night, and there is no lamp to place.
 *
 * AND IT IS AT EYE LEVEL. The letters occupy local y = 1 to 5, so the middle
 * of the word is at y = 3 -- a metre and a half over the reader's eyeline at
 * twenty blocks, which is where they are standing when they decide whether to
 * turn off the path. The previous build's markers were tall enough that
 * nobody walking past could read them, which is recorded in the README as one
 * of the two mistakes only a screenshot found.
 */
import { stamper } from './stamp.js'
import { CHAPTERS } from './plots.js'
import { textRows, textWidth } from './font.js'
import { hash } from './land.js'

/*
 * WHETHER THE LETTERS COME OUT BACKWARDS, and the honest way to hold this.
 *
 * `pattern`'s 'xy' plane runs characters along +x. Whether +x is left or
 * right for somebody facing the wall depends on which way the wall faces, and
 * Babylon's handedness makes the answer non-obvious -- the README's own
 * warning says a spot check that happens to pass proves nothing about the
 * next wall, which is why all seven of these are the same wall.
 *
 * FALSE was verified by screenshot: docs/land/marker-omaha.png reads OMAHA
 * from the path, left to right. If a future marker faces the other way, it
 * needs its own flag and its own screenshot, not this one.
 */
const MIRROR = false

/** The ground the border is drawn in, and the paving of the entrance. */
const BORDER = 'polished_andesite'
const POST = 'stripped_oak_log'
const BACKING = 'stone_bricks'
const LETTER = 'glowstone'

/**
 * Frame and label all seven chapters.
 *
 * Each gets its own stamper bound to its own rectangle, so the ordinary
 * bounds check does its ordinary job: chapter 3 cannot write into chapter 5
 * however wrong its arithmetic is.
 *
 * @param world the patch being generated
 * @param model the column model, read only here -- the entrance has to line
 *              up with the spur the path pass actually drew
 */
export function markChapters(world, model) {
  for (const c of CHAPTERS) {
    const s = stamper(world, c, { label: `${c.id}/${c.marker}` })
    const w = c.x1 - c.x0, d = c.z1 - c.z0      // last local index on each axis
    /* LEFT is the LOW-x side of the path, which is EAST in this engine --
     * +x is west here. See the note in src/builds/path.js. */
    const lowX = c.side === 'LEFT'
    const doorZ = 6                              // where drawSpurs aims: z0 + 6
    const doorX = lowX ? w : 0                   // the edge the path is on

    /* 1. The border: one ring at ground level, with the entrance left out. */
    for (let x = 0; x <= w; x++) {
      for (const z of [0, d]) s.set(x, -1, z, BORDER)
    }
    for (let z = 0; z <= d; z++) {
      for (const x of [0, w]) {
        if (x === doorX && Math.abs(z - doorZ) <= 1) continue
        s.set(x, -1, z, BORDER)
      }
    }

    /* 2. The posts. Every seventh block, skipping the entrance, and skipped
     *    again at random so the line is not a rhythm. */
    const tw0 = textWidth(c.marker)
    const mx0 = lowX ? Math.max(0, w - tw0) : 0
    const post = (x, z) => {
      if (x === doorX && Math.abs(z - doorZ) <= 2) return
      /*
       * AND NOT IN FRONT OF THE WORD. The border runs along z = 0 and the
       * marker stands at z = 2, so a post on the north edge is two blocks in
       * front of the letters and from the path it lands in the middle of
       * them. The first screenshot had one through the second A of OMAHA.
       */
      if (z === 0 && x >= mx0 - 1 && x <= mx0 + tw0) return
      if (hash(c.x0 + x, c.z0 + z, 307) < 0.2) return
      s.pillar(x, z, 0, 1, POST)
    }
    for (let x = 0; x <= w; x += 7) { post(x, 0); post(x, d) }
    for (let z = 0; z <= d; z += 7) { post(0, z); post(w, z) }
    post(w, d)

    /* 3. The entrance: three blocks of paving through the border line, at the
     *    z the spur was aimed at, so stepping off the spur is stepping in. */
    for (let z = doorZ - 1; z <= doorZ + 1; z++) {
      s.set(doorX, -1, z, 'gravel')
      s.set(lowX ? w - 1 : 1, -1, z, 'gravel')
    }

    /* 4. The marker. */
    const text = c.marker
    const tw = textWidth(text)
    if (tw > w + 1) {
      throw new Error(`[${c.id}] the marker ${JSON.stringify(text)} is ${tw} blocks `
        + `wide and the plot is ${w + 1}. Shorten it or widen the plot.`)
    }
    /* Pushed to the end of the plot NEAREST THE PATH, so it is the first
     * thing in the plot that comes into view rather than the last. */
    const x0 = lowX ? Math.max(0, w - tw) : 0
    /* Two rows in from the north edge: clear of the border ring, and far
     * enough forward that the backing wall does not eat the corner post. */
    const zBack = 3, zFace = 2

    s.box([Math.max(0, x0 - 1), 0, zBack], [Math.min(w, x0 + tw), 6, zBack], BACKING)
    s.pattern({
      at: [x0, 1, zFace],
      plane: 'xy',
      legend: { '#': LETTER },
      rows: textRows(text, MIRROR),
    })

    /*
     * CHAPTER 7 RESERVES ITS START AND NOTHING ELSE.
     *
     * It is a parkour going UP, visiting his other interests on the way, and
     * the brief is explicit: reserve the footprint and the start, build none
     * of it. So it gets a five by five pad where the first jump would stand
     * and four two-block posts around it -- enough that the place is obviously
     * the bottom of something, with not one block of the climb decided.
     */
    if (c.id === 'ch7') {
      const px = lowX ? w - 12 : 8
      s.rect([px - 2, doorZ + 4], [px + 2, doorZ + 8], -1, 'polished_andesite')
      for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
        s.pillar(px + dx, doorZ + 6 + dz, 0, 1, POST)
      }
    }
  }
}
