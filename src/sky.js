import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Color3 } from '@babylonjs/core/Maths/math.color'

/*
 * The sun.
 *
 * Clouds were tried and cut. Pixel Perfection's cloud texture is a solid
 * fill tile (Minetest builds clouds from cubes, not from a patterned sheet),
 * so tiling it across a plane renders a flat white ceiling over the whole
 * sky rather than anything cloud-shaped. Doing them properly needs a
 * generated blocky alpha mask, which is a separate job.
 *
 * The sun is positioned in world space each tick rather than parented to the
 * camera, so it holds a fixed compass direction as you turn and move.
 */

export function installSky(noa) {
  const scene = noa.rendering.getScene()
  const player = noa.playerEntity

  /* ---- sun ---- */
  const sunTex = new Texture('/textures/sun.png', scene, true, false, Texture.NEAREST_SAMPLINGMODE)
  sunTex.hasAlpha = true

  const sunMat = noa.rendering.makeStandardMaterial('sun-mat')
  sunMat.diffuseTexture = sunTex
  sunMat.useAlphaFromDiffuseTexture = true
  sunMat.disableLighting = true
  sunMat.emissiveColor = new Color3(1, 1, 1)
  sunMat.backFaceCulling = false

  const sun = CreatePlane('sun', { size: 60 }, scene)
  sun.material = sunMat
  sun.isPickable = false
  noa.rendering.addMeshToScene(sun)
  // Always face the camera, so it stays a disc rather than a foreshortened
  // rectangle as you turn.
  sun.billboardMode = 7 // BILLBOARDMODE_ALL

  // Matches the engine's lightVector so the sun sits where the light says.
  const SUN_DIR = [-0.6, 1, 0.4]
  const len = Math.hypot(...SUN_DIR)
  const SUN_DIST = 260

  const local = [0, 0, 0]
  const global = [0, 0, 0]

  noa.on('tick', () => {
    const p = noa.ents.getPositionData(player).position
    global[0] = p[0] + (SUN_DIR[0] / len) * SUN_DIST
    global[1] = p[1] + (SUN_DIR[1] / len) * SUN_DIST
    global[2] = p[2] + (SUN_DIR[2] / len) * SUN_DIST
    noa.globalToLocal(global, null, local)
    sun.position.set(local[0], local[1], local[2])
  })
}
