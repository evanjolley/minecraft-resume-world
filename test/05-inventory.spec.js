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

/* ------------------------------------------------------------------ *
 * Shift-click (quick move)
 *
 * These assert Minecraft's ACTUAL rules, read out of
 * AbstractContainerMenu.moveItemStackTo / doClick and the two quickMoveStack
 * overrides, not the wiki's summary of them -- the wiki is wrong about the
 * crafting table, about which direction the result slot fills, and about what
 * happens to a result that only partly fits. Each of those has a test below.
 *
 * Every one of them clicks for real: Shift held on the keyboard and a real
 * mouse click on a real cell. A synthetic mousedown would pass even if the
 * listener were wired to the wrong cell, or not wired at all, which is
 * exactly the class of bug this suite has been bitten by before.
 * ------------------------------------------------------------------ */

const nulls = (n) => new Array(n).fill(null)

/** Non-block item ids are positional, so ask the page rather than hardcode. */
const itemId = (page, key) => page.evaluate(k => window.game.itemId(k), key)

const armor = (page) => page.evaluate(() => window.game.inventory.armor.map(
  s => (s ? [s.id, s.count] : null)))
const grid = (page) => page.evaluate(() => window.game.inventory.craft.cells.map(
  s => (s ? [s.id, s.count] : null)))
const result = (page) => page.evaluate(() => {
  const r = window.game.inventory.craft.result
  return r ? [r.id, r.count] : null
})

/** Exact inventory state: `[[slot, id, count], ...]`, everything else empty. */
const setSlots = (page, spec) => page.evaluate((rows) => {
  const inv = window.game.inventory
  inv.slots.fill(null)
  for (const [i, id, count] of rows) inv.slots[i] = { id, count }
  inv.emitChange()
}, spec)

/** Exact crafting grid state. Must run AFTER the screen is open: opening one
 *  calls setCraftSize, which empties the grid onto the floor. */
const setGrid = (page, spec) => page.evaluate((rows) => {
  const inv = window.game.inventory
  inv.craft.cells.fill(null)
  for (const [i, id, count] of rows) inv.craft.cells[i] = { id, count }
  inv.refreshResult()
  inv.emitChange()
}, spec)

const openInventory = async (page) => {
  await page.keyboard.press('KeyE')
  await expect(page.locator('#inventory')).toBeVisible()
}

const openTable = async (page) => {
  await page.evaluate(() => window.game.inventory.screen.openCraftingTable())
  await expect(page.locator('#crafting')).toBeVisible()
}

/*
 * The DOM cell for one of the player's 36.
 *
 * `.gui-slot-main` cells are appended grid-first (slots 9-35) and then the
 * hotbar (slots 0-8) -- which is the same order Minecraft's menu adds them
 * in, so this arithmetic and the container mapping inventory.js documents are
 * one fact written twice. That is the point: if either drifts, these fail.
 */
const mainCell = (page, panel, slot) =>
  page.locator(`${panel} .gui-slot-main`).nth(slot < 9 ? 27 + slot : slot - 9)

const areaCell = (page, panel, area, index) =>
  page.locator(`${panel} .gui-slot-${area}`).nth(index)

/** A real shift-click. Shift on the keyboard, so the mousedown the screen
 *  listens to carries a genuine `shiftKey`. */
const shiftClick = async (page, cell, button = 'left') => {
  await page.keyboard.down('Shift')
  try {
    await cell.click({ button })
  } finally {
    await page.keyboard.up('Shift')
  }
}

