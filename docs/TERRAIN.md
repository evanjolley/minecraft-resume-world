# Terrain import

The world used to be an 80x80 island produced by a pure function in
`src/island.js`. It is now a 128x128 patch cut out of a real Minecraft world.

## Why a real server and not a generator port

There is no faithful JavaScript implementation of Minecraft's world
generator. The cubiomes family is excellent at what it does -- it reproduces
biome placement fast enough to scan millions of seeds -- but it places no
blocks. It will tell you there is a jungle at (400, -120) and nothing about
what is actually there.

Anything that renders needs blocks, so the only source that can answer is
Mojang's own generator. The pipeline downloads the official 1.21.8 server jar
(URL resolved through Mojang's version manifest, checksum verified), runs it
headlessly, and reads the region files it writes. The JVM cost is paid once
at build time and never reaches the browser.

The Java it runs on is the JRE the Minecraft launcher already installed --
`java-runtime-delta`, which is the runtime Mojang pairs with 1.21.8. That is
one less multi-hundred-megabyte install and, more usefully, it is the runtime
the server was tested against rather than whatever `java` happens to be.

## Why chunks are forced rather than waited for

Booting a server generates the spawn area and stops. Since 1.20.5 the
spawn-chunk radius defaults to 2, so that is roughly 5x5 chunks -- an eighth
of what a 128x128 patch needs, in one dimension. `forceload add` names an
explicit rectangle, which is the difference between a build step and a guess.

Three things about driving a server this way cost a run each before they were
understood, and all three share a shape: the server fails in a way that still
exits 0.

- **Ports.** Two servers on one port do not queue. The second dies with
  `BindException` during init and the JVM exits 0 anyway, so a run that
  generated nothing looks exactly like one that worked, only faster. Fixed
  per-lane ports fixed it until a stale server from an earlier run held one.
  `server-port=0` lets the OS pick, and cannot collide with anything.
- **The watchdog.** It kills a server whose main thread has hung, and it
  cannot tell that apart from a main thread legitimately busy generating a
  thousand chunks. At the default 60s it crash-reports a healthy generate,
  and does it more often the more lanes compete for cores. Nothing connects
  to these servers, so `max-tick-time=-1` costs nothing.
- **The check that catches the rest.** `generateSeed` counts `.mca` files
  before returning. Exit codes are not evidence here.

## Why seeds are scored rather than chosen

A seed with a reputation is documented FOR A VERSION. World generation
changed substantially in 1.18 -- new height range, new noise router -- and
has kept moving since. The famous mountain seed from a 1.16 video generates
something else entirely in 1.21.8. Reputation does not transfer.

So the candidate pool is half well-known seeds and half arbitrary ones, and
every one of them is measured on the same three things:

- **biomes** -- distinct surface biomes covering at least 2% of the window.
  The 2% floor matters: a biome clipping one corner is not somewhere you can
  walk to, and counting it inflates every window that happens to sit near a
  border.
- **relief** -- 95th percentile surface height minus the 5th. Deliberately
  not max minus min, which a single spiky column or one lake bottom will
  max out, so a hill scores like a mountain.
- **tree cover** -- share of columns with a log in them. Logs, not leaves:
  canopy overhangs count one tree many times and make a sparse wood look
  like a forest.

Each is normalised against a target that means "clearly good enough" and
clipped there, so a spectacular score on one axis cannot buy a window out of
being bad on the others.

## The patch that was chosen, and the ones that were not

Ten seeds, 512x512 blocks generated around the origin each, every 128x128
window on a 16-block stride scored. Best two windows per seed:

| seed | corner | score | biomes | relief | trees | peak | biomes present |
|---|---|---|---|---|---|---|---|
| **12345** | **112,-32** | **97.3** | **4** | **112** | **9%** | **168** | **dark_forest 76%, frozen_peaks 13%, ocean 7%, lush_caves 2%** |
| 12345 | 96,-32 | 96.9 | 4 | 113 | 8% | 168 | dark_forest 74%, ocean 15%, frozen_peaks 8% |
| 8675309 | 0,64 | 84.1 | 4 | 59 | 2% | 118 | forest 77%, old_growth_birch 15%, ocean, beach |
| 987654321 | -160,128 | 84.0 | 4 | 28 | 10% | 106 | dark_forest 79%, river 11%, birch_forest 6% |
| 2151901553968352745 | -144,-16 | 83.1 | 4 | 60 | 2% | 139 | forest 59%, swamp 17%, windswept_hills 17% |
| 8675309 | -176,-160 | 82.7 | 4 | 68 | 1% | 134 | forest 61%, meadow 28%, river 9% |
| 0 | 48,96 | 71.4 | 4 | 42 | 0% | 105 | plains 71%, savanna 14%, river 11% |
| 4400 | 96,-192 | 67.7 | 3 | 55 | 1% | 113 | plains 50%, forest 44%, river 6% |
| 1 | 128,96 | 64.9 | 5 | 22 | 2% | 74 | forest 56%, stony_shore, beach, river, ocean |
| 3257840388504953787 | 16,128 | 64.0 | 4 | 28 | 0% | 61 | ocean 46%, lukewarm_ocean 22%, deep_ocean 17% |
| -4172144997902289642 | 32,-128 | 59.0 | 4 | 18 | 0% | 61 | lukewarm_ocean 70%, deep_lukewarm 23% |
| 1669320484 | 0,112 | 58.5 | 5 | 17 | 0% | 81 | plains 82%, ice_spikes 8%, river, frozen_river |

**Seed 12345 at (112, -32) wins on all three axes at once**, which none of the
others do. 112 blocks of relief against a field where 60 is the next best, a
dark forest dense enough to put a log in 9% of columns, and a frozen peak
rising to y=168. It is the only candidate that is simultaneously a nexus, a
forest, and a mountain -- the three things the brief asked for in descending
order of preference, delivered together rather than traded off.

Worth noticing in that table: **the seeds with public reputations lost.** The
four widely-circulated seeds produced the four worst windows, three of them
mostly ocean. 12345 and 987654321 are arbitrary numbers. This is the version
drift described above, and it is the argument for scoring rather than
trusting a list.

The runner-up to be honest about is 987654321 at (-160, 128): denser forest,
more biome balance, and only 28 blocks of relief -- a rolling wood with no
mountain. If the mountain turns out to dominate the view unpleasantly, that
is the one to try next.

## Why the data is small

128 x 128 x 384 is 6.3 million voxels. At a byte each that is 6.3MB against a
bundle that is currently 1.27MB, so two things happen.

The vertical range is trimmed to what the patch occupies: bedrock up to eight
blocks above the highest block. The headroom is not decoration -- a patch
whose ceiling is the summit is a patch you cannot jump on.

Each column is then run-length encoded down Y, which suits real terrain
almost unreasonably well. A column is a handful of enormous runs: deepslate,
stone, dirt, one grass, then air. Y is also the axis the engine reads along
when it builds a chunk, so the decode is a walk rather than a gather. Lengths
and palette indices are varints, because runs are routinely longer than 255
and palette indices are almost always one byte.

## What is dropped

The engine renders full cubes. That one fact decides the whole mapping.
Cross-shaped plants -- grass, ferns, flowers, saplings -- have no
representation, and drawing them as cubes would put solid blocks of
grass-blade texture across the ground. They become air, and they are
**counted and reported**, because a silent drop is how a forest floor loses
its undergrowth without anyone being able to say when.

`npm run terrain:blocks` prints the full accounting: mapped cleanly, mapped
to keys another agent is still adding (water and lava), needs a new block,
dropped as a plant, dropped as structurally unsupported. Sorted by count,
because a block appearing 40,000 times decides how the world looks and one
appearing twice does not.

## Commands

    npm run terrain:seeds    generate candidate worlds (minutes, needs the JVM)
    npm run terrain:scan     score every window, print the table
    npm run terrain          extract the chosen patch into public/terrain/
    npm run terrain:blocks   print the block mapping report
    npm run terrain:verify   decode the asset and check every voxel

`terrain:verify` is worth running after any change to the encoder. Every
failure mode of an RLE encoder produces a file that looks fine -- a wrong
varint continuation, an off-by-one run length, a palette index written before
the palette was finished all yield a plausible number of plausible bytes, and
the first sign of trouble is terrain that looks subtly wrong in a browser
weeks later. The verifier's decoder is written fresh rather than shared with
the encoder, so it can catch a format that was written down wrong rather than
only an encoder that disagrees with itself. It currently checks 4,096,000
voxels against the region files and all of them match.

### Measured size

958KB raw, **404KB gzipped**, from a 56-key palette at 29.4 runs per column.
The vertical trim keeps 250 of 384 layers -- bedrock at -64 up to y=185,
eight above the highest block at 177.

That is comfortably under the 1MB gzipped line, but it is not free: the
bundle today is 324KB gzipped, so this patch is **larger than the entire rest
of the site**. If that proves too much, the cheapest cut by far is the
vertical range, not the encoding. Everything below roughly y=0 is deepslate,
ore and cave, none of which a visitor walking the surface will ever see, and
dropping it would remove about a third of the layers.

`public/terrain/` is generated and gitignored. **See the open licensing
question in DEPLOYMENT.md before assuming it can ship.**
