import { test, expect } from './fixtures.js'
import {
  waitTicks, teleport, look, useGamemode, doubleTapFly, setBlock, getBlock,
  ID, HEADING, isFlying,
} from './helpers/world.js'
import { shot, shotRegion } from './helpers/shots.js'

/*
 * THE TORCH FLAME.
 *
 * Reported as "add torch flame animation to match vanilla, not currently
 * there". The first job was deciding what "animation" meant, because this
 * repo has an animation pipeline (terrainAnimation.js, layer remaps driven off
 * a .mcmeta) and if the torch belonged in it the whole job was a table entry.
 *
 * IT DOES NOT. `assets/minecraft/textures/block/torch.png` in 1.21.8 is a
 * static 16x16 and the jar carries no `torch.png.mcmeta` -- 50 block textures
 * have one, torch is not among them. Vanilla's motion is `TorchBlock`
 * `.animateTick` spawning `ParticleTypes.FLAME`, which is a particle, which is
 * particles.js. That is the first thing this file asserts, and it asserts it
 * from the running game rather than from a comment: the torch's material is
 * not registered with the animation driver, and the flame IS live particles.
 *
 * WHAT A SCREENSHOT CANNOT SAY. Every other question here is "does it move",
 * and one photograph of a particle effect proves nothing -- a frozen sprite
 * and a flickering one are the same picture. So the moving tests compare
 * FRAMES against each other, and the pictures in test/screenshots/ are
 * evidence for a human, not the assertion.
 */

/** Mid-air, the same reasoning 66-torch gives for its room: nothing to break. */
const PY = 200
const CX = 40
const CZ = 20
const MIDNIGHT = 18000

/*
 * Duplicated from blocks.js rather than imported, which is the rule
 * 66-torch.spec.js sets out: if someone renumbers these, this file should fail
 * loudly rather than quietly follow along.
 */
const TORCH = 655
const WALL_TORCH = { north: 656, south: 657, east: 658, west: 659 }

const flames = (page) => page.evaluate(() => window.game.particles.flames)
/*
 * BLOCK particles only -- total live minus the flames.
 *
 * `particles.live` counts every system, and the burst test below reads it
 * before and after a burst to assert the difference is 24. Once torches were
 * burning nearby, a flame expiring between the two reads made that 23. The
 * burst test is about block chips, so it should count block chips.
 */
const blockParticles = (page) => page.evaluate(
  () => window.game.particles.live - window.game.particles.flames)

/**
 * A stone floor at PY with a stone wall along its -x edge, cleared above.
 *
 * Built the way 66-torch builds its room and for the same reason it gives at
 * length: fly to the spot and wait for the chunk to EXIST before writing into
 * it, because `noa.setBlock` into an unloaded chunk is a silent no-op and the
 * browser that lost the race is the one that fails.
 */
async function room(page, terrain, r = 8) {
  /*
   * REGISTER THE BOX BEFORE WRITING INTO IT. The `terrain` fixture restores
   * whatever it was handed when the test ends, including when an assertion
   * throws -- and without it this file leaks. It did: a hundred torches left
   * standing at y=201 by the performance test were still there when
   * 23-debug-screen went looking for a block in darkness, which read light 12
   * and failed on a change that had nothing to do with it. Specs here share
   * one booted world, so cleaning up is not politeness.
   *
   * The box runs out to x+62 because the falloff test builds a landing pad
   * sixty blocks away.
   */
  await terrain.keep([CX - r - 1, PY - 1, CZ - r - 1], [CX + 62, PY + 8, CZ + r + 1])
  await useGamemode(page, 'creative')
  // doubleTapFly TOGGLES. Every spec in this file runs against the same booted
  // world, so calling it unconditionally turns flight OFF for the second test
  // onward and drops the player out of a room built at y=200.
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
    for (let dz = -rr; dz <= rr; dz++) {
      for (let dy = 1; dy <= 3; dy++) window.noa.setBlock(stone, cx - rr, y + dy, cz + dz)
    }
  }, [CX, CZ, PY, r, ID.stone, ID.air])
  await waitTicks(page, 4)
}

/**
 * Every torch inside the room, gone.
 *
 * The emitter samples a 31-block box around the player, not a cell, so ANY
 * torch left behind by an earlier test in this file counts toward the numbers
 * below -- and these specs all share one booted world. Measuring a per-torch
 * rate against a room that might hold two torches is how the position test
 * first reported a flame two blocks outside the block it was standing on.
 */
