import { test, expect } from './fixtures.js'
import { look, HEADING, measureSpeed, waitTicks } from './helpers/world.js'

/*
 * Steering in the air, and the impulse that is NOT steering.
 *
 * Two reports, one file, because they were reported together and everyone's
 * first guess is that they are the same bug: "jumping forward speeds me up
 * slightly" and "jump plus a side button launches me sideways". They are not
 * the same bug, and one of them is not a bug at all -- which is the main
 * reason this file exists with numbers in it rather than a fix.
 *
 * MINECRAFT'S HORIZONTAL ACCELERATION is 0.1 blocks/tick^2 with your feet on
 * something and 0.02 in the air (0.13 / 0.026 sprinting). The ratio, 0.2, is
 * the whole feel of a Minecraft jump: you keep your momentum but you have
 * almost no authority to change it. Getting it wrong is the loudest possible
 * "this isn't Minecraft" tell, because it decides whether a jump you aimed
 * badly can be rescued mid-flight.
 *
 * MINECRAFT'S SPRINT-JUMP IMPULSE is a separate thing that happens once, on
 * the tick a sprinting player leaves the ground, and it is where the sideways
 * launch came from. LivingEntity.jumpFromGround:
 *
 *     float f = this.getYRot() * (pi / 180);
 *     this.setDeltaMovement(this.getDeltaMovement().add(-sin(f) * 0.2, 0, cos(f) * 0.2));
 *
 * getYRot() is the BODY YAW. Not the movement input. A vanilla sprint jump
 * with the strafe key down goes exactly as far forward as one without it, and
 * the sideways part of the arc is accumulated a tick at a time out of that
 * 0.02. physics.js used to feed it noa's `move.heading`, which is the camera
 * heading already rotated by the movement keys, so the entire impulse went in
 * at 45 degrees. See the comment there for the measurement.
 */

/** 0.026 blocks/tick^2 of sprinting air acceleration, split across a 45-degree
 *  input and expressed per second: the most sideways velocity ONE tick of
 *  vanilla air-strafing can buy you. The launch is allowed no more than this. */
const VANILLA_AIR_STRAFE_TICK = 0.026 / Math.SQRT2 * 20   // 0.3677 b/s

/** Minecraft's 0.02-in-air against 0.1-on-ground. */
const MC_AIR_CONTROL = 0.2

/**
 * Velocity, sampled once per tick for `ticks` ticks, as [vx, vz] pairs.
 * Sampling is off noa's own tick event so a slow software-GL frame stretches
 * nothing -- a tick is a tick.
 */
function traceVelocity(page, ticks) {
  return page.evaluate((want) => new Promise((resolve) => {
    const noa = window.noa
    const body = noa.ents.getPhysics(noa.playerEntity).body
    const rows = []
    const fn = () => {
      rows.push([body.velocity[0], body.velocity[2]])
      if (rows.length >= want) { noa.off('tick', fn); resolve(rows) }
    }
    noa.on('tick', fn)
  }), ticks)
}

