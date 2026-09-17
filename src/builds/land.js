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
import { hash, smoothNoise } from './noise.js'
import { GROUND_Y, LAND_SIZE, LAND, CHAPTERS, LAND_SPAWN_X, LAND_SPAWN_Z } from './plots.js'
import { SPINE, sampleSpine } from './spine.js'
import { carveRiver, carveIsland, bridgeToIsland, buildBridge } from './river.js'
import { drawPath, drawSpurs, lampPosts, spurCurves } from './path.js'
import { plantForest } from './flora.js'
import { markChapters } from './chapters.js'
import { biomeField, groundOf, subsurfaceOf, reliefAt, mayBeSteep } from './biomes.js'

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

/*
 * The noise, re-exported. It MOVED to src/builds/noise.js, which has no
 * imports, so that the biome map can be read by a spec running in node --
 * this file reaches Babylon through the stamper and nothing that imports it
 * can be loaded outside a browser. Re-exported rather than relocated in every
 * caller, because river.js, path.js, flora.js and chapters.js all take them
 * from here and none of them cares where they came from.
 */
export { hash, smoothNoise } from './noise.js'

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
    /** What `h` was before the path touched it -- the LANDSCAPE's height, as
     *  opposed to the walked surface's. The feather needs the difference
     *  between the two and cannot recover it from `h` alone, because a column
     *  the path has raised and a column the hills have raised look identical
     *  once they are both just numbers. */
    ground: new Int8Array(n),
    /** KIND, above. */
    kind: new Uint8Array(n),
    /** The block to put on top, or null to leave the grass alone. A parallel
     *  plain array rather than a palette index, because the stamper wants
     *  keys and resolving them is its job. */
    surface: new Array(n).fill(null),
    /** River bed depth in blocks (1 or 2), for the columns that have one. */
    depth: new Uint8Array(n),
    /** Which biome the column is in, and how far it is from the nearest
     *  biome border (0 at the border, 1 well inside). Filled by the biome
     *  pass, read by the ground pass, the relief and the forest -- three
     *  passes that must not be allowed to disagree about where birch stops,
     *  which is the whole reason it is one array and not three calls. */
    biome: new Uint8Array(n),
    /*
     * THE UN-DITHERED BIOME, and it is a separate array because of a real
     * bug rather than for tidiness.
     *
     * `biome` is what a column LOOKS like, after the border dither has had
     * its say. `biomeNear` is what region the column is IN. The distinction
     * does not matter for a palette -- the whole point of the dither is that
     * a birch stands in the oak wood -- and it matters enormously for LAND
     * SHAPE: the first version took the summit cone from the dithered biome,
     * so every windswept-hills column that the dither had scattered across
     * the mountain got no cone at all, sat twenty blocks below its
     * neighbours, and the slope clamp then dragged the whole massif down to
     * meet them. The mountain measured 14 blocks instead of 25 and nothing
     * in the code said why.
     *
     * The rule that came out of it: A DITHER IS A PAINT JOB. Anything that
     * decides where the ground IS reads `biomeNear`; anything that decides
     * what it is made of reads `biome`.
     */
    biomeNear: new Uint8Array(n),
    gap: new Float32Array(n),
    /*
     * WHICH COLUMNS ALREADY HAVE SOMETHING GROWING IN THEM.
     *
     * The forest pass plants trunks and bamboo stalks, and then the ground
     * cover pass walks the same map putting bushes, logs and young cane on
     * it. Neither knew about the other, which was invisible while everything
     * involved was one block tall and stopped being invisible the day bamboo
     * became a real plant: a young two-block shoot landed in a column a
     * mature stalk already occupied, and the result was a stalk with LEAVES
     * IN THE MIDDLE OF IT -- which is the one thing vanilla's own bamboo rule
     * says cannot happen.
     */
    standing: new Uint8Array(n),
    /** What a RAISED column is filled with under its surface block. Dirt
     *  everywhere a meadow would have dirt; stone where a mountain would have
     *  stone, because a twenty-block dirt cliff with a snow hat on it is what
     *  the first version of the peaks looked like from the path. */
    sub: new Array(n).fill(null),
  }
}

