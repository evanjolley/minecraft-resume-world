import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js'

/*
 * BLOCK LIGHT.
 *
 * `docs/lighting.md` costed this at two to four days and said the shader end
 * was nearly free while the data end was not. Both halves of that turned out
 * to be right, and this file is the cheapest honest version of the data end.
 *
 * WHAT IS HERE: block light. A glowstone lights the floor in front of it, the
 * light falls off one level per block, it stops at walls, and pulling the
 * glowstone out takes the light with it.
 *
 * WHAT IS NOT HERE: SKY LIGHT. Caves are still lit as if they were outdoors,
 * because nothing in this file knows which voxels can see the sky. Standing in
 * a cave at noon is still bright. That is the other half of vanilla's model
 * and it is not built. Do not read a lit torch in a cave as proof the cave is
 * dark -- it is not.
 *
 *
 * HOW IT AVOIDS FORKING NOA, WHICH THE DOC ASSUMED IT COULDN'T
 *
 * The doc's estimate was a vendored copy of `terrainMesher.js` (987 lines) and
 * `chunk.js`, because neither has an extension point. Both were dodged:
 *
 *   - The store lives HERE, in a Map of chunk key -> Uint8Array, not beside
 *     `Chunk.voxels`. noa never needs to know it exists. Costs one extra Map
 *     lookup per voxel read and saves owning a fork of the chunk lifecycle.
 *
 *   - The mesher is not forked, it is WRAPPED. `meshChunk` is replaced on the
 *     instance; the original runs untouched, and then this file reads the
 *     finished mesh's position/normal/colour buffers back out and rewrites the
 *     alpha lane. Babylon keeps a CPU-side copy of vertex data, so reading it
 *     back is free of a GPU round trip.
 *
 * The road not taken: actually vendoring the mesher, which would compute light
 * per face during greedy meshing instead of per vertex afterwards -- fewer
 * passes and access to the face normal as an integer rather than a float. It
 * is also 987 lines of someone else's code that can never be upgraded again.
 * The wrapper costs one extra pass over ~4 numbers per vertex per remesh and
 * leaves `npm update noa-engine` working.
 *
 *
 * THE FREE LANE, AND WHY IT IS 1-MINUS
 *
 * `pushAOColor` in noa's mesher writes vertex alpha as a constant 1 that
 * nothing reads: Babylon only compiles VERTEXALPHA -- the define that makes
 * the fragment shader do `alpha *= vColor.a` -- when a mesh sets
 * `hasVertexAlpha`, and noa never does. But `vColor` is declared vec4 and
 * varying whenever VERTEXCOLOR is on, so the fragment shader can READ `.a`
 * with no define, no attribute, no buffer and no bandwidth. That is the lane.
 *
 * SUBTLE, AND THE reason the stored value is inverted: `hasVertexAlpha` is
 * exactly what we must NOT set, because Babylon's
 * `needAlphaBlendingForMesh()` returns true for any mesh with it and the
 * entire terrain would move to the transparent render list and sort itself
 * back-to-front every frame. Reading `.a` without setting it is the whole
 * trick.
 *
 * Light is stored as `1 - level/15`, not `level/15`. noa's untouched constant
 * is 1, so an unlit default has to mean "no block light" -- if it meant "full
 * block light" then any mesh this file failed to reach, for one frame or
 * forever, would render fullbright white. Inverted, the failure mode is
 * "looks exactly like today".
 *
 *
 * HOW IT COMPOSES WITH DAYLIGHT WITHOUT A UNIFORM
 *
 * Vanilla renders a voxel at `texture * max(skyLight * daylight, blockLight)`.
 * The shader hook here is
 *
 *     color.rgb = max(color.rgb, noaBaseCol * blockLight)
 *
 * where `color.rgb` is the already-day-shaded result and `noaBaseCol` is the
 * unshaded texel captured a few lines earlier. That IS the vanilla max, and it
 * needs no daylight uniform and no per-frame bind: the day term is already
 * sitting in `color.rgb`. At noon the max picks the sun and block light is
 * invisible, exactly as in vanilla; at midnight it picks the torch.
 *
 * Rejected: a `uDaylight` uniform and `color.rgb *= max(1.0, L / uDaylight)`.
 * Same result at both ends, but it divides by a number that approaches zero at
 * midnight, and the clamp needed to stop that is a tuning knob nobody wants.
 *
 * NOT DONE, and worth saying: block light here is not face-shaded. Vanilla
 * multiplies the five-value face table (UP 1.0, N/S 0.8, E/W 0.6, DOWN 0.5)
 * into the light level, so the underside of a glowstone-lit ceiling is dimmer
 * than the floor. Here all six faces of a lit block get the same level. The
 * hook to fix it is four lines below `CUSTOM_FRAGMENT_BEFORE_FOG` reading
 * `vNormalW` -- which is also, per docs/lighting.md section 6, the hook the
 * face-shading table itself has been waiting for. Both are now cheap.
 */

/** Vanilla's emission levels, by block key. Anything absent emits nothing. */
export const EMISSION = {
  glowstone: 15,
  sea_lantern: 15,
  lava: 15,
  torch: 14,
  redstone_torch: 7,
  magma_block: 3,
}

/** Vanilla's cap. One nibble, and the reason decay is 1/15 per block. */
export const MAX_LIGHT = 15

/**
 * Block keys whose whole family emits, matched by prefix.
 *
 * Lava is eight flow ids plus a source (`lava`, `lava_flow_7`, ...), all of
 * which are lava and all of which glow. Listing them individually would go
 * stale the next time blocks.js adds a level.
 */
