import { test, expect } from './fixtures.js'
import { measureFps } from './helpers/world.js'

/*
 * Flowing water and flowing lava.
 *
 * Reported from play (docs/REPORTED.md item 15): a lava block in a cave that
 * just sat there, and water did the same. src/fluids.js had listed flowing
 * fluids among its deliberate non-goals; this is that entry being paid off,
 * and this file is the contract on it.
 *
 * IT IS DISCRIMINATING, AND THAT WAS CHECKED RATHER THAN HOPED. Two mutations
 * were made to src/fluids.js while writing it and both were caught:
 *   - decay forced to 0 (so a level never increases): 'stops at seven blocks'
 *     failed with water at every one of the 12 sampled distances, spreading
 *     past the platform edge instead of stopping.
 *   - the schedule() call in place() removed (so nothing wakes the frontier):
 *     'water reaches seven blocks' failed with the pool one block wide.
 * Both were restored. A test that cannot fail is a comment with a runtime.
 *
 * MINECRAFT'S NUMBERS, restated here rather than imported from src/fluids.js,
 * for the reason 19-fluids gives about its own: a test that imports the
 * constant it is checking asserts only that arithmetic is deterministic.
 *
 *   water: 7 blocks horizontally, 1 block per 5 game ticks
 *     -- minecraft.wiki/w/Water
 *   lava:  3 blocks in the Overworld, 7 in the Nether; 1 block per 30 game
 *          ticks in the Overworld, per 10 in the Nether
 *     -- minecraft.wiki/w/Lava
 *   the two spreads come from ONE decay constant that is 2 for overworld
 *   lava and 1 otherwise -- BlockDynamicLiquid.updateTick's `int j = 1;`
 */
const MC = {
  WATER_RANGE: 7,
  LAVA_RANGE_OVERWORLD: 3,
  WATER_MS_PER_BLOCK: 5 * 50,
  LAVA_MS_PER_BLOCK: 30 * 50,
}

/** Block ids, duplicated from blocks.js on purpose -- same bargain as ID in
 *  helpers/world.js: if someone renumbers the table this file should fail
 *  rather than quietly follow along. */
const ID = {
  air: 0, stone: 3, obsidian: 28, cobblestone: 4,
  water: 636, lava: 637,
  water_1: 639, water_7: 645, water_falling: 646,
  lava_1: 647, lava_falling: 654,
}

/*
 * A walled stone tray in the air above spawn, well clear of the terrain.
 *
 * WALLED, which is not decoration: without a lip the pour runs off the edge
 * and falls two hundred blocks to the ground, and every assertion about how
 * far it spread would be measuring a waterfall instead. y=170 is above the
 * highest terrain in the patch and inside the loaded column.
 */
const TRAY_Y = 170
async function buildTray(page, half = 12) {
  await page.evaluate(([y, h]) => {
    const noa = window.noa
    for (let x = -h; x <= h; x++) {
      for (let z = -h; z <= h; z++) {
        noa.setBlock(3, x, y - 1, z)
        for (let dy = 0; dy < 4; dy++) noa.setBlock(0, x, y + dy, z)
      }
    }
    // The lip.
    for (let i = -h; i <= h; i++) {
      for (let dy = 0; dy < 3; dy++) {
        noa.setBlock(3, i, y + dy, -h); noa.setBlock(3, i, y + dy, h)
        noa.setBlock(3, -h, y + dy, i); noa.setBlock(3, h, y + dy, i)
      }
    }
  }, [TRAY_Y, half])
}

/**
 * Drive the flow engine forward by a known number of MILLISECONDS OF GAME
 * TIME, synchronously, rather than sleeping.
 *
 * The rates are in milliseconds because noa ticks at 30 Hz and Minecraft at
 * 20, so a tick COUNT would be 1.5x wrong (src/fluids.js says so at length).
 * `run` feeds the scheduler its own clock, which makes every assertion below
 * deterministic instead of a race with the frame rate -- and it is the same
 * code path the real tick uses, just wound by hand.
 */
const advance = (page, ms, step = 50) =>
  page.evaluate(([m, s]) => window.game.fluids.flow.run(Math.ceil(m / s), s), [ms, step])

