/*
 * THE LANDSCAPE: one winding path, one river, one bridge, and six plots
 * that are deliberately empty.
 *
 * ------------------------------------------------------------------------
 * WHAT THE OWNER ASKED FOR, because every decision below is downstream of it:
 * "a road through my life... but it will be a winding path, plots on either
 * side alternating. I'd like the path to be organic and living... Maybe a
 * river with a bridge. Trees on either side, a mix of blocks underneath...
 * more space between them than previously... just build the path and sketch
 * out the plots, no building within the plots other than maybe a sign."
 *
 * So this module builds EVERYTHING EXCEPT the six chapters, and the
 * stamper it uses is handed those six rectangles as no-go zones (see
 * `forbid` in src/builds/stamp.js). If a tree ever lands in Omaha, the world
 * fails to boot rather than quietly taking ground the owner was going to
 * build on.
 * ------------------------------------------------------------------------
 * THE SHAPE OF THE PASS, and why it is a model and then a write.
 *
 * A path that rises and falls has to agree with the ground beside it, the
 * river has to know where the path crosses it so it can be a bridge instead
 * of a drowning, and the trees have to know where both are so they do not
 * stand in the water. Writing blocks as each of those is decided means three
 * passes arguing about the same column.
 *
 * So there is ONE MODEL -- four flat arrays, 65,536 entries each, one per
 * column -- that every step reads and writes, and exactly one step at the end
 * that turns the model into blocks. `kind` is the important one: it is what
 * a column IS, and the writer switches on it.
 *
 * REJECTED -- a per-column object or a Map keyed by "x,z". 65,536 objects to
 * describe a world that is mostly grass, and a string key built three times
 * per column per pass. The arrays are Int8/Uint8 and the whole model is
 * 256KB.
 * ------------------------------------------------------------------------
 * EVERY RANDOM NUMBER HERE IS A HASH OF ITS COORDINATE.
 *
 * `Math.random()` would give a different world on every page load, and this
 * world is regenerated from source every time anybody opens it -- there is no
 * saved terrain. A visitor who walked past a fallen log and came back to find
 * it gone would be right to think the place was broken, and every screenshot
 * in a spec would be of a different world. So the noise is `hash(x, z, salt)`:
 * pure, seeded by the coordinate, identical forever.
 */
import { stamper } from './stamp.js'
import { GROUND_Y, LAND_SIZE, LAND, CHAPTERS, LAND_SPAWN_X, LAND_SPAWN_Z } from './plots.js'
import { SPINE, sampleSpine } from './spine.js'
import { carveRiver, buildBridge } from './river.js'
import { drawPath, drawSpurs, lampPosts } from './path.js'
import { plantForest } from './flora.js'
import { markChapters } from './chapters.js'

/** What a column is. The writer switches on it and so does every step after
 *  the one that set it. */
export const KIND = {
  FIELD: 0,    // untouched grass, or whatever flora put on top of it
  PATH: 1,     // the walked surface
  SPUR: 2,     // a branch off it, to a chapter
  BRIDGE: 3,   // path over water: a deck, with the river still underneath
  WATER: 4,    // river, two deep
  SHALLOW: 5,  // river, one deep -- the reason you can always climb out
  BANK: 6,     // gravel and sand at the water's edge
  PLOT: 7,     // a chapter footprint. Nothing in this file may write here.
}

/**
 * A hash of two integers and a salt, in [0, 1). Deterministic, and that is
 * the whole requirement -- this is not cryptography and it is not even good
 * noise, it is a cheap repeatable scatter.
 */
export function hash(x, z, salt = 0) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/**
 * Smooth value noise in [0, 1), so that a palette comes out in CLUMPS rather
 * than as static. The brief asked for "clumps, not noise" in as many words,
 * and a per-column hash gives you exactly the salt-and-pepper it was warning
 * against -- every block a different block. Bilinear interpolation between
 * hashed lattice points at `scale` blocks apart is the cheapest thing that
 * makes a patch of podzol be a PATCH.
 */
