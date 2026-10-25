/*
 * VANILLA'S TREES, transcribed rather than guessed.
 *
 * ------------------------------------------------------------------------
 * "The trees look bad." They did: every species was a log with one or two
 * fuzzy ellipsoids on top, which is no tree in Minecraft. Every shape below
 * is read off the 1.21 worldgen code -- the trunk placer and the foliage
 * placer each TreeFeatures entry configures -- and the comment on each one
 * names the classes and the numbers, so a reader can check it against the
 * game rather than against taste.
 *
 * WHAT IS THE SAME AS VANILLA:
 *   - trunk heights: base + nextInt(a + 1) + nextInt(b + 1), per placer;
 *   - foliage rows: each placer's createFoliage loop, its radius schedule
 *     and its shouldSkipLocation rule for the corners;
 *   - leaves only replace air (TreeFeature.validTreePos), logs replace air
 *     or leaves (isAirOrLeaves), which is what lets a forest's canopies
 *     interlock without one tree hollowing out the next;
 *   - the fancy oak's whole branch algorithm, treeShape and trimBranches.
 *
 * WHAT IS NOT:
 *   - Java's Random. Each tree draws from its own mulberry32 stream seeded
 *     by its position, so the SHAPES are vanilla's distributions and the
 *     particular trees are ours. Same world every load.
 *   - log axes. This palette has one log block per wood, not three, so a
 *     fancy oak's sideways branches are upright logs, as they would look
 *     from below in any case.
 *   - decorators: no bee nests, vines or cocoa.
 *   - the 2x2 mega jungle tree; the bamboo jungle has small jungle trees and
 *     jungle bushes, which is most of what you see under the bamboo anyway.
 * ------------------------------------------------------------------------
 * THE WRITER. `V` is the voxel writer from src/builds/land.js, in local
 * coordinates (y = 0 is the air above the plots). It refuses any write into
 * a chapter plot or onto the walk, which is the guarantee the old stamper's
 * `forbid` list gave: a tree near Omaha is clipped at the plot line rather
 * than planting a branch in the school.
 */
import { rng } from './noise.js'

/** A tree's random stream: the position, hashed. */
const streamAt = (x, y, z, salt) =>
  rng(Math.imul(x | 0, 0x2c1b3c6d) ^ Math.imul(z | 0, 0x297a2d39) ^ Math.imul((y | 0) + 7, 0x1b873593) ^ salt)

/** nextInt(n): [0, n). */
const int = (r, n) => Math.floor(r() * n)

/**
 * FoliagePlacer.placeLeavesRow: a square of side 2 * range + 1 (one wider for
 * a 2x2 trunk), less whatever the placer's skip rule says, at `y` above the
 * attachment. `skip(ax, y, az, range)` gets the ABSOLUTE offsets, which is
 * shouldSkipLocationSigned's job in vanilla.
 */
function leavesRow(V, cx, cy, cz, range, y, leaf, skip, double = false) {
  const k = double ? 1 : 0
  for (let dx = -range; dx <= range + k; dx++) {
    for (let dz = -range; dz <= range + k; dz++) {
      const ax = double ? Math.min(Math.abs(dx), Math.abs(dx - 1)) : Math.abs(dx)
      const az = double ? Math.min(Math.abs(dz), Math.abs(dz - 1)) : Math.abs(dz)
      if (skip(ax, y, az, range, dx, dz)) continue
      V.leaf(cx + dx, cy + y, cz + dz, leaf)
    }
  }
}

/** Logs from y to y + n - 1, each only where air or leaves is. */
function trunk(V, x, y, z, n, log) {
  for (let k = 0; k < n; k++) V.log(x, y + k, z, log)
}

/** Whether a straight trunk of n blocks has room, which is the check
 *  TreeFeature makes before it places anything at all. */
function room(V, x, y, z, n) {
  for (let k = 0; k < n; k++) if (!V.free(x, y + k, z)) return false
  return true
}

/*
 * BlobFoliagePlacer, as OAK, BIRCH and the small JUNGLE tree configure it:
 * radius 2, offset 0, height 3.
 *
 *   for (i = offset; i >= offset - height; --i) {
 *     j = max(radius + radiusOffset - 1 - i / 2, 0)      // Java int division
 *     placeLeavesRow(attachment, j, i)
 *   }
 *   shouldSkipLocation: x == range && z == range && (nextInt(2) == 0 || y == 0)
 *
 * The attachment is the block above the top log (StraightTrunkPlacer returns
 * pos.above(height)), so the rows are radius 1 at the top, 1, then 2 and 2,
 * and the top row always loses its corners: the plus-shaped crown.
 */
