/*
 * STAGE 3 -- PERPLEXITY. The place where a no got turned into a yes.
 *
 * Written to be READ, in the shape stage 1 set: every section is a function
 * named after the thing a visitor walks into, and every function is written
 * in its own coordinates via `s.at(...)`. If a line here is doing arithmetic
 * on a plot coordinate, the origin is in the wrong place.
 *
 * ------------------------------------------------------------------------
 * THE STORY, WHICH IS THE BUILD. From the owner's own record, and nothing
 * factual is invented -- the licence taken is in how a fact is DRAWN.
 *
 *   He cold-DMed Perplexity's CBO asking to intern.
 *   He was offered a student ambassador code instead.
 *   He recruited signups by hand across campus.
 *   He built a Google form for a student ambassador programme that did not
 *     exist yet.
 *   He took the 50 signups back to the CBO as evidence.
 *   Months later they launched a student tier, and he was the intern on it.
 *
 * The shape of it is: refused a no, manufactured the evidence himself,
 * brought it back. So the plot is laid out as that walk and not as a logo.
 *
 *   THE DEAD END      a bright path from the kerb runs straight at the grand
 *                     door of the HQ, and the grand door is BOARDED SHUT.
 *                     This is the ask to intern. You can walk up to it and
 *                     you cannot go through it.
 *   THE SMALLER DOOR  one block wide, three down the same wall, lit by a
 *                     single lantern. The ambassador code: not what he asked
 *                     for, and the only thing that opened.
 *   THE ANSWER ENGINE inside, a lit column rising through a hole in the floor
 *                     above, ringed by shelves that are its sources. A
 *                     question becoming an answer with sources is the whole
 *                     of what Perplexity is, so it is the one object in the
 *                     building that goes through the building.
 *   THE WAY AROUND    the other path off the same kerb never touches the
 *                     front of the building. It goes south, round the back,
 *                     past a nine-block question mark on the rear wall, and
 *                     out to the campus. It is twenty times longer than the
 *                     dead end and it is the one that gets somewhere.
 *   THE TABLE         a folding table on the quad with the sign-up sheet
 *                     still on it. By hand, across campus.
 *   THE FIFTY         a hall whose far wall is FIFTY sea lanterns on five
 *                     shelves of ten. They are the only light in the room
 *                     and they are countable, which is the point -- the
 *                     number is what he took back. Inlaid in the floor
 *                     underneath them, at full size, is the form.
 *   THE STUDENT TIER  a second storey on the HQ, with its own stair, on the
 *                     OUTSIDE, at the far end of that long walk. You cannot
 *                     reach it from the atrium. Months later they launched a
 *                     student tier and he was the intern on it, so the tier
 *                     is a literal one and the desk in it is his, and its
 *                     balcony hangs over the road above the door that never
 *                     opened.
 *
 * THE EASTER EGGS, one for each direction you have to look:
 *
 *   BEHIND  what is behind the boarded door. A red room -- the only red
 *           blocks anywhere on this plot -- holding one white block on a
 *           plinth, which is the message that got sent. You see it from
 *           inside the atrium, through a tinted pane in a blank wall, and
 *           there is no way in.
 *   UNDER   under the campus table, through the two missing paving stones
 *           between its legs, the programme that did not exist yet: a room
 *           laid out for it, the form on the wall, eight seats facing the
 *           form, and nobody in any of them.
 *   ON TOP  on the roof of the HQ, above the student tier and reached by the
 *           stair that continues past it, the DM. Two lines of text on a
 *           lit screen, facing the road, alone up there. Everything below it
 *           is standing on it.
 *
 * ------------------------------------------------------------------------
 * ORIENTATION. The plot is 56 wide (local x 0..55) and 28 deep (z 0..27).
 * +x runs EAST toward the road, which is where every visitor is standing --
 * so the HQ is pushed hard against the road edge and the campus is at the
 * far west end where it reads as background. +z runs SOUTH. y = 0 is the air
 * above the grass; y = -1 IS the grass.
 *
 * PALETTE. Prismarine and dark prismarine for Perplexity, warped stem for
 * its trim, sea lanterns for anything that is an answer. Oak, andesite and
 * stone brick for the campus, because a campus is not a brand.
 */

export function build(s) {
  paths(s)
  hq(s.at(34, 0, 4, 'perplexity/hq'))
  quad(s)
  lectureHall(s.at(0, 0, 18, 'perplexity/lecture'))
  campusBlock(s.at(26, 0, 1, 'perplexity/block'))
  campusTable(s.at(20, 0, 21, 'perplexity/table'))
  theProgrammeThatDidNotExist(s.at(20, 0, 21, 'perplexity/cellar'))
  formHall(s.at(4, 0, 3, 'perplexity/hall'))
}

/* ------------------------------------------------------------------ paths */

/*
 * THE FORK IS THE ARGUMENT. Two paths leave the same kerb.
 *
 * One is short, straight, wide and made of the pale brick, and it runs at the
 * grand door and stops dead against it. The other leaves at a right angle,
 * goes the long way round the back of the building, and reaches everything.
 *
 * All of it is laid at y = -1, replacing the grass, for the reason road.js
 * gives at length: a path you step up onto is a path you trip over.
 */
