import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Material } from '@babylonjs/core/Materials/material'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3, Vector4, Quaternion } from '@babylonjs/core/Maths/math.vector'
import { BLOCK_BY_ID } from './blocks.js'
import { item } from './items.js'
import { cachedItemGeometry, displayFor, itemTexture, itemTextureUrl, loadItemGeometry } from './itemModel.js'
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

/*
 * An empty mesh ready to be handed the extruded geometry of whatever item is
 * selected, with the material an alpha-tested cut-out.
 *
 * ALPHA TEST, not alpha blend. An item sprite is a cut-out -- every pixel is
 * either fully there or not there at all -- and a blended one has to be sorted
 * against itself, which for a mesh that folds back on itself (the rim quads sit
 * between the front and back faces) has no correct answer. itemEntity.js's
 * dropped-item plane blends instead, and gets away with it only because a
 * single flat quad cannot overlap itself.
 *
 * BOTH flags are required and that is the trap. transparencyMode alone gets
 * you #define ALPHATEST in the shader, which reads:
 *
 *     if (alpha < alphaCutOff) discard;
 *
 * but `alpha` there starts life as the material's own alpha -- a flat 1 -- and
 * only picks up the texture's alpha channel under #define ALPHAFROMDIFFUSE,
 * which is what useAlphaFromDiffuseTexture turns on. With one and not the
 * other the test runs, discards nothing, and every item is drawn on an opaque
 * black square. That is exactly what the first screenshot showed.
 *
 * Setting useAlphaFromDiffuseTexture does NOT drag alpha blending back in:
 * StandardMaterial's _disableAlphaBlending is true whenever transparencyMode is
 * OPAQUE or ALPHATEST, so needAlphaBlending stays false and this draws as
 * ordinary opaque geometry that happens to discard fragments.
 *
 * Shared by the first-person viewmodel and the third-person model's fist for
 * the same reason createHeldBlockMesh is: both must show the same object, and
 * one factory is how that stays true.
 */
export function createItemMesh(noa, name) {
  const scene = noa.rendering.getScene()
  const mesh = new Mesh(name, scene)
  const mat = noa.rendering.makeStandardMaterial(`${name}-mat`)
  mat.transparencyMode = Material.MATERIAL_ALPHATEST
  mat.useAlphaFromDiffuseTexture = true
  // The same threshold extrudeSprite uses to decide what is solid, so the
  // silhouette the shader cuts and the silhouette the rim was built around
  // cannot disagree.
  mat.alphaCutOff = 0.5
  mat.specularColor = new Color3(0, 0, 0)
  /*
   * Same emissive floor createSkinMaterial uses, and for the same reason: this
   * scene has one directional light, so a rim quad facing away from it falls to
   * pure black and a diamond axe grows a matte stripe down one edge. Minecraft
   * lights held items with a fixed pair of lights that never let a face go
   * fully dark; this is the cheap equivalent.
   */
  mat.emissiveColor = new Color3(0.45, 0.45, 0.45)
  mesh.material = mat
  mesh.isPickable = false
  mesh.rotationQuaternion = new Quaternion()
  // Same trap as every other mesh here: noa renders from its own selection
  // octree, and a mesh it has never been handed is silently never drawn.
  noa.rendering.addMeshToScene(mesh)
  return mesh
}

/**
 * Point a mesh at an item sprite and pose it with that item's display
 * transform.
 *
 * ONE function for both views, because the transform numbers are the same
 * numbers and only the FRAME differs -- and the frame difference is the part
 * this repo has got wrong twice:
 *
 *   'camera'  the first-person viewmodel. Minecraft's camera space reflected
 *             in Z (its -Z is forward, Babylon's +Z is). Translations keep x
 *             and y and flip z; rotations about X and Y flip sign, about Z do
 *             not. This is the rule heldItem's block cube already follows.
 *
 *   'model'   the third-person fist. playerModel.js builds the player as
 *             Minecraft's model reflected through the ORIGIN -- x, y and z all
 *             negate -- so every translation flips and every rotation angle
 *             carries over untouched. That file says so at length.
 *
 * Both are reflections, which is why the two rules are exact opposites rather
 * than independent: conjugating a rotation by a reflection flips the axes that
 * the reflection did NOT flip. Getting the pair the wrong way round is how you
 * end up with a sword held blade-inward.
 *
 * `units` is the scale of the parent node -- 1 in first person, where the
 * viewmodel hangs off the camera in blocks, and 16 in third person, where
 * everything under an arm pivot is in Minecraft model units.
 *
 * `spin` is an extra rotation about Z folded into the display rotation. Only
 * the third-person caller uses it; see the note there.
 */
