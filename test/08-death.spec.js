import { test, expect } from './fixtures.js'
import { SURFACE_Y, teleport, position, waitTicks, settleOnGround } from './helpers/world.js'
import { shot } from './helpers/shots.js'

/* island.js kills you below this. Well under the bedrock floor, so falling
 * off the rim is a real fall rather than an instant teleport. */
const VOID_Y = -60

const survival = (page) => page.evaluate(() => ({
  health: window.game.survival.health,
  food: window.game.survival.food,
  dead: window.game.survival.dead,
}))

const waitForDeath = (page) =>
  page.waitForFunction(() => window.game.survival.dead, null, { timeout: 15_000, polling: 20 })

test.describe('death and respawn', () => {
  test('falling into the void kills you rather than teleporting you home',
    async ({ page }) => {
      await teleport(page, 0.5, VOID_Y + 4, 0.5)
      await waitForDeath(page)

      const s = await survival(page)
      expect(s.dead).toBe(true)
      expect(s.health).toBe(0)
      await expect(page.locator('#death')).toBeVisible()
    })

  test('input is frozen while dead, so W does not steer your corpse',
    async ({ page }) => {
      await teleport(page, 0.5, VOID_Y + 4, 0.5)
      await waitForDeath(page)

      // The reference-counted lock, and the component it detaches. Checking
      // only the flag would pass against the version where holding W into
      // death kept you running -- receivesInputs re-copies input state every
      // tick, so zeroing movement fields is not enough.
      expect(await page.evaluate(() => window.game.inputLock.locked)).toBe(true)
      expect(await page.evaluate(() => window.noa.ents
        .hasComponent(window.noa.playerEntity, window.noa.ents.names.receivesInputs)))
        .toBe(false)

      const [x0, , z0] = await position(page)
      await page.keyboard.down('KeyW')
      await page.waitForTimeout(600)
      await page.keyboard.up('KeyW')
      const [x1, , z1] = await position(page)

      // Only horizontal: you keep falling through the void while dead.
      expect(Math.hypot(x1 - x0, z1 - z0), `drifted ${Math.hypot(x1 - x0, z1 - z0)} blocks`)
        .toBeLessThan(0.01)
    })

  test('the death screen shows, and is what hands the cursor back', async ({ page }) => {
    await teleport(page, 0.5, VOID_Y + 4, 0.5)
    await waitForDeath(page)
    // Visual: "You Died!" over a live world, Minecraft's red wash.
    await shot(page, 'death-screen')
    await expect(page.locator('#respawn-btn')).toBeVisible()
  })

  test('respawning restores full health, spawn position and movement',
    async ({ page }) => {
      await teleport(page, 0.5, VOID_Y + 4, 0.5)
      await waitForDeath(page)

      await page.locator('#respawn-btn').click()
      await waitTicks(page, 2)

      const s = await survival(page)
      expect(s.dead).toBe(false)
      expect(s.health).toBe(20)
      expect(s.food).toBe(20)

      await settleOnGround(page)
      const [x, y, z] = await position(page)
      expect(y).toBeCloseTo(SURFACE_Y, 1)
      expect(x).toBeCloseTo(0.5, 2)
      expect(z).toBeCloseTo(0.5, 2)

      // And the input lock is actually released, not just the flag flipped.
      const [bx, , bz] = await position(page)
      await page.keyboard.down('KeyW')
      await page.waitForTimeout(600)
      await page.keyboard.up('KeyW')
      const [ax, , az] = await position(page)
      expect(Math.hypot(ax - bx, az - bz), 'still frozen after respawn')
        .toBeGreaterThan(1)
    })

  test('respawning does not bill you for the fall you already died from',
    async ({ page }) => {
      // The subtle one: teleporting home leaves your downward momentum and
      // survival.js's peak-height tracking intact, so without the resets you
      // land at spawn and immediately take fall damage from the void drop.
      await teleport(page, 0.5, VOID_Y + 4, 0.5)
      await waitForDeath(page)
      await page.locator('#respawn-btn').click()
      await settleOnGround(page)
      await page.waitForTimeout(500)

      expect((await survival(page)).health).toBe(20)
    })

  test('a survivable fall costs nothing and a long one costs half a heart per block',
    async ({ page }) => {
      // Minecraft: floor(distance - 3) half-hearts, so 3 blocks is free.
      //
      // Deliberately OFF the integer boundaries. survival.js starts tracking
      // the peak on the first AIRBORNE tick, which is already a centimetre
      // below the teleport height -- drop from exactly 10 and it measures
      // 9.93 and charges 6 instead of 7. Testing at 10.5 is testing the rule;
      // testing at 10.0 is testing the sampling jitter.
      await teleport(page, 0.5, SURFACE_Y + 3.4, 0.5)
      await settleOnGround(page)
      expect((await survival(page)).health, 'a 3-block fall hurt').toBe(20)

      await teleport(page, 0.5, SURFACE_Y + 10.5, 0.5)
      await settleOnGround(page)
      const hurt = (await survival(page)).health
      expect(hurt, `health after a 10.5-block fall was ${hurt}`).toBe(13)
    })
})
