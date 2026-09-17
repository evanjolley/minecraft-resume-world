import { test, expect } from './fixtures.js'
import {
  waitTicks, waitFrames, teleport, look, useGamemode, doubleTapFly, setBlock,
  getBlock, measureFps, ID, HEADING,
} from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * SIGNS, which are docs/FUTURE.md item 1 and the first thing in this world
 * that can say a word.
 *
 * There are two independent claims here and they are tested in different
 * ways on purpose:
 *
 *   THE BLOCK is geometry, and geometry is numbers. The board is one block
 *   wide and half a block tall because SignRenderer's 24x12x2 box times
 *   RENDER_SCALE 0.6666667 is, and that is read off the VERTEX BUFFER rather
 *   than off the table that built it -- a table is what you would have to
 *   trust, and the buffer is what the GPU is handed.
 *
 *   THE TEXT is legibility, and legibility is a screenshot. Nothing in this
 *   file can honestly assert that four lines of Monocraft can be read from
 *   ten blocks away; the images at the bottom are read by a person (or by a
 *   model that can see) and that is the check.
 *
 * Except for ONE thing the numbers can catch that a careless screenshot
 * cannot, and it is the reason this file exists in the shape it does:
 * docs/builds/README.md records three separate builds shipping MIRRORED text
 * because Babylon is left-handed. So the reading direction is asserted as a
 * vector, per facing, from the geometry that is actually in the buffer --
 * and then photographed from all four sides anyway, because the README's own
 * rule is that a derivation is not a check.
 *
 * Block ids duplicated rather than imported, the same rule the rest of the
 * suite follows: a renumber should fail here loudly.
 */
const SIGN = { north: 660, south: 661, east: 662, west: 663 }
const WALL_SIGN = { north: 664, south: 665, east: 666, west: 667 }

/** Mid-air, over the spawn column, for the reasons 66-torch.spec.js gives. */
const PY = 200
const CX = 40
const CZ = 20

/** Vanilla, in block pixels. Board 24x12x2 model px times 2/3. */
const BOARD_W = 16, BOARD_H = 8, BOARD_T = 4 / 3
const BOARD_BOTTOM = 28 / 3, BOARD_TOP = 52 / 3
const POST_H = 28 / 3

/** How far the photographed room reaches from its centre. */
const ROOM = 8

/** A stone floor with a stone wall on its -x side. 66-torch's room exactly. */
async function signRoom(page, r = 6) {
  await useGamemode(page, 'creative')
  await doubleTapFly(page)
  await teleport(page, CX + 0.5, PY + 2, CZ + 0.5)
  await page.waitForFunction(([x, y, z]) => {
    const w = window.noa.world
    const CS = w._chunkSize
    const c = w._storage.getChunkByIndexes(
      Math.floor(x / CS), Math.floor(y / CS), Math.floor(z / CS))
    return !!c && !c.isDisposed
  }, [CX, PY, CZ], { timeout: 20_000 })

  await page.evaluate(([cx, cz, y, rr, stone, air]) => {
    for (let dx = -rr; dx <= rr; dx++) {
      for (let dz = -rr; dz <= rr; dz++) {
        window.noa.setBlock(stone, cx + dx, y, cz + dz)
        for (let dy = 1; dy <= 6; dy++) window.noa.setBlock(air, cx + dx, y + dy, cz + dz)
      }
    }
    for (let dz = -rr; dz <= rr; dz++) {
      for (let dy = 1; dy <= 3; dy++) window.noa.setBlock(stone, cx - rr, y + dy, cz + dz)
    }
  }, [CX, CZ, PY, r, ID.stone, ID.air])
  await waitTicks(page, 4)
}

/**
 * The world-space bounding box of the mesh noa would draw for a block id,
 * in BLOCK PIXELS, read off the vertex buffer.
 *
 * Through `registry._blockMeshLookup` rather than by mesh name, for the
 * reason 66-torch.spec.js gives: a mesh built correctly and registered
 * against the wrong id passes a by-name search and fails here.
 */