/** The fluid level at a cell, as the simulation sees it, or null. */
const levelAt = (page, x, y, z) => page.evaluate(([a, b, c]) => {
  const m = window.game.fluids.flow.metaOf(window.noa.getBlock(a, b, c))
  return m ? { fluid: m.fluid, level: m.level, falling: m.falling } : null
}, [x, y, z])

const rowEast = (page, y, from, to) => page.evaluate(([yy, f, t]) => {
  const out = []
  for (let x = f; x <= t; x++) out.push(window.noa.getBlock(x, yy, 0))
  return out
}, [y, from, to])

test.describe('flowing water', () => {
  test('a source spreads seven blocks and stops', async ({ page }) => {
    await buildTray(page)
    await page.evaluate(([y]) => window.noa.setBlock(636, 0, y, 0), [TRAY_Y])

    // Generous: 7 blocks at 250 ms each is 1.75 s of game time, and the
    // de-spread pass needs a few more rounds to settle.
    await advance(page, MC.WATER_MS_PER_BLOCK * 40)

    const row = await rowEast(page, TRAY_Y, 0, 11)

    // The source, then levels 1 through 7, then nothing. This is the whole
    // feature in one array.
    expect(row.slice(0, 8)).toEqual([
      ID.water, ID.water_1, ID.water_1 + 1, ID.water_1 + 2,
      ID.water_1 + 3, ID.water_1 + 4, ID.water_1 + 5, ID.water_7,
    ])
    expect(row.slice(8)).toEqual([ID.air, ID.air, ID.air, ID.air])

    // ...and the same in every direction, because a diamond is the shape a
    // flat spread makes and a square would mean the levels are not decaying.
    const reach = await page.evaluate(([y, r]) => {
      const noa = window.noa
      const f = window.game.fluids.flow
      const far = (dx, dz) => {
        let n = 0
        while (n <= r + 3 && f.metaOf(noa.getBlock(dx * (n + 1), y, dz * (n + 1)))) n++
        return n
      }
      return [far(1, 0), far(-1, 0), far(0, 1), far(0, -1)]
    }, [TRAY_Y, MC.WATER_RANGE])
    expect(reach).toEqual([MC.WATER_RANGE, MC.WATER_RANGE, MC.WATER_RANGE, MC.WATER_RANGE])
  })

  test('it falls before it spreads, and spreads again where it lands',
    async ({ page }) => {
      /*
       * Vanilla's rule, and the one most easily got backwards: a fluid that
       * CAN fall does nothing else that tick (BlockDynamicLiquid.updateTick
       * guards the horizontal branch with `i == 0 || isBlocked(below)`), and
       * the column that lands counts as decay 0 -- so a waterfall spreads the
       * full seven blocks from the FLOOR, not however much was left at the top.
       */
      await buildTray(page)
      await page.evaluate(([y]) => {
        const noa = window.noa
        /*
         * A ONE-BLOCK shaft through the tray floor, opening into a room four
         * down. One block wide on purpose: a wider hole lets water spread at
         * every level on the way down, and then the cell beside the landing is
         * fed from ABOVE rather than sideways -- which is a falling block, not
         * a level 1, and the assertion below would be measuring the wrong
         * thing. (It did, first time. The shaft was 7x7.)
         */
        for (let x = -9; x <= 9; x++) {
          for (let z = -9; z <= 9; z++) {
            noa.setBlock(3, x, y - 5, z)
            for (let dy = 1; dy <= 4; dy++) noa.setBlock(3, x, y - dy, z)
          }
        }
        for (let dy = 1; dy <= 4; dy++) noa.setBlock(0, 0, y - dy, 0)
        // The room the column lands in.
        for (let x = -9; x <= 9; x++) {
          for (let z = -9; z <= 9; z++) noa.setBlock(0, x, y - 4, z)
        }
        noa.setBlock(636, 0, y, 0)
      }, [TRAY_Y])

      await advance(page, MC.WATER_MS_PER_BLOCK * 60)

      // The column under the source is falling, all the way down.
      for (let dy = 1; dy <= 3; dy++) {
        expect(await levelAt(page, 0, TRAY_Y - dy, 0))
          .toEqual({ fluid: 'water', level: 0, falling: true })
      }

      // ...and at the bottom it starts again at level 1, which is what
      // "counts as decay 0" means. If the column carried its level down, the
      // block beside the landing would be level 5 or worse.
      expect(await levelAt(page, 1, TRAY_Y - 4, 0))
        .toEqual({ fluid: 'water', level: 1, falling: false })
    })

  test('two sources and a floor make a third -- infinite water', async ({ page }) => {
    /*
     * minecraft.wiki/w/Water: a flowing block "horizontally adjacent to two or
     * more other source blocks, and sitting on top of a solid block or another
     * water source block" becomes a source. It is the rule every bucket duper
     * in the game depends on, and lava does NOT have it in Java Edition --
     * asserted below, because a shared code path is exactly where it would
     * leak.
     */
    await buildTray(page)
    await page.evaluate(([y]) => {
      const noa = window.noa
      noa.setBlock(636, -1, y, 0)
      noa.setBlock(636, 1, y, 0)
    }, [TRAY_Y])
    await advance(page, MC.WATER_MS_PER_BLOCK * 20)

    expect(await levelAt(page, 0, TRAY_Y, 0))
      .toEqual({ fluid: 'water', level: 0, falling: false })
  })

  test('lava does not become infinite the way water does', async ({ page }) => {
    await buildTray(page)
    await page.evaluate(([y]) => {
      const noa = window.noa
      noa.setBlock(637, -1, y, 0)
      noa.setBlock(637, 1, y, 0)
    }, [TRAY_Y])
    await advance(page, MC.LAVA_MS_PER_BLOCK * 20)

    const middle = await levelAt(page, 0, TRAY_Y, 0)
    expect(middle.fluid).toBe('lava')
    expect(middle.level).toBeGreaterThan(0)
  })

  test('cut the supply and the flow drains away', async ({ page }) => {
    // The de-spread half. A level that nothing feeds recomputes to 8, which is
    // not a level, and becomes air -- which is why a pool does not survive its
    // source being scooped out.
    await buildTray(page)
    await page.evaluate(([y]) => window.noa.setBlock(636, 0, y, 0), [TRAY_Y])
    await advance(page, MC.WATER_MS_PER_BLOCK * 40)
    expect(await levelAt(page, 5, TRAY_Y, 0)).not.toBeNull()

    await page.evaluate(([y]) => window.noa.setBlock(0, 0, y, 0), [TRAY_Y])
    await advance(page, MC.WATER_MS_PER_BLOCK * 60)

    const left = await page.evaluate(([y]) => {
      const noa = window.noa; const f = window.game.fluids.flow
      let n = 0
      for (let x = -12; x <= 12; x++) {
        for (let z = -12; z <= 12; z++) if (f.metaOf(noa.getBlock(x, y, z))) n++
      }
      return n
    }, [TRAY_Y])
    expect(left).toBe(0)
  })
})

