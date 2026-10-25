/*
 * CHAPTER 2: HARVARD. The Science Center, its plaza, and the Yard.
 *
 * ------------------------------------------------------------------------
 * THE BRIEF, from the ch2 row in src/builds/plots.js: Harvard's Science
 * Center -- Josep Lluis Sert, 1970-72, nine storeys plus an observatory --
 * "straddling a pedestrian passage between Harvard Yard and the northern
 * campus", with the plaza in front and the Yard beyond. This chapter also
 * holds the school work, so the degree is on a blackboard and the two jobs
 * the archive gave stages of their own (Perplexity, Arize) are an exhibit in
 * a study room, from the resume and nothing else.
 *
 * THE FACTS ABOUT THE BUILDING, and where each one came from:
 *
 *   - Sert, Jackson and Associates; built 1970-72, opened 1973; nine storeys
 *     plus basement and an observatory floor, with a rooftop observatory;
 *     sits astride the pedestrian passage between the Yard and the northern
 *     campus; the plaza between it and the Yard holds the Tanner Fountain and
 *     hosts food trucks; five large lecture halls. -- Wikipedia, "Harvard
 *     Science Center".
 *   - "Stepped back, like the bellows of a Polaroid camera, deferring to
 *     Littauer Center and the magnificent Memorial Hall" -- Harvard Magazine.
 *     Local lore says it was meant to look like a Polaroid; Sert hated that.
 *     Edwin Land, who invented the Polaroid camera, funded it.
 *   - Terraced classrooms for the mathematics department step down to the
 *     library and the demonstration theatres, which sit under "a spiderlike
 *     steel framework"; textured precast concrete panels in a frame of posts
 *     and lintels. -- SAH Archipedia, via search summary.
 *   - Exposed-aggregate concrete panels, vertical elements between the floor
 *     slabs; inside, concrete painted white with red and blue accents, wood
 *     panelled lobby walls, brick tile floors. -- Leers Weinzapfel Associates,
 *     who renovated it.
 *
 * WHAT COULD NOT BE FOUND: a floor plan or a site plan. The footprint is the
 * massing the descriptions give -- tall office/lab slab on the Oxford Street
 * side, terraces stepping down from it, the lecture theatres at the low end
 * under their steel frame -- and not a measured drawing.
 * ------------------------------------------------------------------------
 * ORIENTATION. 74 x 76, x 0..73 and z 0..75. The path is on the LOW-x edge
 * (this plot is RIGHT of the walk) and the spur arrives at local (0, 6). The
 * visitor faces +z (south) as they come in, and facing +z, +x is on their
 * RIGHT -- the same frame src/builds/ch1-millard-north.js is written in.
 *
 * THE ORDER IS THE REAL ONE: Yard, then plaza, then the Science Center. The
 * row comment in plots.js lists "the plaza, the building, and the Yard on the
 * far side of it", but on the ground the plaza is BETWEEN the Yard and the
 * building -- it is the lid of the Cambridge Street tunnel -- and a visitor
 * who walks out of the Yard gate onto the plaza and sees the stepped front
 * rise in front of them is having the real experience. So the spur arrives in
 * the Yard (north), the gate lets you onto the plaza, and the building fills
 * the south half. The passage through it runs on to the south edge of the
 * plot, which stands in for the northern campus.
 *
 * Seen from the plaza the real building puts its tall slab on the RIGHT
 * (Oxford Street, east) and steps down to the LEFT (Memorial Hall, west).
 * Facing +z, right is +x, so the tower is at high x and the lecture halls are
 * at low x, next to the path -- which also puts the one tall thing in the
 * plot where it is visible from every point of the walk.
 *
 * SCALE. 5 blocks a storey (4 of air and a slab), so nine storeys is the
 * slab at y = 44 and the domes stand on it. On plan it is compressed, as ch1
 * is: the real building is far longer than 70 blocks.
 *
 * MIRRORING. Every readable word here is a SIGN (src/signText.js), whose
 * glyphs derive their facing from the block and cannot come out backwards.
 * The block-drawn things -- the chalk on the blackboards, the Polaroid stripes
 * -- read the same either way round. That is a deliberate choice: the
 * README's mirrored-text warning is avoided rather than survived.
 */
import { setSignText } from '../signText.js'

export const SIZE = { w: 74, d: 76 }

const P = {
  panel: 'light_gray_concrete',     // exposed-aggregate precast
  fin: 'smooth_stone',              // the vertical precast elements
  slab: 'polished_diorite',         // floor slab edges, read as horizontal bands
  window: 'gray_stained_glass',     // recessed dark glazing
  curtain: 'white_stained_glass',   // the library's glass front onto the plaza
  mullion: 'polished_deepslate',
  steel: 'black_concrete',          // the spiderlike steel frame
  tile: 'smooth_stone',             // interior floors
  brickTile: 'bricks',              // the corridor floors are brick tile
  white: 'white_concrete',          // interior walls, painted white
  red: 'red_concrete',              // ...with red and blue accents
  blue: 'blue_concrete',
  wood: 'spruce_planks',            // the panelled lobby
  light: 'glowstone',
  lamp: 'sea_lantern',
  paving: 'polished_andesite',
  joint: 'smooth_stone',
  brick: 'bricks',                  // the Yard
  trim: 'smooth_quartz',
  roof: 'deepslate_tiles',
  path: 'andesite',
  post: 'polished_blackstone',
}

/* ---------------------------------------------------------------- frame */

const FRONT = 45          // the building's plaza face
const BACK = 73           // its south face; z 74..75 is the northern campus
const LECT = [2, 21]      // the lecture halls, under the steel frame
const PASS = [22, 26]     // the pedestrian passage, straight through
const CEN = [22, 50]      // the terraced block, bridging the passage
const TOW = [51, 71]      // the nine-storey slab
const TOWER_FACE = 50     // where the slab rises from the two-storey plinth
const TOP = 8             // the ninth storey's index (0-based)

/** Floor slab of storey k. Storey k's air is y = 5k .. 5k+3. */
const slabY = (k) => 5 * k - 1

