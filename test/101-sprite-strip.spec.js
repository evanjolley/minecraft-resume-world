import { test, expect } from './fixtures.js'
import { waitTicks, waitFrames, teleport, settleOnGround, aim, SPAWN } from './helpers/world.js'

/*
 * THE SPRITE STRIP, AND THE ROW THE GPU ACTUALLY READS.
 *
 * This file exists because 93-effect-art.spec.js was green while the animation
 * ran BACKWARDS, and it was green for a reason worth writing down: it asserted
 * the JavaScript frame index. That number was right every single frame. The
 * bug was one layer below it -- particles.js samples the strip with invertY,
 * so V=0 is the BOTTOM row of the PNG, and turning a frame index into a V
 * without accounting for the flip handed age 0 the LAST band of the image.
 * Every spell mote in the world was born a two-pixel speck and EXPANDED into a
 * ring, which is the exact opposite of the collapse that effectSwirl.js,
 * build-textures.mjs and vanilla's SpellParticle all describe at length.
 *
 * So nothing here asserts a frame index on its own. The three tests are:
 *
 *   1. what is in the FILE      -- eight bands, ring diameters, widest first
 *   2. what the SAMPLER reads   -- the band a mote's V lands on, cross-checked
 *                                  against the frame the JS chose
 *   3. what the SCREEN shows    -- one big mote, measured across ten frames,
 *                                  which must get SMALLER
 *
 * Only the third can fail for a reason the first two cannot see, and only the
 * first two can say WHY the third failed. That is why all three are here.
 */

/* ------------------------------------------------------------------ *
 * 1. THE FILE
 * ------------------------------------------------------------------ */

const FRAMES = 8

/*
 * The horizontal extent of the lit pixels in each 8-row band of the strip,
 * measured rather than assumed.
 *
 * EXTENT, NOT A PIXEL COUNT, and the difference is the whole measurement.
 * Vanilla's rings are hand-drawn and a pixel wobbly, so their lit-pixel counts
 * run 15, 20, 23, 18, 17, 11, 5, 3 -- NOT monotonic, and a test built on that
 * number would assert something false about the art. The diameters are 8, 7,
 * 8, 7, 6, 5, 4, 3: the ring gets no wider as the strip goes down, which is
 * the property the animation depends on and the only one that holds.
 */
async function bandExtents(page) {
  return page.evaluate(async (frames) => {
    const bmp = await createImageBitmap(await (await fetch('/textures/particle/spell.png')).blob())
    const c = document.createElement('canvas')
    c.width = bmp.width; c.height = bmp.height
    const ctx = c.getContext('2d')
    ctx.drawImage(bmp, 0, 0)
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    const band = c.height / frames
    const out = []
    for (let f = 0; f < frames; f++) {
      let lit = 0, min = c.width, max = -1
      for (let y = f * band; y < (f + 1) * band; y++) {
        for (let x = 0; x < c.width; x++) {
          if (d[(y * c.width + x) * 4 + 3] <= 10) continue
          lit++
          if (x < min) min = x
          if (x > max) max = x
        }
      }
      out.push({ lit, width: max < 0 ? 0 : max - min + 1 })
    }
    return { width: c.width, height: c.height, bands: out }
  }, FRAMES)
}

test.describe('the spell sprite strip', () => {
  test('is eight rings stacked widest-first, top-down', async ({ page }) => {
    const strip = await bandExtents(page)

    // 8 wide and 8 tall per frame. A strip that failed to build is a 1x1
    // placeholder, and every ratio below it would still divide.
    expect(strip.width).toBe(8)
    expect(strip.height).toBe(8 * FRAMES)

    // Nothing below means anything against a fully transparent PNG, which is
    // exactly what a broken sharp pipeline writes.
    const totalLit = strip.bands.reduce((n, b) => n + b.lit, 0)
    expect(totalLit, 'the strip is blank -- every assertion below is vacuous')
      .toBeGreaterThan(40)

    const widths = strip.bands.map(b => b.width)
    console.log(`  spell.png band diameters, top to bottom: ${widths.join(', ')}`)

    /*
     * THE ORDER, which is entity_effect.json's own: effect_7 (fills the tile)
     * at the top of the image, effect_0 (a speck) at the bottom. This is the
     * assertion that fails if anyone "fixes" the backwards animation a second
     * time by reversing build-textures.mjs instead -- two reversals is the
     * original bug, and this test is here to catch the second one.
     */
    expect(widths[0]).toBeGreaterThanOrEqual(7)
    expect(widths[FRAMES - 1]).toBeLessThanOrEqual(3)

    /*
     * Across TWO bands, not one, and the measurement is why. Vanilla's
     * diameters come out 8, 7, 8, 7, 6, 5, 4, 3 -- effect_5 is drawn a pixel
     * wider than effect_6, so a neighbour-monotonic assertion fails on the
     * real art. CE's procedural strip is 8, 8, 7, 6, 5, 4, 3, 2 and has the
     * same flat step. Two bands apart, both are strictly shrinking, and a
     * strip written in reverse fails on the very first comparison.
     */
    for (let f = 2; f < FRAMES; f++) {
      expect(widths[f], `band ${f} is wider than band ${f - 2}: ${widths.join(', ')}`)
        .toBeLessThanOrEqual(widths[f - 2])
    }
    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
    expect(mean(widths.slice(0, 4))).toBeGreaterThan(mean(widths.slice(4)) + 1)
  })
})

