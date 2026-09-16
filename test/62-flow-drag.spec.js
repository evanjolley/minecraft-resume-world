import { test, expect } from './fixtures.js'
import { teleport, look, waitFrames, waitTicks } from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * EVERY BODY IN THE WATER GETS THE WATER.
 *
 * Reported from play: "I seem to flow the correct speed in water, Evan moves
 * super fast."
 *
 * 57-flowing-water already proves the current MOVES Evan. This file is about
 * how FAST, and it is a comparison rather than a number: the same channel, the
 * same cell, the same current, measured once with the player standing in it
 * and once with Evan. Two humanoids in one stream have no business drifting at
 * different speeds, and that difference is the entire bug.
 *
 * WHERE THE SPEED COMES FROM, so a failure can be read rather than guessed.
 *
 * src/fluids.js fits `fluidDrag` backwards from Minecraft's terminal speeds:
 * 3.529 in water. The flow push is 5.6 b/s^2. voxel-physics-engine integrates
 * `v = (v + a*dt)(1 - drag*dt/mass)`, so a body settles at `a/drag - a*dt/m`
 * -- about 1.4 b/s at full submersion, and faster in a one-deep channel where
 * noa fades the drag by `1 - (1 - ratio)^2` for a box half out of the water.
 *
 * The tuning tick that sets that coefficient ran on ONE body, closed over at
 * construction: `const player = noa.playerEntity`. The push, added later,
 * iterates every body. So Evan took the full shove with his ground friction
 * zeroed and kept voxel-physics-engine's default `fluidDrag` of 0.4 -- an
 * order of magnitude less water to push through. He did not swim faster, he
 * swam through almost nothing.
 *
 * NO ABSOLUTE SPEED IS ASSERTED, on purpose. The exact terminal in a
 * one-block-deep channel depends on `ratioInFluid`, which depends on how much
 * of a 1.8- or 1.85-tall box a 8/9-tall cell of water covers -- a number this
 * file would have to re-derive from the integrator to state, and that
 * derivation belongs in src/fluids.js where it already is. The claim here is
 * that the two bodies agree, plus a loose sanity bound so "they agree" cannot
 * be satisfied by both being wrong in the same direction.
 *
 * MEASURED, for anyone reading a future failure: in this channel the player
 * peaks at 1.768 b/s over 45 ticks and Evan at 1.799, both carrying
 * fluidDrag 3.529. Before the fix Evan reached 6.533 and was still climbing.
 *
 * IT DISCRIMINATES, AND THE MUTATION WAS RUN. See the note above the first
 * test for the exact output.
 */

/*
 * 57-flowing-water's channel, restated rather than imported.
 *
 * A one-wide run so the current is one-dimensional: an open tray spreads
 * radially and every cell then has shallower water on three sides, which is
 * correct and unmeasurable. Same geometry and same y as 57 -- these two files
 * share a page, they both build here, and each rebuilds from scratch, so the
 * cheapest thing is for them to agree about where "here" is.
 */
const Y = 240
const GLASS = 302
const STONE = 3
const WATER_SOURCE = 636

/** The cell both bodies start in: inside the run, clear of the source. */
const START_X = 1.5

/**
 * How long each body is watched, in ticks. 45 is 1.5 s at noa's 30 Hz.
 *
 * Long enough for the drag to win -- the approach to terminal is geometric
 * with a time constant of about 0.4 s -- and short enough that a body moving
 * at the BROKEN speed is still being measured rather than having already left
 * the eight-block run. It does not matter much either way, because what is
 * read out is the peak speed reached, which a body that runs off the end has
 * already reached on the way.
 */
const WINDOW_TICKS = 45

