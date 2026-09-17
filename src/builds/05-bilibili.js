/*
 * STAGE 5 -- BILIBILI. The experiment.
 *
 * ------------------------------------------------------------------------
 * WHAT IS HERE, AND WHY IT IS HERE. Everything below is from the owner's own
 * record. Nothing factual is invented -- the licence this build takes is in
 * how a fact is DRAWN, never in what the fact is.
 *
 *   a Chinese courtyard      Bilibili is China's cultural equivalent of
 *     compound, gate,        YouTube, and the channel started in early 2025.
 *     courtyard, hall,       The compound is homage: upturned tiled roofs,
 *     pagoda                 red timber, a moon gate, stone lions, a pagoda.
 *   the two columns at       100k followers was the TARGET. 280k is where it
 *     the gate               is now. One block is ten thousand people, so the
 *                            north column is 10 blocks of gold and the south
 *                            column is the same 10 blocks of gold with 18 of
 *                            pink on top of them. 280,000, countable, and the
 *                            gold band is the line he was aiming at.
 *   twenty sea lanterns      just under 20 million views as of September
 *     down the street        2026. One lantern is one million. Ten a side.
 *   the hall, and the        the room the videos got made in: an edit bay,
 *     studio inside it       a lit set, a camera, a backdrop.
 *   the pagoda               five months of posting became a thing that
 *                           outlived the experiment -- he still posts every
 *                           couple of months. The tower is the part that
 *                           stayed standing.
 *   three steles in the      language is a running thread in his record and
 *     courtyard              this is the stage where a foreign-language
 *                            audience is the entire point. Chinese: finished
 *                            and lit. Spanish: his own word for it is bad, so
 *                            it is the cracked one. Korean: currently being
 *                            attempted, so it is half-built, with the
 *                            scaffolding still up.
 *
 * THE POINT OF THE WHOLE PLOT, which is why the hall has a cellar under it:
 * this was not a content career, it was an experiment. The post-MrBeast
 * consensus says audience growth is a solved problem if you iterate against
 * data with some taste. He thought that was a lot of assumptions, so he
 * tested it on himself -- and picked a market his content could fit rather
 * than fitting content to a market. His own summary of himself is that he
 * builds things to find out whether something is true. The decision that
 * settled this one got made downstairs, before a single video was shot.
 *
 * THE EASTER EGGS, three of them, one for each direction you have to look:
 *
 *   UNDER   the cellar under the hall, reached through the two missing floor
 *           boards beside the edit desk. The floor down there is the log: a
 *           12 x 6 grid of pink, seventy-two days, with the last one gold --
 *           the day the 100k landed. Past it, the market map: one lit patch
 *           picked out of five, which is the assumption the whole experiment
 *           was actually about.
 *   BEHIND  the set in the hall is ONE BLOCK THICK. Walk round the end of the
 *           backdrop and the back of it is a furnace, a barrel, a stack of
 *           logs and a dirt block, which is what is behind every set.
 *   ON TOP  the shrine in the pagoda's top chamber, up the spiral of steps
 *           inside it: a target block on a block of gold, lit by two sea
 *           lanterns. You have to climb twenty blocks in the dark-ish to
 *           find out that the thing at the top is just the target again.
 * ------------------------------------------------------------------------
 * ORIENTATION. The plot is 56 wide (local x 0..55) and 28 deep (z 0..27).
 * +x runs EAST toward the road, +z runs south, y = 0 is the air above the
 * grass and y = -1 IS the grass. The road is the whole east edge, so the
 * compound's gate, its two columns and its lantern-lit forecourt all face
 * +x, and the quiet things -- the bamboo, the far end of the hall -- are
 * pushed west where they read as background.
 *
 * THE AXIS is z = 13..15. Road, forecourt, moon gate, gate passage,
 * courtyard, hall door, edit bay. A visitor who walks straight west off the
 * road ends up at the desk, which is the whole idea.
 */

/* The palette, named once so the compound is one building and not nine.
 * Bilibili's own identity is pink and blue; a Chinese roof is glazed tile and
 * red timber. The two meet at the gatehouse, which is the thing at the road. */
const TILE = 'gray_concrete'            // the hall's roof: plain glazed tile
const TILE_BLUE = 'light_blue_concrete' // the pagoda's: bilibili blue
const TILE_PINK = 'pink_concrete'       // the gatehouse's: bilibili pink
const TIMBER = 'red_concrete'           // columns, brackets, the whole frame
const PLASTER = 'white_concrete'        // the walls between the columns
const PAVING = 'polished_andesite'
const FLOOR = 'planks'                  // the oak ones. NOT 'oak_planks'.

