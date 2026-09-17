/*
 * Two worlds, and the one call that moves between them.
 *
 * ------------------------------------------------------------------------
 * THE QUESTION THAT DECIDED WHETHER THIS FILE COULD EXIST
 *
 * src/island.js has said, at the top of loadTerrain, since the day the patch
 * landed: "a chunk answered once is cached by noa forever, so there is no
 * 'load it later' that does not also mean invalidate and re-mesh
 * everything." docs/FUTURE.md carries that forward as the one genuinely
 * unverified cost of a second dimension. It is worth writing down what
 * reading noa 0.33 actually turned up, because the answer is better than the
 * warning.
 *
 * **noa is already a multi-world engine.** `noa.worldName` is a public
 * property, initialised to 'default' in index.js, and lib/world.js's tick
 * watches it:
 *
 *     if (this._prevWorldName !== this.noa.worldName) {
 *         markAllChunksInvalid(this)
 *         this._chunkAddSearchFrom = 0
 *         processRemoveQueue(this)
 *     }
 *
 * Assigning a new string is the whole API. markAllChunksInvalid moves every
 * known chunk into the invalidated set and empties the add, remove and mesh
 * queues; the queue is then sorted by distance from the player, so the chunk
 * you are standing in comes back first and the far ones stream in behind it.
 * The engine re-emits `worldDataNeeded` for each, and because the chunk
 * callback reads island.js, the answers are the new dimension's.
 *
 * Two details make it clean rather than merely possible, and both are
 * load-bearing enough to name:
 *
 *   - The request id noa builds is `[i, j, k, worldName].join('|')`, and
 *     setChunkData drops any response whose worldName is no longer current.
 *     So a chunk request that was in flight across the switch cannot land in
 *     the new world. This is the race the island.js comment was really
 *     worried about, and noa already loses it on purpose.
 *
 *   - `invalidateVoxelsInAABB` exists too, and is the WRONG tool here. It
 *     invalidates a box of chunks in the current world -- the right call for
 *     "the server sent me updated blocks", which is what its doc comment
 *     says. Using it to swap a world would mean naming a box big enough to
 *     cover everything and would not touch the request-id guard above, so
 *     in-flight overworld chunks would arrive into the Nether. The worldName
 *     path is not a workaround for the absence of a swap API; it IS the swap
 *     API.
 *
 * What it costs is a full re-mesh of every loaded chunk, which is the same
 * work as walking into a fresh area, paid all at once. noa spreads it over
 * ticks with its own time budget (`maxProcessingPerTick`), so it is a second
 * or two of chunks popping in rather than a freeze.
 *
 * THE ONE RULE THIS BUYS, and it is the reason every dimension change goes
 * through this file: **noa.worldName and island.setDimension must move
 * together.** Move only the first and noa re-requests chunks that
 * island.js answers from the old patch. Move only the second and noa serves
 * its cache and nothing changes. Neither failure throws.
 * ------------------------------------------------------------------------
 *
 * PORTALS ARE NOW HERE -- in src/portals.js, installed at the bottom of this
 * file. What follows was the accounting written before they existed, kept
 * because every line of it turned out to be the spec, and because the one
 * item that was called a blocker was not one. Marked up with what happened.
 *
 * THE TEXTURE IS NOW SOLVED. src/terrainAnimation.js animates the terrain
 * atlas with a layer-remap uniform, and `nether_portal` is already in it: 32
 * frames, frametime 1, sitting on the alpha page at layers 63..94 as a
 * STANDALONE run -- frames with no material of their own, put there precisely
 * so the portal does not have to wait for a block to exist. `standaloneSlot()`
 * hands back the page, the layer and the page's material. That part is done
 * and costs the portal nothing.
 *
 * WHAT IS STILL MISSING, in the order it has to be built:
 *
 * 1. A BLOCK. `nether_portal` needs an entry in BLOCK_TYPES in src/blocks.js:
 *    an id, `all: 'nether_portal'`, `alpha: true` (the artwork's own alpha runs
 *    155-232), non-solid and non-opaque. It could be registered at runtime
 *    from here instead -- noa's registry does not care who calls it -- and it
 *    should NOT be, because block ids are save data and an id allocated
 *    outside the one table that assigns them is an id that collides the day
 *    someone adds a block. Obsidian is already there, id 28.
 *
 * 2. FRAME DETECTION, and the real rule, from the wiki rather than from
 *    memory: obsidian, 4x5 minimum and 23x23 maximum counting the frame, so
 *    an interior of 2x3 up to 21x21. CORNERS ARE NOT REQUIRED -- the game
 *    builds them, and a hand-built portal without them lights and works. The
 *    frame must stand in one vertical plane, on the X axis or the Z axis.
 *
 * 3. A DWELL. 80 game ticks (4 seconds) in survival, 1 tick in creative.
 *    Both confirmed; vanilla's `getPortalWaitTime` is the source of the
 *    asymmetry and this world already knows which gamemode it is in.
 *
 * 4. LIGHTING IT, which is the one that blocks everything else and is not a
 *    rendering problem at all. Filling a frame's interior with portal blocks
 *    is a world write, nothing outside src/authority.js may call
 *    `noa.setBlock`, and the only fill that authority exposes --
 *    `requestFill` -- is operator-gated because it backs /fill. So either a
 *    portal is something only an operator can light (defensible: Evan builds
 *    the world, visitors walk through it) or authority.js grows a narrow
 *    `requestLightPortal` that a guest may call and that can only ever write
 *    portal blocks into an interior detection has already validated. That is
 *    a permission decision, it belongs to whoever owns authority.js, and it
 *    is the reason none of 1-4 is started here.
 *
 *    -- AND IT WAS A FALSE DILEMMA. Both horns assume the only guest-usable
 *    write is a FILL. It is not: `requestBlockChange` with cause 'place' is
 *    already open to any guest whose gamemode permits building, is already
 *    the function a server will validate, and 6 to 441 of them is exactly
 *    what lighting a portal is. authority.js needed no change at all and was
 *    never edited. portals.js still names the operation
 *    `requestLightPortal` and still decorates authority with it, because the
 *    round-trip cost the note correctly identifies is real -- when
 *    multiplayer lands, that function's BODY becomes one message carrying the
 *    validated cell list, and nothing that calls it changes.
 *
 *    Item 1 is the only part that really did need a file this pass did not
 *    own. portals.js declares NETHER_PORTAL_ID = 700 and registers the block
 *    at runtime, with the exact BLOCK_TYPES row blocks.js should adopt in the
 *    comment above it. That is the compromise this paragraph warned about and
 *    it is marked as one.
 *
 * 5. NOT AVAILABLE, and worth saying rather than faking: A PORTAL DOES NOT
 *    GLOW. Vanilla's emits light level 11. This world has one directional
 *    light and an ambient term and no propagated block light whatsoever --
 *    the same absence the Nether's `level: 0.45` below is a workaround for.
 *    docs/lighting.md scopes a real light engine at two to four days. Until
 *    that exists a portal is a bright animated texture in an unlit room, and
 *    there is no cheap trick that makes it light the obsidian around it.
 *
 * THE DESTINATION MAPPING, which was the open design question, now has an
 * answer: ONE TO ONE, with vanilla's 16-block search radius and no
 * auto-building.
 *
 * Walk into a portal at (x, y, z) and you come out at (x, y, z) in the other
 * dimension -- after looking for an existing portal within 16 blocks to
 * arrive in, which is vanilla's own search radius and the one number in its
 * algorithm that still means anything when the scale factor is 1. If there
 * is no portal there, you arrive at that dimension's spawn, which this file
 * already has.
 *
 * REJECTED -- vanilla's 8:1 scale. It exists because the Nether is a
 * shortcut across a world that is effectively infinite. Both dimensions here
 * were the same 128x128 patch when this was written (the overworld is 256
 * now; see the section at the end of this comment, which is what that change
 * cost), so dividing by 8 collapses the entire island
 * into a 16x16 corner of the Nether and every portal on it lands within two
 * chunks of every other. The rule would still be vanilla and the result
 * would be nonsense.
 *
 * REJECTED -- a fixed pair of linked portals, hard-coded one per dimension.
 * The cheapest and most reliable option, and it makes the portal set dressing
 * rather than a mechanic: you could not build one, and both ends would have
 * to be authored into an imported terrain asset that nothing in this repo can
 * edit.
 *
 * 1:1 is also the only mapping that makes the two patches legible as the same
 * island. The resume point you were standing next to in the overworld is the
 * one you are standing next to in the Nether, which is the whole reason
 * FUTURE.md argued for the seam.
 *
 * WHERE claude-opus-5-1 SITS IN THAT SCHEME, written down rather than pinned
 * silently, because a fourth world showed up after the argument was settled.
 *
 * GEOMETRICALLY IT IS INSIDE IT, and for free. Its WORLDS row is the
 * overworld's row with a different spawn -- same 128 patch, same origin
 * column 87/56, same ground at 136 -- so a portal at (x, y, z) there is in
 * exact register with (x, y, z) in the Nether, which is the whole content of
 * the 1:1 mapping. Nothing had to be pinned; it inherited the register by
 * being the same cut of the same square, which is also why the builds still
 * fit in it.
 *
 * MECHANICALLY THE RETURN TRIP IS ASYMMETRIC, and that is a known edge rather
 * than an oversight. src/portals.js decides where a portal goes with one
 * line -- `dimensions.active === 'nether' ? 'overworld' : 'nether'` -- so
 * walking into a portal in claude-opus-5-1 correctly lands you in the Nether
 * at the same coordinates, and walking back lands you in the OVERWORLD at
 * those coordinates rather than in the world you left. Its `lit` register is
 * keyed by world name and grows a key for any name (`lit[dim] || (lit[dim] =
 * [])`), so nothing throws and no portal is forgotten; you simply come back
 * to the bare field instead of to the road.
 *
 * NOT FIXED HERE, deliberately. The fix is a "which overworld did I leave"
 * memory in portals.js, that file belongs to nobody this pass, and a portal
 * lit in a world that is now a museum is a thing the owner has to do on
 * purpose before the bug is reachable at all. Named so the next person finds
 * it written down instead of discovering it standing in an empty field.
 *
 * AND THEN THE OVERWORLD BECAME 256 AND HALF OF IT HAS NO NETHER UNDER IT.
 *
 * The 1:1 mapping above was argued when both dimensions were the same 128
 * square pinned to the same origin column. The overworld is now 256 blocks on
 * a side with its origin at 128/16 (see WORLDS in src/island.js for why it
 * had to grow and why the origin moved); the Nether is still the imported
 * 128 patch at 87/56. In world coordinates:
 *
 *     overworld   x -128..127   z  -16..239
 *     nether      x  -87..40    z  -56..71
 *
 * The Nether covers 128 x 88 of the overworld's 256 x 256 -- about 17% of it,
 * a rectangle sitting over the first third of the walk. Everything south of
 * world z = 71, and everything east of x = 40 or west of x = -87, maps to a
 * column that does not exist in the Nether.
 *
 * THE DECISION: KEEP 1:1, ACCEPT THE DEAD REGION, AND DO NOT GROW THE NETHER.
 * Three options were weighed and two were rejected on grounds worth keeping.
 *
 * REJECTED -- GROWING THE NETHER TO 256. It is the answer that makes the
 * table symmetrical and it is the one this repo is least able to ship. The
 * Nether is not generated, it is public/terrain/nether.bin: the output of
 * Mojang's world generator, cut by scripts/terrain/nether.mjs from region
 * files nobody has established may be republished -- DECISIONS.md #1 and the
 * FORBIDDEN note in scripts/check-deploy-assets.mjs. Re-cutting it four times
 * larger means four times as much of somebody else's terrain in the repo, and
 * it multiplies a 1.4MB-class asset by four on a boot path that
 * flatworld.js spent its whole existence getting off. A generated Nether is a
 * real answer and a different project: it is a new module, a new preset and a
 * biome, and it is FUTURE.md's, not this pass's.
 *
 * REJECTED -- RESCALING, so that overworld (x, z) maps to nether (x/2, z/2)
 * and the 256 folds onto the 128. It restores full coverage with two
 * divisions. It also silently halves every distance you know, so two portals
 * sixteen blocks apart in the overworld land on the SAME nether column and
 * the search radius picks whichever was lit first -- the exact nonsense the
 * 8:1 rejection above describes, at 2:1 and therefore harder to notice.
 *
 * WHAT MAKES ACCEPTING IT SAFE, and this was checked in src/portals.js rather
 * than assumed, because "a portal that drops you outside a world" is the
 * failure that matters: THE 1:1 COORDINATE IS NEVER USED AS A DESTINATION.
 * `destinationIn` searches the `lit` registry -- portals this module itself
 * wrote into that dimension -- for one within 16 blocks, and returns null if
 * there is none. Null means `enter()`'s own arrival stands, which is
 * `spawnFor(dim)`. So the mapping only ever selects between portals that
 * exist, each of which is by construction inside its own patch, and the
 * fallback is a spawn point. Build a portal at world (-120, 200) in the
 * overworld and you arrive at the Nether's spawn, not at a column 120 blocks
 * outside the Nether: out of register, never out of bounds. Nothing in
 * portals.js was changed to make that true; it was already true, and the
 * check is the reason this section can end here.
 *
 * WHAT A VISITOR ACTUALLY EXPERIENCES: portals built in the first third of
 * the walk -- Omaha through roughly the school chapter -- are in exact
 * register with the Nether and behave exactly as the argument above intends.
 * Portals built further south are one-way in the sense that matters: you get
 * there, you get back, you simply do not come back out where you went in
 * unless you lit a portal at the far end too. That is a smaller surprise than
 * either alternative buys.
 *
 * THE ASYMMETRY ABOVE IS UNCHANGED AND NOT MADE WORSE. portals.js still picks
 * its destination with `active === 'nether' ? 'overworld' : 'nether'`, so a
 * return trip lands in the overworld whichever overworld-ish world you left.
 * This pass added no second overworld and no new name to that branch.
 *
 * `mountains` is still outside the argument entirely -- different seed,
 * different size, different origin, no portal relationship with anything.
 */
