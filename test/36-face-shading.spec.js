import { test, expect } from './fixtures.js'
import {
  waitTicks, teleport, look, settleOnGround, HEADING, SURFACE_Y, ID,
} from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * FACE SHADING -- does a block's east side look the same as its west side.
 *
 * Reported as "the east edge of blocks has weirdly more lighting than the
 * rest, even at night. Isnt dynamic but should be I guess." The premise is
 * wrong twice over and the spec is written to say so in numbers.
 *
 * Minecraft's face shading is FIXED. BlockModelRenderer.EnumNeighborInfo in
 * the decompiled client gives every face a constant multiplier -- UP 1.0,
 * NORTH/SOUTH 0.8, EAST/WEST 0.6, DOWN 0.5 -- which scales the light level.
 * The sun does not rotate it. So "should be dynamic" would take it further
 * from vanilla, and the test below asserts the opposite: that the table does
 * NOT move when the clock does.
 *
 * What IS wrong is that vanilla's table is symmetric and a tilted directional
 * light cannot be. Duplicated here rather than imported from sky.js on
 * purpose, the same way helpers/world.js duplicates the block ids: if someone
 * retunes the constants, this should fail rather than quietly follow along.
 */
const MC_UP = 1.0
const MC_SIDE = 0.7 // the mean of vanilla's N/S 0.8 and E/W 0.6

/** Where the test build goes -- flat stone platform, one free-standing column. */
const CX = 6
const CZ = 6
const BASE = SURFACE_Y // platform top surface sits at BASE, column on top of it
const EYE = BASE + 1.62 // roughly noa's eye height above the platform

/* Far enough that a 1x1 face fills well past the sampled crop, close enough
 * that nothing else can get into it. */
const DIST = 2.5
const CROP = 64

const NOON = 6000
const MIDNIGHT = 18000

/** Stand `DIST` away on one side of the column and face it. */
const VIEWS = {
  // +X is west in this engine; see the HEADING comment in helpers/world.js.
  plusX: { at: [CX + 0.5 + DIST, CZ + 0.5], heading: HEADING.eastMinusX },
  minusX: { at: [CX + 0.5 - DIST, CZ + 0.5], heading: HEADING.westPlusX },
  plusZ: { at: [CX + 0.5, CZ + 0.5 + DIST], heading: HEADING.northMinusZ },
  minusZ: { at: [CX + 0.5, CZ + 0.5 - DIST], heading: HEADING.southPlusZ },
}

async function build(page) {
  await page.evaluate(([cx, cz, y, stone, air]) => {
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        window.noa.setBlock(stone, cx + dx, y, cz + dz)
        // Clear the headroom so nothing overhangs the column and darkens one
        // side with ambient occlusion the other side does not get.
        for (let dy = 1; dy <= 5; dy++) window.noa.setBlock(air, cx + dx, y + dy, cz + dz)
      }
    }
    for (let dy = 1; dy <= 3; dy++) window.noa.setBlock(stone, cx, y + dy, cz)
  }, [CX, CZ, BASE, ID.stone, ID.air])
  await waitTicks(page, 4)
}

/**
 * Mean luminance of a centre crop of the view, 0..1.
 *
 * Playwright hands back a PNG buffer and Node has no decoder without a
 * dependency, so the buffer goes BACK into the page as a data URL and a 2D
 * canvas does the decoding. Cheaper than adding pngjs for one number.
 */
async function faceBrightness(page) {
  const { width, height } = page.viewportSize()
  const buf = await page.screenshot({
    clip: { x: width / 2 - CROP / 2, y: height / 2 - CROP / 2, width: CROP, height: CROP },
  })
  return page.evaluate((url) => new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const d = ctx.getImageData(0, 0, c.width, c.height).data
      let sum = 0
      for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3
      resolve(sum / (d.length / 4) / 255)
    }
    img.src = url
  }), `data:image/png;base64,${buf.toString('base64')}`)
}

async function sampleFaces(page, timeOfDay, tag) {
  await page.evaluate((t) => window.game.sky.setTime(t), timeOfDay)
  await waitTicks(page, 3)
  const out = {}
  for (const [name, view] of Object.entries(VIEWS)) {
    await teleport(page, view.at[0], BASE + 1, view.at[1])
    await settleOnGround(page)
    await look(page, { heading: view.heading, pitch: 0 })
    await waitTicks(page, 2)
    out[name] = await faceBrightness(page)
    if (tag) await shot(page, `${tag}-${name}`)
  }
  return out
}

