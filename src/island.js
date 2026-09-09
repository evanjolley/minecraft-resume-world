/*
 * The island: a 48x48 plate (3x3 Minecraft-sized chunks) floating in void.
 *
 * This is deliberately a pure function of (x, y, z). noa asks for chunks in
 * whatever order its loader feels like, possibly re-asking for one it already
 * had, and possibly on a worker. Anything that accumulates state across those
 * calls goes wrong in ways that are miserable to debug. A pure lookup can be
 * called in any order, any number of times, and always agrees with itself.
 */

// Half-width of the island. Spans -24..23 on both axes = 48 blocks.
export const HALF = 24

// The y a player stands on. Top solid block is at y = -1.
export const SURFACE_Y = 0

// Where you appear, and where you get put back after falling off.
export const SPAWN = [0.5, SURFACE_Y + 2, 0.5]

// Fall past this and respawn fires.
export const VOID_Y = -80

// Depth of solid rock before the underside starts tapering to a point.
const STRAIGHT_DEPTH = 3

// How fast the underside pinches in per layer. Higher = pointier island.
const TAPER_RATE = 2

/**
 * @returns the block id at a world coordinate, or 0 for air/void.
 */
export function getVoxelID(x, y, z, ids) {
  if (y >= SURFACE_Y) return 0

  // depth 0 is the grass layer, growing downward
  const depth = SURFACE_Y - 1 - y

  // The underside pinches inward once past the straight section, which is
  // what makes it read as a floating island instead of a floating table.
  const inset = Math.max(0, (depth - STRAIGHT_DEPTH) * TAPER_RATE)
  const reach = HALF - inset
  if (reach <= 0) return 0

  // Square footprint via the max-norm. Road not taken: Euclidean distance
  // gives a round island, and value noise gives a ragged natural one. Square
  // won because resume plots are easier to lay out on a grid with hard edges.
  if (x < -reach || x >= reach) return 0
  if (z < -reach || z >= reach) return 0

  if (depth === 0) return ids.grass
  if (depth <= STRAIGHT_DEPTH) return ids.dirt
  return ids.stone
}
