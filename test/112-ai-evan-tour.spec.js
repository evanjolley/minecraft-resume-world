import { DatabaseSync } from 'node:sqlite'
import { test, expect } from './fixtures.js'
import { teleport, settleOnGround, SURFACE_Y } from './helpers/world.js'

import { findPath, waypoints, standable, plotStops, createGuide } from '../src/tour.js'
import { CHAPTERS, toLandWorld, LAND_ORIGIN_X, LAND_ORIGIN_Z } from '../src/builds/plots.js'
import { handleEvan } from '../worker/agent/route.js'
import { MemoryStore, nodeSql } from '../worker/agent/memory.js'
import { mockUpstream } from '../worker/agent/mock.js'

/*
 * THE TOUR: A* over voxels, the plot stops, and AI Evan leading a visitor to
 * a chapter in the real world -- first with the offline stub brain, then end
 * to end through the memory Worker route (run in this test process, behind
 * page.route), so the server's record of the tour is checked too.
 */

/* ------------------------------------------------------------------ *
 * Pure: the search, on hand-drawn worlds
 * ------------------------------------------------------------------ */

/** A world from a set of solid "x,y,z" strings plus a floor at y = 0. */
function grid(solids = [], { fluids = [] } = {}) {
  const S = new Set(solids)
  const F = new Set(fluids)
  return {
    solidAt: (x, y, z) => y <= 0 || S.has(`${x},${y},${z}`),
    fluidAt: (x, y, z) => F.has(`${x},${y},${z}`),
  }
}

const wall = (x, z0, z1, h = 2) => {
  const out = []
  for (let z = z0; z <= z1; z++) for (let y = 1; y <= h; y++) out.push(`${x},${y},${z}`)
  return out
}

test('a straight walk on open ground is a straight line', () => {
  const g = grid()
  const p = findPath({ from: [0.5, 1, 0.5], to: [10.5, 0.5], ...g, radius: 0.5 })
  expect(p.at(-1)).toEqual([10, 1, 0])
  expect(p).toHaveLength(10)
})

test('a wall is walked around, not through', () => {
  const g = grid(wall(5, -3, 3))
  const p = findPath({ from: [0.5, 1, 0.5], to: [10.5, 0.5], ...g, radius: 0.5 })
  expect(p).not.toBeNull()
  for (const [x, , z] of p) expect(x === 5 && Math.abs(z) <= 3).toBe(false)
})

test('one block is a step, two blocks is a wall', () => {
  /* A one-high ledge across the whole way: he hops it. */
  const step = []
  for (let x = 5; x <= 12; x++) for (let z = -40; z <= 40; z++) step.push(`${x},1,${z}`)
  const p = findPath({ from: [0.5, 1, 0.5], to: [10.5, 0.5], ...grid(step), radius: 0.5 })
  expect(p.at(-1)).toEqual([10, 2, 0])

  /* Two high: not climbed. He goes round the end of it instead. */
  const g = grid(wall(5, -40, 40, 2))
  const round = findPath({ from: [0.5, 1, 0.5], to: [10.5, 0.5], ...g, radius: 0.5 })
  expect(round.some(([, , z]) => Math.abs(z) > 40)).toBe(true)
  expect(round.every(([, y]) => y === 1)).toBe(true)
  /* And with no way round inside the search budget, there is no route at all. */
  expect(findPath({ from: [0.5, 1, 0.5], to: [10.5, 0.5], ...g, radius: 0.5, maxNodes: 500 })).toBeNull()
})

test('water is not a floor, and corners are not cut', () => {
  const fluids = []
  for (let x = 3; x <= 6; x++) for (let z = -1; z <= 1; z++) fluids.push(`${x},0,${z}`)
  const g = grid([], { fluids })
  expect(standable(4, 1, 0, g.solidAt, g.fluidAt)).toBe(false)
  const p = findPath({ from: [0.5, 1, 0.5], to: [9.5, 0.5], ...g, radius: 0.5 })
  for (const [x, , z] of p) expect(x >= 3 && x <= 6 && Math.abs(z) <= 1).toBe(false)

  /* Two blocks touching at a corner: the diagonal between them is refused. */
  const c = grid([...wall(1, 0, 0), ...wall(0, 1, 1)])
  const q = findPath({ from: [0.5, 1, 0.5], to: [1.5, 1.5], ...c, radius: 0.2 })
  expect(q === null || q.length > 1).toBe(true)
})

