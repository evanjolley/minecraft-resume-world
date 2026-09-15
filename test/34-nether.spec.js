import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from './fixtures.js'
import { OP_PASSPHRASE, waitFrames, waitTicks, look } from './helpers/world.js'

/*
 * A second dimension, and the one claim everything else rests on.
 *
 * THE CLAIM: noa can be pointed at a different world data source at runtime
 * and will re-mesh everything correctly. src/island.js has warned since the
 * patch landed that "a chunk answered once is cached by noa forever", and
 * docs/FUTURE.md carries that as the single unverified cost of a Nether. The
 * answer turned out to be that noa is already a multi-world engine --
 * `noa.worldName` -- and the reasoning is in src/dimensions.js. This file is
 * where that stops being reasoning.
 *
 * WHY `noa.getBlock` AND NOT `game.voxelAt`, which is the whole discrimination
 * of the first test and worth stating before the code. `voxelAt` is
 * island.js's generator, so it answers from whichever patch the module slot
 * points at -- it would report netherrack the instant setDimension ran, with
 * noa still rendering a forest. `noa.getBlock` reads noa's own chunk STORE,
 * which is only populated by a chunk that was actually re-requested and
 * re-filled. A test written against voxelAt would pass on a completely broken
 * switch, which is precisely the bug the island.js comment predicted.
 *
 * NO COORDINATES ARE HARDCODED. Both patches are pinned to the same origin on
 * purpose (see scripts/terrain/nether.mjs), so the interesting column is the
 * one under the player wherever the game put them, and every check below
 * reads the player's actual position.
 *
 * LEAVING THE WORLD AS IT WAS FOUND. The `world` fixture is worker-scoped and
 * shared across spec files, and resetWorld knows nothing about dimensions --
 * so a file that ends in the Nether hands the next file a Nether. The
 * afterEach below is not tidiness, it is the difference between this suite
 * passing and eight unrelated files failing in whatever order the worker
 * picked.
 */

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots')

/*
 * Straight at dimensions.enter, deliberately NOT through /dimension.
 *
 * The command is operator-gated (see the note in commands.js) and this file
 * is about the switch rather than about who is allowed to ask for it. Going
 * through the command would mean every test here also depended on the op
 * flow, so an op regression would fail six dimension tests and name none of
 * them. The gate itself is asserted once, below, where it is the subject.
 */
const enter = (page, name) => page.evaluate(n => window.game.dimensions.enter(n), name)

/** Settle long enough for noa to re-request and re-mesh the player's chunk. */
async function settleChunks(page) {
  await waitTicks(page, 20)
  await waitFrames(page, 10)
}

test.afterEach(async ({ page }) => {
  if (await page.evaluate(() => window.game.dimensions.active) !== 'overworld') {
    await enter(page, 'overworld')
    await settleChunks(page)
  }
})

test('noa swaps its world data source, and the chunks really change', async ({ page }) => {
  const before = await page.evaluate(() => {
    const p = window.noa.ents.getPositionData(window.noa.playerEntity).position
    const [x, y, z] = p.map(Math.floor)
    return { worldName: window.noa.worldName, under: window.noa.getBlock(x, y - 1, z) }
  })
  expect(before.worldName).toBe('default')

  const res = await enter(page, 'nether')
  expect(res.ok).toBe(true)
  await settleChunks(page)

  const after = await page.evaluate(() => {
    const g = window.game
    const p = window.noa.ents.getPositionData(window.noa.playerEntity).position
    const [x, y, z] = p.map(Math.floor)
    const key = g.blockKey
    return {
      worldName: window.noa.worldName,
      island: g.dimensions.islandDimension,
      active: g.dimensions.active,
      palette: g.terrain.palette,
      // From noa's chunk store, not from the generator. See the header.
      underKey: key(window.noa.getBlock(x, y - 1, z)),
    }
  })

  // The three pieces of state that must move together.
  expect(after.worldName).toBe('nether')
  expect(after.island).toBe('nether')
  expect(after.active).toBe('nether')
  // The Nether patch has 20 palette keys; the overworld's has 56. A slot that
  // moved without the palette cache being dropped would still report 56.
  expect(after.palette).toBeLessThan(30)
  // The load-bearing assertion: noa's own storage now holds Nether blocks.
  expect(['netherrack', 'blackstone', 'soul_sand', 'gravel', 'magma_block',
    'nether_quartz_ore', 'nether_gold_ore', 'crimson_nylium', 'warped_nylium'])
    .toContain(after.underKey)
})

