import { test, expect } from './fixtures.js'
import {
  waitTicks, waitFrames, teleport, look, useGamemode, doubleTapFly, setBlock,
  isFlying, ID, HEADING,
} from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * IS THE TEXT ON A SIGN ACTUALLY CRISP, measured rather than looked at.
 *
 * Reported from play: "texture of text on sign is a liitle cooked/grainy".
 * 76-signs.spec.js photographs signs and says out loud that legibility is a
 * screenshot and nothing in that file can honestly assert it. That is true of
 * "can a person read this". It is NOT true of "is this image a clean scaling
 * of a pixel font", which is a question about pixel geometry and which this
 * file answers with numbers.
 *
 *
 * WHY THE OBVIOUS METRIC IS THE WRONG ONE HERE. The usual graininess ruler is
 * "how many distinct intensities does a glyph's stroke contain" -- two for a
 * clean NEAREST glyph, many for a filtered one. Sign text takes the
 * ALPHA-TEST path (signText.js says why: a texel is a glyph or it is nothing),
 * so its ink is already exactly one value -- a census of the reported
 * screenshot found 1158 pixels at luminance 0 and no shade of grey between
 * ink and wood except a few dozen on the triangle edges. Intensity was
 * two-valued while the text was visibly cooked, so intensity was measuring
 * the wrong thing.
 *
 * The defect is GEOMETRIC. Stroke weight was uneven -- a stem one pixel wide
 * here and two there, with the edge wandering as it went down the glyph. So
 * the ruler is ROW AGREEMENT:
 *
 *   Scale a pixel font up by s screen pixels per font pixel and the s
 *   scanlines that cover one font-pixel row are IDENTICAL, because they are
 *   the same row of texels sampled s times. Only the boundaries between font
 *   pixels differ. So in a clean render the fraction of adjacent scanline
 *   pairs that match exactly is about 1 - 1/s, and every pixel of
 *   disagreement beyond that is the sampler picking a different texel for the
 *   same font pixel -- which is the artefact, by definition.
 *
 * `jitter` is the same quantity the other way up and is the one to watch: the
 * mean number of pixels that change between one scanline and the next, as a
 * fraction of the ink in the band. It does not care how big the text is on
 * screen, how dark the wood is, or how the sign is lit.
 */

/** Mid-air over the spawn column, the room 66-torch and 76-signs both use. */
const PY = 200
const CX = 40
const CZ = 20
const ROOM = 6

/*
 * Ids duplicated rather than imported, the rule the rest of the suite
 * follows: a renumber should fail here loudly instead of quietly following.
 */
const SIGN_SOUTH = 660

/*
 * THE SIGN GOES UP A TWO-BLOCK PILLAR AND THE CAMERA FLIES TO MEET IT, so
 * every measurement below is HEAD ON with the pitch at zero.
 *
 * This is the difference between measuring the sampler and measuring the
 * lens. Photographed from the floor at 19 degrees down -- 76-signs' vantage,
 * and the honest one for a visitor -- the board is tilted away from the
 * camera, so its horizontal scale changes as you go down it and a stroke's
 * edge genuinely lands one pixel further left at the bottom of a glyph than
 * at the top. That is perspective, it is in vanilla too, and no atlas can
 * remove it; it also swamps the artefact this file is about. Flat on, it is
 * gone, and what is left is the sampler alone.
 *
 * The floor-level photograph is still taken, at the bottom, as evidence.
 *
 * TEXT_OFFSET_Y is 1/3 of a block above the sign's own cell, and the eye is
 * 1.62 above the feet, so the feet go at SIGN_Y + 1/3 - 1.62. Creative
 * flight, which is what makes a non-integer standing height possible at all.
 */
const SIGN_Y = PY + 3
const EYE_FEET = SIGN_Y + 0.33333334 - 1.62

/** Ink is pure black under the alpha-test path. Wood never gets near this. */
const INK = 30

const lines = ['Millard North', 'The real thing']

async function signRoom(page, r = ROOM) {
  await useGamemode(page, 'creative')
  // doubleTapFly TOGGLES, and every spec here shares one booted world.
  if (!await isFlying(page)) await doubleTapFly(page)
  await teleport(page, CX + 0.5, PY + 2, CZ + 0.5)
  await page.waitForFunction(([x, y, z]) => {
    const w = window.noa.world
    const CS = w._chunkSize
    const c = w._storage.getChunkByIndexes(
      Math.floor(x / CS), Math.floor(y / CS), Math.floor(z / CS))
    return !!c && !c.isDisposed
  }, [CX, PY, CZ], { timeout: 20_000 })

  await page.evaluate(([cx, cz, y, rr, stone, air]) => {
    for (let dx = -rr; dx <= rr; dx++) {
      for (let dz = -rr; dz <= rr; dz++) {
        window.noa.setBlock(stone, cx + dx, y, cz + dz)
        for (let dy = 1; dy <= 6; dy++) window.noa.setBlock(air, cx + dx, y + dy, cz + dz)
      }
    }
  }, [CX, CZ, PY, r, ID.stone, ID.air])
  await waitTicks(page, 4)
}

