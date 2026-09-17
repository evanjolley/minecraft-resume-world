import { test, expect } from './fixtures.js'
import {
  waitTicks, waitFrames, teleport, look, useGamemode, doubleTapFly, setBlock,
  getBlock, isFlying, ID,
} from './helpers/world.js'
import { shot, shotRegion } from './helpers/shots.js'

/*
 * THE SIGN EDIT SCREEN, which is Evan's third report:
 *
 *   "3. ui to add text does not open on place, should be copied from vanilla"
 *
 * Vanilla opens it the moment you place a sign, with the cursor on line 1,
 * four lines, arrow keys between them, Escape or Done to finish, and the sign
 * rendering live as you type.
 *
 * THREE CLAIMS, and the second is the one with a history:
 *
 *   1. IT OPENS ON PLACE AND ONLY ON PLACE. Vanilla hangs this off `SignItem`
 *      -- the item being used -- so a `/setblock` or a build stamping a plot
 *      must NOT stop the world and ask for four lines. Both halves are tested,
 *      because "opens" is easy and "and not otherwise" is the one a setBlock
 *      wrap would have got wrong.
 *
 *   2. ESCAPE GIVES THE CROSSHAIR BACK, NOT THE PAUSE MENU. That is a fixed
 *      bug (98c3e86) with its own spec, 50-inventory-escape, and a new screen
 *      is the obvious way to reintroduce it. The fake pointer lock below is
 *      that file's, near enough verbatim and for its reasons -- headless
 *      Chromium never grants real pointer lock, so "is the mouse captured"
 *      has to be asked of a browser this test builds.
 *
 *   3. THE SIGN RENDERS AS YOU TYPE. Asserted on the TEXT MESH in the scene
 *      rather than on the input's value, because the input holding what you
 *      typed proves only that a text box works.
 *
 * And one structural claim that no screenshot could make: the screen is a
 * SCREEN as far as inputLock is concerned. inputLock.js's `screens` note
 * predicted this file by name -- "the day a fifth screen lands (signs and
 * written books) every one of those conditions is silently wrong and nothing
 * fails" -- so the test is that the peers see it, not that it registered.
 */

const PY = 200
const CX = 40
const CZ = 20
const SIGN_BASE = 660

const screen = (page) => page.evaluate(() => {
  const s = window.game.signScreen
  return { open: s.isOpen, at: s.editingAt, lines: s.lines() }
})

const focusedLine = (page) => page.evaluate(() =>
  document.activeElement?.classList?.contains('sign-edit-line')
    ? Number(document.activeElement.dataset.line) : -1)

/** The glyph quads actually in the world for one sign, or 0 for no mesh. */
const textVertices = (page, x, y, z) => page.evaluate(([a, b, c]) => {
  const mesh = window.noa.rendering.getScene().getMeshByName(`sign-text-${a},${b},${c}`)
  return mesh ? mesh.getTotalVertices() : 0
}, [x, y, z])

/** A stone floor in mid-air, 76-signs' room without the wall. */
async function signFloor(page, r = 6) {
  await useGamemode(page, 'creative')
  if (!await isFlying(page)) await doubleTapFly(page)
  await teleport(page, CX + 0.5, PY + 2, CZ + 0.5)
  await page.waitForFunction(([x, y, z]) => {
    const w = window.noa.world
    const CS = w._chunkSize
    const c = w._storage.getChunkByIndexes(
      Math.floor(x / CS), Math.floor(y / CS), Math.floor(z / CS))
    return !!c && !c.isDisposed
  }, [CX, PY, CZ], { timeout: 20_000 })
  await page.evaluate(([cx, cz, y, rr, stone, air]) => {
    for (let dx = -rr; dx <= rr; dx++) {
      for (let dz = -rr; dz <= rr; dz++) {
        window.noa.setBlock(stone, cx + dx, y, cz + dz)
        for (let dy = 1; dy <= 6; dy++) window.noa.setBlock(air, cx + dx, y + dy, cz + dz)
      }
    }
  }, [CX, CZ, PY, r, ID.stone, ID.air])
  await waitTicks(page, 4)
}

/**
 * Place a sign the way a PLAYER does: a sign in hand, a block targeted, and
 * the alt-fire binding fired.
 *
 * Through the real input rather than through `noa.setBlock`, which is the
 * whole point -- the screen hangs off interaction's onBlockPlace, and a test
 * that wrote the block directly would pass on a build that never opened the
 * screen for a player at all.
 */
