/*
 * CHAPTER 6, THE CLIMB, PLAYED ONE JUMP AT A TIME.
 *
 * ------------------------------------------------------------------------
 * The claim src/builds/ch6-the-climb.js makes in its header is strict:
 * every jump on the course can be made FROM A STANDSTILL in the middle of its
 * take-off pad -- stage 1 without sprinting, the rest with. This file is the
 * only thing that makes that claim true rather than believed. For each of the
 * course's jumps it stands the player still on the take-off, points the
 * camera at the landing, holds forward (and sprint, where the stage allows
 * it), presses jump when the front of the player's feet leaves the pad, lets
 * go of forward on touchdown, and asserts the player is standing on the
 * landing pad at its height.
 *
 * The inputs are noa's own input state -- the object the keyboard handler
 * writes and src/physics.js reads every tick -- driven from inside the page on
 * the tick event, because a jump timed from node over CDP lands ten ticks
 * late. Nothing writes to the physics body once a jump starts.
 *
 * Three more claims ride along, each the one a visitor would find the hard
 * way if it were false:
 *   - missing a jump costs a stage, never health: the net under a stage
 *     catches a fall from its highest pad with no damage;
 *   - the way down works: walking off the diving board at the summit drops
 *     fifty blocks into the moat and costs nothing;
 *   - the geometry obeys its own table (node-side, no browser): no flat gap
 *     over 3, no rise over a gap over 3, four blocks of headroom everywhere.
 *
 * The course is in a TEST-ONLY world (test/helpers/previewWorld.js) until
 * the landscape pass wires chapter 6 into the overworld.
 * ------------------------------------------------------------------------
 */
import { test, expect } from './fixtures.js'
import { waitTicks, leaveWorld } from './helpers/world.js'
import { enterPreview, previewWorldXYZ, inPage } from './helpers/previewWorld.js'
import { GROUND_Y } from '../src/builds/plots.js'

/*
 * The course's own data, fetched from the page: the build file imports
 * src/signText.js, which only vite can resolve, so node never loads it (see
 * test/helpers/previewLayout.js). One round trip, cached for the file.
 */
let COURSE = null
async function course(page) {
  if (!COURSE) {
    COURSE = await page.evaluate(async () => {
      const m = await import('/src/builds/ch6-the-climb.js')
      return { JUMPS: m.JUMPS, ROUTE: m.ROUTE, SUMMIT: m.SUMMIT }
    })
  }
  return COURSE
}

/** Air blocks between two rectangles along x and along z -- restated from the
 *  build rather than imported, so the spec's arithmetic is its own. */
function gaps(a, b) {
  return {
    x: Math.max(b.x0 - a.x1, a.x0 - b.x1) - 1,
    z: Math.max(b.z0 - a.z1, a.z0 - b.z1) - 1,
  }
}

/** The cell of rect `a` nearest rect `b`, as the centre of that block. */
function nearestCell(a, b) {
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2
  const x = Math.min(a.x1, Math.max(a.x0, Math.round(cx)))
  const z = Math.min(a.z1, Math.max(a.z0, Math.round(cz)))
  return [x, z]
}

/** Where to stand for a jump and where to look. A one-block or two-block pad
 *  is stood on at its middle; a stretch of island at the cell nearest the
 *  landing, which is where anybody would walk to before jumping. */
function plan(j) {
  const small = (r) => r.x1 - r.x0 <= 1 && r.z1 - r.z0 <= 1
  const [fx, fz] = small(j.from)
    ? [(j.from.x0 + j.from.x1) / 2, (j.from.z0 + j.from.z1) / 2]
    : nearestCell(j.from, j.to)
  const [tx, tz] = small(j.to)
    ? [(j.to.x0 + j.to.x1) / 2, (j.to.z0 + j.to.z1) / 2]
    : nearestCell(j.to, j.from)
  const [wfx, wfy, wfz] = previewWorldXYZ('ch6', fx + 0.5, j.from.y + 1, fz + 0.5)
  const [wtx, , wtz] = previewWorldXYZ('ch6', tx + 0.5, 0, tz + 0.5)
  const box = previewWorldXYZ('ch6', j.to.x0, j.to.y + 1, j.to.z0)
  const box1 = previewWorldXYZ('ch6', j.to.x1 + 1, 0, j.to.z1 + 1)
  return {
    from: [wfx, wfy, wfz], aim: [wtx, wtz],
    land: { x0: box[0] - 0.3, x1: box1[0] + 0.3, z0: box[2] - 0.3, z1: box1[2] + 0.3, y: box[1] },
  }
}

