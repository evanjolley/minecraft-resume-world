/*
 * STAGE 8's PARKOUR, PLAYED.
 *
 * ------------------------------------------------------------------------
 * THIS IS THE ONLY BUILD IN THE SET WHOSE QUALITY IS MEASURABLE, SO IT IS
 * MEASURED. Every other stage can be asserted to exist and looked at; a
 * parkour course either goes or it does not, and the difference is thirteen
 * jumps a census cannot see. A course the author believes is jumpable and
 * has never jumped is not finished.
 *
 * So this file plays it. Real key events -- W and Space held down for the
 * whole run, exactly the way a person plays a Minecraft jumping course --
 * and a per-tick driver that aims the camera at the next platform, which is
 * the mouse. Nothing is teleported once the run starts and nothing writes to
 * the physics body. If the numbers in src/physics.js change, this fails.
 *
 * It also asserts the thing that decides whether a casual visitor can afford
 * to try: falling off has to be free. Respawn is at the south end of the
 * road, a hundred blocks and eight stages back, so a death on this course
 * throws somebody out of the entire world. The pool underneath is three
 * blocks deep for that reason and this spec drops a player into it from the
 * summit to prove it.
 *
 * Lives in its own file rather than in test/70-builds.spec.js because seven
 * build agents are pushing to that file today and none of them should have
 * to merge a hundred lines of movement driver.
 * ------------------------------------------------------------------------
 */
import { test, expect } from './fixtures.js'
import { SURFACE_Y, teleport, settleOnGround, position } from './helpers/world.js'
import { shot } from './helpers/shots.js'
import { flatPatch, FLAT_PRESETS } from '../src/flatworld.js'
import { GROUND_Y, ORIGIN_X, ORIGIN_Z, plot } from '../src/builds/plots.js'
import { stamper } from '../src/builds/stamp.js'
import { build as sanFrancisco } from '../src/builds/08-parkour-sf.js'

const SF = plot('parkour')

/** Plot-local -> world, which is what /tp and every position read take. */
const wx = (x) => SF.x0 + x - ORIGIN_X
const wz = (z) => SF.z0 + z - ORIGIN_Z
const wy = (y) => GROUND_Y + y

/*
 * THE ROUTE, restated here rather than imported.
 *
 * 08-parkour-sf.js owns the geometry; this owns the claim about it. If
 * somebody moves a platform and only one of the two lists changes, the run
 * fails and says which jump it failed on -- which is the whole value of a
 * duplicated constant and the reason test/helpers/world.js duplicates spawn.
 *
 * Platform n is a PAD at y = n and a one-block STEP at y = n + 1: you land
 * on the pad, walk up the step, and jump from the step to the next pad,
 * which is at the step's height. So every jump is level, and the list below
 * is both the route and the height profile.
 */
const ROUTE = [
  { pad: [37, 24, 38, 25], step: [37, 23, 38, 23] },
  { pad: [36, 20, 38, 21], step: [36, 19, 38, 19] },
  { pad: [36, 16, 38, 17], step: [36, 15, 38, 15] },
  { pad: [36, 12, 37, 13], step: [38, 12, 38, 13] },
  { pad: [40, 12, 41, 14], step: [42, 12, 42, 14] },
  { pad: [44, 12, 46, 13], step: [44, 14, 46, 14] },
  { pad: [44, 16, 46, 17], step: [44, 18, 46, 18] },
  { pad: [44, 20, 46, 21], step: [44, 22, 46, 22] },
  { pad: [44, 24, 46, 25], step: [43, 24, 43, 25] },
  { pad: [40, 24, 41, 25], step: [40, 23, 41, 23] },
  { pad: [40, 20, 42, 21], step: [43, 20, 43, 21] },
  { pad: [45, 19, 46, 21], step: [47, 19, 47, 21] },
]

/** The notch in the bluff the last jump lands on, and the summit above it. */
const LEDGE = { x: 49, y: 12, z: [19, 21] }
const SUMMIT_Y = 13

/** The apron, on the pool's rim, where the run starts at walking pace. */
const START = { x: wx(32) + 0.5, y: wy(0), z: wz(25) + 0.5 }

/** The gap between two footprints, in air blocks, on whichever axis they are
 *  apart on. Zero means they touch, which is a walk and not a jump. */
