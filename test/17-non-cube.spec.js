import { test, expect } from './fixtures.js'
import {
  HEADING, look, teleport, position, settleOnGround, waitTicks, snapshotRegion,
} from './helpers/world.js'

/*
 * Slabs and stairs: the ids, the half a click picks, and the collision.
 *
 * The rule this file exists to protect is the one the README states and no
 * unit test can: "you can walk onto a slab". That means walking a real player
 * onto a real slab and reading back the Y they come to rest at, which is what
 * the collision half of this file does -- it builds a rig out of blocks, holds
 * W for a second and a half, and measures.
 *
 * This is scripts/verify-non-cube.mjs, moved into the harness. It was a
 * standalone script only because test/ belonged to another agent when non-cube
 * blocks landed, and being outside the harness meant nothing here ran under
 * `npm test`: a change that broke stair collision went green.
 *
 * Non-cube blocks are noa objectMeshes with hand-written AABBs, so the two
 * halves below are genuinely different claims. The ids can round-trip
 * perfectly while the collider is a full cube, and the collider can be right
 * while the mesh is invisible.
 *
 * Left behind in the move: the script's `--fps` carpet benchmark, which placed
 * 1089 non-cubes and PRINTED frame rates for a human to read. It asserted
 * nothing -- there was no threshold in it to fail -- and a minute of
 * software-GL benchmarking in a suite people run before every commit buys
 * nothing a profiler run does not. helpers/world.js's measureFps is there if
 * someone wants to turn it into a real comparison.
 */

/*
 * Scratch space, in fixed world coordinates rather than offsets from wherever
 * the player happens to be. The script derived these from the live player
 * position, which is the same numbers in practice -- resetWorld puts everyone
 * at spawn -- but written down they can be handed to the terrain undo fixture,
 * which is what keeps a 20x10 stone rig from being the next spec's problem.
 *
 * All of it sits inside the 80-block island and above the grass at y=64.
 */
// 300 cells, 20 a row. It was 14 rows for the 280 slab and stair variants and
// held exactly them, so the five torch ids overflowed it the day they landed
// -- which is the check below doing its job. One more row, not a bigger
// assertion.
const IDS_AT = { x: 8, y: 72, z: 0, wide: 20, deep: 15 }
const ORIENT_AT = { x: -10, y: 76, z: 0 }
/*
 * The slab/stair rig, built in mid-air well clear of the terrain.
 *
 * y was 70, which was open sky over the old 80x80 island. The imported world
 * is 250 blocks tall and its highest peak is at y=177, so 70 is now deep
 * underground -- the rig would have been built inside solid stone and every
 * "fall onto a slab" would have landed on rock first. 200 is 23 above the
 * highest block in the patch and still inside noa's vertical load range from
 * spawn, which is what lets the beforeAll build it at all.
 */
/*
 * IT MOVES WITH SPAWN, and it has now moved twice.
 *
 * The beforeAll can only build this rig at all because every chunk it touches
 * is inside noa's load range FROM WHERE THE PLAYER IS STANDING. setBlockID
 * into an unloaded chunk is dropped silently, and a silently half-built rig
 * is the failure this comment exists to stop happening again: when spawn went
 * to the south end of the road, the far (+x) end of the old rig fell out of
 * range and the first three tests passed while the staircase failed.
 *
 * Spawn is the origin again -- the timeline moved to claude-opus-5-1 and took
 * its road-end spawn with it -- so the rig comes back over the origin with
 * it. The coordinates are the ones it had before the road existed.
 *
 * y = 180 rather than 200 so it cannot collide with test/66-torch.spec.js's
 * room, which lives at y = 200 over the same spawn and shares a worker.
 */
const RIG = { x: 20, y: 180, z: 20 }

/** Vanilla's stone. Duplicated from blocks.js on purpose, like helpers/world's ID. */
const STONE = 3

