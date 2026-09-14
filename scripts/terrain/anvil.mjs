#!/usr/bin/env node
/*
 * Reads Mojang's Anvil region files (.mca) far enough to answer one question:
 * what block is at (x, y, z)?
 *
 * prismarine-nbt does the NBT decode. The container format around it -- the
 * sector table, the per-chunk compression header, and the bit-packed block
 * indices -- is handled here, because that part is small and the libraries
 * that wrap it drag in a whole Minecraft protocol stack for it.
 *
 * The one genuinely easy-to-get-wrong detail: since 1.16, packed block
 * indices do NOT span long boundaries. Each 64-bit long holds
 * floor(64 / bits) entries and the leftover high bits are padding. Code
 * written against the pre-1.16 layout reads terrain that looks almost right
 * and is quietly sheared -- which is exactly how it presents, so it is worth
 * naming.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync, gunzipSync } from 'node:zlib'
import nbt from 'prismarine-nbt'

const SECTOR = 4096

/** Load one region file into a map of chunkKey -> parsed NBT root. */
function readRegion(path) {
  const buf = readFileSync(path)
  const chunks = new Map()
  for (let i = 0; i < 1024; i++) {
    const off = buf.readUInt32BE(i * 4)
    const sectors = off & 0xff
    const start = (off >> 8) * SECTOR
    if (sectors === 0 || start === 0) continue

    const length = buf.readUInt32BE(start)
    const scheme = buf.readUInt8(start + 4)
    const payload = buf.subarray(start + 5, start + 4 + length)
    let raw
    if (scheme === 1) raw = gunzipSync(payload)
    else if (scheme === 2) raw = inflateSync(payload)
    else if (scheme === 3) raw = payload
    else throw new Error(`unsupported chunk compression ${scheme} in ${path}`)

    const { parsed } = nbt.parseUncompressed
      ? { parsed: nbt.parseUncompressed(raw) }
      : {}
    chunks.set(i, nbt.simplify(parsed))
  }
  return chunks
}

/*
 * prismarine-nbt hands long arrays back as [high, low] signed 32-bit pairs.
 * Rebuilding them as BigInt is the only way to shift across the 32-bit seam
 * correctly; doing the arithmetic in doubles loses the low bits of any
 * palette wider than 2^21 entries -- which never happens for blocks, but the
 * same unpacking runs over data where it would.
 */
const toBig = pair => (BigInt(pair[0] | 0) << 32n) | BigInt(pair[1] >>> 0)

/**
 * Unpack `count` entries of `bits` each from a long array, honouring the
 * 1.16+ no-straddling rule.
 */
function unpack(longs, bits, count) {
  const out = new Uint16Array(count)
  const perLong = Math.floor(64 / bits)
  const mask = (1n << BigInt(bits)) - 1n
  for (let i = 0; i < count; i++) {
    const li = Math.floor(i / perLong)
    if (li >= longs.length) break
    const shift = BigInt((i % perLong) * bits)
    out[i] = Number((toBig(longs[li]) >> shift) & mask)
  }
  return out
}

const bitsFor = (n, floor) => Math.max(floor, 32 - Math.clz32(Math.max(1, n - 1)))

/**
 * A generated chunk column, flattened to a simple accessor.
 *
 * Sections are stored sparsely -- an all-air section may carry a
 * single-entry palette and no data at all -- so the reader keeps the palette
 * and resolves lazily rather than expanding 4096 entries per section for the
 * many sections that are one repeated block.
 */
class Chunk {
  constructor(root) {
    this.sections = new Map()
    this.status = root.Status
    for (const s of root.sections ?? []) {
      const bs = s.block_states
      if (!bs?.palette?.length) continue
      const palette = bs.palette.map(p => p.Name)
      const entry = { palette, data: null }
      if (palette.length > 1 && bs.data) {
        entry.data = unpack(bs.data, bitsFor(palette.length, 4), 4096)
      }
      const bi = s.biomes
      if (bi?.palette?.length) {
        entry.biomePalette = bi.palette
        entry.biomeData = bi.palette.length > 1 && bi.data
          ? unpack(bi.data, bitsFor(bi.palette.length, 1), 64)
          : null
      }
      this.sections.set(s.Y, entry)
    }
  }

  /** Block name at chunk-local x,z (0-15) and absolute world y. */
  block(lx, y, lz) {
    const sy = Math.floor(y / 16)
    const s = this.sections.get(sy)
    if (!s) return 'minecraft:air'
    if (!s.data) return s.palette[0]
    // Anvil orders section blocks Y, then Z, then X.
    const i = ((y - sy * 16) * 16 + lz) * 16 + lx
    return s.palette[s.data[i]]
  }

  /** Biome at chunk-local x,z and absolute world y. Biomes are 4x4x4 cells. */
  biome(lx, y, lz) {
    const sy = Math.floor(y / 16)
    const s = this.sections.get(sy)
    if (!s?.biomePalette) return null
    if (!s.biomeData) return s.biomePalette[0]
    const i = (Math.floor((y - sy * 16) / 4) * 4 + Math.floor(lz / 4)) * 4 + Math.floor(lx / 4)
    return s.biomePalette[s.biomeData[i]]
  }
}

/** Lazily-loaded view over a world's region directory. */
export class World {
  constructor(regionDir) {
    this.dir = regionDir
    this.regions = new Map()
    this.chunks = new Map()
  }

  chunk(cx, cz) {
    const key = `${cx},${cz}`
    if (this.chunks.has(key)) return this.chunks.get(key)
    const rx = Math.floor(cx / 32)
    const rz = Math.floor(cz / 32)
    const rkey = `${rx},${rz}`
    if (!this.regions.has(rkey)) {
      const path = join(this.dir, `r.${rx}.${rz}.mca`)
      this.regions.set(rkey, existsSync(path) ? readRegion(path) : new Map())
    }
    const idx = (((cx % 32) + 32) % 32) + (((cz % 32) + 32) % 32) * 32
    const root = this.regions.get(rkey).get(idx)
    const chunk = root ? new Chunk(root) : null
    this.chunks.set(key, chunk)
    return chunk
  }

  block(x, y, z) {
    const c = this.chunk(x >> 4, z >> 4)
    return c ? c.block(((x % 16) + 16) % 16, y, ((z % 16) + 16) % 16) : null
  }

  biome(x, y, z) {
    const c = this.chunk(x >> 4, z >> 4)
    return c ? c.biome(((x % 16) + 16) % 16, y, ((z % 16) + 16) % 16) : null
  }
}
