/*
 * STAGE 2 -- HARVARD. Where it went instead.
 *
 * ------------------------------------------------------------------------
 * WHAT IS HERE, AND WHY IT IS HERE. Everything below is from the owner's own
 * record. Nothing factual is invented -- the licence this build takes is in
 * how a fact is DRAWN, never in what the fact is.
 *
 *   the letter, opened, at    A Boys Nation counsellor named Ben Schafer,
 *     the north gate          Harvard class of 2019, talked him into
 *                             applying the summer before senior year. He was
 *                             going to Nebraska until then. Stage 1 puts that
 *                             letter in a mailbox and turns its front walk
 *                             north; this plot picks the SAME PAVING up on
 *                             the other side of the road and carries it in
 *                             through a gate. The mailbox here has its flag
 *                             DOWN and the envelope is open on the ground.
 *                             The hinge of a life, received.
 *   Harvard Yard              red brick, white trim, black shutters, an iron
 *                             gate, elms, and grass you can walk on
 *   Widener                   twelve columns, a flight of steps and a date
 *                             cut into the frieze -- see 2024, below
 *   the bell tower            Memorial Church, white, at the road end of the
 *                             south range, because a steeple is the one
 *                             silhouette that reads from two hundred blocks
 *   John Harvard              bronze, seated, facing the gate, one shoe
 *                             rubbed gold. The Statue of Three Lies -- see
 *                             the crypt. (The other tradition associated with
 *                             that statue is not built and will not be.)
 *   2024 on the frieze        graduated DECEMBER 2024. A date cut high on a
 *                             library is what a building does with a year;
 *                             the snow lying on the north eaves is the month.
 *   the lecture hall          Applied Mathematics with Computer Science. The
 *                             blackboard in Sever has both halves on it: a
 *                             curve with its axes, and a three-node tree.
 *
 * THE EASTER EGGS, three of them, one for each direction you have to look:
 *
 *   UNDER   the crypt beneath John Harvard's plinth, down through the two
 *           missing paving stones behind him. Three crimson tablets, lit,
 *           one per lie: the man in the chair is not John Harvard, John
 *           Harvard did not found the college, and it was not founded in
 *           1638. Nothing above ground says the crypt is there.
 *   BEHIND  the bookcases in Widener's reading room. The shelf run has one
 *           gap, at the far south end, and behind it is a stack aisle with
 *           MAL painted red across the back wall. He minored in Spanish. He
 *           says his Spanish is bad. This is him grading it.
 *   ON TOP  Widener's roof, up the crate steps at the back of the stacks and
 *           out. One desk, one torch, one lamp, and Korean flashcards --
 *           white, red, blue, black -- laid out and abandoned. Spanish is
 *           past tense and downstairs; Korean is present tense and on the
 *           roof, which is exactly where an unfinished thing lives.
 * ------------------------------------------------------------------------
 * ORIENTATION, AND IT IS THE MIRROR OF STAGE 1. This plot is on the RIGHT of
 * the road, so the road runs along the WEST edge and -x is the side every
 * visitor sees first. The wall, the gates, the church tower and Widener's
 * whole front therefore face -x. +z runs south. y = 0 is the air above the
 * grass; y = -1 IS the grass.
 *
 * Text on a west-facing wall reads the right way round written in +z order:
 * stand facing east and north (-z) is on your left, so characters running +z
 * run left to right. That is not a thing to take on trust -- stage 1 shipped
 * a letter facing the wrong way and only a screenshot found it -- so the
 * 2024 on the frieze and the MAL in the stacks were both read off a picture
 * before this file was committed.
 *
 * The plot is 56 deep (x 0..55, away from the road) and 28 of frontage
 * (z 0..27). Everything is written in its own coordinates via s.at(...).
 */

/*
 * The only text this build has, 3x5, the same size road.js draws its stage
 * numbers at. Six glyphs is fewer characters than a font file.
 */
const GLYPHS = {
  '0': ['###', '# #', '# #', '# #', '###'],
  '2': ['###', '  #', '###', '#  ', '###'],
  '4': ['# #', '# #', '###', '  #', '  #'],
  'M': ['# #', '###', '###', '# #', '# #'],
  'A': [' # ', '# #', '###', '# #', '# #'],
  'L': ['#  ', '#  ', '#  ', '#  ', '###'],
}

/** A word as five pattern rows, one blank column between glyphs. Returns the
 *  rows top-first, which is the order `pattern` wants for a vertical plane. */
function word(text) {
  const rows = ['', '', '', '', '']
  ;[...text].forEach((ch, i) => {
    const g = GLYPHS[ch]
    if (!g) throw new Error(`harvard: no glyph for ${JSON.stringify(ch)}`)
    for (let r = 0; r < 5; r++) rows[r] += (i ? ' ' : '') + g[r]
  })
  return rows
}