/*
 * THE BIOME PASS. Paints the ground and nothing else: no height, no plants,
 * no water. It runs FIRST of the writers-to-`surface` so that everything with
 * a stronger claim on a column -- the river bed, the bank, the worn path --
 * simply overwrites it afterwards, in the order those passes already run.
 *
 * Plots are skipped rather than painted-and-ignored. It is the same answer
 * either way (writeGround refuses KIND.PLOT) and this way the array says what
 * the world says.
 */
function paintBiomes(model) {
  const field = biomeField()
  model.biome = field.id
  model.biomeNear = field.near
  model.gap = field.gap
  for (let i = 0; i < model.kind.length; i++) {
    if (model.kind[i] === KIND.PLOT) continue
    const x = i % LAND_SIZE, z = (i / LAND_SIZE) | 0
    model.surface[i] = groundOf(field.id[i], x, z, model.h[i])
    model.sub[i] = subsurfaceOf(field.near[i])
  }
}

/** Re-ask the biome for the surface of every untouched column, now that its
 *  height is final. See the call site for why this is worth a second pass. */
function repaintByHeight(model) {
  for (let i = 0; i < model.kind.length; i++) {
    if (model.kind[i] !== KIND.FIELD) continue
    const x = i % LAND_SIZE, z = (i / LAND_SIZE) | 0
    model.surface[i] = groundOf(model.biome[i], x, z, model.h[i])
  }
}

/*
 * HOW FAR A COLUMN IS FROM THE WALK, and it is the number the whole relief
 * pass turns on.
 *
 * A chamfer distance transform -- two sweeps, 3 for a step and 4 for a
 * diagonal, which approximates Euclidean to about 2% and costs two passes
 * over the array instead of a search per column. Seeded with the spine
 * samples AND the spur centrelines, because a spur is walked too and terrain
 * rising across one is a hill on the stretch of the walk that is supposed to
 * be an invitation.
 *
 * REJECTED -- the dilation in src/builds/flora.js, which is the same idea and
 * is capped at 7. The relief needs to know about 30 blocks of falloff and a
 * 61x61 stamp per seed column is thirty times the work of two sweeps.
 */
export const WALK_REACH = 40
function walkDistance(samples, spurs) {
  const n = LAND_SIZE * LAND_SIZE
  const d = new Int32Array(n).fill(1 << 20)
  const seed = (x, z) => {
    const px = Math.round(x), pz = Math.round(z)
    if (onMap(px, pz)) d[at(px, pz)] = 0
  }
  for (const s of samples) seed(s.x, s.z)
  for (const { points } of spurs) for (const p of points) seed(p.x, p.z)

  const relax = (i, j, w) => { if (d[j] + w < d[i]) d[i] = d[j] + w }
  for (let z = 0; z < LAND_SIZE; z++) {
    for (let x = 0; x < LAND_SIZE; x++) {
      const i = at(x, z)
      if (x > 0) relax(i, i - 1, 3)
      if (z > 0) relax(i, i - LAND_SIZE, 3)
      if (x > 0 && z > 0) relax(i, i - LAND_SIZE - 1, 4)
      if (x < LAND_SIZE - 1 && z > 0) relax(i, i - LAND_SIZE + 1, 4)
    }
  }
  for (let z = LAND_SIZE - 1; z >= 0; z--) {
    for (let x = LAND_SIZE - 1; x >= 0; x--) {
      const i = at(x, z)
      if (x < LAND_SIZE - 1) relax(i, i + 1, 3)
      if (z < LAND_SIZE - 1) relax(i, i + LAND_SIZE, 3)
      if (x < LAND_SIZE - 1 && z < LAND_SIZE - 1) relax(i, i + LAND_SIZE + 1, 4)
      if (x > 0 && z < LAND_SIZE - 1) relax(i, i + LAND_SIZE - 1, 4)
    }
  }
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = Math.min(WALK_REACH, Math.round(d[i] / 3))
  return out
}

