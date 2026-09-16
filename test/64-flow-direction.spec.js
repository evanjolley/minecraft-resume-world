import { test, expect } from './fixtures.js'
import { aim, teleport, waitFrames } from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * FLOWING WATER LOOKS LIKE IT IS GOING SOMEWHERE.
 *
 * Reported from play, after the shape landed: the water spreads and slopes
 * correctly and still does not read as MOVING in any particular direction. It
 * shimmers in place like a pond, because every flow id was registered against
 * `water_still` -- animated, but with a texture that has no direction in it.
 *
 * Vanilla's answer is a second texture, `water_flow.png`, whose streaks run
 * down the tile, and a per-cell UV rotation that points those streaks
 * downhill (LiquidBlockRenderer: `atan2(vec3.z, vec3.x) - PI/2`).
 *
 * WHAT THIS FILE MEASURES, and why it is the vertex buffer rather than pixels.
 * The rotation is a claim about four UV pairs in a mesh, and a screenshot of
 * 16px water under a moving animation cannot tell a rotated tile from an
 * unrotated one with any honesty. So the assertions read the FINISHED vertex
 * buffers -- the same buffers src/fluidGeometry.js rewrites -- and ask two
 * questions a still texture cannot answer yes to:
 *
 *   1. does this quad sample the flow run's atlas layer at all, and
 *   2. does its v axis point the way the water is going?
 *
 * The second is the whole feature. `water_flow.png` streams toward +v, so "v
 * increases downstream" IS "the current goes that way". It is measured as a
 * gradient over the quad's own four corners, which makes it independent of
 * where the chunk sits: noa meshes in chunk-local space and offsets the node,
 * so a DELTA is comparable across meshes and an absolute position is not.
 *
 * IT DISCRIMINATES, AND THE MUTATIONS WERE RUN -- see the notes on each test.
 */

/*
 * A one-wide channel that ENDS IN A DROP.
 *
 * 57-flowing-water's channel is closed at both ends because it is measuring a
 * profile. This one is open at x = 7 so the run pours off into open air, which
 * is the thing the owner actually looked at and said was not moving: a ledge.
 *
 * Walls make the flow one-dimensional, which is what lets every assertion
 * below be a statement about ONE direction instead of a radial field. The near
 * wall is glass so the side-on screenshot can see the profile and the fall at
 * the same time.
 *
 * y = 264 rather than 240: 57 owns 240 and the suite shares one booted world.
 */
const Y = 264
const GLASS = 302
const STONE = 3
const WATER = 636
const EDGE = 7

async function buildLedge(page) {
  await teleport(page, 3.5, Y + 9, 0.5)
  await page.evaluate(() => {
    const flow = window.game.fluids.flow
    flow.setEnabled(false)
    flow.reset()
  })
  await page.waitForFunction(([y, glass, stone, edge]) => {
    const noa = window.noa
    for (let x = -3; x <= edge + 6; x++) {
      for (let z = -4; z <= 7; z++) {
        for (let dy = -2; dy < 6; dy++) noa.setBlock(0, x, y + dy, z)
      }
    }
    for (let x = -1; x < edge; x++) {
      noa.setBlock(stone, x, y - 1, 0)
      for (let dy = 0; dy < 2; dy++) {
        noa.setBlock(stone, x, y + dy, -1)
        noa.setBlock(glass, x, y + dy, 1)
      }
    }
    for (let dy = 0; dy < 2; dy++) noa.setBlock(stone, -1, y + dy, 0)
    // Probe both ends: the channel spans several chunks that arrive
    // independently (41-fluid-flow and 57 both paid for this lesson).
    return noa.getBlock(edge - 1, y - 1, 0) === stone && noa.getBlock(-1, y - 1, 0) === stone
  }, [Y, GLASS, STONE, EDGE], { timeout: 30_000, polling: 100 })
}

/** Pour, and settle the flow engine by hand so the picture is not a race. */
const pour = (page) => page.evaluate(([y, water]) => {
  window.noa.setBlock(water, 0, y, 0)
  const flow = window.game.fluids.flow
  for (let i = 0; i < 4000; i++) { flow.run(1, 50); if (flow.pendingCount === 0) return i * 50 }
  return -1
}, [Y, WATER])

