/*
 * The world driver. Everything the throwaway scripts kept re-deriving.
 *
 * Design rule throughout: NO fixed sleeps for readiness. Every wait polls a
 * condition the game itself publishes (noa exists / the body is at rest / this
 * voxel is non-zero). Durations that are genuinely durations -- "hold the key
 * for 500 ms" -- are measured INSIDE the page off the tick loop, so a slow
 * software-GL frame stretches the measurement window instead of corrupting it.
 */

/**
 * Grass under the spawn column. island.js still puts grass at SURFACE_Y - 1
 * and rests your feet at SURFACE_Y -- the relationship is unchanged, the
 * number moved, because the world is now a 128x128 patch of real Minecraft
 * terrain and its dark-forest floor at the spawn column sits at y=135 rather
 * than at sea level.
 */
export const SURFACE_Y = 136
export const SPAWN = [0.5, SURFACE_Y + 2, 0.5]

/**
 * World bounds, in world coordinates, mirroring island.js. The patch is
 * 128x128 with the spawn column at the origin, so it is NOT symmetric --
 * which is itself worth asserting, since a symmetric-island assumption is
 * exactly what these tests used to be full of.
 */
export const MIN_X = -87
export const MAX_X = 40
export const MIN_Z = -56
export const MAX_Z = 71

/*
 * A column with grass at SURFACE_Y - 1 and NOTHING above it, four blocks east
 * of spawn.
 *
 * Every "teleport up and fall" test used to drop down the spawn column,
 * because the old island had open sky over all of it. Spawn is now under a
 * dark forest canopy -- there are leaves at y=139 and y=140 directly overhead
 * -- and a player dropped from SURFACE_Y + 10 would land on a leaf, or worse
 * materialise inside one. x=-4 is the nearest column that is clear all the way
 * up, and its ground is at exactly the same height as spawn's, so every
 * `SURFACE_Y + n` distance in those tests still means what it said.
 *
 * It was +4 until the terrain asset stopped being mirrored in X. Same column
 * of the same Minecraft world, reached from the other side: the flip pivots on
 * spawn, so a world coordinate simply negates. Nothing about the drop tests
 * changed except which side of spawn they happen on.
 */
export const DROP_X = -4.5
export const DROP_Z = 0.5

/** Block ids, mirroring blocks.js. Duplicated on purpose: if someone
 *  renumbers the table, these tests should fail rather than follow along. */
export const ID = {
  air: 0, grass: 1, dirt: 2, stone: 3, cobblestone: 4, planks: 5, bedrock: 6,
  // The invisible wall around the patch. Last id in the table.
  barrier: 638,
}

/**
 * The OP passphrase, duplicated from src/authority.js for the same reason the
 * block ids above are: if someone changes it, these tests should fail loudly
 * rather than silently follow along. It is not a secret -- authority.js says
 * at length why not.
 */
export const OP_PASSPHRASE = 'diamond-pickaxe'

/** Every game rule resetWorld has to put back. Vanilla defaults are all true. */
const GAMERULES = ['doDaylightCycle', 'fallDamage', 'naturalRegeneration']

/*
 * Heading in noa is measured so that direction = (sin h, cos h).
 *
 * The cardinal halves of these names USED TO SAY the opposite on X --
 * `eastPlusX` and `westMinusX` -- which was a leftover from when the terrain
 * asset was a mirror image of the Minecraft world it came from. It is not any
 * more (scripts/terrain/extract.mjs, MIRROR_X), and in this engine +X is west:
 * Babylon's scene is left-handed, so facing +Z puts +X on your RIGHT, and
 * Minecraft facing south puts west on your right. Measured in
 * test/25-orientation.spec.js rather than asserted in a comment.
 */
export const HEADING = {
  southPlusZ: 0,
  westPlusX: Math.PI / 2,
  northMinusZ: Math.PI,
  eastMinusX: -Math.PI / 2,
}

/*
 * How long a "tap" holds a key.
 *
 * noa ticks at 30 Hz and its input system is POLLED: receivesInputs copies
 * inputs.state into the movement component once per tick. A keydown+keyup
 * that both land inside one 33 ms tick is therefore invisible -- the engine
 * never sees jump=true. page.keyboard.press() is that fast, so every tap in
 * this suite is an explicit down/wait/up instead.
 *
 * (The double-tap sprint detector is the exception: it hangs off the keydown
 * EVENT rather than the polled state, which is the whole reason it works.)
 */
const TAP_MS = 80

/** Every key this suite ever holds down. reset() releases all of them. */
const ALL_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ControlLeft']

