import { defineConfig } from '@playwright/test'
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
    launchOptions: { args: GL_FLAGS },
    // Fixed so screenshot crops (HUD strips, corners) are stable coordinates.
    viewport: { width: 1280, height: 720 },
  },

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
