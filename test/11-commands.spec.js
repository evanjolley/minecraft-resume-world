import { test, expect } from './fixtures.js'
import {
  ID, SURFACE_Y, OP_PASSPHRASE, chatCommand, visibleCommands, isOperator,
  gamemode, grantOp, getBlock, position, waitTicks, reloadWorld, playerName,
  settleOnGround, PAD_X0, PAD_Y, PAD_Z,
} from './helpers/world.js'

/* Vanilla's rejection, both lines of it. Anything a non-operator types that
 * they are not allowed to type comes back looking exactly like a typo, which
 * is what Minecraft does -- the command was never in their dispatcher. */
const REFUSED = 'Unknown or incomplete command, see below for error'

/** Every command that requires OP, with arguments that WOULD work if opped. */
/*
 * y=200 rather than the old y=70 in the three coordinates below. Not a
 * loosened test -- the opposite. The check after the loop is "the refused
 * /setblock left the world alone", and it reads the target voxel back
 * expecting air. In the imported world y=70 is two hundred blocks of solid
 * rock under the forest floor, so that voxel is stone whether the command was
 * refused or not, and the assertion would have passed for the wrong reason.
 * y=200 is open sky above the highest peak in the patch.
 */
const OP_COMMANDS = [
  '/gamemode creative',
  '/time set night',
  '/tp 5 200 5',
  '/give planks 5',
  '/setblock 4 200 4 stone',
  '/fill 4 200 4 5 200 5 stone',
  '/gamerule doDaylightCycle false',
  '/weather rain',
  '/deop',
]

const invCount = (page, id) => page.evaluate((want) => window.game.inventory.slots
  .filter(s => s && s.id === want)
  .reduce((n, s) => n + s.count, 0), id)

const skyBlue = (page) => page.evaluate(() =>
  window.noa.rendering.getScene().clearColor.asArray()[2])

const errorsIn = (lines) => lines.filter(l => l.kind === 'error').map(l => l.text)
const systemIn = (lines) => lines.filter(l => l.kind === 'system').map(l => l.text)

test.describe('the command line', () => {
  test('an unknown command gets Minecraft\'s two-line parse failure',
    async ({ page }) => {
      const out = await chatCommand(page, '/notacommand')
      expect(errorsIn(out)).toEqual([REFUSED, '/notacommand<--[HERE]'])
    })

  test('/help lists only what the caller may actually run', async ({ page }) => {
    const out = await chatCommand(page, '/help')
    const listed = systemIn(out).map(t => t.split(' ')[0])

    expect(listed).toContain('/help')
    expect(listed).toContain('/kill')
    expect(listed).toContain('/op')
    // The whole point: an operator command must not even be advertised.
    expect(listed).not.toContain('/gamemode')
    expect(listed).not.toContain('/setblock')
    expect(listed).not.toContain('/fill')

    // And /help is not the only place that filters -- the dispatcher uses the
    // same predicate, so the two can never disagree.
    expect(await visibleCommands(page)).toEqual(['help', 'op', 'kill'])
  })

  test('/kill is open to everyone and kills only the caller', async ({ page }) => {
    const out = await chatCommand(page, '/kill')
    /*
     * TWO lines, and that is vanilla. The death broadcast goes to everyone who
     * would see any death; the "Killed X" feedback goes to whoever ran the
     * command. They are different messages to different audiences and only
     * happen to land in the same log in singleplayer.
     *
     * This asserted one line until death messages existed, so it is the
     * assertion that was incomplete rather than the behaviour that regressed.
     * Kept as an exact list rather than `arrayContaining`: the audiences are
     * the point, so a build that dropped either half should fail here.
     */
    const who = await playerName(page)
    expect(systemIn(out)).toEqual([`${who} was killed`, `Killed ${who}`])
    expect(await page.evaluate(() => window.game.survival.dead)).toBe(true)
    await expect(page.locator('#death')).toBeVisible()
  })
})