/* The terraces: the front line of each step of the central block, and the
 * highest storey that step carries. Each step is five blocks behind the last
 * and one storey taller, which is the bellows. */
const STEPS = [
  { z: FRONT, top: 1 },
  { z: 50, top: 2 },
  { z: 55, top: 3 },
  { z: 60, top: 4 },
  { z: 65, top: 5 },
]
/** The front face of the central block at storey k. */
const cenFront = (k) => STEPS.find(t => t.top >= k).z

const YARD_GATE = [34, 38]  // the gate from the Yard onto the plaza
const FOUNTAIN = [13, 36]   // Tanner Fountain, toward the lecture-hall end

export function build(s) {
  site(s)
  yard(s)
  plaza(s)
  lectureHalls(s)
  centralBlock(s)
  tower(s)
  lightWell(s)
  observatory(s)
  exhibit(s)
  signs(s)
  eggs(s)
}

/* ====================================================================== *
 * SITE
 * ====================================================================== */

function site(s) {
  /* The survey posts come out wherever this build puts its own edge. The
   * marker wall (x 0..27, z 2..3) is left exactly as chapters.js drew it. */
  for (let z = 4; z <= 75; z++) { s.clear([0, 0, z], [0, 1, z]); s.clear([73, 0, z], [73, 1, z]) }
  for (let x = 0; x <= 73; x++) s.clear([x, 0, 75], [x, 1, 75])
  for (let x = 29; x <= 73; x++) s.clear([x, 0, 0], [x, 1, 0])

  /* The northern campus beyond the passage: a strip of paving the passage
   * runs out onto. */
  s.rect([1, 74], [72, 75], -1, P.paving)
}

/* ====================================================================== *
 * THE YARD: red brick, white trim, slate roofs, elms, the coloured chairs,
 * and a brick-pier fence with a gate onto the plaza.
 * ====================================================================== */

function yard(s) {
  /* Paths first, so the halls and the fence can sit on them. The spur lands
   * at (0, 6); the walk goes in through the east gate, along the north side
   * and down to the plaza gate. */
  s.rect([0, 5], [YARD_GATE[1], 7], -1, P.path)
  s.rect([YARD_GATE[0] + 1, 5], [YARD_GATE[1] - 1, 27], -1, P.path)
  s.rect([YARD_GATE[1], 17], [55, 18], -1, P.path)           // to Hall N's door
  s.rect([54, 15], [56, 18], -1, P.path)
  s.rect([55, 19], [62, 21], -1, P.path)                      // to Hall W's door

  // The fence: low brick wall, taller piers every six, stone caps.
  const fence = (pts) => {
    pts.forEach(([x, z], i) => {
      const pier = i % 6 === 0
      s.pillar(x, z, 0, pier ? 2 : 0, P.brick)
      if (pier) s.set(x, 3, z, P.trim)
    })
  }
  const run = []
  for (let z = 9; z <= 27; z++) run.push([0, z])                        // east
  fence(run)
  const south = []
  for (let x = 0; x <= 73; x++) if (x < YARD_GATE[0] || x > YARD_GATE[1]) south.push([x, 27])
  fence(south)
  const north = []
  for (let x = 29; x <= 73; x++) north.push([x, 4])
  fence(north)
  const west = []
  for (let z = 4; z <= 27; z++) west.push([73, z])
  fence(west)

  /* The two gates: tall piers capped in white, with a lamp on each. */
  for (const [x, z] of [[0, 4], [0, 8], [YARD_GATE[0] - 1, 27], [YARD_GATE[1] + 1, 27]]) {
    s.pillar(x, z, 0, 4, P.brick)
    s.set(x, 5, z, P.trim)
    s.set(x, 6, z, P.lamp)
  }
  s.clear([YARD_GATE[0], 0, 27], [YARD_GATE[1], 3, 27])

  georgian(s, { x0: 40, x1: 70, z0: 6, z1: 14, door: 55, doorSide: 'south' })
  georgian(s, { x0: 63, x1: 71, z0: 17, z1: 25, door: 21, doorSide: 'west' })

  // Elms, tall-trunked and vase-crowned, which is what the Yard's are.
  for (const [x, z] of [[8, 13], [16, 21], [24, 11], [30, 19], [46, 22], [56, 24], [11, 24], [21, 16]]) {
    elm(s, x, z)
  }

  /* The chairs. The Yard's are painted in a handful of bright colours and
   * left wherever people dragged them, so: scattered, singly and in twos. */
  const colours = ['red_concrete', 'orange_concrete', 'yellow_concrete', 'lime_concrete', 'light_blue_concrete', 'blue_concrete']
  const chairs = [[12, 17], [13, 17], [19, 12], [27, 22], [28, 23], [42, 20], [44, 21], [50, 24], [6, 19], [33, 13], [60, 23], [17, 25]]
  chairs.forEach(([x, z], i) => s.set(x, 0, z, colours[i % colours.length]))

  // Lamps along the paths.
  for (const [x, z] of [[8, 8], [20, 8], [32, 8], [39, 14], [39, 22], [48, 19], [60, 18]]) lampPost(s, x, z)
}

/**
 * A Georgian brick hall: three storeys of four blocks, white-trimmed windows
 * in a regular grid, a slate roof, chimneys at the ends, a door with a white
 * surround. Lit inside on every floor, so its windows are lit at night.
 */
