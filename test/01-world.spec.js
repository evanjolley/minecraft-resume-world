import { test, expect } from './fixtures.js'
import {
  ID, MIN_X, MAX_X, MIN_Z, MAX_Z, SURFACE_Y, getBlock, teleport,
  BUILT_WORLD, enterWorld, leaveWorld,
} from './helpers/world.js'
import { shot } from './helpers/shots.js'
/* The plot table, read rather than copied. src/builds/plots.js is plain data
 * with no imports of its own, which is why a spec (and src/island.js) may
 * read it without dragging Babylon in. It describes claude-opus-5-1, not this
 * world -- which is exactly why the last two tests in this file can use it to
 * tell the two apart. */
import { SPAWN_PATCH_X, SPAWN_PATCH_Z, ORIGIN_X, ORIGIN_Z } from '../src/builds/plots.js'

/*
 * THIS FILE DESCRIBES A BARE WORLD, and it has now described one twice.
 *
 * For one day the overworld was the eight-stage timeline and every assertion
 * here moved out of its way: the Classic Flat ladder was read at a margin
 * column no plot may touch, the barrier probe moved to the edge nearest the
 * road, and the landing test asserted paving under your feet. The owner
 * looked at that world and asked for it to be kept under a name while the
 * default went back to flat ground he can build on himself.
 *
 * So every one of those assertions came back to the spawn column, and the
 * file grew the two tests it did NOT have before: that the default world is
 * empty EVERYWHERE rather than merely empty where we happened to look, and
 * that the eight stages really are still standing in claude-opus-5-1. Moving
 * eight builds between worlds and quietly losing the coverage of them is the
 * failure this pass could most easily have shipped.
 */

