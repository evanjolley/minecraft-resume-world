/*
 * THE PATH: the walked surface, its spurs to each chapter, the height it
 * walks at, the steps where it climbs, and the lamps beside it.
 *
 * ------------------------------------------------------------------------
 * "A road through my life... a winding path, plots on either side
 * alternating... organic and living." And from Sprint 1: "the path following
 * the terrain gracefully".
 *
 * THE PATH NOW TAKES ITS HEIGHT FROM THE LAND, and that reverses a decision
 * the previous pass recorded on purpose. It held the walk level and let the
 * relief rise BESIDE it, because a one-block riser on full cubes is a jump:
 * noa's sweep has no step-up, and src/blockMeshes.js deliberately gives only
 * NON-CUBE blocks vanilla's 0.6 step height. A walk that needs the space bar
 * was not the walk the owner asked for.
 *
 * What makes following the land possible now is the same rule read the
 * other way: a SLAB is a non-cube, and 0.5 is under 0.6. So wherever the walk
 * climbs a block, `steps` lays a slab on the lower column, and you walk up
 * slab, then block, without jumping -- the way a worn trail has a stone set
 * into every rise. The grade is held to one block in three (WALK_GRADE), so
 * the risers are spaced, never stacked.
 * ------------------------------------------------------------------------
 * EVERY RANDOM NUMBER HERE IS A HASH OF ITS COORDINATE.
 */
import { hash, smoothNoise } from './noise.js'
import { CHAPTERS, LAND_SPAWN_X, LAND_SPAWN_Z } from './plots.js'

/** Within this many blocks of spawn the walk is dead flat at plot level,
 *  because specs build `setBlock` rigs there and drop down the column four
 *  blocks west of it (test/helpers/world.js DROP_X). */
export const SPAWN_FLAT = 10
/** ...and within this many nothing at all stands above the ground. */
export const SPAWN_CLEAR = 8
export const nearSpawn = (x, z, r) => Math.hypot(x - LAND_SPAWN_X, z - LAND_SPAWN_Z) <= r

/** Rise over run the walk may climb: one block in three. */
const WALK_GRADE = 1 / 3
/** How far either side of a sample the walk's height is averaged, in
 *  samples (four to a block): 14 blocks. */
const SMOOTH = 56

/** The two half-widths of the path at sample i: 1.0 to 2.15 blocks each
 *  side, wandering on two different slow fields so the edges are not
 *  parallel. */
export function halves(i) {
  return [
    1.0 + 1.15 * smoothNoise(i, 0, 9, 31),
    1.0 + 1.15 * smoothNoise(i, 0, 13, 47),
  ]
}

/*
 * THE WORN GROUND. There is no dirt-path block in this palette, so the
 * worn look comes from the mix: coarse and rooted dirt carry most of it,
 * gravel is the worn middle, andesite and podzol the odd stone and leaf
 * litter. Two noise scales, so the answer is clumps rather than static.
 */
export function pathSurface(x, z) {
  const slow = smoothNoise(x, z, 17, 101)
  const fast = smoothNoise(x, z, 4.5, 202)
  const v = slow * 0.65 + fast * 0.35
  if (v < 0.32) return 'coarse_dirt'
  if (v < 0.47) return 'rooted_dirt'
  if (v < 0.58) return 'dirt'
  if (v < 0.70) return 'gravel'
  if (v < 0.82) return 'coarse_dirt'
  if (v < 0.89) return 'andesite'
  return 'podzol'
}

/**
 * Mark the path's columns. Each gets KIND.PATH (or KIND.BRIDGE where it is
 * over water) and remembers which spine sample drew it, which is how it
 * learns its height later.
 *
 * Throws if the path touches a plot: a path through somebody's chapter is
 * the one mistake this layout must never ship.
 */
