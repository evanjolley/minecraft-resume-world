import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { test, expect } from './fixtures.js'
import {
  HEADING, look, setBlock, getBlock, teleport, position,
  waitFrames, waitTicks, holdMouse, useGamemode, grantOp,
} from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * Nether portals.
 *
 * THE RULE UNDER TEST, and it is a rule this world has never had before:
 * block SHAPE. Nothing else here asks "are the eighteen voxels around this
 * one arranged correctly" -- mining asks about one voxel, placing asks about
 * one voxel, and even the fluid work asks only about neighbours. So the
 * interesting failure is not "the portal does not appear", it is "the portal
 * appears for a frame that vanilla would refuse", which a test that only ever
 * builds VALID frames cannot see.
 *
 * Every detection test below therefore comes in pairs: the same frame with
 * one block changed. The pairs are the discrimination, and they are the whole
 * reason this file is longer than the feature.
 *
 * THE SOURCE for every number: minecraft.wiki/w/Nether_portal --
 * "a vertical, rectangular frame of obsidian (4x5 minimum, 23x23 maximum)",
 * "The four corners of the frame are not required", "23x23 exterior, 21x21
 * opening", "80 game ticks (4 seconds) in survival mode or 1 game tick in
 * creative mode".
 *
 * WHERE IT BUILDS. In the air at y=200, the same empty band usePad uses, for
 * the same reason: real terrain has no flat wall to stand a frame against and
 * a frame carved into a hillside would have its detection decided by whatever
 * the hillside happened to be made of. Every cell is registered with the
 * `terrain` fixture, so the next spec file inherits sky and not obsidian.
 */

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots')

/* A 4x5 exterior frame -- vanilla's minimum -- lying in the Z=0 plane, so it
 * runs along the X axis. Interior is x 21..22, y 201..203: 2 wide, 3 tall. */
const Z = 0
const X0 = 20, X1 = 23          // the jambs
const Y0 = 200, Y1 = 204        // the floor row and the ceiling row
const INTERIOR = []
for (let x = X0 + 1; x < X1; x++) for (let y = Y0 + 1; y < Y1; y++) INTERIOR.push([x, y, Z])

/** The four cells the rule says are optional. Never asserted about except
 *  in the test that deletes them. */
const CORNERS = [[X0, Y0, Z], [X1, Y0, Z], [X0, Y1, Z], [X1, Y1, Z]]

/** Every obsidian cell of a full frame, corners included. */
const FRAME = []
for (let x = X0; x <= X1; x++) { FRAME.push([x, Y0, Z]); FRAME.push([x, Y1, Z]) }
for (let y = Y0 + 1; y < Y1; y++) { FRAME.push([X0, y, Z]); FRAME.push([X1, y, Z]) }

const obsidianId = (page) =>
  page.evaluate(() => window.game.ids.obsidian)

const portalId = (page) =>
  page.evaluate(() => window.game.dimensions.portals.id)

/** Build the frame. Returns nothing; the caller has already registered the
 *  box with `terrain` so teardown puts the sky back. */
async function buildFrame(page, { skip = [] } = {}) {
  const skipped = new Set(skip.map(c => c.join(',')))
  const obsidian = await obsidianId(page)
  /*
   * Let the chunks settle before writing into them, and this is not padding.
   * Running this file straight after 34-nether.spec.js in one worker failed
   * the first test and passed it in isolation: a dimension round trip
   * invalidates every chunk and noa re-requests them over the following ticks,
   * so a setBlock issued into a chunk that is mid-re-fill is overwritten by
   * the fill that lands after it. Nothing else in this file waits for chunks
   * because nothing else writes the first block of a test.
   */
  await waitTicks(page, 6)
  await page.evaluate(([cells, id]) => {
    for (const [x, y, z] of cells) window.noa.setBlock(id, x, y, z)
  }, [FRAME.filter(c => !skipped.has(c.join(','))), obsidian])
  await waitFrames(page, 2)
}

