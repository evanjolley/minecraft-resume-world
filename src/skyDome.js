import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { Color3 } from '@babylonjs/core/Maths/math.color'

/*
 * What is behind the world: the sky gradient, the sunrise glow and the stars.
 *
 * WHY A DOME. The sky used to be scene.clearColor, one color for the whole
 * background. Vanilla's sky is not one color. Looking up you see the sky
 * color, toward the horizon it fades into the fog color, at sunrise and sunset
 * an orange fan sits on the horizon on the sun's side only, and at night there
 * are stars. One clear color has to pick between those, which is why sunset
 * used to turn the entire sky orange, overhead included.
 *
 * The dome is a low-poly sphere around the camera with per-vertex colors,
 * recolored each tick from src/celestial.js. Its material writes no depth, so
 * draw order against the terrain does not matter: anything nearer than the
 * dome wins the depth test or overwrites it. Sun, moon and clouds are alpha
 * blended and draw after every opaque mesh, so they land on top of it.
 *
 * The stars are vanilla's star field: the same 1500 draws from the same
 * java.util.Random seed (10842) that LevelRenderer.createStars makes, so the
 * same stars, in the same pattern, with the same per-star size and spin.
 */

const RADIUS = 400
const STAR_RADIUS = 300
// Elevation rings in degrees, dense near the horizon where the color changes.
const RINGS = [-90, -30, -10, -3, 0, 3, 7, 12, 20, 30, 45, 60, 75, 90]
const SEGMENTS = 32
// The sunrise fan's rim is 120 units out from a center 100 units away, so it
// reaches about 50 degrees from the horizon point it is centered on.
const FAN_REACH = Math.atan2(120, 100)

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smooth = (t) => t * t * (3 - 2 * t)

/** java.util.Random, which is what vanilla's LegacyRandomSource is. */
class JavaRandom {
  constructor(seed) {
    this.s = (BigInt(seed) ^ 0x5DEECE66Dn) & ((1n << 48n) - 1n)
  }
  next(bits) {
    this.s = (this.s * 0x5DEECE66Dn + 0xBn) & ((1n << 48n) - 1n)
    return Number(this.s >> BigInt(48 - bits))
  }
  nextFloat() { return this.next(24) / (1 << 24) }
  nextDouble() { return (this.next(26) * 134217728 + this.next(27)) / 9007199254740992 }
}

/*
 * LevelRenderer.createStars, 1.21.
 *
 * Each star is a quad of half-size m at distance 100, turned to face the
 * center and spun by a random angle. One quirk is kept on purpose: vanilla
 * builds the four corners with `vector3f.add(...)`, and JOML's add MUTATES,
 * so each corner is offset from the previous one rather than from the star's
 * center. The result is a diamond of half the intended area, offset by m.
 * That is what 1.21 draws, so it is what this draws.
 */
export function vanillaStars() {
  const rnd = new JavaRandom(10842)
  const stars = []
  for (let j = 0; j < 1500; j++) {
    const h = rnd.nextFloat() * 2 - 1
    const k = rnd.nextFloat() * 2 - 1
    const l = rnd.nextFloat() * 2 - 1
    const m = 0.15 + rnd.nextFloat() * 0.1
    const n = h * h + k * k + l * l
    if (n <= 0.010000001 || n >= 1) continue
    const len = Math.sqrt(n)
    const dir = [h / len, k / len, l / len]
    const spin = rnd.nextDouble() * Math.PI * 2
    stars.push({ dir, size: m, spin })
  }
  return stars
}

/** Two unit vectors perpendicular to `d` and to each other. */
function basis(d) {
  const a = Math.abs(d[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0]
  const u = [d[1] * a[2] - d[2] * a[1], d[2] * a[0] - d[0] * a[2], d[0] * a[1] - d[1] * a[0]]
  const ul = Math.hypot(...u)
  u[0] /= ul; u[1] /= ul; u[2] /= ul
  const v = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]]
  return [u, v]
}

