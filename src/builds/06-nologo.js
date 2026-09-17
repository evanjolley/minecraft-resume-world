/*
 * STAGE 6 -- NO LOGO. Two cities and the freight between them.
 *
 * June 2025 to August 2026, New York. Product and Growth, employee number
 * two. Built growth from zero, onboarded the clients, and was the only person
 * thinking about product from day one. $12M GMV -- GMV, not revenue, and the
 * distinction is his, so it is the word on the sign. Time in Shenzhen,
 * scaling that office from two part-time contractors to twenty full-time.
 * Left when the company wound down US operations.
 *
 * ------------------------------------------------------------------------
 * THE SHAPE OF THE PLOT, and why it is this shape.
 *
 * The road runs down the WEST edge, so local x = 0 is the kerb and x = 55 is
 * the far end. The plot is 56 deep and only 28 across the frontage, which is
 * the wrong proportion for one building and exactly the right proportion for
 * a street. So it is a street, and the street is a strait:
 *
 *   z 0..10   SHENZHEN   a glass office you can walk into, three towers
 *                        behind it, a skybridge, a lit skyline
 *   z 11..16  THE YARD   an open axis straight off the road: twelve
 *                        containers stacked down one side, a gantry crane,
 *                        and the gold plinth at the kerb
 *   z 17..27  NEW YORK   a brownstone terrace, a side street running east,
 *                        a subway under it, a pocket park at the back
 *   x 42..52  THE SHED   the terminal at the end of the axis, with 12M / GMV
 *                        written across the wall that faces back down it
 *
 * The two cities never touch. What runs between them is freight, which is
 * the only honest thing to put there, and the yard is deliberately kept low
 * and empty so that standing on the road you can see all the way down it.
 *
 * ------------------------------------------------------------------------
 * THE NUMBERS ARE COUNTABLE, because a number nobody can count is decoration.
 *
 *   TWENTY  desks on the floor of the Shenzhen office, in four rows of five.
 *   TWO     of those twenty are old wooden desks, nearest the door: the two
 *           part-time contractors the office was before it was twenty people.
 *   TWO     is also the number over the door of the New York walkup, which is
 *           the address and is also the employee number.
 *   TWELVE  gold blocks in the plinth at the mouth of the yard, four across
 *           and three up, where a visitor on the road can count them without
 *           stopping -- and twelve shipping containers stacked behind them,
 *           at the other end of the same look. One per million, and the two
 *           words for what the million is are lit on the shed at the far end
 *           of the axis: 12M over GMV.
 *
 * ------------------------------------------------------------------------
 * WHAT IS DELIBERATELY NOT HERE. His record lists the employer's confidential
 * business as never-say and names it: margins, client names, factory
 * relationships. A build is louder than a sentence and lasts longer, so
 * nothing here is a client, a brand, a factory or a margin. The containers
 * are twelve plain colours. The shed is a shed. Nothing in this stage carries
 * a name except GMV and the number 2.
 *
 * AND THE ENDING IS NOT AIRBRUSHED. The New York office is packed. The desks
 * are bare, the chairs are stacked, the boxes are sealed by the door and the
 * door is standing open. US operations wound down;
 * that is in his record in those words and it is the last thing that happened
 * here. The Shenzhen floor next door is still lit and still full, which is
 * the true shape of it and is why the two halves are built at the same time.
 *
 * THE EASTER EGGS, one for each direction you have to look:
 *
 *   UNDER   the subway. Stairs down off the side street into a tiled
 *           platform, lit, with a track bed running east -- and parked at the
 *           far end of the platform, where it absolutely should not be, a
 *           Citi Bike. He cycled all over New York on them for two years. The
 *           dock up on the avenue has five in it; this one is the sixth and
 *           somebody carried it down the stairs.
 *   ON TOP  the roof of the walkup, up two flights of interior stairs and out
 *           through the hatch: a water tower, and one chair facing east.
 * ------------------------------------------------------------------------
 */

export function build(s) {
  avenue(s)
  shenzhen(s.at(4, 0, 0, 'nologo/shenzhen'))
  yard(s.at(4, 0, 11, 'nologo/yard'))
  terminal(s.at(42, 0, 8, 'nologo/terminal'))
  newYork(s.at(4, 0, 17, 'nologo/newyork'))
  subway(s.at(4, 0, 17, 'nologo/subway'))
}

/* ------------------------------------------------------------------ street */

/*
 * The kerb and the sidewalk, the whole length of the frontage. Laid at
 * y = -1, in place of the grass, for the reason the README gives: a pavement
 * you step UP onto is a pavement you trip over, and every door behind it ends
 * up one block off the ground.
 */
function avenue(s) {
  s.rect([0, 0], [3, 27], -1, 'light_gray_concrete')
  s.rect([0, 0], [0, 27], -1, 'polished_andesite')          // the kerb stone
  s.rect([1, 23], [3, 25], -1, 'smooth_stone')              // the corner, where the side street lands

  // Streetlights. Five of them, spaced so the frontage is lit end to end
  // after dark -- which is new today and is most of the reason the interiors
  // below are worth furnishing at all.
  // ...on the ODD columns only. The bike rack below stands on the even ones,
  // and a lamp post growing out of a bicycle is the sort of thing that is
  // invisible in a plan and obvious in a photograph.
  for (const z of [3, 9, 15, 21, 27]) {
    s.pillar(2, z, 0, 4, 'polished_blackstone')
    s.set(2, 5, z, 'sea_lantern')
  }

  citiBikes(s.at(0, 0, 18, 'nologo/citibike'))
}

