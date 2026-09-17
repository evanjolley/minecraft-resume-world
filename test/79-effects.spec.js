import { test, expect } from './fixtures.js'
import {
  waitTicks, measureSpeed, measureJumpApex, look, HEADING, chatCommand,
  OP_PASSPHRASE, teleport, settleOnGround, SPAWN,
} from './helpers/world.js'
import { shot, shotRegion } from './helpers/shots.js'

/*
 * Status effects, measured against Minecraft's own numbers.
 *
 * "It feels faster" is not evidence. Speed I is a specific walk speed,
 * Regeneration I heals on a specific interval, and Resistance II takes a
 * specific fraction off a specific hit -- so every assertion here is a figure
 * with a vanilla figure next to it.
 *
 * THE TICK CLOCK IS WHAT MOST OF THIS IS REALLY TESTING. effects.js keeps an
 * integer Minecraft tick counter fed from noa's variable 30 Hz dt, because
 * every interval rule in the game is a modulo on that integer -- `50 >>
 * amplifier` for regeneration, `25 >>` for poison. A float timer reproduces
 * the average and drifts on the number, which is why the interval tests below
 * count HITS over a fixed window rather than timing one.
 */

const WALK = 4.317
const SPRINT = 5.612
const JUMP_APEX = 1.2522

/* Vanilla's own values, restated here rather than imported, so that moving a
 * constant in src/effects.js fails these rather than quietly following it --
 * the same rule test/helpers/world.js states for the block ids. */
const SPEED_PER_LEVEL = 0.20
const SLOWNESS_PER_LEVEL = -0.15

/*
 * A speed measurement from a KNOWN STARTING POINT.
 *
 * measureSpeed walks the player for 1.6 s, and three measurements in a row
 * cover twenty-odd blocks -- which is far enough from spawn to walk into Evan
 * and be stopped by him. That is what "Speed I walk was 0.367 b/s" was: not a
 * multiplier that failed to apply, a player standing against an NPC. Going
 * back to spawn between runs makes each measurement independent of the one
 * before it, which is what a measurement has to be.
 */
const walkSpeed = async (page, keys) => {
  await teleport(page, ...SPAWN)
  await settleOnGround(page)
  return measureSpeed(page, keys)
}

const give = (page, key, seconds, amplifier = 0, hidden = false) =>
  page.evaluate(([k, s, a, h]) =>
    window.game.effects.give(window.noa.playerEntity, k, s, a, h),
  [key, seconds, amplifier, hidden])

/* chatCommand hands back {kind, text} rows, not strings. */
const text = (lines) => lines.map(l => l.text).join(' | ')

const health = (page) => page.evaluate(() => window.game.survival.health)
const setHealth = (page, n) =>
  page.evaluate((v) => { window.game.survival.health = v }, n)

/* Everything that could leak into the next test lives here. `clearAll` is also
 * in resetWorld, and this is the belt to that braces: a test that measures a
 * speed after a failed assertion never reaches its own cleanup. */
test.afterEach(async ({ page }) => {
  await page.evaluate(() => {
    window.game.effects.clearAll()
    window.game.survival.reset()
  })
})

test.describe('the registry', () => {
  test('every vanilla effect is present, with the ids and categories 1.21 gives them',
    async ({ page }) => {
      const table = await page.evaluate(() =>
        window.game.effects && window.__effectsTable
          ? window.__effectsTable
          : null)
      // The registry is a module export rather than something on window.game,
      // so it is read through the live command surface instead -- which also
      // proves /effect would accept every one of them.
      const keys = await page.evaluate(() => window.game.commands.effectKeys)
      expect(keys.length, `registry held ${keys.length} effects`).toBe(39)
      expect(keys[0]).toBe('speed')
      expect(keys[38]).toBe('infested')
      // The four NEUTRAL effects are the ones the HUD split gets wrong, so
      // they are named rather than counted.
      for (const k of ['glowing', 'bad_omen', 'trial_omen', 'raid_omen']) {
        expect(keys, `${k} missing from the registry`).toContain(k)
      }
      expect(table).toBeNull() // no accidental global
    })
})