function paths(s) {
  s.rect([54, 0], [55, 27], -1, 'smooth_stone')             // the kerb strip
  s.rect([49, 6], [53, 20], -1, 'dark_prismarine')          // the forecourt

  // THE DEAD END. Kerb to the boarded door at x = 48, z 12..14, and no further.
  s.rect([49, 12], [53, 14], -1, 'prismarine_bricks')
  // Two bollards where it stops, so it reads as closed rather than unfinished.
  s.pillar(49, 11, 0, 0, 'dark_prismarine_slab')
  s.pillar(49, 15, 0, 0, 'dark_prismarine_slab')

  // The spur to the smaller door, one block wide. It is not a grand approach
  // and it was never offered as one.
  s.rect([49, 18], [53, 18], -1, 'prismarine_bricks')

  /*
   * THE WAY AROUND. South off the same kerb, west along the whole back of the
   * building, into the quad. Nothing on it is a shortcut and that is the only
   * reason it is here.
   */
  s.rect([52, 19], [53, 24], -1, 'prismarine_bricks')
  s.rect([33, 23], [53, 25], -1, 'prismarine_bricks')
  s.rect([33, 20], [33, 22], -1, 'prismarine_bricks')       // up to the tier stair

  // The back door of the atrium, and the walk from it down to the quad.
  s.rect([28, 8], [33, 10], -1, 'prismarine_bricks')
  s.rect([28, 11], [29, 19], -1, 'prismarine_bricks')

  // The quad itself, and the walk north from it to the hall of the fifty.
  s.rect([8, 20], [32, 25], -1, 'polished_andesite')
  s.rect([9, 17], [10, 19], -1, 'polished_andesite')

  // The forecourt's low wall, with the two path mouths left open in it, so
  // the fork reads as a fork from the kerb rather than as one wide apron.
  for (const z of [6, 7, 8, 9, 10, 11, 15, 16, 17, 19, 20]) s.set(49, 0, z, 'dark_prismarine_slab')
  for (const z of [6, 11, 15, 20]) s.set(49, 1, z, 'sea_lantern')

  tree(s.at(51, 0, 3, 'perplexity/tree'))
  tree(s.at(50, 0, 25, 'perplexity/tree'))
  tree(s.at(30, 0, 17, 'perplexity/tree'))
  tree(s.at(27, 0, 13, 'perplexity/tree'))
  tree(s.at(31, 0, 16, 'perplexity/tree'))
  tree(s.at(33, 0, 13, 'perplexity/tree'))
  tree(s.at(26, 0, 9, 'perplexity/tree'))
  tree(s.at(2, 0, 2, 'perplexity/tree'))
  tree(s.at(2, 0, 14, 'perplexity/tree'))
  tree(s.at(34, 0, 25, 'perplexity/tree'))   // clear of the rear question mark
  tree(s.at(45, 0, 25, 'perplexity/tree'))
}

/** An oak, straight out of stage 1's front yard. Four of trunk and a blob of
 *  leaves. The campus needs something that is not made of prismarine. */
function tree(t) {
  t.pillar(0, 0, 0, 4, 'oak_log')
  t.box([-2, 3, -2], [2, 4, 2], 'oak_leaves')
  t.box([-1, 5, -1], [1, 5, 1], 'oak_leaves')
  t.set(0, 5, 0, 'oak_leaves')
}

/* ---------------------------------------------------------------------- HQ */

/*
 * THE HEADQUARTERS. Fifteen wide, nineteen deep, two storeys and a roof, at
 * the road edge of the plot because render distance is 128 blocks and this is
 * the thing a visitor has to be able to see from the road beside it.
 *
 * Local (0, 0, 0) is its north-west corner, so every wall below is a small
 * number and the whole building moves by editing one line in `build`.
 *
 * TWO STOREYS IN TWO DIFFERENT BLOCKS, on purpose. The ground floor is
 * prismarine BRICKS and the storey above it is plain prismarine, because the
 * storey above it was added later -- that is what a student tier is, and a
 * building that was always two storeys tells the wrong story from the road.
 */
function hq(h) {
  const W = 14, D = 18            // inclusive: local x 0..14, z 0..18

  h.box([0, -2, 0], [W, -2, D], 'stone')                    // footing
  h.rect([0, 0], [W, D], -1, 'dark_prismarine')             // floor, IN PLACE OF the grass
  h.hollow([0, 0, 0], [W, 4, D], { walls: 'prismarine_bricks', ceiling: 'dark_prismarine' })
  h.hollow([0, 4, 0], [W, 9, D], { walls: 'prismarine', ceiling: 'dark_prismarine' })
  for (const [x, z] of [[0, 0], [W, 0], [0, D], [W, D]]) h.pillar(x, z, 0, 9, 'warped_stem')

  hqFacade(h, W)
  hqQuestionMark(h, D)
  hqWindows(h, W, D)
  hqAtrium(h, W, D)
  theMessage(h.at(11, 0, 6, 'perplexity/sealed'))
  answerEngine(h.at(6, 0, 9, 'perplexity/engine'))
  tierStair(h)
  studentTier(h, W, D)
  roof(h, W, D)
  roadSign(h, W)
  theDM(h.at(10, 10, 8, 'perplexity/dm'))
}