export function build(s) {
  forecourt(s)
  compoundWall(s)
  columns(s)
  gatehouse(s.at(44, 0, 10, 'bilibili/gate'))
  courtyard(s)
  hall(s.at(10, 0, 6, 'bilibili/hall'))
  cellar(s.at(10, 0, 6, 'bilibili/cellar'))
  pagoda(s.at(33, 0, 3, 'bilibili/pagoda'))
  walkway(s)
  bambooGrove(s)
}

/* --------------------------------------------------------------- forecourt */

/*
 * The street outside the gate, and the twenty lanterns.
 *
 * Laid at y = -1 in place of the grass, for the reason the README gives at
 * length: a pavement you step UP onto is a pavement you trip over, and a
 * doorway one block off the ground is the commonest way a voxel building ends
 * up feeling like a model of a building.
 *
 * JUST UNDER 20 MILLION VIEWS, as of September 2026. One sea lantern is one
 * million, ten down each side of the forecourt, set flush into the paving so
 * they light the street rather than sitting on it. They are countable from
 * the road and from the gate, which is the only test that matters: a number
 * you have to be told is not a number the world contains.
 */
function forecourt(s) {
  s.rect([51, 0], [55, 27], -1, 'smooth_stone')
  s.rect([51, 12], [55, 16], -1, PAVING)           // the axis, in a darker stone
  /* x = 51 and x = 55, and NOT 52 or 54, which is not a detail. The column
   * plinths below are three wide and they are drawn after this; the first
   * draft put a lantern row straight under them and paved two of the twenty
   * out of existence. A count that only works if nothing else moves is not a
   * count -- found by reading the plot back in node, not by looking at it. */
  for (let z = 5; z <= 23; z += 2) {
    s.set(55, -1, z, 'sea_lantern')                // ten, road side
    s.set(51, -1, z, 'sea_lantern')                // ten, wall side
  }
}

/* -------------------------------------------------------------------- wall */

/*
 * The compound wall. Red, three courses, capped with a course of tile that
 * overhangs by one on both faces -- the overhang is the single cheapest thing
 * that stops a voxel wall reading as a fence, because it throws a shadow line
 * along its whole length.
 *
 * `hollow` with only `walls` set draws a RING and not a box, which is the
 * distinction that matters here: a box would pave the entire compound in red
 * concrete a block above its own ground.
 */
function compoundWall(s) {
  s.hollow([8, 0, 2], [50, 2, 25], { walls: TIMBER })
  s.hollow([7, 3, 1], [51, 3, 26], { walls: TILE })          // the capping course
  s.hollow([7, 4, 1], [51, 4, 26], { walls: 'red_terracotta' })
  s.clear([50, 0, 16], [50, 4, 12])                          // the gate's hole in it
}

/* ----------------------------------------------------------------- columns */

/*
 * THE NUMBERS, standing at the gate where a pair of ceremonial columns would
 * stand at a Chinese one.
 *
 * ONE BLOCK IS TEN THOUSAND FOLLOWERS, and that is the whole design.
 *
 *   south, z = 22   THE TARGET. Ten blocks of gold. 100,000.
 *   north, z = 6    WHERE IT IS. The same ten blocks of gold, and then
 *                   eighteen of pink on top of them. 280,000.
 *
 * SOUTH FIRST, because the visitor spawns at the south end of the road and
 * walks north through time. You pass the number he aimed at and then you pass
 * what happened. They stand at the two ends of the forecourt rather than
 * either side of the door because the guardian lions want that spot and
 * because 29 blocks of column two paces from your nose is a wall.
 *
 * Drawing both columns with the same gold base at the same height is the
 * point: you do not have to count to see it, because the gold band on the
 * tall one stops exactly level with the top of the short one and the pink
 * keeps going. Count if you want to -- the blocks are there.
 *
 * REJECTED -- a single 28-block column with a gold line scored across it at
 * 10. Cheaper, and it loses the thing that makes this readable from a
 * hundred blocks away, which is two heights side by side.
 *
 * The 72 is not here. Seventy-two days is a private number -- it is the log
 * in the cellar, and you have to go and find it.
 */
function columns(s) {
  targetColumn(s.at(53, 0, 22, 'bilibili/100k'), 10, null)
  targetColumn(s.at(53, 0, 6, 'bilibili/280k'), 10, 18)
}

/** One column: a stone plinth, `gold` blocks of gold, then `pink` of pink if
 *  there are any, then a lantern on the top so it is legible at night. */
function targetColumn(c, gold, pink) {
  c.rect([-1, -1], [1, 1], -1, PAVING)
  c.hollow([-1, 0, -1], [1, 0, 1], { walls: 'smooth_stone' })   // the plinth, a ring
  c.pillar(0, 0, 0, 0, 'smooth_stone')
  for (let i = 0; i < gold; i++) c.set(0, 1 + i, 0, 'gold_block')
  if (pink) for (let i = 0; i < pink; i++) c.set(0, 1 + gold + i, 0, 'pink_concrete')
  const top = 1 + gold + (pink || 0)
  c.set(0, top, 0, 'sea_lantern')
  c.hollow([-1, top, -1], [1, top, 1], { walls: TIMBER })       // a little cap ring
}