/* ------------------------------------------------------------------ *
 * 2. THE SAMPLER
 * ------------------------------------------------------------------ */

const give = (page, key, seconds) =>
  page.evaluate(([k, s]) => window.game.effects.give(window.noa.playerEntity, k, s), [key, seconds])

const clear = (page) => page.evaluate(() => window.game.effects.clear(window.noa.playerEntity))

/*
 * A mote outlives the effect that spawned it by up to two seconds and the pool
 * is shared, so clearing is not draining -- 93-effect-art.spec.js learned that
 * the expensive way and the note there explains it in full.
 */
async function drainMotes(page) {
  await clear(page)
  await page.waitForFunction(() => window.game.effectSwirl.live === 0,
    null, { timeout: 10_000, polling: 50 })
}

test.describe('the row a mote samples', () => {
  test.beforeEach(async ({ page }) => {
    await teleport(page, ...SPAWN)
    await settleOnGround(page)
    await drainMotes(page)
  })
  test.afterEach(async ({ page }) => { await clear(page) })

  test('walks DOWN the image as the mote ages, and is the frame the JS picked',
    async ({ page }) => {
      const widths = (await bandExtents(page)).bands.map(b => b.width)

      await give(page, 'speed', 120)
      await waitTicks(page, 30)

      /*
       * Sampled over half a second rather than read once. The steady state on
       * one body is about four motes -- a single snapshot of four coin flips
       * comes up all-one-frame often enough to matter, which is a flake
       * 93-effect-art.spec.js hit twice.
       */
      const motes = []
      for (let i = 0; i < 10; i++) {
        motes.push(...await page.evaluate(() => window.game.effectSwirl.state()))
        await waitTicks(page, 3)
      }
      expect(motes.length, 'no motes at all -- nothing below is a measurement')
        .toBeGreaterThan(10)

      /*
       * THE ASSERTION 93-effect-art COULD NOT MAKE. `frame` is the age index
       * particles.js chose; `row` is the band of the PNG its V actually lands
       * on, counted from the top of the image and derived through the same
       * invertY flip the sampler applies. They are computed from different
       * numbers on purpose. For the strip's whole life they were mirrors of
       * each other and every spec in the repo only ever looked at the first.
       */
      for (const m of motes) {
        expect(m.row, `frame ${m.frame} is sampling image row ${m.row}`).toBe(m.frame)
        expect(m.row).toBeGreaterThanOrEqual(0)
        expect(m.row).toBeLessThan(FRAMES)
      }

      /*
       * And the rows, turned back into the ring diameters measured off the
       * file above: a young mote must be sampling a WIDER ring than an old
       * one. This is the sentence "a mote collapses" written as a number, and
       * it is true of the image rather than of an index.
       */
      /*
       * THIRDS of the sample, not two fixed age cutoffs. The cutoffs were the
       * first version and they flake: four motes live on a body at a time,
       * their lives are rolled from 0.4 to 2 seconds, and a run where none of
       * the thirty sampled happened to be past 80% of its life fails with "no
       * old motes" while saying nothing about the strip. Sorting cannot come
       * up empty once the count above has passed.
       */
      const byAge = [...motes].sort((a, b) => a.age / a.life - b.age / b.life)
      const cut = Math.floor(byAge.length / 3)
      const young = byAge.slice(0, cut)
      const old = byAge.slice(-cut)
      const mean = (ms) => ms.reduce((n, m) => n + widths[m.row], 0) / ms.length
      console.log(`  ring diameter sampled: young ${mean(young).toFixed(2)} px, ` +
        `old ${mean(old).toFixed(2)} px`)
      expect(mean(young), 'motes EXPAND with age -- the strip is running backwards')
        .toBeGreaterThan(mean(old) + 1)
    })
})

