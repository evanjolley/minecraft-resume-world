import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { MC } from './physics.js'

/*
 * Clouds, sun and moon, and the way the sky answers the weather.
 *
 * The clouds are GEOMETRY, not a texture. A first attempt tiled the pack's
 * cloud image across one big plane and produced a flat white ceiling over the
 * entire sky -- because that image is a solid fill tile. Minetest and
 * Minecraft both build clouds out of blocks, and the cloud shapes come from
 * which cells exist, not from anything painted into the image.
 *
 * MINECRAFT HAS TWO CLOUD MODES, and this file used to build the wrong one.
 * "Fast" is one flat quad per cell: a paper ceiling from below, and edge-on
 * invisible from the side. "Fancy" is a BOX per cell -- 12x12 blocks across,
 * 4 blocks deep, its sides and its underside shaded darker than its top. That
 * box is the entire difference between clouds you fly through and a decal
 * stuck on the sky, so this builds Fancy.
 *
 * A grid of cells, each present or absent, with every EXPOSED face of every
 * present cell written into ONE mesh. One mesh matters: a few thousand boxes
 * would cost a draw call each and wreck the frame rate. Skipping the faces
 * between two neighbouring cells matters for a second reason beyond the vertex
 * count -- the clouds are translucent, so an interior face left in would be
 * visible THROUGH the cloud as a darker seam.
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
 *
 * WEATHER arrives as three numbers pushed in by weather.js -- rain, thunder
 * and the lightning flash, each 0..1 -- and what they DO is owned here. Sky
 * colour, light level and cloud colour are already derived in one place from
 * one source; a second module writing them every frame would spend its life
 * fighting this one. weather.js owns when they change, sky.js owns what they
 * look like.
 */

const TICKS_PER_DAY = 24000
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

/* Rec. 601 luminance -- 0.3/0.59/0.11 is the weighting Minecraft's own weather
 * tinting uses, not a modern Rec. 709 grey. */
const luma = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11

/*
 * Minecraft's weather tinting, rain then thunder: the colour is dragged toward
 * a grey of its OWN luminance -- 60% as bright under rain, 20% under thunder.
 *
 * Worth copying rather than fading to a fixed storm grey, which was the
 * obvious version: deriving the grey from the colour it replaces means an
 * overcast sunset stays orange while it goes flat, where a fixed grey would
 * flatten sunset and noon into the same frame.
 *
 * `weight` is not a knob. getSkyColor blends by level * 0.75 and
 * getCloudColor by level * 0.95, which is why a storm turns the clouds grey
 * harder than it turns the sky grey, and the gap between the two is most of
 * what makes an overcast sky read as overcast.
 */
function weatherTint(c, rain, thunder, weight) {
  let out = c
  if (rain > 0) { const g = luma(out) * 0.6; out = mix(out, [g, g, g], rain * weight) }
  if (thunder > 0) { const g = luma(out) * 0.2; out = mix(out, [g, g, g], thunder * weight) }
  return out
}

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

/* ------------------------------------------------------------------ *
 * Clouds
 * ------------------------------------------------------------------ *
 *
 * Every number here is Minecraft's, read off the renderer rather than tuned
 * by eye:
 *
 *   192    the Overworld's cloud level. It was 128 until 1.18 -- 1.17 shipped
 *          with 128 despite a snapshot that said otherwise.
 *   0.33   and the slab is actually drawn at cloudHeight + 0.33, so it spans
 *          192.33 to 196.33. Copied because it is free, and because sitting
 *          off the block grid is what stops a cloud z-fighting anything built
 *          at that altitude.
 *   12     blocks per cell -- CELL_SIZE_IN_BLOCKS in 1.21's CloudRenderer.
 *          One pixel of clouds.png IS a 12x12 block cell. (The wiki says
 *          16x16 for Fancy. The wiki is wrong.)
 *   4      blocks thick, the height of a Fancy cloud box.
 *   0.8    alpha, on every cloud vertex in every version since 1.11.
 *   0.6    blocks per second of drift -- 0.03 per tick -- and it travels WEST.
 *          The offset is added to the X texture COORDINATE, so the pattern
 *          moves the opposite way to the number going up.
 *
 * Face shading is Minecraft's too, and it is the tell that a cloud is solid:
 * top 1.0, underside 0.7, north and south 0.8, east and west 0.9. Those last
 * two are the way round that reads wrong -- the shader's faceColors array in
 * 1.21.6 says north/south 0.8, west/east 0.9 -- and flat-shading them all
 * alike turns the box straight back into a silhouette.
 */