/** Clear the whole box back to air, between the halves of a pair. */
const clearBox = (page) => page.evaluate(([a, b, c, d, e, f]) => {
  for (let x = a; x <= d; x++)
    for (let y = b; y <= e; y++)
      for (let z = c; z <= f; z++) window.noa.setBlock(0, x, y, z)
}, [X0, Y0, Z, X1, Y1, Z])

/** Ask the real detector, at the cell the fire would land in. */
const detect = (page, seed = [X0 + 1, Y0 + 1, Z]) =>
  page.evaluate(s => {
    const f = window.game.dimensions.portals.detect(s)
    return f && { axis: f.axis, width: f.width, height: f.height, cells: f.cells.length }
  }, seed)

const light = (page, seed = [X0 + 1, Y0 + 1, Z]) =>
  page.evaluate(s => window.game.authority.requestLightPortal(s)
    .then(r => ({ ok: r.ok, error: r.error ?? null })), seed)

/** How many interior cells are actually portal blocks right now. */
async function portalCells(page) {
  const id = await portalId(page)
  return page.evaluate(([cells, pid]) =>
    cells.filter(([x, y, z]) => window.noa.getBlock(x, y, z) === pid).length,
  [INTERIOR, id])
}

/* The box every test dirties. Registered once per test via the fixture. */
const keepBox = (terrain) => terrain.keep([X0, Y0, Z], [X1, Y1, Z])

/*
 * THE PERMISSION SPLIT, discovered by running this file rather than by
 * reading, and worth stating because it changes what a portal IS here.
 *
 * `DEFAULT_GAMEMODE` is 'adventure' (gamemode.js:21). A visitor to this world
 * may not break a block and may not place one. So the brief's "a portal is
 * the route a visitor is meant to use" cannot mean a visitor BUILDS one --
 * they cannot place the obsidian, cannot mine it, and cannot craft the flint
 * and steel. It means a portal that already exists is one a visitor may WALK
 * THROUGH, and the two halves need opposite answers:
 *
 *   lighting  -- requires mayBuild, which adventure does not have. Vanilla
 *                agrees: flint and steel setting a fire is a block placement,
 *                and adventure refuses it.
 *   travelling -- requires nothing at all, and asks the authority nothing.
 *
 * The last test in this file is that pair, which is the one that matters for
 * whether the feature does what it was asked to do.
 */
const asBuilder = async (page) => {
  await grantOp(page)
  await useGamemode(page, 'survival')
}

/*
 * Leave the world where it was found. 34-nether.spec.js explains why at
 * length: the page is worker-scoped, resetWorld knows nothing about
 * dimensions, and a file that ends in the Nether hands the next file a
 * Nether.
 */
test.afterEach(async ({ page }) => {
  if (await page.evaluate(() => window.game.dimensions.active) !== 'overworld') {
    await page.evaluate(() => window.game.dimensions.enter('overworld'))
    await waitTicks(page, 20)
    await waitFrames(page, 10)
  }
})

/* ------------------------------------------------------------------ *
 * The shape rule
 * ------------------------------------------------------------------ */

