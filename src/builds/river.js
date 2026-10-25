/*
 * THE WATER: one river, one lake, and the moat that makes New York an island.
 *
 * ------------------------------------------------------------------------
 * "Maybe a river with a bridge", from the first brief, and "a believable
 * river and maybe a lake" from Sprint 1. Every body of water here stands at
 * ONE level, WATER_Y (two blocks below the plots), the way vanilla's rivers
 * and lakes stand at sea level. That is the property that makes it
 * believable: a river whose surface steps up and down with the hills is a
 * staircase of ponds, and a flat world never had to learn that.
 *
 * WHAT THIS MODULE DECIDES and what it leaves alone. It decides which
 * columns are water, how deep each one is (a channel profile, deepest in the
 * middle), and how the land comes DOWN to the water on either side (a bank
 * blend over BANK blocks). It does not paint: the bed, the sand and the
 * beaches are src/builds/land.js's surface pass, which reads how far each
 * column is from water.
 * ------------------------------------------------------------------------
 * THE ONE CONSTRAINT THAT MATTERS: WATER NEVER MEETS AIR SIDEWAYS. A water
 * block beside a column whose ground is below the water's surface would
 * flow the moment the fluid engine looked at it. So every land column is
 * held at h >= WATER_Y + 1, which puts its top solid block AT the water
 * surface or above, and the water is a basin. test/91-biomes.spec.js
 * walks every water block's neighbours to prove it.
 */
import { smoothNoise, smoothstep } from './noise.js'
import { landPlot } from './plots.js'

/** The water surface: the top water block sits at local y = WATER_Y. Two
 *  below the plots, so a plot is never at the water's edge and a bank has
 *  room to slope. */
export const WATER_Y = -2
/** The lowest a LAND column may be: its top block level with the surface. */
export const SHORE_H = WATER_Y + 1
/** How far the land takes to come down to the water, in blocks. */
const BANK = 9

/*
 * THE COURSE, west to east: [x, z, half width]. It runs diagonally because
 * it has to separate chapters 1-3 from chapters 4-6 on BOTH sides of the
 * path: on the west it passes between Bilibili (ends z = 197) and San
 * Francisco (starts z = 238), on the east between Harvard (ends z = 139) and
 * New York's moat (starts z = 179), and there it runs into the moat so the
 * island is cut off the river rather than dug beside it. The path crosses
 * near (148, 186).
 */
const COURSE = [
  [-8, 222, 4.5],
  [30, 219, 5.5],
  [70, 217, 6],
  [104, 210, 5.5],
  [128, 197, 5],
  [148, 186, 4.5],
  [168, 180, 5],
  [190, 178, 5.5],
  [228, 177, 5],
  [262, 177, 5.5],
  [296, 174, 5],
]

/** Dense samples along the course, Catmull-Rom like the spine, with the
 *  half width wandering a little so the banks are not parallel. */
function courseSamples() {
  const out = []
  const P = (i) => COURSE[Math.max(0, Math.min(COURSE.length - 1, i))]
  for (let s = 0; s < COURSE.length - 1; s++) {
    const p0 = P(s - 1), p1 = P(s), p2 = P(s + 1), p3 = P(s + 2)
    const n = Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 0.5)
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t
      const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t
        + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      const x = f(p0[0], p1[0], p2[0], p3[0]), z = f(p0[1], p1[1], p2[1], p3[1])
      const w = p1[2] + (p2[2] - p1[2]) * t + (smoothNoise(x, z, 9, 223) - 0.5) * 1.6
      out.push([x, z, w])
    }
  }
  return out
}

/*
 * THE LAKE, north-east of spawn, in the plains below Harvard's birch wood.
 * It is the first water a visitor sees, across open grass from where they
 * land, and it is where the lily pads are. An ellipse whose rim is pushed in
 * and out by noise, so it has bays.
 */
export const LAKE = { x: 238, z: 32, rx: 27, rz: 15, depth: 5 }

/*
 * THE MOAT round New York, kept from the previous survey. SHORE blocks of
 * island ground round the plot, then a channel CHANNEL blocks wide.
 */
const SHORE = 5
const CHANNEL = 8

/** Signed distance from (x, z) to a rectangle: positive outside, negative
 *  inside. */
export function toRect(x, z, r) {
  const dx = Math.max(r.x0 - x, 0, x - r.x1)
  const dz = Math.max(r.z0 - z, 0, z - r.z1)
  if (dx > 0 || dz > 0) return Math.hypot(dx, dz)
  return -Math.min(x - r.x0, r.x1 - x, z - r.z0, r.z1 - z)
}

