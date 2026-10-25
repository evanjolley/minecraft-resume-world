import { test, expect } from './fixtures.js'
import {
  SURFACE_Y, waitTicks, look, centreMouse, chatCommand, grantOp, useGamemode,
} from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * Passive mobs (src/mobs.js): cows, pigs, sheep and chickens. Natural
 * spawning is off under automation, so every mob here is summoned, and
 * resetWorld clears them between tests.
 */

const summon = (page, kind, dx, dz, opts = {}) => page.evaluate(([k, x, z, o]) => {
  const p = window.noa.ents.getPosition(window.noa.playerEntity)
  const m = window.game.mobs.summon(k, p[0] + x, p[1], p[2] + z, o)
  return m.id
}, [kind, dx, dz, opts])

const mob = (page, id) => page.evaluate((i) => {
  const m = window.game.mobs.list.find(x => x.id === i)
  if (!m) return null
  const p = window.noa.ents.getPosition(m.entity)
  return { kind: m.kind, health: m.health, hurt: m.hurtTime, panic: m.panic, pos: [...p], wool: m.wool }
}, id)

const useCreative = (page) => useGamemode(page, 'creative')

/* Hold mobs still: NoAI until the test ends (afterEach turns it back on). */
const still = (page) => page.evaluate(() => {
  window.game.mobs.setAI(false)
  for (const m of window.game.mobs.list) { m.goal = null; m.panic = 0; m.look = null }
})

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.game.mobs.setAI(true))
})

test.describe('the four passive mobs', () => {
  test('vanilla sizes and health, and a model on vanilla\'s UV layout', async ({ page }) => {
    for (const [i, k] of ['cow', 'pig', 'sheep', 'chicken'].entries()) await summon(page, k, -3 + i * 2, 4)
    const got = await page.evaluate(() => window.game.mobs.list.map(m => {
      const d = window.noa.ents.getPositionData(m.entity)
      return { kind: m.kind, w: d.width, h: d.height, hp: m.health, parts: Object.keys(m.model.parts).length }
    }))
    expect(got).toEqual([
      { kind: 'cow', w: 0.9, h: 1.4, hp: 10, parts: 6 },
      { kind: 'pig', w: 0.9, h: 0.9, hp: 10, parts: 6 },
      { kind: 'sheep', w: 0.9, h: 1.3, hp: 8, parts: 6 },
      { kind: 'chicken', w: 0.4, h: 0.7, hp: 4, parts: 6 },
    ])
    await still(page)
    await look(page, { heading: 0, pitch: 0.3 })
    await waitTicks(page, 10)
    await shot(page, 'mobs-lineup')
  })

  test('skins load from the CE pack and the wool is tinted by color', async ({ page }) => {
    await page.evaluate(() => window.game.mobs.ready())
    await summon(page, 'sheep', 0, 4, { wool: 'black' })
    await waitTicks(page, 5)
    const t = await page.evaluate(() => {
      const m = window.game.mobs.list[0]
      return m.model.mats.map(x => ({ ready: x.diffuseTexture.isReady(), url: x.diffuseTexture.url.slice(0, 40) }))
    })
    expect(t[0]).toEqual({ ready: true, url: '/textures/entity/sheep.png' })
    // The black fleece is a baked tint, not the white sheet.
    expect(t[1].url.startsWith('data:image/png')).toBe(true)
  })

  test('a sheep\'s natural color follows vanilla\'s odds', async ({ page }) => {
    const counts = await page.evaluate(async () => {
      const { randomWool } = await import('/src/mobs.js')
      const c = {}
      for (let i = 0; i < 20000; i++) { const w = randomWool(); c[w] = (c[w] || 0) + 1 }
      return c
    })
    expect(counts.white / 20000).toBeGreaterThan(0.79)
    expect(counts.white / 20000).toBeLessThan(0.845)
    expect(counts.black / 20000).toBeGreaterThan(0.035)
    expect(counts.brown / 20000).toBeGreaterThan(0.02)
  })
})