test('a 4x5 frame is detected, and 3x5 and 4x2 are not', async ({ page, terrain }) => {
  await keepBox(terrain)
  await buildFrame(page)

  const good = await detect(page)
  expect(good).toEqual({ axis: 'x', width: 2, height: 3, cells: 6 })

  /*
   * DISCRIMINATION 1, the narrow frame. One jamb moved inward by one turns
   * the 2-wide interior into a 1-wide one, which is below MIN_WIDTH. Nothing
   * else about the frame changes -- it is still a closed rectangle of
   * obsidian, which is exactly why "it looks like a portal" is not the test.
   */
  await clearBox(page)
  const obsidian = await obsidianId(page)
  await page.evaluate(([cells, id]) => {
    for (const [x, y, z] of cells) window.noa.setBlock(id, x, y, z)
  }, [FRAME.map(([x, y, z]) => [x === X1 ? X1 - 1 : x, y, z]), obsidian])
  await waitFrames(page, 2)
  expect(await detect(page)).toBe(null)

  /*
   * DISCRIMINATION 2, the short frame: a 4x4 exterior, interior 2 tall,
   * below the 3 the wiki gives. Same argument.
   */
  await clearBox(page)
  await page.evaluate(([cells, id]) => {
    for (const [x, y, z] of cells) window.noa.setBlock(id, x, y, z)
  }, [FRAME.map(([x, y, z]) => [x, y === Y1 ? Y1 - 1 : y, z]), obsidian])
  await waitFrames(page, 2)
  expect(await detect(page)).toBe(null)
})

test('the four corners are not required, and every other block is', async ({ page, terrain }) => {
  await keepBox(terrain)

  /*
   * THE HALF THAT WOULD BE WRONG IF THE RULE WERE WRITTEN FROM MEMORY.
   * "The four corners of the frame are not required, but portals created by
   * the game always include them" -- so a player's hand-built frame with
   * eight blocks of obsidian and no corners must light, and a detector that
   * checks the full rectangle would refuse it.
   */
  await buildFrame(page, { skip: CORNERS })
  expect(await detect(page)).toEqual({ axis: 'x', width: 2, height: 3, cells: 6 })

  /*
   * And the control: the SAME deletion applied one cell inward, to a floor
   * block that is not a corner. If this also detected, the test above would
   * be proving nothing except that the detector is permissive.
   */
  await clearBox(page)
  await buildFrame(page, { skip: [[X0 + 1, Y0, Z]] })
  expect(await detect(page)).toBe(null)

  /* One ceiling block, same argument. */
  await clearBox(page)
  await buildFrame(page, { skip: [[X0 + 1, Y1, Z]] })
  expect(await detect(page)).toBe(null)

  /* One jamb, same argument. */
  await clearBox(page)
  await buildFrame(page, { skip: [[X0, Y0 + 2, Z]] })
  expect(await detect(page)).toBe(null)
})

test('a frame of something that is not obsidian does not light', async ({ page, terrain }) => {
  await keepBox(terrain)
  await asBuilder(page)
  /*
   * Stone, in the identical geometry. The one thing that changes between
   * this test and the first is the material, so a detector that had been
   * written against "solid" rather than against obsidian fails exactly here
   * and nowhere else.
   */
  await page.evaluate(([cells, id]) => {
    for (const [x, y, z] of cells) window.noa.setBlock(id, x, y, z)
  }, [FRAME, await page.evaluate(() => window.game.ids.stone)])
  await waitFrames(page, 2)
  expect(await detect(page)).toBe(null)
  const res = await light(page)
  expect(res.ok).toBe(false)
  expect(await portalCells(page)).toBe(0)
})

/* ------------------------------------------------------------------ *
 * Lighting it
 * ------------------------------------------------------------------ */

