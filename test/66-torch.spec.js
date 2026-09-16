import { test, expect } from './fixtures.js'
import {
  waitTicks, waitFrames, teleport, look, useGamemode, doubleTapFly, setBlock,
  getBlock, ID, HEADING,
} from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * TORCHES.
 *
 * docs/REPORTED.md 3, reported twice from play: a torch in the hotbar that
 * places nothing. It is five block ids now -- floor plus four walls -- and
 * four separate obstacles stood between it and existing. This file is the
 * evidence for each of them, in the order they were solved:
 *
 *   1. no alpha        -> the cutout material. Measured as "the torch's
 *                         transparent margin does not draw as a black box".
 *   2. collision       -> the pass-through opt-out. Measured as "you can walk
 *                         through the cell a torch is in".
 *   3. the 22.5 tilt   -> measured off the VERTEX BUFFER, because a tilt is
 *                         the one thing here a screenshot cannot assert and a
 *                         human absolutely can see.
 *   4. attachment      -> mine the wall, the torch is gone and an item is on
 *                         the floor.
 *
 * And one thing that was supposed to come for free and had to be checked:
 * a torch is the first NON-CUBE emitter this engine has had, and the radial
 * falloff fix (0530c18) works by splitting the quads light reaches. Whether a
 * 2x2 post inherits that is a question about terrain quads, not about the
 * torch, and it is asked the same way 58-glowstone-radial.spec.js asks it.
 *
 * Block ids duplicated rather than imported, for the reason helpers/world.js
 * gives for duplicating the others: if someone renumbers them these tests
 * should fail loudly rather than quietly follow along.
 */
const TORCH = 655
const WALL_TORCH = { north: 656, south: 657, east: 658, west: 659 }

/** Mid-air, the same reasoning as 58's pad: nothing up here to destroy. */
const PY = 200
const CX = 40
const CZ = 20
const MIDNIGHT = 18000

/**
 * A stone floor with a stone wall on its -x side, and air everywhere else.
 *
 * The wall is what a wall torch hangs on, and the floor is what a floor torch
 * stands on. Both are stone because stone is solid, which is the only
 * property attachment asks about.
 */
async function torchRoom(page, r = 5) {
  /*
   * STAND IN THE ROOM BEFORE BUILDING IT, and this is not tidiness.
   *
   * `noa.setBlock` into a chunk that is not loaded is a silent no-op, and the
   * first version of this file built the room from wherever the player
   * happened to be standing after resetWorld. On chromium the chunks happened
   * to be there and every test passed; on webkit they were not and all six
   * failed at once, reading air where a torch had just been written. A test
   * that depends on which browser got a chunk in first is not a test.
   *
   * So: fly up to where the room is going, wait for the chunk to actually
   * exist, and only then write into it.
   */
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
        for (let dy = 1; dy <= 5; dy++) window.noa.setBlock(air, cx + dx, y + dy, cz + dz)
      }
    }
    // The wall, two blocks tall, running along z at the -x edge.
    for (let dz = -rr; dz <= rr; dz++) {
      for (let dy = 1; dy <= 2; dy++) window.noa.setBlock(stone, cx - rr, y + dy, cz + dz)
    }
  }, [CX, CZ, PY, r, ID.stone, ID.air])
  await waitTicks(page, 4)
}

const drained = (page) => page.waitForFunction(() => {
  const w = window.noa.world
  return w._chunksToMesh.count() + w._chunksToMeshFirst.count() === 0
}, null, { timeout: 15_000 })

/* ------------------------------------------------------------------ *
 * 3. The tilt, off the vertex buffer
 * ------------------------------------------------------------------ */

/**
 * The tilt of a wall torch, in degrees, read off its mesh's NORMALS.
 *
 * The first version of this measured the post's long axis from its extreme
 * vertices and read 11.19 degrees for a 22.5 degree torch. The reason is
 * worth keeping: once the box is turned, its eight corners no longer share a
 * top or a bottom face, so "the highest vertex" is one CORNER and "the
 * lowest" is the opposite corner. The vector between them is the box's
 * diagonal, not its axis, and a 2x10 box's diagonal sits at about half the
 * angle its axis does.
 *
 * Normals have no such problem. The cap of the post points straight along the
 * post, so the normal with the largest y IS the post's axis -- and its angle
 * from vertical is the tilt exactly, with no geometry to reason about.
 */
