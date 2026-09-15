import { test, expect } from './fixtures.js'
import { waitTicks } from './helpers/world.js'
import { shotRegion } from './helpers/shots.js'

/*
 * Furnaces.
 *
 * Reported from play as item 14 of docs/REPORTED.md -- "Furnaces do nothing".
 *
 * Every number asserted here is vanilla's, and the two sources are named
 * where the numbers live (recipes.js for the fuel and smelting tables,
 * furnace.js for the tick loop): minecraft.wiki/w/Furnace for the 200-tick
 * smelt and minecraft.wiki/w/Smelting for the fuel durations, cross-checked
 * against TileEntityFurnace.getItemBurnTime in the MCP-919 decompile.
 *
 * WHAT THESE ASSERT is times and quantities, not that a screen opened. The
 * point of a furnace is that one coal smelts eight items in eighty seconds,
 * and a spec that only checks for three divs would pass against a furnace
 * with the burn timer deleted.
 *
 * FURNACES ARE WORLD STATE and resetWorld does not know about them, so each
 * spec clears the registry itself rather than inheriting whatever the last
 * one left burning.
 */

const setup = (page) => page.evaluate(() => {
  const inv = window.game.inventory
  inv.screen.setOpen(false)
  inv.furnaces.clear()
  inv.slots.fill(null)
  inv.carried = null
  inv.emitChange()
})

/** Open a furnace at a position nothing else in the suite uses. */
const POS = [0, 200, 0]
const open = (page, kind = 'furnace') => page.evaluate(([pos, k]) =>
  window.game.inventoryScreen.openFurnace(pos, k), [POS, kind])

/** The open furnace's three slots, as [id, count] or null. */
const furnaceSlots = (page) => page.evaluate(() => {
  const f = window.game.inventory.openFurnace
  return f.slots.map(s => (s ? [s.id, s.count] : null))
})

const clocks = (page) => page.evaluate(() => {
  const f = window.game.inventory.openFurnace
  return { burn: f.burn, burnTotal: f.burnTotal, cook: f.cook, cookTotal: f.cookTotal }
})

const step = (page, n) => page.evaluate(n => window.game.inventory.furnaces.step(n), n)

const id = (page, key) => page.evaluate(k => window.game.inventory.furnaces
  && window.itemIdForTest(k), key)

test.beforeEach(async ({ page }) => {
  // itemId is not on window.game; a two-line shim beats exporting the whole
  // item table into the page for the sake of five lookups.
  await page.evaluate(async () => {
    const items = await import('/src/items.js')
    window.itemIdForTest = items.itemId
  })
  await setup(page)
})

