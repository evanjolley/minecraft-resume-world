/*
 * THE OVERWORLD, assembled: the landscape, then the six chapters on it.
 *
 * Two halves, in two files, for one reason. src/builds/land.js generates
 * the landscape and imports nothing that needs a browser, so it can be run
 * and measured in node and checked by a spec. The chapters cannot: their
 * build files hang paintings and letter signs, and those modules reach
 * Babylon. This file is where the two meet, and it is the one the dimension
 * table in src/dimensions.js points at.
 *
 * The chapters go on LAST, through the ordinary stamper bound to each plot,
 * so every chapter's bounds check is the same one the archive's eight
 * stages have always had.
 */
import { generateLand, landStats } from './land.js'
import { markChapters } from './chapters.js'
import { GROUND_Y } from './plots.js'

/**
 * Build the overworld. Same contract as src/flatworld.js's flatPatch: a
 * world in the importer's shape, generated once, read-only after install.
 */
export function landPatch({ surfaceY = GROUND_Y, ceilingY = GROUND_Y + 64 } = {}) {
  const { world, model } = generateLand({ surfaceY, ceilingY })
  const t0 = performance.now()
  markChapters(world, model)
  landStats.chaptersMs = Math.round(performance.now() - t0)
  console.log(`[land] ${JSON.stringify(landStats)}`)
  return world
}

export { landStats }
