/*
 * CHAPTER 4: NEW YORK, NO LOGO. One Manhattan block and the loft where the
 * company is.
 *
 * ------------------------------------------------------------------------
 * THE FACTS, all of them from the resume (public/EvanJolley_Resume.pdf) and
 * nothing else, because the brief for this chapter says so in as many words:
 *
 *   No Logo, New York, June 2025 - August 2026. Product and Growth,
 *   employee #2. YC and Floodgate. Clients bring a product idea; No Logo
 *   handles factory sourcing, sampling, mass production, QC and freight
 *   through to finished inventory. Joined at a $100K revenue run rate and
 *   helped scale to $8M in 15 months. Built growth from zero, starting with
 *   50 cold emails a day, then a team across creative, paid media and partner
 *   outreach. Helped grow China operations from two part-time employees to a
 *   full-time 20-person office in Shenzhen. Built a custom CRM for creator
 *   outreach. Hired the Creative Director and launched the YouTube channel,
 *   whose first long-form video passed 150K views in two weeks. Drove product
 *   strategy for the software that runs operations: factory quoting,
 *   sampling, production tracking, fulfillment.
 *
 * WHERE: the Cable Building, 611 Broadway, at Houston Street -- the owner
 * says No Logo's office was in it, so the company's floors are inside a
 * rebuild of that building (see THE CABLE BUILDING below for its sources).
 * WHAT IS NOT KNOWN, and therefore not drawn: which floor, the office's
 * layout, any client, any product, any face. The Shenzhen office is a video
 * call on a screen, because that is the only way this chapter's New York
 * ever saw it.
 *
 * ------------------------------------------------------------------------
 * THE SLICE OF NEW YORK, chosen so that each thing is recognisable from the
 * path in one look, and none of them needs a caption:
 *
 *   - BROADWAY along the path side with yellow cabs, white lane dashes,
 *     zebra crossings, and cobra-head street lamps, and HOUSTON STREET
 *     crossing it;
 *   - THE CABLE BUILDING on the north-west corner, where it stands: a
 *     limestone arcade, orange brick, a copper cornice, chamfered corners,
 *     the round window with its two figures, and the Angelika at its foot.
 *     Nine storeys, the No Logo floors inside, a stair to the roof;
 *   - a BROWNSTONE with a stoop and a water tower further along Houston;
 *   - a CORNER DELI with its sign over the awning, across Houston;
 *   - a SUBWAY ENTRANCE with green globes, down to a platform and a train --
 *     there is a real one at Broadway and Houston;
 *   - the EMPIRE STATE BUILDING, setbacks, mast and lit crown, at the back of
 *     the plot so it is the skyline behind everything else. It is not in
 *     NoHo; it is in every picture of New York, which is why it is here.
 *
 * ------------------------------------------------------------------------
 * ORIENTATION. ch4 is a RIGHT plot: the path is on the low-x side and the
 * spur arrives at local (0, 6). So the avenue runs along z at x 4..10, and
 * every facade that matters faces -x, toward the visitor.
 *
 * MIRRORING. A word on a wall facing -x is a `zy` pattern read by somebody
 * looking +x, and facing +x in this left-handed engine puts +z on the
 * viewer's LEFT -- so the characters must run toward -z, and every such word
 * here is stamped with `mirror = true`. That is the same conclusion ch1's gym
 * wall reached (GYM_MIRROR, verified there by screenshot), and it is checked
 * again for these walls by test/99-chapters-4-6.spec.js, which reads each
 * word back out of the world from the viewer's side.
 *
 * The north rows (z 0..4) are left alone for the chapter marker.
 */
import { wordRows, wordWidth } from './lettering.js'
import { wallSign, switchback, tree } from './kit.js'

/*
 * SIGNS, BY THE OWNER'S RULE: a sign carries what a real place would carry
 * -- a building's or a business's name -- and nothing else. No dates, no
 * metrics, no resume lines on walls; those belong to AI Evan. The rooms
 * below tell their facts in architecture (two desks, fifty tiles, twenty
 * faces, one gold block and eighty) and say them in no words at all.
 */
export const SIZE = { w: 74, d: 76 }

/** Words on walls that face -x (read from the path) are mirrored. */
export const FACING_PATH_MIRROR = true

const P = {
  asphalt: 'gray_concrete',
  lane: 'white_concrete',
  sidewalk: 'smooth_stone',
  curb: 'polished_andesite',
  castIron: 'smooth_quartz',          // the loft's painted cast-iron front
  castTrim: 'quartz_pillar',
  loftSide: 'bricks',
  brownstone: 'brown_terracotta',
  brownTrim: 'mud_bricks',
  cornice: 'dark_oak_planks',
  glass: 'glass',
  dark: 'polished_blackstone',
  lamp: 'sea_lantern',
  ceiling: 'glowstone',
  floor: 'spruce_planks',             // loft floorboards
  limestone: 'calcite',               // the Empire State's limestone
  spandrel: 'light_gray_concrete',
  window: 'gray_concrete',
}

/* THE STREET GRID, plot-local. */
const AVE = { x0: 4, x1: 10 }          // the avenue, running along z
const WALK_W = { x0: 1, x1: 3 }        // the sidewalk on the path side
const WALK_E = { x0: 11, x1: 13 }      // the sidewalk on the building side
const XST = { z0: 38, z1: 42 }         // the cross street, running along x
const XWALK_N = { z0: 35, z1: 37 }     // its sidewalks
const XWALK_S = { z0: 43, z1: 45 }
const Z0 = 5                            // everything starts south of the marker

export function build(s) {
  streets(s)
  cableBuilding(s)
  brownstones(s)
  loadingDock(s)
  deli(s)
  subway(s)
  park(s)
  empireState(s)
  streetFurniture(s)
}

/* ====================================================================== *
 * THE STREETS
 * ====================================================================== */

