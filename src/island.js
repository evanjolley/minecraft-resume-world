/*
 * The world: a 128x128 patch, 128 blocks on a side, one dimension at a time.
 *
 * THIS FILE HAS BEEN THREE THINGS. It built an 80x80 island out of noise
 * functions; then it looked up a 128x128 cut of REAL Minecraft 1.21.8
 * terrain (seed 12345, shipped as public/terrain/terrain.bin); and now it
 * does BOTH, because the overworld is generated again and the Nether is
 * still that import.
 *
 * Through all three, one thing did not move: `getVoxelID(x, y, z, ids)`.
 * noa's chunk callback, respawn.js, the barrier, and thirteen spec files are
 * written against that signature and none of them has ever had to know where
 * the answer comes from. That is the whole reason a change this large is a
 * change to two files.
 *
 * ------------------------------------------------------------------------
 * TWO KINDS OF DIMENSION, AND THE ONE PLACE THEY DIFFER
 *
 *   overworld -- GENERATED, by src/flatworld.js, at boot, from a preset.
 *                No asset, no fetch, no network. See flatworld.js for the
 *                licence and bundle-size arguments that made this worth
 *                doing rather than merely possible.
 *   nether    -- IMPORTED, still: public/terrain/nether.bin, decoded by
 *                src/terrainFormat.js, verified by scripts/terrain/verify.mjs
 *                against the region files it came from.
 *
 * They differ in exactly one place: which function puts the world into
 * `patches`. `generateTerrain` compiles it; `loadTerrain` fetches and decodes
 * it. src/dimensions.js decides which, by whether a dimension row carries a
 * `generate` thunk or an `asset` URL. Below that line there is one world
 * representation and one lookup -- flatworld.js emits precisely the object
 * `decode` emits -- so nothing else in this file, or downstream of it,
 * branches on the distinction at all.
 *
 * REJECTED -- keeping loadTerrain as the single entry point and giving it a
 * `file://`-ish special case, or a null URL meaning "generate". It is one
 * function doing two unrelated things, and it drags the async/network shape
 * onto the generated path, which is the thing being removed.
 *
 * WHICH MEANS THE BOOT GATE MOVED. main.js used to hard-gate the Engine on a
 * fetch that could 404, and THROW rather than degrade. That gate still exists
 * and still throws -- but it now applies only to a dimension that actually
 * needs an asset, which today is the Nether and which is entered on demand,
 * not at boot. Booting the overworld cannot 404 any more.
 * ------------------------------------------------------------------------
 *
 * PURITY, restated, because it keeps needing restating. "Pure" here means:
 * for a given (x, y, z) the answer is always the same. A lookup into
 * immutable data satisfies that exactly as a noise function does -- noa may
 * ask for chunks in any order, twice, or on a worker, and every answer still
 * agrees with every other. What would break it is a lookup that returns air
 * before the data has arrived and stone afterwards, which is why an asset
 * dimension is a hard gate rather than a best effort. A generated dimension
 * simply cannot be in that state, which is one fewer way to be wrong.
 *
 * WHY 128x128 AND NOT MORE: this used to be an argument about download size
 * and it is not any more -- generating 512x512 would cost nothing to ship.
 * It stays because the owner is building inside a defined area with a working
 * barrier perimeter around it, and because 128 blocks is eight Minecraft
 * chunks, enough that the far side is a walk rather than a glance.
 */
import { decode } from './terrainFormat.js'

