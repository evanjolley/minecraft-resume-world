/*
 * WHERE EVERY BUILD GOES, as data.
 *
 * `claude-opus-5-1` is a walkable autobiography: eight stages of a life, laid
 * out along one road, oldest at the north end. This file is the survey map.
 * It exists so that eight people (or eight agents) can build eight plots at
 * the same time without one of them having to read another's code to find out
 * where the boundary is.
 *
 * WHICH WORLD THIS IS THE MAP OF, since it is no longer the default one. The
 * overworld went back to bare superflat at the owner's request and the
 * timeline moved to `claude-opus-5-1` -- a row in src/dimensions.js and a row
 * in src/island.js's WORLDS, reached by `/world claude-opus-5-1`. NOTHING IN
 * THIS FILE CHANGED for that, which is the test of whether the coordinate
 * systems below were the right ones: the plots are patch indices into a
 * 128x128 patch with its ground at GROUND_Y, and claude-opus-5-1 is that
 * patch. The world it lives in was never one of the three coordinate systems.
 *
 * ------------------------------------------------------------------------
 * ONE COORDINATE SYSTEM PER JOB, and there are three of them. Getting these
 * confused is the single most likely way to place a block in the wrong
 * county, so they are named differently everywhere in src/builds/:
 *
 *   PATCH coords   0..127 on x and z, the indices into `patch.cols`. y is
 *                  absolute, the same y the game reports. This is the only
 *                  system src/island.js knows about.
 *   WORLD coords   what the player sees in the debug screen and what /tp
 *                  takes. world x = patch x - 87, world z = patch z - 56.
 *                  See WORLDS.overworld in src/island.js for the origin.
 *   PLOT-LOCAL     what a build file is written in. (0, 0, 0) is the
 *                  north-west corner of your plot AT GROUND LEVEL -- the
 *                  first block of air above the grass. +x runs east toward
 *                  the road, +z runs south, +y runs up.
 *
 * `toPatch` is the only conversion anybody should write. `toWorld` exists so
 * that a build can print a /tp command for its own front door.
 *
 * WHY LOCAL y = 0 IS THE AIR ABOVE THE GRASS rather than the grass itself:
 * almost everything a build places is something it puts ON the ground, so
 * the common case should be the one with no arithmetic in it. Digging is
 * negative -- y = -1 is the grass block you are standing on, y = -2 the dirt
 * under it -- which reads correctly as "below ground" and is what the Omaha
 * cellar is written in.
 * ------------------------------------------------------------------------
 *
 * REJECTED -- deriving the plots from a loop (four rows of two, 56 wide, 28
 * deep, gutters between). It is three lines shorter and it means nobody can
 * grep for their own coordinates, nobody can nudge one plot by two blocks
 * without moving all eight, and a reader has to run the arithmetic in their
 * head to answer "am I allowed to build at x=60". The table is the contract;
 * a contract you have to compute is not one.
 */

/** The y a player's feet rest at, and therefore the y a build starts from.
 *  Deliberately a copy of island.js's SURFACE_Y rather than an import:
 *  builds/ is imported BY island.js (see src/builds/index.js), and a cycle
 *  between the world and the things standing on it is a boot-order bug
 *  waiting to happen. It is asserted equal in test/70-builds.spec.js. */
export const GROUND_Y = 136

/** Patch x of world x = 0, and patch z of world z = 0. Same caveat: a copy of
 *  WORLDS.overworld.originX/originZ, checked by the spec rather than imported. */
export const ORIGIN_X = 87
export const ORIGIN_Z = 56

/*
 * THE SPINE.
 *
 * Four blocks of paving at x = 62..65, running the full length of the patch
 * from z = 4 to z = 124. Every visitor walks it, it is the first thing anyone
 * sees, and it is what makes eight unrelated builds read as one place.
 *
 * The road's PLOT is wider than its paving: x = 60..67 takes in the two-block
 * verge on each side, which belongs to no stage and is where the lamp posts,
 * the kerb and the stage markers stand. If it were 62..65 the lamps would
 * have to be written by whoever owns the plot beside them, which is how you
 * get eight different lamp posts.
 */
export const ROAD = {
  id: 'road', label: 'The road',
  x0: 60, x1: 67, z0: 4, z1: 124,
  /** The paved strip inside the verge. Builds may read this to line a path up
   *  with the kerb; nobody but road.js may write to it. */
  paving: { x0: 62, x1: 65 },
}

