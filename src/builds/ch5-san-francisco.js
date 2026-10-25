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
 * WHERE: One Post Street (the owner). The company has one
 * floor partway up a rebuild of that tower -- see ONE POST STREET below
 * for its sources and for what had to be stylized to fit the build height.
 * WHAT IS NOT KNOWN, and therefore not drawn: the office's layout, the
 * company's colours or logo, anyone who works there. The floor holds what
 * the resume says the company does, as things in a room.
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
 * And ONE POST STREET on the corner nearest the arrival, so it is the first
 * building you meet: dark granite, sixty blocks, one lit floor.
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
import { CHAPTERS, LAND_W, LAND_D } from './plots.js'
import { SPINE, sampleSpine } from './spine.js'
import { wordRows } from './lettering.js'
import { wallSign, switchback, tree } from './kit.js'

/*
 * SIGNS, BY THE OWNER'S RULE: only names a real place would put up --
 * Patronus AI, at its own reception on the office floor. The role, the date and the
 * mission are AI Evan's to say, not the walls'.
 */
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

const CAL = { z0: 37, z1: 41 }               // the cross street, with the cable car

export function build(s) {
  ground(s)
  onePost(s)
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
 * ONE POST STREET, where Patronus AI is, on the office floor
 * ====================================================================== */

/*
 * WHAT IS KNOWN ABOUT IT, and where from:
 *   - Welton Becket & Associates, completed 1969, long the McKesson
 *     headquarters; a modernist office tower of 38 storeys (one source says
 *     37) and 529 feet, on the triangular flatiron site at Post and Market
 *     where the Crocker flatiron building stood.
 *   - "Dark granite strokes rising out of the ground and into the sky", with
 *     dark windows and lintels set slightly back, so the tower reads as all
 *     vertical lines.
 *   - At its foot a plaza with trees and granite steps people sit on, and an
 *     octagonal, two-tiered opening down to the Montgomery Street BART
 *     station, by SWA Group.
 *   Sources: Wikipedia, "McKesson Plaza"; SFYIMBY on One Post Street;
 *   buildingsdb.com. The plan's proportions were not found and are drawn.
 *
 * WHAT IS STYLIZED, and why. The build ceiling is 64 blocks over the
 * ground, so 529 feet comes out at 60 -- about nine feet a block, which is
 * half a storey too much to draw 38 storeys one block each. So:
 *   - the granite piers run unbroken from the plinth to the crown, which is
 *     the building's whole character, and the set-back lintels are drawn
 *     every three blocks, two storeys to a band -- you read the rhythm, you
 *     cannot count storeys, and from the street you cannot on the real one
 *     either;
 *   - the OFFICE FLOOR is the one storey drawn at walking height: four blocks
 *     of lit glass at y 20..23, with storeys under it at a block
 *     and a half each and more over it. It is the only lit band in
 *     the shaft, so from the path the visitor can see which floor is
 *     Patronus's before they go in;
 *   - the plan is stretched to about 20 by 26 so that floor holds the world
 *     model, the desks and the racks, where the real floor is about 12,000
 *     square feet.
 *   Below the office floor the tower is solid except its stair core; above it,
 *   solid. Nobody can be in an unlit room that was never furnished.
 */
const OPS = { x0: 43, x1: 62, z0: 7, z1: 32 }
const FL_OFFICE = 20                           // standing height of the office floor
const OPS_TOP = 59                        // the roof slab
const STAIR = { a: 45, b: 46, z0: 10 }    // the core, from the lobby up

const G = {
  granite: 'polished_deepslate',          // the dark granite piers
  lintel: 'deepslate_tiles',              // set back, a shade apart
  window: 'gray_concrete',                // dark, opaque from outside
  glass: 'gray_stained_glass',            // the office floor's lit band
  plaza: 'polished_granite',
  step: 'polished_granite',
}

function onePost(s) {
  const { x0, x1, z0, z1 } = OPS
  // The shaft, solid, from the plinth to the roof.
  s.box([x0, -1, z0], [x1, OPS_TOP, z1], G.window)
  // THE GRANITE STROKES: every other column on all four faces, standing one
  // block proud of the windows, unbroken from the ground to the crown.
  for (let y = 0; y <= OPS_TOP; y++) {
    for (let x = x0; x <= x1; x += 2) { s.set(x, y, z0 - 1, G.granite); s.set(x, y, z1 + 1, G.granite) }
    for (let z = z0; z <= z1; z += 2) { s.set(x0 - 1, y, z, G.granite); s.set(x1 + 1, y, z, G.granite) }
  }
  // Corner piers, so the shaft has hard edges.
  for (const [x, z] of [[x0 - 1, z0 - 1], [x1 + 1, z0 - 1], [x0 - 1, z1 + 1], [x1 + 1, z1 + 1]]) s.box([x, 0, z], [x, OPS_TOP, z], G.granite)
  // The set-back lintels: a band every three blocks in the window planes.
  for (let y = 7; y <= OPS_TOP; y += 3) {
    if (y >= FL_OFFICE - 1 && y <= FL_OFFICE + 4) continue
    for (let x = x0; x <= x1; x++) { s.set(x, y, z0, G.lintel); s.set(x, y, z1, G.lintel) }
    for (let z = z0; z <= z1; z++) { s.set(x0, y, z, G.lintel); s.set(x1, y, z, G.lintel) }
  }
  // THE CROWN: the piers stop at a flat parapet; a dark mechanical
  // penthouse sits back on the roof, and red lights at its corners.
  s.box([x0 - 1, OPS_TOP + 1, z0 - 1], [x1 + 1, OPS_TOP + 1, z1 + 1], G.granite)
  s.box([x0 + 4, OPS_TOP + 2, z0 + 5], [x1 - 4, OPS_TOP + 3, z1 - 5], G.lintel)
  for (const [x, z] of [[x0 + 4, z0 + 5], [x1 - 4, z1 - 5]]) s.set(x, OPS_TOP + 4, z, 'redstone_block')

  lobbyFloor(s)
  officeFloor(s)
  core(s)                                 // after: it cuts its hole in that floor
  plaza(s)
}

/* THE LOBBY: a tall glass ground storey under the granite, entered from the
 * plaza on the path side. */
function lobbyFloor(s) {
  const { x0, x1, z0, z1 } = OPS
  s.clear([x0 + 1, 0, z0 + 1], [x1 - 1, 5, z1 - 1])
  s.rect([x0 + 1, z0 + 1], [x1 - 1, z1 - 1], -1, G.plaza)
  s.rect([x0 + 1, z0 + 1], [x1 - 1, z1 - 1], 6, G.lintel)
  // Glass between the piers on the plaza face, and doors in the middle.
  for (let z = z0 + 1; z <= z1 - 1; z++) if ((z - z0) % 2 === 1) s.box([x1, 0, z], [x1, 5, z], G.glass)
  s.clear([x1 - 0, 0, 18], [x1 + 1, 2, 21])
  for (let x = x0 + 3; x <= x1 - 2; x += 4) for (let z = z0 + 3; z <= z1 - 2; z += 5) s.set(x, 6, z, P.ceiling)
  // A desk, and granite benches.
  s.box([x1 - 6, 0, 16], [x1 - 6, 0, 23], G.plaza)
  for (const z of [10, 28]) s.box([x1 - 3, 0, z], [x1 - 2, 0, z + 1], G.lintel)
}

/* THE CORE: a lit stair shaft from the lobby to the office floor -- five runs
 * of four, which is where the office floor's height comes from. */
function core(s) {
  const { a, b, z0 } = STAIR
  s.box([a - 1, 0, z0 - 1], [b + 1, FL_OFFICE - 1, z0 + 4], G.lintel)
  s.clear([a, 0, z0], [b, FL_OFFICE - 1, z0 + 3])
  switchback(s, STAIR, 5, 4, G.plaza, { light: P.ceiling })
  // Light in the shaft walls at every landing.
  for (let y = 2; y < FL_OFFICE; y += 4) { s.set(a - 1, y, z0 + 2, P.ceiling); s.set(b + 1, y, z0 + 1, P.ceiling) }
  // The way in, from the lobby, on the shaft's +x side at its foot.
  s.clear([b + 1, 0, z0], [b + 1, 2, z0])
  // And its top opens onto the office floor.
  s.clear([a - 1, FL_OFFICE, z0 - 1], [b + 1, FL_OFFICE + 2, z0 + 4])
}

/*
 * THE OFFICE FLOOR: Patronus AI. Its name at the top of the stair, which is
 * where a tenant puts it; the world model in the middle of the floor; desks
 * along the glass; racks at the back. The facts live in what the room is.
 */
function officeFloor(s) {
  const { x0, x1, z0, z1 } = OPS
  const y = FL_OFFICE
  s.clear([x0, y, z0], [x1, y + 3, z1])
  s.rect([x0, z0], [x1, z1], y - 1, P.floor)
  s.rect([x0, z0], [x1, z1], y + 4, P.slab)
  // The lit glass band all the way round.
  for (let dy = 0; dy <= 3; dy++) {
    for (let x = x0; x <= x1; x++) { s.set(x, y + dy, z0, G.glass); s.set(x, y + dy, z1, G.glass) }
    for (let z = z0; z <= z1; z++) { s.set(x0, y + dy, z, G.glass); s.set(x1, y + dy, z, G.glass) }
  }
  for (let x = x0 + 2; x <= x1 - 1; x += 4) for (let z = z0 + 2; z <= z1 - 1; z += 4) s.set(x, y + 4, z, P.ceiling)
  // The reception wall facing the top of the stair, with the business's
  // name: a tenant's name where a tenant puts it.
  s.box([49, y, 9], [49, y + 2, 13], 'black_concrete')
  wallSign(s, 48, y + 1, 11, 'east', ['Patronus AI', '', '', ''])
  worldModel(s, y)
  // Desks along the north glass.
  for (const x of [52, 56, 60]) {
    s.box([x - 1, y, 9], [x + 1, y, 9], P.floor)
    s.set(x, y + 1, 9, 'black_concrete')
    s.set(x, y, 10, P.dark)
  }
  // Simulation: two rows of racks down the west side, status lights lit.
  for (const rx of [44, 45]) {
    s.box([rx, y, 17], [rx, y + 2, z1 - 2], 'black_concrete')
    for (let z = 17; z <= z1 - 2; z += 2) s.set(rx, y + 1, z, P.lamp)
  }
}

/*
 * THE WORLD MODEL: a model of this whole map on a table, 1 block to 31 --
 * grass, the path in gravel from the same spine the landscape draws, the six
 * chapters raised in their own colours, a gold block where you are. Derived
 * from src/builds/plots.js and spine.js, so it moves when the map does.
 */
function worldModel(s, y) {
  /* The map is 288 x 400 (not square) since the landscape pass: the scale is
   * chosen so its longer side still fits the 13-cell table. */
  const scale = Math.ceil(Math.max(LAND_W, LAND_D) / 13)  // 31
  const nx = Math.ceil(LAND_W / scale), nz = Math.ceil(LAND_D / scale)  // 10 x 13
  const tx0 = 48, tz0 = 17
  const tx1 = tx0 + nx - 1, tz1 = tz0 + nz - 1
  s.box([tx0 - 1, y, tz0 - 1], [tx1 + 1, y, tz1 + 1], P.dark)
  s.rect([tx0, tz0], [tx1, tz1], y, 'moss_block')
  const cell = (px, pz) => [tx0 + Math.floor(px / scale), tz0 + Math.floor(pz / scale)]
  const inside = (x, z) => x >= tx0 && x <= tx1 && z >= tz0 && z <= tz1
  for (const p of sampleSpine(SPINE, 2)) {
    const [x, z] = cell(p.x, p.z)
    if (inside(x, z)) s.set(x, y, z, 'gravel')
  }
  const colours = ['lapis_block', 'red_nether_bricks', 'pink_concrete', 'yellow_concrete', 'orange_concrete', 'white_concrete']
  CHAPTERS.forEach((c, i) => {
    const [ax, az] = cell(c.x0, c.z0), [bx, bz] = cell(c.x1, c.z1)
    for (let x = ax; x <= bx; x++) for (let z = az; z <= bz; z++) {
      if (inside(x, z)) s.set(x, y + 1, z, colours[i % colours.length])
    }
  })
  const here = CHAPTERS.find(c => c.id === 'ch5')
  const [hx, hz] = cell((here.x0 + here.x1) / 2, (here.z0 + here.z1) / 2)
  if (inside(hx, hz)) s.set(hx, y + 2, hz, 'gold_block')
}

/*
 * THE PLAZA on the flatiron tip, between the tower and the path: granite
 * paving, granite steps to sit on, trees round the edge, and the octagonal
 * two-tiered opening down toward BART -- two tiers is exactly the depth the
 * world has (docs/builds/README.md), so the second tier is the bottom.
 */
function plaza(s) {
  s.rect([63, 5], [72, 35], -1, G.plaza)
  // The flatiron's diagonal: Market Street's edge, in a darker band.
  for (let x = 63; x <= 72; x++) s.set(x, -1, Math.round(35 - (x - 63) * 0.5), G.lintel)
  const cx = 68, cz = 20
  for (let x = cx - 5; x <= cx + 5; x++) {
    for (let z = cz - 5; z <= cz + 5; z++) {
      const d = Math.max(Math.abs(x - cx), Math.abs(z - cz), (Math.abs(x - cx) + Math.abs(z - cz)) * 0.72)
      if (d > 4.6) continue
      if (d > 3.2) { s.clear([x, -1, z], [x, -1, z]); s.set(x, -2, z, G.step) }
      else { s.clear([x, -2, z], [x, -1, z]); s.set(x, -3, z, G.plaza) }
    }
  }
  // The portal into the station on the pit's back wall, lit.
  s.box([cx - 1, -3, cz - 4], [cx + 1, -2, cz - 4], 'air')
  s.box([cx - 1, -3, cz - 5], [cx + 1, -2, cz - 5], P.dark)
  s.set(cx, -2, cz - 3, P.lamp)
  s.set(cx - 2, -3, cz + 2, P.lamp)
  // Trees round the plaza, and granite seating steps round the opening.
  for (const z of [8, 31]) tree(s, 69, z)
  for (const z of [11, 28]) tree(s, 66, z)
  for (const z of [6, 34]) { s.pillar(66, z, 0, 3, P.dark); s.set(66, 4, z, P.lamp) }
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
  /*
   * THE GABLE: a tall triangle rising off the facade to a point, two rows to
   * a step, with the roof sloping back from it. The first version had a
   * gable three rows high under a continuous white cornice, and from the
   * park the row read as a classical colonnade -- the point of a Victorian
   * is the point.
   */
  for (let j = 0; j < 6; j++) {
    const k = Math.floor(j / 2), y = H + 1 + j
    h.box([D, y, k], [D, y, W - k], body)
    h.set(D, y, k, 'white_concrete')                                       // trim up the rakes
    h.set(D, y, W - k, 'white_concrete')
    h.box([0, y, k], [D - 1, y, k], 'dark_oak_planks')                     // the roof slopes
    h.box([0, y, W - k], [D - 1, y, W - k], 'dark_oak_planks')
    if (W - k - 1 >= k + 1) h.box([0, y, k + 1], [D - 1, y, W - k - 1], 'air')
  }
  h.box([0, H + 6, 2], [D, H + 6, 3], 'dark_oak_planks')                    // ridge
  h.box([D, H + 2, 2], [D, H + 3, 3], 'glass')                              // the gable window
  // Trim: a white band at the floor lines and one white corner per house,
  // so neighbours do not share a double-width white column.
  h.box([D, 6, 0], [D, 6, W], 'white_concrete')
  h.box([D, 0, 0], [D, H, 0], 'white_concrete')
  h.box([D, H, 0], [D + 1, H, W], 'white_concrete')                         // cornice
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
  const top = 59                  // taller than One Post Street, as it is
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
    for (let y = 36; y <= top - 4; y++) {
      const r = Math.max(0, Math.round(6 - (y * 6) / (top - 4)))
      s.box([cx, y, cz + dz * r], [cx, y, cz + dz * (r + 1)], 'white_concrete')
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