/* ------------------------------------------------------------------ *
 * 3. THE SCREEN
 *
 * One mote, deliberately enormous, sat ten blocks in front of the camera and
 * photographed once per sprite frame. Everything above this line is
 * JavaScript, and five bugs in this repo had every JavaScript number right and
 * the screen unchanged.
 *
 * ONE mote, not the swirl and not a splash. A hundred overlapping quads give a
 * union whose area says more about how far they have scattered than about what
 * sprite they are showing; a single stationary quad's bounding box IS the ring
 * diameter, in pixels, with nothing to normalise away.
 * ------------------------------------------------------------------ */

/*
 * MAGENTA, which is not a colour this world contains. The swirl's own hues
 * would do at spawn and would not in front of a lava lake or a nether sky;
 * emitting the mote directly means its tint is ours to choose, so it is chosen
 * to be impossible.
 */
const MOTE_RGB = [1, 0, 1]

/* The bounding box of the magenta pixels, in viewport pixels. */
async function moteExtent(page) {
  const buf = await page.screenshot()
  return page.evaluate((url) => new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = img.width; c.height = img.height
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const d = ctx.getImageData(0, 0, c.width, c.height).data
      let minX = 1e9, maxX = -1, n = 0
      for (let i = 0; i < d.length; i += 4) {
        if (!(d[i] > 140 && d[i + 2] > 140 && d[i + 1] < 110)) continue
        const x = (i / 4) % c.width
        n++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
      }
      resolve({ width: maxX < 0 ? 0 : maxX - minX + 1, lit: n })
    }
    img.src = url
  }), `data:image/png;base64,${buf.toString('base64')}`)
}

/*
 * One mote, parked, with its AGE dialled to the middle of frame `f` -- and the
 * dialling is the point rather than a shortcut.
 *
 * The first version of this test let a single mote live and photographed it
 * ten times as it went. That measures the right thing and cannot hold still
 * long enough to do it: a screenshot under swiftshader costs a few hundred
 * real milliseconds, the game keeps ticking through every one of them, and a
 * mote that lives two seconds is dead by the fifth frame. Stretching the life
 * to cover ten screenshots stretches the DRIFT with it -- a spell mote's
 * gravity is negative and drag gives it a terminal three blocks a second, so a
 * six-second mote is eighteen blocks above the frame.
 *
 * `age` is the only input setSpriteFromAge reads, so setting it and letting
 * the renderer run is the same measurement with the clock taken out. Test 2
 * above is the one that proves age advances on its own; this one proves what
 * the GPU does with the row that age selects.
 */
async function ringWidthAtFrame(page, f) {
  const LIFE = 20
  const emitted = await page.evaluate(([rgb, life, frame, frames]) => {
    const cam = window.noa.camera
    const at = cam.getTargetPosition()
    const dir = cam.getDirection()
    /*
     * TEN BLOCKS OUT AND THREE BLOCKS WIDE, rather than one block wide at
     * three blocks out, which subtends the same angle. The mote still rises
     * while the screenshot is being taken, and ten blocks out that is a few
     * pixels instead of a few hundred.
     */
    const p = window.game.particles.emitTex('particle/spell',
      { frames: 8, pool: 512 },
      at[0] + dir[0] * 10, at[1] + dir[1] * 10, at[2] + dir[2] * 10,
      0, 0, 0, life, 3.0)
    if (!p) return false
    p.r = rgb[0]; p.g = rgb[1]; p.b = rgb[2]
    // The MIDDLE of the frame's slice, so a rounding error at either edge
    // cannot slide the reading into a neighbouring band.
    p.age = (frame + 0.5) / frames * life
    window.__mote = p
    return true
  }, [MOTE_RGB, LIFE, f, FRAMES])
  if (!emitted) return null

  /*
   * The pool holding the mote is not the same thing as the screen showing it.
   * particles.js writes its buffers on beforeRender, and WebKit's screenshot
   * is happy to hand back the frame BEFORE that -- which read 154, 0, 0, 0...
   * on the first run here: every measurement was one emit stale, so frame 1
   * was photographing the empty screen left by frame 0's cleanup. Frames
   * first, then measure, which is the same rule helpers/world.js states for
   * the camera.
   */
  await page.waitForFunction(() => window.game.effectSwirl.live === 1,
    null, { timeout: 5_000, polling: 20 })
  await waitFrames(page, 2)
  const { width } = await moteExtent(page)

  // Retire it by hand rather than waiting out a 20 second life: the pool's
  // own death check is `age >= life`, so this is the same door, opened early.
  await page.evaluate(() => { window.__mote.age = 1e6 })
  await page.waitForFunction(() => window.game.effectSwirl.live === 0,
    null, { timeout: 5_000, polling: 20 })
  await waitFrames(page, 2)
  return width
}

