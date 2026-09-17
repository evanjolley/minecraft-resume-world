/*
 * THE RIVER, AND THE BRIDGE OVER IT.
 *
 * ------------------------------------------------------------------------
 * WHERE IT IS, AND WHY THERE.
 *
 * It runs east-west across the whole map at about z = 155, which is the gap
 * between chapter 4 (Bilibili) and chapter 5 (New York, No Logo) -- the
 * widest gap in the plot table by twenty blocks, and the only one that was
 * WIDENED to make room for this. "Put it where it means something -- a
 * crossing between two chapters is better than a decoration." The crossing is
 * the move to the city: everything north of it happened somewhere else.
 *
 * REJECTED -- a river beside the path, or a pond in a clearing. Both are
 * scenery, and scenery is what a river becomes the moment you are not obliged
 * to cross it. The path goes over this one whether you like it or not, which
 * is what makes the bridge a place rather than a prop.
 * ------------------------------------------------------------------------
 * IT CANNOT FLOOD, AND THAT IS A PROPERTY OF THE SHAPE, NOT A HOPE.
 *
 * Water in this world is live -- src/fluids.js spreads it, slopes it and
 * pushes entities around with it. A pool that leaks is a pool that keeps
 * leaking, over ground somebody is going to build on.
 *
 * Every water column here is a SOURCE, and every water column is enclosed:
 * a bed one block under the deepest water, a one-deep shallow shelf around
 * the two-deep middle, and a solid bank around the shelf. A source has
 * nowhere to flow to -- laterally it meets water or solid, downwards it meets
 * the bed -- so the sim has nothing to do on the first tick or on any tick
 * after it. The banks are the containment, not the absence of a leak.
 *
 * AND THE HALF-WIDTH TAPERS TO NOTHING before x = 6 and after x = 249, so the
 * river never reaches the patch edge. The barrier wall outside the patch is
 * not a block the fluid sim can see, and a river that ends AT it would be a
 * river ending at whatever the sim decides the outside of the world is.
 * ------------------------------------------------------------------------
 * AND YOU CAN ALWAYS GET OUT, which is the other half of a live river.
 *
 * Two deep in the middle, ONE deep for the two blocks nearest each bank, and
 * the bank itself is at ground level. So a swimmer's exit is: swim to the
 * shelf, stand up in ankle-deep water, step up one block onto gravel. One
 * block is a step, not a jump, and it works on every metre of both banks
 * rather than at a ladder somebody has to find.
 */
import { KIND, at, onMap, hash, smoothNoise } from './land.js'
import { landPlot } from './plots.js'

/*
 * THE COURSE, as [patch x, centre z, half width]. Hand-placed for the same
 * reason the spine is (see spine.js): a river generated from a wave has one
 * meander and you can see it. These seven points give it a wide slow bend in
 * the west, a tight one in the middle where the path crosses, and a lazy
 * drift back north in the east.
 *
 * THE BRIDGE SITS AT THE TIGHTEST PART ON PURPOSE -- around x = 140 the
 * channel is at its narrowest, which is exactly where anybody who had to
 * build a bridge by hand would have put one.
 */
const COURSE = [
  [0, 149, 3.0],
  [40, 155, 5.0],
  [80, 151, 4.5],
  [120, 158, 3.6],
  [150, 160, 3.4],
  [190, 155, 5.0],
  [230, 149, 4.2],
  [255, 147, 3.0],
]

/** Centre and half-width at a given x, smoothstepped between control points
 *  so the banks curve instead of kinking, plus a block of coordinate noise so
 *  the edge is not a drawn line. */
function courseAt(x) {
  let i = 0
  while (i < COURSE.length - 2 && x > COURSE[i + 1][0]) i++
  const [ax, az, aw] = COURSE[i], [bx, bz, bw] = COURSE[i + 1]
  const t0 = Math.max(0, Math.min(1, (x - ax) / (bx - ax)))
  const t = t0 * t0 * (3 - 2 * t0)
  const z = az + (bz - az) * t + (smoothNoise(x, 0, 11, 211) - 0.5) * 2.5
  let w = aw + (bw - aw) * t + (smoothNoise(x, 0, 7, 223) - 0.5) * 1.2
  /* Taper to nothing before either edge of the patch: the barrier is not a
   * block the fluid sim can see, so the water must never reach it. */
  const edge = Math.min(x - 2, 253 - x) / 8
  w *= Math.max(0, Math.min(1, edge))
  return [z, w]
}

/** Paint the channel into the model. Heights stay at 0 -- a river cuts DOWN,
 *  and the bed depth is carried in `depth` rather than in `h`, so the feather
 *  pass has nothing to feather here. */
