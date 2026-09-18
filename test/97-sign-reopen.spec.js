import { test, expect } from './fixtures.js'
import {
  waitTicks, teleport, useGamemode, doubleTapFly, setBlock,
  getBlock, isFlying, ID,
} from './helpers/world.js'

/*
 * A SIGN YOU CAN EDIT MORE THAN ONCE.
 *
 * THE BUG. The edit screen hung off `onBlockPlace` and nothing else, so a
 * sign got exactly one chance at its own text: type a word wrong and the only
 * repair was to mine the sign and place a new one. 83-sign-edit tested that
 * half thoroughly and had no reason to notice the other one, because "opens
 * on place" is the report it was written for.
 *
 * THE SEAM. Vanilla re-opens the same screen from a right-click on the block
 * (`SignBlock.useWithoutItem`), and this world already has a
 * right-click-on-a-block seam: `fx.useBlock`, which is how a crafting table
 * and a furnace open. One more clause on it, rather than a second listener on
 * alt-fire -- inventory.js's own note explains that a second listener would
 * race interact.js for the same input.
 *
 * AND THE CLAUSE HAS A GUARD, which is the half worth testing hardest.
 * interact.js asks `useBlock` BEFORE it asks the authority for `mayBuild`, on
 * purpose: opening a crafting table is not building, so it works in adventure
 * mode with an empty hand. Editing a sign IS building -- it writes text into
 * the world -- so the sign clause has to ask for the permission the code
 * around it has deliberately not asked for yet.
 *
 * THE SAMPLES ARE NAMED. Every "it opened" below is preceded by a reading
 * that the screen was shut and the sign was not blank, so the assertion is
 * about the right-click and not about a screen that never closed.
 */

const PY = 200
const CX = -40
const CZ = 40

/** blocks.js: SIGN_ID. The first of the twenty sign ids. */
const SIGN_BASE = 660

const screen = (page) => page.evaluate(() => {
  const s = window.game.signScreen
  return { open: s.isOpen, at: s.editingAt, lines: s.lines() }
})

/** A stone floor in mid-air with a back wall, well away from every other spec. */
async function room(page, r = 6) {
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
        for (let dy = 1; dy <= 7; dy++) window.noa.setBlock(air, cx + dx, y + dy, cz + dz)
      }
    }
    // One wall, on the -z side, for a painting to hang on facing south.
    for (let i = -rr; i <= rr; i++) {
      for (let dy = 1; dy <= 6; dy++) window.noa.setBlock(stone, cx + i, y + dy, cz - rr)
    }
  }, [CX, CZ, PY, r, ID.stone, ID.air])
  await waitTicks(page, 4)
}

/**
 * Place a sign the way a player does, which is 83-sign-edit's helper: the
 * screen hangs off interaction's onBlockPlace, so a test that wrote the block
 * directly would prove nothing about the path a player takes.
 */
async function placeSign(page, [x, y, z]) {
  await setBlock(page, ID.stone, x, y - 1, z)
  await page.evaluate(([bx, by, bz]) => {
    const g = window.game
    g.inventory.slots.fill(null)
    g.inventory.add(g.itemId('oak_sign'), 1)
    g.inventory.select(0)
    g.inventory.emitChange()
    window.noa.targetedBlock = {
      position: [bx, by - 1, bz], adjacent: [bx, by, bz],
      normal: [0, 1, 0], blockID: window.noa.getBlock(bx, by - 1, bz),
    }
    window.noa._pickResult.position[1] = by
    window.noa.inputs.down.emit('alt-fire')
  }, [x, y, z])
  await waitTicks(page, 3)
}

/**
 * Right-click a block, the way interact.js sees it.
 *
 * The target is assigned and alt-fire emitted inside ONE evaluate, because
 * noa recomputes `targetedBlock` at the top of every tick and a wait between
 * the two would hand the handler whatever the camera happens to be aimed at.
 */
const rightClick = (page, [x, y, z], { sneak = false } = {}) => page.evaluate(
  ([bx, by, bz, sn]) => {
    window.noa.inputs.state.sneak = sn
    window.noa.targetedBlock = {
      position: [bx, by, bz], adjacent: [bx, by, bz + 1],
      normal: [0, 0, 1], blockID: window.noa.getBlock(bx, by, bz),
    }
    window.noa.inputs.down.emit('alt-fire')
  }, [x, y, z, sneak])

async function type(page, text) {
  for (const ch of text) await page.keyboard.press(ch === ' ' ? 'Space' : ch)
  await waitTicks(page, 2)
}

test.describe('a sign can be edited more than once', () => {
  test('right-clicking a placed sign re-opens it on the words already there',
    async ({ page }) => {
      await room(page)
      const at = [CX + 2, PY + 1, CZ + 2]
      await placeSign(page, at)
      await type(page, 'HI')
      await page.evaluate(() => window.game.signScreen.close())
      await waitTicks(page, 2)

      /*
       * THE SAMPLE. The screen really is shut and the sign really does say
       * something, so the two assertions after the right-click are about the
       * right-click and not about a screen that never closed.
       */
      const shut = await screen(page)
      expect(shut.open, 'the screen never closed, so re-opening proves nothing')
        .toBe(false)
      expect(shut.lines[0]).toBe('HI')

      await rightClick(page, at)
      await waitTicks(page, 2)

      const s = await screen(page)
      expect(s.open, 'right-clicking a placed sign opened nothing -- the bug')
        .toBe(true)
      expect(s.at, 'the screen re-opened on some other block').toEqual(at)
      /*
       * And it opens on what the sign ALREADY SAYS, which is the difference
       * between editing a sign and blanking it. signScreen reads the world
       * back through signTextAt for this; a re-open that showed four empty
       * boxes would wipe the sign on the first keystroke.
       */
      expect(s.lines, 're-opening lost the text that was on the sign')
        .toEqual(['HI', '', '', ''])

      await page.evaluate(() => window.game.signScreen.close())
      await waitTicks(page, 2)
    })

  test('sneaking suppresses it, which is how you build against a sign',
    async ({ page }) => {
      await room(page)
      const at = [CX - 2, PY + 1, CZ + 2]
      await placeSign(page, at)
      await page.evaluate(() => window.game.signScreen.close())
      await waitTicks(page, 2)
      expect((await screen(page)).open).toBe(false)

      await rightClick(page, at, { sneak: true })
      await waitTicks(page, 2)
      expect((await screen(page)).open,
        'sneak + right-click opened the edit screen instead of placing')
        .toBe(false)
      await page.evaluate(() => { window.noa.inputs.state.sneak = false })
    })

  test('adventure mode reads a sign and cannot rewrite it', async ({ page }) => {
    await room(page)
    const at = [CX, PY + 1, CZ + 3]
    await placeSign(page, at)
    await type(page, 'OK')
    await page.evaluate(() => window.game.signScreen.close())
    await waitTicks(page, 2)

    /*
     * The same right-click that opened the screen two tests up. The ONLY
     * difference is the game mode, which is what makes this a test of the
     * mayBuild guard rather than of anything else.
     */
    await useGamemode(page, 'adventure')
    await rightClick(page, at)
    await waitTicks(page, 2)
    expect((await screen(page)).open,
      'adventure mode opened the sign editor -- editing a sign is building')
      .toBe(false)
    // And the sign is still a sign saying what it said.
    expect(await getBlock(page, ...at)).toBeGreaterThanOrEqual(SIGN_BASE)
    await useGamemode(page, 'creative')
  })
})