function georgian(s, { x0, x1, z0, z1, door, doorSide }) {
  const H = 11                                           // eaves
  s.box([x0, -1, z0], [x1, H, z1], P.brick)
  for (let k = 0; k < 3; k++) {
    const yf = 4 * k - 1
    s.clear([x0 + 1, yf + 1, z0 + 1], [x1 - 1, yf + 3, z1 - 1])
    s.rect([x0 + 1, z0 + 1], [x1 - 1, z1 - 1], yf, k === 0 ? 'spruce_planks' : 'planks')
    for (let x = x0 + 3; x <= x1 - 2; x += 5) {
      for (let z = z0 + 2; z <= z1 - 2; z += 4) s.set(x, yf + 4, z, P.light)
    }
  }
  // Windows: 1 x 2, white sill and head, every third block on every face.
  const win = (x, z) => {
    for (let k = 0; k < 3; k++) {
      const y = 4 * k
      s.box([x, y + 1, z], [x, y + 2, z], 'glass')
      s.set(x, y, z, P.trim)
      s.set(x, y + 3, z, P.trim)
    }
  }
  for (let x = x0 + 2; x <= x1 - 2; x += 3) { win(x, z0); win(x, z1) }
  for (let z = z0 + 2; z <= z1 - 2; z += 3) { win(x0, z); win(x1, z) }
  // A white cornice at the eaves.
  s.hollow([x0, H, z0], [x1, H, z1], { walls: P.trim })
  // The roof: a stepped gable along the long axis, in slate.
  const alongX = (x1 - x0) >= (z1 - z0)
  const half = Math.floor(((alongX ? z1 - z0 : x1 - x0) + 1) / 2)
  for (let i = 0; i < half; i++) {
    if (alongX) s.box([x0, H + 1 + i, z0 + i], [x1, H + 1 + i, z1 - i], P.roof)
    else s.box([x0 + i, H + 1 + i, z0], [x1 - i, H + 1 + i, z1], P.roof)
  }
  // Chimneys at the two ends.
  if (alongX) { s.pillar(x0 + 1, z0 + half, H + 1, H + half + 2, P.brick); s.pillar(x1 - 1, z0 + half, H + 1, H + half + 2, P.brick) }
  else { s.pillar(x0 + half, z0 + 1, H + 1, H + half + 2, P.brick); s.pillar(x0 + half, z1 - 1, H + 1, H + half + 2, P.brick) }

  // The door, two wide, with a white surround and a lamp over it.
  if (doorSide === 'south') {
    s.box([door - 2, -1, z1], [door + 2, 3, z1], P.trim)
    s.clear([door - 1, 0, z1], [door + 1, 2, z1])
    s.set(door, 3, z1 + 1, P.lamp)
  } else {
    s.box([x0, -1, door - 2], [x0, 3, door + 2], P.trim)
    s.clear([x0, 0, door - 1], [x0, 2, door + 1])
    s.set(x0 - 1, 3, door, P.lamp)
  }
}

function elm(s, x, z) {
  s.pillar(x, z, 0, 6, 'oak_log')
  // A vase: narrow low, wide high, a flat-ish top.
  for (let dy = 5; dy <= 9; dy++) {
    const r = dy <= 5 ? 1.6 : dy >= 9 ? 2.6 : 3.4
    const ri = Math.ceil(r)
    for (let dx = -ri; dx <= ri; dx++) {
      for (let dz = -ri; dz <= ri; dz++) {
        const d = Math.hypot(dx, dz)
        if (d > r) continue
        if (d > r - 0.9 && ((x + dx) * 7 + (z + dz) * 13 + dy * 5) % 4 === 0) continue
        if (dx === 0 && dz === 0 && dy <= 6) continue
        s.set(x + dx, dy, z + dz, 'oak_leaves')
      }
    }
  }
}

function lampPost(s, x, z, h = 3) {
  s.pillar(x, z, 0, h, P.post)
  s.set(x, h + 1, z, P.lamp)
}

/* ====================================================================== *
 * THE PLAZA: the lid of the Cambridge Street tunnel. Paving, the Tanner
 * Fountain, a food truck, tables, and light.
 * ====================================================================== */

function plaza(s) {
  s.rect([1, 28], [72, FRONT - 1], -1, P.paving)
  for (let x = 4; x <= 72; x += 6) s.rect([x, 28], [x, FRONT - 1], -1, P.joint)
  for (let z = 31; z < FRONT; z += 6) s.rect([1, z], [72, z], -1, P.joint)
  // The walk in from the gate, straight at the library's doors.
  s.rect([YARD_GATE[0] + 1, 28], [YARD_GATE[1] - 1, FRONT - 1], -1, P.slab)

  /* THE TANNER FOUNTAIN: a ring of boulders set into the paving round a
   * wet centre. The real one is 159 stones; this one is what fits a radius
   * of six, with gaps between them you can walk through. */
  const [fx, fz] = FOUNTAIN
  const stones = ['stone', 'andesite', 'tuff', 'cobblestone', 'diorite']
  let n = 0
  for (let dx = -7; dx <= 7; dx++) {
    for (let dz = -7; dz <= 7; dz++) {
      const d = Math.hypot(dx, dz)
      if (d >= 5.5 && d < 6.5 && ((dx * 3 + dz * 5) & 1) === 0) {
        s.set(fx + dx, 0, fz + dz, stones[n++ % stones.length])
      }
      if (d < 2.5) s.set(fx + dx, -1, fz + dz, 'water')
      else if (d < 5.5) s.set(fx + dx, -1, fz + dz, 'polished_tuff')
    }
  }
  // Lit from under the rim so the ring reads at night.
  for (const [dx, dz] of [[0, -3], [0, 3], [-3, 0], [3, 0]]) s.set(fx + dx, -1, fz + dz, P.lamp)

  /* A FOOD TRUCK, because the plaza hosts them. Generic, unbranded. */
  const tx = 56, tz = 31
  s.box([tx, 0, tz], [tx + 7, 3, tz + 3], 'white_concrete')
  s.box([tx, 0, tz], [tx + 7, 0, tz + 3], 'light_gray_concrete')
  s.box([tx + 6, 1, tz], [tx + 7, 3, tz + 3], 'red_concrete')         // the cab
  s.box([tx + 7, 2, tz], [tx + 7, 2, tz + 3], 'glass')
  s.box([tx + 1, 2, tz], [tx + 4, 2, tz], 'glass')                    // the serving hatch
  s.box([tx + 1, 3, tz - 1], [tx + 4, 3, tz - 1], 'red_concrete')     // its awning
  s.set(tx + 2, 3, tz + 1, P.light)
  for (const [dx, dz] of [[1, -1], [6, -1], [1, 4], [6, 4]]) s.set(tx + dx, 0, tz + dz, 'black_concrete')
  s.clear([tx + 1, 0, tz - 1], [tx + 1, 0, tz - 1])
  s.clear([tx + 6, 0, tz - 1], [tx + 6, 0, tz - 1])

  // Tables: a slab top on a dark post, with seats round them.
  for (const [x, z] of [[44, 33], [49, 37], [44, 40], [29, 34], [27, 40]]) {
    s.set(x, 0, z, 'spruce_slab')
    for (const [dx, dz] of [[-1, 0], [1, 0]]) s.set(x + dx, 0, z + dz, 'spruce_slab')
  }

  // Trees down the two ends, and light.
  for (const [x, z] of [[5, 29], [5, 41], [68, 37], [67, 43]]) elm(s, x, z)
  for (const [x, z] of [[6, 30], [24, 30], [31, 42], [42, 30], [52, 42], [66, 30], [66, 42], [6, 43]]) lampPost(s, x, z)
}