/*
 * WHERE EVERY WORLD SITS, in one table.
 *
 * This used to be four module constants -- PATCH_SIZE, PATCH_ORIGIN_X,
 * PATCH_ORIGIN_Z, SURFACE_Y -- and the comment above PATCH_SIZE said "the
 * barrier maths below assumes one number rather than one per world". That
 * assumption held exactly as long as both worlds were 128-block cuts of the
 * same seed pinned to the same corner. The mountain patch is 256 wide, cut
 * from a different seed, and its ground is at y=111; every one of those four
 * numbers had to become three numbers.
 *
 * A TABLE HERE rather than in src/dimensions.js, even though dimensions.js is
 * the registry the switch reads. Two reasons, and the second is the real one:
 *
 *   - This is geometry -- where the patch is, how wide, how high the floor.
 *     dimensions.js's rows are about PRESENTATION and SOURCE: sky, fog, an
 *     asset URL, a generate thunk. Those are different questions and they
 *     have different readers.
 *   - scripts/terrain/verify.mjs imports this file, in node, to check that
 *     an asset's spawn column is the column the game builds its origin from.
 *     dimensions.js pulls in blocks.js, flatworld.js and portals.js, which
 *     pull in Babylon. A verifier that cannot run without a WebGL context is
 *     a verifier that stops being run.
 *
 * `size`             the patch is square; this is its side, in blocks.
 * `originX/originZ`  the ASSET COLUMN that world coordinate 0 sits on, so
 *                    world x = assetX - originX. Every world puts its spawn
 *                    at (0, 0) horizontally, which is what makes "look at the
 *                    block under your feet" mean the same thing in all three.
 * `surfaceY`         the y a player's feet are at when they arrive.
 * `drop`             how far above that they are released. The overworld's 2
 *                    is inherited from the old SPAWN constant and is asserted
 *                    by specs that watch the landing; 1 everywhere else, which
 *                    is what the Nether has always used. Data rather than a
 *                    branch in spawnFor, because "why is one world different"
 *                    is a question you should be able to answer by reading the
 *                    row.
 *
 * THE NETHER'S ROW IS THE OLD CONSTANTS, UNCHANGED, and deliberately still
 * shares the overworld's origin. src/dimensions.js argues at length for the
 * 1:1 portal mapping that pinning buys, and the mountain world is outside
 * that argument -- it is a different seed with a different shape, it has no
 * portal relationship with anything, and pinning it to 87/56 would only mean
 * its spawn landed somewhere arbitrary.
 */
export const WORLDS = {
  overworld: { size: 128, originX: 87, originZ: 56, surfaceY: 136, drop: 2 },
  nether: { size: 128, originX: 87, originZ: 56, surfaceY: 75, drop: 1 },
  /*
   * Seed 434533485056755, patch corner (-112, 0), 256 blocks square.
   *
   * The origin is the spawn column from public/terrain/mountains.json, and
   * that spawn was chosen by RAY TEST (scripts/terrain/seed-view.mjs), not by
   * the window scorer -- docs/seed-434533485056755.md shows the scorer's
   * favourite column on this seed sitting under a closed canopy with 37 of 81
   * columns roofed. From here: open sky, eight biomes reachable by an
   * unobstructed ray, 143 blocks of visible relief.
   *
   * surfaceY 111 is the grass block at world (-48, 48) plus one. Checked by
   * scripts/terrain/verify.mjs check 4 rather than trusted, for the same
   * reason the Nether's 75 is.
   */
  mountains: { size: 256, originX: 191, originZ: 48, surfaceY: 111, drop: 1 },
}

/** The overworld's width. Kept as an export because src/dimensions.js sizes
 *  the generated superflat with it; it is WORLDS.overworld.size and nothing
 *  else may assume it describes the world you are standing in. */
export const PATCH_SIZE = WORLDS.overworld.size

/*
 * Where the patch sits in world coordinates.
 *
 * The patch's own indices run 0..127; world coordinates are those minus this
 * origin, so the world runs -87..40 on x and -56..71 on z. Deliberately NOT
 * symmetric, and the asymmetry is asserted in test/25-orientation.spec.js
 * because a symmetric-island mental model is what gets this wrong.
 *
 * THESE NUMBERS ARE NOW INHERITED RATHER THAN DERIVED, and that is worth
 * being honest about. They came from scripts/terrain/scan.mjs, which scored
 * every column of the imported overworld and picked the best spawn -- grass,
 * two blocks of headroom, 40 blocks clear of every edge, four biomes and a
 * peak visible from it -- and then extract.mjs's X mirror moved it from index
 * 40 to index 87. None of that reasoning survives into a flat world, where
 * every column is the same column.
 *
 * KEPT ANYWAY, on purpose. The Nether is still that same imported patch and
 * is still pinned to this origin, so moving it would put the two dimensions
 * out of register and break the 1:1 portal mapping src/dimensions.js argues
 * for at length. And every "look at the block under your feet" test in the
 * suite is written around spawn being (0, 0), which is a property this
 * preserves for free. A generated world could be centred -- MIN_X = -64,
 * MAX_X = 63 -- and the only thing that would buy is tidier numbers.
 */

