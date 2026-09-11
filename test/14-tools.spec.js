import { test, expect } from './fixtures.js'
import {
  ID, SURFACE_Y, HEADING, aim, holdMouse, targetedBlock, getBlock, setBlock,
  waitTicks, useGamemode,
} from './helpers/world.js'

/*
 * Tool mining speed, and the drop rules that depend on it.
 *
 * HOW THE TIMES ARE MEASURED, because it is the interesting part of this file.
 * Waiting for stone to break bare-handed is seven and a half seconds, and
 * doing that once per tool is a minute of suite time to learn six numbers.
 *
 * So these tests do not time anything with a stopwatch. interact.js publishes
 * `{ frac, dt }` every frame while you mine, where frac is elapsed/total
 * against ITS OWN clock -- so holding the button for a fraction of a second
 * and dividing the accumulated dt by the frac it produced recovers `total`
 * exactly, with no dependence on wall-clock latency, CDP round trips or how
 * slow swiftshader was feeling. A 300 ms chew measures a 7.5 second block.
 *
 * THE NUMBERS ARE MINECRAFT'S, checked against the wiki's stone row:
 * hand 7.5, wooden 1.15, stone 0.6, iron 0.4, diamond 0.3, netherite 0.25,
 * golden 0.2. They come out of
 *
 *     ticks = ceil(hardness * (canHarvest ? 30 : 100) / toolSpeed)
 *
 * and the 1.15 is the reason the ceiling matters: 1.5 * 30 / 2 is 22.5 ticks,
 * and Minecraft charges you the whole 23rd.
 */

/** Eye level, two and a half blocks east. Same rig as 13-drops. */
const TARGET = [3, SURFACE_Y + 1, 0]

/** Minecraft's break times for stone, in seconds, by tool. */
const STONE = {
  hand: 7.5,
  wooden_pickaxe: 1.15,
  stone_pickaxe: 0.6,
  iron_pickaxe: 0.4,
  diamond_pickaxe: 0.3,
  netherite_pickaxe: 0.25,
  golden_pickaxe: 0.2,
}

const invCount = (page, id) => page.evaluate((want) => window.game.inventory.slots
  .filter(s => s && s.id === want)
  .reduce((n, s) => n + s.count, 0), id)

const floorIds = (page) =>
  page.evaluate(() => window.game.drops.list.map(d => d.id))

/** Item ids for tools are positional above ITEM_BASE, so ask rather than guess. */
const idOf = (page, key) => page.evaluate((k) => window.game.itemId(k), key)

/** Put a tool in the selected hotbar slot, or empty it for a bare hand. */
async function hold(page, key) {
  await page.evaluate(() => {
    window.game.inventory.slots[0] = null
    window.game.inventory.select(0)
  })
  if (!key) return
  const id = await idOf(page, key)
  await page.evaluate((i) => {
    window.game.inventory.slots[0] = { id: i, count: 1 }
    window.game.inventory.emitChange()
  }, id)
}

async function aimAtTarget(page, terrain, id) {
  await terrain.keep(TARGET, TARGET)
  await setBlock(page, id, ...TARGET)
  await aim(page, { heading: HEADING.eastPlusX, pitch: 0 })
  expect(await targetedBlock(page)).toMatchObject({ position: TARGET })
}

/**
 * The break time interact.js is actually counting down, in seconds, recovered
 * from a partial chew. See the header.
 */
async function breakSeconds(page, holdMs = 300) {
  await page.evaluate(() => {
    window.__prog = []
    window.__progOff = window.game.interaction.onBreakProgress(
      (e) => { if (e.position) window.__prog.push([e.frac, e.dt]) })
  })
  await holdMouse(page, holdMs)
  return page.evaluate(() => {
    window.__progOff()
    /*
     * The LAST sample before the block popped, not simply the last sample:
     * frac is clamped to 1 on the breaking frame, and a stalled tick under
     * software GL can push a 150 ms chew past a 0.2 s golden pickaxe. Walking
     * the cumulative dt makes the measurement independent of where it stopped.
     */
    let elapsed = 0
    let best = 0
    for (const [frac, dt] of window.__prog) {
      elapsed += dt
      if (frac > 0 && frac < 1) best = elapsed / frac
    }
    return best
  })
}

