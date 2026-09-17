/*
 * STAGE 4 -- ARIZE, 2023. The work nobody can see his name on.
 *
 * ------------------------------------------------------------------------
 * WHAT IS HERE, AND WHY IT IS HERE. Everything below is from the owner's own
 * record. Nothing factual is invented; the licence is in how a fact is DRAWN.
 *
 *   the monitor wall on       Arize is an ML observability company. The thing
 *     the road                you look at is a dashboard, so the thing on the
 *                             road is a dashboard: latency, an eval grid, and
 *                             a trace glyph over the door, lit from inside.
 *   the control room          traces, spans, evals. The flame graph on the
 *                             north wall is the shape the whole industry
 *                             draws when it says "observability".
 *   the pipeline you walk     he ghost-wrote on RAG and agent observability,
 *     through                 which is a pipeline -- retrieve, generate,
 *                             evaluate, ship -- so it is a corridor with four
 *                             gates and the span bars running overhead as you
 *                             walk under them.
 *   the study at the far end  where the writing actually happened, and the
 *                             only warm room on the plot. Wood, not stone.
 *   the pages with a hole     GHOST-WRITING IS INVISIBLE AUTHORSHIP. The
 *     in the byline           articles are on the board, finished and
 *                             published, and the one block where the name
 *                             goes is missing from every one of them. You can
 *                             see the archive through the gaps.
 *   the figure at the desk    white stained glass, lit from the floorboards
 *                             up. Somebody is sitting there. You can see
 *                             straight through him.
 *   the mailbox at the kerb   HE GOT THE JOB BY COLD-DMING THE CPO, Aparna
 *     and the screen on       Dhinakaran, a clarifying question about a
 *     the roof                YouTube video of hers. So the roof carries a
 *                             play button and a question mark, and the kerb
 *                             carries the same mailbox stage 1 has. Cold
 *                             outreach is a METHOD here, not an accident --
 *                             stage 3 is the identical move -- and quoting
 *                             stage 1's object is how a build says "again".
 *   the drift field           the yard out back is a chart you walk into:
 *                             posts at a baseline that wander off it and go
 *                             red. Drift is the thing the dashboards watch.
 *
 * THE EASTER EGG, and it is the point of the build rather than a joke in the
 * corner:
 *
 *   UNDER   the archive floor, through two missing boards behind the
 *           bookshelves, there is a cellar with the DRAFTS in it -- and the
 *           page down there is the same page as the one upstairs with the
 *           byline filled in in gold. The name exists. It is underground.
 *   ON TOP  the control room roof, up the server racks stacked against its
 *           south wall: a play button, a question mark, and one envelope.
 *           The whole job, in three objects, on a roof nobody has to climb.
 *
 * ------------------------------------------------------------------------
 * TWO COLUMNS OF THIS PLOT BELONG TO THE TEST SUITE AND TO THE GUIDE, and
 * this file is the reason they moved rather than the reason they broke.
 *
 * AI Evan used to stand at world (-4.5, 0.5), which is patch (82, 56), which
 * is the middle of this room. He now stands three blocks up the road from
 * spawn, where a guide belongs (EVAN_XZ in src/main.js). The suite's drop
 * column went the same way, out into the margin (DROP_X in
 * test/helpers/world.js).
 *
 * WHAT IS STILL OWED TO THE SUITE, and it is designed in rather than left to
 * luck: a dozen specs teleport to world (0.5, y, 0.5) and its neighbours --
 * the old spawn, and now local (19, 22) of this plot -- to stand on flat
 * ground under open sky. So the south-centre of this plot, roughly local
 * x 12..31 by z 17..27, IS DELIBERATELY EMPTY. It is the yard. Nothing is
 * built there, nothing roofs it, and the drift field starts east of it.
 * ------------------------------------------------------------------------
 * ORIENTATION. 56 wide (local x 0..55), 28 deep (z 0..27). This is a RIGHT
 * plot, so the road is at local x = 0 and everything legible faces WEST:
 * the dashboard facade, the mailbox, the mast. The plot reads back to front
 * as you go east -- the wall you can see from the road, the room behind it,
 * the pipeline behind that, and the writer at the far end of it, which is
 * the order the credit runs in too.
 */

/*
 * ONE PALETTE NOTE, because the next person will reach for it too.
 * `lime_concrete` is not used anywhere below, and it is not for want of
 * trying: in today's build a lime_concrete block RENDERS AS A SMITHING
 * TABLE. The atlas layer it points at is green (atlas2.png, layer 5) and the
 * material data is right, so the fault is somewhere between the registry and
 * the mesher rather than in the texture -- found by placing one with
 * noa.setBlock and looking at it, which is the only way it can be found.
 * `green_concrete` draws correctly and says the same thing.
 */
export function build(s) {
  forecourt(s)
  controlRoom(s.at(2, 0, 2, 'arize/control'))
  ingestRacks(s.at(24, 0, 2, 'arize/racks'))
  traceCorridor(s.at(23, 0, 7, 'arize/trace'))
  study(s.at(39, 0, 4, 'arize/study'))
  drafts(s.at(39, 0, 4, 'arize/drafts'))
  coldStore(s.at(40, 0, 0, 'arize/cold'))
  bylineWall(s.at(54, 0, 0, 'arize/gallery'))
  driftField(s)
}

