/*
 * THE PATH ITSELF: the surface, the ragged edge, the spurs and the lamps.
 *
 * Everything here writes into the model (see src/builds/land.js) except the
 * lamps, which stand ON the finished ground and therefore run after it.
 *
 * ------------------------------------------------------------------------
 * WHAT MAKES IT READ AS WORN RATHER THAN LAID, which is the whole brief:
 *
 *   - THE WIDTH VARIES AND NEVER SYMMETRICALLY. Two independent noise fields
 *     at different scales -- 9 samples for the left edge, 13 for the right --
 *     so one side bulges where the other narrows and the pair never repeats.
 *     A single width with both edges tracking it is a road with a camber.
 *   - THE EDGE IS RAGGED. The outermost half block of each side only gets
 *     placed 58% of the time, decided per column by the coordinate hash, so
 *     the boundary frays instead of ending.
 *   - AND IT SPILLS. A few percent of the columns just outside the frayed
 *     edge get a single block of path material anyway, one or two out into
 *     the grass. That is the detail that makes it look walked: the mess is
 *     OUTSIDE the line, not just missing from it.
 *   - AND THE GRASS POKES BACK. Three percent of interior columns keep their
 *     grass. Only the two together read correctly -- spill alone looks like a
 *     bad mask, grass alone looks like wear.
 *
 * REJECTED -- a Perlin-displaced constant-width ribbon, which is the usual
 * way to do this. It gives you a wobbly edge whose wobble has a scale, and at
 * eye level you see the scale. Deciding per column with a hash has no scale
 * at all, which is what a footpath's edge actually looks like.
 * ------------------------------------------------------------------------
 */
import { KIND, at, onMap, hash, smoothNoise, nearSpawn, SPAWN_FLAT } from './land.js'
import { CHAPTERS } from './plots.js'

/** Half-widths, left and right of the centreline, at sample `i`. Total width
 *  runs about 3 to 5 blocks, which is the brief's range. */
function halves(i) {
  return [
    1.0 + 1.15 * smoothNoise(i, 0, 9, 31),
    1.0 + 1.15 * smoothNoise(i, 0, 13, 47),
  ]
}

/**
 * Paint the main path into the model.
 *
 * @param model    the column model
 * @param samples  sampleSpine's output
 * @param surfaceOf (x, z) -> block key for the worn mix
 */
export function drawPath(model, samples, surfaceOf) {
  const edges = []   // columns at the frayed edge, for the spill pass

  samples.forEach((s, i) => {
    const [wl, wr] = halves(i)
    for (let d = -wl; d <= wr; d += 0.3) {
      const x = Math.round(s.x + s.nx * d)
      const z = Math.round(s.z + s.nz * d)
      if (!onMap(x, z)) continue
      const j = at(x, z)

      /*
       * THE PATH MAY NOT TOUCH A CHAPTER, and this throws rather than skips.
       * A skip would hide the real failure -- a spine control point drifting
       * into a plot as the layout is tuned -- behind a path that quietly goes
       * one block narrower for forty blocks. The stamper would catch the
       * write later, but not with the coordinate that caused it.
       */
      if (model.kind[j] === KIND.PLOT) {
        throw new Error(
          `the path runs into a chapter plot at patch (${x}, ${z}) -- `
          + `spine sample ${i} at (${s.x.toFixed(1)}, ${s.z.toFixed(1)}). `
          + `Move the control point in src/builds/spine.js.`)
      }

      const outer = d < 0 ? -d > wl - 0.55 : d > wr - 0.55
      if (outer) {
        if (hash(x, z, 71) > 0.58) { edges.push(j); continue }
        edges.push(j)
      }

      /*
       * BRIDGE IS STICKY, and the bug that makes it worth a comment: the
       * raster visits most columns several times (many samples, many offsets
       * across the width), and the FIRST visit turns water into a deck. On
       * the second visit the column is no longer water -- it is BRIDGE -- so
       * a test that only asks "is this water" turns the deck back into path,
       * and the path then fills the river with dirt up to its own height. The
       * whole bridge vanished, silently, into a dam.
       */
      const prev = model.kind[j]
      const water = prev === KIND.WATER || prev === KIND.SHALLOW || prev === KIND.BRIDGE
      model.kind[j] = water ? KIND.BRIDGE : KIND.PATH
      /*
       * A DECK IS NEVER BELOW y = 0, whatever the spine says. The spine
       * crests at h = 1 over the river and falls to 0 at each bank, and a
       * deck at h = 0 would be written at local y = -1 -- exactly the level
       * of the water surface, so the last two blocks of bridge at each end
       * were a plank floating IN the river. Clamping here rather than bending
       * the spine keeps the approach ramp gentle and makes the step onto the
       * bridge one block, which is a step.
       */
      const want = nearSpawn(x, z, SPAWN_FLAT) ? 0 : Math.round(s.h)
      model.h[j] = water ? Math.max(1, want) : want
      /* Three percent of the surface stays grass: a tuft the walking never
       * quite killed. `null` means "leave the generator's block", which for a
       * column at h = 0 is exactly the grass that was already there. */
      model.surface[j] = hash(x, z, 89) < 0.03 ? null : surfaceOf(x, z)
    }
  })

  /*
   * THE SPILL. One or two blocks of path material out in the grass beside the
   * frayed edge, at 7% of edge columns. They are KIND.PATH so nothing plants
   * a tree on them, and they carry the same worn mix.
   */
  for (const j of edges) {
    const x0 = j % 256, z0 = (j / 256) | 0
    if (hash(x0, z0, 113) > 0.07) continue
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
      const x = x0 + dx, z = z0 + dz
      if (!onMap(x, z)) continue
      const k = at(x, z)
      if (model.kind[k] !== KIND.FIELD) continue
      if (hash(x, z, 127) > 0.4) continue
      model.kind[k] = KIND.PATH
      model.h[k] = model.h[j]
      model.surface[k] = surfaceOf(x, z)
    }
  }
}

