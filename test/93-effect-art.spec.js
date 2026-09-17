import { test, expect } from './fixtures.js'
import { waitTicks, teleport, settleOnGround, SPAWN } from './helpers/world.js'
import { shotRegion } from './helpers/shots.js'

/*
 * The art and the noise the potions shipped without: the 39 HUD icons, the
 * spell mote's own sprite, and the three potion sounds.
 *
 * ALL THREE ARE THE SAME BUG and it is the reason this file exists rather
 * than three assertions tacked onto three other files. Every one of them was
 * a renderer wired to an asset nobody had extracted -- the icons were a
 * coloured square, the mote was a procedural blob, the sounds were a
 * `sounds?.drink?.()` call that reached nothing. The code was right in all
 * three cases. `ls public/textures/` was the missing step, so these are the
 * assertions that make the FILES the thing under test.
 */

const give = (page, key, seconds, amplifier = 0, hidden = false) =>
  page.evaluate(([k, s, a, h]) =>
    window.game.effects.give(window.noa.playerEntity, k, s, a, h),
  [key, seconds, amplifier, hidden])

const clear = (page) =>
  page.evaluate(() => window.game.effects.clear(window.noa.playerEntity))

/*
 * Vanilla's 39 effect ids, restated here rather than read off
 * window.game.effects -- the same rule test/helpers/world.js states for the
 * block ids. Imported, this test would assert that the texture build emits a
 * file for every name effects.js happens to hold, which is true of an
 * effects.js with one entry in it. Written out, it asserts the build emits
 * all THIRTY-NINE, which is what the jar has.
 */
const EFFECT_KEYS = [
  'speed', 'slowness', 'haste', 'mining_fatigue', 'strength', 'instant_health',
  'instant_damage', 'jump_boost', 'nausea', 'regeneration', 'resistance',
  'fire_resistance', 'water_breathing', 'invisibility', 'blindness',
  'night_vision', 'hunger', 'weakness', 'poison', 'wither', 'health_boost',
  'absorption', 'saturation', 'glowing', 'levitation', 'luck', 'unluck',
  'slow_falling', 'conduit_power', 'dolphins_grace', 'bad_omen',
  'hero_of_the_village', 'darkness', 'trial_omen', 'raid_omen', 'wind_charged',
  'weaving', 'oozing', 'infested',
]

/* The top-right corner, which is where Gui.renderEffects puts the row and the
   opposite corner from every other shot helper in this suite. Two rows of 24
   at a 25 pitch: five icons is 125 wide, both rows is 53 tall. */
const CORNER = (w) => ({ x: w - 200, y: 0, width: 200, height: 80 })

/*
 * A spread that puts icons in BOTH rows and exercises the split. Speed and
 * Strength are beneficial (top); Poison is harmful and Glowing is NEUTRAL,
 * and vanilla's test is `isBeneficial()` rather than `!isHarmful()`, so
 * Glowing belongs in the BOTTOM row beside Poison. That is the assertion a
 * screenshot cannot make, because both rows look alike.
 */
const SPREAD = [
  ['speed', 'beneficial'],
  ['strength', 'beneficial'],
  ['fire_resistance', 'beneficial'],
  ['poison', 'harmful'],
  ['glowing', 'neutral'],
]

