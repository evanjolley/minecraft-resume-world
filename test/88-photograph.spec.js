/*
 * THE PHOTOGRAPH OF THE REAL SCHOOL, HUNG IN CHAPTER 1.
 *
 * ------------------------------------------------------------------------
 * The owner's ask was a comparison: "a painting of millardnorth2.webp in
 * front of the build so that people can compare what AI built to the real
 * thing." So there are two claims here and they fail in different ways.
 *
 *   THE PICTURE IS ON THE WALL. Six frame blocks, one art registration, a
 *   solid support behind every cell, and the registration landing on the
 *   frame rather than 41 blocks west of it. All of that is coordinates, and
 *   coordinates are assertions.
 *
 *   IT IS IN THE RIGHT PLACE. That is a judgement, and the only honest test
 *   of it is a person looking at the frames at the bottom -- particularly
 *   `88-comparison`, which is the deliverable: the photograph and the built
 *   entrance in one view. The one part of the judgement a number CAN carry
 *   is the mistake that ruins it, so that one is asserted: nothing of this
 *   stands in the head-on view of the building it is asking you to compare.
 *
 * EVERY SAMPLE IS ASSERTED NON-EMPTY BEFORE IT IS READ, which is 85's rule
 * and the reason for it is worse here: `paintingAt` on empty air returns
 * null, a census of nothing finds no misplaced paintings, and both of those
 * pass vacuously. Mutations in this repo have failed to fail four times,
 * twice inside the paintings work itself.
 * ------------------------------------------------------------------------
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test as base, expect } from './fixtures.js'
import {
  SURFACE_Y, waitFrames, waitTicks, look, teleport, HEADING,
  bootWorld, resetWorld,
} from './helpers/world.js'
import { CHAPTERS, LAND_ORIGIN_X, LAND_ORIGIN_Z } from '../src/builds/plots.js'

/* ------------------------------------------------------------------ *
 * THIS FILE BOOTS ITS OWN PAGE, and it is the only one in the suite that
 * does. It is worth the ten seconds.
 *
 * fixtures.js shares one booted world per worker and resets the player, the
 * inventory, the clock and any broken voxels between tests -- everything a
 * spec can mutate and put back. The painting registry is the thing it cannot
 * put back: `resetPaintings()` clears every hung painting in the page, and
 * test/87-paintings.spec.js calls it in a `beforeEach` because it needs an
 * empty world to hang its own demonstrations in. Perfectly reasonable for
 * paintings hung BY a spec, and it also wipes the one this build stamped at
 * world-generation time.
 *
 * The result was a spec that passed alone and failed after 87 in the same
 * worker, with "a painting is registered at -60,137,29 / Received: null" --
 * which reads as "the build did not hang it" and is nothing of the kind.
 * Regenerating is not an option: src/dimensions.js caches a loaded world and
 * `enter` on the world you are already in refuses, so there is no way back to
 * a freshly stamped registry inside one page.
 *
 * So this file gets a page nobody else has touched. Worker-scoped, so it is
 * one boot for the whole file rather than one per test, and `resetWorld`
 * still runs between tests exactly as the shared fixture does it.
 * ------------------------------------------------------------------ */
const test = base.extend({
  ownWorld: [async ({ browser }, use) => {
    const page = await browser.newPage()
    await bootWorld(page)
    await use(page)
    await page.close()
  }, { scope: 'worker' }],

  page: async ({ ownWorld }, use) => {
    await resetWorld(ownWorld)
    await use(ownWorld)
  },
})

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots')

/** The plot out of the table, so a resize moves the camera with the wall. */
const CH1 = CHAPTERS.find(c => c.id === 'ch1')

/* ------------------------------------------------------------------ *
 * The numbers, in the plot-local coordinates the build file is written in,
 * and typed here rather than imported. `photograph()` is not exported and a
 * spec that imported its constants would be asking the build whether it
 * agrees with itself.
 * ------------------------------------------------------------------ */
const WALL = { x0: 52, x1: 58, z: 24, yTop: 3 }   // the display wall
const PIC = { x: 54, y: 1, z: 23, w: 3, h: 2 }    // bottom-left cell, viewer's left
const SIGN = { x: 55, y: 0, z: 23 }

/** The span of the head-on view of the entrance: canopy x 30..50, pavilion
 *  x 32..48. Nothing hung for comparison may sit inside it. */
const ENTRY_VIEW = { x0: 28, x1: 51 }

/** Plot-local -> the coordinates noa answers in. `voxelAt`, `getBlock` and
 *  the painting registry all speak this one. */
