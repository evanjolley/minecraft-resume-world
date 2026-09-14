import { test, expect } from './fixtures.js'
import {
  ID, SURFACE_Y, HEADING, aim, holdMouse, getBlock, setBlock, position,
  teleport, settleOnGround, waitTicks, useGamemode, gamemode, caps, isFlying,
  isOperator, doubleTapFly, targetedBlock, measureSpeed, DROP_X, DROP_Z,
} from './helpers/world.js'

/* physics.js MC.FLY_SPEED. Duplicated rather than imported for the same reason
 * the block ids are: a change to the constant should fail here, not follow. */
const FLY_SPEED = 10.89

/* Straight down, as in 06-mining. */
const DOWN = Math.PI / 2
/* blocks.js hardness is bare-handed seconds; grass is 0.9. */
const GRASS_BREAK_MS = 900

const invCount = (page, id) => page.evaluate((want) => window.game.inventory.slots
  .filter(s => s && s.id === want)
  .reduce((n, s) => n + s.count, 0), id)

const health = (page) => page.evaluate(() => window.game.survival.health)

test.describe('adventure, the default', () => {
  test('a visitor arrives in adventure mode with no privileges', async ({ page }) => {
    // The whole reason adventure exists here: a stranger who lands on the
    // island must not be able to take it apart. Both halves of that are one
    // assertion, because being an operator is what undoes it.
    expect(await gamemode(page)).toBe('adventure')
    expect(await isOperator(page)).toBe(false)
    expect(await caps(page)).toMatchObject({ mayBuild: false, mayBreak: false })
  })

  test('holding left click on a block does not break it, however long',
    async ({ page, terrain }) => {
      await terrain.keep([0, SURFACE_Y - 1, 0], [0, SURFACE_Y - 1, 0])
      await aim(page, { pitch: DOWN })
      // The crosshair really is on the block: the refusal has to be the mode,
      // not a missed raycast.
      expect(await targetedBlock(page)).toMatchObject({ position: [0, SURFACE_Y - 1, 0] })

      // Three times grass's break time. If the timer were merely slowed
      // rather than refused, this is where it would show.
      await holdMouse(page, GRASS_BREAK_MS * 3)

      expect(await getBlock(page, 0, SURFACE_Y - 1, 0)).toBe(ID.grass)
      expect(await invCount(page, ID.dirt), 'adventure mining produced a drop').toBe(0)
    })

  test('right-clicking a block face does not place, and costs nothing',
    async ({ page, terrain }) => {
      const WALL = [2, SURFACE_Y + 1, 0]
      await terrain.keep([1, SURFACE_Y, 0], [2, SURFACE_Y + 1, 0])
      await setBlock(page, ID.planks, ...WALL)
      await page.evaluate(() => window.game.inventory.add(5, 10))

      await aim(page, { heading: HEADING.eastPlusX, pitch: 0 })
      expect(await targetedBlock(page)).toMatchObject({ position: WALL })

      await page.mouse.down({ button: 'right' })
      await page.mouse.up({ button: 'right' })
      await waitTicks(page, 3)

      expect(await getBlock(page, 1, SURFACE_Y + 1, 0)).toBe(ID.air)
      expect(await invCount(page, ID.planks),
        'a refused place still consumed the item').toBe(10)
    })

  test('you can still be hurt: adventure is not creative', async ({ page }) => {
    // Adventure takes away building and nothing else. A visitor who jumps off
    // a ledge should land like a Minecraft player lands.
    await teleport(page, 0.5, SURFACE_Y + 12, 0.5)
    await settleOnGround(page)
    expect(await health(page)).toBeLessThan(20)
  })
})

