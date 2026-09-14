import { test, expect } from './fixtures.js'
import {
  grantOp, look, HEADING, measureSpeed, teleport, waitTicks,
} from './helpers/world.js'

/*
 * Water and lava.
 *
 * Minecraft's own numbers, restated here rather than imported from
 * src/physics.js for the reason 02-physics gives: a test that imports the
 * constant it is checking asserts only that arithmetic is deterministic. These
 * come from LivingEntity.travel, Entity.baseTick and Entity.lavaHurt, and the
 * derivations are written out in src/fluids.js.
 */
const MC = {
  // Terminal vertical speeds. Sinking is gravity/16 against 0.8 retention;
  // rising adds jumpInLiquid's flat 0.04 on top of it.
  WATER_SINK: 0.5,
  WATER_RISE: 3.5,
  LAVA_SINK: 0.8,
  // `v' = 0.8(v + 0.02)` settles at 0.1 b/tick. The wiki's measured figure for
  // a partly submerged player is 1.97, which this is inside tolerance of.
  SWIM: 2.0,

  // Entity.getMaxAirSupply, and the -20 the counter reaches before the first hit.
  AIR_SECONDS: 15,
  DROWN_AT_SECONDS: 16,
  DROWN_DAMAGE: 2,
  AIR_REFILL_SECONDS: 3.75,

  // Entity.lavaHurt: 4 health, let through every 10 ticks by the i-frame rule.
  LAVA_DPS: 8,
  BURN_SECONDS: 15,
  FIRE_DPS: 1,
}

// Same 1.5% as 02-physics for the speeds, and the same reasoning: noa
// integrates continuously against Minecraft's fixed 20 Hz, so equality is not
// reachable and 1.5% still rejects a wrong constant.
const TOL = 0.015
const near = (actual, want, tol = TOL) => Math.abs(actual - want) <= want * tol

/*
 * A block of fluid in mid-air, which is a perfectly good pool: nothing here
 * simulates flow, so a floating cube of water is as still as a lake.
 *
 * Built well above the terrain (y 200+) rather than by flooding a hole in it.
 * Digging would mean 200 broken voxels for the terrain fixture to put back,
 * and the surface at y=135 is where half the other specs stand.
 *
 * Moved up from y=90 with the imported world: the patch runs from bedrock at
 * y=-64 to a peak at y=177, so the old "mid-air" altitude is now solid rock.
 * 200 is above everything and still inside noa's vertical load range from
 * spawn, so authority.requestFill actually lands.
 */
async function pool(page, terrain, kind, [x0, y0, z0], [x1, y1, z1]) {
  await grantOp(page)
  await terrain.keep([x0, y0, z0], [x1, y1, z1])
  await page.evaluate(async ([k, from, to]) => {
    const id = window.game.fluids.ids[k]
    await window.game.authority.requestFill({ from, to, id })
  }, [kind, [x0, y0, z0], [x1, y1, z1]])
  await page.evaluate(async () => { await window.game.authority.requestDeop() })
}

/**
 * Terminal vertical speed, blocks/second, positive up.
 *
 * Both endpoints are sampled inside a tick handler for exactly the reason
 * measureSpeed documents at length: noa runs physics and then emits 'tick', so
 * arming between ticks reads the previous tick's position against this tick's
 * clock and biases the ratio by up to a whole tick of travel.
 */
function measureVerticalSpeed(page, ms = 800) {
  return page.evaluate((window_ms) => new Promise((resolve) => {
    const noa = window.noa
    const y = () => noa.ents.getPositionData(noa.playerEntity).position[1]
    let y0 = 0, t0 = 0, armed = false
    const fn = () => {
      if (!armed) { y0 = y(); t0 = performance.now(); armed = true; return }
      const dt = performance.now() - t0
      if (dt < window_ms) return
      noa.off('tick', fn)
      resolve(((y() - y0) / dt) * 1000)
    }
    noa.on('tick', fn)
  }), ms)
}

const health = (page) => page.evaluate(() => window.game.survival.health)

/*
 * Drive the breath and burn clocks directly instead of standing in water for
 * sixteen seconds.
 *
 * This is not a shortcut around the real code -- `breathe` and `lavaBurn` are
 * the same functions fluids.js calls every tick, with the same argument. What
 * it skips is WALL CLOCK, and only that: sixteen seconds of drowning plus
 * fifteen of burning is half a minute of a five-minute suite, per assertion.
 * The specs that measure movement do use real time in real water, because
 * there is nothing to drive there.
 *
 * THE WHOLE SEQUENCE RUNS INSIDE ONE evaluate, and that is the part worth
 * knowing. fluids.js calls `breathe(dt, false)` on every real tick, refilling
 * four air per tick -- so a test that drives fifteen seconds, awaits a
 * checkpoint, then drives more, hands the engine 50-100 ms of wall clock in
 * between and gets a dozen ticks of breath back for free. It read as a
 * boundary that moved: green run alone, red in the suite, on identical
 * arithmetic. A synchronous loop cannot be interrupted by the tick loop, so
 * the checkpoints come back from inside it instead.
 */
