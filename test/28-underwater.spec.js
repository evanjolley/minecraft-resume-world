import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { test, expect } from './fixtures.js'
import { armAudio } from './helpers/audio.js'
import {
  SURFACE_Y, look, teleport, waitFrames, waitTicks,
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
 * THIS FILE BUILDS ITS OWN WATER, and used to hunt for it.
 *
 * It scanned the generator for a sea-level column with air over it and ten
 * blocks of water under it. That worked for exactly as long as the overworld
 * was an imported Minecraft island with an ocean in it. The overworld is now
 * generated superflat, there is no ocean anywhere, and four tests in here went
 * red without a single thing about underwater rendering having changed.
 *
 * A dug pool is strictly better than a found one even when the ocean is back:
 * it is the same nine by fourteen blocks of water every run, on both engines,
 * whatever the terrain does next. 41-fluid-flow builds a tray and the movement
 * specs build flat pads for the same reason.
 *
 * NOT WEAKENED, and this is the line that matters: every assertion below about
 * what being under water DOES -- the fog define, the density, the thirty
 * second ramp, the splash, the ambient bed, the red channel in the pixels --
 * is the one that was there before. Only the way the water arrives changed.
 */

/* Where the after-shots go: beside docs/water/before-*.png, which is the
 * comparison the owner judges this by. Deliberately NOT test/screenshots/,
 * which is gitignored -- these are meant to be committed next to the befores. */
const DOCS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'water')
const shot = (page, name) => page.screenshot({ path: path.join(DOCS, `${name}.png`) })

/** How far under the surface the "under" shots are taken. Matches the befores. */
const DEPTH = 6

/*
 * Where the pool goes, and how big.
 *
 * Well inside the world edge (helpers/world.js MIN/MAX) and well away from
 * spawn, so a spec that walks around at the origin cannot fall into it in the
 * seconds before the terrain fixture puts the ground back. HALF 4 gives a nine
 * by nine surface, which is wide enough that a submerged camera sees only
 * water in every horizontal direction -- the sideways shots are as much the
 * subject as the upward one. DEEP 14 puts the floor eight blocks below the
 * deepest thing any test here stands at.
 */
const POOL = { x: 20, z: 30, half: 4, deep: 14 }

/**
 * Dig the pool, fill it, and hand back the same { x, z, surfaceY } the old
 * ocean scan did, so nothing downstream had to change.
 *
 * The region is registered with the `terrain` fixture FIRST, which is what
 * tears it down -- a fixture rather than a line at the end of the test body,
 * because teardown still runs when an assertion throws and a nine by fourteen
 * hole full of water left in the shared world would take the next spec file
 * with it.
 *
 * STAND NEXT TO IT, NOT OVER IT. `noa.setBlock` is a silent no-op on a chunk
 * that is not loaded and nothing announces the arrival of one, so the player
 * has to be near enough to pull the chunks in -- but landing IN the pool would
 * start the underwater transition before the test that measures it gets to,
 * and 'the fog thins as your eyes adjust' reads `sinceEntry` from exactly that
 * moment. So: the rim, four blocks clear of the water.
 *
 * And then do not trust the writes. Building inside the poll makes the retry
 * and the readback the same statement; nothing partial survives one.
 */
