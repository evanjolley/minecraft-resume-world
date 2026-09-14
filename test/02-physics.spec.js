import { test, expect } from './fixtures.js'
import {
  measureJumpApex, measureSpeed, look, HEADING, armApexSampler, readApex, tapKey,
  teleport, SURFACE_Y,
} from './helpers/world.js'

/*
 * Minecraft Java Edition's real numbers, not the README's measured ones.
 * The README records what this engine currently produces; the point of a test
 * is to say what it SHOULD produce, so any drift shows up as a diff with a
 * number attached rather than as a quietly-updated table.
 */
const MC = {
  JUMP_APEX: 1.2522, WALK: 4.317, SPRINT: 5.612, SNEAK: 1.295,
  // Sprint-jumping is not a constant anywhere in Minecraft; it is what the
  // 0.2/tick jump impulse averages out to over a hop.
  SPRINT_JUMP: 7.127,
}

/*
 * 1.5% either way. noa integrates continuously against Minecraft's fixed
 * 20 Hz tick, so exact equality is not reachable; 1.5% is tight enough that
 * a wrong constant (or a silently doubled gravityMultiplier) still fails.
 *
 * NOT widened when measureSpeed stopped dividing by wall clock, even though
 * that turned a wobble into a standing number. The three ground speeds now
 * read dead steady and all three land at exactly 0.664% BELOW Minecraft:
 *
 *   walk   4.2883 vs 4.317    ratio 0.99336
 *   sprint 5.5747 vs 5.612    ratio 0.99335
 *   sneak  1.2864 vs 1.295    ratio 0.99336
 *
 * One ratio, three speeds, so it is not three wrong constants -- it is one
 * systematic factor, and it is the same one src/fluids.js already corrects
 * for in water. noa's movement component pushes with `responsiveness * (S - v)`
 * and voxel-physics-engine's global airDrag pulls back with `drag * v`, which
 * balance strictly below S at S * r / (r + drag). With physics.js's
 * responsiveness = 15 and noa's default airDrag = 0.1 that predicts
 * 15 / 15.1 = 0.993377, and the measurements above agree to five digits.
 *
 * So the fix is the fluids.js one applied on land: scale move.maxSpeed by
 * (r + drag) / r rather than assigning MC.WALK_SPEED raw. That is a
 * calibrated fidelity constant in src/ and therefore the owner's call, not
 * this file's -- the test's job is to hold the real number up and let the
 * 0.664% be visible. It passes at 1.5% today; if anyone tightens TOL below
 * 0.7% this is the first thing that will fail, and that is correct.
 */
const TOL = 0.015
const near = (actual, want) => Math.abs(actual - want) <= want * TOL

test.describe('movement physics', () => {
  test.beforeEach(async ({ page }) => {
    /*
     * Four blocks east of spawn, and looking east.
     *
     * Spawn itself is now under a dark forest canopy -- leaves at y=139 over a
     * floor at y=135 -- and a 1.25-block jump puts a 1.8-tall player's head
     * straight into them, which clips the apex. DROP_X is the nearest column
     * with clear sky and identical ground height.
     */
    await teleport(page, DROP_X, SURFACE_Y, DROP_Z)
    await settleOnGround(page)
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

  /*
   * Sprint-jumping, which in Minecraft is FASTER than sprinting on flat ground
   * -- roughly 7.13 b/s against 5.61 -- and is the whole reason players do it.
   * Each jump adds a forward impulse and the one tick of ground contact
   * between hops costs less than continuous running does.
   *
   * SPACE IS HELD, not tapped, because that is how anyone actually bunny-hops
   * and because holding it is what used to break: the boost hung off the key's
   * rising edge, so hop two onwards got nothing and a sprint-jump run settled
   * back to 5.58 b/s -- a hair SLOWER than just sprinting, which is what the
   * "there is friction on the ground" report was.
   *
   * Wider tolerance than the speeds above on purpose. Those are constants the
   * engine is told; this is an emergent average over a launch-and-decay cycle
   * that noa integrates continuously against Minecraft's fixed 20 Hz, and the
   * phase of the sample window inside that cycle moves it around.
   */
  test('sprint-jumping is faster than sprinting, the way it is in Minecraft',
    async ({ page }) => {
      // West end of the island: 3.4 s at 7.3 b/s is 25 blocks of clear run.
      await teleport(page, -35.5, SURFACE_Y + 1, 0.5)
      const sprint = await measureSpeed(page, ['ControlLeft', 'KeyW'], { sampleMs: 2000 })

      await teleport(page, -35.5, SURFACE_Y + 1, 0.5)
      const jumping = await measureSpeed(page, ['ControlLeft', 'KeyW', 'Space'],
        { warmupMs: 1400, sampleMs: 2000 })

      const where = `sprint ${sprint.toFixed(3)}, sprint-jump ${jumping.toFixed(3)} b/s`
      expect(jumping, `${where} -- sprint-jumping is not faster`).toBeGreaterThan(sprint * 1.1)
      expect(Math.abs(jumping - MC.SPRINT_JUMP) <= MC.SPRINT_JUMP * 0.05,
        `${where} vs Minecraft's ${MC.SPRINT_JUMP}`).toBe(true)
    })

  test('sneaking settles at Minecraft sneak speed', async ({ page }) => {
    // Sneak is slow enough that the 900 ms warmup is most of a block; the
    // sample window is stretched so the displacement is comfortably above
    // per-tick noise.
    const v = await measureSpeed(page, ['ShiftLeft', 'KeyW'], { sampleMs: 1200 })
    expect(near(v, MC.SNEAK), `sneak ${v.toFixed(3)} b/s vs ${MC.SNEAK}`).toBe(true)
  })
})
