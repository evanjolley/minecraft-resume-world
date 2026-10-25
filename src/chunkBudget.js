/*
 * Chunk loading throughput: noa processes ONE chunk per tick, whatever its
 * budget says. This file gives it the budget back.
 *
 * THE BUG, in noa-engine 0.33 `World.prototype.tick` (src/lib/world.js):
 *
 *     var t = performance.now()
 *     var t1 = tickStartTime + (this.maxProcessingPerTick || 0)
 *     if (t < t1) t1 = t + 1
 *
 * The guard is inverted. It was meant to give an over-budget tick one more
 * millisecond; what it does is cap EVERY tick that is still under budget at
 * one millisecond. Generating and meshing a 32^3 chunk takes longer than that,
 * so the loop below it runs exactly once, and the world arrives at the tick
 * rate: 30 chunks a second. Measured on 2026-10-25, the boot from first frame
 * to every chunk in range meshed took 15.7 s on a real GPU, and the main thread
 * was idle for 83% of it. Raising `maxProcessingPerTick` changes nothing,
 * which is how the bug shows itself.
 *
 * THE FIX is to call `world.tick` again while time remains and there is work
 * queued. That is the loop noa meant to run, driven from outside, so nothing
 * in node_modules is patched and nothing breaks if a later noa fixes the line
 * (the extra calls would simply find empty queues).
 *
 * Rejected: a Vite transform that rewrites the comparison in noa's source.
 * Dev serves noa through the dependency pre-bundler, which plugins do not see,
 * so it would need noa excluded from optimizeDeps and would fix dev and build
 * by two different mechanisms.
 *
 * TWO BUDGETS. While a visitor is playing (pointer locked) a tick may spend
 * PLAY_MS, which keeps a sprint into fresh terrain smooth. While nobody is
 * looking (the loading card, the title menu, a paused game, a headless test
 * run) it may spend IDLE_MS, because nobody is there to see a frame drop and
 * everybody is waiting for the world.
 */

export const PLAY_MS = 8
export const IDLE_MS = 16

export function installChunkBudget(noa, { playMs = PLAY_MS, idleMs = IDLE_MS } = {}) {
  const world = noa.world
  const inner = world.tick.bind(world)

  // The private queues noa keeps. Optional throughout: if a noa upgrade
  // renames them, `backlog` reads 0 and this degrades to noa's own behavior.
  const queues = ['_chunksToRequest', '_chunksToMesh', '_chunksToMeshFirst',
    '_chunksToRemove', '_chunksInvalidated']
  const backlog = () => {
    let n = 0
    for (const q of queues) n += world[q]?.count?.() ?? 0
    return n
  }

  const stats = { ticks: 0, extraCalls: 0 }

  world.tick = function budgetedTick() {
    const t0 = performance.now()
    inner()
    stats.ticks++
    const budget = document.pointerLockElement ? playMs : idleMs
    // Bounded by time alone. Every call either pops a queue or refills one
    // from the loaded area, and the clock ends it either way.
    while (backlog() > 0 && performance.now() - t0 < budget) {
      inner()
      stats.extraCalls++
    }
  }

  return { stats, backlog }
}