const EMISSION_PREFIXES = [['lava', 15]]

/* ------------------------------------------------------------------ *
 * The shader half
 * ------------------------------------------------------------------ */

class BlockLightPlugin extends MaterialPluginBase {
  constructor(material) {
    // Priority 210: after terrainAnimation.js's 200, so that if both ever want
    // the same injection point the light lands on top of the animated texel.
    super(material, 'NoaBlockLight', 210, { NOA_BLOCK_LIGHT: false })
    this._enable(true)
  }

  /*
   * THE ONE THING docs/lighting.md GOT WRONG, and it cost an hour.
   *
   * The doc says vertex alpha is "a free per-vertex lane" that the fragment
   * shader can read because `vColor` is declared vec4 whenever VERTEXCOLOR is
   * on. The varying is vec4. What is in it is not. Babylon's
   * ShadersInclude/vertexColorMixing.js:
   *
   *     vColor=vec4(1.0);
   *     #ifdef VERTEXCOLOR
   *       #ifdef VERTEXALPHA
   *         vColor*=color;
   *       #else
   *         vColor.rgb*=color.rgb;      <-- alpha stays 1.0
   *       #endif
   *     #endif
   *
   * So without VERTEXALPHA the alpha lane is written by the mesher, uploaded
   * to the GPU, and then thrown away in the vertex shader. The fragment shader
   * reads a constant 1 no matter what is in the buffer. Every injection point
   * compiles, every define is present, nothing errors, and the screen does not
   * change -- which is exactly what it did.
   *
   * VERTEXALPHA is a define, though, and defines are ours. Turning it on here
   * is NOT the same as setting `mesh.hasVertexAlpha`: that property is what
   * `needAlphaBlendingForMesh()` reads, and setting it would move the entire
   * terrain into the transparent render list to be depth-sorted every frame.
   * The define only changes the two shader lines. The second of those lines is
   * `alpha*=vColor.a`, which would make lit blocks see-through, and it is
   * deleted below.
   */
  prepareDefines(defines) {
    defines['NOA_BLOCK_LIGHT'] = true
    defines['VERTEXALPHA'] = true
  }
  getClassName() { return 'NoaBlockLightPlugin' }

  getCustomCode(shaderType) {
    if (shaderType !== 'fragment') return null
    return {
      /*
       * The other half of the VERTEXALPHA trade. Deleted rather than guarded,
       * because the define is on for one reason only and no terrain material
       * has ever wanted per-vertex opacity. The `!` prefix is Babylon's
       * regex-replace form, the same one terrainAnimation.js uses to swap the
       * atlas sampler.
       */
      '!alpha\\*=vColor\\.a;': '',
      /*
       * A file-scope `vec3` declared here and assigned in main(). GLSL allows
       * the declaration outside a function but not the assignment, which is
       * why this is two hooks rather than one.
       */
      'CUSTOM_FRAGMENT_DEFINITIONS': `
        vec3 noaBaseCol;
      `,
      // Fires right after baseColor is final (post-texture, post-vColor.rgb,
      // so ambient occlusion is already multiplied in -- vanilla multiplies AO
      // into light too, so that is correct rather than convenient).
      'CUSTOM_FRAGMENT_UPDATE_DIFFUSE': `
        noaBaseCol = baseColor.rgb;
      `,
      // Before fog, so a torch does not punch through distance fog.
      'CUSTOM_FRAGMENT_BEFORE_FOG': `
        color.rgb = max(color.rgb, noaBaseCol * (1.0 - vColor.a));
      `,
    }
  }
}

/** Attach the plugin to a terrain material once, unfreezing if noa froze it. */
function ensurePlugin(material) {
  if (!material || material._noaBlockLight) return
  material._noaBlockLight = true
  // noa freezes its baseline untextured material. A frozen material skips the
  // isReady path that would compile the new plugin in, so the shader would
  // silently keep the old code -- the exact failure mode 56d40d2 hit with
  // performancePriority.
  const wasFrozen = material.isFrozen
  if (wasFrozen) material.unfreeze()
  material._noaBlockLightPlugin = new BlockLightPlugin(material)
  if (wasFrozen) material.freeze()
}

/* ------------------------------------------------------------------ *
 * The data half
 * ------------------------------------------------------------------ */

