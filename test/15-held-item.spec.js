import { test, expect } from './fixtures.js'
import {
  aim, useGamemode, waitFrames, waitTicks,
} from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * The held item: a tool, an ingot or a block in the hand, in both views.
 *
 * WHY THE INTERESTING ASSERTIONS ARE ARITHMETIC AND NOT SCREENSHOTS. A
 * screenshot can tell you a sword is drawn. It cannot tell you the sword is
 * drawn where Minecraft draws it, and "looks about right" is exactly how this
 * repo twice ended up with something mounted end-for-end -- Babylon is
 * left-handed, Minecraft's model files are Y-down, and a pose that is half a
 * turn wrong on a cube is invisible.
 *
 * So the two `matches the Minecraft chain` tests below recompute Minecraft's
 * own transform chain from scratch, in plain right-handed arithmetic with no
 * Babylon in sight, and compare it against the world matrix the engine
 * actually built. Every corner of the item, both faces. If those agree, the
 * item is where Minecraft puts it, whatever the screenshot looks like.
 *
 * The screenshots are still taken. They are evidence for the things no number
 * here checks -- that the alpha cut-out is clean, that the extruded rim reads
 * as thickness when the item turns -- and they live in test/screenshots.
 */

/* ---------------- Minecraft's maths, reimplemented ---------------- */

/*
 * Right-handed, column vectors, camera looking down -Z. Deliberately NOT the
 * engine's conventions: the whole value of this check is that it shares no
 * code and no handedness assumption with the thing it is checking.
 */
const d = (x) => (x * Math.PI) / 180
const mul = (A, B) => A.map((r) => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]))
const app = (M, v) => [0, 1, 2].map(i => M[i][0] * v[0] + M[i][1] * v[1] + M[i][2] * v[2])
const Rx = (a) => [[1, 0, 0], [0, Math.cos(d(a)), -Math.sin(d(a))], [0, Math.sin(d(a)), Math.cos(d(a))]]
const Ry = (a) => [[Math.cos(d(a)), 0, Math.sin(d(a))], [0, 1, 0], [-Math.sin(d(a)), 0, Math.cos(d(a))]]
const Rz = (a) => [[Math.cos(d(a)), -Math.sin(d(a)), 0], [Math.sin(d(a)), Math.cos(d(a)), 0], [0, 0, 1]]

/** ItemTransform.apply: rotationXYZ is JOML's Rx * Ry * Rz. */
const display = ({ rotation: [rx, ry, rz] }) => mul(Rx(rx), mul(Ry(ry), Rz(rz)))

/*
 * Every corner of the extruded slab, in Minecraft's item-model space centred on
 * the origin: 16 units across and 16 tall, and one unit (7.5 to 8.5) deep.
 * Both z values are included on purpose -- they are what proves the mesh has
 * real thickness rather than being a flat quad that happens to sit in the right
 * plane.
 */
const CORNERS = []
for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const z of [-1 / 32, 1 / 32]) CORNERS.push([x, y, z])

/** The same corners in the engine's frame: it mirrors Minecraft's Z. */
const MESH_CORNERS = CORNERS.map(([x, y, z]) => [x, y, -z])

/**
 * ItemInHandRenderer, first person, at rest, projected to screen coordinates.
 *
 *   applyItemArmTransform    translate(0.56, -0.52, -0.72)
 *   applyItemArmAttackTransform  identity at swingProgress 0 -- rotateY(45)
 *                            and the trailing rotateY(-45) cancel
 *   ItemTransform.apply      translate(t/16), rotationXYZ(r), scale(s),
 *                            translate(-0.5) [baked into the geometry]
 */
function mcFirstPerson(v, disp) {
  let p = app(display(disp), v.map(c => c * disp.scale))
  p = [p[0] + disp.translation[0] / 16 + 0.56,
       p[1] + disp.translation[1] / 16 - 0.52,
       p[2] + disp.translation[2] / 16 - 0.72]
  return [p[0] / -p[2], p[1] / -p[2]]
}

