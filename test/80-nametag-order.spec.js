import { test, expect } from './fixtures.js'
import {
  waitTicks, waitFrames, teleport, settleOnGround, look, ID,
} from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * A NAME IS DRAWN OVER THE WORLD, AND UNDER YOUR OWN HAND.
 *
 * Reported from play: "Evan nametag doesnt really show up when leaves are
 * behind it? and it seems to go in front of the sky but behind clouds when I
 * position them in line? Kinda odd".
 *
 * Both halves were the same missing line. src/nametag.js set no
 * renderingGroupId, so both of its meshes sat in group 0 with the terrain and
 * the clouds, and it set alphaIndex 0 and 1 to order its two passes against
 * each other. Inside one rendering group Babylon draws transparent meshes in
 * alphaIndex order, and every other transparent mesh in this world is on the
 * default Number.MAX_VALUE -- the cloud layer, the sun, the moon, and (this is
 * the leaves half) the chunk mesh for the ALPHA ATLAS PAGE, which a probe run
 * of this file reported as `needAlphaBlending() === true`. So the name was the
 * first transparent thing drawn in the frame and every one of those painted
 * over it. The sky is scene.clearColor rather than geometry, which is why the
 * one thing it did beat was the sky, exactly as reported.
 *
 * WHAT VANILLA DOES, and it is not "draw it last". 1.21.8's
 * EntityRenderer.renderNameTag (sis1cat/minecraftsodium-1.21.8, Mojang-mapped,
 * src/net/minecraft/client/renderer/entity/EntityRenderer.java) is:
 *
 *   boolean bl = !entityRenderState.isDiscrete;
 *   font.drawInBatch(..., bl ? DisplayMode.SEE_THROUGH : DisplayMode.NORMAL, k, i);
 *   if (bl) font.drawInBatch(..., -1, false, ..., DisplayMode.NORMAL, 0, ...);
 *
 * A standing entity gets a see-through pass AND a depth-tested one, so its
 * name shows through walls dimly and lands crisp where nothing is in the way.
 * A SNEAKING one (isDiscrete) gets a single NORMAL pass and is occluded
 * outright -- not built here, because docs/FUTURE.md records that sneaking
 * does not even shrink you in this world yet.
 *
 * So the depth-tested pass has to be able to LOSE, which is the constraint
 * that decides the fix. Babylon clears the depth buffer between rendering
 * groups, so parking the tag in a high group would have handed it a blank
 * depth buffer and turned the second pass into a second see-through pass.
 * GROUP.nametag is 1 with the clear switched off; the hand is 2 and keeps its
 * clear; the underwater tint is 3. renderOrder.js writes down why.
 *
 * MEASURED IN PIXELS, not in properties. `renderingGroupId === 1` is true of a
 * tag nobody can see. Every case below reads the framebuffer where the tag is
 * PROJECTED TO BE and compares it against the same frame with the tag hidden,
 * which is the only comparison that works against six different backdrops --
 * one of which (a cloud) is the same white the crisp text is.
 */

/** Big enough to hold the whole plate at these distances, small enough to
 *  contain nothing else. Measured off the projection, not guessed. */
const CROP_W = 120
const CROP_H = 30

const NOON = 6000

/** A pixel that is text rather than backdrop: white and unsaturated. */
const isWhite = (r, g, b) => Math.min(r, g, b) >= 232 && Math.max(r, g, b) - Math.min(r, g, b) <= 10

/**
 * Where the tag is on screen, in the coordinates gl.readPixels counts in
 * (origin bottom-left), plus whether it is in frame at all.
 */
const tagAt = (page) => page.evaluate(() => {
  const noa = window.noa
  const scene = noa.rendering.getScene()
  const mesh = window.game.aiEvan.nametag.meshes[0]
  const engine = scene.getEngine()
  const w = engine.getRenderWidth(), h = engine.getRenderHeight()
  const p = window.BABYLON_PROJECT(mesh.getAbsolutePosition(), scene, w, h)
  return { x: p.x, yTop: p.y, y: h - p.y, w, h, onScreen: p.x > 0 && p.x < w && p.y > 0 && p.y < h }
})