async function placeSign(page, [x, y, z], heading = null) {
  await setBlock(page, ID.stone, x, y - 1, z)
  /*
   * The heading decides which of the sixteen rotations lands, so a test that
   * wants to READ the sign afterwards has to look the right way while
   * planting it -- a sign faces back at whoever placed it, so plant it while
   * looking the way you will be looking later. Only the photographs care;
   * everything else reads the mesh rather than the pixels.
   */
  if (heading !== null) await look(page, { heading, pitch: 0.2 })
  await page.evaluate(([bx, by, bz]) => {
    const g = window.game
    g.inventory.slots.fill(null)
    g.inventory.add(g.itemId('oak_sign'), 1)
    g.inventory.select(0)
    g.inventory.emitChange()
    // The target the placement reads: the top face of the block below.
    window.noa.targetedBlock = {
      position: [bx, by - 1, bz], adjacent: [bx, by, bz],
      normal: [0, 1, 0], blockID: window.noa.getBlock(bx, by - 1, bz),
    }
    window.noa._pickResult.position[1] = by
    window.noa.inputs.down.emit('alt-fire')
  }, [x, y, z])
  await waitTicks(page, 3)
}

/** Type into whichever line has the cursor, one real key at a time. */
async function type(page, text) {
  for (const ch of text) await page.keyboard.press(ch === ' ' ? 'Space' : ch)
  await waitTicks(page, 2)
}

test.describe('placing a sign opens somewhere to type', () => {
  test('the screen opens on place, on line 1, with the sign it is editing',
    async ({ page }) => {
      await signFloor(page)
      const at = [CX + 2, PY + 1, CZ + 2]
      await placeSign(page, at)

      const s = await screen(page)
      expect(s.open, 'placing a sign opened no screen').toBe(true)
      expect(s.at, 'the screen is editing a different block').toEqual(at)
      expect(s.lines, 'a new sign is not blank').toEqual(['', '', '', ''])
      // Vanilla opens with the cursor on line 1, which is a real focused
      // input here and not a variable saying so.
      expect(await focusedLine(page)).toBe(0)
      // And the block really is a sign, whichever of the sixteen rotations
      // the placement seam chose.
      const id = await getBlock(page, ...at)
      expect(id).toBeGreaterThanOrEqual(SIGN_BASE)
      await page.evaluate(() => window.game.signScreen.close())
    })

  test('a sign that arrives any other way opens nothing', async ({ page }) => {
    await signFloor(page)
    const at = [CX - 2, PY + 1, CZ + 2]
    await setBlock(page, ID.stone, at[0], at[1] - 1, at[2])
    /*
     * setBlock, which is where installPlacementOrientation and signText.js
     * both hook. A screen hung off THAT seam would open here -- and would
     * open once per sign while a build stamped a plot, which is the reason
     * vanilla puts it on the item instead.
     */
    await setBlock(page, SIGN_BASE, ...at)
    await waitTicks(page, 3)
    expect(await getBlock(page, ...at), 'the sign was not placed').toBeGreaterThanOrEqual(SIGN_BASE)
    expect((await screen(page)).open, '/setblock opened the edit screen').toBe(false)
  })

  test('four lines, arrow keys between them, and the sign draws as you type',
    async ({ page }) => {
      await signFloor(page)
      const at = [CX, PY + 1, CZ + 2]
      await placeSign(page, at)
      expect((await screen(page)).open).toBe(true)

      // Nothing on the sign yet: the sample, before anything is concluded.
      expect(await textVertices(page, ...at), 'a blank sign already has glyphs')
        .toBe(0)

      await type(page, 'AB')
      /*
       * THE SIGN, not the input. Two characters is two quads is eight
       * vertices, which is signText.js's whole arrangement -- a sign costs a
       * vertex buffer and not a texture -- read back out of the scene.
       */
      expect(await textVertices(page, ...at), 'typing drew nothing on the sign')
        .toBe(8)

      await page.keyboard.press('ArrowDown')
      expect(await focusedLine(page), 'ArrowDown did not move to line 2').toBe(1)
      await type(page, 'CDE')
      expect(await textVertices(page, ...at)).toBe(8 + 12)

      await page.keyboard.press('ArrowUp')
      expect(await focusedLine(page), 'ArrowUp did not come back to line 1').toBe(0)

      // Down past the last line stays on the last line rather than wrapping.
      for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown')
      expect(await focusedLine(page)).toBe(3)

      const s = await screen(page)
      expect(s.lines).toEqual(['AB', 'CDE', '', ''])

      await shotRegion(page, 'sign-edit-typing', 'centre')
      await page.evaluate(() => window.game.signScreen.close())
    })

  test('the words survive the screen closing', async ({ page }) => {
    await signFloor(page)
    const at = [CX + 4, PY + 1, CZ]
    await placeSign(page, at)
    await type(page, 'HI')
    await page.evaluate(() => window.game.signScreen.close())
    await waitTicks(page, 2)
    expect((await screen(page)).open).toBe(false)
    expect(await textVertices(page, ...at), 'closing the screen wiped the sign')
      .toBe(8)
  })
})

