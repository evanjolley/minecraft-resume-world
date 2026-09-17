/*
 * The stamper: a small vocabulary for writing blocks into a world, before
 * anybody is standing in it.
 *
 * ------------------------------------------------------------------------
 * WHEN THIS RUNS, which is the whole design.
 *
 * src/flatworld.js compiles a superflat patch -- a per-column array of
 * palette indices. src/island.js installs it and then answers every voxel
 * query with two subtractions and one array read, forever. A structure is
 * therefore COLUMNS REWRITTEN ONCE, in the gap between those two steps: see
 * src/builds/index.js, which is called from island.js's generateTerrain.
 *
 * REJECTED -- a runtime chunk hook that decorates chunks as noa asks for
 * them, and the more obvious `noa.setBlock` storm at boot. The hook costs a
 * branch per chunk forever and has to answer the same question repeatedly
 * because noa may request a chunk twice; the setBlock storm is tens of
 * thousands of voxel writes on the frame the world appears, each one dirtying
 * a mesh. Both also break the property island.js's header rests everything on
 * -- that a coordinate's answer never changes -- because a chunk meshed before
 * the decoration ran and one meshed after would disagree. Stamping into the
 * generator means the world is simply BORN with a house in it.
 *
 * So: no runtime cost, no per-chunk hook, and getVoxelID is untouched.
 * ------------------------------------------------------------------------
 * TWO THINGS IT MUST DO LOUDLY, because both failures are invisible:
 *
 *   1. An unknown block key THROWS. `oak_planks` is not a key in this game --
 *      the oak one is called `planks` -- and a stamper that shrugged would
 *      place air, which looks exactly like a wall you forgot to build.
 *   2. A write outside your plot THROWS. Eight agents are building eight
 *      plots in parallel against this file. The bounds check is the single
 *      guard that makes that safe, and it is worth more than any amount of
 *      care, because "I was sure I was inside my plot" is precisely the
 *      belief that is wrong when it is wrong.
 * ------------------------------------------------------------------------
 * COPY ON WRITE, and it is not optional. flatPatch hands all 16384 columns
 * the SAME Uint16Array -- 16384 references to one 69-entry array, which is
 * the right call for a flat world and a live grenade for a stamper. Writing
 * into it would move the grass under the entire map. Every column is cloned
 * the first time it is written to, and `touched` remembers which.
 */
import { BLOCK_TYPES } from '../blocks.js'
import { plot as findPlot, toPatch, toWorld, width, depth } from './plots.js'

/*
 * Every legal block key, for the typo check. A Set because the check runs once
 * per distinct key per build, not once per block -- keys are resolved to
 * palette indices and memoised below.
 *
 * 'air' is added by hand because it is NOT in BLOCK_TYPES: it is id 0, the
 * absence of a block, and src/island.js special-cases the key when it builds
 * its palette-index -> engine-id table. Leaving it out made `clear()` throw,
 * which is the typo check catching the one key that is not a typo.
 */
const KEYS = new Set(['air', ...BLOCK_TYPES.map(b => b.key)])

/** Characters a pattern may contain without being in its legend. Both mean
 *  "leave whatever is already here alone", which is what you want for the
 *  empty half of a facade drawing. A legend may still override either. */
const BLANK = { ' ': null, '.': null }

/**
 * Suggest what they meant. Purely a courtesy on the error path -- a build
 * fails at boot with a typo'd key, and "did you mean `planks`?" is the
 * difference between a ten-second fix and grepping blocks.js.
 */
