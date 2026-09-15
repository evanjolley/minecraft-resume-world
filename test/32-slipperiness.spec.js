import { test, expect } from './fixtures.js'
import { look, HEADING, settleOnGround, measureSpeed, waitTicks } from './helpers/world.js'
import { pave, rampUp, coast } from './helpers/surfaces.js'

/*
 * Blocks that change how you move.
 *
 * MINECRAFT'S TWO NUMBERS, and they are separate mechanisms that get
 * conflated constantly:
 *
 *   Block.getFriction     0.6 almost everywhere, 0.98 ice and packed ice,
 *                         0.989 blue ice, 0.8 slime.
 *   Block.getSpeedFactor  1.0 almost everywhere, 0.4 soul sand and honey.
 *
 * The speeds below are NOT measured from the game; they are derived from its
 * source, the same way 02-physics.spec.js's 4.317 is. LivingEntity's ground
 * step is
 *
 *   a = 0.1 * (0.21600002 / friction^3) * 0.98     (0.98 is aiStep's input decay)
 *   v_next = (v + a) * friction * 0.91 * speedFactor
 *
 * and the player moves by `v + a` before the multiply, so the steady speed is
 * 20 * a / (1 - friction*0.91*speedFactor) blocks/second. At friction 0.6 and
 * speed factor 1 that is 4.3172, which is Minecraft's published walking speed
 * to four decimals -- so the same arithmetic at 0.98 and at 0.4 is trusted
 * here rather than re-derived from a stopwatch.
 *
 * The ones that surprise:
 *   - BLUE ICE IS FASTER than ordinary ground, not slower. Its slipperiness
 *     costs so little retention per tick that it beats the acceleration
 *     penalty. Ice proper is slightly SLOWER than grass at top speed. Neither
 *     is why anyone builds with them -- the mechanic is the ramp and the
 *     slide, which is what the second half of this file measures.
 *   - SOUL SAND IS 58% OF WALKING SPEED, not the 40% its speed factor reads
 *     like. The 0.4 multiplies the velocity but not the acceleration, so it
 *     lands in the retention term and partly cancels itself.
 */
const VANILLA = {
  // friction 0.6, speedFactor 1 -- the control, and it must not have moved.
  stone: { id: 3, speed: 4.3172 },
  ice: { id: 69, speed: 4.1575 },
  packed_ice: { id: 70, speed: 4.1575 },
  blue_ice: { id: 71, speed: 4.3773 },
  slime_block: { id: 334, speed: 3.0399 },
  soul_sand: { id: 127, speed: 2.5078 },
}

/*
 * 1.5%, which is 02-physics.spec.js's tolerance and is chosen for the same
 * reason: noa integrates continuously against Minecraft's fixed 20 Hz tick,
 * so exact equality is not reachable. The measured numbers sit well inside it
 * (ice 4.157, blue ice 4.368, slime 3.050, soul sand 2.516) and the wrong
 * answer -- doing nothing, which reads 4.288 on every block -- is outside it
 * for all four.
 */
const TOL = 0.015
const near = (actual, want) => Math.abs(actual - want) <= want * TOL

// Long enough that nothing in here can slide off the end of it.
const PAD = 80

/** Stand on a pad made of `id`, facing along it. */
async function standOn(page, flatGround, id) {
  await flatGround.build({ length: PAD })
  await pave(page, id, PAD)
  await look(page, { heading: HEADING.westPlusX })
  await settleOnGround(page)
  await waitTicks(page, 2)
}