export function rasterPath(model, samples, KIND) {
  const { W, D } = model
  const edges = []
  samples.forEach((s, i) => {
    const [wl, wr] = halves(i)
    for (let d = -wl; d <= wr; d += 0.3) {
      const x = Math.round(s.x + s.nx * d)
      const z = Math.round(s.z + s.nz * d)
      if (x < 0 || x >= W || z < 0 || z >= D) continue
      const j = z * W + x
      const k = model.kind[j]
      if (k === KIND.PLOT) {
        throw new Error(`the path runs into a chapter plot at patch (${x}, ${z}) -- `
          + `spine sample ${i}. Move the control point in src/builds/spine.js.`)
      }
      if (k === KIND.PATH || k === KIND.BRIDGE) continue
      /* The ragged edge: the outermost half block is kept only some of the
       * time, so the verge is frayed rather than ruled. */
      const outer = d < 0 ? -d > wl - 0.55 : d > wr - 0.55
      if (outer && hash(x, z, 71) > 0.58) { edges.push(j); continue }
      model.kind[j] = k === KIND.WATER ? KIND.BRIDGE : KIND.PATH
      model.walk[j] = i
    }
  })
  /* The spill: here and there a worn patch where walkers stepped off. */
  for (const j of edges) {
    const x0 = j % W, z0 = (j / W) | 0
    if (hash(x0, z0, 113) > 0.07) continue
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = x0 + dx, z = z0 + dz
      if (x < 0 || x >= W || z < 0 || z >= D) continue
      const k = z * W + x
      if (model.kind[k] !== KIND.FIELD || hash(x, z, 127) > 0.4) continue
      const near = nearestPathNeighbour(model, x, z, KIND)
      if (near < 0) continue
      model.kind[k] = KIND.PATH
      model.walk[k] = model.walk[near]
    }
  }
}

function nearestPathNeighbour(model, x, z, KIND) {
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, nz = z + dz
    if (nx < 0 || nx >= model.W || nz < 0 || nz >= model.D) continue
    const j = nz * model.W + nx
    if (model.kind[j] === KIND.PATH) return j
  }
  return -1
}

/**
 * One spur per chapter: a quadratic curve from the nearest point on the path
 * to the plot's entrance, which is the north corner of its path-side edge
 * (z0 + 6, the same row src/builds/chapters.js opens its border at).
 */
export function spurCurves(samples) {
  const out = []
  for (const c of CHAPTERS) {
    const lowX = c.side === 'LEFT'
    const zTarget = c.z0 + 6
    const edgeX = lowX ? c.x1 + 1 : c.x0 - 1
    let best = 0, bestD = Infinity
    samples.forEach((s, i) => {
      const d = Math.hypot(s.x - edgeX, s.z - zTarget)
      if (d < bestD) { bestD = d; best = i }
    })
    const a = samples[best]
    const ax = a.x, az = a.z, bx = edgeX, bz = zTarget
    const cx = ax + (bx - ax) * 0.45 - a.nx * 2
    const cz = az + (bz - az) * 0.45 + (bz > az ? 5 : -5)
    const steps = Math.ceil(Math.hypot(bx - ax, bz - az) * 4)
    const points = []
    for (let k = 0; k <= steps; k++) {
      const t = k / steps
      points.push({
        x: (1 - t) ** 2 * ax + 2 * (1 - t) * t * cx + t * t * bx,
        z: (1 - t) ** 2 * az + 2 * (1 - t) * t * cz + t * t * bz,
        t,
      })
    }
    out.push({ chapter: c, from: best, points })
  }
  return out
}

/** Mark the spurs' columns, about three blocks wide. A spur stops at the
 *  plot line and goes over water as a bridge. `model.spurT` keeps how far
 *  along its spur each column is, for its height. */
export function rasterSpurs(model, spurs, KIND) {
  const { W, D } = model
  spurs.forEach(({ points }, s) => {
    for (const { x: x0, z: z0, t } of points) {
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          const x = Math.round(x0 + dx), z = Math.round(z0 + dz)
          if (x < 0 || x >= W || z < 0 || z >= D) continue
          if (Math.hypot(x - x0, z - z0) > 1.6 + 0.4 * hash(x, z, 151)) continue
          const j = z * W + x
          const k = model.kind[j]
          if (k === KIND.PLOT || k === KIND.PATH || k === KIND.BRIDGE) continue
          if (k === KIND.SPUR && model.spurT[j] >= t) continue
          model.kind[j] = k === KIND.WATER ? KIND.BRIDGE : KIND.SPUR
          model.spur[j] = s
          model.spurT[j] = t
        }
      }
    }
  })
}

/**
 * THE HEIGHT OF THE WALK, sample by sample, and it is the land's.
 *
 * 1. Read the ground under every sample (water reads as missing and is
 *    bridged by interpolation).
 * 2. Average it over SMOOTH samples either side, twice: a path does not
 *    climb every hummock, it takes the line of the hill.
 * 3. Pin the samples that must be at a height: the spawn clearing at 0, and
 *    every sample over water at 1 or more, so a bridge deck clears the
 *    surface by a block.
 * 4. Limit the grade to WALK_GRADE, forwards and backwards, holding the pins.
 *
 * @returns Float32Array, one height per sample
 */
