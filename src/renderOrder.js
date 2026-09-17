/*
 * WHAT DRAWS OVER WHAT, in one place, because the number on its own is
 * meaningless and three files were each choosing one by looking at the other
 * two.
 *
 * Babylon renders rendering groups in ascending index order and -- this is the
 * part that decides the whole design below -- it CLEARS THE DEPTH BUFFER
 * between them. RenderingManager.render, @babylonjs/core 6.49:
 *
 *   this._depthStencilBufferAlreadyCleaned = index === MIN_RENDERINGGROUPS
 *   ...
 *   const autoClear = this._autoClearDepthStencil[index]      // {autoClear: true} by default
 *   if (autoClear && autoClear.autoClear) this._clearDepthStencilBuffer(...)
 *
 * So "put it in a higher group" does not mean "draw it later against the same
 * scene". It means "draw it later into an EMPTY depth buffer", which is
 * exactly what the first-person hand wants (it can never be clipped by the
 * wall you are standing against) and exactly what a nametag must NOT have,
 * since half of a nametag is a pass that is supposed to LOSE the depth test.
 * Hence `keepDepth` below.
 *
 * The stack, low to high:
 *
 *   0 WORLD     terrain (opaque, then alpha-tested cutouts like leaves), the
 *               entity models, water, the cloud layer. The sky is not in here
 *               at all -- it is scene.clearColor, see sky.js -- which is why
 *               anything drawn anywhere always beats the sky, and why the
 *               clouds are the only sky-coloured thing a tag can lose to.
 *   1 NAMETAG   names, WITH THE WORLD'S DEPTH BUFFER INTACT.
 *   2 HAND      the first-person viewmodel: arm, held block, held item. Above
 *               the names on purpose -- it is the closest thing to the camera
 *               and a name punching through your own hand is worse than the
 *               bug this ordering was written to fix. Gets the depth clear.
 *   3 SCREEN    the underwater tint. A full-screen medium you are looking
 *               THROUGH, so it is above everything including the hand, which
 *               is what vanilla does too.
 *
 * REJECTED -- leaving the nametag in group 0 and fixing its alphaIndex
 * instead. Within one group Babylon sorts transparent meshes by alphaIndex
 * first and distance second, and every other transparent mesh in this world
 * (clouds, water) is on the default Number.MAX_VALUE. Matching that number
 * does not put the tag last, it puts it into the DISTANCE sort -- the same
 * coin flip underwater.js rejected for the same reason. A group is an
 * ordering you can state; an alphaIndex tie is one you have to hope about.
 *
 * REJECTED -- one group per overlay with no shared file, which is what this
 * was. It survives exactly until someone adds a fifth thing and picks 3.
 */

/*
 * AND THERE ARE ONLY FOUR. RenderingManager.MAX_RENDERINGGROUPS is 4, so the
 * ids are 0..3 and the stack below is FULL. A mesh parked on group 4 is not
 * drawn late, it is not drawn AT ALL -- the render loop never reaches it, and
 * the symptom is a mesh that silently disappears with every property still
 * looking correct. (Measured: test/80-nametag-order.spec.js run against
 * `nametag: 4` reports zero pixels of text rather than a misordered tag.)
 * The next overlay that needs a layer has to renumber this table, not append
 * to it.
 */

/** The stack above, as numbers. Lower draws first. */
export const GROUP = {
  world: 0,
  nametag: 1,
  hand: 2,
  screen: 3,
}

/**
 * Hand a group the depth buffer the previous group left behind.
 *
 * Idempotent and safe to call from a factory that runs once per nametag: it
 * writes one entry in the scene's RenderingManager table.
 *
 * `setRenderingAutoClearDepthStencil(id, false)` is the whole thing. The
 * alternative -- an onBeforeRenderingGroupObservable that saves and restores
 * the depth attachment -- does the same job for a frame cost and a lot more
 * code, and Babylon already exposes the flag.
 */
export function keepDepth(scene, group) {
  scene.setRenderingAutoClearDepthStencil(group, false)
}
