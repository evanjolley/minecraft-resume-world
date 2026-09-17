/*
 * WHERE EVERY BUILD GOES, as data.
 *
 * The world is a walkable autobiography: eight stages of a life, laid out
 * along one road, oldest at the north end. This file is the survey map. It
 * exists so that eight people (or eight agents) can build eight plots at the
 * same time without one of them having to read another's code to find out
 * where the boundary is.
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
 */
export const SPAWN_PATCH_X = 63
export const SPAWN_PATCH_Z = 120
