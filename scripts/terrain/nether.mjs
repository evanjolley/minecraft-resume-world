#!/usr/bin/env node
/*
 * Builds public/terrain/nether.bin -- a 128x128 patch of the Nether from the
 * same seed as the overworld.
 *
 *   node scripts/terrain/nether.mjs          extract, using SEED (default 12345)
 *
 * WHY THIS IS A SEPARATE FILE FROM scripts/build-terrain.mjs, when the two
 * share readPatch, encode and emit and differ in about forty lines.
 *
 * Because the forty lines are not a parameter, they are a different
 * algorithm. build-terrain.mjs reads y -64..319, trims the ceiling to the
 * highest block plus headroom, and picks a spawn by scanning DOWN from the
 * sky. Every one of those is a statement about a world with a sky in it, and
 * all three are wrong here: the Nether is 0..127, its ceiling is bedrock and
 * is the point rather than slack to trim, and scanning down from the sky
 * under a solid roof returns the roof, every time, for every column.
 *
 * Folding that into build-terrain.mjs as `if (nether)` would have put two
 * algorithms in one function and left the overworld -- the world that ships
 * today -- one typo away from a regression for the benefit of a dimension you
 * reach with a slash command. What IS shared is shared: the encoder, the
 * mirror, the manifest and the emit-by-rename discipline all come from
 * extract.mjs untouched, so the two assets are the same format by
 * construction and terrainFormat.js reads both.
 *
 * ------------------------------------------------------------------------
 * THE PATCH CORNER IS DERIVED, NOT CHOSEN.
 *
 * The overworld patch was picked by scoring 128x128 windows on biome variety,
 * relief and tree cover (scan.mjs). None of those three mean anything in the
 * Nether: it is one landscape, its relief is a cave system rather than a
 * skyline, and it has no trees. Scoring windows would have been ceremony
 * around a random pick.
 *
 * So the corner is chosen the other way round. A spawn column is found first
 * (see pickNetherSpawn), and the corner is then set so that column lands at
 * asset index (87, 56) -- the SAME index the overworld's spawn occupies.
 *
 * That is not a coincidence being preserved for tidiness. src/island.js
 * derives MIN_X, MAX_X, MIN_Z, MAX_Z and the barrier wall from that one
 * origin, and they are `export const`, read by the barrier, the debug screen
 * and a dozen specs. Making them per-dimension would have turned four
 * constants into four function calls across files this agent does not own.
 * Pinning the two patches to a shared origin instead buys a property that is
 * worth having on its own terms: **both dimensions occupy the same
 * horizontal coordinate frame.** The world is the same 128x128 window of x
 * and z whichever dimension you are in, the barrier is in the same place, and
 * /nether leaves your x and z alone and changes only your y -- which is a
 * good deal closer to what a portal does than an arbitrary relocation would
 * have been.
 *
 * What it costs: the Nether patch is wherever the spawn search happened to
 * land rather than wherever is prettiest. Given that no window score exists
 * for the Nether, that cost is zero today. If one is ever written, this is
 * the line to revisit.
 * ------------------------------------------------------------------------
 */
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import { WORK, MC_VERSION } from './generate.mjs'
import { worldFor, PATCH } from './scan.mjs'
import { readPatch, encode, emit, mirrorX } from './extract.mjs'
import { classify } from './mapping.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = join(ROOT, 'public', 'terrain')

/*
 * The Nether's build height, and the reason nothing is trimmed off either end.
 *
 * Vanilla builds the Nether between y=0 and y=127 and puts bedrock at both
 * ends: five noisy layers on the floor and five on the roof. 128 layers
 * against the overworld patch's 250, which is most of why the asset is not
 * simply twice the download -- see the size note at the bottom of this file.
 *
 * The overworld extractor trims its ceiling to `highest + 8` because two
 * hundred layers of empty sky are not worth a byte. There is no equivalent
 * saving here and the trim would actively break things: y=127 is bedrock in
 * every single column, so `highest` IS the ceiling, and `highest + 8` would
 * be 135 -- eight layers of air above a roof nobody can get through, encoded
 * for nothing. Taking the range as a constant says what the dimension is
 * rather than measuring a fact that cannot vary.
 */
