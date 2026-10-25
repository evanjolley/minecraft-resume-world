/*
 * CHAPTER 6: THE CLIMB. A parkour course that goes UP, fifty blocks of it,
 * through the five chapters the visitor has just walked past.
 *
 * ------------------------------------------------------------------------
 * THE BRIEF (docs/SPRINT-1.md, src/builds/plots.js): "a parkour going UP"
 * that "claims the air above the plot", fun and fair under Minecraft's real
 * jump physics, with checkpoints and a reward at the top.
 *
 * WHAT IT IS. Four floating islands spiral up round a central mast, one per
 * chapter, ten blocks apart, and a summit sits on top of the mast:
 *
 *   ground  stage 1  OMAHA          hay, the start          y  0
 *   QB      stage 2  HARVARD        brick and crimson       y 10
 *   QC      stage 3  BILIBILI       light blue and pink     y 20
 *   QD      stage 4  NEW YORK       asphalt and taxi yellow y 30
 *   QA      stage 5  SAN FRANCISCO  international orange    y 40
 *   mast    THE TOP                 gold                    y 50
 *
 * Each island is the chapter it is named for, in palette only -- nothing on
 * them is a fact the other chapters do not already state. The mast carries
 * the same five colours in ten-block bands, so from the path the whole climb
 * reads as the walk you just took, stood on end.
 *
 * ------------------------------------------------------------------------
 * FAIR, MEASURED. Every number below was measured in this engine with
 * src/physics.js, not taken from the wiki, by standing still on a one-block
 * pillar and jumping at the edge (test/99-chapters-4-6.spec.js re-runs every
 * single jump on this course the same way):
 *
 *                 walking          sprinting
 *   flat          2 air blocks     4 (lands 0.19 past the lip -- too tight)
 *   up one        1 (2 at 0.17)    3 (lands 0.44 past the lip)
 *
 * So the rules this course is built to, and the spec enforces them from the
 * world rather than from this table:
 *
 *   STAGE 1   walkable without sprint: flat gaps <= 2, rises over gaps <= 1.
 *             A visitor who has never pressed Ctrl can reach stage 2.
 *   STAGES 2-4  sprint: flat gaps <= 3, rises over gaps <= 2.
 *   STAGE 5   the hard one: three rises over a three-block gap, two of them
 *             onto a single block, and one diagonal.
 *   NEVER     a four-block flat gap, a rise over four, or a jump with less
 *             than four blocks of air above the take-off and the landing.
 *
 * Every jump is possible FROM A STANDSTILL at the middle of its take-off pad,
 * which is the strictest version of the claim: a player who lands, stops,
 * breathes, and goes again never needs a run-up the course does not give.
 *
 * ------------------------------------------------------------------------
 * CHECKPOINTS, AND WHY THEY NEED NO RUNTIME. Builds are geometry, so a
 * checkpoint cannot set your spawn. What it can do is catch you: every jump
 * of stage N is made OVER the island of stage N, and the island has a sheet
 * of water let into it under the whole route. Fall off any jump and you land
 * in water, on the island you started the stage from, with no damage (water
 * cancels fall damage outright -- src/fluids.js, vanilla's resetFallDistance).
 * You lose one stage, never the climb. Stage 1 is over the ground, so its net
 * is a pool dug into the ground.
 *
 * The only jumps that are not over an island are the five that cross from
 * one island to the next over the three-block gap between them. Those gaps
 * run down to a moat round the mast, three deep, so a miss there is a swim
 * and a walk back rather than a death. The moat is also where the way down
 * lands: a diving board off the summit, straight down the gap.
 *
 * ------------------------------------------------------------------------
 * GEOMETRY. Plot-local, 74 x 76. The path is on the LOW-x side (ch6 is a
 * RIGHT plot), and the spur arrives at local (0, 6), so the start is right
 * there at (6..10, 10..14) -- the spot src/builds/chapters.js reserved for it.
 * The north rows z 0..5 are left alone for the chapter marker.
 *
 * Signs face -x ('east' in this engine, where +x is west) so they are read
 * from the path side, and setSignText derives its own handedness.
 *
 * Nothing factual is invented. The chapter names and their order are the
 * plot table's; the colours are the chapters' own.
 */