test('waypoints keep the turns and the height changes, and are never far apart', () => {
  const path = []
  for (let x = 1; x <= 20; x++) path.push([x, 1, 0])
  for (let z = 1; z <= 5; z++) path.push([20, 1, z])
  const w = waypoints(path, 8)
  expect(w.at(-1)).toEqual([20, 1, 5])
  expect(w).toContainEqual([20, 1, 0])
  for (let i = 1; i < w.length; i++) {
    expect(Math.hypot(w[i][0] - w[i - 1][0], w[i][2] - w[i - 1][2])).toBeLessThanOrEqual(8)
  }
})

test('every plot stop is derived from CHAPTERS and stands inside its plot', () => {
  const stops = plotStops(CHAPTERS, toLandWorld)
  expect(Object.keys(stops)).toEqual(CHAPTERS.map((c) => c.id))
  for (const c of CHAPTERS) {
    const s = stops[c.id]
    const px = Math.floor(s.x) + LAND_ORIGIN_X
    const pz = Math.floor(s.z) + LAND_ORIGIN_Z
    expect(px).toBeGreaterThanOrEqual(c.x0)
    expect(px).toBeLessThanOrEqual(c.x1)
    expect(pz).toBeGreaterThanOrEqual(c.z0)
    expect(pz).toBeLessThanOrEqual(c.z1)
    expect(s.label).toBe(c.label)
  }
})

test('the guide waits for a visitor who falls behind, and gives up on one who leaves', async () => {
  const g = grid()
  const npc = { position: [0.5, 1, 0.5], walkTo: async ([x, z]) => { npc.position = [x, 1, z] } }
  let visitorAt = [0.5, 1, 0.5]
  let t = 0
  const stops = () => ({ ch1: { id: 'ch1', label: 'One', x: 30.5, z: 0.5 } })

  /* A follower who teleports to him whenever he waits. */
  const follow = createGuide({
    npc, visitor: () => visitorAt, stops, ...g,
    sleep: async (ms) => { t += ms; visitorAt = [...npc.position] }, clock: () => t,
  })
  const ok = await follow.leadTo('ch1')
  expect(ok).toMatchObject({ arrived: true, chapter: 'ch1', visitorWithYou: true })

  /* A visitor who never moves. */
  npc.position = [0.5, 1, 0.5]
  visitorAt = [0.5, 1, 0.5]
  t = 0
  const left = createGuide({
    npc, visitor: () => [0.5, 1, 0.5], stops, ...g,
    sleep: async (ms) => { t += ms }, clock: () => t,
  })
  const gone = await left.leadTo('ch1')
  expect(gone).toMatchObject({ arrived: false, reason: 'the visitor stopped following' })

  await expect(follow.leadTo('ch9')).rejects.toThrow(/no plot called ch9/)
  const nowhere = createGuide({ npc, visitor: () => visitorAt, stops: () => null, ...g })
  await expect(nowhere.leadTo('ch1')).rejects.toThrow(/no chapter plots in this world/)
})

/* ------------------------------------------------------------------ *
 * In the world
 * ------------------------------------------------------------------ */

const NEAR_EVAN = [1.5, SURFACE_Y, -2.5]

async function chat(page, text) {
  await page.keyboard.press('KeyT')
  await page.waitForFunction(() => window.game.chat.isOpen, null, { timeout: 5000 })
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !window.game.chat.isOpen, null, { timeout: 5000 })
}

const lineCount = (page) => page.evaluate(() => document.querySelectorAll('#chat-lines .chat-line').length)

/** Wait for a chat line matching `re` among the lines after index `from`. */
const waitForLine = (page, re, from, timeout) => page.waitForFunction(([src, n]) =>
  [...document.querySelectorAll('#chat-lines .chat-line')].slice(n).some((el) => new RegExp(src).test(el.textContent)),
[re.source, from], { timeout })

const lastLines = (page, n = 3) => page.evaluate((k) =>
  [...document.querySelectorAll('#chat-lines .chat-line')].slice(-k).map((el) => el.textContent), n)

/** Keep the visitor two blocks behind Evan, the way a follower would. */
const follow = (page) => page.evaluate(() => {
  window.__follow = setInterval(() => {
    const { noa, game } = window
    const [x, y, z] = game.EVAN_POS
    noa.ents.setPosition(noa.playerEntity, [x + 1.5, y + 0.2, z + 1.5])
  }, 300)
})
const stopFollowing = (page) => page.evaluate(() => clearInterval(window.__follow))