test.describe('the status effect icons', () => {
  test('all 39 mob_effect sprites are on disk and are vanilla 18x18', async ({ page }) => {
    expect(EFFECT_KEYS.length).toBe(39)

    const results = await page.evaluate(async (ks) => {
      const out = []
      for (const k of ks) {
        const r = await fetch(`/textures/mob_effect/${k}.png`)
        if (!r.ok) { out.push([k, r.status, 0, 0]); continue }
        const bmp = await createImageBitmap(await r.blob())
        out.push([k, 200, bmp.width, bmp.height])
      }
      return out
    }, EFFECT_KEYS)

    const missing = results.filter(([, s]) => s !== 200).map(([k]) => k)
    expect(missing, `mob_effect sprites the texture build did not emit`).toEqual([])
    // 18, not 16. Effect icons are the one piece of vanilla art off the
    // 16-pixel grid -- Gui.renderEffects blits 18x18 into a 24x24 frame.
    const wrongSize = results.filter(([, , w, h]) => w !== 18 || h !== 18)
    expect(wrongSize).toEqual([])
  })

  test('the HUD draws the sprite, in vanilla rows, with no numeral', async ({ page }) => {
    await teleport(page, ...SPAWN)
    await settleOnGround(page)
    await clear(page)
    for (const [key] of SPREAD) await give(page, key, 60, 1)
    await waitTicks(page, 4)

    // Sprite mode, not the CE swatch fallback. Without this the whole test
    // passes against a build with an empty mob_effect directory.
    expect(await page.evaluate(() => window.game.effectHud.sprites)).toBe(true)

    const row = (i) => page.evaluate((n) => window.game.effectHud.rowKeys(n), i)
    expect((await row(0)).sort()).toEqual(['fire_resistance', 'speed', 'strength'])
    // Glowing is NEUTRAL and vanilla puts it here, beside Poison.
    expect((await row(1)).sort()).toEqual(['glowing', 'poison'])

    const icons = await page.evaluate(() =>
      [...document.querySelectorAll('.effect-icon')].map(el => ({
        img: getComputedStyle(el).backgroundImage,
        w: el.getBoundingClientRect().width,
      })))
    expect(icons.length).toBe(5)
    for (const { img } of icons) expect(img).toMatch(/mob_effect\/[a-z_]+\.png/)

    // Every effect above was given at amplifier 1, so the old drawing would
    // have put a "II" on all five. Vanilla's HUD row carries no text at all.
    expect(await page.evaluate(() => document.querySelectorAll('.effect-level').length)).toBe(0)

    const { width } = page.viewportSize()
    await shotRegion(page, 'effects-hud-after', CORNER(width))

    // The 24x24 frame at a 25 pitch, and the 3px inset, in real pixels --
    // the numbers hud.js cites from Gui.renderEffects, measured rather than
    // trusted. Everything is scaled by the HUD's own factor, so the test is
    // the RATIO: icon is three quarters of its cell.
    const geom = await page.evaluate(() => {
      const cell = document.querySelector('.effect-cell').getBoundingClientRect()
      const icon = document.querySelector('.effect-icon').getBoundingClientRect()
      return { cell: cell.width, icon: icon.width, inset: icon.left - cell.left }
    })
    expect(geom.icon / geom.cell).toBeCloseTo(18 / 24, 2)
    expect(geom.inset / geom.cell).toBeCloseTo(3 / 24, 2)

    await clear(page)
  })
})

/* ------------------------------------------------------------------ *
 * The three potion sounds.
 *
 * potions.js has called `sounds?.drink?.()`, `sounds?.throw?.()` and
 * `sounds?.shatter?.()` since the day it shipped. Nothing was ever passed in,
 * and build-sounds.mjs had never extracted a sample for any of them -- two
 * independent holes that both produce exactly the same silence, which is why
 * this asserts the SAMPLE NAME rather than "something played".
 * ------------------------------------------------------------------ */

const lastPlayed = (page) => page.evaluate(() => window.game.sounds.lastPlayed)