/*
 * The Citi Bike dock on the avenue, outside the walkup. Five bikes in the
 * rack, which is his two years of New York sitting on the kerb where you
 * cannot miss it -- and which is the thing that makes the sixth one, parked
 * on the subway platform two blocks of dirt below, read as a joke rather than
 * as a stray block.
 */
function citiBikes(d) {
  /* EVERY OTHER COLUMN. Five bikes on five consecutive blocks is not five
   * bikes, it is a blue wall with a black skirt -- which is exactly what the
   * first screenshot from the road showed. A block of air between them is the
   * whole difference between a rack and a kerb. */
  for (let i = 0; i <= 4; i++) bike(d.at(0, 0, i * 2, 'nologo/citibike/bike'))
  d.box([3, 0, 2], [3, 1, 9], 'polished_blackstone')        // the dock rail, clear of the door
}

/** One bike, side on: two black wheels, a blue frame, bars. Three blocks
 *  long, which is as small as a bike gets before it is just a blue block. */
function bike(b) {
  b.set(0, 0, 0, 'black_concrete')
  b.set(2, 0, 0, 'black_concrete')
  b.set(1, 0, 0, 'blue_concrete')
  b.set(1, 1, 0, 'blue_concrete')
  b.set(2, 1, 0, 'light_blue_concrete')
}

/* ---------------------------------------------------------------- shenzhen */

/*
 * SHENZHEN. Dense, modern, glass, and built tall on purpose: it is the half
 * of the plot that has to read from a long way down the road, and it is the
 * half that was still growing when the other half stopped.
 *
 * The office is pushed hard against the road so you meet it at eye level and
 * can walk straight in. The three towers stand behind it, so the skyline is
 * background and the door is foreground -- the other way round, which is what
 * the first sketch did, puts a thirty-four block tower two blocks from a
 * visitor's face and makes the whole stage unreadable from the pavement.
 */
function shenzhen(k) {
  k.rect([0, 0], [37, 10], -1, 'light_gray_concrete')       // the plaza
  k.rect([0, 5], [37, 5], -1, 'polished_andesite')          // its one banding course

  office(k.at(0, 0, 1, 'nologo/shenzhen/office'))

  tower(k.at(13, 0, 0, 'nologo/shenzhen/t1'), { w: 7, d: 7, h: 28, shell: 'white_concrete', pane: 'light_blue_stained_glass', lobby: true })
  tower(k.at(22, 0, 1, 'nologo/shenzhen/t2'), { w: 7, d: 7, h: 34, shell: 'light_gray_concrete', pane: 'cyan_stained_glass' })
  tower(k.at(31, 0, 0, 'nologo/shenzhen/t3'), { w: 5, d: 6, h: 22, shell: 'gray_concrete', pane: 'glass' })

  /* The skybridge, at floor seventeen, between the first two towers. One
   * block of gap gets a glass tube and a hole punched in each tower -- the
   * cheapest single detail that says "this is not America". */
  k.box([21, 16, 3], [21, 19, 5], 'glass')
  k.set(21, 16, 4, 'light_gray_concrete')                   // the deck you walk on
  k.box([21, 17, 4], [21, 18, 4], 'air')                    // ...and the passage through the glass
  k.box([20, 17, 4], [20, 18, 4], 'air')                    // a hole punched in each tower
  k.box([22, 17, 4], [22, 18, 4], 'air')

  // Planters and lamps down the plaza, so the ground between the towers is
  // somewhere rather than a surface.
  for (const x of [17, 25, 33]) {
    k.box([x, 0, 9], [x + 1, 0, 10], 'stone_bricks')
    k.set(x, 1, 9, 'oak_leaves')
    k.set(x + 1, 1, 10, 'oak_leaves')
  }
  for (const x of [12, 21, 30]) {
    k.pillar(x, 9, 0, 3, 'quartz_pillar')
    k.set(x, 4, 9, 'sea_lantern')
  }
}

/*
 * THE OFFICE THAT WENT FROM TWO TO TWENTY. Four storeys of glass; the ground
 * floor is the one that matters and the one you can walk into.
 *
 * Its west wall faces the road, so that is the wall that gets drawn rather
 * than assembled -- `pattern` listing the facade the way the facade looks.
 */
