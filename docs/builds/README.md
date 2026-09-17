# Building a stage

Eight stages of one life, four to a side of one road, in a 128x128 world. This
is how you build yours.

> **THERE ARE TWO WORLDS NOW, AND THIS DOCUMENT IS ABOUT THE OLD ONE.**
>
> Everything below describes **`claude-opus-5-1`**: a 128x128 patch, eight
> plots, a straight paved road, spawn at the south end, north through time.
> It is the archive and it is frozen.
>
> The **overworld** is a different place and a different survey: 256x256,
> origin 128/16, a winding path instead of a road, a river with a bridge, a
> forest, and **six** chapter plots that are
> deliberately EMPTY — the owner is building those himself. Its table is the
> second half of `src/builds/plots.js` (`CHAPTERS`, `LAND`, `LAND_SIZE`), its
> builder is `src/builds/land.js`, and the visitor walks **south** with z
> counting up through the years.
>
> **What carries over unchanged:** the stamper and its whole API, `GROUND_Y`,
> plot-local coordinates, the block keys, the lighting rules, and — read it
> twice — the mirrored-text warning. What does NOT carry over is any
> coordinate: a patch index in this document is an index into the 128 patch.
>
> **What is new in the stamper:** `forbid`, a list of no-go rectangles in
> PATCH coordinates. The landscape's plot is the entire 256 square, because a
> winding path has no smaller honest bounding box, so the six chapters are
> handed to it as rectangles it must not write into. The guard that means
> "stay inside your plot" for you means "stay out of theirs" for it.

**Which world.** These plots are **`claude-opus-5-1`**, not the overworld. They
were the overworld for a day; the owner kept the built world under a name and
took his default back as bare superflat to build in himself. Reach it in game
with `/world claude-opus-5-1` (operator only, like `/world mountains`).

Nothing in this document changed when that happened, which is the point: the
plot table is patch indices into a 128x128 patch with its ground at
`GROUND_Y`, and `claude-opus-5-1` is that patch. The world a patch is installed
as was never one of the coordinate systems.

**The name is a series.** `claude-<model>-<n>`, where `n` counts worlds and not
versions of the model: the next world Opus 5 builds is `claude-opus-5-2`, and
the first one another model builds starts its own count at 1. See the `WORLDS`
table in `src/island.js`.

Read this, then read `src/builds/01-omaha.js`, which is the worked example. Then
open your own stub — it already exists and already has a row in
`src/builds/index.js`, so you never edit a file anybody else is editing.

---

## The three-minute version

```js
// src/builds/03-perplexity.js
export function build(s) {
  s.rect([0, 0], [55, 27], -1, 'polished_andesite')          // pave the whole plot
  s.hollow([10, 0, 4], [20, 5, 14], {                        // a room you can walk into
    walls: 'stone_bricks', floor: 'planks', ceiling: 'planks', inside: 'air',
  })
  s.clear([20, 1, 9], [20, 3, 9])                            // a doorway in the east wall
  s.set(15, 4, 9, 'glowstone')                               // light it
}
```

`s` is a stamper bound to your plot. Every coordinate is **plot-local**:
`(0, 0, 0)` is your plot's north-west corner at ground level, `+x` runs east
toward the road, `+z` runs south, `y = 0` is the air above the grass and
`y = -1` **is** the grass. Write outside your plot and it throws.

---

## The plot table

All coordinates are patch-local, `0..127` on x and z. Ground surface is
`y = 136`; the build ceiling is `y = 200`, so local y runs `-4 .. +64`.

| # | Stage | file | side | x | z |
|---|-------|------|------|---|---|
| 1 | Omaha, Nebraska | `01-omaha.js` | LEFT | 4–59 | 6–33 |
| 2 | Harvard | `02-harvard.js` | RIGHT | 68–123 | 6–33 |
| 3 | Perplexity | `03-perplexity.js` | LEFT | 4–59 | 34–61 |
| 4 | Arize | `04-arize.js` | RIGHT | 68–123 | 34–61 |
| 5 | Bilibili | `05-bilibili.js` | LEFT | 4–59 | 62–89 |
| 6 | No Logo | `06-nologo.js` | RIGHT | 68–123 | 62–89 |
| 7 | Patronus AI | `07-patronus.js` | LEFT | 4–59 | 90–117 |
| 8 | Parkour + San Francisco | `08-parkour-sf.js` | RIGHT | 68–123 | 90–117 |

Every plot is 56 wide and 28 deep, so local x runs `0..55` and local z runs
`0..27`.

**The road is `x = 62..65`, `z = 4..124`, and it belongs to `road.js`.** Its
plot is wider than its paving — `x = 60..67` — because the verges carry the
lamps and the stage markers. Do not write there.

