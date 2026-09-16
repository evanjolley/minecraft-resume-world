import { test, expect } from './fixtures.js'
import {
  waitTicks, waitFrames, teleport, settleOnGround, SURFACE_Y, ID,
} from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * The thing in your hand is as bright as you are.
 *
 * THE BUG THIS FILE EXISTS FOR. src/heldItem.js built THREE materials and
 * called trackEntityLight on exactly one of them. A diamond axe dimmed at
 * dusk; the dirt block in the same hand, at the same instant, did not -- nor
 * did the block in the third-person fist, nor a dropped ingot on the floor.
 * Same hand, same frame, one lit object and one that was never lit at all.
 *
 * WHAT VANILLA DOES, read off the decompile rather than remembered. MCP-919,
 * net/minecraft/client/renderer/ItemRenderer.java:
 *
 *   private void setLightMapFromPlayer(AbstractClientPlayer clientPlayer) {
 *       int i = this.mc.theWorld.getCombinedLight(new BlockPos(
 *           clientPlayer.posX,
 *           clientPlayer.posY + (double)clientPlayer.getEyeHeight(),
 *           clientPlayer.posZ), 0);
 *       float f = (float)(i & 65535);
 *       float f1 = (float)(i >> 16);
 *       OpenGlHelper.setLightmapTextureCoords(OpenGlHelper.lightmapTexUnit, f, f1);
 *   }
 *
 * called once from renderItemInFirstPerson, BEFORE the branch that decides
 * whether to draw an item or the bare arm. One sample, at the PLAYER, for
 * everything in the hand. That is why the arm and the item never disagree in
 * vanilla, and disagreeing is precisely what this engine was doing.
 *
 * SO THE ASSERTIONS ARE EQUALITIES, NOT INEQUALITIES. "The block got darker"
 * passes on a block that darkens on its own separate curve, which is the
 * failure mode entityLight.js's opening comment is entirely about -- two
 * brightness sources that nearly agree. Every test below pins the held block
 * to the SAME NUMBER as the skin material the arm is drawn with.
 */

const NOON = 6000
const MIDNIGHT = 18000
const GLOWSTONE = 129

/** Room centre and shape, the same sealed box spec 25 and spec 56 build. */
const CX = 20
const CZ = 20
const FLOOR = SURFACE_Y
const CEIL = FLOOR + 4
const R = 3

/**
 * The three materials that have to agree, read in ONE evaluate so they cannot
 * be sampled a tick apart.
 *
 *   skin   the player model AND the first-person arm -- one material, see
 *          playerModel.js. This is the reference: it was always lit.
 *   block  the held block cube. The bug.
 *   item   the extruded tool sprite. The one that already worked.
 *
 * `diffuse` is here for the reason spec 25 gives: entityLight.js splits an
 * entity's brightness between an emissive floor and a face-shaded diffuse,
 * and a half-wired material moves only the first.
 */
const sample = (page) => page.evaluate(() => {
  const g = window.game
  const noa = window.noa
  const read = (m) => (m ? { name: m.name, e: m.emissiveColor.r, d: m.diffuseColor.r, a: m.ambientColor.r } : null)
  const p = noa.ents.getPosition(noa.playerEntity)
  return {
    skin: read(g.skinMaterial),
    block: read(g.held.block.material),
    item: read(g.held.item.material),
    sun: noa.rendering.getScene().lights.find((l) => l.name === 'light')?.intensity ?? null,
    light: window.blockLight.getBlockLight(p[0], p[1], p[2]),
  }
})

const atTime = async (page, t) => {
  await page.evaluate((v) => window.game.sky.setTime(v), t)
  await waitTicks(page, 3)
  return sample(page)
}

