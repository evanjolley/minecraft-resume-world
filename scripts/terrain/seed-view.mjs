#!/usr/bin/env node
/*
 * The occlusion half of seed scouting, and the piece scan.mjs has never had.
 *
 * scan.mjs scores a 128x128 window; it says nothing about whether a person
 * inside that window can SEE any of what it scored. docs/FUTURE.md item 6 is
 * the cost of that gap: seed 12345's spawn was credited with four biomes and
 * a mountain while standing under a closed dark-oak canopy, 75 of 81 columns
 * roofed. So this file does two things the scorer cannot.
 *
 *   1. Search for viewpoints by what is VISIBLE from them. A column scores on
 *      open sky, long ground sight lines, distinct biomes reached by an
 *      unobstructed ray, and how much tall terrain rises into view.
 *   2. Draw the skyline. For 360 azimuths it marches out, tracks the highest
 *      elevation ANGLE reached, and paints that horizon by biome -- so a
 *      mountain wall and a wall of leaves stop looking alike, which they do
 *      in every number a ground-distance test produces.
 *
 * The angle matters: a ray that stops after 20 blocks because a 90-block
 * mountain face is in the way is not the same view as a ray that stops after
 * 4 blocks because of oak leaves, and "sight distance" alone scores them
 * identically. That confusion is exactly what put the island under a canopy.
 *
 *   node scripts/terrain/seed-view.mjs <seed> <outDir> [x z ...]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { survey, worldFor } from './scan.mjs'
import { WORK } from './generate.mjs'

const seed = process.argv[2]
const outDir = process.argv[3]
const explicit = process.argv.slice(4).map(Number)
const R = Number(process.env.RADIUS ?? 256)
mkdirSync(outDir, { recursive: true })

const world = worldFor(join(WORK, `seed-${seed}`))
console.log('surveying...')
const s = survey(world, R, { log: () => {} })
const G = (x, z) => {
  const ix = x + R, iz = z + R
  if (ix < 0 || ix >= s.size || iz < 0 || iz >= s.size) return null
  return s.height[iz * s.size + ix]
}
const B = (x, z) => {
  const ix = x + R, iz = z + R
  if (ix < 0 || ix >= s.size || iz < 0 || iz >= s.size) return null
  return s.biome[iz * s.size + ix]
}

const SEE_THROUGH = new Set([
  'minecraft:air', 'minecraft:cave_air', 'minecraft:void_air', 'minecraft:snow',
  'minecraft:short_grass', 'minecraft:tall_grass', 'minecraft:fern', 'minecraft:large_fern',
  'minecraft:dead_bush', 'minecraft:vine', 'minecraft:sugar_cane', 'minecraft:lily_pad',
])
const clear = b => b == null || SEE_THROUGH.has(b) || b.endsWith('_sapling') ||
  b.includes('flower') || b === 'minecraft:dandelion' || b === 'minecraft:poppy'

const headroom = (x, z, g, cap = 20) => {
  for (let d = 2; d <= cap; d++) if (!clear(world.block(x, g + d, z))) return d - 2
  return cap
}

/*
 * March one azimuth from an eye at (x, z, eye). Returns the horizon: the
 * greatest elevation angle seen, where it was, and what biome made it -- plus
 * the distance at which the view was first occluded by something at eye
 * height (leaves, a trunk, a near wall), because a canopy blocks the sky
 * without ever producing an angle.
 */
function march(x, z, eye, ax, az, max = 200) {
  let bestAng = -Math.PI / 2, bestD = 0, bestBiome = null, bestY = eye
  let blocked = max
  for (let d = 1; d <= max; d++) {
    const px = Math.round(x + ax * d), pz = Math.round(z + az * d)
    const g = G(px, pz)
    if (g == null) { blocked = Math.min(blocked, d); break }
    // Canopy/near-wall: an opaque block at eye height within the first stretch.
    if (blocked === max && (!clear(world.block(px, eye, pz)) || !clear(world.block(px, eye + 1, pz)))) blocked = d
    const ang = Math.atan2(g - eye, d)
    if (ang > bestAng) { bestAng = ang; bestD = d; bestBiome = B(px, pz); bestY = g }
    // Nothing beyond a wall that already fills the upper sky can be seen.
    if (ang > 1.2) break
  }
  return { ang: bestAng, d: bestD, biome: bestBiome, y: bestY, blocked }
}

const AZ = 180
const azimuths = Array.from({ length: AZ }, (_, i) => {
  const t = (i / AZ) * Math.PI * 2
  return [Math.sin(t), -Math.cos(t)]   // i=0 is north, clockwise
})

function look(x, z) {
  const g = G(x, z)
  if (g == null) return null
  const eye = g + 2
  const hr = headroom(x, z, g)
  const hs = azimuths.map(([ax, az]) => march(x, z, eye, ax, az))
  const biomes = new Set(hs.map(h => h.biome).filter(Boolean))
  const openSky = hr >= 20
  const longView = hs.filter(h => h.blocked >= 64).length / AZ
  const relief = Math.max(...hs.map(h => h.y)) - g
  const meanBlocked = hs.reduce((a, h) => a + h.blocked, 0) / AZ
  const skyline = Math.max(...hs.map(h => h.ang)) * 180 / Math.PI
  const score =
    (openSky ? 25 : 0) +
    Math.min(1, longView / 0.5) * 30 +
    Math.min(1, biomes.size / 4) * 25 +
    Math.min(1, relief / 80) * 20
  return { x, z, g, eye, hr, openSky, longView, meanBlocked, biomes: [...biomes], relief, skyline, hs, score }
}

