import { test, expect } from './fixtures.js'
import { teleport, look, waitFrames, waitTicks } from './helpers/world.js'
import { armAudio } from './helpers/audio.js'
import { shot } from './helpers/shots.js'

/*
 * FLOWING WATER HAS A SHAPE.
 *
 * Reported from play: "there is no FLOWING water... all of the water blocks
 * are WHOLE blocks... Like full block of water, flow outward that gets more
 * and more short, eventually is very short at the end of the run and it
 * stops."
 *
 * 41-fluid-flow already proves the water GOES somewhere. This file proves it
 * gets SHORTER on the way, that the sheet is continuous rather than a
 * staircase, and that the mesh on the screen agrees with the model.
 *
 * MINECRAFT'S NUMBERS, restated rather than imported -- same bargain
 * 41-fluid-flow makes about its own:
 *
 *   BlockLiquid.getLiquidHeightPercent(meta):  if (meta >= 8) meta = 0;
 *                                              return (meta + 1) / 9.0F;
 *     -- MCP-919, net/minecraft/block/BlockLiquid.java. That is the GAP above
 *        the fluid; World.handleMaterialAcceleration reads the surface as
 *        `(y + 1) - getLiquidHeightPercent(level)`, so a cell at level L is
 *        (8 - L)/9 tall. Source 8/9 = 0.889, level 7 = 1/9 = 0.111.
 *
 * IT DISCRIMINATES, AND THE MUTATION WAS RUN. `ownHeight` in
 * src/fluidGeometry.js was changed to `return 1` -- every level a full cube,
 * which is the bug being fixed -- and three of the four tests failed:
 *
 *   the run gets shorter ...   Expected: 0.8888888888888888  Received: 1
 *   the drop per block ...     step 3  Expected: 0.1111111111111111  Received: 0
 *   the mesh ... carries ...   Expected: >= 5  Received: 1
 *
 * The fourth is the screenshot, which asserts nothing and says so.
 *
 *   the corner average, LiquidBlockRenderer.getHeight:
 *        if (f1 >= 0.8F) { f += f1 * 10.0F; i += 10; } else { f += f1; ++i; }
 *     -- a source outvotes ten shallow neighbours, which is what keeps the
 *        water beside a source at nearly the source's height.
 */
const MC = {
  SOURCE_HEIGHT: 8 / 9,
  LEVEL_7_HEIGHT: 1 / 9,
}

/*
 * A ONE-WIDE CHANNEL, not an open tray, and not for tidiness.
 *
 * A source on flat ground spreads radially, so every cell of the run has
 * shallower water on three sides and the corner average is pulled in three
 * directions at once. That is correct and it is unreadable as a profile. The
 * channel makes the run one-dimensional, so "shorter each step" is a
 * statement about a single sequence of numbers.
 *
 * The near wall is GLASS so the screenshot can see the profile through it.
 * y=240 for the reason 41-fluid-flow gives at length: above everything any
 * other spec in this shared page builds.
 */
const Y = 240
const GLASS = 302
const STONE = 3

async function buildChannel(page) {
  await teleport(page, 0.5, Y + 9, 0.5)
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
    // Build INSIDE the poll and probe both ends: the channel spans several
    // chunks that arrive independently (41-fluid-flow paid for this lesson).
    return noa.getBlock(13, y - 1, 0) === stone && noa.getBlock(-1, y - 1, 0) === stone
  }, [Y, GLASS, STONE], { timeout: 30_000, polling: 100 })
}

const pour = (page) => page.evaluate(([y]) => {
  window.noa.setBlock(636, 0, y, 0)
  const flow = window.game.fluids.flow
  for (let i = 0; i < 4000; i++) { flow.run(1, 50); if (flow.pendingCount === 0) return i * 50 }
  return -1
}, [Y])

/** Each cell's OWN height along the run, x = 0..9. Vanilla's (8 - L)/9. */
const profile = (page) => page.evaluate(([y]) => {
  const out = []
  for (let x = 0; x <= 9; x++) out.push(window.game.fluids.flow.heightAt(x, y, 0))
  return out
}, [Y])

