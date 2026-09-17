import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { BLOCK_BY_ID, BLOCK_TYPES } from './blocks.js'
import { FACINGS } from './blockMeshes.js'
import { MC } from './physics.js'

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
 *
 * TWO KINDS OF PARTICLE NOW LIVE HERE, and the second one is why the mesh
 * builder below takes a SPEC instead of hardcoding its physics.
 *
 *   BLOCK particles (the four effects above) are BURSTS: something happens,
 *   two dozen chips of a block's own texture fly out, and a second later they
 *   are gone. They fall, they land, and they show a random 4x4 crop.
 *
 *   The TORCH FLAME is AMBIENT: it never stops, it has no gravity, it does not
 *   land on anything, it is a whole 8x8 sprite rather than a crop of a block,
 *   and it comes off `particle/flame.png` -- the first texture this file has
 *   drawn that is not a block face. See the torch section at the bottom.
 *
 * Everything they share -- the pooled mesh, the CPU billboard, the world-space
 * rebase, the swap-remove -- is shared. Everything they differ on is a field
 * on the spec the system was built with, so adding the flame did not fork the
 * per-frame loop and cannot have changed what a break burst does.
 */

const rand = (a, b) => a + Math.random() * (b - a)

/*
 * What a pooled mesh is, beyond its texture. One of these per system; the
 * per-frame loop reads nothing else about how a particle behaves.
 *
 *   pool       quads held, and the hard cap on live particles
 *   gravity    blocks/second^2, downward
 *   dragTick   velocity multiplier per Minecraft tick (converted at use)
 *   collide    stop on the top of a solid block, or pass through everything
 *   crops      texture is diced into crops x crops cells, one picked per
 *              particle; 1 means "the whole sprite"
 *   spin       max in-plane tumble, radians/second
 *   shrink     Minecraft's `quadSize * (1 - t^2 * 0.5)` taper over the life
 *   dimmed     darken with the sun, or stay at full brightness
 *   alphaTest  the texture has holes in it and they must not draw
 */

