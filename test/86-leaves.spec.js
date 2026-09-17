import { test, expect } from './fixtures.js'
import sharp from 'sharp'
import { teleport, look, waitFrames, HEADING } from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * HOW A LEAF IS DRAWN.
 *
 * Reported from play: "texture for cherry blossom leaves is incorrect I can
 * see through it".
 *
 * The texture was innocent and so was the pack. `cherry_leaves.png` comes out
 * of the 1.21.8 jar byte-for-byte -- 216 opaque texels, 40 fully transparent,
 * none in between -- and it is the LEAST holey leaf in the set, against oak's
 * 172 and birch's 144. Nor is it tinted: the CHERRY tint in blocks.js exists
 * for the CE fallback, the build applies a tint only when the source is close
 * to grey (chroma 0.22), and vanilla cherry measures 0.327.
 *
 * What was wrong was the MATERIAL, and it was wrong for every leaf at once.
 * Leaves shared an atlas page with water, materials are one per page, and the
 * flag that makes water translucent (`useAlphaFromDiffuseTexture`) makes the
 * whole page BLEND -- which in Babylon costs the alpha cutout
 * (`_shouldTurnAlphaTestOn` is `!needAlphaBlending && needAlphaTesting`) and
 * costs the depth write (`setAlphaMode` sets `depthMask = mode === 0`). A leaf
 * stopped being a cutout and became a stack of unsorted blended quads.
 *
 * Cherry is where the owner noticed because cherry is the densest leaf in the
 * game: a blossom canopy is the one the eye expects to be a solid mass.
 *
 * So the contract here is about the MATERIAL rather than about the picture.
 * The screenshots are evidence, not assertions -- "does a cherry tree look
 * like a cherry tree" is not a number.
 */

const Y = 230, X0 = 70, Z0 = 70
const ID = { oak: 158, birch: 170, cherry: 200, cherry_log: 196 }

/** Three leaf walls in a row against open sky, one block thick. */
async function buildWalls(page) {
  await teleport(page, X0, Y + 1, Z0 + 10)
  await page.waitForFunction(([y, x0, z0, ids]) => {
    const noa = window.noa
    for (let x = x0 - 14; x <= x0 + 14; x++)
      for (let z = z0 - 12; z <= z0 + 18; z++)
        for (let dy = -4; dy <= 14; dy++) noa.setBlock(0, x, y + dy, z)
    const wall = (id, cx) => {
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = 0; dy <= 2; dy++) noa.setBlock(id, cx + dx, y + dy, z0)
    }
    wall(ids.oak, x0 - 5); wall(ids.birch, x0); wall(ids.cherry, x0 + 5)
    return noa.getBlock(x0 + 5, y, z0) === ids.cherry
  }, [Y, X0, Z0, ID], { timeout: 30_000, polling: 100 })
}

/** A trunk and a rounded canopy, sized like a vanilla cherry tree. */
async function buildTree(page) {
  await teleport(page, X0, Y + 1, Z0 + 14)
  await page.waitForFunction(([y, x0, z0, ids]) => {
    const noa = window.noa
    for (let x = x0 - 12; x <= x0 + 12; x++)
      for (let z = z0 - 12; z <= z0 + 18; z++)
        for (let dy = -3; dy <= 14; dy++) noa.setBlock(0, x, y + dy, z)
    for (let dy = 0; dy < 6; dy++) noa.setBlock(ids.cherry_log, x0, y + dy, z0)
    for (let dx = -4; dx <= 4; dx++)
      for (let dz = -4; dz <= 4; dz++)
        for (let dy = 4; dy <= 9; dy++) {
          if (Math.hypot(dx, dz, (dy - 6.5) * 1.6) <= 4.2) {
            noa.setBlock(ids.cherry, x0 + dx, y + dy, z0 + dz)
          }
        }
    return noa.getBlock(x0, y + 6, z0 + 3) === ids.cherry
  }, [Y, X0, Z0, ID], { timeout: 30_000, polling: 100 })
}

/*
 * Hold the camera in mid-air. Lifted from 46-water-look, including the reason
 * it is undone in an afterEach: the rig hangs in the sky, a failed assertion
 * skips the rest of the body, and a player nailed into the air is inherited by
 * every test after it in the shared world.
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
 * Every terrain material in the scene, keyed by atlas file.
 *
 * `needAlphaBlending()` can answer `undefined` -- Babylon's last clause is
 * `this._opacityFresnelParameters?.isEnabled` -- so it is coerced rather than
 * compared, which is also why this cannot be a toBe(false).
 */
const terrainMaterials = (page) => page.evaluate(() => {
  const scene = window.noa.rendering.getScene()
  const out = {}
  for (const mat of scene.materials) {
    if (!mat.name.startsWith('terrain-textured-')) continue
    const url = window.noa.registry.getMaterialData(+mat.name.split('-')[2])?.texture || ''
    out[url.split('/').pop()] = {
      blend: !!mat.needAlphaBlending(),
      test: !!mat.needAlphaTesting(),
      cull: mat.backFaceCulling,
      cutOff: mat.alphaCutOff,
    }
  }
  return out
})

