/*
 * CHAPTER 1: MILLARD NORTH HIGH SCHOOL, 1010 S. 144th St., Omaha.
 *
 * ------------------------------------------------------------------------
 * THE BRIEF, verbatim: "in the Omaha section (section 1), I want you to
 * attempt to build my high school: Millard North High School... Just dont
 * rebuild the parking lot. Anyway, feel free to change the size of the plot
 * if you need it to be bigger."
 *
 * So there is a drop-off loop and a plaza, which are architecture, and there
 * is not one parked car. And the plot grew: ch1 in src/builds/plots.js is now
 * 66 x 63 instead of 52 x 24, west and south, because east is the path and
 * north is spawn.
 * ------------------------------------------------------------------------
 * THE SCALE, which is the decision the whole build rests on.
 *
 * The real school is about 400,000 square feet and holds 2,534 students.
 * There is no ratio at which that is both buildable in a plot a visitor can
 * see the end of AND walkable inside, so this model does two things:
 *
 *   1. IT BUILDS THE FRONT, NOT THE SCHOOL. What is here is the entrance
 *      block and the two wings that flank it -- the ~420 feet of frontage
 *      that is in every photograph of the place -- at roughly 1 block = 6.5
 *      feet on plan. The real building sprawls several hundred feet further
 *      back and there are athletic fields beyond it; those are a line of
 *      stadium light poles on the south lawn and nothing else.
 *   2. IT STRETCHES VERTICALLY. Elevation is about 1 block = 2.3 feet: a
 *      two-storey wing with a 30-foot parapet comes out 13 blocks tall, and
 *      each storey is four blocks of air, which is a corridor you can walk
 *      down rather than one you crawl through. That is a 2.8:1 anisotropy
 *      and it is deliberate -- the elevation is what makes the building
 *      recognisable, so the elevation gets the honest proportions and the
 *      plan takes the compression.
 *
 * SILHOUETTE FIDELITY OVER FLOOR AREA. Nobody will count classrooms. What
 * makes it Millard North is the entry pavilion, the canopy cantilevering over
 * the doors on two square columns, the two-storey glass wall, the red brick
 * piers, the tan precast wings over a brick base, and the long low horizontal
 * line of the whole thing. Those are what the block budget went on.
 * ------------------------------------------------------------------------
 * WHICH WAY IT FACES, and why it is not the way the real one faces.
 *
 * The real entrance faces east, at 144th Street. This one faces NORTH, and
 * the reason is the visitor: they walk south down the path, turn off at the
 * spur into the plot's north-east corner, and the first thing in front of
 * them has to be the front of the building. A facade facing the path instead
 * would be a `zy` wall seen edge-on from the arrival and would put the whole
 * composition in profile.
 *
 * It also settles the mirroring in one question instead of two. A north-
 * facing wall is an `xy` plane, the same plane as all seven chapter markers,
 * and src/builds/chapters.js records MIRROR = false as verified by
 * screenshot for exactly that plane. Every readable thing in this file is
 * either on a north-facing `xy` wall or flat on the ground in `xz`, and the
 * ground one is the only place a reversal could hide -- see PLAZA INLAY.
 *
 * Facing +z (walking south, looking at the facade), +x is the viewer's RIGHT.
 * Babylon is left-handed: right = up x forward. So reading the photographs
 * left to right -- west wing, glass colonnade, entry pavilion, east wing --
 * is reading this file's x from 1 to 64.
 * ------------------------------------------------------------------------
 * THE REFERENCES. Four photographs on the owner's desktop (a dusk three-
 * quarter of the entrance, an elevated wide shot of the whole massing, a
 * head-on of the entry, and a small thumbnail), plus the Wikipedia article
 * for the facts: opened 1978 for grades 9-10, a full high school in 1981,
 * expanded 2007, comprehensive renovation completed 2016 -- which is why the
 * photographs look modern and why this is the building he would have known.
 * Mascot the Mustangs, colours blue, silver and green, first Nebraska public
 * high school to offer the IB Diploma Programme, 42 state championships.
 *
 * Nothing factual is invented. The licence is in how a fact is drawn.
 */
import { textRows, textWidth } from './font.js'

/*
 * THE PALETTE, and it is a much shorter list than it wants to be.
 *
 * This game has 172 block types and no concrete, no wool and no sandstone --
 * so "tan precast panel", which is the single largest surface on the
 * building, has to come out of the stone list. `end_stone` is the one pale
 * warm block in it and it is a good match for the beige panels on both
 * wings. The rest fall out easily: `bricks` IS red brick, `smooth_stone` is
 * a flat light grey that reads as a metal panel, `polished_deepslate` is the
 * dark charcoal of the column bases and the window mullions, and
 * `polished_diorite` is a paler grey than the plaza needs but is the closest
 * thing to broom-finished concrete.
 *
 * REJECTED -- `terracotta` for the precast, which is the obvious pick by
 * name. It is a deep orange-brown and put the wings closer in colour to the
 * brick base than to the tan they are.
 */
const P = {
  precast: 'end_stone',            // the tan panel on both wings
  brick: 'bricks',                 // the base course and the colonnade piers
  metal: 'smooth_stone',           // the entry pavilion's panel system
  coping: 'polished_andesite',     // parapet cap, canopy fascia
  dark: 'polished_deepslate',      // mullions, column bases, door frames
  glass: 'glass',
  white: 'smooth_quartz',          // the sign panels
  blue: 'lapis_block',             // school colour 1 -- the only real blue here
  silver: 'iron_block',            // school colour 2
  green: 'emerald_block',          // school colour 3
  paving: 'polished_diorite',      // the plaza
  joint: 'polished_andesite',      // the scored joints in it
  drive: 'andesite',               // the drop-off loop
  curb: 'bricks',                  // the painted fire-lane curb
  seat: 'polished_blackstone',     // the hexagonal concrete seat blocks
  bed: 'moss_block',               // the ornamental grass beds
  mulch: 'coarse_dirt',
  grass: 'dried_kelp_block',       // the tawny ornamental grass itself
  accent: 'dark_prismarine',       // the school green, at wall scale
  lamp: 'sea_lantern',
  ceilingLight: 'glowstone',
  tile: 'smooth_stone',            // interior floors
  court: 'planks',                 // the gym floor
  locker: 'iron_block',
}

/*
 * THE FRAME. Plot-local, x 0..65 and z 0..62, y = 0 the air above the grass.
 *
 * The z numbers are a section through the site from the path end: lawn, then
 * the drop-off loop, then the plaza, then the building, then the south lawn
 * with the stadium lights on it. The x numbers are the elevation, read left
 * to right exactly as the photographs are.
 */