/* ---------------------------------------------------------------- ground */

/*
 * The kerbside. A paved strip down the road edge, a walk to the front door,
 * and the mailbox.
 *
 * Paving goes at y = -1, replacing the grass, for the reason road.js gives:
 * a path you step up onto is a path you trip over, and the whole world keeps
 * one floor height.
 */
function forecourt(s) {
  s.rect([0, 0], [1, 27], -1, 'polished_andesite')          // the kerbside strip
  s.rect([0, 7], [1, 11], -1, 'smooth_quartz')              // the entrance apron
  s.rect([2, 8], [2, 10], -1, 'smooth_quartz')
  s.rect([2, 0], [33, 1], -1, 'polished_deepslate')         // the north yard
  s.rect([2, 17], [11, 27], -1, 'polished_deepslate')       // the south yard, west half
  s.rect([23, 13], [38, 16], -1, 'polished_deepslate')      // between corridor and yard
  s.rect([34, 16], [55, 17], -1, 'polished_deepslate')      // the drift field's kerb

  // Two lamps either side of the door, because the facade is a screen and a
  // screen with nothing lighting the ground in front of it is a television.
  for (const z of [6, 12]) {
    s.pillar(1, z, 0, 2, 'polished_blackstone')
    s.set(1, 3, z, 'sea_lantern')
  }

  /*
   * THE MAILBOX, and it is stage 1's mailbox on purpose.
   *
   * Omaha has one with a letter in it and the flag up -- the Boys Nation
   * counsellor's letter, the hinge into Harvard. This job came the same way
   * round: he sent the message. A cold DM to the CPO about a YouTube video,
   * a clarifying question, and then work. Stage 3 is the same move again.
   * Same post, same white box, same red flag, so that a visitor who walked
   * stage 1 recognises the object before they read anything into it.
   */
  roadBoard(s)

  s.pillar(1, 15, 0, 1, 'dark_oak_wood')
  s.set(1, 2, 15, 'white_concrete')
  s.set(0, 2, 15, 'red_concrete')                            // the flag is up
  s.set(1, 3, 15, 'crimson_planks')                          // and there is a letter in it
}

/*
 * The board at the kerb: a free-standing eval grid on two posts, at the
 * height of somebody walking past rather than up where a plan view would put
 * it. Stage 1 had to learn that twice and the road markers had to learn it
 * again -- a sign you look up to read is a sign nobody reads.
 *
 * Green is a passing case and red is a failing one, and the grid is mostly
 * green with three red in it, which is what an eval dashboard looks like on
 * a day anybody would call good.
 */
function roadBoard(s) {
  for (const z of [18, 23]) s.pillar(1, z, 0, 4, 'polished_blackstone')
  s.pattern({
    at: [1, 1, 18],
    plane: 'zy',
    legend: {
      '#': 'polished_blackstone', 'G': 'green_concrete', 'R': 'red_concrete',
      '.': 'black_concrete',
    },
    rows: [
      '#####.',
      '#GGGR#',
      '#GRGG#',
      '#GGGG#',
      '#RGGG#',
    ],
  })
  s.set(1, 5, 20, 'sea_lantern')
}

/* ----------------------------------------------------------- control room */

/*
 * THE MONITOR WALL. The thing you can read from the road, and the only
 * building on the plot meant to be looked AT as much as walked through.
 *
 * Twenty-one by fifteen and twelve high, in blackstone, with its whole west
 * face given over to screens. Render distance is 128 blocks and the road is
 * two blocks away, so this is the piece that has to carry at a distance;
 * anything subtler than a lit rectangle is wasted out there.
 *
 * TWO LEVELS, because one big room with consoles in it is a set. The floor is
 * where the work happens and the gallery above it is where you stand to read
 * the trace on the north wall, which is exactly what a wall-sized flame graph
 * is for.
 */
function controlRoom(c) {
  const W = 20, D = 14, H = 11

  c.rect([0, 0], [W, D], -1, 'polished_deepslate')
  c.hollow([0, 0, 0], [W, H, D], {
    walls: 'polished_blackstone', ceiling: 'polished_blackstone_bricks', inside: 'air',
  })
  c.hollow([0, H, 0], [W, H, D], { walls: 'polished_blackstone_brick_slab' })  // parapet

  facade(c)
  flameGraph(c)
  gallery(c, W, D)
  consoles(c, W, D)
  mast(c.at(3, H + 1, 3, 'arize/mast'))
  roofPlant(c, W, D, H)
  roofFind(c.at(2, H + 1, 0, 'arize/roof'))
  serverStair(c, D, H)

  // The east door, into the pipeline. Cleared from y = 0: a doorway with a
  // course of anything across the bottom of it is a doorway nobody uses.
  c.clear([W, 0, 6], [W, 2, 7])
  // Windows on the south wall, so the building is not a blank slab from the
  // yard, and a clerestory band up at gallery height for the same reason.
  for (let x = 3; x <= W - 3; x += 4) {
    c.box([x, 3, D], [x + 1, 4, D], 'gray_stained_glass')
    c.box([x, 8, D], [x + 1, 9, D], 'gray_stained_glass')
  }
}