test.describe('non-cube blocks', () => {
  test('every one of them places, reads back and gets instanced',
    async ({ page, terrain, errors }) => {
      await terrain.keep(
        [IDS_AT.x, IDS_AT.y, IDS_AT.z],
        [IDS_AT.x + IDS_AT.wide - 1, IDS_AT.y, IDS_AT.z + IDS_AT.deep - 1])
      const since = errors.since()

      const placement = await page.evaluate(async ({ x, y, z, wide }) => {
        const noa = window.noa
        const { BLOCK_TYPES } = await import('/src/blocks.js')
        const defs = BLOCK_TYPES.filter(d => d.shape)
        const bad = []
        defs.forEach((d, i) => {
          // setBlockID, not noa.setBlock: this asserts the id round-trips, not
          // the placement-orientation rule, which is tested separately below.
          const bx = x + (i % wide), bz = z + Math.floor(i / wide)
          noa.world.setBlockID(d.id, bx, y, bz)
          const got = noa.getBlock(bx, y, bz)
          if (got !== d.id) bad.push(`${d.key}: wrote ${d.id}, read ${got}`)
        })
        return { count: defs.length, bad }
      }, IDS_AT)

      expect(placement.bad, `${placement.bad.length} of ${placement.count} ids did not`
        + ` round-trip: ${placement.bad.slice(0, 5).join(' | ')}`).toEqual([])
      // Sanity on the fixture itself: 15 rows of 20 is the box kept above, and
      // a table that outgrows it would silently leave blocks behind.
      expect(placement.count,
        `${placement.count} non-cube blocks, more than the scratch box holds`)
        .toBeLessThanOrEqual(IDS_AT.wide * IDS_AT.deep)

      /*
       * Every shape is its own base mesh with thin instances hung off it, so
       * "did it mesh" is countable: one base mesh per shape actually placed.
       * A shape whose mesh failed to build reads back its id perfectly and
       * draws nothing, which is why this is a separate count and not a
       * screenshot.
       */
      const meshed = await page.evaluate(() => {
        let meshes = 0, instances = 0
        for (const m of window.noa.rendering.getScene().meshes) {
          if (m.metadata?.noa_object_base_mesh && m.thinInstanceCount > 0) {
            meshes++; instances += m.thinInstanceCount
          }
        }
        return { meshes, instances }
      })
      expect(meshed.meshes, `only ${meshed.meshes} base meshes for`
        + ` ${placement.count} shapes (${meshed.instances} instances)`)
        .toBeGreaterThanOrEqual(placement.count)

      // Babylon reports a shape it could not build as a console error rather
      // than by throwing, so placing every one of them is the moment to look.
      expect(errors.since(since), 'placing every non-cube block logged an error')
        .toEqual([])
    })

  test('the click decides which way a stair faces and which half a slab is',
    async ({ page, terrain }) => {
      await terrain.keep(
        [ORIENT_AT.x, ORIENT_AT.y, ORIENT_AT.z], [ORIENT_AT.x, ORIENT_AT.y, ORIENT_AT.z])

      /*
       * Driven through noa.setBlock with a hand-set targetedBlock rather than
       * by aiming and clicking, because the rule under test is a function of
       * the FACE and the exact height clicked on it -- six cases that would
       * otherwise need six builds to aim at. 06-mining covers the real
       * click path; this covers the orientation table.
       */
      const orient = await page.evaluate(async ({ x, y, z }) => {
        const noa = window.noa
        const { BLOCK_TYPES, BLOCK_BY_ID } = await import('/src/blocks.js')
        const id = k => BLOCK_TYPES.find(d => d.key === k).id
        const shape = () => BLOCK_BY_ID.get(noa.getBlock(x, y, z)).shape
        const out = {}

        // Clicked the top face of the block below: bottom half.
        noa._pickResult.position[1] = y
        noa.targetedBlock = { position: [x, y - 1, z], normal: [0, 1, 0], adjacent: [x, y, z] }
        /*
         * The quarter turns are +Z, +X, -Z, -X. Their names USED TO READ
         * south/east/north/west, from back when blockMeshes.js called +X east
         * and mirrored its geometry table to match. Both halves were flipped
         * together when the terrain stopped being a mirror image, so the boxes
         * a given heading places are byte for byte what they always were --
         * only the name on them changed, and now it is Minecraft's. See the
         * FACINGS note in src/blockMeshes.js.
         */
        for (const [dir, heading] of [['south', 0], ['west', Math.PI / 2],
          ['north', Math.PI], ['east', 3 * Math.PI / 2]]) {
          noa.camera.heading = heading
          noa.setBlock(id('oak_stairs'), x, y, z)
          out[dir] = shape()
        }
        noa.camera.heading = 0
        noa.setBlock(id('oak_slab'), x, y, z); out.slabFromTop = shape()

        // Clicked the bottom face of the block above: top half.
        noa.targetedBlock = { position: [x, y + 1, z], normal: [0, -1, 0], adjacent: [x, y, z] }
        noa.setBlock(id('oak_slab'), x, y, z); out.slabFromBelow = shape()
        noa.setBlock(id('oak_stairs'), x, y, z); out.stairsUpsideDown = shape()

        // Clicked high, then low, on a side face.
        noa.targetedBlock = { position: [x + 1, y, z], normal: [1, 0, 0], adjacent: [x, y, z] }
        noa._pickResult.position[1] = y + 0.8
        noa.setBlock(id('oak_slab'), x, y, z); out.slabSideHigh = shape()
        noa._pickResult.position[1] = y + 0.2
        noa.setBlock(id('oak_slab'), x, y, z); out.slabSideLow = shape()

        noa.setBlock(0, x, y, z)
        noa.targetedBlock = null
        return out
      }, ORIENT_AT)

      const all = JSON.stringify(orient)
      for (const dir of ['south', 'west', 'north', 'east']) {
        expect(orient[dir], `facing ${dir} placed ${orient[dir]} -- ${all}`)
          .toBe(`stairs_${dir}_bottom`)
      }
      expect(orient.slabFromTop, `clicking a top face gave ${all}`).toBe('slab_bottom')
      expect(orient.slabFromBelow, `clicking a bottom face gave ${all}`).toBe('slab_top')
      expect(orient.stairsUpsideDown, `clicking a bottom face gave ${all}`)
        .toBe('stairs_south_top')
      // A side face splits at half height, which is the case that has no
      // normal to read and has to come from the pick position.
      expect(orient.slabSideHigh, `clicking high on a side gave ${all}`).toBe('slab_top')
      expect(orient.slabSideLow, `clicking low on a side gave ${all}`).toBe('slab_bottom')
    })
})