test.describe('the tables', () => {
  test('smelting covers the ores, the sands, the stones and the logs', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const { itemId, itemName } = await import('/src/items.js')
      const { smeltingResult } = window.game.inventory.furnaces
      const name = k => itemName(smeltingResult(itemId(k)))
      return {
        raw_iron: name('raw_iron'),
        iron_ore: name('iron_ore'),
        deepslate_gold_ore: name('deepslate_gold_ore'),
        raw_copper: name('raw_copper'),
        sand: name('sand'),
        red_sand: name('red_sand'),
        cobblestone: name('cobblestone'),
        stone: name('stone'),
        clay: name('clay'),
        clay_ball: name('clay_ball'),
        spruce_log: name('spruce_log'),
        wet_sponge: name('wet_sponge'),
        ancient_debris: name('ancient_debris'),
        dirt: smeltingResult(itemId('dirt')),
      }
    })
    expect(out).toEqual({
      raw_iron: 'Iron Ingot',
      iron_ore: 'Iron Ingot',
      deepslate_gold_ore: 'Gold Ingot',
      raw_copper: 'Copper Ingot',
      sand: 'Glass',
      red_sand: 'Glass',
      cobblestone: 'Stone',
      stone: 'Smooth Stone',
      clay: 'Terracotta',
      clay_ball: 'Brick',
      // Every log smelts to charcoal, through the same #logs tag the plank
      // recipes use -- so a wood added to recipes.js gets this for free.
      spruce_log: 'Charcoal',
      wet_sponge: 'Sponge',
      ancient_debris: 'Netherite Scrap',
      // Dirt is not smeltable, and 0 rather than undefined is the contract.
      dirt: 0,
    })
  })

  test('fuel burn times are vanilla, in ticks', async ({ page }) => {
    const out = await page.evaluate(async () => {
      const { itemId } = await import('/src/items.js')
      const { burnTicks } = window.game.inventory.furnaces
      const t = k => burnTicks(itemId(k))
      return {
        coal_block: t('coal_block'), dried_kelp_block: t('dried_kelp_block'),
        coal: t('coal'), charcoal: t('charcoal'),
        oak_log: t('oak_log'), planks: t('planks'), birch_stairs: t('birch_stairs'),
        oak_slab: t('oak_slab'), wooden_pickaxe: t('wooden_pickaxe'),
        stick: t('stick'), bowl: t('bowl'), white_wool: t('white_wool'),
        bamboo: t('bamboo'), crafting_table: t('crafting_table'),
        dirt: t('dirt'), iron_ingot: t('iron_ingot'),
      }
    })
    expect(out).toEqual({
      coal_block: 16000,        // 800 s, 80 items
      dried_kelp_block: 4000,   // 200 s, 20 items
      coal: 1600,               //  80 s,  8 items
      charcoal: 1600,
      oak_log: 300,             //  15 s, 1.5 items
      planks: 300,
      birch_stairs: 300,
      oak_slab: 150,            // the one wooden thing that is half
      wooden_pickaxe: 200,
      stick: 100,
      bowl: 100,
      white_wool: 100,
      bamboo: 50,
      crafting_table: 300,
      // Not fuel. 0, not undefined.
      dirt: 0,
      iron_ingot: 0,
    })
  })
})

