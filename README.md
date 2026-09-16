# world

Walkable voxel world for world.evanjolley.com. Resume builds + parkour, with
concurrent visitors able to see each other.

The ground is a 128x128 Classic Flat superflat, generated in the browser by
`src/flatworld.js` from a layer preset. It used to be a cut of real Minecraft
1.21.8 terrain read out of Mojang's own region files, and that pipeline still
exists and still builds the Nether — `docs/TERRAIN.md` is that story. It stopped
being the overworld because the owner wanted flat ground to build on, and two
things left with it: the largest download on the page, and, for the world a
visitor lands in, the question of whether Mojang's generator output may be
republished. `docs/FUTURE.md` is what happens next.

## Run it

    npm install
    npm run dev      # http://localhost:5173

Click to enter (that click is what grants pointer lock).

    WASD        move            ctrl    sprint
    space       jump            shift   sneak
    left click  mine (hold)     E       inventory
    right click place           F5      camera perspective
    1-9 / scroll  hotbar slot   esc     release cursor

## Stack, and what we passed on

**noa-engine** for the voxel runtime. Gives us chunking, meshing, swept-AABB
collision and player physics. Passed on raw three.js, which is current and
maintained, but we'd be hand-writing greedy meshing and collision, and collision
feel is exactly what decides whether parkour is any good.

Known tradeoff: noa's last commit is May 2023 and it pins Babylon `^6`, while
Babylon ships 9.x. It boots clean on Node 24 / Vite 8 with no errors, and voxel
collision isn't a domain that rots, but we own it if we hit a bug.

**Pixel Perfection** for textures, by Hugh "XSSheep" Rutland, CC-BY-SA-4.0.
Mojang's own assets can't be redistributed, so this is one of the few genuinely
open 16x packs. The licence requires attribution wherever the work is
distributed, and the only place carrying it is the `NOTICE.txt` the CE build
copies into `public/textures/` -- which also records that `grass_side.png` is
our derivative. Note that a `--source=vanilla` build does not emit it, because
there is nothing to attribute. That file ships in a deploy build, but nothing
in the page points a visitor at it, so an in-game credits surface is a
prerequisite for going live; see `docs/FUTURE.md`.

Passed on ProgrammerArt (CC-BY, but rougher art) and on generating pixel art
procedurally, which dodges licensing but never looks as good as drawn art.

**VoxeLibre's `mcl_sounds`** for audio, plus four sounds from OpenGameArt,
committed in `sounds-src/free/` and built by `npm run sounds:free`. Same constraint
as the textures and a harder one to satisfy: audio is where open packs run out.
VoxeLibre won on paperwork rather than on sound -- it maps every single file to
a named author, a licence and a URL, where Minetest Game ships nearly the same
audio credited to "one of these twelve people". Every licence is recorded in
`sounds-src/free/NOTICE.txt`, which the build copies into `public/sounds/`.

Passed on Sonniss's GDC bundles, which are royalty-free but forbid
redistributing the sounds as standalone files -- exactly what a public repo and
a web server do.

    npm run sounds:free      # the committed free set; what CI and the deploy use
    npm run sounds:vanilla   # your own Minecraft install, better, local-only
    npm run sounds           # rebuild whichever of those is already installed

`sounds:vanilla` is the higher-fidelity build the same way `textures:vanilla`
is, and for the same reason it can never be committed or deployed. It is also
a wider one now: it extracts 149 samples across 14 sound families where the
free set produces 42 across 6.

Which sound a block makes is decided in `src/sounds.js`, by ordered rules
against block names rather than a table of rows -- `blocks.js` generates most
of its 638 blocks, so a hand-written table would be wrong one commit after it
was written. Every block resolves to one of Minecraft's SoundType families,
slabs and stairs inherit from the cube they were built from, and stone is
enumerated rather than left as a catch-all: a block no rule claims fails the
sound build and fails `test/12-sounds.spec.js` instead of quietly sounding
like rock. Families the installed set does not carry fall back through a
`from` chain to one it does, which is how the free set plays six families
without any block going silent.