/** The flow run's atlas layer, straight from the geometry pass. */
const layerOf = (page, fluid) => page.evaluate(([f]) =>
  window.game.fluids.flow.geometry.flowLayer(f), [fluid])

/*
 * Every upward-facing quad in one voxel ROW that samples the flow run, with
 * the flow vector of the cell it belongs to and the gradient of its UVs.
 *
 * Read in one evaluate so the picture and the model are sampled from the same
 * instant, and reported together so the comparison is "these agree" rather
 * than "this matches a direction the spec made up".
 *
 * WORLD COORDINATES, because noa meshes in chunk-local space: a vertex's world
 * position is its local position plus the mesh node's position plus
 * `noa.worldOriginOffset`, the shift noa applies to keep float precision near
 * the player. Getting that wrong is how this file first went red against
 * correct code -- it matched quads from the island's own shoreline water, a
 * hundred blocks below, against the channel's flow vectors, which is a spec
 * measuring two unrelated things and calling it a bug.
 *
 * The GRADIENT is solved from the quad's own four corners rather than read off
 * any one of them, which makes it independent of where the chunk sits: a
 * DELTA is comparable across meshes and an absolute position is not. The quad
 * is a parallelogram, so two edges from corner 0 span it and the 2x2 solve is
 * exact -- no fitting, no tolerance of its own.
 */
const readFlowTops = (page, layer, row) => page.evaluate(([l, y]) => {
  const noa = window.noa
  const off = noa.worldOriginOffset
  const flow = window.game.fluids.flow
  const out = []
  for (const mesh of noa.rendering.getScene().meshes) {
    const a = mesh.getVerticesData('texAtlasIndices')
    if (!a) continue
    const p = mesh.getVerticesData('position')
    const n = mesh.getVerticesData('normal')
    const uv = mesh.getVerticesData('uv')
    if (!p || !n || !uv) continue
    for (let q = 0; q * 4 < a.length; q++) {
      const v0 = q * 4
      if (Math.round(a[v0]) !== l) continue
      if (n[v0 * 3 + 1] < 0.5) continue
      const wx = (p[v0 * 3] + p[(v0 + 2) * 3]) / 2 + mesh.position.x + off[0]
      const wz = (p[v0 * 3 + 2] + p[(v0 + 2) * 3 + 2]) / 2 + mesh.position.z + off[2]
      /*
       * The ROW is the awkward one. A top face has already been DROPPED to the
       * fluid surface by the same pass that textured it, so its y is a
       * fraction somewhere inside the voxel. The highest corner is in
       * (voxelY, voxelY + 1], so ceil() - 1 names the voxel for every height
       * including a full one.
       */
      let maxY = -Infinity
      for (let c = 0; c < 4; c++) maxY = Math.max(maxY, p[(v0 + c) * 3 + 1])
      const cell = [Math.floor(wx), Math.ceil(maxY + mesh.position.y + off[1]) - 1, Math.floor(wz)]
      // Only the row the fixture built. The spill past the ledge lands on rows
      // below, and the island has water of its own.
      if (cell[1] !== y) continue
      const f = flow.flowVectorAt(cell[0], cell[1], cell[2])
      if (f[0] === 0 && f[2] === 0) continue
      // Two spanning edges of the quad, corner 0 -> 1 and corner 0 -> 3.
      const e1 = [p[(v0 + 1) * 3] - p[v0 * 3], p[(v0 + 1) * 3 + 2] - p[v0 * 3 + 2]]
      const e3 = [p[(v0 + 3) * 3] - p[v0 * 3], p[(v0 + 3) * 3 + 2] - p[v0 * 3 + 2]]
      const d1 = [uv[(v0 + 1) * 2] - uv[v0 * 2], uv[(v0 + 1) * 2 + 1] - uv[v0 * 2 + 1]]
      const d3 = [uv[(v0 + 3) * 2] - uv[v0 * 2], uv[(v0 + 3) * 2 + 1] - uv[v0 * 2 + 1]]
      const det = e1[0] * e3[1] - e1[1] * e3[0]
      if (Math.abs(det) < 1e-9) continue
      // Inverse of [e1 e3] applied to the uv deltas: d(uv)/d(world xz).
      const grad = (da, db) => [
        (da * e3[1] - db * e1[1]) / det,
        (-da * e3[0] + db * e1[0]) / det,
      ]
      out.push({ cell, flow: [f[0], f[2]], u: grad(d1[0], d3[0]), v: grad(d1[1], d3[1]) })
    }
  }
  return out
}, [layer, row])