async function clearTorches(page, r = 8) {
  await page.evaluate(([cx, cz, y, rr, air, torch]) => {
    for (let dx = -rr; dx <= rr; dx++) {
      for (let dz = -rr; dz <= rr; dz++) {
        for (let dy = 0; dy <= 7; dy++) {
          const id = window.noa.getBlock(cx + dx, y + dy, cz + dz)
          if (id >= torch && id <= torch + 4) window.noa.setBlock(air, cx + dx, y + dy, cz + dz)
        }
      }
    }
  }, [CX, CZ, PY, r, ID.air, TORCH])
  await drained(page)
}

/**
 * Wait until the last live flame has died.
 *
 * WAITED FOR, never slept through, and the difference is not pedantry. A flame
 * lives up to 44 ticks, and particles.js clamps its own dt to 0.05s so a stall
 * cannot teleport anything -- so under software GL, where a frame can take
 * 150ms, the last flame of a batch can still be on screen five seconds after
 * its torch was removed. A fixed `waitTicks` picked for a fast machine is a
 * test that fails on a slow one, which is the flake this file is built to
 * avoid.
 */
const drained = (page) => page.waitForFunction(
  () => window.game.particles.flames === 0, null, { timeout: 20_000 })

/** Night, so a light-emitting object is seen doing the thing it is for. */
const night = (page) => page.evaluate((t) => window.game.sky.setTime(t), MIDNIGHT)

/**
 * Peak live flame count over `ms`, sampled every frame.
 *
 * PEAK rather than mean, and rather than a single reading, because the spawn
 * is a Poisson process: a single sample of a three-per-second emitter is zero
 * about five percent of the time, and a test that fails one run in twenty is
 * worse than no test. Peak over a second and a half is stable.
 */
const peakFlames = (page, ms = 1500) => page.evaluate((duration) => new Promise((resolve) => {
  let peak = 0, total = 0, n = 0
  const t0 = performance.now()
  const step = () => {
    const f = window.game.particles.flames
    if (f > peak) peak = f
    total += f; n++
    if (performance.now() - t0 < duration) requestAnimationFrame(step)
    else resolve({ peak, mean: +(total / n).toFixed(2), samples: n })
  }
  requestAnimationFrame(step)
}), ms)

/* ------------------------------------------------------------------ *
 * 1. It is particles, not an animated texture
 * ------------------------------------------------------------------ */

test('the torch flame is particles, and the torch texture is not animated', async ({ page, terrain }) => {
  await room(page, terrain)
  await night(page)

  /*
   * terrainAnimation.js drives animated block textures by remapping an atlas
   * layer per frame, keyed on MATERIAL NAME. If the torch's flame were an
   * animated texture -- the cheap outcome, and the one worth ruling out before
   * writing a particle system -- `torch` would be one of those names.
   */
  const layers = await page.evaluate(() => ({
    // A name that IS animated, so the -1 below is a real answer and not the
    // answer this probe gives for every string. Asserting torch is not
    // animated without this line would pass just as happily against a driver
    // that had failed to install at all.
    lava: window.game.terrainAnim.layerOf('lava_still'),
    torch: window.game.terrainAnim.layerOf('torch'),
  }))
  expect(layers.lava).toBeGreaterThanOrEqual(0)
  expect(layers.torch).toBe(-1)

  await setBlock(page, TORCH, CX, PY + 1, CZ)
  await teleport(page, CX + 2.5, PY + 1, CZ + 0.5)
  await waitTicks(page, 10)

  const { peak, mean, samples } = await peakFlames(page, 2500)
  /*
   * The sample is non-empty, asserted before the peak is read out of it. The
   * bar is low on purpose: this suite runs under a CPU rasteriser at about
   * five frames a second, so a 2.5s window is eight readings, not a hundred.
   * It was >10 and it failed on exactly that.
   */
  expect(samples).toBeGreaterThan(3)
  // The flame exists at all. Everything below is about its shape.
  expect(peak).toBeGreaterThan(0)
  console.log(`  one torch at 2 blocks: peak ${peak} live flames, mean ${mean}`)
})

/* ------------------------------------------------------------------ *
 * 2. The rate, against vanilla's own arithmetic
 * ------------------------------------------------------------------ */