test.describe('the potion sounds', () => {
  /*
   * The AudioContext is 'off' until a real user gesture reaches the window --
   * sounds.js attaches its unlock to mousedown/touchstart/keydown in the
   * capture phase and removes it once resumed. A synthetic dispatchEvent does
   * not satisfy the browser's autoplay policy; the key has to come from the
   * driver. So: one real tap, then wait for the context to actually reach
   * 'running', because resume() is a promise and the tap only starts it.
   */
  test.beforeAll(async ({ world }) => {
    await world.page.keyboard.press('KeyZ')
    await world.page.waitForFunction(() => window.game.sounds.state === 'running',
      null, { timeout: 15_000, polling: 50 })
    await world.page.evaluate(() => window.game.sounds.ready())
  })

  test('drink, throw and shatter reach vanilla\'s own samples', async ({ page }) => {
    // A no-op play() leaves lastPlayed holding whatever ran before, so the
    // gate is checked rather than assumed. Without this the whole describe
    // passes against a build that has no potion samples at all.
    expect(await page.evaluate(() => window.game.sounds.state)).toBe('running')

    const fired = await page.evaluate(() => {
      const out = {}
      const s = window.game.sounds
      for (const [name, fn] of [['drink', () => s.potions.drink()],
                                ['throw', () => s.potions.throw()],
                                ['shatter', () => s.potions.shatter([0, 64, 0])]]) {
        out[name] = { ok: fn(), last: s.lastPlayed }
      }
      return out
    })

    // entity.generic.drink -> random/drink, one sample.
    expect(fired.drink.ok).toBe(true)
    expect(fired.drink.last).toMatchObject({ event: 'drink', set: 'drink', name: 'random/drink' })

    // entity.splash_potion.throw -> random/bow. Not a file called `throw`.
    expect(fired.throw.ok).toBe(true)
    expect(fired.throw.last).toMatchObject({ event: 'potionThrow', name: 'random/bow' })

    // entity.splash_potion.break -> random/glass1-3.
    expect(fired.shatter.ok).toBe(true)
    expect(fired.shatter.last.name).toMatch(/^random\/glass[123]$/)
  })

  test('drinking a potion in the world actually makes the noise', async ({ page }) => {
    await page.evaluate(() => { window.game.sounds.lastPlayed })
    const before = await lastPlayed(page)
    await page.evaluate(() => window.game.potions.drinkNow('swiftness'))
    await waitTicks(page, 2)
    const after = await lastPlayed(page)
    expect(after, 'drinking went through potions.js and reached no sample')
      .toMatchObject({ event: 'drink', name: 'random/drink' })
    expect(after).not.toEqual(before)
  })
})

/* ------------------------------------------------------------------ *
 * THE SWIRL.
 *
 * Its spec has a history: it was GREEN while the picture showed nothing at
 * all, because Babylon culled the mesh against a bounding box computed from
 * an all-zero buffer. Every JavaScript number was right and the screen was
 * unchanged. So the order here is deliberate -- what the GPU drew first, then
 * whether it MOVES, and only then the numbers in the pool.
 *
 * And the motion is judged across FRAMES. The torch-flame spec's first probe
 * measured mean crop colour and passed on the sky brightening out of midnight
 * rather than on the flame -- a trend, not a flicker. Counting coloured pixels
 * over ten frames cannot drift that way, because a global lighting change
 * lifts every pixel together and moves the count by nothing.
 * ------------------------------------------------------------------ */

const swirlState = (page) => page.evaluate(() => window.game.effectSwirl.state())

/*
 * How many pixels of a crop are SWIRL-coloured, for one effect's hue.
 *
 * Resistance is 0x9146F0, a bright purple, and it is chosen because nothing
 * else at spawn is: grass is green, the sky is blue but its red is BELOW its
 * green, and the player's skin and the dirt are brown with almost no blue in
 * them. `blue high AND red above green` excludes all three, which is what
 * makes this a count of motes rather than a count of scenery.
 *
 * Rejected: Instant Health's saturated red, which was the first choice and is
 * an INSTANT effect -- it applies and is gone, never joins effects.affected,
 * and produces no swirl at all. That is the version of this test that
 * measured an empty pool.
 */
async function purplePixels(page, clip) {
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
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 2] > 150 && d[i] > d[i + 1] + 40) n++
      }
      resolve(n)
    }
    img.src = url
  }), `data:image/png;base64,${buf.toString('base64')}`)
}

