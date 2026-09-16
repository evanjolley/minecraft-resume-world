import { test, expect } from './fixtures.js'
import { waitTicks, teleport, look, settleOnGround, useGamemode, HEADING, SURFACE_Y, ID } from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * SKY LIGHT -- does the roof over your head do anything.
 *
 * Reported as docs/REPORTED.md 5b: a cave at noon is as bright as the meadow
 * above it, because src/blockLight.js shipped one of vanilla's two channels
 * and this is the other one. Spec 56 says in its own header that the dark room
 * it photographs is dark because the clock says midnight and NOT because it
 * has a roof. This file is the one that gets to say otherwise.
 *
 * THREE RULES, ASSERTED SEPARATELY, because they fail separately:
 *
 *   1. 15 under open sky.        The seed.
 *   2. No decay downward.        The one special case in the BFS, and the
 *                                reason a 40-block shaft is lit at the bottom.
 *   3. One level per block sideways.  The ordinary rule, which sky light does
 *                                NOT get an exemption from once it turns a
 *                                corner.
 *
 * Plus the reported symptom itself, which is none of the three: a roofed voxel
 * is dark AT NOON. Rules 1-3 could all hold and that could still be wrong, if
 * the shader multiplied the wrong term by the clock.
 *
 * Block ids duplicated from blocks.js rather than imported, for the reason
 * helpers/world.js gives for duplicating the others: a renumber should break
 * these tests rather than be quietly followed.
 */
const GLOWSTONE = 129
const NOON = 6000
const MIDNIGHT = 18000

/** Far enough from spawn not to sit in anything else's test fixture. */
const CX = -30
const CZ = 34
const FLOOR = SURFACE_Y

const sky = (page, x, y, z) =>
  page.evaluate(([a, b, c]) => window.blockLight.getSkyLight(a, b, c), [x, y, z])

const block = (page, x, y, z) =>
  page.evaluate(([a, b, c]) => window.blockLight.getBlockLight(a, b, c), [x, y, z])

const setBlock = (page, id, x, y, z) =>
  page.evaluate(([i, a, b, c]) => window.noa.setBlock(i, a, b, c), [id, x, y, z])

/**
 * Block until noa's two remesh queues are empty.
 *
 * Lifted from 58, whose comment explains why this is not a sleep: the queue
 * meshes a couple of chunks a tick, so a probe at a fixed tick count reads a
 * different world on chromium than on webkit. Sky light makes this worse, not
 * better -- a single placed block dirties every chunk under it.
 */
const drained = (page) => page.waitForFunction(() => {
  const w = window.noa.world
  return w._chunksToMesh.count() + w._chunksToMeshFirst.count() === 0
}, null, { timeout: 20_000 })

/** Mean luminance of the viewport, 0..1. Decoded in-page; see spec 36 and 56. */
async function brightness(page) {
  const buf = await page.screenshot()
  return page.evaluate((url) => new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const d = ctx.getImageData(0, 0, c.width, c.height).data
      let sum = 0
      for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3
      resolve(sum / (d.length / 4) / 255)
    }
    img.src = url
  }), `data:image/png;base64,${buf.toString('base64')}`)
}

const setTime = (page, t) => page.evaluate((v) => window.game.sky.setTime(v), t)

/* ------------------------------------------------------------------ *
 * Rule 1 -- 15 under open sky
 * ------------------------------------------------------------------ */

test('open sky is 15 and solid ground is 0, at noon and at midnight alike', async ({ page }) => {
  await drained(page)
  // The air two blocks above the surface, which nothing is standing on.
  const above = await sky(page, CX, FLOOR + 2, CZ)
  const higher = await sky(page, CX, FLOOR + 12, CZ)
  // Well under the surface. Solid, and nothing above it is transparent.
  const under = await sky(page, CX, FLOOR - 6, CZ)
  console.log(`[open] sky at +2 ${above}, at +12 ${higher}, at -6 ${under}`)
  expect(above).toBe(15)
  expect(higher).toBe(15)
  expect(under).toBe(0)

  /*
   * THE HALF OF THIS THAT IS NOT OBVIOUS. Sky light is stored WITHOUT the
   * clock in it -- `getSkyLight` answers 15 at midnight too, and the daylight
   * multiply happens in the shader and in entityLight.js. If the clock ever
   * leaks into the store then remeshing would have to happen every tick, which
   * is the design this file is guarding, not a detail.
   */
  await setTime(page, MIDNIGHT)
  await waitTicks(page, 3)
  expect(await sky(page, CX, FLOOR + 2, CZ)).toBe(15)
  await setTime(page, NOON)
  await waitTicks(page, 3)
})