import { setSignText } from '../signText.js'

export const SIZE = { w: 74, d: 76 }

/** The four island quadrants. The three-block gaps between them -- x 35..37
 *  and z 38..40 -- are the corridors the crossing jumps fly over and the
 *  moat sits in. */
export const QUADS = {
  A: { x0: 2, x1: 34, z0: 7, z1: 37 },
  B: { x0: 38, x1: 71, z0: 7, z1: 37 },
  C: { x0: 38, x1: 71, z0: 41, z1: 73 },
  D: { x0: 2, x1: 34, z0: 41, z1: 73 },
}

/** The mast under the summit, in the crossing of the two corridors. */
const MAST = { x0: 35, x1: 37, z0: 38, z1: 40 }

/** The summit platform: standing height 50, its deck at y = 49. */
export const SUMMIT = { x0: 31, x1: 41, z0: 34, z1: 44, H: 50 }

/*
 * THE STAGES. `H` is the height you STAND at on the island (its top block is
 * at H - 1). Palette per chapter: `top` the walking surface, `trim` its edge,
 * `pad` the jumping blocks of the stage that starts here, `lamp` the light
 * hung under every pad.
 */
export const STAGES = [
  { n: 1, name: 'Omaha', quad: 'A', H: 0,
    top: 'grass', trim: 'hay_block', pad: 'hay_block', lamp: 'glowstone', band: 'hay_block' },
  { n: 2, name: 'Harvard', quad: 'B', H: 10,
    top: 'bricks', trim: 'red_nether_bricks', pad: 'red_nether_bricks', lamp: 'sea_lantern', band: 'bricks' },
  { n: 3, name: 'Bilibili', quad: 'C', H: 20,
    top: 'light_blue_concrete', trim: 'pink_concrete', pad: 'pink_concrete', lamp: 'sea_lantern', band: 'light_blue_concrete' },
  { n: 4, name: 'New York', quad: 'D', H: 30,
    top: 'gray_concrete', trim: 'yellow_concrete', pad: 'yellow_concrete', lamp: 'glowstone', band: 'yellow_concrete' },
  { n: 5, name: 'San Francisco', quad: 'A', H: 40,
    top: 'smooth_stone', trim: 'orange_concrete', pad: 'orange_concrete', lamp: 'glowstone', band: 'orange_concrete' },
]

/** A pad: an inclusive rectangle and the y of its top block. */
const P = (x0, x1, z0, z1, y) => ({ x0, x1, z0, z1, y })
const P1 = (x, z, y) => P(x, x, z, z, y)

/*
 * THE ROUTE, one list per stage. `start` is the stretch of island the first
 * jump leaves from, `pads` the jumping blocks in order, `end` the stretch of
 * the next island the last jump lands on. Written as absolute coordinates
 * rather than generated, because the course IS these numbers -- the spec
 * reads them, jumps them one at a time, and checks every gap against the
 * table in the header.
 */
