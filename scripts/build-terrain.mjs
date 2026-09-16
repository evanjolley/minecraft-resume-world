#!/usr/bin/env node
/*
 * Builds public/terrain/ from a patch of real Minecraft terrain.
 *
 *   npm run terrain:seeds     -> generate candidate worlds (slow, needs a JVM)
 *   npm run terrain:scan      -> score every 128x128 window and print a table
 *   npm run terrain           -> extract the chosen patch into public/terrain/
 *
 * The three stages are separate commands on purpose. Generating worlds takes
 * minutes and a few hundred megabytes of disk; extracting takes seconds. Once
 * a seed and a corner are chosen they go in CHOSEN below, and the only stage
 * anyone needs to run again is the last one.
 *
 * public/terrain/ is generated and gitignored, for the same reason
 * public/textures/ is -- with one difference worth being honest about. The
 * textures rule is settled: Mojang's art is not redistributable. This is the
 * OUTPUT of Mojang's world generator, which is a genuinely different question
 * and one this repo has not answered. docs/DEPLOYMENT.md carries it as an
 * open question at the deploy gate. Until it is answered the conservative
 * reading applies and this data does not ship.
 */
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import { WORK, MC_VERSION } from './terrain/generate.mjs'
import { worldFor, survey, bestWindows, PATCH } from './terrain/scan.mjs'
import { readPatch, encode, emit, mirrorX } from './terrain/extract.mjs'
import { classify } from './terrain/mapping.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'terrain')

// Filled in from the scan. See docs/TERRAIN.md for the scores that chose it.
export const CHOSEN = {
  seed: process.env.SEED ?? null,
  x: process.env.PATCH_X != null ? Number(process.env.PATCH_X) : null,
  z: process.env.PATCH_Z != null ? Number(process.env.PATCH_Z) : null,
  size: process.env.PATCH_SIZE != null ? Number(process.env.PATCH_SIZE) : PATCH,
  name: process.env.PATCH_NAME ?? 'terrain',
  /* SPAWN_AT=x,z -- a column chosen by ray test rather than by pickSpawn's
   * score. See build() for why this exists at all. */
  spawnAt: process.env.SPAWN_AT
    ? process.env.SPAWN_AT.split(',').map(Number)
    : null,
}

const BEDROCK = -64

/**
 * Extract one patch and report on it.
 *
 * `size` IS NOT `PATCH` ANY MORE, and that is the one change in this file that
 * ripples. scan.mjs's PATCH is the width of the window the SCORER measures --
 * 128, fixed, and the published score table in docs/TERRAIN.md is only
 * comparable because it never moves. The width of the patch we EXTRACT is a
 * different number that happens to have been the same one, and seed
 * 434533485056755 is where it stops being: its mountains are 250 blocks
 * across, so a 128 box cuts every one of them in half. PATCH stays the
 * scorer's; `size` is the extractor's, and it defaults to PATCH so the old
 * calls mean what they always meant.
 *
 * `spawnAt` is an ESCAPE FROM pickSpawn, deliberately. See the note there: the
 * scan below scores a column on biomes and peak HEIGHT, neither of which is
 * a claim that you can see any of it. For the mountain seed the spawn was
 * chosen with scripts/terrain/seed-view.mjs instead -- a ray test that knows
 * the difference between a mountain and a wall of leaves -- and handed in
 * here as a world coordinate.
 *
 * @param spawnAt [worldX, worldZ] to stand on, or null to run pickSpawn.
 * @param name    the asset basename under public/terrain/.
 */
