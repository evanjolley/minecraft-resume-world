import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { test, expect } from './fixtures.js'
import { grantOp, look, teleport, waitFrames } from './helpers/world.js'

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
 * "these crops differ" and "these crops are identical" are the same
 * measurement run twice with one bit changed. Freeze it and the moving test
 * fails; that is the proof the test is measuring motion and not noise.
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
  const frozen = [await crop(page)]
  for (let i = 0; i < 3; i++) { await step(8 * 50); frozen.push(await crop(page)) }
  for (let i = 1; i < frozen.length; i++) {
    expect(await pixelDiff(frozen[i - 1], frozen[i]),
      `frozen water changed between ${i - 1} and ${i}`).toBe(0)
  }
})

test('lava animates too, from the same one uniform', async ({ page, terrain }) => {
  await fluidRoom(page, terrain, 'lava')
  await look(page, { heading: 0, pitch: 0 })
  await waitFrames(page, 20)

  const shots = []
  for (let i = 0; i < 3; i++) {
    shots.push(await crop(page))
    await page.evaluate(() => window.game.terrainAnim.advance(6 * 50))
    await waitFrames(page, 2)
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