test('one torch burns at roughly vanilla\'s rate, and stops existing at distance', async ({ page, terrain }) => {
  await room(page, terrain)
  await night(page)
  await setBlock(page, TORCH, CX, PY + 1, CZ)
  await teleport(page, CX + 0.5, PY + 1, CZ + 0.5)
  await waitTicks(page, 20)

  /*
   * VANILLA'S NUMBER. ClientLevel.animateTick samples 667 blocks a tick at
   * radius 16 and 667 at radius 32, each axis offset being
   * `nextInt(l) - nextInt(l)`. A torch in the player's own block is therefore
   * picked 667 * (1/16^3 + 1/32^3) = 0.183 times a tick, 3.7 times a second,
   * and a flame lives about a second on average -- so about four live flames.
   *
   * The band is 1..30 rather than 3..5, and the width is not slack -- two
   * separate things widen it.
   *
   * The spawn is a Poisson process with a lifetime spread of 12 to 44 ticks,
   * which alone is worth a factor of two either way. And the per-frame loop in
   * particles.js clamps dt to 0.05s so that a tab-switch stall cannot teleport
   * everything -- so under software GL, where a frame can take 150ms, every
   * particle AGES at a third of real time and lives three times as long on the
   * clock. Live count is rate times lifetime, so a slow renderer inflates it.
   * Measured here: about 4 on a fast frame, about 12 on a slow one.
   *
   * What the band still catches is the failure that matters, which is a
   * metronome. An emitter firing once per frame would hold sixty; one firing
   * once a second would sit at one and fail the floor over a 2.5s peak.
   */
  const { peak, mean } = await peakFlames(page, 2500)
  console.log(`  one torch underfoot: peak ${peak}, mean ${mean} (vanilla predicts ~4)`)
  expect(peak).toBeGreaterThanOrEqual(1)
  expect(peak).toBeLessThanOrEqual(30)

  /*
   * And the falloff, which is the other half of "only near the player". The
   * triangular pick distribution is zero past 31 blocks on any axis, so a
   * torch 60 away is not merely rare, it is impossible.
   */
  /*
   * A LANDING PAD, and it is load-bearing. The first version of this just
   * teleported into mid-air 60 blocks away, and the player fell -- for two
   * seconds, toward an island that has torches on it -- so the test measured
   * "are there torches under the world" rather than "does the rate fall off".
   */
  await page.evaluate(([x, y, z, stone]) => {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) window.noa.setBlock(stone, x + dx, y, z + dz)
    }
  }, [CX + 60, PY, CZ, ID.stone])
  await teleport(page, CX + 60.5, PY + 1, CZ + 0.5)
  await drained(page)
  expect(await flames(page)).toBe(0)
})

/* ------------------------------------------------------------------ *
 * 3. It moves. Frames, not a photograph.
 * ------------------------------------------------------------------ */

/**
 * How many pixels of a crop are FLAME-coloured.
 *
 * NOT the mean colour of the crop, which is what this measured first and which
 * passed for the wrong reason: the eight readings came back 33.59, 33.67,
 * 33.71 ... 33.93 -- a monotonic climb, because the sky was still brightening
 * out of midnight. A trend is not a flicker, and a probe that cannot tell them
 * apart would pass just as happily against a flame painted on the torch.
 *
 * A warm-pixel count cannot drift that way. Nothing else in a dark stone room
 * is orange, the count moves with how many flames are alive and how big they
 * are, and a global lighting change lifts every pixel together and so moves
 * the count by nothing.
 */
async function warmPixels(page, clip) {
  const buf = await page.screenshot({ clip })
  return page.evaluate((url) => new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = img.width; c.height = img.height
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const d = ctx.getImageData(0, 0, c.width, c.height).data
      let n = 0
      // Orange: bright red, and clearly more red than blue.
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] > 140 && d[i] - d[i + 2] > 60) n++
      }
      resolve(n)
    }
    img.src = url
  }), `data:image/png;base64,${buf.toString('base64')}`)
}

test('the flame is different from one frame to the next', async ({ page, terrain }) => {
  await room(page, terrain)
  await night(page)
  await clearTorches(page)

  /*
   * The torch goes on ONE block, and the height is arithmetic rather than
   * taste. The player's eye is 1.62 above their feet, so standing at y = 201
   * it is at 202.62; a torch at 202 puts its flame at 202.7, which is level
   * with the eye and therefore in the middle of the picture. A two-block
   * pillar was the first try and it put the flame 17 degrees up -- about 175
   * pixels above centre at this field of view, which is outside the crop, and
   * the test reported no flame at all rather than a flame in the wrong place.
   *
   * Photographing a FLOOR torch from standing height has the opposite
   * problem: it lands among the hotbar, where the held item is also orange,
   * and a warm-pixel count would cheerfully measure that instead.
   */
  await page.evaluate(([cx, cy, cz, stone]) => {
    window.noa.setBlock(stone, cx, cy, cz)
  }, [CX, PY + 1, CZ, ID.stone])
  await setBlock(page, TORCH, CX, PY + 2, CZ)
  await teleport(page, CX + 0.5, PY + 1, CZ + 3.5)
  await look(page, { heading: HEADING.northMinusZ, pitch: 0 })
  await waitTicks(page, 20)

  const clip = { x: 1280 / 2 - 110, y: 720 / 2 - 110, width: 220, height: 220 }

  const frames = []
  for (let i = 0; i < 10; i++) {
    frames.push(await warmPixels(page, clip))
    await waitTicks(page, 2)
  }

  // Non-empty, and actually pointed at a flame, before anything at all is
  // concluded from the variation between the readings.
  expect(frames.length).toBe(10)
  expect(Math.max(...frames), 'no flame in the crop at all').toBeGreaterThan(0)

  const spread = Math.max(...frames) - Math.min(...frames)
  const distinct = new Set(frames).size
  console.log(`  warm pixels across 10 frames: ${frames.join(', ')} -> spread ${spread}, ${distinct} distinct`)
  /*
   * A still photograph of a particle effect proves nothing, so the assertion
   * is about the SEQUENCE. A flame painted on the texture gives ten identical
   * readings. A flame that flickers gives a spread, because particles are
   * being born, shrinking and dying in the gaps between these frames.
   */
  expect(distinct).toBeGreaterThan(2)
  expect(spread).toBeGreaterThan(3)

  // Evidence for a human, which the numbers above cannot be.
  await shotRegion(page, 'torch-flame-close', clip)
  await shot(page, 'torch-flame-dark-room')
})


