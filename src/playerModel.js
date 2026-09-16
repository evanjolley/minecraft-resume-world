import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Vector4 } from '@babylonjs/core/Maths/math.vector'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { trackEntityLight } from './entityLight.js'
import { MC } from './physics.js'

/*
 * The Minecraft player model, UV-mapped to a standard 64x64 skin.
 *
 * Geometry is Minecraft's, in model units where 16 units = 1 block, with the
 * origin at the feet. Each part has a PIVOT that rotation happens around --
 * an arm swings from the shoulder, not from its centre -- so every part is a
 * TransformNode at the pivot with the box offset beneath it.
 *
 * Renderer scale is 0.9375, which Minecraft's PlayerRenderer applies. Without
 * it the 32-unit model stands a full 2 blocks tall against a 1.8 hitbox and
 * visibly floats.
 *
 * SKIN LAYOUT: this maps the "wide" (classic, 4px arms) 64x64 layout. The
 * slim variant has 3px arms at different offsets and would need its own map.
 *
 * COORDINATE WARNING: Minecraft's model files are Y-DOWN. A part declared as
 * addBox(-3, -2, -2, 4, 12, 4) spans y = -2..10 downward from its pivot,
 * which is y = +2..-10 here. Converting those two numbers wrong is what put
 * the arms two units low and one unit inboard -- they sank into the torso and
 * left a phantom neck.
 *
 * HANDEDNESS: Babylon is LEFT-handed and Minecraft is right-handed, so this
 * world is Minecraft's mirror image and the model has to be mirrored to
 * match. Every Minecraft x is negated below -- `rightArm.setPos(-5, 2, 0)`
 * becomes a pivot at +5. Full conversion from Minecraft model units:
 *
 *   x_here = -x_mc      y_here = 24 - y_mc      z_here = -z_mc
 *
 * and, because mirroring twice is the identity, rotation ANGLES carry over
 * from Minecraft unchanged on all three axes.
 */

const MODEL_SCALE = 0.9375 / 16

/*
 * Babylon's box faceUV order, confirmed from its normals array, is
 * [+Z, -Z, +X, -X, +Y, -Y]. noa's heading 0 looks down +Z, so the model's
 * front is +Z, and in Babylon's LEFT-handed frame a model facing +Z has its
 * right hand toward +X. That is why "right" maps to index 2.
 *
 * It used to map the other way, on right-handed reasoning, and that put every
 * side texture on the wrong limb -- visible the moment you compared the
 * first-person arm (which reads armRight's UVs directly, so placement never
 * touched it) against the model in third person.
 *
 * No mirroring of the UV rects themselves: Babylon lays out each face's UVs
 * relative to that face's own outward view, exactly as Minecraft's Cube
 * polygons do, so a rect handed to the geometrically corresponding face comes
 * out the right way round.
 */
const SKIN = 64
/*
 * Sheet HEIGHT is a parameter because a cape sheet is 64x32 while a skin is
 * 64x64. Width is 64 for both. Getting this wrong is silent: every V lands at
 * half its intended height and the cape samples the blank lower half.
 */
const uvOn = (sheetH) => (x, y, w, h) =>
  new Vector4(x / SKIN, 1 - (y + h) / sheetH, (x + w) / SKIN, 1 - y / sheetH)
const uv = uvOn(SKIN)

const faces = ({ front, back, left, right, top, bottom }, u = uv) => [
  u(...front), u(...back), u(...right), u(...left), u(...top), u(...bottom),
]

