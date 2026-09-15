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
 * PORTALS ARE NOT HERE, and this is the accounting rather than a promise.
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
 * are the same 128x128 patch, so dividing by 8 collapses the entire island
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
 */
import {
  loadTerrain, setDimension as setIslandDimension, isLoaded, currentDimension,
  SPAWN, NETHER_SPAWN,
} from './island.js'

/**
 * What a dimension is, in this build: an asset, a spawn, a sky and a fog.
 *
 * Deliberately data rather than a class hierarchy. Everything that differs
 * between the overworld and the Nether is a value in this table, which is
 * the test of whether the seam was cut in the right place -- and the reason
 * FUTURE.md argues this is worth building for the SEAM rather than for the
 * red rock. A third entry here is an interior, a hub, or a room per resume
 * point, with no new code.
 */
export const DIMENSIONS = {
  overworld: {
    name: 'overworld',
    id: 'minecraft:overworld',
    asset: '/terrain/terrain.bin',
    spawn: SPAWN,
    /* null means "the normal sky": sun, moon, clouds, day cycle. */
    sky: null,
    fog: { density: 0 },
  },
  nether: {
    name: 'nether',
    id: 'minecraft:the_nether',
    asset: '/terrain/nether.bin',
    spawn: NETHER_SPAWN,
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
      pending = loadTerrain(dim.asset, name)
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
    teleport(...dim.spawn)
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

  return {
    enter,
    get active() { return active },
    get activeId() { return DIMENSIONS[active].id },
    /* For the console and the specs: what island.js thinks, which should
     * always agree with `active` and is worth being able to check separately
     * precisely because the whole file exists to keep them in step. */
    get islandDimension() { return currentDimension() },
    get worldName() { return noa.worldName },
    names: Object.keys(DIMENSIONS),
  }
}
