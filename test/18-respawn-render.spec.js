import sharp from 'sharp'
import { test, expect } from './fixtures.js'
import { SURFACE_Y, teleport, waitFrames } from './helpers/world.js'

/*
 * Respawning must hand you back a world that is already drawn.
 *
 * The bug this exists for: dying froze your input but not your gravity, so
 * the corpse kept accelerating down the void for as long as the death screen
 * was up. noa loads chunks in a 3D box around you, so a few seconds of
 * reading "You Died!" put you far enough below the island that every island
 * chunk fell outside chunkRemoveDistance and was unloaded. Respawn then put
 * you home on top of nothing and you watched ~63 chunks regenerate.
 *
 * Both halves are here on purpose. `terrainMeshCount` is the MECHANISM and
 * is what localises a regression to chunk loading; the pixel check is the
 * SYMPTOM in the owner's own words -- "it takes too long for the blocks
 * beneath me to appear" -- and is the one that cannot be satisfied by
 * anything other than a world you can actually see.
 */

/** Terrain chunk meshes. noa names them `chunk_<requestID>_<terrainID>`;
 *  nothing else in the scene uses that prefix. */
const terrainMeshCount = (page) => page.evaluate(() =>
  window.noa.rendering.getScene().meshes.filter((m) => m.name.startsWith('chunk_')).length)

/**
 * Mean colour of a patch of screen that is solid ground when the world is
 * drawn and open sky when it is not.
 *
 * Chosen to dodge the three things that are not terrain: the hotbar strip
 * along the bottom, the held-item arm down the right, and the horizon. What
 * is left at spawn, looking level, is grass all the way across.
 */
const LOWER_CENTRE = { x: 200, y: 430, width: 500, height: 170 }

async function groundPatch(page) {
  const png = await page.screenshot({ clip: LOWER_CENTRE })
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  let r = 0, g = 0, b = 0, n = 0
  for (let i = 0; i < data.length; i += info.channels) {
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n++
  }
  return { r: r / n, g: g / n, b: b / n }
}

/** Fall off the rim for real -- 126 blocks, the way a visitor dies -- rather
 *  than teleporting into the void, so the chunk bookkeeping is the same one
 *  the player exercises. */
async function dieByFalling(page) {
  await teleport(page, 60.5, SURFACE_Y + 1, 60.5)
  await page.waitForFunction(() => window.game.survival.dead, null,
    { timeout: 30_000, polling: 20 })
}

/*
 * Four seconds is not a magic number, it is "long enough to read two words
 * and find the button". Before the fix the island was gone after two.
 */
const LINGER_MS = 4000

test.describe('respawning into a world that is already drawn', () => {
  test('lingering on the death screen does not unload the island', async ({ page }) => {
    const before = await terrainMeshCount(page)
    expect(before, 'no terrain meshed before the test even started').toBeGreaterThan(20)

    await dieByFalling(page)
    await page.waitForTimeout(LINGER_MS)

    const after = await terrainMeshCount(page)
    expect(after, `island chunks went ${before} -> ${after} while the death screen was up`)
      .toBeGreaterThanOrEqual(before)
  })

  test('the first frame after respawn has ground under you, not sky',
    async ({ page }) => {
      await dieByFalling(page)
      await page.waitForTimeout(LINGER_MS)

      await page.locator('#respawn-btn').click()
      await waitFrames(page, 1)

      /*
       * Grass and sky are opposites in the blue channel -- grass sits near
       * b=85 and noa's clear colour near b=245 -- so one comparison separates
       * them with an enormous margin and without pinning either to a shade.
       * A missing chunk shows the clear colour through it, which is why
       * "can I see the ground" and "is this pixel blue" are the same question.
       */
      const px = await groundPatch(page)
      const where = `rgb(${px.r.toFixed(0)}, ${px.g.toFixed(0)}, ${px.b.toFixed(0)})`
      expect(px.b, `looking at sky through the floor: ${where}`).toBeLessThan(150)
      expect(px.g, `nothing green under foot: ${where}`).toBeGreaterThan(px.b)
    })

  test('the corpse stays where it died instead of sinking out of the world',
    async ({ page }) => {
      await dieByFalling(page)
      const y0 = await page.evaluate(() =>
        window.noa.ents.getPositionData(window.noa.playerEntity).position[1])
      await page.waitForTimeout(LINGER_MS)
      const y1 = await page.evaluate(() =>
        window.noa.ents.getPositionData(window.noa.playerEntity).position[1])

      // Half a block of settle is fine; hundreds are what cost you the world.
      expect(Math.abs(y1 - y0), `corpse fell ${(y0 - y1).toFixed(0)} more blocks while dead`)
        .toBeLessThan(0.5)
    })
})
