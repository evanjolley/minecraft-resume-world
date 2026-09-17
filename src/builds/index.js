/*
 * The one place the builds are attached to the world.
 *
 * ------------------------------------------------------------------------
 * CALLED FROM src/flatworld.js, at the end of flatPatch, and that placement
 * took an argument to settle.
 *
 * The obvious home is src/island.js's generateTerrain -- it is the seam
 * between "the world exists" and "the world is installed", which is exactly
 * when a structure wants to be written. It is also wrong, for a reason that
 * is invisible in a browser: island.js is imported BY NODE, in
 * scripts/terrain/verify.mjs, and this file's chain reaches src/blocks.js,
 * which reaches src/blockMeshes.js, which reaches @babylonjs/core. Putting
 * the import there would mean a terrain verifier that needs a WebGL context,
 * which island.js's own header argues at length against for the same reason.
 *
 * flatworld.js has no such problem: its only importer is src/dimensions.js,
 * which already pulls in blocks.js. So the builds hang off the generator, the
 * verifier still runs in node, and src/island.js keeps its two imports.
 *
 * REJECTED -- a `builds` field on the dimension row in src/dimensions.js,
 * which is where a reader would most expect to find it. It is the tidier
 * place and it is somebody else's file today; flatPatch takes a `builds`
 * parameter instead, defaulting to this function, so moving the decision into
 * the dimension table later is a one-line change with no new concepts.
 *
 *   -- AND IT WAS TAKEN, exactly as advertised and for exactly one line each.
 *   The two generated rows in src/dimensions.js now say `builds: null`
 *   (overworld) and `builds: stampBuilds` (claude-opus-5-1), which is the
 *   only field that differs between them.
 * ------------------------------------------------------------------------
 * ONLY claude-opus-5-1 IS STAMPED, and where that is decided moved.
 *
 * It used to be "only the overworld", and not because of a name check --
 * because the other dimensions are IMPORTED assets that never pass through
 * flatPatch at all. That is still true of the Nether and the mountains. What
 * changed is that there are now TWO generated worlds through the same
 * function, and the one that gets the builds is named in the dimension table
 * rather than implied by being the only caller. The overworld is the owner's
 * bare ground to build on; this timeline is the world the model built, kept
 * under a name.
 *
 * The geometry assertion below is still the guard that matters: if a
 * generated dimension ever appears at a different size or ground height, it
 * fails here rather than scattering half a house across a world whose ground
 * is sixty blocks lower.
 */
import { stamper } from './stamp.js'
import { GROUND_Y, PLOTS, ROAD } from './plots.js'

import { build as road } from './road.js'
import { build as omaha } from './01-omaha.js'
import { build as harvard } from './02-harvard.js'
import { build as perplexity } from './03-perplexity.js'
import { build as arize } from './04-arize.js'
import { build as bilibili } from './05-bilibili.js'
import { build as nologo } from './06-nologo.js'
import { build as patronus } from './07-patronus.js'
import { build as parkour } from './08-parkour-sf.js'

/*
 * Plot id -> the function that fills it.
 *
 * EVERY STAGE HAS A ROW FROM DAY ONE, pointing at a file that starts empty.
 * Eight people are building eight plots at once; if registration were "add
 * your line here when you are done", this file would be the one thing all
 * eight of them edit and therefore the one thing that conflicts. A stub that
 * places nothing is a merge nobody has to do.
 */
const BUILDS = [
  ['road', road],
  ['omaha', omaha],
  ['harvard', harvard],
  ['perplexity', perplexity],
  ['arize', arize],
  ['bilibili', bilibili],
  ['nologo', nologo],
  ['patronus', patronus],
  ['parkour', parkour],
]

/**
 * Write every build into a freshly generated world.
 *
 * @param world    flatPatch's output, mutated in place. This is the only
 *                 moment it is mutable: src/island.js installs it immediately
 *                 afterwards and from then on it is read-only, six million
 *                 reads per world and no writes ever.
 * @param surfaceY the y the generator put the ground at, so the mismatch
 *                 below is caught rather than assumed.
 * @returns the same world, so the caller can `return stampBuilds(...)`.
 *
 * A build that throws takes the page down with it, deliberately. The failures
 * the stamper throws on -- an unknown block key, a write outside your plot --
 * are all things that would otherwise render as a plausible-looking world
 * with something quietly missing from it, which is the single worst outcome
 * for a build nobody has walked through yet.
 */
export function stampBuilds(world, surfaceY) {
  if (world.width !== 128 || world.depth !== 128 || surfaceY !== GROUND_Y) {
    throw new Error(
      `stampBuilds: the plot table in src/builds/plots.js describes a 128x128 `
      + `patch with its ground at y=${GROUND_Y}; this world is `
      + `${world.width}x${world.depth} with ground at y=${surfaceY}.`)
  }
  for (const [id, build] of BUILDS) build(stamper(world, id))
  return world
}

/** For the spec and the console: what got registered, and where it lives. */
export const registry = () => [ROAD, ...PLOTS].map(p => ({
  id: p.id, label: p.label, x: [p.x0, p.x1], z: [p.z0, p.z1],
}))