test.describe('a mote on the screen', () => {
  test('gets SMALLER as it ages, one frame at a time', async ({ page }) => {
    await teleport(page, ...SPAWN)
    await settleOnGround(page)
    await drainMotes(page)
    // Slightly up, so the mote is against sky rather than buried in a hill --
    // it does not depth-write but it is still depth-TESTED, and a mote inside
    // a mountain is a zero every sample.
    await aim(page, { pitch: -0.25 })

    const widths = (await bandExtents(page)).bands.map(b => b.width)

    /*
     * WARM THE SYSTEM THROUGH THE REAL PATH FIRST, and this is the subtle one.
     * particles.js caches a pooled system by TEXTURE NAME and keeps whichever
     * spec created it. If this test emitted first, the stub spec above would
     * become the spell system's spec for the rest of the session and every
     * later test in the run would be measuring a swirl with this file's
     * physics. One real effect, drained, guarantees the cache already holds
     * effectSwirl's own SPELL_SPEC and that the stub is ignored.
     */
    await give(page, 'speed', 2)
    await page.waitForFunction(() => window.game.effectSwirl.live > 0,
      null, { timeout: 10_000, polling: 20 })
    await drainMotes(page)

    const onScreen = []
    for (let f = 0; f < FRAMES; f++) {
      const w = await ringWidthAtFrame(page, f)
      expect(w, `the pool refused the mote for frame ${f}`).not.toBeNull()
      onScreen.push(w)
    }
    console.log(`  on-screen ring width per frame: ${onScreen.join(', ')}`)

    // It has to be ON the screen before it can be shrinking on it. This is the
    // assertion the swirl's own spec was missing the day Babylon culled the
    // whole mesh against a bounding box computed from an all-zero buffer.
    expect(Math.min(...onScreen), 'the mote is in the pool and the GPU drew none of it')
      .toBeGreaterThan(10)

    /*
     * THE PICTURE THE OWNER REPORTED. Frame 0 is the widest ring in the strip
     * and frame 7 is a speck, so the first frame drawn must be the biggest
     * thing on screen and the last must be the smallest. Reversed -- which is
     * how this shipped -- every one of these comparisons flips.
     */
    expect(onScreen[0]).toBe(Math.max(...onScreen))
    expect(onScreen[FRAMES - 1]).toBe(Math.min(...onScreen))
    expect(onScreen[0], 'the mote EXPANDS with age -- the strip is backwards')
      .toBeGreaterThan(onScreen[FRAMES - 1] * 1.8)

    /*
     * And the same two-band step the file itself is asserted on above, now in
     * screen pixels instead of texels. NOT strict, and the measurement says
     * why: vanilla's diameters are 8, 7, 8, 7, 6, 5, 4, 3, so frames 0 and 2
     * are the same ring and come back the same 154 pixels. Reversed, this
     * comparison fails at f = 2 and keeps failing.
     */
    for (let f = 2; f < FRAMES; f++) {
      expect(onScreen[f], `frame ${f} draws wider than frame ${f - 2}: ${onScreen.join(', ')}`)
        .toBeLessThanOrEqual(onScreen[f - 2])
    }

    /*
     * THE ROW, NAILED DOWN. Everything above says the mote shrinks; this says
     * it is showing THESE EIGHT ROWS OF THIS FILE, because the screen width
     * and the file's own diameter for the same frame differ by one constant
     * scale -- one texel of the strip is about 19 screen pixels at this
     * distance, for every frame. A strip sampled one row off, or reversed,
     * scatters these ratios immediately.
     *
     * Frames 0-5 only. effect_0 and effect_1 are two- and three-pixel rings
     * drawn FAINT -- the file's alpha is there (bandExtents counts anything
     * over 10) and alpha-blended over sky it lands under the magenta
     * threshold, so frame 7 reads 18 pixels where the scale predicts 58. That
     * is the colour test's floor, not the sampler's, and the end-to-end
     * assertions above already cover those two frames.
     */
    const scales = onScreen.slice(0, 6).map((px, f) => px / widths[f])
    console.log(`  screen pixels per strip texel: ${scales.map(s => s.toFixed(1)).join(', ')}`)
    for (let f = 0; f < scales.length; f++) {
      // A tenth either way. Nearest sampling rounds a quad edge by a pixel or
      // two out of 150, so the real spread is under 1%; a row off by one moves
      // it by a seventh at least.
      expect(scales[f], `frame ${f} is not drawing row ${f}: ${scales.join(', ')}`)
        .toBeGreaterThan(scales[0] * 0.9)
      expect(scales[f], `frame ${f} is not drawing row ${f}: ${scales.join(', ')}`)
        .toBeLessThan(scales[0] * 1.1)
    }

    await drainMotes(page)
  })
})
