# Building a stage

Eight stages of one life, four to a side of one road, in a 128x128 world. This
is how you build yours.

> **THERE ARE TWO WORLDS NOW, AND MOST OF THIS DOCUMENT IS ABOUT THE OLD ONE.**
>
> Everything after the overworld section below describes **`claude-opus-5-1`**: a 128x128 patch,
> eight plots, a straight paved road, spawn at the south end, north through
> time. It is the archive and it is frozen.
>
> **What carries over to the overworld unchanged:** the stamper and its whole
> API, `GROUND_Y`, plot-local coordinates, the block keys, the lighting
> rules, and (read it twice) the mirrored-text warning. What does NOT carry
> over is any coordinate: a patch index after the overworld section is an index into the
> 128 patch.

## The overworld (Sprint 1 survey)

The world you boot into is **288 x 400**, origin **144/16** (world x = patch
x - 144, world z = patch z - 16), ground at `GROUND_Y` = 136, floor (bedrock)
at y = 128, ceiling at y = 200. Spawn is world (0, 0), at the north end of
the walk, and the visitor walks **south** with z counting up through the
years. The survey is the second half of `src/builds/plots.js` (`LAND_W`,
`LAND_D`, `CHAPTER_SIZE`, `CHAPTERS`).

### The plot table

| # | chapter | build file | side | patch x | patch z | size |
|---|---------|------------|------|---------|---------|------|
| 1 | Omaha, Millard North | `ch1-millard-north.js` (frozen) | LEFT | 30..95 | 32..94 | 66 x 63 |
| 2 | Harvard, Science Center | `ch2-science-center.js` | RIGHT | 192..265 | 64..139 | 74 x 76 |
| 3 | Bilibili | `ch3-bilibili.js` | LEFT | 26..95 | 122..185 | 70 x 64 |
| 4 | New York, No Logo | `ch4-new-york.js` | RIGHT | 192..265 | 192..267 | 74 x 76 |
| 5 | San Francisco, Patronus AI | `ch5-san-francisco.js` | LEFT | 22..95 | 238..313 | 74 x 76 |
| 6 | The climb | `ch6-the-climb.js` | RIGHT | 192..265 | 304..379 | 74 x 76, and the air |

LEFT is the low-x side (+x is west in this engine), so a LEFT plot's
path-side edge is its x1 and a RIGHT plot's is its x0. Every plot's entrance
is on that edge at plot-local z = 6, where its spur arrives; rows z 0..3 hold
the chapter's marker, drawn by `src/builds/chapters.js` before the build.

**The layout follows the builds.** Each build file exports
`SIZE = { w, d }`; `CHAPTER_SIZE` in `plots.js` is the table, and
`chapters.js` checks one against the other at boot. A plot is placed by its
path-side edge and its north edge, so a build smaller than the 74 x 76 slot
keeps its entrance where it was and gives the rest back to the landscape.
A build bigger than its row throws and names the row.

**Chapter 1 moved and did not change.** It was at patch 14, 22 in the old
256-square survey. Its contents are checked byte for byte in plot-local
coordinates by `test/91-biomes.spec.js` (digest `2c1d00d0`, 27,571 solid
voxels, the same before and after the move). Its survey posts are hashed from
the old corner (`FRAME_ORIGIN` in `chapters.js`) so that even they did not
move.

### The land between the plots

`src/builds/land.js` generates it, in order:

1. **Biomes** (`biomes.js`): warped Voronoi over anchors, one per chapter
   plus extras. The arc down the walk is plains, forest and dark forest,
   birch, bamboo jungle, river, taiga, windswept hills, jagged peaks. The
   block on top dithers at borders; the SHAPE of the land blends smoothly
   through soft weights.
2. **Terrain**: each biome's base height and roughness times rolling and
   ridged gradient (Perlin) noise (`noise.js`). Plains roll two or three
   blocks; the peaks rise past +50.
3. **Water** (`river.js`): a river running diagonally between chapters 3 and
   4 on both sides of the path, a lake north-east of spawn, and the moat that
   makes New York an island. All water stands at one level, local y = -2,
   and no land column is below it, so nothing can flood.
4. **Pads**: the land eases down to plot level over 14 blocks round every
   plot, and round spawn. Every plot is flat at `GROUND_Y`.
5. **The walk** (`path.js`, `spine.js`): a spline through hand-placed points,
   swinging toward each chapter, with a spur to each entrance. Its height is
   the land's, averaged along the walk and limited to one block in three;
   every one-block rise gets a slab, so the whole walk is walkable without
   jumping (0.5 is under the 0.6 step height). Bridges cross the river and
   the moat.
6. **Surface**: grass over three or four dirt over stone, sand at the water,
   stone on steep slopes, podzol in the taiga and under bamboo, snow on the
   peaks, ore where a cliff shows stone.
7. **What grows** (`flora.js`, `trees.js`): vanilla's tree features
   transcribed from the 1.21 trunk and foliage placers (oak, fancy oak,
   birch, spruce, pine, dark oak, jungle, jungle bush, huge mushrooms),
   placed per 16 x 16 chunk at vanilla-like counts per biome; grass, ferns,
   flowers, tall plants and mushrooms as vanilla random patches; bamboo
   stands; lily pads; boulders. These use new plant blocks (`blocks.js`,
   cross-shaped meshes in `blockMeshes.js`, Pixel Perfection CE art).

The landscape never writes inside a plot: its voxel writer refuses plot
columns, the same guarantee the stamper's `forbid` list used to give.

### Efficiency

The generator has no browser imports, so it runs (and is tested) in node,
and it writes the whole world into one `Uint16Array` with each column a
view into it. Measured in headless Chromium (SwiftShader) on the dev server,
interleaved runs on the same machine at the same time, against current main
(the 256 x 256 superflat with the old stamped landscape):

| | columns | terrain generation | boot to playable | frame rate at spawn |
|---|---|---|---|---|
| before (main) | 65,536 | ~206 ms | ~5.3 s | ~25 fps |
| after (this survey, all six chapters) | 115,200 | ~170 ms | ~6.8 s | ~18 fps |

Generation got faster on a world 1.76 times the area. Boot-to-playable and
the frame rate got somewhat worse, and the reason is what is on screen: a
rolling, forested world has far more geometry than a flat one, and every
grass and flower instance is drawn every frame. Under SwiftShader that is
the whole cost (the main thread is idle). Three things were done about it:

- The world's floor is y = 128, a chunk boundary, so the ground still sits
  in one vertical layer of noa chunks (a floor at 112 made every column two
  chunks to mesh and light).
- `blockMeshes.js` changes that help every world: the thin-instance upload
  workaround now re-uploads only the buffers noa marks dirty (it re-uploaded
  every object-block buffer in the world on every chunk change, the single
  largest cost in a boot profile), and a zero-thickness plane is drawn once,
  not twice, which halves the fill of every plant and bamboo leaf.
- Ground cover is half of vanilla's grass counts and sparse away from the
  walk (see `PLANT_REACH` in `flora.js`). That one constant is the knob if a
  real device needs more frames.