/* ------------------------------------------------------------------ *
 * Rule 2 -- no decay downward
 * ------------------------------------------------------------------ */

/** Deep enough that a 1-per-block decay would be pitch dark at the bottom. */
const SHAFT = 24

/**
 * The control voxel: roofed, and far enough away that sideways light cannot
 * reach it. 20 blocks is past the 15 a full-strength level can spread.
 *
 * It matters that the control is measured BEFORE and AFTER. "Dark and stays
 * dark" is the claim; "dark" alone would be satisfied by an engine that never
 * wrote anything at all, which is the vacuous pass this file's brief warns
 * about.
 */
const FAR = 20

test('a deep shaft open to the sky is 15 all the way down', async ({ page, terrain }) => {
  await useGamemode(page, 'creative')
  await terrain.keep([CX - 2, FLOOR - SHAFT - 2, CZ - 2], [CX + 2, FLOOR + 2, CZ + 2])
  const roofedBefore = await sky(page, CX + FAR, FLOOR - SHAFT, CZ)

  // Dig one column straight down. Every voxel in it has open sky above.
  await page.evaluate(([x, z, top, depth, air]) => {
    for (let y = top; y > top - depth; y--) window.noa.setBlock(air, x, y, z)
  }, [CX, CZ, FLOOR - 1, SHAFT, ID.air])
  await waitTicks(page, 6)
  await drained(page)

  const column = []
  for (let d = 0; d < SHAFT; d++) column.push(await sky(page, CX, FLOOR - 1 - d, CZ))
  const roofedAfter = await sky(page, CX + FAR, FLOOR - SHAFT, CZ)
  console.log(`[shaft] ${SHAFT} deep, sky by depth: ${column.join(',')}`)
  console.log(`[shaft] roofed control ${FAR} blocks east: ${roofedBefore} -> ${roofedAfter}`)

  // Non-empty before anything is claimed about it. A shaft that failed to dig
  // would otherwise pass this test by measuring nothing.
  expect(column.length).toBe(SHAFT)
  /*
   * THE ASSERTION THE WHOLE RULE IS. With ordinary 1-per-block decay the
   * bottom of a 24-block shaft would be 0 and the test would read
   * 14,13,12,...,0. Every one of them is 15.
   */
  for (const v of column) expect(v).toBe(15)

  // ...and the same depth under an intact roof is 0, both before the shaft was
  // dug and after. So this is not "everything reads 15 because nothing was
  // ever written", and the shaft's light is going DOWN rather than outward.
  expect(roofedBefore).toBe(0)
  expect(roofedAfter).toBe(0)
})

/* ------------------------------------------------------------------ *
 * Rule 3 -- one level per block sideways
 * ------------------------------------------------------------------ */

/** Length of the horizontal tunnel driven off the bottom of the shaft. */
const TUNNEL = 10

test('sky light entering a side tunnel falls off one level per block', async ({ page, terrain }) => {
  await useGamemode(page, 'creative')
  const Y = FLOOR - 12
  await terrain.keep([CX - 2, Y - 2, CZ - 2], [CX + TUNNEL + 2, FLOOR + 2, CZ + 2])
  // A shaft, then a tunnel running east off the bottom of it. The tunnel is
  // roofed by the untouched ground above, so nothing in it sees the sky.
  await page.evaluate(([x, z, top, y, len, air]) => {
    for (let yy = top; yy >= y; yy--) window.noa.setBlock(air, x, yy, z)
    for (let d = 1; d <= len; d++) window.noa.setBlock(air, x + d, y, z)
  }, [CX, CZ, FLOOR - 1, Y, TUNNEL, ID.air])
  await waitTicks(page, 8)
  await drained(page)

  const run = []
  for (let d = 0; d <= TUNNEL; d++) run.push(await sky(page, CX + d, Y, CZ))
  console.log(`[tunnel] sky along the tunnel: ${run.join(',')}`)

  expect(run.length).toBe(TUNNEL + 1)
  // The shaft end is full strength...
  expect(run[0]).toBe(15)
  // ...and every step east costs exactly one, to zero.
  for (let d = 1; d <= TUNNEL; d++) expect(run[d]).toBe(Math.max(0, 15 - d))
  // Which means the tunnel really does go dark, rather than the fall-off being
  // asserted over a run that never reaches 0.
  expect(run[TUNNEL]).toBe(15 - TUNNEL)
  expect(run.some((v) => v === 0 || v < 6)).toBe(true)
})