/**
 * Stand at a vantage south of the sign, looking north at it.
 *
 * NO TARGETED BLOCK while the camera is there, and that is not tidiness.
 * highlight.js draws a black wire cube around whatever the crosshair is on,
 * the crosshair is on the sign at every distance inside noa's reach, and the
 * ink census below cannot tell a wire from a stroke -- the first run of this
 * file measured 182 pixels of block outline on a board with no text on it and
 * reported a jitter for it. blockTestDistance 0 means nothing is targeted, so
 * there is no cube; the boot value is restored by the fixture's world reset.
 */
async function stand(page, z, { pitch = 0, y = EYE_FEET, heading = HEADING.northMinusZ } = {}) {
  await page.evaluate(() => { window.noa.blockTestDistance = 0 })
  await teleport(page, CX + 0.5, y, z)
  await look(page, { heading, pitch })
  await waitFrames(page, 4)
}

/** The whole board and nothing of the HUD, which also has black pixels in it. */
const BOARD = { x: 340, y: 60, w: 600, h: 540 }

/**
 * Fly to level with the text, by looking at where the text came out.
 *
 * ARITHMETIC WAS TRIED FIRST and it is wrong by half a block: eye height is
 * 1.62 and noa's camera target follows the player with that offset, but the
 * follow is a separate entity that lerps, and a teleport plus four frames is
 * not where it ends up. Rather than tune a constant against a lag, this
 * measures the error in the only units that matter -- the text is level with
 * the eye exactly when it is centred in the frame -- and closes it. Two
 * passes is convergence; the third is there to fail rather than to run.
 */
async function levelWith(page, z) {
  let y = EYE_FEET
  for (let i = 0; i < 3; i++) {
    await stand(page, z, { y })
    const m = await measureText(page, BOARD)
    if (!m.ink) break
    const off = BOARD.y + m.box.y + m.box.h / 2 - 360
    if (Math.abs(off) < 2) return y
    const fov = await page.evaluate(
      () => window.noa.rendering.getScene().activeCamera.fov)
    y -= (off / (360 / Math.tan(fov / 2))) * (z - CZ)
  }
  return y
}

/**
 * Put the sign in, with the camera already where it will be photographed
 * from.
 *
 * ORDER MATTERS AND COST A RUN. installPlacementOrientation resolves a sign
 * to the segment facing whoever placed it, so a sign planted while the camera
 * still pointed somewhere else came out as 668 (facing north) and the board
 * occluded its own text -- an empty photograph that the measurement happily
 * put a number on. The assertion is the guard.
 */
async function plant(page) {
  await setBlock(page, ID.stone, CX, PY + 1, CZ)
  await setBlock(page, ID.stone, CX, PY + 2, CZ)
  await setBlock(page, SIGN_SOUTH, CX, SIGN_Y, CZ)
  await page.evaluate(([x, y, z, t]) =>
    window.game.signs.setSignText(x, y, z, t), [CX, SIGN_Y, CZ, lines])
  await waitTicks(page, 6)
  await waitFrames(page, 4)
  expect(await page.evaluate(([x, y, z]) => window.noa.getBlock(x, y, z),
    [CX, SIGN_Y, CZ]), 'the sign is not facing the camera').toBe(SIGN_SOUTH)
}

/**
 * Find the text on screen and measure it.
 *
 * The crop is DERIVED, not hard-coded: the ink's own bounding box inside a
 * window around the centre of the frame. A hard-coded rect silently measures
 * wood the day the camera moves half a block, and wood has no jitter at all,
 * so the test would improve rather than fail.
 */