async function buildChannel(page) {
  await teleport(page, 0.5, Y + 2, 0.5)
  await page.evaluate(() => {
    const flow = window.game.fluids.flow
    flow.setEnabled(false)
    flow.reset()
  })
  await page.waitForFunction(([y, glass, stone]) => {
    const noa = window.noa
    for (let x = -3; x <= 15; x++) {
      for (let z = -4; z <= 7; z++) {
        for (let dy = -1; dy < 5; dy++) noa.setBlock(0, x, y + dy, z)
      }
    }
    for (let x = -1; x <= 13; x++) {
      noa.setBlock(stone, x, y - 1, 0)
      for (let dy = 0; dy < 2; dy++) {
        noa.setBlock(stone, x, y + dy, -1)
        noa.setBlock(glass, x, y + dy, 1)
      }
    }
    for (let dy = 0; dy < 2; dy++) noa.setBlock(stone, -1, y + dy, 0)
    /*
     * A dry pad beside the channel, and it is load-bearing rather than
     * scenery. Each measurement parks the OTHER body out of the way, and the
     * obvious place -- six blocks up in the cleared air -- drops it a hundred
     * blocks toward the real terrain while the measurement runs. A body in
     * free fall is a body the next step of this test has to catch.
     */
    for (let x = 5; x <= 7; x++) for (let z = 5; z <= 7; z++) noa.setBlock(stone, x, y - 1, z)
    // Built INSIDE the poll and probed at both ends: the channel spans several
    // chunks that arrive independently (41-fluid-flow paid for this lesson).
    return noa.getBlock(13, y - 1, 0) === stone && noa.getBlock(-1, y - 1, 0) === stone
  }, [Y, GLASS, STONE], { timeout: 30_000, polling: 100 })
}

/*
 * Pour, and drive the engine to a standstill by hand.
 *
 * `flow.run` rather than waiting: buildChannel switched the engine off, so the
 * world's clock is not spreading anything and the spread happens on a clock
 * this file controls. The measurement that follows then runs against water
 * that is finished moving, which is the only way "the same current" means
 * anything for two bodies measured a second apart.
 */
const pour = (page) => page.evaluate(([y, water]) => {
  window.noa.setBlock(water, 0, y, 0)
  const flow = window.game.fluids.flow
  for (let i = 0; i < 4000; i++) { flow.run(1, 50); if (flow.pendingCount === 0) return i * 50 }
  return -1
}, [Y, WATER_SOURCE])

/** Evan's entity id, or null if this build has no NPC. */
const evanOf = (page) => page.evaluate(() => window.game.aiEvan?.entity ?? null)

/**
 * Drop one body in the run, watch it for a while, and report what the water
 * did to it.
 *
 * SAMPLED EVERY TICK, and the headline number is the PEAK horizontal speed
 * rather than the average. Average speed over a fixed window silently rewards
 * a body that runs out of channel: the broken Evan crosses the eight-block run
 * in well under a second, leaves the water, loses the push and coasts, and his
 * average over 1.5 s comes back looking almost reasonable. The peak is the
 * thing he actually reached, and nothing that happens afterwards can lower it.
 *
 * The other body is parked FAR AWAY AND DRY. Not tidiness: a body in the
 * channel is a body the current is also pushing, and two boxes in a one-wide
 * run collide. Dry matters for a second reason -- `noa.physics.fluidDensity`
 * is one global for the whole simulation, so whoever is in the water changes
 * the buoyancy every body feels. Parking the other one keeps each measurement
 * a measurement of one body.
 *
 * BUOYANCY DOES NOT ENTER THE COMPARISON ANYWAY, which is worth stating
 * because the asymmetry is real: the player writes that global for himself and
 * Evan cannot. Both bodies rest on the channel floor either way (water's net
 * downward acceleration is 2 b/s^2, not zero), ground friction is zeroed by
 * the push while the current is on them, and the horizontal terminal speed
 * `a/drag - a*dt/m` has no gravity term in it at all.
 */