const FRONT = 30          // the main front wall: colonnade and pavilion glass
const PIER = 29           // brick piers stand one block proud of the glass
const WING_FRONT = 28     // the wings project two blocks proud of that
const COL_FRONT = 26      // the pavilion's two columns, four proud
const CANOPY_TIP = 23     // and the canopy flies three blocks past them
const BACK = 58           // the back wall of everything
/*
 * EXCEPT THE WEST WING, WHICH RUNS TWO BLOCKS FURTHER SOUTH, and the reason
 * is a word. The gym is in it, "MUSTANGS" is thirty-one blocks in the block
 * alphabet, and a banner is only a banner if it is on the wall the bleachers
 * look at. Thirty-one blocks of gym meant a wing that oversails the classroom
 * block -- which is exactly what a gym does in every school ever built, so
 * the constraint and the architecture happened to want the same thing.
 */
const BACK_W = 60

const WING_TOP = 12       // parapet cap of both wings and the colonnade
const FLOOR2 = 6          // the second floor slab sits at y = 5, air from 6
const PAV_TOP = 18        // top of the entry pavilion's metal volume
const CANOPY_Y = 19       // the canopy slab

const WEST = [1, 16]      // the tan west wing
const COL = [17, 31]      // the glass colonnade with the brick piers
const PAV = [32, 48]      // the entry pavilion
const EAST = [49, 64]     // the tan east wing

/*
 * THE PAVILION IS SEVENTEEN BLOCKS WIDE AND IT WAS THIRTEEN, which is the
 * one change that came out of putting the screenshot next to the photograph.
 *
 * At thirteen in a sixty-four-block frontage it was 20% of the front and
 * twenty blocks tall, so it read as a TOWER -- a narrow shaft pushed up
 * through a long low building. The real one is a broad portal: about a
 * quarter of the frontage, wider than it is tall above the wings, with the
 * canopy spreading past it on both sides. Four blocks of width and a canopy
 * that oversails by two instead of one is the whole difference between a
 * tower with a lid and the thing in the photograph.
 *
 * It cost the colonnade two blocks and the east wing two, which is the right
 * place to take them from: the colonnade keeps three full-height brick piers
 * and is still the widest single element, which is what the head-on
 * photograph shows.
 */

/** The commons is the room behind the colonnade and the pavilion together,
 *  so its walls are derived rather than typed -- move a bay above and the
 *  hall, the sign on its back wall and the doors into it all follow. */
const HALL = [COL[0], EAST[0]]

const DOOR = [37, 43]     // the bank of entrance doors, centred on the pavilion

/** The whole build. Everything below is a lens on `s` at its own corner. */
export function build(s) {
  site(s)
  westWing(s)
  colonnade(s)
  pavilion(s)
  eastWing(s)
  interiors(s)
  plaza(s)
  eggs(s)
}

/* ====================================================================== *
 * THE SITE: ground cover, and the shell every wing is carved out of.
 * ====================================================================== */

function site(s) {
  /*
   * A FLOOR AT y = -1, NOT AT y = 0. docs/builds/README.md: build the floor
   * into the grass rather than on top of it, or the front doors end up a
   * block off the ground and every threshold is a step.
   */
  /*
   * THE SURVEY POSTS COME OUT OF THE FRONT HALF FIRST.
   *
   * src/builds/chapters.js frames every plot in a ring of pale stone with
   * two-block posts along it, which is exactly right for a plot nobody has
   * built in and wrong the moment somebody has -- the three-quarter
   * screenshot had a line of stripped logs standing in the middle of the
   * ornamental beds. The ring STAYS, because a chapter still needs an edge;
   * the posts come out of the twenty-eight rows the visitor is looking
   * across, and stay everywhere else.
   *
   * EXCEPT IN FRONT OF THE MARKER. `markChapters` already refuses to put a
   * post through the word OMAHA and this must not undo the wall itself, so
   * the north edge is only cleared west of where the lettering starts.
   */
  for (let z = 4; z <= 27; z++) s.clear([0, 0, z], [0, 1, z]).clear([65, 0, z], [65, 1, z])
  for (let x = 0; x <= 44; x++) s.clear([x, 0, 0], [x, 1, 0])

  // The lawn: leave the grass, but mow a clean apron round the building so
  // the plaza does not meet raw field at a hard line.
  s.rect([1, 24], [64, BACK + 1], -1, P.paving)

  /* THE SHELL. One solid mass from the wing face to the back wall, hollowed
   * by each wing in turn. Solid-then-carve rather than wall-by-wall because
   * the four elements share walls with each other and an internal wall drawn
   * twice is invisible; a missing one is a hole you find from inside. */
  s.box([WEST[0], -1, WING_FRONT], [EAST[1], WING_TOP - 1, BACK], P.precast)
  s.box([WEST[0], -1, BACK], [WEST[1], WING_TOP - 1, BACK_W], P.precast)
  // The centre block sits two back of the wings, so cut its front off again.
  s.clear([COL[0], -1, WING_FRONT], [PAV[1], WING_TOP - 1, FRONT - 1])
  s.box([COL[0], -1, WING_FRONT], [PAV[1], -1, FRONT - 1], P.paving)
}

/* ====================================================================== *
 * THE WINGS. Tan precast over a red brick base, small punched windows, a
 * flat roof with a thin darker coping and rooftop plant on it.
 * ====================================================================== */

/**
 * One wing's outside face, in whichever of the two plans it is.
 *
 * THE WINDOWS ARE SPARSE AND THAT IS THE POINT. The elevated photograph
 * shows maybe five windows across a hundred and fifty feet of the west wing
 * -- punched openings in a panel wall, not a ribbon. A voxel building's
 * instinct is a band of glass every storey, and that instinct turns a
 * 1970s-cored American high school into an office block.
 */
function wingSkin(s, [x0, x1], zFace, { front = true } = {}) {
  // Brick base course, three blocks: y = 0..2. The photographs put it at
  // about a quarter of the wall, and a quarter of 13 is 3.
  s.box([x0, -1, zFace], [x1, 2, zFace], P.brick)
  s.box([x0, 3, zFace], [x1, WING_TOP - 1, zFace], P.precast)
  s.box([x0, WING_TOP, zFace], [x1, WING_TOP, zFace], P.coping)

  if (!front) return
  /* Punched windows, two wide and two tall, every seventh block on each of
   * the two floors, with the upper row offset so the pair does not read as a
   * grid of holes. Each gets a dark reveal below it, which is what stops a
   * window in a pale wall reading as a sticker. */
  for (let x = x0 + 3; x <= x1 - 4; x += 7) {
    for (const y of [1, 7]) {
      s.box([x, y, zFace], [x + 1, y + 1, zFace], P.glass)
      s.box([x - 1, y - 1, zFace], [x + 2, y - 1, zFace], P.dark)
    }
  }
}

