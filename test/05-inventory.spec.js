import { test, expect } from './fixtures.js'
import { ID, waitTicks } from './helpers/world.js'
import { shotRegion } from './helpers/shots.js'

const slots = (page) => page.evaluate(() => window.game.inventory.slots.map(
  s => (s ? [s.id, s.count] : null)))
const carried = (page) => page.evaluate(() => {
  const c = window.game.inventory.carried
  return c ? [c.id, c.count] : null
})
const add = (page, id, n) => page.evaluate(([i, c]) => window.game.inventory.add(i, c), [id, n])
const click = (page, index, button) =>
  page.evaluate(([i, b]) => window.game.inventory.clickSlot(i, b), [index, button])

test.describe('inventory model', () => {
  test('adding to an existing stack tops it up instead of fragmenting', async ({ page }) => {
    await add(page, ID.dirt, 32)
    await add(page, ID.dirt, 20)
    const s = await slots(page)
    expect(s[0]).toEqual([ID.dirt, 52])
    expect(s[1]).toBeNull()
  })

  test('a stack stops at 64 and the remainder starts a new one', async ({ page }) => {
    await add(page, ID.dirt, 100)
    const s = await slots(page)
    expect(s[0]).toEqual([ID.dirt, 64])
    expect(s[1]).toEqual([ID.dirt, 36])
  })

  test('add() reports what would not fit once all 36 slots are full', async ({ page }) => {
    const left = await page.evaluate(() => {
      const inv = window.game.inventory
      inv.add(2, 36 * 64)      // fills every slot to the brim
      return inv.add(2, 10)
    })
    expect(left).toBe(10)
  })

  test('right-clicking a stack takes half, rounded up', async ({ page }) => {
    await add(page, ID.dirt, 7)
    await click(page, 0, 'right')
    // Minecraft rounds the picked-up half UP, so 7 splits 4/3, not 3/4.
    expect(await carried(page)).toEqual([ID.dirt, 4])
    expect((await slots(page))[0]).toEqual([ID.dirt, 3])
  })

  test('left-clicking the same type merges the carried stack back in', async ({ page }) => {
    await add(page, ID.dirt, 7)
    await click(page, 0, 'right')
    await click(page, 0, 'left')
    expect(await carried(page)).toBeNull()
    expect((await slots(page))[0]).toEqual([ID.dirt, 7])
  })

  test('merging stops at 64 and keeps the overflow on the pointer', async ({ page }) => {
    await page.evaluate(() => {
      const inv = window.game.inventory
      inv.slots[0] = { id: 2, count: 60 }
      inv.carried = { id: 2, count: 20 }
      inv.emitChange()
    })
    await click(page, 0, 'left')
    expect((await slots(page))[0]).toEqual([ID.dirt, 64])
    expect(await carried(page)).toEqual([ID.dirt, 16])
  })

  test('left-clicking a different type swaps rather than refusing', async ({ page }) => {
    // How Minecraft lets you rearrange a full inventory with no free slot.
    await page.evaluate(() => {
      const inv = window.game.inventory
      inv.slots[0] = { id: 2, count: 5 }
      inv.carried = { id: 5, count: 3 }
      inv.emitChange()
    })
    await click(page, 0, 'left')
    expect((await slots(page))[0]).toEqual([ID.planks, 3])
    expect(await carried(page)).toEqual([ID.dirt, 5])
  })

  test('right-clicking with a full hand drops exactly one item', async ({ page }) => {
    await page.evaluate(() => {
      window.game.inventory.carried = { id: 2, count: 5 }
      window.game.inventory.emitChange()
    })
    await click(page, 3, 'right')
    expect((await slots(page))[3]).toEqual([ID.dirt, 1])
    expect(await carried(page)).toEqual([ID.dirt, 4])
  })
})

test.describe('inventory screen', () => {
  test('E opens the inventory and Escape closes it', async ({ page }) => {
    expect(await page.locator('#inventory').isHidden()).toBe(true)
    await page.keyboard.press('KeyE')
    await expect(page.locator('#inventory')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('#inventory')).toBeHidden()
  })

  test('a real right-click on a slot cell splits the stack', async ({ page }) => {
    // The model is covered above; this covers the WIRING -- that cell N in the
    // DOM maps to slot N, which is where a 9/27 off-by-one would show up.
    await add(page, ID.dirt, 8)
    await page.keyboard.press('KeyE')
    await expect(page.locator('#inventory')).toBeVisible()

    // Slots 0-8 are the hotbar row, appended after the 27 grid cells, so the
    // hotbar's first cell is the 28th `.slot` in document order.
    await page.locator('#inv-panel .slot').nth(27).click({ button: 'right' })

    expect(await carried(page)).toEqual([ID.dirt, 4])
    expect((await slots(page))[0]).toEqual([ID.dirt, 4])
  })

  test('the inventory screen renders its slots, counts and character', async ({ page }) => {
    // Visual. Icon geometry is CSS-transformed cubes -- nothing meaningful to
    // assert numerically without restating blockIcon.js.
    await add(page, ID.planks, 64)
    await add(page, ID.cobblestone, 17)
    await add(page, ID.dirt, 3)
    await page.keyboard.press('KeyE')
    await expect(page.locator('#inventory')).toBeVisible()
    await waitTicks(page, 2)
    await shotRegion(page, 'inventory-screen', 'centre')
  })
})
