/*
 * The page-side half of the preview world: the three builds, stamped into a
 * bare 256 superflat at the rectangles in previewLayout.js. Imported by the
 * page through vite only -- see the header of previewWorld.js for why node
 * cannot load it.
 */
import { flatPatch, FLAT_PRESETS } from '../../src/flatworld.js'
import { stamper } from '../../src/builds/stamp.js'
import { GROUND_Y } from '../../src/builds/plots.js'
import * as ch4 from '../../src/builds/ch4-new-york.js'
import * as ch5 from '../../src/builds/ch5-san-francisco.js'
import * as ch6 from '../../src/builds/ch6-the-climb.js'
import { PREVIEW_AT, PREVIEW_SIZE } from './previewLayout.js'

export const BUILDS = { ch4, ch5, ch6 }

/** The plot rectangle for one preview build, in patch coordinates. */
export function previewPlot(id) {
  const at = PREVIEW_AT[id], { w, d } = BUILDS[id].SIZE
  return { id, label: `preview ${id}`, side: at.side, x0: at.x0, x1: at.x0 + w - 1, z0: at.z0, z1: at.z0 + d - 1 }
}

/** Stamp all three. Returns the block count each one placed. */
export function stampPreview(world) {
  const placed = {}
  for (const id of Object.keys(BUILDS)) {
    const s = stamper(world, previewPlot(id), { label: `preview/${id}` })
    BUILDS[id].build(s)
    placed[id] = s.placed
  }
  return placed
}

export function previewPatch({ builds = true } = {}) {
  return flatPatch({
    preset: FLAT_PRESETS.classic,
    width: PREVIEW_SIZE, depth: PREVIEW_SIZE,
    surfaceY: GROUND_Y, ceilingY: GROUND_Y + 64,
    builds: builds ? (w) => { w.placed = stampPreview(w) } : null,
  })
}

/** A reader over a stamped patch in one build's plot-local coordinates. */
export function reader(world, id) {
  const p = previewPlot(id)
  return (x, y, z) => world.palette[world.cols[(p.z0 + z) * world.width + (p.x0 + x)][GROUND_Y + y - world.yMin]]
}

export { GROUND_Y }