/* --------------------------------------------------------------- gatehouse */

/*
 * The gate, which is the facade. Written at its own north-west corner, so
 * every number below is small and the whole building moves by editing one
 * line in `build`.
 *
 * A moon gate -- the circular doorway -- is the one piece of Chinese
 * architecture that survives being made of cubes, because a five-by-five
 * circle with its corners knocked off is unmistakably a circle. It is drawn
 * with `pattern` on the zy plane, which is the plane that faces the road, and
 * the listing below LOOKS LIKE THE HOLE IT CUTS.
 */
function gatehouse(g) {
  const W = 6, D = 8                       // x 0..6, z 0..8
  g.rect([0, 0], [W, D], -1, PAVING)
  g.hollow([0, 0, 0], [W, 5, D], { walls: PLASTER, ceiling: 'dark_oak_planks', inside: 'air' })
  /* Corners only. The first draft also put a column at [0, 4] and [W, 4],
   * which is the middle of the gate -- a red post standing in the doorway, on
   * the axis, in the one place a visitor is guaranteed to walk. */
  for (const [x, z] of [[0, 0], [W, 0], [0, D], [W, D]]) g.pillar(x, z, 0, 5, TIMBER)

  /*
   * The east face, head on from the road. `.` leaves whatever is there alone,
   * so the circle is cut out of the wall the call above already built and the
   * legend only has to name what changes.
   */
  g.pattern({
    at: [W, 0, 0], plane: 'zy',
    legend: { '#': PLASTER, 'o': 'air', 'P': 'pink_concrete', 'B': 'light_blue_concrete' },
    rows: [
      '#PPBBBPP#',
      '##ooooo##',
      '#ooooooo#',
      '#ooooooo#',
      '#ooooooo#',
      '##ooooo##',
    ],
  })
  g.clear([0, 0, 3], [0, 3, 5])            // and straight through, into the courtyard
  /*
   * AND THE WALL CAP COMES OFF IN FRONT OF THE GATE. The compound wall's
   * capping courses sit at y = 3 and 4 and overhang a block east -- which is
   * one block in front of this face, at exactly the height of the arch's
   * shoulders. From the road the moon gate read as a rectangular hole with a
   * black beam across it: the circle was there and nothing could see it.
   * Taking the cap out over the gatehouse is also what a real gate does --
   * the gate tower stands proud of the wall it is set into.
   */
  g.clear([W + 1, 3, -1], [W + 1, 5, D + 1])

  // The passage: red columns down both sides, lit, so the gate is a room and
  // not a hole. The lanterns are at y = 4, over head height and out of reach.
  for (const z of [2, 6]) {
    g.pillar(1, z, 0, 4, TIMBER)
    g.pillar(5, z, 0, 4, TIMBER)
  }
  g.set(3, 4, 2, 'sea_lantern')
  g.set(3, 4, 6, 'sea_lantern')
  g.set(3, 4, 4, 'glowstone')

  // THE LIONS. One each side of the gate, outside, facing the road: a block
  // of stone, a head, and a paw out front. Two blocks tall, which is as much
  // lion as anybody gets at this scale and enough to read as a pair.
  lion(g.at(W + 2, 0, 1, 'bilibili/lion'))     // plot (52, 11)
  lion(g.at(W + 2, 0, 7, 'bilibili/lion'))     // plot (52, 17)

  tieredRoof(g, [0, 0], [W, D], 6, TILE_PINK, PLASTER)
}

/*
 * A guardian lion. Not a statue so much as an agreement to read four blocks
 * as one, which is what every voxel animal is.
 *
 * EVERY BLOCK OF IT IS ON THE GROUND, and the first draft's were not: the paw
 * and the haunch were at y = 1 with nothing under them, which from the road
 * at eye level read as a grey plus sign hanging in the air beside the gate.
 * A plan view cannot show you that. A screenshot from where a visitor stands
 * shows you nothing else.
 */
function lion(l) {
  l.set(0, 0, 0, 'smooth_stone')           // body
  l.set(0, 1, 0, 'chiseled_quartz_block')  // head
  l.set(1, 0, 0, 'polished_andesite')      // the forepaws, out toward the road
  l.set(0, 0, -1, 'polished_andesite')     // the haunch
}

/* --------------------------------------------------------------- courtyard */

/*
 * The courtyard between the gate and the hall: paving, a pool with a bridge
 * over it, and the three steles.
 */