/*
 * THE EIGHT STAGES, north to south, alternating sides of the road.
 *
 * Each is 56 x 28. North is -z, so stage 1 is the FAR end from spawn and the
 * visitor walks forward through time. `side` is which hand it falls on as you
 * walk north: LEFT is west (x < road), RIGHT is east.
 *
 * `owner` is the file under src/builds/ that may write here, and it is the
 * whole point of the table being published: no build file needs to know any
 * coordinate except its own, and the stamper refuses anything else out loud.
 */
export const PLOTS = [
  { n: 1, id: 'omaha',      label: 'Omaha, Nebraska',        side: 'LEFT',  x0: 4,  x1: 59,  z0: 6,  z1: 33,  owner: '01-omaha.js' },
  { n: 2, id: 'harvard',    label: 'Harvard',                side: 'RIGHT', x0: 68, x1: 123, z0: 6,  z1: 33,  owner: '02-harvard.js' },
  { n: 3, id: 'perplexity', label: 'Perplexity',             side: 'LEFT',  x0: 4,  x1: 59,  z0: 34, z1: 61,  owner: '03-perplexity.js' },
  { n: 4, id: 'arize',      label: 'Arize',                  side: 'RIGHT', x0: 68, x1: 123, z0: 34, z1: 61,  owner: '04-arize.js' },
  { n: 5, id: 'bilibili',   label: 'Bilibili',               side: 'LEFT',  x0: 4,  x1: 59,  z0: 62, z1: 89,  owner: '05-bilibili.js' },
  { n: 6, id: 'nologo',     label: 'No Logo',                side: 'RIGHT', x0: 68, x1: 123, z0: 62, z1: 89,  owner: '06-nologo.js' },
  { n: 7, id: 'patronus',   label: 'Patronus AI',            side: 'LEFT',  x0: 4,  x1: 59,  z0: 90, z1: 117, owner: '07-patronus.js' },
  { n: 8, id: 'parkour',    label: 'Parkour + San Francisco', side: 'RIGHT', x0: 68, x1: 123, z0: 90, z1: 117, owner: '08-parkour-sf.js' },
]

/** Every allocation, the road included, by id. */
export const ALL = Object.fromEntries([ROAD, ...PLOTS].map(p => [p.id, p]))

/**
 * Look up a plot by id, loudly.
 *
 * A typo'd id used to be an `undefined` that produced NaN coordinates and a
 * build that silently wrote nothing -- the same failure mode as a typo'd
 * block key, and worth the same treatment.
 */
export function plot(id) {
  const found = ALL[id]
  if (!found) {
    throw new Error(`no plot ${JSON.stringify(id)} -- known plots: ${Object.keys(ALL).join(', ')}`)
  }
  return found
}

/** How many blocks wide (x) and deep (z) a plot is. Inclusive bounds, so +1. */
export const width = (p) => p.x1 - p.x0 + 1
export const depth = (p) => p.z1 - p.z0 + 1

/**
 * PLOT-LOCAL -> PATCH. The one conversion.
 *
 * @param p a plot row (or the road)
 * @param x, y, z plot-local: 0,0,0 is the plot's north-west corner at ground
 * @returns [px, py, pz] -- patch indices and an absolute y
 *
 * Does NOT range-check. The stamper does that, once, at the write, because
 * that is the only place that can report both the local coordinate the author
 * typed and the patch coordinate it landed on.
 */
export function toPatch(p, x, y, z) {
  return [p.x0 + x, GROUND_Y + y, p.z0 + z]
}

/** PATCH -> WORLD, for printing a /tp somebody can actually paste. */
export function toWorld(px, py, pz) {
  return [px - ORIGIN_X, py, pz - ORIGIN_Z]
}

/**
 * Where a visitor arrives: the south end of the road, facing north up the
 * timeline with stage 1 the far end of the walk.
 *
 * Patch (63, 120) is the middle of the paving, four blocks in from where the
 * road stops -- so you land ON the road with road visibly ahead AND behind,
 * which reads as a beginning rather than as a wall. In world coordinates that
 * is (-24, 64); src/island.js turns it into a spawn point and every spec that
 * asserts where you land reads it from here.
 *
 * IT IS claude-opus-5-1'S SPAWN, not the overworld's, as of the day the
 * timeline moved out of the default world. The overworld spawns at its origin
 * again -- see the WORLDS table in src/island.js for why the empty world went
 * back to (0, 0) rather than to its own centre.
 */
export const SPAWN_PATCH_X = 63
export const SPAWN_PATCH_Z = 120