/*
 * THE RELIEF, and the one decision it rests on: THE GROUND RISES BESIDE THE
 * WALK, NEVER ACROSS IT.
 *
 * "Yes, should have a bit of hills and terraforming. Nothing crazy steep and
 * dont change the plots." Two of those three are easy. The third -- nothing
 * crazy steep -- is at war with a jagged-peaks chapter, and the way out is
 * not to make the mountain small. It is to put it beside the path: the relief
 * is multiplied by a fade that is 0 within WALK_FLAT blocks of the walked
 * surface and 1 at WALK_FULL, so the walk is a level corridor through
 * whatever the biome is doing, and the biome gets to do it at full height
 * twenty blocks away where you can see it rather than climb it.
 *
 * REJECTED -- letting the path follow the terrain, which is what a real
 * footpath does and what the spine's own +/-1 height already does at small
 * scale. Over eight blocks of hill it means a one-block riser every few
 * columns, and a one-block riser in this engine is a JUMP: full cubes are on
 * noa's swept path with no step-up at all (src/blockMeshes.js rejects
 * `body.autoStep` on purpose, because it would let you walk up the parkour).
 * A walk that needs the space bar is not the walk the owner asked for.
 */
const WALK_FLAT = 5
const WALK_FULL = 27
function shapeRelief(model) {
  for (let i = 0; i < model.h.length; i++) {
    if (model.kind[i] === KIND.PLOT) continue          // plots stay at y = 136
    const x = i % LAND_SIZE, z = (i / LAND_SIZE) | 0
    if (nearSpawn(x, z, SPAWN_FLAT)) continue
    const fade = Math.max(0, Math.min(1,
      (model.walk[i] - WALK_FLAT) / (WALK_FULL - WALK_FLAT)))
    model.h[i] = reliefAt(model.biomeNear[i], x, z, fade)
  }
}

/*
 * THE SLOPE CLAMP, which is what the word "gentle" actually means here.
 *
 * Noise does not know about the things standing in it. A hillside is free to
 * rise four blocks in one column, to end in a cliff against a plot that has
 * to be flat, or to drop into the river. So after everything that sets a
 * height has had its say, one rule is enforced over the whole field: NO TWO
 * NEIGHBOURING COLUMNS MAY DIFFER BY MORE THAN ONE BLOCK, except in the
 * peaks well away from the walk, where three is allowed and the mountain gets
 * to have some edge to it.
 *
 * PINNED COLUMNS ARE THE BOUNDARY CONDITION and they are the interesting
 * half. A plot is pinned at 0 because its footprint must stay dead flat at
 * y = 136 -- Millard North is standing on chapter 1's and the owner has
 * approved it. Water is pinned at 0 because a river bed that moved would be a
 * river that leaks. Spawn is pinned because two specs build `setBlock` rigs
 * there. The path is pinned on the second pass so the clamp tidies the ground
 * around the walk rather than tidying the walk. Everything else is free, and
 * the clamp resolves it into a ramp.
 *
 * REJECTED -- a Gaussian blur of the height field, which is the usual way to
 * make terrain gentle. A blur is a statement about average slope and this
 * needs a statement about the WORST one; it also cannot be told to leave a
 * plot alone, so it would round the corners of every flat footprint in the
 * world. The clamp says exactly the thing the spec asserts, which is why the
 * spec can assert it.
 *
 * REJECTED -- a one-shot cone cap (for each column, the lowest of
 * pinnedHeight + distance). It is a single pass and it only constrains
 * columns against PINNED ones; two free columns next to each other could
 * still be a cliff, which is precisely the case a mountain produces.
 */
const CLAMP_ROUNDS = 40
/*
 * For the console and for anybody tuning this: one entry per clamp, saying
 * how many rounds it needed and how many columns it was still moving when it
 * stopped. A non-zero `moved` means the field did NOT settle -- two pinned
 * columns are asking for something impossible -- and the world will have a
 * cliff in it somewhere. Both passes currently settle in one or two rounds.
 */
export const clampStats = { rounds: 0, moved: 0, log: [] }

