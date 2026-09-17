/*
 * The stamping system: the guard that makes eight parallel builds safe, and
 * the proof that all eight stages are actually in the world.
 *
 * ------------------------------------------------------------------------
 * HALF OF THIS SPEC RUNS IN NODE AND HALF IN THE BROWSER, on purpose.
 *
 * The bounds check is a property of src/builds/stamp.js and nothing else, so
 * it is exercised directly: build a patch in the test process, point a
 * stamper at a plot, and ask it to write somewhere it may not. No page, no
 * engine, and -- the part that matters -- it can assert on the THROWN ERROR,
 * which a browser-side probe cannot see at all.
 *
 * Whether the houses are really standing in the world is the opposite kind of
 * question, and it is asked of the running game.
 *
 * ASSERT THE SAMPLE IS NON-EMPTY BEFORE ASSERTING ANYTHING ABOUT IT. This
 * repo has shipped a probe that passed by measuring nothing. Every count
 * below is checked for being greater than zero before it is checked for
 * being anything in particular, and the plot census prints its own totals so
 * a future reader can see the numbers rather than trust the comparison.
 * ------------------------------------------------------------------------
 *
 * WHAT THIS FILE IS FOR, now that all eight plots are built. For a long time
 * it asserted stage 1 and nothing else, which meant a refactor could have
 * emptied seven plots and left the suite green. The four claims it makes
 * today are the four that a census can actually make:
 *
 *   1. EVERY allocation is non-empty, and roughly as full as it was when it
 *      was written (see MIN_BLOCKS).
 *   2. NOTHING is anywhere else. The eight plots plus the road account for
 *      every non-air block above the grass; the complement is exactly zero.
 *   3. The margin frame is empty walkable grass on all four sides, which is
 *      what docs/builds/README.md promises a visitor who walks the edge.
 *   4. The two things a census cannot see are asked of the running game: a
 *      doorway you can walk through, and a photograph.
 */
import { test, expect } from './fixtures.js'
import {
  SURFACE_Y, getBlock, ID, teleport, BUILT_WORLD, enterWorld, leaveWorld,
} from './helpers/world.js'
import { shot } from './helpers/shots.js'
import { stamper } from '../src/builds/stamp.js'
import { flatPatch, FLAT_PRESETS } from '../src/flatworld.js'
import { GROUND_Y, ORIGIN_X, ORIGIN_Z, PLOTS, ROAD, plot, width, depth } from '../src/builds/plots.js'

/** A bare superflat patch, the overworld's geometry, with the builds turned
 *  OFF -- which is what `builds: null` is for. Everything stamped into one of
 *  these was stamped by this test and by nothing else. */
const barePatch = () => flatPatch({
  preset: FLAT_PRESETS.classic, width: 128, depth: 128,
  surfaceY: GROUND_Y, ceilingY: GROUND_Y + 64, builds: null,
})

/** The same geometry with every registered build stamped into it. */
const builtPatch = () => flatPatch({
  preset: FLAT_PRESETS.classic, width: 128, depth: 128,
  surfaceY: GROUND_Y, ceilingY: GROUND_Y + 64,
})

/** Non-air blocks strictly above the ground, in a patch rectangle. The census
 *  every claim below is made out of. */
function census(w, x0, x1, z0, z1) {
  let n = 0
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const col = w.cols[z * w.width + x]
      for (let y = GROUND_Y; y <= w.yTop; y++) if (w.palette[col[y - w.yMin]] !== 'air') n++
    }
  }
  return n
}

/** The census of one allocation row, plot or road. */
const censusOf = (w, p) => census(w, p.x0, p.x1, p.z0, p.z1)

