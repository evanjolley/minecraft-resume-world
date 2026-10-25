/*
 * THE LANDSCAPE: the whole overworld except what stands inside the six
 * chapter plots, generated from source on every load.
 *
 * ------------------------------------------------------------------------
 * WHAT THE OWNER ASKED FOR, and every decision below is downstream of it.
 * First: "a road through my life... a winding path, plots on either side
 * alternating... a river with a bridge. Trees on either side." Then, in
 * Sprint 1: "The world looks like real Minecraft. The landscape between
 * plots reads as random noise today. It is flat, the trees look bad... Make
 * it believable: real vanilla tree shapes, rolling terrain, believable
 * biomes, water, flowers, grass, the works."
 *
 * So this is a small terrain generator in the shape of vanilla's, run in
 * order:
 *
 *   1. PLOTS       the six chapters are marked first. Nothing below may
 *                  change a column inside one; they stay flat at GROUND_Y.
 *   2. LAND        a height for every column: the biome's base and
 *                  roughness (soft-blended, src/builds/biomes.js) times
 *                  rolling and ridged gradient noise (src/builds/noise.js).
 *   3. WATER       the river, the lake and New York's moat, cut to one
 *                  water level, with banks that come down to meet it
 *                  (src/builds/river.js).
 *   4. PADS        the land eases down to plot level over PAD blocks round
 *                  every plot, and round spawn.
 *   5. WALK        the path and its spurs, which take their height from the
 *                  land, smoothed and graded (src/builds/path.js), and the
 *                  land beside them blended to meet them.
 *   6. SURFACE     what each column is made of: grass over three or four
 *                  dirt over stone, sand at the water, stone on the cliffs
 *                  and snow on the peaks.
 *   7. WRITE       every column, straight into one buffer.
 *   8. FEATURES    bridges, steps, lamps, then everything that grows
 *                  (src/builds/flora.js, src/builds/trees.js).
 *
 * The chapters' own contents are stamped afterwards by
 * src/builds/overworld.js, which is the browser half of this file.
 * ------------------------------------------------------------------------
 * WHY THIS FILE HAS NO BROWSER IMPORTS, which it used to.
 *
 * It used to write through the stamper, which validates block keys against
 * src/blocks.js, which reaches Babylon. That made the landscape impossible
 * to run anywhere but a page: not in node to measure it, not in a spec, not
 * in a worker. The guarantee the stamper gave the landscape -- never write
 * inside a plot -- is now the voxel writer's (see `writer` below), and the
 * key check happens where it always ultimately did: island.js reports every
 * palette key the engine does not know, and test/01-world.spec.js asserts
 * that list is empty.
 * ------------------------------------------------------------------------
 * EFFICIENCY, because this runs on every page load and the world grew.
 *
 * The world is 288 x 400 (1.76 times the old 256 x 256) and four blocks
 * deeper, and it generates faster than the old one did. The decisions that
 * buy it:
 *
 *   - ONE Uint16Array for the whole world, and `cols` are subarray views
 *     into it. The old pass cloned a shared column the first time it wrote
 *     to it -- a Set lookup and an allocation per column per write -- and
 *     scanned the six-entry forbid list on every block.
 *   - Columns are written with `fill` over runs (stone, then dirt), not a
 *     call per block.
 *   - Distances (to the walk, to water) are chamfer transforms, two sweeps
 *     each, not per-column searches.
 *   - Soft biome weights on a 4-block grid (see biomes.js).
 *
 * Measured numbers are in docs/builds/README.md's overworld section.
 * ------------------------------------------------------------------------
 * EVERY RANDOM NUMBER HERE IS A FUNCTION OF ITS COORDINATE. The world is
 * regenerated from source on every load and must be the same world.
 */
import { hash, smoothNoise, fbm, ridged, smoothstep } from './noise.js'
import { GROUND_Y, LAND_W, LAND_D, CHAPTERS, LAND_SPAWN_X, LAND_SPAWN_Z, SIGHT_LINES } from './plots.js'
import { SPINE, sampleSpine } from './spine.js'
import { carveWater, WATER_Y, SHORE_H, toRect } from './river.js'
import {
  rasterPath, rasterSpurs, spurCurves, walkProfile, walkHeights, settleWalk, steps, lampPosts,
  pathSurface, nearSpawn, SPAWN_FLAT, SPAWN_CLEAR,
} from './path.js'
import { plantAll } from './flora.js'
import { biomeField, BIOME } from './biomes.js'

