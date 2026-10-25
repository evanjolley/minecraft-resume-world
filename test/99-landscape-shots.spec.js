/*
 * WHAT THE OVERWORLD LOOKS LIKE: the walk at eye level, biome by biome, and
 * the land from the air.
 *
 * Photographs, not assertions, in the manner of 98-harvard-shots: the
 * landscape is judged by looking at it, and this is the camera. Every
 * position is computed from the generator itself (src/builds/land.js runs in
 * node), so a shot stands on the path wherever the spine moves it and at the
 * height the land actually is.
 *
 * Writes test/screenshots/land-*.png.
 */
import { test, expect } from './fixtures.js'
import {
  SURFACE_Y, teleport, look, waitTicks, waitFrames, useGamemode, doubleTapFly,
} from './helpers/world.js'
import { shot } from './helpers/shots.js'
import { generateLand } from '../src/builds/land.js'
import { LAND_ORIGIN_X, LAND_ORIGIN_Z } from '../src/builds/plots.js'

const { model, samples, spurs } = generateLand()
const W = model.W
const groundAt = (px, pz) => model.h[Math.round(pz) * W + Math.round(px)]

/** Stand on the path at spine sample i, looking along it (or `turn` off it). */
async function onPath(page, i, { turn = 0, pitch = 0.05, ahead = 0 } = {}) {
  const s = samples[i]
  const t = samples[Math.min(samples.length - 1, i + 8)]
  const px = s.x, pz = s.z
  const heading = Math.atan2(t.x - s.x, t.z - s.z) + turn
  const y = SURFACE_Y + groundAt(px, pz) + 1
  await teleport(page, px - LAND_ORIGIN_X + 0.5, y + ahead, pz - LAND_ORIGIN_Z + 0.5)
  await waitTicks(page, 30)
  await look(page, { heading, pitch })
  await waitFrames(page, 20)
}

/** Hover at patch (px, pz), `up` blocks over the ground, looking `heading`. */
async function hover(page, px, pz, up, heading, pitch) {
  const y = SURFACE_Y + Math.max(0, groundAt(px, pz)) + up
  /* Held in the air by switching gravity off for the body, not by creative
   * flight: a double-tap that lands in one slow tick under a loaded machine
   * leaves the camera falling into the canopy it was meant to photograph. */
  await page.evaluate(() => {
    const noa = window.noa
    noa.ents.getPhysics(noa.playerEntity).body.gravityMultiplier = 0
  })
  await teleport(page, px - LAND_ORIGIN_X + 0.5, y, pz - LAND_ORIGIN_Z + 0.5)
  await waitTicks(page, 60)
  await look(page, { heading, pitch })
  await waitFrames(page, 30)
}

const sampleNear = (pz) => {
  let best = 0
  samples.forEach((s, i) => { if (Math.abs(s.z - pz) < Math.abs(samples[best].z - pz)) best = i })
  return best
}

test.describe('the overworld, photographed', () => {
  test('the walk, at eye level', async ({ page }) => {
    test.setTimeout(240_000)
    await onPath(page, sampleNear(17))
    await shot(page, 'land-01-spawn')
    await onPath(page, sampleNear(17), { turn: -1.1 })
    await shot(page, 'land-02-spawn-to-the-lake')
    await onPath(page, sampleNear(60))
    await shot(page, 'land-03-omaha-bend')
    await onPath(page, sampleNear(100))
    await shot(page, 'land-04-forest')
    await onPath(page, sampleNear(140))
    await shot(page, 'land-05-bamboo')
    await onPath(page, sampleNear(170))
    await shot(page, 'land-06-to-the-bridge')
    await onPath(page, sampleNear(222))
    await shot(page, 'land-07-after-the-river')
    await onPath(page, sampleNear(262))
    await shot(page, 'land-08-taiga')
    await onPath(page, sampleNear(300))
    await shot(page, 'land-09-hills')
    await onPath(page, sampleNear(340), { pitch: -0.1 })
    await shot(page, 'land-10-the-range')
  })

  test('every chapter, in context, from the path', async ({ page }) => {
    test.setTimeout(300_000)
    /* Two frames per chapter: on the path a little before its spur leaves,
     * looking at the middle of the plot, at eye level; and the same spot
     * twelve blocks up, so the chapter is seen in the land around it. */
    for (const { chapter: c, from } of spurs) {
      const i = Math.max(0, from - 40)
      const s = samples[i]
      const cx = (c.x0 + c.x1) / 2, cz = (c.z0 + c.z1) / 2
      const heading = Math.atan2(cx - s.x, cz - s.z)
      const y = SURFACE_Y + groundAt(s.x, s.z) + 1
      await page.evaluate(() => {
        const noa = window.noa
        noa.ents.getPhysics(noa.playerEntity).body.gravityMultiplier = 1
      })
      await teleport(page, s.x - LAND_ORIGIN_X + 0.5, y, s.z - LAND_ORIGIN_Z + 0.5)
      await waitTicks(page, 40)
      await look(page, { heading, pitch: -0.05 })
      await waitFrames(page, 20)
      await shot(page, `land-30-${c.id}-from-the-path`)
      await page.evaluate(() => {
        const noa = window.noa
        noa.ents.getPhysics(noa.playerEntity).body.gravityMultiplier = 0
      })
      await teleport(page, s.x - LAND_ORIGIN_X + 0.5, y + 12, s.z - LAND_ORIGIN_Z + 0.5)
      await waitTicks(page, 30)
      await look(page, { heading, pitch: 0.25 })
      await waitFrames(page, 20)
      await shot(page, `land-31-${c.id}-in-context`)
    }
    await page.evaluate(() => {
      const noa = window.noa
      noa.ents.getPhysics(noa.playerEntity).body.gravityMultiplier = 1
    })
  })

  test('the woods, from inside', async ({ page }) => {
    test.setTimeout(180_000)
    /* Off the path, among the trees: the dark forest west of the walk, the
     * birch wood by the lake, the taiga. */
    for (const [name, px, pz, h] of [
      ['land-11-dark-forest', 52, 110, Math.PI / 2],
      ['land-12-birch-wood', 238, 56, Math.PI],
      ['land-13-taiga', 150, 268, 0],
      ['land-14-bamboo-jungle', 112, 160, Math.PI / 2],
    ]) {
      const y = SURFACE_Y + groundAt(px, pz) + 1
      await teleport(page, px - LAND_ORIGIN_X + 0.5, y + 3, pz - LAND_ORIGIN_Z + 0.5)
      await waitTicks(page, 40)
      await look(page, { heading: h, pitch: 0.05 })
      await waitFrames(page, 20)
      await shot(page, name)
    }
  })

  test('the land from the air', async ({ page }) => {
    test.setTimeout(240_000)
    await useGamemode(page, 'creative')
    await doubleTapFly(page)
    await hover(page, 144, 4, 30, 0, 0.4)
    await shot(page, 'land-20-air-spawn-south')
    await hover(page, 150, 150, 34, 0, 0.5)
    await shot(page, 'land-21-air-river')
    await hover(page, 150, 250, 34, 0, 0.45)
    await shot(page, 'land-22-air-south')
    await hover(page, 160, 300, 24, -0.8, 0.12)
    await shot(page, 'land-23-air-range')
    await hover(page, 150, 160, 50, 0, 1.5)
    await shot(page, 'land-24-air-down')
    await page.evaluate(() => {
      const noa = window.noa
      noa.ents.getPhysics(noa.playerEntity).body.gravityMultiplier = 1
    })
    expect(await page.evaluate(() => window.game.terrain.width)).toBe(288)
  })
})