export function build(s) {
  ground(s)
  wallAndGates(s)
  theLetter(s.at(2, 0, 0, 'harvard/letter'))
  massHall(s.at(13, 0, 2, 'harvard/mass-hall'))
  memorialChurch(s.at(13, 0, 16, 'harvard/church'))
  johnHarvard(s.at(5, 0, 18, 'harvard/statue'))
  widener(s.at(21, 0, 2, 'harvard/widener'))
  sever(s.at(46, 0, 6, 'harvard/sever'))
  elms(s)
}

/* ------------------------------------------------------------------ ground */

/*
 * The paving, and it is the first thing this build does because it is how
 * the stage is ENTERED rather than wandered into.
 *
 * THE NORTH LANE IS POLISHED ANDESITE AND THAT IS NOT A COLOUR CHOICE. Stage
 * 1's front walk leaves its mailbox, turns north at the kerb and runs in
 * polished andesite to the top of its plot. This is the same paving, the same
 * width, picked up on the other side of the road and carried in through the
 * north gate. A visitor who followed it out of Omaha is still on it. Nothing
 * else in this build is allowed to use that block at ground level.
 *
 * Everything else underfoot is gravel, which is what the Yard's paths are,
 * and everything not paved stays grass, which is what a yard is.
 */
function ground(s) {
  s.rect([0, 0], [55, 1], -1, 'polished_andesite')   // the thread, carried east
  s.rect([0, 26], [55, 27], -1, 'gravel')            // the south lane, back the other way

  s.rect([2, 2], [3, 25], -1, 'gravel')              // the cross walk, gate to gate
  s.rect([0, 12], [20, 15], -1, 'gravel')            // the axis, main gate to Widener
  s.rect([4, 6], [12, 7], -1, 'gravel')              // ...to Mass Hall's door
  s.rect([4, 20], [12, 21], -1, 'gravel')            // ...to the church door
  s.rect([43, 2], [46, 25], -1, 'gravel')            // the back court, behind Widener
  s.rect([47, 2], [48, 5], -1, 'gravel')             // ...and up to Sever's north door
  s.rect([52, 23], [53, 25], -1, 'gravel')           // ...and its south door
}

/*
 * The Yard wall and its three gates.
 *
 * Two courses of brick with a white coping, which is the whole of Harvard's
 * perimeter and the cheapest possible way to make a field read as a yard.
 * The wall is at x = 1, one block inside the plot, so the road verge and its
 * stage marker stay clear -- road.js stands the number 2 on the verge at
 * this plot's north end and a pier in front of it would be a digit with a
 * hole in it.
 *
 * THE GATES ARE BLACK STAINED GLASS, not a solid block. There is no iron bar
 * in this game's 659 keys, and a gate you cannot see through is a door. Dark
 * glass in a quartz frame reads as ironwork from the road and lets you see
 * the Yard through it, which is the entire point of a Harvard gate.
 */
function wallAndGates(s) {
  const openings = [[0, 1], [12, 15], [26, 27]]      // north, main, south
  const open = (z) => openings.some(([a, b]) => z >= a && z <= b)

  for (let z = 0; z <= 27; z++) {
    if (open(z)) continue
    s.box([1, 0, z], [1, 1, z], 'bricks')
    s.set(1, 2, z, 'smooth_quartz_slab')
  }

  // Piers: a brick post with a white cap, one either side of every opening
  // and two more to break the runs up.
  for (const z of [2, 6, 11, 16, 21, 25]) {
    s.pillar(1, z, 0, 3, 'bricks')
    s.set(1, 4, z, 'smooth_quartz')
  }

  /*
   * The main gate, on the axis, and the thing a visitor actually walks
   * through. Two tall piers, a lamp on each, and an overthrow of dark glass
   * scrollwork that starts at y = 4 -- above a player's head, because the
   * opening has to stay walkable and an arch you crouch under is a bug.
   */
  for (const z of [11, 16]) {
    s.pillar(1, z, 0, 6, 'bricks')
    s.set(1, 3, z, 'smooth_quartz')
    s.set(1, 7, z, 'smooth_quartz')
    s.set(1, 8, z, 'sea_lantern')
  }
  s.box([1, 4, 12], [1, 6, 15], 'black_stained_glass')
  s.line([1, 7, 12], [1, 7, 15], 'smooth_quartz')
  s.set(1, 5, 13, 'polished_blackstone')             // the scroll, picked out
  s.set(1, 5, 14, 'polished_blackstone')

  // The two side gates get the same treatment at half the height.
  for (const [a, b] of [[0, 1], [26, 27]]) {
    s.box([1, 3, a], [1, 4, b], 'black_stained_glass')
    s.line([1, 5, a], [1, 5, b], 'smooth_quartz')
  }
}

/* ------------------------------------------------------------------ letter */

