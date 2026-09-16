import { test, expect } from './fixtures.js'
import { waitTicks, teleport, look, waitFrames, useGamemode, doubleTapFly, ID, HEADING } from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * GLOWSTONE: RADIAL OR DIRECTIONAL.
 *
 * Evan, playing 2026-09-16: "glowstone lights directionally instead of
 * radially." `docs/REPORTED.md` 5a wrote down a hypothesis and flagged it as a
 * hypothesis: noa greedy-meshes, its merge predicate
 * (`terrainMesher.js:maskCompare`) compares the material id and the AO mask
 * and NOTHING ELSE, so a flat floor becomes one enormous quad with four
 * vertices at its far corners. `writeVertexLight` samples light at vertices,
 * so it would sample only those four corners and let the GPU interpolate
 * across the whole span.
 *
 * This file is the experiment that hypothesis was missing. It measures the one
 * number the hypothesis is actually about: HOW MANY BLOCKS WIDE IS THE QUAD
 * THAT A LIT VERTEX HAS TO INTERPOLATE ACROSS. If it is 1, light is sampled
 * per block and the falloff can be round. If it is 12, the GPU is drawing a
 * straight-line ramp over twelve blocks from a corner value, and no amount of
 * fixing the BFS can make that round.
 *
 * It runs on two surfaces, so the control is the same measurement rather than
 * a different one: a flat pad where greedy merging has everything to merge,
 * and the same pad chequered, where it has nothing. That is the cheap test
 * REPORTED 5a named and never ran.
 *
 * Duplicated block id rather than imported, for the reason helpers/world.js
 * gives for duplicating the others.
 */
const GLOWSTONE = 129

/** Mid-air, the same altitude and reasoning as usePad: nothing to destroy. */
const PY = 200
const CX = 60
const CZ = 0
/** Half-width. 12 gives a 25x25 pad, wider than a 15-level falloff can cross. */
const R = 12
const MIDNIGHT = 18000

/** Camera height above the pad for the top-down shots. */
const CAM_UP = 13

/** A flat stone pad with air above it, centred on (CX, CZ) at y = PY. */
async function flatPad(page) {
  await page.evaluate(([cx, cz, y, r, stone, air]) => {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        window.noa.setBlock(stone, cx + dx, y, cz + dz)
        for (let dy = 1; dy <= 6; dy++) window.noa.setBlock(air, cx + dx, y + dy, cz + dz)
      }
    }
  }, [CX, CZ, PY, R, ID.stone, ID.air])
  await waitTicks(page, 4)
}

/**
 * The control surface. Every other column is one block taller, so no two
 * adjacent top faces share a plane and the greedy mesher has nothing to merge
 * -- which is exactly the condition REPORTED 5a says would make it go round.
 */
async function chequerPad(page) {
  await page.evaluate(([cx, cz, y, r, stone, air]) => {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        window.noa.setBlock(stone, cx + dx, y, cz + dz)
        const raised = ((dx + dz) & 1) === 0
        window.noa.setBlock(raised ? stone : air, cx + dx, y + 1, cz + dz)
        for (let dy = 2; dy <= 6; dy++) window.noa.setBlock(air, cx + dx, y + dy, cz + dz)
      }
    }
  }, [CX, CZ, PY, R, ID.stone, ID.air])
  await waitTicks(page, 4)
}