function nearest(key) {
  const hits = [...KEYS].filter(k => k.includes(key) || key.includes(k)).slice(0, 4)
  return hits.length ? ` -- did you mean ${hits.map(k => `\`${k}\``).join(', ')}?` : ''
}

/**
 * A stamper bound to one world and one plot.
 *
 * @param world  the object flatPatch returns: { width, depth, yMin, yTop,
 *               palette, cols }. Mutated in place, deliberately -- this is
 *               called between generation and install, when nothing else has
 *               a reference to it.
 * @param plotId a key of ALL in plots.js: 'omaha', 'road', ...
 *
 * All coordinates passed to the returned object are PLOT-LOCAL: x and z from
 * the plot's north-west corner, y from ground level (y = 0 is the air above
 * the grass, y = -1 is the grass).
 */
export function stamper(world, plotId, opts = {}) {
  const p = typeof plotId === 'string' ? findPlot(plotId) : plotId
  const { x: ox = 0, y: oy = 0, z: oz = 0, label = p.id, forbid = [] } = opts

  const w = width(p)
  const d = depth(p)

  /*
   * State that must be SHARED with any stamper made by `at()` below.
   *
   *   index    key -> palette index, memoised. The palette is a plain array
   *            of keys that island.js turns into engine ids after install, so
   *            adding to it is free; finding a key in it is a linear scan,
   *            which is why the Map exists.
   *   touched  which columns have been cloned out of flatPatch's shared
   *            array. See COPY ON WRITE at the top: without this, one block
   *            placed here is one block placed in all 16384 columns.
   *   placed   the block count, which the spec reads.
   *
   * All three are wrong if `at()` gets its own copy -- two stampers with two
   * `touched` sets clone the same column twice (harmless, wasteful) and two
   * `placed` counters answer "did this build do anything" with half the
   * truth. So they live in one object and the child is handed the object.
   */
  const shared = opts.shared ?? { index: new Map(), touched: new Set(), placed: 0 }
  const { index: indexOf, touched } = shared

  const paletteIndex = (key) => {
    let at = indexOf.get(key)
    if (at !== undefined) return at
    if (!KEYS.has(key)) {
      throw new Error(`[${label}] no such block: ${JSON.stringify(key)}${nearest(key)}`)
    }
    at = world.palette.indexOf(key)
    if (at === -1) at = world.palette.push(key) - 1
    indexOf.set(key, at)
    return at
  }

  /*
   * NO-GO RECTANGLES, in PATCH coordinates, and the inverse of the bounds
   * check below.
   *
   * The bounds check answers "may I write HERE", which is the right question
   * for a build that owns a rectangle. It is the wrong question for the
   * landscape: a winding path legitimately wanders the whole 256 square, so
   * its plot IS the whole square and the check degenerates to "is this on the
   * map". That would leave the seven chapter footprints -- the one thing the
   * owner is going to build in -- protected by nothing but care, which is
   * precisely the belief that is wrong when it is wrong.
   *
   * So `forbid` inverts it: the landscape's stamper is handed the chapter
   * rectangles and throws if a tree, a lamp or a spill of gravel lands in
   * one. Empty for every other build, which is why nothing else changed.
   * PATCH coordinates rather than plot-local, because the rectangles come
   * from the plot table and belong to somebody else's origin.
   */
  const forbidden = (px, pz) => forbid.find(
    r => px >= r.x0 && px <= r.x1 && pz >= r.z0 && pz <= r.z1)

  /** The one write. Every method below funnels through it, so the bounds
   *  check and the copy-on-write exist in exactly one place. */
  function put(x, y, z, key) {
    if (key === null || key === undefined) return          // patterns skip with null
    if (x < 0 || x >= w || z < 0 || z >= d) {
      throw new Error(
        `[${label}] out of plot: local (${x}, ${y}, ${z}) is outside `
        + `0..${w - 1} x 0..${d - 1}. Plot ${p.id} is patch x ${p.x0}..${p.x1}, `
        + `z ${p.z0}..${p.z1} -- see src/builds/plots.js.`)
    }
    const [px, py, pz] = toPatch(p, x, y, z)
    const no = forbid.length ? forbidden(px, pz) : null
    if (no) {
      throw new Error(
        `[${label}] reserved ground: local (${x}, ${y}, ${z}) is patch `
        + `(${px}, ${pz}), inside ${no.id} -- x ${no.x0}..${no.x1}, `
        + `z ${no.z0}..${no.z1}. That plot belongs to somebody else; `
        + `see src/builds/plots.js.`)
    }
    if (py < world.yMin || py > world.yTop) {
      throw new Error(
        `[${label}] out of the world: local y ${y} is absolute y ${py}, `
        + `outside the encoded range ${world.yMin}..${world.yTop}. `
        + `The floor is y = -4 and the build ceiling is y = +64.`)
    }
    const at = pz * world.width + px
    let col = world.cols[at]
    if (!touched.has(at)) { col = Uint16Array.from(col); world.cols[at] = col; touched.add(at) }
    col[py - world.yMin] = paletteIndex(key)
    shared.placed++
  }

  /* Region helpers. `span` normalises a pair of corners so that box([5,..],
   * [2,..]) means the same thing as box([2,..], [5,..]) -- a build file
   * should not have to remember which corner it wrote first. */
  const span = (a, b) => [Math.min(a, b), Math.max(a, b)]

  const api = {
    /** Which plot this stamper may write to, and how big it is. */
    plot: p,
    get size() { return { width: w, depth: d } },
    /** How many blocks this stamper has written. The spec asserts it is
     *  non-zero before it asserts anything about what was written. */
    get placed() { return shared.placed },

    /** One block. */
    set(x, y, z, key) { put(x + ox, y + oy, z + oz, key); return api },

    /** A solid box between two corners, inclusive, in any order. */
    box([x1, y1, z1], [x2, y2, z2], key) {
      const [xa, xb] = span(x1, x2), [ya, yb] = span(y1, y2), [za, zb] = span(z1, z2)
      for (let y = ya; y <= yb; y++)
        for (let z = za; z <= zb; z++)
          for (let x = xa; x <= xb; x++) put(x + ox, y + oy, z + oz, key)
      return api
    },

    /** A box of air. Named rather than `box(..., 'air')` because carving is a
     *  different intent from building and reads differently in a build file. */
    clear(a, b) { return api.box(a, b, 'air') },

    /**
     * A room: four walls, a floor and a ceiling, each independently turned off
     * or given its own block, and the inside optionally filled.
     *
     * @param parts.walls    block for the four sides, or null for none
     * @param parts.floor    block for the bottom face
     * @param parts.ceiling  block for the top face
     * @param parts.inside   block for the volume between them -- normally
     *                       left undefined (untouched) or 'air' (hollowed out
     *                       of something solid)
     *
     * The order matters and is deliberate: walls, then floor, then ceiling.
     * A floor drawn last wins at the corners, which is what you want -- a
     * floorboard running under the wall line reads as a mistake from inside.
     */
    hollow([x1, y1, z1], [x2, y2, z2], { walls, floor, ceiling, inside } = {}) {
      const [xa, xb] = span(x1, x2), [ya, yb] = span(y1, y2), [za, zb] = span(z1, z2)
      if (inside !== undefined) api.box([xa + 1, ya + 1, za + 1], [xb - 1, yb - 1, zb - 1], inside)
      if (walls) {
        api.box([xa, ya, za], [xa, yb, zb], walls)
        api.box([xb, ya, za], [xb, yb, zb], walls)
        api.box([xa, ya, za], [xb, yb, za], walls)
        api.box([xa, ya, zb], [xb, yb, zb], walls)
      }
      if (floor) api.box([xa, ya, za], [xb, ya, zb], floor)
      if (ceiling) api.box([xa, yb, za], [xb, yb, zb], ceiling)
      return api
    },

    /**
     * A straight run between two points. Axis-aligned only, and it throws
     * otherwise rather than guessing at a diagonal -- a voxel diagonal is a
     * staircase of disconnected corners and never once what somebody meant.
     */
    line([x1, y1, z1], [x2, y2, z2], key) {
      const moving = (x1 !== x2) + (y1 !== y2) + (z1 !== z2)
      if (moving > 1) {
        throw new Error(
          `[${label}] line is not axis-aligned: (${x1}, ${y1}, ${z1}) -> (${x2}, ${y2}, ${z2}). `
          + `Use two lines, or box() if you meant a rectangle.`)
      }
      return api.box([x1, y1, z1], [x2, y2, z2], key)
    },

    /** A vertical run: the common case of line(), and the one that reads
     *  worst as two triples. A fence post, a chimney, a lamp. */
    pillar(x, z, yFrom, yTo, key) { return api.box([x, yFrom, z], [x, yTo, z], key) },

    /** A flat horizontal rectangle at one height: a floor, a lawn, a ceiling.
     *  x and z pair up because y is the odd one out here. */
    rect([x1, z1], [x2, z2], y, key) { return api.box([x1, y, z1], [x2, y, z2], key) },

    /**
     * A 2-D drawing, stamped into a plane. The most important method here:
     * it is how anything detailed gets authored so that the source LOOKS like
     * the thing it builds.
     *
     * @param at      [x, y, z] of the drawing's anchor corner
     * @param plane   'xz' a floor plan seen from above -- characters run east
     *                     (+x), rows run south (+z), so the listing is a map
     *                     with north at the top.
     *                'xy' a wall facing north or south -- characters run east,
     *                     rows stack UP the page, so the LAST row is at `at`'s
     *                     y and the drawing is written the way it looks.
     *                'zy' a wall facing east or west -- characters run south,
     *                     rows stack up the page as in 'xy'.
     * @param legend  char -> block key, or char -> null for "leave it alone".
     *                ' ' and '.' mean null unless the legend says otherwise.
     * @param rows    array of strings. Ragged rows are fine; a short row just
     *                stops early, which is what a drawing with a gable in it
     *                naturally looks like.
     *
     * An unlisted character throws, with the row and column that contains it.
     * That is the typo check doing its second job: a `0` where you meant `O`
     * is otherwise a hole in a wall you will find from the outside in a month.
     */
    pattern({ at: [ax, ay, az], plane = 'xy', legend, rows }) {
      const table = { ...BLANK, ...legend }
      const up = plane !== 'xz'
      rows.forEach((row, r) => {
        /* For a vertical plane the FIRST listed row is the TOP one, so the
         * drawing in the source has the same orientation as the wall. For a
         * floor plan there is no up, and the first row is simply nearest. */
        const step = up ? rows.length - 1 - r : r
        ;[...row].forEach((ch, c) => {
          if (!(ch in table)) {
            throw new Error(
              `[${label}] pattern row ${r} column ${c}: character ${JSON.stringify(ch)} `
              + `is not in the legend (${Object.keys(legend).join('')})`)
          }
          const key = table[ch]
          if (key === null) return
          if (plane === 'xz') put(ax + c + ox, ay + oy, az + step + oz, key)
          else if (plane === 'xy') put(ax + c + ox, ay + step + oy, az + oz, key)
          else if (plane === 'zy') put(ax + ox, ay + step + oy, az + c + oz, key)
          else throw new Error(`[${label}] unknown plane ${JSON.stringify(plane)} -- xz, xy or zy`)
        })
      })
      return api
    },

    /**
     * The same plot, with the origin moved.
     *
     * This is what lets a house be written at (0, 0, 0) and then put somewhere
     * -- `const house = s.at(36, 0, 8)` and every wall in the house is written
     * relative to its own front-left corner. Shares the palette cache, the
     * copy-on-write set and the block counter with its parent, so it is a lens
     * on the same stamper rather than a second one.
     */
    at(dx, dy, dz, name = label) {
      return stamper(world, p, { x: ox + dx, y: oy + dy, z: oz + dz, label: name, shared })
    },

    /** Patch coordinates of a plot-local point, for a comment or an error. */
    toPatch: (x, y, z) => toPatch(p, x + ox, y + oy, z + oz),
    /** World coordinates -- what /tp takes -- of a plot-local point. */
    toWorld: (x, y, z) => toWorld(...toPatch(p, x + ox, y + oy, z + oz)),
  }

  return api
}
