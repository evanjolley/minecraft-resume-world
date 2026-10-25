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
 * WHAT IS NOT KNOWN, and therefore not drawn: the address of the office, what
 * the building looked like, any client, any product, any face. The loft is a
 * generic SoHo cast-iron loft -- New York's most recognisable kind of
 * startup office -- and it is labelled as No Logo, not as a real building.
 * The Shenzhen office is a video call on a screen, because that is the only
 * way this chapter's New York ever saw it.
 *
 * ------------------------------------------------------------------------
 * THE SLICE OF NEW YORK, chosen so that each thing is recognisable from the
 * path in one look, and none of them needs a caption:
 *
 *   - an AVENUE along the path side with yellow cabs, white lane dashes,
 *     zebra crossings, and cobra-head street lamps;
 *   - a CAST-IRON LOFT with a water tower on the roof and a fire escape on
 *     its flank -- No Logo, four floors you can climb;
 *   - three BROWNSTONES with stoops on the side street;
 *   - a CORNER DELI with its sign over the awning;
 *   - a SUBWAY ENTRANCE with green globes, down to a platform and a train;
 *   - the EMPIRE STATE BUILDING, setbacks, mast and lit crown, at the back of
 *     the plot so it is the skyline behind everything else. At sixty-three
 *     blocks it is the tallest thing on the map's west side.
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

/* THE LOFT. Four floors of five blocks, then the roof. */
const LOFT = { x0: 14, x1: 37, z0: 8, z1: 34 }
const FLOOR_H = 5
const ROOF = 4 * FLOOR_H - 1            // the roof slab, y = 19

