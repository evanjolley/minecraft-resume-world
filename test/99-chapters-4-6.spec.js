/*
 * CHAPTERS 4, 5 AND 6: STAMPED, BOUNDED, READ BACK AND PHOTOGRAPHED.
 *
 * ------------------------------------------------------------------------
 * Until the landscape pass wires these three builds into the overworld they
 * live in a test-only world (test/helpers/previewWorld.js). Everything here
 * runs against that world, stamped in the page by the same code the game
 * runs -- a build file imports src/signText.js, which only vite can resolve,
 * so node never loads one (see test/helpers/previewLayout.js).
 *
 *   1. EACH BUILD STAMPS, AND STAYS IN ITS 74 x 76. The stamper already
 *      throws on a write outside the plot; this also checks each SIZE is
 *      within the sprint's limit, that each build actually placed blocks,
 *      and that nothing outside the three rectangles changed.
 *   2. THE WORDS, DECODED FROM THE READER'S SIDE. docs/builds/README.md's
 *      warning: four agents shipped backwards text in this repo. Every
 *      block-lettered word in chapters 4 and 5 is lifted out of the world
 *      and read in the order a person standing in front of it reads it.
 *   3. THE WATER IS HELD IN: the subway has none, but the bay under the
 *      Golden Gate is real water and the climb has nets and a moat.
 *   4. THE PHOTOGRAPHS: from the path, inside, from above, by day and by
 *      night. Evidence, not assertions.
 * ------------------------------------------------------------------------
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from './fixtures.js'
import { waitTicks, waitFrames, look, leaveWorld, chatCommand, grantOp } from './helpers/world.js'
import { enterPreview, previewWorldXYZ, inPage } from './helpers/previewWorld.js'
import { decodeRows } from '../src/builds/lettering.js'

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots')

/** Read a zy wall as five rows of '#'/'.', in the order its READER sees
 *  it: `towardPlusZ` is true when the reader's right is +z. */
function readWall(page, id, { x, yTop, z0, z1, key, towardPlusZ }) {
  return inPage(page, (mod, a) => {
    const w = mod.previewPatch()
    const at = mod.reader(w, a.id)
    const rows = []
    for (let r = 0; r < 5; r++) {
      let row = ''
      const y = a.yTop - r
      if (a.towardPlusZ) for (let z = a.z0; z <= a.z1; z++) row += at(a.x, y, z) === a.key ? '#' : '.'
      else for (let z = a.z1; z >= a.z0; z--) row += at(a.x, y, z) === a.key ? '#' : '.'
      rows.push(row)
    }
    return rows
  }, { id, x, yTop, z0, z1, key, towardPlusZ })
}

/** O and 0 are the same glyph; compare the way a reader would. */
const same = (a, b) => a.replace(/0/g, 'O') === b.replace(/0/g, 'O')

test.describe('chapters 4-6 stamp and stay in bounds', () => {
  test('each build places blocks, fits 74 x 76, and touches nothing outside', async ({ page }) => {
    const r = await inPage(page, (mod) => {
      const w = mod.previewPatch()
      const out = { placed: w.placed, sizes: {}, outside: 0, census: {} }
      const plots = Object.keys(mod.BUILDS).map(id => mod.previewPlot(id))
      for (const id of Object.keys(mod.BUILDS)) out.sizes[id] = mod.BUILDS[id].SIZE
      const bare = mod.previewPatch({ builds: false })
      for (let z = 0; z < w.depth; z++) {
        for (let x = 0; x < w.width; x++) {
          const mine = plots.find(p => x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1)
          const col = w.cols[z * w.width + x], ref = bare.cols[z * w.width + x]
          for (let i = 0; i < col.length; i++) {
            const k = w.palette[col[i]]
            if (!mine) { if (k !== bare.palette[ref[i]]) out.outside++ ; continue }
            if (k !== 'air' && i >= 4) out.census[mine.id] = (out.census[mine.id] ?? 0) + 1
          }
        }
      }
      return out
    })
    for (const id of ['ch4', 'ch5', 'ch6']) {
      expect(r.sizes[id].w, `${id} width`).toBeLessThanOrEqual(74)
      expect(r.sizes[id].d, `${id} depth`).toBeLessThanOrEqual(76)
      expect(r.placed[id], `${id} placed nothing`).toBeGreaterThan(5000)
      expect(r.census[id], `${id} above-ground census`).toBeGreaterThan(5000)
    }
    expect(r.outside, 'blocks changed outside the three plots').toBe(0)
  })

  test('the stamp is deterministic: two stamps are identical', async ({ page }) => {
    const same = await inPage(page, (mod) => {
      const a = mod.previewPatch(), b = mod.previewPatch()
      for (let i = 0; i < a.cols.length; i++) {
        const ca = a.cols[i], cb = b.cols[i]
        for (let y = 0; y < ca.length; y++) if (a.palette[ca[y]] !== b.palette[cb[y]]) return false
      }
      return true
    })
    expect(same).toBe(true)
  })
})

