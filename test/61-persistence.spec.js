import { test, expect } from '@playwright/test'
import { bootWorld, reloadWorld, waitForWorld, chatCommand, waitTicks } from './helpers/world.js'

/*
 * A WORLD THAT STAYS CHANGED, and the names a visitor may give themselves.
 *
 * NOT the shared booted world from fixtures.js. Persistence is opt-in under
 * automation (see the header of src/persistence.js: the shared world is reset
 * between ~900 tests and must not remember them), so each test here gets a
 * FRESH browser context, opts in before the page loads, and reloads for real.
 * A fresh context is also the only honest model of "a visitor comes back":
 * IndexedDB and localStorage are all that cross the reload.
 *
 * NO COORDINATE'S CONTENTS ARE ASSUMED. The landscape is being rebuilt by
 * other work, so every test asks the generator (`game.voxelAt`) what is at a
 * coordinate and picks a block that differs from it.
 */

const optIn = (page) => page.addInitScript(() => localStorage.setItem('world:persist', '1'))

async function boot(page) {
  await optIn(page)
  await bootWorld(page)
}

/** A block key that differs from what the generator put at x,y,z. */
const otherThan = (page, x, y, z) => page.evaluate(([x, y, z]) => {
  const g = window.game
  return g.blockKey(g.voxelAt(x, y, z)) === 'stone' ? 'dirt' : 'stone'
}, [x, y, z])

const blockKeyAt = (page, x, y, z) => page.evaluate(([x, y, z]) =>
  window.game.blockKey(window.noa.getBlock(x, y, z)), [x, y, z])

/** Write a save straight into IndexedDB, the way a previous visit would have. */
const plantSave = (page, record) => page.evaluate((record) => new Promise((resolve, reject) => {
  // The page's own autosave would otherwise overwrite this before the reload.
  window.game?.persist?.pause()
  const open = indexedDB.open('world', 1)
  open.onupgradeneeded = () => open.result.createObjectStore('saves')
  open.onsuccess = () => {
    const tx = open.result.transaction('saves', 'readwrite')
    tx.objectStore('saves').put(record, 'local')
    tx.oncomplete = () => { open.result.close(); resolve() }
    tx.onerror = () => reject(tx.error)
  }
  open.onerror = () => reject(open.error)
}), record)