/*
 * POLLED, not read once: the channel spans several chunks and noa remeshes
 * them asynchronously after the pour, so one read lands mid-remesh and sees
 * whichever chunks happen to be finished (57 spells this out at length). The
 * condition is the count the caller is about to assert on.
 */
async function settledFlowTops(page, layer) {
  let quads = await readFlowTops(page, layer, Y)
  for (let i = 0; i < 60 && quads.length < 4; i++) {
    await waitFrames(page, 2)
    quads = await readFlowTops(page, layer, Y)
  }
  return quads
}

test.afterEach(async ({ page }) => {
  await page.evaluate(() => {
    if (window.__flowPin) { window.noa.off('tick', window.__flowPin); window.__flowPin = null }
    // 45-buckets and 46-water-look need the engine running, and this file is
    // the one that switched it off. Same teardown 39 writes, same reason.
    window.game.fluids.flow.setEnabled(true)
  })
})

test.describe('flowing water has a direction you can see', () => {
  /*
   * IT DISCRIMINATES, AND THE MUTATION WAS RUN. In src/terrainAnimation.js the
   * `water_flow` entry was removed from STANDALONE, which is what a build with
   * no flow artwork at all looks like:
   *
   *   Error: expect(received).toBeGreaterThan(expected)
   *   Expected: > 0
   *   Received:   -1
   *
   * That is the guard that tells "the texture is missing" apart from "the
   * texture is there and no quad picked it", which is the next test.
   */
  test('the flow texture is in the atlas, on the water page', async ({ page }) => {
    expect(await layerOf(page, 'water')).toBeGreaterThan(0)
    expect(await layerOf(page, 'lava')).toBeGreaterThan(0)
    // Different pages, so different layer numbers would be a coincidence --
    // but both must be past their page's regular materials, which is what
    // "appended after the page's materials" means.
    expect(await layerOf(page, 'nonsense')).toBe(-1)
  })

  /*
   * IT DISCRIMINATES, AND BOTH MUTATIONS WERE RUN.
   *
   * In src/fluidGeometry.js the top-face branch was changed to leave `layer`
   * at -1, so a flowing cell keeps the still texture -- which is exactly what
   * shipped before this change:
   *
   *   Error: expect(received).toBeGreaterThanOrEqual(expected)
   *   Expected: >= 4
   *   Received:    0
   *
   * And with `flowUV` flattened to `return [0.5 + dx, 0.5 + dz]` -- the flow
   * texture sampled, but never turned to face anywhere -- the next test goes:
   *
   *   Error: cell 0,264,0 draws its streaks along its own flow vector
   *   Expected: > 0.999
   *   Received:   0
   *
   * (Zero rather than -1: an unrotated tile's v axis runs along world z, which
   * is exactly perpendicular to a channel running along x. A cosine of zero is
   * water whose streaks cross the current at a right angle.)
   */
  test('the surface of a flowing run samples the flow texture', async ({ page, terrain }) => {
    await terrain.keep([-3, Y - 2, -4], [EDGE + 6, Y + 5, 7])
    await buildLedge(page)
    await pour(page)
    const quads = await settledFlowTops(page, await layerOf(page, 'water'))
    // Seven flowing cells plus the source, less whatever a chunk boundary
    // happens to be mid-remeshing. Four is a floor that cannot be an accident.
    expect(quads.length).toBeGreaterThanOrEqual(4)
    // ...spread along the run, so that was not four reads of one cell.
    expect(new Set(quads.map(q => q.cell[0])).size).toBeGreaterThanOrEqual(4)
  })

  test('...and its streaks point downstream, cell by cell', async ({ page, terrain }) => {
    await terrain.keep([-3, Y - 2, -4], [EDGE + 6, Y + 5, 7])
    await buildLedge(page)
    await pour(page)
    const quads = await settledFlowTops(page, await layerOf(page, 'water'))
    expect(quads.length).toBeGreaterThanOrEqual(4)

    for (const { cell, flow, u, v } of quads) {
      const fl = Math.hypot(flow[0], flow[1])
      const vl = Math.hypot(v[0], v[1])
      /*
       * THE ASSERTION THIS FILE EXISTS FOR. The texture's v axis is the
       * direction `water_flow.png`'s streaks run, and it must be the SAME
       * direction the flow vector points -- the vector that already slopes the
       * surface and shoves the player. Cosine of 1 is "the same direction";
       * anything else is a picture disagreeing with the physics.
       */
      const cos = (v[0] * flow[0] + v[1] * flow[1]) / (fl * vl)
      expect(cos, `cell ${cell} draws its streaks along its own flow vector`)
        .toBeGreaterThan(0.999)

      /*
       * HALF SCALE, and it is vanilla's number rather than a nicety: the quad
       * takes the middle 8x8 of a 16x16 tile (LiquidBlockRenderer's `* 0.25F`
       * on each of two corner offsets), so the rotated square cannot run off
       * the tile no matter which way it points. One block of world therefore
       * covers half a tile of texture.
       */
      expect(vl, 'one block of flow covers half a tile').toBeCloseTo(0.5, 6)

      // u is the perpendicular, same scale. Together with v that is a
      // rotation: orthogonal, equal length, no shear.
      expect(Math.hypot(u[0], u[1])).toBeCloseTo(0.5, 6)
      expect(u[0] * v[0] + u[1] * v[1]).toBeCloseTo(0, 6)
    }
  })

  /*
   * EVIDENCE, NOT AN ASSERTION. The side shot is the one the report was about
   * -- water going off a ledge -- and the overhead shot is the one where a
   * rotation is actually visible, because a top face seen edge-on is three
   * pixels tall. Neither can be turned into a number honestly; the numbers are
   * above.
   */
  test('evidence: the ledge, side on and from above', async ({ page, terrain }) => {
    await terrain.keep([-3, Y - 2, -4], [EDGE + 6, Y + 5, 7])
    await buildLedge(page)
    await pour(page)

    const pin = (x, y, z) => page.evaluate(([a, b, c]) => {
      const noa = window.noa
      if (window.__flowPin) noa.off('tick', window.__flowPin)
      window.__flowPin = () => {
        noa.entities.setPosition(noa.playerEntity, a, b, c)
        const body = noa.ents.getPhysics(noa.playerEntity).body
        body.velocity[0] = body.velocity[1] = body.velocity[2] = 0
      }
      noa.on('tick', window.__flowPin)
    }, [x, y, z])

    /*
     * Side on, through the glass wall, eye at the waterline. The eye height is
     * the fussy part: Y - 1 is the channel FLOOR block, which fills y-1..y, so
     * a camera at Y - 1.1 is underneath it looking at the underside of the
     * world. Y + 1.2 is a shade above the water and sees the run and the fall
     * at the ledge in the same frame.
     */
    await pin(5.5, Y + 1.2, 6.5)
    await aim(page, { heading: Math.PI, pitch: 0.16 })
    await waitFrames(page, 10)
    await shot(page, 'flow-direction-side')

    // Straight down on the run, which is the only angle a rotated 16px tile is
    // actually legible from. Two blocks up, over the middle of the run: far
    // enough to see several cells, close enough that one cell is a few hundred
    // screen pixels rather than a dozen.
    await pin(2.5, Y + 2.2, 0.5)
    await aim(page, { heading: Math.PI, pitch: Math.PI / 2 })
    await waitFrames(page, 10)
    await shot(page, 'flow-direction-above')
  })
})