const meshBox = (page, id) => page.evaluate((blockId) => {
  const mesh = window.noa.registry._blockMeshLookup[blockId]
  if (!mesh) return null
  const p = mesh.getVerticesData('position')
  if (!p || p.length === 0) return null
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      /*
       * +8 on x and z, and finding out why cost this file one failing run.
       * buildShapeMesh emits `p[0] - 0.5, p[1], p[2] - 0.5`: an object mesh's
       * origin is the HORIZONTAL CENTRE of its cell and the BOTTOM of it,
       * because that is where noa's objectMesher puts the instance. So a
       * wall sign's board read back as z 6 1/3 .. 7 2/3 rather than
       * 14 1/3 .. 15 2/3, which looks like a geometry bug and is a frame of
       * reference. Undone here so the numbers below are the ones a person
       * can check against vanilla's source.
       */
      const v = p[i + a] * 16 + (a === 1 ? 0 : 8)
      lo[a] = Math.min(lo[a], v)
      hi[a] = Math.max(hi[a], v)
    }
  }
  return { lo, hi, vertices: p.length / 3 }
}, id)

const setText = (page, x, y, z, lines, opts) =>
  page.evaluate(([a, b, c, l, o]) =>
    window.game.signs.setSignText(a, b, c, l, o), [x, y, z, lines, opts ?? {}])

const stats = (page) => page.evaluate(() => window.game.signs.signTextStats())

/**
 * The text mesh at a coordinate, as its world-space bounding box and vertex
 * count. Named, because unlike a block mesh a sign's text is OURS -- there is
 * no engine lookup to go through, the name is the contract.
 */
const textMesh = (page, x, y, z) => page.evaluate(([a, b, c]) => {
  const mesh = window.noa.rendering.getScene()
    .getMeshByName(`sign-text-${a},${b},${c}`)
  if (!mesh) return null
  const p = mesh.getVerticesData('position')
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[i + k]); hi[k] = Math.max(hi[k], p[i + k])
    }
  }
  return { lo, hi, vertices: p.length / 3, enabled: mesh.isEnabled() }
}, [x, y, z])

/* ------------------------------------------------------------------ *
 * 1. The block is vanilla's shape
 * ------------------------------------------------------------------ */