test.describe('the words read the right way round, from where you read them', () => {
  test('NO LOGO on the loft, read from the avenue (facing +x)', async ({ page }) => {
    const rows = await readWall(page, 'ch4', { x: 14, yTop: 25, z0: 8, z1: 34, key: 'sea_lantern', towardPlusZ: false })
    expect(rows.join('').replace(/\./g, '').length, 'nothing there to read').toBeGreaterThan(40)
    const text = decodeRows(rows, 7)
    expect(same(text, 'NO LOGO'), `the loft says ${JSON.stringify(text)}`).toBe(true)
  })

  test('DELI on the corner, read from the avenue (facing +x)', async ({ page }) => {
    const rows = await readWall(page, 'ch4', { x: 13, yTop: 9, z0: 46, z1: 60, key: 'yellow_concrete', towardPlusZ: false })
    expect(rows.join('').replace(/\./g, '').length).toBeGreaterThan(20)
    expect(decodeRows(rows, 4)).toBe('DELI')
  })

  test('PATRONUS on the office, read from the plaza (facing -x)', async ({ page }) => {
    const rows = await readWall(page, 'ch5', { x: 66, yTop: 25, z0: 5, z1: 35, key: 'sea_lantern', towardPlusZ: true })
    expect(rows.join('').replace(/\./g, '').length).toBeGreaterThan(40)
    const text = decodeRows(rows, 8)
    expect(same(text, 'PATRONUS'), `the office says ${JSON.stringify(text)}`).toBe(true)
  })

  test('2026 under Alamo Square, read standing in the cellar facing the Ladies', async ({ page }) => {
    /* A floor drawing: the reader faces -x, so their right is +z (the
     * characters) and the top of the digits is the far side, low x. */
    const rows = await inPage(page, (mod) => {
      const w = mod.previewPatch()
      const at = mod.reader(w, 'ch5')
      const out = []
      for (let x = 66; x <= 70; x++) {
        let row = ''
        for (let z = 47; z <= 61; z++) row += at(x, -4, z) === 'glowstone' ? '#' : '.'
        out.push(row)
      }
      return out
    })
    expect(same(decodeRows(rows, 4), '2026')).toBe(true)
  })
})

test.describe('the water stays where it was put', () => {
  for (const id of ['ch4', 'ch5', 'ch6']) {
    test(`${id}: no water block has air beside or below it`, async ({ page }) => {
      const leaks = await inPage(page, (mod, id) => {
        const w = mod.previewPatch()
        const at = mod.reader(w, id)
        const p = mod.previewPlot(id)
        const W = p.x1 - p.x0 + 1, D = p.z1 - p.z0 + 1
        const out = []
        for (let x = 0; x < W; x++) {
          for (let z = 0; z < D; z++) {
            for (let y = -3; y <= 62; y++) {
              if (at(x, y, z) !== 'water') continue
              for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]) {
                const nx = x + dx, nz = z + dz
                if (nx < 0 || nz < 0 || nx >= W || nz >= D) { out.push(`edge (${x},${y},${z})`); continue }
                if (at(nx, y + dy, nz) === 'air') out.push(`(${x},${y},${z})->(${dx},${dy},${dz})`)
              }
            }
          }
        }
        return out
      }, id)
      expect(leaks.slice(0, 6).join('; '), `${leaks.length} leaks`).toBe('')
    })
  }
})

/* ====================================================================== *
 * PHOTOGRAPHS
 * ====================================================================== */

/** Stand at a plot-local point and look. Gravity off, so a shot from the
 *  air does not become a death screen. */
async function frame(page, name, id, [x, y, z], { heading = 0, pitch = 0, settle = 1500 } = {}) {
  const [wx, wy, wz] = previewWorldXYZ(id, x + 0.5, y, z + 0.5)
  await page.evaluate(([x, y, z]) => {
    const noa = window.noa
    const body = noa.ents.getPhysics(noa.playerEntity).body
    body.gravityMultiplier = 0
    noa.ents.setPosition(noa.playerEntity, [x, y, z])
    body.velocity[0] = body.velocity[1] = body.velocity[2] = 0
  }, [wx, wy, wz])
  await look(page, { heading, pitch })
  await page.waitForTimeout(settle)
  await waitFrames(page, 6)
  await page.screenshot({ path: path.join(SHOTS, `ch46-${name}.png`) })
}

const E = Math.PI / 2          // looking +x
const W = -Math.PI / 2         // looking -x
const S = 0                    // looking +z
const N = Math.PI              // looking -z