/*
 * Vector3.Project, injected once rather than imported -- the spec runs in the
 * page, and the page's Babylon is whatever the bundle pulled in. Hand-rolling
 * the matrix multiply instead would be reimplementing the thing under test.
 */
async function installProject(page) {
  await page.evaluate(() => {
    if (window.BABYLON_PROJECT) return
    const scene = window.noa.rendering.getScene()
    const cam = scene.activeCamera
    window.BABYLON_PROJECT = (pos, sc, w, h) => {
      const view = cam.getViewMatrix()
      const proj = cam.getProjectionMatrix()
      const m = view.multiply(proj)
      const v = pos
      const x = v.x * m.m[0] + v.y * m.m[4] + v.z * m.m[8] + m.m[12]
      const y = v.x * m.m[1] + v.y * m.m[5] + v.z * m.m[9] + m.m[13]
      const wgt = v.x * m.m[3] + v.y * m.m[7] + v.z * m.m[11] + m.m[15]
      return { x: (x / wgt * 0.5 + 0.5) * w, y: (-y / wgt * 0.5 + 0.5) * h }
    }
  })
}

/**
 * Read a crop off the GPU while the back buffer is still bound.
 *
 * `n` comes back so a caller can prove the sample is not empty. A probe that
 * reads zero pixels and then asserts about their mean passes vacuously, and
 * this repo has shipped one.
 */
async function readCrop(page, cx, cy, w = CROP_W, h = CROP_H) {
  const s = await page.evaluate(([x, y, cw, ch]) => new Promise((resolve) => {
    const scene = window.noa.rendering.getScene()
    const gl = scene.getEngine()._gl
    scene.onAfterRenderObservable.addOnce(() => {
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight
      const x0 = Math.max(0, Math.min(W - cw, Math.round(x - cw / 2)))
      const y0 = Math.max(0, Math.min(H - ch, Math.round(y - ch / 2)))
      const buf = new Uint8Array(cw * ch * 4)
      gl.readPixels(x0, y0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, buf)
      resolve({ px: Array.from(buf), n: cw * ch, x0, y0 })
    })
  }), [cx, cy, w, h])
  expect(s.n, 'read no pixels at all -- this measurement proved nothing')
    .toBe(w * h)
  return s
}

/** Mean absolute channel difference between two crops, 0..255. */
function diff(a, b) {
  expect(a.px.length, 'crops of different sizes cannot be compared').toBe(b.px.length)
  let sum = 0, n = 0
  for (let i = 0; i < a.px.length; i += 4) {
    for (let c = 0; c < 3; c++) { sum += Math.abs(a.px[i + c] - b.px[i + c]); n++ }
  }
  return sum / n
}

/** The largest single-channel difference anywhere in the crop. */
function maxDiff(a, b) {
  let m = 0
  for (let i = 0; i < a.px.length; i += 4) {
    for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(a.px[i + c] - b.px[i + c]))
  }
  return m
}

/** Fraction of the crop that is crisp white text. */
function whiteFraction(s) {
  let n = 0
  for (let i = 0; i < s.px.length; i += 4) if (isWhite(s.px[i], s.px[i + 1], s.px[i + 2])) n++
  return n / s.n
}

/** Mean colour of a crop, 0..255 per channel. */
function mean(s) {
  const out = [0, 0, 0]
  for (let i = 0; i < s.px.length; i += 4) for (let c = 0; c < 3; c++) out[c] += s.px[i + c]
  return out.map((v) => v / s.n)
}

/**
 * Which passes of the tag are drawn.
 *
 *   both   what a player sees
 *   dim    the see-through pass alone (mesh 0), so the crisp pass can be
 *          measured as the difference between the two
 *   off    the backdrop, with no tag at all
 *
 * `isVisible` and not `setEnabled`, because npc.js rewrites setEnabled on
 * every single frame from its distance cull -- a test that set it would be
 * overwritten before the next readPixels and would measure nothing.
 */