const tiltDegrees = (page, id) => page.evaluate((blockId) => {
  /*
   * `registry._blockMeshLookup` is noa's own id -> base mesh table, the one
   * objectMesher reads to decide which instance manager a voxel belongs to.
   * Going through it rather than searching the mesh list by name means this
   * measures the geometry the ENGINE would draw for that id -- a mesh built
   * correctly and registered against the wrong id would pass a by-name search
   * and fail here.
   */
  const mesh = window.noa.registry._blockMeshLookup[blockId]
  if (!mesh) return null
  const n = mesh.getVerticesData('normal')
  if (!n || n.length === 0) return null
  let best = null
  for (let i = 0; i < n.length; i += 3) {
    if (!best || n[i + 1] > best[1]) best = [n[i], n[i + 1], n[i + 2]]
  }
  const horizontal = Math.hypot(best[0], best[2])
  return {
    degrees: +((Math.atan2(horizontal, best[1]) * 180) / Math.PI).toFixed(2),
    // Which way it leans, as a direction in the floor plane.
    lean: [Math.round(best[0] / (horizontal || 1)), 0, Math.round(best[2] / (horizontal || 1))],
  }
}, id)

test('a wall torch leans 22.5 degrees, away from its wall, on all four facings', async ({ page, terrain }) => {
  await terrain.keep([CX - 6, PY - 1, CZ - 6], [CX + 6, PY + 6, CZ + 6])
  await torchRoom(page)
  // One of each facing, so all four base meshes exist to be measured.
  await page.evaluate(([cx, cz, y, ids]) => {
    window.noa.setBlock(ids.north, cx + 1, y + 1, cz + 1)
    window.noa.setBlock(ids.south, cx + 2, y + 1, cz + 1)
    window.noa.setBlock(ids.east, cx + 3, y + 1, cz + 1)
    window.noa.setBlock(ids.west, cx + 4, y + 1, cz + 1)
  }, [CX, CZ, PY, WALL_TORCH])
  await waitTicks(page, 6)
  await drained(page)

  /*
   * The facings, and the direction each one must lean.
   *
   * `facing` names the direction the torch POINTS, away from its wall --
   * vanilla's convention. This world's axes are not Minecraft's: east is -x
   * and west is +x (the FACINGS note in src/blockMeshes.js is the long
   * version), so these vectors are the ones this engine must produce and a
   * table copied from the wiki would be mirrored on two of the four.
   */
  const want = {
    wall_torch_north: [0, 0, -1],
    wall_torch_south: [0, 0, 1],
    wall_torch_east: [-1, 0, 0],
    wall_torch_west: [1, 0, 0],
  }

  const measured = {}
  for (const key of Object.keys(want)) {
    measured[key] = await tiltDegrees(page, WALL_TORCH[key.replace('wall_torch_', '')])
  }
  console.log('[tilt]', JSON.stringify(measured))

  // Non-empty first. A probe that found no meshes would pass every assertion
  // below vacuously, which is exactly how a probe lies.
  expect(Object.values(measured).filter(Boolean)).toHaveLength(4)

  for (const [key, lean] of Object.entries(want)) {
    // 22.5 is vanilla's, out of block/template_torch_wall.json. The tolerance
    // is float noise in a vertex buffer, not slack in the number.
    expect(measured[key].degrees).toBeCloseTo(22.5, 1)
    expect(measured[key].lean).toEqual(lean)
  }
})

/* ------------------------------------------------------------------ *
 * Placement: which of the five you get
 * ------------------------------------------------------------------ */

