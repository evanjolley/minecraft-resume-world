import { test, expect } from './fixtures.js'
import {
  measureClockRate, waitTicks, teleport, look, HEADING, SURFACE_Y,
} from './helpers/world.js'
import { shot } from './helpers/shots.js'

/* Minecraft: 24000 ticks per day at 20 ticks/sec = a 20 minute day. */
const TICKS_PER_SECOND = 20
const TICKS_PER_DAY = 24000

test.describe('day/night cycle', () => {
  test('the clock advances at Minecraft 20 ticks per second', async ({ page }) => {
    // Sampled over 3 s. Shorter and one stalled software-GL frame skews it;
    // longer and it dominates the suite runtime for a number that is stable.
    const rate = await measureClockRate(page, 3000)
    expect(rate, `clock ran at ${rate.toFixed(2)} ticks/sec`)
      .toBeGreaterThan(TICKS_PER_SECOND * 0.95)
    expect(rate, `clock ran at ${rate.toFixed(2)} ticks/sec`)
      .toBeLessThan(TICKS_PER_SECOND * 1.05)
  })

  test('a full day is 24000 ticks and the clock wraps rather than growing',
    async ({ page }) => {
      expect(await page.evaluate(() => window.game.sky.TICKS_PER_DAY)).toBe(TICKS_PER_DAY)

      await page.evaluate((d) => window.game.sky.setTime(d - 5), TICKS_PER_DAY)
      await waitTicks(page, 20)
      const t = await page.evaluate(() => window.game.sky.getTime())
      expect(t, `time was ${t} after crossing midnight`).toBeLessThan(TICKS_PER_DAY)
      expect(t).toBeGreaterThanOrEqual(0)
    })

  test('setTime normalises a negative or out-of-range tick count', async ({ page }) => {
    // The /time command hands this whatever the player typed.
    const t = await page.evaluate((d) => {
      window.game.sky.setTime(-1000)
      const a = window.game.sky.getTime()
      window.game.sky.setTime(d * 3 + 500)
      return [a, window.game.sky.getTime()]
    }, TICKS_PER_DAY)
    expect(t[0]).toBe(TICKS_PER_DAY - 1000)
    expect(t[1]).toBe(500)
  })

  test('the sky colour actually changes between noon and midnight', async ({ page }) => {
    const read = () => page.evaluate(() =>
      [...window.noa.rendering.getScene().clearColor.asArray()])

    await page.evaluate(() => window.game.sky.setTime(6000))
    await waitTicks(page, 3)
    const noon = await read()

    await page.evaluate(() => window.game.sky.setTime(18000))
    await waitTicks(page, 3)
    const midnight = await read()

    // Derived from sun elevation, so this is really "is the whole lighting
    // chain wired to the clock" -- a frozen sky passes every other test here.
    expect(noon[2], `noon blue ${noon[2].toFixed(3)}`).toBeGreaterThan(0.8)
    expect(midnight[2], `midnight blue ${midnight[2].toFixed(3)}`).toBeLessThan(0.2)
  })

  test('night looks like night', async ({ page }) => {
    // Visual: moon placement, cloud dimming and the light direction all land
    // in the same frame and only read as right together.
    await page.evaluate(() => window.game.sky.setTime(18000))
    await waitTicks(page, 5)
    await shot(page, 'sky-midnight')
  })
})

/*
 * The cloud layer's MOTION, which is the part a screenshot cannot check.
 *
 * The bug these are here for: the layer used to be snapped to whole cells
 * when it recentred on the player, and the drift was wrapped at one cell too.
 * Both assume the cloud field repeats every cell. It repeats every 48. So
 * every cell boundary the player crossed -- and every 20 seconds regardless --
 * the whole sky stepped 12 blocks, backwards relative to the way you were
 * running. Measured before the fix: 11.98 blocks a step, six of them in nine
 * seconds of sprint-jumping.
 *
 * A position TRACE is the only thing that catches that. A screenshot of a
 * layer that teleports every second and a half looks exactly like a screenshot
 * of one that does not.
 */