test.describe('slipperiness', () => {
  for (const [name, { id, speed }] of Object.entries(VANILLA)) {
    test(`walking on ${name} settles at ${speed} b/s`, async ({ page, flatGround }) => {
      await standOn(page, flatGround, id)
      /*
       * A THREE-SECOND WARM-UP, where every other speed test in this suite
       * uses measureSpeed's 900 ms default, and the difference is the point
       * of the whole file. Ordinary ground is at 90% of walking speed four
       * ticks after you press W; ice takes thirty. Sampling from 0.9 s on ice
       * measures the ramp and reads 3.9 b/s, which would be a real reading of
       * the wrong thing.
       */
      const v = await measureSpeed(page, ['KeyW'], { warmupMs: 3000 })
      expect(near(v, speed), `${name} walk ${v.toFixed(4)} b/s vs ${speed}`).toBe(true)
    })
  }

  test('ice takes a second to get going, where stone takes a tenth',
    async ({ page, flatGround }) => {
      await standOn(page, flatGround, VANILLA.stone.id)
      const stone = await rampUp(page, ['KeyW'])
      await settleOnGround(page)

      await pave(page, VANILLA.ice.id, PAD)
      await waitTicks(page, 2)
      const ice = await rampUp(page, ['KeyW'])
      await settleOnGround(page)

      /*
       * Vanilla's ramp is the retention: 0.546 per tick on stone reaches 90%
       * in 3.8 MC ticks (0.19 s), 0.8918 on ice in 20 MC ticks (1.0 s). At
       * noa's 30 Hz those are 6 and 30 ticks. The assertion is deliberately
       * loose on stone (it is noa's model, not Minecraft's, and is where the
       * calibrated constants live) and tight-ish on ice, which IS Minecraft's
       * recurrence and should land on 30.
       */
      expect(stone.t90, `stone reached 90% in ${stone.t90} ticks`).toBeLessThan(10)
      expect(ice.t90, `ice reached 90% in ${ice.t90} ticks`).toBeGreaterThan(20)
      expect(ice.t90, `ice reached 90% in ${ice.t90} ticks`).toBeLessThan(40)
    })

  test('letting go on ice slides you nearly two blocks; on stone, none',
    async ({ page, flatGround }) => {
      await standOn(page, flatGround, VANILLA.stone.id)

      await page.keyboard.down('KeyW')
      await page.waitForTimeout(1200)
      await page.keyboard.up('KeyW')
      const stone = await coast(page)

      await settleOnGround(page)
      await pave(page, VANILLA.ice.id, PAD)
      await waitTicks(page, 2)

      await page.keyboard.down('KeyW')
      await page.waitForTimeout(3000)
      await page.keyboard.up('KeyW')
      const ice = await coast(page)

      /*
       * Vanilla: velocity decays by 0.8918 a tick with nothing driving it, so
       * from 0.2079 b/tick the remaining travel is 0.2079 * 0.8918 / 0.1082 =
       * 1.71 blocks, and a tenth of the speed is 20 MC ticks (1.0 s) away.
       * Stone's 0.546 gives 0.25 blocks and 4 MC ticks.
       *
       * The band is wide because the keyup lands somewhere inside a tick and
       * that whole tick's travel is counted here; the thing being asserted is
       * an order of magnitude, and the two are eight times apart.
       */
      expect(ice.dist, `ice slid ${ice.dist.toFixed(3)} blocks`).toBeGreaterThan(1.3)
      expect(ice.dist, `ice slid ${ice.dist.toFixed(3)} blocks`).toBeLessThan(2.5)
      expect(stone.dist, `stone slid ${stone.dist.toFixed(3)} blocks`).toBeLessThan(0.3)
      expect(ice.t10, `ice fell to a tenth in ${ice.t10} ticks`).toBeGreaterThan(20)
      expect(stone.t10, `stone fell to a tenth in ${stone.t10} ticks`).toBeLessThan(8)

      // And it does stop, rather than creeping forever. Ice is not the void.
      expect(ice.stopped, 'the player never came to rest on ice').toBe(true)
    })

  test('ordinary ground is untouched by any of it', async ({ page, flatGround }) => {
    /*
     * THE REGRESSION GUARD, and the reason this whole change was allowed to be
     * a layer rather than a rewrite. Both of Minecraft's per-block numbers are
     * applied as ratios against the 0.6 case, and both ratios are exactly 1
     * there -- so the branch must not merely round to the same walking speed,
     * it must not be taken at all.
     *
     * Asserted through the physics rather than through the speed: moveForce
     * and standingFriction are what the slippery path takes away, and a bug
     * that left them at zero on stone would still read 4.288 b/s for a second
     * or two before the player failed to stop.
     */
    await standOn(page, flatGround, VANILLA.stone.id)
    await page.keyboard.down('KeyW')
    await page.waitForTimeout(800)
    const held = await page.evaluate(() => ({
      moveForce: window.game.move.moveForce,
      standingFriction: window.game.move.standingFriction,
    }))
    await page.keyboard.up('KeyW')
    await settleOnGround(page)

    expect(held.moveForce, 'noa\'s push was disabled on ordinary ground').toBe(40)
    expect(held.standingFriction, 'ground friction was disabled on ordinary ground').toBe(4)
  })
})