import {
  loadTerrain, generateTerrain, setDimension as setIslandDimension, isLoaded,
  currentDimension, spawnFor, SURFACE_Y, PATCH_SIZE, WORLDS,
} from './island.js'
import { flatPatch, FLAT_PRESETS } from './flatworld.js'
/* Named here rather than left to flatPatch's default, so that the ONE fact
 * that tells the two generated worlds apart is visible in the table that
 * defines them. src/builds/index.js's own header calls this "where a reader
 * would most expect to find it" and left it as a one-line change; this is
 * that line. dimensions.js already pulls blocks.js and Babylon in behind it,
 * so the node-verifier argument that keeps this import out of island.js does
 * not apply here. */
import { stampBuilds } from './builds/index.js'
/* The overworld's own landscape, which is a DIFFERENT survey of a different
 * sized world -- see the second half of src/builds/plots.js. It is imported
 * here for the same reason stampBuilds is: `builds` is a field on the
 * dimension row, so the one fact that distinguishes two generated worlds is
 * visible in the table that defines them. */
import { stampLand } from './builds/land.js'
import { BLOCK_TYPES } from './blocks.js'
import { installPortals } from './portals.js'

/*
 * The build ceiling: the top of the generated world, and therefore the top of
 * the barrier wall island.js stands around it (barrierTop() reads patch.yTop).
 *
 * 64 blocks of headroom over the ground. The imported overworld's ceiling was
 * 185, which was its highest mountain plus eight and therefore only 49 above
 * spawn; a flat world has no mountain to clear, so the number has to be
 * argued rather than derived, and "as much build height as the ground is
 * flat" is the argument. The owner is here to build.
 *
 * NOT higher, and this is the constraint worth knowing: noa's vertical
 * chunkAddDistance is 3 chunks of 32, so standing at SURFACE_Y the engine
 * loads to SURFACE_Y + 96. A ceiling inside that is a ceiling you can see the
 * top of; a ceiling above it is an invisible wall in unloaded space, which is
 * how you get a player stuck against nothing.
 */