/*
 * THE FACADE, drawn rather than assembled, which is what `pattern` is for.
 *
 * Rows are listed the way the wall looks -- top row at the top, last row at
 * the `at` y -- so the source is a picture of the thing it builds. Two
 * patterns stacked: the lower one is the door, a trace glyph over it, a
 * latency line climbing to a spike and an eval grid with two failures in it;
 * the upper one is a wider latency chart across the whole frontage.
 *
 * Stained glass over a black screen, with a course of glowstone as the door
 * lintel so there is something genuinely emitting after dark rather than a
 * wall that merely looks like it should be.
 *
 * WHICH WAY THE CHART RUNS is the one thing a plan view cannot tell you, and
 * stage 1 shipped a five-by-five N facing a cornfield for exactly this
 * reason. In `zy` the characters run SOUTH, so the line climbs to the left as
 * you stand on the road. Checked in a screenshot from the kerb.
 */
function facade(c) {
  c.pattern({
    at: [0, 0, 0],
    plane: 'zy',
    legend: {
      '#': 'polished_blackstone',
      'K': 'polished_blackstone_bricks',
      '.': 'black_concrete',
      'G': 'lime_stained_glass',
      'R': 'red_stained_glass',
      'C': 'cyan_stained_glass',
      'L': 'glowstone',
      'D': 'air',
    },
    rows: [
      'KKKKKKKKKKKKKKK',
      '#...GG#CCC#GGR#',
      '#..G..#.CC#GGG#',
      '#.G...#..C#RGG#',
      '#G....#LLL#GGG#',
      '#######DDD#####',
      '#######DDD#####',
      '#######DDD#####',
    ],
  })
  c.pattern({
    at: [0, 8, 0],
    plane: 'zy',
    legend: {
      '#': 'polished_blackstone', 'K': 'polished_blackstone_bricks',
      '.': 'black_concrete', 'G': 'lime_stained_glass', 'L': 'glowstone',
    },
    rows: [
      'KKKKKKKKKKKKKKK',
      '#...G....GG...#',
      '#.GG.G..G..G..#',
      '#GL...GG....GG#',
    ],
  })
}

/*
 * THE FLAME GRAPH, on the inside of the north wall, five rows tall and
 * nineteen wide, hung at gallery height so it reads from the deck above the
 * consoles rather than from under it.
 *
 * This is what a trace looks like in every observability product there has
 * ever been: one root span across the top and its children stepping down and
 * inward under it. Read it left to right and you get the request -- the whole
 * call, the retrieval inside it, the embedding inside that, a rerank, the
 * generation, and one short red span at the bottom, which is the error you
 * opened the trace to find.
 *
 * Concrete, not glass. A wall you can see daylight through reads as a
 * mistake, and this one is nine blocks up.
 *
 * AND THE ROWS ARE REVERSED BEFORE THEY ARE STAMPED, for the same reason the
 * roof easter egg is written backwards -- see `roofFind`, which got this
 * right on a `zy` wall and left this one alone because it is `xy` and the
 * rule is not the same on both. This is the INSIDE of the north wall, so the
 * reader is south of it facing NORTH, and Babylon is left-handed: facing
 * north puts +x on the reader's LEFT. Unreversed, the root span still ran
 * the full width and the drawing still looked like a flame graph, but time
 * ran right to left -- the error span sat before the call that produced it.
 * A chart is as orientation-dependent as a word and quieter about it.
 */
function flameGraph(c) {
  c.pattern({
    at: [1, 7, 0],
    plane: 'xy',
    legend: {
      '.': 'black_concrete',
      'C': 'cyan_concrete',
      'U': 'light_blue_concrete',
      'Y': 'yellow_concrete',
      'G': 'green_concrete',
      'R': 'red_concrete',
    },
    rows: [
      'CCCCCCCCCCCCCCCCCCC',
      '.UUUUUUUUUU........',
      '..YYYYY....UUUU....',
      '............GGGGGG.',
      '..............RR...',
    ].map(row => [...row].reverse().join('')),
  })
}

/*
 * The gallery: a deck at y = 5 around three sides, a rail on it, and a
 * staircase of five whole blocks up to it in the south-east corner.
 *
 * THE STAIR IS FIVE FULL BLOCKS, not stair blocks, for the reason stage 1
 * gives at length: a stair block's facing is a per-key thing in blocks.js and
 * picking the wrong one builds a staircase you cannot climb, which is a worse
 * bug than a blocky one and one you only find by walking it.
 */