function office(o) {
  const W = 11, D = 8

  o.rect([0, 0], [W, D], -1, 'polished_andesite')           // the floor, in place of the grass
  o.hollow([0, 0, 0], [W, 4, D], { walls: 'white_concrete', ceiling: 'white_concrete' })

  /* The front, facing the road. Last row sits at y = 0, so the listing below
   * is a picture of the wall and not a description of one. */
  o.pattern({
    at: [0, 0, 0], plane: 'zy',
    legend: { '#': 'white_concrete', 'W': 'light_blue_stained_glass', '_': 'air' },
    rows: [
      '#########',
      '#WWWWWWW#',
      '#WWWWWWW#',
      '#WW#__#W#',
      '#WW#__#W#',
    ],
  })
  // Glass down the two long sides as well: a building with windows on one
  // face is a film set the moment you walk round the back of it.
  for (let x = 2; x <= W - 2; x += 3) {
    o.box([x, 2, 0], [x, 3, 0], 'light_blue_stained_glass')
    o.box([x, 2, D], [x, 3, D], 'light_blue_stained_glass')
  }

  twentyDesks(o)

  /*
   * Three more floors, each its own `hollow` with a curtain wall punched
   * through it, and a light left on behind a few of the panes. A tower with
   * every window dark reads as a model; a tower with three windows lit reads
   * as a building somebody is in.
   */
  for (const base of [5, 10, 15]) {
    o.hollow([0, base, 0], [W, base + 4, D], { walls: 'white_concrete', ceiling: 'white_concrete' })
    o.box([0, base + 1, 1], [0, base + 3, D - 1], 'light_blue_stained_glass')
    o.box([W, base + 1, 1], [W, base + 3, D - 1], 'light_blue_stained_glass')
    o.box([1, base + 1, 0], [W - 1, base + 3, 0], 'light_blue_stained_glass')
    o.box([1, base + 1, D], [W - 1, base + 3, D], 'light_blue_stained_glass')
    o.set(1, base + 2, 2, 'glowstone')
    o.set(W - 1, base + 2, D - 2, 'glowstone')
    o.set(4, base + 2, 1, 'glowstone')
  }

  // Roof: a parapet, the plant nobody designs and every building has, and a
  // light on the top so the thing has an outline at night.
  o.hollow([0, 20, 0], [W, 20, D], { walls: 'light_gray_concrete' })
  o.box([3, 20, 3], [5, 21, 5], 'iron_block')
  o.set(8, 20, 5, 'sea_lantern')
}

/*
 * TWENTY DESKS, in four rows of five, with aisles you can walk down between
 * them. Countable from the doorway, which is the whole requirement: two to
 * twenty is a fact about a room and belongs in a room.
 *
 * AND TWO OF THEM ARE WOODEN. The two nearest the door are plank desks with a
 * crate for a chair, while the other eighteen are white and identical. That
 * is the office before it was an office: two part-time contractors. Nothing
 * says so out loud; the two odd desks are simply still in the room.
 */
function twentyDesks(o) {
  /*
   * EVERYTHING ON THIS FLOOR IS ONE BLOCK HIGH, and that was a fix. The first
   * version stood a black monitor on every desk at y = 1, which is exactly
   * eye height: from the doorway the room was two black walls with a slot
   * down the middle and you could not count anything. Desktop and chair both
   * on the floor, and the twenty reads in one glance from the door.
   */
  for (const x of [2, 4, 6, 8, 10]) {
    for (const z of [1, 3, 5, 7]) {
      o.set(x, 0, z, 'quartz_block')                        // the desk
      o.set(x - 1, 0, z, 'black_concrete')                  // the chair pulled up to it
    }
  }
  for (const z of [3, 5]) {
    o.set(2, 0, z, 'planks')                                // the first two desks,
    o.set(1, 0, z, 'barrel')                                // and a crate for a chair
  }

  o.box([10, 1, 2], [10, 2, 6], 'white_concrete')           // the whiteboard, on the end wall
  o.set(10, 2, 4, 'black_concrete')

  // Ceiling grid, recessed into the slab, which reads as a fitting rather
  // than as a glowing rock somebody left on the floor.
  for (const x of [3, 7]) for (const z of [2, 6]) o.set(x, 4, z, 'glowstone')
  o.set(9, 4, 4, 'glowstone')
}

/*
 * A tower. Shell, a window band every third floor, a few lit panes, a
 * parapet and a light on the roof.
 *
 * NO `inside: 'air'`. The towers stand on flat ground, so the volume inside
 * one is already air and filling it would be thousands of writes that change
 * nothing and inflate the block count into a lie. `hollow` is used for its
 * walls, not for its carving.
 */
function tower(t, { w, d, h, shell, pane, lobby = false }) {
  t.rect([0, 0], [w, d], -1, 'gray_concrete')
  t.hollow([0, 0, 0], [w, h, d], { walls: shell, ceiling: shell })

  for (let y = 2; y <= h - 2; y += 3) {
    t.box([0, y, 1], [0, y, d - 1], pane)
    t.box([w, y, 1], [w, y, d - 1], pane)
    t.box([1, y, 0], [w - 1, y, 0], pane)
    t.box([1, y, d], [w - 1, y, d], pane)
    if (y % 2 === 0) {                                      // this floor is working late
      t.set(0, y, 2, 'glowstone')
      t.set(0, y, d - 2, 'glowstone')
      t.set(2, y, 0, 'glowstone')
    }
  }

  t.hollow([0, h + 1, 0], [w, h + 1, d], { walls: 'gray_concrete' })
  t.set(Math.floor(w / 2), h + 2, Math.floor(d / 2), 'sea_lantern')

  /*
   * The first tower gets a lobby, with a FLOOR OVER IT at level five. A door
   * into a shell is a door into a twenty-eight block chimney; capping it is
   * one rect and turns the same hole into a room.
   */
  if (lobby) {
    t.rect([1, 1], [w - 1, d - 1], -1, 'polished_andesite')
    t.rect([1, 1], [w - 1, d - 1], 5, 'light_gray_concrete')
    t.clear([0, 0, 3], [0, 2, 4])                           // the doors, facing the office
    t.set(3, 4, 2, 'glowstone')
    t.set(3, 4, 5, 'glowstone')
    t.set(5, 0, 2, 'barrel')
    t.box([2, 0, 5], [4, 0, 5], 'smooth_quartz')            // the reception desk
  }
}

