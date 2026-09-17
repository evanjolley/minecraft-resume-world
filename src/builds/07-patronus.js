/*
 * STAGE 7 -- PATRONUS AI. The one that has not finished happening.
 *
 * Every other plot on this road is closed. A house he moved out of, a school
 * he graduated from, four jobs he left. This one is September 2026 to
 * PRESENT, which is the only interesting structural fact a seventh stage
 * has, and it is a fact you can build: the site is still open. Half the
 * building is clad and glazed and lit; the other half is steel frame,
 * scaffolding and sky. There is a crane over it with a cladding panel still
 * hanging off the hook. The sidewalk out to the road runs SOUTH toward the
 * spawn and simply stops being a sidewalk -- concrete, then gravel, then
 * three survey stakes in the grass, pointing off the plot edge at a walk
 * nobody has poured yet.
 *
 * ------------------------------------------------------------------------
 * WHAT IS HERE, AND WHY IT IS HERE. All of it is from the owner's own record.
 * Nothing factual is invented, and nothing here is about what the company is
 * going to do -- see THE LINE, below, which is a hard one.
 *
 *   the half-built harness   Patronus AI, September 2026 to present. The
 *                            finished south wing is the part of the job that
 *                            exists; the framed north wing is the part that
 *                            does not exist yet.
 *   the ONE desk on the      Member of Technical Staff, Growth. FIRST GROWTH
 *     open second floor      HIRE. One desk, one lamp, no walls, no ceiling,
 *                            no colleagues, eleven floors of nothing around
 *                            it. That is what a first hire is.
 *   the arena                RL environments. An RL environment is a little
 *                            world an agent is dropped into to be scored,
 *                            which is precisely what a visitor standing in
 *                            this one is. It is the four-rooms gridworld,
 *                            the oldest published toy in the field, walkable
 *                            at 1:1 -- start pad, doorways, hazard tiles, a
 *                            bullseye on the goal. There is an agent halfway
 *                            through it and an observer on a gallery above
 *                            watching it be scored. Then you climb the steps
 *                            and you are the observer.
 *   the board by the road    LLM evaluation. A pass/fail matrix at eye level,
 *                            green and red, and the top row is GREY, because
 *                            that run has not come back yet. It is the whole
 *                            stage in five blocks.
 *   the hoarding             2026. The year the site opened, on the board
 *                            you read walking north up the road.
 *   the recursion            this world was built by AI agents working for
 *                            him, and he is now paid to evaluate AI agents.
 *                            It is not stated anywhere. It is the building.
 *
 * THE EASTER EGGS, one for each direction you have to look:
 *
 *   UNDER   the run archive, under the lab floor, through two missing floor
 *           panels. Shelves of finished runs -- and at the far end, sealed
 *           behind tinted glass, a five-by-five gridworld with an agent
 *           standing in it. It is the arena outside, one level down and one
 *           size smaller. You dug under the evaluation lab and found the
 *           same little world you are standing in.
 *   ON TOP  the lone desk on the undecked second floor, reached by climbing
 *           the scaffolding on the road side, or by walking out of the
 *           finished review room through a doorway that opens onto open
 *           steel. One lamp, lit, in a building with no walls.
 *   BEHIND  the retired environment, walled off in the far north-west corner
 *           behind the arena where the road cannot see it. Inside: a growth
 *           chart in green, four identical agents running two identical
 *           copies of the same experiment forever, and a red line coming
 *           down through all of it. This is HIS OWN VIEW OF HIS OWN FIELD,
 *           said plainly and often -- that AI is about to gut growth and
 *           marketing, that infinite A/B testing and simulation is coming
 *           for it, and that even getting people to care about something may
 *           not survive as a defensible skill. He says it about the
 *           discipline he works in. It is the most candid thing on this road
 *           and it is deliberately the hardest thing here to find.
 *
 * ------------------------------------------------------------------------
 * THE LINE. His record names confidential employer business as never-say and
 * names the company's roadmap specifically. So NOTHING here is a product,
 * a plan, a feature, an internal detail or a thing that has not shipped.
 * What is built is his title, his start date, that he is the first growth
 * hire, and the publicly known shape of the field -- evaluation, and RL
 * environments. The four-rooms gridworld is a textbook benchmark from 1999.
 * The pass/fail board grades nothing in particular. The hoarding says a year
 * and no more. Every sealed thing on this plot is sealed because it is about
 * HIM, never because it is about them.
 * ------------------------------------------------------------------------
 * ORIENTATION. 56 wide (x 0..55), 28 deep (z 0..27). +x is EAST, toward the
 * road, which is where the visitor is; +z is SOUTH, which is the direction
 * they came from and, on this one plot, the direction the story keeps going.
 * y = 0 is the air above the grass and y = -1 IS the grass.
 *
 * NO LETTERS ANYWHERE EXCEPT THE YEAR, and the year is on a SOUTH-facing
 * board on purpose. A `zy` pattern on a west-facing wall has its characters
 * running +z, and a viewer standing on the road faces west, for whom +z is
 * LEFT -- so any glyph stamped onto a road-facing wall on this side of the
 * road comes out mirrored. Colour is immune to that and text is not, so the
 * facade is colour and the one piece of text faces north-south, where +x is
 * the reader's right and the drawing comes out the way it is written.
 */

/** 2026, 3x5, drawn the way it is read. The only text on the plot. */
const DIGITS = {
  0: ['###', '# #', '# #', '# #', '###'],
  2: ['###', '  #', '###', '#  ', '###'],
  6: ['###', '#  ', '###', '# #', '###'],
}