/*
 * THE ROAD FACE, and the reason `pattern` exists. Drawn rather than
 * assembled, rows listed the way the wall looks, last row at y = 0.
 *
 * Read the bottom four rows: `D` is the grand doorway, filled in with dark
 * prismarine, with a warped-stem board nailed across the middle of it at
 * y = 1. Then three columns to the south, `o` is a hole one block wide and
 * two high with a lantern over it. That is the whole of stage 3 in nine
 * characters, and it is the first thing a visitor sees.
 *
 * The `o` in the tier rows is the balcony opening, which is glazed by being
 * absent -- the deck outside it is built in `studentTier`.
 */
function hqFacade(h, W) {
  h.pattern({
    at: [W, 0, 0], plane: 'zy',
    legend: {
      'P': 'prismarine_bricks', 'p': 'prismarine', 'W': 'cyan_stained_glass',
      'D': 'dark_prismarine', 'L': 'sea_lantern', '=': 'warped_stem', 'o': 'air',
    },
    rows: [
      '===================',   // y9  the cornice
      'pppppppppLppppppppp',   // y8
      'ppWWWpppooopppWWWpp',   // y7  the tier, and the balcony doors
      'ppWWWpppooopppWWWpp',   // y6
      'ppWWWpppooopppWWWpp',   // y5
      'DDDDDDDDDDDDDDDDDDD',   // y4  the band where the storey was added
      'PPWWPPPP=L=PPPPWWPP',   // y3
      'PPWWPPPPDDDPPPLWWPP',   // y2
      'PPWWPPPP===PPPoWWPP',   // y1  the board across the grand door
      'PPPPPPPPDDDPPPoPPPP',   // y0  ...and the door that did open
    ],
  })
}

/*
 * The question mark, nine blocks tall, on the wall nobody would put a sign
 * on. It faces SOUTH, over the long way round, so the only visitor who ever
 * reads it is the one who took the path that goes around -- which is the
 * joke, and it is worth more than the same glyph on the front would be.
 *
 * Teal warp wart for the stroke and a real light for the dot, so it is legible
 * at night from the path two blocks away.
 */
function hqQuestionMark(h, D) {
  h.box([4, 0, D], [10, 8, D], 'dark_prismarine')           // the board
  /*
   * REVERSED, and the front one is not, which is the whole trap.
   *
   * QUESTION is stamped on two walls of this building. On the east face it is
   * a `zy` wall read from the road, facing west, and the characters run in +z
   * which is the reader's right, so it comes out as drawn. This one is an
   * `xy` wall facing SOUTH, so the reader on the long way round is facing
   * NORTH -- and Babylon is left-handed, so facing north puts +x on their
   * LEFT and the same drawing comes out backwards. A backwards question mark
   * still reads as a question mark at a glance, which is exactly why it
   * survived: nobody looking for a spelling mistake finds one.
   *
   * One glyph, two walls, one of them mirrored. See docs/builds/README.md.
   */
  h.pattern({
    at: [5, 1, D], plane: 'xy',
    legend: { '#': 'sea_lantern', 'o': 'sea_lantern' },
    rows: QUESTION.map(r => [...r].reverse().join('')),
  })
}

/*
 * The question mark, five by seven, and it is drawn twice on this building.
 *
 * SEVEN TALL AND NOT NINE, which a screenshot decided. The way round passes
 * three blocks off the rear wall and a nine-block glyph at that range runs
 * off the top of the screen -- the top half of a question mark reads as a
 * mistake, not as a question. Seven fits in the angle you can crane to.
 */
const QUESTION = [
  '.###.',
  '#...#',
  '...#.',
  '..#..',
  '..#..',
  '.....',
  '..o..',
]

/** Glass on all four faces. A building with windows on one side reads as a
 *  film set the moment you walk round it, and on this plot everybody walks
 *  round it. The south band skips x 4..10, which is where the question is. */
function hqWindows(h, W, D) {
  for (const z of [3, 5, 8, 11, 14, 16]) {
    h.box([0, 2, z], [0, 3, z], 'cyan_stained_glass')
    h.box([0, 6, z], [0, 7, z], 'cyan_stained_glass')
  }
  for (const x of [2, 12]) {
    h.box([x, 2, 0], [x, 3, 0], 'cyan_stained_glass')
    h.box([x, 6, 0], [x, 7, 0], 'cyan_stained_glass')
    h.box([x, 2, D], [x, 3, D], 'cyan_stained_glass')
    h.box([x, 6, D], [x, 7, D], 'cyan_stained_glass')
  }
  /* Cleared from y = 0, not y = 1. The floor is at y = -1, so a doorway that
   * starts at y = 1 is a doorway one block off the ground -- stage 1 shipped
   * exactly that in its garage and only a screenshot from the driveway found
   * it. */
  h.clear([0, 0, 5], [0, 1, 5])                             // the atrium's back door
}

/*
 * The atrium. A reception desk inside the small door, eight shelves of
 * sources along the two long walls with a light over each one, and the engine
 * in the middle of the floor.
 *
 * The blank wall at x = 11, z 6..12 is not decoration. It is the back of the
 * grand door, and there is a tinted pane in the middle of it.
 */
