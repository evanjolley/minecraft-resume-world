import { test, expect } from './fixtures.js'
import { look, reloadWorld, settleOnGround, teleport, waitFrames, waitTicks } from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * EVAN'S APPEARANCE: the legacy skin conversion, the cape, and the build that
 * ships without one.
 *
 * Two of these are pixel assertions rather than screenshots on purpose. "The
 * arms are not swapped" is exactly the bug a screenshot makes you squint at
 * and a byte comparison settles: the 64x32 sheet carries ONE arm, and the
 * left one only exists because the build mirrored it. So the test mirrors it
 * back and demands the original.
 *
 * The screenshots are still taken. They are evidence for the parts no number
 * can answer -- whether the face is a face and whether the cape hangs like a
 * cape -- exactly as helpers/shots.js says.
 */

/** Evan stands at x 4.5, z 0.5. Four blocks east of him, looking west. */
const IN_FRONT = [8.5, 0.5]
const LOOK_WEST = Math.atan2(-1, 0)

/** Read an image the page can fetch back out as pixels. */
const sheetProbe = async (page, url) => page.evaluate(async (src) => {
  const img = new Image()
  img.src = src
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const g = c.getContext('2d')
  g.drawImage(img, 0, 0)
  const all = g.getImageData(0, 0, img.width, img.height).data
  const at = (x, y) => [...all.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)]
  const rect = (x, y, w, h) => {
    const out = []
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.push(at(x + i, y + j))
    return out
  }
  const mirrored = (x, y, w, h) => {
    const out = []
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.push(at(x + w - 1 - i, y + j))
    return out
  }
  const minAlpha = (x, y, w, h) => Math.min(...rect(x, y, w, h).map(p => p[3]))
  return {
    width: img.width,
    height: img.height,
    // Left arm regions against the right arm they were mirrored from.
    leftArmFront: rect(36, 52, 4, 12),
    rightArmFrontMirrored: mirrored(44, 20, 4, 12),
    leftArmOuter: rect(40, 52, 4, 12),
    rightArmOuterMirrored: mirrored(40, 20, 4, 12),
    leftLegFront: rect(20, 52, 4, 12),
    rightLegFrontMirrored: mirrored(4, 20, 4, 12),
    // Every base-layer face has to be solid, or the model has holes in it.
    baseAlpha: Math.min(
      minAlpha(0, 8, 32, 8), minAlpha(0, 16, 56, 16),
      minAlpha(16, 48, 16, 16), minAlpha(32, 48, 16, 16)),
  }
}, url)

const modelState = (page) => page.evaluate(() => {
  const { model } = window.game.aiEvan
  const part = (p) => p && {
    pivot: p.pivot.position.asArray(),
    offset: p.box.position.asArray(),
    rotX: p.pivot.rotation.x,
    enabled: p.box.isEnabled(),
    texture: p.box.material?.diffuseTexture?.name ?? null,
    depth: p.box.getBoundingInfo().boundingBox.extendSize.z * 2,
  }
  return {
    parts: Object.fromEntries(Object.entries(model.parts).map(([k, v]) => [k, part(v)])),
    playerTexture: window.game.skinMaterial.diffuseTexture.name,
    sharesPlayerMaterial: model.parts.head.box.material === window.game.skinMaterial,
  }
})

async function standInFront(page) {
  await teleport(page, IN_FRONT[0], 140, IN_FRONT[1])
  await settleOnGround(page)
  await look(page, { heading: LOOK_WEST, pitch: 0.18 })
  await waitFrames(page, 2)
}

test('the NPC wears Evan, the player does not, and the material is per-entity',
  async ({ page }) => {
    const state = await modelState(page)
    expect(state.parts.head.texture).toContain('/skins/evan.png')
    expect(state.playerTexture).toContain('/skins/default.png')
    // Not just different strings -- a different material object. One shared
    // material would mean dressing Evan dressed everyone, which is the whole
    // failure mode that matters once there is more than one body in here.
    expect(state.sharesPlayerMaterial).toBe(false)
  })

