import { test, expect } from './fixtures.js'
import sharp from 'sharp'
import { teleport, look, waitFrames, waitTicks, useGamemode, HEADING, SURFACE_Y } from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * WATER AND LAVA IN THE DARK.
 *
 * 65-sky-light gave the world a roof: a sealed room at noon measured 0.0262
 * against the meadow's 0.3808 at the same instant of the same day. Every
 * surface obeyed it except two, and the author of that change said which and
 * why in src/blockLight.js's own comment: `src/fluidGeometry.js` rebuilds the
 * vertex buffers of any mesh containing a fluid face, at a larger vertex
 * count, and carried `texAtlasIndices` across without carrying `noaSkyLight`.
 * The sky attribute was left behind at the old, shorter length, and blockLight
 * DROPPED it rather than let the draw call read off the end of it -- safe, and
 * wrong. A pool in a sealed cave rendered at full sky.
 *
 * WHY THE BLOCK-LIGHT LANE NEVER HAD THIS BUG, which is the fact that makes
 * the whole thing legible: block light rides in vertex ALPHA, and
 * fluidGeometry has always interpolated the colour buffer -- it has to, or the
 * split cells would be unlit. Sky light cannot share that lane, because the
 * GPU interpolates and the interpolation of a packed pair is not the pair of
 * the interpolations. Two numbers, two attributes, and the second one has to
 * be carried by hand.
 *
 * SO THIS FILE ASSERTS THE ATTRIBUTE, NOT ONLY THE PICTURE. A brightness
 * comparison alone would pass on a build that multiplied the whole frame by
 * something -- the cave walls were already dark before this change, and they
 * are most of the frame. The first test reads the sky lane off the water's own
 * surface vertices, which is the only place the fault ever lived.
 *
 * LAVA IS THE CONTROL and is why it is here at all. Lava emits at level 15 in
 * its own right, so it must light itself and its neighbours in a sealed room
 * REGARDLESS of the sky. If a change made "fluids are dark underground" true
 * by multiplying fluids by sky light, lava in a cave would go dark with
 * everything else and this file would say so.
 *
 * Block ids duplicated from blocks.js for the reason helpers/world.js gives
 * for duplicating the others: a renumber should break these tests rather than
 * be quietly followed.
 */
const WATER = 636
const LAVA = 637
const GLOWSTONE = 129
const STONE = 3
const AIR = 0

const NOON = 6000

/*
 * THE RIG STANDS ON THE GROUND, and the first cut of this file did not.
 *
 * It was built in open air at y=252, where 41, 46, 57 and 64 all put their
 * fluid rigs, because open air is flat everywhere and "outdoors" is then free.
 * The vertex data came out exactly right up there -- the open room's floor
 * read 0.000 in the sky lane (full sky) against the sealed room's 1.000 -- and
 * BOTH ROOMS PHOTOGRAPHED BLACK, 4,5,8 in each. Whatever that is, it is not
 * this file's subject and it is not something a picture taken up there can be
 * trusted to show. 65-sky-light's rooms are on the ground and they photograph
 * the difference plainly, so this file's do too.
 *
 * (Recorded rather than chased: at 252 the sky STORE said 15, the vertex
 * attribute said full sky, and the frame was still black -- so the fault is
 * downstream of both, in something altitude-dependent. It is not this file's
 * doing either: 57-flowing-water's own rig at y=240 photographs black in the
 * same working tree, glass and stone alike under a bright blue sky. Handed to
 * whoever owns the shader; src/blockLight.js is not this agent's file.)
 *
 * The floor height is found at run time instead of assumed. The patch is real
 * Minecraft terrain and its surface moves with x and z, so `SURFACE_Y` is only
 * the truth in the spawn column.
 */
let Y = SURFACE_Y
const X0 = -30
const Z0 = -30
/** Interior half-width. R=3 is a 7x7 room, big enough to stand back in. */
const R = 3
/** Between rigs. Stone walls stop sky light outright, so this only has to be
 *  enough that two rigs never share a wall. */
const GAP = 16

/** The three rigs: roofed water, open water, roofed lava. */
const CAVE = [X0, Z0]
const OPEN = [X0 + GAP, Z0]
const LAVAC = [X0, Z0 + GAP]

