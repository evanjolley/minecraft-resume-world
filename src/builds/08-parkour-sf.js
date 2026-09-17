/*
 * STAGE 8 -- SAN FRANCISCO, AND THE WAY UP. Where it is now, and the only
 * stage you are meant to PLAY rather than look at.
 *
 * ------------------------------------------------------------------------
 * WHAT IS HERE, AND WHY IT IS HERE. Everything below is from the owner's own
 * record. Nothing factual is invented -- the licence this build takes is in
 * how a fact is DRAWN, never in what the fact is.
 *
 *   the Golden Gate, in       lives in San Francisco now, after two years in
 *     international orange    New York. It is the first thing you meet: the
 *                             approach ramp lands on the plot's south edge,
 *                             four blocks from where every visitor spawns,
 *                             so you arrive by walking onto the bridge.
 *   the Painted Ladies        three of them, across the water, which is the
 *                             view they are famous from
 *   number 27, empty          looking for an apartment from January 2027. The
 *                             middle house is unfurnished, its boards are
 *                             bare, there is a stack of moving crates in the
 *                             front room and a letting board on the railing.
 *                             27 is the house number and it is also the day
 *                             in August he was born.
 *   the height mark inside    6'2", scratched on the door frame of the empty
 *                             flat, which is what you do in an empty flat
 *   the cable car and the     the hills. The slot between the rails is the
 *     slot in the street      real detail: the cable runs under the street
 *   the blue and gold court   Warriors, because his father is from the Bay
 *                             Area. The red-and-white and the red-and-gold
 *                             pennants over the cafe counter are Arsenal and
 *                             the Chiefs; the red N is Nebraska.
 *   the bike dock on the      cycled all over New York on Citi Bikes and
 *     promenade, one slot     wants the equivalent here. The missing bike is
 *     empty                   the one somebody is out on.
 *   the cafe, and the two     cold brew, and the thing he actually asks of
 *     cups left on the        visitors: people to trade stories with, and
 *     table at the summit     strangers over coffee. There are two cups at
 *                             the top of the hill and only one of them is
 *                             his. That is the invitation, and it is the
 *                             note this whole road ends on.
 *   SAY HI, cut into the      the same invitation, in letters five blocks
 *     bluff facing the road   tall, facing back down the timeline so it can
 *                             be read from the bridge and from the road
 *   the trail, and the jumps  looking forward to hiking. There are two ways
 *                             to the summit: a graded trail up the east
 *                             flank that anybody can walk, and thirteen
 *                             jumps over the water that nobody has to.
 *
 * THE EASTER EGGS, three of them, one for each direction you have to look:
 *
 *   UNDER   the piano in the cafe cellar, under the two missing floorboards
 *           behind the counter. He took a few years of piano, quit, and
 *           regrets it -- so it is down there under a dust sheet with the
 *           lid shut and one torch on it. Nothing upstairs says it exists.
 *   BEHIND  a tunnel into the bluff, its mouth at the waterline on the far
 *           side of the pool, two blocks high and easy to swim straight
 *           past. Twenty blocks in, on the back wall, JOLLY BOYS -- the name
 *           he has played under since 2011.
 *   ON TOP  the roof deck on the middle Painted Lady, reached from the hill
 *           street behind the terrace. A bike, a cold brew, and the four
 *           pennants.
 * ------------------------------------------------------------------------
 * ORIENTATION, AND IT IS THE OPPOSITE OF STAGE 1's. This plot is on the
 * RIGHT of the road, so the road is at LOW x: local x = 0 is the kerb and
 * x = 55 is the back of the plot. The facade goes at x = 0..17 -- promenade,
 * bay, bridge -- and the hill is pushed east where distance flatters it.
 * +z runs south, and SOUTH IS WHERE THE VISITOR COMES FROM: spawn is three
 * blocks past z = 27. So the bridge ramp lands at z = 27 and the hillside
 * letters face west, back down the road.
 *
 * y = 0 is the air above the grass; y = -1 IS the grass.
 *
 * ------------------------------------------------------------------------
 * THE WATER RULE, and it is the one thing in this file that could break
 * somebody else's plot. Stamped water is real water: src/fluids.js scans a
 * chunk once when it arrives and any source block with a hole beside it
 * starts flowing, and it does not know where my plot ends. So every pool
 * here is SEALED -- solid ground on all four sides at every level it fills,
 * bedrock or dirt underneath -- and the only opening into the bluff tunnel
 * is at y = 0, a block above the surface. Checked by eye per pool below;
 * there is no runtime that would tell you otherwise until the road flooded.
 */

/* ------------------------------------------------------------------ *
 * The one shared number: the parkour's jump distance.
 *
 * TWO AIR BLOCKS AND ONE BLOCK OF RISE, every jump, thirteen times. That is
 * the easiest jump in Minecraft that is still a jump: a standing jump's apex
 * is MC.JUMP_APEX = 1.2522 so the rise is always cleared, and a sprint jump
 * launches at MC.SPRINT_SPEED + MC.SPRINT_JUMP_BOOST = 9.612 b/s and stays
 * airborne 0.56 s, which is four blocks of travel against the three this
 * asks for. Measured rather than believed -- test/71-parkour.spec.js flies
 * the whole course with real key presses and asserts the player arrives.
 *
 * REJECTED -- a three-air-block gap, which is the standard Minecraft parkour
 * jump and lands with about half a block to spare. Half a block of margin is
 * a course for people who play Minecraft, and most people who open this
 * website do not. The whole design here is that a visitor who has never
 * sprinted in a browser can finish it by holding W and tapping space.
 * ------------------------------------------------------------------ */
const AIR_GAP = 2      // blocks of nothing between one platform and the next
const RISE = 1         // and how much higher the next one is

export function build(s) {
  promenade(s)
  bay(s)
  goldenGate(s.at(0, 0, 0, 'sf/bridge'))
  cafe(s.at(11, 0, 22, 'sf/cafe'))
  waterfront(s)
  paintedLadies(s)
  hillStreet(s)
  twinPeaks(s)
  parkour(s)
}

/* ------------------------------------------------------------- lettering */

/*
 * A 3x5 alphabet, because this world has no font and the invitation is the
 * whole point of the stage.
 *
 * road.js has eight digits for the stage markers and says, correctly, that
 * eight glyphs is cheaper than a font file. This is the second time somebody
 * has needed letters and it is still cheaper: thirteen glyphs, drawn the way
 * they are read, fed straight to s.pattern which already stacks vertical
 * planes top-row-first.
 */
