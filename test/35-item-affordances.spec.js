import { test, expect } from './fixtures.js'
import { useGamemode, waitTicks, teleport, look, settleOnGround } from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * What a slot tells you about what is in it.
 *
 * Two reports from one play session, and docs/REPORTED.md already noticed they
 * are the same missing affordance: an item has to show what it IS. Its shape,
 * as an icon -- "clicked a prismarine block in creative menu, started placing
 * them down: its stairs! Texture in inv is full block" -- and its name, on
 * hover, which vanilla does in every container.
 *
 * The icon half is asserted as GEOMETRY, not as "an icon exists". A cube and a
 * stair drawing the same three full-size faces is precisely the bug, so the
 * assertions are about how many faces there are, how big they are and where
 * they sit -- the numbers that were identical before this and have to differ
 * now. Every one of them fails if blockIcon.js goes back to drawing a unit
 * cube for everything.
 *
 * NOTE the icons are read through the real picker rather than by calling
 * createItemIcon in a page.evaluate: the bug was visible in the creative menu,
 * and a test that builds its own icon would pass even if the picker stopped
 * using them.
 */

const openPicker = async (page) => {
  await useGamemode(page, 'creative')
  await page.evaluate(() => window.game.inventoryScreen.setOpen(true))
  await waitTicks(page, 2)
}
const closeScreen = (page) => page.evaluate(() => window.game.inventoryScreen.setOpen(false))

/** Type into the Search tab, which is the only way to reach a named block. */
const search = async (page, query) => {
  await page.evaluate(() => window.game.inventoryScreen.creative.selectTab('search'))
  await page.fill('#creative-search', query)
  await waitTicks(page, 1)
}

/*
 * The faces of one visible list cell's icon, by block key.
 *
 * Sizes and offsets come from getComputedStyle, so they are resolved pixels --
 * what the browser actually drew -- rather than the `calc()` strings the code
 * wrote. The translation is the last column of the matrix3d the transform
 * resolves to: m41/m42/m43 are x, y (DOWN the screen) and z.
 */
const icons = (page) => page.evaluate(() => {
  const byId = new Map(window.game.creative.PICKER_ITEMS.map(i => [i.id, i.key]))
  const out = {}
  for (const cell of document.querySelectorAll('.creative-cell')) {
    if (!cell.dataset.item || cell.classList.contains('hidden')) continue
    const icon = cell.querySelector('.block-icon')
    if (!icon) continue
    out[byId.get(Number(cell.dataset.item))] = {
      // One block, in pixels. The CSS custom property reads back unresolved
      // (`calc(32px * 0.58)`), so it is measured off the icon instead.
      unit: parseFloat(getComputedStyle(icon).width) * 0.58,
      // How the front face slices its texture, which is the other half of
      // drawing the real shape.
      crop: getComputedStyle(icon.querySelector('.icon-front')).backgroundSize,
      faces: [...icon.querySelectorAll('.icon-face')].map((f) => {
        const s = getComputedStyle(f)
        const m = new DOMMatrix(s.transform)
        return {
          cls: [...f.classList].find(c => c !== 'icon-face'),
          texture: f.style.backgroundImage,
          w: Math.round(parseFloat(s.width) * 100) / 100,
          h: Math.round(parseFloat(s.height) * 100) / 100,
          x: Math.round(m.m41 * 100) / 100,
          y: Math.round(m.m42 * 100) / 100,
          z: Math.round(m.m43 * 100) / 100,
        }
      }),
    }
  }
  return out
})

const face = (icon, cls) => icon.faces.find(f => f.cls === `icon-${cls}`)

/*
 * One block's icon, found by searching for its key.
 *
 * Per key rather than one search for the family: the list draws 45 cells at a
 * time and "prismarine" matches more entries than that, so a single search
 * would answer `undefined` for whatever fell below the fold -- which reads
 * exactly like the icon being missing.
 */
const iconFor = async (page, key) => {
  await search(page, key)
  const found = (await icons(page))[key]
  expect(found, `no visible cell for ${key}`).toBeTruthy()
  return found
}

