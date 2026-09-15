import { test, expect } from './fixtures.js'
import {
  SURFACE_Y, HEADING, aim, getBlock, setBlock, waitTicks, useGamemode, targetedBlock,
  holdMouse,
} from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * Buckets, and what falls out of a furnace you break.
 *
 * Reported from play in one breath: "need to solve the furnace container
 * stuff? Breaking furnace should drop its contents on the ground like vanilla.
 * Need lava bucket to work, need water bucket as well." Two features and one
 * seam -- both are things that happen BECAUSE A BLOCK CHANGED, and both go
 * through authority.js.
 *
 * VANILLA IS THE SPEC, and the two rules worth naming up front because
 * everything below leans on them:
 *
 *   - An empty bucket picks up a SOURCE block and nothing else. Flowing fluid
 *     cannot be bucketed (BucketItem passes ClipContext.Fluid.SOURCE_ONLY to
 *     its raycast; minecraft.wiki/w/Bucket says the same in words). This is
 *     the rule that makes water finite, and it is the rule that stays correct
 *     now that fluids.js has flow-level block ids of its own.
 *   - A broken container drops its contents at the block, and the tile entity
 *     is gone. /setblock over one does NOT drop them -- it voids them.
 *
 * THESE TESTS DISCRIMINATE, and it was checked rather than hoped. Three
 * sabotages, all three caught, all three restored:
 *
 *   - src/bucket.js, `isSource` widened to `id >= WATER` -- which is exactly
 *     what a lazy is-it-fluid-ish check looks like. 'FLOWING water cannot be
 *     bucketed' failed with
 *       Expected: null
 *       Received: {"kind": "source", "id": 639, "position": [-3, 137, 0]}
 *     i.e. the bucket happily scooped a flow level.
 *   - src/furnace.js, the pop loop in installFurnaceDrops deleted. 'mining one
 *     by hand scatters the contents' failed with Expected 5, Received 0 raw
 *     iron on the floor.
 *   - src/authority.js, the announceDestroyed call removed, which is the hook
 *     itself. 'the coordinate is forgotten' failed with
 *       Expected: null
 *       Received: [[1016, 5], [1001, 2], [1003, 2]]
 *     which is the haunted furnace in the raw: a coordinate that was broken
 *     and rebuilt, still holding the last furnace's five raw iron.
 *
 * A test that cannot fail is a comment with a runtime.
 */

/** The rig 13-drops.spec.js established: a lone block at eye level, two and a
 *  half blocks east, aimed at flat. Outside pickup reach, inside dig reach. */
const TARGET = [-3, SURFACE_Y + 1, 0]
/** The cell the ray passes through last before it stops -- the face clicked,
 *  and where a poured source lands. */
const FACE = [-2, SURFACE_Y + 1, 0]

/*
 * Block ids, duplicated from src/blocks.js on purpose. Same bargain as ID in
 * helpers/world.js and as the table in 41-fluid-flow.spec.js: if someone
 * renumbers the palette these tests should fail loudly rather than quietly
 * follow along.
 *
 * `water_1` is a FLOW level, which is a separate block id from the source --
 * that separation is exactly what the source-only rule is asserted against.
 */
const ID = {
  air: 0, stone: 3, water: 636, lava: 637, water_1: 639,
  furnace: 0, // filled in beforeEach from the item table: furnaces are blocks
}

const itemId = (page, key) => page.evaluate(k => window.game.itemId(k), key)

/** Put a stack in hotbar slot 0 and hold it. */
const hold = (page, id, count = 1) => page.evaluate(([i, n]) => {
  const inv = window.game.inventory
  inv.slots.fill(null)
  inv.carried = null
  inv.slots[0] = n ? { id: i, count: n } : null
  inv.select(0)
  inv.emitChange()
}, [id, count])

const slot0 = (page) => page.evaluate(() => {
  const s = window.game.inventory.slots[0]
  return s ? { id: s.id, count: s.count } : null
})

const invTotal = (page, id) => page.evaluate((want) => window.game.inventory.slots
  .filter(s => s && s.id === want).reduce((n, s) => n + s.count, 0), id)

const floorTotal = (page, id) => page.evaluate((want) => window.game.drops.list
  .filter(d => d.id === want).reduce((n, d) => n + d.count, 0), id)

const clearFloor = (page) => page.evaluate(() => { window.game.drops.list.length = 0 })