const setTag = (page, mode) => page.evaluate((m) => {
  const meshes = window.game.aiEvan.nametag.meshes
  meshes[0].isVisible = m !== 'off'
  meshes[1].isVisible = m === 'both'
}, mode)

/** All three states at one camera position, in one place. */
async function passes(page, { w = CROP_W, h = CROP_H } = {}) {
  const out = {}
  for (const mode of ['off', 'dim', 'both']) {
    await setTag(page, mode)
    await waitFrames(page, 2)
    /*
     * Re-projected for every read rather than once. In the underwater case the
     * body is floating and the camera moves between reads; a crop computed
     * once would drift off the tag and the comparison would be between two
     * different pieces of screen.
     */
    const at = await tagAt(page)
    expect(at.onScreen, `the tag projected off screen at ${JSON.stringify(at)}`).toBe(true)
    out.at = at
    out[mode] = await readCrop(page, at.x, at.y, w, h)
  }
  await setTag(page, 'both')
  await waitFrames(page, 2)
  return out
}

/** Stand `dist` blocks from Evan on the +X side, looking at him. */
async function faceEvan(page, dist = 2.6, pitch = 0.22) {
  const at = await page.evaluate(() => [...window.game.EVAN_POS])
  await teleport(page, at[0] + dist, at[1] + 1, at[2])
  await settleOnGround(page)
  await look(page, { heading: -Math.PI / 2, pitch })
  await aimAtTag(page)
  await waitTicks(page, 2)
  return at
}

/** A wall of `id`, two blocks behind Evan's head and wider than his tag. */
async function wallBehind(page, id, terrain) {
  const at = await page.evaluate(() => [...window.game.EVAN_POS])
  const x = Math.floor(at[0]) - 2
  const z0 = Math.floor(at[2]) - 3, z1 = Math.floor(at[2]) + 3
  const y0 = Math.floor(at[1]), y1 = y0 + 5
  await terrain.keep([x, y0, z0], [x, y1, z1])
  await page.evaluate(([bx, by0, by1, bz0, bz1, b]) => {
    for (let y = by0; y <= by1; y++) for (let z = bz0; z <= bz1; z++) window.noa.setBlock(b, bx, y, z)
  }, [x, y0, y1, z0, z1, id])
  await waitTicks(page, 4)
  await waitFrames(page, 2)
}

/**
 * Point the camera at the tag itself, from wherever the camera happens to be.
 *
 * Every case below needs the tag in frame and none of them care where the
 * camera is standing, so the angles come from the tag's own position rather
 * than from a table of headings that has to be re-derived every time a case
 * moves. heading 0 is +Z and positive pitch looks DOWN in this engine (see
 * HEADING in helpers/world.js, and spec 25 for the measurement).
 */
async function aimAtTag(page) {
  const a = await page.evaluate(() => {
    const scene = window.noa.rendering.getScene()
    const cam = scene.activeCamera.globalPosition
    const m = window.game.aiEvan.nametag.meshes[0].getAbsolutePosition()
    const dx = m.x - cam.x, dy = m.y - cam.y, dz = m.z - cam.z
    return { heading: Math.atan2(dx, dz), pitch: -Math.atan2(dy, Math.hypot(dx, dz)) }
  })
  await look(page, a)
  return a
}

/** Where the block in your hand is on screen. It is parented to the camera,
 *  so this does not move when you look around -- which is what makes it a
 *  target to steer the tag onto. */
const handAt = (page) => page.evaluate(() => {
  const scene = window.noa.rendering.getScene()
  const engine = scene.getEngine()
  const w = engine.getRenderWidth(), h = engine.getRenderHeight()
  const mesh = window.game.held.block
  const p = window.BABYLON_PROJECT(mesh.getBoundingInfo().boundingBox.centerWorld, scene, w, h)
  return { x: p.x, yTop: p.y, y: h - p.y }
})

