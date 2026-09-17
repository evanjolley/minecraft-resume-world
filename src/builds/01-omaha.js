/*
 * STAGE 1 -- OMAHA, NEBRASKA. Where it starts.
 *
 * This is the worked example the other seven stages are meant to be a copy of
 * the shape of, so it is written to be READ: every section is a function
 * named after the thing a visitor walks into, and every function is written
 * in its own coordinates via `s.at(...)`. If you find yourself doing
 * arithmetic on a plot coordinate, move the origin instead.
 *
 * ------------------------------------------------------------------------
 * WHAT IS HERE, AND WHY IT IS HERE. Everything below is from the owner's own
 * record. Nothing factual is invented -- the licence this build takes is in
 * how a fact is DRAWN, never in what the fact is.
 *
 *   a midwestern house      grew up in Omaha, walked into and lived in
 *   three bedrooms upstairs an older brother and a younger sister
 *   the school across the   Millard Public Schools -- Harvey Oaks Elementary,
 *     yard                  Millard North Middle, Millard North High
 *   the doghouse and the    Jolley Good Pettsitting Co., the first business,
 *     buried emeralds       run in high school to raise $3k for a soccer
 *                           trip to Italy
 *   the white tower         Cornhusker Boys State, which he goes back and
 *                           volunteers at every single year
 *   the big red N, the      Nebraska college football
 *     cornfield
 *   the letter in the       Ben Schafer, a Boys Nation counsellor, Harvard
 *     mailbox and the       class of 2019, talked him into applying the
 *     path north            summer before senior year -- which is the hinge
 *                           into stage 2 and is POINTED AT here, not built
 *   the shack on the        Minecraft since 2011, as `jollyboys`: a first
 *     garage roof           night's dirt-and-cobble hut, which is what
 *                           everybody's 2011 actually looked like
 *   the thing in the cellar  see below
 *
 * THE EASTER EGGS, three of them, one for each direction you have to look:
 *
 *   UNDER   the cellar, reached through the missing plank in the back porch,
 *           and the vault at the far end of it. The owner's stated example of
 *           a thing he would never say is that he likes Iowa. So Iowa is
 *           down there: black and gold, sealed behind obsidian and tinted
 *           glass, lit from below by magma, with Nebraska's N standing over
 *           it. The rivalry is the joke; the joke is that it is the only
 *           thing in this world that had to be locked up.
 *   UNDER   three emerald blocks buried under the doghouse floor. $3k, the
 *           pettsitting money, which went to Italy. You have to dig.
 *   ON TOP  the 2011 shack on the garage roof, reached by the hay bales
 *           stacked against the garage's south wall. A torch, a crafting
 *           table, one dirt wall. Nobody's first house was better than this.
 * ------------------------------------------------------------------------
 * ORIENTATION. The plot is 56 wide (local x 0..55) and 28 deep (z 0..27).
 * +x runs EAST, toward the road, which is where every visitor will be
 * standing -- so the house's front, the N and the mailbox all face +x, and
 * the school is pushed west where it reads as background. +z runs SOUTH.
 * y = 0 is the air above the grass; y = -1 IS the grass.
 */

export function build(s) {
  lawnAndSidewalk(s)
  house(s.at(30, 0, 4, 'omaha/house'))
  garage(s.at(38, 0, 18, 'omaha/garage'))
  cellar(s.at(30, 0, 4, 'omaha/cellar'))
  frontYard(s)
  backYard(s)
  school(s.at(2, 0, 3, 'omaha/school'))
  capitol(s.at(22, 0, 1, 'omaha/capitol'))
  cornfield(s)
}

/* ------------------------------------------------------------------ ground */

/*
 * The street edge. A sidewalk down the plot's road side and a path from the
 * front door out to it, so the plot is entered rather than wandered into.
 *
 * Laid at y = -1, replacing the grass, for the reason road.js gives at
 * length: the ground is the ground, and a path you step up onto is a path you
 * trip over.
 */