/*
 * THE HINGE, RECEIVED. Written at (2, 0, 0), which is the first block inside
 * the north gate and the far end of stage 1's walk.
 *
 * Stage 1's mailbox has its flag UP and a sealed envelope in it. This one is
 * the same mailbox -- same post, same white box, same crimson letter -- with
 * the flag DOWN and the envelope lying open on the quartz beside it. The
 * letter arrived, it got read, and the person who read it is standing in the
 * Yard. That is the whole of stage 2 in five blocks, and it is deliberately
 * the smallest thing on the plot: the walk here took one summer and one
 * conversation, and it should not need a monument.
 */
function theLetter(m) {
  m.rect([0, 0], [4, 1], -1, 'smooth_quartz')

  m.pillar(1, 0, 0, 1, 'dark_oak_wood')              // the post
  m.set(1, 2, 0, 'white_concrete')                   // the box
  m.set(1, 1, 1, 'red_concrete')                     // the flag, DOWN

  m.set(3, 0, 1, 'white_concrete')                   // the envelope, open
  m.set(3, 0, 0, 'crimson_planks')                   // the sheet out of it
  m.set(2, 0, 1, 'sea_lantern')                      // read at night, then
}

/* ------------------------------------------------------------------- elms */

/*
 * The Yard's elms. Taller and narrower than stage 1's oaks -- a yard tree is
 * a trunk you can see under and a canopy over your head, not a bush. Two of
 * them have turned, because of the month at the top of this file.
 */
function elm(t, leaves = 'oak_leaves') {
  t.pillar(0, 0, 0, 5, 'oak_log')
  t.box([-2, 5, -2], [2, 6, 2], leaves)
  t.box([-1, 7, -1], [1, 7, 1], leaves)
  t.set(0, 8, 0, leaves)
  t.clear([0, 5, 0], [0, 6, 0])
  t.pillar(0, 0, 5, 6, 'oak_log')
}

function elms(s) {
  elm(s.at(6, 0, 4, 'harvard/elm'))
  elm(s.at(6, 0, 9, 'harvard/elm'), 'birch_leaves')
  elm(s.at(10, 0, 4, 'harvard/elm'))
  elm(s.at(10, 0, 25, 'harvard/elm'), 'cherry_leaves')
  elm(s.at(6, 0, 24, 'harvard/elm'))
  elm(s.at(45, 0, 2, 'harvard/elm'), 'birch_leaves')
}

/* --------------------------------------------------------------- mass hall */

/*
 * The north range: red brick, white trim, black shutters, slate roof. Every
 * hall round the Old Yard is some version of this and there is no point
 * pretending otherwise -- what makes it Harvard is the shutters and the
 * white band between the storeys, both of which cost one row of a pattern.
 *
 * Its facade faces -x, which is the road, because that is where every
 * visitor is standing. The building is eight deep and ten of frontage, which
 * is exactly ten characters of a pattern row, which is why it is ten.
 *
 * INTERIORS MATTER: a common room with the fire lit downstairs, and upstairs
 * one dorm room -- a bed, a desk, a shelf and a rug. One room, because one
 * room is what anybody actually had.
 */
function massHall(h) {
  const W = 7, D = 9
  h.rect([0, 0], [W, D], -1, 'planks')               // floorboards IN PLACE OF the grass
  h.hollow([0, 0, 0], [W, 4, D], { walls: 'bricks', ceiling: 'planks', inside: 'air' })
  h.hollow([0, 4, 0], [W, 9, D], { walls: 'bricks', ceiling: 'planks', inside: 'air' })

  /*
   * The front, drawn the way it looks. Shutters flank every window, the
   * white band runs between the storeys, and the door is a hole cut after
   * the fact -- see stage 1's garage, where a brick course across the bottom
   * of a doorway survived every check except a screenshot.
   */
  h.pattern({
    at: [0, 0, 0], plane: 'zy',
    legend: {
      '#': 'bricks', 'Q': 'smooth_quartz', 'W': 'glass',
      'S': 'black_concrete', 'D': 'dark_oak_planks',
    },
    rows: [
      '##########',
      'QQQQQQQQQQ',
      'SWWS##SWWS',
      'SWWS##SWWS',
      '##########',
      'QQQQQQQQQQ',
      'SWWS##SWWS',
      'SWWSDDSWWS',
      '####DD####',
      'QQQQDDQQQQ',
    ],
  })
  h.clear([0, 0, 4], [0, 2, 5])                      // the doorway
  h.set(0, 3, 3, 'glowstone')                        // and the lamps beside it
  h.set(0, 3, 6, 'glowstone')

  // Glass on the other three faces too. A building with windows on one side
  // is a film set the moment somebody walks round the back of it.
  for (const z of [2, 3, 6, 7]) {
    h.box([W, 1, z], [W, 2, z], 'glass')
    h.box([W, 5, z], [W, 6, z], 'glass')
  }
  for (const x of [2, 5]) {
    for (const z of [0, D]) {
      h.box([x, 1, z], [x, 2, z], 'glass')
      h.box([x, 5, z], [x, 6, z], 'glass')
    }
  }

  massHallCommonRoom(h, W, D)
  massHallRoom(h.at(1, 5, 5, 'harvard/dorm-room'))
  slateRoof(h, W, D, 10)
}

