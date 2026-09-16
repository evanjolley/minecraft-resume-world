import { test, expect } from './fixtures.js'
import { waitTicks, teleport, look, settleOnGround, HEADING, SURFACE_Y, ID, measureFps } from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * BLOCK LIGHT -- does a glowstone light anything but itself.
 *
 * Reported as "glowstone emits no light when placed" (docs/REPORTED.md 5), and
 * docs/lighting.md established that the complaint was not about glowstone: the
 * engine had no light value at all. src/blockLight.js now gives it one.
 *
 * WHAT THIS FILE DOES NOT PROVE, said here so nobody reads the screenshots and
 * concludes otherwise: SKY LIGHT IS NOT BUILT. The dark room below is dark
 * because the test sets the clock to midnight, not because it has a roof. The
 * same room at noon is bright, and a cave at noon is bright, exactly as they
 * were before this file existed.
 *
 * The block ids are duplicated from blocks.js rather than imported, for the
 * reason helpers/world.js gives for duplicating the others: if someone
 * renumbers them, these tests should fail rather than quietly follow along.
 */
const GLOWSTONE = 129
const MIDNIGHT = 18000
const NOON = 6000

/** Room centre, on the same flat platform 36-face-shading.spec.js builds on. */
const CX = 20
const CZ = 20
const FLOOR = SURFACE_Y
/** Inside radius. A 7x7 floor leaves room for a full 15-level falloff to die. */
const R = 3
const CEIL = FLOOR + 4

/** Mean luminance of the whole viewport, 0..1. Decoded in-page; see spec 36. */
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

const lightAt = (page, x, y, z) =>
  page.evaluate(([a, b, c]) => window.blockLight.getBlockLight(a, b, c), [x, y, z])

const setBlock = (page, id, x, y, z) =>
  page.evaluate(([i, a, b, c]) => window.noa.setBlock(i, a, b, c), [id, x, y, z])

/** A sealed stone box with clear air inside, centred on (CX, CZ). */
async function buildRoom(page) {
  await page.evaluate(([cx, cz, floor, ceil, r, stone, air]) => {
    for (let dx = -r - 1; dx <= r + 1; dx++) {
      for (let dz = -r - 1; dz <= r + 1; dz++) {
        for (let y = floor; y <= ceil; y++) {
          const wall = dx === -r - 1 || dx === r + 1 || dz === -r - 1 || dz === r + 1
          const cap = y === floor || y === ceil
          window.noa.setBlock(wall || cap ? stone : air, cx + dx, y, cz + dz)
        }
      }
    }
  }, [CX, CZ, FLOOR, CEIL, R, ID.stone, ID.air])
  await waitTicks(page, 4)
}

async function standInside(page) {
  await teleport(page, CX + 0.5, FLOOR + 1, CZ + 0.5)
  await settleOnGround(page)
  await look(page, { heading: HEADING.northMinusZ, pitch: 0.35 })
  await waitTicks(page, 3)
}

/* ------------------------------------------------------------------ *
 * Propagation -- the numbers, which is where the discrimination lives
 * ------------------------------------------------------------------ */

test('a glowstone floods light that falls off one level per block', async ({ page, terrain }) => {
  await terrain.keep([CX - 6, FLOOR, CZ - 6], [CX + 6, CEIL, CZ + 6])
  await buildRoom(page)
  // Open air corridor along +X inside the room, then a long open run outside
  // it, so the falloff is measured in a straight line with nothing in the way.
  await page.evaluate(([cx, cz, y, air]) => {
    for (let dx = 0; dx <= 20; dx++) window.noa.setBlock(air, cx + dx, y, cz)
  }, [CX, CZ, FLOOR + 1, ID.air])
  await waitTicks(page, 2)

  await setBlock(page, GLOWSTONE, CX, FLOOR + 1, CZ)
  await waitTicks(page, 2)

  // The emitter's own voxel is its full level; each step out is one less.
  expect(await lightAt(page, CX, FLOOR + 1, CZ)).toBe(15)
  expect(await lightAt(page, CX + 1, FLOOR + 1, CZ)).toBe(14)
  expect(await lightAt(page, CX + 5, FLOOR + 1, CZ)).toBe(10)
  expect(await lightAt(page, CX + 14, FLOOR + 1, CZ)).toBe(1)
  // 15 blocks out is where vanilla's nibble runs out, and it must be dark.
  expect(await lightAt(page, CX + 15, FLOOR + 1, CZ)).toBe(0)
  expect(await lightAt(page, CX + 16, FLOOR + 1, CZ)).toBe(0)
})

