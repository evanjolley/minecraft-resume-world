import { test, expect } from './fixtures.js'
import {
  aim, teleport, waitTicks, settleOnGround, setBlock, getBlock, useGamemode, ID, SURFACE_Y,
} from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * EVAN HAS A BODY.
 *
 * Three claims, and the order is the order they were built in:
 *
 *   1. He is SIMULATED -- a noa entity with a physics body, dropped rather
 *      than placed, with the collision solver picking where he stops.
 *   2. His LEGS MOVE, off distance travelled, at the player's cadence.
 *   3. `walk_to` is a tool on the agent seam, and it can fail.
 *
 * What makes this file worth writing rather than screenshotting: every one of
 * those is a claim about a MECHANISM, and all three have a passing-looking
 * failure. A model standing on the ground looks identical whether it fell
 * there or was asserted there. Legs driven by a timer look animated and are
 * wrong in a way you only notice when he stands still and keeps pedalling.
 * A walk that always resolves looks like it works until the first wall.
 *
 * So each test below is written against the thing that is easy to get WRONG,
 * not against the thing that is easy to observe. The screenshot at the bottom
 * is evidence for the one question none of them can answer -- does a walking
 * Minecraft model actually read as walking.
 */

/** Where he is right now, live off the body. */
const evanAt = (page) => page.evaluate(() => [...window.game.aiEvan.position])

const evanState = (page) => page.evaluate(() => {
  const { aiEvan } = window.game
  return {
    pos: [...aiEvan.position],
    home: aiEvan.home,
    grounded: aiEvan.grounded,
    walking: aiEvan.walking,
    stride: aiEvan.stride,
  }
})

/** The right leg's pivot rotation, which is what the walk cycle actually
 *  drives. Read off the live Babylon node, not off our own arithmetic. */
const legAngle = (page) => page.evaluate(
  () => window.game.aiEvan.model.parts.legRight.pivot.rotation.x)

/** Put him back in his column and drop him again. He is not the player, so
 *  resetWorld does not restore him and a spec that walks him off has to. */
async function resetEvan(page) {
  await page.evaluate(() => {
    window.game.aiEvan._setTalking(false)
    window.game.aiEvan._reset()
  })
  await page.waitForFunction(() => window.game.aiEvan.grounded, null, { timeout: 5000 })
}

test.beforeEach(async ({ page }) => { await resetEvan(page) })
test.afterEach(async ({ page }) => { await resetEvan(page) })

test('he is a simulated body, sized like a player, not a decoration',
  async ({ page }) => {
    const body = await page.evaluate(() => {
      const { aiEvan } = window.game
      const phys = window.noa.ents.getPhysics(aiEvan.entity)
      const pos = window.noa.ents.getPositionData(aiEvan.entity)
      return {
        hasPhysics: !!phys,
        width: pos.width,
        height: pos.height,
        // noa's own default is 1, and physics.js has to un-double the
        // PLAYER's because noa ships that one at 2. If this is ever 0 he is
        // still sitting behind the chunk-load gate.
        gravity: phys.body.gravityMultiplier,
        // A movement component means noa's walk controller drives him -- the
        // same system, and therefore the same jump, as the player.
        hasMovement: !!window.noa.ents.getMovement(aiEvan.entity),
      }
    })
    expect(body.hasPhysics).toBe(true)
    expect(body.hasMovement).toBe(true)
    expect(body.width).toBeCloseTo(0.6, 5)
    expect(body.height).toBeCloseTo(1.8, 5)
    expect(body.gravity).toBe(1)
  })