export function build(s) {
  site(s)
  harness(s.at(33, 0, 3, 'patronus/harness'))
  archive(s.at(33, 0, 3, 'patronus/archive'))
  scaffolding(s.at(51, 0, 3, 'patronus/scaffold'))
  crane(s.at(28, 0, 5, 'patronus/crane'))
  yard(s)
  arena(s.at(2, 0, 8, 'patronus/arena'))
  gallery(s.at(23, 0, 13, 'patronus/gallery'))
  retiredEnvironment(s.at(2, 0, 0, 'patronus/retired'))
  boardByTheRoad(s)
  hoarding(s)
}

/* -------------------------------------------------------------- the ground */

/*
 * What is underfoot, and it is three different things on purpose: poured
 * slab where the building is, gravel where it is not yet, and grass where
 * nobody has even staked it out.
 *
 * Everything goes down at y = -1, replacing the grass rather than sitting on
 * it, for the reason road.js gives at length -- a surface one block proud of
 * the lawn is a kerb you trip over, and the whole world keeps one height.
 */
function site(s) {
  s.rect([24, 0], [52, 13], -1, 'gravel')                // the half nobody has poured
  s.rect([24, 14], [52, 25], -1, 'light_gray_concrete')  // ...and the half they have
  s.rect([2, 7], [23, 7], -1, 'gravel')                  // the haul route west to the arena

  approach(s)
}

/*
 * THE SIDEWALK, AND WHERE IT STOPS BEING ONE.
 *
 * This is the single load-bearing idea of the stage and it is four lines
 * long. Every other plot terminates its paving tidily at its own edge,
 * because every other plot is finished. This one degrades southward --
 * smooth stone, then concrete, then gravel, then three orange survey stakes
 * standing in ordinary grass, aimed off the plot at ground nobody owns yet.
 * A visitor walking north hits the stakes first and the finished sidewalk
 * second, which means they walk INTO the timeline from the end of it.
 */
function approach(s) {
  s.rect([53, 0], [55, 19], -1, 'smooth_stone')          // done
  s.rect([53, 20], [55, 22], -1, 'light_gray_concrete')  // poured, not faced
  s.rect([53, 23], [55, 24], -1, 'gravel')               // sub-base only
  s.rect([51, 18], [55, 19], -1, 'polished_andesite')    // the walk to the front doors

  // The stakes. Three blocks, no paving under them, running off the edge.
  for (const z of [25, 26, 27]) s.set(54, 0, z, 'orange_concrete')
  s.set(53, 0, 24, 'polished_blackstone')                // the end-of-works marker
  s.set(53, 1, 24, 'orange_concrete')

  // Lamps down the verge, spaced to leave the front walk clear.
  for (const z of [3, 11, 22]) {
    s.pillar(55, z, 0, 3, 'polished_blackstone')
    s.set(55, 4, z, 'sea_lantern')
  }
}

/* --------------------------------------------------------------- the harness
 *
 * The building, written at its own north-west corner: h-local x 0..17,
 * z 0..22. The SOUTH half (z 11..22) is finished. The NORTH half (z 0..10)
 * is a steel frame with half a floor in it. They share a wall, and that wall
 * has a doorway in it on the second storey, which is the best thirty seconds
 * on this plot: you walk out of a lit room with a table in it and you are
 * standing on open decking with no handrail and the sky where the ceiling
 * should be.
 */
function harness(h) {
  finishedWing(h)
  framedWing(h)
}

/*
 * The part that exists. Two storeys, white and glass, glazed on the road
 * side, with a lab downstairs and a review room upstairs.
 */
function finishedWing(h) {
  const W = 17, Z0 = 11, Z1 = 22

  h.box([0, -2, Z0], [W, -2, Z1], 'cobblestone')                  // footing
  h.rect([0, Z0], [W, Z1], -1, 'polished_andesite')               // the lab floor
  h.hollow([0, 0, Z0], [W, 4, Z1], { walls: 'white_concrete', ceiling: 'light_gray_concrete', inside: 'air' })
  h.hollow([0, 4, Z0], [W, 8, Z1], { walls: 'white_concrete', ceiling: 'light_gray_concrete', inside: 'air' })
  /* A RING, not a box. `box` over the footprint would pave the ground floor
   * one course above its own boards -- the mistake Omaha's header records,
   * and the one that is invisible from outside and obvious from inside. */
  h.hollow([0, 0, Z0], [W, 0, Z1], { walls: 'polished_blackstone' })   // the plinth course
  for (const z of [Z0, Z1]) for (const x of [0, W]) h.pillar(x, z, 0, 8, 'light_gray_concrete')

  /*
   * The road side. Drawn rather than assembled, because this is the face a
   * visitor sees from a hundred blocks off and `pattern` exists for exactly
   * this. Twelve characters run south, nine rows stack up, and the last row
   * sits at y = 0 -- so the listing below is a picture of the wall.
   *
   * The dark band at the top is the plant deck; the two glass bands are the
   * lab and the review room; the pale course at the bottom is the plinth.
   */
  h.pattern({
    at: [W, 0, Z0], plane: 'zy',
    legend: {
      '#': 'white_concrete', 'W': 'light_blue_stained_glass', 'G': 'glass',
      'B': 'polished_blackstone', 'L': 'sea_lantern', '-': 'light_gray_concrete',
    },
    rows: [
      'BBBBBBBBBBBB',
      '#----------#',
      '#WWWW##WWWW#',
      '#WWWW##WWWW#',
      '#----------#',
      '#GGGG##GGGG#',
      '#GGGG##GGGG#',
      '#GGL####LGG#',
      'BBBBBBBBBBBB',
    ],
  })
  h.clear([W, 0, 15], [W, 2, 16])                 // the front doors: a hole, not a block
  h.set(W, 3, 15, 'sea_lantern')
  h.set(W, 3, 16, 'sea_lantern')

  // Glass on the other three faces too. A building with windows on one side
  // is a film set the moment somebody walks round the back of it.
  for (const z of [13, 15, 18, 20]) {
    h.box([0, 2, z], [0, 3, z], 'glass')
    h.box([0, 6, z], [0, 7, z], 'light_blue_stained_glass')
  }
  for (const x of [3, 5, 9, 12, 14]) {
    h.box([x, 2, Z1], [x, 3, Z1], 'glass')
    h.box([x, 6, Z1], [x, 7, Z1], 'light_blue_stained_glass')
  }
  /* NO DOOR IN THE SOUTH WALL, and that is a correction rather than a
   * choice. The site hoarding runs along z = 26 one block off this face, so
   * a south door opened onto a blank board eighteen inches away. Windows
   * instead; the entrance that matters is the one on the road. */
  h.box([4, 1, Z1], [5, 2, Z1], 'glass')

  lab(h.at(0, 0, Z0, 'patronus/lab'), W)
  reviewRoom(h.at(0, 4, Z0, 'patronus/review'), W)
  roofPlant(h, W, Z0, Z1)

  /*
   * THE DOORWAY INTO NOTHING. The north wall of the finished wing is the
   * south wall of the frame, and on the second storey it has a hole in it.
   * Walk through and the floor continues (the frame's decking is at the same
   * y) and absolutely nothing else does.
   */
  h.clear([8, 5, Z0], [9, 7, Z0])
}