function blob(V, r, x, top, z, leaf) {
  const skip = (ax, y, az, range) => ax === range && az === range && (int(r, 2) === 0 || y === 0)
  for (let i = 0; i >= -3; i--) {
    const j = Math.max(2 - 1 - Math.trunc(i / 2), 0)
    leavesRow(V, x, top, z, j, i, leaf, skip)
  }
}

/** OAK: StraightTrunkPlacer(4, 2, 0) + Blob(2, 0, 3). 4 to 6 logs. */
export function oak(V, x, y, z, wood = 'oak') {
  const r = streamAt(x, y, z, 1)
  const h = 4 + int(r, 3)
  if (!room(V, x, y, z, h + 1)) return false
  trunk(V, x, y, z, h, `${wood}_log`)
  blob(V, r, x, y + h, z, `${wood}_leaves`)
  return true
}

/** BIRCH: StraightTrunkPlacer(5, 2, 0) + Blob(2, 0, 3). 5 to 7 logs. */
export function birch(V, x, y, z) {
  const r = streamAt(x, y, z, 2)
  const h = 5 + int(r, 3)
  if (!room(V, x, y, z, h + 1)) return false
  trunk(V, x, y, z, h, 'birch_log')
  blob(V, r, x, y + h, z, 'birch_leaves')
  return true
}

/** JUNGLE_TREE_NO_VINE: StraightTrunkPlacer(4, 8, 0) + Blob(2, 0, 3). 4 to
 *  12 logs: the tall bare trunk with a small crown. */
export function jungle(V, x, y, z) {
  const r = streamAt(x, y, z, 3)
  const h = 4 + int(r, 9)
  if (!room(V, x, y, z, h + 1)) return false
  trunk(V, x, y, z, h, 'jungle_log')
  blob(V, r, x, y + h, z, 'jungle_leaves')
  return true
}

/*
 * JUNGLE_BUSH: StraightTrunkPlacer(1, 0, 0), jungle log, OAK leaves, and
 * BushFoliagePlacer(2, 1, 2):
 *
 *   for (i = offset; i >= offset - height; --i) {
 *     j = radius + radiusOffset - 1 - i
 *     placeLeavesRow(attachment, j, i)
 *   }
 *   shouldSkipLocation: x == range && z == range && nextInt(2) == 0
 *
 * One log, and a three-layer mound of leaves round it from the ground up.
 */
export function jungleBush(V, x, y, z) {
  const r = streamAt(x, y, z, 4)
  if (!room(V, x, y, z, 1)) return false
  V.log(x, y, z, 'jungle_log')
  const skip = (ax, yy, az, range) => ax === range && az === range && int(r, 2) === 0
  for (let i = 1; i >= -1; i--) leavesRow(V, x, y + 1, z, 2 - 1 - i, i, 'oak_leaves', skip)
  return true
}

/*
 * SPRUCE: StraightTrunkPlacer(5, 2, 1) + SpruceFoliagePlacer(radius 2..3,
 * offset 0..2, trunkHeight 1..2).
 *
 *   foliageHeight = max(4, height - trunkHeight)
 *   i = nextInt(2); j = 1; k = 0
 *   for (l = offset; l >= -foliageHeight; --l) {
 *     placeLeavesRow(attachment, i, l)
 *     if (i >= j) { i = k; k = 1; j = min(j + 1, radius) } else ++i
 *   }
 *   shouldSkipLocation: x == range && z == range && range > 0
 *
 * The radius schedule is what draws the tiers: 0 1 / 0 1 2 / 1 2 3 ..., each
 * ring wider than the last, so the tree is a stack of widening collars on a
 * bare spike.
 */
export function spruce(V, x, y, z) {
  const r = streamAt(x, y, z, 5)
  const h = 5 + int(r, 3) + int(r, 2)
  if (!room(V, x, y, z, h + 1)) return false
  trunk(V, x, y, z, h, 'spruce_log')
  const radius = 2 + int(r, 2)
  const offset = int(r, 3)
  const trunkH = 1 + int(r, 2)
  const fh = Math.max(4, h - trunkH)
  const skip = (ax, yy, az, range) => ax === range && az === range && range > 0
  let i = int(r, 2), j = 1, k = 0
  for (let l = offset; l >= -fh; l--) {
    leavesRow(V, x, y + h, z, i, l, 'spruce_leaves', skip)
    if (i >= j) { i = k; k = 1; j = Math.min(j + 1, radius) } else i++
  }
  return true
}

