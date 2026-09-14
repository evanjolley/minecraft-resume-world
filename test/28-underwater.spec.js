import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { test, expect } from './fixtures.js'
import {
  MAX_X, MAX_Z, MIN_X, MIN_Z, look, teleport, waitFrames, waitTicks,
} from './helpers/world.js'

/*
 * Being under water has to LOOK like being under water.
 *
 * The bug in one sentence: six blocks under the ocean, looking up, you saw
 * clouds. Nothing in this world or in noa had ever set `scene.fogMode`.
 *
 * THREE LAYERS OF ASSERTION, and the order matters, because each one passes
 * while the next is still false:
 *
 *   1. the module's own state       -- a boolean flipped
 *   2. scene.fogDensity             -- the boolean reached Babylon
 *   3. the FOG define on the TERRAIN materials, and the pixels
 *
 * (3) is the whole point. noa's `terrainMaterials.js` calls `mat.freeze()`,
 * which sets `checkReadyOnlyOnce`, so `prepareDefines` never runs again and
 * the `FOG` define is whatever it was at the moment the material was built.
 * Turn fog on after boot and (1) and (2) both pass, the fog works beautifully
 * on the clouds, the sun and dropped items, and the WORLD is not fogged at
 * all. A spec that stops at (2) would have shipped that.
 *
 * NO COORDINATES ARE WRITTEN DOWN. The world's X axis is being unmirrored in
 * a parallel change, so any X in this file would be wrong tomorrow. The ocean
 * is found by scanning the GENERATOR (`game.voxelAt`, which answers for
 * unloaded chunks too, unlike `noa.getBlock`) for a sea-level column that is
 * water with air over it and water well below it.
 */

/* Where the after-shots go: beside docs/water/before-*.png, which is the
 * comparison the owner judges this by. Deliberately NOT test/screenshots/,
 * which is gitignored -- these are meant to be committed next to the befores. */
const DOCS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'water')
const shot = (page, name) => page.screenshot({ path: path.join(DOCS, `${name}.png`) })

/** How far under the surface the "under" shots are taken. Matches the befores. */
const DEPTH = 6

/**
 * Find an ocean column: surface water with air above it, at least DEPTH+4
 * blocks deep, and as far from the patch edge as the scan can manage.
 *
 * Returns { x, z, surfaceY } in world coordinates, or null.
 */
const findOcean = (page) => page.evaluate(({ x0, x1, z0, z1 }) => {
  const { voxelAt, fluids } = window.game
  const water = fluids.ids.water

  let best = null
  for (let y = 80; y >= 40; y--) {
    for (let x = x0; x <= x1; x += 2) {
      for (let z = z0; z <= z1; z += 2) {
        if (voxelAt(x, y, z) !== water) continue
        if (voxelAt(x, y + 1, z) !== 0) continue
        // Deep enough to stand well under, with water all the way down.
        let ok = true
        for (let d = 1; d <= 10; d++) if (voxelAt(x, y - d, z) !== water) { ok = false; break }
        if (!ok) continue
        best = { x, z, surfaceY: y }
        break
      }
      if (best) break
    }
    if (best) break
  }
  return best
}, { x0: MIN_X + 2, x1: MAX_X - 2, z0: MIN_Z + 2, z1: MAX_Z - 2 })

/*
 * Hold the player exactly where a shot wants them.
 *
 * NOT a nicety. Under software GL a frame can take a fifth of a second, so the
 * handful of frames between "teleport" and "screenshot" is long enough to fall
 * eight blocks -- which is how the first run of this file teleported to a
 * viewpoint ABOVE the ocean and photographed the inside of it. Pinning is
 * cheaper and clearer than fighting gravity with flight mode.
 *
 * Removed in afterEach rather than at the end of each test body, because a
 * failed assertion skips the rest of the body and every later test in the
 * shared world would inherit a player nailed to the sea floor.
 */
const pin = (page, x, y, z) => page.evaluate(([a, b, c]) => {
  const noa = window.noa
  if (window.__pin) noa.off('tick', window.__pin)
  window.__pin = () => {
    noa.ents.setPosition(noa.playerEntity, [a, b, c])
    const body = noa.ents.getPhysics(noa.playerEntity).body
    body.velocity[0] = body.velocity[1] = body.velocity[2] = 0
  }
  noa.on('tick', window.__pin)
}, [x, y, z])

const unpin = (page) => page.evaluate(() => {
  if (!window.__pin) return
  window.noa.off('tick', window.__pin)
  window.__pin = null
})

