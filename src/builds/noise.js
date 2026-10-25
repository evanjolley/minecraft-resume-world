/*
 * THE TWO RANDOM NUMBERS THIS WORLD IS MADE OF, and nothing else.
 *
 * ------------------------------------------------------------------------
 * WHY THEY ARE THEIR OWN MODULE, which they were not until the biome pass.
 *
 * They lived in src/builds/land.js, which is the right place for them to be
 * USED and the wrong place for them to LIVE: land.js imports the stamper,
 * which imports src/blocks.js, which imports Babylon. So anything that wanted
 * these two functions had to drag a WebGL renderer in with them, and a spec
 * that wanted to check the biome map against the world it produced could not
 * be written at all -- the spec runs in node.
 *
 * That is the same argument src/builds/index.js makes at length about why the
 * builds hang off flatworld.js rather than island.js, and the same one
 * plots.js makes about staying import-free. This file has no imports for the
 * same reason plots.js has none.
 *
 * land.js still re-exports both, so every existing caller is unchanged.
 * ------------------------------------------------------------------------
 * EVERY RANDOM NUMBER IN THIS LANDSCAPE IS A HASH OF ITS COORDINATE.
 *
 * `Math.random()` would give a different world on every page load, and this
 * world is regenerated from source every time anybody opens it -- there is no
 * saved terrain. A visitor who walked past a fallen log and came back to find
 * it gone would be right to think the place was broken, and every screenshot
 * in a spec would be of a different world.
 */

/**
 * A hash of two integers and a salt, in [0, 1). Deterministic, and that is
 * the whole requirement -- this is not cryptography and it is not even good
 * noise, it is a cheap repeatable scatter.
 */
export function hash(x, z, salt = 0) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/**
 * Smooth value noise in [0, 1), so that a palette comes out in CLUMPS rather
 * than as static. The brief asked for "clumps, not noise" in as many words,
 * and a per-column hash gives you exactly the salt-and-pepper it was warning
 * against -- every block a different block. Bilinear interpolation between
 * hashed lattice points at `scale` blocks apart is the cheapest thing that
 * makes a patch of podzol be a PATCH.
 */
export function smoothNoise(x, z, scale, salt = 0) {
  const fx = x / scale, fz = z / scale
  const x0 = Math.floor(fx), z0 = Math.floor(fz)
  const tx = fx - x0, tz = fz - z0
  // Smoothstep, so the lattice does not show as a grid of diamonds.
  const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz)
  const a = hash(x0, z0, salt), b = hash(x0 + 1, z0, salt)
  const c = hash(x0, z0 + 1, salt), d = hash(x0 + 1, z0 + 1, salt)
  return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz
}

/* ====================================================================== *
 * GRADIENT NOISE, for the shape of the land.
 *
 * `smoothNoise` above is VALUE noise: random heights at lattice points,
 * blended. It is right for palettes and wrong for hills, because every
 * lattice point is a local peak or pit and the eye reads the lattice -- a
 * field of evenly spaced bumps. Minecraft's terrain is built from Perlin
 * (gradient) noise, summed over octaves (`ImprovedNoise` inside
 * `PerlinNoise`, which is exactly this), and that is what gives a hillside
 * its long ridges and saddles instead of a quilt of domes.
 *
 * This is Ken Perlin's improved noise in two dimensions: a fixed permutation
 * table, eight gradient directions, the quintic fade. The table is shuffled
 * once from a fixed seed, so the world is identical on every load, the same
 * promise `hash` makes.
 * ====================================================================== */

/** mulberry32: a tiny seeded PRNG, for shuffling the table and for the
 *  per-tree random streams in src/builds/trees.js. Returns [0, 1). */
export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PERM = (() => {
  const p = new Uint8Array(256)
  for (let i = 0; i < 256; i++) p[i] = i
  const r = rng(0x5eed1e55)
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    const t = p[i]; p[i] = p[j]; p[j] = t
  }
  const out = new Uint8Array(512)
  for (let i = 0; i < 512; i++) out[i] = p[i & 255]
  return out
})()

/* Eight gradients, the four axes and the four diagonals. */
const GX = new Float32Array([1, -1, 1, -1, 1, -1, 0, 0])
const GZ = new Float32Array([1, 1, -1, -1, 0, 0, 1, -1])

/** 2D gradient noise, roughly in [-1, 1], zero at every lattice point. */
export function perlin(x, z) {
  const xf = Math.floor(x), zf = Math.floor(z)
  const fx = x - xf, fz = z - zf
  const X = xf & 255, Z = zf & 255
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
  const v = fz * fz * fz * (fz * (fz * 6 - 15) + 10)
  const a = PERM[X] + Z, b = PERM[X + 1] + Z
  const g00 = PERM[a] & 7, g01 = PERM[a + 1] & 7, g10 = PERM[b] & 7, g11 = PERM[b + 1] & 7
  const n00 = GX[g00] * fx + GZ[g00] * fz
  const n10 = GX[g10] * (fx - 1) + GZ[g10] * fz
  const n01 = GX[g01] * fx + GZ[g01] * (fz - 1)
  const n11 = GX[g11] * (fx - 1) + GZ[g11] * (fz - 1)
  const x0 = n00 + u * (n10 - n00)
  const x1 = n01 + u * (n11 - n01)
  return x0 + v * (x1 - x0)
}

/**
 * Fractal sum of `octaves` layers of `perlin`, the first at `scale` blocks,
 * each half the size and (by default) half the weight of the one before.
 * Normalised back to roughly [-1, 1]. `salt` moves the sample far across the
 * table so two fields with different salts are unrelated.
 */
export function fbm(x, z, scale, octaves, salt = 0, gain = 0.5) {
  const ox = hash(salt, 1, 9001) * 4096, oz = hash(salt, 2, 9001) * 4096
  let sum = 0, amp = 1, norm = 0, f = 1 / scale
  for (let o = 0; o < octaves; o++) {
    sum += amp * perlin(x * f + ox, z * f + oz)
    norm += amp
    amp *= gain
    f *= 2
  }
  return sum / norm
}

/**
 * Ridged fractal noise in [0, 1]: `1 - |perlin|`, squared, so the zero
 * crossings of the gradient field become sharp crests. This is what makes a
 * jagged peak a ridge line rather than a pile, and it is the same trick
 * vanilla's "ridges" density function plays with `abs` and a fold.
 */
export function ridged(x, z, scale, octaves, salt = 0) {
  const ox = hash(salt, 3, 9001) * 4096, oz = hash(salt, 4, 9001) * 4096
  let sum = 0, amp = 1, norm = 0, f = 1 / scale, weight = 1
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(perlin(x * f + ox, z * f + oz))
    n *= n
    n *= weight
    weight = Math.min(1, n * 2)
    sum += amp * n
    norm += amp
    amp *= 0.5
    f *= 2
  }
  return sum / norm
}

/** Hermite smoothstep on [0, 1], clamped. */
export function smoothstep(t) {
  if (t <= 0) return 0
  if (t >= 1) return 1
  return t * t * (3 - 2 * t)
}
