import { test, expect } from './fixtures.js'
import { aim, teleport, waitTicks, settleOnGround, reloadWorld, SURFACE_Y } from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * AI Evan: identity, the NPC, the nametags, and the tool loop that connects
 * them.
 *
 * The assertion that matters most in this file is not "the player got
 * renamed" -- a regex in a chat handler passes that. It is that the rename
 * arrived as a `tool_use` block for `set_player_name` in the Anthropic
 * transcript, and that the world state moved because a TOOL RAN. That is the
 * seam a real model plugs into, and it is the only part of this slice that
 * would be expensive to discover was fake later.
 */

/** Where Evan stands, and a spot inside his greeting radius. One block west
 *  of him -- he is at x = -4.5, which moved with the terrain when the asset
 *  stopped being mirrored in X. Same column, other side of spawn. */
const NEAR_EVAN = [-3.5, SURFACE_Y, 0.5]

/**
 * Say something in chat the way a player does -- T, type, Enter -- rather
 * than by calling the transport. The whole path is the point: chat.js's
 * capture-phase keydown, the input lock, the transport, the NPC hand-off.
 */
async function chatSay(page, text) {
  const before = await lineCount(page)
  await page.keyboard.press('KeyT')
  await page.waitForFunction(() => window.game.chat.isOpen, null, { timeout: 5000 })
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !window.game.chat.isOpen, null, { timeout: 5000 })
  /*
   * Wait for the REPLY, not for a fixed number of ticks. He deliberately
   * takes a beat before answering (see LATENCY_MS in aiEvan.js), so a tick
   * count here would be a race that got slower to fail the moment the real
   * backend landed. Two lines: your own echo, then his.
   */
  await page.waitForFunction(
    (n) => document.querySelectorAll('#chat-lines .chat-line').length > n + 1,
    before, { timeout: 15000 })
}

const lineCount = (page) => page.evaluate(
  () => document.querySelectorAll('#chat-lines .chat-line').length)

const chatLines = (page) => page.evaluate(() =>
  [...document.querySelectorAll('#chat-lines .chat-line')].map((el) => el.textContent))

const transcript = (page) => page.evaluate(() => window.game.aiEvan.session.transcript)

/**
 * Put identity back to what a stranger gets.
 *
 * resetWorld cannot do this: it teleports you to spawn, which is four blocks
 * from Evan and therefore still inside his LEAVE_RADIUS, so `talking` and the
 * transcript both survive a reset. And the name is persisted to localStorage
 * on purpose, so it survives everything.
 */
async function resetIdentity(page) {
  await page.evaluate(() => {
    const { roster, aiEvan, LOCAL_ID } = window.game
    aiEvan._setTalking(false)
    roster.setName(LOCAL_ID, 'Guest')
    roster.forget()
  })
}

test.beforeEach(async ({ page }) => { await resetIdentity(page) })
test.afterEach(async ({ page }) => { await resetIdentity(page) })

test('a visitor arrives as Guest, and the name is a roster entry not a string',
  async ({ page }) => {
    const who = await page.evaluate(() => {
      const { roster, LOCAL_ID } = window.game
      const entry = roster.get(LOCAL_ID)
      return { name: entry.name, local: entry.local, display: roster.displayNameOf(LOCAL_ID) }
    })
    expect(who).toEqual({ name: 'Guest', local: true, display: 'Guest' })
  })

