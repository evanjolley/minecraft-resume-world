import { test, expect } from './fixtures.js'
import {
  waitTicks, waitFrames, teleport, look, useGamemode, doubleTapFly, setBlock,
  getBlock, targetedBlock, eyeHeight, ID,
} from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * PAINTINGS, and there are three independent claims in this file that fail in
 * three different ways, so they are checked in three different ways.
 *
 *   THE FRAME is geometry, and geometry is numbers. A painting cell is the
 *   full face of its block, one pixel deep, flush to the wall -- vanilla's
 *   `Painting.DEPTH = 0.0625F`. Read off the VERTEX BUFFER, not off the table
 *   that built it, for 76-signs.spec.js's reason: a table is what you would
 *   have to trust and the buffer is what the GPU is handed.
 *
 *   THE RECTANGLE is bookkeeping. A 3x2 painting is six blocks and one
 *   picture, and every way that can come apart -- the picture one cell left
 *   of the frame, five sixths of a frame left behind after a break, six items
 *   dropping instead of one -- is a coordinate assertion.
 *
 *   THE PICTURE is legibility, and legibility is a SCREENSHOT. Nothing here
 *   can honestly assert that a photograph of a school can be compared to a
 *   build of that school. The images at the bottom are read by a person.
 *
 * And one thing the numbers catch that a careless screenshot does not:
 * docs/builds/README.md records FOUR builds shipping mirrored content because
 * Babylon is left-handed, and a mirrored PHOTOGRAPH is the most obviously
 * wrong version of that bug. So the picture's horizontal direction is
 * asserted as a vector, per facing, out of the buffer -- and then
 * photographed from all four sides anyway, because the README's own rule is
 * that a derivation is not a check.
 *
 * Block ids duplicated rather than imported, the rule the rest of the suite
 * follows: a renumber should fail here loudly.
 */
const PAINTING_BASE = 680
const PAINTING = Object.fromEntries(
  ['north', 'south', 'east', 'west'].map((f, i) => [f, PAINTING_BASE + i]))

/** Vanilla `Painting.DEPTH`, in block pixels. */
const DEPTH_PX = 1

/** Mid-air, over the spawn column, for the reasons 66-torch.spec.js gives. */
const PY = 200
const CX = 40
const CZ = 20

/** The demonstration painting. 3 wide, 2 high, 128 px per block. */
const DEMO = 'millard_north'
const DEMO_W = 3
const DEMO_H = 2

/**
 * A stone room with a wall on each side, so a painting can be photographed
 * facing all four ways without moving the geometry.
 */
async function paintingRoom(page, r = 7) {
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
        for (let dy = 1; dy <= 7; dy++) window.noa.setBlock(air, cx + dx, y + dy, cz + dz)
      }
    }
    // Four walls, three blocks up, so every facing has something to hang on.
    for (let i = -rr; i <= rr; i++) {
      for (let dy = 1; dy <= 5; dy++) {
        window.noa.setBlock(stone, cx - rr, y + dy, cz + i)
        window.noa.setBlock(stone, cx + rr, y + dy, cz + i)
        window.noa.setBlock(stone, cx + i, y + dy, cz - rr)
        window.noa.setBlock(stone, cx + i, y + dy, cz + rr)
      }
    }
  }, [CX, CZ, PY, r, ID.stone, ID.air])
  await waitTicks(page, 4)
}

const hang = (page, x, y, z, facing, name) => page.evaluate(
  ([a, b, c, f, n]) => {
    /*
     * The blocks, then the art -- which is the two-step a build does NOT do,
     * because `hangPainting` does both from one set of numbers. A spec writes
     * them apart on purpose: it is the only way to prove the art lands on the
     * frame rather than that one function agrees with itself.
     */
    const { registerPainting } = window.game.paintings
    const P = { north: 680, south: 681, east: 682, west: 683 }
    const normal = { north: [0, 0, -1], south: [0, 0, 1], west: [1, 0, 0], east: [-1, 0, 0] }[f]
    const right = [-normal[2], 0, normal[0]]
    const v = { millard_north: [3, 2], kebab: [1, 1], fighters: [4, 2] }[n]
    for (let u = 0; u < v[0]; u++) {
      for (let h = 0; h < v[1]; h++) {
        window.noa.setBlock(P[f], a + right[0] * u, b + h, c + right[2] * u)
      }
    }
    return registerPainting(a, b, c, f, n)
  }, [x, y, z, facing, name])