/** One jump, played in the page. Resolves with where the player came down. */
function play(page, p, sprint) {
  return page.evaluate(async ([p, sprint]) => {
    const noa = window.noa
    const ent = noa.playerEntity
    const body = noa.ents.getPhysics(ent).body
    const S = noa.inputs.state
    const stop = () => { S.forward = false; S.sprint = false; S.jump = false }
    stop()
    noa.ents.setPosition(ent, p.from)
    body.velocity[0] = body.velocity[1] = body.velocity[2] = 0
    window.game.survival.clearFallTracking()
    /* Wait for the take-off block to be meshed and the player to be resting
     * on it: a teleport fifty blocks up lands in a chunk that may not exist
     * yet, and a jump from inside an unloaded chunk is a fall. */
    const fx = Math.floor(p.from[0]), fy = Math.floor(p.from[1]) - 1, fz = Math.floor(p.from[2])
    for (let i = 0; i < 300; i++) {
      await new Promise(r => setTimeout(r, 20))
      if (noa.getBlock(fx, fy, fz) !== 0 && body.atRestY() < 0) break
      noa.ents.setPosition(ent, p.from)
      body.velocity[0] = body.velocity[1] = body.velocity[2] = 0
    }
    await new Promise(r => setTimeout(r, 120))
    return new Promise((resolve) => {
      let ticks = 0, jumped = false, airborne = false, landedAt = 0
      const fn = () => {
        ticks++
        const pos = noa.ents.getPositionData(ent).position
        const grounded = body.atRestY() < 0
        const h = Math.atan2(p.aim[0] - pos[0], p.aim[1] - pos[2])
        if (!airborne) noa.camera.heading = h
        if (!landedAt) { S.forward = true; S.sprint = sprint }
        /* Jump when the front of the feet is over nothing solid. */
        const fxp = Math.floor(pos[0] + Math.sin(noa.camera.heading) * 0.35)
        const fzp = Math.floor(pos[2] + Math.cos(noa.camera.heading) * 0.35)
        const feet = Math.floor(pos[1] + 0.01)
        const under = noa.getBlock(fxp, feet - 1, fzp)
        const footing = under !== 0 && noa.registry.getBlockSolidity(under)
        /* ...or when there is a block in front of the feet: the first jump
         * of every stage is a hop up from the island onto a pad, and there
         * is no edge to run off, only a step to get on to. */
        const wall = noa.getBlock(fxp, feet, fzp)
        const blocked = wall !== 0 && noa.registry.getBlockSolidity(wall)
        S.jump = grounded && !jumped && (!footing || blocked)
        if (S.jump) jumped = true
        /* Airborne only once the body has actually left the ground: the
         * impulse lands on the tick AFTER the key, and counting the press as
         * the take-off made every jump "land" before it began. */
        if (jumped && !grounded) airborne = true
        if (airborne && grounded && !landedAt) { landedAt = ticks; stop() }
        if (landedAt && ticks - landedAt > 6) {
          noa.off('tick', fn)
          stop()
          resolve({ pos: [...pos].map(v => Number(v.toFixed(2))), ticks })
        }
        if (ticks > 150) {
          noa.off('tick', fn); stop()
          resolve({ pos: [...pos].map(v => Number(v.toFixed(2))), ticks, timeout: true })
        }
      }
      noa.on('tick', fn)
    })
  }, [p, sprint])
}

const onLanding = (r, land) =>
  !r.timeout && Math.abs(r.pos[1] - land.y) < 0.05
  && r.pos[0] >= land.x0 && r.pos[0] <= land.x1 && r.pos[2] >= land.z0 && r.pos[2] <= land.z1

