import { test, expect } from './fixtures.js'
import { grantOp, look, HEADING, ID, teleport } from './helpers/world.js'

/*
 * Getting INTO water, getting OUT of it, and going down on purpose.
 *
 * Three complaints, one file, because they turned out to be three views of the
 * same gap: src/fluids.js was solved entirely from Minecraft's TERMINAL
 * speeds, and terminal speed is silent about the transient, silent about what
 * happens at the surface, and silent about the sneak key.
 *
 * Minecraft's numbers are restated here rather than imported from
 * src/physics.js, for the reason 02-physics and 19-fluids both give: a test
 * that imports the constant it is checking asserts only that arithmetic is
 * deterministic. These come from Entity.travel, Entity.goDownInWater and
 * LivingEntity.aiStep.
 */
const MC = {
  // Entity.travel's fluid branch multiplies vertical motion by these, flat,
  // once per 20 Hz tick. Independent of gravity, and the thing that decides
  // how deep a plunge goes.
  WATER_RETENTION: 0.8,
  LAVA_RETENTION: 0.5,
  // Passive sink, and the same with sneak held. `u' = 0.8u - 0.045` settles
  // at 0.225 b/tick; lava's `u' = 0.5u - 0.06` at 0.12.
  WATER_SINK: 0.5,
  WATER_SNEAK_SINK: 4.5,
  LAVA_SNEAK_SINK: 2.4,
}

// Same 1.5% as 02-physics and 19-fluids, and the same reasoning: noa
// integrates at 30 Hz against Minecraft's fixed 20, so equality is not
// reachable and 1.5% still rejects a wrong constant.
const TOL = 0.015
const near = (actual, want, tol = TOL) => Math.abs(actual - want) <= want * tol

/*
 * A pool high above the island, for the reason 19-fluids gives: digging a hole
 * in real terrain would mean hundreds of voxels for the fixture to put back.
 *
 * Three wide because noa's applyFluidForces samples the fluid at the player
 * box's MIN CORNER, so a one-wide column drops out the moment the player
 * drifts a tenth of a block.
 */
const SHAFT_MIN = [10, 170, 10]
const SHAFT_MAX = [12, 200, 12]
const SURFACE = 201            // the top FACE of the y=200 block

/*
 * FLOW OFF FOR THE DURATION, back on in afterEach.
 *
 * Every rig in this file is a floorless box of sources hanging in open sky,
 * which the flow engine is perfectly right to drain: it pours off all four
 * sides and out of the bottom, two hundred blocks down to the superflat, and
 * the pool the swim-out test measures is shallower every second it runs. 19
 * and 41 make the same bargain for the same reason. Nothing in this file is
 * about spreading; it is about drag, buoyancy and the sneak key.
 */
test.afterEach(({ page }) => page.evaluate(() => {
  window.game.fluids.flow.reset()
  window.game.fluids.flow.setEnabled(true)
}))

async function fill(page, terrain, spans) {
  await page.evaluate(() => { window.game.fluids.flow.setEnabled(false) })
  await grantOp(page)
  for (const [, from, to] of spans) await terrain.keep(from, to)
  await page.evaluate(async (list) => {
    for (const [id, from, to] of list) {
      await window.game.authority.requestFill({ from, to, id })
    }
  }, await page.evaluate(([list, w, l]) => list.map(([k, from, to]) =>
    [k === 'water' ? w : k === 'lava' ? l : k, from, to]),
  [spans, await page.evaluate(() => window.game.fluids.ids.water),
    await page.evaluate(() => window.game.fluids.ids.lava)]))
  await page.evaluate(async () => { await window.game.authority.requestDeop() })
}

/**
 * Drop from `above` blocks over the surface and report how deep the plunge
 * carries, measured `settleMs` after the feet first cross it.
 *
 * WHY A FIXED WINDOW rather than "the deepest point": there is no deepest
 * point. Terminal sinking never stops, so any depth is a depth at a time, and
 * the honest thing is to name the time. The same window is handed to the
 * Minecraft model below, seeded with the SAME entry speed this run measured,
 * so the two numbers answer one question.
 */