test.describe('the sign block', () => {
  test('the standing board is one block wide and half a block tall', async ({ page }) => {
    const box = await meshBox(page, SIGN.north)
    expect(box, 'the north standing sign has a mesh at all').not.toBeNull()
    expect(box.vertices).toBeGreaterThan(0)

    // A north-facing sign's board faces along z, so x is the wide axis.
    expect(box.hi[0] - box.lo[0]).toBeCloseTo(BOARD_W, 5)
    // The mesh is board plus post, so its z extent is the thicker of the two:
    // the post is 4/3 square and the board is 4/3 thick. They agree.
    expect(box.hi[2] - box.lo[2]).toBeCloseTo(BOARD_T, 5)
    // Bottom of the post to the top of the board, and the top OVERSHOOTS the
    // cell by 4/3 of a pixel exactly as vanilla's does. A transcription that
    // tidied that away would read 16 here.
    expect(box.lo[1]).toBeCloseTo(0, 5)
    expect(box.hi[1]).toBeCloseTo(BOARD_TOP, 5)
    expect(box.hi[1]).toBeGreaterThan(16)
  })

  test('the board turns with the facing and the post does not', async ({ page }) => {
    const ns = await meshBox(page, SIGN.north)
    const ew = await meshBox(page, SIGN.east)
    // North faces along z: wide in x, thin in z. East faces along x: the
    // other way round. Same board, quarter turn.
    expect(ns.hi[0] - ns.lo[0]).toBeCloseTo(BOARD_W, 5)
    expect(ew.hi[2] - ew.lo[2]).toBeCloseTo(BOARD_W, 5)
    expect(ew.hi[0] - ew.lo[0]).toBeCloseTo(BOARD_T, 5)
    // ...and both are the same height, because the post is square.
    expect(ew.hi[1]).toBeCloseTo(ns.hi[1], 5)
  })

  test('a wall sign is a board against its wall, with no post', async ({ page }) => {
    const box = await meshBox(page, WALL_SIGN.north)
    // A north-facing wall sign hangs on the +z wall: WALL_FRONT..WALL_BACK
    // outward from z = 16, which is 14 1/3 .. 15 2/3.
    expect(box.lo[2]).toBeCloseTo(16 - 5 / 3, 5)
    expect(box.hi[2]).toBeCloseTo(16 - 1 / 3, 5)
    expect(box.hi[0] - box.lo[0]).toBeCloseTo(BOARD_W, 5)
    // The post is gone, so the board's own 8 pixels are the whole height --
    // 4 1/3 to 12 1/3, the -0.3125 block drop applied to the standing one.
    expect(box.lo[1]).toBeCloseTo(13 / 3, 5)
    expect(box.hi[1]).toBeCloseTo(37 / 3, 5)
    expect(box.hi[1] - box.lo[1]).toBeCloseTo(BOARD_H, 5)
  })

  test('you walk through a sign, and you can still mine one', async ({ page }) => {
    await signRoom(page)
    await setBlock(page, SIGN.north, CX, PY + 1, CZ)
    expect(await getBlock(page, CX, PY + 1, CZ)).toBe(SIGN.north)

    // Pass-through: the physics resolver never sees the sign's boxes, so a
    // body dropped into its cell falls to the floor rather than resting on
    // the board. This is the assertion that fails if PASS_THROUGH_SHAPES
    // stops naming signs.
    await useGamemode(page, 'survival')
    await teleport(page, CX + 0.5, PY + 4, CZ + 0.5)
    await waitTicks(page, 40)
    const y = await page.evaluate(() => window.noa.playerEntity
      && window.noa.ents.getPositionData(window.noa.playerEntity).position[1])
    expect(y).toBeLessThan(PY + 1.5)

    // ...and it is still there to be aimed at, which is the OTHER half of the
    // opt-out: not colliding is not the same as not existing.
    expect(await getBlock(page, CX, PY + 1, CZ)).toBe(SIGN.north)
    await useGamemode(page, 'creative')
  })

  test('a sign placed on a wall is a wall sign, and falls when the wall goes',
    async ({ page }) => {
      await signRoom(page)
      const wx = CX - 6
      // Hang one on the +x face of the wall, so it points west (+x here).
      await setBlock(page, WALL_SIGN.west, wx + 1, PY + 2, CZ)
      expect(await getBlock(page, wx + 1, PY + 2, CZ)).toBe(WALL_SIGN.west)
      // Mine the wall. installAttachment's sweep takes the sign with it --
      // reused from the torch with no change at all.
      await setBlock(page, ID.air, wx, PY + 2, CZ)
      await waitTicks(page, 2)
      expect(await getBlock(page, wx + 1, PY + 2, CZ)).toBe(0)
    })

  test('a standing sign faces back at whoever planted it', async ({ page }) => {
    await signRoom(page)
    /*
     * THE ONE LINE MOST LIKELY TO BE "FIXED" INTO A BUG. A stair takes the
     * heading unchanged; a sign takes its opposite, because a sign you just
     * planted is looking at you. Placed while facing south, the board faces
     * north.
     */
    await look(page, { heading: HEADING.southPlusZ, pitch: 0.4 })
    await page.evaluate(([id, x, y, z]) => window.noa.setBlock(id, x, y, z),
      [SIGN.north, CX + 2, PY + 1, CZ + 2])
    // Placement resolves through the canonical id, which is what a hotbar
    // click writes -- so write THAT and see which of the eight lands.
    await page.evaluate(([id, x, y, z]) => {
      window.noa.targetedBlock = { normal: [0, 1, 0], position: [x, y - 1, z] }
      window.noa._pickResult.position[1] = y
      window.noa.setBlock(id, x, y, z)
    }, [SIGN.north, CX + 3, PY + 1, CZ + 3])
    expect(await getBlock(page, CX + 3, PY + 1, CZ + 3)).toBe(SIGN.north)
  })
})

/* ------------------------------------------------------------------ *
 * 2. The text, and which way round it runs
 * ------------------------------------------------------------------ */

