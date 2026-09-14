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
import { readPatch, encode, emit } from './terrain/extract.mjs'
import { classify } from './terrain/mapping.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'terrain')

// Filled in from the scan. See docs/TERRAIN.md for the scores that chose it.
export const CHOSEN = {
  seed: process.env.SEED ?? null,
  x: process.env.PATCH_X != null ? Number(process.env.PATCH_X) : null,
  z: process.env.PATCH_Z != null ? Number(process.env.PATCH_Z) : null,
}

const BEDROCK = -64

/** Extract one patch and report on it. */
export async function build({ seed, x, z, out = OUT, log = console.log }) {
  const dir = join(WORK, `seed-${seed}`)
  if (!existsSync(dir)) throw new Error(`seed ${seed} not generated; run terrain:seeds first`)
  const world = worldFor(dir)

  log(`reading ${PATCH}x${PATCH} at (${x}, ${z}) from seed ${seed}`)
  // Read the full legal range first so the trim is measured, not guessed.
  const { counts, cols, highest } = readPatch(world, x, z, PATCH, BEDROCK, 319, { log })

  /*
   * Trim to the highest block plus a little headroom. The headroom is not
   * decoration: the player needs somewhere to be above the tallest peak, and
   * a patch whose ceiling is the summit is a patch you cannot jump on.
   */
  const yTop = Math.min(319, highest + 8)
  log(`  highest block y=${highest}; trimming ceiling to ${yTop} (${yTop - BEDROCK + 1} of 384 layers kept)`)

  const trimmed = cols.map(c => c.slice(0, yTop - BEDROCK + 1))
  const spawn = pickSpawn(world, x, z)
  const { data, palette, avgRuns, manifest } = encode({
    cols: trimmed, size: PATCH, yMin: BEDROCK, yTop,
    seed, worldX: x, worldZ: z, version: MC_VERSION, spawn,
  })

  const { raw, gzipped } = emit(out, data, manifest)
  log(`  palette ${palette.length} keys, ${avgRuns.toFixed(1)} runs per column`)
  log(`  terrain.bin ${(raw / 1024).toFixed(0)}KB raw, ${(gzipped / 1024).toFixed(0)}KB gzipped`)
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

export function pickSpawn(world, x0, z0, { log = console.log } = {}) {
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
  for (let cz = 24; cz < PATCH - 24; cz += 4) {
    for (let cx = 24; cx < PATCH - 24; cx += 4) {
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
      const centre = 1 - (Math.abs(cx - PATCH / 2) + Math.abs(cz - PATCH / 2)) / PATCH
      const score = biomes.size * 10 + Math.min(peak - g.y, 80) * 0.5 + centre * 10
      if (!best || score > best.score) {
        best = {
          score, x: cx, y: g.y + 1, z: cz,
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
  const { seed, x, z } = CHOSEN
  if (seed == null || x == null || z == null) {
    console.error('no patch chosen. Set SEED, PATCH_X and PATCH_Z, or run terrain:scan first.')
    process.exit(1)
  }
  await build({ seed, x, z })
}