test('the legacy 64x32 sheet was converted, not just loaded', async ({ page }) => {
  const s = await sheetProbe(page, '/skins/evan.png')
  expect([s.width, s.height]).toEqual([64, 64])

  /*
   * The left limbs are the mirror of the right ones. If the build skipped the
   * conversion these regions are transparent; if it copied without flipping,
   * or crossed the side faces the way a naive copy does, they are present and
   * WRONG -- which is the version that looks almost right in a screenshot.
   */
  expect(s.leftArmFront).toEqual(s.rightArmFrontMirrored)
  expect(s.leftLegFront).toEqual(s.rightLegFrontMirrored)
  // The outer face of the left arm comes from the OUTER face of the right
  // arm, which sits at a different offset (40,20) than the naive straight
  // copy would use. This is the assertion that catches a swapped side.
  expect(s.leftArmOuter).toEqual(s.rightArmOuterMirrored)

  expect(s.baseAlpha).toBe(255)
})

test('the cape hangs behind him at vanilla\'s resting angle', async ({ page }) => {
  const { parts } = await modelState(page)
  expect(parts.cape).toBeTruthy()
  expect(parts.cape.texture).toContain('/skins/evan-cape.png')

  // CapeLayer's 6 degrees. Not a guess -- see playerModel.js.
  expect(parts.cape.rotX).toBeCloseTo((6 * Math.PI) / 180, 6)
  // Hangs from the neck line (y 24), two units back (z -2, and -Z is behind
  // in this frame because the model faces +Z).
  expect(parts.cape.pivot).toEqual([0, 24, -2])
  expect(parts.cape.depth).toBeCloseTo(1, 6)

  // And it does not intersect the torso it hangs off. The cape's front face
  // and the body's back face are flush at z -2.
  const capeFront = parts.cape.pivot[2] + parts.cape.offset[2] + 0.5
  const bodyBack = parts.body.pivot[2] + parts.body.offset[2] - 2
  expect(capeFront).toBeLessThanOrEqual(bodyBack)
})

test('he looks like Evan from the front, and like a cape from behind',
  async ({ page }) => {
    await standInFront(page)
    await shot(page, 'evan-front')

    /*
     * He always turns to face you (npc.js), so there is no place to stand
     * that shows his back. The yaw is overridden per frame instead -- after
     * the tick that sets it, because a beforeRender handler registered later
     * runs later. Evidence only; nothing is asserted on this.
     */
    await page.evaluate((yaw) => {
      window.__faceAway = () => { window.game.aiEvan.model.root.rotation.y = yaw }
      window.noa.on('beforeRender', window.__faceAway)
    }, LOOK_WEST)
    await waitFrames(page, 3)
    await shot(page, 'evan-back')
    await page.evaluate(() => {
      window.noa.removeListener('beforeRender', window.__faceAway)
      delete window.__faceAway
    })
    await waitTicks(page, 2)
  })

/*
 * THE CAPELESS BUILD.
 *
 * `build-textures.mjs --no-cape` emits Evan's skin and no cape image, which
 * is what a deploy has to be able to ship while the licence question is open
 * (docs/DEPLOYMENT.md). Serving that build, the cape URL 404s.
 *
 * Blocking the request is the same event the browser sees in that build, and
 * it is also what a multiplayer skin server will do for the majority of
 * players, who have no cape. The model must come out capeless and CORRECT,
 * not capeless and missing an arm.
 *
 * Last in the file on purpose: it reloads the shared world twice.
 */
test('a build with no cape image produces a correct capeless Evan',
  async ({ page, errors }) => {
    const mark = errors.mark()
    await page.route('**/skins/evan-cape.png', (route) => route.abort())
    try {
      await reloadWorld(page)
      await waitTicks(page, 3)

      const { parts } = await modelState(page)
      expect(parts.cape).toBeUndefined()
      // The body is untouched: six parts, all drawn, all still wearing Evan.
      expect(Object.keys(parts).sort()).toEqual(
        ['armLeft', 'armRight', 'body', 'head', 'legLeft', 'legRight'])
      for (const p of Object.values(parts)) {
        expect(p.enabled).toBe(true)
        expect(p.texture).toContain('/skins/evan.png')
      }

      await standInFront(page)
      await shot(page, 'evan-capeless')

      // A missing cape is a handled absence, not a crash.
      expect(errors.since(mark).filter(e => e.startsWith('[pageerror]'))).toEqual([])
    } finally {
      await page.unroute('**/skins/evan-cape.png')
      await reloadWorld(page)
    }
  })
