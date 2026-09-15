import { BLOCK_TYPES } from './blocks.js'
import { itemId } from './items.js'
import { MC } from './physics.js'

/*
 * Buckets: the only way a fluid ever moves by hand.
 *
 * Reported from play alongside the furnace: "need lava bucket to work, need
 * water bucket as well."
 *
 * THE THING TO UNDERSTAND FIRST is that Minecraft has no water item and no
 * lava item. It has three bucket items -- empty, water, lava -- and a fluid
 * exists either as a block in the world or inside one of them. items.js has
 * said so in a comment for a long time (it is why the fluids are filtered out
 * of the block-item list); this is the other half of that sentence.
 *
 * VANILLA'S RULES, from BucketItem (net/minecraft/world/item/BucketItem.java)
 * and minecraft.wiki/w/Bucket:
 *
 *   - An empty bucket picks up a SOURCE block only. Flowing fluid cannot be
 *     bucketed, at all, ever. This is the rule that makes water finite.
 *   - A filled bucket places a source on the face you clicked, and comes back
 *     empty.
 *   - A filled bucket is stacksTo(1). An empty one stacks to 16 (1.11+).
 *   - In creative neither the fill nor the empty changes what you are
 *     holding: `if (player.hasInfiniteMaterials()) return stack` on the way
 *     in, `if (!abilities.instabuild) setItem(emptyBucket)` on the way out.
 *
 * THE SOURCE-ONLY RULE IS LOAD-BEARING RIGHT NOW. Flowing fluids are landing
 * in fluids.js as their own block ids, one per flow level. Everything below
 * keys on "is this id the water source id or the lava source id" rather than
 * on "does this block look fluid-ish", so a flow block is refused by the same
 * code that refuses stone -- correct today, correct when the flow ids arrive,
 * and no reason for this file to ever read fluids.js.
 */

/* The two source ids, read out of the block table by key rather than
 * hardcoded: blocks.js assigns ids positionally and they move when a block is
 * inserted above them. There is no key -> id export to import, which is the
 * only reason this is a find() and not a Map lookup. */
const blockIdOf = (key) => BLOCK_TYPES.find(b => b.key === key).id
export const WATER = blockIdOf('water')
export const LAVA = blockIdOf('lava')

export const EMPTY_BUCKET = itemId('bucket')

/** Filled bucket item -> the source block it pours. */
export const POURS = new Map([
  [itemId('water_bucket'), WATER],
  [itemId('lava_bucket'), LAVA],
])

/** Source block -> the filled bucket scooping it gives you. */
export const SCOOPS = new Map([
  [WATER, itemId('water_bucket')],
  [LAVA, itemId('lava_bucket')],
])

/**
 * Is this block id one a bucket may pick up?
 *
 * The whole "flowing water is not bucketable" rule, in one comparison. A flow
 * block has its own id and is not in this Map, so it answers false without
 * this file knowing flow exists.
 */
export const isSource = (id) => SCOOPS.has(id)

/* How finely the ray is walked, in blocks. A sixteenth is a quarter of a
 * pixel at this scale -- fine enough that no cell corner is ever skipped, and
 * at a 5 block reach that is 80 iterations on a right-click. */
const RAY_STEP = 1 / 16

/**
 * Walk the crosshair ray and report the first thing that stops it.
 *
 * WHY THIS EXISTS AT ALL, since noa already has a raycast: noa's
 * `targetedBlock` is filtered by `blockTargetIdCheck` (blocks.js), and fluids
 * are deliberately not targetable -- you can see the crosshair pass straight
 * through a lake to the sand underneath, which is what you want when you are
 * mining and exactly wrong when you are holding a bucket.
 *
 * Vanilla has the same problem and the same answer: Item.getPlayerPOVHitResult
 * takes a ClipContext.Fluid, and BucketItem passes SOURCE_ONLY when the bucket
 * is empty and NONE when it is full. `stopAtSource` IS that flag.
 *
 * @param {boolean} stopAtSource  true for an empty bucket: a source block ends
 *        the ray. False for a filled one: fluids are passed through entirely,
 *        sources included, exactly as ClipContext.Fluid.NONE does.
 * @returns {null | {kind: 'source'|'block', id: number, position: number[],
 *                   adjacent: number[]}}
 *          `adjacent` is the last cell the ray passed through before it
 *          stopped -- the face you clicked, and where a poured source goes.
 */
export function bucketRay(noa, stopAtSource) {
  const p = noa.ents.getPositionData(noa.playerEntity).position
  /* Sneaking lowers the camera, and a bucket aimed from a sneaking player has
   * to start where the camera is or it disagrees with the crosshair by a
   * third of a block. physics.js owns both numbers. */
  const eye = [p[0], p[1] + (noa.inputs.state.sneak ? MC.SNEAK_EYE_HEIGHT : MC.EYE_HEIGHT), p[2]]

  /* noa's heading gives forward = (sin h, cos h) and its pitch is positive
   * looking DOWN, which is why y is negated. Same conversion as itemEntity's
   * throw -- if one is ever wrong they are both wrong together. */
  const h = noa.camera.heading
  const cp = Math.cos(noa.camera.pitch)
  const dir = [Math.sin(h) * cp, -Math.sin(noa.camera.pitch), Math.cos(h) * cp]

  const reach = noa.blockTestDistance ?? 5
  let prev = [Math.floor(eye[0]), Math.floor(eye[1]), Math.floor(eye[2])]
  for (let t = RAY_STEP; t <= reach; t += RAY_STEP) {
    const cell = [
      Math.floor(eye[0] + dir[0] * t),
      Math.floor(eye[1] + dir[1] * t),
      Math.floor(eye[2] + dir[2] * t),
    ]
    if (cell[0] === prev[0] && cell[1] === prev[1] && cell[2] === prev[2]) continue
    const id = noa.getBlock(cell[0], cell[1], cell[2])
    if (id) {
      if (stopAtSource && isSource(id)) {
        return { kind: 'source', id, position: cell, adjacent: prev }
      }
      /*
       * Anything the crosshair would have stopped on stops the bucket, and it
       * is the SAME predicate the crosshair uses rather than a second opinion
       * -- a bucket that disagreed with the highlight box about where the wall
       * is would be maddening to use. Fluids fail it (they are not solid and
       * have no custom shape), which is what lets the ray swim through them.
       */
      if (noa.blockTargetIdCheck(id)) return { kind: 'block', id, position: cell, adjacent: prev }
    }
    prev = cell
  }
  return null
}