export function poseItemMesh(mesh, texture, display, { frame, units = 1, spin = 0 }) {
  texture.hasAlpha = true
  mesh.material.diffuseTexture = texture

  const t = frame === 'model' ? -1 : 1
  const r = -t

  const [tx, ty, tz] = display.translation
  const [rx, ry, rz] = display.rotation

  // Display translations are in model units (1/16 block); the deserializer's
  // 0.0625 multiply is the /16 here.
  mesh.position.set(t * tx * units / 16, t * ty * units / 16, -tz * units / 16)

  /*
   * ItemTransform.apply composes the display rotation as JOML's
   * rotationXYZ(x, y, z) = Rx * Ry * Rz -- X then Y then Z in the local frame.
   * Babylon's q.multiply(p) chains the same way, so this is that product with
   * the mirrored signs substituted. NOT an Euler triple: Babylon applies those
   * in its own fixed order and would put a handheld tool's -90 and 55 in the
   * wrong sequence.
   */
  Quaternion.RotationAxisToRef(AXIS_X, deg(r * rx), qA)
  Quaternion.RotationAxisToRef(AXIS_Y, deg(r * ry), qB)
  qA.multiplyToRef(qB, qC)
  Quaternion.RotationAxisToRef(AXIS_Z, deg(rz + spin), qB)
  qC.multiplyToRef(qB, mesh.rotationQuaternion)

  mesh.scaling.setAll(display.scale * units)
}

/**
 * Give `mesh` the extruded geometry for `url`, and say whether that happened
 * synchronously.
 *
 * False means the sprite is still being fetched and decoded, and the caller
 * must keep the mesh hidden until `then` fires -- an empty Mesh with no vertex
 * data draws as nothing, but it also has no bounding box, which noa's octree
 * does not enjoy.
 */