test('flint and steel lights a valid frame and nothing else does', async ({ page, terrain }) => {
  await keepBox(terrain)
  await asBuilder(page)
  await buildFrame(page)
  expect(await portalCells(page)).toBe(0)

  /*
   * A REAL RIGHT-CLICK, not a call to requestLightPortal. The binding is the
   * part that can silently not exist: interact.js owns the only other
   * alt-fire listener, and "the two do not collide" is a claim about noa's
   * input emitter that only a real click can settle.
   *
   * Standing in the interior looking straight down targets the floor block
   * under the player, whose `adjacent` is the interior cell the fire lands
   * in -- which is where a player would strike it.
   */
  const fid = await page.evaluate(() => {
    const f = window.game.creative.PICKER_ITEMS.find(i => i.key === 'flint_and_steel')
    window.game.inventory.add(f.id, 1)
    window.game.inventory.selected = 0
    return f.id
  })
  expect(fid).toBeGreaterThan(0)
  expect(await page.evaluate(() => window.game.inventory.selectedStack()?.id)).toBe(fid)

  await teleport(page, X0 + 1.5, Y0 + 1, Z + 0.5)
  await look(page, { heading: HEADING.southPlusZ, pitch: Math.PI / 2 })
  await waitTicks(page, 2)
  await holdMouse(page, 150, 'right')
  await waitTicks(page, 4)

  expect(await portalCells(page)).toBe(6)
  /* And it wrote NOTHING outside the interior: the frame is still obsidian
   * and the cell in front of the frame is still air. */
  const obsidian = await obsidianId(page)
  expect(await getBlock(page, X0, Y0 + 2, Z)).toBe(obsidian)
  expect(await getBlock(page, X0 + 1, Y0 + 1, Z + 1)).toBe(0)
})

test('an invalid frame refuses to light, and the same frame fixed does', async ({ page, terrain }) => {
  await keepBox(terrain)
  await asBuilder(page)
  /*
   * The pair that matters most, run through the LIGHTING path rather than
   * the detection path, because a detector that is right and a fill that
   * does not consult it is the bug this is really watching for.
   */
  await buildFrame(page, { skip: [[X0 + 1, Y1, Z]] })
  expect((await light(page)).ok).toBe(false)
  expect(await portalCells(page)).toBe(0)

  /* Put the one missing ceiling block back. Nothing else changes. */
  await setBlock(page, await obsidianId(page), X0 + 1, Y1, Z)
  await waitFrames(page, 2)
  const res = await light(page)
  expect(res.ok).toBe(true)
  expect(await portalCells(page)).toBe(6)
})

/* ------------------------------------------------------------------ *
 * The dwell, and the trip
 * ------------------------------------------------------------------ */

test('survival waits 80 ticks, creative waits 1', async ({ page, terrain }) => {
  await keepBox(terrain)
  await asBuilder(page)
  await buildFrame(page)
  expect((await light(page)).ok).toBe(true)

  expect(await page.evaluate(() => window.game.dimensions.portals.dwellRequired)).toBe(80)

  await teleport(page, X0 + 1.5, Y0 + 1, Z + 0.5)
  await waitTicks(page, 3)
  expect(await page.evaluate(() => window.game.dimensions.portals.inPortal)).toBe(true)

  /*
   * THE DISCRIMINATION. Half the wait, and it must NOT have travelled.
   * Asserting only "it eventually arrives" would pass against a portal that
   * teleports on the first tick, which is precisely the bug a dwell timer
   * exists to not have.
   */
  await waitTicks(page, 35)
  expect(await page.evaluate(() => window.game.dimensions.active)).toBe('overworld')
  const mid = await page.evaluate(() => window.game.dimensions.portals.dwell)
  expect(mid).toBeGreaterThan(20)
  expect(mid).toBeLessThan(80)

  /* And the rest of the wait does. */
  await page.waitForFunction(
    () => window.game.dimensions.active === 'nether', null, { timeout: 15_000 })
  await waitTicks(page, 20)
  await waitFrames(page, 10)
  expect(await page.evaluate(() => window.game.dimensions.active)).toBe('nether')

  await shot(page, '44-portal-arrived-nether')
})

test('creative shortens the wait to a single tick', async ({ page, terrain }) => {
  await keepBox(terrain)
  await grantOp(page)
  await useGamemode(page, 'creative')
  try {
    expect(await page.evaluate(() => window.game.dimensions.portals.dwellRequired)).toBe(1)
    await buildFrame(page)
    expect((await light(page)).ok).toBe(true)
    await teleport(page, X0 + 1.5, Y0 + 1, Z + 0.5)
    /*
     * Two ticks, which in survival would be 1/40th of the wait. If this
     * arrives, the gamemode branch is real; the test above already proved
     * that 35 ticks is not enough in survival, so the pair brackets it.
     */
    await page.waitForFunction(
      () => window.game.dimensions.active === 'nether', null, { timeout: 10_000 })
    expect(await page.evaluate(() => window.game.dimensions.portals.dwell)).toBe(0)
  } finally {
    await useGamemode(page, 'survival')
  }
})

