import { test, expect } from './fixtures.js'
import {
  waitTicks, measureSpeed, teleport, settleOnGround, SPAWN, useGamemode,
} from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * Potions, measured against Minecraft's own numbers.
 *
 * Same contract as 79-effects: "it works" is not evidence. A Potion of
 * Swiftness is a specific walk speed for a specific number of seconds, a
 * splash at two blocks is a specific fraction of a duration, and every
 * assertion below has vanilla's figure written next to it.
 *
 * VANILLA'S FIGURES ARE RESTATED HERE rather than imported from
 * src/potions.js, which is 79-effects' rule and the reason this suite catches
 * anything: a spec that imports the number it is checking passes for as long
 * as the code is self-consistent, including while it is self-consistently
 * wrong. Every constant in this file was read out of Potions.java in the
 * 1.21.8 decompile.
 *
 * Effects.js is NOT re-tested here. Whether Speed I is 5.180 b/s is that
 * file's contract; whether the BOTTLE hands you Speed I for 3600 ticks is
 * this one's.
 */

/* Potions.java, verbatim. Ticks. */
const VANILLA = {
  swiftness: [['speed', 0, 3600]],
  long_swiftness: [['speed', 0, 9600]],
  strong_swiftness: [['speed', 1, 1800]],
  slowness: [['slowness', 0, 1800]],
  long_slowness: [['slowness', 0, 4800]],
  strong_slowness: [['slowness', 3, 400]],
  leaping: [['jump_boost', 0, 3600]],
  long_leaping: [['jump_boost', 0, 9600]],
  strong_leaping: [['jump_boost', 1, 1800]],
  slow_falling: [['slow_falling', 0, 1800]],
  long_slow_falling: [['slow_falling', 0, 4800]],
  water_breathing: [['water_breathing', 0, 3600]],
  long_water_breathing: [['water_breathing', 0, 9600]],
  fire_resistance: [['fire_resistance', 0, 3600]],
  long_fire_resistance: [['fire_resistance', 0, 9600]],
  healing: [['instant_health', 0, 1]],
  strong_healing: [['instant_health', 1, 1]],
  harming: [['instant_damage', 0, 1]],
  strong_harming: [['instant_damage', 1, 1]],
  poison: [['poison', 0, 900]],
  long_poison: [['poison', 0, 1800]],
  strong_poison: [['poison', 1, 432]],
  regeneration: [['regeneration', 0, 900]],
  long_regeneration: [['regeneration', 0, 1800]],
  strong_regeneration: [['regeneration', 1, 450]],
  turtle_master: [['slowness', 3, 400], ['resistance', 2, 400]],
  long_turtle_master: [['slowness', 3, 800], ['resistance', 2, 800]],
  strong_turtle_master: [['slowness', 5, 400], ['resistance', 3, 400]],
  water: [],
}

/* Walk speeds, from 79-effects and from the wiki's own table. */
const WALK = 4.317
const SPEED_PER_LEVEL = 0.20

const potions = (page) => page.evaluate(() => window.game.potions)

const drink = (page, id) =>
  page.evaluate((i) => window.game.potions.drinkNow(i), id)

const active = (page, key) => page.evaluate((k) => {
  const i = window.game.effects.instance(window.noa.playerEntity, k)
  return i ? { amp: i.amplifier, ticks: i.ticks } : null
}, key)

const clearAll = (page) =>
  page.evaluate(() => window.game.effects.clear(window.noa.playerEntity))

const setHotbar = (page, key) => page.evaluate((k) => {
  const id = window.game.itemId(k)
  window.game.inventory.select(0)
  window.game.inventory.slots[0] = { id, count: 1 }
  window.game.inventory.emitChange()
  return id
}, key)

const slot0 = (page) => page.evaluate(() => {
  const s = window.game.inventory.slots[0]
  return s ? { name: window.game.itemName(s.id), count: s.count } : null
})

