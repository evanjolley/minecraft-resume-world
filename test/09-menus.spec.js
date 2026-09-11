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

  /*
   * CREDITS IS A LICENCE, NOT A FEATURE.
   *
   * The attribution used to be 9px grey type pinned to the bottom-right of the
   * HUD. It is gone from there, and these tests exist because it could not
   * simply be deleted: Pixel Perfection CE is CC BY-SA 4.0 and the sound set is
   * CC0 / CC BY / CC BY-SA, and credit is a condition of redistributing any of
   * them. This page IS the redistribution.
   *
   * So the pair of assertions below is one claim in two halves -- gone from the
   * HUD, still reachable -- and failing EITHER half is a bug. A test that only
   * checked the first would pass on a build that quietly dropped the notice.
   */
  test.describe('credits', () => {
    const openCredits = async (page) => {
      await page.evaluate(() => window.game.menu.open())
      await page.getByRole('button', { name: 'Credits' }).click()
      await expect(page.locator('#credits')).toBeVisible()
    }

    test('the attribution is gone from the HUD', async ({ page }) => {
      // By id, and then by the text itself: renaming the element would slip
      // past the first check on its own.
      expect(await page.locator('#credit').count()).toBe(0)
      await expect(page.locator('#hud')).not.toContainText('CC BY-SA')
      await expect(page.locator('#hud')).not.toContainText('Pixel Perfection')
    })

    test('every licensed work is named on the credits screen', async ({ page }) => {
      await openCredits(page)
      const text = await page.locator('#credits').innerText()

      // Every work that carries an attribution condition, by name and licence.
      expect(text).toContain('Pixel Perfection CE')
      expect(text).toContain('CC BY-SA 4.0')
      expect(text).toContain('Monocraft')
      expect(text).toContain('SIL OFL 1.1')
    })

    test('the sounds NOTICE the credits link to exists', async ({ page }) => {
      /*
       * The sound set's condition is satisfied by the NOTICE rather than by
       * the credits screen itself -- 60-odd files across three licences do not
       * fit on a menu -- so the LINK is what makes the screen compliant, and a
       * link that 404s is the whole notice missing. Fetched, not just read off
       * the href, because the build is what emits that file.
       */
      await openCredits(page)
      const href = await page.locator('#credits a[href$="/sounds/NOTICE.txt"]').first()
        .getAttribute('href')
      expect(href).toBe('/sounds/NOTICE.txt')

      const res = await page.request.get(href)
      expect(res.status(), 'the credits link to a NOTICE the build never emitted').toBe(200)
      expect(await res.text()).toContain('CC BY-SA')
    })

    test('every credits link resolves', async ({ page }) => {
      // The off-site ones are not fetched: a licence deed being unreachable is
      // Creative Commons having an outage, not this repo regressing. What IS
      // checked is that each anchor carries an absolute or rooted href and
      // opens away from the game, since a link that navigates the page kills
      // the world behind it.
      await openCredits(page)
      const links = await page.locator('#credits a').evaluateAll(
        as => as.map(a => ({ href: a.getAttribute('href'), target: a.target, rel: a.rel })))

      expect(links.length).toBeGreaterThanOrEqual(4)
      for (const l of links) {
        expect(l.href, 'a credits link with no destination').toMatch(/^(https?:\/\/|\/)/)
        expect(l.target).toBe('_blank')
        expect(l.rel).toContain('noopener')
      }
    })

    test('Done closes the credits sheet', async ({ page }) => {
      await openCredits(page)
      await page.locator('#credits-close').click()
      await expect(page.locator('#credits')).toBeHidden()
      await expect(page.locator('#pause')).toBeVisible()
    })

    test('closing the menu closes the credits sheet', async ({ page }) => {
      // The sheet is a sibling of #pause, not a child, so hiding the menu does
      // not hide it -- menu.js has to, and it used to name only #controls.
      await openCredits(page)
      await page.evaluate(() => window.game.menu.close())
      await expect(page.locator('#credits')).toBeHidden()
    })

    test('the credits screen renders', async ({ page }) => {
      await openCredits(page)
      await waitTicks(page, 2)
      await shot(page, 'menu-credits')
      await page.locator('#credits-close').click()
    })
  })
})