test.describe('what chapters 4 to 6 look like', () => {
  test.describe.configure({ timeout: 240_000 })
  test.beforeEach(async ({ page }) => {
    await enterPreview(page, ['ch4', -6, 6])
    await waitTicks(page, 20)
  })
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      window.noa.ents.getPhysics(window.noa.playerEntity).body.gravityMultiplier = 1
    })
    await leaveWorld(page)
  })

  test('New York, by day', async ({ page }) => {
    await frame(page, 'ny-arrival', 'ch4', [-4, 1, 6], { heading: E + 0.35, pitch: -0.2 })
    await frame(page, 'ny-avenue-south', 'ch4', [2, 2, 8], { heading: S + 0.15, pitch: -0.12 })
    await frame(page, 'ny-loft-front', 'ch4', [-10, 3, 21], { heading: E, pitch: -0.25 })
    await frame(page, 'ny-cross-street', 'ch4', [5, 2, 40], { heading: E, pitch: -0.18 })
    await frame(page, 'ny-esb', 'ch4', [30, 2, 60], { heading: E + 0.1, pitch: -0.6 })
    await frame(page, 'ny-above', 'ch4', [-20, 60, 38], { heading: E, pitch: 0.7 })
  })

  test('New York, inside', async ({ page }) => {
    await frame(page, 'ny-loft-1-samples', 'ch4', [16, 1, 21], { heading: E, pitch: 0.1 })
    await frame(page, 'ny-loft-2-fifty', 'ch4', [24, 6, 20], { heading: N, pitch: 0.05 })
    await frame(page, 'ny-loft-3-growth', 'ch4', [32, 11, 20], { heading: W, pitch: 0.1 })
    await frame(page, 'ny-loft-4-shenzhen', 'ch4', [24, 16, 18], { heading: S, pitch: 0.05 })
    await frame(page, 'ny-roof', 'ch4', [30, 21, 32], { heading: N - 0.4, pitch: -0.25 })
    await frame(page, 'ny-subway', 'ch4', [12, -3, 58], { heading: N + 0.3, pitch: 0.05 })
    await frame(page, 'ny-deli', 'ch4', [16, 0, 53], { heading: E, pitch: 0.1 })
    await frame(page, 'ny-esb-lobby', 'ch4', [49, 0, 61], { heading: E, pitch: -0.05 })
    await frame(page, 'ny-brownstone-parlor', 'ch4', [55, 3, 31], { heading: N, pitch: 0.15 })
  })

  test('San Francisco, by day', async ({ page }) => {
    await frame(page, 'sf-arrival', 'ch5', [78, 1, 6], { heading: W - 0.3, pitch: -0.2 })
    await frame(page, 'sf-hq-front', 'ch5', [82, 3, 20], { heading: W, pitch: -0.2 })
    await frame(page, 'sf-ladies-from-park', 'ch5', [70, 3, 58], { heading: W, pitch: -0.12 })
    await frame(page, 'sf-golden-gate', 'ch5', [30, 6, 72], { heading: N - 0.5, pitch: -0.3 })
    await frame(page, 'sf-cable-car', 'ch5', [70, 2, 39], { heading: W, pitch: 0.05 })
    await frame(page, 'sf-above', 'ch5', [95, 60, 38], { heading: W, pitch: 0.7 })
  })

  test('San Francisco, inside', async ({ page }) => {
    await frame(page, 'sf-lobby', 'ch5', [64, 1, 20], { heading: W, pitch: 0.05 })
    await frame(page, 'sf-world-model', 'ch5', [63, 8, 30], { heading: N + 0.6, pitch: 0.55 })
    await frame(page, 'sf-racks', 'ch5', [51, 10, 28], { heading: N, pitch: 0.05 })
    await frame(page, 'sf-growth', 'ch5', [60, 15, 18], { heading: W, pitch: 0.05 })
    await frame(page, 'sf-roof', 'ch5', [62, 20, 20], { heading: W, pitch: -0.1 })
    await frame(page, 'sf-lady-parlor', 'ch5', [61, 3, 59], { heading: W, pitch: 0.1 })
    await frame(page, 'sf-bridge-deck', 'ch5', [11, 9, 8], { heading: S, pitch: -0.1 })
  })

  test('The climb, by day', async ({ page }) => {
    await frame(page, 'climb-arrival', 'ch6', [-6, 1, 6], { heading: E + 0.5, pitch: -0.45 })
    await frame(page, 'climb-from-path', 'ch6', [-24, 4, 40], { heading: E, pitch: -0.4 })
    await frame(page, 'climb-start', 'ch6', [8, 1, 12], { heading: E, pitch: -0.2 })
    await frame(page, 'climb-stage3', 'ch6', [62, 21, 42], { heading: S, pitch: 0.1 })
    await frame(page, 'climb-summit', 'ch6', [32, 51, 35], { heading: E + 0.6, pitch: 0.2 })
    await frame(page, 'climb-above', 'ch6', [-30, 70, 38], { heading: E, pitch: 0.55 })
  })

  test('all three at night', async ({ page }) => {
    await grantOp(page)
    await chatCommand(page, '/time set midnight')
    await waitTicks(page, 5)
    await frame(page, 'night-ny', 'ch4', [-10, 3, 21], { heading: E + 0.3, pitch: -0.25, settle: 2500 })
    await frame(page, 'night-ny-loft-2', 'ch4', [24, 6, 20], { heading: N, pitch: 0.05 })
    await frame(page, 'night-sf', 'ch5', [84, 3, 30], { heading: W - 0.2, pitch: -0.2, settle: 2500 })
    await frame(page, 'night-sf-lobby', 'ch5', [64, 1, 20], { heading: W, pitch: 0.05 })
    await frame(page, 'night-climb', 'ch6', [-24, 4, 40], { heading: E, pitch: -0.4, settle: 2500 })
    await chatCommand(page, '/time set day')
  })
})