test.describe('world generation', () => {
  test('the page boots with no errors, failed requests or 404s', async ({ bootErrors }) => {
    // Missing textures land here first: a 404 on /textures/*.png never throws,
    // it just renders the block untextured, which no numeric assertion sees.
    expect(bootErrors).toEqual([])
  })

  test('the world is a 256x256 patch with an invisible wall around it',
    async ({ page }) => {
      /*
       * REWRITTEN TWICE, not relaxed once. This used to assert an 80x80 island
       * with open void past its rim, then a 128x128 patch running -87..40 on
       * x and -56..71 on z. The overworld is 256x256 now, at origin 128/16:
       * x runs -128..127 (symmetric, spawn in the middle) and z runs -16..239
       * (not symmetric, spawn at the START of the walk). Both facts are read
       * from the helper rather than typed here, and 25-orientation asserts
       * the literals.
       *
       * (It ran -40..87 until the terrain asset stopped being mirrored in X.
       * Same patch, same spawn column, reached from the other end. The bounds
       * then survived the overworld going from imported terrain to a generated
       * superflat UNCHANGED, which is the point of deriving them from the
       * patch origin rather than from what happens to be in the asset.)
       *
       * What is NOT relaxed: one block past each edge is still checked, and it
       * is now the barrier rather than air. Off by one here and either you can
       * walk into the void or the wall eats a column of real terrain.
       *
       * ASKED OF THE GENERATOR, not of noa.getBlock, for the reason the strata
       * test below spells out at length: getBlock answers 0 for a chunk that is
       * not resident, and 0 is also air. The far corner is 239 blocks out, past
       * noa's horizontal load range from spawn, so the old getBlock version of
       * this went from "there is a wall there" to "there is nothing loaded
       * there" the moment the world's long axis flipped -- and the in-patch
       * half of the check had been passing vacuously for the same reason.
       * `voxelAt` asks what the world IS, resident or not.
       */
      const gen = (x, y, z) =>
        page.evaluate(([a, b, c]) => window.game.voxelAt(a, b, c), [x, y, z])

      for (const [x, z] of [[MIN_X, 0], [MAX_X, 0], [0, MIN_Z], [0, MAX_Z]]) {
        expect(await gen(x, SURFACE_Y - 1, z),
          `inside the patch at (${x}, ${z})`).not.toBe(ID.barrier)
      }

      expect(await gen(MIN_X - 1, SURFACE_Y - 1, 0)).toBe(ID.barrier)
      expect(await gen(MAX_X + 1, SURFACE_Y - 1, 0)).toBe(ID.barrier)
      expect(await gen(0, SURFACE_Y - 1, MIN_Z - 1)).toBe(ID.barrier)
      expect(await gen(0, SURFACE_Y - 1, MAX_Z + 1)).toBe(ID.barrier)

      // The corner, which is where a "and" that should be an "or" shows up.
      expect(await gen(MIN_X - 1, SURFACE_Y - 1, MIN_Z - 1)).toBe(ID.barrier)

      /*
       * ...and the wall is really standing in the world, not only in the
       * generator: noa has to agree about the edge nearest the player.
       *
       * THE -Z EDGE, which is 17 blocks behind spawn and by far the closest of
       * the four now that the map is 256 and spawn sits near its north edge
       * (the others are 128, 128 and 240). It has been the +X edge and the +Z
       * edge before; the reason is unchanged and only the arithmetic moved. noa
       * answers 0 for a chunk it has not loaded and 0 is also air, so probing
       * a far edge here would go quietly vacuous rather than failing.
       */
      expect(await getBlock(page, 0, SURFACE_Y - 1, MIN_Z - 1)).toBe(ID.barrier)
    })

  test('the barrier is solid but draws nothing and cannot be targeted',
    async ({ page }) => {
      // The three properties that make it a barrier rather than a wall of
      // stone. Solidity is what stops you; the other two are what make it
      // invisible, and both have to be true or you get a grey box on the
      // horizon / a selection outline around thin air.
      const props = await page.evaluate((id) => ({
        solid: window.noa.registry.getBlockSolidity(id),
        opaque: window.noa.registry.getBlockOpacity(id),
        // noa stores six face materials per block; 0 means "no material".
        material: window.noa.registry.getBlockFaceMaterial(id, 0),
        targetable: window.noa.blockTargetIdCheck(id),
      }), ID.barrier)

      expect(props.solid).toBe(true)
      // opaque:true would cull the faces of the terrain standing against it
      // and open the world's skin along the whole perimeter.
      expect(props.opaque).toBe(false)
      expect(props.material).toBe(0)
      expect(props.targetable).toBe(false)
    })

  test('the ground is Classic Flat: grass, two dirt, bedrock, void',
    async ({ page }) => {
      /*
       * REWRITTEN TWICE, and the claim has narrowed both times. It was
       * noise-generated strata from y=63 down to a bedrock floor at y=0; then
       * it was the same shape of claim against imported Minecraft terrain
       * (grass, dirt under it, some rock under that, bedrock two hundred
       * blocks down at y=-64).
       *
       * It is now the EXACT ladder, because the world is generated from a
       * preset and a preset has no "some rock under that" in it. This is
       * Minecraft's own Classic Flat, from minecraft.wiki's Superflat page:
       * bedrock, two dirt, a grass block. Four blocks, and then nothing.
       *
       * Asserting the exact blocks rather than "solid, not dirt" is the whole
       * gain of generating the world: src/flatworld.js's FLAT_PRESETS.classic
       * is a list this test can be read against, so a typo in the preset fails
       * here instead of rendering as a slightly wrong hillside.
       *
       * READ AT THE SPAWN COLUMN AGAIN. It moved out to patch (1, 1) for a day
       * because world (0, 0) was the middle of stage 4's plot and had a
       * building on it. There is no stage 4 in this world any more, so the
       * question goes back to the column the player is actually standing in --
       * which is the one column whose answer anybody would notice being wrong.
       */
      const gen = (x, y, z) =>
        page.evaluate(([a, b, c]) => window.game.voxelAt(a, b, c), [x, y, z])

      expect(await gen(0, SURFACE_Y, 0)).toBe(ID.air)
      expect(await gen(0, SURFACE_Y - 1, 0)).toBe(ID.grass)
      expect(await gen(0, SURFACE_Y - 2, 0)).toBe(ID.dirt)
      expect(await gen(0, SURFACE_Y - 3, 0)).toBe(ID.dirt)
      expect(await gen(0, SURFACE_Y - 4, 0)).toBe(ID.bedrock)

      /*
       * Below the bedrock, read through the GENERATOR rather than through
       * noa.getBlock -- a real distinction rather than a convenience, kept
       * from the version of this test that had to reach y=-64. getBlock
       * answers 0 for a chunk that is not resident and 0 is also air, so
       * "there is nothing there" and "nothing is loaded there" are the same
       * answer. `voxelAt` asks what the world IS.
       *
       * (The floor is four blocks down now instead of two hundred, so it
       * would in fact be resident. Asking the generator anyway keeps the test
       * honest the day the preset gets thicker.)
       */
      expect(await gen(0, SURFACE_Y - 5, 0)).toBe(ID.air)

      // FLAT means flat: the same ladder in a far corner of the patch, not
      // just under spawn. This is the assertion the imported world could not
      // make, and it is the one the owner actually asked for.
      expect(await gen(MIN_X, SURFACE_Y - 1, MAX_Z)).toBe(ID.grass)
      expect(await gen(MAX_X, SURFACE_Y - 1, MIN_Z)).toBe(ID.grass)
      expect(await gen(MIN_X, SURFACE_Y, MAX_Z)).toBe(ID.air)
      expect(await gen(MAX_X, SURFACE_Y - 4, MIN_Z)).toBe(ID.bedrock)
    })

  test('the overworld is generated, not an imported asset', async ({ page }) => {
    /*
     * The one thing about this world you cannot tell by probing voxels, and
     * the reason the change was worth making: no Mojang generator output
     * ships for the overworld, so DECISIONS.md #1's licence question and the
     * 404KB asset both stop applying to it.
     *
     * Asserted as terrain.source rather than by watching for a request to
     * /terrain/terrain.bin, because a 404 that nobody notices would also mean
     * "no request succeeded". This asks what the world IS made of.
     */
    expect(await page.evaluate(() => window.game.terrain.source)).toBe('generated')
  })

  test('the player comes to rest standing on the grass, at the origin',
    async ({ page }) => {
      /*
       * The claim that matters -- your feet end up ON the ground at SURFACE_Y
       * rather than sunk into it -- has been asserted unchanged through three
       * worlds. What moves is where the ground is, and it has moved back: the
       * timeline went to claude-opus-5-1 and took its road-end spawn with it,
       * so the default world arrives at its origin again.
       *
       * AND IT IS GRASS UNDER HIM, which is the half of this test that
       * discriminates. The same line read `.not.toBe(ID.grass)` yesterday,
       * because the paving REPLACES the grass block rather than sitting on it.
       * Standing on grass at the origin is therefore a fact that is true in
       * exactly one of the two generated worlds, and a build stamped into the
       * wrong one fails right here.
       */
      const [x, y, z] = await page.evaluate(() =>
        [...window.noa.ents.getPositionData(window.noa.playerEntity).position])
      expect(y).toBeCloseTo(SURFACE_Y, 2)
      expect(x).toBeCloseTo(0.5, 3)
      expect(z).toBeCloseTo(0.5, 3)

      expect(await getBlock(page, Math.floor(x), SURFACE_Y - 1, Math.floor(z)))
        .toBe(ID.grass)
    })

  test('the world renders something other than a blank canvas', async ({ page }) => {
    // Visual by nature: "did WebGL initialise and did terrain mesh" has no
    // honest numeric form from outside the page, so this is the screenshot.
    // The weak version -- asserting a canvas element exists -- passes even
    // when swiftshader never came up, which is exactly the failure it should
    // have caught, so it is deliberately not asserted here.
    await shot(page, 'world-noon')
  })
})

