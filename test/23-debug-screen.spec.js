import { test, expect } from './fixtures.js'
import { shot } from './helpers/shots.js'
import { aim, teleport, waitTicks, look, useGamemode, HEADING, getBlock, ID } from './helpers/world.js'

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

  /*
   * Four cardinals AND the turn direction, because checking only the four is
   * how the mirrored compass shipped: "north reports north" passes perfectly
   * happily on a compass that runs backwards. The turn is the asymmetric test.
   *
   * See the compass note in debugScreen.js: Babylon's scene is left-handed, so
   * facing +Z puts +X on your right, which is where Minecraft puts west. +X
   * therefore reads as WEST here, and the "Towards" axis is the one you can
   * verify by walking rather than the one vanilla prints.
   *
   * Unchanged by the terrain X flip, on purpose. The asset used to be a mirror
   * image of seed 12345 and now is not, but this table never described the
   * terrain -- it describes the renderer, and the renderer did not move.
   */
  test('the four cardinals, in this world\'s frame', async ({ page }) => {
    await press(page, 'F3')

    for (const [heading, name, towards, yaw] of [
      [HEADING.southPlusZ, 'south', 'positive Z', 0],
      [HEADING.westPlusX, 'west', 'positive X', 90],
      [HEADING.northMinusZ, 'north', 'negative Z', 180],
      [HEADING.eastMinusX, 'east', 'negative X', -90],
    ]) {
      await look(page, { heading, pitch: 0 })
      await waitTicks(page, 2)
      const s = await sample(page)
      expect(s.facing).toBe(name)
      expect(s.towards).toBe(towards)
      expect(Math.abs(s.yaw)).toBeCloseTo(Math.abs(yaw), 1)
      if (yaw !== 0 && Math.abs(yaw) !== 180) expect(Math.sign(s.yaw)).toBe(Math.sign(yaw))
    }
  })

  /*
   * THE regression test. Evan found the bug by walking it: "I am looking north,
   * then I turn right, then I'm looking west." Turning right has to run
   * clockwise -- north, east, south, west -- and a mirrored compass runs the
   * other way while every single-direction assertion above still passes.
   *
   * Turning right is heading INCREASING: noa's mouse handler does
   * `heading += dx` and dx is positive for a rightward mouse move.
   */
  test('turning right walks the compass clockwise', async ({ page }) => {
    await press(page, 'F3')

    const clockwise = ['north', 'east', 'south', 'west']
    let heading = HEADING.northMinusZ
    const seen = []
    for (let i = 0; i < 4; i++) {
      await look(page, { heading, pitch: 0 })
      await waitTicks(page, 2)
      seen.push((await sample(page)).facing)
      heading += Math.PI / 2
    }
    expect(seen).toEqual(clockwise)
  })

  /*
   * And the same thing again from the other end: the direction the camera is
   * actually pointing, straight out of noa, has to agree with the cardinal the
   * screen names. This is the one that cannot be satisfied by a consistent-but
   * -mirrored table, because it compares against the look vector itself.
   */
  test('the named cardinal matches the direction the camera points', async ({ page }) => {
    await press(page, 'F3')

    // In this world's frame: north is -Z, south is +Z, west is +X, east is -X.
    const axis = { north: [0, 0, -1], south: [0, 0, 1], west: [1, 0, 0], east: [-1, 0, 0] }
    for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 2.4]) {
      await look(page, { heading, pitch: 0 })
      await waitTicks(page, 2)
      const s = await sample(page)
      const dir = await page.evaluate(() => [...window.noa.camera.getDirection()])
      const want = axis[s.facing]
      // The named cardinal must be the closest axis to where the camera looks,
      // which a mirrored table fails on every heading that is not north/south.
      const dot = dir[0] * want[0] + dir[2] * want[2]
      expect(dot).toBeGreaterThan(0.7)
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
   *
   * `Client Light` LEFT THIS LIST on 2026-09-16 and it is worth saying why,
   * because it is the only entry that has ever come off it. It was here
   * because there was no light engine and the number would have been invented;
   * src/blockLight.js means it is now measured, and the Client Light tests at
   * the foot of this file assert it against the engine's own answer. Server
   * Light stays, because both of its halves would still be invented.
   */
  test('no line is fabricated for data this world does not have', async ({ page }) => {
    await press(page, 'F3')
    const { left, right } = await lines(page)
    const all = [...left, ...right].join('\n')
    for (const absent of ['Biome:', 'Server Light', 'Local Difficulty', 'Java:', 'Day #']) {
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

    /*
     * The F3+G / F3+B shot is taken from a vantage the assertions cannot
     * reach: high above the middle of chunk 0, looking down, in third person.
     * The specs above prove the meshes exist and that the hitbox encloses the
     * player's AABB -- neither proves they are actually DRAWN, and a mesh that
     * never reaches the octree passes both while being invisible.
     */
    // F5 twice is third-person-front; once is third-person-back, which is the
    // one that puts your own hitbox in shot. Creative so the drop from 170
    // does not end in a death screen over the top of the evidence.
    await useGamemode(page, 'creative')
    // Above the canopy and near the middle of chunk 0, looking slightly down.
    // Inside the terrain the cage is mostly behind solid blocks, which is what
    // made the first version of this shot look like nothing had been drawn.
    await teleport(page, 8.5, 172, 8.5)
    await press(page, 'F5')
    await waitTicks(page, 3)
    await aim(page, { heading: 0.6, pitch: 0.25 })

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

/* ------------------------------------------------------------------ *
 * Client Light
 * ------------------------------------------------------------------ */

/*
 * The line that was absent because there was nothing to put in it.
 *
 * debugScreen.js's "WHAT IS CUT, AND WHY" block listed Client/Server Light
 * under "noa has no light engine at all", and src/blockLight.js made that
 * false. These tests are the other half of that correction.
 *
 * TWO THINGS THEY DELIBERATELY DO NOT CLAIM. There is no sky light in this
 * engine, so the sky slot is a dash and the combined value is the block level
 * -- a LOWER BOUND on what vanilla prints at the same spot. And there is no
 * Server Light line to test, because both of its halves would be invented.
 *
 * GLOWSTONE is duplicated from blocks.js for the reason helpers/world.js
 * gives for duplicating the block ids it duplicates.
 */
const GLOWSTONE = 129

test.describe('F3 Client Light', () => {
  test('the line reads vanilla\'s shape, with a dash where sky light would be',
    async ({ page }) => {
      const { left } = await lines(page)
      const light = left.find(l => l.startsWith('Client Light: '))
      /*
       * Vanilla: `Client Light: 15 (15 sky, 0 block)`. The regex pins the
       * punctuation, the word order and the dash -- a line that merely
       * contained the right number in some layout of someone's invention
       * would pass a `toContain` and fail this.
       */
      expect(light, 'no Client Light line on the debug screen')
        .toMatch(/^Client Light: \d+ \(- sky, \d+ block\)$/)
      // And the two numbers are the same number, which is what "no sky light"
      // means arithmetically.
      const [, combined, block] = light.match(/^Client Light: (\d+) \(- sky, (\d+) block\)$/)
      expect(combined).toBe(block)
    })

  test('Server Light is not drawn, because every character of it would be'
    + ' invented', async ({ page }) => {
    const { left, right } = await lines(page)
    expect([...left, ...right].join('\n')).not.toContain('Server Light')
  })

  test('it is the engine\'s own number, at the block the player is standing in',
    async ({ page, terrain }) => {
      /*
       * THE ASSERTION THAT MAKES THIS WORTH HAVING. "There is a number on the
       * screen" passes against a hardcoded 0, and against a number read at
       * the wrong coordinates. So: place a glowstone next to the player, and
       * require the line to agree with window.blockLight.getBlockLight at the
       * player's own block -- and to have MOVED, so a constant cannot pass.
       */
      const before = await sample(page)
      expect(before.light, 'sample() has no light field at all').not.toBeNull()
      expect(before.light.sky, 'a sky light number appeared from somewhere')
        .toBeNull()

      const [bx, by, bz] = before.block
      await terrain.keep([bx - 1, by - 1, bz - 1], [bx + 1, by + 1, bz + 1])
      expect(before.light.block, 'the player was already standing in light')
        .toBe(0)

      await page.evaluate(([i, x, y, z]) => window.noa.setBlock(i, x, y, z),
        [GLOWSTONE, bx + 1, by, bz])
      await waitTicks(page, 3)

      const after = await sample(page)
      const engine = await page.evaluate(([x, y, z]) =>
        window.blockLight.getBlockLight(x, y, z), [bx, by, bz])
      expect(after.light.block,
        `F3 says ${after.light.block}, the engine says ${engine}`).toBe(engine)
      expect(after.light.block, 'the glowstone did not move the number')
        .toBeGreaterThan(before.light.block)

      const { left } = await lines(page)
      expect(left.find(l => l.startsWith('Client Light: ')))
        .toBe(`Client Light: ${engine} (- sky, ${engine} block)`)
    })
})
