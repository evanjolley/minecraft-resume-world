import { createPlayerModel, poseModel } from './playerModel.js'

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

export function installPerspective(noa, { skinMaterial, inputLock }) {
  const model = createPlayerModel(noa, skinMaterial)
  const player = noa.playerEntity

  let mode = 0
  let limbSwing = 0
  let limbSwingAmount = 0

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

    poseModel(model.parts, {
      limbSwing,
      limbSwingAmount,
      crouching: sneaking,
      // Minecraft's head pitch is inverted relative to the camera's.
      headPitch: -noa.camera.pitch,
      headYaw: 0,
    })

    // Body faces where the camera faces. Minecraft lets the head lead and the
    // body lag behind it; that refinement is noted in the README.
    model.root.rotation.y = noa.camera.heading

    // noa rebases the world origin as you travel, so the model has to be
    // placed through globalToLocal rather than at raw world coordinates.
    global[0] = dat.position[0]
    global[1] = dat.position[1]
    global[2] = dat.position[2]
    noa.globalToLocal(global, null, local)
    model.root.position.set(local[0], local[1], local[2])
  })

  return {
    get mode() { return MODES[mode] },
    get isFirstPerson() { return mode === 0 },
    model,
  }
}