/** Flat roof, parapet, and the HVAC boxes the wide shot shows on both wings. */
function wingRoof(s, [x0, x1], z0, z1) {
  s.rect([x0, z0], [x1, z1], WING_TOP - 1, P.coping)       // the roof deck
  // The parapet: one course standing proud round the edge, which is what
  // gives a flat-roofed building its sharp top line instead of a raw slab.
  s.box([x0, WING_TOP, z0], [x0, WING_TOP, z1], P.coping)
  s.box([x1, WING_TOP, z0], [x1, WING_TOP, z1], P.coping)
  s.box([x0, WING_TOP, z0], [x1, WING_TOP, z0], P.coping)
  s.box([x0, WING_TOP, z1], [x1, WING_TOP, z1], P.coping)
  // Rooftop plant. Three boxes, different sizes, set well back so they break
  // the roof line from the plaza without looking like a second storey.
  const boxes = [[x0 + 3, z0 + 8, 4, 3], [x0 + 9, z0 + 14, 3, 5], [x1 - 6, z0 + 10, 4, 4]]
  for (const [bx, bz, bw, bd] of boxes) {
    if (bx + bw > x1 - 1 || bz + bd > z1 - 1) continue
    s.box([bx, WING_TOP, bz], [bx + bw, WING_TOP + 1, bz + bd], P.silver)
    s.box([bx, WING_TOP + 2, bz], [bx + bw, WING_TOP + 2, bz + bd], P.coping)
  }
}

function westWing(s) {
  wingSkin(s, WEST, WING_FRONT)
  /* It runs two blocks further south than everything else -- the gym is in
   * it and MUSTANGS is thirty-one blocks long. See BACK_W. */
  wingRoof(s, WEST, WING_FRONT, BACK_W)
}

function eastWing(s) {
  wingSkin(s, EAST, WING_FRONT)
  wingRoof(s, EAST, WING_FRONT, BACK)
}

/* ====================================================================== *
 * THE COLONNADE: four two-storey glass bays between red brick piers, under
 * a grey metal parapet band. In the head-on photograph this is the widest
 * element of the whole front, wider than the pavilion, and getting that
 * proportion right is most of why the building reads as itself.
 * ====================================================================== */

function colonnade(s) {
  const [x0, x1] = COL
  // The glass wall, two storeys, floor to the underside of the metal band.
  s.box([x0, -1, FRONT], [x1, WING_TOP - 3, FRONT], P.glass)
  // A dark sill at the bottom and a dark head at the top: real curtain wall
  // is never glass straight into the floor slab.
  s.box([x0, -1, FRONT], [x1, 0, FRONT], P.dark)
  // THE MULLIONS. Every third column, so the grid is strong and vertical --
  // the photographs' most repeated line -- without the wall being half
  // metal. One block in three is the coarsest grid that still reads as one.
  for (let x = x0; x <= x1; x += 3) s.pillar(x, FRONT, 1, WING_TOP - 3, P.dark)
  // One horizontal transom at the floor line between the storeys.
  s.box([x0, FLOOR2 - 1, FRONT], [x1, FLOOR2 - 1, FRONT], P.dark)

  /* THE BRICK PIERS. Four of them, standing one block proud of the glass and
   * running the full two storeys, which is what the dusk photograph shows:
   * the brick is not a base here, it is a set of full-height piers with
   * glass between them. */
  for (let i = 0; i < 3; i++) {
    const px = x0 + 1 + i * 5
    s.box([px, -1, PIER], [px + 1, WING_TOP - 3, PIER], P.brick)
    s.box([px, -1, FRONT], [px + 1, WING_TOP - 3, FRONT], P.brick)
  }
  // The metal parapet band over the whole run, and its coping.
  s.box([x0, WING_TOP - 2, PIER], [x1, WING_TOP - 1, FRONT], P.metal)
  s.box([x0, WING_TOP, PIER], [x1, WING_TOP, FRONT], P.coping)
  // Roof behind it.
  s.rect([x0, FRONT + 1], [x1, BACK], WING_TOP - 1, P.coping)
}

/* ====================================================================== *
 * THE ENTRY PAVILION. This is the whole identity of the building and it is
 * the thing the owner will look at first.
 *
 * Four moves, in the order they matter:
 *   1. A TALLER VOLUME. Six blocks over the wings, clad in grey metal panel.
 *      Everything else on this front is horizontal; this is the only thing
 *      that is not.
 *   2. A FLAT CANOPY CANTILEVERING FORWARD over the doors -- seven blocks
 *      past the glass, three past the columns that carry it. The overhang is
 *      the silhouette. A canopy that stops at its columns is a porch.
 *   3. TWO SQUARE COLUMNS, three by three in plan, metal-clad with dark
 *      charcoal bases, standing forward of the glass.
 *   4. A TWO-STOREY GLASS WALL between them, with the white sign panel
 *      across it above the doors.
 * ====================================================================== */

