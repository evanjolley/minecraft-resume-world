import { test, expect } from './fixtures.js'

/*
 * Screens handing the cursor to each other. Two tests, one subject.
 *
 * The first is the defect: closing one screen must not steal the cursor back
 * from the next one. The second is the structure under it -- "is a screen
 * open" is inputLock's answer now, not a list of peers each screen keeps, so
 * a screen this suite has never heard of is honoured by main.js's guard.
 *
 * THE BUG, found by reading rather than by playing: every screen that
 * releases pointer lock hands it back on close through
 * requestLockPersistently -- a ~2.1 s loop that re-asks every 150 ms, because
 * the browser silently refuses for ~1.25 s after the USER presses Escape.
 * That loop outlives the close. inventory.js, menu.js and respawn.js all call
 * cancelPersistentLock() on the way IN for exactly that reason. chat.js did
 * not, and did not import the function. So: Escape out of the inventory,
 * press T inside the next two seconds, and the inventory's loop wins a
 * request it was never meant to still be making -- the cursor is captured
 * again with the chat bar open and half a sentence typed.
 *
 * WHAT THIS FILE FAKES, and it is 50-inventory-escape's fake with one extra
 * counter: headless Chromium and WebKit never grant real pointer lock
 * (docs/browsers.md §5), and neither engine starts the post-Escape cooldown
 * for a synthetic key. Both are browser behaviour this bug lives INSIDE, so
 * both are modelled and nothing else is:
 *
 *   - Escape while locked exits the lock and is not delivered to the page;
 *     Escape at any time starts the cooldown.
 *   - requestPointerLock inside the cooldown is dropped on the floor without
 *     a word. Outside it, the grant is deferred, because a real one is.
 *
 * Everything else is shipped code: inventory.js's Escape handler, its close
 * path, menu.js's retry loop, and chat.js's setOpen.
 *
 * THE DISCRIMINATING ASSERTION is `__fakePL.locked` staying false -- "where
 * is the mouse", which is the only thing the player can see. `asks` holding
 * still is the mechanism behind it and is asserted second, as the reason.
 * Focus is asserted only as proof chat really opened: in the fake, a granted
 * lock does not blur an input the way a real browser's would, so focus cannot
 * tell the two worlds apart and is not evidence of anything here.
 */
const ESC_COOLDOWN_MS = 1250

/* Long enough to clear the cooldown and leave room for two more 150 ms
 * retries on the far side of it. Under the bug the loop wins the first
 * request after the cooldown expires, so this is the window in which the
 * cursor gets taken. */
const PAST_COOLDOWN_MS = ESC_COOLDOWN_MS + 450