/*
 * The height of the SURFACE at each block boundary along the run.
 *
 * Not the same list. A cell's own height is a step function; the corner
 * average is what the mesh actually draws, and it is the reason the two do
 * not agree -- a corner sits between two cells and splits the difference,
 * which is exactly what turns a staircase into a sheet.
 */
const corners = (page) => page.evaluate(([y]) => {
  const out = []
  for (let x = 0; x <= 9; x++) out.push(window.game.fluids.flow.cornerHeightAt(x, y, 0))
  return out
}, [Y])

test.describe('flowing water has a shape', () => {
  test('the run gets shorter every block and ends at nothing', async ({ page }) => {
    await buildChannel(page)
    await pour(page)
    const h = await profile(page)

    // The source is 8/9 of a block -- vanilla's source is NOT a full cube.
    expect(h[0]).toBeCloseTo(MC.SOURCE_HEIGHT, 6)

    // Shorter every single step, all the way out.
    for (let x = 1; x <= 7; x++) {
      expect(h[x], `cell ${x} must be shorter than cell ${x - 1}`).toBeLessThan(h[x - 1])
      expect(h[x - 1] - h[x], `step ${x}`).toBeCloseTo(1 / 9, 6)
    }

    // "very short at the end of the run": the last water cell is a ninth of a
    // block, and past it there is nothing at all.
    expect(h[7]).toBeCloseTo(MC.LEVEL_7_HEIGHT, 6)
    expect(h[8]).toBe(0)

    // And nothing in the run is a whole block, which is the complaint.
    expect(Math.max(...h)).toBeLessThan(1)
  })

  test('the drop per block is even, so the sheet reads as a slope not a stair', async ({ page }) => {
    await buildChannel(page)
    await pour(page)
    const h = await corners(page)
    /*
     * Corner averaging is the whole reason this is a sheet. Each step down is
     * one ninth of a block, because each corner sits between two cells whose
     * own heights differ by 1/9 -- so the surface is CONTINUOUS across a cell
     * boundary and no vertical riser is needed anywhere.
     *
     * That matters beyond looks: noa's greedy mesher refuses to draw a face
     * between two non-opaque blocks ("for now we draw neither"), so a riser
     * between two water levels is a face this engine CANNOT produce. A
     * continuous surface is not a nicety here, it is the only thing that has
     * no holes in it.
     */
    for (let x = 3; x <= 7; x++) {
      expect(h[x - 1] - h[x], `step ${x}`).toBeCloseTo(1 / 9, 3)
    }
    // ...and the corner surface never reaches a whole block anywhere in the
    // run, which is what "the sheet lies below the block ceiling" means.
    expect(Math.max(...h.slice(1))).toBeLessThan(1)
  })

  test('the mesh on the screen actually carries those heights', async ({ page }) => {
    await buildChannel(page)
    await pour(page)
    /*
     * The model being right proves nothing about the picture. noa meshes water
     * as full cubes and this repo re-shapes the FINISHED vertex buffers
     * (src/fluidGeometry.js), so the honest check is to read the buffers back
     * and look for vertices standing at a fraction of a block inside the water
     * row -- which a cube mesh, by construction, can never have.
     */
    const fractions = await page.evaluate(() => {
      const hits = new Set()
      for (const mesh of window.noa.rendering.getScene().meshes) {
        const p = mesh.getVerticesData('position')
        if (!p) continue
        for (let i = 1; i < p.length; i += 3) {
          const fr = p[i] - Math.floor(p[i])
          if (fr > 0.001) hits.add(Math.round(fr * 1000) / 1000)
        }
      }
      return [...hits].sort((a, b) => a - b)
    })
    /*
     * EIGHTEENTHS, not ninths, and the factor of two is the proof that the
     * corner average ran. A cell's own height is a whole number of ninths; a
     * corner between two cells one level apart lands exactly halfway between
     * two ninths. Half of a ninth is an eighteenth. Nothing else in this
     * scene stands at one.
     */
    const steps = fractions.filter(f => Math.abs(f * 18 - Math.round(f * 18)) < 0.003)
    expect(steps.length).toBeGreaterThanOrEqual(5)
    expect(Math.max(...steps)).toBeGreaterThan(0.6)
    expect(Math.min(...steps)).toBeLessThan(0.2)
  })

  test('evidence: the run, side on, through the glass wall', async ({ page }) => {
    await buildChannel(page)
    await pour(page)
    await page.evaluate(([y]) => {
      const noa = window.noa
      // Pinned rather than stood: the camera wants to be at the waterline,
      // which is inside the channel's floor. Removed at the end of the test --
      // a pin left running holds the player in the air and the next spec's
      // reset waits forever for him to land (41-fluid-flow paid for that one).
      window.__shapePin = () => noa.entities.setPosition(noa.playerEntity, 4.5, y - 1.25, 5.5)
      noa.on('tick', window.__shapePin)
    }, [Y])
    await look(page, { heading: Math.PI, pitch: 0.02 })
    await waitFrames(page, 8)
    await shot(page, 'flowing-water-profile')
    await page.evaluate(() => { window.noa.off('tick', window.__shapePin); window.__shapePin = null })
  })
})