test('he is DROPPED, and gravity is what put him on the ground',
  async ({ page }) => {
    /*
     * THE DISCRIMINATING ASSERTION, and it is not "he is on the ground".
     *
     * He would be on the ground with gravity switched off too, because the
     * column he is handed is the column he lands in -- that is the whole
     * point of the ground scan in main.js. What only gravity can produce is
     * the gap: he is RELEASED above the column and ends up level with it.
     * Zero the gravity multiplier and he hangs at the release height instead,
     * which is exactly how this was proven to discriminate.
     */
    await resetEvan(page)
    const settled = await evanState(page)

    expect(settled.grounded, 'he never landed').toBe(true)
    // Level with the column he was aimed at -- not 2.5 blocks above it.
    expect(settled.pos[1]).toBeCloseTo(settled.home[1], 3)
    expect(settled.pos[1]).toBeLessThan(settled.home[1] + 1)
    // And not through it either, which is the other way a gate can fail.
    expect(settled.pos[1]).toBeGreaterThan(settled.home[1] - 1)

    // Same three claims 21-ai-evan.spec.js makes about the placed version,
    // re-made about the simulated one: ground under him, air at his feet.
    const feet = Math.round(settled.pos[1])
    expect(await getBlock(page, Math.floor(settled.pos[0]), feet - 1, Math.floor(settled.pos[2])))
      .not.toBe(ID.air)
    expect(await getBlock(page, Math.floor(settled.pos[0]), feet, Math.floor(settled.pos[2])))
      .toBe(ID.air)
  })

test('the collision solver picks his height, not the caller', async ({ page }) => {
  /*
   * THE TREETOP BUG, made impossible rather than fixed.
   *
   * Put a block where his feet are and drop him again. A placed NPC lands
   * inside it, because the y came from a scan run once at boot and the world
   * has moved since. A simulated one cannot: the sweep stops him on top.
   *
   * This is the test that says the fix is structural. It does not care what
   * the block is or how it got there -- mined, placed by a visitor, or a
   * terrain asset that stopped being mirrored in X.
   */
  const home = (await evanState(page)).home
  const [hx, hy, hz] = [Math.floor(home[0]), Math.round(home[1]), Math.floor(home[2])]
  await test.step('build a pedestal under him', async () => {
    await setBlock(page, ID.cobblestone, hx, hy, hz)
  })

  await resetEvan(page)
  const after = await evanAt(page)
  expect(after[1], 'he landed inside the block, not on it').toBeCloseTo(hy + 1, 3)

  await setBlock(page, ID.air, hx, hy, hz)
  await resetEvan(page)
  expect((await evanAt(page))[1]).toBeCloseTo(hy, 3)
})

test('a world rebase does not bury him in the floor', async ({ page }) => {
  /*
   * THE REGRESSION THIS CHANGE CREATED, and the one 21-ai-evan.spec.js caught
   * in a full-suite run while passing on its own.
   *
   * noa rebases the scene origin as the player travels, and it NUDGES every
   * entity 0.002 off a voxel boundary on the way past so float error cannot
   * carry a body across one. Harmless -- until his position stopped being a
   * frozen integer written at boot and became a live physics y. 136 became
   * 136.004, and `game.voxelAt` was indexing a column array with a fractional
   * y, getting `undefined`, and answering "solid" for thin air.
   *
   * So this asserts the query, not the number. He is allowed to sit a
   * thousandth of a block off a boundary; what is not allowed is for asking
   * what is at his feet to come back wrong because of it.
   */
  const before = await evanAt(page)
  // Far enough up to cross a chunk boundary and force the rebase. usePad
  // lives at y=200 for the same reason.
  await teleport(page, 0.5, 200, 0.5)
  await waitTicks(page, 3)
  await teleport(page, 0.5, SURFACE_Y + 2, 0.5)
  await settleOnGround(page)
  await waitTicks(page, 3)

  const after = await page.evaluate(() => {
    const p = window.game.aiEvan.position
    return {
      pos: [...p],
      // Deliberately the UNROUNDED position, which is the whole point.
      atFeet: window.game.voxelAt(p[0], p[1], p[2]),
      below: window.game.voxelAt(p[0], p[1] - 1, p[2]),
    }
  })
  expect(after.pos[0]).toBeCloseTo(before[0], 1)
  expect(after.pos[1]).toBeCloseTo(before[1], 1)
  expect(after.atFeet, 'Evan is standing inside a block').toBe(0)
  expect(after.below, 'nothing under Evan -- he is hovering').not.toBe(0)
})

