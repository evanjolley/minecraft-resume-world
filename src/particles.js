import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { BLOCK_BY_ID } from './blocks.js'

/*
 * Block particles: the burst when a block breaks, the puff when you land, the
 * dust you kick up sprinting, and the crumbs falling off a block you're mining.
 *
 * Minecraft's particles carry more weight than they look like they should.
 * Breaking a block without them feels like the block was deleted rather than
 * broken, and the difference is entirely in the 24 chips of its own texture
 * that spray out for half a second.
 *
 * HOW THIS IS DRAWN, and what was rejected.
 *
 * The naive version is one small Babylon mesh per particle with
 * `billboardMode = ALL`. It works and it destroys the frame rate: a single
 * break is two dozen meshes, each its own draw call, each allocated and
 * disposed within a second. So instead there is ONE mesh per block texture,
 * holding a fixed pool of quads, whose vertex buffer is rewritten each frame.
 * Particles cost buffer writes, not allocations, and a burst is one draw call.
 *
 * Also rejected: thin instances. They'd give per-particle transforms for free,
 * but every instance shares the base mesh's UVs, and Minecraft's whole look
 * here comes from each chip showing a DIFFERENT random 4x4 corner of the
 * block's texture. Owning the vertex buffer is what buys that.
 *
 * Billboarding is therefore done on the CPU: the camera's right and up vectors
 * are read once per frame and each quad is built from them, rotated in-plane by
 * its own tumble angle. Two dozen 3-float multiplies is nothing next to the
 * per-mesh matrix work Babylon would otherwise do.
 *
 * SUBTLE: noa rebases the world origin as you travel, so particle positions are
 * kept in world space and the whole mesh is offset by `globalToLocal` once per
 * frame. Writing world coordinates straight into the vertex buffer looks
 * perfect near spawn and drifts the further you walk.
 */

// Per block texture. A burst is 24, so this holds several overlapping bursts
// plus the sprint dust running underneath them.
const POOL = 160

// Minecraft's terrain particles: gravity 0.04 blocks/tick^2 and a 0.98 velocity
// multiplier per tick, converted to per-second.
const GRAVITY = 16
const DRAG_PER_TICK = 0.98
const TICKS_PER_SECOND = 20

// Minecraft chips a random 4x4 texel corner out of the 16x16 block texture.
const CROPS = 4
const CROP = 1 / CROPS

const rand = (a, b) => a + Math.random() * (b - a)

/*
 * The texture a block sheds when it breaks.
 *
 * Minecraft uses the model's `particle` texture, which for a grass block is
 * DIRT, not the green top -- break one and you get brown chips with the green
 * fringe nowhere in sight. blocks.js already names dirt as the grass block's
 * bottom face, so `all ?? bottom` lands on the right one for free.
 */
function textureFor(id) {
  const def = BLOCK_BY_ID.get(id)
  if (!def) return null
  return def.all ?? def.bottom ?? def.side ?? null
}