test.describe('tool mining speed', () => {
  test.beforeEach(async ({ page }) => { await useGamemode(page, 'survival') })

  test('a bare hand takes Minecraft\'s seven and a half seconds on stone',
    async ({ page, terrain }) => {
      await hold(page, null)
      await aimAtTarget(page, terrain, ID.stone)
      expect(await breakSeconds(page)).toBeCloseTo(STONE.hand, 2)
    })

  test('an iron pickaxe is Minecraft\'s 18.75 times faster than a fist',
    async ({ page, terrain }) => {
      await hold(page, null)
      await aimAtTarget(page, terrain, ID.stone)
      const hand = await breakSeconds(page)

      await hold(page, 'iron_pickaxe')
      await waitTicks(page, 2)
      const iron = await breakSeconds(page, 200)

      expect(iron).toBeCloseTo(STONE.iron_pickaxe, 2)
      /*
       * The ratio is the assertion that would survive someone rescaling the
       * whole hardness table: 100/30 for being able to harvest it at all,
       * times 6 for iron's tier speed, is 20x... except for the tick ceiling,
       * which rounds 7.5 ticks up to 8 and lands on 18.75.
       */
      expect(hand / iron).toBeCloseTo(STONE.hand / STONE.iron_pickaxe, 1)
    })

  test('every pickaxe tier hits its published number on stone',
    async ({ page, terrain }) => {
      await aimAtTarget(page, terrain, ID.stone)
      for (const [key, want] of Object.entries(STONE)) {
        await hold(page, key === 'hand' ? null : key)
        await waitTicks(page, 2)
        // Long enough to accumulate several frames of progress, short enough
        // that the fastest tool in the game (gold, 0.2 s) does not finish.
        expect(await breakSeconds(page, 150), `${key} on stone`).toBeCloseTo(want, 2)
      }
    })

  test('the wrong tool is no better than no tool', async ({ page, terrain }) => {
    await aimAtTarget(page, terrain, ID.stone)

    await hold(page, 'iron_shovel')
    await waitTicks(page, 2)
    /*
     * A shovel is not in stone's mineable tag, so getDestroySpeed returns 1
     * and the penalty for not being able to harvest it still applies. Same
     * 7.5 seconds as a fist -- which is why a shovel in the hotbar is not a
     * quiet upgrade.
     */
    expect(await breakSeconds(page)).toBeCloseTo(STONE.hand, 2)
  })

  test('an axe is for wood and a shovel is for dirt', async ({ page, terrain }) => {
    await aimAtTarget(page, terrain, ID.planks)
    await hold(page, 'iron_axe')
    await waitTicks(page, 2)
    // Planks: 2 hardness, no tool required, so 2 * 30 / 6 = 10 ticks.
    expect(await breakSeconds(page, 200)).toBeCloseTo(0.5, 2)

    await aimAtTarget(page, terrain, ID.dirt)
    await hold(page, 'iron_shovel')
    await waitTicks(page, 2)
    // Dirt: 0.5 hardness, 0.5 * 30 / 6 = 2.5 ticks, and the ceiling takes it
    // to 3. Measured at 0.15, not 0.125.
    expect(await breakSeconds(page, 100)).toBeCloseTo(0.15, 2)
  })
})

test.describe('tools and what a block drops', () => {
  test.beforeEach(async ({ page }) => { await useGamemode(page, 'survival') })

  test('stone punched by hand breaks and leaves nothing', async ({ page, terrain }) => {
    await hold(page, null)
    await aimAtTarget(page, terrain, ID.stone)

    // The full seven and a half seconds, because the thing under test is what
    // is on the floor at the end of them.
    await holdMouse(page, 8000)

    expect(await getBlock(page, ...TARGET)).toBe(ID.air)
    expect(await floorIds(page),
      'stone dropped cobblestone to a bare hand').toEqual([])
    expect(await invCount(page, ID.cobblestone)).toBe(0)
  })

  test('the same stone drops cobblestone to a pickaxe', async ({ page, terrain }) => {
    await hold(page, 'iron_pickaxe')
    await aimAtTarget(page, terrain, ID.stone)
    await holdMouse(page, 600)

    expect(await getBlock(page, ...TARGET)).toBe(ID.air)
    expect(await floorIds(page)).toEqual([ID.cobblestone])
  })

  test('a wooden pickaxe on diamond ore yields nothing', async ({ page, terrain }) => {
    /*
     * Vanilla's needs_iron_tool tag. The block still breaks -- and a wooden
     * pickaxe is genuinely faster at breaking it than a fist, because
     * getDestroySpeed never looks at the tier -- it is simply faster at
     * producing nothing. Every player has done this once and concluded the
     * game was broken.
     */
    const DIAMOND_ORE = 16
    await hold(page, 'wooden_pickaxe')
    await aimAtTarget(page, terrain, DIAMOND_ORE)

    // 3 hardness, cannot harvest, wooden speed 2: 3 * 100 / 2 = 150 ticks.
    expect(await breakSeconds(page, 300)).toBeCloseTo(7.5, 2)

    await holdMouse(page, 8000)
    expect(await getBlock(page, ...TARGET)).toBe(ID.air)
    expect(await floorIds(page),
      'a wooden pickaxe got diamond ore out of the ground').toEqual([])
  })

  test('an iron pickaxe on diamond ore yields the ore', async ({ page, terrain }) => {
    const DIAMOND_ORE = 16
    await hold(page, 'iron_pickaxe')
    await aimAtTarget(page, terrain, DIAMOND_ORE)

    // 3 * 30 / 6 = 15 ticks.
    await holdMouse(page, 1000)
    expect(await getBlock(page, ...TARGET)).toBe(ID.air)
    expect(await floorIds(page)).toEqual([DIAMOND_ORE])
  })
})