/**
 * Put the eyes at a given depth below the surface and hold them there.
 *
 * `.5` on both axes: a whole number lands on a voxel boundary and the player
 * floats back to the cell below, which is the trap docs/water.md calls out.
 * The eye offset is read off the camera target rather than assumed, because
 * sneaking and the player box both own that number elsewhere.
 */
async function submerge(page, ocean, depth = DEPTH) {
  const eye = await page.evaluate(() => window.noa.ents
    .getState(window.noa.camera.cameraTarget, 'followsEntity').offset[1])
  const y = ocean.surfaceY - depth - eye + 0.5
  await teleport(page, ocean.x + 0.5, y, ocean.z + 0.5)
  await pin(page, ocean.x + 0.5, y, ocean.z + 0.5)
  await waitTicks(page, 3)
}

/**
 * Every terrain material's shader defines. noa names them
 * `terrain-textured-<blockMatID>`; `getEffect()` is the effect the material
 * last actually drew with, so this is the compiled truth rather than an
 * intention.
 */
const terrainDefines = (page) => page.evaluate(() =>
  window.noa.rendering.getScene().materials
    .filter((m) => m.name.startsWith('terrain-textured-'))
    .map((m) => ({ name: m.name, defines: m.getEffect()?.defines ?? null })))

const fogState = (page) => page.evaluate(() => {
  const u = window.game.underwater
  const scene = window.noa.rendering.getScene()
  return {
    submerged: u.submerged,
    fogMode: scene.fogMode,
    fogDensity: scene.fogDensity,
    fogColor: [scene.fogColor.r, scene.fogColor.g, scene.fogColor.b],
    overlayEnabled: u.overlayEnabled,
    eyes: window.game.fluids.eyes,
  }
})

/** Mean colour of the middle of the screen, dodging the HUD and the held arm. */
async function centrePatch(page) {
  const png = await page.screenshot({ clip: { x: 340, y: 120, width: 600, height: 340 } })
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  let r = 0, g = 0, b = 0, n = 0, blue = 0
  for (let i = 0; i < data.length; i += info.channels) {
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n++
    if (data[i] < 90) blue++
  }
  return { r: r / n, g: g / n, b: b / n, blueFrac: blue / n }
}

