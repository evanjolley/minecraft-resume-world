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
 * player, so it never rises and falls as you jump. The sun and moon are
 * likewise positioned in world space rather than parented to the camera.
 *
 * DAY/NIGHT runs on Minecraft's clock: 24000 ticks per full cycle at 20 ticks
 * per second, so 20 real minutes. t=0 is sunrise, 6000 noon, 12000 sunset,
 * 18000 midnight. Everything else -- sun and moon elevation, sky colour,
 * directional light, cloud brightness -- is derived from the sun's elevation,
 * which keeps them impossible to desync from each other.
 */

const TICKS_PER_DAY = 24000
const TICKS_PER_SECOND = 20
// Minecraft starts a new world at ~1000, just after sunrise.
const START_TIME = 1000

// Sky colours, sampled from Minecraft.
const SKY_DAY = [0.47, 0.655, 1.0]
const SKY_SUNSET = [0.97, 0.52, 0.24]
const SKY_NIGHT = [0.02, 0.025, 0.07]

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v
const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]

/*
 * Sky colour from the sun's elevation rather than from the clock directly.
 * Driving it off elevation means sunrise and sunset get the same treatment
 * for free, instead of needing two hand-written time windows that inevitably
 * disagree at the edges.
 */
function skyColorFor(elevation) {
  if (elevation > 0.20) return SKY_DAY
  if (elevation > -0.05) return mix(SKY_SUNSET, SKY_DAY, clamp01((elevation + 0.05) / 0.25))
  return mix(SKY_NIGHT, SKY_SUNSET, clamp01((elevation + 0.25) / 0.20))
}

// Cloud layer geometry. GRID x GRID cells of CELL blocks each, so the layer
// spans GRID*CELL blocks -- comfortably past the 48-block island in any
// direction the player can get to.
const CLOUD_HEIGHT = 192
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

  /* ---- sun and moon ---- */
  const celestial = (name, file, size) => {
    const tex = new Texture(file, scene, true, false, Texture.NEAREST_SAMPLINGMODE)
    tex.hasAlpha = true
    const mat = noa.rendering.makeStandardMaterial(`${name}-mat`)
    /*
     * emissiveTexture for the colour, opacityTexture for the cutout.
     *
     * Minecraft's sun and moon have no alpha channel -- they are discs on
     * solid black, hidden by additive blending. build-textures derives alpha
     * from luminance so plain alpha blending works, and opacityTexture reads
     * that channel explicitly. useAlphaFromDiffuseTexture did not apply here
     * and left a black square around the sun.
     */
    mat.emissiveTexture = tex
    mat.opacityTexture = tex
    mat.diffuseColor = new Color3(0, 0, 0)
    mat.emissiveColor = new Color3(1, 1, 1)
    // noa leaves ambientColor white and Babylon adds that term even with
    // lighting disabled, which lifts the cutout back into a grey box.
    mat.ambientColor = new Color3(0, 0, 0)
    mat.specularColor = new Color3(0, 0, 0)
    mat.disableLighting = true
    mat.backFaceCulling = false

    const mesh = CreatePlane(name, { size }, scene)
    mesh.material = mat
    mesh.isPickable = false
    // Always face the camera, so they stay discs rather than foreshortened
    // rectangles as you turn.
    mesh.billboardMode = 7 // BILLBOARDMODE_ALL
    noa.rendering.addMeshToScene(mesh)
    return { mesh, mat }
  }

  const sun = celestial('sun', '/textures/sun.png', 60)
  const moon = celestial('moon', '/textures/moon.png', 40)
  const SKY_DIST = 260

  const local = [0, 0, 0]
  const global = [0, 0, 0]
  let drift = 0
  let time = START_TIME

  const scene_ = scene
  const light = noa.rendering.light

  const place = (mesh, dx, dy, dz, px, py, pz) => {
    global[0] = px + dx * SKY_DIST
    global[1] = py + dy * SKY_DIST
    global[2] = pz + dz * SKY_DIST
    noa.globalToLocal(global, null, local)
    mesh.position.set(local[0], local[1], local[2])
  }

  noa.on('tick', (dt) => {
    const secs = dt / 1000
    const p = noa.ents.getPositionData(player).position

    time = (time + secs * TICKS_PER_SECOND) % TICKS_PER_DAY

    // t=0 sunrise in the east, 6000 overhead, 12000 west, 18000 below.
    const angle = (time / TICKS_PER_DAY) * Math.PI * 2
    const elevation = Math.sin(angle)
    const eastWest = Math.cos(angle)

    place(sun.mesh, eastWest, elevation, 0, p[0], p[1], p[2])
    place(moon.mesh, -eastWest, -elevation, 0, p[0], p[1], p[2])
    // Hide whichever one is below the horizon so it can't shine through the
    // island from underneath.
    sun.mesh.setEnabled(elevation > -0.15)
    moon.mesh.setEnabled(elevation < 0.15)

    const sky = skyColorFor(elevation)
    scene_.clearColor.set(sky[0], sky[1], sky[2], 1)

    // Daylight drives the directional light and the ambient term together.
    // Night bottoms out at 0.18 rather than 0 because pitch black is
    // unreadable, and Minecraft's night isn't fully dark either.
    const daylight = clamp01(elevation * 2 + 0.35)
    const level = 0.18 + daylight * 0.82
    if (light) {
      light.intensity = level
      light.direction.set(-eastWest, -Math.max(elevation, 0.15), -0.3)
    }
    scene_.ambientColor.set(level * 0.5, level * 0.5, level * 0.5)

    // Clouds are emissive, so they need dimming explicitly or they glow at
    // midnight like strip lights. The night floor is deliberately low --
    // at 0.25 they still read as bright grey against a near-black sky.
    const cloudLevel = 0.09 + daylight * 0.91
    clouds.material.emissiveColor.set(cloudLevel, cloudLevel, cloudLevel)

    // Snap the layer to whole cells so recentering on the player is
    // invisible; drift is applied on top as a continuous offset. Without the
    // snap the whole sky would slide around as you walk.
    drift = (drift + secs * CLOUD_DRIFT) % CLOUD_CELL
    global[0] = Math.round(p[0] / CLOUD_CELL) * CLOUD_CELL + drift
    global[1] = CLOUD_HEIGHT
    global[2] = Math.round(p[2] / CLOUD_CELL) * CLOUD_CELL
    noa.globalToLocal(global, null, local)
    clouds.position.set(local[0], local[1], local[2])
  })

  return {
    getTime: () => time,
    setTime: (t) => { time = ((t % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY },
    TICKS_PER_DAY,
  }
}