/** Downstairs: the fire, the shelves, and the stair up. Five solid blocks,
 *  not stair blocks -- a mis-faced stair key is a staircase you cannot climb
 *  and you only find out by walking it. */
function massHallCommonRoom(h, W, D) {
  h.clear([1, 4, 1], [5, 4, 2])                      // the stairwell
  for (let i = 0; i <= 4; i++) h.box([1 + i, 0, 1], [1 + i, i, 1], 'planks')

  h.box([6, 0, 7], [6, 2, 8], 'bricks')              // the hearth
  h.set(6, 1, 8, 'magma_block')                      // ...lit
  h.box([6, 0, 3], [6, 1, 5], 'bookshelf')
  h.box([2, 0, 6], [4, 0, 6], 'dark_oak_planks')     // the long table
  h.set(3, 1, 6, 'torch')
  h.set(1, 0, 8, 'barrel')

  h.set(2, 4, 4, 'glowstone')
  h.set(5, 4, 7, 'glowstone')
}

/*
 * Upstairs, one room. The crimson is the only decoration and there is not a
 * lot of it, which is what a first-year room looks like in a photograph.
 */
function massHallRoom(r) {
  r.box([0, 0, 0], [1, 0, 2], 'white_wool')          // the bed
  r.set(0, 0, 0, 'crimson_planks')                   // the pillow end
  r.set(1, 0, 0, 'crimson_planks')
  r.rect([2, 0], [4, 2], -1, 'red_concrete')         // the rug, let into the boards
  r.box([4, 0, 0], [4, 0, 2], 'dark_oak_planks')     // the desk
  r.set(4, 1, 1, 'torch')
  r.set(4, 0, 3, 'bookshelf')
  r.set(0, 0, 3, 'barrel')
  r.set(2, 4, 1, 'glowstone')        // let into the ceiling, not a rock on the floor
}

/*
 * A slate gable. Six courses stepping in by one, ridge running east-west so
 * the gable end faces the road, eaves overhanging by one.
 *
 * THE CARVE IS PER-COURSE AND THAT IS THE PART THAT GOES WRONG. Cutting one
 * box out of the middle of the stack does not leave an attic, it leaves a
 * hole in the roof, because every course above the cut is inside it. Stage 1
 * found this by dumping a slice of the patch in node.
 *
 * The lowest course's north edge is SNOW. He graduated in December.
 */
function slateRoof(h, W, D, y0) {
  const courses = [[-1, D + 1], [0, D], [1, D - 1], [2, D - 2], [3, D - 3], [4, D - 4]]
  courses.forEach(([z0, z1], i) => h.rect([-1, z0], [W + 1, z1], y0 + i, 'deepslate_tiles'))
  courses.forEach((_, i) => {
    const above = courses[i + 1]
    if (!above || above[0] + 1 > above[1] - 1) return
    h.box([1, y0 + i, above[0] + 1], [W - 1, y0 + i, above[1] - 1], 'air')
  })
  h.line([-1, y0, -1], [W + 1, y0, -1], 'snow_block')
}

/* ------------------------------------------------------------------ church */

/*
 * Memorial Church: white, with the tower at the ROAD end of the south range.
 *
 * A steeple is the only silhouette in this whole world that reads from two
 * hundred blocks, and render distance is a hundred and twenty-eight, so it
 * goes as near the road as the wall allows and nothing taller stands in
 * front of it. Twenty-four blocks, white, lit at the belfry -- which is what
 * you see first walking north up the road, before you can see there is a
 * yard behind it at all.
 *
 * You come in through the tower and out into the nave: pews, an aisle, a lit
 * altar and tall glass. It is a small church, because the plot is 28 of
 * frontage and a cathedral would have eaten the Yard.
 */
function memorialChurch(c) {
  const W = 7, D = 9
  c.hollow([0, -1, 0], [W, 7, D], {
    walls: 'white_concrete', floor: 'polished_andesite', ceiling: 'smooth_quartz', inside: 'air',
  })

  // Tall glass down both flanks and the east end, crimson at the head of each.
  for (const z of [2, 4, 6]) {
    c.box([W, 1, z], [W, 4, z], 'white_stained_glass')
    c.set(W, 5, z, 'red_stained_glass')
  }
  for (const x of [2, 5]) {
    for (const z of [0, D]) {
      c.box([x, 1, z], [x, 4, z], 'white_stained_glass')
      c.set(x, 5, z, 'red_stained_glass')
    }
  }

  // Pews either side of a crimson aisle, the altar lit at the east end.
  c.rect([1, 4], [6, 4], -1, 'red_concrete')
  for (const z of [2, 3, 5, 6]) c.line([2, 0, z], [5, 0, z], 'spruce_slab')
  c.box([6, 0, 3], [6, 1, 5], 'smooth_quartz')
  c.set(6, 1, 4, 'glowstone')
  c.box([1, 0, 1], [1, 3, 1], 'quartz_pillar')       // the organ case
  c.box([1, 0, 7], [1, 3, 7], 'quartz_pillar')
  for (const [x, z] of [[2, 2], [5, 2], [2, 7], [5, 7]]) c.set(x, 7, z, 'glowstone')

  slateRoof(c, W, D, 8)
  steeple(c.at(0, 0, 0, 'harvard/steeple'))
}