/* ====================================================================== *
 * FACADES. Precast panels between slab bands, vertical fins every third
 * block, two-high dark windows between them.
 * ====================================================================== */

/**
 * Skin one face of a volume. `axis` 'z' is a wall at z = at running a0..a1
 * in x; 'x' is a wall at x = at running a0..a1 in z. Storeys k0..k1.
 */
function skin(s, axis, at, a0, a1, k0, k1) {
  const put = (a, y, key) => (axis === 'z' ? s.set(a, y, at, key) : s.set(at, y, a, key))
  for (let k = k0; k <= k1; k++) {
    const y0 = 5 * k
    for (let a = a0; a <= a1; a++) {
      put(a, y0 - 1, P.slab)
      const fin = (a - a0) % 3 === 0 || a === a1
      for (let dy = 0; dy < 4; dy++) {
        if (fin) put(a, y0 + dy, P.fin)
        else put(a, y0 + dy, dy === 1 || dy === 2 ? P.window : P.panel)
      }
    }
  }
  // The band on top of the last storey.
  for (let a = a0; a <= a1; a++) put(a, 5 * k1 + 4, P.slab)
}

/** Ceiling lights for a storey, in the slab over it. */
function storeyLights(s, x0, x1, z0, z1, k, step = 5) {
  const y = slabY(k + 1)
  for (let x = x0 + 2; x <= x1 - 1; x += step) {
    for (let z = z0 + 2; z <= z1 - 1; z += step) s.set(x, y, z, P.light)
  }
}

/* ====================================================================== *
 * THE LECTURE HALLS, two of the five, raked, with blackboards -- and on
 * their roof the steel frame that makes this end of the building look like
 * nothing else on campus.
 * ====================================================================== */

function lectureHalls(s) {
  const [x0, x1] = LECT
  const top = slabY(2)                                     // y = 9, the roof
  s.box([x0, -1, FRONT], [x1, top, BACK], P.panel)
  /* The halls are windowless in the photographs of this end: a blank
   * concrete face with one deep band. A slot of glass at the top lets light
   * in and out. */
  for (const [axis, at, a0, a1] of [['z', FRONT, x0, x1], ['z', BACK, x0, x1], ['x', x0, FRONT, BACK]]) {
    for (let a = a0; a <= a1; a++) {
      const put = (y, k) => (axis === 'z' ? s.set(a, y, at, k) : s.set(at, y, a, k))
      put(4, P.slab)
      put(top, P.slab)
      if ((a - a0) % 4 !== 0) put(7, P.window)
      else put(7, P.fin)
    }
  }

  hall(s, FRONT + 1, 58, 'A')
  hall(s, 60, BACK - 1, 'B')

  // A door from the plaza into hall A's low end, and a canopy over it.
  s.clear([x0 + 2, 0, FRONT], [x0 + 3, 2, FRONT])
  s.box([x0 + 1, 3, FRONT - 1], [x0 + 4, 3, FRONT - 1], P.steel)
  s.set(x0 + 2, 3, FRONT - 1, P.lamp)

  /* THE SPIDERLIKE STEEL FRAMEWORK. A grid of dark beams standing over the
   * whole roof on posts, with cross-bracing in the bays -- a frame you can
   * see the sky through, which is the point of it. */
  const yb = top + 4
  for (let x = x0; x <= x1; x += 4) {
    for (let z = FRONT; z <= BACK; z += 4) s.pillar(x, z, top + 1, yb, P.steel)
  }
  for (let x = x0; x <= x1; x += 4) s.line([x, yb, FRONT], [x, yb, BACK], P.steel)
  for (let z = FRONT; z <= BACK; z += 4) s.line([x0, yb, z], [x1, yb, z], P.steel)
  for (let x = x0; x + 4 <= x1; x += 4) {
    for (let z = FRONT; z + 4 <= BACK + 1; z += 4) {
      // A diagonal in every bay, descending, so the frame reads as a web.
      for (let i = 1; i < 4; i++) s.set(x + i, yb - (i === 2 ? 1 : 0), z + i, P.steel)
    }
  }
}

/**
 * One raked lecture hall between z0 and z1. Stage and blackboard at the
 * north end; tiers rising to the south; a door from the passage at each end.
 */
