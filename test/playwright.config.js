import { defineConfig, devices } from '@playwright/test'
import { GL_FLAGS } from './helpers/launch.js'

/*
 * Runner choice: Playwright Test over plain `node:test` + playwright-core.
 * The deciding factor was `webServer` and worker-scoped fixtures -- both of
 * which we would otherwise hand-roll (spawn vite, poll the port, tear it down
 * on every exit path including a crashed test) and both of which are exactly
 * the boilerplate this harness exists to delete.
 *
 * SERIAL, one worker, on purpose. Every spec shares one booted world (see
 * fixtures.js), and the world is global mutable state: two workers means two
 * browsers meshing an 80x80 island under swiftshader at once, which is slower
 * than running them in sequence, not faster.
 */
/*
 * What every project has to agree on, applied AFTER the device spread.
 *
 * `devices['Desktop Safari']` carries `deviceScaleFactor: 2` -- it models a
 * Retina Mac, which is honest and is not what this suite measures. Every
 * screenshot helper in test/helpers/shots.js crops with viewport coordinates,
 * and two specs composite frames together with sharp; at 2x those crops come
 * back 2560x1440 and the composite throws "Image to composite must have same
 * dimensions or smaller". The pixel assertions are about COLOUR, never about
 * resolution, so pinning both engines to 1x compares like with like and costs
 * nothing.
 *
 * Rejected: dropping the device spread entirely. It also supplies
 * `defaultBrowserType`, which is what actually selects the engine.
 */
const FIXED_SURFACE = {
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
}

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.js',

  // Generous because the FIRST boot under software GL is the slow part
  // (chunk generation + meshing); everything after it reuses that page.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  fullyParallel: false,
  workers: 1,

  // A physics measurement that fails should be reported, not re-rolled until
  // it passes. Retries would turn a real regression into a flake.
  retries: 0,

  reporter: [['list']],

  // Traces, error contexts and retained videos default to ./test-results at
  // the repo ROOT, which is not gitignored and is not ours to gitignore.
  // Point them inside the screenshots dir, which ignores itself.
  outputDir: './screenshots/.playwright',

  use: {
    baseURL: 'http://localhost:5173',
    // The surface itself is per-project, since the device descriptors each
    // project spreads would otherwise win over anything set here.
    ...FIXED_SURFACE,
  },

  /*
   * Two engines, because the owner's requirement is "safari and chrome" and
   * for the suite's whole life it has only ever proven things about Chromium.
   *
   * Chromium stays FIRST and stays the default: `npm test` with no --project
   * runs both, and `npm test -- --project=chromium` is the old behaviour
   * exactly. WebKit is Playwright's build of the engine Safari ships, which is
   * the closest thing to Safari that runs headless on a laptop.
   *
   * launchOptions moved OUT of the shared `use` and into the chromium project
   * on purpose: GL_FLAGS are Chromium command-line switches. WebKit's launcher
   * does not parse them -- it either ignores them or refuses to start -- and
   * it does not need them, since its headless WebGL goes through the system
   * Metal/ANGLE path rather than needing a CPU rasteriser bolted on.
   */
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...FIXED_SURFACE,
        launchOptions: { args: GL_FLAGS },
      },
    },
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
        ...FIXED_SURFACE,
        // No launchOptions.args: see above.
      },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    // Reuse a dev server a human already has open, but never in CI, where a
    // stale server would silently test the wrong commit.
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