/** One block in the selected slot. Lifted from spec 67's `hold`. */
async function hold(page, id) {
  await page.evaluate((k) => {
    const g = window.game
    g.inventory.slots.fill(null)
    g.inventory.add(k, 1)
    g.inventory.select(0)
    g.inventory.emitChange()
  }, id)
  await waitTicks(page, 3)
  await waitFrames(page, 3)
}

/**
 * Turn the camera until Evan's nametag lands on top of the held block.
 *
 * A measured Jacobian rather than trigonometry: two probe turns say how many
 * pixels a radian of heading and a radian of pitch are worth at this fov and
 * this distance, and two Newton steps land on the hand. Working the angles out
 * analytically means reimplementing the projection the test is measuring, and
 * getting a sign wrong there fails silently as "the tag is somewhere else".
 */
async function aimTagOntoHand(page) {
  const start = await page.evaluate(() => ({
    h: window.noa.camera.heading, p: window.noa.camera.pitch,
  }))
  let { h, p } = start
  const D = 0.05
  let tag = await tagAt(page)
  const hand = await handAt(page)
  for (let i = 0; i < 4; i++) {
    await look(page, { heading: h, pitch: p })
    tag = await tagAt(page)
    const ex = hand.x - tag.x, ey = hand.yTop - tag.yTop
    if (Math.hypot(ex, ey) < 8) break
    await look(page, { heading: h + D, pitch: p })
    const th = await tagAt(page)
    await look(page, { heading: h, pitch: p + D })
    const tp = await tagAt(page)
    const a = (th.x - tag.x) / D, b = (tp.x - tag.x) / D
    const c = (th.yTop - tag.yTop) / D, d = (tp.yTop - tag.yTop) / D
    const det = a * d - b * c
    if (!det) break
    h += (d * ex - b * ey) / det
    p += (-c * ex + a * ey) / det
  }
  await look(page, { heading: h, pitch: p })
  tag = await tagAt(page)
  return { tag, hand, err: Math.hypot(hand.x - tag.x, hand.yTop - tag.yTop) }
}

/** Show or hide the cloud layer, so "is there a cloud behind the name" can be
 *  answered by subtraction instead of by guessing at a colour. Fog turns a
 *  distant cloud the same blue as the sky it is in front of, which is exactly
 *  the case a colour classifier gets wrong. */
const setClouds = (page, on) => page.evaluate((v) => {
  window.noa.rendering.getScene().getMeshByName('clouds').isVisible = v
}, on)

/**
 * Stand somewhere around Evan where a cloud is actually behind his name.
 *
 * The elevation of the tag above a standing camera is fixed by geometry -- the
 * closer you stand the steeper the ray leaves, and the cloud layer at y=192 is
 * only reachable at all from close up -- so the sweep is over heading at a
 * short distance. Returns the heading that worked, or null.
 */
async function findCloudBackdrop(page, dist = 1.35) {
  const at = await page.evaluate(() => [...window.game.EVAN_POS])
  for (let k = 0; k < 12; k++) {
    const a = (k * Math.PI) / 6
    const ox = Math.cos(a) * dist, oz = Math.sin(a) * dist
    await teleport(page, at[0] + ox, at[1] + 1, at[2] + oz)
    await settleOnGround(page)
    await aimAtTag(page)
    await setTag(page, 'off')
    await waitFrames(page, 2)
    const t = await tagAt(page)
    if (!t.onScreen) continue
    const withClouds = await readCrop(page, t.x, t.y)
    await setClouds(page, false)
    await waitFrames(page, 2)
    const without = await readCrop(page, t.x, t.y)
    await setClouds(page, true)
    await setTag(page, 'both')
    await waitFrames(page, 2)
    /*
     * 35 and not "any difference at all". A cloud EDGE crossing the corner of
     * the crop passes a loose threshold and then leaves most of the name
     * against blue sky, which is how the first run of this file passed while
     * the clouds were still painting over the tag. Cloud grey against sky blue
     * is worth about 56 mean channels; 35 means most of the crop is cloud.
     */
    if (diff(withClouds, without) > 35) {
      return { heading: a, cloudiness: diff(withClouds, without) }
    }
  }
  await setClouds(page, true)
  await setTag(page, 'both')
  return null
}

