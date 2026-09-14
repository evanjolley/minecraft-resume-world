#!/usr/bin/env node
/*
 * Decodes the emitted asset and checks it against the region files it came
 * from, block for block.
 *
 * This exists because every failure mode of an RLE encoder produces a file
 * that looks fine. Wrong varint continuation, an off-by-one in a run length,
 * a palette index written before the palette was complete -- all of them
 * yield a plausible number of plausible bytes, and the first sign of trouble
 * is terrain that looks subtly wrong in a browser weeks later. Comparing
 * against the source is the only check that actually proves anything.
 *
 * The decoder itself now lives in src/terrainFormat.js, because island.js
 * needs one too and two readers of one binary format drift. That gives up
 * something this file used to have -- the decoder was deliberately written
 * fresh, so a round trip proved more than that the encoder agreed with
 * itself. What still stands guard is the comparison below: this checks the
 * decoded bytes against the REGION FILES, not against the encoder, so a
 * format written down wrong still fails here even with one shared reader.
 *
 * ------------------------------------------------------------------------
 * THE X MIRROR, AND HOW THIS STAYS A CHECK RATHER THAN A TAUTOLOGY
 *
 * extract.mjs now mirrors X on the way out (see MIRROR_X there), so the naive
 * repair to this file is to paste the same `size - 1 - x` into the comparison
 * and call it done. That repair is worthless: both sides would then be wrong
 * in the same way for any mirror at all -- including no mirror, or one off by
 * one -- and 4,096,000 green voxels would prove nothing about orientation.
 *
 * Three things keep it honest, and they are three different kinds of argument:
 *
 *   1. THE MAPPING IS DERIVED THE OTHER WAY ROUND. extract walks asset columns
 *      and asks which source X to read. This file walks SOURCE X and computes
 *      which asset column must hold it. `mirrorX` is deliberately NOT imported
 *      -- the two files have to agree having each derived it separately, which
 *      is what catches the off-by-one that a shared helper would hide.
 *
 *   2. A PROOF THAT THE CHECK DISCRIMINATES, from the asset alone. If the
 *      patch were symmetric about its own X midline, then "matches mirrored"
 *      and "matches unmirrored" would be the same statement and passing would
 *      say nothing. So this counts voxels where column x and column
 *      width-1-x disagree. Every one of those is a voxel at which an
 *      UNMIRRORED asset would have failed check 1. The count is printed, and
 *      a symmetric patch is a hard error rather than a quiet pass.
 *
 *   3. AN ANCHOR THROUGH REAL WORLD COORDINATES. The manifest's spawn record
 *      carries both an asset column (`x`) and a Minecraft coordinate
 *      (`worldX`), and src/island.js builds the whole game's origin out of the
 *      first one. This checks that the two describe the same place, by reading
 *      the region file at `worldX` and finding that block in asset column `x`.
 *      That path never touches the mirror formula at all.
 *
 * Between them: 1 says the bytes are right, 2 says 1 could have failed, 3 says
 * the number island.js is built on points at the same column.
 * ------------------------------------------------------------------------
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WORK } from './generate.mjs'
import { worldFor } from './scan.mjs'
import { classify } from './mapping.mjs'
import { decode } from '../../src/terrainFormat.js'
import { MIN_X, MIN_Z } from '../../src/island.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = join(ROOT, 'public', 'terrain')

/** What the source block at a Minecraft coordinate should decode to. */
const wantAt = (world, wx, y, wz) =>
  classify(world.block(wx, y, wz) ?? 'minecraft:air').key ?? 'air'

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  const manifest = JSON.parse(readFileSync(join(OUT, 'terrain.json'), 'utf8'))
  const d = decode(readFileSync(join(OUT, 'terrain.bin')))
  const world = worldFor(join(WORK, `seed-${manifest.seed}`))
  const { x: x0, z: z0 } = manifest.world

  // The asset says which way its X runs. This file does not take that as
  // permission -- it requires the one value it knows how to check.
  if (manifest.world.xOrder !== 'descending') {
    console.error(`manifest world.xOrder is ${JSON.stringify(manifest.world.xOrder)}; expected "descending"`)
    process.exit(1)
  }

  /*
   * 1. Every voxel, against the region files.
   *
   * Walk the SOURCE patch. `wx` is a real Minecraft X; the asset column that
   * must hold it is the distance from the patch's LAST column back to wx,
   * because the asset is written east-to-west. Derived here rather than
   * imported, on purpose.
   */
  const xLast = x0 + d.width - 1
  let checked = 0
  const bad = []
  for (let z = 0; z < d.depth; z++) {
    for (let wx = x0; wx <= xLast; wx++) {
      const ax = xLast - wx
      const col = d.cols[z * d.width + ax]
      for (let y = d.yMin; y <= d.yTop; y++) {
        const got = d.palette[col[y - d.yMin]]
        const want = wantAt(world, wx, y, z0 + z)
        checked++
        if (got !== want && bad.length < 10) {
          bad.push(`asset (${ax},${y},${z}) = world (${wx},${y},${z0 + z}): want ${want}, got ${got}`)
        }
      }
    }
    if (z % 32 === 0) console.log(`    checked row ${z}/${d.depth}`)
  }

  /*
   * 2. Could check 1 have failed? Count voxels the asset does not share with
   * its own X reflection. Comparing the asset to itself needs no region reads
   * and no formula shared with the encoder: it is a statement about the data.
   *
   * An unmirrored asset -- the bug this commit fixes -- differs from the
   * correct one at exactly these voxels, so a large count here is a lower
   * bound on how loudly check 1 would have complained about one.
   */
  let asymmetric = 0
  const height = d.yTop - d.yMin + 1
  for (let z = 0; z < d.depth; z++) {
    for (let x = 0; x < d.width >> 1; x++) {
      const a = d.cols[z * d.width + x]
      const b = d.cols[z * d.width + (d.width - 1 - x)]
      for (let i = 0; i < height; i++) if (a[i] !== b[i]) asymmetric += 2
    }
  }

  /*
   * 3. The anchor island.js is built on. PATCH_ORIGIN_X is spawn.x, and
   * MIN_X is -PATCH_ORIGIN_X, so this is the game's own origin checked
   * against the real Minecraft column the scan chose.
   */
  const sp = manifest.spawn
  const anchorWant = wantAt(world, sp.worldX, sp.y - 1, sp.worldZ)
  const anchorGot = d.palette[d.cols[sp.z * d.width + sp.x][sp.y - 1 - d.yMin]]
  const anchor = []
  if (anchorGot !== anchorWant) {
    anchor.push(`spawn column: asset (${sp.x},${sp.y - 1},${sp.z}) is ${anchorGot}, ` +
                `but world (${sp.worldX},${sp.y - 1},${sp.worldZ}) is ${anchorWant}`)
  }
  if (-MIN_X !== sp.x || -MIN_Z !== sp.z) {
    anchor.push(`src/island.js puts the origin at asset column (${-MIN_X}, ${-MIN_Z}), ` +
                `but the manifest's spawn is (${sp.x}, ${sp.z})`)
  }

  console.log(`decoded ${d.magic} ${d.width}x${d.depth}, y ${d.yMin}..${d.yTop}, ${d.palette.length} keys`)
  console.log(`checked ${checked.toLocaleString()} voxels against the region files`)
  console.log(`${asymmetric.toLocaleString()} voxels differ from their own X reflection ` +
              `(${(asymmetric / checked * 100).toFixed(1)}% -- an unmirrored asset would fail on these)`)
  console.log(`spawn anchor: asset column (${sp.x}, ${sp.z}) = world (${sp.worldX}, ${sp.worldZ}), ${anchorGot}`)

  if (bad.length) {
    console.error(`MISMATCHES:\n  ${bad.join('\n  ')}`)
    process.exit(1)
  }
  if (anchor.length) {
    console.error(`SPAWN ANCHOR:\n  ${anchor.join('\n  ')}`)
    process.exit(1)
  }
  /*
   * Deliberately last, and deliberately fatal. If this ever trips, the run
   * above passed without being able to tell a mirrored asset from an
   * unmirrored one, and "every voxel matches" would be a sentence with no
   * content. Better to fail and make someone find a new way to prove it.
   */
  if (asymmetric < checked / 100) {
    console.error(`this patch is nearly symmetric in X (${asymmetric} differing voxels). ` +
                  `The orientation check above cannot discriminate and is not evidence.`)
    process.exit(1)
  }
  console.log('every voxel matches')
}