test.describe('persistence', () => {
  test('under automation it is off unless the page opts in', async ({ page }) => {
    await bootWorld(page)
    expect(await page.evaluate(() => window.game.persist.enabled)).toBe(false)
  })

  test('reload keeps block edits, inventory, time and position', async ({ page }) => {
    await boot(page)
    expect(await page.evaluate(() => window.game.persist.enabled)).toBe(true)

    const placeKey = await otherThan(page, 3, 137, 3)
    const breakAt = [4, 135, 4]
    await page.evaluate(([placeKey, [bx, by, bz]]) => {
      const { ids, inventory, sky } = window.game
      window.noa.setBlock(ids[placeKey], 3, 137, 3)
      window.noa.setBlock(0, bx, by, bz)
      inventory.slots.fill(null)
      inventory.add(ids.glass, 7)
      sky.setTime(18000)
      window.noa.ents.setPosition(window.noa.playerEntity, [6.5, 137, 6.5])
    }, [placeKey, breakAt])
    await waitTicks(page, 2)
    expect(await page.evaluate(() => window.game.persist.editCount())).toBe(2)
    await page.evaluate(() => window.game.persist.saveLocal())

    await reloadWorld(page)

    expect(await blockKeyAt(page, 3, 137, 3)).toBe(placeKey)
    expect(await blockKeyAt(page, ...breakAt)).toBe('air')
    const after = await page.evaluate(() => {
      const g = window.game
      const [x, , z] = window.noa.ents.getPosition(window.noa.playerEntity)
      return {
        slot0: g.inventory.slots[0] && { key: g.blockKey(g.inventory.slots[0].id), count: g.inventory.slots[0].count },
        // The starter kit is for first visits only.
        planks: g.inventory.slots.filter((s) => s?.id === g.ids.planks).length,
        time: g.sky.getTime(), x, z,
      }
    })
    expect(after.slot0).toEqual({ key: 'glass', count: 7 })
    expect(after.planks).toBe(0)
    expect(Math.abs(after.time - 18000)).toBeLessThan(400)
    expect(after.x).toBeCloseTo(6.5, 0)
    expect(after.z).toBeCloseTo(6.5, 0)
  })

  test('putting a block back the way it was removes the edit from the save', async ({ page }) => {
    await boot(page)
    const original = await page.evaluate(() => window.game.voxelAt(5, 137, 5))
    const key = await otherThan(page, 5, 137, 5)
    await page.evaluate(([key, original]) => {
      window.noa.setBlock(window.game.ids[key], 5, 137, 5)
      window.noa.setBlock(original, 5, 137, 5)
    }, [key, original])
    expect(await page.evaluate(() => window.game.persist.editCount())).toBe(0)
  })

  test('an edit whose ground changed under it is dropped; the rest survive', async ({ page }) => {
    await optIn(page)
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => !!window.game, null, { timeout: 30_000 })

    const plan = await page.evaluate(() => {
      const g = window.game
      const key = (x, y, z) => g.blockKey(g.voxelAt(x, y, z))
      const differ = (k) => (k === 'stone' ? 'dirt' : 'stone')
      const here = key(2, 136, 7)
      const there = key(7, 136, 2)
      return {
        // Recorded against the ground the generator still produces.
        valid: [2, 136, 7, differ(here), here],
        // Recorded against ground that is no longer there: a landscape change.
        stale: [7, 136, 2, differ(there), there === 'bedrock' ? 'gravel' : 'bedrock'],
        there,
        gen: g.persist.generationId(),
      }
    })

    await plantSave(page, { syncedRev: 0, dirty: false, owner: null, save: {
      v: 1, updatedAt: Date.now(), state: null,
      worlds: { overworld: { gen: plan.gen, edits: [plan.valid, plan.stale] } },
    } })
    await reloadWorld(page)

    expect(await blockKeyAt(page, 2, 136, 7)).toBe(plan.valid[3])
    expect(await blockKeyAt(page, 7, 136, 2)).toBe(plan.there)
    expect(await page.evaluate(() => window.game.persist.dropped)).toBeGreaterThanOrEqual(1)
    expect(await page.evaluate(() => window.game.persist.editCount())).toBe(1)
  })

  test('a changed generation id sends you to spawn instead of your old position', async ({ page }) => {
    await optIn(page)
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => !!window.game, null, { timeout: 30_000 })
    const gen = await page.evaluate(() => window.game.persist.generationId())

    const state = { dimension: 'overworld', position: [9.5, 137, 9.5], time: 6000 }
    await plantSave(page, { syncedRev: 0, dirty: false, owner: null,
      save: { v: 1, updatedAt: Date.now(), state, worlds: { overworld: { gen, edits: [] } } } })
    await reloadWorld(page)
    let [x, , z] = await page.evaluate(() => window.noa.ents.getPosition(window.noa.playerEntity))
    expect([x, z].map(Math.round)).toEqual([10, 10])

    await plantSave(page, { syncedRev: 0, dirty: false, owner: null,
      save: { v: 1, updatedAt: Date.now(), state, worlds: { overworld: { gen: 'g1-another-world', edits: [] } } } })
    await reloadWorld(page)
    ;[x, , z] = await page.evaluate(() => window.noa.ents.getPosition(window.noa.playerEntity))
    expect([x, z]).toEqual([0.5, 0.5])
  })
})

test.describe('nicknames', () => {
  test('/nick renames you, refuses Evan and staff names, and the name survives a reload', async ({ page }) => {
    await boot(page)
    const refused = await chatCommand(page, '/nick Evan')
    expect(refused.at(-1)).toMatchObject({ kind: 'error', text: 'That name belongs to Evan. Pick another?' })
    expect((await chatCommand(page, '/nick Admin')).at(-1).kind).toBe('error')
    expect(await page.evaluate(() => window.game.roster.displayNameOf(window.game.LOCAL_ID))).toBe('Guest')

    const ok = await chatCommand(page, '/nick Robin')
    expect(ok.at(-1)).toMatchObject({ kind: 'system', text: 'You are now Robin' })

    await reloadWorld(page)
    expect(await page.evaluate(() => window.game.roster.displayNameOf(window.game.LOCAL_ID))).toBe('Robin')
  })

  test('the profile screen in the pause menu sets a name and explains a refusal', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => window.game.menu.open())
    await expect(page.locator('#profile-open')).toHaveText('Profile: Guest')
    await page.click('#profile-open')
    await expect(page.locator('#profile')).toBeVisible()
    // Offline (no Worker under vite), so no sign-in buttons are offered.
    await expect(page.locator('#profile-auth button')).toHaveCount(0)
    await expect(page.locator('#profile-status')).toContainText('guest')

    await page.fill('#profile-name', 'EvanJolley')
    await page.click('#profile-save')
    await expect(page.locator('#profile-error')).toHaveText('That name belongs to Evan. Pick another?')

    await page.fill('#profile-name', 'Casey')
    await page.press('#profile-name', 'Enter')
    await expect(page.locator('#profile-error')).toHaveText('')
    expect(await page.evaluate(() => window.game.roster.displayNameOf(window.game.LOCAL_ID))).toBe('Casey')

    await page.click('#profile-done')
    await expect(page.locator('#profile')).toBeHidden()
    await expect(page.locator('#profile-open')).toHaveText('Profile: Casey')
  })
})

