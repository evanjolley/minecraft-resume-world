import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Color3 } from '@babylonjs/core/Maths/math.color'

/*
 * Clouds and sun.
 *
 * The clouds are GEOMETRY, not a texture. A first attempt tiled the pack's
 * cloud image across one big plane and produced a flat white ceiling over the
 * entire sky -- because that image is a solid fill tile. Minetest and
 * Minecraft both build clouds out of blocks, and the cloud shapes come from
 * which cells exist, not from anything painted into the image.
 *
 * So: a grid of cells, each either present or absent according to a
 * deterministic hash, merged into ONE mesh. Merging matters -- a few hundred
 * separate meshes would cost a draw call each and wreck the frame rate.
 *
 * The layer sits at a fixed world altitude and recenters horizontally on the
 * player, so it never rises and falls as you jump. The sun is likewise
 * positioned in world space rather than parented to the camera, so it holds a
 * fixed compass direction as you turn.
 */

// Cloud layer geometry. GRID x GRID cells of CELL blocks each, so the layer
// spans GRID*CELL blocks -- comfortably past the 48-block island in any
// direction the player can get to.
const CLOUD_HEIGHT = 72
const CLOUD_CELL = 12
const CLOUD_GRID = 28
const CLOUD_FILL = 0.42   // fraction of cells that are cloud
const CLOUD_DRIFT = 0.6   // blocks per second

/*
 * Deterministic value hash. Math.random would reshuffle the sky on every
 * page load and, worse, on every rebuild of the layer.
 */
function cellFilled(i, j) {
  let h = Math.imul(i * 374761393 + j * 668265263, 1274126177)
  h = (h ^ (h >>> 13)) >>> 0
  return (h % 1000) / 1000 < CLOUD_FILL
}

function buildCloudLayer(noa, scene) {
  const tex = new Texture('/textures/cloud.png', scene, true, false, Texture.NEAREST_SAMPLINGMODE)

  const mat = noa.rendering.makeStandardMaterial('cloud-mat')
  mat.diffuseTexture = tex
  mat.disableLighting = true
  mat.emissiveColor = new Color3(1, 1, 1)
  // noa leaves ambientColor white and Babylon adds that term even with
  // lighting disabled, which blows flat white out to a glaring sheet.
  mat.ambientColor = new Color3(0, 0, 0)
  // Seen from underneath essentially always, so both faces must draw.
  mat.backFaceCulling = false
  mat.alpha = 0.8

  const half = (CLOUD_GRID * CLOUD_CELL) / 2
  const tiles = []
  for (let i = 0; i < CLOUD_GRID; i++) {
    for (let j = 0; j < CLOUD_GRID; j++) {
      if (!cellFilled(i, j)) continue
      const tile = CreatePlane(`cloud_${i}_${j}`, { size: CLOUD_CELL }, scene)
      tile.rotation.x = Math.PI / 2
      tile.position.set(i * CLOUD_CELL - half, 0, j * CLOUD_CELL - half)
      tiles.push(tile)
    }
  }

  // One mesh, one draw call. Args are (meshes, disposeSource,
  // allow32BitsIndices); 32-bit indices matter because a few hundred quads
  // exceeds the 65k vertex ceiling of 16-bit ones.
  const layer = Mesh.MergeMeshes(tiles, true, true)
  layer.material = mat
  layer.isPickable = false
  layer.alwaysSelectAsActiveMesh = true

  // REQUIRED. noa installs its own selection octree, so Babylon picks what to
  // render from that rather than from scene.meshes. A mesh built directly in
  // the scene and never registered here is silently never drawn.
  noa.rendering.addMeshToScene(layer)
  return layer
}

export function installSky(noa) {
  const scene = noa.rendering.getScene()
  const player = noa.playerEntity

  const clouds = buildCloudLayer(noa, scene)

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
  let drift = 0

  noa.on('tick', (dt) => {
    const p = noa.ents.getPositionData(player).position

    // Snap the layer to whole cells so recentering on the player is
    // invisible; drift is applied on top as a continuous offset. Without the
    // snap the whole sky would slide around as you walk.
    drift = (drift + (dt / 1000) * CLOUD_DRIFT) % CLOUD_CELL
    global[0] = Math.round(p[0] / CLOUD_CELL) * CLOUD_CELL + drift
    global[1] = CLOUD_HEIGHT
    global[2] = Math.round(p[2] / CLOUD_CELL) * CLOUD_CELL
    noa.globalToLocal(global, null, local)
    clouds.position.set(local[0], local[1], local[2])

    global[0] = p[0] + (SUN_DIR[0] / len) * SUN_DIST
    global[1] = p[1] + (SUN_DIR[1] / len) * SUN_DIST
    global[2] = p[2] + (SUN_DIR[2] / len) * SUN_DIST
    noa.globalToLocal(global, null, local)
    sun.position.set(local[0], local[1], local[2])
  })
}