const plunge = (page, above, settleMs) => page.evaluate(([surface, drop, ms]) =>
  new Promise((resolve) => {
    const noa = window.noa, p = noa.playerEntity
    const body = noa.ents.getPhysics(p).body
    noa.ents.setPosition(p, [11.5, surface + drop, 11.5])
    body.velocity[0] = body.velocity[1] = body.velocity[2] = 0
    let entryV = null, lastV = 0, v0 = 0, y0 = 0, ticks = 0
    const want = Math.round((ms / 1000) * noa.tickRate)
    const fn = () => {
      const y = noa.ents.getPositionData(p).position[1]
      if (entryV === null) {
        /*
         * The speed the water RECEIVES is the one carried by the last tick
         * still above the surface. noa integrates and then emits, so by the
         * time y reads below, a tick of fluid drag has already come off and
         * reading the velocity here would understate the entry by a fifth.
         */
        if (y >= surface) { lastV = -body.velocity[1]; return }
        entryV = lastV
        /*
         * The window starts HERE, at a measured y and a measured speed,
         * rather than at the surface. The crossing happens mid-tick, so
         * "depth below the surface" carries up to a whole tick of free fall
         * -- half a block at these speeds -- that the Minecraft model, which
         * starts exactly at the surface, does not. Comparing distance
         * travelled from a shared starting velocity asks the one question
         * that is actually about the fluid.
         */
        v0 = -body.velocity[1]
        y0 = y
      }
      if (++ticks < want) return
      noa.off('tick', fn)
      resolve({ entryV, v0, depth: y0 - y })
    }
    noa.on('tick', fn)
  }), [SURFACE, above, settleMs])

/**
 * Minecraft's own answer, in Minecraft's own units.
 *
 * Entity.travel, water branch, per 20 Hz tick: move by the current motion,
 * multiply it by 0.8, then subtract gravity/16 = 0.005. The recurrence is
 * `v' = 0.8v - 0.005`, which is where 19-fluids' 0.5 b/s terminal comes from
 * -- and unlike that terminal it also answers how long the plunge lasts.
 */
function vanillaDepth(entryVbps, secs, retention = MC.WATER_RETENTION, g = 0.005) {
  let v = -entryVbps / 20, y = 0
  for (let t = 0; t < secs * 20; t++) { v = retention * v - g; y += v }
  return -y
}

/** Terminal vertical speed, blocks/second, positive up. Same shape as 19's. */
const verticalSpeed = (page, ms = 1200) => page.evaluate((window_ms) =>
  new Promise((resolve) => {
    const noa = window.noa
    const y = () => noa.ents.getPositionData(noa.playerEntity).position[1]
    let y0 = 0, t0 = 0, armed = false
    const fn = () => {
      if (!armed) { y0 = y(); t0 = performance.now(); armed = true; return }
      const dt = performance.now() - t0
      if (dt < window_ms) return
      noa.off('tick', fn)
      resolve(((y() - y0) / dt) * 1000)
    }
    noa.on('tick', fn)
  }), ms)

