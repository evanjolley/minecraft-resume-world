/*
 * MILLARD NORTH, PHOTOGRAPHED AND READ BACK.
 *
 * ------------------------------------------------------------------------
 * THREE JOBS, and only two of them are assertions.
 *
 *   1. THE PICTURES. A building is judged against a photograph and there is
 *      no number for "does this look like the school". The frames below are
 *      the evidence: the approach off the spur, the entrance head-on from
 *      the plaza against the reference photograph, the commons from inside,
 *      the corridor, the gym, and the whole plot from above.
 *   2. THE LABELS, DECODED. docs/builds/README.md's mirrored-text warning is
 *      there because FOUR agents have now shipped backwards text in this
 *      repo, and this build has readable text on THREE different planes: a
 *      north-facing `xy` wall in the commons, a west-facing `zy` wall in the
 *      gym, and two drawings flat on the ground in `xz`. Each one is lifted
 *      out of the world and matched against the same glyph table the builder
 *      stamped from, so a flip fails here with the word it actually spells.
 *   3. THE ARCHIVE IS UNTOUCHED. `claude-opus-5-1` is the owner's saved copy
 *      of the previous build. A digest over every voxel in it is what says
 *      so, and it is the only claim in this file that would survive somebody
 *      deleting all the screenshots.
 *
 * EVERY SAMPLE IS ASSERTED NON-EMPTY BEFORE IT IS DECODED. Several mutations
 * in this repo have failed to fail, and all-air decodes to nothing in the
 * most vacuously passing way there is.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from './fixtures.js'
import {
  SURFACE_Y, waitFrames, waitTicks, look, teleport, HEADING,
  useGamemode, doubleTapFly, enterWorld,
} from './helpers/world.js'
import { CHAPTERS, LAND_ORIGIN_X, LAND_ORIGIN_Z } from '../src/builds/plots.js'
import { GLYPHS, textWidth } from '../src/builds/font.js'

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots')

/** The plot, from the table rather than typed here, so a resize moves the
 *  camera with the building instead of photographing the lawn beside it. */
const CH1 = CHAPTERS.find(c => c.id === 'ch1')

/** Plot-local -> patch -> world. Every coordinate in this file is written in
 *  the same plot-local numbers src/builds/ch1-millard-north.js is. */
const L = (lx, lz) => [CH1.x0 + lx - LAND_ORIGIN_X, CH1.z0 + lz - LAND_ORIGIN_Z]

/** What is under the player's feet, out of noa's chunk store -- the MESHED
 *  world answering, not the generator. */
const underfoot = (page) => page.evaluate(() => {
  const noa = window.noa
  const [x, y, z] = noa.ents.getPositionData(noa.playerEntity).position.map(Math.floor)
  return window.game.blockKey(noa.getBlock(x, y - 1, z))
})

async function frameAt(page, name, [lx, lz], opts = {}) {
  const { heading = HEADING.southPlusZ, pitch = 0.06, y = SURFACE_Y + 1, allowAir = false } = opts
  const [x, z] = L(lx, lz)
  await teleport(page, x + 0.5, y, z + 0.5)
  await waitTicks(page, 14)
  const under = await underfoot(page)
  if (!allowAir) expect(under, `nothing meshed under ch1 local (${lx}, ${lz})`).not.toBe('air')
  await look(page, { heading, pitch })
  await waitFrames(page, 12)
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
  return under
}

/*
 * READ A RECTANGLE OF THE WORLD AS A GRID OF '#' AND '.', out of the
 * GENERATOR rather than out of the meshed chunks, because half of these
 * walls are two hundred blocks from wherever the camera happens to be and an
 * unmeshed chunk answers 0 for every block in it.
 *
 * @param plane  'xy' rows stack DOWN from yTop (font order), chars run +x
 *               'zy' rows stack DOWN from yTop, chars run +z
 *               'xz' rows run +z, chars run +x, at one y
 */
function readGrid(page, plane, { x, y, z, w, h, key }) {
  return page.evaluate(([plane, x, y, z, w, h, key]) => {
    const v = window.game.voxelAt
    const t = window.game.terrain
    const id = window.game.ids[key]
    const hit = (px, py, pz) => v(px - t.originX, py, pz - t.originZ) === id ? '#' : '.'
    const rows = []
    for (let r = 0; r < h; r++) {
      let row = ''
      for (let c = 0; c < w; c++) {
        if (plane === 'xy') row += hit(x + c, y - r, z)
        else if (plane === 'zy') row += hit(x, y - r, z + c)
        else row += hit(x + c, y, z + r)
      }
      rows.push(row)
    }
    return rows
  }, [plane, x, y, z, w, h, key])
}