/* Minecraft's HumanoidModel, in model units. */
const PARTS = {
  head: {
    size: [8, 8, 8], pivot: [0, 24, 0], offset: [0, 4, 0],
    uv: { top: [8, 0, 8, 8], bottom: [16, 0, 8, 8], right: [0, 8, 8, 8],
          front: [8, 8, 8, 8], left: [16, 8, 8, 8], back: [24, 8, 8, 8] },
  },
  body: {
    size: [8, 12, 4], pivot: [0, 24, 0], offset: [0, -6, 0],
    uv: { top: [20, 16, 8, 4], bottom: [28, 16, 8, 4], right: [16, 20, 4, 12],
          front: [20, 20, 8, 12], left: [28, 20, 4, 12], back: [32, 20, 8, 12] },
  },
  // MC: setPos(-5, 2, 0), addBox(-3, -2, -2, 4, 12, 4)
  // -> x spans -8..-4, mirrored to 4..8 (flush with the torso edge, not
  //    overlapping it), which is the player's right in a left-handed frame
  // -> y spans 12..24 (level with the torso, not hanging below it)
  armRight: {
    size: [4, 12, 4], pivot: [5, 22, 0], offset: [1, -4, 0],
    uv: { top: [44, 16, 4, 4], bottom: [48, 16, 4, 4], right: [40, 20, 4, 12],
          front: [44, 20, 4, 12], left: [48, 20, 4, 12], back: [52, 20, 4, 12] },
  },
  // MC: setPos(5, 2, 0), addBox(-1, -2, -2, 4, 12, 4) -> x spans 4..8, mirrored
  armLeft: {
    size: [4, 12, 4], pivot: [-5, 22, 0], offset: [-1, -4, 0],
    uv: { top: [36, 48, 4, 4], bottom: [40, 48, 4, 4], right: [32, 52, 4, 12],
          front: [36, 52, 4, 12], left: [40, 52, 4, 12], back: [44, 52, 4, 12] },
  },
  legRight: {
    size: [4, 12, 4], pivot: [1.9, 12, 0], offset: [0, -6, 0],
    uv: { top: [4, 16, 4, 4], bottom: [8, 16, 4, 4], right: [0, 20, 4, 12],
          front: [4, 20, 4, 12], left: [8, 20, 4, 12], back: [12, 20, 4, 12] },
  },
  legLeft: {
    size: [4, 12, 4], pivot: [-1.9, 12, 0], offset: [0, -6, 0],
    uv: { top: [20, 48, 4, 4], bottom: [24, 48, 4, 4], right: [16, 52, 4, 12],
          front: [20, 52, 4, 12], left: [24, 52, 4, 12], back: [28, 52, 4, 12] },
  },
}

/*
 * THE CAPE, from Minecraft's PlayerModel `cloak` part and CapeLayer.
 *
 *   PlayerModel: texOffs(0, 0).addBox(-5, 0, -1, 10, 16, 1), PartPose.ZERO
 *   CapeLayer:   translate(0, 0, 0.125)          -- 2 model units BACK
 *                rotate X by 6 + f2/2 + f1       -- 6 is the resting angle
 *                rotate Y by 180 - f3/2
 *
 * Read off vanilla rather than eyeballed, because every one of those numbers
 * is visible: the cape is 10 wide (narrower than the 8-wide torso plus its
 * arms), hangs from the NECK line and not the shoulders, stops 8 units above
 * the feet, and sits 2 units behind the torso's back face so it does not
 * z-fight with it.
 *
 * In this file's frame (x_here = -x_mc, y_here = 24 - y_mc, z_here = -z_mc)
 * that is a pivot at the neck, 2 back, with the box hanging beneath it.
 *
 * THE 180-DEGREE Y ROTATION IS BAKED INTO THE UVs, not applied as a
 * transform. Vanilla defines the cloak cube facing FORWARD and then spins it
 * around, which is why the rect at (1,1) -- the printed outer face -- is laid
 * out as the cube's front. The box is symmetric in x, so spinning it is
 * identical to handing that rect to the back face here and the lining at
 * (12,1) to the front. Rejected: a real rotation, which would mean a second
 * transform node whose only job is to undo itself.
 *
 * (The one thing the bake does not reproduce is the top and bottom faces
 * being turned 180 degrees in plane. They are 10x1 strips of hem seen edge
 * on. Not worth a node.)
 */
const CAPE = {
  size: [10, 16, 1], pivot: [0, 24, -2], offset: [0, -8, -0.5],
  uv: { top: [1, 0, 10, 1], bottom: [11, 0, 10, 1], right: [11, 1, 1, 16],
        front: [12, 1, 10, 16], left: [0, 1, 1, 16], back: [1, 1, 10, 16] },
}
const capeUv = uvOn(32)

/** CapeLayer's resting X rotation. Positive tips the hem away from the legs. */
const CAPE_REST = (6 * Math.PI) / 180
/** ...and what crouching adds to it, so the cape clears the bent back. */
const CAPE_CROUCH = (25 * Math.PI) / 180