export function smoothNoise(x, z, scale, salt = 0) {
  const fx = x / scale, fz = z / scale
  const x0 = Math.floor(fx), z0 = Math.floor(fz)
  const tx = fx - x0, tz = fz - z0
  // Smoothstep, so the lattice does not show as a grid of diamonds.
  const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz)
  const a = hash(x0, z0, salt), b = hash(x0 + 1, z0, salt)
  const c = hash(x0, z0 + 1, salt), d = hash(x0 + 1, z0 + 1, salt)
  return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz
}

/** Column index. The model's arrays are all indexed this way, and so is
 *  world.cols, which is why it is z-major. */
export const at = (x, z) => z * LAND_SIZE + x
export const onMap = (x, z) => x >= 0 && x < LAND_SIZE && z >= 0 && z < LAND_SIZE

/**
 * THE SPAWN CLEARING, and it is the one piece of this landscape that exists
 * for the test suite rather than for the visitor.
 *
 * Two specs build rigs out of `setBlock` near spawn (17-non-cube, 66-torch)
 * and every "teleport up and fall" spec drops down the column four blocks
 * west of it (DROP_X/DROP_Z in test/helpers/world.js). All of them assume
 * flat ground at SURFACE_Y - 1 with open sky above. A tree, a lamp post or a
 * path that rises a block would break specs that have nothing to do with
 * this landscape, in ways whose cause is three files away from the failure.
 *
 * So: inside 10 blocks of spawn the path is DEAD FLAT, and inside 8 blocks
 * nothing at all stands above the ground. The path still runs through it --
 * you arrive standing on it, which is the point -- but a path surface
 * REPLACES the grass at the same height rather than sitting on top of it, so
 * a rig built at spawn sees exactly the ground it saw before.
 */
export const SPAWN_FLAT = 10
export const SPAWN_CLEAR = 8
export function nearSpawn(x, z, r) {
  return Math.hypot(x - LAND_SPAWN_X, z - LAND_SPAWN_Z) <= r
}

/** A fresh model: every column is flat field until something says otherwise. */
function emptyModel() {
  const n = LAND_SIZE * LAND_SIZE
  return {
    /** Ground height, relative to the grass. The TOP SOLID BLOCK of a column
     *  sits at local y = h - 1, so h = 0 is the world as generated. */
    h: new Int8Array(n),
    /** KIND, above. */
    kind: new Uint8Array(n),
    /** The block to put on top, or null to leave the grass alone. A parallel
     *  plain array rather than a palette index, because the stamper wants
     *  keys and resolving them is its job. */
    surface: new Array(n).fill(null),
    /** River bed depth in blocks (1 or 2), for the columns that have one. */
    depth: new Uint8Array(n),
  }
}

/*
 * THE HEIGHT FEATHER, which is what stops a path that rises from reading as a
 * wall.
 *
 * The path carries its own height. If nothing else moved, a stretch at h = +2
 * would be a two-block kerb with a cliff on each side -- worse than flat,
 * because at least flat looks deliberate. So every column within four of a
 * raised or sunken path takes a fraction of its height, falling off linearly,
 * and the result is a low mound the path runs over the top of.
 *
 * SIX BLOCKS, and it was four until a screenshot at the top of the rise
 * showed the difference. The feather rounds to whole blocks, so its width
 * decides how many TERRACES a rise has: four blocks of falloff on a one-block
 * rise is one step and reads as a mound, four on a two-block rise is two
 * steps and reads as a staircase somebody built. Six is gentle enough that a
 * one-block rise has no visible edge at all from the path. Not ten, because
 * every column it touches is a column cloned out of the shared superflat
 * array, and this pass already walks 65,536 of them.
 */