const rideTheCurrent = (page, entity, ticks) => page.evaluate(([id, n, x0, y]) => {
  const noa = window.noa
  const other = id === noa.playerEntity ? window.game.aiEvan?.entity : noa.playerEntity
  // The dry pad beside the channel: out of the run, out of the water, and
  // standing on something rather than falling past the world.
  if (other != null) noa.ents.setPosition(other, 6.5, y, 6.5)

  noa.ents.setPosition(id, x0, y, 0.5)
  const body = noa.ents.getPhysics(id).body
  body.velocity[0] = body.velocity[1] = body.velocity[2] = 0

  return new Promise((resolve) => {
    const start = noa.ents.getPosition(id)[0]
    const speeds = []
    let drag = null
    let ratio = 0
    const fn = () => {
      speeds.push(Math.hypot(body.velocity[0], body.velocity[2]))
      // Read INSIDE the window: the fluid tuning writes it every tick and
      // rewrites it to -1 the moment the body is out, so a read afterwards
      // would report the dry answer for a body that was wet the whole time.
      if (drag === null || body.inFluid) drag = body.fluidDrag
      ratio = Math.max(ratio, body.ratioInFluid)
      if (speeds.length < n) return
      noa.off('tick', fn)
      resolve({
        peak: Math.max(...speeds),
        last: speeds[speeds.length - 1],
        moved: noa.ents.getPosition(id)[0] - start,
        drag,
        ratio,
        speeds,
      })
    }
    noa.on('tick', fn)
  })
}, [entity, ticks, START_X, Y])