function courtyard(s) {
  s.rect([29, 6], [43, 24], -1, 'smooth_stone')
  s.rect([29, 12], [43, 16], -1, PAVING)                  // the axis, again

  // The pool. South of the axis so the walk to the hall door is dry, with a
  // stone kerb round it and a single plank of bridge across the short way.
  s.hollow([32, -1, 18], [38, -1, 22], { walls: PAVING })
  s.box([33, -1, 19], [37, -1, 21], 'water')
  s.box([35, -1, 19], [35, -1, 21], 'dark_oak_planks')     // the bridge
  s.set(31, 0, 18, 'sea_lantern')
  s.set(39, 0, 22, 'sea_lantern')

  /*
   * THE THREE LANGUAGES, as three steles along the north side of the
   * courtyard. Language is a running thread in his record and this is the
   * stage where a foreign-language audience is the entire point, so the three
   * of them are told apart by their CONDITION and not by a label:
   *
   *   Chinese   red and gold, finished, lit from the top. This one worked.
   *   Spanish   his own word for it is bad. So this one is cobble, cracked,
   *             half sunk, and nothing lights it.
   *   Korean    currently being attempted -- white, with the blue and red of
   *             a taegeuk, and the scaffolding is still up around it with the
   *             crafting table sat next to it.
   */
  /* z = 12, not z = 9. The first draft stood them along z = 9 and two of the
   * three were INSIDE the pagoda's footprint, which runs x 33..39 -- the
   * pagoda is stamped after the courtyard, so it quietly ate the Spanish one
   * and most of the Korean one. Nothing about that is visible in a screenshot
   * of a thing that is not there; it came out of reading the plot back. */
  const done = s.at(31, 0, 12, 'bilibili/stele-zh')
  done.pillar(0, 0, 0, 3, 'red_concrete')
  done.set(0, 4, 0, 'gold_block')
  done.set(0, 5, 0, 'sea_lantern')
  done.rect([-1, -1], [1, 1], -1, PAVING)

  const bad = s.at(35, 0, 12, 'bilibili/stele-es')
  bad.pillar(0, 0, 0, 1, 'cobblestone')
  bad.set(0, 2, 0, 'mossy_cobblestone')
  bad.set(1, 0, 0, 'cobblestone')                          // a piece fallen off it
  bad.rect([-1, -1], [1, 1], -1, 'gravel')

  const trying = s.at(39, 0, 12, 'bilibili/stele-ko')
  trying.pillar(0, 0, 0, 2, 'white_concrete')
  trying.set(0, 3, 0, 'light_blue_concrete')
  trying.set(0, 4, 0, 'red_concrete')                      // unfinished: no cap yet
  /* Both scaffold posts go NORTH of the stele, not one north and one south.
   * The south one stood at z = 13, which is the gate-to-hall sightline -- the
   * first thing you see walking in through the moon gate was a scaffolding
   * pole in the middle of the axis. Visible from the gate and from nowhere
   * else, which is the entire argument for standing where a visitor stands. */
  trying.pillar(-1, -1, 0, 3, 'oak_log')                   // the scaffolding, still up
  trying.pillar(1, -1, 0, 3, 'oak_log')
  trying.line([-1, 3, -1], [1, 3, -1], 'oak_log')
  trying.set(1, 0, -2, 'crafting_table')
  trying.set(0, 0, -1, 'torch')
  trying.rect([-1, -1], [1, 1], -1, PAVING)
}

/* -------------------------------------------------------------------- hall */

/*
 * THE HALL, and the studio inside it. Written at its own corner: x 0..18,
 * z 0..16 here is x 10..28, z 6..22 on the plot.
 *
 * INTERIORS MATTER, and this is the room the whole stage is about -- it is
 * where the videos got made. So it has an edit bay at the north end, a lit
 * set at the south end, a camera between them pointed the right way, and a
 * cellar under the floor.
 *
 * The floor boards go down at y = -1, IN PLACE OF the grass, so the inside of
 * the hall is at the same height as the courtyard outside it.
 */
function hall(h) {
  const W = 18, D = 16
  h.rect([0, 0], [W, D], -1, FLOOR)
  h.hollow([0, 0, 0], [W, 6, D], { walls: PLASTER, ceiling: 'dark_oak_planks', inside: 'air' })

  // The timber frame: a red column at every corner and every four blocks
  // down the two long walls, which is what makes this a hall and not a shed.
  for (const z of [0, 4, 8, 12, D]) {
    h.pillar(0, z, 0, 6, TIMBER)
    h.pillar(W, z, 0, 6, TIMBER)
  }
  for (const x of [0, 6, 12, W]) {
    h.pillar(x, 0, 0, 6, TIMBER)
    h.pillar(x, D, 0, 6, TIMBER)
  }
  h.hollow([0, 5, 0], [W, 5, D], { walls: TIMBER })        // the lintel, all the way round

  // The east front, facing the courtyard and the gate and the road beyond it.
  // The door is on the axis; the windows are latticed in blue, which is the
  // one place the brand colour gets to be the window frame.
  h.pattern({
    at: [W, 0, 2], plane: 'zy',
    legend: { '#': PLASTER, 'W': 'light_blue_stained_glass', '=': TIMBER, 'o': 'air' },
    rows: [
      '=============',
      '#WW#####WW###',
      '#WW#####WW###',
      '#####ooo#####',
      '#WW##ooo#WW##',
      '#WW##ooo#WW##',
    ],
  })
  for (const z of [3, 5, 11, 13]) {                        // and glass on the other three
    h.box([0, 2, z], [0, 3, z], 'light_blue_stained_glass')
  }
  for (const x of [3, 9, 15]) {
    h.box([x, 2, 0], [x, 3, 0], 'light_blue_stained_glass')
    h.box([x, 2, D], [x, 3, D], 'light_blue_stained_glass')
  }

  studio(h, W, D)
  tieredRoof(h, [0, 0], [W, D], 7, TILE, TIMBER)
}