test('spectator noclip does not sink him through the planet', async ({ page }) => {
  /*
   * A BUG THIS CHANGE INTRODUCED SOMEWHERE ELSE, and the reason the guard is
   * in npc.js rather than in gamemode.js.
   *
   * Spectator noclips by swapping `noa.physics.testSolid` for `() => false`,
   * globally, because voxel-physics-engine has no per-body override.
   * physics.js says at length that this is fine because there is exactly one
   * physics body in this world. There are two now, and the second one is a
   * person standing on the ground.
   */
  const before = await evanAt(page)
  await useGamemode(page, 'spectator')
  await waitTicks(page, 20)

  const during = await evanState(page)
  expect(during.pos[1], 'he is falling through the island').toBeCloseTo(before[1], 1)

  await useGamemode(page, 'survival')
  await waitTicks(page, 10)
  const after = await evanState(page)
  expect(after.grounded).toBe(true)
  expect(after.pos[1]).toBeCloseTo(before[1], 1)
})

test('mining the floor out from under him makes him fall', async ({ page }) => {
  /*
   * THE OTHER READING OF "NO FLOOR", and the bug the first version of the
   * gate shipped with.
   *
   * The gate above releases him on `testSolid` under his home column, which
   * answers false for a chunk that has not loaded, false under noclip -- and
   * false when somebody simply mines the block he is standing on. The first
   * two are the solver lying about a world that is there. The third is the
   * world actually changing, and freezing for it means a man hanging in the
   * air over the hole you just dug, teleported back on top of it every tick.
   *
   * So this asserts the thing that separates the readings: he does not merely
   * keep gravity, he ENDS UP LOWER. An assertion on gravityMultiplier would
   * pass against a version that put him back where he was.
   */
  const before = await evanAt(page)
  const [fx, fy, fz] = [Math.floor(before[0]), Math.round(before[1]) - 1, Math.floor(before[2])]
  const floor = await getBlock(page, fx, fy, fz)
  expect(floor, 'nothing under him to mine').not.toBe(0)
  expect(await getBlock(page, fx, fy - 1, fz), 'nothing for him to land on').not.toBe(0)

  await setBlock(page, ID.air, fx, fy, fz)
  await waitTicks(page, 30)

  const after = await evanState(page)
  expect(after.pos[1], 'he is hanging over the hole').toBeCloseTo(before[1] - 1, 1)
  expect(after.grounded, 'he never settled').toBe(true)

  await setBlock(page, floor, fx, fy, fz)
  await resetEvan(page)
  expect((await evanAt(page))[1]).toBeCloseTo(before[1], 1)
})

test('walk_to moves him across the ground and stops him there',
  async ({ page }) => {
    const start = await evanAt(page)
    const target = [start[0] + 4, start[2]]

    const result = await page.evaluate((t) => window.game.aiEvan.walkTo(t), target)

    const end = await evanState(page)
    expect(end.walking, 'the promise resolved while he was still going').toBe(false)
    expect(Math.hypot(end.pos[0] - target[0], end.pos[2] - target[1]))
      .toBeLessThanOrEqual(0.5)
    expect(result.blocks).toBeLessThanOrEqual(0.5)

    // ON THE GROUND. A walk that ends in the air is a walk that went through
    // something, and hypot on x and z alone would never notice.
    expect(end.grounded).toBe(true)
    expect(end.pos[1]).toBeCloseTo(start[1], 0)

    // He actually went somewhere, rather than the target having been where he
    // already was.
    expect(Math.abs(end.pos[0] - start[0])).toBeGreaterThan(3)
  })

