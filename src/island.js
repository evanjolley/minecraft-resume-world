/*
 * The island: an 80x80 column (5x5 Minecraft chunks) running from the grass
 * surface all the way down to bedrock, floating in void.
 *
 * This is deliberately a pure function of (x, y, z). noa asks for chunks in
 * whatever order its loader feels like, possibly re-asking for one it already
 * had, and possibly on a worker. Anything that accumulates state across those
 * calls goes wrong in ways that are miserable to debug. A pure lookup can be
 * called in any order, any number of times, and always agrees with itself.
 *
 * WHY 1.16-ERA GENERATION, not 1.18+:
 * the texture pack (Pixel Perfection CE) predates Caves & Cliffs, so it has
 * no deepslate, copper or tuff. Rather than mix packs and break the visual
 * coherence, the strata match the era the art comes from: world bottom at
 * y=0, bedrock 0-4, stone all the way down, and pre-flattening ore bands.
 */

// Half-width. Spans -40..39 on both axes = 80 blocks = 5x5 Minecraft chunks.
export const HALF = 40

// The y a player stands on. Minecraft's sea level, so the ore depth numbers
// below are the ones you'd actually read off the wiki.
export const SURFACE_Y = 64

export const SPAWN = [0.5, SURFACE_Y + 2, 0.5]

// Below the bedrock floor, so falling off the edge still kills you.
export const VOID_Y = -60

const DIRT_DEPTH = 3
const BEDROCK_TOP = 4

/*
 * Deterministic hash -> 0..1. Math.random is unusable here: the same voxel
 * gets asked for more than once, and it must answer identically every time
 * or chunks disagree at their shared borders.
 */
function hash01(x, y, z, seed) {
  let h = Math.imul(seed ^ (x | 0), 0x27d4eb2d)
  h = Math.imul(h ^ (y | 0), 0x165667b1)
  h = Math.imul(h ^ (z | 0), 0x9e3779b1)
  h ^= h >>> 15
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  return (h >>> 0) / 4294967296
}

const lerp = (a, b, t) => a + (b - a) * t

/*
 * Trilinear value noise. Raw hashes give salt-and-pepper speckle; smoothing
 * between lattice points is what turns a threshold into connected VEINS,
 * which is what ore actually looks like.
 */
function noise3(x, y, z, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
  const xf = x - xi, yf = y - yi, zf = z - zi
  // smoothstep, so lattice boundaries don't show as a grid
  const sx = xf * xf * (3 - 2 * xf)
  const sy = yf * yf * (3 - 2 * yf)
  const sz = zf * zf * (3 - 2 * zf)
  const c = (dx, dy, dz) => hash01(xi + dx, yi + dy, zi + dz, seed)
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), sx)
  const x10 = lerp(c(0, 1, 0), c(1, 1, 0), sx)
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), sx)
  const x11 = lerp(c(0, 1, 1), c(1, 1, 1), sx)
  return lerp(lerp(x00, x10, sy), lerp(x01, x11, sy), sz)
}

/*
 * Ore bands, using Minecraft 1.16 depth ranges. `scale` sets vein size
 * (smaller = larger blobs) and `rarity` is the noise threshold above which
 * ore appears -- higher is rarer.
 *
 * Order matters: the first match wins, so the precious ores are listed before
 * the common ones. Coal is far more abundant than diamond, and if coal were
 * tested first it would win nearly every contested voxel.
 *
 * The `rarity` numbers are SOLVED, not hand-picked. A script sampled the noise
 * field over each band and took the quantile that reproduces Minecraft 1.16's
 * real frequencies as a share of the stone region: coal 1%, iron 0.7%,
 * redstone 0.15%, gold 0.1%, diamond 0.08%, lapis 0.05%. It solves them in
 * evaluation order, so each threshold already accounts for the voxels earlier
 * entries claimed -- which is why diorite's looks so much lower than
 * andesite's despite both targeting 3.5%. Re-solve if you touch scale, seed,
 * order or the y-bands.
 */
const ORES = [
  { key: 'diamond_ore',  min: 5, max: 12, scale: 0.20, rarity: 0.9134, seed: 1301 },
  { key: 'redstone_ore', min: 5, max: 12, scale: 0.19, rarity: 0.8852, seed: 2803 },
  { key: 'lapis_ore',    min: 5, max: 30, scale: 0.21, rarity: 0.9574, seed: 3907 },
  { key: 'gold_ore',     min: 5, max: 29, scale: 0.19, rarity: 0.941, seed: 4519 },
  { key: 'iron_ore',     min: 5, max: 54, scale: 0.17, rarity: 0.9036, seed: 5623 },
  { key: 'coal_ore',     min: 5, max: 52, scale: 0.15, rarity: 0.8903, seed: 6733 },
]

/*
 * Stone variants. Much lower scale than ores, because Minecraft's andesite
 * and granite come in large blobs rather than veins.
 */
const VARIANTS = [
  { key: 'gravel',   scale: 0.085, rarity: 0.8468, seed: 7841 },
  { key: 'andesite', scale: 0.060, rarity: 0.8677, seed: 8951 },
  { key: 'diorite',  scale: 0.060, rarity: 0.7744, seed: 9067 },
  { key: 'granite',  scale: 0.060, rarity: 0.8367, seed: 1171 },
]