/**
 * Boot a page to a genuinely playable world.
 *
 * Three gates, in order, because each can pass while the next is still false:
 *   1. window.noa / window.game exist  (the module graph evaluated -- which
 *      now also means the terrain asset has been fetched and decoded, because
 *      main.js awaits that before it constructs the Engine)
 *   2. chunks around spawn are meshed  (getBlock lies with 0 for an unloaded
 *      chunk, so "is this voxel solid" is also the load check)
 *   3. the player body is at rest      (it spawns 2 blocks up and falls)
 */
export async function bootWorld(page) {
  await muteHmr(page)
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  return waitForWorld(page)
}

/**
 * The three gates on their own, so a test that RELOADS the page can wait the
 * same way instead of re-deriving them. Persistence tests need exactly this:
 * localStorage only proves anything across a real navigation.
 */
export async function waitForWorld(page) {
  await page.waitForFunction(() => !!(window.noa && window.game), null,
    { timeout: 30_000, polling: 100 })

  await page.waitForFunction(([y, maxX]) => {
    const g = window.noa.getBlock.bind(window.noa)
    /*
     * The ground under spawn, a column 20 blocks out on the far diagonal, and
     * the invisible wall 41 blocks west. Three probes rather than one because
     * noa loads chunks in a box and the corners of that box land last.
     *
     * The wall probe is MAX_X + 1 rather than MIN_X - 1, which is a change of
     * sign and not of intent. The patch's long side swapped ends when the
     * terrain asset stopped being mirrored in X, so MIN_X - 1 is now 88 blocks
     * out instead of 41 -- and a boot gate that waits on a chunk near the edge
     * of noa's load range is a boot gate that hangs the day the range changes.
     * MAX_X + 1 is the same 41 blocks the original probed.
     *
     * The old gate also probed the BEDROCK FLOOR at y=0, which cannot work any
     * more and is worth saying why: the world is 250 blocks tall now, bedrock
     * is at y=-64, and noa's chunkAddDistance is [4, 3] -- three chunks of 32
     * is 96 blocks, so standing at y=136 the floor is not merely unmeshed, it
     * is permanently out of range. Any test that wants to read bedrock has to
     * go there.
     */
    return g(0, y, 0) !== 0 && g(-20, y - 2, -20) !== 0 && g(maxX + 1, y, 0) !== 0
  }, [SURFACE_Y - 1, MAX_X], { timeout: 45_000, polling: 100 })

  await page.waitForFunction(() => {
    const noa = window.noa
    return noa.ents.getPhysics(noa.playerEntity).body.atRestY() < 0
  }, null, { timeout: 30_000, polling: 50 })

  await enableScriptedCamera(page)
  await page.evaluate(() => document.getElementById('game').focus())
  return page
}

/** Reload and wait it out. The whole point is that the module graph is rebuilt
 *  from scratch, so anything that survives came out of storage. */
export async function reloadWorld(page) {
  await page.reload({ waitUntil: 'domcontentloaded' })
  return waitForWorld(page)
}

/*
 * Cut Vite's HMR socket before the page loads.
 *
 * Several agents edit src/ while this suite runs, and every save pushes an
 * HMR update that full-reloads the page mid-test -- which reads as
 * "Execution context was destroyed" or, worse, as `window.noa is undefined`
 * halfway through a physics measurement. That is not a flaky test, it is a
 * different build being measured, and no retry count fixes it.
 *
 * The handler deliberately never calls connectToServer, so the page gets a
 * socket that opens and stays silent instead of a connection error the error
 * collector would then have to whitelist. Scoped to the dev server's own
 * origin so a future multiplayer socket still works.
 */