test('the face you click picks the torch, not the way you are looking', async ({ page, terrain }) => {
  await terrain.keep([CX - 6, PY - 1, CZ - 6], [CX + 6, PY + 6, CZ + 6])
  await torchRoom(page)

  /*
   * Driven through `noa.targetedBlock` the way 17-non-cube.spec.js drives the
   * stair orientation, because that is the field installPlacementOrientation
   * actually reads. A real right-click would be testing the mouse.
   *
   * The heading is deliberately wrong for every case: a stair takes its
   * facing from where the player is LOOKING, and if a torch did too, all four
   * of these would come back the same. Pointing the camera one way and
   * clicking faces the other way is what separates the two rules.
   */
  const placed = await page.evaluate(([cx, cz, y, torch, stone]) => {
    const noa = window.noa
    const out = {}
    const at = [cx, y + 1, cz]
    /*
     * A cell with something on all five sides, because the attachment rule is
     * live and takes an unsupported torch straight back off. The first
     * version of this test placed into open air three blocks up and read five
     * zeroes -- which is the rule working, not the resolver failing.
     */
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      noa.setBlock(stone, at[0] + dx, at[1], at[2] + dz)
    }
    noa.camera.heading = 0 // facing +z, "south" in this world
    /*
     * The clicked block's position, and the normal of the face that was hit.
     *
     * noa's normal points FROM the block you clicked TOWARD the empty cell
     * the new block goes in, so clicking the wall at -x gives [1, 0, 0] and
     * not [-1, 0, 0]. Written the wrong way round first, and the test read
     * 658 where it wanted 659 -- the engine was right and the fixture was
     * mirrored, which is exactly the failure this whole facing business
     * invites.
     */
    const cases = {
      floor: [[at[0], at[1] - 1, at[2]], [0, 1, 0]],
      wallAtMinusX: [[at[0] - 1, at[1], at[2]], [1, 0, 0]],
      wallAtPlusX: [[at[0] + 1, at[1], at[2]], [-1, 0, 0]],
      wallAtMinusZ: [[at[0], at[1], at[2] - 1], [0, 0, 1]],
      wallAtPlusZ: [[at[0], at[1], at[2] + 1], [0, 0, -1]],
    }
    for (const [name, [position, normal]] of Object.entries(cases)) {
      noa.targetedBlock = { position, normal, adjacent: at }
      noa._pickResult.position[1] = at[1] + 0.5
      noa.setBlock(torch, at[0], at[1], at[2])
      out[name] = noa.getBlock(at[0], at[1], at[2])
      noa.setBlock(0, at[0], at[1], at[2])
    }
    noa.targetedBlock = null
    return out
  }, [CX, CZ, PY, TORCH, ID.stone])

  console.log('[place]', JSON.stringify(placed))

  // A torch clicked onto a top face is a floor torch.
  expect(placed.floor).toBe(TORCH)
  /*
   * And onto a side face it is the wall torch pointing AWAY from that wall.
   * A wall at -x means the torch points +x, which this engine calls WEST --
   * the two x cases are the ones a table copied from the wiki gets backwards,
   * because east is -x here (see the FACINGS note in src/blockMeshes.js).
   */
  expect(placed.wallAtMinusX).toBe(WALL_TORCH.west)
  expect(placed.wallAtPlusX).toBe(WALL_TORCH.east)
  expect(placed.wallAtMinusZ).toBe(WALL_TORCH.south)
  expect(placed.wallAtPlusZ).toBe(WALL_TORCH.north)
})

/* ------------------------------------------------------------------ *
 * 2. Collision: you walk through a torch
 * ------------------------------------------------------------------ */

