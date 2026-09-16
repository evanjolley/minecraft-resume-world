import { test, expect } from './fixtures.js'
import sharp from 'sharp'
import { teleport, look, waitFrames, HEADING } from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * What flowing water LOOKS LIKE, and where it GOES -- as opposed to
 * 41-fluid-flow, which owns how far it spreads and how fast.
 *
 * Reported from play: "the water texture is opaque which is not correct" and
 * "I put water on a hill and it spreads directly horizontal over the empty
 * space". Two separate faults with two separate causes, so two describe
 * blocks, and a screenshot at the end because the third thing the owner is
 * reacting to -- the profile of a full-height cube -- is not something an
 * assertion in this file can honestly answer.
 *
 * WHY A CLIFF AND NOT A TRAY. 41-fluid-flow deliberately walls its pour in,
 * because a waterfall would make every spread assertion a measurement of the
 * wrong thing. This file is the exact complement: the cliff IS the subject,
 * so the tray is the thing that would hide it.
 */

/*
 * A ledge in the sky, at the same altitude 41-fluid-flow picked and for the
 * same reason -- above the highest terrain in the patch, above every other
 * spec's scaffolding. Pushed out to x,z ~ 40 so that it does not share a
 * chunk with 41's tray, which the suite may have built minutes earlier and
 * which reset() does not undo.
 */
const Y = 244
const X0 = 40
const Z0 = 40
/** The last cell of the plateau: floor under it, open air past it. */
const EDGE = X0 + 6
const DROP = 8

const ID = {
  air: 0, stone: 3, gold: 86,
  water: 636,
  water_1: 639, water_7: 645, water_falling: 646,
}

/**
 * Build the cliff, and then check it is really there.
 *
 * Same bargain as 41-fluid-flow's buildTray and for the same reason: setBlock
 * is a silent no-op on a chunk that has not loaded, the chunks under a
 * seventeen-block plateau arrive independently, and the only honest gate is
 * reading the corners back. Building INSIDE the poll means nothing partial
 * survives a retry.
 */
async function buildCliff(page) {
  await teleport(page, X0 + 8.5, Y + 4, Z0 + 0.5)
  await page.evaluate(() => {
    const flow = window.game.fluids.flow
    flow.setEnabled(false)
    // Whatever an earlier spec file left queued spends this tick's budget
    // before our cliff gets a turn. 41-fluid-flow learned this the hard way.
    flow.reset()
  })

  await page.waitForFunction(([y, x0, z0, edge, drop]) => {
    const noa = window.noa
    const set = (id, x, yy, z) => noa.setBlock(id, x, yy, z)
    // Clear the whole volume first: air above, so a rerun does not pour into
    // last run's water.
    for (let x = x0 - 3; x <= x0 + 21; x++) {
      for (let z = z0 - 10; z <= z0 + 16; z++) {
        for (let dy = -drop - 2; dy <= 6; dy++) set(0, x, y + dy, z)
      }
    }
    /*
     * The plateau, WALLED ON THREE SIDES, open only to the east.
     *
     * The first cut of this rig left all four sides open, and the settle()
     * below never terminated: water ran off the north, south and west lips as
     * well, missed the valley floor, and fell two hundred blocks to the
     * superflat -- an endless frontier writing into chunks that are not even
     * loaded. A leaking rig does not fail an assertion, it hangs one.
     *
     * So the same bargain 41-fluid-flow's tray makes, with one wall left out.
     * The missing wall IS the subject of this file.
     */
    for (let x = x0 - 1; x <= edge; x++) {
      for (let z = z0 - 4; z <= z0 + 4; z++) set(3, x, y - 1, z)
    }
    for (let x = x0 - 1; x <= edge; x++) {
      for (let dy = 0; dy < 3; dy++) { set(3, x, y + dy, z0 - 4); set(3, x, y + dy, z0 + 4) }
    }
    for (let z = z0 - 4; z <= z0 + 4; z++) {
      for (let dy = 0; dy < 3; dy++) set(3, x0 - 1, y + dy, z)
    }
    /*
     * The valley basin the fall lands in, walled all the way round.
     *
     * Sized so the seven-block pool the landing spreads (the third test below
     * is the contract on it) never touches a wall: the column lands at
     * edge+1 = x0+7, so the pool reaches x0+14 east and x0 west, and z0 +/- 7.
     */
    for (let x = x0 - 1; x <= x0 + 18; x++) {
      for (let z = z0 - 8; z <= z0 + 8; z++) set(3, x, y - drop - 1, z)
    }
    for (let x = x0 - 2; x <= x0 + 19; x++) {
      for (let dy = 0; dy < 4; dy++) {
        set(3, x, y - drop - 1 + dy, z0 - 9); set(3, x, y - drop - 1 + dy, z0 + 9)
      }
    }
    for (let z = z0 - 9; z <= z0 + 9; z++) {
      for (let dy = 0; dy < 4; dy++) {
        set(3, x0 - 2, y - drop - 1 + dy, z); set(3, x0 + 19, y - drop - 1 + dy, z)
      }
    }
    // A perch for the camera, off to one side and below the plateau top so it
    // does not photobomb the ledge.
    set(3, x0 + 9, y - 3, z0 + 12)

    return [[x0, y - 1, z0], [edge, y - 1, z0], [x0, y - 1, z0 - 3], [edge, y - 1, z0 + 3],
      [x0, y - drop - 1, z0], [x0 + 18, y - drop - 1, z0]]
      .every(([a, b, c]) => noa.getBlock(a, b, c) === 3)
  }, [Y, X0, Z0, EDGE, DROP], { timeout: 30_000, polling: 100 })
}