export function build(s) {
  streets(s)
  loft(s)
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

/* ====================================================================== *
 * NO LOGO: the cast-iron loft
 * ====================================================================== */

/*
 * FOUR FLOORS, AND EACH ONE IS A FACT.
 *
 *   1  THE SAMPLE ROOM  what the company does: shelves of samples, a QC
 *                       bench, a freight door at the back.
 *   2  EMPLOYEE #2      two desks by the window, and the wall of fifty
 *                       envelopes: fifty cold emails a day, which is how the
 *                       growth function started.
 *   3  GROWTH           three pods -- creative, paid media, partner
 *                       outreach -- and the screen with the first long-form
 *                       video on it.
 *   4  OPERATIONS       the four screens of the software (quoting, sampling,
 *                       production, fulfillment) and the call with Shenzhen:
 *                       a wall of twenty faces, two of them first.
 *   ROOF                the water tower, and the run rate on a billboard.
 *
 * A switchback stair in the back corner connects them all, so the climb is
 * one continuous walk from the street to the roof.
 */
function loft(s) {
  const { x0, x1, z0, z1 } = LOFT
  // The shell: brick sides and back, floors every five blocks, hollow inside.
  s.box([x0, -1, z0], [x1, ROOF, z1], P.loftSide)
  s.clear([x0 + 1, 0, z0 + 1], [x1 - 1, ROOF - 1, z1 - 1])
  for (let f = 0; f < 4; f++) {
    const y = f * FLOOR_H - 1
    s.rect([x0 + 1, z0 + 1], [x1 - 1, z1 - 1], y, f === 0 ? 'polished_andesite' : P.floor)
  }
  s.rect([x0 + 1, z0 + 1], [x1 - 1, z1 - 1], ROOF, P.dark)

  castIronFront(s)
  sideWindows(s)
  stairs(s)
  for (let f = 0; f < 4; f++) {
    const y = f * FLOOR_H
    // The ceiling grid. Light falls one level a block, so a lamp every five.
    for (let x = x0 + 3; x < x1 - 1; x += 5) {
      for (let z = z0 + 3; z < z1 - 1; z += 5) {
        if (x >= 33) continue                   // the stairwell
        s.set(x, y + FLOOR_H - 1, z, P.ceiling)
      }
    }
  }
  sampleRoom(s)
  employeeTwo(s)
  growthFloor(s)
  operations(s)
  roof(s)
  fireEscape(s)
}

/*
 * THE FRONT: a SoHo cast-iron facade, painted white, five bays of tall
 * windows between fluted columns, a cornice at every floor. The whole front
 * is ONE `zy` plane at x = x0 and every bay is derived from COLS.
 */
const COLS = [8, 13, 18, 23, 28, 34]

function castIronFront(s) {
  const { x0, z0, z1 } = LOFT
  s.box([x0, -1, z0], [x0, ROOF, z1], P.castIron)
  for (let f = 0; f < 4; f++) {
    const y = f * FLOOR_H
    // Tall windows in every bay. The ground floor is a shopfront: glass to
    // the floor. Upper floors: three-tall windows over a one-block sill.
    for (let b = 0; b < COLS.length - 1; b++) {
      const za = COLS[b] + 1, zb = COLS[b + 1] - 1
      if (f === 0) s.box([x0, 0, za], [x0, 3, zb], P.glass)
      else s.box([x0, y, za], [x0, y + 2, zb], P.glass)
    }
    // The cornice band at the floor line, standing proud by one.
    s.box([x0 - 1, y + FLOOR_H - 1, z0], [x0 - 1, y + FLOOR_H - 1, z1], P.castTrim)
  }
  // The columns, proud of the glass, full height.
  for (const z of COLS) s.box([x0 - 1, -1, z], [x0 - 1, ROOF, z], P.castTrim)

  /* THE DOOR, in the middle bay: two wide, three tall, with a step of
   * nothing -- the floor is at y = -1 like the sidewalk, per the README. */
  s.clear([x0 - 1, 0, 20], [x0, 2, 21])
  s.set(x0 - 1, 3, 20, P.lamp)
  s.set(x0 - 1, 3, 21, P.lamp)

  /*
   * THE PARAPET AND THE NAME. "NO LOGO" is 27 blocks in the block alphabet
   * and the frontage is 27 blocks (z 8..34), which is why the loft is
   * exactly this long. Letters in sea lantern on black, so the name is lit
   * at night with nothing in front of it, standing on the roof line where a
   * New York building has always put its name.
   */
  const word = 'NO LOGO'
  const ww = wordWidth(word)
  if (ww !== z1 - z0 + 1) throw new Error(`[ch4] ${word} is ${ww} wide; the loft front is ${z1 - z0 + 1}`)
  s.box([x0, ROOF + 1, z0], [x0, ROOF + 7, z1], 'black_concrete')
  s.pattern({
    at: [x0, ROOF + 2, z0], plane: 'zy',
    legend: { '#': P.lamp },
    rows: wordRows(word, FACING_PATH_MIRROR),
  })
  s.box([x0 - 1, ROOF + 8, z0], [x0, ROOF + 8, z1], P.castTrim)
}

/** Windows down the flanks, so the brick sides are not blind and the lit
 *  floors show from the side street and the arrival. */
function sideWindows(s) {
  const { x0, x1, z0, z1 } = LOFT
  for (let f = 0; f < 4; f++) {
    const y = f * FLOOR_H
    for (let x = x0 + 3; x <= x1 - 3; x += 4) {
      if (f === 0 && x > 30) continue
      for (const z of [z0, z1]) s.box([x, y, z], [x + 1, y + 2, z], P.glass)
    }
  }
}

/*
 * THE STAIR: a switchback in the back corner, two lanes wide. Each floor's
 * run is five single blocks rising one each, along z, in alternate lanes,
 * through a hole in the slab above. Full blocks, not stair keys: a staircase
 * you cannot climb is worse than a blocky one (docs/builds/README.md).
 */
const STAIR = { a: 34, b: 35, z0: 26, z1: 30 }

function stairs(s) {
  switchback(s, STAIR, 4, FLOOR_H, P.floor, { rail: P.dark, light: P.ceiling })
  // The roof hatch gets a little bulkhead so the stair arrives somewhere.
  s.box([STAIR.b + 1, ROOF + 1, STAIR.z0], [STAIR.b + 1, ROOF + 3, STAIR.z1], P.loftSide)
  s.box([STAIR.a, ROOF + 4, STAIR.z0], [STAIR.b + 1, ROOF + 4, STAIR.z1], P.dark)
}

/** A wall sign facing -x (readable from the front of the room), labelled. */
function sign(s, x, y, z, lines, facing = 'east') {
  wallSign(s, x, y, z, facing, lines)
}

/* FLOOR 1: THE SAMPLE ROOM. What the company does, as a room. */
function sampleRoom(s) {
  const { x0, z0, z1 } = LOFT
  // Shelving down both flanks, three high, stocked with "samples" -- plain
  // colours, because no client and no product is named.
  const stock = ['red_wool', 'yellow_wool', 'light_blue_wool', 'lime_wool', 'orange_wool',
    'white_wool', 'pink_wool', 'cyan_wool', 'purple_wool', 'brown_wool']
  for (const z of [z0 + 1, z1 - 1]) {
    for (let x = x0 + 3; x <= 30; x++) {
      s.set(x, 0, z, 'spruce_planks')
      s.set(x, 1, z, stock[(x * 3 + z) % stock.length])
      s.set(x, 2, z, 'spruce_planks')
      s.set(x, 3, z, stock[(x * 7 + z) % stock.length])
    }
  }
  // The QC bench: a long white table under a light, with a few items on it.
  s.box([x0 + 8, 0, 18], [x0 + 14, 0, 18], 'smooth_quartz')
  s.box([x0 + 8, 0, 23], [x0 + 14, 0, 23], 'smooth_quartz')
  s.set(x0 + 9, 1, 18, 'red_wool')
  s.set(x0 + 12, 1, 23, 'light_blue_wool')
  // Inside the door, on the column between two windows: who this is.
  sign(s, x0 + 1, 1, 18, ['No Logo', '', '', ''], 'west')
  // The pipeline, on signs at the near end of each bench.
  // The freight door at the back, onto the loading dock.
  s.clear([LOFT.x1, 0, 13], [LOFT.x1, 2, 15])
}

/* FLOOR 2: EMPLOYEE #2. */
function employeeTwo(s) {
  const { x0 } = LOFT
  const y = FLOOR_H
  // Two desks side by side at the window: #1 and #2. Desk, chair, monitor.
  for (const z of [24, 28]) {
    s.box([x0 + 3, y, z], [x0 + 3, y, z + 1], 'birch_planks')   // the desk
    s.set(x0 + 3, y + 1, z, 'black_concrete')                  // the monitor
    s.set(x0 + 4, y, z, 'polished_blackstone')                 // the chair
  }
  // On the south wall, beside the two desks.

  /*
   * THE FIFTY. Fifty white tiles let into the floorboards as a ten by ten
   * checkerboard in the middle of the room: the fifty cold emails a day the
   * growth function started with. A checkerboard rather than a wall because
   * fifty white blocks side by side photographed as one white wall, and a
   * number nobody can count is decoration.
   */
  const fx0 = x0 + 6, fz0 = 14
  let n = 0
  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 10; j++) {
      if ((i + j) % 2 === 0) { s.set(fx0 + i, y - 1, fz0 + j, 'white_wool'); n++ }
    }
  }
  if (n !== 50) throw new Error(`[ch4] the floor holds ${n} envelopes, not 50`)
  s.set(fx0 + 4, y, LOFT.z0, P.loftSide)
  // A sofa and a plant, because two desks in an empty loft is a warehouse.
  s.box([x0 + 12, y, 30], [x0 + 14, y, 31], 'gray_wool')
  s.set(x0 + 18, y, 31, 'moss_block'); s.set(x0 + 18, y + 1, 31, 'oak_leaves')
  // A whiteboard on the south wall.
  s.box([x0 + 9, y, LOFT.z1 - 1], [x0 + 16, y + 2, LOFT.z1 - 1], 'white_concrete')
  s.box([x0 + 10, y + 1, LOFT.z1 - 1], [x0 + 13, y + 1, LOFT.z1 - 1], 'light_blue_concrete')
}