export { hash, smoothNoise } from './noise.js'
export { WATER_Y } from './river.js'
export { SPAWN_FLAT, SPAWN_CLEAR, nearSpawn } from './path.js'

/** What a column is. Every pass after the one that set it reads it. */
export const KIND = {
  FIELD: 0,    // land: grass, hills, whatever grows on it
  PATH: 1,     // the walked surface
  SPUR: 2,     // a branch off it, to a chapter
  BRIDGE: 3,   // walk over water: a deck, with the water still underneath
  WATER: 4,    // river, lake or moat
  PLOT: 7,     // a chapter footprint. Nothing in this file writes here.
}

/*
 * HOW FAR BELOW THE PLOTS THE WORLD GOES: eight blocks, so the floor is
 * y = 128, and that number is an efficiency decision before it is anything
 * else.
 *
 * noa meshes and lights the world in 32-block chunks, and 128 is a chunk
 * boundary. The old superflat's floor was y = 132, so the ground of the
 * whole world sat in ONE layer of chunks (128..159). A floor at 112 -- the
 * first version of this pass, 24 blocks of stone for deep valleys -- put
 * terrain into the layer below as well, and every column of the world cost
 * two chunks to mesh and light instead of one: measured as boot getting
 * visibly slower, which the sprint brief rules out. At 128 the layer below is
 * empty and costs nothing.
 *
 * Eight is enough because nothing here goes deeper than the lake bed: land
 * never drops below the water (SHORE_H), the deepest water is five blocks,
 * and a cliff only ever rises.
 */
export const DEPTH = 8
/** How far the land eases down to a plot, in blocks. */
const PAD = 14
/** How far the land eases down to the spawn clearing, past SPAWN_FLAT. */
const SPAWN_PAD = 14
/** How far the land beside the walk blends to the walk's height: at least
 *  this, more where the difference is large (see `finalHeights`). */
const WALK_BLEND = 8

export const at = (x, z) => z * LAND_W + x
export const onMap = (x, z) => x >= 0 && x < LAND_W && z >= 0 && z < LAND_D

function newModel(W, D) {
  const n = W * D
  return {
    W, D,
    kind: new Uint8Array(n),
    /** The land's height as a float, through every pass until the last. */
    g: new Float32Array(n),
    /** The final height: the top solid block of a column is at local
     *  y = h - 1, so h = 0 is plot level. */
    h: new Int16Array(n),
    /** A water column's own height (its bed), kept for the bridge writer. */
    bed: new Int16Array(n),
    depth: new Uint8Array(n),
    /** Which water body: 1 river, 2 lake, 3 moat. */
    lake: new Uint8Array(n),
    /** Walk bookkeeping: the spine sample (path) or spur index, how far
     *  along the spur, and the height the walk is at. */
    walk: new Int32Array(n).fill(-1),
    spur: new Int16Array(n).fill(-1),
    spurT: new Float32Array(n),
    walkH: new Int16Array(n),
    /** The nearest walk column, and the distance to it in blocks. */
    near: new Int32Array(n).fill(-1),
    dWalk: new Float32Array(n),
    /** Distance to the nearest plot (0 inside one) and to water. */
    dPlot: new Float32Array(n),
    dWater: new Float32Array(n),
    /** Distance to the nearest sight line from the walk to a chapter (see
     *  SIGHT_LINES in plots.js); trees keep their canopies off them. */
    dView: new Float32Array(n),
    /** Something already grows or stands here. */
    standing: new Uint8Array(n),
    /** The top block's key, per column, decided by the surface pass. */
    top: new Array(n),
  }
}

/**
 * A chamfer distance transform (3 per step, 4 per diagonal; within about
 * 2% of Euclidean) from every column `seed` says is a source, carrying the
 * index of the nearest source with it. Two sweeps.
 *
 * @returns { d: Float32Array in blocks, near: Int32Array }
 */
