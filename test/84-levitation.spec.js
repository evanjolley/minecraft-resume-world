import { test, expect } from './fixtures.js'
import { waitTicks, teleport, useGamemode, SURFACE_Y } from './helpers/world.js'

/*
 * LEVITATION HAD NO TEST AT ALL, and that was found by mutation rather than
 * by reading.
 *
 * physics.js's effects tick is the lowest-ranked writer of
 * `body.gravityMultiplier`: three other systems own that field and all three
 * write 0 to it, so the tick skips any body sitting at 0 that it did not zero
 * itself. Levitation is the one case where the 0 IS the tick's own, and a
 * WeakSet is how it remembers. Delete the one line that records it and the
 * whole suite still passes -- the guard then skips a levitating body from its
 * second tick onward, so you get one tick of lift and then fall out of the
 * sky. Measured: 137.5, 136.5, 136, 136, 136, 136, against the 137.5, 137.9,
 * 138.0, 138.3, 138.5, 138.8 below.
 *
 * So this file exists to make that line's deletion cost something. It is the
 * only spec in the suite that mentions levitation; 79-effects.spec.js covers
 * the other half of the same tick (Slow Falling) and nothing covered this
 * half.
 *
 * WHY A RISE OVER TIME rather than reading the velocity. Reading velocity
 * passes under the mutation -- the one tick that ran set it to nearly the
 * target and the body keeps that number while the position stops changing,
 * which is exactly the shape of a test that proves nothing. Position over a
 * second and a half is the thing a player would notice.
 */

/** 1.21 `MobEffects.LEVITATION`: 0.05 blocks/tick per level, which is 1 b/s. */
const LEVITATION_BLOCKS_PER_SECOND = 1

/** Samples, and the window they span. Six quarter-seconds. */
const SAMPLES = 6
const SAMPLE_MS = 250

/*
 * Settle before the first sample, and it is not a magic number -- it is the
 * ramp. Levitation approaches 1 b/s exponentially from whatever the body was
 * doing, and the body was FALLING, so for the first fraction of a second it
 * is still descending more slowly. Chromium happened to clear that inside the
 * first 250 ms and WebKit did not, which is the whole difference between this
 * spec passing on one engine and not the other. Half a second is comfortably
 * past it on both and still well short of the effect's 30.
 */
const SETTLE_MS = 500

test('levitation keeps lifting past the first tick', async ({ page }) => {
  /*
   * SURVIVAL, not creative. Creative flight owns gravity outright and would
   * hide the whole question -- and "which of these two owns gravity" is the
   * question. Dropped a few blocks above the spawn column so the chunks under
   * the whole rise are already meshed: a body in an unloaded chunk is held
   * still by noa while its velocity carries on accumulating, which reads as a
   * levitation that does nothing and is not one. Found the hard way at y=250.
   */
  await useGamemode(page, 'survival')
  await teleport(page, 0.5, SURFACE_Y + 3, 0.5)
  await waitTicks(page, 2)

  const run = await page.evaluate(async ([samples, ms, settle]) => {
    const noa = window.noa
    const e = noa.playerEntity
    const body = noa.ents.getPhysics(e).body
    window.game.effects.give(e, 'levitation', 30, 0)
    const given = noa.ents.getPosition(e)[1]
    await new Promise(r => setTimeout(r, settle))
    const start = noa.ents.getPosition(e)[1]
    const ys = []
    for (let i = 0; i < samples; i++) {
      await new Promise(r => setTimeout(r, ms))
      ys.push(noa.ents.getPosition(e)[1])
    }
    return {
      given,
      start,
      ys,
      active: window.game.effects.has(e, 'levitation'),
      gravity: body.gravityMultiplier,
    }
  }, [SAMPLES, SAMPLE_MS, SETTLE_MS])

  const all = JSON.stringify(run)

  /*
   * The sample first. Everything below is a claim ABOUT these numbers, and an
   * empty or unaffected sample would let all of it pass vacuously -- which is
   * the failure mode this repo has shipped before and now checks for by habit.
   */
  expect(run.ys, all).toHaveLength(SAMPLES)
  expect(run.active, `the effect was not on the player -- ${all}`).toBe(true)
  // Gravity off is how levitation is implemented here: noa gives no seam
  // between its gravity step and its solver, so the tick switches gravity off
  // and drives the velocity itself. See the note at the write site.
  expect(run.gravity, `gravity was not handed to levitation -- ${all}`).toBe(0)

  /*
   * MONOTONIC, which is the half the mutation breaks. One tick of lift leaves
   * a body that rises once and then falls, so "higher than the sample before
   * it" is the assertion and not "higher than where it started" -- under the
   * mutation the player is lying on the ground by now and every sample is the
   * same number, which "higher than the start" would also catch but only by
   * accident of where the ground is.
   */
  for (let i = 1; i < run.ys.length; i++) {
    expect(run.ys[i], `sample ${i} did not rise -- ${all}`)
      .toBeGreaterThan(run.ys[i - 1])
  }

  /*
   * And the RATE, loosely. SETTLE_MS above is what makes this measurable at
   * all: the ramp is over before the first sample, so the whole window is at
   * speed. Generous bounds on purpose --
   * the number under test is "about a block a second", and tightening this to
   * three decimals would make it a test of the frame rate under software GL.
   */
  const span = (SAMPLES - 1) * SAMPLE_MS / 1000
  const rate = (run.ys[SAMPLES - 1] - run.ys[0]) / span
  expect(rate, `rose at ${rate.toFixed(3)} b/s -- ${all}`)
    .toBeGreaterThan(LEVITATION_BLOCKS_PER_SECOND * 0.6)
  expect(rate, `rose at ${rate.toFixed(3)} b/s -- ${all}`)
    .toBeLessThan(LEVITATION_BLOCKS_PER_SECOND * 1.4)
})
