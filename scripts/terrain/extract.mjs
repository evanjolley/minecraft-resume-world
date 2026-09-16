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
 *
 * X IS MIRRORED ON THE WAY OUT, and that is the one thing in this file that is
 * not a pure copy. See MIRROR_X below for why.
 */
import { writeFileSync, readFileSync, mkdirSync, existsSync, renameSync, rmSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join, dirname } from 'node:path'
import { classify } from './mapping.mjs'

export const MAGIC = 'VOX1'

/*
 * THE X MIRROR.
 *
 * Minecraft's world is right-handed: +X east, +Y up, +Z south. Stand facing
 * south there and west is on your right. Babylon's scene is LEFT-handed
 * (`useRightHandedSystem` is false, which is noa's default and not ours to
 * change), and a left-handed render of right-handed data is a mirror image.
 *
 * Measured rather than argued, in test/25-orientation.spec.js: at heading 0
 * the camera faces +Z and a point at +X projects to the RIGHT half of the
 * screen. So in this engine, facing +Z, +X is on your right -- which is where
 * Minecraft puts west.
 *
 * This extractor used to copy (x, y, z) straight across, so the engine's +X
 * held Minecraft's east while the player saw it on the side west belongs on.
 * The whole world shipped as a mirror of seed 12345: the ocean that is west of
 * the spawn column in the real save appeared east of it here, and every slope
 * fell away the wrong way.
 *
 * Cancelling a mirror takes exactly ONE axis flip. It happens here, in the
 * data, so that terrain.bin is simply correct and nothing downstream has to
 * carry a compensating sign.
 *
 * X and not Z, because Z is the axis the rest of the world already agrees on:
 * noa's heading 0 faces +Z and the F3 screen calls that south, which makes
 * Minecraft's yaw conversion the identity. Flipping Z instead would put a
 * permanent 180 into every yaw and move spawn's compass reading to north, for
 * no gain -- either flip un-mirrors the world equally well.
 *
 * Rejected:
 *   - flipping at render or lookup time (island.js reading `width - 1 - px`).
 *     The asset stays wrong, the compensation is permanent, and anyone who
 *     reads terrain.bin with a fresh decoder gets a mirrored world.
 *   - renaming the cardinals and leaving the data alone. That was tried for
 *     the F3 compass and it is a different problem: names can be moved, but a
 *     mirrored mountain is still mirrored under any name.
 *
 * WHAT THIS DOES NOT FIX, said plainly so nobody goes looking: +X in this
 * engine is still WEST, and after the flip that is finally TRUE rather than a
 * label papering over mirrored data. You cannot have +X = east AND a compass
 * that turns clockwise in a left-handed scene; see the note in debugScreen.js.
 *
 * Consequence for anyone reading the asset: column 0 is the EAST edge of the
 * source patch (world X = x + size - 1) and column size-1 is the west edge.
 * Z is untouched. The manifest records this as `world.xOrder`.
 */
export const mirrorX = (x, size) => size - 1 - x

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
 *
 * `x` here is an ASSET column index, and it reads the source at the mirrored
 * world X -- see MIRROR_X above. Doing it at the read rather than at the
 * encode means every later stage (the trim, the block report, the encoder)
 * works on data that is already in the engine's frame, and there is exactly
 * one line in the pipeline where the two frames meet.
 */
export function readPatch(world, x0, z0, size, yMin, yMax, { log = console.log } = {}) {
  const counts = new Map()
  const cols = new Array(size * size)
  let highest = yMin

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const wx = x0 + mirrorX(x, size)
      const col = new Array(yMax - yMin + 1)
      for (let y = yMin; y <= yMax; y++) {
        const id = world.block(wx, y, z0 + z) ?? 'minecraft:air'
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
      //
      // `xOrder` is the one field here that is not a coordinate: it says which
      // way round the X axis runs, because the asset is mirrored in X against
      // the source (see MIRROR_X). Written down rather than left implicit,
      // because a mirrored world is the one kind of wrong that looks right,
      // and a reader with a fresh decoder has no other way to find out.
      world: { x: worldX, z: worldZ, size, yMin, yMax: yTop, xOrder: 'descending' },
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
export function emit(outDir, data, manifest, name = 'terrain') {
  mkdirSync(outDir, { recursive: true })
  const stage = join(outDir, '.staging')
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(stage, { recursive: true })

  writeFileSync(join(stage, `${name}.bin`), data)
  writeFileSync(join(stage, `${name}.json`), JSON.stringify(manifest, null, 2))
  /*
   * Records that this world came from Mojang's generator rather than from
   * island.js, mirroring public/textures/.source. A deploy check can read it
   * without parsing the manifest.
   *
   * THE DAY THE OLD COMMENT WARNED ABOUT ARRIVED. It used to be ONE line for
   * the whole directory -- "vanilla-1.21.8-seed-12345" -- on the argument
   * that every asset in here comes from one seed by construction, and it
   * ended by saying that when that stopped being true this line had to
   * change. It stopped being true when the mountain patch landed:
   * nether.bin is seed 12345 and mountains.bin is seed 434533485056755, so a
   * single line is a sentence that is false about one of them, and which one
   * depends on which build ran last.
   *
   * So it is now ONE LINE PER ASSET, merged rather than overwritten:
   *
   *     mountains  vanilla-1.21.8-seed-434533485056755
   *     nether     vanilla-1.21.8-seed-12345
   *
   * Still one file, because the question a deploy check asks is about the
   * DIRECTORY -- see scripts/check-deploy-assets.mjs, which refuses on the
   * directory existing at all and never reads this. This is for a human
   * working out what is on their disk.
   *
   * Merged and not appended: a rebuild of one asset must replace its own line
   * and leave the others alone, or the file grows a history instead of
   * holding a state.
   *
   * REJECTED -- a .source per asset (nether.source, mountains.source). It
   * gives a checker two places to look and two chances to look at the wrong
   * one, which is the objection the original comment raised and which is
   * still correct. What was wrong was not the one-file part.
   */
  const live = join(outDir, '.source')
  const lines = new Map()
  if (existsSync(live)) {
    for (const l of readFileSync(live, 'utf8').split('\n')) {
      const m = /^(\S+)\s+(\S+)$/.exec(l.trim())
      if (m) lines.set(m[1], m[2])
    }
  }
  lines.set(name, `vanilla-${manifest.minecraftVersion}-seed-${manifest.seed}`)
  writeFileSync(join(stage, '.source'),
    [...lines.entries()].sort().map(([k, v]) => `${k.padEnd(10)} ${v}`).join('\n') + '\n')

  for (const f of [`${name}.bin`, `${name}.json`, '.source']) {
    const target = join(outDir, f)
    if (existsSync(target)) rmSync(target, { force: true })
    renameSync(join(stage, f), target)
  }
  rmSync(stage, { recursive: true, force: true })
  return { raw: data.length, gzipped: gzipSync(data, { level: 9 }).length }
}
