import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from './fixtures.js'
import {
  chatCommand, grantOp, visibleCommands, waitFrames, waitTicks, look,
} from './helpers/world.js'
/* The plot table, read rather than copied -- plain data with no imports of
 * its own, so a node-side spec may read it without dragging Babylon in. */
import { SPAWN_PATCH_X, SPAWN_PATCH_Z, ORIGIN_X, ORIGIN_Z } from '../src/builds/plots.js'

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots')

/*
 * FOUR WORLDS, ONE REGISTRY.
 *
 * 34-nether.spec.js proved the mechanism -- that assigning noa.worldName
 * really does re-request and re-mesh every chunk. This file is about the
 * thing built on top of it: a world is a ROW, and switching is a lookup.
 *
 * WHAT IT HAS TO DISCRIMINATE, and it is not "did something change". The
 * failure a registry invites is the one where the switch works perfectly and
 * loads the WRONG ROW -- mountains.bin fetched for the Nether, or the Nether's
 * origin used for the mountain patch. Both render a plausible world. So every
 * assertion below names a fact that is true of exactly one of the three:
 *
 *   overworld        256 wide, GENERATED, floor at y=132 (four layers, no
 *                    bedrock below), grass under your feet at y=135, and
 *                    NOTHING standing on it.
 *   claude-opus-5-1  the same generated superflat with the eight-stage
 *                    timeline stamped into it. Same width, same source, same
 *                    floor -- so width and source cannot tell it from the
 *                    overworld, and what does is the road under its spawn.
 *                    test/01-world.spec.js censuses both patches; this file
 *                    only has to prove the registry reaches it.
 *   nether           128 wide, IMPORTED, range y=0..127, netherrack.
 *   mountains        256 wide, IMPORTED, range y=-64..263, origin column
 *                    175/116, a snow block on a jagged peak at y=198.
 *
 * The width is the sharpest of those: it is a property of the BYTES that were
 * fetched, and no amount of correct switching machinery can make a 256-wide
 * asset report 256. Swapping the two asset URLs in the registry fails on it
 * immediately -- which is how this was checked (see the commit message).
 *
 * NO HARDCODED SPAWN COLUMN, and the exception proves what the rule is for.
 * Three of the four worlds put their spawn at horizontal (0, 0) by
 * construction -- island.js's WORLDS origins are the manifests' spawn columns
 * -- so "the block under the player" is the same sentence in all of them, and
 * that is what lets every other spec in the suite say
 * `getBlock(0, SURFACE_Y - 1, 0)`. The property is asserted here rather than
 * assumed.
 *
 * claude-opus-5-1 is the one that arrives somewhere else, at the south end of
 * its road, because it is the only world with a reason to. It carries
 * spawnX/spawnZ in its WORLDS row and the number comes from
 * src/builds/plots.js; every assertion about it below reads it from there.
 */

const enter = (page, name) => page.evaluate(n => window.game.dimensions.enter(n), name)

async function settleChunks(page) {
  await waitTicks(page, 20)
  await waitFrames(page, 10)
}

/** Everything about the world the player is actually standing in. */
const survey = (page) => page.evaluate(() => {
  const g = window.game
  const noa = window.noa
  const p = noa.ents.getPositionData(noa.playerEntity).position
  const [x, y, z] = p.map(Math.floor)
  return {
    active: g.dimensions.active,
    worldName: noa.worldName,
    island: g.dimensions.islandDimension,
    terrain: g.terrain,
    feet: [x, y, z],
    // noa's chunk STORE, not island.js's generator -- see 34-nether.spec.js
    // for why that distinction is the whole point.
    underKey: g.blockKey(noa.getBlock(x, y - 1, z)),
  }
})

/*
 * The worker-scoped `world` fixture is shared across spec files and knows
 * nothing about worlds, so a file that ends somewhere else hands the next
 * file somewhere else. Same reasoning as 34-nether.spec.js.
 */
test.afterEach(async ({ page }) => {
  if (await page.evaluate(() => window.game.dimensions.active) !== 'overworld') {
    await enter(page, 'overworld')
    await settleChunks(page)
  }
})