test.describe('flowing lava', () => {
  test('three blocks in the Overworld, not seven', async ({ page }) => {
    /*
     * The reported bug was lava, and this is the number that says the decay
     * constant is doing its job rather than lava riding water's rule: overworld
     * lava decays TWO levels per block, so it occupies levels 2, 4 and 6 and
     * runs out after three.
     */
    await buildTray(page)
    await page.evaluate(([y]) => window.noa.setBlock(637, 0, y, 0), [TRAY_Y])
    await advance(page, MC.LAVA_MS_PER_BLOCK * 30)

    const levels = await page.evaluate(([y]) => {
      const noa = window.noa; const f = window.game.fluids.flow
      const out = []
      for (let x = 0; x <= 5; x++) {
        const m = f.metaOf(noa.getBlock(x, y, 0))
        out.push(m ? m.level : null)
      }
      return out
    }, [TRAY_Y])

    expect(levels).toEqual([0, 2, 4, 6, null, null])
  })

  test('it is slower than water, measured rather than asserted', async ({ page }) => {
    /*
     * 30 game ticks against 5. Driving both from the same wound clock and
     * comparing how far each got is the only way to test a RATE without
     * measuring the frame rate by accident.
     */
    await buildTray(page)
    await page.evaluate(([y]) => {
      window.noa.setBlock(636, -8, y, -8)
      window.noa.setBlock(637, 8, y, 8)
    }, [TRAY_Y])

    // One water-block's worth of time, times three. Water should have moved
    // three blocks; lava has not yet earned its first.
    await advance(page, MC.WATER_MS_PER_BLOCK * 3, 50)

    const got = await page.evaluate(([y]) => {
      const noa = window.noa; const f = window.game.fluids.flow
      const run = (ox, oz) => {
        let n = 0
        while (n < 8 && f.metaOf(noa.getBlock(ox + n + 1, y, oz))) n++
        return n
      }
      return { water: run(-8, -8), lava: run(8, 8) }
    }, [TRAY_Y])

    expect(got.water).toBeGreaterThan(got.lava)
    expect(got.lava).toBe(0)
  })
})