function lawnAndSidewalk(s) {
  s.rect([54, 0], [55, 27], -1, 'smooth_stone')
  s.rect([46, 10], [53, 11], -1, 'polished_andesite')   // front walk
  /* ...and the walk TURNS NORTH at the kerb, in its own paving, running the
   * whole way to the plot's north edge and stage 2. See the mailbox below:
   * this is the hinge, and a path is the only way a build can point at
   * something without building it. */
  s.rect([54, 0], [55, 9], -1, 'polished_andesite')
  s.rect([46, 19], [53, 22], -1, 'light_gray_concrete') // driveway
}

/* ------------------------------------------------------------------- house */

/*
 * The house. Sixteen wide, fourteen deep, two floors and a gabled attic,
 * white siding with a brick skirt and a chimney -- which is a description of
 * most of the houses on most of the streets he grew up on.
 *
 * Written at its own origin: (0, 0, 0) here is the house's north-west corner,
 * so every wall below is a small number and the whole house moves by editing
 * one line in `build`.
 *
 * INTERIORS MATTER. A visitor who opens a door and finds a hollow box has
 * been cheated, and this is the build the other seven copy, so it is furnished
 * on both floors: a living room with a fire lit, a kitchen that cooks, and
 * three bedrooms upstairs because there were three children.
 */
function house(h) {
  const W = 15, D = 13           // inclusive: x 0..15, z 0..13
  const FLOOR = 'spruce_planks'

  /*
   * The shell. Floor boards go down at y = -1, IN PLACE OF THE GRASS, so the
   * inside of the house is at the same height as the lawn outside it -- the
   * alternative (a floor at y = 0) builds a house you step up into and a
   * doorway one block off the ground, which is the commonest way a voxel
   * house ends up feeling like a model of a house.
   *
   * Then two storeys, each a `hollow` call: walls, a ceiling, and the inside
   * carved out. The lower storey's ceiling is the upper storey's floor, which
   * is why the second call starts at y = 4 and not y = 5.
   */
  h.box([0, -2, 0], [W, -2, D], 'cobblestone')                       // footing
  h.rect([0, 0], [W, D], -1, FLOOR)
  h.hollow([0, 0, 0], [W, 4, D], { walls: 'white_concrete', ceiling: FLOOR, inside: 'air' })
  h.hollow([0, 4, 0], [W, 8, D], { walls: 'white_concrete', ceiling: FLOOR, inside: 'air' })
  /* The skirt is a RING and not a box. `box` here filled the whole footprint
   * and paved the ground floor in brick a block above its own floorboards --
   * caught by slicing the patch in node, not by reading it. */
  h.hollow([0, 0, 0], [W, 0, D], { walls: 'bricks' })                // the skirt, one course
  for (const [x, z] of [[0, 0], [W, 0], [0, D], [W, D]]) h.pillar(x, z, 0, 8, 'dark_oak_wood')

  /*
   * The front, facing the road. Drawn rather than assembled: this is the
   * facade a visitor sees from a hundred blocks away and it is the reason
   * `pattern` exists. Rows are listed the way the wall looks -- top row at the
   * top -- and the last row sits at y = 0, which is why this reads as a
   * picture of a house rather than as nine calls to box().
   */
  h.pattern({
    at: [W, 0, 0], plane: 'zy',
    legend: {
      '#': 'white_concrete', 'W': 'glass', 'D': 'dark_oak_planks',
      'B': 'bricks', 'L': 'glowstone', '=': 'dark_oak_wood',
    },
    rows: [
      '==============',
      '#WW##WW##WW###',
      '#WW##WW##WW###',
      '##############',
      '==============',
      '#WW###LDL##WW#',
      '#WW####D###WW#',
      '#WW####D###WW#',
      'BBBBBBBDBBBBBB',
    ],
  })
  h.clear([W, 0, 7], [W, 2, 7])              // the doorway is a hole, not a door block

  // The back and the two sides get windows too, because a house with glass on
  // one face reads as a film set the moment you walk round it.
  for (const z of [3, 5, 9, 11]) {
    h.box([0, 2, z], [0, 3, z], 'glass')
    h.box([0, 6, z], [0, 7, z], 'glass')
  }
  for (const x of [3, 6, 10, 13]) {
    h.box([x, 2, 0], [x, 3, 0], 'glass')
    h.box([x, 2, D], [x, 3, D], 'glass')
    h.box([x, 6, 0], [x, 7, 0], 'glass')
    h.box([x, 6, D], [x, 7, D], 'glass')
  }
  h.clear([0, 0, 7], [0, 2, 7])              // back door, out onto the porch

  houseGroundFloor(h, W, D)
  houseUpstairs(h, W, D)
  roof(h, W, D)

  /*
   * The porch on the back. A plank deck under a plank roof -- and the two
   * boards at (-3, -1, 7) and (-2, -1, 7) are MISSING, which is the way down
   * into the cellar. They are the ones in shadow under the roof, so they are
   * found by looking rather than by walking. `cellar` takes the boards back
   * out, because it runs after this and puts its own ceiling in.
   */
  h.rect([-4, 4], [-1, 10], -1, 'spruce_planks')
  for (const z of [4, 10]) h.pillar(-4, z, 0, 2, 'dark_oak_wood')
  h.rect([-4, 4], [-1, 10], 3, 'dark_oak_planks')
}

