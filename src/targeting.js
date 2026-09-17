/*
 * Sub-voxel block targeting: the crosshair has to hit the SHAPE, not the cell.
 *
 * THE BUG THIS FILE EXISTS FOR. noa's picker is `fast-voxel-raycast`, which
 * walks voxels and asks one question per voxel -- `blockTestFunction(id)`,
 * a boolean. There is no seam in it for "yes that id is targetable, but the
 * ray went over the top of it", so a bottom slab is targetable anywhere in
 * its 1x1x1 cell: you could aim at the empty air above one and break it, and
 * you could mine a torch by clicking a foot to the left of the torch.
 *
 * Collision was already right -- blockMeshes.js has had the real per-block
 * boxes since non-cube blocks landed and the physics resolver reads them.
 * Only targeting was still voxel-granular. That asymmetry is the whole bug,
 * and the fix is to make both halves read the same table.
 *
 * WHAT VANILLA DOES (1.21.x `BlockGetter.clip` -> `BlockGetter.traverseBlocks`
 * -> `VoxelShape.clip`): the traversal visits each voxel along the ray, asks
 * the block for its interaction shape, and clips the ray against that shape's
 * boxes. A MISS INSIDE A CELL IS NOT A MISS -- `traverseBlocks` keeps stepping
 * and the ray carries on to whatever is behind. The `BlockHitResult` it
 * finally builds carries the direction of the SHAPE face that was struck.
 * That is the behaviour reproduced below.
 *
 * THE SEAM. Everything targeting-shaped in noa funnels through one internal
 * method, `noa._localPick`: the per-frame `updateBlockTargets` calls it, and
 * the public `noa.pick()` calls it. Replacing that one function fixes the
 * crosshair, the highlight, mining, placement and the debug screen at once.
 *
 * Rejected: calling `noa.pick()` in a loop, re-picking from just past each
 * rejected hit. It is less code and it is wrong in two ways -- every re-pick
 * restarts the voxel walk from scratch (quadratic in the number of non-cubes
 * you are looking through), and it can only ever return noa's CELL-face
 * normal, so placing a torch on the side of a slab would still resolve its
 * facing from the wrong face. The normal is not a detail here; it is what
 * `installPlacementOrientation` and `installAttachment` both read.
 *
 * Rejected: patching `fast-voxel-raycast` itself, or vendoring it. Its own
 * traversal is what we want; what it cannot do is report a hit point that is
 * not on a cell boundary. Marching here is thirty lines and owns the whole
 * answer.
 */

/**
 * Slop used when pinning a hit point inside its own cell. Small enough to be
 * invisible to `halfFromTarget`'s above-or-below-the-midpoint test, large
 * enough to survive the float error in a hit computed as pos + dir * t.
 */
const EPS = 1e-4

/**
 * Clip a ray against one axis-aligned box: the slab method.
 *
 * Returns false on a miss. On a hit, `out.t` is the distance along `dir` at
 * which the ray enters the box and `out.axis`/`out.sign` name the face it
 * entered through (`axis` -1 meaning the ray started INSIDE the box, which
 * has no entry face and so no normal).
 *
 * @param {number[]} origin ray start
 * @param {number[]} dir unit direction
 * @param {number[]} lo box min, absolute
 * @param {number[]} hi box max, absolute
 * @param {number} maxT how far along the ray still counts
 * @param {{t:number, axis:number, sign:number}} out written in place
 */
function clipBox(origin, dir, lo, hi, maxT, out) {
  let tmin = 0, tmax = maxT
  let axis = -1, sign = 0

  for (let i = 0; i < 3; i++) {
    const d = dir[i]
    // Parallel to this pair of planes: either always between them or never.
    if (d > -1e-12 && d < 1e-12) {
      if (origin[i] < lo[i] || origin[i] > hi[i]) return false
      continue
    }
    const inv = 1 / d
    let near = (lo[i] - origin[i]) * inv
    let far = (hi[i] - origin[i]) * inv
    // Entering through the low face means the outward normal points -axis;
    // if the ray runs backwards along this axis the two swap, and so does it.
    let s = -1
    if (near > far) { const t = near; near = far; far = t; s = 1 }
    if (near > tmin) { tmin = near; axis = i; sign = s }
    if (far < tmax) tmax = far
    if (tmin > tmax) return false
  }

  out.t = tmin
  out.axis = axis
  out.sign = sign
  return true
}

/**
 * Replace noa's voxel picker with one that tests each candidate voxel's real
 * shape boxes and keeps marching when the ray misses them.
 *
 * @param {*} noa
 * @param {(id:number) => number[][] | undefined} boxesFor block id -> the
 *        boxes it is TARGETED as, in block-local 0..1 coords, or undefined
 *        for anything that fills its cell.
 */
