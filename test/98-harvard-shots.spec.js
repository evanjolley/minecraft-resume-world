/*
 * Stage 2's pictures. Not assertions -- the point of these is that somebody
 * LOOKS at them, because the defects a census cannot see (a letter facing
 * the wrong way, a sign above eye level, a brick course across a doorway)
 * are all defects you only find in a screenshot at eye level.
 */
import { test } from './fixtures.js'
import {
  SURFACE_Y, teleport, look, BUILT_WORLD, enterWorld, leaveWorld,
} from './helpers/world.js'
import { shot } from './helpers/shots.js'

// plot-local -> world. Harvard is patch x 68..123, z 6..33; world = patch - (87, 56).
const wx = (lx) => lx - 19 + 0.5
const wz = (lz) => lz - 50 + 0.5
const E = Math.PI / 2, W = -Math.PI / 2, N = Math.PI, S = 0

async function stand(page, x, y, z, heading, pitch = 0) {
  await teleport(page, x, y, z)
  await look(page, { heading, pitch })
  await page.waitForTimeout(700)
}

/* Stage 2 is in claude-opus-5-1, not in the world the game boots into -- the
 * timeline moved out of the default world when the owner asked for his bare
 * superflat back. Enter it first, hand it back afterwards: one booted page is
 * shared by the whole worker, and enterWorld is what waits for the chunks. */
test.describe('what stage 2 looks like', () => {
  test.beforeEach(async ({ page }) => { await enterWorld(page, BUILT_WORLD) })
  test.afterEach(async ({ page }) => { await leaveWorld(page) })

  test('from the road, at eye level', async ({ page }) => {
    await stand(page, -23.5, SURFACE_Y + 1, wz(13), E)
    await shot(page, 'harvard-from-road')
    await stand(page, -23.5, SURFACE_Y + 1, wz(24), E)
    await shot(page, 'harvard-from-road-south')
    await stand(page, -23.5, SURFACE_Y + 1, wz(27), N)
    await shot(page, 'harvard-up-the-road')
  })

  test('down the axis and up the steps', async ({ page }) => {
    await stand(page, wx(4), SURFACE_Y + 1, wz(13), E)
    await shot(page, 'harvard-axis')
    await stand(page, wx(18), SURFACE_Y + 1, wz(13), E, -0.35)
    await shot(page, 'harvard-widener-front')
    await stand(page, wx(28), SURFACE_Y + 4, wz(13), E)
    await shot(page, 'harvard-portico')
  })

  test('the letter, the statue and the tower', async ({ page }) => {
    await stand(page, wx(6), SURFACE_Y + 1, wz(3), N)
    await shot(page, 'harvard-letter')
    await stand(page, wx(3), SURFACE_Y + 1, wz(7), E, -0.35)
    await shot(page, 'harvard-statue')
    await stand(page, wx(9), SURFACE_Y - 3, wz(7), N)
    await shot(page, 'harvard-crypt')
    await stand(page, wx(6), SURFACE_Y + 1, wz(23), E, -0.55)
    await shot(page, 'harvard-tower')
  })

  test('inside', async ({ page }) => {
    await stand(page, wx(31), SURFACE_Y + 4, wz(13), E)
    await shot(page, 'harvard-reading-room')
    await stand(page, wx(36), SURFACE_Y + 4, wz(16), S)
    await shot(page, 'harvard-mal')
    await stand(page, wx(31), SURFACE_Y, wz(13), E)
    await shot(page, 'harvard-stacks')
    await stand(page, wx(34), SURFACE_Y + 15, wz(17), N)
    await shot(page, 'harvard-roof')
    await stand(page, wx(53), SURFACE_Y + 4, wz(14), W)
    await shot(page, 'harvard-blackboard')
    await stand(page, wx(15), SURFACE_Y + 5, wz(8), E)
    await shot(page, 'harvard-dorm-room')
    await stand(page, wx(16), SURFACE_Y + 1, wz(20), E)
    await shot(page, 'harvard-nave')
  })

  test('from above', async ({ page }) => {
    await stand(page, wx(4), SURFACE_Y + 1, wz(14), E, -0.42)
    await shot(page, 'harvard-frieze')
    await stand(page, -23.5, SURFACE_Y + 1, wz(14), E, -0.30)
    await shot(page, 'harvard-frieze-from-road')
  })
})