test.describe('what blocks hold', () => {
  test('sign text, a hung painting and a furnace\'s contents survive a reload', async ({ page }) => {
    await boot(page)
    const plan = await page.evaluate(() => {
      const g = window.game
      const { ids } = g
      const facing = ['north', 'south', 'east', 'west'].find((f) => ids[`painting_wall_${f}`] !== undefined)
      // A sign, a painting and a furnace, each where the generator put air.
      window.noa.setBlock(ids.oak_sign, 2, 137, 9)
      g.signs.setSignText(2, 137, 9, ['Casey', 'was', 'here', ''])
      window.noa.setBlock(ids[`painting_wall_${facing}`], 4, 138, 9)
      g.paintings.registerPainting(4, 138, 9, facing, 'kebab')
      window.noa.setBlock(ids.furnace, 6, 137, 9)
      const f = g.inventory.furnaces.at([6, 137, 9], 'furnace')
      // Fuel and output but no input, so it cannot burn while the test waits.
      f.slots[2] = { id: g.itemId('stone'), count: 3 }
      f.slots[1] = { id: g.itemId('coal'), count: 2 }
      return { facing, tiles: g.persist.tiles() }
    })
    expect(plan.tiles.signs).toHaveLength(1)
    expect(plan.tiles.paintings).toEqual([[4, 138, 9, plan.facing, 'kebab']])
    expect(plan.tiles.furnaces).toHaveLength(1)
    await page.evaluate(() => window.game.persist.saveLocal())

    await reloadWorld(page)

    const after = await page.evaluate(() => {
      const g = window.game
      const f = g.inventory.furnaces.peek([6, 137, 9])
      return {
        sign: g.signs.signTextAt?.(2, 137, 9)?.lines ?? null,
        painting: g.paintings.paintingAt(4, 138, 9)?.name ?? null,
        furnace: f && f.slots.map((s) => s && { key: g.blockKey(s.id) === 'air' ? s.id : g.blockKey(s.id), count: s.count }),
      }
    })
    expect(after.sign).toEqual(['Casey', 'was', 'here', ''])
    expect(after.painting).toBe('kebab')
    expect(after.furnace?.[2]).toEqual({ key: 'stone', count: 3 })
    expect(after.furnace?.[1]?.count).toBe(2)
  })
})

test.describe('forget me', () => {
  test('confirms in-game, then wipes the world, the name and the visitor id', async ({ page }) => {
    await boot(page)
    let dialogs = 0
    page.on('dialog', (d) => { dialogs++; d.dismiss() })
    await chatCommand(page, '/nick Robin')
    const key = await otherThan(page, 3, 137, 3)
    await page.evaluate((key) => {
      window.noa.setBlock(window.game.ids[key], 3, 137, 3)
      return window.game.persist.saveLocal()
    }, key)
    // AI Evan's local visitor id, as aiEvan.js would have minted it.
    const idBefore = 'AAAAAAAAAAAAAAAAAAAAAAAA'
    await page.evaluate((id) => localStorage.setItem('world:v1:visitor-id', id), idBefore)

    await page.evaluate(() => window.game.menu.open())
    await page.click('#profile-open')
    await page.click('#profile-forget')
    await expect(page.locator('#profile-confirm')).toBeVisible()
    // Cancel really cancels.
    await page.click('#profile-forget-no')
    await expect(page.locator('#profile-confirm')).toBeHidden()
    expect(await page.evaluate(() => window.game.roster.displayNameOf(window.game.LOCAL_ID))).toBe('Robin')

    await page.click('#profile-forget')
    await Promise.all([
      page.waitForEvent('load', { timeout: 30_000 }),
      page.click('#profile-forget-yes'),
    ])
    await waitForWorld(page)

    expect(dialogs).toBe(0)
    expect(await page.evaluate(() => window.game.roster.displayNameOf(window.game.LOCAL_ID))).toBe('Guest')
    expect(await blockKeyAt(page, 3, 137, 3)).not.toBe(key)
    expect(await page.evaluate(() => window.game.persist.editCount())).toBe(0)
    const idAfter = await page.evaluate(() => localStorage.getItem('world:v1:visitor-id'))
    expect(idAfter).not.toBe(idBefore)
  })
})