/** Cut a 5-row grid into 3-wide cells and match each against the font. */
function decode(grid, length) {
  const out = []
  for (let i = 0; i < length; i++) {
    const cell = grid.map(row => row.slice(i * 4, i * 4 + 3))
    const glyph = Object.entries(GLYPHS).find(([, g]) => g.join('') === cell.join(''))
    out.push(glyph ? glyph[0] : '?')
  }
  return out.join('')
}

/* The four digit glyphs the school's two dates need, a copy of the private
 * table in the build file. A copy on purpose: a spec that imports the thing
 * it is checking against cannot catch the table itself being wrong. */
const DIGITS = {
  0: ['###', '#.#', '#.#', '#.#', '###'],
  1: ['.#.', '##.', '.#.', '.#.', '###'],
  2: ['###', '..#', '###', '#..', '###'],
  6: ['###', '#..', '###', '#.#', '###'],
  7: ['###', '..#', '..#', '..#', '..#'],
  8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '###'],
}
function decodeDigits(grid, length) {
  const out = []
  for (let i = 0; i < length; i++) {
    const cell = grid.map(row => row.slice(i * 4, i * 4 + 3))
    const g = Object.entries(DIGITS).find(([, d]) => d.join('') === cell.join(''))
    out.push(g ? g[0] : '?')
  }
  return out.join('')
}

/** Does this grid contain enough marked blocks to be worth decoding? */
function assertSample(grid, what, min = 20) {
  const marks = grid.join('').replace(/\./g, '').length
  expect(marks, `${what}: nothing there to read`).toBeGreaterThan(min)
}