function pavilion(s) {
  const [x0, x1] = PAV

  /* 1. The volume. Metal panel on all four visible sides, from the ground to
   *    y = PAV_TOP. Hollow inside -- the commons behind it is double height
   *    and this is the top of that room. */
  s.box([x0, -1, FRONT], [x1, PAV_TOP, FRONT + 1], P.metal)
  s.box([x0, WING_TOP - 1, FRONT], [x1, PAV_TOP, BACK], P.metal)
  s.clear([x0 + 1, WING_TOP, FRONT + 2], [x1 - 1, PAV_TOP - 1, BACK - 1])
  s.rect([x0, FRONT], [x1, BACK], PAV_TOP, P.metal)            // its own roof
  /*
   * ITS FLANKS STOP AT THE FACE, and the first version's did not.
   *
   * Running solid metal from the face forward to the columns turned the four
   * blocks between them into side walls, and the head-on screenshot came
   * back showing a tunnel mouth -- a deep dark recess with the doors at the
   * back of it. In every photograph you see straight PAST the columns to the
   * plaza beyond; the canopy is a plane on two legs, not a porch. So the
   * flanks are one block deep, in the plane of the glass, and the four
   * blocks in front of them are air.
   */
  s.box([x0, -1, FRONT], [x0, PAV_TOP, FRONT + 1], P.metal)
  s.box([x1, -1, FRONT], [x1, PAV_TOP, FRONT + 1], P.metal)
  s.clear([x0, 0, COL_FRONT], [x1, PAV_TOP, FRONT - 1])

  /* 4. The glass, cut back out of the metal. Full width between the flanks,
   *    floor to four blocks under the top -- the photographs show a solid
   *    metal band above the glass, not glass to the parapet. */
  s.box([x0 + 1, 0, FRONT], [x1 - 1, PAV_TOP - 4, FRONT], P.glass)
  for (let x = x0 + 1; x <= x1 - 1; x += 3) s.pillar(x, FRONT, 0, PAV_TOP - 4, P.dark)
  s.box([x0 + 1, FLOOR2 - 1, FRONT], [x1 - 1, FLOOR2 - 1, FRONT], P.dark)
  s.box([x0 + 1, -1, FRONT], [x1 - 1, -1, FRONT], P.dark)

  /* THE DOORS. A bank of them, dark frames, three blocks of opening so an
   * adult walks through without ducking. They go all the way through the
   * glass wall and the vestibule behind it. */
  s.box([DOOR[0] - 1, 0, FRONT], [DOOR[1] + 1, 4, FRONT], P.dark)
  s.clear([DOOR[0], 0, FRONT], [DOOR[1], 3, FRONT])
  /* And the frames between them, so it is a BANK of doors rather than one
   * hole in a wall. Four single-block openings with a mullion between each
   * pair -- which is what the photographs show and is still four ways in. */
  for (let x = DOOR[0] + 1; x < DOOR[1]; x += 2) s.pillar(x, FRONT, 0, 3, P.dark)
  // The transom over them, glass, so the lobby light spills onto the plaza.
  s.box([DOOR[0], 4, FRONT], [DOOR[1], 4, FRONT], P.glass)

  /* 3. The columns. Three by three, dark base, standing proud. */
  for (const cx of [x0, x1 - 2]) {
    s.box([cx, -1, COL_FRONT], [cx + 2, PAV_TOP, COL_FRONT + 2], P.metal)
    s.box([cx, -1, COL_FRONT], [cx + 2, 1, COL_FRONT + 2], P.dark)
  }

  /* 2. The canopy. One block wider than the pavilion on each side, flying
   *    from CANOPY_TIP to just inside the glass, with a darker fascia on the
   *    three exposed edges. Soffit lights under it, because at dusk the
   *    underside of that canopy is the brightest thing in the photograph. */
  s.box([x0 - 2, CANOPY_Y, CANOPY_TIP], [x1 + 2, CANOPY_Y + 1, FRONT], P.metal)
  s.box([x0 - 2, CANOPY_Y, CANOPY_TIP], [x1 + 2, CANOPY_Y + 1, CANOPY_TIP], P.coping)
  s.box([x0 - 2, CANOPY_Y, CANOPY_TIP], [x0 - 2, CANOPY_Y + 1, FRONT], P.coping)
  s.box([x1 + 2, CANOPY_Y, CANOPY_TIP], [x1 + 2, CANOPY_Y + 1, FRONT], P.coping)
  for (let x = x0 + 1; x <= x1 - 1; x += 4) {
    s.set(x, CANOPY_Y, CANOPY_TIP + 3, P.lamp)
    s.set(x, CANOPY_Y, CANOPY_TIP + 6, P.lamp)
  }

  /*
   * THE SIGN OVER THE DOORS.
   *
   * The real one is a white panel with "MILLARD NORTH / HIGH SCHOOL" on it
   * in the school's blue. It cannot be lettered here and the reason is
   * arithmetic: the block alphabet in src/builds/font.js is three columns
   * per glyph plus a gap, so "MILLARD" alone is 27 blocks and this pavilion
   * is 13. Widening the pavilion to 27 would make it 45% of the frontage
   * against the photograph's 25%, which trades the thing the building is
   * recognised by for a caption.
   *
   * So the panel over the doors is what the panel over the doors looks like
   * from the plaza -- white, with the school's blue on it and a green edge,
   * lit from behind by the lobby -- and the NAME IS SPELLED OUT TWICE
   * ELSEWHERE, both times somewhere it fits at full size: across the plaza
   * paving in front of the doors (51 blocks) and on the commons wall inside,
   * seen through this glass (27 blocks, two lines, exactly as the real sign
   * stacks it).
   */
  s.box([DOOR[0] - 2, 7, FRONT], [DOOR[1] + 2, 9, FRONT], P.white)
  s.box([DOOR[0] - 1, 8, FRONT], [DOOR[1] + 1, 8, FRONT], P.blue)
  // Its own light, or it photographs grey -- README, and Harvard's mistake.
  s.set(DOOR[0] - 3, 8, FRONT, P.ceilingLight)
  s.set(DOOR[1] + 3, 8, FRONT, P.ceilingLight)
}

/* ====================================================================== *
 * INTERIORS. Four rooms done properly rather than a floor plan sketched.
 * ====================================================================== */

function interiors(s) {
  commons(s)
  gym(s)
  corridor(s)
  library(s)
  classrooms(s)
}

/** Fill a ceiling with light. Light stops dead at a solid block, so a room
 *  gets its own sources or it is black -- and a lamp at y = 1 or 2 is at eye
 *  level, so these all go in the ceiling plane and nowhere else. */
function ceilingLights(s, x0, x1, z0, z1, y, step = 6) {
  for (let x = x0 + 2; x <= x1 - 1; x += step) {
    for (let z = z0 + 2; z <= z1 - 1; z += step) s.set(x, y, z, P.ceilingLight)
  }
}

/*
 * THE COMMONS: the two-storey hall behind the glass, and the room that
 * justifies the whole front. Twenty-nine blocks wide, thirteen deep, eleven
 * to the ceiling, with the school's name across the back wall where it is
 * read both from inside and from the plaza through the curtain wall.
 */
