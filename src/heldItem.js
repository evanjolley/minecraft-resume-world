import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Vector4 } from '@babylonjs/core/Maths/math.vector'
import { BLOCK_BY_ID } from './blocks.js'
import { createFirstPersonArm, MODEL_SCALE } from './playerModel.js'

/*
 * The first-person hand and held block.
 *
 * This is the single biggest thing separating "a voxel world" from "looks
 * like Minecraft". The block sits low-right, bobs while you walk, and swings
 * when you swing.
 *
 * Two pieces of Babylon knowledge make it work:
 *
 * 1. Parenting to the camera. noa's camera is a real Babylon FreeCamera at
 *    `noa.rendering.camera`, so anything parented to it inherits the camera's
 *    world matrix for free. No per-frame position maths.
 *
 * 2. renderingGroupId = 1. Without it the held block is just geometry sitting
 *    ~1 block from the eye, so walking into a wall makes the wall clip
 *    through your hand. Group 1 renders after group 0 with the depth buffer
 *    cleared, which is exactly how real games draw viewmodels.
 */

/*
 * Minecraft's own numbers, not guesses.
 *
 * The placement comes from ItemInHandRenderer, which translates the held item
 * by (0.56, -0.52, -0.72) for the right hand. Minecraft's -Z is forward while
 * Babylon's +Z is, hence the flipped sign on z.
 *
 * The rotation comes from the vanilla model assets/minecraft/models/block/
 * block.json, whose "firstperson_righthand" display transform is
 * rotation [0, 45, 0]. Yaw only -- no pitch, no roll. Earlier this had a
 * hand-picked tilt on all three axes, which is what made the angle wrong.
//
 * Minecraft's raw offsets assume its own hand projection, which is set up
 * separately from the world camera; dropped straight into ours the block
 * sits half off the bottom-right corner. These keep Minecraft's rotation and
 * relative framing but are pulled in to sit correctly in this projection.
 */
const REST = { x: 0.42, y: -0.30, z: 0.72 }
const SCALE = 0.34
const YAW = Math.PI / 4   // the 45 degrees from block.json

export function installHeldItem(noa, inventory, skinMaterial) {
  const scene = noa.rendering.getScene()
  const camera = noa.rendering.camera

  // Group 1 needs its own depth clear, or the viewmodel z-fights the world.
  scene.setRenderingAutoClearDepthStencil(1, true, true, true)

  /*
   * One box, one texture. Each block type has a pre-baked 3-tile atlas
   * [side | top | bottom], and faceUV maps each of the box's six faces onto
   * the right third of it. Road not taken: a MultiMaterial, which needs
   * hand-built submeshes and six draw calls for one small cube.
   *
   * Babylon's face order is [back, front, right, left, top, bottom].
   */
  const third = 1 / 3
  const faceUV = [
    new Vector4(0, 0, third, 1),           // back   -> side tile
    new Vector4(0, 0, third, 1),           // front  -> side tile
    new Vector4(0, 0, third, 1),           // right  -> side tile
    new Vector4(0, 0, third, 1),           // left   -> side tile
    new Vector4(third, 0, third * 2, 1),   // top    -> top tile
    new Vector4(third * 2, 0, 1, 1),       // bottom -> bottom tile
  ]

  const mesh = CreateBox('held', { size: 1, faceUV, wrap: true }, scene)
  mesh.material = noa.rendering.makeStandardMaterial('held-mat')
  mesh.parent = camera
  mesh.renderingGroupId = 1
  mesh.isPickable = false
  mesh.scaling.setAll(SCALE)

  // REQUIRED. noa installs its own selection octree on the scene, so Babylon
  // picks what to render from that octree rather than from scene.meshes. A
  // mesh built directly in the scene and never registered here is simply
  // never drawn -- no error, no warning, it just isn't there.
  noa.rendering.addMeshToScene(mesh)

  /*
   * The empty hand is the real arm from the player model, sharing the skin
   * material, so a custom skin shows on the hand as well. It was previously a
   * plain white box, which is why holding nothing looked wrong.
   */
  const arm = createFirstPersonArm(noa, skinMaterial)
  arm.parent = camera
  arm.renderingGroupId = 1
  arm.scaling.setAll(MODEL_SCALE)
  arm.position.set(0.62, -0.62, 0.68)
  arm.rotation.set(0.15, 0, -0.22)

  const textures = new Map()
  const textureFor = (path) => {
    if (!textures.has(path)) {
      // NEAREST keeps the pixels crisp; noa does the same for terrain.
      const t = new Texture(path, scene, true, false, Texture.NEAREST_SAMPLINGMODE)
      t.hasAlpha = true
      textures.set(path, t)
    }
    return textures.get(path)
  }

  let holdingBlock = false

  const setHeld = (stack) => {
    const def = stack ? BLOCK_BY_ID.get(stack.id) : null
    holdingBlock = !!def
    if (def) mesh.material.diffuseTexture = textureFor(`/textures/held/${def.key}.png`)
    // Show the block or the bare arm, never both.
    mesh.setEnabled(holdingBlock)
    arm.setEnabled(!holdingBlock)
  }

  inventory.onChange((inv) => setHeld(inv.slots[inv.selected]))

  /*
   * View bob and swing.
   *
   * Bob phase advances with distance travelled, NOT with time. That's the
   * detail that makes it feel right: bobbing on a timer keeps swaying while
   * you stand still, and desyncs from your actual stride when you sprint.
   */
  let bobPhase = 0
  let swing = 0 // 0..1, one full swing arc

  const player = noa.playerEntity
  const body = () => noa.ents.getPhysics(player).body

  noa.on('tick', (dt) => {
    const secs = dt / 1000
    const v = body().velocity
    const speed = Math.hypot(v[0], v[2])

    bobPhase += speed * secs * 2.4
    // Settle back to neutral when standing still rather than freezing
    // mid-sway, which looks broken.
    if (speed < 0.1) bobPhase += (0 - (bobPhase % (Math.PI * 2))) * secs * 4

    if (swing > 0) swing = Math.max(0, swing - secs * 3.2)

    const bobAmount = Math.min(speed / 4.317, 1.3)
    const bx = Math.cos(bobPhase) * 0.022 * bobAmount
    const by = Math.abs(Math.sin(bobPhase)) * -0.026 * bobAmount

    // Minecraft's swing is an arc: the item dips and rotates, then returns.
    // These deltas ride on top of the base transform rather than replacing it.
    const s = Math.sin(swing * Math.PI)
    mesh.position.set(REST.x + bx - s * 0.12, REST.y + by - s * 0.18, REST.z - s * 0.08)
    mesh.rotation.set(
      s * 0.8,
      YAW - s * 0.3,
      Math.cos(bobPhase) * 0.02 * bobAmount,
    )

    // Minecraft hides the viewmodel in third person.
    const firstPerson = noa.camera.zoomDistance < 0.5
    mesh.setEnabled(firstPerson && holdingBlock)
    arm.setEnabled(firstPerson && !holdingBlock)
    // The arm swings with the same arc as a held block.
    arm.position.set(0.62 - s * 0.10, -0.62 - s * 0.16, 0.68 - s * 0.06)
    arm.rotation.set(0.15 + s * 0.9, 0, -0.22)
  })

  return {
    swing: () => { swing = 1 },
    /** Keep swinging while the mine button is held, like Minecraft does. */
    swingIfIdle: () => { if (swing <= 0) swing = 1 },
  }
}