/* ------------------------------------------------------------------ *
 * 3b. The size and the orientation, measured in pixels
 * ------------------------------------------------------------------ */

/*
 * "Torch animation looks a lil off" -- and the only honest way to answer that
 * is a ruler, because every plausible cause looks the same from an armchair.
 *
 * THE RULER. A lit stone block is exactly one block wide, so photographing one
 * from a fixed vantage converts pixels to blocks with nothing assumed about
 * the projection. (It agrees with the arithmetic to a pixel: 720 / (2 * 1.5 *
 * tan 35deg) = 342.8, measured 342.) Then the torch goes on the same spot and
 * the flame is measured against the post, which is 2 texels of 16 = 0.125
 * blocks and is therefore a second ruler standing inside the picture.
 *
 * WHAT THE NUMBERS HAVE TO BE, from 1.21.8's own source:
 *   SingleQuadParticle: quadSize = 0.1 * (rand * 0.5 + 0.5) * 2, so 0.1..0.2
 *   renderVertex builds corners from (+/-1, +/-1) * quadSize, so quadSize is a
 *     HALF-extent and the quad's EDGE is 0.2..0.4 blocks
 *   FlameParticle does not scale (only SmallFlameProvider does, and a torch
 *     spawns ParticleTypes.FLAME)
 *   particle/flame.png paints 4 of its 8 columns, so the flame you can SEE is
 *     half the quad: 0.1..0.2 blocks, which is 0.8x..1.6x the post
 *
 * This test exists because the first read of the screenshot was "it is far too
 * big, about half a block" and the measurement said 0.13 blocks, a ratio of
 * 1.00 against the post. The size was never wrong. What WAS wrong is below.
 */
const RULER_D = 2.0                    // camera to the torch's own plane
const D_POST = 22.5 - 20.5625          // camera to the post's front face
const PPB_AT = (px1_5, d) => px1_5 * 1.5 / d

/** Read a screenshot back as raw pixels inside the page. */
async function pixels(page, buf) {
  return page.evaluate((url) => new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = img.width; c.height = img.height
      c.getContext('2d').drawImage(img, 0, 0)
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      resolve({ d: Array.from(d), W: c.width, H: c.height })
    }
    img.src = url
  }), `data:image/png;base64,${buf.toString('base64')}`)
}