/*
 * Downstairs: a living room with the fire lit, a kitchen along the north wall,
 * and the stair up.
 *
 * THE STAIR IS FIVE FULL BLOCKS, not stair blocks. A block step is a jump and
 * a jump always works; a stair block's orientation is a per-key facing in
 * blocks.js (`spruce_stairs_east_bottom` and seven siblings) and picking the
 * wrong one builds a staircase you cannot climb -- a worse bug than a slightly
 * blocky staircase, and one you only find by walking it.
 */
function houseGroundFloor(h, W, D) {
  h.clear([1, 4, 1], [5, 4, 2])                          // the stairwell opening
  for (let i = 0; i <= 4; i++) h.box([1 + i, 0, 1], [1 + i, i, 1], 'spruce_planks')

  // Kitchen, north wall: counter, a furnace that is the cooker, a barrel.
  h.box([7, 0, 1], [12, 0, 1], 'polished_andesite')
  h.set(9, 0, 1, 'furnace')
  h.set(12, 0, 1, 'barrel')
  h.set(7, 0, 1, 'crafting_table')

  // Living room, south end: a brick hearth with a real fire in it, a
  // bookshelf wall, and the television nobody in 2011 was watching.
  h.box([5, 0, D - 1], [7, 2, D - 1], 'bricks')
  h.set(6, 1, D - 1, 'magma_block')                      // the fire: it glows
  h.pillar(6, D - 1, 3, 8, 'bricks')                     // the chimney, up through the house
  h.box([10, 0, D - 1], [12, 1, D - 1], 'bookshelf')
  h.set(3, 0, D - 1, 'black_concrete')

  lights(h, [[4, 4, 4], [11, 4, 4], [4, 4, 10], [11, 4, 10]])
}

/*
 * Upstairs: three bedrooms, because there were three children -- an older
 * brother, him, a younger sister. They are told apart by the colour of the
 * bedding and by nothing else, which is as much as a voxel bedroom can
 * honestly claim about three people.
 */
function houseUpstairs(h, W, D) {
  h.box([4, 5, 1], [4, 7, D - 1], 'spruce_planks')       // the two partition walls
  h.box([10, 5, 1], [10, 7, D - 1], 'spruce_planks')
  h.clear([4, 5, 6], [4, 6, 6])                          // ...with doorways in them
  h.clear([10, 5, 6], [10, 6, 6])

  bedroom(h.at(1, 5, 3), 'blue_concrete')                // the older brother
  bedroom(h.at(6, 5, 3), 'green_concrete')               // him
  bedroom(h.at(12, 5, 3), 'pink_concrete')               // the younger sister

  lights(h, [[2, 8, 8], [7, 8, 8], [13, 8, 8]])
}

/** One bed, one shelf. Written at the bedroom's own corner, which is the
 *  whole argument for `at()`: three bedrooms, three lines, no arithmetic. */
function bedroom(b, colour) {
  b.box([0, 0, 0], [1, 0, 2], 'white_wool')
  b.box([0, 0, 0], [1, 0, 0], colour)                    // the pillow end
  b.set(0, 0, 4, 'bookshelf')
}

