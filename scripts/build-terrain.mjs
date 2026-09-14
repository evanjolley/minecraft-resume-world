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
import { fileURLToPath } from 'node:url'
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
 * A spawn the player can actually stand on: solid ground, two blocks of air
 * above it, not in water, near the middle of the patch so every edge is a
 * walk away rather than a wall in the face.
 */
export function pickSpawn(world, x0, z0) {
  const mid = PATCH / 2
  let best = null
  for (let r = 0; r < mid && !best; r++) {
    for (let dz = -r; dz <= r && !best; dz++) {
      for (let dx = -r; dx <= r && !best; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
        const x = x0 + mid + dx
        const z = z0 + mid + dz
        for (let y = 200; y > BEDROCK; y--) {
          const b = world.block(x, y, z)
          if (!b || b === 'minecraft:air' || b === 'minecraft:cave_air') continue
          if (b === 'minecraft:water' || b === 'minecraft:lava') break
          const { kind } = classify(b)
          if (kind !== 'mapped') break
          const a1 = world.block(x, y + 1, z)
          const a2 = world.block(x, y + 2, z)
          if (a1 === 'minecraft:air' && a2 === 'minecraft:air') {
            best = { x: x - x0, y: y + 1, z: z - z0, worldX: x, worldZ: z, standingOn: b }
          }
          break
        }
      }
    }
  }
  return best
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { seed, x, z } = CHOSEN
  if (seed == null || x == null || z == null) {
    console.error('no patch chosen. Set SEED, PATCH_X and PATCH_Z, or run terrain:scan first.')
    process.exit(1)
  }
  await build({ seed, x, z })
}