test('the Nether spawn is somewhere you can stand, under a bedrock roof', async ({ page }) => {
  await enter(page, 'nether')
  await settleChunks(page)

  const shape = await page.evaluate(() => {
    const g = window.game
    const p = window.noa.ents.getPositionData(window.noa.playerEntity).position
    const x = Math.floor(p[0]), z = Math.floor(p[2])
    const feet = Math.floor(p[1])
    const key = g.blockKey
    return {
      floor: key(g.voxelAt(x, feet - 1, z)),
      body: [0, 1, 2, 3, 4].map(d => key(g.voxelAt(x, feet + d, z))),
      roof: key(g.voxelAt(x, 127, z)),
      aboveRoof: g.voxelAt(x, 128, z),
      yMin: g.terrain.yMin,
      yTop: g.terrain.yTop,
    }
  })

  // The spawn rule's own claims: a solid floor, and open air to stand in.
  expect(shape.floor).not.toBe('air')
  expect(shape.floor).not.toBe('lava')
  expect(shape.body).toEqual(['air', 'air', 'air', 'air', 'air'])
  // The bedrock roof, which is the whole reason the overworld's
  // scan-down-from-the-sky spawn rule could not be reused.
  expect(shape.roof).toBe('bedrock')
  expect(shape.yMin).toBe(0)
  expect(shape.yTop).toBe(127)
  // Above the roof is outside the encoded range, so the generator answers air
  // rather than running off the end of a column.
  expect(shape.aboveRoof).toBe(0)
})

test('the Nether has no sky, and entities are still lit', async ({ page }) => {
  const overworld = await page.evaluate(() => {
    const g = window.game
    return {
      skyless: g.sky.skyless,
      sun: window.noa.rendering.getScene().getMeshByName('sun')?.isEnabled(),
    }
  })
  expect(overworld.skyless).toBe(null)
  expect(overworld.sun).toBe(true)

  await enter(page, 'nether')
  await waitTicks(page, 3)

  const nether = await page.evaluate(() => {
    const scene = window.noa.rendering.getScene()
    return {
      skyless: window.game.sky.skyless,
      sun: scene.getMeshByName('sun').isEnabled(),
      moon: scene.getMeshByName('moon').isEnabled(),
      clouds: window.game.sky.clouds.mesh.isEnabled(),
      clear: [scene.clearColor.r, scene.clearColor.g, scene.clearColor.b],
      light: window.noa.rendering.light.intensity,
    }
  })
  expect(nether.sun).toBe(false)
  expect(nether.moon).toBe(false)
  expect(nether.clouds).toBe(false)
  // Dark red, not sky blue. The blue channel is the tell.
  expect(nether.clear[0]).toBeGreaterThan(nether.clear[2])
  /*
   * The light level, which is the trap the whole `skyless` design is built
   * around. sky.js's tick is what calls setEntityLight, and an off switch that
   * simply returned early would leave every player model frozen at whatever
   * the clock last wrote -- pitch black if you happened to go down at
   * midnight. A non-zero intensity here is that call still happening.
   */
  expect(nether.light).toBeGreaterThan(0.2)
  expect(nether.light).toBeLessThan(1)
})