/* --------------------------------------------------------------- the yard */

/*
 * THE YARD. Six blocks of open ground running due east off the road, which is
 * the one sightline in this stage and is kept clear on purpose: everything in
 * it is two, three or four blocks tall, so from the pavement you look straight
 * down it past the containers and the crane to the shed at the end.
 *
 * This is the part between the two cities, and it is freight, because freight
 * is what was actually between them and because a container identifies
 * nobody. Twelve of them, twelve plain colours, one per million of GMV.
 */
function yard(p) {
  p.rect([0, 0], [37, 5], -1, 'gray_concrete')
  p.rect([0, 2], [37, 2], -1, 'polished_andesite')          // the lane markings
  p.rect([0, 3], [37, 3], -1, 'polished_andesite')

  valuePlinth(p.at(1, 0, 0, 'nologo/yard/plinth'))

  /*
   * Twelve containers: four stacks of three, ALL ALONG THE NORTH SIDE.
   *
   * The first arrangement put them in two rows with a one-block aisle down
   * the middle, and the screenshot from inside the yard was a slot between
   * two four-block walls -- no yard, no sightline, and the writing on the
   * shed at the end of it invisible. Stacked higher and pushed to one side,
   * the same twelve blocks become a wall you read across and leave four
   * blocks of open ground to stand in.
   */
  const COLOURS = [
    'red_concrete', 'blue_concrete', 'orange_concrete', 'green_concrete',
    'yellow_concrete', 'cyan_concrete', 'purple_concrete', 'lime_concrete',
    'magenta_concrete', 'light_blue_concrete', 'brown_concrete', 'white_concrete',
  ]
  let n = 0
  for (const y of [0, 2, 4]) {
    for (const x of [6, 13, 20, 27]) container(p.at(x, y, 0, 'nologo/yard/box'), COLOURS[n++])
  }

  /*
   * The gantry crane over the east end. A portal frame, a beam, a trolley and
   * a spreader hanging off the boom -- twelve blocks tall, which is tall
   * enough to be the silhouette at the end of the sightline and short enough
   * not to argue with the towers behind it.
   */
  p.pillar(33, 0, 0, 11, 'yellow_concrete')
  p.pillar(33, 5, 0, 11, 'yellow_concrete')
  p.box([33, 12, 0], [33, 12, 5], 'yellow_concrete')
  p.box([29, 12, 2], [33, 12, 3], 'yellow_concrete')        // the boom, out over the stacks
  p.box([33, 11, 2], [33, 11, 3], 'iron_block')             // the trolley
  p.pillar(30, 2, 9, 11, 'iron_block')                      // the spreader, hanging
  p.set(33, 13, 0, 'sea_lantern')
  p.set(33, 13, 5, 'sea_lantern')

  for (const x of [10, 18, 26, 34]) {
    p.pillar(x, 5, 0, 3, 'polished_blackstone')
    p.set(x, 4, 5, 'sea_lantern')
  }
}

/** One container: five long, two wide, two high, with a grey door end and a
 *  latch bar, so it reads as a container and not as a coloured brick. */
function container(c, colour) {
  c.box([0, 0, 0], [4, 1, 1], colour)
  c.box([0, 0, 0], [0, 1, 1], 'gray_concrete')
  c.set(0, 1, 0, 'iron_block')
}

/*
 * TWELVE GOLD BLOCKS, four across and three up, set into a black plinth at
 * the mouth of the yard, directly under the lit GMV sign on the sidewalk
 * above. $12M, one per million, at eye level, close enough to the kerb to
 * count without stopping.
 *
 * It occupies four of the yard's six blocks of width and leaves the other two
 * open, because a monument that seals the only way in is a wall.
 */
function valuePlinth(v) {
  v.box([0, 0, 0], [1, 3, 3], 'polished_blackstone')
  for (let y = 1; y <= 3; y++) for (let z = 0; z <= 3; z++) v.set(0, y, z, 'gold_block')
  v.box([0, 4, 0], [1, 4, 3], 'polished_blackstone_brick_slab')
  v.set(0, 4, 1, 'sea_lantern')
  v.set(0, 4, 2, 'sea_lantern')
}

/* -------------------------------------------------------------- the shed */

/*
 * The terminal at the end of the yard: the thing the sightline lands on, and
 * the third interior on the plot. Wide doors facing back down the axis,
 * pallets and crates inside, and lit, because a black rectangle at the end of
 * a vista is a hole and a lit one is a building.
 *
 * It is a shed. It is not identified, it is not anybody's, and that is
 * deliberate -- see the header.
 */