export function installShapeTargeting(noa, boxesFor) {
  // Scratch, reused every frame. A picker that allocates runs 60 times a
  // second forever.
  const origin = [0, 0, 0]
  const dir = [0, 0, 0]
  const lo = [0, 0, 0]
  const hi = [0, 0, 0]
  const cell = [0, 0, 0]
  const clip = { t: 0, axis: -1, sign: 0 }

  noa._localPick = (pos = null, dirIn = null, dist = -1, blockTestFunction = null) => {
    if (dist === 0) return null
    const testFn = blockTestFunction || noa.registry.getBlockSolidity
    const src = pos || noa.camera._localGetTargetPosition()
    const raw = dirIn || noa.camera.getDirection()
    if (!dist || dist < 0) dist = noa.blockTestDistance

    const len = Math.hypot(raw[0], raw[1], raw[2])
    if (!len) return null
    for (let i = 0; i < 3; i++) {
      origin[i] = src[i]
      dir[i] = raw[i] / len
    }

    /*
     * Amanatides & Woo, the same traversal fast-voxel-raycast runs. `tMax[i]`
     * is the distance at which the ray crosses the next cell boundary on axis
     * i, `tDelta[i]` the distance between successive crossings; stepping the
     * smallest tMax each time visits cells in strict order of entry distance.
     *
     * A zero component gets Infinity for both, which is the correct answer --
     * a ray that never moves along an axis never crosses a boundary on it --
     * and it falls out of the arithmetic rather than needing a branch.
     */
    let vx = Math.floor(origin[0]), vy = Math.floor(origin[1]), vz = Math.floor(origin[2])
    const stepX = Math.sign(dir[0]), stepY = Math.sign(dir[1]), stepZ = Math.sign(dir[2])
    const tDeltaX = Math.abs(1 / dir[0]), tDeltaY = Math.abs(1 / dir[1]), tDeltaZ = Math.abs(1 / dir[2])
    let tMaxX = boundary(origin[0], vx, dir[0])
    let tMaxY = boundary(origin[1], vy, dir[1])
    let tMaxZ = boundary(origin[2], vz, dir[2])

    const off = noa.worldOriginOffset
    const world = noa.world

    let tEntry = 0
    // The cell face the ray came in through, which IS the hit for a full
    // cube. -1 for the cell the ray starts in: it has no entry face.
    let entryAxis = -1, entrySign = 0

    let bestT = Infinity, bestAxis = -1, bestSign = 0
    let found = false

    while (tEntry <= dist) {
      /*
       * SUBTLE, and the reason this does not simply `break` on the first hit:
       * a shape box may stick OUT of its own cell -- a wall torch's box
       * straddles the wall it hangs on -- so a box in a cell entered later
       * can be struck earlier than one in a cell entered sooner. Carrying the
       * best hit and stopping only once the next cell begins beyond it costs
       * at most one extra cell and makes the answer order-exact.
       */
      if (found && tEntry > bestT) break

      const id = world.getBlockID(vx + off[0], vy + off[1], vz + off[2])
      if (testFn(id)) {
        const boxes = boxesFor(id)
        if (!boxes) {
          // Fills its cell: the cell face the ray entered through is the hit.
          if (tEntry < bestT) {
            bestT = tEntry; bestAxis = entryAxis; bestSign = entrySign
            cell[0] = vx; cell[1] = vy; cell[2] = vz
            found = true
          }
        } else {
          for (const b of boxes) {
            lo[0] = vx + b[0]; lo[1] = vy + b[1]; lo[2] = vz + b[2]
            hi[0] = vx + b[3]; hi[1] = vy + b[4]; hi[2] = vz + b[5]
            if (!clipBox(origin, dir, lo, hi, dist, clip)) continue
            if (clip.t >= bestT) continue
            bestT = clip.t; bestAxis = clip.axis; bestSign = clip.sign
            cell[0] = vx; cell[1] = vy; cell[2] = vz
            found = true
          }
        }
      }

      // Step into the cell whose boundary comes next.
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        vx += stepX; tEntry = tMaxX; tMaxX += tDeltaX
        entryAxis = 0; entrySign = -stepX
      } else if (tMaxY < tMaxZ) {
        vy += stepY; tEntry = tMaxY; tMaxY += tDeltaY
        entryAxis = 1; entrySign = -stepY
      } else {
        vz += stepZ; tEntry = tMaxZ; tMaxZ += tDeltaZ
        entryAxis = 2; entrySign = -stepZ
      }
    }

    if (!found) return null

    const result = noa._pickResult
    const rpos = result._localPosition
    const rnorm = result.normal
    rnorm[0] = 0; rnorm[1] = 0; rnorm[2] = 0
    if (bestAxis >= 0) rnorm[bestAxis] = bestSign

    /*
     * THE HANDOFF, and the fiddliest twenty lines here.
     *
     * noa's `updateBlockTargets` does not take our word for which cell was
     * hit. It floors `result.position` to get `adjacent`, then subtracts the
     * normal to get `position`. That arithmetic is exactly right for a cube,
     * whose hit point sits on a cell boundary and only needs nudging off it
     * -- and exactly wrong for a shape, whose hit point is somewhere in the
     * middle of its own cell. Handing back the raw hit point on a slab's top
     * face would floor into the SLAB's cell, so `adjacent` would be the slab
     * and `position` the block underneath it.
     *
     * So the point handed back is the hit point with the struck axis pushed
     * to the centre of the neighbouring cell: floors to cell + normal, which
     * is the adjacent cell a placement goes into, and cell + normal - normal
     * is the block itself.
     *
     * The other two axes keep the true sub-voxel hit, CLAMPED into the cell.
     * Both halves of that matter. The precision is what
     * `installPlacementOrientation` reads out of `_pickResult.position` to
     * decide whether you clicked the top or bottom half of a slab's side, and
     * it is only meaningful because it survives this function. The clamp is
     * for the boxes that stick out of their cell: without it a hit on the
     * overhanging lip of a wall torch floors into the cell next door and
     * targets the wrong block.
     */
    for (let i = 0; i < 3; i++) {
      const p = origin[i] + dir[i] * bestT
      rpos[i] = Math.min(Math.max(p, cell[i] + EPS), cell[i] + 1 - EPS)
    }
    if (bestAxis >= 0) rpos[bestAxis] = cell[bestAxis] + bestSign + 0.5

    noa.localToGlobal(rpos, result.position)
    return result
  }
}

/** Distance along the ray to the first cell boundary crossed on one axis. */
function boundary(p, v, d) {
  if (d > 0) return (v + 1 - p) / d
  if (d < 0) return (p - v) / -d
  return Infinity
}
