/*
 * CHAPTER 5: SAN FRANCISCO, PATRONUS AI. The current job, in the city it is
 * in.
 *
 * ------------------------------------------------------------------------
 * THE FACTS, from the resume and nowhere else:
 *
 *   Patronus AI, San Francisco, September 2026 - present. Member of
 *   Technical Staff, Growth. "Patronus AI is a frontier lab developing
 *   simulation research and infrastructure to accelerate progress toward
 *   human-aligned AGI. We are training the First Digital World Model for AI
 *   agent training and simulation. Our mission is to simulate all of the
 *   world's intelligence."
 *
 * WHAT IS NOT KNOWN, and therefore not drawn: the office's address or what
 * it looks like, the company's colours, its logo, anyone who works there.
 * The building is a generic SoMa glass office with the name on its roof
 * line, and every floor inside is one sentence of the resume made into a
 * room. No person, product name or number appears that the resume does not
 * print.
 *
 * ------------------------------------------------------------------------
 * THE CITY, in the postcard order a visitor on the path sees it, near to far:
 *
 *   - ALAMO SQUARE: a grassy rise with cypresses, on the path side, and
 *     across the street from it
 *   - THE PAINTED LADIES: five Victorians in a row, pastel, steep gables,
 *     bay windows, stoops -- the view from the park, which is the view;
 *   - THE TRANSAMERICA PYRAMID rising behind them, exactly as it does in
 *     the real photograph from that park;
 *   - A CABLE CAR on the cross street;
 *   - COIT TOWER on its hill, behind the office;
 *   - THE GOLDEN GATE BRIDGE across the far end of the plot, international
 *     orange, over a bay of real water, its towers the tallest thing you
 *     see from the path.
 *
 * And PATRONUS AI on the corner nearest the arrival, so it is the first
 * building you meet.
 *
 * ------------------------------------------------------------------------
 * ORIENTATION. ch5 is a LEFT plot: the path is on the HIGH-x side and the
 * spur arrives at local (73, 6). Everything faces +x.
 *
 * MIRRORING. A word on a wall facing +x is a `zy` pattern read by somebody
 * looking -x, and facing -x in this left-handed engine puts +z on the
 * viewer's RIGHT -- so the characters run the way `pattern` lays them, and
 * the rows go in UNMIRRORED. That is the opposite of chapter 4's walls (and
 * of ch1's gym), which face the other way. Decoded from the world, from the
 * reader's side, by test/99-chapters-4-6.spec.js.
 *
 * The north rows (z 0..4) from x 21 to the path are the chapter marker's.
 */
import { CHAPTERS, LAND_SIZE } from './plots.js'
import { SPINE, sampleSpine } from './spine.js'
import { wordRows, wordWidth } from './lettering.js'
import { wallSign, switchback, tree } from './kit.js'

export const SIZE = { w: 74, d: 76 }

/** Words on walls that face +x (read from the path) are NOT mirrored. */
export const FACING_PATH_MIRROR = false

const P = {
  asphalt: 'gray_concrete',
  sidewalk: 'smooth_stone',
  curb: 'polished_andesite',
  glass: 'light_blue_stained_glass',
  mullion: 'white_concrete',
  slab: 'smooth_quartz',
  dark: 'polished_blackstone',
  lamp: 'sea_lantern',
  ceiling: 'glowstone',
  floor: 'birch_planks',
  orange: 'orange_concrete',          // international orange
  trim: 'white_concrete',
}

/* THE HQ. Four floors of five, then a roof terrace. */
const HQ = { x0: 42, x1: 66, z0: 5, z1: 35 }
const FLOOR_H = 5
const ROOF = 4 * FLOOR_H - 1                 // y = 19
const CAL = { z0: 37, z1: 41 }               // the cross street, with the cable car

export function build(s) {
  ground(s)
  headquarters(s)
  californiaStreet(s)
  paintedLadies(s)
  alamoSquare(s)
  transamerica(s)
  coitTower(s)
  goldenGate(s)
  egg(s)
}

/* ====================================================================== *
 * THE GROUND: the plaza, the streets and the sidewalks
 * ====================================================================== */