/**
 * Right-click with a bucket.
 *
 * @param noa
 * @param {object} deps inventory, authority, inputLock
 * @returns {object} handles for the console and the test suite
 */
export function installBuckets(noa, { inventory, authority, inputLock }) {
  /**
   * Put a stack in the selected hotbar slot, and deal with the one case that
   * is not a straight swap: an empty bucket that came out of a stack of them.
   *
   * Vanilla's ItemUtils.createFilledResult -- shrink the stack by one, and if
   * anything is left, the filled bucket goes into the inventory rather than
   * into your hand (you are still holding the other fifteen empties).
   */
  const handBack = (stack, id) => {
    if (stack.count > 1) {
      stack.count--
      const left = inventory.add(id, 1)
      // Full inventory: on the floor, the same way closing a crafting grid
      // gets rid of what was in it. itemEntity.js owns `dropper`.
      if (left > 0) inventory.dropper?.(id, left)
    } else {
      inventory.slots[inventory.selected] = { id, count: 1 }
    }
    inventory.emitChange()
  }

  /** Empty bucket on a source: the source goes, the bucket fills. */
  const fill = async () => {
    const hit = bucketRay(noa, true)
    if (!hit || hit.kind !== 'source') return null
    /*
     * `cause: 'break'` and not a fourth cause of its own. Removing a block is
     * removing a block: it is the branch adventure mode has to refuse (vanilla
     * refuses a bucket there for the same reason it refuses a pickaxe), and it
     * is what a server will validate. A `cause: 'bucket'` would be a hole in
     * that check the day somebody forgets to add it.
     *
     * The drop decorator in itemEntity.js sees this too and rolls water's loot
     * table, which is empty -- there is no water ITEM for it to spawn, which
     * is the same fact this whole file is built on.
     */
    const res = await authority.requestBlockChange({ id: 0, position: hit.position, cause: 'break' })
    if (!res.ok) return null
    const stack = inventory.selectedStack()
    // Creative: the world changes, your hand does not.
    if (!authority.caps().infiniteResources && stack) handBack(stack, SCOOPS.get(hit.id))
    return hit
  }

  /** Filled bucket: a source on the face you clicked, and an empty bucket. */
  const pour = async (fluid) => {
    const hit = bucketRay(noa, false)
    if (!hit) return null
    /*
     * The face, not the block. `adjacent` is by construction a cell the ray
     * passed through, so it is air or fluid -- which is also vanilla's rule
     * stated the other way round (place into the clicked block if it is
     * replaceable, else into the face), arrived at by the ray rather than by a
     * replaceability table this world does not have.
     */
    const res = await authority.requestBlockChange({ id: fluid, position: hit.adjacent, cause: 'place' })
    if (!res.ok) return null
    const stack = inventory.selectedStack()
    if (!authority.caps().infiniteResources && stack) {
      // A filled bucket is stacksTo(1), so this is always a straight swap.
      inventory.slots[inventory.selected] = { id: EMPTY_BUCKET, count: 1 }
      inventory.emitChange()
    }
    return { ...hit, placed: hit.adjacent }
  }

  /**
   * The right-click.
   *
   * SUBTLE, and the reason this is a second listener rather than an edit to
   * interact.js: both handlers hear the same 'alt-fire', interact.js's is
   * registered first (main.js constructs it earlier), and it is the one that
   * opens a furnace. Opening a screen takes the inputLock synchronously, so by
   * the time this runs the lock is already held and the guard below returns --
   * which is exactly vanilla's precedence, where using a block beats using the
   * item in your hand unless you are sneaking.
   *
   * The other half of not needing interact.js: a bucket's `places` is 0, so
   * its placement path already does nothing for these items.
   */
  const onUse = async () => {
    if (inputLock.locked) return
    const stack = inventory.selectedStack()
    if (!stack) return
    if (stack.id === EMPTY_BUCKET) return void await fill()
    const fluid = POURS.get(stack.id)
    if (fluid !== undefined) return void await pour(fluid)
  }
  noa.inputs.down.on('alt-fire', onUse)

  return {
    /* For the console and for the test suite. `ray` is the pick on its own,
     * which is how a spec asserts "this refuses flowing water" without having
     * to own a bucket, and fill/pour are the two actions without the input
     * layer in the way. */
    ray: (stopAtSource = true) => bucketRay(noa, stopAtSource),
    fill,
    pour,
    isSource,
    WATER, LAVA,
  }
}