function chamfer(W, D, seed) {
  const n = W * D
  const d = new Int32Array(n).fill(1 << 28)
  const near = new Int32Array(n).fill(-1)
  for (let i = 0; i < n; i++) if (seed(i)) { d[i] = 0; near[i] = i }
  const relax = (i, j, w) => { if (d[j] + w < d[i]) { d[i] = d[j] + w; near[i] = near[j] } }
  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      const i = z * W + x
      if (x > 0) relax(i, i - 1, 3)
      if (z > 0) {
        relax(i, i - W, 3)
        if (x > 0) relax(i, i - W - 1, 4)
        if (x < W - 1) relax(i, i - W + 1, 4)
      }
    }
  }
  for (let z = D - 1; z >= 0; z--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = z * W + x
      if (x < W - 1) relax(i, i + 1, 3)
      if (z < D - 1) {
        relax(i, i + W, 3)
        if (x < W - 1) relax(i, i + W + 1, 4)
        if (x > 0) relax(i, i + W - 1, 4)
      }
    }
  }
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = d[i] / 3
  return { d: out, near }
}

/* 2. THE LAND. */
function shapeLand(model, bf) {
  const { W, D } = model
  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      const i = z * W + x
      /* Rolling: five octaves from a 100-block swell. Ridged: four from an
       * 80-block crest. The biome's `ridge` mixes them, so the peaks are
       * crests and the plains are swells, with every shade between where
       * the regions blend. */
      const roll = fbm(x, z, 100, 5, 11) * 1.7
      const r = bf.ridge[i]
      const shape = r > 0.01 ? (1 - r) * roll + r * (ridged(x, z, 80, 4, 13) * 2.2 - 0.8) : roll
      const detail = fbm(x, z, 14, 2, 17) * 0.9
      model.g[i] = Math.max(SHORE_H, bf.base[i] + bf.amp[i] * shape + detail)
    }
  }
}

/* 4. THE PADS: plots and spawn. */
function pads(model) {
  const { W, D } = model
  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      const i = z * W + x
      const k = model.kind[i]
      if (k === KIND.PLOT || k === KIND.WATER) continue
      const dp = model.dPlot[i]
      if (dp < PAD) {
        const t = smoothstep((dp - 1) / (PAD - 1))
        model.g[i] *= t
      }
      const ds = Math.hypot(x - LAND_SPAWN_X, z - LAND_SPAWN_Z)
      if (ds < SPAWN_FLAT + SPAWN_PAD) {
        model.g[i] *= smoothstep((ds - SPAWN_FLAT) / SPAWN_PAD)
      }
    }
  }
}

const isWalk = (k) => k === KIND.PATH || k === KIND.SPUR || k === KIND.BRIDGE

/* 5b. Every column's final integer height. */
function finalHeights(model) {
  const { W, D } = model
  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      const i = z * W + x
      const k = model.kind[i]
      if (k === KIND.PLOT) { model.h[i] = 0; continue }
      if (k === KIND.WATER) { model.h[i] = model.bed[i]; continue }
      if (isWalk(k)) { model.h[i] = model.walkH[i]; continue }
      let gv = model.g[i]
      const nw = model.near[i]
      if (nw >= 0) {
        const wh = model.walkH[nw]
        /* The blend is wider where the land is far above or below the walk,
         * so a path cut into a hillside has a slope beside it rather than a
         * wall. */
        const blend = Math.min(24, Math.max(WALK_BLEND, Math.abs(gv - wh) * 1.3))
        const d = model.dWalk[i]
        if (d < blend + 1.5) {
          const t = smoothstep((d - 1.5) / blend)
          gv = wh + (gv - wh) * t
        }
      }
      /* The plot pad again, AFTER the walk: a path high in the hills blends
       * the land up toward itself, and that must not climb onto a plot's
       * edge. A plot is at plot level and the land meets it there. */
      const dp = model.dPlot[i]
      if (dp < PAD) gv *= smoothstep((dp - 1) / (PAD - 1))
      if (nearSpawn(x, z, SPAWN_FLAT)) gv = 0
      model.h[i] = Math.max(SHORE_H, Math.round(gv))
    }
  }
}