/*
 * Hold the camera exactly where a shot wants it.
 *
 * The rig hangs in the sky and the shots stand in mid-air beside it, so
 * gravity is not a detail here: the first run of the translucency test
 * teleported to the block's eye level, fell five blocks onto the basin floor
 * in the frames before the screenshot, and photographed the sky above the
 * subject. Both patches came back identical, which reads exactly like opaque
 * water and was nothing of the kind.
 *
 * Lifted from 28-underwater, including the reason it is torn down in an
 * afterEach: a failed assertion skips the rest of the body, and a player
 * nailed into the air is inherited by every test after it in the shared world.
 */
const pin = (page, x, y, z) => page.evaluate(([a, b, c]) => {
  const noa = window.noa
  if (window.__pin) noa.off('tick', window.__pin)
  window.__pin = () => {
    noa.ents.setPosition(noa.playerEntity, [a, b, c])
    const body = noa.ents.getPhysics(noa.playerEntity).body
    body.velocity[0] = body.velocity[1] = body.velocity[2] = 0
  }
  noa.on('tick', window.__pin)
}, [x, y, z])

const unpin = (page) => page.evaluate(() => {
  if (!window.__pin) return
  window.noa.off('tick', window.__pin)
  window.__pin = null
})

/** Wind the flow engine until its queue is empty. 41-fluid-flow's settle(). */
const settle = (page, capMs = 120_000, step = 50) =>
  page.evaluate(([cap, s]) => {
    const flow = window.game.fluids.flow
    for (let t = 0; t < cap; t += s) {
      flow.run(1, s)
      if (flow.pendingCount === 0) return t
    }
    return -1
  }, [capMs, step])

const rowEast = (page, y, from, to, z = Z0) => page.evaluate(([yy, f, t, zz]) => {
  const out = []
  for (let x = f; x <= t; x++) out.push(window.noa.getBlock(x, yy, zz))
  return out
}, [y, from, to, z])

const column = (page, x, yTop, yBottom, z = Z0) => page.evaluate(([xx, a, b, zz]) => {
  const out = []
  for (let y = a; y >= b; y--) out.push(window.noa.getBlock(xx, y, zz))
  return out
}, [x, yTop, yBottom, z])