test.describe('movement', () => {
  test.beforeEach(async ({ page }) => {
    await look(page, { heading: HEADING.westPlusX })
  })

  /*
   * Speed and Slowness are ADD_MULTIPLIED_TOTAL in vanilla, which multiplies
   * the running total at the END -- so they compose with the sprint gear
   * rather than replacing it. Both gears are measured for exactly that reason:
   * a version that scaled MC.WALK_SPEED and then applied sprint would pass the
   * walking case and fail this one.
   */
  test('Speed I walks at 5.180 b/s and sprints at 6.734, which is 1.2x each gear',
    async ({ page }) => {
      const plainWalk = await walkSpeed(page, ['KeyW'])
      expect(await give(page, 'speed', 60, 0)).toBe(true)
      await waitTicks(page, 2)
      const fastWalk = await walkSpeed(page, ['KeyW'])
      const fastSprint = await walkSpeed(page, ['KeyW', 'ControlLeft'])

      const wantWalk = WALK * (1 + SPEED_PER_LEVEL)
      const wantSprint = SPRINT * (1 + SPEED_PER_LEVEL)
      expect(plainWalk, `plain walk was ${plainWalk.toFixed(3)}`).toBeCloseTo(WALK, 0)
      expect(fastWalk,
        `Speed I walk was ${fastWalk.toFixed(3)} b/s, vanilla ${wantWalk.toFixed(3)}`)
        .toBeGreaterThan(wantWalk * 0.94)
      expect(fastWalk).toBeLessThan(wantWalk * 1.06)
      expect(fastSprint,
        `Speed I sprint was ${fastSprint.toFixed(3)} b/s, vanilla ${wantSprint.toFixed(3)}`)
        .toBeGreaterThan(wantSprint * 0.94)
    })

  test('Speed II is 1.4x and not 1.2 squared -- the modifier is additive per level',
    async ({ page }) => {
      await give(page, 'speed', 60, 1)
      // maxSpeed is ASSIGNED by the movement tick, not by give(). Reading it
      // in the same turn reads the tick before the effect landed -- which is
      // the shape of every "it didn't apply" bug in a tick-driven system.
      await waitTicks(page, 2)
      const target = await page.evaluate(() => window.game.move.maxSpeed)
      // maxSpeed is read rather than measured: this test is about the ARITHMETIC
      // of the amplifier, and the physical measurement is the test above.
      const want = WALK * (1 + SPEED_PER_LEVEL * 2)
      expect(target, `Speed II maxSpeed was ${target.toFixed(4)}, vanilla ${want.toFixed(4)}`)
        .toBeCloseTo(want, 3)
      expect(target).not.toBeCloseTo(WALK * 1.2 * 1.2, 2)
    })

  test('Slowness IV cuts the walk to 40%, and Slowness VII pins you rather than reversing you',
    async ({ page }) => {
      await give(page, 'slowness', 60, 3)
      await waitTicks(page, 2)
      const four = await page.evaluate(() => window.game.move.maxSpeed)
      expect(four, `Slowness IV maxSpeed was ${four.toFixed(4)}`)
        .toBeCloseTo(WALK * (1 + SLOWNESS_PER_LEVEL * 4), 3)

      await page.evaluate(() => window.game.effects.clearAll())
      await give(page, 'slowness', 60, 6)
      await waitTicks(page, 2)
      const seven = await page.evaluate(() => window.game.move.maxSpeed)
      // 1 - 0.15*7 = -0.05. Vanilla's attribute floors at zero.
      expect(seven, `Slowness VII maxSpeed was ${seven}`).toBe(0)
    })

  /*
   * Jump Boost adds 0.1 blocks/tick to the 0.42 launch, so the velocity ratio
   * is 1.238 and the apex -- which goes as v squared -- is 1.533x. That is
   * 1.919 blocks, which is the number that matters: it is why Jump Boost I
   * clears a two-block step.
   */
  test('Jump Boost I peaks at 1.92 blocks, up from 1.2522', async ({ page }) => {
    await settleOnGround(page)
    const plain = await measureJumpApex(page)
    expect(plain, `plain apex was ${plain.toFixed(4)} blocks, vanilla 1.2522`)
      .toBeGreaterThan(JUMP_APEX * 0.9)
    expect(plain).toBeLessThan(JUMP_APEX * 1.1)

    await give(page, 'jump_boost', 60, 0)
    await waitTicks(page, 2)
    await settleOnGround(page)
    const boosted = await measureJumpApex(page)
    const want = JUMP_APEX * ((0.42 + 0.1) / 0.42) ** 2
    expect(boosted,
      `Jump Boost I apex was ${boosted.toFixed(4)} blocks, vanilla ${want.toFixed(4)}`)
      .toBeGreaterThan(want * 0.92)
    expect(boosted).toBeLessThan(want * 1.08)
    /*
     * WHAT IT ACTUALLY CLEARS, corrected against the measurement.
     *
     * The first version of this asserted a 2-block step and failed at 1.954,
     * and the test was the thing that was wrong: 0.42 + 0.1 is 0.52, the apex
     * ratio is (0.52/0.42)^2 = 1.533, and 1.2522 * 1.533 is 1.919 -- under two
     * blocks. Jump Boost I does NOT clear a two-block step in vanilla either;
     * that is what Jump Boost II is for. What it does clear is the 1.5 a plain
     * jump cannot, which is the honest property and is the one measured here.
     */
    expect(boosted, 'Jump Boost I must clear a 1.5-block step').toBeGreaterThan(1.5)
    expect(plain, 'and a plain jump must not').toBeLessThan(1.5)
  })
})