/** Where a block's side face samples from. */
const faceMaterial = (page, id) => page.evaluate((b) => {
  const reg = window.noa.registry
  const d = reg.getMaterialData(reg.getBlockFaceMaterial(b, 2))
  return { file: d.texture.split('/').pop(), layer: d.atlasIndex, hasAlpha: d.texHasAlpha }
}, id)

test.afterEach(async ({ page }) => { await unpin(page) })

test.describe('leaves', () => {
  test('the leaf page is a cutout and the water page is not', async ({ page }) => {
    await buildWalls(page)
    const leaf = await faceMaterial(page, ID.cherry)
    const water = await faceMaterial(page, 636)
    expect(leaf.file, 'cherry leaves and water are back on one page, so one'
      + ' material decides how both are drawn').not.toBe(water.file)

    const mats = await terrainMaterials(page)
    expect(Object.keys(mats), 'no terrain material was built -- nothing below'
      + ' this line is measuring anything').toContain(leaf.file)
    expect(Object.keys(mats)).toContain(water.file)

    /*
     * The leaf page. Blending is the fault: it takes the ALPHATEST define away
     * and it takes the depth write away, and the cutout is the whole reason a
     * leaf has holes you can see the sky through rather than a haze you can
     * see the far side of the tree through.
     */
    expect(mats[leaf.file].blend, 'the leaf page is blending again').toBe(false)
    expect(mats[leaf.file].test, 'the leaf page lost its alpha cutout').toBe(true)
    expect(leaf.hasAlpha, 'the leaf page stopped declaring an alpha channel,'
      + ' which is what buys the cutout').toBe(true)

    /*
     * ...and the water page, which is the fluid contract this fix must not
     * break. 46-water-look owns what that looks like; this owns the flag.
     */
    expect(mats[water.file].blend, 'water stopped blending -- it is opaque again')
      .toBe(true)

    /*
     * BACKFACE CULLING STAYS OFF, and it is off for a reason that is about
     * noa rather than about Babylon. noa's greedy mesher opens its mask loop
     * with `if (id0 === id1) continue`, so it never draws a face between two
     * leaf blocks: a canopy in this engine is a HOLLOW SHELL one quad thick,
     * where vanilla's is nine layers of quads. Cull the shell's far side and
     * cherry's forty transparent texels look straight through the tree to the
     * sky -- measured at 23.9% sky inside the canopy crop with culling on
     * against 16.2% with it off, on the same tree from the same camera.
     */
    expect(mats[leaf.file].cull, 'the far side of a canopy is the only thing'
      + ' standing in for the layers noa will not mesh').toBe(false)

    await pin(page, X0, Y + 1.2, Z0 + 12)
    await look(page, { heading: HEADING.northMinusZ, pitch: 0 })
    await waitFrames(page, 20)
    await shot(page, 'leaves-row')
  })

  test('a cherry canopy, from outside and from inside', async ({ page }) => {
    await buildTree(page)
    await pin(page, X0, Y + 6, Z0 + 12)
    await look(page, { heading: HEADING.northMinusZ, pitch: 0 })
    await waitFrames(page, 20)
    await shot(page, 'cherry-outside')

    /*
     * CAN YOU SEE THROUGH IT -- the owner's own words, as a number.
     *
     * The crop sits wholly inside the canopy silhouette, nine blocks of leaves
     * deep, so any sky in it came through the tree. 2.1% of the crop, which is
     * the pinholes where a hole in the near shell lines up with a hole in the
     * far one. Culling the shell's back faces takes it to 14.3% and the tree
     * turns into lace; that measurement is why backFaceCulling stays off above.
     */
    const png = await page.screenshot()
    const { data, info } = await sharp(png)
      .extract({ left: 560, top: 300, width: 180, height: 140 })
      .raw().toBuffer({ resolveWithObject: true })
    let sky = 0, px = 0
    for (let i = 0; i < data.length; i += info.channels) {
      px++
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]]
      if (b > r + 25 && b > 140 && g > r) sky++
    }
    expect(px, 'the crop is empty -- the fraction below is 0/0').toBeGreaterThan(1000)
    expect(sky / px, 'you can see the sky through a nine-block-deep cherry canopy')
      .toBeLessThan(0.06)

    /*
     * From inside the canopy, which is where leaf rendering goes wrong and
     * where the blended version showed its far faces over its near ones.
     */
    await pin(page, X0 + 2.5, Y + 6.5, Z0 + 1.5)
    await look(page, { heading: HEADING.northMinusZ, pitch: -0.25 })
    await waitFrames(page, 20)
    await shot(page, 'cherry-inside')
  })
})