test.describe('entering water', () => {
  /*
   * ONE SECOND after the surface, from three heights.
   *
   * A second is roughly four of the decay's time constants, so nearly all of
   * the overshoot has landed and almost none of the window is terminal
   * sinking padding the number out. Longer windows flatter the engine.
   */
  for (const drop of [5, 20, 60]) {
    test(`a ${drop}-block drop plunges no deeper than Minecraft's`, async ({ page, terrain }) => {
      await fill(page, terrain, [['water', SHAFT_MIN, SHAFT_MAX]])
      const { entryV, v0, depth } = await plunge(page, drop, 1000)
      const want = vanillaDepth(v0, 1)
      /*
       * 8%, and it is a budget rather than a measurement tolerance. noa's
       * drag is linear where Minecraft's is a flat retention, and at 30 Hz
       * against 20 the two cannot be made to agree on the decay AND on the
       * 0.5 b/s terminal that 19-fluids pins -- src/fluids.js works through
       * why, and why refitting the drag to close the last few percent would
       * cost the four unfitted agreements that say the model is right.
       *
       * Before the fix this read 25% over at every entry speed, which is the
       * whole gap between a linear drag and a retention, so 8% is not a
       * generous band: it is comfortably tight enough to fail on that.
       */
      expect(depth, `plunged ${depth.toFixed(2)} blocks in 1 s entering at`
        + ` ${entryV.toFixed(1)} b/s; Minecraft reaches ${want.toFixed(2)}`)
        .toBeLessThan(want * 1.08)
    })
  }

  test('the passive sink is still Minecraft\'s 0.5 b/s', async ({ page, terrain }) => {
    // The guard on the fix above: the transient correction is applied to the
    // EXCESS over terminal, so terminal must not have moved. 19-fluids asserts
    // this too; it is restated here because this file is what would break it.
    await fill(page, terrain, [['water', SHAFT_MIN, SHAFT_MAX]])
    await teleport(page, 11.5, 195, 11.5)
    await page.waitForTimeout(1500)
    const v = await verticalSpeed(page, 1500)
    expect(near(-v, MC.WATER_SINK), `sank at ${(-v).toFixed(3)} b/s`).toBe(true)
  })
})

test.describe('getting out of water', () => {
  /*
   * A shoreline: a pool and a slab of land whose top faces are the same
   * height, which is what every beach in the world looks like and is the
   * geometry the whole bug lives in. Land eight blocks wide so the test is
   * measuring the climb and not how far the player skids after it.
   */
  const POOL_MIN = [4, 190, 10], POOL_MAX = [12, 200, 12]
  const LAND_MIN = [13, 190, 10], LAND_MAX = [20, 200, 12]

  test('you can swim up onto the block next to you', async ({ page, terrain }) => {
    await fill(page, terrain, [
      ['water', POOL_MIN, POOL_MAX],
      [ID.stone, LAND_MIN, LAND_MAX],
    ])
    await teleport(page, 11.5, 196, 11.5)
    await look(page, { heading: HEADING.westPlusX })   // +X, toward the land

    await page.keyboard.down('Space')
    await page.keyboard.down('KeyW')
    let out
    try {
      /*
       * Polled rather than timed. "Standing on the land" is feet at the land's
       * top face with no fluid under them, and a fixed wait would either be
       * generous enough to hide a slow climb or tight enough to flake on a
       * software-GL frame stall.
       */
      out = await page.waitForFunction(() => {
        const p = window.noa.ents.getPositionData(window.noa.playerEntity).position
        return p[1] >= 200.99 && p[0] > 13 && window.game.fluids.feet === null
          ? { x: p[0], y: p[1] } : null
      }, null, { timeout: 8000 }).then(h => h.jsonValue())
    } finally {
      await page.keyboard.up('Space')
      await page.keyboard.up('KeyW')
    }
    expect(out.y, `climbed out at x=${out.x.toFixed(2)} y=${out.y.toFixed(2)}`)
      .toBeGreaterThanOrEqual(200.99)
  })

  test('the float line is not a ceiling: jump lifts you clear of the surface',
    async ({ page, terrain }) => {
      /*
       * The bug underneath the one above, isolated, with no land involved.
       *
       * noa scales buoyancy by how much of the box is submerged, so the climb
       * force balances it at a fixed depth and you bob there forever. Held
       * jump in open water has to raise the feet ABOVE the surface -- in
       * Minecraft it launches you a little way out, which is the momentum you
       * clear a bank with.
       */
      await fill(page, terrain, [['water', SHAFT_MIN, SHAFT_MAX]])
      await teleport(page, 11.5, 195, 11.5)
      await page.keyboard.down('Space')
      try {
        const top = await page.evaluate((surface) => new Promise((resolve) => {
          const noa = window.noa, p = noa.playerEntity
          let best = -Infinity, ticks = 0
          const fn = () => {
            best = Math.max(best, noa.ents.getPositionData(p).position[1])
            if (++ticks < 120) return
            noa.off('tick', fn); resolve(best)
          }
          noa.on('tick', fn)
        }), SURFACE)
        // Before the fix this settled at 200.04, a stable 0.96 under the
        // surface, and never moved again.
        expect(top, `rose to ${top.toFixed(3)} against a surface at ${SURFACE}`)
          .toBeGreaterThan(SURFACE)
      } finally {
        await page.keyboard.up('Space')
      }
    })
})