const CLOUD_HEIGHT = 192.33
const CLOUD_CELL = 12
const CLOUD_DEPTH = 4
const CLOUD_ALPHA = 0.8
const CLOUD_DRIFT = -0.6   // negative X: clouds always float west

const SHADE_TOP = 1.0
const SHADE_BOTTOM = 0.7
const SHADE_NS = 0.8
const SHADE_EW = 0.9

/*
 * How far the layer reaches, in cells. 96 cells of 12 blocks is 1152 blocks
 * across, and the field is clipped to a ROUND shape inside that -- which is
 * what 1.21.6 does (`x*x + z*z <= r*r` over a radius of cloudRange chunks,
 * 128 by default, so 2048 blocks). Ours is half vanilla's radius and a fifth
 * of its cell count, because 2048 blocks of cloud is 30k quads to cover sky
 * this world's 80x80 island cannot see past anyway.
 *
 * The radius is the number that decides whether the altitude reads right.
 * At 576 blocks the furthest cloud sits about 12 degrees above the horizon,
 * so the layer recedes to a vanishing point like a real ceiling. The previous
 * 168-block layer stopped 37 degrees up, which reads as a small disc hanging
 * directly overhead -- and THAT, not the altitude, is what made 192 look too
 * high.
 */
const CLOUD_GRID = 96
const CLOUD_RADIUS = CLOUD_GRID / 2   // 48 cells, 576 blocks

/*
 * THE FIELD REPEATS ALONG X EVERY 48 CELLS, and that is not decoration.
 *
 * The drift offset has to be bounded or the layer walks off the player at 0.6
 * blocks/sec -- 2160 blocks an hour, four times the radius. Bounding it means
 * subtracting some whole number of blocks from the offset at some point, and
 * the ONLY subtraction a rigid mesh can absorb without the sky visibly
 * teleporting is one that maps the cloud field exactly onto itself. So the
 * field is built periodic in X, and the drift wraps by exactly that period.
 *
 * The old code assumed the field was periodic every ONE cell -- it wrapped the
 * drift at CLOUD_CELL and snapped the recentering to whole cells -- and it is
 * not: value noise on an 8-cell and a 3-cell lattice repeats at neither. Both
 * "wraps" therefore slid the entire sky sideways by 12 blocks. That was the
 * bug: every cell boundary you crossed, and every 20 seconds regardless, the
 * clouds jumped a cell backwards. Measured at 11.98 blocks a jump, six of them
 * in nine seconds of sprint-jumping.
 *
 * 48 cells because both octave periods have to divide it (48/8, 48/3) and
 * because the repeat distance is then 576 blocks, the same as the radius: two
 * copies of the pattern across the visible sky, which at this altitude and
 * this alpha is not something the eye picks out. Smaller repeats sooner and
 * reads as wallpaper; larger costs quads, because of DRIFT_SLACK below.
 *
 * Periodic in X ONLY. The drift is X-only, so Z needs nothing, and leaving Z
 * alone halves how much repetition there is to notice.
 */
const CLOUD_PERIOD = 48
const CLOUD_PERIOD_BLOCKS = CLOUD_PERIOD * CLOUD_CELL

/*
 * Extra cells built onto each end of the layer in X, so the wrapped drift
 * offset never drags the rim into view.
 *
 * The layer is centred on the player plus the drift, and the drift wraps
 * within +/- half a period, so the mesh centre sits up to 24 cells off the
 * player. Without this slack the near rim would close from 576 blocks to 288 --
 * 33 degrees above the horizon, which the radius comment above explains is
 * exactly what makes a cloud layer read as a disc hanging overhead rather
 * than as a ceiling.
 *
 * The shape that results is a capsule rather than a circle: a circle of radius
 * 48 cells swept along X. Whatever the drift offset, the player has a full
 * 576 blocks of cloud in every direction.
 */
const DRIFT_SLACK = CLOUD_PERIOD / 2

/*
 * Deterministic value hash. Math.random would reshuffle the sky on every page
 * load and, worse, on every rebuild of the layer.
 */
function hash01(i, j) {
  let h = Math.imul(i * 374761393 + j * 668265263, 1274126177)
  h = (h ^ (h >>> 13)) >>> 0
  return (h % 1000) / 1000
}

const smoothstep = t => t * t * (3 - 2 * t)
const lerp = (a, b, t) => a + (b - a) * t

/* Value noise: the hash sampled on a coarse lattice and smoothly interpolated
 * between lattice points, which is what turns isolated random cells into
 * connected shapes.
 *
 * The lattice COLUMN index wraps at CLOUD_PERIOD/period, which is what makes
 * the finished field repeat every CLOUD_PERIOD cells along X. Wrapping the
 * lattice rather than the sample coordinate matters: the interpolation still
 * runs between two adjacent lattice points at the seam, so the repeat is
 * seamless instead of showing a hard edge every 576 blocks. */