function hall(s, z0, z1, name) {
  const [lx0, lx1] = LECT
  const x0 = lx0 + 1, x1 = lx1 - 1
  s.clear([x0, 0, z0], [x1, 8, z1])
  s.rect([x0, z0], [x1, z1], -1, P.wood)
  s.rect([x0, z0], [x1, z1], 9, P.white)
  for (const x of [x0, x1]) s.box([x, 0, z0], [x, 8, z1], P.white)
  // Red and blue accents, which is what the interior concrete was painted.
  s.box([x0, 5, z0], [x0, 5, z1], P.red)
  s.box([x1, 5, z0], [x1, 5, z1], P.blue)

  // The tiers: two rows deep each, rising one block a tier.
  const tiers = Math.floor((z1 - z0 - 4) / 2)
  for (let t = 0; t < tiers; t++) {
    const tz = z0 + 4 + t * 2
    s.box([x0 + 1, 0, tz], [x1 - 1, t, Math.min(z1, tz + 1)], P.wood)
    // A seat row along the front of each tier, with an aisle left open.
    for (let x = x0 + 2; x <= x1 - 2; x++) {
      if (x === 11 || x === 12) continue
      s.set(x, t + 1, tz + 1, 'red_wool')
    }
  }
  /* The aisle (x 11..12) has no seats, so every riser in it is one block
   * and the rake is a staircase rather than a wall. */

  /*
   * THE BLACKBOARD on the north wall, read by somebody facing -z -- and
   * facing -z in this engine, +x is on the viewer's LEFT. So the chalk is
   * written through `chalk(u, y)`, where u counts from the viewer's left,
   * and a graph that is meant to rise to the right does.
   */
  const bx0 = x0 + 2, bx1 = x1 - 2                         // x 5..18
  s.box([bx0, 1, z0], [bx1, 6, z0], 'dark_prismarine')
  s.box([bx0 - 1, 0, z0], [bx1 + 1, 0, z0], 'spruce_planks')   // the chalk ledge
  const chalk = (u, y) => s.set(bx1 - u, y, z0, 'white_concrete')
  // Left: a pair of axes and a curve climbing them.
  for (let y = 2; y <= 6; y++) chalk(1, y)
  for (let u = 1; u <= 5; u++) chalk(u, 2)
  for (const [u, y] of [[2, 3], [3, 3], [4, 4], [5, 5], [5, 6]]) chalk(u, y)
  // Right: a binary tree, root and two levels.
  for (const [u, y] of [[10, 6], [9, 5], [11, 5], [8, 4], [12, 4], [8, 3], [12, 3]]) chalk(u, y)
  // Lit from the ceiling and from the walls over the eyeline.
  for (let x = x0 + 2; x <= x1 - 1; x += 4) for (let z = z0 + 2; z <= z1 - 1; z += 4) s.set(x, 9, z, P.light)
  for (let z = z0 + 2; z <= z1 - 1; z += 4) { s.set(x0, 6, z, P.lamp); s.set(x1, 6, z, P.lamp) }

  // The sign on the board, which is where the degree goes.
  const sx = Math.round((x0 + x1) / 2)
  if (name === 'A') {
    s.set(sx, 3, z0 + 1, 'oak_wall_sign_south')
    setSignText(...s.toWorld(sx, 3, z0 + 1), ['Applied Math', 'in Computer', 'Science', '(B.A.)'])
  } else {
    s.set(sx, 3, z0 + 1, 'oak_wall_sign_south')
    setSignText(...s.toWorld(sx, 3, z0 + 1), ['Lecture Hall', 'Evan took', 'classes in this', 'building'])
  }

  // Doors from the passage: at the stage end at ground level.
  s.clear([lx1 - 1, 0, z0 + 1], [lx1, 2, z0 + 2])
}

/* ====================================================================== *
 * THE CENTRAL BLOCK: the library on the plaza behind a glass front, the
 * terraced classrooms stepping up behind it, and the bridge over the
 * passage.
 * ====================================================================== */

function centralBlock(s) {
  const [x0, x1] = CEN
  // The mass, step by step: each step from its own front line to the back.
  STEPS.forEach((t, i) => {
    const yLo = i === 0 ? -1 : slabY(STEPS[i - 1].top + 1)
    s.box([x0, yLo, t.z], [x1, slabY(t.top + 1), BACK], P.panel)
  })

  // THE PASSAGE, cut straight through under it, four high.
  s.clear([PASS[0], 0, FRONT], [PASS[1], 3, 75])
  s.rect([PASS[0], FRONT - 1], [PASS[1], 75], -1, P.brickTile)
  for (let z = FRONT + 1; z <= BACK; z += 4) s.set(24, 4, z, P.light)
  s.clear([PASS[0], 0, 74], [PASS[1], 1, 75])

  // Skins: the front face of every step, both sides, the back.
  STEPS.forEach((t, i) => {
    const k0 = i === 0 ? 0 : STEPS[i - 1].top + 1
    skin(s, 'z', t.z, x0, x1, k0, t.top)
    skin(s, 'x', x0, t.z, BACK, k0, t.top)
  })
  skin(s, 'z', BACK, x0, x1, 0, STEPS[STEPS.length - 1].top)
  // Re-open the passage mouths the skins just closed.
  s.clear([PASS[0], 0, FRONT], [PASS[1], 3, FRONT])
  s.clear([PASS[0], 0, BACK], [PASS[1], 3, BACK])
  s.clear([x0, 0, FRONT], [x0, 3, BACK])       // the passage's open east side
  // ...except the bridge's own wall line, which carries the slab.
  for (let z = FRONT; z <= BACK; z += 7) s.pillar(x0, z, 0, 3, P.fin)

  /* THE TERRACED CLASSROOMS. Storeys 1..5 behind each step's front line;
   * each one a room with desks facing a board, and a door out onto the
   * terrace in front of it. */
  for (let k = 1; k <= STEPS[STEPS.length - 1].top; k++) {
    const zf = k === 1 ? 59 : cenFront(k) + 1
    const y = 5 * k
    s.clear([x0 + 1, y, zf], [x1 - 1, y + 3, BACK - 1])
    s.rect([x0 + 1, zf], [x1 - 1, BACK - 1], y - 1, P.tile)
    storeyLights(s, x0, x1, zf - 1, BACK, k, 5)
    // Desks in rows facing north.
    for (let z = zf + 3; z <= BACK - 2; z += 3) {
      for (let x = x0 + 3; x <= x1 - 3; x++) if ((x - x0) % 4 !== 0) s.set(x, y, z, 'birch_planks')
    }
    // The board, on the front wall, between the windows' fins.
    if (k >= 2) {
      s.box([x0 + 5, y + 1, zf], [x0 + 12, y + 2, zf], 'dark_prismarine')
      // ...and the door out onto the terrace, which is why the board stops short.
      s.clear([35, y, zf - 1], [36, y + 2, zf - 1])
    }
    // Through to the tower's floor at the same level.
    s.clear([x1, y, 70], [TOW[0], y + 2, 71])
  }

  /* AFTER the storeys, not before: storey 1's floor is the ceiling of the
   * interior street and the study room, and laying it first painted over
   * every light in that ceiling -- the study room came out pitch black. */
  library(s)
  interiorStreet(s)

  // The terraces: a parapet along each deck's front and sides.
  STEPS.forEach((t, i) => {
    if (i === STEPS.length - 1) return
    const y = slabY(t.top + 1) + 1
    const zEnd = STEPS[i + 1].z - 1
    s.line([x0, y, t.z], [x1, y, t.z], P.fin)
    s.line([x0, y, t.z], [x0, y, zEnd], P.fin)
    // Planters on the decks.
    for (let x = x0 + 3; x <= x1 - 3; x += 6) s.set(x, y, t.z + 2, 'moss_block')
  })
  // The roof parapet.
  const ry = slabY(STEPS[STEPS.length - 1].top + 1) + 1
  s.hollow([x0, ry, STEPS[STEPS.length - 1].z], [x1, ry, BACK], { walls: P.fin })
}