test('he walks at Minecraft\'s walking speed, not at one nobody chose',
  async ({ page }) => {
    const start = await evanAt(page)
    const [elapsed, end] = await page.evaluate(async (t) => {
      const began = performance.now()
      await window.game.aiEvan.walkTo(t)
      return [performance.now() - began, [...window.game.aiEvan.position]]
    }, [start[0] + 6, start[2]])

    const travelled = Math.hypot(end[0] - start[0], end[2] - start[2])
    const speed = travelled / (elapsed / 1000)
    /*
     * Loose on purpose, and loose in one direction. MC.WALK_SPEED is 4.317
     * and he cannot average it over a walk this short -- there is an
     * acceleration ramp at one end and an arrival at the other, and the suite
     * runs on software GL where a tick can be late. The bound that matters is
     * the top one: nothing in this world may move FASTER than a walk, because
     * that is the number a player feels.
     */
    expect(speed).toBeGreaterThan(2)
    expect(speed).toBeLessThan(4.6)
  })

test('the legs move, and they move with DISTANCE rather than with time',
  async ({ page }) => {
    /*
     * The bug this file exists to close was not "the legs are wrong". It was
     * that `limbSwing` was declared, passed to poseModel and never
     * incremented -- so the whole Minecraft walk cycle was sitting behind a
     * number that was always zero, and no screenshot of a standing man could
     * tell you.
     *
     * Two assertions, and the second is the one with teeth. A timer-driven
     * stride passes the first (the legs do move) and fails the second (they
     * keep moving while he stands still), which is exactly the wrong
     * implementation that looks right in motion.
     */
    const standing = await page.evaluate(async () => {
      const before = window.game.aiEvan.stride.swing
      const angle = window.game.aiEvan.model.parts.legRight.pivot.rotation.x
      await new Promise((r) => setTimeout(r, 600))
      return {
        advanced: window.game.aiEvan.stride.swing - before,
        moved: Math.abs(window.game.aiEvan.model.parts.legRight.pivot.rotation.x - angle),
      }
    })
    expect(standing.advanced, 'the stride clock ran while he stood still').toBeLessThan(0.05)
    expect(standing.moved, 'his legs walked on the spot').toBeLessThan(0.02)

    const start = await evanAt(page)
    const walked = await page.evaluate(async (t) => {
      const { aiEvan } = window.game
      const before = aiEvan.stride.swing
      const angles = []
      const amounts = []
      const sample = () => {
        angles.push(aiEvan.model.parts.legRight.pivot.rotation.x)
        amounts.push(aiEvan.stride.amount)
      }
      window.noa.on('tick', sample)
      await aiEvan.walkTo(t)
      window.noa.removeListener('tick', sample)
      return { advanced: aiEvan.stride.swing - before, angles, amounts }
    }, [start[0] + 6, start[2]])

    const end = await evanAt(page)
    const travelled = Math.hypot(end[0] - start[0], end[2] - start[2])

    /*
     * THE CADENCE, asserted as a NUMBER rather than as "it changed".
     *
     * playerModel.js advances the stride by `speed * secs * 2.0`, which
     * integrates to 2 radians of phase per block walked -- and that 2.0 is
     * the player's, from perspective.js. Asserting the ratio is what makes
     * this a test that the NPC matches the player rather than a test that
     * something incremented.
     */
    expect(walked.advanced / travelled).toBeCloseTo(2.0, 1)

    // The legs swung both ways, not just away from rest.
    expect(Math.max(...walked.angles)).toBeGreaterThan(0.25)
    expect(Math.min(...walked.angles)).toBeLessThan(-0.25)
    // And the amplitude was chased up to vanilla's cap rather than snapped.
    expect(Math.max(...walked.amounts)).toBeGreaterThan(0.7)
    expect(walked.amounts[0]).toBeLessThan(Math.max(...walked.amounts))
  })

