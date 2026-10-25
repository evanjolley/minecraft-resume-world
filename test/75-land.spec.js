/*
 * THE OVERWORLD SURVEY: the plot table, the walk between the plots, and the
 * six chapter markers.
 *
 * Rewritten for Sprint 1's 288 x 400 survey. The table is checked in node
 * against the numbers src/builds/plots.js publishes in its comment, because a
 * table you have to compute is only a contract if somebody checks the
 * computation. The markers are read in the page, where the chapter frames
 * are actually stamped.
 */
import { test as nodeTest, expect } from '@playwright/test'
import { test } from './fixtures.js'
import { waitTicks } from './helpers/world.js'
import {
  CHAPTERS, CHAPTER_SIZE, SLOT, LAND_W, LAND_D, LAND_ORIGIN_X, LAND_ORIGIN_Z,
  LAND_SPAWN_X, LAND_SPAWN_Z,
} from '../src/builds/plots.js'
import { GLYPHS, textWidth } from '../src/builds/font.js'
import { generateLand, KIND } from '../src/builds/land.js'

nodeTest.describe('the plot table', () => {
  nodeTest('is the one plots.js publishes', () => {
    /* The comment table in src/builds/plots.js, row for row. */
    const PUBLISHED = {
      ch1: ['LEFT', 30, 95, 32, 94],
      ch2: ['RIGHT', 192, 265, 64, 139],
      ch3: ['LEFT', 26, 95, 122, 185],
      ch4: ['RIGHT', 192, 265, 192, 267],
      ch5: ['LEFT', 22, 95, 238, 313],
      ch6: ['RIGHT', 192, 265, 304, 379],
    }
    expect(CHAPTERS.map(c => c.id)).toEqual(Object.keys(PUBLISHED))
    for (const c of CHAPTERS) {
      expect([c.side, c.x0, c.x1, c.z0, c.z1], c.id).toEqual(PUBLISHED[c.id])
      expect([c.x1 - c.x0 + 1, c.z1 - c.z0 + 1]).toEqual([CHAPTER_SIZE[c.id].w, CHAPTER_SIZE[c.id].d])
    }
    expect([LAND_W, LAND_D, LAND_ORIGIN_X, LAND_ORIGIN_Z]).toEqual([288, 400, 144, 16])
  })

  nodeTest('chapter 1 kept its size, and nothing is bigger than a slot', () => {
    const ch1 = CHAPTERS.find(c => c.id === 'ch1')
    expect([ch1.x1 - ch1.x0 + 1, ch1.z1 - ch1.z0 + 1]).toEqual([66, 63])
    for (const c of CHAPTERS) {
      expect(c.x1 - c.x0 + 1).toBeLessThanOrEqual(SLOT.w)
      expect(c.z1 - c.z0 + 1).toBeLessThanOrEqual(SLOT.d)
    }
  })

  nodeTest('no two plots touch, every plot is on the map, and the sides alternate', () => {
    for (const a of CHAPTERS) {
      expect(a.x0).toBeGreaterThanOrEqual(0)
      expect(a.z0).toBeGreaterThanOrEqual(0)
      expect(a.x1).toBeLessThan(LAND_W)
      expect(a.z1).toBeLessThan(LAND_D)
      for (const b of CHAPTERS) {
        if (a === b) continue
        const apart = a.x1 < b.x0 - 1 || b.x1 < a.x0 - 1 || a.z1 < b.z0 - 1 || b.z1 < a.z0 - 1
        expect(apart, `${a.id} touches ${b.id}`).toBe(true)
      }
    }
    expect(CHAPTERS.map(c => c.side)).toEqual(['LEFT', 'RIGHT', 'LEFT', 'RIGHT', 'LEFT', 'RIGHT'])
  })

  nodeTest('the walk goes from spawn past every chapter, in order, and a spur reaches each door', () => {
    const { model, samples, spurs } = generateLand()
    const W = model.W
    const first = samples.findIndex(s => Math.hypot(s.x - LAND_SPAWN_X, s.z - LAND_SPAWN_Z) < 2)
    expect(first, 'the path does not pass through spawn').toBeGreaterThanOrEqual(0)
    /* Each spur leaves the path further along it than the last: the walk
     * passes the chapters in order. */
    const from = spurs.map(s => s.from)
    expect([...from].sort((a, b) => a - b)).toEqual(from)
    /* And each spur's last column is a walk column on the plot's path-side
     * edge, at its door (z0 + 6), at plot level. */
    for (const { chapter: c } of spurs) {
      const x = c.side === 'LEFT' ? c.x1 + 1 : c.x0 - 1
      const z = c.z0 + 6
      const i = z * W + x
      expect([KIND.SPUR, KIND.PATH, KIND.BRIDGE], `${c.id}'s door`).toContain(model.kind[i])
      expect(Math.abs(model.h[i]), `${c.id}'s door is at ${model.h[i]}`).toBeLessThanOrEqual(1)
    }
    /* A meaningful walk: the path is hundreds of blocks long, and there is
     * real distance between one chapter's spur and the next. */
    expect(samples.length / 4).toBeGreaterThan(400)
    for (let k = 1; k < from.length; k++) {
      expect((from[k] - from[k - 1]) / 4, `walk from ${spurs[k - 1].chapter.id} to ${spurs[k].chapter.id}`)
        .toBeGreaterThan(40)
    }
  })
})

function readMarker(grid, text) {
  const out = []
  for (let i = 0; i < text.length; i++) {
    const cell = grid.map(row => row.slice(i * 4, i * 4 + 3))
    const hit = Object.entries(GLYPHS).find(([, g]) => g.join('') === cell.join(''))
    out.push(hit ? hit[0] : '?')
  }
  return out.join('')
}

test('every marker reads forwards, in the world, at eye level', async ({ page }) => {
  test.setTimeout(120_000)
  await waitTicks(page, 5)
  for (const c of CHAPTERS) {
    const w = c.x1 - c.x0
    const tw = textWidth(c.marker)
    const x0 = c.x0 + (c.side === 'LEFT' ? Math.max(0, w - tw) : 0)
    const grid = await page.evaluate(([x0, z, n, ids]) => {
      const v = window.game.voxelAt
      const t = window.game.terrain
      const rows = []
      for (let y = 141; y >= 137; y--) {
        let row = ''
        for (let x = x0; x < x0 + n; x++) {
          row += v(x - t.originX, y, z - t.originZ) === ids.glowstone ? '#' : '.'
        }
        rows.push(row)
      }
      return rows
    }, [x0, c.z0 + 2, tw + 2, { glowstone: await page.evaluate(() => window.game.ids.glowstone) }])
    expect(grid.join('').replace(/\./g, '').length, `no glowstone at ${c.id}'s marker`).toBeGreaterThan(20)
    expect(readMarker(grid, c.marker), `${c.id} marker`).toBe(c.marker)
  }
})