const breathTrace = (page, steps, step = 0.05) =>
  page.evaluate(([list, dt]) => {
    const s = window.game.survival
    const row = document.getElementById('air-row')
    return list.map(([total, submerged]) => {
      for (let t = 0; t < total - 1e-9; t += dt) s.breathe(Math.min(dt, total - t), submerged)
      return {
        air: s.air,
        health: s.health,
        rowVisible: row.style.display !== 'none',
        bubbles: [...row.children].filter(b => b.style.display !== 'none').length,
      }
    })
  }, [steps, step])

test.describe('fluid blocks', () => {
  test('water and lava are fluids the engine will not let you touch', async ({ page }) => {
    const flags = await page.evaluate(() => {
      const r = window.noa.registry
      const { water, lava } = window.game.fluids.ids
      const of = (id) => ({
        fluid: r.getBlockFluidity(id),
        solid: r.getBlockSolidity(id),
        opaque: r.getBlockOpacity(id),
        targetable: window.noa.blockTargetIdCheck(id),
      })
      return { water: of(water), lava: of(lava) }
    })

    // Non-solid is what lets you fall in; not targetable is what stops the
    // crosshair raycast ever naming one, which is what makes them unminable
    // and unplaceable without a single special case in interact.js.
    expect(flags.water).toEqual({ fluid: true, solid: false, opaque: false, targetable: false })
    // Lava is opaque on purpose -- vanilla renders it on the solid layer, so
    // you cannot see the stone through a lava lake.
    expect(flags.lava).toEqual({ fluid: true, solid: false, opaque: true, targetable: false })
  })

  test('there is no water or lava item, the way there is none in Minecraft',
    async ({ page }) => {
      // Vanilla has a bucket, not a fluid item. If these ever resolve, the
      // creative inventory has two blocks in it that place a lake by hand.
      const found = await page.evaluate(() => {
        try { return [window.game.itemId('water'), window.game.itemId('lava')] }
        catch (e) { return e.message }
      })
      expect(found).toContain('no such item')
    })
})