/*
 * THE SPURS, and the reason every chapter has one.
 *
 * "A short spur off the main path, so arriving somewhere is a choice." A plot
 * that the path runs straight into is a room you are pushed through; a plot
 * with a turning off it is a place you decide to visit. Three blocks wide
 * against the main path's four or five, so it reads as lesser -- you can tell
 * which one is the way on.
 *
 * It is a quadratic Bezier rather than a straight run: the control point is
 * pushed along the path's own direction, so the spur LEAVES the path at a
 * shallow angle and turns to meet the plot square. A T-junction at 90 degrees
 * is the one shape in this landscape that would look drawn.
 */
export function drawSpurs(model, samples, surfaceOf) {
  for (const c of CHAPTERS) {
    /* LEFT is the LOW-x side, which in this engine is EAST: Babylon is
     * left-handed, facing +z puts +x on your right, and the visitor walks
     * south. See HEADING in test/helpers/world.js, measured in
     * test/25-orientation.spec.js. The variable is named for the axis rather
     * than the compass because every coordinate below is an index. */
    const lowX = c.side === 'LEFT'
    const zTarget = c.z0 + 6                // beside the marker, near the north edge
    const edgeX = lowX ? c.x1 + 1 : c.x0 - 1

    // The point on the path nearest the plot's entrance, which is what makes
    // the spur the SHORT way in rather than a diagonal across the field.
    let best = samples[0], bestD = Infinity
    for (const s of samples) {
      const d = Math.hypot(s.x - edgeX, s.z - zTarget)
      if (d < bestD) { bestD = d; best = s }
    }

    const ax = best.x, az = best.z
    const bx = edgeX, bz = zTarget
    // The handle: half the gap, pushed along the path's tangent so the spur
    // peels off instead of branching.
    const cx = ax + (bx - ax) * 0.45 - best.nx * 2
    const cz = az + (bz - az) * 0.45 + (bz > az ? 5 : -5)

    const steps = Math.ceil(Math.hypot(bx - ax, bz - az) * 4)
    for (let k = 0; k <= steps; k++) {
      const t = k / steps
      const x0 = (1 - t) ** 2 * ax + 2 * (1 - t) * t * cx + t * t * bx
      const z0 = (1 - t) ** 2 * az + 2 * (1 - t) * t * cz + t * t * bz
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          const x = Math.round(x0 + dx), z = Math.round(z0 + dz)
          if (!onMap(x, z)) continue
          if (Math.hypot(x - x0, z - z0) > 1.6 + 0.4 * hash(x, z, 151)) continue
          const j = at(x, z)
          /* Stops AT the plot, never in it -- the chapter's own build makes
           * the entrance on its side of the line. */
          if (model.kind[j] === KIND.PLOT) continue
          if (model.kind[j] === KIND.WATER || model.kind[j] === KIND.SHALLOW) continue
          if (model.kind[j] === KIND.PATH || model.kind[j] === KIND.BRIDGE) continue
          model.kind[j] = KIND.SPUR
          model.surface[j] = hash(x, z, 163) < 0.05 ? null : surfaceOf(x, z)
        }
      }
    }
  }
}

/*
 * LIGHT AT INTERVALS, and it is worth doing properly now that block light
 * exists.
 *
 * docs/builds/README.md's lighting section is the constraint: light falls one
 * level per block and STOPS DEAD at a solid block, and "a lamp at y = 1 or
 * y = 2 sits exactly at eye level". A torch on top of a three-block post
 * sits at y = 3 -- above the eyeline, with nothing between it and the path,
 * so its 14 levels fall on the ground the walker is using rather than into
 * the walker's face.
 *
 * SPACED 20 BLOCKS AND ALTERNATING SIDES, with the interval jittered by the
 * post's own coordinate so the spacing is not a metronome either. Between
 * them the path is genuinely dark at night, which is the point of lighting a
 * path at intervals rather than lighting a path.
 */
export function lampPosts(s, model, samples) {
  let since = 40
  let side = 1
  samples.forEach((p, i) => {
    since += 0.25
    const want = 18 + 8 * smoothNoise(i, 0, 23, 59)
    if (since < want) return
    const [wl, wr] = halves(i)
    const d = (side > 0 ? wr : -wl) + 1.8
    const x = Math.round(p.x + p.nx * d)
    const z = Math.round(p.z + p.nz * d)
    if (!onMap(x, z)) return
    const j = at(x, z)
    const k = model.kind[j]
    /*
     * AND NOT ON THE PATH ITSELF, which the first version got wrong in the
     * most visible place there is: the offset puts the post outside the
     * measured width, but the SPILL pass widens the path a block or two at
     * random, so a post landed dead centre of the path four blocks from
     * spawn -- the first thing any visitor saw, and a thing you had to walk
     * around. The offset is where a post WANTS to be; this is the check that
     * it ended up somewhere a post can stand.
     */
    if (k !== KIND.FIELD && k !== KIND.BANK) return
    if (nearSpawn(x, z, 9)) return
    since = 0
    side = -side
    const base = model.h[j]
    s.pillar(x, z, base, base + 2, 'stripped_oak_log')
    s.set(x, base + 3, z, 'torch')
  })
}