function buildStars(noa, scene) {
  const positions = []
  const indices = []
  const scale = STAR_RADIUS / 100
  for (const { dir, size, spin } of vanillaStars()) {
    const [u, v] = basis(dir)
    const cs = Math.cos(spin), sn = Math.sin(spin)
    const ax = [u[0] * cs + v[0] * sn, u[1] * cs + v[1] * sn, u[2] * cs + v[2] * sn]
    const ay = [v[0] * cs - u[0] * sn, v[1] * cs - u[1] * sn, v[2] * cs - u[2] * sn]
    // Corner offsets in the star's own plane, accumulated as vanilla does.
    const steps = [[size, -size], [size, size], [-size, size], [-size, -size]]
    const at = [dir[0] * 100, dir[1] * 100, dir[2] * 100]
    const base = positions.length / 3
    for (const [sx, sy] of steps) {
      at[0] += ax[0] * sx + ay[0] * sy
      at[1] += ax[1] * sx + ay[1] * sy
      at[2] += ax[2] * sx + ay[2] * sy
      positions.push(at[0] * scale, at[1] * scale, at[2] * scale)
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const mesh = new Mesh('stars', scene)
  const vd = new VertexData()
  vd.positions = new Float32Array(positions)
  vd.indices = new Uint32Array(indices)
  vd.applyToMesh(mesh, false)
  const mat = noa.rendering.makeStandardMaterial('stars-mat')
  mat.disableLighting = true
  mat.emissiveColor = new Color3(1, 1, 1)
  mat.diffuseColor = new Color3(0, 0, 0)
  mat.ambientColor = new Color3(0, 0, 0)
  mat.backFaceCulling = false
  mat.disableDepthWrite = true
  mat.fogEnabled = false
  mat.alpha = 0
  mesh.material = mat
  mesh.isPickable = false
  mesh.infiniteDistance = true
  mesh.alwaysSelectAsActiveMesh = true
  mesh.applyFog = false
  // Drawn first among the transparent meshes, so clouds, sun and moon cover
  // stars rather than the other way round. Babylon renders lower alphaIndex
  // first and the default is Number.MAX_VALUE.
  mesh.alphaIndex = 0
  noa.rendering.addMeshToScene(mesh)
  return { mesh, mat, count: indices.length / 6 }
}

function buildDome(noa, scene) {
  const dirs = []
  for (const deg of RINGS) {
    const e = deg * Math.PI / 180
    for (let s = 0; s <= SEGMENTS; s++) {
      const a = (s / SEGMENTS) * Math.PI * 2
      dirs.push([Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)])
    }
  }
  const positions = new Float32Array(dirs.length * 3)
  dirs.forEach((d, i) => {
    positions[i * 3] = d[0] * RADIUS
    positions[i * 3 + 1] = d[1] * RADIUS
    positions[i * 3 + 2] = d[2] * RADIUS
  })
  const indices = []
  const row = SEGMENTS + 1
  for (let r = 0; r < RINGS.length - 1; r++) {
    for (let s = 0; s < SEGMENTS; s++) {
      const a = r * row + s, b = a + 1, c = a + row, d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }
  const colors = new Float32Array(dirs.length * 4).fill(1)
  const mesh = new Mesh('sky-dome', scene)
  const vd = new VertexData()
  vd.positions = positions
  vd.colors = colors
  vd.indices = new Uint32Array(indices)
  vd.applyToMesh(mesh, true)
  const mat = noa.rendering.makeStandardMaterial('sky-dome-mat')
  mat.disableLighting = true
  mat.emissiveColor = new Color3(1, 1, 1)
  mat.diffuseColor = new Color3(0, 0, 0)
  mat.ambientColor = new Color3(0, 0, 0)
  mat.backFaceCulling = false
  mat.disableDepthWrite = true
  mat.fogEnabled = false
  mesh.material = mat
  mesh.isPickable = false
  mesh.infiniteDistance = true
  mesh.alwaysSelectAsActiveMesh = true
  mesh.applyFog = false
  noa.rendering.addMeshToScene(mesh)
  return { mesh, dirs, colors }
}

export function installSkyDome(noa) {
  const scene = noa.rendering.getScene()
  const dome = buildDome(noa, scene)
  const stars = buildStars(noa, scene)

  /**
   * @param s.sky      color at the zenith (celestial.skyColor)
   * @param s.fog      color at the horizon (celestial.fogColor)
   * @param s.sunrise  [r, g, b, a] or null (celestial.sunriseColor)
   * @param s.sunX     x of the sun direction, whose sign picks the glow's side
   * @param s.angle    celestial angle, which turns the star field
   * @param s.stars    star alpha (celestial.starBrightness)
   */
  function update({ sky, fog, sunrise, sunX, angle, stars: starAlpha }) {
    const { dirs, colors } = dome
    const side = sunX < 0 ? -1 : 1
    for (let i = 0; i < dirs.length; i++) {
      const d = dirs[i]
      // Fog at and below the horizon, sky above about 25 degrees.
      const t = d[1] <= 0 ? 0 : smooth(clamp01(d[1] / 0.42))
      let r = fog[0] + (sky[0] - fog[0]) * t
      let g = fog[1] + (sky[1] - fog[1]) * t
      let b = fog[2] + (sky[2] - fog[2]) * t
      if (sunrise) {
        // Angle from the horizon point on the sun's side, (+-1, 0, 0).
        const ang = Math.acos(Math.max(-1, Math.min(1, d[0] * side)))
        const w = clamp01(1 - ang / FAN_REACH) * sunrise[3]
        r += (sunrise[0] - r) * w
        g += (sunrise[1] - g) * w
        b += (sunrise[2] - b) * w
      }
      colors[i * 4] = r
      colors[i * 4 + 1] = g
      colors[i * 4 + 2] = b
    }
    dome.mesh.updateVerticesData('color', colors)
    stars.mat.alpha = starAlpha
    stars.mesh.setEnabled(starAlpha > 0.001)
    // The star field turns with the sun: up maps to the sun's direction.
    stars.mesh.rotation.z = -angle * Math.PI * 2
  }

  function setEnabled(on) {
    dome.mesh.setEnabled(on)
    if (!on) stars.mesh.setEnabled(false)
  }

  return {
    update,
    setEnabled,
    get mesh() { return dome.mesh },
    get stars() { return stars.mesh },
    starCount: stars.count,
    /** The color the dome currently draws in direction d (unit vector), for specs. */
    colorToward(d) {
      let best = 0, bestDot = -2
      dome.dirs.forEach((v, i) => {
        const dot = v[0] * d[0] + v[1] * d[1] + v[2] * d[2]
        if (dot > bestDot) { bestDot = dot; best = i }
      })
      return [...dome.colors.slice(best * 4, best * 4 + 3)]
    },
  }
}