function gallery(c, W, D) {
  c.rect([1, 1], [W - 1, 3], 5, 'polished_blackstone_bricks')   // the north deck
  c.rect([1, 1], [3, D - 1], 5, 'polished_blackstone_bricks')   // and down both sides
  c.rect([W - 3, 1], [W - 1, D - 1], 5, 'polished_blackstone_bricks')

  // The rail, one course up along the open edges, so the deck has a lip.
  c.line([4, 6, 3], [W - 4, 6, 3], 'polished_blackstone_brick_slab')
  c.line([3, 6, 4], [3, 6, D - 1], 'polished_blackstone_brick_slab')
  c.line([W - 3, 6, 4], [W - 3, 6, D - 1], 'polished_blackstone_brick_slab')

  /* Five blocks, each one taller than the last, ARRIVING AT THE DECK EDGE
   * rather than one block short of it -- which is what it did first time, and
   * is a staircase to nowhere that a plan view is perfectly happy with. */
  for (let i = 0; i <= 4; i++) c.box([16, 0, 12 - i], [16, i, 12 - i], 'polished_blackstone')

  /* Uplighters along the foot of the trace wall, standing ON the deck. A
   * five-row flame graph nine blocks up is a mural in the dark otherwise --
   * the first screenshot of this room had the whole thing in shadow with the
   * rail cutting its bottom row in half, which is why it now starts a course
   * higher and is lit from underneath. */
  for (let x = 2; x <= 18; x += 4) c.set(x, 6, 1, 'sea_lantern')
  for (const x of [5, 15]) c.set(x, 10, 2, 'sea_lantern')       // and from above
  c.set(10, 10, 2, 'sea_lantern')

  // Four panels of the deck itself are glowstone, which is the ceiling light
  // for the floor below: a fitting, not a lamp somebody left on a shelf.
  for (const [x, z] of [[2, 6], [2, 11], [18, 6], [18, 11], [2, 2], [18, 2]]) {
    c.set(x, 5, z, 'glowstone')
  }
}

/*
 * Three workstations on the floor, facing the wall the trace is on.
 *
 * A console is a desk, a dark screen, and something blue behind the screen so
 * that it is ON. The glowstone sits BEHIND the glass rather than in the desk,
 * because a light source you can see is a lamp and one you cannot is a lit
 * screen -- the same trick as the facade, one block smaller.
 */
function consoles(c, W, D) {
  for (const x of [5, 9, 13]) {
    c.box([x, 0, D - 3], [x + 2, 0, D - 3], 'smooth_stone')       // the desk
    c.set(x + 1, 0, D - 2, 'polished_blackstone')                 // the chair
    c.box([x, 1, D - 3], [x + 2, 1, D - 3], 'light_blue_stained_glass')
    c.box([x, 1, D - 4], [x + 2, 1, D - 4], 'glowstone')          // the backlight
    c.set(x, 0, D - 3, 'barrel')
  }

  // The trace line in the floor: cyan, from the front door to the pipeline
  // door, so the route through the building is the thing being described.
  c.line([1, -1, 6], [W - 1, -1, 6], 'cyan_concrete')
  c.line([1, -1, 7], [W - 1, -1, 7], 'cyan_concrete')

  // Recessed ceiling lights under the deck, swapped into the soffit rather
  // than stuck to it, which is the difference between a fitting and a
  // glowing rock on a shelf.
  for (const x of [2, 18]) for (const z of [6, 10]) c.set(x, 4, z, 'glowstone')
  for (const x of [6, 12]) c.set(x, 4, 2, 'glowstone')
}

/*
 * The mast. Sixteen blocks up from the roof, the tallest thing on the plot
 * and the only part of it visible from the far end of the road -- a
 * monitoring rig has an aerial, and a stage on a timeline needs a silhouette.
 */
function mast(m) {
  m.pillar(0, 0, 0, 7, 'iron_block')
  m.set(0, 8, 0, 'sea_lantern')
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    m.set(dx, 5, dz, 'polished_blackstone')
    m.set(dx * 2, 4, dz * 2, 'polished_blackstone')
  }
  m.set(0, 4, 0, 'cyan_concrete')
  m.set(0, 6, 0, 'red_concrete')                              // the beacon light
}

/** Rooftop plant. Four units and a duct run, because a flat roof with nothing
 *  on it reads as a lid and every real building's roof is where the machinery
 *  that nobody photographs lives. */
function roofPlant(c, W, D, H) {
  for (const [x, z] of [[8, 5], [8, 10], [13, 5], [13, 10]]) {
    c.box([x, H + 1, z], [x + 2, H + 2, z + 2], 'polished_blackstone')
    c.set(x + 1, H + 3, z + 1, 'gray_stained_glass')
  }
  c.line([9, H + 1, 8], [17, H + 1, 8], 'iron_block')
  c.set(W - 2, H + 1, 8, 'polished_blackstone')
}

/*
 * EASTER EGG, ON TOP. The three objects the job actually came from, on a roof
 * you have to notice the stairs for.
 *
 * A play button, because it started with a YouTube video of the CPO's. A
 * question mark, because what he sent her was a clarifying question about it
 * and not a pitch. And one envelope, because he sent it cold. Nobody on the
 * road sees any of this; you get it for climbing the racks.
 */
function roofFind(r) {
  r.pattern({
    at: [0, 0, 0],
    plane: 'zy',
    legend: {
      'R': 'red_concrete', 'W': 'white_concrete', '.': 'black_concrete',
      'K': 'polished_blackstone', ' ': 'air',
    },
    /* WRITTEN MIRRORED, and that is not a typo. In `zy` the characters run
     * +z, and from the roof -- the only place anybody ever stands to look at
     * this -- +z runs right to left. The first version rendered a backwards
     * question mark, which a plan view is delighted with and a screenshot
     * catches in a second. Read these rows right to left. */
    rows: [
      'WWW..WWW..RRRRR',
      'WRW....W..RRWRR',
      'WWW...WW..RWWRR',
      'KKK.......RRWRR',
      'KKK...W...RRRRR',
    ],
  })
  r.set(0, 5, 2, 'sea_lantern')
  r.set(0, 5, 12, 'sea_lantern')
}

