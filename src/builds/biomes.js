/*
 * SIX BIOMES ACROSS 256 BLOCKS, GENERATED RATHER THAN IMPORTED.
 *
 * ------------------------------------------------------------------------
 * WHAT THE OWNER ASKED FOR: "I'd like the biome to change throughout. Like,
 * each area surrounded by whatever minecraft biome (true-ish generation)
 * would make sense... Because the surroundings look a bit too uniform rn."
 *
 * So the palettes, the tree species, the foliage and the terrain shapes are
 * Minecraft's. The NOISE IS OURS. That is not taste, it is the only version
 * of this that can ship: DECISIONS.md #1 has `public/terrain/` gitignored,
 * `build:deploy` doing `rm -rf dist/terrain`, and
 * scripts/check-deploy-assets.mjs FAILING THE BUILD if generator output
 * reappears in the artifact. src/flatworld.js exists precisely to have got
 * the imported patch off the overworld's boot path. An imported overworld
 * cannot be served, so an imported overworld is not an option.
 * ------------------------------------------------------------------------
 * THE ARC, and it is the reason the biomes are in this order.
 *
 *   plains -> birch forest -> bamboo jungle -> river -> hills -> peaks
 *
 * Flat prairie at the start, a literal mountain at the end. The world gets
 * more dramatic as the life does, and the last chapter is a climb up
 * something there is a reason to climb.
 *
 * BAMBOO AND NOT CHERRY BLOSSOM for Bilibili, on the owner's instruction:
 * "dont use cherry blossom for china, too on the nose". Bamboo turned out to
 * be the easier of the two anyway -- `bamboo_block` is in the block table and
 * a 1x1 column of it seven high is exactly what a bamboo stalk is, so the
 * agreed meadow fallback was never needed.
 * ------------------------------------------------------------------------
 * HOW A COLUMN GETS ITS BIOME: WARPED, WEIGHTED VORONOI.
 *
 * Each biome owns one or more ANCHOR POINTS, and a column belongs to the
 * nearest anchor. The three things that stop that reading as a diagram:
 *
 *   1. DOMAIN WARP. The distance is measured from (x, z) displaced by two
 *      slow noise fields, up to 15 blocks each way. A Voronoi boundary is a
 *      straight line; a warped one wanders, doubles back and leaves islands
 *      of one biome inside another, which is what a real border looks like.
 *   2. X IS COMPRESSED. dx counts 0.55 of a block against dz's 1.0, so a
 *      region stretches east-west and the walk down z passes through all six
 *      in order. Without it, two anchors 155 blocks apart in x and 12 apart
 *      in z (chapter 1 and chapter 2 -- they are across the path from each
 *      other) would cut the world in half lengthwise.
 *   3. THE BOUNDARY IS DITHERED, not drawn. Within BLEND blocks of a border
 *      a column takes the SECOND-nearest biome with a probability that falls
 *      from 50% at the border to 0 at the edge of the band, decided by a fine
 *      noise field so the mixing comes out in clumps of two or three blocks.
 *      Birch thins out into oak, oak thickens into birch, and there is no
 *      line anywhere. Minecraft blends; a hard edge reads as a map.
 *
 * REJECTED -- bands in z, which is the obvious way to lay six biomes along a
 * walk and is one line of code. Chapter 1 (z 22..84) and chapter 2 (z 54..77)
 * OVERLAP in z and are on opposite sides of the path, so a pure z band would
 * have to put Omaha's plains and Harvard's birch at the same latitude. Any
 * scheme that assigns a biome from z alone cannot express this map.
 *
 * REJECTED -- one anchor per chapter. The merged chapter is two places: the
 * Harvard rectangle in the east and the ground the school-work plot used to
 * occupy in the west. Both are birch, so both are anchors, and the forest
 * spans the path the way a forest does.
 * ------------------------------------------------------------------------
 * EVERY NUMBER HERE IS A HASH OF ITS COORDINATE, for the reason
 * src/builds/land.js gives at length: the world is regenerated from source on
 * every page load and a visitor who walked past a birch and came back to find
 * a spruce would be right to think the place was broken.
 */
import { hash, smoothNoise } from './land.js'
import { CHAPTERS, LAND_SIZE } from './plots.js'

export const BIOME = {
  PLAINS: 0,
  BIRCH: 1,
  BAMBOO: 2,
  RIVERLANDS: 3,
  HILLS: 4,
  PEAKS: 5,
}