test.describe('the icon draws the block\'s real shape', () => {
  test('a cube is three full faces, a slab is half as tall, a stair is two boxes',
    async ({ page }) => {
      await openPicker(page)
      // The owner's own example, and the family really is keyed on the
      // BRICK: blocks.js cuts prismarine slabs and stairs from
      // `prismarine_bricks`, so `prismarine_slab` is not a block at all.
      const cube = await iconFor(page, 'prismarine_bricks')
      const slab = await iconFor(page, 'prismarine_brick_slab')
      const stairs = await iconFor(page, 'prismarine_brick_stairs')
      await closeScreen(page)

      // The three faces the cube always had, each a whole block square. This
      // is the shape the OTHER two were also drawing, which was the bug.
      expect(cube.faces).toHaveLength(3)
      for (const f of cube.faces) {
        expect(f.w).toBeCloseTo(cube.unit, 1)
        expect(f.h).toBeCloseTo(cube.unit, 1)
      }

      // A slab is still three faces, and its side is HALF as tall.
      expect(slab.faces).toHaveLength(3)
      expect(face(slab, 'front').h).toBeCloseTo(cube.unit / 2, 1)
      expect(face(slab, 'front').w).toBeCloseTo(cube.unit, 1)
      // ...and its top surface sits at mid-height, not at the top of the
      // block. Screen y grows DOWNWARD, so the slab's top face has the larger.
      expect(face(slab, 'top').y - face(cube, 'top').y).toBeCloseTo(cube.unit / 2, 1)

      /*
       * A stair is TWO boxes -- vanilla's own model, a bottom slab plus a
       * half-depth step -- so six faces. Both boxes are half a block tall,
       * which is why no upright face on a stair is ever full height, and the
       * two tops sit half a block apart with the upper one covering half the
       * footprint. A cube icon can satisfy none of that.
       */
      expect(stairs.faces).toHaveLength(6)
      for (const f of stairs.faces.filter(f => f.cls !== 'icon-top')) {
        expect(f.h).toBeCloseTo(cube.unit / 2, 1)
      }
      const [low, high] = stairs.faces.filter(f => f.cls === 'icon-top')
        .sort((a, b) => b.y - a.y)   // screen y grows downward: low first
      expect(low.y - high.y).toBeCloseTo(cube.unit / 2, 1)
      expect(low.w * low.h).toBeCloseTo(cube.unit * cube.unit, 0)
      expect(high.w * high.h).toBeCloseTo((cube.unit * cube.unit) / 2, 0)
    })

  test('the texture is CUT to the box, the way the real mesh cuts it', async ({ page }) => {
    await openPicker(page)
    const crops = {
      cube: (await iconFor(page, 'prismarine_bricks')).crop,
      slab: (await iconFor(page, 'prismarine_brick_slab')).crop,
    }
    await closeScreen(page)

    /*
     * A bottom slab's side shows the BOTTOM HALF of the texture, not the whole
     * texture squashed -- Minecraft's rule, and what blockMeshes.js does with
     * UVs when it builds the real block. Scaling the image to 200% vertically
     * with the face half as tall is the same cut expressed in CSS.
     */
    expect(crops.cube).toBe('100% 100%')
    expect(crops.slab).toBe('100% 200%')
  })

  /*
   * The furnace. "Furnace texture is wrong in the inventory", and it was: the
   * mouth is a `front` texture, `iconFaces()` in blocks.js answers with `top`
   * and `side` only, so sixteen blocks drew their plain side on all three
   * visible faces. Asserted as "the two upright faces differ", which is the
   * property a furnace-shaped block has and a stone-shaped one cannot.
   */
  const textures = (icon) => Object.fromEntries(icon.faces.map(f => [f.cls, f.texture]))

  test('a block with a front shows it, on the face vanilla shows it on',
    async ({ page }) => {
      await openPicker(page)
      const stone = textures(await iconFor(page, 'stone'))
      const furnace = textures(await iconFor(page, 'furnace'))
      await shot(page, 'furnace-icon')
      await closeScreen(page)

      // The mouth, on the front face -- which is the LEFT of the two upright
      // faces after the icon's fixed rotation, and the brighter one, which is
      // where vanilla's own furnace icon puts it.
      expect(furnace['icon-front']).toContain('furnace_front')
      expect(furnace['icon-side']).toContain('furnace_side')
      expect(furnace['icon-top']).toContain('furnace_top')
      // A block with one texture is unaffected: all three faces still agree.
      expect(new Set(Object.values(stone)).size).toBe(1)
    })

  test('every block with a distinct front draws it', async ({ page }) => {
    await openPicker(page)
    /*
     * The class, not the block. Sixteen definitions in blocks.js carry a
     * `front`, and all sixteen were drawing their side texture there. Built
     * from the block table rather than from a list typed out here, so a
     * seventeenth is covered the day it is declared.
     */
    const wrong = await page.evaluate(async () => {
      const { BLOCK_TYPES } = await import('/src/blocks.js')
      const { createItemIcon } = await import('/src/blockIcon.js')
      const out = []
      for (const b of BLOCK_TYPES.filter(d => d.front)) {
        const front = createItemIcon(b.id, 32).querySelector('.icon-front')
        if (!front.style.backgroundImage.includes(`${b.front}.png`)) out.push(b.key)
      }
      return { wrong: out, count: BLOCK_TYPES.filter(d => d.front).length }
    })
    await closeScreen(page)
    expect(wrong.wrong).toEqual([])
    expect(wrong.count).toBeGreaterThanOrEqual(16)
  })

  test('a stair family, seen', async ({ page }) => {
    await openPicker(page)
    await search(page, 'stairs')
    await shot(page, 'creative-stair-shapes')
    await closeScreen(page)
  })

  test('the picker lists one entry per family, not ten', async ({ page }) => {
    await openPicker(page)
    await search(page, 'prismarine_brick')
    const keys = await page.evaluate(() => {
      const byId = new Map(window.game.creative.PICKER_ITEMS.map(i => [i.id, i.key]))
      return [...document.querySelectorAll('.creative-cell')]
        .filter(c => c.dataset.item).map(c => byId.get(Number(c.dataset.item)))
    })
    await closeScreen(page)
    // No `_top`, no `_north_`, no `_east_`: the nine orientation variants of
    // every family are block ids and not items. What the owner hit was ten of
    // these in a row, all called "Prismarine Stairs", all drawn as cubes.
    expect(keys.filter(k => /_(top|north|south|east|west)_?/.test(k))).toEqual([])
    expect(keys.filter(k => k.startsWith('prismarine_brick_stairs')))
      .toEqual(['prismarine_brick_stairs'])
  })
})