test.describe('sinking on purpose', () => {
  test('holding sneak sinks you nine times faster', async ({ page, terrain }) => {
    // Entity.goDownInWater is jumpInLiquid's mirror: -0.04 b/tick^2, no ground
    // check. On top of the passive -0.005 that is 4.5 b/s against 0.5.
    await fill(page, terrain, [['water', SHAFT_MIN, SHAFT_MAX]])
    await teleport(page, 11.5, 199, 11.5)
    await page.keyboard.down('ShiftLeft')
    try {
      /*
       * 1.5 s of warmup, not 0.6. The time constant is 1/3.529 = 0.28 s and
       * the measurement is a MEAN over its window, so a short warmup averages
       * in the tail of the ramp: 0.6 s here read 4.387 against 4.5, which
       * looks exactly like a wrong constant and is not. 19-fluids' climb test
       * documents the same trap.
       */
      await page.waitForTimeout(1500)
      const v = await verticalSpeed(page, 1000)
      expect(await page.evaluate(() => window.game.fluids.feet)).toBe('water')
      expect(near(-v, MC.WATER_SNEAK_SINK), `sank at ${(-v).toFixed(3)} b/s`
        + ` vs ${MC.WATER_SNEAK_SINK}`).toBe(true)
    } finally {
      await page.keyboard.up('ShiftLeft')
    }
  })

  test('and in lava, where the same key is three times slower', async ({ page, terrain }) => {
    await fill(page, terrain, [['lava', SHAFT_MIN, SHAFT_MAX]])
    // Creative, or 8 health a second kills the player mid-measurement.
    await page.evaluate(async () => {
      const a = window.game.authority
      await a.requestOp('diamond-pickaxe')
      await a.requestGamemode('creative')
    })
    await teleport(page, 11.5, 199, 11.5)
    await page.keyboard.down('ShiftLeft')
    try {
      await page.waitForTimeout(1000)
      const v = await verticalSpeed(page, 1000)
      expect(near(-v, MC.LAVA_SNEAK_SINK), `sank at ${(-v).toFixed(3)} b/s`
        + ` vs ${MC.LAVA_SNEAK_SINK}`).toBe(true)
    } finally {
      await page.keyboard.up('ShiftLeft')
    }
  })

  test('sneak and jump together cancel, the way two opposite forces should',
    async ({ page, terrain }) => {
      /*
       * aiStep calls jumpInLiquid and goDownInWater from separate `if`s, so
       * both fire when both keys are held and the +0.04 and -0.04 annihilate.
       * Written as two independent forces in fluids.js for exactly this, and
       * this is the assertion that stops someone "tidying" it into an if/else.
       */
      await fill(page, terrain, [['water', SHAFT_MIN, SHAFT_MAX]])
      await teleport(page, 11.5, 195, 11.5)
      await page.keyboard.down('Space')
      await page.keyboard.down('ShiftLeft')
      try {
        await page.waitForTimeout(1200)
        const v = await verticalSpeed(page, 1200)
        expect(near(-v, MC.WATER_SINK, 0.08), `drifted at ${(-v).toFixed(3)} b/s`
          + ` vs the passive ${MC.WATER_SINK}`).toBe(true)
      } finally {
        await page.keyboard.up('Space')
        await page.keyboard.up('ShiftLeft')
      }
    })
})
