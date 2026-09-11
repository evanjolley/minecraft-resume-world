import { test, expect } from './fixtures.js'
import { look, HEADING, position, waitTicks, measureClockRate } from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * The rule this file exists for: a menu detaches YOUR input and nothing else.
 * Minecraft only pauses in singleplayer; on a server the sky keeps moving
 * while your menu is open, and this world is built as the server case.
 *
 * The pause menu is opened through game.menu.open() rather than Escape --
 * NOT for convenience. The browser handles Escape itself to exit pointer
 * lock and never delivers the keydown, so main.js hangs the menu off the
 * resulting lostPointerLock. Headless never has pointer lock to lose, so
 * that event cannot fire and there is no real key path to drive.
 */

const drift = async (page, keyMs = 800) => {
  const [x0, , z0] = await position(page)
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(keyMs)
  await page.keyboard.up('KeyW')
  const [x1, , z1] = await position(page)
  return Math.hypot(x1 - x0, z1 - z0)
}

test.describe('menus', () => {
  test.beforeEach(async ({ page }) => {
    await look(page, { heading: HEADING.eastPlusX })
  })

  test('the pause menu stops the player moving', async ({ page }) => {
    await page.evaluate(() => window.game.menu.open())
    await expect(page.locator('#pause')).toBeVisible()
    expect(await drift(page), 'moved while the pause menu was open').toBeLessThan(0.01)
  })

  test('the pause menu does NOT pause the world clock', async ({ page }) => {
    await page.evaluate(() => window.game.menu.open())
    const rate = await measureClockRate(page, 2000)
    expect(rate, `clock ran at ${rate.toFixed(2)} ticks/sec behind the menu`)
      .toBeGreaterThan(19)
  })

  test('closing the pause menu hands movement back', async ({ page }) => {
    await page.evaluate(() => window.game.menu.open())
    await waitTicks(page, 2)
    await page.evaluate(() => window.game.menu.close())
    await waitTicks(page, 2)
    expect(await drift(page), 'still frozen after the menu closed').toBeGreaterThan(1)
  })

  test('the inventory stops the player moving but keeps the world running',
    async ({ page }) => {
      await page.keyboard.press('KeyE')
      await expect(page.locator('#inventory')).toBeVisible()

      expect(await drift(page), 'moved with the inventory open').toBeLessThan(0.01)
      const rate = await measureClockRate(page, 2000)
      expect(rate, `clock ran at ${rate.toFixed(2)} ticks/sec behind the inventory`)
        .toBeGreaterThan(19)
    })

  test('holding W into a menu does not leave you running', async ({ page }) => {
    // The real regression: noa's receivesInputs re-copies input state every
    // tick, so a menu that only zeroes the movement fields gets overwritten
    // on the next tick and you keep sprinting into the void behind it.
    await page.keyboard.down('KeyW')
    await page.waitForTimeout(300)
    await page.evaluate(() => window.game.menu.open())
    await waitTicks(page, 3)

    const [x0, , z0] = await position(page)
    await page.waitForTimeout(500)
    const [x1, , z1] = await position(page)
    await page.keyboard.up('KeyW')

    expect(Math.hypot(x1 - x0, z1 - z0), 'coasted into the menu').toBeLessThan(0.01)
  })

  /*
   * INPUT THAT IS NOT MOVEMENT.
   *
   * The lock detaches noa's receivesInputs, which covers walking and nothing
   * else. Our own tick handlers poll noa.inputs.state straight off the
   * keyboard -- sneak for the camera drop and the edge guard, sprint for the
   * FOV -- so both of those kept running behind an open screen. You stood
   * still with the camera dropped, or stood still at sprint FOV, which is the
   * bug Evan hit from both ends.
   *
   * These read the camera rather than the position deliberately. Position is
   * already covered above and would pass either way: the symptom here is
   * precisely that the player does NOT move while something else reacts.
   */
  const eyeHeight = (page) => page.evaluate(() =>
    window.noa.ents.getState(window.noa.camera.cameraTarget, 'followsEntity').offset[1])
  const fov = (page) => page.evaluate(() => window.noa.rendering.camera.fov)

  test('sneaking behind a menu does not drop the camera', async ({ page }) => {
    const standing = await eyeHeight(page)
    await page.evaluate(() => window.game.menu.open())
    await page.keyboard.down('ShiftLeft')
    await waitTicks(page, 12)   // the drop eases in over a few ticks, not instantly
    const held = await eyeHeight(page)
    await page.keyboard.up('ShiftLeft')

    expect(held, 'the camera crouched behind an open menu').toBeCloseTo(standing, 3)
  })

  test('double-tapping sprint behind a menu does not widen the FOV', async ({ page }) => {
    /*
     * Sprint is set by the double-tap DOWN event, which fires whatever is
     * open, and then held by the tick as long as forward is down -- and
     * during the second tap it is. So the FOV lerped out to sprint width
     * while the player stood still.
     */
    const base = await fov(page)
    await page.evaluate(() => window.game.menu.open())
    await page.keyboard.press('KeyW')
    await page.keyboard.down('KeyW')
    await waitTicks(page, 20)   // FOV eases at 9/sec; 20 ticks is most of the way
    const widened = await fov(page)
    await page.keyboard.up('KeyW')

    expect(widened, 'the FOV sprinted behind an open menu').toBeCloseTo(base, 4)
  })

  test('a key held across the close does not act until it is pressed again',
    async ({ page }) => {
      /*
       * Minecraft calls KeyMapping.releaseAll() when a screen opens: close the
       * menu still holding W and you stand there until you let go and press
       * again. Without it the gate hands back a key that was never released
       * and you resume mid-sprint, which is smoother and is not the game.
       */
      await page.keyboard.down('KeyW')
      await page.waitForTimeout(200)
      await page.evaluate(() => window.game.menu.open())
      await waitTicks(page, 3)
      await page.evaluate(() => window.game.menu.close())
      await waitTicks(page, 3)

      const [x0, , z0] = await position(page)
      await page.waitForTimeout(500)
      const [x1, , z1] = await position(page)
      expect(Math.hypot(x1 - x0, z1 - z0), 'a held key resumed on its own')
        .toBeLessThan(0.01)

      // And the other half of the claim: it comes back when re-pressed.
      await page.keyboard.up('KeyW')
      await waitTicks(page, 2)
      expect(await drift(page), 'the key never came back').toBeGreaterThan(1)
    })

  test('the menu screens render', async ({ page }) => {
    // Visual: Minecraft's button sprite, the paired rows and the controls
    // sheet are layout judgements, not values.
    await page.evaluate(() => window.game.menu.open())
    await waitTicks(page, 2)
    await shot(page, 'menu-pause')

    await page.getByRole('button', { name: 'Controls' }).click()
    await expect(page.locator('#controls')).toBeVisible()
    await shot(page, 'menu-controls')
    await page.locator('#controls-close').click()
  })

})