export function installBlockLight(noa, { ids = {} } = {}) {
  const world = noa.world
  const CS = world._chunkSize
  const CS2 = CS * CS

  /** id -> emission level. Small dense array; block ids here top out at 638. */
  const emissionById = new Uint8Array(4096)
  for (const [key, id] of Object.entries(ids)) {
    let level = EMISSION[key] ?? 0
    if (!level) {
      for (const [prefix, lv] of EMISSION_PREFIXES) {
        if (key === prefix || key.startsWith(prefix + '_')) { level = lv; break }
      }
    }
    if (level && id < emissionById.length) emissionById[id] = level
  }

  /** id -> does light stop here. Read once from noa rather than duplicated. */
  const opaqueById = new Uint8Array(4096)
  for (let id = 0; id < emissionById.length; id++) {
    opaqueById[id] = noa.registry.getBlockOpacity(id) ? 1 : 0
  }

  /** chunk key -> Uint8Array(CS^3) of light levels. Allocated on first write. */
  const store = new Map()
  /** chunk key -> [ci, cj, ck], so a dirty key can be turned back into a chunk. */
  const coords = new Map()
  /**
   * chunk key -> how many of its voxels hold a level above zero.
   *
   * Exists purely so the mesh pass can answer "is there any light near this
   * chunk at all" in a Map lookup. A count rather than a boolean because
   * removal has to be able to take a chunk back to dark: `store` keeps its
   * buffer forever once allocated (see chunkBeingRemoved), so buffer presence
   * would be a one-way flag and every chunk a torch ever shone into would pay
   * the expensive mesh path for the rest of the session.
   */
  const litCount = new Map()

  const ckey = (ci, cj, ck) => ci + '|' + cj + '|' + ck
  const cdiv = (v) => Math.floor(v / CS)
  // JS % keeps the sign of the dividend, so -1 % 32 is -1, not 31.
  const cmod = (v) => ((v % CS) + CS) % CS

  function bufFor(ci, cj, ck, k) {
    let buf = store.get(k)
    if (!buf) {
      buf = new Uint8Array(CS * CS * CS)
      store.set(k, buf)
      coords.set(k, [ci, cj, ck])
    }
    return buf
  }

  /** Does this chunk hold any light at all. The mesh pass's cheap gate. */
  const chunkIsLit = (ci, cj, ck) => (litCount.get(ckey(ci, cj, ck)) || 0) > 0

  function getLight(x, y, z) {
    const buf = store.get(ckey(cdiv(x), cdiv(y), cdiv(z)))
    if (!buf) return 0
    return buf[cmod(x) * CS2 + cmod(y) * CS + cmod(z)]
  }

  /** Dirty chunk keys accumulated by a propagation pass. */
  const dirty = new Set()

  function setLight(x, y, z, v) {
    const ci = cdiv(x), cj = cdiv(y), ck = cdiv(z)
    const k = ckey(ci, cj, ck)
    const buf = bufFor(ci, cj, ck, k)
    const at = cmod(x) * CS2 + cmod(y) * CS + cmod(z)
    const was = buf[at]
    buf[at] = v
    if (was === 0 && v > 0) litCount.set(k, (litCount.get(k) || 0) + 1)
    else if (was > 0 && v === 0) litCount.set(k, (litCount.get(k) || 1) - 1)
    /*
     * SUBTLE: a voxel on a chunk boundary is a vertex of the NEIGHBOUR's mesh
     * too -- the mesher samples the air voxel outside each face, which for a
     * face on the seam lives in the next chunk over. So a light change one
     * voxel inside the boundary has to dirty both chunks or the seam shows a
     * hard brightness line. Marking the 3x3x3 of chunk keys around the voxel
     * is the blunt version and costs a few Set writes.
     */
    dirty.add(k)
    const lx = cmod(x), ly = cmod(y), lz = cmod(z)
    if (lx === 0) dirty.add(ckey(ci - 1, cj, ck))
    if (lx === CS - 1) dirty.add(ckey(ci + 1, cj, ck))
    if (ly === 0) dirty.add(ckey(ci, cj - 1, ck))
    if (ly === CS - 1) dirty.add(ckey(ci, cj + 1, ck))
    if (lz === 0) dirty.add(ckey(ci, cj, ck - 1))
    if (lz === CS - 1) dirty.add(ckey(ci, cj, ck + 1))
  }

  const blockAt = (x, y, z) => world.getBlockID(x, y, z)
  const isOpaque = (x, y, z) => opaqueById[blockAt(x, y, z)] === 1

  /*
   * Flood fill. A flat array used as a FIFO with a read head rather than
   * Array.shift(), which is O(n) per pop and turns a radius-15 fill from
   * thousands of ops into millions.
   */
  let queue = []
  let qhead = 0

  function push(x, y, z) { queue.push(x, y, z) }

  function propagate() {
    while (qhead < queue.length) {
      const x = queue[qhead++], y = queue[qhead++], z = queue[qhead++]
      const level = getLight(x, y, z)
      if (level <= 1) continue
      const next = level - 1
      for (let d = 0; d < 6; d++) {
        const nx = x + NEIGHBOURS[d][0]
        const ny = y + NEIGHBOURS[d][1]
        const nz = z + NEIGHBOURS[d][2]
        if (isOpaque(nx, ny, nz)) continue
        if (getLight(nx, ny, nz) >= next) continue
        setLight(nx, ny, nz, next)
        push(nx, ny, nz)
      }
    }
    queue = []
    qhead = 0
  }

  /*
   * Removal, which is the half docs/lighting.md called the hard part and was
   * right about. You cannot just clear the voxel: every voxel that was lit BY
   * it is still holding a stale value, and re-propagating from what is left
   * would not lower any of them, because propagation only ever raises. So the
   * region is walked and zeroed first, and any voxel found holding a level too
   * high to have come from the removed source is a surviving emitter's
   * frontier and gets re-seeded.
   */
  function removeLight(x, y, z, wasLevel) {
    const rq = [x, y, z, wasLevel]
    let head = 0
    setLight(x, y, z, 0)
    const reseed = []
    while (head < rq.length) {
      const cx = rq[head++], cy = rq[head++], cz = rq[head++], lv = rq[head++]
      for (let d = 0; d < 6; d++) {
        const nx = cx + NEIGHBOURS[d][0]
        const ny = cy + NEIGHBOURS[d][1]
        const nz = cz + NEIGHBOURS[d][2]
        const nl = getLight(nx, ny, nz)
        if (nl === 0) continue
        if (nl < lv) {
          setLight(nx, ny, nz, 0)
          rq.push(nx, ny, nz, nl)
        } else {
          // Too bright to have come from here -- something else still lights
          // it, so it becomes a seed for the refill pass.
          reseed.push(nx, ny, nz)
        }
      }
    }
    for (let i = 0; i < reseed.length; i += 3) push(reseed[i], reseed[i + 1], reseed[i + 2])
  }

  const NEIGHBOURS = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ]

  /** Turn the dirty set into remesh requests, then clear it. */
  function flushDirty(skipChunk) {
    for (const k of dirty) {
      const c = coords.get(k)
      const ijk = c || k.split('|').map(Number)
      const chunk = world._storage.getChunkByIndexes(ijk[0], ijk[1], ijk[2])
      if (!chunk || chunk.isDisposed || chunk === skipChunk) continue
      /*
       * `_terrainDirty` FIRST, and without it this whole function is a no-op
       * for the case it exists to serve. noa's `possiblyQueueChunkForMeshing`
       * opens with `if (!(chunk._terrainDirty || chunk._objectsDirty)) return`
       * -- it assumes the only reason to rebuild a mesh is that its VOXELS
       * changed. A chunk that a neighbour's glowstone has just lit has exactly
       * the same voxels as a second ago and is silently dropped from the
       * queue.
       *
       * Found by `test/58-glowstone-radial.spec.js`, not by looking: the
       * falloff came out perfectly symmetric in three directions and dead flat
       * zero in the fourth, and the fourth was the far side of x = 64, a chunk
       * boundary. It was invisible before that spec because the old readback
       * rewrote light on EVERY mesh for every reason, so a chunk edited for
       * any other cause quietly picked the light up on the way past.
       */
      chunk._terrainDirty = true
      world._queueChunkForRemesh(chunk)
    }
    dirty.clear()
  }

  /* -------------------------------------------------------------- *
   * Chunk lifecycle
   * -------------------------------------------------------------- */

  /**
   * Seed a freshly arrived chunk: its own emitters, plus whatever its already
   * lit neighbours are shining across the seam.
   */
  function seedChunk(chunk) {
    const size = chunk.size
    const data = chunk.voxels.data
    const ox = chunk.x, oy = chunk.y, oz = chunk.z
    // Fast reject. A chunk of one block id can only matter if that id glows.
    let found = false
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        const base = (i * size + j) * size
        for (let k = 0; k < size; k++) {
          const lvl = emissionById[data[base + k]]
          if (!lvl) continue
          found = true
          setLight(ox + i, oy + j, oz + k, lvl)
          push(ox + i, oy + j, oz + k)
        }
      }
    }
    /*
     * Light arriving from neighbours that were computed first. Only the six
     * planes of voxels just OUTSIDE the chunk can carry it in, so only those
     * are scanned -- 6 * size^2 reads rather than a second full volume.
     */
    for (let d = 0; d < 6; d++) {
      const [dx, dy, dz] = NEIGHBOURS[d]
      // The fixed coordinate on this side: one voxel beyond the chunk.
      const fx = dx > 0 ? ox + size : ox - 1
      const fy = dy > 0 ? oy + size : oy - 1
      const fz = dz > 0 ? oz + size : oz - 1
      for (let a = 0; a < size; a++) {
        for (let b = 0; b < size; b++) {
          let x, y, z
          if (dx !== 0) { x = fx; y = oy + a; z = oz + b }
          else if (dy !== 0) { x = ox + a; y = fy; z = oz + b }
          else { x = ox + a; y = oy + b; z = fz }
          if (getLight(x, y, z) > 1) { push(x, y, z); found = true }
        }
      }
    }
    if (!found) return
    propagate()
  }

  world.on('chunkAdded', (chunk) => {
    seedChunk(chunk)
    // The chunk is about to be meshed by noa anyway; only its neighbours need
    // asking for.
    flushDirty(chunk)
  })

  world.on('chunkBeingRemoved', (requestID, voxels, userData) => {
    // Nothing: the store is keyed by chunk index and the chunk will come back
    // with the same index. Dropping it would mean re-flooding on every chunk
    // reload, and 32KB per chunk is the price of not doing that.
  })

  /* -------------------------------------------------------------- *
   * Block edits -- the single choke point
   * -------------------------------------------------------------- */

  const origSetBlockID = world.setBlockID.bind(world)
  world.setBlockID = function (id, x, y, z) {
    const prev = blockAt(x, y, z)
    origSetBlockID(id, x, y, z)
    if (prev === id) return
    onBlockChanged(x, y, z, prev, id)
  }

  let editMs = 0
  function onBlockChanged(x, y, z, prevID, id) {
    const t0 = performance.now()
    const wasEmit = emissionById[prevID]
    const nowEmit = emissionById[id]
    const wasOpaque = opaqueById[prevID] === 1
    const nowOpaque = opaqueById[id] === 1

    const here = getLight(x, y, z)
    if (here > 0) {
      // Whether the emitter went away or a wall went up, the light standing at
      // this voxel is now wrong and everything downstream of it with it.
      removeLight(x, y, z, here)
    }
    if (nowEmit) {
      setLight(x, y, z, nowEmit)
      push(x, y, z)
    } else if (!nowOpaque) {
      // A hole opened: the six neighbours may now shine through it.
      for (let d = 0; d < 6; d++) {
        const nx = x + NEIGHBOURS[d][0]
        const ny = y + NEIGHBOURS[d][1]
        const nz = z + NEIGHBOURS[d][2]
        if (getLight(nx, ny, nz) > 1) push(nx, ny, nz)
      }
    }
    if (!wasEmit && !nowEmit && wasOpaque === nowOpaque && here === 0) {
      // Nothing light-shaped happened.
      editMs = performance.now() - t0
      dirty.clear()
      return
    }
    propagate()
    flushDirty(null)
    editMs = performance.now() - t0
  }

  /* -------------------------------------------------------------- *
   * The mesh half -- read the finished buffers back and rewrite alpha
   * -------------------------------------------------------------- */

  const mesher = noa._terrainMesher
  const origMeshChunk = mesher.meshChunk.bind(mesher)
  let meshMs = 0
  mesher.meshChunk = function (chunk, ignoreMaterials) {
    origMeshChunk(chunk, ignoreMaterials)
    const t0 = performance.now()
    for (const mesh of chunk._terrainMeshes) {
      ensurePlugin(mesh.material)
      writeVertexLight(mesh, chunk)
    }
    meshMs = performance.now() - t0
  }

  /**
   * Light at one terrain vertex, 0..15.
   *
   * A terrain vertex sits on a block CORNER, and the four voxels touching that
   * corner on the outside of the face are what vanilla averages. The face
   * normal says which side "outside" is; the other two axes give the 2x2.
   * Opaque voxels are skipped rather than counted as zero -- counting them
   * would draw a dark rim around every lit block where it meets the floor.
   *
   * Pure in (position, normal), which is load-bearing for the T-junction
   * argument below: two quads meeting at an edge sample the shared lattice
   * points through this same function and therefore cannot disagree.
   */
  function sampleLight(px, py, pz, nx, ny, nz) {
    let sum = 0, count = 0
    for (let a = 0; a < 2; a++) {
      for (let b = 0; b < 2; b++) {
        let vx, vy, vz
        // Step half a block along the normal to land inside the voxel the face
        // looks into, then floor: corner + 0.5*normal is that voxel's boundary.
        if (nx !== 0) {
          vx = Math.floor(px + nx * 0.5)
          vy = Math.floor(py) - a
          vz = Math.floor(pz) - b
        } else if (ny !== 0) {
          vy = Math.floor(py + ny * 0.5)
          vx = Math.floor(px) - a
          vz = Math.floor(pz) - b
        } else {
          vz = Math.floor(pz + nz * 0.5)
          vx = Math.floor(px) - a
          vy = Math.floor(py) - b
        }
        if (isOpaque(vx, vy, vz)) continue
        sum += getLight(vx, vy, vz)
        count++
      }
    }
    return count ? sum / count : 0
  }

  /** Is any chunk overlapping this world-space box holding light. */
  function boxIsLit(x0, y0, z0, x1, y1, z1) {
    for (let ci = cdiv(x0); ci <= cdiv(x1); ci++) {
      for (let cj = cdiv(y0); cj <= cdiv(y1); cj++) {
        for (let ck = cdiv(z0); ck <= cdiv(z1); ck++) {
          if (chunkIsLit(ci, cj, ck)) return true
        }
      }
    }
    return false
  }

  /*
   * How the parent quad's four corner colours are read at an interior point.
   *
   * NOT bilinear, and the difference matters. The GPU never draws a quad; it
   * draws the two triangles noa's `decideTriDir` split it into, and inside a
   * triangle a vertex colour is interpolated LINEARLY over three corners, not
   * bilinearly over four. Sampling the parent bilinearly would have shifted
   * ambient occlusion on every split quad by up to the fold in its diagonal.
   *
   * Sampling it the way the rasteriser does makes the split exact wherever it
   * can be: a linear function is reproduced exactly by bilinear interpolation,
   * so any sub-quad lying wholly inside one parent triangle comes out
   * pixel-identical to the unsplit parent. Only sub-quads straddling the
   * parent's diagonal differ, and only by that fold.
   *
   * (s, t) are the quad's own parameters: v0 at (0,0), v1 at (1,0), v2 at
   * (1,1), v3 at (0,1). `diag02` says the diagonal runs v0-v2 rather than
   * v1-v3, which is `decideTriDir`'s output read back off the index buffer.
   */
  const TRI_W = [0, 0, 0, 0]
  function triWeights(s, t, diag02) {
    if (diag02) {
      if (s >= t) { TRI_W[0] = 1 - s; TRI_W[1] = s - t; TRI_W[2] = t; TRI_W[3] = 0 }
      else { TRI_W[0] = 1 - t; TRI_W[1] = 0; TRI_W[2] = s; TRI_W[3] = t - s }
    } else if (s + t >= 1) {
      TRI_W[0] = 0; TRI_W[1] = 1 - t; TRI_W[2] = s + t - 1; TRI_W[3] = 1 - s
    } else {
      TRI_W[0] = 1 - s - t; TRI_W[1] = s; TRI_W[2] = 0; TRI_W[3] = t
    }
    return TRI_W
  }

  /**
   * Per-vertex smooth light, written back into the finished chunk mesh.
   *
   * THE PROBLEM THIS SOLVES, measured rather than suspected (docs/REPORTED.md
   * 5a, `test/58-glowstone-radial.spec.js`, commit 3402684). A terrain vertex
   * is NOT a block corner once noa's greedy mesher has been at it:
   * `maskCompare` in `terrainMesher.js` merges faces whose material and AO
   * mask agree and knows nothing about light, so a flat floor arrives here as
   * a handful of quads many blocks wide. Writing light at their four corners
   * and letting the GPU ramp across the span is what Evan saw as "glowstone
   * lights directionally instead of radially" -- 625 floor blocks became 17
   * quads, one of them 13 wide with corner levels 2/0/1/13. Worse: on a pad
   * big enough that no corner is within 15 blocks of the emitter, the floor
   * got NO light at all.
   *
   * THE FIX: split the lit quads back into unit sub-quads, here, in the
   * readback. Vanilla's equivalent is refusing to merge faces whose light
   * differs; this is the same geometry arrived at from the other end.
   *
   * WHY NO FORK. The doc assumed this had to live inside the merge predicate.
   * It does not. noa's MeshBuilder lays every buffer out perfectly regularly
   * -- four vertices per quad in a fixed order (`addPositionValues`: v0 =
   * corner, v1 = corner + u, v2 = corner + u + v, v3 = corner + v), six
   * indices, UVs linear in u and v, one atlas index per vertex -- so a quad's
   * span is readable straight off the buffers and its subdivision is writable
   * back into them. Staying off a fork is a deliberate, documented property of
   * this file (see the header) and it survives this change.
   *
   * WHICH QUADS GET SPLIT: only those some voxel actually lights. Splitting
   * everything undoes greedy meshing and the vertex count it exists to
   * control, on a world that is largely flat superflat ground.
   *
   * THE T-JUNCTION OBJECTION, and why it is answered rather than accepted. A
   * split quad meeting an unsplit neighbour puts vertices in the middle of the
   * neighbour's edge, which is a T-junction and normally means a visible seam.
   * It does not here, because of WHICH quads are left unsplit. A quad is only
   * left whole when every lattice point across it samples zero. Its neighbour
   * samples those same shared lattice points through the same `sampleLight`,
   * so the split side's vertices on that edge are zero too, and the unsplit
   * side interpolates zero between two zeroes. Both sides of the seam carry
   * the same value, so there is no discontinuity in the light channel -- which
   * is the only channel this pass touches. (Position, normal, UV and colour
   * RGB are interpolated from the parent, so they are continuous by
   * construction.) `test/58-glowstone-radial.spec.js` photographs the boundary.
   *
   * THE ROAD NOT TAKEN: clipping the split to a radius around each emitter
   * instead of to "any light at all". Cheaper on a floor lit by one torch, but
   * it reintroduces exactly the T-junction this rule dodges, because the
   * clipped edge would fall somewhere the light is NOT zero.
   */
  function writeVertexLight(mesh, chunk) {
    const pos = mesh.getVerticesData(VertexBuffer.PositionKind)
    const norm = mesh.getVerticesData(VertexBuffer.NormalKind)
    const col = mesh.getVerticesData(VertexBuffer.ColorKind)
    if (!pos || !norm || !col) return

    const ox = chunk.x, oy = chunk.y, oz = chunk.z
    const ci = cdiv(ox), cj = cdiv(oy), ck = cdiv(oz)
    /*
     * The whole-mesh gate, and it is why an unlit world costs LESS than it did
     * before this change rather than more. noa rebuilds the mesh from scratch
     * on every remesh and `pushAOColor` writes alpha 1, which is already the
     * "no block light" value -- so a chunk with no light within reach needs no
     * pass at all, not even the cheap one. The 3x3x3 of chunk keys is checked
     * rather than just this one, because a face on a seam samples the voxel
     * outside it, which lives in the next chunk over.
     */
    let near = false
    for (let a = -1; a <= 1 && !near; a++) {
      for (let b = -1; b <= 1 && !near; b++) {
        for (let c = -1; c <= 1 && !near; c++) {
          if (chunkIsLit(ci + a, cj + b, ck + c)) near = true
        }
      }
    }
    if (!near) return

    const uv = mesh.getVerticesData(VertexBuffer.UVKind)
    const atlas = mesh.getVerticesData('texAtlasIndices')
    const idx = mesh.getIndices()
    // No index buffer means the parent's winding and diagonal are unknowable,
    // and a sub-quad that guesses them wrong is a hole in the floor. Has never
    // happened -- noa always sets them -- so this is a bail, not a fallback.
    if (!idx || !uv) return
    const nq = (pos.length / 12) | 0

    /*
     * Pass one: measure. Each lit quad's (w+1)*(h+1) lattice light values are
     * computed once and KEPT, because pass two needs the identical numbers and
     * recomputing them would double the only expensive part of this function.
     */
    const grids = new Array(nq).fill(null)
    let anySplit = false
    for (let f = 0; f < nq; f++) {
      const p = f * 12
      const x0 = pos[p], y0 = pos[p + 1], z0 = pos[p + 2]
      // u = v1 - v0, v = v3 - v0. Both are axis-aligned with exactly one
      // non-zero, positive component, so the magnitude IS that component.
      const ux = pos[p + 3] - x0, uy = pos[p + 4] - y0, uz = pos[p + 5] - z0
      const vx = pos[p + 9] - x0, vy = pos[p + 10] - y0, vz = pos[p + 11] - z0
      const w = Math.round(ux + uy + uz)
      const h = Math.round(vx + vy + vz)
      if (w < 1 || h < 1) continue

      // Cheap reject before the grid: the box of voxels this face can possibly
      // sample. Conservative by one block on the low side of every axis, which
      // is what the `- a` / `- b` in sampleLight reaches back for.
      if (!boxIsLit(
        ox + x0 - 1, oy + y0 - 1, oz + z0 - 1,
        ox + x0 + ux + vx, oy + y0 + uy + vy, oz + z0 + uz + vz)) continue

      const nx = norm[p], ny = norm[p + 1], nz = norm[p + 2]
      const g = new Float32Array((w + 1) * (h + 1))
      // The lit lattice points' bounding box, in lattice indices.
      let A0 = w + 1, A1 = -1, B0 = h + 1, B1 = -1
      for (let b = 0; b <= h; b++) {
        const t = b / h
        for (let a = 0; a <= w; a++) {
          const sPar = a / w
          const l = sampleLight(
            ox + x0 + ux * sPar + vx * t,
            oy + y0 + uy * sPar + vy * t,
            oz + z0 + uz * sPar + vz * t, nx, ny, nz)
          g[b * (w + 1) + a] = l
          if (l > 0) {
            if (a < A0) A0 = a
            if (a > A1) A1 = a
            if (b < B0) B0 = b
            if (b > B1) B1 = b
          }
        }
      }
      if (A1 < 0) continue // nothing on this quad is lit after all
      /*
       * WHICH CELLS GET SPLIT, and the -1 is the whole T-junction argument.
       *
       * The split is clipped to the lit lattice points' bounding box, widened
       * by one cell on each side. That widening is what guarantees the split
       * region's OUTER lattice ring is all zeroes: A0 is the first lit lattice
       * column, so column A0-1 is dark by definition. Every large remainder
       * quad below therefore meets the split region along an edge that reads
       * zero from both sides, and interpolates zero to zero across itself.
       * There is no discontinuity in the light channel to see.
       *
       * Without the clip a single torch on a chunk-wide floor would shatter
       * the entire 32x32 quad instead of the disc it actually lights -- which
       * is roughly a 4x difference in vertices in the superflat case, and the
       * difference between sky light being affordable and not.
       */
      const cA0 = Math.max(0, A0 - 1), cA1 = Math.min(w - 1, A1)
      const cB0 = Math.max(0, B0 - 1), cB1 = Math.min(h - 1, B1)
      const split = (cA1 - cA0 + 1) * (cB1 - cB0 + 1) > 1
      grids[f] = { w, h, g, cA0, cA1, cB0, cB1, split }
      if (split) anySplit = true
    }

    if (!grids.some(Boolean)) return

    /*
     * The cheap exit: light touched this mesh but every lit quad was already
     * one block, so only the alpha lane changes and the geometry does not.
     * This is the path a torch in a cramped room takes, and the one
     * test/56-block-light.spec.js has always exercised.
     *
     * setVerticesData rather than updateVerticesData: noa applies its vertex
     * data non-updatable, and Babylon's update path on a STATIC_DRAW buffer is
     * a silent no-op on some backends. Rebuilding provably lands.
     */
    if (!anySplit) {
      for (let f = 0; f < nq; f++) {
        const q = grids[f]
        if (!q) continue
        for (let c = 0; c < 4; c++) {
          // Lattice order round the quad: v0 (0,0), v1 (1,0), v2 (1,1), v3 (0,1).
          const a = (c === 1 || c === 2) ? q.w : 0
          const b = (c === 2 || c === 3) ? q.h : 0
          col[(f * 4 + c) * 4 + 3] = 1 - q.g[b * (q.w + 1) + a] / MAX_LIGHT
        }
      }
      mesh.setVerticesData(VertexBuffer.ColorKind, col, false, 4)
      return
    }

    /*
     * Pass two: rebuild, FOUR VERTICES PER QUAD and no vertex sharing.
     *
     * Sharing a sub-quad lattice would cost about a third of the vertices, and
     * it is wrong here: `src/fluidGeometry.js` wraps `meshChunk` OUTSIDE this
     * one and reads the result back with `nf = pos.length / 12` and
     * `idx[f*6+i] - f*4`. That layout -- noa's own -- is a contract between
     * three files, not an implementation detail of this one. Breaking it would
     * hand fluidGeometry garbage quads to reshape. fluidGeometry's own split
     * keeps the same contract, which is why the two can stack.
     */
    const outPos = [], outNorm = [], outCol = [], outUV = [], outIdx = []
    const outAtlas = atlas ? [] : null
    let vcount = 0

    for (let f = 0; f < nq; f++) {
      const q = grids[f]
      const p = f * 12
      /*
       * The parent's own winding and diagonal, read back off the index buffer
       * rather than recomputed. `addIndexValues` writes faceNum*4 plus one of
       * four fixed patterns, so subtracting the base recovers the pattern
       * exactly -- including which way `decideTriDir` split it, which is the
       * thing ambient occlusion is most sensitive to.
       */
      const pat = [0, 1, 2, 3, 4, 5].map((i) => idx[f * 6 + i] - f * 4)

      if (!q || !q.split) {
        for (let c = 0; c < 4; c++) {
          const src = f * 4 + c
          outPos.push(pos[src * 3], pos[src * 3 + 1], pos[src * 3 + 2])
          outNorm.push(norm[src * 3], norm[src * 3 + 1], norm[src * 3 + 2])
          const a = q ? ((c === 1 || c === 2) ? q.w : 0) : 0
          const b = q ? ((c === 2 || c === 3) ? q.h : 0) : 0
          outCol.push(col[src * 4], col[src * 4 + 1], col[src * 4 + 2],
            q ? 1 - q.g[b * (q.w + 1) + a] / MAX_LIGHT : col[src * 4 + 3])
          outUV.push(uv[src * 2], uv[src * 2 + 1])
          if (outAtlas) outAtlas.push(atlas[src])
        }
        for (let i = 0; i < 6; i++) outIdx.push(vcount + pat[i])
        vcount += 4
        continue
      }

      const { w, h, g, cA0, cA1, cB0, cB1 } = q
      const x0 = pos[p], y0 = pos[p + 1], z0 = pos[p + 2]
      const ux = pos[p + 3] - x0, uy = pos[p + 4] - y0, uz = pos[p + 5] - z0
      const vx = pos[p + 9] - x0, vy = pos[p + 10] - y0, vz = pos[p + 11] - z0
      const diag02 = (pat[0] === 0 || pat[1] === 0 || pat[2] === 0)
        && (pat[0] === 2 || pat[1] === 2 || pat[2] === 2)

      /** One output quad covering lattice [a0,a1] x [b0,b1] of the parent. */
      const emit = (a0, b0, a1, b1) => {
        const as = [a0, a1, a1, a0], bs = [b0, b0, b1, b1]
        for (let c = 0; c < 4; c++) {
          const sPar = as[c] / w, t = bs[c] / h
          outPos.push(
            x0 + ux * sPar + vx * t,
            y0 + uy * sPar + vy * t,
            z0 + uz * sPar + vz * t)
          outNorm.push(norm[p], norm[p + 1], norm[p + 2])
          // UVs are linear in (s, t) by construction (`addUVs`), and bilinear
          // interpolation reproduces a linear function exactly, so no triangle
          // bookkeeping is needed here -- unlike the colours just below.
          for (let e = 0; e < 2; e++) {
            outUV.push(
              (1 - sPar) * (1 - t) * uv[(f * 4) * 2 + e] +
              sPar * (1 - t) * uv[(f * 4 + 1) * 2 + e] +
              sPar * t * uv[(f * 4 + 2) * 2 + e] +
              (1 - sPar) * t * uv[(f * 4 + 3) * 2 + e])
          }
          if (outAtlas) outAtlas.push(atlas[f * 4])
          const tw = triWeights(sPar, t, diag02)
          for (let e = 0; e < 3; e++) {
            outCol.push(
              tw[0] * col[(f * 4) * 4 + e] +
              tw[1] * col[(f * 4 + 1) * 4 + e] +
              tw[2] * col[(f * 4 + 2) * 4 + e] +
              tw[3] * col[(f * 4 + 3) * 4 + e])
          }
          outCol.push(1 - g[bs[c] * (w + 1) + as[c]] / MAX_LIGHT)
        }
        for (let i = 0; i < 6; i++) outIdx.push(vcount + pat[i])
        vcount += 4
      }

      for (let b = cB0; b <= cB1; b++) {
        for (let a = cA0; a <= cA1; a++) emit(a, b, a + 1, b + 1)
      }
      // The remainder, still merged. Four rectangles at most, and each one is
      // dark on all four corners by the argument above.
      if (cA0 > 0) emit(0, 0, cA0, h)
      if (cA1 + 1 < w) emit(cA1 + 1, 0, w, h)
      if (cB0 > 0) emit(cA0, 0, cA1 + 1, cB0)
      if (cB1 + 1 < h) emit(cA0, cB1 + 1, cA1 + 1, h)
    }

    /*
     * VertexData.applyToMesh rather than five setVerticesData calls. The
     * vertex COUNT changes here, and applyToMesh is the path noa itself used
     * to build this mesh: it orders the writes so positions land first and
     * rebuilds the submesh over the new index range. Setting the buffers
     * piecemeal leaves Babylon's geometry with a stale _totalVertices between
     * calls, which is a crash waiting on a resize.
     *
     * Uint16 runs out at 65536 vertices and a heavily lit chunk can pass that.
     * Babylon's `_normalizeIndexData` takes a Uint32Array as 32-bit indices
     * directly, and every WebGL2 context supports them.
     */
    const vdat = new VertexData()
    vdat.positions = new Float32Array(outPos)
    vdat.normals = new Float32Array(outNorm)
    vdat.colors = new Float32Array(outCol)
    vdat.uvs = new Float32Array(outUV)
    vdat.indices = vcount > 65535 ? new Uint32Array(outIdx) : new Uint16Array(outIdx)
    vdat.applyToMesh(mesh)
    // Not a standard VertexBuffer kind, so applyToMesh does not carry it.
    if (outAtlas) mesh.setVerticesData('texAtlasIndices', new Float32Array(outAtlas), false, 1)
  }

  /* -------------------------------------------------------------- *
   * Public surface
   * -------------------------------------------------------------- */

  const api = {
    /** Block light level 0..15 at a voxel. What F3's "Client Light" wants. */
    getBlockLight: (x, y, z) => getLight(Math.floor(x), Math.floor(y), Math.floor(z)),
    /** Emission level of a block id, 0 if it does not glow. */
    emissionOf: (id) => emissionById[id] || 0,
    /** ms spent in the last block edit's propagation. For the perf spec. */
    lastEditMs: () => editMs,
    /** ms spent rewriting vertex light on the last chunk meshed. */
    lastMeshMs: () => meshMs,
    /** Number of chunks currently holding light data. */
    chunkCount: () => store.size,
    EMISSION,
    MAX_LIGHT,
  }
  // Self-published rather than routed through main.js's `window.game`, because
  // main.js belongs to another agent this session and the specs need a handle.
  if (typeof window !== 'undefined') window.blockLight = api
  return api
}