export function carveRiver(model) {
  for (let x = 0; x < 256; x++) {
    const [zc, w] = courseAt(x)
    if (w <= 0.6) continue
    const from = Math.floor(zc - w - 2), to = Math.ceil(zc + w + 2)
    for (let z = from; z <= to; z++) {
      if (!onMap(x, z)) continue
      const j = at(x, z)
      /*
       * A river through somebody's plot would be a river through the one
       * thing this pass is not allowed to touch. It throws rather than
       * clipping, because a clipped river is a river with a square bite out
       * of it that nobody notices until the plot is built on.
       */
      if (model.kind[j] === KIND.PLOT) {
        throw new Error(
          `the river runs into a chapter plot at patch (${x}, ${z}) -- `
          + `move a control point in src/builds/river.js's COURSE.`)
      }
      const d = Math.abs(z - zc)
      if (d <= w - 1.5) {
        model.kind[j] = KIND.WATER
        model.depth[j] = 2
        model.surface[j] = hash(x, z, 233) < 0.25 ? 'clay' : 'gravel'
      } else if (d <= w) {
        model.kind[j] = KIND.SHALLOW
        model.depth[j] = 1
        model.surface[j] = hash(x, z, 239) < 0.4 ? 'sand' : 'gravel'
      } else if (d <= w + 1.7) {
        model.kind[j] = KIND.BANK
        model.surface[j] = hash(x, z, 241) < 0.35 ? 'sand'
          : hash(x, z, 251) < 0.5 ? 'gravel' : 'coarse_dirt'
      }
    }
  }
}

/*
 * THE BRIDGE.
 *
 * The deck is written by the ground pass (a BRIDGE column is water with a
 * plank over it); what is left is everything that makes it a bridge you can
 * see from fifty blocks away: the railings, the piers standing in the water,
 * and a light at each end.
 *
 * RAILINGS ARE ONE BLOCK HIGH, which is a judgement. Two blocks is a corridor
 * -- you cannot see the water you are crossing, which is the entire reason to
 * put a bridge in a landscape. One block is a kerb you can see over, trip
 * over deliberately, and jump off on purpose. You can get out; see the header
 * of this file.
 */
export function buildBridge(s, model, samples) {
  const deckOf = new Map()
  for (let z = 0; z < 256; z++) {
    for (let x = 0; x < 256; x++) {
      const j = at(x, z)
      if (model.kind[j] === KIND.BRIDGE) deckOf.set(j, model.h[j])
    }
  }
  if (deckOf.size === 0) {
    throw new Error('the path never crossed the river: no bridge deck was marked. '
      + 'Check the spine against COURSE in src/builds/river.js.')
  }

  for (const [j, h] of deckOf) {
    const x = j % 256, z = (j / 256) | 0
    /* An edge of the deck is a deck column with open water beside it. */
    let edge = false
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = at(x + dx, z + dz)
      if (!onMap(x + dx, z + dz)) continue
      const n = model.kind[k]
      if (n === KIND.WATER || n === KIND.SHALLOW) edge = true
    }
    if (!edge) continue
    s.set(x, h, z, 'stripped_oak_log')
    /* A taller post every fourth block, with a lantern on it -- the light on
     * the bridge is the one place on the walk where falling in is possible,
     * so it is lit from above rather than at the ends only. Glowstone rather
     * than a torch because the post has to be visible as well as lighting. */
    if ((x + z) % 7 === 0) {
      s.set(x, h + 1, z, 'stripped_oak_log')
      s.set(x, h + 2, z, 'glowstone')
    }
  }

  /*
   * THE PIERS. Cobblestone from the bed to just under the deck, at the
   * columns nearest the middle of the span. Structurally decorative and
   * visually load-bearing: a deck floating over water reads as a glitch.
   *
   * ONE SPAN PER BRIDGE, and that is the whole reason this walks connected
   * components instead of taking the middle of everything marked BRIDGE.
   * There are two bridges now -- the river crossing between Bilibili and New
   * York, and the short one onto the island -- and the midpoint of their
   * union is a point in a field halfway between them. The first version of
   * this function could not have known that; it is what a global mid is
   * always one more bridge away from getting wrong.
   *
   * AND THE LONG AXIS, not z. The river is crossed along z and the moat along
   * x, so "the middle of the span" is a different coordinate for each. The
   * bounding box says which.
   */
  for (const span of components(deckOf)) {
    let xLo = 999, xHi = -1, zLo = 999, zHi = -1
    for (const j of span) {
      const x = j % 256, z = (j / 256) | 0
      if (x < xLo) xLo = x
      if (x > xHi) xHi = x
      if (z < zLo) zLo = z
      if (z > zHi) zHi = z
    }
    const alongZ = (zHi - zLo) >= (xHi - xLo)
    const mid = alongZ ? Math.round((zLo + zHi) / 2) : Math.round((xLo + xHi) / 2)
    for (const j of span) {
      const x = j % 256, z = (j / 256) | 0
      if (Math.abs((alongZ ? z : x) - mid) > 1) continue
      if ((x + z) % 3 !== 0) continue
      s.pillar(x, z, -3, deckOf.get(j) - 2, 'cobblestone')
    }
  }
}

