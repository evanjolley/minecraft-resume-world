import { test, expect } from './fixtures.js'
import { waitTicks, teleport, look, waitFrames, useGamemode, doubleTapFly, ID, HEADING, SURFACE_Y } from './helpers/world.js'
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
              // The two edge vectors in the floor plane, kept signed and
              // separate. For an UP face noa's "width" runs along +z and its
              // "height" along +x (addPositionValues: du indexes 2 when the
              // axis is y, dv indexes 0) -- the opposite of what the names
              // suggest. Carrying the vectors instead of the magnitudes means
              // the sampler below never has to know that.
              ux: wv[0], uz: wv[2], vx: hv[0], vz: hv[2],
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
const drained = (page) => page.waitForFunction(() => {
  const w = window.noa.world
  return w._chunksToMesh.count() + w._chunksToMeshFirst.count() === 0
}, null, { timeout: 15_000 })

async function settledQuads(page) {
  await drained(page)
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

test('on a flat floor, no quad light touches is wider than a block', async ({ page, terrain }) => {
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
  /*
   * WHAT THIS ASSERTED BEFORE THE FIX, and why it was inverted rather than
   * deleted. It used to read `expect(quads.length).toBeLessThan(100)` and
   * `expect(maxSpan(quads)).toBeGreaterThan(3)` -- it was the measurement that
   * PROVED the bug, and the numbers it printed are in docs/REPORTED.md 5a: 625
   * floor blocks became 17 quads, the widest 13 blocks across, carrying corner
   * light levels 2/0/1/13. The same probe now measures the fix, because the
   * quantity it reads is the same one either way.
   *
   * `litSpan` rather than `maxSpan` on purpose. `writeVertexLight` splits only
   * the quads light actually reaches; a quad nothing lights is still free to
   * be as wide as greedy meshing can make it, and on a bigger pad than this
   * one some would be. Asserting maxSpan === 1 would be asserting that greedy
   * meshing had been thrown away, which is the thing the fix refuses to do.
   *
   * This pad is 25x25 and a glowstone reaches 13 blocks across a floor, so
   * here the light happens to touch everything and the two are equal.
   */
  expect(quads.length).toBeGreaterThan(400)
  expect(litSpan(quads)).toBe(1)
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

/* ------------------------------------------------------------------ *
 * The fix, asserted -- is the falloff actually round
 * ------------------------------------------------------------------ */

/**
 * What the GPU draws at one point on the floor, in light levels.
 *
 * The three tests above measure the MECHANISM (how wide a quad is). This one
 * measures the SYMPTOM, and it has to, because the mechanism assertion above
 * still passes after the fix: a quad is still allowed to be 13 blocks wide if
 * no light touches it. So this reads the same buffers and does by hand what
 * the rasteriser does -- find the up-facing quad covering a point, interpolate
 * its four corner light values across it -- which turns "is the falloff round"
 * into four numbers that have to match.
 *
 * Sampled at VOXEL CENTRES (+0.5), not at lattice points. A vertex at lattice
 * x averages the two voxels x-1 and x, so lattice points are half a block off
 * the emitter's own centre and are NOT mirror-symmetric about it; voxel
 * centres are. Sampling on the lattice would fail a correct fix by half a
 * block, which is the kind of "failure" that gets a good fix reverted.
 *
 * Bilinear rather than per-triangle on purpose. A voxel centre lands exactly
 * on a unit sub-quad's diagonal once the fix is in, where the two triangles
 * agree with each other but not with bilinear, and whichever diagonal
 * `decideTriDir` picked is not guaranteed to mirror. Bilinear at (0.5, 0.5) is
 * the mean of all four corners, which mirrors exactly.
 */
function sampleAt(quads, x, z) {
  for (const q of quads) {
    // v0 = corner, v1 = corner + u, v2 = corner + u + v, v3 = corner + v.
    // Solve (x,z) - corner = s*u + t*v for the quad's own parameters, so the
    // sampler works whichever axis noa's width landed on.
    const det = q.ux * q.vz - q.uz * q.vx
    if (!det) continue
    const dx = x - q.x, dz = z - q.z
    const s = (dx * q.vz - dz * q.vx) / det
    const t = (q.ux * dz - q.uz * dx) / det
    if (s < 0 || s > 1 || t < 0 || t > 1) continue
    const [l0, l1, l2, l3] = q.light
    return (1 - s) * (1 - t) * l0 + s * (1 - t) * l1 + s * t * l2 + (1 - s) * t * l3
  }
  return null
}

/** Radii sampled, in blocks. 8 is comfortably inside a 15-level falloff. */
const RADII = [2, 4, 6, 8]

/** The four axis samples at radius r from the emitter, in light levels. */
const ring = (quads, r) => [[r, 0], [-r, 0], [0, r], [0, -r]]
  .map(([dx, dz]) => sampleAt(quads, dx + 0.5, dz + 0.5))

test('on a flat floor, the falloff is the same in all four directions', async ({ page, terrain }) => {
  await terrain.keep([CX - R, PY - 1, CZ - R], [CX + R, PY + 6, CZ + R])
  await flatPad(page)
  await page.evaluate((t) => window.game.sky.setTime(t), MIDNIGHT)
  await page.evaluate(([id, x, y, z]) => window.noa.setBlock(id, x, y, z), [GLOWSTONE, CX, PY + 1, CZ])
  await waitTicks(page, 8)

  const quads = await settledQuads(page)
  // The vacuous-pass guard. Zero quads, or a hole in the pad where no quad
  // covers a sample point, would make every comparison below meaningless.
  expect(quads.length).toBeGreaterThan(0)

  // Every radius measured and logged BEFORE anything is asserted. An
  // expect() inside the loop stops at the first failure and hides the shape of
  // the wrongness, which on this bug is the whole diagnosis -- pre-fix the
  // near ring is nearly symmetric and the far ring is not.
  const rings = RADII.map((r) => ring(quads, r))
  RADII.forEach((r, i) => {
    const [px, mx, pz, mz] = rings[i]
    console.log(`[radial] r=${r}  +x ${px} / -x ${mx} / +z ${pz} / -z ${mz}`)
  })

  for (let i = 0; i < RADII.length; i++) {
    const [px, mx, pz, mz] = rings[i]
    for (const v of [px, mx, pz, mz]) expect(v).not.toBeNull()
    // Round, not directional. The light field the BFS builds is symmetric
    // about the emitter, so anything that samples it at the right resolution
    // must come out symmetric too. Pre-fix the floor is one huge quad and the
    // GPU ramps a single corner value across it, so these four disagree
    // wildly -- or are all zero, because no corner is within 15 blocks.
    expect(Math.abs(px - mx)).toBeLessThan(0.05)
    expect(Math.abs(pz - mz)).toBeLessThan(0.05)
    expect(Math.abs(px - pz)).toBeLessThan(0.05)
  }

  // The mechanism, restated as the fix rather than as the bug: once light
  // touches a quad it is one block wide, so there is no span left to ramp
  // across. Pre-fix this is 13. Quads light never reaches are still allowed to
  // be as wide as the mesher likes -- that is the whole point of splitting
  // only the lit ones.
  expect(litSpan(quads)).toBe(1)

  // ...and it has to actually be lit, decaying with distance. Four matching
  // zeroes are symmetric too, and that is exactly what the unfixed code does
  // on a pad this size (REPORTED 5a: "it is unlit").
  const near = rings[0][0]
  const far = rings[RADII.length - 1][0]
  console.log(`[radial] r=2 ${near} vs r=8 ${far}`)
  expect(near).toBeGreaterThan(8)
  expect(far).toBeGreaterThan(0)
  expect(near).toBeGreaterThan(far + 3)
})

/* ------------------------------------------------------------------ *
 * The budget -- splitting quads costs vertices, so count them
 * ------------------------------------------------------------------ */

/** Every terrain vertex currently loaded, across every chunk mesh. */
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
 * The cost side of the fix, as a number rather than a hope.
 *
 * Splitting lit quads into unit sub-quads undoes greedy meshing exactly where
 * the light is, which is the trade. The budget the fix was accepted under is
 * ~25% more terrain vertices in a scene with a handful of emitters; anything
 * past that means splitting everything a light touches is the wrong rule and
 * the split should be radius-clipped instead.
 *
 * Measured on the real world rather than the synthetic pad, because the pad is
 * the pathological case by construction and the world is what Evan flies over.
 */
test('a few glowstones do not blow the terrain vertex budget', async ({ page }) => {
  // Back on the island, not in the mid-air pad this file has been building.
  // The pad is the pathological case by construction; the island is what Evan
  // flies over, and it is what the budget has to hold on.
  await useGamemode(page, 'creative')
  await teleport(page, 0.5, SURFACE_Y + 2, 0.5)
  await page.evaluate(() => window.game.sky.setTime(18000))
  await waitTicks(page, 20)
  await drained(page)
  const before = await totalTerrainVerts(page)

  const at = await page.evaluate((id) => {
    const p = window.noa.entities.getPosition(window.noa.playerEntity)
    const out = []
    for (const [dx, dz] of [[6, 0], [-6, 4], [0, -7]]) {
      const x = Math.floor(p[0]) + dx, z = Math.floor(p[2]) + dz
      // Drop it on whatever the surface is, so it lights a real floor.
      let y = Math.floor(p[1]) + 3
      while (y > Math.floor(p[1]) - 6 && window.noa.getBlock(x, y - 1, z) === 0) y--
      window.noa.setBlock(id, x, y, z)
      out.push([x, y, z])
    }
    return out
  }, GLOWSTONE)
  await waitTicks(page, 10)
  await drained(page)

  const after = await totalTerrainVerts(page)
  const added = after.verts - before.verts
  console.log(`[budget] glowstones at ${JSON.stringify(at)}`)
  console.log(`[budget] terrain verts ${before.verts} -> ${after.verts} (+${added}, ${((added / before.verts) * 100).toFixed(1)}%) over ${after.meshes} meshes`)
  console.log(`[budget] ${(added / at.length).toFixed(0)} vertices per emitter`)
  console.log(`[budget] last chunk's vertex-light pass: ${await page.evaluate(() => window.blockLight.lastMeshMs())} ms`)

  expect(before.verts).toBeGreaterThan(0)
  /*
   * PER EMITTER, not as a percentage of the scene, and the difference is the
   * whole reason this assertion is worth having.
   *
   * A percentage budget cannot be stated here. This world is largely flat
   * superflat ground, which greedy meshing collapses to almost nothing -- a
   * loaded neighbourhood can be a few hundred vertices in total -- so ANY
   * per-block lighting is a four-figure percentage against it, including a
   * perfect one. The percentage is logged because it is the number that was
   * asked for, and it is not asserted on because it measures the denominator.
   *
   * What CAN be stated is the cost of one emitter, because it is bounded by
   * geometry rather than by the scene. A glowstone reaches 15 levels, so on
   * open floor it lights a Manhattan disc about 31 blocks across; splitting
   * that to unit cells at four vertices each is roughly 4 * 31 * 31 / 2. This
   * ceiling is a little over that and well under the ~16k a WHOLE 32x32 quad
   * would cost if the split were not clipped to the lit region -- so it fails
   * loudly if anyone removes the clip, which is the regression worth catching.
   */
  expect(added / at.length).toBeLessThan(3000)
})

/* ------------------------------------------------------------------ *
 * The T-junction -- where a split quad meets one that was left merged
 * ------------------------------------------------------------------ */

/** Half-width of the wide pad. 20 gives 41x41, well past a 13-block reach. */
const WIDE = 20

/**
 * The objection the fix had to answer, turned into an assertion.
 *
 * Splitting only the lit quads puts sub-quad vertices in the middle of an
 * unsplit neighbour's edge. That is a T-junction, and a T-junction normally
 * shows as a seam, because the two sides interpolate different values across
 * the same line. Here it cannot, and this test says why in the form of an
 * invariant rather than a paragraph:
 *
 *     EVERY QUAD WIDER THAN ONE BLOCK CARRIES ZERO LIGHT AT ALL FOUR CORNERS.
 *
 * If that holds, every merged quad is uniformly dark across its whole surface,
 * so whatever a split neighbour does along the shared edge it is interpolating
 * between two zeroes on both sides. There is no value for the seam to
 * disagree about. Nothing is being trusted here -- if `writeVertexLight` ever
 * leaves a wide quad with a lit corner, that is a smear, and this fails.
 *
 * It needs a pad bigger than a glowstone's reach, which is why it is not
 * folded into the 25x25 tests above: there the light touches every quad and
 * there is no merged neighbour left to have a junction with.
 */
test('light stopping mid-floor leaves the merged quads beyond it seamless', async ({ page, terrain }) => {
  await terrain.keep([CX - WIDE, PY - 1, CZ - WIDE], [CX + WIDE, PY + 6, CZ + WIDE])
  await page.evaluate(([cx, cz, y, r, stone, air]) => {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        window.noa.setBlock(stone, cx + dx, y, cz + dz)
        for (let dy = 1; dy <= 6; dy++) window.noa.setBlock(air, cx + dx, y + dy, cz + dz)
      }
    }
  }, [CX, CZ, PY, WIDE, ID.stone, ID.air])
  await waitTicks(page, 4)
  await page.evaluate((t) => window.game.sky.setTime(t), MIDNIGHT)
  await page.evaluate(([id, x, y, z]) => window.noa.setBlock(id, x, y, z), [GLOWSTONE, CX, PY + 1, CZ])
  await waitTicks(page, 8)
  await drained(page)
  await waitTicks(page, 3)

  const quads = await page.evaluate(([cx, cz, r, py]) => {
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
              const y = chunk.y + corner[1]
              if (y !== py + 1) continue
              const x = chunk.x + corner[0], z = chunk.z + corner[2]
              if (x < cx - r - 1 || x > cx + r + 2) continue
              if (z < cz - r - 1 || z > cz + r + 2) continue
              out.push({
                x: x - cx,
                z: z - cz,
                w: Math.abs(wv[0]) + Math.abs(wv[1]) + Math.abs(wv[2]),
                h: Math.abs(hv[0]) + Math.abs(hv[1]) + Math.abs(hv[2]),
                light: [0, 1, 2, 3].map((q) => +((1 - col[(v + q) * 4 + 3]) * 15).toFixed(2)),
              })
            }
          }
        }
      }
    }
    return out
  }, [CX, CZ, WIDE, PY])

  const wide = quads.filter((q) => q.w > 1 || q.h > 1)
  const unit = quads.filter((q) => q.w === 1 && q.h === 1)
  const lit = quads.filter((q) => q.light.some((l) => l > 0))
  console.log(`[tjunction] ${quads.length} up-facing quads: ${unit.length} unit, ${wide.length} still merged`)
  console.log(`[tjunction] widest ${maxSpan(quads)} blocks; widest LIT ${litSpan(quads)}; lit quads ${lit.length}`)
  for (const q of wide.slice(0, 6)) {
    console.log(`[tjunction]   merged quad at (${q.x},${q.z}) ${q.w}x${q.h} corners ${q.light.join('/')}`)
  }

  expect(quads.length).toBeGreaterThan(0)
  // Both halves have to exist or the invariant below is vacuous: greedy
  // meshing must have survived somewhere, and the split must have happened
  // somewhere. A pad this size gives both.
  expect(wide.length).toBeGreaterThan(0)
  expect(unit.length).toBeGreaterThan(100)
  expect(maxSpan(quads)).toBeGreaterThan(3)

  // THE INVARIANT. Nothing wide is lit, so nothing wide can smear, so no seam
  // between a split quad and a merged one has two different values to show.
  for (const q of wide) expect(Math.max(...q.light)).toBe(0)
  expect(litSpan(quads)).toBe(1)

  // The picture, so the claim can be checked by eye as well as by number.
  await hover(page)
  await shot(page, 'glowstone-wide-top')
  await teleport(page, CX + 0.5, PY + 4, CZ + 16)
  await look(page, { heading: HEADING.northMinusZ, pitch: 0.4 })
  await waitFrames(page, 4)
  await shot(page, 'glowstone-wide-low')
})