function streets(s) {
  // Pave everything south of the marker first: New York has no lawn.
  s.rect([1, Z0], [72, 74], -1, P.sidewalk)
  // The avenue and the cross street.
  s.rect([AVE.x0, Z0], [AVE.x1, 74], -1, P.asphalt)
  s.rect([AVE.x0, XST.z0], [72, XST.z1], -1, P.asphalt)
  // Curbs: a darker line where each sidewalk meets the road.
  s.rect([WALK_W.x1, Z0], [WALK_W.x1, 74], -1, P.curb)
  s.rect([WALK_E.x0, Z0], [WALK_E.x0, XWALK_N.z1], -1, P.curb)
  s.rect([WALK_E.x0, XWALK_S.z0], [WALK_E.x0, 74], -1, P.curb)
  s.rect([WALK_E.x0, XWALK_N.z1], [72, XWALK_N.z1], -1, P.curb)
  s.rect([WALK_E.x0, XWALK_S.z0], [72, XWALK_S.z0], -1, P.curb)
  // The road again over the curb lines where the two roads cross.
  s.rect([AVE.x0, XST.z0], [WALK_E.x1, XST.z1], -1, P.asphalt)

  // White lane dashes: the avenue has three lanes, one way, as they do.
  for (let z = Z0; z <= 74; z++) {
    if (z >= XWALK_N.z0 && z <= XWALK_S.z1) continue
    if (z % 4 < 2) { s.set(6, -1, z, P.lane); s.set(8, -1, z, P.lane) }
  }
  // The cross street's double yellow.
  for (let x = 14; x <= 72; x++) s.set(x, -1, 40, 'yellow_concrete')

  // ZEBRA CROSSINGS on the avenue, both sides of the intersection, and one
  // over the cross street on the building side.
  for (const [z0, z1] of [[XWALK_N.z0, XWALK_N.z1], [XWALK_S.z0, XWALK_S.z1]]) {
    for (let x = AVE.x0; x <= AVE.x1; x += 2) s.rect([x, z0], [x, z1], -1, P.lane)
  }
  for (let z = XST.z0; z <= XST.z1; z += 2) s.rect([15, z], [17, z], -1, P.lane)

  // The walk in from the spur at (0, 6): onto the sidewalk.
  s.rect([0, 5], [0, 7], -1, P.sidewalk)
}

/*
 * THE CABLE BUILDING, 611 Broadway, at the north-west corner of Broadway and
 * Houston Street. No Logo's office was in it (the owner, in as many words).
 *
 * WHAT IS KNOWN ABOUT IT, and where from:
 *   - McKim, Mead & White (Stanford White), 1892-94, Beaux-Arts, built as
 *     the headquarters of the Broadway Cable Railroad; the cable powerhouse
 *     was in the basement, which is now the Angelika Film Center.
 *   - NINE storeys, steel frame, brick, stone and terra cotta facing.
 *   - A TWO-STOREY LIMESTONE ARCADE at the base, show windows with iron
 *     spandrels and keystones.
 *   - LIGHT ORANGE BRICK and terra cotta above it; seven storeys of offices
 *     round a light court.
 *   - A COPPER CORNICE with lions' faces; small square attic windows tucked
 *     under it, which is why the building reads as eight storeys from the
 *     street.
 *   - BOTH HOUSTON STREET CORNERS CHAMFERED.
 *   - A large round window near the top of the Broadway front, two classically
 *     robed female figures astride it, over a pediment with the building's
 *     name; and two colossal figures by J. Massey Rhind at the Broadway door.
 *   Sources: Wikipedia, "Cable Building (New York City)"; newyorkitecture.com
 *   "Cable Building"; Village Preservation (urbanarchive.org). The bay
 *   counts below are NOT measured -- no source gave them -- and are drawn
 *   from the proportions of the frontages: Broadway is the short front and
 *   Houston the long one, roughly 1 : 1.6 here.
 *
 * THE SCALE. Broadway front 27 blocks, Houston 42, nine storeys in 38: the
 * two-storey arcade is ten blocks, the six office storeys four each, the
 * attic three, then the cornice. That is one block to roughly four feet on
 * plan and a little less in height, the same stretch ch1 takes, so the
 * storeys are walkable.
 *
 * INSIDE, the four No Logo floors carry over from the loft this replaces --
 * the facts are in the rooms, not on the walls -- on storeys 3 to 6; 7, 8 and
 * the attic are lit, empty offices; the ground floor is the lobby off
 * Broadway and, through a wall, a cinema for the Angelika. One stair climbs
 * from the lobby to the roof.
 */
const CB = { x0: 14, x1: 55, z0: 8, z1: 34 }
const BASE_TOP = 9                      // the arcade's slab; storey 3 stands at 10
const STOREY = 4
const ROOF = 37                         // the roof slab; storeys 3..9 below it
const storeyBase = (k) => BASE_TOP + 1 + (k - 3) * STOREY   // k = 3..9
const CHAMFER = 2

/** Is (x, z) inside the building's plan, after the two Houston chamfers? */
function inPlan(x, z) {
  const { x0, x1, z0, z1 } = CB
  if (x < x0 || x > x1 || z < z0 || z > z1) return false
  if ((x - x0) + (z1 - z) < CHAMFER) return false
  if ((x1 - x) + (z1 - z) < CHAMFER) return false
  return true
}

const C = {
  limestone: 'calcite',
  brick: 'smooth_red_sandstone',        // light orange brick
  terra: 'smooth_sandstone',            // the cream terra cotta trim
  copper: 'weathered_cut_copper',
  lion: 'oxidized_chiseled_copper',
  key: 'chiseled_stone_bricks',
  iron: 'polished_blackstone',
  figure: 'smooth_quartz',
}

function cableBuilding(s) {
  const { x0, x1, z0, z1 } = CB
  // The mass: limestone to the arcade's top, brick above, hollow inside.
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      if (!inPlan(x, z)) continue
      s.box([x, -1, z], [x, BASE_TOP, z], C.limestone)
      s.box([x, BASE_TOP + 1, z], [x, ROOF, z], C.brick)
    }
  }
  s.clear([x0 + 1, 0, z0 + 1], [x1 - 1, ROOF - 1, z1 - 1])
  // The outer wall again round the whole plan, including the diagonal of
  // each chamfer, which the clear above hollowed.
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      const edge = inPlan(x, z) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => !inPlan(x + dx, z + dz))
      if (edge) s.box([x, 0, z], [x, ROOF - 1, z], C.brick)
      if (edge) s.box([x, 0, z], [x, BASE_TOP, z], C.limestone)
    }
  }
  // Floors: the ground, the arcade's slab, and every storey above.
  s.rect([x0 + 1, z0 + 1], [x1 - 1, z1 - 1], -1, 'polished_andesite')
  for (let k = 3; k <= 9; k++) s.rect([x0 + 1, z0 + 1], [x1 - 1, z1 - 1], storeyBase(k) - 1, P.floor)
  s.rect([x0 + 1, z0 + 1], [x1 - 1, z1 - 1], ROOF, P.dark)
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) if (!inPlan(x, z)) s.box([x, -1, z], [x, ROOF + 2, z], 'air')
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) if (!inPlan(x, z)) s.set(x, -1, z, P.sidewalk)

  broadwayFront(s)
  houstonFront(s)
  backAndNorth(s)
  cornice(s)
  cableStair(s)
  lights(s)
  lobbyAndCinema(s)
  sampleRoom(s, storeyBase(3))
  employeeTwo(s, storeyBase(4))
  growthFloor(s, storeyBase(5))
  operations(s, storeyBase(6))
  roof(s)
}

