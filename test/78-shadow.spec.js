import { test, expect } from './fixtures.js'
import {
  aim, teleport, waitFrames, waitTicks, settleOnGround, setBlock, getBlock, ID, SURFACE_Y,
} from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * THE DISC UNDER YOUR FEET.
 *
 * noa attaches a shadow component to the player entity at construction and
 * draws it unconditionally. Minecraft does draw entity shadows, but the
 * renderer skips the camera's own entity in first person and the shadow is
 * emitted inside that same per-entity call -- so vanilla's first-person view
 * has nothing under you, and this world's had a hard-edged 30-gon disc.
 *
 * WHAT IS EASY TO GET WRONG HERE, and therefore what this file is written
 * against: a test that asserts "no shadow is visible" passes trivially if it
 * queries the wrong scene, misspells the mesh name, or runs before the
 * component's system has ever enabled the instance. All three failures look
 * exactly like a fix.
 *
 * So the order below is deliberate: THIRD PERSON FIRST, where the disc is
 * supposed to be there, and the count has to come back 1. That is the probe
 * proving it can see a shadow at all. Only then does first person get to
 * claim zero, and by then a zero means something.
 *
 * Rejected: reading `game.perspective` or `hasComponent` as the assertion.
 * Both are the code under test restating itself. The probe walks the Babylon
 * scene and asks what is actually enabled and where it is, which is one
 * remove from the pixels and catches a component that is present but never
 * drawn as readily as one that is absent and drawn anyway.
 */

/*
 * Every shadow instance in the live scene, and how many of them are under the
 * player right now.
 *
 * Positional, not per-entity: `nearPlayer` is what the report is about, and
 * scoping by distance rather than by "is the list empty" means this stays
 * honest the day some other entity in the world gets a shadow of its own.
 *
 * The source disc noa builds once is named `shadow` and never joins the
 * octree; only the per-entity `shadow_instance` copies are drawn, which is
 * why the filter is the longer name.
 */
const shadowProbe = (page) => page.evaluate(() => {
  const { noa } = window
  const scene = noa.rendering.getScene()
  const rpos = noa.ents.getPositionData(noa.playerEntity)._renderPosition
  const instances = scene.meshes.filter((m) => m.name.startsWith('shadow_instance'))
  const enabled = instances.filter((m) => m.isEnabled())
  return {
    instances: instances.length,
    enabled: enabled.length,
    nearPlayer: enabled.filter((m) =>
      Math.hypot(m.position.x - rpos[0], m.position.z - rpos[2]) < 1).length,
    // Reported, never asserted on its own: it is the mechanism, and the
    // assertions above are the effect.
    hasComponent: noa.ents.hasComponent(noa.playerEntity, noa.ents.names.shadow),
  }
})

/** F5 n times, and give the render a frame to catch up. */
async function cycle(page, n) {
  for (let i = 0; i < n; i++) await page.keyboard.press('F5')
  await waitTicks(page, 2)
  await waitFrames(page, 2)
}