/* ------------------------------------------------------------------ *
 * Picking one, and placing it.
 *
 * The end-to-end version of the collapse: the picker hands you the family's
 * canonical id and PLACEMENT chooses the variant, which is what makes one
 * entry enough. test/17-non-cube.spec.js owns the orientation table itself;
 * what is new here is the path from a click in the list to a correctly
 * oriented stair, with no variant ever named.
 * ------------------------------------------------------------------ */

const STAIRS_AT = { x: -2, y: 137, z: -3 }

test('picking stairs from the list places them oriented, four ways',
  async ({ page, terrain }) => {
    await terrain.keep([STAIRS_AT.x, STAIRS_AT.y, STAIRS_AT.z],
      [STAIRS_AT.x + 3, STAIRS_AT.y, STAIRS_AT.z])

    await openPicker(page)
    await search(page, 'prismarine_brick_stairs')
    // A real click on the real cell, through the real handler.
    const nth = await page.evaluate(() => {
      const byId = new Map(window.game.creative.PICKER_ITEMS.map(i => [i.id, i.key]))
      return [...document.querySelectorAll('.creative-cell')]
        .findIndex(c => byId.get(Number(c.dataset.item)) === 'prismarine_brick_stairs')
    })
    const box = await page.locator('.creative-cell').nth(nth).boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down({ button: 'middle' })   // middle-click: a full stack
    await page.mouse.up({ button: 'middle' })
    await page.mouse.move(400, 600)               // drop it into hotbar slot 0
    await page.locator('#creative-panel .gui-slot-main').first().click()
    await closeScreen(page)

    const held = await page.evaluate(async () => {
      const { BLOCK_TYPES } = await import('/src/blocks.js')
      const stack = window.game.inventory.slots[0]
      return BLOCK_TYPES.find(b => b.id === stack.id)?.key
    })
    // What you are holding is the FAMILY, not a variant. Nothing in the UI
    // ever offered `_north_top` and nothing put it in your hand.
    expect(held).toBe('prismarine_brick_stairs')

    const placed = await page.evaluate(async ({ x, y, z }) => {
      const noa = window.noa
      const { BLOCK_BY_ID } = await import('/src/blocks.js')
      const id = window.game.inventory.slots[0].id
      const out = []
      // Clicking the top face of the block below, from four directions --
      // the same four quarter turns test/17-non-cube.spec.js uses.
      for (const [i, heading] of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2].entries()) {
        noa._pickResult.position[1] = y
        noa.targetedBlock = { position: [x + i, y - 1, z], normal: [0, 1, 0], adjacent: [x + i, y, z] }
        noa.camera.heading = heading
        noa.setBlock(id, x + i, y, z)
        out.push(BLOCK_BY_ID.get(noa.getBlock(x + i, y, z)).shape)
      }
      noa.targetedBlock = null
      noa.camera.heading = 0
      return out
    }, STAIRS_AT)

    // Four placements, four orientations, all of them bottom-half stairs --
    // and the player chose none of them.
    expect(placed).toEqual(['stairs_south_bottom', 'stairs_west_bottom',
      'stairs_north_bottom', 'stairs_east_bottom'])

    await teleport(page, STAIRS_AT.x + 1.5, STAIRS_AT.y + 2, STAIRS_AT.z + 6)
    await settleOnGround(page)
    // Pitch is POSITIVE downward here, and six blocks back is far enough that
    // all four read at once.
    await look(page, { heading: Math.PI, pitch: 0.15 })
    await waitTicks(page, 3)
    await shot(page, 'stairs-placed-from-picker')
  })