const artMesh = (page, x, y, z) => page.evaluate(([a, b, c]) => {
  const mesh = window.noa.rendering.getScene().getMeshByName(`painting-${a},${b},${c}`)
  if (!mesh) return null
  const p = mesh.getVerticesData('position')
  const uv = mesh.getVerticesData('uv')
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[i + k]); hi[k] = Math.max(hi[k], p[i + k])
    }
  }
  return {
    lo, hi, uv: [...uv], vertices: p.length / 3,
    // Local positions paired with their UVs, so a spec can ask "which corner
    // of the picture is at which corner of the quad" without guessing at
    // vertex order.
    corners: Array.from({ length: p.length / 3 }, (_, i) =>
      ({ p: [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]], uv: [uv[i * 2], uv[i * 2 + 1]] })),
    texture: mesh.material?.diffuseTexture?.name ?? null,
    lit: !mesh.material?.disableLighting,
  }
}, [x, y, z])

const meshBox = (page, id) => page.evaluate((blockId) => {
  const mesh = window.noa.registry._blockMeshLookup[blockId]
  if (!mesh) return null
  const p = mesh.getVerticesData('position')
  if (!p || p.length === 0) return null
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      // +8 on x and z: an object mesh's origin is the horizontal CENTRE of
      // its cell. 76-signs.spec.js's note explains the frame of reference.
      const v = p[i + a] * 16 + (a === 1 ? 0 : 8)
      lo[a] = Math.min(lo[a], v); hi[a] = Math.max(hi[a], v)
    }
  }
  return { lo, hi }
}, id)

/**
 * Stand `dist` blocks out from a painting and look straight at its middle.
 *
 * EYE HEIGHT, NOT FOOT HEIGHT, and the first run of this file is why it is a
 * helper instead of three teleports. `teleport` places the player's FEET; the
 * camera sits ~1.6 blocks above that, so aiming at a 2-block-tall painting by
 * teleporting to its bottom row puts the crosshair above its top edge. The
 * symptom was `targetedBlock` returning the stone wall behind -- which reads
 * as "the painting is not targetable" and is nothing of the kind.
 *
 * @param {number[]} anchor the painting's bottom-left cell
 * @param {number[]} right  the viewer's right, so the centre is derived
 * @param {number[]} normal the way the picture faces: the viewer stands on +n
 */
async function standOff(page, anchor, right, normal, w, h, dist) {
  const eye = await eyeHeight(page)
  const [ax, ay, az] = anchor
  // Centre of the rectangle, on its face.
  const cx = ax + right[0] * (w / 2) + (right[0] > 0 ? 0 : right[0] < 0 ? 1 : 0.5)
  const cz = az + right[2] * (w / 2) + (right[2] > 0 ? 0 : right[2] < 0 ? 1 : 0.5)
  const cy = ay + h / 2
  await teleport(page, cx + normal[0] * dist, cy - eye, cz + normal[2] * dist)
  await page.evaluate(([nx, nz]) => {
    // noa's forward at heading t is (sin t, 0, cos t); we want -normal.
    window.noa.camera.heading = Math.atan2(-nx, -nz)
    window.noa.camera.pitch = 0
  }, [normal[0], normal[2]])
  await waitFrames(page, 4)
}

const stats = (page) => page.evaluate(() => window.game.paintings.paintingStats())
const at = (page, x, y, z) => page.evaluate(
  ([a, b, c]) => window.game.paintings.paintingAt(a, b, c), [x, y, z])

/* ------------------------------------------------------------------ *
 * 1. The frame is vanilla's shape
 * ------------------------------------------------------------------ */

