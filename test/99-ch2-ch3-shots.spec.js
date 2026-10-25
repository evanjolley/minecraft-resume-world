/*
 * CHAPTERS 2 AND 3, PHOTOGRAPHED.
 *
 * Not assertions beyond "something meshed where I am standing" -- the point
 * is that somebody LOOKS at these frames, because the defects that matter in
 * a build (a sign above the eyeline, a dark room, a facade that does not
 * read as the building) are only visible at eye level.
 *
 * WIRED. These skipped until the landscape pass registered both builds in
 * src/builds/chapters.js; now each describe block ASSERTS its own building
 * is standing (a block only that build places, at a plot-local spot) before
 * it photographs anything. Coordinates come from the CHAPTERS table, so a
 * re-laid-out world moves the camera with the plot.
 *
 * OUT_DIR, if set, is where the frames are written; otherwise
 * test/screenshots/ like every other shots spec.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from './fixtures.js'
import {
  SURFACE_Y, waitFrames, waitTicks, look, teleport, HEADING,
  useGamemode, doubleTapFly, enterWorld, grantOp, chatCommand,
} from './helpers/world.js'
import { CHAPTERS, LAND_ORIGIN_X, LAND_ORIGIN_Z } from '../src/builds/plots.js'

const SHOTS = process.env.OUT_DIR
  ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots')

const plotOf = (id) => CHAPTERS.find(c => c.id === id)

/** Plot-local -> world x, z. */
const L = (c, lx, lz) => [c.x0 + lx - LAND_ORIGIN_X, c.z0 + lz - LAND_ORIGIN_Z]

/** Is this build stamped here? Reads the GENERATOR, not the meshed chunks,
 *  so it answers for a plot two hundred blocks from the camera. */
const has = (page, c, [lx, ly, lz], key) => page.evaluate(([x, y, z, key]) => {
  const t = window.game.terrain
  return window.game.voxelAt(x - t.originX, y, z - t.originZ) === window.game.ids[key]
}, [c.x0 + lx, SURFACE_Y + ly, c.z0 + lz, key])

async function frame(page, c, name, [lx, lz], { heading = HEADING.southPlusZ, pitch = 0, y = 1 } = {}) {
  const [x, z] = L(c, lx, lz)
  await teleport(page, x + 0.5, SURFACE_Y + y, z + 0.5)
  await waitTicks(page, 14)
  await look(page, { heading, pitch })
  await waitFrames(page, 14)
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
}

async function above(page, c, name, [lx, lz], h = 55) {
  const [x, z] = L(c, lx, lz)
  await teleport(page, x + 0.5, SURFACE_Y + h, z + 0.5)
  await waitTicks(page, 30)
  await look(page, { heading: HEADING.southPlusZ, pitch: 1.45 })
  await waitFrames(page, 20)
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
}