test.describe('creative', () => {
  test.beforeEach(async ({ page }) => { await useGamemode(page, 'creative') })

  test('blocks break instantly, in a fraction of their survival time',
    async ({ page, terrain }) => {
      await terrain.keep([0, SURFACE_Y - 1, 0], [0, SURFACE_Y - 1, 0])
      await aim(page, { pitch: DOWN })

      // A fifth of grass's 900 ms. In survival this leaves the block at
      // roughly stage 2 of the crack overlay.
      await holdMouse(page, GRASS_BREAK_MS / 5)

      expect(await getBlock(page, 0, SURFACE_Y - 1, 0)).toBe(ID.air)
      // Vanilla creative gives no drops -- you already have every block.
      expect(await invCount(page, ID.dirt)).toBe(0)
      expect(await invCount(page, ID.grass)).toBe(0)
    })

  test('placing does not consume the stack', async ({ page, terrain }) => {
    const WALL = [2, SURFACE_Y + 1, 0]
    await terrain.keep([1, SURFACE_Y, 0], [2, SURFACE_Y + 1, 0])
    await setBlock(page, ID.planks, ...WALL)
    await page.evaluate(() => window.game.inventory.add(5, 10))

    await aim(page, { heading: HEADING.eastPlusX, pitch: 0 })
    await page.mouse.down({ button: 'right' })
    await page.mouse.up({ button: 'right' })
    await waitTicks(page, 3)

    expect(await getBlock(page, 1, SURFACE_Y + 1, 0)).toBe(ID.planks)
    expect(await invCount(page, ID.planks), 'creative charged for a block').toBe(10)
  })

  test('a fall that would hurt in adventure does nothing', async ({ page }) => {
    await teleport(page, 0.5, SURFACE_Y + 12, 0.5)
    await settleOnGround(page)
    expect(await health(page)).toBe(20)
  })

  test('hearts and hunger leave the HUD', async ({ page }) => {
    // Vanilla drops the survival bars in creative: they are pinned at full and
    // a row of hearts that can never move is noise.
    const shown = (id) => page.evaluate((i) =>
      getComputedStyle(document.getElementById(i)).display !== 'none', id)
    expect(await shown('status')).toBe(false)
    expect(await shown('xp-row')).toBe(false)
    expect(await shown('hotbar'), 'the hotbar belongs in creative').toBe(true)
  })
})