test.describe('the ticking effects', () => {
  /*
   * COUNT THE HITS OVER A WINDOW, do not time one.
   *
   * Regeneration I is one heal every 50 ticks, which is 2.5 s. Over six
   * seconds that is two or three heals depending on where the window opens, so
   * the assertion is a RANGE derived from the interval rather than a single
   * number -- and the range is tight enough that Regeneration II (25 ticks,
   * five heals) could not pass it.
   */
  test('Regeneration I heals once every 50 ticks and Regeneration II once every 25',
    async ({ page }) => {
      /*
       * FOOD TO ZERO, for the same reason the wither test does it: survival.js
       * heals a half-heart every four seconds at food >= 18, and that lands
       * inside the same window this is counting. It is not noise -- it is a
       * second healer, and it put Regeneration II at 6 heals in six seconds
       * against vanilla's 4.8. Hunger drain is off in this world, so zeroing
       * food does nothing except switch the other healer off.
       */
      await page.evaluate(() => { window.game.survival.food = 0 })
      await setHealth(page, 1)
      await give(page, 'regeneration', 60, 0)
      await page.waitForTimeout(6000)
      const oneUp = (await health(page)) - 1
      await page.evaluate(() => window.game.effects.clearAll())

      await page.evaluate(() => { window.game.survival.food = 0 })
      await setHealth(page, 1)
      await give(page, 'regeneration', 60, 1)
      await page.waitForTimeout(6000)
      const twoUp = (await health(page)) - 1

      // 6 s is 120 ticks. 120/50 = 2.4 heals, 120/25 = 4.8.
      expect(oneUp, `Regeneration I healed ${oneUp} in 6s, vanilla 2-3`)
        .toBeGreaterThanOrEqual(2)
      expect(oneUp).toBeLessThanOrEqual(3)
      expect(twoUp, `Regeneration II healed ${twoUp} in 6s, vanilla 4-5`)
        .toBeGreaterThanOrEqual(4)
      expect(twoUp).toBeLessThanOrEqual(5)
      expect(twoUp, 'II must be strictly faster than I').toBeGreaterThan(oneUp)
    })

  /*
   * THE ASYMMETRY BETWEEN POISON AND WITHER IS THE WHOLE TEST.
   *
   * Poison's tick body is guarded by `if (entity.getHealth() > 1.0F)`, so it
   * stops at half a heart and there is no such thing as a poison death. Wither
   * has no guard at all. Testing poison's interval without testing its floor
   * would pass on an implementation that kills you.
   */
  test('Poison stops at half a heart and never kills', async ({ page }) => {
    // Food to zero, like the two tests either side of it. The natural regen at
    // food >= 18 heals a half-heart every four seconds, and poison's floor
    // means it cannot undo that -- so the bar creeps back UP while poison
    // holds at 1, and the final reading is whichever of the two fired last.
    // Measured 1 on Chromium and 2 on WebKit for exactly that reason.
    await page.evaluate(() => { window.game.survival.food = 0 })
    await setHealth(page, 4)
    await give(page, 'poison', 60, 0)
    // 25-tick interval is 1.25 s, so eight seconds is six or seven hits --
    // comfortably more than the three it would take to kill from 4.
    await page.waitForTimeout(8000)
    const left = await health(page)
    const dead = await page.evaluate(() => window.game.survival.dead)
    expect(left, `poison left ${left} health`).toBe(1)
    expect(dead, 'poison must never kill').toBe(false)
  })

  test('Wither has no such floor and does kill', async ({ page }) => {
    /*
     * FOOD TO ZERO FIRST, and this is not decoration. survival.js regenerates
     * a half-heart every four seconds at food >= 18, which is faster than
     * Wither I's one every two seconds is lethal -- so the first version of
     * this test watched wither and regen fight to a draw at 1 health and
     * reported that wither cannot kill. Hunger drain is off in this world, so
     * zeroing food is inert other than switching the regen off.
     */
    await page.evaluate(() => { window.game.survival.food = 0 })
    await setHealth(page, 3)
    await give(page, 'wither', 60, 0)
    // 40-tick interval is 2 s, so eight seconds is three or four hits.
    await page.waitForTimeout(9000)
    const dead = await page.evaluate(() => window.game.survival.dead)
    const left = await health(page)
    expect(dead, `wither left ${left} health and dead=${dead}`).toBe(true)
  })

  test('Poison II is twice as fast as Poison I -- the interval halves with the amplifier',
    async ({ page }) => {
      await page.evaluate(() => { window.game.survival.food = 0 })
      await setHealth(page, 20)
      await give(page, 'poison', 60, 0)
      await page.waitForTimeout(5000)
      const one = 20 - (await health(page))
      await page.evaluate(() => window.game.effects.clearAll())

      await page.evaluate(() => { window.game.survival.food = 0 })
      await setHealth(page, 20)
      await give(page, 'poison', 60, 1)
      await page.waitForTimeout(5000)
      const two = 20 - (await health(page))

      // 5 s is 100 ticks: 100/25 = 4 hits at I, 100/12 = 8 at II.
      expect(one, `Poison I dealt ${one} in 5s, vanilla 3-5`).toBeGreaterThanOrEqual(3)
      expect(one).toBeLessThanOrEqual(5)
      expect(two, `Poison II dealt ${two} in 5s, vanilla 7-9`).toBeGreaterThanOrEqual(7)
      expect(two).toBeLessThanOrEqual(9)
    })
})