/*
 * THE PUSH.
 *
 * Reported from play: "Water should be pushing me and Evan!"
 *
 *   World.handleMaterialAcceleration, MCP-919:
 *       vec3 = vec3.normalize();  double d1 = 0.014D;
 *       entityIn.motionX += vec3.xCoord * d1; ...
 *
 *   0.014 b/tick^2 is 5.6 b/s^2 at 400 ticks^2 per second^2, which is the
 *   conversion src/fluids.js derives for every other fluid constant.
 *
 * IT DISCRIMINATES, AND THE MUTATION WAS RUN. `PUSH_PER_TICK.water` in
 * src/fluids.js was set to 0 and all three failed:
 *
 *   the push is 5.6 ...       Expected: 5.6000000000000005  Received: 0
 *   carries the player ...    the player drifted downstream  Expected: > 0.5  Received: 0
 *   pushes Evan as well ...   Evan drifted downstream  Expected: > 0.5  Received: 0
 */
const PUSH_ACCEL = 0.014 * 400

test.describe('flowing water pushes what is standing in it', () => {
  test('the push is 5.6 b/s^2 and it points downstream', async ({ page }) => {
    await buildChannel(page)
    await pour(page)
    // Feet on the channel floor, in the middle of the run.
    await teleport(page, 3.5, Y, 0.5)
    const a = await page.evaluate(() =>
      window.game.fluids.flow.push.accelOn(window.noa.playerEntity))
    expect(Math.hypot(a[0], a[1], a[2])).toBeCloseTo(PUSH_ACCEL, 4)
    // The channel runs east from the source at x=0, so the push is +x and
    // nothing else: the walls make the z component exactly zero.
    expect(a[0]).toBeGreaterThan(0)
    expect(Math.abs(a[2])).toBeLessThan(1e-9)
  })

  test('standing in the current carries the player downstream', async ({ page }) => {
    await buildChannel(page)
    await pour(page)
    await teleport(page, 2.5, Y, 0.5)
    const start = await page.evaluate(() => window.noa.ents.getPosition(window.noa.playerEntity)[0])
    // No keys are pressed. Anything that moves him is the water.
    await page.waitForTimeout(2000)
    const end = await page.evaluate(() => window.noa.ents.getPosition(window.noa.playerEntity)[0])
    expect(end - start, 'the player drifted downstream').toBeGreaterThan(0.5)
  })

  test('it pushes Evan as well, and he has his own body', async ({ page }) => {
    await buildChannel(page)
    await pour(page)
    const drift = await page.evaluate(async ([y]) => {
      const noa = window.noa
      // Every simulated body except the player: that is Evan.
      const bodies = noa.ents.getStatesList(noa.ents.names.physics)
        .map(s => s.__id).filter(id => id !== noa.playerEntity)
      if (bodies.length === 0) return null
      const evan = bodies[0]
      noa.ents.setPosition(evan, 2.5, y, 0.5)
      // The player stands well clear so nothing they do reaches him.
      noa.ents.setPosition(noa.playerEntity, 4.5, y + 6, 6.5)
      const x0 = noa.ents.getPosition(evan)[0]
      await new Promise(r => setTimeout(r, 2000))
      return noa.ents.getPosition(evan)[0] - x0
    }, [Y])
    expect(drift, 'there is a second body in the world to push').not.toBeNull()
    expect(drift, 'Evan drifted downstream').toBeGreaterThan(0.5)
  })
})