const CEILING_Y = SURFACE_Y + 64

/**
 * What a world is, in this build: a source, a spawn, a sky and a fog.
 *
 * Deliberately data rather than a class hierarchy. Everything that differs
 * between the worlds is a value in this table, which is the test of whether
 * the seam was cut in the right place. The old comment ended "a third entry
 * here is an interior, a hub, or a room per resume point, with no new code",
 * and `mountains` is the first cash of that cheque -- it is a row, an npm
 * script, and a WORLDS row in island.js, and nothing in the switch itself
 * knows it exists.
 *
 * WHAT A ROW CARRIES, and what deliberately moved OUT of it:
 *
 *   name, id          identity. `id` is the Minecraft dimension it is a cut
 *                     of, which is not the same thing as the world's name --
 *                     `mountains` is an overworld.
 *   generate | asset  EXACTLY ONE. A `generate` thunk is compiled on the
 *                     spot; an `asset` URL is fetched on first entry. This is
 *                     the only distinction anything downstream branches on.
 *   sky, fog          presentation. null sky means the normal one.
 *
 * The SPAWN is no longer a value in this table -- it is `spawnFor(name)`, read
 * out of island.js's WORLDS. Geometry (how wide the patch is, which asset
 * column is world origin, where the ground is) belongs with the lookup that
 * uses it, and the verifier has to be able to read it in node without
 * dragging Babylon in behind it. A row that carried a spawn AND a WORLDS row
 * that carried an origin would be two places to state one fact.
 *
 * WHAT A THIRD WORLD COSTS, now that there is one: this row, an island.js
 * WORLDS row, an npm script to build the asset, and a verify.mjs row. No
 * branch anywhere.
 */
