import { test, expect } from './fixtures.js'
import {
  waitTicks, teleport, settleOnGround, look, measureFps, HEADING, SURFACE_Y, ID,
} from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * WALK IN A CIRCLE AROUND A PERSON AND HIS FACE SHOULD CHANGE BRIGHTNESS.
 *
 * Reported from play: "I notice when I walk in circles around Evan, his face
 * is the same level of dimness. Then when I fly above him, his face is
 * bright. It is day time in the world."
 *
 * Both halves were one line -- the scene's single DirectionalLight pointed
 * straight down, so `max(0, dot(n, up))` is exactly ZERO for any vertical
 * face, at any yaw. His face was lit by the emissive floor alone, which is a
 * constant, so circling him could not change it. Tilt his head up to track
 * you and the normal swings to +y and catches the whole diffuse term -- hence
 * bright from above.
 *
 * Vanilla lights entities with TWO fixed lights instead, from
 * `Lighting.java`'s DIFFUSE_LIGHT_0 (0.2, 1.0, -0.7) and DIFFUSE_LIGHT_1
 * (-0.2, 1.0, 0.7), normalized, summed by `light.glsl` as
 * `min(1, (d0 + d1) * 0.6 + 0.4)`. Because those two mirror about Y, a
 * horizontal normal gets `|0.2*nx - 0.7*nz| / |v|`, which is never zero:
 * 0.568 for a face pointing along Z and 0.162 for one pointing along X.
 *
 * SO THE SHAPE OF THE ANSWER IS NOT "brightness varies smoothly with yaw". It
 * is TWO values, a Z pair and an X pair, and the two differ by about 1.5x in
 * final brightness. Opposite directions still match, because the rig is
 * mirror-symmetric -- which is the same property that keeps report #6 fixed.
 *
 * MEASURED ON THE GPU. `gl.readPixels` inside `onAfterRenderObservable`, while
 * the back buffer is still bound; the canvas is not `preserveDrawingBuffer`,
 * so a screenshot a frame later comes back black. Reading `emissiveColor` in
 * JavaScript is what this file must NOT do: entity materials are frozen by
 * noa's performancePriority and a correct JS number can be absent from the
 * screen, which is how 56d40d2 and report #6 both got shipped.
 */

const NOON = 6000

/** Close enough that his HEAD fills the crop, far enough to see all of it. */
const DIST = 2.2
const CROP = 48

/*
 * Where his face is on screen, as a fraction of frame height from the BOTTOM,
 * which is the direction gl.readPixels counts in.
 *
 * Not the centre. The crosshair at pitch 0.12 and 2.2 blocks lands on his
 * shirt, which in this skin is very nearly black -- the first run of this file
 * read 0.0417 to 0.0488 across all four views and could not tell 1.49x from
 * noise, because 1.49 times almost nothing is almost nothing. The report is
 * about his FACE, so the crop moved to his face.
 */
const FACE_Y = 0.63

/** Vanilla's rig, retyped rather than imported, so a retune fails here. */
const D0 = [0.2, 1.0, -0.7]
const D1 = [-0.2, 1.0, 0.7]
const FLOOR = 0.4
const POWER = 0.6

const unit = (v) => {
  const n = Math.hypot(v[0], v[1], v[2])
  return [v[0] / n, v[1] / n, v[2] / n]
}
/** What light.glsl gives a face with this world-space normal. */
const mixLight = (n) => {
  const dot = (a) => Math.max(0, a[0] * n[0] + a[1] * n[1] + a[2] * n[2])
  return Math.min(1, (dot(unit(D0)) + dot(unit(D1))) * POWER + FLOOR)
}

/** The four places to stand, and which way Evan's front faces from each. */
const VIEWS = {
  // +X is west in this engine; see the HEADING comment in helpers/world.js.
  plusX: { off: [DIST, 0], heading: HEADING.eastMinusX, normal: [1, 0, 0] },
  minusX: { off: [-DIST, 0], heading: HEADING.westPlusX, normal: [-1, 0, 0] },
  plusZ: { off: [0, DIST], heading: HEADING.northMinusZ, normal: [0, 0, 1] },
  minusZ: { off: [0, -DIST], heading: HEADING.southPlusZ, normal: [0, 0, -1] },
}