test.describe('the damage path', () => {
  /*
   * RESISTANCE COMPOSES WITH ARMOR, IN THAT ORDER.
   *
   * LivingEntity.actuallyHurt is two consecutive lines -- armor absorb, then
   * magic absorb, and Resistance is in the second. armor.js subtracts
   * `damage / f` from the armor points before counting them, so the order is
   * not commutative: resist first and armor's points count for proportionally
   * more. This asserts the exact composed number, which is the only way to
   * tell the two orders apart.
   */
  test('Resistance II takes 40% off, applied after armor and not before',
    async ({ page }) => {
      const hit = 10
      await setHealth(page, 20)
      await page.evaluate((n) => window.game.survival.damage(n, 'generic'), hit)
      const plainLoss = 20 - (await health(page))

      await give(page, 'resistance', 60, 1)
      await setHealth(page, 20)
      await page.evaluate((n) => window.game.survival.damage(n, 'generic'), hit)
      const resistedLoss = 20 - (await health(page))

      // (25 - 2*5) / 25 = 0.6
      expect(plainLoss, `unarmoured 10 damage cost ${plainLoss}`).toBeCloseTo(10, 4)
      expect(resistedLoss,
        `Resistance II turned 10 into ${resistedLoss.toFixed(4)}, vanilla 6`)
        .toBeCloseTo(6, 4)
    })

  test('Resistance V is total immunity and Resistance VI does not heal you',
    async ({ page }) => {
      await give(page, 'resistance', 60, 5)
      await setHealth(page, 10)
      await page.evaluate(() => window.game.survival.damage(10, 'generic'))
      expect(await health(page), 'Resistance VI must clamp at zero damage, not go negative')
        .toBeCloseTo(10, 4)
    })

  /*
   * ABSORPTION IS SPENT AFTER EVERY REDUCTION AND BEFORE HEALTH, which is
   * where actuallyHurt puts it. A hit smaller than the shield must cost no
   * health at all and must still register as a hit.
   */
  test('Absorption I is 4 half-hearts eaten before health, and evaporates on expiry',
    async ({ page }) => {
      await give(page, 'absorption', 60, 0)
      expect(await page.evaluate(() => window.game.survival.absorption),
        'Absorption I grants 4').toBe(4)

      await setHealth(page, 20)
      await page.evaluate(() => window.game.survival.damage(3, 'generic'))
      expect(await health(page), 'a 3 hit into a 4 shield must cost no health')
        .toBeCloseTo(20, 4)
      expect(await page.evaluate(() => window.game.survival.absorption)).toBeCloseTo(1, 4)

      await page.evaluate(() => window.game.survival.damage(3, 'generic'))
      expect(await health(page), 'the 2 that got past a 1 shield').toBeCloseTo(18, 4)

      await page.evaluate(() => window.game.effects.clearAll())
      expect(await page.evaluate(() => window.game.survival.absorption),
        'the shield does not survive the effect').toBe(0)
    })

  test('Health Boost raises the ceiling without granting health, and clamps you down on expiry',
    async ({ page }) => {
      await setHealth(page, 20)
      await give(page, 'health_boost', 60, 0)
      expect(await page.evaluate(() => window.game.survival.maxHealth),
        'Health Boost I is +4 max').toBe(24)
      expect(await health(page), 'it grants NO health -- you are 20/24').toBe(20)

      await page.evaluate(() => window.game.survival.heal(10))
      expect(await health(page), 'now you can be healed past 20').toBe(24)

      await page.evaluate(() => window.game.effects.clearAll())
      expect(await health(page), 'the bonus hearts are lost, not kept').toBe(20)
      expect(await page.evaluate(() => window.game.survival.dead),
        'the clamp must never be a death').toBe(false)
    })

  test('Instant Health and Instant Damage double per level and are never stored',
    async ({ page }) => {
      await setHealth(page, 4)
      await give(page, 'instant_health', 1, 0)
      expect(await health(page), 'Instant Health I heals 4').toBe(8)
      await give(page, 'instant_health', 1, 1)
      expect(await health(page), 'Instant Health II heals 8').toBe(16)

      await setHealth(page, 20)
      await give(page, 'instant_damage', 1, 0)
      expect(await health(page), 'Instant Damage I deals 6').toBeCloseTo(14, 4)

      const icons = await page.evaluate(() =>
        window.game.effects.active(window.noa.playerEntity).map(i => i.key))
      expect(icons, 'an instant effect is never an active instance').toEqual([])
    })

  test('Fire Resistance stops the burn as well as the damage', async ({ page }) => {
    await give(page, 'fire_resistance', 60, 0)
    await page.evaluate(() => window.game.survival.ignite(8))
    expect(await page.evaluate(() => window.game.survival.burning),
      'fire resistance must stop you catching fire at all').toBe(false)
    await setHealth(page, 20)
    await page.evaluate(() => window.game.survival.damage(4, 'lava'))
    expect(await health(page), 'and must zero fire damage').toBeCloseTo(20, 4)
    // It is resistance to FIRE, not to everything.
    await page.evaluate(() => window.game.survival.damage(4, 'fall'))
    expect(await health(page), 'and must not stop a fall').toBeCloseTo(16, 4)
  })

  test('Jump Boost raises the safe fall distance by a block a level', async ({ page }) => {
    const plain = await page.evaluate(() =>
      window.game.effects.safeFallBlocks(window.noa.playerEntity))
    await give(page, 'jump_boost', 60, 1)
    const boosted = await page.evaluate(() =>
      window.game.effects.safeFallBlocks(window.noa.playerEntity))
    expect(plain, `base safe fall was ${plain}`).toBe(3)
    expect(boosted, `Jump Boost II safe fall was ${boosted}, vanilla 5`).toBe(5)
  })

  test('Water Breathing freezes the air meter instead of refilling it', async ({ page }) => {
    await page.evaluate(() => window.game.survival.breathe(4, true))
    const drained = await page.evaluate(() => window.game.survival.air)
    expect(drained, `four seconds under water left ${drained} of 300 ticks`).toBeLessThan(300)

    await give(page, 'water_breathing', 60, 0)
    await page.evaluate(() => window.game.survival.breathe(4, true))
    expect(await page.evaluate(() => window.game.survival.air),
      'Water Breathing holds the meter rather than topping it up').toBe(drained)
  })
})

