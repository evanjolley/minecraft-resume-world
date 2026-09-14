import { test, expect } from './fixtures.js'
import { shot } from './helpers/shots.js'
import { waitTicks, waitFrames, position } from './helpers/world.js'

/*
 * The Tab player list.
 *
 * Three things are worth asserting and nothing else here is:
 *
 *   1. It lists the ROSTER -- both characters, under the names identity.js
 *      says they have. Read through `game.roster`, never spelled out, because
 *      four specs were broken recently by test code asserting a name it did
 *      not own. If someone renames the visitor, this spec follows.
 *   2. It appears on hold and vanishes on release. It is a held key, not a
 *      toggle, and the difference is invisible to a test that only ever
 *      presses and releases in one motion.
 *   3. Holding it does NOT stop the player. This is the property the brief
 *      called out and the one a plausible implementation gets wrong: the
 *      player list is an OVERLAY drawn in the HUD pass, so it must not take
 *      the input lock. In vanilla you can walk while reading it.
 *
 * `game.tabList.rows()` is the row model BEFORE it becomes pixels, which is
 * how "the list contains Evan" is asserted without going through a DOM query
 * that would also pass against two hardcoded divs.
 *
 * No world coordinate is written down anywhere below. Movement is asserted as
 * a DELTA, because the world's X axis is being unmirrored by another change
 * and any absolute position here would be a landmine.
 */

const isOpen = (page) => page.evaluate(() => window.game.tabList.isOpen)
const rows = (page) => page.evaluate(() => window.game.tabList.rows())
const rosterNames = (page) => page.evaluate(() =>
  window.game.roster.list().map((e) => window.game.roster.displayNameOf(e.id)).sort())

/** Nothing here should be able to leave the key latched, but if it does, the
 *  next spec file inherits an overlay it never opened. */
test.afterEach(async ({ page }) => {
  await page.keyboard.up('Tab').catch(() => {})
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
})

test.describe('Tab player list', () => {
  test('holding Tab shows the list, releasing hides it', async ({ page }) => {
    expect(await isOpen(page)).toBe(false)
    await expect(page.locator('#tab-list')).toBeHidden()

    await page.keyboard.down('Tab')
    await waitFrames(page, 2)
    expect(await isOpen(page)).toBe(true)
    await expect(page.locator('#tab-list')).toBeVisible()

    await page.keyboard.up('Tab')
    await waitFrames(page, 2)
    expect(await isOpen(page)).toBe(false)
    await expect(page.locator('#tab-list')).toBeHidden()
  })

  test('it lists the roster, by the roster\'s own names', async ({ page }) => {
    const names = await rosterNames(page)
    // Two characters live here: the visitor and the NPC. If that ever grows,
    // this is the line that should notice.
    expect(names).toHaveLength(2)

    await page.keyboard.down('Tab')
    await waitFrames(page, 2)

    const listed = await rows(page)
    expect(listed.map((r) => r.name).sort()).toEqual(names)

    // And the DOM says the same thing -- the model being right is not proof
    // that anything was drawn from it.
    const drawn = await page.locator('#tab-panel .tab-name').allTextContents()
    expect(drawn.sort()).toEqual(names)

    // Every row gets a head and a ping icon, which is the row's whole anatomy.
    await expect(page.locator('#tab-panel .tab-head')).toHaveCount(2)
    await expect(page.locator('#tab-panel .tab-ping')).toHaveCount(2)

    await shot(page, 'tab-list')
    await page.keyboard.up('Tab')
  })

  /*
   * A rename has to travel. The roster is the source of truth and the overlay
   * holds no copy of a name, so renaming while it is OPEN must change what is
   * on screen -- and it must re-sort, because vanilla sorts by name.
   */
  test('a rename moves through to the open list', async ({ page }) => {
    /*
     * This is the one test here that mutates shared state, and it persists:
     * the local entry is `persist: true`, so setName writes localStorage and
     * the booted page is shared by the whole worker. Put back by hand, because
     * resetWorld does not know the roster exists -- and a spec that leaves the
     * visitor called Aardvark would break whatever runs next.
     */
    const original = await page.evaluate(() =>
      window.game.roster.displayNameOf(window.game.LOCAL_ID))

    await page.keyboard.down('Tab')
    await waitFrames(page, 2)

    const before = await page.locator('#tab-panel .tab-name').allTextContents()
    const chosen = await page.evaluate(() => {
      const g = window.game
      g.roster.setName(g.LOCAL_ID, 'Aardvark')
      return g.roster.displayNameOf(g.LOCAL_ID)
    })
    await waitFrames(page, 2)

    const after = await page.locator('#tab-panel .tab-name').allTextContents()
    expect(after).not.toEqual(before)
    expect(after).toContain(chosen)
    // Sorted by name, so the new one sorts to the front.
    expect(after[0]).toBe(chosen)

    await page.evaluate((name) => {
      window.game.roster.setName(window.game.LOCAL_ID, name)
      window.game.roster.forget()
    }, original)

    await page.keyboard.up('Tab')
  })

  /*
   * THE ONE THAT MATTERS. An overlay, not a screen.
   */
  test('holding Tab does not lock input or stop the player walking', async ({ page }) => {
    await page.keyboard.down('Tab')
    await waitFrames(page, 2)
    expect(await isOpen(page)).toBe(true)
    expect(await page.evaluate(() => window.game.inputLock.locked)).toBe(false)

    const [x0, , z0] = await position(page)
    await page.keyboard.down('KeyW')
    await waitTicks(page, 20)
    await page.keyboard.up('KeyW')
    const [x1, , z1] = await position(page)

    // A delta, never an absolute coordinate: the world axis is moving under us.
    const travelled = Math.hypot(x1 - x0, z1 - z0)
    expect(travelled).toBeGreaterThan(1)

    // And it is still open, having walked with it up.
    expect(await isOpen(page)).toBe(true)
    await page.keyboard.up('Tab')
  })

  /*
   * The ping buckets, from PlayerTabOverlay.renderPingIcon. Checked as pure
   * data because the thresholds are the part of this that a real transport
   * will one day depend on, and they are off-by-one bait.
   */
  test('ping buckets match vanilla thresholds', async ({ page }) => {
    const bars = await page.evaluate(async () => {
      const { pingBars } = await import('/src/tabList.js')
      return [-1, 0, 149, 150, 299, 300, 599, 600, 999, 1000, 5000].map(pingBars)
    })
    expect(bars).toEqual([0, 5, 5, 4, 4, 3, 3, 2, 2, 1, 1])

    // No server, so no latency, so vanilla singleplayer's full five bars.
    await page.keyboard.down('Tab')
    await waitFrames(page, 2)
    expect((await rows(page)).map((r) => r.bars)).toEqual([5, 5])
    await page.keyboard.up('Tab')
  })
})