test.describe('operator authentication', () => {
  test('/op with the wrong passphrase is refused and grants nothing',
    async ({ page }) => {
      const out = await chatCommand(page, '/op hunter2')
      expect(errorsIn(out)).toEqual(['Could not op player: wrong passphrase'])
      expect(await isOperator(page)).toBe(false)
      // Refused means refused: the OP command set is still invisible.
      expect(await visibleCommands(page)).not.toContain('gamemode')
    })

  test('/op with the right passphrase opens the operator command set',
    async ({ page }) => {
      const out = await chatCommand(page, `/op ${OP_PASSPHRASE}`)
      expect(systemIn(out)).toEqual(['Opped yourself'])
      expect(await isOperator(page)).toBe(true)

      const listed = (await chatCommand(page, '/help')).map(l => l.text.split(' ')[0])
      expect(listed).toContain('/gamemode')
      expect(listed).toContain('/fill')
    })

  test('operator status survives a reload', async ({ page }) => {
    await chatCommand(page, `/op ${OP_PASSPHRASE}`)
    expect(await isOperator(page)).toBe(true)

    // A real navigation, because localStorage only proves anything across one.
    await reloadWorld(page)

    expect(await isOperator(page), 'OP did not survive the reload').toBe(true)
    // The mode deliberately does NOT persist: a reload should hand a stranger
    // the world a stranger gets, and only the privilege to change it back.
    expect(await gamemode(page)).toBe('adventure')
  })

  test('/deop drops the privilege and the powers it granted', async ({ page }) => {
    await chatCommand(page, `/op ${OP_PASSPHRASE}`)
    await chatCommand(page, '/gamemode creative')
    expect(await gamemode(page)).toBe('creative')

    const out = await chatCommand(page, '/deop')
    expect(systemIn(out)).toEqual(['De-opped yourself'])
    expect(await isOperator(page)).toBe(false)
    // Without this a de-opped visitor keeps flying around in creative with no
    // command left to put them back.
    expect(await gamemode(page)).toBe('adventure')
  })
})

test.describe('operator commands are refused without OP', () => {
  test('every one of them fails, and none of them has any effect',
    async ({ page, terrain }) => {
      await terrain.keep([4, 200, 4], [5, 200, 5])
      const [x0, y0, z0] = await position(page)

      for (const cmd of OP_COMMANDS) {
        const out = await chatCommand(page, cmd)
        expect(errorsIn(out), `${cmd} was not refused`)
          .toEqual([REFUSED, `${cmd}<--[HERE]`])
      }

      // The refusals are real, not cosmetic.
      expect(await gamemode(page)).toBe('adventure')
      expect(await getBlock(page, 4, 200, 4)).toBe(ID.air)
      expect(await invCount(page, ID.planks)).toBe(0)
      expect(await page.evaluate(() => window.game.authority.gamerule('doDaylightCycle')))
        .toBe(true)
      const [x1, y1, z1] = await position(page)
      expect(Math.hypot(x1 - x0, y1 - y0, z1 - z0), '/tp moved a non-operator')
        .toBeLessThan(0.5)
    })
})