function hqAtrium(h, W, D) {
  // The desk, just inside the door that opened.
  h.box([12, 1, 15], [13, 1, 17], 'dark_prismarine')
  h.set(13, 2, 16, 'cyan_stained_glass')
  h.set(12, 2, 15, 'barrel')

  // The sources. A shelf is a stack of books with a light on it, and there is
  // one for every answer the engine gives.
  for (const x of [2, 4, 6, 8]) {
    h.box([x, 1, 1], [x, 2, 1], 'bookshelf')
    h.set(x, 3, 1, 'sea_lantern')
    h.box([x, 1, D - 1], [x, 2, D - 1], 'bookshelf')
    h.set(x, 3, D - 1, 'sea_lantern')
  }

  // A bench along the west wall, for the people who are waiting.
  h.box([1, 1, 8], [1, 1, 12], 'warped_stem')

  lights(h, [[3, 4, 5], [3, 4, 14], [10, 4, 4], [10, 4, 9], [10, 4, 15]])
}

/*
 * THE ANSWER ENGINE. Three by three, eight tall, a sea lantern core behind
 * glass, rising out of the atrium floor and straight through a hole cut in
 * the floor of the storey above -- so from the ground you see it disappear
 * into the ceiling, and from the student tier you lean on a rail and look
 * down into it.
 *
 * A question becoming an answer is the only thing this company does, and it
 * is the only object in this build that occupies two floors at once.
 */
function answerEngine(e) {
  for (let y = 1; y <= 8; y++) {
    e.hollow([-1, y, -1], [1, y, 1], { walls: 'dark_prismarine' })
    e.set(0, y, 0, 'sea_lantern')
  }
  for (let y = 2; y <= 7; y++) {
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      e.set(dx, y, dz, 'cyan_stained_glass')
    }
  }
  e.clear([-1, 4, -1], [1, 4, 1])              // the light well through the tier floor
}

/*
 * EASTER EGG, BEHIND. What is on the other side of the boarded door.
 *
 * Written at the sealed room's own north-west corner. There is no way in and
 * there is not supposed to be one: the only access is a pane of tinted glass
 * in an otherwise blank wall of the atrium, which is the kind of wall nobody
 * looks at twice, and behind it the floor is RED -- the only red blocks
 * anywhere on this plot, in a build that is otherwise entirely teal.
 *
 * On the plinth, one white block. The message that got sent.
 */
function theMessage(v) {
  v.box([0, 0, 0], [0, 3, 6], 'prismarine_bricks')          // the blank wall
  /* ...and the two ends, which is the difference between a sealed room and a
   * room with the front wall missing. Without these you walk in round the
   * side from the alcove and the whole point of it evaporates. */
  v.box([1, 0, 0], [2, 3, 0], 'prismarine_bricks')
  v.box([1, 0, 6], [2, 3, 6], 'prismarine_bricks')
  v.set(0, 1, 3, 'tinted_glass')                            // ...with the pane in it
  v.set(0, 2, 3, 'tinted_glass')
  /* The red is on the BACK panel and not on the floor, which is the whole
   * difference between an easter egg you find and one you don't: through a
   * pane at eye height you see a wall, never a floor. */
  v.box([2, 0, 1], [2, 3, 5], 'red_concrete')
  v.set(1, 0, 3, 'warped_stem')                             // the plinth
  v.box([1, 1, 3], [1, 2, 3], 'white_concrete')             // the DM, as sent
  v.set(1, 3, 3, 'sea_lantern')                             // lit, and nothing else in here is
  v.set(1, 0, 1, 'dark_prismarine')
  v.set(1, 0, 5, 'dark_prismarine')
}

/*
 * THE STAIR TO THE TIER IS ON THE OUTSIDE, and it is the single most
 * deliberate decision in this build.
 *
 * You cannot get upstairs from the atrium. There is no stair in there and
 * there is not going to be one. The only way to the student tier is to leave
 * by the back door, walk the whole way round the building, cross the campus,
 * find the fifty, and come back to the south-west corner -- at which point
 * there is a flight of five steps up the outside wall and a door at the top.
 *
 * FIVE FULL BLOCKS, not stair blocks, for the reason stage 1 gives: a stair
 * block's facing is a per-key thing in blocks.js and picking the wrong one
 * builds a staircase you cannot climb, which is worse than a blocky one and
 * which you only find by walking it.
 */
function tierStair(h) {
  for (let i = 0; i <= 4; i++) h.box([-1, 0, 16 - i], [-1, i, 16 - i], 'dark_prismarine')
  h.box([-1, 0, 11], [-1, 4, 11], 'dark_prismarine')        // the landing
  h.clear([0, 5, 11], [0, 6, 11])                           // the door into the tier
  for (let i = 0; i <= 4; i++) h.set(-2, i, 16 - i, 'dark_prismarine_slab')   // the rail
  h.set(-2, 4, 11, 'dark_prismarine_slab')
  h.set(-1, 5, 10, 'sea_lantern')
}

/*
 * THE STUDENT TIER. Months later they launched one and he was the intern on
 * it, so on this plot it is a literal tier: a whole storey that was not there
 * before, sitting on top of the building it was argued into existing.
 *
 * The desk faces the balcony, the balcony hangs over the forecourt, and what
 * it hangs over is the door that stayed shut. That is the view and it is the
 * only reason the balcony is on this face.
 */