function ground(s) {
  // Pave the city half; the bay half stays grass on its headlands.
  s.rect([25, 5], [72, 74], -1, P.sidewalk)
  // Steiner Street, in front of the Ladies.
  s.rect([58, 42], [62, 74], -1, P.asphalt)
  // California Street, along x, the cable car's.
  s.rect([25, CAL.z0], [72, CAL.z1], -1, P.asphalt)
  for (let x = 25; x <= 72; x++) {
    s.set(x, -1, 38, P.dark)                  // the rails and the cable slot
    s.set(x, -1, 40, P.dark)
  }
  for (let x = 25; x <= 72; x += 2) s.set(x, -1, 39, 'iron_block')
  // Curbs.
  s.rect([25, CAL.z0 - 1], [72, CAL.z0 - 1], -1, P.curb)
  s.rect([25, CAL.z1 + 1], [57, CAL.z1 + 1], -1, P.curb)
  s.rect([57, 42], [57, 74], -1, P.curb)
  s.rect([63, 42], [63, 74], -1, P.curb)
  // The arrival from the spur at (73, 6) onto the plaza.
  s.rect([73, 5], [73, 7], -1, P.sidewalk)
}

/* ====================================================================== *
 * PATRONUS AI
 * ====================================================================== */

/*
 * FOUR FLOORS, EACH ONE A SENTENCE.
 *
 *   1  THE LOBBY        who and what: the name, the role, the date, and the
 *                       mission on the wall behind the desk.
 *   2  THE WORLD MODEL  "training the First Digital World Model" -- so the
 *                       room holds a model of a world, and the world it is a
 *                       model of is THIS one: the whole map, the path and all
 *                       six chapters, read from src/builds/plots.js and
 *                       src/builds/spine.js so it moves when they do. There
 *                       is a gold block in it where you are standing.
 *   3  SIMULATION       "simulation research and infrastructure": rows of
 *                       racks with their status lights, in a cold aisle.
 *   4  GROWTH           the team this role is on: desks and a whiteboard.
 *   ROOF                a terrace that looks at the bridge.
 */
function headquarters(s) {
  const { x0, x1, z0, z1 } = HQ
  s.box([x0, -1, z0], [x1, ROOF, z1], P.mullion)
  s.clear([x0 + 1, 0, z0 + 1], [x1 - 1, ROOF - 1, z1 - 1])
  for (let f = 0; f < 4; f++) {
    s.rect([x0 + 1, z0 + 1], [x1 - 1, z1 - 1], f * FLOOR_H - 1, f === 0 ? 'polished_diorite' : P.floor)
  }
  s.rect([x0 + 1, z0 + 1], [x1 - 1, z1 - 1], ROOF, P.slab)
  curtainWall(s)
  switchback(s, { a: 44, b: 45, z0: 27 }, 4, FLOOR_H, P.slab, { rail: P.dark, light: P.ceiling })
  for (let f = 0; f < 4; f++) {
    const y = f * FLOOR_H + FLOOR_H - 1
    for (let x = x0 + 4; x <= x1 - 2; x += 5) {
      for (let z = z0 + 3; z <= z1 - 2; z += 5) s.set(x, y, z, P.ceiling)
    }
  }
  lobby(s)
  worldModel(s)
  simulation(s)
  growth(s)
  terrace(s)
}

/*
 * THE CURTAIN WALL: glass floor to ceiling on all four faces, white mullions
 * every third block and a white band at every slab -- a SoMa office, which
 * is a building type and not anybody's building.
 */
function curtainWall(s) {
  const { x0, x1, z0, z1 } = HQ
  for (let f = 0; f < 4; f++) {
    const y = f * FLOOR_H
    for (let z = z0 + 1; z < z1; z++) {
      if ((z - z0) % 3 === 0) continue
      for (const x of [x0, x1]) s.box([x, y, z], [x, y + 3, z], P.glass)
    }
    for (let x = x0 + 1; x < x1; x++) {
      if ((x - x0) % 3 === 0) continue
      for (const z of [z0, z1]) s.box([x, y, z], [x, y + 3, z], P.glass)
    }
  }
  // THE DOOR: a glass-walled entrance in the middle of the path face.
  s.clear([x1, 0, 19], [x1, 2, 21])
  s.box([x1 + 1, 4, 17], [x1 + 3, 4, 23], P.slab)          // the canopy
  for (const z of [18, 20, 22]) s.set(x1 + 2, 3, z, P.lamp)

  /*
   * THE NAME on the parapet: "PATRONUS" is 31 blocks, the front is 31
   * (z 5..35), which is why the building is exactly that long. Lit letters
   * on black, the same treatment the No Logo loft has across the river --
   * two employers, one sign shop. Read from +x, so NOT mirrored.
   */
  const word = 'PATRONUS'
  if (wordWidth(word) !== z1 - z0 + 1) throw new Error(`[ch5] ${word} does not fit the front`)
  s.box([x1, ROOF + 1, z0], [x1, ROOF + 7, z1], 'black_concrete')
  s.pattern({
    at: [x1, ROOF + 2, z0], plane: 'zy',
    legend: { '#': P.lamp },
    rows: wordRows(word, FACING_PATH_MIRROR),
  })
  s.box([x1, ROOF + 8, z0], [x1 + 1, ROOF + 8, z1], P.trim)
}

