import { test, expect } from './fixtures.js'
import { teleport, look, waitFrames } from './helpers/world.js'
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
