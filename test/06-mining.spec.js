import { test, expect } from './fixtures.js'
import {
  ID, SURFACE_Y, HEADING, aim, holdMouse, targetedBlock, getBlock, setBlock,
  teleport, settleOnGround, waitTicks,
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

test.describe('mining', () => {
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
    // than mining 60 blocks down, and restored afterwards.
    await terrain.keep([0, 0, 0], [0, 3, 0])
    await setBlock(page, ID.air, 0, 1, 0)
    await setBlock(page, ID.air, 0, 2, 0)
    await setBlock(page, ID.air, 0, 3, 0)
    await teleport(page, 0.5, 1, 0.5)
    await settleOnGround(page)
    await aim(page, { pitch: DOWN })

    expect(await getBlock(page, 0, 0, 0)).toBe(ID.bedrock)
    expect(await targetedBlock(page)).toMatchObject({ position: [0, 0, 0] })

    // More than twice the slowest breakable block's time (ores, 15 s) would be
    // silly; 3 s is over three times grass's, which is what would break here
    // if the Infinity guard were dropped.
    await holdMouse(page, 3000)

    expect(await getBlock(page, 0, 0, 0)).toBe(ID.bedrock)
    expect(await invCount(page, ID.bedrock)).toBe(0)
  })
})

test.describe('placing', () => {
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