/* ====================================================================== *
 *
 * THE SECOND SURVEY: the overworld, 288 x 400, and why it lives in this file.
 *
 * Everything above describes `claude-opus-5-1` -- a 128x128 patch, eight
 * plots, a straight paved road -- and NONE of it changed when the overworld
 * grew. That world is the owner's archive and its coordinates are frozen.
 *
 * What follows is the survey of the world he is actually walking: a winding
 * path through rolling, vanilla-shaped country with six chapter plots on
 * alternating sides. Same file, because this is what the file is FOR -- the
 * one place you look to find out what you are allowed to write to -- and
 * because both surveys share GROUND_Y, `toPatch` and the stamper.
 *
 * WHAT IS DIFFERENT FROM THE ARCHIVE:
 *
 *   - Patch indices run 0..287 on x and 0..399 on z. The world is NOT
 *     square any more (see LAND_W / LAND_D for why).
 *   - The origin is 144/16, so world x = patch x - 144 and world z = patch
 *     z - 16. Spawn is world (0, 0), at the north end of the walk.
 *   - THE VISITOR WALKS SOUTH, and z counts up as the years do.
 *
 * REJECTED -- one id namespace. The ids below are prefixed `ch` and the
 * archive's are not, so `plot('omaha')` still means the archive's Omaha and
 * `landPlot('ch1')` means this world's.
 * ====================================================================== */

/*
 * THE WORLD'S SIZE, AND WHY IT IS 288 x 400 AND NOT A SQUARE.
 *
 * Sprint 1 grew chapters 2 to 6 to 74 x 76 each, the size the owner's own
 * Harvard plot reached. Six plots that size, on alternating sides of one
 * path, need two columns of plots and a corridor between them:
 *
 *   x:  22 margin | 74 plot | 96 corridor for the path | 74 plot | 22 margin
 *
 * which is 288. The 22-column margins are not waste: they are the hills
 * behind each plot, so a build's back wall has country behind it rather
 * than the barrier.
 *
 * In z the plots stagger, L R L / river / R L R, and the walk needs room
 * between them for the forest, the river and the bridge. Measured from the
 * table below: 16 rows from spawn to chapter 1, then the plots, then 20 rows
 * of mountain foot past chapter 6. 400.
 *
 * REJECTED -- a 400 x 400 square. It is what island.js assumed until this
 * pass, and it is 112 more columns of x that nobody walks to: 44,800 extra
 * columns to generate, mesh and hold in memory every boot. A WORLDS row now
 * says `sizeX` and `sizeZ` (see src/island.js), and a square world is the
 * case where they are equal.
 */
export const LAND_W = 288
export const LAND_D = 400
/** Patch column of world x = 0, and patch row of world z = 0, for the
 *  overworld. WORLDS.overworld.originX / originZ, copied rather than
 *  imported for the reason GROUND_Y is a copy. */
export const LAND_ORIGIN_X = 144
export const LAND_ORIGIN_Z = 16

/** Where the visitor lands and where the path starts, in patch indices. */
export const LAND_SPAWN_X = LAND_ORIGIN_X
export const LAND_SPAWN_Z = LAND_ORIGIN_Z

/*
 * THE WHOLE MAP, as one allocation. The path, the river, the trees and the
 * hills are not plot-shaped, so the landscape's allocation is the entire
 * patch, and the six chapters are handed to it as NO-GO rectangles. See
 * `forbid` in src/builds/stamp.js.
 */
export const LAND = {
  id: 'land', label: 'The path and the landscape',
  x0: 0, x1: LAND_W - 1, z0: 0, z1: LAND_D - 1,
}

/*
 * HOW BIG EACH CHAPTER IS, and it is the one table a builder may need to
 * touch.
 *
 * Every chapter's build file exports `SIZE = { w, d }`, and
 * src/builds/chapters.js checks it against this table at boot: a build that
 * is SMALLER than its row is fine (it is the north-west corner of its plot,
 * like any build), and one that is LARGER throws, naming this table. The
 * check lives there rather than here because this file has no imports, on
 * purpose: island.js, node scripts and the specs all read it.
 *
 * Chapter 1 is 66 x 63 and FROZEN: Millard North is standing on it and the
 * sprint brief forbids changing a block of it. It may move; it may not grow.
 *
 * SLOT is the largest a chapter may be without re-cutting the walk. Each row
 * below is placed by its PATH-SIDE edge and its north edge, so a smaller
 * plot keeps its entrance where the spur arrives and gives the difference
 * back to the landscape on its far side.
 */
export const SLOT = { w: 74, d: 76 }
export const CHAPTER_SIZE = {
  ch1: { w: 66, d: 63 },
  ch2: { w: 74, d: 76 },
  ch3: { w: 70, d: 64 },   // Bilibili's build says SIZE 70 x 64
  ch4: { w: 74, d: 76 },
  ch5: { w: 74, d: 76 },
  ch6: { w: 74, d: 76 },
}

