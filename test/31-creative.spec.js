import { test, expect } from './fixtures.js'
import { ID, useGamemode, waitTicks } from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * The creative item picker.
 *
 * Two halves, and they fail differently. The CATEGORISATION half is pure data
 * -- it can be interrogated without opening anything, and its most important
 * assertion is that the uncategorised report is empty, which is the whole
 * reason the rules have no catch-all. The SCREEN half needs the game open and
 * is checked through the picker's own handle rather than by reading class
 * names off the DOM, so restyling the panel does not break the suite.
 *
 * What is deliberately NOT here: anything about the survival screen. That is
 * test/05-inventory.spec.js's contract and this feature must not have moved
 * it. The last test below is the one that says so.
 */

const creative = (page, fn, arg) => page.evaluate(
  ([body, a]) => new Function('c', 'a', body)(window.game.inventoryScreen.creative, a),
  [fn, arg])

const tabs = (page) => page.evaluate(() => window.game.creative.TABS.map(t => t.id))
const carried = (page) => page.evaluate(() => {
  const c = window.game.inventory.carried
  return c ? [c.id, c.count] : null
})
const openPicker = async (page) => {
  await useGamemode(page, 'creative')
  await page.evaluate(() => window.game.inventoryScreen.setOpen(true))
  await waitTicks(page, 2)
}
const closePicker = (page) => page.evaluate(() => window.game.inventoryScreen.setOpen(false))

test.describe('the categories, which are rules and not a list', () => {
  test('every registered item lands in exactly one tab', async ({ page }) => {
    /*
     * The assertion this file exists for. `uncategorisedItems()` is the
     * `unmappedDrops()` / `unmappedBlocks()` pattern a third time: the rule
     * table has no catch-all, so an item nothing claims is a NAME here rather
     * than a block sitting quietly in a default tab nobody scrolls to.
     */
    const unmapped = await page.evaluate(() => window.game.creative.uncategorised())
    expect(unmapped).toEqual([])
  })

  test('the tabs partition the items -- no gaps and no duplicates', async ({ page }) => {
    const { total, placed, distinct } = await page.evaluate(() => {
      const c = window.game.creative
      const ids = c.CATEGORY_TABS.flatMap(t => c.tabItems(t.id))
      return { total: c.PICKER_ITEMS.length, placed: ids.length, distinct: new Set(ids).size }
    })
    // Exactly one tab each: as many placements as items, and no id twice.
    expect(placed).toBe(total)
    expect(distinct).toBe(total)
  })

  test('every block that has an item is reachable, all 280 stair and slab variants included',
    async ({ page }) => {
      /*
       * The owner's call, and the one place this diverges from vanilla:
       * vanilla lists ONE Oak Stairs and decides the facing when you place
       * it, and here every one of the ten ids in a family gets its own slot.
       *
       * Water, lava and the barrier are the three registered blocks with no
       * entry, and that is items.js's rule rather than the picker's -- none
       * of the three has an ITEM at all.
       */
      const missing = await page.evaluate(() => window.game.creative.blocksWithoutEntry())
      expect(missing.sort()).toEqual(['barrier', 'lava', 'water'])

      // And the eight oak stair states really are eight separate entries.
      const oakStairs = await page.evaluate(() => window.game.creative.PICKER_ITEMS
        .filter(i => i.key.startsWith('oak_stairs')).length)
      expect(oakStairs).toBe(8)
    })

  test('a slab inherits its tab from the cube it was cut from', async ({ page }) => {
    // The structural rule: no slab or stair has a rule of its own, so a new
    // family added to blocks.js is categorised the day it is declared.
    const where = await page.evaluate(() => {
      const c = window.game.creative
      const tab = (key) => c.ruleFor(key)?.tab
      return {
        planks: tab('oak_planks'),
        oakStair: tab('oak_stairs'),
        oakStairVariant: tab('oak_stairs_south_top'),
        oakSlabTop: tab('oak_slab_top'),
        deepslate: tab('deepslate_bricks'),
        deepslateSlab: tab('deepslate_brick_slab'),
      }
    })
    expect(where.oakStair).toBe(where.planks)
    expect(where.oakStairVariant).toBe(where.planks)
    expect(where.oakSlabTop).toBe(where.planks)
    expect(where.deepslateSlab).toBe(where.deepslate)
  })

  test('the colour rules beat the material rules, which is what the tab means',
    async ({ page }) => {
      // `blue_concrete` is colour first and concrete second. If the ordering
      // of the rule table ever inverts, this is what says so.
      const where = await page.evaluate(() => {
        const t = (k) => window.game.creative.ruleFor(k)?.tab
        return {
          wool: t('cyan_wool'), concrete: t('blue_concrete'),
          glass: t('red_stained_glass'), dyedClay: t('lime_terracotta'),
          plainClay: t('terracotta'), plainGlass: t('glass'),
        }
      })
      expect(where.wool).toBe('colored_blocks')
      expect(where.concrete).toBe('colored_blocks')
      expect(where.glass).toBe('colored_blocks')
      expect(where.dyedClay).toBe('colored_blocks')
      // Undyed terracotta has no colour prefix, so it falls past to Natural --
      // which is where vanilla files it, as a badlands block.
      expect(where.plainClay).toBe('natural_blocks')
      // Plain glass went to Functional Blocks in the 1.19.3 reshuffle.
      expect(where.plainGlass).toBe('functional_blocks')
    })

  test('an item that is not a block is never in a block tab', async ({ page }) => {
    // `stone_pickaxe` is not stone and the `nether_brick` item is not the
    // block. Both would be claimed by a material rule if the item rules did
    // not run first.
    const where = await page.evaluate(() => {
      const t = (k) => window.game.creative.ruleFor(k)?.tab
      return {
        pick: t('stone_pickaxe'), sword: t('netherite_sword'),
        boots: t('diamond_boots'), brickItem: t('brick'), brickBlock: t('bricks'),
      }
    })
    expect(where.pick).toBe('tools_and_utilities')
    expect(where.sword).toBe('combat')
    // Vanilla moved all armor into Combat in 1.19.3.
    expect(where.boots).toBe('combat')
    expect(where.brickItem).toBe('ingredients')
    expect(where.brickBlock).toBe('building_blocks')
  })

  test('the tab set and order is vanilla, minus the four this world cannot fill',
    async ({ page }) => {
      expect(await tabs(page)).toEqual([
        'building_blocks', 'colored_blocks', 'natural_blocks', 'functional_blocks',
        'redstone_blocks', 'search',
        'tools_and_utilities', 'combat', 'ingredients', 'inventory',
      ])
      // No tab is empty: an empty tab reads as a broken screen, and
      // creative.js throws at module load rather than drawing one.
      const empty = await page.evaluate(() => window.game.creative.CATEGORY_TABS
        .filter(t => !window.game.creative.tabItems(t.id).length).map(t => t.id))
      expect(empty).toEqual([])
    })
})