/* FLOOR 3: GROWTH. Three pods and the screen. */
function growthFloor(s) {
  const { x0 } = LOFT
  const y = 2 * FLOOR_H
  // Three pods: creative, paid media, partner outreach.
  const pods = [12, 19, 26]
  for (const z of pods) {
    // A pod: four desks round a block, with monitors.
    s.box([x0 + 10, y, z - 1], [x0 + 13, y, z + 1], 'birch_planks')
    s.box([x0 + 11, y + 1, z], [x0 + 12, y + 1, z], 'black_concrete')
    s.set(x0 + 9, y, z - 1, 'polished_blackstone')
    s.set(x0 + 14, y, z, 'polished_blackstone')
  }
  /*
   * THE SCREEN: the first long-form video on the channel, 150K views in two
   * weeks. A big dark screen on the north wall with a red play button on it,
   * so it reads as a video from across the room.
   */
  const sz = LOFT.z0 + 1, sx = x0 + 4
  s.box([sx, y, sz], [sx + 8, y + 3, sz], 'black_concrete')
  s.pattern({
    at: [sx + 2, y + 1, sz], plane: 'xy',
    legend: { R: 'red_concrete', W: 'white_concrete' },
    rows: ['RRRRR', 'RRWRR', 'RRRRR'],
  })
  // The CRM, on a desk by the stair: three screens and a sign.
  s.box([30, y, 12], [32, y, 12], 'birch_planks')
  s.box([30, y + 1, 12], [32, y + 1, 12], 'black_concrete')
}

