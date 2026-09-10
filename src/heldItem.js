import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Vector3, Vector4, Quaternion } from '@babylonjs/core/Maths/math.vector'
import { BLOCK_BY_ID } from './blocks.js'
import { createFirstPersonArm } from './playerModel.js'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'

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
 * Traced through Minecraft's actual render chain rather than eyeballed:
 *
 *   ItemInHandRenderer.applyItemArmTransform
 *     translate(0.56, -0.52, -0.72)
 *   ItemRenderer, applying block.json "firstperson_righthand"
 *     scale 0.40, rotate Y 45
 *   ItemRenderer
 *     translate(-0.5, -0.5, -0.5)   // centres the unit cube
 *
 * That last step cancels: a 0..1 cube shifted by -0.5 is centred on the
 * origin, so scale and rotation leave it there. The cube's CENTRE therefore
 * lands exactly on the first translation.
 *
 * Which means the centre sits just below the bottom of the screen -- at
 * z=0.72 with a 70 degree vertical FOV the half-height is 0.504, and y is
 * -0.52. That is correct: in Minecraft you only ever see the top part of the
 * held block. An earlier pass "fixed" this by pulling it into frame, which is
 * what made it look subtly wrong.
 *
 * Minecraft's -Z is forward and Babylon's +Z is, hence the flipped z sign.
 */
const REST = { x: 0.56, y: -0.52, z: 0.72 }
const SCALE = 0.40
const YAW = Math.PI / 4   // the 45 degrees from block.json

const deg = (d) => (d * Math.PI) / 180
const AXIS_X = new Vector3(1, 0, 0)
const AXIS_Y = new Vector3(0, 1, 0)
const AXIS_Z = new Vector3(0, 0, 1)
const qA = new Quaternion()
const qB = new Quaternion()
const qC = new Quaternion()

/*
 * A cube showing one block type, built from that block's pre-baked 3-tile
 * atlas [side | top | bottom] via Babylon faceUV. Shared by the first-person
 * viewmodel and the block held in the third-person model's hand, so both
 * always show the same thing.
 *
 * Babylon's face order is [+Z, -Z, +X, -X, +Y, -Y].
 */
export function createHeldBlockMesh(noa, name) {
  const scene = noa.rendering.getScene()
  const third = 1 / 3
  const faceUV = [
    new Vector4(0, 0, third, 1),
    new Vector4(0, 0, third, 1),
    new Vector4(0, 0, third, 1),
    new Vector4(0, 0, third, 1),
    new Vector4(third, 0, third * 2, 1),
    new Vector4(third * 2, 0, 1, 1),
  ]
  const mesh = CreateBox(name, { size: 1, faceUV, wrap: true }, scene)
  mesh.material = noa.rendering.makeStandardMaterial(`${name}-mat`)
  mesh.isPickable = false
  noa.rendering.addMeshToScene(mesh)
  return mesh
}

export function blockTextureUrl(def) {
  return `/textures/held/${def.key}.png`
}

