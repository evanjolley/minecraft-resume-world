import { test, expect } from './fixtures.js'
import { shot } from './helpers/shots.js'
import { aim, teleport, waitTicks, look, HEADING, getBlock, ID } from './helpers/world.js'

/*
 * The F3 debug screen.
 *
 * The temptation with an overlay is to assert that it renders -- count the
 * divs, check it is visible -- and every one of those passes against a screen
 * full of frozen placeholder text. So almost nothing here looks at the DOM.
 * The assertions read `game.debug.sample()`, which is the numbers BEFORE they
 * are formatted, and check that they track the world: move the player, the
 * position moves; turn the camera, the compass turns; look at a block, the
 * targeted block is THAT block and not merely non-null.
 *
 * The formatting is checked separately and only where vanilla's format is
 * load-bearing -- the XYZ line's 3/5/3 decimals and the region-file bracket
 * are the two places a plausible-looking wrong answer is easiest to ship.
 */

const press = async (page, code) => {
  await page.keyboard.down(code)
  await page.keyboard.up(code)
  await waitTicks(page, 2)
}

const sample = (page) => page.evaluate(() => window.game.debug.sample())
const lines = (page) => page.evaluate(() => window.game.debug.lines())
const isOpen = (page) => page.evaluate(() => window.game.debug.isOpen)

/** Close it if a previous test left it open. The fixture's reset does not
 *  know about this overlay, and an open F3 would leak into the next spec. */
test.afterEach(async ({ page }) => {
  if (await isOpen(page)) await press(page, 'F3')
})