/**
 * The height of a source block's surface, and it is not 1.
 *
 * fluidGeometry.ownHeight is vanilla's `(8 - level) / 9`, so a source stands
 * 8/9 of a block tall and every corner of a pool's interior averages to the
 * same 8/9. This number is the whole reason the vertex probe below can tell a
 * water vertex from the stone floor beside it: the floor's top face is at
 * exactly Y + 1, the water's is 0.111 under it.
 */
const surfaceY = () => Y + 8 / 9

/**
 * The floor every rig in this file is built at: one above the highest solid
 * block under any of the three footprints.
 *
 * ONE height for all three rather than each rig sitting on its own ground,
 * because the pool probe below filters by Y and a second Y would be a second
 * filter to get wrong. A rig that ends up a block or two above a dip is fine:
 * it lays its own pan and its own floor, so it is sealed either way.
 */
async function groundLevel(page, spots) {
  return page.evaluate(([list, r]) => {
    let top = 0
    for (const [cx, cz] of list) {
      for (let dx = -r - 1; dx <= r + 1; dx++) {
        for (let dz = -r - 1; dz <= r + 1; dz++) {
          for (let y = 200; y > 60; y--) {
            if (window.noa.getBlock(cx + dx, y, cz + dz) !== 0) {
              if (y > top) top = y
              break
            }
          }
        }
      }
    }
    return top + 1
  }, [spots, R])
}

/**
 * Build one room and then check it is really there.
 *
 * The same bargain 46-water-look's buildCliff makes, for the same reason:
 * setBlock is a silent no-op on a chunk that has not loaded, a rig this size
 * spans chunks that arrive independently, and the only honest gate is reading
 * the corners back. Building INSIDE the poll means nothing partial survives a
 * retry.
 *
 * Shape, from the bottom: a solid pan at Y-1, a stone floor at Y with a 3x3
 * hole in the middle of it filled with `fluid`, four walls Y+1..Y+4, and a
 * roof at Y+5 if `roofed`. The pool is therefore FLUSH with the floor you
 * stand on, which is what makes the camera shot below a picture of water
 * rather than a picture of a hole.
 *
 * THE PLAYER GOES THERE FIRST, AND IS PINNED THERE. noa only keeps chunks
 * near the player, and a rig 116 blocks above the terrain is in chunks that do
 * not exist until somebody stands in them -- the first cut of this file left
 * the player at spawn and every `buildRoom` timed out, because setBlock on an
 * absent chunk is a silent no-op forever rather than an error. 46-water-look
 * teleports for the same reason. The PIN is this file's own addition: the
 * teleport lands in open air, and a player falling out of the rig's chunks
 * while the poll is still retrying unloads the very chunks it is writing to.
 */
async function buildRoom(page, [cx, cz], { fluid, roofed }) {
  await teleport(page, cx + 0.5, Y + 8, cz + 0.5)
  await pin(page, cx + 0.5, Y + 8, cz + 0.5)
  await page.evaluate(() => {
    const flow = window.game.fluids.flow
    // Off, so the sources stay exactly where they are put and the probe is
    // not racing a spread. 46 and 57 turn it off for the same reason; the
    // afterAll below puts it back, which they do not, because a pool left in
    // the sky by an earlier spec is not this file's to inherit either.
    flow.setEnabled(false)
    flow.reset()
  })
  await page.waitForFunction(([x, z, y, r, f, roof, air, stone]) => {
    const set = (id, a, b, c) => window.noa.setBlock(id, a, b, c)
    // Clear first: a rerun must not pour this room on top of the last one's.
    for (let dx = -r - 2; dx <= r + 2; dx++) {
      for (let dz = -r - 2; dz <= r + 2; dz++) {
        // Up to +12 rather than just over the roof: this is a dark forest and
        // a leaf left hanging above the OPEN room would take its sky light
        // down a level, which the assertions below would read as the bug.
        for (let dy = -2; dy <= 12; dy++) set(air, x + dx, y + dy, z + dz)
      }
    }
    for (let dx = -r - 1; dx <= r + 1; dx++) {
      for (let dz = -r - 1; dz <= r + 1; dz++) {
        const wall = Math.abs(dx) === r + 1 || Math.abs(dz) === r + 1
        set(stone, x + dx, y - 1, z + dz)                       // the pan
        const pool = !wall && Math.abs(dx) <= 1 && Math.abs(dz) <= 1
        set(pool ? f : stone, x + dx, y, z + dz)                // floor + pool
        for (let dy = 1; dy <= 4; dy++) {
          if (wall) set(stone, x + dx, y + dy, z + dz)          // walls
        }
        if (roof) set(stone, x + dx, y + 5, z + dz)             // roof
      }
    }
    return window.noa.getBlock(x, y, z) === f &&
      window.noa.getBlock(x + r + 1, y + 2, z) === stone &&
      window.noa.getBlock(x - r - 1, y + 2, z) === stone &&
      (!roof || window.noa.getBlock(x, y + 5, z) === stone)
  }, [cx, cz, Y, R, fluid, roofed, AIR, STONE], { timeout: 30_000, polling: 100 })
}