async function measureText(page, window_ = { x: 440, y: 240, w: 400, h: 240 }) {
  const buf = await page.screenshot({
    clip: { x: window_.x, y: window_.y, width: window_.w, height: window_.h },
  })
  return page.evaluate(([url, ink]) => new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = img.width; c.height = img.height
      const g = c.getContext('2d')
      g.drawImage(img, 0, 0)
      const d = g.getImageData(0, 0, c.width, c.height).data
      const at = (x, y) => {
        const i = (y * c.width + x) * 4
        return (d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10 < ink ? 1 : 0
      }

      let x0 = c.width, x1 = -1, y0 = c.height, y1 = -1, total = 0
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          if (!at(x, y)) continue
          total++
          if (x < x0) x0 = x; if (x > x1) x1 = x
          if (y < y0) y0 = y; if (y > y1) y1 = y
        }
      }
      if (total === 0) { resolve({ ink: 0 }); return }

      // Row agreement, over the ink's own box only.
      const rows = []
      for (let y = y0; y <= y1; y++) {
        const row = []
        for (let x = x0; x <= x1; x++) row.push(at(x, y))
        rows.push(row)
      }
      let changes = 0, identical = 0
      for (let i = 1; i < rows.length; i++) {
        let diff = 0
        for (let x = 0; x < rows[i].length; x++) diff += rows[i][x] ^ rows[i - 1][x]
        changes += diff
        if (diff === 0) identical++
      }
      const pairs = Math.max(1, rows.length - 1)

      /*
       * And the same claim stated as a COUNT rather than as a neighbour
       * comparison: how many different scanlines are in the band at all. Two
       * lines of Monocraft are 19 font-pixel rows, so a clean scaling can
       * hold at most 19 distinct patterns however many screen pixels it is
       * stretched over. Every pattern past that is one the font does not
       * contain. This is the number that moved furthest on the fix and it is
       * the one that is hardest to argue with, because it has a ceiling that
       * comes from the font rather than from the camera.
       */
      const distinctRows = new Set(rows.map(r => r.join(''))).size

      /*
       * The row PROFILE, for the distance check: ink per scanline. Two lines
       * of text that are still distinct leave an empty band between them, and
       * a run of zero rows inside the box is exactly that band.
       */
      const profile = rows.map(r => r.reduce((a, b) => a + b, 0))

      resolve({
        ink: total,
        box: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 },
        jitter: +(changes / pairs / (total / rows.length)).toFixed(3),
        identicalRows: +(identical / pairs).toFixed(3),
        distinctRows,
        scanlines: rows.length,
        profile,
      })
    }
    img.src = url
  }), [`data:image/png;base64,${buf.toString('base64')}`, INK])
}

/** The empty bands inside the ink box: how many, and the longest. */
const gaps = (profile) => {
  const runs = []
  let n = 0
  for (const v of profile) {
    if (v === 0) n++
    else if (n) { runs.push(n); n = 0 }
  }
  if (n) runs.push(n)
  return runs
}