test('Evan stands under a plain nameplate and talks with an [Admin] tag',
  async ({ page }) => {
    const evan = await page.evaluate(async () => {
      const { BLOCK_BY_ID } = await import('/src/blocks.js')
      const { roster, aiEvan, EVAN_ID, EVAN_POS } = window.game
      return {
        display: roster.displayNameOf(EVAN_ID),
        rank: roster.get(EVAN_ID).prefix.text,
        kind: roster.get(EVAN_ID).kind,
        tag: aiEvan.nametag.text,
        pos: EVAN_POS,
        // Two meshes, because vanilla draws the tag twice -- see nametag.js.
        meshes: aiEvan.nametag.meshes.length,
        // What he is actually standing on, read from the generator so it does
        // not depend on his chunk being resident.
        solidBelow: window.game.voxelAt(
          Math.floor(EVAN_POS[0]), EVAN_POS[1] - 1, Math.floor(EVAN_POS[2])) !== 0,
        airAtFeet: window.game.voxelAt(
          Math.floor(EVAN_POS[0]), EVAN_POS[1], Math.floor(EVAN_POS[2])) === 0,
        standingOn: BLOCK_BY_ID.get(window.game.voxelAt(
          Math.floor(EVAN_POS[0]), EVAN_POS[1] - 1, Math.floor(EVAN_POS[2])))?.key ?? 'air',
      }
    })
    expect(evan.kind).toBe('npc')
    expect(evan.meshes).toBe(2)

    /*
     * He stands ON THE GROUND, asserted as that rather than as `SURFACE_Y`.
     * SURFACE_Y is the height of the SPAWN column and Evan does not stand in
     * it -- the two matched by coincidence, and the coincidence held until the
     * terrain asset stopped being mirrored in X and his column moved out from
     * under him. The old assertion then failed with "expected 136, got 142",
     * which is a true report of a wrong number and says nothing about the
     * thing anyone cares about: that he is not hovering, buried, or perched in
     * a treetop.
     *
     * Three claims, because those are three different bugs: something solid
     * directly beneath his feet, air where his feet are, and the solid thing
     * is not foliage. Leaves pass "is not air" perfectly happily, and a
     * character standing on a canopy is exactly the failure the ground scan in
     * main.js exists to avoid.
     */
    expect(evan.solidBelow, 'nothing under Evan -- he is hovering').toBe(true)
    expect(evan.airAtFeet, 'Evan is standing inside a block').toBe(true)
    expect(evan.standingOn, `Evan is standing on ${evan.standingOn}`)
      .not.toMatch(/_leaves$/)

    /*
     * The rank is not part of his NAME -- it is a chat format, so the roster
     * and the nameplate both answer `Evan` and the rank sits on the entry
     * waiting for chat.js. The test below asserts the other half, that it
     * does reach the chat line, because "nowhere" and "not on the nameplate"
     * are different bugs and only one of them is a fix.
     */
    expect(evan.tag).toBe('Evan')
    expect(evan.display).toBe('Evan')
    // The rank exists -- as data on the entry that only chat.js reads.
    expect(evan.rank).toBe('[Admin] ')
  })

