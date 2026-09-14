import { test, expect } from './fixtures.js'
import {
  ID, SURFACE_Y, HEADING, aim, targetedBlock, getBlock, setBlock,
  waitTicks, useGamemode, tapKey, measureFps,
} from './helpers/world.js'
import { shotRegion } from './helpers/shots.js'

/*
 * Dropped item entities.
 *
 * The behaviour under test is the one every Minecraft player has muscle memory
 * for and nobody can describe: a broken block does not go into your bag, it
 * falls out onto the floor and you go and get it. So almost every assertion
 * here is a pair -- the inventory did NOT change, and then it did.
 *
 * THE TEST RIG. Breaking the block under your own feet (which 06-mining does,
 * and is the easy way to aim) is useless here: the drop lands inside the
 * pickup box and is collected before anything can look at it. So these tests
 * put a single block in the air two and a half blocks east, at eye level, and
 * look at it flat. That is far enough to be outside the 1-block pickup reach
 * and close enough to be inside the 5-block dig reach, and breaking it also
 * clears the path for the walk-over.
 *
 * "East" now means x = -3 rather than x = +3, and that is not a change of mind
 * about the rig -- it is the same three columns of the same Minecraft world,
 * reached from the other side. The terrain asset used to be mirrored in X
 * (scripts/terrain/extract.mjs, MIRROR_X) and is not any more, so the flat
 * grass shelf this rig needs moved with it. At +3 the ground is now a block
 * lower and a resting drop sits at 135.125, which is what caught this.
 */

/** Eye level, two and a half blocks east: outside pickup reach, inside dig reach. */
const TARGET = [-3, SURFACE_Y + 1, 0]


const invCount = (page, id) => page.evaluate((want) => window.game.inventory.slots
  .filter(s => s && s.id === want)
  .reduce((n, s) => n + s.count, 0), id)

/** Every drop on the floor, flattened to the bits a test cares about. */
const floor = (page) => page.evaluate(() => window.game.drops.list.map(d => ({
  id: d.id, count: d.count, x: d.x, y: d.y, z: d.z, age: d.age,
})))

const floorTotal = (page, id) => page.evaluate((want) => window.game.drops.list
  .filter(d => d.id === want)
  .reduce((n, d) => n + d.count, 0), id)

/**
 * Hold the button until the block is actually gone, rather than for a duration
 * chosen to be long enough.
 *
 * Both halves matter. A fixed hold that is too short flakes whenever a chunk
 * remesh steals a tick -- the break timer runs on accumulated tick dt, so a
 * stall costs wall clock without costing progress. One that is too long lets
 * the drop drift several blocks on its spawn velocity before anything looks at
 * it, which is how "the drop appeared inside the block it came from" turned
 * into a failure at x = 4.26.
 */
async function mineUntilGone(page, pos) {
  await page.mouse.down({ button: 'left' })
  try {
    await page.waitForFunction(
      (p) => window.noa.getBlock(p[0], p[1], p[2]) === 0, pos,
      { timeout: 20_000, polling: 20 })
  } finally {
    await page.mouse.up({ button: 'left' })
  }
  // The break resolves through the authority, which is a promise: the drop
  // lands one microtask after the voxel does.
  await waitTicks(page, 2)
}

/** Put a lone block at eye level to the east and aim at it. */
async function aimAtTarget(page, terrain, id = ID.dirt) {
  await terrain.keep(TARGET, TARGET)
  await setBlock(page, id, ...TARGET)
  await aim(page, { heading: HEADING.eastMinusX, pitch: 0 })
  expect(await targetedBlock(page)).toMatchObject({ position: TARGET })
}