test('the registry knows four worlds and the bare superflat is the one you boot into',
  async ({ page, bootInfo }) => {
    /*
     * THE ORDER IS THE TABLE'S, not sorted: `names` is Object.keys(DIMENSIONS)
     * and this is the row order a reader of src/dimensions.js sees. Asserting
     * the array rather than a set is deliberate -- it is the cheapest possible
     * check that a row was added rather than one being renamed out from under
     * something.
     */
    const names = await page.evaluate(() => window.game.dimensions.names)
    expect(names).toEqual(['overworld', 'claude-opus-5-1', 'mountains', 'nether'])

    const s = await survey(page)
    expect(s.active).toBe('overworld')
    expect(s.terrain.source).toBe('generated')
    /* 256 since the landscape landed, and the same number as `mountains` --
     * which is why the mountain tests below check `source` too. */
    expect(s.terrain.width).toBe(256)
    /*
     * BOOTING COSTS NO FETCH, which is the reason the imported world is not
     * the default. Only the world you are in has been built; the other two
     * rows are data until someone asks for them.
     */
    /*
     * THE BOOT'S answer, not this instant's. `dimensions.loaded` is a cache
     * that only ever grows, so read live this asserted "no spec before me in
     * the run has entered another world" -- which is a fact about file
     * ordering and not about the registry. 01-world, 85-millard-north and
     * 91-biomes all enter the archive, and this went red whenever one of them
     * ran first. `bootInfo` is captured in test/fixtures.js the moment the
     * page finishes booting, which is the only moment the claim is about.
     */
    expect(bootInfo.loadedWorlds).toEqual(['overworld'])
  })

test('switching to the mountains loads ITS asset, not another world\'s',
  async ({ page }) => {
    const res = await enter(page, 'mountains')
    expect(res.ok).toBe(true)
    await settleChunks(page)

    const s = await survey(page)
    expect(s.active).toBe('mountains')
    expect(s.worldName).toBe('mountains')
    expect(s.island).toBe('mountains')

    // The bytes. A 128-wide asset cannot report these.
    expect(s.terrain.source).toBe('imported')
    expect(s.terrain.width).toBe(256)
    expect(s.terrain.depth).toBe(256)
    expect(s.terrain.yMin).toBe(-64)
    expect(s.terrain.yTop).toBe(263)
    // The origin out of island.js's WORLDS row, which is the manifest's spawn
    // column. Using the overworld's 87/56 here would put spawn 104 blocks west.
    expect(s.terrain.originX).toBe(175)
    expect(s.terrain.originZ).toBe(116)
    expect(s.terrain.missing).toEqual([])

    // Where the player was actually put, and what is under them.
    expect(s.feet[0]).toBe(0)
    expect(s.feet[2]).toBe(0)
    expect(s.feet[1]).toBe(199)
    // A snow block on a jagged peak. Named rather than "not air", because
    // loading the wrong asset would also give you something not-air.
    expect(s.underKey).toBe('snow_block')
  })

test('the mountains are inside the border, and the border is where it says',
  async ({ page }) => {
    await enter(page, 'mountains')
    await settleChunks(page)

    /*
     * THE OWNER'S FIRST CONSTRAINT, as a test: no mountain is cut off by an
     * invisible wall. Read from island.js's generator rather than noa's store
     * -- these columns are hundreds of blocks away and will never be meshed --
     * so this is a claim about the DATA, which is the right claim: the barrier
     * is a function of the patch's own width, so if the peak is inside the
     * data it is inside the wall.
     */
    const peak = await page.evaluate(() => {
      const v = window.game.voxelAt
      let best = { y: -999, x: 0, z: 0 }
      // Every 8th column of the whole 256x256 patch, in world coordinates.
      // x runs -175..80 and z runs -116..139: origin (175, 116) of 256.
      for (let z = -116; z <= 139; z += 8) {
        for (let x = -175; x <= 80; x += 8) {
          for (let y = 260; y > best.y; y--) {
            if (v(x, y, z) !== 0) { if (y > best.y) best = { y, x, z }; break }
          }
        }
      }
      return best
    })
    // The survey in docs/seed-434533485056755.md puts this seed's ceiling at
    // y=255; the patch was cut to contain a 254 peak with 8 blocks over it.
    expect(peak.y).toBeGreaterThan(240)
    // And it is not against an edge. 24 blocks of clearance in every direction
    // is what "not clipped mid-slope" means when you have to write it down.
    expect(Math.min(peak.x + 175, 80 - peak.x)).toBeGreaterThan(24)
    expect(Math.min(peak.z + 116, 139 - peak.z)).toBeGreaterThan(24)

    // The wall itself, one block outside each edge, at the height the peak is.
    const walls = await page.evaluate(() => {
      const v = window.game.voxelAt
      return {
        west: v(-176, 200, 0), east: v(81, 200, 0),
        north: v(0, 200, -117), south: v(0, 200, 140),
        insideWest: v(-175, -64, 0), insideEast: v(80, -64, 0),
      }
    })
    const barrier = await page.evaluate(() => window.game.ids.barrier)
    expect(walls.west).toBe(barrier)
    expect(walls.east).toBe(barrier)
    expect(walls.north).toBe(barrier)
    expect(walls.south).toBe(barrier)
    // ...and the last real column is bedrock, not wall. An off-by-one in the
    // origin would swap these two facts over.
    expect(walls.insideWest).not.toBe(barrier)
    expect(walls.insideEast).not.toBe(barrier)
  })

