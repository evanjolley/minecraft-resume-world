/*
 * The stamping system: the guard that makes eight parallel builds safe, and
 * the proof that stage 1 is actually in the world.
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
 * Whether the house is really standing in the world is the opposite kind of
 * question, and it is asked of the running game.
 *
 * ASSERT THE SAMPLE IS NON-EMPTY BEFORE ASSERTING ANYTHING ABOUT IT. This
 * repo has shipped a probe that passed by measuring nothing. Every count
 * below is checked for being greater than zero before it is checked for
 * being anything in particular, and the plot census prints its own totals so
 * a future reader can see the numbers rather than trust the comparison.
 */
import { test, expect } from './fixtures.js'
import { SURFACE_Y, getBlock, ID, teleport } from './helpers/world.js'
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

test.describe('stage 1 is in the world', () => {
  test('the plot table and the world agree about the ground', () => {
    // GROUND_Y is a deliberate copy of island.js's SURFACE_Y -- see the note
    // in plots.js about why plots.js may not import it. A copy that nothing
    // checks is a copy that goes stale.
    expect(GROUND_Y).toBe(SURFACE_Y)
  })

  test('Omaha is not empty, the road is paved, and the margins are still grass', () => {
    const w = builtPatch()
    const omaha = plot('omaha')

    const inOmaha = census(w, omaha.x0, omaha.x1, omaha.z0, omaha.z1)
    // Non-empty FIRST, and loudly, before any claim about what is in there.
    expect(inOmaha, 'stage 1 placed nothing at all').toBeGreaterThan(0)
    expect(inOmaha, `stage 1 census: ${inOmaha} blocks above ground`).toBeGreaterThan(1500)

    // The road: every column of the paving has something at ground level,
    // over its whole length. A road with a hole in it is the one defect a
    // visitor is guaranteed to walk into.
    for (let z = ROAD.z0; z <= ROAD.z1; z++) {
      for (let x = ROAD.paving.x0; x <= ROAD.paving.x1; x++) {
        const key = w.palette[w.cols[z * 128 + x][GROUND_Y - 1 - w.yMin]]
        expect(key, `paving at patch (${x}, ${z})`).not.toBe('grass')
        expect(key).not.toBe('air')
      }
    }

    // The seven unbuilt stages are empty, which is what makes this spec
    // meaningful today and what will make it fail informatively tomorrow.
    const built = PLOTS.filter(p => census(w, p.x0, p.x1, p.z0, p.z1) > 0).map(p => p.id)
    expect(built).toContain('omaha')

    // And nothing has escaped into the margin outside every allocation.
    expect(census(w, 0, 3, 0, 127), 'the west margin').toBe(0)
    expect(census(w, 124, 127, 0, 127), 'the east margin').toBe(0)
  })

  test('the house is standing, and you can walk into it', async ({ page }) => {
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

  test('what stage 1 looks like from the road', async ({ page }) => {
    // Visual by nature, and the one that catches the failure a census cannot:
    // a build that reads from above and not at eye level.
    await teleport(page, 63 - ORIGIN_X + 0.5, SURFACE_Y + 1, 20 - ORIGIN_Z + 0.5)
    await page.waitForTimeout(1200)
    await shot(page, 'omaha-from-road')
  })
})