/*
 * THE FLOOR UNDER EACH STAGE, and how these numbers were chosen.
 *
 * Every figure in the comment column was MEASURED, by censusing the built
 * patch and printing the totals (the same `census` above, run out of a
 * throwaway node script). The threshold beside it is about half of that,
 * rounded down to something a person would say out loud.
 *
 * Half, and not ninety per cent, on purpose. This is a tripwire for "the
 * plot is empty or gutted", not a lock on the block count: a build that
 * swaps a solid wall for a colonnade legitimately loses hundreds of blocks
 * and should not have to come and edit this table to do it. A threshold that
 * fails on ordinary editing gets raised by the next person in thirty seconds
 * without being read, and then it is protecting nothing.
 *
 * Harvard's agent asked for `> 1500` here. Measured, Harvard is 7184: at
 * 1500 you could delete Widener, Mass Hall, the church AND the yard wall and
 * this spec would still pass, so it is 3500 instead.
 *
 * If one of these fails, look at the number in the message before you touch
 * the number in this table. The message prints the real census.
 */
const MIN_BLOCKS = {
  omaha: 1500,       // measured 3768 -- the original threshold, and left alone
  harvard: 3500,     // measured 7184
  perplexity: 1900,  // measured 3854
  arize: 1800,       // measured 3795
  bilibili: 1900,    // measured 3939
  nologo: 3500,      // measured 7105
  patronus: 1300,    // measured 2723
  // stage 8 is deliberately absent. See the note in the census test.
  road: 250,         // measured 554
}

test.describe('the stamper refuses to leave its plot', () => {
  test('a write past the plot edge throws, and names both coordinates', () => {
    const w = barePatch()
    const s = stamper(w, 'omaha')
    const p = plot('omaha')

    // The last legal column, so the boundary is asserted from both sides
    // rather than merely "far outside fails".
    expect(() => s.set(width(p) - 1, 0, depth(p) - 1, 'stone')).not.toThrow()
    expect(s.placed).toBe(1)

    for (const [x, y, z] of [[width(p), 0, 0], [-1, 0, 0], [0, 0, depth(p)], [0, 0, -1]]) {
      expect(() => s.set(x, y, z, 'stone'), `set(${x}, ${y}, ${z}) should be refused`)
        .toThrow(/out of plot/)
    }

    // A box that STARTS inside and runs out is the realistic version of the
    // mistake -- an off-by-one on a wall length -- and it must fail too.
    expect(() => s.box([0, 0, 0], [width(p), 2, 0], 'stone')).toThrow(/out of plot/)

    // Nothing partial got through where it mattered: the refusal happens at
    // the write, so a box that runs out has already written its legal half.
    // What must be true is that nothing landed OUTSIDE.
    const p2 = plot('harvard')
    expect(census(w, p2.x0, p2.x1, p2.z0, p2.z1), 'the neighbour is untouched').toBe(0)
  })

  test('the error says which plot, and where it is', () => {
    const s = stamper(barePatch(), 'omaha')
    let message = ''
    try { s.set(99, 0, 0, 'stone') } catch (e) { message = e.message }
    expect(message).toContain('[omaha]')
    expect(message).toContain('src/builds/plots.js')
  })

  test('an unknown block key throws rather than placing air', () => {
    const s = stamper(barePatch(), 'omaha')
    // `oak_planks` is the real trap: it is what this block is called in
    // Minecraft and in every other codebase, and in src/blocks.js the oak one
    // is `planks`. Silently placing air here is the worst outcome available.
    expect(() => s.set(0, 0, 0, 'oak_planks')).toThrow(/no such block/)
    expect(() => s.set(0, 0, 0, 'planks')).not.toThrow()
    expect(() => s.pattern({
      at: [0, 0, 0], plane: 'xy', legend: { '#': 'stone' }, rows: ['#?#'],
    })).toThrow(/not in the legend/)
  })

  test('writing does not move the ground under the rest of the world', () => {
    /*
     * THE SHARED-COLUMN TRAP. src/flatworld.js hands all 16384 columns the
     * same Uint16Array; a stamper that wrote into it without cloning would
     * place one block and have it appear in every column of the patch. This
     * is that bug's tripwire, and it is the reason `touched` exists.
     */
    const w = barePatch()
    stamper(w, 'omaha').set(0, 10, 0, 'glowstone')
    expect(census(w, 0, 127, 0, 127), 'exactly one block above ground').toBe(1)
  })
})