test.describe('re-application', () => {
  test('a weaker instance does not displace a stronger one', async ({ page }) => {
    expect(await give(page, 'speed', 60, 1), 'Speed II lands').toBe(true)
    expect(await give(page, 'speed', 60, 0), 'Speed I on top of Speed II is refused').toBe(false)
    const lv = await page.evaluate(() =>
      window.game.effects.level(window.noa.playerEntity, 'speed'))
    expect(lv, `level after the weaker application was ${lv}`).toBe(2)

    expect(await give(page, 'speed', 60, 2), 'Speed III does displace it').toBe(true)
    expect(await page.evaluate(() =>
      window.game.effects.level(window.noa.playerEntity, 'speed'))).toBe(3)
  })

  test('an equal amplifier wins only on a longer duration', async ({ page }) => {
    await give(page, 'speed', 60, 0)
    expect(await give(page, 'speed', 10, 0), 'shorter is refused').toBe(false)
    expect(await give(page, 'speed', 120, 0), 'longer replaces').toBe(true)
  })

  test('an expiring effect removes itself', async ({ page }) => {
    await give(page, 'speed', 1, 0)
    expect(await page.evaluate(() =>
      window.game.effects.has(window.noa.playerEntity, 'speed'))).toBe(true)
    await page.waitForTimeout(1600)
    await waitTicks(page, 2)
    expect(await page.evaluate(() =>
      window.game.effects.has(window.noa.playerEntity, 'speed')),
    'a one-second effect is gone after 1.6 s').toBe(false)
    expect(await page.evaluate(() => window.game.move.maxSpeed),
      'and the speed goes back with it').toBeCloseTo(WALK, 3)
  })
})

