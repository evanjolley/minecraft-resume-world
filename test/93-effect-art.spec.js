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
