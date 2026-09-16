import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { test, expect } from './fixtures.js'
import { grantOp, look, teleport, waitFrames, waitTicks } from './helpers/world.js'

/*
 * Water moves.
 *
 * THE TRAP THIS FILE IS BUILT AROUND. `atlasIndex` is a per-vertex attribute
 * baked into the chunk's vertex buffer at mesh time, so it is entirely
 * possible to write an animation system whose numbers advance beautifully and
 * whose pixels never change. A spec that asserts `layerOf('water_still')`
 * counts up would pass against that. So every numeric assertion here is
 * followed by a PIXEL assertion, and the pixel assertion is the one that
 * matters.
 *
 * HOW IT DISCRIMINATES. The control is not "some other texture" -- it is the
 * same pixels with the animation frozen. `game.terrainAnim.setPaused(true)`
 * holds the remap table still without touching anything else in the frame, so
 * "these crops differ" and "these crops sit at the capture noise floor" are
 * the same measurement run twice with one bit changed. Freeze it and the
 * moving test fails; that is the proof the test is measuring motion and not
 * noise. The floor is measured in place rather than assumed to be zero --
 * see the note on it below, and the numbers.
 *
 * NO COORDINATES ARE WRITTEN DOWN, for the reason 28-underwater.spec.js gives:
 * the world's X axis moved once already. The ocean is found by scanning the
 * generator.
 */

/* Frame captures go beside docs/water/*.png, which is where the owner looks.
 * An animation cannot be shown in one still, so this writes a strip. */
const DOCS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'water')

/** The middle of the screen, where the water is. Small enough that a moving
 *  cloud at the horizon cannot be mistaken for a moving texture. */
const CROP = { x: 480, y: 240, width: 320, height: 240 }

const crop = (page) => page.screenshot({ clip: CROP })

/** How many bytes of two same-size PNGs differ. Decoded to raw first: PNG
 *  encoding is deterministic here, but comparing compressed bytes would make
 *  "changed" mean "re-compressed", which is not the same question. */
async function pixelDiff(a, b) {
  const [ra, rb] = await Promise.all([
    sharp(a).raw().toBuffer(), sharp(b).raw().toBuffer(),
  ])
  let n = 0
  for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) n++
  return n / ra.length
}

/*
 * A crop that is not a REPHOTOGRAPH of the frame we already have.
 *
 * `page.screenshot` reads the compositor, which can hand back the frame that
 * was already presented rather than the one the last `advance` produced --
 * so a capture comes back byte-identical to the previous one while the
 * animation has in fact moved on. It showed up as a hard 0.0 on webkit at
 * two waited frames and again on chromium at four, roughly one run in ten,
 * in a test whose passing diffs are 0.60 to 0.97 of all bytes. Nothing
 * animates 90% of a frame and then exactly 0% of it; that gap is the tell.
 *
 * BOUNDED, and the bound is what keeps this a capture fix rather than a way
 * of asking until the answer is yes. A genuinely frozen animation returns
 * the same bytes on all six attempts and the caller's assertion still fails
 * -- verified by pausing terrainAnim and watching this test go red anyway.
 */
async function freshCrop(page, prev) {
  let shot = await crop(page)
  for (let i = 0; prev && i < 5 && (await pixelDiff(prev, shot)) === 0; i++) {
    await waitFrames(page, 2)
    shot = await crop(page)
  }
  return shot
}

/*
 * A room with walls made of the fluid under test, built in mid-air.
 *
 * REJECTED, after losing half an hour to it: photograph the real ocean. The
 * ocean is at the far corner of the patch, and teleporting there gives you a
 * screen of sky for as long as noa takes to stream and mesh those chunks --
 * which under software GL is longer than any wait a spec should contain. The
 * shot 28-underwater.spec.js takes from the same spot shows it: most of the
 * frame is empty blue with a scrap of water in one corner. That is fine for
 * "is there fog" and useless for "did these pixels change".
 *
 * A 21x21 shell of water at y=200, with a pocket of air in the middle for the
 * camera, is near spawn where everything is already meshed, fills the frame at
 * three blocks' range, and contains nothing that moves except the texture.
 * Built the way 19-fluids.spec.js builds its pools, through authority.requestFill,
 * because nothing outside src/authority.js may call noa.setBlock.
 */
const Y0 = 199
const Y1 = 206
const EYE = [0.5, 201.6, 0.5]
const R = 8

