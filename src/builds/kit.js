/*
 * SMALL PIECES SHARED BY CHAPTERS 4 AND 5: a labelled wall sign, a switchback
 * stair for a building with several floors, and a street tree.
 *
 * Kept tiny and data-free on purpose. Each is the same few lines both
 * buildings would otherwise carry a copy of, and the stair in particular is
 * the kind of thing that is right once and wrong forever if it is copied and
 * one copy gets fixed.
 */
import { setSignText } from '../signText.js'

/**
 * A wall sign, placed and labelled from one set of numbers.
 *
 * `facing` is the way the TEXT faces -- a sign on the north side of a wall
 * faces 'north' -- and in this engine 'west' is +x and 'east' is -x
 * (blockMeshes.js FACINGS). The block it hangs on is on the opposite side
 * and must be solid; setSignText derives its own handedness, so the words
 * are never mirrored.
 */
export function wallSign(s, x, y, z, facing, lines) {
  s.set(x, y, z, `oak_wall_sign_${facing}`)
  setSignText(...s.toWorld(x, y, z), lines)
}

/**
 * A switchback stair up through `floors` floors of `floorH` blocks each, in
 * two lanes (x = lanes.a and x = lanes.b) starting at z0, from standing
 * height `y0`.
 *
 * Each floor's run is `floorH` full blocks rising one apiece, along z, in
 * alternate lanes -- lane a climbing +z, lane b climbing -z -- through a
 * hole cut in the slab it climbs to. The top step of each run IS a block of
 * that slab, so you step off it onto the floor above, and the next run
 * starts beside you. Full blocks, not stair keys: a staircase you cannot
 * climb is worse than a blocky one (docs/builds/README.md).
 *
 * floorH 4 (three blocks of air a floor) or 5 (four); below 4 a player's
 * head meets the slab on the way up.
 */
export function switchback(s, { a, b, z0 }, floors, floorH, block, { rail, light } = {}, y0 = 0) {
  if (floorH < 4) throw new Error(`switchback: a ${floorH}-block floor has no headroom`)
  const n = floorH
  const z1 = z0 + n - 1
  for (let f = 0; f < floors; f++) {
    const base = y0 + f * floorH                // standing height on floor f
    const slab = base + floorH - 1              // the slab this run climbs through
    if (f % 2 === 0) {
      for (let i = 0; i < n; i++) s.set(a, base + i, z0 + i, block)
      s.clear([a, slab, z0], [a, slab, z1 - 1])
    } else {
      for (let i = 0; i < n; i++) s.set(b, base + i, z1 - i, block)
      s.clear([b, slab, z0 + 1], [b, slab, z1])
    }
    // A rail on the floor beside the hole the run below came up through.
    if (rail && f > 0) {
      const hole = f % 2 === 1 ? a : b
      const rx = hole === a ? a - (b > a ? 1 : -1) : b + (b > a ? 1 : -1)
      s.box([rx, base, z0], [rx, base, z1], rail)
    }
    if (light) s.set(b + (b > a ? 1 : -1), slab, z0 + 2, light)
  }
}

/** A small street tree: a four-high trunk and a rounded crown. Needs two
 *  blocks of room on every side at y = 4. */
export function tree(s, x, z, { log = 'oak_log', leaves = 'oak_leaves' } = {}) {
  s.pillar(x, z, 0, 3, log)
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      s.set(x + dx, 4, z + dz, leaves)
      if (Math.abs(dx) + Math.abs(dz) < 2) s.set(x + dx, 5, z + dz, leaves)
    }
  }
  for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) s.set(x + dx, 4, z + dz, leaves)
}
