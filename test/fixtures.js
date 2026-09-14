import { test as base, expect } from '@playwright/test'
import { watchErrors } from './helpers/errors.js'
import { bootWorld, resetWorld, snapshotRegion, usePad } from './helpers/world.js'

/*
 * Start here.
 *
 *   npm run test                       whole suite, starts its own dev server
 *   npx playwright test -c test/playwright.config.js test/06-mining.spec.js
 *
 * Writing a new one:
 *
 *   import { test, expect } from './fixtures.js'
 *   import { aim, holdMouse, getBlock, ID } from './helpers/world.js'
 *
 *   test('breaking X yields Y', async ({ page, terrain }) => {
 *     await terrain.keep([0, 63, 0], [0, 63, 0])   // undone in teardown
 *     await aim(page, { pitch: Math.PI / 2 })
 *     await holdMouse(page, 1500)
 *     expect(await getBlock(page, 0, 63, 0)).toBe(ID.air)
 *   })
 *
 * Fixtures: `page` (booted, reset), `terrain` (voxel undo), `errors` (live
 * cursor into pageerror/console/requestfailed/4xx), `bootErrors` (what the
 * load itself produced). Everything else lives in helpers/world.js -- launch
 * flags, the readiness polling, the pointer-lock camera workaround, real-key
 * taps that a 30 Hz tick loop can actually see, and the measurements.
 *
 * One booted world per worker, reset between tests.
 *
 * WHY share it: booting is ~6-10 s under swiftshader (chunk generation, then
 * meshing 5x5x2 chunks) against ~0.1-2 s for a typical assertion. Per-test
 * boot would put the suite well past five minutes and nobody would run it,
 * which is the actual failure mode this harness exists to fix.
 *
 * WHY that is safe: everything a test can mutate is either restored by
 * resetWorld (player, inventory, survival, camera, clock, held keys) or is
 * the test's own responsibility via snapshotRegion (broken voxels). The one
 * thing that genuinely cannot be undone is a page-level error, so `errors`
 * is a cursor into a page-lifetime log rather than a per-test array.
 *
 * Rejected: a fresh context per test with a warm HTTP cache. It removes the
 * reset code but keeps the expensive part, since terrain meshing is CPU work
 * that no cache helps with.
 */

const worldFixture = [async ({ browser }, use) => {
  const page = await browser.newPage()
  const errors = watchErrors(page)
  await bootWorld(page)
  // Snapshotted here rather than read in the first spec, so "did the world
  // load clean" does not silently depend on file ordering.
  const bootErrors = errors.list()
  await use({ page, errors, bootErrors })
  await page.close()
}, { scope: 'worker' }]

export const test = base.extend({
  world: worldFixture,

  // Auto-used so a test body never has to remember. Reset runs BEFORE, not
  // after: an assertion that fails mid-test would skip an `after` hook and
  // poison every test that followed.
  page: async ({ world }, use) => {
    await resetWorld(world.page)
    await use(world.page)
  },

  errors: async ({ world }, use) => use(world.errors),

  /** Errors seen between navigation and a fully meshed, standing world. */
  bootErrors: async ({ world }, use) => use(world.bootErrors),

  /*
   * Voxel undo. resetWorld deliberately does NOT regenerate terrain -- that
   * would mean re-meshing chunks between every test -- so anything that mines
   * or places registers the box it touched here.
   *
   * A fixture rather than a call at the end of the test body, because teardown
   * still runs when an assertion throws. Several of these tests are expected
   * to fail against the current build, and a failing test that leaks a hole in
   * the island would take the next four down with it.
   */
  /*
   * Flat ground on demand.
   *
   * Real Minecraft terrain has none -- a scan of the whole patch found one
   * flat three-wide corridor longer than ten blocks, made of packed ice, at
   * the map edge. So any test that MEASURES WALKING has to build the surface
   * it measures on. See usePad in helpers/world.js for where and why.
   *
   * A fixture for exactly the reason `terrain` is one: teardown runs even when
   * an assertion throws, and a leaked stone slab hanging at y=199 would be
   * inherited by every test after it.
   */
  flatGround: async ({ page }, use) => {
    let restore = null
    await use({
      async build(opts) {
        restore = await usePad(page, opts)
      },
    })
    if (restore) await restore()
  },

  terrain: async ({ page }, use) => {
    const undos = []
    await use({
      async keep(min, max) { undos.push(await snapshotRegion(page, min, max)) },
    })
    for (const undo of undos.reverse()) await undo()
  },
})

export { expect }
