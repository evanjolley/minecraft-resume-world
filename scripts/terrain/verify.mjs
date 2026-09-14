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
 * The decoder here is deliberately written fresh rather than shared with the
 * encoder. A round-trip through one body of code mostly proves that code is
 * self-consistent; this is meant to catch the case where the format itself
 * was written down wrong.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WORK } from './generate.mjs'
import { worldFor } from './scan.mjs'
import { classify } from './mapping.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = join(ROOT, 'public', 'terrain')

export function decode(buf) {
  let p = 0
  const magic = buf.subarray(0, 4).toString('ascii'); p = 4
  const i32 = () => { const v = buf.readInt32LE(p); p += 4; return v }
  const varint = () => {
    let v = 0, s = 0, b
    do { b = buf[p++]; v |= (b & 0x7f) << s; s += 7 } while (b & 0x80)
    return v >>> 0
  }
  const width = i32(), depth = i32(), yMin = i32(), yTop = i32()
  const palette = []
  const n = varint()
  for (let i = 0; i < n; i++) {
    const len = varint()
    palette.push(buf.subarray(p, p + len).toString('utf8')); p += len
  }
  const height = yTop - yMin + 1
  const cols = new Array(width * depth)
  for (let i = 0; i < width * depth; i++) {
    const runs = varint()
    const col = new Uint16Array(height)
    let y = 0
    for (let r = 0; r < runs; r++) {
      const len = varint(), k = varint()
      col.fill(k, y, y + len)
      y += len
    }
    if (y !== height) throw new Error(`column ${i} covers ${y} of ${height} layers`)
    cols[i] = col
  }
  if (p !== buf.length) throw new Error(`${buf.length - p} trailing bytes`)
  return { magic, width, depth, yMin, yTop, palette, cols }
}

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