function commons(s) {
  const x0 = HALL[0], x1 = HALL[1], z0 = 31, z1 = 45
  s.clear([x0 + 1, 0, z0], [x1 - 1, WING_TOP - 2, z1 - 1])
  s.rect([x0 + 1, z0], [x1 - 1, z1 - 1], -1, P.tile)
  s.rect([x0 + 1, z0], [x1 - 1, z1 - 1], WING_TOP - 2, P.white)     // ceiling
  /* AND THE SIDE WALLS GET A FINISH. The shell is precast, which is an
   * OUTSIDE material, and the first interior screenshot had the commons
   * looking out at a raw tan wall. A school lobby is lined. */
  s.box([x0 + 1, 0, z0], [x0 + 1, WING_TOP - 3, z1 - 1], P.white)
  s.box([x1 - 1, 0, z0], [x1 - 1, WING_TOP - 3, z1 - 1], P.white)
  ceilingLights(s, x0, x1, z0, z1, WING_TOP - 2, 5)

  /* A blue and green inlay in the floor on the entry axis: the school's
   * colours, laid where everybody walks over them. */
  s.rect([DOOR[0] - 1, z0 + 2], [DOOR[1] + 1, z0 + 2], -1, P.blue)
  s.rect([DOOR[0] - 1, z0 + 3], [DOOR[1] + 1, z0 + 3], -1, P.accent)

  /*
   * THE BACK WALL, and the name on it.
   *
   * "MILLARD" is 27 blocks and "NORTH" is 19, stacked, which is how the real
   * sign over the doors stacks it. They fill an eleven-block wall exactly:
   * five rows, a green band, five rows. On an `xy` plane facing north, which
   * is the plane src/builds/chapters.js verified MIRROR = false for -- and
   * which is checked again by the spec, because the README's warning is that
   * a spot check which happens to pass proves nothing about the next wall.
   *
   * THE TWO DOORWAYS ARE ONE BLOCK WIDE AND IN THE CORNERS, which is a
   * concession to the lettering and not a design preference: "MILLARD" is 27
   * blocks in a 29-block wall, so there is exactly one column spare at each
   * end and a three-block door would take the M and the D with it.
   */
  s.box([x0 + 1, 0, z1], [x1 - 1, WING_TOP - 3, z1], P.white)
  const mw = textWidth('MILLARD'), nw = textWidth('NORTH')
  const mx = Math.round((x0 + x1) / 2 - mw / 2)
  const nx = Math.round((x0 + x1) / 2 - nw / 2)
  s.pattern({ at: [mx, 6, z1], plane: 'xy', legend: { '#': P.blue }, rows: textRows('MILLARD') })
  s.box([x0 + 1, 5, z1], [x1 - 1, 5, z1], P.accent)
  s.pattern({ at: [nx, 0, z1], plane: 'xy', legend: { '#': P.blue }, rows: textRows('NORTH') })
  /*
   * AND THE PAVILION BAY GOES UP INSIDE IT. The tall metal volume outside is
   * a two-storey glass wall in every photograph and the first screenshot had
   * its top four blocks reading as a dark grid, because the room behind them
   * stopped at the colonnade's ceiling and what was left was a sealed void.
   * Carving the bay up to y = 15 makes the outside honest -- the volume is
   * tall because the room is -- and the lights under its ceiling are what
   * put the warm glow in the glass that the dusk photograph is all about.
   */
  s.clear([PAV[0] + 1, WING_TOP - 2, z0], [PAV[1] - 1, 15, z1 - 1])
  s.rect([PAV[0] + 1, z0], [PAV[1] - 1, z1 - 1], 16, P.white)
  for (let x = PAV[0] + 2; x <= PAV[1] - 2; x += 4) {
    for (let z = z0 + 2; z <= z1 - 2; z += 5) s.set(x, 16, z, P.ceilingLight)
  }

  /* MID-HEIGHT LIGHT. A ceiling eleven blocks over the floor delivers four
   * levels to it, which photographs as a dark room with a bright lid. These
   * are the uplighters on the piers, at a height that is over the eyeline
   * and under the ceiling. */
  for (let z = z0 + 1; z <= z1 - 2; z += 4) {
    s.set(x0 + 1, 6, z, P.lamp)
    s.set(x1 - 1, 6, z, P.lamp)
  }

  /*
   * NO VALANCE ON THIS WALL, and that is a reversal. README: "a sign, a
   * chart or a plaque has to be its own light, or carry a lit valance" --
   * but a row of glowstone one block in FRONT of a wall is a row of boxes
   * stuck to it, which is what the screenshot showed. The uplighters on the
   * piers below and the ceiling grid above already put this wall at a light
   * level the photograph reads, so the rule is satisfied without the lumps.
   */

  /* Tables, because a commons with nothing in it is a lobby. Four runs of
   * bench seating on the east side, clear of the entry axis. */
  for (let i = 0; i < 4; i++) {
    const tz = z0 + 2 + i * 3
    s.box([x1 - 8, 0, tz], [x1 - 3, 0, tz], P.white)
    s.set(x1 - 9, 0, tz, P.seat)
    s.set(x1 - 2, 0, tz, P.seat)
  }

  /*
   * THE MEZZANINE, AND IT IS AT THE FRONT OF THE HALL RATHER THAN THE BACK.
   *
   * It started along the back wall, one block in front of the lettering, and
   * the interior screenshot showed the deck cutting "MILLARD" in half from
   * every position in the room. A balcony is a thing you look OUT from, so
   * it moved to the west side of the entry bay where it overlooks the doors
   * and the curtain wall and leaves the name wall to be read.
   *
   * Single blocks and not stair blocks: a staircase you cannot climb is
   * worse than a blocky one, and the stair keys carry their facing in the
   * name.
   */
  for (let i = 0; i <= 6; i++) s.box([19 + i, 0, 37], [19 + i, i, 37], P.tile)
  s.rect([18, 31], [28, 36], FLOOR2, P.tile)
  s.box([29, FLOOR2, 31], [29, FLOOR2 + 1, 36], P.dark)          // the east rail
  s.box([18, FLOOR2 + 1, 36], [24, FLOOR2 + 1, 36], P.dark)      // the south rail
  s.box([26, FLOOR2 + 1, 36], [28, FLOOR2 + 1, 36], P.dark)      // ...with the gap
  for (let x = 20; x <= 27; x += 4) s.set(x, WING_TOP - 3, 33, P.ceilingLight)
  for (let z = 32; z <= 35; z += 3) s.set(19, FLOOR2 - 1, z, P.lamp)  // under it
  // A pair of benches on the deck, because a balcony you cannot sit on is a
  // landing.
  s.box([21, FLOOR2 + 1, 33], [26, FLOOR2 + 1, 33], P.white)

  /* AND THE PAVILION BAY'S WALLS GET THE SAME FINISH, up to its own ceiling
   * -- the first pass lined only to the colonnade's, and the screenshot
   * showed raw tan precast over the top of the white. */
  for (const wx of [PAV[0], PAV[1]]) s.box([wx, WING_TOP - 2, z0], [wx, 15, z1 - 1], P.white)
  /* From y = 11, NOT y = 10: the top row of "MILLARD" sits at 10 and the
   * first version of this line painted over it. */
  s.box([PAV[0], WING_TOP - 1, z1], [PAV[1], 15, z1], P.white)
}

/*
 * THE GYM, in the west wing: a double-height volume with a wood floor, a
 * centre circle in the school's blue, two hoops and a run of bleachers.
 * Behind the bleachers is the first easter egg -- see eggs().
 */