async function sendEvanHome(page) {
  await stopFollowing(page)
  await page.evaluate(() => {
    const g = window.game
    g.aiEvan._setTalking(false)
    g.aiEvan.relocate(g.EVAN_DROP)
    g.useBrain('stub')
    g.roster.setName(g.LOCAL_ID, 'Guest')
    g.roster.forget()
  })
}

async function meetEvan(page, name) {
  /*
   * A STRANGER, whatever ran before. Evan's `talking` flag lives as long as
   * the page, and resetWorld cannot clear it: spawn is inside his
   * LEAVE_RADIUS, so any earlier spec that stood at spawn (01, 11) left him
   * mid-conversation, and walking up to him then produced no greeting to
   * wait for. Reset him the way sendEvanHome does, then walk up.
   */
  await page.evaluate(() => {
    const g = window.game
    g.aiEvan._setTalking(false)
    g.aiEvan.relocate(g.EVAN_DROP)
    g.roster.setName(g.LOCAL_ID, 'Guest')
    g.roster.forget()
  })
  await teleport(page, ...NEAR_EVAN)
  await settleOnGround(page)
  await page.waitForFunction(() => window.game.aiEvan.session && document.querySelector('#chat-lines')
    && [...document.querySelectorAll('#chat-lines .chat-line')].at(-1)?.textContent.includes('What should I call you'), null, { timeout: 10_000 })
  await chat(page, `my name is ${name}`)
  await page.waitForFunction((n) => window.game.roster.displayNameOf(window.game.LOCAL_ID) === n, name, { timeout: 15_000 })
  /* And the turn is over: he drops a line typed while he is still talking. */
  await page.waitForFunction(() => !window.game.aiEvan.session.busy, null, { timeout: 15_000 })
  /* A person's pace. The memory route refuses two typed lines inside
   * LIMITS.minTurnGapMs, and the mock model answers instantly. */
  await page.waitForTimeout(1000)
}

test('with the offline brain, "tour" walks him to chapter one and the visitor arrives with him', async ({ page }) => {
  test.setTimeout(120_000)
  try {
    await meetEvan(page, 'Tess')
    await follow(page)
    const from = await lineCount(page)
    await chat(page, 'give me a tour')
    await waitForLine(page, /Here we are/, from, 90_000)
    const [stop, at] = await page.evaluate(() => [window.game.TOUR_STOPS.ch1, window.game.EVAN_POS])
    expect(Math.hypot(at[0] - stop.x, at[2] - stop.z)).toBeLessThan(2.5)
    expect((await lastLines(page, 1))[0]).toContain(stop.label)
    /* It went through the tool, not around it. */
    const calls = await page.evaluate(() => window.game.aiEvan.session.transcript
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .filter((b) => b.type === 'tool_use').map((b) => b.name))
    expect(calls).toContain('walk_to_plot')
  } finally {
    await sendEvanHome(page)
  }
})

test('end to end with memory: the server holds the conversation and records the tour', async ({ page }) => {
  test.setTimeout(120_000)
  const memory = new MemoryStore(nodeSql(new DatabaseSync(':memory:')))
  const bodies = []
  await page.route('**/api/evan', async (route) => {
    const req = route.request()
    bodies.push(JSON.parse(req.postData()))
    const res = await handleEvan(new Request('http://localhost:5173/api/evan', {
      method: 'POST', body: req.postData(), headers: { 'content-type': 'application/json' },
    }), {}, { memory, upstream: mockUpstream, chunks: [] })
    await route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() })
  })
  try {
    await page.evaluate(() => window.game.useBrain('evan'))
    await meetEvan(page, 'Remy')
    await follow(page)
    const from = await lineCount(page)
    await chat(page, 'give me a tour')
    await waitForLine(page, /Here we are/, from, 90_000)

    /* The browser sent one message at a time, never a history or a prompt. */
    for (const b of bodies) {
      expect(Object.keys(b).sort()).toEqual(expect.arrayContaining(['tools', 'visitorId']))
      expect(b.messages).toBeUndefined()
      expect(b.system).toBeUndefined()
      expect(b.tools.every((t) => typeof t === 'string')).toBe(true)
    }
    expect(new Set(bodies.map((b) => b.visitorId)).size).toBe(1)

    /* And the server remembers who this is and where they have been. */
    expect(memory.get('name')).toBe('Remy')
    expect(memory.getJson('chapters_seen', [])).toEqual(['ch1'])
    expect(memory.render(Date.now())).toMatch(/seen="ch1"/)
  } finally {
    await page.unroute('**/api/evan')
    await sendEvanHome(page)
  }
})