export function walkProfile(model, samples, KIND, spurs = []) {
  const n = samples.length
  const raw = new Float32Array(n)
  const pin = new Float32Array(n).fill(NaN)
  /*
   * A CEILING where each spur leaves, and it is what makes a spur walkable.
   * A spur runs from the path's height down to plot level, and it may only
   * fall at the walk's grade -- so the path, where a spur leaves it, may be
   * no higher than the spur is long times WALK_GRADE. Where the land under
   * the path is higher than that (the climb's plot sits in a bowl in the
   * peaks), the path comes down to meet its spur, and the grade limit below
   * carries that dip smoothly along the walk either side.
   */
  const cap = new Float32Array(n).fill(Infinity)
  for (const sp of spurs) {
    const pts = sp.points
    let len = 0
    for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z)
    cap[sp.from] = Math.min(cap[sp.from], Math.floor(len * WALK_GRADE) - 1)
  }
  const step = 0.25 * WALK_GRADE
  let last = 0
  for (let i = 0; i < n; i++) {
    const s = samples[i]
    const x = Math.round(s.x), z = Math.round(s.z)
    const j = z * model.W + x
    const inside = x >= 0 && x < model.W && z >= 0 && z < model.D
    const water = inside && model.kind[j] === KIND.WATER
    raw[i] = inside && !water ? model.g[j] : NaN
    if (!Number.isNaN(raw[i])) last = raw[i]
    if (nearSpawn(s.x, s.z, SPAWN_FLAT)) pin[i] = 0
    if (water) pin[i] = Math.max(1, last)
  }
  /* Fill the gaps (water) by linear interpolation between the banks. */
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(raw[i])) continue
    const a = i - 1
    let b = i + 1
    while (b < n && Number.isNaN(raw[b])) b++
    const va = a >= 0 ? raw[a] : (b < n ? raw[b] : 0)
    const vb = b < n ? raw[b] : va
    for (let k = i; k < b; k++) raw[k] = va + (vb - va) * ((k - a) / (b - a))
    i = b - 1
  }
  /* Box-average twice, with a running sum: a window of 2 * SMOOTH + 1
   * samples, shrinking at the two ends of the walk. */
  let p = raw
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float32Array(n)
    let sum = 0, cnt = 0
    for (let k = 0; k <= Math.min(n - 1, SMOOTH); k++) { sum += p[k]; cnt++ }
    for (let i = 0; i < n; i++) {
      out[i] = sum / cnt
      const add = i + SMOOTH + 1, drop = i - SMOOTH
      if (add < n) { sum += p[add]; cnt++ }
      if (drop >= 0) { sum -= p[drop]; cnt-- }
    }
    p = out
  }
  /* The pins and the ceilings, then the grade limit both ways, holding
   * both. A ceiling only ever pulls DOWN, so it is applied as a min. */
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(pin[i])) p[i] = pin[i]
    else p[i] = Math.min(p[i], cap[i])
  }
  for (let round = 0; round < 3; round++) {
    for (let i = 1; i < n; i++) {
      if (!Number.isNaN(pin[i])) continue
      p[i] = Math.min(cap[i], p[i - 1] + step, Math.max(p[i - 1] - step, p[i]))
    }
    for (let i = n - 2; i >= 0; i--) {
      if (!Number.isNaN(pin[i])) continue
      p[i] = Math.min(cap[i], p[i + 1] + step, Math.max(p[i + 1] - step, p[i]))
    }
  }
  /* Never below the shore: a path at the water's level would be a ford. */
  for (let i = 0; i < n; i++) p[i] = Math.max(p[i], -1)
  return p
}

/**
 * The height of every walk column: the profile at its sample for the path,
 * and for a spur a smooth run from the path's height where it leaves down
 * to plot level where it arrives. Over water, never below 1.
 */
export function walkHeights(model, profile, spurs, KIND) {
  const n = model.W * model.D
  for (let j = 0; j < n; j++) {
    const k = model.kind[j]
    if (k === KIND.PATH || (k === KIND.BRIDGE && model.walk[j] >= 0)) {
      model.walkH[j] = Math.round(profile[model.walk[j]])
    } else if (k === KIND.SPUR || (k === KIND.BRIDGE && model.spur[j] >= 0)) {
      /* Linear, not eased: the ceiling in walkProfile guarantees the drop
       * over the spur's length is within the grade, and an ease would
       * double the steepest step in the middle. */
      const sp = spurs[model.spur[j]]
      model.walkH[j] = Math.round(profile[sp.from] * (1 - model.spurT[j]))
    } else continue
    if (k === KIND.BRIDGE) model.walkH[j] = Math.max(1, model.walkH[j])
  }
}