/*
 * 6. THE SURFACE, which is vanilla's surface rules in miniature.
 *
 * Vanilla decides a column's top block from its biome, its height, how
 * steep it is and how near water: grass over dirt by default, sand where a
 * beach is, stone where the slope is too steep for soil (the "steep" rule
 * windswept and peak biomes carry), snow above a snow line on the peaks,
 * podzol and coarse dirt on the taiga floor and under bamboo.
 *
 * @returns [top, sub, subDepth]
 */
function surfaceOf(model, i, x, z, steep) {
  const k = model.kind[i]
  const h = model.h[i]
  if (k === KIND.PATH || k === KIND.SPUR) {
    return [hash(x, z, 89) < 0.03 ? 'grass' : pathSurface(x, z), 'dirt', 3]
  }
  if (k === KIND.PLOT) return ['grass', 'dirt', 3]
  if (k === KIND.WATER || k === KIND.BRIDGE) {
    /* River and lake beds: sand in the shallows, gravel in the channel,
     * and clay in discs, which is where vanilla puts it. */
    const v = smoothNoise(x, z, 6, 233)
    if (v > 0.72) return ['clay', 'clay', 2]
    return [model.depth[i] <= 1 || v < 0.35 ? 'sand' : 'gravel', 'sand', 2]
  }
  const b = model.biome[i]
  const dw = model.dWater[i]
  /* The shore: sand where the land is at or just above the water and near
   * it, with gravel in it here and there. */
  if (dw <= 3 && h <= 0) {
    return [smoothNoise(x, z, 5, 241) > 0.78 ? 'gravel' : 'sand', 'sand', 3]
  }
  const v = smoothNoise(x, z, 9, 851) * 0.6 + smoothNoise(x, z, 3.5, 852) * 0.4
  if (b === BIOME.PEAKS || b === BIOME.HILLS) {
    const snow = 34 + (smoothNoise(x, z, 17, 863) - 0.5) * 8
    if (b === BIOME.PEAKS && h >= snow) return [steep >= 3 ? 'stone' : 'snow_block', 'stone', 1]
    const bare = b === BIOME.PEAKS ? 2 : 3
    if (steep >= bare || h >= (b === BIOME.PEAKS ? 18 : 26)) {
      return [v > 0.7 ? 'andesite' : v < 0.22 ? 'gravel' : 'stone', 'stone', 1]
    }
  }
  if (steep >= 4) return ['stone', 'stone', 1]
  if (b === BIOME.TAIGA) {
    if (v > 0.7) return ['podzol', 'dirt', 3]
    if (v < 0.2) return ['coarse_dirt', 'dirt', 3]
  }
  if (b === BIOME.BAMBOO && v > 0.68) return ['podzol', 'dirt', 3]
  if (b === BIOME.DARK && v > 0.8) return ['podzol', 'dirt', 3]
  return ['grass', 'dirt', 3 + (hash(x, z, 507) < 0.5 ? 1 : 0)]
}

/**
 * The voxel writer every feature draws with, in LOCAL coordinates (y = 0 is
 * the air over a plot). It is the landscape's version of the stamper's
 * bounds check: nothing it writes lands in a plot column, and leaves only
 * ever replace air, which is vanilla's own rule.
 */