test.describe('sign text', () => {
  test('four lines become one mesh of one quad per character', async ({ page }) => {
    await signRoom(page)
    await setBlock(page, SIGN.north, CX, PY + 1, CZ)
    await setText(page, CX, PY + 1, CZ, ['ABCD', 'EF', '', 'GHIJK'])
    await waitTicks(page, 2)

    const mesh = await textMesh(page, CX, PY + 1, CZ)
    expect(mesh, 'a sign with words on it has a text mesh').not.toBeNull()
    // 4 + 2 + 0 + 5 = 11 characters, four vertices each. A blank line and the
    // space inside a line both cost nothing, which is the claim.
    expect(mesh.vertices).toBe(11 * 4)

    // The text block is 90 font pixels at most and 39 tall, at 1/96 blocks
    // per font pixel -- so under a block wide and well under half tall.
    expect(mesh.hi[0] - mesh.lo[0]).toBeCloseTo(5 * 6 / 96, 4)
    expect(mesh.hi[1] - mesh.lo[1]).toBeCloseTo(39 / 96, 4)
  })

  test('a line longer than vanilla allows is cut at 90 pixels', async ({ page }) => {
    await signRoom(page)
    await setBlock(page, SIGN.north, CX + 1, PY + 1, CZ)
    await setText(page, CX + 1, PY + 1, CZ, ['ABCDEFGHIJKLMNOPQRSTUVWXYZ'])
    await waitTicks(page, 2)
    const mesh = await textMesh(page, CX + 1, PY + 1, CZ)
    // 90 / 6 = 15 Monocraft characters, which is where the number everyone
    // quotes comes from. The rule enforced is vanilla's PIXEL rule.
    expect(mesh.vertices).toBe(15 * 4)
    expect(mesh.hi[0] - mesh.lo[0]).toBeLessThanOrEqual(90 / 96 + 1e-6)
  })

  test('THE MIRROR: text runs to the reader\'s right on all four facings',
    async ({ page }) => {
      await signRoom(page)
      /*
       * docs/builds/README.md: three builds shipped reversed text because
       * Babylon is left-handed. The check is not "does a row of glyphs
       * exist", it is "which way along the board does the FIRST character
       * sit", and the answer has to be the reader's left.
       *
       * A one-character line is drawn centred, so it cannot answer this. Two
       * characters can: draw "AB" and the A must be on the reader's left. The
       * reader stands on the +normal side, looking along -normal, and their
       * right is (-n.z, 0, n.x).
       */
      const facings = {
        north: [0, 0, -1], south: [0, 0, 1], west: [1, 0, 0], east: [-1, 0, 0],
      }
      let checked = 0
      for (const [name, n] of Object.entries(facings)) {
        /*
         * Inside the room, and each one gets its own floor block first. The
         * first version of this loop walked off the edge of the floor at the
         * fourth facing and the sign FELL -- installAttachment did exactly
         * its job and the test read it as "east has no text mesh". A missing
         * support looks identical to a broken renderer from here.
         */
        const x = CX + 2, y = PY + 1, z = CZ - 2 + checked
        await setBlock(page, ID.stone, x, y - 1, z)
        await setBlock(page, SIGN[name], x, y, z)
        await setText(page, x, y, z, ['AB'])
        await waitTicks(page, 2)
        const first = await page.evaluate(([a, b, c]) => {
          const mesh = window.noa.rendering.getScene()
            .getMeshByName(`sign-text-${a},${b},${c}`)
          if (!mesh) return null
          // Vertex 0 is the TOP-LEFT corner of the first character, in
          // reading order, which is exactly the quantity at issue.
          const p = mesh.getVerticesData('position')
          return [p[0], p[1], p[2]]
        }, [x, y, z])
        expect(first, `${name} has a text mesh`).not.toBeNull()
        const right = [-n[2], 0, n[0]]
        // The first character sits on the reader's LEFT, so its offset
        // projected onto the reader's right vector is NEGATIVE.
        const along = first[0] * right[0] + first[2] * right[2]
        expect(along, `${name}: the first glyph is left of centre`).toBeLessThan(0)
        checked++
      }
      // A loop that silently ran zero times would have passed everything
      // above it. This repo has shipped a probe that passed vacuously.
      expect(checked).toBe(4)
    })

  test('the text sits proud of the board, not inside it', async ({ page }) => {
    await signRoom(page)
    await setBlock(page, SIGN.north, CX + 2, PY + 1, CZ)
    await setText(page, CX + 2, PY + 1, CZ, ['HI'])
    await waitTicks(page, 2)
    const pos = await page.evaluate(([a, b, c]) => {
      const mesh = window.noa.rendering.getScene()
        .getMeshByName(`sign-text-${a},${b},${c}`)
      // Local position, which noa has already rebased -- so compare it back
      // to the same rebasing rather than to the world coordinate.
      return window.noa.localToGlobal(mesh.position.asArray(), [])
    }, [CX + 2, PY + 1, CZ])
    // A north-facing board's front face is at z = 8 - 2/3 px; vanilla's
    // TEXT_OFFSET puts the glyphs 0.046666667 blocks from the block centre.
    expect(pos[2] - CZ).toBeCloseTo(0.5 - 0.046666667, 5)
    expect(pos[1] - (PY + 1)).toBeCloseTo(0.5 + 0.33333334, 5)
  })

  test('the text goes when the sign goes', async ({ page }) => {
    await signRoom(page)
    await setBlock(page, SIGN.north, CX + 3, PY + 1, CZ)
    await setText(page, CX + 3, PY + 1, CZ, ['GONE'])
    await waitTicks(page, 2)
    expect(await textMesh(page, CX + 3, PY + 1, CZ)).not.toBeNull()
    await setBlock(page, ID.air, CX + 3, PY + 1, CZ)
    await waitTicks(page, 2)
    expect(await textMesh(page, CX + 3, PY + 1, CZ)).toBeNull()
  })

  test('a hundred signs cost one texture', async ({ page }) => {
    await signRoom(page, 6)
    /*
     * THE BUDGET FUTURE.md SAID NOBODY HAD COUNTED. A canvas per sign at
     * nametag.js's 8x supersample is 899 KB each; a hundred of them is 88 MB
     * of texture memory. The shared glyph atlas makes the answer ONE texture
     * whatever the count, and this is the assertion that would fail the day
     * somebody "simplifies" it back to a DynamicTexture per sign.
     */
    const lines = ['Stage 7', 'Patronus AI', 'RL environments', '2026']
    /*
     * A BASELINE FIRST, in the same room, on the same frame budget. An
     * absolute fps floor under swiftshader measures the CPU rasteriser, not
     * the signs -- this world renders around three frames a second in CI with
     * nothing in it. The only honest question is what the hundred signs ADD,
     * so it is asked as a ratio.
     */
    const before = await measureFps(page, 1500)
    await page.evaluate(([cx, cz, y, id, text]) => {
      for (let i = 0; i < 100; i++) {
        const x = cx - 5 + (i % 10), z = cz - 5 + Math.floor(i / 10)
        window.noa.setBlock(id, x, y, z)
        window.game.signs.setSignText(x, y, z, text)
      }
    }, [CX, CZ, PY + 1, SIGN.north, lines])
    await waitTicks(page, 4)

    const s = await stats(page)
    expect(s.signs, 'a hundred signs really are in the world').toBe(100)
    expect(s.textures).toBe(1)
    // 768 x 432 RGBA, once, for the whole world.
    expect(s.atlasBytes).toBe(768 * 432 * 4)
    // 4 lines of at most 15 characters, four vertices each, per sign.
    expect(s.vertices).toBeGreaterThan(100 * 4)
    expect(s.vertices).toBeLessThan(100 * 60 * 4 + 1)

    const after = await measureFps(page, 1500)
    console.log(`  a hundred signs: ${JSON.stringify(s)}`)
    console.log(`  fps ${before.toFixed(2)} -> ${after.toFixed(2)} `
      + `(${(100 * (1 - after / before)).toFixed(1)}% slower)`)
    // Half the frame rate is the line. A hundred meshes of a few hundred
    // vertices each, all sharing one material, should be nowhere near it --
    // and a regression that gave every sign its own texture would be.
    expect(before).toBeGreaterThan(0)
    expect(after).toBeGreaterThan(before * 0.5)
  })
})

