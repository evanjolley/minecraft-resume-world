#!/usr/bin/env node
/*
 * One-off scout for a single seed: score its windows with the SAME scorer
 * that picked 12345, then answer the two questions the scorer cannot.
 *
 *   1. Can you SEE any of it from where you stand? scan.mjs scores a window,
 *      not a viewpoint, and the older pickSpawn credited seed 12345's spawn
 *      with four biomes and a mountain while it stood under a closed dark-oak
 *      canopy (docs/FUTURE.md item 6). So every viewpoint reported here gets
 *      a real ray cast through real blocks: roof overhead, and eight compass
 *      rays at eye height until something opaque stops them.
 *   2. What is actually built here? Chunk NBT carries the structure starts
 *      the generator placed, so villages/temples/mansions are read off disk
 *      rather than guessed at from biome names.
 *
 * Writes a biome map and a shaded height map so the terrain can be LOOKED at,
 * not just tabulated.
 *
 *   node scripts/terrain/seed-report.mjs <seed> [outDir]
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync, gunzipSync } from 'node:zlib'
import nbt from 'prismarine-nbt'
import sharp from 'sharp'
import { World } from './anvil.mjs'
import { survey, bestWindows, worldFor, scoreWindow, PATCH } from './scan.mjs'
import { WORK } from './generate.mjs'

const seed = process.argv[2]
const outDir = process.argv[3] ?? '/tmp/seed-report'
const RADIUS = Number(process.env.RADIUS ?? 256)
if (!seed) throw new Error('usage: seed-report.mjs <seed> [outDir]')
mkdirSync(outDir, { recursive: true })

const dir = join(WORK, `seed-${seed}`)
const world = worldFor(dir)

// ---------------------------------------------------------------- windows
console.log(`surveying seed ${seed} at radius ${RADIUS}...`)
const s = survey(world, RADIUS, { log: m => process.stdout.write(`  ${m}\n`) })
const top = bestWindows(s, 8)
console.log(`\n${'corner'.padEnd(12)} score  biomes relief trees water  peak  biome list`)
for (const r of top) {
  console.log(
    `${`${r.x},${r.z}`.padEnd(12)} ${r.score.toFixed(1).padStart(5)}  ${String(r.biomeCount).padStart(6)} ` +
    `${String(r.relief).padStart(6)} ${(r.treePct * 100).toFixed(0).padStart(4)}% ${(r.waterPct * 100).toFixed(0).padStart(5)}% ` +
    `${String(r.peak).padStart(5)}  ` +
    r.biomes.map(([b, n]) => `${b.replace('minecraft:', '')} ${(n / (PATCH * PATCH) * 100).toFixed(0)}%`).join(', '),
  )
}

// ---------------------------------------------------------------- occlusion
/*
 * A block stops sight if it is not air, not a fluid surface you can see over,
 * and not a plant you can see through. Leaves DO stop sight -- that is the
 * whole point of the check; a canopy is opaque to a person even though the
 * old headroom test called it clear.
 */
const SEE_THROUGH = new Set([
  'minecraft:air', 'minecraft:cave_air', 'minecraft:void_air',
  'minecraft:short_grass', 'minecraft:tall_grass', 'minecraft:fern', 'minecraft:large_fern',
  'minecraft:dead_bush', 'minecraft:snow', 'minecraft:vine', 'minecraft:glass',
  'minecraft:torch', 'minecraft:seagrass', 'minecraft:tall_seagrass', 'minecraft:kelp',
  'minecraft:kelp_plant', 'minecraft:sugar_cane', 'minecraft:lily_pad',
])
const clear = b => b == null || SEE_THROUGH.has(b) ||
  b.endsWith('_sapling') || b.includes('flower') || b.endsWith('_bush') ||
  b === 'minecraft:dandelion' || b === 'minecraft:poppy'

const groundAt = (wx, wz) => {
  const i = (wz + RADIUS) * s.size + (wx + RADIUS)
  return (wx + RADIUS) >= 0 && (wx + RADIUS) < s.size && (wz + RADIUS) >= 0 && (wz + RADIUS) < s.size
    ? s.height[i] : null
}

const DIRS = [['N',0,-1],['NE',1,-1],['E',1,0],['SE',1,1],['S',0,1],['SW',-1,1],['W',-1,0],['NW',-1,-1]]

/** Roof: how many blocks of open air above the standing surface, capped. */
function headroom(wx, wz, g, cap = 24) {
  for (let d = 2; d <= cap; d++) if (!clear(world.block(wx, g + d, wz))) return d - 2
  return cap
}

/** Eye-height ray in one compass direction; returns blocks travelled before blocked. */
function ray(wx, wz, g, dx, dz, max = 96) {
  const eye = g + 2
  for (let d = 1; d <= max; d++) {
    const x = wx + dx * d, z = wz + dz * d
    // Follow the terrain: if the ground rises above the eye, the view ends.
    const gh = groundAt(x, z)
    if (gh == null) return d
    if (gh >= eye) return d
    if (!clear(world.block(x, eye, z)) || !clear(world.block(x, eye + 1, z))) return d
  }
  return max
}