/* ------------------------------------------------------------------ *
 * The table
 * ------------------------------------------------------------------ */

test.describe('the table is vanilla', () => {
  test('every shipped potion has vanilla\'s effects, amplifiers and durations',
    async ({ page }) => {
      const table = await page.evaluate(() => {
        const out = {}
        for (const id of window.game.potionData.SHIPPED) {
          out[id] = window.game.potionData.POTIONS[id].effects
            .map(e => [e.key, e.amp ?? 0, e.ticks])
        }
        return out
      })
      // Non-empty first: a loop over an empty table passes every assertion
      // in it, which is how a census in this repo once passed while the
      // thing it counted was absent.
      expect(Object.keys(table).length).toBe(29)
      for (const [id, effects] of Object.entries(table)) {
        expect(effects, `potion "${id}"`).toEqual(VANILLA[id])
      }
    })

  test('no potion exists that vanilla does not have, and the variants are not a pattern',
    async ({ page }) => {
      const { shipped, withheld, unknown } = await page.evaluate(() => {
        const d = window.game.potionData
        return {
          shipped: d.SHIPPED,
          withheld: Object.keys(d.WITHHELD),
          unknown: [...d.SHIPPED, ...Object.keys(d.WITHHELD)].filter(id => !d.POTIONS[id]),
        }
      })
      // Every id this world names is a real registry id in Potions.java.
      expect(unknown).toEqual([])
      // Shipped plus withheld is the whole registry, so nothing was lost.
      expect(new Set([...shipped, ...withheld]).size).toBe(46)

      // The variant sets, which are the thing you get wrong from memory.
      // Healing and Harming are instants: there is nothing to extend.
      expect(shipped).toContain('strong_healing')
      expect(shipped).not.toContain('long_healing')
      // Fire Resistance, Water Breathing and Slow Falling extend but do not
      // strengthen.
      expect(shipped).toContain('long_fire_resistance')
      expect(shipped).not.toContain('strong_fire_resistance')
      expect(shipped).not.toContain('strong_water_breathing')
      expect(shipped).not.toContain('strong_slow_falling')
    })

  test('a potion with no consumer is not shipped', async ({ page }) => {
    const withheld = await page.evaluate(() => window.game.potionData.WITHHELD)
    // Strength and Weakness: effects.js exposes damageBonus and there is no
    // melee to spend it on. Shipping them is a bottle that lies.
    expect(Object.keys(withheld)).toEqual(expect.arrayContaining([
      'strength', 'long_strength', 'strong_strength', 'weakness', 'long_weakness',
      'night_vision', 'invisibility', 'luck',
    ]))
    // ...and every withheld potion carries its reason, so the report and the
    // code cannot disagree about why something is missing.
    for (const [id, why] of Object.entries(withheld)) {
      expect(why, `withheld "${id}"`).toMatch(/no consumer|brewing/)
    }
  })

  test('the colour is vanilla\'s weighted average, not one colour per base',
    async ({ page }) => {
      const c = await page.evaluate(() => {
        const d = window.game.potionData
        return {
          water: d.potionColor('water'),
          swiftness: d.potionColor('swiftness'),
          longSwiftness: d.potionColor('long_swiftness'),
          turtle: d.potionColor('turtle_master'),
          strongTurtle: d.potionColor('strong_turtle_master'),
        }
      })
      // PotionContents.BASE_POTION_COLOR = -13083194 = 0xFF385DC6.
      expect(c.water).toBe(0x385DC6)
      // One effect: the potion is the effect's own colour, unchanged.
      expect(c.swiftness).toBe(0x33EBFF)
      // Extended shares it -- same effect at a different length.
      expect(c.longSwiftness).toBe(c.swiftness)
      /*
       * THE ONE THAT CATCHES A COLOUR TABLE. Turtle Master weights Slowness
       * (#8BAFE0) and Resistance (#9146F0) by amplifier+1: (4, 3) normally,
       * (6, 4) enhanced. Hand-computed from getColorOptional:
       *   normal  r=(4*139+3*145)/7=141  g=(4*175+3*70)/7=130  b=(4*224+3*240)/7=230
       *   strong  r=(6*139+4*145)/10=141 g=(6*175+4*70)/10=133 b=(6*224+4*240)/10=230
       */
      expect(c.turtle).toBe(0x8D82E6)
      expect(c.strongTurtle).toBe(0x8D85E6)
      expect(c.strongTurtle).not.toBe(c.turtle)
    })
})

