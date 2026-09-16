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
 * Minecraft's face shading is FIXED. `ClientLevel.getShade(Direction, boolean)`
 * in 1.21 gives every face a constant multiplier -- UP 1.0, NORTH/SOUTH 0.8,
 * WEST/EAST 0.6, DOWN 0.5 -- which scales the light level. The sun does not
 * rotate it. So "should be dynamic" would take it further from vanilla, and
 * the tests below assert the opposite: that the table does NOT move when the
 * clock does.
 *
 * WHAT CHANGED SINCE THIS SPEC WAS WRITTEN, and it is the whole point of the
 * rewrite. The first fix pointed the scene's one DirectionalLight straight
 * down, because `max(0, dot(n, -L))` is antisymmetric and could not give +X
 * and -X the same number any other way. That killed the reported asymmetry
 * and cost the rest of the table: one light plus one ambient can say two
 * numbers, and vanilla's table has five. blockLight.js now applies the real
 * table in the terrain fragment shader off `vNormalW`, so this spec asserts
 * the table, not the light -- N/S and E/W are DIFFERENT now, and a spec that
 * demanded all four sides match would be demanding the old bug back.
 *
 * MEASURED ON THE GPU, not in JavaScript. The old version of this file read
 * `noa.rendering.light` and did the Lambert arithmetic in the page, which was
 * honest while the light was what shaded terrain and is a lie now -- terrain
 * reads no Babylon light at all. `gl.readPixels` inside `onAfterRenderObservable`
 * is the only thing here that cannot be fooled by a uniform that never
 * reached the shader, and one did: `uDaylight` sat at 0 through two rounds of
 * a passing JavaScript check. See test/67-held-item-light.spec.js for the
 * same lesson learned the same way.
 */
/*
 * Vanilla's table, duplicated here rather than imported from blockLight.js on
 * purpose, the same way helpers/world.js duplicates the block ids: if someone
 * retunes the constants, this should fail rather than quietly follow along.
 */
const MC_NS = 0.8    // north and south, the Z pair
const MC_EW = 0.6    // east and west, the X pair

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
 * Mean luminance of a centre crop of the frame, 0..1, READ OFF THE GPU.
 *
 * `gl.readPixels` inside `onAfterRenderObservable`, while the back buffer is
 * still bound. The canvas is not `preserveDrawingBuffer`, so reading it a
 * frame later returns black -- and `page.screenshot`, which the old version of
 * this helper used, goes through the compositor rather than the drawing
 * buffer. Both would work here; only this one is the same measurement the
 * shader made.
 *
 * `n` comes back with it so a caller can prove the sample is not empty. A
 * probe that reads zero pixels and then asserts about their mean passes
 * vacuously, which has happened in this repo before.
 */
async function faceBrightness(page) {
  const s = await page.evaluate((crop) => new Promise((resolve) => {
    const scene = window.noa.rendering.getScene()
    const gl = scene.getEngine()._gl
    scene.onAfterRenderObservable.addOnce(() => {
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight
      const x = (W - crop) >> 1, y = (H - crop) >> 1
      const buf = new Uint8Array(crop * crop * 4)
      gl.readPixels(x, y, crop, crop, gl.RGBA, gl.UNSIGNED_BYTE, buf)
      let sum = 0, n = 0
      for (let i = 0; i < buf.length; i += 4) {
        sum += (buf[i] + buf[i + 1] + buf[i + 2]) / 3
        n++
      }
      resolve({ mean: sum / n / 255, n })
    })
  }), CROP)
  expect(s.n, 'read no pixels at all -- this measurement proved nothing')
    .toBe(CROP * CROP)
  return s.mean
}

/** Stand on each side of the column in turn and photograph the face. */
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

/*
 * NOT MEASURED HERE: the UP 1.0 and DOWN 0.5 entries.
 *
 * Both were attempted and both were cut rather than shipped wrong. Pointing
 * the camera straight down at the platform and straight up at a floating
 * block gave top 0.2346 and underside 0.2745 -- the underside BRIGHTER than
 * the top, which the shader cannot be doing, so the views were not seeing
 * what they were named for. Rather than tune a camera until the number came
 * out right, the two entries are left uncovered and said so: the four side
 * faces below are the ones report #6 was about, and they are the ones a
 * symmetric table could not previously express.
 *
 * Whoever picks this up: the pitch sign and what fills a straight-down crop
 * in first person are the two things to establish first, with a screenshot,
 * before writing another assertion.
 */