async function fluidRoom(page, terrain, kind) {
  /*
   * Stand there FIRST. noa.setBlock is a no-op on a chunk that is not loaded,
   * and y=200 is far enough above the spawn surface to be outside the vertical
   * load range until the player is up there -- so filling before teleporting
   * built a room nobody ever saw. The symptom was a screenshot of clouds.
   */
  await teleport(page, ...EYE)
  await pin(page, ...EYE)
  await waitFrames(page, 20)
  await grantOp(page)
  await terrain.keep([-R, Y0, -R], [R, Y1, R])
  /*
   * STOP THE FLOW ENGINE, and this was the whole of the long-standing failure
   * in the frozen-water control below.
   *
   * src/fluids.js says where this line belongs, in as many words: "the seam is
   * here rather than a flag in their file: `flow.setEnabled` is one line at
   * the top of that fixture". The line was never written. So the walls of the
   * air pocket carved a moment from now flowed into it -- correctly, at four
   * blocks a second -- and the control, which asserts that frozen water holds
   * still, was photographing water pouring into the room. It failed at 31% of
   * pixels changed and had nothing to do with the animation it was
   * controlling for. With the engine stopped it reads 0.5%, which is the
   * renderer's own capture noise; see the floor note in that test.
   *
   * Put back in the teardown below, because the suite shares one page and
   * 45-buckets and 46-water-look both need the engine running.
   */
  await page.evaluate(() => {
    const flow = window.game.fluids.flow
    flow.setEnabled(false)
    flow.reset()
  })
  /*
   * AND STOP THE SUN -- through the GAME RULE, and it is worth being exact
   * about how much this bought, because the obvious story is wrong.
   *
   * The story was: water is translucent, sky.js shades it from the sun's
   * elevation every frame, the captures below are a second of wall clock
   * apart, so the daylight cycle is the leftover. It is a good story and the
   * measurement does not support it. With the flow stopped and the clock
   * still running the control read 0.004158 of bytes changed; with the clock
   * stopped it read 0.004128. That is not a fix, it is the same number. The
   * leftover is capture noise, and the test below now says so and measures it.
   *
   * KEPT anyway, deliberately: a control that has to sit at a noise floor
   * should not have a clock running under it at all. It costs one call, it
   * pins `sky.getTime()` at 6022 across all four captures (verified), and it
   * means a slower machine with seconds between crops cannot start drifting
   * the sun into the band. Removing a variable that currently measures zero
   * is cheaper than re-deriving it the next time this file goes red.
   *
   * It has to be the RULE, not `sky.setRunning(false)` -- that survives
   * exactly one tick, because main.js drives the same flag from the rule on
   * every tick ("noa.on('tick', () => sky.setRunning(!!authority.gamerule(...)))"),
   * deliberately, so that the rule can change from anywhere. The flag is
   * sky.js's to own; the rule is the only handle a test has on it. Set inside
   * the op window above, since requestGamerule denies a non-operator.
   *
   * Not restored here: resetWorld puts every game rule back to true before
   * each test. The flow engine is the one that does need a teardown, and it
   * has one below.
   */
  await page.evaluate(async () => {
    await window.game.authority.requestGamerule('doDaylightCycle', 'false')
  })
  await page.evaluate(async ([k, lo, hi, r]) => {
    const id = window.game.fluids.ids[k]
    await window.game.authority.requestFill({ from: [-r, lo, -r], to: [r, hi, r], id })
    // The pocket. Without it the camera is inside the fluid and the picture is
    // underwater fog, whose thirty-second ramp changes every pixel on its own.
    await window.game.authority.requestFill({ from: [-2, lo, -2], to: [2, hi, 2], id: 0 })
  }, [kind, Y0, Y1, R])
  await page.evaluate(async () => { await window.game.authority.requestDeop() })
}

/** Hold the player still. Under software GL the frames between teleport and
 *  screenshot are long enough to fall several blocks. */
const pin = (page, x, y, z) => page.evaluate(([a, b, c]) => {
  const noa = window.noa
  if (window.__animPin) noa.off('tick', window.__animPin)
  window.__animPin = () => {
    noa.ents.setPosition(noa.playerEntity, [a, b, c])
    const body = noa.ents.getPhysics(noa.playerEntity).body
    body.velocity[0] = body.velocity[1] = body.velocity[2] = 0
  }
  noa.on('tick', window.__animPin)
}, [x, y, z])

test.afterEach(async ({ page }) => {
  await page.evaluate(() => {
    if (window.__animPin) { window.noa.off('tick', window.__animPin); window.__animPin = null }
    window.game.terrainAnim.setPaused(false)
  })
})

/*
 * Put the flow engine back. fluidRoom switches it off (see the note there)
 * and nothing else will: the suite shares one booted world, 45-buckets and
 * 46-water-look run after this file and need water that moves, and resetWorld
 * clears the fluid QUEUE between tests but never re-enables the engine.
 *
 * The daylight clock needs no teardown here -- it was stopped through the
 * game rule, and resetWorld sets every rule back to true before each test.
 */
