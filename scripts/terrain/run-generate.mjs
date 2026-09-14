import { generateSeed } from './generate.mjs'
import { CANDIDATE_SEEDS } from './seeds.mjs'

const RADIUS = Number(process.env.RADIUS ?? 256)
const LANES = Number(process.env.LANES ?? 4)

// Separate world directories mean separate JVMs can run at once. Generation
// is CPU-bound and single-threaded per server, so lanes are close to linear
// on a multi-core machine.
const queue = [...CANDIDATE_SEEDS]
const failures = []
// Each lane owns a port for its whole life, so concurrent servers never
// collide on 25565.
const lane = async n => {
  while (queue.length) {
    const seed = queue.shift()
    try { await generateSeed(String(seed), RADIUS, { port: 25600 + n }) }
    catch (e) { failures.push(seed); console.log(`  seed ${seed}: FAILED ${e.message}`) }
  }
}
await Promise.all(Array.from({ length: LANES }, (_, n) => lane(n)))
if (failures.length) {
  console.log(`FAILED seeds: ${failures.join(', ')}`)
  process.exitCode = 1
}
console.log('all seeds generated')