test.describe('block face shading', () => {
  /*
   * ONE BUILD, SHARED. Every test below needs the same platform and column,
   * and the fixture hands out one booted world, so building it per test would
   * be the same nine hundred setBlock calls four times over.
   */
  test.beforeEach(async ({ page, terrain }) => {
    await terrain.keep([CX - 4, BASE, CZ - 4], [CX + 4, BASE + 5, CZ + 4])
    await build(page)
  })

  test('opposite faces of a block shade identically', async ({ page }) => {
    /*
     * THE REPORTED BUG, and the only assertion in this file that was already
     * here. With the old lightVector [0.6, -1, -0.4] one vertical face came
     * out near the brightness of the top and the one facing it sat on ambient
     * alone. A table cannot do that: east and west are the same entry.
     */
    const s = await sampleFaces(page, NOON)
    const rel = (a, b) => Math.abs(a - b) / Math.max(a, b)
    expect(rel(s.plusX, s.minusX),
      `+X ${s.plusX.toFixed(4)} vs -X ${s.minusX.toFixed(4)}`).toBeLessThan(0.04)
    expect(rel(s.plusZ, s.minusZ),
      `+Z ${s.plusZ.toFixed(4)} vs -Z ${s.minusZ.toFixed(4)}`).toBeLessThan(0.04)
  })

  test('the four sides are TWO values, not one, and they are vanillas',
    async ({ page }) => {
      /*
       * The half the old fix could not buy. N/S 0.8 and E/W 0.6 are different
       * numbers in Minecraft and were the same number here, because one
       * directional light plus one ambient term can express exactly two
       * brightnesses and the top face had already spent both.
       */
      const s = await sampleFaces(page, NOON)
      const nsOverEw = ((s.plusZ + s.minusZ) / (s.plusX + s.minusX))
      console.log(`[table] N/S ${((s.plusZ + s.minusZ) / 2).toFixed(4)}`
        + ` E/W ${((s.plusX + s.minusX) / 2).toFixed(4)}`
        + ` ratio ${nsOverEw.toFixed(3)} (vanilla ${(MC_NS / MC_EW).toFixed(3)})`)
      expect(nsOverEw, `N/S over E/W ${nsOverEw.toFixed(3)}`)
        .toBeCloseTo(MC_NS / MC_EW, 1)
    })

  test('the shading table is fixed and does not rotate with the sun',
    async ({ page }) => {
      /*
       * Vanilla's multipliers never move. If the light direction followed the
       * sun, +X and -X would swap places across the day -- and the RATIOS
       * would move even if the absolute numbers were allowed to.
       */
      const morning = await sampleFaces(page, 1000)
      const noon = await sampleFaces(page, NOON)
      const evening = await sampleFaces(page, 11000)
      for (const [label, s] of [['morning', morning], ['noon', noon], ['evening', evening]]) {
        const r = s.plusX / s.minusX
        expect(r, `${label} +X/-X ${r.toFixed(3)}`).toBeCloseTo(1, 1)
        const q = s.plusZ / s.minusZ
        expect(q, `${label} +Z/-Z ${q.toFixed(3)}`).toBeCloseTo(1, 1)
      }
    })

  test('the whole table darkens together at night, keeping its ratios',
    async ({ page }) => {
      const noon = await sampleFaces(page, NOON, 'face-shading-noon')
      const night = await sampleFaces(page, MIDNIGHT, 'face-shading-midnight')
      const mean = (s) => Object.values(s).reduce((a, b) => a + b, 0) / 4
      expect(mean(night), `noon ${mean(noon).toFixed(4)} night ${mean(night).toFixed(4)}`)
        .toBeLessThan(mean(noon) * 0.6)
      // The ordering survives the sun going down, which is the other half of
      // "even at night" in the report.
      const ratio = (s) => (s.plusZ + s.minusZ) / (s.plusX + s.minusX)
      expect(ratio(night), `noon ratio ${ratio(noon).toFixed(3)}`
        + ` night ratio ${ratio(night).toFixed(3)}`).toBeCloseTo(ratio(noon), 1)
    })
})