test('a torch does not stop you, and a slab in the same place does', async ({ page, terrain }) => {
  await terrain.keep([CX - 6, PY - 1, CZ - 6], [CX + 6, PY + 6, CZ + 6])
  await torchRoom(page)
  await useGamemode(page, 'survival')

  /*
   * The control is the point of this test. "Walked through it" on its own
   * proves nothing -- a test that never moved the player would also report
   * zero obstruction -- so the same walk is run twice over the same cell with
   * the only difference being which block is in it. An oak slab is the
   * nearest thing that DOES collide and that this file did not have to build.
   */
  /*
   * An oak slab's TOP half (id 357), not its bottom. A bottom slab is half a
   * block tall and the step height is 0.6, so a player walks straight up onto
   * one and over the cell -- which this test measured as "19.28, past the
   * torch" and would have reported as a passing control while proving
   * nothing. The top half has its underside at 0.5 and a 1.0 rise, which is
   * over the step height, so it is a wall.
   *
   * Still a non-cube, deliberately: it goes through the same registration,
   * the same shape table and the same resolver as a torch, so the ONLY
   * difference between the two walks is the pass-through opt-out.
   */
  const OAK_SLAB_TOP = 357

  const walkThrough = async (id) => {
    await page.evaluate(([cx, cz, y, blockId, air]) => {
      window.noa.setBlock(air, cx, y + 1, cz)
      window.noa.setBlock(blockId, cx, y + 1, cz)
    }, [CX, CZ, PY, id, ID.air])
    await waitTicks(page, 3)
    // Start two blocks back on +z, aimed at -z straight through the cell.
    await teleport(page, CX + 0.5, PY + 1, CZ + 2.5)
    await look(page, { heading: HEADING.northMinusZ, pitch: 0 })
    await waitTicks(page, 3)
    await page.keyboard.down('KeyW')
    await waitTicks(page, 22)
    await page.keyboard.up('KeyW')
    await waitTicks(page, 3)
    return page.evaluate(() =>
      window.noa.ents.getPositionData(window.noa.playerEntity).position[2])
  }

  const throughTorch = await walkThrough(TORCH)
  const throughSlab = await walkThrough(OAK_SLAB_TOP)
  console.log(`[collision] z after walking at a torch: ${throughTorch.toFixed(3)}`)
  console.log(`[collision] z after walking at a slab:  ${throughSlab.toFixed(3)}`)

  // Started at z = CZ + 2.5 walking toward -z. Past the torch's own cell
  // (z = CZ) means it did not stop him.
  expect(throughTorch).toBeLessThan(CZ - 0.2)
  // ...and the same walk into a slab is stopped before the cell. Without this
  // line the assertion above is satisfied by a player who never moved.
  expect(throughSlab).toBeGreaterThan(CZ + 0.5)
})

/* ------------------------------------------------------------------ *
 * 4. Attachment
 * ------------------------------------------------------------------ */

/** How many TORCH items are lying on the floor right now. */
const torchDrops = (page) => page.evaluate((id) =>
  window.game.drops.list.filter((d) => d.id === id).length, TORCH)

test('mine the wall and the wall torch pops as an item', async ({ page, terrain }) => {
  await terrain.keep([CX - 6, PY - 1, CZ - 6], [CX + 6, PY + 6, CZ + 6])
  await torchRoom(page)
  await useGamemode(page, 'survival')
  // Stand clear, so falling items and the player are not in each other's way.
  await teleport(page, CX + 2.5, PY + 1, CZ + 2.5)

  // The wall runs at x = CX - 5. A torch on its +x face points west (+x here).
  const WALL_X = CX - 5
  await setBlock(page, WALL_TORCH.west, WALL_X + 1, PY + 1, CZ)
  await waitTicks(page, 4)
  expect(await getBlock(page, WALL_X + 1, PY + 1, CZ)).toBe(WALL_TORCH.west)

  const before = await torchDrops(page)
  // Mine the wall out from under it, the same way the authority sees a break.
  await page.evaluate(([x, y, z]) => window.game.authority.requestBlockChange(
    { id: 0, position: [x, y, z], cause: 'break' }), [WALL_X, PY + 1, CZ])
  await waitTicks(page, 6)

  const after = await torchDrops(page)
  console.log(`[attach] torch items on the floor: before ${before}, after ${after}`)

  expect(await getBlock(page, WALL_X + 1, PY + 1, CZ)).toBe(ID.air)
  // It POPPED, it did not vanish. Counting TORCH items specifically rather
  // than drops in general, because the wall itself drops cobblestone and a
  // total would be satisfied by the wrong item.
  expect(before).toBe(0)
  expect(after).toBe(1)
})

test('a floor torch pops when the block under it goes', async ({ page, terrain }) => {
  await terrain.keep([CX - 6, PY - 1, CZ - 6], [CX + 6, PY + 6, CZ + 6])
  await torchRoom(page)
  await useGamemode(page, 'survival')
  await teleport(page, CX + 2.5, PY + 1, CZ + 2.5)

  await setBlock(page, TORCH, CX, PY + 1, CZ)
  await waitTicks(page, 4)
  expect(await getBlock(page, CX, PY + 1, CZ)).toBe(TORCH)

  await page.evaluate(([x, y, z]) => window.game.authority.requestBlockChange(
    { id: 0, position: [x, y, z], cause: 'break' }), [CX, PY, CZ])
  await waitTicks(page, 6)
  expect(await getBlock(page, CX, PY + 1, CZ)).toBe(ID.air)
})