test.describe('all eight stages are in the world', () => {
  test('the plot table and the world agree about the ground', () => {
    // GROUND_Y is a deliberate copy of island.js's SURFACE_Y -- see the note
    // in plots.js about why plots.js may not import it. A copy that nothing
    // checks is a copy that goes stale.
    expect(GROUND_Y).toBe(SURFACE_Y)
  })

  test('every plot is built, and the road is paved', () => {
    const w = builtPatch()

    /*
     * ONE LOOP, EIGHT STAGES, and the numbers go in the log whether it
     * passes or not. The failure this is really guarding is a refactor of
     * src/builds/index.js that drops a row from the registry: before this
     * loop existed, seven of the eight plots could have gone silently empty
     * and the only red in the suite would have been a screenshot nobody
     * diffs. So the loop is over PLOTS itself, which means a stage removed
     * from the table cannot take its assertion with it -- MIN_BLOCKS is
     * checked for completeness at the bottom.
     */
    const counts = {}
    for (const p of PLOTS) {
      const n = censusOf(w, p)
      counts[p.id] = n

      // Non-empty FIRST, and loudly, before any claim about what is in
      // there. An empty plot and a thin plot are different bugs and they
      // deserve different messages.
      expect(n, `stage ${p.n} (${p.id}) placed nothing at all`).toBeGreaterThan(0)

      /*
       * STAGE 8 IS MEASURED SOMEWHERE ELSE, on purpose and not by accident.
       * test/71-parkour.spec.js owns San Francisco: its census (> 3771), its
       * "nothing escaped the plot" margin check and -- the one that matters
       * -- the water-leak tripwire that would otherwise flood the road and
       * seven other stages. See `test.describe('stage 8 is in the world')`
       * in that file. Duplicating a weaker version of it here would mean two
       * numbers to update and one of them going stale.
       */
      if (p.id === 'parkour') continue

      const floor = MIN_BLOCKS[p.id]
      expect(floor, `no MIN_BLOCKS row for stage ${p.n} (${p.id})`).toBeGreaterThan(0)
      expect(n, `stage ${p.n} (${p.id}) census: ${n} blocks above ground, floor ${floor}`)
        .toBeGreaterThan(floor)
    }

    const road = censusOf(w, ROAD)
    counts.road = road
    expect(road, 'the road placed nothing at all').toBeGreaterThan(0)
    expect(road, `road census: ${road} blocks above ground, floor ${MIN_BLOCKS.road}`)
      .toBeGreaterThan(MIN_BLOCKS.road)

    // Printed, not just asserted, so a reader can see the shape of the world
    // rather than trust nine comparisons. A stage that has halved since the
    // table was written shows up here long before it trips a threshold.
    console.log('the census: ' + Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' '))

    // And the table has no rows for stages that no longer exist, which is the
    // other way this guard rots.
    const ids = new Set([...PLOTS.map(p => p.id), 'road'])
    for (const id of Object.keys(MIN_BLOCKS)) {
      expect(ids.has(id), `MIN_BLOCKS has a row for ${id}, which is not an allocation`).toBe(true)
    }

    /*
     * THE ROAD, column by column rather than by total. Every column of the
     * paving has something at ground level, over its whole length. A road
     * with a hole in it is the one defect a visitor is guaranteed to walk
     * into, and it is invisible to a block count.
     */
    for (let z = ROAD.z0; z <= ROAD.z1; z++) {
      for (let x = ROAD.paving.x0; x <= ROAD.paving.x1; x++) {
        const key = w.palette[w.cols[z * 128 + x][GROUND_Y - 1 - w.yMin]]
        expect(key, `paving at patch (${x}, ${z})`).not.toBe('grass')
        expect(key).not.toBe('air')
      }
    }
  })

  test('no build wrote outside its allocation', () => {
    /*
     * THE COMPLEMENT IS ZERO, which is a stronger claim than any list of
     * margins and is the one that cannot go stale when the plot table moves.
     *
     * The stamper already throws on an out-of-plot write, so in principle
     * this cannot fail. In practice the ways round it are real and have all
     * been tried in this repo: a build that touches `world.cols` directly, a
     * generator step that runs after stampBuilds, a plot row edited to
     * overlap its neighbour, or a future feature that writes decoration
     * "between" the plots. Any of those lands here.
     *
     * Asserted two ways, because they fail differently. The sum-versus-whole
     * comparison catches OVERLAPPING allocations (a block inside two plots is
     * counted twice and the sum exceeds the whole); the complement walk
     * catches blocks that belong to nobody, and names the columns.
     */
    const w = builtPatch()
    const allocations = [ROAD, ...PLOTS]

    const whole = census(w, 0, 127, 0, 127)
    const sum = allocations.reduce((n, p) => n + censusOf(w, p), 0)
    expect(whole, 'the patch is empty, so this test is measuring nothing').toBeGreaterThan(0)
    expect(sum, `allocations sum to ${sum}, whole patch holds ${whole}`).toBe(whole)

    const inside = (x, z) =>
      allocations.some(p => x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1)

    const stray = []
    for (let z = 0; z < 128; z++) {
      for (let x = 0; x < 128; x++) {
        if (inside(x, z)) continue
        const n = census(w, x, x, z, z)
        if (n) stray.push(`(${x}, ${z}) x${n}`)
      }
    }
    // The message carries the coordinates, because "1 !== 0" on a 128x128
    // patch is a morning of bisecting builds.
    expect(stray.slice(0, 8).join('; '),
      `${stray.length} patch columns outside every allocation hold blocks`).toBe('')
  })

  test('the margin frame is still grass on all four sides', () => {
    /*
     * THIS ASSERTION STOPPED BEING LOAD-BEARING FOR THE REST OF THE SUITE,
     * and saying so is more useful than leaving the old claim standing.
     *
     * For one day the builds were in the DEFAULT world, so DROP_X / DROP_Z --
     * the column every "teleport up and fall" spec falls down -- had to be
     * parked in a margin this test guarantees is empty, and a build that
     * spilled south would have failed every fall, jump and fluid spec in the
     * suite for a reason none of them could explain. The builds moved to
     * claude-opus-5-1 and the default world is bare superflat again, so the
     * drop column is now in a world where every column is clear and no build
     * can reach it. The coupling is gone; the assertion below no longer names
     * it.
     *
     * The margin is still asserted, for the reason it was worth asserting
     * before the coupling existed: it is the complement check for THIS world.
     * A build that spills into the margin is a build that has escaped its
     * plot, and docs/builds/README.md promises the frame is walkable grass.
     *
     * THE BANDS ARE THE COMPLEMENT OF THE ALLOCATIONS, not the ranges quoted
     * in docs/builds/README.md, and the difference is the road. The road's
     * plot runs z = 4..124, so at x = 60..67 the margin is only z = 0..3 and
     * z = 125..127; everywhere else it is z = 0..5 and z = 118..127. Quoting
     * the README's "z 0-3, 118-127" for all x would assert that the road's
     * own north and south ends are empty, which is not the claim and would
     * break the day somebody puts a bollard at the end of the road.
     */
    const w = builtPatch()
    const LEFT = [0, 59], RIGHT = [68, 127], VERGE = [ROAD.x0, ROAD.x1]

    const bands = [
      ['the west margin, x 0..3', 0, 3, 0, 127],
      ['the east margin, x 124..127', 124, 127, 0, 127],
      ['the north margin, west of the road', ...LEFT, 0, ROAD.z0 + 1],
      ['the north margin, east of the road', ...RIGHT, 0, ROAD.z0 + 1],
      ['the north margin, off the end of the road', ...VERGE, 0, ROAD.z0 - 1],
      ['the south margin, west of the road', ...LEFT, 118, 127],
      ['the south margin, east of the road', ...RIGHT, 118, 127],
      ['the south margin, off the end of the road', ...VERGE, ROAD.z1 + 1, 127],
    ]
    for (const [what, x0, x1, z0, z1] of bands) {
      const n = census(w, x0, x1, z0, z1)
      expect(n, `${what} (patch x ${x0}..${x1}, z ${z0}..${z1}) holds ${n} blocks`).toBe(0)
    }

    /*
     * AND THE GUTTERS BETWEEN ALLOCATIONS, which is a shorter list than it
     * sounds: there are none. The eight plots tile x 4..59 and x 68..123
     * exactly, in four bands of z 6..33, 34..61, 62..89 and 90..117 with no
     * space between them, and the only thing standing between the two
     * columns of plots is the road's verge at x 60..67 -- which is an
     * allocation with an owner and carries the lamps, so it is emphatically
     * not empty. The claim "nothing lives between the allocations" is
     * therefore made by the complement test above and not by a band here.
     *
     * The margin is walkable ground and not merely empty air, which is the
     * half of "empty" a census of the blocks ABOVE the grass cannot see: a
     * build that dug a trench along its boundary would pass every band above.
     * One column per side, at the corners of the frame.
     */
    for (const [what, x, z] of [
      ['north-west', 1, 1], ['north-east', 126, 1],
      ['south-west', 1, 126], ['south-east', 126, 126],
    ]) {
      expect(w.palette[w.cols[z * 128 + x][GROUND_Y - 1 - w.yMin]],
        `the ${what} corner of the margin is not grass`).toBe('grass')
    }

    /*
     * Patch (1, 126) by name, because test/23-debug-screen.spec.js stands
     * there: it is the furthest a column in this patch gets from anywhere a
     * build may hang a lamp, which is what makes "the player is in zero block
     * light" a safe opening assertion for the F3 light tests. That spec runs
     * in the default world where nothing is stamped at all, so this is
     * belt-and-braces rather than a coupling -- but it is free, and it is the
     * column that would break first if a lamp crept west.
     */
    expect(census(w, 1, 1, 126, 126), 'the dark-sky column at patch (1, 126)').toBe(0)
  })
})

