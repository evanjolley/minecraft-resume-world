import { test, expect } from './fixtures.js'
import { MIN_X, MAX_X, MIN_Z, MAX_Z, SURFACE_Y, ID, look, waitTicks, HEADING } from './helpers/world.js'

/*
 * Which way round the world is.
 *
 * This world shipped for a while as a MIRROR IMAGE of the Minecraft save it
 * was cut from, and the reason nothing looked broken is that everything
 * downstream inherited the mirror and agreed with it. A mirrored world is
 * self-consistent. It is only wrong against the outside.
 *
 * So these tests are deliberately the two kinds of claim a self-consistent
 * mirror cannot satisfy at once:
 *
 *   1. A measurement of the ENGINE, not of the content: at heading 0 the
 *      camera faces +Z, and a point at +X lands on the right of the screen.
 *      Every cardinal name in this repo -- the F3 compass, the stair facings
 *      in blockMeshes.js, the direction the extractor mirrors -- is chosen
 *      from that one fact, and it is measured here so nobody has to trust a
 *      comment about handedness.
 *
 *   2. Claims about WHERE THINGS ARE that are tied to seed 12345 rather than
 *      to this repo. The frozen peaks are at a greater Minecraft X than the
 *      spawn column, so they are east of it, so they must be east of it here.
 *      Every assertion of that kind fails on the pre-flip asset -- they were
 *      checked against it, and they did.
 *
 * See scripts/terrain/extract.mjs MIRROR_X for the fix, and the compass note
 * in src/debugScreen.js for why +X is west and cannot be anything else.
 */

/** The topmost non-air block of a column, asked of the GENERATOR so it works
 *  on chunks that are nowhere near the player. */
const surfaceY = (page, x, z) => page.evaluate(([x, z]) => {
  for (let y = 185; y >= -64; y--) if (window.game.voxelAt(x, y, z) !== 0) return y
  return null
}, [x, z])

const press = async (page, code) => {
  await page.keyboard.down(code)
  await page.keyboard.up(code)
  await waitTicks(page, 2)
}

test.describe('world orientation', () => {
  /*
   * The measurement. Projected through the scene's full transform -- view
   * AND projection -- rather than read off the view matrix, because the
   * handedness can hide in either and only the composition is what a player
   * sees.
   */
  test('facing +Z, the +X axis is on the right of the screen', async ({ page }) => {
    await look(page, { heading: 0, pitch: 0 })
    const { rightHanded, camDir, ndcPlusX, ndcMinusX } = await page.evaluate(() => {
      const noa = window.noa
      const scene = noa.rendering.getScene()
      const eye = scene.activeCamera.globalPosition
      const m = scene.getTransformMatrix().m
      // Babylon stores row-major with a row-vector convention: v' = v * M.
      const ndcX = (px, py, pz) => {
        const x = px * m[0] + py * m[4] + pz * m[8] + m[12]
        const w = px * m[3] + py * m[7] + pz * m[11] + m[15]
        return x / w
      }
      return {
        rightHanded: scene.useRightHandedSystem,
        camDir: [...noa.camera.getDirection()],
        // Twenty blocks ahead, ten to each side.
        ndcPlusX: ndcX(eye.x + 10, eye.y, eye.z + 20),
        ndcMinusX: ndcX(eye.x - 10, eye.y, eye.z + 20),
      }
    })

    // The premise: noa's heading 0 looks down +Z, in a left-handed scene.
    expect(rightHanded).toBe(false)
    expect(camDir[2]).toBeCloseTo(1, 3)

    // The consequence. Minecraft, facing south, puts WEST on your right --
    // which is why +X is west here and `east = [-1, 0, 0]` in blockMeshes.js.
    expect(ndcPlusX).toBeGreaterThan(0)
    expect(ndcMinusX).toBeLessThan(0)
  })

  /*
   * The patch is 128 wide with the spawn column at the origin, and the spawn
   * column is 87 in from the asset's east edge -- so x runs -87..40, and the
   * asymmetry runs the OPPOSITE way to the one that shipped before (-40..87).
   * Asserted because a stale mental model gets exactly this wrong, and because
   * the numbers here and in island.js have to stay in step.
   */
  test('the patch runs -128..127 in x and -16..239 in z', async ({ page }) => {
    /* Was -87..40 / -56..71, when the overworld was a 128 patch at origin
     * 87/56. It is 256 at origin 128/16 now: centred on x so the path may
     * wander either side of you, and offset on z so spawn is at the START of
     * the walk rather than in the middle of it. */
    expect([MIN_X, MAX_X, MIN_Z, MAX_Z]).toEqual([-128, 127, -16, 239])
    expect(await page.evaluate(() => window.game.terrain.originX)).toBe(128)
    expect(await page.evaluate(() => window.game.terrain.originZ)).toBe(16)

    expect(await page.evaluate(([x, y, z]) => window.game.voxelAt(x, y, z),
      [MIN_X, SURFACE_Y - 1, 0])).not.toBe(ID.barrier)
    expect(await page.evaluate(([x, y, z]) => window.game.voxelAt(x, y, z),
      [MAX_X + 1, SURFACE_Y - 1, 0])).toBe(ID.barrier)
  })

  /*
   * THE ONE THAT DISCRIMINATES.
   *
   * Seed 12345's frozen peaks sit at a greater Minecraft X than the spawn
   * column -- the ice at engine (-32, -40) is world X 184 against spawn's 152
   * -- so they are EAST of spawn in the save. The engine's own compass calls
   * -X east. Both halves have to agree, and on the mirrored asset neither
   * did: the peaks stood at +32, which this world calls west.
   *
   * Sixteen blocks of surface height between a mirror pair, in a world whose
   * mean mirror-pair height difference is 29 blocks. There is nothing marginal
   * about this failure on the old asset.
   */
  test('the frozen peaks are east of spawn, and the compass agrees',
    async ({ page }) => {
      const east = await surfaceY(page, -32, -40)
      const west = await surfaceY(page, 32, -40)
      expect(east).toBe(159)
      expect(west).toBe(143)
      expect(east - west).toBeGreaterThan(10)

      await press(page, 'F3')
      await look(page, { heading: HEADING.eastMinusX, pitch: 0 })
      const s = await page.evaluate(() => window.game.debug.sample())
      expect(s.facing).toBe('east')
      await press(page, 'F3')
    })

  /*
   * The mirror pivots on the spawn column, which is the whole reason nothing
   * about spawn had to move: it was 40 in from one edge and is now 87 in from
   * the other, and both of those are the origin.
   */
  test('spawn is the same Minecraft column it always was', async ({ page }) => {
    expect(await page.evaluate(([y]) => window.game.voxelAt(0, y, 0),
      [SURFACE_Y - 1])).toBe(ID.grass)
    expect(await surfaceY(page, 0, 0)).toBe(140)   // dark oak leaves overhead
  })
})