test('a wall taller than one block stops him, and the walk says so',
  async ({ page, terrain }) => {
    /*
     * THE FAILURE PATH, which is the half of `walk_to` that decides whether
     * it is safe to give a model. A walk that never rejects is a walk that
     * hangs the agent loop on the first fence.
     *
     * Three blocks tall because a ONE-block step is meant to be hopped -- see
     * the test below -- so a wall that proves the failure has to be one he
     * genuinely cannot pass.
     */
    const start = await evanAt(page)
    const wallX = Math.floor(start[0]) + 2
    const z = Math.floor(start[2])
    const feet = Math.round(start[1])
    await terrain.keep([wallX, feet, z - 1], [wallX, feet + 2, z + 1])
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = 0; dy <= 2; dy++) {
        await setBlock(page, ID.cobblestone, wallX, feet + dy, z + dz)
      }
    }

    const failure = await page.evaluate(
      (t) => window.game.aiEvan.walkTo(t).then(() => null, (e) => e.message),
      [start[0] + 5, start[2]])

    expect(failure, 'he walked through a three-block wall').not.toBeNull()
    expect(failure).toMatch(/stuck|gave up/)
    // He is still where the wall left him, on the ground, not embedded in it.
    const end = await evanState(page)
    expect(end.walking).toBe(false)
    expect(end.grounded).toBe(true)
    expect(end.pos[0]).toBeLessThan(wallX)
  })

test('a one-block step is hopped rather than refused', async ({ page, terrain }) => {
  const start = await evanAt(page)
  const z = Math.floor(start[2])
  const feet = Math.round(start[1])
  const stepX = Math.floor(start[0]) + 2

  /*
   * A ledge two deep and three wide, and the target is ON TOP of it.
   *
   * Both dimensions are load-bearing. Three wide so he cannot walk round the
   * end and pass the test without ever hopping; two deep so the arrival
   * radius cannot be satisfied from the ground in front of it -- the first
   * version was one deep with the target beyond it, and he cleared the step,
   * walked off the far side, and landed back at the old height with every
   * assertion still passing.
   */
  await terrain.keep([stepX, feet, z - 1], [stepX + 1, feet, z + 1])
  for (let dx = 0; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      await setBlock(page, ID.cobblestone, stepX + dx, feet, z + dz)
    }
  }

  await page.evaluate((t) => window.game.aiEvan.walkTo(t), [stepX + 1.5, start[2]])

  /*
   * He can arrive MID-HOP -- the target is half a block past the step, which
   * is inside the arc of the jump that got him there -- so wait for the
   * landing before asking where he is standing. Asserting `grounded` the
   * instant the promise resolved is an assertion about the last jump's timing
   * and not about the hop, and it failed for exactly that reason.
   */
  await page.waitForFunction(() => window.game.aiEvan.grounded,
    null, { timeout: 5000, polling: 20 })

  const end = await evanState(page)
  expect(end.pos[0], 'he never got up onto the step').toBeGreaterThan(stepX + 0.5)
  // ON TOP of it. Past it at the old height would mean he walked through.
  expect(end.pos[1]).toBeCloseTo(feet + 1, 1)
})

