/*
 * Nether portals: the route a visitor is meant to use.
 *
 * ------------------------------------------------------------------------
 * WHY THIS IS A SEPARATE FILE AND NOT MORE OF dimensions.js
 *
 * dimensions.js answers "what is a dimension and how do you move between
 * them". That question is done. This one answers "what does a player have to
 * BUILD to earn that move", which is a completely different kind of code --
 * a shape rule over voxels, a timer, and an item that does something. The
 * only thing the two share is the one call `dimensions.enter`.
 *
 * /dimension is operator-only and stays that way (see commands.js). That is
 * exactly why this exists: without a portal, a visitor has no Nether at all.
 *
 * ------------------------------------------------------------------------
 * THE FRAME RULE, from minecraft.wiki/w/Nether_portal rather than memory:
 *
 *   "The Nether portal is built as a vertical, rectangular frame of obsidian
 *    (4x5 minimum, 23x23 maximum)."
 *   "The four corners of the frame are not required, but portals created by
 *    the game always include them."
 *   "The biggest Nether portal size (23x23 exterior, 21x21 opening)"
 *   "A Nether portal cannot be built horizontally like an end portal."
 *
 * So: interior 2x3 minimum, 21x21 maximum, one vertical plane, on the X axis
 * or the Z axis, and CORNERS ARE NOT CHECKED. The corner exemption is not a
 * detail -- it is the difference between a rule that accepts a hand-built
 * portal and one that rejects it, and it is the single easiest thing to get
 * wrong by writing down what portals look like instead of what the game
 * checks. detectFrame() below therefore tests four runs of obsidian (a floor,
 * a ceiling, two sides) and never asks about the four cells where they meet.
 *
 * Activation: "Once a frame is constructed, it is activated by fire placed
 * inside the frame" -- flint and steel being the one a player has.
 *
 * The dwell: "standing in a Nether portal block for 80 game ticks (4 seconds)
 * in survival mode or 1 game tick (1/20 second) in creative mode." Same page.
 *
 * ------------------------------------------------------------------------
 * WHAT THIS FILE NEEDS FROM FILES IT DOES NOT OWN, and what it does instead.
 *
 * 1. blocks.js should own the portal block. It does not yet -- another agent
 *    holds that file this pass -- so NETHER_PORTAL_ID is declared here and
 *    registered at runtime. dimensions.js's own header says why that is
 *    wrong in the long run and it is right: block ids are save data, and an
 *    id handed out from outside the table that assigns them is an id that
 *    collides the day someone adds a block. 700 is chosen with a wide margin
 *    over the current maximum (654) precisely so the collision cannot happen
 *    before the id is moved. THE PATCH blocks.js WANTS is in the comment on
 *    NETHER_PORTAL_ID.
 *
 * 2. items.js already has flint_and_steel, and it already does nothing. It
 *    needs no change at all: `itemId('flint_and_steel')` is a read, and the
 *    right-click is bound here rather than routed through interact.js's
 *    `useBlock` hook -- which belongs to inventory.js -- because noa's input
 *    emitter takes as many listeners as you give it and interact.js's own
 *    alt-fire handler already exits without side effects for an item that
 *    places no block. Two listeners, no shared state, no file to borrow.
 *
 * 3. authority.js needs nothing. See requestLightPortal below.
 * ------------------------------------------------------------------------
 */
import { itemId } from './items.js'

/*
 * The portal block's id.
 *
 * When blocks.js is free, this row goes in BLOCK_TYPES and this constant
 * becomes `ids.nether_portal`:
 *
 *   { id: 700, key: 'nether_portal', name: 'Nether Portal',
 *     all: 'nether_portal', alpha: true, hardness: Infinity },
 *
 * ...plus `solid: false` handling, which BLOCK_TYPES expresses today only via
 * `fluid: true` (wrong -- you would swim in it) or `shape` (wrong -- it is a
 * full cube). That is the one genuinely new flag blocks.js would grow for
 * this: a non-solid, non-opaque, full-cube, walk-through block. registerOne()
 * below is what that flag has to produce.
 */
export const NETHER_PORTAL_ID = 700

/** The material name. Already in the atlas: terrainAnimation.js's STANDALONE
 *  table put 32 frames of it on the alpha page, and installTerrainAnimation
 *  registers this name against the page's ANIMATED material. Which is the
 *  whole reason the portal costs nothing to animate. */
export const PORTAL_MATERIAL = 'nether_portal'

/** Every number the wiki gave, in one place, so a spec can assert against the
 *  source rather than against a magic literal buried in a loop. */