test.describe('the list is an infinite source, not a container', () => {
  test.afterEach(async ({ page }) => {
    await closePicker(page)
    await useGamemode(page, 'creative')
  })

  test('shift-clicking an entry gives a full stack', async ({ page }) => {
    await openPicker(page)
    await page.evaluate((id) => {
      const inv = window.game.inventory
      inv.carried = window.game.creative.listClick(inv.carried, id, { shift: true })
      inv.emitChange()
    }, ID.dirt)
    expect(await carried(page)).toEqual([ID.dirt, 64])
  })

  test('a plain left-click gives ONE, and clicking again adds one', async ({ page }) => {
    /*
     * This is the rule everyone gets wrong, including me before I looked it
     * up. minecraft.wiki/w/Creative_inventory: "A single item can be grabbed
     * using left-click, increasing with continued left-clicks on that item."
     * The full stack is on shift, on middle-click and on the number keys.
     * 1.8 really did hand you 64 on a plain click, which is where the
     * folklore comes from.
     */
    await openPicker(page)
    const counts = await page.evaluate((id) => {
      const inv = window.game.inventory
      const out = []
      for (let i = 0; i < 3; i++) {
        inv.carried = window.game.creative.listClick(inv.carried, id, {})
        out.push(inv.carried.count)
      }
      return out
    }, ID.dirt)
    expect(counts).toEqual([1, 2, 3])
  })

  test('right-clicking the same entry puts one back', async ({ page }) => {
    await openPicker(page)
    const counts = await page.evaluate((id) => {
      const c = window.game.creative
      let carried = c.listClick(null, id, {})
      carried = c.listClick(carried, id, {})            // 2
      carried = c.listClick(carried, id, { button: 'right' })  // 1
      const one = carried.count
      carried = c.listClick(carried, id, { button: 'right' })  // gone
      return [one, carried]
    }, ID.dirt)
    expect(counts[0]).toBe(1)
    expect(counts[1]).toBeNull()
  })

  test('clicking a DIFFERENT entry while carrying deletes what you carry', async ({ page }) => {
    // The list doubles as the bin, which is how you delete in creative
    // without hunting for the destroy slot.
    await openPicker(page)
    const after = await page.evaluate(([held, other]) => {
      const c = window.game.creative
      return c.listClick({ id: held, count: 64 }, other, {})
    }, [ID.dirt, ID.cobblestone])
    expect(after).toBeNull()
  })

  test('a full stack of a tool is one tool', async ({ page }) => {
    // "Full stack" is "the maximum stack size", and for a pickaxe that is 1.
    const n = await page.evaluate(() => {
      const id = window.game.itemId('diamond_pickaxe')
      return window.game.creative.listClick(null, id, { shift: true }).count
    })
    expect(n).toBe(1)
  })

  test('the destroy slot empties every container, not just the 36', async ({ page }) => {
    await openPicker(page)
    await creative(page, "c.selectTab('inventory')")
    await page.evaluate(() => {
      const inv = window.game.inventory
      inv.add(2, 64)
      inv.equip(window.game.itemId('iron_helmet'))
      inv.offhand[0] = { id: 2, count: 1 }
      inv.emitChange()
    })
    await page.locator('.creative-destroy').click({ modifiers: ['Shift'] })
    const left = await page.evaluate(() => {
      const inv = window.game.inventory
      return [...inv.slots, ...inv.armor, ...inv.offhand].filter(Boolean).length
    })
    // "Shift + clicking on the button clears the entire inventory, including
    // the hotbar, off-hand slot, and armor slots." -- minecraft.wiki/w/Creative
    expect(left).toBe(0)
  })
})

