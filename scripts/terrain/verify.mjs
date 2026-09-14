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
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WORK } from './generate.mjs'
import { worldFor } from './scan.mjs'
import { classify } from './mapping.mjs'
import { decode } from '../../src/terrainFormat.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = join(ROOT, 'public', 'terrain')

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  const manifest = JSON.parse(readFileSync(join(OUT, 'terrain.json'), 'utf8'))
  const d = decode(readFileSync(join(OUT, 'terrain.bin')))
  const world = worldFor(join(WORK, `seed-${manifest.seed}`))
  const { x: x0, z: z0 } = manifest.world

  let checked = 0
  const bad = []
  for (let z = 0; z < d.depth; z++) {
    for (let x = 0; x < d.width; x++) {
      const col = d.cols[z * d.width + x]
      for (let y = d.yMin; y <= d.yTop; y++) {
        const got = d.palette[col[y - d.yMin]]
        const src = world.block(x0 + x, y, z0 + z) ?? 'minecraft:air'
        const { key } = classify(src)
        const want = key ?? 'air'
        checked++
        if (got !== want && bad.length < 10) bad.push(`(${x},${y},${z}) ${src} -> want ${want}, got ${got}`)
      }
    }
  }
  console.log(`decoded ${d.magic} ${d.width}x${d.depth}, y ${d.yMin}..${d.yTop}, ${d.palette.length} keys`)
  console.log(`checked ${checked.toLocaleString()} voxels against the region files`)
  if (bad.length) {
    console.error(`MISMATCHES:\n  ${bad.join('\n  ')}`)
    process.exit(1)
  }
  console.log('every voxel matches')
}