test.describe('flight', () => {
  test('double-tapping jump in creative leaves the ground and climbs',
    async ({ page }) => {
      // Four blocks east of spawn: the spawn column has a dark-forest canopy
      // three blocks overhead, and a climb that stops at a leaf reads as
      // flight that does not work.
      await teleport(page, DROP_X, SURFACE_Y, DROP_Z)
      await settleOnGround(page)
      await useGamemode(page, 'creative')
      const [, y0] = await position(page)

      await doubleTapFly(page)
      expect(await isFlying(page), 'double-tap did not engage flight').toBe(true)

      // Hold the climb long enough to clear any jump arc -- a jump apex is
      // 1.25 blocks and comes straight back down.
      await page.keyboard.down('Space')
      await page.waitForTimeout(1000)
      await page.keyboard.up('Space')

      const [, y1] = await position(page)
      expect(y1 - y0, `climbed ${(y1 - y0).toFixed(2)} blocks`).toBeGreaterThan(4)

      /*
       * And it STAYS up. Gravity is off, not merely overpowered.
       *
       * Measured AFTER a settling window, not immediately: releasing jump
       * eases the climb velocity toward zero rather than cutting it, so a
       * flying player coasts up roughly 0.7 blocks first. That coast is the
       * point (physics.js: MC.FLY_VERTICAL_RESPONSE) and it would otherwise
       * read as drift. Twenty ticks of genuine hover is two thirds of a
       * second, in which a falling player drops about seven blocks.
       */
      await waitTicks(page, 12)
      const [, settled] = await position(page)
      expect(settled, 'coasted downward after releasing jump').toBeGreaterThan(y1 - 0.05)

      await waitTicks(page, 20)
      const [, y2] = await position(page)
      expect(Math.abs(y2 - settled), 'a flying player fell after releasing jump')
        .toBeLessThan(0.1)
      expect(await isFlying(page)).toBe(true)
    })

  test('flight runs at Minecraft\'s speed, and sprinting doubles it',
    async ({ page }) => {
      await teleport(page, DROP_X, SURFACE_Y, DROP_Z)
      await settleOnGround(page)
      await useGamemode(page, 'creative')
      await doubleTapFly(page)
      // Get clear of the ground first: touching down cancels the flight, and
      // a cancelled flight would be measured as a walk.
      await page.keyboard.down('Space')
      await page.waitForTimeout(700)
      await page.keyboard.up('Space')

      /*
       * ...and then up into genuinely open air. Climbing off the ground was
       * enough over the old island, whose surface was flat and bare; here the
       * player is inside a dark forest and would fly into a trunk within a
       * second, which measures the tree rather than the flight speed. The
       * teleport keeps `flying` true -- it only zeroes velocity.
       */
      await teleport(page, DROP_X, 210, DROP_Z)
      await waitTicks(page, 2)

      const cruise = await measureSpeed(page, ['KeyW'])
      expect(cruise, `flew at ${cruise.toFixed(2)} b/s`).toBeGreaterThan(FLY_SPEED * 0.95)
      expect(cruise, `flew at ${cruise.toFixed(2)} b/s`).toBeLessThan(FLY_SPEED * 1.05)

      // Vanilla doubles Abilities.flyingSpeed outright rather than adding to
      // it, which is why creative flight has two very distinct gears.
      const sprint = await measureSpeed(page, ['KeyW', 'ControlLeft'])
      expect(sprint, `sprint-flew at ${sprint.toFixed(2)} b/s`)
        .toBeGreaterThan(FLY_SPEED * 2 * 0.95)
      expect(sprint, `sprint-flew at ${sprint.toFixed(2)} b/s`)
        .toBeLessThan(FLY_SPEED * 2 * 1.05)

      expect(await isFlying(page), 'flight cut out mid-measurement').toBe(true)
    })

  test('adventure cannot fly at all', async ({ page }) => {
    const [, y0] = await position(page)
    await doubleTapFly(page)
    expect(await isFlying(page)).toBe(false)
    await page.keyboard.down('Space')
    await page.waitForTimeout(600)
    await page.keyboard.up('Space')
    await settleOnGround(page)
    const [, y1] = await position(page)
    // Back on the ground, having done nothing but jump.
    expect(Math.abs(y1 - y0)).toBeLessThan(0.2)
  })

  test('landing ends creative flight, the way vanilla clears it', async ({ page }) => {
    await useGamemode(page, 'creative')
    await doubleTapFly(page)
    expect(await isFlying(page)).toBe(true)

    // Descend onto the island.
    await page.keyboard.down('ShiftLeft')
    await page.waitForTimeout(900)
    await page.keyboard.up('ShiftLeft')
    await waitTicks(page, 5)

    expect(await isFlying(page), 'still flying after touching down').toBe(false)
  })
})

test.describe('spectator', () => {
  test('flies through solid terrain instead of landing on it', async ({ page }) => {
    await teleport(page, 0.5, SURFACE_Y + 4, 0.5)
    await useGamemode(page, 'spectator')

    // Spectator starts flying: no double-tap, no ground contact ever.
    expect(await isFlying(page)).toBe(true)

    // Descend for long enough to be well below the grass at y=63.
    await page.keyboard.down('ShiftLeft')
    await page.waitForTimeout(1500)
    await page.keyboard.up('ShiftLeft')
    await waitTicks(page, 3)

    const [x, y, z] = await position(page)
    expect(y, `stopped at y=${y.toFixed(2)}`).toBeLessThan(SURFACE_Y - 2)

    // The honest assertion: the player is INSIDE a solid voxel. Falling to a
    // low y through a hole would satisfy the check above; this cannot be.
    const inside = await getBlock(page, Math.floor(x), Math.floor(y), Math.floor(z))
    expect(inside, 'the spectator ended up in air, not inside the island')
      .not.toBe(ID.air)
  })

  test('the player model is not drawn', async ({ page }) => {
    await useGamemode(page, 'spectator')
    const visible = await page.evaluate(() =>
      window.game.perspective.model.root.getChildMeshes().some(m => m.isVisible))
    expect(visible).toBe(false)
  })

  test('cannot break blocks either', async ({ page, terrain }) => {
    await terrain.keep([0, SURFACE_Y - 1, 0], [0, SURFACE_Y - 1, 0])
    await aim(page, { pitch: DOWN })
    await useGamemode(page, 'spectator')
    await holdMouse(page, GRASS_BREAK_MS * 2)
    expect(await getBlock(page, 0, SURFACE_Y - 1, 0)).toBe(ID.grass)
  })
})