/*
 * THE WAY UP TO THE ROOF, and it is on purpose that it is not obvious.
 *
 * From the gallery deck, six blocks step up the west side to a hatch cut in
 * the ceiling. Whole blocks rather than stair blocks, for the reason stage 1
 * gives: a stair block's facing is a per-key thing in blocks.js, and a
 * staircase you cannot climb is worse than a blocky one and is only ever
 * found by walking it.
 *
 * Outside, against the south wall, a short rank of racks that goes nowhere.
 * They are plant, not a route -- the route is the one indoors, which is the
 * difference between a roof anybody stumbles onto and a roof you get for
 * looking up.
 */
function serverStair(c, D, H) {
  c.clear([3, H, 4], [5, H, 10])                         // the hatch, cut first
  for (let i = 0; i <= 5; i++) c.set(4, 6 + i, 11 - i, 'polished_blackstone')

  for (let i = 0; i <= 5; i++) {
    c.pillar(3 + i, D + 1, 0, 2, 'polished_blackstone')
    c.set(3 + i, 2, D + 1, 'iron_block')
    if (i % 2 === 0) c.set(3 + i, 1, D + 1, 'green_concrete')
  }
}

/* ------------------------------------------------------------ ingest row */

/*
 * The racks along the north fence. Telemetry has to come from somewhere, and
 * a control room with nothing feeding it is a control room in a film.
 *
 * Eight racks behind a glass front, each with a status light: green, green,
 * green, amber, green. One of them is red, which is the honest ratio and is
 * also the only thing in this row anybody will look at twice.
 */
function ingestRacks(k) {
  /* The hall the racks stand in. Blackstone with a glazed south front, so the
   * row is behind glass from the yard -- which is how you see a server room
   * in every building that has one, and is the only reason a rack is ever
   * worth drawing. */
  k.hollow([0, 0, 0], [14, 4, 4], {
    walls: 'polished_blackstone', ceiling: 'polished_blackstone_bricks', inside: 'air',
  })
  for (let x = 2; x <= 12; x += 2) k.box([x, 1, 4], [x + 1, 3, 4], 'gray_stained_glass')
  k.clear([0, 0, 2], [0, 2, 2])                  // the door, at the road end
  k.set(7, 4, 2, 'glowstone')

  const LIGHTS = ['green_concrete', 'green_concrete', 'yellow_concrete', 'green_concrete',
    'red_concrete', 'green_concrete', 'green_concrete', 'yellow_concrete']
  k.rect([0, 0], [14, 3], -1, 'polished_deepslate')
  for (let i = 0; i < 8; i++) {
    const x = i * 2
    k.box([x, 0, 1], [x, 3, 1], 'polished_blackstone')
    k.set(x, 1, 1, LIGHTS[i])
    k.set(x, 2, 1, 'black_concrete')
    k.set(x, 0, 2, 'gray_stained_glass')
    k.set(x, 1, 2, 'gray_stained_glass')
    k.set(x, 2, 2, 'gray_stained_glass')
  }
  for (let i = 0; i < 8; i++) {                        // the back rank
    const x = i * 2
    k.box([x, 0, 3], [x, 3, 3], 'polished_blackstone')
    k.set(x, 2, 3, LIGHTS[7 - i])
  }
  k.line([0, 4, 1], [14, 4, 1], 'polished_blackstone_brick_slab')
  for (const x of [1, 7, 13]) k.set(x, 3, 1, 'glowstone')
}

/* -------------------------------------------------------- trace corridor */

/*
 * THE PIPELINE, AS A CORRIDOR. Sixteen blocks of it, six wide, and you walk
 * the request end to end.
 *
 * RETRIEVE, GENERATE, EVALUATE, SHIP: four gates in four colours, and over
 * your head the spans for each stage, stepping along the ceiling in the same
 * order so that the waterfall on the wall of the control room and the ceiling
 * you are walking under are obviously the same drawing. This is the bit the
 * subject actually wrote about -- RAG and agent observability -- and a
 * pipeline is the one diagram in that field that survives being walked
 * through rather than looked at.
 */