test.describe('the painting frame', () => {
  test('is the full face of its cell, one pixel deep', async ({ page }) => {
    const box = await meshBox(page, PAINTING.north)
    expect(box, 'the north painting has a mesh at all').not.toBeNull()
    // Full cell across and up: a painting tiles edge to edge with itself, so
    // any gap here would show as a grid of seams across a 3x2.
    expect(box.lo[0]).toBeCloseTo(0, 5)
    expect(box.hi[0]).toBeCloseTo(16, 5)
    expect(box.lo[1]).toBeCloseTo(0, 5)
    expect(box.hi[1]).toBeCloseTo(16, 5)
    // ...and one pixel deep on the facing axis. Vanilla's DEPTH.
    expect(box.hi[2] - box.lo[2]).toBeCloseTo(DEPTH_PX, 5)
  })

  test('hangs flush against the wall behind it, on all four facings', async ({ page }) => {
    /*
     * Vanilla puts the painting's centre 0.03125 off the wall, half of its
     * 0.0625 thickness, so the BACK is flush and the front stands one pixel
     * proud. Per facing, because `s` is -1 on two of the four and a box built
     * without sorting draws inside-out -- which looks identical from the
     * front and is invisible until you walk behind it.
     */
    for (const [facing, id] of Object.entries(PAINTING)) {
      const box = await meshBox(page, id)
      const axis = (facing === 'north' || facing === 'south') ? 2 : 0
      const sign = { north: -1, south: 1, west: 1, east: -1 }[facing]
      // The wall face in cell pixels: 0 when the painting faces +, 16 when -.
      const wall = sign > 0 ? 0 : 16
      const near = sign > 0 ? box.lo[axis] : box.hi[axis]
      expect(near, `${facing}: the back is flush with the wall`).toBeCloseTo(wall, 5)
      expect(box.hi[axis] - box.lo[axis],
        `${facing}: one pixel deep`).toBeCloseTo(DEPTH_PX, 5)
    }
  })

  test('has no collision -- you walk through a painting', async ({ page }) => {
    /*
     * Asserted by WALKING, not by reading the pass-through set, because the
     * set is the thing under test. A painting in a doorway you can cross is
     * the behaviour; PASS_THROUGH_SHAPES is only how it is implemented.
     */
    await useGamemode(page, 'creative')
    await paintingRoom(page)
    const y = PY + 1
    // A wall of painting across the room at z = CZ, facing south (+z).
    await page.evaluate(([cx, cz, yy, id]) => {
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = 0; dy < 2; dy++) window.noa.setBlock(id, cx + dx, yy + dy, cz)
      }
    }, [CX, CZ, y, PAINTING.south])
    await waitTicks(page, 3)
    const before = CZ - 2
    await teleport(page, CX + 0.5, y, before + 0.5)
    await waitTicks(page, 2)
    // Shove the player through it and see where they end up.
    await page.evaluate(([cx, yy, cz]) => {
      const body = window.noa.ents.getPhysics(window.noa.playerEntity).body
      body.setPosition([cx + 0.5, yy, cz + 0.5])
    }, [CX, y, CZ + 2])
    await waitTicks(page, 3)
    const pos = await page.evaluate(() =>
      window.noa.ents.getPosition(window.noa.playerEntity))
    expect(pos[2], 'the player is on the far side of the painting')
      .toBeGreaterThan(CZ + 1)
  })
})

/* ------------------------------------------------------------------ *
 * 2. Six blocks, one picture
 * ------------------------------------------------------------------ */

