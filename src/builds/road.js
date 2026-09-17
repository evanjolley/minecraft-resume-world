/*
 * THE ROAD. The spine of the whole place.
 *
 * Eight stages of one life, four to a side, and this is what makes them read
 * as one world rather than as eight dioramas on a lawn. A visitor arrives at
 * its south end and walks north through time. It is the first thing anyone
 * sees and very nearly the only thing everyone sees, so it gets the same care
 * as a build.
 *
 * ------------------------------------------------------------------------
 * LOCAL COORDINATES HERE, as everywhere in src/builds/. The road's plot is
 * eight blocks wide and takes in the verges either side of the paving:
 *
 *   x = 0      west verge -- lamp posts and the stage markers for the LEFT plots
 *   x = 1      west kerb
 *   x = 2..5   the paving (patch x 62..65, which is the road the brief names)
 *   x = 6      east kerb
 *   x = 7      east verge -- lamps and markers for the RIGHT plots
 *
 *   z = 0      the north end, behind stage 1
 *   z = 116    the arch you arrive under
 *   z = 120    the south end
 *
 * ------------------------------------------------------------------------
 * WHY THE PAVING SITS AT y = -1 rather than on top of the grass. The ground
 * is the ground: test/01-world.spec.js asserts a player comes to rest at
 * SURFACE_Y, and a road one block proud of the lawn would be a kerb you trip
 * over for a hundred and twenty blocks. Replacing the grass block keeps every
 * height in the world at one number and makes the kerb -- a half slab at
 * y = 0 -- the only thing standing up, which is what a kerb is.
 */
import { PLOTS, ROAD } from './plots.js'

/** Stage numbers, 3x5, drawn the way they are read. Eight glyphs is fewer
 *  characters than one font file and it is the only text this world has. */
const DIGITS = {
  1: [' # ', '## ', ' # ', ' # ', '###'],
  2: ['###', '  #', '###', '#  ', '###'],
  3: ['###', '  #', '###', '  #', '###'],
  4: ['# #', '# #', '###', '  #', '  #'],
  5: ['###', '#  ', '###', '  #', '###'],
  6: ['###', '#  ', '###', '# #', '###'],
  7: ['###', '  #', '  #', '  #', '  #'],
  8: ['###', '# #', '###', '# #', '###'],
}

export function build(s) {
  const LAST_Z = ROAD.z1 - ROAD.z0   // 120: the south end, in road-local z

  paving(s, LAST_Z)
  lamps(s, LAST_Z)
  markers(s)
  gateway(s, LAST_Z)
  northEnd(s)
}

/*
 * The surface: two dark lanes between two light ones, a dashed white centre
 * line, and a half-slab kerb down each side.
 *
 * The dashes are what stop a hundred and twenty blocks of paving reading as a
 * corridor -- they give the eye a rate, so walking it feels like progress.
 * Four on, four off, which at Minecraft walking speed is a little over a
 * second a dash.
 */
function paving(s, LAST_Z) {
  s.rect([2, 0], [5, LAST_Z], -1, 'polished_andesite')
  s.line([2, -1, 0], [2, -1, LAST_Z], 'stone_bricks')
  s.line([5, -1, 0], [5, -1, LAST_Z], 'stone_bricks')

  for (let z = 2; z <= LAST_Z - 2; z += 8) {
    s.rect([3, z], [4, z + 3], -1, 'smooth_quartz')
  }

  // The kerb. A bottom slab, so it is a step up rather than a wall, and it is
  // the one line that tells you where the road ends when the grass is in
  // shadow. Under it, stone, so a kerb never floats over a hole somebody digs.
  s.line([1, 0, 0], [1, 0, LAST_Z], 'smooth_stone_slab')
  s.line([6, 0, 0], [6, 0, LAST_Z], 'smooth_stone_slab')
  s.line([1, -1, 0], [1, -1, LAST_Z], 'smooth_stone')
  s.line([6, -1, 0], [6, -1, LAST_Z], 'smooth_stone')
}