/* FLOOR 1: THE LOBBY. */
function lobby(s) {
  const { x0, x1 } = HQ
  // The reception desk, facing the door.
  s.box([x1 - 8, 0, 16], [x1 - 8, 0, 24], P.slab)
  s.box([x1 - 9, 0, 16], [x1 - 9, 1, 16], P.slab)
  s.box([x1 - 9, 0, 24], [x1 - 9, 1, 24], P.slab)
  // The wall behind it, in dark stone, with the role and the mission.
  s.box([x1 - 12, 0, 13], [x1 - 12, 3, 27], P.dark)
  wallSign(s, x1 - 11, 2, 18, 'west', ['Patronus AI', 'San Francisco', '', ''])
  wallSign(s, x1 - 11, 2, 20, 'west', ['Member of', 'Technical Staff,', 'Growth', 'Sept 2026-now'])
  wallSign(s, x1 - 11, 2, 22, 'west', ['"Our mission is', 'to simulate all', 'of the world\'s', 'intelligence."'])
  for (const z of [15, 25]) s.set(x1 - 11, 3, z, P.lamp)
  // A lounge by the windows: low seats and planters.
  for (const z of [8, 12, 28, 32]) {
    s.box([x1 - 3, 0, z], [x1 - 2, 0, z + 1], 'light_gray_wool')
    s.set(x1 - 1, 0, z, 'moss_block')
  }
  // The way up is at the back, past the wall.
  wallSign(s, x0 + 1, 1, 24, 'west', ['Stairs up:', 'the world model,', 'simulation,', 'growth, roof'])
}

/*
 * FLOOR 2: THE WORLD MODEL. A model of the map, at 1 block to 12, on a
 * table in the middle of the floor: grass, the path in gravel, the six
 * chapters as raised blocks in their own colours, and a gold block for
 * "you are here". Derived from the plot table and the spine, never typed, so
 * whatever the landscape pass does to the layout, the model follows it.
 */
function worldModel(s) {
  const y = FLOOR_H
  const scale = 15
  const n = Math.ceil(LAND_SIZE / scale)                   // 18 across
  const tx0 = 47, tz0 = 8                                    // the table's corner
  const tx1 = tx0 + n - 1, tz1 = tz0 + n - 1
  // The table: a dark frame with the land on it.
  s.box([tx0 - 1, y, tz0 - 1], [tx1 + 1, y, tz1 + 1], P.dark)
  s.rect([tx0, tz0], [tx1, tz1], y, 'moss_block')
  const cell = (px, pz) => [tx0 + Math.floor(px / scale), tz0 + Math.floor(pz / scale)]
  // The path, from the same spine the landscape draws.
  for (const p of sampleSpine(SPINE, 2)) {
    const [x, z] = cell(p.x, p.z)
    if (x >= tx0 && x <= tx1 && z >= tz0 && z <= tz1) s.set(x, y, z, 'gravel')
  }
  // The six chapters, raised, each a colour of its own.
  const colours = ['lapis_block', 'red_nether_bricks', 'pink_concrete', 'yellow_concrete', 'orange_concrete', 'white_concrete']
  CHAPTERS.forEach((c, i) => {
    const [ax, az] = cell(c.x0, c.z0), [bx, bz] = cell(c.x1, c.z1)
    const h = c.id === 'ch6' ? 3 : c.id === 'ch4' ? 2 : 1
    for (let x = ax; x <= bx; x++) {
      for (let z = az; z <= bz; z++) {
        if (x < tx0 || x > tx1 || z < tz0 || z > tz1) continue
        s.box([x, y + 1, z], [x, y + h, z], colours[i % colours.length])
      }
    }
  })
  // You are here.
  const here = CHAPTERS.find(c => c.id === 'ch5')
  const [hx, hz] = cell((here.x0 + here.x1) / 2, (here.z0 + here.z1) / 2)
  if (hx >= tx0 && hx <= tx1 && hz >= tz0 && hz <= tz1) s.set(hx, y + 2, hz, 'gold_block')
  // Light over the table, and the sign.
  for (let x = tx0 + 2; x <= tx1; x += 5) for (let z = tz0 + 2; z <= tz1; z += 5) s.set(x, y + FLOOR_H - 1, z, P.ceiling)
  s.set(56, y + 1, tz1 + 1, P.dark)
  wallSign(s, 56, y + 1, tz1 + 2, 'south', ['A model of the', 'world you are', 'standing in.', 'Gold: you.'])
  s.box([HQ.x0 + 1, y, 16], [HQ.x0 + 1, y + 3, 20], 'black_concrete')
  wallSign(s, HQ.x0 + 2, y + 1, 18, 'west', ['Training the', 'First Digital', 'World Model', ''])
  // Screens round the walls, as if the model were being watched.
  for (const z of [10, 14, 24, 28]) s.box([HQ.x0 + 1, y + 1, z], [HQ.x0 + 1, y + 2, z + 1], 'light_blue_concrete')
}

