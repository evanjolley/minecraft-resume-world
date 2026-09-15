import { test, expect } from './fixtures.js'

/*
 * The cursor after the Escape menu closes.
 *
 * REPORTED (docs/REPORTED.md #4): "when I press esc or back to game on the esc
 * menu, my cursor should not be visible, should go back to the crosshair." The
 * standing guess was that f1fa89d caused it, by making menu.js's retry loop
 * cancellable and refusing to run two intervals at once.
 *
 * It does not reproduce here, and this file is what rules the mechanism out
 * rather than a sentence saying so. It drives the REAL close path and asserts
 * the only thing a player can see: is the pointer locked afterwards.
 *
 * WHY THIS FAKES THE BROWSER, and it is not the same reason 33-death-cursor
 * does. That file fakes pointer lock because headless Chromium never holds one
 * (helpers/world.js says so). This file needs a second thing headless cannot
 * give it: Chrome REFUSES requestPointerLock for ~1.25 s after the USER
 * presses Escape, and that refusal window is the entire premise of the retry
 * loop in menu.js. Playwright's Escape does not start it -- measured, headed,
 * with page.bringToFront(): the lock was handed back two milliseconds later,
 * so a headed run proves the loop works in a world where it is never needed.
 *
 * So the fake models the browser's side of the bargain and nothing else:
 *
 *   - a user Escape drops the lock, starts the cooldown, and does NOT deliver
 *     the keydown to the page. That last half is why main.js hangs the menu
 *     off lostPointerLock instead of listening for the key.
 *   - requestPointerLock during the cooldown fires pointerlockerror and grants
 *     nothing. Outside it, the grant is DEFERRED, because a real one is.
 *
 * Everything else is the shipped code: menu.js's keydown handler, its Back to
 * Game button, requestLockPersistently, and micro-game-shell's own setPL
 * reading the faked getter exactly as it reads the real one.
 *
 * Rejected: asserting that requestPointerLock was called, or counting retries.
 * Both pass for a loop that asks fourteen times and never wins, which is the
 * reported bug with a green test over it.
 */
const CHROME_ESC_COOLDOWN_MS = 1250

const installFakePointerLock = (page, cooldownMs) => page.evaluate((COOLDOWN) => {
  const el = window.noa.container.element
  let held = null
  let cooldownUntil = 0

  const change = () => document.dispatchEvent(new Event('pointerlockchange'))
  const realExit = document.exitPointerLock

  window.__fakePL = {
    get locked() { return held === el },
    asks: 0,
    refusals: 0,
    /** What the browser does when the USER presses Escape while locked. */
    userEscape() {
      if (held !== el) return
      held = null
      cooldownUntil = Date.now() + COOLDOWN
      change()
    },
    restore() {
      delete document.pointerLockElement
      delete el.requestPointerLock
      document.exitPointerLock = realExit
      delete window.__fakePL
    },
  }

  Object.defineProperty(document, 'pointerLockElement', {
    configurable: true,
    get: () => held,
  })
  el.requestPointerLock = () => {
    window.__fakePL.asks++
    const refused = Date.now() < cooldownUntil
    setTimeout(() => {
      if (refused) {
        window.__fakePL.refusals++
        document.dispatchEvent(new Event('pointerlockerror'))
        return
      }
      held = el
      change()
    }, 20)
  }
  document.exitPointerLock = () => { held = null; change() }
}, cooldownMs)

/** Locked, in the world, which is where a player is when they press Escape. */
const startLocked = async (page) => {
  await page.evaluate(() => window.noa.container.setPointerLock(true))
  await page.waitForFunction(() => window.__fakePL.locked, null, { timeout: 5000 })
}

test.describe('the cursor goes away again when the Escape menu closes', () => {
  test('Escape closes it and the pointer ends up locked, cooldown or not',
    async ({ page }) => {
      await installFakePointerLock(page, CHROME_ESC_COOLDOWN_MS)
      try {
        await startLocked(page)

        // The menu is opened by the lock going away, not by a key -- so this
        // is the whole of what the first Escape does.
        await page.evaluate(() => window.__fakePL.userEscape())
        await expect(page.locator('#pause')).toBeVisible()
        expect(await page.evaluate(() => window.__fakePL.locked),
          'still locked with the pause menu up').toBe(false)

        // The second Escape IS delivered: nothing is locked for it to cancel.
        // Pressed immediately, so the cooldown is still running -- the case
        // the retry loop exists for.
        await page.keyboard.press('Escape')
        await expect(page.locator('#pause')).toBeHidden()

        await page.waitForFunction(() => window.__fakePL.locked, null, { timeout: 5000 })
        expect(await page.evaluate(() => window.__fakePL.refusals),
          'the cooldown never refused anything, so this test proved nothing')
          .toBeGreaterThan(0)
      } finally {
        await page.evaluate(() => window.__fakePL.restore())
      }
    })

  test('Back to Game does the same, and the lock stays put afterwards',
    async ({ page }) => {
      await installFakePointerLock(page, CHROME_ESC_COOLDOWN_MS)
      try {
        await startLocked(page)
        await page.evaluate(() => window.__fakePL.userEscape())
        await expect(page.locator('#pause')).toBeVisible()

        await page.getByRole('button', { name: 'Back to Game' }).click()
        await expect(page.locator('#pause')).toBeHidden()
        await page.waitForFunction(() => window.__fakePL.locked, null, { timeout: 5000 })

        // And it STAYS locked. Asserted after a settle rather than at the
        // moment of the grant, because the failure this is watching for is a
        // second actor releasing it a beat later -- the shape that handed the
        // lock back off a corpse in f1fa89d.
        //
        // Not asserted: that the retry loop stopped calling
        // requestPointerLock. It cannot fail. micro-game-shell's setPL returns
        // early once `document.pointerLockElement` matches, so the browser is
        // never reached again whether the loop is still running or not, and
        // the assertion would be green for both.
        await page.waitForTimeout(600)
        expect(await page.evaluate(() => window.__fakePL.locked),
          'the lock was taken away again after the menu closed').toBe(true)
      } finally {
        await page.evaluate(() => window.__fakePL.restore())
      }
    })
})