/** Aim flat at TARGET, having put `id` there. */
async function aimAt(page, terrain, id) {
  await terrain.keep([-6, SURFACE_Y, -2], [0, SURFACE_Y + 3, 2])
  await setBlock(page, id, ...TARGET)
  await aim(page, { heading: HEADING.eastMinusX, pitch: 0 })
}

test.describe('buckets', () => {
  test.beforeEach(async ({ page }) => {
    // Survival, not the adventure mode this world defaults to: a bucket
    // removes a block and places one, and adventure refuses both -- which is
    // vanilla's answer too, and is asserted at the bottom of this describe.
    await useGamemode(page, 'survival')
    await clearFloor(page)
  })

  test('an empty bucket takes a water source and comes back full', async ({ page, terrain }) => {
    await aimAt(page, terrain, ID.water)
    await hold(page, await itemId(page, 'bucket'))

    const hit = await page.evaluate(() => window.game.buckets.fill())
    expect(hit).toMatchObject({ kind: 'source', position: TARGET })
    expect(await getBlock(page, ...TARGET)).toBe(ID.air)
    expect(await slot0(page)).toEqual({ id: await itemId(page, 'water_bucket'), count: 1 })
  })

  test('an empty bucket takes a lava source and comes back full', async ({ page, terrain }) => {
    await aimAt(page, terrain, ID.lava)
    await hold(page, await itemId(page, 'bucket'))

    await page.evaluate(() => window.game.buckets.fill())
    expect(await getBlock(page, ...TARGET)).toBe(ID.air)
    expect(await slot0(page)).toEqual({ id: await itemId(page, 'lava_bucket'), count: 1 })
  })

  test('FLOWING water cannot be bucketed -- only a source can', async ({ page, terrain }) => {
    /*
     * THE test in this file. A flow level is its own block id, so a bucket
     * that asked "is this fluid-ish" would happily scoop it and hand you an
     * infinite water supply; vanilla's SOURCE_ONLY clip context is why it
     * cannot. The block must be untouched and the bucket must still be empty.
     */
    await aimAt(page, terrain, ID.air)
    const bucket = await itemId(page, 'bucket')
    await hold(page, bucket)

    /*
     * The flow block is PLACED AND BUCKETED INSIDE ONE evaluate, which is the
     * only honest way to run this: an orphan flow level with no source
     * upstream drains on fluids.js's own schedule, a few ticks after it
     * appears. Placing it over CDP and then reaching back for a second call
     * lost that race every time -- the block was already air, the bucket
     * refused it for the wrong reason, and the test passed while proving
     * nothing. Nothing can tick between these three lines: `fill()` only ever
     * awaits the authority, and that is a microtask.
     */
    const out = await page.evaluate(async ([p, flow]) => {
      window.noa.setBlock(flow, p[0], p[1], p[2])
      const hit = await window.game.buckets.fill()
      return { hit, after: window.noa.getBlock(p[0], p[1], p[2]) }
    }, [TARGET, ID.water_1])
    expect(out.hit).toBe(null)
    expect(out.after).toBe(ID.water_1)
    expect(await slot0(page)).toEqual({ id: bucket, count: 1 })
    expect(await invTotal(page, await itemId(page, 'water_bucket'))).toBe(0)
  })

  test('a water bucket pours a source on the face you clicked', async ({ page, terrain }) => {
    await aimAt(page, terrain, ID.stone)
    expect(await targetedBlock(page)).toMatchObject({ position: TARGET })
    const bucket = await itemId(page, 'bucket')
    await hold(page, await itemId(page, 'water_bucket'))

    await page.evaluate(() => window.game.buckets.pour(window.game.buckets.WATER))
    // The face, not the block: the stone is still stone and the source is in
    // the air cell in front of it.
    expect(await getBlock(page, ...TARGET)).toBe(ID.stone)
    expect(await getBlock(page, ...FACE)).toBe(ID.water)
    expect(await slot0(page)).toEqual({ id: bucket, count: 1 })
    await shot(page, '45-bucket-pours-a-source')
  })

  test('a lava bucket pours lava the same way', async ({ page, terrain }) => {
    await aimAt(page, terrain, ID.stone)
    await hold(page, await itemId(page, 'lava_bucket'))
    await page.evaluate(() => window.game.buckets.pour(window.game.buckets.LAVA))
    expect(await getBlock(page, ...FACE)).toBe(ID.lava)
  })

  test('filling one out of a stack of empties keeps the other empties', async ({ page, terrain }) => {
    /*
     * ItemUtils.createFilledResult. An empty bucket stacks to 16, so filling
     * one has to shrink the stack and put the FILLED bucket somewhere else --
     * you are still holding the other two.
     */
    await aimAt(page, terrain, ID.water)
    const bucket = await itemId(page, 'bucket')
    await hold(page, bucket, 3)

    await page.evaluate(() => window.game.buckets.fill())
    expect(await slot0(page)).toEqual({ id: bucket, count: 2 })
    expect(await invTotal(page, await itemId(page, 'water_bucket'))).toBe(1)
  })

  test('creative pours the fluid and keeps the bucket', async ({ page, terrain }) => {
    /*
     * Abilities.instabuild, the same rule that stops a creative placement
     * eating the stack (interact.js) and a creative break dropping a block
     * (itemEntity.js). The WORLD still changes; your hand does not.
     */
    await useGamemode(page, 'creative')
    await aimAt(page, terrain, ID.stone)
    const filled = await itemId(page, 'water_bucket')
    await hold(page, filled)

    await page.evaluate(() => window.game.buckets.pour(window.game.buckets.WATER))
    expect(await getBlock(page, ...FACE)).toBe(ID.water)
    expect(await slot0(page)).toEqual({ id: filled, count: 1 })
  })

  test('right-clicking a furnace with a bucket opens the furnace, and pours nothing',
    async ({ page, terrain }) => {
      /*
       * Vanilla's precedence: USING a block beats using the item in your hand
       * unless you are sneaking. Here that falls out of an ordering rather
       * than a rule -- interact.js's alt-fire listener is registered first and
       * opens the screen, which takes the inputLock synchronously, and
       * bucket.js's listener sees the lock and stands down.
       *
       * Which is exactly the kind of thing that works until someone moves a
       * line in main.js, so it is asserted rather than trusted.
       */
      await aimAt(page, terrain, await itemId(page, 'furnace'))
      const filled = await itemId(page, 'water_bucket')
      await hold(page, filled)
      await waitTicks(page, 2)
      await holdMouse(page, 120, 'right')
      await waitTicks(page, 2)

      expect(await page.evaluate(() => window.game.inventoryScreen.current())).toBe('furnace')
      expect(await getBlock(page, ...FACE)).toBe(ID.air)
      expect(await slot0(page)).toEqual({ id: filled, count: 1 })
      await page.evaluate(() => window.game.inventoryScreen.setOpen(false))
    })

  test('adventure mode refuses both halves', async ({ page, terrain }) => {
    await useGamemode(page, 'adventure')
    await aimAt(page, terrain, ID.water)
    await hold(page, await itemId(page, 'bucket'))
    expect(await page.evaluate(() => window.game.buckets.fill())).toBe(null)
    expect(await getBlock(page, ...TARGET)).toBe(ID.water)
  })
})