// Minecraft's terrain particles: gravity 0.04 blocks/tick^2 and a 0.98 velocity
// multiplier per tick, converted to per-second. A burst is 24 chips, so 160
// holds several overlapping bursts plus the sprint dust running underneath.
const BLOCK_SPEC = {
  pool: 160,
  gravity: 16,
  dragTick: 0.98,
  collide: true,
  // Minecraft chips a random 4x4 texel corner out of the 16x16 block texture.
  crops: 4,
  spin: 6,
  shrink: false,
  dimmed: true,
  alphaTest: false,
}

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

  function systemFor(texName, spec) {
    let sys = systems.get(texName)
    if (sys) return sys

    /*
     * invertY TRUE, and the fourth argument is worth the paragraph because it
     * was false and the flame burned upside down.
     *
     * The UV writer below puts V=0 at the BOTTOM of the quad. Babylon's
     * invertY is what decides which row of the PNG V=0 lands on: false means
     * row 0, which is the TOP of the image. So with it off, the top of every
     * sprite renders at the bottom of every quad.
     *
     * Nothing noticed for as long as this file only drew block chips. A chip
     * is a random 4x4 cell of a block texture, spun by a random angle, so
     * mirroring it changes a picture nobody could describe. A FLAME is not
     * like that: vanilla's particle/flame.png is red (255,0,0) at the top and
     * white-hot (255,245,198) at the bottom, because a flame is hottest where
     * it meets what is burning. Flipped, the torch had dark red sitting on
     * its head and a white glow floating above it -- which was measured, not
     * guessed: the colour profile down the flame's centre column read white,
     * yellow, orange, red from top to bottom, exactly reversed.
     */
    const tex = new Texture(`/textures/${texName}.png`, scene, true, true, Texture.NEAREST_SAMPLINGMODE)
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
    /*
     * Cutout, for a sprite that is mostly nothing. A block chip is a crop of
     * an opaque texture and needs none of this; a flame is four lit pixels in
     * an 8x8 square and without it the other sixty draw as black.
     *
     * ALPHA TEST, not alpha blend, which is also what vanilla does -- its
     * flame renders on PARTICLE_SHEET_OPAQUE, an alpha-tested pass. Blending
     * would need these quads depth-sorted against each other, and a torch is
     * a cluster of overlapping flames at almost the same depth, which is the
     * worst case for sorting and the best case for not needing to.
     *
     * Also rejected: additive blending. It is the obvious reach for something
     * that glows and vanilla does not use it -- an additive flame washes out
     * to white where two overlap, which is exactly where a torch puts them.
     */
    if (spec.alphaTest) {
      tex.hasAlpha = true
      mat.useAlphaFromDiffuseTexture = true
      mat.transparencyMode = 1 // Material.MATERIAL_ALPHATEST, without the import
      mat.alphaCutOff = 0.5
    }

    const positions = new Float32Array(spec.pool * 4 * 3)
    const uvs = new Float32Array(spec.pool * 4 * 2)
    const indices = new Uint32Array(spec.pool * 6)
    for (let i = 0; i < spec.pool; i++) {
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
    for (let i = 0; i < spec.pool; i++) {
      pool.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, size: 0.1, spin: 0, spinRate: 0, u: 0, v: 0 })
    }

    sys = { mesh, mat, positions, uvs, pool, spec, live: 0, drawn: 0 }
    systems.set(texName, sys)
    return sys
  }

  /* ---- spawning ---- */

  function emitTex(texName, spec, x, y, z, vx, vy, vz, life, size) {
    const sys = systemFor(texName, spec)
    /*
     * A full pool drops the new particle rather than stealing the oldest.
     * Recycling the oldest would make a big burst visibly eat its own tail,
     * and at 160 live chips nobody can tell one is missing anyway.
     */
    if (sys.live >= spec.pool) return null

    const p = sys.pool[sys.live++]
    p.x = x; p.y = y; p.z = z
    p.vx = vx; p.vy = vy; p.vz = vz
    p.age = 0; p.life = life; p.size = size
    p.spin = spec.spin ? rand(0, Math.PI * 2) : 0
    p.spinRate = spec.spin ? rand(-spec.spin, spec.spin) : 0
    const crop = 1 / spec.crops
    p.u = Math.floor(Math.random() * spec.crops) * crop
    p.v = Math.floor(Math.random() * spec.crops) * crop
    return p
  }

  function emit(blockId, x, y, z, vx, vy, vz, life, size) {
    const texName = textureFor(blockId)
    if (!texName) return null
    return emitTex(texName, BLOCK_SPEC, x, y, z, vx, vy, vz, life, size)
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

    const ticks = dt * MC.TICKS_PER_SECOND

    for (const sys of systems.values()) {
      const { pool, positions, uvs, spec } = sys
      const drag = Math.pow(spec.dragTick, ticks)
      const crop = 1 / spec.crops

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

        p.vy -= spec.gravity * dt
        p.vx *= drag; p.vy *= drag; p.vz *= drag
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt

        /*
         * Rest on whatever they land on. Only when falling: a chip drifting
         * sideways into a wall would otherwise get lifted onto its top, and
         * the crumbs spawned against a block face are doing exactly that.
         */
        if (spec.collide && p.vy < 0) {
          const by = Math.floor(p.y)
          if (noa.getBlock(Math.floor(p.x), by, Math.floor(p.z))) {
            p.y = by + 1.002
            p.vy = 0
            // Minecraft's particles skid to a stop rather than sticking.
            p.vx *= 0.6; p.vz *= 0.6
          }
        }

        p.spin += p.spinRate * dt

        /*
         * Billboard, tumbled in-plane. Half-size, because the corners are
         * offset both ways from the centre.
         *
         * `shrink` is vanilla's FlameParticle.getQuadSize: the quad tapers to
         * half its birth size by the end of its life, quadratically, so a
         * flame dwindles instead of blinking out at full width. Block chips
         * don't do this -- Minecraft's terrain particles keep their size and
         * simply vanish, and a shrinking chip reads as receding rather than
         * as settling.
         */
        const t = p.age / p.life
        const h = (spec.shrink ? p.size * (1 - t * t * 0.5) : p.size) * 0.5
        const c = Math.cos(p.spin), s = Math.sin(p.spin)
        const ax = (rx * c + ux * s) * h, ay = (ry * c + uy * s) * h, az = (rz * c + uz * s) * h
        const bx2 = (-rx * s + ux * c) * h, by2 = (-ry * s + uy * c) * h, bz2 = (-rz * s + uz * c) * h

        const o = i * 12
        positions[o] = p.x - ax - bx2; positions[o + 1] = p.y - ay - by2; positions[o + 2] = p.z - az - bz2
        positions[o + 3] = p.x + ax - bx2; positions[o + 4] = p.y + ay - by2; positions[o + 5] = p.z + az - bz2
        positions[o + 6] = p.x + ax + bx2; positions[o + 7] = p.y + ay + by2; positions[o + 8] = p.z + az + bz2
        positions[o + 9] = p.x - ax + bx2; positions[o + 10] = p.y - ay + by2; positions[o + 11] = p.z - az + bz2

        const q = i * 8
        uvs[q] = p.u; uvs[q + 1] = p.v
        uvs[q + 2] = p.u + crop; uvs[q + 3] = p.v
        uvs[q + 4] = p.u + crop; uvs[q + 5] = p.v + crop
        uvs[q + 6] = p.u; uvs[q + 7] = p.v + crop
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

      /*
       * A flame is its own light source, so it does not dim with the sun --
       * that is the whole point of looking at one at night. Vanilla says the
       * same thing the long way round: FlameParticle.getLightColor takes the
       * world lightmap and ADDS up to full block light as the particle ages,
       * and beside a torch (light 14) the world half is already almost there.
       *
       * Rejected: reproducing that age ramp per particle. It needs a colour
       * vertex buffer -- one material colour cannot vary per quad -- for a
       * difference of about one light level over a second, next to a block
       * that is already the brightest thing in the room.
       */
      const b = spec.dimmed ? lit : 1
      sys.mat.emissiveColor.set(b, b, b)
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

  /* ------------------------------------------------------------------ *
   * THE TORCH FLAME.
   *
   * Reported as "add torch flame animation to match vanilla, not currently
   * there", and the first thing to settle was whether "animation" meant a
   * scrolling texture. It does not. `block/torch.png` in 1.21.8 is a plain
   * static 16x16 with no `.mcmeta` beside it (checked in the jar: 50 block
   * textures have one and torch is not among them), so terrainAnimation.js
   * has nothing to offer here. Every frame of motion on a lit torch in
   * vanilla comes from `TorchBlock.animateTick` spawning particles.
   *
   * VANILLA, quoted from a Mojang-mapped 1.21.8 decompile:
   *
   *     double d = pos.getX() + 0.5;
   *     double e = pos.getY() + 0.7;
   *     double f = pos.getZ() + 0.5;
   *     level.addParticle(ParticleTypes.SMOKE, d, e, f, 0.0, 0.0, 0.0);
   *     level.addParticle(this.flameParticle, d, e, f, 0.0, 0.0, 0.0);
   *
   * and WallTorchBlock, which is the same call with two offsets added:
   *
   *     Direction direction2 = direction.getOpposite();
   *     ... d + 0.27 * direction2.getStepX(), e + 0.22,
   *         f + 0.27 * direction2.getStepZ() ...
   *
   * So a wall torch's flame is 0.22 HIGHER and 0.27 back along the axis the
   * torch points, which is toward the wall -- the post's foot is buried in the
   * wall and its tilted top leans out to about a quarter block, so the flame
   * sits over the tip rather than over the middle of the cell. That derivation
   * runs off FACINGS rather than off the facing's name, for the reason
   * blockMeshes.js gives at length: this world's east is -X, the name and the
   * geometry were flipped together, and anything that reads one without the
   * other comes out mirrored.
   *
   * ALL FIVE IDS, floor plus the four walls, from the block table -- matched
   * by key so that a fifth facing or a soul torch is picked up by existing
   * code rather than by remembering to add a number here.
   * ------------------------------------------------------------------ */

  /*
   * Vanilla's FlameParticle, which is a RisingParticle that barely rises.
   *
   *   gravity 0, friction 0.96/tick, and a launch speed of roughly 0.0015
   *     blocks/tick -- total drift over a whole life is about 0.03 blocks.
   *     A torch flame does not float upward; it sits there and flickers.
   *   lifetime (int)(8 / (random*0.8 + 0.2)) + 4 ticks, so 12 to 44.
   *   quadSize 0.1 to 0.2, and the quad spans +/- that, so an edge of 0.2 to
   *     0.4 blocks -- two to four times the size of a break chip.
   *   the sprite is the whole 8x8 flame, not a crop, hence crops: 1.
   *
   * POOL 400, against 160 for blocks, and it is sized off the worst case
   * rather than the common one: a hundred torches in view at a rate of two
   * spawns a second each, with each flame living about a second, settles
   * around 200 live. 400 leaves the headroom for a corridor of them and still
   * costs 32KB of vertex buffer.
   */
  const FLAME_TEXTURE = 'particle/flame'
  const FLAME_SPEC = {
    pool: 400,
    gravity: 0,
    dragTick: 0.96,
    // A flame passes through the torch it sits on. `collide` would drop every
    // one of them onto the top of the block below.
    collide: false,
    crops: 1,
    // Vanilla's particles do not roll, and a spinning flame reads as a spark.
    spin: 0,
    shrink: true,
    dimmed: false,
    alphaTest: true,
  }

  /** Block id -> where in its own cell the flame sits. */
  const TORCH_FLAMES = new Map()
  for (const def of BLOCK_TYPES) {
    if (def.key === 'torch') { TORCH_FLAMES.set(def.id, [0.5, 0.7, 0.5]); continue }
    const wall = /^wall_torch_(.+)$/.exec(def.key)
    if (!wall || !FACINGS[wall[1]]) continue
    const d = FACINGS[wall[1]]
    TORCH_FLAMES.set(def.id, [0.5 - 0.27 * d[0], 0.7 + 0.22, 0.5 - 0.27 * d[2]])
  }

  function flame(x, y, z) {
    /*
     * The jitter that makes a torch look alive. Vanilla's is +/-0.05 per axis
     * from `nextFloat() - nextFloat()`, which is TRIANGULAR, not uniform --
     * mostly centred with the occasional outlier -- and that is the difference
     * between a flame that breathes and a flame that vibrates.
     */
    const j = () => (Math.random() - Math.random()) * 0.05

    /*
     * Vanilla's launch velocity, in full, because the arithmetic is the
     * surprise: Particle's constructor picks a random direction and
     * normalises it to a speed of (rand + rand + 1) * 0.15 * 0.4, adds 0.1 to
     * y -- and then RisingParticle multiplies the whole thing by 0.01. What
     * comes out is a thousandth of a block per tick. It is kept rather than
     * zeroed because it is the reason no two flames in a cluster sit exactly
     * on top of each other.
     */
    let vx = rand(-1, 1), vy = rand(-1, 1), vz = rand(-1, 1)
    const speed = (Math.random() + Math.random() + 1) * 0.15 * 0.4
    const len = Math.hypot(vx, vy, vz) || 1
    const k = (speed / len) * 0.01 * MC.TICKS_PER_SECOND
    vx *= k; vz *= k
    vy = (vy * (speed / len) + 0.1) * 0.01 * MC.TICKS_PER_SECOND

    const life = (Math.floor(8 / (Math.random() * 0.8 + 0.2)) + 4) / MC.TICKS_PER_SECOND
    emitTex(FLAME_TEXTURE, FLAME_SPEC, x + j(), y + j(), z + j(), vx, vy, vz, life, rand(0.2, 0.4))
  }

  /*
   * HOW OFTEN, and this is the part that decides whether a hallway of torches
   * is affordable.
   *
   * Vanilla does not iterate the torches near you. ClientLevel.animateTick
   * SAMPLES: 667 times a tick it picks a random block within 16 on each axis
   * and another within 32, and calls animateTick on whatever it finds.
   *
   *     for (int m = 0; m < 667; m++) {
   *         this.doAnimateTick(i, j, k, 16, ...);
   *         this.doAnimateTick(i, j, k, 32, ...);
   *     }
   *
   * with each axis offset being `nextInt(l) - nextInt(l)`, a triangular
   * distribution that peaks at the player. Copying that verbatim gets three
   * properties for free and they are all three the requirement:
   *
   *   1. THE RATE IS EXACTLY VANILLA'S. A torch at the player's own position
   *      is picked 667 * 9/32768 times a tick, about 3.7 flames a second,
   *      falling smoothly to nothing past 31 blocks. No tuning, no constant
   *      anybody has to defend.
   *   2. IT IS NOT A METRONOME. Evenly spaced particles read as machinery,
   *      and sampling makes the gaps genuinely irregular -- which is what
   *      flickering IS.
   *   3. THE COST DOES NOT DEPEND ON HOW MANY TORCHES THERE ARE. One torch
   *      and a hundred torches both cost 1334 getBlock calls a tick. A
   *      hallway of them is free at the emitter; only the particles scale.
   *
   * REJECTED: keeping a cached list of nearby torch positions and giving each
   * one a per-tick spawn chance. That is the obvious design, and it costs a
   * scan of a 31^3 box to build -- 29,791 getBlock calls, which has to be
   * amortised over a second or more, which means a torch you just placed
   * stays dark for a second and a torch you just mined keeps burning. The
   * sampler has neither problem because it never remembers anything.
   *
   * Driven off ACCUMULATED TIME rather than off noa's tick, because noa ticks
   * at 30Hz and Minecraft at 20, and hanging vanilla's 667 off a 30Hz tick
   * would run the flame half again as fast as the game it is copied from.
   */
  const ANIMATE_PICKS = 667
  const ANIMATE_RANGES = [16, 32]
  const ANIMATE_STEP = 1 / MC.TICKS_PER_SECOND

  const randInt = (n) => (Math.random() * n) | 0

  function animateTick() {
    const pos = noa.ents.getPositionData(noa.playerEntity).position
    const px = Math.floor(pos[0]), py = Math.floor(pos[1]), pz = Math.floor(pos[2])
    for (let i = 0; i < ANIMATE_PICKS; i++) {
      for (let r = 0; r < ANIMATE_RANGES.length; r++) {
        const l = ANIMATE_RANGES[r]
        const bx = px + randInt(l) - randInt(l)
        const by = py + randInt(l) - randInt(l)
        const bz = pz + randInt(l) - randInt(l)
        // Air is the overwhelming majority of picks and a Map lookup on it is
        // pure waste; every block id here is truthy and air is 0.
        const id = noa.getBlock(bx, by, bz)
        if (!id) continue
        const at = TORCH_FLAMES.get(id)
        if (at) flame(bx + at[0], by + at[1], bz + at[2])
      }
    }
  }

  /*
   * Leftover time is DISCARDED rather than carried, past one step. A tab
   * switch or a long chunk-meshing stall hands back a multi-second dt, and
   * catching up on it would fire forty animate ticks in one frame -- 53,000
   * getBlock calls and a pool's worth of flames born at the same instant,
   * which is a stutter followed by a puff of smoke where a flicker should be.
   */
  let sinceAnimate = 0
  noa.on('tick', (dtMs) => {
    if (!TORCH_FLAMES.size) return
    sinceAnimate += dtMs / 1000
    if (sinceAnimate < ANIMATE_STEP) return
    sinceAnimate = sinceAnimate > ANIMATE_STEP * 4 ? 0 : sinceAnimate - ANIMATE_STEP
    animateTick()
  })

  return {
    burst,
    landingPuff,
    crumb,
    /** Live particle count, and how many pooled meshes exist. One per texture. */
    get live() { let n = 0; for (const s of systems.values()) n += s.live; return n },
    get meshes() { return systems.size },
    /** Live torch flames specifically, which is what 77-torch-flame asserts. */
    get flames() { const s = systems.get(FLAME_TEXTURE); return s ? s.live : 0 },
    /*
     * Where those flames are, in world space.
     *
     * Exposed for the specs, the same way terrainAnim exposes setPaused and
     * for the same reason: the thing that most wants checking here is the
     * WALL torch's 0.27 offset back toward its wall, the sign of which
     * blockMeshes.js warns at length is easy to mirror -- and a mirrored
     * offset puts the flame INSIDE the wall, where no screenshot of a dark
     * room can report it.
     */
    flamePositions() {
      const s = systems.get(FLAME_TEXTURE)
      if (!s) return []
      const out = []
      for (let i = 0; i < s.live; i++) out.push([s.pool[i].x, s.pool[i].y, s.pool[i].z])
      return out
    },
    get capacity() { let n = 0; for (const s of systems.values()) n += s.spec.pool; return n },
    dispose() { unsubscribe.forEach(fn => fn()) },
  }
}

/* ------------------------------------------------------------------ *
 * Rain
 * ------------------------------------------------------------------ *
 *
 * Rain lives in this file because the expensive half of it is already solved
 * here: ONE mesh holding a fixed pool of quads, rewritten each frame, so a
 * downpour costs buffer writes and a single draw call instead of two thousand
 * meshes. Nothing below allocates after install.
 *
 * WHAT MINECRAFT ACTUALLY DRAWS, and where this departs from it. Vanilla's
 * renderSnowAndRain walks the columns within 10 blocks of the camera (5 on
 * Fast) and draws ONE tall quad per column with the rain texture scrolling
 * down it. That is cheaper still, and it is not what this does, because a
 * scrolling texture cannot be interrupted: a drop has to stop where it lands,
 * and the splash when it lands is half of what makes rain read as weather
 * rather than as a filter over the lens. So: discrete drops, on vanilla's
 * radius and vanilla's shelter rule.
 *
 * THE SHELTER RULE is the detail that separates rain from a screen effect.
 * Vanilla clamps each column's rain to start ABOVE that column's heightmap --
 * max(camY - 10, topBlock) up to max(camY + 10, topBlock) -- and skips the
 * column entirely when those two are equal. Two behaviours fall out of that
 * one line: rain lands ON a roof instead of through it, and standing under
 * the roof leaves you dry while you still watch it fall outside. Both are
 * reproduced here by scanning each column for its highest solid block.
 *
 * Billboarding is around Y ONLY. A drop that faced the camera fully would
 * lean over as you looked up, and rain does not lean.
 */

// Vanilla's Fancy radius. Fast is 5, and there is no graphics setting here.
const RAIN_RADIUS = 10

/*
 * Drops in flight at full intensity. 2000 across a 21x21 column footprint is
 * about four per column, which is how dense vanilla reads at rainLevel 1. The
 * pool is fixed and a slot is RECYCLED to the top of a fresh column when its
 * drop lands -- growing on demand would put an allocation in the frame that is
 * already doing the most work.
 */
const RAIN_POOL = 2000

/*
 * Blocks per second. Derived, not guessed: vanilla scrolls the rain texture by
 * speed/32 v-units per tick where one v-unit is 4 blocks and speed is
 * 3 + random() per column, so 0.375-0.5 blocks per tick -- 7.5 to 10 blocks a
 * second. Splitting the difference rather than rolling it per drop, because
 * vanilla's variation is per COLUMN and ours would be per drop, which reads as
 * drizzle mixed into rain instead of as rain.
 */
const RAIN_SPEED = 9
/*
 * A drop is a long thin STREAK. The first pass had it 0.9 long and 0.09 wide
 * and it read as a falling white bar, which is the same mistake as drawing
 * rain with round droplets: at these speeds the eye sees a line, and the line
 * has to be much longer than it is wide before it stops looking like an
 * object. Vanilla gets this for free -- its quad is a full block wide and its
 * texture is mostly transparent, with the streaks painted a pixel or two
 * across.
 */
const RAIN_LENGTH = 1.6
const RAIN_WIDTH = 0.05
const SPLASH_LIFE = 0.18
const SPLASH_SIZE = 0.09
// A splash is the drop breaking up, not another drop: dimmer, and it fades.
const SPLASH_ALPHA = 0.55

/*
 * The rain texture, drawn in code rather than shipped.
 *
 * Rejected: adding environment/rain.png to the texture build, which is the
 * right home for it and is another agent's file this pass. A streak with soft
 * ends is eight lines of arithmetic, and this is one of the few textures where
 * the procedural version is genuinely as good as the drawn one.
 */
function rainTexture(scene) {
  const W = 8, H = 32
  const data = new Uint8Array(W * H * 4)
  for (let y = 0; y < H; y++) {
    // Soft at both ends, so a drop has no hard top or bottom edge.
    const along = Math.sin((y / (H - 1)) * Math.PI)
    for (let x = 0; x < W; x++) {
      /*
       * A narrow bright core with a fast falloff -- the fourth power, not the
       * square. Squared left the quad reading as a solid bar with blurred
       * sides; rain wants most of its own width to be empty.
       */
      const across = 1 - Math.abs((x + 0.5) / W - 0.5) * 2
      const core = across * across * across * across
      const i = (y * W + x) * 4
      // Minecraft's rain is pale blue-grey, not white.
      data[i] = 200; data[i + 1] = 215; data[i + 2] = 255
      data[i + 3] = Math.round(210 * along * core)
    }
  }
  return RawTexture.CreateRGBATexture(data, W, H, scene, false, false,
    Texture.NEAREST_SAMPLINGMODE)
}

/**
 * A camera-following volume of falling rain.
 *
 * Drives itself off `beforeRender`, and draws nothing at all until setLevel is
 * given something above zero -- so the cost of not raining is one comparison
 * per frame.
 */
export function createRainVolume(noa, { radius = RAIN_RADIUS, capacity = RAIN_POOL } = {}) {
  const scene = noa.rendering.getScene()

  const mat = noa.rendering.makeStandardMaterial('rain-mat')
  mat.diffuseTexture = rainTexture(scene)
  mat.diffuseTexture.hasAlpha = true
  // Same unlit recipe as the block particles above: brightness rides on
  // emissiveColor, which MULTIPLIES the texture when lighting is off.
  mat.emissiveColor = new Color3(1, 1, 1)
  mat.specularColor = new Color3(0, 0, 0)
  mat.ambientColor = new Color3(0, 0, 0)
  mat.disableLighting = true
  mat.backFaceCulling = false
  /*
   * Blended, and deliberately NOT depth-writing. Rain is thousands of
   * overlapping translucent quads in no particular order; if they write depth,
   * whichever drop happened to draw first punches a hole in every drop behind
   * it and the whole volume flickers as they fall. Depth write buys nothing
   * here -- a drop is never something you need to see the far side of.
   */
  mat.disableDepthWrite = true

  const positions = new Float32Array(capacity * 4 * 3)
  const uvs = new Float32Array(capacity * 4 * 2)
  const colors = new Float32Array(capacity * 4 * 4)
  const indices = new Uint32Array(capacity * 6)
  for (let i = 0; i < capacity; i++) {
    const v = i * 4, o = i * 6
    indices[o] = v; indices[o + 1] = v + 1; indices[o + 2] = v + 2
    indices[o + 3] = v; indices[o + 4] = v + 2; indices[o + 5] = v + 3
    // UVs are written once and never touched again -- every drop shows the
    // whole texture -- so per-frame traffic is positions and alpha only.
    const t = i * 8
    uvs[t] = 0; uvs[t + 1] = 0
    uvs[t + 2] = 1; uvs[t + 3] = 0
    uvs[t + 4] = 1; uvs[t + 5] = 1
    uvs[t + 6] = 0; uvs[t + 7] = 1
    // Vertex colour carries per-drop alpha; rgb never changes.
    const c = i * 16
    for (let k = 0; k < 4; k++) {
      colors[c + k * 4] = 1; colors[c + k * 4 + 1] = 1; colors[c + k * 4 + 2] = 1
      colors[c + k * 4 + 3] = 0
    }
  }

  const mesh = new Mesh('rain', scene)
  const vd = new VertexData()
  vd.positions = positions
  vd.uvs = uvs
  vd.colors = colors
  vd.indices = indices
  vd.applyToMesh(mesh, true) // updatable, or updateVerticesData is a silent no-op
  mesh.material = mat
  mesh.isPickable = false
  // Without this the alpha channel of the colour buffer is ignored and every
  // drop draws at full strength, fade and all.
  mesh.hasVertexAlpha = true
  // REQUIRED, same as every other mesh in this repo: a mesh noa's selection
  // octree has never heard of is silently never drawn.
  noa.rendering.addMeshToScene(mesh)
  mesh.alwaysSelectAsActiveMesh = true
  mesh.setEnabled(false)

  /* ---- which columns rain falls in ---- */

  const span = radius * 2 + 1
  const CELLS = span * span
  /*
   * Per column of the footprint: the y of its highest solid block within reach
   * (-Infinity for open sky), and whether the column is CLOSED -- solid right
   * at the top of the volume, meaning a roof or a cave ceiling with no open
   * air between it and the camera. Vanilla draws nothing in a closed column.
   */
  const tops = new Float64Array(CELLS)
  const closed = new Uint8Array(CELLS)
  const open = new Int32Array(CELLS)
  let openCount = 0
  let originX = NaN, originZ = NaN
  let sweep = 0

  /*
   * Scanned downward from the top of the volume rather than from the sky.
   * Anything above camY + radius is out of reach of a drop that only exists
   * inside the volume, so it cannot change the answer -- and scanning from
   * build height would be 200 getBlock calls per column instead of 21.
   */
  function scanColumn(k, camY) {
    const x = originX + ((k / span) | 0)
    const z = originZ + (k % span)
    const hi = Math.floor(camY + radius)
    const lo = Math.floor(camY - radius)
    for (let y = hi; y >= lo; y--) {
      if (noa.getBlock(x, y, z)) {
        tops[k] = y
        closed[k] = y >= hi ? 1 : 0
        return
      }
    }
    tops[k] = -Infinity
    closed[k] = 0
  }

  function rebuildOpenList() {
    openCount = 0
    for (let k = 0; k < CELLS; k++) if (!closed[k]) open[openCount++] = k
  }

  /* ---- the pool ---- */

  const drops = []
  for (let i = 0; i < capacity; i++) drops.push({ x: 0, y: 0, z: 0, splash: 0 })
  let live = 0
  let drawn = 0
  let recycled = 0   // proof, for the verification script, that slots are reused
  let level = 0
  let lastCamY = 0

  const floorOf = (k, camY) => (tops[k] === -Infinity ? camY - radius : tops[k] + 1)

  /*
   * Put a drop at the top of a randomly chosen unsheltered column. `fill`
   * scatters it down the column instead of starting the whole volume at the
   * ceiling, which is what makes rain look like it was already falling the
   * moment it starts rather than arriving as a curtain.
   */
  function place(d, camY, fill) {
    if (!openCount) return false
    const k = open[(Math.random() * openCount) | 0]
    d.x = originX + ((k / span) | 0) + Math.random()
    d.z = originZ + (k % span) + Math.random()
    const ceiling = camY + radius
    const floor = floorOf(k, camY)
    d.y = fill ? floor + Math.random() * Math.max(0.1, ceiling - floor) : ceiling
    d.splash = 0
    return true
  }

  const originGlobal = [0, 0, 0]
  const originLocal = [0, 0, 0]

  const onFrame = (dtMs) => {
    if (level <= 0 && live === 0) return
    const dt = Math.min(0.05, dtMs / 1000)

    const p = noa.ents.getPositionData(noa.playerEntity).position
    const camY = p[1]
    lastCamY = camY

    /*
     * The footprint is rebuilt wholesale when the player crosses a block
     * boundary horizontally -- every entry in the grid means a different column
     * at that point -- and otherwise swept an eighth at a time. The sweep is
     * what notices a roof being built over your head, or mined off it, without
     * every frame paying for 441 column scans. Vertical movement needs no
     * rebuild: the grid still describes the same columns, only the scan window
     * moved, and the sweep catches up within a few frames.
     */
    const ox = Math.floor(p[0]) - radius, oz = Math.floor(p[2]) - radius
    if (ox !== originX || oz !== originZ) {
      originX = ox; originZ = oz
      for (let k = 0; k < CELLS; k++) scanColumn(k, camY)
    } else {
      const slice = Math.ceil(CELLS / 8)
      for (let n = 0; n < slice; n++) scanColumn((sweep + n) % CELLS, camY)
      sweep = (sweep + slice) % CELLS
    }
    rebuildOpenList()

    /*
     * Intensity is the drop COUNT, not the alpha. Fading 2000 drops to a tenth
     * of their opacity looks like fog; 200 drops looks like it is starting to
     * rain. Vanilla agrees -- its per-column count goes with rainLevel SQUARED,
     * which is why the first minute of a storm builds so noticeably.
     */
    const want = Math.round(capacity * level * level)
    while (live < want) {
      if (!place(drops[live], camY, true)) break
      live++
    }

    const m = noa.rendering.camera.getWorldMatrix().m
    // The camera's right vector, flattened into the horizontal plane, shared by
    // every drop this frame: rain stays vertical however far up you look.
    let rx = m[0], rz = m[2]
    const rl = Math.hypot(rx, rz) || 1
    rx /= rl; rz /= rl

    // Where world (0,0,0) sits in Babylon's frame right now. Doing it once and
    // offsetting the mesh beats converting every drop -- noa rebases the origin
    // as you travel, and world coordinates written straight into the buffer
    // look perfect near spawn and drift the further you walk.
    noa.globalToLocal(originGlobal, null, originLocal)

    // sky.js drives the directional light off the sun AND the storm, so rain
    // dims inside its own weather without being told about it.
    const lit = noa.rendering.light ? noa.rendering.light.intensity : 1
    const bright = Math.min(1, 0.3 + lit * 0.7)
    mat.emissiveColor.set(bright, bright, bright)

    const fall = RAIN_SPEED * dt
    const invR = 1 / radius

    for (let i = 0; i < live; i++) {
      const d = drops[i]

      // Which column the drop is over NOW. Recomputed rather than remembered,
      // because the grid slides under the drops as the player walks.
      const kx = Math.floor(d.x) - originX
      const kz = Math.floor(d.z) - originZ
      const inside = kx >= 0 && kz >= 0 && kx < span && kz < span
      const k = inside ? kx * span + kz : -1

      /*
       * Retired: too many drops for the current intensity, walked out of the
       * footprint, or now UNDER cover. That last test is `below its column's
       * floor`, which catches the case a roof cannot otherwise fix -- a drop
       * already falling, or already splashing on the ground, at the instant
       * something is built over it. Without it those drops finish their fall
       * indoors, which is exactly the thing this is supposed to never do.
       *
       * The slot is swapped to the end of the live range and reused -- never
       * freed, never reallocated.
       */
      if (!inside || closed[k] || i >= want || d.y < floorOf(k, camY)) {
        live--
        const last = drops[live]
        drops[live] = d
        drops[i] = last
        recycled++
        i--
        continue
      }

      if (d.splash > 0) {
        d.splash -= dt
        if (d.splash <= 0) { place(d, camY, false); recycled++ }
      } else {
        d.y -= fall
        const floor = floorOf(k, camY)
        if (d.y <= floor) {
          d.y = floor
          /*
           * Splash only where there is something to splash on. A drop that
           * reached the bottom of the volume without hitting a block is over a
           * hole or out in the air, and a splash hanging in mid-air is worse
           * than no splash.
           */
          if (tops[k] === -Infinity) { place(d, camY, false); recycled++ }
          else d.splash = SPLASH_LIFE
        }
      }

      // Vanilla's distance fade, ((1 - r^2) * 0.5 + 0.5) * level. Without it
      // the edge of the volume is a visible cylinder of drops popping in.
      const dx = d.x - p[0], dz = d.z - p[2]
      // sqrt of the sum, not Math.hypot: hypot guards against overflow that
      // cannot happen inside a 10-block radius, and it is several times slower
      // when it is called two thousand times a frame.
      const r = Math.min(1, Math.sqrt(dx * dx + dz * dz) * invR)
      const a = ((1 - r * r) * 0.5 + 0.5) * level

      const splashing = d.splash > 0
      const half = (splashing ? SPLASH_SIZE : RAIN_WIDTH) * 0.5
      const len = splashing ? SPLASH_SIZE : RAIN_LENGTH
      // Splashes fade over their life rather than blinking out, which at 0.18
      // seconds is the difference between wet ground and flickering confetti.
      const alpha = splashing ? a * SPLASH_ALPHA * (d.splash / SPLASH_LIFE) : a
      const ax = rx * half, az = rz * half

      const o = i * 12
      positions[o] = d.x - ax; positions[o + 1] = d.y; positions[o + 2] = d.z - az
      positions[o + 3] = d.x + ax; positions[o + 4] = d.y; positions[o + 5] = d.z + az
      positions[o + 6] = d.x + ax; positions[o + 7] = d.y + len; positions[o + 8] = d.z + az
      positions[o + 9] = d.x - ax; positions[o + 10] = d.y + len; positions[o + 11] = d.z - az

      const c = i * 16
      colors[c + 3] = alpha; colors[c + 7] = alpha
      colors[c + 11] = alpha; colors[c + 15] = alpha
    }

    /*
     * Clear the tail. The index buffer covers the whole pool -- it is static --
     * so a slot the live count has shrunk past still draws whatever it held
     * last frame. Missing this is how a stopping storm leaves drops hanging in
     * the air; the block particles above hit the same trap.
     */
    for (let i = live; i < drawn; i++) {
      const c = i * 16
      colors[c + 3] = 0; colors[c + 7] = 0; colors[c + 11] = 0; colors[c + 15] = 0
    }
    const wasDrawn = drawn
    drawn = live

    if (!live) {
      if (wasDrawn) mesh.updateVerticesData('color', colors, false, false)
      mesh.setEnabled(false)
      return
    }

    mesh.position.set(originLocal[0], originLocal[1], originLocal[2])
    mesh.updateVerticesData('position', positions, false, false)
    mesh.updateVerticesData('color', colors, false, false)
    mesh.setEnabled(true)
  }

  noa.on('beforeRender', onFrame)

  return {
    /** 0 = dry, 1 = downpour. Anything between scales the drop COUNT. */
    setLevel(v) { level = v < 0 ? 0 : v > 1 ? 1 : v },
    get level() { return level },
    get live() { return live },
    get capacity() { return capacity },
    /** Slots reused since install. Proof the pool recycles rather than leaks. */
    get recycled() { return recycled },
    /** Columns of the footprint that rain actually falls in. */
    get openColumns() { return openCount },
    get columns() { return CELLS },
    /*
     * Is the player under cover? Vanilla's test for swapping the rain audio to
     * its muffled variant is "the heightmap above me is higher than I am",
     * which is NOT the same as the column being closed -- a roof four blocks
     * up still has rain falling on top of it, and you still hear it, quieter.
     */
    get sheltered() {
      const t = tops[radius * span + radius]
      return t !== -Infinity && t > lastCamY
    },
    mesh,
    dispose() { noa.off('beforeRender', onFrame); mesh.dispose() },
  }
}