/*
 * ------------------------------------------------------------------------
 * THE TWO WORLDS, AND THE ASSERTION THAT PASSES VACUOUSLY IF YOU GET IT WRONG
 *
 * "The world is empty" is the most dangerous sentence a probe in this repo
 * can be asked to check. Every wrong way of asking it -- a world that failed
 * to generate, a rectangle with no columns in it, a y range that starts above
 * the ceiling, or simply asking the wrong dimension -- returns "yes, empty".
 * So the census below counts what it LOOKED AT as well as what it found, and
 * the sample size is asserted before the result is.
 *
 * The complement matters just as much: the eight builds did not stop existing
 * because they changed address, and a refactor that quietly emptied
 * claude-opus-5-1 would leave the "default world is bare" test greener than
 * ever. Both worlds are censused with the same function, in the same session,
 * and the two answers are asserted against each other.
 * ------------------------------------------------------------------------
 */
test.describe('the default world is bare and the timeline lives elsewhere', () => {
  /*
   * One booted page per worker, so a spec that ends in another world hands
   * the next spec another world. Same pattern as 34-nether and 51-worlds.
   * leaveWorld is a no-op when we never left.
   */
  test.afterEach(async ({ page }) => { await leaveWorld(page) })

  /**
   * Non-air blocks strictly ABOVE the ground, over the whole patch, read out
   * of island.js's generator for whichever world is current.
   *
   * THE GENERATOR AND NOT noa.getBlock, because this reads 16384 columns and
   * only a few hundred of them are ever resident in the chunk store. Asking
   * noa would report the other fifteen thousand as air and the test would
   * "pass" over a world it never looked at. (The switching test below asks
   * noa DELIBERATELY, for the opposite reason.)
   *
   * It returns its own sample size, and every caller asserts on that first.
   */
  const survey = (page, surfaceY) => page.evaluate((y0) => {
    const v = window.game.voxelAt
    const t = window.game.terrain
    let columns = 0, sampled = 0, above = 0, grass = 0
    // World coordinates, derived from the live patch rather than hardcoded,
    // so this reads the whole of whichever world is current.
    const x0 = -t.originX, z0 = -t.originZ
    for (let z = z0; z < z0 + t.depth; z++) {
      for (let x = x0; x < x0 + t.width; x++) {
        columns++
        if (v(x, y0 - 1, z) === window.game.ids.grass) grass++
        for (let y = y0; y <= t.yTop; y++) {
          sampled++
          if (v(x, y, z) !== 0) above++
        }
      }
    }
    return { columns, sampled, above, grass, world: t.dimension }
  }, surfaceY)

  test('nothing is stamped anywhere in the default world', async ({ page }) => {
    const s = await survey(page, SURFACE_Y)

    /*
     * THE SAMPLE, ASSERTED BEFORE THE RESULT. 256x256 columns and 65 blocks
     * of headroom each (SURFACE_Y=136 up to the ceiling at 200), which is
     * 4,259,840 voxels. If any of those numbers is zero the "above === 0"
     * below is a sentence about nothing.
     */
    expect(s.world).toBe('overworld')
    expect(s.columns).toBe(256 * 256)
    expect(s.sampled).toBe(256 * 256 * 65)

    // The claim. Not "no builds near spawn" -- no block above the grass
    // anywhere in the patch, which is the only form of "bare" worth asserting
    // when the owner is about to build in it.
    expect(s.above).toBe(0)

    /*
     * ...and the ground really is under all of it, which is the other way the
     * survey could be looking at the wrong y: a world with its floor
     * somewhere else would report zero grass AND zero blocks above it, and
     * the line above would pass on nothing.
     *
     * It is also a second, independent reading of "bare". Pointing the
     * overworld row back at a stamper turns 65536 into fewer, because the
     * road and the plot paving REPLACE grass at ground level rather than
     * standing on top of it -- which the count above cannot see at all.
     */
    expect(s.grass).toBe(256 * 256)

    /*
     * And the road specifically, because it is the one build that would be
     * hardest to see in a count: it replaces grass at ground level rather
     * than adding blocks above it, so a road stamped into this world would
     * leave `above` at exactly zero and only this line would notice.
     */
    const underRoad = await page.evaluate(([x, z, y]) => window.game.voxelAt(x, y, z),
      [SPAWN_PATCH_X - ORIGIN_X, SPAWN_PATCH_Z - ORIGIN_Z, SURFACE_Y - 1])
    expect(underRoad).toBe(ID.grass)
  })

  test(`the eight stages are standing in ${BUILT_WORLD}`, async ({ page }) => {
    await enterWorld(page, BUILT_WORLD)
    const s = await survey(page, SURFACE_Y)

    expect(s.world).toBe(BUILT_WORLD)
    /*
     * STILL 128, AND THAT IS NOW THE POINT. It used to say "same patch as the
     * overworld, which is what makes the plot table valid"; the overworld is
     * 256 and this world did not move, so these two lines are the archive's
     * geometry asserted against a world that grew around it. A regression
     * that sized this world from PATCH_SIZE fails here and in
     * test/51-worlds.spec.js, before anybody looks at a block.
     */
    expect(s.columns).toBe(128 * 128)
    expect(s.sampled).toBe(128 * 128 * 65)

    /*
     * The census, and a floor rather than a figure. Measured at 41,000-odd
     * blocks above the grass across the nine allocations; test/70-builds.spec.js
     * owns the per-plot thresholds and the argument for why they are floors.
     * What THIS file is for is the one claim that spec cannot make from node:
     * that the world the game actually generates under this name is the built
     * one.
     */
    expect(s.above).toBeGreaterThan(10_000)
    // ...and the road: paving replaces the grass, so the spawn column is the
    // one block that is definitely NOT grass here and definitely IS grass in
    // the overworld. The pair is the discrimination.
    const underRoad = await page.evaluate(([x, z, y]) => window.game.voxelAt(x, y, z),
      [SPAWN_PATCH_X - ORIGIN_X, SPAWN_PATCH_Z - ORIGIN_Z, SURFACE_Y - 1])
    expect(underRoad).not.toBe(ID.grass)
    expect(underRoad).not.toBe(ID.air)
  })

  test('switching worlds re-meshes the chunks rather than serving stale ones',
    async ({ page }) => {
      /*
       * ASKED OF noa.getBlock ON PURPOSE, which is the opposite of every
       * other probe in this file.
       *
       * A world change is `island.setDimension` and `noa.worldName` moving
       * together; the generator answers for the new world the instant the
       * first of those runs, so a `voxelAt` probe would pass even if noa never
       * invalidated a single chunk and the player were still standing in a
       * fully-meshed copy of the old world. The chunk STORE is the only thing
       * that can tell the difference, and a stale chunk from the other world
       * is exactly the bug moving the builds between worlds could introduce.
       *
       * Both directions, in one session, at the same coordinate: the spawn
       * column of the built world, which is paving there and grass here.
       */
      const roadX = SPAWN_PATCH_X - ORIGIN_X
      const roadZ = SPAWN_PATCH_Z - ORIGIN_Z

      /*
       * STAND IN THE COLUMN BEFORE READING IT, and this is the part that had
       * to be learned rather than assumed: the first version of this test
       * probed world (-24, 64) from the origin and got 0 back in BOTH worlds.
       * That is not a stale chunk, it is no chunk -- noa only keeps a few
       * chunks around the player and the built world's spawn is 68 blocks from
       * this one. 0 is also air, so a probe that reads an unloaded chunk is
       * the vacuous version of this whole test.
       *
       * So: teleport, then WAIT for noa to answer something that is not air,
       * with a timeout. The wait is the assertion that the chunk arrived; what
       * is in it is the assertion that it is the right world's.
       */
      const meshedUnder = async () => {
        await teleport(page, roadX + 0.5, SURFACE_Y + 2, roadZ + 0.5)
        await page.waitForFunction(([x, y, z]) => window.noa.getBlock(x, y, z) !== 0,
          [roadX, SURFACE_Y - 1, roadZ], { timeout: 30_000, polling: 100 })
        return getBlock(page, roadX, SURFACE_Y - 1, roadZ)
      }

      // Where we start: grass, which an unloaded chunk cannot fake.
      expect(await meshedUnder()).toBe(ID.grass)

      await enterWorld(page, BUILT_WORLD)
      // Paving. If noa had served the overworld chunk it just had for this
      // exact column, this would still say grass.
      const built = await meshedUnder()
      expect(built).not.toBe(ID.grass)
      expect(built).not.toBe(ID.air)

      await leaveWorld(page)
      // ...and back. Grass again means the chunk was really thrown away and
      // rebuilt, in a session that had the other world's copy of it meshed a
      // second ago.
      expect(await meshedUnder()).toBe(ID.grass)
      expect(await page.evaluate(() => window.game.dimensions.active)).toBe('overworld')
    })
})