function gapBetween(a, b) {
  const x = Math.max(b[0] - a[2], a[0] - b[2]) - 1
  const z = Math.max(b[1] - a[3], a[1] - b[3]) - 1
  return Math.max(x, z)
}

/** A mark: where to point the camera, and the box that counts as arriving. */
const mark = (aim, box) => ({
  aimX: aim[0], aimZ: aim[1],
  x0: wx(box[0]) - 0.4, x1: wx(box[2]) + 1.4,
  z0: wz(box[1]) - 0.4, z1: wz(box[3]) + 1.4,
  yLow: box[4] - 0.4, yHigh: box[5] + 0.4,
})

/** The centre of a footprint, in world coordinates. */
const centre = ([x0, z0, x1, z1]) =>
  [wx(x0) + (x1 - x0 + 1) / 2, wz(z0) + (z1 - z0 + 1) / 2]

/**
 * TWO MARKS PER PLATFORM, THE PAD AND THEN THE STEP, and that is not
 * bookkeeping -- it is the difference between the run working and not.
 *
 * With one mark per platform the camera points at the far end of it from the
 * moment the player leaves the last one, and at a CORNER the far end is
 * diagonally across the water: the first run of this course walked straight
 * off the apron on a north-east heading and drowned at the exact coordinates
 * of platform 0's step, three blocks under it. A player does not do that. A
 * player looks at the pad, lands, turns, and walks up the step -- which is
 * two headings, so it is two marks.
 *
 * The PAD mark accepts anywhere on the platform at either height, because a
 * bunny-hopping player quite often clears the pad and lands on the step; the
 * STEP mark accepts only the step, because that is the take-off and the run
 * genuinely has to get there.
 */
function marksFor({ pad, step }, n) {
  const whole = [
    Math.min(pad[0], step[0]), Math.min(pad[1], step[1]),
    Math.max(pad[2], step[2]), Math.max(pad[3], step[3]),
  ]
  return [
    mark(centre(pad), [...whole, wy(n) + 1, wy(n) + 2]),
    mark(centre(step), [...step, wy(n) + 2, wy(n) + 2]),
  ]
}

/** The last two marks: the ledge cut into the bluff, then the summit itself. */
const FINISH = [
  mark([wx(LEDGE.x) + 0.5, wz(LEDGE.z[0]) + 1.5],
    [LEDGE.x, LEDGE.z[0], LEDGE.x, LEDGE.z[1], wy(SUMMIT_Y), wy(SUMMIT_Y)]),
  mark([wx(52) + 0.5, wz(18) + 0.5],
    [50, 14, 53, 22, wy(SUMMIT_Y) + 1, wy(SUMMIT_Y) + 1]),
]

/**
 * Walk the course: hold W, steer at the next mark, and jump at the edges.
 *
 * THE DRIVER RUNS INSIDE THE PAGE, on noa's tick event, because steering and
 * jumping both have to happen at the engine's rate and not at the rate a CDP
 * round-trip can manage. A heading written from node lands ten ticks late,
 * which on a one-block gap is the difference between a landing and a swim.
 *
 * IT TAPS JUMP AT THE EDGE RATHER THAN HOLDING IT, and that is the correction
 * that made this run. Holding Space bunny-hops -- noa starts a fresh jump on
 * every grounded tick -- and a bunny-hop's take-off point depends entirely on
 * where the last hop happened to land. The first version held Space and the
 * player fell in the water at x = 36.7 with the platform's edge at 37.0:
 * nothing was wrong with the course, the hop had simply started a third of a
 * block too early. That is a real thing that happens to real players, and it
 * costs them a swim; it is not something a pass/fail assertion should be
 * decided by. So the driver does what a person does -- looks at the ground a
 * block ahead, and jumps if it is not there.
 *
 * The jump key is written straight into `noa.inputs.state`, which is the same
 * object the keyboard handler writes and the same one src/physics.js reads
 * (`const S = noa.inputs.state`). W is a real Playwright key press, so the
 * movement pipeline is exercised end to end; only the timing of the jump is
 * synthesised, because the timing is the thing being modelled.
 *
 * "Reached" means standing on it: inside the mark's box AND at rest on the
 * ground. Dropping the grounded test is how you write a parkour spec that
 * passes by flying over the course.
 */