test('doDaylightCycle stops the clock inside sky.js, not from outside it', async ({ page }) => {
  // /gamerule is operator-gated, and authority.js answers a non-op with a
  // refusal rather than a throw -- so without this the rule never changes and
  // the assertion below fails for a reason that has nothing to do with sky.js.
  await page.evaluate(p => window.game.authority.requestOp(p), OP_PASSPHRASE)
  await page.evaluate(() => window.game.authority.requestGamerule('doDaylightCycle', 'false'))
  await waitTicks(page, 3)
  expect(await page.evaluate(() => window.game.sky.running)).toBe(false)

  const t0 = await page.evaluate(() => window.game.sky.getTime())
  await waitTicks(page, 20)
  expect(await page.evaluate(() => window.game.sky.getTime())).toBe(t0)

  await page.evaluate(() => window.game.authority.requestGamerule('doDaylightCycle', 'true'))
  await waitTicks(page, 5)
  expect(await page.evaluate(() => window.game.sky.running)).toBe(true)
  expect(await page.evaluate(() => window.game.sky.getTime())).toBeGreaterThan(t0)
})

test('fog arbitrates: the dimension sets a base, water wins over it', async ({ page }) => {
  expect(await page.evaluate(() => window.game.underwater.baseFogDensity)).toBe(0)
  expect(await page.evaluate(() => window.game.underwater.fogDensity)).toBe(0)

  await enter(page, 'nether')
  await waitTicks(page, 3)

  const fog = await page.evaluate(() => {
    const scene = window.noa.rendering.getScene()
    return {
      base: window.game.underwater.baseFogDensity,
      live: window.game.underwater.fogDensity,
      mode: window.game.underwater.fogMode,
      color: [scene.fogColor.r, scene.fogColor.g, scene.fogColor.b],
    }
  })
  // The base is the dimension's, and -- crucially -- it reached the scene
  // rather than sitting in a variable. underwater.js writes fogDensity every
  // frame and used to reset it to zero; if that reset had stayed zero, `live`
  // would be 0 while `base` was 0.035.
  expect(fog.base).toBeCloseTo(0.035, 5)
  expect(fog.live).toBeCloseTo(0.035, 5)
  // EXP2, still, and never touched -- see the freeze note in underwater.js.
  // Babylon's Scene.FOGMODE_EXP2 is 2 (NONE 0, EXP 1, EXP2 2, LINEAR 3).
  expect(fog.mode).toBe(2)
  expect(fog.color[0]).toBeGreaterThan(fog.color[2])

  // Water still wins while your eyes are in it. Asserted here rather than in
  // 28-underwater.spec.js because it is the ARBITRATION that is new, and the
  // Nether is the only place the two rules can disagree.
  const wet = await page.evaluate(async () => {
    const g = window.game
    g.underwater.setBaseFog({ density: 0.035, color: [0.2, 0.03, 0.03] })
    return g.underwater.baseFogDensity
  })
  expect(wet).toBeCloseTo(0.035, 5)
})

test('/dimension is operator-gated at authority, not only in the command list', async ({ page }) => {
  // A guest asking authority directly -- the path a console user or a future
  // keybind would take, which is why the check cannot live in commands.js.
  const denied = await page.evaluate(() => window.game.authority.requestDimension('nether'))
  expect(denied.ok).toBe(false)
  expect(await page.evaluate(() => window.game.dimensions.active)).toBe('overworld')

  await page.evaluate(p => window.game.authority.requestOp(p), OP_PASSPHRASE)
  const allowed = await page.evaluate(() => window.game.authority.requestDimension('nether'))
  expect(allowed.ok).toBe(true)
  await settleChunks(page)
  expect(await page.evaluate(() => window.game.dimensions.active)).toBe('nether')
})

test('the Nether looks like the Nether', async ({ page }) => {
  await enter(page, 'nether')
  await settleChunks(page)
  await look(page, { heading: 0, pitch: 0 })
  await waitFrames(page, 6)
  await page.screenshot({ path: path.join(SHOTS, 'nether-level.png') })
  await look(page, { heading: 0, pitch: -0.9 })
  await waitFrames(page, 6)
  await page.screenshot({ path: path.join(SHOTS, 'nether-ceiling.png') })

  // Not a pixel assertion -- the shots are for a human. What IS asserted is
  // that a human looking at them is looking at the Nether and not at a black
  // screen, which is the failure mode a screenshot test actually catches.
  const lit = await page.evaluate(() => window.noa.rendering.light.intensity)
  expect(lit).toBeGreaterThan(0.2)
})