/**
 * Every up-facing terrain QUAD over the pad, as {w, h, light: [4]}.
 *
 * Quad-level rather than vertex-level because the quad IS the unit the report
 * is about. noa's MeshBuilder lays vertices out four per face in a fixed order
 * -- v0 = corner, v1 = corner + width, v2 = corner + width + height, v3 =
 * corner + height (`addPositionValues`) -- so the quad's span in blocks is
 * readable straight off the buffer with no guessing.
 *
 * Alpha is un-inverted back to a 0..15 level here rather than reported in the
 * stored 1-minus form, so the numbers read like light levels.
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
            // Only the pad's own top surfaces. Without this the probe can pick
            // up whatever else in the world happens to face up nearby, and a
            // stray 13-wide quad from another test's leftovers reads as a
            // finding. Asked for and answered: see the webkit failure that
            // added this line.
            if (y !== py + 1 && y !== py + 2) continue
            if (x < cx - r - 1 || x > cx + r + 2) continue
            if (z < cz - r - 1 || z > cz + r + 2) continue
            const light = [0, 1, 2, 3].map((q) => +((1 - col[(v + q) * 4 + 3]) * 15).toFixed(1))
            out.push({
              x: x - cx,
              z: z - cz,
              y: y - py,
              w: Math.abs(wv[0]) + Math.abs(wv[1]) + Math.abs(wv[2]),
              h: Math.abs(hv[0]) + Math.abs(hv[1]) + Math.abs(hv[2]),
              light,
            })
          }
        }
      }
    }
  }
  return out
}, [CX, CZ, R, PY])

/**
 * topQuads, but not until noa's remesh queue has actually drained.
 *
 * NOT paranoia, and not a sleep. `flushDirty` queues chunks and noa meshes a
 * couple per tick, so a probe run at a fixed tick count sees a different
 * number of quads on chromium than on webkit and a different one again on a
 * slow run. During this investigation that flakiness produced two false
 * readings in a row -- a "0 lit quads" and a stale 13-block quad left over
 * from the previous test -- before the queue was waited on properly.
 *
 * `_chunksToMesh` / `_chunksToMeshFirst` are noa's two remesh queues
 * (`world.js`); empty means every dirty chunk has been rebuilt.
 */
async function settledQuads(page) {
  await page.waitForFunction(() => {
    const w = window.noa.world
    return w._chunksToMesh.count() + w._chunksToMeshFirst.count() === 0
  }, null, { timeout: 15_000 })
  await waitTicks(page, 3)
  return topQuads(page)
}

/** The widest span the GPU is asked to interpolate a light value across. */
const maxSpan = (quads) => quads.reduce((m, q) => Math.max(m, q.w, q.h), 0)

const litSpan = (quads) => quads.reduce(
  (m, q) => (q.light.some((l) => l > 0.05) ? Math.max(m, q.w, q.h) : m), 0)

const report = (tag, quads) => {
  const lit = quads.filter((q) => q.light.some((l) => l > 0.05))
  console.log(`[${tag}] up-facing quads over the 25x25 pad: ${quads.length}, of which lit: ${lit.length}`)
  console.log(`[${tag}] widest quad: ${maxSpan(quads)} blocks; widest LIT quad: ${litSpan(quads)} blocks`)
  for (const q of lit.slice(0, 10)) {
    console.log(`[${tag}]   quad at (${q.x},${q.z}) y+${q.y} ${q.w}x${q.h} corners ${q.light.join('/')}`)
  }
}

/** Look straight down at the pad centre from CAM_UP blocks up. */
async function hover(page) {
  await useGamemode(page, 'creative')
  await teleport(page, CX + 0.5, PY + CAM_UP, CZ + 0.5)
  await doubleTapFly(page)
  await teleport(page, CX + 0.5, PY + CAM_UP, CZ + 0.5)
  await look(page, { heading: HEADING.northMinusZ, pitch: Math.PI / 2 - 0.01 })
  await waitFrames(page, 4)
}

/**
 * Four mean-luminance samples at equal pixel radius from screen centre.
 *
 * Straight down, the projection is symmetric about the centre pixel, so equal
 * pixel radius IS equal world distance whatever the heading is. That is the
 * whole reason the camera points down rather than sitting at a low angle: it
 * turns "is the falloff round" into four numbers that must match.
 */
async function ringSamples(page, radius = 150, size = 28) {
  const { width, height } = page.viewportSize()
  const cx = width / 2, cy = height / 2
  const offsets = [[radius, 0], [-radius, 0], [0, radius], [0, -radius]]
  const out = []
  for (const [dx, dy] of offsets) {
    const buf = await page.screenshot({
      clip: { x: cx + dx - size / 2, y: cy + dy - size / 2, width: size, height: size },
    })
    out.push(await page.evaluate((url) => new Promise((resolve) => {
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
        resolve(+(sum / (d.length / 4) / 255).toFixed(4))
      }
      img.src = url
    }), `data:image/png;base64,${buf.toString('base64')}`))
  }
  return out
}