export const ROUTE = [
  { stage: 1, sprint: false,
    start: P(6, 10, 10, 14, -1),
    pads: [
      P(12, 13, 11, 12, 0), P(15, 16, 11, 12, 1), P(19, 20, 11, 12, 1),
      P(22, 23, 11, 12, 2), P(25, 26, 11, 12, 3), P(25, 26, 14, 15, 4),
      P(25, 26, 17, 18, 5), P(25, 26, 21, 22, 5), P(25, 26, 24, 25, 6),
      P(28, 29, 24, 25, 7), P(31, 32, 24, 25, 8), P(35, 36, 24, 25, 8),
    ],
    end: P(38, 41, 23, 26, 9) },
  { stage: 2, sprint: true,
    start: P(38, 41, 23, 26, 9),
    pads: [
      P(44, 45, 24, 25, 10), P(44, 45, 20, 21, 11), P(44, 45, 15, 16, 11),
      P(48, 49, 15, 16, 12), P1(51, 15, 13), P1(53, 15, 14),
      P(52, 53, 18, 19, 14), P(52, 53, 22, 23, 15), P(57, 58, 22, 23, 15),
      P(57, 58, 26, 27, 16), P(57, 58, 30, 31, 17), P(61, 62, 30, 31, 18),
      P(61, 62, 33, 34, 19), P(61, 62, 36, 37, 19),
    ],
    end: P(61, 66, 41, 44, 19) },
  { stage: 3, sprint: true,
    start: P(61, 66, 41, 44, 19),
    pads: [
      P(63, 64, 47, 48, 20), P1(63, 50, 21), P(63, 63, 53, 54, 22),
      P(66, 67, 54, 55, 22), P(66, 67, 58, 59, 23), P(66, 67, 63, 64, 23),
      P(62, 63, 63, 64, 24), P(58, 59, 63, 63, 25), P1(55, 63, 25),
      P(55, 55, 59, 60, 26), P(55, 56, 55, 56, 26), P(51, 52, 55, 56, 27),
      P(47, 48, 55, 56, 28), P(43, 44, 55, 56, 29), P(38, 39, 55, 56, 29),
    ],
    end: P(30, 34, 53, 58, 29) },
  { stage: 4, sprint: true,
    start: P(30, 34, 53, 58, 29),
    pads: [
      P(31, 32, 61, 62, 30), P(27, 28, 61, 62, 31), P(23, 24, 61, 61, 32),
      P1(20, 61, 32), P(16, 17, 61, 62, 33), P(16, 17, 66, 67, 33),
      P(12, 13, 66, 67, 34), P(8, 9, 66, 67, 35), P(8, 9, 62, 63, 35),
      P(8, 8, 58, 59, 36), P1(8, 55, 36), P(8, 9, 51, 52, 37),
      P(12, 13, 51, 52, 38), P(12, 13, 47, 48, 39), P(12, 13, 41, 43, 39),
    ],
    end: P(10, 15, 33, 37, 39) },
  { stage: 5, sprint: true,
    start: P(10, 15, 33, 37, 39),
    pads: [
      P(12, 13, 29, 30, 40), P1(12, 25, 41), P1(12, 21, 41),
      P1(16, 21, 42), P1(16, 17, 42), P(19, 20, 16, 17, 43),
      P1(24, 16, 43), P(26, 27, 18, 19, 44), P(26, 26, 22, 23, 45),
      P1(26, 26, 45), P(26, 27, 29, 30, 46), P(22, 23, 30, 31, 47),
      P(22, 23, 34, 35, 48), P(26, 27, 34, 35, 49),
    ],
    end: P(31, 33, 34, 36, 49) },
]

/** Every jump on the course, flattened: from, to, and which rules apply. */
export const JUMPS = ROUTE.flatMap(({ stage, sprint, start, pads, end }) => {
  const chain = [start, ...pads, end]
  return chain.slice(1).map((to, i) => ({ stage, sprint, n: i + 1, from: chain[i], to }))
})

/** Air blocks between two rectangles along x and along z (negative = overlap). */
export function gaps(a, b) {
  return {
    x: Math.max(b.x0 - a.x1, a.x0 - b.x1) - 1,
    z: Math.max(b.z0 - a.z1, a.z0 - b.z1) - 1,
  }
}

export function build(s) {
  ground(s)
  moat(s)
  for (const st of STAGES.slice(1)) island(s, st)
  mast(s)
  summit(s)
  course(s)
  start(s)
  checkpoints(s)
  setPieces(s)
  diving(s)
}

/* ====================================================================== *
 * GEOMETRY HELPERS
 * ====================================================================== */

const key = (x, z) => `${x},${z}`

/** Distance from a point to a rectangle, in blocks (0 inside it). */
function distToRect(x, z, r) {
  const dx = Math.max(r.x0 - x, 0, x - r.x1)
  const dz = Math.max(r.z0 - z, 0, z - r.z1)
  return Math.hypot(dx, dz)
}

/** Cells of a rectangle swept between two pads, widened by `pad`. */
function sweep(a, b, widen) {
  const r = {
    x0: Math.min(a.x0, b.x0) - widen, x1: Math.max(a.x1, b.x1) + widen,
    z0: Math.min(a.z0, b.z0) - widen, z1: Math.max(a.z1, b.z1) + widen,
  }
  return r
}