test.describe('swimming', () => {
  /*
   * A 3x3 shaft, 24 deep, high above the island. Three wide because noa's
   * applyFluidForces samples the fluid at the player box's MIN corner rather
   * than at its centre, so a one-wide column would drop out of the test the
   * moment the player drifted a tenth of a block.
   */
  const SHAFT_MIN = [10, 200, 10]
  const SHAFT_MAX = [12, 223, 12]
  const SHAFT_TOP = [11.5, 220, 11.5]

  test('you sink at Minecraft\'s rate rather than falling', async ({ page, terrain }) => {
    await pool(page, terrain, 'water', SHAFT_MIN, SHAFT_MAX)
    await teleport(page, ...SHAFT_TOP)
    /*
     * Long enough for the exponential to actually settle. The time constant is
     * 1/drag = 0.28 s, and the measurement is a MEAN over its window, so a
     * warmup of two or three of them is not enough -- the first version used
     * 0.6 s on the climb below and read 3.40 against 3.50, which is the tail
     * of the ramp being averaged in, not a wrong constant. Five time constants
     * each side puts the whole window inside half a percent of terminal.
     */
    await page.waitForTimeout(1500)

    const v = await measureVerticalSpeed(page, 1500)
    expect(await page.evaluate(() => window.game.fluids.feet)).toBe('water')
    expect(near(-v, MC.WATER_SINK), `sank at ${(-v).toFixed(3)} b/s vs ${MC.WATER_SINK}`)
      .toBe(true)
  })

  test('holding jump swims up', async ({ page, terrain }) => {
    await pool(page, terrain, 'water', SHAFT_MIN, SHAFT_MAX)
    // Near the bottom of the shaft: 3 s of climbing at 3.5 b/s is 10 blocks,
    // and the shaft is 24 deep.
    await teleport(page, 11.5, 201, 11.5)
    await page.keyboard.down('Space')
    try {
      await page.waitForTimeout(1500)
      const v = await measureVerticalSpeed(page, 1500)
      expect(near(v, MC.WATER_RISE), `rose at ${v.toFixed(3)} b/s vs ${MC.WATER_RISE}`).toBe(true)
    } finally {
      await page.keyboard.up('Space')
    }
  })

  test('swimming forward is less than half walking speed', async ({ page, terrain }) => {
    // A 24-long trough, 3 wide and 5 deep. The player sinks half a block per
    // second while swimming, so the depth is what keeps them in it.
    await pool(page, terrain, 'water', [-12, 205, -1], [12, 209, 1])
    await teleport(page, -11.5, 207, 0.5)
    await look(page, { heading: HEADING.eastPlusX })

    const v = await measureSpeed(page, ['KeyW'], { warmupMs: 1200, sampleMs: 1000 })
    expect(await page.evaluate(() => window.game.fluids.feet)).toBe('water')
    expect(near(v, MC.SWIM), `swam at ${v.toFixed(3)} b/s vs ${MC.SWIM}`).toBe(true)
  })

  test('lava is four times as thick as water', async ({ page, terrain }) => {
    await pool(page, terrain, 'lava', SHAFT_MIN, SHAFT_MAX)
    // Creative, or the 8 health a second kills the player mid-measurement.
    await page.evaluate(async () => {
      const a = window.game.authority
      await a.requestOp('diamond-pickaxe')
      await a.requestGamemode('creative')
    })
    await teleport(page, ...SHAFT_TOP)
    await page.waitForTimeout(1000)

    const v = await measureVerticalSpeed(page, 1500)
    expect(near(-v, MC.LAVA_SINK), `sank at ${(-v).toFixed(3)} b/s vs ${MC.LAVA_SINK}`).toBe(true)
  })

  test('falling into water cancels the fall damage entirely', async ({ page, terrain }) => {
    // 40 blocks of drop is 37 past the 3-block safe distance, which is nearly
    // twice a full health bar. Landing on the island instead would be fatal.
    await pool(page, terrain, 'water', [20, 200, 20], [22, 206, 22])
    await teleport(page, 21.5, 228, 21.5)
    await page.waitForFunction(() => window.game.fluids.feet === 'water', null, { timeout: 10_000 })
    await waitTicks(page, 10)
    expect(await health(page)).toBe(20)
  })
})

test.describe('breath', () => {
  test('the air meter lasts 15 seconds, then drowns you at 2 a second',
    async ({ page }) => {
      /*
       * Checkpoints straddle 16 s rather than landing on it. The boundary is
       * exact in Minecraft because air is an integer tick count; here it is
       * summed from a floating-point dt, so a step ending at exactly -20 falls
       * either side of `<=` depending on rounding. 15.9 s must not hurt and
       * 16.1 s must, which is the claim worth making anyway.
       */
      const [t14, t155, t159, t161, t172] = await breathTrace(page, [
        [14, true], [1.5, true], [0.4, true], [0.2, true], [1.1, true],
      ])

      // One second short of empty: still a sliver of bar, still no damage.
      expect(t14.air).toBeGreaterThan(0)
      expect(t14.health).toBe(20)

      // Past 15 the bar is empty, and vanilla still gives you a second of
      // grace. This is the assertion that catches "damage when the bar
      // empties", which is the obvious and wrong reading.
      expect(t155.air).toBe(0)
      expect(t155.health).toBe(20)
      expect(t159.health).toBe(20)

      expect(t161.health).toBe(20 - MC.DROWN_DAMAGE)
      // And once a second after that, because the counter resets to 0 rather
      // than to -20.
      expect(t172.health).toBe(20 - MC.DROWN_DAMAGE * 2)
    })

  test('air comes back four times faster than it goes', async ({ page }) => {
    // increaseAirSupply is +4 a tick against -1, so 15 seconds of held breath
    // is 3.75 seconds of recovery.
    const [empty, partial, full] = await breathTrace(page, [
      [MC.AIR_SECONDS, true],
      [MC.AIR_REFILL_SECONDS - 0.5, false],
      [0.6, false],
    ])

    expect(empty.air).toBe(0)
    expect(partial.air).toBeGreaterThan(0)
    expect(partial.air).toBeLessThan(300)
    expect(full.air).toBe(300)
  })

  test('the bubble row is hidden at a full meter and appears as it drains',
    async ({ page }) => {
      const [fresh, half, gone] = await breathTrace(page, [
        [0, true], [7.5, true], [8, true],
      ])

      expect(fresh).toMatchObject({ rowVisible: false, bubbles: 10 })

      // Half the meter gone is five bubbles left, the same way half health is
      // five hearts. The count includes the one mid-pop, which is why 7.5 s in
      // it can be six rather than five.
      expect(half.rowVisible).toBe(true)
      expect(half.bubbles).toBeGreaterThanOrEqual(5)
      expect(half.bubbles).toBeLessThanOrEqual(6)

      expect(gone.bubbles).toBe(0)
    })
})