function studentTier(h, W, D) {
  // The balcony deck, cantilevered out over the forecourt, with a rail.
  h.rect([W + 1, 7], [W + 2, 11], 4, 'dark_prismarine')
  h.rect([W + 2, 7], [W + 2, 11], 5, 'dark_prismarine_slab')
  h.set(W + 1, 5, 7, 'dark_prismarine_slab')
  h.set(W + 1, 5, 11, 'dark_prismarine_slab')
  h.set(W + 2, 5, 7, 'sea_lantern')                         // in the rail, not floating over it
  h.set(W + 2, 5, 11, 'sea_lantern')

  // The rail round the light well, so the engine can be looked down into
  // rather than fallen into.
  h.hollow([4, 5, 7], [8, 5, 11], { walls: 'dark_prismarine_slab' })

  // His desk. Warped plank top, a screen, a chair, and the box of everything
  // the ambassador code came with.
  h.box([10, 5, 8], [12, 5, 10], 'warped_planks')
  h.set(12, 6, 9, 'cyan_stained_glass')
  h.set(9, 5, 9, 'warped_stem')
  h.set(10, 6, 8, 'barrel')

  // Four more desks along the north wall, because a tier is not one person.
  for (const z of [2, 4]) {
    h.box([2, 5, z], [4, 5, z], 'warped_planks')
    h.set(2, 6, z, 'cyan_stained_glass')
    h.set(5, 5, z, 'warped_stem')
  }
  h.box([1, 5, 15], [1, 6, 16], 'bookshelf')
  h.set(2, 5, 16, 'crafting_table')

  lights(h, [[3, 9, 8], [3, 9, 13], [11, 9, 4], [11, 9, 14], [7, 9, 16]])
}

/*
 * The roof: the tier's ceiling, a slab parapet so it has an edge, and the
 * stair that keeps going. Four steps up the north end and a two-block hole in
 * the ceiling -- a one-block hole is a hole you get stuck in.
 */
function roof(h, W, D) {
  h.hollow([0, 10, 0], [W, 10, D], { walls: 'dark_prismarine_slab' })

  /*
   * THE HEADROOM IS THE BIT THAT IS EASY TO GET WRONG, and it is invisible
   * from every view except walking it.
   *
   * The tier floor is y = 4 and its ceiling is y = 9, so a climber standing
   * on the top of the third step has their feet at y = 8 and their HEAD at
   * y = 9, which is the ceiling. Four steps and a hole over the top one is
   * not enough: the hole has to be over the last TWO, and two blocks wide,
   * because a 1x1 shaft is a thing you get wedged in rather than a stair.
   */
  for (let i = 0; i <= 3; i++) h.box([2, 5, 2 + i], [2, 5 + i, 2 + i], 'prismarine_bricks')
  h.clear([2, 9, 4], [3, 9, 5])
  h.set(1, 10, 4, 'dark_prismarine_slab')                   // a lip round the stairwell
  h.set(1, 10, 5, 'dark_prismarine_slab')
  h.set(4, 10, 4, 'dark_prismarine_slab')
  h.set(4, 10, 5, 'dark_prismarine_slab')

  for (const [x, z] of [[1, 1], [13, 1], [1, 17], [13, 17]]) h.set(x, 10, z, 'sea_lantern')
}

/*
 * THE MARK THAT READS FROM THE ROAD, and it is at EYE LEVEL, which took two
 * screenshots to get right.
 *
 * Draft one put it warped-wart on prismarine -- teal on teal, a smudge at
 * eleven blocks. Draft two fixed the contrast and carried it up a parapet
 * nine blocks above the roofline, where from the kerb it is fifty degrees up
 * and the top half of it is off the top of the screen. That is the same
 * mistake stage 1 made with its markers, made again with better colours.
 *
 * So: a dark board on the north bay of the facade, y 0..8, with a question
 * mark of sea lanterns on it. A visitor standing on the road looks straight
 * at it. It is not a logo -- it is the thing the company does, it is the
 * thing he sent, and it is the only bright object on the road face apart
 * from the one lantern over the door that opened.
 */
function roadSign(h, W) {
  h.box([W, 0, 1], [W, 8, 7], 'dark_prismarine')
  h.box([W, 0, 1], [W, 0, 7], 'warped_stem')                // the sill
  h.box([W, 8, 1], [W, 8, 7], 'warped_stem')                // and the cap
  h.pattern({
    at: [W, 1, 2], plane: 'zy',
    legend: { '#': 'sea_lantern', 'o': 'sea_lantern' },
    rows: QUESTION,
  })
}

/*
 * EASTER EGG, ON TOP. The DM.
 *
 * A lit screen on the roof, facing the road, with two lines on it and nothing
 * under them -- a message sent and not yet answered. It is alone up there,
 * above the tier that exists because of it, above the desk that exists
 * because of it, above the door that never opened. Nothing at ground level
 * says it is here; you find it by taking the stair one flight further than
 * it looks like it goes.
 *
 * The record says the CBO. It does not say a name, and neither does this.
 */
function theDM(d) {
  d.pattern({
    at: [0, 0, 0], plane: 'zy',
    legend: {
      '=': 'warped_stem', '#': 'white_concrete', 'c': 'cyan_concrete', 'L': 'sea_lantern',
    },
    rows: [
      '=====',
      '=ccc=',
      '=cc#=',
      '=###=',
      '==L==',
    ],
  })
  d.set(-1, 0, 2, 'warped_stem')              // one seat, facing it
  d.set(-1, 0, 0, 'dark_prismarine_slab')
  d.set(-1, 0, 4, 'dark_prismarine_slab')
}