/**
 * Put the camera and Evan in the same body of water.
 *
 * A stone rim and then fill, which is spec 28's shape for spec 28's reason:
 * water poured into open terrain drains for as long as the test is running and
 * the thing being measured (is the tag under the tint) starts and stops on its
 * own. The rim is behind Evan from every angle this test uses, so it is also
 * the backdrop.
 */
async function flood(page, terrain) {
  const at = await page.evaluate(() => [...window.game.EVAN_POS])
  const x0 = Math.floor(at[0]) - 4, x1 = Math.floor(at[0]) + 4
  const z0 = Math.floor(at[2]) - 4, z1 = Math.floor(at[2]) + 4
  const y0 = Math.floor(at[1]), y1 = y0 + 5
  await terrain.keep([x0, y0, z0], [x1, y1, z1])
  await page.evaluate(([ax, bx, az, bz, ay, by, stone, water]) => {
    for (let x = ax; x <= bx; x++) {
      for (let z = az; z <= bz; z++) {
        const rim = x === ax || x === bx || z === az || z === bz
        for (let y = ay; y <= by; y++) {
          window.noa.setBlock(rim ? stone : (y === by ? 0 : water), x, y, z)
        }
      }
    }
  }, [x0, x1, z0, z1, y0, y1, ID.stone, WATER])
  await waitTicks(page, 6)
  // Stand in it, eyes under the surface.
  await teleport(page, at[0] + 2.6, y1 - 2, at[2])
  await waitTicks(page, 4)
  await aimAtTag(page)
}

/** Water, duplicated from blocks.js for the reason helpers/world.js gives for
 *  duplicating every other id: a renumber should fail here, not follow. */
const WATER = 636