const W = (lx, ly, lz) => [
  CH1.x0 + lx - LAND_ORIGIN_X,
  SURFACE_Y + ly,
  CH1.z0 + lz - LAND_ORIGIN_Z,
]

/** Plot-local -> world x/z for a teleport, which takes no y. */
const L = (lx, lz) => [CH1.x0 + lx - LAND_ORIGIN_X, CH1.z0 + lz - LAND_ORIGIN_Z]

/** `voxelAt` already speaks noa's coordinates -- patch index minus the
 *  world's origin -- which is exactly what W() hands back, so nothing is
 *  subtracted here. Subtracting the origin a second time reads a column 128
 *  blocks away and answers `barrier`, which is what the first run of this
 *  file did on every assertion that used it. */
const keyAt = (page, [x, y, z]) => page.evaluate(
  ([a, b, c]) => window.game.blockKey(window.game.voxelAt(a, b, c)), [x, y, z])

const paintingAt = (page, [x, y, z]) => page.evaluate(
  ([a, b, c]) => window.game.paintings.paintingAt(a, b, c), [x, y, z])

test.describe('the photograph of the real school', () => {
  test('hangs on a wall of its own, on the plaza', async ({ page }) => {
    await waitTicks(page, 5)

    /*
     * THE CENSUS FIRST, and it is the sample every claim below reads from.
     * Every painting block in the whole 66 x 63 plot, by patch coordinate --
     * out of the generator rather than the meshed chunks, because the plot is
     * bigger than the render distance and an unmeshed chunk answers 0.
     */
    const cells = await page.evaluate(([y0, c]) => {
      const v = window.game.voxelAt
      const t = window.game.terrain
      const out = []
      for (let pz = c.z0; pz <= c.z1; pz++) {
        for (let px = c.x0; px <= c.x1; px++) {
          for (let y = y0 - 4; y <= y0 + 22; y++) {
            const id = v(px - t.originX, y, pz - t.originZ)
            if (id === 0) continue
            const k = window.game.blockKey(id)
            if (k === 'painting' || k.startsWith('painting_wall_')) {
              out.push({ x: px - t.originX, y, z: pz - t.originZ, key: k })
            }
          }
        }
      }
      return out
    }, [SURFACE_Y, { x0: CH1.x0, x1: CH1.x1, z0: CH1.z0, z1: CH1.z1 }])

    // The sample, before the claim. Six cells for a 3x2 and not one more:
    // a second painting anywhere in the plot would mean the census below is
    // describing a bounding box over two of them.
    expect(cells.length, 'six painting cells in chapter 1').toBe(PIC.w * PIC.h)

    /* All six are the NORTH variant, which keeps the bare key `painting` --
     * the canonical is also the item. A wall of `painting_wall_south` here
     * would be a picture facing the building instead of the plaza, and would
     * look identical in a plan view. */
    expect([...new Set(cells.map(c => c.key))], 'all six face north')
      .toEqual(['painting'])

    /* And they are the six cells the build claims. Derived from the anchor
     * and the viewer's right (+x on a north-facing wall), never listed, so a
     * mirror flip puts the rectangle on the other side of the anchor and
     * this fails rather than passing on a coincidence. */
    const want = []
    for (let u = 0; u < PIC.w; u++) {
      for (let h = 0; h < PIC.h; h++) want.push(W(PIC.x + u, PIC.y + h, PIC.z).join(','))
    }
    expect(cells.map(c => `${c.x},${c.y},${c.z}`).sort()).toEqual(want.sort())

    /*
     * IT IS NOT IN FRONT OF THE BUILDING, which is the one way to get this
     * exactly wrong and the one part of "is it in a good place" a number can
     * answer. The entrance is read head-on from the entry axis and everything
     * in that view is between local x 28 and x 52.
     */
    const minX = Math.min(...cells.map(c => c.x))
    expect(minX, 'the picture is clear of the head-on view of the entrance')
      .toBeGreaterThan(W(ENTRY_VIEW.x1, 0, 0)[0])
    /* ...and it is on the plaza, north of the wings, not tucked down the
     * side of the building where nobody stands. */
    expect(Math.max(...cells.map(c => c.z)), 'north of the wing face')
      .toBeLessThan(W(0, 0, 28)[2])
  })

  test('the art is registered on the frame, and the frame has a wall behind it',
    async ({ page }) => {
      await waitTicks(page, 5)

      /*
       * THE REGISTRATION, at the anchor. This is the assertion that catches
       * the coordinate system the picture is registered in being the wrong
       * one of the two this repo has: `hangPainting` writes its blocks in
       * plot-local through `s.set` and its ART at `s.toWorld(...)`, and the
       * archive's origin is 41 blocks and 40 rows away from the overworld's.
       * Six empty frames and a picture nobody can find is what that looks
       * like, and nothing above would notice.
       */
      const anchor = W(PIC.x, PIC.y, PIC.z)
      const hung = await paintingAt(page, anchor)
      expect(hung, `a painting is registered at ${anchor}`).not.toBeNull()
      expect(hung.name).toBe('millard_north')
      expect(hung.facing, 'the picture looks north, up the plaza').toBe('north')
      expect(hung.anchor, 'and the anchor is the bottom-left cell')
        .toBe(anchor.join(','))
      expect([hung.w, hung.h], 'three wide, two high').toEqual([PIC.w, PIC.h])

      /* Every cell of the rectangle belongs to that one anchor -- six blocks,
       * one object. The far corner rather than only the anchor, which is the
       * easy case. */
      const far = await paintingAt(page, W(PIC.x + PIC.w - 1, PIC.y + PIC.h - 1, PIC.z))
      expect(far, 'the far corner is covered too').not.toBeNull()
      expect(far.anchor).toBe(anchor.join(','))

      /*
       * THE SUPPORT. Vanilla's rule, checked per cell here: every block
       * BEHIND the rectangle must be solid or installAttachment pops the
       * picture off on the next tick. Behind a north-facing painting is +z.
       */
      for (let u = 0; u < PIC.w; u++) {
        for (let h = 0; h < PIC.h; h++) {
          const key = await keyAt(page, W(PIC.x + u, PIC.y + h, PIC.z + 1))
          expect(key, `the wall behind cell ${u},${h}`).toBe('bricks')
        }
      }

      /* ...and it is still there twenty ticks later, which is the difference
       * between "the stamper wrote six blocks" and "the picture survived the
       * attachment sweep". */
      await waitTicks(page, 20)
      expect(await paintingAt(page, anchor), 'still hanging').not.toBeNull()
    })

  test('the wall it hangs on is built, capped and lit', async ({ page }) => {
    await waitTicks(page, 5)

    /* The sample: the seven columns of the wall, read bottom to top. Asserted
     * to be solid before anything is said about which blocks they are. */
    const column = await page.evaluate(([w, y0, ch, ox, oz]) => {
      const v = window.game.voxelAt
      const out = {}
      for (let lx = w.x0; lx <= w.x1; lx++) {
        // Plot-local -> patch -> noa, once. See keyAt's note.
        const x = ch.x0 + lx - ox, z = ch.z0 + w.z - oz
        out[lx] = []
        for (let ly = -1; ly <= w.yTop; ly++) {
          out[lx].push(window.game.blockKey(v(x, y0 + ly, z)))
        }
      }
      return out
    }, [WALL, SURFACE_Y, CH1, LAND_ORIGIN_X, LAND_ORIGIN_Z])

    const all = Object.values(column).flat()
    expect(all.length, 'seven columns of five').toBe(7 * 5)
    expect(all.filter(k => k === 'air').length, 'the wall is solid').toBe(0)

    /* Charcoal footing, brick body, andesite cap -- the plaza's seat blocks,
     * the colonnade's piers and the parapet coping, in that order up. */
    expect(column[55], 'the middle column, ground to cap').toEqual(
      ['polished_deepslate', 'polished_deepslate', 'bricks', 'bricks', 'polished_andesite'])

    /* And a lantern in each end of the cap. The picture does not need one --
     * object meshes take no block light, so it is legible in the dark -- but
     * the wall does, or at night the photograph floats in front of nothing. */
    expect(column[WALL.x0].at(-1), 'a lantern in the west end of the cap')
      .toBe('sea_lantern')
    expect(column[WALL.x1].at(-1), 'and one in the east end').toBe('sea_lantern')
  })

  test('the label is a real sign and its words reached the renderer',
    async ({ page }) => {
      /* The sign block, in the base course under the middle of the picture. */
      expect(await keyAt(page, W(SIGN.x, SIGN.y, SIGN.z)))
        .toBe('oak_wall_sign_north')

      /*
       * And the TEXT, which is a separate registry keyed by world coordinate
       * -- the same two-coordinate agreement `hangPainting` exists to avoid,
       * and a sign gets away with it only because a sign is one block. The
       * mesh existing at that key is what says the two numbers agree.
       *
       * WHETHER IT READS FORWARDS IS A SCREENSHOT, per docs/builds/README.md:
       * four builds have shipped mirrored text and none of them were caught
       * by a census. See `88-label` below.
       */
      const [sx, sy, sz] = W(SIGN.x, SIGN.y, SIGN.z)
      await teleport(page, sx + 0.5, SURFACE_Y + 1, sz - 2.5)
      await waitTicks(page, 14)
      const text = await page.evaluate(([a, b, c]) => {
        const mesh = window.noa.rendering.getScene().getMeshByName(`sign-text-${a},${b},${c}`)
        if (!mesh) return null
        const p = mesh.getVerticesData('position')
        return { vertices: p ? p.length / 3 : 0 }
      }, [sx, sy, sz])
      expect(text, `the sign at ${sx},${sy},${sz} has words on it`).not.toBeNull()
      // Four vertices a glyph, two lines of a dozen. Asserted as "not empty"
      // rather than as an exact count, because what the sign SAYS is the
      // screenshot's job and a count would only restate the string.
      expect(text.vertices, 'and they are drawn').toBeGreaterThan(20)
    })
})

