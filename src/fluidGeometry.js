import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js'
import { standaloneLayer } from './terrainAnimation.js'

/*
 * THE SHAPE OF FLOWING WATER.
 *
 * Reported from play: "there is no FLOWING water... all of the water blocks
 * are WHOLE blocks. So on the flat ground there is nothing flowing... Like
 * full block of water, flow outward that gets more and more short, eventually
 * is very short at the end of the run and it stops."
 *
 * The flow SIMULATION was already right -- sixteen ids, correct propagation,
 * water falls before it spreads. Every one of those ids rendered as a full
 * cube, which is the whole of the complaint.
 *
 * ------------------------------------------------------------------
 * MINECRAFT'S HEIGHTS, and they are not sixteenths.
 *
 *   BlockLiquid.getLiquidHeightPercent(meta):
 *       if (meta >= 8) meta = 0;
 *       return (float)(meta + 1) / 9.0F;
 *
 *   -- MCP-919, net/minecraft/block/BlockLiquid.java. That figure is the GAP
 *   above the fluid, not the fluid: World.handleMaterialAcceleration reads the
 *   surface as `(l1 + 1) - getLiquidHeightPercent(level)`. So a cell at level
 *   L stands (8 - L)/9 blocks tall -- a source is 8/9 = 0.889 and a level-7
 *   cell is 1/9 = 0.111. NINTHS, not sixteenths, and the source is not a full
 *   block either.
 *
 * ------------------------------------------------------------------
 * WHY THIS IS A MESH POST-PASS AND NOT A `shape`.
 *
 * blocks.js says at length why a `shape` was refused: it takes the block off
 * noa's terrain mesher, which costs the `fluid` flag's buoyancy, puts the id
 * back into blockTargetIdCheck as something minable, and hands it to
 * installNonCubeCollision as something SOLID. Three regressions in the
 * hard-won part of fluids.js to buy a cosmetic slope. That judgement stands.
 *
 * So the block table is untouched -- every fluid id is still a full cube to
 * noa, to physics and to the raycast -- and only the finished VERTICES are
 * moved. That is exactly the seam blockLight.js opened: `meshChunk` is
 * replaced on the noa INSTANCE, the original runs untouched, and the mesh it
 * produced is rewritten before anyone sees it. noa is not forked and
 * `npm update` still works.
 *
 * REJECTED, and each for a reason that was checked rather than assumed:
 *
 *   - A custom block mesh that keeps `fluid: true`. noa's greedy mesher never
 *     consults the object-block lookup (blocks.js says so where it registers
 *     slabs): it draws a terrain face for any block that HAS a face material.
 *     So the flow ids would have to lose their material, which takes water out
 *     of the terrain material entirely -- and underwater.js's camera effect,
 *     the alpha page and 46-water-look all hang off that material. A much
 *     bigger blast radius than moving vertices.
 *
 *   - Pure vertex displacement in a MaterialPlugin, no retessellation. It
 *     cannot work and the reason is the greedy mesher: a seven-block run of
 *     water is ONE merged quad with four corner vertices, because every flow
 *     level resolves to the same `water_still` material and
 *     constructMeshMask's `if (m0 === m1) continue` culls every face between
 *     them. Four vertices cannot describe seven different heights. A shader
 *     has nothing to displace.
 *
 *   - Giving each flow level its own material so the merge breaks. Sixteen
 *     duplicate atlas layers of a 32-frame animated texture, sixteen entries
 *     in terrainAnimation's remap table -- and it still would not draw the
 *     step faces between levels, because noa's mesher ends with "two different
 *     non-opaque blocks facing each other... for now we draw neither".
 *
 * So the merged quads are SPLIT back into unit cells here and each corner is
 * placed at its own height. Which is not a workaround -- it is what vanilla
 * does. Corner averaging (below) is why a run reads as one continuous sheet
 * instead of a staircase, and a continuous sheet is exactly why the step faces
 * the mesher refuses to draw are not needed.
 */

/** Vanilla's own height for one cell, before the corners are averaged. */
export function ownHeight(meta) {
  // A falling column is drawn full-height. In vanilla that falls out of the
  // corner rule below rather than being a special case -- a falling cell
  // always has fluid above it -- but the flow engine hands us the flag
  // directly and agreeing with it is cheaper than re-deriving it.
  if (meta.falling) return 1
  return (8 - meta.level) / 9
}

