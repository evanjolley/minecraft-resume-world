import { test, expect } from './fixtures.js'
import { shotRegion } from './helpers/shots.js'

/*
 * Counts, not pixels. Health and food are stored in HALF units (20 = 10
 * icons), which is the exact place this kind of HUD goes wrong -- rendering
 * value/2 rounded gives 10 icons too, right up until someone takes a
 * half-heart of damage and it vanishes.
 */
const count = (page, sel) => page.locator(sel).count()

test.describe('HUD', () => {
  test('the health bar is 10 hearts, not 20', async ({ page }) => {
    expect(await count(page, '#hearts .icon-slot')).toBe(10)
  })

  test('the hunger bar is 10 food icons', async ({ page }) => {
    expect(await count(page, '#hunger .icon-slot')).toBe(10)
  })

  test('the hotbar has 9 slots', async ({ page }) => {
    expect(await count(page, '#hotbar .hotbar-slot')).toBe(9)
  })

  test('the inventory screen has all 36 slots, hotbar included', async ({ page }) => {
    // 36 = 27 grid + the 9 hotbar slots, which are the SAME nine slots as the
    // hotbar above. Building them as two arrays is the bug this pins.
    expect(await count(page, '#inv-panel .slot')).toBe(36)
  })

  test('half a heart of damage still renders as a half heart', async ({ page }) => {
    await page.evaluate(() => window.game.survival.damage(1))
    const opacities = await page.locator('#hearts .icon-slot .fill')
      .evaluateAll(els => els.map(e => ({ img: e.style.backgroundImage, op: e.style.opacity })))

    // 19 health: nine full hearts then one half, none hidden.
    expect(opacities.slice(0, 9).every(o => o.img.includes('heart_full.png'))).toBe(true)
    expect(opacities[9].img).toContain('heart_half.png')
    expect(opacities[9].op).toBe('1')
  })

  test('taking damage empties hearts from the right', async ({ page }) => {
    await page.evaluate(() => window.game.survival.damage(6))
    const shown = await page.locator('#hearts .icon-slot .fill')
      .evaluateAll(els => els.map(e => e.style.opacity !== '0'))
    expect(shown).toEqual([...Array(7).fill(true), ...Array(3).fill(false)])
  })

  /* ---------------- the held item's name ---------------- */

  /*
   * WHERE MINECRAFT ACTUALLY DRAWS IT. Gui.renderSelectedItemName puts the name
   * at y = screenHeight - 59, and renderHotbar blits the hotbar at
   * screenHeight - 22 -- so the name's 9px font line occupies 50..59 GUI pixels
   * up from the bottom of the screen, which is the bottom of #hud. The hearts
   * and hunger sit at 30..39.
   *
   * These are NUMBERS and not a screenshot on purpose: "it looks clear of the
   * hearts" is the check that let it land on them in the first place. The name
   * used to be a flow item in the HUD's column, so it dropped onto the heart
   * row whenever the armor row above it collapsed, and a margin nudged until
   * they stopped touching would pass a screenshot and fail again at a different
   * SCALE.
   *
   * Which is why the scale is READ BACK off the hotbar sprite -- 22 GUI px tall
   * by definition -- instead of being hardcoded at 2. This file then pins
   * Minecraft's offsets rather than hud.js's SCALE.
   */
  const HOTBAR_GUI_H = 22
  const NAME_BOTTOM = 50, NAME_TOP = 59
  const ARMOR_TOP = 49

  const intersects = (a, b) =>
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

  const boxes = (page) => page.evaluate(() => {
    const box = (sel) => {
      const { top, bottom, left, right, height } = document.querySelector(sel).getBoundingClientRect()
      return { top, bottom, left, right, height }
    }
    return {
      held: box('#held-name'), hearts: box('#hearts'), hunger: box('#hunger'),
      armor: box('#armor-row'), hotbar: box('#hotbar'),
    }
  })

  /*
   * Flash the name. Driven through the inventory rather than by pressing a
   * hotbar key, so a change to interact.js's bindings cannot make this file
   * fail for a reason that has nothing to do with the HUD.
   */
  const showHeldName = async (page) => {
    await page.evaluate(() => {
      const inv = window.game.inventory
      inv.add(5, 64)          // planks, slot 0
      inv.add(4, 12)          // cobblestone, slot 1
      inv.selected = 1
      inv.emitChange()
    })
    await expect(page.locator('#held-name')).toHaveText('Cobblestone')
  }

  test('the held item name is drawn where Minecraft draws it', async ({ page }) => {
    await showHeldName(page)
    const r = await boxes(page)
    const gui = r.hotbar.height / HOTBAR_GUI_H

    // Minecraft's own offsets. Both ends, because only pinning the bottom edge
    // would let the line box grow upwards unnoticed.
    expect((r.hotbar.bottom - r.held.bottom) / gui, 'the name is not on vanilla\'s row')
      .toBeCloseTo(NAME_BOTTOM, 3)
    expect((r.hotbar.bottom - r.held.top) / gui).toBeCloseTo(NAME_TOP, 3)

    // ...and what those offsets are for.
    expect(intersects(r.held, r.hearts), 'the name overlaps the hearts').toBe(false)
    expect(intersects(r.held, r.hunger), 'the name overlaps the hunger row').toBe(false)

    // Touching exactly is still wrong, and would pass the two checks above.
    // Vanilla leaves eleven GUI pixels here; anything under one is a collision
    // that has not happened yet.
    expect((r.hearts.top - r.held.bottom) / gui, 'no clear GUI pixel above the hearts')
      .toBeGreaterThanOrEqual(1)
  })

  test('the name holds its row when the armor bar appears', async ({ page }) => {
    /*
     * Vanilla anchors the name to the bottom of the SCREEN, not to whatever is
     * under it, so putting armor on does not push it up -- the armor row slots
     * into the gap that was always there, at 40..49.
     *
     * The row is forced visible rather than earned by equipping real armor:
     * the question is layout, and armorPoints() is 04's business only insofar
     * as it toggles this class. hud.js re-toggles it on the next inventory
     * change, which resetWorld provides.
     */
    await showHeldName(page)
    const before = await boxes(page)
    await page.evaluate(() => document.getElementById('armor-row').classList.remove('hidden'))
    const after = await boxes(page)
    const gui = after.hotbar.height / HOTBAR_GUI_H

    expect(after.held.bottom, 'the armor row shoved the name').toBe(before.held.bottom)
    expect((after.hotbar.bottom - after.armor.top) / gui).toBeCloseTo(ARMOR_TOP, 3)
    expect(intersects(after.held, after.armor), 'the name overlaps the armor row').toBe(false)
  })

  test('the HUD strip looks like Minecraft', async ({ page }) => {
    // Visual. Sprite alignment (the hotbar selection sits at -1,-1 GUI px, the
    // icons overlap by a pixel) is a pixel judgement; asserting the CSS `left`
    // values back would just restate hud.js rather than check it.
    await page.evaluate(() => {
      window.game.inventory.add(5, 64)
      window.game.inventory.add(4, 12)
      window.game.survival.damage(3)
    })
    await shotRegion(page, 'hud-strip', 'hud')
  })

  test('the held item name looks right above the bar', async ({ page }) => {
    // Evidence for the one thing the arithmetic above cannot answer: whether
    // the text reads as part of the same HUD once it is off the hearts.
    await page.evaluate(() => window.game.survival.damage(3))
    await showHeldName(page)
    await shotRegion(page, 'hud-held-name', 'hud')
  })
})