/* ------------------------------------------------------------------ *
 * The thing that was supposed to be free: radial light off a non-cube
 * ------------------------------------------------------------------ */

/**
 * Every up-facing terrain quad over the floor, with its four corner light
 * levels. Lifted from 58-glowstone-radial.spec.js, which is the file that
 * established this measurement -- the question here is whether a NON-CUBE
 * emitter feeds the same machinery, so it has to be the same number.
 */
const topQuads = (page) => page.evaluate(([cx, cz, r, py]) => {
  const world = window.noa.world
  const CS = world._chunkSize
  const cdiv = (v) => Math.floor(v / CS)
  const out = []
  for (let ci = cdiv(cx - r) - 1; ci <= cdiv(cx + r) + 1; ci++) {
    for (let cj = cdiv(py - 2); cj <= cdiv(py + 8); cj++) {
      for (let ck = cdiv(cz - r) - 1; ck <= cdiv(cz + r) + 1; ck++) {
        const chunk = world._storage.getChunkByIndexes(ci, cj, ck)
        if (!chunk || chunk.isDisposed || !chunk._terrainMeshes) continue
        for (const mesh of chunk._terrainMeshes) {
          const pos = mesh.getVerticesData('position')
          const norm = mesh.getVerticesData('normal')
          const col = mesh.getVerticesData('color')
          if (!pos || !norm || !col) continue
          for (let f = 0; f * 4 < pos.length / 3; f++) {
            const v = f * 4
            if (norm[v * 3 + 1] < 0.5) continue
            const corner = [0, 1, 2].map((a) => pos[v * 3 + a])
            const wv = [0, 1, 2].map((a) => pos[(v + 1) * 3 + a] - corner[a])
            const hv = [0, 1, 2].map((a) => pos[(v + 3) * 3 + a] - corner[a])
            const x = chunk.x + corner[0]
            const y = chunk.y + corner[1]
            const z = chunk.z + corner[2]
            if (y !== py + 1) continue
            if (x < cx - r - 1 || x > cx + r + 2) continue
            if (z < cz - r - 1 || z > cz + r + 2) continue
            out.push({
              x: x - cx,
              z: z - cz,
              w: Math.abs(wv[0]) + Math.abs(wv[1]) + Math.abs(wv[2]),
              h: Math.abs(hv[0]) + Math.abs(hv[1]) + Math.abs(hv[2]),
              light: [0, 1, 2, 3].map((q) => +((1 - col[(v + q) * 4 + 3]) * 15).toFixed(1)),
            })
          }
        }
      }
    }
  }
  return out
}, [CX, CZ, 5, PY])

test('a torch lights the floor around it, and the falloff is split per block', async ({ page, terrain }) => {
  await terrain.keep([CX - 6, PY - 1, CZ - 6], [CX + 6, PY + 6, CZ + 6])
  await torchRoom(page)
  await page.evaluate((t) => window.game.sky.setTime(t), MIDNIGHT)
  await setBlock(page, TORCH, CX, PY + 1, CZ)
  await waitTicks(page, 8)
  await drained(page)
  await waitTicks(page, 3)

  const quads = await topQuads(page)
  const lit = quads.filter((q) => q.light.some((l) => l > 0.05))
  const litSpan = lit.reduce((m, q) => Math.max(m, q.w, q.h), 0)
  console.log(`[light] up-facing quads: ${quads.length}, lit: ${lit.length}, widest lit quad: ${litSpan}`)
  console.log(`[light] brightest corner seen: ${Math.max(...quads.flatMap((q) => q.light))}`)

  // Non-empty, before anything is concluded from it.
  expect(quads.length).toBeGreaterThan(0)
  // A 14-level emitter on a floor lights a lot of floor.
  expect(lit.length).toBeGreaterThan(20)
  /*
   * THE INHERITED FIX. 0530c18 made a glowstone light a circle by splitting
   * the quads light reaches down to one block, so the GPU never interpolates
   * a light value across a 13-block span. A torch is the first NON-CUBE
   * emitter this engine has had, and nothing about that fix knows the
   * difference -- it keys on the light field, not on the emitter's shape.
   * This is the line that says so rather than assuming it.
   */
  expect(litSpan).toBe(1)
})