/*
 * Downstairs: the evaluation lab. Four workstations down the middle, a rack
 * of machines against the north wall, and a results wall on the west face --
 * a grid of green and red, with one grey column that has not come back.
 *
 * THE STAIR IS FIVE FULL BLOCKS, not stair blocks, for the reason Omaha
 * gives: a stair key carries its facing (`spruce_stairs_east_bottom` and
 * seven siblings) and picking the wrong one builds a staircase you cannot
 * climb, which is worse than a blocky one and is only found by walking it.
 */
function lab(k, W) {
  k.clear([1, 4, 1], [5, 4, 2])                                   // the stairwell
  for (let i = 0; i <= 4; i++) k.box([1 + i, 0, 1], [1 + i, i, 1], 'light_gray_concrete')

  // Four workstations: a desk, a screen on it, a chair behind it.
  for (const z of [5, 8]) {
    for (const x of [7, 12]) {
      k.set(x, 0, z, 'smithing_table')
      k.set(x, 1, z, 'black_concrete')
      k.set(x, 0, z + 1, 'stripped_bamboo_block')
    }
  }

  // The machines that run the things being graded, along the north wall.
  for (let x = 8; x <= 13; x += 2) {
    k.box([x, 0, 1], [x, 2, 1], 'black_concrete')
    k.set(x, 1, 1, 'observer')
  }
  k.set(7, 0, 1, 'crafting_table')
  k.set(14, 0, 1, 'barrel')

  /*
   * The results wall. Twelve deep, three high, on the west face. Colour
   * only, and deliberately: see the header on mirroring. Grey is not "no"
   * and it is not "yes", it is "the run is still going", and there is more
   * grey on this wall than a finished company would tolerate.
   */
  k.pattern({
    at: [1, 1, 3], plane: 'zy',
    legend: { '#': 'lime_concrete', '.': 'red_concrete', '?': 'gray_concrete' },
    rows: [
      '##.##?#?',
      '###.#?#?',
      '##.#.?.?',
    ],
  })

  k.set(3, 0, 10, 'cartography_table')
  k.set(15, 0, 10, 'chiseled_bookshelf')
  k.set(15, 0, 9, 'bookshelf')
  lights(k, [[4, 4, 4], [12, 4, 4], [4, 4, 8], [12, 4, 8], [8, 4, 10]])
}

/*
 * Upstairs: the room where a run gets read. A long quartz table, chairs down
 * both sides, a rubric on the east wall and a window on the west wall that
 * looks straight down into the arena -- which is the point of putting the
 * arena where it is.
 */
function reviewRoom(r, W) {
  r.box([6, 0, 4], [11, 0, 7], 'smooth_quartz')                  // the table
  for (const z of [3, 8]) for (let x = 6; x <= 11; x += 2) r.set(x, 0, z, 'stripped_bamboo_block')

  r.box([1, 1, 2], [1, 2, 2], 'lime_concrete')                   // the rubric, such as it is
  r.box([1, 1, 3], [1, 2, 3], 'red_concrete')
  r.box([1, 1, 4], [1, 2, 4], 'gray_concrete')
  r.set(1, 0, 3, 'lodestone')

  r.set(14, 0, 9, 'barrel')
  r.set(15, 0, 9, 'chiseled_bookshelf')
  lights(r, [[5, 4, 3], [12, 4, 3], [5, 4, 8], [12, 4, 8]])
}

/** The plant deck on the roof, which is the cheapest single thing that stops
 *  a flat voxel roof reading as a lid. Also a parapet, so it has an edge. */
function roofPlant(h, W, Z0, Z1) {
  h.hollow([0, 9, Z0], [W, 9, Z1], { walls: 'polished_blackstone' })
  h.box([3, 9, Z0 + 3], [6, 10, Z0 + 5], 'light_gray_concrete')
  h.box([4, 11, Z0 + 4], [5, 11, Z0 + 4], 'iron_block')
  h.box([10, 9, Z0 + 7], [12, 10, Z0 + 9], 'iron_block')
  h.set(11, 11, Z0 + 8, 'light_gray_concrete')
  h.set(W - 1, 10, Z1 - 1, 'sea_lantern')
  h.set(1, 10, Z0 + 1, 'sea_lantern')
}