export const NETHER_Y_MIN = 0
export const NETHER_Y_MAX = 127

/*
 * The asset index the spawn column is pinned to. Must match PATCH_ORIGIN_X
 * and PATCH_ORIGIN_Z in src/island.js; verify-nether checks that it does
 * rather than trusting this comment.
 */
const ORIGIN_X = 87
const ORIGIN_Z = 56

/*
 * How far the spawn must sit from the patch edge, same reason as the
 * overworld's MARGIN: you should not open your eyes facing an invisible wall.
 * Smaller here (24 rather than 40) because the Nether's sightlines are short
 * -- you are in a cave, the fog closes at about 25 blocks, and a wall you
 * cannot see is a wall that is not in your face.
 */
const MARGIN = 24

const AIR = new Set(['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'])
const FLUID = new Set(['minecraft:lava', 'minecraft:water'])

/**
 * Choose a Nether spawn.
 *
 * THE RULE, stated before the code, because the rule is the interesting part:
 *
 *   **the lowest standable floor strictly above the bedrock floor slab, with
 *   two blocks of air over it, at least six blocks of open headroom, and no
 *   lava within three blocks.**
 *
 * Taking those clauses in turn, because each one is a bug that was reasoned
 * about rather than a knob that was turned:
 *
 * LOWEST, not highest, and this is the whole inversion. The overworld's rule
 * is "first solid block scanning down from the sky", which is the surface
 * because there is nothing above the surface. Run it here and it returns
 * y=127 bedrock in 16,384 columns out of 16,384 -- the roof is a surface, it
 * is simply not one you can stand on the top of. There is no "the" surface in
 * a dimension that is solid rock with caves in it, so the question has to be
 * re-asked: of the several floors stacked up a Nether column, which one do
 * you want? The lowest, because the lowest open floor is the main cavern --
 * the one with the lava sea and the sightlines. The upper ones are pockets in
 * the ceiling rock, and waking up in a sealed pocket is the Nether equivalent
 * of spawning in a treetop.
 *
 * STRICTLY ABOVE THE BEDROCK SLAB. The floor bedrock is noisy over y=0..4, so
 * the scan starts at y=5. Starting at 0 would "find" the top of a bedrock
 * ridge and call it standable, which it is -- and it is inside the floor.
 *
 * SIX BLOCKS OF HEADROOM, not the overworld's two. Two is enough not to
 * suffocate and not enough to see: the Nether's floors are often a one-block
 * crawlspace under a netherrack shelf, which passes a two-block check and
 * reads as being buried alive. Six is a room.
 *
 * NO LAVA WITHIN THREE. `ground` already refuses to stand on lava, but the
 * Nether's lava sea has a shoreline and the block beside you is as lethal as
 * the block beneath you -- this world does fifteen seconds on fire on the way
 * out (src/fluids.js) and a visitor who spawns in it has no idea why.
 *
 * WHAT IS DELIBERATELY NOT SCORED: biome variety, relief, and a view. The
 * overworld scores all three. The Nether has one look, the fog stops the view
 * at about 25 blocks so "a peak in sight" is not a thing you can have, and
 * with the view gone the only remaining question is whether the spot is safe
 * and open. So this returns the FIRST column satisfying the rule, scanning
 * outward from the middle of the search area -- deterministic, explicable,
 * and honest about the fact that there is nothing to choose between two
 * netherrack floors.
 */