test.describe('smelting', () => {
  /*
   * ONE evaluate, not four.
   *
   * The live tick loop is advancing these furnaces the whole time -- that is
   * the feature -- so a spec that steps 199 ticks across four round trips to
   * the browser has actually stepped 199 plus however many 33 ms frames fitted
   * between them, and "199 is not enough" fails for a reason that is not the
   * furnace. Inside one evaluate nothing can interleave: it is one JS turn.
   */
  test('one item takes exactly 200 ticks, and 199 is not enough', async ({ page }) => {
    await open(page)
    const out = await page.evaluate(async () => {
      const { itemId } = await import('/src/items.js')
      const { furnaces, openFurnace: f } = window.game.inventory
      f.slots[0] = { id: itemId('raw_iron'), count: 4 }
      f.slots[1] = { id: itemId('coal'), count: 1 }
      const snap = () => f.slots.map(x => (x ? [x.id, x.count] : null))
      furnaces.step(199)
      const at199 = snap()
      furnaces.step(1)
      return { at199, at200: snap(), ingot: itemId('iron_ingot') }
    })
    expect(out.at199[2]).toBeNull()
    expect(out.at200[2]).toEqual([out.ingot, 1])
    // One raw iron gone, three left.
    expect(out.at200[0][1]).toBe(3)
  })

  test('a blast furnace does the same item in 100 ticks', async ({ page }) => {
    await open(page, 'blast_furnace')
    expect((await clocks(page)).cookTotal).toBe(100)
    await page.evaluate(async () => {
      const { itemId } = await import('/src/items.js')
      const f = window.game.inventory.openFurnace
      f.slots[0] = { id: itemId('raw_gold'), count: 2 }
      f.slots[1] = { id: itemId('coal'), count: 1 }
    })
    const out = await page.evaluate(() => {
      const { furnaces, openFurnace: f } = window.game.inventory
      furnaces.step(99)
      const at99 = f.slots[2]
      furnaces.step(1)
      return { at99, at100: f.slots[2] && f.slots[2].count }
    })
    expect(out.at99).toBeNull()
    expect(out.at100).toBe(1)
  })

  test('one coal smelts exactly eight items and no more', async ({ page }) => {
    await open(page)
    await page.evaluate(async () => {
      const { itemId } = await import('/src/items.js')
      const f = window.game.inventory.openFurnace
      f.slots[0] = { id: itemId('sand'), count: 64 }
      f.slots[1] = { id: itemId('coal'), count: 1 }
    })
    // 1600 ticks of flame at 200 a smelt. Run well past it.
    await step(page, 3000)
    const s = await furnaceSlots(page)
    expect(s[2]).toEqual([await id(page, 'glass'), 8])
    expect(s[0][1]).toBe(64 - 8)
    // The fuel was consumed the instant it was lit, not gradually.
    expect(s[1]).toBeNull()
    expect((await clocks(page)).burn).toBe(0)
  })

  test('a furnace with fuel and nothing to smelt does not light', async ({ page }) => {
    await open(page)
    await page.evaluate(async () => {
      const { itemId } = await import('/src/items.js')
      window.game.inventory.openFurnace.slots[1] = { id: itemId('coal'), count: 64 }
    })
    await step(page, 500)
    // The bug this catches is a furnace that quietly eats a stack of coal
    // overnight: vanilla's guard is `!isBurning() && canSmelt()`.
    expect((await furnaceSlots(page))[1][1]).toBe(64)
    expect((await clocks(page)).burn).toBe(0)
  })

  test('a full output slot stops the furnace without spending fuel', async ({ page }) => {
    await open(page)
    await page.evaluate(async () => {
      const { itemId } = await import('/src/items.js')
      const f = window.game.inventory.openFurnace
      f.slots[0] = { id: itemId('raw_iron'), count: 10 }
      f.slots[1] = { id: itemId('coal'), count: 3 }
      f.slots[2] = { id: itemId('iron_ingot'), count: 64 }
    })
    await step(page, 400)
    const s = await furnaceSlots(page)
    expect(s[2][1]).toBe(64)
    expect(s[0][1]).toBe(10)
    expect(s[1][1]).toBe(3)
  })

  test('pulling the input out mid-smelt loses the progress; losing the flame only decays it',
    async ({ page }) => {
      await open(page)
      await page.evaluate(async () => {
        const { itemId } = await import('/src/items.js')
        const f = window.game.inventory.openFurnace
        f.slots[0] = { id: itemId('cobblestone'), count: 8 }
        f.slots[1] = { id: itemId('stick'), count: 1 }   // 100 ticks of flame
      })
      const out = await page.evaluate(() => {
        const { furnaces, openFurnace: f } = window.game.inventory
        furnaces.step(50)
        const half = f.cook
        // The flame runs out at 100, and from there cook decays by 2 a tick.
        furnaces.step(60)        // 10 ticks unlit past the 100
        return { half, burn: f.burn, cook: f.cook }
      })
      expect(out.half).toBe(50)
      expect(out.burn).toBe(0)
      expect(out.cook).toBe(100 - 2 * 10)

      // Now the other rule: input removed WHILE BURNING resets to zero.
      await page.evaluate(async () => {
        const { itemId } = await import('/src/items.js')
        const f = window.game.inventory.openFurnace
        f.slots[1] = { id: itemId('coal'), count: 1 }
      })
      await step(page, 30)
      expect((await clocks(page)).cook).toBeGreaterThan(0)
      await page.evaluate(() => { window.game.inventory.openFurnace.slots[0] = null })
      await step(page, 1)
      expect((await clocks(page)).cook).toBe(0)
    })
})