/**
 * One front, bay by bay. `along` is the axis the front runs on, `fixed` its
 * plane, `out` the outward step (-1 or +1 on the other axis), `piers` the
 * pier positions along it. Everything else -- arcade, windows, attic -- is
 * derived per bay, so both fronts share one grammar.
 */
function front(s, { along, fixed, out, piers, from, to }) {
  const put = (u, y, k, d = 0) => along === 'z' ? s.set(fixed + out * d, y, u, k) : s.set(u, y, fixed + out * d, k)
  const ok = (u) => along === 'z' ? inPlan(fixed, u) : inPlan(u, fixed)
  // Piers: proud by one, limestone on the arcade, brick above, full height.
  for (const u of piers) {
    if (!ok(u)) continue
    for (let y = -1; y <= ROOF - 1; y++) put(u, y, y <= BASE_TOP ? C.limestone : C.brick, 1)
  }
  // The band between arcade and shaft, proud, in terra cotta.
  for (let u = from; u <= to; u++) if (ok(u)) { put(u, BASE_TOP, C.terra, 1); put(u, BASE_TOP + 1, C.terra) }
  // Bays.
  for (let i = 0; i < piers.length - 1; i++) {
    const a = piers[i] + 1, b = piers[i + 1] - 1
    if (b < a) continue
    const mid = (a + b) / 2
    for (let u = a; u <= b; u++) {
      if (!ok(u)) continue
      // THE ARCADE: a two-storey show window, rounded at the head, with an
      // iron spandrel across it between the two storeys and a keystone.
      for (let y = 0; y <= 7; y++) put(u, y, P.glass)
      put(u, 4, C.iron)
      if (u === a || u === b) put(u, 7, C.limestone)
      put(u, 8, Math.abs(u - mid) < 1 ? C.key : C.limestone)
      // THE SHAFT: storeys 3..8, a row of tall windows a storey with a cream
      // spandrel at each floor line; the top storey's heads are arched.
      for (let k = 3; k <= 8; k++) {
        const y = storeyBase(k)
        for (let dy = 0; dy <= 2; dy++) put(u, y + dy, P.glass)
        put(u, y + 3, C.terra)
        if (k === 8 && (u === a || u === b)) put(u, y + 2, C.brick)
      }
      // THE ATTIC: one small square window a bay, under the cornice.
      if (Math.abs(u - mid) < 1) put(u, storeyBase(9) + 1, P.glass)
    }
  }
}

/* BROADWAY, the short front, facing -x at x = 14, the door in the middle. */
const BWAY_PIERS = [8, 13, 18, 23, 28, 32]

function broadwayFront(s) {
  front(s, { along: 'z', fixed: CB.x0, out: -1, piers: BWAY_PIERS, from: CB.z0, to: CB.z1 })
  const x = CB.x0
  // THE DOOR, in the centre bay (19..22): an opening under the arcade glass.
  s.clear([x, 0, 20], [x, 3, 21])
  s.box([x - 1, 4, 19], [x - 1, 4, 22], C.terra)            // a hood over it
  s.set(x - 1, 3, 19, P.lamp); s.set(x - 1, 3, 22, P.lamp)
  /* RHIND'S TWO FIGURES flanking the door: robed, standing, on plinths. */
  for (const z of [18, 23]) {
    s.set(x - 2, 0, z, 'smooth_stone')
    s.box([x - 2, 1, z], [x - 2, 2, z], C.figure)
    s.set(x - 2, 3, z, C.limestone)
  }
  /* THE BUSINESS NAME, at the door and nowhere else. */
  wallSign(s, x - 1, 1, 24, 'east', ['No Logo', '', '', ''])

  /*
   * THE ROUND WINDOW NEAR THE TOP, with its two figures astride it, over a
   * plain panel where the name is carved -- breaking up through the attic
   * into the cornice line, as it does on the real front. Symmetric, so no
   * mirroring question. Drawn on the face plane, the figures one proud.
   */
  s.pattern({
    at: [x, 28, 17], plane: 'zy',
    legend: { S: C.terra, G: P.glass, C: C.terra, B: C.brick },
    rows: [
      'B.SSSS.B',
      'BSGGGGSB',
      'SGGGGGGS',
      'SGGGGGGS',
      'SGGGGGGS',
      'BSGGGGSB',
      'B.SSSS.B',
      'CCCCCCCC',
      'CCCCCCCC',
    ],
  })
  for (const [z, dz] of [[17, -1], [24, 1]]) {
    s.box([x - 1, 31, z], [x - 1, 33, z], C.figure)         // the figure
    s.set(x - 1, 34, z, C.limestone)                         // her head
    s.set(x - 1, 31, z + dz, C.figure)                       // the drape
  }
  s.box([x - 1, 29, 17], [x - 1, 29, 24], C.terra)          // the pediment ledge
}

/* HOUSTON, the long front, facing +z at z = 34, the Angelika at its far end. */
const HOU_PIERS = [16, 21, 26, 31, 36, 41, 46, 51, 54]

function houstonFront(s) {
  front(s, { along: 'x', fixed: CB.z1, out: 1, piers: HOU_PIERS, from: CB.x0, to: CB.x1 })
  // The chamfered corners get a window each storey, so the cut reads.
  for (const [x, z] of [[15, 33], [54, 33]]) {
    for (let k = 3; k <= 8; k++) s.box([x, storeyBase(k), z], [x, storeyBase(k) + 2, z], P.glass)
    s.box([x, 0, z], [x, 7, z], P.glass)
  }
  /*
   * THE ANGELIKA, the cinema in the old cable powerhouse: its door near the
   * Mercer end, and its name on a lit canopy over the sidewalk. The name is
   * a business's, which is what a sign is for. Read from the street, facing
   * -z, so it is mirrored (the reader's right is -x).
   */
  const z = CB.z1
  s.clear([43, 0, z], [44, 2, z])
  const word = 'ANGELIKA'
  const ww = wordWidth(word)
  const wx = 52 - ww + 1
  s.box([wx - 1, 4, z + 1], [52 + 1, 4, z + 2], P.dark)     // the canopy
  s.box([wx - 1, 5, z + 2], [52 + 1, 10, z + 2], 'red_concrete')
  s.pattern({
    at: [wx, 5, z + 2], plane: 'xy',
    legend: { '#': P.lamp },
    rows: wordRows(word, ANGELIKA_MIRROR),
  })
  for (let x = wx; x <= 52; x += 4) s.set(x, 3, z + 2, P.lamp)
}

