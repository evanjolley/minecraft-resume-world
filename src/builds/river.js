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
   * THE PIERS. Cobblestone from the bed to just under the deck, at the two
   * columns nearest the middle of the span. Structurally decorative and
   * visually load-bearing: a deck floating over water reads as a glitch.
   */
  const decks = [...deckOf.keys()]
  const zs = decks.map(j => (j / 256) | 0)
  const zMid = Math.round((Math.min(...zs) + Math.max(...zs)) / 2)
  for (const j of decks) {
    const x = j % 256, z = (j / 256) | 0
    if (Math.abs(z - zMid) > 1) continue
    if ((x + z) % 3 !== 0) continue
    s.pillar(x, z, -3, deckOf.get(j) - 2, 'cobblestone')
  }
}