/** Split a set of column indices into 4-connected groups. A flood fill with
 *  an explicit stack rather than recursion: a deck is only a few hundred
 *  columns, but a recursive fill over a voxel map is the one that blows the
 *  stack on the day somebody makes a causeway. */
function components(deckOf) {
  const seen = new Set()
  const out = []
  for (const start of deckOf.keys()) {
    if (seen.has(start)) continue
    const group = []
    const stack = [start]
    seen.add(start)
    while (stack.length) {
      const j = stack.pop()
      group.push(j)
      const x = j % 256, z = (j / 256) | 0
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz
        if (!onMap(nx, nz)) continue
        const k = at(nx, nz)
        if (!deckOf.has(k) || seen.has(k)) continue
        seen.add(k)
        stack.push(k)
      }
    }
    out.push(group)
  }
  return out
}


/* ====================================================================== *
 *
 * NEW YORK IS AN ISLAND, AND THE RIVER IS WHAT MAKES IT ONE.
 *
 * "Ok yes nyc on an island and connect the water to the river somehow? And
 * build a lil bridge."
 *
 * THE WATER IS THE RIVER'S, NOT A NEW POOL. The river already runs east-west
 * across the whole map at about z = 155, twelve rows north of chapter 4's
 * plot, and it was put there because the crossing is the move to the city.
 * So the moat is cut as a loop that RUNS OFF IT -- the northern rim at z 156
 * to 162 is inside the river's own bank zone, the two bodies are one body,
 * and the island is a piece of ground the river goes round rather than a
 * pond somebody dug beside it. Nothing here invents a second water table.
 *
 * REJECTED -- a square moat. It is four rectangles and it would read as a
 * castle. The shape below is the distance to the PLOT RECTANGLE, expanded by
 * a shore and then jittered by a noise field, so the shoreline is a curve
 * with bays in it that still keeps a guaranteed six blocks of land between
 * the water and the chapter's border.
 * ------------------------------------------------------------------------
 * IT CANNOT FLOOD, AND FOR EXACTLY THE REASON THE RIVER CANNOT.
 *
 * Read the header of this file first. Every water column is a SOURCE and
 * every water column is enclosed: bed under the deepest water, a one-deep
 * shelf between the two-deep middle and the land, and an unbroken BANK ring
 * outside the shelf. The bank is the containment. It is also the way OUT --
 * swim to the shelf, stand up in ankle-deep water, step up one block onto
 * sand -- and it works on every metre of the shore rather than at a ladder.
 *
 * THE BANK RING IS ALSO WHAT KEEPS THE RELIEF HONEST. src/builds/land.js
 * pins every WATER, SHALLOW and BANK column at height 0 before the slope
 * clamp runs, so the ground beside the water cannot be sunk by a biome and
 * leave a water block with an open face over a hole. The ring is not
 * decoration; it is the boundary condition the whole height field is solved
 * against.
 * ====================================================================== */

/** How much dry land there is between the chapter's border and the water. */
const SHORE = 6

/** The bands of the loop, as distances outward from the shore line. Read as
 *  a cross-section of one side: a metre and a half of sand, a shelf you can
 *  stand up in, four and a half of open water, the shelf again, the bank. */
const BANDS = { bankIn: 1.5, shelfIn: 3.0, deep: 7.5, shelfOut: 9.0, bankOut: 10.5 }

/**
 * SIGNED distance from (x, z) to a rectangle: positive outside, and NEGATIVE
 * inside by how far in you are.
 *
 * The unsigned version is two lines shorter and it is wrong twice over, which
 * is worth recording because both failures look like the same typo. Every
 * column inside the rectangle answers 0, so (a) the whole island interior sits
 * exactly on the shore line and the jitter floods half of it, and (b) the
 * chapter's own plot -- six blocks further in -- also answers 0, so the guard
 * below fires on a plot that is nowhere near the water. The second one is
 * what actually threw.
 */
function toRect(x, z, r) {
  const dx = Math.max(r.x0 - x, 0, x - r.x1)
  const dz = Math.max(r.z0 - z, 0, z - r.z1)
  if (dx > 0 || dz > 0) return Math.hypot(dx, dz)
  return -Math.min(x - r.x0, r.x1 - x, z - r.z0, r.z1 - z)
}