/* ------------------------------------------------------------------ *
 * Drinking
 * ------------------------------------------------------------------ */

test.describe('drinking', () => {
  test.afterEach(async ({ page }) => { await clearAll(page) })

  test('drinking Swiftness gives Speed I for 3600 ticks, and Swiftness II gives Speed II for 1800',
    async ({ page }) => {
      await drink(page, 'swiftness')
      expect(await active(page, 'speed')).toEqual({ amp: 0, ticks: 3600 })
      await clearAll(page)
      await drink(page, 'strong_swiftness')
      expect(await active(page, 'speed')).toEqual({ amp: 1, ticks: 1800 })
    })

  test('a Potion of Swiftness produces vanilla\'s walk speed', async ({ page }) => {
    await useGamemode(page, 'survival')
    await teleport(page, ...SPAWN)
    await settleOnGround(page)
    const base = await measureSpeed(page, ['w'])
    await drink(page, 'swiftness')
    await teleport(page, ...SPAWN)
    await settleOnGround(page)
    const fast = await measureSpeed(page, ['w'])
    /*
     * 4.317 * 1.20 = 5.180 b/s, which is the figure 79-effects measures for
     * `/effect give speed`. Measured through the BOTTLE here, which is the
     * only thing this test adds -- and the only thing that would have caught
     * a potion wired to the wrong amplifier.
     */
    expect(base).toBeGreaterThan(WALK * 0.9)
    expect(fast / base).toBeGreaterThan(1 + SPEED_PER_LEVEL - 0.04)
    expect(fast / base).toBeLessThan(1 + SPEED_PER_LEVEL + 0.04)
  })

  test('drinking Turtle Master gives BOTH of its effects at their own amplifiers',
    async ({ page }) => {
      await drink(page, 'turtle_master')
      expect(await active(page, 'slowness')).toEqual({ amp: 3, ticks: 400 })
      expect(await active(page, 'resistance')).toEqual({ amp: 2, ticks: 400 })
    })

  test('an instant potion is never stored, and it moves health', async ({ page }) => {
    await useGamemode(page, 'survival')
    await page.evaluate(() => { window.game.survival.health = 6 })
    await drink(page, 'healing')
    // 4 << 0 = 4 half-hearts.
    expect(await page.evaluate(() => window.game.survival.health)).toBe(10)
    // InstantenousMobEffect never enters the active list, which is why a
    // healing potion has no HUD icon and no duration.
    expect(await active(page, 'instant_health')).toBeNull()

    await page.evaluate(() => { window.game.survival.health = 20 })
    await drink(page, 'strong_harming')
    // 6 << 1 = 12.
    expect(await page.evaluate(() => window.game.survival.health)).toBe(8)
  })

  test('Instant Damage goes through survival\'s one gate, so creative is immune',
    async ({ page }) => {
      await useGamemode(page, 'creative')
      await page.evaluate(() => { window.game.survival.health = 20 })
      await drink(page, 'harming')
      expect(await page.evaluate(() => window.game.survival.health)).toBe(20)
      await useGamemode(page, 'survival')
    })

  test('drinking takes 32 ticks and hands back a glass bottle', async ({ page }) => {
    await useGamemode(page, 'survival')
    expect(await page.evaluate(() => window.game.potionData.DRINK_TICKS)).toBe(32)
    await setHotbar(page, 'potion_swiftness')
    expect((await slot0(page)).name).toMatch(/^Potion of Swiftness/)
    await drink(page, 'swiftness')
    expect(await slot0(page)).toEqual({ name: 'Glass Bottle', count: 1 })
  })

  test('creative drinks forever: the effect lands and the bottle does not change',
    async ({ page }) => {
      await useGamemode(page, 'creative')
      await setHotbar(page, 'potion_leaping')
      await drink(page, 'leaping')
      expect(await active(page, 'jump_boost')).toEqual({ amp: 0, ticks: 3600 })
      expect((await slot0(page)).name).toMatch(/^Potion of Leaping/)
      await useGamemode(page, 'survival')
    })
})