/*
 * Inside the hall.
 *
 * North end is the EDIT BAY -- a long desk, three dark screens, and a wall of
 * bookshelves, which is the only honest way a voxel room says "data". South
 * end is the SET. Between them, on the axis, the camera.
 */
function studio(h, W, D) {
  // The edit bay. Barrels and shelves under a plank desktop, screens on it.
  h.box([3, 0, 2], [10, 0, 2], 'dark_oak_planks')
  h.set(3, 0, 2, 'barrel')
  h.set(10, 0, 2, 'barrel')
  for (const x of [5, 6, 7, 8]) h.set(x, 1, 2, 'black_concrete')
  h.set(6, 1, 2, 'light_blue_concrete')                    // one screen still on
  h.set(8, 1, 2, 'pink_concrete')
  h.box([2, 0, 1], [11, 1, 1], 'bookshelf')                // the shelves behind it

  /*
   * THE WAY DOWN. Two boards missing out of the floor beside the desk, and
   * two crates under them to step down onto -- the same trick stage 1 uses,
   * for the same reason: from a cellar floor the boards are three blocks up
   * and a jump is one, so a 1x1 shaft is a hole you cannot climb out of.
   * `cellar` runs after this and puts the rest of the room in.
   */
  h.set(12, -1, 2, 'air')
  h.set(13, -1, 2, 'air')

  /*
   * THE SET. A backdrop wall in bilibili's pink and blue, two lamps on quartz
   * stands, and a stool. The lamps are what makes this read as a set rather
   * than as a painted wall: nothing else in the hall is lit from the side.
   */
  h.pattern({
    at: [5, 0, 12], plane: 'xy',
    legend: { 'P': 'pink_concrete', 'B': 'light_blue_concrete', 'W': 'white_concrete' },
    rows: [
      'BBBBBBBBB',
      'BPPPPPPPB',
      'PPWWWWWPP',
      'PPWWWWWPP',
      'PPPPPPPPP',
    ],
  })
  h.pillar(4, 10, 0, 2, 'quartz_pillar')
  h.set(4, 3, 10, 'sea_lantern')
  h.pillar(14, 10, 0, 2, 'quartz_pillar')
  h.set(14, 3, 10, 'sea_lantern')
  h.set(9, 0, 10, 'smooth_quartz')                         // the stool

  /*
   * THE CAMERA, on the axis, pointing SOUTH at the set -- which is the sort
   * of thing that is obviously right in the source and obviously wrong in a
   * screenshot if you get it backwards. Tripod, body, glass lens on the set
   * side of the body.
   */
  h.pillar(9, 6, 0, 1, 'dark_oak_wood')
  h.set(9, 2, 6, 'black_concrete')
  h.set(9, 2, 7, 'glass')                                  // the lens, facing the set
  h.set(8, 2, 6, 'black_concrete')

  /*
   * EASTER EGG, BEHIND. The set is ONE BLOCK THICK. Walk round either end of
   * the backdrop -- there is a two-block gap between it and the south wall --
   * and the back of it is a furnace, a barrel, a stack of logs, a dirt block
   * and a torch. That is what is behind every set that ever looked like that
   * from the front, and it is the closest this plot comes to saying out loud
   * that the channel was an experiment rather than a career.
   */
  h.set(6, 0, 14, 'furnace')
  h.set(7, 0, 14, 'barrel')
  h.set(9, 0, 14, 'dirt')
  h.pillar(11, 14, 0, 2, 'oak_log')
  h.set(12, 0, 14, 'crafting_table')
  h.set(12, 1, 14, 'torch')
  h.set(13, 0, 14, 'oak_log')

  // Recessed ceiling lights: glowstone swapped into the plank ceiling, which
  // reads as a fitting rather than as a glowing rock on the floor.
  for (const x of [4, 9, 14]) for (const z of [3, 8, 13]) h.set(x, 6, z, 'glowstone')
}

/* ------------------------------------------------------------------ cellar */

