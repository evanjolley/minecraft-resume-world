import { createPlayerModel, poseModel } from './playerModel.js'
import { createNametag } from './nametag.js'
import {
  applyItemGeometry, blockTextureUrl, createHeldBlockMesh, createItemMesh, poseItemMesh,
} from './heldItem.js'
import { displayFor, itemTexture, itemTextureUrl } from './itemModel.js'
import { item } from './items.js'
import { MC } from './physics.js'
import { BLOCK_BY_ID } from './blocks.js'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'

/*
 * F5 camera perspectives, and the player model that two of them show.
 *
 * Minecraft cycles three: first person, third person behind, third person in
 * front looking back at you.
 *
 * The front view is the awkward one. noa derives BOTH the view direction and
 * the movement direction from camera.heading, so simply spinning the camera
 * 180 degrees would invert the controls too.
 *
 * The seam is that tick and render are separate phases. receivesInputs reads
 * camera.heading during tick; noa's updateCameraForRender reads it during
 * render, and it runs AFTER the 'beforeRender' event. So heading and pitch
 * are flipped in beforeRender and restored in afterRender: the camera rig
 * mirrors for exactly one frame's render, and movement never sees it.
 */

const AXIS_X = new Vector3(1, 0, 0)
const AXIS_Y = new Vector3(0, 1, 0)

const MODES = ['first', 'third-back', 'third-front']
const THIRD_PERSON_DISTANCE = 4

// Minecraft lets the head lead the body by roughly 50 degrees before the
// body starts turning to follow.
const MAX_HEAD_TURN = (50 * Math.PI) / 180

/** Shortest signed angle from a to b, so turning never takes the long way. */
function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