function analyse(im, kind) {
  const P = (x, y) => { const o = (y * im.W + x) * 4; return [im.d[o], im.d[o+1], im.d[o+2]] }
  const centreRun = (y, test) => {
    const runs = []; let a = -1
    for (let x = 380; x < 900; x++) {
      const m = test(P(x, y))
      if (m && a < 0) a = x
      if ((!m || x === 899) && a >= 0) { runs.push([a, m ? x : x - 1]); a = -1 }
    }
    if (!runs.length) return { w: 0 }
    runs.sort((p, q) => Math.abs((p[0]+p[1])/2 - 640) - Math.abs((q[0]+q[1])/2 - 640))
    return { x0: runs[0][0], x1: runs[0][1], w: runs[0][1] - runs[0][0] + 1 }
  }
  /*
   * The flame ramp INCLUDING its white-hot base. An earlier version of this
   * used `r - b > 60`, which rejects white (255,245,198) at 57 -- so it was
   * blind to exactly the texels that say which way up the sprite is. r >= 230
   * keeps the torch post (160,90,0) out.
   */
  const flame = ([r, g, b]) => r >= 230 && r >= g && g >= b
  const post = ([r, g, b]) => r + g + b > 70 && r >= g && g >= b && r < 230
  const grey = ([r, g, b]) => r + g + b > 150 && Math.abs(r - g) < 18 && Math.abs(g - b) < 18

  if (kind === 'ruler') {
    let best = 0
    for (let y = 300; y < 361; y++) best = Math.max(best, centreRun(y, grey).w)
    return { rulerPx: best }
  }

  let widest = 0, top = -1, bot = -1
  for (let y = 200; y < 368; y++) {
    const r = centreRun(y, flame)
    if (r.w > 0) { if (top < 0) top = y; bot = y; widest = Math.max(widest, r.w) }
  }
  /*
   * The post is measured WELL below the flame -- rows 430..480, against a
   * flame whose base sits around 367. The band used to start at 400 and a
   * deliberately oversized flame reached into it, so the post measured 0.19
   * blocks and the size mutation failed on the RULER instead of on the thing
   * it was breaking. A ruler that moves with the subject is not a ruler.
   */
  let postPx = 0
  for (let y = 430; y < 480; y++) {
    const r = centreRun(y, post)
    if (r.w > 4 && r.w < 90) postPx = Math.max(postPx, r.w)
  }
  // Mean blue in the flame's top third against its bottom third.
  let tB = 0, tN = 0, bB = 0, bN = 0
  if (top >= 0 && bot - top >= 12) {
    const third = (bot - top) / 3
    for (let y = top; y <= bot; y++) for (let x = 560; x < 720; x++) {
      const p = P(x, y)
      if (!flame(p)) continue
      if (y < top + third) { tB += p[2]; tN++ } else if (y > bot - third) { bB += p[2]; bN++ }
    }
  }
  return { flamePx: widest, postPx, top, bot, topBlue: tN ? tB / tN : -1, botBlue: bN ? bB / bN : -1, topN: tN, botN: bN }
}

