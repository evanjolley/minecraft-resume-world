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
})
