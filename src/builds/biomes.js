/*
 * THE BIOMES: which Minecraft biome every column of the overworld is in,
 * and what that biome asks of the ground.
 *
 * ------------------------------------------------------------------------
 * WHAT THE OWNER ASKED FOR, twice. First: "each area surrounded by whatever
 * minecraft biome (true-ish generation) would make sense". Then, in Sprint 1:
 * "the landscape between plots reads as random noise... it is flat, the trees
 * look bad, and it does not look like vanilla terrain. Make it believable."
 *
 * So the palettes, tree species, ground cover and the SHAPE of each biome's
 * land are Minecraft's. The noise is ours, because generator output cannot be
 * served (DECISIONS.md #1; scripts/check-deploy-assets.mjs fails the build if
 * it reappears), so an imported overworld is not an option.
 * ------------------------------------------------------------------------
 * THE ARC, and it is the reason the biomes are in this order down the walk:
 *
 *   plains -> forest / dark forest -> birch forest -> bamboo jungle
 *     -> river -> taiga -> windswept hills -> jagged peaks
 *
 * Flat prairie at spawn, a mountain range at the end. Each chapter sits in
 * the biome that is its surroundings (CHAPTER_BIOME), and the ground between
 * chapters is whatever is nearest, so moving a plot moves its biome with it.
 * Bamboo, not cherry, for Bilibili, on the owner's instruction.
 * ------------------------------------------------------------------------
 * HOW A COLUMN GETS ITS BIOME: WARPED, WEIGHTED VORONOI, as before.
 *
 * Each biome owns anchor points and a column belongs to the nearest one,
 * measured from a position displaced by two slow noise fields (so borders
 * wander) with x counting 0.55 of z (so regions stretch across the map and
 * the walk down z passes through them in order). Within BLEND of a border the
 * column takes the runner-up biome with a probability that falls off with
 * distance, in clumps, so birch thins into oak rather than stopping at a
 * line.
 *
 * WHAT IS NEW: THE SHAPE OF THE LAND BLENDS SMOOTHLY, AND THE PAINT DOES NOT.
 * A dither is right for which block is on top and wrong for how high the
 * ground is: the previous pass learned that the hard way (a dithered summit
 * left holes in the mountain). So every column also gets SOFT weights over
 * all nearby anchors, and the terrain parameters (base height, roughness,
 * ridginess) are the weighted mean. Hills rise out of plains over thirty
 * blocks instead of at a border, which is what vanilla's climate blending
 * does with its continentalness and erosion fields.
 *
 * EVERY NUMBER HERE IS A FUNCTION OF ITS COORDINATE, so the world is
 * identical on every load.
 */
import { hash, smoothNoise } from './noise.js'
import { CHAPTERS, LAND_W, LAND_D, LAND_SPAWN_X, LAND_SPAWN_Z } from './plots.js'

export const BIOME = {
  PLAINS: 0,
  FOREST: 1,
  BIRCH: 2,
  DARK: 3,
  BAMBOO: 4,
  RIVERLANDS: 5,
  TAIGA: 6,
  HILLS: 7,
  PEAKS: 8,
}

export const BIOME_NAME = [
  'plains', 'forest', 'birch forest', 'dark forest', 'bamboo jungle',
  'river', 'taiga', 'windswept hills', 'jagged peaks',
]

/** The chapter each biome is the surroundings OF. Read off the plot table,
 *  so moving a chapter moves its biome. */
const CHAPTER_BIOME = {
  ch1: BIOME.PLAINS,
  ch2: BIOME.BIRCH,
  ch3: BIOME.BAMBOO,
  ch4: BIOME.RIVERLANDS,
  ch5: BIOME.HILLS,
  ch6: BIOME.PEAKS,
}

/*
 * EXTRA ANCHORS, and each one is a place:
 *
 *   - PLAINS at spawn and just south of it: the first frame is open prairie
 *     with the lake beyond it, and chapter 1 stands in the same grass.
 *   - FOREST mid-path between Omaha and Harvard, and a DARK FOREST grove on
 *     the left between Omaha and Bilibili: the first real wood you walk into.
 *   - BIRCH north-east of Harvard, so the lake shore is birch.
 *   - BAMBOO either side of the path at Bilibili.
 *   - RIVERLANDS on the crossing and along the west reach of the river.
 *   - TAIGA in the corridor after New York: spruce before the hills.
 *   - PEAKS twice south of San Francisco, so the range is a range.
 */