/* ------------------------------------------------------------------ *
 * The screen as a SCREEN
 * ------------------------------------------------------------------ */

test.describe('the edit screen is a screen', () => {
  test('inputLock knows about it, and its peers therefore do', async ({ page }) => {
    await signFloor(page)
    await placeSign(page, [CX + 3, PY + 1, CZ + 3])

    const while_open = await page.evaluate(() => ({
      any: window.game.inputLock.anyScreenOpen(),
      other: window.game.inputLock.otherScreenOpen('sign'),
      locked: window.game.inputLock.locked,
      has: window.game.inputLock.has('sign'),
    }))
    expect(while_open.has, 'the screen never told inputLock it was open').toBe(true)
    expect(while_open.any).toBe(true)
    expect(while_open.locked, 'the player can still walk while typing').toBe(true)
    // Nothing else is open, which is what makes the next assertion mean
    // something: chat is declining for THIS screen's sake and no other's.
    expect(while_open.other).toBe(false)

    /*
     * And a peer actually acts on it. chat.js's handler returns early when
     * `otherScreenOpen('chat')` -- so pressing T while the sign screen is up
     * must type a T into the sign rather than opening the chat bar. That is
     * the whole payoff of registering here instead of adding a sixth copy of
     * "which screens are open", and it is testable from outside.
     */
    await page.keyboard.press('KeyT')
    await waitTicks(page, 2)
    expect(await page.evaluate(() => window.game.chat.isOpen ?? false),
      'T opened chat on top of the sign screen').toBe(false)
    // Lowercase: `press('KeyT')` is the key, not the shifted character, and
    // the character is what a text field receives.
    expect((await screen(page)).lines[0], 'T did not reach the sign').toBe('t')

    /*
     * AND THE CAPTURE PHASE, which E is the only key in this world that can
     * prove. Everything else is already stopped twice over: inputLock's
     * `filterEvents` suppresses key PRESSES while any lock is held, so W does
     * not walk whether or not this screen stops the event.
     *
     * E is the documented exception. inputLock's PRESS_SURVIVES_LOCK lets
     * 'inventory' through on purpose -- "filtering this is how you build a
     * screen nobody can get out of" -- so the E binding is live while the
     * sign screen is up, and the ONLY thing between typing an E into a sign
     * and the inventory opening over it is the stopPropagation in the capture
     * handler. Found by running the mutation: with the stopPropagation
     * removed, every other assertion in this file still passed.
     */
    await page.keyboard.press('KeyE')
    await waitTicks(page, 2)
    expect(await page.evaluate(() => window.game.inventoryScreen.isOpen ?? false),
      'typing an E opened the inventory over the sign screen').toBe(false)
    expect((await screen(page)).lines[0], 'E did not reach the sign').toBe('te')

    await page.evaluate(() => window.game.signScreen.close())
    await waitTicks(page, 2)
    expect(await page.evaluate(() => window.game.inputLock.anyScreenOpen()),
      'closing the screen left the lock held').toBe(false)
  })
})

/* ------------------------------------------------------------------ *
 * Escape
 *
 * 50-inventory-escape's fake browser, near enough verbatim: headless
 * Chromium never grants real pointer lock, so a test that asserts "captured"
 * against the real thing passes or fails for reasons unrelated to this code.
 * The two pieces that matter here are the same two that mattered there --
 * Escape while locked exits the lock and is NOT delivered to the page, and
 * requests inside the ~1.25 s post-Escape cooldown are dropped in silence.
 * ------------------------------------------------------------------ */

const ESC_COOLDOWN_MS = 1250