function terminal(t) {
  const W = 10, D = 16, H = 19

  t.rect([-1, -1], [W, D + 1], -1, 'gray_concrete')
  t.hollow([0, 0, 0], [W, H, D], { walls: 'light_gray_concrete', ceiling: 'gray_concrete' })
  t.clear([0, 0, 3], [0, 5, 8])                             // the doors, square onto the yard
  t.box([0, 6, 2], [0, 6, 9], 'yellow_concrete')            // the lintel stripe over them

  theWriting(t)

  // A clerestory band right round, which is what a shed has instead of
  // windows and what stops seventeen blocks of blank wall.
  for (let z = 2; z <= D - 2; z += 3) t.box([W, H - 2, z], [W, H - 2, z], 'glass')
  for (let x = 2; x <= W - 2; x += 3) {
    t.box([x, H - 2, 0], [x, H - 2, 0], 'glass')
    t.box([x, H - 2, D], [x, H - 2, D], 'glass')
  }

  // Inside: racking down both walls, pallets on the floor, and the lights on.
  for (let z = 2; z <= D - 2; z += 2) {
    t.box([1, 0, z], [1, 1, z], 'barrel')
    t.box([W - 1, 0, z], [W - 1, 2, z], 'barrel')
  }
  for (const z of [5, 9, 13]) t.box([4, 0, z], [6, 0, z + 1], 'smooth_stone')
  for (const z of [3, 8, 13]) { t.set(3, H, z, 'glowstone'); t.set(7, H, z, 'glowstone') }
  for (const x of [3, 7]) { t.set(x, 4, 0, 'sea_lantern'); t.set(x, 4, D, 'sea_lantern') }
  for (const z of [4, 8, 12]) t.set(W, 4, z, 'sea_lantern')
  t.set(5, 0, 2, 'crafting_table')

  // The truck yard on the north apron: three trucks, nose in.
  for (const z of [-4, -6, -8]) {
    t.box([2, 0, z], [3, 1, z + 1], 'white_concrete')       // cab
    t.box([4, 0, z], [8, 2, z + 1], 'light_gray_concrete')  // box body
    t.set(2, 0, z, 'black_concrete')
    t.set(2, 0, z + 1, 'black_concrete')
  }
  t.rect([0, -8], [10, -1], -1, 'gray_concrete')
}

/*
 * 12M / GMV, in lit glass on the end wall of the shed, facing back down the
 * axis at the road.
 *
 * WHY IT IS FORTY BLOCKS AWAY AND NOT ON THE KERB. The first version hung
 * this over the sidewalk six blocks from the road, and the screenshot killed
 * it: an eleven-wide sign six blocks from your face is not a sign, it is a
 * ceiling. You cannot read a word you are standing underneath. The only
 * unobstructed west-facing sightline on this plot is the yard itself, and it
 * runs the full forty blocks to this wall -- so the writing goes at the far
 * end of it, where a visitor on the road sees it framed by the two cities and
 * a visitor who walks twenty blocks in sees the whole of it.
 *
 * THE WORD IS GMV AND NOT REVENUE. His record draws that distinction
 * explicitly, so the build draws it too; the twelve gold blocks in the plinth
 * at the other end of this same axis are the twelve millions, one each.
 */
function theWriting(t) {
  const LETTERS = {
    legend: { '#': 'glowstone', '.': 'light_gray_concrete' },
  }
  /*
   * BOTH WORDS ARE REVERSED AT THE LAST MOMENT, and the drawings below are
   * written the right way round on purpose so that the source still reads as
   * the thing it builds.
   *
   * Babylon is left-handed. On a `zy` wall the characters of a row run in +z,
   * and this wall is read facing EAST -- the whole point of it is that it
   * closes the forty-block axis that starts at the road, so every visitor who
   * can see it at all is west of it looking east. Facing east, +z is on the
   * reader's LEFT, so the unreversed version rendered `M21` over `VMG`.
   *
   * See the mirroring note in docs/builds/README.md. The same handedness is
   * why the address plate on the walkup needs the same treatment and why
   * nothing else on this plot does: colour and shape are immune, words are
   * not, and this stage only has two of them.
   */
  const mirror = (rows) => rows.map(r => [...r].reverse().join(''))
  t.pattern({
    at: [0, 14, 1], plane: 'zy', ...LETTERS,
    rows: mirror([                                          // 1 2 M
      '.#..###.#.#',
      '##....#.###',
      '.#..###.###',
      '.#..#...#.#',
      '###.###.#.#',
    ]),
  })
  t.pattern({
    at: [0, 8, 1], plane: 'zy', ...LETTERS,
    rows: mirror([                                          // G M V
      '###.#.#.#.#',
      '#...###.#.#',
      '#.#.###.#.#',
      '#.#.#.#.#.#',
      '###.#.#..#.',
    ]),
  })
}

/* -------------------------------------------------------------- new york */

/*
 * NEW YORK. A brownstone terrace on the corner with a side street running
 * east out of it, a row of storefronts facing back across the street, a
 * pocket park at the far end, and a subway underneath.
 *
 * The terrace is the right way round: the buildings' long sides face the side
 * street, and the ONE wall that faces the road is the west end of the corner
 * walkup -- which is therefore the wall that gets the address plate, the door
 * and the stoop. Everything a visitor on the pavement can see is on that one
 * wall, and it is eight blocks wide.
 */