/*
 * PINE: StraightTrunkPlacer(6, 4, 0) + PineFoliagePlacer(radius 1, offset 1,
 * height 3..4).
 *
 *   foliageRadius = radius + nextInt(max(treeHeight - foliageHeight, 1))
 *   i = 0
 *   for (j = offset; j >= offset - foliageHeight; --j) {
 *     placeLeavesRow(attachment, i, j)
 *     if (i >= 1 && j == offset - foliageHeight + 1) --i
 *     else if (i < foliageRadius) ++i
 *   }
 *
 * A tall bare pole with a short cone on top: the taiga's other tree.
 */
export function pine(V, x, y, z) {
  const r = streamAt(x, y, z, 6)
  const h = 6 + int(r, 5)
  if (!room(V, x, y, z, h + 1)) return false
  trunk(V, x, y, z, h, 'spruce_log')
  const fh = 3 + int(r, 2)
  const radius = 1 + int(r, Math.max(h - fh, 1))
  const offset = 1
  const skip = (ax, yy, az, range) => ax === range && az === range && range > 0
  let i = 0
  for (let j = offset; j >= offset - fh; j--) {
    leavesRow(V, x, y + h, z, i, j, 'spruce_leaves', skip)
    if (i >= 1 && j === offset - fh + 1) i--
    else if (i < radius) i++
  }
  return true
}

/*
 * FANCY_OAK: FancyTrunkPlacer(3, 11, 0) + FancyFoliagePlacer(2, 4, 4).
 *
 * The big oak with branches, and the one tree whose shape is an algorithm
 * rather than a table. FancyTrunkPlacer.placeTrunk, in order:
 *
 *   i  = height + 2                        the tree's working height
 *   j  = floor(i * 0.618)                  where the trunk stops
 *   l  = y + j                             the highest a branch may start
 *   coords = [ (top cluster at y + i - 5, branch base l) ]
 *   for (i1 = i - 5; i1 >= 0; --i1) {
 *     f = treeShape(i, i1)                 the crown's profile at this level
 *     if (f >= 0) {                        one branch per level here (k = 1)
 *       d2 = f * (nextFloat() + 0.328)     its reach
 *       d3 = nextFloat() * 2 PI            its bearing
 *       end = pos + (d2 sin d3 + .5, i1 - 1, d2 cos d3 + .5)
 *       if the 5 blocks above `end` are free:
 *         base y = min(l, end.y - horizontal distance * 0.381)
 *         if the line from (pos.x, base, pos.z) to `end` is free:
 *           coords.add(end, base)
 *     }
 *   }
 *   makeLimb(pos, pos + j)                 the trunk
 *   makeBranches: a limb from each branch base to its end, if
 *     trimBranches(i, base - y), i.e. base is above 20% of the height
 *   foliage at every end whose base passes the same trim
 *
 *   treeShape(h, y): y < 0.3h ? -1 : (f = h/2, f1 = f - y,
 *     f1 == 0 ? f : |f1| >= f ? 0 : sqrt(f^2 - f1^2)) * 0.5
 *
 * FancyFoliagePlacer: rows from 4 above the branch end down to it, radius 2
 * at the top and bottom row and 3 between, and a ROUND skip rule --
 * (x + 0.5)^2 + (z + 0.5)^2 > range^2 -- so each cluster is a ball.
 */
function treeShape(height, y) {
  if (y < height * 0.3) return -1
  const f = height / 2
  const f1 = f - y
  let f2 = Math.sqrt(f * f - f1 * f1)
  if (f1 === 0) f2 = f
  else if (Math.abs(f1) >= f) return 0
  return f2 * 0.5
}

/** FancyTrunkPlacer.makeLimb: a straight run of blocks between two points,
 *  stepping along the longest axis. `place` false means only check room. */