test.describe('air control', () => {
  test.beforeEach(async ({ page, flatGround }) => {
    // 120 long because a sprint jump covers ground fast and the default pad
    // runs out mid-measurement. Three wide is enough: every strafe below is
    // over in under ten ticks, well short of the lip.
    await flatGround.build({ length: 120 })
    await look(page, { heading: HEADING.westPlusX })
  })

  test('a sprint jump goes where you LOOK, not where you are strafing', async ({ page }) => {
    for (const k of ['ControlLeft', 'KeyW']) await page.keyboard.down(k)
    try {
      // Settle at a steady sprint first, so the only thing that moves the
      // needle in the trace is the strafe and then the impulse.
      await page.waitForTimeout(1200)

      /*
       * Strafe and jump are pressed by writing noa.inputs.state from inside
       * the tick loop rather than with the keyboard, and that is the point
       * rather than a shortcut. The thing being measured is ONE tick -- the
       * single tick the impulse lands on -- and a keyboard event dispatched
       * from the test runner lands wherever it lands relative to a 30 Hz
       * poll. Worse, it can land in the wrong ORDER: if Space is seen a tick
       * before D then move.heading is still dead ahead when the impulse
       * fires and the bug this test exists for goes undetected. Setting both
       * in the same tick is the case the player actually hits and the only
       * one that is reproducible. The sprint itself stays on real keys,
       * because that is state the input layer latches rather than polls.
       */
      const rows = await page.evaluate((want) => new Promise((resolve) => {
        const noa = window.noa
        const body = noa.ents.getPhysics(noa.playerEntity).body
        const out = []
        let armed = false
        const stop = () => {
          noa.inputs.state.right = false
          noa.inputs.state.jump = false
          noa.off('tick', fn)
        }
        const fn = () => {
          out.push([body.velocity[0], body.velocity[2]])
          if (!armed && out.length >= 3) {
            armed = true
            noa.inputs.state.right = true
            noa.inputs.state.jump = true
          }
          if (out.length >= want) { stop(); resolve(out) }
        }
        noa.on('tick', fn)
      }), 8)

      // The impulse tick is unmistakable in the trace: strafing moves the
      // velocity by about 1.2 b/s per tick and the impulse moves it by 4.
      let best = 1, bestLen = 0
      for (let i = 1; i < rows.length; i++) {
        const len = Math.hypot(rows[i][0] - rows[i - 1][0], rows[i][1] - rows[i - 1][1])
        if (len > bestLen) { bestLen = len; best = i }
      }
      const dvx = rows[best][0] - rows[best - 1][0]
      const dvz = rows[best][1] - rows[best - 1][1]

      // It is the sprint-jump impulse we found, and not some collision.
      expect(bestLen, `largest velocity step was ${bestLen.toFixed(4)} b/s`)
        .toBeGreaterThan(3)

      // Facing is +X, so the sideways axis is Z. Resolve against the
      // camera rather than against the axis names, since a future heading
      // change in the fixture should not quietly turn this into a tautology.
      const h = await page.evaluate(() => window.noa.camera.heading)
      const forward = dvx * Math.sin(h) + dvz * Math.cos(h)
      const sideways = Math.abs(dvx * Math.cos(h) - dvz * Math.sin(h))

      expect(sideways,
        `the sprint-jump impulse put ${sideways.toFixed(4)} b/s sideways in one tick; ` +
        `vanilla's whole air-strafe budget for a tick is ${VANILLA_AIR_STRAFE_TICK.toFixed(4)}`)
        .toBeLessThanOrEqual(VANILLA_AIR_STRAFE_TICK)

      // And strafing cost it nothing forward, which is the other half of
      // vanilla's rule: the impulse is 4 b/s along the facing, full stop.
      expect(Math.abs(forward - 4),
        `forward impulse was ${forward.toFixed(4)} b/s, want 4`)
        .toBeLessThan(0.2)
    } finally {
      for (const k of ['KeyW', 'ControlLeft']) await page.keyboard.up(k)
    }
  })

  test('steering in the air is one fifth of steering on the ground', async ({ page }) => {
    /*
     * One tick of strafe, from a steady walk, on the ground and then in the
     * air. Walk rather than sprint on purpose -- a sprint jump has the
     * impulse in it and would swamp the thing being measured.
     *
     * The strafe is driven by writing noa.inputs.state rather than by a real
     * key, which is the one place in this suite that is justified: the
     * measurement is "what does ONE tick buy", and a keyboard event cannot be
     * aimed at a particular tick of a 30 Hz poll. The write is undone before
     * the promise resolves so nothing leaks into the next test.
     */
    const oneTick = (air) => page.evaluate((isAir) => new Promise((resolve) => {
      const noa = window.noa
      const body = noa.ents.getPhysics(noa.playerEntity).body
      const samples = []
      let phase = isAir ? 'jump' : 'settle'
      const stop = (value) => { noa.inputs.state.right = false; noa.off('tick', fn); resolve(value) }
      const fn = () => {
        const airborne = body.atRestY() >= 0
        if (phase === 'jump') {
          noa.inputs.state.jump = true
          if (airborne) { noa.inputs.state.jump = false; phase = 'rise' }
          return
        }
        // One tick of clear air (or of standing) before the strafe, so the
        // "before" sample is not the jump impulse's own tick.
        if (phase === 'rise' || phase === 'settle') { phase = 'strafe'; return }
        if (phase === 'strafe') { samples.push(body.velocity[2]); noa.inputs.state.right = true; phase = 'read'; return }
        samples.push(body.velocity[2])
        // THREE samples, not two. noa polls inputs in a system that runs
        // before the tick event this handler is on, so a write made here is
        // first seen by the movement system one tick later and its effect on
        // velocity is first readable the tick after that. samples[1] is that
        // dead tick; the interval that actually has one tick of strafe in it
        // is samples[1] -> samples[2].
        if (samples.length < 3) return
        stop(Math.abs(samples[2] - samples[1]))
      }
      noa.on('tick', fn)
    }), air)

    await page.keyboard.down('KeyW')
    let ground, airborne
    try {
      await page.waitForTimeout(1200)
      ground = await oneTick(false)
      await waitTicks(page, 20)
      airborne = await oneTick(true)
    } finally {
      await page.keyboard.up('KeyW')
    }

    expect(ground, `ground strafe bought ${ground.toFixed(4)} b/s in a tick`).toBeGreaterThan(0.5)
    const ratio = airborne / ground
    expect(ratio,
      `air ${airborne.toFixed(4)} / ground ${ground.toFixed(4)} = ${ratio.toFixed(4)}, want ${MC_AIR_CONTROL}`)
      .toBeGreaterThan(MC_AIR_CONTROL - 0.02)
    expect(ratio,
      `air ${airborne.toFixed(4)} / ground ${ground.toFixed(4)} = ${ratio.toFixed(4)}, want ${MC_AIR_CONTROL}`)
      .toBeLessThan(MC_AIR_CONTROL + 0.02)
  })

  test('jumping while you walk does not speed you up', async ({ page }) => {
    /*
     * The other half of the report, and the half that turned out not to be a
     * bug here. In Minecraft a WALKING player who bunny-hops goes SLOWER, not
     * faster -- about 9% slower. The tick you jump on still pays the block's
     * friction, and the eleven airborne ticks after it accelerate at 0.02
     * instead of 0.1, which is not enough to hold 4.317. Only a SPRINTING
     * player gains from hopping, and that gain is the 0.2/tick impulse, not
     * the drag difference.
     *
     * noa has no ground/air friction split at all -- runningFriction is 0 and
     * airDrag is the same 0.1 whether or not you are touching anything -- so
     * a walking hop here costs nothing and gains nothing: both measure
     * 4.2883 b/s to four decimals. That is 10% quick against vanilla's hop
     * and it is deliberately left alone, because the only way to reproduce
     * vanilla's penalty is vanilla's per-tick friction, and physics.js has
     * already recorded why that is not worth re-opening (it is what the jump
     * apex, the sprint-jump average and the walk speed are all balanced on).
     *
     * What this test guards is the direction that WOULD be a bug: a hop that
     * is faster than a walk. That is what the sprint-jump impulse leaking out
     * of its `sprinting` guard would look like, and it is exactly the shape
     * of the original report.
     */
    const walk = await measureSpeed(page, ['KeyW'])
    await waitTicks(page, 20)
    const hopping = await measureSpeed(page, ['KeyW', 'Space'], { sampleMs: 1500 })

    expect(hopping,
      `walk-hopping ${hopping.toFixed(4)} b/s vs walking ${walk.toFixed(4)} b/s`)
      .toBeLessThanOrEqual(walk * 1.005)
  })
})