function traceCorridor(t) {
  const L = 15, D = 5

  t.rect([0, 0], [L, D], -1, 'polished_deepslate')
  t.hollow([0, 0, 0], [L, 5, D], {
    walls: 'polished_blackstone', ceiling: 'polished_blackstone_bricks', inside: 'air',
  })
  t.clear([0, 0, 1], [0, 2, 2])                  // west door, into the control room
  t.clear([L, 0, 1], [L, 2, 2])                  // east door, into the study

  // The cyan trace line, carried straight through from the control room floor.
  t.line([0, -1, 1], [L, -1, 1], 'cyan_concrete')
  t.line([0, -1, 2], [L, -1, 2], 'cyan_concrete')

  const GATES = [
    [2, 'light_blue_concrete'],   // retrieve
    [6, 'yellow_concrete'],       // generate
    [10, 'green_concrete'],        // evaluate
    [14, 'purple_concrete'],      // ship
  ]
  for (const [x, colour] of GATES) {
    t.pillar(x, 1, 0, 3, colour)
    t.pillar(x, D - 1, 0, 3, colour)
    t.line([x, 4, 1], [x, 4, D - 1], colour)
    t.set(x, 4, 2, 'glowstone')                  // every gate is its own lamp
    t.set(x, 4, 3, 'glowstone')
  }

  /*
   * The spans overhead. Each stage gets a bar in its own colour on the
   * ceiling, and each one starts where the last one did and runs shorter --
   * a waterfall you are walking underneath instead of reading.
   */
  const SPANS = [
    [1, 14, 'cyan_concrete'],
    [2, 11, 'light_blue_concrete'],
    [4, 9, 'yellow_concrete'],
    [8, 13, 'green_concrete'],
    [12, 15, 'purple_concrete'],
  ]
  SPANS.forEach(([x0, x1, colour], i) => t.line([x0, 5, 1 + i], [x1, 5, 1 + i], colour))

  /* And again on the OUTSIDE of the same ceiling, so the waterfall is legible
   * from the yard as well as from under it. The corridor is a low building
   * standing in the open; a roof with the trace drawn on it is a roof worth
   * having rather than a lid. */
  SPANS.forEach(([x0, x1, colour], i) => t.line([x0, 6, 1 + i], [x1, 6, 1 + i], colour))
  t.set(8, 6, 3, 'sea_lantern')

  // Buttresses down the south flank. A sixteen-block wall with nothing on it
  // is a fence, and this one is the side of the building the whole yard sees.
  for (let x = 2; x <= 14; x += 4) {
    t.pillar(x, D + 1, 0, 4, 'polished_blackstone')
    t.set(x, 5, D + 1, 'polished_blackstone_brick_slab')
  }
}

/* ------------------------------------------------------------- the study */

/*
 * WHERE THE WRITING HAPPENED, and the only warm room on the plot. Spruce and
 * oak after forty blocks of blackstone, which is the whole point: the
 * dashboards are the company and this is the desk.
 *
 * Fourteen by twelve, split by a partition. North half is the desk and the
 * figure at it. South half is the archive: the shelves, the drafts, and the
 * two boards that are not nailed down.
 */
function study(h) {
  const W = 13, D = 11, H = 5

  h.rect([0, 0], [W, D], -1, 'planks')
  h.hollow([0, 0, 0], [W, H, D], {
    walls: 'spruce_planks', ceiling: 'planks', inside: 'air',
  })
  for (const [x, z] of [[0, 0], [W, 0], [0, D], [W, D]]) h.pillar(x, z, 0, H, 'dark_oak_wood')
  h.clear([0, 0, 4], [0, 2, 5])                      // the door back to the pipeline

  /*
   * The window over the desk looks WEST, straight back down the corridor at
   * the monitor wall. It is the sightline the whole plot is built around:
   * from the chair, the only thing you can see is the dashboard the words
   * end up on, and none of them will have your name on them.
   */
  h.box([0, 3, 2], [0, 4, 3], 'glass')
  h.box([0, 3, 7], [0, 4, 8], 'glass')
  for (const z of [2, 5, 8]) h.box([W, 2, z], [W, 3, z], 'glass')

  writingRoom(h, W, H)
  partition(h, W)
  archive(h, W, D, H)
  roof(h, W, D, H)

  h.set(4, H, 3, 'glowstone')                        // recessed, in the plank ceiling
  h.set(9, H, 8, 'glowstone')
  h.set(4, H, 8, 'glowstone')
}

/*
 * The desk, and the person at it.
 *
 * THE FIGURE IS WHITE STAINED GLASS. Three blocks of him -- legs, body, head
 * -- with his arms out over the desk and a glowstone in the floorboards under
 * his feet, so he is lit from below and you can see the far wall straight
 * through him. He is the only body in this world that is not a real entity,
 * which is the joke and also the reason he can exist at all: builds are
 * static geometry, and a ghost is the one character you can build out of
 * blocks without lying about it.
 */
function writingRoom(h, W, H) {
  h.box([3, 0, 1], [8, 0, 1], 'planks')              // the desk
  h.set(4, 0, 1, 'crafting_table')
  h.set(7, 0, 1, 'barrel')
  h.box([3, 1, 1], [3, 1, 1], 'black_concrete')
  h.set(6, 1, 1, 'light_blue_stained_glass')         // the screen he typed into
  h.set(6, 1, 0, 'glowstone')

  h.set(5, -1, 2, 'glowstone')                       // the lit floorboard he stands on
  h.pillar(5, 2, 0, 2, 'white_stained_glass')        // legs, body, head
  h.set(4, 1, 2, 'white_stained_glass')              // and two arms, over the desk
  h.set(6, 1, 2, 'white_stained_glass')

  // Bookshelves down the north wall: the reading the writing came out of.
  for (let x = 9; x <= W - 1; x++) h.box([x, 0, 1], [x, 1, 1], 'bookshelf')
  void H
}

/*
 * THE BYLINE BOARD, on the partition, and the reason this build exists.
 *
 * Two published pages, headline bar and all, and in the byline line of each
 * one there is a HOLE. Not a blank block -- a hole, right through the
 * partition, so from the archive side you can see the shelves through the
 * place where the author's name goes. The work is finished, it is up on the
 * wall, and there is a gap in it exactly one block wide.
 *
 * Drawn on an interior wall rather than an exterior one precisely so the hole
 * can be a hole. A gap in an outside wall is weather; a gap in this one is
 * the thing being said.
 */
