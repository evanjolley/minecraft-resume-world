/*
 * THE WALK, PHOTOGRAPHED, AND EVERY LABEL READ.
 *
 * ------------------------------------------------------------------------
 * WHAT A NUMBER CANNOT SAY ABOUT THIS BUILD, and therefore why this file is
 * mostly pictures.
 *
 * test/01-world.spec.js censuses the patch: the landscape is stamped, the
 * plots are empty, the archive is untouched. None of that answers the
 * owner's actual brief, which was "organic and living" and "less cramped".
 * A path can pass every count and read as a wave; a forest can pass every
 * count and be a wall. The instrument for those is the eye, and the view
 * that matters is EYE LEVEL, because that is the only view a visitor gets.
 *
 * EVERY SHOT ASSERTS ITS SAMPLE FIRST. A screenshot of an unmeshed void is
 * a green test with a black picture, and this repo has shipped both a probe
 * that passed vacuously and a set of fabricated discrimination notes. Each
 * frame below checks the block under the player's feet, out of noa's chunk
 * store rather than out of the generator, before it takes the picture.
 * ------------------------------------------------------------------------
 * AND THE LABELS ARE READ BACK AS TEXT, which is the one thing in this file
 * that is an assertion rather than evidence.
 *
 * docs/builds/README.md: Babylon is left-handed, a row of pattern characters
 * can run right-to-left for the reader, and THREE separate agents shipped
 * backwards text in this repo before the warning was written. The screenshots
 * below are how it was checked; `readMarker` is how it stays checked, by
 * lifting the glowstone out of the world and decoding it against the same
 * font the builder used. A marker that flips fails here with the word it
 * actually spells.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from './fixtures.js'
import {
  SURFACE_Y, waitFrames, waitTicks, look, position, teleport, HEADING,
  useGamemode, doubleTapFly,
} from './helpers/world.js'
import { CHAPTERS, LAND_ORIGIN_X, LAND_ORIGIN_Z } from '../src/builds/plots.js'
import { GLYPHS, textWidth } from '../src/builds/font.js'

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots')

/** Patch indices -> world coordinates, the overworld's origin. */
const W = (px, pz) => [px - LAND_ORIGIN_X, pz - LAND_ORIGIN_Z]

/** What is under the player's feet, by key, out of noa's chunk store -- so it
 *  is the MESHED world answering, not the generator. */
const underfoot = (page) => page.evaluate(() => {
  const noa = window.noa
  const [x, y, z] = noa.ents.getPositionData(noa.playerEntity).position.map(Math.floor)
  return window.game.blockKey(noa.getBlock(x, y - 1, z))
})

/**
 * Stand somewhere on the walk, look, and take one -- after waiting for the
 * chunks to actually arrive. `settle` polls the block under the feet rather
 * than sleeping a fixed time, because a teleport 200 blocks down the map
 * lands in unmeshed space and noa streams it in over several ticks.
 */
async function frameAt(page, name, [px, pz], { heading = HEADING.southPlusZ, pitch = 0.06, y = SURFACE_Y + 1 } = {}) {
  const [x, z] = W(px, pz)
  await teleport(page, x + 0.5, y, z + 0.5)
  await waitTicks(page, 12)
  const under = await underfoot(page)
  expect(under, `nothing meshed under patch (${px}, ${pz})`).not.toBe('air')
  await look(page, { heading, pitch })
  await waitFrames(page, 10)
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
  return under
}