test.describe('Millard North High School', () => {
  test('the school is standing, and it is the only chapter that is', async ({ page }) => {
    await waitTicks(page, 5)
    const census = await page.evaluate(([y0, c]) => {
      const v = window.game.voxelAt
      const t = window.game.terrain
      const keys = new Map()
      let solid = 0, sampled = 0
      for (let pz = c.z0; pz <= c.z1; pz++) {
        for (let px = c.x0; px <= c.x1; px++) {
          for (let y = y0; y <= y0 + 22; y++) {
            sampled++
            const id = v(px - t.originX, y, pz - t.originZ)
            if (id === 0) continue
            solid++
            const k = window.game.blockKey(id)
            keys.set(k, (keys.get(k) ?? 0) + 1)
          }
        }
      }
      return { solid, sampled, keys: Object.fromEntries(keys) }
    }, [SURFACE_Y, { x0: CH1.x0, x1: CH1.x1, z0: CH1.z0, z1: CH1.z1 }])

    // The sample, before the claim.
    expect(census.sampled).toBeGreaterThan(80_000)
    expect(census.solid).toBeGreaterThan(8_000)

    /* The five surfaces the building is recognised by are all present in
     * quantity. A palette that quietly loses one of them -- a renamed block
     * key resolving to something else -- is the failure this catches. */
    for (const k of ['end_stone', 'bricks', 'smooth_stone', 'glass', 'polished_deepslate']) {
      expect(census.keys[k] ?? 0, `${k} missing from the school`).toBeGreaterThan(100)
    }
    /* AND NO PARKING LOT. The brief was explicit. Nothing in this plot is
     * asphalt-coloured in quantity: the drop-off loop is one four-block-wide
     * arc, so `andesite` is bounded, and a car park would blow past it. */
    expect(census.keys['andesite'] ?? 0).toBeLessThan(1_200)
  })

  test('every label reads forwards, on all three planes', async ({ page }) => {
    await waitTicks(page, 5)
    const X = CH1.x0, Z = CH1.z0, Y = SURFACE_Y      // local (0,0,0) in patch/abs

    /* 1. THE COMMONS WALL, `xy`, facing north. "MILLARD" over "NORTH", the
     *    way the real sign over the doors stacks it, on the back wall of the
     *    two-storey hall where it is read through the curtain wall as well
     *    as from inside. */
    const mw = textWidth('MILLARD'), nw = textWidth('NORTH')
    const mx = Math.round((17 + 47) / 2 - mw / 2), nx = Math.round((17 + 47) / 2 - nw / 2)
    const millard = await readGrid(page, 'xy',
      { x: X + mx, y: Y + 10, z: Z + 45, w: mw, h: 5, key: 'lapis_block' })
    assertSample(millard, 'the commons wall')
    expect(decode(millard, 7), 'commons, upper line').toBe('MILLARD')

    const north = await readGrid(page, 'xy',
      { x: X + nx, y: Y + 4, z: Z + 45, w: nw, h: 5, key: 'lapis_block' })
    assertSample(north, 'the commons wall, lower line')
    expect(decode(north, 5), 'commons, lower line').toBe('NORTH')

    /*
     * 2. THE GYM WALL, `zy`, facing west. The other plane, and the one the
     *    README says the first plane proves nothing about -- and it is not a
     *    theoretical worry: it came out of the first run spelling "??NAT?UM",
     *    which is "SGNATSUM" with the two letters the font has no mirrored
     *    twin for failing to decode at all.
     *
     *    IT IS SUPPOSED TO BE REVERSED, and the reason is the reader. `right
     *    = up x forward` in this left-handed engine; facing +z, right is +x
     *    (which is the fact chapters.js and path.js both record), so facing
     *    +x, right is -z. Characters on a wall read left to right, so on this
     *    wall they must run -z, and `pattern`'s 'zy' runs +z. Hence
     *    GYM_MIRROR = true in the build, and hence this grid -- which is read
     *    along +z -- being reversed back before it is decoded. Confirmed by
     *    the '85-gym' screenshot, which is the only check the README accepts.
     */
    const ww = textWidth('MUSTANGS')
    const wz = Math.round((29 + 60) / 2 - ww / 2)
    const gym = await readGrid(page, 'zy',
      { x: X + 16, y: Y + 10, z: Z + wz, w: ww, h: 5, key: 'lapis_block' })
    assertSample(gym, 'the gym banner')
    expect(decode(gym.map(r => [...r].reverse().join('')), 8), 'the gym banner').toBe('MUSTANGS')

    /* 3. THE PLAZA INLAY, `xz`, flat on the ground. The school's name at full
     *    size -- 51 blocks, which fits nowhere on the building -- laid in the
     *    paving on the entry axis. Text on the floor is read with the top of
     *    the letters AWAY from the reader, so the rows went in reversed; this
     *    reads them back in that order and would spell the same word either
     *    way round if the reversal were a no-op, which it is not, because the
     *    glyphs are not vertically symmetric. */
    const pw = textWidth('MILLARD NORTH')
    const px0 = Math.round(33 - pw / 2)
    const plazaRaw = await readGrid(page, 'xz',
      { x: X + px0, y: Y - 1, z: Z + 17, w: pw, h: 5, key: 'lapis_block' })
    assertSample(plazaRaw, 'the plaza inlay', 60)
    expect(decode(plazaRaw.slice().reverse(), 13), 'the plaza inlay').toBe('MILLARD NORTH')

    /* 4. THE TWO DATES. 1978 crawled to, under the bleachers; 2016 flown to,
     *    on the east wing's roof. Both are facts and both are easter eggs. */
    const roof = await readGrid(page, 'xz', {
      x: X + Math.round((47 + 64) / 2 - textWidth('2016') / 2),
      y: Y + 11, z: Z + 50, w: textWidth('2016'), h: 5, key: 'glowstone',
    })
    assertSample(roof, 'the roof date', 15)
    expect(decodeDigits(roof.slice().reverse(), 4), 'the roof date').toBe('2016')

    const cellar = await readGrid(page, 'xz',
      { x: X + 2, y: Y - 4, z: Z + 34, w: textWidth('1978'), h: 5, key: 'glowstone' })
    assertSample(cellar, 'the date under the bleachers', 15)
    expect(decodeDigits(cellar.slice().reverse(), 4), 'the date under the bleachers').toBe('1978')
  })

  test('the archive is byte for byte what it was', async ({ page }) => {
    test.setTimeout(180_000)
    await enterWorld(page, 'claude-opus-5-1')
    await waitTicks(page, 10)

    /*
     * A DIGEST OVER EVERY VOXEL IN THE ARCHIVE, by block KEY and not by
     * palette id -- an id is an index into a table this pass could reorder
     * without changing a single block, and a digest that moved for that
     * reason would cry wolf on the one claim that has to be trustworthy.
     *
     * FNV-1a, 32 bit, over "x,y,z,key" for every solid voxel. Not a
     * cryptographic requirement: the threat model is an accidental edit, not
     * a forged one.
     */
    const digest = await page.evaluate(() => {
      const v = window.game.voxelAt
      const t = window.game.terrain
      const keyOf = new Map()
      let h = 0x811c9dc5, solid = 0
      const feed = (str) => {
        for (let i = 0; i < str.length; i++) {
          h ^= str.charCodeAt(i)
          h = Math.imul(h, 0x01000193)
        }
      }
      for (let pz = 0; pz < t.depth; pz++) {
        for (let px = 0; px < t.width; px++) {
          for (let y = 132; y <= 200; y++) {
            const id = v(px - t.originX, y, pz - t.originZ)
            if (id === 0) continue
            solid++
            let k = keyOf.get(id)
            if (k === undefined) { k = window.game.blockKey(id); keyOf.set(id, k) }
            feed(`${px},${y},${pz},${k};`)
          }
        }
      }
      return { hex: (h >>> 0).toString(16), solid, width: t.width, depth: t.depth }
    })

    // The sample, before the claim. A digest of nothing is a very stable
    // digest.
    expect(digest.width).toBe(128)
    expect(digest.depth).toBe(128)
    expect(digest.solid).toBeGreaterThan(50_000)
    /*
     * MEASURED AT 401df98, the commit that resized ch1 -- which is before a
     * single block of the school existed and is therefore a baseline taken
     * from the tree this work started on. Nothing in chapter 1 can reach this
     * world: it is a 128 patch stamped by src/builds/index.js from the
     * archive's own eight build files, and the overworld's chapters are
     * stamped by src/builds/land.js. The digest says so rather than the
     * paragraph saying so.
     */
    expect(digest.hex).toBe(ARCHIVE_DIGEST)
  })
})