/** The Angelika's name is on an `xy` face read from +z: mirrored. Decoded
 *  from the reader's side by test/99-chapters-4-6.spec.js. */
export const ANGELIKA_MIRROR = true

/** Mercer Street (+x) and the north party wall: brick, plain windows, and
 *  on the north face the larger attic windows the sources mention. */
function backAndNorth(s) {
  const { x0, x1, z0, z1 } = CB
  for (let k = 3; k <= 8; k++) {
    const y = storeyBase(k)
    for (let z = z0 + 3; z <= z1 - 4; z += 4) s.box([x1, y, z], [x1, y + 2, z + 1], P.glass)
    for (let x = x0 + 4; x <= x1 - 3; x += 5) s.box([x, y, z0], [x + 1, y + 2, z0], P.glass)
  }
  for (let x = x0 + 4; x <= x1 - 3; x += 5) s.box([x, storeyBase(9), z0], [x + 1, storeyBase(9) + 1, z0], P.glass)
  // A freight door on Mercer, and the limestone base round the back too.
  s.clear([x1, 0, 13], [x1, 2, 15])
}

/** The copper cornice with its lions' faces, on Broadway and Houston, and a
 *  plainer coping on the other two sides. */
function cornice(s) {
  const { x0, x1, z0, z1 } = CB
  for (let z = z0; z <= z1; z++) {
    if (!inPlan(x0, z) && !inPlan(x0 + 1, z)) continue
    s.set(x0 - 1, ROOF, z, z % 3 === 0 ? C.lion : C.copper)
    s.set(x0 - 2, ROOF + 1, z, C.copper)
    s.set(x0 - 1, ROOF + 1, z, C.copper)
  }
  for (let x = x0; x <= x1; x++) {
    if (!inPlan(x, z1) && !inPlan(x, z1 - 1)) continue
    s.set(x, ROOF, z1 + 1, x % 3 === 0 ? C.lion : C.copper)
    s.set(x, ROOF + 1, z1 + 2, C.copper)
    s.set(x, ROOF + 1, z1 + 1, C.copper)
  }
  // Round the chamfers: the cornice follows the cut.
  for (const [x, z] of [[14, 33], [15, 34], [55, 33], [54, 34]]) s.set(x, ROOF + 1, z, C.copper)
  // The roof's own parapet, one course.
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    if (!inPlan(x, z)) continue
    const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => !inPlan(x + dx, z + dz))
    if (edge) s.set(x, ROOF + 1, z, C.copper)
  }
}

/*
 * THE STAIR: a ten-step straight run out of the lobby to storey 3 (the
 * arcade is two storeys tall), then a switchback of four-block storeys all
 * the way to the roof.
 */
const STAIR = { a: 33, b: 34, z0: 20 }

function cableStair(s) {
  for (let i = 0; i < 10; i++) s.set(STAIR.a, i, 10 + i, P.floor)
  s.clear([STAIR.a, BASE_TOP, 10], [STAIR.a, BASE_TOP, 18])
  s.box([STAIR.a - 1, storeyBase(3), 10], [STAIR.a - 1, storeyBase(3), 18], P.dark)
  switchback(s, STAIR, 7, STOREY, P.floor, { rail: P.dark, light: P.ceiling }, storeyBase(3))
}

/** Lamps in every ceiling, every five blocks, skipping the stair lanes. */
function lights(s) {
  const { x0, x1, z0, z1 } = CB
  const slabs = [BASE_TOP]
  for (let k = 3; k <= 9; k++) slabs.push(storeyBase(k) + STOREY - 1)
  for (const y of slabs) {
    for (let x = x0 + 3; x < x1 - 1; x += 5) {
      for (let z = z0 + 3; z < z1 - 1; z += 5) {
        if (x >= 32 && x <= 35) continue
        if (y === ROOF) continue
        s.set(x, y, z, P.ceiling)
      }
    }
  }
}

/* THE GROUND FLOOR: the lobby off Broadway, and the Angelika's cinema. */
function lobbyAndCinema(s) {
  // The wall between them, with a door through it.
  s.box([36, 0, CB.z0 + 1], [36, BASE_TOP - 1, CB.z1 - 1], C.limestone)
  s.clear([36, 0, 20], [36, 2, 21])
  // Lobby: a marble floor, a desk, a bench.
  s.rect([15, 9], [35, 33], -1, 'polished_diorite')
  s.box([20, 0, 26], [24, 0, 26], 'smooth_quartz')
  s.box([18, 0, 12], [21, 0, 12], 'spruce_planks')
  // THE CINEMA: a screen on the north wall, rows of red seats facing it,
  // dim lights. The real Angelika is underground, in the powerhouse; the
  // world's floor is three blocks down, so its auditorium is here.
  s.box([39, 1, CB.z0 + 1], [52, 7, CB.z0 + 1], 'white_concrete')
  for (let z = 14; z <= 30; z += 2) {
    s.box([39, 0, z], [52, 0, z], 'red_wool')
  }
  for (let z = 14; z <= 30; z += 2) s.set(45, 0, z, 'air')   // the aisle
  s.rect([37, 9], [54, 33], -1, 'red_terracotta')
}

/* THE NO LOGO FLOORS, storeys 3 to 6. Each takes the storey's standing y. */

function sampleRoom(s, y) {
  const stock = ['red_wool', 'yellow_wool', 'light_blue_wool', 'lime_wool', 'orange_wool',
    'white_wool', 'pink_wool', 'cyan_wool', 'purple_wool', 'brown_wool']
  for (const z of [CB.z0 + 1, CB.z1 - 2]) {
    for (let x = 16; x <= 30; x++) {
      s.set(x, y, z, 'spruce_planks')
      s.set(x, y + 1, z, stock[(x * 3 + z) % stock.length])
      s.set(x, y + 2, z, stock[(x * 7 + z) % stock.length])
    }
  }
  // The QC benches, with a few things on them.
  s.box([20, y, 18], [27, y, 18], 'smooth_quartz')
  s.box([20, y, 23], [27, y, 23], 'smooth_quartz')
  s.set(21, y + 1, 18, 'red_wool')
  s.set(25, y + 1, 23, 'light_blue_wool')
}