function clampSlope(model, pinned) {
  const n = model.h.length
  const h = model.h

  /*
   * HOW BIG A STEP EACH COLUMN IS ALLOWED, and the two exceptions are both
   * about the things a person stands on.
   *
   * A PINNED COLUMN IS ALWAYS GENTLE. Its own height cannot move, so the only
   * way the ground beside a plot, a river bank or the path can be made to
   * agree with it is for the ground to come down -- and three blocks of cliff
   * at the edge of a flat footprint is exactly the thing the owner meant by
   * "nothing crazy steep". The first version allowed the peaks their three
   * blocks right up against chapter 6's border and left a five-block drop
   * there, which the clamp then could not resolve at all: the uphill
   * neighbour and the plot were pulling the same column two ways and it
   * oscillated for forty rounds.
   *
   * AND SO IS ANYTHING NEAR A PLOT, six blocks out, for the same reason one
   * block further on.
   */
  const step = new Uint8Array(n).fill(1)
  const nearPlot = dilate(model, KIND.PLOT, 6)
  for (let i = 0; i < n; i++) {
    if (pinned[i] || nearPlot[i]) continue
    if (mayBeSteep(model.biomeNear[i], model.walk[i] >= WALK_FULL ? 1 : 0)) step[i] = 3
  }

  let moved = 0
  for (let round = 0; round < CLAMP_ROUNDS; round++) {
    moved = 0
    /* Four sweep orders. One direction propagates a constraint one column per
     * round; alternating them carries it the length of a hillside in two. */
    for (const [sx, sz] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      for (let k = 0; k < LAND_SIZE; k++) {
        const z = sz > 0 ? k : LAND_SIZE - 1 - k
        for (let m = 0; m < LAND_SIZE; m++) {
          const x = sx > 0 ? m : LAND_SIZE - 1 - m
          const i = at(x, z)
          if (pinned[i]) continue
          /*
           * ALL FOUR NEIGHBOURS AT ONCE, and the bug that makes it worth
           * saying: applying them one at a time lets the LAST one win. A
           * column between a mountain and a plot was set to the mountain's
           * limit, then to the plot's, then back -- and which one it ended on
           * was decided by the order of the array literal. Taking the
           * tightest window over all four and clamping once is the same rule
           * stated in a way that has no order in it.
           */
          let lo = -128, hi = 127
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, nz = z + dz
            if (!onMap(nx, nz)) continue
            const j = at(nx, nz)
            const s2 = Math.min(step[i], step[j])
            if (h[j] - s2 > lo) lo = h[j] - s2
            if (h[j] + s2 < hi) hi = h[j] + s2
          }
          /* lo > hi means two neighbours this column cannot both satisfy --
           * two pinned ones further apart than the rule allows. Take the
           * ceiling, because the failure that matters is a cliff standing
           * over something flat, not a dip beside it. */
          const want = lo > hi ? hi : Math.max(lo, Math.min(hi, h[i]))
          if (want !== h[i]) { h[i] = want; moved++ }
        }
      }
    }
    clampStats.rounds = round + 1
    if (moved === 0) break
  }
  clampStats.moved = moved
  clampStats.log.push({ rounds: clampStats.rounds, moved })
  return moved
}

/** A boolean mask of every column within `r` of a column of kind `k`. The
 *  chamfer transform above would do this too; a stamp is simpler and this is
 *  called on a few thousand seeds rather than a few tens of thousands. */
function dilate(model, kind, r) {
  const out = new Uint8Array(model.kind.length)
  for (let z = 0; z < LAND_SIZE; z++) {
    for (let x = 0; x < LAND_SIZE; x++) {
      if (model.kind[at(x, z)] !== kind) continue
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const px = x + dx, pz = z + dz
          if (onMap(px, pz) && Math.hypot(dx, dz) <= r) out[at(px, pz)] = 1
        }
      }
    }
  }
  return out
}

/** Which columns the clamp may not move, and what they are held at. Water and
 *  plots are held at 0; whatever else is passed in keeps the height it has. */
function pinnedColumns(model, alsoWalked) {
  const n = model.h.length
  const pin = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const k = model.kind[i]
    const x = i % LAND_SIZE, z = (i / LAND_SIZE) | 0
    if (k === KIND.PLOT || k === KIND.WATER || k === KIND.SHALLOW || k === KIND.BANK) {
      model.h[i] = 0
      pin[i] = 1
    } else if (nearSpawn(x, z, SPAWN_FLAT)) {
      model.h[i] = 0
      pin[i] = 1
    } else if (alsoWalked && (k === KIND.PATH || k === KIND.SPUR || k === KIND.BRIDGE)) {
      pin[i] = 1
    }
  }
  return pin
}