/* FLOOR 4: OPERATIONS, and the call with Shenzhen. */
function operations(s) {
  const { x0 } = LOFT
  const y = 3 * FLOOR_H
  /*
   * THE CALL. A wall of twenty faces, four rows of five, on the south wall:
   * the full-time Shenzhen office this chapter helped build. The first two
   * tiles are a different colour -- the two part-time employees it started
   * from. Each face is a tile with a lit pixel for a camera light.
   */
  const wz = LOFT.z1 - 1, wx0 = x0 + 4
  s.box([wx0 - 2, y, wz], [wx0 + 15, y + 3, wz], 'black_concrete')
  let tile = 0
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++, tile++) {
      // One block a face, a black gap between, and alternate rows a shade
      // apart so the four rows read as rows and not as five columns.
      const face = tile < 2 ? 'orange_terracotta' : r % 2 ? 'cyan_terracotta' : 'light_blue_terracotta'
      s.set(wx0 + c * 3, y + 3 - r, wz, face)
    }
  }
  if (tile !== 20) throw new Error(`[ch4] the call has ${tile} faces, not 20`)

  // The software, four screens on the north wall with what each one runs.
  // Four screens: quoting, sampling, production tracking, fulfillment.
  const steps = [0, 1, 2, 3]
  steps.forEach((i) => {
    const x = x0 + 4 + i * 4
    s.box([x, y + 1, LOFT.z0 + 1], [x + 1, y + 2, LOFT.z0 + 1], 'black_concrete')
    s.set(x, y + 2, LOFT.z0 + 1, 'light_blue_concrete')
    s.box([x, y, LOFT.z0 + 2], [x + 1, y, LOFT.z0 + 2], 'birch_planks')
  })
}

/*
 * THE ROOF. A wooden water tower -- the single most New York object there is
 * -- and a billboard with the run rate on it, facing the avenue.
 */