function limb(V, a, b, place, log) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2]
  const n = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz))
  if (n === 0) {
    if (place) V.log(a[0], a[1], a[2], log)
    return place || V.free(a[0], a[1], a[2])
  }
  for (let j = 0; j <= n; j++) {
    const x = Math.floor(a[0] + 0.5 + j * dx / n)
    const y = Math.floor(a[1] + 0.5 + j * dy / n)
    const z = Math.floor(a[2] + 0.5 + j * dz / n)
    if (place) V.log(x, y, z, log)
    else if (!V.free(x, y, z)) return false
  }
  return true
}

export function fancyOak(V, x, y, z) {
  const r = streamAt(x, y, z, 7)
  const height = 3 + int(r, 12)
  const i = height + 2
  const j = Math.floor(i * 0.618)
  const l = y + j
  if (!room(V, x, y, z, j + 1)) return false
  const log = 'oak_log'
  const coords = [{ end: [x, y + i - 5, z], base: l }]
  for (let i1 = i - 5; i1 >= 0; i1--) {
    const f = treeShape(i, i1)
    if (f < 0) continue
    const d2 = f * (r() + 0.328)
    const d3 = r() * 2 * Math.PI
    const end = [
      Math.floor(x + d2 * Math.sin(d3) + 0.5),
      y + i1 - 1,
      Math.floor(z + d2 * Math.cos(d3) + 0.5),
    ]
    if (!limb(V, end, [end[0], end[1] + 5, end[2]], false, log)) continue
    const k1 = x - end[0], l1 = z - end[2]
    const d6 = end[1] - Math.sqrt(k1 * k1 + l1 * l1) * 0.381
    const base = d6 > l ? l : Math.trunc(d6)
    if (limb(V, [x, base, z], end, false, log)) coords.push({ end, base })
  }
  limb(V, [x, y, z], [x, y + j, z], true, log)
  const trim = (base) => base - y >= i * 0.2
  for (const c of coords) {
    if (c.base === c.end[1] && c.end[0] === x && c.end[2] === z) continue
    if (trim(c.base)) limb(V, [x, c.base, z], c.end, true, log)
  }
  const skip = (ax, yy, az, range) => (ax + 0.5) ** 2 + (az + 0.5) ** 2 > range * range
  for (const c of coords) {
    if (!trim(c.base)) continue
    for (let yy = 4; yy >= 0; yy--) {
      const rad = 2 + (yy !== 4 && yy !== 0 ? 1 : 0)
      leavesRow(V, c.end[0], c.end[1], c.end[2], rad, yy, 'oak_leaves', skip)
    }
  }
  return true
}

/*
 * DARK_OAK: DarkOakTrunkPlacer(6, 2, 1) + DarkOakFoliagePlacer(0, 0).
 *
 * A 2x2 trunk that may lean one way partway up, short stub branches round
 * its top, and a broad flat canopy. DarkOakTrunkPlacer.placeTrunk:
 *
 *   dir = random horizontal; bendAt = height - nextInt(4); bend = 2 - nextInt(3)
 *   for (i2 = 0; i2 < height; ++i2) {
 *     if (i2 >= bendAt && bend > 0) { step one block along dir; --bend }
 *     place the 2x2 at the (possibly moved) column, y + i2
 *   }
 *   main attachment: the trunk top, DOUBLE
 *   for l2, i3 in -1..2 (outside the 2x2), 1 in 3:
 *     a stub of nextInt(3) + 2 logs hanging down from the top, at the
 *     ORIGINAL column + (l2, i3), and a single attachment over it
 *
 * DarkOakFoliagePlacer, double: rows of radius 2, 3, 2 at y -1, 0, 1 and,
 * half the time, radius 0 at y 2; the y 0 row drops its four outer corners
 * and the y 1 row anything with x + z > 2 * range - 2. Single: radius 2 at
 * y -1 (corners dropped) and radius 1 at y 0.
 */