/*
 * The gable. Five courses, each stepped in by two, ridge running north-south
 * so the slopes face the road and the back yard. The eaves overhang by one,
 * which is the cheapest single thing that stops a voxel house looking like a
 * box with a triangle on it.
 *
 * THE HOLLOWING IS THE PART THAT WAS WRONG THE FIRST TIME. Carving one big
 * box out of the middle of the stack does not leave an attic, it leaves a
 * hole: every course above the carve is INSIDE it. The interior at each level
 * is only what sits inboard of the course ABOVE, so the carve has to be
 * per-course, which is what this loop is. Found by dumping a top-down view of
 * the patch in node and seeing the second-floor ceiling through the roof.
 */
function roof(h, W, D) {
  const courses = [[-1, W + 1], [1, W - 1], [3, W - 3], [5, W - 5], [7, W - 7]]
  courses.forEach(([x0, x1], i) => h.rect([x0, -1], [x1, D + 1], 9 + i, 'dark_oak_planks'))
  courses.forEach(([, ], i) => {
    const above = courses[i + 1]
    if (!above || above[0] + 1 > above[1] - 1) return
    h.box([above[0] + 1, 9 + i, 1], [above[1] - 1, 9 + i, D - 1], 'air')
  })
  h.box([7, 9, 0], [8, 9, 0], 'glass')                   // a gable window at each end
  h.box([7, 9, D], [8, 9, D], 'glass')
  h.pillar(6, D - 1, 9, 14, 'bricks')                    // the chimney finishes above the ridge
  h.set(6, 15, D - 1, 'polished_blackstone_brick_slab')
}

/** Recessed ceiling lights. A glowstone block swapped into the plank ceiling
 *  reads as a fitting rather than as a glowing rock on the floor -- and the
 *  engine grew real light today, so this is the first build that can. */
function lights(h, spots) {
  for (const [x, y, z] of spots) h.set(x, y, z, 'glowstone')
}

/* ------------------------------------------------------------------ garage */

/*
 * The attached garage, and the two things on it: the big red N facing the
 * road, and the 2011 shack on its roof.
 */
function garage(g) {
  const W = 7, D = 6
  g.box([0, -1, 0], [W, -1, D], 'light_gray_concrete')
  g.hollow([0, 0, 0], [W, 3, D], { walls: 'white_concrete', ceiling: 'dark_oak_planks', inside: 'air' })
  g.hollow([0, 0, 0], [W, 0, D], { walls: 'bricks' })   // a ring, not a box: see the house
  g.clear([W, 1, 2], [W, 3, 4])                          // the garage door, open
  g.set(3, 3, 3, 'glowstone')
  g.set(1, 1, 1, 'crafting_table')
  g.set(1, 1, 5, 'barrel')

  /*
   * NEBRASKA. Five by five, red on white, carried up the EAST wall as a
   * parapet above the garage door -- east is where the road is, and this is
   * the only thing on the plot you can read from two hundred blocks away. It
   * faced south in the first draft, which is a wall facing the cornfield; the
   * mistake is easy to make and impossible to see from a plan view, which is
   * the argument for screenshotting a build from the road before believing it.
   */
  g.box([W, 4, 0], [W, 10, D], 'white_concrete')
  g.pattern({
    at: [W, 5, 1], plane: 'zy',
    legend: { '#': 'red_concrete', '.': 'white_concrete' },
    rows: [
      '#...#',
      '##..#',
      '#.#.#',
      '#..##',
      '#...#',
    ],
  })

  /*
   * EASTER EGG, ON TOP. 2011, `jollyboys`, everybody's first night: a hole in
   * a dirt wall with a torch in it and a crafting table you made four of by
   * accident. The hay bales against the south wall are the way up -- three
   * jumps, no ladder, which is the other thing 2011 was like.
   */
  const shack = g.at(2, 4, 1, 'omaha/2011')
  shack.hollow([0, 0, 0], [2, 2, 2], { walls: 'dirt', ceiling: 'cobblestone', inside: 'air' })
  shack.clear([2, 1, 1], [2, 1, 1])
  shack.set(1, 1, 1, 'torch')
  shack.set(0, 1, 2, 'crafting_table')
  shack.set(1, 1, 2, 'furnace')

  g.pillar(1, D + 1, 0, 0, 'hay_block')
  g.pillar(2, D + 1, 0, 1, 'hay_block')
  g.pillar(3, D + 1, 0, 2, 'hay_block')
  g.pillar(4, D + 1, 0, 3, 'hay_block')
}