/** The library on the plaza: double height, a glass front, shelves, tables. */
function library(s) {
  const x0 = 28, x1 = 49, z0 = FRONT + 1, z1 = 57
  s.clear([x0, 0, z0], [x1, 8, z1])
  s.rect([x0, z0], [x1, z1], -1, P.tile)
  s.rect([x0, z0], [x1, z1], 9, P.white)
  s.box([27, 0, z0], [27, 8, z1], P.wood)                 // the panelled side
  s.box([x0, 0, z1 + 1], [x1, 8, z1 + 1], P.white)       // back wall

  // The glass front, floor to slab, with mullions every third.
  s.box([x0 - 1, 0, FRONT], [x1 + 1, 8, FRONT], P.curtain)
  for (let x = x0 - 1; x <= x1 + 1; x += 3) s.pillar(x, FRONT, 0, 8, P.mullion)
  s.box([x0 - 1, 4, FRONT], [x1 + 1, 4, FRONT], P.mullion)
  // The doors, on the axis from the Yard gate.
  s.clear([YARD_GATE[0] + 1, 0, FRONT], [YARD_GATE[1] - 1, 2, FRONT])

  // Shelves in runs along the back, with an aisle lamp over each gap.
  for (let i = 0; i < 4; i++) {
    const sx = x0 + 2 + i * 5
    s.box([sx, 0, 51], [sx + 1, 3, z1 - 2], 'bookshelf')
  }
  for (let i = 0; i < 4; i++) {
    const sx = x0 + 4 + i * 5
    for (let z = 52; z <= z1; z += 3) s.set(sx, 9, z, P.light)
  }
  // Long reading tables at the glass, under the double-height space.
  for (const x of [x0 + 2, x0 + 9, x0 + 16]) {
    s.box([x, 0, FRONT + 3], [x + 4, 0, FRONT + 3], 'spruce_planks')
    s.box([x, 0, FRONT + 4], [x + 4, 0, FRONT + 4], 'red_wool')
  }
  for (let x = x0 + 2; x <= x1; x += 4) for (const z of [z0 + 1, z0 + 4]) s.set(x, 9, z, P.light)
  for (let z = z0 + 1; z <= z1; z += 4) { s.set(27, 5, z, P.lamp); s.set(50, 5, z, P.lamp) }
  // Through to the interior street behind, in the corner.
  s.clear([x0, 0, z1 + 1], [x0 + 1, 2, z1 + 1])
  /* And a stair up to the first-floor rooms and the bridge over the
   * passage, against the back wall, through a gap in it at the top. */
  for (let i = 0; i < 5; i++) s.box([x1 - 5 + i, 0, z1], [x1 - 5 + i, i, z1], P.tile)
  s.clear([x1 - 1, 5, z1 + 1], [x1, 7, z1 + 1])
}

/** The crossroads behind the library: an interior street from the passage
 *  to the tower lobby, brick-tiled, with the exhibit room off it. */
function interiorStreet(s) {
  const z0 = 59, z1 = 61
  s.clear([28, 0, z0], [50, 3, z1])
  s.rect([28, z0], [50, z1], -1, P.brickTile)
  s.rect([28, z0], [50, z1], 4, P.white)
  for (let x = 30; x <= 49; x += 5) s.set(x, 4, 60, P.light)
  s.clear([27, 0, z0], [27, 2, z1])                       // into the passage
  s.clear([TOW[0], 0, z0], [TOW[0], 2, z1])               // into the tower lobby
  s.box([28, 0, 62], [50, 3, 62], P.white)                // its south wall

  /* THE STUDY ROOM off it, which is where the exhibit is. One room across
   * the whole block, with glass onto the street so it is seen walking past. */
  s.clear([28, 0, 63], [49, 3, BACK - 1])
  s.rect([28, 63], [49, BACK - 1], -1, P.tile)
  for (let x = 30; x <= 49; x += 4) for (let z = 65; z <= BACK - 1; z += 4) s.set(x, 4, z, P.light)
  s.clear([29, 0, 62], [30, 2, 62])
  s.box([33, 1, 62], [44, 2, 62], 'glass')
  /* Its back wall is solid at this storey, not windowed: the exhibit's
   * signs hang on it, and a sign on a pane of glass reads as a sticker. */
  s.box([28, 0, BACK], [49, 3, BACK], P.panel)
}

/* ====================================================================== *
 * THE TOWER: nine storeys of offices and labs on the Oxford Street side,
 * over a two-storey plinth that runs forward to the plaza.
 * ====================================================================== */