Everything else (`x` 0–3, 60–67, 124–127 and `z` 0–3, 118–127) is margin and
stays grass. `test/70-builds.spec.js` asserts the margins are empty and that
their corners are still walkable grass rather than a trench.

**North is `-z`.** The visitor spawns at the SOUTH end of the road, at patch
(63, 120), and walks north through time. Stage 1 is the far end of the walk;
stage 8 is the first thing they pass. Face the good stuff east (`+x`) if you
are on the LEFT, west (`-x`) if you are on the RIGHT — that is where the road
is and it is where every visitor is standing.

### The helper, if you need patch or world coordinates

```js
import { plot, toPatch, toWorld, GROUND_Y } from './plots.js'

toPatch(plot('perplexity'), x, y, z)   // -> [px, py, pz]  patch indices, absolute y
toWorld(px, py, pz)                    // -> [wx, wy, wz]  what /tp takes
```

The stamper carries both as `s.toPatch(x, y, z)` and `s.toWorld(x, y, z)`,
already offset by any `s.at(...)` you are inside. You should rarely need them;
if a build is doing patch arithmetic, it has probably lost the plot origin.

---

## The API

Everything below is on `s`, everything is plot-local, and everything returns
`s` so calls chain.

| call | what it does |
|------|--------------|
| `s.set(x, y, z, key)` | one block |
| `s.box([x1,y1,z1], [x2,y2,z2], key)` | a solid box, inclusive, corners in any order |
| `s.clear(a, b)` | the same box, filled with air |
| `s.hollow(a, b, { walls, floor, ceiling, inside })` | a room. Each part is a block key or omitted. `inside: 'air'` carves the volume out |
| `s.line([x1,y1,z1], [x2,y2,z2], key)` | an axis-aligned run. Throws on a diagonal |
| `s.pillar(x, z, yFrom, yTo, key)` | a vertical run — the common case of `line` |
| `s.rect([x1,z1], [x2,z2], y, key)` | a flat horizontal rectangle at one height |
| `s.pattern({ at, plane, legend, rows })` | a 2-D drawing. See below |
| `s.at(dx, dy, dz, name)` | the same plot with the origin moved |
| `s.placed` | how many blocks you have written |
| `s.plot`, `s.size` | your bounds, if you want to derive from them |

### `pattern` is the one that matters

It is how anything detailed gets authored so that the source **looks like the
thing it builds**.

```js
s.pattern({
  at: [10, 0, 4],
  plane: 'zy',
  legend: { '#': 'white_concrete', 'W': 'glass', 'D': 'dark_oak_planks', 'B': 'bricks' },
  rows: [
    '#WW##WW##WW###',
    '#WW###.D.##WW#',
    'BBBBBBBDBBBBBB',
  ],
})
```

- `plane: 'xz'` — a floor plan seen from above. Characters run east (`+x`),
  rows run south (`+z`), so the listing is a map with north at the top.
- `plane: 'xy'` — a wall facing north or south. Characters run east, rows stack
  UP the page: the **last** row sits at `at`'s y, so you draw the wall the way
  it looks.
- `plane: 'zy'` — a wall facing east or west. Characters run south, rows stack
  up the page as in `xy`. **This is the one you want for a facade facing the
  road.**
- `' '` and `'.'` mean "leave whatever is there alone" unless your legend says
  otherwise. A character that is in neither throws, with its row and column.
- Ragged rows are fine. A short row just stops.

#### TEXT COMES OUT MIRRORED, AND IT COST TWO AGENTS AN AFTERNOON

**Babylon is left-handed.** Facing `+x`, `+z` is on your *left*; facing north,
`-x` is on your right. So for a reader standing in front of your wall, the
characters of a row run **right to left**, not left to right.

Nothing about a pattern of bricks reveals this. Anything with a readable
shape does, immediately and embarrassingly:

- Harvard cut `2024` into Widener's frieze and shipped **`4202`** on a `zy`
  wall, caught only by a screenshot from above.
- Patronus put `2026` on a hoarding and shipped it backwards on an `xy` wall,
  and its growth chart came out with the bars climbing the wrong way and the
  red line *rising* — which inverted the meaning of the thing it was drawing.

Both were found by looking, neither by a census, and **the fix in both cases
was to reverse each row before stamping**. Which plane is affected depends on
which way the wall faces, so do not memorise a rule from this paragraph:

**Draw it, screenshot it, and read it.** That is the only check that works.
The same handedness is why some drawings on one side of the road come out
correct with no reversal at all, which is precisely what makes it a trap —
it is not consistently wrong, so a spot check that happens to pass proves
nothing about the next wall.

### `at` is the other one

