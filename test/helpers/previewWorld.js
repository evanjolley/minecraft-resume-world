/*
 * A TEST-ONLY WORLD THAT HOLDS CHAPTERS 4, 5 AND 6, so they can be walked,
 * played and photographed before the landscape pass wires them into the
 * overworld.
 *
 * WHY IT EXISTS. The overworld's plot table (src/builds/plots.js CHAPTERS)
 * belongs to the landscape agent, who is re-laying the whole map in parallel
 * with these builds. Wiring a build into `markChapters` from here would be a
 * merge conflict in somebody else's file, and the current rows are 52 x 24
 * anyway -- too small for a build that is 74 x 76. So the specs stamp the
 * three builds into a bare superflat of their own, at plot rectangles that
 * exist only in test/helpers/previewLayout.js, and register it as a
 * dimension at runtime.
 *
 * NOTHING IN src/ KNOWS ABOUT IT. `enterPreview` adds a row to island.js's
 * WORLDS and a row to dimensions.js's DIMENSIONS from inside the page (both
 * are exported objects, read by name at the moment of a world change), then
 * enters it through the same `dimensions.enter` a chat command uses.
 *
 * TWO HALVES, because a build file cannot be imported by node (see the
 * header of previewLayout.js). This file is imported by NODE for
 * `enterPreview` and `inPage` only, which import nothing heavy; the page
 * imports test/helpers/previewStamp.js through vite, which has the builds.
 *
 * COORDINATES. The preview plots are NOT rows of LAND_ALL, so the stamper's
 * `toWorld` uses the archive's origin (87 / 56) for them -- which is why the
 * preview world's WORLDS row uses that origin too. A sign a build registers
 * at `s.toWorld(...)` therefore lands on its own block here, exactly as it
 * will in the overworld once the build is a real CHAPTERS row.
 */
import {
  PREVIEW_WORLD, PREVIEW_SIZE, PREVIEW_ORIGIN_X, PREVIEW_ORIGIN_Z, previewWorldXYZ,
} from './previewLayout.js'

export { previewWorldXYZ }

/**
 * Register the preview world inside the page and go there.
 *
 * @param page   a booted Playwright page
 * @param spawn  plot-local [id, x, z] to arrive at
 */
export async function enterPreview(page, spawn = ['ch4', -6, 6]) {
  const [sx, , sz] = previewWorldXYZ(spawn[0], spawn[1], 0, spawn[2])
  const res = await page.evaluate(async ([name, size, ox, oz, sx, sz]) => {
    const island = await import('/src/island.js')
    const dims = await import('/src/dimensions.js')
    const preview = await import('/test/helpers/previewStamp.js')
    island.WORLDS[name] = {
      size, originX: ox, originZ: oz, surfaceY: 136, drop: 2, spawnX: sx, spawnZ: sz,
    }
    if (!dims.DIMENSIONS[name]) {
      dims.DIMENSIONS[name] = {
        name, id: 'minecraft:overworld',
        generate: () => preview.previewPatch(),
        sky: null, fog: { density: 0 },
      }
    }
    if (window.game.dimensions.active === name) {
      const n = window.noa
      n.ents.setPosition(n.playerEntity, [sx + 0.5, 138, sz + 0.5])
      return { ok: true }
    }
    return window.game.dimensions.enter(name)
  }, [PREVIEW_WORLD, PREVIEW_SIZE, PREVIEW_ORIGIN_X, PREVIEW_ORIGIN_Z, sx, sz])
  if (!res.ok) throw new Error(`enterPreview: ${res.error}`)
  return res
}

/**
 * Run `fn(mod)` inside the page with test/helpers/previewStamp.js imported as
 * `mod`, and return its JSON result. For the census specs: the world is
 * stamped in the page, by the same code vite serves the game, and only the
 * answer crosses back.
 */
export function inPage(page, fn, arg) {
  return page.evaluate(async ([src, arg]) => {
    const mod = await import('/test/helpers/previewStamp.js')
    // eslint-disable-next-line no-new-func
    return new Function('mod', 'arg', `return (${src})(mod, arg)`)(mod, arg)
  }, [fn.toString(), arg])
}