test.describe('effects reach Evan, not only the player', () => {
  /*
   * The water-drag and jump fixes both had to be extended past
   * noa.playerEntity, and this is the same shape -- so it is asserted rather
   * than assumed. Evan has no health model, so what is proved here is the half
   * that is a property of a BODY: the instance is stored against his id, the
   * movement multiplier answers for him, and the swirl treats him as affected.
   */
  const evan = (page) => page.evaluate(() => {
    const ids = window.noa.ents.getStatesList(window.noa.ents.names.physics)
      .map(s => s.__id).filter(id => id !== window.noa.playerEntity)
    return ids[0] ?? null
  })

  test('Speed II on Evan is stored against his entity and answers his multiplier',
    async ({ page }) => {
      const id = await evan(page)
      expect(id, 'there is a second body in the world to test with').not.toBeNull()

      const applied = await page.evaluate((e) =>
        window.game.effects.give(e, 'speed', 60, 1), id)
      expect(applied).toBe(true)

      const [lv, mult, playerMult, affected] = await page.evaluate((e) => [
        window.game.effects.level(e, 'speed'),
        window.game.effects.speedMultiplier(e),
        window.game.effects.speedMultiplier(window.noa.playerEntity),
        window.game.effects.affected,
      ], id)

      expect(lv, `Evan's speed level was ${lv}`).toBe(2)
      expect(mult, `Evan's multiplier was ${mult}`).toBeCloseTo(1.4, 6)
      expect(playerMult, 'and the player is untouched by it').toBe(1)
      expect(affected, 'Evan is in the affected set').toContain(id)

      await page.evaluate((e) => window.game.effects.clear(e), id)
    })

  test('Slow Falling changes Evan\'s gravity multiplier, not just the player\'s',
    async ({ page }) => {
      const id = await evan(page)
      await page.evaluate((e) => window.game.effects.give(e, 'slow_falling', 60, 0), id)
      // Wait for the movement tick that writes gravityMultiplier onto bodies.
      await waitTicks(page, 3)
      const g = await page.evaluate((e) =>
        window.noa.ents.getPhysics(e).body.gravityMultiplier, id)
      expect(g, `Evan's gravityMultiplier was ${g}, vanilla 0.01/0.08 = 0.125`)
        .toBeCloseTo(0.125, 4)
      await page.evaluate((e) => window.game.effects.clear(e), id)
    })
})