```js
function build(s) {
  house(s.at(30, 0, 4, 'perplexity/house'))
}

function house(h) {
  h.hollow([0, 0, 0], [15, 4, 13], { walls: 'white_concrete', ... })
}
```

The house is written at its own corner, in small numbers, and moves by editing
one line. The child shares the parent's block counter and its copy-on-write
bookkeeping — it is a lens on the same stamper, not a second one.

---

## Hanging a painting

One line, and it is the only call a build needs:

```js
import { hangPainting } from '../paintingArt.js'

hangPainting(s, [12, 4, 0], 'south', 'millard_north')
```

- `s` is the stamper. **It takes the stamper on purpose**, unlike
  `setSignText`, which does not. A sign is one block, so a build can stamp it
  and then label it and the two numbers only have to agree once. A 3x2
  painting is **six blocks plus an art registration**, and typing the corner
  twice is how you get a picture one cell to the left of its frame. This
  writes both halves from one set of numbers.
- `[12, 4, 0]` is the **bottom-left cell as a viewer sees it**, plot-local.
  The rectangle grows **up**, and to the **viewer's right**. It goes through
  `s.set`, so the plot bounds check applies — a painting that pokes into
  somebody else's chapter throws like any other block.
- `'south'` is the way the **picture looks**, not the wall it is stuck to. A
  painting on the south face of a building faces south, and is read by
  somebody standing south of it.
- `'millard_north'` is a row in `src/paintings.js`. Any of vanilla's 51
  variants works too — `'fighters'`, `'kebab'`.

**Every block behind the whole rectangle must be solid**, or `installAttachment`
pops the painting off the wall on the next tick. That is vanilla's rule
(`HangingEntity.survives` requires `allMatch(isSolid)` over the support box),
and here it is checked per cell.

Adding a new image is three steps and they are in `docs/paintings.md`.
The one that goes wrong is the **size**: it is an aspect-ratio decision, the
source is centre-cropped to it, and a landscape photo in a portrait frame
loses its ends. The build refuses a crop more than 15% off.

### Paintings do not take block light

Same caveat as the lighting section below, and for the same reason: object
meshes are not lit by `blockLight.js` at all. A painting is drawn **unlit**,
so it is at full brightness in a pitch-dark room — deliberately, because the
job of a photograph hung next to a building is to be compared with the
building, and that job fails indoors if the picture goes grey. Vanilla
paintings *are* block-lit and do go dark. If that ever reads wrong, the fix is
an object-mesh path in `blockLight.js`, which every sign in the world wants
too.

## Lighting a build, which is newer than it looks

The block light engine shipped the same day these plots were laid out, so
nothing in this repo had been *built against it* before stage 1. Two things
about it change how you place lamps, and both were found by photographing a
build that looked fine in the source:

- **Light falls one level per block and stops dead at a solid block.** A lamp
  in the next room lights the next room. "There is a glowstone near it" is not
  lighting; every aisle between two shelf runs is its own room as far as light
  is concerned, and needs its own source.
- **A sign, a chart or a plaque has to be its own light**, or carry a lit
  valance. Harvard photographed every unlit sign as grey and had to go back and
  light each one individually.

And the obvious one that is still worth saying: **a glowstone block sits at
eye level if you put it at `y = 1` or `y = 2`.** Three builds independently
placed lamps, monitors or desktops exactly in the eyeline and had to move them
down. Stand where the visitor stands before you decide a height.

## House rules

**YOUR PLOT IS YOURS TO RESIZE. NOBODY ELSE'S IS.** From the owner, and it
applies to every build in this repo from now on:

> "you can change the size of a plot, you can change the path up a little, you
> can make the island bigger, but you cannot change anything else inside any of
> the other plots while working on what."

So the things you may do while building your chapter are: **widen or move your
own row** in `src/builds/plots.js`, **nudge a control point** in
`src/builds/spine.js` if the path is in your way, and **grow the world**. The
things you may not do are everything else: another chapter's row, another
chapter's build file, another chapter's blocks. Chapter 1 took this rule up
immediately and grew from 52x24 to 66x63 — west and south only, because east is
the path and north is spawn.

The guard that enforces it is the stamper's bounds check, and it only works if
your row is honest. **Widening your plot to cover ground you then do not build
on is how the guard stops being a guard**: it turns the landscape's `forbid`
list into a no-go zone over empty grass, and the next agent reads the table and
believes you. Take the ground you need and no more.

**Fail loudly, and it already does.** An unknown block key throws. A write
outside your plot throws. A pattern character that is not in the legend throws.
A build that throws takes the page down, on purpose: a silently missing wall is
worse than a blank screen, because nobody finds it.