export function installHeldItem(noa, inventory, skinMaterial, swing) {
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
  // Rotations are composed as quaternions below, so Babylon must be told to
  // use the quaternion rather than the Euler `rotation` vector.
  mesh.rotationQuaternion = new Quaternion()

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
  /*
   * Transcribed from ItemInHandRenderer.renderPlayerArm, which is a chain of
   * transforms rather than a single pose:
   *
   *   translate(0.64, -0.6, -0.72)  rotateY(45)
   *   [scale to model units]
   *   translate(-1, 3.6, 3.5)  rotateZ(120)  rotateX(200)  rotateY(-135)
   *   translate(5.6, 0, 0)
   *
   * That rotateX(200) is the important one: it turns the arm most of the way
   * over so the HAND end points back at the camera. Without it you are
   * looking at the top of the shoulder, which is what this did before.
   *
   * Built as nested TransformNodes because each translation happens in the
   * frame left by the previous rotation -- flattening it into one position
   * and one Euler triple does not reproduce that.
   */
  const armRoot = new TransformNode('fp-arm-root', scene)
  armRoot.parent = camera
  armRoot.position.set(0.64, -0.6, 0.72)
  armRoot.rotation.y = deg(-45)

  const armUnits = new TransformNode('fp-arm-units', scene)
  armUnits.parent = armRoot
  armUnits.scaling.setAll(1 / 16)

  const armPose = new TransformNode('fp-arm-pose', scene)
  armPose.parent = armUnits
  armPose.position.set(-1, 3.6, -3.5)
  armPose.rotationQuaternion = Quaternion.RotationYawPitchRoll(0, 0, 0)

  const arm = createFirstPersonArm(noa, skinMaterial)
  arm.parent = armPose
  arm.renderingGroupId = 1
  arm.position.set(5.6, 0, 0)

  const setArmPose = (swingProgress) => {
    const g = Math.sqrt(swingProgress)
    const k = Math.sin(swingProgress * swingProgress * Math.PI)
    const l = Math.sin(g * Math.PI)

    armRoot.position.set(
      -0.3 * Math.sin(g * Math.PI) + 0.64,
      0.4 * Math.sin(g * Math.PI * 2) - 0.6,
      0.72 - -0.4 * Math.sin(swingProgress * Math.PI),
    )
    armRoot.rotation.y = deg(-(45 + l * 70))
    armRoot.rotation.z = deg(k * -20)

    /*
     * Mirroring the Z axis (Minecraft's -Z forward vs Babylon's +Z) flips the
     * sense of rotations about X and Y, but not Z. Using Minecraft's signs
     * verbatim put the arm in end-for-end: shoulder toward the crosshair,
     * fist off-screen.
     */
    Quaternion.RotationAxisToRef(AXIS_Z, deg(120), qA)
    Quaternion.RotationAxisToRef(AXIS_X, deg(-200), qB)
    qA.multiplyToRef(qB, qC)
    Quaternion.RotationAxisToRef(AXIS_Y, deg(135), qB)
    qC.multiplyToRef(qB, armPose.rotationQuaternion)
  }
  setArmPose(0)

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
    // Visibility is decided ONLY in the tick below, which also knows whether
    // we're in first person. Enabling here made the block flash onto the
    // screen in third person every time the hotbar selection changed.
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


    const bobAmount = Math.min(speed / 4.317, 1.3)
    const bx = Math.cos(bobPhase) * 0.022 * bobAmount
    const by = Math.abs(Math.sin(bobPhase)) * -0.026 * bobAmount

    /*
     * Swing, from ItemInHandRenderer.applyItemArmAttackTransform:
     *
     *   f = sin(p^2 * PI)          g = sin(sqrt(p) * PI)
     *   rotateY(45 - 20f) -> rotateZ(-20g) -> rotateX(-80g) -> rotateY(-45)
     *
     * The trailing rotateY(-45) cancels the model's own +45, so at rest the
     * whole chain is identity and the block just sits there. Composed with
     * quaternions because these are sequential rotations in a moving frame,
     * which Euler angles applied in a fixed order do not reproduce.
     */
    const p = 1 - swing.value            // Minecraft counts a swing up, we count down
    const f = Math.sin(p * p * Math.PI)
    const g = Math.sin(Math.sqrt(p) * Math.PI)

    mesh.position.set(REST.x + bx, REST.y + by, REST.z)
    Quaternion.RotationAxisToRef(AXIS_Y, deg(45 - 20 * f), qA)
    Quaternion.RotationAxisToRef(AXIS_Z, deg(-20 * g), qB)
    qA.multiplyToRef(qB, qC)
    Quaternion.RotationAxisToRef(AXIS_X, deg(-80 * g), qB)
    qC.multiplyToRef(qB, mesh.rotationQuaternion)

    // Minecraft hides the viewmodel in third person.
    const firstPerson = noa.camera.zoomDistance < 0.5
    mesh.setEnabled(firstPerson && holdingBlock)
    armRoot.setEnabled(firstPerson && !holdingBlock)
    // The arm swings with the same arc as a held block.
    if (!holdingBlock) setArmPose(p)
  })

  return { mesh, arm }
}