/**
 * ItemInHandLayer, third person, in the arm pivot's own frame.
 *
 *   translateToHand          leaves the stack at the SHOULDER
 *   rotateX(-90) rotateY(180) translate(1/16, 0.125, -0.625)
 *   ItemTransform.apply      as above
 *
 * then converted into playerModel.js's frame, which is Minecraft's reflected
 * through the origin at 16 model units to the block: x, y, z all negate.
 */
function mcThirdPerson(v, disp) {
  let p = app(display(disp), v.map(c => c * disp.scale))
  p = [p[0] + disp.translation[0] / 16 + 1 / 16,
       p[1] + disp.translation[1] / 16 + 2 / 16,
       p[2] + disp.translation[2] / 16 - 10 / 16]
  p = app(Rx(-90), app(Ry(180), p))
  return p.map(c => -16 * c)
}

/* Verbatim from the vanilla model files. See DISPLAY in src/itemModel.js. */
const GENERATED_FIRST = { rotation: [0, -90, 25], translation: [1.13, 3.2, 1.13], scale: 0.68 }
const HANDHELD_FIRST = GENERATED_FIRST   // handheld.json repeats it unchanged
const GENERATED_THIRD = { rotation: [0, 0, 0], translation: [0, 3, 1], scale: 0.55 }
const HANDHELD_THIRD = { rotation: [0, -90, 55], translation: [0, 4, 0.5], scale: 0.85 }

/* ---------------- driving the world ---------------- */

/** Put one item in the selected slot and wait for its geometry to land. */
async function hold(page, key) {
  await page.evaluate((k) => {
    const g = window.game
    g.inventory.slots.fill(null)
    if (k) g.inventory.add(typeof k === 'number' ? k : g.itemId(k), 1)
    g.inventory.select(0)
    g.inventory.emitChange()
  }, key)
  // The FIRST time any sprite is held its pixels are still being fetched, so
  // this waits on the meshes rather than on a fixed number of ticks.
  await page.waitForFunction(() => {
    const g = window.game
    return g.held.mode !== 'item' || g.held.item.getTotalVertices() > 0
  }, null, { timeout: 10_000, polling: 20 })
  await waitTicks(page, 3)
  await waitFrames(page, 3)
}

/** Which of the three first-person meshes is actually being drawn. */
const drawn = (page) => page.evaluate(() => {
  const h = window.game.held
  return {
    block: h.block.isEnabled(), item: h.item.isEnabled(), arm: h.arm.isEnabled(),
    mode: h.mode,
  }
})

/*
 * The same question for the third-person fist, asked WITHOUT walking the
 * ancestors. In first person perspective.js disables the whole player model, so
 * isEnabled() would answer false for both meshes whatever is selected -- which
 * is correct behaviour and the wrong question. This asks only which of the two
 * the hotbar picked.
 */
const handDrawn = (page) => page.evaluate(() => {
  const h = window.game.perspective.hand
  return { block: h.block.isEnabled(false), item: h.item.isEnabled(false), mode: h.mode }
})

/** Project a mesh's corners through the camera, exactly as the GPU will. */
const projectFirstPerson = (page, corners) => page.evaluate((cs) => {
  const mesh = window.game.held.item
  mesh.computeWorldMatrix(true)
  const m = mesh.getWorldMatrix().multiply(window.noa.rendering.camera.getViewMatrix()).m
  return cs.map(([x, y, z]) => {
    const vx = x * m[0] + y * m[4] + z * m[8] + m[12]
    const vy = x * m[1] + y * m[5] + z * m[9] + m[13]
    const vz = x * m[2] + y * m[6] + z * m[10] + m[14]
    return [vx / vz, vy / vz]
  })
}, corners)