async function buildPool(page, terrain) {
  const { x, z, half, deep } = POOL
  await teleport(page, x + half + 4.5, SURFACE_Y + 6, z + 0.5)

  // The ground is read rather than assumed: SURFACE_Y is the superflat's own
  // number and this file should dig relative to whatever is actually there.
  const surfaceY = await (await page.waitForFunction(([a, c, top, bottom]) => {
    for (let y = top; y >= bottom; y--) if (window.noa.getBlock(a, y, c) !== 0) return y
    return false
  }, [x, z, SURFACE_Y + 12, SURFACE_Y - 12], { timeout: 30_000, polling: 100 })).jsonValue()

  const lo = surfaceY - deep
  await terrain.keep([x - half - 1, lo, z - half - 1], [x + half + 1, surfaceY + 12, z + half + 1])

  await page.waitForFunction(([a, c, h, top, bottom]) => {
    const noa = window.noa
    for (let px = a - h - 1; px <= a + h + 1; px++) {
      for (let pz = c - h - 1; pz <= c + h + 1; pz++) {
        const rim = px < a - h || px > a + h || pz < c - h || pz > c + h
        // Open sky over the whole box: the above-water shots stand eight
        // blocks up and the surfacing check looks straight through it.
        for (let y = top + 1; y <= top + 12; y++) noa.setBlock(0, px, y, pz)
        for (let y = top; y > bottom; y--) noa.setBlock(rim ? 3 : 636, px, y, pz)
        noa.setBlock(3, px, bottom, pz)
      }
    }
    return noa.getBlock(a, top, c) === 636
      && noa.getBlock(a, bottom + 1, c) === 636
      && noa.getBlock(a, bottom, c) === 3
      && noa.getBlock(a, top + 1, c) === 0
  }, [x, z, half, surfaceY, lo], { timeout: 30_000, polling: 100 })

  /*
   * Drop the queue the fill just built. Every one of those ~1100 sources woke
   * its six neighbours, and the pool is walled and floored so not one of those
   * updates can change anything -- it is a thousand scheduled no-ops competing
   * for the per-tick budget with whatever the next spec file pours.
   */
  await page.evaluate(() => window.game.fluids.flow.reset())
  return { x, z, surfaceY }
}

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

/**
 * Put one block from every atlas page on the ground under the player and look
 * at it.
 *
 * WHY THIS EXISTS, because it is not obvious and it is not a nicety.
 * `getEffect()` is the effect the material last actually DREW with, which is
 * the whole reason this test is honest -- an intention is not a compiled
 * shader. The flip side is that a material that has never drawn has no effect
 * at all, and noa creates one material per atlas PAGE lazily. On the old
 * imported island every page had something in it within sight of spawn; on the
 * generated superflat, pages 1, 3 and 4 hold nothing the world contains, so
 * `terrain-textured-129` sat there uncompiled and this test failed with
 * "never compiled" -- a fact about the terrain generator, not about fog.
 *
 * So the test now MAKES every page draw before it asks. That is a stronger
 * question than the one it replaced, not a weaker one: before, the loop only
 * covered whatever the terrain happened to show.
 *
 * SOLID blocks only. Water and lava are on the alpha page too and a source
 * dropped on stone would start flowing across the pad mid-assertion.
 */