/**
 * Hangs a cape on an existing model. Separate from createPlayerModel on
 * purpose: a cape is OPTIONAL art with its own licence question
 * (docs/DEPLOYMENT.md), and in multiplayer most players will not have one,
 * so "no cape" is the common case and has to be the cheap one.
 *
 * If the image does not load -- a build made with `--no-cape`, or a player
 * the skin server has no cape for -- this removes itself and the model is a
 * correct capeless one. That is a RUNTIME check rather than a build-time
 * manifest because the multiplayer case cannot be known at build time, and
 * one mechanism that covers both beats two that each cover half.
 *
 * @returns the part, or null once it has removed itself.
 */
export function attachCape(noa, model, url, name = 'cape') {
  const scene = noa.rendering.getScene()
  let part = null

  const material = createSkinMaterial(noa, url, name, () => {
    if (!part) return
    part.box.dispose()
    part.pivot.dispose()
    material.dispose(true, true)
    delete model.parts.cape
    part = null
  })

  const pivot = new TransformNode(`${name}-pivot`, scene)
  pivot.position.set(CAPE.pivot[0], CAPE.pivot[1], CAPE.pivot[2])
  pivot.rotation.x = CAPE_REST
  const box = CreateBox(name, {
    width: CAPE.size[0], height: CAPE.size[1], depth: CAPE.size[2],
    faceUV: faces(CAPE.uv, capeUv), wrap: true,
  }, scene)
  box.position.set(CAPE.offset[0], CAPE.offset[1], CAPE.offset[2])
  box.material = material
  box.parent = pivot
  box.isPickable = false
  pivot.parent = model.root
  noa.rendering.addMeshToScene(box)

  part = { pivot, box }
  model.parts.cape = part
  return part
}

/**
 * @param {function} [onError] called if the image never loads. A 404 here is
 *   NOT exceptional -- it is how a capeless build, and later a multiplayer
 *   player with no cape, announces itself -- so the caller gets to decide
 *   (attachCape deletes itself) rather than the model rendering untextured.
 */
export function createSkinMaterial(noa, url, name = 'skin', onError = null) {
  const scene = noa.rendering.getScene()
  // invertY MUST be true here. The uv() helper below computes V as
  // 1 - y/64, i.e. it assumes Babylon's flipped orientation. Built with
  // invertY false, every face samples the skin upside down and you get the
  // trouser texture on the head.
  const tex = new Texture(
    url, scene, true, true, Texture.NEAREST_SAMPLINGMODE, null, onError)
  tex.hasAlpha = true
  const mat = noa.rendering.makeStandardMaterial(name)
  mat.diffuseTexture = tex
  mat.specularColor = new Color3(0, 0, 0)
  /*
   * Day/night, and the floor that stops a face angled away from the one
   * directional light going pure black.
   *
   * This used to be `emissiveTexture = tex` plus a flat 0.45 emissiveColor,
   * and it was wrong twice over: Babylon ADDS those two, so the sum ran past
   * the shader's clamp and the model rendered fully unlit -- bright at
   * midnight, unchanged by the sky. entityLight.js owns the number now and
   * scales it by the same `level` the sun light runs on, which is what
   * Minecraft's own entity shader does (its floor is a fraction of the light
   * level, never a constant). Read the comment there before touching this.
   */
  /*
   * The probe is the PLAYER's feet, which is right for the player model, the
   * first-person arm and the held item -- all three share this material. An
   * NPC goes through this same function and would be lit by the player's
   * position, which is wrong and is why npc.js rebinds the probe to his own
   * entity the moment there is one (entityLight.js's bindEntityLight).
   */
  trackEntityLight(mat, () => noa.ents.getPosition(noa.playerEntity))
  return mat
}

function buildPart(scene, name, def, material) {
  const pivot = new TransformNode(`${name}-pivot`, scene)
  pivot.position.set(def.pivot[0], def.pivot[1], def.pivot[2])

  const box = CreateBox(name, {
    width: def.size[0], height: def.size[1], depth: def.size[2],
    faceUV: faces(def.uv), wrap: true,
  }, scene)
  box.position.set(def.offset[0], def.offset[1], def.offset[2])
  box.material = material
  box.parent = pivot
  box.isPickable = false
  return { pivot, box }
}