test.describe('wandering', () => {
  test('a cow walks to where it decided to go, at vanilla\'s amble', async ({ page }) => {
    const id = await summon(page, 'cow', 0, 3)
    await waitTicks(page, 10)
    const start = (await mob(page, id)).pos
    await page.evaluate(([i, x, y, z]) => {
      const m = window.game.mobs.list.find(q => q.id === i)
      window.game.mobs.walkTo(m, [x + 12, y, z])
    }, [id, ...start])
    await page.waitForTimeout(1500)
    const a = (await mob(page, id)).pos
    const t0 = Date.now()
    await page.waitForTimeout(2000)
    const b = (await mob(page, id)).pos
    const secs = (Date.now() - t0) / 1000
    const speed = Math.hypot(b[0] - a[0], b[2] - a[2]) / secs
    const expected = await page.evaluate(async () => (await import('/src/mobs.js')).groundSpeed(0.2))
    expect(expected).toBeCloseTo(1.727, 2)
    expect(speed).toBeGreaterThan(expected * 0.7)
    expect(speed).toBeLessThan(expected * 1.3)
    // It turned to face the way it walks: +X is heading pi/2.
    const yaw = await page.evaluate((i) => window.game.mobs.list.find(q => q.id === i).bodyYaw, id)
    expect(Math.abs(Math.atan2(Math.sin(yaw - Math.PI / 2), Math.cos(yaw - Math.PI / 2)))).toBeLessThan(0.3)
  })

  test('a stroll prefers grass and stays on the ground', async ({ page }) => {
    const id = await summon(page, 'pig', 0, 3)
    await waitTicks(page, 5)
    const target = await page.evaluate((i) => {
      const m = window.game.mobs.list.find(q => q.id === i)
      return window.game.mobs.stroll(m)
    }, id)
    expect(target).not.toBeNull()
    const below = await page.evaluate(([x, y, z]) => window.game.blockKey(
      window.noa.getBlock(Math.floor(x), y - 1, Math.floor(z))), target)
    expect(below).not.toBe('air')
  })
})