/**
 * The height of ONE CORNER of the fluid surface, averaged over the four
 * columns that touch it. This is `LiquidBlockRenderer.getHeight` /
 * BlockFluidRenderer's `getFluidHeight`, and the x10 weighting is vanilla's:
 *
 *   if (f1 >= 0.8F) { f += f1 * 10.0F; i += 10; } else { f += f1; ++i; }
 *
 * A source (8/9 = 0.889) therefore outvotes ten shallow neighbours, which is
 * what keeps the water touching a source visually AT the source's height and
 * makes the drop happen a block out rather than immediately.
 *
 * Air counts as a column of height zero (`++i` with nothing added), so the
 * sheet tapers down to meet the ground at the end of a run instead of ending
 * in a cliff. A SOLID neighbour is skipped entirely -- water against a wall
 * keeps its height rather than being dragged to zero by the wall.
 *
 * @param world  { fluidAt(x,y,z), isSolid(x,y,z) }
 * @param fluid  'water' | 'lava' -- only the same fluid contributes
 * @param x,z    the CORNER, an integer world coordinate. The four columns
 *               that share it are x-1..x by z-1..z.
 * @param y      the voxel row the surface is in.
 */
export function cornerHeight(world, fluid, x, y, z) {
  let sum = 0
  let count = 0
  for (let j = 0; j < 4; j++) {
    const bx = x - (j & 1)
    const bz = z - ((j >> 1) & 1)
    // Fluid directly above any of the four columns means this corner is at
    // the very top of a full cell -- the interior of an ocean, or a falling
    // column. Vanilla returns 1.0 immediately and so does this.
    const above = world.fluidAt(bx, y + 1, bz)
    if (above && above.fluid === fluid) return 1
    const here = world.fluidAt(bx, y, bz)
    if (here && here.fluid === fluid) {
      const h = ownHeight(here)
      if (h >= 0.8) { sum += h * 10; count += 10 } else { sum += h; count++ }
    } else if (!world.isSolid(bx, y, bz)) {
      count++
    }
  }
  return count ? sum / count : 0
}

/**
 * THE FLOW VECTOR. One function, three jobs.
 *
 * BlockLiquid.getFlowVector, MCP-919, verbatim in shape:
 *
 *     for (EnumFacing f : HORIZONTAL) {
 *         int j = getEffectiveFlowDecay(world, pos.offset(f));
 *         if (j < 0) { if (!blocksMovement(pos.offset(f))) {
 *             j = getEffectiveFlowDecay(world, pos.offset(f).down());
 *             if (j >= 0) { int k = j - (i - 8);  vec = vec.add(offset * k); }
 *         } }
 *         else { int l = j - i;  vec = vec.add(offset * l); }
 *     }
 *
 * `getEffectiveFlowDecay` is the level, with a falling cell counted as 0.
 * A THINNER neighbour (higher level) gives a positive weight, so the vector
 * points downhill. A neighbour that is air but has fluid BELOW it -- the lip
 * of a ledge -- is weighted `j - (i - 8)`, a large positive number, which is
 * why water visibly accelerates toward an edge instead of drifting over it.
 *
 * The `-6.0D` term: a falling column with a solid block beside it gets a
 * strong downward component, so a waterfall pins you against the wall and
 * drags you down rather than spitting you sideways.
 *
 * This one vector rotates the flow TEXTURE (vanilla: `atan2(z, x) - PI/2`)
 * and pushes ENTITIES (World.handleMaterialAcceleration). Computing the
 * direction twice is how the picture and the shove stop agreeing.
 *
 * @returns {[number, number, number]} a unit vector, or [0,0,0] if still.
 */