async function showEveryAtlasPage(page, terrain) {
  const groundY = await (await page.waitForFunction((top) => {
    for (let y = top; y >= top - 24; y--) if (window.noa.getBlock(0, y, 0) !== 0) return y
    return false
  }, SURFACE_Y + 12, { timeout: 30_000, polling: 100 })).jsonValue()

  await terrain.keep([-3, groundY, -3], [3, groundY, 3])

  await page.evaluate(([y]) => {
    const noa = window.noa
    // One representative block id per atlas texture URL.
    const seen = new Set()
    const reps = []
    for (let id = 1; id < 1200; id++) {
      if (!noa.registry.getBlockSolidity(id)) continue
      const matId = noa.registry.getBlockFaceMaterial(id, 0)
      if (!matId) continue
      const url = noa.registry.getMaterialData(matId)?.texture
      if (!url || seen.has(url)) continue
      seen.add(url)
      reps.push(id)
    }
    reps.forEach((id, i) => {
      for (let dz = -1; dz <= 1; dz++) noa.setBlock(id, i - 2, y, dz)
    })
    return reps.length
  }, [groundY])

  // Straight down at the pad, and give the meshes a few frames to be built,
  // selected and drawn -- the effect is bound in the draw, not in the mesh.
  await look(page, { heading: 0, pitch: Math.PI / 2 - 0.05 })
  await waitFrames(page, 8)
}

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

  test('the fog mode is set before the terrain materials freeze', async ({ page, terrain }) => {
    await showEveryAtlasPage(page, terrain)
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

  test('going under turns the world blue, and surfacing clears it', async ({ page, terrain }) => {
    const ocean = await buildPool(page, terrain)

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

  test('the fog thins as your eyes adjust', async ({ page, terrain }) => {
    const ocean = await buildPool(page, terrain)
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
  /* ------------------------------------------------------------------ *
   * Sound.
   *
   * These assert against the AUDIO GRAPH, not against sounds.lastPlayed --
   * see helpers/audio.js for why. A manifest entry that never fetched and a
   * sample that failed to decode both leave lastPlayed looking perfect.
   * ------------------------------------------------------------------ */

  test('the sound build carries the water sets, or says it does not', async ({ page }) => {
    const sets = await page.evaluate(() => window.game.sounds.manifest?.sets ?? {})
    if (!sets.underwaterLoop) {
      /*
       * The free set, which is what a deploy runs. There is no CC0 recording
       * of Minecraft's underwater ambience, so sounds.js synthesises the bed
       * out of lowpassed noise instead of shipping an unattributed sample.
       * Asserted rather than skipped, so "a deploy is silent under water"
       * cannot come back quietly.
       */
      const bed = await page.evaluate(() => window.game.sounds.underwaterBed)
      expect(bed.synthetic).toBe(true)
      return
    }
    // Vanilla. Eighteen swim variants is the game's own count -- swimming
    // fires one every few ticks and six would read as a loop.
    expect(sets.swim).toHaveLength(18)
    expect(sets.splash.length).toBeGreaterThan(1)
    expect(sets.underwaterEnter).toHaveLength(3)
    expect(sets.underwaterExit).toHaveLength(3)
    expect(sets.waterAmbient).toBeTruthy()
    expect(sets.lavaPop).toBeTruthy()
  })

  test('hitting the water splashes, and going under starts the bed', async ({ page, terrain }) => {
    const audio = await armAudio(page)
    try {
      const ocean = await buildPool(page, terrain)
      // Dry first, so the feet and eyes transitions are real transitions.
      await teleport(page, ocean.x + 0.5, ocean.surfaceY + 4, ocean.z + 0.5)
      await pin(page, ocean.x + 0.5, ocean.surfaceY + 4, ocean.z + 0.5)
      await waitTicks(page, 3)
      await audio.clear()

      await submerge(page, ocean)
      await waitTicks(page, 6)
      const heard = (await audio.drain()).map((r) => r.name)

      const synthetic = await page.evaluate(() =>
        window.game.sounds.underwaterBed.synthetic)
      if (synthetic) {
        // Nothing to hear on a free build but the generated bed, which has no
        // fingerprint in the manifest and so comes back as `unknown:`.
        expect(await page.evaluate(() => window.game.sounds.underwaterBed.running))
          .toBe(true)
        return
      }

      expect(heard.some((n) => n.startsWith('liquid/splash')),
        `no splash in ${JSON.stringify(heard)}`).toBe(true)
      expect(heard.some((n) => n.startsWith('ambient/underwater/enter')),
        `no gulp going under in ${JSON.stringify(heard)}`).toBe(true)
      /*
       * The bed is asserted on its GAIN, not on a captured start(). Its source
       * node is started once and never stopped -- an AudioBufferSourceNode
       * cannot be restarted -- so in a full-suite run an earlier spec has
       * already dived and the start is long gone from the capture. The gain
       * IS the switch, which makes it the honest thing to test.
       */
      await waitTicks(page, 10)
      const bed = await page.evaluate(() => window.game.sounds.underwaterBed)
      expect(bed.running).toBe(true)
      expect(bed.synthetic, 'a vanilla build should be playing the real loop')
        .toBe(false)
      expect(bed.gain, 'the underwater bed is silent while submerged')
        .toBeGreaterThan(0.05)

      // ---- and coming back up
      await audio.clear()
      await teleport(page, ocean.x + 0.5, ocean.surfaceY + 4, ocean.z + 0.5)
      await pin(page, ocean.x + 0.5, ocean.surfaceY + 4, ocean.z + 0.5)
      await waitTicks(page, 20)
      const out = (await audio.drain()).map((r) => r.name)
      expect(out.some((n) => n.startsWith('ambient/underwater/exit')),
        `no gulp surfacing in ${JSON.stringify(out)}`).toBe(true)
      expect(await page.evaluate(() => window.game.sounds.underwaterBed.gain),
        'the bed is still playing in open air').toBeLessThan(0.05)
    } finally {
      await audio.dispose()
    }
  })
})