/*
 * THE SOUND.
 *
 * Vanilla, BlockLiquid.randomDisplayTick (MCP-919):
 *
 *     if (this.blockMaterial == Material.water) {
 *         int i = state.getValue(LEVEL);
 *         if (i > 0 && i < 8) {
 *             if (rand.nextInt(64) == 0) {
 *                 worldIn.playSound(..., "liquid.water", ...);
 *             }
 *         }
 *     }
 *
 * `i > 0 && i < 8` is FLOWING water and nothing else: a source is level 0 and
 * a still pool is silent. That is the whole assertion below, and the control
 * is a source block standing where the flowing one was.
 *
 * NO NEW SAMPLE AND NO CHANGE TO build-sounds.mjs. `liquid/water.ogg` was
 * already extracted and sounds.js already declares it as `waterAmbient` for
 * the submerged ambience -- checked before planning to add one. The FREE
 * build is another matter and is stated at the call site: sounds-src/free
 * carries no liquid sample of any kind, so a deploy has no splash, no swim
 * and no trickle. Quiet, not broken.
 *
 * IT DISCRIMINATES, AND BOTH MUTATIONS WERE RUN.
 *   FLOW_SOUND_CHANCE -> 0 in src/sounds.js:
 *     Error: flowing water is heard
 *     Expected value: "liquid/water"   Received array: []
 *   the `m.level === 0 || m.falling` exclusion removed, so sources count too:
 *     Error: a still source is silent
 *     Expected value: not "liquid/water"
 *     Received array: ["liquid/water", "liquid/water", "liquid/water",
 *                      "liquid/swim10", "liquid/water", ...]
 *
 * DETERMINISTIC, because vanilla's own rate is far too sparse to wait for --
 * 667 samples a tick at 1/64 over a seven-block run is one noise every
 * twenty-odd seconds. Math.random is stubbed with the four-value cycle the
 * sampler consumes per attempt (three offsets, then the roll), so the sampler
 * lands on the player's own cell and the roll passes.
 */
test.describe('flowing water can be heard', () => {
  const stubRandom = (page) => page.evaluate(() => {
    window.__realRandom = Math.random
    // 0.5 -> floor(0.5 * 33) - 16 = 0, so all three offsets pick the
    // player's own cell. 0 passes any probability.
    const cycle = [0.5, 0.5, 0.5, 0]
    let i = 0
    Math.random = () => cycle[i++ % cycle.length]
  })
  const unstubRandom = (page) => page.evaluate(() => {
    if (window.__realRandom) Math.random = window.__realRandom
  })

  test('standing in a run makes the water noise; a still source does not',
    async ({ world }) => {
      const page = world.page
      /*
       * `drain()` rather than `lastPlayed`, and it is not a preference: the
       * suite shares one page, lastPlayed is a page-lifetime value, and the
       * control read it stale from an earlier spec and passed a silent world
       * as noisy. Draining the capture makes each half of this test read only
       * what it caused.
       */
      const audio = await armAudio(page)
      await buildChannel(page)
      await pour(page)

      // The control FIRST: a SOURCE under the player's feet. Level 0, which
      // vanilla's `i > 0 && i < 8` excludes.
      await teleport(page, 4.5, Y, 0.5)
      await page.evaluate(([y]) => window.noa.setBlock(636, 4, y, 0), [Y])
      await audio.drain()
      await stubRandom(page)
      await waitTicks(page, 6)
      await unstubRandom(page)
      const still = await audio.drain()
      expect(still.map(r => r.name), 'a still source is silent')
        .not.toContain('liquid/water')

      // ...and now flowing water in the same cell.
      await page.evaluate(([y]) => window.noa.setBlock(642, 4, y, 0), [Y])
      await audio.drain()
      await stubRandom(page)
      await waitTicks(page, 6)
      await unstubRandom(page)
      const flowing = await audio.drain()
      expect(flowing.map(r => r.name), 'flowing water is heard')
        .toContain('liquid/water')
    })
})
