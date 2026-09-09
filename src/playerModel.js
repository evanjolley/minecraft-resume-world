import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Vector4 } from '@babylonjs/core/Maths/math.vector'
import { Color3 } from '@babylonjs/core/Maths/math.color'

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
 */

export const MODEL_SCALE = 0.9375 / 16

/*
 * Babylon's box faceUV order, confirmed from its normals array, is
 * [+Z, -Z, +X, -X, +Y, -Y]. noa's heading 0 looks down +Z, so the model's
 * front is +Z. Facing +Z, the player's own right hand is toward -X, which is
 * why "right" maps to index 3 and "left" to index 2 -- the opposite of what
 * reading the axes alone suggests.
 */
const SKIN = 64
const uv = (x, y, w, h) =>
  new Vector4(x / SKIN, 1 - (y + h) / SKIN, (x + w) / SKIN, 1 - y / SKIN)

const faces = ({ front, back, left, right, top, bottom }) => [
  uv(...front), uv(...back), uv(...left), uv(...right), uv(...top), uv(...bottom),
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
  armRight: {
    size: [4, 12, 4], pivot: [-5, 22, 0], offset: [0, -6, 0],
    uv: { top: [44, 16, 4, 4], bottom: [48, 16, 4, 4], right: [40, 20, 4, 12],
          front: [44, 20, 4, 12], left: [48, 20, 4, 12], back: [52, 20, 4, 12] },
  },
  armLeft: {
    size: [4, 12, 4], pivot: [5, 22, 0], offset: [0, -6, 0],
    uv: { top: [36, 48, 4, 4], bottom: [40, 48, 4, 4], right: [32, 52, 4, 12],
          front: [36, 52, 4, 12], left: [40, 52, 4, 12], back: [44, 52, 4, 12] },
  },
  legRight: {
    size: [4, 12, 4], pivot: [-2, 12, 0], offset: [0, -6, 0],
    uv: { top: [4, 16, 4, 4], bottom: [8, 16, 4, 4], right: [0, 20, 4, 12],
          front: [4, 20, 4, 12], left: [8, 20, 4, 12], back: [12, 20, 4, 12] },
  },
  legLeft: {
    size: [4, 12, 4], pivot: [2, 12, 0], offset: [0, -6, 0],
    uv: { top: [20, 48, 4, 4], bottom: [24, 48, 4, 4], right: [16, 52, 4, 12],
          front: [20, 52, 4, 12], left: [24, 52, 4, 12], back: [28, 52, 4, 12] },
  },
}

export function createSkinMaterial(noa, url, name = 'skin') {
  const scene = noa.rendering.getScene()
  // invertY MUST be true here. The uv() helper below computes V as
  // 1 - y/64, i.e. it assumes Babylon's flipped orientation. Built with
  // invertY false, every face samples the skin upside down and you get the
  // trouser texture on the head.
  const tex = new Texture(url, scene, true, true, Texture.NEAREST_SAMPLINGMODE)
  tex.hasAlpha = true
  const mat = noa.rendering.makeStandardMaterial(name)
  mat.diffuseTexture = tex
  mat.specularColor = new Color3(0, 0, 0)
  /*
   * The skin is also fed to emissive at partial strength. noa's scene is lit
   * by a single directional light, so faces angled away from it fall to pure
   * black -- which is what the model did at first. Minecraft's entity
   * shading never goes fully dark, and this floor reproduces that.
   */
  mat.emissiveTexture = tex
  mat.emissiveColor = new Color3(0.45, 0.45, 0.45)
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

export function createPlayerModel(noa, material) {
  const scene = noa.rendering.getScene()
  const root = new TransformNode('player-model', scene)
  root.scaling.setAll(MODEL_SCALE)

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
 * Pose, straight out of Minecraft's HumanoidModel.setupAnim.
 *
 * `limbSwing` accumulates with distance travelled rather than time, so the
 * stride stays in step with actual movement instead of drifting when you
 * sprint or stop.
 */
export function poseModel(parts, { limbSwing, limbSwingAmount, crouching, headPitch, headYaw }) {
  const { head, body, armRight, armLeft, legRight, legLeft } = parts

  const swing = Math.cos(limbSwing * 0.6662)
  const swingOpp = Math.cos(limbSwing * 0.6662 + Math.PI)

  armRight.pivot.rotation.x = swingOpp * 2.0 * limbSwingAmount * 0.5
  armLeft.pivot.rotation.x = swing * 2.0 * limbSwingAmount * 0.5
  legRight.pivot.rotation.x = swing * 1.4 * limbSwingAmount
  legLeft.pivot.rotation.x = swingOpp * 1.4 * limbSwingAmount

  head.pivot.rotation.x = headPitch
  head.pivot.rotation.y = headYaw

  /*
   * Crouch, using Minecraft's exact numbers: the body tips 0.5 rad forward,
   * the arms gain 0.4, the legs shift back and up, and head/body/arms all
   * drop. Tipping the body alone leaves the head hanging in mid-air, which is
   * why every offset below matters.
   */
  if (crouching) {
    body.pivot.rotation.x = 0.5
    armRight.pivot.rotation.x += 0.4
    armLeft.pivot.rotation.x += 0.4
    legRight.pivot.position.z = 4
    legLeft.pivot.position.z = 4
    legRight.pivot.position.y = 12.2
    legLeft.pivot.position.y = 12.2
    head.pivot.position.y = 24 - 4.2
    body.pivot.position.y = 24 - 3.2
    armRight.pivot.position.y = 22 - 5.2 + 2
    armLeft.pivot.position.y = 22 - 5.2 + 2
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
