import { test, expect } from './fixtures.js'
import { waitTicks } from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * Entities respond to the clock.
 *
 * THE BUG THIS FILE EXISTS FOR: the player model, the NPC, the first-person
 * arm and the held item were all pinned to a constant emissive floor -- 0.45,
 * typed at three different construction sites. Babylon ADDS emissive rather
 * than modulating it, so that constant was brightness the sky's light could
 * never take away. At midnight the terrain went dark and every model in the
 * world stayed lit, which is what the owner saw.
 *
 * A test that only checks "the material exists" passes on that bug, and so
 * does one that only checks "emissive is not zero". The assertion has to be
 * that the number MOVED, and that it moved with the same `level` the sun's
 * light runs on -- because the failure mode being ruled out is precisely two
 * brightness sources that disagree.
 *
 * NO HARDCODED WORLD COORDINATES in here on purpose. Materials are found
 * through the scene and through window.game, and the screenshots are taken
 * from wherever spawn happens to be, so the island being remapped underneath
 * this file cannot break it.
 */

const NOON = 6000
const MIDNIGHT = 18000

/**
 * Every entity material in the scene, plus the light level driving them.
 *
 * Read from the SCENE rather than from a list of known materials, so an
 * entity added later is covered by this file without anyone remembering to
 * come back -- which is the same reason the emissive number moved into
 * entityLight.js in the first place.
 */
const sample = (page) => page.evaluate(() => {
  const scene = window.noa.rendering.getScene()
  const named = (m) => ({ name: m.name, e: m.emissiveColor.r, a: m.ambientColor.r })
  const game = window.game
  const mats = [
    game.skinMaterial,               // the player, and the first-person arm
    game.held.item.material,         // the held item viewmodel
    // Every NPC builds its own skin material, named `skin-<id>`.
    ...scene.materials.filter((m) => /^skin-/.test(m.name)),
  ].filter(Boolean)
  return {
    light: scene.lights.find((l) => l.name === 'light')?.intensity ?? null,
    mats: mats.map(named),
  }
})

const atTime = async (page, t) => {
  await page.evaluate((v) => window.game.sky.setTime(v), t)
  await waitTicks(page, 3)
  return sample(page)
}

test.describe('entity lighting follows the day/night cycle', () => {
  test('every entity material dims from noon to midnight, with the sun',
    async ({ page }) => {
      const noon = await atTime(page, NOON)
      const midnight = await atTime(page, MIDNIGHT)

      // Guard the guard: if the sky itself stopped moving, the rest of this
      // would "pass" by comparing two identical frozen numbers.
      expect(noon.light, `sun intensity at noon was ${noon.light}`)
        .toBeGreaterThan(0.9)
      expect(midnight.light, `sun intensity at midnight was ${midnight.light}`)
        .toBeLessThan(0.3)

      expect(noon.mats.length,
        'found no entity materials at all -- this test proved nothing')
        .toBeGreaterThan(1)

      for (let i = 0; i < noon.mats.length; i++) {
        const [d, n] = [noon.mats[i], midnight.mats[i]]
        const where = `${d.name}: noon ${d.e.toFixed(3)}, midnight ${n.e.toFixed(3)}`

        /*
         * THE ASSERTION THAT CATCHES THE ORIGINAL BUG. A constant floor --
         * any constant, 0.45 or otherwise -- gives a ratio of exactly 1.
         * Minecraft's night sky light is roughly a fifth of noon's, and
         * sky.js floors it at 0.18, so anything above half is a model that
         * is not really following the clock.
         */
        expect(n.e, `${where} -- the emissive floor did not move`)
          .toBeLessThan(d.e * 0.5)
        expect(n.e, `${where} -- entities went pure black at midnight`)
          .toBeGreaterThan(0)

        /*
         * And it is the SAME source, not a second curve that happens to
         * also go down. Vanilla's entity shader floors face shading at
         * 0.4 of the light level (light.glsl's `* 0.6 + 0.4`), which is
         * what entityLight.js implements.
         */
        expect(d.e, `${where} -- noon emissive is not 0.4 of the sun`)
          .toBeCloseTo(noon.light * 0.4, 2)
        expect(n.e, `${where} -- midnight emissive is not 0.4 of the sun`)
          .toBeCloseTo(midnight.light * 0.4, 2)

        /*
         * ambientColor has to stay zero. noa leaves it white and Babylon adds
         * that term on top of emissive, so a white one would be a SECOND
         * uncontrolled floor -- the same trap nametag.js, crackOverlay.js,
         * particles.js and sky.js each carry a line against.
         */
        expect(d.a, `${where} -- ambientColor is not zeroed`).toBe(0)
      }
    })

  test('the clock drives it continuously, not just at the two extremes',
    async ({ page }) => {
      // 12000 is vanilla's sunset tick: the sun exactly on the horizon, so
      // the sky is mid-way down rather than already floored. A material wired
      // to `if (night)` somewhere passes the test above and fails this one --
      // and so does one sampled past 12800, where sky.js's daylight curve has
      // already bottomed out and dusk reads identical to midnight.
      const noon = await atTime(page, NOON)
      const dusk = await atTime(page, 12000)
      const midnight = await atTime(page, MIDNIGHT)
      const e = (s) => s.mats[0].e
      expect(e(dusk), `noon ${e(noon).toFixed(3)}, dusk ${e(dusk).toFixed(3)},`
        + ` midnight ${e(midnight).toFixed(3)}`).toBeLessThan(e(noon))
      expect(e(dusk)).toBeGreaterThan(e(midnight))
    })

  test('the model and the ground darken together', async ({ page }) => {
    /*
     * Visual, and the whole point of the change: a number can say the
     * emissive moved, but only a screenshot says the model and the terrain
     * around it now read as being in the same world at midnight.
     *
     * Third person, because it is the only view that puts the full model and
     * the ground it stands on in one frame. F5 rather than a private setter,
     * so this also proves the path a player uses.
     */
    await page.keyboard.press('F5')
    await page.waitForFunction(() => !window.game.perspective.isFirstPerson)
    try {
      await atTime(page, NOON)
      await waitTicks(page, 2)
      await shot(page, 'entity-light-noon')

      await atTime(page, MIDNIGHT)
      await waitTicks(page, 2)
      await shot(page, 'entity-light-midnight')
    } finally {
      // resetWorld does not restore the camera mode, so this has to. Cycle
      // rather than set: F5 is the only door in.
      for (let i = 0; i < 3; i++) {
        if (await page.evaluate(() => window.game.perspective.isFirstPerson)) break
        await page.keyboard.press('F5')
      }
    }
  })
})