/*
 * The part that does not exist yet. Columns, beams, half a floor and two
 * panels of cladding hung on it. No walls, no glass, no roof.
 *
 * THIS IS THE RISK IN THE WHOLE BUILD and it is worth naming: open steel at
 * eye level can read as rubble rather than as construction. What makes it
 * read right is that it is REGULAR -- a column grid on 6 and 5, beams at two
 * consistent levels, and a floor plate that is a clean rectangle with a
 * clean edge rather than a ragged one. Debris is random. A frame is a grid.
 */
function framedWing(h) {
  const W = 17, ZE = 10
  const COLS = [0, 6, 11, W], ROWS = [0, 5, ZE]

  h.rect([0, 0], [W, ZE], -1, 'light_gray_concrete')              // the slab, poured
  h.box([0, -2, 0], [W, -2, ZE], 'cobblestone')

  for (const x of COLS) for (const z of ROWS) h.pillar(x, z, 0, 8, 'iron_block')
  for (const y of [4, 8]) {
    for (const z of ROWS) h.line([0, y, z], [W, y, z], 'iron_block')
    for (const x of COLS) h.line([x, y, 0], [x, y, ZE], 'iron_block')
  }
  // Starter bars on top of the top beam: the next storey, stubbed out.
  for (const x of COLS) for (const z of ROWS) h.set(x, 9, z, 'iron_block')
  for (const x of [3, 8, 14]) h.set(x, 9, 0, 'iron_block')

  /*
   * THE DECK, and it is exactly half. Plate over z 5..10 and nothing at all
   * over z 0..4, so from the ground you look up through the north bays at
   * open sky and from the deck edge you look straight down at the slab. The
   * edge is the whole reason the wing reads as unfinished rather than as
   * broken.
   */
  h.rect([0, 5], [W, ZE], 4, 'light_gray_concrete')
  h.rect([1, 6], [W - 1, 9], 4, 'gray_concrete')                  // the poured bay, darker

  // Two panels of cladding hung, so it is obvious what the rest will be.
  h.box([0, 0, 0], [0, 3, 4], 'white_concrete')
  h.box([W, 4, 8], [W, 7, ZE], 'white_concrete')
  h.box([W, 5, 9], [W, 6, 9], 'light_blue_stained_glass')

  loneDesk(h.at(7, 5, 5, 'patronus/first-hire'))
}

/*
 * EASTER EGG, ON TOP. Member of Technical Staff, Growth -- and the FIRST
 * growth hire, which is a sentence about scale, not about seniority.
 *
 * So: one desk, one screen, one crate, one lamp, alone on a floor plate with
 * no walls around it, at the very edge where the decking stops. Everything
 * else in this building is either finished or empty; this is the one place
 * that is occupied and unfinished at the same time, which is the job. The
 * lamp is the only light in the whole north wing and it is on, which from
 * the road at night is a single lit square in an open frame.
 */
function loneDesk(d) {
  d.set(0, 0, 0, 'smithing_table')
  d.set(0, 1, 0, 'black_concrete')
  d.set(0, 0, 1, 'stripped_bamboo_block')                         // the chair
  d.set(1, 0, 0, 'barrel')
  d.set(2, 0, 0, 'sea_lantern')                                   // the only light up here
  d.set(-1, 0, 0, 'lodestone')
}

/* ---------------------------------------------------------------- archive */

/*
 * EASTER EGG, UNDER. Written at the harness's own origin so the two line up
 * without anybody adding thirty-three to anything.
 *
 * THE VERTICAL BUDGET IS FOUR BLOCKS AND IT IS THE WHOLE DESIGN. Classic
 * Flat puts grass at -1, dirt at -2 and -3 and bedrock at -4, so there is
 * room for a two-block room under the lab floor and no room whatsoever for
 * a staircase. The way in is a PAIR of missing floor panels with a crate
 * under each -- a 1x1 shaft is a trap, because from the cellar floor the lab
 * is three blocks up and a jump is one.
 */
function archive(c) {
  c.box([1, -4, 12], [16, -4, 21], 'polished_deepslate')
  c.box([1, -3, 12], [16, -2, 21], 'air')
  c.box([1, -1, 12], [16, -1, 21], 'polished_andesite')
  for (const [a, b] of [[[1, 12], [1, 21]], [[16, 12], [16, 21]], [[1, 12], [16, 12]], [[1, 21], [16, 21]]]) {
    c.box([a[0], -3, a[1]], [b[0], -2, b[1]], 'deepslate_bricks')
  }

  // The way down and the way back up, which are the same two crates.
  c.set(3, -1, 13, 'air')
  c.set(4, -1, 13, 'air')
  c.set(4, -3, 13, 'deepslate_tiles')
  c.set(4, -2, 13, 'barrel')
  c.set(3, -3, 13, 'barrel')

  // The shelves. Finished runs, boxed, in rows, which is what an archive is.
  for (let z = 15; z <= 20; z += 2) {
    for (let x = 6; x <= 11; x++) {
      c.set(x, -3, z, 'barrel')
      if (x % 2 === 0) c.set(x, -2, z, 'barrel')
    }
  }
  c.set(2, -3, 16, 'chiseled_bookshelf')
  c.set(2, -3, 17, 'bookshelf')
  lights(c, [[4, -1, 16], [10, -1, 14], [10, -1, 20], [14, -1, 18]])

  miniArena(c.at(11, 0, 15, 'patronus/mini'))
}

/*
 * ...and the thing at the end of it, behind tinted glass: a five-by-five
 * gridworld with a wall, a bullseye and an agent standing in it.
 *
 * It is the arena outside, one storey down and one order of magnitude
 * smaller. The recursion is the joke and the joke is earned -- this entire
 * world was built by AI agents working for him, and the job the world is
 * about is evaluating AI agents. So the evaluation lab has, underneath it,
 * a sealed copy of the world the visitor is standing in, with something in
 * it being scored. Nothing says so. You just find it.
 */