test('the flame is vanilla\'s size and burns the right way up', async ({ page, terrain }) => {
  test.slow()
  await terrain.keep([CX - 9, PY - 2, CZ - 9], [CX + 9, PY + 8, CZ + 9])
  await useGamemode(page, 'creative')
  if (!await isFlying(page)) await doubleTapFly(page)
  await teleport(page, CX + 0.5, PY + 2, CZ + 0.5)
  await page.waitForFunction(([x, y, z]) => {
    const w = window.noa.world, CS = w._chunkSize
    const c = w._storage.getChunkByIndexes(Math.floor(x/CS), Math.floor(y/CS), Math.floor(z/CS))
    return !!c && !c.isDisposed
  }, [CX, PY, CZ], { timeout: 20_000 })

  /*
   * Empty sky, except a 3x3 pad directly under the camera. The subject has to
   * be the only thing in frame, and the pad has to exist: without it the
   * player falls out of the shot during the settle, which is how the first
   * attempt came back with the camera 3 blocks below where it was told to be.
   */
  await page.evaluate(([cx, cz, y, d, air, stone]) => {
    for (let dx = -8; dx <= 8; dx++) for (let dz = -8; dz <= 8; dz++)
      for (let dy = -2; dy <= 6; dy++) window.noa.setBlock(air, cx + dx, y + dy, cz + dz)
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++)
      window.noa.setBlock(stone, cx + dx, y, cz + dz + d)
  }, [CX, CZ, PY, Math.round(RULER_D), ID.air, ID.stone])
  await waitTicks(page, 4)

  const shoot = async () => {
    await teleport(page, CX + 0.5, PY + 1, CZ + 0.5 + RULER_D)
    await look(page, { heading: HEADING.northMinusZ, pitch: 0 })
    await waitTicks(page, 8)
    return pixels(page, await page.screenshot())
  }

  /*
   * THE RULER, in DAYLIGHT. At midnight an unlit floating block is black on
   * black and measures zero -- which it did, and the first ratio came back as
   * a division by nothing.
   */
  await setBlock(page, ID.stone, CX, PY + 2, CZ)
  await page.evaluate(() => window.game.sky.setTime(6000))
  await waitTicks(page, 8)
  const { rulerPx } = analyse(await shoot(), 'ruler')
  // Non-empty before it is used as the denominator of everything below.
  expect(rulerPx, 'the ruler block was not visible').toBeGreaterThan(100)
  const ppbPost = PPB_AT(rulerPx, D_POST)
  const ppbFlame = PPB_AT(rulerPx, RULER_D)
  console.log(`  ruler: 1 block = ${rulerPx}px at d=1.5 (arithmetic says 342.8)`)

  await page.evaluate(() => window.game.sky.setTime(18000))
  await setBlock(page, ID.air, CX, PY + 2, CZ)
  await setBlock(page, ID.stone, CX, PY + 1, CZ)
  await waitTicks(page, 6)
  await setBlock(page, TORCH, CX, PY + 2, CZ)
  await waitTicks(page, 30)
  expect(await getBlock(page, CX, PY + 2, CZ)).toBe(TORCH)

  const shots = []
  for (let i = 0; i < 6; i++) shots.push(analyse(await shoot(), 'torch'))

  const seen = shots.filter(s => s.flamePx > 0)
  // Non-empty, before any mean is taken of it.
  expect(seen.length, 'no flame in any of the six frames').toBeGreaterThan(3)

  const mean = (f) => seen.reduce((a, s) => a + f(s), 0) / seen.length
  const flamePx = mean(s => s.flamePx)
  const postPx = mean(s => s.postPx)
  console.log(`  post  ${postPx.toFixed(1)}px = ${(postPx / ppbPost).toFixed(3)} blocks (vanilla: 0.125)`)
  console.log(`  flame ${flamePx.toFixed(1)}px = ${(flamePx / ppbFlame).toFixed(3)} blocks painted (vanilla: 0.10-0.20)`)
  console.log(`  flame/post ratio ${(flamePx / postPx).toFixed(2)} (vanilla: 0.80-1.60)`)

  // The post is the in-picture ruler, so it has to measure what it is.
  expect(postPx / ppbPost).toBeGreaterThan(0.10)
  expect(postPx / ppbPost).toBeLessThan(0.16)

  /*
   * THE SIZE. quadSize 0.1..0.2 is a half-extent, so the quad is 0.2..0.4 and
   * the painted half of the sprite is 0.1..0.2 blocks. The ceiling is 0.21
   * rather than 0.20 because several flames overlap and vanilla jitters each
   * birth by +/-0.05, so a CLUSTER is legitimately a little wider than one
   * sprite -- correct builds measure 0.13..0.16 here across runs.
   *
   * The margin is what makes this worth asserting: treating quadSize as the
   * full edge rather than the half-extent -- the obvious way to get this
   * wrong, and the first thing suspected when the flame was called too big --
   * measures 0.24, which is outside by a third.
   */
  expect(flamePx / ppbFlame).toBeGreaterThan(0.06)
  expect(flamePx / ppbFlame).toBeLessThan(0.21)

  /*
   * THE ORIENTATION, which is what was actually broken.
   *
   * vanilla's particle/flame.png is red (255,0,0) at the TOP and white-hot
   * (255,245,198) at the BOTTOM, because a flame is hottest where it meets
   * what is burning. Mean blue over the flame's bottom third must therefore
   * beat its top third. Shipped with invertY false it read top 29.7 / bottom
   * 1.1; corrected it reads top 0.0 / bottom 37.2.
   */
  const topBlue = mean(s => Math.max(0, s.topBlue))
  const botBlue = mean(s => Math.max(0, s.botBlue))
  console.log(`  white-hot end: mean blue top third ${topBlue.toFixed(1)}, bottom third ${botBlue.toFixed(1)}`)
  expect(mean(s => s.topN) + mean(s => s.botN), 'no flame pixels to orient').toBeGreaterThan(50)
  expect(botBlue, 'the flame is burning upside down').toBeGreaterThan(topBlue + 10)

  /*
   * And no gap: vanilla spawns at y+0.7 with a quad 0.2..0.4 tall, so its
   * bottom reaches 0.5..0.6 against a post whose top is at 0.625. They
   * OVERLAP. A flame hovering above its torch would show as a negative here.
   */
  const overlap = mean(s => s.bot) - 330
  console.log(`  flame base overlaps the post top by ${overlap.toFixed(0)}px`)
  expect(overlap).toBeGreaterThan(0)
})

/* ------------------------------------------------------------------ *
 * 4. All five ids, and where a wall torch puts its flame
 * ------------------------------------------------------------------ */