test.describe('the HUD', () => {
  test('icons land in vanilla\'s two rows, and NEUTRAL sits with HARMFUL',
    async ({ page }) => {
      await give(page, 'speed', 120, 1)
      await give(page, 'regeneration', 120, 0)
      await give(page, 'poison', 120, 0)
      await give(page, 'glowing', 120, 0)
      await waitTicks(page, 2)

      const rows = await page.evaluate(() => [
        window.game.effectHud.rowKeys(0),
        window.game.effectHud.rowKeys(1),
      ])
      expect(rows[0].sort(), `beneficial row held ${rows[0]}`)
        .toEqual(['regeneration', 'speed'])
      // The trap: glowing is NEUTRAL, and vanilla splits on isBeneficial()
      // rather than on "not harmful", so it belongs in the bottom row.
      expect(rows[1].sort(), `second row held ${rows[1]}`)
        .toEqual(['glowing', 'poison'])
    })

  test('hideParticles hides the icon too', async ({ page }) => {
    await give(page, 'speed', 120, 0, true)
    await waitTicks(page, 2)
    expect(await page.evaluate(() => window.game.effectHud.count),
      'a hidden effect draws no icon').toBe(0)
    expect(await page.evaluate(() =>
      window.game.effects.has(window.noa.playerEntity, 'speed')),
    'but it is still active').toBe(true)
  })

  test('the icon row, several effects deep', async ({ page }) => {
    await give(page, 'speed', 120, 1)
    await give(page, 'jump_boost', 120, 2)
    await give(page, 'regeneration', 120, 0)
    await give(page, 'fire_resistance', 120, 0)
    await give(page, 'poison', 120, 1)
    await give(page, 'wither', 120, 0)
    await give(page, 'glowing', 120, 0)
    await waitTicks(page, 3)

    const count = await page.evaluate(() => window.game.effectHud.count)
    expect(count, `${count} icons drawn`).toBe(7)
    await shotRegion(page, '79-effect-hud', { x: 940, y: 0, width: 340, height: 120 })
  })
})

test.describe('the swirl', () => {
  /*
   * ASSERT THE SAMPLE IS NON-EMPTY BEFORE ASSERTING ANYTHING ABOUT IT.
   *
   * A colour check over an empty particle list passes vacuously and reports
   * green on a swirl that never spawned, which is exactly the failure this
   * repo has shipped before. So the count is asserted first and separately,
   * and the colour assertion runs over a list that has already been proved to
   * have things in it.
   */
  /*
   * EVERY TEST IN HERE DRAINS THE POOL FIRST. Motes outlive the effect that
   * spawned them, so without this a swirl assertion is partly about the
   * previous test -- which is exactly how the lifetime bug in effectSwirl.js
   * was found: a poison spec sampling a Speed mote.
   */
  const drain = (page) =>
    page.waitForFunction(() => window.game.effectSwirl.live === 0,
      null, { timeout: 8000 })

  test('an affected player emits motes in the effect\'s own colour', async ({ page }) => {
    await drain(page)
    await give(page, 'poison', 120, 0)
    // 1-in-4 per Minecraft tick, scaled to noa's 30 Hz: about five a second,
    // living up to two. Three seconds is a dozen or so.
    await page.waitForTimeout(3000)

    const live = await page.evaluate(() => window.game.effectSwirl.live)
    expect(live, `the swirl produced ${live} motes in 3 s`).toBeGreaterThan(0)

    const colors = await page.evaluate(() => window.game.effectSwirl.colors())
    expect(colors.length, 'sample is non-empty').toBeGreaterThan(0)
    // Poison is 0x87A363 -- a pale olive, NOT the vivid green everyone
    // remembers. 0x87/255 = 0.529, 0xA3/255 = 0.639, 0x63/255 = 0.388.
    for (const [r, g, b] of colors) {
      expect(r, `mote red was ${r.toFixed(3)}, poison is 0.529`).toBeCloseTo(0.529, 2)
      expect(g, `mote green was ${g.toFixed(3)}, poison is 0.639`).toBeCloseTo(0.639, 2)
      expect(b, `mote blue was ${b.toFixed(3)}, poison is 0.388`).toBeCloseTo(0.388, 2)
    }
  })

  test('two effects interleave two colours rather than averaging to one',
    async ({ page }) => {
      await drain(page)
      await give(page, 'poison', 120, 0)
      await give(page, 'fire_resistance', 120, 0)

      /*
       * SAMPLED OVER TIME, not in one frame. Five motes a second living under
       * two seconds means the live pool at any instant is a handful, and a
       * single snapshot that happened to catch three of one colour would fail
       * a test about interleaving for a reason that has nothing to do with
       * interleaving. Polling accumulates the population the effect actually
       * produced.
       */
      const colors = []
      for (let i = 0; i < 20; i++) {
        colors.push(...await page.evaluate(() => window.game.effectSwirl.colors()))
        await page.waitForTimeout(250)
      }
      expect(colors.length, 'sample is non-empty').toBeGreaterThan(10)
      // Fire Resistance is 0xFF9900, red channel 1.0; poison's is 0.529.
      // A weighted average -- the pre-1.21 rule -- would emit ONE colour
      // somewhere in between and this would find two identical values.
      const reds = new Set(colors.map(([r]) => r.toFixed(3)))
      expect([...reds], `mote reds seen: ${[...reds]}`).toHaveLength(2)
    })

  test('hideParticles suppresses the swirl', async ({ page }) => {
    /*
     * DRAIN THE POOL FIRST. Motes outlive the effect that spawned them by up
     * to two seconds, so a previous test's swirl is still in the air when this
     * one starts -- and "expected 0, received 2" is that, not a bug in
     * hideParticles. Waiting for the count to reach zero is what makes the
     * assertion below about THIS test.
     */
    await drain(page)
    await give(page, 'poison', 120, 0, true)
    await page.waitForTimeout(2000)
    expect(await page.evaluate(() => window.game.effectSwirl.live),
      'a hidden effect emits nothing').toBe(0)
  })

  test('the swirl, seen in third person', async ({ page }) => {
    await drain(page)
    await give(page, 'poison', 600, 0)
    await give(page, 'fire_resistance', 600, 0)
    // Third person, so the player's own body is on screen for the motes to
    // wrap. First person would photograph the inside of the swirl.
    await page.keyboard.press('F5')
    await page.waitForTimeout(3000)
    const live = await page.evaluate(() => window.game.effectSwirl.live)
    expect(live, `${live} motes in flight for the screenshot`).toBeGreaterThan(0)
    await shot(page, '79-effect-swirl')
    await page.keyboard.press('F5')
    await page.keyboard.press('F5')
  })
})