export function darkOak(V, x, y, z) {
  const r = streamAt(x, y, z, 8)
  const h = 6 + int(r, 3) + int(r, 2)
  for (const [ox, oz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    if (!V.ground(x + ox, z + oz, y)) return false
    if (!room(V, x + ox, y, z + oz, 2)) return false
  }
  const dirs = [[0, -1], [0, 1], [1, 0], [-1, 0]]
  const [sx, sz] = dirs[int(r, 4)]
  const bendAt = h - int(r, 4)
  let bend = 2 - int(r, 3)
  let jx = x, jz = z
  for (let i2 = 0; i2 < h; i2++) {
    if (i2 >= bendAt && bend > 0) { jx += sx; jz += sz; bend-- }
    for (const [ox, oz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) V.log(jx + ox, y + i2, jz + oz, 'dark_oak_log')
  }
  const top = y + h - 1
  const attachments = [{ x: jx, z: jz, double: true }]
  for (let l2 = -1; l2 <= 2; l2++) {
    for (let i3 = -1; i3 <= 2; i3++) {
      if (l2 >= 0 && l2 <= 1 && i3 >= 0 && i3 <= 1) continue
      if (int(r, 3) > 0) continue
      const n = int(r, 3) + 2
      for (let k2 = 0; k2 < n; k2++) V.log(x + l2, top - k2 - 1, z + i3, 'dark_oak_log')
      attachments.push({ x: jx + l2, z: jz + i3, double: false })
    }
  }
  const leaf = 'dark_oak_leaves'
  for (const a of attachments) {
    if (a.double) {
      const skipD = (ax, yy, az, range, dx, dz) => {
        if (yy === 0 && (dx === -range || dx >= range) && (dz === -range || dz >= range)) return true
        if (yy === 1) return ax + az > range * 2 - 2
        return false
      }
      leavesRow(V, a.x, top, a.z, 2, -1, leaf, skipD, true)
      leavesRow(V, a.x, top, a.z, 3, 0, leaf, skipD, true)
      leavesRow(V, a.x, top, a.z, 2, 1, leaf, skipD, true)
      if (r() < 0.5) leavesRow(V, a.x, top, a.z, 0, 2, leaf, skipD, true)
    } else {
      const skipS = (ax, yy, az, range) => (yy === -1 ? ax === range && az === range : false)
      leavesRow(V, a.x, top, a.z, 2, -1, leaf, skipS)
      leavesRow(V, a.x, top, a.z, 1, 0, leaf, skipS)
    }
  }
  return true
}

/*
 * HUGE MUSHROOMS, the dark forest's other canopy. HugeMushroomFeature:
 * a stem of nextInt(3) + 4 blocks (doubled one time in twelve), and
 *
 *   brown (HugeBrownMushroomFeature): ONE flat layer at the top, radius 3,
 *     corners cut, so it reads as a table;
 *   red (HugeRedMushroomFeature): a dome, radius 2 down the sides for the
 *     three layers under the top and radius 1 on the top, the side layers
 *     losing their corners.
 */
export function hugeMushroom(V, x, y, z, red) {
  const r = streamAt(x, y, z, 9)
  let h = int(r, 3) + 4
  if (int(r, 12) === 0) h *= 2
  if (!room(V, x, y, z, h + 1)) return false
  for (let k = 0; k < h; k++) V.log(x, y + k, z, 'mushroom_stem')
  if (!red) {
    const R = 3
    for (let dx = -R; dx <= R; dx++) {
      for (let dz = -R; dz <= R; dz++) {
        if (Math.abs(dx) === R && Math.abs(dz) === R) continue
        V.leaf(x + dx, y + h, z + dz, 'brown_mushroom_block')
      }
    }
  } else {
    for (let yy = h - 3; yy <= h; yy++) {
      const R = yy < h ? 2 : 1
      const ring = yy < h
      for (let dx = -R; dx <= R; dx++) {
        for (let dz = -R; dz <= R; dz++) {
          const edgeX = Math.abs(dx) === R, edgeZ = Math.abs(dz) === R
          if (ring && edgeX && edgeZ) continue
          if (ring && !edgeX && !edgeZ) continue        // hollow under the cap
          V.leaf(x + dx, y + yy, z + dz, 'red_mushroom_block')
        }
      }
    }
  }
  return true
}

/** Every tree by name, for the placement table in src/builds/flora.js. */
export const TREES = {
  oak, birch, jungle, jungleBush, spruce, pine, fancyOak, darkOak,
  brownMushroom: (V, x, y, z) => hugeMushroom(V, x, y, z, false),
  redMushroom: (V, x, y, z) => hugeMushroom(V, x, y, z, true),
}

/** How far a species' leaves can reach from its trunk, in blocks: what the
 *  placement checks against the path and the plots. */
export const REACH = {
  oak: 2, birch: 2, jungle: 2, jungleBush: 2, spruce: 3, pine: 3,
  fancyOak: 6, darkOak: 5, brownMushroom: 3, redMushroom: 2,
}
