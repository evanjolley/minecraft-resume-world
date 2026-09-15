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
 * ran 0..127 and spawn sat at (87, 56). Honest, and it makes a coordinate in
 * the game equal a coordinate in the asset -- genuinely useful when debugging
 * the encoder. It lost because every "look at the block under your feet" test
 * in the suite, and every mental model, is written around the origin, and
 * moving spawn off (0, 0) would have churned all of them for no gameplay gain.
 *
 * X USED TO BE 40, AND THE WORLD USED TO BE A MIRROR IMAGE.
 *
 * scripts/terrain/extract.mjs now mirrors X while writing the asset, to cancel
 * Babylon's left-handedness -- the long note is at MIRROR_X there. Spawn is
 * still the same Minecraft column (world X 152 in seed 12345); it has simply
 * moved to the other end of the asset, so the origin moves with it:
 *
 *     new index = (size - 1) - old index = 127 - 40 = 87
 *
 * NOT ASSUMED: this is whatever scripts/terrain/ wrote into terrain.json as
 * `spawn.x`, and `npm run terrain:verify` fails if the two disagree or if that
 * column is not the grass block the scan actually chose.
 *
 * The happy arithmetic, worth knowing when reading old screenshots: 40 + 87 is
 * 127, so a world coordinate in the old asset becomes its own NEGATIVE in the
 * new one. The summit that was at x=63 is at x=-63. Spawn, at 0, does not move.
 */
const PATCH_ORIGIN_X = 87
const PATCH_ORIGIN_Z = 56

/**
 * The y a player stands on at spawn: grass at SURFACE_Y - 1, feet at
 * SURFACE_Y. Same relationship as the old island, different number -- the
 * dark forest floor at the spawn column is at y=135 rather than sea level.
 */
export const SURFACE_Y = 136

export const SPAWN = [0.5, SURFACE_Y + 2, 0.5]

/*
 * The Nether's spawn height, as chosen by scripts/terrain/nether.mjs's own
 * rule -- the lowest standable floor above the bedrock slab, six blocks of
 * headroom, no lava within three. That rule is written out in full there and
 * is not repeated here; what matters at this end is that the answer is a
 * CONSTANT and not a scan.
 *
 * Hardcoded rather than read from nether.json, and that is a real trade. The
 * manifest is fetched by nobody at runtime -- loadTerrain reads .bin only --
 * and adding a second fetch to the boot path to learn one integer would put
 * a network round trip in front of the world appearing. The integer is
 * checked instead: scripts/terrain/verify.mjs's check 4 asserts the asset has
 * a solid floor under this y and six blocks of air above it, so the constant
 * going stale fails a verify rather than dropping a visitor inside a rock.
 *
 * X and Z are 0.5 in both dimensions because both patches are pinned to the
 * same origin -- see the patch corner note in scripts/terrain/nether.mjs. So
 * going to the Nether moves you in y alone, which is as close to a portal as
 * a command gets.
 */
export const NETHER_SURFACE_Y = 75

export const NETHER_SPAWN = [0.5, NETHER_SURFACE_Y + 1, 0.5]

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
 * Every loaded dimension, by name, and which one getVoxelID currently answers
 * for. `patch` above is a cache of `patches.get(current)` rather than a
 * second source of truth: it is read on every voxel of every chunk -- six
 * million lookups for one world -- and a Map.get in that path is a cost paid
 * for nothing, since it can only change when setDimension is called.
 *
 * WHY A SECOND SLOT AT ALL, when the file's own header argues for one.
 *
 * The header's argument was against threading a `patch` ARGUMENT through
 * getVoxelID, and it still stands: the signature is what noa's chunk
 * callback, respawn.js and thirteen spec files are written against. This
 * keeps that signature exactly. What changed is the claim underneath it --
 * "something that is true exactly once per page load" -- which a second
 * dimension makes false.
 *
 * PURITY, restated a third time, because this is the line where it could
 * have been lost. getVoxelID is no longer pure in the plain sense: the same
 * (x, y, z) answers netherrack after setDimension('nether') and grass before
 * it. What it is instead is pure PER DIMENSION, and that is the property noa
 * actually needs -- because noa keys its chunk cache on `noa.worldName` and
 * throws away in-flight chunk data whose worldName no longer matches (see
 * lib/world.js setChunkData). So the contract is: whoever moves this slot
 * must move noa.worldName in the same breath, and src/dimensions.js is the
 * only caller that does. Call setDimension from anywhere else and you get a
 * chunk of the Nether cached under the overworld's name, which is exactly the
 * failure the old comment was guarding against.
 */
const patches = new Map()
let current = 'overworld'

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
export async function loadTerrain(url = '/terrain/terrain.bin', name = 'overworld') {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`terrain: ${res.status} ${res.statusText} for ${url}`)
  const loaded = decode(new Uint8Array(await res.arrayBuffer()))
  patches.set(name, loaded)
  // Loading is not entering. A second dimension is fetched while you are
  // standing in the first one, and swapping the world out from under noa at
  // the moment a fetch resolves would be a change nobody asked for at a time
  // nobody chose. setDimension is the only thing that moves the slot.
  if (name === current) { patch = loaded; idTable = null; idTableFor = null }
  return loaded
}

/** Has this dimension's asset been fetched yet? */
export const isLoaded = (name) => patches.has(name)

/** Which dimension getVoxelID is currently answering for. */
export const currentDimension = () => current

/**
 * Point the world at a different loaded dimension.
 *
 * Callers MUST set noa.worldName to the same string, or noa will serve cached
 * chunks of the old world beside fresh chunks of the new one. See the note on
 * `patches` above; src/dimensions.js does both together and is the only place
 * that should.
 */
export function setDimension(name) {
  const next = patches.get(name)
  if (!next) throw new Error(`setDimension(${JSON.stringify(name)}): not loaded`)
  current = name
  patch = next
  // The palette is per-dimension, so the cached palette-index -> block-id
  // table is too. Forgetting this is the subtle version of the bug: index 2
  // is netherrack in one patch and deepslate in the other, so the world would
  // render as plausible garbage rather than as an error.
  idTable = null
  idTableFor = null
  return next
}

/** For tests and the console: what got loaded, or null. */
export function terrainInfo() {
  if (!patch) return null
  return {
    dimension: current,
    width: patch.width, depth: patch.depth,
    yMin: patch.yMin, yTop: patch.yTop,
    palette: patch.palette.length,
    originX: PATCH_ORIGIN_X, originZ: PATCH_ORIGIN_Z,
    missing: [...missing],
  }
}

/* ---------------- the edges ---------------- */

/*
 * World bounds, in world coordinates. x runs -87..40, z runs -56..71.
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
/*
 * ...and both numbers now come from the patch rather than from here, because
 * the Nether's are 0 and 127 and the overworld's are -64 and 185. The values
 * this file used to hardcode were exactly `patch.yMin` and `patch.yTop` for
 * the overworld asset -- bedrock at the floor, and the trim at highest + 8 --
 * so deriving them changes nothing about the world that ships today and
 * makes the wall correct in a dimension whose roof is solid.
 *
 * Reading them off the patch is also the only version that cannot drift: a
 * re-extraction that moves the trim moves the wall with it, where a constant
 * would have quietly left a gap at the top of the world.
 */
const barrierBottom = () => patch.yMin
const barrierTop = () => patch.yTop

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
    return (y >= barrierBottom() && y <= barrierTop()) ? ids.barrier : 0
  }
  if (y < patch.yMin || y > patch.yTop) return 0

  return idTable[patch.cols[pz * patch.width + px][y - patch.yMin]]
}
