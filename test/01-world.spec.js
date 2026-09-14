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
       * REWRITTEN, not relaxed. This used to assert an 80x80 island with open
       * void past its rim. The world is now a 128x128 cut of real Minecraft
       * terrain with the spawn column at the origin, so it runs -87..40 on x
       * and -56..71 on z -- deliberately not symmetric, and the asymmetry is
       * asserted because it is the thing a stale mental model gets wrong.
       *
       * (It ran -40..87 until the terrain asset stopped being mirrored in X.
       * Same patch, same spawn column, reached from the other end.)
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

  test('the strata under spawn run grass, dirt, stone down to bedrock',
    async ({ page }) => {
      // Was: an assertion about noise-generated strata from y=63 to a bedrock
      // floor at y=0. Same shape of claim against the real world -- the block
      // you stand on, the dirt under it, and rock under that.
      expect(await getBlock(page, 0, SURFACE_Y, 0)).toBe(ID.air)
      expect(await getBlock(page, 0, SURFACE_Y - 1, 0)).toBe(ID.grass)
      expect(await getBlock(page, 0, SURFACE_Y - 2, 0)).toBe(ID.dirt)
      expect(await getBlock(page, 0, SURFACE_Y - 3, 0)).toBe(ID.dirt)

      const below = await getBlock(page, 0, SURFACE_Y - 4, 0)
      expect(below).not.toBe(ID.dirt)
      expect(below).not.toBe(ID.air)

      /*
       * The floor is read through the GENERATOR, not through noa.getBlock, and
       * that is a real distinction rather than a convenience. Bedrock is at
       * y=-64, two hundred blocks under spawn, and noa's vertical
       * chunkAddDistance is three chunks of 32 -- so the floor is never
       * resident while you are standing on the surface and getBlock would
       * answer 0 for "unloaded", which is the same 0 it uses for air. Asking
       * the generator asks what the world IS rather than what is currently in
       * memory.
       */
      const gen = (x, y, z) =>
        page.evaluate(([a, b, c]) => window.game.voxelAt(a, b, c), [x, y, z])

      expect(await gen(0, -64, 0)).toBe(ID.bedrock)
      // ...and nothing at all below it. This is the void respawn.js still
      // watches for; it is simply no longer reachable by walking.
      expect(await gen(0, -65, 0)).toBe(ID.air)
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