const spread = (v) => (Math.max(...v) - Math.min(...v)) / (Math.max(...v) || 1)

/* ------------------------------------------------------------------ *
 * The number
 * ------------------------------------------------------------------ */

test('on a flat floor, one quad ramps light across many blocks', async ({ page, terrain }) => {
  await terrain.keep([CX - R, PY - 1, CZ - R], [CX + R, PY + 6, CZ + R])
  await flatPad(page)
  await page.evaluate((t) => window.game.sky.setTime(t), MIDNIGHT)
  await page.evaluate(([id, x, y, z]) => window.noa.setBlock(id, x, y, z), [GLOWSTONE, CX, PY + 1, CZ])
  await waitTicks(page, 8)

  const quads = await settledQuads(page)
  report('flat', quads)

  // A sanity floor first: zero quads would mean nothing was meshed, and every
  // assertion below would pass vacuously. That is how a probe lies.
  expect(quads.length).toBeGreaterThan(0)
  // 625 top faces unmerged would be 625 quads. Greedy merging eats nearly all
  // of them and the survivors are enormous.
  expect(quads.length).toBeLessThan(100)
  // THE FINDING, stated as the mechanism rather than as a light value, because
  // WHICH quad ends up lit depends on where in the chunk the emitter sits and
  // that is the symptom, not the cause. The cause is that the floor is made of
  // spans many blocks wide and `writeVertexLight` can only write their corners.
  expect(maxSpan(quads)).toBeGreaterThan(3)
})

test('chequer the same floor and every lit quad is one block wide', async ({ page, terrain }) => {
  await terrain.keep([CX - R, PY - 1, CZ - R], [CX + R, PY + 6, CZ + R])
  await chequerPad(page)
  await page.evaluate((t) => window.game.sky.setTime(t), MIDNIGHT)
  await page.evaluate(([id, x, y, z]) => window.noa.setBlock(id, x, y, z), [GLOWSTONE, CX, PY + 2, CZ])
  await waitTicks(page, 8)

  const quads = await settledQuads(page)
  report('chequer', quads)

  expect(quads.length).toBeGreaterThan(100)
  // The control. Same BFS, same writeVertexLight, same shader -- the only
  // thing that changed is whether the mesher CAN merge, and the span collapses
  // to one block, which is the resolution the falloff needs to go round.
  expect(maxSpan(quads)).toBe(1)
  expect(litSpan(quads)).toBe(1)
})

/* ------------------------------------------------------------------ *
 * The pixels -- evidence, not assertion
 * ------------------------------------------------------------------ */

test('flat pad: the falloff around a glowstone, photographed from above', async ({ page, terrain }) => {
  await terrain.keep([CX - R, PY - 1, CZ - R], [CX + R, PY + 6, CZ + R])
  await flatPad(page)
  await page.evaluate((t) => window.game.sky.setTime(t), MIDNIGHT)
  await page.evaluate(([id, x, y, z]) => window.noa.setBlock(id, x, y, z), [GLOWSTONE, CX, PY + 1, CZ])
  await waitTicks(page, 8)
  await hover(page)
  await shot(page, 'glowstone-flat-top')
  console.log(`[flat] ring +x/-x/+z/-z: ${(await ringSamples(page)).join(' / ')}`)

  await teleport(page, CX + 0.5, PY + 4, CZ + 9)
  await look(page, { heading: HEADING.northMinusZ, pitch: 0.55 })
  await waitFrames(page, 4)
  await shot(page, 'glowstone-flat-low')
})

test('chequered pad: the same falloff where nothing can merge', async ({ page, terrain }) => {
  await terrain.keep([CX - R, PY - 1, CZ - R], [CX + R, PY + 6, CZ + R])
  await chequerPad(page)
  await page.evaluate((t) => window.game.sky.setTime(t), MIDNIGHT)
  await page.evaluate(([id, x, y, z]) => window.noa.setBlock(id, x, y, z), [GLOWSTONE, CX, PY + 2, CZ])
  await waitTicks(page, 8)
  await hover(page)
  await shot(page, 'glowstone-chequer-top')
  console.log(`[chequer] ring +x/-x/+z/-z: ${(await ringSamples(page)).join(' / ')}`)
})