function employeeTwo(s, y) {
  // Two desks side by side at the Broadway windows.
  for (const z of [24, 27]) {
    s.box([16, y, z], [16, y, z + 1], 'birch_planks')
    s.set(16, y + 1, z, 'black_concrete')
    s.set(17, y, z, 'polished_blackstone')
  }
  /* THE FIFTY: a ten by ten checkerboard of white tiles in the floorboards,
   * fifty of them -- countable, which a wall of white was not. */
  let n = 0
  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 10; j++) if ((i + j) % 2 === 0) { s.set(20 + i, y - 1, 12 + j, 'white_wool'); n++ }
  }
  if (n !== 50) throw new Error(`[ch4] the floor holds ${n} envelopes, not 50`)
  s.box([40, y, 12], [44, y, 12], 'white_concrete')            // a whiteboard,
  s.box([40, y + 1, 12], [44, y + 1, 12], 'white_concrete')    // low, three tall
  s.box([41, y + 1, 12], [43, y + 1, 12], 'light_blue_concrete')
  s.box([40, y, 28], [42, y, 29], 'gray_wool')                 // a sofa
  s.set(46, y, 30, 'moss_block'); s.set(46, y + 1, 30, 'oak_leaves')
}

function growthFloor(s, y) {
  // Three pods: creative, paid media, partner outreach.
  for (const z of [13, 20, 27]) {
    s.box([20, y, z - 1], [23, y, z + 1], 'birch_planks')
    s.box([21, y + 1, z], [22, y + 1, z], 'black_concrete')
    s.set(19, y, z - 1, 'polished_blackstone')
    s.set(24, y, z, 'polished_blackstone')
  }
  // The screen with the first long-form video on it: a red play button.
  s.box([40, y, CB.z0 + 1], [48, y + 2, CB.z0 + 1], 'black_concrete')
  s.pattern({
    at: [42, y, CB.z0 + 1], plane: 'xy',
    legend: { R: 'red_concrete', W: 'white_concrete' },
    rows: ['RRRRR', 'RRWRR', 'RRRRR'],
  })
  // The CRM, three screens on a desk.
  s.box([44, y, 24], [46, y, 24], 'birch_planks')
  s.box([44, y + 1, 24], [46, y + 1, 24], 'black_concrete')
}

function operations(s, y) {
  /* THE CALL WITH SHENZHEN: twenty faces, two rows of ten, on the south
   * wall; the first two a different colour -- the two part-time employees
   * the office grew from. */
  const wz = CB.z1 - 1
  s.box([17, y, wz], [37, y + 2, wz], 'black_concrete')
  let tile = 0
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 10; c++, tile++) {
      const face = tile < 2 ? 'orange_terracotta' : r ? 'cyan_terracotta' : 'light_blue_terracotta'
      s.set(18 + c * 2, y + 2 - r, wz, face)
    }
  }
  if (tile !== 20) throw new Error(`[ch4] the call has ${tile} faces, not 20`)
  // The software: four screens on the north wall -- quoting, sampling,
  // production tracking, fulfillment.
  for (let i = 0; i < 4; i++) {
    const x = 40 + i * 4
    s.box([x, y + 1, CB.z0 + 1], [x + 1, y + 2, CB.z0 + 1], 'black_concrete')
    s.set(x, y + 2, CB.z0 + 1, 'light_blue_concrete')
    s.box([x, y, CB.z0 + 2], [x + 1, y, CB.z0 + 2], 'birch_planks')
  }
}

/*
 * THE ROOF. The run rate as a thing you can count from above: one gold block
 * for $100K and eighty (eight by ten) for $8M, lying on the roof deck behind
 * the cornice where only a climber sees them. No billboard -- the Cable
 * Building is a landmark, and a landmark's roof line is not a place to add
 * one.
 */
function roof(s) {
  const r = ROOF + 1
  s.set(20, r, 14, 'gold_block')
  s.box([24, r, 12], [31, r, 21], 'gold_block')
  s.set(20, r, 12, P.lamp)
  s.set(28, r, 25, P.lamp)
}

/** A New York water tower: a round-ish timber barrel on steel legs, with a
 *  conical cap. Six across, sitting on its own corner. */
function waterTower(t) {
  for (const [x, z] of [[0, 0], [5, 0], [0, 5], [5, 5]]) t.pillar(x, z, 0, 3, P.dark)
  t.rect([0, 0], [5, 5], 4, P.dark)
  for (let y = 5; y <= 10; y++) {
    for (let x = 0; x <= 5; x++) {
      for (let z = 0; z <= 5; z++) {
        const corner = (x === 0 || x === 5) && (z === 0 || z === 5)
        const edge = x === 0 || x === 5 || z === 0 || z === 5
        if (!corner && edge) t.set(x, y, z, y === 6 || y === 9 ? P.dark : 'spruce_planks')
      }
    }
  }
  t.rect([1, 1], [4, 4], 11, 'spruce_planks')
  t.rect([2, 2], [3, 3], 12, 'spruce_planks')
  t.set(2, 13, 2, P.dark)
}

/* ====================================================================== *
 * A BROWNSTONE on Houston, west of the Cable Building
 * ====================================================================== */

function brownstones(s) {
  brownstone(s.at(59, 0, 20, 'ch4/brownstone'), 1)
  waterTower(s.at(61, 21, 23, 'ch4/brownstone tower'))
}

/*
 * One brownstone: eleven wide, fourteen deep, four storeys with a raised
 * parlor floor, a stoop down to the sidewalk, and a cornice. Facade on its
 * +z face (the side street). Lit inside on every floor so the windows glow.
 * The middle one is furnished and its door is open.
 */