/**
 * Block until noa's two remesh queues are empty.
 *
 * Lifted from 65 and 58, whose comments explain why this is not a sleep: the
 * queue meshes a couple of chunks a tick, so a probe at a fixed tick count
 * reads a different world on chromium than on webkit. This file needs it more
 * than either of them -- the thing under test is written DURING meshing, so a
 * probe that runs early reads the previous mesh's buffers.
 */
const drained = (page) => page.waitForFunction(() => {
  const w = window.noa.world
  return w._chunksToMesh.count() + w._chunksToMeshFirst.count() === 0
}, null, { timeout: 20_000 })

/**
 * Read the two light lanes off the surface vertices of one pool.
 *
 * Both lanes are stored INVERTED (`1 - level/15`): 0 means full, 1 means
 * none. That is deliberate in blockLight.js -- an attribute a mesh never got
 * reads as the generic default 0, and the failure mode of "full sky" is
 * "looks like today" where the failure mode of "no sky" is a black world.
 *
 * `withAttr` is reported separately from `n` on purpose, and it is the number
 * this whole file turns on. Before the fix the sky attribute was not short on
 * a fluid mesh, it was GONE -- blockLight's deferred wrap removed it -- so a
 * probe that only averaged the values it found would have averaged an empty
 * array and passed vacuously. n counts vertices found by POSITION, which does
 * not depend on the attribute existing at all.
 */
const poolLight = (page, [cx, cz]) => page.evaluate(([x, z, sy]) => {
  const out = { n: 0, withAttr: 0, sky: [], alpha: [], meshes: 0, mismatched: 0 }
  for (const chunk of Object.values(window.noa.world._storage.hash)) {
    if (!chunk || chunk.isDisposed || !chunk._terrainMeshes) continue
    for (const mesh of chunk._terrainMeshes) {
      const pos = mesh.getVerticesData('position')
      if (!pos) continue
      out.meshes++
      const skyBuf = mesh.getVerticesData('noaSkyLight')
      const col = mesh.getVerticesData('color')
      // THE INVARIANT, checked over every mesh in the world and not only this
      // pool's: a sky attribute shorter than the position buffer is a draw
      // call reading off the end of it.
      if (skyBuf && skyBuf.length !== pos.length / 3) out.mismatched++
      for (let v = 0; v < pos.length / 3; v++) {
        const wx = pos[v * 3] + chunk.x
        const wy = pos[v * 3 + 1] + chunk.y
        const wz = pos[v * 3 + 2] + chunk.z
        // The 3x3 pool spans lattice x,z from -1 to +2 about the centre.
        if (wx < x - 1.01 || wx > x + 2.01 || wz < z - 1.01 || wz > z + 2.01) continue
        // Filtered by Y, or the stone floor's own top face at Y+1 -- and any
        // stale quad from a previous test in this shared page -- leaks in.
        if (Math.abs(wy - sy) > 0.05) continue
        out.n++
        if (skyBuf) { out.withAttr++; out.sky.push(skyBuf[v]) }
        if (col) out.alpha.push(col[v * 4 + 3])
      }
    }
  }
  const mean = (a) => (a.length ? a.reduce((s, q) => s + q, 0) / a.length : NaN)
  return { ...out, skyMean: mean(out.sky), alphaMean: mean(out.alpha) }
}, [cx, cz, surfaceY()])