/** Roofed-neighbour share over a 9x9, the metric FUTURE.md used (75/81). */
function roofedShare(wx, wz) {
  let roofed = 0, n = 0
  for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
    const g = groundAt(wx + dx, wz + dz)
    if (g == null) continue
    n++
    if (headroom(wx + dx, wz + dz, g, 16) < 16) roofed++
  }
  return { roofed, n }
}

function viewpoint(label, wx, wz) {
  const g = groundAt(wx, wz)
  if (g == null) { console.log(`\n${label}: outside generated area`); return null }
  const standing = world.block(wx, g, wz)
  const hr = headroom(wx, wz, g)
  const { roofed, n } = roofedShare(wx, wz)
  const rays = DIRS.map(([d, dx, dz]) => [d, ray(wx, wz, g, dx, dz)])
  const open = rays.filter(([, d]) => d >= 48).length
  // Distinct biomes actually reachable by an unobstructed ray.
  const seen = new Set()
  for (const [dname, dx, dz] of DIRS) {
    const reach = ray(wx, wz, g, dx, dz)
    for (let d = 4; d <= reach; d += 4) {
      const gh = groundAt(wx + dx * d, wz + dz * d)
      if (gh != null) seen.add(world.biome(wx + dx * d, gh, wz + dz * d))
    }
  }
  console.log(`\n${label}  (${wx}, ${wz})`)
  console.log(`  standing on ${standing} at y=${g}, biome ${world.biome(wx, g, wz)}`)
  console.log(`  headroom above head: ${hr === 24 ? 'open sky (24+)' : `${hr} blocks then ${world.block(wx, g + hr + 2, wz)}`}`)
  console.log(`  9x9 roofed columns: ${roofed}/${n}`)
  console.log(`  eye-level sight lines: ${rays.map(([d, v]) => `${d} ${v}`).join('  ')}`)
  console.log(`  directions open 48+ blocks: ${open}/8`)
  console.log(`  biomes actually in line of sight: ${[...seen].filter(Boolean).map(b => b.replace('minecraft:', '')).join(', ') || 'none'}`)
  return { wx, wz, g, standing, hr, roofed, n, rays, open, seen: [...seen].filter(Boolean) }
}

// world spawn from level.dat
let spawnX = 0, spawnZ = 0
try {
  const raw = gunzipSync(readFileSync(join(dir, 'world', 'level.dat')))
  const lvl = nbt.simplify(nbt.parseUncompressed(raw)).Data
  spawnX = lvl.SpawnX; spawnZ = lvl.SpawnZ
  console.log(`\nworld spawn from level.dat: ${spawnX}, ${lvl.SpawnY}, ${spawnZ}`)
} catch (e) { console.log(`\nlevel.dat unreadable (${e.message}), using origin`) }

const vps = []
vps.push(['world spawn', viewpoint('WORLD SPAWN', spawnX, spawnZ)])
// Centre of the best window, which is what a patch built here would use.
const best = top[0]
vps.push(['best window centre', viewpoint('BEST WINDOW CENTRE', best.x + PATCH / 2, best.z + PATCH / 2)])

// ---------------------------------------------------------------- structures
console.log('\nreading structure starts from chunk NBT...')
const structures = new Map()
const regionDir = join(dir, 'world', 'region')
for (const f of readdirSync(regionDir).filter(f => f.endsWith('.mca'))) {
  const buf = readFileSync(join(regionDir, f))
  for (let i = 0; i < 1024; i++) {
    const off = buf.readUInt32BE(i * 4)
    if (!(off >> 8)) continue
    const start = (off >> 8) * 4096
    const len = buf.readUInt32BE(start)
    const scheme = buf.readUInt8(start + 4)
    const pay = buf.subarray(start + 5, start + 4 + len)
    let raw
    try { raw = scheme === 1 ? gunzipSync(pay) : scheme === 2 ? inflateSync(pay) : pay } catch { continue }
    let root
    try { root = nbt.simplify(nbt.parseUncompressed(raw)) } catch { continue }
    const starts = root.structures?.starts ?? {}
    for (const [name, v] of Object.entries(starts)) {
      if (v?.id === 'INVALID' || !v?.ChunkX == null) continue
      const bx = (v.ChunkX ?? root.xPos) * 16, bz = (v.ChunkZ ?? root.zPos) * 16
      const key = `${name}@${bx},${bz}`
      if (!structures.has(key)) structures.set(key, { name, bx, bz })
    }
  }
}
const byName = new Map()
for (const st of structures.values()) {
  if (!byName.has(st.name)) byName.set(st.name, [])
  byName.get(st.name).push(st)
}
for (const [name, list] of [...byName].sort()) {
  list.sort((a, b) => Math.hypot(a.bx, a.bz) - Math.hypot(b.bx, b.bz))
  console.log(`  ${name.replace('minecraft:', '').padEnd(24)} ${list.length}  nearest ${list.slice(0, 4).map(l => `(${l.bx},${l.bz})`).join(' ')}`)
}