function newYork(n) {
  n.rect([0, 0], [37, 10], -1, 'light_gray_concrete')
  n.rect([0, 6], [30, 7], -1, 'black_concrete')             // the side street
  n.rect([0, 8], [30, 8], -1, 'light_gray_concrete')
  for (let x = 1; x <= 29; x += 4) n.set(x, -1, 7, 'yellow_concrete')   // the lane dashes

  walkup(n.at(0, 0, 0, 'nologo/newyork/2'))
  brownstone(n.at(8, 0, 0, 'nologo/newyork/a'), { w: 5, h: 12, face: 'bricks', trim: 'polished_blackstone' })
  brownstone(n.at(14, 0, 0, 'nologo/newyork/b'), { w: 5, h: 10, face: 'brown_terracotta', trim: 'polished_andesite' })
  brownstone(n.at(20, 0, 0, 'nologo/newyork/c'), { w: 5, h: 13, face: 'red_terracotta', trim: 'polished_blackstone' })

  storefronts(n.at(0, 0, 9, 'nologo/newyork/shops'))
  park(n.at(26, 0, 0, 'nologo/newyork/park'))

  // Street trees in their pits, down the sidewalk on the terrace side.
  for (const x of [6, 13, 19, 25]) {
    n.set(x, -1, 5, 'coarse_dirt')
    streetTree(n.at(x, 0, 5, 'nologo/newyork/tree'))
  }
}

/*
 * NUMBER 2. The corner walkup: the New York office, two storeys, with the
 * address over the door in lit glass on the wall that faces the road.
 *
 * TWO IS THE NUMBER TWICE. It is the door number and it is his employee
 * number, and the build does not explain the pun because a build that
 * explains a pun has not made one.
 */
function walkup(u) {
  const W = 7, D = 4

  u.rect([0, 0], [W, D], -1, 'spruce_planks')               // floorboards, at ground level
  u.hollow([0, 0, 0], [W, 4, D], { walls: 'brown_terracotta', ceiling: 'spruce_planks' })
  u.hollow([0, 4, 0], [W, 9, D], { walls: 'brown_terracotta', ceiling: 'stone_bricks' })
  u.hollow([0, 0, 0], [W, 0, D], { walls: 'polished_blackstone' })   // the stone base course
  u.hollow([0, 10, 0], [W, 11, D], { walls: 'polished_blackstone' }) // the parapet

  /* The door onto the avenue. NO RAISED STOOP: the floorboards inside are at
   * y = -1 like the pavement outside, so a stoop block in front of the door is
   * not a step up, it is a block in the doorway. Caught by slicing the plot in
   * node and reading the column the door is in. */
  u.clear([0, 0, 2], [0, 2, 2])
  u.box([-1, -1, 1], [-1, -1, 3], 'smooth_stone')           // the stoop, paved flush -- see below

  /*
   * The address plate: a black panel let into the west wall of the upper
   * storey with a lit 2 on it. Three wide by five tall, which is the whole
   * depth of the building's west face, and the only text a visitor on the
   * road can read from this half of the plot.
   */
  u.box([0, 5, 1], [0, 9, 3], 'polished_blackstone')
  /* REVERSED, for the same left-handed reason as 12M / GMV on the shed --
   * see theWriting(). This plate is on a WEST-facing wall read from the road,
   * so the reader is facing east and the characters of a `zy` row run away to
   * their left. Drawn the way it reads and reversed at the stamp, because
   * un-reversed the 2 rendered as a 5, which is a different employee number
   * and the only number on this half of the plot. */
  u.pattern({
    at: [0, 5, 1], plane: 'zy',
    legend: { '#': 'glowstone', '.': 'polished_blackstone' },
    rows: [
      '###',
      '..#',
      '###',
      '#..',
      '###',
    ].map(r => [...r].reverse().join('')),
  })

  // Windows: south onto the side street, north onto the yard.
  for (const x of [2, 5]) {
    u.box([x, 2, D], [x, 3, D], 'glass')
    u.box([x, 6, D], [x, 7, D], 'glass')
    u.box([x, 2, 0], [x, 3, 0], 'glass')
  }
  u.box([0, 2, 1], [0, 3, 1], 'glass')

  packedUp(u)
  walkupStairs(u)
  roofDeck(u)
}

/*
 * THE GROUND FLOOR, PACKED. Two desks, and this is the room where employee
 * number two sat, so there are exactly two of them and they are bare -- no
 * monitors, unlike the twenty in Shenzhen, because the monitors are in the
 * boxes. Four sealed crates by the door, three chairs stacked in the corner,
 * one light left on and the door standing open.
 *
 * This is the wind-down and it is not softened. The company wound down US
 * operations and he left; his record says so plainly and a build that
 * pretended otherwise would be the one dishonest thing on the plot. It reads
 * without a word of explanation, which is the only reason a room can carry
 * something like this at all.
 */
function packedUp(u) {
  u.set(2, 0, 2, 'smooth_quartz')                           // his desk
  u.set(4, 0, 2, 'smooth_quartz')                           // the other one
  u.box([5, 0, 1], [6, 0, 1], 'barrel')                     // the sealed boxes,
  u.box([5, 1, 1], [6, 1, 1], 'barrel')                     // stacked by the door
  u.box([6, 0, 3], [6, 2, 3], 'black_concrete')             // three chairs, stacked
  u.set(1, 0, 3, 'bookshelf')
  /* LIT, and that is not a softening. Nobody packs an office in the dark:
   * what carries the wind-down is the bare desks, the sealed crates and the
   * open door, not a dim room -- and a dark interior in this engine now reads
   * as one somebody forgot to finish. */
  u.set(3, 4, 2, 'glowstone')
  u.set(1, 4, 1, 'glowstone')
  u.set(5, 4, 3, 'glowstone')
}