/* ------------------------------------------------------------------ *
 * Splash
 * ------------------------------------------------------------------ */

test.describe('splash', () => {
  test.afterEach(async ({ page }) => { await clearAll(page) })

  test('the falloff is 1 - sqrt(d)/4, zero beyond four blocks', async ({ page }) => {
    const p = await page.evaluate(() => {
      const d = window.game.potionData
      // Squared distances, because that is what AABB.distanceToSqr returns.
      return [0, 1, 4, 9, 16, 25].map(sq => d.splashPotency(sq))
    })
    // Touching the impact box is full strength -- no direct-hit special case
    // is needed, because box-to-box distance is already 0.
    expect(p[0]).toBeCloseTo(1, 6)
    expect(p[1]).toBeCloseTo(0.75, 6)   // 1 block
    expect(p[2]).toBeCloseTo(0.50, 6)   // 2 blocks
    expect(p[3]).toBeCloseTo(0.25, 6)   // 3 blocks
    expect(p[4]).toBe(0)                // 4 blocks: the range is exclusive
    expect(p[5]).toBe(0)
  })

  test('there is no 0.75 on splash -- that rule died in 15w31a', async ({ page }) => {
    const ticks = await page.evaluate(() => {
      const d = window.game.potionData
      return {
        pointBlank: d.splashTicks(3600, 1),
        oneBlock: d.splashTicks(3600, 0.75),
        edge: d.splashTicks(3600, 0.01),
      }
    })
    /*
     * A splashed Potion of Swiftness at zero distance is 3600 ticks, the same
     * as drinking it. Items.SPLASH_POTION carries no potion_duration_scale,
     * so the scale is 1.0; only lingering (0.25) and tipped arrows (0.125)
     * have one. 2700 here would be the 1.8 behaviour.
     */
    expect(ticks.pointBlank).toBe(3600)
    expect(ticks.oneBlock).toBe(2700)
    /* endsWithin(20): 36 ticks survives, and anything at or under 20 is
     * thrown away rather than rounded up. */
    expect(ticks.edge).toBe(36)
    expect(await page.evaluate(() => window.game.potionData.splashTicks(100, 0.1))).toBe(0)
  })

  test('a splash doses the player with a duration cut by distance', async ({ page }) => {
    const hits = await page.evaluate(() => {
      const noa = window.noa
      const p = noa.ents.getPositionData(noa.playerEntity).position
      // Break one two blocks away horizontally: potency 0.5.
      return window.game.potions.breakPotion({
        id: 'swiftness', x: p[0] + 2.1, y: p[1] + 0.9, z: p[2],
      })
    })
    expect(hits.hits.length).toBeGreaterThan(0)
    const me = await active(page, 'speed')
    expect(me).not.toBeNull()
    expect(me.amp).toBe(0)
    /*
     * The player's box is 0.6 wide, so its edge is 0.3 from the centre and
     * the box-to-box gap is about 1.68 blocks -- potency ~0.58, and the point
     * of the assertion is the SHAPE: markedly less than the full 3600 and
     * markedly more than nothing.
     */
    expect(me.ticks).toBeGreaterThan(1500)
    expect(me.ticks).toBeLessThan(3000)
  })

  test('nothing more than four blocks away is touched', async ({ page }) => {
    const hits = await page.evaluate(() => {
      const noa = window.noa
      const p = noa.ents.getPositionData(noa.playerEntity).position
      return window.game.potions.breakPotion({
        id: 'swiftness', x: p[0] + 12, y: p[1], z: p[2],
      })
    })
    expect(hits.hits).toEqual([])
    expect(await active(page, 'speed')).toBeNull()
  })

  test('a thrown splash potion flies, and it arcs', async ({ page }) => {
    await useGamemode(page, 'creative')
    const path = await page.evaluate(async () => {
      const shot = window.game.potions.throwSplash('swiftness')
      const start = shot.vy
      await new Promise(r => setTimeout(r, 300))
      return { start, later: shot.vy, moved: window.game.potions.flying.includes(shot) }
    })
    // Thrown twenty degrees ABOVE the crosshair, so it leaves the hand going
    // up even when you are looking level.
    expect(path.start).toBeGreaterThan(0)
    // ...and gravity, 0.05 blocks/tick^2, has taken some of it back.
    expect(path.later).toBeLessThan(path.start)
    await useGamemode(page, 'survival')
  })
})