export const DIMENSIONS = {
  overworld: {
    name: 'overworld',
    id: 'minecraft:overworld',
    /*
     * GENERATED, not fetched -- this row used to read
     * `asset: '/terrain/terrain.bin'` and that 404KB-gzipped file is why.
     *
     * A THUNK rather than a compiled world, so that a dimension nobody visits
     * costs nothing to declare, and so the table stays a table: it says how to
     * build the world, it does not hold one. island.js calls it exactly once,
     * through generateTerrain.
     *
     * THIS IS THE SWAP POINT. The owner weighed a plains generator and chose
     * superflat "for now". Plains is a new module exporting a function of the
     * same shape and this one line pointing at it -- nothing in island.js,
     * main.js or the barrier changes, because all any of them know is that
     * something handed them 128x128 columns of block ids.
     */
    generate: () => flatPatch({
      preset: FLAT_PRESETS.classic,
      width: PATCH_SIZE, depth: PATCH_SIZE,
      surfaceY: SURFACE_Y, ceilingY: CEILING_Y,
      /*
       * AND A LANDSCAPE ON IT, which is what this line used to say `null` for.
       *
       * The bare superflat was the right answer for one brief -- "the owner's
       * world to build in" -- and the brief changed: a winding path through a
       * living landscape, a river with a bridge, and seven plots sketched and
       * left empty for him to build in. The plots are still bare ground. What
       * is around them is not.
       *
       * `stampLand`, not `stampBuilds`. They are two surveys of two different
       * worlds and neither function will touch the other's: each checks the
       * patch size and the ground height it was written against and throws
       * on anything else, which is what stops this row and the archive's from
       * being swapped by a copy-paste.
       */
      builds: stampLand,
    }),
    /* null means "the normal sky": sun, moon, clouds, day cycle. */
    sky: null,
    fog: { density: 0 },
  },
  /*
   * THE WORLD THE MODEL BUILT, kept under its own name.
   *
   * Eight stages of a life down one road -- Omaha, Harvard, Perplexity,
   * Arize, Bilibili, No Logo, Patronus, and a parkour course in San Francisco
   * -- stamped into a superflat by src/builds/. It was the overworld for one
   * day. The owner's verdict was "interesting but not what I am going to go
   * with", and the ask was to save it the way `mountains` is saved rather
   * than delete it. `/world claude-opus-5-1` is the whole of that.
   *
   * THE NAME IS A SERIES, see the WORLDS row in src/island.js for the
   * convention in full: claude-<model>-<n>, and the next one is -2.
   *
   * GENERATED, NOT CAPTURED, which is the difference between this row and
   * `mountains` and is worth being clear about. There is no
   * claude-opus-5-1.bin; the world is the same superflat compiled a second
   * time with stampBuilds run over it, so it costs a fetch of nothing and it
   * cannot go stale against the build files. What it DOES cost is the stamp
   * itself on first entry -- nine builds rewriting columns of a 128x128 patch
   * -- paid once, lazily, because `enter` only prepares a world somebody asks
   * for.
   *
   * REJECTED -- exporting it to an asset the way the mountains were, so that
   * the builds could be deleted afterwards. It makes the world immutable in
   * the wrong sense: the builds are source, they are still being fixed (three
   * commits today), and an asset would freeze whichever version happened to
   * be current when somebody remembered to run the script. It would also put
   * this world back in front of the licence and bundle-size arguments that
   * flatworld.js exists to have won.
   *
   * Same sky and fog as the overworld because it IS an overworld -- stated
   * rather than inherited, for the reason `mountains` states it.
   */
  'claude-opus-5-1': {
    name: 'claude-opus-5-1',
    id: 'minecraft:overworld',
    generate: () => flatPatch({
      preset: FLAT_PRESETS.classic,
      /*
       * ITS OWN SIZE, NOT PATCH_SIZE, and this line is the whole reason the
       * archive survived the overworld growing.
       *
       * Both generated rows used to read `width: PATCH_SIZE`, which was
       * correct exactly while both worlds were 128. PATCH_SIZE is
       * WORLDS.overworld.size; the day the overworld became 256 that line
       * would have regenerated this world at 256 as well, and every plot in
       * src/builds/plots.js -- patch indices into a 128 square -- would have
       * landed in the north-west quarter of a world four times too big, with
       * stampBuilds's own geometry check the only thing between that and a
       * silently wrong museum. The check would have caught it. Not relying on
       * the check is better: a world states its own width.
       */
      width: WORLDS['claude-opus-5-1'].size, depth: WORLDS['claude-opus-5-1'].size,
      surfaceY: SURFACE_Y, ceilingY: CEILING_Y,
      /* The default, said out loud. The two generated rows now differ in
       * exactly this field, which is the point of naming it in both. */
      builds: stampBuilds,
    }),
    sky: null,
    fog: { density: 0 },
  },
  /*
   * The mountain patch. A 256-block square of Java seed 434533485056755 --
   * see docs/seed-434533485056755.md for the survey and the commit that cut
   * it for the size table that chose 256 over 320 and 512.
   *
   * IMPORTED, so it 404s if nobody ran `npm run terrain:mountains`, and
   * FETCHED ON FIRST ENTRY rather than at boot. That is the whole reason the
   * generated superflat is still the world you land in: the asset is 1.4MB
   * gzipped, and a visitor who only wants to look at the resume should not
   * pay for a world they did not ask for. `enter` already lazy-loads -- see
   * the `isLoaded` check there -- so this needed no new machinery, only the
   * decision not to add `mountains` to the boot path in main.js.
   *
   * REJECTED -- making this the default world and generating the superflat on
   * demand. It is what the owner is most likely to want to look at, and it
   * puts a 1.4MB blocking fetch in front of a blank page again, which is the
   * exact gate src/main.js spent forty lines arguing its way out of at
   * b5e2255. One command is a cheaper price than that.
   *
   * Same sky and fog as the overworld because it IS an overworld; the row
   * says so explicitly rather than inheriting, because "inherits from
   * overworld" is a second concept in a table whose whole virtue is that it
   * has none.
   */
  mountains: {
    name: 'mountains',
    id: 'minecraft:overworld',
    asset: '/terrain/mountains.bin',
    sky: null,
    fog: { density: 0 },
  },
  nether: {
    name: 'nether',
    id: 'minecraft:the_nether',
    asset: '/terrain/nether.bin',
    sky: {
      /*
       * The Nether's sky colour and its fog colour are the same number in
       * vanilla, and both are taken from the biome rather than from the
       * dimension -- nether_wastes is 0x330808, a very dark red. This is that
       * value. It is barely visible through a bedrock roof, which is the
       * point: any gap you can see through should not be blue.
       */
      clearColor: [0.2, 0.03, 0.03],
      /*
       * The fixed light level, and the one number here that is a judgement
       * rather than a vanilla constant.
       *
       * Vanilla's Nether has ambient light 0.1 and then floods the place with
       * BLOCK light from lava and glowstone, which this engine does not model
       * -- there is one directional light and an ambient term, and no
       * propagated block light at all. Shipping 0.1 would be faithful to the
       * number and produce a black screen, because the light that makes the
       * Nether readable is precisely the part that is missing.
       *
       * 0.45 is chosen instead: dimmer than overworld noon (1.0) and
       * brighter than its night floor (0.18), so it reads as underground and
       * lit rather than as either outdoors or as a cave. Changed by eye
       * against a screenshot, which is the only instrument available for this
       * one.
       */
      level: 0.45,
    },
    fog: {
      /*
       * Flat red fog at every distance, which is the Nether's whole look and
       * the reason you cannot see the far wall of a cavern.
       *
       * Density, not a distance: the scene is EXP2 globally (see
       * underwater.js for why that is not negotiable) so fog falls off as
       * exp(-(d*density)^2). 0.035 puts the half-visible point around 24
       * blocks, which is close to vanilla's render-distance-independent
       * Nether fog and, more usefully, is short enough to hide the barrier
       * wall at the patch edge without being so short that you cannot see
       * the floor you are walking on.
       */
      density: 0.035,
      color: [0.2, 0.03, 0.03],
    },
  },
}