const EXTRA = [
  [BIOME.PLAINS, LAND_SPAWN_X, LAND_SPAWN_Z - 12],
  [BIOME.PLAINS, 150, 44],
  [BIOME.FOREST, 146, 104],
  [BIOME.FOREST, 10, 20],
  [BIOME.DARK, 58, 108],
  [BIOME.BIRCH, 262, 38],
  [BIOME.BAMBOO, 124, 148],
  [BIOME.RIVERLANDS, 146, 186],
  [BIOME.RIVERLANDS, 50, 216],
  [BIOME.TAIGA, 150, 262],
  [BIOME.TAIGA, 276, 292],
  [BIOME.HILLS, 140, 318],
  [BIOME.PEAKS, 62, 372],
  [BIOME.PEAKS, 150, 398],
  [BIOME.PEAKS, 270, 398],
]

/** [biome, x, z] for every anchor: one per chapter centre, plus EXTRA. */
export const ANCHORS = [
  ...CHAPTERS.map(c => [CHAPTER_BIOME[c.id], (c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2]),
  ...EXTRA,
]

/** How much less a block of x counts than a block of z. */
const X_SQUASH = 0.55
/** How wide the dithered border band is, in units of the same metric. */
const BLEND = 10
/** How far the SOFT terrain weights reach, same metric. A Gaussian of this
 *  width over (distance - nearest distance). */
const SOFT = 20

function warpX(x, z) { return x + (smoothNoise(x, z, 34, 701) - 0.5) * 30 }
function warpZ(x, z) { return z + (smoothNoise(x, z, 27, 703) - 0.5) * 30 }

/**
 * The biome at a column, and the one next door.
 *
 * @returns { id, near, second, gap } -- `id` is what the column IS after
 *          dithering, `near` the un-dithered nearest biome, `second` the
 *          runner-up and `gap` how far inside its region the column is (0 at
 *          a border, 1 beyond the blend band).
 */
export function biomeAt(x, z) {
  const wx = warpX(x, z), wz = warpZ(x, z)
  let best = 0, bestD = Infinity, second = 0, secondD = Infinity
  for (let k = 0; k < ANCHORS.length; k++) {
    const a = ANCHORS[k]
    const dx = (wx - a[1]) * X_SQUASH, dz = wz - a[2]
    const d = Math.sqrt(dx * dx + dz * dz)
    if (d < bestD) {
      if (a[0] !== best) { secondD = bestD; second = best }
      bestD = d; best = a[0]
    } else if (d < secondD && a[0] !== best) { secondD = d; second = a[0] }
  }
  const gap = Math.min(1, (secondD - bestD) / BLEND)
  if (second === best || gap >= 1) return { id: best, near: best, second, gap: 1 }
  const fine = smoothNoise(x, z, 3.5, 709)
  const id = fine < 0.5 * (1 - gap) ? second : best
  return { id, near: best, second, gap }
}

/* ====================================================================== *
 * WHAT EACH BIOME DOES TO THE SHAPE OF THE LAND.
 *
 * Heights are in blocks above GROUND_Y, where every plot sits. Water stands
 * at -2 (see WATER_Y in src/builds/land.js), so 0 is two blocks above a
 * river's surface: a plot is never at the water's edge.
 *
 *   base   the biome's mean height. Plains sit at the plot level; the
 *          windswept hills a dozen blocks up; the peaks twenty.
 *   amp    how far the fractal noise swings either side of the base.
 *   ridge  0..1, how much of that swing is RIDGED noise rather than rolling:
 *          the jagged peaks are crests, the plains are swells.
 *
 * The numbers are read off vanilla's look rather than its density
 * functions (which are a 3D noise router with no 2D equivalent): a plains
 * biome rolls two or three blocks, a forest five or six, windswept hills
 * fifteen to twenty-five with bare stone on the shoulders, jagged peaks forty.
 * ====================================================================== */
export const SHAPE = [
  /* PLAINS     */ { base: 1, amp: 3, ridge: 0 },
  /* FOREST     */ { base: 3, amp: 6, ridge: 0 },
  /* BIRCH      */ { base: 3, amp: 6, ridge: 0 },
  /* DARK       */ { base: 3, amp: 5, ridge: 0 },
  /* BAMBOO     */ { base: 4, amp: 9, ridge: 0.15 },
  /* RIVERLANDS */ { base: 0.5, amp: 2, ridge: 0 },
  /* TAIGA      */ { base: 6, amp: 10, ridge: 0.2 },
  /* HILLS      */ { base: 12, amp: 16, ridge: 0.45 },
  /* PEAKS      */ { base: 22, amp: 26, ridge: 0.9 },
]

/**
 * The whole map at once: the dithered biome, the un-dithered one, the blend
 * gap, and the three soft terrain parameters. One pass, cached by the caller.
 *
 * THE SOFT WEIGHTS ARE COMPUTED ON A 4-BLOCK GRID and interpolated, which is
 * the efficiency decision in this file. They are Gaussians over distances
 * tens of blocks wide, so a 4-block lattice cannot alias them, and it is a
 * sixteenth of the exponentials: 7,500 grid points instead of 115,200
 * columns, each against every anchor.
 */
export function biomeField(W = LAND_W, D = LAND_D) {
  const n = W * D
  const id = new Uint8Array(n)
  const near = new Uint8Array(n)
  const gap = new Float32Array(n)
  const base = new Float32Array(n)
  const amp = new Float32Array(n)
  const ridge = new Float32Array(n)

  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      const i = z * W + x
      const b = biomeAt(x, z)
      id[i] = b.id; near[i] = b.near; gap[i] = b.gap
    }
  }

  /* The soft parameters, on the coarse grid. */
  const S = 4
  const gw = Math.ceil(W / S) + 1, gd = Math.ceil(D / S) + 1
  const gBase = new Float32Array(gw * gd), gAmp = new Float32Array(gw * gd), gRidge = new Float32Array(gw * gd)
  const dist = new Float32Array(ANCHORS.length)
  for (let gz = 0; gz < gd; gz++) {
    for (let gx = 0; gx < gw; gx++) {
      const x = gx * S, z = gz * S
      const wx = warpX(x, z), wz = warpZ(x, z)
      let dmin = Infinity
      for (let k = 0; k < ANCHORS.length; k++) {
        const a = ANCHORS[k]
        const dx = (wx - a[1]) * X_SQUASH, dz = wz - a[2]
        dist[k] = Math.sqrt(dx * dx + dz * dz)
        if (dist[k] < dmin) dmin = dist[k]
      }
      let sw = 0, sb = 0, sa = 0, sr = 0
      for (let k = 0; k < ANCHORS.length; k++) {
        const t = (dist[k] - dmin) / SOFT
        if (t > 3) continue
        const w = Math.exp(-t * t)
        const s = SHAPE[ANCHORS[k][0]]
        sw += w; sb += w * s.base; sa += w * s.amp; sr += w * s.ridge
      }
      const g = gz * gw + gx
      gBase[g] = sb / sw; gAmp[g] = sa / sw; gRidge[g] = sr / sw
    }
  }
  for (let z = 0; z < D; z++) {
    const fz = z / S, z0 = Math.floor(fz), tz = fz - z0
    for (let x = 0; x < W; x++) {
      const fx = x / S, x0 = Math.floor(fx), tx = fx - x0
      const g00 = z0 * gw + x0, g10 = g00 + 1, g01 = g00 + gw, g11 = g01 + 1
      const i = z * W + x
      const w00 = (1 - tx) * (1 - tz), w10 = tx * (1 - tz), w01 = (1 - tx) * tz, w11 = tx * tz
      base[i] = gBase[g00] * w00 + gBase[g10] * w10 + gBase[g01] * w01 + gBase[g11] * w11
      amp[i] = gAmp[g00] * w00 + gAmp[g10] * w10 + gAmp[g01] * w01 + gAmp[g11] * w11
      ridge[i] = gRidge[g00] * w00 + gRidge[g10] * w10 + gRidge[g01] * w01 + gRidge[g11] * w11
    }
  }
  return { id, near, gap, base, amp, ridge }
}

