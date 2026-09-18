import { test, expect } from './fixtures.js'
import { waitTicks, waitFrames, position } from './helpers/world.js'

/*
 * A DROPPED ITEM SPRITE WAS UPSIDE DOWN, AND IT IS THE SAME CHARACTER AGAIN.
 *
 * `invertY` is Babylon's FOURTH constructor argument and has now cost this
 * repo twice. itemModel.js wrote the warning out in full after the first
 * time -- "heldItem.js passes false there for the block atlas, so copying
 * that call would have been the obvious move, and would have uploaded every
 * item sprite upside down" -- and itemEntity.js's sprite branch was that copy,
 * sharing ONE texture cache between the block atlas (whose UVs are cut for
 * invertY false) and item sprites (whose are not).
 *
 * The symptom is a thing you would walk past. A stick lying on the floor is a
 * stick either way up; a pickaxe is held by its blade, and at 0.25 scale from
 * player height you would blame the art. That is exactly why it needs a test
 * and not an eye.
 *
 * TWO CLAIMS, AND THE SECOND IS THE ONE THAT KEEPS IT FIXED:
 *
 *   1. The dropped sprite's texture is uploaded invertY TRUE.
 *   2. The scene holds exactly ONE upload of that PNG once the item has been
 *      both held and dropped. Counted in the SCENE rather than in anybody's
 *      Map, because this repo has shipped a texture-cache test that asserted
 *      a map's size and kept passing when the sharing broke -- a second cache
 *      held the second copy, and only the scene could see both.
 *
 * ...and a third that stops the fix from becoming the next bug: a dropped
 * BLOCK is still invertY false, because the block atlas UVs really do want it.
 * Flipping everything would have swapped which half of the world was wrong.
 */

/** The base mesh one item type's drops are thin instances of. */
const dropTexture = (page, key) => page.evaluate(async (k) => {
  const scene = window.noa.rendering.getScene()
  const mesh = scene.getMeshByName(`drop-${k}`)
  if (!mesh) return null
  const tex = mesh.material?.diffuseTexture ?? null
  if (!tex) return { name: null }
  /*
   * The same module the app is running, because vite serves one copy per URL
   * -- so `itemTexture`'s memo is the app's memo and identity is a real
   * question rather than a comparison of two fresh objects.
   */
  return { name: tex.name, invertY: tex.invertY }
}, key)

/**
 * How many separate Texture objects the scene is holding for one sprite.
 *
 * A COUNT OF UPLOADS, not the size of somebody's Map. This repo has shipped a
 * texture-cache test that asserted a map's size and still passed when the
 * sharing was broken, because a SECOND cache held the second copy. The scene
 * is where both caches end up, so it is the one place that can tell one
 * upload from two.
 */
const uploadsOf = (page, file) => page.evaluate((f) =>
  window.noa.rendering.getScene().textures.filter(t => (t.name ?? '').includes(f)).length,
  file)

/** Put an item in hand, which is what makes heldItem.js upload its sprite. */
const hold = async (page, key) => {
  await page.evaluate((k) => {
    const g = window.game
    g.inventory.slots.fill(null)
    g.inventory.add(g.itemId(k), 1)
    g.inventory.select(0)
    g.inventory.emitChange()
  }, key)
  await waitTicks(page, 2)
  await waitFrames(page, 3)
}

/** @returns how many drops were on the floor the instant after the spawn. */
const dropOne = async (page, key) => {
  const count = await page.evaluate((k) => {
    const g = window.game
    const p = [...window.noa.ents.getPosition(window.noa.playerEntity)]
    g.drops.spawn(g.itemId(k), 1, [p[0], p[1] + 0.3, p[2]], [0, 0, 0], 0.5)
    // Read here rather than after the waits below: the drop is at the
    // player's feet on purpose (it has to be drawn, and an offscreen one may
    // not be) and a pickup is exactly what is meant to happen next.
    return g.drops.count
  }, key)
  // FRAMES, not ticks. itemEntity.js builds a base mesh lazily inside its
  // `beforeRender` handler, so a drop that has never been DRAWN has no mesh
  // and no texture to ask about.
  await waitTicks(page, 2)
  await waitFrames(page, 3)
  return count
}

test.describe('a dropped item sprite is the right way up', () => {
  test('the sprite is invertY true and shares the held item texture',
    async ({ page }) => {
      await position(page)
      // Nothing has been dropped yet, so there is no mesh -- which is the
      // sample: the reading below is of a mesh this test caused to exist.
      expect(await dropTexture(page, 'stick'),
        'a drop-stick mesh existed before anything was dropped').toBeNull()

      // Hold one first, so the HAND's upload exists to be shared. Without
      // this the count assertion below is satisfied by the floor's copy being
      // the only copy, which is not the claim.
      await hold(page, 'stick')
      expect(await uploadsOf(page, 'item/stick.png'),
        'holding a stick uploaded no sprite, so there is nothing to share')
        .toBe(1)

      expect(await dropOne(page, 'stick'),
        'nothing landed on the floor').toBeGreaterThan(0)

      const t = await dropTexture(page, 'stick')
      expect(t, 'dropping a stick built no mesh').not.toBeNull()
      expect(t.name).toContain('item/stick.png')
      /*
       * THE MUTATION. Put the sprite branch back on itemEntity.js's own
       * `textureFor` and this is false, every dropped sprite is mirrored, and
       * nothing else in the suite notices.
       */
      expect(t.invertY,
        'the dropped sprite was uploaded upside down -- invertY again')
        .toBe(true)
      /*
       * ...AND THERE IS STILL ONE UPLOAD. Two Textures for one PNG is the
       * shape the bug had -- itemEntity.js's own cache holding a second copy
       * at the other convention -- so this is the assertion that would have
       * caught it even if the two conventions had happened to agree.
       */
      expect(await uploadsOf(page, 'item/stick.png'),
        'the floor and the hand are two uploads of one PNG')
        .toBe(1)
    })

  test('a dropped BLOCK is still invertY false, which the atlas wants',
    async ({ page }) => {
      await dropOne(page, 'stone')
      const t = await dropTexture(page, 'stone')
      expect(t, 'dropping stone built no mesh').not.toBeNull()
      /*
       * The other side of the rule. A block drop is a cube whose UVs were cut
       * against the atlas for invertY false -- heldItem.js's convention -- so
       * a fix that flipped the whole file would simply have moved the bug.
       */
      expect(t.invertY,
        'the block drop got the item sprite convention and is now the wrong way up')
        .toBe(false)
    })
})