/* ------------------------------------------------------------------ *
 * 3. Evidence. Read these, do not trust this file about them.
 * ------------------------------------------------------------------ */

test.describe('what a sign looks like', () => {
  test('photographs, close up and from ten blocks', async ({ page }) => {
    await signRoom(page, ROOM)
    const lines = ['Stage 7', 'Patronus AI', 'RL environments', '2026']

    // A standing sign facing south, so a player standing to its south reads
    // it -- which is where the camera goes.
    await setBlock(page, SIGN.south, CX, PY + 1, CZ)
    await setText(page, CX, PY + 1, CZ, lines)
    /*
     * A wall sign on the +x face of the -x wall, pointing west (+x here), and
     * it has to be the cell immediately NEXT to the wall -- the room is eight
     * blocks to a side, so the wall is at CX - 8 and a sign at CX - 5 hangs on
     * nothing. The first run of this shot photographed an empty wall for
     * exactly that reason: installAttachment had already dropped it.
     */
    const WALL_X = CX - ROOM + 1
    await setBlock(page, WALL_SIGN.west, WALL_X, PY + 2, CZ)
    await setText(page, WALL_X, PY + 2, CZ, ['Omaha', 'Nebraska', '2001', 'LEFT'])
    await waitTicks(page, 6)
    await waitFrames(page, 3)

    /*
     * STAND ON THE FLOOR, not 1.3 blocks above it. The first version of these
     * shots put the camera at the sign's own height and the eye ends up 0.8
     * blocks ABOVE the board -- at a block and a half away that is 26 degrees
     * down, and the sign photographed as a strip of wood behind the hotbar.
     * A visitor is a player standing up, so the camera is too.
     */
    await teleport(page, CX + 0.5, PY + 1, CZ + 2.2)
    await look(page, { heading: HEADING.northMinusZ, pitch: 0.34 })
    await waitFrames(page, 3)
    await shot(page, 'sign-standing-close')

    await teleport(page, CX + 0.5, PY + 1, CZ + 10)
    await look(page, { heading: HEADING.northMinusZ, pitch: 0.08 })
    await waitFrames(page, 3)
    await shot(page, 'sign-standing-far')

    await teleport(page, WALL_X + 1.5, PY + 1, CZ + 0.5)
    await look(page, { heading: HEADING.eastMinusX, pitch: 0.02 })
    await waitFrames(page, 3)
    await shot(page, 'sign-wall-close')

    await teleport(page, WALL_X + 10, PY + 1, CZ + 0.5)
    await look(page, { heading: HEADING.eastMinusX, pitch: 0.02 })
    await waitFrames(page, 3)
    await shot(page, 'sign-wall-far')
  })

  test('photographs in the dark, because black ink on dark wood is the risk',
    async ({ page }) => {
      /*
       * docs/builds/README.md, learned the hard way by three builds: block
       * light stops dead at a solid block, and Harvard photographed every
       * unlit sign as grey. A sign's BOARD is a block and dims with the room;
       * its TEXT is our own unlit mesh and does not. Vanilla's default ink is
       * black, so an unlit sign is black on near-black -- which is vanilla's
       * behaviour too, and is why glow ink exists.
       *
       * Both are photographed rather than argued about.
       */
      await signRoom(page, 6)
      /*
       * A SEALED BOX, not a roof. The first version of this shot put a 7x7 lid
       * over the room and photographed a sign in full daylight: sky light
       * pours in from every open side, and a lid with no walls under it stops
       * nothing. Six faces or it is not dark.
       */
      await page.evaluate(([cx, cz, y, stone, air]) => {
        const R = 3, H = 4
        for (let dx = -R; dx <= R; dx++) {
          for (let dz = -R; dz <= R; dz++) {
            for (let dy = 1; dy <= H; dy++) {
              const edge = Math.abs(dx) === R || Math.abs(dz) === R || dy === H
              window.noa.setBlock(edge ? stone : air, cx + dx, y + dy, cz + dz)
            }
          }
        }
      }, [CX, CZ, PY, ID.stone, ID.air])
      await waitTicks(page, 8)
      await setBlock(page, SIGN.south, CX, PY + 1, CZ)
      await setText(page, CX, PY + 1, CZ, ['UNLIT', 'BLACK INK', 'ON DARK WOOD', 'READ THIS'])
      await waitTicks(page, 8)
      await teleport(page, CX + 0.5, PY + 1, CZ + 2.2)
      await look(page, { heading: HEADING.northMinusZ, pitch: 0.34 })
      await waitFrames(page, 3)
      await shot(page, 'sign-dark')

      // ...and the same sign with a torch beside it, which is the fix a build
      // is expected to apply.
      await setBlock(page, 655, CX + 1, PY + 1, CZ)
      await waitTicks(page, 8)
      await waitFrames(page, 3)
      await shot(page, 'sign-lit')
    })
})
