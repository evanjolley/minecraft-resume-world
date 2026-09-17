import { test, expect } from './fixtures.js'
import {
  waitTicks, waitFrames, teleport, useGamemode, doubleTapFly, eyeHeight,
  targetedBlock, ID,
} from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * DOES THE PICTURE HOLD STILL WHEN THE CAMERA MOVES?
 *
 * 87-paintings.spec.js proves the picture is in the right PLACE: the quad's
 * vertices, its UVs, which way is up, which way is right. Every one of those
 * assertions passes on a painting that flickers, because all of them are read
 * off a buffer and none of them are read off the screen -- and the bug the
 * owner reported ("painting texture kinda glitches in and out when i move
 * around") is invisible in a still and invisible in a vertex buffer.
 *
 * THAT IS A Z-FIGHT'S WHOLE SIGNATURE. Two surfaces at the same depth, and
 * the per-pixel comparison between them decided by rounding: a still frame
 * picks a winner and looks fine, and the winner changes as the camera moves.
 * A painting here is exactly that shape of hazard, because
 *
 *     the FRAME is a block  -- `painting_wall_*`, 1/16 deep, whose front face
 *                              is a terrain quad at depth 1/16 from the wall
 *     the PICTURE is a mesh -- one quad, COPLANAR with that face, which is
 *                              where 1.21.8 puts a painting's art too
 *
 * so the two are parallel and overlapping, and the only thing keeping them
 * apart is the depth bias paintingArt.js puts on the picture's material.
 * That number is in depth-buffer units, so no amount of arithmetic in a
 * vertex buffer can check it -- only the GPU knows what its own depth
 * comparison did, and the only way to ask is to look at the pixels.
 *
 * SO IT IS MEASURED IN MOTION. The camera dollies toward the painting in
 * steps small enough that the IMAGE barely changes -- sub-pixel at the crop
 * size used here -- while the DEPTH of both surfaces changes by much more
 * than one quantisation step. A stable painting gives back near-identical
 * crops; a z-fighting one gives back patches of oak plank where the
 * photograph should be, in different places every frame.
 *
 * REJECTED -- diffing two screenshots from two ordinary camera positions.
 * A real camera move changes the image for a dozen honest reasons (texture
 * minification, perspective, the crop landing on different texels), so the
 * diff would be large whether or not anything is fighting and the threshold
 * would be a guess. Micro-motion makes "the image should not have changed"
 * true by construction, which is what turns the measurement into evidence.
 *
 * REJECTED -- reading gl.DEPTH_BITS and doing the precision arithmetic
 * instead. It is reported below because it explains the number, but a
 * calculation cannot see a driver that hands out a 16-bit buffer under
 * swiftshader, or a near plane somebody changes next month. The screen is the
 * only thing that knows.
 */

/** Mid-air over the spawn column, 66-torch.spec.js's reason: nothing else up here. */
const PY = 200
const CX = 40
const CZ = 20

/** The demonstration painting: 3 wide, 2 high. */
const DEMO = 'millard_north'
const DEMO_W = 3
const DEMO_H = 2

/** Block ids duplicated rather than imported -- the suite's rule. */
const PAINTING_SOUTH = 681

/*
 * The painting faces SOUTH: the picture looks toward +z, the wall is at -z
 * behind it, and the viewer stands on the +z side. `right` is the viewer's
 * right, (-n.z, 0, n.x) = (-1, 0, 0), so the rectangle grows toward -x.
 */
const NORMAL = [0, 0, 1]
const RIGHT = [-1, 0, 0]
const ANCHOR = [CX + 1, PY + 2, CZ + 1]

/** Where the middle of the picture is, in world coordinates. */
const CENTRE = [
  ANCHOR[0] + 1 - DEMO_W / 2,
  ANCHOR[1] + DEMO_H / 2,
  ANCHOR[2] + 1 / 16,
]

/** A wall to hang on, and clear air in front of it to stand in. */
async function wallAndPainting(page) {
  await useGamemode(page, 'creative')
  await doubleTapFly(page)
  await teleport(page, CX + 0.5, PY + 1, CZ + 8.5)
  await page.waitForFunction(([x, y, z]) => {
    const w = window.noa.world
    const CS = w._chunkSize
    const c = w._storage.getChunkByIndexes(
      Math.floor(x / CS), Math.floor(y / CS), Math.floor(z / CS))
    return !!c && !c.isDisposed
  }, [CX, PY, CZ], { timeout: 20_000 })

  await page.evaluate(([cx, cz, y, stone, air]) => {
    for (let dx = -8; dx <= 8; dx++) {
      for (let dy = 0; dy <= 8; dy++) {
        // The wall the painting hangs on, and everything in front of it empty
        // out to z+14 so the camera has somewhere to stand at any distance.
        window.noa.setBlock(stone, cx + dx, y + dy, cz)
        for (let dz = 1; dz <= 14; dz++) window.noa.setBlock(air, cx + dx, y + dy, cz + dz)
      }
    }
  }, [CX, CZ, PY, ID.stone, ID.air])
  await waitTicks(page, 4)

  // Blocks then art, 87's two-step: it is the only way to prove the picture
  // lands on the frame rather than that one function agrees with itself.
  await page.evaluate(([a, b, c, id, w, h, name]) => {
    for (let u = 0; u < w; u++) {
      for (let v = 0; v < h; v++) window.noa.setBlock(id, a - u, b + v, c)
    }
    return window.game.paintings.registerPainting(a, b, c, 'south', name)
  }, [...ANCHOR, PAINTING_SOUTH, DEMO_W, DEMO_H, DEMO])
  await waitTicks(page, 2)
  await waitFrames(page, 2)
}

/*
 * Vector3.Project by hand, 80-nametag-order.spec.js's copy and for its reason:
 * the spec runs in the page and the page's Babylon is whatever the bundle
 * pulled in. The matrix multiply is not the thing under test.
 */
async function installProject(page) {
  await page.evaluate(() => {
    if (window.PROJECT_POINT) return
    const scene = window.noa.rendering.getScene()
    window.PROJECT_POINT = (world) => {
      const cam = scene.activeCamera
      const m = cam.getViewMatrix().multiply(cam.getProjectionMatrix())
      const off = window.noa.worldOriginOffset
      const v = [world[0] - off[0], world[1] - off[1], world[2] - off[2]]
      const engine = scene.getEngine()
      const W = engine.getRenderWidth(), H = engine.getRenderHeight()
      const x = v[0] * m.m[0] + v[1] * m.m[4] + v[2] * m.m[8] + m.m[12]
      const y = v[0] * m.m[1] + v[1] * m.m[5] + v[2] * m.m[9] + m.m[13]
      const wgt = v[0] * m.m[3] + v[1] * m.m[7] + v[2] * m.m[11] + m.m[15]
      // readPixels counts from the BOTTOM left; Babylon's projection from the
      // top. Both are returned so a caller never has to remember which.
      const px = (x / wgt * 0.5 + 0.5) * W
      const top = (-y / wgt * 0.5 + 0.5) * H
      return { x: px, yTop: top, y: H - top, W, H, w: wgt }
    }
  })
}

/**
 * Put the eye `dist` blocks from the middle of the picture, `deg` degrees off
 * the painting's normal, level with its middle, looking straight at it.
 *
 * LEVEL, so pitch is zero and the only angle in play is the one being varied.
 * `teleport` places FEET, hence the eye-height subtraction -- 87 records the
 * run where forgetting it aimed the crosshair over the top of the painting.
 */
async function stand(page, dist, deg) {
  const eye = await eyeHeight(page)
  const t = (deg * Math.PI) / 180
  const ex = CENTRE[0] + RIGHT[0] * dist * Math.sin(t)
  const ez = CENTRE[2] + NORMAL[2] * dist * Math.cos(t)
  await teleport(page, ex, CENTRE[1] - eye, ez)
  await page.evaluate(([fx, fz]) => {
    // noa's forward at heading h is (sin h, 0, cos h).
    window.noa.camera.heading = Math.atan2(fx, fz)
    window.noa.camera.pitch = 0
  }, [CENTRE[0] - ex, CENTRE[2] - ez])
  await waitFrames(page, 3)
  return { ex, ez }
}

/** Dolly the eye by `delta` blocks straight toward the painting's middle. */
async function dolly(page, from, delta) {
  const dx = CENTRE[0] - from.ex, dz = CENTRE[2] - from.ez
  const len = Math.hypot(dx, dz)
  const eye = await eyeHeight(page)
  const ex = from.ex + (dx / len) * delta
  const ez = from.ez + (dz / len) * delta
  await teleport(page, ex, CENTRE[1] - eye, ez)
  await waitFrames(page, 2)
  return { ex, ez }
}

/**
 * The biggest rectangle of screen that is entirely INSIDE the picture.
 *
 * Projected from the quad's four corners rather than assumed to be the middle
 * of the screen, because at a grazing angle it is not: the picture is off to
 * one side and much narrower than it is tall. Inset by 25% on each side so
 * the crop can never include the frame's edge or the stone behind it -- what
 * is being counted is frame pixels WHERE THE PICTURE SHOULD BE, and a crop
 * that overlapped the rim would count the rim.
 */
async function pictureCrop(page) {
  const corners = [
    [ANCHOR[0] + 1, ANCHOR[1], ANCHOR[2] + 1 / 16],
    [ANCHOR[0] + 1 - DEMO_W, ANCHOR[1], ANCHOR[2] + 1 / 16],
    [ANCHOR[0] + 1 - DEMO_W, ANCHOR[1] + DEMO_H, ANCHOR[2] + 1 / 16],
    [ANCHOR[0] + 1, ANCHOR[1] + DEMO_H, ANCHOR[2] + 1 / 16],
  ]
  const p = await page.evaluate((cs) => cs.map(window.PROJECT_POINT), corners)
  expect(p.every((q) => q.w > 0), 'the painting projected behind the camera').toBe(true)
  const xs = p.map((q) => q.x), ys = p.map((q) => q.y)
  const x0 = Math.min(...xs), x1 = Math.max(...xs)
  const y0 = Math.min(...ys), y1 = Math.max(...ys)
  const inset = 0.25
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
  const w = Math.floor((x1 - x0) * (1 - 2 * inset))
  const h = Math.floor((y1 - y0) * (1 - 2 * inset))
  expect(w, 'the picture is too small on screen to crop').toBeGreaterThan(16)
  expect(h, 'the picture is too small on screen to crop').toBeGreaterThan(16)
  return {
    x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h,
    screen: { x0, x1, y0, y1, W: p[0].W, H: p[0].H },
  }
}

/**
 * Read a crop off the GPU while the back buffer is still bound.
 *
 * `n` comes back and is asserted non-empty, 80-nametag-order.spec.js's rule:
 * this repo has shipped a probe that read zero pixels and then passed
 * vacuously on their mean.
 */
async function readCrop(page, c) {
  const s = await page.evaluate(([x, y, cw, ch]) => new Promise((resolve) => {
    const scene = window.noa.rendering.getScene()
    const gl = scene.getEngine()._gl
    scene.onAfterRenderObservable.addOnce(() => {
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight
      const x0 = Math.max(0, Math.min(W - cw, Math.round(x)))
      const y0 = Math.max(0, Math.min(H - ch, Math.round(y)))
      const buf = new Uint8Array(cw * ch * 4)
      gl.readPixels(x0, y0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, buf)
      resolve({ px: Array.from(buf), n: cw * ch, x0, y0 })
    })
  }), [c.x, c.y, c.w, c.h])
  expect(s.n, 'read no pixels at all -- this measurement proved nothing')
    .toBe(c.w * c.h)
  return s
}

/** Fraction of pixels that moved more than `tol` on any channel. */
function unstable(a, b, tol = 24) {
  expect(a.px.length, 'crops of different sizes cannot be compared').toBe(b.px.length)
  let n = 0
  for (let i = 0; i < a.px.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      if (Math.abs(a.px[i + c] - b.px[i + c]) > tol) { n++; break }
    }
  }
  return n / a.n
}

