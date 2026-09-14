import { test, expect } from './fixtures.js'
import {
  ID, SURFACE_Y, HEADING, aim, holdMouse, targetedBlock, getBlock, setBlock,
  teleport, settleOnGround, waitTicks, useGamemode, gamemode, standOnBedrock,
} from './helpers/world.js'
import { shotRegion } from './helpers/shots.js'

/* Straight down. noa clamps pitch just short of a right angle, so the exact
 * value does not matter as long as the ray lands on the block underfoot. */
const DOWN = Math.PI / 2

/* blocks.js hardness is already BARE-HANDED SECONDS. Grass is 0.9. */
const GRASS_BREAK_MS = 900

const invCount = (page, id) => page.evaluate((want) => window.game.inventory.slots
  .filter(s => s && s.id === want)
  .reduce((n, s) => n + s.count, 0), id)

/*
 * EVERY test below asks for survival mode first, and that is the point of the
 * change rather than a workaround for it: ADVENTURE IS NOW THE DEFAULT, so
 * "hold left click and the block goes away" is no longer true of the world a
 * visitor lands in. Mining is a survival-mode fact and these tests now say so.
 *
 * The adventure half of the same behaviour is asserted in 10-gamemode.spec.js.
 */
test.describe('mining', () => {
  test.beforeEach(async ({ page }) => {
    await useGamemode(page, 'survival')
    expect(await gamemode(page)).toBe('survival')
  })

  test('breaking grass drops dirt, not grass', async ({ page, terrain }) => {
    await terrain.keep([0, SURFACE_Y - 1, 0], [0, SURFACE_Y - 1, 0])
    await aim(page, { pitch: DOWN })

    expect(await targetedBlock(page)).toMatchObject({ position: [0, SURFACE_Y - 1, 0] })

    await holdMouse(page, GRASS_BREAK_MS + 600)

    expect(await getBlock(page, 0, SURFACE_Y - 1, 0)).toBe(ID.air)
    // Minecraft's drop rule. Getting a grass block back is the bug.
    expect(await invCount(page, ID.dirt)).toBe(1)
    expect(await invCount(page, ID.grass)).toBe(0)
  })

  test('releasing early throws the progress away instead of banking it',
    async ({ page, terrain }) => {
      await terrain.keep([0, SURFACE_Y - 1, 0], [0, SURFACE_Y - 1, 0])
      await aim(page, { pitch: DOWN })

      // Two partial chews totalling MORE than one break time. If progress
      // survived the release the block would pop on the second one.
      await holdMouse(page, 500)
      await waitTicks(page, 3)
      await holdMouse(page, 600)

      expect(await getBlock(page, 0, SURFACE_Y - 1, 0)).toBe(ID.grass)
      expect(await invCount(page, ID.dirt)).toBe(0)
    })

  test('bedrock never breaks, however long you hold', async ({ page, terrain }) => {
    // Carve a standing pocket at the world floor. Faster and far more precise
    // than mining 200 blocks down, and restored afterwards. The floor moved
    // from y=0 to y=-64 with the imported world, and getting there is now a
    // trip rather than a reach -- see standOnBedrock.
    await standOnBedrock(page, terrain)
    await aim(page, { pitch: DOWN })

    expect(await getBlock(page, 0, -64, 0)).toBe(ID.bedrock)
    expect(await targetedBlock(page)).toMatchObject({ position: [0, -64, 0] })

    /*
     * Progress is recorded while the button is held, because "unbreakable"
     * must not mean "silent". Vanilla keeps ticking the hit sound on bedrock;
     * returning early before the progress event -- which is what this did --
     * made punching it produce nothing at all.
     */
    await page.mouse.down({ button: 'left' })
    // Three seconds is over three times grass's break time, which is what
    // would break here if the Infinity guard were dropped.
    const hits = await page.evaluate(() => new Promise((resolve) => {
      const seen = []
      const off = window.game.interaction.onBreakProgress(
        (e) => { if (e.position) seen.push(e.frac) })
      setTimeout(() => { off(); resolve(seen) }, 3000)
    }))
    await page.mouse.up({ button: 'left' })
    await waitTicks(page, 2)

    expect(await getBlock(page, 0, -64, 0)).toBe(ID.bedrock)
    expect(await invCount(page, ID.bedrock)).toBe(0)
    expect(hits.length, 'punching bedrock published no progress at all')
      .toBeGreaterThan(10)
    // ...and none of it is progress. Any non-zero frac would draw a crack
    // overlay on a block that is never going to break.
    expect(hits.every(f => f === 0), 'bedrock accumulated break progress').toBe(true)
  })
})