/** The shade noa's one directional light plus the scene ambient gives a face. */
async function shadeTable(page) {
  return page.evaluate(() => {
    const scene = window.noa.rendering.getScene()
    const l = window.noa.rendering.light
    const n = Math.hypot(l.direction.x, l.direction.y, l.direction.z) || 1
    const d = [l.direction.x / n, l.direction.y / n, l.direction.z / n]
    const amb = scene.ambientColor.r
    const face = (nx, ny, nz) => Math.min(1,
      Math.max(0, -(nx * d[0] + ny * d[1] + nz * d[2])) * l.intensity + amb)
    return {
      level: l.intensity,
      ambient: amb,
      up: face(0, 1, 0),
      down: face(0, -1, 0),
      plusX: face(1, 0, 0),
      minusX: face(-1, 0, 0),
      plusZ: face(0, 0, 1),
      minusZ: face(0, 0, -1),
    }
  })
}

test.describe('block face shading', () => {
  test('opposite faces of a block shade identically', async ({ page }) => {
    const t = await shadeTable(page)
    // THE REPORTED BUG. With the old lightVector [0.6, -1, -0.4] one vertical
    // face came out near the brightness of the top and the one facing it sat
    // on ambient alone -- a 2:1 split across a block that vanilla renders as
    // two identical 0.6 faces.
    expect(t.plusX, `+X ${t.plusX.toFixed(3)} vs -X ${t.minusX.toFixed(3)}`)
      .toBeCloseTo(t.minusX, 5)
    expect(t.plusZ, `+Z ${t.plusZ.toFixed(3)} vs -Z ${t.minusZ.toFixed(3)}`)
      .toBeCloseTo(t.minusZ, 5)
    // And all four sides agree, which is what "no bright edge" actually means.
    expect(t.plusX).toBeCloseTo(t.plusZ, 5)
  })

  test('the side faces sit at vanillas multiplier relative to the top',
    async ({ page }) => {
      await page.evaluate(() => window.game.sky.setTime(6000))
      await waitTicks(page, 3)
      const t = await shadeTable(page)
      expect(t.up, `top ${t.up.toFixed(3)}`).toBeCloseTo(MC_UP, 2)
      expect(t.plusX / t.up, `side/top ${(t.plusX / t.up).toFixed(3)}`)
        .toBeCloseTo(MC_SIDE, 2)
    })

  test('the shading table is fixed and does not rotate with the sun',
    async ({ page }) => {
      const at = async (time) => {
        await page.evaluate((x) => window.game.sky.setTime(x), time)
        await waitTicks(page, 3)
        return shadeTable(page)
      }
      const morning = await at(1000)
      const noon = await at(NOON)
      const evening = await at(11000)
      // Vanilla's multipliers never move. If the light direction followed the
      // sun, +X and -X would swap places across the day.
      for (const t of [morning, noon, evening]) {
        expect(t.plusX).toBeCloseTo(t.minusX, 5)
        expect(t.plusZ).toBeCloseTo(t.minusX, 5)
      }
    })

  test('the whole table darkens together at night, keeping its ratios',
    async ({ page }) => {
      const at = async (time) => {
        await page.evaluate((x) => window.game.sky.setTime(x), time)
        await waitTicks(page, 3)
        return shadeTable(page)
      }
      const noon = await at(NOON)
      const night = await at(MIDNIGHT)
      expect(night.plusX, 'sides did not darken at night').toBeLessThan(noon.plusX * 0.5)
      expect(night.up, 'the top did not darken at night').toBeLessThan(noon.up * 0.6)
      // The ordering survives: top still brightest, sides still equal.
      expect(night.up).toBeGreaterThan(night.plusX)
      expect(night.plusX).toBeCloseTo(night.minusX, 5)
    })

  test('a real rendered wall has four matching side faces, noon and midnight',
    async ({ page, terrain }) => {
      await terrain.keep([CX - 4, BASE, CZ - 4], [CX + 4, BASE + 5, CZ + 4])
      await build(page)

      const noon = await sampleFaces(page, NOON, 'face-shading-noon')
      const night = await sampleFaces(page, MIDNIGHT, 'face-shading-midnight')

      for (const [label, s] of [['noon', noon], ['midnight', night]]) {
        const vals = Object.values(s)
        const lo = Math.min(...vals)
        const hi = Math.max(...vals)
        const spread = (hi - lo) / hi
        // Pixel measurement of a textured face, so this is a tolerance, not an
        // equality: stone is noisy and the four views see different bits of it.
        // The old build put this well past 0.3 at noon.
        expect(spread,
          `${label} face brightness ${JSON.stringify(s)} spread ${spread.toFixed(3)}`)
          .toBeLessThan(0.12)
      }
      // And the whole wall is darker after dark, which is the other half of
      // "even at night".
      const mean = (s) => Object.values(s).reduce((a, b) => a + b, 0) / 4
      expect(mean(night), `noon ${mean(noon).toFixed(3)} night ${mean(night).toFixed(3)}`)
        .toBeLessThan(mean(noon) * 0.6)
    })
})