function brownstone(b, i) {
  const W = 10, D = 13, H = 20
  b.box([0, -1, 0], [W, H, D], P.brownstone)
  b.clear([1, 0, 1], [W - 1, H - 1, D - 1])
  // Floors: garden level at 0, parlor at 3 (raised), then 8 and 13.
  for (const y of [-1, 2, 7, 12]) b.rect([1, 1], [W - 1, D - 1], y, 'spruce_planks')
  b.rect([1, 1], [W - 1, D - 1], H - 1, 'spruce_planks')
  // Lamps let into every slab, so each floor lights the one below it.
  for (const y of [2, 7, 12, H - 1]) for (let x = 2; x <= W - 2; x += 4) b.set(x, y, 6, P.ceiling)
  // Windows on the facade, two per floor, tall, with a stone lintel.
  for (const y of [3, 8, 13]) {
    for (const x of [2, 6]) {
      b.box([x, y, D], [x + 1, y + 2, D], P.glass)
      b.box([x, y + 3, D], [x + 1, y + 3, D], P.brownTrim)
    }
  }
  // Garden-level windows.
  b.box([6, 0, D], [7, 1, D], P.glass)
  // The cornice: a heavy dark band, standing proud.
  b.box([-0, H, D + 1], [W, H, D + 1], P.cornice)
  b.box([0, H + 1, D], [W, H + 1, D], P.cornice)
  // The door at parlor level and the stoop down to the sidewalk.
  b.clear([2, 3, D], [3, 5, D])
  if (i !== 1) b.box([2, 3, D], [3, 5, D], 'dark_oak_planks')    // shut
  for (let k = 0; k < 3; k++) b.box([2, k, D + 1 + (2 - k)], [3, k, D + 1 + (2 - k)], P.brownTrim)
  b.box([2, 2, D + 1], [3, 2, D + 1], P.brownTrim)
  // Railings either side of the stoop.
  for (const x of [1, 4]) for (let k = 0; k < 3; k++) b.set(x, k + 1, D + 1 + (2 - k), P.dark)
  b.set(1, 4, D + 1, P.lamp)
  if (i === 1) {
    // Furnished: a sofa, a table, a bookshelf, a rug.
    b.rect([2, 3], [8, 10], 2, 'red_wool')
    b.box([2, 3, 3], [2, 3, 8], 'green_wool')
    b.box([5, 3, 5], [6, 3, 6], 'dark_oak_planks')
    b.box([9, 3, 2], [9, 5, 10], 'bookshelf')
  }
  // Interior stair from parlor to the top floors: a straight run of full
  // blocks along the back wall.
  for (let k = 0; k < 5; k++) b.set(1 + k, 3 + k, 1, 'spruce_planks')
  b.clear([1, 7, 1], [4, 7, 2])                 // headroom; the top step stays
  for (let k = 0; k < 5; k++) b.set(5 + k, 8 + k, 2, 'spruce_planks')
  b.clear([5, 12, 1], [8, 12, 3])
}

/* ====================================================================== *
 * THE LOADING DOCK behind the loft: freight, which is half of what No Logo
 * does, arriving as boxes.
 * ====================================================================== */

function loadingDock(s) {
  // A box truck at the Mercer Street freight door, behind the building.
  const t = s.at(58, 0, 10, 'ch4/truck')
  t.box([0, 0, 0], [8, 3, 3], 'white_concrete')               // the box
  t.box([0, 2, 0], [8, 2, 0], 'blue_concrete')                // a stripe
  t.box([0, 2, 3], [8, 2, 3], 'blue_concrete')
  t.box([9, 0, 0], [11, 2, 3], 'white_concrete')              // the cab
  t.box([11, 1, 0], [11, 2, 3], 'black_stained_glass')
  for (const x of [1, 7, 10]) { t.set(x, 0, -1, 'black_concrete'); t.set(x, 0, 4, 'black_concrete') }
  t.clear([0, 0, 1], [0, 3, 2])                               // the open back
  // Boxes on pallets by the door.
  for (const [x, z, h] of [[56, 6, 2], [56, 7, 1], [57, 6, 1], [56, 17, 3], [57, 17, 2], [56, 18, 1]]) {
    s.box([x, 0, z], [x, h - 1, z], 'packed_mud')
  }
  s.set(56, 3, 14, P.lamp)
}

/* ====================================================================== *
 * THE DELI on the corner
 * ====================================================================== */

function deli(s) {
  const x0 = 14, x1 = 24, z0 = 46, z1 = 61
  s.box([x0, -1, z0], [x1, 14, z1], 'red_terracotta')
  s.clear([x0 + 1, 0, z0 + 1], [x1 - 1, 3, z1 - 1])
  s.clear([x0 + 1, 5, z0 + 1], [x1 - 1, 12, z1 - 1])
  s.rect([x0 + 1, z0 + 1], [x1 - 1, z1 - 1], -1, 'white_concrete')
  s.rect([x0 + 1, z0 + 1], [x1 - 1, z1 - 1], 4, 'spruce_planks')
  // The shopfront: glass to the avenue with a door.
  s.box([x0, 0, z0 + 1], [x0, 2, z1 - 1], P.glass)
  s.clear([x0, 0, 52], [x0, 2, 53])
  // The sign band over it, and the word.
  const word = 'DELI'
  const ww = wordWidth(word)
  const wz = Math.round((z0 + z1) / 2 - ww / 2)
  s.box([x0 - 1, 4, z0], [x0 - 1, 10, z1], 'red_concrete')
  s.pattern({
    at: [x0 - 1, 5, wz], plane: 'zy',
    legend: { '#': 'yellow_concrete' },
    rows: wordRows(word, FACING_PATH_MIRROR),
  })
  // Its own light, or it photographs grey: lamps at each end of the band.
  s.set(x0 - 1, 7, z0, P.lamp)
  s.set(x0 - 1, 7, z1, P.lamp)
  // The green awning over the sidewalk.
  s.box([x0 - 2, 3, z0], [x0 - 2, 3, z1], 'green_wool')
  for (let z = z0 + 2; z <= z1 - 2; z += 4) s.set(x0 - 1, 3, z, P.lamp)
  // Upper-floor windows.
  for (let z = z0 + 2; z <= z1 - 3; z += 3) s.box([x0, 11, z], [x0, 12, z + 1], P.glass)
  // Inside: a counter, a cooler, shelves of colour, lights.
  s.box([x0 + 2, 0, z0 + 2], [x0 + 2, 0, z0 + 6], 'smooth_quartz')
  s.box([x1 - 1, 0, z0 + 2], [x1 - 1, 2, z1 - 2], 'white_concrete')
  s.box([x1 - 1, 0, z0 + 3], [x1 - 1, 2, z1 - 3], P.glass)
  for (let z = z0 + 3; z <= z1 - 3; z++) {
    s.set(x1 - 2, 0, z, 'iron_block')
  }
  for (let x = x0 + 4; x <= x1 - 4; x++) {
    for (const z of [z0 + 9, z0 + 12]) {
      s.set(x, 0, z, ['yellow_wool', 'red_wool', 'lime_wool', 'orange_wool'][x % 4])
      s.set(x, 1, z, ['white_wool', 'cyan_wool', 'pink_wool', 'brown_wool'][x % 4])
    }
  }
  for (let x = x0 + 3; x <= x1 - 2; x += 4) for (let z = z0 + 3; z <= z1 - 2; z += 5) s.set(x, 3, z, P.ceiling)
  for (let x = x0 + 3; x <= x1 - 2; x += 4) for (let z = z0 + 3; z <= z1 - 2; z += 5) s.set(x, 12, z, P.ceiling)
  s.rect([x0, z0], [x1, z1], 14, 'polished_andesite')
}