test('all five torch ids burn, and the wall torch burns off-centre', async ({ page, terrain }) => {
  /*
   * Five ids, each of which has to be placed alone, waited for, counted and
   * then measured for position -- and each count has to be sampled over a
   * second or more, because the spawn is random and one reading of it is
   * noise. That is five times four seconds before anything slow happens, and
   * under software GL it goes past the file's 60s default. Marked slow rather
   * than sampled for less time: shortening the windows is what would make
   * this flaky, and a slow honest test beats a fast unreliable one.
   */
  test.slow()
  await room(page, terrain)
  await night(page)

  /*
   * FACINGS, duplicated from blockMeshes.js on purpose, and this is the one
   * table in this file worth duplicating rather than importing: east is -X in
   * this world, the name and the geometry were flipped together, and a spec
   * that imported the table could not catch them being flipped again. A wall
   * torch's flame offset is derived from this vector, so if this copy and the
   * engine's copy ever disagree, the numbers below are what says so.
   */
  const FACING = {
    north: [0, 0, -1], south: [0, 0, 1], west: [1, 0, 0], east: [-1, 0, 0],
  }

  /*
   * One id at a time in an otherwise empty room, so a count above zero can
   * only have come from the id under test. Four wall facings plus the floor
   * torch is every id the block table has, and that is the thing worth
   * proving: blockLight.js needed a loop over the four facings for exactly
   * this reason, and a flame keyed only on `torch` leaves four dark torches.
   *
   * THE SUPPORT BLOCK IS NOT DECORATION. blocks.js's BLOCK_SUPPORT takes an
   * unsupported torch straight back off the wall and drops it as an item --
   * which is what the first run of this test measured: `north` happened to
   * survive long enough to burn and the other three were gone before the
   * sampler started. A wall torch needs the block BEHIND it, which is the
   * opposite of the direction it points.
   */
  const ids = { floor: TORCH, ...WALL_TORCH }
  const seen = {}
  const offsets = {}
  for (const [name, id] of Object.entries(ids)) {
    const d = FACING[name] ?? [0, 0, 0]
    await teleport(page, CX + 0.5, PY + 1, CZ + 0.5)
    await clearTorches(page)
    // The room really is empty before the one torch goes in, so a count above
    // zero afterwards can only be that torch. `clearTorches` waits for this,
    // and the line stays as the statement of what was waited for.
    expect(await flames(page), `${name}: room not empty before placing`).toBe(0)
    await page.evaluate(([cx, cy, cz, dx, dz, air, stone]) => {
      // Clear last round's support, then place this round's.
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        window.noa.setBlock(air, cx + ox, cy, cz + oz)
      }
      if (dx || dz) window.noa.setBlock(stone, cx - dx, cy, cz - dz)
    }, [CX, PY + 1, CZ, d[0], d[2], ID.air, ID.stone])
    await setBlock(page, id, CX, PY + 1, CZ)
    await waitTicks(page, 4)
    // It is still there -- the support rule did not take it back off.
    expect(await getBlock(page, CX, PY + 1, CZ), `${name} torch stayed placed`).toBe(id)

    await teleport(page, CX + 0.5, PY + 1, CZ + 0.5)
    await waitTicks(page, 10)
    seen[name] = (await peakFlames(page, 1200)).peak

    // Mean flame position over a couple of seconds, which averages vanilla's
    // +/-0.05 birth jitter away and leaves the block-local offset.
    offsets[name] = await page.evaluate(([cx, cy, cz]) => new Promise((resolve) => {
      let n = 0, sx = 0, sy = 0, sz = 0
      const t0 = performance.now()
      const step = () => {
        for (const [x, y, z] of window.game.particles.flamePositions()) {
          sx += x - cx; sy += y - cy; sz += z - cz; n++
        }
        if (performance.now() - t0 < 2000) requestAnimationFrame(step)
        else resolve(n ? [+(sx / n).toFixed(3), +(sy / n).toFixed(3), +(sz / n).toFixed(3), n] : null)
      }
      requestAnimationFrame(step)
    }), [CX, PY + 1, CZ])
  }

  console.log(`  peak flames by id: ${JSON.stringify(seen)}`)
  console.log(`  mean flame offset within the cell: ${JSON.stringify(offsets)}`)

  for (const [name, peak] of Object.entries(seen)) {
    expect(peak, `${name} torch should burn`).toBeGreaterThan(0)
  }

  /*
   * VANILLA'S NUMBERS. TorchBlock puts the flame at (0.5, 0.7, 0.5) of the
   * cell; WallTorchBlock adds 0.22 to y and 0.27 along the direction OPPOSITE
   * the one the torch points, because the post's foot is in the wall and its
   * tilted tip only reaches about a quarter block out.
   *
   * The tolerance is 0.06 -- just over vanilla's own +/-0.05 birth jitter,
   * which averaging has mostly but not entirely removed. It is nowhere near
   * loose enough to accept a mirrored offset, which would be wrong by 0.54.
   */
  for (const [name, o] of Object.entries(offsets)) {
    expect(o, `${name} torch produced no flames to measure`).not.toBeNull()
    // Non-empty sample, before anything is concluded from the mean of it.
    expect(o[3], `${name} sample size`).toBeGreaterThan(20)
    const d = FACING[name] ?? [0, 0, 0]
    const want = name === 'floor'
      ? [0.5, 0.7, 0.5]
      : [0.5 - 0.27 * d[0], 0.92, 0.5 - 0.27 * d[2]]
    for (let a = 0; a < 3; a++) {
      expect(o[a], `${name} axis ${a}`).toBeGreaterThan(want[a] - 0.06)
      expect(o[a], `${name} axis ${a}`).toBeLessThan(want[a] + 0.06)
    }
  }

  /*
   * The wall torch, photographed in PROFILE rather than head-on. The last id
   * placed above points +x, so its support block is at x-1 and standing on
   * that side puts the block between the camera and the torch -- which is the
   * first picture this took, and it showed a flame floating over a bare cube.
   */
  await teleport(page, CX + 0.5, PY + 1, CZ + 3.5)
  await look(page, { heading: HEADING.northMinusZ, pitch: 0 })
  await waitTicks(page, 10)
  await shot(page, 'torch-flame-wall')
})