test.describe('water meeting lava', () => {
  test('water onto a lava source gives obsidian, in the lava cell', async ({ page }) => {
    // minecraft.wiki/w/Water: "If water touches a lava source, the lava source
    // turns to obsidian." The WHERE is the half worth asserting -- the water
    // does not move, the lava's cell changes.
    await buildTray(page)
    await page.evaluate(([y]) => {
      window.noa.setBlock(637, 3, y, 0)
      window.noa.setBlock(636, 0, y, 0)
    }, [TRAY_Y])
    await advance(page, MC.WATER_MS_PER_BLOCK * 30)

    expect(await page.evaluate(([y]) => window.noa.getBlock(3, y, 0), [TRAY_Y]))
      .toBe(ID.obsidian)
  })

  test('two flows meeting give cobblestone', async ({ page }) => {
    // "If both touch each other while flowing, cobblestone is made and no
    // sources are removed."
    await buildTray(page)
    await page.evaluate(([y]) => {
      window.noa.setBlock(636, -4, y, 0)
      window.noa.setBlock(637, 4, y, 0)
    }, [TRAY_Y])
    await advance(page, MC.LAVA_MS_PER_BLOCK * 30)

    const found = await page.evaluate(([y]) => {
      const noa = window.noa
      let n = 0
      for (let x = -12; x <= 12; x++) {
        for (let z = -12; z <= 12; z++) if (noa.getBlock(x, y, z) === 4) n++
      }
      return n
    }, [TRAY_Y])
    expect(found).toBeGreaterThan(0)

    // Neither source was consumed.
    expect(await levelAt(page, -4, TRAY_Y, 0)).toEqual({ fluid: 'water', level: 0, falling: false })
    expect(await levelAt(page, 4, TRAY_Y, 0)).toEqual({ fluid: 'lava', level: 0, falling: false })
  })
})

test.describe('cost', () => {
  test('a settled pool costs nothing -- the queue empties', async ({ page }) => {
    /*
     * THE PERFORMANCE CONTRACT, and the reason this is a test rather than a
     * measurement. Fluid updates are the classic way to make a voxel world
     * crawl, and the mechanism that stops it is that a cell LEAVES the queue
     * when its update changes nothing. If that ever stops being true the frame
     * rate decays slowly and nobody can say when it started; an empty queue is
     * a number that fails loudly on the day it breaks.
     */
    await buildTray(page)
    await page.evaluate(([y]) => window.noa.setBlock(636, 0, y, 0), [TRAY_Y])
    await advance(page, MC.WATER_MS_PER_BLOCK * 80)
    expect(await page.evaluate(() => window.game.fluids.flow.pendingCount)).toBe(0)
  })

  test('a substantial pool flowing does not cost the frame rate', async ({ page }) => {
    /*
     * Relative, not absolute: measureFps says so, and under swiftshader the
     * number is machine-dependent. Baseline first, then twenty-five sources
     * pouring at once, and the claim is that the second is not a collapse of
     * the first.
     */
    await buildTray(page, 20)
    const before = await measureFps(page, 1500)

    await page.evaluate(([y]) => {
      const noa = window.noa
      for (let x = -16; x <= 16; x += 8) {
        for (let z = -16; z <= 16; z += 8) noa.setBlock(636, x, y, z)
      }
    }, [TRAY_Y])

    const during = await measureFps(page, 1500)
    // Two decimal places of a ratio, in the report, whatever it says.
    // eslint-disable-next-line no-console
    console.log(`fps ${before.toFixed(1)} -> ${during.toFixed(1)}`)
    expect(during).toBeGreaterThan(before * 0.6)
  })
})