function miniArena(m) {
  m.hollow([0, -4, 0], [5, -1, 5], { walls: 'polished_blackstone', ceiling: 'polished_blackstone' })
  m.box([1, -3, 1], [4, -2, 4], 'air')
  for (let x = 1; x <= 4; x++) {
    for (let z = 1; z <= 4; z++) m.set(x, -3, z, (x + z) % 2 ? 'white_concrete' : 'light_gray_concrete')
  }
  m.set(2, -3, 2, 'stone_bricks')                                 // the one wall
  m.set(3, -3, 4, 'stone_bricks')
  m.set(4, -3, 1, 'target')                                       // the goal
  m.set(1, -3, 3, 'iron_block')                                   // the agent, mid-episode
  m.set(1, -2, 3, 'light_blue_concrete')
  m.set(3, -2, 2, 'glowstone')                                    // lit from inside
  // The window, on the side the archive walks past.
  m.box([0, -3, 2], [0, -2, 3], 'tinted_glass')
}

/* ------------------------------------------------------------- scaffolding */

/*
 * SCAFFOLDING MUST BE BUILT, NOT SIMULATED -- there is no animation in this
 * world and nothing moves. So it is real bamboo tube: standards every three
 * or four along the road face of the frame, ledgers at two lifts, boards on
 * both lifts, and a stair of boards up the outside that a visitor can
 * actually climb to the second lift and step off onto the building.
 *
 * The deck over the stair bay is CUT AWAY on purpose. With it in, a climber
 * standing on the top step has their head inside the boards above them,
 * which is a scaffold you cannot use and which no plan view would ever show.
 */
function scaffolding(f) {
  const Z1 = 10

  // Two lifts of boards over the whole road face of the frame.
  f.rect([0, 0], [1, Z1], 4, 'bamboo_planks')
  f.rect([0, 0], [1, Z1], 8, 'bamboo_planks')

  /*
   * Standards and ledgers. The ledger heights are 2, 7 and 11 and they are
   * not decorative choices -- a player standing on the lower lift occupies
   * y = 5 and y = 6, so a ledger anywhere in that band is a scaffold you
   * cannot walk on, and no plan view would ever show it. Two blocks of
   * headroom over every boarded lift, or it is scenery.
   */
  for (const z of [0, 4, 9]) {
    f.pillar(0, z, 0, 12, 'bamboo_block')
    f.pillar(1, z, 0, 12, 'bamboo_block')
  }
  for (const y of [2, 7, 11]) {
    f.line([0, y, 0], [0, y, Z1], 'bamboo_block')
    f.line([1, y, 0], [1, y, Z1], 'bamboo_block')
  }
  for (const [y, z] of [[1, 2], [3, 6], [6, 2], [9, 6], [10, 2]]) f.set(1, y, z, 'stripped_bamboo_block')

  /*
   * THE STAIR TOWER, and it stands on the footpath, which is where a stair
   * tower stands. Four steps up the outside at x = 2, then a one-block step
   * west onto the boards and two more west into the building -- so a visitor
   * who has never seen this build can get from the pavement to the open
   * second floor without being told how.
   *
   * It is OUTSIDE the scaffold bay rather than inside it because the bay is
   * two blocks wide: put the stair in there and a standard lands in the
   * middle of it, and a ladder of bamboo you cannot actually climb is worse
   * than no ladder at all. This was found by walking the route on paper and
   * counting head height, which is the only way it is ever found.
   */
  for (let i = 0; i <= 3; i++) f.box([2, 0, Z1 - i], [2, i, Z1 - i], 'bamboo_mosaic')
  f.set(3, 0, Z1 + 1, 'orange_concrete')                          // the foot of it, marked

  f.set(0, 5, 3, 'shroomlight')                                   // site lighting, orange
  f.set(1, 10, 6, 'shroomlight')
}

/* ------------------------------------------------------------------ crane */

/*
 * The crane, and it is the tall legible thing -- from anywhere on the
 * southern half of the road you see a lattice mast, a jib over the open
 * frame, and a cladding panel hanging off the hook eight blocks above the
 * deck. One object, visible at render distance, that says "still going" in a
 * way no amount of ground detail can.
 *
 * The mast is climbable by nothing. That is deliberate: an unreachable crane
 * stays a silhouette, and a climbable one becomes a parkour course, which is
 * stage 8's job and not this one's.
 */
function crane(c) {
  const TOP = 22

  c.rect([-1, -1], [3, 3], -1, 'polished_blackstone')             // the base pad
  for (const x of [0, 2]) for (const z of [0, 2]) c.pillar(x, z, 0, TOP, 'iron_block')
  for (let y = 2; y <= TOP; y += 3) {
    c.hollow([0, y, 0], [2, y, 2], { walls: 'light_gray_concrete' })
  }
  c.set(1, 1, 1, 'shroomlight')

  // The slewing platform, the counter-jib and its weight.
  c.box([0, TOP + 1, 0], [2, TOP + 1, 2], 'light_gray_concrete')
  c.line([-6, TOP + 1, 1], [0, TOP + 1, 1], 'iron_block')
  c.box([-8, TOP, 0], [-6, TOP + 2, 2], 'black_concrete')
  c.line([-5, TOP + 3, 1], [-1, TOP + 3, 1], 'iron_block')

  // The jib, east over the frame, with a top chord and three hangers so it
  // is a truss rather than a stick.
  c.line([2, TOP + 1, 1], [21, TOP + 1, 1], 'iron_block')
  c.line([3, TOP + 4, 1], [15, TOP + 4, 1], 'iron_block')
  c.set(1, TOP + 4, 1, 'iron_block')
  c.set(2, TOP + 4, 1, 'iron_block')
  for (const x of [7, 11, 15]) c.pillar(x, 1, TOP + 2, TOP + 3, 'light_gray_concrete')

  // The hook, and what is on it: one cladding panel, mid-lift, over the
  // open frame. It is the single most legible "unfinished" object here.
  c.pillar(15, 1, TOP - 7, TOP, 'iron_block')
  c.box([14, TOP - 9, 0], [16, TOP - 8, 2], 'white_concrete')
  c.set(15, TOP - 8, 1, 'light_blue_stained_glass')

  c.set(1, TOP + 5, 1, 'magma_block')                             // the mast light
  c.set(21, TOP + 2, 1, 'magma_block')                            // and the jib tip
}