function writer(model, buf, H, BASE, idOf) {
  const { W, D } = model
  const leaves = new Set()
  const AIR = 0
  const off = (x, y, z) => {
    if (x < 0 || x >= W || z < 0 || z >= D) return -1
    const yy = y + BASE
    if (yy < 0 || yy >= H) return -1
    return (z * W + x) * H + yy
  }
  const open = (x, z) => model.kind[z * W + x] !== KIND.PLOT && !nearSpawn(x, z, SPAWN_CLEAR)
  return {
    W, D,
    /** Place a block in air, outside plots. */
    put(x, y, z, key) {
      const o = off(x, y, z)
      if (o < 0 || buf[o] !== AIR || !open(x, z)) return false
      buf[o] = idOf(key)
      return true
    },
    leaf(x, y, z, key) {
      const o = off(x, y, z)
      if (o < 0 || buf[o] !== AIR || !open(x, z)) return false
      if (isWalk(model.kind[z * W + x]) && y < model.h[z * W + x] + 3) return false
      const id = idOf(key)
      leaves.add(id)
      buf[o] = id
      return true
    },
    log(x, y, z, key) {
      const o = off(x, y, z)
      if (o < 0 || !open(x, z)) return false
      if (buf[o] !== AIR && !leaves.has(buf[o])) return false
      buf[o] = idOf(key)
      return true
    },
    /** Air, and writable: what `put` needs. */
    open(x, y, z) {
      const o = off(x, y, z)
      return o >= 0 && buf[o] === AIR && open(x, z)
    },
    free(x, y, z) {
      const o = off(x, y, z)
      if (o < 0 || !open(x, z)) return false
      return buf[o] === AIR || leaves.has(buf[o])
    },
    ground(x, z, y) {
      if (x < 0 || x >= W || z < 0 || z >= D) return false
      const i = z * W + x
      return model.kind[i] === KIND.FIELD && model.h[i] === y
    },
    /** A boulder block: replaces the ground it sinks into, or air above
     *  it, on land -- never something already standing there. */
    rock(x, y, z, key) {
      const o = off(x, y, z)
      if (o < 0 || !open(x, z)) return false
      const i = z * W + x
      if (model.kind[i] !== KIND.FIELD) return false
      if (y >= model.h[i] && buf[o] !== AIR) return false
      buf[o] = idOf(key)
      return true
    },
    /** A bridge pier block: replaces the water or air it stands in, and
     *  only under a bridge. */
    pier(x, y, z, key) {
      const o = off(x, y, z)
      if (o < 0 || model.kind[z * W + x] !== KIND.BRIDGE) return false
      buf[o] = idOf(key)
      return true
    },
    /** Swap a land column's top block. */
    surface(x, z, key) {
      const i = z * W + x
      if (model.kind[i] !== KIND.FIELD) return false
      buf[i * H + model.h[i] - 1 + BASE] = idOf(key)
      model.top[i] = key
      return true
    },
  }
}

/** For the console and the specs: how the last generation went. */
export const landStats = {}

/**
 * Generate the overworld landscape.
 *
 * @param opts.surfaceY  the y a player stands at on a plot: GROUND_Y
 * @param opts.ceilingY  the top of the encoded range, and of the barrier
 * @returns { world, model } -- `world` is the shape src/terrainFormat.js's
 *          decode returns ({ width, depth, yMin, yTop, palette, cols }), so
 *          src/island.js installs it like any other; `model` is the column
 *          model, which src/builds/overworld.js hands to the chapter frames.
 */