test.describe('the screen', () => {
  test('right-clicking is not needed: a furnace opens bound to its position',
    async ({ page }) => {
      await open(page)
      expect(await page.evaluate(() => window.game.inventoryScreen.current())).toBe('furnace')
      expect(await page.evaluate(() => document.getElementById('furnace').className)).toBe('')
      // A second furnace three blocks away is a different machine.
      await page.evaluate(async () => {
        const { itemId } = await import('/src/items.js')
        window.game.inventory.openFurnace.slots[0] = { id: itemId('sand'), count: 5 }
        window.game.inventoryScreen.openFurnace([3, 200, 0])
      })
      expect((await furnaceSlots(page))[0]).toBeNull()
      expect(await page.evaluate(() => window.game.inventory.furnaces.count())).toBe(2)
    })

  test('the flame and the arrow read the two clocks, at vanilla scale',
    async ({ page }) => {
      await open(page)
      await page.evaluate(async () => {
        const { itemId } = await import('/src/items.js')
        const f = window.game.inventory.openFurnace
        f.slots[0] = { id: itemId('raw_iron'), count: 32 }
        f.slots[1] = { id: itemId('coal'), count: 1 }
      })
      // 900 ticks: four ingots done, 100 ticks into the fifth, 700 of 1600
      // ticks of flame left. Half an arrow and a flame most of the way down.
      await step(page, 900)
      await waitTicks(page, 2)   // the gauges repaint on the tick

      /*
       * Clocks and gauges read in ONE turn, so the live tick loop cannot move
       * the furnace between them. The assertion is then that the DOM really
       * is vanilla's two scalings of those clocks -- getLitProgress is
       * 13 * burn / burnTotal and getBurnProgress is 24 * cook / cookTotal,
       * which are STEPS out of 13 and out of 24, not raw fractions. A gauge
       * wired straight to burn/burnTotal passes a "looks about half" test and
       * fails this one.
       */
      const seen = await page.evaluate(() => {
        const f = window.game.inventory.openFurnace
        return {
          burn: f.burn, burnTotal: f.burnTotal, cook: f.cook, cookTotal: f.cookTotal,
          out: f.slots[2].count,
          flame: document.querySelector('.furnace-flame .gauge-fill').style.height,
          arrow: document.querySelector('.furnace-arrow .gauge-fill').style.width,
        }
      })
      const litSteps = Math.round((seen.burn * 13) / seen.burnTotal)
      const burnSteps = Math.round((seen.cook * 24) / seen.cookTotal)
      expect(litSteps).toBe(6)
      expect(burnSteps).toBe(12)
      expect(Number.parseFloat(seen.flame)).toBeCloseTo((litSteps / 13) * 100, 3)
      expect(Number.parseFloat(seen.arrow)).toBeCloseTo((burnSteps / 24) * 100, 3)
      expect(seen.out).toBe(4)
      await shotRegion(page, 'furnace-mid-smelt', 'centre')
    })

  test('it keeps burning with the screen shut', async ({ page }) => {
    await open(page)
    await page.evaluate(async () => {
      const { itemId } = await import('/src/items.js')
      const f = window.game.inventory.openFurnace
      f.slots[0] = { id: itemId('cobblestone'), count: 8 }
      f.slots[1] = { id: itemId('coal'), count: 1 }
    })
    const before = await page.evaluate(() => {
      window.game.inventoryScreen.setOpen(false)
      // Held directly, because inv.openFurnace is dropped on close -- which is
      // the point: the furnace is in the registry, not in the screen.
      window.__f = window.game.inventory.furnaces.at([0, 200, 0])
      return { cook: window.__f.cook, burn: window.__f.burn }
    })
    expect(await page.evaluate(() => window.game.inventory.openFurnace)).toBeNull()

    // 1.5 seconds of real time is 30 Minecraft ticks. noa runs at 30 Hz, so
    // this also proves the ms -> tick conversion is not counting engine ticks.
    await page.waitForTimeout(1500)
    const after = await page.evaluate(() => ({
      cook: window.__f.cook, burn: window.__f.burn, total: window.__f.burnTotal,
    }))
    expect(after.cook).toBeGreaterThan(before.cook + 15)
    expect(after.cook).toBeLessThan(before.cook + 50)
    // It LIT with the screen shut, and is already spending the coal: burn is
    // somewhere strictly inside (0, 1600).
    expect(after.burn).toBeGreaterThan(0)
    expect(after.total).toBe(1600)
    expect(after.burn).toBeLessThan(after.total)
  })
})