/* ====================================================================== *
 * THE BAMBOO STALK, AND THE RECIPE FOR BUILDING ONE.
 *
 * Thirteen ids: three leaf states across, four horizontal-offset variants
 * down. Vanilla's `growBamboo` gives three rules:
 *
 *   1. A STALK IS A COLUMN OF SEPARATE BLOCKS, up to sixteen tall.
 *   2. LEAVES ONLY AT THE TOP. The top block is `_leaves_large`, the one
 *      under it `_leaves_small`, and everything below that is bare cane.
 *   3. ONE OFFSET SUFFIX PER STALK, ALL THE WAY UP, picked from the stalk's
 *      own coordinates as vanilla does, or the stalk zigzags.
 *
 * `bamboo_sapling` is the ground sprout. `bamboo_block` is NOT the plant: it
 * is the 1.20 Block of Bamboo, a solid cube building material.
 * ====================================================================== */
export const BAMBOO = {
  cane: ['bamboo', 'bamboo_1', 'bamboo_2', 'bamboo_3'],
  small: ['bamboo_leaves_small', 'bamboo_leaves_small_1',
    'bamboo_leaves_small_2', 'bamboo_leaves_small_3'],
  large: ['bamboo_leaves_large', 'bamboo_leaves_large_1',
    'bamboo_leaves_large_2', 'bamboo_leaves_large_3'],
  sapling: 'bamboo_sapling',
}

/** The block the bamboo jungle is censused by: every stalk taller than two
 *  has bare cane in it and only the bamboo jungle has any. */
export const BAMBOO_STALK = BAMBOO.cane[0]