/** Put one item in the selected slot. Lifted from spec 15's `hold`. */
async function hold(page, key) {
  await page.evaluate((k) => {
    const g = window.game
    g.inventory.slots.fill(null)
    if (k !== null) g.inventory.add(typeof k === 'number' ? k : g.itemId(k), 1)
    g.inventory.select(0)
    g.inventory.emitChange()
  }, key)
  // The first time any sprite is held its pixels are still in flight, so wait
  // on the mesh rather than on a tick count.
  await page.waitForFunction(() => {
    const g = window.game
    return g.held.mode !== 'item' || g.held.item.getTotalVertices() > 0
  }, null, { timeout: 10_000, polling: 20 })
  await waitTicks(page, 3)
  await waitFrames(page, 3)
}

/** A sealed stone box with clear air inside, so nothing can see the sky. */
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

/**
 * What the GPU actually drew in the bottom-right corner, where the viewmodel
 * lives: mean and max channel value over the region, 0..255.
 *
 * Inside onAfterRenderObservable on purpose. Babylon's canvas is created
 * without preserveDrawingBuffer, so the back buffer is undefined by the time
 * a screenshot or a toDataURL runs -- the read has to happen in the same
 * frame, before the compositor takes it. Rejected: page.screenshot plus an
 * image decode in Node, which needs a PNG library this repo does not have and
 * which would also pick up the DOM hotbar sitting over the same corner.
 *
 * Fractions rather than pixels because drawingBuffer is devicePixelRatio
 * scaled and webkit and chromium do not agree on it. GL's origin is the
 * BOTTOM left, so the low y band here is the bottom of the screen.
 */
const viewmodelPixels = (page) => page.evaluate(() => new Promise((resolve) => {
  const scene = window.noa.rendering.getScene()
  const gl = scene.getEngine()._gl
  scene.onAfterRenderObservable.addOnce(() => {
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight
    const x = Math.floor(W * 0.66), w = W - x
    const h = Math.floor(H * 0.30)
    const buf = new Uint8Array(w * h * 4)
    gl.readPixels(x, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
    let sum = 0, max = 0, n = 0
    for (let i = 0; i < buf.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        sum += buf[i + c]
        if (buf[i + c] > max) max = buf[i + c]
      }
      n++
    }
    resolve({ mean: sum / (n * 3), max, n })
  })
}))

const setBlock = (page, id, x, y, z) =>
  page.evaluate(([i, a, b, c]) => window.noa.setBlock(i, a, b, c), [id, x, y, z])

/**
 * Assert the three materials are the same brightness, and say all three
 * numbers when they are not.
 *
 * toBeCloseTo(3) rather than toBe: they are three separate Color3 objects
 * written by three separate apply() calls, and insisting on bit equality
 * would be asserting something about float order that nobody promised.
 */
function agree(s, where) {
  const all = `${where} -- skin ${s.skin.e.toFixed(4)},`
    + ` block ${s.block.e.toFixed(4)}, item ${s.item.e.toFixed(4)}`
  expect(s.block, 'no held-block material at all -- this test proved nothing')
    .not.toBeNull()
  expect(s.block.e, `${all} (emissive)`).toBeCloseTo(s.skin.e, 3)
  expect(s.item.e, `${all} (emissive)`).toBeCloseTo(s.skin.e, 3)
  expect(s.block.d, `${all} (diffuse)`).toBeCloseTo(s.skin.d, 3)
  expect(s.item.d, `${all} (diffuse)`).toBeCloseTo(s.skin.d, 3)
  // Babylon ADDS ambientColor on top of emissive and noa leaves it white, so
  // a non-zero one is a second floor the sky cannot take away. Every other
  // file in this engine carries a line against it; so does this test.
  expect(s.block.a, `${where} -- held block ambientColor is not zeroed`).toBe(0)
}

