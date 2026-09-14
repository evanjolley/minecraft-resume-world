import sharp from 'sharp'
import { test, expect } from './fixtures.js'
import { waitFrames, teleport, SURFACE_Y, DROP_X, DROP_Z } from './helpers/world.js'

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

/*
 * Die by falling into the void, which now has to be ENTERED rather than
 * stumbled into.
 *
 * This used to walk off the island's rim: teleport to (60, 65, 60), which was
 * open void past the 80x80 island, and fall 126 blocks. The world is now a
 * 128x128 cut of real terrain with barriers on all four sides, so (60, ., 60)
 * is solid ground and there is no rim anywhere to fall off.
 *
 * Which is a finding, not a workaround, and it is worth writing down: VOID
 * DEATH BY WALKING NO LONGER EXISTS. The void is still there, still below the
 * world floor at y=-64, and still kills you -- but bedrock is unbreakable and
 * the perimeter is sealed, so the only ways to reach it are /tp and this
 * teleport. That is exactly Minecraft's situation, where the void under the
 * overworld is real and unreachable without cheating.
 *
 * The MECHANISM under test is untouched, and that is why this is a rewrite
 * rather than a deletion. The bug was "a dead player keeps accelerating
 * downward, and noa unloads chunks in a box around him". So: drop in below the
 * floor, hold still long enough for the chunks down there to mesh, then let
 * go. An unfrozen corpse falls hundreds of blocks off the bottom of that box
 * and the mesh count collapses; a frozen one keeps every chunk it had. The
 * chunks being counted are the ones around the death site rather than the ones
 * around spawn, which is the one thing that had to change -- teleporting two
 * hundred blocks down evicts the spawn chunks before anybody has died.
 *
 * @returns the terrain mesh count at the moment of the fall.
 */
async function dieByFalling(page) {
  await page.evaluate(() => {
    const noa = window.noa
    // Four blocks under the world floor: void air, nothing to stand on, and
    // two blocks above island.js's VOID_Y of -70.
    noa.ents.setPosition(noa.playerEntity, [0.5, -68, 0.5])
    const body = noa.ents.getPhysics(noa.playerEntity).body
    body.velocity[0] = body.velocity[1] = body.velocity[2] = 0
    // Hold position while the chunks below the world mesh. Released below --
    // and it MUST be released before death, or respawn.js saves a gravity
    // multiplier of 0 and hands it back, leaving a respawned player floating.
    body.gravityMultiplier = 0
    window.game.survival.clearFallTracking()
  })

  /*
   * Wait for the count to STOP MOVING, not merely to clear a threshold.
   * Arriving two hundred blocks below spawn puts noa's loader to work in both
   * directions at once -- meshing the floor, evicting the surface -- and a
   * count sampled mid-stream reads high by whatever has not been evicted yet.
   * The test would then blame the corpse for chunks that were always going.
   */
  await page.waitForFunction(() => {
    const n = window.noa.rendering.getScene().meshes
      .filter((m) => m.name.startsWith('chunk_')).length
    const prev = window.__meshSettle
    window.__meshSettle = { n, hits: prev && prev.n === n ? prev.hits + 1 : 0 }
    return n > 20 && window.__meshSettle.hits >= 8
  }, null, { timeout: 60_000, polling: 250 })

  const meshes = await terrainMeshCount(page)

  await page.evaluate(() => {
    window.noa.ents.getPhysics(window.noa.playerEntity).body.gravityMultiplier = 1
  })
  await page.waitForFunction(() => window.game.survival.dead, null,
    { timeout: 30_000, polling: 20 })
  return meshes
}

/*
 * Die WITHOUT leaving the neighbourhood: a 60-block drop onto the ground four
 * blocks east of spawn, which is fatal and keeps every chunk around you.
 *
 * The respawn-render test needs this and the void does not serve it any more,
 * which is worth stating plainly rather than hiding in a coordinate. The bug
 * being guarded against is "respawn hands you a world with no geometry in it",
 * and the original scenario was a 126-block fall off the island's rim -- close
 * enough to home that the island stayed loaded the whole way down. There is no
 * rim now, and the void is two hundred blocks below bedrock, so simply GOING
 * there evicts the spawn chunks before anyone has died. Testing the pixel after
 * that would assert something the engine was never claiming.
 *
 * So the symptom is tested on the death that a player can actually have here,
 * and dieByFalling above still covers the void and the corpse freeze.
 */
async function dieByFallDamage(page) {
  await teleport(page, DROP_X, SURFACE_Y + 60, DROP_Z)
  await page.waitForFunction(() => window.game.survival.dead, null,
    { timeout: 30_000, polling: 20 })
}

/*
 * Four seconds is not a magic number, it is "long enough to read two words
 * and find the button". Before the fix the island was gone after two.
 */
const LINGER_MS = 4000

test.describe('respawning into a world that is already drawn', () => {
  test('lingering on the death screen does not unload the world', async ({ page }) => {
    const before = await dieByFalling(page)
    expect(before, 'no terrain meshed before the test even started').toBeGreaterThan(20)

    await page.waitForTimeout(LINGER_MS)

    const after = await terrainMeshCount(page)
    expect(after, `chunks went ${before} -> ${after} while the death screen was up`)
      .toBeGreaterThanOrEqual(before)
  })

  test('the first frame after respawn has ground under you, not sky',
    async ({ page }) => {
      await dieByFallDamage(page)
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