function gym(s) {
  const x0 = WEST[0], x1 = WEST[1], z0 = WING_FRONT + 1, z1 = BACK_W
  s.clear([x0 + 1, 0, z0], [x1 - 1, WING_TOP - 2, z1 - 1])
  s.rect([x0 + 1, z0], [x1 - 1, z1 - 1], -1, P.court)
  s.rect([x0 + 1, z0], [x1 - 1, z1 - 1], WING_TOP - 2, P.white)
  /* Lined, like the commons: the shell is precast and precast is an outside
   * material. A gym is painted block from the floor to the roof deck. */
  for (const wx of [x0, x1]) s.box([wx, 0, z0], [wx, WING_TOP - 3, z1 - 1], P.white)
  s.box([x0 + 1, 0, z0], [x1 - 1, WING_TOP - 3, z0], P.white)
  s.box([x0 + 1, 0, z1 - 1], [x1 - 1, WING_TOP - 3, z1 - 1], P.white)
  ceilingLights(s, x0, x1, z0, z1, WING_TOP - 2, 4)
  /*
   * AND LIGHT AT HALF HEIGHT, because eleven blocks of ceiling delivers four
   * levels to the floor and photographs as a dark room with a bright lid.
   *
   * THE TWO WALLS GET DIFFERENT HEIGHTS, and that is not symmetry for its own
   * sake. The east wall carries MUSTANGS from y = 5 to y = 11, and the first
   * version put its fixtures at y = 7 -- six sea lanterns standing in the
   * middle of the word, which is exactly what the screenshot showed. They
   * moved to y = 3, under the banner and still over the eyeline.
   */
  for (let z = z0 + 2; z <= z1 - 2; z += 4) s.set(x0 + 1, 7, z, P.lamp)
  for (let z = z0 + 3; z <= z1 - 2; z += 4) s.set(x1 - 1, 3, z, P.lamp)

  // Court markings: a centre line, a centre circle and a green border, in the
  // school's blue on a wood floor.
  const cz = Math.round((z0 + z1) / 2), cx = Math.round((x0 + x1) / 2)
  s.rect([x0 + 1, cz], [x1 - 1, cz], -1, P.blue)
  for (const [dx, dz] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-1, -1], [1, 1], [-1, 1], [1, -1]]) {
    s.set(cx + dx, -1, cz + dz, P.blue)
  }
  for (let x = x0 + 1; x <= x1 - 1; x++) { s.set(x, -1, z0, P.green); s.set(x, -1, z1 - 1, P.green) }

  // The two hoops: a backboard on the wall with a rim under it, at each end.
  for (const [hz, dir] of [[z0, 1], [z1 - 1, -1]]) {
    s.box([cx - 1, 4, hz], [cx + 1, 5, hz], P.white)
    s.set(cx, 4, hz + dir, P.curb)
  }

  // Bleachers: three tiers stepping up against the west wall, and the crawl
  // space behind them is the first easter egg -- see eggs().
  for (let t = 0; t < 3; t++) s.box([x0 + 1 + t, t, z0 + 2], [x0 + 1 + t, t, z1 - 3], P.tile)

  /*
   * MUSTANGS, on the east wall where the bleachers look at it. Thirty-one
   * blocks exactly, which is why the wing is two blocks deeper than the rest
   * of the building. Painted INTO the wall at x = x1 rather than onto a panel
   * in front of it, so the banner is flush and the court keeps its width.
   *
   * A `zy` wall facing west -- THE OTHER PLANE, and therefore the one the
   * README says a spot check on the first plane proves nothing about. The
   * spec decodes this one out of the world separately from the north-facing
   * ones, and GYM_MIRROR below is set by that decode and by a screenshot.
   */
  const word = 'MUSTANGS'
  const ww = textWidth(word)
  const wz = Math.round((z0 + z1) / 2 - ww / 2)
  s.box([x1, 5, wz - 1], [x1, 11, wz + ww], P.white)
  s.pattern({
    at: [x1, 6, wz], plane: 'zy',
    legend: { '#': P.blue }, rows: textRows(word, GYM_MIRROR),
  })
  for (let z = wz + 2; z < wz + ww; z += 6) s.set(x1 - 1, 11, z, P.ceilingLight)
}

/*
 * WHETHER THE GYM WALL IS BACKWARDS.
 *
 * It is the one readable thing in this build that is not on a north-facing
 * `xy` wall. `pattern`'s 'zy' plane runs characters along +z; the reader
 * stands in the gym facing +x (east), and facing +x in this left-handed
 * engine puts +z BEHIND-left rather than on the right. Harvard shipped
 * `4202` off exactly this reasoning done in the head, so this constant is
 * set by screenshot and by the decode in test/85-millard-north.spec.js, not
 * by the paragraph above.
 */
const GYM_MIRROR = true

/*
 * THE CORRIDOR, with lockers down both sides. Every American high school is
 * this hallway more than it is any other room, and it is the interior a
 * visitor will recognise fastest.
 */
function corridor(s) {
  const z0 = 46, z1 = 51
  const x0 = WEST[1] + 1, x1 = EAST[1] - 1
  s.clear([x0, 0, z0], [x1, 4, z1])
  s.rect([x0, z0], [x1, z1], -1, P.tile)
  s.rect([x0, z0], [x1, z1], 5, P.white)

  /* LOCKERS, two blocks high, down both sides. The dark course above them is
   * what makes a wall of iron blocks read as lockers rather than as a wall
   * of iron blocks. */
  for (const z of [z0, z1]) {
    s.box([x0, 0, z], [x1, 1, z], P.locker)
    s.box([x0, 2, z], [x1, 2, z], P.dark)
  }

  /*
   * THE TROPHY CASE. Millard North has forty-two state championships, which
   * is a fact, so the case holds forty-two trophies -- two rows of twenty-one
   * along the north side of the hall, on a dark plinth with a lit valance
   * over it. Counting them is the reward for noticing there is something to
   * count.
   *
   * IT STANDS IN THE CORRIDOR RATHER THAN BEING RECESSED INTO THE WALL, and
   * that is a bug fix rather than a preference: recessed, it was one block
   * behind the locker line, which is the commons' back wall, which is where
   * "NORTH" is written. Two rows of gold blocks went straight through the
   * middle of the word and the screenshot showed an N followed by nothing.
   */
  const shelf = []
  for (let x = 19; x <= 46; x++) shelf.push(x)      // west of the commons door
  for (let x = 50; x <= 63; x++) shelf.push(x)      // east of it
  if (shelf.length !== 42) throw new Error(`the trophy case holds ${shelf.length}, not 42`)
  for (const x of shelf) {
    s.set(x, 1, z0 + 1, P.dark)                     // the plinth
    s.set(x, 2, z0 + 1, 'gold_block')               // the trophy
    s.set(x, 3, z0 + 1, P.ceilingLight)             // the valance over it
  }

  /*
   * DOORWAYS, cut after the lockers so the openings win. Two deep, because
   * every room on the north side has its own wall as well as the locker run.
   * The commons pair are one block wide and in its corners -- the wall
   * between them is 27 blocks of lettering with one column to spare.
   */
  s.clear([HALL[0] + 1, 0, z0 - 1], [HALL[0] + 1, 3, z0])   // commons, west corner
  s.clear([HALL[1] - 1, 0, z0 - 1], [HALL[1] - 1, 3, z0])   // commons, east corner
  s.clear([WEST[1], 0, 48], [x0, 3, 49])               // west, into the gym
  s.clear([56, 0, z0 - 1], [58, 3, z0])                 // the library
  for (const dx of [24, 39, 54]) s.clear([dx, 0, z1], [dx + 2, 3, z1 + 1])  // classrooms

  // Lit at intervals, in the ceiling plane.
  for (let x = x0 + 2; x <= x1; x += 7) s.set(x, 5, z0 + 2, P.ceilingLight)
  // A blue and green stripe down the floor, which is a thing schools do.
  s.rect([x0, z0 + 2], [x1, z0 + 2], -1, P.blue)
  s.rect([x0, z0 + 3], [x1, z0 + 3], -1, P.accent)
}

/*
 * THE LIBRARY / MEDIA CENTRE, in the east wing. Bookshelves in runs with an
 * aisle between them -- and EVERY AISLE IS ITS OWN ROOM as far as block
 * light is concerned, which is why each one gets a lamp rather than trusting
 * one in the middle.
 */