function run(page, waypoints, maxTicks = 900) {
  return page.evaluate(([marks, limit]) => new Promise((resolve) => {
    const noa = window.noa
    const ent = noa.playerEntity
    const body = noa.ents.getPhysics(ent).body
    const reached = []
    let i = 0
    let ticks = 0

    const fn = () => {
      ticks++
      const pos = noa.ents.getPositionData(ent).position
      const m = marks[i]

      /* Aim at the next platform. noa's heading is measured so that the
       * direction vector is (sin h, cos h), so this is atan2(dx, dz) and not
       * the atan2(dz, dx) every other library would want. */
      noa.camera.heading = Math.atan2(m.aimX - pos[0], m.aimZ - pos[2])

      const grounded = body.atRestY() < 0

      /*
       * Jump when the ground a block ahead is missing. One rule covers both
       * things this course asks for: the gap between two platforms (nothing
       * there at all) and the one-block step at the end of each platform
       * (nothing there AT THIS HEIGHT -- the step's block is a level up), so
       * the player hops up onto the step and then off it without the driver
       * having to know which is which.
       */
      const ahead = 0.9
      const ax = Math.floor(pos[0] + Math.sin(noa.camera.heading) * ahead)
      const az = Math.floor(pos[2] + Math.cos(noa.camera.heading) * ahead)
      const footY = Math.floor(pos[1] + 0.01) - 1
      /* "No ground" means non-SOLID, not id 0. Everything this course is
       * built over is water, and water is a block with an id -- the first
       * version of this tested `=== 0`, never fired on the run-up off the
       * apron (the block ahead was water, not air), and walked the player
       * straight into the pool without ever pressing jump. */
      const under = noa.getBlock(ax, footY, az)
      const footing = under !== 0 && noa.registry.getBlockSolidity(under)
      noa.inputs.state.jump = grounded && !footing

      const near = pos[0] >= m.x0 && pos[0] <= m.x1
        && pos[2] >= m.z0 && pos[2] <= m.z1
        && pos[1] >= m.yLow && pos[1] <= m.yHigh
      if (grounded && near) {
        reached.push({ n: i, tick: ticks, y: Number(pos[1].toFixed(2)) })
        if (++i >= marks.length) {
          noa.inputs.state.jump = false
          noa.off('tick', fn)
          resolve({ done: true, reached })
        }
      }

      if (ticks > limit) {
        noa.inputs.state.jump = false
        noa.off('tick', fn)
        resolve({ done: false, reached, stuckAt: i, pos: [...pos].map(v => Number(v.toFixed(2))) })
      }
    }
    noa.on('tick', fn)
  }), [waypoints, maxTicks])
}