/*
 * ------------------------------------------------------------------------
 * EVERYTHING ABOVE RUNS IN NODE AGAINST A PATCH THIS FILE BUILT, so it was
 * unaffected by the builds changing worlds -- `builtPatch()` calls flatPatch
 * with the stamper on and has never cared which dimension row does the same.
 *
 * EVERYTHING BELOW ASKS THE RUNNING GAME, and the running game boots into a
 * bare superflat now. The eight stages live in claude-opus-5-1, so these
 * tests have to go there first, and hand the world back afterwards: one
 * booted page is shared by the whole worker and a spec that ends somewhere
 * else hands the next spec somewhere else.
 *
 * enterWorld WAITS for the chunks. A probe that reads noa.getBlock on the
 * line after a world switch reads the old world's cache -- see the note in
 * test/helpers/world.js.
 * ------------------------------------------------------------------------
 */
test.describe('the stages are standing in the running game', () => {
  test.beforeEach(async ({ page }) => { await enterWorld(page, BUILT_WORLD) })
  test.afterEach(async ({ page }) => { await leaveWorld(page) })

  test('Omaha: the house is standing, and you can walk into it', async ({ page }) => {
    /*
     * Asked of the running game rather than of the generator, because the
     * question is "did the stamped world survive getVoxelID, the palette
     * table and the mesher" -- three things a node-side census cannot see.
     *
     * The player is teleported to the front door first: noa answers 0 for a
     * chunk it has not loaded and 0 is also air, so an unteleported probe of
     * a building ninety blocks away would pass vacuously whether the house
     * was there or not.
     */
    const door = [49 - ORIGIN_X, SURFACE_Y, 17 - ORIGIN_Z]
    await teleport(page, door[0] + 6.5, SURFACE_Y + 1, door[2] + 0.5)
    await page.waitForTimeout(800)

    // Doorway: air where you walk in, and a wall either side of it.
    expect(await getBlock(page, door[0], SURFACE_Y, door[2])).toBe(ID.air)
    const jamb = await getBlock(page, door[0], SURFACE_Y, door[2] + 2)
    expect(jamb, 'the wall beside the front door').not.toBe(ID.air)

    // The cellar, two blocks under the house's floorboards, is really hollow.
    expect(await getBlock(page, 40 - ORIGIN_X, SURFACE_Y - 2, 17 - ORIGIN_Z)).toBe(ID.air)
  })

  test('Harvard: Widener\'s front door is a hole you can walk through', async ({ page }) => {
    /*
     * THE SECOND BROWSER PROBE, and the reason it exists is in
     * src/builds/02-harvard.js: Widener's doorway is CUT after the wall is
     * built (`w.clear([9, 4, 11], [9, 6, 12])` inside `widener`). A cut that
     * runs before the wall, or a wall rebuilt after the cut, gives you a
     * library with a brick face and no way in -- and the comment on that
     * clear says an earlier version of the doorway "survived every check
     * except a screenshot". This is that screenshot, as an assertion.
     *
     * WHERE THE DOOR IS, because the number that was handed over was mixed.
     * Widener is stamped at `s.at(21, 0, 2)`, so its local (9, 4..6, 11..12)
     * is HARVARD-local (30, 4..6, 13..14) and patch (98, 19..20) via the plot
     * table. The "(30, 19)" it was reported as is x in plot coordinates and z
     * in patch coordinates, which is exactly the mix-up plots.js opens with a
     * warning about: read literally as plot-local it is patch (98, 25), which
     * is solid brick nine columns down the wall and would have made this test
     * fail for the wrong reason.
     *
     * The door sits four blocks up because you reach it off the portico deck,
     * which is why the probe is at SURFACE_Y + 4, +5 and +6 rather than at
     * the ground.
     */
    const h = plot('harvard')
    const px = (x) => h.x0 + x - ORIGIN_X          // harvard-local x -> world x
    const pz = (z) => h.z0 + z - ORIGIN_Z          // harvard-local z -> world z

    /*
     * TELEPORT FIRST, and it is not politeness. noa answers 0 for a chunk it
     * has not loaded and 0 is also ID.air, so every `toBe(ID.air)` below
     * passes vacuously on an unloaded chunk -- which is what this whole plot
     * is, since the player spawns a hundred blocks south of it. Standing on
     * the portico deck at local (28, 13) puts the door two blocks away and
     * the chunk in memory.
     */
    await teleport(page, px(28) + 0.5, SURFACE_Y + 4, pz(13) + 0.5)
    await page.waitForTimeout(800)

    // The jambs first. If these are air the chunk is not loaded and the air
    // assertions below prove nothing, so this is the guard that stops this
    // test joining the ones that passed by measuring nothing.
    for (const z of [12, 15]) {
      expect(await getBlock(page, px(30), SURFACE_Y + 5, pz(z)),
        `the jamb beside Widener's door at harvard-local (30, 5, ${z})`).not.toBe(ID.air)
    }

    // And the doorway itself: two columns wide, three blocks of headroom.
    for (const z of [13, 14]) {
      for (const dy of [4, 5, 6]) {
        expect(await getBlock(page, px(30), SURFACE_Y + dy, pz(z)),
          `Widener's doorway at harvard-local (30, ${dy}, ${z}), patch (${h.x0 + 30}, ${h.z0 + z})`)
          .toBe(ID.air)
      }
    }

    // A lintel over it, so the hole is a door and not a missing wall.
    expect(await getBlock(page, px(30), SURFACE_Y + 7, pz(13)),
      'the lintel over Widener\'s door').not.toBe(ID.air)
  })

  test('what stage 1 looks like from the road', async ({ page }) => {
    // Visual by nature, and the one that catches the failure a census cannot:
    // a build that reads from above and not at eye level.
    await teleport(page, 63 - ORIGIN_X + 0.5, SURFACE_Y + 1, 20 - ORIGIN_Z + 0.5)
    await page.waitForTimeout(1200)
    await shot(page, 'omaha-from-road')
  })
})
