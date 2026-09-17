import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture'
import { Engine } from '@babylonjs/core/Engines/engine'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { MC } from './physics.js'
import { entityBox } from './entityBox.js'

/*
 * THE SWIRL -- the coloured motes that orbit anything carrying an effect.
 *
 * WHY THIS IS NOT IN particles.js. That file is the right home for it and it
 * cannot host it today, for one structural reason and one scheduling one.
 *
 * The structural reason: particles.js keys its pooled systems BY TEXTURE
 * (`systems.get(texName)`) and every quad in a system draws the same texture
 * with the same material tint. That is exactly right for block chips, where
 * the texture IS the identity of the particle. It has nowhere to put a
 * PER-PARTICLE COLOUR -- and per-particle colour is the entire content of this
 * effect. Thirty-nine effects would become thirty-nine textures and
 * thirty-nine draw calls, and the colours are runtime data from a registry
 * rather than files on disk.
 *
 * The scheduling one: another agent is inside particles.js this pass adding
 * torch flame, so it is not mine to edit. See the report for the one thing I
 * would ask it for -- a spec flag for a vertex-colour system, which its rain
 * volume already builds privately (`vd.colors`, `mesh.hasVertexAlpha`) and
 * does not expose.
 *
 * So this is the same machinery as its neighbours -- one pooled mesh, quads
 * rewritten every frame, CPU billboarding, world coordinates offset once per
 * frame rather than per particle -- with a vertex-colour buffer instead of a
 * texture atlas. Read the header of particles.js first; every trap it names
 * (addMeshToScene or you draw nothing, `applyToMesh(mesh, true)` or the
 * updates are silent no-ops, globalToLocal once because noa rebases the
 * origin) applies here identically.
 */

/*
 * The mote texture, generated rather than shipped.
 *
 * Vanilla's is `particle/spell_*`, a soft 8x8 blob, and this world's texture
 * build does not extract it -- scripts/build-textures.mjs is owned elsewhere
 * this pass. A radial falloff is what the sprite IS, so it is cheaper to state
 * the falloff than to ship a picture of it: eight by eight, alpha fading from
 * the centre, white so the vertex colour is free to be the whole tint.
 *
 * WHITE MATTERS. The material multiplies texture by vertex colour, so any
 * tint baked into the texture would multiply against every effect's colour and
 * darken all of them.
 */
const MOTE_SIZE = 8

function moteTexture(scene) {
  const data = new Uint8Array(MOTE_SIZE * MOTE_SIZE * 4)
  const c = (MOTE_SIZE - 1) / 2
  for (let y = 0; y < MOTE_SIZE; y++) {
    for (let x = 0; x < MOTE_SIZE; x++) {
      const d = Math.hypot(x - c, y - c) / (MOTE_SIZE / 2)
      // Squared falloff, clipped at the edge: a linear one leaves a visible
      // square corner where the alpha has not quite reached zero.
      const a = Math.max(0, 1 - d * d)
      const i = (y * MOTE_SIZE + x) * 4
      data[i] = data[i + 1] = data[i + 2] = 255
      data[i + 3] = Math.round(a * 255)
    }
  }
  return RawTexture.CreateRGBATexture(
    data, MOTE_SIZE, MOTE_SIZE, scene, false, false, RawTexture.NEAREST_SAMPLINGMODE)
}

/*
 * Pool size. Vanilla spawns at most one mote per entity per tick, they live
 * under a second and a half, and this world has two bodies that can carry an
 * effect. 256 is two orders of headroom and one buffer of 4 KB.
 */
const POOL = 256

/* SpellParticle's lifetime: `(int)(8.0 / (random * 0.8 + 0.2))` ticks, which
 * is 8 to 40 ticks -- 0.4 to 2 seconds. */
const LIFE_MIN = 8 / MC.TICKS_PER_SECOND
const LIFE_MAX = 40 / MC.TICKS_PER_SECOND

/* Quad size in blocks. Vanilla's spell particle quadSize is about 0.2 scaled
 * by a random 0.5-1.5, and it shrinks over its life. */
const SIZE = 0.13