test.describe('lava', () => {
  test('lava deals 8 a second, not 4', async ({ page }) => {
    /*
     * The number worth a test of its own. Entity.lavaHurt is 4 damage and the
     * wiki sentence everyone half-remembers is "4 damage" -- but hurt()'s
     * i-frames let an equal hit through after 10 of the 20 ticks, so it lands
     * twice a second. A player in lava has two and a half seconds to live.
     */
    // One synchronous second, for the same reason breathTrace is synchronous.
    await page.evaluate(() => {
      for (let t = 0; t < 1 - 1e-9; t += 0.05) window.game.survival.lavaBurn(0.05)
    })
    expect(await health(page)).toBe(20 - MC.LAVA_DPS)
  })

  test('lava sets you on fire for 15 seconds after you climb out',
    async ({ page }) => {
      await page.evaluate(() => window.game.survival.lavaBurn(0.05))
      expect(await page.evaluate(() => window.game.survival.burning)).toBe(true)

      /*
       * Out of the lava, burning takes over at 1 a second for 15 seconds.
       * Real ticks here rather than a driven clock, because the fire countdown
       * is survival's own tick handler -- driving it would test nothing.
       *
       * WAITED IN TICKS, NOT MILLISECONDS, and for the reason measureSpeed
       * spells out at length in helpers/world.js: survival.js's fire handler
       * is `noa.on('tick', dt)` with noa's FIXED dt of 1000/tickRate, so two
       * and a half seconds of burning is 75 ticks of simulated time and not
       * 2500 ms of the laptop's. Those used to be the same number. With a
       * 250-block-tall world of real terrain to mesh, a swiftshader frame can
       * stall the tick loop long enough that 2.5 s of wall clock contains 60
       * ticks, and the test read one point of damage for a burn that was
       * running exactly to spec. The claim is unchanged -- 1 damage a second
       * of game time -- only the ruler is.
       */
      const r = await page.evaluate(() => new Promise((resolve) => {
        const noa = window.noa
        const s = window.game.survival
        // Read the start health INSIDE the same round trip that arms the
        // counter. Reading it over CDP first and arming second leaves a gap of
        // unknown length in which the fire can tick, so the window measured is
        // not the window asserted -- the same class of error measureSpeed
        // documents, and the reason breathTrace is synchronous too.
        const h0 = s.health
        let ticks = 0
        const want = Math.round(2.5 * noa.tickRate)
        const fn = () => {
          if (++ticks < want) return
          noa.off('tick', fn)
          resolve({ lost: h0 - s.health, ticks, dead: s.dead })
        }
        noa.on('tick', fn)
      }))
      const lost = r.lost
      expect(lost, `burned for ${lost} over ${r.ticks} ticks`
        + ` (2.5 s of game time) at ${MC.FIRE_DPS}/s, dead=${r.dead}`)
        .toBeGreaterThanOrEqual(2)
      expect(lost).toBeLessThanOrEqual(3)
      expect(await page.evaluate(() => window.game.survival.burning)).toBe(true)
    })

  test('water puts you out', async ({ page, terrain }) => {
    await page.evaluate(() => window.game.survival.lavaBurn(0.05))
    expect(await page.evaluate(() => window.game.survival.burning)).toBe(true)

    await pool(page, terrain, 'water', [30, 200, 30], [32, 204, 32])
    await teleport(page, 31.5, 202, 31.5)
    await page.waitForFunction(() => window.game.fluids.feet === 'water', null, { timeout: 10_000 })
    await waitTicks(page, 3)
    expect(await page.evaluate(() => window.game.survival.burning)).toBe(false)

    /*
     * And stays out: no fire damage over the two seconds that would otherwise
     * have cost two health. Natural regeneration is turned off first, or this
     * measures a player healing back up and reads as a pass for the wrong
     * reason -- and at full food it heals every four seconds, so a two-second
     * window catches it about half the time.
     */
    await page.evaluate(async () => {
      const a = window.game.authority
      await a.requestOp('diamond-pickaxe')
      await a.requestGamerule('naturalRegeneration', 'false')
      await a.requestDeop()
    })
    const before = await health(page)
    await page.waitForTimeout(2000)
    expect(await health(page)).toBe(before)
  })
})