function partition(h, W) {
  h.box([1, 0, 6], [W - 1, 5, 6], 'spruce_planks')
  h.pattern({
    at: [1, 1, 6],
    plane: 'xy',
    legend: {
      'W': 'white_concrete', 'B': 'black_concrete',
      '_': 'air', '.': 'spruce_planks',
    },
    rows: [
      'WWW.....WWW',
      'BBB.....BBB',
      'WWW.....WWW',
      'W_W.....W_W',
      'WWW.....WWW',
    ],
  })
  h.clear([6, 0, 6], [7, 2, 6])                      // the way through, between the pages
}

/*
 * The archive. Everything that was published, filed, in an order nobody but
 * the writer would recognise -- and the two floorboards that come up.
 *
 * THE BOARDS ARE BEHIND THE SHELVES, which is the difference between an
 * easter egg and a trapdoor. You find them by walking down the back of the
 * room rather than by walking into it.
 */
function archive(h, W, D, H) {
  for (let x = 1; x <= W - 1; x += 2) {
    h.box([x, 0, D - 1], [x, 1, D - 1], 'bookshelf')
    h.set(x + 1, 0, D - 1, 'planks')
  }
  h.set(2, 0, 8, 'barrel')                           // the drafts nobody asked for
  h.set(3, 0, 8, 'barrel')
  h.set(W - 2, 0, 8, 'crafting_table')
  h.set(1, H, 9, 'glowstone')
  void D
}

/* ------------------------------------------------------------ the cellar */

/*
 * EASTER EGG, UNDER. The drafts, with the name still on them.
 *
 * Written at the STUDY'S origin so the two line up without anybody adding
 * eleven to anything, and sized by the vertical budget rather than by taste:
 * the world is Classic Flat, so grass is at -1, dirt at -2 and -3, bedrock at
 * -4. That is exactly one two-block room with the study's own floorboards as
 * its ceiling, and no room whatever for a stair.
 *
 * So the way down is a PAIR of missing boards with a crate under each, at two
 * different heights -- step down, step down, and back up the same way. A 1x1
 * shaft is a trap: from a cellar floor the ground is three up and a jump is
 * one. Stage 1 learned that the hard way and this is the same staircase.
 *
 * What is down here is the mirror of the board upstairs: the same page, the
 * same headline bar, and a gold block where the hole is. That is the whole
 * easter egg. He wrote them. The name is real. It is just not upstairs.
 */
function drafts(v) {
  const W = 13, D = 11

  v.box([1, -4, 1], [W - 1, -4, D - 1], 'stone')              // a floor over the bedrock
  v.box([1, -3, 1], [W - 1, -2, D - 1], 'air')                // two blocks of headroom
  v.box([1, -1, 1], [W - 1, -1, D - 1], 'planks')             // the study's own boards
  for (const [a, b] of [[[1, 1], [1, D - 1]], [[W - 1, 1], [W - 1, D - 1]],
    [[1, 1], [W - 1, 1]], [[1, D - 1], [W - 1, D - 1]]]) {
    v.box([a[0], -3, a[1]], [b[0], -2, b[1]], 'deepslate_bricks')
  }

  // The way in and the way out, which are the same two crates. Behind the
  // shelf run, under the two boards that are not nailed down.
  v.set(10, -1, 8, 'air')
  v.set(11, -1, 8, 'air')
  v.set(11, -3, 8, 'barrel')
  v.set(10, -3, 8, 'deepslate_bricks')
  v.set(10, -2, 8, 'barrel')

  // The shelves of drafts, and the light to read them by.
  for (let x = 3; x <= 8; x++) v.box([x, -3, 2], [x, -2, 2], 'bookshelf')
  v.set(2, -1, 5, 'glowstone')
  v.set(9, -1, 7, 'glowstone')
  v.set(5, -3, 5, 'barrel')

  /*
   * THE PAGE WITH THE NAME ON IT. Same three-wide page as the partition
   * upstairs, same black headline bar, and the byline line is GOLD instead of
   * missing. Lit from the side, at the far end of the room from the way in,
   * so you have to walk the length of a cellar to find out that the credit
   * exists.
   */
  /* TWO ROWS, not three. A cellar is two blocks of headroom and nothing else,
   * so a three-row page puts its top course in the floorboards of the room
   * above -- which is a white stripe in the study floor and half a page down
   * here. The headline bar and the byline are the two rows that matter. */
  v.pattern({
    at: [3, -3, 9],
    plane: 'xy',
    legend: { 'W': 'white_concrete', 'B': 'black_concrete', 'G': 'gold_block' },
    rows: [
      'BBB',
      'WGW',
    ],
  })
  v.set(6, -2, 9, 'sea_lantern')
}

/*
 * The roof over the study. Four courses, ridge running east-west so the
 * slopes face the pipeline and the yard, eaves overhanging by one -- which is
 * the cheapest single thing that stops a voxel building looking like a box.
 *
 * THE HOLLOWING IS PER-COURSE, which is the part stage 1 got wrong first
 * time. Carving one box out of the middle of the stack does not leave an
 * attic, it leaves a hole, because every course above the carve is inside it.
 * The interior at each level is only what sits inboard of the course ABOVE.
 */