test.describe('a nametag is drawn over the world and under your hand', () => {
  test.beforeEach(async ({ page }) => {
    await installProject(page)
    await page.evaluate((t) => window.game.sky.setTime(t), NOON)
    await waitTicks(page, 2)
  })

  test('against open sky, both passes land', async ({ page }) => {
    await faceEvan(page)
    const p = await passes(page)
    await shot(page, 'nametag-order-sky')

    // The dark plate is the see-through pass, and it has to darken the sky.
    expect(diff(p.off, p.dim), 'the see-through pass changed nothing').toBeGreaterThan(4)
    expect(mean(p.dim)[2], 'the plate should DARKEN the sky, not lighten it')
      .toBeLessThan(mean(p.off)[2])
    // And the crisp pass has to put real white text on top of it.
    expect(whiteFraction(p.both), 'no crisp white text anywhere in the crop')
      .toBeGreaterThan(0.02)
    expect(whiteFraction(p.both)).toBeGreaterThan(whiteFraction(p.dim) + 0.01)
  })

  test('against solid stone, both passes land', async ({ page, terrain }) => {
    await faceEvan(page)
    await wallBehind(page, ID.stone, terrain)
    const p = await passes(page)
    await shot(page, 'nametag-order-stone')
    expect(diff(p.off, p.dim)).toBeGreaterThan(4)
    expect(whiteFraction(p.both), 'the name is not readable against stone')
      .toBeGreaterThan(0.02)
  })

  /*
   * THE FIRST HALF OF THE REPORT. Leaves are on the alpha atlas page, whose
   * chunk mesh reports needAlphaBlending() true, so it is a TRANSPARENT mesh
   * on the default alphaIndex -- and before the fix it was drawn after the tag
   * and covered it.
   */
  test('against leaves, the name is not painted over', async ({ page, terrain }) => {
    await faceEvan(page)
    await wallBehind(page, 158, terrain)   // oak leaves; game.itemId('oak_leaves')
    const p = await passes(page)
    await shot(page, 'nametag-order-leaves')
    expect(diff(p.off, p.dim), 'the leaves swallowed the see-through pass')
      .toBeGreaterThan(4)
    expect(whiteFraction(p.both), 'the leaves swallowed the crisp text')
      .toBeGreaterThan(0.02)
  })

  /*
   * THE OTHER DIRECTION, and the one that proves the world's depth buffer
   * survived into the tag's rendering group. A STONE wall between the camera
   * and the tag must beat the crisp pass and lose to the see-through one. If
   * nametag.js had taken a group with Babylon's default depth clear, this test
   * would see full white text through the mountain.
   *
   * STONE AND NOT LEAVES, and the reason is a real divergence worth knowing:
   * noa puts the whole alpha atlas page (leaves, glass, water) on a material
   * whose needAlphaBlending() is TRUE, and Babylon does not depth-write a
   * blended mesh. So leaves in this engine occlude NOTHING -- not a nametag,
   * not each other's far faces. Vanilla's leaves are in the cutout layer and
   * do write depth, so a name behind a tree there is dim. Noted rather than
   * fixed: it is a property of how terrain is meshed, it is the same reason
   * the tag was being painted over in the first place, and changing it is a
   * terrain-wide decision rather than a nametag one.
   */
  test('behind stone, the crisp pass is occluded and the dim one is not',
    async ({ page, terrain }) => {
      await faceEvan(page)
      const clear = await passes(page)
      const at = await page.evaluate(() => [...window.game.EVAN_POS])
      const x = Math.floor(at[0]) + 1
      const y0 = Math.floor(at[1]), y1 = y0 + 5
      const z0 = Math.floor(at[2]) - 3, z1 = Math.floor(at[2]) + 3
      await terrain.keep([x, y0, z0], [x, y1, z1])
      await page.evaluate(([bx, by0, by1, bz0, bz1, b]) => {
        for (let y = by0; y <= by1; y++) {
          for (let z = bz0; z <= bz1; z++) window.noa.setBlock(b, bx, y, z)
        }
      }, [x, y0, y1, z0, z1, ID.stone])
      await waitTicks(page, 4)
      await waitFrames(page, 2)

      const p = await passes(page)
      await shot(page, 'nametag-order-occluded')
      expect(whiteFraction(clear.both), 'the unoccluded control saw no text either'
        + ' -- this comparison would prove nothing').toBeGreaterThan(0.02)
      expect(diff(p.off, p.dim), 'the see-through pass stopped showing through')
        .toBeGreaterThan(4)
      expect(whiteFraction(p.both), 'crisp white text drew THROUGH the stone,'
        + ' which means the depth buffer was cleared under it')
        .toBeLessThan(whiteFraction(clear.both) / 3)
    })

  /*
   * THE OTHER HALF OF THE REPORT. Clouds are geometry (sky.js says at length
   * why), they are alpha 0.8, and they were on the default alphaIndex -- so
   * they drew after a tag that had claimed alphaIndex 0 and painted it out.
   * The sky is scene.clearColor and cannot paint over anything, which is why
   * the two disagreed.
   *
   * The backdrop is CLASSIFIED, not assumed: the crop is read first with the
   * tag hidden and the test refuses to run unless what is behind the name is
   * actually cloud-white. "I stood somewhere a cloud probably was" is how a
   * test like this passes against blue sky and proves nothing.
   */
  test('against a cloud, the name is not painted over', async ({ page }) => {
    const found = await findCloudBackdrop(page)
    expect(found, 'no direction around Evan put a cloud behind his name, so'
      + ' this test never looked at a cloud at all').not.toBe(null)
    const p = await passes(page)
    await shot(page, 'nametag-order-cloud')
    // Cloud-white is the same white the crisp pass draws in, so brightness
    // alone cannot answer this. The DARK PLATE can: it is the one part of a
    // nametag that is darker than a cloud.
    expect(diff(p.off, p.dim), 'the cloud swallowed the see-through pass')
      .toBeGreaterThan(4)
    expect(mean(p.dim)[0], 'the plate did not darken the cloud')
      .toBeLessThan(mean(p.off)[0])
    expect(diff(p.off, p.both), 'the cloud swallowed the whole tag')
      .toBeGreaterThan(4)
    /*
     * AND THE CRISP PASS HAS TO BE ON TOP OF THE CLOUD, which is the whole
     * report. Drawn under the cloud the text is still faintly there -- a grey
     * ghost of a name, which is what the bug looked like -- so every threshold
     * above still passes on the broken build. Pure white is the thing that
     * does not survive being blended under a 0.8-alpha cloud, and the cloud
     * itself is grey-blue enough (spread ~25 channels) to fail this classifier
     * on its own.
     */
    expect(whiteFraction(p.both), 'the name is a grey ghost behind the cloud'
      + ' rather than white text in front of it')
      .toBeGreaterThan(whiteFraction(p.dim) + 0.01)
  })

  /*
   * THE REGRESSION THIS FIX MOST EASILY CAUSES. The see-through pass runs with
   * depthFunction ALWAYS, so a nametag in any group above the viewmodel would
   * draw a name straight through your own fist. The tag is aimed ONTO the held
   * block here and the hand's pixels have to come back byte-identical.
   */
  test('the held block draws over the name, not under it', async ({ page }) => {
    await faceEvan(page, 2.2, 0)
    await hold(page, ID.stone)
    const aim = await aimTagOntoHand(page)
    expect(aim.err, 'could not steer the tag onto the hand, so nothing below'
      + ' is a test of the hand at all').toBeLessThan(24)

    // The crop is the HAND, not the tag: a fixed box around the held block.
    const hand = await handAt(page)
    await setTag(page, 'off')
    await waitFrames(page, 2)
    const withoutTag = await readCrop(page, hand.x, hand.y, 64, 64)
    await setTag(page, 'both')
    await waitFrames(page, 2)
    const withTag = await readCrop(page, hand.x, hand.y, 64, 64)
    await shot(page, 'nametag-order-hand')

    // Non-vacuity, two ways. The crop has to contain the hand, and the tag has
    // to be inside the crop -- otherwise "nothing changed" is trivially true.
    const noHand = await page.evaluate(() => {
      window.game.held.block.isVisible = false
      return true
    })
    await waitFrames(page, 2)
    const handHidden = await readCrop(page, hand.x, hand.y, 64, 64)
    await page.evaluate(() => { window.game.held.block.isVisible = true })
    await waitFrames(page, 2)
    expect(noHand && diff(withTag, handHidden), 'the crop does not contain the'
      + ' held block, so it proves nothing about the hand').toBeGreaterThan(4)
    expect(Math.abs(aim.tag.x - hand.x), 'the tag is not inside the hand crop')
      .toBeLessThan(32)

    expect(maxDiff(withoutTag, withTag), 'the nametag changed pixels where the'
      + ' held block is -- a name is drawing through your own hand')
      .toBe(0)
  })

  /*
   * The underwater tint is a full-screen medium you are looking THROUGH, so it
   * is above the names as well as above the hand. If the tag were drawn after
   * it, the crisp pass would come back pure white while everything around it
   * is green.
   */
  test('under water the name is tinted, not drawn over the tint',
    async ({ page, terrain }) => {
      await faceEvan(page, 2.6, 0)
      const dry = await passes(page)
      await flood(page, terrain)
      await page.waitForFunction(() => window.game.underwater.submerged,
        null, { timeout: 10_000, polling: 20 })
      await waitFrames(page, 3)
      const wet = await passes(page)
      await shot(page, 'nametag-order-underwater')

      expect(whiteFraction(dry.both), 'the dry control saw no text').toBeGreaterThan(0.02)
      expect(diff(wet.off, wet.both), 'the tag vanished under water')
        .toBeGreaterThan(4)
      expect(whiteFraction(wet.both), 'the crisp text came back pure white under'
        + ' water, which means it drew OVER the tint instead of through it')
        .toBeLessThan(whiteFraction(dry.both) / 2)
    })
})