/*
 * FNV-1a over every solid voxel in `claude-opus-5-1`, keyed by block name.
 * Measured at 401df98 -- the commit that resized ch1 and built nothing -- so
 * it is a baseline from the tree this work started on rather than one taken
 * after the fact from whatever happened to be there.
 */
const ARCHIVE_DIGEST = 'e3233e67'

test.describe('the school, photographed', () => {
  test('from the spur, the plaza, inside, and above', async ({ page }) => {
    test.setTimeout(240_000)
    /* The archive test above leaves the page in claude-opus-5-1, and the
     * fixture shares one booted world across the file. Come home first, or
     * every frame below is a photograph of the wrong 128 blocks. */
    await enterWorld(page, 'overworld')
    await waitTicks(page, 8)

    /* THE ARRIVAL. src/builds/chapters.js opens the plot border at local
     * (65, 6) and the build paves a walk in from it, so this is the first
     * frame a visitor gets of the school. */
    /* Looking south-west, which is where the school is from here: the spur
     * arrives at the plot's path-side corner and the building is forty
     * blocks across the lawn and twenty down it. The first version of this
     * frame faced due west and photographed the forest. */
    await frameAt(page, '85-approach', [62, 9], { heading: -0.75, pitch: -0.12 })

    /* THE HEAD-ON, and this is the deliverable: the frame that gets put next
     * to the reference photograph. Twenty blocks back on the entry axis,
     * looking up enough to get the canopy in. */
    await frameAt(page, '85-head-on-wide', [40, 4], { pitch: -0.18 })
    await frameAt(page, '85-head-on', [40, 10], { pitch: -0.30 })
    await frameAt(page, '85-head-on-close', [40, 18], { pitch: -0.45 })

    /* THE THREE-QUARTER, which is what the dusk photograph is. */
    await frameAt(page, '85-three-quarter', [12, 12], { heading: -0.8, pitch: -0.25 })

    /* INSIDE. Standing in the commons looking at the name on the back wall,
     * then the corridor, then the gym. */
    await frameAt(page, '85-commons', [40, 34], { pitch: -0.14 })
    /* And from just inside the doors, where the mezzanine, the trophy-case
     * end of the hall and the name on the back wall are in one frame. */
    await frameAt(page, '85-commons-wide', [40, 32], { pitch: -0.16 })
    await frameAt(page, '85-corridor', [22, 49], { heading: HEADING.westPlusX, pitch: 0 })
    await frameAt(page, '85-gym', [6, 44], { heading: HEADING.westPlusX, pitch: -0.1 })

    /* AND FROM ABOVE, where the plaza inlay and the roof date are legible. */
    await useGamemode(page, 'creative')
    await doubleTapFly(page)
    const [ax, az] = L(33, 40)
    await teleport(page, ax + 0.5, SURFACE_Y + 70, az + 0.5)
    await waitTicks(page, 30)
    await look(page, { heading: HEADING.southPlusZ, pitch: 1.35 })
    await waitFrames(page, 20)
    await page.screenshot({ path: path.join(SHOTS, '85-above.png') })
    expect(await page.evaluate(() => window.game.terrain.width)).toBe(256)
  })
})