export async function build({
  seed, x, z, size = PATCH, name = 'terrain', spawnAt = null,
  out = OUT, log = console.log,
}) {
  const dir = join(WORK, `seed-${seed}`)
  if (!existsSync(dir)) throw new Error(`seed ${seed} not generated; run terrain:seeds first`)
  const world = worldFor(dir)

  log(`reading ${size}x${size} at (${x}, ${z}) from seed ${seed}`)
  // Read the full legal range first so the trim is measured, not guessed.
  const { counts, cols, highest } = readPatch(world, x, z, size, BEDROCK, 319, { log })

  /*
   * Trim to the highest block plus a little headroom. The headroom is not
   * decoration: the player needs somewhere to be above the tallest peak, and
   * a patch whose ceiling is the summit is a patch you cannot jump on.
   */
  const yTop = Math.min(319, highest + 8)
  log(`  highest block y=${highest}; trimming ceiling to ${yTop} (${yTop - BEDROCK + 1} of 384 layers kept)`)

  const trimmed = cols.map(c => c.slice(0, yTop - BEDROCK + 1))
  const spawn = spawnAt
    ? standOn(world, x, z, size, spawnAt[0], spawnAt[1], { log })
    : pickSpawn(world, x, z, { size, log })
  const { data, palette, avgRuns, manifest } = encode({
    cols: trimmed, size, yMin: BEDROCK, yTop,
    seed, worldX: x, worldZ: z, version: MC_VERSION, spawn,
  })

  const { raw, gzipped } = emit(out, data, manifest, name)
  log(`  palette ${palette.length} keys, ${avgRuns.toFixed(1)} runs per column`)
  log(`  ${name}.bin ${(raw / 1024).toFixed(0)}KB raw, ${(gzipped / 1024).toFixed(0)}KB gzipped`)
  if (gzipped > 1024 * 1024) {
    log('  !! over 1MB gzipped. Trim the vertical range before shipping this.')
  }
  return { counts, raw, gzipped, palette, manifest, yTop, highest }
}

/**
 * Choose a spawn, and choose it for a reason.
 *
 * "First solid block from the top" is the obvious implementation and it is
 * wrong here in a way that took a run to see: in a dark forest the first
 * solid block from the top is LEAVES, so the obvious version spawns the
 * player standing on a treetop 20 blocks above the ground. Tree parts have to
 * be skipped explicitly to find the floor underneath.
 *
 * Beyond standable, candidates are scored on what you can SEE from them,
 * because that is the entire point of picking a nexus patch:
 *
 *   - distinct biomes within sight, so the view has more than one landscape
 *   - how much higher the tallest nearby peak is, so a mountain reads as a
 *     mountain rather than as the wall of a valley you are stuck in
 *   - a mild pull toward the middle of the patch, so no barrier wall is
 *     immediately in your face
 */
const TREE_PART = n => n.includes('_leaves') || n.includes('_log') || n.includes('_wood')

/*
 * Keep the spawn this far from every edge. The patch is walled with barrier
 * blocks, and spawning a player facing one at arm's length is the fastest
 * possible way to communicate "this is a diorama, not a world". The first
 * pass allowed 24 and picked it, because four biomes in sight outscored
 * being anywhere in particular; the centre term now carries enough weight to
 * matter against that.
 */
const MARGIN = 40

/**
 * The floor of one column, skipping everything that is ON the floor rather
 * than part of it. Lifted out of pickSpawn so `standOn` can use the SAME
 * rule -- a hand-picked spawn and a scored one must agree about where the
 * ground is, or the manifest's `y` means two different things depending on
 * which path wrote it.
 */
function groundAt(world, x, z) {
  for (let y = 250; y > BEDROCK; y--) {
    const b = world.block(x, y, z)
    if (!b) return null
    if (b === 'minecraft:air' || b === 'minecraft:cave_air') continue
    if (TREE_PART(b)) continue
    if (b === 'minecraft:water' || b === 'minecraft:lava') return null
    const { kind } = classify(b)
    if (kind === 'plant' || kind === 'structure') continue
    if (kind !== 'mapped') return null
    return { y, block: b }
  }
  return null
}

/**
 * Turn a chosen world coordinate into the manifest's spawn record.
 *
 * No search and no score: the choosing already happened, in
 * scripts/terrain/seed-view.mjs, against what a ray can actually reach. All
 * this does is find the floor and convert the column into the mirrored asset
 * index that src/island.js builds its origin from -- which is exactly the
 * conversion pickSpawn gets wrong if you read its `x` as a world coordinate.
 */
