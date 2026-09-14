import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { WORK } from './generate.mjs'
import { survey, bestWindows, worldFor, PATCH } from './scan.mjs'

const RADIUS = Number(process.env.RADIUS ?? 256)
const dirs = readdirSync(WORK).filter(d => d.startsWith('seed-')).sort()
const rows = []

for (const d of dirs) {
  const seed = d.slice(5)
  process.stdout.write(`scanning ${seed}\n`)
  const s = survey(worldFor(join(WORK, d)), RADIUS, { log: () => {} })
  for (const w of bestWindows(s, 2)) rows.push({ seed, ...w })
}

rows.sort((a, b) => b.score - a.score)
console.log(`\n${'seed'.padEnd(22)} ${'corner'.padEnd(14)} score  biomes relief trees  water  peak  biome list`)
for (const r of rows) {
  console.log(
    `${r.seed.padEnd(22)} ${`${r.x},${r.z}`.padEnd(14)} ` +
    `${r.score.toFixed(1).padStart(5)}  ${String(r.biomeCount).padStart(6)} ` +
    `${String(r.relief).padStart(6)} ${(r.treePct * 100).toFixed(0).padStart(4)}% ` +
    `${(r.waterPct * 100).toFixed(0).padStart(5)}% ${String(r.peak).padStart(5)}  ` +
    r.biomes.map(([b, n]) => `${b.replace('minecraft:', '')}:${(n / (PATCH * PATCH) * 100).toFixed(0)}%`).join(' '),
  )
}
