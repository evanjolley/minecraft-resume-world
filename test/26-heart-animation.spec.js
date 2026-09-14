import { test, expect } from './fixtures.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { BLINK_TICKS, heartFlashOn } from '../src/hud.js'

/*
 * The damage animation on the health row.
 *
 * WHAT VANILLA DOES, and therefore what these numbers are. Gui.renderPlayerStats
 * sets `healthUpdateCounter = updateCounter + 20` when health drops, and draws
 * the flash while
 *
 *     (healthUpdateCounter - updateCounter) / 3 % 2 == 1
 *
 * With d counting down 20, 19, ... 1 at one per tick, that expression is true
 * for d in [17..15], [11..9] and [5..3] -- THREE pulses of three ticks each,
 * starting 150 ms after the hit and finished by 900 ms. That is a timing you
 * can assert, which is the reason these tests count pulses and clock their
 * edges rather than checking that a class got set.
 *
 * The other half of the effect is the LAG: `lastPlayerHealth` only catches up
 * after 1000 ms of quiet, so the hearts that flash are the ones you had before
 * the hit, not the ones you have now. 'the flash shows what you lost' below is
 * the test that pins it -- a flash driven off current health would light seven
 * hearts there instead of ten and nothing else in this file would notice.
 *
 * Nothing here hardcodes a world position; the player is wherever the fixture
 * left them and only the HUD is read.
 */

/*
 * Where the frame captures land. The same directory helpers/shots.js uses,
 * but reached without exporting its private shotPath -- several agents are in
 * this repo at once and a one-line export to a shared helper is not worth the
 * conflict.
 */
const shotPath = (name) => path.join(
  path.dirname(fileURLToPath(import.meta.url)), 'screenshots', `${name}.png`)

/** Which of the three sprites in a heart cell is which. All carry `.sprite`. */
const CONTAINER = '.sprite:not(.blink):not(.fill)'

/**
 * Sample the heart row every animation frame for `ms`, optionally dealing
 * damage on the first one.
 *
 * In the page rather than driven from node, because the thing under test
 * alternates on a 150 ms beat and a round trip per sample would alias it.
 */
function sample(page, ms, damage = 0) {
  return page.evaluate(([ms, damage, CONTAINER]) => new Promise((resolve) => {
    const slots = [...document.querySelectorAll('#hearts .icon-slot')]
    const frames = []
    const t0 = performance.now()
    if (damage) window.game.survival.damage(damage)
    const step = () => {
      const t = performance.now() - t0
      frames.push({
        t,
        // The white-outlined container variant: vanilla swaps the sprite.
        flash: slots[0].querySelector(CONTAINER).style.backgroundImage.includes('_blink'),
        pale: slots.filter(s => s.querySelector('.blink').style.opacity !== '0').length,
        live: slots.filter(s => s.querySelector('.fill').style.opacity !== '0').length,
        tops: slots.map(s => s.style.top).join(','),
      })
      if (t < ms) requestAnimationFrame(step)
      else resolve(frames)
    }
    requestAnimationFrame(step)
  }), [ms, damage, CONTAINER])
}

/** Contiguous runs of `flash === true`, as [start, end] ms. */
function pulses(frames) {
  const out = []
  let open = null
  for (const f of frames) {
    if (f.flash && open === null) open = f.t
    if (!f.flash && open !== null) { out.push([open, f.t]); open = null }
  }
  if (open !== null) out.push([open, frames[frames.length - 1].t])
  return out
}