/**
 * The mean colour of a small patch of screen. Lifted verbatim from
 * 46-water-look, including its reason: the fluids are animated
 * (terrainAnimation runs 32 frames of water_still at 15 Hz) and antialiased,
 * so one pixel is a lottery and a patch is not.
 */
async function patch(page, clip) {
  const png = await page.screenshot({ clip })
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  let r = 0, g = 0, b = 0, n = 0
  for (let i = 0; i < data.length; i += info.channels) {
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n++
  }
  return [r / n, g / n, b / n]
}

const luma = ([r, g, b]) => (r + g + b) / 3 / 255

/*
 * Straight down at the pool from three blocks up, which puts nothing but
 * water in the middle of the frame. Rejected: standing back and looking across
 * the room, which photographs the far wall as much as the pool -- and the far
 * wall was already dark before this change, so it would dilute exactly the
 * signal this file is about.
 */
const EYE_UP = 3.0
const POOL_CROP = { x: 640 - 80, y: 360 - 80, width: 160, height: 160 }

/**
 * Hold the camera over the pool. Lifted from 46-water-look, whose comment says
 * why it is needed: the rig hangs in the sky, and the first run of a shot like
 * this fell out of frame in the frames before the screenshot and photographed
 * something else entirely. Torn down in an afterEach because a failed
 * assertion skips the rest of the body and a player nailed into the air is
 * inherited by every test after it in this shared world.
 */
const pin = (page, x, y, z) => page.evaluate(([a, b, c]) => {
  const noa = window.noa
  if (window.__pin69) noa.off('tick', window.__pin69)
  window.__pin69 = () => {
    noa.ents.setPosition(noa.playerEntity, [a, b, c])
    const body = noa.ents.getPhysics(noa.playerEntity).body
    body.velocity[0] = body.velocity[1] = body.velocity[2] = 0
  }
  noa.on('tick', window.__pin69)
}, [x, y, z])

const unpin = (page) => page.evaluate(() => {
  if (window.__pin69) window.noa.off('tick', window.__pin69)
  window.__pin69 = null
}).catch(() => {})

async function photographPool(page, [cx, cz], name) {
  const eye = [cx + 0.5, Y + EYE_UP, cz + 0.5]
  await teleport(page, ...eye)
  await pin(page, ...eye)
  // Just short of straight down: dead vertical is a gimbal the camera code
  // clamps, and 0.02 off it is the same picture without asking.
  await look(page, { heading: HEADING.northMinusZ, pitch: Math.PI / 2 - 0.02 })
  await waitFrames(page, 8)
  await shot(page, name)
  return patch(page, POOL_CROP)
}

const setTime = (page, t) => page.evaluate((v) => window.game.sky.setTime(v), t)
const setBlock = (page, id, x, y, z) =>
  page.evaluate(([i, a, b, c]) => window.noa.setBlock(i, a, b, c), [id, x, y, z])

/**
 * Get the player to the site, find the floor, and set the clock.
 *
 * The teleport is not optional and it is not for the camera: noa only keeps
 * chunks near the player, `setBlock` on an absent chunk is a silent no-op
 * forever rather than an error, and `getBlock` on one answers air -- so a
 * ground scan run from spawn would "find" a floor at the bottom of the world.
 * The poll is the gate that says the ground is really loaded.
 */
async function prepare(page, spots) {
  await useGamemode(page, 'creative')
  await setTime(page, NOON)
  const high = SURFACE_Y + 24
  await teleport(page, spots[0][0] + 0.5, high, spots[0][1] + 0.5)
  await pin(page, spots[0][0] + 0.5, high, spots[0][1] + 0.5)
  await page.waitForFunction(([list]) => list.every(([cx, cz]) => {
    for (let y = 200; y > 60; y--) if (window.noa.getBlock(cx, y, cz) !== 0) return true
    return false
  }), [spots], { timeout: 30_000, polling: 200 })
  Y = await groundLevel(page, spots)
  return Y
}

/** Everything a rig touches, for the voxel undo. Wider and taller than the
 *  room, because the build clears the canopy over it too. */
const box = ([cx, cz]) => [[cx - R - 3, Y - 2, cz - R - 3], [cx + R + 3, Y + 13, cz + R + 3]]