/* ------------------------------------------------------------------ *
 * 6. A hallway of them
 * ------------------------------------------------------------------ */

test('a hundred torches cost what ten do at the emitter', async ({ page, terrain }) => {
  await room(page, terrain, 8)
  await night(page)

  /*
   * THE RISK THIS FILE EXISTS TO RETIRE. Every other effect in particles.js is
   * a burst that ends; a torch never stops, and a corridor of them is many
   * continuous emitters at once.
   *
   * The emitter is a SAMPLER, not a scan -- it copies ClientLevel.animateTick,
   * picking 1334 random blocks a tick near the player and spawning from
   * whatever it lands on. So the cost of finding torches does not depend on
   * how many there are: one torch and a hundred both cost 1334 getBlock calls.
   * Only the particles scale, and they scale sub-linearly because a torch 12
   * blocks away is picked a fifth as often as one underfoot.
   *
   * Measured rather than argued, at zero, ten and a hundred.
   */
  const measure = async (n) => {
    await clearTorches(page)
    if (n) {
      await page.evaluate(([cx, cy, cz, count, torch, stone]) => {
        // Every other cell, so they are spread across the sampler's falloff
        // the way a real build would be rather than stacked underfoot.
        let placed = 0
        for (let dx = -7; dx <= 7 && placed < count; dx += 2) {
          for (let dz = -7; dz <= 7 && placed < count; dz += 2) {
            window.noa.setBlock(stone, cx + dx, cy - 1, cz + dz)
            window.noa.setBlock(torch, cx + dx, cy, cz + dz)
            placed++
          }
        }
        return placed
      }, [CX, PY + 1, CZ, n, TORCH, ID.stone])
    }
    await teleport(page, CX + 0.5, PY + 1, CZ + 0.5)
    await waitTicks(page, 30)
    const live = await page.evaluate(() => new Promise((resolve) => {
      let peak = 0, total = 0, samples = 0, frames = 0
      const t0 = performance.now()
      const step = () => {
        const f = window.game.particles.flames
        if (f > peak) peak = f
        total += f; samples++; frames++
        const dt = performance.now() - t0
        if (dt < 3000) requestAnimationFrame(step)
        else resolve({ peak, mean: +(total / samples).toFixed(1), fps: +(frames / (dt / 1000)).toFixed(1) })
      }
      requestAnimationFrame(step)
    }))
    return live
  }

  const zero = await measure(0)
  const ten = await measure(10)
  const hundred = await measure(100)
  console.log(`  0 torches:   ${JSON.stringify(zero)}`)
  console.log(`  10 torches:  ${JSON.stringify(ten)}`)
  console.log(`  100 torches: ${JSON.stringify(hundred)}`)

  // Non-empty measurements first: a zero frame count would make every ratio
  // below a division by nothing.
  expect(zero.fps).toBeGreaterThan(0)
  expect(hundred.peak).toBeGreaterThan(ten.peak)

  /*
   * The pool is the cap and it is what stops a pathological build. 400 quads
   * is one draw call however full it is, so the worst case here is bounded by
   * construction rather than by hoping nobody builds a torch wall.
   */
  const capacity = await page.evaluate(() => window.game.particles.capacity)
  expect(hundred.peak).toBeLessThanOrEqual(capacity)
})

/* ------------------------------------------------------------------ *
 * 5. The break burst still works
 * ------------------------------------------------------------------ */

test('the block-break burst is undisturbed', async ({ page, terrain }) => {
  await room(page, terrain)
  await teleport(page, CX + 0.5, PY + 3, CZ + 0.5)
  await waitTicks(page, 5)

  /*
   * The reason particles.js exists, per its own docblock: "breaking a block
   * without them feels like the block was deleted rather than broken". The
   * flame added a second physics spec to the per-frame loop, and this is the
   * line that says the first one still runs.
   */
  const before = await blockParticles(page)
  await page.evaluate(([x, y, z, id]) => {
    window.game.particles.burst(id, [x, y, z])
  }, [CX, PY, CZ, ID.stone])
  const after = await blockParticles(page)
  expect(after - before).toBe(24)
})
