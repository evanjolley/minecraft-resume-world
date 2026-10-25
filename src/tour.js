/*
 * THE GUIDED TOUR: where the plots are, how to get there, and how to lead a
 * visitor along the way.
 *
 * docs/FUTURE.md settled the navigation question before anything was built:
 * "Leading a visitor from one build to another over a voxel grid is A*, with
 * movement rules that know about jumping and falling." This is that, at the
 * smallest size that works on this world:
 *
 *   - A node is a place he can STAND: a column (x, z) and a feet height y,
 *     with something solid under the feet and two blocks of air (not water)
 *     at the feet and the head.
 *   - From a node he can step to any of the eight neighbours whose standing
 *     height is at most ONE block up (the same hop npc.js already makes) or
 *     up to THREE down (a drop that costs no health in Minecraft). Diagonals
 *     need both orthogonal neighbours clear, so he never clips a corner.
 *   - Costs are distance, plus a little for climbing and for dropping, so the
 *     route prefers the path and the level ground when they are close to as
 *     short.
 *
 * It runs in the BROWSER, on the visitor's own world, because that is where
 * the world is (the server never sees a voxel). Pure functions of a `solidAt`
 * / `fluidAt` pair, so a spec can run it against a hand-drawn grid with no
 * engine at all.
 *
 * Rejected: a navmesh or a precomputed road graph. The landscape agent can
 * move every plot and re-cut the path in a commit, and a baked graph would
 * be one more thing to regenerate. A* over the live voxels needs nothing
 * regenerated, ever, and the plot entrances are derived from CHAPTERS.
 */

/* ------------------------------------------------------------------ *
 * Where the plots are
 * ------------------------------------------------------------------ */

/**
 * One stop per chapter: a point just INSIDE the plot, on the side the path
 * runs past, level with the spur src/builds/path.js draws to it (z0 + 6).
 *
 * Derived, never copied: if the layout moves a plot, the tour follows it.
 *
 * @param {Array} chapters   CHAPTERS from src/builds/plots.js
 * @param {(px:number, py:number, pz:number) => number[]} toWorld  toLandWorld
 */
export function plotStops(chapters, toWorld) {
  const out = {}
  for (const c of chapters) {
    /* LEFT is the low-x side, so its entrance is on its high-x edge; see the
     * same note in spurCurves (src/builds/path.js). */
    const lowX = c.side === 'LEFT'
    const px = lowX ? c.x1 - 3 : c.x0 + 3
    const pz = c.z0 + 6
    const [x, , z] = toWorld(px, 0, pz)
    out[c.id] = { id: c.id, n: c.n, label: c.label, x: x + 0.5, z: z + 0.5 }
  }
  return out
}

/* ------------------------------------------------------------------ *
 * A*
 * ------------------------------------------------------------------ */

const STEP_UP = 1
const DROP_DOWN = 3

/** Is (x, y, z) somewhere a 2-tall body can stand with its feet at y? */
export function standable(x, y, z, solidAt, fluidAt = () => false) {
  return solidAt(x, y - 1, z) && !fluidAt(x, y - 1, z)
    && !solidAt(x, y, z) && !solidAt(x, y + 1, z)
    && !fluidAt(x, y, z) && !fluidAt(x, y + 1, z)
}

/** The standing height reachable from feet height y in column (x, z), or null.
 *  Level first, then one up, then down to the drop limit. */
function landing(x, y, z, solidAt, fluidAt) {
  if (standable(x, y, z, solidAt, fluidAt)) return y
  for (let up = 1; up <= STEP_UP; up++) {
    /* A hop needs headroom above where he is now as well as where he lands. */
    if (standable(x, y + up, z, solidAt, fluidAt)) return y + up
  }
  for (let down = 1; down <= DROP_DOWN; down++) {
    if (solidAt(x, y - down + 1, z)) return null // a wall, not a ledge
    if (standable(x, y - down, z, solidAt, fluidAt)) return y - down
  }
  return null
}

/** A small binary min-heap keyed on f. */
class Heap {
  constructor() { this.a = [] }
  get size() { return this.a.length }
  push(n) {
    const a = this.a
    a.push(n)
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p].f <= a[i].f) break
      ;[a[p], a[i]] = [a[i], a[p]]
      i = p
    }
  }
  pop() {
    const a = this.a
    const top = a[0]
    const last = a.pop()
    if (a.length) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < a.length && a[l].f < a[m].f) m = l
        if (r < a.length && a[r].f < a[m].f) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        i = m
      }
    }
    return top
  }
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]

/**
 * Find a walkable route from a standing position to a target column.
 *
 * @param {object} a
 * @param {number[]} a.from     [x, y, z], feet position (floats fine)
 * @param {number[]} a.to       [x, z]
 * @param {Function} a.solidAt  (x, y, z) -> boolean, integer block coords
 * @param {Function} [a.fluidAt]
 * @param {number} [a.radius]   arrive within this many blocks of the target
 * @param {number} [a.maxNodes] search budget
 * @returns {null | Array<[number, number, number]>} block positions, start excluded
 */