/* ------------------------------------------------------------------ cellar */

/*
 * EASTER EGG, UNDER. Written at the house's origin so the two line up without
 * anybody having to add fourteen to anything.
 *
 * THE VERTICAL BUDGET IS FOUR BLOCKS AND THAT IS THE WHOLE DESIGN. The world
 * is Classic Flat: grass at y = -1, two dirt at -2 and -3, bedrock at -4.
 * There is exactly room for a two-block-high room with the house's own floor
 * as its ceiling and the bedrock as its floor, and no room at all for a
 * staircase -- so the way in is a two-block drop through a missing porch
 * plank, which you get back out of by jumping onto the crate under it.
 */
function cellar(c) {
  c.box([-4, -4, 3], [14, -4, 11], 'stone')              // a proper floor over the bedrock
  c.box([-4, -3, 3], [14, -2, 11], 'air')                // the room: two blocks of headroom
  c.box([-4, -1, 3], [14, -1, 11], 'spruce_planks')      // ...under the house's own floorboards
  for (const [a, b] of [[[-4, 3], [-4, 11]], [[14, 3], [14, 11]], [[-4, 3], [14, 3]], [[-4, 11], [14, 11]]]) {
    c.box([a[0], -3, a[1]], [b[0], -2, b[1]], 'cobblestone')
  }

  /*
   * The way in and the way out, which are the same two crates.
   *
   * A 1x1 shaft is a trap: from the cellar floor the deck is three blocks up
   * and a jump is one. So the missing boards are a PAIR, and under them sit a
   * crate at y = -2 and a crate at y = -3 -- step down, step down, and back up
   * the same way. Worth walking before believing; it is the single most likely
   * thing in this build to be subtly unusable.
   */
  c.set(-3, -1, 7, 'air')
  c.set(-2, -1, 7, 'air')
  c.set(-2, -3, 7, 'cobblestone')
  c.set(-2, -2, 7, 'barrel')
  c.set(-3, -3, 7, 'barrel')

  /*
   * The shelf of things that mattered. Cornhusker Boys State, which he still
   * goes back to volunteer at every year, and the Italy trip the pettsitting
   * money paid for -- green, white, red, in that order, which is the flag.
   */
  c.box([2, -3, 4], [2, -2, 4], 'blue_concrete')
  c.set(3, -2, 4, 'white_concrete')
  c.set(5, -3, 4, 'green_concrete')
  c.set(6, -3, 4, 'white_concrete')
  c.set(7, -3, 4, 'red_concrete')
  c.set(9, -3, 4, 'bookshelf')
  c.set(4, -1, 8, 'glowstone')
  c.set(9, -1, 6, 'glowstone')

  /*
   * THE VAULT. Iowa, in Iowa's colours, sealed in obsidian behind tinted
   * glass, lit from underneath by magma, with Nebraska's red over the top of
   * it. He has said that his example of a thing he would never say is that he
   * likes Iowa. This is the only object in this world that is locked up.
   *
   * Its obsidian lid replaces the floorboards in the corner of the living
   * room, which is the hint: there is a black square in the floor of an
   * otherwise ordinary house, and it is directly above the one thing down
   * here that is behind glass.
   */
  const v = c.at(12, 0, 9, 'omaha/vault')
  v.hollow([-1, -4, -1], [1, -1, 1], { walls: 'obsidian', floor: 'obsidian', ceiling: 'obsidian' })
  v.set(0, -4, 0, 'magma_block')
  v.set(0, -3, 0, 'yellow_concrete')
  v.set(0, -2, 0, 'black_concrete')
  v.set(-1, -3, 0, 'tinted_glass')
  v.set(-1, -2, 0, 'tinted_glass')
  v.set(-1, -3, -1, 'red_concrete')
  v.set(-1, -2, -1, 'red_concrete')
}

/* -------------------------------------------------------------- front yard */