test.describe('the climb, jumped', () => {
  test.beforeEach(async ({ page }) => {
    await enterPreview(page, ['ch6', 8, 12])
    await waitTicks(page, 10)
  })
  test.afterEach(async ({ page }) => { await leaveWorld(page) })

  test('every jump on the course, from a standstill', async ({ page }) => {
    test.setTimeout(15 * 60_000)
    const { JUMPS } = await course(page)
    const only = process.env.CLIMB_ONLY ? Number(process.env.CLIMB_ONLY) : null
    const failed = []
    const log = []
    for (const j of JUMPS.filter(j => only === null || j.stage === only)) {
      const p = plan(j)
      /* Walking first, and sprint only if walking falls short -- which is
       * what a player does, and the only way to land a short jump onto a
       * one-block pad: a sprint jump from a standstill carries nearly four
       * blocks and sails straight over it. Stage 1 never sprints. */
      let r = await play(page, p, false)
      let ok = onLanding(r, p.land)
      let mode = 'walking'
      if (!ok && j.sprint) {
        r = await play(page, p, true)
        ok = onLanding(r, p.land)
        mode = 'sprint'
      }
      const g = gaps(j.from, j.to)
      log.push(`${ok ? 'ok  ' : 'MISS'} stage ${j.stage} jump ${j.n} `
        + `(gap ${Math.max(g.x, 0)}x${Math.max(g.z, 0)}, ${j.to.y - j.from.y >= 0 ? '+' : ''}${j.to.y - j.from.y}`
        + `, ${mode}) -> ${JSON.stringify(r.pos)}`)
      if (!ok) failed.push(log[log.length - 1])
    }
    console.log(log.join('\n'))
    expect(failed, failed.join('\n')).toEqual([])
  })

  test('a miss costs a stage, not health', async ({ page }) => {
    /* Off the highest pad of stage 3, straight down: nine blocks onto the
     * stage 3 island, which is six half-hearts on dry ground. The net is
     * what makes it zero. */
    const { ROUTE } = await course(page)
    const r = ROUTE[2]
    const top = r.pads[r.pads.length - 2]
    await page.evaluate(() => window.game.survival.reset())
    const [x, y, z] = previewWorldXYZ('ch6', top.x0 + 0.5, top.y + 2, top.z0 - 1 + 0.5)
    await page.evaluate(([x, y, z]) => {
      const noa = window.noa
      noa.ents.setPosition(noa.playerEntity, [x, y, z])
      const b = noa.ents.getPhysics(noa.playerEntity).body
      b.velocity[0] = b.velocity[1] = b.velocity[2] = 0
      window.game.survival.clearFallTracking()
    }, [x, y, z])
    await page.waitForFunction(() => {
      const noa = window.noa
      return noa.ents.getPhysics(noa.playerEntity).body.atRestY() < 0
    }, null, { timeout: 15_000, polling: 50 })
    await page.waitForTimeout(800)
    const health = await page.evaluate(() => window.game.survival.health)
    const pos = await page.evaluate(() => [...window.noa.ents.getPositionData(window.noa.playerEntity).position])
    expect(pos[1], 'came down on the stage 3 island').toBeLessThan(GROUND_Y + 20.5)
    expect(pos[1]).toBeGreaterThan(GROUND_Y + 17)
    expect(health, `took ${20 - health} half-hearts`).toBe(20)
  })

  test('the leap off the summit lands in the moat, unhurt', async ({ page }) => {
    const { SUMMIT } = await course(page)
    await page.evaluate(() => window.game.survival.reset())
    /* Stand at the root of the diving board and walk off its end. */
    const [x, y, z] = previewWorldXYZ('ch6', SUMMIT.x0 - 1 + 0.5, SUMMIT.H, 39 + 0.5)
    const [ax, , az] = previewWorldXYZ('ch6', 0, 0, 39 + 0.5)
    const r = await page.evaluate(async ([x, y, z, ax, az]) => {
      const noa = window.noa
      const ent = noa.playerEntity
      const body = noa.ents.getPhysics(ent).body
      for (let i = 0; i < 300; i++) {
        noa.ents.setPosition(ent, [x, y, z])
        body.velocity[0] = body.velocity[1] = body.velocity[2] = 0
        await new Promise(r => setTimeout(r, 20))
        if (body.atRestY() < 0) break
      }
      window.game.survival.clearFallTracking()
      noa.camera.heading = Math.atan2(ax - x, az - z)
      noa.inputs.state.forward = true
      let low = Infinity
      for (let i = 0; i < 400; i++) {
        await new Promise(r => setTimeout(r, 20))
        const pos = noa.ents.getPositionData(ent).position
        low = Math.min(low, pos[1])
        if (pos[1] < y - 3) noa.inputs.state.forward = false
        if (pos[1] < 136 && body.atRestY() < 0) break
      }
      noa.inputs.state.forward = false
      await new Promise(r => setTimeout(r, 1000))
      return {
        pos: [...noa.ents.getPositionData(ent).position],
        health: window.game.survival.health,
        feet: window.game.blockKey(noa.getBlock(...noa.ents.getPositionData(ent).position.map(Math.floor))),
        low,
      }
    }, [x, y, z, ax, az])
    expect(r.low, `lowest point ${r.low}`).toBeLessThan(GROUND_Y)
    expect(r.health, `took ${20 - r.health} half-hearts from fifty blocks`).toBe(20)
  })
})