test.describe('water falls before it spreads', () => {
  test('a pour off a ledge does not sheet out over the drop', async ({ page }) => {
    await buildCliff(page)
    await page.evaluate(([x, y, z]) => window.noa.setBlock(636, x, y, z), [X0 + 2, Y, Z0])

    /*
     * Vanilla: a flowing block whose support is gone flows DOWN and does
     * nothing else -- BlockDynamicLiquid.updateTick puts the horizontal
     * branch in an `else` of `canFlowInto(pos.down())`, and gates it further
     * on `i == 0 || isBlocked(pos.down())`. `isBlocked` is
     * `blockMaterial.blocksMovement()`, which is FALSE for water, so a cell
     * standing on its own falling column never spreads sideways either.
     *
     * THE SETTLE IS PART OF THE ASSERTION, which is why the row is read
     * before it is checked rather than after. Water that spreads over air
     * does not merely end up in the wrong cells: each new cell falls, the
     * fall feeds the next cell out, and the pour never stops. The failure is
     * a queue that never empties, and without the row in the message it reads
     * as a timeout rather than as the bug.
     *
     * DISCRIMINATING -- verified by putting both halves of the old behaviour
     * back in src/fluids.js (`if (m) return true` in isBlocked, and the
     * `!me.falling` exemption in the sideways guard). It failed with
     *
     *   the pour never settled after 120 s; the row reads
     *   [636,639,640,641,642,643,644,645,0,0,0]
     *
     * -- 644 and 645 hanging two cells out past the last floored one, over
     * open air, with the queue still going. That is the reported bug
     * verbatim. Each half alone reproduces it: `if (m) return true` lets a
     * cell stand on its own falling column, and the `!me.falling` exemption
     * lets the column itself spread at every height of the drop.
     */
    const settled = await settle(page)
    const row = await rowEast(page, Y, X0 + 2, X0 + 12)
    expect(settled, `the pour never settled after 120 s; the row reads `
      + `[${row.join(',')}]`).toBeGreaterThanOrEqual(0)
    // EDGE (=X0+6) is the last floored cell. Index 5 is EDGE+1, one past it:
    // it is fed across the lip before it can notice the hole, and then it
    // pours straight down. Everything beyond is over the drop and empty --
    // that cell's support is its own falling column, which is not support.
    expect(row.slice(0, 6)).toEqual([ID.water, 639, 640, 641, 642, 643])
    expect(row.slice(6)).toEqual([0, 0, 0, 0, 0])
  })

  test('the drop is a column of falling water, not a step pyramid', async ({ page }) => {
    await buildCliff(page)
    await page.evaluate(([x, y, z]) => window.noa.setBlock(636, x, y, z), [X0 + 2, Y, Z0])
    expect(await settle(page)).toBeGreaterThanOrEqual(0)

    // Every cell of the fall, from just under the lip to the valley floor.
    const col = await column(page, EDGE + 1, Y - 1, Y - DROP)
    expect(col).toEqual(new Array(DROP).fill(ID.water_falling))
  })

  test('water still spreads across the valley floor once it lands', async ({ page }) => {
    await buildCliff(page)
    await page.evaluate(([x, y, z]) => window.noa.setBlock(636, x, y, z), [X0 + 2, Y, Z0])
    expect(await settle(page)).toBeGreaterThanOrEqual(0)

    /*
     * The other half of the rule, and the reason the fix is not simply "never
     * spread over air": vanilla's landing block counts as decay 0, so the
     * pool at the bottom is a full seven blocks wide again. If the falling
     * guard were implemented as a blanket ban this would be a one-block
     * puddle.
     */
    const floor = await rowEast(page, Y - DROP, EDGE + 1, EDGE + 9)
    expect(floor[0]).toBe(ID.water_falling)
    expect(floor.slice(1, 8)).toEqual([639, 640, 641, 642, 643, 644, ID.water_7])
    expect(floor[8]).toBe(ID.air)
  })
})

/**
 * The mean colour of a small patch of screen.
 *
 * A PATCH and not a pixel: the water is animated (terrainAnimation.js runs 32
 * frames of water_still at 15 Hz) and antialiased, so one sample is a
 * lottery. 28-underwater samples the same way.
 */