/** The two columns of plots. LEFT plots end at x = 95 (their path-side
 *  edge; +x is west in this engine, so that is their east edge); RIGHT
 *  plots start at 192. The 96 columns between are the path's corridor. */
export const LEFT_EDGE_X = 95
export const RIGHT_EDGE_X = 192

/*
 * THE SIX CHAPTERS, north to south, alternating sides of the path.
 *
 * `side` is which hand the plot falls on as you walk SOUTH. +x is WEST in
 * this engine (Babylon is left-handed; see HEADING in test/helpers/world.js),
 * so LEFT is the low-x side. Unchanged from the previous survey: every
 * chapter is on the hand it was on before, so a build that faces the path
 * still faces it.
 *
 * THE RESULT, so that nobody has to run the arithmetic to find their plot.
 * test/75-land.spec.js asserts these numbers against the rows:
 *
 *   ch1  LEFT   x  30..95   z  32..94    66 x 63
 *   ch2  RIGHT  x 192..265  z  64..139   74 x 76
 *   ch3  LEFT   x  26..95   z 122..185   70 x 64
 *   ch4  RIGHT  x 192..265  z 192..267   74 x 76   (an island in the river)
 *   ch5  LEFT   x  22..95   z 238..313   74 x 76
 *   ch6  RIGHT  x 192..265  z 304..379   74 x 76   (and the air above it)
 *
 * THE RIVER CROSSES BETWEEN CHAPTERS 3 AND 4. It runs diagonally, from the
 * west edge near z = 218 (between ch3 and ch5) to the east edge near z = 160
 * (between ch2 and New York's moat), so it separates the first three
 * chapters from the last three on both sides of the path, and the path
 * crosses it on a bridge. The crossing is the move to the city.
 *
 * NEW YORK IS AN ISLAND, kept from the previous survey: a moat ring cut off
 * the river all the way round chapter 4, and its spur crosses on a second
 * bridge. See src/builds/river.js.
 *
 * CHAPTER 6 CLAIMS THE AIR. It is a parkour going UP, so its allocation is
 * the footprint and the full build height above it, local y 0..+63. Nothing
 * enforces the vertical claim; the landscape keeps its trees back from it.
 *
 * Every z0 is chosen so that consecutive plots on one side have 27 to 40
 * rows of country between them, and so that each plot's north corner, where
 * its spur arrives, comes into view as the previous one falls behind.
 */
const ROWS = [
  { n: 1, id: 'ch1', label: 'Omaha, Nebraska',         marker: 'OMAHA',         side: 'LEFT',  z0: 32 },
  { n: 2, id: 'ch2', label: 'Harvard, school work',    marker: 'HARVARD',       side: 'RIGHT', z0: 64 },
  { n: 3, id: 'ch3', label: 'Bilibili',                marker: 'BILIBILI',      side: 'LEFT',  z0: 122 },
  { n: 4, id: 'ch4', label: 'New York, No Logo',       marker: 'NEW YORK',      side: 'RIGHT', z0: 192 },
  { n: 5, id: 'ch5', label: 'San Francisco, Patronus', marker: 'SAN FRANCISCO', side: 'LEFT',  z0: 238 },
  { n: 6, id: 'ch6', label: 'The climb',               marker: 'THE CLIMB',     side: 'RIGHT', z0: 304 },
]

export const CHAPTERS = ROWS.map((r) => {
  const { w, d } = CHAPTER_SIZE[r.id]
  const x0 = r.side === 'LEFT' ? LEFT_EDGE_X - w + 1 : RIGHT_EDGE_X
  return { ...r, x0, x1: x0 + w - 1, z1: r.z0 + d - 1 }
})

/** Every overworld allocation by id. Separate from ALL above, because the two
 *  surveys are two coordinate systems and a single map would let a typo in
 *  one world resolve to a plot in the other. */
export const LAND_ALL = Object.fromEntries([LAND, ...CHAPTERS].map(p => [p.id, p]))

/** Look up a chapter (or the landscape) by id, loudly. Same contract as
 *  `plot`, different survey. */
export function landPlot(id) {
  const found = LAND_ALL[id]
  if (!found) {
    throw new Error(`no overworld plot ${JSON.stringify(id)} -- known: ${Object.keys(LAND_ALL).join(', ')}`)
  }
  return found
}

/** PATCH -> WORLD for the overworld's origin, so a chapter can print a /tp
 *  that actually goes somewhere. The archive's `toWorld` uses the archive's
 *  origin and would be 41 blocks and 40 rows wrong here. */
export function toLandWorld(px, py, pz) {
  return [px - LAND_ORIGIN_X, py, pz - LAND_ORIGIN_Z]
}