/*
 * The tower, engaged at the west end and projecting toward the road, and the
 * spire on top of it. The belfry is four posts and a sea lantern rather than
 * a bell -- there is no bell in this game's block list, and an open arch with
 * a light in it is what a belfry looks like from the ground anyway.
 */
function steeple(t) {
  t.hollow([-3, -1, 2], [0, 13, 6], {
    walls: 'white_concrete', floor: 'polished_andesite', inside: 'air',
  })
  t.clear([-3, 0, 4], [-3, 2, 4])                    // the church door, facing the road
  t.clear([0, 0, 4], [0, 2, 4])                      // ...and the arch into the nave
  t.set(-3, 3, 4, 'glowstone')
  for (const y of [5, 9]) {
    t.set(-3, y, 4, 'white_stained_glass')
    t.set(-1, y, 2, 'white_stained_glass')
    t.set(-1, y, 6, 'white_stained_glass')
  }

  t.rect([-4, 1], [1, 7], 14, 'smooth_quartz')       // the cap, overhanging
  for (const [x, z] of [[-4, 1], [1, 1], [-4, 7], [1, 7]]) t.set(x, 15, z, 'snow_block')

  for (const [x, z] of [[-3, 2], [0, 2], [-3, 6], [0, 6]]) t.pillar(x, z, 15, 18, 'white_concrete')
  t.set(-2, 15, 4, 'sea_lantern')                    // the belfry, lit
  t.rect([-3, 2], [0, 6], 19, 'smooth_quartz')

  t.rect([-3, 2], [0, 6], 20, 'smooth_quartz')       // the spire
  t.rect([-2, 3], [-1, 5], 21, 'smooth_quartz')
  t.rect([-2, 3], [-1, 5], 22, 'smooth_quartz')
  t.line([-2, 23, 4], [-1, 23, 4], 'smooth_quartz')
  t.set(-2, 24, 4, 'gold_block')
}

/* ----------------------------------------------------------- john harvard */

/*
 * THE STATUE OF THREE LIES, and the crypt under it.
 *
 * Bronze, seated, facing the gate, with one shoe rubbed gold -- which is the
 * only part of the real thing anybody touches, and the only part of this one
 * that is not copper. (The other tradition associated with that statue is
 * not built here and will not be.)
 *
 * EASTER EGG, UNDER. The inscription on the real plinth gets three things
 * wrong: the man who sat for it was not John Harvard, John Harvard did not
 * found the college, and it was not founded in 1638. So there are three
 * crimson tablets in a lit room underneath, and the way in is two missing
 * paving stones directly BEHIND him -- the one part of the plaza nobody
 * looks at, because everybody is standing in front of a statue.
 *
 * The vertical budget is the same four blocks stage 1's cellar had: grass at
 * -1, dirt at -2 and -3, bedrock at -4. Two blocks of headroom, no room for
 * a staircase, so the way down is a drop onto a crate and the way back up is
 * the crate beside it. A 1x1 shaft would be a trap -- from the floor the
 * plaza is three up and a jump is one.
 */
function johnHarvard(j) {
  j.rect([-2, -2], [4, 4], -1, 'polished_andesite')  // the plaza, over the crypt lid

  j.box([0, 0, 0], [2, 1, 2], 'stone_bricks')        // the plinth
  j.rect([0, 0], [2, 2], 2, 'chiseled_stone_bricks')
  for (const z of [0, 1, 2]) j.set(0, 1, z, 'gold_block')   // three marks, west face

  j.box([-1, 3, 0], [1, 3, 2], 'copper_block')       // legs, feet over the edge
  j.set(-1, 3, 2, 'gold_block')                      // the shoe
  j.box([0, 4, 0], [2, 4, 2], 'copper_block')        // lap and seat
  j.box([1, 5, 0], [2, 6, 2], 'copper_block')        // torso and the chair back
  j.set(1, 7, 1, 'copper_block')                     // head
  j.line([2, 7, 0], [2, 7, 2], 'copper_block')       // the chair, finished
  j.set(0, 5, 1, 'bookshelf')                        // the book on his knee

  crypt(j.at(0, 0, 0, 'harvard/three-lies'))
}