test.afterEach(({ page }) => unpin(page))
test.afterAll(async ({ world }) => {
  // Flow back on for whoever runs next. Not in an afterEach: every test here
  // builds with it off. `world` is the worker-scoped booted page from
  // fixtures.js -- `page` is per-test and does not exist out here.
  await world.page.evaluate(() => window.game?.fluids?.flow?.setEnabled?.(true))
    .catch(() => {})
})

/* ------------------------------------------------------------------ *
 * The mechanism -- the attribute itself
 * ------------------------------------------------------------------ */

test('a pool in a sealed room carries the sky lane through the fluid rebuild', async ({ page, terrain }) => {
  await prepare(page, [CAVE, OPEN])
  await terrain.keep(...box(CAVE))
  await terrain.keep(...box(OPEN))

  /*
   * THE SEALED ROOM IS BUILT LAST, and that is not an arbitrary order.
   *
   * Built FIRST, with the open room raised 16 blocks away afterwards, the
   * sealed room came back reading sky 8 at its pool instead of 0 -- measured,
   * twice. Building the second rig re-floods sky light into the first one
   * through a roof that is still there. That is an incremental-propagation
   * artifact in src/blockLight.js, which this file does not own and did not
   * cause; it is written down here so the next person to see it knows it has
   * been seen. The tie between the store and the mesh asserted below holds in
   * EITHER order, which is the part that is actually about this change.
   */
  await buildRoom(page, OPEN, { fluid: WATER, roofed: false })
  await buildRoom(page, CAVE, { fluid: WATER, roofed: true })
  await waitTicks(page, 8)
  await drained(page)

  const cave = await poolLight(page, CAVE)
  const open = await poolLight(page, OPEN)
  const caveSky = await page.evaluate(([x, z, y]) =>
    window.blockLight.getSkyLight(x, y, z), [CAVE[0], CAVE[1], Y])
  const openSky = await page.evaluate(([x, z, y]) =>
    window.blockLight.getSkyLight(x, y, z), [OPEN[0], OPEN[1], Y])

  console.log(`[voxels] sky at the sealed pool ${caveSky}, at the open pool ${openSky}`)
  console.log(`[cave]  ${cave.n} surface vertices, ${cave.withAttr} carrying noaSkyLight, mean ${cave.skyMean.toFixed(4)}`)
  console.log(`[open]  ${open.n} surface vertices, ${open.withAttr} carrying noaSkyLight, mean ${open.skyMean.toFixed(4)}`)
  console.log(`[meshes] ${cave.meshes} terrain meshes, ${cave.mismatched} with a sky attribute of the wrong length`)

  // NON-EMPTY BEFORE ANYTHING IS CLAIMED ABOUT IT. A rig that failed to build,
  // or a Y filter off by 8/9 of a block, would otherwise pass every assertion
  // below by measuring nothing at all.
  expect(cave.n, 'surface vertices found over the sealed pool').toBeGreaterThan(0)
  expect(open.n, 'surface vertices found over the open pool').toBeGreaterThan(0)

  // The voxel light is the premise, and it is blockLight's, not this file's.
  expect(caveSky).toBe(0)
  expect(openSky).toBe(15)

  /*
   * THE FIX, AS ONE NUMBER. Every vertex of the sealed pool's surface has the
   * attribute -- before the fix the count was zero, because blockLight's
   * deferred wrap removed a buffer fluidGeometry had left at the wrong length
   * -- and it reads 1.0, which is `1 - 0/15`: no sky at all.
   */
  expect(cave.withAttr, 'sealed-pool vertices carrying noaSkyLight').toBe(cave.n)
  expect(cave.skyMean).toBeGreaterThan(0.99)

  /*
   * THE SAME CLAIM PHRASED AS A TIE, and this is the form that survives a
   * rig that turns out to be less sealed than it looked: whatever the light
   * STORE says at the pool, the vertex lane says the same thing, inverted.
   * Carrying the attribute is exactly the property of agreeing with the store
   * after a rebuild that changes the vertex count.
   */
  expect(cave.skyMean).toBeCloseTo(1 - caveSky / 15, 2)
  if (open.withAttr > 0) expect(open.skyMean).toBeCloseTo(1 - openSky / 15, 2)

  /*
   * AND THE OUTDOOR POOL IS UNCHANGED, which is the other half of the claim.
   * 0 is full sky. Absent is also full sky, by blockLight's inversion, so the
   * open pool is allowed to have no attribute at all -- a mesh whose every
   * vertex is under open sky never allocates one.
   */
  if (open.withAttr > 0) expect(open.skyMean).toBeLessThan(0.01)

  // The invariant blockLight's deferred wrap exists to enforce, asserted
  // directly: no mesh anywhere has a sky attribute of the wrong length, so
  // that wrap now has nothing to drop.
  expect(cave.mismatched, 'meshes with a stale-length sky attribute').toBe(0)

  /*
   * DISCRIMINATING -- verified by deleting the one line that fixes this,
   *
   *     if (outSky) mesh.setVerticesData(SKY_ATTRIB, ..., false, 1)
   *
   * from src/fluidGeometry.js's readback and running this file again. It did
   * not fail on a number; it failed on a crash:
   *
   *   Error: page.evaluate: RangeError: Invalid typed array length: 72
   *       at VertexBuffer.GetFloatData
   *       at Mesh.getVerticesData
   *       at poolLight (test/69-fluid-sky.spec.js:220)
   *
   * 72 is the OLD vertex count's worth of a buffer on a mesh that now has
   * more, which is the fault in one number -- Babylon will not even read it
   * back. Worth knowing on its own: the mitigation in blockLight.js that was
   * meant to make this state safe does its length check by reading the very
   * attribute that throws.
   */
})