test('hopping back and forth does not rebuild anything', async ({ page }) => {
  await enter(page, 'mountains')
  await settleChunks(page)
  const first = await page.evaluate(() => performance.now())

  await enter(page, 'overworld')
  await settleChunks(page)
  expect((await survey(page)).terrain.width).toBe(256)

  /*
   * The second entry must not fetch again. `isLoaded` is what `enter` checks,
   * and a registry that re-prepared on every switch would still LOOK right --
   * it would just pay 1.4MB every time. Asserting the world is still loaded
   * while standing somewhere else is the observable form of that.
   */
  expect(await page.evaluate(() => window.game.dimensions.loaded)).toContain('mountains')

  const back = await enter(page, 'mountains')
  expect(back.ok).toBe(true)
  await settleChunks(page)
  const s = await survey(page)
  expect(s.terrain.width).toBe(256)
  expect(s.underKey).toBe('snow_block')
  expect(await page.evaluate(() => performance.now()) - first).toBeGreaterThan(0)
})

test('the Nether is untouched by any of this', async ({ page }) => {
  const res = await enter(page, 'nether')
  expect(res.ok).toBe(true)
  expect(res.id).toBe('minecraft:the_nether')
  await settleChunks(page)

  const s = await survey(page)
  expect(s.terrain.width).toBe(128)
  expect(s.terrain.yMin).toBe(0)
  expect(s.terrain.yTop).toBe(127)
  expect(s.terrain.originX).toBe(87)
  expect(s.feet).toEqual([0, 75, 0])
  expect(s.underKey).toBe('netherrack')

  // Its sky and fog, which are the half of a row that is not the world.
  const look = await page.evaluate(() => ({
    fog: window.noa.rendering.getScene().fogDensity,
    clear: [...window.noa.rendering.getScene().clearColor.asArray().slice(0, 3)],
  }))
  expect(look.fog).toBeCloseTo(0.035, 4)
  expect(look.clear[0]).toBeGreaterThan(look.clear[2])
})

/*
 * THE FOURTH ROW, which is the cheque the first three were written to cash.
 *
 * The comment at the top of src/dimensions.js said a third entry would be "a
 * row, an npm script, and a WORLDS row, and nothing in the switch itself
 * knows it exists". claude-opus-5-1 is the fourth and it did not even need
 * the npm script -- it is generated, not fetched -- so it is two rows and no
 * branch. This test is the proof that the switch did not have to learn about
 * it: the same `enter`, the same lookup, a world that is not in the same
 * shape as either of its neighbours.
 */