function library(s) {
  const x0 = EAST[0], x1 = EAST[1], z0 = WING_FRONT + 1, z1 = 46
  s.clear([x0 + 1, 0, z0], [x1 - 1, 4, z1 - 1])
  s.rect([x0 + 1, z0], [x1 - 1, z1 - 1], -1, P.tile)
  s.rect([x0 + 1, z0], [x1 - 1, z1 - 1], 5, P.white)

  /* THREE RUNS, NOT FOUR. The east wing lost two blocks to the widened entry
   * pavilion and the fourth run's aisle lamp landed at local x = 66, one
   * block outside the plot -- which the stamper caught at boot, out loud,
   * with the coordinate, which is exactly what the bounds check is for. */
  for (let i = 0; i < 3; i++) {
    const sx = x0 + 3 + i * 4
    s.box([sx, 0, z0 + 2], [sx, 2, z1 - 4], 'bookshelf')
    s.box([sx + 1, 0, z0 + 2], [sx + 1, 2, z1 - 4], 'bookshelf')
    // One lamp per aisle, in the ceiling over the gap.
    for (let z = z0 + 4; z <= z1 - 5; z += 5) s.set(sx + 2, 5, z, P.ceilingLight)
  }
  // Reading tables at the front, under the windows.
  for (let i = 0; i < 3; i++) {
    s.box([x0 + 2 + i * 5, 0, z1 - 2], [x0 + 4 + i * 5, 0, z1 - 2], P.white)
  }
  s.set(x0 + 2, 5, z0 + 1, P.ceilingLight)
  s.set(x1 - 2, 5, z0 + 1, P.ceilingLight)
}

/*
 * THREE CLASSROOMS off the south side of the corridor. Desks in rows, a
 * board at the front, and a window in the back wall -- which is the south
 * elevation and faces the athletic fields.
 */
function classrooms(s) {
  const z0 = 53, z1 = BACK - 1
  for (let i = 0; i < 3; i++) {
    const x0 = 21 + i * 15, x1 = x0 + 12
    s.clear([x0, 0, z0], [x1, 4, z1])
    s.rect([x0, z0], [x1, z1], -1, P.tile)
    s.rect([x0, z0], [x1, z1], 5, P.white)
    /*
     * THE BOARD IS ON z0 - 1, WHICH IS THE ROOM'S OWN NORTH WALL, and the
     * first version put it on z0 - 2 -- which is the corridor's south locker
     * line. The screenshot showed forty blocks of blackboard running down
     * the hallway instead of three classrooms with a board in each.
     */
    s.box([x0 + 2, 1, z0 - 1], [x1 - 2, 3, z0 - 1], 'dark_prismarine')
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 4; c++) {
        s.set(x0 + 2 + c * 3, 0, z0 + 1 + r * 2, P.white)
        s.set(x0 + 2 + c * 3, 0, z0 + 2 + r * 2, P.seat)
      }
    }
    for (let x = x0 + 3; x <= x1 - 2; x += 5) s.set(x, 5, z0 + 1, P.ceilingLight)
    s.set(x0 + 1, 5, z1 - 1, P.ceilingLight)
    // A window in the south wall, from the outside as well as the inside --
    // this elevation is the one that looks at the athletic fields.
    s.box([x0 + 4, 1, BACK], [x0 + 8, 2, BACK], P.glass)
  }
}

/* ====================================================================== *
 * THE PLAZA, THE DROP-OFF AND THE LANDSCAPE. No parking lot.
 * ====================================================================== */

function plaza(s) {
  /*
   * THE PLAZA. Broom-finished concrete from the canopy out to the drive,
   * scored into bays -- the joint lines are what stop twenty by fifty blocks
   * of one pale block reading as a car park by accident.
   */
  s.rect([4, 16], [61, CANOPY_TIP + 1], -1, P.paving)
  /* And the walk in from the spur mouth, which src/builds/chapters.js opens
   * in the border at local (65, 6) -- the plot's path-side corner. Without
   * it a visitor arrives at a school across ten blocks of field. */
  s.rect([59, 6], [64, 16], -1, P.paving)
  for (let x = 8; x <= 58; x += 6) s.rect([x, 16], [x, CANOPY_TIP + 1], -1, P.joint)

  /*
   * THE NAME, INLAID IN THE PAVING, and it is here because it fits nowhere
   * else at full size. "MILLARD NORTH" is 51 blocks wide in the block
   * alphabet; the plot is 66 and the entry pavilion is 13.
   *
   * MIRRORING: this is an 'xz' plane, a drawing on the floor, and the
   * question is not left-to-right -- characters run +x, and a reader facing
   * +z has +x on their right, so that half is the same as the markers. It is
   * the ROW ORDER: text on the ground is read with the TOP of the letters
   * AWAY from you, and `pattern` puts row 0 nearest. So the rows go in
   * reversed. Written down because it is the one reversal in this file that
   * the north-facing-wall argument does not cover, and it is checked by
   * screenshot from the plaza and by the decode in the spec.
   */
  const name = 'MILLARD NORTH'
  const nw = textWidth(name)
  const nx = Math.round(33 - nw / 2)
  s.rect([nx - 2, 16], [nx + nw + 1, 22], -1, P.white)
  s.pattern({
    at: [nx, -1, 17], plane: 'xz',
    legend: { '#': P.blue }, rows: textRows(name).slice().reverse(),
  })

  /*
   * THE DROP-OFF LOOP. A curved drive with a planted island in it, and a
   * painted red fire-lane curb along the building side -- which is the one
   * splash of colour in the foreground of the dusk photograph. It is a LOOP
   * and it ends where it began; nothing here is a parking bay, which the
   * brief was explicit about.
   */
  for (let x = 2; x <= 63; x++) {
    // A shallow arc: deepest in the middle, swinging back toward the lawn at
    // each end, so it reads as a turning circle rather than a street.
    const t = (x - 32.5) / 31
    const z = Math.round(11 - 3 * (1 - t * t))
    for (let d = 0; d < 4; d++) s.set(x, -1, z + d, P.drive)
    s.set(x, -1, z + 4, P.curb)
  }
  // The island the loop goes round: grass, mulch and ornamental planting.
  s.rect([22, 4], [44, 7], -1, 'grass')
  s.rect([25, 5], [41, 6], -1, P.bed)
  for (let x = 26; x <= 40; x += 3) s.set(x, 0, 5, P.grass)

  /*
   * THE FLAGPOLES, left of the entry as they are in the dusk photograph.
   * Three of them: the United States, Nebraska, and the school. Quartz
   * pillar because it is the only white vertical-grained block here and a
   * flagpole is exactly that.
   */
  for (let i = 0; i < 3; i++) {
    const fx = 24 + i * 3
    s.pillar(fx, 20, 0, 10, 'quartz_pillar')
    const flag = [
      ['bricks', 'smooth_quartz', 'lapis_block'],        // the United States
      ['lapis_block', 'smooth_quartz', 'lapis_block'],   // Nebraska, blue
      ['lapis_block', 'dark_prismarine', 'iron_block'],  // blue, green, silver
    ][i]
    /* ONE BLOCK OF FLY, NOT TWO. The first version's flags were 2x3 slabs of
     * saturated colour halfway up the colonnade and read as billboards. */
    flag.forEach((k, r) => s.set(fx + 1, 9 - r, 20, k))
    s.set(fx, 11, 20, P.lamp)
  }

  /*
   * THE HEXAGONAL SEAT BLOCKS. A voxel cannot be a hexagon, so what carries
   * them is the SCATTER: the photographs show a couple of dozen charcoal
   * blocks strewn across the plaza at no spacing at all, singly and in
   * pairs, and that irregularity is the thing you recognise. Hand-placed
   * rather than looped, for the same reason the spine is hand-placed.
   */
  const seats = [
    [10, 25], [12, 24], [17, 26], [21, 25], [22, 24], [27, 26], [31, 25],
    [35, 26], [39, 25], [44, 26], [48, 25], [49, 24], [54, 26], [57, 25],
    [14, 21], [19, 20], [46, 21], [51, 20], [55, 21],
  ]
  for (const [x, z] of seats) s.set(x, 0, z, P.seat)

  /*
   * THE PLAZA LIGHT POLES. Slim silver poles with a white head, which is
   * what the photographs show, and at y = 5 the head is over the eyeline
   * rather than in it.
   */
  for (const [x, z] of [[9, 22], [18, 24], [30, 24], [50, 24], [59, 22], [13, 17], [53, 17]]) {
    s.pillar(x, z, 0, 4, P.silver)
    s.set(x, 5, z, P.lamp)
  }

  /*
   * ORNAMENTAL GRASS BEDS either side of the entry, which in every one of
   * the four photographs is the thing between the plaza and the lawn.
   */
  for (const [bx0, bx1] of [[2, 14], [52, 63]]) {
    s.rect([bx0, 24], [bx1, WING_FRONT - 1], -1, P.mulch)
    for (let x = bx0; x <= bx1; x++) {
      for (let z = 24; z <= WING_FRONT - 1; z++) {
        if ((x * 7 + z * 13) % 5 === 0) s.set(x, -1, z, P.bed)
        if ((x * 3 + z * 11) % 9 === 0) s.set(x, 0, z, P.grass)
      }
    }
  }

  /*
   * THE STADIUM LIGHTS. In the dusk photograph there are light poles on the
   * horizon past the right-hand wing, and they are the athletic fields --
   * which this model does not build, because at this scale they would be
   * most of the plot. Four poles on the south lawn are the whole reference
   * to them and they are honest: they say the fields are that way.
   */
  for (const x of [20, 34, 48, 60]) {
    s.pillar(x, 61, 0, 15, P.silver)
    s.box([x - 1, 16, 61], [x + 1, 16, 61], P.lamp)
  }
}