/*
 * THE HEIGHT FEATHER, which is what stops a path that rises from reading as a
 * wall.
 *
 * The path carries its own height ON TOP OF the landscape's. If nothing else
 * moved, a stretch a block above the ground beside it would be a kerb with a
 * cliff on each side -- worse than flat, because at least flat looks
 * deliberate. So every column within six of a raised or sunken path takes a
 * fraction of the DIFFERENCE, falling off linearly, and the result is a low
 * mound the path runs over the top of.
 *
 * IT IS THE DIFFERENCE AND NOT THE HEIGHT, which is the one thing that
 * changed when the landscape grew hills. Feathering the absolute height would
 * have every hillside within six blocks of the path dragged toward the path's
 * own level, which is a trench. `model.ground` is the landscape's answer and
 * the feather only ever spreads what the path added to it.
 *
 * SIX BLOCKS, and it was four until a screenshot at the top of the rise
 * showed the difference. The feather rounds to whole blocks, so its width
 * decides how many TERRACES a rise has: four blocks of falloff on a one-block
 * rise is one step and reads as a mound, four on a two-block rise is two
 * steps and reads as a staircase somebody built.
 */
const FEATHER = 6
function feather(model) {
  const src = []
  for (let i = 0; i < model.h.length; i++) {
    if (model.h[i] !== model.ground[i]) src.push(i)
  }
  for (const i of src) {
    const delta = model.h[i] - model.ground[i]
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
        const want = model.ground[j] + Math.round(delta * (1 - d / (FEATHER + 1)))
        if (Math.abs(want - model.ground[j]) > Math.abs(model.h[j] - model.ground[j])) {
          model.h[j] = want
        }
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
      // Raise: fill up to just under the surface, then the surface itself.
      const fill = model.sub[i] ?? 'dirt'
      for (let y = -1; y <= h - 2; y++) s.set(x, y, z, fill)
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
   *   1b. The biomes, which paint the ground and claim nothing. Every pass
   *      after this one overwrites the columns it owns, so the biome is what
   *      is left where nothing else had a claim -- which is most of the map.
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
  const spurs = spurCurves(samples)
  model.walk = walkDistance(samples, spurs)
  paintBiomes(model)

  /* The landscape's own height, then the water cut into it, then the clamp
   * that turns noise into something a person can walk on. The order is forced:
   * the river must be carved before the clamp so its bed is one of the
   * clamp's pinned boundaries, and the clamp must run before the path so the
   * path is laid on ground that has already stopped moving. */
  shapeRelief(model)
  carveRiver(model)
  /* The island's loop is cut off the river, so the river has to exist first
   * -- where the two meet, the loop overwrites the river's bank and the join
   * is water to water rather than a dam across the channel. */
  carveIsland(model)
  bridgeToIsland(model)
  clampSlope(model, pinnedColumns(model, false))
  model.ground.set(model.h)

  drawPath(model, samples, pathSurface)
  drawSpurs(model, samples, pathSurface)
  feather(model)
  /* And again, with the walk pinned: the first clamp made the landscape
   * gentle, this one makes the ground the path just moved agree with it. */
  clampSlope(model, pinnedColumns(model, true))

  /*
   * THE LANDSCAPE'S STAMPER, and the `forbid` list is the whole reason the
   * stamper grew the feature. Its plot is the entire 256 square -- a winding
   * path has no smaller honest bounding box -- so the six chapters are
   * passed as rectangles it must not write into, and the guard that used to
   * mean "stay inside your plot" now means "stay out of theirs".
   */
  /* The hills and the peaks choose their surface BY ALTITUDE -- bare stone on
   * the shoulders, snow on the tops -- and until the clamp had run there was
   * no altitude to choose by. So the biome ground is painted twice: once
   * before anything else, cheaply, so the river and the path have something
   * to overwrite, and once here where the heights are final. Only FIELD
   * columns are repainted; anything the water or the walk claimed keeps what
   * that pass gave it. */
  repaintByHeight(model)

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