/* ------------------------------------------------------------------ *
 * WHAT IS COUNTED, AND WHY IT IS NOT "PIXELS THAT CHANGED".
 *
 * The first version of this file asserted that a sub-pixel camera move must
 * not change the crop, and that assertion is WRONG -- not too strict, wrong.
 * Measured on a painting with the fight already fixed, dollying 1/100 of a
 * block at 3 blocks head-on still moves 1.4-1.8% of pixels, and at 72
 * degrees it moves up to 90%. Both are honest: the picture is a photograph
 * sampled TRILINEAR (paintingArt.js's textureFor explains why), so a hair of
 * camera movement re-picks mip levels and resamples texels, and at a grazing
 * angle a whole crop can cross a mip boundary at once. A threshold on that
 * number measures the texture filter, not the depth buffer.
 *
 * So the thing counted is the thing that actually goes wrong: A PIXEL OF THE
 * PICTURE THAT IS SHOWING THE FRAME INSTEAD. Two references are read at the
 * same camera position, one with the picture and one with the picture hidden
 * (the frame block stays where it is, so the second is the oak plank behind
 * it). A pixel has lost the depth fight when it is closer to the frame
 * reference than to the picture reference.
 *
 * AND ONLY WHERE THE TWO ARE TELLABLE APART. Half of a photograph of a brick
 * school is brown, oak planks are brown, and a pixel where the two agree can
 * never be evidence of anything. `discriminating` picks the pixels where the
 * picture and the frame differ by more than 40 on some channel, the count is
 * asserted to be a real fraction of the crop, and the loss rate is measured
 * over those pixels alone. A rate over an empty or tiny set is exactly the
 * vacuous pass this repo has shipped before.
 * ------------------------------------------------------------------ */