/* ====================================================================== *
 * THE SUBWAY
 * ====================================================================== */

/*
 * THE VERTICAL BUDGET DECIDES EVERYTHING: grass at y = -1, two of dirt, then
 * bedrock at -4 (docs/builds/README.md). So the platform's floor is the
 * bedrock course, re-laid in tile, and its ceiling is the street: exactly
 * two blocks of headroom, which a player fits in (1.8). The stair down is
 * three steps under an open sky, from the sidewalk to the platform.
 */
function subway(s) {
  const z0 = 47, z1 = 72
  // The station box: under the east sidewalk and the avenue.
  s.clear([5, -3, z0], [13, -2, z1])
  s.rect([5, z0], [13, z1], -4, 'smooth_stone')
  s.rect([8, z0], [8, z1], -4, 'yellow_concrete')          // the platform edge
  s.rect([5, z0], [7, z1], -4, 'cobbled_deepslate')          // the track bed
  // Tiled walls, white with a green band, and lights let into them.
  s.box([4, -3, z0], [4, -2, z1], 'white_concrete')
  s.box([14, -3, z0], [14, -2, z1], 'white_concrete')
  s.box([5, -3, z0 - 1], [13, -2, z0 - 1], 'white_concrete')
  s.box([5, -3, z1 + 1], [13, -2, z1 + 1], 'white_concrete')
  for (let z = z0 + 2; z <= z1 - 2; z += 5) {
    s.set(14, -2, z, P.lamp)
    s.set(4, -2, z, P.lamp)
    s.set(14, -3, z + 2, 'green_terracotta')
  }
  // Steel columns along the platform.
  for (let z = z0 + 3; z <= z1 - 3; z += 6) s.box([10, -3, z], [10, -2, z], 'black_concrete')
  // The train: two blocks tall, stainless, windows down the side.
  s.box([5, -3, z0 + 3], [6, -2, z1 - 3], 'iron_block')
  for (let z = z0 + 4; z <= z1 - 4; z += 3) { s.set(6, -2, z, P.glass); s.set(5, -2, z, P.glass) }
  for (let z = z0 + 8; z <= z1 - 8; z += 9) s.set(6, -3, z, 'black_concrete')   // doors

  // THE ENTRANCE: three steps down, open to the sky, on the east sidewalk.
  const sx0 = 12, sx1 = 13, sz = 64
  s.clear([sx0, -1, sz], [sx1, -1, sz + 2])
  s.clear([sx0, -2, sz + 1], [sx1, -2, sz + 2])
  s.clear([sx0, -3, sz + 2], [sx1, -3, sz + 2])
  s.box([sx0, -2, sz], [sx1, -2, sz], 'smooth_stone')       // step 1
  s.box([sx0, -3, sz + 1], [sx1, -3, sz + 1], 'smooth_stone') // step 2
  // Railings round the opening, and the two green globes.
  s.box([11, 0, sz], [11, 0, sz + 2], P.dark)
  s.box([sx0, 0, sz + 3], [sx1, 0, sz + 3], P.dark)
  for (const z of [sz - 1, sz + 3]) {
    s.pillar(11, z, 0, 1, P.dark)
    s.set(11, 2, z, 'verdant_froglight')
  }
}

/* ====================================================================== *
 * THE POCKET PARK between the deli and the Empire State
 * ====================================================================== */

function park(s) {
  const x0 = 26, x1 = 40, z0 = 47, z1 = 73
  s.rect([x0, z0], [x1, z1], -1, 'grass')
  s.rect([x0, 59], [x1, 61], -1, 'gravel')
  s.rect([32, z0], [34, z1], -1, 'gravel')
  for (const [x, z] of [[28, 50], [38, 51], [28, 67], [38, 69], [29, 56]]) tree(s, x, z)
  for (const [x, z] of [[30, 60], [36, 60]]) s.box([x, 0, z], [x + 1, 0, z], 'spruce_planks')
  for (const [x, z] of [[31, 49], [35, 71]]) { s.pillar(x, z, 0, 3, P.dark); s.set(x, 4, z, P.lamp) }
  /* THE EASTER EGG: a hot dog cart in the park, and under the cart, in the
   * dirt where nobody looks, the number 2 in gold. */
  s.box([36, 0, 55], [37, 0, 56], 'iron_block')
  s.pillar(36, 55, 1, 2, P.dark)
  s.box([35, 3, 54], [38, 3, 57], 'yellow_wool')
  s.box([36, 3, 55], [37, 3, 56], 'blue_wool')
  s.pattern({
    at: [36, -2, 54], plane: 'xz',
    legend: { '#': 'gold_block' },
    rows: wordRows('2').slice().reverse(),
  })
}

/* ====================================================================== *
 * THE EMPIRE STATE BUILDING
 * ====================================================================== */

/*
 * Five setbacks, the way the building is drawn in every child's picture of
 * it: a five-storey base filling the block, a broad shaft, a narrower one,
 * the tower, the stepped crown, the mast and the antenna. Limestone piers
 * with grey window strips between, a few windows lit at random. The crown
 * is lit at night.
 *
 * The lobby is walkable: a long art-deco hall off the avenue side, marble
 * walls, gold light, and on its back wall the building's own silhouette in
 * gold -- the famous lobby mural -- which is symmetric, so it has no wrong
 * way round.
 */
const ESB = { cx: 57, cz: 61 }
const TIERS = [
  { r: 10, y0: -1, y1: 15 },   // the base, 21 x 21
  { r: 7, y0: 16, y1: 34 },
  { r: 5, y0: 35, y1: 44 },
  { r: 4, y0: 45, y1: 50 },
  { r: 3, y0: 51, y1: 53 },
  { r: 2, y0: 54, y1: 55 },
  { r: 1, y0: 56, y1: 59 },
]

/** Deterministic, so the lit windows are the same on every boot. The `>>> 0`
 *  is load-bearing: without it the XOR goes negative half the time, a
 *  negative remainder is always under 7, and the first screenshot showed a
 *  building with every other window on. */
const lit = (a, b, c) => (((a * 73856093) ^ (b * 19349663) ^ (c * 83492791)) >>> 0) % 100 < 7

