/*
 * THE CENTRELINE, and the one decision this whole landscape rests on.
 *
 * ------------------------------------------------------------------------
 * WHY IT IS A LIST OF PLACES AND NOT A FUNCTION OF z.
 *
 * The obvious way to make a path wind is `x = 128 + 30 * sin(z / 20)`. It is
 * one line, it never self-intersects, and it is WRONG for the reason the
 * brief names before anything else: "a path that snakes at a constant
 * frequency reads as a wave, not a walk." A sine has one amplitude and one
 * period, so every bend has the same radius, every straight is the same
 * length, and a visitor learns the rule in about forty blocks. After that the
 * world is a graph of a function they are walking along.
 *
 * Adding a second sine does not fix it, it postpones it -- the sum of two
 * periodic things is a periodic thing with a longer period, and the eye is
 * extremely good at that. What actually breaks the pattern is the path having
 * REASONS: it swings west here because Omaha is west, it comes back slowly
 * because there is nothing to come back for, it kinks hard at the river
 * because that is where the bank is low enough to cross.
 *
 * So the spine is twenty-three hand-placed control points, and a Catmull-Rom
 * spline through them. Each one is a decision somebody made, the curve radius
 * between them varies because the spacing and the turn angle vary, and the
 * only way to change the path is to move a place -- which is the right unit
 * of change for a path.
 *
 * WHAT THE POINTS ARE DOING, so that moving one is not guesswork:
 *
 *   - Each chapter gets a swing TOWARD it, which is what makes the spur short
 *     and what makes the path read as going somewhere. The swing peaks
 *     deliberately EARLY or LATE against the plot's midpoint (never on it) --
 *     seven swings all peaking exactly opposite their plot is a rule the eye
 *     finds even when the amplitudes differ.
 *   - The amplitudes differ on purpose: the west swings reach x = 102, 106,
 *     108 and 114; the east swings reach 154, 158 and 152. No two bends are
 *     the same size.
 *   - The spacing differs on purpose: 10 to 14 blocks. A constant spacing
 *     with varying amplitude is still a rhythm.
 *   - The first two points are STRAIGHT and level. You arrive facing down a
 *     path, not into a bend, and the spawn clearing has to stay flat for the
 *     test rigs (see SPAWN_FLAT in land.js).
 *   - `h` is the height in blocks above the grass, and it is the other half
 *     of "it rises and falls". It runs -1 to +1 and it changes on a different
 *     schedule from the bends, so the path does not conveniently crest on
 *     every corner.
 *
 *     IT RAN TO +2 AND THAT WAS TOO MUCH. A column is either at a height or
 *     it is not -- there are no half blocks -- so a two-block rise with a
 *     four-block feather is two visible terraces with a dirt cliff between
 *     them, and at eye level you are walking in a trench with a wall beside
 *     you. One block, feathered over six, is a rise you notice underfoot and
 *     do not see the edges of.
 * ------------------------------------------------------------------------
 * CATMULL-ROM, specifically, and not a Bezier or a linear run.
 *
 * Catmull-Rom passes THROUGH its control points, which means the table below
 * says where the path actually goes. A Bezier's handles do not lie on the
 * curve, so the table would be a set of hints and "move the path four blocks
 * west here" would be an experiment instead of an edit. Linear would give a
 * polyline with visible corners, which is the one thing worse than a sine.
 */

/** [patch x, patch z, height above the grass]. North (-z) is behind you; the
 *  visitor walks south, so this list is in walking order. */
export const SPINE = [
  [128, 2, 0],    // off the top of the map, so the curve starts straight
  [128, 16, 0],   // SPAWN. Flat and dead ahead.
  [126, 28, 0],
  [116, 36, 0],
  [104, 44, 1],   // west, for Omaha (plot midpoint z=33) -- peaks LATE
  [108, 56, 1],
  [130, 64, 0],
  [152, 72, -1],  // east, for Harvard (z=65) -- peaks late, and drops
  [154, 84, 0],
  [138, 92, 1],
  [114, 98, 1],
  [106, 108, 1],  // west, for the school years (z=97) -- peaks late, highest
  [116, 118, 1],
  [140, 126, 0],
  [158, 134, 0],  // east, for Bilibili (z=129) -- the biggest swing
  [150, 146, 0],
  [142, 156, 1],  // THE BRIDGE. Nearly straight across the water.
  [138, 166, 0],
  [120, 176, 1],
  [110, 186, 1],  // west, for New York (z=183) -- peaks late and stays west
  [124, 198, 1],
  [148, 208, 1],
  [152, 220, 1],  // east, for San Francisco (z=215) -- peaks late, high
  [132, 232, 1],
  [114, 242, 0],  // west, for the climb (z=241)
  [110, 254, 0],
]

/**
 * Walk the spline and hand back a dense list of points along it.
 *
 * @returns [{ x, z, h, nx, nz }] where (nx, nz) is the unit NORMAL -- the
 *          direction "sideways off the path", which is what the width, the
 *          ragged edge, the lamp posts and the spurs are all measured along.
 *
 * STEP SIZE 0.25 rather than 1. The raster rounds to columns, so a step of 1
 * along a curve that is also moving sideways leaves diagonal pinholes in the
 * path -- single grass blocks in the middle of the surface, in a line, which
 * reads as damage rather than as texture. Oversampling and letting the Set of
 * columns dedupe is four times the arithmetic and none of the holes.
 */
export function sampleSpine(points, step = 0.25) {
  const out = []
  const P = (i) => points[Math.max(0, Math.min(points.length - 1, i))]
  for (let seg = 0; seg < points.length - 1; seg++) {
    const p0 = P(seg - 1), p1 = P(seg), p2 = P(seg + 1), p3 = P(seg + 2)
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1])
    const n = Math.max(2, Math.ceil(len / step))
    for (let k = 0; k < n; k++) {
      const t = k / n
      const [x, z, h] = catmull(p0, p1, p2, p3, t)
      // The tangent by finite difference rather than by the derivative: it is
      // two more evaluations and it cannot disagree with the points the
      // raster actually uses, which a hand-differentiated basis can.
      const e = 0.01
      const [ax, az] = catmull(p0, p1, p2, p3, Math.max(0, t - e))
      const [bx, bz] = catmull(p0, p1, p2, p3, Math.min(1, t + e))
      const tx = bx - ax, tz = bz - az
      const m = Math.hypot(tx, tz) || 1
      out.push({ x, z, h, nx: -tz / m, nz: tx / m })
    }
  }
  return out
}

/** The standard uniform Catmull-Rom basis, run on all three components at
 *  once so the height curves as smoothly as the ground plan does. */
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t
  const f = (a, b, c, d) => 0.5 * (
    (2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]), f(p0[2], p1[2], p2[2], p3[2])]
}