const GLYPHS = {
  A: ['###', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['###', '..#', '..#', '#.#', '###'],
  L: ['#..', '#..', '#..', '#..', '###'],
  N: ['#.#', '###', '#.#', '#.#', '#.#'],
  O: ['###', '#.#', '#.#', '#.#', '###'],
  S: ['###', '#..', '###', '..#', '###'],
  Y: ['#.#', '#.#', '###', '.#.', '.#.'],
  ' ': ['..', '..', '..', '..', '..'],
  2: ['###', '..#', '###', '#..', '###'],
  7: ['###', '..#', '..#', '..#', '..#'],
}

/** How wide a word comes out, so a caller can centre it without counting. */
const wordWidth = (word) => [...word].reduce((n, ch) => n + GLYPHS[ch][0].length + 1, 0) - 1

/**
 * Write a word into a plane, one block per pixel.
 *
 * Glyphs are joined with a single blank column, and a blank column is '.',
 * which s.pattern already treats as "leave whatever is there alone" -- so a
 * word written onto a stone bluff keeps the stone between its letters
 * instead of punching holes in it.
 */
function write(s, word, { at, plane, colour }) {
  const rows = ['', '', '', '', '']
  for (const ch of word.toUpperCase()) {
    const g = GLYPHS[ch]
    if (!g) throw new Error(`sf: no glyph for ${JSON.stringify(ch)}`)
    for (let r = 0; r < 5; r++) rows[r] += `${g[r]}.`
  }
  s.pattern({ at, plane, legend: { '#': colour }, rows })
  return s
}

/* ------------------------------------------------------------- promenade */

/*
 * The Embarcadero: three columns of paving down the kerb, the bike dock, and
 * the lamps.
 *
 * x = 2 is doing two jobs -- it is the last paving slab AND it is the bay's
 * west seawall. That is deliberate and it is load-bearing: the water starts
 * at x = 3, so if this rectangle were ever narrowed the bay would have air
 * beside it at y = -1 and would pour onto the road.
 */
function promenade(s) {
  s.rect([0, 0], [2, 27], -1, 'polished_andesite')
  s.line([0, -1, 0], [0, -1, 27], 'stone_bricks')          // the kerb line
  s.line([2, -1, 0], [2, -1, 27], 'stone_bricks')          // the seawall cap

  // A rail along the water, low enough to see over and high enough to lean
  // on -- and it is the reason you can walk this edge without falling in.
  for (let z = 3; z <= 20; z += 3) s.set(2, 0, z, 'stone_brick_slab')

  for (const z of [4, 12, 19]) {
    s.pillar(1, z, 0, 2, 'polished_blackstone')
    s.set(1, 3, z, 'sea_lantern')
  }

  bikeDock(s.at(0, 0, 7, 'sf/bikes'))

  /*
   * The corner you arrive at. A visitor spawns three blocks south of z = 27
   * and walks north; this is the first paving of the last stage and it wants
   * to read as an arrival, so the entry apron is wider than the promenade
   * and the bridge ramp lands right beside it.
   */
  s.rect([0, 22], [3, 27], -1, 'smooth_stone')
  s.set(0, 0, 27, 'sea_lantern')
  s.set(3, 0, 27, 'sea_lantern')
}

/*
 * The bike dock. Five slots, four bikes, one gap.
 *
 * He cycled all over New York on Citi Bikes and wants the equivalent here,
 * and the thing that makes a dock read as a dock rather than as a rack is
 * that one of them is always out. A bike is three blocks -- two dark wheels
 * and a bar -- which at this scale is as much bicycle as there is room for.
 */
function bikeDock(d) {
  d.rect([0, 0], [2, 5], -1, 'smooth_stone')
  d.box([0, 0, 0], [0, 1, 5], 'polished_blackstone')       // the pay station wall
  d.set(0, 2, 0, 'sea_lantern')

  for (let i = 0; i <= 4; i++) {
    const z = 1 + i
    d.set(1, 0, z, 'polished_blackstone')                  // the dock point
    if (i === 2) continue                                  // ...and this one is out
    d.set(2, 0, z, 'black_concrete')
    d.set(2, 1, z, 'light_blue_concrete')                  // the frame
  }
}

/* --------------------------------------------------------------- the bay */

/*
 * The water. ONE BLOCK DEEP AND FLUSH WITH THE GROUND, which is the whole
 * trick: the grass at y = -1 is replaced rather than built on, so the bay is
 * at the same height as the pavement beside it and you walk to the edge of
 * it instead of stepping up onto a tank.
 *
 * Sealed on all four sides -- promenade at x = 2, waterfront street at
 * x = 17, paving at z = 2 and z = 21, dirt underneath. See the water rule in
 * the header; this is the pool that would reach the road.
 */
function bay(s) {
  s.rect([2, 2], [17, 2], -1, 'stone_bricks')
  s.rect([2, 21], [17, 21], -1, 'stone_bricks')
  s.rect([17, 2], [17, 21], -1, 'stone_bricks')
  s.rect([3, 3], [16, 20], -1, 'water')

  // Two piers of the old wharf, standing in the shallows. They are also the
  // only thing that stops fourteen by eighteen of flat water reading as a
  // swimming pool.
  for (const [x, z] of [[8, 4], [13, 18], [14, 6]]) {
    s.pillar(x, z, -1, 0, 'dark_oak_wood')
    s.set(x, 1, z, 'dark_oak_wood')
  }
  s.box([12, 1, 17], [15, 1, 19], 'dark_oak_planks')       // a deck on the third pier
  s.pillar(12, 17, -1, 0, 'dark_oak_wood')
  s.pillar(15, 19, -1, 0, 'dark_oak_wood')
  s.set(13, 2, 18, 'sea_lantern')
}

/* ------------------------------------------------------- the golden gate */

/*
 * THE GOLDEN GATE, in international orange, and it is the first thing a
 * visitor touches rather than the last thing they look at.
 *
 * The approach ramp lands at z = 27 -- the plot's south edge, three blocks
 * from spawn -- and climbs one block per block of z to the deck at y = 6. So
 * the walk north up the timeline starts by walking ONTO the bridge, which is
 * as close as a voxel world gets to arriving in San Francisco.
 *
 * WHY THE DECK IS AT y = 6 AND NOT HIGHER. The ramp has six blocks of z to
 * climb in before it runs out of plot, and a Minecraft player climbs one
 * block per jump and no more. A deck at y = 9 is a deck reachable only by a
 * staircase somewhere else, and a bridge you cannot walk onto from the road
 * is scenery.
 *
 * The homage is to every Golden Gate in Minecraft and to the same three
 * things all of them get right: the towers are two legs and three crossbeams
 * and not a solid slab, the cable passes OVER the tower top rather than
 * stopping at it, and the suspenders are thinner than the cable. The rest is
 * the colour.
 */
const DECK_Y = 6
const TOWER_Z = [5, 17]        // where the two towers stand in the bay
const ORANGE = 'orange_concrete'

/** The main cable's height at a given z. Straight side spans, a parabola
 *  between the towers -- which is what a loaded suspension cable actually
 *  hangs in, and it is two lines of arithmetic rather than a table. */
function cableY(z) {
  if (z <= TOWER_Z[0]) return 7 + 3 * z
  if (z >= 22) return 7 - (z - 21)
  if (z >= TOWER_Z[1]) return Math.round(22 - (z - TOWER_Z[1]) * 15 / 4)
  const mid = (TOWER_Z[0] + TOWER_Z[1]) / 2
  const half = (TOWER_Z[1] - TOWER_Z[0]) / 2
  return Math.round(12 + 10 * ((z - mid) / half) ** 2)
}

function goldenGate(b) {
  // The north abutment: the bridge runs off the top of the plot toward stage
  // 7, so it needs something to stand on where the water stops.
  b.box([3, -1, 0], [11, DECK_Y, 2], 'stone_bricks')

  deck(b)
  for (const z of TOWER_Z) tower(b.at(0, 0, z, 'sf/tower'))
  cables(b)

  /*
   * The ramp. One block of rise per block of z, from ground at z = 27 to the
   * deck at z = 21, on a solid pier so it is a viaduct rather than a flight
   * of floating stairs. Walk up it by holding W and space, which is the same
   * thing every staircase in this world asks for.
   */
  for (let i = 0; i <= 6; i++) {
    const z = 27 - i
    b.box([4, -1, z], [10, i - 1, z], 'stone_bricks')      // the pier
    b.rect([5, z], [9, z], i, 'gray_concrete')             // the roadway
    b.set(4, i, z, ORANGE)
    b.set(10, i, z, ORANGE)
    if (i % 2 === 0) {
      b.set(4, i + 1, z, ORANGE)
      b.set(10, i + 1, z, ORANGE)
    }
  }
  b.set(5, 1, 27, 'sea_lantern')
  b.set(9, 1, 27, 'sea_lantern')
}

/*
 * The roadway: five blocks of grey between two orange stiffening trusses,
 * with a lantern let into the deck every six blocks so the walk is lit at
 * night. The trusses are the railing as well, which is why you cannot fall
 * off a bridge that is six blocks over water.
 */
function deck(b) {
  b.rect([5, 0], [9, 21], DECK_Y, 'gray_concrete')
  b.rect([7, 0], [7, 21], DECK_Y, 'light_gray_concrete')   // the centre line
  b.line([4, DECK_Y, 0], [4, DECK_Y, 21], ORANGE)
  b.line([10, DECK_Y, 0], [10, DECK_Y, 21], ORANGE)
  for (let z = 0; z <= 21; z += 2) {
    b.set(4, DECK_Y + 1, z, ORANGE)
    b.set(10, DECK_Y + 1, z, ORANGE)
  }
  for (let z = 3; z <= 21; z += 6) {
    b.set(5, DECK_Y, z, 'sea_lantern')
    b.set(9, DECK_Y, z, 'sea_lantern')
  }
}

/*
 * One tower: two legs straddling the roadway, three crossbeams, and a lamp
 * on top. Twenty-three blocks of orange out of the water, which makes it the
 * tallest thing on this side of the road and the thing you can see from four
 * stages away.
 *
 * Written at its own z so the two towers are one line each in goldenGate().
 */
function tower(t) {
  for (const x of [3, 4, 10, 11]) t.pillar(x, 0, -1, 22, ORANGE)
  for (const x of [3, 4, 10, 11]) t.pillar(x, 1, -1, 22, ORANGE)

  // The crossbeams. The lowest is under the deck, the other two are the
  // portal braces you see through as you drive under them.
  for (const y of [DECK_Y - 2, 12, 18, 22]) {
    t.box([3, y, 0], [11, y, 1], ORANGE)
  }
  /* NO CLEAR HERE, and that is worth saying out loud because the first
   * draft had one. The deck passes between the legs, so it looks like the
   * tower needs a hole cut in it -- and a clear() at DECK_Y took the
   * ROADWAY out instead, leaving a two-block gap in the bridge at each
   * tower. The legs are at x 3-4 and 10-11 and the roadway is x 5-9: they
   * never touch, and the crossbeams sit at y = 4, 12, 18 and 22, all of
   * them clear of a player walking at y = 7. Found by slicing the patch in
   * node, which is the only view that shows a hole in a floor.
   */
  t.set(3, 23, 0, 'sea_lantern')
  t.set(11, 23, 1, 'sea_lantern')
  t.set(4, 23, 1, 'orange_terracotta')
  t.set(10, 23, 0, 'orange_terracotta')
}

/*
 * The main cables and the suspenders.
 *
 * The cable is drawn as a column per z rather than as a line, because
 * cableY() steps by three blocks in the side spans and a one-block-per-z
 * cable would be a dotted line. Filling from this z's height down to the
 * next one's closes the gap and gives the cable the thickness a cable has.
 *
 * The suspenders hang from the cable to the deck in light grey -- a
 * different block from the cable on purpose, because at this scale the only
 * way to say "thinner" is to say "another colour".
 */
function cables(b) {
  for (const x of [3, 11]) {
    for (let z = 0; z <= 27; z++) {
      const y = cableY(z)
      const next = z < 27 ? cableY(z + 1) : y
      /* FILLED BETWEEN THIS z AND THE NEXT, not just to this z's height.
       * The side spans climb three blocks per block of z, so a cable one
       * block tall per column is a dotted line with two blocks of sky
       * between every pair of dots. Spanning the step is also what gives
       * the cable its thickness where it steepens, which is what a real one
       * looks like near a tower. */
      b.pillar(x, z, Math.min(y, next), Math.max(y, next), ORANGE)

      // The south anchorage: the cable does not stop in mid-air, it goes
      // into a block of masonry, and so does this one.
      if (z >= 22) b.pillar(x, z, -1, y - 1, 'stone_bricks')

      // No suspender inside a tower, and none where the cable is already
      // sitting on the deck.
      const inTower = TOWER_Z.some(tz => z >= tz - 1 && z <= tz + 2)
      if (!inTower && z <= 21 && y > DECK_Y + 2 && z % 2 === 1) {
        b.pillar(x, z, DECK_Y + 1, y - 1, 'light_gray_concrete')
      }
    }
  }
}

/* -------------------------------------------------------------- the cafe */

/*
 * THE CAFE, and the whole reason this stage ends where it ends.
 *
 * What he says he wants from visitors is people to trade stories with, and
 * strangers over coffee. So the last building before the hill is a coffee
 * shop with two chairs at every table and nobody in it, its door facing the
 * bridge ramp you just walked down.
 *
 * Written at its own north-west corner: (0, 0, 0) here is plot (11, 0, 22).
 */
function cafe(c) {
  const W = 5, D = 4      // x 0..5, z 0..4

  c.rect([-1, -1], [6, 5], -1, 'smooth_stone')             // the forecourt
  c.rect([0, 0], [W, D], -1, 'dark_oak_planks')
  c.hollow([0, 0, 0], [W, 4, D], {
    walls: 'white_concrete', ceiling: 'dark_oak_planks', inside: 'air',
  })
  c.hollow([0, 0, 0], [W, 0, D], { walls: 'bricks' })      // a skirt course

  /*
   * The front faces SOUTH, not west, and that was a correction rather than a
   * choice. West is where the visitor comes from and it is where the door
   * wanted to be -- but west of this wall is the bridge ramp's pier, five
   * blocks of solid masonry pressed against it, so the first draft's
   * shopfront opened onto a wall and the doorway was buried. South is the
   * other direction the visitor is coming from (spawn is three blocks past
   * z = 27) and it is open ground.
   *
   * Drawn rather than assembled, for the reason pattern() exists: this is a
   * shopfront and a shopfront is a picture.
   */
  c.pattern({
    at: [0, 0, D], plane: 'xy',
    legend: {
      '#': 'white_concrete', 'W': 'glass', 'D': 'dark_oak_planks',
      'B': 'bricks', '=': 'dark_oak_wood', 'o': 'brown_terracotta',
    },
    rows: [
      '======',
      '#WWWW#',
      '#WWoW#',
      '#WWDW#',
      'BBBDBB',
    ],
  })
  c.clear([3, 0, D], [3, 2, D])                            // the door is a hole

  // The awning over the pavement. Brown over white is as much cold brew as
  // three blocks can be, and it is the only sign this building needs.
  c.box([0, 4, D + 1], [W, 4, D + 1], 'brown_terracotta')
  c.set(1, 3, D, 'brown_terracotta')

  cafeInside(c, W, D)
  cellar(c.at(0, 0, 0, 'sf/piano'))

  // Two tables on the pavement, both laid for two. Nobody in a cafe in this
  // world has anybody with them yet; that is the point of the invitation.
  for (const x of [1, 4]) {
    c.set(x, 0, D + 1, 'dark_oak_planks')
    c.set(x, 1, D + 1, 'brown_terracotta')
    c.set(x - 1, 0, D + 1, 'spruce_planks')
    c.set(x + 1, 0, D + 1, 'spruce_planks')
  }

  roofDeck(c, W, D)
}

/** The counter, the machine, the shelf, and the four pennants -- Warriors
 *  blue and gold, Arsenal red and white, the Chiefs' red and gold, and
 *  Nebraska's red, which are the four things he watches. */
function cafeInside(c, W, D) {
  c.box([3, 0, 1], [3, 0, D - 1], 'polished_andesite')     // the counter
  c.set(3, 1, 2, 'brown_terracotta')                       // the urn
  c.set(4, 0, 1, 'barrel')
  c.set(4, 0, D - 1, 'blast_furnace')                      // the roaster
  c.set(2, 0, 1, 'spruce_planks')
  c.set(2, 0, 3, 'spruce_planks')

  // The pennants, in a row over the counter, and they are the only place on
  // this plot the four teams appear.
  c.set(W, 3, 1, 'blue_concrete')
  c.set(W, 2, 1, 'yellow_concrete')
  c.set(W, 3, 2, 'red_concrete')
  c.set(W, 2, 2, 'white_concrete')
  c.set(W, 3, 3, 'red_concrete')
  c.set(W, 2, 3, 'yellow_concrete')
  c.set(W, 3, 4, 'red_concrete')

  c.set(2, 4, 2, 'glowstone')
  c.set(4, 4, 3, 'glowstone')
}

/*
 * EASTER EGG, UNDER. The piano.
 *
 * He took a few years of piano, quit, and says he regrets it. So there is
 * one in the cellar with a sheet over it and the lid shut, and nothing on
 * the ground floor mentions it -- you find it because two floorboards behind
 * the counter are missing and the hole is dark.
 *
 * THE VERTICAL BUDGET IS FOUR BLOCKS, exactly as it is in Omaha's cellar:
 * grass at -1, dirt at -2 and -3, bedrock at -4. Two blocks of headroom and
 * no room for a stair, so the way down and the way back up are the same pair
 * of crates -- a 1x1 shaft is a trap, because from the cellar floor the
 * boards are three up and a jump is one.
 */
function cellar(p) {
  p.box([0, -4, 0], [5, -4, 4], 'stone')
  p.box([0, -3, 0], [5, -2, 4], 'air')
  p.box([0, -1, 0], [5, -1, 4], 'dark_oak_planks')
  p.hollow([0, -3, 0], [5, -2, 4], { walls: 'cobblestone' })

  p.set(3, -1, 1, 'air')                                   // the missing boards
  p.set(4, -1, 1, 'air')
  p.set(4, -3, 1, 'cobblestone')
  p.set(4, -2, 1, 'barrel')                                // step down, step up
  p.set(3, -3, 1, 'barrel')

  /*
   * The instrument. Black keys over white, a dark case, the lid closed, and
   * a dust sheet on the end of it. Five blocks of it, which is enough to be
   * unmistakably a keyboard and not enough to be furniture.
   */
  p.pattern({
    at: [1, -3, 3], plane: 'xz',
    legend: { '#': 'black_concrete', '.': 'white_concrete' },
    rows: ['#.#.#'],
  })
  p.box([1, -2, 3], [3, -2, 3], 'black_concrete')          // the closed lid
  p.set(4, -2, 3, 'white_wool')                            // the sheet
  p.set(1, -3, 2, 'spruce_planks')                         // the stool
  p.set(1, -2, 4, 'torch')
  p.set(4, -3, 3, 'bookshelf')                             // the music, still there
}

/*
 * EASTER EGG, ON TOP -- half of it. The cafe roof carries the second cold
 * brew and the bike that is missing from the dock, and it is reached in one
 * jump from the bridge ramp at z = 23, which is a block lower than the
 * parapet. Nothing points at it.
 */
function roofDeck(c, W, D) {
  c.rect([0, 0], [W, D], 5, 'dark_oak_planks')
  c.hollow([0, 5, 0], [W, 6, D], { walls: 'dark_oak_wood' })
  c.clear([1, 6, 1], [W - 1, 6, D - 1])
  c.set(2, 6, 2, 'brown_terracotta')                       // the cup
  c.set(4, 6, 1, 'black_concrete')                         // the bike that is out
  c.set(4, 6, 2, 'light_blue_concrete')
  c.set(1, 6, 3, 'sea_lantern')
}

/* ---------------------------------------------------------- the waterfront */

/*
 * The street between the water and the terrace: the seawall's landward face,
 * the tram stop, and the trees.
 *
 * x = 17 is the bay's east seal, so this rectangle is load-bearing in the
 * same way the promenade is -- see the water rule.
 */
function waterfront(s) {
  s.rect([17, 2], [17, 27], -1, 'stone_bricks')
  s.rect([17, 2], [17, 27], 0, 'stone_brick_slab')
  for (let z = 3; z <= 26; z += 4) s.set(17, 0, z, 'stone_bricks')

  s.rect([17, 26], [34, 27], -1, 'polished_andesite')       // the square

  for (const z of [6, 14, 22]) {
    s.pillar(17, z, 1, 2, 'polished_blackstone')
    s.set(17, 3, z, 'sea_lantern')
  }
}

/* --------------------------------------------------- the painted ladies */

/*
 * THREE PAINTED LADIES, in a terrace facing west across the water, which is
 * the view they are famous from.
 *
 * Eight blocks of frontage each, two storeys, a bay window and a gable --
 * which is the shortest description of the real thing that is still true.
 * One function, three calls, three colours; the alternative was three
 * near-identical sixty-line functions and one of them would have drifted.
 *
 * THE MIDDLE ONE IS EMPTY. He is looking for an apartment from January 2027,
 * so number 27 has bare boards, a stack of crates in the front room, a
 * letting board on the railing and a height mark on the door frame.
 */
function paintedLadies(s) {
  /* x = 19 AND NOT x = 18, which is a one-block move that fixes two things
   * at once: the stoops and the letting board hang two blocks west of the
   * front wall, and at x = 18 that put both of them in the bay. The seawall
   * is x = 17 and the water starts at x = 16. */
  lady(s.at(19, 0, 2, 'sf/lady-a'), { body: 'pink_concrete', trim: 'white_concrete', empty: false })
  lady(s.at(19, 0, 10, 'sf/lady-b'), { body: 'light_blue_concrete', trim: 'smooth_quartz', empty: true })
  lady(s.at(19, 0, 18, 'sf/lady-c'), { body: 'yellow_concrete', trim: 'white_concrete', empty: false })
}

function lady(h, { body, trim, empty }) {
  const W = 8, D = 7      // x 0..8 deep, z 0..7 of frontage

  h.rect([0, 0], [W, D], -1, 'spruce_planks')
  h.hollow([0, 0, 0], [W, 3, D], { walls: body, ceiling: 'spruce_planks', inside: 'air' })
  h.hollow([0, 4, 0], [W, 7, D], { walls: body, ceiling: 'spruce_planks', inside: 'air' })
  h.hollow([0, 0, 0], [W, 0, D], { walls: 'bricks' })      // the garage course
  for (const z of [0, D]) h.pillar(0, z, 0, 7, trim)

  /*
   * The front, facing the bay. Drawn top row first, so the source has the
   * same orientation the wall does -- gable, two storeys of sash windows,
   * the bay window in the middle and a door under it.
   */
  h.pattern({
    at: [0, 0, 0], plane: 'zy',
    legend: {
      '#': body, 'T': trim, 'W': 'glass', 'D': 'dark_oak_planks',
      'B': 'bricks', 'L': 'glowstone',
    },
    rows: [
      'TTTTTTTT',
      '#WW##WW#',
      '#WW##WW#',
      'TTTTTTTT',
      '#WWTLTW#',
      '#WWT.TW#',
      '#WWTDTW#',
      'BBBBDBBB',
    ],
  })
  h.clear([0, 0, 4], [0, 2, 4])                            // the doorway
  h.box([-1, 0, 3], [-1, 3, 5], trim)                      // the bay window box
  h.box([-1, 1, 3], [-1, 2, 5], 'glass')
  h.clear([-1, 0, 4], [-1, 2, 4])
  h.set(-1, 4, 4, trim)

  // The stoop, the railing and the little front garden, which is the other
  // half of what makes a terrace a terrace.
  h.rect([-2, 2], [-1, 6], -1, 'smooth_stone')
  h.set(-2, 0, 2, trim)
  h.set(-2, 0, 6, trim)

  // Windows on the sides and the back, because a house with glass on one
  // face is a film set the moment you walk round it.
  for (const z of [2, 5]) {
    h.box([W, 1, z], [W, 2, z], 'glass')
    h.box([W, 5, z], [W, 6, z], 'glass')
  }
  for (const x of [3, 6]) {
    h.box([x, 1, 0], [x, 2, 0], 'glass')
    h.box([x, 5, 0], [x, 6, 0], 'glass')
  }

  gable(h, W, D, trim)
  h.clear([1, 4, 1], [3, 4, 2])                            // the stairwell hole
  for (let i = 0; i <= 3; i++) h.box([1 + i, 0, 1], [1 + i, i, 1], 'spruce_planks')

  if (empty) emptyFlat(h, W, D, trim)
  else livedIn(h, W, D)
}

/** Five stepped courses, ridge running east-west, eaves overhanging by one.
 *  The overhang is the cheapest single thing that stops a voxel house
 *  looking like a box with a triangle on it. */
function gable(h, W, D, trim) {
  /* Four courses and NO OVERHANG IN z. The eaves still overhang in x, which
   * is the cheapest single thing that stops a voxel house looking like a box
   * with a triangle on it -- but this is a TERRACE, the houses are eight
   * apart and eight wide, and a roof that hangs a block into its neighbour
   * gets overwritten by whichever house is built second. */
  const courses = [[0, D], [1, D - 1], [2, D - 2], [3, D - 3]]
  courses.forEach(([z0, z1], i) => h.box([-1, 8 + i, z0], [W + 1, 8 + i, z1], trim))
  courses.forEach((_, i) => {
    const above = courses[i + 1]
    if (!above || above[0] + 1 > above[1] - 1) return
    h.box([0, 8 + i, above[0] + 1], [W, 8 + i, above[1] - 1], 'air')
  })
  h.box([0, 8, 3], [0, 8, 4], 'glass')                     // the gable window
}

/** A furnished flat: a kitchen along the back, a couch and a hearth
 *  downstairs, two beds up. Bedrooms are told apart by the bedding and by
 *  nothing else, which is as much as a voxel bedroom can honestly claim. */
function livedIn(h, W, D) {
  h.box([W - 1, 0, 1], [W - 1, 0, 4], 'polished_andesite')
  h.set(W - 1, 0, 2, 'furnace')
  h.set(W - 1, 0, 4, 'barrel')
  h.set(W - 2, 0, 6, 'crafting_table')
  h.box([4, 0, 6], [6, 0, 6], 'red_concrete')              // the couch
  h.box([2, 0, 6], [2, 1, 6], 'bricks')
  h.set(2, 1, 6, 'magma_block')                            // a fire that glows
  h.box([6, 0, 1], [6, 1, 1], 'bookshelf')

  h.box([2, 5, 2], [3, 5, 4], 'white_wool')
  h.box([2, 5, 2], [3, 5, 2], 'blue_concrete')
  h.box([6, 5, 4], [7, 5, 6], 'white_wool')
  h.box([6, 5, 4], [7, 5, 4], 'green_concrete')
  h.set(5, 5, 2, 'bookshelf')

  h.set(4, 3, 3, 'glowstone')
  h.set(4, 7, 4, 'glowstone')
  h.set(7, 3, 5, 'glowstone')
}

/*
 * NUMBER 27, and it is the only empty building in this world.
 *
 * Looking for an apartment from January 2027. So the boards are bare, the
 * crates are still stacked in the front room, and the number on the railing
 * is 27 -- which is the house number and is also the day in August he was
 * born. The only other thing in here is the height mark on the door frame at
 * six foot two: 6'2" is 1.88 m, which in a world where a block is a metre
 * and the player is 1.8 tall is the mark just above your own eyes.
 */
function emptyFlat(h, W, D, trim) {
  h.set(3, 0, 3, 'barrel')                                 // the crates
  h.set(3, 1, 3, 'barrel')
  h.set(4, 0, 3, 'barrel')
  h.set(3, 0, 4, 'crafting_table')

  // The height mark, on the jamb, two blocks up -- head height on a 1.8-block
  // player and therefore exactly the joke.
  h.set(1, 2, 3, 'red_concrete')

  h.set(4, 3, 4, 'glowstone')
  h.set(4, 7, 4, 'glowstone')

  /*
   * The letting board, on the street edge, facing west across the water --
   * which is the direction the road is and therefore the only direction a
   * sign on this plot is worth facing.
   *
   * The numerals are written INTO the panel rather than a block proud of it.
   * Proud is how a real projecting sign works and it is what the first draft
   * did; one block west of x = 17 is the bay, so it hung the number over open
   * water on nothing.
   */
  h.pillar(-2, 1, 0, 2, 'dark_oak_wood')
  h.pillar(-2, 7, 0, 2, 'dark_oak_wood')
  h.box([-2, 3, 1], [-2, 9, 7], 'white_concrete')
  h.box([-2, 3, 1], [-2, 3, 7], trim)
  write(h, '27', { at: [-2, 5, 2], plane: 'zy', colour: 'red_concrete' })
  h.set(-2, 10, 4, 'sea_lantern')
}

/* -------------------------------------------------------- the hill street */

/*
 * The street up the hill, the cable car on it, and the court.
 *
 * THE SLOT BETWEEN THE RAILS IS THE POINT. San Francisco's cable cars have
 * no engine; the cable runs in a channel under the street and the car grips
 * it through a slot you can see from the pavement. A voxel tram with two
 * rails is any tram anywhere. Two rails and a dark line between them is that
 * city's tram and nowhere else's.
 */
function hillStreet(s) {
  s.rect([28, 9], [34, 13], -1, 'polished_andesite')
  s.line([28, -1, 10], [34, -1, 10], 'light_gray_concrete')   // the rails
  s.line([28, -1, 12], [34, -1, 12], 'light_gray_concrete')
  s.line([28, -1, 11], [34, -1, 11], 'polished_blackstone')   // the slot

  cableCar(s.at(28, 0, 9, 'sf/cablecar'))
  court(s.at(28, 0, 2, 'sf/court'))
  park(s)
}

/** One car: maroon body, cream roof, open sides, a bench down the middle and
 *  a headlamp. Four by five, which at this scale is a whole tram. */
function cableCar(t) {
  t.box([0, 0, 1], [4, 0, 3], 'dark_oak_planks')           // the floor
  t.box([0, 1, 1], [0, 2, 3], 'red_concrete')              // the two ends
  t.box([4, 1, 1], [4, 2, 3], 'red_concrete')
  t.box([1, 2, 1], [3, 2, 1], 'red_concrete')              // the waist rails
  t.box([1, 2, 3], [3, 2, 3], 'red_concrete')
  t.box([0, 3, 1], [4, 3, 3], 'smooth_quartz')             // the roof
  t.box([1, 1, 2], [3, 1, 2], 'spruce_planks')             // the bench
  t.set(0, 1, 2, 'glowstone')                              // the headlamp
  t.set(2, 4, 2, 'white_concrete')
}

/*
 * The Warriors, in blue and gold, because his father is from the Bay Area.
 * Half a court and a hoop, which is the only part of a basketball court
 * anybody actually uses.
 */
function court(k) {
  k.rect([0, 0], [6, 5], -1, 'blue_concrete')
  k.rect([0, 0], [6, 0], -1, 'yellow_concrete')
  k.rect([0, 5], [6, 5], -1, 'yellow_concrete')
  k.rect([3, 1], [3, 4], -1, 'yellow_concrete')
  k.pillar(6, 2, 0, 3, 'polished_blackstone')
  k.box([6, 4, 1], [6, 4, 3], 'white_concrete')            // the backboard
  k.box([5, 3, 2], [5, 3, 2], 'yellow_concrete')           // the hoop
  k.set(0, 0, 0, 'yellow_concrete')
  k.set(0, 1, 0, 'blue_concrete')                          // the ball, left out
}

/*
 * The park between the terrace and the hill: cypresses, a bench, and the
 * trailhead sign. Looking forward to hiking is a fact about a person who
 * does not have the hill yet, so the walk up it starts here.
 */
function park(s) {
  for (const [x, z] of [[29, 16], [32, 19], [30, 23], [33, 15], [29, 20]]) {
    cypress(s.at(x, 0, z, 'sf/tree'))
  }
  s.rect([28, 25], [34, 27], -1, 'coarse_dirt')
  s.box([31, 0, 26], [33, 0, 26], 'spruce_planks')         // the bench
  s.pillar(30, 26, 0, 2, 'dark_oak_wood')
  s.set(30, 3, 26, 'green_concrete')                       // the trail blaze
  s.set(30, 2, 26, 'white_concrete')
}

/** A Monterey cypress: a bare trunk and a flat crown, which is what the wind
 *  off the Pacific does to every tree on that coast. */
function cypress(t) {
  t.pillar(0, 0, -1, 0, 'podzol')
  t.pillar(0, 0, 0, 4, 'spruce_log')
  t.box([-2, 5, -2], [2, 5, 2], 'spruce_leaves')
  t.box([-1, 6, -1], [1, 6, 1], 'spruce_leaves')
  t.box([-1, 4, -1], [1, 4, 1], 'spruce_leaves')
  t.clear([0, 4, 0], [0, 4, 0])
}

/* ----------------------------------------------------------- twin peaks */

/*
 * THE BLUFF, and the two ways up it.
 *
 * A solid stone mass from x = 49 to x = 53, sheer on its west face and
 * fifteen blocks tall, with SAY HI cut into it in letters five blocks high
 * facing back down the road. It is the last thing on the timeline and the
 * only writing in this world that is a sentence.
 *
 * THE POINT OF THE TWO ROUTES. The owner asked for parkour and most people
 * who open this site have never played Minecraft, so the summit has a graded
 * trail up the east flank -- one block of rise per two blocks of walk,
 * signposted, lit -- and the jumps over the water are an alternative nobody
 * is required to take. A hard course nobody finishes is worse than an easy
 * one everybody does; a course with a walkable bypass is better than either,
 * because then finishing it means something and skipping it costs nothing.
 */
const SUMMIT_Y = 13            // the top of the bluff: you stand at 14
const BLUFF_X = [49, 53]

function twinPeaks(s) {
  s.box([BLUFF_X[0], -1, 1], [BLUFF_X[1], SUMMIT_Y, 25], 'stone')

  // Weathering, so fifteen blocks of one grey does not read as a wall. The
  // pattern is arbitrary and deterministic on purpose -- a hash of the
  // coordinates rather than Math.random, because a world that generates a
  // different bluff on every load is a world no screenshot describes.
  for (let z = 1; z <= 25; z++) {
    for (let x = BLUFF_X[0]; x <= BLUFF_X[1]; x++) {
      for (let y = 0; y <= SUMMIT_Y; y++) {
        if ((x * 7 + z * 13 + y * 29) % 11 === 0) s.set(x, y, z, 'andesite')
        else if ((x * 5 + z * 3 + y * 17) % 23 === 0) s.set(x, y, z, 'cobblestone')
      }
    }
  }
  s.rect([BLUFF_X[0], 1], [BLUFF_X[1], 25], SUMMIT_Y, 'grass')

  /*
   * SAY HI, on the sheer face, in white on grey, at the height of the bridge
   * deck so it is read from the bridge and from the road rather than from
   * directly underneath. Twenty-three blocks wide, which is what fits
   * between z = 2 and z = 24 and is why the message is two words long.
   *
   * Homage to South San Francisco, which has had its name in white letters
   * on the hillside above the freeway since 1923.
   */
  write(s, 'SAY HI', {
    at: [BLUFF_X[0], 7, 2], plane: 'zy', colour: 'white_concrete',
  })

  trail(s)
  summit(s.at(BLUFF_X[0], SUMMIT_Y + 1, 14, 'sf/summit'))
  tunnel(s.at(BLUFF_X[0], 0, 5, 'sf/jollyboys'))
}

/*
 * The graded trail, up the east flank.
 *
 * ONE BLOCK OF RISE PER TWO BLOCKS OF WALK, which is the gentlest climb a
 * voxel world can express: every second step is flat, so it reads as a path
 * rather than as a ladder, and a visitor who has never jumped in a browser
 * gets a run-up before each step. Twenty-eight blocks of z buys fourteen of
 * height, which is exactly the bluff.
 */
function trail(s) {
  for (let z = 27; z >= 0; z--) {
    const h = Math.min(SUMMIT_Y, Math.ceil((26 - z) / 2))
    s.box([54, -1, z], [55, h, z], 'stone')
    s.rect([54, z], [55, z], h, 'coarse_dirt')
    if (z % 6 === 3) {
      s.set(55, h + 1, z, 'polished_blackstone')
      s.set(55, h + 2, z, 'sea_lantern')
    }
  }
  // The last step onto the summit, and the trailhead marker at the bottom.
  s.box([53, SUMMIT_Y, 0], [55, SUMMIT_Y, 2], 'stone')
  s.rect([53, 0], [55, 2], SUMMIT_Y, 'grass')
  s.pillar(54, 27, 0, 2, 'dark_oak_wood')
  s.set(54, 3, 27, 'green_concrete')
  s.set(54, 2, 27, 'white_concrete')
}

/*
 * THE SUMMIT, and the end of the road.
 *
 * Two chairs, two cups, one table, and neither cup is marked. That is the
 * whole invitation and it is the reason this stage is last: what he says he
 * wants is people to trade stories with and strangers over coffee, and says
 * to reach out. A wall of text would have said it worse.
 *
 * Written at the bluff's north-west corner plus one, so the deck sits on the
 * grass rather than in it.
 */
function summit(v) {
  v.box([0, -1, 0], [4, -1, 8], 'polished_andesite')       // the paved viewpoint
  /*
   * THE WEST PARAPET STOPS SHORT, and it is the single most breakable thing
   * on this plot. The parkour's last jump arrives on this edge at z = 5..7,
   * and a slab there is half a block: the jump would be a rise of 1.5
   * against an apex of MC.JUMP_APEX = 1.2522 and the course would end one
   * block short of its own summit, forever, with nothing to show why.
   */
  v.box([0, 0, 0], [0, 0, 2], 'stone_brick_slab')          // the parapet, west
  v.box([0, 0, 8], [0, 0, 8], 'stone_brick_slab')
  v.box([0, 0, 0], [4, 0, 0], 'stone_brick_slab')
  v.box([0, 0, 8], [4, 0, 8], 'stone_brick_slab')

  // The table, laid for two, facing the view back down the timeline.
  v.set(2, 0, 4, 'dark_oak_planks')
  v.set(2, 1, 4, 'dark_oak_planks')
  v.set(2, 2, 4, 'brown_terracotta')                       // his
  v.set(3, 1, 4, 'brown_terracotta')                       // and the other one
  v.set(1, 0, 4, 'spruce_planks')                          // two chairs
  v.set(3, 0, 4, 'spruce_planks')
  v.set(1, 1, 4, 'spruce_planks')

  for (const z of [1, 7]) {
    v.pillar(4, z, 0, 2, 'polished_blackstone')
    v.set(4, 3, z, 'sea_lantern')
  }
  v.set(2, 0, 1, 'sea_lantern')
  v.set(2, 0, 7, 'sea_lantern')

  // The mast, so the summit is visible from the road over everything else.
  v.pillar(3, 2, 0, 5, 'polished_blackstone')
  v.set(3, 6, 2, 'sea_lantern')
  v.set(2, 5, 2, 'orange_concrete')
  v.set(2, 4, 2, 'white_concrete')
}

/*
 * EASTER EGG, BEHIND. The tunnel into the bluff.
 *
 * Its mouth is at the waterline on the far side of the pool -- two blocks
 * high, at y = 0, a block ABOVE the surface, which is not decoration: an
 * opening at water level would give the pool a hole to pour through and the
 * whole bluff would drain into the plot next door. See the water rule.
 *
 * Twenty blocks in, on the back wall, JOLLY BOYS. He has played Minecraft
 * since 2011 and that is the name he has played under.
 */
function tunnel(t) {
  t.box([1, 0, 0], [3, 11, 20], 'air')                     // the gallery
  /* The mouth is at z = 18..19 IN PLOT TERMS -- out over the pool, so the
   * only way in is to swim the whole width of the parkour and climb a block
   * out of the water. It started at z = 8, which is dry land you can stroll
   * to, and an easter egg you can stroll to is a doorway. */
  t.box([0, 0, 13], [0, 2, 14], 'air')                     // the mouth
  t.rect([1, 0], [3, 20], -1, 'polished_andesite')
  for (let z = 2; z <= 18; z += 4) t.set(2, 11, z, 'sea_lantern')

  // The back wall faces the way in, so the name is the thing you are looking
  // at from the moment you are inside.
  write(t, 'JOLLY', { at: [4, 6, 1], plane: 'zy', colour: 'gold_block' })
  write(t, 'BOYS', { at: [4, 0, 3], plane: 'zy', colour: 'gold_block' })
  t.set(1, 0, 19, 'crafting_table')
  t.set(3, 0, 19, 'barrel')
}

/* ----------------------------------------------------------- the parkour */

/*
 * THE COURSE. Twelve jumps over water, and every one of them is flat.
 *
 * ------------------------------------------------------------------------
 * THE JUMP IS THE WHOLE DESIGN, AND THE FIRST TWO VERSIONS OF IT WERE WRONG.
 *
 * The obvious course is the standard Minecraft one: two air blocks across
 * and one block up, thirteen times. It is not hard, it is not a timing, and
 * it does not work here -- because it requires you to be SPRINTING, and most
 * people who open this website will never press the sprint key.
 *
 * The arithmetic, out of src/physics.js. A jump leaves the ground at the
 * speed that gives MC.JUMP_APEX = 1.2522 blocks, which against GRAVITY = 32
 * is 8.952 b/s, and y(t) = 8.952t - 16t^2. So the player is a block or more
 * above their take-off only between t = 0.154 s and t = 0.405 s. Clearing
 * two air blocks needs 1.7 blocks of travel (the gap, less half the player's
 * 0.6-wide box). At MC.WALK_SPEED = 4.317 b/s, 0.405 s buys 1.75 blocks
 * before air drag, about 1.65 after. It is short, and short by a margin no
 * player can feel or fix.
 *
 * MEASURED, NOT ARGUED. test/71-parkour.spec.js drove a player at the first
 * version of this course holding W and Space and it landed IN THE WATER at
 * (37.5, 21.9), which is dead centre on the next platform's footprint and
 * three blocks below its surface: the arc was right and the height was not.
 * Sprinting fixes it -- MC.SPRINT_SPEED + MC.SPRINT_JUMP_BOOST is 9.612 b/s
 * and buys three and a half blocks -- and "hold Ctrl as well" is not a thing
 * a jumping course is allowed to require without saying so.
 *
 * SO THE CLIMB MOVED OFF THE JUMP AND ONTO THE PLATFORM. Every platform is
 * a PAD and a STEP: you land on the pad at height n, walk up the one-block
 * step at its far end to n + 1, and jump from there to the next pad, which
 * is also at n + 1. Every jump is dead level; the course still climbs a
 * block per platform, because the step does the climbing.
 *
 * AND THE GAP IS ONE AIR BLOCK, NOT TWO, WHICH THE SECOND RUN OF THE SPEC
 * TAUGHT ME. The step is one block deep, so you climb onto it and you are
 * already standing on its far edge -- there is no run-up left, and the jump
 * off it is a STANDING jump whatever you were doing before. A standing jump
 * carries about 1.25 blocks; two air blocks need 1.7. Measured: the driver
 * left platform 0's step and landed at (37.4, 20.0), dead centre on the next
 * pad's footprint and three blocks under it. One air block needs 0.7, which
 * the same standing jump clears with most of a block in hand -- and a player
 * who arrives sprinting clears it without noticing.
 *
 * It is a short jump. It is still a jump: you cannot walk across a one-block
 * gap in Minecraft, and there are twelve of them over open water fourteen
 * blocks up. A visitor who has never played this game can finish it, which
 * is the only specification that mattered.
 *
 * It buys three more things for free:
 *
 *   - THE STEP IS A BACKSTOP. A player who sprints -- and sprinting still
 *     works, it just is not required -- overshoots the pad and hits the step
 *     instead of sailing off the far side. The course is now easier the
 *     faster you go, which is the opposite of the usual failure.
 *   - IT READS. A one-block riser at the end of every platform is a visible
 *     instruction to keep going up, where thirteen identical squares at
 *     thirteen different heights is a puzzle.
 *   - THE LAST MOVE IS A STEP, NOT A LEAP OF FAITH. The course arrives on a
 *     ledge cut into the bluff and climbs one block onto the summit.
 *
 * WHAT HAPPENS WHEN YOU FALL, which is the question that decides whether
 * this is playable at all. The whole course stands over a pool three blocks
 * deep, and src/fluids.js calls survival.clearFallTracking() on every tick
 * your feet are in water -- vanilla's resetFallDistance, which cancels fall
 * damage OUTRIGHT rather than reducing it. A miss from the last platform is
 * a thirteen-block drop that costs nothing but the swim back, and the spec
 * asserts exactly that by dropping a player off the top. The pool runs a
 * block past the course on every side so that a badly aimed jump cannot
 * find the edge of it.
 *
 * That matters more here than anywhere else in this world: respawn is at the
 * south end of the road, a hundred blocks and eight stages away, so a death
 * on this course throws a visitor out of the whole thing.
 *
 * REJECTED -- a course that climbs the bridge cables, which is the obvious
 * thing to do with a suspension bridge and a good deal prettier. The cable
 * is a one-block-per-z diagonal over paving, so every miss is a six-block
 * drop onto concrete, and the only fix is to put water under the road.
 * Scenery you can fall off is not the same thing as a course.
 * ------------------------------------------------------------------------
 *
 * The route is a spiral: north up the west side, east along the top, south
 * down the east side, west along the bottom, then north and east again on
 * the inside, and out onto the bluff.
 *
 * Platform n's pad is at y = n and its step at y = n + 1, so this list is
 * also the height profile. Both are given as footprints because the widths
 * are not all the same -- a platform is three blocks wide across the
 * direction you are running, which buys a block of lateral slop for
 * somebody whose aim drifts.
 */
const ROUTE = [
  //     the pad, at y = n          the step, at y = n + 1
  { pad: [37, 24, 38, 25], step: [37, 23, 38, 23] },   //  0  north, up the west side
  { pad: [36, 20, 38, 21], step: [36, 19, 38, 19] },   //  1
  { pad: [36, 16, 38, 17], step: [36, 15, 38, 15] },   //  2
  { pad: [36, 12, 37, 13], step: [38, 12, 38, 13] },   //  3  turn east
  { pad: [40, 12, 41, 14], step: [42, 12, 42, 14] },   //  4  east along the north side
  { pad: [44, 12, 46, 13], step: [44, 14, 46, 14] },   //  5  turn south
  { pad: [44, 16, 46, 17], step: [44, 18, 46, 18] },   //  6  south, down the east side
  { pad: [44, 20, 46, 21], step: [44, 22, 46, 22] },   //  7
  { pad: [44, 24, 46, 25], step: [43, 24, 43, 25] },   //  8  turn west
  { pad: [40, 24, 41, 25], step: [40, 23, 41, 23] },   //  9  turn north
  { pad: [40, 20, 42, 21], step: [43, 20, 43, 21] },   // 10  turn east, one ring in
  { pad: [45, 19, 46, 21], step: [47, 19, 47, 21] },   // 11  and off onto the bluff
]

/** Where the last jump lands: a notch cut into the bluff's west face, one
 *  block below the summit, at the height platform 11's step leaves you at --
 *  y = 12, so its surface is y = 13 and so is the step's, and the last jump
 *  of the course is as level as the eleven before it. */
const LEDGE = { x: 49, y: 12, z: [19, 21] }

function parkour(s) {
  pool(s)
  apron(s)

  ROUTE.forEach(({ pad, step }, n) => {
    s.box([pad[0], n, pad[1]], [pad[2], n, pad[3]], 'smooth_quartz')
    /* The step is a different block from the pad on purpose. It is the one
     * piece of instruction the course gives -- "the way on is UP" -- and a
     * riser in the same white as the floor it rises out of is a riser
     * nobody sees until they walk into it. */
    s.box([step[0], n + 1, step[1]], [step[2], n + 1, step[3]], 'orange_concrete')

    /* A lantern let into the far corner of every pad. Two jobs: block light
     * shipped today and an unlit jump is an unfair jump, and a lit square is
     * the only signposting a route over open water can have. */
    s.set(pad[2], n, pad[3], 'sea_lantern')
  })

  ledge(s)
}

/*
 * THE APRON, AND IT IS FLAT AND FIVE BLOCKS LONG ON PURPOSE.
 *
 * The first draft started you on a one-block plinth, which made the first
 * jump of the course a STANDING jump from a standstill. The launch pad of a
 * jumping course has to be a run-up, so this is painted onto the ground at
 * y = -1 and you arrive on it already walking.
 *
 * Orange because by the time a visitor reaches it this stage has spent a
 * whole bridge teaching them that orange is the thing you walk on -- and
 * because it is the same orange as the steps, which is the only hint the
 * course gives about what to aim for.
 */
function apron(s) {
  s.rect([31, 24], [35, 26], -1, 'orange_concrete')
  s.pillar(32, 23, 0, 2, 'polished_blackstone')
  s.set(32, 3, 23, 'orange_concrete')
  s.set(32, 2, 23, 'white_concrete')
  /* The lantern is at the BACK of the apron, not the middle of it. In the
   * middle it stands in the one square metre of this plot a player is most
   * likely to be standing in, and a player inside a block is squeezed out
   * sideways -- which here means into the pool, before the course starts. */
  s.set(31, 0, 24, 'sea_lantern')
}

/*
 * The finish: a notch cut into the bluff at the height the last step leaves
 * you at, and one block up onto the summit.
 *
 * Carved rather than built, and carved AFTER twinPeaks() has run -- the
 * bluff is solid stone from y = -1 to SUMMIT_Y and the summit's paving is
 * already on top of it, so the ledge is three columns of that stone taken
 * back out. A landing you have to jump UP onto is the one thing this course
 * has spent eighty lines avoiding.
 */
function ledge(s) {
  s.box([LEDGE.x, LEDGE.y + 1, LEDGE.z[0]], [LEDGE.x, SUMMIT_Y, LEDGE.z[1]], 'air')
  s.box([LEDGE.x, LEDGE.y, LEDGE.z[0]], [LEDGE.x, LEDGE.y, LEDGE.z[1]], 'polished_andesite')
  s.set(LEDGE.x, LEDGE.y, LEDGE.z[0], 'sea_lantern')
  s.set(LEDGE.x, LEDGE.y, LEDGE.z[1], 'sea_lantern')
  // ...and the one step from the ledge onto the summit paving, in the same
  // orange every other step on the course is, so the last one reads too.
  s.box([LEDGE.x + 1, SUMMIT_Y, LEDGE.z[0]], [LEDGE.x + 1, SUMMIT_Y, LEDGE.z[1]], 'orange_concrete')
}

/*
 * The pool. Three blocks deep, sealed on every side, and it is the only
 * reason the course above it is fair.
 *
 * Dug from y = -3 to y = -1 -- grass, then both courses of dirt, with the
 * bedrock at -4 as its floor. Three blocks is not aesthetic: the player
 * arrives from thirteen blocks up at about twenty-nine blocks a second,
 * which is one block per engine tick, and the fall-damage cancel in
 * src/fluids.js fires on a tick whose feet are wet. One block of water is a
 * coin flip. Three is not.
 *
 * SEALED: x = 35 and x = 49 (the bluff) either side, z = 11 and z = 27 north
 * and south, all of them untouched ground at every level the water fills.
 * It reaches z = 12 rather than z = 13 because three platforms do -- the
 * north side of the ring overhangs by a block -- and water has to be under
 * all of it, or that block is the one place on the course where a miss hurts.
 */
function pool(s) {
  s.box([36, -3, 12], [48, -1, 26], 'water')
  s.rect([35, 11], [49, 11], -1, 'stone_bricks')
  s.rect([35, 27], [49, 27], -1, 'stone_bricks')
  s.rect([35, 12], [35, 26], -1, 'stone_bricks')

  // Something to look at on the bottom, for whoever swims down: an anchor
  // chain and a lantern under three blocks of water.
  s.set(42, -3, 20, 'iron_block')
  s.set(42, -3, 21, 'iron_block')
  s.set(41, -3, 20, 'sea_lantern')
}