/*
 * Trees.
 *
 * Placed on a coarse grid with one candidate per cell, jittered inside it, so
 * they scatter without clumping and without any two ever overlapping. The
 * alternative -- a per-column probability -- gives clusters and bald patches,
 * and on an island this small that reads as a bug rather than as nature.
 *
 * Like everything else here this is a pure function of position: a voxel high
 * in a canopy has to be able to work out which trunk it belongs to on its own,
 * because noa may ask for that chunk without ever having asked for the ground
 * beneath it.
 */
const TREE_CELL = 11
const TREE_DENSITY = 0.55
const CANOPY_R = 2
// Leave the spawn point clear so you don't materialise inside a trunk.
const SPAWN_CLEAR = 7

/** @returns {null | {x, z, height}} the tree owned by a grid cell, if any. */
function treeInCell(cellX, cellZ) {
  if (hash01(cellX, 7, cellZ, 5150) > TREE_DENSITY) return null

  // Jitter inside the cell, inset by the canopy radius so a tree can never
  // straddle two cells -- that inset is what makes the 3x3 search below
  // sufficient.
  const span = TREE_CELL - CANOPY_R * 2
  const x = cellX * TREE_CELL + CANOPY_R + Math.floor(hash01(cellX, 8, cellZ, 61) * span)
  const z = cellZ * TREE_CELL + CANOPY_R + Math.floor(hash01(cellX, 9, cellZ, 71) * span)

  // Keep the whole canopy on the island, and off the spawn point.
  const edge = HALF - CANOPY_R - 1
  if (x < -edge || x > edge || z < -edge || z > edge) return null
  if (Math.abs(x) <= SPAWN_CLEAR && Math.abs(z) <= SPAWN_CLEAR) return null

  const height = 4 + Math.floor(hash01(cellX, 10, cellZ, 81) * 3)   // 4..6
  return { x, z, height }
}

/** @returns the block id this tree contributes at a voxel, or 0. */
function treeVoxelFor(tree, x, y, z, ids) {
  const dx = x - tree.x
  const dz = z - tree.z
  const dy = y - SURFACE_Y                 // 0 is the first block above grass
  const topY = tree.height - 1             // trunk's top block, in dy

  if (dx === 0 && dz === 0 && dy >= 0 && dy <= topY) return ids.oak_log

  /*
   * Minecraft's oak canopy: two wide layers around the top of the trunk with
   * their corners cut, then two narrow layers above, the highest also cut.
   * The corner cuts are what stop it reading as a cube of leaves.
   */
  const ax = Math.abs(dx)
  const az = Math.abs(dz)
  const wide = dy === topY - 2 || dy === topY - 1
  const narrow = dy === topY || dy === topY + 1

  if (wide && ax <= 2 && az <= 2 && !(ax === 2 && az === 2)) return ids.oak_leaves
  if (narrow && ax <= 1 && az <= 1) {
    if (dy === topY + 1 && ax === 1 && az === 1) return 0   // cut the top corners
    if (dx === 0 && dz === 0 && dy <= topY) return ids.oak_log
    return ids.oak_leaves
  }
  return 0
}

function treeAt(x, y, z, ids) {
  // A tree is inset from its cell edge by the canopy radius, so anything
  // overlapping this voxel must belong to one of the nine nearest cells.
  const cellX = Math.floor(x / TREE_CELL)
  const cellZ = Math.floor(z / TREE_CELL)
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const tree = treeInCell(cellX + i, cellZ + j)
      if (!tree) continue
      const id = treeVoxelFor(tree, x, y, z, ids)
      if (id) return id
    }
  }
  return 0
}

/**
 * @returns the block id at a world coordinate, or 0 for air/void.
 */
export function getVoxelID(x, y, z, ids) {
  // Above the surface is air, except where a tree stands.
  if (y >= SURFACE_Y) {
    if (x < -HALF || x >= HALF || z < -HALF || z >= HALF) return 0
    return treeAt(x, y, z, ids)
  }
  if (y < 0) return 0

  // Square footprint. Road not taken: a round island, or a noisy coastline.
  // Square won because resume plots are easier to lay out on a hard grid.
  if (x < -HALF || x >= HALF) return 0
  if (z < -HALF || z >= HALF) return 0

  // Bedrock floor. y=0 is always bedrock; 1..4 thin out with height, which is
  // what gives the real thing its ragged underside.
  if (y === 0) return ids.bedrock
  if (y <= BEDROCK_TOP) {
    if (hash01(x, y, z, 4242) < (BEDROCK_TOP + 1 - y) / (BEDROCK_TOP + 1)) return ids.bedrock
  }

  const depth = SURFACE_Y - 1 - y
  if (depth === 0) return ids.grass
  if (depth <= DIRT_DEPTH) return ids.dirt

  for (const ore of ORES) {
    if (y < ore.min || y > ore.max) continue
    if (noise3(x * ore.scale, y * ore.scale, z * ore.scale, ore.seed) > ore.rarity) {
      return ids[ore.key]
    }
  }

  for (const v of VARIANTS) {
    if (noise3(x * v.scale, y * v.scale, z * v.scale, v.seed) > v.rarity) return ids[v.key]
  }

  return ids.stone
}
