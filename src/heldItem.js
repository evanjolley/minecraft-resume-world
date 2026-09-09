import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Vector4 } from '@babylonjs/core/Maths/math.vector'
import { BLOCK_BY_ID } from './blocks.js'

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
 * Where the block sits in camera space, and how big it is.
 *
 * These two are coupled: apparent size is roughly SCALE/z, so the pair is
 * chosen to hold the on-screen size while pushing the cube AWAY from the eye.
 * Distance matters independently of size because Minecraft renders its
 * viewmodel through a narrower FOV than the world; we can't easily do that
 * with a camera-parented mesh, and a cube held very close to a wide-FOV
 * camera splays out with obvious perspective distortion. Moving it back and
 * scaling it up trades that distortion away for free.
 *
 * x and y scale with z so the block stays pinned in the lower-right corner.
 */
const REST = { x: 0.70, y: -0.61, z: 1.50 }
const SCALE = 0.40

export function installHeldItem(noa, inventory) {
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
    mesh.material.diffuseTexture = def
      ? textureFor(`/textures/held/${def.key}.png`)
      : textureFor('/textures/hand.png')
    // The bare hand reads as a forearm, not a cube: thin, tall, angled in.
    if (holdingBlock) mesh.scaling.setAll(SCALE)
    else mesh.scaling.set(SCALE * 0.55, SCALE * 1.5, SCALE * 0.55)
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
    const s = Math.sin(swing * Math.PI)
    mesh.position.set(REST.x + bx - s * 0.12, REST.y + by - s * 0.16, REST.z - s * 0.06)
    mesh.rotation.set(
      -0.22 + s * 0.9,
      0.55 - s * 0.35,
      0.12 + Math.cos(bobPhase) * 0.02 * bobAmount,
    )

    // Minecraft hides the viewmodel in third person.
    mesh.setEnabled(noa.camera.zoomDistance < 0.5)
  })

  return {
    swing: () => { swing = 1 },
    /** Keep swinging while the mine button is held, like Minecraft does. */
    swingIfIdle: () => { if (swing <= 0) swing = 1 },
  }
}
