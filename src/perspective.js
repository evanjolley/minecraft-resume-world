import { createPlayerModel, poseModel } from './playerModel.js'
import { createHeldBlockMesh, blockTextureUrl } from './heldItem.js'
import { BLOCK_BY_ID } from './blocks.js'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'

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

export function installPerspective(noa, { skinMaterial, inputLock, inventory, swing }) {
  const model = createPlayerModel(noa, skinMaterial)
  const player = noa.playerEntity

  let mode = 0
  let limbSwing = 0
  let limbSwingAmount = 0
  let bodyYaw = 0

  /*
   * The block in the model's hand. Parented to the right arm's pivot so it
   * inherits the swing and walk animation for free.
   *
   * Placement follows Minecraft's "thirdperson_righthand" display transform
   * from block.json: rotation [75, 45, 0], scale 0.375. In model units that
   * is a 6-unit cube (0.375 x 16), sat at the far end of the 12-unit arm.
   */
  const handBlock = createHeldBlockMesh(noa, 'hand-block')
  handBlock.parent = model.parts.armRight.pivot
  handBlock.scaling.setAll(6)
  handBlock.position.set(0, -11, 1)
  handBlock.rotation.set((75 * Math.PI) / 180, (45 * Math.PI) / 180, 0)

  const handTextures = new Map()
  inventory.onChange((inv) => {
    const stack = inv.slots[inv.selected]
    const def = stack ? BLOCK_BY_ID.get(stack.id) : null
    handBlock.setEnabled(!!def)
    if (!def) return
    const url = blockTextureUrl(def)
    if (!handTextures.has(url)) {
      const t = new Texture(url, noa.rendering.getScene(), true, false,
        Texture.NEAREST_SAMPLINGMODE)
      t.hasAlpha = true
      handTextures.set(url, t)
    }
    handBlock.material.diffuseTexture = handTextures.get(url)
  })

  const local = [0, 0, 0]
  const global = [0, 0, 0]

  const apply = () => {
    const third = mode !== 0
    noa.camera.zoomDistance = third ? THIRD_PERSON_DISTANCE : 0
    // The model is hidden in first person: from inside, you would be looking
    // at the interior faces of your own head.
    model.root.setEnabled(third)
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
    const dat = noa.ents.getPositionData(player)
    const body = noa.ents.getPhysics(player).body
    const move = noa.ents.getMovement(player)

    /*
     * Stride advances with distance travelled, not time. On a timer the legs
     * keep walking while you stand still and fall out of step when you sprint.
     */
    const speed = Math.hypot(body.velocity[0], body.velocity[2])
    limbSwing += speed * secs * 2.0
    const targetAmount = Math.min(speed / 4.317, 1) * 0.9
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
      // identical from inside and outside.
      swingArc: swing.arc,
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
  })

  return {
    get mode() { return MODES[mode] },
    get isFirstPerson() { return mode === 0 },
    model,
  }
}