/* ------------------------------------------------------------------ *
 * It moves
 * ------------------------------------------------------------------ */

test('the portal animates, and freezing it is the control', async ({ page, terrain }) => {
  await keepBox(terrain)
  /*
   * A FLOOR TO STAND ON, and it is not housekeeping.
   *
   * The first version of this test teleported the camera three blocks back
   * from the portal and photographed four frames. They came out as a forest,
   * then a death screen -- "Guest fell from a high place" -- because y=200 is
   * two hundred blocks of nothing and the player fell out of shot on the
   * second capture. The diff assertions PASSED: a forest and a death screen
   * differ enormously, and a death screen holds still. That is a test that is
   * green for a reason that has nothing to do with the thing it names, and the
   * only way it was ever going to be caught was by opening the png.
   */
  await terrain.keep([X0, Y0, Z + 1], [X1, Y0, Z + 5])
  await asBuilder(page)
  await buildFrame(page)
  await page.evaluate(([a, b, c, d, id]) => {
    for (let x = a; x <= b; x++) for (let z = c; z <= d; z++) window.noa.setBlock(id, x, 200, z)
  }, [X0, X1, Z + 1, Z + 5, await page.evaluate(() => window.game.ids.stone)])
  expect((await light(page)).ok).toBe(true)

  /*
   * THE TRAP 39-animated-textures.spec.js is built around, inherited whole:
   * atlasIndex is baked into the vertex buffer at mesh time, so a number that
   * counts up proves nothing. Every numeric assertion here is followed by a
   * pixel assertion and the pixel assertion is the one that matters.
   *
   * The portal is a STANDALONE run -- 32 frames with no material of their own
   * -- so `layerOf` is also the only way to check that it got a material at
   * all, which is the single thing that could have gone wrong in wiring it.
   */
  const layers = []
  for (let i = 0; i < 6; i++) {
    layers.push(await page.evaluate(() => window.game.terrainAnim.layerOf('nether_portal')))
    await waitTicks(page, 3)
  }
  expect(new Set(layers).size).toBeGreaterThan(1)
  /* 32 frames starting at layer 63 on the alpha page. Every sample has to be
   * inside that run or the remap is pointing somewhere it should not. */
  for (const l of layers) {
    expect(l).toBeGreaterThanOrEqual(63)
    expect(l).toBeLessThan(63 + 32)
  }

  /*
   * Stand close and look at it side on, and STOP THE CLOCK first.
   *
   * The clock is not a detail. The first version of this test cropped 400x300
   * of an outdoor view and its frozen control still moved by half of what the
   * animation moved -- because the day cycle re-shades every lit pixel in the
   * frame every tick, and clouds drift across the sky behind a portal that is
   * 63% transparent. Neither has anything to do with the remap table, and both
   * would have made the control useless as a control.
   *
   * doDaylightCycle is a real game rule wired to sky.js's `running` flag
   * (main.js re-asserts it every tick), so turning it off is the supported way
   * to hold the light still, not a test-only hook. The crop is then pulled in
   * to 240x180 at three blocks' range, which is portal and obsidian and no sky
   * at all.
   */
  await page.evaluate(() => window.game.authority.requestGamerule('doDaylightCycle', 'false'))
  await teleport(page, X0 + 1.5, Y0 + 1, Z + 3.5)
  await look(page, { heading: HEADING.northMinusZ, pitch: 0 })
  await waitFrames(page, 8)

  /* One wide shot for context -- the crops below are all portal and no frame,
   * which proves motion and shows nothing about what is moving. */
  await shot(page, '44-portal-lit')

  const { width: VW, height: VH } = page.viewportSize()
  const CROP = { x: Math.round(VW / 2) - 120, y: Math.round(VH / 2) - 90, width: 240, height: 180 }
  const raw = async () => sharp(await page.screenshot({ clip: CROP })).raw().toBuffer()
  const differing = (a, b) => {
    let n = 0
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++
    return n
  }

  /* A strip across ticks, saved as evidence: one still cannot show motion. */
  const moving = []
  for (let i = 0; i < 4; i++) {
    await page.screenshot({ path: path.join(SHOTS, `44-portal-frame-${i}.png`), clip: CROP })
    moving.push(await raw())
    await waitTicks(page, 4)
    await waitFrames(page, 2)
  }
  const movedBy = differing(moving[0], moving[moving.length - 1])
  expect(movedBy).toBeGreaterThan(0)

  /*
   * THE CONTROL, and it is the same measurement with one bit changed rather
   * than a different measurement: freeze the remap table and nothing else.
   * A moving cloud, a swaying camera or a compression artefact would survive
   * the freeze; the portal does not.
   */
  await page.evaluate(() => window.game.terrainAnim.setPaused(true))
  try {
    await waitFrames(page, 4)
    const a = await raw()
    await waitTicks(page, 8)
    await waitFrames(page, 4)
    const b = await raw()
    expect(differing(a, b)).toBeLessThan(movedBy / 10)
  } finally {
    await page.evaluate(() => window.game.terrainAnim.setPaused(false))
    await page.evaluate(() => window.game.authority.requestGamerule('doDaylightCycle', 'true'))
  }
})