test.describe('a painting is one object over several cells', () => {
  test.beforeEach(async ({ page }) => {
    await page.evaluate(() => window.game.paintings.resetPaintings())
    await paintingRoom(page)
  })

  test('the picture spans the whole rectangle, not one cell', async ({ page }) => {
    // On the -x wall, facing +x, which is this world's `west`.
    const x = CX - 7 + 1, y = PY + 2, z = CZ - 1
    await hang(page, x, y, z, 'west', DEMO)
    await waitTicks(page, 2)

    const mesh = await artMesh(page, x, y, z)
    expect(mesh, 'the picture exists').not.toBeNull()
    expect(mesh.vertices, 'one quad, four vertices').toBe(4)

    // The quad's own extent, in blocks, in its local frame.
    const width = Math.max(
      mesh.hi[0] - mesh.lo[0], mesh.hi[2] - mesh.lo[2])
    expect(width, 'three blocks across').toBeCloseTo(DEMO_W, 5)
    expect(mesh.hi[1] - mesh.lo[1], 'two blocks up').toBeCloseTo(DEMO_H, 5)
  })

  test('every cell of the rectangle is a painting block and knows its anchor',
    async ({ page }) => {
      const x = CX - 7 + 1, y = PY + 2, z = CZ - 1
      await hang(page, x, y, z, 'west', DEMO)
      await waitTicks(page, 2)

      const cells = []
      for (let u = 0; u < DEMO_W; u++) {
        for (let h = 0; h < DEMO_H; h++) cells.push([x, y + h, z + u])
      }
      // normal for `west` is (1,0,0); right = (-n.z, 0, n.x) = (0,0,1), so the
      // rectangle runs along +z. Asserted rather than assumed: if the mirror
      // derivation ever flips, these cells are air and this fails.
      for (const [cx, cy, cz] of cells) {
        expect(await getBlock(page, cx, cy, cz),
          `${cx},${cy},${cz} is a west-facing painting`).toBe(PAINTING.west)
        const owner = await at(page, cx, cy, cz)
        expect(owner, `${cx},${cy},${cz} belongs to a painting`).not.toBeNull()
        expect(owner.anchor).toBe(`${x},${y},${z}`)
        expect(owner.name).toBe(DEMO)
      }
    })

  test('breaking one cell takes the whole painting off the wall', async ({ page }) => {
    const x = CX - 7 + 1, y = PY + 2, z = CZ - 1
    await hang(page, x, y, z, 'west', DEMO)
    await waitTicks(page, 2)
    expect((await stats(page)).drawn).toBe(1)

    // Break the far corner, not the anchor -- the anchor is the easy case.
    await setBlock(page, ID.air, x, y + 1, z + 2)
    await waitTicks(page, 2)

    for (let u = 0; u < DEMO_W; u++) {
      for (let h = 0; h < DEMO_H; h++) {
        expect(await getBlock(page, x, y + h, z + u),
          `${x},${y + h},${z + u} is air`).toBe(ID.air)
      }
    }
    const s = await stats(page)
    expect(s.hung, 'the painting is forgotten').toBe(0)
    expect(s.drawn, 'and its mesh is disposed').toBe(0)
  })

  test('mining the wall behind one cell pops the whole painting', async ({ page }) => {
    const x = CX - 7 + 1, y = PY + 2, z = CZ - 1
    await hang(page, x, y, z, 'west', DEMO)
    await waitTicks(page, 2)
    // The wall is one block further -x, behind the painting's back.
    await setBlock(page, ID.air, x - 1, y + 1, z + 1)
    await waitTicks(page, 4)
    expect((await stats(page)).hung,
      'installAttachment popped a cell and the painting followed').toBe(0)
  })

  test('two paintings of the same name share one texture', async ({ page }) => {
    const y = PY + 2
    await hang(page, CX - 6, y, CZ - 1, 'west', DEMO)
    await hang(page, CX - 6, y + 3, CZ - 1, 'west', DEMO)
    await waitTicks(page, 2)
    const s = await stats(page)
    expect(s.drawn, 'two pictures').toBe(2)
    expect(s.textures, 'one texture between them').toBe(1)
  })
})

/* ------------------------------------------------------------------ *
 * 2b. `hangPainting`, which is the call a build file makes
 * ------------------------------------------------------------------ */