function muteHmr(page) {
  return page.routeWebSocket(/^wss?:\/\/localhost:5173\//, () => {})
}

/*
 * THE camera gotcha, wrapped once so nobody rediscovers it.
 *
 * noa recomputes the camera direction vector only inside
 * applyInputsToCamera(), which multiplies sensitivity by
 * sensitivityMultOutsidePointerlock (default 0) when there is no pointer lock
 * -- and returns early at 0. Headless never has pointer lock, so without this
 * every write to camera.pitch is real but invisible: getDirection() keeps
 * returning the old vector and raycasts still target whatever was under the
 * crosshair at load.
 */
async function enableScriptedCamera(page) {
  await page.evaluate(() => { window.noa.camera.sensitivityMultOutsidePointerlock = 1 })
}

/**
 * Point the camera. Pitch is POSITIVE looking down (noa's convention).
 * Waits for one render so getDirection() has been recomputed before any
 * caller reads noa.targetedBlock.
 */
export async function look(page, { heading = 0, pitch = 0 } = {}) {
  await page.evaluate(([h, p]) => {
    const c = window.noa.camera
    // Any mouse the test moved (inventory clicks) has left dx/dy queued, and
    // applyInputsToCamera would add it on top of the heading we just set.
    window.noa.inputs.pointerState.dx = 0
    window.noa.inputs.pointerState.dy = 0
    c.heading = ((h % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    c.pitch = p
  }, [heading, pitch])
  // Frames first, then ticks: applyInputsToCamera runs on RENDER and is what
  // recomputes the direction vector, while updateBlockTargets raycasts along
  // that vector on the next TICK. Waiting only on ticks reads a stale target.
  await waitFrames(page, 2)
  await waitTicks(page, 2)
}

/** Wait for n engine ticks. The unit the game actually runs in. */
export function waitTicks(page, n = 1) {
  return page.evaluate((count) => new Promise((resolve) => {
    let left = count
    const off = () => window.noa.off('tick', fn)
    const fn = () => { if (--left <= 0) { off(); resolve() } }
    window.noa.on('tick', fn)
  }), n)
}

/** Wait for n whole rendered frames -- for anything that only updates on render. */
export function waitFrames(page, n = 1) {
  return page.evaluate((count) => new Promise((resolve) => {
    let left = count
    const step = () => (--left <= 0 ? resolve() : requestAnimationFrame(step))
    requestAnimationFrame(step)
  }), n)
}

/**
 * Put the world back to a known state between tests.
 *
 * This is the price of sharing one booted page: booting costs ~8 s under
 * software GL, and 30 tests x 8 s is a suite nobody runs. Everything a test
 * can mutate is listed here; anything NOT listed (broken voxels) is the
 * individual test's job via `restoreRegion`.
 */
export async function resetWorld(page) {
  for (const k of ALL_KEYS) await page.keyboard.up(k).catch(() => {})
  await page.mouse.up({ button: 'left' }).catch(() => {})
  await page.mouse.up({ button: 'right' }).catch(() => {})

  // Escape closes the inventory (inventory.js owns that keydown). Sent as a
  // real key because that is the only path that exists -- there is no
  // programmatic close exposed on window.game.
  if (await page.evaluate(() => window.game.inventory.open)) {
    await page.keyboard.press('Escape')
  }

  /*
   * Privilege, game mode and game rules, back to what a stranger gets.
   *
   * All three are page-lifetime state that outlives a test: OP is in
   * localStorage, the mode is in the authority's closure, and the rules are a
   * module singleton. A creative flyer leaking into the next spec would break
   * it in a way that reads as a physics bug.
   *
   * Op first, because only an operator can put any of it back -- and /deop
   * drops you to adventure on its way out, which is why the mode is not set
   * explicitly here.
   */
  await page.evaluate(async ([pass, rules]) => {
    const a = window.game.authority
    await a.requestOp(pass)
    for (const rule of rules) await a.requestGamerule(rule, 'true')
    await a.requestDeop()
  }, [OP_PASSPHRASE, GAMERULES])

  await page.evaluate((spawn) => {
    const { noa, game } = window
    if (game.chat.isOpen) game.chat.close()
    if (game.menu.isOpen) game.menu.close()

    game.survival.clearFallTracking()
    game.survival.reset()

    const inv = game.inventory
    inv.slots.fill(null)
    inv.carried = null
    inv.selected = 0
    inv.emitChange()

    /*
     * Dropped items are page-lifetime world state, same as the game mode: one
     * left lying on the floor gets picked up by the NEXT spec's player the
     * moment they walk, and reads there as an inventory that filled itself.
     * Emptying the live array is the whole reset -- the meshes are pooled per
     * item type and are meant to outlive it.
     */
    game.drops.list.length = 0

    /*
     * Scheduled fluid updates, for exactly the reason dropped items are
     * cleared above -- and this one is newer and bites harder.
     *
     * Until fluids flowed, a pool a spec left behind was inert: the terrain
     * fixture put the voxels back and that was the whole of it. A flowing
     * fluid also leaves a QUEUE, and that queue keeps running after the undo
     * restores the blocks, so the next spec's pool spreads on a schedule the
     * previous spec set. It reads as a flake because it only appears when one
     * fluid spec follows another, and `30-water-entry` passes 18/18 alone.
     *
     * Optional-chained on purpose: this helper boots worlds built from older
     * commits during a bisect, and a missing seam should not take the harness
     * down with it.
     */
    game.fluids?.flow?.reset?.()

    noa.ents.setPosition(noa.playerEntity, spawn)
    const body = noa.ents.getPhysics(noa.playerEntity).body
    body.velocity[0] = body.velocity[1] = body.velocity[2] = 0

    noa.camera.heading = 0
    noa.camera.pitch = 0
    noa.camera.sensitivityMultOutsidePointerlock = 1
    noa.inputs.pointerState.dx = 0
    noa.inputs.pointerState.dy = 0

    // Deterministic noon. Without it the sky colour, the sun position and
    // every screenshot drift with wall-clock time between runs.
    game.sky.setTime(6000)
  }, SPAWN)

  // Sprint latches until a tick sees `forward` released, so give it one.
  await waitTicks(page, 2)
  await settleOnGround(page)
}

/** Poll until the body is resting on terrain again after a teleport. */
export function settleOnGround(page, timeout = 10_000) {
  return page.waitForFunction(() => {
    const noa = window.noa
    return noa.ents.getPhysics(noa.playerEntity).body.atRestY() < 0
  }, null, { timeout, polling: 20 })
}

/* ---------------- world / player readers ---------------- */

export const getBlock = (page, x, y, z) =>
  page.evaluate(([a, b, c]) => window.noa.getBlock(a, b, c), [x, y, z])

export const setBlock = (page, id, x, y, z) =>
  page.evaluate(([i, a, b, c]) => window.noa.setBlock(i, a, b, c), [id, x, y, z])

export const position = (page) =>
  page.evaluate(() => [...window.noa.ents.getPositionData(window.noa.playerEntity).position])

export const teleport = async (page, x, y, z) => {
  await page.evaluate(([a, b, c]) => {
    const noa = window.noa
    noa.ents.setPosition(noa.playerEntity, [a, b, c])
    const body = noa.ents.getPhysics(noa.playerEntity).body
    body.velocity[0] = body.velocity[1] = body.velocity[2] = 0
    window.game.survival.clearFallTracking()
  }, [x, y, z])
  await waitTicks(page, 2)
}

/** Eye height: noa points the camera at a follower entity, so this is where
 *  the sneak crouch actually shows up. */
export const eyeHeight = (page) =>
  page.evaluate(() => window.noa.ents
    .getState(window.noa.camera.cameraTarget, 'followsEntity').offset[1])

/** Vertical FOV in degrees. noa/Babylon store radians. */
export const fovDegrees = (page) =>
  page.evaluate(() => (window.noa.rendering.camera.fov * 180) / Math.PI)

/**
 * Snapshot a voxel box and hand back a restore function. Mining tests destroy
 * terrain, and the next test in the shared page inherits the hole.
 */
export async function snapshotRegion(page, [x0, y0, z0], [x1, y1, z1]) {
  const cells = await page.evaluate(([a, b, c, d, e, f]) => {
    const out = []
    for (let x = a; x <= d; x++)
      for (let y = b; y <= e; y++)
        for (let z = c; z <= f; z++) out.push([x, y, z, window.noa.getBlock(x, y, z)])
    return out
  }, [x0, y0, z0, x1, y1, z1])

  return async () => {
    await page.evaluate((list) => {
      for (const [x, y, z, id] of list) {
        if (window.noa.getBlock(x, y, z) !== id) window.noa.setBlock(id, x, y, z)
      }
    }, cells)
  }
}

/* ---------------- measurement ---------------- */

/**
 * Jump apex in blocks above the resting position.
 *
 * The sampler is armed BEFORE the key press and samples every tick, because
 * the apex is a single instant: polling from the test side over CDP would
 * sample maybe four times across a 0.5 s arc and miss it by centimetres.
 *
 * @param holdMs how long Space is held. The tapped-vs-held pair is the
 *        regression test for noa's Mario-style variable jump.
 */
export async function measureJumpApex(page, { holdMs = TAP_MS } = {}) {
  await armApexSampler(page)
  await tapKey(page, 'Space', holdMs)
  return readApex(page)
}

/** A key press the tick loop can actually see. See TAP_MS. */
export async function tapKey(page, code, ms = TAP_MS) {
  await page.keyboard.down(code)
  await page.waitForTimeout(ms)
  await page.keyboard.up(code)
}

/** Start recording. Split out so a test can press Space more than once
 *  (the air-jump case) inside a single measured arc. */
export function armApexSampler(page) {
  return page.evaluate(() => {
    const noa = window.noa
    const body = noa.ents.getPhysics(noa.playerEntity).body
    const y = () => noa.ents.getPositionData(noa.playerEntity).position[1]

    window.__apex = new Promise((resolve, reject) => {
      const start = y()
      let apex = start
      let leftGround = false
      let ticks = 0
      const fn = () => {
        const cur = y()
        if (cur > apex) apex = cur
        const airborne = body.atRestY() >= 0
        if (airborne) leftGround = true
        if (leftGround && !airborne) { noa.off('tick', fn); resolve(apex - start) }
        if (++ticks > 300) { noa.off('tick', fn); reject(new Error('never landed')) }
      }
      noa.on('tick', fn)
    })
  })
}

export async function readApex(page) {
  const apex = await page.evaluate(() => window.__apex)
  await settleOnGround(page)
  return apex
}

/**
 * Steady-state horizontal speed in blocks/second while `keys` are held.
 *
 * Two-phase on purpose: `warmupMs` burns the acceleration ramp (noa pushes
 * toward maxSpeed with a force, it does not snap), then displacement is
 * divided by the SIMULATED time the engine spent covering it.
 *
 * BOTH ENDPOINTS ARE READ INSIDE A TICK, which is half the trick and was the
 * first bug. noa runs its physics and THEN emits 'tick', so the end position
 * is a post-tick value. Reading the start position when the handler is armed
 * -- between ticks -- picks up the PREVIOUS tick's position, so the distance
 * covered up to one extra tick (33 ms) of travel that the elapsed time knew
 * nothing about. At sampleMs=700 that is up to 4.7% fast, random per run
 * depending where the arming moment fell in the tick cycle, against a 1.5%
 * tolerance. Measured: the error tracked (33.3 - phase)/elapsed with
 * correlation -1.000 across twelve samples, and the same sprint read 5.564 to
 * 5.820 b/s on one machine from one build.
 *
 * THE DENOMINATOR IS TICKS, NOT WALL CLOCK, which is the other half and was
 * the second bug. Dividing by performance.now() elapsed asks "how far did the
 * player get per second of the laptop's life", and the honest answer includes
 * every tick the engine failed to run. micro-game-shell issues ticks from a
 * setInterval and, when it falls more than maxTickTime behind, does
 * `lastTickStarted = now` and DISCARDS the backlog: simulated time is
 * permanently lost while wall clock keeps going. Run the other way, its
 * lookAhead can issue ticks slightly early, so the sample can also read fast.
 * Either way the reading moves and the game did not.
 *
 * Measured over 5 runs x 4 samples with both denominators logged side by side:
 * every wall-clock reading was exactly pertick x (ticks / expectedTicks), so
 * corr(tick shortfall, error) is -1 by construction and -1 in the data. The
 * wall-clock numbers ranged walk 4.249..4.311 and sprint 5.534..5.668; the
 * per-tick numbers were 4.2883 and 5.5747 in ALL FIVE runs, to four decimals.
 * The measurement noise was not noise, it was the shell's clock drift.
 *
 * This is safe only because noa's tick dt is FIXED. micro-game-shell calls
 * onTick(1000 / tickRate) -- a constant, never an observed delay -- and noa's
 * tick() scales it by timeScale before handing it to the physics step, which
 * is why timeScale is in the sum below. Verify that again before trusting
 * this if noa is ever upgraded; a variable-dt engine would need the engine to
 * publish its own accumulated sim time instead.
 *
 * Removed with it: a `healthy` guard plus a three-attempt retry, which
 * rejected windows where ticks came in under 85% of expected and re-rolled.
 * Its insight was right -- a stalled window measures the laptop, not the game
 * -- but it was a threshold guarding a broken ruler, and it only ever caught
 * the top 15% of an error that was continuous. A 1% shortfall sailed through
 * and read as 1% slow, which is what failed 2 runs in 5. Counting simulated
 * time makes the stall arithmetically irrelevant rather than merely rare, so
 * there is nothing left to retry.
 *
 * Rejected: widening TOL in the spec. The residual after this fix is a real
 * -0.664% on every ground speed (see 02-physics.spec.js), not noise.
 */
export async function measureSpeed(page, keys, { warmupMs = 900, sampleMs = 700 } = {}) {
  for (const k of keys) await page.keyboard.down(k)
  try {
    await page.waitForTimeout(warmupMs)

    return await page.evaluate((ms) => new Promise((resolve) => {
      const noa = window.noa
      const p = () => noa.ents.getPositionData(noa.playerEntity).position
      // The window is a COUNT OF TICKS, so no clock is consulted at all --
      // sampleMs is just the caller's way of saying how long they want it.
      const want = Math.max(1, Math.round((ms / 1000) * noa.tickRate))
      const tickSecs = (1000 / noa.tickRate) * (noa.timeScale || 1) / 1000

      let x0 = 0, z0 = 0
      // -1 until the window opens. `ticks` then counts the intervals that
      // actually elapsed inside it -- the opening tick is the fencepost, not
      // an interval.
      let ticks = -1
      const fn = () => {
        if (ticks < 0) {
          const [x, , z] = p()
          x0 = x; z0 = z; ticks = 0
          return
        }
        if (++ticks < want) return
        noa.off('tick', fn)
        const [x1, , z1] = p()
        resolve(Math.hypot(x1 - x0, z1 - z0) / (ticks * tickSecs))
      }
      noa.on('tick', fn)
    }), sampleMs)
  } finally {
    for (const k of keys) await page.keyboard.up(k)
  }
}

/**
 * Rendered frames per second, counted in the page over a real window.
 *
 * requestAnimationFrame rather than noa's tick: the tick loop is fixed at
 * 30 Hz and will happily keep that rate while rendering dies, which is exactly
 * the failure this measures. Under swiftshader the absolute number is low and
 * machine-dependent, so callers should compare two measurements rather than
 * assert an absolute floor.
 */
export function measureFps(page, ms = 1500) {
  return page.evaluate((window_ms) => new Promise((resolve) => {
    let frames = 0
    const t0 = performance.now()
    const step = () => {
      const dt = performance.now() - t0
      if (dt >= window_ms) return resolve((frames * 1000) / dt)
      frames++
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }), ms)
}

/** Sky clock rate in Minecraft ticks per real second. */
export async function measureClockRate(page, sampleMs = 3000) {
  return page.evaluate((ms) => new Promise((resolve) => {
    const sky = window.game.sky
    const t0 = sky.getTime()
    const start = performance.now()
    setTimeout(() => {
      const elapsed = (performance.now() - start) / 1000
      // The clock wraps at 24000; the sample is far too short to wrap, but be
      // explicit rather than silently negative if someone lengthens it.
      let d = sky.getTime() - t0
      if (d < 0) d += 24000
      resolve(d / elapsed)
    }, ms)
  }), sampleMs)
}

/* ---------------- pointer ---------------- */

/**
 * Park the mouse over the middle of the canvas.
 *
 * Order matters and is the reason this is separate from `look`: a mouse MOVE
 * feeds noa's pointerState dx/dy, and with scripted camera control enabled
 * that dx is applied to the camera heading on the next render. So move the
 * mouse first, aim second.
 */
export async function centreMouse(page) {
  const { width, height } = page.viewportSize()
  await page.mouse.move(width / 2, height / 2)
}

/** Aim the crosshair, mouse parked, ready for a click. */
export async function aim(page, angles) {
  await centreMouse(page)
  await look(page, angles)
}

/** What the crosshair is currently on, or null. */
export const targetedBlock = (page) =>
  page.evaluate(() => {
    const t = window.noa.targetedBlock
    return t ? { position: [...t.position], adjacent: [...t.adjacent], blockID: t.blockID } : null
  })

/** Hold a mouse button for a real duration -- mining is a hold-to-break timer. */
export async function holdMouse(page, ms, button = 'left') {
  await page.mouse.down({ button })
  await page.waitForTimeout(ms)
  await page.mouse.up({ button })
  await waitTicks(page, 2)
}

/* ---------------- chat, commands and privilege ---------------- */

/**
 * Run a command the way a player does: press `/`, type it, press Enter.
 *
 * Deliberately NOT `chat.command(...)` or a direct authority call. The thing
 * under test is the whole path -- the capture-phase key handler, the parser,
 * the permission predicate, the authority and the message that comes back --
 * and every one of those has been broken at some point by a change that left
 * the underlying function working perfectly.
 *
 * @returns the chat lines the command produced: [{ kind, text }]
 */
export async function chatCommand(page, text) {
  const before = await page.evaluate(
    () => document.querySelectorAll('#chat-lines .chat-line').length)

  await page.keyboard.press('Slash')
  await page.waitForFunction(() => window.game.chat.isOpen, null, { timeout: 5000 })
  // The slash is already in the box -- chat.js prefills it -- so type the rest.
  await page.keyboard.type(text.replace(/^\//, ''))
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !window.game.chat.isOpen, null, { timeout: 5000 })

  // Commands are async all the way down (authority.js returns promises), so a
  // granted request lands a microtask after Enter, not during it.
  await waitTicks(page, 2)

  return page.evaluate((n) => [...document.querySelectorAll('#chat-lines .chat-line')]
    .slice(n)
    .map(el => ({ kind: el.dataset.kind, text: el.textContent })), before)
}

/** Every command the caller is allowed to see, which is what /help lists. */
export const visibleCommands = (page) =>
  page.evaluate(() => window.game.chat.visibleCommands)

/**
 * What the local player is currently called, formatted exactly as anything
 * that prints a name would print it -- team prefix included.
 *
 * READ, not pinned, and that is deliberate. The block ids and the OP
 * passphrase above are duplicated on purpose so a renumbering breaks this
 * suite instead of being silently followed; those are FIDELITY CONSTANTS,
 * facts about the world that the tests are asserting. A display name is not
 * one of them. It is world state -- it starts as `Guest`, an NPC can rename
 * you mid-session through a tool call, and a returning visitor loads a name
 * out of localStorage. A spec for `/kill` is asserting that the command
 * reports killing THE PLAYER; which player that is, is not its claim to make.
 * Hardcoding `'Evan'` here is what broke these four tests when the default
 * changed, so please do not "fix" this back into a string literal.
 *
 * This is not a tautology, because it is not the same read the command does:
 * the command formats a message and this reads the roster, so a command that
 * prints the wrong name still fails. (Verified by breaking one on purpose.)
 */
export const playerName = (page) =>
  page.evaluate(() => window.game.roster.displayNameOf(window.game.LOCAL_ID))

export const isOperator = (page) =>
  page.evaluate(() => window.game.authority.isOperator())

export const gamemode = (page) =>
  page.evaluate(() => window.game.authority.gamemode)

export const caps = (page) =>
  page.evaluate(() => window.game.authority.caps())

export const isFlying = (page) =>
  page.evaluate(() => window.game.flight.flying)

/** Setup, not assertion: op and switch modes without exercising the UI. */
export async function useGamemode(page, mode) {
  await page.evaluate(async ([pass, m]) => {
    const a = window.game.authority
    await a.requestOp(pass)
    await a.requestGamemode(m)
  }, [OP_PASSPHRASE, mode])
  await waitTicks(page, 2)
}

/** Setup: become an operator without going through /op. */
export const grantOp = (page) =>
  page.evaluate((pass) => window.game.authority.requestOp(pass), OP_PASSPHRASE)

/**
 * Minecraft's flight toggle: two jump presses inside 350 ms.
 *
 * Both taps have to be long enough for a 30 Hz tick to see them (see TAP_MS)
 * and the pair has to fit inside the double-tap window, which leaves very
 * little room -- this is the measurement, not a magic number.
 */
export async function doubleTapFly(page) {
  await tapKey(page, 'Space', 60)
  await page.waitForTimeout(40)
  await tapKey(page, 'Space', 60)
  await waitTicks(page, 2)
}

/* ---------------- test ground ---------------- */

/*
 * A flat pad, built in mid-air, for the tests that measure walking.
 *
 * WHY THIS EXISTS. The world used to be a hand-built island with a perfectly
 * level grass top, so "measure sprint speed over 1.6 seconds" could just be
 * done wherever the player happened to be standing. Real Minecraft terrain has
 * no such place: a scan of the whole 128x128 patch found exactly one flat
 * three-wide corridor longer than ten blocks, and it is made of packed ice at
 * the far edge of the map. Everything else steps, slopes, or has a tree in it.
 *
 * That is a fact about the world, not about the code under test. Sprint speed
 * is 5.612 b/s on flat ground in Minecraft and it must still be 5.612 b/s
 * here; what changed is that the suite now has to PROVIDE the flat ground
 * instead of assuming it. So these tests build their own, exactly as the
 * brief's "give the test the ground it needs rather than relax the assertion"
 * asks.
 *
 * WHY IN MID-AIR, at y=200, rather than levelling a patch of forest:
 *   - nothing is destroyed, so the restore is "set it all back to air" and
 *     cannot leave a scar if a test dies halfway
 *   - the terrain has trees in it; clearing a 40-block corridor through a dark
 *     forest is several hundred more setBlock calls and several more remeshes
 *   - the pad's own edge is a genuine ledge with a 200-block drop under it,
 *     which is what the sneak tests need now that the world has no rim
 *
 * y=200 is 23 above the highest terrain in the patch (y=177) and 64 above
 * spawn -- close enough that noa never evicts the spawn chunks while a test is
 * up there, which would cost a full re-mesh on the way back.
 */
export const PAD_Y = 200
export const PAD_Z = 0
/** The pad runs +X from here, which is the direction this world calls west.
 *  Start a walk at PAD_START and hold W; the camera is aimed for you. */
export const PAD_X0 = 0

/** The x of the pad's last block -- its far lip, and the ledge you can walk
 *  off. Two blocks of the pad run back the other way from PAD_X0 so you can
 *  back up before the run starts. */
export const padEdgeX = (length) => PAD_X0 + length - 1

/**
 * Build a `length` x 3 stone pad at y = PAD_Y - 1 with clear air over it, and
 * stand the player on the end it starts from.
 *
 * @returns a restore function that takes it all back to air.
 */
export async function usePad(page, { length = 44 } = {}) {
  await page.evaluate(([x0, y, z, len, stone]) => {
    const noa = window.noa
    const body = noa.ents.getPhysics(noa.playerEntity).body

    /*
     * Order matters and this is the subtle part. noa.setBlock is a no-op on a
     * chunk that is not loaded, and chunks only load around the player -- so
     * the player has to be up here BEFORE the pad exists. Which means a moment
     * of standing on nothing, hence the gravity freeze (the same trick
     * respawn.js uses on a corpse, and for the same reason).
     */
    noa.ents.setPosition(noa.playerEntity, [x0 + 0.5, y, z + 0.5])
    body.velocity[0] = body.velocity[1] = body.velocity[2] = 0
    window.__padGravity = body.gravityMultiplier
    body.gravityMultiplier = 0
  }, [PAD_X0, PAD_Y, PAD_Z, length, ID.stone])

  /*
   * Poll until a write STICKS. There is no public "is this chunk loaded" on
   * noa that is worth trusting here, and the thing we actually care about is
   * precisely whether setBlock takes -- so probe with the write itself.
   */
  await page.waitForFunction(([x0, y, z, stone]) => {
    window.noa.setBlock(stone, x0, y - 1, z)
    return window.noa.getBlock(x0, y - 1, z) === stone
  }, [PAD_X0, PAD_Y, PAD_Z, ID.stone], { timeout: 15_000, polling: 100 })

  await page.evaluate(([x0, y, z, len, stone]) => {
    const noa = window.noa
    for (let i = -2; i < len; i++) {
      for (let dz = -1; dz <= 1; dz++) {
        noa.setBlock(stone, x0 + i, y - 1, z + dz)
        for (let dy = 0; dy < 4; dy++) noa.setBlock(0, x0 + i, y + dy, z + dz)
      }
    }
    const body = noa.ents.getPhysics(noa.playerEntity).body
    body.gravityMultiplier = window.__padGravity ?? 1
    delete window.__padGravity
  }, [PAD_X0, PAD_Y, PAD_Z, length, ID.stone])

  await settleOnGround(page)
  await page.evaluate(() => window.game.survival.clearFallTracking())

  /*
   * Aim along the pad, because W walks wherever the camera looks. Without
   * this the default heading of 0 (south, +z) marches the player off the
   * three-block width inside one block, and the failure reads as a
   * mysteriously slow walk rather than as a fall.
   *
   * The pad runs +X, which this world calls WEST -- it read "east" until the
   * terrain stopped being mirrored in X and the cardinal names stopped being
   * mirrored with it. Nothing about the rig moved: it is built in mid-air at
   * y=200, clear of the terrain entirely, so which way it points was never
   * load-bearing and is not now.
   */
  await look(page, { heading: HEADING.westPlusX })

  return async () => {
    await page.evaluate(([x0, y, z, len]) => {
      const noa = window.noa
      for (let i = -2; i < len; i++) {
        for (let dz = -1; dz <= 1; dz++) noa.setBlock(0, x0 + i, y - 1, z + dz)
      }
    }, [PAD_X0, PAD_Y, PAD_Z, length])
  }
}

/*
 * Stand the player in a carved pocket on the world floor, on bedrock.
 *
 * Two specs want to punch bedrock, and until now both did it at y=0 -- the old
 * island's floor, which sat comfortably inside the chunks around spawn. The
 * imported world's floor is at y=-64, two hundred blocks down and permanently
 * outside noa's vertical chunkAddDistance of 96, so BOTH halves of the old
 * trick break: getBlock answers 0 (which the terrain fixture would then
 * faithfully "restore") and setBlock is a silent no-op. The player has to
 * actually go there first.
 *
 * Bedrock at the spawn column runs y=-64..-61, so carving -63..-60 leaves a
 * four-block pocket with bedrock directly underfoot.
 *
 * @param terrain the fixture, so the pocket is filled back in afterwards.
 */
export async function standOnBedrock(page, terrain) {
  await page.evaluate(() => {
    const noa = window.noa
    noa.ents.setPosition(noa.playerEntity, [0.5, -55, 0.5])
    const body = noa.ents.getPhysics(noa.playerEntity).body
    body.velocity[0] = body.velocity[1] = body.velocity[2] = 0
    // Embedded in solid rock for a moment. Gravity off so the body is not
    // fighting its way out of the stone while the chunks stream in.
    body.gravityMultiplier = 0
    window.game.survival.clearFallTracking()
  })

  await page.waitForFunction(() => window.noa.getBlock(0, -64, 0) !== 0,
    null, { timeout: 45_000, polling: 100 })

  await terrain.keep([0, -63, 0], [0, -60, 0])
  for (let y = -63; y <= -60; y++) await setBlock(page, ID.air, 0, y, 0)

  await page.evaluate(() => {
    const noa = window.noa
    noa.ents.setPosition(noa.playerEntity, [0.5, -63, 0.5])
    const body = noa.ents.getPhysics(noa.playerEntity).body
    body.velocity[0] = body.velocity[1] = body.velocity[2] = 0
    body.gravityMultiplier = 1
    window.game.survival.clearFallTracking()
  })
  await settleOnGround(page)
}