/* ------------------------------------------------------------------ *
 * The creative menu, which is the thing that was reported missing
 * ------------------------------------------------------------------ */

test.describe('they are findable', () => {
  test('every potion is in Food & Drinks and none is uncategorised',
    async ({ page }) => {
      const where = await page.evaluate(() => {
        const out = {}
        for (const it of window.game.creative.PICKER_ITEMS) {
          if (!/^(splash_)?potion_/.test(it.key)) continue
          out[it.key] = window.game.creative.ruleFor(it.key)?.tab ?? null
        }
        return out
      })
      const keys = Object.keys(where)
      // Non-empty first. A loop over nothing passes.
      expect(keys.length).toBe(58)
      for (const k of keys) expect(where[k], k).toBe('food_and_drinks')
      expect(await page.evaluate(() => window.game.creative.uncategorised())).toEqual([])
    })

  test('the search tab finds a potion by name', async ({ page }) => {
    const found = await page.evaluate(() =>
      window.game.creative.searchItems('swiftness')
        .map(id => window.game.itemName(id)))
    expect(found).toEqual([
      'Potion of Swiftness (3:00)',
      'Splash Potion of Swiftness (3:00)',
      'Potion of Swiftness (8:00)',
      'Splash Potion of Swiftness (8:00)',
      'Potion of Swiftness II (1:30)',
      'Splash Potion of Swiftness II (1:30)',
    ])
  })

  test('the Food & Drinks tab, with the potions in it', async ({ page }) => {
    await useGamemode(page, 'creative')
    await page.evaluate(() => {
      window.game.inventoryScreen.setOpen(true)
      window.game.inventoryScreen.creative.selectTab('food_and_drinks')
    })
    await waitTicks(page, 3)
    /*
     * SUBTLE, and it cost a screenshot with fifteen holes in it: an item icon
     * is a CSS `background-image`, and a browser decodes those ASYNCHRONOUSLY.
     * Fifty-eight brand-new URLs go out at once when this tab opens, and three
     * game ticks later most of them have not painted. Waiting for the network
     * is not enough either -- `Image.decode()` is what says a bitmap is ready
     * to draw, so the screenshot waits for every one of them.
     */
    await page.evaluate(async () => {
      const urls = [...document.querySelectorAll('.item-icon')]
        .map(el => el.style.backgroundImage.slice(5, -2))
        .filter(u => u.startsWith('/textures'))
      await Promise.all(urls.map(u => {
        const img = new Image()
        img.src = u
        return img.decode().catch(() => {})
      }))
    })
    await waitTicks(page, 2)
    await shot(page, 'potions-creative-tab')
    await page.evaluate(() => window.game.inventoryScreen.setOpen(false))
    await useGamemode(page, 'survival')
  })
})
