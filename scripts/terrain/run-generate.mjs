import { generateSeed } from './generate.mjs'
import { CANDIDATE_SEEDS } from './seeds.mjs'

const RADIUS = Number(process.env.RADIUS ?? 256)
const LANES = Number(process.env.LANES ?? 4)

// Separate world directories mean separate JVMs can run at once. Generation
// is CPU-bound and single-threaded per server, so lanes are close to linear
// on a multi-core machine.
const queue = [...CANDIDATE_SEEDS]
const failures = []
const lane = async () => {
  while (queue.length) {
    const seed = queue.shift()
    try { await generateSeed(String(seed), RADIUS) }
    catch (e) { failures.push(seed); console.log(`  seed ${seed}: FAILED ${e.message}`) }
  }
}
await Promise.all(Array.from({ length: LANES }, lane))
if (failures.length) {
  console.log(`FAILED seeds: ${failures.join(', ')}`)
  process.exitCode = 1
}
console.log('all seeds generated')