/* ------------------------------------------------------------------ *
 * The visitor
 * ------------------------------------------------------------------ */

test('a guest cannot light a portal, and walks through one that is lit', async ({ page, terrain }) => {
  await keepBox(terrain)
  await buildFrame(page)

  /*
   * THE HALF THE BRIEF IS ABOUT. /dimension is operator-only, so a portal is
   * the only Nether a visitor has -- and a visitor is in adventure mode, which
   * cannot place a block. Both of those are correct and they only fit together
   * one way: Evan builds and lights the portal, everyone walks through it.
   */
  expect(await page.evaluate(() => window.game.authority.gamemode)).toBe('adventure')
  const refused = await light(page)
  expect(refused.ok).toBe(false)
  expect(refused.error).toBe('You cannot place blocks in this game mode')
  expect(await portalCells(page)).toBe(0)

  /* The operator lights it... */
  await asBuilder(page)
  expect((await light(page)).ok).toBe(true)
  expect(await portalCells(page)).toBe(6)

  /* ...and hands the world back to a visitor, who is not an operator, cannot
   * build, and has no /dimension. */
  await useGamemode(page, 'adventure')
  await page.evaluate(() => window.game.authority.requestDeop())
  expect(await page.evaluate(() => window.game.authority.isOperator())).toBe(false)
  expect(await page.evaluate(
    () => window.game.authority.requestDimension('nether').then(r => r.ok))).toBe(false)

  await teleport(page, X0 + 1.5, Y0 + 1, Z + 0.5)
  await page.waitForFunction(
    () => window.game.dimensions.active === 'nether', null, { timeout: 20_000 })
  await waitTicks(page, 20)
  await waitFrames(page, 10)
  expect(await page.evaluate(() => window.game.dimensions.active)).toBe('nether')
  /* And the world really moved, not just the label -- 34-nether.spec.js's
   * discrimination: noa.getBlock reads the chunk STORE, which only a chunk
   * that was actually re-requested and re-filled can populate. */
  const under = await page.evaluate(() => {
    const p = window.noa.ents.getPositionData(window.noa.playerEntity).position
    return window.game.blockKey(window.noa.getBlock(
      Math.floor(p[0]), Math.floor(p[1]) - 1, Math.floor(p[2])))
  })
  expect(under).not.toBe('grass')

  await shot(page, '44-portal-guest-in-nether')
})

