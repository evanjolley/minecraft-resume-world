import { test, expect } from './fixtures.js'
import { useGamemode, waitTicks, waitFrames } from './helpers/world.js'
import { shot, shotRegion } from './helpers/shots.js'

/*
 * THE SIGN AS AN ITEM, which is two of Evan's four reports on signs and ONE
 * bug underneath them:
 *
 *   "1. wood block texture in hand"
 *   "2. clipped texture in inventory"
 *
 * Neither is about the hand or the slot. `item/oak_sign.png` had never been
 * extracted, so blocks.js left `flatItem` off (its own comment said so, and
 * said why), and a block item with no `flat` flag is drawn by all three
 * renderers as a little cube of its block texture -- which for a sign is
 * `oak_planks`. A plank cube in the hand is report 1. The same plank cube
 * behind a slot's inset is report 2, because a cube icon is drawn at 0.58 of
 * the cell and a sprite is drawn at 1.0, so the cube reads as a crop.
 *
 * So the assertions here go at the CAUSE and at each of the three renderers
 * separately, because "flat" is answered three times in three files and this
 * world has already shipped a fix that landed in one of them:
 *
 *   - the sprite EXISTS and is sign-shaped, not plank-shaped;
 *   - the inventory icon is a sprite, with no cube faces in it;
 *   - the first-person viewmodel is in `item` mode, not `block` mode.
 *
 * The sprite-shape check is the one that would survive somebody "fixing" this
 * by marking the flag and leaving the art out, which is the exact failure
 * blocks.js's old comment predicted. A plank tile is 16x16 of opaque wood; a
 * sign sprite is a board on a post with transparent corners. Counting
 * transparent corners tells those two apart and nothing else here does.
 */

const SPRITE = '/textures/item/oak_sign.png'

/** Put one item in the selected slot and wait for its geometry. 15-held's. */
async function hold(page, key) {
  await page.evaluate((k) => {
    const g = window.game
    g.inventory.slots.fill(null)
    if (k) g.inventory.add(g.itemId(k), 1)
    g.inventory.select(0)
    g.inventory.emitChange()
  }, key)
  await page.waitForFunction(() => {
    const g = window.game
    return g.held.mode !== 'item' || g.held.item.getTotalVertices() > 0
  }, null, { timeout: 10_000, polling: 20 })
  await waitTicks(page, 3)
  await waitFrames(page, 3)
}

/**
 * Decode a texture in the page and report its alpha, per pixel.
 *
 * In the PAGE rather than in node, deliberately: node could read the file off
 * disk and pass while the dev server served a 404, and a 404 sprite is
 * precisely the failure mode being guarded against. This goes through the
 * same URL the renderers do.
 */
const alphaOf = (page, url) => page.evaluate(async (src) => {
  const res = await fetch(src)
  if (!res.ok) return { status: res.status }
  const bmp = await createImageBitmap(await res.blob())
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  const ctx = c.getContext('2d')
  ctx.drawImage(bmp, 0, 0)
  const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height)
  const opaque = []
  for (let y = 0; y < bmp.height; y++) {
    const row = []
    for (let x = 0; x < bmp.width; x++) row.push(data[(y * bmp.width + x) * 4 + 3] > 8)
    opaque.push(row)
  }
  return { status: res.status, w: bmp.width, h: bmp.height, opaque }
}, url)