/**
 * The y a player stands on: topmost terrain block at SURFACE_Y - 1, feet at
 * SURFACE_Y. On a flat world that is true EVERYWHERE, not just at spawn --
 * which is the whole request.
 *
 * WHY STILL 136, when generated terrain could stand at any height and there
 * is no longer a dark-forest floor to match. Twelve spec files IMPORT this
 * rather than hardcoding a number, which is the single reason swapping the
 * world out is a day and not a week -- but the suite is not the argument,
 * because those twelve would follow any value. The argument is the things
 * that would NOT follow: test/helpers/world.js keeps its own copy (it is a
 * separate module graph from src/), and several specs that carry literal
 * y-coordinates in a comment or a fixture. Keeping 136 makes all of that a
 * no-op.
 *
 * Nothing about 136 is load-bearing beyond that. It is high enough that the
 * four blocks below it are comfortably above the void, and low enough that
 * the build ceiling (see CEILING_Y in src/dimensions.js) is inside noa's
 * vertical chunk range from the ground.
 */
export const SURFACE_Y = WORLDS.overworld.surfaceY

export const SPAWN = [0.5, SURFACE_Y + 2, 0.5]

/*
 * The Nether's spawn height, as chosen by scripts/terrain/nether.mjs's own
 * rule -- the lowest standable floor above the bedrock slab, six blocks of
 * headroom, no lava within three. That rule is written out in full there and
 * is not repeated here; what matters at this end is that the answer is a
 * CONSTANT and not a scan.
 *
 * Hardcoded rather than read from nether.json, and that is a real trade. The
 * manifest is fetched by nobody at runtime -- loadTerrain reads .bin only --
 * and adding a second fetch to the boot path to learn one integer would put
 * a network round trip in front of the world appearing. The integer is
 * checked instead: scripts/terrain/verify.mjs's check 4 asserts the asset has
 * a solid floor under this y and six blocks of air above it, so the constant
 * going stale fails a verify rather than dropping a visitor inside a rock.
 *
 * X and Z are 0.5 in both dimensions because both patches are pinned to the
 * same origin -- see the patch corner note in scripts/terrain/nether.mjs. So
 * going to the Nether moves you in y alone, which is as close to a portal as
 * a command gets.
 */
export const NETHER_SURFACE_Y = WORLDS.nether.surfaceY

export const NETHER_SPAWN = [0.5, NETHER_SURFACE_Y + 1, 0.5]

/*
 * Void death.
 *
 * The old island floated in open void and this sat just under its bedrock at
 * y=-60, so walking off an edge killed you. The imported patch had bedrock at
 * y=-64 running up to y=-60 and BARRIER walls on all four sides, so it moved
 * to -70: still real, still exercised by /tp, no longer reachable on foot.
 *
 * NOT MOVED for the superflat world, even though the overworld's floor is now
 * the bedrock layer just under SURFACE_Y and -70 is two hundred blocks below
 * that. It is tempting to derive this from the floor so a /tp into the void
 * kills promptly instead of after a long silent fall -- and it is wrong,
 * because VOID_Y is ONE constant for ALL dimensions and the Nether's encoded
 * range is y=0..127. Any value tied to the overworld's floor at 132 sits
 * INSIDE the Nether, so flying near its roof would kill you. A per-dimension
 * void floor is the real fix and it belongs to whoever next owns respawn.js.
 */
