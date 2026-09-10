/*
 * The world driver. Everything the throwaway scripts kept re-deriving.
 *
 * Design rule throughout: NO fixed sleeps for readiness. Every wait polls a
 * condition the game itself publishes (noa exists / the body is at rest / this
 * voxel is non-zero). Durations that are genuinely durations -- "hold the key
 * for 500 ms" -- are measured INSIDE the page off the tick loop, so a slow
 * software-GL frame stretches the measurement window instead of corrupting it.
 */

/** Grass surface. island.js puts grass at SURFACE_Y - 1, feet rest at 64. */
export const SURFACE_Y = 64
export const ISLAND_HALF = 40
export const SPAWN = [0.5, SURFACE_Y + 2, 0.5]

/** Block ids, mirroring blocks.js. Duplicated on purpose: if someone
 *  renumbers the table, these tests should fail rather than follow along. */
export const ID = {
  air: 0, grass: 1, dirt: 2, stone: 3, cobblestone: 4, planks: 5, bedrock: 6,
}

/** Heading in noa is measured so that direction = (sin h, cos h). */
export const HEADING = {
  southPlusZ: 0,
  eastPlusX: Math.PI / 2,
  northMinusZ: Math.PI,
  westMinusX: -Math.PI / 2,
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
export const TAP_MS = 80

/** Every key this suite ever holds down. reset() releases all of them. */
const ALL_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ControlLeft']

/**
 * Boot a page to a genuinely playable world.
 *
 * Three gates, in order, because each can pass while the next is still false:
 *   1. window.noa / window.game exist  (the module graph evaluated)
 *   2. the island's far rim is meshed  (chunks generated; getBlock lies with
 *      0 for an unloaded chunk, so "is x=39 solid" is also the load check)
 *   3. the player body is at rest      (it spawns 2 blocks up and falls)
 */
export async function bootWorld(page) {
  await muteHmr(page)
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  await page.waitForFunction(() => !!(window.noa && window.game), null,
    { timeout: 30_000, polling: 100 })

  await page.waitForFunction(([half, y]) => {
    const g = window.noa.getBlock.bind(window.noa)
    // Rim on both axes plus the bedrock floor: the vertical chunk column has
    // to be resident too, or the y=0 assertions read air from thin air.
    return g(half - 1, y, 0) !== 0 && g(0, y, half - 1) !== 0 && g(0, 0, 0) !== 0
  }, [ISLAND_HALF, SURFACE_Y - 1], { timeout: 45_000, polling: 100 })

  await page.waitForFunction(() => {
    const noa = window.noa
    return noa.ents.getPhysics(noa.playerEntity).body.atRestY() < 0
  }, null, { timeout: 30_000, polling: 50 })

  await enableScriptedCamera(page)
  await page.evaluate(() => document.getElementById('game').focus())
  return page
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
 * divided by the elapsed time READ FROM THE PAGE. Using the test-side clock
 * instead attributes CDP round-trip latency to the player and reads ~5% slow.
 */
export async function measureSpeed(page, keys, { warmupMs = 900, sampleMs = 700 } = {}) {
  for (const k of keys) await page.keyboard.down(k)
  try {
    await page.waitForTimeout(warmupMs)

    // Up to three attempts, and NOT because the assertion is flaky. A sample
    // window in which the engine dropped ticks -- swiftshader stalling on a
    // chunk remesh, the machine busy -- measures the laptop, not the game:
    // the player really did stand still for 200 ms of wall clock. `healthy`
    // rejects exactly that and nothing else, so a genuinely wrong speed
    // constant still fails three times out of three.
    for (let attempt = 0; ; attempt++) {
      const r = await page.evaluate((ms) => new Promise((resolve) => {
        const noa = window.noa
        const p = () => noa.ents.getPositionData(noa.playerEntity).position
        const [x0, , z0] = p()
        const t0 = performance.now()
        let ticks = 0
        const fn = () => {
          ticks++
          const dt = performance.now() - t0
          if (dt < ms) return
          noa.off('tick', fn)
          const [x1, , z1] = p()
          resolve({
            dist: Math.hypot(x1 - x0, z1 - z0),
            secs: dt / 1000,
            ticks,
            expectedTicks: (dt / 1000) * noa.tickRate,
          })
        }
        noa.on('tick', fn)
      }), sampleMs)

      const healthy = r.ticks >= r.expectedTicks * 0.85
      if (healthy || attempt === 2) return r.dist / r.secs
    }
  } finally {
    for (const k of keys) await page.keyboard.up(k)
  }
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