/** The route that starts on a stage's island, or null for the summit. */
const routeFrom = (st) => ROUTE.find(r => r.stage === st.n)
/** The route that lands on it. */
const routeTo = (st) => ROUTE.find(r => r.stage === st.n - 1)

/**
 * An island's footprint: every cell within 3.5 of a pad of the stage that
 * starts on it, or of the stretch the previous stage lands on, clipped to its
 * quadrant. A union of discs along the route rather than a rectangle, so the
 * island is the shape of the climb over it -- and the net under the climb is
 * guaranteed to be inside the island, because the island is drawn from it.
 */
function footprint(st) {
  const q = QUADS[st.quad]
  const rects = [...routeFrom(st).pads, routeFrom(st).start]
  if (routeTo(st)) rects.push(routeTo(st).end)
  const cells = new Set()
  for (let x = q.x0; x <= q.x1; x++) {
    for (let z = q.z0; z <= q.z1; z++) {
      if (rects.some(r => distToRect(x, z, r) <= 3.5)) cells.add(key(x, z))
    }
  }
  return cells
}

/** 4-neighbour distance from the outside of a set of cells: 1 on the rim. */
function rimDistance(cells) {
  const d = new Map()
  let frontier = []
  for (const c of cells) {
    const [x, z] = c.split(',').map(Number)
    const rim = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => !cells.has(key(x + dx, z + dz)))
    if (rim) { d.set(c, 1); frontier.push(c) }
  }
  let step = 1
  while (frontier.length) {
    const next = []
    for (const c of frontier) {
      const [x, z] = c.split(',').map(Number)
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = key(x + dx, z + dz)
        if (cells.has(k) && !d.has(k)) { d.set(k, step + 1); next.push(k) }
      }
    }
    frontier = next
    step++
  }
  return d
}

/** Small deterministic hash, so the underside's rock is speckled the same
 *  way on every boot. */
