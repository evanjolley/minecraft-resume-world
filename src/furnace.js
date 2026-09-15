import { smeltingResult, burnTicks } from './crafting.js'
import { stackMax, itemId } from './items.js'

/*
 * The furnace: three slots, two clocks, and a tick loop taken from vanilla.
 *
 * A SEPARATE FILE from inventory.js on purpose. A furnace is not a screen --
 * it burns whether or not anybody is looking at it, which is the one property
 * of the feature that people notice is missing -- so the model has to be able
 * to run with no DOM at all. inventory.js draws it; this is what it draws.
 *
 * THE TICK LOOP IS TileEntityFurnace.update, transcribed rather than
 * reinvented (MCP-919, net/minecraft/tileentity/TileEntityFurnace.java), and
 * four of its details are ones you would not write yourself:
 *
 *   1. The burn clock decrements FIRST, before anything else looks at it.
 *   2. Fuel is spent only when there is something to smelt. A furnace with a
 *      stack of coal and an empty input slot does not light -- the guard is
 *      `!isBurning() && canSmelt()`, and getting it wrong means a furnace
 *      that quietly eats a chest of coal overnight.
 *   3. The cook clock resets to 0 the instant smelting becomes impossible
 *      WHILE BURNING -- pull the input out at 190/200 and you have lost it.
 *   4. When the flame goes out instead, the cook clock does not reset: it
 *      DECAYS at 2 ticks per tick back toward zero. That is the arrow sliding
 *      backwards, and it is why a furnace that runs out of fuel halfway does
 *      not lose all its progress if you feed it again quickly.
 *
 * The two clocks are independent, which is what makes a plank's 300 ticks
 * smelt one item and leave 100 ticks of flame for the next one.
 */

/** Minecraft's tick, in milliseconds. 20 ticks a second, by definition. */
export const MS_PER_TICK = 50

/*
 * The three blocks, and the only thing that differs between them.
 *
 * "These devices operate at double speed, requiring only 5 seconds (100 ticks)
 * per item, consuming identical fuel quantities as regular furnaces"
 * (minecraft.wiki/w/Smelting). Identical fuel is the part worth stating: a
 * blast furnace does not burn coal faster, it gets twice as much out of it.
 *
 * NOT reproduced: the recipe-book split. Vanilla's blast furnace accepts only
 * `minecraft:blasting` recipes and the smoker only `minecraft:smoking`, so a
 * blast furnace cannot make glass and a smoker cannot smelt iron. Every recipe
 * here is a furnace recipe (there is no food in items.js, so the smoker's
 * whole menu is empty) -- splitting the table three ways would give the smoker
 * nothing to do and the blast furnace a list identical to the ores it already
 * has. Flagged rather than quietly done.
 */
export const FURNACE_KINDS = {
  furnace: { cookTicks: 200 },
  blast_furnace: { cookTicks: 100 },
  smoker: { cookTicks: 100 },
}

/** block id -> kind name, for the right-click that opens one. */
export const FURNACE_BLOCKS = new Map(
  Object.keys(FURNACE_KINDS).map(key => [itemId(key), key]))

/**
 * What a spent fuel leaves behind. Vanilla's Item.craftingRemainingItem, which
 * in the furnace has exactly one member: the lava bucket's empty bucket.
 *
 * A Map rather than a field on the FUELS rows in recipes.js, because a
 * remainder is not a property of the fuel -- the same lava bucket hands back
 * the same empty bucket in a crafting grid, where recipes.js would have to
 * read it too. One table, one owner; crafting.js can import it the day
 * remainders land there (its header already flags them as missing).
 */
export const FUEL_REMAINDER = new Map([
  [itemId('lava_bucket'), itemId('bucket')],
])

/** The three slots, by name, so nothing indexes them by a bare number. */
export const INPUT = 0, FUEL = 1, OUTPUT = 2

export function createFurnaceState(kind = 'furnace') {
  return {
    kind,
    /** null | { id, count }, in INPUT/FUEL/OUTPUT order. */
    slots: [null, null, null],
    /** Ticks of flame left, and what the current fuel item started at. */
    burn: 0,
    burnTotal: 0,
    /** Ticks into the current item, and how many it needs. */
    cook: 0,
    cookTotal: FURNACE_KINDS[kind].cookTicks,
  }
}

export const isLit = (f) => f.burn > 0