test('taking the glowstone away takes its light with it', async ({ page, terrain }) => {
  await terrain.keep([CX - 6, FLOOR, CZ - 6], [CX + 6, CEIL, CZ + 6])
  await buildRoom(page)
  await setBlock(page, GLOWSTONE, CX, FLOOR + 1, CZ)
  await waitTicks(page, 2)
  expect(await lightAt(page, CX + 2, FLOOR + 1, CZ)).toBe(13)

  await setBlock(page, ID.air, CX, FLOOR + 1, CZ)
  await waitTicks(page, 2)
  // Removal is the half that cannot be done by re-propagating, because
  // propagation only ever raises a value. If the removal BFS is skipped these
  // stay at 15/13 forever.
  expect(await lightAt(page, CX, FLOOR + 1, CZ)).toBe(0)
  expect(await lightAt(page, CX + 2, FLOOR + 1, CZ)).toBe(0)
})

test('a wall stops light, and knocking a hole in it lets light through', async ({ page, terrain }) => {
  await terrain.keep([CX - 6, FLOOR, CZ - 6], [CX + 6, CEIL, CZ + 6])
  await buildRoom(page)
  await setBlock(page, GLOWSTONE, CX, FLOOR + 1, CZ)
  await waitTicks(page, 2)

  // Just outside the room's +X wall. Sealed, so nothing reaches it, even
  // though it is only 5 blocks from a level-15 emitter.
  const outside = [CX + R + 2, FLOOR + 1, CZ]
  expect(await lightAt(page, ...outside)).toBe(0)

  await setBlock(page, ID.air, CX + R + 1, FLOOR + 1, CZ)
  await waitTicks(page, 2)
  // 4 blocks through the doorway: 15 - 5 = 10.
  expect(await lightAt(page, ...outside)).toBe(10)

  await setBlock(page, ID.stone, CX + R + 1, FLOOR + 1, CZ)
  await waitTicks(page, 2)
  // Sealing it again has to run the same removal pass an emitter removal does.
  expect(await lightAt(page, ...outside)).toBe(0)
})

test('two glowstones do not add up, they take the max', async ({ page, terrain }) => {
  await terrain.keep([CX - 6, FLOOR, CZ - 6], [CX + 6, CEIL, CZ + 6])
  await buildRoom(page)
  await setBlock(page, GLOWSTONE, CX - 2, FLOOR + 1, CZ)
  await setBlock(page, GLOWSTONE, CX + 2, FLOOR + 1, CZ)
  await waitTicks(page, 2)
  // Midpoint is 2 from each. Vanilla is a max, not a sum: 13, never 26 or 15.
  expect(await lightAt(page, CX, FLOOR + 1, CZ)).toBe(13)

  // Removing one must leave the other's contribution standing -- this is the
  // reseed branch of the removal BFS, and it is the one that silently breaks.
  await setBlock(page, ID.air, CX - 2, FLOOR + 1, CZ)
  await waitTicks(page, 2)
  expect(await lightAt(page, CX, FLOOR + 1, CZ)).toBe(13)
  expect(await lightAt(page, CX - 2, FLOOR + 1, CZ)).toBe(11)
})

/* ------------------------------------------------------------------ *
 * Pixels -- what the report was actually about
 * ------------------------------------------------------------------ */

test('a glowstone in a dark room brightens the room', async ({ page, terrain }) => {
  await terrain.keep([CX - 6, FLOOR, CZ - 6], [CX + 6, CEIL, CZ + 6])
  await buildRoom(page)
  await page.evaluate((t) => window.game.sky.setTime(t), MIDNIGHT)
  await standInside(page)

  const dark = await brightness(page)
  await shot(page, 'block-light-room-dark')

  await setBlock(page, GLOWSTONE, CX, FLOOR + 1, CZ - 2)
  await waitTicks(page, 4)
  const lit = await brightness(page)
  await shot(page, 'block-light-room-glowstone')

  // Not a tuned threshold: an unlit room and a glowstone-lit one are far
  // enough apart that anything above noise proves the light landed.
  expect(lit).toBeGreaterThan(dark * 1.5)
})