const FEATHER = 6
function feather(model) {
  const src = []
  for (let i = 0; i < model.h.length; i++) if (model.h[i] !== 0) src.push(i)
  for (const i of src) {
    const h = model.h[i]
    const x0 = i % LAND_SIZE, z0 = (i / LAND_SIZE) | 0
    for (let dz = -FEATHER; dz <= FEATHER; dz++) {
      for (let dx = -FEATHER; dx <= FEATHER; dx++) {
        const x = x0 + dx, z = z0 + dz
        if (!onMap(x, z)) continue
        const d = Math.hypot(dx, dz)
        if (d > FEATHER || d === 0) continue
        const j = at(x, z)
        const k = model.kind[j]
        // Never lift a plot, a river or the spawn clearing.
        if (k === KIND.PLOT || k === KIND.WATER || k === KIND.SHALLOW || k === KIND.BANK) continue
        if (nearSpawn(x, z, SPAWN_FLAT)) continue
        const want = Math.round(h * (1 - d / (FEATHER + 1)))
        if (Math.abs(want) > Math.abs(model.h[j])) model.h[j] = want
      }
    }
  }
}

/*
 * THE GROUND PALETTE.
 *
 * The brief: "a mix of blocks underneath... coarse dirt, podzol, gravel,
 * andesite, dirt path, with occasional stone and moss. Scatter them
 * irregularly -- clumps, not noise." There is no dirt_path block in this
 * game (169 keys, no non-cube plants and no path block), so the worn look
 * has to come from the MIX rather than from one texture: coarse dirt and
 * rooted dirt carry most of it, gravel reads as the worn middle, andesite
 * and stone as the bones of the hill coming through, moss as the wet edge.
 *
 * Two noise fields at different scales, so the answer is neither a checker
 * nor a gradient: a slow one picks the region's character, a fast one breaks
 * it up inside the region.
 *
 * THE THRESHOLDS MOVED ONCE, after the first screenshot from spawn: stone and
 * andesite together held a quarter of the surface and the path read as a
 * PAVED ROAD -- which is the thing it is replacing. Stone is down to a
 * sliver, and the ground the walker mostly sees is worn dirt.
 */
function pathSurface(x, z) {
  const slow = smoothNoise(x, z, 17, 101)
  const fast = smoothNoise(x, z, 4.5, 202)
  const v = slow * 0.65 + fast * 0.35
  if (v < 0.32) return 'coarse_dirt'
  if (v < 0.47) return 'rooted_dirt'
  if (v < 0.58) return 'dirt'
  if (v < 0.70) return 'gravel'
  if (v < 0.80) return 'coarse_dirt'
  if (v < 0.88) return 'andesite'
  if (v < 0.94) return 'podzol'
  return 'moss_block'
}

/**
 * Turn the model into blocks. The only place in this pass that writes ground.
 *
 * A column with height h has its top solid block at local y = h - 1, which is
 * where the generator already put the grass when h = 0. So raising means
 * filling up to it and lowering means clearing down to it, and the common
 * case -- h = 0, surface = null -- writes nothing at all. That is what keeps
 * a 65,536-column pass from cloning all 65,536 columns: only the ones that
 * actually differ from superflat are touched.
 */