export const BIOME_NAME = ['plains', 'birch forest', 'bamboo jungle', 'river', 'windswept hills', 'jagged peaks']

/** The chapter each biome is the surroundings OF. Read out of the plot table
 *  rather than typed as coordinates, so moving a chapter moves its biome with
 *  it -- which is the property the owner asked for in as many words. */
const CHAPTER_BIOME = {
  ch1: BIOME.PLAINS,
  ch2: BIOME.BIRCH,
  ch3: BIOME.BAMBOO,
  ch4: BIOME.RIVERLANDS,
  ch5: BIOME.HILLS,
  ch6: BIOME.PEAKS,
}

/*
 * EXTRA ANCHORS, and each one is a place rather than a tuning knob.
 *
 *   - PLAINS at spawn. The visitor lands at patch (128, 16) and the first
 *     thing they see has to be the flat prairie chapter 1 sits in, not
 *     whatever the nearest chapter centre happens to be.
 *   - BIRCH over the ground old chapter 3 gave back (z 86..109 in the west).
 *     The merged chapter is both halves of the school years and the forest
 *     covers both.
 *   - RIVERLANDS on the river itself. The water is a biome, not a feature
 *     inside one, so the banks either side of the crossing are sand and
 *     gravel rather than bamboo litter.
 *   - PEAKS at the western massif. Chapter 6's plot has to stay flat (it is
 *     a parkour and the owner builds it), so the mountain the chapter is
 *     named for stands beside it rather than under it.
 */
const EXTRA = [
  [BIOME.PLAINS, 128, 4],
  [BIOME.BIRCH, 54, 98],
  [BIOME.BAMBOO, 150, 136],
  [BIOME.RIVERLANDS, 132, 158],
  [BIOME.HILLS, 146, 202],
  /* The massif, twice, so the mountain is a RANGE rather than a cone with a
   * hills border halfway up it. SUMMIT below sits on the first of them. */
  [BIOME.PEAKS, 190, 234],
  [BIOME.PEAKS, 218, 250],
]

/** [biome, x, z] for every anchor: one per chapter centre, plus EXTRA. */
export const ANCHORS = [
  ...CHAPTERS.map(c => [
    CHAPTER_BIOME[c.id],
    (c.x0 + c.x1) / 2,
    (c.z0 + c.z1) / 2,
  ]),
  ...EXTRA,
]

/** How much less a block of x counts than a block of z. See (2) above. */
const X_SQUASH = 0.55
/** How wide the dithered border band is, in units of the same metric. */
const BLEND = 10

/** The warped position a column's biome is decided at. Two slow fields, at
 *  different scales so the warp itself has no period you can see. */
function warp(x, z) {
  return [
    x + (smoothNoise(x, z, 34, 701) - 0.5) * 30,
    z + (smoothNoise(x, z, 27, 703) - 0.5) * 30,
  ]
}

const metric = (dx, dz) => Math.hypot(dx * X_SQUASH, dz)

/**
 * The biome at a column, and the one next door.
 *
 * @returns { id, near, second, gap } -- `id` is what the column IS after
 *          dithering, `near` is the un-dithered nearest biome, `second` is
 *          the runner-up and `gap` is how far outside the border band the
 *          column is, 0 at the border and 1 at the far edge of the blend.
 *
 * Callers that want the palette use `id`. Callers that want to know whether
 * they are in a transition -- the tree pass, mostly -- use `gap`.
 */
export function biomeAt(x, z) {
  const [wx, wz] = warp(x, z)
  let best = 0, bestD = Infinity, second = 0, secondD = Infinity
  for (const [id, ax, az] of ANCHORS) {
    const d = metric(wx - ax, wz - az)
    if (d < bestD) { secondD = bestD; second = best; bestD = d; best = id }
    else if (d < secondD && id !== best) { secondD = d; second = id }
  }
  const gap = Math.min(1, (secondD - bestD) / BLEND)
  if (second === best || gap >= 1) return { id: best, near: best, second, gap: 1 }
  /*
   * THE DITHER. A fine field rather than a per-column hash: `hash` is
   * salt-and-pepper and the border would read as static, which is the exact
   * failure src/builds/land.js's smoothNoise was written to avoid. At scale
   * 3.5 the mixing comes out in clumps of two or three columns, which is what
   * the edge of a real forest looks like.
   */
  const fine = smoothNoise(x, z, 3.5, 709)
  const id = fine < 0.5 * (1 - gap) ? second : best
  return { id, near: best, second, gap }
}