test.describe('operator commands, opped', () => {
  test.beforeEach(async ({ page }) => { await grantOp(page) })

  test('/gamemode switches mode and reports it in Minecraft\'s words',
    async ({ page }) => {
      const out = await chatCommand(page, '/gamemode creative')
      expect(systemIn(out)).toEqual(['Set own game mode to Creative Mode'])
      expect(await gamemode(page)).toBe('creative')

      const bad = await chatCommand(page, '/gamemode wizard')
      expect(errorsIn(bad)).toEqual(['Unknown game mode: wizard'])
      expect(await gamemode(page)).toBe('creative')
    })

  test('/time set night moves the clock and darkens the sky', async ({ page }) => {
    const out = await chatCommand(page, '/time set night')
    expect(systemIn(out)).toEqual(['Set the time to 13000'])
    expect(await page.evaluate(() => window.game.sky.getTime()))
      .toBeGreaterThanOrEqual(13000)

    await chatCommand(page, '/time set midnight')
    await waitTicks(page, 3)
    // Derived from sun elevation, so this is really "did the whole lighting
    // chain follow the command" -- a clock that moved alone would pass above.
    expect(await skyBlue(page), 'the sky did not darken').toBeLessThan(0.2)
  })

  test('/time add advances the clock from wherever it is', async ({ page }) => {
    await chatCommand(page, '/time set 1000')
    const out = await chatCommand(page, '/time add 5000')
    // The clock is live, so this is a window rather than an equality: a few
    // ticks pass between the two commands.
    const reported = Number(systemIn(out)[0].match(/(\d+)/)[1])
    expect(reported).toBeGreaterThanOrEqual(6000)
    expect(reported).toBeLessThan(6200)
  })

  test('/tp moves the player', async ({ page }) => {
    /*
     * y=160 rather than the old y=70. Not a weakened assertion -- the same
     * claim against a world that moved. Sea level used to be y=64, so 70 was
     * six blocks of air above the island; in the imported patch y=70 is two
     * hundred blocks underground, and "you land on the ground" would have
     * been asserting that you were embedded in deepslate.
     *
     * The ground at (6, -6) is grass at y=138, so 160 is a 22-block drop.
     */
    const out = await chatCommand(page, '/tp 6 160 -6')
    expect(systemIn(out)).toEqual([`Teleported ${await playerName(page)} to 6, 160, -6`])
    const [x, y, z] = await position(page)
    expect(x).toBeCloseTo(6, 1)
    expect(z).toBeCloseTo(-6, 1)
    // y drifts immediately -- you start falling the moment you arrive.
    expect(y).toBeLessThanOrEqual(160)
    expect(y).toBeGreaterThan(SURFACE_Y - 1)
  })

  test('/tp understands tilde coordinates', async ({ page }) => {
    const [x0, , z0] = await position(page)
    await chatCommand(page, '/tp ~3 ~ ~')
    const [x1, , z1] = await position(page)
    expect(x1 - x0).toBeCloseTo(3, 1)
    expect(z1 - z0).toBeCloseTo(0, 1)
  })

  test('/give fills a slot, and rejects an item that does not exist',
    async ({ page }) => {
      const out = await chatCommand(page, '/give diamond_ore 7')
      expect(systemIn(out)).toEqual([`Gave 7 [Diamond Ore] to ${await playerName(page)}`])
      expect(await invCount(page, 16)).toBe(7)

      const bad = await chatCommand(page, '/give unobtainium 1')
      expect(errorsIn(bad)).toEqual(["Unknown item 'unobtainium'"])
    })

  // /give resolves ITEMS, not blocks: a pickaxe has no block, so a
  // block-only lookup could never hand one over.
  test('/give works for an item that is not a block', async ({ page }) => {
    const out = await chatCommand(page, '/give iron_pickaxe 1')
    expect(systemIn(out)).toEqual([`Gave 1 [Iron Pickaxe] to ${await playerName(page)}`])
  })

  test('/setblock and /fill change the world', async ({ page, terrain }) => {
    await terrain.keep([6, 70, 6], [8, 71, 8])

    const one = await chatCommand(page, '/setblock 6 70 6 stone')
    expect(systemIn(one)).toEqual(['Changed the block at 6, 70, 6'])
    expect(await getBlock(page, 6, 70, 6)).toBe(ID.stone)

    const many = await chatCommand(page, '/fill 7 70 7 8 71 8 planks')
    expect(systemIn(many)).toEqual(['Successfully filled 8 blocks'])
    expect(await getBlock(page, 7, 70, 7)).toBe(ID.planks)
    expect(await getBlock(page, 8, 71, 8)).toBe(ID.planks)
  })

  test('/gamerule doDaylightCycle false actually stops the clock',
    async ({ page }) => {
      const out = await chatCommand(page, '/gamerule doDaylightCycle false')
      expect(systemIn(out)).toEqual(['Game rule doDaylightCycle is now set to: false'])

      const t0 = await page.evaluate(() => window.game.sky.getTime())
      await waitTicks(page, 30)   // a full second of world time
      expect(await page.evaluate(() => window.game.sky.getTime()),
        'the clock kept running with doDaylightCycle off').toBe(t0)

      // And it starts again, rather than being permanently pinned.
      await chatCommand(page, '/gamerule doDaylightCycle true')
      await waitTicks(page, 30)
      expect(await page.evaluate(() => window.game.sky.getTime()))
        .toBeGreaterThan(t0)
    })

  test('/gamerule fallDamage false is wired to real damage',
    async ({ page, flatGround }) => {
      /*
       * A game rule that reports a value nothing reads is a lie with a nice
       * error message, so this drops the player rather than checking the flag.
       *
       * IT USED TO DROP TO y=76 DOWN THE SPAWN COLUMN, and that is the whole
       * bug it was failing on: y=76 was open air over a sea-level island, and
       * the world has been an imported Minecraft patch with its floor at
       * y=136 for a long time now. So /tp put the player under the bottom of
       * the world, they died of the void ("Guest fell out of the world" is
       * what the failure screenshot showed), and the wait for a landing that
       * was never coming timed out ten seconds later. The rule itself was
       * never broken -- main.js:277 reads it inside allowDamage, on demand,
       * so unlike doDaylightCycle (re-driven into sky every tick at main.js
       * :420) there is nothing here that could quietly overwrite a setter.
       *
       * THE PAD rather than a fixed terrain column, for 30-death-messages'
       * hard-won reason: one page is shared by every spec, so the ground under
       * a hardcoded column is whatever the spec before it left there. The pad
       * is the only surface whose height this test actually knows.
       */
      await flatGround.build()
      await chatCommand(page, '/gamerule fallDamage false')

      /*
       * 10.5 blocks, so a pass cannot be a fall that was simply too short to
       * hurt: damage is floor(d - 3), which is 7 half-hearts at this height.
       * Off the integer boundary on purpose -- the peak is first sampled on
       * the first AIRBORNE tick, already a centimetre down, so sampling only
       * ever loses height (08-death.spec.js spells this out).
       */
      const drop = () => chatCommand(page,
        `/tp ${PAD_X0 + 0.5} ${PAD_Y + 10.5} ${PAD_Z + 0.5}`)
      await drop()
      await settleOnGround(page)
      expect(await page.evaluate(() => window.game.survival.health),
        'the fall hurt with fallDamage off').toBe(20)

      /*
       * The control arm, and it is the half that makes this test about the
       * RULE. Without it an engine that had lost fall damage entirely would
       * sail through the assertion above, which is exactly the "reports a
       * value nothing reads" failure the test was written to catch -- only
       * pointing the other way.
       */
      await chatCommand(page, '/gamerule fallDamage true')
      await drop()
      await settleOnGround(page)
      expect(await page.evaluate(() => window.game.survival.health),
        'the same fall was free with fallDamage back on').toBe(13)
    })

  test('/gamerule with no value queries it instead of setting it',
    async ({ page }) => {
      const out = await chatCommand(page, '/gamerule naturalRegeneration')
      expect(systemIn(out)).toEqual(['Game rule naturalRegeneration is currently set to: true'])

      const bad = await chatCommand(page, '/gamerule doTileDrops')
      expect(errorsIn(bad)).toEqual(['Unknown game rule: doTileDrops'])
    })

  /*
   * /weather used to report honestly that there was nothing to set. weather.js
   * landed and main.js wires it, so the command acts now -- and the trailing
   * /weather clear is not tidiness: a spec left in the rain changes the light
   * level and the frame rate for whatever runs next.
   */
  test('/weather sets the weather and parses like vanilla', async ({ page }) => {
    const out = await chatCommand(page, '/weather rain')
    expect(systemIn(out)).toEqual(['Set the weather to rain'])
    expect(await page.evaluate(() => window.game.weather.kind)).toBe('rain')

    const bad = await chatCommand(page, '/weather sideways')
    expect(errorsIn(bad)).toEqual([REFUSED, '/weather sideways<--[HERE]'])
    await chatCommand(page, '/weather clear')
  })
})