function writeGround(s, model) {
  for (let z = 0; z < LAND_SIZE; z++) {
    for (let x = 0; x < LAND_SIZE; x++) {
      const i = at(x, z)
      const kind = model.kind[i]
      if (kind === KIND.PLOT) continue                    // not ours to write
      const h = model.h[i]
      const surf = model.surface[i]
      if (kind === KIND.WATER || kind === KIND.SHALLOW) {
        const d = model.depth[i]
        s.set(x, -1 - d, z, surf ?? 'gravel')             // the bed
        for (let y = -d; y <= -1; y++) s.set(x, y, z, 'water')
        continue
      }
      /*
       * A BRIDGE COLUMN IS BOTH THINGS AT ONCE: the river underneath it,
       * unbroken, and a deck over the top. Writing the deck without the water
       * would leave a plank lid on a hole, and writing the generic ground
       * branch would fill the river with dirt up to the path's height -- a
       * dam, which is what the first version of this did.
       */
      if (kind === KIND.BRIDGE) {
        const d = model.depth[i] || 2
        s.set(x, -1 - d, z, 'gravel')
        for (let y = -d; y <= -1; y++) s.set(x, y, z, 'water')
        s.set(x, h - 1, z, 'planks')
        continue
      }
      if (h === 0 && surf === null) continue
      // Raise: dirt up to just under the surface, then the surface itself.
      for (let y = -1; y <= h - 2; y++) s.set(x, y, z, 'dirt')
      // Lower: clear what the generator left above the new top.
      for (let y = h; y <= -1; y++) s.set(x, y, z, 'air')
      s.set(x, h - 1, z, surf ?? 'grass')
    }
  }
}

/**
 * Build the whole overworld landscape into a freshly generated patch.
 *
 * Same contract as `stampBuilds`: called from flatPatch at the one moment the
 * world is mutable, mutates in place, returns the world. The geometry check
 * is the same check and for the same reason -- a landscape written in patch
 * indices into a world of the wrong size is a path that walks off the map.
 *
 * @param world    flatPatch's output
 * @param surfaceY the y the generator put the ground at
 */
export function stampLand(world, surfaceY) {
  if (world.width !== LAND_SIZE || world.depth !== LAND_SIZE || surfaceY !== GROUND_Y) {
    throw new Error(
      `stampLand: the overworld survey in src/builds/plots.js describes a `
      + `${LAND_SIZE}x${LAND_SIZE} patch with its ground at y=${GROUND_Y}; this world is `
      + `${world.width}x${world.depth} with ground at y=${surfaceY}.`)
  }

  const model = emptyModel()

  /*
   * ORDER MATTERS AND THIS IS THE ORDER.
   *
   *   1. The chapters go in FIRST, as no-go paint. Everything after this can
   *      ask "is this column spoken for" and get a true answer.
   *   2. The river second, because the path needs to know where the water is
   *      before it can decide to be a bridge.
   *   3. The path, then its spurs, which read PLOT to know where to stop.
   *   4. The feather, once, over whatever heights steps 2-4 left behind.
   *   5. The write. Nothing above this line has placed a block.
   *   6. Everything that STANDS ON the ground -- the bridge, the lamps, the
   *      forest -- after the ground exists, because they read the finished
   *      heights to know what to stand on.
   */
  for (const c of CHAPTERS) {
    for (let z = c.z0; z <= c.z1; z++) {
      for (let x = c.x0; x <= c.x1; x++) model.kind[at(x, z)] = KIND.PLOT
    }
  }

  const samples = sampleSpine(SPINE)
  carveRiver(model)
  drawPath(model, samples, pathSurface)
  drawSpurs(model, samples, pathSurface)
  feather(model)

  /*
   * THE LANDSCAPE'S STAMPER, and the `forbid` list is the whole reason the
   * stamper grew the feature. Its plot is the entire 256 square -- a winding
   * path has no smaller honest bounding box -- so the six chapters are
   * passed as rectangles it must not write into, and the guard that used to
   * mean "stay inside your plot" now means "stay out of theirs".
   */
  const s = stamper(world, LAND, { forbid: CHAPTERS })
  writeGround(s, model)
  buildBridge(s, model, samples)
  lampPosts(s, model, samples)
  plantForest(s, model)

  /* And the chapters themselves: each gets its own stamper bound to its own
   * rectangle, which is the ordinary bounds check doing its ordinary job. The
   * marker, the border and the levelled ground -- nothing inside. */
  markChapters(world, model)

  return world
}

/** For the spec and the console: what the overworld survey allocates. */
export const landRegistry = () => [LAND, ...CHAPTERS].map(p => ({
  id: p.id, label: p.label, x: [p.x0, p.x1], z: [p.z0, p.z1],
}))