export function flowVector(world, x, y, z) {
  const me = world.fluidAt(x, y, z)
  if (!me) return [0, 0, 0]
  const fluid = me.fluid
  const decay = (bx, by, bz) => {
    const m = world.fluidAt(bx, by, bz)
    if (!m || m.fluid !== fluid) return -1
    return m.falling ? 0 : m.level
  }
  const i = decay(x, y, z)
  let vx = 0, vy = 0, vz = 0
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const j = decay(x + dx, y, z + dz)
    if (j >= 0) {
      const l = j - i
      vx += dx * l
      vz += dz * l
    } else if (!world.isSolid(x + dx, y, z + dz)) {
      const below = decay(x + dx, y - 1, z + dz)
      if (below >= 0) {
        const k = below - (i - 8)
        vx += dx * k
        vz += dz * k
      }
    }
  }
  if (me.falling) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (world.isSolid(x + dx, y, z + dz) || world.isSolid(x + dx, y + 1, z + dz)) {
        const n = Math.hypot(vx, vy, vz)
        if (n > 0) { vx /= n; vy /= n; vz /= n }
        vy -= 6
        break
      }
    }
  }
  const n = Math.hypot(vx, vy, vz)
  if (n === 0) return [0, 0, 0]
  return [vx / n, vy / n, vz / n]
}

/**
 * The four corner UVs of one cell's top face, rotated to face the flow.
 *
 * WHAT VANILLA DOES. LiquidBlockRenderer, for a cell whose flow vector has any
 * horizontal component:
 *
 *     float f10 = atan2(vec3.z, vec3.x) - PI/2;
 *     float f11 = sin(f10) * 0.25F;  float f12 = cos(f10) * 0.25F;
 *     u = sprite.getU(0.5F + (-f12 - f11)) ...   (four corners, NW/SW/SE/NE)
 *
 * Two facts are buried in those constants and both matter here. The 0.25 is a
 * HALF-SCALE sample: the quad takes the middle 8x8 of the 16x16 sprite, so the
 * rotated square never runs off the tile no matter which way it points. And
 * the four corner expressions are a rotation matrix written out longhand --
 * solving them for the offset (dx, dz) of a corner from the cell centre gives
 *
 *     u = 0.5 + 0.5 * (d . perp)      v = 0.5 + 0.5 * (d . flow)
 *
 * with `flow` the unit horizontal flow. v increases ALONG the flow, which is
 * the whole point: `water_flow.png`'s streaks run down the image, so pointing
 * +v downhill points the streaks downhill.
 *
 * WHY `perp` IS `(-fz, fx)` AND NOT VANILLA'S SIGN, which looks like a bug and
 * is not. Solving vanilla's four expressions the same way gives the opposite
 * perpendicular -- because Minecraft's still-water UV frame has v increasing
 * with +z, and noa's has v DECREASING with +z (terrainMesher.addUVs, axis 1:
 * `uvArr[offset+1] = uvArr[offset+7] = w`, so v = w at the low-z corners).
 * Copying vanilla's sign into a mirrored base frame would mirror the flow
 * texture relative to the still texture it sits next to. Matching the frame we
 * are actually in is what keeps them the same handedness.
 *
 * (v = 0 is the TOP of the tile, checked rather than assumed: for a SIDE face
 * the same table puts v = h at the low-y corners and v = 0 at the high-y ones,
 * and every side texture in the world is right-side-up, so v = 0 is the top of
 * the image. That is the fact the paragraph above turns on.)
 *
 * @param fx,fz  the unit horizontal flow direction
 * @param dx,dz  the corner's offset from the cell centre, each -0.5 or +0.5
 * @returns {[number, number]} u, v
 */
export function flowUV(fx, fz, dx, dz) {
  return [
    0.5 + 0.5 * (dx * -fz + dz * fx),
    0.5 + 0.5 * (dx * fx + dz * fz),
  ]
}

/* ------------------------------------------------------------------ *
 * The mesh half
 * ------------------------------------------------------------------ */

/**
 * blockLight.js's sky-light lane, by name.
 *
 * The string is duplicated rather than imported because blockLight.js keeps
 * its `SKY_ATTRIB` module-private, and the terrain vertex format is a contract
 * between these two files either way -- `pos.length / 12`, `idx[f*6+i] - f*4`
 * and this name are all things both sides have to agree on. A rename there
 * should break this file loudly rather than be quietly followed; the sky lane
 * going missing is EXACTLY the bug this constant exists to have fixed.
 *
 * Holds `1 - sky/15`, inverted, which is why a mesh that never carried one
 * renders at full sky rather than pitch black -- and therefore why this
 * attribute being dropped looked like "water is too bright in a cave" instead
 * of looking like a crash.
 */