test.describe('placing', () => {
  test.beforeEach(async ({ page }) => { await useGamemode(page, 'survival') })

  /*
   * A 1-block wall two east of spawn, at eye level. Looking at it flat gives a
   * target whose adjacent face is the empty block between it and the player --
   * legal to build into -- while looking DOWN gives one that is inside the
   * player, which must be refused. Same code path, opposite outcomes.
   */
  const WALL = [2, SURFACE_Y + 1, 0]

  test('right-clicking a block face places from the selected hotbar slot',
    async ({ page, terrain }) => {
      await terrain.keep([1, SURFACE_Y, 0], [2, SURFACE_Y + 1, 0])
      await setBlock(page, ID.planks, ...WALL)
      await page.evaluate(() => window.game.inventory.add(5, 10))

      await aim(page, { heading: HEADING.eastPlusX, pitch: 0 })
      expect(await targetedBlock(page)).toMatchObject({ position: WALL })

      await page.mouse.down({ button: 'right' })
      await page.mouse.up({ button: 'right' })
      await waitTicks(page, 2)

      expect(await getBlock(page, 1, SURFACE_Y + 1, 0)).toBe(ID.planks)
      expect(await invCount(page, ID.planks)).toBe(9)
    })

  test('placing is refused when the block would be inside the player',
    async ({ page }) => {
      await page.evaluate(() => window.game.inventory.add(5, 10))
      await aim(page, { pitch: DOWN })

      // Target is the grass underfoot, so the adjacent face is the player's
      // own feet. Without the entity-overlap check this entombs you.
      expect(await targetedBlock(page)).toMatchObject({
        position: [0, SURFACE_Y - 1, 0], adjacent: [0, SURFACE_Y, 0],
      })

      await page.mouse.down({ button: 'right' })
      await page.mouse.up({ button: 'right' })
      await waitTicks(page, 2)

      expect(await getBlock(page, 0, SURFACE_Y, 0)).toBe(ID.air)
      expect(await invCount(page, ID.planks), 'an item was consumed by a refused place')
        .toBe(10)
    })

  test('opening the inventory with E does not also place a block', async ({ page, terrain }) => {
    /*
     * noa's default bindings put `alt-fire` on ["Mouse3", "KeyE"], and
     * inventory.js ADDS "inventory" to KeyE rather than replacing it. Both
     * handlers fire on one keydown, alt-fire first -- while inv.open is still
     * false, so its guard does not help.
     */
    await terrain.keep([1, SURFACE_Y, 0], [2, SURFACE_Y + 1, 0])
    await setBlock(page, ID.planks, ...WALL)
    await page.evaluate(() => window.game.inventory.add(5, 10))
    await aim(page, { heading: HEADING.eastPlusX, pitch: 0 })

    await page.keyboard.press('KeyE')
    await waitTicks(page, 2)

    expect(await getBlock(page, 1, SURFACE_Y + 1, 0),
      'E placed a block on its way to opening the inventory').toBe(ID.air)
    expect(await invCount(page, ID.planks)).toBe(10)
  })

  test('the block outline and crack overlay draw on the targeted block',
    async ({ page, terrain }) => {
      // Visual. The outline is a Babylon line mesh and the crack overlay is a
      // textured quad; both are "does it look right on the face you are
      // chewing", which no property read answers honestly.
      await terrain.keep([0, SURFACE_Y - 1, 0], [0, SURFACE_Y - 1, 0])
      await aim(page, { pitch: DOWN * 0.75 })
      await page.mouse.down({ button: 'left' })
      await page.waitForTimeout(500)
      await shotRegion(page, 'mining-crack', 'crosshair')
      await page.mouse.up({ button: 'left' })
    })
})