test.describe('the screen', () => {
  test.afterEach(async ({ page }) => {
    await closePicker(page)
    await useGamemode(page, 'creative')
  })

  test('E opens the picker in creative and the survival screen otherwise',
    async ({ page }) => {
      await useGamemode(page, 'survival')
      await page.evaluate(() => window.game.inventoryScreen.setOpen(true))
      expect(await page.evaluate(() => window.game.inventoryScreen.current())).toBe('inventory')
      await closePicker(page)

      await useGamemode(page, 'creative')
      await page.evaluate(() => window.game.inventoryScreen.setOpen(true))
      expect(await page.evaluate(() => window.game.inventoryScreen.current())).toBe('creative')
    })

  test('adventure -- the default a visitor arrives in -- gets the survival screen',
    async ({ page }) => {
      await useGamemode(page, 'adventure')
      await page.evaluate(() => window.game.inventoryScreen.setOpen(true))
      expect(await page.evaluate(() => window.game.inventoryScreen.current())).toBe('inventory')
    })

  test('a tab with more than five rows scrolls, and one that fits does not',
    async ({ page }) => {
      await openPicker(page)
      await creative(page, "c.selectTab('building_blocks')")
      const big = await creative(page, 'return c.maxScroll()')
      // 324 entries at 9 wide is 36 rows against a 5-row window.
      expect(big).toBeGreaterThan(30)

      await creative(page, 'c.scrollTo(4)')
      expect(await creative(page, 'return c.scrollRow()')).toBe(4)
      // Scrolling past the end clamps rather than showing empty rows.
      await creative(page, 'c.scrollTo(9999)')
      expect(await creative(page, 'return c.scrollRow()')).toBe(big)

      await creative(page, "c.selectTab('redstone_blocks')")
      // Eight entries fit on one row, so there is nowhere to scroll -- which
      // is the state vanilla ships a separate greyed scroller sprite for.
      expect(await creative(page, 'return c.maxScroll()')).toBe(0)
      expect(await page.locator('.creative-thumb.disabled').count()).toBe(1)
    })

  test('switching tabs resets the scroll', async ({ page }) => {
    await openPicker(page)
    await creative(page, "c.selectTab('building_blocks')")
    await creative(page, 'c.scrollTo(10)')
    await creative(page, "c.selectTab('natural_blocks')")
    expect(await creative(page, 'return c.scrollRow()')).toBe(0)
  })

  test('search narrows the list and an empty query shows everything', async ({ page }) => {
    await openPicker(page)
    await creative(page, "c.selectTab('search')")
    const all = await creative(page, 'return c.listing().length')
    expect(all).toBe(await page.evaluate(() => window.game.creative.PICKER_ITEMS.length))

    await page.locator('#creative-search').fill('cherry stairs')
    // Eight stair states, all of them named "Cherry Stairs".
    expect(await creative(page, 'return c.listing().length')).toBe(8)

    await page.locator('#creative-search').fill('zzzz')
    expect(await creative(page, 'return c.listing().length')).toBe(0)
  })

  test('the search listing is grouped by tab, not by registry order', async ({ page }) => {
    /*
     * 1.19.3: "The search tab now lists items sequentially grouped by the
     * other tabs. For example, items found in building blocks always appear
     * before items in redstone blocks."
     */
    await openPicker(page)
    await creative(page, "c.selectTab('search')")
    const ok = await page.evaluate(() => {
      const c = window.game.creative
      const listing = window.game.inventoryScreen.creative.listing()
      const rank = new Map()
      c.CATEGORY_TABS.forEach((t, i) => c.tabItems(t.id).forEach(id => rank.set(id, i)))
      const ranks = listing.map(id => rank.get(id))
      return ranks.every((r, i) => i === 0 || r >= ranks[i - 1])
    })
    expect(ok).toBe(true)
  })

  test('the picker shows the tab you picked, every tab', async ({ page }) => {
    /*
     * Evidence, not an assertion -- see helpers/shots.js. A tabbed picker is
     * a thing you have to LOOK at, and one screenshot per tab is what catches
     * a tab whose contents are right and whose layout is not.
     */
    await openPicker(page)
    for (const id of await tabs(page)) {
      await creative(page, 'c.selectTab(a)', id)
      await waitTicks(page, 1)
      await shot(page, `creative-${id}`)
    }
  })
})