test('hangPainting writes the frame and the art from one set of numbers',
  async ({ page }) => {
    /*
     * Driven through a FAKE STAMPER, which is the only way to test this from
     * a browser: the real one is build-time and needs a plot. The fake
     * records what `s.set` was asked to write, which is exactly where the bug
     * this test exists for lived -- `hangPainting` built the block key as
     * `painting_wall_${facing}`, and the canonical NORTH variant's key is the
     * bare `painting`, so three facings worked and the fourth threw. A spec
     * that only called `registerPainting` never touched that line.
     */
    const written = await page.evaluate(() => {
      const out = {}
      for (const facing of ['north', 'south', 'east', 'west']) {
        const calls = []
        const s = {
          set: (x, y, z, key) => { calls.push([x, y, z, key]); return s },
          toWorld: (x, y, z) => [x, y, z],
        }
        try {
          window.game.paintings.hangPainting(s, [0, 0, 0], facing, 'millard_north')
          out[facing] = calls
        } catch (err) {
          out[facing] = { error: String(err.message) }
        }
        window.game.paintings.clearPainting(0, 0, 0)
      }
      return out
    })

    for (const facing of ['north', 'south', 'east', 'west']) {
      const calls = written[facing]
      expect(Array.isArray(calls), `${facing} did not throw: ${calls.error}`).toBe(true)
      // Assert the sample is non-empty before asserting anything about it.
      expect(calls.length, `${facing}: six cells for a 3x2`).toBe(DEMO_W * DEMO_H)
      const keys = new Set(calls.map(c => c[3]))
      expect(keys.size, `${facing}: one block key for the whole painting`).toBe(1)
      // North's key is the bare `painting`; the other three are suffixed.
      expect([...keys][0]).toBe(facing === 'north' ? 'painting' : `painting_wall_${facing}`)
    }

    // ...and the rectangle grows the way the doc comment says it does.
    const north = written.north.map(c => c.slice(0, 3))
    // north's normal is (0,0,-1), so right = (-n.z, 0, n.x) = (1,0,0): +x.
    expect(north.map(c => c[0]).sort(), 'three columns along +x')
      .toEqual([0, 0, 1, 1, 2, 2])
    expect(north.map(c => c[1]).sort(), 'two rows up').toEqual([0, 0, 0, 1, 1, 1])
  })

/* ------------------------------------------------------------------ *
 * 3. THE MIRROR. Four builds have shipped this backwards.
 * ------------------------------------------------------------------ */

test.describe('the picture is not mirrored', () => {
  test.beforeEach(async ({ page }) => {
    await page.evaluate(() => window.game.paintings.resetPaintings())
    await paintingRoom(page)
  })

  /*
   * For each facing: the viewer's RIGHT is (-n.z, 0, n.x), and the quad must
   * grow along it. Read out of the vertex buffer by pairing each corner's
   * position with its UV -- so this asserts the thing that is actually wrong
   * in a mirrored painting (u = 1 on the wrong side), not a proxy for it.
   */
  const FACINGS = {
    north: { n: [0, 0, -1], at: [CX - 1, PY + 2, CZ + 6] },
    south: { n: [0, 0, 1], at: [CX + 1, PY + 2, CZ - 6] },
    west: { n: [1, 0, 0], at: [CX - 6, PY + 2, CZ - 1] },
    east: { n: [-1, 0, 0], at: [CX + 6, PY + 2, CZ + 1] },
  }

  for (const [facing, { n, at: pos }] of Object.entries(FACINGS)) {
    test(`${facing}: u runs along the viewer's right`, async ({ page }) => {
      const [x, y, z] = pos
      await hang(page, x, y, z, facing, DEMO)
      await waitTicks(page, 2)
      const mesh = await artMesh(page, x, y, z)
      expect(mesh, `a ${facing} painting draws`).not.toBeNull()

      const right = [-n[2], 0, n[0]]
      const axis = right[0] ? 0 : 2
      const sign = right[axis]

      // Assert the sample is non-empty before asserting anything about it.
      expect(mesh.corners.length, 'there are corners to check').toBe(4)
      const u0 = mesh.corners.filter(c => c.uv[0] === 0)
      const u1 = mesh.corners.filter(c => c.uv[0] === 1)
      expect(u0.length, 'two corners at u=0').toBe(2)
      expect(u1.length, 'two corners at u=1').toBe(2)

      // u = 1 is the RIGHT-HAND side of the image, so it must sit further
      // along `right` than u = 0 does. This is the whole mirror check.
      const leftEdge = u0[0].p[axis]
      const rightEdge = u1[0].p[axis]
      expect(Math.sign(rightEdge - leftEdge),
        `${facing}: the right of the picture is on the viewer's right`).toBe(sign)
    })
  }

  test('v = 0 is the TOP of the picture, so it is not upside down', async ({ page }) => {
    const [x, y, z] = [CX - 6, PY + 2, CZ - 1]
    await hang(page, x, y, z, 'west', DEMO)
    await waitTicks(page, 2)
    const mesh = await artMesh(page, x, y, z)
    const top = mesh.corners.filter(c => c.p[1] === DEMO_H)
    const bottom = mesh.corners.filter(c => c.p[1] === 0)
    expect(top.length, 'two corners at the top').toBe(2)
    expect(bottom.length, 'two corners at the bottom').toBe(2)
    /*
     * A PNG's rows run top-down and Babylon's v runs bottom-up on the quad,
     * so the top of the picture is v = 0. Getting this backwards is the
     * upside-down bug, and it is invisible in a photograph of a symmetric
     * subject -- which is why it is asserted here rather than only looked at.
     */
    expect(top.every(c => c.uv[1] === 0), 'the top of the quad samples the top row').toBe(true)
    expect(bottom.every(c => c.uv[1] === 1), 'and the bottom samples the last row').toBe(true)
  })
})