/**
 * Build a dimension's world and hand it to island.js. Idempotent-ish: callers
 * check `isLoaded` first.
 *
 * THE ONE PLACE generated and imported dimensions are told apart. A row with
 * a `generate` thunk is compiled on the spot; a row with an `asset` is
 * fetched, and only that path can fail. Everything downstream -- the lookup,
 * the barrier, the chunk callback, the specs -- sees one kind of world.
 *
 * Always returns a promise, including for the generated case where the work
 * is already done. Rejected the alternative of returning the world directly
 * and making callers check: `enter` and main.js would each need a branch on
 * the same distinction this function exists to absorb, and a synchronous
 * throw on one path and a rejection on the other is two error paths for one
 * failure.
 *
 * @param name a key of DIMENSIONS
 */
export function prepare(name) {
  const dim = DIMENSIONS[name]
  if (!dim) return Promise.reject(new Error(`unknown dimension ${JSON.stringify(name)}`))
  if (dim.generate) {
    // try/catch rather than an async function, so a broken preset is a
    // rejected promise like a 404 is, rather than a synchronous throw out of
    // a function whose siblings all return promises.
    try { return Promise.resolve(generateTerrain(dim.generate, name)) }
    catch (e) { return Promise.reject(e) }
  }
  return loadTerrain(dim.asset, name)
}