test('the rank is on the chat line, in the server format, and nowhere else',
  async ({ page }) => {
    await teleport(page, ...NEAR_EVAN)
    await settleOnGround(page)
    await waitTicks(page, 3)
    await chatSay(page, 'my name is Robin')

    const lines = await chatLines(page)

    /*
     * BOTH SPEAKERS, because the format is not a special case for the one
     * with a rank -- an unranked player has an EMPTY prefix, not a different
     * line shape. Asserting only Evan would pass just as happily if the
     * player kept vanilla's angle brackets.
     */
    /*
     * ALL THREE FORMS, because each one can regress without the others
     * noticing. A ranked speaker is `[Admin] <Evan> ...`; an unranked one is
     * vanilla's bare `<Guest> ...` with no rank and no colon; and a SYSTEM
     * line -- death, join, leave, command output -- takes the undecorated
     * name and gets neither. Asserting only Evan's line would pass just as
     * happily if every player on the server had grown a rank.
     */
    expect(lines.some((l) => l.startsWith('[Admin] <Evan> '))).toBe(true)
    // Echoed before he had renamed you, so this line is still Guest's -- and
    // Guest is exactly the unranked case worth asserting.
    expect(lines.some((l) => l.startsWith('<Guest> my name is Robin'))).toBe(true)
    expect(lines.some((l) => l.startsWith('[Admin] <Guest>'))).toBe(false)

    // The rank is red. It is a separate span precisely so it can be.
    const rankColor = await page.evaluate(() => {
      const line = [...document.querySelectorAll('#chat-lines .chat-line')]
        .find((el) => el.textContent.startsWith('[Admin] <Evan> '))
      return getComputedStyle(line.querySelector('span')).color
    })
    expect(rankColor).toBe('rgb(170, 0, 0)')

    /*
     * A system line, through the same call main.js makes. `Evan joined the
     * game` -- the bare name, which is the same rule that makes a death
     * message read `Bob was slain by Evan`.
     */
    await page.evaluate(() => window.game.chat
      .announceJoin(window.game.roster.displayNameOf(window.game.EVAN_ID)))
    const joined = (await chatLines(page)).at(-1)
    expect(joined).toBe('Evan joined the game')

    /*
     * ...and none of that reached a NAME. The nameplate is the name alone,
     * and so is what the roster answers when anything asks who he is -- which
     * is what /kill and /tp quote.
     */
    const names = await page.evaluate(() => {
      const { roster, aiEvan, EVAN_ID, LOCAL_ID } = window.game
      return {
        tag: aiEvan.nametag.text,
        evan: roster.displayNameOf(EVAN_ID),
        you: roster.displayNameOf(LOCAL_ID),
        rank: roster.get(EVAN_ID).prefix.text,
      }
    })
    expect(names.tag).toBe('Evan')
    expect(names.evan).toBe('Evan')
    expect(names.you).toBe('Robin')
    // The rank still exists -- it is just data on the entry that only chat reads.
    expect(names.rank).toBe('[Admin] ')

    /*
     * The rename path too, because the nameplate is redrawn from a roster
     * event and that is a SECOND place the name and the rank could get wired
     * together. Your own tag has no rank to gain, so Evan is the one that can
     * regress.
     */
    await page.evaluate(() => window.game.roster.setName(window.game.EVAN_ID, 'Ev'))
    expect(await page.evaluate(() => window.game.aiEvan.nametag.text)).toBe('Ev')
    expect(await page.evaluate(() => window.game.roster.displayNameOf(window.game.EVAN_ID)))
      .toBe('Ev')
    await page.evaluate(() => window.game.roster.setName(window.game.EVAN_ID, 'Evan'))
  })

test('the nameplate sits 2.3 blocks up and faces the camera', async ({ page }) => {
  await teleport(page, ...NEAR_EVAN)
  await settleOnGround(page)
  await aim(page, { heading: Math.PI / 2, pitch: 0 })
  await waitTicks(page, 2)

  const tag = await page.evaluate(() => {
    const { aiEvan } = window.game
    const mesh = aiEvan.nametag.meshes[0]
    const cam = window.noa.rendering.getScene().activeCamera
    return {
      /*
       * Measured against the MODEL's feet, not against EVAN_POS. noa rebases
       * the scene origin as you travel, so a world y and a scene y differ by
       * however far the origin has drifted -- and comparing the two is
       * exactly the bug this assertion caught when it was written the other
       * way (the model was placed 138 blocks up and nothing else noticed).
       *
       * getNameTagOffsetY() is bbHeight + 0.5 = 2.3, and the plane's centre
       * is another 4 font pixels (0.1 blocks) above that anchor.
       */
      above: mesh.position.y - aiEvan.model.root.position.y,
      quat: mesh.rotationQuaternion.asArray(),
      camQuat: cam.absoluteRotation.asArray(),
      // 10 font pixels tall at 0.025 blocks each.
      height: mesh.scaling.y,
    }
  })
  expect(tag.above).toBeCloseTo(2.3 + 0.1, 5)
  expect(tag.height).toBeCloseTo(0.25, 5)
  // cameraOrientation(), copied, not a look-at billboard.
  for (let i = 0; i < 4; i++) expect(tag.quat[i]).toBeCloseTo(tag.camQuat[i], 6)
})