test.describe('/effect', () => {
  test('it is a cheat command and a guest cannot see or run it', async ({ page }) => {
    const before = await page.evaluate(() => window.game.commands.names)
    expect(before, 'the guest command list must not grow').not.toContain('effect')
    const out = await chatCommand(page, '/effect give speed 30 1')
    expect(text(out), `chat said: ${text(out)}`).toMatch(/permission|Unknown/i)
  })

  test('an operator gets vanilla\'s wording, including the roman numeral',
    async ({ page }) => {
      await chatCommand(page, `/op ${OP_PASSPHRASE}`)
      const out = await chatCommand(page, '/effect give speed 30 1')
      expect(text(out), `chat said: ${text(out)}`)
        .toMatch(/Applied effect Speed II/)
      expect(await page.evaluate(() =>
        window.game.effects.level(window.noa.playerEntity, 'speed'))).toBe(2)

      const cleared = await chatCommand(page, '/effect clear speed')
      expect(text(cleared)).toMatch(/Removed effect Speed/)
      expect(await page.evaluate(() =>
        window.game.effects.has(window.noa.playerEntity, 'speed'))).toBe(false)
      await chatCommand(page, '/deop')
    })

  test('level I is printed without a numeral, and infinite never counts down',
    async ({ page }) => {
      await chatCommand(page, `/op ${OP_PASSPHRASE}`)
      const out = await chatCommand(page, '/effect give speed 30')
      expect(text(out), `chat said: ${text(out)}`)
        .toMatch(/Applied effect Speed(?! I)/)

      await chatCommand(page, '/effect clear')
      await chatCommand(page, '/effect give night_vision infinite')
      const ticks = await page.evaluate(() =>
        window.game.effects.instance(window.noa.playerEntity, 'night_vision').ticks)
      await page.waitForTimeout(1200)
      const after = await page.evaluate(() =>
        window.game.effects.instance(window.noa.playerEntity, 'night_vision').ticks)
      expect(ticks, 'infinite is stored as the -1 sentinel').toBe(-1)
      expect(after, 'and does not count down').toBe(-1)
      await chatCommand(page, '/effect clear')
      await chatCommand(page, '/deop')
    })

  test('bad arguments are refused in vanilla\'s words', async ({ page }) => {
    await chatCommand(page, `/op ${OP_PASSPHRASE}`)
    const unknown = await chatCommand(page, '/effect give wobbliness 30')
    expect(text(unknown)).toMatch(/Unknown effect/)
    const badAmp = await chatCommand(page, '/effect give speed 30 900')
    expect(text(badAmp)).toMatch(/between 0 and 255/)
    const badSecs = await chatCommand(page, '/effect give speed 0')
    expect(text(badSecs)).toMatch(/between 1 and 1000000/)
    const nothing = await chatCommand(page, '/effect clear')
    expect(text(nothing)).toMatch(/no effects to remove/)
    await chatCommand(page, '/deop')
  })
})
