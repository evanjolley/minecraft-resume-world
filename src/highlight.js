import { Color3 } from '@babylonjs/core/Maths/math.color'

/*
 * Restyle noa's targeted-block highlight to match Minecraft.
 *
 * noa's default is a white plane at 20% alpha with a white outline, which
 * washes out the block you're looking at and completely buries the breaking
 * crack behind it. Minecraft draws a thin black wireframe and nothing else.
 *
 * The mesh is built lazily the first time you actually look at a block, so
 * this polls until it exists rather than reaching for it at startup.
 *
 * Uses noa.rendering._highlightMesh, which is internal. If a noa upgrade ever
 * renames it this silently stops restyling; the fallback is noa's own look,
 * not a crash.
 */
export function installHighlightStyle(noa) {
  // Named, because noa.on() returns the emitter for chaining -- not the
  // listener -- so there is nothing to hand back to noa.off() otherwise.
  const restyle = () => {
    const mesh = noa.rendering._highlightMesh
    if (!mesh) return

    // noa calls freeze() on this material, which blocks property changes
    // until it's unfrozen.
    mesh.material.unfreeze()
    mesh.material.alpha = 0
    mesh.material.freeze()

    for (const child of mesh.getChildren()) {
      if (child.color) child.color = new Color3(0, 0, 0)
    }
    noa.off('tick', restyle)
  }

  noa.on('tick', restyle)
}