export function generateLand({ surfaceY = GROUND_Y, ceilingY = GROUND_Y + 64 } = {}) {
  if (surfaceY !== GROUND_Y) {
    throw new Error(`generateLand: the overworld survey in src/builds/plots.js is `
      + `written against ground at y=${GROUND_Y}, not ${surfaceY}.`)
  }
  const t0 = performance.now()
  const W = LAND_W, D = LAND_D, N = W * D
  const model = newModel(W, D)
  const time = {}
  let tp = t0
  const lap = (name) => { const t = performance.now(); time[name] = Math.round(t - tp); tp = t }

  /* 1. The plots, and how far every column is from one. */
  for (const c of CHAPTERS) {
    for (let z = c.z0; z <= c.z1; z++) {
      for (let x = c.x0; x <= c.x1; x++) model.kind[z * W + x] = KIND.PLOT
    }
  }
  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      let best = Infinity
      for (const c of CHAPTERS) {
        const d = toRect(x, z, c)
        if (d < best) best = d
      }
      model.dPlot[z * W + x] = Math.max(0, best)
    }
  }

  /* 2. Biomes and the land's own shape. */
  const bf = biomeField(W, D)
  model.biome = bf.id
  model.biomeNear = bf.near
  model.gap = bf.gap
  lap('biomes')
  shapeLand(model, bf)
  lap('land')

  /* 3. Water, then 4. the pads. */
  carveWater(model, KIND)
  pads(model)
  lap('water')

  /* 5. The walk: where it goes, how high, and the land blended to it. */
  const samples = sampleSpine(SPINE)
  rasterPath(model, samples, KIND)
  const spurs = spurCurves(samples)
  rasterSpurs(model, spurs, KIND)
  const profile = walkProfile(model, samples, KIND, spurs)
  walkHeights(model, profile, spurs, KIND)
  settleWalk(model, KIND)
  const walkField = chamfer(W, D, (i) => isWalk(model.kind[i]))
  model.dWalk = walkField.d
  model.near = walkField.near
  finalHeights(model)
  model.dWater = chamfer(W, D, (i) => model.kind[i] === KIND.WATER || model.kind[i] === KIND.BRIDGE).d
  const view = sightLines(model, samples, spurs)
  model.dView = chamfer(W, D, (i) => view[i] === 1).d
  lap('walk')

  /* 6 and 7. Surface, and the write. */
  const yMin = surfaceY - DEPTH
  const yTop = ceilingY
  const H = yTop - yMin + 1
  const BASE = surfaceY - yMin
  const palette = ['air']
  const ids = new Map([['air', 0]])
  const idOf = (key) => {
    let id = ids.get(key)
    if (id === undefined) { id = palette.push(key) - 1; ids.set(key, id) }
    return id
  }
  const buf = new Uint16Array(N * H)
  const BEDROCK = idOf('bedrock'), STONE = idOf('stone'), WATER = idOf('water')
  const ORES = [[idOf('coal_ore'), 0.018], [idOf('iron_ore'), 0.008], [idOf('copper_ore'), 0.006]]
  const DECK = idOf('spruce_planks')

  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      const i = z * W + x
      const h = model.h[i]
      /* How far this column stands above its lowest neighbour: the slope
       * the surface rules and the ore exposure read. */
      let steep = 0
      if (x > 0) steep = Math.max(steep, h - model.h[i - 1])
      if (x < W - 1) steep = Math.max(steep, h - model.h[i + 1])
      if (z > 0) steep = Math.max(steep, h - model.h[i - W])
      if (z < D - 1) steep = Math.max(steep, h - model.h[i + W])
      const [top, sub, subDepth] = surfaceOf(model, i, x, z, steep)
      model.top[i] = top
      const o = i * H
      const topAt = h - 1 + BASE
      /* Stone up to and including stoneTo, then `subDepth` blocks of the
       * sub-surface (dirt under grass), then the top. */
      const stoneTo = topAt - subDepth - 1
      buf.fill(STONE, o + 1, o + Math.max(1, stoneTo + 1))
      /* Bedrock: the floor, and a ragged second layer where stone is, which
       * is vanilla's bedrock gradient squeezed into the depth there is. */
      buf[o] = BEDROCK
      if (stoneTo >= 1 && hash(x, z, 501) < 0.5) buf[o + 1] = BEDROCK
      if (subDepth > 0) buf.fill(idOf(sub), o + Math.max(1, stoneTo + 1), o + topAt)
      buf[o + topAt] = idOf(top)
      /* Ore where stone shows: on a cliff face, the top few blocks of it. */
      if (steep >= 2) {
        for (let y = Math.max(4, topAt - steep - 2); y <= topAt; y++) {
          if (buf[o + y] !== STONE) continue
          const u = hash(x * 31 + y, z, 777)
          let acc = 0
          for (const [id, p] of ORES) { acc += p; if (u < acc) { buf[o + y] = id; break } }
        }
      }
      const kind = model.kind[i]
      if (kind === KIND.WATER) {
        buf.fill(WATER, o + topAt + 1, o + WATER_Y + BASE + 1)
      } else if (kind === KIND.BRIDGE) {
        /* Both things at once: the river underneath, unbroken, and a deck
         * over it at the walk's height. */
        const bedTop = model.bed[i] - 1 + BASE
        buf[o + topAt] = 0
        buf.fill(STONE, o + 1, o + bedTop)
        buf[o + bedTop] = idOf(top)
        buf.fill(WATER, o + bedTop + 1, o + WATER_Y + BASE + 1)
        buf.fill(0, o + WATER_Y + BASE + 1, o + topAt)
        buf[o + topAt] = DECK
        model.top[i] = 'spruce_planks'
      }
    }
  }
  lap('write')

  /* 8. Features. */
  const V = writer(model, buf, H, BASE, idOf)
  /* Steps before the bridge rails, so a rise onto a deck gets its slab and
   * the rail gives way to it rather than the other way round. */
  const laid = steps(V, model, KIND)
  bridges(V, model)
  lampPosts(V, model, samples, KIND)
  const grown = plantAll(V, model, KIND)
  lap('features')

  /* The world, in the importer's shape. One buffer; each column a view. */
  const cols = new Array(N)
  for (let i = 0; i < N; i++) cols[i] = buf.subarray(i * H, (i + 1) * H)
  const world = { magic: 'GEN2', width: W, depth: D, yMin, yTop, palette, cols }
  lap('pack')

  Object.assign(landStats, {
    ms: Math.round(performance.now() - t0), time, steps: laid, ...grown,
    samples: samples.length, palette: palette.length,
  })
  return { world, model, samples, spurs }
}