test.describe('heart damage animation', () => {
  /*
   * The timing, checked against the arithmetic rather than against the screen.
   *
   * The screen cannot answer this one. The headless browser renders the world
   * at roughly seven frames a second under software GL, and the flash beats
   * every three ticks -- sampling a 150 ms square wave at 150 ms aliases it
   * into whatever it feels like. So the shape of the pulse train is pinned
   * here, off the pure predicate, and the test below only has to show that it
   * reaches the DOM and stops.
   */
  test('the flash is three pulses over twenty ticks, then nothing', async () => {
    const lit = []
    for (let left = BLINK_TICKS; left >= 0; left--) lit.push(heartFlashOn(left) ? 1 : 0)

    // ticks 20..0 after a hit, which is 1.05 s of counter:
    expect(lit.join('')).toBe('000111000111000111000')

    // Three pulses, three ticks each, nine ticks lit out of twenty.
    expect(lit.reduce((a, b) => a + b, 0)).toBe(9)
    expect(lit.join('').split('0').filter(Boolean).length).toBe(3)

    // It is over. A counter that has run out never lights the hearts again,
    // which is the assertion a "did it start" test cannot make.
    for (let left = 0; left > -200; left--) expect(heartFlashOn(left)).toBe(false)
  })

  test('the flash reaches the hearts and clears itself', async ({ page }) => {
    const frames = await sample(page, 1700, 6)

    // It happens at all, and early -- inside the first counter's worth.
    const on = frames.filter(f => f.flash)
    expect(on.length).toBeGreaterThan(0)
    expect(on[0].t).toBeLessThan(600)

    // The containers go back to the black-outlined sprite and stay there. The
    // counter runs out at 1000 ms; nothing past 1200 has any excuse.
    const late = frames.filter(f => f.t > 1200)
    expect(late.length).toBeGreaterThan(0)
    expect(late.some(f => f.flash)).toBe(false)
    expect(late.some(f => f.pale > 0)).toBe(false)
  })

  test('the flash shows what you lost, not what you have left', async ({ page }) => {
    /*
     * Let the lag settle first. displayHealth only catches up after a second
     * of quiet, and the fixture shares one page across the file -- so a hit
     * landing too soon after the previous test's would find it still holding
     * THAT test's old value and flash the wrong number of hearts. Which is
     * vanilla's behaviour, faithfully; it is this assertion that needs a known
     * starting point, not the code.
     */
    await page.waitForTimeout(1300)

    // Six damage: ten hearts become seven. The pale layer is painted from the
    // LAGGING health, so all ten light up and the live row covers the first
    // seven -- which is what makes the three you lost read as lost.
    const frames = await sample(page, 900, 6)
    const lit = frames.filter(f => f.flash)
    expect(lit.length).toBeGreaterThan(0)
    expect(Math.max(...lit.map(f => f.pale))).toBe(10)
    expect(Math.min(...lit.map(f => f.live))).toBe(7)

    // Between pulses the pale layer is gone entirely, not just dimmed.
    const dark = frames.filter(f => !f.flash && f.t > 300)
    expect(dark.length).toBeGreaterThan(0)
    expect(Math.max(...dark.map(f => f.pale))).toBe(0)
  })

  test('the row trembles below two hearts, and stops when you heal', async ({ page }) => {
    const calm = await sample(page, 300)
    expect(new Set(calm.map(f => f.tops)).size).toBe(1)
    expect(calm[0].tops.split(',').every(t => t === '0px')).toBe(true)

    // 16 damage leaves health at 4 half-hearts, vanilla's `if (i <= 4)`.
    const frames = await sample(page, 1600, 16)
    const late = frames.filter(f => f.t > 300)
    const patterns = [...new Set(late.map(f => f.tops))]

    // It moves,
    expect(patterns.length).toBeGreaterThan(2)
    // one GUI pixel down or nothing, at SCALE 2 -- never up, never further,
    expect(patterns.every(p => p.split(',').every(t => t === '0px' || t === '2px'))).toBe(true)
    // and per heart, not as a row: some frame has the hearts disagreeing.
    expect(late.some(f => new Set(f.tops.split(',')).size > 1)).toBe(true)

    // Healing past two hearts settles it. This is not a timed window like the
    // flash -- vanilla trembles for as long as you are nearly dead -- so the
    // thing that has to end it is the health going back up.
    await page.evaluate(() => window.game.survival.heal(20))
    const healed = await sample(page, 400)
    expect(new Set(healed.map(f => f.tops))).toEqual(new Set(['0px,0px,0px,0px,0px,0px,0px,0px,0px,0px']))
  })

  test('the animation leaves the HUD grid exactly where it found it', async ({ page }) => {
    // Measured, not asserted against a constant: the resting geometry is
    // whatever hud.js's GUI-pixel table says today, and this only cares that
    // the animation gives it back.
    const rest = () => page.evaluate(() => {
      const row = document.getElementById('hearts').getBoundingClientRect()
      return {
        row: [row.x, row.y, row.width, row.height],
        slots: [...document.querySelectorAll('#hearts .icon-slot')]
          .map(s => [s.style.top, s.getBoundingClientRect().y]),
      }
    })

    const before = await rest()
    await sample(page, 1400, 6)
    await page.evaluate(() => window.game.survival.heal(20))
    await sample(page, 300)
    expect(await rest()).toEqual(before)
  })

  test('frames across a hit, for eyes', async ({ page }) => {
    /*
     * Evidence, not an assertion -- see helpers/shots.js. Via CDP's screencast
     * rather than a loop of page.screenshot(): a screenshot round trip costs
     * about 1.4 s here, and the flash is over in one, so the obvious loop
     * captures sixteen pictures of the aftermath and none of the event. The
     * screencast is pushed from the browser as it paints, so it sees every
     * frame the animation actually had.
     */
    const cdp = await page.context().newCDPSession(page)
    const shots = []
    cdp.on('Page.screencastFrame', (f) => {
      shots.push(f.data)
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
    })

    await page.evaluate(() => window.game.survival.heal(20))
    await page.waitForTimeout(1300)
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 })
    await page.waitForTimeout(400)
    // 16, not 15: it has to land on four half-hearts or under, or the jitter
    // never arms and the frames only show half the effect.
    await page.evaluate(() => window.game.survival.damage(16))
    await page.waitForTimeout(1800)
    await cdp.send('Page.stopScreencast')
    await cdp.detach()

    const { width, height } = page.viewportSize()
    await Promise.all(shots.slice(0, 24).map((data, i) => sharp(Buffer.from(data, 'base64'))
      // The heart row, 30..39 GUI pixels up from the bottom of the screen at
      // SCALE 2, with a pixel of air either side so the jitter has somewhere
      // to be seen moving into.
      .extract({ left: Math.round(width / 2 - 182), top: height - 82, width: 200, height: 26 })
      .resize({ width: 600, kernel: 'nearest' })
      .toFile(shotPath(`heart-anim-${String(i).padStart(2, '0')}`))))

    expect(shots.length).toBeGreaterThan(4)
  })
})