/*
 * THE RETURN TRIP LANDS IN THE WORLD YOU LEFT.
 *
 * portals.js used to pick its destination with
 * `active === 'nether' ? 'overworld' : 'nether'`, which is a true sentence
 * about a world with two rows in its dimension table. There are four, and two
 * of them are overworlds: `claude-opus-5-1` is the same 128 patch at the same
 * origin, in exact 1:1 register with the Nether, so a portal there takes you
 * down correctly and the old branch brought you back up into the SUPERFLAT at
 * those coordinates -- a bare field instead of the road you walked in from.
 * dimensions.js's header named it and left it; this is the assertion that
 * keeps it named.
 *
 * WHAT MAKES THIS A DISCRIMINATION rather than a round trip that happens to
 * work: the departure world is deliberately NOT the default one. A version
 * that hard-codes 'overworld' passes every other test in this file and fails
 * only this one, because every other test leaves from the overworld and
 * cannot tell the two rules apart.
 *
 * CREATIVE THROUGHOUT, so the dwell is one tick rather than eighty and the
 * test is three teleports instead of twelve seconds of standing still.
 */
test('a portal back out of the Nether lands in the world you left, not in the overworld',
  async ({ page, terrain }) => {
    await keepBox(terrain)
    await grantOp(page)
    await useGamemode(page, 'creative')
    try {
      await page.evaluate(() => window.game.dimensions.enter('claude-opus-5-1'))
      await page.waitForFunction(
        () => window.game.dimensions.active === 'claude-opus-5-1', null, { timeout: 30_000 })
      /*
       * STAND WHERE THE FRAME GOES BEFORE WRITING IT, in both worlds. noa
       * keeps three chunks of 32 around the player, and both arrivals are at
       * a spawn point rather than at y=200 -- a setBlock into a chunk that is
       * not resident is silently lost, which is what a frame that refuses to
       * light means here.
       */
      await teleport(page, X0 + 1.5, Y0 + 1, Z + 0.5)
      await waitTicks(page, 25)
      await buildFrame(page)
      expect((await light(page)).ok, 'the frame in claude-opus-5-1 lit').toBe(true)
      await teleport(page, X0 + 1.5, Y0 + 1, Z + 0.5)
      await page.waitForFunction(
        () => window.game.dimensions.active === 'nether', null, { timeout: 20_000 })

      /*
       * A second frame, in the Nether, at the same column, and the same
       * stand-there-first rule as above.
       */
      await teleport(page, X0 + 1.5, Y0 + 1, Z + 0.5)
      await waitTicks(page, 25)
      await page.evaluate(([a, b, c, d, e, f]) => {
        for (let x = a; x <= d; x++)
          for (let y = b; y <= e; y++)
            for (let z = c; z <= f; z++) window.noa.setBlock(0, x, y, z)
      }, [X0, Y0, Z, X1, Y1, Z])
      await buildFrame(page)
      expect((await light(page)).ok, 'the frame in the Nether lit').toBe(true)

      /*
       * NO TELEPORT HERE, and the missing line is the point: lighting a
       * portal around yourself puts you inside it, so the dwell is already
       * running. Teleporting into it again after the trip has fired lands you
       * in the FIRST portal, in the other world, and sends you straight back
       * -- which reads as "the return never happened".
       */
      await page.waitForFunction(
        () => window.game.dimensions.active !== 'nether', null, { timeout: 20_000 })
      expect(await page.evaluate(() => window.game.dimensions.active),
        'came back to the world the portal was lit in').toBe('claude-opus-5-1')
    } finally {
      await page.evaluate(() => window.game.dimensions.enter('overworld'))
      await waitTicks(page, 20)
      await useGamemode(page, 'survival')
    }
  })
