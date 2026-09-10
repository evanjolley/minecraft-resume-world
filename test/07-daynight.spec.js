import { test, expect } from './fixtures.js'
import { measureClockRate, waitTicks } from './helpers/world.js'
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