## Minecraft fidelity

Movement uses real Java Edition constants, verified by measuring in-browser
rather than by trusting the arithmetic:

| thing            | Minecraft | measured here |
|------------------|-----------|---------------|
| jump apex        | 1.2522 b  | 1.2521 b      |
| walk speed       | 4.317 b/s | 4.288 b/s     |
| sprint speed     | 5.612 b/s | 5.575 b/s     |
| sneak speed      | 1.295 b/s | 1.286 b/s     |
| player box       | 0.6x1.8   | 0.6x1.8       |
| fall damage      | >3 blocks | >3 blocks     |

The apex is the number that matters most: it's why you clear a 1-block step
and never a 2-block one, and every parkour jump is designed around it.

Every horizontal figure in that table sits about 0.66% under Minecraft's, and
that is one cause rather than three. noa's movement component pushes with
`responsiveness * (target - v)` while the physics engine drags with
`drag * v`, so the two balance at `target * 15/15.1` instead of at `target`.
`src/fluids.js` already solves for that and inflates its own cap to
compensate; `src/physics.js` does not. It is one line, it moves a calibrated
constant, and it is recorded in `docs/FUTURE.md` as Evan's call rather than
taken.

Two traps found while calibrating, both worth knowing if you retune:

- `debug: true` runs a block noa itself labels "temp hacks for development",
  and one of those hacks sets `airJumps = 999`. That was the infinite jump,
  not a physics setting.
- noa ships the player body with `gravityMultiplier = 2`, so the global
  gravity silently doubles. Jump impulse is therefore *calibrated*, not
  derived; re-run the binary search if you change gravity or air drag.

The world is 128x128 (8x8 Minecraft chunks), walled on all four sides with
barrier blocks. The overworld is Classic Flat -- grass, two dirt, bedrock -- so
there is no ore, no cave and no view, on purpose: it is a build surface.
`src/dimensions.js` is the registry, and a row there either names a `generate`
thunk or an `asset` URL to fetch, which is the one place generated and imported
worlds are told apart. The Nether is an imported patch and still reachable by
`/dimension nether` locally; it is absent from a deployed build, because
`scripts/check-deploy-assets.mjs` refuses `dist/terrain/` outright over the
licence question in `docs/DEPLOYMENT.md`, and `src/dimensions.js` reports the
404 to the player rather than failing silently.

X is mirrored on the way out of the extractor, and that is the one thing in
the pipeline that is not a straight copy. Babylon's scene is left-handed and
Minecraft's world is right-handed, so without the flip the whole thing renders
as a mirror image of the save it came from -- which is a bug that looks like
nothing at all, because everything downstream inherits it and agrees with it.
The consequence a player can see is that **+X is west here**: the axes cannot
carry Minecraft's cardinal names and turn like a compass at the same time in a
left-handed scene. `docs/TERRAIN.md` has the argument.

`src/island.js` still answers `(x, y, z) => blockID` and is still pure, and it
is a lookup either way -- the generator emits exactly the shape
`src/terrainFormat.js`'s decoder returns, so there is one lookup path rather
than two. That was the main call in `flatworld.js` and the alternative is
written up there: a `source` object with `imported` and `generated`
implementations reads cleaner in the abstract, costs a polymorphic call per
voxel per chunk, and gives you two things that can disagree about the barrier,
the bounds or the palette. `terrainFormat.js` is still shared by the browser
and by the verifier that checks an imported asset back against its region
files.

Pixel Perfection CE predates Caves & Cliffs, and the palette reaches past it:
95 of 427 materials have no CE original
(copper, deepslate, tuff, sculk, the newer wood sets), so the build derives
those by colour-shifting the nearest CE texture rather than dropping the
blocks. Dropping them would make block ids mean different things depending on
which texture source you happened to build with, and ids are world data.