/* ------------------------------------------------------------------ *
 * The hover tooltip.
 * ------------------------------------------------------------------ */

const tip = (page) => page.evaluate(() => {
  const el = document.getElementById('gui-tooltip')
  if (!el || el.classList.contains('hidden')) return null
  const box = el.getBoundingClientRect()
  const style = getComputedStyle(el)
  const inner = getComputedStyle(el.querySelector('.tip-inner'))
  return {
    lines: [...el.querySelectorAll('.tip-line')].map(l => l.textContent),
    left: Math.round(box.left), top: Math.round(box.top),
    right: Math.round(box.right), bottom: Math.round(box.bottom),
    background: style.backgroundColor,
    borderTop: inner.borderTopColor === 'rgba(0, 0, 0, 0)'
      ? inner.borderImageSource : inner.borderTopColor,
  }
})

/** Hover the middle of a slot, and report where the pointer ended up. */
const hover = async (page, selector, nth = 0) => {
  const box = await page.locator(selector).nth(nth).boundingBox()
  const at = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
  await page.mouse.move(at.x, at.y)
  return at
}

test.describe('hovering an item names it', () => {
  test('every container on the survival screen has one', async ({ page }) => {
    await useGamemode(page, 'survival')
    await page.evaluate(() => {
      const inv = window.game.inventory
      const stone = window.game.creative.PICKER_ITEMS.find(i => i.key === 'stone').id
      inv.add(stone, 5)                                // hotbar slot 0
      inv.slots[9] = { id: stone, count: 1 }           // main grid
      const helmet = window.game.creative.PICKER_ITEMS.find(i => i.key === 'iron_helmet')
      inv.armor[0] = { id: helmet.id, count: 1 }
      inv.emitChange()
    })
    await page.evaluate(() => window.game.inventoryScreen.setOpen(true))
    await waitTicks(page, 2)
    // AFTER opening: show() calls setCraftSize, which reallocates the grid.
    await page.evaluate(() => {
      const inv = window.game.inventory
      inv.craft.cells[0] = { id: inv.slots[0].id, count: 1 }
      inv.emitChange()
    })

    const named = async (selector, nth) => {
      await hover(page, selector, nth)
      return (await tip(page))?.lines[0]
    }
    // The hotbar row, the 3x9 above it, the armor column and the crafting
    // grid: four containers on one screen, and before this exactly none of
    // them said anything.
    expect(await named('#inv-panel .gui-slot-main', 27)).toBe('Stone')  // hotbar 0
    expect(await named('#inv-panel .gui-slot-main', 0)).toBe('Stone')   // main grid
    expect(await named('#inv-panel .gui-slot-armor', 0)).toBe('Iron Helmet')
    expect(await named('#inv-panel .gui-slot-craft', 0)).toBe('Stone')

    // Shot while something is actually hovered -- the empty-slot check below
    // leaves the screen with no tooltip on it, which is the picture nobody
    // needs.
    await hover(page, '#inv-panel .gui-slot-main', 27)
    await shot(page, 'inventory-tooltip')

    // An empty slot says nothing at all.
    await hover(page, '#inv-panel .gui-slot-main', 26)
    expect(await tip(page)).toBeNull()
    await closeScreen(page)
  })

  test('it sits where vanilla puts it, in vanilla\'s colours', async ({ page }) => {
    await useGamemode(page, 'survival')
    await page.evaluate(() => {
      window.game.inventory.add(window.game.creative.PICKER_ITEMS.find(i => i.key === 'stone').id, 1)
    })
    await page.evaluate(() => window.game.inventoryScreen.setOpen(true))
    await waitTicks(page, 2)

    const at = await hover(page, '#inv-panel .gui-slot-main', 27)
    const t = await tip(page)
    await closeScreen(page)

    /*
     * Vanilla's text origin is 12 GUI px right of the cursor and 12 above it,
     * with the box reaching 4 GUI px further on each side. At SCALE 2 that is
     * a box 16 real px to the right and 32 above. Anything else and the box
     * is not where a Minecraft player's eye already is.
     */
    expect(t.left).toBe(at.x + 16)
    expect(t.top).toBe(at.y - 32)
    // 0xF0100010 and 0x505000FF, sampled off vanilla's own tooltip sprites.
    expect(t.background).toBe('rgba(16, 0, 16, 0.94)')
    expect(t.borderTop).toContain('rgba(80, 0, 255, 0.314)')
  })

  test('near an edge it flips and stays on screen', async ({ page }) => {
    const size = page.viewportSize()
    try {
      await useGamemode(page, 'creative')
      await page.evaluate(() => window.game.inventoryScreen.setOpen(true))
      await waitTicks(page, 2)
      // Narrow enough that a tooltip opened to the RIGHT of a cell in the
      // middle of the panel would run off the edge. 1.19.3 (22w42a): "Long
      // tooltips no longer get cut off at the edge of the screen."
      await page.setViewportSize({ width: 520, height: 400 })
      await waitTicks(page, 2)

      const at = await hover(page, '.creative-cell', 8)
      const t = await tip(page)
      expect(t).not.toBeNull()
      expect(t.right).toBeLessThanOrEqual(520)
      expect(t.left).toBeGreaterThanOrEqual(0)
      expect(t.top).toBeGreaterThanOrEqual(0)
      // Flipped to the cursor's left rather than merely clamped against the
      // edge, so the box never covers the slot it is describing.
      expect(t.right).toBeLessThanOrEqual(at.x)
      await closeScreen(page)
    } finally {
      await page.setViewportSize(size)
      await waitTicks(page, 2)
    }
  })

  test('the creative list names the item, and carrying a stack silences it',
    async ({ page }) => {
      await openPicker(page)
      await search(page, 'prismarine_brick_stairs')

      // The cell the report is about. It says "Prismarine Stairs" and there
      // is now exactly one of it, so the name is the whole answer -- no block
      // key, which is what the tooltip used to have to carry.
      const nth = await page.evaluate(() => {
        const byId = new Map(window.game.creative.PICKER_ITEMS.map(i => [i.id, i.key]))
        return [...document.querySelectorAll('.creative-cell')]
          .findIndex(c => byId.get(Number(c.dataset.item)) === 'prismarine_brick_stairs')
      })
      expect(nth).toBeGreaterThanOrEqual(0)
      await hover(page, '.creative-cell', nth)
      expect((await tip(page)).lines).toEqual(['Prismarine Brick Stairs'])
      await shot(page, 'creative-tooltip')

      // Vanilla renders no tooltip while the cursor carries a stack -- the
      // box would sit under the thing you are dragging.
      await page.evaluate(() => {
        window.game.inventory.carried = { id: 3, count: 1 }
        window.game.inventory.emitChange()
      })
      await hover(page, '.creative-cell', nth + 1)
      expect(await tip(page)).toBeNull()

      await page.evaluate(() => {
        window.game.inventory.carried = null
        window.game.inventory.emitChange()
      })
      await closeScreen(page)
    })

  test('closing the screen takes the tooltip with it', async ({ page }) => {
    await openPicker(page)
    await hover(page, '.creative-cell', 0)
    expect(await tip(page)).not.toBeNull()
    await closeScreen(page)
    // No mouseleave ever fires here: the pointer does not move, the screen
    // goes away underneath it.
    expect(await tip(page)).toBeNull()
  })
})
