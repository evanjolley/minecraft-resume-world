/*
 * The world: a 128x128 patch of REAL Minecraft 1.21.8 terrain, seed 12345,
 * cut from world corner (112, -32) and shipped as public/terrain/terrain.bin.
 * scripts/terrain/ generated it; src/terrainFormat.js decodes it.
 *
 * This file used to BUILD an 80x80 island out of noise functions. It now looks
 * one up. The function signature did not change, and that is the point --
 * everything downstream (noa's chunk callback, the tests, the future
 * diff-based persistence layer) was written against a pure
 * getVoxelID(x, y, z, ids) and none of it had to care that the answer now
 * comes from a table instead of from arithmetic.
 *
 * PURITY, restated, because it now needs restating. "Pure" here means: for a
 * given (x, y, z) the answer is always the same. A lookup into immutable data
 * satisfies that exactly as a noise function does -- noa may ask for chunks in
 * any order, twice, or on a worker, and every answer still agrees with every
 * other. What would break it is a lookup that returns air before the data has
 * arrived and stone afterwards, which is why loadTerrain() is a hard gate
 * rather than a best effort. See below.
 *
 * WHY 128x128 AND NOT MORE: the asset is 981KB raw / 404KB gzipped against a
 * 1.27MB bundle. Doubling the footprint quadruples that. 128 blocks is eight
 * Minecraft chunks -- enough that the far side is a walk, not a glance.
 */
import { decode } from './terrainFormat.js'

/*
 * Where the patch sits in world coordinates.
 *
 * The patch's own indices run 0..127. World coordinates are those minus this
 * origin, which is the column scripts/terrain/scan.mjs scored as the best
 * spawn: grass, two blocks of headroom, 40 blocks clear of every edge, four
 * biomes and a peak visible from it. Putting it at world (0, 0) means the
 * interesting spot is the origin, the way spawn was the origin before.
 *
 * Road not taken: leaving patch indices AS world coordinates, so the world
 * ran 0..127 and spawn sat at (40, 56). Honest, and it makes a coordinate in
 * the game equal a coordinate in the asset -- genuinely useful when debugging
 * the encoder. It lost because every "look at the block under your feet" test
 * in the suite, and every mental model, is written around the origin, and
 * moving spawn off (0, 0) would have churned all of them for no gameplay gain.
 */
const PATCH_ORIGIN_X = 40
const PATCH_ORIGIN_Z = 56

/**
 * The y a player stands on at spawn: grass at SURFACE_Y - 1, feet at
 * SURFACE_Y. Same relationship as the old island, different number -- the
 * dark forest floor at the spawn column is at y=135 rather than sea level.
 */
export const SURFACE_Y = 136

export const SPAWN = [0.5, SURFACE_Y + 2, 0.5]

/*
 * Void death.
 *
 * The old island floated in open void and this sat just under its bedrock at
 * y=-60, so walking off an edge killed you. The imported patch has bedrock at
 * y=-64 running up to y=-60, and BARRIER walls on all four sides -- so -60 is
 * now inside solid rock and nothing could ever reach it.
 *
 * Moved to -70, below the world floor at -64. That keeps the void real and
 * keeps the death path exercised, but it is now reachable only the way it is
 * reachable in Minecraft: not by walking. See BARRIER_* below.
 */
export const VOID_Y = -70

/* ---------------- the data ---------------- */

/*
 * Module state, deliberately. The alternative -- threading a `patch` argument
 * through getVoxelID -- would have changed the signature that noa's chunk
 * callback, respawn.js and thirteen spec files are written against, to express
 * something that is true exactly once per page load.
 */
let patch = null

/*
 * Palette index -> engine block id, rebuilt whenever a different `ids` table
 * is passed in. There is only ever one in practice; the cache key exists so
 * that a second Engine in the same page (tests have done this) can't silently
 * read the first one's ids.
 */
let idTable = null
let idTableFor = null