/**
 * Cut the loop. Runs AFTER carveRiver so that where the two meet, the island's
 * water simply overwrites the river's bank and the join is water to water.
 */
export function carveIsland(model) {
  const c = landPlot('ch4')
  const ring = { x0: c.x0 - SHORE, x1: c.x1 + SHORE, z0: c.z0 - SHORE, z1: c.z1 + SHORE }

  for (let z = ring.z0 - 14; z <= ring.z1 + 14; z++) {
    for (let x = ring.x0 - 14; x <= ring.x1 + 14; x++) {
      if (!onMap(x, z)) continue
      const j = at(x, z)
      /* A moat through somebody's plot would be a moat through the one thing
       * this pass may not touch, and the chapter it belongs to is the one it
       * would drown. Throws rather than clipping, for the same reason
       * carveRiver does: a clipped shoreline is a square bite nobody notices
       * until the plot is built on. */
      if (model.kind[j] === KIND.PLOT) {
        const d0 = toRect(x, z, ring)
        if (d0 > -3 && d0 <= BANDS.bankOut) {
          throw new Error(
            `the New York moat runs into a chapter plot at patch (${x}, ${z}) `
            + `-- SHORE in src/builds/river.js is ${SHORE} and is not enough.`)
        }
        continue
      }
      /* The jitter is what stops it reading as a racetrack. Two scales again:
       * a slow one that makes bays and headlands, a fast one that roughens
       * the last block of the edge. */
      const d = toRect(x, z, ring)
        + (smoothNoise(x, z, 14, 601) - 0.5) * 4.5
        + (smoothNoise(x, z, 5, 607) - 0.5) * 1.6

      if (d <= 0) continue                               // the island itself
      if (d > BANDS.bankOut) continue                    // the mainland
      if (d <= BANDS.bankIn || d > BANDS.shelfOut) {
        /* The two bank rings. Never demote water the river already put here:
         * where the loop meets the river the answer has to be the wetter of
         * the two, or the join would be a dam across the channel. */
        const k = model.kind[j]
        if (k === KIND.WATER || k === KIND.SHALLOW) continue
        model.kind[j] = KIND.BANK
        model.surface[j] = hash(x, z, 241) < 0.4 ? 'sand'
          : hash(x, z, 251) < 0.5 ? 'gravel' : 'coarse_dirt'
      } else if (d <= BANDS.shelfIn || d > BANDS.deep) {
        if (model.kind[j] === KIND.WATER) continue        // already deeper
        model.kind[j] = KIND.SHALLOW
        model.depth[j] = 1
        model.surface[j] = hash(x, z, 239) < 0.4 ? 'sand' : 'gravel'
      } else {
        model.kind[j] = KIND.WATER
        model.depth[j] = 2
        model.surface[j] = hash(x, z, 233) < 0.25 ? 'clay' : 'gravel'
      }
    }
  }
}

/*
 * THE CROSSING, and it is the same three blocks of deck the spur would have
 * been if the water were not there.
 *
 * src/builds/path.js aims every spur at the plot's path-side edge at
 * z = z0 + 6, which is where src/builds/chapters.js opens the border. So the
 * bridge is a straight run along x at that z, from the mainland bank to the
 * island bank, and drawSpurs -- which skips BRIDGE columns the same way it
 * skips PATH -- simply arrives at each end of it.
 *
 * MARKED BEFORE THE SPUR IS DRAWN. A deck column is water with a plank over
 * it (see writeGround), and the bug the river's bridge already documents is
 * that a raster which asks "is this water" turns the deck back into path on
 * its second visit and fills the channel with dirt. BRIDGE is sticky and it
 * has to be set first.
 */
export function bridgeToIsland(model) {
  const c = landPlot('ch4')
  const lowX = c.side === 'LEFT'
  const z0 = c.z0 + 6
  const from = lowX ? c.x1 + 1 : c.x0 - 1
  const dir = lowX ? 1 : -1
  let decks = 0
  for (let step = 0; step < 24; step++) {
    const x = from + step * dir
    for (let z = z0 - 1; z <= z0 + 1; z++) {
      if (!onMap(x, z)) continue
      const j = at(x, z)
      const k = model.kind[j]
      if (k !== KIND.WATER && k !== KIND.SHALLOW) continue
      model.kind[j] = KIND.BRIDGE
      /* A deck is never at the water's own level: the water surface is local
       * y = -1 and a plank written there is a plank floating IN the moat,
       * which is what the river's bridge found out the hard way. */
      model.h[j] = 1
      decks++
    }
  }
  if (decks === 0) {
    throw new Error('the New York bridge crosses no water: the moat and the spur '
      + 'do not line up. Check SHORE in src/builds/river.js against the door z '
      + 'that src/builds/chapters.js opens.')
  }
  return decks
}
