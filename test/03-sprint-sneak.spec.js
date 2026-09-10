import { test, expect } from './fixtures.js'
import {
  look, HEADING, tapKey, waitTicks, eyeHeight, fovDegrees, teleport, position,
  settleOnGround, SURFACE_Y, ISLAND_HALF,
} from './helpers/world.js'
import { shotRegion } from './helpers/shots.js'

const WALK = 4.317, SPRINT = 5.612, SNEAK = 1.295
const BASE_FOV = 70, SPRINT_FOV = 77
const EYE = 1.62, SNEAK_EYE = 1.27

const maxSpeed = (page) => page.evaluate(() => window.game.move.maxSpeed)

/* The FOV and eye-height eases run at ~9/s and ~14/s, so a second of held
 * input puts both within a rounding error of target. Waiting on the eased
 * VALUE rather than a fixed sleep would be nicer, but the value is what is
 * under test -- polling it would make the assertion tautological. */
const EASE_MS = 1000

test.describe('sprint', () => {
  test.beforeEach(async ({ page }) => {
    await look(page, { heading: HEADING.eastPlusX })
  })

  test('holding ctrl while moving forward engages sprint and kicks FOV to 77',
    async ({ page }) => {
      expect(await fovDegrees(page)).toBeCloseTo(BASE_FOV, 1)

      await page.keyboard.down('KeyW')
      await page.keyboard.down('ControlLeft')
      await page.waitForTimeout(EASE_MS)

      const speed = await maxSpeed(page)
      const fov = await fovDegrees(page)
      await page.keyboard.up('ControlLeft')
      await page.keyboard.up('KeyW')

      expect(speed, `maxSpeed was ${speed}`).toBeCloseTo(SPRINT, 3)
      expect(fov, `FOV was ${fov.toFixed(2)} deg`).toBeCloseTo(SPRINT_FOV, 1)
    })

  test('a double-tap of forward latches sprint the same as ctrl does', async ({ page }) => {
    // Real key events, deliberately. The double-tap detector hangs off noa's
    // keydown event because a tap can start and finish between two ticks --
    // a synthetic KeyboardEvent or a state poke would test the wrong path,
    // and did exactly that when this feature first shipped broken.
    await tapKey(page, 'KeyW')
    await page.keyboard.down('KeyW')
    await page.waitForTimeout(EASE_MS)

    const speed = await maxSpeed(page)
    const fov = await fovDegrees(page)
    await page.keyboard.up('KeyW')

    expect(speed, `maxSpeed was ${speed}`).toBeCloseTo(SPRINT, 3)
    expect(fov, `FOV was ${fov.toFixed(2)} deg`).toBeCloseTo(SPRINT_FOV, 1)
  })

  test('ctrl with no forward input does not sprint', async ({ page }) => {
    await page.keyboard.down('ControlLeft')
    await waitTicks(page, 4)
    const speed = await maxSpeed(page)
    await page.keyboard.up('ControlLeft')
    expect(speed).toBeCloseTo(WALK, 3)
  })

  test('releasing forward cancels the sprint and the FOV falls back to 70',
    async ({ page }) => {
      await page.keyboard.down('KeyW')
      await page.keyboard.down('ControlLeft')
      await page.waitForTimeout(EASE_MS)
      await page.keyboard.up('KeyW')
      await page.keyboard.up('ControlLeft')
      await page.waitForTimeout(EASE_MS)

      expect(await maxSpeed(page)).toBeCloseTo(WALK, 3)
      const fov = await fovDegrees(page)
      expect(fov, `FOV was ${fov.toFixed(2)} deg`).toBeCloseTo(BASE_FOV, 1)
    })

  test('sneaking beats sprinting when both are held', async ({ page }) => {
    await page.keyboard.down('KeyW')
    await page.keyboard.down('ControlLeft')
    await page.waitForTimeout(400)
    await page.keyboard.down('ShiftLeft')
    await waitTicks(page, 4)

    const speed = await maxSpeed(page)
    for (const k of ['ShiftLeft', 'ControlLeft', 'KeyW']) await page.keyboard.up(k)
    expect(speed).toBeCloseTo(SNEAK, 3)
  })
})