const installFakePointerLock = (page) => page.evaluate((cooldown) => {
  const el = window.noa.container.element
  let held = null
  let lastEscape = -Infinity
  window.__fakePL = { get locked() { return held === el }, restore: null }
  const change = () => document.dispatchEvent(new Event('pointerlockchange'))
  const realExit = document.exitPointerLock
  Object.defineProperty(document, 'pointerLockElement', {
    configurable: true, get: () => held,
  })
  el.requestPointerLock = () => {
    if (performance.now() - lastEscape < cooldown) return
    setTimeout(() => { held = el; change() }, 20)
  }
  document.exitPointerLock = () => { held = null; change() }
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

test.describe('Escape out of the sign screen', () => {
  test('Escape closes it and gives the crosshair back, not the pause menu',
    async ({ page }) => {
      await signFloor(page)
      await installFakePointerLock(page)
      try {
        await page.evaluate(() => window.noa.container.setPointerLock(true))
        await page.waitForFunction(() => window.__fakePL.locked, null, { timeout: 5000 })

        const at = [CX - 3, PY + 1, CZ - 3]
        await placeSign(page, at)
        expect((await screen(page)).open, 'nothing opened to escape from').toBe(true)
        // A screen you type into cannot hold the cursor: you would not be
        // able to see what you were typing.
        expect(await locked(page), 'the edit screen kept the mouse captured')
          .toBe(false)

        await type(page, 'OK')

        await page.keyboard.press('Escape')
        await waitTicks(page, 2)
        expect((await screen(page)).open, 'Escape did not close the screen').toBe(false)
        /*
         * THE WHOLE POINT. menu.js's handler never sees the key, because
         * signScreen.js stops it in the capture phase; and main.js's
         * lostPointerLock guard asks inputLock, which the screen told BEFORE
         * it released the lock. Both halves have to hold or this is 98c3e86
         * again with a sign in front of it.
         */
        expect(await menuOpen(page),
          'Escape closed the sign screen AND opened the pause menu behind it')
          .toBe(false)

        // Past the cooldown, with room for the 150 ms retry loop to land.
        await page.waitForFunction(() => window.__fakePL.locked, null, { timeout: 4000 })
          .catch(() => {})
        await waitTicks(page, 2)
        expect(await menuOpen(page), 'the pause menu opened while re-locking').toBe(false)
        expect(await locked(page),
          'Escape left the player without their crosshair -- the reported bug')
          .toBe(true)
        // And the words stayed on the sign.
        expect(await textVertices(page, ...at)).toBe(8)
      } finally {
        await page.evaluate(() => window.__fakePL?.restore?.())
      }
    })
})

/* ------------------------------------------------------------------ *
 * Photographs
 * ------------------------------------------------------------------ */

test.describe('what the edit screen looks like', () => {
  test('the screen with words being typed, and the sign they landed on',
    async ({ page }) => {
      await signFloor(page)
      const at = [CX, PY + 1, CZ - 3]
      // Planted while looking north, so the board turns to face south, which
      // is where the camera goes three lines down.
      await placeSign(page, at, Math.PI)
      /*
       * Back off WHILE THE SCREEN IS OPEN, which is a thing a player can do
       * only by walking and this test does by teleporting. It matters for the
       * photograph rather than for the code: you place a sign from arm's
       * length, so the board fills the frame behind the panel and the picture
       * cannot show that the two coexist. The panel draws no scrim precisely
       * so that they do.
       */
      await teleport(page, at[0] + 0.5, at[1], at[2] + 3.5)
      await look(page, { heading: Math.PI, pitch: Math.atan2(0.8, 3.5) })
      await waitTicks(page, 2)
      await type(page, 'EVAN')
      await page.keyboard.press('ArrowDown')
      await type(page, 'JOLLEY')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowDown')
      await type(page, '2026')
      await waitFrames(page, 3)
      /*
       * Full frame, not a crop: the claim is that the panel and the SIGN are
       * both on screen at once, which is the reason the panel is small, sits
       * low and draws no scrim over the world.
       */
      await shot(page, 'sign-edit-screen')

      await page.keyboard.press('Escape')
      await waitTicks(page, 3)
      /*
       * Then the finished sign, aimed at from three and a half blocks back.
       * atan(0.8 / 3.5) is where a board's middle sits from there -- a camera
       * level with the floor looks over the top of a sign, which is the
       * mistake 76-signs records finding in its own photographs.
       */
      await teleport(page, at[0] + 0.5, at[1], at[2] + 3.5)
      await look(page, { heading: Math.PI, pitch: Math.atan2(0.8, 3.5) })
      await waitTicks(page, 3)
      await waitFrames(page, 3)
      await shotRegion(page, 'sign-edit-finished', 'centre')

      const s = await screen(page)
      expect(s.open).toBe(false)
      expect(await textVertices(page, ...at)).toBe((4 + 6 + 4) * 4)
    })
})