/* ------------------------------------------------------------------ *
 * The other lane -- block light, which rides in alpha
 * ------------------------------------------------------------------ */

test('block light still reaches the same pool, through the colour buffer', async ({ page, terrain }) => {
  await prepare(page, [CAVE])
  await terrain.keep(...box(CAVE))
  await buildRoom(page, CAVE, { fluid: WATER, roofed: true })
  await waitTicks(page, 8)
  await drained(page)

  const dark = await poolLight(page, CAVE)
  // A glowstone on the floor, two blocks from the pool's edge.
  await setBlock(page, GLOWSTONE, CAVE[0] + 2, Y + 1, CAVE[1] + 2)
  await waitTicks(page, 8)
  await drained(page)
  const lit = await poolLight(page, CAVE)
  const level = await page.evaluate(([x, z, y]) =>
    window.blockLight.getBlockLight(x, y, z), [CAVE[0], CAVE[1], Y + 1])

  console.log(`[alpha] pool vertices ${dark.n} -> ${lit.n}`)
  console.log(`[alpha] mean vertex alpha ${dark.alphaMean.toFixed(4)} -> ${lit.alphaMean.toFixed(4)} (block light at the pool ${level})`)
  console.log(`[alpha] sky lane over the same edit ${dark.skyMean.toFixed(4)} -> ${lit.skyMean.toFixed(4)}`)

  expect(dark.n).toBeGreaterThan(0)
  expect(lit.n).toBeGreaterThan(0)
  /*
   * Alpha holds `1 - block/15`, so an unlit surface is 1.0 and a lit one is
   * less. This is the lane that never broke -- fluidGeometry has always
   * interpolated the colour buffer -- and the point of asserting it is that
   * the sky fix did not cost it. Verified rather than assumed, which is what
   * the brief asked for.
   */
  expect(dark.alphaMean).toBeGreaterThan(0.99)
  expect(level).toBeGreaterThan(0)
  expect(lit.alphaMean).toBeLessThan(0.9)
  // ...and the glowstone changed the BLOCK lane without touching the SKY one.
  // Two channels, still two.
  expect(lit.skyMean).toBeGreaterThan(0.99)
})

/* ------------------------------------------------------------------ *
 * The payoff -- what it looks like
 * ------------------------------------------------------------------ */