/* ------------------------------------------------------------------- yard */

/*
 * The materials yard between the building and the arena. Pallets of the
 * cladding that has not gone on yet, bundles of scaffold tube, floodlight
 * masts, hazard line, and the site hut -- which is small and furnished and
 * lit, because a hut you cannot go into is a prop.
 */
function yard(s) {
  // Pallets. Stacked, squared off, in a row: a yard is tidy, a ruin is not.
  for (const [x, z] of [[26, 4], [30, 4], [26, 9]]) {
    s.box([x, 0, z], [x + 2, 1, z + 2], 'white_concrete')
    s.box([x, 0, z], [x + 2, 0, z + 2], 'bamboo_mosaic')          // the pallet under it
  }
  s.box([31, 0, 9], [32, 2, 11], 'bamboo_block')                  // tube, bundled
  s.box([29, 0, 14], [30, 1, 16], 'glass')                        // glazing, crated
  s.box([29, 0, 17], [31, 0, 18], 'light_gray_concrete')
  s.set(31, 0, 14, 'furnace')                                     // the mixer
  s.box([31, 0, 15], [32, 1, 16], 'gray_concrete')

  // The hazard line between the yard and the arena. Orange and black, one
  // course, which is what tells a visitor where the site stops.
  // ...with a gap at z 21..22, which is where the arena's gate is. A hazard
  // line across the only way in is a fence, and this is a boundary.
  for (let z = 10; z <= 25; z++) {
    if (z === 21 || z === 22) continue
    s.set(24, 0, z, z % 2 ? 'orange_concrete' : 'black_concrete')
  }
  for (let x = 25; x <= 32; x++) s.set(x, 0, 25, x % 2 ? 'orange_concrete' : 'black_concrete')

  // Floodlight masts. These are what light the yard at night, and they are
  // the reason the open frame reads as a site after dark instead of a ruin.
  for (const [x, z] of [[25, 3], [32, 20], [25, 23]]) {
    s.pillar(x, z, 0, 6, 'iron_block')
    s.set(x, 7, z, 'light_gray_concrete')
    s.set(x, 8, z, 'sea_lantern')
  }

  siteHut(s.at(27, 0, 20, 'patronus/hut'))
}

/** The site hut. Five by four, one window, one door, a table, a stove, a
 *  crate and a light on. Small, and furnished anyway -- the house rule is
 *  that a visitor who walks in and finds a hollow box has been cheated, and
 *  it applies to sheds. */
function siteHut(u) {
  u.rect([0, 0], [5, 4], -1, 'bamboo_planks')
  u.hollow([0, 0, 0], [5, 3, 4], { walls: 'orange_terracotta', ceiling: 'polished_blackstone', inside: 'air' })
  u.clear([5, 0, 2], [5, 2, 2])                                   // the door, facing the road
  u.box([0, 2, 1], [0, 2, 3], 'glass')
  u.box([2, 2, 0], [3, 2, 0], 'glass')
  u.set(1, 0, 1, 'cartography_table')
  u.set(2, 0, 1, 'crafting_table')
  u.set(4, 0, 1, 'furnace')
  u.set(1, 0, 3, 'barrel')
  u.set(4, 0, 3, 'barrel')
  u.set(2, 3, 2, 'glowstone')
  u.set(3, 3, 2, 'glowstone')
}

/* ------------------------------------------------------------------ arena */

/*
 * THE FOUR ROOMS, AT 1:1, AND YOU CAN WALK IT.
 *
 * Four rooms is the oldest toy environment in reinforcement learning -- a
 * square split by two walls into four quadrants, one doorway in each wall
 * segment, a start state and a goal state. It has been in the literature
 * since 1999 and it is in every textbook, which is exactly why it is the
 * right thing to build: it is public, it is generic, it names nothing that
 * anyone is working on, and anybody who has touched RL recognises it from
 * the road.
 *
 * It is drawn as a MAP, not assembled. `pattern` on the xz plane lists
 * characters running east and rows running south, so the array below is a
 * plan with north at the top, and the same array is stamped three times at
 * three heights -- floor, knee, head. The source looks like the thing.
 *
 * And the reason it is here at all: an RL environment is a small world an
 * agent is dropped into to be scored. A visitor walks in through the gate on
 * the east side, past the agent, through two doorways, and stands on the
 * bullseye. Nothing tells them they are being graded. They are standing in
 * the diagram.
 */
const FOUR_ROOMS = [
  '=====================',
  '=.........#.........=',
  '=.........#....X....=',
  '=.........#.........=',
  '=...G...............=',
  '=.........#.........=',
  '=......X..#.........=',
  '=.........#.........=',
  '=.........#.........=',
  '=###.###########.###=',
  '=.........#.........=',
  '=.........#.........=',
  '=...A.X...#.........=',
  '=.........#.......S..',
  '=....................',
  '=.........#.........=',
  '=.........#..X......=',
  '=.........#.........=',
  '=====================',
]