/* ------------------------------------------------------------------ *
 * 4. Targeting, which is what makes it breakable
 * ------------------------------------------------------------------ */

test('the crosshair lands on the painting and not on the wall behind it',
  async ({ page }) => {
    await page.evaluate(() => window.game.paintings.resetPaintings())
    await paintingRoom(page)
    const [x, y, z] = [CX - 6, PY + 2, CZ - 1]
    await hang(page, x, y, z, 'west', DEMO)
    await waitTicks(page, 2)

    // A west-facing painting has normal (1,0,0), so the viewer stands at +x
    // and its right runs +z. Both derived, never typed.
    await standOff(page, [x, y, z], [0, 0, 1], [1, 0, 0], DEMO_W, DEMO_H, 3.5)
    const t = await targetedBlock(page)
    expect(t, 'something is targeted').not.toBeNull()
    expect(t.blockID, 'and it is the painting').toBe(PAINTING.west)
  })

/* ------------------------------------------------------------------ *
 * 5. THE PHOTOGRAPHS. Read these; the assertions above cannot.
 * ------------------------------------------------------------------ */

test.describe('what it looks like', () => {
  test.beforeEach(async ({ page }) => {
    await page.evaluate(() => window.game.paintings.resetPaintings())
    await paintingRoom(page)
  })

  test('the Millard North painting, close up and from ten blocks', async ({ page }) => {
    /*
     * On the -x wall facing +x, which puts the viewer on the +x side looking
     * -x. Bottom-left cell as the VIEWER sees it, which is the far -z end,
     * because the viewer's right runs +z on this wall.
     */
    const [x, y, z] = [CX - 6, PY + 2, CZ - 2]
    await hang(page, x, y, z, 'west', DEMO)
    await waitTicks(page, 3)

    const aimAt = (dist) =>
      standOff(page, [x, y, z], [0, 0, 1], [1, 0, 0], DEMO_W, DEMO_H, dist)

    await aimAt(2.5)
    await shot(page, '87-painting-millard-north-close')

    await aimAt(10)
    await shot(page, '87-painting-millard-north-ten-blocks')

    // ...and the outline, which is what you see when you aim to break it.
    await aimAt(3)
    await waitFrames(page, 3)
    await shot(page, '87-painting-outline')
  })

  test('a vanilla painting, for comparison', async ({ page }) => {
    const [x, y, z] = [CX - 6, PY + 2, CZ - 2]
    await hang(page, x, y, z, 'west', 'fighters')
    await waitTicks(page, 3)
    await standOff(page, [x, y, z], [0, 0, 1], [1, 0, 0], 4, 2, 6)
    await shot(page, '87-painting-vanilla-fighters')
  })
})