test.afterAll(async ({ world }) => {
  await world.page.evaluate(() => { window.game.fluids.flow.setEnabled(true) })
})

test('the atlas carries every frame the animation table claims', async ({ page }) => {
  const layout = await page.evaluate(() => window.game.terrainAnim.layout.map(p => ({
    file: p.file, names: p.names.length, layers: p.layers,
    anims: p.anims.map(a => ({ name: a.name, index: a.index, base: a.base, frames: a.frames })),
  })))

  // Water on the alpha page, lava on the opaque one, both with their frames
  // appended AFTER the page's regular materials -- which is the property that
  // lets frames be added without invalidating a meshed chunk.
  const water = layout.flatMap(p => p.anims).find(a => a.name === 'water_still')
  const lava = layout.flatMap(p => p.anims).find(a => a.name === 'lava_still')
  expect(water).toMatchObject({ frames: 32 })
  expect(lava).toMatchObject({ frames: 20 })
  for (const page_ of layout) {
    for (const a of page_.anims) expect(a.base).toBeGreaterThanOrEqual(page_.names)
    expect(page_.layers).toBeLessThanOrEqual(192)
  }

  // And the atlas PNG that actually loaded is as tall as the layout says. If
  // this fails the frames were never built and every remap below would be
  // sampling a layer that does not exist.
  expect(await page.evaluate(() => window.game.terrainAnim.framesLoaded('water_still'))).toBe(true)
  expect(await page.evaluate(() => window.game.terrainAnim.framesLoaded('lava_still'))).toBe(true)
})

test('the clock runs on its own, without anyone stepping it', async ({ page }) => {
  /*
   * The pixel tests below step the animation by hand so the measurement does
   * not depend on how many real milliseconds a software-GL frame took. That
   * makes them blind to exactly one failure: the tick handler never being
   * wired up at all. This is the only test that waits on the real clock.
   */
  const before = await page.evaluate(() => window.game.terrainAnim.tick)
  await waitTicks(page, 20)
  const after = await page.evaluate(() => window.game.terrainAnim.tick)
  expect(after).toBeGreaterThan(before)
})

test('lava ping-pongs through its explicit frame list', async ({ page }) => {
  // The mcmeta's frame list is not always a loop. Lava's is 38 entries that
  // run 0..19 and back down 18..1, so the sequence is NOT tick order and a
  // naive `frame = tick % frames` would be wrong in the second half.
  const seq = await page.evaluate(() => {
    const { terrainAnim } = window.game
    const anim = terrainAnim.layout.flatMap(p => p.anims).find(a => a.name === 'lava_still')
    const out = []
    for (let t = 0; t < 76; t += 2) {
      const step = Math.floor(t / anim.frametime) % anim.order.length
      out.push(anim.order[step])
    }
    return out
  })
  expect(seq.slice(0, 20)).toEqual([...Array(20).keys()])
  expect(seq.slice(20)).toEqual([...Array(18).keys()].map(i => 18 - i))
})