/** Recessed ceiling lights. A glowstone swapped into a prismarine ceiling
 *  reads as a fitting; a torch on the floor reads as a torch on the floor. */
function lights(h, spots) {
  for (const [x, y, z] of spots) h.set(x, y, z, 'glowstone')
}

/* ------------------------------------------------------------------- quad */

/*
 * The campus. Not a brand, so not a scrap of prismarine in it: andesite
 * paving, stone brick, oak, and a colonnade along the south edge with real
 * lights on it so the long path arrives somewhere lit.
 *
 * The sandwich boards are the bit that matters. He recruited the signups BY
 * HAND, ACROSS CAMPUS, which is four whiteboards on sticks in four different
 * places and a lot of walking, and that is what is drawn.
 */
function quad(s) {
  // The colonnade: six columns, a lintel, a light on every other one.
  for (const x of [10, 14, 18, 22, 26, 30]) s.pillar(x, 25, 0, 3, 'stone_bricks')
  s.box([10, 4, 25], [30, 4, 25], 'stone_bricks')
  for (const x of [10, 18, 26]) s.set(x, 5, 25, 'sea_lantern')

  // A low wall along the north side of the quad, with a gap for the walk up
  // to the hall of the fifty.
  s.box([8, 0, 19], [8, 0, 19], 'stone_brick_slab')
  s.box([11, 0, 19], [20, 0, 19], 'stone_brick_slab')
  s.box([21, 0, 19], [32, 0, 19], 'stone_brick_slab')

  board(s.at(12, 0, 22, 'perplexity/board'))
  board(s.at(28, 0, 21, 'perplexity/board'))
  board(s.at(16, 0, 24, 'perplexity/board'))
  board(s.at(32, 0, 12, 'perplexity/board'))
}

/** One sandwich board: a post, a white panel, a teal mark on it. Six blocks,
 *  and there are four of them in four different corners of the campus. */
function board(b) {
  b.pillar(0, 0, 0, 1, 'warped_stem')
  b.box([0, 2, 0], [0, 3, 1], 'white_concrete')
  b.set(0, 3, 0, 'cyan_concrete')
}

/*
 * The lecture hall on the west side of the quad, two storeys, and you can
 * walk up both of them.
 *
 * It is here because "across campus" is a claim a plot has to be able to
 * back: with a quad and nothing on it, the table reads as a table in a field.
 * A building he walked out of with a clipboard is what makes the quad a
 * campus, and the room upstairs is the size of the room you ask fifty people
 * one at a time in.
 *
 * Local (0, 0, 0) is its north-west corner.
 */
function lectureHall(k) {
  const W = 7, D = 7

  k.box([0, -2, 0], [W, -2, D], 'cobblestone')
  k.rect([0, 0], [W, D], -1, 'polished_andesite')
  k.hollow([0, 0, 0], [W, 4, D], { walls: 'stone_bricks', ceiling: 'smooth_stone' })
  k.hollow([0, 4, 0], [W, 9, D], { walls: 'stone_bricks', ceiling: 'smooth_stone' })
  k.hollow([0, 10, 0], [W, 10, D], { walls: 'stone_brick_slab' })
  for (const [x, z] of [[0, 0], [W, 0], [0, D], [W, D]]) k.pillar(x, z, 0, 9, 'polished_andesite')

  // The door faces the quad, and it is cleared from y = 0 for the same reason
  // every other door on this plot is.
  k.clear([W, 0, 3], [W, 2, 4])
  k.set(W, 3, 3, 'sea_lantern')
  for (const z of [2, 5]) {
    k.box([0, 2, z], [0, 3, z], 'glass')
    k.box([0, 6, z], [0, 7, z], 'glass')
  }
  for (const x of [2, 5]) {
    k.box([x, 2, 0], [x, 3, 0], 'glass')
    k.box([x, 2, D], [x, 3, D], 'glass')
    k.box([x, 6, 0], [x, 7, 0], 'glass')
    k.box([x, 6, D], [x, 7, D], 'glass')
  }

  /* The stair, and the opening in the ceiling it arrives through. The clear
   * comes FIRST and the steps are built into it, which is stage 1's trick:
   * the top step is level with the ceiling, so the last move is a walk and
   * not a jump into a slab. */
  k.clear([1, 4, 1], [5, 4, 2])
  for (let i = 0; i <= 4; i++) k.box([1 + i, 0, 1], [1 + i, i, 1], 'stone_bricks')

  // Downstairs: a blackboard and three rows of desks facing it.
  k.box([1, 1, 6], [5, 2, 6], 'black_concrete')
  for (const z of [3, 4]) {
    k.box([1, 1, z], [5, 1, z], 'planks')
    for (const x of [1, 3, 5]) k.set(x, 2, z, 'oak_slab')
  }

  // Upstairs: the seminar room, a table and the shelves round it.
  k.box([2, 5, 4], [5, 5, 5], 'planks')
  for (const x of [2, 5]) k.set(x, 6, 4, 'oak_slab')
  k.box([6, 5, 1], [6, 6, 3], 'bookshelf')
  k.set(1, 5, 6, 'crafting_table')

  lights(k, [[2, 4, 4], [5, 4, 5], [2, 9, 3], [5, 9, 6]])
}

/*
 * The other campus building, north of the walk between the hall of the fifty
 * and the HQ. One storey, a common room, and a lit doorway -- background, and
 * built as background: it is the thing you see past, on the way.
 */