test.describe('cloud layer', () => {
  /** Minecraft's 0.6 blocks/sec, west. */
  const DRIFT = -0.6

  /**
   * The layer's world position minus the player's, sampled every tick. The
   * DIFFERENCE is the thing the eye sees: the layer tracks the player, so its
   * world position moves with them and only this offset is the sky's own
   * motion.
   */
  const traceOffset = (page, ticks) => page.evaluate((n) => new Promise((resolve) => {
    const noa = window.noa
    const mesh = window.game.sky.clouds.mesh
    const g = [0, 0, 0]
    const out = []
    const t0 = performance.now()
    let left = n
    const fn = () => {
      // The mesh is positioned in noa's LOCAL frame, which is rebased as the
      // player travels. Reading mesh.position directly would report a jump
      // every rebase that no player ever sees.
      noa.localToGlobal([mesh.position.x, mesh.position.y, mesh.position.z], g)
      const p = noa.ents.getPositionData(noa.playerEntity).position
      out.push([g[0] - p[0], g[2] - p[2], p[0]])
      if (--left > 0) return
      noa.off('tick', fn)
      resolve({ out, secs: (performance.now() - t0) / 1000 })
    }
    noa.on('tick', fn)
  }), ticks)

  test('the layer never steps backwards, however many cell boundaries you cross',
    async ({ page, flatGround }) => {
      // 8 s of sprint-jumping is nearly 60 blocks and five 12-block cell
      // boundaries. Real terrain has no 60-block run, so build one -- the
      // claim under test is about the cloud layer, not about the ground.
      await flatGround.build({ length: 64 })
      await look(page, { heading: HEADING.westPlusX })
      await page.keyboard.down('KeyW')
      await page.keyboard.down('ControlLeft')
      await page.keyboard.down('Space')
      await page.waitForTimeout(400)
      const { out, secs } = await traceOffset(page, 240)
      for (const k of ['Space', 'ControlLeft', 'KeyW']) await page.keyboard.up(k)

      const travelled = out[out.length - 1][2] - out[0][2]
      expect(travelled, `player covered only ${travelled.toFixed(1)} blocks`
        + ' -- too few cell boundaries for this to prove anything')
        .toBeGreaterThan(24)

      // Per-tick: one tick of drift is 0.02 blocks. 0.1 is five of those, so
      // this passes through a stalled tick and still fails a 12-block step by
      // two orders of magnitude.
      let worst = 0
      for (let i = 1; i < out.length; i++) {
        const step = out[i][0] - out[i - 1][0]
        if (Math.abs(step) > Math.abs(worst)) worst = step
      }
      expect(worst, `worst per-tick step was ${worst.toFixed(4)} blocks`).toBeLessThan(0.005)
      expect(worst, `worst per-tick step was ${worst.toFixed(4)} blocks`).toBeGreaterThan(-0.1)

      // And the sum of those steps is still Minecraft's drift rate, so a layer
      // that simply froze to the player cannot pass.
      const rate = (out[out.length - 1][0] - out[0][0]) / secs
      expect(rate, `drifted at ${rate.toFixed(3)} b/s`).toBeGreaterThan(DRIFT * 1.2)
      expect(rate, `drifted at ${rate.toFixed(3)} b/s`).toBeLessThan(DRIFT * 0.8)

      // Z is pure tracking: nothing drifts north or south.
      const dz = Math.max(...out.map(o => Math.abs(o[1])))
      expect(dz, `layer wandered ${dz.toFixed(4)} blocks on z`).toBeLessThan(0.001)
    })

  test('the cloud field repeats at exactly the distance the drift wraps by',
    async ({ page }) => {
      /*
       * The drift offset is bounded by wrapping it, and a wrap moves the layer
       * a whole period sideways. It is invisible only because the field is
       * built periodic at that same period -- so the layer lands on a copy of
       * itself. That is the invariant, and it is checkable in a millisecond,
       * where WATCHING a wrap would mean sitting through 16 minutes of drift.
       */
      const r = await page.evaluate(() => {
        const c = window.game.sky.clouds
        let mismatches = 0
        for (let i = -200; i < 200; i++) {
          for (let j = -60; j < 60; j++) {
            if (c.cellAt(i, j) !== c.cellAt(i + c.periodCells, j)) mismatches++
          }
        }
        return {
          mismatches, offset: c.offset,
          period: c.period, periodCells: c.periodCells, cell: c.cell,
        }
      })
      expect(r.mismatches, `${r.mismatches} cells differ one period apart`).toBe(0)
      expect(r.period).toBe(r.periodCells * r.cell)
      // And the offset stays inside half a period, which is what the extra
      // cells on each end of the layer are sized for.
      expect(Math.abs(r.offset)).toBeLessThanOrEqual(r.period / 2)
    })
})