Sprint follows Minecraft's real rules: double-tap forward within 7 ticks, or
hold Ctrl, cancelled by releasing forward / sneaking / dropping to 6 food.
Base FOV is Minecraft's 70 degrees, kicking to 77 while sprinting -- without
that cue a 30% speed change is nearly imperceptible.

Day/night runs Minecraft's clock: 24000 ticks at 20/sec, measured at 19.95,
so a 20.1 minute day against Minecraft's 20.

Tools work: mining time is `ceil(rawHardness * (canHarvest ? 30 : 100) /
destroySpeed)` quantised to whole ticks, which reproduces the wiki's stone row
exactly across all seven tiers. Mined blocks drop on the floor as item
entities and are picked up by walking over them, rather than teleporting into
the inventory.

Also implemented: hold-to-break with per-block times and the destroy-stage
crack overlay, Minecraft's drop rules (grass gives dirt, stone gives
cobblestone), placement blocked when it would trap the player, stack-merging
inventory with left/right click semantics, hearts and hunger in half-units,
XP bar, fall damage, void death with a proper death screen, sneak
edge-protection, first-person held item with view bob and swing, a geometry
cloud layer, the sun, Minecraft's black wireframe block outline, and the
Monocraft typeface.

Water and lava are in, with Minecraft's real sinking and swimming speeds, the
air and bubble meter, drowning, and burning on the way out of lava. See
`src/fluids.js`, which also documents which of noa's fluid options are dead
code in 0.33 and what has to be done instead. Flow blocks are full cubes rather
than sloped: a `shape` would take the block off noa's terrain mesher, which
costs it the buoyancy flag and hands it to solid collision, and the reasoning
is above `flowSet` in `src/blocks.js`.

Furnaces smelt, with vanilla's fuel and recipe tables, the two arrows, and the
fact that one keeps burning while you are not looking at it (`src/furnace.js`
is `TileEntityFurnace.update`). Break one and it drops what was inside.
Buckets carry a source block and only a source block. Water and lava flow --
vanilla's levels 0-7 plus a falling flag, at vanilla's 5-tick and 30-tick
rates -- which cost sixteen new block ids per fluid, because this engine has no
block metadata to put a level in. Nether portals work: obsidian frame, flint
and steel, four seconds, through.

Deliberately NOT implemented: mobs, durability, enchanting. Hunger *drain* is written but
switched off via `HUNGER_DRAIN_ENABLED` in `survival.js`, because a visitor
reading a resume plot shouldn't starve while doing it.

Not yet done: resume content (the whole point -- the world is still empty),
multiplayer presence, and deployment.

The browser suite is **924 tests across 50 spec files**, run with `npm test`.
It drives real browsers against a real engine rather than mocking noa, which is
why it catches the things that only go wrong once Babylon is involved -- and
why it is slow. Every spec runs twice, once in Chromium and once in WebKit, and
`workers: 1` is deliberate because the world is global mutable state. That is
about two hours end to end, so run the files you touched and use
`npx playwright test -c test/playwright.config.js --list` when you want a
count. WebKit was added in `docs/browsers.md`'s pass, which found that Safari
had never rendered any terrain at all: one undeclared uniform, and it is also
faster than the Chromium this suite had always used.

What no browser can test, in either engine: pointer lock and real user
activation are not granted to an automated window, so mouse-look, the Escape
menu's cursor handover, and the first sound after a click are untested. See
`docs/browsers.md` section 5 and `docs/REPORTED.md` item 4.

The block palette is 355 full cubes on a paged texture atlas (128 layers per
page, 5 pages) -- paged because WebGL2 only guarantees 256 array layers, so a
single page would cap the palette.

Fog was investigated and rejected once, on the grounds that noa's terrain
shader has no fog handling at all and Babylon scene fog would tint the sky and
leave the world untouched. **That was wrong about the cause and it is fixed.**
Babylon bakes a `FOG` define into a material the first time it compiles, so fog
turned on later works everywhere except the terrain -- which looks exactly like
"the terrain shader has no fog". `src/underwater.js` sets `scene.fogMode` to
EXP2 once at boot and never changes it, and switches the effect with
`fogDensity` instead. Underwater fog is the caller today; a per-dimension fog
would be free.