/** Indices of pixels where the picture and the bare frame look different. */
function discriminating(art, frame, tol = 40) {
  const idx = []
  for (let i = 0; i < art.px.length; i += 4) {
    const d = Math.max(
      Math.abs(art.px[i] - frame.px[i]),
      Math.abs(art.px[i + 1] - frame.px[i + 1]),
      Math.abs(art.px[i + 2] - frame.px[i + 2]))
    if (d > tol) idx.push(i)
  }
  return idx
}

/** Of the tellable-apart pixels, the fraction now showing frame, not picture. */
function lostToFrame(shown, art, frame, idx) {
  let n = 0
  for (const i of idx) {
    const dArt = Math.max(
      Math.abs(shown.px[i] - art.px[i]),
      Math.abs(shown.px[i + 1] - art.px[i + 1]),
      Math.abs(shown.px[i + 2] - art.px[i + 2]))
    const dFrame = Math.max(
      Math.abs(shown.px[i] - frame.px[i]),
      Math.abs(shown.px[i + 1] - frame.px[i + 1]),
      Math.abs(shown.px[i + 2] - frame.px[i + 2]))
    if (dFrame < dArt) n++
  }
  return n / idx.length
}

/**
 * The picture and the bare frame, photographed from where the camera stands.
 *
 * The non-empty check is the whole reason this is a function: if hiding the
 * picture changes nothing, the crop is not on the painting and every number
 * below it would be a number about stone.
 */