/* ------------------------------------------------------------------ *
 * 1. The cutout, and the pictures
 * ------------------------------------------------------------------ */

/** Mean channel values of a screenshot crop, 0..255. */
async function meanColour(page, clip) {
  const buf = await page.screenshot({ clip })
  return page.evaluate((url) => new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const d = ctx.getImageData(0, 0, c.width, c.height).data
      let r = 0, g = 0, b = 0
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2] }
      const n = d.length / 4
      resolve([r / n, g / n, b / n].map((v) => +v.toFixed(1)))
    }
    img.src = url
  }), `data:image/png;base64,${buf.toString('base64')}`)
}

test('the cutout material is on the torch and on nothing else', async ({ page }) => {
  /*
   * WHAT THE TRIAGE EXPECTED, AND WHAT IS ACTUALLY THERE.
   *
   * docs/REPORTED.md 3 called alpha the cheapest of the four obstacles: "a
   * torch is a 16x16 sprite that is mostly transparent, so it needs a cutout
   * material". That was written about the torch everybody remembers -- two
   * crossed full-cell planes, which really are 252 transparent pixels each.
   *
   * The modern model is one 2x2 post, and its faces sample columns 7..9 and
   * rows 6..16 of the sprite, which is EXACTLY the part with paint on it. A
   * torch drawn with a plain opaque material looks identical, and that is not
   * a guess: `cutout` was forced off and the picture was taken again, and the
   * torch came back a torch. Obstacle 1 dissolves on contact with the actual
   * model.
   *
   * So this test does not claim a pixel difference there is none of. It
   * asserts the thing that DOES matter about the cutout and is the reason it
   * was built as a capability of the cache rather than a torch's special
   * case: the torch has it, and the 280 slab and stair variants that share
   * the cache do NOT. Signs are the consumer that will need the pixels.
   */
  const flags = await page.evaluate(([torch, slab]) => {
    const look = (id) => {
      const mesh = window.noa.registry._blockMeshLookup[id]
      if (!mesh || !mesh.material) return null
      return {
        hasAlpha: !!mesh.material.diffuseTexture?.hasAlpha,
        backFaceCulling: mesh.material.backFaceCulling,
        material: mesh.material.name,
      }
    }
    return { torch: look(torch), slab: look(slab) }
  }, [TORCH, 356])

  console.log('[cutout]', JSON.stringify(flags))

  // Non-vacuous: both meshes have to exist before their flags mean anything.
  expect(flags.torch).not.toBeNull()
  expect(flags.slab).not.toBeNull()

  expect(flags.torch.hasAlpha).toBe(true)
  expect(flags.torch.backFaceCulling).toBe(false)
  // THE HALF THAT PROTECTS THE 280. An oak slab goes through the same cache
  // and must come back with the plain material, or the cutout flag leaked.
  expect(flags.slab.hasAlpha).toBe(false)
  expect(flags.slab.backFaceCulling).toBe(true)
  // ...and they are two different materials, which is what the cache key buys.
  expect(flags.torch.material).not.toBe(flags.slab.material)
})