test('water is dark in a sealed room at noon, lit by a glowstone, and unchanged outdoors', async ({ page, terrain }) => {
  await prepare(page, [CAVE, OPEN])
  await terrain.keep(...box(CAVE))
  await terrain.keep(...box(OPEN))

  await buildRoom(page, OPEN, { fluid: WATER, roofed: false })
  await buildRoom(page, CAVE, { fluid: WATER, roofed: true })
  await waitTicks(page, 8)
  await drained(page)

  const outdoors = await photographPool(page, OPEN, 'fluid-sky-water-outdoor-noon')
  const cave = await photographPool(page, CAVE, 'fluid-sky-water-cave-noon')

  await setBlock(page, GLOWSTONE, CAVE[0] + 2, Y + 1, CAVE[1] + 2)
  await waitTicks(page, 8)
  await drained(page)
  const caveLit = await photographPool(page, CAVE, 'fluid-sky-water-cave-glowstone')

  console.log(`[water] outdoor pool at noon ${outdoors.map(Math.round)} luma ${luma(outdoors).toFixed(4)}`)
  console.log(`[water] sealed pool at noon  ${cave.map(Math.round)} luma ${luma(cave).toFixed(4)}`)
  console.log(`[water] sealed + glowstone   ${caveLit.map(Math.round)} luma ${luma(caveLit).toFixed(4)}`)

  /*
   * THE REPORT, as a picture: the same water at the same instant of the same
   * day, dark under a roof. Not "dimmer by a hair" -- a factor.
   *
   * DISCRIMINATING, from the same mutation as above, run for real:
   *
   *   [water] outdoor pool at noon 63,89,143 luma 0.3854
   *   [water] sealed pool at noon  36,52,83  luma 0.2231     <- mutated
   *   [water] sealed pool at noon  4,5,8     luma 0.0215     <- fixed
   *
   * Ten times brighter with the line gone, in a sealed stone box at noon, and
   * the outdoor pool unmoved at 0.385 either way -- which is the half of the
   * claim that says this did not simply darken all water everywhere.
   */
  expect(luma(cave)).toBeLessThan(luma(outdoors) / 2)
  // The glowstone is what proves it is the SKY that is gone and not the water:
  // nothing about the clock or the roof changes here.
  expect(luma(caveLit)).toBeGreaterThan(luma(cave))
  // And it is still water, not a black hole where water used to be: the blue
  // channel leads in all three.
  for (const p of [outdoors, cave, caveLit]) expect(p[2]).toBeGreaterThan(p[0])
})

test('lava lights itself in a sealed room, which sky light has no say in', async ({ page, terrain }) => {
  await prepare(page, [LAVAC])
  await terrain.keep(...box(LAVAC))
  await buildRoom(page, LAVAC, { fluid: LAVA, roofed: true })
  await waitTicks(page, 8)
  await drained(page)

  const pool = await poolLight(page, LAVAC)
  const emitted = await page.evaluate(([x, z, y]) =>
    window.blockLight.getBlockLight(x, y, z), [LAVAC[0], LAVAC[1], Y + 1])
  const seen = await photographPool(page, LAVAC, 'fluid-sky-lava-cave-noon')

  console.log(`[lava] ${pool.n} surface vertices, ${pool.withAttr} carrying noaSkyLight, sky mean ${pool.skyMean.toFixed(4)}`)
  console.log(`[lava] block light in the air above it ${emitted}, alpha mean ${pool.alphaMean.toFixed(4)}`)
  console.log(`[lava] patch ${seen.map(Math.round)} luma ${luma(seen).toFixed(4)}`)

  expect(pool.n).toBeGreaterThan(0)
  // The sealed room has no sky, and the lava's surface says so in the same
  // lane the water's does -- so this is the same code path, not an exemption.
  expect(pool.withAttr).toBe(pool.n)
  expect(pool.skyMean).toBeGreaterThan(0.99)

  /*
   * THE CONTROL. Lava is its own emitter at 15 (blockLight's EMISSION_PREFIXES
   * covers the whole family, source and every flow id), so it lights itself
   * and the room around it with no sky at all. Alpha near 0 is `1 - 15/15`.
   *
   * If a change had made fluids dark underground by multiplying them by sky
   * light, this is the assertion that would have caught it: lava would have
   * gone black along with everything else.
   */
  expect(emitted).toBeGreaterThan(10)
  expect(pool.alphaMean).toBeLessThan(0.2)
  // And on screen it is bright and it is orange -- red leads, where water's
  // blue did.
  expect(seen[0]).toBeGreaterThan(seen[2])
  expect(luma(seen)).toBeGreaterThan(0.2)
})
