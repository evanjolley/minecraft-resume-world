import { test, expect } from './fixtures.js'
import { waitTicks } from './helpers/world.js'

/*
 * The cursor on the death screen.
 *
 * THE BUG: typing `/kill` killed you with the pointer still LOCKED, so the
 * death screen came up with no cursor and the Respawn button could not be
 * clicked. A dead end for a visitor, not a cosmetic problem.
 *
 * THE RACE, because every part of it looks correct in isolation. Enter
 * submits the chat line; chat.js closes the bar and -- correctly, since you
 * are alive at that instant -- asks for pointer lock back; THEN the command
 * runs and kills you; respawn.js calls setPointerLock(false). That last call
 * is a no-op: the browser grants pointer lock asynchronously, so the request
 * is still in flight, document.pointerLockElement is still null, and
 * micro-game-shell's `if (!!want === hasPL) return` decides there is nothing
 * to release. The grant then lands on a corpse.
 *
 * WHY THIS TEST FAKES THE BROWSER, and it is the trap this bug was hiding in.
 * Headless Chromium never holds pointer lock -- helpers/world.js says so
 * outright, and it is why sensitivityMultOutsidePointerlock exists in the
 * camera helper. So a test that drives `/kill` and asserts "not locked"
 * passes on the broken code, for the wrong reason, because nothing was ever
 * locked. That is a worse outcome than no test at all.
 *
 * So the four browser-owned pieces are replaced and NOTHING ELSE is: the
 * pointerLockElement getter, requestPointerLock, exitPointerLock, and the
 * pointerlockchange event. The one detail that matters is that the fake grant
 * is DEFERRED -- a real one is too, and that delay is the entire bug. Every
 * other participant is the real thing: chat.js's close, commands.js, the
 * authority, survival, respawn.js, and micro-game-shell's own setPL, which is
 * reached through noa.container.setPointerLock and reads the faked getter
 * exactly as it reads the real one.
 *
 * Rejected: asserting that document.exitPointerLock was called. It passes for
 * a version that releases the lock and then lets the retry loop take it
 * straight back, which is a death screen with no cursor and a green test.
 * "Are you locked right now" is the thing the player can actually see.
 */
const installFakePointerLock = (page) => page.evaluate(() => {
  const el = window.noa.container.element
  let held = null

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
    // Deferred on purpose. A browser cannot grant this synchronously either,
    // and the window between the ask and the grant is where the bug lives.
    setTimeout(() => { held = el; change() }, 20)
  }
  document.exitPointerLock = () => { held = null; change() }

  window.__fakePL.restore = () => {
    delete document.pointerLockElement
    delete el.requestPointerLock
    document.exitPointerLock = realExit
    delete window.__fakePL
  }
})

test.describe('the cursor comes back when you die', () => {
  test('/kill leaves the pointer unlocked, so Respawn is clickable',
    async ({ page }) => {
      await installFakePointerLock(page)
      try {
        // Start from where a player actually is: in the world, mouse captured.
        await page.evaluate(() => window.noa.container.setPointerLock(true))
        await page.waitForFunction(() => window.__fakePL.locked, null, { timeout: 5000 })

        // The real path, keystroke for keystroke. chat.js re-requests the lock
        // on close, while you are still alive; the kill lands after it.
        await page.keyboard.press('Slash')
        await page.waitForFunction(() => window.game.chat.isOpen, null, { timeout: 5000 })
        await page.keyboard.type('kill')
        await page.keyboard.press('Enter')
        await page.waitForFunction(() => window.game.survival.dead, null, { timeout: 5000 })

        // Long enough for the deferred grant (20 ms) and for menu.js's retry
        // loop to have had several passes (150 ms each) at taking it back.
        await page.waitForTimeout(600)
        await waitTicks(page, 2)

        expect(await page.evaluate(() => window.game.survival.dead)).toBe(true)
        await expect(page.locator('#death')).toBeVisible()
        expect(await page.evaluate(() => window.__fakePL.locked),
          'pointer still locked on the death screen: no cursor to click Respawn with')
          .toBe(false)
      } finally {
        await page.evaluate(() => window.__fakePL.restore())
      }
    })
})