function campusBlock(c) {
  const W = 6, D = 6

  c.box([0, -2, 0], [W, -2, D], 'cobblestone')
  c.rect([0, 0], [W, D], -1, 'polished_andesite')
  c.hollow([0, 0, 0], [W, 5, D], { walls: 'stone_bricks', ceiling: 'smooth_stone' })
  c.hollow([0, 6, 0], [W, 6, D], { walls: 'stone_brick_slab' })
  for (const [x, z] of [[0, 0], [W, 0], [0, D], [W, D]]) c.pillar(x, z, 0, 5, 'polished_andesite')

  c.clear([W, 0, 2], [W, 2, 3])                             // the door, facing the walk
  c.set(W, 3, 2, 'sea_lantern')
  for (const z of [2, 4]) c.box([0, 2, z], [0, 3, z], 'glass')
  for (const x of [2, 4]) {
    c.box([x, 2, 0], [x, 3, 0], 'glass')
    c.box([x, 2, D], [x, 3, D], 'glass')
  }

  // A common room: a long table, stools, and a wall of books.
  c.box([2, 1, 2], [4, 1, 3], 'planks')
  c.set(1, 1, 2, 'oak_slab')
  c.set(5, 1, 3, 'oak_slab')
  c.box([1, 1, 5], [4, 2, 5], 'bookshelf')
  c.set(5, 1, 1, 'barrel')
  lights(c, [[2, 5, 2], [4, 5, 4]])
}

/*
 * THE TABLE. A folding table with the sign-up sheet still on it, the box of
 * pens beside it, and four stools nobody is sitting on.
 *
 * Written at its own corner because the cellar underneath it is written at
 * the SAME corner, and two things that must line up should not have to be
 * lined up by hand.
 *
 * Local (0, 0, 0) is the table's north-west leg.
 */
function campusTable(t) {
  /*
   * THE TOP IS AT y = 2 AND NOT AT y = 1, which looks like a taste decision
   * and is not one. The way into the cellar is two missing paving stones
   * between these legs, and a player is two blocks tall: a tabletop at y = 1
   * leaves a one-block gap underneath, which is a gap nobody fits in, which
   * is an easter egg nobody can reach. Trestle height it is.
   */
  t.rect([0, 0], [4, 1], 2, 'planks')                       // the top
  for (const [x, z] of [[0, 0], [4, 0], [0, 1], [4, 1]]) t.box([x, 0, z], [x, 1, z], 'dark_oak_wood')
  t.set(1, 3, 0, 'white_concrete')                          // the sheet
  t.set(2, 3, 0, 'white_concrete')
  t.set(4, 3, 1, 'barrel')                                  // the pens
  for (const x of [0, 2, 4, 6]) {                           // stools, on the far side
    t.set(x, 0, 3, 'oak_log')
    t.set(x, 1, 3, 'oak_slab')
  }

  // The banner behind it, so you can tell what the table is for from across
  // the quad. Teal on white, and no name on it.
  t.pillar(-1, -1, 0, 3, 'warped_stem')
  t.pillar(5, -1, 0, 3, 'warped_stem')
  t.box([-1, 4, -1], [5, 4, -1], 'white_concrete')
  t.set(1, 4, -1, 'cyan_concrete')
  t.set(3, 4, -1, 'cyan_concrete')
  t.set(2, 5, -1, 'sea_lantern')
}

/*
 * EASTER EGG, UNDER. The student ambassador programme that did not exist yet.
 *
 * THE WAY IN IS UNDER THE TABLE, which is the cheapest possible instruction
 * to a visitor and the one they are most likely to follow: two paving stones
 * are missing from between its legs, in the shadow of the top, and nothing
 * anywhere says so.
 *
 * THE VERTICAL BUDGET IS FOUR BLOCKS AND THAT IS THE WHOLE DESIGN. Classic
 * Flat puts grass at -1, dirt at -2 and -3 and bedrock at -4, so there is
 * room for a two-block room with the quad's own paving as its ceiling and no
 * room at all for a staircase. The way down is a two-block drop onto a crate,
 * and the crate is also the way back up -- a 1x1 shaft is a trap, because
 * from the floor the ground is three blocks up and a jump is one.
 *
 * What is down here is a room set up for a programme with no members: the
 * form on the wall, eight seats facing it, and nobody in any of them. He
 * built the form before there was anything for it to be a form for.
 */
function theProgrammeThatDidNotExist(c) {
  c.box([-3, -4, -2], [7, -4, 3], 'stone')                  // a floor over the bedrock
  c.box([-3, -3, -2], [7, -2, 3], 'air')                    // two blocks of headroom
  c.box([-3, -1, -2], [7, -1, 3], 'polished_andesite')      // ...under the quad's own paving
  for (const [a, b] of [[[-3, -2], [-3, 3]], [[7, -2], [7, 3]], [[-3, -2], [7, -2]], [[-3, 3], [7, 3]]]) {
    c.box([a[0], -3, a[1]], [b[0], -2, b[1]], 'stone_bricks')
  }

  // The way down and the way back up, which are the same two crates. Worth
  // walking before believing; it is the likeliest thing here to be subtly
  // unusable.
  c.set(2, -1, 0, 'air')
  c.set(2, -1, 1, 'air')
  c.set(2, -3, 0, 'cobblestone')
  c.set(2, -2, 0, 'barrel')
  c.set(2, -3, 1, 'barrel')

  /*
   * THE FORM, on the north wall, at the size a form is. Two fields, and both
   * of them empty -- there was no programme to put anybody into.
   */
  c.pattern({
    at: [-2, -3, -2], plane: 'xy',
    legend: { '#': 'white_concrete', 'c': 'cyan_concrete' },
    rows: [
      '#ccc#ccc#',
      '#ccc#ccc#',
    ],
  })

  // Eight seats facing it. Empty, and that is the whole joke.
  for (const x of [-1, 1, 3, 5]) {
    c.set(x, -3, 1, 'warped_stem')
    c.set(x, -3, 2, 'warped_stem')
  }
  c.set(-2, -3, 0, 'sea_lantern')
  c.set(6, -3, 2, 'sea_lantern')
  c.set(6, -3, -1, 'bookshelf')
}