// ---------------------------------------------------------------- maps
const BIOME_COLOR = {
  ocean: [40, 70, 140], deep_ocean: [25, 50, 110], cold_ocean: [60, 100, 160],
  deep_cold_ocean: [40, 80, 140], lukewarm_ocean: [50, 110, 160], deep_lukewarm_ocean: [35, 90, 145],
  warm_ocean: [60, 140, 180], frozen_ocean: [150, 180, 210], deep_frozen_ocean: [120, 150, 190],
  river: [60, 110, 190], frozen_river: [150, 190, 220], beach: [225, 215, 160],
  snowy_beach: [235, 235, 235], stony_shore: [130, 130, 130],
  plains: [140, 190, 100], sunflower_plains: [170, 200, 90], snowy_plains: [240, 240, 245],
  meadow: [130, 200, 120], forest: [50, 130, 60], flower_forest: [90, 160, 80],
  birch_forest: [130, 175, 110], old_growth_birch_forest: [150, 190, 120],
  dark_forest: [30, 80, 40], taiga: [40, 110, 90], snowy_taiga: [190, 210, 205],
  old_growth_pine_taiga: [50, 100, 70], old_growth_spruce_taiga: [45, 95, 65],
  jungle: [40, 160, 50], sparse_jungle: [80, 170, 60], bamboo_jungle: [110, 190, 60],
  savanna: [190, 180, 90], savanna_plateau: [175, 165, 85], windswept_savanna: [160, 160, 80],
  desert: [235, 215, 140], badlands: [190, 110, 60], eroded_badlands: [200, 120, 70],
  wooded_badlands: [170, 130, 70], swamp: [80, 110, 70], mangrove_swamp: [60, 110, 70],
  windswept_hills: [120, 140, 120], windswept_gravelly_hills: [140, 140, 130],
  windswept_forest: [90, 130, 90], jagged_peaks: [235, 240, 250], frozen_peaks: [215, 230, 245],
  stony_peaks: [160, 155, 150], snowy_slopes: [225, 235, 245], grove: [150, 190, 170],
  ice_spikes: [180, 220, 240], mushroom_fields: [200, 130, 170],
  lush_caves: [90, 170, 90], dripstone_caves: [150, 120, 100], cherry_grove: [235, 160, 190],
}
const colorFor = name => BIOME_COLOR[String(name).replace('minecraft:', '')] ?? [255, 0, 255]

const size = s.size
const biomePx = Buffer.alloc(size * size * 3)
const heightPx = Buffer.alloc(size * size * 3)
let hMin = 9999, hMax = -9999
for (let i = 0; i < size * size; i++) { if (s.height[i] < hMin) hMin = s.height[i]; if (s.height[i] > hMax) hMax = s.height[i] }

for (let z = 0; z < size; z++) {
  for (let x = 0; x < size; x++) {
    const i = z * size + x
    const [r, g, b] = colorFor(s.biome[i])
    // Hillshade: slope against a NW light, so relief reads at a glance.
    const hl = x > 0 ? s.height[i - 1] : s.height[i]
    const hu = z > 0 ? s.height[i - size] : s.height[i]
    const slope = (s.height[i] - hl) + (s.height[i] - hu)
    const shade = Math.max(0.55, Math.min(1.45, 1 + slope * 0.06))
    const water = s.water[i]
    const tree = s.tree[i]
    const cl = c => Math.max(0, Math.min(255, Math.round(c)))
    biomePx[i * 3] = cl(r * shade * (tree ? 0.7 : 1))
    biomePx[i * 3 + 1] = cl(g * shade * (tree ? 0.75 : 1))
    biomePx[i * 3 + 2] = cl(b * shade * (tree ? 0.7 : 1))
    // Height map: blue below sea level, green->brown->white above.
    const h = s.height[i]
    let hc
    if (water) hc = [30, 60, 130 + Math.min(80, (h - hMin)) ]
    else {
      const t = (h - 60) / Math.max(1, (hMax - 60))
      hc = t < 0.33 ? [60 + t * 300, 150 + t * 150, 60]
        : t < 0.7 ? [150 + (t - 0.33) * 200, 130 - (t - 0.33) * 100, 60]
        : [200 + (t - 0.7) * 180, 190 + (t - 0.7) * 200, 180 + (t - 0.7) * 250]
    }
    heightPx[i * 3] = cl(hc[0] * shade); heightPx[i * 3 + 1] = cl(hc[1] * shade); heightPx[i * 3 + 2] = cl(hc[2] * shade)
  }
}
const png = async (buf, name) => {
  await sharp(buf, { raw: { width: size, height: size, channels: 3 } })
    .resize(size * 2, size * 2, { kernel: 'nearest' }).png().toFile(join(outDir, name))
  console.log(`  wrote ${join(outDir, name)}`)
}
console.log(`\nheight range across survey: ${hMin} .. ${hMax}`)
await png(biomePx, `biome-${seed}.png`)
await png(heightPx, `height-${seed}.png`)

writeFileSync(join(outDir, `report-${seed}.json`), JSON.stringify({
  seed, radius: RADIUS, spawn: { x: spawnX, z: spawnZ }, hMin, hMax,
  windows: top, viewpoints: vps, structures: [...byName].map(([n, l]) => [n, l.length]),
}, null, 2))
console.log('done')