test('your own nameplate is hidden in first person and shown in third',
  async ({ page }) => {
    const shown = () => page.evaluate(() =>
      window.game.perspective.nametag.meshes.map((m) => m.isEnabled()))

    expect(await page.evaluate(() => window.game.perspective.isFirstPerson)).toBe(true)
    expect(await shown()).toEqual([false, false])

    await page.keyboard.press('F5')
    await waitTicks(page, 2)
    expect(await page.evaluate(() => window.game.perspective.mode)).toBe('third-back')
    expect(await shown()).toEqual([true, true])
    expect(await page.evaluate(() => window.game.perspective.nametag.text)).toBe('Guest')

    // Back to first person, or the next spec inherits a third-person camera.
    await page.keyboard.press('F5')
    await page.keyboard.press('F5')
    await waitTicks(page, 2)
  })

test('walking up to Evan starts a conversation, and he asks for your name',
  async ({ page }) => {
    expect(await page.evaluate(() => window.game.aiEvan.talking)).toBe(false)

    await teleport(page, ...NEAR_EVAN)
    await settleOnGround(page)
    await waitTicks(page, 3)

    expect(await page.evaluate(() => window.game.aiEvan.talking)).toBe(true)
    const lines = await chatLines(page)
    const greeting = lines[lines.length - 1]
    // Vanilla's `<%s> %s` with the rank in front of it. See chat.js for the
    // format that was tried and reverted.
    expect(greeting.startsWith('[Admin] <Evan> ')).toBe(true)
    expect(greeting).toContain('What should I call you?')

    // And it did not take the player prisoner to do it.
    expect(await page.evaluate(() => window.game.inputLock.locked)).toBe(false)
  })

test('telling Evan your name renames you THROUGH A TOOL CALL', async ({ page }) => {
  await teleport(page, ...NEAR_EVAN)
  await settleOnGround(page)
  await waitTicks(page, 3)

  await chatSay(page, 'my name is Casey')

  /*
   * The load-bearing assertion. Not "the name changed" -- that is three lines
   * down -- but "the model emitted a tool_use block and the tool layer ran
   * it". Read straight off the Anthropic message array the loop built.
   */
  const msgs = await transcript(page)
  const calls = msgs
    .filter((m) => m.role === 'assistant' && Array.isArray(m.content))
    .flatMap((m) => m.content)
    .filter((b) => b.type === 'tool_use')
  expect(calls.map((c) => c.name)).toEqual(['set_player_name'])
  // The MODEL parsed the name out of the sentence; the tool got the name.
  expect(calls[0].input).toEqual({ name: 'Casey' })

  const results = msgs
    .filter((m) => m.role === 'user' && Array.isArray(m.content))
    .flatMap((m) => m.content)
    .filter((b) => b.type === 'tool_result')
  expect(results).toHaveLength(1)
  expect(results[0].is_error).toBe(false)
  expect(results[0].tool_use_id).toBe(calls[0].id)
  expect(JSON.parse(results[0].content)).toMatchObject({ ok: true, name: 'Casey' })

  // ...and the world moved because the tool ran.
  const after = await page.evaluate(() => ({
    name: window.game.roster.get(window.game.LOCAL_ID).name,
    tag: window.game.perspective.nametag.text,
    stored: window.game.roster.stored(),
  }))
  expect(after).toEqual({ name: 'Casey', tag: 'Casey', stored: 'Casey' })

  // Chat starts showing the real name instead of Guest.
  await chatSay(page, 'what do you do')
  const lines = await chatLines(page)
  expect(lines.some((l) => l.startsWith('<Casey> what do you do'))).toBe(true)
  expect(lines.some((l) => l.includes('Casey! Good to meet you'))).toBe(true)
})