export function applyItemGeometry(mesh, url, then) {
  const cached = cachedItemGeometry(url)
  if (cached) { cached.applyToMesh(mesh); return true }
  loadItemGeometry(url).then((data) => { data.applyToMesh(mesh); then() })
  return false
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

  /*
   * The viewmodel root: one node holding the hand's PLACE, with the block cube
   * and the item slab hanging off it as siblings.
   *
   * It is literally ItemInHandRenderer.applyItemArmTransform -- the
   * translate(0.56, -0.52, -0.72) that both kinds of held thing share -- so
   * putting it on its own node is not just tidying. The two children diverge
   * immediately after it: a block model carries its own +45 yaw that cancels
   * the swing's trailing -45, and an item model does not.
   *
   * It is also the handle gamemode.js gets. That file snapshots
   * `[held.mesh, ...held.mesh.getChildMeshes()]` ONCE at install and drives
   * `isVisible` on the result, so anything built later would stay visible to a
   * spectator. Returning this node as `held.mesh` is what puts the item slab
   * inside that snapshot -- and is the reason the item mesh is created here and
   * has its geometry swapped, rather than one mesh being created per item type
   * on demand.
   */
  const viewmodel = new TransformNode('viewmodel', scene)
  viewmodel.parent = camera

  const mesh = CreateBox('held', { size: 1, faceUV, wrap: true }, scene)
  mesh.material = noa.rendering.makeStandardMaterial('held-mat')
  mesh.parent = viewmodel
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
   * The non-block item, and the thing this file used to draw nothing at all
   * for: an axe, an ingot, a stick.
   *
   * TWO nodes, because Minecraft's chain does not collapse into one the way
   * the block's does. The swing ends with a rotateY(-45) that the block model's
   * own rotateY(+45) cancels; an item model has no such yaw, so the -45
   * survives and has to be applied BEFORE the item's own display transform.
   * Flattening them would mean recomputing the product every frame.
   *
   *   itemSwing   the arm's motion, shared in spirit with the block cube
   *   itemMesh    the item/generated or item/handheld display transform
   */
  const itemSwing = new TransformNode('held-item-swing', scene)
  itemSwing.parent = viewmodel
  itemSwing.rotationQuaternion = new Quaternion()

  const itemMesh = createItemMesh(noa, 'held-item')
  itemMesh.parent = itemSwing
  itemMesh.renderingGroupId = 1

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
  /*
   * The last two steps of the chain, and the pair that was wrong.
   *
   * translate(5.6, 0, 0) moves to the arm PART's origin, and the part's own
   * geometry then hangs off that: Minecraft's right arm sits at model
   * (-5, 2, 0) with a box spanning (-3..1, -2..10, -2..2), so the box centre
   * is at (-6, 6, 0) and the whole thing lands at 5.6 - 6 = -0.4. Placing the
   * mesh at a bare (5.6, 0, 0) -- the previous code -- dropped the part
   * offset entirely, which is what left only a sliver of shoulder on screen.
   *
   * The 6 is Y-DOWN, and stays that way. Minecraft renders this arm through
   * ModelPart directly, skipping LivingEntityRenderer's scale(-1, -1, 1), so
   * the raw Y-down model coordinates go into the matrix unflipped and the
   * rotateX(200) later in the chain is what brings the arm back upright.
   *
   * Which leaves the shared arm mesh one rotation away from that frame. The
   * mesh is built mirrored in X (playerModel.js, for Babylon's handedness)
   * while this chain is Minecraft's mirrored in Z, and those two differ by
   * exactly a half turn about Z -- so this is a real rotation, not a
   * reflection, and the sleeve's UVs stay the right way round.
   */
  arm.position.set(-0.4, 6, 0)
  arm.rotation.z = Math.PI

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

  /*
   * What is in the hand, as one of exactly three states rather than a boolean.
   *
   * It was a boolean -- `holdingBlock` -- and that is precisely why a tool was
   * invisible: "not a block" collapsed onto "empty hand", and the empty hand
   * draws an arm, so an axe drew an arm holding nothing. Three states, one
   * mesh enabled for each, and the tick below can assert that.
   */
  const EMPTY = 'empty', BLOCK = 'block', ITEM = 'item'
  let mode = EMPTY

  // The sprite currently applied to itemMesh, and whether its geometry has
  // landed. Held separately because the first selection of any item is a
  // network fetch away and the mesh must stay hidden until it resolves.
  let itemUrl = null
  let itemReady = false

  const setHeld = (stack) => {
    const def = stack ? item(stack.id) : null
    if (!def) { mode = EMPTY; return }

    const block = def.places ? BLOCK_BY_ID.get(def.places) : null
    if (block) {
      mode = BLOCK
      mesh.material.diffuseTexture = textureFor(blockTextureUrl(block))
      return
    }

    mode = ITEM
    const url = itemTextureUrl(def)
    poseItemMesh(itemMesh, itemTexture(scene, url), displayFor(def.id, 'firstperson_righthand'),
      { frame: 'camera' })
    // Re-applying identical geometry would re-upload the vertex buffers for
    // nothing, and scrolling the hotbar does this several times a second.
    if (url === itemUrl && itemReady) return
    itemUrl = url
    itemReady = applyItemGeometry(itemMesh, url, () => { if (itemUrl === url) itemReady = true })
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
     * The trailing rotateY(-45) cancels the block model's own +45, leaving
     * rotateY(45 - 20f) -> rotateZ(-20g) -> rotateX(-80g), which at rest is
     * just the 45 from block.json. Composed with quaternions because these
     * are sequential rotations in a moving frame, which Euler angles applied
     * in a fixed order do not reproduce.
     *
     * Signs are mirrored the same way the arm's are: this whole viewmodel is
     * Minecraft's reflected in Z, so rotations about X and Y flip and Z does
     * not. Only the X flip is visible -- a cube is symmetric under a yaw
     * flip, but the 80-degree pitch was tumbling the block toward the camera
     * where Minecraft tumbles it away.
     */
    const p = 1 - swing.value            // Minecraft counts a swing up, we count down
    const f = Math.sin(p * p * Math.PI)
    const g = Math.sin(Math.sqrt(p) * Math.PI)

    // The bob and the hand's resting place are shared by both children, so
    // they live on the root rather than being written twice.
    viewmodel.position.set(REST.x + bx, REST.y + by, REST.z)

    Quaternion.RotationAxisToRef(AXIS_Y, deg(-(45 - 20 * f)), qA)
    Quaternion.RotationAxisToRef(AXIS_Z, deg(-20 * g), qB)
    qA.multiplyToRef(qB, qC)
    Quaternion.RotationAxisToRef(AXIS_X, deg(80 * g), qB)
    qC.multiplyToRef(qB, mesh.rotationQuaternion)

    /*
     * The item's swing is the block's plus the trailing rotateY(-45) that the
     * block model's own +45 cancelled and an item's does not. Mirrored to +45
     * here for the same reason every other Y rotation in this file is: camera
     * space is Minecraft's reflected in Z.
     *
     * The cube's quaternion is already that product, so this costs one more
     * multiply rather than a second chain.
     */
    Quaternion.RotationAxisToRef(AXIS_Y, deg(45), qB)
    mesh.rotationQuaternion.multiplyToRef(qB, itemSwing.rotationQuaternion)

    // Minecraft hides the viewmodel in third person.
    const firstPerson = noa.camera.zoomDistance < 0.5
    mesh.setEnabled(firstPerson && mode === BLOCK)
    itemMesh.setEnabled(firstPerson && mode === ITEM && itemReady)
    armRoot.setEnabled(firstPerson && mode === EMPTY)
    // The arm swings with the same arc as a held block.
    if (mode === EMPTY) setArmPose(p)
  })

  return { mesh: viewmodel, block: mesh, item: itemMesh, arm, get mode() { return mode } }
}