test.describe('the held block responds to light like the held tool', () => {
  test('the block and the tool both dim from noon to midnight, together',
    async ({ page }) => {
      await hold(page, ID.grass)
      const noon = await atTime(page, NOON)
      const midnight = await atTime(page, MIDNIGHT)

      // Guard the guard. If the sky stopped moving, everything below would
      // "pass" by comparing two identical frozen numbers.
      expect(noon.sun, `sun at noon was ${noon.sun}`).toBeGreaterThan(0.9)
      expect(midnight.sun, `sun at midnight was ${midnight.sun}`).toBeLessThan(0.3)

      /*
       * THE ASSERTION THAT CATCHES THE ORIGINAL BUG. An untracked material is
       * whatever noa's makeStandardMaterial left it as -- a constant -- so
       * this ratio is exactly 1 on the broken version.
       */
      expect(midnight.block.e,
        `held block: noon ${noon.block.e.toFixed(3)}, midnight ${midnight.block.e.toFixed(3)}`)
        .toBeLessThan(noon.block.e * 0.5)

      // Not to pure black, either. sky.js floors the night at 0.18 of noon
      // for the same reason vanilla's lightmap ends with `* 0.96 + 0.03`:
      // nothing a player can see is ever allowed to reach zero.
      expect(midnight.block.e, 'the held block went pure black at midnight')
        .toBeGreaterThan(0)

      agree(noon, 'noon')
      agree(midnight, 'midnight')
    })

  test('a tool in the hand reads the same as a block in the hand',
    async ({ page }) => {
      /*
       * The two materials exist whatever is selected -- both meshes are built
       * at install and only one is enabled -- so this could be read without
       * touching the hotbar. It switches anyway: the claim being tested is
       * about what the player SEES in his hand, and a version of this that
       * never puts anything in the hand is testing a different sentence.
       */
      /*
       * Dusk rather than noon, and the clock is re-set between the two holds.
       * Dusk because sky.js's daylight curve is steepest there, so a material
       * pinned to any constant is furthest from the truth; re-set because the
       * world keeps ticking while the hotbar swap waits on a sprite, and the
       * first version of this test failed on 0.0010 of genuine sunset.
       *
       * The two samples are therefore compared to 2 decimals -- the residual
       * drift of three ticks of dusk. `agree` is still 3, because the three
       * materials it compares are read inside ONE evaluate and no time can
       * pass between them.
       */
      await hold(page, ID.grass)
      const withBlock = await atTime(page, 12000)
      await hold(page, 'diamond_axe')
      const withTool = await atTime(page, 12000)

      expect(withBlock.block.e, 'the sky moved between the two samples')
        .toBeCloseTo(withTool.block.e, 2)
      agree(withBlock, 'block in hand')
      agree(withTool, 'tool in hand')
    })

  test('a glowstone in a sealed dark room lights the block in your hand',
    async ({ page, terrain }) => {
      await terrain.keep([CX - R - 1, FLOOR, CZ - R - 1], [CX + R + 1, CEIL, CZ + R + 1])
      await buildRoom(page)
      await page.evaluate((v) => window.game.sky.setTime(v), MIDNIGHT)
      await teleport(page, CX + 0.5, FLOOR + 1, CZ + 0.5)
      await settleOnGround(page)
      await hold(page, ID.grass)
      await waitTicks(page, 3)

      const dark = await sample(page)
      expect(dark.light, 'the sealed room already had block light in it').toBe(0)
      expect(dark.sun, `sun at midnight was ${dark.sun}`).toBeLessThan(0.3)
      agree(dark, 'dark room')

      // One block east of his feet. The feet voxel is air, so it takes 14.
      await setBlock(page, GLOWSTONE, CX + 1, FLOOR + 1, CZ)
      await waitTicks(page, 3)
      const lit = await sample(page)

      expect(lit.light, 'the glowstone did not reach the voxel he is standing in')
        .toBeGreaterThan(0)
      /*
       * Not "it got brighter": the held block's floor has to be ENTITY_FLOOR
       * of the light level blockLight.js actually stored, which is what ties
       * this to the light engine rather than to a second curve that happens
       * to also go up. ENTITY_FLOOR is 0.4, MAX_LIGHT is 15.
       */
      expect(lit.block.e,
        `block light ${lit.light}, held-block emissive ${lit.block.e.toFixed(3)}`)
        .toBeCloseTo(lit.light / 15 * 0.4, 2)
      expect(lit.block.e, 'the glowstone did not brighten the held block at all')
        .toBeGreaterThan(dark.block.e * 3)
      agree(lit, 'dark room, glowstone')

      await setBlock(page, ID.air, CX + 1, FLOOR + 1, CZ)
      await waitTicks(page, 3)
      const out = await sample(page)
      expect(out.light, 'removing the glowstone left light behind').toBe(0)
      expect(out.block.e, 'the held block stayed lit after the glowstone was gone')
        .toBeCloseTo(dark.block.e, 3)
    })

  test('...and the GPU agrees, which the numbers above cannot tell you',
    async ({ page, terrain }) => {
      /*
       * THE TEST THAT WOULD HAVE CAUGHT THIS, AND THE LESSON OF THE WHOLE BUG.
       *
       * Every assertion above reads `material.emissiveColor` -- a JavaScript
       * object. All of them passed on a build where the held block was
       * MEASURABLY unchanged on screen between a pitch-dark room and the same
       * room with a glowstone in it: 11412 green pixels at mean brightness
       * 43.79 in both frames, byte for byte, while the JS number read 0.072
       * and 0.373. noa's `scene.performancePriority` had frozen the material's
       * uniform buffer (playerModel.js's keepMaterialLive says why at length).
       *
       * So this one reads the FRAMEBUFFER. gl.readPixels inside
       * onAfterRenderObservable, while the back buffer is still bound -- the
       * canvas is not preserveDrawingBuffer, so a toDataURL a frame later
       * returns black. The HUD is DOM and never enters this buffer, which is
       * a bonus: nothing in the region below is anything but the world and
       * the hand.
       */
      await terrain.keep([CX - R - 1, FLOOR, CZ - R - 1], [CX + R + 1, CEIL, CZ + R + 1])
      await buildRoom(page)
      await page.evaluate((v) => window.game.sky.setTime(v), MIDNIGHT)
      await teleport(page, CX + 0.5, FLOOR + 1, CZ + 0.5)
      await settleOnGround(page)
      await hold(page, ID.grass)
      await waitFrames(page, 3)

      const dark = await viewmodelPixels(page)
      const lightsOff = `dark room: mean ${dark.mean.toFixed(2)}, max ${dark.max}`
      expect(dark.n, 'read no pixels at all -- this test proved nothing')
        .toBeGreaterThan(1000)
      /*
       * A FLOOR, and vanilla has one too. EntityRenderer.updateLightmap ends
       * every channel with `f = f * 0.96F + 0.03F`, so the darkest a held
       * item can ever render in vanilla is 3% of its texture rather than
       * black. This measured 4.46/255 on a grass block, which is that.
       */
      expect(dark.max, `${lightsOff} -- the held block rendered pure black`)
        .toBeGreaterThan(0)

      await setBlock(page, GLOWSTONE, CX + 1, FLOOR + 1, CZ)
      await waitTicks(page, 3)
      await waitFrames(page, 3)
      const lit = await viewmodelPixels(page)

      /*
       * THE ASSERTION. Block light 14 against a midnight sky is a factor of
       * about five on the light level, and the frozen-material build scored
       * exactly 1.00 here. Three is far below what a working one manages
       * (measured 13x) and far above anything a stuck uniform can fake.
       */
      expect(lit.mean, `${lightsOff}; glowstone: mean ${lit.mean.toFixed(2)},`
        + ` max ${lit.max} -- the glowstone did not reach the screen`)
        .toBeGreaterThan(dark.mean * 3)
    })

  test('a dropped item is lit too', async ({ page }) => {
    /*
     * The fourth material, and the one nobody was going to notice: drops are
     * thin instances of a per-item-type mesh built inside itemEntity.js, so
     * they are reachable only through the scene.
     *
     * Two drops on purpose -- a block and a sprite -- because the two take
     * DIFFERENT paths to the same rule. The block one is lit because
     * createHeldBlockMesh does it for every caller; the sprite one builds its
     * own material and needed its own call. A fix that only did the factory
     * passes half this test.
     */
    await page.evaluate(() => {
      const g = window.game
      const noa = window.noa
      const p = noa.ents.getPosition(noa.playerEntity)
      g.drops.spawn(g.itemId('iron_ingot'), 1, [p[0], p[1] + 1, p[2]])
      g.drops.spawn(1, 1, [p[0] + 0.5, p[1] + 1, p[2]])
    })
    await waitTicks(page, 3)

    const read = (page) => page.evaluate(() => {
      const scene = window.noa.rendering.getScene()
      return {
        mats: scene.materials
          .filter((m) => /^drop-.*-mat$/.test(m.name))
          .map((m) => ({ name: m.name, e: m.emissiveColor.r, a: m.ambientColor.r })),
        skin: window.game.skinMaterial.emissiveColor.r,
      }
    })

    await page.evaluate((v) => window.game.sky.setTime(v), NOON)
    await waitTicks(page, 3)
    const noon = await read(page)
    /*
     * ASSERT THE SAMPLE IS NON-EMPTY BEFORE ASSERTING ANYTHING ABOUT IT. A
     * for-loop over zero materials passes every check inside it, which is how
     * a probe in this repo once passed while measuring nothing at all.
     */
    expect(noon.mats.length,
      'no drop-*-mat materials in the scene -- nothing was dropped, so this'
      + ' test proved nothing').toBeGreaterThan(1)

    await page.evaluate((v) => window.game.sky.setTime(v), MIDNIGHT)
    await waitTicks(page, 3)
    const night = await read(page)

    for (let i = 0; i < noon.mats.length; i++) {
      const [d, n] = [noon.mats[i], night.mats[i]]
      const where = `${d.name}: noon ${d.e.toFixed(3)}, midnight ${n.e.toFixed(3)}`
      expect(d.e, `${where} -- a drop does not follow the sky`).toBeCloseTo(noon.skin, 3)
      expect(n.e, `${where} -- a drop does not follow the sky`).toBeCloseTo(night.skin, 3)
      expect(n.e, `${where} -- the drop's floor did not move`).toBeLessThan(d.e * 0.5)
      expect(d.a, `${where} -- ambientColor is not zeroed`).toBe(0)
    }
  })

  test('the block, the tool and the world around them, in three lightings',
    async ({ page, terrain }) => {
      /*
       * Evidence, not assertions. The numbers above prove the materials
       * agree; only a picture says a held block in a lit room reads as being
       * in the same room as the wall behind it.
       *
       * Six shots: block and tool, in daylight, in a sealed dark room, and in
       * that same room with a glowstone at the player's feet.
       */
      await terrain.keep([CX - R - 1, FLOOR, CZ - R - 1], [CX + R + 1, CEIL, CZ + R + 1])
      await teleport(page, CX + 0.5, FLOOR + 3, CZ + 0.5)
      await settleOnGround(page)

      const pair = async (tag) => {
        await hold(page, ID.grass)
        await shot(page, `held-light-${tag}-block`)
        await hold(page, 'diamond_axe')
        await shot(page, `held-light-${tag}-tool`)
      }

      await atTime(page, NOON)
      await pair('day')

      await buildRoom(page)
      await teleport(page, CX + 0.5, FLOOR + 1, CZ + 0.5)
      await settleOnGround(page)
      await atTime(page, MIDNIGHT)
      await pair('dark')

      await setBlock(page, GLOWSTONE, CX + 1, FLOOR + 1, CZ)
      await waitTicks(page, 3)
      await pair('glowstone')
    })
})
