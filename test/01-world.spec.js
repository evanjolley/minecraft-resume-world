import { test, expect } from './fixtures.js'
import { ID, MIN_X, MAX_X, MIN_Z, MAX_Z, SURFACE_Y, getBlock } from './helpers/world.js'
import { shot } from './helpers/shots.js'
/* The plot table, read rather than copied. src/builds/plots.js is plain data
 * with no imports of its own, which is why a spec (and src/island.js) may
 * read it without dragging Babylon in. */
import { SPAWN_PATCH_X, SPAWN_PATCH_Z, ORIGIN_X, ORIGIN_Z } from '../src/builds/plots.js'

/** A column inside the world and outside every plot: patch (1, 1), in the
 *  margin the road and the eight stages all stop short of. */
const BARE_X = 1 - ORIGIN_X
const BARE_Z = 1 - ORIGIN_Z

test.describe('world generation', () => {
  test('the page boots with no errors, failed requests or 404s', async ({ bootErrors }) => {
    // Missing textures land here first: a 404 on /textures/*.png never throws,
    // it just renders the block untextured, which no numeric assertion sees.
    expect(bootErrors).toEqual([])
  })

  test('the world is a 128x128 patch with an invisible wall around it',
    async ({ page }) => {
      /*
       * REWRITTEN ONCE, not relaxed since. This used to assert an 80x80 island
       * with open void past its rim. The world is a 128x128 patch with spawn
       * at the origin, so it runs -87..40 on x and -56..71 on z -- deliberately
       * not symmetric, and the asymmetry is asserted because it is the thing a
       * stale mental model gets wrong.
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
       * not resident, and 0 is also air. The far corner is 87 blocks out, past
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
       * WHICH EDGE THAT IS HAS CHANGED. This read the +X edge back when spawn
       * was the patch origin. Spawn is now the south end of the road, eight
       * blocks from the +Z edge and ninety from that one -- and noa answers 0
       * for a chunk it has not loaded, which is also air, so the old probe
       * would have gone quietly vacuous rather than failing.
       */
      expect(await getBlock(page, SPAWN_PATCH_X - ORIGIN_X, SURFACE_Y - 1, MAX_Z + 1))
        .toBe(ID.barrier)
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
       */
      /*
       * READ AT A MARGIN COLUMN, and that is the change the builds forced.
       *
       * This used to probe the spawn column at world (0, 0). Two things about
       * that column are no longer true: spawn is not there any more (it is the
       * south end of the road -- see WORLDS.overworld in src/island.js), and
       * (0, 0) is patch (87, 56), which is the middle of stage 4's plot and
       * will have a building on it within the day.
       *
       * BARE_X/BARE_Z is patch (1, 1): inside the world, outside every plot in
       * src/builds/plots.js and outside the road, and it will stay that way
       * because the stamper throws if anybody writes outside their plot. The
       * claim the test is making is unchanged -- the ground is Classic Flat --
       * it is only being asked somewhere the answer is still about the ground.
       */
      const gen = (x, y, z) =>
        page.evaluate(([a, b, c]) => window.game.voxelAt(a, b, c), [x, y, z])

      expect(await gen(BARE_X, SURFACE_Y, BARE_Z)).toBe(ID.air)
      expect(await gen(BARE_X, SURFACE_Y - 1, BARE_Z)).toBe(ID.grass)
      expect(await gen(BARE_X, SURFACE_Y - 2, BARE_Z)).toBe(ID.dirt)
      expect(await gen(BARE_X, SURFACE_Y - 3, BARE_Z)).toBe(ID.dirt)
      expect(await gen(BARE_X, SURFACE_Y - 4, BARE_Z)).toBe(ID.bedrock)

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
      expect(await gen(BARE_X, SURFACE_Y - 5, BARE_Z)).toBe(ID.air)

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

  test('the player comes to rest on the road, at the south end of the timeline',
    async ({ page }) => {
      /*
       * REWRITTEN, NOT RELAXED. The claim that matters here -- your feet end
       * up ON the ground at SURFACE_Y rather than sunk into it -- is asserted
       * exactly as before. What moved is where the ground is: the world is a
       * timeline now, eight stages up one road, and arriving at the origin
       * would have dropped a visitor in the middle of stage 4 facing nothing.
       * Spawn is the south end of the road, under the arch.
       *
       * The coordinate is READ FROM src/builds/plots.js rather than written
       * here, because a test that hardcodes it would pass while disagreeing
       * with the world -- and the whole reason the number lives in the plot
       * table is that the road may move.
       */
      const [x, y, z] = await page.evaluate(() =>
        [...window.noa.ents.getPositionData(window.noa.playerEntity).position])
      expect(y).toBeCloseTo(SURFACE_Y, 2)
      expect(x).toBeCloseTo(SPAWN_PATCH_X - ORIGIN_X + 0.5, 3)
      expect(z).toBeCloseTo(SPAWN_PATCH_Z - ORIGIN_Z + 0.5, 3)

      // ...and it is the road he is standing on, not the lawn beside it: the
      // paving replaces the grass block rather than sitting on top of it, so
      // "rests on the ground at SURFACE_Y" and "the road is walkable" are the
      // same assertion.
      expect(await getBlock(page, Math.floor(x), SURFACE_Y - 1, Math.floor(z)))
        .not.toBe(ID.grass)
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