test.describe('under water', () => {
  test.afterEach(({ page }) => unpin(page))

  test('the fog mode is set before the terrain materials freeze', async ({ page }) => {
    const mats = await terrainDefines(page)
    // If this is empty the world never meshed and every assertion below is
    // vacuous, which is the failure mode a `.every()` on an empty array hides.
    expect(mats.length).toBeGreaterThan(0)
    for (const m of mats) {
      expect(m.defines, `${m.name} never compiled`).not.toBeNull()
      expect(m.defines, `${m.name} has no FOG define -- fog was turned on after `
        + 'the material was frozen, so it will fog the clouds and not the world')
        .toContain('#define FOG')
    }
  })

  test('fog is off, and water-coloured, standing in air', async ({ page }) => {
    const s = await fogState(page)
    expect(s.eyes).toBeNull()
    expect(s.submerged).toBe(false)
    expect(s.fogDensity).toBe(0)
    expect(s.overlayEnabled).toBe(false)
    // Mode stays EXP2 forever. Setting it back to NONE would stop Babylon
    // binding the fog uniforms at all, and the shader would keep the last
    // density it was handed.
    // Scene.FOGMODE_EXP2. The number rather than the symbol because this runs
    // in the page, where Babylon's classes are bundled away.
    expect(s.fogMode).toBe(2)
    // Minecraft's default overworld water tint, #3F76E4, reused as fog.
    expect(s.fogColor[0]).toBeCloseTo(0x3f / 255, 2)
    expect(s.fogColor[1]).toBeCloseTo(0x76 / 255, 2)
    expect(s.fogColor[2]).toBeCloseTo(0xe4 / 255, 2)
  })

  test('going under turns the world blue, and surfacing clears it', async ({ page }) => {
    const ocean = await findOcean(page)
    expect(ocean, 'no ocean column found in the terrain patch').not.toBeNull()

    // ---- above the water, looking down at it
    await teleport(page, ocean.x + 0.5, ocean.surfaceY + 8, ocean.z + 0.5)
    await pin(page, ocean.x + 0.5, ocean.surfaceY + 8, ocean.z + 0.5)
    await look(page, { heading: 0, pitch: 0.55 })
    await waitFrames(page, 4)
    const above = await fogState(page)
    expect(above.submerged).toBe(false)
    expect(above.fogDensity).toBe(0)
    await shot(page, 'after-above')

    // ---- eyes right at the waterline
    await submerge(page, ocean, 0.2)
    await look(page, { heading: 0, pitch: 0 })
    await waitFrames(page, 4)
    await shot(page, 'after-surface')

    // ---- six blocks under, looking level
    await submerge(page, ocean)
    await look(page, { heading: 0, pitch: 0 })
    await waitFrames(page, 4)
    const under = await fogState(page)
    expect(under.eyes).toBe('water')
    expect(under.submerged).toBe(true)
    expect(under.overlayEnabled).toBe(true)
    expect(under.fogDensity).toBeGreaterThan(0.1)
    await shot(page, 'after-under')

    // ---- six blocks under, looking straight up. THE reported bug.
    await submerge(page, ocean)
    await look(page, { heading: 0, pitch: -Math.PI / 2 })
    await waitFrames(page, 4)
    await shot(page, 'after-under-up')

    /*
     * The pixel check, and it is the one that could not have passed before.
     *
     * RED IS THE DISCRIMINATOR. Everything the fog swallows converges on
     * #3F76E4, whose red is 63. The daytime sky is (120, 167, 255) and the
     * clouds on it are near-white, so before this change the middle of this
     * frame averaged red well over 120. Measured: 55 wet against 93 dry, and
     * 97% of the frame under red 90 wet against 48% dry -- the dry half of
     * that is a stone overhang, not sky, which is why the threshold is 0.7
     * and not something tighter.
     */
    const wet = await centrePatch(page)
    expect(wet.r, 'looking up from under water still shows sky').toBeLessThan(80)
    expect(wet.blueFrac, 'something up there is not water-coloured').toBeGreaterThan(0.9)
    expect(wet.b).toBeGreaterThan(wet.r)

    // ---- and it goes away. Not "the flag cleared" -- the pixels came back.
    await teleport(page, ocean.x + 0.5, ocean.surfaceY + 8, ocean.z + 0.5)
    await pin(page, ocean.x + 0.5, ocean.surfaceY + 8, ocean.z + 0.5)
    await look(page, { heading: 0, pitch: -Math.PI / 2 })
    await waitFrames(page, 4)
    const dry = await fogState(page)
    expect(dry.submerged).toBe(false)
    expect(dry.fogDensity).toBe(0)
    expect(dry.overlayEnabled).toBe(false)
    const sky = await centrePatch(page)
    expect(sky.blueFrac, 'the view is still all water-coloured after surfacing')
      .toBeLessThan(0.7)
    expect(sky.r, 'the view is still fog-tinted after surfacing')
      .toBeGreaterThan(wet.r + 25)
  })

  test('the fog thins as your eyes adjust', async ({ page }) => {
    const ocean = await findOcean(page)
    expect(ocean).not.toBeNull()
    await submerge(page, ocean)
    const entry = await page.evaluate(() => window.game.underwater.fogDensity)

    // Vanilla blends the thick entry fog away over thirty seconds, 60% of the
    // way there at five. Four seconds is enough to prove the ramp exists
    // without parking the suite.
    await waitTicks(page, 4 * 30)
    const later = await page.evaluate(() => ({
      density: window.game.underwater.fogDensity,
      since: window.game.underwater.sinceEntry,
    }))
    expect(later.since).toBeGreaterThan(3)
    expect(later.density).toBeLessThan(entry)
  })

  test('the water surface is drawn from underneath', async ({ page }) => {
    /*
     * The mesher draws water's top face once, single-sided, facing up. From
     * below there was nothing there at all -- which is the second half of
     * "look up and see clouds". blocks.js turns backface culling off on the
     * alpha atlas page; this asserts the material actually says so, because
     * the pixel version of this question is swallowed by the fog that the
     * test above exists to prove is there.
     */
    const culling = await page.evaluate(() => {
      const scene = window.noa.rendering.getScene()
      const water = window.game.fluids.ids.water
      const matId = window.noa.registry.getBlockFaceMaterial(water, 0)
      const url = window.noa.registry.getMaterialData(matId).texture
      const mat = scene.materials.find((m) =>
        m.name.startsWith('terrain-textured-') &&
        window.noa.registry.getMaterialData(+m.name.split('-')[2])?.texture === url)
      return mat ? { name: mat.name, backFaceCulling: mat.backFaceCulling } : null
    })
    expect(culling, 'water has no terrain material -- nothing meshed it').not.toBeNull()
    expect(culling.backFaceCulling).toBe(false)
  })
})