function empireState(s) {
  const { cx, cz } = ESB
  for (const t of TIERS) {
    const x0 = cx - t.r, x1 = cx + t.r, z0 = cz - t.r, z1 = cz + t.r
    s.box([x0, t.y0, z0], [x1, t.y1, z1], P.limestone)
    if (t.r < 3) continue
    // The facade rhythm on all four faces: piers on even columns, window
    // strips on odd ones, a spandrel every third row.
    for (let y = Math.max(0, t.y0); y < t.y1; y++) {
      for (let u = x0 + 1; u < x1; u++) {
        if ((u - x0) % 2 === 0) continue
        for (const z of [z0, z1]) s.set(u, y, z, windowKey(u, y, z))
      }
      for (let u = z0 + 1; u < z1; u++) {
        if ((u - z0) % 2 === 0) continue
        for (const x of [x0, x1]) s.set(x, y, u, windowKey(x, y, u))
      }
    }
    // The setback's own coping.
    s.rect([x0, z0], [x1, z1], t.y1, 'smooth_stone')
  }
  // THE CROWN, lit: sea lanterns on all four faces of the top three tiers.
  for (const t of TIERS.slice(3, 6)) {
    for (let k = -t.r; k <= t.r; k += 2) {
      s.set(cx + k, t.y1, cz - t.r, P.lamp)
      s.set(cx + k, t.y1, cz + t.r, P.lamp)
      s.set(cx - t.r, t.y1, cz + k, P.lamp)
      s.set(cx + t.r, t.y1, cz + k, P.lamp)
    }
  }
  s.pillar(cx, cz, 60, 63, 'iron_block')                 // the antenna
  s.set(cx, 63, cz, 'redstone_block')                    // its warning light

  lobby(s)
}

function windowKey(a, y, b) {
  if (y % 3 === 2) return P.spandrel
  return lit(a, y, b) ? P.ceiling : P.window
}

function lobby(s) {
  const { cx, cz } = ESB
  const x0 = cx - 10, x1 = cx + 2, z0 = cz - 4, z1 = cz + 4
  s.clear([x0 + 1, 0, z0], [x1, 6, z1])
  s.rect([x0 + 1, z0], [x1, z1], -1, 'polished_diorite')
  s.rect([x0 + 1, cz], [x1, cz], -1, 'gold_block')                // the runner
  s.box([x0 + 1, 0, z0 - 1], [x1, 6, z0 - 1], 'polished_granite')
  s.box([x0 + 1, 0, z1 + 1], [x1, 6, z1 + 1], 'polished_granite')
  s.rect([x0 + 1, z0], [x1, z1], 7, 'smooth_quartz')
  for (let x = x0 + 2; x <= x1; x += 3) { s.set(x, 7, z0 + 1, 'glowstone'); s.set(x, 7, z1 - 1, 'glowstone') }
  for (let x = x0 + 3; x <= x1; x += 4) { s.set(x, 3, z0, 'shroomlight'); s.set(x, 3, z1, 'shroomlight') }
  // The entrance: a tall door in the avenue-side face, under a gold canopy.
  s.clear([x0, 0, cz - 2], [x0, 4, cz + 2])
  s.box([x0 - 1, 5, cz - 3], [x0 - 1, 5, cz + 3], 'gold_block')
  s.set(x0 - 1, 6, cz, P.lamp)
  // THE MURAL on the back wall: the building in gold on dark stone.
  const mx = x1 + 1
  s.box([mx, 0, z0], [mx, 6, z1], P.dark)
  s.pattern({
    at: [mx, 0, z0 + 1], plane: 'zy',
    legend: { G: 'gold_block' },
    rows: [
      '...G...',
      '...G...',
      '..GGG..',
      '..GGG..',
      '.GGGGG.',
      '.GGGGG.',
      'GGGGGGG',
    ],
  })
  s.set(x0 + 2, 0, z0, 'smooth_quartz')
  s.set(x0 + 2, 1, z0, 'smooth_quartz')
  wallSign(s, x0 + 2, 1, z0 + 1, 'south', ['Empire State', 'Building', '', ''])
}

/* ====================================================================== *
 * STREET FURNITURE: cabs, lamps, a steam stack, a hydrant
 * ====================================================================== */

function streetFurniture(s) {
  // YELLOW CABS on the avenue, in the lanes, nose to the south (+z).
  for (const [x, z] of [[4, 12], [7, 22], [4, 50], [9, 30], [7, 58], [9, 66]]) cab(s, x, z)
  cab(s, 50, 39, true)

  // Cobra-head street lamps on both avenue sidewalks and along the side
  // street: a pole and an arm out over the road with the lamp under it.
  /* Posts on the building side skip the deli's awning and the subway
   * stair; posts on the side street skip the brownstones' stoop rails. */
  for (const z of [9, 19, 29, 70]) {
    s.pillar(12, z, 0, 5, P.dark)
    s.set(11, 5, z, P.dark)
    s.set(11, 4, z, P.lamp)
  }
  for (const z of [14, 24, 32, 50, 60, 70]) {
    s.pillar(2, z, 0, 5, P.dark)
    s.set(3, 5, z, P.dark)
    s.set(3, 4, z, P.lamp)
  }
  for (const x of [18, 57, 70]) {
    s.pillar(x, 36, 0, 5, P.dark); s.set(x, 5, 37, P.dark); s.set(x, 4, 37, P.lamp)
  }
  for (const x of [28, 44, 60, 71]) {
    s.pillar(x, 44, 0, 5, P.dark); s.set(x, 5, 43, P.dark); s.set(x, 4, 43, P.lamp)
  }
  // THE STEAM STACK: orange and white, in the middle of the avenue.
  for (let y = 0; y <= 3; y++) s.set(7, y, 31, y % 2 ? 'white_concrete' : 'orange_concrete')
  s.set(7, 4, 31, 'white_wool')
  // A hydrant on the corner.
  s.set(12, 0, 46, 'red_concrete')
  // A street tree on the building-side sidewalk, south of the subway.
  tree(s, 12, 72)
}

/** A yellow cab, five long, nose toward +z (or +x if `across`). */
function cab(s, x, z, across = false) {
  const put = (a, y, b, k) => across ? s.set(x + b, y, z + a, k) : s.set(x + a, y, z + b, k)
  for (let a = 0; a <= 1; a++) {
    for (let b = 0; b <= 4; b++) put(a, 0, b, 'yellow_concrete')
    for (let b = 1; b <= 3; b++) put(a, 1, b, b === 2 ? 'yellow_concrete' : 'black_stained_glass')
  }
  put(0, 2, 2, 'yellow_concrete')
  put(1, 2, 2, 'yellow_concrete')
  put(0, 3, 2, P.lamp)           // the roof light
}