/** Keys in the patch palette with no block in blocks.js. Should stay empty. */
const missing = new Set()

/**
 * Decode the asset and make it the world.
 *
 * Must complete BEFORE noa's Engine is constructed -- main.js awaits it. The
 * engine asks for chunks within a tick of being built, and a chunk answered
 * once is cached by noa forever, so there is no "load it later" that does not
 * also mean "invalidate and re-mesh everything".
 */
export async function loadTerrain(url = '/terrain/terrain.bin') {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`terrain: ${res.status} ${res.statusText} for ${url}`)
  patch = decode(new Uint8Array(await res.arrayBuffer()))
  idTable = null
  idTableFor = null
  return patch
}

/** For tests and the console: what got loaded, or null. */
export function terrainInfo() {
  if (!patch) return null
  return {
    width: patch.width, depth: patch.depth,
    yMin: patch.yMin, yTop: patch.yTop,
    palette: patch.palette.length,
    originX: PATCH_ORIGIN_X, originZ: PATCH_ORIGIN_Z,
    missing: [...missing],
  }
}

/* ---------------- the edges ---------------- */

/*
 * World bounds, in world coordinates. x runs -40..87, z runs -56..71.
 * Exported because the tests and the barrier both need to agree on them, and
 * because "where does the world stop" is the first thing anyone asks.
 */
export const MIN_X = -PATCH_ORIGIN_X
export const MAX_X = 128 - PATCH_ORIGIN_X - 1
export const MIN_Z = -PATCH_ORIGIN_Z
export const MAX_Z = 128 - PATCH_ORIGIN_Z - 1

/*
 * The barrier wall.
 *
 * Minecraft's barrier: solid, unbreakable, invisible. Registered in blocks.js
 * with `opaque: false` and NO material, which is not a detail -- see the long
 * note there. It stands in every column outside the patch, from the world
 * floor up to the top of the encoded range.
 *
 * Why a wall at all, when the old world's whole first experience was falling
 * off the edge: an 80x80 island in void reads as a thing you are standing ON.
 * A 128x128 window cut out of a real world does not -- it has a coastline, a
 * mountain and four biomes running off the edges, and walking to the edge of
 * that and dropping into nothing reads as a bug rather than as a design. The
 * invisible wall is the same lie Minecraft's own world border tells.
 *
 * BARRIER_TOP is the top of the encoded data, not infinity, because creative
 * flight above it should feel like leaving the world rather than scraping
 * along glass. The highest terrain in the patch is y=177, so the wall clears
 * it by eight.
 */
const BARRIER_BOTTOM = -64
const BARRIER_TOP = 185

/* ---------------- the lookup ---------------- */

function buildIdTable(ids) {
  missing.clear()
  idTable = new Uint16Array(patch.palette.length)
  patch.palette.forEach((key, i) => {
    if (key === 'air') { idTable[i] = 0; return }
    const id = ids[key]
    if (id === undefined) { missing.add(key); idTable[i] = 0; return }
    idTable[i] = id
  })
  idTableFor = ids
}

/**
 * @returns the block id at a world coordinate, or 0 for air.
 *
 * Pure: same coordinate, same answer, every time, in any order, on any worker.
 */
export function getVoxelID(x, y, z, ids) {
  // Before loadTerrain() resolves this would answer air for the whole world,
  // and noa would cache that. Better to be loud: an engine built too early is
  // a bug in boot order, not a transient.
  if (!patch) throw new Error('getVoxelID before loadTerrain() -- see main.js')
  if (ids !== idTableFor) buildIdTable(ids)

  const px = x - MIN_X
  const pz = z - MIN_Z
  if (px < 0 || px >= patch.width || pz < 0 || pz >= patch.depth) {
    return (y >= BARRIER_BOTTOM && y <= BARRIER_TOP) ? ids.barrier : 0
  }
  if (y < patch.yMin || y > patch.yTop) return 0

  return idTable[patch.cols[pz * patch.width + px][y - patch.yMin]]
}