/**
 * AbstractFurnaceBlockEntity.canBurn: is there an input that smelts, and room
 * in the output for what it makes?
 *
 * The output check is the one people skip. A furnace with 64 iron ingots in
 * the output slot stops dead rather than voiding the next one -- and it stops
 * without spending fuel, because canSmelt is also the guard on lighting.
 */
export function canSmelt(f) {
  const input = f.slots[INPUT]
  if (!input) return false
  const result = smeltingResult(input.id)
  if (!result) return false
  const out = f.slots[OUTPUT]
  if (!out) return true
  if (out.id !== result) return false
  return out.count + 1 <= stackMax(result)
}

/** smeltItem: one in, one out. Every furnace recipe yields exactly one. */
function smeltOne(f) {
  const input = f.slots[INPUT]
  const result = smeltingResult(input.id)
  const out = f.slots[OUTPUT]
  if (out) out.count++
  else f.slots[OUTPUT] = { id: result, count: 1 }
  input.count--
  if (input.count <= 0) f.slots[INPUT] = null
}

/**
 * One Minecraft tick. Returns true if the lit state flipped, which is the
 * signal a block-state swap would hang off.
 *
 * @see the numbered notes at the top of this file -- every branch below is
 *      one of them.
 */
export function furnaceTick(f) {
  const wasLit = isLit(f)

  if (isLit(f)) f.burn--

  if (isLit(f) || (f.slots[FUEL] && f.slots[INPUT])) {
    if (!isLit(f) && canSmelt(f)) {
      const fuel = f.slots[FUEL]
      const ticks = burnTicks(fuel.id)
      if (ticks > 0) {
        f.burn = f.burnTotal = ticks
        /*
         * The fuel item is spent the moment it is LIT, not gradually.
         *
         * And the container item comes back. This was dead code when it was
         * written -- there was no filled bucket in the world, so nothing had a
         * remainder -- and bucket.js has changed that: a lava bucket is 20000
         * ticks of fuel (FUELS in recipes.js) and leaves the EMPTY bucket
         * sitting in the fuel slot, which is vanilla's
         * `getCraftingRemainingItem` and the reason FurnaceFuelSlot lets a
         * plain bucket in at all.
         *
         * The remainder REPLACES the slot rather than being added to it,
         * because it can only ever appear when the stack hit zero: everything
         * with a remainder in vanilla is stacksTo(1).
         */
        fuel.count--
        const remainder = FUEL_REMAINDER.get(fuel.id)
        if (fuel.count <= 0) {
          f.slots[FUEL] = remainder ? { id: remainder, count: 1 } : null
        }
      }
    }

    if (isLit(f) && canSmelt(f)) {
      f.cook++
      if (f.cook >= f.cookTotal) {
        f.cook = 0
        f.cookTotal = FURNACE_KINDS[f.kind].cookTicks
        smeltOne(f)
      }
    } else {
      f.cook = 0
    }
  } else if (!isLit(f) && f.cook > 0) {
    // clamp(cookTime - 2, 0, totalCookTime): the arrow sliding back.
    f.cook = Math.max(0, Math.min(f.cook - 2, f.cookTotal))
  }

  return wasLit !== isLit(f)
}

/* ------------------------------------------------------------------ *
 * The world's furnaces.
 *
 * Keyed by position string rather than by a block entity, because this engine
 * has no block entities and no block metadata -- a voxel is an integer. The
 * consequence used to be stated here and left standing: state is keyed to a
 * COORDINATE, so breaking a furnace and putting a new one in the same hole
 * inherited the old one's contents.
 *
 * FIXED, and not here. authority.js now announces every block that stops
 * existing (onBlockDestroyed), because that is the one function every block
 * change in this codebase passes through; installFurnaceDrops at the bottom of
 * this file is the subscriber. The registry below gained exactly two methods
 * for it -- `peek` and `forget` -- and the rule about which coordinate holds
 * what did not change at all.
 * ------------------------------------------------------------------ */

const keyOf = ([x, y, z]) => `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`