function arena(a) {
  // The grid itself, which is half the picture: a chequerboard is what a
  // gridworld looks like on every slide it has ever appeared on.
  for (let x = 0; x <= 20; x++) {
    for (let z = 0; z <= 18; z++) a.set(x, -1, z, (x + z) % 2 ? 'white_concrete' : 'light_gray_concrete')
  }

  // Floor states: the goal, the start, and the hazards -- magma, which is
  // the only penalty tile in the palette that is also a light source, and so
  // is what keeps the arena readable after dark.
  a.pattern({
    at: [0, -1, 0], plane: 'xz',
    legend: { '=': null, '#': null, 'A': null, 'G': 'target', 'S': 'lime_concrete', 'X': 'magma_block' },
    rows: FOUR_ROOMS,
  })

  /*
   * Knee height and head height. The perimeter is a blackstone kerb with a
   * band of glass on top of it, so the environment is enclosed AND you can
   * see into it from the yard -- a solid two-block wall round a gridworld
   * hides the only thing worth showing.
   */
  a.pattern({
    at: [0, 0, 0], plane: 'xz',
    legend: { '=': 'polished_blackstone', '#': 'stone_bricks', 'G': null, 'A': 'iron_block', 'S': null, 'X': null },
    rows: FOUR_ROOMS,
  })
  a.pattern({
    at: [0, 1, 0], plane: 'xz',
    legend: { '=': 'light_blue_stained_glass', '#': 'stone_bricks', 'G': null, 'A': 'iron_block', 'S': null, 'X': null },
    rows: FOUR_ROOMS,
  })

  // The agent's head, and the goal beacon above the bullseye -- a column of
  // yellow glass lit from inside, tall enough to clear the room walls so you
  // can see where you are going from anywhere in the environment.
  a.set(4, 2, 12, 'light_blue_concrete')
  a.set(3, 1, 12, 'iron_block')                                   // arms, so it reads as a figure
  a.set(5, 1, 12, 'iron_block')
  /* The beacon stands in the cell NEXT to the goal, not on it. A glowing
   * column on top of the bullseye is a goal state you cannot enter, which is
   * the one thing a goal state has to be. */
  a.set(3, -1, 4, 'gold_block')
  a.set(3, 0, 4, 'glowstone')
  a.pillar(3, 4, 1, 4, 'yellow_stained_glass')
  a.set(3, 5, 4, 'glowstone')

  // The start pad, marked the way a start state is marked, and lit.
  a.set(17, 0, 13, 'lodestone')
  a.set(18, -1, 14, 'lime_concrete')
  a.set(17, -1, 14, 'lime_concrete')
  a.set(19, 0, 12, 'sea_lantern')

  // Corner lights on the perimeter, so the whole enclosure has an edge you
  // can find at night from outside it.
  for (const [x, z] of [[0, 0], [20, 0], [0, 18], [20, 18]]) a.set(x, 2, z, 'sea_lantern')
}

/*
 * The observers' gallery, on the arena's east side, four blocks up. Two
 * steps, a deck, a rail, a lamp, a clipboard on a stand and a figure in
 * black already standing at the rail looking down at the agent.
 *
 * You climb up to see the gridworld whole -- and the moment you are up there
 * you are the second figure at the rail. That is the entire argument for
 * building an evaluation stage as a place rather than as a diagram, and it
 * costs about forty blocks.
 */
function gallery(g) {
  g.box([0, 0, 0], [1, 2, 7], 'light_gray_concrete')              // the substructure
  g.box([0, 3, 0], [1, 3, 7], 'polished_blackstone')              // the deck, walked at y = 4
  g.box([1, 4, 0], [1, 4, 7], 'polished_blackstone')              // the rail, on the back edge
  g.clear([1, 4, 3], [1, 4, 5])                                   // ...opened where the steps land

  /* Four steps, each exactly one block, landing level with the deck. The
   * first draft climbed to y = 3 and left a two-block jump onto the boards,
   * which is a gallery nobody reaches. Count the steps, always. */
  for (let i = 0; i <= 3; i++) g.box([2, 0, 1 + i], [2, i, 1 + i], 'light_gray_concrete')

  g.pillar(1, 2, 4, 5, 'black_concrete')                          // the observer at the rail
  g.set(1, 6, 2, 'light_gray_concrete')
  g.set(1, 4, 1, 'cartography_table')
  g.set(0, 4, 7, 'sea_lantern')
  g.set(0, 4, 0, 'sea_lantern')
}

/* ------------------------------------------- the retired environment (egg) */

/*
 * EASTER EGG, BEHIND. In the far north-west corner, behind the arena, with
 * the building and the crane and nineteen rows of gridworld between it and
 * the road. Nothing points at it. You find it by walking the haul route west
 * past the arena's north wall until the site runs out.
 *
 * WHAT IT IS. A decommissioned test cell, cracked grey glass, one red lamp.
 * Inside: a growth chart in green going up and to the right; four identical
 * agents standing in front of it; two identical copies of the same little
 * experiment laid out on the floor in front of them, A and B, being run
 * forever; and a red line coming down through all of it.
 *
 * WHY IT IS ALLOWED TO BE HERE. This is HIS view of HIS OWN discipline, not
 * the company's view of anything. He is on record being pessimistic about
 * growth and marketing -- that AI is about to gut it, that infinite A/B
 * testing and simulation is coming, and that even getting people to care
 * about something may not survive as a defensible skill. He is the first
 * growth hire at an evaluation company and he thinks growth is one of the
 * things that is about to get evaluated. That is the most self-aware thing
 * on this road, so it is built, and it is built where only somebody who went
 * looking will ever stand in front of it.
 *
 * The chart is on the NORTH wall and faces south for the reason in the
 * header: a viewer facing north has +x on their right, so an `xy` pattern
 * comes out the way it is drawn. On a west-facing wall it would be mirrored.
 */
