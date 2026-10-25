/*
 * THE LANDSCAPE, CHECKED: biomes, terrain, water, the walk, the trees and the
 * ground cover of the overworld, and the one promise about chapter 1.
 *
 * ------------------------------------------------------------------------
 * REWRITTEN FOR SPRINT 1. The previous version of this file scanned the
 * world voxel by voxel through `window.game.voxelAt` -- tens of millions of
 * page.evaluate reads per run -- because the landscape could only be built
 * inside a browser. It can be built anywhere now: src/builds/land.js has no
 * browser imports (see its header), so most of what follows asks the
 * GENERATOR, in node, and runs in a fraction of a second without booting
 * the game. The world the page installs is exactly this one plus the six
 * chapters, which are stamped only inside their plots.
 *
 * What still needs the page is what the page adds: chapter 1's school, which
 * is checked byte for byte against its baseline, and the archive world.
 * ------------------------------------------------------------------------
 * EVERY CLAIM SAYS ITS SAMPLE FIRST. A check that found nothing to check
 * passes vacuously, and this repo has shipped that before.
 */
import { test as nodeTest, expect } from '@playwright/test'
import { test } from './fixtures.js'
import { waitTicks, enterWorld, leaveWorld } from './helpers/world.js'
import { CHAPTERS, LAND_W, LAND_D, LAND_SPAWN_X, LAND_SPAWN_Z, landPlot } from '../src/builds/plots.js'
import { generateLand, KIND, WATER_Y } from '../src/builds/land.js'
import { BAMBOO_STALK } from '../src/builds/biomes.js'

const { world, model } = generateLand()
const { palette, cols, yMin } = world
const W = LAND_W, D = LAND_D
const BASE = 136 - yMin
/** The block key at patch (x, z), local y (0 = the air over a plot). */
const keyAt = (x, z, y) => palette[cols[z * W + x][y + BASE]] ?? 'air'
const isWalk = (k) => k === KIND.PATH || k === KIND.SPUR || k === KIND.BRIDGE

