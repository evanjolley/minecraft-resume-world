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
 * So the spine is thirty hand-placed control points, and a Catmull-Rom
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
 *   - The amplitudes differ on purpose: the west swings reach x = 120, 116
 *     and 116; the east swings reach 170, 166 and 172. No two bends are the
 *     same size.
 *   - The spacing differs on purpose: 10 to 16 blocks. A constant spacing
 *     with varying amplitude is still a rhythm.
 *   - The first two points are STRAIGHT and level. You arrive facing down a
 *     path, not into a bend, and the spawn clearing has to stay flat for the
 *     test rigs (see SPAWN_FLAT in land.js).
 *   - The path's HEIGHT is no longer in this table. It used to be a third
 *     column, -1 to +1, because the land was flat and the path had to supply
 *     its own rise and fall. The land rolls now, and the path follows it:
 *     see `walkProfile` in src/builds/path.js.
 * ------------------------------------------------------------------------
 * CATMULL-ROM, specifically, and not a Bezier or a linear run.
 *
 * Catmull-Rom passes THROUGH its control points, which means the table below
 * says where the path actually goes. A Bezier's handles do not lie on the
 * curve, so the table would be a set of hints and "move the path four blocks
 * west here" would be an experiment instead of an edit. Linear would give a
 * polyline with visible corners, which is the one thing worse than a sine.
 */

/*
 * [patch x, patch z]. North (-z) is behind you; the visitor walks south, so
 * this list is in walking order.
 *
 * RE-CUT FOR SPRINT 1's 288 x 400 SURVEY. The plots doubled in area and the
 * corridor between the two columns of them is x 96..191, so every bend below
 * is a new place. The rules that made the old spine read as a walk and not a
 * wave still hold, and the numbers show them:
 *
 *   - each chapter gets a swing TOWARD its entrance (the north corner of its
 *     path-side edge, z0 + 6), peaking a few rows LATE so the spur peels back
 *     rather than branching straight off;
 *   - the west swings reach x = 118, 116 and 116, the east ones 170, 168 and
 *     172, and the spacing between points runs 10 to 16 rows;
 *   - the path never comes nearer a plot than 20 columns, and never nearer
 *     New York's moat than 8, so its widest spill is still grass.
 *
 * THE HEIGHT COLUMN IS GONE. The previous spine carried a hand-placed
 * +/-1 per point because the land under it was flat. The land is not flat any
 * more, and the path now takes its height FROM the land: see `walkProfile` in
 * src/builds/path.js, which smooths the terrain along the walk and limits the
 * grade, so the path rises over a hill and dips to a bridge on its own.
 */
export const SPINE = [
  [144, 0],     // off the top of the map, so the curve starts straight
  [144, 16],    // SPAWN. Flat and dead ahead.
  [143, 30],
  [134, 42],
  [120, 52],    // west, for Omaha (entrance z = 38) -- peaks late
  [118, 64],
  [130, 74],
  [152, 82],
  [170, 92],    // east, for Harvard (entrance z = 70) -- the long approach
  [168, 106],
  [150, 116],
  [128, 126],
  [116, 138],   // west, for Bilibili (entrance z = 128)
  [118, 152],
  [128, 166],
  [140, 178],
  [148, 188],   // THE BRIDGE. Nearly square across the water.
  [158, 198],
  [166, 210],   // east, for New York -- stops short of the moat
  [162, 224],
  [142, 236],
  [120, 246],
  [116, 258],   // west, for San Francisco (entrance z = 244)
  [124, 272],
  [146, 286],
  [166, 298],
  [172, 314],   // east, for the climb (entrance z = 310)
  [168, 330],
  [160, 346],   // and on, to the foot of the range
  [154, 362],
]

/**
 * Walk the spline and hand back a dense list of points along it.
 *
 * @returns [{ x, z, nx, nz }] where (nx, nz) is the unit NORMAL -- the
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
      const [x, z] = catmull(p0, p1, p2, p3, t)
      // The tangent by finite difference rather than by the derivative: it is
      // two more evaluations and it cannot disagree with the points the
      // raster actually uses, which a hand-differentiated basis can.
      const e = 0.01
      const [ax, az] = catmull(p0, p1, p2, p3, Math.max(0, t - e))
      const [bx, bz] = catmull(p0, p1, p2, p3, Math.min(1, t + e))
      const tx = bx - ax, tz = bz - az
      const m = Math.hypot(tx, tz) || 1
      out.push({ x, z, nx: -tz / m, nz: tx / m })
    }
  }
  return out
}

/** The standard uniform Catmull-Rom basis, run on both components at
 *  once. */
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t
  const f = (a, b, c, d) => 0.5 * (
    (2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]
}