/** The whole map at once, as a Uint8Array indexed the way the model is.
 *  One pass of 65,536 warps, cached by the caller, rather than a warp per
 *  question -- the ground pass, the relief pass and the forest pass all want
 *  the same answer and the noise is not free. */
export function biomeField() {
  const n = LAND_SIZE * LAND_SIZE
  const id = new Uint8Array(n)
  const near = new Uint8Array(n)
  const second = new Uint8Array(n)
  const gap = new Float32Array(n)
  for (let z = 0; z < LAND_SIZE; z++) {
    for (let x = 0; x < LAND_SIZE; x++) {
      const i = z * LAND_SIZE + x
      const b = biomeAt(x, z)
      id[i] = b.id; near[i] = b.near; second[i] = b.second; gap[i] = b.gap
    }
  }
  return { id, near, second, gap }
}

/* ====================================================================== *
 * THE PALETTES.
 *
 * Each is a function from a column to the block on top of it, or null for
 * "leave the generator's grass alone". null is not a shortcut: a column at
 * height 0 with a null surface writes NOTHING, which is what keeps a
 * 65,536-column pass from cloning all 65,536 shared columns (see the COPY ON
 * WRITE note in src/builds/stamp.js).
 *
 * Two noise scales in every one of them, for the reason the path's own mix
 * has two: a slow field picks the region's character and a fast field breaks
 * it up inside the region, so the answer is neither a checker nor a gradient.
 * ====================================================================== */

/** Plains: grass, and the point of plains is that it is grass. A thin
 *  scatter of coarse dirt and podzol reads as ground somebody walks on
 *  without ever competing with the green. */
function plainsGround(x, z) {
  const v = smoothNoise(x, z, 21, 811) * 0.7 + smoothNoise(x, z, 5, 812) * 0.3
  if (v > 0.80) return 'coarse_dirt'
  if (v > 0.76) return 'podzol'
  return null
}

/** Birch forest: grass with a real leaf-litter floor. Podzol and moss in
 *  patches, coarse dirt where the litter thins. */
function birchGround(x, z) {
  const v = smoothNoise(x, z, 15, 821) * 0.6 + smoothNoise(x, z, 4.5, 822) * 0.4
  if (v > 0.72) return 'podzol'
  if (v > 0.64) return 'moss_block'
  if (v > 0.58) return 'coarse_dirt'
  return null
}

/** Bamboo jungle: a wet floor. Moss is the signature block and podzol is the
 *  vanilla jungle's own ground; mud where it is lowest. */
function bambooGround(x, z) {
  const v = smoothNoise(x, z, 13, 831) * 0.6 + smoothNoise(x, z, 4, 832) * 0.4
  if (v > 0.70) return 'moss_block'
  if (v > 0.56) return 'podzol'
  if (v > 0.50) return 'rooted_dirt'
  if (v < 0.16) return 'mud'
  return null
}

/** Riverlands: sand and gravel where the water has been, grass where it has
 *  not. Clay in the low spots, which is where vanilla puts it. */
function riverGround(x, z) {
  const v = smoothNoise(x, z, 12, 841) * 0.6 + smoothNoise(x, z, 4, 842) * 0.4
  if (v > 0.74) return 'sand'
  if (v > 0.66) return 'gravel'
  if (v < 0.20) return 'clay'
  return null
}

/** Windswept hills: the bones come through. Stone and andesite on the
 *  shoulders, gravel in the scree, grass everywhere else. `h` is the column's
 *  height, because on a hill it is the HIGH ground that is bare. */
function hillsGround(x, z, h) {
  const v = smoothNoise(x, z, 16, 851) * 0.55 + smoothNoise(x, z, 4.5, 852) * 0.45
  const bare = v + Math.max(0, h) * 0.035
  if (bare > 0.86) return 'stone'
  if (bare > 0.78) return 'andesite'
  if (bare > 0.71) return 'gravel'
  if (bare > 0.66) return 'coarse_dirt'
  return null
}

/*
 * Jagged peaks, BY ALTITUDE, which is the whole look of the biome: grass at
 * the foot, stone and gravel up the flanks, snow and calcite on top with
 * packed ice in the shaded seams. The thresholds are heights above the
 * ordinary ground, not absolute y, because the ground here is at y = 136 and
 * a number relative to it is a number a reader can check against the relief.
 */
