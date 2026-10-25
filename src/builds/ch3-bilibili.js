/*
 * CHAPTER 3: BILIBILI.
 *
 * ------------------------------------------------------------------------
 * WHAT THE REPO SAYS, which is all this build is allowed to know:
 *
 *   - Content Creator, Bilibili, March 2025 to present. "Create educational
 *     videos about American culture on Bilibili, China's cultural equivalent
 *     to YouTube." "Scaled from 0 to 10,000 followers in 13 days and reached
 *     100,000 followers in 72 days." The section heading says 280k
 *     followers. -- public/EvanJolley_Resume.pdf
 *   - The count is given as 280k everywhere, on Evan's instruction
 *     (2026-10-25), though the corpus records a live 282,162. The channel is
 *     largely in Mandarin, for a Chinese audience: conversations with his
 *     grandfather about the Army and motorcycle clubs, Midwest life, and a
 *     video about being a small-town kid who got to Harvard.
 *     -- docs/ai-evan/03-corpus.md, "Bilibili -- right medium, wrong
 *     subject, wrong language"
 *   - "dont use cherry blossom for china, too on the nose" -- the owner, in
 *     src/builds/biomes.js. Read as a rule about this whole plot: no pagoda,
 *     no lanterns, no red gate. The subject is the CHANNEL, so the building
 *     is the platform's own icon -- a television with two antennae and two
 *     eyes -- and the inside of it is the studio.
 *
 * The grandfather is in the corpus as the subject of videos. He is not
 * named here and is not drawn; the set has two chairs facing each other and
 * a motorcycle beside them, which is the conversation, not the man.
 * ------------------------------------------------------------------------
 * WHAT IS HERE.
 *
 *   THE TV          the Bilibili icon at building scale, 32 wide and 22
 *                   tall, its screen facing the path. Walk in through the
 *                   bottom of the screen.
 *   THE STUDIO      inside it: an interview set with two chairs and a
 *                   motorcycle, an American flag, hay bales for the Midwest,
 *                   a camera with a ring light, and an edit desk. The walls
 *                   are covered in danmaku -- the comments that fly across a
 *                   Bilibili video -- as coloured streaks.
 *   THE CHART       out of the back door: the follower count as a thing you
 *                   climb. One block of height is 10,000 followers; one
 *                   block along is two days. Day 13 is one block tall, day 72
 *                   is ten, and today is a tower twenty-eight blocks tall
 *                   with a stair round it -- 280,000, countable.
 *
 * THE EASTER EGGS:
 *
 *   BEHIND  the set is a wall one block thick with a gap behind it, as
 *           every set is. Back there, thirteen lights set in the floor:
 *           thirteen days to the first ten thousand.
 *   ON TOP  the top of the today tower, which is the only place the whole
 *           chart and the TV are in one view.
 *   ON TOP  the TV's own roof, between the antennae: a play button laid
 *           flat, in pink, which only the top of the tower can see.
 * ------------------------------------------------------------------------
 * ORIENTATION. 70 x 64, x 0..69 and z 0..63. This plot is LEFT of the walk,
 * so the path is on the HIGH-x edge and the spur arrives at local (69, 6).
 * Everything that has to read from the path faces +x.
 *
 * A visitor facing the TV faces -x, and facing -x in this engine +z is on
 * their RIGHT (Babylon is left-handed; see the README's mirrored-text
 * warning). So on the TV's face and on the studio's back wall, `u` counted
 * from the viewer's left is plain +z, and nothing is reversed. The chart is
 * read facing -z, where +x is on the viewer's LEFT, so time runs toward -x.
 * The only words here are the chapter marker chapters.js draws; see signs().
 */
import { BAMBOO } from './biomes.js'

export const SIZE = { w: 70, d: 64 }