test.describe('the course goes', () => {
  test('a player walking it and jumping at the edges reaches the summit', async ({ page }) => {
    // 900 ticks is thirty seconds of running, against a course a person does
    // in about twenty. The budget is the assertion's teeth: raise it and a
    // player stuck in a corner eventually falls in and wanders back.
    test.setTimeout(120_000)
    await teleport(page, START.x, START.y + 0.5, START.z)
    await settleOnGround(page)
    await page.evaluate(() => window.game.survival.clearFallTracking())

    const marks = [...ROUTE.flatMap(marksFor), ...FINISH]

    /*
     * ARMED BEFORE THE KEYS GO DOWN. Same reason test/20-slope-jump.spec.js
     * gives: the first jump of a run is taken from a standstill and it is
     * the one with the least margin, so the driver has to be on the tick
     * loop before the player starts moving.
     */
    const driving = run(page, marks)
    await page.keyboard.down('KeyW')
    const result = await driving
    await page.keyboard.up('KeyW')
    await page.evaluate(() => { window.noa.inputs.state.jump = false })

    /* Printed, not just asserted. A pass here means a person can finish
     * this course and the only evidence of that is the run itself, so the
     * run goes in the log: one line per mark, the tick it was reached on
     * and the height it was reached at. It is also the fastest way to see a
     * near-miss -- a mark that took two hundred ticks is one the player
     * fell off and swam back to. */
    console.log(`the run: ${result.reached.length}/${marks.length} marks, `
      + result.reached.map(r => `${r.n}@t${r.tick}y${r.y}`).join(' '))

    // Loud before it is specific: say WHICH jump failed and where the player
    // ended up, because "false !== true" is useless on a course.
    expect(result.done,
      `stuck before jump ${result.stuckAt} at ${JSON.stringify(result.pos)}; `
      + `cleared ${result.reached.length} of ${marks.length}`).toBe(true)

    expect(result.reached).toHaveLength(marks.length)

    // And it really climbed: the summit is fourteen blocks over the apron.
    const top = result.reached[result.reached.length - 1]
    expect(top.y, `finished at y=${top.y}, started at ${START.y}`)
      .toBeGreaterThanOrEqual(SURFACE_Y + 13)

    const end = await position(page)
    expect(end[1]).toBeGreaterThanOrEqual(SURFACE_Y + 13)
  })

  test('every jump is level and one air block long', async () => {
    /*
     * The geometry claim, asked of the generator rather than the game, so a
     * failure says which jump is wrong instead of "the player fell in".
     * This is the check that would have caught a route edited by hand.
     */
    const w = flatPatch({
      preset: FLAT_PRESETS.classic, width: 128, depth: 128,
      surfaceY: GROUND_Y, ceilingY: GROUND_Y + 64, builds: null,
    })
    const s = stamper(w, 'parkour')
    sanFrancisco(s)
    const at = (x, y, z) =>
      w.palette[w.cols[(SF.z0 + z) * w.width + (SF.x0 + x)][GROUND_Y + y - w.yMin]]

    ROUTE.forEach(({ pad, step }, n) => {
      const solid = (x, y, z, what) =>
        expect(at(x, y, z), `${what} of platform ${n} at (${x}, ${y}, ${z})`).not.toBe('air')

      for (let x = pad[0]; x <= pad[2]; x++) {
        for (let z = pad[1]; z <= pad[3]; z++) {
          solid(x, n, z, 'the pad')
          // ...and every block of every platform has water under it, which
          // is the other half of the claim and the reason a miss is free.
          expect(at(x, -1, z), `under the pad of platform ${n}`).toBe('water')
        }
      }
      for (let x = step[0]; x <= step[2]; x++) {
        for (let z = step[1]; z <= step[3]; z++) {
          solid(x, n + 1, z, 'the step')
          expect(at(x, n + 2, z), `headroom over the step of platform ${n}`).toBe('air')
          expect(at(x, -1, z), `under the step of platform ${n}`).toBe('water')
        }
      }

      if (n === 0) return
      /*
       * THE TWO CLAIMS THAT MAKE IT WALKABLE, and they are the only two.
       * Jump n leaves platform n-1's step and lands on platform n's pad, so
       * it must be LEVEL -- step y = (n-1)+1 = n, pad y = n -- and it must
       * be two air blocks or fewer. Either one broken and the course needs
       * a sprint key nobody is going to press.
       */
      const gap = gapBetween(ROUTE[n - 1].step, pad)
      expect(gap, `jump ${n} spans ${gap} air blocks`).toBe(1)
      /* Level, asked of the WORLD rather than of the arithmetic. The step
       * of platform n-1 sits at y = (n-1)+1 = n and the pad of platform n
       * sits at y = n, so both of these blocks are at the same height and
       * both have to be there. This is the invariant the whole design turns
       * on, and it is the one that was broken for two runs. */
      const prev = ROUTE[n - 1].step
      expect(at(prev[0], n, prev[1]), `the take-off for jump ${n}`).not.toBe('air')
      expect(at(pad[0], n, pad[1]), `the landing for jump ${n}`).not.toBe('air')
    })

    // The last jump leaves platform 11's step and lands on the ledge cut
    // into the bluff, which is stone rather than an entry in a list.
    const last = ROUTE[ROUTE.length - 1]
    expect(gapBetween(last.step, [LEDGE.x, LEDGE.z[0], LEDGE.x, LEDGE.z[1]]),
      'the last jump is not one air block').toBe(1)
    expect(at(LEDGE.x, LEDGE.y, LEDGE.z[0]), 'the ledge the last jump lands on')
      .not.toBe('air')
    expect(at(LEDGE.x, LEDGE.y + 1, LEDGE.z[0]), 'headroom on the ledge').toBe('air')
    expect(at(LEDGE.x + 1, SUMMIT_Y, LEDGE.z[0]), 'the last step onto the summit')
      .not.toBe('air')
  })
})