/*
 * The front yard: two oaks, the mailbox with the letter still in it, and the
 * sign by the road.
 *
 * THE LETTER IS THE HINGE. A Boys Nation counsellor called Ben Schafer,
 * Harvard 2019, talked him into applying the summer before senior year. So
 * the mailbox holds a white envelope with a crimson mark on it and the walk
 * out of this plot turns NORTH at the kerb, toward stage 2. Pointed at. Not
 * built -- stage 2 is somebody else's plot and this one has no business
 * spoiling it.
 */
function frontYard(s) {
  tree(s.at(49, 0, 5, 'omaha/tree'))
  tree(s.at(50, 0, 23, 'omaha/tree'))

  s.pillar(52, 11, 0, 1, 'dark_oak_wood')
  s.set(52, 2, 11, 'white_concrete')
  s.set(53, 2, 11, 'red_concrete')                       // the flag is up
  s.set(52, 3, 11, 'crimson_planks')                     // and the letter is in it

  // The sign by the road: white board, red N, facing the road head on.
  s.box([52, 0, 4], [52, 6, 9], 'white_concrete')
  s.pillar(52, 4, 0, 6, 'dark_oak_wood')
  s.pillar(52, 9, 0, 6, 'dark_oak_wood')
  s.pattern({
    at: [53, 1, 5], plane: 'zy',
    legend: { '#': 'red_concrete' },
    rows: [
      '#...#',
      '##..#',
      '#.#.#',
      '#..##',
      '#...#',
    ],
  })
  s.set(53, 7, 6, 'sea_lantern')
  s.set(53, 7, 8, 'sea_lantern')
}

/** An oak. Four of trunk and a blob of leaves, with the lowest branch at
 *  head height on the house side -- which is the way onto the garage roof for
 *  anyone who would rather climb than use the hay. */
function tree(t) {
  t.pillar(0, 0, 0, 4, 'oak_log')
  t.box([-2, 3, -2], [2, 4, 2], 'oak_leaves')
  t.box([-1, 5, -1], [1, 5, 1], 'oak_leaves')
  t.set(0, 5, 0, 'oak_leaves')
  t.clear([0, 3, 0], [0, 4, 0])
  t.pillar(0, 0, 3, 4, 'oak_log')
}

/* --------------------------------------------------------------- back yard */

/*
 * The back yard: the goal the Italy money was about, the doghouse the money
 * came from, and what is buried under it.
 */
function backYard(s) {
  // The goal. Posts, crossbar, and a glass net so it reads as a goal from
  // behind as well as from the front.
  const gx = 22, gz = 14
  s.pillar(gx, gz, 0, 2, 'white_concrete')
  s.pillar(gx, gz + 5, 0, 2, 'white_concrete')
  s.line([gx, 3, gz], [gx, 3, gz + 5], 'white_concrete')
  s.box([gx - 1, 0, gz + 1], [gx - 1, 2, gz + 4], 'white_stained_glass')
  s.set(gx + 4, 0, gz + 2, 'white_concrete')             // the ball, left out

  /*
   * JOLLEY GOOD PETTSITTING CO. A doghouse with a bone on the floor and a
   * brown roof, and -- EASTER EGG, UNDER -- three emerald blocks buried in
   * the dirt beneath it. Three thousand dollars, which is what the summer of
   * pettsitting raised and what paid for the trip to Italy. You have to dig
   * through the floor to find them, and nothing above ground says they are
   * there.
   */
  const k = s.at(24, 0, 6, 'omaha/doghouse')
  k.hollow([0, 0, 0], [2, 2, 2], { walls: 'spruce_planks', ceiling: 'brown_terracotta', inside: 'air' })
  k.clear([2, 1, 1], [2, 1, 1])
  k.set(1, 0, 1, 'bone_block')
  k.box([0, 3, 0], [2, 3, 2], 'brown_terracotta')
  k.box([0, -2, 0], [2, -2, 2], 'dirt')
  k.set(1, -2, 1, 'emerald_block')
  k.set(0, -2, 1, 'emerald_block')
  k.set(2, -2, 1, 'emerald_block')
  k.set(4, 0, 1, 'barrel')                               // the kit, left by the door
}

/* ------------------------------------------------------------------ school */

