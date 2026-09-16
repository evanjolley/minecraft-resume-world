import { test, expect } from './fixtures.js'
import { waitTicks } from './helpers/world.js'

/*
 * Escape out of the inventory: one press, one thing.
 *
 * THE BUG, as reported: Escape out of the inventory left the player without
 * their crosshair and, pressed once, could land them in the pause menu.
 *
 * WHAT IT ACTUALLY WAS, which is not where the keydown handlers are: closing
 * the inventory asked for pointer lock back exactly once, and the browser
 * refuses to grant it for ~1.25 s after the USER presses Escape. The request
 * lands inside that window and is dropped without a word, so the screen goes
 * away and a live OS cursor stays over the world. Everything the player then
 * does to get rid of it -- clicking, pressing Escape again -- runs through
 * pointer-lock state that never settled, and main.js opens the pause menu off
 * `lostPointerLock`. The second half of the fix is inventory.js asking
 * persistently instead of once, which is what these assertions are for.
 *
 * The other half, inventory.js taking Escape in the capture phase, is not
 * what this test proves -- it is written up in the comment there. It cannot
 * be shown from outside, because menu.js's keydown handler can only close the
 * pause menu, never open it.
 *
 * THE SEQUENCE the owner asked for: one Escape behaves exactly like pressing
 * E again -- screen closed, mouse captured, no menu -- and it takes a second
 * Escape to reach the pause menu. Nothing counts presses; the second press is
 * an ordinary in-game Escape, which the browser turns into a lost lock, which
 * is already how the menu opens.
 *
 * WHY THIS TEST FAKES THE BROWSER, and the four pieces it replaces, are
 * 33-death-cursor.spec.js's pattern verbatim -- headless Chromium never holds
 * real pointer lock, so a test that asserts "locked" against the real browser
 * passes or fails for reasons that have nothing to do with this code. Two
 * pieces are added on top of that file's four, and both are browser behaviour
 * that this bug lives inside:
 *
 *   1. Escape while locked exits the lock and is NOT delivered to the page.
 *      That is what makes the second press open the pause menu at all -- it
 *      arrives as lostPointerLock, never as a keydown. menu.js says so.
 *   2. The post-Escape cooldown. Requests inside it are dropped on the floor.
 *      Without this, a single un-retried request would pass the test and the
 *      half of the fix that matters would be untested.
 *
 * Everything else is the real thing: inventory.js's handler, menu.js's
 * handler, main.js's lostPointerLock wiring, and the retry loop.
 *
 * Rejected: asserting on the `menu-open` / `inv-open` body classes. A class
 * says what was painted, not where the mouse is; 37-menu-cursor passes under
 * WebKit on exactly that technicality. "Is the pointer locked right now" is
 * the thing the player can see.
 */
const ESC_COOLDOWN_MS = 1250

const installFakePointerLock = (page) => page.evaluate((cooldown) => {
  const el = window.noa.container.element
  let held = null
  let lastEscape = -Infinity

  window.__fakePL = {
    get locked() { return held === el },
    restore: null,
  }

  const change = () => document.dispatchEvent(new Event('pointerlockchange'))

  const realExit = document.exitPointerLock
  Object.defineProperty(document, 'pointerLockElement', {
    configurable: true,
    get: () => held,
  })
  el.requestPointerLock = () => {
    // Dropped silently inside the cooldown, exactly as a real browser drops
    // it. Deferred otherwise, because a real grant is asynchronous too.
    if (performance.now() - lastEscape < cooldown) return
    setTimeout(() => { held = el; change() }, 20)
  }
  document.exitPointerLock = () => { held = null; change() }

  /*
   * The browser's own Escape handling, on `window` in the capture phase so it
   * runs before every document listener the page installs -- which is the
   * order the real thing effectively has. While locked it releases the lock
   * and swallows the key; while unlocked it does nothing and the key goes
   * through to the page, which is how the inventory ever sees one.
   */
  const onEsc = (e) => {
    if (e.code !== 'Escape') return
    lastEscape = performance.now()
    if (held !== el) return
    held = null
    change()
    e.stopImmediatePropagation()
    e.preventDefault()
  }
  window.addEventListener('keydown', onEsc, true)

  window.__fakePL.restore = () => {
    window.removeEventListener('keydown', onEsc, true)
    delete document.pointerLockElement
    delete el.requestPointerLock
    document.exitPointerLock = realExit
    delete window.__fakePL
  }
}, ESC_COOLDOWN_MS)

const locked = (page) => page.evaluate(() => window.__fakePL.locked)
const menuOpen = (page) => page.evaluate(() => window.game.menu.isOpen)

test.describe('Escape out of the inventory', () => {
  test('one Escape closes the inventory and re-locks; the second opens the menu',
    async ({ page }) => {
      await installFakePointerLock(page)
      try {
        // Where a player actually starts: in the world, mouse captured.
        await page.evaluate(() => window.noa.container.setPointerLock(true))
        await page.waitForFunction(() => window.__fakePL.locked, null, { timeout: 5000 })

        await page.keyboard.press('KeyE')
        await expect(page.locator('#inventory')).toBeVisible()
        expect(await locked(page), 'inventory open with the mouse still captured')
          .toBe(false)

        /* ---- press one: same as pressing E again ---- */
        await page.keyboard.press('Escape')
        await expect(page.locator('#inventory')).toBeHidden()
        expect(await menuOpen(page),
          'Escape closed the inventory AND opened the pause menu behind it')
          .toBe(false)

        // Past the cooldown, with room for the 150 ms retry loop to land. The
        // catch is so the failure is the named expect below rather than a
        // bare waitForFunction timeout -- the message is the test's whole
        // value on the day it goes red.
        await page.waitForFunction(() => window.__fakePL.locked, null, { timeout: 4000 })
          .catch(() => {})
        await waitTicks(page, 2)
        expect(await menuOpen(page), 'the pause menu opened while re-locking')
          .toBe(false)
        expect(await locked(page),
          'inventory closed but the cursor is still loose: no crosshair')
          .toBe(true)

        /* ---- press two: an ordinary in-game Escape ---- */
        await page.keyboard.press('Escape')
        await expect(page.locator('#pause')).toBeVisible()
        expect(await menuOpen(page), 'the second Escape did not open the pause menu')
          .toBe(true)
      } finally {
        await page.evaluate(() => {
          window.game.menu.close()
          window.__fakePL.restore()
        })
      }
    })
})