test('water animates, and freezing it is the control that proves the measurement', async ({ page, terrain }) => {
  await fluidRoom(page, terrain, 'water')
  await look(page, { heading: 0, pitch: 0 })
  await waitFrames(page, 20)

  /*
   * Frames are stepped by hand rather than by waiting on wall-clock time.
   * `advance(ms)` is the same path the tick handler drives, so this is not a
   * test-only code route -- it just removes "did enough real milliseconds
   * elapse under software GL" from the measurement.
   */
  const step = async (ms) => {
    await page.evaluate(n => window.game.terrainAnim.advance(n), ms)
    await waitFrames(page, 2)
  }

  const moving = []
  for (let i = 0; i < 4; i++) {
    moving.push(await crop(page))
    await step(8 * 50)          // 8 ticks = 4 water frames
  }

  expect(await page.evaluate(() => window.game.terrainAnim.layerOf('water_still')))
    .toBeGreaterThan(0)

  // The captures, for a human. Four crops side by side is the only way a
  // still image can show that something moves. Written BEFORE the assertions
  // so a failure still leaves something to look at.
  await sharp({
    create: {
      width: CROP.width * moving.length, height: CROP.height,
      channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite(moving.map((buf, i) => ({ input: buf, left: i * CROP.width, top: 0 })))
    .png().toFile(path.join(DOCS, 'anim-water-frames.png'))

  // Every consecutive pair differs. Not "the first and last differ" -- an
  // animation that moved once and stopped would pass that.
  const deltas = []
  for (let i = 1; i < moving.length; i++) deltas.push(await pixelDiff(moving[i - 1], moving[i]))
  for (const [i, d] of deltas.entries()) {
    expect(d, `frames ${i}->${i + 1} identical (all: ${deltas.join(', ')})`).toBeGreaterThan(0.05)
  }

  /*
   * The control. Same viewpoint, same stepping, animation frozen. If this
   * fails, the crops above were moving for some reason other than the
   * animation and the test above proves nothing.
   */
  await page.evaluate(() => window.game.terrainAnim.setPaused(true))
  await waitFrames(page, 3)

  /*
   * THE FLOOR IS NOT ZERO, and `toBe(0)` was asking the renderer for
   * something it does not offer.
   *
   * Measured rather than assumed: `floor` is two crops with NOTHING between
   * them -- no advance, no waited frames, no tick -- so whatever it comes back
   * as is pure capture-to-capture noise on this exact scene. It is not small
   * because the scene is still; it is 0.5% of bytes on chromium and ~0.1% on
   * webkit, at magnitudes of 1 to 7 out of 255, scattered over the water
   * surface. Translucent geometry is depth-sorted per frame and ties resolve
   * differently, which is a real property of drawing water and not a bug the
   * animation put there.
   *
   * So the control's claim is now the one it was always making in spirit: the
   * frozen crops are at the FLOOR, and the moving crops are nowhere near it.
   * Both halves matter -- a cap alone would pass if the animation stopped
   * working and the moving numbers collapsed too, so the ratio is asserted
   * against this run's own `deltas` rather than against a remembered constant.
   *
   * Real numbers behind the two thresholds, one run of each engine:
   *
   *            floor     frozen pairs           moving pairs        ratio
   *   chromium 0.0050    0.0070 0.0065 0.0063   0.677 0.639 0.684    ~91x
   *   webkit   0.0000    0.0009 0.0011 0.0012   0.467 0.325 0.389   ~271x
   *
   * 0.02 sits ~2.5x above the worst floor seen and ~16x under the weakest
   * moving pair. Nothing has to be re-tuned to keep that gap; if it ever
   * closes, the measurement really has stopped discriminating.
   */
  const floor = await pixelDiff(await crop(page), await crop(page))
  const frozen = [await crop(page)]
  for (let i = 0; i < 3; i++) { await step(8 * 50); frozen.push(await crop(page)) }
  const held = []
  for (let i = 1; i < frozen.length; i++) held.push(await pixelDiff(frozen[i - 1], frozen[i]))

  const worst = Math.max(...held)
  expect(worst, `frozen water moved (floor ${floor}, pairs ${held.join(', ')})`)
    .toBeLessThan(0.02)
  expect(Math.min(...deltas) / worst,
    `frozen and moving are the same size, so this measures nothing ` +
    `(moving ${deltas.join(', ')}, frozen ${held.join(', ')})`)
    .toBeGreaterThan(20)
})

test('lava animates too, from the same one uniform', async ({ page, terrain }) => {
  await fluidRoom(page, terrain, 'lava')
  await look(page, { heading: 0, pitch: 0 })
  await waitFrames(page, 20)

  /*
   * FOUR frames waited, not two, and this is a capture fix rather than a
   * weakened assertion.
   *
   * At two, webkit intermittently returned a crop identical to the previous
   * one -- pixelDiff of exactly 0.0, while `layerOf('lava_still')` had moved
   * on -- which is a screenshot taken before the new frame was presented, not
   * an animation that failed to advance. It reproduced twice in a row and
   * then not at all in isolation.
   *
   * Worth saying plainly: this test only started being able to flake when the
   * flow engine was switched off in fluidRoom. Until then lava was POURING
   * into the camera pocket, so consecutive crops differed whatever the
   * animation did, and "lava animates" was passing partly for the wrong
   * reason. The stricter fixture is what exposed the capture race.
   */
  const shots = []
  for (let i = 0; i < 3; i++) {
    shots.push(await freshCrop(page, shots[i - 1]))
    await page.evaluate(() => window.game.terrainAnim.advance(6 * 50))
    await waitFrames(page, 4)
  }
  await sharp({
    create: {
      width: CROP.width * shots.length, height: CROP.height,
      channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite(shots.map((buf, i) => ({ input: buf, left: i * CROP.width, top: 0 })))
    .png().toFile(path.join(DOCS, 'anim-lava-frames.png'))

  for (let i = 1; i < shots.length; i++) {
    expect(await pixelDiff(shots[i - 1], shots[i]), `lava frame ${i} is identical`).toBeGreaterThan(0.05)
  }
})