test.describe('F3 debug screen', () => {
  test('F3 toggles the overlay, and it starts closed', async ({ page }) => {
    expect(await isOpen(page)).toBe(false)
    await expect(page.locator('#debug')).toBeHidden()

    await press(page, 'F3')
    expect(await isOpen(page)).toBe(true)
    await expect(page.locator('#debug')).toBeVisible()

    await press(page, 'F3')
    expect(await isOpen(page)).toBe(false)
  })

  /*
   * The single most important property of this feature, and the one the brief
   * called out: F3 is an OVERLAY, not a screen. If it took the input lock the
   * player would stop dead every time they checked their coordinates.
   */
  test('F3 does not lock input or stop the world', async ({ page }) => {
    await press(page, 'F3')
    expect(await page.evaluate(() => window.game.inputLock.locked)).toBe(false)

    // And the tick loop is still running: the clock advances.
    const t0 = await page.evaluate(() => window.game.sky.getTime())
    await waitTicks(page, 20)
    const t1 = await page.evaluate(() => window.game.sky.getTime())
    expect(t1).not.toBe(t0)
  })

  /*
   * Vanilla keeps the debug text on screen behind an open inventory, because
   * it is drawn in the HUD pass and screens render after the HUD. Every other
   * overlay in this repo hides itself under `body.inv-open`, so this is the
   * rule that is easiest to add by accident.
   */
  test('the overlay stays visible behind the inventory', async ({ page }) => {
    await press(page, 'F3')
    await press(page, 'KeyE')
    await expect(page.locator('#debug')).toBeVisible()
    await press(page, 'KeyE')
  })

  /* ---------------- the values are live ---------------- */

  test('XYZ tracks the player', async ({ page }) => {
    await press(page, 'F3')

    await teleport(page, 12.5, 150, -7.5)
    await waitTicks(page, 2)
    const a = await sample(page)
    expect(a.position[0]).toBeCloseTo(12.5, 3)
    expect(a.position[2]).toBeCloseTo(-7.5, 3)
    expect(a.block).toEqual([12, Math.floor(a.position[1]), -8])

    await teleport(page, -3.5, 150, 40.5)
    await waitTicks(page, 2)
    const b = await sample(page)
    expect(b.position[0]).toBeCloseTo(-3.5, 3)
    // Floor, not truncate. -3.5 truncates to -3 and floors to -4, and the
    // block you are standing in is -4.
    expect(b.block[0]).toBe(-4)
    expect(b.block[2]).toBe(40)
  })

  /*
   * Chunk and region arithmetic across zero, which is where a `/` where a
   * `>>` belongs stops being invisible. Chunk -1 is block -16..-1, and it is
   * chunk 31 of region -1 -- not chunk -1 of region 0.
   */
  test('chunk and region coordinates are right for negative blocks', async ({ page }) => {
    await press(page, 'F3')
    await teleport(page, -3.5, 150, -20.5)
    await waitTicks(page, 2)

    const s = await sample(page)
    expect(s.chunk[0]).toBe(-1)
    expect(s.chunk[2]).toBe(-2)
    expect(s.region).toEqual([-1, -1])
    expect(s.regionChunk).toEqual([31, 30])
    expect(s.sectionRelative[0]).toBe(12)   // -4 & 15
    expect(s.sectionRelative[2]).toBe(11)   // -21 & 15

    const { left } = await lines(page)
    expect(left.some(l => l.startsWith('Chunk: -1 ')
      && l.endsWith(' -2 [31 30 in r.-1.-1.mca]'))).toBe(true)
  })

  test('Facing names the cardinal and the axis, with vanilla yaw signs', async ({ page }) => {
    await press(page, 'F3')

    for (const [heading, name, towards, yaw] of [
      [HEADING.southPlusZ, 'south', 'positive Z', 0],
      [HEADING.westMinusX, 'west', 'negative X', 90],
      [HEADING.eastPlusX, 'east', 'positive X', -90],
      [HEADING.northMinusZ, 'north', 'negative Z', 180],
    ]) {
      await look(page, { heading, pitch: 0 })
      await waitTicks(page, 2)
      const s = await sample(page)
      expect(s.facing).toBe(name)
      expect(s.towards).toBe(towards)
      expect(Math.abs(s.yaw)).toBeCloseTo(Math.abs(yaw), 1)
      // Minecraft yaw 90 is WEST. noa's heading grows the other way, so this
      // is the sign flip that a compass-less reading gets backwards.
      if (yaw !== 0 && Math.abs(yaw) !== 180) expect(Math.sign(s.yaw)).toBe(Math.sign(yaw))
    }
  })

  test('pitch is positive looking down, like Minecraft', async ({ page }) => {
    await press(page, 'F3')
    await look(page, { heading: 0, pitch: Math.PI / 4 })
    await waitTicks(page, 2)
    expect((await sample(page)).pitch).toBeGreaterThan(40)

    await look(page, { heading: 0, pitch: -Math.PI / 4 })
    await waitTicks(page, 2)
    expect((await sample(page)).pitch).toBeLessThan(-40)
  })

  /*
   * The targeted block has to be the block under the crosshair, not "some
   * block". Aiming straight down at a known column and comparing against
   * noa's own voxel lookup is the only version of this that can fail.
   */
  test('Targeted Block is the block the crosshair is on', async ({ page }) => {
    await press(page, 'F3')
    await teleport(page, 4.5, 138, 0.5)
    await waitTicks(page, 4)
    await aim(page, { heading: 0, pitch: Math.PI / 2 })
    await waitTicks(page, 4)

    const s = await sample(page)
    expect(s.target).not.toBeNull()
    const [x, y, z] = s.target.position
    expect(await getBlock(page, x, y, z)).toBe(s.target.id)
    expect(s.target.id).not.toBe(ID.air)
    expect(typeof s.target.name).toBe('string')

    const { right } = await lines(page)
    expect(right).toContain(`Targeted Block: ${x}, ${y}, ${z}`)
    expect(right).toContain(s.target.name)
  })

  test('Targeted Block disappears when nothing is targeted', async ({ page }) => {
    await press(page, 'F3')
    await teleport(page, 4.5, 175, 0.5)
    await aim(page, { heading: 0, pitch: -Math.PI / 2 })
    await waitTicks(page, 4)

    expect((await sample(page)).target).toBeNull()
    const { right } = await lines(page)
    expect(right.some(l => l.startsWith('Targeted Block'))).toBe(false)
  })

  /* ---------------- vanilla's formatting ---------------- */

  /*
   * Three decimals on X and Z, FIVE on Y. Vanilla's own asymmetry
   * ("4745.761 / 86.00000 / 1638.450"), and the single most commonly
   * approximated thing on this screen.
   */
  test('the XYZ line carries 3 / 5 / 3 decimals', async ({ page }) => {
    await press(page, 'F3')
    await teleport(page, 1.5, 150, -2.5)
    await waitTicks(page, 2)

    const { left } = await lines(page)
    const xyz = left.find(l => l.startsWith('XYZ: '))
    expect(xyz).toMatch(/^XYZ: -?\d+\.\d{3} \/ -?\d+\.\d{5} \/ -?\d+\.\d{3}$/)
  })

  test('the Facing line matches vanilla word for word', async ({ page }) => {
    await press(page, 'F3')
    await look(page, { heading: HEADING.southPlusZ, pitch: 0 })
    await waitTicks(page, 2)

    const { left } = await lines(page)
    const facing = left.find(l => l.startsWith('Facing: '))
    expect(facing).toMatch(/^Facing: south \(Towards positive Z\) \(-?\d+\.\d \/ -?\d+\.\d\)$/)
  })

  test('Section-relative is zero padded to two digits', async ({ page }) => {
    await press(page, 'F3')
    await teleport(page, 1.5, 150, 2.5)
    await waitTicks(page, 2)
    // Only X and Z are asserted: the player is falling under gravity from the
    // teleport, so Y is whatever the tick it was sampled on says.
    const { left } = await lines(page)
    const rel = left.find(l => l.startsWith('Section-relative: '))
    expect(rel).toMatch(/^Section-relative: 01 \d\d 02$/)
  })

  /* ---------------- what is deliberately absent ---------------- */

  /*
   * These are the trims, pinned so that nobody "helpfully" adds a line back
   * with a fabricated value. Biome in particular: the terrain asset carries no
   * per-column biome data, so a Biome line could only ever be a guess.
   */
  test('no line is fabricated for data this world does not have', async ({ page }) => {
    await press(page, 'F3')
    const { left, right } = await lines(page)
    const all = [...left, ...right].join('\n')
    for (const absent of ['Biome:', 'Client Light', 'Server Light', 'Local Difficulty', 'Java:', 'Day #']) {
      expect(all).not.toContain(absent)
    }
    // And nothing is a stub.
    expect(all).not.toMatch(/n\/a|undefined|NaN|null/)
  })

  test('the lines that ARE there are filled in', async ({ page }) => {
    await press(page, 'F3')
    await waitTicks(page, 40)
    const s = await sample(page)

    expect(s.tickRate).toBeGreaterThan(0)
    expect(s.tickMs).toBeGreaterThan(0)
    expect(s.chunks).toBeGreaterThan(0)
    expect(s.entities).toBeGreaterThan(0)
    expect(s.display[0]).toBeGreaterThan(0)
    expect(s.gl.renderer.length).toBeGreaterThan(0)
    expect(s.runtime).toMatch(/\d/)
    // The one texture fact the deploy gate guards, read live rather than
    // copied. It must be 'vanilla' locally.
    expect(s.source).toBe('vanilla')

    const { right } = await lines(page)
    expect(right[0]).toBe('Minecraft 1.21.8 (1.21.8/vanilla)')
  })

  /* ---------------- F3 + key ---------------- */

  test('F3+G toggles chunk borders without toggling the overlay', async ({ page }) => {
    await press(page, 'F3')
    expect(await isOpen(page)).toBe(true)

    await page.keyboard.down('F3')
    await page.keyboard.press('KeyG')
    await page.keyboard.up('F3')
    await waitTicks(page, 3)

    expect(await page.evaluate(() => window.game.debug.chunkBorders)).toBe(true)
    // The whole point of releasing on keyup: a combo must not flash the
    // overlay off on the way past.
    expect(await isOpen(page)).toBe(true)
    expect(await page.evaluate(() =>
      !!window.noa.rendering.getScene().getMeshByName('debug-chunk-border'))).toBe(true)

    await page.keyboard.down('F3')
    await page.keyboard.press('KeyG')
    await page.keyboard.up('F3')
    await waitTicks(page, 3)
    expect(await page.evaluate(() => window.game.debug.chunkBorders)).toBe(false)
    expect(await isOpen(page)).toBe(true)
  })

  test('F3+B toggles hitboxes, drawn from the physics bodies', async ({ page }) => {
    await press(page, 'F3')
    await page.keyboard.down('F3')
    await page.keyboard.press('KeyB')
    await page.keyboard.up('F3')
    await waitTicks(page, 3)

    expect(await page.evaluate(() => window.game.debug.hitboxes)).toBe(true)
    expect(await isOpen(page)).toBe(true)

    /*
     * Not "a mesh exists" -- that passes against a box drawn anywhere. The
     * mesh's bounding box has to contain the player's own collision AABB,
     * which is the thing F3+B is for.
     */
    const fits = await page.evaluate(() => {
      const mesh = window.noa.rendering.getScene().getMeshByName('debug-hitboxes')
      if (!mesh) return null
      /*
       * Raw vertices plus the mesh's own offset, NOT getBoundingInfo(): the
       * bounding box is computed lazily off the world matrix and is a frame
       * stale on a mesh built this tick, which makes the check flaky in
       * exactly the direction that hides a real miss.
       */
      const verts = mesh.getVerticesData('position')
      const origin = mesh.position.asArray()
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
      for (let i = 0; i < verts.length; i += 3) {
        for (let a = 0; a < 3; a++) {
          const v = verts[i + a] + origin[a]
          if (v < lo[a]) lo[a] = v
          if (v > hi[a]) hi[a] = v
        }
      }
      const body = window.noa.ents.getPhysics(window.noa.playerEntity).body
      const off = window.noa.worldOriginOffset
      const eps = 0.02
      return body.aabb.base.every((v, i) => lo[i] <= v - off[i] + eps)
        && body.aabb.max.every((v, i) => hi[i] >= v - off[i] - eps)
    })
    expect(fits).toBe(true)

    await page.keyboard.down('F3')
    await page.keyboard.press('KeyB')
    await page.keyboard.up('F3')
    await waitTicks(page, 3)
    expect(await page.evaluate(() => window.game.debug.hitboxes)).toBe(false)
  })

  /*
   * Evidence, not an assertion. Everything a number can check above is checked
   * with a number; what a screenshot answers is "does this look like F3", which
   * is a question about type size, the grey behind each line and the two
   * columns lining up, and no assertion in this file can honestly answer it.
   */
  test('screenshot: the debug screen', async ({ page }) => {
    await teleport(page, 4.5, 138, 0.5)
    await waitTicks(page, 4)
    await aim(page, { heading: HEADING.southPlusZ, pitch: 0.35 })
    await press(page, 'F3')
    await waitTicks(page, 30)
    await shot(page, 'debug-screen')

    await page.keyboard.down('F3')
    await page.keyboard.press('KeyG')
    await page.keyboard.up('F3')
    await page.keyboard.down('F3')
    await page.keyboard.press('KeyB')
    await page.keyboard.up('F3')
    await waitTicks(page, 10)
    await shot(page, 'debug-screen-borders')
  })
})