/*
 * EASTER EGG, UNDER. Written at the hall's own origin so the two line up
 * without anybody adding six to anything.
 *
 * THE VERTICAL BUDGET IS FOUR BLOCKS AND THAT IS THE WHOLE DESIGN. Classic
 * Flat puts grass at y = -1, dirt at -2 and -3 and bedrock at -4, so there is
 * room for a two-block-high room with the hall's own floor as its ceiling and
 * a stone floor over the bedrock, and no room at all for a staircase.
 *
 * What is down here is THE LOG. The channel hit 100,000 followers in 72 days,
 * and the seventy-two days are the floor: a 12 x 6 grid of pink concrete you
 * walk across, with the seventy-second block gold. It is the only place the
 * number 72 appears anywhere on this plot, it is countable, and you have to
 * drop through a hole in a floor to count it.
 */
function cellar(c) {
  c.box([2, -4, 1], [16, -4, 14], 'stone')                 // a floor over the bedrock
  c.box([2, -3, 1], [16, -2, 14], 'air')                   // two blocks of headroom
  c.box([2, -1, 1], [16, -1, 14], FLOOR)                   // under the hall's own boards
  c.hollow([2, -3, 1], [16, -2, 14], { walls: 'stone_bricks' })

  // The way down and the way out: the two boards `studio` took out, and two
  // crates under them. Step down, step down, and back up the same way.
  c.set(12, -1, 2, 'air')
  c.set(13, -1, 2, 'air')
  c.set(13, -3, 2, 'cobblestone')
  c.set(13, -2, 2, 'barrel')
  c.set(12, -3, 2, 'barrel')

  /*
   * SEVENTY-TWO DAYS. Twelve across, six rows down, one block a day, laid
   * into the floor you are standing on. The last one -- the far corner,
   * day 72 -- is gold, because that is the day the hundred thousand landed.
   *
   * THE ROWS ARE RULED APART BY A COURSE OF STONE, and they have to be. The
   * first version laid the seventy-two blocks edge to edge and the whole
   * thing read as a pink carpet: the number was there and nobody could count
   * it, which is the same as it not being there. A gap between rows turns a
   * rectangle into twelve, six times.
   */
  for (let i = 0; i < 72; i++) {
    const x = 3 + (i % 12), z = 3 + 2 * Math.floor(i / 12)
    c.set(x, -4, z, i === 71 ? 'gold_block' : 'pink_concrete')
  }
  c.set(2, -2, 5, 'glowstone')
  c.set(16, -2, 5, 'glowstone')
  c.set(2, -2, 11, 'glowstone')
  c.set(16, -2, 11, 'glowstone')

  // The desk the days got counted at, along the aisle by the way in.
  c.set(3, -3, 2, 'crafting_table')
  c.set(5, -3, 2, 'barrel')
  c.set(7, -3, 2, 'bookshelf')

  const m = c.at(3, 0, 1, 'bilibili/market')
  for (const dx of [0, 2, 6, 8]) {
    m.set(dx, -3, 0, 'gray_concrete')
    m.set(dx, -2, 0, 'gray_concrete')
  }
  m.set(4, -3, 0, 'sea_lantern')                           // the one he picked
  m.set(4, -2, 0, 'light_blue_stained_glass')
  m.set(11, -3, 0, 'bookshelf')
}

/* ------------------------------------------------------------------ pagoda */

/*
 * THE PAGODA. Seven by seven at the base, three tiers of flared roof, a top
 * chamber you can climb to, and a gold finial. It stands north of the
 * courtyard where it is the tallest thing inside the walls and the thing a
 * visitor sees over the gatehouse from a hundred blocks down the road.
 *
 * THE INSIDE IS A SPIRAL OF FULL BLOCKS, not stair blocks. A stair block's
 * facing is a per-key thing in blocks.js -- `dark_oak_stairs_east_bottom` and
 * seven siblings -- and picking the wrong one builds a staircase you cannot
 * climb, which is a worse bug than a slightly blocky one and one you only
 * find by walking it. The spiral runs round the inside of the shaft, one
 * block up per step, and it works because a one-block step is a walk.
 */