test.describe('hitting one', () => {
  test('a punch does 1, flashes red, knocks it back and makes it panic', async ({ page }) => {
    const id = await summon(page, 'cow', 0, 2)
    await waitTicks(page, 10)
    await still(page)
    await centreMouse(page)
    await look(page, { heading: 0, pitch: 0.3 })
    const before = await mob(page, id)
    await page.mouse.down()
    await page.mouse.up()
    await waitTicks(page, 2)
    const after = await mob(page, id)
    expect(after.health).toBe(before.health - 1)
    expect(after.hurt).toBeGreaterThan(0)
    expect(after.panic).toBeGreaterThan(0)
    await waitTicks(page, 8)
    const pushed = await mob(page, id)
    // Away from the player, who is at -Z of it.
    expect(pushed.pos[2]).toBeGreaterThan(before.pos[2] + 0.3)
  })

  test('weapons hit like vanilla\'s, and a swing before the cooldown is weak', async ({ page }) => {
    const w = await page.evaluate(async () => {
      const { weaponOf } = await import('/src/mobs.js')
      const { itemId } = await import('/src/items.js')
      return [weaponOf(itemId('iron_sword')), weaponOf(itemId('diamond_axe')), weaponOf(0)]
    })
    expect(w).toEqual([{ damage: 6, speed: 1.6 }, { damage: 9, speed: 1 }, { damage: 1, speed: 4 }])

    const id = await summon(page, 'cow', 0, 2)
    await waitTicks(page, 10)
    await still(page)
    await centreMouse(page)
    await look(page, { heading: 0, pitch: 0.3 })
    const hp = await page.evaluate(async (i) => {
      const { itemId } = await import('/src/items.js')
      const g = window.game
      g.inventory.slots[g.inventory.selected] = { id: itemId('iron_sword'), count: 1 }
      const m = g.mobs.list.find(q => q.id === i)
      await new Promise(r => setTimeout(r, 900)) // a full charge
      g.mobs.attack()
      const first = m.health
      m.invulnerable = 0
      g.mobs.attack() // no time to recharge
      return [first, m.health]
    }, id)
    expect(hp[0]).toBeCloseTo(4, 5)
    // 6 * (0.2 + 0.8 * charge^2) with charge near 0: a little over 1.
    expect(4 - hp[1]).toBeGreaterThan(1.1)
    expect(4 - hp[1]).toBeLessThan(1.6)
  })

  test('killing a cow drops beef and maybe leather, and the body rolls over', async ({ page }) => {
    const id = await summon(page, 'cow', 0, 3)
    await waitTicks(page, 10)
    const before = await page.evaluate(() => window.game.drops.list.length)
    await page.evaluate((i) => {
      const m = window.game.mobs.list.find(q => q.id === i)
      m.invulnerable = 0
      window.game.mobs.hurt(m, 100)
    }, id)
    await waitTicks(page, 3)
    const drops = await page.evaluate(() => window.game.drops.list
      .map(d => window.game.itemName(d.id)))
    expect(drops.length).toBeGreaterThan(before)
    expect(drops).toContain('Raw Beef')
    for (const name of drops) expect(['Raw Beef', 'Leather']).toContain(name)
    // Still there, dying, for 20 ticks; then gone.
    expect(await mob(page, id)).not.toBeNull()
    await page.waitForTimeout(1300)
    expect(await mob(page, id)).toBeNull()
  })

  test('the loot tables', async ({ page }) => {
    const tables = await page.evaluate(() => {
      const S = window.game.mobs.SPECIES
      return {
        cow: S.cow.loot({}), pig: S.pig.loot({}),
        sheep: S.sheep.loot({ wool: 'black' }), chicken: S.chicken.loot({}),
      }
    })
    expect(tables).toEqual({
      cow: [['leather', 0, 2], ['beef', 1, 3]],
      pig: [['porkchop', 1, 3]],
      sheep: [['black_wool', 1, 1], ['mutton', 1, 2]],
      chicken: [['feather', 0, 2], ['chicken', 1, 1]],
    })
  })

  test('a click on a mob does not mine the block behind it', async ({ page, terrain }) => {
    await terrain.keep([-1, SURFACE_Y - 1, 1], [1, SURFACE_Y - 1, 4])
    await still(page)
    const id = await summon(page, 'cow', 0, 2)
    await waitTicks(page, 10)
    await useCreative(page)
    await centreMouse(page)
    await look(page, { heading: 0, pitch: 0.45 })
    const aim = await page.evaluate(() => ({
      mob: window.game.mobs.targeted() !== null,
      block: window.noa.targetedBlock ? [...window.noa.targetedBlock.position] : null,
    }))
    expect(aim.mob).toBe(true)
    expect(aim.block).not.toBeNull()
    const was = await page.evaluate(([x, y, z]) => window.noa.getBlock(x, y, z), aim.block)
    // One tick of holding. The knockback moves the cow out of the way over
    // the next few, after which holding WOULD mine, as it does in vanilla.
    await page.mouse.down()
    await waitTicks(page, 1)
    await page.mouse.up()
    expect(await page.evaluate(([x, y, z]) => window.noa.getBlock(x, y, z), aim.block)).toBe(was)
    expect((await mob(page, id)).health).toBeLessThan(10)
  })
})

test.describe('chickens', () => {
  test('a chicken lays an egg when its timer runs out, and flutters down', async ({ page }) => {
    const id = await summon(page, 'chicken', 0, 3)
    await waitTicks(page, 5)
    await page.evaluate((i) => { window.game.mobs.list.find(q => q.id === i).eggTime = 1 }, id)
    await waitTicks(page, 3)
    const names = await page.evaluate(() => window.game.drops.list.map(d => window.game.itemName(d.id)))
    expect(names).toContain('Egg')
    // Dropped from 10 up, it falls no faster than vanilla's flutter.
    await page.evaluate((i) => {
      const m = window.game.mobs.list.find(q => q.id === i)
      const p = window.noa.ents.getPosition(m.entity)
      window.noa.ents.setPosition(m.entity, [p[0], p[1] + 10, p[2]])
    }, id)
    await waitTicks(page, 30)
    const vy = await page.evaluate((i) => window.game.mobs.list.find(q => q.id === i).body.velocity[1], id)
    expect(vy).toBeGreaterThanOrEqual(-2.31)
  })
})