/* FLOOR 3: SIMULATION. Racks in rows, status lights, a cold aisle. */
function simulation(s) {
  const y = 2 * FLOOR_H
  for (let row = 0; row < 4; row++) {
    const x = 49 + row * 4
    s.box([x, y, 8], [x, y + 2, 24], 'black_concrete')
    for (let z = 8; z <= 24; z++) {
      if ((z + row) % 3 === 0) s.set(x, y + 1, z, P.lamp)
      if ((z + row) % 4 === 1) s.set(x, y + 2, z, 'light_blue_concrete')
    }
  }
  // Every aisle is its own room as far as light is concerned.
  for (let row = 0; row < 4; row++) {
    for (let z = 10; z <= 24; z += 5) s.set(51 + row * 4, y + FLOOR_H - 1, z, P.ceiling)
  }
  wallSign(s, 47, y + 1, 30, 'north', ['Simulation', 'research and', 'infrastructure', ''])
  s.set(47, y + 1, 31, P.dark)
}

/* FLOOR 4: GROWTH. */
function growth(s) {
  const y = 3 * FLOOR_H
  for (const [x, z] of [[52, 9], [52, 14], [58, 9], [58, 14], [52, 22], [58, 22]]) {
    s.box([x, y, z], [x + 2, y, z + 1], P.floor)
    s.set(x + 1, y + 1, z, 'black_concrete')
    s.set(x + 1, y, z + 2, P.dark)
  }
  s.box([HQ.x0 + 1, y, 10], [HQ.x0 + 1, y + 2, 22], P.trim)
  wallSign(s, HQ.x0 + 2, y + 1, 16, 'west', ['Growth', 'Member of', 'Technical Staff', 'Sept 2026-now'])
}

/* THE ROOF TERRACE, looking west at the bridge. */
function terrace(s) {
  const { x0, x1, z0, z1 } = HQ
  const r = ROOF + 1
  s.box([x0, r, z0], [x1 - 1, r, z0], P.glass)
  s.box([x0, r, z1], [x1 - 1, r, z1], P.glass)
  s.box([x0, r, z0], [x0, r, z1], P.glass)
  for (const [x, z] of [[50, 10], [56, 10], [50, 30], [56, 30]]) {
    s.set(x, r, z, 'moss_block')
    s.set(x, r + 1, z, 'oak_leaves')
  }
  for (const z of [16, 20, 24]) s.box([46, r, z], [47, r, z], 'light_gray_wool')
  for (const [x, z] of [[44, 8], [44, 32], [60, 8], [60, 32]]) { s.pillar(x, z, r, r + 1, P.dark); s.set(x, r + 2, z, P.lamp) }
}

/* ====================================================================== *
 * CALIFORNIA STREET AND ITS CABLE CAR
 * ====================================================================== */

/*
 * A cable car mid-block, maroon below and cream above, open at both ends,
 * with a lamp at each end and a bench down each side you can sit on. Twelve
 * long and three wide, on the rails, crossing the visitor's view between the
 * office and the Ladies.
 */