export const VOID_Y = -70

/* ---------------- the data ---------------- */

/*
 * Module state, deliberately. The alternative -- threading a `patch` argument
 * through getVoxelID -- would have changed the signature that noa's chunk
 * callback, respawn.js and thirteen spec files are written against, to express
 * something that is true exactly once per page load.
 */
let patch = null

/*
 * Every loaded dimension, by name, and which one getVoxelID currently answers
 * for. `patch` above is a cache of `patches.get(current)` rather than a
 * second source of truth: it is read on every voxel of every chunk -- six
 * million lookups for one world -- and a Map.get in that path is a cost paid
 * for nothing, since it can only change when setDimension is called.
 *
 * WHY A SECOND SLOT AT ALL, when the file's own header argues for one.
 *
 * The header's argument was against threading a `patch` ARGUMENT through
 * getVoxelID, and it still stands: the signature is what noa's chunk
 * callback, respawn.js and thirteen spec files are written against. This
 * keeps that signature exactly. What changed is the claim underneath it --
 * "something that is true exactly once per page load" -- which a second
 * dimension makes false.
 *
 * PURITY, restated a third time, because this is the line where it could
 * have been lost. getVoxelID is no longer pure in the plain sense: the same
 * (x, y, z) answers netherrack after setDimension('nether') and grass before
 * it. What it is instead is pure PER DIMENSION, and that is the property noa
 * actually needs -- because noa keys its chunk cache on `noa.worldName` and
 * throws away in-flight chunk data whose worldName no longer matches (see
 * lib/world.js setChunkData). So the contract is: whoever moves this slot
 * must move noa.worldName in the same breath, and src/dimensions.js is the
 * only caller that does. Call setDimension from anywhere else and you get a
 * chunk of the Nether cached under the overworld's name, which is exactly the
 * failure the old comment was guarding against.
 */
const patches = new Map()
let current = 'overworld'

/*
 * Palette index -> engine block id, rebuilt whenever a different `ids` table
 * is passed in. There is only ever one in practice; the cache key exists so
 * that a second Engine in the same page (tests have done this) can't silently
 * read the first one's ids.
 */
let idTable = null
let idTableFor = null

/**
 * Keys in the patch palette with no block in blocks.js. Should stay empty.
 *
 * It genuinely cannot be non-empty for a generated world -- flatworld.js
 * writes BLOCK_TYPES keys directly -- but it is still checked for one,
 * because a preset with a typo in it is exactly the mistake that would
 * otherwise render as a hole in the ground rather than as an error.
 */
const missing = new Set()

/*
 * Registering a world, shared by both entry points below.
 *
 * LOADING IS NOT ENTERING. A second dimension is prepared while you are
 * standing in the first one, and swapping the world out from under noa at the
 * moment a fetch resolves would be a change nobody asked for at a time nobody
 * chose. setDimension is the only thing that moves the slot -- the sole
 * exception being the dimension you are already in, which is how the
 * overworld gets installed at boot without a second call.
 */
function install(name, world, source) {
  /*
   * The geometry is stamped ONTO the world object, not looked up on every
   * voxel. getVoxelID runs 21 million times to build this patch once; a
   * WORLDS[current] lookup in there is a property chain walked for nothing,
   * since the answer can only change when setDimension does.
   *
   * A world with no row is a hard error rather than a default, because the
   * failure it prevents is silent: an unknown world would fall back to the
   * overworld's origin, render a perfectly plausible landscape, and put spawn
   * 87 blocks from where the manifest says it is.
   */
  const g = WORLDS[name]
  if (!g) throw new Error(`no geometry for world ${JSON.stringify(name)} -- add a row to WORLDS`)
  if (world.width !== g.size || world.depth !== g.size) {
    throw new Error(`world ${name} is ${world.width}x${world.depth}, `
      + `but WORLDS says ${g.size}x${g.size}`)
  }
  world.source = source
  world.minX = -g.originX
  world.minZ = -g.originZ
  patches.set(name, world)
  if (name === current) { patch = world; idTable = null; idTableFor = null }
  return world
}

