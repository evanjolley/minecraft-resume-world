import { test, expect } from './fixtures.js'
import {
  measureJumpApex, measureSpeed, look, HEADING, armApexSampler, readApex, tapKey,
} from './helpers/world.js'

/*
 * Minecraft Java Edition's real numbers, not the README's measured ones.
 * The README records what this engine currently produces; the point of a test
 * is to say what it SHOULD produce, so any drift shows up as a diff with a
 * number attached rather than as a quietly-updated table.
 */
const MC = { JUMP_APEX: 1.2522, WALK: 4.317, SPRINT: 5.612, SNEAK: 1.295 }

// 1.5% either way. noa integrates continuously against Minecraft's fixed
// 20 Hz tick, so exact equality is not reachable; 1.5% is tight enough that
// a wrong constant (or a silently doubled gravityMultiplier) still fails.
const TOL = 0.015
const near = (actual, want) => Math.abs(actual - want) <= want * TOL

test.describe('movement physics', () => {
  test.beforeEach(async ({ page }) => {
    // Walk +x from spawn: 8 blocks of travel with 30 to spare before the rim.
    await look(page, { heading: HEADING.eastPlusX })
  })

  test('a jump peaks at Minecraft height, so 1-block steps clear and 2 never do',
    async ({ page }) => {
      const apex = await measureJumpApex(page)
      expect(apex, `apex was ${apex.toFixed(4)} blocks`).toBeGreaterThan(1)
      expect(near(apex, MC.JUMP_APEX), `apex ${apex.toFixed(4)} vs ${MC.JUMP_APEX}`).toBe(true)
    })

  test('holding jump does not go higher than tapping it', async ({ page }) => {
    // The regression guard. noa's default jumpForce/jumpTime keep pushing
    // while the key is held, which is a Mario jump, not a Minecraft one.
    const tapped = await measureJumpApex(page)
    const held = await measureJumpApex(page, { holdMs: 400 })
    expect(held, `held ${held.toFixed(4)} vs tapped ${tapped.toFixed(4)}`)
      .toBeLessThanOrEqual(tapped + 0.02)
  })

  test('airJumps is 0, so hammering space mid-air never gains height', async ({ page }) => {
    expect(await page.evaluate(() => window.game.move.airJumps)).toBe(0)

    // And through real input, not just the setting: one clean arc, then the
    // same arc with four extra Space presses while airborne.
    const single = await measureJumpApex(page)

    await armApexSampler(page)
    await tapKey(page, 'Space')
    for (let i = 0; i < 4; i++) await tapKey(page, 'Space')
    const hammered = await readApex(page)

    expect(hammered, `mid-air re-jumps reached ${hammered.toFixed(4)} vs ${single.toFixed(4)}`)
      .toBeLessThanOrEqual(single + 0.05)
  })

  test('walking settles at Minecraft walk speed', async ({ page }) => {
    const v = await measureSpeed(page, ['KeyW'])
    expect(near(v, MC.WALK), `walk ${v.toFixed(3)} b/s vs ${MC.WALK}`).toBe(true)
  })

  test('sprinting settles at Minecraft sprint speed', async ({ page }) => {
    const v = await measureSpeed(page, ['ControlLeft', 'KeyW'])
    expect(near(v, MC.SPRINT), `sprint ${v.toFixed(3)} b/s vs ${MC.SPRINT}`).toBe(true)
  })

  test('sneaking settles at Minecraft sneak speed', async ({ page }) => {
    // Sneak is slow enough that the 900 ms warmup is most of a block; the
    // sample window is stretched so the displacement is comfortably above
    // per-tick noise.
    const v = await measureSpeed(page, ['ShiftLeft', 'KeyW'], { sampleMs: 1200 })
    expect(near(v, MC.SNEAK), `sneak ${v.toFixed(3)} b/s vs ${MC.SNEAK}`).toBe(true)
  })
})