const P = {
  blue: 'light_blue_concrete',      // Bilibili blue
  pink: 'pink_concrete',            // Bilibili pink
  screen: 'white_concrete',
  body: 'light_blue_concrete',
  shell: 'white_concrete',
  floor: 'smooth_quartz',
  light: 'glowstone',
  lamp: 'sea_lantern',
  paving: 'light_gray_concrete',
  post: 'polished_blackstone',
}

/* THE TV. Front face at x = TV.x1, body back to TV.x0. */
const TV = { x0: 46, x1: 62, z0: 8, z1: 39, top: 21 }
const R = 4                               // corner radius on the face
const MOUTH = [22, 25]                    // the door, in z

export function build(s) {
  ground(s)
  tv(s)
  studio(s)
  chart(s)
  bamboo(s)
  signs(s)
}

/* ====================================================================== */

function ground(s) {
  // Survey posts out along the edges this build uses.
  for (let z = 4; z <= 63; z++) { s.clear([69, 0, z], [69, 1, z]); s.clear([0, 0, z], [0, 1, z]) }
  for (let x = 0; x <= 69; x++) s.clear([x, 0, 63], [x, 1, 63])
  for (let x = 0; x <= 36; x++) s.clear([x, 0, 0], [x, 1, 0])

  /* The forecourt along the screen, and the walk in from the spur at
   * (69, 6): one paved strip, a pink kerb on the path side. */
  s.rect([63, 5], [69, 41], -1, P.paving)
  s.rect([66, 8], [66, 41], -1, P.pink)
  // Round the south end of the TV to the chart.
  s.rect([44, 40], [68, 44], -1, P.paving)
}

/** Is local (z, y) on the TV's face inside its rounded outline? */
function inFace(z, y) {
  const { z0, z1, top } = TV
  const y0 = 0
  const cz = z < z0 + R ? z0 + R : z > z1 - R ? z1 - R : z
  const cy = y < y0 + R ? y0 + R : y > top - R ? top - R : y
  if (z < z0 || z > z1 || y < y0 || y > top) return false
  return Math.hypot(z - cz, y - cy) <= R + 0.3
}

function tv(s) {
  const { x0, x1, z0, z1, top } = TV
  /* The body: a rounded box in profile, extruded back from the face. The
   * outer shell is Bilibili blue; the inside is carved out below. */
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      for (let y = 0; y <= top; y++) if (inFace(z, y)) s.set(x, y, z, P.body)
    }
  }
  s.rect([x0, z0], [x1, z1], -1, P.floor)

  /* THE FACE. A rim three blocks wide in blue, a white screen recessed one
   * block behind it, and two eyes. In the icon (tabler's brand-bilibili,
   * a 24-unit grid) the box is 18 x 14 units, the eyes are vertical strokes
   * at 6 and 12 units across and 5 to 7 units down, and the antennae lean
   * in from 5 and 13 units across. Scaled to 32 x 22. */
  const RIM = 3
  for (let z = z0; z <= z1; z++) {
    for (let y = 0; y <= top; y++) {
      if (!inFace(z, y)) continue
      const inner = z >= z0 + RIM && z <= z1 - RIM && y >= RIM && y <= top - RIM
      if (inner) { s.set(x1, y, z, 'air'); s.set(x1 - 1, y, z, P.screen) }
    }
  }
  const u = (n) => z0 + n                              // viewer's left -> right
  // The eyes: two strokes, two wide and four tall, in blue.
  for (const e of [10, 20]) s.box([x1 - 1, 10, u(e)], [x1 - 1, 13, u(e + 1)], P.blue)
  /* A lit bezel round the screen, one block inside the rim, so the screen
   * is a lit surface at night rather than a dark rectangle -- the first
   * night screenshot had the whole face go black above the forecourt lamps. */
  for (let z = z0 + RIM; z <= z1 - RIM; z++) {
    for (let y = RIM; y <= top - RIM; y++) {
      const edge = z === z0 + RIM || z === z1 - RIM || y === RIM || y === top - RIM
      if (edge && inFace(z, y)) s.set(x1 - 1, y, z, P.lamp)
    }
  }

  /* THE ANTENNAE, leaning inward as they rise off the top, two thick, with
   * a light on each tip. */
  /* They stand at the FRONT of the roof, not the middle: the first
   * screenshot had them eight blocks back, where the TV's own top edge hid
   * them from anybody standing in front of it. */
  for (const [base, dir] of [[9, -1], [22, 1]]) {
    for (let i = 0; i < 8; i++) {
      const z = u(base + dir * Math.floor(i / 2))
      for (const x of [x1 - 3, x1 - 2]) s.set(x, top + 1 + i, z, P.body)
    }
    for (const x of [x1 - 3, x1 - 2]) s.set(x, top + 9, u(base + dir * 4), P.lamp)
  }

  // THE MOUTH: the way in, through the bottom of the screen and the rim.
  s.clear([x1 - 1, 0, MOUTH[0]], [x1, 4, MOUTH[1]])
  s.box([x1, 5, MOUTH[0] - 1], [x1, 5, MOUTH[1] + 1], P.pink)

  /* Feet lights: a row of lanterns in the forecourt floor along the face,
   * so the screen is lit at night by the ground in front of it. */
  for (let z = z0 + 2; z <= z1 - 2; z += 3) s.set(x1 + 1, -1, z, P.lamp)
  for (let z = z0; z <= z1; z += 5) { s.pillar(68, z, 0, 2, P.post); s.set(68, 3, z, P.lamp) }
}