/**
 * Cut every body of water into the height field.
 *
 * @param model  the land model; `kind`, `g` (the float height field) and
 *               `depth` are written, and `bed` records the water columns'
 *               own heights for the bridge writer.
 * @param KIND   the kind enum, passed rather than imported so this module
 *               does not depend on land.js.
 *
 * For each column it finds `q`, the distance from the water's centre line
 * in units of the half width (0 mid-channel, 1 at the edge) and the
 * distance past the edge. Inside: a channel profile, deepest in the middle.
 * Outside, within BANK: the land is blended down to SHORE_H.
 */
export function carveWater(model, KIND) {
  const { W, D } = model
  /* Best q per column, over all three bodies of water. q < 1 is water. */
  const q = new Float32Array(W * D).fill(99)
  const past = new Float32Array(W * D).fill(99)
  const maxDepth = new Uint8Array(W * D)
  const body = new Uint8Array(W * D)

  const take = (i, qq, pp, dep, b) => {
    if (qq < q[i]) { q[i] = qq; maxDepth[i] = dep; body[i] = b }
    if (pp < past[i]) past[i] = pp
  }

  /* The river: stamp a disc of radius w + BANK at every sample. */
  for (const [cx, cz, w] of courseSamples()) {
    const R = Math.ceil(w + BANK)
    const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(W - 1, Math.ceil(cx + R))
    const z0 = Math.max(0, Math.floor(cz - R)), z1 = Math.min(D - 1, Math.ceil(cz + R))
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - cx, z - cz)
        take(z * W + x, d / w, d - w, 4, 1)
      }
    }
  }

  /* The lake. */
  {
    const L = LAKE
    for (let z = Math.max(0, L.z - L.rz - BANK - 4); z <= Math.min(D - 1, L.z + L.rz + BANK + 4); z++) {
      for (let x = Math.max(0, L.x - L.rx - BANK - 4); x <= Math.min(W - 1, L.x + L.rx + BANK + 4); x++) {
        const ex = (x - L.x) / L.rx, ez = (z - L.z) / L.rz
        const r = Math.hypot(ex, ez) + (smoothNoise(x, z, 11, 241) - 0.5) * 0.35
        /* Distance past the rim in blocks, roughly: the ellipse's mean
         * radius times how far past 1 the normalised radius is. */
        take(z * W + x, r, (r - 1) * (L.rx + L.rz) / 2, L.depth, 2)
      }
    }
  }

  /* The moat, as a band of channel round chapter 4's plot. */
  {
    const c = landPlot('ch4')
    const ring = { x0: c.x0 - SHORE, x1: c.x1 + SHORE, z0: c.z0 - SHORE, z1: c.z1 + SHORE }
    const reach = CHANNEL + BANK + 3
    for (let z = Math.max(0, ring.z0 - reach); z <= Math.min(D - 1, ring.z1 + reach); z++) {
      for (let x = Math.max(0, ring.x0 - reach); x <= Math.min(W - 1, ring.x1 + reach); x++) {
        /* Two scales of wander, so the island's shore has bays and points
         * rather than following the plot's rectangle at a fixed offset. The
         * wander only ever pushes the channel OUTWARD (it is subtracted, and
         * never negative), so however it falls the island keeps its SHORE
         * ring and the water never reaches the plot. */
        const dr = toRect(x, z, ring)
          - smoothNoise(x, z, 22, 601) * 7
          - smoothNoise(x, z, 7, 607) * 2
        if (dr <= 0) continue
        const mid = CHANNEL / 2
        const off = Math.abs(dr - mid)
        /* Only the OUTER bank blends: inside the channel the island side is
         * the shore ring, which the plot pad holds at plot level. */
        take(z * W + x, off / mid, dr > mid ? off - mid : 99, 3, 3)
      }
    }
  }

  /* Apply. Water columns take their channel depth; bank columns are lowered
   * toward the shore, never raised. */
  for (let i = 0; i < W * D; i++) {
    if (model.kind[i] === KIND.PLOT) {
      if (q[i] < 1) {
        const x = i % W, z = (i / W) | 0
        throw new Error(`water runs into a chapter plot at patch (${x}, ${z}) -- `
          + `move a point of COURSE or LAKE in src/builds/river.js.`)
      }
      continue
    }
    if (q[i] < 1) {
      const qq = q[i]
      const dep = Math.max(1, Math.round(maxDepth[i] * (1 - qq * qq) + 0.4))
      model.kind[i] = KIND.WATER
      model.depth[i] = dep
      model.g[i] = WATER_Y + 1 - dep
      model.bed[i] = WATER_Y + 1 - dep
      model.lake[i] = body[i]
    } else if (past[i] < BANK) {
      const t = smoothstep(past[i] / BANK)
      const g = model.g[i]
      const want = SHORE_H + (g - SHORE_H) * t
      if (want < g) model.g[i] = want
    }
  }
}