function californiaStreet(s) {
  const c = s.at(46, 0, 38, 'ch5/cable car')
  const L = 11
  c.box([0, 0, 0], [L, 0, 2], 'spruce_planks')                // the floor
  c.box([2, 1, 0], [L - 2, 1, 0], 'red_terracotta')            // lower panels
  c.box([2, 1, 2], [L - 2, 1, 2], 'red_terracotta')
  c.box([2, 2, 0], [L - 2, 2, 0], 'glass')                     // windows
  c.box([2, 2, 2], [L - 2, 2, 2], 'glass')
  for (const x of [2, 5, 8, L - 2]) { c.set(x, 2, 0, 'white_terracotta'); c.set(x, 2, 2, 'white_terracotta') }
  c.box([0, 3, 0], [L, 3, 2], 'white_terracotta')             // the roof
  c.box([1, 4, 1], [L - 1, 4, 1], 'red_terracotta')
  for (const x of [0, L]) for (const z of [0, 2]) c.pillar(x, z, 1, 2, P.dark)   // end posts
  c.set(0, 2, 1, P.lamp)
  c.set(L, 2, 1, P.lamp)
  // Street lamps along California Street.
  for (const x of [28, 40, 70]) { s.pillar(x, 36, 0, 4, P.dark); s.set(x, 5, 36, P.lamp) }
  for (const x of [34, 64]) { s.pillar(x, 42, 0, 4, P.dark); s.set(x, 5, 42, P.lamp) }
}

/* ====================================================================== *
 * THE PAINTED LADIES
 * ====================================================================== */

/*
 * Five Victorians on Steiner Street, six blocks wide each, facades facing the
 * path across the street and the park. Each: a raised front door up a stoop,
 * a two-storey bay window, a steep front gable to a point, white trim, and
 * its own pastel body. Lit inside on every floor. The middle one's door is
 * open and its parlor is furnished.
 */
const LADIES = [
  { body: 'light_blue_concrete', accent: 'blue_terracotta' },
  { body: 'pink_concrete', accent: 'magenta_terracotta' },
  { body: 'yellow_concrete', accent: 'orange_terracotta' },
  { body: 'lime_concrete', accent: 'green_terracotta' },
  { body: 'light_gray_concrete', accent: 'cyan_terracotta' },
]

function paintedLadies(s) {
  LADIES.forEach((l, i) => lady(s.at(43, 0, 44 + i * 6, `ch5/lady ${i + 1}`), l, i === 2))
}

function lady(h, { body, accent }, open) {
  const D = 11, W = 5, H = 12                    // x 0..11 deep, z 0..5 wide
  h.box([0, -1, 0], [D, H, W], body)
  h.clear([1, 0, 1], [D - 1, H - 1, W - 1])
  for (const y of [-1, 2, 7]) h.rect([1, 1], [D - 1, W - 1], y, 'planks')
  h.rect([1, 1], [D - 1, W - 1], H - 1, 'planks')
  for (const y of [2, 7, H - 1]) h.set(5, y, 2, 'glowstone')
  for (const y of [2, 7, H - 1]) h.set(5, y, 4, 'glowstone')
  // The facade at x = D: the gable rising to a point over the full width.
  for (let k = 0; k <= 2; k++) {
    h.box([D, H + 1 + k, k], [D, H + 1 + k, W - k], body)
    h.box([0, H + 1 + k, k], [D, H + 1 + k, k], 'dark_oak_planks')          // roof slopes
    h.box([0, H + 1 + k, W - k], [D, H + 1 + k, W - k], 'dark_oak_planks')
    if (k < 2) h.box([0, H + 1 + k, k + 1], [D - 1, H + 1 + k, W - k - 1], 'air')
  }
  h.box([0, H + 4, 2], [D + 1, H + 4, 3], 'dark_oak_planks')                  // ridge
  h.set(D, H + 2, 2, 'glass'); h.set(D, H + 2, 3, 'glass')                    // the gable window
  // Trim: white bands at the floor lines, white edges up the corners.
  for (const y of [H, 6]) h.box([D, y, 0], [D, y, W], 'white_concrete')
  h.box([D, 0, 0], [D, H, 0], 'white_concrete')
  h.box([D, 0, W], [D, H, W], 'white_concrete')
  h.box([D, H + 1, 0], [D + 1, H + 1, W], 'white_concrete')                   // cornice
  // THE BAY WINDOW: two storeys, one block proud, on the right half.
  h.box([D + 1, 2, 2], [D + 1, 10, 4], accent)
  h.box([D + 1, 3, 3], [D + 1, 5, 4], 'glass')
  h.box([D + 1, 8, 3], [D + 1, 9, 4], 'glass')
  h.box([D + 1, 11, 2], [D + 1, 11, 4], 'white_concrete')
  // Open the facade behind the bay, so the bay is part of the room.
  h.clear([D, 3, 3], [D, 5, 4])
  h.clear([D, 8, 3], [D, 9, 4])
  // Upper window on the left half.
  h.box([D, 8, 1], [D, 9, 1], 'glass')
  // THE DOOR at parlor level (floor y = 2), and the stoop down to the walk.
  h.box([D, 3, 1], [D, 5, 1], open ? 'air' : 'dark_oak_planks')
  h.set(D, 6, 1, accent)
  for (let k = 0; k < 3; k++) h.set(D + 1 + (2 - k), k, 1, 'white_concrete')
  h.set(D + 1, 2, 1, 'white_concrete')
  h.set(D + 1, 4, 0, 'sea_lantern')
  if (open) {
    h.rect([2, 1], [9, 4], 2, 'red_wool')
    h.box([2, 3, 1], [2, 3, 4], 'cyan_wool')
    h.box([5, 3, 2], [6, 3, 3], 'dark_oak_planks')
    h.box([1, 3, 4], [1, 5, 4], 'bookshelf')
  }
}