test('five torches in a dark room, photographed', async ({ page, terrain }) => {
  await terrain.keep([CX - 6, PY - 1, CZ - 6], [CX + 6, PY + 6, CZ + 6])
  await torchRoom(page)
  await useGamemode(page, 'creative')
  await doubleTapFly(page)

  /*
   * A closed room with a torch on each of its four walls and one on the
   * floor, which is the only arrangement where all five ids can be
   * photographed at once -- a wall torch with no wall behind it does not
   * survive its own placement, and the first version of this shot got four
   * invisible torches and a note about it.
   *
   * Which id goes on which wall is the same rule as the placement test: the
   * torch points AWAY from the wall. The -x wall holds the one pointing +x,
   * and +x is west here.
   */
  const R = 5
  await page.evaluate(([cx, cz, y, r, stone, floorTorch, ids]) => {
    const noa = window.noa
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dy = 1; dy <= 4; dy++) {
          const edge = dx === -r || dx === r || dz === -r || dz === r
          noa.setBlock(edge || dy === 4 ? stone : 0, cx + dx, y + dy, cz + dz)
        }
      }
    }
    noa.setBlock(floorTorch, cx, y + 1, cz)
    noa.setBlock(ids.west, cx - r + 1, y + 2, cz)
    noa.setBlock(ids.east, cx + r - 1, y + 2, cz)
    noa.setBlock(ids.south, cx, y + 2, cz - r + 1)
    noa.setBlock(ids.north, cx, y + 2, cz + r - 1)
  }, [CX, CZ, PY, R, ID.stone, TORCH, WALL_TORCH])
  await waitTicks(page, 8)
  await drained(page)

  // Every one of the five survived, or the picture below is of the wrong
  // thing. Asserted rather than left to the eye, since it is free here.
  const standing = await page.evaluate(([cx, cz, y, r]) => [
    window.noa.getBlock(cx, y + 1, cz),
    window.noa.getBlock(cx - r + 1, y + 2, cz),
    window.noa.getBlock(cx + r - 1, y + 2, cz),
    window.noa.getBlock(cx, y + 2, cz - r + 1),
    window.noa.getBlock(cx, y + 2, cz + r - 1),
  ], [CX, CZ, PY, R])
  console.log(`[room] the five ids standing: ${standing.join(', ')}`)
  expect(standing).toEqual([
    TORCH, WALL_TORCH.west, WALL_TORCH.east, WALL_TORCH.south, WALL_TORCH.north,
  ])

  // A roofed room at midnight is a cave: the only light in these shots is
  // the torches' own.
  await page.evaluate((t) => window.game.sky.setTime(t), MIDNIGHT)
  await teleport(page, CX + 0.5, PY + 2, CZ + 3.2)
  await look(page, { heading: HEADING.northMinusZ, pitch: 0.1 })
  await waitFrames(page, 8)
  await shot(page, 'torch-cave-floor')

  // Turned to face the -x wall, which is where the west-pointing torch is.
  await teleport(page, CX + 2.5, PY + 2, CZ + 0.5)
  await look(page, { heading: HEADING.eastMinusX, pitch: 0.05 })
  await waitFrames(page, 8)
  await shot(page, 'torch-cave-wall')

  await teleport(page, CX + 0.5, PY + 3.4, CZ + 0.5)
  await look(page, { heading: HEADING.northMinusZ, pitch: 0.8 })
  await waitFrames(page, 8)
  await shot(page, 'torch-room-overview')

  /*
   * The one number in a test full of pictures: the torch is actually DRAWN
   * and actually LIT. Sample a crop aimed at the floor torch, then take the
   * torch away and sample the same crop. A torch that failed to mesh, or one
   * whose material never loaded, leaves those two equal.
   *
   * This was written as a cutout measurement and is not one -- see the test
   * above for why a torch looks the same either way.
   */
  /*
   * Aimed AT the floor torch from two blocks away and a little above, so the
   * crop below is mostly torch. Pointed at the wall instead first, and the
   * two crops came back identical to four figures -- which is a measurement
   * of the wall, not of the torch, and would have passed as easily with a
   * black box in the frame as without one.
   */
  await teleport(page, CX + 0.5, PY + 2, CZ + 2)
  await look(page, { heading: HEADING.northMinusZ, pitch: 0.6 })
  await waitFrames(page, 6)
  const { width, height } = page.viewportSize()
  const clip = { x: width / 2 - 60, y: height / 2 - 40, width: 120, height: 120 }
  const withTorch = await meanColour(page, clip)
  await setBlock(page, ID.air, CX, PY + 1, CZ)
  await waitTicks(page, 6)
  await drained(page)
  await waitFrames(page, 6)
  const without = await meanColour(page, clip)

  console.log(`[drawn] crop with torch ${withTorch.join('/')}, without ${without.join('/')}`)
  const mean = (c) => (c[0] + c[1] + c[2]) / 3
  // Non-vacuous: a crop of pure black in BOTH states would mean the camera is
  // pointed at nothing and the comparison below is meaningless.
  expect(mean(withTorch) + mean(without)).toBeGreaterThan(1)
  // Brighter with the torch than without, by a margin no dithering explains.
  expect(mean(withTorch)).toBeGreaterThan(mean(without) + 5)
})