test('walk_to is a tool on the same seam, and the model chains it off a read',
  async ({ page }) => {
    /*
     * The assertion that matters is not that he arrived. It is that he
     * arrived because TWO tool calls happened in one conversation, the second
     * built out of the first's result -- a read that feeds a write, through
     * the registry, with nothing in npc.js or agent.js special-cased for it.
     *
     * The stub cannot see the world (see stubBackend), so "come here" is only
     * answerable by asking get_player_state where "here" is. That is the same
     * thing a real model would have to do, and it is why this is a better
     * test of the seam than a hardcoded destination would have been.
     */
    const evan = await evanAt(page)
    // Far enough to be a walk, close enough to be inside his greeting radius
    // so the conversation is already open.
    await teleport(page, evan[0] + 3, SURFACE_Y + 1, evan[2])
    await settleOnGround(page)
    await waitTicks(page, 3)

    await page.evaluate(() => window.game.aiEvan.hear('my name is Robin'))
    await page.waitForFunction(() => window.game.roster
      .get(window.game.LOCAL_ID).name === 'Robin', null, { timeout: 15000 })

    // WAIT FOR HIM TO STOP THINKING FIRST. agent.js drops a second message
    // while a turn is in flight, on purpose (one pair of legs, one
    // conversation), and the rename turn is still narrating its tool result
    // for a second or so after the roster has already changed.
    await page.waitForFunction(() => !window.game.aiEvan.session.busy,
      null, { timeout: 15000, polling: 50 })
    await page.evaluate(() => window.game.aiEvan.hear('come here'))
    await page.waitForFunction(() => !window.game.aiEvan.session.busy
      && !window.game.aiEvan.walking, null, { timeout: 30000, polling: 100 })

    const msgs = await page.evaluate(() => window.game.aiEvan.session.transcript)
    const calls = msgs.filter((m) => m.role === 'assistant' && Array.isArray(m.content))
      .flatMap((m) => m.content).filter((b) => b.type === 'tool_use')
    expect(calls.map((c) => c.name))
      .toEqual(['set_player_name', 'get_player_state', 'walk_to'])

    // The destination came out of the READ, not out of thin air.
    const player = await page.evaluate(
      () => [...window.noa.ents.getPosition(window.noa.playerEntity)])
    expect(calls[2].input.x).toBeCloseTo(player[0], 0)
    expect(calls[2].input.z).toBeCloseTo(player[2], 0)

    const results = msgs.filter((m) => m.role === 'user' && Array.isArray(m.content))
      .flatMap((m) => m.content).filter((b) => b.type === 'tool_result')
    const arrival = JSON.parse(results.at(-1).content)
    expect(results.at(-1).is_error).toBe(false)
    expect(arrival.ok).toBe(true)

    // ...and the body moved because the tool ran.
    const end = await evanAt(page)
    expect(Math.hypot(end[0] - player[0], end[2] - player[2])).toBeLessThanOrEqual(0.6)

    const lines = await page.evaluate(() =>
      [...document.querySelectorAll('#chat-lines .chat-line')].map((el) => el.textContent))
    expect(lines.some((l) => l.includes('Here I am'))).toBe(true)
  })

test('the tool refuses a destination it cannot take a number from',
  async ({ page }) => {
    /*
     * Through the REGISTRY rather than through walkTo, because what is being
     * tested is the thing agent.js promises a model: a bad call comes back as
     * `is_error` with a sentence, and the conversation survives it.
     */
    const failed = await page.evaluate(
      () => window.game.aiEvan.walkTo(['over there', 3]).then(() => null, (e) => e.message))
    expect(failed).toMatch(/finite/)
    expect((await evanState(page)).walking).toBe(false)
  })

/*
 * EVIDENCE. The one question no number above can answer: does he read as a
 * person walking. Frames across a walk, so the legs are caught at different
 * points in the cycle rather than at whichever phase a single shot lands on.
 */
