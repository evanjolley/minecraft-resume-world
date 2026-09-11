import path from 'node:path'
import { fileURLToPath } from 'node:url'

/*
 * Screenshots.
 *
 * They live in test/screenshots/, which carries its own .gitignore -- rather
 * than a line in the repo root .gitignore, because several agents are editing
 * this repo at once and the root file is a merge conflict waiting to happen.
 *
 * These are EVIDENCE, not assertions. Anything a number can check is checked
 * with a number; a screenshot is what we fall back to when the thing under
 * test is "does the crouched player model actually look crouched", which no
 * assertion in this file can honestly answer.
 */
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'screenshots')

const shotPath = (name) => path.join(DIR, `${name}.png`)

/** Full viewport. */
export const shot = (page, name) =>
  page.screenshot({ path: shotPath(name) })

/**
 * Crop to a region. Named regions cover the two things that ever matter
 * (a HUD strip, a corner), so callers stop hand-computing clip rects.
 */
export async function shotRegion(page, name, region) {
  const { width, height } = page.viewportSize()
  const clip = typeof region === 'string' ? REGIONS[region](width, height) : region
  return page.screenshot({ path: shotPath(name), clip })
}

const REGIONS = {
  // The hotbar + hearts + hunger strip, centred at the bottom.
  hud: (w, h) => ({ x: w / 2 - 240, y: h - 130, width: 480, height: 130 }),
  crosshair: (w, h) => ({ x: w / 2 - 80, y: h / 2 - 80, width: 160, height: 160 }),
  topLeft: () => ({ x: 0, y: 0, width: 320, height: 120 }),
  centre: (w, h) => ({ x: w / 2 - 320, y: h / 2 - 240, width: 640, height: 480 }),
}
