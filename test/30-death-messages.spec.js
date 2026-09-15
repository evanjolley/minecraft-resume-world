import { test, expect } from './fixtures.js'
import {
  PAD_X0, PAD_Y, PAD_Z, teleport, waitTicks, settleOnGround,
  chatCommand, playerName,
} from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * Death messages: the line vanilla prints to chat when somebody dies.
 *
 * WHAT MAKES THESE TESTS WORTH ANYTHING. A death message system that is
 * completely unwired still puts a line in chat -- `Evan died`, the
 * death.attack.generic fallback -- so a spec that asserts "a system line
 * appeared" passes against a build where the cause never leaves survival.js.
 * Every assertion below therefore pins the WHOLE string, and each cause has a
 * different one. Verified by breaking it: dropping the `cause` argument in
 * survival.js's damage() call sites turns every one of these red with
 * `Evan died` on the left of the diff, and restoring it turns them green.
 *
 * The strings are from minecraft.wiki/w/Death_messages, which is en_us.json --
 * death.attack.drown, death.fell.accident.generic and friends. They are
 * spelled out here rather than imported from src/deathMessages.js ON PURPOSE:
 * importing the table would make this a tautology that passes no matter what
 * the wording is. These are FIDELITY CONSTANTS, the same argument helpers/
 * world.js makes about block ids.
 */

/** Mirrors island.js's VOID_Y, the same way 08-death.spec.js does. */
const VOID_Y = -70

/**
 * Chat lines added since `mark`. Same shape chatCommand returns, and read off
 * the DOM rather than off any chat API, because the thing under test includes
 * the rendering.
 */
const mark = (page) =>
  page.evaluate(() => document.querySelectorAll('#chat-lines .chat-line').length)

const linesSince = (page, n) =>
  page.evaluate((from) => [...document.querySelectorAll('#chat-lines .chat-line')]
    .slice(from)
    .map((el) => ({ kind: el.dataset.kind, text: el.textContent })), n)

const waitForDeath = (page) =>
  page.waitForFunction(() => window.game.survival.dead, null, { timeout: 15_000, polling: 20 })

/** The death line, or undefined. Deaths also play a sound; nothing else talks. */
const deathLine = async (page, from) =>
  (await linesSince(page, from)).find((l) => l.kind === 'system')

/**
 * Die of `cause` by calling the damage path directly, then return the line.
 *
 * Used for the causes that are real but not reachable inside a test's patience:
 * drowning is 300 ticks of held breath plus a swim, and burning to death is
 * twenty seconds of one damage a second. The cause STRINGS here are not
 * invented for the test -- they are the literals survival.js tags those hits
 * with ('drown' from breathe(), 'lava' and 'onFire' from lavaBurn and the fire
 * tick) -- so this exercises the same table lookup the slow path would.
 *
 * Rejected: reaching past survival and calling chat.announceDeath directly.
 * That tests the sentence and skips the wiring, which is the half that breaks.
 */
async function dieOf(page, cause) {
  const from = await mark(page)
  await page.evaluate((c) => window.game.survival.damage(20, c), cause)
  await waitTicks(page, 2)
  return deathLine(page, from)
}