function retiredEnvironment(e) {
  e.rect([0, 0], [10, 6], -1, 'polished_deepslate')
  e.hollow([0, 0, 0], [10, 6, 6], { walls: 'polished_blackstone', ceiling: 'polished_blackstone', inside: 'air' })
  e.clear([10, 0, 3], [10, 2, 3])                                 // the door, on the far side
  e.box([10, 1, 1], [10, 3, 2], 'gray_stained_glass')             // the window, gone grey
  e.box([10, 1, 4], [10, 3, 5], 'gray_stained_glass')
  e.set(5, 6, 3, 'magma_block')                                   // the two lights left on
  e.set(2, 6, 3, 'magma_block')

  /*
   * The chart, painted ON the north wall rather than hung in front of it, so
   * it is the wall. Four bars, each taller than the last, and a red line
   * falling across them from the top left to the floor on the right. Read it
   * in the source: the rows stack UP the page, so the last row is y = 0 and
   * the drawing below is the wall.
   */
  e.pattern({
    at: [1, 0, 0], plane: 'xy',
    legend: { '#': 'lime_concrete', 'R': 'red_concrete' },
    rows: [
      'RR.....#.',
      '..RR...#.',
      '....R#.#.',
      '...#.R.#.',
      '.#.#.#R#.',
      '.#.#.#.RR',
    ],
  })

  /*
   * The four identical agents, in a row, facing the chart. Identical on
   * purpose: the thing he expects to be automated is not one experiment, it
   * is the running of the same experiment a million times. So there are four
   * of the same figure and nothing whatsoever distinguishes any of them.
   */
  for (const x of [2, 4, 6, 8]) {
    e.pillar(x, 3, 0, 1, 'iron_block')
    e.set(x, 2, 3, 'light_gray_concrete')
  }

  /*
   * ...and the two copies of the experiment they are running, laid into the
   * floor behind them. A and B. Same grid, same walls, same goal, forever.
   */
  for (const x0 of [2, 7]) {
    for (let x = x0; x <= x0 + 2; x++) {
      for (let z = 4; z <= 5; z++) e.set(x, -1, z, (x + z) % 2 ? 'white_concrete' : 'light_gray_concrete')
    }
    e.set(x0 + 2, -1, 5, 'gold_block')
    e.set(x0, -1, 4, 'red_concrete')
  }
}

/* -------------------------------------------------- the board, and the year */

/*
 * The pass/fail board, by the road, at EYE LEVEL -- board from y = 1 to
 * y = 5 and the cells one block proud of it, which is the geometry road.js
 * had to learn the hard way and there is no reason to learn it twice. A
 * walking player's eyes are at about 1.6 and they are looking at the road.
 *
 * Five columns of five results, green and red, and the TOP ROW IS GREY.
 * That is the stage in one object: this is an evaluation company, here is a
 * scoreboard, and the most recent row has not come back yet. Grey is not a
 * bad grade. It is an unfinished one, which is the only grade this plot is
 * entitled to.
 *
 * Colour and nothing else, deliberately: see the note on mirroring at the
 * top. A glyph on this face would come out backwards; a green square is a
 * green square from either side.
 */
function boardByTheRoad(s) {
  s.pillar(51, 20, 0, 0, 'polished_blackstone')
  s.pillar(51, 26, 0, 0, 'polished_blackstone')
  s.box([51, 1, 20], [51, 5, 26], 'polished_blackstone')
  s.set(51, 6, 23, 'sea_lantern')
  s.pattern({
    at: [52, 1, 21], plane: 'zy',
    legend: { '#': 'lime_concrete', '.': 'red_concrete', '?': 'gray_concrete' },
    rows: [
      '?????',
      '##.##',
      '#.###',
      '#####',
      '##.##',
    ],
  })
}

/*
 * THE HOARDING, and the only text on the plot: 2026, the year the site
 * opened, which is the year this stage starts and the year it is still in.
 *
 * It faces SOUTH, which is two decisions at once. It is the first thing a
 * visitor walking north sees of this plot, before the building resolves.
 * And south-facing is the only orientation on this side of the road where a
 * drawn glyph comes out unmirrored -- facing north, +x is the reader's
 * right, so an `xy` pattern reads the way it is written. Every other sign
 * here is colour for exactly that reason.
 */
function hoarding(s) {
  s.pillar(35, 26, 0, 6, 'polished_blackstone')
  s.pillar(51, 26, 0, 6, 'polished_blackstone')
  s.box([35, 1, 26], [51, 5, 26], 'polished_blackstone')
  for (let x = 35; x <= 51; x++) s.set(x, 0, 26, x % 2 ? 'orange_concrete' : 'black_concrete')
  s.set(35, 6, 26, 'sea_lantern')
  s.set(51, 6, 26, 'sea_lantern')

  let x = 36
  for (const d of [2, 0, 2, 6]) {
    s.pattern({
      at: [x, 1, 27], plane: 'xy',
      legend: { '#': 'light_blue_concrete' },
      rows: DIGITS[d],
    })
    x += 4
  }
}

/* ------------------------------------------------------------------ lights */

/** Recessed ceiling lights. A glowstone swapped into the ceiling plate reads
 *  as a fitting; a glowstone on the floor reads as a glowing rock. */
function lights(k, spots) {
  for (const [x, y, z] of spots) k.set(x, y, z, 'glowstone')
}