test.describe('shift-click', () => {
  /*
   * resetWorld empties inv.slots but not the armor, offhand or crafting
   * containers -- it predates all three. A helmet left on the player would
   * follow the suite into 08-death and quietly soften the fall damage there,
   * which reads as a physics bug three files away.
   */
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      const inv = window.game.inventory
      inv.armor.fill(null)
      inv.offhand.fill(null)
      inv.craft.cells.fill(null)
      inv.carried = null
      inv.refreshResult()
      inv.emitChange()
    })
  })

  test('the hotbar goes to the top of the grid and the grid comes back to the hotbar', async ({ page }) => {
    // InventoryMenu sends a hotbar slot to containers 9-36 and a grid slot to
    // 36-45, both forwards. Container 9 IS inventory slot 9 -- the top-left
    // cell -- while container 36 is inventory slot 0. Getting that pair right
    // is the whole slot-mapping problem in one test.
    await setSlots(page, [[0, ID.dirt, 12]])
    await openInventory(page)

    await shiftClick(page, mainCell(page, '#inv-panel', 0))
    let s = await slots(page)
    expect(s[9]).toEqual([ID.dirt, 12])
    expect(s[0]).toBeNull()

    await shiftClick(page, mainCell(page, '#inv-panel', 9))
    s = await slots(page)
    expect(s[0]).toEqual([ID.dirt, 12])
    expect(s[9]).toBeNull()
  })

  test('a partial stack is topped up before any empty slot is used', async ({ page }) => {
    // moveItemStackTo's two passes. Slot 9 is empty and comes FIRST in the
    // range; slot 20 holds a compatible stack and comes later. Vanilla fills
    // slot 20 to 64 and only then puts the remainder in slot 9. A one-pass
    // implementation would put all 40 in slot 9 and look fine until you
    // noticed your dirt had stopped stacking.
    await setSlots(page, [[0, ID.dirt, 40], [20, ID.dirt, 30]])
    await openInventory(page)

    await shiftClick(page, mainCell(page, '#inv-panel', 0))

    const s = await slots(page)
    expect(s[20]).toEqual([ID.dirt, 64])
    expect(s[9]).toEqual([ID.dirt, 6])
    expect(s[0]).toBeNull()
  })

  test('a full target range leaves the source stack exactly where it was', async ({ page }) => {
    // moveItemStackTo returns false, quickMoveStack returns ItemStack.EMPTY,
    // and nothing at all happens -- no partial move, no drop on the floor.
    await page.evaluate((cobble) => {
      const inv = window.game.inventory
      inv.slots.fill(null)
      for (let i = 9; i < 36; i++) inv.slots[i] = { id: cobble, count: 64 }
      inv.slots[0] = { id: 2, count: 10 }
      inv.emitChange()
    }, ID.cobblestone)
    await openInventory(page)

    await shiftClick(page, mainCell(page, '#inv-panel', 0))

    expect((await slots(page))[0]).toEqual([ID.dirt, 10])
  })

  test('shift-clicking never touches the stack on the pointer', async ({ page }) => {
    // doClick branches on the click TYPE before it looks at anything else, so
    // the QUICK_MOVE path never reads or writes the carried stack. Left-click
    // in the same place would have swapped the two.
    await page.evaluate((cobble) => {
      const inv = window.game.inventory
      inv.slots.fill(null)
      inv.slots[0] = { id: 2, count: 10 }
      inv.carried = { id: cobble, count: 5 }
      inv.emitChange()
    }, ID.cobblestone)
    await openInventory(page)

    await shiftClick(page, mainCell(page, '#inv-panel', 0))

    expect((await slots(page))[9]).toEqual([ID.dirt, 10])
    expect(await carried(page)).toEqual([ID.cobblestone, 5])
  })

  test('the right button quick-moves exactly like the left one', async ({ page }) => {
    // Vanilla's guard is `button == 0 || button == 1`. There is no separate
    // shift-right-click behaviour in a crafting or inventory screen.
    await setSlots(page, [[0, ID.dirt, 12]])
    await openInventory(page)

    await shiftClick(page, mainCell(page, '#inv-panel', 0), 'right')

    expect((await slots(page))[9]).toEqual([ID.dirt, 12])
  })

  test('the crafting grid empties into the inventory', async ({ page }) => {
    await openInventory(page)
    await setSlots(page, [])
    await setGrid(page, [[0, ID.dirt, 5]])

    await shiftClick(page, areaCell(page, '#inv-panel', 'craft', 0))

    expect((await slots(page))[9]).toEqual([ID.dirt, 5])
    expect(await grid(page)).toEqual(nulls(4))
  })

  test('a crafted result fills the hotbar from the RIGHT-hand end', async ({ page }) => {
    /*
     * The result slot is the only one that passes reverseDirection = true --
     * moveItemStackTo(stack, 9, 45, true) -- so it walks container 44 down to
     * 9, and container 44 is inventory slot 8: the LAST hotbar slot.
     *
     * The wiki attributes the backwards walk to "an external inventory is
     * open". It is not about the screen at all, it is about the slot, and it
     * happens in the player's own inventory too, which is what this proves.
     */
    const log = await itemId(page, 'oak_log')
    await setSlots(page, [])
    await openInventory(page)
    await setGrid(page, [[0, log, 1]])
    expect(await result(page)).toEqual([ID.planks, 4])

    await shiftClick(page, areaCell(page, '#inv-panel', 'result', 0))

    const s = await slots(page)
    expect(s[8]).toEqual([ID.planks, 4])
    expect(s[9]).toBeNull()
    expect(s[0]).toBeNull()
  })

  test('shift-clicking the result crafts repeatedly until the grid runs out', async ({ page }) => {
    // The loop lives in doClick, not in the crafting code: quickMoveStack is
    // called again for as long as the slot refills with the same item. Five
    // logs is five crafts of four planks without a single extra click.
    const log = await itemId(page, 'oak_log')
    await setSlots(page, [])
    await openInventory(page)
    await setGrid(page, [[0, log, 5]])

    await shiftClick(page, areaCell(page, '#inv-panel', 'result', 0))

    expect((await slots(page))[8]).toEqual([ID.planks, 20])
    expect(await grid(page)).toEqual(nulls(4))
    expect(await result(page)).toBeNull()
  })

  test('repeated crafting stops on the craft the inventory cannot hold', async ({ page }) => {
    /*
     * The stopping point, which is the part a hand-written "craft while there
     * is room" loop gets wrong.
     *
     * Every slot is full except slot 8, which has room for exactly 2 planks.
     * Vanilla performs ONE craft: it merges 2, and the other 2 -- which fit
     * nowhere -- are thrown on the floor by `player.drop(itemstack1, false)`.
     * Then the loop goes round once more, finds nowhere at all for the next
     * four, and stops without spending a second log.
     *
     * So: one log gone, two left, and the ingredients for the planks that
     * landed on the floor are gone with it. The wiki's "moves it straight to
     * the inventory" has no room for any of that.
     */
    const log = await itemId(page, 'oak_log')
    await openInventory(page)
    await page.evaluate(([cobble, planks]) => {
      const inv = window.game.inventory
      for (let i = 0; i < 36; i++) inv.slots[i] = { id: cobble, count: 64 }
      inv.slots[8] = { id: planks, count: 62 }
      inv.emitChange()
    }, [ID.cobblestone, ID.planks])
    await setGrid(page, [[0, log, 3]])

    await shiftClick(page, areaCell(page, '#inv-panel', 'result', 0))

    expect((await slots(page))[8]).toEqual([ID.planks, 64])
    expect(await grid(page)).toEqual([[log, 2], null, null, null])
  })

  test('an armor piece lands in its own slot, not the first free one', async ({ page }) => {
    // moveItemStackTo(stack, i, i + 1, false) -- a range of exactly one slot,
    // chosen by the item. Slot 9 is free and stays free.
    const helmet = await itemId(page, 'diamond_helmet')
    await setSlots(page, [[3, helmet, 1]])
    await openInventory(page)

    await shiftClick(page, mainCell(page, '#inv-panel', 3))

    expect(await armor(page)).toEqual([[helmet, 1], null, null, null])
    expect((await slots(page))[9]).toBeNull()
    expect((await slots(page))[3]).toBeNull()
  })

  test('boots go to the boots slot, which is the far end of the armor column', async ({ page }) => {
    // Vanilla picks the slot with `8 - equipmentslot.getIndex()`, and the
    // EquipmentSlot indices run FEET 0 .. HEAD 3 -- so it counts backwards.
    // Translating that to this file's helmet-first ARMOR_SLOTS is precisely
    // where boots end up on your head.
    const boots = await itemId(page, 'diamond_boots')
    await setSlots(page, [[0, boots, 1]])
    await openInventory(page)

    await shiftClick(page, mainCell(page, '#inv-panel', 0))

    expect(await armor(page)).toEqual([null, null, null, [boots, 1]])
  })

  test('a second helmet falls through to the ordinary move rather than swapping', async ({ page }) => {
    // The armor branch is guarded on `!slots.get(8 - index).hasItem()`, so an
    // occupied slot drops the click through to the plain hotbar->grid move.
    const helmet = await itemId(page, 'diamond_helmet')
    await page.evaluate((id) => {
      const inv = window.game.inventory
      inv.slots.fill(null)
      inv.slots[0] = { id, count: 1 }
      inv.armor[0] = { id, count: 1 }
      inv.emitChange()
    }, helmet)
    await openInventory(page)

    await shiftClick(page, mainCell(page, '#inv-panel', 0))

    expect(await armor(page)).toEqual([[helmet, 1], null, null, null])
    expect((await slots(page))[9]).toEqual([helmet, 1])
  })

  test('an armor slot empties into the inventory', async ({ page }) => {
    const helmet = await itemId(page, 'diamond_helmet')
    await page.evaluate((id) => {
      const inv = window.game.inventory
      inv.slots.fill(null)
      inv.armor[0] = { id, count: 1 }
      inv.emitChange()
    }, helmet)
    await openInventory(page)

    await shiftClick(page, areaCell(page, '#inv-panel', 'armor', 0))

    expect(await armor(page)).toEqual(nulls(4))
    expect((await slots(page))[9]).toEqual([helmet, 1])
  })

  test('at a crafting table an inventory stack loads the GRID, not the hotbar', async ({ page }) => {
    /*
     * THE WIKI IS WRONG ABOUT THIS ONE. It says shift-clicking "immediately
     * moves it between the inventory and the hotbar". CraftingMenu tries
     * moveItemStackTo(stack, 1, 10, false) FIRST, and the hotbar<->grid swap
     * is only the fallback for when all nine cells are occupied.
     *
     * Identical in the 1.20.1 and 1.21.1 sources, so it is not a version
     * quirk that the wiki is merely behind on.
     */
    await openTable(page)
    await setSlots(page, [[0, ID.cobblestone, 10]])

    await shiftClick(page, mainCell(page, '#craft-panel', 0))

    expect(await grid(page)).toEqual([[ID.cobblestone, 10], ...nulls(8)])
    expect((await slots(page))[0]).toBeNull()
  })

  test('at a crafting table a full grid falls back to the hotbar swap', async ({ page }) => {
    // Nine cells of dirt: nothing to merge cobblestone into and nowhere to
    // put it, so moveItemStackTo(1, 10) returns false and the hotbar slot
    // takes the second branch, containers 10-37, i.e. inventory slot 9.
    await openTable(page)
    await setSlots(page, [[0, ID.cobblestone, 10]])
    await setGrid(page, Array.from({ length: 9 }, (_, i) => [i, ID.dirt, 1]))

    await shiftClick(page, mainCell(page, '#craft-panel', 0))

    expect((await slots(page))[9]).toEqual([ID.cobblestone, 10])
    expect(await grid(page)).toEqual(Array.from({ length: 9 }, () => [ID.dirt, 1]))
  })

  test('the crafting table result crafts repeatedly into the far hotbar slot too', async ({ page }) => {
    // Same rule, different ranges: CraftingMenu reverses over containers
    // 10-46, whose last entry is inventory slot 8. Proving it separately is
    // the point -- the two menus have different numbers for the same slot.
    const log = await itemId(page, 'oak_log')
    await setSlots(page, [])
    await openTable(page)
    await setGrid(page, [[4, log, 3]])

    await shiftClick(page, areaCell(page, '#craft-panel', 'result', 0))

    expect((await slots(page))[8]).toEqual([ID.planks, 12])
    expect(await grid(page)).toEqual(nulls(9))
  })

  test('shift-clicking an empty slot does nothing at all', async ({ page }) => {
    await setSlots(page, [[0, ID.dirt, 5]])
    await openInventory(page)

    await shiftClick(page, mainCell(page, '#inv-panel', 20))

    expect((await slots(page))[0]).toEqual([ID.dirt, 5])
    expect((await slots(page))[20]).toBeNull()
  })
})