/* ====================================================================== *
 * ALAMO SQUARE, across the street, where the postcard is taken from
 * ====================================================================== */

function alamoSquare(s) {
  const x0 = 64, x1 = 72, z0 = 43, z1 = 74
  s.rect([x0, z0], [x1, z1], -1, 'grass')
  // A gentle rise toward the path: the park is a hill in the real city, and
  // the view of the Ladies is from its slope.
  for (let x = x0; x <= x1; x++) {
    for (let z = z0 + 2; z <= z1 - 2; z++) {
      const rise = Math.min(2, Math.floor((x - x0) / 3))
      if (rise > 0) s.box([x, 0, z], [x, rise - 1, z], 'grass')
    }
  }
  // A gravel walk across it.
  for (let x = x0; x <= x1; x++) {
    const rise = Math.min(2, Math.floor((x - x0) / 3))
    s.set(x, rise - 1, 58, 'gravel')
  }
  // Cypresses: tall, dark, narrow.
  for (const z of [47, 53, 66, 70]) {
    const x = 68, base = Math.min(2, Math.floor((x - x0) / 3))
    s.pillar(x, z, base, base + 2, 'spruce_log')
    for (let y = base + 1; y <= base + 6; y++) {
      for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (dx === 0 && dz === 0 && y <= base + 2) continue
        if (y > base + 4 && (dx || dz)) continue
        s.set(x + dx, y, z + dz, 'dark_oak_leaves')
      }
    }
  }
  // Benches facing the Ladies, and lamps.
  for (const z of [50, 60, 67]) s.box([65, 0, z], [65, 0, z + 1], 'spruce_planks')
  for (const z of [45, 56, 72]) { s.pillar(64, z, 0, 3, P.dark); s.set(64, 4, z, P.lamp) }
}

/* ====================================================================== *
 * THE TRANSAMERICA PYRAMID, behind the Ladies
 * ====================================================================== */

function transamerica(s) {
  const cx = 33, cz = 58
  const top = 50
  for (let y = -1; y <= top; y++) {
    const r = Math.max(0, Math.round(6 - (Math.max(0, y) * 6) / (top - 4)))
    for (let x = cx - r; x <= cx + r; x++) {
      for (let z = cz - r; z <= cz + r; z++) {
        const face = x === cx - r || x === cx + r || z === cz - r || z === cz + r
        const win = face && y > 1 && y % 2 === 0 && (x + z) % 2 === 0
        s.set(x, y, z, win ? 'light_gray_concrete' : 'white_concrete')
      }
    }
  }
  // The two wings that carry the lifts and the stairs, on the flanks.
  for (const dz of [-1, 1]) {
    const z = cz + dz * 7
    for (let y = 30; y <= 44; y++) {
      const r = Math.max(0, Math.round(6 - (y * 6) / (top - 4)))
      s.box([cx - 1, y, cz + dz * r], [cx + 1, y, z], 'white_concrete')
    }
  }
  s.pillar(cx, cz, top + 1, top + 3, 'white_concrete')
  s.set(cx, top + 4, cz, P.lamp)                     // the beacon at the tip
  // The base: a dark plinth with a lit entrance facing the path.
  s.box([cx + 7, 0, cz - 3], [cx + 7, 3, cz + 3], P.dark)
  s.clear([cx + 6, 0, cz - 1], [cx + 7, 2, cz + 1])
  s.set(cx + 7, 4, cz, P.lamp)
}