function roof(h, W, D, H) {
  const courses = [[-1, D + 1], [1, D - 1], [3, D - 3], [5, D - 5]]
  courses.forEach(([z0, z1], i) => h.rect([-1, z0], [W + 1, z1], H + 1 + i, 'dark_oak_planks'))
  courses.forEach((_, i) => {
    const above = courses[i + 1]
    if (!above || above[0] + 1 > above[1] - 1) return
    h.box([0, H + 1 + i, above[0] + 1], [W, H + 1 + i, above[1] - 1], 'air')
  })
  h.box([0, H + 1, -1], [1, H + 2, -1], 'glass')             // a gable window each end
  h.box([W - 1, H + 1, D + 1], [W, H + 2, D + 1], 'glass')
}

/* ---------------------------------------------------------- cold storage */

/*
 * Where the old traces go. A long low vault of deepslate along the north
 * fence with the crates stacked inside it, because every observability
 * product is in the end a very large amount of stored telemetry and a
 * building that only shows you the dashboard is telling half of it.
 */
function coldStore(k) {
  const W = 12, D = 2
  k.rect([0, 0], [W, D], -1, 'polished_deepslate')
  k.hollow([0, 0, 0], [W, 3, D], {
    walls: 'deepslate_bricks', ceiling: 'polished_deepslate', inside: 'air',
  })
  k.clear([0, 0, 1], [0, 2, 1])
  for (let x = 2; x <= W - 2; x += 2) {
    k.set(x, 0, 1, 'barrel')
    k.set(x, 1, 1, 'barrel')
  }
  k.set(6, 3, 1, 'glowstone')
  k.set(W, 1, 1, 'gray_stained_glass')
}

/* ------------------------------------------------------- the byline wall */

/*
 * THE BACK WALL OF THE PLOT, and the quietest thing on it.
 *
 * Twenty-eight blocks of published work, page after page after page, headline
 * bar and all -- and every single one of them has the same block missing out
 * of its byline. Two years of articles and posts on RAG and agent
 * observability, all of them real, none of them signed.
 *
 * It is the far end of the plot on purpose. You see it from the gallery and
 * from the drift field, you walk the length of it, and the pattern only
 * becomes the point somewhere around the fourth page.
 */
function bylineWall(g) {
  g.box([0, 0, 0], [1, 9, 27], 'polished_deepslate')
  g.pattern({
    at: [0, 1, 1],
    plane: 'zy',
    legend: {
      'W': 'white_concrete', 'B': 'black_concrete',
      '_': 'air', '.': 'polished_deepslate', 'L': 'sea_lantern',
    },
    rows: [
      '..L.......L.......L.......L',
      'WWW.WWW.WWW.WWW.WWW.WWW.WWW',
      'BBB.BBB.BBB.BBB.BBB.BBB.BBB',
      'WWW.WWW.WWW.WWW.WWW.WWW.WWW',
      'W_W.W_W.W_W.W_W.W_W.W_W.W_W',
      'WWW.WWW.WWW.WWW.WWW.WWW.WWW',
    ],
  })
  g.box([0, 10, 0], [1, 10, 27], 'polished_blackstone_brick_slab')
}

/* ------------------------------------------------------------ the drift */

/*
 * THE DRIFT FIELD, in the back yard, east of the empty ground the test suite
 * stands on.
 *
 * A baseline in white and a row of posts that start on it and wander off it.
 * Inside the band they are green; past it they are red. Drift is the thing
 * every one of those dashboards is actually watching for, it is a chart that
 * survives being three-dimensional, and it is the one part of this plot you
 * can read correctly while walking through the middle of it.
 *
 * The heights are a written-out list rather than a formula. It is a drawing,
 * and a drawing of a drift is a shape somebody chose.
 */
function driftField(s) {
  /* Sample by sample, how far off the baseline the distribution has wandered.
   * Written out rather than computed: it is a drawing, and a drawing of a
   * drift is a shape somebody chose. */
  const DRIFT = [0, 0, 1, 0, 1, 2, 1, 2, 3, 4]

  s.line([34, -1, 22], [53, -1, 22], 'white_concrete')        // the baseline
  s.line([34, -1, 20], [53, -1, 20], 'yellow_concrete')       // the alert band,
  s.line([34, -1, 24], [53, -1, 24], 'yellow_concrete')       // two blocks either side

  DRIFT.forEach((off, i) => {
    const x = 34 + i * 2
    const z = 22 + off
    const beyond = off >= 2                                    // past the band
    s.pillar(x, z, 0, beyond ? 2 : 1, beyond ? 'red_concrete' : 'green_concrete')
    s.set(x, -1, z, 'polished_blackstone')                     // the sample's footing
    if (off > 0) for (let d = 1; d <= off; d++) s.set(x, -1, 22 + d, 'light_gray_concrete')
  })

  // A rank of standards down the west edge of the field, which is also the
  // east edge of the empty yard: it gives the emptiness a boundary, so the
  // ground the test suite stands on reads as a yard rather than as a plot
  // somebody ran out of time on.
  for (let z = 18; z <= 26; z += 3) {
    s.pillar(33, z, 0, 2, 'polished_blackstone')
    s.set(33, 3, z, 'sea_lantern')
  }

  // Two lamps at the far end, so the last three samples -- the red ones -- are
  // lit at night, which is when a drift alert actually goes off.
  for (const x of [44, 52]) {
    s.pillar(x, 18, 0, 2, 'polished_blackstone')
    s.set(x, 3, 18, 'sea_lantern')
  }
}
