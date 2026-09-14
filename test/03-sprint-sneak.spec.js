import { test, expect } from './fixtures.js'
import {
  look, HEADING, tapKey, waitTicks, eyeHeight, fovDegrees, teleport, position,
  settleOnGround, PAD_X0, PAD_Y, PAD_Z, padEdgeX,
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
    await look(page, { heading: HEADING.westPlusX })
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

  /*
   * One boost PER HOP. 02-physics measures the speed this produces; this is
   * the mechanism, and it is the one that regressed.
   *
   * The boost used to fire on the rising edge of the jump key, which is the
   * same thing as "a jump started" only for the first hop of a run. Hold space
   * -- the way bunny-hopping is actually played -- and noa starts a fresh jump
   * on every tick you touch the ground, while a rising edge fires once. The
   * trace below is what tells those two apart: it counts the launches, not the
   * average speed, so a build that boosts once and coasts fails with a number
   * rather than sneaking through on a wide tolerance.
   */
  test('the sprint-jump boost lands on every hop, not just the first',
    async ({ page, flatGround }) => {
      // 4.2 s of held sprint-jumping is a bit over 30 blocks, and real
      // terrain has no 30-block run in it, so build one. The assertions --
      // three launches and a trough above 0.95 * SPRINT -- are unchanged.
      await flatGround.build({ length: 40 })
      await page.keyboard.down('KeyW')
      await page.keyboard.down('ControlLeft')
      await page.keyboard.down('Space')
      // Long enough that the first hop -- the one the old build got right --
      // is over before sampling starts.
      await page.waitForTimeout(1200)

      const r = await page.evaluate(() => new Promise((resolve) => {
        const noa = window.noa
        const body = noa.ents.getPhysics(noa.playerEntity).body
        const speeds = []
        let left = 90                     // 3 s: four or five hops
        const fn = () => {
          speeds.push(Math.hypot(body.velocity[0], body.velocity[2]))
          if (--left <= 0) { noa.off('tick', fn); resolve(speeds) }
        }
        noa.on('tick', fn)
      }))
      for (const k of ['Space', 'ControlLeft', 'KeyW']) await page.keyboard.up(k)

      // A launch is a tick that gained most of the 4 b/s impulse. Nothing else
      // in this engine can add 2 b/s to a sprinting player in 33 ms.
      const launches = r.filter((v, i) => i > 0 && v - r[i - 1] > 2).length
      expect(launches, `${launches} launches in 3 s of held-space sprint-jumping`)
        .toBeGreaterThanOrEqual(3)

      // And the troughs: the slowest tick of the cycle is the landing, which
      // is where a stray dose of standing friction would show up as a stall.
      const slowest = Math.min(...r)
      expect(slowest, `slowest tick in the cycle was ${slowest.toFixed(3)} b/s`)
        .toBeGreaterThan(SPRINT * 0.95)
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
   * Edge protection, tested at a real lip with a real drop under it.
   *
   * It used to be tested at the island's rim, where everything past x=39 was
   * open void. The world has no rim any more -- it is a 128x128 cut of real
   * terrain with an invisible wall around it, and you cannot walk off it
   * anywhere. So the test builds the ledge it needs: a stone pad in the air
   * with a two-hundred-block drop off its far lip.
   *
   * The BEHAVIOUR under test did not move an inch. Sneak still has to stop
   * you at an edge, walking still has to take you over it, and both halves
   * still run from the same start block so the only difference between them
   * is whether shift is held.
   */
  const PAD_LEN = 8
  const EDGE_X = padEdgeX(PAD_LEN)          // last solid column of the pad
  const RIM_START = () => [EDGE_X + 0.5, PAD_Y, PAD_Z + 0.5]

  test('sneaking at the lip refuses to walk you off the edge',
    async ({ page, flatGround }) => {
      await flatGround.build({ length: PAD_LEN })
      await teleport(page, ...RIM_START())
      await settleOnGround(page)
      await look(page, { heading: HEADING.westPlusX })

      await page.keyboard.down('ShiftLeft')
      await page.keyboard.down('KeyW')
      await page.waitForTimeout(2000)
      const [x, y] = await position(page)
      await page.keyboard.up('KeyW')
      await page.keyboard.up('ShiftLeft')

      // Still standing on the last column, not hanging off it. The leading
      // edge is half a width plus the 0.1 lookahead, so the stop belongs just
      // under x = EDGE_X + 0.7, with the feet still on the pad.
      const where = `ended at x=${x.toFixed(3)} y=${y.toFixed(3)}`
      expect(y, `${where} -- fell off the ledge while sneaking`).toBeCloseTo(PAD_Y, 1)
      // Overhang is the POINT of sneaking, so this only asserts you are still
      // supported, not that you stopped short. The box is 0.6 wide against a
      // 1.0 block, so a sneaking player hangs most of their body over the
      // drop -- that is what makes bridging possible.
      expect(x, `${where} -- lost all footing on the lip`).toBeLessThan(EDGE_X + 1.6)
      expect(x, `${where} -- never actually walked`).toBeGreaterThan(EDGE_X + 0.45)
    })

  test('walking the same lip without sneak drops you off it',
    async ({ page, flatGround }) => {
      // The control case. Without it, a sneak test passes just as happily
      // against a build where the player cannot move at all.
      await flatGround.build({ length: PAD_LEN })
      await teleport(page, ...RIM_START())
      await settleOnGround(page)
      await look(page, { heading: HEADING.westPlusX })

      await page.keyboard.down('KeyW')
      await page.waitForTimeout(1500)
      const [x, y] = await position(page)
      await page.keyboard.up('KeyW')

      expect(x, `x was ${x.toFixed(3)}`).toBeGreaterThan(EDGE_X + 1)
      expect(y, `y was ${y.toFixed(3)} -- did not fall`).toBeLessThan(PAD_Y - 5)
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