function valueNoise(i, j, period) {
  const x = i / period, z = j / period
  const x0 = Math.floor(x), z0 = Math.floor(z)
  const fx = smoothstep(x - x0), fz = smoothstep(z - z0)
  const columns = CLOUD_PERIOD / period
  const xa = ((x0 % columns) + columns) % columns
  const xb = (xa + 1) % columns
  return lerp(
    lerp(hash01(xa, z0), hash01(xb, z0), fx),
    lerp(hash01(xa, z0 + 1), hash01(xb, z0 + 1), fx),
    fz)
}

/*
 * Which cells are cloud.
 *
 * Rejected: a flat 42% random fill, which is what this was. It is invisible in
 * Fast mode -- a flat quad either side of a gap reads as one ragged sheet --
 * and it falls apart the moment the cells have sides, because scattered
 * single cells become a field of floating dice. Minecraft's clouds.png is
 * hand-drawn BLOBS, dozens of cells across with holes punched in them, so the
 * field has to be spatially correlated. Two octaves of value noise at periods
 * 8 and 3, thresholded, covers 38.6% of the sky in blobs of roughly the right
 * size -- measured over a 200x200 sample, not guessed.
 *
 * BOTH OCTAVE PERIODS MUST DIVIDE CLOUD_PERIOD, or the field stops repeating
 * at the distance the drift wraps by and the wrap becomes visible again. 8 and
 * 3 both divide 48. The day/night spec checks the repeat rather than trusting
 * this comment.
 */
function cellFilled(i, j) {
  return valueNoise(i, j, 8) * 0.7 + valueNoise(i, j, 3) * 0.3 > 0.55
}