/* ====================================================================== *
 * COIT TOWER on Telegraph Hill, behind the office
 * ====================================================================== */

function coitTower(s) {
  const cx = 32, cz = 20, R = 8
  for (let x = cx - R; x <= cx + R; x++) {
    for (let z = cz - R; z <= cz + R; z++) {
      const d = Math.hypot(x - cx, z - cz)
      if (d > R) continue
      const h = Math.round(4 * (1 - (d / R) ** 2))
      s.box([x, -1, z], [x, h - 1, z], 'grass')
    }
  }
  const base = 4, H = 22
  for (let y = base; y <= base + H; y++) {
    for (let x = cx - 2; x <= cx + 2; x++) {
      for (let z = cz - 2; z <= cz + 2; z++) {
        if (Math.abs(x - cx) === 2 && Math.abs(z - cz) === 2) continue
        const fluted = (Math.abs(x - cx) === 2 || Math.abs(z - cz) === 2) && (x + z) % 2 === 0
        const arch = y >= base + H - 4 && y <= base + H - 2 && (x === cx || z === cz)
        s.set(x, y, z, arch ? 'glass' : fluted ? 'smooth_quartz' : 'white_concrete')
      }
    }
  }
  s.rect([cx - 1, cz - 1], [cx + 1, cz + 1], base + H + 1, 'white_concrete')
  s.set(cx, base + H - 3, cz, P.ceiling)              // the lit lantern room
  s.set(cx, base + H + 2, cz, P.lamp)
}

/* ====================================================================== *
 * THE GOLDEN GATE BRIDGE, across the far end of the plot
 * ====================================================================== */

/*
 * The bay is real water, three deep, x 2..22 and z 14..62, held in on four
 * sides by the ground and two blocks clear of the plot edge. The bridge runs
 * along z over it, shore to shore: a road deck at y = 9, two towers rising
 * to y = 40 with their portal struts, the main cables swinging down between
 * them and out to the anchorages, and suspenders down to the deck. All in
 * international orange, which is the colour the whole world knows it by.
 * The deck is lit end to end at night.
 */
const BAY = { x0: 2, x1: 22, z0: 14, z1: 62 }
const DECK_Y = 9
const LEGS = [9, 14]                     // the two cable planes
const TOWERS = [22, 54]
const TOWER_TOP = 40