test.describe('sign text is a clean scaling of a pixel font', () => {
  test('close up: the scanlines inside a font pixel row agree', async ({ page }) => {
    await signRoom(page)
    await stand(page, CZ + 2.2)
    await plant(page)
    await levelWith(page, CZ + 2.2)

    await shot(page, 'sign-crisp-close')
    const m = await measureText(page, BOARD)
    console.log(`  close: ${JSON.stringify({ ...m, profile: undefined })}`)

    /*
     * ASSERT THE SAMPLE FIRST. Every number below is a ratio over the ink in
     * the crop, and an empty crop makes all of them vacuous -- which is how
     * five mutations in this repo have failed to fail.
     */
    expect(m.ink, 'no sign text in the crop at all').toBeGreaterThan(400)
    expect(m.box.w, 'the ink box is not a line of text').toBeGreaterThan(100)
    expect(m.box.h).toBeGreaterThan(20)

    /*
     * THE LINE, on the measurement that has a ceiling. Two lines of Monocraft
     * are 19 font-pixel rows, the crop is 58 scanlines, and a clean scaling
     * cannot contain more than 19 different ones however far it is stretched.
     *
     *                            distinctRows      identicalRows
     *                          chromium  webkit   chromium  webkit
     *   8x atlas                   22      24       0.632    0.600
     *   snapped to the grid        17      17       0.719    0.719
     *
     * Both engines, and after the fix they agree to three decimal places
     * because they are now sampling the same bitmap. They did not before:
     * the two rasterisers put Monocraft's pixel grid at different offsets,
     * which is the trap the atlas test at the bottom of this file exists to
     * hold shut.
     *
     * 17 is UNDER the font's own row count, because some of the font's rows
     * happen to be identical patterns in this pair of lines. That is the
     * signature of an exact scaling and it is what this file exists to hold.
     *
     * (jitter barely moved and is reported rather than asserted. It is
     * normalised by the ink in the band, and the fix removes ink -- the
     * fringe texels that used to clear the alpha-test cutoff -- so the
     * denominator shrank with the numerator. Kept in the log because it is
     * the number that would catch a change that made strokes heavier.)
     *
     * 21 and 0.66 sit between the two rows of that table on both engines.
     * Reverting signText.js's drawGlyphAtlas fails both, on both.
     */
    expect(m.distinctRows, 'more scanlines than the font has rows')
      .toBeLessThan(21)
    expect(m.identicalRows, 'scanlines inside one font-pixel row disagree')
      .toBeGreaterThan(0.66)

    /*
     * EVIDENCE, and deliberately from the vantage the assertions do not use:
     * a visitor standing on the floor reading a sign at head height, which is
     * 76-signs' photograph and the one the report was made against.
     */
    await stand(page, CZ + 2.6, { pitch: -0.28, y: PY + 1 })
    await shot(page, 'sign-crisp-standing')
    await stand(page, CZ + 3.2, { pitch: -0.34, y: PY + 1, heading: HEADING.northMinusZ - 0.42 })
    await shot(page, 'sign-crisp-glancing')
  })

  test('at ten blocks the two lines are still two lines', async ({ page }) => {
    await signRoom(page)
    await stand(page, CZ + 2.2)
    await plant(page)
    await levelWith(page, CZ + 10)

    await shot(page, 'sign-crisp-far')
    const m = await measureText(page, BOARD)
    const band = gaps(m.profile ?? [])
    console.log(`  ten blocks: ink ${m.ink}, box ${JSON.stringify(m.box)}, `
      + `empty bands ${JSON.stringify(band)}, profile ${JSON.stringify(m.profile)}`)

    /*
     * WHAT MUST NOT REGRESS. The sign agent's finding was that at ten blocks
     * a board reads as a sign and the glyph rows stay distinct -- "not grey
     * mush; not readable either, which is vanilla". Both halves are numbers:
     * there is still ink, and there is still an empty scanline band between
     * the two lines of it.
     */
    expect(m.ink, 'the text vanished at ten blocks').toBeGreaterThan(60)
    expect(band.length, 'the two lines merged into one block of ink')
      .toBeGreaterThan(0)
  })

  test('the glyph atlas is a pixel grid, not a resampled photograph of one',
    async ({ page }) => {
      /*
       * THE CAUSE, asserted at the source. The atlas used to be rasterised at
       * 8 canvas pixels per font pixel, and the browser does not put a vector
       * font's edges on that grid: the dump that found this bug had 16,000
       * texels at partial alpha (0.22, 0.40, 0.46, 0.81 ...) straddling the
       * 0.4 alpha-test cutoff, and the glyph sat one texel above its own
       * cell. Which of those a screen pixel landed on was a phase lottery,
       * and the lottery is what "grainy" was.
       *
       * A pixel font's atlas has exactly two alpha values. Anything else is
       * a fringe, and a fringe is the artefact.
       */
      const a = await page.evaluate(() => {
        const scene = window.noa.rendering.getScene()
        const tex = scene.textures.find(t => t.name === 'sign-glyph-atlas')
        if (!tex) return { error: 'no atlas' }
        const canvas = tex.getContext().canvas
        const d = canvas.getContext('2d')
          .getImageData(0, 0, canvas.width, canvas.height).data
        const seen = new Set()
        let ink = 0
        for (let i = 3; i < d.length; i += 4) {
          seen.add(d[i])
          if (d[i] > 127) ink++
        }
        return { w: canvas.width, h: canvas.height, alphas: [...seen].sort((x, y) => x - y), ink }
      })
      console.log(`  atlas: ${JSON.stringify(a)}`)

      expect(a.error).toBeUndefined()
      // Non-empty first: an atlas of nothing has one alpha value and would
      // pass the assertion below without drawing a glyph.
      expect(a.ink, 'the atlas is blank').toBeGreaterThan(900)
      expect(a.alphas, 'partial coverage in a pixel font atlas').toEqual([0, 255])

      /*
       * AND THE SAME ATLAS ON BOTH ENGINES, to the texel. This is the
       * assertion that would have caught the first version of the fix: it
       * assumed the font's pixel grid started at the cell corner, which is
       * true in Chromium and four texels out in WebKit, and Safari got 1756
       * ink texels of solid blobs with every counter filled while Chromium
       * got a clean 1144. Both engines now reduce to the same bitmap because
       * the reduction measures the grid instead of assuming it -- see
       * gridPhase in signText.js. A number, not a range, because two
       * rasterisers agreeing exactly is the whole claim.
       */
      expect(a.ink, 'the two engines disagree about the font').toBe(1144)
    })
})