export function installParticles(noa, deps = {}) {
  const { interaction, movement } = deps
  const scene = noa.rendering.getScene()

  /* ---- one pooled mesh per block texture, built on first use ---- */

  const systems = new Map()

  function systemFor(texName) {
    let sys = systems.get(texName)
    if (sys) return sys

    const tex = new Texture(`/textures/${texName}.png`, scene, true, false, Texture.NEAREST_SAMPLINGMODE)
    const mat = noa.rendering.makeStandardMaterial(`particle-${texName}`)
    /*
     * Unlit, with brightness carried by emissiveColor. Babylon needs vertex
     * normals to shade a surface, and these quads are rebuilt every frame
     * facing the camera -- generating normals for them would cost more than the
     * particles do. So the light level is taken from noa's directional light
     * instead, which sky.js already drives off the sun's elevation, and the
     * chips darken through dusk for free without touching a shader.
     *
     * THE TRAP, and it cost a screenshot: the obvious spelling is
     * emissiveTexture plus a dimmed emissiveColor. Babylon ADDS those two, so
     * dimming to 0.9 doesn't darken the chips, it floods them to solid white
     * squares. StandardMaterial's actual line is
     *   finalDiffuse = clamp(diffuseBase * diffuseColor + emissiveColor
     *                        + ambient) * baseColor
     * so with lighting off (diffuseBase = 0) emissiveColor MULTIPLIES the
     * diffuse texture. Same recipe sky.js uses to dim the clouds at night.
     */
    mat.diffuseTexture = tex
    // Rewritten every frame from the sun; this initial value only covers the
    // handful of frames before the first update.
    mat.emissiveColor = new Color3(1, 1, 1)
    mat.specularColor = new Color3(0, 0, 0)
    // noa leaves ambientColor white and Babylon adds that term even with
    // lighting disabled, which lifts the chips back to flat white.
    mat.ambientColor = new Color3(0, 0, 0)
    mat.disableLighting = true
    // The quads are two-sided by nature -- a tumbling chip shows its back half
    // the time -- so culling would make them strobe.
    mat.backFaceCulling = false

    const positions = new Float32Array(POOL * 4 * 3)
    const uvs = new Float32Array(POOL * 4 * 2)
    const indices = new Uint32Array(POOL * 6)
    for (let i = 0; i < POOL; i++) {
      const v = i * 4, o = i * 6
      indices[o] = v; indices[o + 1] = v + 1; indices[o + 2] = v + 2
      indices[o + 3] = v; indices[o + 4] = v + 2; indices[o + 5] = v + 3
    }

    const mesh = new Mesh(`particles-${texName}`, scene)
    const vd = new VertexData()
    vd.positions = positions
    vd.uvs = uvs
    vd.indices = indices
    // `true` = updatable, which is the whole point: without it Babylon uploads
    // the buffer once and updateVerticesData silently does nothing.
    vd.applyToMesh(mesh, true)
    mesh.material = mat
    mesh.isPickable = false
    /*
     * REQUIRED. noa installs its own selection octree, so Babylon renders what
     * that octree hands it rather than everything in scene.meshes. A mesh built
     * straight into the scene and never registered here is silently never
     * drawn -- no error, no warning, it simply isn't there.
     */
    noa.rendering.addMeshToScene(mesh)
    // The bounding box is meaningless when the vertices are rewritten every
    // frame, so skip the octree's culling test rather than recompute it.
    mesh.alwaysSelectAsActiveMesh = true
    mesh.setEnabled(false)

    // Pre-allocated particle records. Allocating these lazily would put a GC
    // pause exactly where the frame rate matters, which is mid-burst.
    const pool = []
    for (let i = 0; i < POOL; i++) {
      pool.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, size: 0.1, spin: 0, spinRate: 0, u: 0, v: 0 })
    }

    sys = { mesh, mat, positions, uvs, pool, live: 0, drawn: 0 }
    systems.set(texName, sys)
    return sys
  }

  /* ---- spawning ---- */

  function emit(blockId, x, y, z, vx, vy, vz, life, size) {
    const texName = textureFor(blockId)
    if (!texName) return null
    const sys = systemFor(texName)
    /*
     * A full pool drops the new particle rather than stealing the oldest.
     * Recycling the oldest would make a big burst visibly eat its own tail,
     * and at 160 live chips nobody can tell one is missing anyway.
     */
    if (sys.live >= POOL) return null

    const p = sys.pool[sys.live++]
    p.x = x; p.y = y; p.z = z
    p.vx = vx; p.vy = vy; p.vz = vz
    p.age = 0; p.life = life; p.size = size
    p.spin = rand(0, Math.PI * 2)
    p.spinRate = rand(-6, 6)
    p.u = Math.floor(Math.random() * CROPS) * CROP
    p.v = Math.floor(Math.random() * CROPS) * CROP
    return p
  }

  /*
   * The break burst. Minecraft subdivides the block into a 4x4x4 grid and
   * throws one particle from each cell, moving away from the centre -- which is
   * why a break reads as the block coming apart rather than as a puff at its
   * middle. Same idea at a quarter of the count, which is indistinguishable in
   * motion and four times cheaper.
   */
  const BURST_COUNT = 24

  function burst(blockId, [bx, by, bz]) {
    for (let i = 0; i < BURST_COUNT; i++) {
      const ox = rand(0.1, 0.9), oy = rand(0.1, 0.9), oz = rand(0.1, 0.9)
      emit(blockId, bx + ox, by + oy, bz + oz,
        (ox - 0.5) * 5 + rand(-0.6, 0.6),
        (oy - 0.5) * 5 + rand(0.5, 2.2),
        (oz - 0.5) * 5 + rand(-0.6, 0.6),
        rand(0.5, 1.0), rand(0.07, 0.13))
    }
  }

  /*
   * Landing puff. Scaled by how hard you hit, because a hop and a four-block
   * drop wanting the same spray is the tell that it's canned. Spawned in a ring
   * at the feet with outward velocity, so it reads as displaced ground rather
   * than as something falling off the player.
   */
  const LAND_MIN_SPEED = 7   // roughly a one-block drop; a jump lands at ~8.9

  function landingPuff(blockId, [px, py, pz], speed) {
    if (speed < LAND_MIN_SPEED) return
    const count = Math.min(20, Math.round((speed - LAND_MIN_SPEED) * 1.2) + 4)
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2)
      const out = rand(1.0, 2.6)
      emit(blockId, px + Math.cos(a) * 0.25, py + 0.06, pz + Math.sin(a) * 0.25,
        Math.cos(a) * out, rand(0.4, 1.6), Math.sin(a) * out,
        rand(0.35, 0.7), rand(0.06, 0.1))
    }
  }

  /* Sprint dust: one chip, kicked backwards from the heel. */
  function sprintDust(blockId, [px, py, pz], hx, hz) {
    emit(blockId, px + rand(-0.15, 0.15), py + 0.05, pz + rand(-0.15, 0.15),
      -hx * rand(0.6, 1.6) + rand(-0.4, 0.4), rand(0.6, 1.6), -hz * rand(0.6, 1.6) + rand(-0.4, 0.4),
      rand(0.3, 0.6), rand(0.05, 0.09))
  }

  /*
   * Mining crumbs, off a face of the block being broken.
   *
   * The face matters. Spawning them inside the block would put every crumb
   * behind an opaque surface, and the ground test below would then shove them
   * out through the top. Minecraft picks faces that touch air, which is the
   * same rule and looks right from every angle.
   */
  const CRUMB_INTERVAL = 0.12
  const FACES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]

  function crumb(blockId, [bx, by, bz]) {
    const open = FACES.filter(([dx, dy, dz]) => !noa.getBlock(bx + dx, by + dy, bz + dz))
    if (!open.length) return
    const [dx, dy, dz] = open[Math.floor(Math.random() * open.length)]
    // On the face, nudged a hair clear of it so it doesn't z-fight the block.
    const at = (d) => (d === 0 ? rand(0.15, 0.85) : d > 0 ? 1.06 : -0.06)
    emit(blockId, bx + at(dx), by + at(dy), bz + at(dz),
      dx * rand(0.2, 0.8) + rand(-0.3, 0.3),
      dy * rand(0.2, 0.8) + rand(-0.2, 0.1),
      dz * rand(0.2, 0.8) + rand(-0.3, 0.3),
      rand(0.35, 0.8), rand(0.05, 0.09))
  }

  /* ---- the per-frame rebuild ---- */

  const originGlobal = [0, 0, 0]
  const originLocal = [0, 0, 0]

  noa.on('beforeRender', (dtMs) => {
    const dt = Math.min(0.05, dtMs / 1000) // a tab-switch stall must not teleport everything
    if (!systems.size) return

    // Camera basis, read once and shared by every quad this frame. Rows 0 and 1
    // of a world matrix are the right and up axes.
    const m = noa.rendering.camera.getWorldMatrix().m
    const rx = m[0], ry = m[1], rz = m[2]
    const ux = m[4], uy = m[5], uz = m[6]

    // Where world (0,0,0) currently sits in Babylon's frame. Doing this once
    // and offsetting the mesh beats converting every particle.
    noa.globalToLocal(originGlobal, null, originLocal)

    // sky.js drives this off the sun's elevation, so particles darken with the
    // world instead of glowing through the night.
    const level = noa.rendering.light ? noa.rendering.light.intensity : 1
    const lit = Math.min(1, 0.22 + level * 0.78) * 0.9

    const drag = Math.pow(DRAG_PER_TICK, dt * TICKS_PER_SECOND)

    for (const sys of systems.values()) {
      const { pool, positions, uvs } = sys

      for (let i = 0; i < sys.live; i++) {
        const p = pool[i]
        p.age += dt
        if (p.age >= p.life) {
          // Swap-remove: the last live particle takes this slot, so the live
          // range stays contiguous and only [0, live) is ever uploaded.
          sys.pool[i] = pool[--sys.live]
          sys.pool[sys.live] = p
          i--
          continue
        }

        p.vy -= GRAVITY * dt
        p.vx *= drag; p.vy *= drag; p.vz *= drag
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt

        /*
         * Rest on whatever they land on. Only when falling: a chip drifting
         * sideways into a wall would otherwise get lifted onto its top, and
         * the crumbs spawned against a block face are doing exactly that.
         */
        if (p.vy < 0) {
          const by = Math.floor(p.y)
          if (noa.getBlock(Math.floor(p.x), by, Math.floor(p.z))) {
            p.y = by + 1.002
            p.vy = 0
            // Minecraft's particles skid to a stop rather than sticking.
            p.vx *= 0.6; p.vz *= 0.6
          }
        }

        p.spin += p.spinRate * dt

        // Billboard, tumbled in-plane. Half-size, because the corners are
        // offset both ways from the centre.
        const h = p.size * 0.5
        const c = Math.cos(p.spin), s = Math.sin(p.spin)
        const ax = (rx * c + ux * s) * h, ay = (ry * c + uy * s) * h, az = (rz * c + uz * s) * h
        const bx2 = (-rx * s + ux * c) * h, by2 = (-ry * s + uy * c) * h, bz2 = (-rz * s + uz * c) * h

        const o = i * 12
        positions[o] = p.x - ax - bx2; positions[o + 1] = p.y - ay - by2; positions[o + 2] = p.z - az - bz2
        positions[o + 3] = p.x + ax - bx2; positions[o + 4] = p.y + ay - by2; positions[o + 5] = p.z + az - bz2
        positions[o + 6] = p.x + ax + bx2; positions[o + 7] = p.y + ay + by2; positions[o + 8] = p.z + az + bz2
        positions[o + 9] = p.x - ax + bx2; positions[o + 10] = p.y - ay + by2; positions[o + 11] = p.z - az + bz2

        const t = i * 8
        uvs[t] = p.u; uvs[t + 1] = p.v
        uvs[t + 2] = p.u + CROP; uvs[t + 3] = p.v
        uvs[t + 4] = p.u + CROP; uvs[t + 5] = p.v + CROP
        uvs[t + 6] = p.u; uvs[t + 7] = p.v + CROP
      }

      /*
       * Collapse every slot that WAS drawn and no longer is. The index buffer
       * covers the whole pool -- it's static -- so a slot the live count has
       * shrunk past still renders whatever it held last frame. Missing this is
       * how a burst leaves a frozen chip hanging in the air.
       */
      for (let i = sys.live; i < sys.drawn; i++) {
        const o = i * 12
        for (let k = 0; k < 12; k++) positions[o + k] = 0
      }
      const wasDrawn = sys.drawn
      sys.drawn = sys.live
      if (!sys.live) {
        // One last upload, to clear the tail, then stop drawing entirely.
        if (wasDrawn) sys.mesh.updateVerticesData('position', positions, false, false)
        sys.mesh.setEnabled(false)
        continue
      }

      sys.mat.emissiveColor.set(lit, lit, lit)
      sys.mesh.position.set(originLocal[0], originLocal[1], originLocal[2])
      sys.mesh.updateVerticesData('position', positions, false, false)
      sys.mesh.updateVerticesData('uv', uvs, false, false)
      sys.mesh.setEnabled(true)
    }
  })

  /* ---- wiring ---- */

  const unsubscribe = []

  if (interaction) {
    unsubscribe.push(interaction.onBlockBreak(({ id, position }) => burst(id, position)))

    let sinceCrumb = 0
    unsubscribe.push(interaction.onBreakProgress(({ id, position, dt }) => {
      if (!position) { sinceCrumb = 0; return }
      sinceCrumb += dt
      if (sinceCrumb < CRUMB_INTERVAL) return
      sinceCrumb = 0
      crumb(id, position)
    }))
  }

  if (movement) {
    unsubscribe.push(movement.onLand(({ position, blockId, speed }) => {
      landingPuff(blockId, position, speed)
    }))
  }

  /*
   * Sprint dust is polled rather than driven by an event, because Minecraft
   * spawns it every tick you're sprinting on the ground, not once per footstep
   * -- hanging it off onFootstep would give a puff every 1.6 blocks instead of
   * a continuous trail.
   */
  const SPRINT_INTERVAL = 0.05
  let sinceDust = 0

  if (movement?.isSprinting) {
    noa.on('tick', (dtMs) => {
      if (!movement.isSprinting()) { sinceDust = 0; return }
      const body = noa.ents.getPhysics(noa.playerEntity).body
      if (body.atRestY() >= 0) return
      sinceDust += dtMs / 1000
      if (sinceDust < SPRINT_INTERVAL) return
      sinceDust = 0
      const pos = noa.ents.getPositionData(noa.playerEntity).position
      const blockId = noa.getBlock(Math.floor(pos[0]), Math.floor(pos[1] - 0.1), Math.floor(pos[2]))
      if (!blockId) return
      const h = noa.ents.getMovement(noa.playerEntity).heading
      sprintDust(blockId, pos, Math.sin(h), Math.cos(h))
    })
  }

  return {
    burst,
    landingPuff,
    crumb,
    /** Live particle count, and how many pooled meshes exist. One per texture. */
    get live() { let n = 0; for (const s of systems.values()) n += s.live; return n },
    get meshes() { return systems.size },
    get capacity() { return systems.size * POOL },
    dispose() { unsubscribe.forEach(fn => fn()) },
  }
}