test.describe('sneak', () => {
  test('sneak is hold-to-crouch, not a toggle: the eye drops 1.62 -> 1.27 and returns',
    async ({ page }) => {
      expect(await eyeHeight(page)).toBeCloseTo(EYE, 2)

      await page.keyboard.down('ShiftLeft')
      await page.waitForTimeout(EASE_MS)
      const crouched = await eyeHeight(page)

      await page.keyboard.up('ShiftLeft')
      await page.waitForTimeout(EASE_MS)
      const stood = await eyeHeight(page)

      expect(crouched, `crouched eye ${crouched.toFixed(4)}`).toBeCloseTo(SNEAK_EYE, 2)
      expect(stood, `eye after release ${stood.toFixed(4)}`).toBeCloseTo(EYE, 2)
    })

  /*
   * Edge protection, tested at the island's real rim rather than a dug pit,
   * because the rim is where it matters: everything past x=39 is void, not a
   * drop. Both halves run from the same start block so the only difference
   * between them is whether shift is held.
   */
  const RIM_START = [ISLAND_HALF - 0.5, SURFACE_Y + 0.5, 0.5] // centre of x=39

  test('sneaking at the rim refuses to walk you off into the void', async ({ page }) => {
    await teleport(page, ...RIM_START)
    await settleOnGround(page)
    await look(page, { heading: HEADING.eastPlusX })

    await page.keyboard.down('ShiftLeft')
    await page.keyboard.down('KeyW')
    await page.waitForTimeout(2000)
    const [x, y] = await position(page)
    await page.keyboard.up('KeyW')
    await page.keyboard.up('ShiftLeft')

    // Still standing on the last column, not hanging off it. The leading edge
    // is half a width plus the 0.1 lookahead, so the stop belongs just under
    // x = 39.7, with the feet still at y = 64.
    const where = `ended at x=${x.toFixed(3)} y=${y.toFixed(3)}`
    expect(y, `${where} -- fell off the island while sneaking`).toBeCloseTo(SURFACE_Y, 1)
    expect(x, `${where} -- walked past the rim`).toBeLessThan(ISLAND_HALF - 0.25)
    expect(x, `${where} -- never actually walked`).toBeGreaterThan(ISLAND_HALF - 0.55)
  })

  test('walking the same rim without sneak drops you off it', async ({ page }) => {
    // The control case. Without it, a sneak test passes just as happily
    // against a build where the player cannot move at all.
    await teleport(page, ...RIM_START)
    await settleOnGround(page)
    await look(page, { heading: HEADING.eastPlusX })

    await page.keyboard.down('KeyW')
    await page.waitForTimeout(1500)
    const [x, y] = await position(page)
    await page.keyboard.up('KeyW')

    expect(x, `x was ${x.toFixed(3)}`).toBeGreaterThan(ISLAND_HALF)
    expect(y, `y was ${y.toFixed(3)} -- did not fall`).toBeLessThan(SURFACE_Y - 5)
  })

  test('the crouched player model reads as crouched', async ({ page }) => {
    // Visual only. "Is the model visibly lower and hunched" is a judgement
    // about pixels; the numeric part (eye height) is asserted above, and
    // faking a numeric check on the mesh transform here would pin the
    // implementation rather than the behaviour.
    // Real F5, which is also the only way to change perspective -- the
    // module exposes `mode` read-only.
    await page.keyboard.press('F5')
    await page.keyboard.down('ShiftLeft')
    await page.waitForTimeout(EASE_MS)
    expect(await page.evaluate(() => window.game.perspective.mode)).toBe('third-back')
    await shotRegion(page, 'sneak-third-person', 'centre')
    await page.keyboard.up('ShiftLeft')
    await page.keyboard.press('F5')
    await page.keyboard.press('F5')
  })
})