/* -------------------------------------------------------------- the fifty */

/*
 * THE HALL OF THE FIFTY. Twenty-one wide, fourteen deep, eleven tall and
 * almost empty, because the only thing in it is a number.
 *
 * FIFTY SEA LANTERNS, on five shelves of ten, on the far wall facing the only
 * door. They are the whole light in the room. The shelves exist so that they
 * are COUNTABLE -- fifty of anything in a heap is "a lot", and fifty on five
 * shelves of ten is fifty, which is the number he took back to the CBO and
 * therefore the only number on this plot that is load-bearing.
 *
 * The door is on the SOUTH wall, facing the campus, because that is the
 * direction the signups came from, and it means the visitor walks in with the
 * wall in front of them rather than beside them.
 *
 * Local (0, 0, 0) is the hall's north-west corner.
 */
function formHall(f) {
  const W = 20, D = 13

  f.box([0, -2, 0], [W, -2, D], 'stone')
  f.rect([0, 0], [W, D], -1, 'dark_prismarine')
  f.hollow([0, 0, 0], [W, 11, D], { walls: 'prismarine_bricks', ceiling: 'cyan_stained_glass' })
  for (const [x, z] of [[0, 0], [W, 0], [0, D], [W, D]]) f.pillar(x, z, 0, 11, 'warped_stem')

  /*
   * THE FAR WALL IS DARK, ALL OF IT, and that is a fix and not a preference.
   * Drawn on prismarine bricks the fifty lit the pale wall to the same white
   * as themselves and the whole thing came back from a screenshot as one
   * blank rectangle -- fifty lights you cannot count are not fifty of
   * anything. On dark prismarine each one is a lamp with an edge.
   */
  f.box([0, 0, 0], [W, 11, 0], 'dark_prismarine')

  /*
   * And there they are. Ten characters of `o` to a row, five rows, and the
   * source listing is the same shape as the wall -- which is the argument for
   * `pattern` in one picture.
   */
  f.pattern({
    at: [1, 1, 0], plane: 'xy',
    legend: { 'o': 'sea_lantern' },
    rows: [
      'o.o.o.o.o.o.o.o.o.o',
      '...................',
      'o.o.o.o.o.o.o.o.o.o',
      '...................',
      'o.o.o.o.o.o.o.o.o.o',
      '...................',
      'o.o.o.o.o.o.o.o.o.o',
      '...................',
      'o.o.o.o.o.o.o.o.o.o',
    ],
  })

  // The door, two wide, on the campus side.
  f.clear([9, 0, D], [10, 2, D])
  f.set(9, 3, D, 'warped_stem')
  f.set(10, 3, D, 'warped_stem')

  // Glass down both long walls, at the height of a person, so the fifty glow
  // out across the campus after dark and you can see there is something in
  // here before you open the door.
  for (const z of [3, 5, 8, 10]) {
    f.box([0, 2, z], [0, 3, z], 'cyan_stained_glass')
    f.box([W, 2, z], [W, 3, z], 'cyan_stained_glass')
  }
  for (const x of [3, 6, 14, 17]) f.box([x, 2, D], [x, 3, D], 'cyan_stained_glass')

  // Two columns down each side, so eleven blocks of height reads as a hall
  // rather than as a mistake.
  for (const z of [3, 6, 9]) {
    f.pillar(1, z, 0, 10, 'warped_stem')
    f.pillar(W - 1, z, 0, 10, 'warped_stem')
  }

  /*
   * THE FORM, INLAID IN THE FLOOR AT FULL SIZE, directly under the fifty. You
   * walk across it to reach them, which is the order it happened in: the form
   * first, and the number it produced second.
   */
  f.pattern({
    at: [6, -1, 4], plane: 'xz',
    legend: { '#': 'white_concrete', 'c': 'cyan_concrete' },
    rows: [
      '#########',
      '#ccccccc#',
      '#########',
      '#ccccccc#',
      '#########',
      '#ccccccc#',
      '#########',
    ],
  })

  // A lectern and two benches, for the meeting this room was built to be the
  // evidence in.
  f.box([9, 0, 11], [11, 0, 11], 'warped_planks')
  f.set(10, 1, 11, 'white_concrete')
  f.box([4, 0, 11], [7, 0, 11], 'warped_stem')
  f.box([13, 0, 11], [16, 0, 11], 'warped_stem')
  f.set(2, 0, 12, 'bookshelf')
  f.set(18, 0, 12, 'barrel')
}