const hash = (x, z, salt = 0) => {
  let h = (x * 374761393 + z * 668265263 + salt * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/**
 * The cells of the net: everything under the route of a stage, from its
 * third pad on, widened by one. The first two pads are a step and a hop off
 * the island itself, and the ground around them is where you stand to start,
 * so water there would put the start of the stage in a puddle.
 */
function netCells(st) {
  const r = routeFrom(st)
  const chain = [...r.pads.slice(1), r.end]
  const out = new Set()
  for (let i = 1; i < chain.length; i++) {
    const box = sweep(chain[i - 1], chain[i], 1)
    for (let x = box.x0; x <= box.x1; x++) for (let z = box.z0; z <= box.z1; z++) out.add(key(x, z))
  }
  return out
}

/* ====================================================================== *
 * THE GROUND: stage 1's start, its net, and the moat
 * ====================================================================== */

function ground(s) {
  const st = STAGES[0]
  const r = routeFrom(st)
  /* THE NET FOR STAGE 1 is dug into the ground: three deep (y -3..-1), on
   * bedrock. Not under the start, and not within a block of it, so you walk
   * onto the first pad from dry grass. */
  const net = netCells(st)
  for (const c of net) {
    const [x, z] = c.split(',').map(Number)
    if (distToRect(x, z, r.start) <= 1.5) continue
    if (x < 2 || z < 8 || x > 37) continue
    s.box([x, -3, z], [x, -1, z], 'water')
  }
}

/*
 * THE MOAT: three deep along both corridors, round the foot of the mast. It
 * catches the crossing jumps and the leap off the summit. Kept two blocks in
 * from the plot edge on every side, so whatever the landscape does to the
 * ground outside the plot, the water still has dirt on four sides.
 */
function moat(s) {
  s.box([35, -3, 7], [37, -1, 73], 'water')
  s.box([2, -3, 38], [71, -1, 40], 'water')
  /* A way out every eight blocks: a dirt step one below the surface, which
   * is a swim up and a hop from anywhere in the moat. */
  for (let z = 10; z <= 70; z += 8) {
    if (z >= 36 && z <= 42) continue
    s.box([35, -3, z], [35, -2, z], 'dirt')
    s.box([37, -3, z], [37, -2, z], 'dirt')
  }
  for (let x = 5; x <= 70; x += 8) {
    if (x >= 33 && x <= 39) continue
    s.box([x, -3, 38], [x, -2, 38], 'dirt')
    s.box([x, -3, 40], [x, -2, 40], 'dirt')
  }
  /* And light, sunk in the bed, so the moat is not a black trench at night
   * and a swimmer can see the steps. */
  for (let z = 9; z <= 72; z += 6) if (z < 37 || z > 41) s.set(36, -3, z, 'sea_lantern')
  for (let x = 4; x <= 70; x += 6) if (x < 34 || x > 38) s.set(x, -3, 39, 'sea_lantern')
}

/* ====================================================================== *
 * THE ISLANDS
 * ====================================================================== */

function island(s, st) {
  const cells = footprint(st)
  const rim = rimDistance(cells)
  const top = st.H - 1
  const net = netCells(st)

  for (const c of cells) {
    const [x, z] = c.split(',').map(Number)
    const d = rim.get(c)
    /* The underside: two solid courses under the top, then a taper of up to
     * three more in the middle (five read as a slab of rock from the path), so from below each island reads as a floating
     * island -- a rock with a lawn on it -- and not as a floor slab. */
    const below = 2 + Math.min(3, Math.floor((d - 1) / 2))
    for (let y = top - below; y < top; y++) {
      const depth = top - y
      let k = depth === 1 ? 'dirt' : 'stone'
      if (depth > 1 && hash(x, z, y) < 0.08) k = 'andesite'
      if (depth > 2 && hash(x, z, y + 99) < 0.03) k = 'coal_ore'
      if (y === top - below) k = hash(x, z, 7) < 0.5 ? 'cobblestone' : 'stone'
      s.set(x, y, z, k)
    }
    s.set(x, top, z, d === 1 ? st.trim : st.top)
    /* The net. Only where it is at least two blocks in from the rim, so every
     * water block has island on all four sides and under it -- a leak here is
     * a waterfall onto the stage below. */
    if (net.has(c) && d >= 3) s.set(x, top, z, 'water')
  }

  /* Lamps round the rim, every few blocks, sunk flush into the trim, so the
   * island has an outline at night from the path. */
  for (const c of cells) {
    const [x, z] = c.split(',').map(Number)
    if (rim.get(c) === 1 && (x + z) % 5 === 0) s.set(x, top, z, st.lamp)
  }
}

/* ====================================================================== *
 * THE MAST AND THE SUMMIT
 * ====================================================================== */

/*
 * The mast: three by three, from the ground to the underside of the summit,
 * in the five chapters' colours in ten-block bands -- the same order the path
 * walked them in, bottom to top. A lamp at every band joint, on all four
 * faces, so the bands read at night as a lit ladder of five.
 */
function mast(s) {
  for (let y = -1; y <= SUMMIT.H - 2; y++) {
    const band = STAGES[Math.min(4, Math.floor(Math.max(0, y) / 10))].band
    s.box([MAST.x0, y, MAST.z0], [MAST.x1, y, MAST.z1], band)
  }
  for (let y = 9; y < SUMMIT.H - 1; y += 10) {
    s.set(MAST.x0 + 1, y, MAST.z0, 'sea_lantern')
    s.set(MAST.x0 + 1, y, MAST.z1, 'sea_lantern')
    s.set(MAST.x0, y, MAST.z0 + 1, 'sea_lantern')
    s.set(MAST.x1, y, MAST.z0 + 1, 'sea_lantern')
  }
}

function summit(s) {
  const { x0, x1, z0, z1, H } = SUMMIT
  const top = H - 1
  // The platform, with a gold rim, and a taper under it like the islands.
  s.box([x0, top - 1, z0], [x1, top - 1, z1], 'smooth_stone')
  s.box([x0 + 2, top - 2, z0 + 2], [x1 - 2, top - 2, z1 - 2], 'smooth_stone')
  s.box([x0 + 3, top - 3, z0 + 3], [x1 - 3, top - 3, z1 - 3], 'smooth_stone')
  s.rect([x0, z0], [x1, z1], top, 'polished_diorite')
  for (let x = x0; x <= x1; x++) { s.set(x, top, z0, 'gold_block'); s.set(x, top, z1, 'gold_block') }
  for (let z = z0; z <= z1; z++) { s.set(x0, top, z, 'gold_block'); s.set(x1, top, z, 'gold_block') }

  /* THE REWARD. A plinth in the middle with the trophy on it: a gold cup
   * three blocks tall, with a diamond in the bowl. Mine the diamond; it is
   * the only diamond on the map that is meant to be taken. */
  const cx = 36, cz = 39
  s.box([cx - 1, H, cz - 1], [cx + 1, H, cz + 1], 'polished_blackstone')
  s.set(cx, H + 1, cz, 'gold_block')                       // the stem
  s.box([cx - 1, H + 2, cz - 1], [cx + 1, H + 2, cz + 1], 'gold_block')  // the bowl
  s.set(cx, H + 2, cz, 'diamond_block')
  s.set(cx - 1, H + 3, cz - 1, 'gold_block')               // the rim's corners
  s.set(cx + 1, H + 3, cz - 1, 'gold_block')
  s.set(cx - 1, H + 3, cz + 1, 'gold_block')
  s.set(cx + 1, H + 3, cz + 1, 'gold_block')

  /* THE BEACON: a light column off the back corner of the summit, ten blocks
   * up to the build ceiling, so the top of the climb is a lit point you can
   * see from anywhere on the walk and from the far end of the map at night. */
  s.pillar(x1 - 1, z1 - 1, H, 63, 'glowstone')
  s.pillar(x0 + 1, z1 - 1, H, H + 3, 'quartz_pillar')
  s.set(x0 + 1, H + 4, z1 - 1, 'sea_lantern')
  s.pillar(x1 - 1, z0 + 1, H, H + 3, 'quartz_pillar')
  s.set(x1 - 1, H + 4, z0 + 1, 'sea_lantern')

  /* Rail round three sides at knee height: gold on the deck rim already
   * marks the edge, and a low wall stops a careless step off a fifty-block
   * drop. The landing side (low x) and the diving board stay open. */
  s.box([x0 + 1, H, z1], [x1, H, z1], 'polished_andesite_slab_top')
  s.box([x1, H, z0], [x1, H, z1], 'polished_andesite_slab_top')
  s.box([x0 + 3, H, z0], [x1, H, z0], 'polished_andesite_slab_top')
}

/* ====================================================================== *
 * THE COURSE
 * ====================================================================== */

function course(s) {
  ROUTE.forEach((r) => {
    const st = STAGES[r.stage - 1]
    r.pads.forEach((p) => {
      s.box([p.x0, p.y, p.z0], [p.x1, p.y, p.z1], st.pad)
      /* A lamp hung under every pad. Light falls one level a block, so a lamp
       * in the pad's own column is the only way the top of a one-block pillar
       * is bright at night -- and from the ground the climb is a helix of lit
       * points, which is its silhouette after dark. */
      s.set(p.x0, p.y - 1, p.z0, st.lamp)
    })
  })
}

/* ====================================================================== *
 * THE START
 * ====================================================================== */

function start(s) {
  const r = ROUTE[0].start
  // The start plaza: the pad src/builds/chapters.js reserved, paved in hay.
  s.rect([r.x0, r.z0], [r.x1, r.z1], -1, 'hay_block')
  s.rect([r.x0 + 1, r.z0 + 1], [r.x1 - 1, r.z1 - 1], -1, 'polished_andesite')
  s.set(r.x0 + 2, -1, r.z0 + 2, 'glowstone')

  /* The walk in from the spur at (0, 6): a gravel strip along the north of
   * the plaza, so the arrival is on the course rather than across a lawn. */
  s.rect([1, 6], [r.x1, 8], -1, 'gravel')

  /*
   * THE NOTICE BOARD, facing the arrival. Three signs on a post-and-lintel,
   * read from the path side: 'east' is -x in this engine (blockMeshes.js
   * FACINGS), which is the way a visitor coming off the spur is looking from.
   */
  const bx = r.x0 - 1
  s.pillar(bx + 1, r.z0 - 1, 0, 2, 'stripped_oak_log')
  s.pillar(bx + 1, r.z1 + 1, 0, 2, 'stripped_oak_log')
  s.box([bx + 1, 3, r.z0 - 1], [bx + 1, 3, r.z1 + 1], 'stripped_oak_log')
  s.box([bx + 1, 1, r.z0 + 1], [bx + 1, 2, r.z1 - 1], 'spruce_planks')
  s.set(bx + 1, 4, r.z0 - 1, 'glowstone')
  s.set(bx + 1, 4, r.z1 + 1, 'glowstone')
  const lines = [
    [r.z0 + 3, ['THE CLIMB', 'Five stages,', 'fifty blocks up', '']],
    [r.z0 + 2, ['Jump: Space', 'Sprint: Ctrl', 'Stage 1 needs', 'no sprint']],
    [r.z0 + 1, ['Fall? Water', 'catches you on', 'the island you', 'started from']],
  ]
  // The board fills z0+1..z1-1; wall signs on its -x face.
  for (const [z, text] of lines) {
    s.set(bx, 2, z, 'oak_wall_sign_east')
    setSignText(...s.toWorld(bx, 2, z), text)
  }
}

/* ====================================================================== *
 * CHECKPOINTS: a flagpole and a sign on every island where you land
 * ====================================================================== */

/*
 * Where each flag stands, by hand, because the obvious rule -- "just past the
 * landing" -- put stage 3's pole in the middle of its own first jump. Each is
 * on the island, off the route, and the cloth flies along z so that it is
 * broadside to the path (which is on the low-x side) rather than edge-on.
 */
const FLAGS = {
  2: { pole: [39, 28], fly: 1 },
  3: { pole: [59, 42], fly: 1 },
  4: { pole: [33, 51], fly: -1 },
  5: { pole: [9, 35], fly: -1 },
}

function checkpoints(s) {
  for (const st of STAGES.slice(1)) {
    const { pole: [px, pz], fly } = FLAGS[st.n]
    onIsland(st, px, pz, `stage ${st.n}'s flagpole`)
    const H = st.H
    s.pillar(px, pz, H, H + 5, 'quartz_pillar')
    // The flag: the stage's two colours, three long, flying along z.
    for (let i = 1; i <= 3; i++) {
      s.box([px, H + 4, pz + fly * i], [px, H + 5, pz + fly * i], st.band)
      s.set(px, H + 3, pz + fly * i, st.trim)
    }
    s.set(px, H + 6, pz, 'sea_lantern')
    // The sign on the pole's -x face, which is the side the path is on.
    s.set(px - 1, H + 1, pz, 'oak_wall_sign_east')
    setSignText(...s.toWorld(px - 1, H + 1, pz),
      [`Stage ${st.n} of 5`, st.name, 'Checkpoint', ''])
  }
}

/** Throw unless (x, z) is island top for this stage: a set piece or a pole
 *  that misses its island is floating in the air, and nothing else would
 *  notice. */
function onIsland(st, x, z, what) {
  if (!footprint(st).has(key(x, z))) {
    throw new Error(`[ch6] ${what} at (${x}, ${z}) is not on the ${st.name} island`)
  }
}

/* ====================================================================== *
 * SET PIECES: one small thing per stage that says which chapter it is
 * ====================================================================== */

function setPieces(s) {
  /* OMAHA. Hay bales and pumpkins on the grass beside the start: a farm
   * state's harvest, which is the only claim it makes. */
  s.box([2, 0, 17], [4, 0, 19], 'hay_block')
  s.box([2, 1, 18], [3, 1, 18], 'hay_block')
  for (const [x, z] of [[2, 21], [4, 22], [3, 24]]) s.set(x, 0, z, 'pumpkin')

  /* HARVARD. A gate: two crimson piers and a brick lintel over the walk from
   * the landing to the first jump, the lintel high enough (y = H + 4) that a
   * jump under it never touches it. */
  {
    const st = STAGES[1], H = st.H
    for (const z of [21, 28]) {
      onIsland(st, 42, z, 'the Harvard gate')
      s.pillar(42, z, H, H + 4, 'red_nether_bricks')
      s.set(42, H + 5, z, 'sea_lantern')
    }
    s.box([42, H + 4, 22], [42, H + 4, 27], 'bricks')
  }

  /* BILIBILI. A television with two antennae, in the site's light blue and
   * pink -- the shape of the logo every viewer of the channel knows. Its
   * screen faces the path. Symmetric, so no mirroring question. */
  {
    const st = STAGES[2], H = st.H, x = 69
    for (let z = 41; z <= 45; z++) onIsland(st, x, z, 'the Bilibili television')
    s.pattern({
      at: [x, H, 41], plane: 'zy',
      legend: { B: 'light_blue_concrete', K: 'black_concrete', P: 'pink_concrete', L: 'sea_lantern' },
      rows: [
        '.P.P.',
        '..P..',
        'BBBBB',
        'BLKLB',
        'BKKKB',
        'BBBBB',
      ],
    })
  }

  /* NEW YORK. A yellow cab, parked by the landing. */
  {
    const st = STAGES[3], H = st.H
    for (let z = 52; z <= 56; z++) { onIsland(st, 27, z, 'the cab'); onIsland(st, 28, z, 'the cab') }
    s.box([27, H, 52], [28, H, 56], 'yellow_concrete')
    s.box([27, H + 1, 53], [28, H + 1, 55], 'black_stained_glass')
    s.box([27, H + 2, 53], [28, H + 2, 55], 'yellow_concrete')
    s.set(27, H + 3, 54, 'glowstone')            // the roof light
    // Wheels, standing proud of both sides.
    for (const z of [53, 55]) { s.set(26, H, z, 'black_concrete'); s.set(29, H, z, 'black_concrete') }
  }

  /* SAN FRANCISCO. One tower of a suspension bridge in international orange:
   * two legs and two cross-beams, broadside to the path. */
  {
    const st = STAGES[4], H = st.H
    for (const z of [31, 35]) {
      onIsland(st, 17, z, 'the bridge tower')
      s.pillar(17, z, H, H + 7, 'orange_concrete')
    }
    s.box([17, H + 4, 32], [17, H + 4, 34], 'orange_concrete')
    s.box([17, H + 7, 32], [17, H + 7, 34], 'orange_concrete')
    s.set(17, H + 8, 31, 'sea_lantern')
    s.set(17, H + 8, 35, 'sea_lantern')
  }

  /* THE TOP. A sign on the trophy's plinth, read by whoever just landed. */
  s.set(34, SUMMIT.H, 39, 'oak_wall_sign_east')
  setSignText(...s.toWorld(34, SUMMIT.H, 39),
    ['You made it.', 'Fifty blocks,', 'five chapters.', 'Take the diamond'])
}

/* ====================================================================== *
 * THE WAY DOWN
 * ====================================================================== */

/*
 * A diving board off the low-x edge of the summit, straight over the
 * corridor between the Omaha-and-San-Francisco quadrant and the New York one,
 * which is clear all the way to the moat. Walk off the end and you fall fifty
 * blocks into three blocks of water; the spec does exactly that and checks
 * the health bar.
 */
function diving(s) {
  const z = 39, y = SUMMIT.H - 1
  s.box([SUMMIT.x0 - 4, y, z], [SUMMIT.x0 - 1, y, z], 'spruce_planks')
  s.set(SUMMIT.x0 - 4, y - 1, z, 'glowstone')
  // The sign, on a post beside the root of the board.
  s.set(SUMMIT.x0, SUMMIT.H, z - 1, 'spruce_planks')
  s.set(SUMMIT.x0 - 1, SUMMIT.H, z - 1, 'oak_wall_sign_east')
  setSignText(...s.toWorld(SUMMIT.x0 - 1, SUMMIT.H, z - 1),
    ['The way down:', 'walk off the', 'board. Water', 'is below.'])
}