function tower(s) {
  const [x0, x1] = TOW
  s.box([x0, -1, FRONT], [x1, slabY(2), BACK], P.panel)
  s.box([x0, slabY(2), TOWER_FACE], [x1, slabY(TOP + 1), BACK], P.panel)

  skin(s, 'z', FRONT, x0, x1, 0, 1)
  skin(s, 'z', TOWER_FACE, x0, x1, 2, TOP)
  skin(s, 'x', x1, FRONT, BACK, 0, 1)
  skin(s, 'x', x1, TOWER_FACE, BACK, 2, TOP)
  skin(s, 'x', x0, TOWER_FACE, BACK, STEPS[STEPS.length - 1].top + 1, TOP)
  skin(s, 'z', BACK, x0, x1, 0, TOP)

  // THE LOBBY: double height, wood-panelled, a brick-tile floor.
  s.clear([x0 + 1, 0, FRONT + 1], [x1 - 1, 8, BACK - 1])
  s.rect([x0 + 1, FRONT + 1], [x1 - 1, BACK - 1], -1, P.brickTile)
  s.box([x1 - 1, 0, FRONT + 1], [x1 - 1, 3, BACK - 1], P.wood)
  for (let x = x0 + 2; x <= x1 - 1; x += 4) for (let z = FRONT + 2; z <= BACK - 1; z += 4) s.set(x, 9, z, P.light)
  for (let z = FRONT + 2; z <= BACK - 1; z += 5) s.set(x1 - 1, 5, z, P.lamp)
  // Doors from the plaza, centred on the slab.
  const dx = Math.round((x0 + x1) / 2)
  s.clear([dx - 1, 0, FRONT], [dx + 1, 2, FRONT])
  s.box([dx - 3, 3, FRONT - 2], [dx + 3, 3, FRONT - 1], P.steel)
  s.set(dx, 3, FRONT - 1, P.lamp)
  // The plinth roof is a terrace too, continuous with the first step's.
  s.line([x0, 10, FRONT], [x1, 10, FRONT], P.fin)
  s.line([x1, 10, FRONT], [x1, 10, TOWER_FACE - 1], P.fin)

  // Storeys 2..8: open floors, lit, with lab benches in rows.
  for (let k = 2; k <= TOP; k++) {
    const y = 5 * k
    s.clear([x0 + 1, y, TOWER_FACE + 1], [x1 - 1, y + 3, BACK - 1])
    s.rect([x0 + 1, TOWER_FACE + 1], [x1 - 1, BACK - 1], y - 1, P.tile)
    storeyLights(s, x0, x1, TOWER_FACE, BACK, k, 5)
    for (let z = TOWER_FACE + 3; z <= 64; z += 4) {
      s.box([x0 + 3, y, z], [x0 + 10, y, z], k % 2 ? 'white_concrete' : 'smooth_stone')
    }
  }
  // The roof parapet.
  s.hollow([x0, slabY(TOP + 1) + 1, TOWER_FACE], [x1, slabY(TOP + 1) + 1, BACK], { walls: P.fin })
}

/* ====================================================================== *
 * THE LIGHT WELL: a stair that winds up the whole tower round a column of
 * light, open to every floor, out onto the roof. It is how a visitor gets
 * to the observatory, and it is lit all the way up because it IS the light.
 * ====================================================================== */

const WELL = { x0: 64, z0: 66 }  // 5 x 5, x 64..68, z 66..70

function lightWell(s) {
  const { x0, z0 } = WELL
  const roof = slabY(TOP + 1)                              // y = 44
  s.clear([x0, 0, z0], [x0 + 4, roof, z0 + 4])
  s.box([x0 + 1, -1, z0 + 1], [x0 + 3, roof, z0 + 3], P.lamp)
  // The ring, clockwise from the north-west corner.
  const ring = []
  for (let x = x0; x <= x0 + 4; x++) ring.push([x, z0])
  for (let z = z0 + 1; z <= z0 + 4; z++) ring.push([x0 + 4, z])
  for (let x = x0 + 3; x >= x0; x--) ring.push([x, z0 + 4])
  for (let z = z0 + 3; z >= z0 + 1; z--) ring.push([x0, z])
  for (let i = 0; i <= roof; i++) {
    const [x, z] = ring[i % ring.length]
    s.set(x, i, z, 'polished_andesite')
  }
  // A rail round the hole on the roof, open where the last step arrives.
  const [ex, ez] = ring[roof % ring.length]
  for (let x = x0 - 1; x <= x0 + 5; x++) {
    for (const z of [z0 - 1, z0 + 5]) if (!(Math.abs(x - ex) <= 1 && Math.abs(z - ez) <= 1)) s.set(x, roof + 1, z, P.fin)
  }
  for (let z = z0; z <= z0 + 4; z++) {
    for (const x of [x0 - 1, x0 + 5]) if (!(Math.abs(x - ex) <= 1 && Math.abs(z - ez) <= 1)) s.set(x, roof + 1, z, P.fin)
  }
  s.set(x0 + 2, roof + 1, z0 + 2, P.light)
}

/* ====================================================================== *
 * THE OBSERVATORY: two domes on the roof of the slab, a telescope in each.
 * ====================================================================== */

function observatory(s) {
  const base = slabY(TOP + 1) + 1                          // y = 45
  for (const [cx, cz] of [[56, 57], [65, 57]]) {
    for (let dy = 0; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        for (let dz = -4; dz <= 4; dz++) {
          const d = Math.hypot(dx, dy * 1.05, dz)
          if (d <= 3.5 && d > 2.5) s.set(cx + dx, base + dy, cz + dz, 'white_concrete')
          else if (d <= 2.5) s.set(cx + dx, base + dy, cz + dz, 'air')
        }
      }
    }
    // The slit, running over the top.
    for (let dy = 1; dy <= 3; dy++) s.set(cx, base + dy, cz - (3 - dy + 1), 'air')
    s.set(cx, base + 3, cz, 'air'); s.set(cx, base + 3, cz - 1, 'air')
    // A drum under it, and a door facing the stair.
    s.box([cx - 3, base, cz - 1], [cx - 3, base + 1, cz + 1], 'light_gray_concrete')
    s.clear([cx - 3, base, cz], [cx - 3, base + 1, cz])
    s.clear([cx + 3, base, cz], [cx + 3, base + 1, cz])
    // The telescope: a pier and a tube pointing at the slit.
    s.set(cx, base, cz, 'iron_block')
    s.set(cx, base + 1, cz, 'black_concrete')
    s.set(cx, base + 2, cz - 1, 'black_concrete')
    s.set(cx, base - 1, cz + 1, P.light)
    s.set(cx + 1, base - 1, cz - 1, P.light)
  }
}

/* ====================================================================== *
 * THE EXHIBIT: the two jobs these years also held, in the study room off
 * the interior street. From the resume and nothing else.
 * ====================================================================== */