/* ------------------------------------------------------------------ *
 * The reported symptom -- a roof at noon
 * ------------------------------------------------------------------ */

test('a roofed voxel is dark at noon, and a block dropped on open ground darkens the column under it', async ({ page, terrain }) => {
  await useGamemode(page, 'creative')
  await terrain.keep([CX - 4, FLOOR - 4, CZ - 4], [CX + 4, FLOOR + 6, CZ + 4])
  await setTime(page, NOON)

  // Before: standing on open ground at noon, the voxel at head height is 15.
  await waitTicks(page, 3)
  await drained(page)
  const openAtNoon = await sky(page, CX, FLOOR + 1, CZ)

  // Roof it. One slab of stone three blocks up over a 5x5.
  await page.evaluate(([x, z, y, stone]) => {
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) window.noa.setBlock(stone, x + dx, y, z + dz)
    }
  }, [CX, CZ, FLOOR + 3, ID.stone])
  await waitTicks(page, 6)
  await drained(page)

  const roofedAtNoon = await sky(page, CX, FLOOR + 1, CZ)
  console.log(`[roof] under open sky ${openAtNoon}, under a roof ${roofedAtNoon}`)
  expect(openAtNoon).toBe(15)
  /*
   * THE REPORT. Not "dimmer" -- the centre of a 5x5 roof is two blocks from
   * the nearest opening on every side, so sideways light reaches it at 13, and
   * an assertion of "less than 15" would pass on a broken engine that merely
   * leaked a level. It is the DIRECT light that has to be gone, and under a
   * roof the direct light is the whole of it above 13.
   */
  expect(roofedAtNoon).toBeLessThan(15)
  expect(roofedAtNoon).toBeLessThanOrEqual(13)

  /*
   * THE COLUMN RULE, which is the thing block light never had to do. One block
   * placed on open ground takes the light out of everything beneath it, to the
   * ground -- not out of a 15-block radius.
   */
  const probeY = FLOOR + 2
  const before = await sky(page, CX + 3, probeY, CZ + 3)
  await setBlock(page, ID.stone, CX + 3, FLOOR + 5, CZ + 3)
  await waitTicks(page, 6)
  await drained(page)
  const after = await sky(page, CX + 3, probeY, CZ + 3)
  console.log(`[column] one block at +5 took (${CX + 3},${probeY},${CZ + 3}) from ${before} to ${after}`)
  expect(before).toBe(15)
  expect(after).toBeLessThan(15)
})

/* ------------------------------------------------------------------ *
 * What it looks like -- the payoff, and the point of the whole change
 * ------------------------------------------------------------------ */

/** A roofed chamber dug into the ground, big enough to stand and look around. */
const RX = 4
const CEIL = FLOOR + 2

async function digCave(page) {
  await page.evaluate(([x, z, floor, ceil, r, air, stone]) => {
    // Hollow out a room, then cap it with solid ground so nothing sees the sky.
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let y = floor; y < ceil; y++) window.noa.setBlock(air, x + dx, y, z + dz)
        for (let y = ceil; y <= ceil + 2; y++) window.noa.setBlock(stone, x + dx, y, z + dz)
      }
    }
  }, [CX, CZ, FLOOR - 4, CEIL - 4, RX, ID.air, ID.stone])
  await waitTicks(page, 8)
  await drained(page)
}