/**
 * Mean luminance of a crop over Evan's face, 0..1, off the GPU.
 *
 * `n` comes back so the caller can prove the sample is not empty -- a probe
 * that reads zero pixels and then asserts about their mean passes vacuously,
 * which has happened in this repo before.
 */
async function faceBrightness(page) {
  const s = await page.evaluate(([crop, faceY]) => new Promise((resolve) => {
    const scene = window.noa.rendering.getScene()
    const gl = scene.getEngine()._gl
    scene.onAfterRenderObservable.addOnce(() => {
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight
      const buf = new Uint8Array(crop * crop * 4)
      gl.readPixels((W - crop) >> 1, Math.round(H * faceY) - (crop >> 1),
        crop, crop, gl.RGBA, gl.UNSIGNED_BYTE, buf)
      let sum = 0, n = 0
      for (let i = 0; i < buf.length; i += 4) {
        sum += (buf[i] + buf[i + 1] + buf[i + 2]) / 3
        n++
      }
      resolve({ mean: sum / n / 255, n })
    })
  }), [CROP, FACE_Y])
  expect(s.n, 'read no pixels at all -- this measurement proved nothing')
    .toBe(CROP * CROP)
  return s.mean
}

/** Stand on each side of Evan in turn and photograph the side facing you. */
async function circle(page, tag) {
  const at = await page.evaluate(() => [...window.game.aiEvan.position])
  const out = {}
  for (const [name, v] of Object.entries(VIEWS)) {
    await teleport(page, at[0] + v.off[0], at[1] + 1, at[2] + v.off[1])
    await settleOnGround(page)
    await look(page, { heading: v.heading, pitch: 0.12 })
    await waitTicks(page, 3)
    out[name] = await faceBrightness(page)
    if (tag) await shot(page, `${tag}-${name}`)
  }
  return out
}