/**
 * @param {number} [scale]  a multiplier on the whole model, 1 for a player.
 *   UNIFORM on all three axes on purpose: the skin is a fixed 64x64 image
 *   stretched over boxes whose proportions are Minecraft's, so scaling Y
 *   alone would give a taller character an elongated head and a smeared face
 *   texture. A uniform scale is just a bigger person and the skin is
 *   untouched. Applied on top of MODEL_SCALE rather than instead of it --
 *   0.9375/16 is vanilla's renderer scale and belongs to every model.
 */
export function createPlayerModel(noa, material, scale = 1) {
  const scene = noa.rendering.getScene()
  const root = new TransformNode('player-model', scene)
  root.scaling.setAll(MODEL_SCALE * scale)

  const parts = {}
  for (const [name, def] of Object.entries(PARTS)) {
    const part = buildPart(scene, name, def, material)
    part.pivot.parent = root
    parts[name] = part
    noa.rendering.addMeshToScene(part.box)
  }
  return { root, parts }
}

/**
 * The first-person right arm, for when the hand is empty. Same geometry and
 * skin UVs as the model's arm, so a custom skin shows through on the hand too.
 */
export function createFirstPersonArm(noa, material) {
  const scene = noa.rendering.getScene()
  const box = CreateBox('fp-arm', {
    width: 4, height: 12, depth: 4,
    faceUV: faces(PARTS.armRight.uv), wrap: true,
  }, scene)
  box.material = material
  box.isPickable = false
  noa.rendering.addMeshToScene(box)
  return box
}

/*
 * THE STRIDE CLOCK, which is what actually makes the legs move.
 *
 * `limbSwing` is a DISTANCE, not a time. Minecraft's LivingEntity accumulates
 * `walkDist` from how far the body moved this tick, and HumanoidModel reads
 * that -- which is why sprinting quickens the stride and why standing still
 * leaves the legs where they are instead of pedalling on the spot. Driving it
 * off a timer is the one wrong answer that still looks animated.
 *
 * `limbSwingAmount` is the AMPLITUDE, chased rather than set, so the legs open
 * and close over a few frames instead of snapping to full stride on the tick
 * you start walking. 0.9 is vanilla's cap.
 *
 * It lives here, next to poseModel, because it is half of the same animation:
 * poseModel is the shape of a step and this is when the step happens.
 * perspective.js still has these three lines inline and should be moved onto
 * this function -- that file belongs to another pass, so for now the two are
 * the same arithmetic in two places and this comment is the thing that says
 * so. Rejected: leaving it inline in npc.js too, which is how the constant
 * 2.0 would have become three numbers that only look the same.
 *
 * @param {{ swing: number, amount: number }} stride  mutated in place
 * @param {number} speed  horizontal speed, blocks/sec
 * @param {number} secs   tick length
 */
export function advanceStride(stride, speed, secs) {
  stride.swing += speed * secs * 2.0
  const target = Math.min(speed / MC.WALK_SPEED, 1) * 0.9
  stride.amount += (target - stride.amount) * Math.min(1, secs * 10)
  return stride
}

/*
 * Pose, straight out of Minecraft's HumanoidModel.setupAnim.
 *
 * `limbSwing` accumulates with distance travelled rather than time, so the
 * stride stays in step with actual movement instead of drifting when you
 * sprint or stop.
 */
