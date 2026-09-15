import { test, expect } from './fixtures.js'
import { aim, useGamemode, waitFrames, waitTicks } from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * The empty first-person hand.
 *
 * WHY THIS EXISTS SEPARATELY FROM 15-held-item. That spec asserts the vanilla
 * chain for the held ITEM (`game.held.item`) and the third-person fist. It
 * never touches `game.held.arm`, so it stayed green through two wrong arms.
 * A green 15 tells you the item is placed correctly and says NOTHING about
 * the hand -- which is worth knowing, because that gap is how this bug
 * survived twice.
 *
 * Same method as 15: recompute Minecraft's chain from scratch in plain
 * right-handed arithmetic with no Babylon in sight, then compare it against
 * the world matrix the engine actually built. A screenshot can tell you an
 * arm is drawn. It cannot tell you whether you are looking at the back of the
 * hand or down the length of the forearm, and that distinction is the entire
 * bug.
 */

/* ---------------- Minecraft's maths, reimplemented ---------------- */

/* Right-handed, column vectors, camera looking down -Z. Shares no code and no
 * handedness assumption with the engine, which is the whole point. */
const d = (a) => (a * Math.PI) / 180
const I = () => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
const mul = (A, B) => A.map((r, i) => [0, 1, 2, 3].map(j => [0, 1, 2, 3].reduce((s, k) => s + A[i][k] * B[k][j], 0)))
const T = (x, y, z) => [[1, 0, 0, x], [0, 1, 0, y], [0, 0, 1, z], [0, 0, 0, 1]]
const Rx = (a) => [[1, 0, 0, 0], [0, Math.cos(d(a)), -Math.sin(d(a)), 0], [0, Math.sin(d(a)), Math.cos(d(a)), 0], [0, 0, 0, 1]]
const Ry = (a) => [[Math.cos(d(a)), 0, Math.sin(d(a)), 0], [0, 1, 0, 0], [-Math.sin(d(a)), 0, Math.cos(d(a)), 0], [0, 0, 0, 1]]
const Rz = (a) => [[Math.cos(d(a)), -Math.sin(d(a)), 0, 0], [Math.sin(d(a)), Math.cos(d(a)), 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
const app = (M, v) => [0, 1, 2].map(i => M[i][0] * v[0] + M[i][1] * v[1] + M[i][2] * v[2] + M[i][3])

/*
 * ItemRenderer.renderPlayerArm, verbatim, at swingProgress 0 and
 * equipProgress 0. Read from the MCP-919 decompile:
 * raw.githubusercontent.com/Marcelektro/MCP-919/main/src/minecraft/
 *   net/minecraft/client/renderer/ItemRenderer.java
 *
 *   translate(f, f1, f2)             // all three zero at swingProgress 0
 *   translate(0.64000005, -0.6, -0.71999997)
 *   translate(0, equipProgress * -0.6, 0)
 *   rotate(45, Y)
 *   rotate(f4 * 70, Y)               // zero at rest
 *   rotate(f3 * -20, Z)              // zero at rest
 *   translate(-1.0, 3.6, 3.5)
 *   rotate(120, Z)  rotate(200, X)  rotate(-135, Y)
 *   translate(5.6, 0, 0)
 *   renderRightArm -> ModelRenderer.render(0.0625)
 *
 * EVERY NUMBER ABOVE IS IN BLOCKS. The 1/16 lives inside render(0.0625) and
 * applies only to the arm part, which is what the engine got wrong.
 */
function mcArmMatrix() {
  let M = I()
  M = mul(M, T(0.64000005, -0.6, -0.71999997))
  M = mul(M, Ry(45))
  M = mul(M, T(-1.0, 3.6, 3.5))
  M = mul(M, Rz(120))
  M = mul(M, Rx(200))
  M = mul(M, Ry(-135))
  M = mul(M, T(5.6, 0, 0))
  return M
}

/*
 * The arm box corners, given twice: once as the engine's mesh sees them and
 * once as Minecraft's ModelBiped does, with the correspondence written out
 * rather than assumed.
 *
 * Engine: a plain 4x12x4 box centred on its own origin, so corners (+-2, +-6,
 * +-2) in model units.
 *
 * Minecraft: bipedRightArm.setRotationPoint(-5, 2, 0) and
 * addBox(-3, -2, -2, 4, 12, 4), so relative to the arm part origin the box
 * spans x -8..-4, y 0..12 (Y-DOWN), z -2..2, and its centre is (-6, 6, 0).
 *
 * playerModel.js builds its boxes as Minecraft's reflected through the origin
 * (x, y and z all negate), so an engine-local corner (a, b, c) is the
 * Minecraft corner (-6 - a, 6 - b, -c). Both extremes of every axis appear,
 * so a box that is half a turn out in any axis fails here.
 */
const MESH_CORNERS = []
for (const a of [-2, 2]) for (const b of [-6, 6]) for (const c of [-2, 2]) MESH_CORNERS.push([a, b, c])
const MC_CORNERS = MESH_CORNERS.map(([a, b, c]) => [(-6 - a) / 16, (6 - b) / 16, -c / 16])

/** The engine's arm mesh corners, projected through the camera as the GPU will. */
const projectArm = (page, corners) => page.evaluate((cs) => {
  const mesh = window.game.held.arm
  mesh.computeWorldMatrix(true)
  const m = mesh.getWorldMatrix().multiply(window.noa.rendering.camera.getViewMatrix()).m
  return cs.map(([x, y, z]) => {
    const vx = x * m[0] + y * m[4] + z * m[8] + m[12]
    const vy = x * m[1] + y * m[5] + z * m[9] + m[13]
    const vz = x * m[2] + y * m[6] + z * m[10] + m[14]
    // Babylon's view space is Minecraft's mirrored in z, so dividing by +vz
    // here is dividing by -z there. Same screen point, no sign to get wrong.
    return [vx / vz, vy / vz]
  })
}, corners)

/** Empty the hand and let the render catch up. */
async function emptyHand(page) {
  await page.evaluate(() => {
    const g = window.game
    g.inventory.slots.fill(null)
    g.inventory.select(0)
    g.inventory.emitChange()
  })
  await waitTicks(page, 3)
  await waitFrames(page, 3)
}

/* ---------------- the tests ---------------- */

test.describe('the first-person arm', () => {
  test('matches the Minecraft chain, corner for corner', async ({ page }) => {
    await useGamemode(page, 'creative')
    await aim(page, {})
    await emptyHand(page)
    expect(await page.evaluate(() => window.game.held.mode)).toBe('empty')

    const M = mcArmMatrix()
    const got = await projectArm(page, MESH_CORNERS)
    MC_CORNERS.forEach((v, i) => {
      const p = app(M, v)
      expect(p[2], `corner ${i} must be in front of the camera`).toBeLessThan(0)
      expect(got[i][0], `corner ${MESH_CORNERS[i]} x`).toBeCloseTo(p[0] / -p[2], 3)
      expect(got[i][1], `corner ${MESH_CORNERS[i]} y`).toBeCloseTo(p[1] / -p[2], 3)
    })
  })

  /*
   * The owner's complaint, written as a number: "In real MC I just see the
   * hand. Here I see the bottom of the arm, and the entire arm all the way to
   * the hand."
   *
   * Vanilla's answer is that the SHOULDER end sits well below the bottom edge
   * of the frame while the HAND end sits inside it. The previous
   * implementation scaled the chain's block-unit translations by 1/16, which
   * left the shoulder at screen y -0.70 -- just inside a 0.70 half-height
   * frame -- so the whole limb was on screen. Vanilla puts it at -1.58.
   *
   * This is deliberately a property and not a second copy of the chain: it is
   * the thing a human can look at the screenshot and confirm.
   */
  test('shows the hand, with the shoulder off the bottom of the frame', async ({ page }) => {
    await useGamemode(page, 'creative')
    await aim(page, {})
    await emptyHand(page)

    const { halfHeight, aspect } = await page.evaluate(() => {
      const cam = window.noa.rendering.camera
      const e = cam.getEngine()
      return {
        halfHeight: Math.tan(cam.fov / 2),
        aspect: e.getRenderWidth() / e.getRenderHeight(),
      }
    })

    const got = await projectArm(page, MESH_CORNERS)
    // b = +6 is the shoulder end (Minecraft y=0), b = -6 the hand end (y=12).
    const ys = (b) => MESH_CORNERS.map((c, i) => [c, got[i]]).filter(([c]) => c[1] === b).map(([, p]) => p[1])
    const shoulder = ys(6)
    const hand = ys(-6)

    expect(Math.max(...shoulder), 'every shoulder corner is below the frame')
      .toBeLessThan(-halfHeight)
    expect(Math.max(...hand), 'the hand is inside the frame')
      .toBeGreaterThan(-halfHeight)

    // And it is in the bottom RIGHT, not centred on the crosshair.
    const xs = MESH_CORNERS.map((c, i) => got[i][0])
    expect(Math.min(...xs), 'nothing reaches the middle of the screen')
      .toBeGreaterThan(0.25 * halfHeight * aspect)
  })

  /*
   * The swing is still wired to vanilla's formulas. Two of them share the
   * term sin(sqrt(p) * PI): the arm yaw is -(45 + 70 * that) and the x offset
   * is 0.64 - 0.3 * that. Recovering it from the yaw and predicting the
   * offset checks the pair against each other, which no single reading of one
   * node can do.
   */
  test('the punch still follows the vanilla swing', async ({ page }) => {
    await useGamemode(page, 'creative')
    await aim(page, {})
    await emptyHand(page)

    await page.mouse.down({ button: 'left' })
    const samples = []
    for (let i = 0; i < 5; i++) {
      await waitFrames(page, 2)
      samples.push(await page.evaluate(() => {
        const n = window.noa.rendering.getScene().getTransformNodeByName('fp-arm-root')
        return { y: n.rotation.y, z: n.rotation.z, x: n.position.x }
      }))
    }
    await page.mouse.up({ button: 'left' })
    await waitTicks(page, 12)

    expect(samples.some(s => Math.abs(s.y + Math.PI / 4) > 1e-3), 'the arm must actually move')
      .toBe(true)
    for (const s of samples) {
      const l = (-s.y * 180 / Math.PI - 45) / 70
      expect(s.x, `x offset for yaw ${s.y}`).toBeCloseTo(0.64 - 0.3 * l, 5)
    }
  })

  test('screenshots: empty hand, mid-punch, holding a block, holding a tool',
    async ({ page, errors }) => {
      const since = errors.since()
      await useGamemode(page, 'creative')
      await aim(page, {})

      await emptyHand(page)
      await shot(page, 'fp-arm-empty')

      await page.mouse.down({ button: 'left' })
      await page.waitForTimeout(120)
      await shot(page, 'fp-arm-punching')
      await page.mouse.up({ button: 'left' })
      await waitTicks(page, 12)

      await page.evaluate(() => {
        const g = window.game
        g.inventory.slots.fill(null)
        g.inventory.add(1, 1)
        g.inventory.select(0)
        g.inventory.emitChange()
      })
      await waitTicks(page, 3); await waitFrames(page, 3)
      await shot(page, 'fp-arm-holding-block')

      await page.evaluate(() => {
        const g = window.game
        g.inventory.slots.fill(null)
        g.inventory.add(g.itemId('diamond_axe'), 1)
        g.inventory.select(0)
        g.inventory.emitChange()
      })
      await page.waitForFunction(() => window.game.held.item.getTotalVertices() > 0,
        null, { timeout: 10_000 })
      await waitTicks(page, 3); await waitFrames(page, 3)
      await shot(page, 'fp-arm-holding-tool')

      expect(errors.since(since)).toEqual([])
    })
})