function goldenGate(s) {
  // The headlands either side, and the water between them.
  s.rect([0, 5], [24, 74], -1, 'grass')
  s.box([BAY.x0, -3, BAY.z0], [BAY.x1, -1, BAY.z1], 'water')
  s.rect([BAY.x0, BAY.z0 - 1], [BAY.x1, BAY.z0 - 1], -1, 'sand')
  s.rect([BAY.x0, BAY.z1 + 1], [BAY.x1, BAY.z1 + 1], -1, 'sand')

  // The deck: road, orange trusses either side, from anchorage to anchorage.
  const z0 = 5, z1 = 72
  s.box([LEGS[0], DECK_Y - 1, z0], [LEGS[1], DECK_Y - 1, z1], P.orange)
  s.box([LEGS[0] + 1, DECK_Y - 1, z0], [LEGS[1] - 1, DECK_Y - 1, z1], P.asphalt)
  for (const x of LEGS) s.box([x, DECK_Y, z0], [x, DECK_Y, z1], P.orange)       // rails
  for (let z = z0; z <= z1; z += 2) { s.set(LEGS[0], DECK_Y - 2, z, P.orange); s.set(LEGS[1], DECK_Y - 2, z, P.orange) }
  s.rect([LEGS[0] + 1, z0], [LEGS[1] - 1, z1], DECK_Y - 1, P.asphalt)
  for (let z = z0 + 1; z <= z1; z += 2) s.set(11, DECK_Y - 1, z, 'white_concrete')
  // Lamps along the rails.
  for (let z = z0 + 3; z <= z1; z += 6) for (const x of LEGS) s.set(x, DECK_Y + 1, z, P.lamp)

  // The anchorages and the approach piers on land.
  for (const [a, b] of [[z0, z0 + 4], [z1 - 4, z1]]) {
    s.box([LEGS[0] - 1, -1, a], [LEGS[1] + 1, DECK_Y - 2, b], 'smooth_stone')
  }
  for (const z of [10, 66]) s.box([LEGS[0], 0, z], [LEGS[1], DECK_Y - 2, z], P.orange)
  /* A WAY UP, so the bridge is walkable and not only a view: steps from the
   * headland up the side of the north anchorage, through a gap in the rail
   * and onto the deck. */
  for (let i = 0; i < 8; i++) s.box([7 - i, -1, 6], [7 - i, 7 - i, 7], 'smooth_stone')
  s.clear([LEGS[0], DECK_Y, 6], [LEGS[0], DECK_Y, 7])
  s.set(3, 5, 5, P.lamp)

  // THE TOWERS: two legs each, two by two, from the water to the top, with
  // portal struts across, stepping in as they rise, Art Deco fashion.
  for (const tz of TOWERS) {
    for (const lx of LEGS) {
      const xa = lx === LEGS[0] ? lx - 1 : lx, xb = xa + 1
      s.box([xa, -3, tz - 1], [xb, TOWER_TOP, tz + 1], P.orange)
      s.box([xa, -3, tz - 1], [xb, -1, tz + 1], P.orange)
    }
    for (const y of [DECK_Y + 6, DECK_Y + 14, DECK_Y + 22, TOWER_TOP]) {
      s.box([LEGS[0], y, tz], [LEGS[1], y + 1, tz], P.orange)
    }
    s.box([LEGS[0], DECK_Y - 2, tz - 1], [LEGS[1], DECK_Y - 2, tz + 1], P.orange)
    // Aircraft lights on the tower tops.
    s.set(LEGS[0] - 1, TOWER_TOP + 1, tz, 'redstone_block')
    s.set(LEGS[1] + 1, TOWER_TOP + 1, tz, 'redstone_block')
    s.set(LEGS[0], TOWER_TOP - 1, tz, P.lamp)
    s.set(LEGS[1], TOWER_TOP - 1, tz, P.lamp)
  }

  // THE MAIN CABLES: a parabola between the towers, and a straight run
  // down to each anchorage. Suspenders every fourth block.
  const [ta, tb] = TOWERS
  const mid = (ta + tb) / 2, sag = TOWER_TOP - (DECK_Y + 2)
  const cableY = (z) => {
    if (z < ta) return Math.round(DECK_Y + (TOWER_TOP - DECK_Y) * (z - z0) / (ta - z0))
    if (z > tb) return Math.round(DECK_Y + (TOWER_TOP - DECK_Y) * (z1 - z) / (z1 - tb))
    const t = (z - mid) / (tb - mid)
    return Math.round(DECK_Y + 2 + sag * t * t)
  }
  for (const x of LEGS) {
    let prev = null
    for (let z = z0; z <= z1; z++) {
      const y = cableY(z)
      const lo = prev === null ? y : Math.min(prev, y), hi = prev === null ? y : Math.max(prev, y)
      s.box([x, Math.max(lo, DECK_Y + 1), z], [x, Math.max(hi, DECK_Y + 1), z], P.orange)
      prev = y
      if (z % 4 === 0 && y > DECK_Y + 2 && !TOWERS.some(t => Math.abs(z - t) <= 1)) {
        s.box([x, DECK_Y + 1, z], [x, y, z], P.orange)
      }
    }
  }
}

/* ====================================================================== *
 * THE EASTER EGG: under Alamo Square
 * ====================================================================== */

/*
 * A cellar under the park with 2026 laid in its floor in glowstone -- the
 * year this chapter began. Two blocks of headroom on the bedrock, which is
 * all the world has (docs/builds/README.md), and the way in is a missing
 * block of turf at the foot of the slope with a crate under it to climb out
 * on, Omaha's trick.
 */
function egg(s) {
  const x0 = 65, x1 = 71, z0 = 46, z1 = 62
  s.clear([x0, -3, z0], [x1, -2, z1])
  s.rect([x0, z0], [x1, z1], -4, 'polished_blackstone')
  /* Read by somebody standing in the cellar facing the Ladies (-x): their
   * right is +z, so the digits run +z, and the TOP of the digits is the far
   * side, low x. Written cell by cell because `pattern`'s floor plane runs
   * its characters along x. */
  const rows = wordRows('2026')
  rows.forEach((row, r) => {
    ;[...row].forEach((ch, c) => { if (ch === '#') s.set(x0 + 1 + r, -4, z0 + 1 + c, 'glowstone') })
  })
  // The way in: one missing block of turf, and a crate under it.
  s.clear([x0, -1, z0], [x0, -1, z0])
  s.set(x0, -3, z0, 'planks')
}