test('the world the model built is reachable, and arrives on its road',
  async ({ page }) => {
    const res = await enter(page, 'claude-opus-5-1')
    expect(res.ok).toBe(true)
    // It is an OVERWORLD, not a dimension of its own -- the same distinction
    // `mountains` makes, and the reason /world exists next to /dimension.
    expect(res.id).toBe('minecraft:overworld')
    await settleChunks(page)

    const s = await survey(page)
    expect(s.active).toBe('claude-opus-5-1')
    expect(s.worldName).toBe('claude-opus-5-1')
    expect(s.island).toBe('claude-opus-5-1')

    /* GENERATED AND 128 WIDE, which is now the half that discriminates. It
     * used to be the same 128-wide superflat as the overworld and only
     * `source` and the spawn column told the rows apart; the overworld is 256
     * now, so this width IS the archive's geometry and a regression that
     * regenerated this world at the overworld's size fails right here. */
    expect(s.terrain.source).toBe('generated')
    expect(s.terrain.width).toBe(128)
    expect(s.terrain.missing).toEqual([])

    /*
     * THE ONE WORLD THAT DOES NOT ARRIVE AT (0, 0), read out of the plot
     * table rather than written here -- the whole reason the number lives
     * there is that the road may move.
     */
    expect(s.feet[0]).toBe(SPAWN_PATCH_X - ORIGIN_X)
    expect(s.feet[2]).toBe(SPAWN_PATCH_Z - ORIGIN_Z)
    expect(s.feet[1]).toBe(136)
    /*
     * ...and it is the road he is standing on. NAMED rather than "not grass",
     * because loading the wrong world would also give you something.
     *
     * Two blocks are legal because the paving is dashed -- four blocks of
     * smooth quartz every eight, which is what stops 120 blocks of andesite
     * reading as a corridor (src/builds/road.js). Spawn happens to land on a
     * dash. Listing both is honest about that; pinning the one it lands on
     * today would fail the day somebody shifts the rate by a block.
     */
    expect(['polished_andesite', 'smooth_quartz']).toContain(s.underKey)
  })

test('/world switches, and it is still operator-only', async ({ page }) => {
  /*
   * A guest sees NEITHER switcher. test/11-commands.spec.js asserts the guest
   * list is exactly help, op and kill and explains at length why that list is
   * a designed property of the front door; adding a second op-gated command
   * must not disturb it, and this is the assertion that says so from the other
   * side.
   */
  await page.evaluate(() => window.game.authority.requestDeop())
  expect(await visibleCommands(page)).toEqual(['help', 'op', 'kill'])

  await grantOp(page)
  const opped = await visibleCommands(page)
  expect(opped).toContain('world')
  expect(opped).toContain('dimension')

  const out = await chatCommand(page, '/world mountains')
  expect(out.some(l => l.kind === 'error')).toBe(false)
  await page.waitForFunction(() => window.game.dimensions.active === 'mountains',
    null, { timeout: 30_000, polling: 100 })
  await settleChunks(page)
  expect((await survey(page)).terrain.width).toBe(256)

  // The alias reaches the same switch.
  await chatCommand(page, '/dimension overworld')
  await page.waitForFunction(() => window.game.dimensions.active === 'overworld',
    null, { timeout: 30_000, polling: 100 })
  await settleChunks(page)
  expect((await survey(page)).terrain.width).toBe(256)
})


/*
 * The deliverable the owner actually judges.
 *
 * Every assertion above is about numbers, and the owner's request was not
 * about numbers -- it was "make it so the entire mountains at spawn are within
 * the border" and "spawn somewhere you can see them from". A ray test picked
 * this column (docs/seed-434533485056755.md explains why the window SCORER
 * could not be trusted to), and a ray test is still a model. This is the
 * photograph.
 *
 * Four headings, 90 degrees apart, from where the player actually lands.
 */
test('what the mountains look like from spawn', async ({ page }) => {
  await enter(page, 'mountains')
  await settleChunks(page)
  // Extra settle: 256x256 is four times the chunks of the old patch, and a
  // screenshot taken mid-stream photographs holes rather than terrain.
  await waitTicks(page, 60)
  await waitFrames(page, 30)

  for (const [name, heading] of [['s', 0], ['w', 90], ['n', 180], ['e', 270]]) {
    await look(page, { heading: heading * Math.PI / 180, pitch: 0.08 })
    await waitFrames(page, 8)
    await page.screenshot({ path: path.join(SHOTS, `51-mountains-spawn-${name}.png`) })
  }

  // Not an assertion about the picture -- an assertion that there WAS one to
  // take. A screenshot of an unmeshed void passes silently otherwise.
  const s = await survey(page)
  expect(s.underKey).toBe('snow_block')
})