test.describe('the current carries every body at the same speed', () => {
  /*
   * IT DISCRIMINATES, AND THE MUTATION WAS RUN. `tuneOthers()` in
   * src/fluids.js was commented out of the tick -- which is exactly the state
   * the bug was reported in, the player tuned and nobody else -- and this
   * test failed with:
   *
   *   Error: Evan peaked at 6.533 b/s against the player's 1.768 -- 3.70x
   *   expect(received).toBeLessThan(expected)
   *   Expected: < 1.15
   *   Received:   3.69552232002056
   *
   * ...and he was still accelerating when the window closed, having crossed
   * 5.27 blocks of an 8-block run against the player's 2.06. Restored, the
   * same run gives Evan 1.799 against the player's 1.768 -- 1.02x, which is
   * the two inches of extra height showing up as slightly less of him under
   * the surface (ratioInFluid 0.541 against 0.556) and so slightly less drag.
   */
  test('Evan drifts down the run at the speed the player does', async ({ page }) => {
    await buildChannel(page)
    await pour(page)

    const evan = await evanOf(page)
    expect(evan, 'there is a second body in the world to compare against').not.toBeNull()

    const player = await page.evaluate(() => window.noa.playerEntity)
    const p = await rideTheCurrent(page, player, WINDOW_TICKS)
    const e = await rideTheCurrent(page, evan, WINDOW_TICKS)

    // The measurement is only worth reading if the water moved them at all --
    // otherwise "they agree" is satisfied by two bodies standing still, which
    // is how a push that stopped working would pass a comparison test.
    expect(p.moved, `the player drifted ${p.moved.toFixed(2)} blocks`).toBeGreaterThan(0.5)
    expect(e.moved, `Evan drifted ${e.moved.toFixed(2)} blocks`).toBeGreaterThan(0.5)

    /*
     * 15%, and the tolerance is not arbitrary. The two bodies are not
     * identical -- Evan is 1.85 blocks to the player's 1.8 (54-npc-height) --
     * and in a channel one block deep that is a different fraction of the box
     * under the surface, which noa turns into a different effective drag via
     * `1 - (1 - ratio)^2`. About 3% of speed. 15% leaves room for that and for
     * the tick the measurement happens to start on, and is nowhere near the
     * order of magnitude the missing drag was worth.
     */
    const ratio = e.peak / p.peak
    const how = `Evan peaked at ${e.peak.toFixed(3)} b/s against the player's `
      + `${p.peak.toFixed(3)} -- ${ratio.toFixed(2)}x`
    expect(ratio, how).toBeGreaterThan(0.85)
    expect(ratio, how).toBeLessThan(1.15)

    /*
     * And a loose absolute bound, so "they agree" cannot be satisfied by both
     * being broken the same way. Minecraft's own swimming speed is 2 b/s under
     * full control; drifting passively at more than twice that is the thing
     * the owner could see from across the island.
     */
    expect(e.peak, `Evan drifting at ${e.peak.toFixed(3)} b/s is not a drift`)
      .toBeLessThan(4)
  })

  /*
   * IT DISCRIMINATES, AND THE MUTATION WAS RUN. Same mutation as above:
   *
   *   Error: Evan is in the water and has the engine default drag
   *   expect(received).not.toBe(expected) // Object.is equality
   *   Expected: not -1
   */
  test('the fitted water drag reaches every body, and is given back on dry land',
    async ({ page }) => {
      await buildChannel(page)
      await pour(page)
      const evan = await evanOf(page)

      const wet = await page.evaluate(([id, y]) => {
        const noa = window.noa
        noa.ents.setPosition(id, 3.5, y, 0.5)
        return new Promise((resolve) => {
          // Two ticks: one for the solver to place him, one for the tuning to
          // see where he ended up.
          let left = 2
          const fn = () => {
            if (--left > 0) return
            noa.off('tick', fn)
            const body = noa.ents.getPhysics(id).body
            resolve({ drag: body.fluidDrag, player: noa.ents.getPhysics(noa.playerEntity).body.fluidDrag })
          }
          noa.on('tick', fn)
        })
      }, [evan, Y])

      expect(wet.drag, 'Evan is in the water and has the engine default drag').not.toBe(-1)
      /*
       * The SAME number as the player's, not merely a number. `dragFor` is
       * mass-dependent through its one-tick correction (`a*dt/m`) and both
       * bodies carry noa's default mass of 1, so the two coefficients are the
       * same fit and must come out bit-identical. A difference here means
       * someone gave Evan a mass or a second set of constants.
       */
      await teleport(page, 3.5, Y, 0.5)
      await waitTicks(page, 2)
      const playerDrag = await page.evaluate(() =>
        window.noa.ents.getPhysics(window.noa.playerEntity).body.fluidDrag)
      expect(wet.drag).toBe(playerDrag)

      // ...and out. A body left carrying water drag in the air walks through
      // treacle, which is the obvious way to get this wrong and is nowhere
      // near the water anyone would go looking in.
      const dry = await page.evaluate(([id, y]) => {
        const noa = window.noa
        noa.ents.setPosition(id, 10.5, y, 0.5)   // past the end of the run
        return new Promise((resolve) => {
          let left = 2
          const fn = () => {
            if (--left > 0) return
            noa.off('tick', fn)
            resolve(noa.ents.getPhysics(id).body.fluidDrag)
          }
          noa.on('tick', fn)
        })
      }, [evan, Y])
      expect(dry, 'the -1 sentinel was not given back').toBe(-1)
    })

  test('evidence: Evan standing in the run, seen through the glass', async ({ page }) => {
    await buildChannel(page)
    await pour(page)
    const evan = await evanOf(page)
    await page.evaluate(([id, y]) => {
      const noa = window.noa
      noa.ents.setPosition(id, 3.5, y, 0.5)
      /*
       * Pinned, not stood, and then unpinned -- the camera wants to be at the
       * waterline, which is inside the channel's wall. 57-flowing-water's note
       * on this is the one to read: a pin left running holds the player in the
       * air and the next spec's reset waits forever for him to land.
       */
      window.__dragPin = () => noa.entities.setPosition(noa.playerEntity, 3.5, y - 0.5, 6.5)
      noa.on('tick', window.__dragPin)
    }, [evan, Y])
    await look(page, { heading: Math.PI, pitch: 0.05 })
    await waitFrames(page, 8)
    await shot(page, 'flow-drag-evan-in-the-run')
    await page.evaluate(() => { window.noa.off('tick', window.__dragPin); window.__dragPin = null })
    // Put the world back the way the next spec expects to find it.
    await page.evaluate(() => window.game.fluids.flow.setEnabled(true))
  })
})
