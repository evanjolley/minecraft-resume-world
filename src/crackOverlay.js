import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Color3 } from '@babylonjs/core/Maths/math.color'

/*
 * The block-breaking crack overlay.
 *
 * Minecraft draws destroy_stage_0..9 over the block you're mining. The pack
 * ships all ten frames stacked in one 16x160 strip, so this is a single box
 * one hair larger than the block, with the texture's V window scrolled to
 * the current stage.
 *
 * A box (not a plane) is right here: Minecraft cracks every visible face at
 * once, and one box gets all six for free.
 *
 * SUBTLE: noa rebases the world origin as you travel, so raw world
 * coordinates drift away from Babylon's. `noa.globalToLocal` is the required
 * conversion; skipping it works fine near spawn and breaks far from it,
 * which is the worst kind of bug to find later.
 */

const FRAMES = 10

export function installCrackOverlay(noa) {
  const scene = noa.rendering.getScene()

  const tex = new Texture('/textures/crack.png', scene, true, false, Texture.NEAREST_SAMPLINGMODE)
  tex.hasAlpha = true
  // Show one frame's worth of the strip at a time.
  tex.vScale = 1 / FRAMES

  const mat = noa.rendering.makeStandardMaterial('crack-mat')
  // Minecraft's cracks are dark lines. Rather than fight StandardMaterial's
  // shading to force black, crack.png is pre-baked to pure black RGB with its
  // original alpha, so emissive renders black wherever the crack is opaque.
  // Deterministic, and independent of how Babylon combines light terms.
  mat.emissiveTexture = tex
  mat.opacityTexture = tex
  mat.diffuseColor = new Color3(0, 0, 0)
  mat.emissiveColor = new Color3(0, 0, 0)
  mat.specularColor = new Color3(0, 0, 0)
  // THE one that actually mattered. noa's makeStandardMaterial leaves
  // ambientColor white, and Babylon still adds the ambient term even with
  // disableLighting on, which washed the black crack out to light grey no
  // matter what emissive/diffuse were set to.
  mat.ambientColor = new Color3(0, 0, 0)
  mat.disableLighting = true
  mat.backFaceCulling = true
  // Pull it toward the camera so it wins the depth test against the block
  // face it sits on, instead of z-fighting into a shimmering mess.
  mat.zOffset = -6

  const mesh = CreateBox('crack', { size: 1.002 }, scene)
  mesh.material = mat
  mesh.isPickable = false
  mesh.setEnabled(false)

  // REQUIRED. noa installs its own selection octree on the scene, so Babylon
  // picks what to render from that octree rather than from scene.meshes. A
  // mesh built directly in the scene and never registered here is simply
  // never drawn -- no error, no warning, it just isn't there.
  noa.rendering.addMeshToScene(mesh)

  const local = [0, 0, 0]

  return {
    /** @param frac 0..1 break progress; 0 hides the overlay */
    update(frac, blockPos) {
      if (frac <= 0 || !blockPos) { mesh.setEnabled(false); return }

      const stage = Math.min(FRAMES - 1, Math.floor(frac * FRAMES))
      // Babylon's V runs bottom-up while the strip reads top-down, so frame
      // order has to be flipped or mining plays the crack in reverse.
      tex.vOffset = 1 - (stage + 1) / FRAMES

      noa.globalToLocal(blockPos, null, local)
      mesh.position.set(local[0] + 0.5, local[1] + 0.5, local[2] + 0.5)
      mesh.setEnabled(true)
    },
  }
}