/* ------------------------------------------------------------------ *
 * The furnace, and the coordinate it used to haunt.
 * ------------------------------------------------------------------ */

/** A furnace out of everyone's way, with three slots filled. */
const FPOS = [-3, SURFACE_Y + 1, 0]

const fill3 = (page, pos) => page.evaluate(([p]) => {
  const f = window.game.inventory.furnaces.at(p, 'furnace')
  const id = window.game.itemId
  f.slots[0] = { id: id('raw_iron'), count: 5 }
  f.slots[1] = { id: id('coal'), count: 3 }
  f.slots[2] = { id: id('iron_ingot'), count: 2 }
}, [pos])

const furnaceHere = (page, pos) => page.evaluate(([p]) => {
  const f = window.game.inventory.furnaces.peek(p)
  return f ? f.slots.map(s => (s ? [s.id, s.count] : null)) : null
}, [pos])

test.describe('a broken furnace drops what was inside it', () => {
  test.beforeEach(async ({ page }) => {
    await useGamemode(page, 'survival')
    await page.evaluate(() => {
      window.game.inventory.furnaces.clear()
      window.game.drops.list.length = 0
    })
  })

  test('breaking it throws all three slots on the floor', async ({ page, terrain }) => {
    const furnaceId = await itemId(page, 'furnace')
    await aimAt(page, terrain, furnaceId)
    await fill3(page, FPOS)
    // A pickaxe, because a furnace needs one to drop itself (items.js's tier
    // rules). Bare-handed, the block yields nothing and the assertion below
    // would be measuring the wrong thing.
    await hold(page, await itemId(page, 'iron_pickaxe'))

    // Through the authority, which is the one path a break takes. Mining it by
    // hand is the same call with a 3 second timer in front of it, and the
    // screenshot below is that version.
    await page.evaluate(([p]) => window.game.authority
      .requestBlockChange({ id: 0, position: p, cause: 'break' }), [FPOS])
    await waitTicks(page, 2)

    expect(await floorTotal(page, await itemId(page, 'raw_iron'))).toBe(5)
    expect(await floorTotal(page, await itemId(page, 'coal'))).toBe(3)
    expect(await floorTotal(page, await itemId(page, 'iron_ingot'))).toBe(2)
    // ...and the furnace block itself, which is itemEntity.js's drop rather
    // than this feature's. Both, or the hook has eaten one of them.
    expect(await floorTotal(page, furnaceId)).toBe(1)
  })

  test('the coordinate is forgotten, so a new furnace in the hole is empty',
    async ({ page, terrain }) => {
      await aimAt(page, terrain, await itemId(page, 'furnace'))
      await fill3(page, FPOS)
      expect(await furnaceHere(page, FPOS)).not.toBe(null)

      await page.evaluate(([p]) => window.game.authority
        .requestBlockChange({ id: 0, position: p, cause: 'break' }), [FPOS])
      await waitTicks(page, 2)

      // THE BUG THIS FEATURE EXISTS FOR. State is keyed by coordinate, so
      // without the hook the next furnace in this hole inherits five raw iron.
      expect(await furnaceHere(page, FPOS)).toBe(null)
      await setBlock(page, await itemId(page, 'furnace'), ...FPOS)
      expect(await page.evaluate(([p]) => window.game.inventory.furnaces.at(p).slots,
        [FPOS])).toEqual([null, null, null])
    })

  test('/setblock over a furnace voids the contents rather than dropping them',
    async ({ page, terrain }) => {
      /*
       * Vanilla's split: playerWillDestroy pops the container, setblock and
       * fill just remove the tile entity. The FORGETTING has to happen either
       * way, which is the half that is easy to miss -- a /setblock that left
       * the old contents behind is the same haunted furnace with a different
       * cause.
       */
      await aimAt(page, terrain, await itemId(page, 'furnace'))
      await fill3(page, FPOS)
      await page.evaluate(([p, pass]) => window.game.authority.requestOp(pass)
        .then(() => window.game.authority
          .requestBlockChange({ id: 3, position: p, cause: 'command' })),
      [FPOS, 'diamond-pickaxe'])
      await waitTicks(page, 2)

      expect(await floorTotal(page, await itemId(page, 'raw_iron'))).toBe(0)
      expect(await furnaceHere(page, FPOS)).toBe(null)
    })

  test('mining one by hand scatters the contents, with the block', async ({ page, terrain }) => {
    /*
     * The end-to-end version of the first test: a real held left button, the
     * real mining timer, the real drop physics. Slower and less precise, and
     * the reason it is here is that it is the only one that proves the hook
     * fires from the path a player actually takes.
     */
    await useGamemode(page, 'creative') // instant break; the contents still drop
    await aimAt(page, terrain, await itemId(page, 'furnace'))
    await fill3(page, FPOS)

    await page.mouse.down({ button: 'left' })
    try {
      await page.waitForFunction((p) => window.noa.getBlock(p[0], p[1], p[2]) === 0,
        FPOS, { timeout: 20_000, polling: 20 })
    } finally {
      await page.mouse.up({ button: 'left' })
    }
    await waitTicks(page, 3)

    // Creative suppresses the BLOCK's own drop and not the contents: the stuff
    // inside was never the block's to keep.
    expect(await floorTotal(page, await itemId(page, 'raw_iron'))).toBe(5)
    await shot(page, '45-furnace-breaks-and-spills')
  })

  test('a lava bucket burns for 20000 ticks and leaves the empty bucket', async ({ page }) => {
    /*
     * The top row of the fuel table, which was left out of recipes.js because
     * there was no item to hold. minecraft.wiki/w/Smelting: 20000 ticks, 100
     * items. The empty bucket coming back is Item.craftingRemainingItem, and
     * it is why FurnaceFuelSlot lets a plain bucket in at all.
     */
    const clocks = await page.evaluate(() => {
      const f = window.game.inventory.furnaces.at([9, 9, 9], 'furnace')
      f.slots[0] = { id: window.game.itemId('raw_iron'), count: 64 }
      f.slots[1] = { id: window.game.itemId('lava_bucket'), count: 1 }
      window.game.inventory.furnaces.step(1)
      return { burnTotal: f.burnTotal, fuel: f.slots[1] }
    })
    expect(clocks.burnTotal).toBe(20000)
    expect(clocks.fuel).toEqual({ id: await itemId(page, 'bucket'), count: 1 })
  })
})