test.describe('the player shadow', () => {
  test('is drawn in third person and gone in first', async ({ page }) => {
    await settleOnGround(page)
    await waitTicks(page, 2)

    // 1. THE PROBE PROVING ITSELF. Third person renders you like any other
    //    entity, so there must be exactly one disc under you here. If this
    //    line is 0 the probe is broken and nothing below it means anything.
    await cycle(page, 1)
    expect(await page.evaluate(() => window.game.perspective.mode)).toBe('third-back')
    const third = await shadowProbe(page)
    expect(third.nearPlayer).toBe(1)
    expect(third.hasComponent).toBe(true)

    // 2. THE REPORT. Back to first person: nothing under the camera.
    await cycle(page, 2)
    expect(await page.evaluate(() => window.game.perspective.isFirstPerson)).toBe(true)
    const first = await shadowProbe(page)
    expect(first.nearPlayer).toBe(0)
    expect(first.hasComponent).toBe(false)

    // 3. AND IT COMES BACK. A fix that removed the component once and left it
    //    removed would pass step 2 forever; this is the half that notices.
    await cycle(page, 1)
    expect((await shadowProbe(page)).nearPlayer).toBe(1)
    await cycle(page, 2)
  })

  /*
   * Evidence, not an assertion. Looking straight down is the view the report
   * came from, and the uneven case is the one where noa's flat disc would be
   * most obvious: a 30-gon plate snapped to a single rounded Y cannot follow
   * a step, so half of it would hang in the air over the lower block.
   */
  test('screenshots: looking down, flat and uneven', async ({ page, terrain }) => {
    await settleOnGround(page)
    await aim(page, { pitch: Math.PI / 2 })
    await waitFrames(page, 3)
    await shot(page, '78-first-person-flat')

    // A one-block step for the player to stand half on. terrain.keep undoes
    // it in teardown, so the next spec gets the floor back.
    const [x, , z] = await page.evaluate(() => {
      const p = window.noa.ents.getPosition(window.noa.playerEntity)
      return [Math.floor(p[0]), p[1], Math.floor(p[2])]
    })
    await terrain.keep([x - 2, SURFACE_Y - 1, z - 2], [x + 2, SURFACE_Y + 2, z + 2])
    await setBlock(page, ID.stone, x, SURFACE_Y, z)
    await setBlock(page, ID.stone, x, SURFACE_Y + 1, z)
    await teleport(page, x + 1.0, SURFACE_Y + 3, z + 0.5)
    await settleOnGround(page)
    await aim(page, { pitch: Math.PI / 2 })
    await waitFrames(page, 3)
    await shot(page, '78-first-person-uneven')

    await cycle(page, 1)
    await aim(page, { pitch: (Math.PI / 180) * 35 })
    await waitFrames(page, 3)
    await shot(page, '78-third-person')
    await cycle(page, 2)
  })

  /*
   * WHAT noa's DISC IS NOT, measured rather than asserted in a comment.
   *
   * Vanilla's shadow responds to block light twice over. renderBlockShadow
   * refuses to emit a quad at all where `getMaxLocalRawBrightness(blockPos)`
   * is <= 3, and where it does emit one the alpha is multiplied by that
   * block's brightness:
   *
   *   alpha = clamp((strength * (1 - d^2/256) - 0.5*(entityY - blockY))
   *                 * 0.5 * brightness, 0, 1)
   *
   * (EntityRenderDispatcher.renderShadow / renderBlockShadow, 1.21.8.) So a
   * vanilla shadow fades as the light does and is simply absent in the dark.
   *
   * noa's material is a frozen StandardMaterial with a black diffuse and a
   * hardcoded alpha of 0.5, created inside the component and never handed to
   * `trackEntityLight`, so nothing in this world's lighting can reach it. It
   * subtracts the same half of the ground's brightness in a sealed dark room
   * as it does at noon.
   *
   * This test exists to PIN that divergence, not to call it acceptable. If
   * someone later teaches the disc about light, this is the test that should
   * go red and be rewritten.
   */
  test('the disc ignores block light, where vanilla fades with it', async ({ page, terrain }) => {
    const material = () => page.evaluate(() => {
      const m = window.noa.rendering.getScene().materials
        .find((x) => x.name === 'shadow_component_mat')
      return m ? { alpha: m.alpha, diffuse: m.diffuseColor.asArray() } : null
    })

    await settleOnGround(page)
    await cycle(page, 1)
    await aim(page, { pitch: (Math.PI / 180) * 40 })
    await waitFrames(page, 3)

    // The guard: if the material cannot be found, everything below compares
    // null to null and passes without having looked at anything.
    const lit = await material()
    expect(lit).not.toBeNull()
    expect(lit.alpha).toBeGreaterThan(0)
    await shot(page, '78-third-person-daylight')

    // A sealed stone shell, so the floor inside is at block light 0.
    const [cx, cz] = [12, 12]
    const floor = SURFACE_Y - 1
    const ceil = floor + 4
    await terrain.keep([cx - 3, floor, cz - 3], [cx + 3, ceil, cz + 3])
    await page.evaluate(([x, z, y0, y1, stone, air]) => {
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          for (let y = y0; y <= y1; y++) {
            const shell = Math.abs(dx) === 2 || Math.abs(dz) === 2 || y === y0 || y === y1
            window.noa.setBlock(shell ? stone : air, x + dx, y, z + dz)
          }
        }
      }
    }, [cx, cz, floor, ceil, ID.stone, ID.air])
    await waitTicks(page, 4)
    expect(await getBlock(page, cx, ceil, cz)).toBe(ID.stone)

    await teleport(page, cx + 0.5, floor + 1.5, cz + 0.5)
    await settleOnGround(page)
    await aim(page, { pitch: (Math.PI / 180) * 40 })
    await waitFrames(page, 3)
    const dark = await material()
    await shot(page, '78-third-person-dark')
    await cycle(page, 2)

    // Identical. That is the finding.
    expect(dark).toEqual(lit)
  })

  /*
   * EVAN HAS ONE, and this is the half of the decision that is not about you.
   *
   * Vanilla draws a shadow under every entity it renders, and Evan is never
   * the camera, so the vanilla-shaped answer is that his is always there.
   * `src/npc.js` said `false` -- never decided, just never chosen; the commit
   * that gave him a body (19f974b) passed it as the seventh positional
   * argument and said nothing about it in the message.
   *
   * Asserted and not merely screenshotted, because the alternative reading --
   * "the world simply has no shadows" -- is a coherent position somebody could
   * re-adopt by flipping one word, and this is the line that would argue back.
   */
  test('Evan casts one, because he is never the camera', async ({ page }) => {
    const pos = await page.evaluate(() => [...window.game.aiEvan.position])

    // Local coordinates, matching the meshes: noa rebases the world around
    // the player, so the shadow instance's position is nowhere near the
    // world-space position `aiEvan.position` reports.
    const under = await page.evaluate(() => {
      const { noa } = window
      const rpos = noa.ents.getPositionData(window.game.aiEvan.entity)._renderPosition
      return noa.rendering.getScene().meshes
        .filter((m) => m.name.startsWith('shadow_instance') && m.isEnabled())
        .filter((m) => Math.hypot(m.position.x - rpos[0], m.position.z - rpos[2]) < 1)
        .length
    })
    expect(under).toBe(1)

    await teleport(page, pos[0] + 3.5, pos[1] + 1, pos[2] + 3.5)
    await settleOnGround(page)
    // heading 0 looks along +Z and +PI/2 along +X (helpers/world.js HEADING),
    // so the forward vector is (sin h, cos h) and this is atan2(dx, dz).
    await page.evaluate((p) => {
      const { noa } = window
      const me = noa.ents.getPosition(noa.playerEntity)
      noa.camera.heading = Math.atan2(p[0] - me[0], p[2] - me[2])
      noa.camera.pitch = 0.3
    }, pos)
    await waitFrames(page, 3)
    await shot(page, '78-evan')
  })
})