/*
 * Millard Public Schools -- Harvey Oaks Elementary, Millard North Middle,
 * Millard North High. One brick building for all three, because three
 * buildings on one plot would be a campus and this was a childhood.
 *
 * Pushed to the west end of the plot so it reads as the thing across the yard
 * rather than as the thing you arrive at. You can walk in: a corridor with
 * lockers down one side and a classroom off it.
 */
function school(k) {
  const W = 18, D = 17
  k.box([0, -1, 0], [W, -1, D], 'stone_bricks')
  k.hollow([0, 0, 0], [W, 5, D], { walls: 'bricks', floor: 'polished_andesite', ceiling: 'smooth_stone', inside: 'air' })
  k.box([0, 6, 0], [W, 6, D], 'stone_brick_slab')        // parapet, so the roof has an edge

  // Windows: one long band, which is what a school looks like from outside.
  for (let z = 2; z <= D - 2; z += 2) {
    k.box([W, 2, z], [W, 3, z], 'glass')
    k.box([0, 2, z], [0, 3, z], 'glass')
  }
  for (let x = 2; x <= W - 2; x += 2) k.box([x, 2, 0], [x, 3, 0], 'glass')

  // The front doors, facing the house.
  k.clear([W, 1, 8], [W, 3, 9])
  k.box([W, 4, 7], [W, 4, 10], 'polished_andesite')
  k.set(W, 4, 8, 'glowstone')
  k.set(W, 4, 9, 'glowstone')

  // Inside: a corridor, a wall of lockers, and a classroom with desks.
  k.box([1, 0, 6], [W - 1, 3, 6], 'smooth_stone')
  k.clear([9, 1, 6], [10, 2, 6])
  k.box([2, 1, 5], [W - 2, 2, 5], 'light_blue_concrete')  // the lockers
  for (let x = 3; x <= 13; x += 3) {
    for (let z = 9; z <= 13; z += 2) k.set(x, 1, z, 'bookshelf')
  }
  k.box([2, 1, 15], [6, 2, 15], 'black_concrete')         // the blackboard
  k.set(4, 1, 14, 'crafting_table')                       // the teacher's desk

  lights(k, [[4, 5, 3], [13, 5, 3], [4, 5, 11], [13, 5, 11], [9, 5, 8]])

  // The flagpole, out front.
  k.pillar(W + 2, 8, 0, 8, 'quartz_pillar')
  k.box([W + 3, 7, 8], [W + 4, 8, 8], 'red_concrete')
  k.set(W + 3, 8, 8, 'white_concrete')
  k.rect([W + 1, 7], [W + 3, 9], -1, 'polished_andesite')
}

/* ----------------------------------------------------------------- capitol */

/*
 * CORNHUSKER BOYS STATE. A white tower with a gold cap -- Nebraska's capitol,
 * which is where the mock legislature sits and which is the building the
 * whole week is shaped around. He has gone back to volunteer at it every year
 * since, so it is the one thing on this plot that is not past tense.
 *
 * Twelve blocks tall and three wide: tall enough to be the thing you can see
 * over the house from the road, small enough not to compete with it.
 */
function capitol(c) {
  c.rect([-1, -1], [3, 3], -1, 'polished_andesite')
  c.hollow([0, 0, 0], [2, 11, 2], { walls: 'quartz_block', inside: 'air' })
  c.clear([1, 1, 0], [1, 2, 0])
  for (let y = 4; y <= 9; y += 2) {
    c.box([0, y, 1], [0, y, 1], 'glass')
    c.box([2, y, 1], [2, y, 1], 'glass')
  }
  c.box([-1, 12, -1], [3, 12, 3], 'smooth_quartz')
  c.box([0, 13, 0], [2, 13, 2], 'gold_block')
  c.set(1, 14, 1, 'sea_lantern')
  c.set(1, 1, 1, 'glowstone')
}

/* --------------------------------------------------------------- cornfield */

/*
 * Nebraska. Rows of it along the south edge, green stalk and a gold tassel,
 * planted every other block so you can walk down the rows -- which is the
 * only reason a voxel cornfield is worth building rather than painting.
 */
function cornfield(s) {
  for (let x = 1; x <= 36; x += 2) {
    for (let z = 23; z <= 27; z++) {
      s.pillar(x, z, 0, 1, 'oak_leaves')
      s.set(x, 2, z, 'hay_block')
    }
  }
}
