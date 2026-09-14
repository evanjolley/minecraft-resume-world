#!/usr/bin/env node
/*
 * Turns a 128x128 column of a generated world into a compact binary asset
 * plus a manifest.
 *
 * The size problem, stated plainly: 128 x 128 x 384 is 6.3 million voxels.
 * One byte each is 6.3MB, against a bundle that is currently 1.27MB. Storing
 * it naively is not an option, so two things happen.
 *
 * First, the vertical range is TRIMMED to what the patch actually occupies --
 * bedrock up to a little above the highest block. Two hundred blocks of air
 * over the mountain are not worth a single byte.
 *
 * Second, each column is run-length encoded down Y. This suits the data
 * almost unreasonably well: a column of real terrain is a handful of enormous
 * runs -- deepslate, stone, dirt, one grass, then air -- so the count of runs
 * per column lands in the low tens rather than the hundreds. RLE down Y beats
 * RLE in any other axis for the same reason, and it is the axis the engine
 * reads along when it builds a chunk.
 *
 * Lengths and palette indices are varints. Runs are frequently longer than
 * 255 (a stone column below a mountain is one run of ~200) and a palette
 * index is almost always one byte, so a fixed-width pair wastes space at both
 * ends.
 */
import { writeFileSync, mkdirSync, existsSync, renameSync, rmSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join, dirname } from 'node:path'
import { classify } from './mapping.mjs'

export const MAGIC = 'VOX1'

/** Varint writer over a growable byte array. */
class Writer {
  constructor() { this.bytes = [] }
  u8(v) { this.bytes.push(v & 0xff) }
  varint(v) {
    while (v >= 0x80) { this.bytes.push((v & 0x7f) | 0x80); v >>>= 7 }
    this.bytes.push(v)
  }
  str(s) {
    const b = Buffer.from(s, 'utf8')
    this.varint(b.length)
    for (const x of b) this.bytes.push(x)
  }
  i32(v) {
    this.bytes.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff)
  }
  buffer() { return Buffer.from(this.bytes) }
}

/**
 * Read the patch, count every block id, and decide the vertical range.
 * Separated from encoding because the block report wants the counts whether
 * or not an asset is written.
 */
export function readPatch(world, x0, z0, size, yMin, yMax, { log = console.log } = {}) {
  const counts = new Map()
  const cols = new Array(size * size)
  let highest = yMin

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const col = new Array(yMax - yMin + 1)
      for (let y = yMin; y <= yMax; y++) {
        const id = world.block(x0 + x, y, z0 + z) ?? 'minecraft:air'
        counts.set(id, (counts.get(id) ?? 0) + 1)
        col[y - yMin] = id
        if (id !== 'minecraft:air' && id !== 'minecraft:cave_air' && id !== 'minecraft:void_air') {
          if (y > highest) highest = y
        }
      }
      cols[z * size + x] = col
    }
    if (z % 32 === 0) log(`    read row ${z}/${size}`)
  }
  return { counts, cols, highest }
}

/**
 * Encode the patch. `cols` carries raw minecraft ids; mapping to engine keys
 * happens here so the dropped-block accounting is done in one place.
 */
export function encode({ cols, size, yMin, yTop, seed, worldX, worldZ, version, spawn }) {
  // Palette of ENGINE keys, not minecraft ids. Several vanilla blocks collapse
  // onto one key (all the air variants, flowing and still water), and the
  // palette should reflect what the engine will actually store.
  const palette = ['air']
  const index = new Map([['air', 0]])
  const keyFor = id => {
    const { kind, key } = classify(id)
    // Plants and non-cube structures become air. They are counted and
    // reported by the caller; here they are simply absent.
    if (!key) return 0
    if (!index.has(key)) { index.set(key, palette.length); palette.push(key) }
    return index.get(key)
  }

  const w = new Writer()
  for (const c of MAGIC) w.u8(c.charCodeAt(0))
  w.i32(size)
  w.i32(size)
  w.i32(yMin)
  w.i32(yTop)

  // Columns are encoded into a scratch buffer first, because the palette is
  // not complete until every column has been walked.
  const body = new Writer()
  const height = yTop - yMin + 1
  let totalRuns = 0
  for (let i = 0; i < size * size; i++) {
    const col = cols[i]
    const runs = []
    let cur = keyFor(col[0])
    let len = 1
    for (let y = 1; y < height; y++) {
      const k = keyFor(col[y])
      if (k === cur) { len++; continue }
      runs.push([len, cur]); cur = k; len = 1
    }
    runs.push([len, cur])
    body.varint(runs.length)
    for (const [l, k] of runs) { body.varint(l); body.varint(k) }
    totalRuns += runs.length
  }

  w.varint(palette.length)
  for (const k of palette) w.str(k)
  const head = w.buffer()
  const data = Buffer.concat([head, body.buffer()])

  return {
    data,
    palette,
    totalRuns,
    avgRuns: totalRuns / (size * size),
    manifest: {
      format: MAGIC,
      generator: 'scripts/terrain/extract.mjs',
      minecraftVersion: version,
      seed,
      // Where in the generated world this patch was cut from. Recorded so the
      // exact same blocks can be regenerated from the seed alone.
      world: { x: worldX, z: worldZ, size, yMin, yMax: yTop },
      palette,
      spawn,
    },
  }
}

/**
 * Write the asset and manifest, staging first.
 *
 * Same discipline as scripts/build-textures.mjs: build beside the live files
 * and rename into place, so a rebuild that dies partway through never leaves
 * a half-written world for a running dev server to load.
 */
export function emit(outDir, data, manifest) {
  mkdirSync(outDir, { recursive: true })
  const stage = join(outDir, '.staging')
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(stage, { recursive: true })

  writeFileSync(join(stage, 'terrain.bin'), data)
  writeFileSync(join(stage, 'terrain.json'), JSON.stringify(manifest, null, 2))
  // Records that this world came from Mojang's generator rather than from
  // island.js, mirroring public/textures/.source. A deploy check can read it
  // without parsing the manifest.
  writeFileSync(join(stage, '.source'), `vanilla-${manifest.minecraftVersion}-seed-${manifest.seed}\n`)

  for (const f of ['terrain.bin', 'terrain.json', '.source']) {
    const live = join(outDir, f)
    if (existsSync(live)) rmSync(live, { force: true })
    renameSync(join(stage, f), live)
  }
  rmSync(stage, { recursive: true, force: true })
  return { raw: data.length, gzipped: gzipSync(data, { level: 9 }).length }
}