/*
 * Two flights, in full blocks rather than stair blocks -- a stair block
 * carries its facing in the key and picking the wrong one of eight builds a
 * staircase you cannot climb, which is a worse bug than a blocky one and one
 * you only find by walking it.
 *
 * The first flight lands on the upper floor through a hole in the ceiling;
 * the second goes out through a hatch in the roof. Both holes are cut where
 * the flight arrives and nowhere else, which is the part that was wrong the
 * first time: a step whose head is in a slab is a step you cannot stand on.
 */
function walkupStairs(u) {
  for (let i = 0; i <= 3; i++) u.box([1 + i, 0, 1], [1 + i, i, 1], 'spruce_planks')
  u.clear([4, 4, 1], [4, 4, 1])                            // headroom over the top tread, and no more

  for (let i = 0; i <= 3; i++) u.box([1 + i, 5, 3], [1 + i, 5 + i, 3], 'spruce_planks')
  u.clear([4, 9, 3], [4, 9, 3])                            // the roof hatch

  // Upstairs is nearly empty, which is the same fact told twice.
  u.set(6, 5, 1, 'barrel')
  u.set(2, 9, 2, 'glowstone')
}

/*
 * EASTER EGG, ON TOP. The roof: a water tower on timber legs, which is the
 * single most New York object there is, and one chair beside it facing EAST.
 * Shenzhen is due east of this roof and thirty blocks away, and from the
 * chair you are looking straight at it over the yard.
 *
 * You get here by climbing two flights and going out through the hatch.
 * Nothing on the street says the roof is reachable.
 */
function roofDeck(u) {
  for (const [x, z] of [[1, 1], [3, 1], [1, 3], [3, 3]]) u.pillar(x, z, 10, 11, 'dark_oak_wood')
  u.hollow([1, 12, 1], [3, 15, 3], { walls: 'spruce_planks', floor: 'spruce_planks', ceiling: 'dark_oak_wood' })
  u.set(2, 16, 2, 'dark_oak_wood')

  u.set(6, 10, 2, 'spruce_slab')                            // the chair, seat
  u.box([5, 10, 2], [5, 11, 2], 'spruce_planks')            // ...and its back, so it faces east
  u.set(6, 10, 1, 'sea_lantern')
}

/*
 * A brownstone. One function, three houses, three colours -- which is what a
 * terrace is, and what `at()` is for: each of them is written at its own
 * front-left corner and moves by editing one number.
 *
 * The front faces SOUTH onto the side street, so the facade goes in on the
 * 'xy' plane with its last row at y = 0, and the listing reads as the wall.
 */
function brownstone(b, { w, h, face, trim }) {
  const D = 4

  b.rect([0, 0], [w, D], -1, 'spruce_planks')
  b.hollow([0, 0, 0], [w, h - 1, D], { walls: face, ceiling: 'stone_bricks' })
  b.hollow([0, 0, 0], [w, 0, D], { walls: trim })           // the base course: a ring, not a box
  b.hollow([0, h, 0], [w, h, D], { walls: trim })           // and the cornice

  // Windows up the street front, two per floor, every fourth course -- which
  // is the rhythm that makes a row of boxes read as a row of houses.
  for (let y = 2; y + 1 < h; y += 4) {
    for (const x of [1, w - 1]) b.box([x, y, D], [x, y + 1, D], 'glass')
    b.set(2, y, D, 'glowstone')                             // somebody is in
  }
  for (let y = 2; y + 1 < h; y += 4) {
    for (const x of [1, w - 1]) b.box([x, y, 0], [x, y + 1, 0], 'glass')
  }

  // The front door, up two steps off the street.
  b.clear([3, 0, D], [3, 2, D])
  b.set(3, -1, D + 1, 'smooth_stone')
  b.box([2, 3, D], [4, 3, D], trim)                         // the lintel over it

  // Downstairs, furnished: a table, a shelf, a hearth and a light. Small, but
  // the difference between a house and a box with a door in it.
  b.set(1, 0, 1, 'crafting_table')
  b.set(w - 1, 0, 1, 'bookshelf')
  b.box([w - 1, 0, 3], [w - 1, 2, 3], 'bricks')
  b.set(w - 1, 1, 3, 'magma_block')                         // the fire, lit
  b.set(2, 3, 2, 'glowstone')

  // The water tank on the roof, which every one of these has.
  b.pillar(w - 2, 2, h + 1, h + 2, 'dark_oak_wood')
  b.box([w - 3, h + 3, 1], [w - 1, h + 4, 3], 'spruce_planks')
}

/*
 * The other side of the street: a run of storefronts, two deep, with awnings
 * and lit windows. Deliberately SOLID -- two blocks of depth cannot hold a
 * room, and a door onto a room that does not exist is worse than a wall that
 * never claimed to have one. What it is for is enclosure: a street with
 * buildings on one side is a driveway.
 */