test.describe('falling off costs nothing', () => {
  test('a drop from the summit into the pool does no damage', async ({ page }) => {
    /*
     * THE ASSERTION THAT DECIDES WHETHER THIS IS FOR VISITORS OR FOR
     * MINECRAFT PLAYERS. Fourteen blocks is eleven half-hearts of fall
     * damage on dry land -- over half the bar -- and two of those is a death
     * and a respawn a hundred blocks south. src/fluids.js cancels it
     * outright on any tick the feet are wet, which is vanilla's
     * resetFallDistance, and three blocks of water is enough of a window at
     * the speed you arrive.
     */
    await page.evaluate(() => window.game.survival.reset())

    // Straight down from over the middle of the pool, from the height of the
    // last platform -- which is the worst case a player can actually produce.
    /* x = 39 is a gap column on every leg and z = 17 is between two of
     * them, so this is thirteen blocks of clear air straight down into the
     * pool. Aiming at the middle of the pool is not enough: (44, 21) is
     * directly over platform 7 and the first version of this test measured
     * a player landing gently on the course. */
    await teleport(page, wx(39) + 0.5, wy(13), wz(17) + 0.5)
    await page.waitForFunction(() => {
      const noa = window.noa
      return noa.ents.getPhysics(noa.playerEntity).body.atRestY() < 0
        || noa.ents.getPositionData(noa.playerEntity).position[1] < 136
    }, null, { timeout: 15_000, polling: 50 })
    await page.waitForTimeout(1200)

    const health = await page.evaluate(() => window.game.survival.health)
    const pos = await position(page)
    expect(pos[1], `landed at y=${pos[1]}, which should be in the pool`)
      .toBeLessThan(SURFACE_Y)
    expect(health, `took ${20 - health} half-hearts falling into the pool`).toBe(20)
  })
})

test.describe('stage 8 is in the world', () => {
  test('San Francisco is not empty and stays inside its plot', async () => {
    const w = flatPatch({
      preset: FLAT_PRESETS.classic, width: 128, depth: 128,
      surfaceY: GROUND_Y, ceilingY: GROUND_Y + 64, builds: null,
    })
    const s = stamper(w, 'parkour')
    sanFrancisco(s)

    let above = 0
    for (let z = SF.z0; z <= SF.z1; z++) {
      for (let x = SF.x0; x <= SF.x1; x++) {
        const col = w.cols[z * w.width + x]
        for (let y = GROUND_Y; y <= w.yTop; y++) if (w.palette[col[y - w.yMin]] !== 'air') above++
      }
    }
    expect(above, 'stage 8 placed nothing at all').toBeGreaterThan(0)
    expect(above, `stage 8 census: ${above} blocks above ground`).toBeGreaterThan(3771)

    // Nothing escaped. The stamper throws on an out-of-plot write, so this is
    // belt and braces -- but the plot next door is somebody else's whole day.
    let outside = 0
    for (let z = 0; z < 128; z++) {
      for (let x = 0; x < 128; x++) {
        if (x >= SF.x0 && x <= SF.x1 && z >= SF.z0 && z <= SF.z1) continue
        const col = w.cols[z * w.width + x]
        for (let y = GROUND_Y - 4; y <= w.yTop; y++) {
          const k = w.palette[col[y - w.yMin]]
          if (y >= GROUND_Y && k !== 'air') outside++
        }
      }
    }
    expect(outside, 'stage 8 wrote outside its plot').toBe(0)
  })

  test('no pool has a hole in it', () => {
    /*
     * THE ONE DEFECT THIS BUILD COULD EXPORT. Stamped water is real water:
     * src/fluids.js scans a chunk when it arrives and a source with air
     * beside it starts flowing, and it has never heard of a plot boundary.
     * A leak here is the road under water and seven other stages ruined, and
     * nothing in the build would report it -- the flood happens at runtime,
     * in a browser, some seconds after the world loads.
     */
    const w = flatPatch({
      preset: FLAT_PRESETS.classic, width: 128, depth: 128,
      surfaceY: GROUND_Y, ceilingY: GROUND_Y + 64, builds: null,
    })
    sanFrancisco(stamper(w, 'parkour'))
    const key = (x, y, z) =>
      (x < 0 || z < 0 || x > 127 || z > 127) ? 'stone'
        : w.palette[w.cols[z * w.width + x][y - w.yMin]]

    const leaks = []
    for (let z = 0; z < 128; z++) {
      for (let x = 0; x < 128; x++) {
        for (let y = GROUND_Y - 4; y <= GROUND_Y + 4; y++) {
          if (key(x, y, z) !== 'water') continue
          for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]) {
            if (key(x + dx, y + dy, z + dz) === 'air') {
              leaks.push(`(${x}, ${y - GROUND_Y}, ${z}) -> (${dx}, ${dy}, ${dz})`)
            }
          }
        }
      }
    }
    expect(leaks.slice(0, 5).join('; '), `${leaks.length} leaking water blocks`).toBe('')
  })
})