/** The same corners in the right arm pivot's frame, in model units. */
const inArmPivot = (page, corners) => page.evaluate((cs) => {
  const mesh = window.game.perspective.hand.item
  const pivot = window.game.perspective.model.parts.armRight.pivot
  mesh.computeWorldMatrix(true)
  pivot.computeWorldMatrix(true)
  const m = mesh.getWorldMatrix().multiply(pivot.getWorldMatrix().clone().invert()).m
  return cs.map(([x, y, z]) => [
    x * m[0] + y * m[4] + z * m[8] + m[12],
    x * m[1] + y * m[5] + z * m[9] + m[13],
    x * m[2] + y * m[6] + z * m[10] + m[14],
  ])
}, corners)

/** Cycle F5 to a given perspective mode and let the render catch up. */
async function perspective(page, want) {
  for (let i = 0; i < 3 && await page.evaluate(() => window.game.perspective.mode) !== want; i++) {
    await page.keyboard.press('F5')
    await waitTicks(page, 2)
  }
  await waitFrames(page, 3)
  expect(await page.evaluate(() => window.game.perspective.mode)).toBe(want)
}

/* ---------------- the tests ---------------- */

test.describe('the held item', () => {
  test('a non-block item gets a mesh, and the block cube is not drawn', async ({ page }) => {
    await hold(page, 'diamond_axe')
    expect(await drawn(page)).toEqual({ block: false, item: true, arm: false, mode: 'item' })
    // A flat quad would be four vertices. Extrusion means the front and back
    // faces plus a rim quad on every exposed pixel edge.
    expect(await page.evaluate(() => window.game.held.item.getTotalVertices()))
      .toBeGreaterThan(100)
  })

  test('a block, a tool and an empty hand show exactly one thing each', async ({ page }) => {
    const ids = { grass: 1 }
    await hold(page, ids.grass)
    expect(await drawn(page)).toEqual({ block: true, item: false, arm: false, mode: 'block' })

    await hold(page, 'diamond_axe')
    expect(await drawn(page)).toEqual({ block: false, item: true, arm: false, mode: 'item' })

    await hold(page, null)
    expect(await drawn(page)).toEqual({ block: false, item: false, arm: true, mode: 'empty' })

    // Back to a tool, because the bug this replaces was exactly a two-state
    // boolean collapsing "not a block" onto "empty hand".
    await hold(page, 'iron_ingot')
    expect(await drawn(page)).toEqual({ block: false, item: true, arm: false, mode: 'item' })
  })

  test('the extruded mesh is built once per sprite, not per frame', async ({ page }) => {
    await hold(page, 'diamond_axe')
    await hold(page, 'iron_ingot')
    const before = await page.evaluate(() => ({ ...window.game.itemModelStats }))

    // Hold the axe again, then sit through 30 frames of it being drawn.
    await hold(page, 'diamond_axe')
    await waitFrames(page, 30)
    const after = await page.evaluate(() => ({ ...window.game.itemModelStats }))

    expect(after.builds, 'a cached sprite must not be extruded again').toBe(before.builds)
    expect(after.hits).toBeGreaterThan(before.hits)

    // And a sprite never held before is built exactly once.
    await hold(page, 'stick')
    await waitFrames(page, 10)
    expect(await page.evaluate(() => window.game.itemModelStats.builds)).toBe(before.builds + 1)
  })

  test('first person matches the Minecraft chain', async ({ page }) => {
    await useGamemode(page, 'creative')
    await aim(page, {})

    for (const [key, disp] of [['diamond_axe', HANDHELD_FIRST], ['iron_ingot', GENERATED_FIRST]]) {
      await hold(page, key)
      const got = await projectFirstPerson(page, MESH_CORNERS)
      CORNERS.forEach((v, i) => {
        const want = mcFirstPerson(v, disp)
        expect(got[i][0], `${key} corner ${v} x`).toBeCloseTo(want[0], 4)
        expect(got[i][1], `${key} corner ${v} y`).toBeCloseTo(want[1], 4)
      })
    }
  })

  test('third person matches the Minecraft chain', async ({ page }) => {
    for (const [key, disp] of [['diamond_sword', HANDHELD_THIRD], ['iron_ingot', GENERATED_THIRD]]) {
      await hold(page, key)
      const got = await inArmPivot(page, MESH_CORNERS)
      CORNERS.forEach((v, i) => {
        const want = mcThirdPerson(v, disp)
        for (const axis of [0, 1, 2]) {
          expect(got[i][axis], `${key} corner ${v} axis ${axis}`).toBeCloseTo(want[axis], 3)
        }
      })
    }
  })

  /*
   * The failure mode worth a test of its own: handheld and generated share
   * firstperson_righthand verbatim, so in first person a sword really IS held
   * like an ingot. They part company in third person, and if they ever stop
   * doing that it means the model parent stopped being read.
   */
  test('a sword is held along the blade and an ingot is not', async ({ page }) => {
    await hold(page, 'diamond_sword')
    const sword = await inArmPivot(page, MESH_CORNERS)
    await hold(page, 'iron_ingot')
    const ingot = await inArmPivot(page, MESH_CORNERS)
    expect(sword).not.toEqual(ingot)

    // The ingot lies flat across the fist: its 16-unit span runs along the
    // pivot's x and z, and it is thin in y. The sword is turned out of that
    // plane by handheld's -90 yaw and 55 roll, so its span reaches down y.
    const spread = (pts, axis) => Math.max(...pts.map(p => p[axis])) - Math.min(...pts.map(p => p[axis]))
    expect(spread(ingot, 1), 'a generated item is flat in the fist').toBeLessThan(1)
    expect(spread(sword, 1), 'a handheld item stands out of that plane').toBeGreaterThan(8)
  })

  test('the third person fist shows one thing at a time too', async ({ page }) => {
    await hold(page, 1)
    expect(await handDrawn(page)).toEqual({ block: true, item: false, mode: 'block' })
    await hold(page, 'diamond_axe')
    expect(await handDrawn(page)).toEqual({ block: false, item: true, mode: 'item' })
    await hold(page, null)
    expect(await handDrawn(page)).toEqual({ block: false, item: false, mode: 'empty' })
  })

  /*
   * gamemode.js snapshots `[held.mesh, ...held.mesh.getChildMeshes()]` ONCE at
   * install and drives isVisible on the result, so a mesh created later would
   * stay visible to a spectator forever. That is the reason heldItem.js keeps
   * ONE item mesh and swaps its geometry instead of making one per item type,
   * and this is the test that says so out loud.
   */
  test('a spectator holding a tool is invisible', async ({ page }) => {
    await hold(page, 'diamond_axe')
    await useGamemode(page, 'spectator')
    expect(await page.evaluate(() => window.game.held.item.isVisible)).toBe(false)
    await useGamemode(page, 'creative')
    expect(await page.evaluate(() => window.game.held.item.isVisible)).toBe(true)
  })

  test('screenshots: a tool, a flat item, at rest, mid-swing and from behind',
    async ({ page, errors }) => {
      const since = errors.since()
      await useGamemode(page, 'creative')
      await aim(page, {})

      await hold(page, 'diamond_axe')
      await shot(page, 'held-tool-first-person')

      // Mid-swing. The rim quads are only visible while the item turns, which
      // is the frame worth keeping.
      await page.mouse.down({ button: 'left' })
      await page.waitForTimeout(120)
      await shot(page, 'held-tool-swinging')
      await page.mouse.up({ button: 'left' })
      await waitTicks(page, 12)

      await hold(page, 'iron_ingot')
      await shot(page, 'held-ingot-first-person')

      await perspective(page, 'third-back')
      await hold(page, 'diamond_sword')
      await shot(page, 'held-sword-third-person')
      await hold(page, 'iron_ingot')
      await shot(page, 'held-ingot-third-person')
      await perspective(page, 'first')

      expect(errors.since(since)).toEqual([])
    })
})