export const PORTAL = {
  /* 4x5 exterior minimum -> 2x3 interior. */
  MIN_WIDTH: 2,
  MIN_HEIGHT: 3,
  /* 23x23 exterior maximum -> 21x21 interior. */
  MAX_WIDTH: 21,
  MAX_HEIGHT: 21,
  /** Ticks of standing in one before it moves you. Vanilla's getPortalWaitTime. */
  DWELL_SURVIVAL: 80,
  DWELL_CREATIVE: 1,
  /** Vanilla's own search radius for an existing portal to arrive in. */
  SEARCH_RADIUS: 16,
}

/** The two axes a portal plane can run along. A portal cannot be horizontal,
 *  so Y is not in this list and that is the whole of the orientation rule. */
const AXES = ['x', 'z']
const AXIS_INDEX = { x: 0, z: 2 }

/* ------------------------------------------------------------------ *
 * Frame detection
 * ------------------------------------------------------------------ */

/**
 * Is there a valid obsidian frame around this cell, and where is its interior?
 *
 * PURE over `read`, deliberately. It takes a (x, y, z) => id function rather
 * than noa, so a spec can build a frame in a plain object and check the rule
 * without booting a world, and so the day a server validates this it can run
 * the identical function over its own chunk store.
 *
 * `seed` is an INTERIOR cell -- the empty cell the fire would go in, which is
 * the cell a right-click on the frame's floor is adjacent to.
 *
 * @param {(x:number,y:number,z:number)=>number} read
 * @param {number[]} seed  [x, y, z], integers
 * @param {{obsidian:number, portal:number}} ids
 * @returns {{axis:'x'|'z', origin:number[], width:number, height:number,
 *            cells:number[][]} | null}
 */
export function detectFrame(read, seed, { obsidian, portal = NETHER_PORTAL_ID }) {
  /* Air, or a portal block that is already there -- relighting a lit portal
   * has to find the same frame, or /kill-ing it and walking back in breaks. */
  const empty = (x, y, z) => {
    const id = read(x, y, z)
    return id === 0 || id === portal
  }
  const isFrame = (x, y, z) => read(x, y, z) === obsidian

  for (const axis of AXES) {
    const a = AXIS_INDEX[axis]
    const at = (along, y) => {
      const p = [seed[0], y, seed[2]]
      p[a] = along
      return p
    }
    const cellEmpty = (along, y) => empty(...at(along, y))
    const cellFrame = (along, y) => isFrame(...at(along, y))

    if (!cellEmpty(seed[a], seed[1])) continue

    /*
     * Drop to the floor of the interior. Bounded by MAX_HEIGHT rather than
     * looped to the world floor: an unbounded descent down an open shaft is
     * the difference between "no portal here" and a hang.
     */
    let bottom = seed[1]
    let drop = 0
    while (drop < PORTAL.MAX_HEIGHT && cellEmpty(seed[a], bottom - 1)) { bottom--; drop++ }
    if (!cellFrame(seed[a], bottom - 1)) continue

    /* Width, outward from the seed along the axis, floor checked as we go.
     * A cell whose floor is missing ends the run exactly as an obsidian cell
     * does -- which is what makes an open-bottomed frame fail rather than
     * silently detect a narrower one. */
    let left = seed[a]
    while (seed[a] - left < PORTAL.MAX_WIDTH &&
           cellEmpty(left - 1, bottom) && cellFrame(left - 1, bottom - 1)) left--
    let right = seed[a]
    while (right - left + 1 <= PORTAL.MAX_WIDTH &&
           cellEmpty(right + 1, bottom) && cellFrame(right + 1, bottom - 1)) right++
    const width = right - left + 1
    if (width < PORTAL.MIN_WIDTH || width > PORTAL.MAX_WIDTH) continue
    /* The jambs, at the floor row. */
    if (!cellFrame(left - 1, bottom) || !cellFrame(right + 1, bottom)) continue

    /*
     * Height. A row counts while every interior cell is empty AND both jambs
     * are obsidian; the first row that is not is the ceiling's row, and every
     * cell of it must be obsidian.
     */
    let height = 0
    while (height < PORTAL.MAX_HEIGHT) {
      const y = bottom + height
      let ok = true
      for (let along = left; along <= right && ok; along++) {
        if (!cellEmpty(along, y)) ok = false
      }
      if (!ok || !cellFrame(left - 1, y) || !cellFrame(right + 1, y)) break
      height++
    }
    if (height < PORTAL.MIN_HEIGHT || height > PORTAL.MAX_HEIGHT) continue
    let capped = true
    for (let along = left; along <= right && capped; along++) {
      if (!cellFrame(along, bottom + height)) capped = false
    }
    if (!capped) continue

    /* NOTE what was never asked about: (left-1, bottom-1), (right+1, bottom-1),
     * (left-1, bottom+height), (right+1, bottom+height). The four corners. The
     * wiki says they are not required and they are not required here. */

    const cells = []
    for (let along = left; along <= right; along++) {
      for (let h = 0; h < height; h++) cells.push(at(along, bottom + h))
    }
    return { axis, origin: at(left, bottom), width, height, cells }
  }
  return null
}