function exhibit(s) {
  /*
   * 140 UNIVERSITIES, and they are countable. "Expanded the student
   * ambassador program to 250+ representatives across 140 universities": the
   * floor of the study room is a fourteen by ten inlay, one tile per school,
   * Perplexity's teal checkered with white. The room is exactly that wide
   * between the two desks, which is why the desks are where they are.
   */
  let tiles = 0
  for (let x = 32; x <= 45; x++) {
    for (let z = 63; z <= 72; z++) {
      s.set(x, -1, z, (x + z) % 2 ? 'cyan_concrete' : 'white_concrete')
      tiles++
    }
  }
  if (tiles !== 140) throw new Error(`the inlay has ${tiles} tiles, not 140`)

  // Two desks, one per job, each with a screen.
  s.box([29, 0, 66], [31, 0, 66], 'spruce_planks')
  s.set(30, 1, 66, 'cyan_concrete')                         // Perplexity's teal
  s.box([46, 0, 66], [48, 0, 66], 'spruce_planks')
  s.set(47, 1, 66, 'purple_concrete')

  const sign = (x, y, z, dir, lines) => {
    s.set(x, y, z, `oak_wall_sign_${dir}`)
    setSignText(...s.toWorld(x, y, z), lines)
  }
  /* On the back wall, facing the visitor who has just walked in (north),
   * and on the front of each desk. */
  sign(30, 1, 72, 'north', ['Perplexity', 'Growth Intern', 'Aug-Dec 2024', 'Remote'])
  sign(30, 0, 65, 'north', ['Pitched the', 'student tier', 'to the Head', 'of Growth'])
  sign(36, 1, 72, 'north', ['Student tier:', '150,000+ users', 'in 3 months'])
  sign(41, 1, 72, 'north', ['250+ reps at', '140 schools.', 'One tile each', 'on the floor.'])
  sign(47, 1, 72, 'north', ['Arize AI', 'Content Writer', 'Jun 2023 -', 'Dec 2024'])
  sign(47, 0, 65, 'north', ['GenAI writing:', '1M+ views on X', 'and the Arize', 'site'])
}

/* ====================================================================== *
 * SIGNS ON THE PLAZA.
 * ====================================================================== */

function signs(s) {
  const sign = (x, y, z, dir, lines) => {
    s.set(x, y, z, `oak_wall_sign_${dir}`)
    setSignText(...s.toWorld(x, y, z), lines)
  }
  // A plinth by the Yard gate, read as you come through it.
  const px = 44, pz = 29
  s.box([px, 0, pz], [px + 4, 1, pz], P.post)
  s.set(px + 1, 2, pz, P.lamp)
  s.set(px + 3, 2, pz, P.lamp)
  sign(px, 1, pz - 1, 'north', ['Chapter 2', 'Harvard', 'B.A., Dec 2024'])
  sign(px + 1, 1, pz - 1, 'north', ['Science Center', 'J. L. Sert', '1970-72'])
  sign(px + 2, 1, pz - 1, 'north', ['9 storeys +', 'an observatory', 'on the roof'])
  /* The rename, in Evan's own framing (his answer, 2026-10-25): the
   * building is the Science Center here because that is what it was while
   * he was there. Zimmer Hall is the footnote, never the title. */
  sign(px + 3, 1, pz - 1, 'north', ['It was the', 'Science Center', 'while I was', 'there.'])
  sign(px + 4, 1, pz - 1, 'north', ['Since renamed', 'Zimmer Hall. I', 'know it by its', 'old name.'])

  // By the passage mouth.
  s.pillar(PASS[0] - 1 + 0, FRONT - 1, 0, 1, P.post)
  sign(PASS[0] - 1, 1, FRONT - 2, 'north', ['Passage to the', 'north campus'])

  /* At the entrance from the path, facing the arrival. A wall sign facing
   * EAST faces -x in this engine (FACINGS in src/blockMeshes.js), which is
   * toward the path; the post it hangs on is on its +x side. */
  s.pillar(4, 9, 0, 2, P.post)
  s.set(4, 3, 9, P.lamp)
  sign(3, 1, 9, 'east', ['Harvard Yard', 'Plaza and', 'Science Center', 'to the south'])
}

/* ====================================================================== *
 * THE EASTER EGGS.
 *
 *   ON TOP    the observatory, up the light well, nine storeys.
 *   ON TOP    THE POLAROID. Edwin Land, who invented the instant camera,
 *             paid for this building, and the lore that it was meant to
 *             look like one of his cameras is the thing Sert hated most.
 *             So on the highest terrace, visible only from the tower roof,
 *             the deck is laid in the five stripes of the old Polaroid
 *             colour bar.
 *   UNDER     the tunnel under the plaza -- see below.
 * ====================================================================== */

function eggs(s) {
  const top = STEPS[STEPS.length - 1]
  const y = slabY(top.top + 1)
  const stripes = ['red_concrete', 'orange_concrete', 'yellow_concrete', 'lime_concrete', 'blue_concrete']
  stripes.forEach((k, i) => s.box([CEN[0] + 8 + i * 3, y, top.z + 2], [CEN[0] + 10 + i * 3, y, BACK - 2], k))

  /* UNDER THE FOUNTAIN: the tunnel. The plaza is the lid of the Cambridge
   * Street underpass, so under the paving beside the ring there is two
   * blocks of it -- a lit stretch of road with a centre line, reached
   * through a missing paving stone with a crate under it. */
  const [fx, fz] = FOUNTAIN
  const tz0 = fz + 6, tz1 = fz + 7
  s.clear([2, -3, tz0], [30, -2, tz1])
  s.rect([2, tz0], [30, tz1], -4, 'black_concrete')
  for (let x = 3; x <= 30; x += 3) s.set(x, -4, tz0, 'yellow_concrete')
  for (let x = 4; x <= 30; x += 6) s.set(x, -2, tz1 + 1, P.lamp)
  /* The way down and back up: two open paving stones, a barrel and another
   * barrel, each one block up from the last, because a cellar here has
   * exactly two blocks of headroom and a jump is one. */
  s.clear([20, -1, tz0], [21, -1, tz0])
  s.set(21, -3, tz0, 'barrel')
  s.set(20, -2, tz0, 'barrel')
}