/**
 * Install the dimension switcher.
 *
 * @param noa the engine
 * @param deps.sky the object installSky returned -- needs setSkyless
 * @param deps.underwater the object installUnderwater returned -- needs
 *   setBaseFog. Named as a dependency rather than reached for through the
 *   scene, because "who owns scene.fogDensity" is a question with exactly one
 *   right answer and it is that module.
 * @param deps.teleport the same mover /tp uses, so arriving in a dimension
 *   clears fall damage the same way arriving anywhere else does. Passing the
 *   function rather than calling noa.ents.setPosition directly is what keeps
 *   this file out of the list of places that have to remember about
 *   clearFallTracking.
 */
export function installDimensions(noa, { sky, underwater, teleport, authority = null }) {
  let active = 'overworld'
  let pending = null

  /* Apply the presentation half. Separated from the world half only so that
   * it can be re-applied on entry without re-triggering a chunk rebuild. */
  const present = (dim) => {
    sky.setSkyless(dim.sky)
    underwater.setBaseFog(dim.fog)
  }
  present(DIMENSIONS.overworld)

  /**
   * Go to a dimension. Resolves once the world has been swapped; the chunks
   * stream in behind it.
   *
   * @returns {Promise<{ ok: boolean, error?: string, dimension?: string }>}
   *   the same shape authority.js uses, so commands.js can report it without
   *   knowing anything about dimensions.
   */
  async function enter(name) {
    const dim = DIMENSIONS[name]
    if (!dim) return { ok: false, error: `Unknown dimension '${name}'` }
    if (name === active) return { ok: false, error: `Already in the ${name}` }
    /*
     * One at a time. The asset fetch is hundreds of kilobytes and a visitor
     * who types /dimension twice in a second would otherwise get two swaps
     * racing, with noa.worldName and island.js's slot set by whichever
     * promise resolved last -- the exact split-brain the rule above forbids,
     * arrived at without anyone calling the wrong function.
     */
    if (pending) return { ok: false, error: 'Still loading the last one' }

    if (!isLoaded(name)) {
      pending = prepare(name)
      try { await pending } catch (e) {
        pending = null
        return { ok: false, error: `Could not load the ${name}: ${e.message}` }
      }
      pending = null
    }

    /*
     * The two lines that have to happen together, in this order.
     *
     * island.js first: noa's tick is what notices worldName changed, so
     * between the two assignments there is a window in which noa could ask
     * for a chunk. If island.js has already moved, that chunk is Nether data
     * filed under the overworld's name -- but it is immediately invalidated
     * by the worldName change on the very next tick, so it is thrown away.
     * The other order leaves overworld data filed under the Nether's name
     * AFTER the invalidation has run, which survives.
     */
    setIslandDimension(name)
    noa.worldName = name

    active = name
    present(dim)
    /* spawnFor, not dim.spawn: see the note on the table. The one thing that
     * must stay true is that this happens AFTER the two lines above, because
     * the mountain world's spawn is y=112 and the overworld's floor is at
     * 132 -- teleporting first would drop the player through terrain that is
     * still the old world's. */
    teleport(...spawnFor(name))
    return { ok: true, dimension: name, id: dim.id }
  }

  /*
   * Decorating authority rather than being reached for by commands.js,
   * exactly as weather.js does and for the same reason: commands.js is a
   * shell that parses arguments and asks authority for a decision, and it
   * should not grow a second kind of dependency. It also means /dimension
   * simply does not register in a build where nothing installed this, which
   * is better than a command that reports success over a no-op.
   */
  if (authority) {
    /*
     * Gated HERE as well as at the command, and not only at the command.
     * authority.js is the single trust boundary -- commands.js is a shell
     * that parses and prints -- so a check that lives only in the shell is a
     * check that a console user, a future keybind or a server message walks
     * straight past. Same reason requestTeleport refuses a non-op even though
     * /tp is already hidden from one.
     */
    authority.requestDimension = (name) =>
      authority.isOperator()
        ? enter(name)
        // authority.js's own wording for a command a non-op reached.
        : Promise.resolve({ ok: false, error: 'You do not have permission to use this command' })
    authority.dimensionNames = Object.keys(DIMENSIONS)
  }

  const self = {
    enter,
    get active() { return active },
    get activeId() { return DIMENSIONS[active].id },
    /* For the console and the specs: what island.js thinks, which should
     * always agree with `active` and is worth being able to check separately
     * precisely because the whole file exists to keep them in step. */
    get islandDimension() { return currentDimension() },
    get worldName() { return noa.worldName },
    names: Object.keys(DIMENSIONS),
    /* Which worlds have actually been built or fetched, as opposed to which
     * ones exist as rows. The difference IS the lazy load: a spec that wants
     * to prove booting costs no network has no other way to ask. */
    get loaded() { return Object.keys(DIMENSIONS).filter(isLoaded) },
  }

  /*
   * Portals, installed from here rather than from main.js.
   *
   * Not a matter of taste. main.js belongs to another agent this pass with
   * uncommitted work in it, and portals.js needs exactly two things main.js
   * would have handed it -- `self` and `teleport` -- both of which are in
   * scope right here. Installing from the module that owns the destination is
   * also the honest arrangement: a portal is a way of asking for
   * `dimensions.enter`, and nothing else in the game needs to know it exists.
   *
   * THE ONE UGLY LINE is `heldItemId`. Knowing whether the player is holding
   * flint and steel needs the inventory, which installDimensions is not
   * given, so it is read off the console handle main.js already publishes.
   * That is a real dependency pretending not to be one. The fix is one word
   * in main.js's installDimensions call -- `inventory,` in the deps object --
   * and it is left undone rather than taken, because taking it means
   * committing somebody else's half-finished file. It is injectable so that
   * the moment that line lands, this default is simply not used.
   */
  const obsidian = BLOCK_TYPES.find(b => b.key === 'obsidian').id
  const portals = installPortals(noa, {
    authority, dimensions: self, teleport, obsidian,
    heldItemId: () => globalThis.game?.inventory?.selectedStack?.()?.id ?? 0,
  })
  self.portals = portals

  return self
}