function storefronts(f) {
  const heights = [6, 8, 5, 7, 6, 9, 5, 7]
  heights.forEach((h, i) => {
    const x0 = i * 3, x1 = x0 + 2
    const skin = ['bricks', 'brown_terracotta', 'red_terracotta', 'gray_concrete'][i % 4]
    f.box([x0, 0, 0], [x1, h, 1], skin)
    f.box([x0, h + 1, 0], [x1, h + 1, 1], 'polished_blackstone')
    f.box([x0, 1, 0], [x1, 2, 0], 'glass')                  // the shopfront
    f.set(x0 + 1, 1, 0, 'glowstone')                        // lit, as shops are
    f.box([x0, 3, 0], [x1, 3, 0], ['green_concrete', 'red_concrete', 'blue_concrete'][i % 3])  // the awning
    for (let y = 5; y < h; y += 3) f.box([x0 + 1, y, 0], [x0 + 1, y + 1, 0], 'glass')
  })
}

/** A street tree in its pit: three of trunk and a small crown, kept small so
 *  it does not eat the facade behind it. */
function streetTree(t) {
  t.pillar(0, 0, 0, 3, 'oak_log')
  t.box([-1, 4, 0], [1, 4, 1], 'oak_leaves')
  t.box([0, 5, 0], [0, 5, 1], 'oak_leaves')
}

/*
 * The pocket park at the east end of the block: grass, a path, four trees and
 * two benches. It is the back of the plot and therefore background, and a
 * park is the cheapest honest thing to put behind a terrace.
 */
function park(g) {
  g.rect([0, 0], [11, 10], -1, 'grass')
  g.rect([0, 4], [11, 4], -1, 'polished_andesite')
  g.rect([5, 0], [6, 10], -1, 'polished_andesite')
  for (const [x, z] of [[2, 2], [9, 2], [2, 8], [9, 7]]) streetTree(g.at(x, 0, z, 'nologo/park/tree'))
  for (const z of [3, 5]) g.box([3, 0, z], [4, 0, z], 'spruce_slab')
  g.pillar(6, 4, 0, 3, 'polished_blackstone')
  g.set(6, 4, 4, 'sea_lantern')
}

/* ---------------------------------------------------------------- subway */

/*
 * EASTER EGG, UNDER. The subway, beneath the side street.
 *
 * THE VERTICAL BUDGET IS FOUR BLOCKS AND IT IS THE ENTIRE DESIGN. Classic
 * Flat: grass at y = -1, dirt at -2 and -3, bedrock at -4. So the platform
 * floor replaces the bedrock at -4, the room is the two blocks above it, and
 * the street itself is the ceiling.
 *
 * There is no room for a staircase in the usual sense, so the stair is three
 * columns deep and drops one block each: a step at -2, a step at -3, then the
 * floor at -4. Each one has its headroom carved out above it, which is the
 * part a plan view cannot show you and the part you find by walking it. It
 * goes back up the same way, one block at a time.
 */
function subway(t) {
  const X0 = 6, X1 = 24

  // The room: floor over the bedrock, two blocks of air, tiled walls.
  t.rect([X0 - 3, 5], [X1, 9], -4, 'polished_andesite')
  t.box([X0 - 3, -3, 5], [X1, -2, 9], 'air')
  t.box([X0 - 3, -3, 5], [X1, -2, 5], 'white_concrete')     // the tiled walls
  t.box([X0 - 3, -3, 9], [X1, -2, 9], 'white_concrete')
  t.box([X1, -3, 5], [X1, -2, 9], 'stone_bricks')           // the end of the platform
  t.rect([X0 - 3, 6], [X1 - 1, 6], -4, 'smooth_stone')      // the platform proper
  t.rect([X0 - 3, 7], [X1 - 1, 7], -4, 'yellow_concrete')   // and its edge stripe

  // The track bed at the far side, with rails on it, running east into the
  // dark. It stops at the wall because a tunnel that goes nowhere is honest
  // and a tunnel that goes off the plot is a hole in somebody else's stage.
  t.rect([X0 - 3, 8], [X1 - 1, 8], -4, 'gravel')
  for (let x = X0 - 3; x <= X1 - 1; x += 2) t.set(x, -4, 8, 'iron_block')

  /*
   * The stairs down, in the middle of the side street. Three columns, one
   * block each, with the headroom above every tread carved out.
   */
  t.box([X0 - 3, -1, 6], [X0 - 1, -1, 6], 'air')            // the hole in the street
  t.set(X0 - 3, -2, 6, 'smooth_stone')
  t.set(X0 - 2, -3, 6, 'smooth_stone')
  t.box([X0 - 3, -2, 7], [X0 - 1, -1, 7], 'polished_blackstone')  // the handrail wall
  t.box([X0 - 3, -2, 5], [X0 - 1, -1, 5], 'polished_blackstone')
  t.box([X0 - 4, 0, 6], [X0 - 4, 1, 6], 'polished_blackstone')    // the kiosk rail at street level
  t.set(X0 - 4, 2, 6, 'sea_lantern')

  // Lit, along the platform wall, because an unlit cellar in this engine now
  // reads as an unfinished one.
  for (let x = X0; x <= X1 - 2; x += 4) {
    t.set(x, -2, 5, 'sea_lantern')
    t.set(x + 2, -2, 9, 'glowstone')
  }

  /*
   * And the sixth Citi Bike, parked at the far end of the platform where no
   * bike is allowed to be. Five are in the dock up on the avenue; this one
   * came down the stairs.
   */
  bike(t.at(X1 - 3, -3, 6, 'nologo/subway/bike'))
}
