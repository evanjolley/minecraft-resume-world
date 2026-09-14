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

/** Where Evan stands, and a spot inside his greeting radius. */
const NEAR_EVAN = [3.5, SURFACE_Y, 0.5]

/**
 * Say something in chat the way a player does -- T, type, Enter -- rather
 * than by calling the transport. The whole path is the point: chat.js's
 * capture-phase keydown, the input lock, the transport, the NPC hand-off.
 */
async function chatSay(page, text) {
  await page.keyboard.press('KeyT')
  await page.waitForFunction(() => window.game.chat.isOpen, null, { timeout: 5000 })
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !window.game.chat.isOpen, null, { timeout: 5000 })
  // The agent loop is async -- the stub still awaits, exactly as a fetch will.
  await waitTicks(page, 3)
}

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

test('Evan is standing in the world under an [Admin] nameplate', async ({ page }) => {
  const evan = await page.evaluate(() => {
    const { roster, aiEvan, EVAN_ID, EVAN_POS } = window.game
    return {
      display: roster.displayNameOf(EVAN_ID),
      kind: roster.get(EVAN_ID).kind,
      tag: aiEvan.nametag.text,
      pos: EVAN_POS,
      // Two meshes, because vanilla draws the tag twice -- see nametag.js.
      meshes: aiEvan.nametag.meshes.length,
    }
  })
  expect(evan.display).toBe('[Admin] Evan')
  expect(evan.kind).toBe('npc')
  // The nameplate carries the team prefix, exactly as the chat line does.
  expect(evan.tag).toBe('[Admin] Evan')
  expect(evan.meshes).toBe(2)
  expect(evan.pos[1]).toBe(SURFACE_Y)
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
    // Vanilla's chat.type.text is `<%s> %s`, with the team prefix inside the
    // brackets because on a real server it is part of the display name.
    expect(greeting.startsWith('<[Admin] Evan> ')).toBe(true)
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
