/*
 * Cross-engine regressions.
 *
 * The requirement is "this all needs to work in safari and chrome", and until
 * this file existed the whole suite ran on Chromium only -- so every claim it
 * made was a claim about one engine. See docs/browsers.md for the survey these
 * assertions came out of.
 *
 * Everything here is deliberately engine-AGNOSTIC: no `browserName` branches,
 * no skips. A check that only runs on one engine is how the gap got here in
 * the first place. Run it against both:
 *
 *   npm test -- --project=chromium test/43-browsers.spec.js
 *   npm test -- --project=webkit   test/43-browsers.spec.js
 */
import { test, expect } from './fixtures.js'

test.describe('the renderer, on whatever engine this is', () => {
  /*
   * The one that matters. `installTerrainAnimation` declares its layer-remap
   * uniform through the plugin's `getUniforms().fragment` string, which
   * Babylon only injects on the NON-uniform-buffer code path. Chrome takes
   * that path because Babylon's own UA table disables UBOs there; Safari does
   * not, and the terrain fragment shader fails to compile with "'uAnimRemap':
   * undeclared identifier". What that looks like from inside the game is a sky
   * with no ground in it.
   *
   * Asserted on the ERROR LOG rather than on pixels because a failed compile
   * is silent in a screenshot's average colour once you are underground.
   */
  test('no terrain shader fails to compile', async ({ bootErrors }) => {
    const shader = bootErrors.filter(e => /SHADER ERROR|Unable to compile effect/i.test(e))
    expect(shader, shader.slice(0, 3).join('\n')).toHaveLength(0)
  })

  /*
   * The atlas is five paged sampler2DArray layers, and array textures are the
   * WebGL2 feature most likely to be missing or capped low on a given engine.
   * 192 is MAX_PAGE_LAYERS in terrainAnimation.js; the spec floor is 256.
   */
  test('WebGL2 is real and its array textures are deep enough', async ({ page }) => {
    const caps = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2')
      if (!gl) return null
      return {
        layers: gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS),
        size: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        babylon: window.noa.rendering.getScene().getEngine().webGLVersion,
      }
    })
    expect(caps).not.toBeNull()
    expect(caps.babylon).toBe(2)
    expect(caps.layers).toBeGreaterThanOrEqual(256)
    expect(caps.size).toBeGreaterThanOrEqual(4096)
  })

  /*
   * The frame layers are what the remap uniform points AT. If the atlas PNG is
   * short, terrainAnimation.js degrades to identity on purpose -- so this
   * proves the build is animated at all, on this engine, before any test
   * asserts that a frame moved.
   */
  test('the animated atlas layers actually loaded', async ({ page }) => {
    const layer = await page.evaluate(() => ({
      loaded: window.game.terrainAnim.framesLoaded('water_still'),
      water: window.game.terrainAnim.layerOf('water_still'),
    }))
    expect(layer.loaded).toBe(true)
    expect(layer.water).toBeGreaterThan(0)
  })
})

test.describe('the things only one browser has', () => {
  /*
   * performance.memory is Chrome-only and non-standard. debugScreen.js says it
   * OMITS the Mem: line where the API is absent rather than printing zeros.
   * That claim had never been run anywhere the API is absent, which is the
   * only place it can be wrong.
   */
  test('F3 prints a Mem: line exactly where the browser has the API', async ({ page }) => {
    const seen = await page.evaluate(() => {
      // `lines()` renders the same strings the overlay paints without needing
      // it open, which is what 23-debug-screen.spec.js reads too. Toggling it
      // would leave the overlay open for whatever test ran next.
      const { left, right } = window.game.debug.lines()
      const text = [...left, ...right].join('\n')
      return { api: !!performance.memory, mem: /Mem:/.test(text), any: text.length > 0 }
    })
    expect(seen.any).toBe(true)
    expect(seen.mem).toBe(seen.api)
  })

  /*
   * main.js gates boot on a top-level await and vite.config.js moved the build
   * target to es2022 for it. If either half were wrong on this engine the page
   * would never define `game` -- which the fixture already waited for -- so
   * this asserts the language features the target promises rather than the
   * await itself.
   */
  test('the es2022 build target is really available here', async ({ page }) => {
    const ok = await page.evaluate(() => ({
      hasOwn: typeof Object.hasOwn === 'function',
      at: typeof [].at === 'function',
      cause: new Error('x', { cause: 1 }).cause === 1,
      privateFields: (() => {
        class A { #x = 1; static s = 2; get v() { return this.#x } }
        return new A().v === 1 && A.s === 2
      })(),
    }))
    expect(ok).toEqual({ hasOwn: true, at: true, cause: true, privateFields: true })
  })

  /*
   * Every sprite in the HUD is a scaled-up 16px texture, and `pixelated` is
   * what stops the browser smoothing it into mush. `appearance: none` is what
   * stops the platform drawing its own button chrome over the Minecraft one.
   * Both are checked as COMPUTED values on real elements, not with
   * CSS.supports, because a vendor prefix that never applied still "supports".
   */
  test('the pixel-art CSS survives on this engine', async ({ page }) => {
    const counts = await page.evaluate(() => {
      const all = [...document.querySelectorAll('*')]
      return {
        pixelated: all.filter(e => getComputedStyle(e).imageRendering === 'pixelated').length,
        appearance: all.filter(e => getComputedStyle(e).appearance === 'none').length,
      }
    })
    expect(counts.pixelated).toBeGreaterThan(100)
    expect(counts.appearance).toBeGreaterThan(100)
  })
})