export function standOn(world, x0, z0, size, wx, wz, { log = console.log } = {}) {
  const g = groundAt(world, wx, wz)
  if (!g) throw new Error(`no standable ground at (${wx}, ${wz})`)
  const cx = wx - x0, cz = wz - z0
  if (cx < 0 || cx >= size || cz < 0 || cz >= size) {
    throw new Error(`spawn (${wx}, ${wz}) is outside the patch at (${x0}, ${z0})+${size}`)
  }
  const spawn = {
    x: mirrorX(cx, size), y: g.y + 1, z: cz,
    worldX: wx, worldZ: wz,
    standingOn: g.block,
    /* Why this column and not a scored one. Written into the manifest because
     * the manifest is the only thing that survives into src/island.js. */
    chosenBy: 'scripts/terrain/seed-view.mjs (ray-cast occlusion), not scan.mjs',
  }
  log(`  spawn (${spawn.x}, ${spawn.y}, ${spawn.z}) = world (${wx}, ${wz}) ` +
      `on ${g.block.replace('minecraft:', '')}`)
  return spawn
}

export function pickSpawn(world, x0, z0, { size = PATCH, log = console.log } = {}) {
  const ground = (x, z) => {
    for (let y = 250; y > BEDROCK; y--) {
      const b = world.block(x, y, z)
      if (!b) return null
      if (b === 'minecraft:air' || b === 'minecraft:cave_air') continue
      if (TREE_PART(b)) continue
      if (b === 'minecraft:water' || b === 'minecraft:lava') return null
      const { kind } = classify(b)
      // Snow layers, grass and the rest are not floors; keep descending.
      if (kind === 'plant' || kind === 'structure') continue
      if (kind !== 'mapped') return null
      return { y, block: b }
    }
    return null
  }

  // Sample a coarse grid rather than every column: 16k ground scans is slow
  // and the answer does not change between neighbouring blocks.
  const heights = new Map()
  const at = (x, z) => {
    const k = `${x},${z}`
    if (!heights.has(k)) heights.set(k, ground(x, z))
    return heights.get(k)
  }

  let best = null
  for (let cz = MARGIN; cz < size - MARGIN; cz += 4) {
    for (let cx = MARGIN; cx < size - MARGIN; cx += 4) {
      const x = x0 + cx
      const z = z0 + cz
      const g = at(x, z)
      if (!g) continue
      // Head room. Leaves overhead are fine to stand under; solid rock is not.
      const clear = [1, 2].every(d => {
        const b = world.block(x, g.y + d, z)
        return b === 'minecraft:air' || b === 'minecraft:cave_air' || (b && TREE_PART(b))
      })
      if (!clear) continue

      const biomes = new Set()
      let peak = g.y
      for (let r = 8; r <= 48; r += 8) {
        for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) {
          const b = world.biome(x + dx, g.y, z + dz)
          if (b) biomes.add(b)
          const n = at(x + dx, z + dz)
          if (n && n.y > peak) peak = n.y
        }
      }
      const centre = 1 - (Math.abs(cx - size / 2) + Math.abs(cz - size / 2)) / size
      const score = biomes.size * 10 + Math.min(peak - g.y, 80) * 0.5 + centre * 25
      if (!best || score > best.score) {
        best = {
          /*
           * `x` is the column in the EMITTED ASSET, which is mirrored in X
           * against the source (extract.mjs MIRROR_X); `worldX` is the real
           * Minecraft coordinate and is not. src/island.js sets
           * PATCH_ORIGIN_X from this field, so getting it wrong moves spawn
           * to the mirror-image column -- which is grass at some other
           * height, and looks like a broken asset rather than a broken index.
           *
           * The SEARCH above still runs in source coordinates, deliberately.
           * Mirroring the scan too would change the centre term by one block
           * and could pick a different column; leaving it means this commit
           * moves the world and not the spawn.
           */
          score, x: mirrorX(cx, size), y: g.y + 1, z: cz,
          worldX: x, worldZ: z,
          standingOn: g.block,
          biomesInSight: [...biomes],
          peakInSight: peak,
          peakRise: peak - g.y,
        }
      }
    }
  }
  if (best) {
    log(`  spawn (${best.x}, ${best.y}, ${best.z}) on ${best.standingOn.replace('minecraft:', '')}; ` +
        `${best.biomesInSight.length} biomes in sight, peak ${best.peakInSight} (+${best.peakRise})`)
  }
  return best
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { seed, x, z, size, name, spawnAt } = CHOSEN
  if (seed == null || x == null || z == null) {
    console.error('no patch chosen. Set SEED, PATCH_X and PATCH_Z, or run terrain:scan first.')
    process.exit(1)
  }
  await build({ seed, x, z, size, name, spawnAt })
}