/**
 * Fetch and decode an asset dimension, and make it available.
 *
 * THE HARD GATE. This throws rather than degrading, and must complete before
 * any chunk of this dimension is requested. noa asks for chunks within a tick
 * of a worldName change and a chunk answered once is cached forever, so there
 * is no "load it later" that does not also mean "invalidate and re-mesh
 * everything" -- and, worse, an answer of air-now-stone-later is exactly the
 * purity violation the header argues everything else rests on.
 *
 * ONLY THE NETHER TAKES THIS PATH NOW. It used to be the boot path for the
 * whole game, which is why main.js's top-level await was written around it.
 * A failed fetch here is now a failed `/dimension nether`, reported to the
 * player by src/dimensions.js, rather than a blank page.
 */
export async function loadTerrain(url, name) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`terrain: ${res.status} ${res.statusText} for ${url}`)
  return install(name, decode(new Uint8Array(await res.arrayBuffer())), 'imported')
}

/**
 * Build a generated dimension, and make it available.
 *
 * @param build a zero-argument thunk returning a world in decode()'s shape --
 *   in practice `() => flatPatch({...})` from a row in src/dimensions.js.
 *
 * SYNCHRONOUS, and that is the entire difference that matters. There is no
 * promise to await, nothing to 404, and no window in which getVoxelID could
 * answer air for a world that is about to be stone. The thunk is called HERE
 * rather than in dimensions.js so that a dimension row stays data -- it names
 * how to build the world, it does not build it, and it is never called for a
 * dimension nobody visits.
 */
export function generateTerrain(build, name) {
  return install(name, build(), 'generated')
}

/** Has this dimension's asset been fetched yet? */
export const isLoaded = (name) => patches.has(name)

/** Which dimension getVoxelID is currently answering for. */
export const currentDimension = () => current

/**
 * Point the world at a different loaded dimension.
 *
 * Callers MUST set noa.worldName to the same string, or noa will serve cached
 * chunks of the old world beside fresh chunks of the new one. See the note on
 * `patches` above; src/dimensions.js does both together and is the only place
 * that should.
 */
export function setDimension(name) {
  const next = patches.get(name)
  if (!next) throw new Error(`setDimension(${JSON.stringify(name)}): not loaded`)
  current = name
  patch = next
  // The palette is per-dimension, so the cached palette-index -> block-id
  // table is too. Forgetting this is the subtle version of the bug: index 2
  // is netherrack in one patch and deepslate in the other, so the world would
  // render as plausible garbage rather than as an error.
  idTable = null
  idTableFor = null
  return next
}

/** For tests and the console: what got loaded, or null. */
export function terrainInfo() {
  if (!patch) return null
  return {
    dimension: current,
    /* 'generated' or 'imported'. Reported because it is the one thing about
     * this world you cannot tell by looking at the numbers, and because it is
     * the answer to "does this build ship Mojang generator output". */
    source: patch.source,
    width: patch.width, depth: patch.depth,
    yMin: patch.yMin, yTop: patch.yTop,
    palette: patch.palette.length,
    originX: -patch.minX, originZ: -patch.minZ,
    missing: [...missing],
  }
}

/* ---------------- the edges ---------------- */

/**
 * World bounds, in world coordinates, for any world -- loaded or not.
 *
 * A FUNCTION OF A NAME now, where it used to be four exported constants
 * (MIN_X, MAX_X, MIN_Z, MAX_Z). Those constants described the overworld and
 * were read as describing "the world", which was the same sentence until the
 * mountain patch made it two. Nothing outside this file and
 * scripts/terrain/verify.mjs imported them, which is why this is a rename
 * rather than a migration.
 *
 * Takes a NAME rather than reading the current patch, because the verifier's
 * job is to check an asset that is not loaded and never will be -- it runs in
 * node with no fetch and no Engine. Defaulting to the current world keeps the
 * in-game caller honest at the same time.
 *
 * @param name a key of WORLDS; defaults to the world getVoxelID answers for.
 */