/* ------------------------------------------------------------------ *
 * Install
 * ------------------------------------------------------------------ */

/**
 * Register the portal block, bind flint and steel, and run the dwell timer.
 *
 * @param noa
 * @param deps.authority the trust boundary. Every voxel this writes goes
 *   through requestBlockChange, so no rule about who may build is dodged.
 * @param deps.dimensions the object installDimensions returned.
 * @param deps.teleport the same mover /tp and the dimension switch use.
 * @param deps.obsidian the engine id of obsidian.
 * @param deps.heldItemId () => number. Injected so a spec can put flint and
 *   steel in the player's hand without driving the inventory UI.
 */
export function installPortals(noa, {
  authority, dimensions, teleport, obsidian, heldItemId,
}) {
  registerOne(noa)

  const FLINT_AND_STEEL = itemId('flint_and_steel')
  const read = (x, y, z) => noa.getBlock(x, y, z)

  /*
   * Every portal this session lit, per dimension, so that arriving has
   * somewhere to arrive. See the DESTINATION note below for why a registry
   * and not a block scan.
   */
  const lit = { overworld: [], nether: [] }

  /**
   * Light a frame. The one way a portal block ever enters the world.
   *
   * WHY THIS IS NOT A NEW METHOD ON authority.js. authority already has
   * exactly the right primitive: requestBlockChange with cause 'place', which
   * is guest-usable, gated on the gamemode's mayBuild, and is the single
   * function a server will validate. Filling 6 to 441 cells through it is 6
   * to 441 grants -- which authority.js's own note on requestFill says is not
   * a thing that can be made to work over a network. That is TRUE and it is
   * the reason this is a named method rather than a loop at the call site:
   * when the room lands, this function's body becomes one post carrying
   * `frame.cells`, and its callers do not change.
   *
   * The frame is detected BEFORE anything is written, and a refusal on any
   * cell stops the fill. A half-lit portal is not a state this can reach by
   * being interrupted, only by being refused mid-way -- and a refusal mid-way
   * means the gamemode changed under us, which is not a case worth a rollback.
   */
  async function requestLightPortal(seed) {
    const frame = detectFrame(read, seed.map(Math.floor), { obsidian, portal: NETHER_PORTAL_ID })
    if (!frame) return { ok: false, error: 'No valid portal frame here' }
    for (const [x, y, z] of frame.cells) {
      const res = await authority.requestBlockChange({
        id: NETHER_PORTAL_ID, position: [x, y, z], cause: 'place',
      })
      if (!res.ok) return res
    }
    remember(dimensions.active, frame)
    return { ok: true, frame }
  }

  const remember = (dim, frame) => {
    const list = lit[dim] || (lit[dim] = [])
    const key = frame.cells[0].join(',')
    if (!list.some(f => f.cells[0].join(',') === key)) list.push(frame)
  }

  /* ---- flint and steel ---- */

  /*
   * A second alt-fire listener, alongside interact.js's.
   *
   * Safe precisely because the two are disjoint by construction: interact.js
   * asks `itemPlaces(stack.id)` and returns without a side effect when the
   * answer is 0, and flint and steel's answer is 0 because it places no
   * block. Nothing is consumed, nothing is emitted, no order dependency.
   *
   * Sneak suppresses it for the same reason it suppresses using a crafting
   * table: sneak means "I meant the block, not the thing the block does".
   */
  noa.inputs.down.on('alt-fire', async () => {
    if (noa.inputs.state.sneak) return
    if (heldItemId() !== FLINT_AND_STEEL) return
    const target = noa.targetedBlock
    if (!target) return
    /* You strike the frame; the fire lands in the cell you struck TOWARDS. */
    await requestLightPortal(target.adjacent)
  })

  /* ---- the dwell ---- */

  /*
   * THE DESTINATION MAPPING: one to one, with vanilla's 16-block search.
   *
   * dimensions.js settled this and the argument is there in full. The short
   * version: both dimensions are the same 128x128 patch, so vanilla's 8:1
   * scale would fold the whole island into a 16x16 corner and every portal
   * would land beside every other. 1:1 keeps the two patches legible as the
   * same island, which is the entire reason the seam was cut.
   *
   * THE SEARCH IS OVER A REGISTRY, NOT OVER BLOCKS, and that is forced rather
   * than chosen. The destination's chunks are not resident until after the
   * switch, so there is nothing to scan at the moment the decision is made;
   * scanning after the switch would mean teleporting you to the spawn and
   * then teleporting you again a second later, which is worse than either
   * answer. `lit` is authoritative for this session because this module is
   * the only thing that ever writes a portal block.
   *
   * Nothing found within 16 blocks -> the destination's spawn, which
   * dimensions.enter already does on its own. REJECTED: building the far
   * portal for you, vanilla's actual fallback. It needs to carve out a
   * 4x5 pocket in terrain that authority would have to grant 20 breaks for,
   * in a dimension whose chunks have not loaded yet, and "you arrived
   * somewhere sensible" is the feature.
   */
  const destinationIn = (dim, [x, y, z]) => {
    let best = null
    let bestD = Infinity
    for (const frame of lit[dim] || []) {
      /* Bottom centre of the interior: where you stand, not where you float. */
      const a = AXIS_INDEX[frame.axis]
      const c = frame.origin.slice()
      c[a] += (frame.width - 1) / 2
      const d = Math.hypot(c[0] - x, c[1] - y, c[2] - z)
      if (d <= PORTAL.SEARCH_RADIUS && d < bestD) { best = c; bestD = d }
    }
    if (!best) return null
    return [best[0] + 0.5, best[1], best[2] + 0.5]
  }

  let dwell = 0
  /* Vanilla's "you just came out of one": no second trip until you step out
   * of the portal block you landed in. Without it you bounce between
   * dimensions forever, one round trip per dwell. */
  let arrived = false
  let travelling = false

  const inPortal = () => {
    const p = noa.ents.getPositionData(noa.playerEntity).position
    const [x, y, z] = [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])]
    return noa.getBlock(x, y, z) === NETHER_PORTAL_ID ||
           noa.getBlock(x, y + 1, z) === NETHER_PORTAL_ID
  }

  /** 80 ticks, or 1 in creative. Vanilla's getPortalWaitTime, and the one
   *  place this world's gamemode is allowed to change how long it takes. */
  const dwellTicks = () =>
    authority.gamemode === 'creative' ? PORTAL.DWELL_CREATIVE : PORTAL.DWELL_SURVIVAL

  async function travel() {
    travelling = true
    try {
      const to = dimensions.active === 'nether' ? 'overworld' : 'nether'
      const p = noa.ents.getPositionData(noa.playerEntity).position
      const here = [p[0], p[1], p[2]]
      const landing = destinationIn(to, here)
      const res = await dimensions.enter(to)
      if (!res.ok) return res
      /* enter() already put us at the destination's spawn. Only override it
       * when there is a real portal to arrive in. */
      if (landing) teleport(...landing)
      arrived = true
      dwell = 0
      return res
    } finally {
      travelling = false
    }
  }

  noa.on('tick', () => {
    if (travelling) return
    if (!inPortal()) { dwell = 0; arrived = false; return }
    if (arrived) return
    dwell++
    if (dwell >= dwellTicks()) travel()
  })

  /*
   * Decorating authority, the way dimensions.js and weather.js do: the rest
   * of the game asks the trust boundary, not this module.
   */
  if (authority) authority.requestLightPortal = requestLightPortal

  return {
    requestLightPortal,
    detect: (seed) => detectFrame(read, seed.map(Math.floor), { obsidian, portal: NETHER_PORTAL_ID }),
    id: NETHER_PORTAL_ID,
    /* For the console and the specs. `dwell` is the live timer, which is the
     * only way a test can prove the wait is being counted rather than skipped
     * by something that happens to take four seconds. */
    get dwell() { return dwell },
    get dwellRequired() { return dwellTicks() },
    get inPortal() { return inPortal() },
    get lit() { return lit },
    PORTAL,
  }
}

/**
 * Register the block with noa.
 *
 * `solid: false` is what lets you walk into it -- noa's sweep would otherwise
 * stop you at the face and the dwell timer would never start. `opaque: false`
 * so the obsidian behind it still draws its faces, and so noa's mesher does
 * not cull the world through it. NOT `fluid: true`, which would be the
 * shortest way to get a walk-through block and would also give it buoyancy
 * and viscosity: you would swim in a portal.
 *
 * The material name resolves because terrainAnimation.js registered it, on
 * the alpha page's ANIMATED material -- see PORTAL_MATERIAL. It is registered
 * unconditionally rather than probed for, because noa's registry has no
 * public "does this name exist" and its registerBlock lazily creates an
 * unknown one (registry.js:333) rather than throwing. So the failure mode in
 * a build with no portal frames is an untextured portal, not a broken boot,
 * and there is nothing useful to branch on.
 */
function registerOne(noa) {
  return noa.registry.registerBlock(NETHER_PORTAL_ID, {
    solid: false, opaque: false, material: PORTAL_MATERIAL,
  })
}