/*
 * THE SIGHT LINES, as a mask of columns, from SIGHT_LINES in plots.js.
 *
 * For each listed chapter: every second block of the walk on the way in,
 * from `approach` blocks out (straight-line distance to the plot) to the
 * point where its spur leaves, sees every block round the middle `frame`
 * share of the plot's footprint. Each of those lines is stepped a block at a
 * time and its columns marked. Flora then keeps a tree's canopy off every
 * marked column, so what stands between the walk and the build's middle is
 * open and its corners stay framed. Pure arithmetic on the survey and the
 * spine, so it is the same clearing on every boot.
 */
function sightLines(model, samples, spurs) {
  const { W, D } = model
  const mask = new Uint8Array(W * D)
  for (const { id, approach, frame } of SIGHT_LINES) {
    const spur = spurs.find((s) => s.chapter.id === id)
    if (!spur) throw new Error(`SIGHT_LINES names ${JSON.stringify(id)}, which is not a chapter`)
    const c = spur.chapter
    /* The middle `frame` of the footprint, and every block round its edge. */
    const cx = (c.x0 + c.x1 + 1) / 2, cz = (c.z0 + c.z1 + 1) / 2
    const hw = (c.x1 - c.x0 + 1) * frame / 2, hd = (c.z1 - c.z0 + 1) * frame / 2
    const targets = []
    for (let t = -hw; t <= hw; t++) targets.push([cx + t, cz - hd], [cx + t, cz + hd])
    for (let t = -hd; t <= hd; t++) targets.push([cx - hw, cz + t], [cx + hw, cz + t])
    /* The walk in, sampled every two blocks (samples are a quarter apart). */
    for (let i = spur.from; i >= 0; i -= 8) {
      const s = samples[i]
      if (toRect(s.x, s.z, c) > approach) break
      for (const [tx, tz] of targets) {
        const len = Math.hypot(tx - s.x, tz - s.z)
        for (let k = 0; k <= len; k++) {
          const x = Math.round(s.x + (tx - s.x) * k / len)
          const z = Math.round(s.z + (tz - s.z) * k / len)
          if (x >= 0 && x < W && z >= 0 && z < D) mask[z * W + x] = 1
        }
      }
    }
  }
  return mask
}

/*
 * THE BRIDGES: the main crossing and the causeway onto New York's island.
 * Both are KIND.BRIDGE columns with a spruce deck at the walk's height. On
 * every deck column that has open water beside it stands a rail of stripped
 * spruce, with a lantern post every seventh block, and under every fourth
 * rail column a stone-brick pier runs down to the bed.
 */
function bridges(V, model) {
  const { W, D } = model
  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      const i = z * W + x
      if (model.kind[i] !== KIND.BRIDGE) continue
      let edge = false
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz
        if (nx < 0 || nx >= W || nz < 0 || nz >= D) continue
        if (model.kind[nz * W + nx] === KIND.WATER) edge = true
      }
      if (!edge) continue
      const h = model.h[i]
      if (!V.put(x, h, z, 'stripped_spruce_log')) continue
      if ((x + z) % 7 === 0) {
        V.put(x, h + 1, z, 'stripped_spruce_log')
        V.put(x, h + 2, z, 'glowstone')
      }
      if ((x * 3 + z) % 4 === 0) {
        for (let y = model.bed[i]; y <= h - 2; y++) V.pier(x, y, z, 'stone_bricks')
      }
      model.standing[i] = 1
    }
  }
}

