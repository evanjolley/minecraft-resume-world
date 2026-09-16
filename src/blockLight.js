import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js'

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

  const ckey = (ci, cj, ck) => ci + '|' + cj + '|' + ck
  const cdiv = (v) => Math.floor(v / CS)
  // JS % keeps the sign of the dividend, so -1 % 32 is -1, not 31.
  const cmod = (v) => ((v % CS) + CS) % CS

  function bufFor(ci, cj, ck, create) {
    const k = ckey(ci, cj, ck)
    let buf = store.get(k)
    if (!buf && create) {
      buf = new Uint8Array(CS * CS * CS)
      store.set(k, buf)
      coords.set(k, [ci, cj, ck])
    }
    return buf
  }

  function getLight(x, y, z) {
    const buf = store.get(ckey(cdiv(x), cdiv(y), cdiv(z)))
    if (!buf) return 0
    return buf[cmod(x) * CS2 + cmod(y) * CS + cmod(z)]
  }

  /** Dirty chunk keys accumulated by a propagation pass. */
  const dirty = new Set()

  function setLight(x, y, z, v) {
    const ci = cdiv(x), cj = cdiv(y), ck = cdiv(z)
    const buf = bufFor(ci, cj, ck, true)
    buf[cmod(x) * CS2 + cmod(y) * CS + cmod(z)] = v
    /*
     * SUBTLE: a voxel on a chunk boundary is a vertex of the NEIGHBOUR's mesh
     * too -- the mesher samples the air voxel outside each face, which for a
     * face on the seam lives in the next chunk over. So a light change one
     * voxel inside the boundary has to dirty both chunks or the seam shows a
     * hard brightness line. Marking the 3x3x3 of chunk keys around the voxel
     * is the blunt version and costs a few Set writes.
     */
    dirty.add(ckey(ci, cj, ck))
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
   * Per-vertex smooth light, the same shape ambient occlusion already uses.
   *
   * A terrain vertex sits on a block CORNER, and the four voxels touching that
   * corner on the outside of the face are what vanilla averages. The face
   * normal says which side "outside" is; the other two axes give the 2x2.
   * Opaque voxels are skipped rather than counted as zero -- counting them
   * would draw a dark rim around every lit block where it meets the floor.
     *
   * KNOWN BROKEN, and measured rather than suspected. A terrain vertex is NOT
   * a block corner once noa's greedy mesher has been at it: `maskCompare` in
   * `terrainMesher.js` merges faces whose material and AO mask agree and knows
   * nothing about light, so a flat floor arrives here as a handful of quads
   * many blocks wide. This loop then writes light at their four corners and
   * the GPU ramps linearly across the whole span -- which is what Evan saw as
   * "glowstone lights directionally instead of radially" (docs/REPORTED.md
   * 5a, confirmed). `test/58-glowstone-radial.spec.js` has the numbers: 625
   * floor blocks become 17 quads, one of them 13 wide with corner levels
   * 2/0/1/13, and the same floor chequered so nothing can merge gives 624
   * quads of 1x1 and a falloff that goes round.
   *
   * The fix does NOT need a fork, which is the part the docs had wrong. noa's
   * MeshBuilder writes four vertices per quad in a fixed order (v0 = corner,
   * v1 = corner + width, v3 = corner + height) with six indices and linear
   * UVs, so a quad's span is readable straight off these same buffers and lit
   * quads could be split into unit sub-quads right here. Undecided and
   * therefore unbuilt: which quads to split (splitting all of them undoes
   * greedy meshing; splitting only lit ones leaves T-junctions at the border)
   * and what the resulting retriangulation does to AO, which interpolates
   * per-triangle and whose diagonal noa picks with `decideTriDir`.
   */
  function writeVertexLight(mesh, chunk) {
    const pos = mesh.getVerticesData(VertexBuffer.PositionKind)
    const norm = mesh.getVerticesData(VertexBuffer.NormalKind)
    const col = mesh.getVerticesData(VertexBuffer.ColorKind)
    if (!pos || !norm || !col) return
    const ox = chunk.x, oy = chunk.y, oz = chunk.z
    const n = pos.length / 3
    for (let v = 0; v < n; v++) {
      const px = ox + pos[v * 3], py = oy + pos[v * 3 + 1], pz = oz + pos[v * 3 + 2]
      const nx = norm[v * 3], ny = norm[v * 3 + 1], nz = norm[v * 3 + 2]
      // Step half a block along the normal to land inside the voxel the face
      // looks into, then floor: corner + 0.5*normal is that voxel's boundary.
      let sum = 0, count = 0
      for (let a = 0; a < 2; a++) {
        for (let b = 0; b < 2; b++) {
          let vx, vy, vz
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
      const level = count ? sum / count : 0
      col[v * 4 + 3] = 1 - level / MAX_LIGHT
    }
    // setVerticesData rather than updateVerticesData: noa applies its vertex
    // data non-updatable, and Babylon's update path on a STATIC_DRAW buffer is
    // a silent no-op on some backends. Rebuilding the buffer is a few hundred
    // KB per remesh and provably lands.
    mesh.setVerticesData(VertexBuffer.ColorKind, col, false, 4)
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
