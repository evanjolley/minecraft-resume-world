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