/* ====================================================================== *
 * THE EASTER EGGS. Two, and both are a date.
 * ====================================================================== */

/** Four digits the block alphabet does not have. Same 3x5 grid, same order:
 *  rows read top down, which is what `pattern` wants for a vertical plane. */
const DIGITS = {
  0: ['###', '#.#', '#.#', '#.#', '###'],
  1: ['.#.', '##.', '.#.', '.#.', '###'],
  2: ['###', '..#', '###', '#..', '###'],
  6: ['###', '#..', '###', '#.#', '###'],
  7: ['###', '..#', '..#', '..#', '..#'],
  8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '###'],
}

function digitRows(text) {
  const rows = ['', '', '', '', '']
  ;[...text].forEach((ch, i) => {
    const g = DIGITS[ch]
    if (!g) throw new Error(`no digit glyph for ${JSON.stringify(ch)}`)
    for (let r = 0; r < 5; r++) rows[r] += (i ? '.' : '') + g[r]
  })
  return rows
}

function eggs(s) {
  /*
   * ONE: UNDER THE BLEACHERS -- and under the floor under them.
   *
   * There is a cellar beneath the gym holding 1978, the year the building
   * opened for grades 9 and 10 only, laid in glowstone in its floor, with
   * the school's three colours on a shelf beside it: blue, silver, green.
   *
   * THE VERTICAL BUDGET IS THE WHOLE DESIGN HERE. This world is Classic
   * Flat: grass at y = -1, dirt at -2 and -3, bedrock at -4. Clearing -3 and
   * -2 gives exactly two blocks of headroom standing on the bedrock, which
   * is the most a cellar in this world can ever have, and there is no room
   * for a staircase. So the way in is Omaha's: a pair of missing floorboards
   * with two crates under them. From the crates the opening is one block up,
   * and one block is a jump. Without them the floor is three blocks over
   * your head and the cellar is a hole you cannot get out of.
   *
   * IT IS UNDER THE SECOND BLEACHER TIER, so the missing boards are in the
   * strip of floor nobody walks on and you find them by going and looking
   * behind the seats.
   */
  const cx0 = WEST[0] + 1, cz0 = 33
  const cw = textWidth('1978')
  s.box([cx0, -4, cz0], [cx0 + cw - 1, -4, cz0 + 6], P.dark)
  s.clear([cx0, -3, cz0], [cx0 + cw - 1, -2, cz0 + 6])
  /* Read by somebody standing at the near end looking south: facing +z, the
   * reader's right is +x, so the characters run the right way already -- but
   * the TOP of a word on the floor is the far side of it, and `pattern` puts
   * row 0 nearest. Hence the reversal, the same one the plaza inlay needs. */
  s.pattern({
    at: [cx0, -4, cz0 + 1], plane: 'xz',
    legend: { '#': P.ceilingLight }, rows: digitRows('1978').slice().reverse(),
  })
  // Blue, silver and green on a shelf at the far end.
  s.set(cx0 + cw - 1, -3, cz0 + 2, P.blue)
  s.set(cx0 + cw - 1, -3, cz0 + 3, P.silver)
  s.set(cx0 + cw - 1, -3, cz0 + 4, P.green)
  // The missing floorboards, and the crates under them.
  s.clear([cx0 + 2, -1, cz0 + 3], [cx0 + 2, -1, cz0 + 4])
  s.box([cx0 + 2, -3, cz0 + 3], [cx0 + 2, -3, cz0 + 4], 'planks')

  /*
   * TWO: ON THE ROOF. 2016, the year the comprehensive renovation finished
   * and therefore the year this building became the one in the photographs,
   * laid flat in glowstone on the east wing's roof deck where the only way
   * to read it is to get above it. Fifteen blocks wide in an eighteen-block
   * wing, which is why it is on that roof and not the other one.
   *
   * ROW ORDER REVERSED, same reason as the plaza inlay: it is drawing on the
   * floor and the top of the digits has to be the far side.
   */
  const dw = textWidth('2016')
  const rx = Math.round((EAST[0] + EAST[1]) / 2 - dw / 2)
  s.pattern({
    at: [rx, WING_TOP - 1, 50], plane: 'xz',
    legend: { '#': P.ceilingLight }, rows: digitRows('2016').slice().reverse(),
  })
}