function peaksGround(x, z, h) {
  const v = smoothNoise(x, z, 11, 861) * 0.5 + smoothNoise(x, z, 3.5, 862) * 0.5
  if (h >= 17) return v > 0.34 ? 'snow_block' : v > 0.18 ? 'calcite' : 'packed_ice'
  if (h >= 11) return v > 0.55 ? 'snow_block' : v > 0.30 ? 'stone' : 'calcite'
  if (h >= 6) return v > 0.62 ? 'stone' : v > 0.40 ? 'gravel' : 'andesite'
  if (h >= 3) return v > 0.70 ? 'stone' : v > 0.52 ? 'gravel' : null
  return v > 0.84 ? 'gravel' : v > 0.78 ? 'coarse_dirt' : null
}

/** The surface block for a column, or null to leave the grass. */
export function groundOf(biome, x, z, h) {
  switch (biome) {
    case BIOME.PLAINS: return plainsGround(x, z)
    case BIOME.BIRCH: return birchGround(x, z)
    case BIOME.BAMBOO: return bambooGround(x, z)
    case BIOME.RIVERLANDS: return riverGround(x, z)
    case BIOME.HILLS: return hillsGround(x, z, h)
    case BIOME.PEAKS: return peaksGround(x, z, h)
    default: return null
  }
}

/*
 * WHAT IS UNDER THE SURFACE, and it only matters where the ground was
 * RAISED. src/builds/land.js fills a raised column with dirt up to just under
 * its surface block, which is right for a meadow and wrong for a mountain: a
 * twenty-block peak filled with dirt is a twenty-block dirt cliff with a snow
 * hat on it, and you see the whole thing side-on from the path.
 */
export function subsurfaceOf(biome) {
  if (biome === BIOME.PEAKS) return 'stone'
  if (biome === BIOME.HILLS) return 'stone'
  return 'dirt'
}

/* ====================================================================== *
 * THE RELIEF.
 *
 * One amplitude per biome, in blocks, and the shape is fractal noise --
 * three octaves, so a hillside has a shoulder on it rather than being one
 * smooth dome.
 *
 * "NOTHING CRAZY STEEP", which is the owner's phrase and is enforced
 * somewhere else entirely: src/builds/land.js runs a slope clamp over the
 * finished height field that refuses any step bigger than one block outside
 * the climb. The amplitudes below are therefore a statement of CHARACTER --
 * how much a biome wants to move -- and not a promise about what a walker
 * meets. A 24-block massif at one block per column is a mountain you can walk
 * up, which is exactly the mountain this wants.
 * ====================================================================== */
const AMPLITUDE = {
  [BIOME.PLAINS]: 1.2,      // flat. The chapter under it is Omaha.
  [BIOME.BIRCH]: 3.0,
  [BIOME.BAMBOO]: 3.5,
  [BIOME.RIVERLANDS]: 1.6,  // a floodplain is flat, and the water needs it flat
  [BIOME.HILLS]: 9.0,
  [BIOME.PEAKS]: 13.0,
}

/** Three octaves of value noise in [0, 1). Named rather than inlined because
 *  the relief and the summit cone both want the same field. */
function fbm(x, z, salt) {
  return smoothNoise(x, z, 46, salt) * 0.58
    + smoothNoise(x, z, 19, salt + 1) * 0.29
    + smoothNoise(x, z, 8, salt + 2) * 0.13
}

/*
 * THE SUMMIT, and why it is not on chapter 6.
 *
 * The climb is a parkour going UP and the owner builds it, so its footprint
 * must stay dead flat at y = 136 like every other plot. A mountain under it
 * would be a mountain he has to demolish. So the massif stands WEST of the
 * path across z 200..255 -- in view from the last three bends, behind the
 * climb from the plot's own entrance, and on ground nothing else claims.
 *
 * IT SAT TEN ROWS FURTHER SOUTH AND CAME OUT A THIRD SHORTER. The relief
 * tapers to nothing over the last ten columns of the patch (a hillside that
 * ends at the barrier is a hillside ending at whatever the outside of the
 * world is), and a summit nine rows from the south edge spends most of its
 * height paying that taper. Measured at 12 blocks; moved to z = 234 it is 20.
 */
const SUMMIT = { x: 190, z: 234, r: 58, h: 22 }

/**
 * The height this column wants, in blocks above the ordinary ground, before
 * anything clamps it.
 *
 * @param nearPath 0 at the path's centreline, 1 at PATH_FADE blocks away.
 *        THE RELIEF FADES OUT NEAR THE PATH and that is the single decision
 *        that makes "gentle everywhere, dramatic at the climb" possible at
 *        all. The mountain is beside the walk rather than across it, so the
 *        walk stays level without the mountain having to be small.
 */