export function poseModel(parts, { limbSwing, limbSwingAmount, crouching, headPitch, headYaw, attack = 1 }) {
  const { head, body, armRight, armLeft, legRight, legLeft, cape } = parts

  /*
   * The cape, and what it does NOT do.
   *
   * Vanilla swings it off the gap between where the player IS and where the
   * cloak's own lagged position is (xCloak/yCloak/zCloak): moving away from
   * it flares the cape up to 75 degrees, falling lifts it, and a sideways
   * component rolls it on Z and Y. None of that is here. Nothing that wears
   * a cape in this world MOVES -- the NPC stands still and the player has no
   * cape -- so implementing a motion model with no motion to drive it would
   * be untestable code that looks finished. The resting pose is exact; the
   * swing is a stub with a name (docs/FUTURE.md's remote players is what
   * makes it worth writing, because then capes move).
   *
   * Crouching gets vanilla's +25 degrees, which is reachable the moment the
   * player is given a cape. Vanilla ALSO translates the cape ~0.142 blocks
   * up while sneaking; that number is not verified here and nothing can
   * currently see it, so it is deliberately left out rather than guessed.
   */
  if (cape) cape.pivot.rotation.x = CAPE_REST + (crouching ? CAPE_CROUCH : 0)

  // Set first: the punch below reads head pitch, because Minecraft aims the
  // swing at whatever you are looking at.
  head.pivot.rotation.x = headPitch
  head.pivot.rotation.y = headYaw

  const swing = Math.cos(limbSwing * 0.6662)
  const swingOpp = Math.cos(limbSwing * 0.6662 + Math.PI)

  armRight.pivot.rotation.x = swingOpp * 2.0 * limbSwingAmount * 0.5
  armLeft.pivot.rotation.x = swing * 2.0 * limbSwingAmount * 0.5
  legRight.pivot.rotation.x = swing * 1.4 * limbSwingAmount
  legLeft.pivot.rotation.x = swingOpp * 1.4 * limbSwingAmount
  armRight.pivot.rotation.y = armRight.pivot.rotation.z = 0
  armLeft.pivot.rotation.y = armLeft.pivot.rotation.z = 0

  /*
   * Punch, transcribed from HumanoidModel.setupAttackAnimation rather than
   * approximated. `attack` is Minecraft's attackTime: 0 as the swing starts,
   * 1 when it is over -- and 1 also IS the resting pose, since every term
   * below vanishes there, so this runs unconditionally with no seam at the
   * end of a swing.
   *
   * Three things the hand-tuned version it replaces did not do: the torso
   * twists, the shoulders orbit with it, and the arm rises faster than it
   * falls (that quartic on the way in is the whole character of the motion).
   */
  const twist = Math.sin(Math.sqrt(attack) * Math.PI * 2) * 0.2
  body.pivot.rotation.y = twist

  // Arms hang off the root, not off the torso -- in Minecraft's model as well
  // as this one -- so the twist has to orbit the shoulders by hand.
  armRight.pivot.position.x = Math.cos(twist) * 5
  armRight.pivot.position.z = -Math.sin(twist) * 5
  armLeft.pivot.position.x = -Math.cos(twist) * 5
  armLeft.pivot.position.z = Math.sin(twist) * 5
  armRight.pivot.rotation.y += twist
  armLeft.pivot.rotation.y += twist
  armLeft.pivot.rotation.x += twist

  const ease = 1 - (1 - attack) ** 4
  const reach = Math.sin(ease * Math.PI) * 1.2
  const aim = Math.sin(attack * Math.PI) * -(headPitch - 0.7) * 0.75
  armRight.pivot.rotation.x -= reach + aim
  armRight.pivot.rotation.y += twist * 2
  armRight.pivot.rotation.z += Math.sin(attack * Math.PI) * -0.4

  /*
   * Crouch, using Minecraft's exact numbers: the body tips 0.5 rad forward,
   * the arms gain 0.4, the legs shift back and down, and head/body/arms all
   * drop. Tipping the body alone leaves the head hanging in mid-air, which is
   * why every offset below matters.
   *
   * Minecraft's `rightLeg.z = 4` and `y = 12.2` are Y-down and Z-back, so
   * here they are -4 and 24 - 12.2. Copied verbatim they moved the legs
   * forward and up, which is backwards twice over.
   */
  if (crouching) {
    body.pivot.rotation.x = 0.5
    armRight.pivot.rotation.x += 0.4
    armLeft.pivot.rotation.x += 0.4
    legRight.pivot.position.z = -4
    legLeft.pivot.position.z = -4
    legRight.pivot.position.y = 11.8
    legLeft.pivot.position.y = 11.8
    head.pivot.position.y = 24 - 4.2
    body.pivot.position.y = 24 - 3.2
    armRight.pivot.position.y = 22 - 3.2
    armLeft.pivot.position.y = 22 - 3.2
  } else {
    body.pivot.rotation.x = 0
    legRight.pivot.position.z = 0
    legLeft.pivot.position.z = 0
    legRight.pivot.position.y = 12
    legLeft.pivot.position.y = 12
    head.pivot.position.y = 24
    body.pivot.position.y = 24
    armRight.pivot.position.y = 22
    armLeft.pivot.position.y = 22
  }
}