function crypt(c) {
  c.box([-2, -4, -2], [4, -4, 4], 'stone')           // a floor over the bedrock
  c.box([-2, -3, -2], [4, -2, 4], 'air')             // two blocks of headroom
  for (const [a, b] of [[[-2, -2], [-2, 4]], [[4, -2], [4, 4]], [[-2, -2], [4, -2]], [[-2, 4], [4, 4]]]) {
    c.box([a[0], -3, a[1]], [b[0], -2, b[1]], 'cobblestone')
  }

  // The way in and the way out, and they are the same two crates.
  c.set(3, -1, 1, 'air')
  c.set(3, -1, 2, 'air')
  c.set(3, -3, 1, 'barrel')
  c.set(3, -3, 2, 'cobblestone')
  c.set(3, -2, 2, 'barrel')

  // Three tablets. One lie each; the file header says which.
  for (const x of [-1, 1, 3]) {
    c.set(x, -3, -1, 'polished_blackstone')
    c.set(x, -2, -1, 'crimson_planks')
  }
  c.set(0, -3, -1, 'torch')
  c.set(2, -3, -1, 'torch')
  c.set(-1, -2, 3, 'glowstone')
  c.set(3, -2, 3, 'glowstone')
  c.set(-1, -3, 1, 'bookshelf')
}

/* ----------------------------------------------------------------- widener */

/*
 * WIDENER. The whole reason the plot is 56 deep.
 *
 * Twelve columns, a flight of steps and a date. The steps and the colonnade
 * are the single most recognisable silhouette Harvard has and they read in
 * blocks better than anything else here, so they get the axis, they face the
 * road, and nothing is allowed to stand in front of them.
 *
 * THE DATE ON THE FRIEZE IS 2024, which is when he graduated. December, but
 * a building carves a year, not a month; the month is the snow on the north
 * eaves of the two halls behind you.
 *
 * WHY THE STEPS ARE ONLY FOUR AND NOT TWELVE. A monumental flight is the
 * right proportion and the wrong height: the frieze is already at y = 15 and
 * a walking player's eye is at about 1.6, so every block you add to the
 * podium is a block further from anybody being able to read the front of the
 * building. Four steps, a deck at y = 3, and the colonnade starts low enough
 * that from the gate you see columns rather than masonry.
 *
 * Three floors, all walkable: the stacks underneath (three blocks of
 * headroom, which is what Widener's stacks actually feel like), the reading
 * room above, and the roof -- which is where the last easter egg lives.
 */
function widener(w) {
  const E = 21, S = 23          // the east wall and the south wall, in local x/z

  // The approach: a quartz landing, then four steps up to the deck.
  w.rect([0, 0], [1, S], -1, 'smooth_quartz')
  for (let i = 0; i <= 3; i++) w.box([2 + i, 0, 0], [2 + i, i, S], 'smooth_quartz')
  w.box([6, -1, 0], [8, 2, S], 'bricks')             // the podium under the portico
  w.rect([6, 0], [8, S], 3, 'smooth_quartz')         // ...and its deck

  /*
   * TWELVE COLUMNS, which is the number Widener has. Every other block of
   * frontage, which is what gives a colonnade its rhythm -- evenly spaced
   * columns with a gap you can walk through between each pair.
   */
  for (let z = 1; z <= S; z += 2) {
    w.pillar(6, z, 4, 11, 'quartz_pillar')
    w.set(6, 12, z, 'smooth_quartz')                 // the capital
  }
  w.box([6, 13, 0], [8, 13, S], 'smooth_quartz')     // architrave, and the portico ceiling
  w.box([6, 14, 0], [9, 19, S], 'bricks')            // the attic storey above it
  w.box([6, 15, 0], [6, 19, S], 'red_concrete')      // the frieze field
  w.pattern({
    at: [6, 15, 4], plane: 'zy',
    legend: { '#': 'smooth_quartz', ' ': 'red_concrete' },
    rows: word('2024'),
  })
  w.box([5, 20, 0], [9, 20, S], 'smooth_quartz')     // the cornice, overhanging
  for (let z = 0; z <= S; z += 2) w.set(6, 21, z, 'smooth_quartz')   // the balustrade

  // The shell: stacks below, reading room above, roof deck on top.
  w.hollow([9, -1, 0], [E, 3, S], {
    walls: 'bricks', floor: 'polished_andesite', ceiling: 'dark_oak_planks', inside: 'air',
  })
  w.hollow([9, 3, 0], [E, 13, S], { walls: 'bricks', ceiling: 'dark_oak_planks', inside: 'air' })
  w.rect([9, 0], [E, S], 14, 'polished_diorite')     // the roof you can stand on
  w.hollow([9, 15, 0], [E, 15, S], { walls: 'smooth_quartz' })       // its parapet

  // The front door, off the portico, on the axis. Cut AFTER the wall, and
  // cut from the floor up, so there is no brick course across the threshold.
  w.clear([9, 4, 11], [9, 6, 12])
  w.box([9, 7, 10], [9, 7, 13], 'smooth_quartz')
  w.set(9, 7, 11, 'glowstone')
  w.set(9, 7, 12, 'glowstone')

  // Glass on all four faces of the reading room.
  for (const z of [3, 4, 19, 20]) {
    w.box([9, 6, z], [9, 10, z], 'white_stained_glass')
    w.box([E, 6, z], [E, 10, z], 'white_stained_glass')
  }
  for (const x of [12, 13, 16, 17]) {
    w.box([x, 6, 0], [x, 10, 0], 'white_stained_glass')
    w.box([x, 6, S], [x, 10, S], 'white_stained_glass')
  }

  wideStacks(w, E, S)
  readingRoom(w, E, S)
  roofNook(w.at(0, 0, 0, 'harvard/korean'))
}