/* ====================================================================== *
 * THE STUDIO, inside the TV.
 * ====================================================================== */

function studio(s) {
  const { x0, x1, z0, z1, top } = TV
  /* Carve the inside, leaving a shell TWO blocks thick: the outer one is
   * the blue body, the inner one is the white lining, so the danmaku reads
   * against white inside and the TV stays blue outside. */
  const deep = (z, y) => inFace(z, y) && inFace(z - 2, y) && inFace(z + 2, y) && inFace(z, y + 2)
  const lining = (z, y) => inFace(z, y) && inFace(z - 1, y) && inFace(z + 1, y) && inFace(z, y + 1)
  for (let x = x0 + 1; x <= x1 - 2; x++) {
    for (let z = z0 + 1; z <= z1 - 1; z++) {
      for (let y = 0; y <= top - 1; y++) {
        if (deep(z, y) && x >= x0 + 2) s.set(x, y, z, 'air')
        else if (lining(z, y)) s.set(x, y, z, P.shell)
      }
    }
  }

  // Ceiling lights, and wall lights over the eyeline.
  for (let x = x0 + 2; x <= x1 - 3; x += 4) for (let z = z0 + 4; z <= z1 - 4; z += 4) s.set(x, top - 1, z, P.light)
  for (let x = x0 + 3; x <= x1 - 3; x += 4) { s.set(x, 7, z0 + 1, P.lamp); s.set(x, 7, z1 - 1, P.lamp) }

  /*
   * DANMAKU: the comments that scroll across a Bilibili video, as coloured
   * streaks of three to seven blocks running along both side walls, high
   * up, the way they run across the top of a frame.
   */
  const colours = ['pink_concrete', 'light_blue_concrete', 'yellow_concrete', 'lime_concrete', 'orange_concrete', 'magenta_concrete', 'cyan_concrete']
  let n = 0
  for (const z of [z0 + 1, z1 - 1]) {
    for (let y = 9; y <= top - 4; y += 2) {
      let x = x0 + 2 + ((y * 7 + z) % 4)
      while (x < x1 - 3) {
        const len = 3 + ((x * 5 + y * 3 + z) % 5)
        const end = Math.min(x + len - 1, x1 - 3)
        s.line([x, y, z], [end, y, z], colours[n++ % colours.length])
        x = end + 2 + ((x + y) % 3)
      }
    }
  }

  /* THE LIGHTING GRID. The ceiling is twenty blocks up and light falls a
   * level a block, so a ceiling lamp leaves the floor dark -- which is what
   * the first screenshot of the set showed. A studio hangs its lights from a
   * grid over the set, so this one does too. */
  for (const z of [z0 + 6, z0 + 15, z0 + 24]) {
    s.line([x0 + 6, 9, z], [x1 - 2, 9, z], 'black_concrete')
    for (let x = x0 + 7; x <= x1 - 2; x += 3) s.set(x, 8, z, P.lamp)
  }

  set(s)
  editDesk(s)
}

