import { test, expect } from './fixtures.js'
import { look, HEADING, settleOnGround, ID, PAD_Y, PAD_Z, PAD_X0 } from './helpers/world.js'
import { MC } from '../src/physics.js'

/*
 * Sprint-jumping UP something, which is where the boost chain can compound.
 *
 * Every other speed measurement in this suite is taken on the flat pad, and
 * that is exactly why this bug survived: on flat ground the hop cycle is a
 * closed loop. The player lands 15 ticks later having been dragged back to
 * 5.60 b/s, so the launch is 5.60 + 4 every single time and the chain has
 * nowhere to go. CLIMBING BREAKS THE LOOP -- the tread is a block higher, so
 * you land a third of the way through the arc still carrying most of the last
 * boost, and the next one goes on top of it. It read as "I jolt forward every
 * so often going up a hill", and it was: hop N+1 genuinely faster than hop N.
 *
 * The rig is a staircase rather than a real hillside on purpose. The imported
 * terrain's slopes come with trees, overhangs and 2-block risers in them, so a
 * failure there could be any of five things; a bare stone staircase with clear
 * air over it leaves the pitch as the only variable. Built at PAD_Y for the
 * same reasons usePad is (nothing destroyed, restore is "set it back to air",
 * and the spawn chunks are never evicted while the test is up there).
 */

/*
 * Six blocks of tread per block of rise, and the pitch is the one tuned thing
 * in this file. Steeper than about 1-in-4 and the player meets the next riser
 * head-on every second hop, which throws the chain away and hides the bug;
 * shallower than 1-in-8 and the run stops being a climb at all (1-in-8
 * measured 3.7 blocks of gain in five seconds, under this file's own floor).
 * At 1-in-6 the unclamped build reached 10.05 b/s against a 9.61 launch.
 */
const STEP_RUN = 6
const STEPS = 14
const FLAT_LEAD = 6         // run-up, so the chain is already at speed

/** The fastest a sprint jump may launch: one boost on top of a steady sprint. */
const LAUNCH = MC.SPRINT_SPEED + MC.SPRINT_JUMP_BOOST

/**
 * A 3-wide stone staircase climbing +X from PAD_X0, with the player on its
 * flat lead-in facing east. Returns the undo.
 */
async function buildStaircase(page) {
  /*
   * The player has to be up here BEFORE the blocks are, because noa.setBlock
   * is a silent no-op on an unloaded chunk and chunks only load around the
   * player -- the same ordering trap usePad documents, and the same gravity
   * freeze so the moment of standing on nothing does not turn into a fall.
   */
  await page.evaluate(([x0, y, z]) => {
    const noa = window.noa
    noa.ents.setPosition(noa.playerEntity, [x0 + 0.5, y, z + 0.5])
    const body = noa.ents.getPhysics(noa.playerEntity).body
    body.velocity[0] = body.velocity[1] = body.velocity[2] = 0
    window.__stairGravity = body.gravityMultiplier
    body.gravityMultiplier = 0
  }, [PAD_X0, PAD_Y, PAD_Z])

  // Probe with the write itself: "did setBlock take" is the only load check
  // worth trusting here.
  await page.waitForFunction(([x0, y, z, stone]) => {
    window.noa.setBlock(stone, x0, y - 1, z)
    return window.noa.getBlock(x0, y - 1, z) === stone
  }, [PAD_X0, PAD_Y, PAD_Z, ID.stone], { timeout: 15_000, polling: 100 })

  const cells = await page.evaluate(([x0, y, z, stone, steps, run, lead]) => {
    const noa = window.noa
    const touched = []
    const put = (id, px, py, pz) => { touched.push([px, py, pz]); noa.setBlock(id, px, py, pz) }
    const heightAt = (i) =>
      i < lead ? 0 : Math.min(Math.floor((i - lead) / run) + 1, steps)

    const len = lead + steps * run + 6
    for (let i = -2; i < len; i++) {
      const h = heightAt(i)
      for (let dz = -1; dz <= 1; dz++) {
        // Filled from the base up, so a step is a riser you collide with
        // rather than a shelf floating over a gap.
        for (let k = 0; k <= h; k++) put(stone, x0 + i, y - 1 + k, z + dz)
        for (let k = 0; k < 6; k++) put(0, x0 + i, y + h + k, z + dz)
      }
    }
    noa.ents.getPhysics(noa.playerEntity).body.gravityMultiplier = window.__stairGravity ?? 1
    delete window.__stairGravity
    return touched
  }, [PAD_X0, PAD_Y, PAD_Z, ID.stone, STEPS, STEP_RUN, FLAT_LEAD])

  await settleOnGround(page)
  await page.evaluate(() => window.game.survival.clearFallTracking())
  // W walks where the camera looks and the staircase runs east.
  await look(page, { heading: HEADING.westPlusX })

  return () => page.evaluate((list) => {
    for (const [x, y, z] of list) window.noa.setBlock(0, x, y, z)
  }, cells)
}