test('the name can come first, last, or on its own', async ({ page }) => {
  await teleport(page, ...NEAR_EVAN)
  await settleOnGround(page)
  await waitTicks(page, 3)

  /*
   * "plop is my name" is the ordering that used to fall straight through to
   * "Didn't catch a name in there" -- the stub only knew the name-behind
   * phrasings. Driven through chat rather than by calling parseName, because
   * what broke was the CONVERSATION, and a unit test on the regex would have
   * been green while the screenshot was not.
   */
  await chatSay(page, 'Casey is my name')

  const msgs = await transcript(page)
  const calls = msgs.filter((m) => m.role === 'assistant' && Array.isArray(m.content))
    .flatMap((m) => m.content).filter((b) => b.type === 'tool_use')
  expect(calls.map((c) => c.name)).toEqual(['set_player_name'])
  expect(calls[0].input).toEqual({ name: 'Casey' })
  expect(await page.evaluate(() => window.game.roster.get(window.game.LOCAL_ID).name))
    .toBe('Casey')
})

test('a greeting is not a name -- he asks again and you stay Guest',
  async ({ page }) => {
    await teleport(page, ...NEAR_EVAN)
    await settleOnGround(page)
    await waitTicks(page, 3)

    await chatSay(page, 'hello')

    const msgs = await transcript(page)
    const calls = msgs.filter((m) => m.role === 'assistant' && Array.isArray(m.content))
      .flatMap((m) => m.content).filter((b) => b.type === 'tool_use')
    expect(calls).toHaveLength(0)
    expect(await page.evaluate(() => window.game.roster.get(window.game.LOCAL_ID).name))
      .toBe('Guest')
    const lines = await chatLines(page)
    expect(lines[lines.length - 1]).toContain('Didn\'t catch a name')
  })

test('the second tool reads world state rather than writing it', async ({ page }) => {
  await teleport(page, ...NEAR_EVAN)
  await settleOnGround(page)
  await waitTicks(page, 3)
  await chatSay(page, 'my name is Robin')
  await chatSay(page, 'where am I')

  const msgs = await transcript(page)
  const calls = msgs.filter((m) => m.role === 'assistant' && Array.isArray(m.content))
    .flatMap((m) => m.content).filter((b) => b.type === 'tool_use')
  expect(calls.map((c) => c.name)).toEqual(['set_player_name', 'get_player_state'])
  // A read tool with no arguments: the shape set_player_name alone would not
  // have forced the registry to support.
  expect(calls[1].input).toEqual({})

  const state = JSON.parse(msgs.flatMap((m) => Array.isArray(m.content) ? m.content : [])
    .filter((b) => b.type === 'tool_result').at(-1).content)
  expect(state.yourName).toBe('Robin')
  expect(state.distanceToEvan).toBeCloseTo(1, 1)
  expect(state.position[0]).toBeCloseTo(NEAR_EVAN[0], 1)

  const lines = await chatLines(page)
  expect(lines[lines.length - 1]).toContain('blocks from me')
})

test('the tools are published in Anthropic\'s format', async ({ page }) => {
  const schemas = await page.evaluate(() => window.game.aiEvan.toolSchemas)
  expect(schemas.map((s) => s.name)).toEqual(['set_player_name', 'get_player_state'])
  for (const schema of schemas) {
    // What goes in the `tools` field of a /v1/messages request, verbatim.
    expect(Object.keys(schema).sort()).toEqual(['description', 'input_schema', 'name'])
    expect(schema.input_schema.type).toBe('object')
    expect(typeof schema.description).toBe('string')
  }
  expect(schemas[0].input_schema.required).toEqual(['name'])
})

test('the name you gave him survives a reload', async ({ page }) => {
  await teleport(page, ...NEAR_EVAN)
  await settleOnGround(page)
  await waitTicks(page, 3)
  await chatSay(page, "I'm Jordan")
  expect(await page.evaluate(() => window.game.roster.stored())).toBe('Jordan')

  await reloadWorld(page)

  // A server would own this; localStorage is standing in. Either way the name
  // is not re-asked for on every visit.
  expect(await page.evaluate(() => window.game.roster.get(window.game.LOCAL_ID).name))
    .toBe('Jordan')
  expect(await page.evaluate(() => window.game.perspective.nametag.text)).toBe('Jordan')
})