const SKY_ATTRIB = 'noaSkyLight'

/**
 * Split every merged fluid quad back into unit cells and drop each corner to
 * its own height.
 *
 * Installed from fluids.js rather than main.js, and therefore AFTER
 * installBlockLight. That ordering is deliberate and load-bearing: this
 * wrapper is the outer one, so block light has already written BOTH its lanes
 * on the un-split mesh by the time the split runs -- the alpha of the colour
 * buffer, and the separate `noaSkyLight` attribute -- and the split
 * INTERPOLATES both along with everything else. Light and ambient occlusion
 * survive at exactly the values noa and blockLight computed. The other order
 * would leave the new vertices unlit until the next remesh.
 *
 * Being the outer wrapper is also the whole of the obligation: every buffer
 * the inner wrappers wrote has to come back out of here at the NEW vertex
 * count. `noaSkyLight` was missed once already and shipped as "water is bright
 * in a cave"; blockLight.js guards against the shape of that mistake with a
 * deferred wrap outside this one that drops any sky attribute whose length
 * disagrees with the position buffer. That guard should now be a no-op --
 * 69-fluid-sky asserts the length agrees -- and anything added to this
 * readback later has to keep it that way.
 */
export function installFluidGeometry(noa, world) {
  const mesher = noa._terrainMesher
  /*
   * THE MESHCHUNK CONTRACT -- read docs/lighting.md section 9 before changing
   * anything here. This is the OUTERMOST of the three stacked wraps of
   * meshChunk, so it sees blockLight.js's vertex alpha and noaSkyLight
   * already applied and must keep every per-vertex attribute the same length
   * as `position` -- a stale-length attribute makes getVerticesData throw and
   * the chunk simply does not appear.
   */
  const origMeshChunk = mesher.meshChunk.bind(mesher)
  let meshMs = 0
  let splitFaces = 0
  let flowFaces = 0

  /*
   * WHICH ATLAS LAYER IS THE FLOW TEXTURE, per fluid.
   *
   * `texAtlasIndices` is a per-VERTEX attribute, which is the fact this whole
   * feature rests on: the layer a quad samples is a number in the vertex
   * buffer, not a property of the block id that produced it. This pass is
   * already rewriting that buffer to split merged quads, so pointing one quad
   * at a different layer costs a different number in an array that was being
   * written anyway -- no new block id, no new material, no second mesh.
   *
   * -1 means the run is not in the atlas (an older build of public/textures/,
   * or someone removing the entry from terrainAnimation.js). Everything below
   * then falls through to the still texture, which is exactly today's picture.
   *
   * REJECTED -- A MATERIAL PER DIRECTION, which is what blocks.js said this
   * would cost ("four more ids again"). It is wrong on its own terms: a
   * direction is continuous, and four ids buy four of them, so a flow running
   * diagonally still points the wrong way. It is also sixteen more ids and
   * sixteen duplicate copies of a 32-frame animated texture in the atlas, to
   * express something the vertex buffer can already say per quad.
   *
   * REJECTED -- ROTATING THE UVs IN A MATERIAL PLUGIN, in the shader, which
   * was the obvious place to look given terrainAnimation.js and blockLight.js
   * both stack plugins on these materials. The shader has no idea which VOXEL
   * a fragment belongs to: the terrain vertex format carries position, normal,
   * colour, uv and one atlas index, and the only way to get a per-cell angle
   * down there is to add a vertex attribute -- which means writing a number
   * per vertex in the mesher readback anyway. Having come that far, writing
   * the finished UVs is the same work minus a shader.
   *
   * REJECTED -- the flow texture on SIDE faces of still water, which vanilla
   * does unconditionally. See the note in emit(); it repaints every ocean edge
   * in the world to buy nothing the report asked for.
   */
  const FLOW_LAYER = {
    water: standaloneLayer('water_flow'),
    lava: standaloneLayer('lava_flow'),
  }

  mesher.meshChunk = function (chunk, ignoreMaterials) {
    origMeshChunk(chunk, ignoreMaterials)
    const t0 = performance.now()
    for (const mesh of chunk._terrainMeshes) reshape(mesh, chunk)
    meshMs = performance.now() - t0
  }

  /**
   * Which voxel does a face belong to?
   *
   * A face sits on the PLANE between two voxels and its normal says which of
   * the two it is drawing. Step half a block backwards along the normal from
   * any point on the face and you are inside the owner -- the same trick
   * blockLight.js uses to find the voxel a vertex's light comes from, run in
   * the opposite direction.
   */
  function reshape(mesh, chunk) {
    const pos = mesh.getVerticesData(VertexBuffer.PositionKind)
    const norm = mesh.getVerticesData(VertexBuffer.NormalKind)
    const col = mesh.getVerticesData(VertexBuffer.ColorKind)
    const uv = mesh.getVerticesData(VertexBuffer.UVKind)
    const atlas = mesh.getVerticesData('texAtlasIndices')
    /*
     * THE SECOND LIGHT LANE, and the one thing this pass used to lose.
     *
     * Block light rides in vertex ALPHA, so `bilinear(col, ...)` below has
     * always carried it for free. Sky light cannot share that lane (the GPU
     * interpolates, and the interpolation of a packed pair is not the pair of
     * the interpolations -- blockLight.js's header works the arithmetic), so
     * it is a second attribute, and a second attribute has to be carried by
     * hand exactly like `texAtlasIndices` is. It was not, so the rebuilt mesh
     * left it behind at the old vertex count and every fluid surface in the
     * world rendered at full sky. Water in a sealed cave at noon was as bright
     * as water in the meadow above it.
     *
     * Null when blockLight never wrote one -- a mesh whose every vertex sits
     * under open sky skips the allocation entirely, since 0 already means full
     * sky. Absent in, absent out: rebuilding a zero-filled one would be the
     * same picture for the cost of a buffer.
     */
    const sky = mesh.getVerticesData(SKY_ATTRIB)
    const idx = mesh.getIndices()
    if (!pos || !norm || !col || !uv || !idx) return
    const ox = chunk.x, oy = chunk.y, oz = chunk.z
    const nf = pos.length / 12

    // Pass one: is there anything here to do at all? An ordinary terrain
    // chunk has no fluid in it and must not pay for this.
    let any = false
    const owner = new Int8Array(nf)   // 0 no, 1 yes
    for (let f = 0; f < nf; f++) {
      if (!faceIsFluid(pos, norm, f, ox, oy, oz)) continue
      owner[f] = 1
      any = true
    }
    if (!any) return

    const outPos = [], outNorm = [], outCol = [], outUV = [], outIdx = []
    const outAtlas = atlas ? [] : null
    const outSky = sky ? [] : null
    let vcount = 0

    for (let f = 0; f < nf; f++) {
      const o = f * 12
      const p0 = [pos[o], pos[o + 1], pos[o + 2]]
      const p1 = [pos[o + 3], pos[o + 4], pos[o + 5]]
      const p3 = [pos[o + 9], pos[o + 10], pos[o + 11]]
      const du = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]
      const dv = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]]
      const w = Math.round(Math.abs(du[0]) + Math.abs(du[1]) + Math.abs(du[2])) || 1
      const h = Math.round(Math.abs(dv[0]) + Math.abs(dv[1]) + Math.abs(dv[2])) || 1
      // The winding noa chose for this face (it varies: see decideTriDir).
      // Copied rather than recomputed, so the split cells triangulate the
      // same way the merged quad did.
      const pattern = [0, 1, 2, 3, 4, 5].map(i => idx[f * 6 + i] - f * 4)
      const nx = norm[o], ny = norm[o + 1], nz = norm[o + 2]

      /** One output quad covering [s0,s1] x [t0,t1] of the parent's span. */
      const emit = (s0, t0, s1, t1) => {
        /*
         * WHICH VOXEL IS THIS CELL DRAWING, and it has to be asked per CELL
         * rather than per face -- a merged quad spans many voxels and after
         * the split each output quad covers exactly one.
         *
         * A face sits on the PLANE between two voxels; its normal says which
         * of the two it belongs to. Step half a block BACK along the normal
         * from the cell's centre and you land inside the owner. (blockLight.js
         * steps half a block FORWARD along the same normal to find the voxel a
         * face looks into; this is that trick reversed.)
         */
        const mx = (s0 + s1) / 2, mt = (t0 + t1) / 2
        const vox = [0, 0, 0]
        for (let c = 0; c < 3; c++) {
          vox[c] = Math.floor(p0[c] + du[c] * mx + dv[c] * mt - norm[o + c] * 0.5)
        }
        // World-space top plane of that voxel. A vertex sitting exactly there
        // is on the fluid's surface and is the only kind that moves: the foot
        // of a side face stays on the floor, an underside stays put.
        const topY = vox[1] + oy + 1
        /*
         * WHICH TEXTURE THIS CELL DRAWS, decided once per cell, before its
         * corners are placed -- because the answer is a property of the cell
         * and both the layer and the UVs have to agree about it.
         *
         * `dir` non-null means "rotate the flow texture to face this way".
         * `layer` >= 0 means "sample the flow run instead of the still one".
         *
         * THE FLOW VECTOR IS READ, NOT RE-DERIVED. flowVector() above is the
         * one that already shapes the sloped surface and shoves the player
         * (fluids.js exports it as `flowVectorAt`). Its own docblock says
         * computing the direction twice is how the picture and the shove stop
         * agreeing; this is the third consumer it was written for.
         *
         * TOP faces: vanilla uses the still sprite when the flow vector has no
         * horizontal component and the rotated flow sprite otherwise, so an
         * ocean surface is untouched and only water that is going somewhere
         * looks like it. SIDE faces: vanilla uses the flow sprite
         * unconditionally, even on a still source. We narrow that to cells
         * that are actually flowing -- a level above 0, or falling -- because
         * the unconditional version repaints every ocean edge in the world to
         * buy nothing the report asked for. Noted as a deliberate divergence,
         * not an oversight.
         */
        let dir = null
        let layer = -1
        // Hoisted because the corner loop below needs the same lookup for the
        // HEIGHT, and asking the world four more times per cell for an answer
        // that cannot have changed is the kind of thing a mesher does 40,000
        // times a chunk.
        let cell = null
        if (owner[f]) {
          cell = world.fluidAt(vox[0] + ox, vox[1] + oy, vox[2] + oz)
          const run = cell ? FLOW_LAYER[cell.fluid] : -1
          if (cell && run >= 0) {
            if (ny > 0.5) {
              const [fx, , fz] = flowVector(world, vox[0] + ox, vox[1] + oy, vox[2] + oz)
              // Re-normalised in the horizontal plane alone: flowVector's unit
              // length includes the -6 downward term a falling column beside a
              // wall gets, and a texture on a flat top face has no use for it.
              const len = Math.hypot(fx, fz)
              if (len > 1e-6) { dir = [fx / len, fz / len]; layer = run }
            } else if (Math.abs(ny) < 0.5 && (cell.level > 0 || cell.falling)) {
              /*
               * A side face keeps the UVs the split already interpolated. The
               * flow sprite's streaks run vertically down the tile, which on a
               * vertical face is already the direction the water is going --
               * that is what makes a waterfall read as falling. Vanilla also
               * squeezes u into the tile's left half (getU(0)..getU(8)); that
               * is a detail of a 32px-wide sprite drawn at 16, and skipping it
               * costs a slightly wider streak and nothing else.
               */
              layer = run
            }
          }
          if (layer >= 0) flowFaces++
        }
        const corners = [[s0, t0], [s1, t0], [s1, t1], [s0, t1]]
        for (const [s, t] of corners) {
          const vx = p0[0] + du[0] * s + dv[0] * t
          let vy = p0[1] + du[1] * s + dv[1] * t
          const vz = p0[2] + du[2] * s + dv[2] * t
          if (cell && Math.round(vy + oy) === topY) {
            const hgt = cornerHeight(
              world, cell.fluid, Math.round(vx + ox), vox[1] + oy, Math.round(vz + oz))
            vy = vox[1] + hgt
          }
          outPos.push(vx, vy, vz)
          outNorm.push(nx, ny, nz)
          if (dir) {
            // Offset of this corner from the cell's centre, in world units.
            // The split guarantees one output quad per voxel, so these are
            // exactly +/-0.5 and the sample stays inside the tile.
            const [u, v] = flowUV(dir[0], dir[1], vx - vox[0] - 0.5, vz - vox[2] - 0.5)
            outUV.push(u, v)
          } else {
            bilinear(uv, f, 2, s, t, outUV)
          }
          bilinear(col, f, 4, s, t, outCol)
          /*
           * Interpolated from the parent's four corners, not resampled from
           * the light store -- the same treatment the colour above gets, and
           * for the same reason: blockLight already averaged the 2x2 of voxels
           * at each parent corner, and asking the store again per sub-corner
           * would be a second, differently-rounded answer to a question that
           * has already been answered.
           *
           * Sampled at the corner's PARAMETRIC position, which for a top face
           * is the corner before it is dropped to `cornerHeight`. The surface
           * moves down by at most 8/9 of a block and sky light does not decay
           * downward at all, so the value it would read after the drop is the
           * value it reads here. The alpha lane has always made the same
           * trade; this one is no worse.
           */
          if (outSky) bilinear(sky, f, 1, s, t, outSky)
          if (outAtlas) outAtlas.push(layer >= 0 ? layer : atlas[f * 4])
        }
        for (const i of pattern) outIdx.push(vcount + i)
        vcount += 4
      }

      if (!owner[f]) {
        // Copy the quad through untouched.
        emit(0, 0, 1, 1)
        continue
      }
      splitFaces++
      for (let a = 0; a < w; a++) {
        for (let b = 0; b < h; b++) emit(a / w, b / h, (a + 1) / w, (b + 1) / h)
      }
    }

    mesh.setVerticesData(VertexBuffer.PositionKind, new Float32Array(outPos), false, 3)
    mesh.setVerticesData(VertexBuffer.NormalKind, new Float32Array(outNorm), false, 3)
    mesh.setVerticesData(VertexBuffer.ColorKind, new Float32Array(outCol), false, 4)
    mesh.setVerticesData(VertexBuffer.UVKind, new Float32Array(outUV), false, 2)
    if (outAtlas) mesh.setVerticesData('texAtlasIndices', new Float32Array(outAtlas), false, 1)
    if (outSky) mesh.setVerticesData(SKY_ATTRIB, new Float32Array(outSky), false, 1)
    mesh.setIndices(outIdx)
  }

  /** Bilinear interpolation of a per-corner attribute, stride floats wide. */
  function bilinear(src, f, stride, s, t, out) {
    const base = f * 4 * stride
    for (let c = 0; c < stride; c++) {
      const a = src[base + c]
      const b = src[base + stride + c]
      const d = src[base + 2 * stride + c]
      const e = src[base + 3 * stride + c]
      // corners in noa's order: p0, p1 (=+du), p2 (=+du+dv), p3 (=+dv)
      out.push(a * (1 - s) * (1 - t) + b * s * (1 - t) + d * s * t + e * (1 - s) * t)
    }
  }

  function faceIsFluid(pos, norm, f, ox, oy, oz) {
    const o = f * 12
    // Centre of the quad, stepped half a block back along the normal.
    const cx = (pos[o] + pos[o + 6]) / 2 - norm[o] * 0.5
    const cy = (pos[o + 1] + pos[o + 7]) / 2 - norm[o + 1] * 0.5
    const cz = (pos[o + 2] + pos[o + 8]) / 2 - norm[o + 2] * 0.5
    return !!world.fluidAt(
      Math.floor(cx + ox), Math.floor(cy + oy), Math.floor(cz + oz))
  }

  return {
    /** ms spent splitting fluid quads on the last chunk meshed. */
    lastMeshMs: () => meshMs,
    /** merged quads split since install. Proof the pass ran at all. */
    splitFaces: () => splitFaces,
    /** cells redirected to a flow texture since install. Same job, for the
     *  directional half: a zero here means every fluid quad drew as still. */
    flowFaces: () => flowFaces,
    /** Which atlas layer a fluid's flow run lives on, or -1 if it has none.
     *  Specs read this to tell "the texture is missing" from "the texture is
     *  there and the quad did not pick it". */
    flowLayer: (fluid) => (fluid in FLOW_LAYER ? FLOW_LAYER[fluid] : -1),
    cornerHeightAt: (x, y, z) => {
      const m = world.fluidAt(x, y, z)
      return m ? cornerHeight(world, m.fluid, x, y, z) : 0
    },
  }
}
