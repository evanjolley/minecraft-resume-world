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
 * THE SECOND SURVEY: the 256x256 overworld, and why it lives in this file.
 *
 * Everything above describes `claude-opus-5-1` -- a 128x128 patch, eight
 * plots, a straight paved road -- and NONE of it changed when the overworld
 * grew. That world is the owner's archive and its coordinates are frozen.
 *
 * What follows is the survey of the world he is actually walking: a winding
 * path through a living landscape with seven chapter plots on alternating
 * sides, laid out across 256 blocks instead of 128. Same file, because this
 * is what the file is FOR -- the one place you look to find out what you are
 * allowed to write to -- and because both surveys share GROUND_Y, `plot()`,
 * `toPatch` and the stamper that reads them. Two files would mean two answers
 * to "where am I allowed to build".
 *
 * WHAT IS DIFFERENT, and there are only three things:
 *
 *   - Patch indices run 0..255, not 0..127.
 *   - The origin is 128/16, not 87/56, so world x = patch x - 128 and world
 *     z = patch z - 16. See WORLDS.overworld in src/island.js for why.
 *   - THE VISITOR WALKS SOUTH. In the archive, spawn was the south end and
 *     north (-z) was forward through time. Here spawn is the NORTH end,
 *     chapter 1 is a short walk in front of you, and z counts UP as the years
 *     do. The direction flipped because spawn has to be world (0, 0) and the
 *     walk has to start there.
 *
 * REJECTED -- one id namespace. The ids below are prefixed `ch` and the
 * archive's are not, so `plot('omaha')` still means the archive's Omaha and
 * `plot('ch1')` means this world's. A shared `omaha` would be a name whose
 * meaning depends on which world is being generated, which is the one kind of
 * ambiguity a coordinate table must not have.
 * ====================================================================== */

/** The overworld's side, in blocks. WORLDS.overworld.size, copied for the
 *  same reason GROUND_Y is a copy: this module must stay import-free so
 *  island.js and node scripts can read it. Asserted in test/75-land.spec.js. */
export const LAND_SIZE = 256
/** Patch column of world x = 0, and patch row of world z = 0, for the
 *  overworld. WORLDS.overworld.originX / originZ, same caveat. */
export const LAND_ORIGIN_X = 128
export const LAND_ORIGIN_Z = 16

/** Where the visitor lands and where the path starts, in patch indices.
 *  (128, 16) is world (0, 0) -- the origin, which every world spawns at. */
export const LAND_SPAWN_X = LAND_ORIGIN_X
export const LAND_SPAWN_Z = LAND_ORIGIN_Z

/*
 * THE WHOLE MAP, as one allocation.
 *
 * The path, the river, the trees and the undergrowth are not a plot-shaped
 * thing -- a winding path legitimately wanders from x=96 to x=158 and from
 * one end of the world to the other, and boxing it would mean either a
 * bounding box so large it asserts nothing or a dozen little rectangles that
 * the path then has to be drawn to fit. So the landscape's allocation is the
 * entire 256 square.
 *
 * WHICH WOULD MAKE THE STAMPER'S BOUNDS CHECK MEANINGLESS, and that is the
 * problem this pass had to solve rather than shrug at. The check is what
 * stops one build writing into another's plot, and it is the only thing that
 * will protect the owner's seven chapters from a landscape pass that decides
 * to plant a forest. So the stamper grew `forbid` (see src/builds/stamp.js):
 * the landscape's stamper is handed the seven chapter footprints as NO-GO
 * rectangles and throws if a tree, a lamp or a spill of gravel lands in one.
 * The guard is inverted -- "everywhere except there" instead of "only here"
 * -- and it is exactly as loud.
 */
export const LAND = {
  id: 'land', label: 'The path and the landscape',
  x0: 0, x1: LAND_SIZE - 1, z0: 0, z1: LAND_SIZE - 1,
}

/*
 * THE SEVEN CHAPTERS, north to south, alternating sides of the path.
 *
 * 52 x 24 each -- a touch smaller than the archive's 56 x 28, which is what
 * the owner asked for -- and MUCH further apart. In the archive the plots
 * tiled: stage 3 began on the row stage 1 ended on, so the walk between two
 * chapters was zero blocks long and the world read as a street. Here the
 * nearest edges of two consecutive chapters are 8 or 9 blocks apart in z AND
 * on opposite sides of a path that swings 50 blocks east and west between
 * them. MEASURED, not estimated: the path is 434 blocks long, the walk from
 * one spur mouth to the next is 53 to 73 blocks of it, and each spur is
 * another 20 to 33 blocks off the path to the plot edge. In the archive the
 * equivalent numbers were 28 and nothing. The walk between chapters is the
 * point.
 *
 * `side` is which hand the plot falls on as you walk SOUTH, and the compass
 * here is not the one you expect: +x is WEST in this engine (Babylon is
 * left-handed, so facing +z puts +x on your right -- see HEADING in
 * test/helpers/world.js, measured in test/25-orientation.spec.js). So LEFT is
 * the low-x side, which is EAST, and RIGHT is high-x, which is west. In the
 * archive you walked north and the hands were the other way round. The words
 * follow the visitor, not the compass, which is why `side` is a label and
 * every coordinate below is an index.
 *
 * THE GAP AT z 142..171 IS THE RIVER, and it is the widest gap on the map by
 * 20 blocks. It falls between Bilibili and New York on purpose: the crossing
 * is the move to the city, and a bridge means more when what it separates is
 * two chapters rather than two fields.
 *
 * CHAPTER 7 CLAIMS THE AIR, which no other plot does. It is a parkour going
 * UP, so its allocation is the same 52 x 24 footprint and the full build
 * height above it -- local y 0..+60, the ceiling being GROUND_Y + 64. Nothing
 * enforces the vertical claim because nothing else builds up there; it is
 * written down so that whoever plants a tree near it knows what is coming.
 */
export const CHAPTERS = [
  { n: 1, id: 'ch1', label: 'Omaha, Nebraska',       marker: 'OMAHA',         side: 'LEFT',  x0: 28,  x1: 79,  z0: 22,  z1: 45 },
  { n: 2, id: 'ch2', label: 'Harvard',               marker: 'HARVARD',       side: 'RIGHT', x0: 176, x1: 227, z0: 54,  z1: 77 },
  { n: 3, id: 'ch3', label: 'School work',           marker: 'SCHOOL WORK',   side: 'LEFT',  x0: 28,  x1: 79,  z0: 86,  z1: 109 },
  { n: 4, id: 'ch4', label: 'Bilibili',              marker: 'BILIBILI',      side: 'RIGHT', x0: 176, x1: 227, z0: 118, z1: 141 },
  { n: 5, id: 'ch5', label: 'New York, No Logo',     marker: 'NEW YORK',      side: 'LEFT',  x0: 28,  x1: 79,  z0: 172, z1: 195 },
  { n: 6, id: 'ch6', label: 'San Francisco, Patronus', marker: 'SAN FRANCISCO', side: 'RIGHT', x0: 176, x1: 227, z0: 204, z1: 227 },
  { n: 7, id: 'ch7', label: 'The climb',             marker: 'THE CLIMB',     side: 'LEFT',  x0: 28,  x1: 79,  z0: 230, z1: 253 },
]

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