test.describe('the sign item has art of its own', () => {
  test('the sprite is a board on a post, not a plank tile', async ({ page }) => {
    const sign = await alphaOf(page, SPRITE)
    const planks = await alphaOf(page, '/textures/oak_planks.png')

    expect(sign.status, `${SPRITE} did not serve`).toBe(200)
    expect(sign.w).toBe(16)
    expect(sign.h).toBe(16)

    /*
     * The sample first, because an all-transparent image would satisfy every
     * "is transparent" assertion below and an empty one would satisfy all of
     * them. Vanilla's sprite is 132 opaque texels of 256 (a 13x9 board plus a 3x5
     * post); asserted as a band
     * rather than exactly, since the count is the pack's business and the
     * SHAPE is the claim.
     */
    const count = sign.opaque.flat().filter(Boolean).length
    expect(count).toBeGreaterThan(100)
    expect(count).toBeLessThan(200)

    // A plank tile is the thing it used to be, and it is solid. If this ever
    // fails the comparison below has stopped meaning anything.
    expect(planks.opaque.flat().every(Boolean)).toBe(true)

    // The four corners of a sign are sky. The four corners of a plank are wood.
    for (const [x, y] of [[0, 0], [15, 0], [0, 15], [15, 15]]) {
      expect(sign.opaque[y][x], `sign sprite is opaque at ${x},${y}`).toBe(false)
    }

    /*
     * And the silhouette itself: a wide row across the board (y = 6) and a
     * narrow one across the post (y = 13). Vanilla's own numbers -- a 13-wide
     * board at x 2..14 and a 3-wide post at x 7..9 -- so this also catches the
     * sprite being replaced by some other item's art that happens to have
     * transparent corners.
     */
    const width = (row) => row.filter(Boolean).length
    expect(width(sign.opaque[6])).toBe(13)
    expect(width(sign.opaque[13])).toBe(3)
    expect(sign.opaque[6][1]).toBe(false)
    expect(sign.opaque[6][2]).toBe(true)
    expect(sign.opaque[13][6]).toBe(false)
    expect(sign.opaque[13][7]).toBe(true)
  })

  test('the inventory icon is a sprite, not a cube', async ({ page }) => {
    await useGamemode(page, 'creative')
    await page.evaluate(() => window.game.inventoryScreen.setOpen(true))
    await page.evaluate(() => window.game.inventoryScreen.creative.selectTab('search'))
    await page.fill('#creative-search', 'oak_sign')
    await waitTicks(page, 2)

    const icon = await page.evaluate(() => {
      const id = window.game.itemId('oak_sign')
      for (const cell of document.querySelectorAll('.creative-cell')) {
        if (Number(cell.dataset.item) !== id || cell.classList.contains('hidden')) continue
        const flat = cell.querySelector('.item-icon')
        const cube = cell.querySelector('.block-icon')
        return {
          found: true,
          flat: !!flat,
          faces: cube ? cube.querySelectorAll('.icon-face').length : 0,
          image: flat ? getComputedStyle(flat).backgroundImage : null,
        }
      }
      return { found: false }
    })

    expect(icon.found, 'no visible creative cell for oak_sign').toBe(true)
    /*
     * WHAT THIS TEST DOES NOT CATCH, established by running the mutation
     * rather than by reasoning about it: deleting the sprite from the build
     * (by sending `flatFrom` back to `block`) leaves every assertion in this
     * test PASSING. A CSS background-image that 404s still resolves to the
     * URL string, so the icon is still "a sprite" by every question asked
     * here and is an empty square on screen. The pixels are the first test's
     * job and only the first test's job; this one is about SHAPE -- three
     * faces of oak_planks, which is exactly what report 2 was looking at.
     */
    expect(icon.faces).toBe(0)
    expect(icon.flat).toBe(true)
    expect(icon.image).toContain('item/oak_sign.png')

    await shotRegion(page, 'sign-item-inventory', 'centre')
    await page.evaluate(() => window.game.inventoryScreen.setOpen(false))
  })

  test('the hand holds a sprite, not a block', async ({ page }) => {
    await useGamemode(page, 'creative')
    await hold(page, 'oak_sign')

    const held = await page.evaluate(() => {
      const h = window.game.held
      return {
        mode: h.mode,
        block: h.block.isEnabled(),
        item: h.item.isEnabled(),
        texture: h.item.material?.diffuseTexture?.name ?? null,
      }
    })

    // `block` was the mode before the sprite existed, and it is report 1.
    expect(held.mode).toBe('item')
    expect(held.block).toBe(false)
    expect(held.item).toBe(true)
    expect(held.texture).toContain('item/oak_sign.png')

    await shot(page, 'sign-item-in-hand')
  })
})