test.describe('the climb, measured', () => {
  /*
   * The geometry, asked of the GENERATOR (a patch stamped in the page by the
   * same code the game runs) rather than of meshed chunks, so the answers do
   * not depend on where the camera is.
   */
  test('no jump is longer than the table in the build header allows', async ({ page }) => {
    const { JUMPS } = await course(page)
    const bad = []
    for (const j of JUMPS) {
      const g = gaps(j.from, j.to)
      const dy = j.to.y - j.from.y
      const span = Math.max(g.x, g.z)
      const diagonal = g.x >= 0 && g.z >= 0
      // Measured limits, from the header of ch6-the-climb.js.
      const limit = j.sprint ? 3 : (dy > 0 ? 1 : 2)
      if (dy > 1) bad.push(`stage ${j.stage} jump ${j.n} rises ${dy}`)
      if (span > limit) bad.push(`stage ${j.stage} jump ${j.n} spans ${span} (limit ${limit})`)
      if (diagonal && Math.hypot(g.x + 1, g.z + 1) > 3.2) bad.push(`stage ${j.stage} jump ${j.n} is a long diagonal`)
      if (span < 1 && !diagonal) bad.push(`stage ${j.stage} jump ${j.n} is a step, not a jump`)
    }
    expect(bad, bad.join('\n')).toEqual([])
    expect(JUMPS.length, 'the course has jumps').toBeGreaterThan(50)
  })

  test('every pad is there, has headroom, and the water is held in', async ({ page }) => {
    const problems = await inPage(page, (mod) => {
      const w = mod.previewPatch()
      const at = mod.reader(w, 'ch6')
      const p = mod.previewPlot('ch6')
      const W = p.x1 - p.x0 + 1, D = p.z1 - p.z0 + 1
      const { ROUTE } = mod.BUILDS.ch6
      const bad = []
      for (const r of ROUTE) {
        for (const pad of [...r.pads, r.end]) {
          for (let x = pad.x0; x <= pad.x1; x++) {
            for (let z = pad.z0; z <= pad.z1; z++) {
              const k = at(x, pad.y, z)
              if (k === 'air' || k === 'water') bad.push(`stage ${r.stage}: nothing to stand on at (${x}, ${pad.y}, ${z})`)
              for (let y = pad.y + 1; y <= pad.y + 4; y++) {
                if (at(x, y, z) !== 'air') bad.push(`stage ${r.stage}: ${at(x, y, z)} over the pad at (${x}, ${y}, ${z})`)
              }
            }
          }
        }
      }
      /* A source with air beside or under it flows at runtime, and stamped
       * water on a floating island is a waterfall onto the stage below. */
      for (let x = 0; x < W; x++) {
        for (let z = 0; z < D; z++) {
          for (let y = -3; y <= 60; y++) {
            if (at(x, y, z) !== 'water') continue
            for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]) {
              const nx = x + dx, nz = z + dz
              if (nx < 0 || nz < 0 || nx >= W || nz >= D) { bad.push(`water at the plot edge (${x}, ${y}, ${z})`); continue }
              if (at(nx, y + dy, nz) === 'air') bad.push(`water leaks at (${x}, ${y}, ${z}) -> (${dx}, ${dy}, ${dz})`)
            }
          }
        }
      }
      /* The net: under every pad of stages 2-5 from the third on, within
       * fourteen blocks below, is water. EXCEPT the last pad of each stage,
       * which stands on the island's very rim to make the crossing over the
       * corridor: a rim block cannot hold water (it has air on its outer
       * side), and the miss that matters from there -- short of the far
       * island -- falls down the corridor into the moat, which the next
       * check asks about. */
      for (const r of ROUTE.slice(1)) {
        for (const pad of r.pads.slice(2, -1)) {
          let found = false
          for (let y = pad.y - 1; y >= pad.y - 14 && !found; y--) {
            const k = at(pad.x0, y, pad.z0)
            if (k === 'water') found = true
            else if (k !== 'air' && y < pad.y - 1) break
          }
          if (!found) bad.push(`stage ${r.stage} pad at (${pad.x0}, ${pad.y}, ${pad.z0}) has no net under it`)
        }
      }
      /* The corridors are clear from the top of the course to the moat:
       * any miss on a crossing, and the leap off the summit, go straight
       * down into water. Sampled at the middle of each corridor. */
      for (let z = 7; z <= 73; z++) {
        if (z >= 34 && z <= 44) continue            // under the summit and the mast
        if (z === 24 || z === 25) continue           // stage 1 crosses here, low, over the moat
        for (let y = 0; y <= 60; y++) if (at(36, y, z) !== 'air') { bad.push(`corridor blocked at (36, ${y}, ${z}): ${at(36, y, z)}`); break }
        if (at(36, -1, z) !== 'water') bad.push(`no moat under the corridor at (36, ${z})`)
      }
      for (let x = 2; x <= 71; x++) {
        if (x >= 26 && x <= 46) continue            // the mast, the summit and its board
        for (let y = 0; y <= 60; y++) if (at(x, y, 39) !== 'air') { bad.push(`corridor blocked at (${x}, ${y}, 39): ${at(x, y, 39)}`); break }
        if (at(x, -1, 39) !== 'water' && at(x, -3, 39) !== 'sea_lantern') bad.push(`no moat under the corridor at (${x}, 39)`)
      }
      return bad
    })
    expect(problems.slice(0, 12).join('\n'), `${problems.length} problems`).toBe('')
  })
})
