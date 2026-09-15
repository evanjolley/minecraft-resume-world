import { test, expect } from './fixtures.js'
import {
  teleport, settleOnGround, useGamemode, doubleTapFly, waitTicks, look, HEADING,
  DROP_X, DROP_Z, SURFACE_Y,
} from './helpers/world.js'
import { coast } from './helpers/surfaces.js'

/*
 * How creative flight stops, which is a different question from how fast it
 * goes -- 10-gamemode.spec.js already asserts the two top speeds.
 *
 * VANILLA IS TWO RETENTIONS, both of them in Player.travel:
 *
 *   if (this.getAbilities().flying) {
 *     double d2 = this.getDeltaMovement().y;
 *     super.travel(input);                  // travelInAir's 0.91 hits x and z
 *     this.setDeltaMovement(...with(Y, d2 * 0.6));
 *   }
 *
 * 0.91 sideways, 0.6 vertically, and the vertical line throws away gravity
 * and the 0.98 vertical air drag along with it. The asymmetry is the feel:
 * you glide to a stop but you stop climbing at once.
 *
 * WHAT THE NUMBERS COME TO. Horizontal cruise is 10.889 b/s, so 0.5444 per
 * MC tick; releasing the key leaves 0.91^n of it and the remaining travel is
 * 0.5444 * 0.91 / 0.09 = 5.51 blocks, with a tenth of the speed 24.4 MC ticks
 * (1.22 s) away. Vertical cruise is 7.5 b/s and 0.6 per tick puts a tenth of
 * it 4.5 MC ticks (0.23 s) away -- five times quicker, and a bit over half a
 * block of coast.
 *
 * WHAT THIS CAUGHT. The horizontal had no decay modelled at all, only noa's
 * global airDrag of 0.1, which is a 0.33% haircut per tick against
 * Minecraft's 9%. A flier who let go of W coasted 68 blocks over ten seconds
 * and had still not fallen to a tenth of cruise when the measurement gave up.
 */
const MC = {
  CRUISE: 10.889,
  VERTICAL: 7.5,
  // Blocks of travel after the key comes up, and ticks to a tenth of cruise.
  // The tick figures are converted to noa's 30 Hz from Minecraft's 20.
  COAST_BLOCKS: 5.51,
  COAST_T10: 37,
  RISE_BLOCKS: 0.56,
  RISE_T10: 7,
}

/** Creative, airborne, well clear of the canopy, facing down the long axis. */
async function takeOff(page) {
  await teleport(page, DROP_X, SURFACE_Y, DROP_Z)
  await settleOnGround(page)
  await useGamemode(page, 'creative')
  await doubleTapFly(page)
  // Off the ground first: touching down clears flight, and a cleared flight
  // would be measured as a walk.
  await page.keyboard.down('Space')
  await page.waitForTimeout(700)
  await page.keyboard.up('Space')
  // ...and then into genuinely open air, above the trees. teleport keeps
  // `flying` true; it only zeroes velocity.
  await teleport(page, DROP_X, 205, DROP_Z)
  await look(page, { heading: HEADING.eastMinusX })
  await waitTicks(page, 3)
}

test.describe('creative flight slows down like Minecraft', () => {
  test('letting go at cruise glides five and a half blocks, and stops',
    async ({ page }) => {
      await takeOff(page)

      /*
       * THREE SECONDS OF WARM-UP, because 0.91 a tick is a slow ramp as well
       * as a slow stop: 90% of cruise is 1.2 s in and 98% is 2 s in. A
       * shorter hold would start the coast from a speed that is not cruise,
       * and every figure below is relative to where it started -- so it would
       * quietly pass while measuring something else.
       */
      await page.keyboard.down('KeyW')
      await page.waitForTimeout(3000)
      await page.keyboard.up('KeyW')

      const stop = await coast(page, 'h')

      expect(stop.v0, `cruise was ${stop.v0.toFixed(3)} b/s`)
        .toBeGreaterThan(MC.CRUISE * 0.95)

      expect(stop.dist, `glided ${stop.dist.toFixed(2)} blocks`)
        .toBeGreaterThan(MC.COAST_BLOCKS * 0.8)
      expect(stop.dist, `glided ${stop.dist.toFixed(2)} blocks`)
        .toBeLessThan(MC.COAST_BLOCKS * 1.25)

      /*
       * The time, which is the half of this the owner actually reported. The
       * band is +-30% of 37 ticks; the behaviour it replaced never reached a
       * tenth of cruise at all inside ten seconds, so there is no risk of the
       * old answer sneaking through a loose band.
       */
      expect(stop.t10, `fell to a tenth of cruise in ${stop.t10} ticks`).not.toBe(null)
      expect(stop.t10, `fell to a tenth of cruise in ${stop.t10} ticks`)
        .toBeGreaterThan(MC.COAST_T10 * 0.7)
      expect(stop.t10, `fell to a tenth of cruise in ${stop.t10} ticks`)
        .toBeLessThan(MC.COAST_T10 * 1.3)

      expect(stop.stopped, 'the flier never came to rest').toBe(true)
    })

  test('climbing stops five times quicker than flying does', async ({ page }) => {
    await takeOff(page)
    await teleport(page, DROP_X, 180, DROP_Z)
    await waitTicks(page, 2)

    await page.keyboard.down('Space')
    await page.waitForTimeout(1500)
    const top = await page.evaluate(() =>
      window.noa.ents.getPhysics(window.noa.playerEntity).body.velocity[1])
    await page.keyboard.up('Space')

    const stop = await coast(page, 'v')

    // flyingSpeed * 3 per tick against a 0.6 retention: 0.15/0.4 = 0.375
    // blocks/tick = 7.5 b/s. Rising is deliberately slower than flying
    // forwards, and that asymmetry is most of why flight reads as flight.
    expect(Math.abs(top - MC.VERTICAL), `climbed at ${top.toFixed(3)} b/s`)
      .toBeLessThan(MC.VERTICAL * 0.03)

    expect(stop.t10, `stopped climbing in ${stop.t10} ticks`)
      .toBeLessThan(MC.RISE_T10 * 2)
    expect(stop.dist, `coasted up ${stop.dist.toFixed(2)} blocks`)
      .toBeLessThan(MC.RISE_BLOCKS * 2)

    /*
     * And the asymmetry itself, stated as a ratio so it survives any
     * re-tuning of either number. 0.6 against 0.91 is 5.4x in the rates;
     * asserted at 3x to leave room for where the keyup lands in a tick.
     */
    expect(MC.COAST_T10 / stop.t10, 'the two axes decay at the same rate')
      .toBeGreaterThan(3)
  })
})