test.describe('chapter 2, the Science Center', () => {
  test('from the path, the Yard, the plaza, inside, on the roof and above', async ({ page }) => {
    test.setTimeout(300_000)
    await enterWorld(page, 'overworld')
    const c = plotOf('ch2')
    // The observatory's telescope pier: only this build puts iron there.
    expect(await has(page, c, [56, 45, 57], 'iron_block'), 'ch2 is not stamped in the overworld').toBe(true)
    await useGamemode(page, 'creative')
    await doubleTapFly(page)

    const SW = 0.75     // between south (+z) and west (+x)
    await frame(page, c, '99-ch2-from-path', [-14, 2], { heading: SW, pitch: -0.25 })
    await frame(page, c, '99-ch2-from-path-south', [-16, 40], { heading: HEADING.westPlusX, pitch: -0.3 })
    await frame(page, c, '99-ch2-yard-arrival', [3, 6], { heading: SW, pitch: -0.05 })
    await frame(page, c, '99-ch2-yard-gate', [36, 20], { pitch: -0.1 })
    await frame(page, c, '99-ch2-plaza-head-on', [36, 28], { pitch: -0.42 })
    await frame(page, c, '99-ch2-plaza-three-quarter', [8, 29], { heading: 0.55, pitch: -0.38 })
    await frame(page, c, '99-ch2-fountain', [13, 26], { pitch: 0.15 })
    await frame(page, c, '99-ch2-passage', [24, 42], { pitch: 0 })
    await frame(page, c, '99-ch2-library', [36, 47], { pitch: 0.05 })
    await frame(page, c, '99-ch2-lecture-hall', [11, 57], { heading: HEADING.northMinusZ, pitch: 0.15, y: 5 })
    await frame(page, c, '99-ch2-study-room', [38, 63], { pitch: 0.35 })
    await frame(page, c, '99-ch2-lobby', [61, 47], { pitch: -0.1 })
    await frame(page, c, '99-ch2-light-well', [62, 64], { heading: SW, pitch: -0.9, y: 2 })
    await frame(page, c, '99-ch2-terrace', [36, 51], { heading: HEADING.northMinusZ, pitch: 0.2, y: 15 })
    await frame(page, c, '99-ch2-observatory', [53, 63], { heading: HEADING.northMinusZ + 0.4, pitch: 0.1, y: 46 })
    await frame(page, c, '99-ch2-from-north-campus', [36, 80], { heading: HEADING.northMinusZ, pitch: -0.5 })
    await above(page, c, '99-ch2-above', [36, 40])

    await grantOp(page)
    await chatCommand(page, '/time set midnight')
    await frame(page, c, '99-ch2-night-plaza', [30, 27], { heading: 0.2, pitch: -0.35 })
    await frame(page, c, '99-ch2-night-yard', [3, 6], { heading: SW, pitch: -0.05 })
    await chatCommand(page, '/time set day')
    expect(await page.evaluate(() => window.game.terrain.width)).toBe(288)
  })
})

test.describe('chapter 3, Bilibili', () => {
  test('from the path, the forecourt, the studio, the chart and above', async ({ page }) => {
    test.setTimeout(300_000)
    await enterWorld(page, 'overworld')
    const c = plotOf('ch3')
    // The today tower's lamp: only this build puts a sea lantern there.
    expect(await has(page, c, [12, 28, 52], 'sea_lantern'), 'ch3 is not stamped in the overworld').toBe(true)
    await useGamemode(page, 'creative')
    await doubleTapFly(page)

    const E = HEADING.eastMinusX                  // facing -x, at the TV's face
    await frame(page, c, '99-ch3-from-path', [82, 2], { heading: E + 0.75, pitch: -0.2 })
    await frame(page, c, '99-ch3-head-on', [86, 24], { heading: E, pitch: -0.18 })
    await frame(page, c, '99-ch3-forecourt', [68, 24], { heading: E, pitch: -0.3 })
    await frame(page, c, '99-ch3-studio', [60, 24], { heading: E, pitch: 0.02 })
    await frame(page, c, '99-ch3-danmaku', [58, 24], { heading: E + 0.5, pitch: -0.65 })
    await frame(page, c, '99-ch3-behind-set', [48, 13], { pitch: 0.45 })
    await frame(page, c, '99-ch3-edit-desk', [58, 16], { heading: HEADING.northMinusZ, pitch: 0.2 })
    await frame(page, c, '99-ch3-chart', [44, 62], { heading: HEADING.northMinusZ, pitch: -0.25 })
    await frame(page, c, '99-ch3-chart-day0', [62, 58], { heading: HEADING.northMinusZ + 0.3, pitch: 0.05 })
    await frame(page, c, '99-ch3-tower-top', [12, 52], { heading: 2.3, pitch: 0.35, y: 30 })
    await above(page, c, '99-ch3-above', [36, 32])

    await grantOp(page)
    await chatCommand(page, '/time set midnight')
    await frame(page, c, '99-ch3-night-head-on', [80, 24], { heading: E, pitch: -0.18 })
    await frame(page, c, '99-ch3-night-studio', [60, 24], { heading: E, pitch: 0.02 })
    await chatCommand(page, '/time set day')
  })
})
