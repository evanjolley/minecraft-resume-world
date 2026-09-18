import { test, expect } from './fixtures.js'
import { waitTicks, useGamemode, SURFACE_Y, ID } from './helpers/world.js'

/*
 * THE SKY CHANNEL'S GATE COUNTS WHAT IT SAYS IT COUNTS.
 *
 * `src/blockLight.js` keeps one number per chunk, `offCount`, meaning "how
 * many voxels in here are not at the channel's default". For sky light the
 * default is 15, so that number is "how much shadow is here", and
 * `chunkIsOff` -- the gate `writeVertexLight` and `boxIsShaded` both sit
 * behind -- is `offCount > 0`.
 *
 * WHY THIS IS A SPEC AND NOT A SCREENSHOT. The gate answering FALSE does not
 * draw anything wrong-looking on its own; it means the sky lane is never
 * written into that mesh, and the lane is stored INVERTED, so an unwritten
 * lane reads as full daylight. A roof stops working and every JavaScript
 * number in the file is still correct -- `getSkyLight` says 0, the store says
 * 0, the shader is handed nothing and renders noon. That is this repo's most
 * expensive failure shape and it has no picture.
 *
 * WHAT WAS WRONG. `seedSky` seeded the counter over TRANSPARENT voxels only
 * while `set` maintains it over ALL of them, so the counter sat permanently
 * below the truth by the chunk's solid population -- measured at 4,246
 * against 20,637 on the surface chunk at spawn, an offset of 16,391.
 *
 * WHAT IT COULD COST, stated honestly because THIS world cannot show it: the
 * terrain here is a thin shell, so no chunk carries enough solid voxels for
 * the offset to swallow the count, and no rendered frame in this build
 * changes. In a world with ordinary Minecraft depth a cave hollowed inside an
 * all-stone chunk is exactly the case that reaches zero -- a voxel mined
 * underground stays at sky 0 and never passes through `set`, so it adds
 * nothing to a counter that started 32,768 short.
 *
 * ASSERT THE SAMPLE IS REAL FIRST. `actual` is asserted non-zero before it is
 * asserted equal, because a chunk with no buffer answers null and two nulls
 * would compare equal for the worst possible reason.
 */

const audit = (page, x, y, z) =>
  page.evaluate(([a, b, c]) => window.blockLight.skyGateAudit(a, b, c), [x, y, z])

const drained = (page) => page.waitForFunction(() => {
  const w = window.noa.world
  return w._chunksToMesh.count() + w._chunksToMeshFirst.count() === 0
}, null, { timeout: 30_000 })

/** In the chunk spanning x[-64,-33] z[-32,-1], clear of other specs' rigs. */
const CX = -60
const CZ = -6
const F = SURFACE_Y + 1

test('the sky gate counter equals the shadow actually stored, at seed time', async ({ page }) => {
  await drained(page)
  const a = await audit(page, CX, F, CZ)
  console.log(`[gate] at seed: counted ${a.counted}, actually off the default ${a.actual}`)
  expect(a.actual, 'no sky buffer for this chunk -- this test proved nothing').not.toBeNull()
  expect(a.actual, 'the chunk holds no shadow at all, so equality is vacuous')
    .toBeGreaterThan(0)
  expect(a.counted).toBe(a.actual)
})

test('and still equals it after a room is sealed and a patch is mined',
  async ({ page, terrain }) => {
    await useGamemode(page, 'creative')
    await terrain.keep([CX - 4, F - 2, CZ - 4], [CX + 4, F + 6, CZ + 4])
    await terrain.keep([-56, SURFACE_Y - 8, -24], [-40, SURFACE_Y + 8, -8])
    const before = await audit(page, CX, F, CZ)

    // A sealed 3x3x3 box: every interior voxel goes from 15 to 0, so the
    // counter must RISE.
    await page.evaluate(([cx, cz, y0, stone, air]) => {
      const ceil = y0 + 4
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          for (let y = y0; y <= ceil; y++) {
            const wall = dx === -2 || dx === 2 || dz === -2 || dz === 2
            const cap = y === y0 || y === ceil
            window.noa.setBlock(wall || cap ? stone : air, cx + dx, y, cz + dz)
          }
        }
      }
    }, [CX, CZ, F, ID.stone, ID.air])
    await waitTicks(page, 6)
    await drained(page)
    const sealed = await audit(page, CX, F, CZ)

    // Strip the top solid layer off a 16x16 patch in the same chunk: every
    // one of those voxels goes from 0 to 15, so the counter must FALL.
    const mined = await page.evaluate(([top, air]) => {
      let n = 0
      for (let x = -56; x <= -41; x++) {
        for (let z = -24; z <= -9; z++) {
          for (let y = top; y > top - 10; y--) {
            if (window.noa.getBlock(x, y, z) !== 0) {
              window.noa.setBlock(air, x, y, z); n++; break
            }
          }
        }
      }
      return n
    }, [SURFACE_Y + 5, ID.air])
    await waitTicks(page, 10)
    await drained(page)
    const after = await audit(page, CX, F, CZ)

    console.log(`[gate] seed ${before.counted}/${before.actual}`
      + ` -> sealed ${sealed.counted}/${sealed.actual}`
      + ` -> mined ${mined} voxels ${after.counted}/${after.actual}`)

    // The edits really happened, before anything is claimed about them.
    expect(mined).toBeGreaterThan(100)
    expect(sealed.actual).toBeGreaterThan(before.actual)
    expect(after.actual).toBeLessThan(sealed.actual)

    expect(sealed.counted).toBe(sealed.actual)
    expect(after.counted).toBe(after.actual)
  })