export function installEffectSwirl(noa, effects) {
  const scene = noa.rendering.getScene()

  const mat = noa.rendering.makeStandardMaterial('effect-swirl')
  mat.diffuseTexture = moteTexture(scene)
  mat.diffuseTexture.hasAlpha = true
  mat.useAlphaFromDiffuseTexture = true
  /*
   * ALPHA BLEND, not the alpha TEST particles.js uses for its flames, and the
   * two choices are opposite for a reason. A flame is four lit pixels with
   * hard edges and vanilla renders it on an opaque pass. A spell mote is a
   * soft blob whose entire shape is its alpha gradient -- cut it at 0.5 and it
   * becomes a hexagon. The cost is that these are not depth-sorted against
   * each other, which is invisible here because they are all nearly the same
   * colour and nearly the same depth.
   */
  mat.alphaMode = Engine.ALPHA_COMBINE
  mat.emissiveColor = new Color3(1, 1, 1)
  mat.specularColor = new Color3(0, 0, 0)
  mat.ambientColor = new Color3(0, 0, 0)
  mat.disableLighting = true
  mat.backFaceCulling = false
  // Motes must not occlude each other or the world behind them; they are the
  // one thing in this file that would look wrong writing depth.
  mat.disableDepthWrite = true

  const positions = new Float32Array(POOL * 4 * 3)
  const uvs = new Float32Array(POOL * 4 * 2)
  const colors = new Float32Array(POOL * 4 * 4)
  const indices = new Uint32Array(POOL * 6)
  for (let i = 0; i < POOL; i++) {
    const v = i * 4, o = i * 6
    indices[o] = v; indices[o + 1] = v + 1; indices[o + 2] = v + 2
    indices[o + 3] = v; indices[o + 4] = v + 2; indices[o + 5] = v + 3
    // UVs never change: every mote shows the whole 8x8 sprite.
    const t = i * 8
    uvs[t] = 0; uvs[t + 1] = 0
    uvs[t + 2] = 1; uvs[t + 3] = 0
    uvs[t + 4] = 1; uvs[t + 5] = 1
    uvs[t + 6] = 0; uvs[t + 7] = 1
  }

  const mesh = new Mesh('effect-swirl', scene)
  const vd = new VertexData()
  vd.positions = positions
  vd.uvs = uvs
  vd.colors = colors
  vd.indices = indices
  vd.applyToMesh(mesh, true)
  mesh.material = mat
  mesh.isPickable = false
  // Without this Babylon ignores the alpha channel of the colour buffer and
  // every mote draws at full strength with no fade at all.
  mesh.hasVertexAlpha = true
  noa.rendering.addMeshToScene(mesh)
  mesh.alwaysSelectAsActiveMesh = true
  mesh.setEnabled(false)

  /* Pre-allocated, for the reason particles.js states: allocating mid-burst
   * puts a GC pause exactly where the frame rate matters. */
  const pool = []
  for (let i = 0; i < POOL; i++) {
    pool.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, r: 1, g: 1, b: 1 })
  }
  let liveCount = 0

  const originGlobal = [0, 0, 0]
  const originLocal = [0, 0, 0]

  /**
   * One mote, somewhere on the body.
   *
   * ACROSS THE WHOLE BOX, not at a point. Vanilla's spawn is
   * `getRandomX(0.5), getRandomY(), getRandomZ(0.5)` -- a uniform pick through
   * the entity's bounding box, which is why the swirl wraps a player rather
   * than puffing out of their navel. entityBox.js already answers "where is
   * this body, in world coordinates" and answers it in the frame this needs;
   * reading `body.aabb` instead is the trap that file documents at length,
   * because the physics solver runs in noa's rebased frame.
   */
  function spawn(entity, color) {
    if (liveCount >= POOL) return
    const box = entityBox(noa, entity)
    if (!box) return
    const p = pool[liveCount++]
    p.x = box.min[0] + Math.random() * (box.max[0] - box.min[0])
    p.y = box.min[1] + Math.random() * (box.max[1] - box.min[1])
    p.z = box.min[2] + Math.random() * (box.max[2] - box.min[2])
    // A slow outward drift, no gravity. SpellParticle zeroes its own gravity
    // and keeps a small residual velocity; a falling mote reads as ash.
    p.vx = (Math.random() - 0.5) * 0.35
    p.vy = (Math.random() - 0.5) * 0.35
    p.vz = (Math.random() - 0.5) * 0.35
    p.age = 0
    p.life = LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN)
    p.r = color[0]; p.g = color[1]; p.b = color[2]
  }

  /*
   * Spawning is on the TICK and drawing is on the FRAME, which is the same
   * split hud.js's blink uses and for the same reason: the spawn chance is
   * 1-in-4 PER MINECRAFT TICK, so rolling it per frame would make the density
   * a function of the frame rate. A 144 Hz machine would be lousy with motes.
   *
   * noa ticks at 30 and Minecraft at 20, so the chance is scaled by 20/30 --
   * the RATE is what vanilla specifies (five motes a second at 1-in-4), not
   * the per-tick probability, and the rate is what has to survive the
   * conversion.
   */
  const TICK_RATIO = MC.TICKS_PER_SECOND / 30

  noa.on('tick', () => {
    for (const entity of effects.affected) {
      const color = effects.swirlColor(entity)
      if (!color) continue
      if (Math.random() < effects.swirlChance(entity) * TICK_RATIO) spawn(entity, color)
    }
  })

  let wasDrawn = false

  function onFrame(dtMs) {
    const dt = Math.min(0.05, dtMs / 1000)

    if (liveCount === 0) {
      // One last upload with the buffer emptied, then stop touching it. Left
      // enabled with stale vertices, the final motes hang frozen in the air.
      if (wasDrawn) { mesh.setEnabled(false); wasDrawn = false }
      return
    }

    // Rows 0 and 1 of the camera's world matrix are its right and up axes.
    const m = noa.rendering.camera.getWorldMatrix().m
    const rx = m[0], ry = m[1], rz = m[2]
    const ux = m[4], uy = m[5], uz = m[6]

    noa.globalToLocal(originGlobal, null, originLocal)

    for (let i = 0; i < liveCount; i++) {
      const p = pool[i]
      p.age += dt
      if (p.age >= p.life) {
        // Swap-remove, so [0, liveCount) stays contiguous and only the live
        // range is ever uploaded.
        pool[i] = pool[--liveCount]
        pool[liveCount] = p
        i--
        continue
      }
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt

      const t = p.age / p.life
      // Fade out over the second half only. Fading from birth makes the swirl
      // look like it is always dying; vanilla's spell particle holds full
      // alpha and shrinks instead.
      const alpha = t < 0.5 ? 1 : 1 - (t - 0.5) * 2
      const s = SIZE * (1 - t * t * 0.5)

      const x = p.x - originGlobal[0] + originLocal[0]
      const y = p.y - originGlobal[1] + originLocal[1]
      const z = p.z - originGlobal[2] + originLocal[2]

      const ax = rx * s, ay = ry * s, az = rz * s
      const bx = ux * s, by = uy * s, bz = uz * s

      const o = i * 12
      positions[o]     = x - ax - bx; positions[o + 1]  = y - ay - by; positions[o + 2]  = z - az - bz
      positions[o + 3] = x + ax - bx; positions[o + 4]  = y + ay - by; positions[o + 5]  = z + az - bz
      positions[o + 6] = x + ax + bx; positions[o + 7]  = y + ay + by; positions[o + 8]  = z + az + bz
      positions[o + 9] = x - ax + bx; positions[o + 10] = y - ay + by; positions[o + 11] = z - az + bz

      const c = i * 16
      for (let k = 0; k < 4; k++) {
        colors[c + k * 4] = p.r
        colors[c + k * 4 + 1] = p.g
        colors[c + k * 4 + 2] = p.b
        colors[c + k * 4 + 3] = alpha
      }
    }

    // Dead slots keep whatever they last held, so they are collapsed to a
    // degenerate quad rather than left drawing a stale mote at full alpha.
    for (let i = liveCount; i < POOL; i++) {
      const o = i * 12
      for (let k = 0; k < 12; k++) positions[o + k] = 0
      const c = i * 16
      for (let k = 0; k < 4; k++) colors[c + k * 4 + 3] = 0
    }

    mesh.updateVerticesData('position', positions, false, false)
    mesh.updateVerticesData('color', colors, false, false)
    if (!wasDrawn) { mesh.setEnabled(true); wasDrawn = true }
  }

  noa.on('beforeRender', onFrame)

  return {
    /** Live motes. The spec asserts this is non-empty before asserting colour. */
    get live() { return liveCount },
    /** Every live mote's colour, 0-1 per channel. For the spec's assertions. */
    colors() {
      const out = []
      for (let i = 0; i < liveCount; i++) out.push([pool[i].r, pool[i].g, pool[i].b])
      return out
    },
    dispose() { noa.off('beforeRender', onFrame); mesh.dispose() },
  }
}