export function bounds(name = current) {
  const g = WORLDS[name]
  if (!g) throw new Error(`unknown world ${JSON.stringify(name)}`)
  return {
    minX: -g.originX, maxX: g.size - g.originX - 1,
    minZ: -g.originZ, maxZ: g.size - g.originZ - 1,
  }
}

/** Where a world puts you when you arrive in it. Centre of the spawn column,
 *  feet on its floor -- so it is (0.5, _, 0.5) in every world by construction,
 *  because every world's origin IS its spawn column. */
export const spawnFor = (name) => {
  const g = WORLDS[name]
  if (!g) throw new Error(`unknown world ${JSON.stringify(name)}`)
  return [0.5, g.surfaceY + g.drop, 0.5]
}

/*
 * The barrier wall.
 *
 * Minecraft's barrier: solid, unbreakable, invisible. Registered in blocks.js
 * with `opaque: false` and NO material, which is not a detail -- see the long
 * note there. It stands in every column outside the patch, from the world
 * floor up to the top of the encoded range.
 *
 * Why a wall at all, when the old world's whole first experience was falling
 * off the edge: an 80x80 island in void reads as a thing you are standing ON.
 * A 128x128 window cut out of a real world does not -- it has a coastline, a
 * mountain and four biomes running off the edges, and walking to the edge of
 * that and dropping into nothing reads as a bug rather than as a design. The
 * invisible wall is the same lie Minecraft's own world border tells.
 *
 * The top of the wall is the top of the encoded data, not infinity, because
 * creative flight above it should feel like leaving the world rather than
 * scraping along glass.
 *
 * BOTH NUMBERS COME FROM THE PATCH rather than from constants here, and that
 * is now doing real work: the Nether's range is 0..127 and the flat
 * overworld's is 132..200 (see CEILING_Y in src/dimensions.js). When this was
 * written the overworld was an import whose range happened to be -64..185 and
 * deriving the wall changed nothing; the same three lines survived a change
 * of world generator without being looked at, which is the argument.
 *
 * A constant here would have quietly left the flat world with a wall running
 * from -64 -- two hundred blocks of invisible barrier under a floor nobody
 * can reach -- and a gap above 185 you could fly out of.
 */
const barrierBottom = () => patch.yMin
const barrierTop = () => patch.yTop

/* ---------------- the lookup ---------------- */

function buildIdTable(ids) {
  missing.clear()
  idTable = new Uint16Array(patch.palette.length)
  patch.palette.forEach((key, i) => {
    if (key === 'air') { idTable[i] = 0; return }
    const id = ids[key]
    if (id === undefined) { missing.add(key); idTable[i] = 0; return }
    idTable[i] = id
  })
  idTableFor = ids
}

/**
 * @returns the block id at a world coordinate, or 0 for air.
 *
 * Pure: same coordinate, same answer, every time, in any order, on any worker.
 */
export function getVoxelID(x, y, z, ids) {
  // Before a dimension has been installed this would answer air for the whole
  // world, and noa would cache that. Better to be loud: an engine built too
  // early is a bug in boot order, not a transient.
  if (!patch) throw new Error('getVoxelID before the world was built -- see main.js')
  if (ids !== idTableFor) buildIdTable(ids)

  /* patch.minX, not a module constant: the three worlds are 128 and 256
   * blocks wide and pinned to two different corners. Stamped on at install
   * so this stays two subtractions. */
  const px = x - patch.minX
  const pz = z - patch.minZ
  if (px < 0 || px >= patch.width || pz < 0 || pz >= patch.depth) {
    return (y >= barrierBottom() && y <= barrierTop()) ? ids.barrier : 0
  }
  if (y < patch.yMin || y > patch.yTop) return 0

  return idTable[patch.cols[pz * patch.width + px][y - patch.yMin]]
}