nodeTest.describe('the landscape, from the generator', () => {
  nodeTest('every chapter is standing in the biome it belongs to', () => {
    /* What surrounds each plot, twelve blocks out, from the water level up.
     * The signature is the one block that says the biome. */
    const SIGNATURE = {
      ch1: 'short_grass',     // plains: open grass, scattered oak
      ch2: 'birch_leaves',    // birch forest
      ch3: BAMBOO_STALK,      // bamboo jungle
      ch4: 'water',           // the island, and the river that makes it one
      ch5: 'stone',           // windswept hills: bare stone on the shoulders
      ch6: 'stone',           // jagged peaks
    }
    for (const c of CHAPTERS) {
      const tally = {}
      let sampled = 0
      for (let pz = c.z0 - 12; pz <= c.z1 + 12; pz++) {
        for (let px = c.x0 - 12; px <= c.x1 + 12; px++) {
          if (px < 0 || px >= W || pz < 0 || pz >= D) continue
          if (px >= c.x0 && px <= c.x1 && pz >= c.z0 && pz <= c.z1) continue
          for (let y = WATER_Y; y <= 30; y++) {
            sampled++
            const k = keyAt(px, pz, y)
            if (k !== 'air') tally[k] = (tally[k] ?? 0) + 1
          }
        }
      }
      expect(sampled, `${c.id}: nothing sampled`).toBeGreaterThan(50_000)
      const key = SIGNATURE[c.id]
      /* Bamboo is four offset variants of one plant; count them as one. */
      if (key === BAMBOO_STALK) {
        tally[key] = ['bamboo', 'bamboo_1', 'bamboo_2', 'bamboo_3'].reduce((n, k) => n + (tally[k] ?? 0), 0)
      }
      expect(tally[key] ?? 0, `${c.id} should be surrounded by ${key}: ${JSON.stringify(
        Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 8))}`).toBeGreaterThan(200)
    }
  })

  nodeTest('the land rolls: real height, everywhere but the plots', () => {
    let land = 0, raised = 0, high = 0, max = -99
    for (let i = 0; i < W * D; i++) {
      if (model.kind[i] !== KIND.FIELD) continue
      land++
      const h = model.h[i]
      if (h >= 4) raised++
      if (h >= 20) high++
      if (h > max) max = h
    }
    expect(land).toBeGreaterThan(50_000)
    /* Not flat: a sixth of the open land is at least four blocks up, there
     * is a mountain range, and its summit is a real summit. */
    expect(raised / land).toBeGreaterThan(0.15)
    expect(high).toBeGreaterThan(2_000)
    expect(max).toBeGreaterThan(35)
    expect(max, 'the summit must stay under the build ceiling').toBeLessThan(60)
  })

  nodeTest('every plot is flat at plot level, and the land comes down to meet it', () => {
    for (const c of CHAPTERS) {
      let n = 0
      for (let z = c.z0; z <= c.z1; z++) {
        for (let x = c.x0; x <= c.x1; x++) {
          n++
          const i = z * W + x
          expect(model.kind[i], `${c.id} at (${x}, ${z})`).toBe(KIND.PLOT)
          expect(model.h[i]).toBe(0)
        }
      }
      expect(n).toBe((c.x1 - c.x0 + 1) * (c.z1 - c.z0 + 1))
      /* The ring just outside: within a block of plot level (or the water's
       * edge, for the island), so a plot never ends at a cliff. */
      let ring = 0
      for (let z = c.z0 - 1; z <= c.z1 + 1; z++) {
        for (let x = c.x0 - 1; x <= c.x1 + 1; x++) {
          if (x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1) continue
          if (x < 0 || x >= W || z < 0 || z >= D) continue
          ring++
          const h = model.h[z * W + x]
          expect(Math.abs(h), `${c.id}'s edge at (${x}, ${z}) is ${h}`).toBeLessThanOrEqual(1)
        }
      }
      expect(ring).toBeGreaterThan(200)
    }
  })

  nodeTest('the walk needs no jump: every rise has a step, and the walk stays off the plots', () => {
    let pairs = 0, rises = 0
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) {
        const i = z * W + x
        if (!isWalk(model.kind[i])) continue
        for (const [dx, dz] of [[1, 0], [0, 1]]) {
          const nx = x + dx, nz = z + dz
          if (nx >= W || nz >= D) continue
          const j = nz * W + nx
          if (!isWalk(model.kind[j])) continue
          pairs++
          const d = model.h[j] - model.h[i]
          expect(Math.abs(d), `walk riser of ${d} at (${x}, ${z})`).toBeLessThanOrEqual(1)
          if (d === 0) continue
          rises++
          /* The lower of the two carries a slab: 0.5 up, then 0.5 more,
           * both under vanilla's 0.6 step height. */
          const [lx, lz, lh] = d > 0 ? [x, z, model.h[i]] : [nx, nz, model.h[j]]
          expect(keyAt(lx, lz, lh), `no step at (${lx}, ${lz})`).toMatch(/_slab$/)
        }
      }
    }
    expect(pairs).toBeGreaterThan(3_000)
    expect(rises, 'the walk never climbs: is the land flat again?').toBeGreaterThan(50)
    /* And spawn is flat, open, and on the path. */
    const s = LAND_SPAWN_Z * W + LAND_SPAWN_X
    expect(model.kind[s]).toBe(KIND.PATH)
    expect(model.h[s]).toBe(0)
    expect(keyAt(LAND_SPAWN_X, LAND_SPAWN_Z, -1)).not.toBe('grass')
    for (let dz = -8; dz <= 8; dz++) {
      for (let dx = -8; dx <= 8; dx++) {
        if (Math.hypot(dx, dz) > 8) continue
        const x = LAND_SPAWN_X + dx, z = LAND_SPAWN_Z + dz
        if (z < 0) continue
        expect(model.h[z * W + x], `spawn clearing at (${x}, ${z})`).toBe(0)
        for (let y = 0; y <= 8; y++) expect(keyAt(x, z, y)).toBe('air')
      }
    }
  })

  nodeTest('the water cannot flood: every water block is held on every side', () => {
    let water = 0
    const bad = []
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) {
        for (let y = -8; y <= WATER_Y; y++) {
          if (keyAt(x, z, y) !== 'water') continue
          water++
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, nz = z + dz
            if (nx < 0 || nx >= W || nz < 0 || nz >= D) continue
            if (keyAt(nx, nz, y) === 'air' && bad.length < 5) bad.push([x, y, z, nx, nz])
          }
          if (y < WATER_Y && keyAt(x, z, y + 1) === 'air' && bad.length < 5) bad.push([x, y, z, 'above'])
        }
      }
    }
    expect(water, 'there is no water at all').toBeGreaterThan(5_000)
    expect(bad, `water next to air: ${JSON.stringify(bad)}`).toEqual([])
  })

  nodeTest('New York is an island, reached by a bridge', () => {
    /* Flood the land outward from the middle of chapter 4 without crossing
     * water or a bridge deck. An island is land the flood cannot leave. */
    const c = landPlot('ch4')
    const seen = new Uint8Array(W * D)
    const stack = [((c.z0 + c.z1) >> 1) * W + ((c.x0 + c.x1) >> 1)]
    let reached = 0, escaped = false
    while (stack.length) {
      const i = stack.pop()
      if (seen[i]) continue
      seen[i] = 1
      reached++
      const x = i % W, z = (i / W) | 0
      if (x === 0 || z === 0 || x === W - 1 || z === D - 1) escaped = true
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz
        if (nx < 0 || nx >= W || nz < 0 || nz >= D) continue
        const j = nz * W + nx
        const k = model.kind[j]
        if (k === KIND.WATER || k === KIND.BRIDGE) continue
        stack.push(j)
      }
    }
    expect(reached).toBeGreaterThan((c.x1 - c.x0 + 1) * (c.z1 - c.z0 + 1))
    expect(escaped, 'the island is joined to the mainland').toBe(false)
    /* ...and a bridge deck touches it. */
    let decks = 0
    for (let i = 0; i < W * D; i++) {
      if (!seen[i]) continue
      const x = i % W, z = (i / W) | 0
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = (z + dz) * W + (x + dx)
        if (model.kind[j] === KIND.BRIDGE) decks++
      }
    }
    expect(decks, 'nothing crosses to the island').toBeGreaterThan(0)
  })

  nodeTest('every bamboo stalk is built the way bamboo grows', () => {
    const isBamboo = (k) => /^bamboo(_[123])?$/.test(k) || /^bamboo_leaves_(small|large)(_[123])?$/.test(k)
    let found = 0
    const bad = []
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) {
        const col = []
        for (let y = -2; y <= 40; y++) {
          const k = keyAt(x, z, y)
          if (!isBamboo(k)) { if (col.length) break; continue }
          col.push(k)
        }
        if (col.length < 3) continue
        found++
        const suffix = (k) => (k.match(/_([123])$/) ?? [, '0'])[1]
        const want = col.map((k, i) => (i === col.length - 1 ? 'large' : i === col.length - 2 ? 'small' : 'cane'))
        const got = col.map(k => (k.includes('_large') ? 'large' : k.includes('_small') ? 'small' : 'cane'))
        if (got.join() !== want.join() || !col.every(k => suffix(k) === suffix(col[0]))) {
          if (bad.length < 5) bad.push({ x, z, col })
        }
      }
    }
    expect(found, 'no bamboo stalks in the world').toBeGreaterThan(200)
    expect(bad, `malformed stalks: ${JSON.stringify(bad)}`).toEqual([])
  })

  nodeTest('the trees are vanilla species, and the ground is covered', () => {
    const tally = {}
    for (const c of cols) for (const v of c) { const k = palette[v]; tally[k] = (tally[k] ?? 0) + 1 }
    for (const log of ['oak_log', 'birch_log', 'spruce_log', 'dark_oak_log', 'jungle_log']) {
      expect(tally[log] ?? 0, `no ${log} in the world`).toBeGreaterThan(200)
    }
    expect(tally.short_grass ?? 0).toBeGreaterThan(3_000)
    expect(tally.fern ?? 0).toBeGreaterThan(200)
    expect(tally.tall_grass ?? 0).toBeGreaterThan(100)
    const flowers = ['dandelion', 'poppy', 'azure_bluet', 'oxeye_daisy', 'cornflower',
      'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'lilac', 'rose_bush', 'peony',
      'lily_of_the_valley', 'blue_orchid']
    expect(flowers.filter(f => (tally[f] ?? 0) > 0).length, 'too few kinds of flower').toBeGreaterThan(8)
    expect(tally.lily_pad ?? 0).toBeGreaterThan(20)
    /* A double plant is always a pair: a top over every bottom. */
    for (const p of ['tall_grass', 'large_fern', 'lilac', 'rose_bush', 'peony']) {
      expect(tally[`${p}_top`] ?? 0, `${p} halves`).toBe(tally[p] ?? 0)
    }
    /* Nothing grows on the walk or in a plot. */
    for (let i = 0; i < W * D; i++) {
      const k = model.kind[i]
      if (k !== KIND.PLOT && k !== KIND.PATH && k !== KIND.SPUR) continue
      const x = i % W, z = (i / W) | 0
      const above = keyAt(x, z, model.h[i])
      expect(/_leaves|_log$|grass$|fern|bamboo|tulip|poppy|dandelion/.test(above),
        `${above} on ${k === KIND.PLOT ? 'a plot' : 'the walk'} at (${x}, ${z})`).toBe(false)
    }
  })

  nodeTest('the walk is lit on both sides', () => {
    let left = 0, right = 0
    for (let i = 0; i < W * D; i++) {
      if (model.kind[i] !== KIND.FIELD) continue
      const x = i % W, z = (i / W) | 0
      if (keyAt(x, z, model.h[i] + 3) !== 'torch') continue
      if (keyAt(x, z, model.h[i]) !== 'stripped_oak_log') continue
      const near = model.near[i]
      if (near < 0) continue
      if ((near % W) < x) right++
      else left++
    }
    expect(left).toBeGreaterThan(5)
    expect(right).toBeGreaterThan(5)
  })
})