test('a cave at noon is dark, and a glowstone in it is not', async ({ page, terrain }) => {
  await useGamemode(page, 'creative')
  await terrain.keep([CX - 8, FLOOR - 10, CZ - 8], [CX + 8, FLOOR + 6, CZ + 8])
  await setTime(page, NOON)
  await waitTicks(page, 3)

  // The meadow at noon, as the control. Same clock, same camera height.
  await teleport(page, CX + 0.5, FLOOR, CZ + 0.5)
  await settleOnGround(page)
  await look(page, { heading: HEADING.northMinusZ, pitch: 0.25 })
  await waitTicks(page, 3)
  await drained(page)
  const outdoors = await brightness(page)
  await shot(page, 'sky-outdoors-noon')

  await digCave(page)
  await teleport(page, CX + 0.5, FLOOR - 4, CZ + 0.5)
  await settleOnGround(page)
  await look(page, { heading: HEADING.northMinusZ, pitch: 0.25 })
  await waitTicks(page, 3)
  await drained(page)
  const caveDark = await brightness(page)
  const caveSky = await sky(page, CX, FLOOR - 4, CZ)
  await shot(page, 'sky-cave-noon-dark')

  // The same cave, with a glowstone in it. Nothing about the clock changes.
  await setBlock(page, GLOWSTONE, CX + 2, FLOOR - 4, CZ - 2)
  await waitTicks(page, 8)
  await drained(page)
  const caveLit = await brightness(page)
  const caveBlock = await block(page, CX, FLOOR - 4, CZ)
  await shot(page, 'sky-cave-noon-glowstone')

  console.log(`[payoff] meadow at noon ${outdoors.toFixed(4)}`)
  console.log(`[payoff] cave at noon ${caveDark.toFixed(4)} (sky ${caveSky})`)
  console.log(`[payoff] same cave + glowstone ${caveLit.toFixed(4)} (block ${caveBlock})`)

  // The cave has no sky light in it at all -- it is roofed by three blocks of
  // stone, so not even a sideways level reaches the middle.
  expect(caveSky).toBe(0)
  // THE REPORTED SYMPTOM, as a picture rather than a number: at the same
  // instant of the same day, the cave is darker than the meadow.
  expect(caveDark).toBeLessThan(outdoors)
  // And the torch matters at noon underground, which is the whole asymmetry:
  // it would be invisible on the meadow above.
  expect(caveBlock).toBeGreaterThan(0)
  expect(caveLit).toBeGreaterThan(caveDark)
})

/* ------------------------------------------------------------------ *
 * The cost -- sky light must not undo greedy meshing
 * ------------------------------------------------------------------ */

/** Every terrain vertex currently loaded. Same probe spec 58 budgets with. */
const totalTerrainVerts = (page) => page.evaluate(() => {
  let verts = 0, meshes = 0
  for (const chunk of Object.values(window.noa.world._storage.hash)) {
    if (!chunk || chunk.isDisposed || !chunk._terrainMeshes) continue
    for (const mesh of chunk._terrainMeshes) {
      const pos = mesh.getVerticesData('position')
      if (!pos) continue
      verts += pos.length / 3
      meshes++
    }
  }
  return { verts, meshes }
})

/**
 * THE TRAP, WRITTEN DOWN AS AN ASSERTION.
 *
 * The quad split that landed in 0530c18 clipped itself to the LIT lattice
 * bounding box. Sky light is 15 across every open surface in the world, so a
 * second channel run through that criterion unchanged splits every outdoor
 * quad into unit sub-quads and undoes greedy meshing everywhere -- a
 * vertex-count explosion across the whole visible world rather than a local
 * cost. The criterion is now phrased in terms of VARIATION instead, and a
 * uniform quad is left merged.
 *
 * This is what that is worth as a number: outdoors, where sky light is
 * everywhere, the ground must still be a handful of big quads.
 */
test('sky light leaves greedy meshing alone outdoors', async ({ page }) => {
  await useGamemode(page, 'creative')
  await teleport(page, 0.5, SURFACE_Y + 2, 0.5)
  await setTime(page, NOON)
  await waitTicks(page, 20)
  await drained(page)

  const { verts, meshes } = await totalTerrainVerts(page)
  console.log(`[budget] ${verts} terrain vertices over ${meshes} meshes with sky light on`)
  console.log(`[budget] last chunk's vertex-light pass: ${await page.evaluate(() => window.blockLight.lastMeshMs())} ms`)
  console.log(`[budget] last chunk's flood: ${await page.evaluate(() => window.blockLight.lastSeedMs())} ms`)

  // Non-empty first: a probe that found no meshes would pass any ceiling.
  expect(meshes).toBeGreaterThan(0)
  expect(verts).toBeGreaterThan(0)
  /*
   * The ceiling, and where it comes from. Before sky light this neighbourhood
   * measured 536 vertices over 28 meshes (spec 58's own baseline). One 32x32
   * chunk floor shattered to unit quads is ~4,225 vertices BY ITSELF, so if
   * the criterion had stayed "is lit" the number here would be five figures.
   * 3,000 is loose enough to survive a different render distance and tight
   * enough that it cannot be reached without the explosion.
   */
  expect(verts).toBeLessThan(3000)
})