/** The interview set against the back wall, and what is behind it. */
function set(s) {
  const { x0, z0 } = TV
  const sx = x0 + 4                                     // the set wall, x = 50
  const sz0 = 14, sz1 = 33
  /* THE SET WALL: one block thick, standing two in front of the TV's back,
   * so there is a gap behind it -- see the easter egg. Dark, so the flag on
   * it carries. */
  s.box([sx, 0, sz0], [sx, 11, sz1], 'gray_concrete')

  /* THE FLAG, 13 x 7, on the face of the set wall. Read facing -x, where
   * +z is to the viewer's right, so the canton (top LEFT) is at low z. */
  const fz = 17, fy = 3
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 13; c++) {
      const y = fy + 6 - r
      const canton = c < 6 && r < 4
      const key = canton ? ((r + c) % 2 ? 'blue_concrete' : 'white_concrete') : (r % 2 ? 'white_concrete' : 'red_concrete')
      s.set(sx + 1, y, fz + c, key)
    }
  }
  // Lit from the set's own top edge.
  for (let z = sz0; z <= sz1; z += 3) s.set(sx, 12, z, P.light)

  /* THE CONVERSATION: two armchairs facing each other across a low table,
   * and the motorcycle parked beside them. */
  for (const [z, back] of [[20, 19], [26, 27]]) {
    s.set(sx + 4, 0, z, 'brown_wool')
    s.set(sx + 4, 1, back, 'brown_wool')
    s.set(sx + 4, 0, back, 'brown_wool')
  }
  s.set(sx + 4, 0, 23, 'spruce_slab')
  // The motorcycle, along z: two wheels, a frame, a tank, a seat, bars.
  const mx = sx + 5
  s.set(mx, 0, 29, 'black_concrete'); s.set(mx, 0, 33, 'black_concrete')        // wheels
  s.line([mx, 1, 29], [mx, 1, 33], 'iron_block')                                  // frame
  s.set(mx, 2, 31, 'red_concrete')                                                // tank
  s.set(mx, 2, 32, 'black_wool')                                                  // seat
  s.set(mx, 2, 30, 'iron_block'); s.set(mx, 3, 30, 'black_concrete')              // bars
  // Hay bales: the Midwest, stacked at the north end of the set.
  for (const [z, y] of [[15, 0], [16, 0], [15, 1], [17, 0]]) s.set(sx + 2, y, z, 'hay_block')

  /* THE CAMERA, on a tripod, facing the set, inside a ring light. */
  /* Off the door axis (z 22..25), or the ring light stands in the mouth and
   * is the only thing you see from the forecourt. */
  const cx = sx + 9, cz = 31
  s.pillar(cx, cz, 0, 1, P.post)
  s.set(cx, 2, cz, 'black_concrete')
  s.set(cx - 1, 2, cz, 'gray_stained_glass')
  for (const [dz, dy] of [[-2, 0], [2, 0], [0, 2], [-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    s.set(cx + 1, 2 + dy, cz + dz, P.lamp)
  }

  /* BEHIND THE SET. The gap between the set wall and the TV's back is two
   * blocks wide, reached round either end. In its floor, thirteen lights:
   * 0 to 10,000 followers in 13 days. */
  for (let i = 0; i < 13; i++) s.set(x0 + 2 + (i % 2), -1, sz0 + 3 + i, P.lamp)
  s.set(x0 + 2, 0, sz1 - 1, 'barrel')
  // And a back door into the gap, from the bamboo path behind the TV.
  s.clear([x0, 0, 24], [x0 + 1, 2, 25])
}

/** The edit desk in the north-east corner, by the screen. */
function editDesk(s) {
  const x = 58, z = 12
  s.box([x - 2, 0, z], [x + 1, 0, z], 'spruce_planks')
  s.set(x - 1, 1, z - 1, 'black_concrete'); s.set(x, 1, z - 1, 'black_concrete')     // two monitors
  s.set(x - 1, 2, z - 1, 'light_blue_concrete'); s.set(x, 2, z - 1, 'pink_concrete')
  s.set(x - 1, 0, z + 1, 'red_wool')                                                 // the chair
  s.set(x + 2, 2, z - 1, P.lamp)

}

/* ====================================================================== *
 * THE CHART: the follower count as a climb.
 *
 * x is time, running toward -x so a viewer facing north reads it left to
 * right: DAY0 at x = 62, two days a block, day 72 at x = 26. y is
 * followers, 10,000 a block. Only the three numbers the resume gives are
 * built as data -- day 13, day 72, and the count now. The stair between
 * them is how you walk the chart, not a claim about the curve.
 * ====================================================================== */

const AXIS_Z = 52
const DAY0 = 62
const dayX = (d) => DAY0 - Math.round(d / 2)

function chart(s) {
  // The time axis: a paved strip with a dark tick every ten days.
  s.rect([4, AXIS_Z - 2], [DAY0 + 1, AXIS_Z + 2], -1, P.paving)
  for (let d = 0; d <= 72; d += 10) s.set(dayX(d), -1, AXIS_Z + 2, 'gray_concrete')
  // The follower axis at day 0: a white pole, gold every 100k, pink at 280k.
  for (let y = 0; y <= 27; y++) {
    s.set(DAY0 + 1, y, AXIS_Z, y === 9 || y === 19 ? 'gold_block' : y === 27 ? P.pink : 'white_concrete')
  }
  s.set(DAY0 + 1, 28, AXIS_Z, P.lamp)

  // DAY 13: one block, 10,000.
  const x13 = dayX(13)
  s.set(x13, 0, AXIS_Z, P.pink)
  // DAY 72: ten blocks, 100,000, topped in gold.
  const x72 = dayX(72)
  s.box([x72, 0, AXIS_Z - 1], [x72, 8, AXIS_Z + 1], P.pink)
  s.box([x72, 9, AXIS_Z - 1], [x72, 9, AXIS_Z + 1], 'gold_block')

  /* THE WALK UP: a stair from day 13 to day 72 along the axis, one block
   * up every three along, so it arrives level with the top of day 72. */
  for (let x = x13 - 1; x > x72; x--) {
    const h = Math.min(9, Math.floor((x13 - x) / 3))
    s.box([x, 0, AXIS_Z], [x, h, AXIS_Z], 'white_concrete')
  }

  /* THE BREAK, between day 72 and now: a bridge at the same height, with a
   * gap in its rail -- the axis is not to scale past this point. */
  const TODAY = 12
  s.box([TODAY + 3, 9, AXIS_Z], [x72 - 1, 9, AXIS_Z], 'white_concrete')
  for (let x = TODAY + 3; x < x72; x++) if (x % 4) s.set(x, 10, AXIS_Z - 1, 'light_gray_concrete')

  /* TODAY: twenty-eight blocks, 280,000, a 3 x 3 pink tower with a stair
   * winding round it from the bridge to the top. */
  s.box([TODAY - 1, 0, AXIS_Z - 1], [TODAY + 1, 27, AXIS_Z + 1], P.pink)
  // The ring, clockwise from the bridge end (east side, +x).
  const ring = []
  for (let z = AXIS_Z; z <= AXIS_Z + 2; z++) ring.push([TODAY + 2, z])
  for (let x = TODAY + 1; x >= TODAY - 2; x--) ring.push([x, AXIS_Z + 2])
  for (let z = AXIS_Z + 1; z >= AXIS_Z - 2; z--) ring.push([TODAY - 2, z])
  for (let x = TODAY - 1; x <= TODAY + 2; x++) ring.push([x, AXIS_Z - 2])
  ring.push([TODAY + 2, AXIS_Z - 1])
  /* One block per step, not a column: the ring wraps past its own start
   * at the top, and a step sixteen above another needs the air under it. */
  for (let i = 0; i < 18; i++) {
    const [x, z] = ring[i % ring.length]
    s.set(x, 10 + i, z, 'white_concrete')
  }
  /* The top: a deck over the core, with a rail and a light -- and a hole in
   * both where the last two steps come up through them. */
  s.box([TODAY - 2, 28, AXIS_Z - 2], [TODAY + 2, 28, AXIS_Z + 2], P.pink)
  s.hollow([TODAY - 2, 29, AXIS_Z - 2], [TODAY + 2, 29, AXIS_Z + 2], { walls: 'white_concrete' })
  s.clear([TODAY + 2, 28, AXIS_Z], [TODAY + 2, 29, AXIS_Z + 1])
  s.set(TODAY, 28, AXIS_Z, P.lamp)

  // Light along the walk.
  for (let x = DAY0; x >= 6; x -= 6) { s.pillar(x, AXIS_Z + 4, 0, 2, P.post); s.set(x, 3, AXIS_Z + 4, P.lamp) }
}

/* ====================================================================== *
 * BAMBOO, round the back and the west edge -- the owner's choice for this
 * stretch of the world, planted by the recipe in src/builds/biomes.js:
 * leaves only at the top, one offset variant per stalk.
 * ====================================================================== */

function bamboo(s) {
  const h = (x, z, k) => ((x * 73856093) ^ (z * 19349663) ^ (k * 83492791)) >>> 0
  const stalk = (x, z) => {
    const v = h(x, z, 1) & 3
    const tall = 6 + (h(x, z, 2) % 9)
    for (let y = 0; y < tall - 2; y++) s.set(x, y, z, BAMBOO.cane[v])
    s.set(x, tall - 2, z, BAMBOO.small[v])
    s.set(x, tall - 1, z, BAMBOO.large[v])
  }
  for (let x = 1; x <= 40; x++) {
    for (let z = 4; z <= 44; z++) {
      // A grove west of the TV, thinning toward it.
      const d = x < 10 ? 0.55 : x < 25 ? 0.22 : 0.08
      if ((h(x, z, 3) % 1000) / 1000 < d * 0.5) stalk(x, z)
    }
  }
  for (let x = 1; x <= 66; x++) {
    for (const z of [61, 62]) if ((h(x, z, 4) % 1000) / 1000 < 0.2) stalk(x, z)
  }
  // A path through the grove to the back of the TV.
  for (let x = 1; x <= 45; x++) for (let z = 24; z <= 26; z++) {
    s.set(x, -1, z, 'coarse_dirt')
    for (let y = 0; y <= 16; y++) s.set(x, y, z, 'air')
  }
}

/* ====================================================================== */

function signs(s) {
  /* NO SIGNS ON THIS PLOT, and that is the owner's rule rather than an
   * omission: "i dont really care to have physical signs that have such
   * trivial information. That is the type of stuff that should be stored
   * in AI Evan memory." The dates, the follower numbers and the video
   * topics are in AI Evan's corpus under chapter ch3; the plot keeps the
   * objects that carry them -- the set, the thirteen lights, the chart. */

  // The back door of the TV, out to the chart.
  s.clear([52, 0, TV.z1], [53, 2, TV.z1])
  s.clear([52, 0, TV.z1 - 1], [53, 2, TV.z1 - 1])

  // The roof egg: a play button, laid flat between the antennae.
  const { x1, z0, top } = TV
  const px = x1 - 10, pz = z0 + 13
  const tri = ['#....', '###..', '#####', '###..', '#....']
  tri.forEach((row, r) => [...row].forEach((c, i) => {
    if (c === '#') s.set(px - i, top, pz + r, P.pink)
  }))
}