function buildCloudLayer(noa, scene) {
  const mat = noa.rendering.makeStandardMaterial('cloud-mat')
  mat.disableLighting = true
  /*
   * White here; the tick loop rewrites it with the time-of-day and weather
   * colour. With lighting off, StandardMaterial multiplies emissiveColor into
   * the vertex colour below rather than adding to it (see the long note in
   * particles.js), so this one uniform dims every face and the per-face shades
   * keep their ratios.
   */
  mat.emissiveColor = new Color3(1, 1, 1)
  mat.specularColor = new Color3(0, 0, 0)
  // noa leaves ambientColor white and Babylon adds that term even with
  // lighting disabled, which blows flat white out to a glaring sheet.
  mat.ambientColor = new Color3(0, 0, 0)
  mat.alpha = CLOUD_ALPHA
  // Real boxes now, so the back faces are the insides and culling them is
  // both correct and half the fill. Fast mode needed them; Fancy does not.
  mat.backFaceCulling = true
  /*
   * DO NOT set needDepthPrePass here, however tempting it looks. Vanilla does
   * render clouds twice -- colour mask off to lay down depth, then again to
   * draw -- and that flag is Babylon's name for the same trick, but under
   * swiftshader it renders the layer SOLID BLACK: the prepass draw ignores the
   * colour mask, and the real draw is then rejected by its own depth. Babylon
   * writes depth for alpha-blended meshes anyway, which gets the part that
   * mattered (the nearest cloud face wins; no double-blended dark seams).
   */

  const positions = []
  const colors = []
  const indices = []

  /*
   * Corners counter-clockwise as seen from OUTSIDE the box -- and then the
   * indices are emitted backwards, because Babylon's front face is the
   * CLOCKWISE one. That is not a guess: a known-good box (blockMeshes' slab)
   * has every face's right-hand cross product pointing INTO the solid. Get it
   * backwards and the layer still draws, wrong side out: from below you see
   * the top face's shading on the underside, which is a very quiet bug.
   */
  const quad = (shade, ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz) => {
    const v = positions.length / 3
    positions.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz)
    for (let k = 0; k < 4; k++) colors.push(shade, shade, shade, 1)
    indices.push(v, v + 2, v + 1, v, v + 3, v + 2)
  }

  const R = CLOUD_RADIUS
  /*
   * Clipped to a CAPSULE -- a circle of radius R swept along X by the drift
   * slack, which for a zero offset is exactly the circle 1.21.6+ clips its own
   * layer to (`x*x + z*z <= r*r`). The clip matters for the same reason it
   * does in vanilla: the corners of a square reach 40% further than its edges,
   * and the only thing a player can tell from that is that the sky ends in a
   * straight line over there.
   *
   * Anything outside the capsule counts as EMPTY rather than as absent, which
   * is what keeps the rim's side faces: testing cellFilled alone would cull
   * each edge face against a neighbour that is never drawn and leave the rim
   * open, so the layer would be a ring of doorless rooms seen from below.
   * Cells outside the loop bounds fall out of the same test, so the edges of
   * the grid need no special case.
   */
  const filled = (i, j) => {
    const ci = Math.max(0, Math.abs(i + 0.5) - DRIFT_SLACK), cj = j + 0.5
    if (ci * ci + cj * cj > R * R) return false
    return cellFilled(i, j)
  }

  // Cells are indexed from the middle of the layer, not from a corner, because
  // the drift offset is measured from the middle and one of the two has to
  // carry the half-width otherwise.
  const RX = R + DRIFT_SLACK
  let cells = 0
  for (let i = -RX; i < RX; i++) {
    for (let j = -R; j < R; j++) {
      if (!filled(i, j)) continue
      cells++
      const x0 = i * CLOUD_CELL, x1 = x0 + CLOUD_CELL
      const z0 = j * CLOUD_CELL, z1 = z0 + CLOUD_CELL
      const y0 = 0, y1 = CLOUD_DEPTH

      quad(SHADE_TOP, x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0)
      quad(SHADE_BOTTOM, x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1)
      if (!filled(i - 1, j)) quad(SHADE_EW, x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0)
      if (!filled(i + 1, j)) quad(SHADE_EW, x1, y0, z0, x1, y1, z0, x1, y1, z1, x1, y0, z1)
      if (!filled(i, j - 1)) quad(SHADE_NS, x0, y0, z0, x0, y1, z0, x1, y1, z0, x1, y0, z0)
      if (!filled(i, j + 1)) quad(SHADE_NS, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1)
    }
  }

  const layer = new Mesh('clouds', scene)
  const vd = new VertexData()
  vd.positions = new Float32Array(positions)
  vd.colors = new Float32Array(colors)
  /*
   * 32-bit indices, because ~6800 quads is 27k vertices and a 16-bit index
   * buffer tops out at 65k -- one CLOUD_GRID bump away from a layer that
   * silently folds in on itself. Babylon picks the width from the array type.
   */
  vd.indices = new Uint32Array(indices)
  vd.applyToMesh(layer, false)
  layer.material = mat
  layer.isPickable = false
  // The layer is always overhead and always larger than the view; the octree's
  // culling test can only ever answer "yes".
  layer.alwaysSelectAsActiveMesh = true

  // REQUIRED. noa installs its own selection octree, so Babylon picks what to
  // render from that rather than from scene.meshes. A mesh built directly in
  // the scene and never registered here is silently never drawn.
  noa.rendering.addMeshToScene(layer)
  return { mesh: layer, mat, cells, quads: indices.length / 6 }
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

  /* Weather, as pushed in by weather.js. Owned there, applied here. */
  let rainLevel = 0
  let thunderLevel = 0
  let flash = 0

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

    time = (time + secs * MC.TICKS_PER_SECOND) % TICKS_PER_DAY

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
    /*
     * Vanilla multiplies the sun and moon's alpha by (1 - rainLevel), so a
     * storm swallows them rather than leaving a disc hanging in an overcast
     * sky. Nothing simulates cloud COVER -- this is the whole of it.
     */
    const celestialAlpha = 1 - rainLevel
    sun.mat.alpha = celestialAlpha
    moon.mat.alpha = celestialAlpha

    let sky = weatherTint(skyColorFor(elevation), rainLevel, thunderLevel, 0.75)
    /*
     * The lightning flash. Vanilla lerps the sky toward (0.8, 0.8, 1.0) by at
     * most 0.45 for the two ticks skyFlashTime lasts, and that is all it does
     * to the SKY -- the rest of what you see is the bolt entity itself lighting
     * the world. There is no bolt here, so the flash also drives the light
     * level below; a 0.45 tint on its own is nearly invisible.
     */
    if (flash > 0) sky = mix(sky, [0.8, 0.8, 1.0], flash * 0.45)
    scene_.clearColor.set(sky[0], sky[1], sky[2], 1)

    // Daylight drives the directional light and the ambient term together.
    // Night bottoms out at 0.18 rather than 0 because pitch black is
    // unreadable, and Minecraft's night isn't fully dark either.
    const daylight = clamp01(elevation * 2 + 0.35)
    /*
     * Minecraft's Level.updateSkyBrightness: rain costs five sixteenths of the
     * sky light and thunder five sixteenths again, multiplied, so a full
     * thunderstorm at noon is 0.69 * 0.69 = under half the daylight. That is
     * why a storm reads as dusk without the clock having moved.
     */
    const storm = (1 - rainLevel * 5 / 16) * (1 - thunderLevel * 5 / 16)
    const level = Math.max((0.18 + daylight * 0.82) * storm, flash)
    if (light) {
      light.intensity = level
      light.direction.set(-eastWest, -Math.max(elevation, 0.15), -0.3)
    }
    scene_.ambientColor.set(level * 0.5, level * 0.5, level * 0.5)

    /*
     * Cloud colour, Minecraft's Level.getCloudColor: white, tinted by the
     * weather, then scaled by the time of day -- red and green to 0.9x + 0.1,
     * blue to 0.85x + 0.15. The floors are why midnight clouds are dim blue
     * rather than black, and the blue floor being HIGHER is why they read as
     * cold at night instead of just dark.
     *
     * They are emissive, so without this they would glow at midnight like
     * strip lights.
     */
    const c = weatherTint([1, 1, 1], rainLevel, thunderLevel, 0.95)
    const cr = c[0] * (daylight * 0.9 + 0.1)
    const cg = c[1] * (daylight * 0.9 + 0.1)
    const cb = c[2] * (daylight * 0.85 + 0.15)
    clouds.mat.emissiveColor.set(
      Math.min(1, cr + flash * 0.6),
      Math.min(1, cg + flash * 0.6),
      Math.min(1, cb + flash * 0.6))

    /*
     * The layer follows the player EXACTLY, and the drift is the only motion
     * the sky has of its own.
     *
     * The old version snapped the recentering to whole cells, which is where
     * the clouds-jump-backwards bug lived: a snap is invisible only if the
     * field repeats every cell, and this one repeats every 48 (see
     * CLOUD_PERIOD). Crossing a cell boundary moved the layer a whole 12
     * blocks in the direction you were running, so the clouds stepped
     * backwards relative to you -- once every 1.5 seconds at sprint-jump
     * speed.
     *
     * Following exactly is what the snap was reaching for anyway: the reason
     * it existed was to stop the sky sliding around as you walk, and zero
     * parallax does that better than a snap with a jump in it. It costs the
     * one thing vanilla has and this does not -- clouds anchored in world
     * space, so you can walk out from under one -- and that trade is the
     * owner's call, recorded here so the next reader knows it was a choice.
     *
     * The wrap below is the one discontinuity left, and it is invisible by
     * construction: CLOUD_PERIOD_BLOCKS is exactly the distance the field
     * repeats over, so the layer lands on a copy of itself. Only the rim, 576
     * blocks out, has cells that come and go, and it happens once every 16
     * minutes.
     */
    drift += secs * CLOUD_DRIFT
    if (drift < -CLOUD_PERIOD_BLOCKS / 2) drift += CLOUD_PERIOD_BLOCKS
    global[0] = p[0] + drift
    global[1] = CLOUD_HEIGHT
    global[2] = p[2]
    noa.globalToLocal(global, null, local)
    clouds.mesh.position.set(local[0], local[1], local[2])
  })

  return {
    getTime: () => time,
    setTime: (t) => { time = ((t % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY },
    TICKS_PER_DAY,

    /**
     * Weather, pushed in by weather.js. Levels are 0..1 and already ramped --
     * this module does no smoothing of its own, so that "how fast does a storm
     * roll in" lives in exactly one place.
     */
    setWeatherLevels({ rain = 0, thunder = 0, flash: f = 0 } = {}) {
      rainLevel = clamp01(rain)
      thunderLevel = clamp01(thunder)
      flash = clamp01(f)
    },
    get rainLevel() { return rainLevel },
    get thunderLevel() { return thunderLevel },

    /** Cloud altitude and geometry, for the verification script. */
    clouds: {
      get mesh() { return clouds.mesh },
      get cells() { return clouds.cells },
      get quads() { return clouds.quads },
      height: CLOUD_HEIGHT,
      cell: CLOUD_CELL,
      depth: CLOUD_DEPTH,
      /*
       * The drift offset and the period it wraps at, exposed so a test can
       * check the continuity claim above rather than take it on trust. The
       * wrap is 16 minutes apart, which no test is going to sit through, so
       * the test it enables instead is the one that matters: that the field
       * really does repeat at this period, which is what makes the wrap
       * invisible whenever it does come around.
       */
      period: CLOUD_PERIOD_BLOCKS,
      periodCells: CLOUD_PERIOD,
      cellAt: cellFilled,
      get offset() { return drift },
    },
  }
}