/*
 * THE STACKS. Three blocks of headroom, five runs of shelving, torchlight,
 * and a service door at each end -- north to the lane, east to the back
 * court and Sever. This is the route through the building: in at the front
 * off the portico, down the stair at the back of the reading room, out the
 * east door into the court.
 */
function wideStacks(w, E, S) {
  for (const x of [11, 13, 15, 17, 19]) w.box([x, 0, 3], [x, 2, 20], 'bookshelf')
  for (const x of [12, 14, 16, 18]) {
    w.set(x, 0, 2, 'torch')
    w.set(x, 0, 21, 'torch')
    w.set(x, 3, 11, 'glowstone')                     // let into the boards above
  }
  w.clear([14, 0, 0], [15, 2, 0])                    // north service door
  w.clear([E, 0, 11], [E, 2, 12])                    // east door, out to the court
  w.set(10, 0, 1, 'barrel')
  w.set(10, 0, 20, 'crafting_table')

  /*
   * The stair up into the reading room, at the back. Four solid blocks, not
   * stair blocks: a mis-faced stair key builds a staircase you cannot climb
   * and the only way you find out is by walking it.
   */
  w.clear([10, 3, 22], [12, 3, 22])
  for (let i = 0; i <= 3; i++) w.box([10 + i, 0, 22], [10 + i, i, 22], 'dark_oak_planks')
}

/*
 * THE READING ROOM. Two long tables with lamps down the middle, benches
 * either side, a shelf wall, and the stair to the roof running up the north
 * wall.
 *
 * EASTER EGG, BEHIND. The bookcase run at x = 18 has exactly one gap in it,
 * at the far south end, where nobody walks. Behind it is a stack aisle, and
 * the back of the aisle says MAL in red -- eleven blocks wide, five tall,
 * facing west so it reads the right way round. He minored in Spanish. He
 * says his Spanish is bad. The wall it is painted on is a FALSE wall one
 * block inside the real one, so nothing shows from the back court: an easter
 * egg you can read from outside the building is not an easter egg.
 */
function readingRoom(w, E, S) {
  for (const [x, z] of [[12, 6], [12, 17], [16, 6], [16, 17], [14, 11]]) w.set(x, 13, z, 'glowstone')

  w.box([12, 4, 3], [13, 4, 20], 'dark_oak_planks')  // the tables
  w.box([15, 4, 3], [16, 4, 20], 'dark_oak_planks')
  for (const z of [5, 9, 13, 17]) {
    w.set(12, 5, z, 'glowstone')
    w.set(16, 5, z, 'glowstone')
  }
  for (const x of [11, 14, 17]) w.line([x, 4, 3], [x, 4, 20], 'oak_slab')   // benches
  w.box([14, 4, 22], [17, 7, 22], 'bookshelf')       // the south shelf wall

  // The stair to the roof: eleven blocks up the north wall, arriving level
  // with the deck. The ceiling and the deck are cut out over it first.
  w.clear([10, 13, 1], [E - 1, 13, 1])
  w.clear([10, 14, 1], [E - 2, 14, 1])
  for (let i = 0; i <= 10; i++) w.box([10 + i, 4, 1], [10 + i, 4 + i, 1], 'dark_oak_planks')

  // The shelf run, and its one gap.
  w.box([18, 4, 2], [18, 8, 20], 'bookshelf')
  w.box([20, 4, 6], [20, 8, 16], 'white_concrete')   // the false wall behind it
  w.pattern({
    at: [20, 4, 6], plane: 'zy',
    legend: { '#': 'red_concrete', ' ': 'white_concrete' },
    rows: word('MAL'),
  })
  w.set(19, 3, 11, 'sea_lantern')                    // let into the aisle floor
  w.box([19, 4, 18], [19, 4, 19], 'dark_oak_planks') // the carrel
  w.set(19, 5, 18, 'torch')
  w.set(19, 4, 20, 'bookshelf')
  w.set(19, 4, 3, 'barrel')
}