function roof(s) {
  const { x0, x1, z0, z1 } = LOFT
  const r = ROOF + 1
  // Parapet round the other three sides.
  s.box([x0, r, z0], [x1, r, z0], P.loftSide)
  s.box([x0, r, z1], [x1, r, z1], P.loftSide)
  s.box([x1, r, z0], [x1, r, z1], P.loftSide)
  waterTower(s.at(26, r, 12, 'ch4/water tower'))

  /*
   * THE RUN RATE, as a bar you can count. One gold block for $100K and
   * eighty for $8M, side by side, on a billboard frame on the roof facing
   * the avenue -- the ratio the resume gives, drawn at the ratio it gives.
   * Eighty is ten tall and eight wide.
   */
  /* ON LEGS, eight up, so the board clears the NO LOGO parapet in front of
   * it and the gold is seen from the avenue rather than only from the roof. */
  const bx = 22, b0 = r + 8
  for (const z of [17, 30]) s.pillar(bx, z, r, b0 - 1, P.dark)
  s.box([bx, b0, 16], [bx, b0 + 11, 31], P.dark)                      // the board
  s.set(bx - 1, b0 + 1, 18, 'gold_block')                             // $100K: one
  s.box([bx - 1, b0 + 1, 21], [bx - 1, b0 + 10, 28], 'gold_block')    // $8M: eighty
  for (const z of [16, 31]) { s.set(bx - 1, b0 + 11, z, P.lamp); s.set(bx - 1, b0, z, P.lamp) }
}

/** A New York water tower: a round-ish timber barrel on steel legs, with a
 *  conical cap. Six across, sitting on its own corner. */
function waterTower(t) {
  for (const [x, z] of [[0, 0], [5, 0], [0, 5], [5, 5]]) t.pillar(x, z, 0, 3, P.dark)
  t.rect([0, 0], [5, 5], 4, P.dark)
  // The barrel: a ring, rounded by cutting the corners.
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

/** The fire escape on the north flank, where the arrival sees it first. */
function fireEscape(s) {
  const z = LOFT.z0 - 1
  for (let f = 1; f < 4; f++) {
    const y = f * FLOOR_H - 1
    s.box([18, y, z], [27, y, z], 'polished_blackstone_brick_slab_top')
    // The rail: posts every other block, at y + 1.
    for (let x = 18; x <= 27; x += 3) s.set(x, y + 1, z - 0, P.dark)
    // The ladder-stair between landings, drawn as a diagonal of slabs.
    if (f < 3) for (let i = 0; i < 4; i++) s.set(f % 2 ? 22 + i : 26 - i, y + 1 + i, z, 'polished_blackstone_brick_slab_top')
  }
}

/* ====================================================================== *
 * THE BROWNSTONES on the side street
 * ====================================================================== */

function brownstones(s) {
  for (let i = 0; i < 3; i++) {
    brownstone(s.at(40 + i * 11, 0, 20, `ch4/brownstone ${i + 1}`), i)
  }
  waterTower(s.at(64, 21, 23, 'ch4/brownstone tower'))
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
  // A box truck backed up to the freight door.
  const t = s.at(39, 0, 11, 'ch4/truck')
  t.box([0, 0, 0], [8, 3, 3], 'white_concrete')               // the box
  t.box([0, 2, 0], [8, 2, 0], 'blue_concrete')                // a stripe
  t.box([0, 2, 3], [8, 2, 3], 'blue_concrete')
  t.box([9, 0, 0], [11, 2, 3], 'white_concrete')              // the cab
  t.box([11, 1, 0], [11, 2, 3], 'black_stained_glass')
  for (const x of [1, 7, 10]) { t.set(x, 0, -1, 'black_concrete'); t.set(x, 0, 4, 'black_concrete') }
  t.clear([0, 0, 1], [0, 3, 2])                               // the open back
  // Boxes on pallets by the door.
  for (const [x, z, h] of [[38, 6, 2], [38, 7, 1], [39, 6, 1], [38, 17, 3], [39, 17, 2], [38, 18, 1]]) {
    s.box([x, 0, z], [x, h - 1, z], 'packed_mud')
  }
  s.set(38, 3, 14, P.lamp)
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
  for (const x of [21, 33, 48, 59, 70]) {
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