async function patch(page, clip) {
  const png = await page.screenshot({ clip })
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  let r = 0, g = 0, b = 0, n = 0
  for (let i = 0; i < data.length; i += info.channels) {
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n++
  }
  return [r / n, g / n, b / n]
}

test.describe('water is translucent', () => {
  test.afterEach(({ page }) => unpin(page))

  /*
   * WHY A BACKDROP SWAP AND NOT A COLOUR CONSTANT.
   *
   * Asserting "the water pixel is #3f76e4-ish" proves the tint and says
   * nothing about the alpha, because an opaque water block is exactly that
   * colour too. What alpha MEANS is "what is behind it changes what you see",
   * so the test is: photograph the same water block twice with two very
   * different things behind it, and require the two photographs to differ.
   *
   * Gold against sky is the widest pair available -- roughly (250,200,70)
   * against the horizon's blue -- and neither is near the water tint, so a
   * failure cannot be a near-miss.
   */
  const WALL = [EDGE + 1, Y - 3, Z0]

  async function photographWaterAgainst(page, backdropId) {
    await buildCliff(page)
    // One water block hanging in the air, with a backdrop one block behind it
    // and nothing else in the frame. The flow engine is off (buildCliff turns
    // it off) so this block stays exactly where it is put.
    await page.evaluate(([x, y, z, back]) => {
      window.noa.setBlock(636, x, y, z)
      window.noa.setBlock(back, x, y, z - 1)
    }, [...WALL, backdropId])

    // Eye-level with the block, three blocks south of it, looking north at
    // it. -1.4 puts the eyes (camera offset ~1.6) just under the block's top
    // face, so the 16x16 crop lands inside the face and not on its edge.
    const eye = [WALL[0] + 0.5, WALL[1] - 1.4, WALL[2] + 3.5]
    await teleport(page, ...eye)
    await pin(page, ...eye)
    await look(page, { heading: HEADING.northMinusZ, pitch: 0 })
    await waitFrames(page, 6)
    return patch(page, { x: 632, y: 344, width: 16, height: 16 })
  }

  test('what is behind water changes what you see', async ({ page }) => {
    const onGold = await photographWaterAgainst(page, ID.gold)
    const onSky = await photographWaterAgainst(page, ID.air)

    /*
     * DISCRIMINATING -- verified by flipping the one line that fixes this,
     * `mat.useAlphaFromDiffuseTexture = true` in src/blocks.js, back to
     * false. It failed with
     *
     *   gold 53,72,110 vs sky 53,72,110 ... Received: 0
     *
     * Not "close": byte-identical on all three channels. With the alpha
     * unread the shader cannot see the backdrop at all, so the two
     * photographs are the same photograph.
     */
    const spread = Math.max(...onGold.map((c, i) => Math.abs(c - onSky[i])))
    expect(spread, `gold ${onGold.map(Math.round)} vs sky ${onSky.map(Math.round)}`)
      .toBeGreaterThan(24)

    // ...and it is still WATER in both, not a hole: the blue channel leads.
    for (const p of [onGold, onSky]) expect(p[2]).toBeGreaterThan(p[0])
  })
})

test.describe('evidence', () => {
  test.afterEach(({ page }) => unpin(page))

  test('a waterfall, photographed from the side', async ({ page }) => {
    await buildCliff(page)
    await page.evaluate(([x, y, z]) => window.noa.setBlock(636, x, y, z), [X0 + 2, Y, Z0])
    expect(await settle(page)).toBeGreaterThanOrEqual(0)

    // Off to one side of the fall and level with the middle of it, looking
    // back along -Z at the cliff face. Pinned, because there is nothing to
    // stand on out here.
    const eye = [X0 + 9.5, Y - 5, Z0 + 12.5]
    await teleport(page, ...eye)
    await pin(page, ...eye)
    await look(page, { heading: HEADING.northMinusZ, pitch: 0.05 })
    await waitFrames(page, 8)
    await shot(page, 'water-fall-side')
  })
})