test.describe('the landscape, in the page', () => {
  test.afterEach(async ({ page }) => { await leaveWorld(page) })

  test('every palette key is a block the engine knows', async ({ page }) => {
    const info = await page.evaluate(() => window.game.terrain)
    expect(info.width).toBe(LAND_W)
    expect(info.depth).toBe(LAND_D)
    expect(info.missing).toEqual([])
  })

  test('Omaha is byte for byte what it was, and so is the archive', async ({ page }) => {
    test.setTimeout(180_000)
    await waitTicks(page, 5)
    /*
     * A DIGEST OVER CHAPTER 1'S WHOLE FOOTPRINT, in PLOT-LOCAL coordinates.
     *
     * Sprint 1 moved the plot (patch 14, 22 to 30, 32) and the sprint brief
     * says its contents stay "byte for byte". A digest in patch coordinates
     * cannot see that -- every block moved -- so it is taken relative to the
     * plot's corner: FNV-1a over "lx,y,lz,key" for every solid voxel, by
     * block KEY (an id is an index into a table that can be reordered
     * without moving a block).
     *
     * FROM y = 133 UP. The old superflat put bedrock at y = 132 under every
     * plot; the landscape puts dirt there, because it is a world with stone
     * under it now. The school's own cellar floor at y = 132 is its own
     * block and is not the ground's. Measured on both worlds side by side:
     * 27,571 solid voxels and the same digest.
     */
    const digest = await page.evaluate(([c]) => {
      const v = window.game.voxelAt
      const t = window.game.terrain
      const keyOf = new Map()
      let h = 0x811c9dc5, solid = 0
      const feed = (str) => {
        for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) }
      }
      for (let lz = 0; lz <= c.z1 - c.z0; lz++) {
        for (let lx = 0; lx <= c.x1 - c.x0; lx++) {
          for (let y = 133; y <= 200; y++) {
            const id = v(c.x0 + lx - t.originX, y, c.z0 + lz - t.originZ)
            if (id === 0) continue
            solid++
            let k = keyOf.get(id)
            if (k === undefined) { k = window.game.blockKey(id); keyOf.set(id, k) }
            feed(`${lx},${y},${lz},${k};`)
          }
        }
      }
      return { hex: (h >>> 0).toString(16), solid }
    }, [landPlot('ch1')])
    expect(digest.solid).toBe(27_571)
    expect(digest.hex, 'chapter 1 changed').toBe(OMAHA_DIGEST)

    await enterWorld(page, 'claude-opus-5-1')
    await waitTicks(page, 10)
    const archive = await page.evaluate(() => {
      const v = window.game.voxelAt
      const t = window.game.terrain
      const keyOf = new Map()
      let h = 0x811c9dc5, solid = 0
      const feed = (str) => {
        for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) }
      }
      for (let pz = 0; pz < t.depth; pz++) {
        for (let px = 0; px < t.width; px++) {
          for (let y = 132; y <= 200; y++) {
            const id = v(px - t.originX, y, pz - t.originZ)
            if (id === 0) continue
            solid++
            let k = keyOf.get(id)
            if (k === undefined) { k = window.game.blockKey(id); keyOf.set(id, k) }
            feed(`${px},${y},${pz},${k};`)
          }
        }
      }
      return { hex: (h >>> 0).toString(16), solid, width: t.width }
    })
    expect(archive.width).toBe(128)
    expect(archive.solid).toBeGreaterThan(50_000)
    expect(archive.hex, 'the archive changed').toBe(ARCHIVE_DIGEST)
  })
})

/* Chapter 1 in plot-local coordinates, y >= 133. Measured on the 256-square
 * overworld at 2d47428 (ch1 at patch 14, 22) and on this one (ch1 at 30, 32):
 * the same value. If this moves, something wrote into Omaha. */
const OMAHA_DIGEST = '2c1d00d0'
/* The same value test/85-millard-north.spec.js carries, measured at 401df98.
 * A copy on purpose: two specs that import one constant cannot disagree. */
const ARCHIVE_DIGEST = 'e3233e67'