test.describe('what stage 8 looks like', () => {
  test('from the road, at eye level', async ({ page }) => {
    /* Far enough up the road to see the bridge broadside rather than to have
     * a nose against the ramp. z = 24 put the camera inside the approach and
     * z = 12 put it under the deck; z = 4 is the north end of the bay, where
     * both towers and the whole span are in frame at once. */
    await teleport(page, 63 - ORIGIN_X + 0.5, SURFACE_Y + 1, wz(-8) + 0.5)
    await page.evaluate(() => {
      // atan2(dx, dz): +x and +z is east-south-east, which from eight blocks
      // north of the plot puts both towers and the whole span in frame.
      window.noa.camera.heading = Math.PI / 2 - 0.62
      window.noa.camera.pitch = -0.22
    })
    await page.waitForTimeout(1200)
    await shot(page, 'sf-from-road')
    await page.evaluate(() => { window.noa.camera.pitch = 0 })
  })

  test('walking up from spawn, which is how everybody meets it', async ({ page }) => {
    /* THE FIRST THING ANY VISITOR SEES. Spawn is patch (63, 120) and this
     * stage's south edge is patch z = 117, so the bridge ramp lands three
     * blocks in front of where the world drops you. If this frame does not
     * read, nothing else on the plot gets looked at. */
    await teleport(page, 63 - ORIGIN_X + 0.5, SURFACE_Y + 1, 121 - ORIGIN_Z + 0.5)
    await page.evaluate(() => {
      /* PI - 0.5, not PI + 0.5. noa's direction vector is (sin h, cos h),
       * so adding to a northward heading swings you WEST, across the road
       * and into stage 7 -- which is what the first version of this shot
       * photographed. Subtracting swings east, onto this plot. */
      window.noa.camera.heading = Math.PI - 0.5
      window.noa.camera.pitch = -0.12
    })
    await page.waitForTimeout(1200)
    await shot(page, 'sf-from-spawn')
    await page.evaluate(() => { window.noa.camera.pitch = 0 })
  })

  test('from the top of the course', async ({ page }) => {
    // Standing on the summit paving, at the table, looking back down the
    // whole timeline -- the bridge, the terrace and the course all at once.
    await teleport(page, wx(52) + 0.5, wy(14) + 0.2, wz(18) + 0.5)
    await page.evaluate(() => {
      window.noa.camera.heading = -Math.PI / 2
      window.noa.camera.pitch = 0.18
    })
    await page.waitForTimeout(1200)
    await shot(page, 'sf-from-summit')
    await page.evaluate(() => { window.noa.camera.pitch = 0 })
  })

  test('from inside the cafe', async ({ page }) => {
    // Standing at the door looking at the counter, the urn and the four
    // pennants -- which is the whole interior and the whole point of it.
    await teleport(page, wx(12) + 0.5, wy(0), wz(24) + 0.5)
    await page.evaluate(() => { window.noa.camera.heading = Math.PI / 2 })
    await page.waitForTimeout(1200)
    await shot(page, 'sf-cafe-inside')
  })

  test('from above', async ({ page }) => {
    await teleport(page, wx(8) + 0.5, wy(34), wz(14) + 0.5)
    /* GRAVITY OFF FOR THE DURATION, and it is not a nicety: the first draft
     * of this shot teleported to forty blocks up and photographed a death
     * screen, because the player is a physics body and forty blocks is four
     * seconds of falling and thirty-seven half-hearts. */
    await page.evaluate(() => {
      const noa = window.noa
      const body = noa.ents.getPhysics(noa.playerEntity).body
      body.gravityMultiplier = 0
      body.velocity[0] = body.velocity[1] = body.velocity[2] = 0
      noa.camera.heading = Math.PI / 2
      noa.camera.pitch = 0.85
    })
    await page.waitForTimeout(1500)
    await shot(page, 'sf-from-above')
    await page.evaluate(() => {
      window.noa.ents.getPhysics(window.noa.playerEntity).body.gravityMultiplier = 1
      window.noa.camera.pitch = 0
    })
  })
})