/*
 * EASTER EGG, ON TOP. Widener's roof, up the stair at the north wall.
 *
 * A desk, a lamp, and the Korean flashcards -- white ground, red over blue,
 * a black bar at each corner -- laid out and walked away from. Spanish is
 * finished and downstairs behind a bookcase; Korean is unfinished and on the
 * roof, which is where an unfinished thing belongs. Nothing at ground level
 * tells you either of them is there.
 */
function roofNook(k) {
  k.box([13, 15, 5], [15, 15, 5], 'dark_oak_planks')
  k.set(14, 16, 5, 'torch')
  k.set(12, 15, 4, 'sea_lantern')
  k.set(16, 15, 4, 'barrel')

  k.rect([12, 9], [16, 13], 15, 'white_concrete')
  k.box([13, 15, 10], [14, 15, 10], 'red_concrete')
  k.box([13, 15, 11], [14, 15, 11], 'blue_concrete')
  for (const [x, z] of [[12, 9], [16, 9], [12, 13], [16, 13]]) k.set(x, 15, z, 'black_concrete')
}

/* ------------------------------------------------------------------- sever */

/*
 * SEVER: the lecture hall, behind the library, red brick with a long slate
 * roof. You reach it through Widener -- in at the front, down the stair at
 * the back of the reading room, out the east door of the stacks, across the
 * court -- which is the point of putting it here rather than on the Yard.
 *
 * APPLIED MATHEMATICS WITH COMPUTER SCIENCE is on the blackboard, because
 * that is the only honest place to put a degree: a curve with its axes on
 * the left, and a three-node tree on the right. Both halves, one board.
 * (Both are also mirror-safe, which matters -- see the note about which way
 * text reads on a wall at the top of this file.)
 *
 * The seats tier AWAY from the board, which is the way a lecture hall is
 * built and the reason you can see anything from the back.
 */
function sever(v) {
  const W = 8, D = 16
  v.hollow([0, -1, 0], [W, 7, D], {
    walls: 'bricks', floor: 'polished_andesite', ceiling: 'dark_oak_planks', inside: 'air',
  })
  v.box([0, 6, 0], [W, 6, D], 'smooth_quartz')       // the white band under the eaves
  v.clear([1, 0, 0], [2, 2, 0])                      // the north door, from the lane
  v.clear([6, 0, D], [7, 2, D])                      // the south door, to the lane
  for (const z of [3, 4, 11, 12]) v.box([W, 3, z], [W, 5, z], 'glass')
  for (const x of [4, 5]) {
    v.box([x, 3, 0], [x, 5, 0], 'glass')
    v.box([x, 3, D], [x, 5, D], 'glass')
  }

  /*
   * The board. Drawn straight onto the west wall, so the block you see from
   * a seat IS the board -- a black panel one block in front of the wall
   * would have been a block of the room given away for nothing.
   */
  v.pattern({
    at: [0, 1, 1], plane: 'zy',
    legend: { '#': 'white_concrete', ' ': 'black_concrete' },
    rows: [
      '       #   #  ',
      '#     #   # # ',
      '#   ##   #   #',
      '# ##          ',
      '########      ',
    ],
  })

  v.box([1, 0, 7], [1, 0, 9], 'dark_oak_planks')     // the lectern
  v.set(1, 1, 8, 'torch')
  v.set(2, 0, 14, 'bookshelf')

  v.box([3, 0, 1], [4, 0, D - 1], 'polished_andesite')   // the tiers
  v.line([4, 1, 2], [4, 1, D - 2], 'spruce_slab')
  v.box([5, 0, 1], [6, 1, D - 1], 'polished_andesite')
  v.line([6, 2, 2], [6, 2, D - 2], 'spruce_slab')
  v.box([7, 0, 1], [7, 2, D - 1], 'polished_andesite')
  v.line([7, 3, 2], [7, 3, D - 2], 'spruce_slab')

  for (const [x, z] of [[2, 4], [2, 12], [6, 4], [6, 12]]) v.set(x, 7, z, 'glowstone')

  /*
   * A slate gable with the ridge down the LONG axis, courses stepping in
   * across the building rather than along it. Carved per course -- the same
   * trap stage 1's roof fell into, where one big cut through the middle of
   * the stack leaves a hole rather than an attic.
   */
  const courses = [[-1, W + 1], [0, W], [1, W - 1], [2, W - 2], [3, W - 3], [4, W - 4]]
  courses.forEach(([x0, x1], i) => v.rect([x0, -1], [x1, D + 1], 8 + i, 'deepslate_tiles'))
  courses.forEach((_, i) => {
    const above = courses[i + 1]
    if (!above || above[0] + 1 > above[1] - 1) return
    v.box([above[0] + 1, 8 + i, 1], [above[1] - 1, 8 + i, D - 1], 'air')
  })
  v.line([-1, 8, -1], [-1, 8, D + 1], 'snow_block')  // December, again -- the low eave
}