export function createFurnaces() {
  const byPos = new Map()

  /** The furnace at this position, created on first use. */
  const at = (pos, kind = 'furnace') => {
    const k = keyOf(pos)
    let f = byPos.get(k)
    if (!f) { f = createFurnaceState(kind); byPos.set(k, f) }
    return f
  }

  /*
   * REAL TIME, not noa ticks. noa runs at 30 Hz (`noa.tickRate`) and
   * Minecraft's tick is 20 Hz, so counting engine ticks would make every
   * furnace 1.5x fast and every number in the tables above a lie. The
   * leftover milliseconds carry over rather than being dropped, which is what
   * stops a 33 ms frame quantising to zero ticks forever.
   */
  let carry = 0
  const advance = (dtMs) => {
    carry += dtMs
    let n = Math.floor(carry / MS_PER_TICK)
    carry -= n * MS_PER_TICK
    /*
     * Capped. A backgrounded tab hands back one enormous dt on return, and
     * without this the catch-up loop runs for minutes of wall clock inside
     * one frame. 200 ticks is ten seconds -- one item -- which is a visible
     * catch-up rather than a freeze. Vanilla's own answer is the same shape
     * (the server simply falls behind), and honest offline smelting would
     * need a saved timestamp, which is a save format this world has not got.
     */
    if (n > 200) n = 200
    for (let i = 0; i < n; i++) for (const f of byPos.values()) furnaceTick(f)
    return n
  }

  return {
    at,
    /**
     * The furnace at this position IF one exists. Deliberately separate from
     * `at`, which creates on first use: a destruction handler that used `at`
     * would conjure an empty furnace for every block ever broken and then
     * carefully throw it away.
     */
    peek: (pos) => byPos.get(keyOf(pos)) ?? null,
    /** Drop the state at this position. The coordinate is reusable after. */
    forget: (pos) => byPos.delete(keyOf(pos)),
    advance,
    /**
     * Run exactly n Minecraft ticks, skipping the millisecond conversion.
     *
     * A test seam, and an honest one: it is the same furnaceTick loop
     * `advance` runs, so a spec that steps 200 ticks is asserting the real
     * thing and not a parallel implementation. Ten seconds of wall clock per
     * smelt is not a thing a test suite can wait for.
     */
    step: (n) => { for (let i = 0; i < n; i++) for (const f of byPos.values()) furnaceTick(f) },
    /*
     * The two tables, re-exposed. A spec that asserts "coal burns for 1600
     * ticks" should be reading the table this world actually uses rather than
     * a number someone copied into the spec alongside it.
     */
    smeltingResult,
    burnTicks,
    /** Every furnace that exists, for the console and the test suite. */
    all: () => [...byPos.entries()].map(([pos, f]) => ({ pos, f })),
    count: () => byPos.size,
    /** Forget them all. The test suite needs this between specs; nothing in
     *  the game calls it, because a furnace is world state. */
    clear: () => byPos.clear(),
  }
}

/* ------------------------------------------------------------------ *
 * Breaking one.
 * ------------------------------------------------------------------ */

/**
 * Wire the registry to authority.js's destruction hook: a broken furnace
 * throws its three slots on the floor and forgets it ever existed.
 *
 * @param {object} furnaces  createFurnaces()
 * @param {object} authority createAuthority()
 * @param {(id: number, count: number, position: number[]) => void} pop
 *        itemEntity.js's popResource -- the same spawn a broken block's own
 *        drop uses, so the furnace's iron scatters exactly like the iron ore
 *        did. Injected rather than imported because this module has to stay
 *        runnable with no renderer (see the header), and the test suite drives
 *        it with a recording function.
 * @returns {() => void} unsubscribe
 */
export function installFurnaceDrops(furnaces, authority, pop) {
  return authority.onBlockDestroyed(({ id, position, cause }) => {
    if (!FURNACE_BLOCKS.has(id)) return
    const f = furnaces.peek(position)
    if (!f) return

    /*
     * FORGOTTEN EITHER WAY, dropped only on a break.
     *
     * That split is vanilla's: Block.playerWillDestroy pops the container's
     * contents, while /setblock and /fill just remove the tile entity and the
     * items are gone. The forget has to happen in BOTH cases, because the bug
     * this whole hook exists for is the stale table -- a /setblock that left
     * the old contents behind would be the same haunted furnace with a
     * different cause.
     *
     * NOT gated on creative. Vanilla drops a container's contents in creative
     * too: the BLOCK is what creative skips (itemEntity.js already does that),
     * and the stuff inside it was never the block's to keep.
     */
    if (cause === 'break') {
      for (const slot of f.slots) {
        if (slot) pop(slot.id, slot.count, position)
      }
    }
    furnaces.forget(position)
  })
}