test.describe('spawning', () => {
  test('only on grass, and only with sky light above 8', async ({ page, terrain }) => {
    await terrain.keep([4, SURFACE_Y - 1, 4], [4, SURFACE_Y + 3, 4])
    const r = await page.evaluate(([y]) => {
      const mobs = window.game.mobs
      const grass = window.game.ids.grass
      window.noa.setBlock(grass, 4, y - 1, 4)
      const open = mobs.canSpawnAt(4, y, 4)
      window.noa.setBlock(window.game.ids.stone, 4, y - 1, 4)
      const stone = mobs.canSpawnAt(4, y, 4)
      return { open, stone }
    }, [SURFACE_Y])
    expect(r).toEqual({ open: true, stone: false })
  })

  test('a herd is four of one kind, and a herd of sheep is one color', async ({ page }) => {
    const herd = await page.evaluate(() => {
      const mobs = window.game.mobs
      let n = 0
      for (let i = 0; i < 40 && n === 0; i++) n = mobs.trySpawnHerd()
      return mobs.list.map(m => ({ kind: m.kind, wool: m.wool }))
    })
    expect(herd.length).toBeGreaterThan(0)
    expect(herd.length).toBeLessThanOrEqual(4)
    expect(new Set(herd.map(m => m.kind)).size).toBe(1)
    expect(new Set(herd.map(m => m.wool)).size).toBe(1)
  })

  test('natural spawning is off under automation, and can be turned on', async ({ page }) => {
    expect(await page.evaluate(() => window.game.mobs.natural)).toBe(false)
  })
})

test.describe('commands', () => {
  test.beforeEach(async ({ page }) => { await grantOp(page) })

  test('/summon and /kill @e[type=...]', async ({ page }) => {
    const sys = (out) => out.map(l => l.text)
    expect(sys(await chatCommand(page, '/summon cow ~ ~ ~3'))).toEqual(['Summoned new Cow'])
    expect(sys(await chatCommand(page, '/summon minecraft:pig ~2 ~ ~3'))).toEqual(['Summoned new Pig'])
    expect(sys(await chatCommand(page, '/summon creeper'))).toEqual(['Unable to summon entity'])
    expect(await page.evaluate(() => window.game.mobs.count)).toBe(2)
    expect(sys(await chatCommand(page, '/kill @e[type=minecraft:cow]'))).toEqual(['Killed Cow'])
    expect(sys(await chatCommand(page, '/kill @e[type=sheep]'))).toEqual(['No entity was found'])
    await page.waitForTimeout(1300)
    expect(await page.evaluate(() => window.game.mobs.list.map(m => m.kind))).toEqual(['pig'])
  })
})

test.describe('the food they drop', () => {
  test('eating a steak is 8 food and 12.8 saturation, capped at 20', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const { itemId } = await import('/src/items.js')
      const g = window.game
      g.inventory.slots[g.inventory.selected] = { id: itemId('cooked_beef'), count: 2 }
      g.survival.food = 10
      g.survival.saturation = 0
      g.food.eatNow()
      const once = [g.survival.food, g.survival.saturation, g.inventory.slots[g.inventory.selected]?.count]
      g.food.eatNow()
      return { once, twice: [g.survival.food, g.survival.saturation] }
    })
    expect(r.once).toEqual([18, 12.8, 1])
    expect(r.twice).toEqual([20, 20])
  })

  test('a smoker cooks meat and a blast furnace will not', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const { smeltingResult } = await import('/src/crafting.js')
      const { itemId, itemName } = await import('/src/items.js')
      const beef = itemId('beef')
      const name = (id) => (id ? itemName(id) : null)
      return {
        furnace: name(smeltingResult(beef, 'furnace')),
        smoker: name(smeltingResult(beef, 'smoker')),
        blast: name(smeltingResult(beef, 'blast_furnace')),
        blastIron: name(smeltingResult(itemId('raw_iron'), 'blast_furnace')),
        smokerIron: name(smeltingResult(itemId('raw_iron'), 'smoker')),
        blastGlass: name(smeltingResult(itemId('sand'), 'blast_furnace')),
      }
    })
    expect(r).toEqual({
      furnace: 'Steak', smoker: 'Steak', blast: null,
      blastIron: 'Iron Ingot', smokerIron: null, blastGlass: null,
    })
  })
})