/*
 * Lamp posts, alternating sides every eight blocks.
 *
 * Light is new in this engine as of today -- glowstone, torches, sea lanterns
 * and lava all emit for real -- and an unlit road at night was the single
 * biggest thing making the world feel unfinished. Alternating rather than
 * paired: half the posts, the same coverage, and the stagger reads as a
 * street instead of as a colonnade.
 *
 * The `blocked` check is the boring important part. Stage markers stand on
 * the same verge, and a lamp post inside a marker panel is a lamp post you
 * cannot see and a digit with a hole in it.
 */
function lamps(s, LAST_Z) {
  const blocked = markerZones()
  for (let z = 6; z <= LAST_Z - 6; z += 8) {
    const west = (z / 8) % 2 === 0
    const x = west ? 0 : 7
    if (blocked.some(([a, b]) => z >= a - 1 && z <= b + 1)) continue
    s.pillar(x, z, 0, 2, 'polished_blackstone')
    s.set(x, 3, z, 'glowstone')
    s.set(x, 4, z, 'polished_blackstone_brick_slab')
  }
}

/** Where every marker panel stands, in road-local z. Shared by the lamps so
 *  the two never argue over a column. */
function markerZones() {
  return PLOTS.map(p => {
    const z = p.z0 - ROAD.z0 + 3
    return [z, z + 4]
  })
}

/*
 * A numbered marker at the head of every plot, facing the road.
 *
 * This is the one piece of navigation the world has: you always know which
 * stage you are standing beside, and you can see the next number from the
 * last one. The digit is white on black, one block proud of its backing
 * board, which is what makes it legible at eye level rather than only from
 * above -- the failure mode of every build laid out on a grid.
 */
function markers(s) {
  for (const p of PLOTS) {
    const z = p.z0 - ROAD.z0 + 3
    const left = p.side === 'LEFT'
    const back = left ? 0 : 7          // the verge column: the board
    const face = left ? 1 : 6          // the kerb column: the digit, one nearer the road

    s.box([back, 0, z - 1], [back, 6, z + 5], 'polished_blackstone')
    s.set(back, 7, z + 2, 'sea_lantern')

    s.pattern({
      at: [face, 1, z + 1],
      plane: 'zy',
      legend: { '#': 'white_concrete' },
      rows: DIGITS[p.n],
    })
  }
}

/*
 * The gateway you arrive under.
 *
 * Spawn is four blocks north of this arch (see SPAWN_PATCH_X/Z in plots.js),
 * so it is behind you when you land and framing the road when you turn round.
 * That is the point of it: a road that simply stops reads as an unfinished
 * edge, and an arch reads as a threshold you have already crossed.
 */
function gateway(s, LAST_Z) {
  const z = LAST_Z - 4
  for (const x of [1, 6]) {
    s.pillar(x, z, 0, 4, 'polished_blackstone')
    s.set(x, 1, z, 'polished_blackstone_bricks')
    s.set(x, 3, z, 'polished_blackstone_bricks')
  }
  s.line([1, 5, z], [6, 5, z], 'dark_oak_wood')
  s.line([2, 6, z], [5, 6, z], 'polished_blackstone')
  s.set(3, 5, z, 'glowstone')
  s.set(4, 5, z, 'glowstone')

  // The apron behind you: paving carried past the arch to the patch edge, so
  // the first thing underfoot is road rather than the seam where it starts.
  s.rect([2, LAST_Z - 3], [5, LAST_Z], -1, 'polished_andesite')
  s.set(2, 0, LAST_Z, 'sea_lantern')
  s.set(5, 0, LAST_Z, 'sea_lantern')
}

/*
 * The far end, past stage 1: a small round-off so the road finishes on
 * something. Deliberately plain -- it is the last thing you reach after an
 * eight-stage walk and it should feel like an ending, not a ninth stage.
 */
function northEnd(s) {
  s.rect([1, 0], [6, 2], -1, 'polished_andesite')
  s.line([1, 0, 0], [6, 0, 0], 'stone_brick_slab')
  s.set(2, 1, 0, 'sea_lantern')
  s.set(5, 1, 0, 'sea_lantern')
}