test('he waits a beat before answering, the way a real backend will',
  async ({ page }) => {
    await teleport(page, ...NEAR_EVAN)
    await settleOnGround(page)
    await waitTicks(page, 3)

    const before = await lineCount(page)
    await page.keyboard.press('KeyT')
    await page.waitForFunction(() => window.game.chat.isOpen, null, { timeout: 5000 })
    await page.keyboard.type('my name is Sam')
    await page.keyboard.press('Enter')

    /*
     * YOUR line is local echo and lands at once -- that is the control. If
     * this waited on Evan instead, a broken delay and a broken chat box would
     * look the same from here.
     */
    await page.waitForFunction(
      (n) => document.querySelectorAll('#chat-lines .chat-line').length > n,
      before, { timeout: 5000 })
    const sent = Date.now()

    // Nothing from him yet. A model round trip has not had time to happen.
    await page.waitForTimeout(300)
    expect(await lineCount(page)).toBe(before + 1)

    await page.waitForFunction(
      (n) => document.querySelectorAll('#chat-lines .chat-line').length > n + 1,
      before, { timeout: 15000 })
    const waited = Date.now() - sent

    /*
     * Bounded on both sides. The floor is the point of the feature; the
     * ceiling is what stops a delay that is secretly broken-and-slow from
     * passing. Deliberately loose against LATENCY_MS (900-2100) because this
     * runs on software GL and the keystroke-to-send path is not free.
     */
    expect(waited).toBeGreaterThan(500)
    expect(waited).toBeLessThan(8000)
  })

test('he admits there is no model rather than answering with coordinates',
  async ({ page }) => {
    await teleport(page, ...NEAR_EVAN)
    await settleOnGround(page)
    await waitTicks(page, 3)
    await chatSay(page, 'my name is Sam')

    /*
     * THE SCREENSHOT THAT STARTED THIS. "where does Evan work" contains the
     * word "where", the stub's only read tool reports your position, and so a
     * question about a career came back as "you're at 2, 136, -1". Whatever
     * he says now, it must not be a coordinate readout.
     */
    await chatSay(page, 'where does Evan work')
    let lines = await chatLines(page)
    expect(lines[lines.length - 1]).not.toContain('blocks from me')
    expect(lines[lines.length - 1]).toContain('for a living')

    // And something genuinely outside the script is refused in character,
    // by saying what is actually true: there is nothing behind him yet.
    await chatSay(page, 'what is your favourite colour')
    lines = await chatLines(page)
    expect(lines[lines.length - 1]).toContain('no model behind this Evan yet')

    // Neither of those was worth a tool call. get_player_state is for
    // questions about where YOU are, and neither of these was one.
    const msgs = await transcript(page)
    const calls = msgs.filter((m) => m.role === 'assistant' && Array.isArray(m.content))
      .flatMap((m) => m.content).filter((b) => b.type === 'tool_use')
    expect(calls.map((c) => c.name)).toEqual(['set_player_name'])

    // The tool still fires for the question it is actually for.
    await chatSay(page, 'where am I')
    lines = await chatLines(page)
    expect(lines[lines.length - 1]).toContain('blocks from me')
  })

/*
 * EVIDENCE, not assertions. Nametags are the one part of this slice no number
 * in this file can honestly judge.
 */
test('screenshots: Evan\'s nameplate, and your own in third person',
  async ({ page }) => {
    await teleport(page, 0.5, SURFACE_Y, 0.5)
    await settleOnGround(page)
    await aim(page, { heading: Math.PI / 2, pitch: 0 })
    await waitTicks(page, 4)
    await shot(page, 'npc-evan-nametag')

    await page.evaluate(() => window.game.roster.setName(window.game.LOCAL_ID, 'Casey'))
    await page.keyboard.press('F5')
    await waitTicks(page, 4)
    await shot(page, 'own-nametag-third-person')

    await page.keyboard.press('F5')
    await page.keyboard.press('F5')
    await waitTicks(page, 2)
  })
