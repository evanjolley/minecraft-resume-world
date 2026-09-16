import { test, expect } from './fixtures.js'
import { ID, MIN_X, MAX_X, MIN_Z, MAX_Z, SURFACE_Y, getBlock } from './helpers/world.js'
import { shot } from './helpers/shots.js'

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

      // ...and the wall is really standing in the world, not only in the
      // generator: the near edge is inside the load range, so noa agrees.
      expect(await getBlock(page, MAX_X + 1, SURFACE_Y - 1, 0)).toBe(ID.barrier)
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
      expect(await getBlock(page, 0, SURFACE_Y, 0)).toBe(ID.air)
      expect(await getBlock(page, 0, SURFACE_Y - 1, 0)).toBe(ID.grass)
      expect(await getBlock(page, 0, SURFACE_Y - 2, 0)).toBe(ID.dirt)
      expect(await getBlock(page, 0, SURFACE_Y - 3, 0)).toBe(ID.dirt)
      expect(await getBlock(page, 0, SURFACE_Y - 4, 0)).toBe(ID.bedrock)

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
      const gen = (x, y, z) =>
        page.evaluate(([a, b, c]) => window.game.voxelAt(a, b, c), [x, y, z])

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

  test('the player comes to rest standing on the grass, not inside it', async ({ page }) => {
    const [x, y, z] = await page.evaluate(() =>
      [...window.noa.ents.getPositionData(window.noa.playerEntity).position])
    expect(y).toBeCloseTo(SURFACE_Y, 2)
    expect(x).toBeCloseTo(0.5, 3)
    expect(z).toBeCloseTo(0.5, 3)
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