test.describe('death messages', () => {
  test('falling out of the world says so, in plain white system chat',
    async ({ page }) => {
      const who = await playerName(page)
      const from = await mark(page)

      await teleport(page, 0.5, VOID_Y + 4, 0.5)
      await waitForDeath(page)
      await waitTicks(page, 2)

      const line = await deathLine(page, from)
      expect(line?.text).toBe(`${who} fell out of the world`)

      /*
       * 'system', not 'join'. Join and leave are yellow in vanilla because
       * they carry §e; a death message carries no formatting code and renders
       * white. Asserting the kind is how that stays true -- the colour itself
       * is a computed style two indirections away from the decision.
       */
      expect(line?.kind).toBe('system')
    })

  test('a long fall is a high place and a short one is the ground, and they differ',
    async ({ page, flatGround }) => {
      /*
       * ON THE PAD, not on the terrain, and this is the one thing in this file
       * that was learned the hard way: the first version dropped onto the real
       * surface at DROP_X/DROP_Z and passed alone, then timed out in the full
       * suite waiting for a death that never came. The worker shares one page
       * across specs, so the ground under a hardcoded column is whatever the
       * spec before it left there -- and the short fall below has a window of
       * less than two blocks to land in. A pad built and torn down by the
       * fixture is the only surface whose height this test actually knows.
       */
      await flatGround.build()
      const who = await playerName(page)

      /*
       * The split is vanilla's, at five blocks fallen, and it is the one piece
       * of this feature that needed a number plumbed rather than a cause: the
       * distance never used to leave survival.js's fall tracker.
       *
       * Neither height is near the boundary, on purpose. The peak is first
       * sampled on the first AIRBORNE tick, already a few centimetres below
       * the teleport (08-death spells this out), and sampling only ever LOSES
       * height -- never gains it. So 4.9 is safe on both sides: it can only
       * measure under 5 (the short string), and it has most of a block of slack
       * before it drops under 4 and stops doing damage at all.
       */
      let from = await mark(page)
      // 30 blocks, because the fall has to be REAL for the distance to be
      // real: damage is floor(d - 3), so 23 is the shortest drop that empties
      // twenty health outright. Calling damage(20, 'fall') by hand instead
      // would carry no distance at all and would quietly assert the wrong
      // branch -- which is exactly the failure this whole file exists to catch.
      await teleport(page, PAD_X0 + 0.5, PAD_Y + 30, PAD_Z + 0.5)
      await waitForDeath(page)
      await waitTicks(page, 2)
      expect((await deathLine(page, from))?.text).toBe(`${who} fell from a high place`)

      /*
       * The short one, and it is a real death rather than a contrived one:
       * fall damage is floor(distance - 3), so a 4.9-block drop costs exactly
       * one half-heart, which kills anyone already down to their last. Softened
       * to 1 health first, then dropped -- so the killing blow really is a
       * four-block fall and really is under the threshold.
       */
      // reset() FIRST, and it is not just tidiness: respawn.js zeroes the
      // corpse's gravity the moment you die, so a teleport before the reset
      // leaves you hanging in the air and settleOnGround waits forever.
      // (That is what this test did on its first run.)
      await page.evaluate(() => window.game.survival.reset())
      await teleport(page, PAD_X0 + 0.5, PAD_Y, PAD_Z + 0.5)
      await settleOnGround(page)
      await page.evaluate(() => {
        window.game.survival.clearFallTracking()
        window.game.survival.damage(19, 'generic')   // down to half a heart
      })

      from = await mark(page)
      await teleport(page, PAD_X0 + 0.5, PAD_Y + 4.9, PAD_Z + 0.5)
      await waitForDeath(page)
      await waitTicks(page, 2)

      expect((await deathLine(page, from))?.text).toBe(`${who} hit the ground too hard`)
    })

  test('drowning, lava, burning and starving each get their own line',
    async ({ page }) => {
      const who = await playerName(page)

      // fluids.js drives breathe() until the grace period runs out; the hit it
      // lands is tagged 'drown' inside survival.js.
      expect((await dieOf(page, 'drown'))?.text).toBe(`${who} drowned`)
      await page.evaluate(() => window.game.survival.reset())

      expect((await dieOf(page, 'lava'))?.text).toBe(`${who} tried to swim in lava`)
      await page.evaluate(() => window.game.survival.reset())

      /*
       * 'burned to death', death.attack.onFire -- the fire you are CARRYING
       * for fifteen seconds after climbing out of lava. Vanilla's other fire
       * string, "went up in flames" (death.attack.inFire), needs you to be
       * standing in a fire BLOCK, and this world has none. Picking the honest
       * one of the two is the whole reason this assertion is worth reading.
       */
      expect((await dieOf(page, 'onFire'))?.text).toBe(`${who} burned to death`)
      await page.evaluate(() => window.game.survival.reset())

      /*
       * Starving cannot happen today: survival.js has HUNGER_DRAIN_ENABLED
       * false on purpose, so a visitor reading a resume plot never gets hungry.
       * The 'starve' cause is in that file anyway, behind the flag, so the row
       * is asserted -- the day the flag flips, this is what stops it from
       * silently reporting the generic "died".
       */
      expect((await dieOf(page, 'starve'))?.text).toBe(`${who} starved to death`)
    })

  test('/kill reports being killed, not falling out of the world',
    async ({ page }) => {
      const who = await playerName(page)
      const from = await mark(page)

      await chatCommand(page, '/kill')
      await waitForDeath(page)
      await waitTicks(page, 2)

      /*
       * death.attack.genericKill. Worth its own test because the OBVIOUS
       * answer is wrong in a way that looks right: Entity.kill() used the
       * out-of-world damage source for years, so /kill genuinely did print
       * "fell out of the world" -- just not since 1.16.
       *
       * It also proves the two causes have not been collapsed. /kill and the
       * void both bypass damage() and emit died directly, and wiring one of
       * them to the other's string is the easiest mistake in this file.
       */
      expect((await deathLine(page, from))?.text).toBe(`${who} was killed`)
    })

  test('the death screen shows the same sentence under You Died!',
    async ({ page }) => {
      const who = await playerName(page)

      /*
       * The void, deliberately a DIFFERENT cause from the chat tests above.
       * A screen wired to the cause and a screen hardcoded to whatever the
       * commonest death is look identical until the two disagree.
       */
      await teleport(page, 0.5, VOID_Y + 4, 0.5)
      await waitForDeath(page)
      await waitTicks(page, 2)

      await expect(page.locator('#death')).toBeVisible()
      await expect(page.locator('#death-message'))
        .toHaveText(`${who} fell out of the world`)

      // Evidence, not an assertion: the screen and the chat line together.
      await shot(page, 'death-message')
    })

  test('the message uses the bare name -- no rank, no chat brackets',
    async ({ page }) => {
      /*
       * THE BUG THIS REPO KEEPS RE-LEARNING, and the reason it is tested
       * against EVAN rather than against you: Evan is the roster entry that
       * carries the `[Admin]` prefix, so he is the only one who can expose a
       * composed display string. Asserting on the local player would pass
       * against a broken build purely because Guest has no rank to leak.
       *
       * `<>` are the CHAT FORMAT -- `<Evan> hi` -- and a death message is a
       * system message, which is not in that format. `[Admin]` is a chat rank
       * and belongs to the line, not to the name. Both are read live off the
       * roster rather than hardcoded, for the reason playerName documents.
       *
       * This also exercises the multiplayer shape: announceDeath is handed a
       * name, so it can report a death that is not yours. That is the call a
       * socket handler makes, and it is the same one.
       */
      const evan = await page.evaluate(
        () => window.game.roster.displayNameOf(window.game.EVAN_ID))
      const prefix = await page.evaluate(
        () => window.game.roster.get(window.game.EVAN_ID)?.prefix?.text ?? null)
      expect(prefix, 'Evan lost his rank, so this test can no longer catch the bug')
        .toBeTruthy()

      const from = await mark(page)
      await page.evaluate((id) => {
        const { game } = window
        game.chat.announceDeath(game.roster.displayNameOf(id), { cause: 'lava' })
      }, 'npc:evan')
      await waitTicks(page, 1)

      const line = (await linesSince(page, from))[0]
      expect(line.text).toBe(`${evan} tried to swim in lava`)
      expect(line.text).not.toContain('<')
      expect(line.text).not.toContain(prefix)
    })
})