export function pickNetherSpawn(world, cx0, cz0, reach, { log = console.log } = {}) {
  const solidFloor = (x, y, z) => {
    const b = world.block(x, y, z)
    if (!b || AIR.has(b) || FLUID.has(b)) return false
    // A floor has to be a full cube. Nether sprouts and fungus classify as
    // plants and become air in the asset, so standing "on" one is standing on
    // nothing -- the same class of bug as the overworld's leaves.
    return classify(b).kind === 'mapped'
  }
  const open = (x, y, z) => {
    const b = world.block(x, y, z)
    return b != null && (AIR.has(b) || classify(b).kind === 'plant')
  }
  const lavaNear = (x, y, z) => {
    for (let dy = -1; dy <= 2; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        for (let dz = -3; dz <= 3; dz++) {
          if (world.block(x + dx, y + dy, z + dz) === 'minecraft:lava') return true
        }
      }
    }
    return false
  }

  const candidate = (x, z) => {
    for (let y = 5; y < NETHER_Y_MAX - 8; y++) {
      if (!solidFloor(x, y, z)) continue
      // Two to stand in, six to see in. Checked as one loop so a shelf at +3
      // fails before the lava scan is paid for.
      let head = 0
      while (head < 6 && open(x, y + 1 + head, z)) head++
      if (head < 6) continue
      if (lavaNear(x, y + 1, z)) continue
      return { y: y + 1, block: world.block(x, y, z) }
    }
    return null
  }

  // Outward from the middle of the legal area, in rings, so the answer is the
  // most central column that qualifies rather than the first in raster order
  // (which would always be a corner).
  const half = Math.floor(reach / 2)
  for (let r = 0; r <= half; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        // Ring, not disc: skip anything already covered by a smaller r.
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
        const x = cx0 + dx
        const z = cz0 + dz
        const g = candidate(x, z)
        if (!g) continue
        log(`  spawn world (${x}, ${g.y}, ${z}) standing on ${g.block.replace('minecraft:', '')}, ` +
            `${r} blocks from the search centre`)
        return { worldX: x, worldZ: z, y: g.y, standingOn: g.block }
      }
    }
  }
  return null
}

/** Extract the Nether patch for one seed. */
export async function buildNether({ seed, out = OUT, log = console.log } = {}) {
  const dir = join(WORK, `seed-${seed}-nether`)
  if (!existsSync(dir)) {
    throw new Error(`seed ${seed} has no Nether generated; run terrain:nether:gen first`)
  }
  const world = worldFor(dir, 'nether')

  // Search a box comfortably inside the generated area (radius 96), so the
  // patch that ends up around the spawn is fully generated on every side.
  const spawn = pickNetherSpawn(world, 0, 0, 2 * (96 - PATCH / 2 - MARGIN), { log })
  if (!spawn) throw new Error('no Nether spawn column satisfied the rule')

  /*
   * Derive the corner from the spawn, inverting extract.mjs's X mirror.
   *
   * asset x = mirrorX(worldX - x0) = PATCH - 1 - (worldX - x0), and we want
   * that to equal ORIGIN_X, so x0 = worldX - (PATCH - 1 - ORIGIN_X). Z is not
   * mirrored, so z0 = worldZ - ORIGIN_Z directly. Written out rather than
   * calling mirrorX, because this is the inverse and an inverse that imports
   * the forward function is one typo from being the identity.
   */
  const x0 = spawn.worldX - (PATCH - 1 - ORIGIN_X)
  const z0 = spawn.worldZ - ORIGIN_Z

  log(`reading ${PATCH}x${PATCH} at (${x0}, ${z0}) from seed ${seed} DIM-1`)
  const { counts, cols, highest } = readPatch(
    world, x0, z0, PATCH, NETHER_Y_MIN, NETHER_Y_MAX, { log })
  log(`  highest block y=${highest} of ${NETHER_Y_MAX}; no trim (see NETHER_Y_MAX)`)

  const { data, palette, avgRuns, manifest } = encode({
    cols, size: PATCH, yMin: NETHER_Y_MIN, yTop: NETHER_Y_MAX,
    seed, worldX: x0, worldZ: z0, version: MC_VERSION,
    spawn: {
      x: ORIGIN_X, y: spawn.y, z: ORIGIN_Z,
      worldX: spawn.worldX, worldZ: spawn.worldZ,
      standingOn: spawn.standingOn,
    },
  })
  manifest.dimension = 'minecraft:the_nether'

  const { raw, gzipped } = emit(out, data, manifest, 'nether')
  log(`  palette ${palette.length} keys, ${avgRuns.toFixed(1)} runs per column`)
  log(`  nether.bin ${(raw / 1024).toFixed(0)}KB raw, ${(gzipped / 1024).toFixed(0)}KB gzipped`)
  return { counts, raw, gzipped, palette, manifest, highest }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildNether({ seed: process.env.SEED ?? '12345' })
}