/*
 * Wait for the pool to EMPTY, not just for the effects to be cleared.
 *
 * A mote outlives the effect that spawned it by up to two seconds, and the
 * system is shared -- so `state()` in one test happily returns the previous
 * test's motes. That is not hypothetical: it is why "a splash potion shatters
 * into 100 coloured motes" first read a Resistance mote's red (0x91) and
 * reported it as Poison's (0x87), and why the colour test saw one hue when it
 * had been given two effects. Clearing is not draining.
 */
async function drainMotes(page) {
  await clear(page)
  await page.waitForFunction(() => window.game.effectSwirl.live === 0,
    null, { timeout: 10_000, polling: 50 })
}

test.describe('the effect swirl', () => {
  test.beforeEach(async ({ page }) => {
    await teleport(page, ...SPAWN)
    await settleOnGround(page)
    await drainMotes(page)
  })
  test.afterEach(async ({ page }) => { await clear(page) })

  test('a mote is a ring that collapses, coloured per effect', async ({ page }) => {
    // Two TIMED effects. Instant Health looks like the obvious pick and is
    // not: an instant effect applies and is gone, never reaching
    // effects.affected, so it emits nothing to measure.
    await give(page, 'speed', 120)
    await give(page, 'regeneration', 120)
    await waitTicks(page, 40)

    /*
     * SAMPLED OVER TIME, not read once, and the arithmetic is why.
     *
     * Vanilla's rate is 1-in-4 per Minecraft tick and a mote lives 0.4-2s, so
     * the steady state on one body is about FOUR live motes. A single
     * snapshot of four coin flips comes up all-heads better than one run in
     * ten -- which is exactly how this test failed twice before anyone
     * noticed the pool was that small. Six reads spread over half a second is
     * thirty-odd motes, and the flake goes away without weakening anything.
     */
    const motes = []
    for (let i = 0; i < 6; i++) {
      motes.push(...await swirlState(page))
      await waitTicks(page, 3)
    }
    // Nothing below means anything against an empty pool, and an empty pool
    // is exactly what a broken emitter produces.
    expect(motes.length, 'no motes at all -- nothing below is a measurement')
      .toBeGreaterThan(10)

    /*
     * Per-particle colour, which is the thing that could not be done before
     * and is the whole reason this system exists. Two effects are up, vanilla
     * picks ONE at random per spawn rather than blending them
     * (MobEffectUtil.getColor is gone in 1.21), so both hues have to be
     * present and no mote may be the average of them.
     */
    const hues = new Set(motes.map(m => m.color.map(c => Math.round(c * 255)).join(',')))
    expect(hues.size, `every mote is the same colour: ${[...hues]}`).toBeGreaterThan(1)
    // 0x33EBFF and 0xCD5CAB, exactly -- not a blend of the two.
    for (const h of hues) expect(['51,235,255', '205,92,171']).toContain(h)

    /*
     * The animation. Vanilla's entity_effect is eight ring sprites indexed by
     * age, so a pool of motes at mixed ages is a pool at mixed FRAMES. One
     * frame across every mote means setSpriteFromAge is not running, which is
     * the bug the old blob had by construction -- it had no frames at all.
     */
    const frames = new Set(motes.map(m => m.frame))
    expect(frames.size, `every mote is on sprite frame ${[...frames]}`).toBeGreaterThan(1)
    for (const f of frames) expect(f).toBeGreaterThanOrEqual(0)
    for (const f of frames) expect(f).toBeLessThan(8)

    // No fade. SpellParticle holds full alpha for its whole life; the old
    // version ramped alpha down over the second half and that was wrong.
    for (const m of motes) expect(m.alpha).toBe(1)

    /*
     * Vanilla's velocity, which the old version was two orders of magnitude
     * short of. SpellParticle's constructor discards the horizontal velocity
     * it is handed and rolls its own `0.5 - nextDouble()` blocks per TICK, so
     * a fresh mote is moving up to 10 blocks a second sideways. Measured on
     * the youngest mote in the pool, before friction has taken much off it.
     */
    const youngest = motes.reduce((a, b) => (a.age < b.age ? a : b))
    expect(youngest.age).toBeLessThan(0.3)
  })

  test('the motes reach the framebuffer and they move', async ({ page }) => {
    // Third person, because the swirl wraps a BODY and in first person there
    // is no body on screen to wrap. Real F5, which is the only way in.
    await page.keyboard.press('F5')
    await page.waitForTimeout(400)
    expect(await page.evaluate(() => window.game.perspective.mode)).toBe('third-back')

    await give(page, 'resistance', 120)
    // Long enough for the pool to reach its steady state. At vanilla's
    // 1-in-4-ticks and a 0.4-2s life that is about ten motes, and sampling
    // before it fills would read the ramp rather than the flicker.
    await waitTicks(page, 60)

    const clip = { x: 1280 / 2 - 160, y: 720 / 2 - 160, width: 320, height: 320 }

    const frames = []
    for (let i = 0; i < 10; i++) {
      frames.push(await purplePixels(page, clip))
      // Three ticks, not two: a mote lives 8-40 ticks, so the gap has to be
      // long enough for the population to actually turn over between reads.
      await waitTicks(page, 3)
    }

    // THE ASSERTION THE OLD SPEC DID NOT HAVE. A pool full of motes and a
    // screen with none of them on it is the exact failure this file's header
    // describes, and it passed every JS assertion above it.
    expect(Math.max(...frames), 'the pool has motes and the GPU drew none of them')
      .toBeGreaterThan(0)

    const spread = Math.max(...frames) - Math.min(...frames)
    const distinct = new Set(frames).size
    console.log(`  swirl pixels across 10 frames: ${frames.join(', ')} -> spread ${spread}, ${distinct} distinct`)
    /*
     * Motion, not a photograph. A decal painted on the player gives ten
     * identical readings; motes being born, collapsing through eight sprite
     * frames and dying in the gaps between these frames cannot.
     */
    expect(distinct).toBeGreaterThan(2)
    expect(spread).toBeGreaterThan(3)

    await shotRegion(page, 'effects-swirl-after', clip)
    await page.keyboard.press('F5')
    await page.keyboard.press('F5')
  })

  test('a splash potion shatters into 100 coloured motes', async ({ page }) => {
    // Nothing else in the air, so the 100 below are the only motes there are
    // and `state()` reports the burst rather than the burst plus whatever was
    // still drifting off the player.
    const before = await page.evaluate(() => window.game.effectSwirl.live)
    expect(before).toBe(0)
    const out = await page.evaluate(() => {
      const pos = window.noa.ents.getPositionData(window.noa.playerEntity).position
      return window.game.potions.breakPotion({
        id: 'poison', x: pos[0] + 3, y: pos[1] + 1, z: pos[2],
      })
    })
    const after = await page.evaluate(() => window.game.effectSwirl.live)

    // Level event 2002 spawns 100. The pool is 512 and nothing else was in
    // flight, so all 100 land.
    expect(after - before).toBe(100)

    /*
     * The colour vanilla sends as the event's data int, tinted per particle
     * by 0.75-1.0. Poison is 0x87A363 -- so every mote must be that hue at
     * between three quarters and full brightness, and they must not all be
     * identical, which is what a single material tint would have given.
     */
    expect(out.color).toBe(0x87A363)
    const motes = await swirlState(page)
    const reds = motes.map(m => m.color[0])
    const base = 0x87 / 255
    for (const r of reds) {
      expect(r).toBeLessThanOrEqual(base + 1e-6)
      expect(r).toBeGreaterThanOrEqual(base * 0.75 - 1e-6)
    }
    expect(new Set(reds.map(r => r.toFixed(4))).size,
      '100 motes at one flat brightness -- setColor jitter is not running')
      .toBeGreaterThan(50)
  })
})