async function references(page, crop) {
  const art = await readCrop(page, crop)
  await setArt(page, false)
  await waitFrames(page, 2)
  const frame = await readCrop(page, crop)
  await setArt(page, true)
  await waitFrames(page, 2)
  const idx = discriminating(art, frame)
  expect(idx.length / art.n,
    'the picture and the frame behind it look the same here -- either the crop'
    + ' is not on the painting, or hiding the picture did nothing')
    .toBeGreaterThan(0.2)
  return { art, frame, idx }
}

/** Show or hide the picture mesh, leaving the frame blocks where they are. */
const setArt = (page, visible) => page.evaluate(([a, b, c, v]) => {
  const mesh = window.noa.rendering.getScene().getMeshByName(`painting-${a},${b},${c}`)
  if (!mesh) throw new Error('no art mesh for the demo painting')
  mesh.isVisible = v
}, [...ANCHOR, visible])

/* ------------------------------------------------------------------ *
 * 1. What the depth buffer can actually resolve
 * ------------------------------------------------------------------ */

test.describe('the picture and its frame', () => {
  test('reports the depth budget it is working against', async ({ page }) => {
    await wallAndPainting(page)
    const d = await page.evaluate(() => {
      const scene = window.noa.rendering.getScene()
      const gl = scene.getEngine()._gl
      const cam = scene.activeCamera
      return {
        bits: gl.getParameter(gl.DEPTH_BITS),
        minZ: cam.minZ,
        maxZ: cam.maxZ,
        group: scene.getMeshByName(`painting-${40 + 1},${200 + 2},${20 + 1}`)?.renderingGroupId,
      }
    })
    console.log('[89] depth buffer:', JSON.stringify(d))
    /*
     * The world-space size of one depth step at distance z, for a standard
     * (non-reversed) perspective buffer:
     *
     *     dz = z^2 * (f - n) / (f * n * 2^bits)
     *
     * Quoted here rather than asserted, because the number that matters is
     * the one the screen shows in the tests below. This is the explanation,
     * not the evidence.
     */
    for (const z of [2, 4, 8, 16]) {
      const step = (z * z * (d.maxZ - d.minZ)) / (d.maxZ * d.minZ * 2 ** d.bits)
      console.log(`[89] one depth step at ${z} blocks = ${step.toExponential(3)} blocks`)
    }
    // A painting must be OCCLUDED by a wall, so it belongs in the world's
    // group with the terrain -- not bumped above it like a nametag.
    expect(d.group ?? 0, 'the picture must render in the world group').toBe(0)
  })

  /* ---------------------------------------------------------------- *
   * 2. The bug, in motion
   * ---------------------------------------------------------------- */

  /*
   * FOUR CAMERAS, and the two angled ones are the point. A z-fight is worst
   * at GRAZING INCIDENCE, where a pixel covers a long run of the surface and
   * the depth gradient across it is steepest -- so 72 degrees off the normal
   * is where a fix that only works head-on is caught. 12 blocks is there
   * because the depth step grows with the SQUARE of distance: whatever wins
   * at 3 blocks has a sixteenth of the margin at 12.
   */
  for (const [dist, deg] of [[3, 0], [6, 35], [6, 72], [12, 72]]) {
    test(`holds the picture while the camera moves: ${dist} blocks, ${deg} degrees`,
      async ({ page }) => {
        await wallAndPainting(page)
        await installProject(page)
        let eye = await stand(page, dist, deg)

        const crop = await pictureCrop(page)
        const ref = await references(page, crop)

        // Motionless control. Two reads of one frame must agree, or the
        // numbers underneath are measuring the read and not the render.
        const still = await readCrop(page, crop)
        expect(lostToFrame(still, ref.art, ref.frame, ref.idx),
          'a motionless frame already disagreed with its own reference').toBe(0)

        /*
         * TWELVE STEPS OF 3/10000 OF THE VIEWING DISTANCE, and the size of
         * that step is the calibration this probe lives or dies on.
         *
         * It has to be SMALL enough that the picture does not move on
         * screen, because the references above are read once and a dolly
         * rescales the image about its centre -- drift puts photograph
         * detail on top of reference photograph detail and the comparison
         * starts reporting the drift. The first draft stepped 1/100 of a
         * block at 3 blocks, which is a 4% rescale over twelve steps and
         * read as a smooth climb from 0.06% to 9.21% "lost" pixels: the
         * signature of a sliding reference, not of a fight.
         *
         * It has to be BIG enough to move the depth comparison by more than
         * one quantisation step, or two surfaces that are going to flip
         * never get the chance. Proportional to distance because the step
         * size grows with distance squared: 3e-4 of the distance works out
         * at 50/distance depth steps per frame -- 17 at 3 blocks, 4 at 12 --
         * while costing 0.36% of rescale over the whole sweep.
         */
        let worst = 0
        const trace = []
        for (let i = 0; i < 12; i++) {
          eye = await dolly(page, eye, -dist * 3e-4)
          const now = await readCrop(page, crop)
          const lost = lostToFrame(now, ref.art, ref.frame, ref.idx)
          trace.push(+(lost * 100).toFixed(2))
          worst = Math.max(worst, lost)
        }
        console.log(`[89] ${dist}b/${deg}deg  tellable px ${ref.idx.length}/${ref.art.n}`
          + `  lost-to-frame %: ${trace.join(' ')}`)
        expect(worst, `the frame won pixels off the picture as the camera moved: ${
          trace.join(' ')} percent of the tellable pixels`).toBeLessThan(0.01)
      })
  }

  /* ---------------------------------------------------------------- *
   * 3a. The other thing the fix must not break: the selection outline
   *
   * This is the failure mode the depth bias is most likely to cause, and the
   * repo has already had it once: ART_PROUD started at 1/512, the picture
   * sat in front of its own selection box, and aiming at a painting drew no
   * outline at all while every targeting assertion stayed green. Targeting
   * was never broken; the outline was buried. So the outline is asserted on
   * the SCREEN, by hiding the wireframe and checking that something changed.
   * ---------------------------------------------------------------- */

  test('still draws a selection outline over the picture', async ({ page }) => {
    await wallAndPainting(page)
    await installProject(page)
    await stand(page, 3, 0)
    // Looking dead at the middle of the picture, so the crosshair is on it.
    const id = await targetedBlock(page)
    expect(id?.blockID, 'the crosshair is not on the painting').toBe(PAINTING_SOUTH)
    const crop = await pictureCrop(page)

    const withOutline = await readCrop(page, crop)
    const hidden = await page.evaluate(() => {
      const mesh = window.noa.rendering.getScene().getMeshByName('block-highlight')
      if (!mesh) return false
      mesh.isVisible = false
      return true
    })
    expect(hidden, 'no block-highlight mesh exists to hide').toBe(true)
    await waitFrames(page, 2)
    const withoutOutline = await readCrop(page, crop)
    await page.evaluate(() => {
      window.noa.rendering.getScene().getMeshByName('block-highlight').isVisible = true
    })
    await waitFrames(page, 2)

    /*
     * A fraction, not a count of black pixels: the outline is one pixel wide
     * and the crop is inset well inside the painting, so what shows up here
     * is the cell edges crossing the middle of the rectangle. Any is enough
     * -- the bug being guarded is "none at all".
     */
    const drawn = unstable(withOutline, withoutOutline, 40)
    console.log(`[89] outline pixels over the picture: ${(drawn * 100).toFixed(3)}%`)
    expect(drawn, 'hiding the selection outline changed nothing -- the picture'
      + ' is drawing over its own outline, which is the 1/512 bug again')
      .toBeGreaterThan(0)
  })

  /* ---------------------------------------------------------------- *
   * 3. The thing the fix must not break: a wall still hides it
   *
   * A painting is not a nametag. Every way of winning a depth fight that
   * works by leaving the depth test behind -- a higher rendering group, which
   * gets a cleared depth buffer, `disableDepthWrite`, `depthFunction = ALWAYS`
   * -- also wins it against the wall you are standing behind, and a
   * photograph glowing through four blocks of stone is a worse bug than the
   * flicker. So the fix is asserted from BOTH sides of the wall.
   * ---------------------------------------------------------------- */

  test('is still hidden by the wall it hangs on', async ({ page }) => {
    await wallAndPainting(page)
    await installProject(page)

    // FROM THE FRONT FIRST, and this half is not decoration: it proves the
    // toggle used below actually does something. "Hiding the picture changed
    // nothing" is the correct answer from behind the wall AND the answer a
    // broken probe gives everywhere, and only this read tells them apart.
    await stand(page, 4, 0)
    const front = await pictureCrop(page)
    const seen = await readCrop(page, front)
    await setArt(page, false)
    await waitFrames(page, 2)
    const hidden = await readCrop(page, front)
    await setArt(page, true)
    await waitFrames(page, 2)
    expect(unstable(seen, hidden), 'hiding the picture from the front changed'
      + ' nothing -- this probe cannot see the painting at all')
      .toBeGreaterThan(0.2)

    // Behind the wall: the far side of z = CZ, looking back toward it.
    const eye = await eyeHeight(page)
    await teleport(page, CENTRE[0], CENTRE[1] - eye, CZ - 4)
    await page.evaluate(() => {
      // Looking along +z, which is the way the painting faces: it is squarely
      // in front of the camera with a stone wall in between.
      window.noa.camera.heading = 0
      window.noa.camera.pitch = 0
    })
    await waitFrames(page, 3)
    const behind = await pictureCrop(page)
    const withArt = await readCrop(page, behind)
    await setArt(page, false)
    await waitFrames(page, 2)
    const withoutArt = await readCrop(page, behind)
    await setArt(page, true)
    await waitFrames(page, 2)
    // Byte-identical, at a tolerance of 2: from behind, turning the picture
    // off changes nothing, because the stone is in front of it.
    expect(unstable(withArt, withoutArt, 2),
      'the picture drew through the wall it hangs on').toBe(0)
    await shot(page, '89-painting-behind-wall')
  })

  /* ---------------------------------------------------------------- *
   * 4. Evidence a person reads
   * ---------------------------------------------------------------- */

  test('photographs from several angles and distances', async ({ page }) => {
    await wallAndPainting(page)
    await installProject(page)
    for (const [dist, deg, name] of [
      [3, 0, 'close-on'], [6, 35, 'oblique'], [6, 72, 'grazing'], [14, 80, 'far-grazing'],
    ]) {
      await stand(page, dist, deg)
      await shot(page, `89-painting-${name}`)
    }
  })
})