// ------------------------------------------------------- search for viewpoints
let candidates = []
if (explicit.length) {
  for (let i = 0; i < explicit.length; i += 2) candidates.push([explicit[i], explicit[i + 1]])
} else {
  /*
   * Coarse grid over the survey; the full ray test is too slow per-column.
   *
   * BOX=x0,z0,size,margin narrows the search to one candidate patch. Added
   * because picking a viewpoint for a patch that has ALREADY been chosen is a
   * different question from scouting a seed: a column 200 blocks outside the
   * border is not a spawn candidate however good the view is, and the whole
   * point of the margin is that a spawn should not open onto a barrier wall.
   */
  const box = (process.env.BOX ?? '').split(',').map(Number)
  if (box.length >= 3 && box.every(n => Number.isFinite(n))) {
    const [bx, bz, bs] = box
    const m = box[3] ?? 48
    console.log(`searching viewpoints inside (${bx},${bz})+${bs} with a ${m}-block margin...`)
    for (let z = bz + m; z < bz + bs - m; z += 8) for (let x = bx + m; x < bx + bs - m; x += 8) candidates.push([x, z])
  } else {
    console.log('searching viewpoints on a 24-block grid...')
    for (let z = -R + 32; z < R - 32; z += 24) for (let x = -R + 32; x < R - 32; x += 24) candidates.push([x, z])
  }
}
const results = []
for (const [x, z] of candidates) {
  const r = look(x, z)
  if (r) results.push(r)
}
results.sort((a, b) => b.score - a.score)
console.log(`\n${'pos'.padEnd(14)} y   view  openSky meanSight biomes relief skyline  biome list`)
for (const r of results.slice(0, 10)) {
  console.log(
    `${`${r.x},${r.z}`.padEnd(14)} ${String(r.g).padStart(3)} ${r.score.toFixed(1).padStart(5)}  ` +
    `${(r.openSky ? 'yes' : 'no').padEnd(7)} ${r.meanBlocked.toFixed(0).padStart(9)} ${String(r.biomes.length).padStart(6)} ` +
    `${String(r.relief).padStart(6)} ${r.skyline.toFixed(0).padStart(6)}deg  ` +
    r.biomes.map(b => b.replace('minecraft:', '')).join(', '),
  )
}

// ------------------------------------------------------- draw the skylines
const BIOME_COLOR = {
  ocean: [40,70,140], deep_ocean:[25,50,110], river:[60,110,190], frozen_river:[150,190,220],
  beach:[225,215,160], snowy_beach:[235,235,235], stony_shore:[130,130,130],
  plains:[140,190,100], snowy_plains:[240,240,245], meadow:[130,200,120],
  forest:[50,130,60], birch_forest:[130,175,110], old_growth_birch_forest:[150,190,120],
  dark_forest:[30,80,40], taiga:[40,110,90], snowy_taiga:[190,210,205], grove:[150,190,170],
  windswept_hills:[120,140,120], windswept_forest:[90,130,90],
  jagged_peaks:[235,240,250], frozen_peaks:[215,230,245], stony_peaks:[160,155,150],
  snowy_slopes:[225,235,245], swamp:[80,110,70], desert:[235,215,140], savanna:[190,180,90],
}
const col = n => BIOME_COLOR[String(n).replace('minecraft:', '')] ?? [255, 0, 255]

async function panorama(r, name) {
  const W = 720, H = 240
  const px = Buffer.alloc(W * H * 3)
  const skyTop = [96, 150, 220], skyBot = [180, 210, 240]
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = y / H, i = (y * W + x) * 3
    px[i] = skyTop[0] + (skyBot[0] - skyTop[0]) * t
    px[i + 1] = skyTop[1] + (skyBot[1] - skyTop[1]) * t
    px[i + 2] = skyTop[2] + (skyBot[2] - skyTop[2]) * t
  }
  // Vertical axis spans -35deg (below) to +55deg (above); horizon at 0.
  const A_HI = 55, A_LO = -35
  const row = a => Math.round((A_HI - a) / (A_HI - A_LO) * H)
  for (let c = 0; c < W; c++) {
    const h = r.hs[Math.floor(c / W * AZ) % AZ]
    const deg = h.ang * 180 / Math.PI
    const top = Math.max(0, Math.min(H - 1, row(deg)))
    const [cr, cg, cb] = col(h.biome)
    // Haze with distance so near canopy reads darker than a far peak.
    const f = Math.min(1, h.d / 200) * 0.55
    for (let y = top; y < H; y++) {
      const i = (y * W + c) * 3
      const shade = 1 - Math.min(0.35, (y - top) / H)
      px[i] = cr * shade * (1 - f) + 200 * f
      px[i + 1] = cg * shade * (1 - f) + 215 * f
      px[i + 2] = cb * shade * (1 - f) + 235 * f
    }
    // Red tick along the horizon where the view is blocked inside 16 blocks.
    if (h.blocked < 16) {
      const y = row(0)
      for (let k = -2; k <= 2; k++) {
        const i = ((y + k) * W + c) * 3
        if (i >= 0 && i < px.length - 3) { px[i] = 220; px[i + 1] = 40; px[i + 2] = 40 }
      }
    }
  }
  await sharp(px, { raw: { width: W, height: H, channels: 3 } }).png().toFile(join(outDir, name))
  console.log(`  wrote ${name}  (N at left edge, then E, S, W; horizon at 39% height; red = blocked within 16 blocks)`)
}

const picks = explicit.length ? results : [results[0], ...results.slice(1).filter(r => Math.hypot(r.x - results[0].x, r.z - results[0].z) > 96).slice(0, 2)]
for (const r of picks) if (r) await panorama(r, `pano-${seed}-${r.x}_${r.z}.png`)
console.log('done')