test.describe('dropped items', () => {
  test.beforeEach(async ({ page }) => { await useGamemode(page, 'survival') })

  test('breaking a block leaves it on the floor instead of in your bag',
    async ({ page, terrain }) => {
      await aimAtTarget(page, terrain)
      await mineUntilGone(page, TARGET)

      expect(await getBlock(page, ...TARGET)).toBe(ID.air)

      /*
       * The whole point. Before this existed the line below read 1, because
       * mining teleported the block into the inventory the instant it broke.
       */
      expect(await invCount(page, ID.dirt),
        'the block went straight into the inventory instead of dropping').toBe(0)

      const items = await floor(page)
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({ id: ID.dirt, count: 1 })
      // Where the block was, not at the player and not at 0,0,0. Vanilla pops
      // a resource from a random point inside the block with a sideways kick,
      // so this is a neighbourhood rather than a coordinate.
      expect(Math.abs(items[0].x - (TARGET[0] + 0.5))).toBeLessThan(1)
      expect(Math.abs(items[0].z - (TARGET[2] + 0.5))).toBeLessThan(1)
    })

  test('a drop falls to the ground and stays there', async ({ page, terrain }) => {
    await aimAtTarget(page, terrain)
    /*
     * Sampled from inside the page on the tick the drop appears. Reading it
     * over CDP afterwards measures how long the round trip took, not how high
     * the item spawned -- it falls a block in a third of a second.
     */
    await page.evaluate(() => {
      window.__spawnY = null
      const fn = () => {
        const d = window.game.drops.list[0]
        if (!d) return
        window.__spawnY = d.y
        window.noa.off('tick', fn)
      }
      window.noa.on('tick', fn)
    })
    await mineUntilGone(page, TARGET)

    // Out of the block it broke, which is a block above the grass.
    expect(await page.evaluate(() => window.__spawnY)).toBeGreaterThan(SURFACE_Y + 0.5)

    await page.waitForTimeout(1200)
    const rested = (await floor(page))[0]
    /*
     * The surface is at y=64 and the item box is 0.25 tall, so a drop resting
     * ON the grass has its centre at 64.125. Anything lower has fallen through
     * the world, anything higher is hovering.
     */
    expect(rested.y).toBeCloseTo(SURFACE_Y + 0.125, 2)
  })

  test('walking over a drop collects it', async ({ page, terrain }) => {
    await aimAtTarget(page, terrain)
    await mineUntilGone(page, TARGET)
    expect(await invCount(page, ID.dirt)).toBe(0)
    expect(await floorTotal(page, ID.dirt)).toBe(1)

    // Forward is east (which is -X here), because `aim` left the camera
    // pointing that way and noa's movement is camera-relative. Breaking the
    // target cleared the path.
    await tapKey(page, 'KeyW', 900)
    await waitTicks(page, 3)

    expect(await invCount(page, ID.dirt),
      'walked over the drop and it was not picked up').toBe(1)
    expect(await floorTotal(page, ID.dirt)).toBe(0)
  })

  test('a fresh drop cannot be picked up for Minecraft\'s ten ticks',
    async ({ page }) => {
      /*
       * Vanilla's setDefaultPickUpDelay. Without it a break at your feet is
       * collected on the same tick it spawns, which is the old teleport-into-
       * your-bag behaviour wearing a costume.
       */
      const at = await page.evaluate(() => {
        const p = window.noa.ents.getPositionData(window.noa.playerEntity).position
        window.game.drops.popResource(2, 1, [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])])
        return window.game.drops.list[0].delay
      })
      expect(at).toBeCloseTo(0.5, 3)

      await waitTicks(page, 2)
      expect(await invCount(page, ID.dirt), 'picked up inside the delay').toBe(0)

      await page.waitForTimeout(700)
      expect(await invCount(page, ID.dirt)).toBe(1)
    })

  test('a collected drop flies into the player and pops', async ({ page }) => {
    /*
     * Vanilla does not delete a collected item, it plays it INTO you: the
     * entity is gone server-side and the client slides it at the player for a
     * few ticks. So the interesting state is the one in between -- counted
     * out of the world, still being drawn.
     */
    await page.evaluate(([id, y]) => {
      const p = window.noa.ents.getPositionData(window.noa.playerEntity).position
      // No pickup delay: this is about what happens after the pickup, not
      // about waiting for one.
      window.game.drops.spawn(id, 1, [p[0], y + 0.3, p[2]], [0, 0, 0], 0)
    }, [ID.cobblestone, SURFACE_Y])

    await waitTicks(page, 2)

    const mid = await floor(page)
    expect(mid, 'the drop vanished the instant it was collected').toHaveLength(1)
    expect(mid[0].count, 'a collected drop is still carrying items').toBe(0)
    expect(await invCount(page, ID.cobblestone)).toBe(1)

    await page.waitForTimeout(400)
    expect(await floor(page), 'the collect animation never finished').toHaveLength(0)
  })

  test('picking something up makes Minecraft\'s pop', async ({ page }) => {
    const built = await page.evaluate(() => !!window.game.sounds.manifest)
    test.skip(!built, 'no sounds built -- run npm run sounds')

    /*
     * KeyZ is bound to nothing and is the suite's standard way of handing the
     * browser the trusted gesture an AudioContext needs. See helpers/audio.js.
     */
    await page.keyboard.press('KeyZ')
    await page.waitForFunction(() => window.game.sounds.state === 'running',
      null, { timeout: 15_000, polling: 50 })
    await page.waitForFunction(() => window.game.sounds.decoded > 0,
      null, { timeout: 15_000, polling: 50 })

    await page.evaluate(([id, y]) => {
      const p = window.noa.ents.getPositionData(window.noa.playerEntity).position
      window.game.drops.spawn(id, 1, [p[0], y + 0.3, p[2]], [0, 0, 0], 0)
    }, [ID.cobblestone, SURFACE_Y])
    await waitTicks(page, 2)

    // Non-positional, because it is your own pocket. The rate is vanilla's
    // doubled pitch, which is the entire character of the sound.
    expect(await page.evaluate(() => window.game.sounds.lastPlayed))
      .toMatchObject({ event: 'pickup' })
  })

  test('creative drops nothing at all', async ({ page, terrain }) => {
    await useGamemode(page, 'creative')
    await aimAtTarget(page, terrain)

    // Creative breaks on the first tick the button is down.
    await mineUntilGone(page, TARGET)

    expect(await getBlock(page, ...TARGET)).toBe(ID.air)
    expect(await floor(page), 'creative left an item on the floor').toHaveLength(0)
    expect(await invCount(page, ID.dirt)).toBe(0)
  })

  test('Q throws one item and Ctrl+Q throws the stack', async ({ page }) => {
    await page.evaluate((id) => window.game.inventory.add(id, 5), ID.dirt)
    await page.evaluate(() => window.game.inventory.select(0))

    await tapKey(page, 'KeyQ')
    await waitTicks(page, 2)

    expect(await invCount(page, ID.dirt)).toBe(4)
    expect(await floorTotal(page, ID.dirt)).toBe(1)

    // The thrown item is in front of the player, not on top of them: vanilla
    // throws at 0.3/tick forward, and a throw you immediately walk back into
    // would be indistinguishable from not having thrown it.
    const [thrown] = await floor(page)
    const player = await page.evaluate(
      () => [...window.noa.ents.getPositionData(window.noa.playerEntity).position])
    expect(Math.hypot(thrown.x - player[0], thrown.z - player[2])).toBeGreaterThan(0.4)

    await page.keyboard.down('ControlLeft')
    await tapKey(page, 'KeyQ')
    await page.keyboard.up('ControlLeft')
    await waitTicks(page, 2)

    expect(await invCount(page, ID.dirt), 'Ctrl+Q left something in the slot').toBe(0)
    expect(await floorTotal(page, ID.dirt)).toBe(5)
  })

  test('two identical drops resting together merge into one stack',
    async ({ page }) => {
      await page.evaluate(([id, y]) => {
        const d = window.game.drops
        d.spawn(id, 1, [10, y + 0.2, 10], [0, 0, 0])
        d.spawn(id, 1, [10.2, y + 0.2, 10.1], [0, 0, 0])
      }, [ID.cobblestone, SURFACE_Y])

      await waitTicks(page, 3)

      const items = await floor(page)
      expect(items, 'two cobblestone drops side by side stayed separate').toHaveLength(1)
      expect(items[0].count).toBe(2)
    })

  test('different items lying together do not merge', async ({ page }) => {
    await page.evaluate(([a, b, y]) => {
      const d = window.game.drops
      d.spawn(a, 1, [10, y + 0.2, 10], [0, 0, 0])
      d.spawn(b, 1, [10.1, y + 0.2, 10], [0, 0, 0])
    }, [ID.cobblestone, ID.dirt, SURFACE_Y])

    await waitTicks(page, 3)
    expect(await floor(page)).toHaveLength(2)
  })

  test('drops despawn after Minecraft\'s five minutes', async ({ page }) => {
    /*
     * 6000 ticks. Aged by hand rather than waited out, obviously -- but aged to
     * just under and just over, so this pins the constant to within a second
     * rather than merely proving that something eventually expires.
     */
    await page.evaluate(([id, y]) => {
      const d = window.game.drops
      d.spawn(id, 1, [12, y + 0.2, 12], [0, 0, 0])
      d.spawn(id, 1, [-12, y + 0.2, -12], [0, 0, 0])
      d.list[0].age = 299
      d.list[1].age = 300
    }, [ID.cobblestone, SURFACE_Y])

    await waitTicks(page, 2)

    const left = await floor(page)
    expect(left, 'the 299-second drop despawned early').toHaveLength(1)
    expect(left[0].age).toBeGreaterThan(299)
  })

  test('fifty drops on the ground do not cost the frame rate', async ({ page }) => {
    /*
     * Measured as a RATIO against this machine, not against a number. The
     * absolute rate under swiftshader is somewhere between 10 and 40 fps
     * depending on what else is running, so an absolute floor would either be
     * meaningless or flaky. What a regression looks like is the second number
     * collapsing against the first -- which is what a mesh, a draw call and a
     * material per drop would do.
     */
    // Pointed at where they are about to land: a mesh nobody is looking at is
    // a measurement of nothing.
    await aim(page, { heading: Math.PI / 4, pitch: 0.2 })
    const meshesBefore = await page.evaluate(() => window.game.drops.meshes)
    const before = await measureFps(page)

    await page.evaluate(([id, y]) => {
      for (let i = 0; i < 50; i++) {
        window.game.drops.spawn(id, 1,
          [20 + (i % 10) * 0.8, y + 0.2, 20 + Math.floor(i / 10) * 0.8], [0, 0, 0])
      }
    }, [ID.cobblestone, SURFACE_Y])
    await waitTicks(page, 2)

    expect(await page.evaluate(() => window.game.drops.count),
      'fifty drops merged or were dropped on the floor of the pool').toBe(50)
    /*
     * Fifty drops of one item cost ONE mesh -- and the meshes already built
     * for earlier specs are still there, pooled per item type on purpose, so
     * this is a delta rather than an absolute. A mesh per drop is the thing
     * being ruled out, and it would read as +50.
     */
    expect(await page.evaluate(() => window.game.drops.meshes) - meshesBefore,
      'fifty drops built more than one mesh').toBeLessThanOrEqual(1)

    const after = await measureFps(page)
    expect(after / before,
      `fifty drops took the frame rate from ${before.toFixed(1)} to ${after.toFixed(1)}`)
      .toBeGreaterThan(0.7)
  })

  test('a drop looks like a dropped item', async ({ page }) => {
    /*
     * Visual, and there is nothing else it could be: "does the little cube
     * spin, bob, sit on the grass and show the right face on the right side"
     * is not a property any number in this file can answer.
     *
     * Nothing is broken to produce these -- a block left standing in front of
     * the camera fills the frame and hides the thing being photographed.
     */
    await aim(page, { heading: HEADING.eastMinusX, pitch: 0.25 })
    await page.evaluate(([y]) => {
      const d = window.game.drops
      d.spawn(1, 1, [-3.4, y + 1.4, -0.4], [0, 0, 0])
      d.spawn(4, 1, [-3.0, y + 1.4, 0.6], [0, 0, 0])
      d.spawn(5, 1, [-2.4, y + 1.4, 0.1], [0, 0, 0])
    }, [SURFACE_Y])
    await waitTicks(page, 3)
    await shotRegion(page, 'drops-air', 'centre')

    await page.waitForTimeout(1500)
    await shotRegion(page, 'drops-ground', 'centre')
  })
})