function pagoda(p) {
  const W = 6, D = 6                       // x 0..6, z 0..6
  const TOP = 17                           // the top chamber's floor

  p.rect([-1, -1], [W + 1, D + 1], -1, PAVING)
  p.rect([0, 0], [W, D], -1, 'dark_oak_planks')
  p.hollow([0, 0, 0], [W, TOP, D], { walls: TIMBER, inside: 'air' })
  for (let y = 0; y <= TOP; y += 1) {                       // plaster panels between
    p.box([1, y, 0], [W - 1, y, 0], y % 6 === 5 ? TIMBER : PLASTER)
    p.box([1, y, D], [W - 1, y, D], y % 6 === 5 ? TIMBER : PLASTER)
    p.box([0, y, 1], [0, y, D - 1], y % 6 === 5 ? TIMBER : PLASTER)
    p.box([W, y, 1], [W, y, D - 1], y % 6 === 5 ? TIMBER : PLASTER)
  }
  p.clear([W, 0, 2], [W, 2, 4])                            // the door, facing the road

  /*
   * The spiral. The sixteen cells round the inside wall of the 5x5 shaft, in
   * order, each one a block higher than the last -- so a full loop gains
   * sixteen and two loops overshoot the top chamber. It climbs to TOP - 1 and
   * stops, and the last step is under the hole in the chamber floor.
   */
  const ring = []
  for (let x = 1; x <= 5; x++) ring.push([x, 1])
  for (let z = 2; z <= 5; z++) ring.push([5, z])
  for (let x = 4; x >= 1; x--) ring.push([x, 5])
  for (let z = 4; z >= 2; z--) ring.push([1, z])
  for (let i = 0; i <= TOP - 1; i++) {
    const [x, z] = ring[i % ring.length]
    p.set(x, i, z, 'dark_oak_planks')
  }
  for (let y = 4; y < TOP; y += 4) p.set(3, y, 3, 'glowstone')  // lit the whole way up

  // The three tiers of roof. Each is a flared skirt round the tower rather
  // than a lid on it, so the shaft stays open all the way up.
  pagodaSkirt(p, [0, 0], [W, D], 5, TILE_BLUE)
  pagodaSkirt(p, [0, 0], [W, D], 11, TILE_BLUE)

  /*
   * THE TOP CHAMBER, and EASTER EGG, ON TOP. The floor has a hole in the
   * corner the spiral arrives under. Inside: a target block on a block of
   * gold, between two sea lanterns. You climb twenty blocks to find out that
   * the thing at the top is the target again -- which is the joke, and is
   * also, as far as this build is concerned, the finding.
   */
  p.rect([1, 1], [5, 5], TOP, 'dark_oak_planks')
  /* The hole the spiral arrives under, directly over its last step, so the
   * climb finishes as a step up onto the chamber floor rather than as a jump
   * at a ceiling. It is the one place in this build that had to be walked
   * rather than read. */
  p.set(1, TOP, 1, 'air')
  p.hollow([0, TOP + 1, 0], [W, TOP + 3, D], {
    walls: 'light_blue_stained_glass', inside: 'air',
  })
  for (const [x, z] of [[0, 0], [W, 0], [0, D], [W, D]]) p.pillar(x, z, TOP + 1, TOP + 3, TIMBER)
  p.set(3, TOP + 1, 3, 'gold_block')
  p.set(3, TOP + 2, 3, 'target')
  p.set(2, TOP + 1, 2, 'sea_lantern')
  p.set(4, TOP + 1, 4, 'sea_lantern')

  // The crown: a last flared skirt, a solid cap stepped in twice, and the
  // finial -- gold under a lantern, which is the top of the plot.
  pagodaSkirt(p, [0, 0], [W, D], TOP + 4, TILE_BLUE)
  p.rect([0, 0], [W, D], TOP + 4, TILE_BLUE)
  p.rect([1, 1], [5, 5], TOP + 5, TILE_BLUE)
  p.rect([2, 2], [4, 4], TOP + 6, TILE_BLUE)
  p.set(3, TOP + 7, 3, 'gold_block')
  p.set(3, TOP + 8, 3, 'sea_lantern')
}

/* -------------------------------------------------------------------- roof */

/*
 * A flared eave, as a ring. This is the shape the whole compound is made of
 * and the one thing in this file that is worth getting right, because a
 * Chinese roof is entirely its eave line.
 *
 * WHAT MAKES IT READ FROM THE GROUND, which is the only view a visitor gets:
 *   1. the eave overhangs by TWO, so it throws a shadow you can stand under;
 *   2. there is a course of RED brackets one block below it, overhanging by
 *      one -- the dougong line, and the thing your eye actually follows;
 *   3. the four corners turn UP, two blocks above the eave at the tip.
 * Without (3) this is a grey hat. With it, it is a roof.
 */
function eave(r, [x0, z0], [x1, z1], y, tile, trim) {
  r.hollow([x0 - 1, y - 1, z0 - 1], [x1 + 1, y - 1, z1 + 1], { walls: trim })   // brackets
  r.hollow([x0 - 2, y, z0 - 2], [x1 + 2, y, z1 + 2], { walls: tile })           // the eave
  r.hollow([x0 - 1, y, z0 - 1], [x1 + 1, y, z1 + 1], { walls: tile })
  const corners = [[x0 - 2, z0 - 2], [x1 + 2, z0 - 2], [x0 - 2, z1 + 2], [x1 + 2, z1 + 2]]
  for (const [cx, cz] of corners) {
    r.set(cx, y + 1, cz, tile)
    r.set(cx, y + 2, cz, trim)                                                  // the upturn
  }
}