/*
 * Collision, measured on a real build.
 *
 * The rig is put up once for the whole file rather than per test: it is ~2000
 * setBlockID calls and the chunk remeshes behind them, against five tests that
 * only read a resting Y off it. Nothing any of them does modifies it.
 */
test.describe('walking on slabs and stairs', () => {
  let restoreRig

  test.beforeAll(async ({ world }) => {
    const page = world.page
    restoreRig = await snapshotRegion(page,
      [RIG.x, RIG.y, RIG.z], [RIG.x + 19, RIG.y + 8, RIG.z + 9])

    await page.evaluate(async ({ x: bx, y: by, z: bz, stone }) => {
      const noa = window.noa
      const { BLOCK_TYPES } = await import('/src/blocks.js')
      const id = k => BLOCK_TYPES.find(d => d.key === k).id

      for (let x = 0; x < 20; x++) for (let z = 0; z < 10; z++) {
        noa.world.setBlockID(stone, bx + x, by, bz + z)
      }
      // a slab floor wide enough that a second of walking stays on it
      for (let x = 2; x < 8; x++) for (let z = 2; z < 6; z++) {
        noa.world.setBlockID(id('stone_brick_slab'), bx + x, by + 1, bz + z)
      }
      /*
       * A five-step staircase climbing +X, supported like a real build.
       *
       * `oak_stairs_west_bottom`, not `_east_`, and the geometry is identical
       * to what this line built before: west is +X in this world, so the tall
       * half still lands on the +X side of each block and the climb still
       * runs the same way. Only the variant's NAME changed -- see the FACINGS
       * note in src/blockMeshes.js for why it had to.
       */
      for (let n = 0; n < 5; n++) for (let z = 2; z < 6; z++) {
        noa.world.setBlockID(id('oak_stairs_west_bottom'), bx + 8 + n, by + 1 + n, bz + z)
        for (let f = 0; f < n; f++) noa.world.setBlockID(stone, bx + 8 + n, by + 1 + f, bz + z)
      }
      // a landing, so the climb test has somewhere to stop
      for (let x = 13; x < 18; x++) for (let z = 2; z < 6; z++) {
        noa.world.setBlockID(stone, bx + x, by + 5, bz + z)
      }
      noa.world.setBlockID(id('stone_brick_slab_top'), bx + 15, by + 7, bz + 3)
      // a plain cube wall, to prove full blocks are still not steppable. Its
      // own z lane, clear of the slab floor, so walking into it is the only
      // thing the last check can be measuring.
      for (let z = 7; z < 10; z++) noa.world.setBlockID(stone, bx + 4, by + 1, bz + z)
    }, { ...RIG, stone: STONE })
  })

  test.afterAll(async () => { await restoreRig() })

  /**
   * Drop in and let the body come to rest, polling the engine's own atRestY
   * rather than sleeping. The script slept 1.5 s here, which is both slower
   * than it needs to be on a good machine and not always enough on a bad one.
   */
  async function standAt(page, x, y, z) {
    await teleport(page, x, y, z)
    await settleOnGround(page)
    // Two ticks past first contact: the body can register at-rest on the tick
    // it touches down and still be a few millimetres above its final Y.
    await waitTicks(page, 2)
    return position(page)
  }

  /** Hold W east for a real duration -- this is a walk, not a teleport. */
  async function walkEast(page, ms) {
    await look(page, { heading: HEADING.westPlusX })
    await page.keyboard.down('KeyW')
    await page.waitForTimeout(ms)
    await page.keyboard.up('KeyW')
    // Let the deceleration finish before anything reads the position.
    await page.waitForTimeout(500)
    await settleOnGround(page)
    return position(page)
  }

  /*
   * The tolerance on every resting Y below is 0.02 blocks, which is the
   * suite's convention for a physics measurement and NOT a knob: half a slab
   * is 0.5, and the failures this catches -- a slab whose collider is a full
   * cube, or none at all -- are off by that much or more.
   */
  const TOLERANCE = 0.02

  test('falls onto a bottom slab and rests at half height', async ({ page }) => {
    const p = await standAt(page, RIG.x + 3.5, RIG.y + 6, RIG.z + 3.5)
    const want = RIG.y + 1.5
    expect(Math.abs(p[1] - want), `came to rest at y=${p[1].toFixed(4)}, want ${want}`)
      .toBeLessThan(TOLERANCE)
  })

  test('walks up onto a slab without jumping', async ({ page }) => {
    await standAt(page, RIG.x + 0.5, RIG.y + 1, RIG.z + 3.5)
    const p = await walkEast(page, 1200)
    const want = RIG.y + 1.5
    expect(Math.abs(p[1] - want), `walked to x=${p[0].toFixed(2)} y=${p[1].toFixed(4)},`
      + ` want y=${want}`).toBeLessThan(TOLERANCE)
    // On the slab floor, not past it and not stopped dead at its edge.
    expect(p[0], `stopped at x=${p[0].toFixed(2)}`).toBeGreaterThan(RIG.x + 2)
    expect(p[0], `overshot to x=${p[0].toFixed(2)}`).toBeLessThan(RIG.x + 8)
  })

  test('climbs a five-step staircase without jumping', async ({ page }) => {
    const from = await standAt(page, RIG.x + 7.5, RIG.y + 1, RIG.z + 3.5)
    const p = await walkEast(page, 2600)
    const top = RIG.y + 6
    const trace = `(${from[0].toFixed(1)}, ${from[1].toFixed(1)})`
      + ` -> (${p[0].toFixed(1)}, ${p[1].toFixed(3)}), top is ${top}`
    // 5.98 rather than 6.00 because this is the top of a climb, not a settle:
    // the player is still walking when it is read.
    expect(p[1], `did not reach the landing: ${trace}`).toBeGreaterThanOrEqual(top - 0.02)
    expect(p[0], `stalled on the stairs: ${trace}`).toBeGreaterThan(RIG.x + 12)
  })

  test('rests on the upper half of a top slab', async ({ page }) => {
    const p = await standAt(page, RIG.x + 15.5, RIG.y + 11, RIG.z + 3.5)
    const want = RIG.y + 8
    expect(Math.abs(p[1] - want), `came to rest at y=${p[1].toFixed(4)}, want ${want}`)
      .toBeLessThan(TOLERANCE)
  })

  /* The parkour invariant: a full cube is a wall, not a step. Every autostep
   * height that makes slabs work is one that could quietly make cubes
   * climbable too, and that would change every jump on the island. */
  test('a full cube is still not steppable', async ({ page }) => {
    await standAt(page, RIG.x + 1.5, RIG.y + 1, RIG.z + 8.5)
    const p = await walkEast(page, 1500)
    const want = RIG.y + 1
    expect(Math.abs(p[1] - want), `climbed to y=${p[1].toFixed(3)}, should still be ${want}`)
      .toBeLessThan(TOLERANCE)
    expect(p[0], `walked through the wall to x=${p[0].toFixed(3)}`)
      .toBeLessThan(RIG.x + 4)
  })
})