Past the cubes there are 280 non-cube blocks: slabs and stairs for 28 material
families, drawn through noa's `blockMesh` (see `blockMeshes.js`). They add no
atlas layers -- they reuse their parent cube's texture through a plain Babylon
material, one draw call per block id.

**noa has no sub-voxel collision, and this is the part worth knowing.** Its
physics asks `testSolid(x, y, z)` over integer coordinates and nothing else: a
voxel is a whole cube or it is nothing. So slabs and stairs are registered
non-solid, noa's sweep ignores them entirely, and `blockMeshes.js` resolves
them itself after each physics step -- a swept test vertically so a fast fall
can't tunnel through half a block, penetration depth horizontally, and
Minecraft's 0.6 step height so you walk up a slab or a staircase without
jumping. Full cubes are untouched by all of it and still refuse to be stepped
onto, which is what keeps the parkour honest. Measured: falling onto a bottom
slab rests at exactly y+0.5, and a five-step staircase is climbed from 71.5 to
76.0 with no jump.

Two sharp edges came out of that work. The terrain mesher draws a cube for any
block with a face material, `blockMesh` or not, so non-cube blocks must
register with no material at all. And noa hands Babylon its thin-instance
matrix buffer before filling it and then relies on
`thinInstanceBufferUpdated()`, which does nothing on Babylon 6.49 -- so any
non-cube block placed fewer than nine at a time was invisible until
`installThinInstanceUploadFix()` started re-uploading the buffer.

Not modelled: fences, walls, panes and bars, and stair corner shapes. All of
them pick their geometry from their neighbours, and noa's thin instances can
vary a transform per voxel but not vertices. See the bottom of
`blockMeshes.js` for the three ways out and why each is a bigger job than this
one was.

## Layout

- `island.js` — pure `(x,y,z) => blockID`, now a lookup into the imported
  terrain rather than arithmetic. Pure because noa requests chunks in
  arbitrary order, possibly twice, possibly off-thread.
- `terrainFormat.js` — the VOX1 decoder, shared with `scripts/terrain/`.
- `fluids.js` — water and lava, and what being in one does to you.
- `blocks.js` — one table driving registration, icons, names, hardness, drops.
- `physics.js` — Minecraft movement constants and the calibrated jump.
- `survival.js` — health, hunger, XP, fall damage, death.
- `inventory.js` — 36-slot model plus the inventory screen.
- `interact.js` — mining, placing, hotbar and camera controls.
- `hud.js` — hotbar, hearts, hunger, XP, coordinates.
- `blockIcon.js` — CSS-cube inventory icons.
- `respawn.js` — void death and respawn.
- `main.js` — engine options, chunk callback, wiring.

## Gotcha for the scripted flythrough

`noa.camera.getDirection()` is only recomputed inside `applyInputsToCamera()`,
which early-returns when there's no pointer lock. Setting `noa.camera.pitch`
programmatically therefore does nothing until an input tick runs under lock.
The mobile flythrough will hit this. Workaround is
`noa.camera.sensitivityMultOutsidePointerlock = 1`.

## Next

The full argument, with what is blocked on effort and what is blocked on a
decision, is in `docs/FUTURE.md`. The short version:

1. Resolve whether generated Minecraft terrain may be republished. It is the
   first item because everything downstream inherits the answer, and the
   conservative default currently keeps `public/terrain/` out of the deploy.
   `docs/DEPLOYMENT.md` sets out the positions.
2. Resume content in the world. This has been the real gap for the whole
   project. The authoring story is to build in real Minecraft and import, and
   `scripts/terrain/` already reads the region format that needs.
3. A credits surface, which is cheap and which blocks deployment.
4. Deploy. The pipeline is built and exercised on every push; what is missing
   is an account, two secrets and a domain decision.
5. Then AI Evan, video screens, and multiplayer presence, in that order.