export function findPath({ from, to, solidAt, fluidAt = () => false, radius = 1.5, maxNodes = 120_000 }) {
  const sx = Math.floor(from[0])
  const sz = Math.floor(from[2])
  let sy = Math.floor(from[1] + 0.1)
  /* He may be mid-hop or standing on a slab edge: settle the start onto the
   * nearest standable height in his own column. */
  const settled = landing(sx, sy, sz, solidAt, fluidAt)
  if (settled === null) return null
  sy = settled
  const tx = to[0]
  const tz = to[1]
  const h = (x, z) => Math.hypot(x + 0.5 - tx, z + 0.5 - tz)
  const key = (x, y, z) => `${x},${y},${z}`

  const open = new Heap()
  const best = new Map()
  const parent = new Map()
  const startK = key(sx, sy, sz)
  best.set(startK, 0)
  open.push({ x: sx, y: sy, z: sz, g: 0, f: h(sx, sz), k: startK })
  let expanded = 0

  while (open.size) {
    const n = open.pop()
    if (n.g > (best.get(n.k) ?? Infinity)) continue
    if (h(n.x, n.z) <= radius) return unwind(parent, n.k, startK)
    if (++expanded > maxNodes) return null

    for (const [dx, dz] of DIRS) {
      const nx = n.x + dx
      const nz = n.z + dz
      const ny = landing(nx, n.y, nz, solidAt, fluidAt)
      if (ny === null) continue
      if (dx && dz) {
        /* No corner cutting: both orthogonal neighbours must be passable at
         * the height he is moving through. */
        const y = Math.max(n.y, ny)
        if (solidAt(n.x + dx, y, n.z) || solidAt(n.x + dx, y + 1, n.z)
          || solidAt(n.x, y, n.z + dz) || solidAt(n.x, y + 1, n.z + dz)) continue
      }
      if (ny > n.y && solidAt(n.x, n.y + 2, n.z)) continue // no room to hop
      const step = (dx && dz ? Math.SQRT2 : 1) + (ny > n.y ? 0.6 : 0) + (ny < n.y ? 0.3 * (n.y - ny) : 0)
      const g = n.g + step
      const k = key(nx, ny, nz)
      if (g >= (best.get(k) ?? Infinity)) continue
      best.set(k, g)
      parent.set(k, n.k)
      open.push({ x: nx, y: ny, z: nz, g, f: g + h(nx, nz), k })
    }
  }
  return null
}

function unwind(parent, k, startK) {
  const out = []
  while (k && k !== startK) {
    out.push(k.split(',').map(Number))
    k = parent.get(k)
  }
  return out.reverse()
}

/**
 * Thin a block-by-block path to the points where he has to change direction
 * or height, and never more than `maxGap` blocks apart -- so the walk has
 * natural checkpoints to look back for the visitor.
 */
export function waypoints(path, maxGap = 8) {
  const out = []
  let dir = null
  let since = 0
  for (let i = 0; i < path.length; i++) {
    const p = path[i]
    const next = path[i + 1]
    since++
    if (!next) { out.push(p); break }
    const d = `${Math.sign(next[0] - p[0])},${Math.sign(next[2] - p[2])},${next[1] - p[1]}`
    if ((dir !== null && d !== dir) || next[1] !== p[1] || since >= maxGap) {
      out.push(p)
      since = 0
    }
    dir = d
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Leading
 * ------------------------------------------------------------------ */

/* How far behind the visitor may fall before he stops to wait. A little
 * wider than npc.js's LEAVE_RADIUS, because a guide who waits at every
 * fence post is an obstacle, not a guide. */
export const WAIT_RADIUS = 9
/* How long he waits before deciding they are not coming. */
export const GIVE_UP_MS = 45_000

/**
 * The tour guide. Plans a route and walks it, checkpoint by checkpoint,
 * pausing whenever the visitor is too far behind.
 *
 * @param {object} a
 * @param {object} a.npc                { position, walkTo([x,z], opts) }
 * @param {() => number[]} a.visitor    visitor's position
 * @param {() => object|null} a.stops   plotStops(...) for the current world, or null
 * @param {Function} a.solidAt
 * @param {Function} [a.fluidAt]
 * @param {(ms:number) => Promise} [a.sleep]
 * @param {() => number} [a.clock]
 */
export function createGuide({ npc, visitor, stops, solidAt, fluidAt, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), clock = () => performance.now() }) {
  const gap = () => {
    const [ax, , az] = visitor()
    const [bx, , bz] = npc.position
    return Math.hypot(ax - bx, az - bz)
  }

  async function waitForVisitor() {
    const start = clock()
    while (gap() > WAIT_RADIUS) {
      if (clock() - start > GIVE_UP_MS) return false
      await sleep(250)
    }
    return true
  }

  /** @returns {Promise<object>} the walk_to_plot tool result */
  async function leadTo(chapter) {
    const table = stops()
    if (!table) throw new Error('there are no chapter plots in this world -- the tour is in the overworld')
    const stop = table[chapter]
    if (!stop) throw new Error(`no plot called ${chapter}; known: ${Object.keys(table).join(', ')}`)

    const path = findPath({ from: npc.position, to: [stop.x, stop.z], solidAt, fluidAt })
    /* No route is an answer, not a crash: the model gets it as is_error and
     * can say so, or offer the next chapter instead. */
    if (!path) throw new Error(`no walkable route to ${stop.label} from here`)

    const points = waypoints(path)
    for (let i = 0; i < points.length; i++) {
      if (!(await waitForVisitor())) {
        return { arrived: false, chapter, label: stop.label, visitorWithYou: false, reason: 'the visitor stopped following' }
      }
      const [x, , z] = points[i]
      const last = i === points.length - 1
      /* Through-points are passed loosely, so he keeps walking instead of
       * stopping dead every eight blocks; only the last one is exact. */
      await npc.walkTo([x + 0.5, z + 0.5], { radius: last ? 0.5 : 1.2 })
    }
    const withYou = gap() <= WAIT_RADIUS || (await waitForVisitor())
    return { arrived: true, chapter, label: stop.label, visitorWithYou: withYou, steps: path.length }
  }

  return { leadTo }
}