test.describe('shift-clicking, which is the part people notice', () => {
  /** Put a stack in hotbar slot 0 and shift-click it. */
  const shiftFrom = (page, key, count, index = 0) => page.evaluate(async ([k, c, i]) => {
    const { itemId } = await import('/src/items.js')
    const inv = window.game.inventory
    inv.slots[i] = { id: itemId(k), count: c }
    inv.clickSlot(i, 'left', 'main', true)
  }, [key, count, index])

  test('a smeltable goes to the input slot and fuel goes to the fuel slot',
    async ({ page }) => {
      await open(page)
      await shiftFrom(page, 'raw_iron', 20)
      await shiftFrom(page, 'coal', 5, 1)
      const s = await furnaceSlots(page)
      expect(s[0]).toEqual([await id(page, 'raw_iron'), 20])
      expect(s[1]).toEqual([await id(page, 'coal'), 5])
      expect(await page.evaluate(() => window.game.inventory.slots.slice(0, 2))).toEqual([null, null])
      // And having done nothing but shift-click twice, it runs.
      await step(page, 200)
      expect((await furnaceSlots(page))[2][1]).toBe(1)
    })

  test('a log is both, and vanilla sends it to the INPUT slot', async ({ page }) => {
    // The order of the two tests in the chain is observable exactly here: a
    // log is smeltable (charcoal) AND fuel (300 ticks). Swap the branches and
    // charcoal becomes unobtainable.
    await open(page)
    await shiftFrom(page, 'oak_log', 12)
    const s = await furnaceSlots(page)
    expect(s[0]).toEqual([await id(page, 'oak_log'), 12])
    expect(s[1]).toBeNull()
  })

  test('something that is neither falls through to the hotbar swap', async ({ page }) => {
    await open(page)
    // Slot 9 is the first of the main grid, which shift-clicks to the hotbar.
    await shiftFrom(page, 'dirt', 7, 9)
    const s = await furnaceSlots(page)
    expect(s[0]).toBeNull()
    expect(s[1]).toBeNull()
    const inv = await page.evaluate(() => window.game.inventory.slots.map(
      x => (x ? [x.id, x.count] : null)))
    expect(inv[0]).toEqual([await id(page, 'dirt'), 7])
    expect(inv[9]).toBeNull()
  })

  test('shift-clicking the output empties it into the player', async ({ page }) => {
    await open(page)
    await page.evaluate(async () => {
      const { itemId } = await import('/src/items.js')
      const f = window.game.inventory.openFurnace
      f.slots[0] = { id: itemId('sand'), count: 5 }
      f.slots[1] = { id: itemId('coal'), count: 1 }
    })
    await step(page, 1000)
    expect((await furnaceSlots(page))[2][1]).toBe(5)
    await page.evaluate(() => window.game.inventory.clickSlot(2, 'left', 'furnace', true))
    expect((await furnaceSlots(page))[2]).toBeNull()
    // Reversed, like both crafting results: the RIGHTMOST free hotbar slot.
    const inv = await page.evaluate(() => window.game.inventory.slots.map(
      x => (x ? [x.id, x.count] : null)))
    expect(inv[8]).toEqual([await id(page, 'glass'), 5])
  })

  test('the fuel slot refuses a non-fuel and the output refuses everything',
    async ({ page }) => {
      await open(page)
      await page.evaluate(async () => {
        const { itemId } = await import('/src/items.js')
        const inv = window.game.inventory
        inv.carried = { id: itemId('dirt'), count: 4 }
        inv.clickSlot(1, 'left', 'furnace')     // fuel slot
        inv.clickSlot(2, 'left', 'furnace')     // output slot
      })
      const s = await furnaceSlots(page)
      expect(s[1]).toBeNull()
      expect(s[2]).toBeNull()
      expect(await page.evaluate(() => window.game.inventory.carried.count)).toBe(4)
      // Coal, on the other hand, goes in.
      await page.evaluate(async () => {
        const { itemId } = await import('/src/items.js')
        const inv = window.game.inventory
        inv.carried = { id: itemId('charcoal'), count: 2 }
        inv.clickSlot(1, 'left', 'furnace')
      })
      expect((await furnaceSlots(page))[1]).toEqual([await id(page, 'charcoal'), 2])
    })
})