export function reliefAt(biome, x, z, nearPath) {
  const amp = AMPLITUDE[biome] ?? 1
  let v = (fbm(x, z, 871) - 0.5) * 2 * amp

  if (biome === BIOME.PEAKS) {
    /* A cone, squared off at the edges so the foot of the mountain is a slope
     * and not a rim. Added to the noise rather than multiplied by it, so the
     * ridges keep their shape all the way up. */
    const d = Math.hypot((x - SUMMIT.x) * 0.9, z - SUMMIT.z)
    const t = Math.max(0, 1 - d / SUMMIT.r)
    v += SUMMIT.h * t * t * (3 - 2 * t)
  }

  /* The patch edge stays exactly as the preset generated it. The barrier wall
   * outside the world is not a block anything can see, and terrain that ends
   * AT it is terrain ending at whatever the outside of the world is -- the
   * same argument river.js makes for tapering the river before x = 6. It is
   * also what keeps the two preset-fresh columns test/01-world.spec.js reads
   * the Classic Flat ladder out of actually preset-fresh. */
  const edge = Math.min(x, LAND_SIZE - 1 - x, z, LAND_SIZE - 1 - z)
  if (edge < 3) return 0
  v *= Math.min(1, (edge - 2) / 10)

  v *= nearPath

  /* A floor at -2. Below the grass there are two dirt blocks and then bedrock
   * at local -4, so a surface written at local -3 is the last block that is
   * not the floor of the world. Deeper than that and the stamper throws. */
  return Math.max(-2, Math.round(v))
}

/** Whether a column may be steeper than one block per column. Only the
 *  peaks, only well away from the path, and only where there is nothing to
 *  walk to. See the clamp in src/builds/land.js. */
export function mayBeSteep(biome, nearPath) {
  return biome === BIOME.PEAKS && nearPath >= 1
}

/* ====================================================================== *
 * THE TREES.
 *
 * `speciesAt` answers what a tree HERE is made of, and it replaces the old
 * five-band noise field in src/builds/flora.js wholesale. The bands were a
 * reasonable way to get variety out of one biome; with six biomes the species
 * is a property of the place, which is what the owner was asking for when he
 * said the surroundings looked uniform.
 * ====================================================================== */

/** How many of the candidate tree sites a biome actually takes, 0..1. */
export const DENSITY = {
  [BIOME.PLAINS]: 0.14,     // "scattered oak" -- a prairie with trees in it
  [BIOME.BIRCH]: 0.92,      // a forest, and the densest thing on the map
  [BIOME.BAMBOO]: 0.95,     // a thicket. Mostly stalks; see bambooStand
  [BIOME.RIVERLANDS]: 0.34,
  [BIOME.HILLS]: 0.30,      // windswept: the wind is why there are few trees
  [BIOME.PEAKS]: 0.16,      // and none above the treeline; see flora.js
}

/**
 * Which wood a tree at (x, z) is. Deterministic, and it MIXES at the edges of
 * a region on purpose -- the brief asks for birch "softening to mixed forest
 * at the edges", and a hash roll against the blend gap is how a forest stops
 * being one species without a line where it stops.
 */
export function speciesAt(biome, x, z, gap) {
  const r = hash(x, z, 877)

  /* In the outer half of a blend band, a tree has a real chance of being the
   * neighbouring biome's. Nothing else knows this happened, which is the
   * point: the ground has already dithered, and now the canopy does too. */
  switch (biome) {
    case BIOME.PLAINS:
      return r < 0.88 ? 'oak' : 'birch'
    case BIOME.BIRCH:
      /* Softening to mixed forest at the edges: pure birch in the middle of
       * the wood, a third oak and a little dark oak out where it meets
       * something else. `gap` is 1 deep inside the region and 0 at a border. */
      if (r < 0.55 + 0.4 * gap) return 'birch'
      return r < 0.90 ? 'oak' : 'dark_oak'
    case BIOME.BAMBOO:
      return r < 0.80 ? 'jungle' : 'oak'
    case BIOME.RIVERLANDS:
      return r < 0.55 ? 'oak' : r < 0.85 ? 'birch' : 'mangrove'
    case BIOME.HILLS:
      return r < 0.62 ? 'spruce' : r < 0.92 ? 'oak' : 'birch'
    case BIOME.PEAKS:
      return 'spruce'
    default:
      return 'oak'
  }
}