/* ------------------------------------------------------------------ *
 * THE PHOTOGRAPHS. Read these; the assertions above cannot tell you whether
 * a visitor can compare one building to another.
 * ------------------------------------------------------------------ */

async function frameAt(page, name, [lx, lz], { heading = HEADING.southPlusZ, pitch = 0 }) {
  const [x, z] = L(lx, lz)
  await teleport(page, x + 0.5, SURFACE_Y + 1, z + 0.5)
  await waitTicks(page, 14)
  const under = await page.evaluate(() => {
    const noa = window.noa
    const [a, b, c] = noa.ents.getPositionData(noa.playerEntity).position.map(Math.floor)
    return window.game.blockKey(noa.getBlock(a, b - 1, c))
  })
  expect(under, `nothing meshed under ch1 local (${lx}, ${lz})`).not.toBe('air')
  await look(page, { heading, pitch })
  await waitFrames(page, 12)
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
}

test.describe('what a visitor sees', () => {
  test('the approach, the picture, and both in one frame', async ({ page }) => {
    test.setTimeout(180_000)
    await waitTicks(page, 8)

    /* THE APPROACH. Off the spur at local (65, 6), where the visitor arrives;
     * the school is across the plaza and the photograph is on the way to it. */
    await frameAt(page, '88-approach', [62, 9], { heading: -0.67, pitch: -0.08 })

    /*
     * THE DELIVERABLE: the photograph and the built entrance in one frame.
     *
     * Standing BACK from both rather than between them, which is the version
     * of this frame that works. From ten blocks off the picture the entrance
     * is beside you rather than in front, the picture is 27 degrees off its
     * own normal, and the result is a foreshortened smear next to a wall of
     * column. From fourteen, with the drop-off behind you, the two are 30
     * degrees apart -- the picture about 15 right of the heading and the
     * entrance 15 left, both well inside a 74-degree view -- and the picture
     * is nearly square on.
     */
    await frameAt(page, '88-comparison', [60, 10], { heading: -0.58, pitch: -0.10 })

    /* HEAD-ON, from where you would stand to actually look at it. */
    await frameAt(page, '88-head-on', [55, 16], { pitch: -0.05 })
    await frameAt(page, '88-close', [55, 20], { pitch: -0.05 })

    /* THE LABEL, close enough to read, which is the only check the README
     * accepts on whether words came out mirrored. */
    await frameAt(page, '88-label', [55, 21], { pitch: 0.28 })

    /*
     * AND THE PICTURE'S OWN MESH, now that the chunk is meshed and it has
     * actually drawn. Three blocks across and two up, on the quad the GPU is
     * handed rather than on the table that built it.
     */
    const anchor = W(PIC.x, PIC.y, PIC.z)
    const mesh = await page.evaluate(([a, b, c]) => {
      const m = window.noa.rendering.getScene().getMeshByName(`painting-${a},${b},${c}`)
      if (!m) return null
      const p = m.getVerticesData('position')
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
      for (let i = 0; i < p.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], p[i + k]); hi[k] = Math.max(hi[k], p[i + k])
        }
      }
      return { lo, hi, vertices: p.length / 3, texture: m.material?.diffuseTexture?.name }
    }, anchor)
    expect(mesh, `the picture draws at ${anchor}`).not.toBeNull()
    expect(mesh.vertices, 'one quad').toBe(4)
    expect(Math.max(mesh.hi[0] - mesh.lo[0], mesh.hi[2] - mesh.lo[2]),
      'three blocks across').toBeCloseTo(PIC.w, 5)
    expect(mesh.hi[1] - mesh.lo[1], 'two blocks up').toBeCloseTo(PIC.h, 5)
    expect(mesh.texture, "and it is the owner's photograph")
      .toContain('paintings/millard_north.png')
  })
})