/** Horizontal speed and grounded state, every tick, for `ticks` ticks. */
function traceTicks(page, ticks) {
  return page.evaluate((n) => new Promise((resolve) => {
    const noa = window.noa
    const body = noa.ents.getPhysics(noa.playerEntity).body
    const out = []
    let left = n
    const fn = () => {
      out.push({
        grounded: body.atRestY() < 0,
        speed: Math.hypot(body.velocity[0], body.velocity[2]),
        y: noa.ents.getPositionData(noa.playerEntity).position[1],
      })
      if (--left <= 0) { noa.off('tick', fn); resolve(out) }
    }
    noa.on('tick', fn)
  }), ticks)
}

test.describe('sprint-jumping up a slope', () => {
  test('the boost chain never launches faster than one boost above a sprint',
    async ({ page }) => {
      const restore = await buildStaircase(page)
      try {
        /*
         * ARMED BEFORE THE KEYS GO DOWN, and this is the whole difference
         * between a test and a coin flip. The compounding is at its strongest
         * over the first few steps of a climb -- after that the player settles
         * into a riser-slam rhythm that throws the chain away every other hop
         * -- so the run has to start from a known standstill at a known x.
         * Awaiting the recorder after pressing the keys hands the start phase
         * to a CDP round-trip: measured, it attached around ten ticks late,
         * the player met the first riser out of phase, and the same build read
         * 9.58 b/s instead of 10.05.
         */
        const trace = traceTicks(page, 150)
        await page.keyboard.down('KeyW')
        await page.keyboard.down('ControlLeft')
        await page.keyboard.down('Space')
        // 150 ticks is five seconds: the lead-in, then a dozen hops of climb.
        const rows = await trace
        for (const k of ['Space', 'ControlLeft', 'KeyW']) await page.keyboard.up(k)

        const climbed = rows[rows.length - 1].y - rows[0].y
        const fastest = Math.max(...rows.map(r => r.speed))
        const contacts = rows.filter((r, i) => r.grounded && !(i > 0 && rows[i - 1].grounded)).length

        // The rig has to actually be a climb, or the assertion below is just
        // the flat-ground test wearing a hat.
        expect(climbed, `only climbed ${climbed.toFixed(1)} blocks`).toBeGreaterThan(4)
        expect(contacts, `${contacts} ground contacts -- did the player hop at all?`)
          .toBeGreaterThan(6)

        /*
         * The whole bug in one number. A tick above this is a hop that
         * inherited the previous hop's boost instead of replacing it, and the
         * excess is what the player feels as a jolt.
         *
         * Tiny slack for the ordinary case where the landing tick's own
         * movement push lands on top of the boost within the same tick.
         */
        expect(fastest, `fastest tick on the climb was ${fastest.toFixed(3)} b/s`
          + ` against a ${LAUNCH.toFixed(3)} b/s launch`)
          .toBeLessThan(LAUNCH * 1.01)
      } finally {
        await restore()
      }
    })

  test('and still gets a boost on every hop while climbing', async ({ page }) => {
    /*
     * The other half, and the half a clamp could silently eat. Capping the
     * launch must not cost the climb its boosts -- a build that simply stopped
     * boosting after the first hop would sail through the test above.
     */
    const restore = await buildStaircase(page)
    try {
      const trace = traceTicks(page, 150)
      await page.keyboard.down('KeyW')
      await page.keyboard.down('ControlLeft')
      await page.keyboard.down('Space')
      const rows = await trace
      for (const k of ['Space', 'ControlLeft', 'KeyW']) await page.keyboard.up(k)

      // A launch is a tick that gained most of the 4 b/s impulse -- the same
      // definition 03-sprint-sneak uses on the flat.
      const launches = rows.filter((r, i) => i > 0 && r.speed - rows[i - 1].speed > 2).length
      expect(launches, `${launches} launches in 5 s of climbing`).toBeGreaterThanOrEqual(6)
    } finally {
      await restore()
    }
  })
})