/**
 * SETTLE THE WALK so no two neighbouring walk columns differ by more than a
 * block. The profile guarantees that ALONG the path and along each spur;
 * where a spur's first columns sit beside path columns drawn from a
 * different sample, or a spill patch beside an edge, the two can disagree by
 * two. The higher of such a pair comes down -- never a bridge deck below 1,
 * never the spawn clearing off 0 -- until nothing moves.
 */
export function settleWalk(model, KIND) {
  const { W, D } = model
  const walk = (k) => k === KIND.PATH || k === KIND.SPUR || k === KIND.BRIDGE
  for (let round = 0; round < 16; round++) {
    let moved = 0
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) {
        const i = z * W + x
        if (!walk(model.kind[i])) continue
        let lo = Infinity
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, nz = z + dz
          if (nx < 0 || nx >= W || nz < 0 || nz >= D) continue
          const j = nz * W + nx
          if (walk(model.kind[j]) && model.walkH[j] < lo) lo = model.walkH[j]
        }
        const floor = model.kind[i] === KIND.BRIDGE ? 1 : nearSpawn(x, z, SPAWN_FLAT) ? 0 : -1
        const want = Math.max(floor, Math.min(model.walkH[i], lo + 1))
        if (want !== model.walkH[i]) { model.walkH[i] = want; moved++ }
      }
    }
    if (!moved) return round
  }
  return 16
}

/** The slabs a climb is walked up by. See the header: 0.5 is under the
 *  0.6 step height, so slab-then-block needs no jump. */
const STEP_SLABS = ['cobblestone_slab', 'mossy_cobblestone_slab', 'cobblestone_slab', 'stone_slab']

/**
 * Lay a slab on every walk column that has a walk column one block higher
 * beside it. Returns how many were laid.
 */
export function steps(V, model, KIND) {
  const { W, D } = model
  let laid = 0
  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      const j = z * W + x
      const k = model.kind[j]
      if (k !== KIND.PATH && k !== KIND.SPUR && k !== KIND.BRIDGE) continue
      const h = model.h[j]
      let up = false
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz
        if (nx < 0 || nx >= W || nz < 0 || nz >= D) continue
        const m = nz * W + nx
        const km = model.kind[m]
        if ((km === KIND.PATH || km === KIND.SPUR || km === KIND.BRIDGE) && model.h[m] === h + 1) { up = true; break }
      }
      if (!up) continue
      const key = k === KIND.BRIDGE ? 'spruce_slab' : STEP_SLABS[Math.floor(hash(x, z, 811) * STEP_SLABS.length)]
      if (V.put(x, h, z, key)) { model.standing[j] = 1; laid++ }
    }
  }
  return laid
}

/*
 * LAMP POSTS, alternating sides, every 18 to 26 blocks of walking. A post is
 * three stripped oak logs and a torch. The walk is lit at night and the
 * spacing is irregular enough not to read as a street.
 */
export function lampPosts(V, model, samples, KIND) {
  let since = 40
  let side = 1
  samples.forEach((p, i) => {
    since += 0.25
    const want = 18 + 8 * smoothNoise(i, 0, 23, 59)
    if (since < want) return
    const [wl, wr] = halves(i)
    const d = side > 0 ? wr + 1.8 : -(wl + 1.8)
    const x = Math.round(p.x + p.nx * d)
    const z = Math.round(p.z + p.nz * d)
    if (x < 0 || x >= model.W || z < 0 || z >= model.D) return
    const j = z * model.W + x
    if (model.kind[j] !== KIND.FIELD || model.standing[j]) return
    if (nearSpawn(x, z, 9)) return
    const base = model.h[j]
    /* Never on a hillside the path has cut into: the post would stand a
     * block above the walk and read as somebody else's fence. */
    if (Math.abs(base - Math.round(model.walkH[model.near[j]] ?? base)) > 1) return
    since = 0
    side = -side
    for (let y = base; y <= base + 2; y++) V.put(x, y, z, 'stripped_oak_log')
    V.put(x, base + 3, z, 'torch')
    model.standing[j] = 1
  })
}