test.describe('an entity is shaded by two fixed lights, not one', () => {
  test.beforeEach(async ({ page }) => {
    await page.evaluate((t) => window.game.sky.setTime(t), NOON)
    await waitTicks(page, 3)
  })

  test('the rig exists, is two lights, and points where vanilla points',
    async ({ page }) => {
      /*
       * Structure, not pixels. It is the one thing a pixel test cannot say --
       * two lights at HALF intensity each would photograph identically to one
       * at full and would be a different model.
       */
      const rig = await page.evaluate(() => {
        const scene = window.noa.rendering.getScene()
        return scene.lights
          .filter((l) => /^entity-rig-/.test(l.name))
          .map((l) => ({
            name: l.name,
            dir: [l.direction.x, l.direction.y, l.direction.z],
            intensity: l.intensity,
            included: l.includedOnlyMeshes.length,
          }))
      })
      expect(rig.length, `lights found: ${JSON.stringify(rig)}`).toBe(2)
      // Babylon's `direction` is the way light TRAVELS; Minecraft's vector
      // points at the source, so these are negated.
      for (const [i, want] of [unit(D0), unit(D1)].entries()) {
        for (const [c, axis] of ['x', 'y', 'z'].entries()) {
          expect(rig[i].dir[c], `${rig[i].name}.${axis}`).toBeCloseTo(-want[c], 4)
        }
      }
      // Both carry the FULL level: Babylon sums ndl*intensity over lights, so
      // halving them would halve vanilla's MINECRAFT_LIGHT_POWER with it.
      expect(rig[0].intensity).toBeCloseTo(rig[1].intensity, 5)
      expect(rig[0].included, 'the rig lights nothing -- no entity mesh was'
        + ' ever adopted, so every pixel test below is measuring the floor')
        .toBeGreaterThan(0)
    })

  test('no entity mesh is left on the sun light as well', async ({ page }) => {
    /*
     * Two rigs on one model would double the diffuse. noa's light keeps the
     * non-cube meshes and must keep nothing else.
     */
    const n = await page.evaluate(() => {
      const scene = window.noa.rendering.getScene()
      const rig = scene.lights.filter((l) => /^entity-rig-/.test(l.name))
      const sun = scene.lights.find((l) => l.name === 'light')
      const onRig = new Set(rig.flatMap((l) => l.includedOnlyMeshes))
      const excluded = new Set(sun.excludedMeshes)
      return { rig: onRig.size, alsoOnSun: [...onRig].filter((m) => !excluded.has(m)).length }
    })
    expect(n.rig, 'no meshes on the rig at all').toBeGreaterThan(0)
    expect(n.alsoOnSun, `${n.alsoOnSun} of ${n.rig} rig meshes still take the`
      + ' sun light too').toBe(0)
  })

  test('walking in a circle around Evan changes how brightly he is lit',
    async ({ page }) => {
      const s = await circle(page, 'entity-rig-noon')
      const label = Object.entries(s)
        .map(([k, v]) => `${k} ${v.toFixed(4)}`).join(', ')
      console.log(`[circle] ${label}`)

      const zPair = (s.plusZ + s.minusZ) / 2
      const xPair = (s.plusX + s.minusX) / 2
      /*
       * THE REPORT, in one number. Under the old single vertical light every
       * one of these four was the emissive floor and this ratio was 1.000.
       */
      expect(zPair / xPair, `Z-facing ${zPair.toFixed(4)} vs X-facing`
        + ` ${xPair.toFixed(4)}, ratio ${(zPair / xPair).toFixed(3)}`)
        .toBeGreaterThan(1.12)
    })

  test('opposite sides of the circle still match, which is report #6 again',
    async ({ page }) => {
      /*
       * The rig's two vectors mirror about Y, so the accumulation is even in
       * both nx and nz. Walking to the far side of him must not change him.
       * A rig that did not have this property would reintroduce exactly the
       * "one side of every block is brighter" bug, on people.
       */
      const s = await circle(page)
      const rel = (a, b) => Math.abs(a - b) / Math.max(a, b)
      expect(rel(s.plusX, s.minusX), `+X ${s.plusX.toFixed(4)} vs -X`
        + ` ${s.minusX.toFixed(4)}`).toBeLessThan(0.06)
      expect(rel(s.plusZ, s.minusZ), `+Z ${s.plusZ.toFixed(4)} vs -Z`
        + ` ${s.minusZ.toFixed(4)}`).toBeLessThan(0.06)
    })

  test('the arithmetic this rig is supposed to implement', () => {
    /*
     * Pure, no browser. The pixel tests above can only say "these differ";
     * this says by how much they are MEANT to differ, and it is the number
     * that makes 1.12 a floor rather than a guess.
     *
     * A face pointing along Z gets 0.568 of the light power, one pointing
     * along X gets 0.162, and after `* 0.6 + 0.4` that is 0.7395 against
     * 0.4970 -- a ratio of 1.488 before the texture and anything else in the
     * crop pull it toward 1.
     */
    expect(mixLight([0, 0, 1])).toBeCloseTo(0.7395, 4)
    expect(mixLight([0, 0, -1])).toBeCloseTo(0.7395, 4)
    expect(mixLight([1, 0, 0])).toBeCloseTo(0.4970, 4)
    expect(mixLight([-1, 0, 0])).toBeCloseTo(0.4970, 4)
    expect(mixLight([0, 0, 1]) / mixLight([1, 0, 0])).toBeCloseTo(1.488, 3)
    // And the thing the old single light could not do: a vertical face is
    // never left on the floor alone.
    expect(mixLight([1, 0, 0])).toBeGreaterThan(FLOOR)
    // Straight up is still the brightest, which is why flying above him
    // looked right even when circling him did not.
    expect(mixLight([0, 1, 0])).toBeGreaterThan(mixLight([0, 0, 1]))
  })

  test('the payoff, in six frames: Evan from every side, from above, and the'
    + ' things that did NOT change', async ({ page, terrain }) => {
    /*
     * The four circle frames are taken by the test above; these are the two
     * halves of the report the numbers cannot show, plus the three surfaces
     * this change could plausibly have broken and had better not have.
     */
    const at = await page.evaluate(() => [...window.game.aiEvan.position])

    // FROM ABOVE, which is the half that already looked right and has to
    // still look right: straight up is the brightest normal in the rig.
    await teleport(page, at[0] + 0.6, at[1] + 5, at[2] + 0.6)
    await look(page, { heading: HEADING.northMinusZ, pitch: 1.2 })
    await waitTicks(page, 3)
    await shot(page, 'entity-rig-from-above')

    /*
     * TERRAIN, all four side orientations in one frame plus the top, which is
     * the other shading system. A free-standing column two blocks tall, seen
     * from a corner so two of its sides and the ground are all in frame at
     * once -- the N/S pair and the E/W pair should read as different greys
     * and each pair should agree with itself.
     */
    const CX = 30, CZ = 30, BASE = SURFACE_Y
    await terrain.keep([CX - 4, BASE, CZ - 4], [CX + 4, BASE + 6, CZ + 4])
    await page.evaluate(([cx, cz, y, stone, air]) => {
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
        window.noa.setBlock(stone, cx + dx, y, cz + dz)
        for (let dy = 1; dy <= 4; dy++) window.noa.setBlock(air, cx + dx, y + dy, cz + dz)
      }
      for (let dy = 1; dy <= 2; dy++) window.noa.setBlock(stone, cx, y + dy, cz)
    }, [CX, CZ, BASE, ID.stone, ID.air])
    await waitTicks(page, 5)
    await teleport(page, CX + 3.2, BASE + 1, CZ + 3.2)
    await settleOnGround(page)
    await look(page, { heading: HEADING.northMinusZ + Math.PI / 4, pitch: 0.12 })
    await waitTicks(page, 3)
    await shot(page, 'entity-rig-terrain-faces')

    /*
     * NON-CUBE MESHES, which are the ones still lit by noa's original vertical
     * light and which this change therefore must NOT have altered. A slab and
     * a torch beside each other; if repointing anything had leaked onto them,
     * the slab's four sides would stop agreeing.
     */
    await page.evaluate(async ([cx, cz, y]) => {
      // Ids come from blocks.js rather than from helpers/world.js's short
      // table, which only carries the full cubes. 17-non-cube does the same.
      const { BLOCK_TYPES } = await import('/src/blocks.js')
      const id = (k) => BLOCK_TYPES.find((d) => d.key === k)?.id
      const slab = id('stone_slab') ?? id('oak_slab') ?? id('cobblestone_slab')
      const torch = id('torch')
      if (slab) window.noa.setBlock(slab, cx + 2, y + 1, cz)
      if (torch) window.noa.setBlock(torch, cx - 2, y + 1, cz)
    }, [CX, CZ, BASE])
    await waitTicks(page, 5)
    await teleport(page, CX + 0.5, BASE + 1, CZ + 3.2)
    await settleOnGround(page)
    await look(page, { heading: HEADING.northMinusZ, pitch: 0.28 })
    await waitTicks(page, 3)
    await shot(page, 'entity-rig-noncube')
  })

  test('two more lights do not cost a frame', async ({ page }) => {
    /*
     * The budget. Two DirectionalLights restricted to a handful of entity
     * meshes add two iterations of Babylon's light loop to those meshes and
     * NOTHING to terrain, which is excluded from both and which is where all
     * the pixels are. Sky light cost 30.0 -> 29.4 on this machine; this has
     * to be cheaper than that.
     */
    const fps = await measureFps(page, 1500)
    console.log(`[budget] fps with the rig: ${fps.toFixed(1)}`)
    expect(fps, `fps ${fps.toFixed(1)}`).toBeGreaterThan(20)
  })
})