/*
 * THE ASSERTION THAT WAS BUILT TO FAIL, AND DID.
 *
 * This test used to read "the same room at noon is still bright, because sky
 * light is not built", and it asserted `noon > night * 1.5` -- a sealed room
 * lit by the sun, recorded as a number so that the next person would not have
 * to rediscover that it was known to be wrong. It failed on 2026-09-16, which
 * is what it was for. `src/blockLight.js` grew a sky channel and
 * `test/65-sky-light.spec.js` is the file that owns the subject now.
 *
 * It is INVERTED rather than deleted. The claim has a direction, and a test
 * that says "a roof works" is worth more here than one less test: this room is
 * the same room the midnight case above is photographed in, so the pair now
 * says the light in it comes from the glowstone and from nothing else.
 */
test('the same room at noon is dark too, because it has a roof', async ({ page, terrain }) => {
  await terrain.keep([CX - 6, FLOOR, CZ - 6], [CX + 6, CEIL, CZ + 6])
  await buildRoom(page)
  await page.evaluate((t) => window.game.sky.setTime(t), NOON)
  await standInside(page)
  const noon = await brightness(page)
  await shot(page, 'block-light-room-noon-dark')

  await page.evaluate((t) => window.game.sky.setTime(t), MIDNIGHT)
  await waitTicks(page, 3)
  const night = await brightness(page)
  console.log(`[roof] sealed room at noon ${noon.toFixed(4)}, at midnight ${night.toFixed(4)}`)

  // The clock moved and the room did not. Not "noon is dark" on its own, which
  // a black screen would satisfy -- the two readings have to be the SAME, and
  // one of them is taken with the sun directly overhead.
  expect(noon).toBeLessThan(night * 1.3)
  expect(noon).toBeGreaterThan(night * 0.7)

  // And the control, so this is not measuring a broken renderer: the same
  // clock, the same camera, outside.
  await page.evaluate((t) => window.game.sky.setTime(t), NOON)
  await teleport(page, CX + 10.5, FLOOR + 1, CZ + 10.5)
  await settleOnGround(page)
  await look(page, { heading: HEADING.northMinusZ, pitch: 0.35 })
  await waitTicks(page, 3)
  const outside = await brightness(page)
  console.log(`[roof] outdoors at the same noon ${outside.toFixed(4)}`)
  expect(outside).toBeGreaterThan(noon * 3)
})

/* ------------------------------------------------------------------ *
 * Cost
 * ------------------------------------------------------------------ */

test('an edit next to many emitters stays under a frame', async ({ page, terrain }) => {
  await terrain.keep([CX - 6, FLOOR, CZ - 6], [CX + 6, CEIL, CZ + 6])
  await buildRoom(page)
  await standInside(page)

  const before = await measureFps(page, 1500)

  // Eight emitters in one small room: every edit near them re-floods all of
  // them, which is the worst case docs/lighting.md flagged as unmeasured.
  await page.evaluate(([cx, cz, y, glow]) => {
    for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2], [0, -3], [0, 3], [-3, 0], [3, 0]]) {
      window.noa.setBlock(glow, cx + dx, y, cz + dz)
    }
  }, [CX, CZ, FLOOR + 1, GLOWSTONE])
  await waitTicks(page, 4)

  const edits = await page.evaluate(([cx, cz, y, stone, air]) => {
    const times = []
    for (let n = 0; n < 12; n++) {
      window.noa.setBlock(n % 2 ? stone : air, cx + 1, y, cz + 1)
      times.push(window.blockLight.lastEditMs())
    }
    times.sort((a, b) => a - b)
    return { median: times[times.length >> 1], worst: times[times.length - 1] }
  }, [CX, CZ, FLOOR + 1, ID.stone, ID.air])

  const after = await measureFps(page, 1500)
  console.log(`block light: fps ${before.toFixed(1)} -> ${after.toFixed(1)}, `
    + `edit median ${edits.median.toFixed(2)}ms worst ${edits.worst.toFixed(2)}ms, `
    + `mesh pass ${(await page.evaluate(() => window.blockLight.lastMeshMs())).toFixed(2)}ms`)

  // 16ms is one frame at 60Hz. Propagation runs synchronously inside setBlock,
  // so anything above this is a visible hitch every time a torch is placed.
  expect(edits.worst).toBeLessThan(16)
  // Steady-state framerate must not move: the shader work is one max() and the
  // vertex pass only runs on remesh.
  expect(after).toBeGreaterThan(before * 0.75)
})