**Block keys are `src/blocks.js` keys, not Minecraft ids.** 659 of them. The one
that will catch you: the oak planks are **`planks`**, not `oak_planks`. `grass`
is the grass block. Stairs and slabs carry their orientation in the key
(`oak_stairs_east_bottom`, `stone_slab_top`) — if you are not sure which way one
faces, use full blocks; a staircase you cannot climb is worse than a blocky one.

**Builds are static geometry.** No entities, no per-tick behaviour, no new block
types. You are writing palette keys into columns before the world is installed;
there is no runtime.

**Light your interiors.** Torches, glowstone, sea lanterns, lava and magma all
emit real light as of today. A glowstone block swapped into a plank ceiling
reads as a fitting; a torch on the floor reads as a torch on the floor.

**Interiors matter.** A visitor who walks in and finds a hollow box feels
cheated. Furnish it.

**Give a floor its own block at `y = -1`.** Replace the grass rather than
building on top of it, so the inside of a building is at the same height as the
ground outside it. A floor at `y = 0` builds a house you step up into and a
door one block off the ground.

**Watch the vertical budget underground.** The world is Classic Flat: grass at
`y = -1`, dirt at `-2` and `-3`, bedrock at `-4`. A cellar is exactly two blocks
of headroom, and there is no room for a staircase — Omaha's is two crates under
a pair of missing floorboards. And a 1x1 shaft is a trap: from a cellar floor
the ground is three blocks up and a jump is one.

**Render distance is 128 blocks.** noa draws four chunks of 32. A visitor on the
road must be able to see your build beside them — so put the tall, legible thing
near the road edge of your plot and the background at the far end.

**Screenshot it from the road, at eye level, before you believe it.** Two real
mistakes in stage 1 were invisible from a plan view and obvious from a
screenshot: a five-by-five `N` facing the cornfield instead of the road, and
stage markers so tall that nobody walking past could read them.

**Every build needs an easter egg.** Reward looking under, behind and on top of
things. Stage 1 has three: a cellar under a missing floorboard, three emerald
blocks buried under a doghouse, and a 2011 dirt shack on the garage roof.

**Nothing factual is invented.** The licence a build takes is in how a fact is
drawn, never in what the fact is.

---

## Where the machinery is

- `src/builds/plots.js` — the plot table, as data. No imports, so `src/island.js`
  and node scripts can read it.
- `src/builds/stamp.js` — the stamper. One `put` at the centre; the bounds check
  and the copy-on-write live there and nowhere else.
- `src/builds/index.js` — the registry and `stampBuilds(world, surfaceY)`.
- `src/flatworld.js` — calls `stampBuilds` at the end of `flatPatch`, which is
  the last moment the world is mutable. Pass `builds: null` for a bare superflat
  patch, which is what specs that want to measure the ground do.

Structures are **columns rewritten once**, between generation and install. There
is no chunk hook and no `setBlock` storm at boot: `getVoxelID` stays two
subtractions and an array read, and the world is simply born with a house in it.

Only `claude-opus-5-1` is stamped, and it is the **dimension row** that says so:
the two generated rows in `src/dimensions.js` differ in exactly one field,
`builds: null` for the overworld and `builds: stampBuilds` for this world. The
Nether and the mountains are imported assets and never pass through `flatPatch`
at all.

### The trap nobody would guess

`flatPatch` hands all 16384 columns the **same** `Uint16Array`. The stamper
clones a column the first time it writes to one. If you ever touch `world.cols`
directly, one careless write moves the ground under the entire map.
`test/70-builds.spec.js` has the tripwire.

---

## Before you commit

```
npm run build
npm run smoke                       # eight seconds, and it is not optional
npx playwright test -c test/playwright.config.js test/70-builds.spec.js
```

`npm run smoke` exists because a shader that failed to compile once shipped an
invisible world through three agents reporting green.

---

## Known hazards — both now cleared

Two things used to sit inside the Arize plot that were not Arize's, and neither
does any more. Recorded because the reasoning is the reason to keep it that way.

- **AI Evan** stood at world (-4.5, 0.5), patch (82.5, 56.5), the middle of
  stage 4. `EVAN_XZ` in `src/main.js` is now an **offset from spawn** — two
  east and three north — and `src/npc.js` re-drops him at that offset from
  whichever world's spawn you arrive in. In this world that is the far lane of
  the paving under the arch. Do not build in the three blocks north of the
  arch, or he greets you from inside a wall.
- **`DROP_X` / `DROP_Z` in `test/helpers/world.js`**, the column every
  "teleport up and fall" spec falls down, was the same column. It is now in the
  **overworld**, which is bare superflat everywhere, so no build can reach it.

The live constraint that replaced them: **spawn is patch (63, 120)** and the
arch over it belongs to `road.js`. Everything a visitor sees in their first
frame is within about fifteen blocks of that.