test('screenshots: Evan falls into a pit mined under him', async ({ page }) => {
  /*
   * The evidence for the test above, which can only say he is lower.
   *
   * A four-block pit rather than the single block that test mines: one block
   * is a quarter of a second of falling, which no frame catches, and the
   * question a picture is here to answer is whether he FALLS -- upright, in
   * the air, with the hole he is falling into visible around him.
   *
   * TWO BLOCKS WIDE, and that is the only reason the shot works. A 1x1 shaft
   * photographed from anywhere is a black slot: the near lip occludes the
   * whole interior for any camera low enough to see the sky. Widening it
   * toward the camera by one block is what lets a sight line reach the floor.
   *
   * And the camera is ABOVE, which costs a game mode: it is dropped in the
   * air and falls for the two ticks the shot needs, so creative is on to stop
   * that being a fall-damage death. Rejected: spectator, which would hold the
   * camera still and is the one mode that cannot be used here -- noclip is
   * global, so a spectating camera freezes the thing it came to photograph.
   */
  const evan = await evanAt(page)
  const [fx, fy, fz] = [Math.floor(evan[0]), Math.round(evan[1]) - 1, Math.floor(evan[2])]

  await useGamemode(page, 'creative')
  const eye = async () => {
    await teleport(page, evan[0] + 3, SURFACE_Y + 6, evan[2])
    await aim(page, { heading: Math.atan2(-3, 0), pitch: 1.15 })
  }
  await eye()

  const dug = []
  for (let d = 0; d < 4; d++) {
    // Stop before the LAST solid layer. A pit with nothing under it is not a
    // fall, it is the void, and the overworld is four blocks thick now --
    // digging a fixed four would drop him out of the world and leave this
    // shot photographing the hole he went through.
    if (await getBlock(page, fx, fy - d - 1, fz) === ID.air) break
    for (const x of [fx, fx + 1]) {
      dug.push([x, fy - d, await getBlock(page, x, fy - d, fz)])
      await setBlock(page, ID.air, x, fy - d, fz)
    }
  }
  // Two ticks in: gravity has had him for a fraction of a four-block drop, so
  // he is off the lip and nowhere near the bottom.
  await waitTicks(page, 2)
  await shot(page, 'npc-evan-falling')

  await waitTicks(page, 40)
  // Re-aimed because the camera has been falling too.
  await eye()
  await shot(page, 'npc-evan-landed')
  const landed = await evanState(page)
  expect(landed.pos[1], 'he did not reach the bottom').toBeLessThan(evan[1] - 2)
  expect(landed.grounded, 'he is still in the air').toBe(true)

  for (const [x, y, id] of dug) await setBlock(page, id, x, y, fz)
  await resetEvan(page)
})

test('screenshots: Evan mid-stride', async ({ page }) => {
  const evan = await evanAt(page)

  /*
   * SIDE ON, from four blocks along the line the walk tests above already
   * prove is walkable -- which is the only reason this vantage is safe. He
   * stands in dense forest, and the first four attempts at this shot were a
   * wall of dirt or a wall of sky because every spot that LOOKS like a camera
   * position here is inside a trunk.
   *
   * Rejected: spectator, which would let the camera go anywhere. It cannot be
   * used, and the reason is the spec above -- noclip is global, so a
   * spectating camera freezes the thing it came to photograph.
   *
   * He walks along Z and the camera looks along -X, so the stride is in
   * profile. A walk cycle photographed head-on is a man standing still.
   */
  await teleport(page, evan[0] + 4, SURFACE_Y + 2, evan[2])
  await settleOnGround(page)
  // Negative pitch is DOWN here: noa's camera pitch is positive looking UP,
  // and a first attempt at +0.28 produced four frames of sky.
  // Aimed at the MIDDLE of the walk, not at where he starts, so the whole
  // stride happens in frame instead of leaving it on the third shot.
  await aim(page, { heading: Math.atan2(-4, 1.5), pitch: -0.1 })
  await waitTicks(page, 3)
  await shot(page, 'npc-evan-standing')

  /*
   * Caught, not awaited bare. He is walking over real terrain that nothing
   * flattened for this shot, so the walk is allowed to fail on a two-block
   * ledge -- and the FRAMES are the point of this test, not the arrival.
   */
  const walk = page.evaluate(
    (t) => window.game.aiEvan.walkTo(t).catch((e) => e.message), [evan[0], evan[2] + 3])
  // Four frames spread across the walk. One shot proves he is somewhere; a
  // sequence is the only way to show the legs are in different places.
  for (let i = 0; i < 4; i++) {
    await waitTicks(page, 3)
    await shot(page, `npc-evan-walking-${i}`)
  }
  await walk
})