export function installPerspective(noa, { skinMaterial, inputLock, inventory, swing, roster = null }) {
  const model = createPlayerModel(noa, skinMaterial)
  const player = noa.playerEntity

  /*
   * YOUR OWN NAMETAG.
   *
   * It lives here rather than in nametag.js's caller because this file is
   * already the one thing that knows both where the model is THIS FRAME
   * (interpolated -- see the beforeRender at the bottom) and whether the
   * model is drawn at all. Both matter: a tag placed on tick judders against
   * a smoothly-moving body, and a tag left enabled in first person hangs in
   * front of your face, which is exactly the bug the `model.root.setEnabled`
   * line below exists to avoid for the body.
   *
   * Vanilla does not draw your own name in any perspective. See the
   * divergence note at the bottom of nametag.js for why this one does.
   */
  const localId = roster?.local?.id ?? null
  const nametag = roster
    ? createNametag(noa, {
      // The name, undecorated. A rank is a chat format, not a nameplate.
      text: roster.displayNameOf(localId), height: MC.PLAYER_HEIGHT, name: 'nametag-local',
    })
    : null
  roster?.onChange((changed) => {
    if (changed.id === localId) nametag?.setText(roster.displayName(changed))
  })

  let mode = 0
  let limbSwing = 0
  let limbSwingAmount = 0
  let bodyYaw = 0

  /*
   * The block in the model's hand. Parented to the right arm's pivot so it
   * inherits the swing and walk animation for free.
   *
   * Placement is the whole of Minecraft's chain, not just block.json, which
   * is why it used to float beside the fist. ItemInHandLayer.renderArmWithItem
   * starts at the SHOULDER (translateToHand gives the arm's pivot, not its
   * hand) and works down from there:
   *
   *   rotateX(-90)  rotateY(180)  translate(1, 2, -10)   [model units]
   *   block.json thirdperson_righthand: translate(0, 2.5, 0),
   *     rotate [75, 45, 0], scale 0.375
   *
   * Multiplied out and mirrored into this model's frame (x, y, z all negate,
   * see playerModel.js) that is a 6-unit cube centred 1 out, 10 down and 4.5
   * forward of the shoulder -- in the fist, poking out in front of it -- and
   * the four rotations collapse to X 15 then Y 135.
   */
  const handBlock = createHeldBlockMesh(noa, 'hand-block')
  handBlock.parent = model.parts.armRight.pivot
  handBlock.scaling.setAll(6)
  handBlock.position.set(1, -10, 4.5)
  // Composed as quaternions: X-then-Y is not an order Babylon's Euler
  // triple can express, since it applies Y first.
  handBlock.rotationQuaternion = Quaternion.RotationAxis(AXIS_X, (15 * Math.PI) / 180)
    .multiply(Quaternion.RotationAxis(AXIS_Y, (135 * Math.PI) / 180))

  /*
   * The non-block item in the same fist, and the half of this that decides
   * whether a sword reads as a sword.
   *
   * Built as a chain of nodes rather than one collapsed pose, because the chain
   * is what the numbers came from. ItemInHandLayer.renderArmWithItem, starting
   * at the arm's pivot (translateToHand gives the SHOULDER, not the hand):
   *
   *   rotateX(-90)  rotateY(180)  translate(1/16, 0.125, -0.625)
   *
   * which is (1, 2, -10) in model units, then the item's own display transform.
   * Converted into this model's frame by playerModel.js's rule -- x, y and z
   * all negate, rotation angles carry over unchanged -- so the two rotations
   * stand as written and the offset becomes (-1, -2, 10).
   *
   * The same conversion applied to the BLOCK's chain reproduces the (1, -10,
   * 4.5) that handBlock above was hand-derived to, which is the check that this
   * is the right conversion rather than a plausible one.
   */
  const handAxis = new TransformNode('hand-item-axis', noa.rendering.getScene())
  handAxis.parent = model.parts.armRight.pivot
  handAxis.rotation.x = (-90 * Math.PI) / 180

  const handTurn = new TransformNode('hand-item-turn', noa.rendering.getScene())
  handTurn.parent = handAxis
  handTurn.rotation.y = Math.PI

  const handOffset = new TransformNode('hand-item-offset', noa.rendering.getScene())
  handOffset.parent = handTurn
  handOffset.position.set(-1, -2, 10)

  const handItem = createItemMesh(noa, 'hand-item')
  handItem.parent = handOffset

  /*
   * THE half turn, and it is not a fudge.
   *
   * One extruded mesh serves both views, and it is built in the first-person
   * frame -- Minecraft's camera space reflected in Z. This frame is Minecraft's
   * model space reflected through the origin. Compose the two reflections and
   * you get diag(-1, -1, 1): a rotation of 180 degrees about Z, not a
   * reflection, so the sprite stays the right way round and only its footing
   * changes. Folded into the display rotation because both are about Z.
   *
   * Drop it and every item is held upside down and end-for-end.
   *
   * Which is exactly the trap the block cube next door walked into and got away
   * with. Run this derivation on block.json's thirdperson_righthand and the
   * result differs from handBlock's hand-derived pose by precisely a half turn
   * about Y -- and a cube whose four sides all sample the same atlas tile is
   * symmetric under a 180 degree yaw, so both look perfect. handBlock is left
   * alone because it IS perfect; the moral is only that a pose checked by eye
   * on a cube proves nothing about a sword.
   */
  const MODEL_FRAME_SPIN = 180

  const handTextures = new Map()
  const handTexture = (url) => {
    if (!handTextures.has(url)) {
      const t = new Texture(url, noa.rendering.getScene(), true, false,
        Texture.NEAREST_SAMPLINGMODE)
      t.hasAlpha = true
      handTextures.set(url, t)
    }
    return handTextures.get(url)
  }

  /*
   * Same three states heldItem.js tracks, for the same reason: "not a block" is
   * not "empty hand", and conflating them is what made tools invisible. Held as
   * a variable rather than read off the meshes because the geometry for a
   * never-before-held item arrives a frame later, and the callback that
   * finishes it has to know whether the hand has moved on since.
   */
  let handMode = 'empty'
  let handUrl = null
  let handItemReady = false

  inventory.onChange((inv) => {
    const stack = inv.slots[inv.selected]
    const def = stack ? item(stack.id) : null
    // `!def.flat` -- a torch places a block and is held as a sprite anyway,
    // which is vanilla's rule about item models. See items.js.
    const block = def?.places && !def.flat ? BLOCK_BY_ID.get(def.places) : null

    handMode = block ? 'block' : def ? 'item' : 'empty'
    handBlock.setEnabled(handMode === 'block')
    if (handMode !== 'item') { handItem.setEnabled(false) }
    if (handMode === 'block') {
      handBlock.material.diffuseTexture = handTexture(blockTextureUrl(block))
      return
    }
    if (handMode === 'empty') return

    const url = itemTextureUrl(def)
    poseItemMesh(handItem, itemTexture(noa.rendering.getScene(), url), displayFor(def.id, 'thirdperson_righthand'),
      { frame: 'model', units: 16, spin: MODEL_FRAME_SPIN })
    if (url !== handUrl || !handItemReady) {
      handUrl = url
      handItemReady = applyItemGeometry(handItem, url, () => {
        if (handUrl !== url) return
        handItemReady = true
        handItem.setEnabled(handMode === 'item')
      })
    }
    handItem.setEnabled(handItemReady)
  })

  const apply = () => {
    const third = mode !== 0
    noa.camera.zoomDistance = third ? THIRD_PERSON_DISTANCE : 0
    // The model is hidden in first person: from inside, you would be looking
    // at the interior faces of your own head. The nametag goes with it, for
    // the same reason and more so -- it sits 2.3 blocks up, which in first
    // person is a dark box directly above your eyeline.
    model.root.setEnabled(third)
    nametag?.setEnabled(third)
  }

  document.addEventListener('keydown', (e) => {
    if (e.code !== 'F5' || inputLock.locked) return
    // F5 is "refresh" to the browser, so this has to be claimed explicitly.
    e.preventDefault()
    mode = (mode + 1) % MODES.length
    apply()
  })
  apply()

  /*
   * Front view. Flipping heading by 180 and negating pitch swings the whole
   * rig around the player, so the camera -- which noa parks at z = -zoom
   * behind the holder -- ends up in FRONT, looking back.
   *
   * Known limitation: noa's camera-obstruction sweep runs earlier in the
   * frame using the unflipped direction, so the front camera can clip into
   * terrain where the back camera would have been pushed clear.
   */
  let flipped = null
  noa.on('beforeRender', () => {
    if (mode !== 2) return
    flipped = { heading: noa.camera.heading, pitch: noa.camera.pitch }
    noa.camera.heading += Math.PI
    noa.camera.pitch = -noa.camera.pitch
  })
  noa.on('afterRender', () => {
    if (!flipped) return
    noa.camera.heading = flipped.heading
    noa.camera.pitch = flipped.pitch
    flipped = null
  })

  noa.on('tick', (dt) => {
    const secs = dt / 1000
    const body = noa.ents.getPhysics(player).body

    /*
     * Stride advances with distance travelled, not time. On a timer the legs
     * keep walking while you stand still and fall out of step when you sprint.
     */
    const speed = Math.hypot(body.velocity[0], body.velocity[2])
    limbSwing += speed * secs * 2.0
    const targetAmount = Math.min(speed / MC.WALK_SPEED, 1) * 0.9
    limbSwingAmount += (targetAmount - limbSwingAmount) * Math.min(1, secs * 10)

    const sneaking = !!noa.inputs.state.sneak

    /*
     * Minecraft's body does NOT snap to where you look. The head turns freely
     * up to about 50 degrees, and only past that does the body rotate to
     * catch up -- which is why a Minecraft player can stand still and look
     * over their shoulder. Locking body yaw to camera heading, as this did
     * before, makes the head permanently face dead ahead and the whole model
     * spin with the mouse.
     */
    const look = noa.camera.heading
    if (speed > 0.1) {
      // Moving: the body turns to face travel, quickly but not instantly.
      bodyYaw += angleDelta(bodyYaw, look) * Math.min(1, secs * 12)
    } else {
      const off = angleDelta(bodyYaw, look)
      if (Math.abs(off) > MAX_HEAD_TURN) {
        bodyYaw += off - Math.sign(off) * MAX_HEAD_TURN
      }
    }

    poseModel(model.parts, {
      limbSwing,
      limbSwingAmount,
      crouching: sneaking,
      // The same swing the first-person viewmodel uses, so punching looks
      // identical from inside and outside. swing.value counts 1 -> 0;
      // Minecraft's attackTime counts the other way.
      attack: 1 - swing.value,
      // Camera pitch is positive looking DOWN, and so is the model's head
      // rotation about X, so these share a sign. Negating it, as this did
      // before, made the model look up whenever the player looked down.
      headPitch: noa.camera.pitch,
      headYaw: angleDelta(bodyYaw, look),
    })

    model.root.rotation.y = bodyYaw

  })

  /*
   * Positioning happens during RENDER, not tick, and reads noa's
   * _renderPosition rather than the raw position.
   *
   * That field is the entity's position interpolated for the current frame.
   * Ticks run at a fixed rate below the frame rate, so placing the model on
   * tick makes it step forward in discrete jumps while the camera moves
   * smoothly -- which is exactly the judder that showed up when running.
   * It's already in local coordinates, so no globalToLocal is needed.
   */
  noa.on('beforeRender', () => {
    const rpos = noa.ents.getPositionData(player)._renderPosition
    model.root.position.set(rpos[0], rpos[1], rpos[2])
    // Off the same interpolated position as the body, in the same frame, so
    // the two cannot drift apart by a tick.
    if (mode !== 0) nametag?.update(rpos)
  })

  return {
    get mode() { return MODES[mode] },
    get isFirstPerson() { return mode === 0 },
    model,
    nametag,
    // Exposed for the test suite, which has to be able to ask which of the two
    // hand meshes is drawn without screenshotting to find out.
    hand: { block: handBlock, item: handItem, get mode() { return handMode } },
  }
}