/** A flared skirt with nothing on top of it: one tier of a pagoda. */
function pagodaSkirt(p, a, b, y, tile) {
  eave(p, a, b, y, tile, TIMBER)
}

/*
 * A full hip roof: the eave, and then courses stepped in by one until they
 * meet at a ridge. `hollow` with only `walls` draws each course as a ring, so
 * the roof is a shell and the hall keeps its attic instead of getting a solid
 * six-course slab dropped on it.
 *
 * The ridge gets its own colour along the top, because a hip roof whose apex
 * is the same block as its slope has no apex.
 */
function tieredRoof(r, [x0, z0], [x1, z1], y, tile, trim) {
  eave(r, [x0, z0], [x1, z1], y, tile, trim)
  /*
   * TWO IN, ONE UP. Stepping in by one per course builds a roof as tall as
   * the building is wide -- a nine-course grey pyramid on a seven-block hall,
   * which looks fine from above and absurd from the road. Two in per course
   * halves it, and every course is drawn as a ring TWO THICK so the step of
   * two does not leave a one-block slot you can see the attic through. That
   * slot is exactly the sort of thing that is invisible in a plan view.
   */
  let a = x0, b = z0, c = x1, d = z1, yy = y + 1
  for (;;) {
    r.hollow([a, yy, b], [c, yy, d], { walls: tile })
    r.hollow([a + 1, yy, b + 1], [c - 1, yy, d - 1], { walls: tile })
    if (a + 2 >= c - 2 || b + 2 >= d - 2) {
      r.box([a + 1, yy + 1, b + 1], [c - 1, yy + 1, d - 1], trim)   // the ridge
      break
    }
    a += 2; b += 2; c -= 2; d -= 2; yy++
  }
}

/* ---------------------------------------------------------------- walkway */

/*
 * The covered walk down the south side of the courtyard, gate to hall. A
 * Chinese courtyard is a set of buildings joined by roofed colonnades rather
 * than a set of buildings in a field, and this is the piece that turns four
 * separate objects on a lawn into one compound.
 *
 * It is also the thing that makes the courtyard readable in the rain and at
 * dusk: it is lit, it is at head height, and it frames the pool.
 */
function walkway(s) {
  s.rect([29, 22], [43, 24], -1, PAVING)
  for (let x = 29; x <= 43; x += 3) {
    s.pillar(x, 24, 0, 3, TIMBER)
    s.pillar(x, 22, 0, 3, TIMBER)
  }
  s.line([29, 4, 22], [43, 4, 22], TIMBER)           // the bracket line, both eaves
  s.line([29, 4, 24], [43, 4, 24], TIMBER)
  s.rect([28, 21], [44, 25], 5, TILE)                // the roof, overhanging by one
  s.rect([29, 22], [43, 24], 6, TILE)
  for (let x = 31; x <= 41; x += 5) s.set(x, 4, 23, 'sea_lantern')

  // Two cherries in the courtyard's north-east corner, which is the one bit
  // of ground inside the walls that nothing else is standing on.
  cherry(s.at(42, 0, 8, 'bilibili/cherry'))
  cherry(s.at(31, 0, 20, 'bilibili/cherry'))

  /* The two corners inside the wall that the gatehouse leaves over: bamboo
   * against the wall so the compound has no bare grass in it. */
  for (let x = 45; x <= 49; x += 2) {
    for (const z of [4, 6, 22, 24]) s.pillar(x, z, 0, 2 + (x % 3), 'bamboo_block')
  }
}

/** A cherry. Four of trunk and a flat blob of blossom, which is the shape
 *  that reads as Chinese-garden rather than as Minecraft-oak. */
function cherry(t) {
  t.pillar(0, 0, 0, 3, 'cherry_log')
  t.box([-2, 4, -2], [2, 4, 2], 'cherry_leaves')
  t.box([-1, 5, -1], [1, 5, 1], 'cherry_leaves')
  t.clear([0, 4, 0], [0, 4, 0])
  t.set(0, 4, 0, 'cherry_log')
  t.rect([-1, -1], [1, 1], -1, 'grass')
}

/* ------------------------------------------------------------------ bamboo */

/*
 * The bamboo, along the west end and the north strip behind the hall. It is
 * background, deliberately: the README's render distance note says put the
 * legible thing at the road edge and the quiet thing at the far end, and 128
 * blocks away this is texture.
 *
 * Planted on alternate columns so you can walk between the canes, which is
 * the only reason a voxel grove is worth building rather than painting.
 */
function bambooGrove(s) {
  for (let x = 9; x <= 29; x += 2) {
    for (let z = 3; z <= 5; z++) {
      s.pillar(x, z, 0, 2 + (x % 3), 'bamboo_block')
    }
  }
  for (let z = 7; z <= 23; z += 2) {
    s.pillar(9, z, 0, 2 + (z % 3), 'bamboo_block')
  }
  s.rect([9, 3], [29, 5], -1, 'grass')
}