const installFakePointerLock = (page) => page.evaluate((cooldown) => {
  const el = window.noa.container.element
  let held = null
  let lastEscape = -Infinity

  window.__fakePL = {
    get locked() { return held === el },
    asks: 0,
    restore: null,
  }

  const change = () => document.dispatchEvent(new Event('pointerlockchange'))

  const realExit = document.exitPointerLock
  Object.defineProperty(document, 'pointerLockElement', {
    configurable: true,
    get: () => held,
  })
  el.requestPointerLock = () => {
    window.__fakePL.asks++
    if (performance.now() - lastEscape < cooldown) return
    setTimeout(() => { held = el; change() }, 20)
  }
  document.exitPointerLock = () => { held = null; change() }

  // On `window` in the capture phase, so it runs before every document
  // listener the page installs -- the order the real browser effectively has.
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

const asks = (page) => page.evaluate(() => window.__fakePL.asks)

/** Did anything take the lock in the next `ms`? Fails fast when it does. */
const lockGetsTaken = (page, ms) =>
  page.waitForFunction(() => window.__fakePL.locked, null, { timeout: ms })
    .then(() => true).catch(() => false)

test.describe('one screen closing, the next one opening', () => {
  test('chat opened inside the inventory\'s re-lock window keeps the cursor',
    async ({ page }) => {
      await installFakePointerLock(page)
      try {
        // In the world, mouse captured, which is where a player starts.
        await page.evaluate(() => window.noa.container.setPointerLock(true))
        await page.waitForFunction(() => window.__fakePL.locked, null, { timeout: 5000 })

        await page.keyboard.press('KeyE')
        await expect(page.locator('#inventory')).toBeVisible()

        // Escape, not E: it is the close that starts the browser cooldown,
        // which is the whole reason the retry loop exists.
        await page.keyboard.press('Escape')
        await expect(page.locator('#inventory')).toBeHidden()

        // The loop is live and losing -- if it were not, the rest of this
        // test would pass against any build at all.
        const asksAtOpen = await asks(page)
        expect(asksAtOpen,
          'the inventory close never asked for the lock back, so there is no '
          + 'loop here to steal it and this test proves nothing')
          .toBeGreaterThan(0)
        expect(await page.evaluate(() => window.__fakePL.locked),
          'the cooldown granted a lock it should have refused').toBe(false)

        /* ---- T, inside that window ---- */
        await page.keyboard.press('KeyT')
        expect(await page.evaluate(() => window.game.chat.isOpen),
          'T did not open chat').toBe(true)
        await expect(page.locator('#chat-bar')).toBeVisible()
        expect(await page.evaluate(() => document.activeElement?.id))
          .toBe('chat-input')

        const stolen = await lockGetsTaken(page, PAST_COOLDOWN_MS)
        expect(stolen,
          'the inventory\'s retry loop captured the mouse with the chat bar '
          + 'open: the cursor vanishes mid-sentence')
          .toBe(false)
        expect(await asks(page) - asksAtOpen,
          'opening chat did not stop the loop; it is still asking')
          .toBe(0)
        expect(await page.evaluate(() => window.game.chat.isOpen),
          'chat closed on its own').toBe(true)
      } finally {
        await page.evaluate(() => {
          window.game.chat.close()
          window.__fakePL.restore()
        })
      }
    })

  /*
   * The same guard, asked about a screen that does not exist yet.
   *
   * main.js used to decide whether a lost pointer lock means "open the pause
   * menu" by naming the four screens it knew about, and chat.js and menu.js
   * kept their own copies of that list. Signs and written books
   * (docs/FUTURE.md item 1) add a fifth screen, and every one of those
   * conditions would have been silently wrong the day it landed -- the pause
   * menu popping up on top of the sign you just opened.
   *
   * So this test opens a screen by the only thing a screen has to do,
   * inputLock.lock(), with a reason nothing in src/ mentions. If it stays
   * shut, the guard is asking the registry rather than reciting a list.
   *
   * The second half is what stops it passing vacuously: with the same reason
   * unlocked, the identical release DOES open the menu.
   */
  test('a screen inputLock has never heard of still keeps the pause menu shut',
    async ({ page }) => {
      await installFakePointerLock(page)
      try {
        const relock = async () => {
          await page.evaluate(() => window.noa.container.setPointerLock(true))
          await page.waitForFunction(() => window.__fakePL.locked, null, { timeout: 5000 })
        }
        // Not a user Escape: a screen releasing the lock on purpose, which is
        // the case the guard exists for and the one signs will be.
        const release = () => page.evaluate(() => {
          window.noa.container.setPointerLock(false)
        })

        await relock()
        await page.evaluate(() => window.game.inputLock.lock('signs'))
        await release()
        await expect(page.locator('#pause')).toBeHidden()
        expect(await page.evaluate(() => window.game.menu.isOpen),
          'the pause menu opened on top of a screen it had never been told about')
          .toBe(false)

        /* ---- and it is not passing because nothing ever opens ---- */
        await page.evaluate(() => window.game.inputLock.unlock('signs'))
        await relock()
        await release()
        await expect(page.locator('#pause')).toBeVisible()
      } finally {
        await page.evaluate(() => {
          window.game.inputLock.unlock('signs')
          window.game.menu.close()
          window.__fakePL.restore()
        })
      }
    })
})