/*
 * The drop TABLES, as opposed to the item entities above.
 *
 * These break nothing. `dropFor` is pure -- it answers with a distribution,
 * not with a rolled result -- so "lapis ore drops four to nine lapis" is an
 * assertion rather than ten thousand breaks and a histogram, and it is exact
 * rather than statistical. That purity is the entire reason the randomness
 * lives in `rollDrops`, which takes its generator as an argument; the last
 * test here hands it a scripted one and pins a 10% flint to a single value.
 *
 * Item ids above ITEM_BASE are positional, and so are most block ids, so
 * everything here asks `itemId` by key. A block's item shares its block's id
 * (see the header of items.js), which is why the same call answers for both.
 */

/** The loot table for breaking `blockKey` while holding `heldKey`. */
const dropTable = (page, blockKey, heldKey = null) =>
  page.evaluate(([b, h]) => window.game.loot.dropFor(
    window.game.itemId(b), h ? window.game.itemId(h) : 0), [blockKey, heldKey])

/** One alternative, spelled the way items.js spells it. */
const entry = async (page, key, min = 1, max = min, chance = 1) =>
  ({ id: await idOf(page, key), min, max, chance })

const idOf = (page, key) => page.evaluate((k) => window.game.itemId(k), key)

test.describe('block drop tables', () => {
  test('every block in the palette has a deliberate drop decision',
    async ({ page }) => {
      /*
       * The same guard 12-sounds puts on the sound families, and it is here
       * for the same reason: the drop rules used to be nine rows and a
       * "drops itself" default, so 629 blocks had silk-touch behaviour and
       * nobody could see it. A block no rule in items.js claims is a name in
       * this list, not a block that quietly hands you a copy of itself.
       */
      expect(await page.evaluate(() => window.game.loot.unmapped())).toEqual([])
    })

  test('ores drop their mineral, not the ore block', async ({ page }) => {
    // The owner's second complaint: breaking coal ore gave you coal ore.
    expect(await dropTable(page, 'coal_ore', 'iron_pickaxe'))
      .toEqual([[await entry(page, 'coal')]])
    expect(await dropTable(page, 'iron_ore', 'stone_pickaxe'))
      .toEqual([[await entry(page, 'raw_iron')]])
    expect(await dropTable(page, 'nether_quartz_ore', 'wooden_pickaxe'))
      .toEqual([[await entry(page, 'quartz')]])
  })

  test('the ores that come in handfuls use Minecraft\'s ranges',
    async ({ page }) => {
      // Straight off the wiki's drop column, and the four that are not 1:1.
      expect(await dropTable(page, 'copper_ore', 'stone_pickaxe'))
        .toEqual([[await entry(page, 'raw_copper', 2, 5)]])
      expect(await dropTable(page, 'redstone_ore', 'iron_pickaxe'))
        .toEqual([[await entry(page, 'redstone', 4, 5)]])
      expect(await dropTable(page, 'lapis_ore', 'stone_pickaxe'))
        .toEqual([[await entry(page, 'lapis_lazuli', 4, 9)]])
      expect(await dropTable(page, 'nether_gold_ore', 'iron_pickaxe'))
        .toEqual([[await entry(page, 'gold_nugget', 2, 6)]])
    })

  test('a deepslate ore drops exactly what its stone counterpart does',
    async ({ page }) => {
      /*
       * A rule, not two rows: the deepslate variant is matched by stripping
       * the prefix. Asserted as an equality between the two tables rather than
       * against a literal, so it stays true if a mineral ever changes.
       */
      for (const ore of ['coal_ore', 'lapis_ore', 'diamond_ore', 'copper_ore']) {
        expect(await dropTable(page, `deepslate_${ore}`, 'diamond_pickaxe'),
          `deepslate_${ore}`).toEqual(await dropTable(page, ore, 'diamond_pickaxe'))
      }
    })

  test('gravel is one roll with two outcomes, not two rolls', async ({ page }) => {
    /*
     * The shape that forced the pool list. "10% flint, OTHERWISE gravel" is a
     * single pool with two alternatives -- a flat list of `{flint: 10%,
     * gravel: 90%}` rolled independently would sometimes give both and
     * sometimes neither.
     */
    expect(await dropTable(page, 'gravel', 'iron_shovel')).toEqual([[
      await entry(page, 'flint', 1, 1, 0.1),
      await entry(page, 'gravel'),
    ]])
  })

  test('clay gives four balls and a bookshelf gives three books',
    async ({ page }) => {
      expect(await dropTable(page, 'clay', 'iron_shovel'))
        .toEqual([[await entry(page, 'clay_ball', 4)]])
      expect(await dropTable(page, 'bookshelf', 'iron_axe'))
        .toEqual([[await entry(page, 'book', 3)]])
    })

  test('the silk-touch-only blocks drop nothing at all', async ({ page }) => {
    /*
     * There is no silk touch in this world, so this is the whole rule rather
     * than half of one -- see the note in items.js for what the enchantment
     * would change if it ever lands.
     */
    for (const key of ['glass', 'blue_stained_glass', 'ice', 'packed_ice',
      'sculk', 'bee_nest', 'budding_amethyst']) {
      expect(await dropTable(page, key, 'diamond_pickaxe'), key).toEqual([])
    }
    // Vanilla's one exception, and it is genuinely an exception: tinted glass
    // is the only glass that survives being broken.
    expect(await dropTable(page, 'tinted_glass', 'iron_pickaxe'))
      .toEqual([[await entry(page, 'tinted_glass')]])
  })

  test('leaves need shears, and give sticks to anything else', async ({ page }) => {
    // The owner's first complaint. Shears is the implementable half of
    // vanilla's "shears or silk touch" rule.
    expect(await dropTable(page, 'oak_leaves', 'shears'))
      .toEqual([[await entry(page, 'oak_leaves')]])
    expect(await dropTable(page, 'jungle_leaves', 'shears'))
      .toEqual([[await entry(page, 'jungle_leaves')]])

    /*
     * Without them: 2% for one or two sticks, and nothing else. Vanilla also
     * rolls a sapling and (on oak and dark oak) an apple, and neither item
     * exists in this palette -- which is why the table is one pool rather than
     * three, and why this asserts the whole table instead of just the sticks.
     */
    const sticks = [[await entry(page, 'stick', 1, 2, 0.02)]]
    for (const leaf of ['oak_leaves', 'dark_oak_leaves', 'cherry_leaves']) {
      expect(await dropTable(page, leaf, 'iron_axe'), leaf).toEqual(sticks)
      expect(await dropTable(page, leaf, null), `${leaf} by hand`).toEqual(sticks)
    }
  })

  test('a scripted random makes a 10% flint exact', async ({ page }) => {
    /*
     * The payoff for keeping Math.random out of the table. `roll` takes its
     * generator, so these are not samples -- they are the two branches of
     * gravel and the two ends of lapis, pinned.
     *
     * A draw is only taken where there is a real decision (a chance below 1,
     * or a range wider than one), so the numbers below line up with the table
     * read from items.js rather than with a count of wasted calls.
     */
    const roll = (blockKey, heldKey, seq) => page.evaluate(([b, h, s]) => {
      let i = 0
      const g = window.game
      return g.loot.roll(g.loot.dropFor(g.itemId(b), g.itemId(h)),
        () => s[i++ % s.length])
    }, [blockKey, heldKey, seq])

    expect(await roll('gravel', 'iron_shovel', [0.05]))
      .toEqual([{ id: await idOf(page, 'flint'), count: 1 }])
    // 0.1 is the first value that FAILS a 10% chance -- the comparison is
    // `random() >= chance`, which is what makes a chance of 0 impossible.
    expect(await roll('gravel', 'iron_shovel', [0.1]))
      .toEqual([{ id: await idOf(page, 'gravel'), count: 1 }])

    const lapis = await idOf(page, 'lapis_lazuli')
    expect(await roll('lapis_ore', 'iron_pickaxe', [0])).toEqual([{ id: lapis, count: 4 }])
    expect(await roll('lapis_ore', 'iron_pickaxe', [0.999])).toEqual([{ id: lapis, count: 9 }])

    // A 2% stick that did not come up leaves an empty floor, which is the
    // common case for leaves and not a failure.
    expect(await roll('oak_leaves', 'iron_axe', [0.5])).toEqual([])
    expect(await roll('oak_leaves', 'iron_axe', [0.01, 0.99]))
      .toEqual([{ id: await idOf(page, 'stick'), count: 2 }])
  })
})
