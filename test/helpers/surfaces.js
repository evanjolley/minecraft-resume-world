/*
 * Measuring the SHAPE of a speed change, not just its steady state.
 *
 * helpers/world.js's measureSpeed answers "how fast, once it has settled",
 * which is the only question ordinary ground raises -- it settles in four
 * ticks. Ice does not settle in four ticks, and neither does creative flight:
 * the entire mechanic is how long the change takes. So these two measure the
 * transient at both ends, the ramp up and the coast down.
 *
 * BOTH COUNT TICKS, never wall clock, for the reason measureSpeed's comment
 * spells out at length: micro-game-shell discards a tick backlog when it falls
 * behind, so simulated time and the laptop's clock are different quantities
 * and only one of them is the game.
 */

import { PAD_X0, PAD_Y, PAD_Z } from './world.js'

/**
 * Re-surface a pad built by usePad with some other block.
 *
 * usePad lays stone, which is the right default for every existing speed test
 * and is exactly what these ones need to replace. The pad is already loaded
 * and meshed by the time this runs, so the writes stick without the polling
 * usePad itself needs.
 */
export async function pave(page, blockId, length) {
  await page.evaluate(([x0, y, z, len, block]) => {
    for (let i = -2; i < len; i++) {
      for (let dz = -1; dz <= 1; dz++) window.noa.setBlock(block, x0 + i, y - 1, z + dz)
    }
  }, [PAD_X0, PAD_Y, PAD_Z, length, blockId])
}

/**
 * Hold `keys` from a standstill and report how long the ramp took.
 *
 * `t90` is in TICKS, and is the index of the first tick at or above 90% of the
 * speed the window ended at -- so it is a fraction of that run's own top speed
 * rather than of a number passed in, and a spec can assert the ramp without
 * also asserting the speed.
 */
export async function rampUp(page, keys, ms = 3000) {
  for (const k of keys) await page.keyboard.down(k)
  try {
    return await page.evaluate((windowMs) => new Promise((resolve) => {
      const noa = window.noa
      const b = noa.ents.getPhysics(noa.playerEntity).body
      const want = Math.round((windowMs / 1000) * noa.tickRate)
      const speeds = []
      const fn = () => {
        speeds.push(Math.hypot(b.velocity[0], b.velocity[2]))
        if (speeds.length < want) return
        noa.off('tick', fn)
        const top = speeds[speeds.length - 1]
        resolve({ top, t90: speeds.findIndex(v => v >= top * 0.9), tickRate: noa.tickRate })
      }
      noa.on('tick', fn)
    }), ms)
  } finally {
    for (const k of keys) await page.keyboard.up(k)
  }
}

/**
 * Let go and watch the player stop. Call with every key already released.
 *
 * Reports `t10`, the ticks taken to fall to a tenth of the speed it started
 * at, and `dist`, how far the player travelled doing it. t10 is the honest
 * measure of "slowdown time": a geometric decay never technically reaches
 * zero, so "how long to stop" is always a question about a threshold, and a
 * tenth is far enough down to be dominated by the retention rather than by
 * where in the tick the key came up.
 *
 * `ticks` is a cap-limited run to 2% and is reported so a spec can say
 * "and it did stop" rather than inferring it.
 *
 * @param axis 'h' for the horizontal plane, 'v' for the vertical.
 */
export function coast(page, axis = 'h', maxTicks = 300) {
  return page.evaluate(([ax, cap]) => new Promise((resolve) => {
    const noa = window.noa
    const b = noa.ents.getPhysics(noa.playerEntity).body
    const pos = () => noa.ents.getPositionData(noa.playerEntity).position
    const speed = () => (ax === 'h'
      ? Math.hypot(b.velocity[0], b.velocity[2])
      : Math.abs(b.velocity[1]))

    const v0 = speed()
    const [x0, y0, z0] = pos()
    let ticks = 0
    let t10 = null
    const fn = () => {
      ticks++
      const v = speed()
      if (t10 === null && v <= v0 * 0.1) t10 = ticks
      if (v > v0 * 0.02 && ticks < cap) return
      noa.off('tick', fn)
      const [x1, y1, z1] = pos()
      resolve({
        v0,
        ticks,
        // null means it never got there inside the cap, which is a result.
        t10,
        stopped: ticks < cap,
        dist: ax === 'h' ? Math.hypot(x1 - x0, z1 - z0) : Math.abs(y1 - y0),
        secs: ticks / noa.tickRate,
      })
    }
    noa.on('tick', fn)
  }), [axis, maxTicks])
}