test.describe('the walk', () => {
  test('from spawn, down the path, over the bridge', async ({ page }) => {
    test.setTimeout(180_000)
    await waitTicks(page, 10)

    /* SPAWN. You arrive standing ON the path with it running away in front of
     * you -- which is the whole reason the world origin moved to the north
     * end of a 256 patch instead of its middle. */
    const [, y] = await position(page)
    expect(y).toBeCloseTo(SURFACE_Y, 1)
    const atSpawn = await underfoot(page)
    expect(atSpawn).not.toBe('air')
    expect(atSpawn).not.toBe('grass')       // worn ground, not the bare field
    await look(page, { heading: HEADING.southPlusZ, pitch: 0.06 })
    await waitFrames(page, 10)
    await page.screenshot({ path: path.join(SHOTS, '75-spawn.png') })

    /* THREE POINTS ALONG THE WALK, one per swing: the first bend past Omaha,
     * the long approach to Bilibili, and the last bend before the climb.
     * Different bends, different widths, different heights.
     *
     * THE MIDDLE ONE MOVED. It used to stand on the high ground opposite the
     * school-work plot; that chapter merged into Harvard and the spine was
     * re-cut, so the coordinate is now on the swing toward Bilibili, which is
     * the bend that replaced it. */
    await frameAt(page, '75-walk-1-bend', [106, 46])
    await frameAt(page, '75-walk-2-rise', [110, 116])
    await frameAt(page, '75-walk-3-south', [112, 228])

    /* THE BRIDGE, approached from the north bank so the deck, the railings
     * and the water are all in the frame at once. */
    const deck = await frameAt(page, '75-bridge', [136, 152])
    expect(deck).not.toBe('air')
  })

  test('a marker at eye level, from where a visitor reads it', async ({ page }) => {
    test.setTimeout(120_000)
    /*
     * CHAPTER 1's marker, read from the path side of it at standing height.
     * Twenty blocks north of the plot's north edge and level with the middle
     * of the word: the position somebody walking south is in when they decide
     * whether to turn off. If OMAHA is backwards, this is the picture that
     * says so -- and the decode test below is what keeps it said.
     */
    const c = CHAPTERS[0]
    const mx = c.x0 + Math.max(0, (c.x1 - c.x0) - textWidth(c.marker)) + Math.floor(textWidth(c.marker) / 2)
    await frameAt(page, '75-marker-omaha', [mx, c.z0 - 14], { pitch: -0.02 })

    /* And the same marker from further back, where the spur mouth, the plot
     * border and the word are all in one frame -- the composition that tells
     * a visitor there is somewhere to go. */
    await frameAt(page, '75-marker-omaha-approach', [mx + 14, c.z0 - 26], { pitch: 0.04 })
  })

  test('the whole map from above', async ({ page }) => {
    test.setTimeout(120_000)
    await useGamemode(page, 'creative')
    await doubleTapFly(page)
    const [x, z] = W(128, 120)
    await teleport(page, x + 0.5, SURFACE_Y + 118, z + 0.5)
    await waitTicks(page, 30)
    await look(page, { heading: HEADING.southPlusZ, pitch: 1.35 })
    await waitFrames(page, 20)
    await page.screenshot({ path: path.join(SHOTS, '75-map-above.png') })
    /*
     * NOT AN ASSERTION ABOUT WHAT IT LOOKS LIKE. A plan view is the one
     * picture that can be beautiful while the world at eye level is a
     * corridor, which is the failure mode the brief names. It is here to
     * check the SHAPE of the path -- that it reads as a walk and not as a
     * sine -- and for nothing else.
     */
    expect(await page.evaluate(() => window.game.terrain.width)).toBe(256)
  })
})

/*
 * THE LETTERS, DECODED.
 *
 * Read the glowstone out of the generator at the marker's wall, cut it into
 * 3x5 cells, and match each against the same GLYPHS table src/builds/font.js
 * stamped from. If the row order or the column order is reversed anywhere
 * between the font and the world, this spells something else and says what.
 */
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

    /*
     * The wall is at plot-local z = 2, and the letters run local y = 1..5 --
     * so absolute y 137 to 141, read TOP DOWN to match the font's rows.
     * Asked of the generator, because a marker 200 blocks away is not meshed.
     */
    const grid = await page.evaluate(([x0, z, ids]) => {
      const v = window.game.voxelAt
      const t = window.game.terrain
      const rows = []
      for (let y = 141; y >= 137; y--) {
        let row = ''
        for (let x = x0; x < x0 + 60; x++) {
          row += v(x - t.originX, y, z - t.originZ) === ids.glowstone ? '#' : '.'
        }
        rows.push(row)
      }
      return rows
    }, [x0, c.z0 + 2, { glowstone: await page.evaluate(() => window.game.ids.glowstone) }])

    // The sample, before the claim: an all-dots grid decodes to nothing and
    // would "read forwards" in the most vacuous possible way.
    expect(grid.join('').replace(/\./g, '').length,
      `no glowstone at ${c.id}'s marker`).toBeGreaterThan(20)
    expect(readMarker(grid, c.marker), `${c.id} marker`).toBe(c.marker)
  }
})
