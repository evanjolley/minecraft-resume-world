/*
 * The VOX1 reader. One decoder, two callers.
 *
 * scripts/terrain/extract.mjs writes this format; scripts/terrain/verify.mjs
 * checks it against the region files it came from; island.js reads it to build
 * the world. Those last two used to be the same code living in verify.mjs,
 * which was fine while nothing in src/ needed it -- but a browser copy of a
 * format reader is a second implementation, and two readers of one binary
 * format drift in exactly the way that shows up as terrain that looks subtly
 * wrong weeks later. So verify.mjs now imports this.
 *
 * Written against DataView / Uint8Array rather than node's Buffer, which is
 * what makes one file serve both: node's Buffer IS a Uint8Array, so the
 * verifier can hand its buffer straight in, while the browser never has to
 * learn what a Buffer is.
 *
 * Format, in order:
 *   magic "VOX1" | i32 width | i32 depth | i32 yMin | i32 yTop
 *   varint paletteLength, then that many (varint byteLength, utf8 bytes)
 *   width*depth columns, each: varint runCount, then runCount (varint length,
 *   varint paletteIndex) pairs running UP from yMin.
 */

export const MAGIC = 'VOX1'

/**
 * @param {Uint8Array} bytes
 * @returns {{magic, width, depth, yMin, yTop, palette: string[], cols: Uint16Array[]}}
 */
export function decode(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let p = 0

  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
  p = 4
  if (magic !== MAGIC) throw new Error(`not ${MAGIC}: got "${magic}"`)

  const i32 = () => { const v = view.getInt32(p, true); p += 4; return v }
  const varint = () => {
    let v = 0, s = 0, b
    do { b = bytes[p++]; v |= (b & 0x7f) << s; s += 7 } while (b & 0x80)
    return v >>> 0
  }

  const width = i32(), depth = i32(), yMin = i32(), yTop = i32()

  const text = new TextDecoder()
  const palette = []
  const paletteLength = varint()
  for (let i = 0; i < paletteLength; i++) {
    const len = varint()
    palette.push(text.decode(bytes.subarray(p, p + len)))
    p += len
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
    // A truncated or over-long column is the failure mode a varint bug
    // produces, and it is silent unless someone checks. Check.
    if (y !== height) throw new Error(`column ${i} covers ${y} of ${height} layers`)
    cols[i] = col
  }
  if (p !== bytes.length) throw new Error(`${bytes.length - p} trailing bytes`)

  return { magic, width, depth, yMin, yTop, palette, cols }
}
