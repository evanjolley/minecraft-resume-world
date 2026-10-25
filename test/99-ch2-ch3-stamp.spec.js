/*
 * CHAPTERS 2 AND 3 STAMP, AND STAY IN THEIR PLOTS.
 *
 * No game: these run each build against a bare in-memory patch exactly
 * the size its file says it is (`SIZE`), through the real stamper. The
 * stamper already throws on an unknown block key and on a write outside the
 * plot, so "it ran" is most of the assertion; the rest is what the stamper
 * cannot know:
 *
 *   - SIZE is within the sprint's ceiling for a chapter (74 x 76).
 *   - The build leaves the plot's first four rows above ground EMPTY, because
 *     that strip is src/builds/chapters.js's: the marker wall stands at
 *     z 2..3 and it is drawn before the build, so a build that writes there
 *     would be writing over the chapter's own name.
 *   - It placed something, nothing was dug through the bedrock, and it
 *     stands more than twenty blocks tall.
 *
 * Imported from @playwright/test directly, not ./fixtures.js, so no world
 * is booted for a test that never looks at one.
 */
import { test, expect } from '@playwright/test'

const BUILDS = [['ch2', '/src/builds/ch2-science-center.js'], ['ch3', '/src/builds/ch3-bilibili.js']]
const MAX = { w: 74, d: 76 }

/*
 * THE BUILDS ARE STAMPED IN THE BROWSER, not in node, and not because the
 * browser is needed. A build file imports src/signText.js, which imports
 * @babylonjs/core by extensionless deep paths that only a bundler resolves;
 * node refuses them. So the page is pointed at a plain module URL on the dev
 * server (which renders as text and boots no game), and the build is
 * imported into it through vite, the same resolver the game uses.
 */
async function stampInPage(page, url) {
  await page.goto('/src/builds/plots.js')
  return page.evaluate(async (url) => {
    const { stamper } = await import('/src/builds/stamp.js')
    const { GROUND_Y } = await import('/src/builds/plots.js')
    const mod = await import(url)
    const { w, d } = mod.SIZE
    const yMin = GROUND_Y - 4, yTop = GROUND_Y + 64
    const palette = ['air', 'bedrock', 'dirt', 'grass']
    const col = new Uint16Array(yTop - yMin + 1)
    col[0] = 1; col[1] = 2; col[2] = 2; col[3] = 3
    const world = { width: w, depth: d, yMin, yTop, palette, cols: Array(w * d).fill(col) }
    const s = stamper(world, { id: 'test', x0: 0, x1: w - 1, z0: 0, z1: d - 1 })
    let error = null
    try { mod.build(s) } catch (e) { error = String(e && e.message || e) }
    const at = (x, y, z) => palette[world.cols[z * w + x][GROUND_Y + y - yMin]]
    const strip = [], holes = []
    for (let z = 0; z <= 3; z++) for (let x = 0; x < w; x++) for (let y = 0; y <= 8; y++) {
      if (at(x, y, z) !== 'air') strip.push(`(${x}, ${y}, ${z}) ${at(x, y, z)}`)
    }
    let tallest = 0
    for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
      if (at(x, -4, z) === 'air') holes.push([x, z])
      for (let y = 63; y > tallest; y--) if (at(x, y, z) !== 'air') { tallest = y; break }
    }
    return { size: mod.SIZE, error, placed: s.placed, strip, holes, tallest }
  }, url)
}

for (const [id, url] of BUILDS) {
  test(`${id} stamps without throwing and stays in its plot`, async ({ page }) => {
    const r = await stampInPage(page, url)
    // SIZE is a whole plot no bigger than the sprint allows.
    expect(Number.isInteger(r.size.w) && Number.isInteger(r.size.d)).toBe(true)
    expect(r.size.w).toBeLessThanOrEqual(MAX.w)
    expect(r.size.d).toBeLessThanOrEqual(MAX.d)
    // The stamper throws on an unknown key or an out-of-plot write.
    expect(r.error).toBeNull()
    expect(r.placed).toBeGreaterThan(1000)
    // The marker strip (z 0..3) belongs to src/builds/chapters.js.
    expect(r.strip, 'the build wrote into the marker strip').toEqual([])
    // Nothing dug through the bedrock.
    expect(r.holes).toEqual([])
    // And it stands up.
    expect(r.tallest).toBeGreaterThan(20)
  })
}
