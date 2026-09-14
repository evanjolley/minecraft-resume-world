#!/usr/bin/env node
/*
 * Scores every candidate 128x128 window in every generated seed, and explains
 * the score. The point is to pick a patch on evidence rather than on a seed's
 * reputation -- see seeds.mjs for why reputation is close to worthless here.
 *
 * Three things are measured, because they are the three things that decide
 * whether a walkable patch is worth walking:
 *
 *   biomes  distinct surface biomes touching the window. A "nexus" is the
 *           goal: stand in one place, see several kinds of landscape.
 *   relief  p95 surface height minus p5. Deliberately NOT max-minus-min,
 *           which a single one-column spike or a lake bottom will happily
 *           max out. A hill and a mountain differ by the bulk of the
 *           distribution, not by their extremes.
 *   trees   share of columns containing a log. Leaves are excluded: canopy
 *           overhangs count one tree many times and make a sparse wood look
 *           dense. Note what this measures -- a tree trunk is one to four
 *           columns standing in a five-by-five clearing, so even thick forest
 *           only puts a log in about a tenth of columns. The first target
 *           here was a quarter, which no real terrain can reach, and it
 *           quietly turned tree cover into a term that was always near zero.
 *
 * Each is normalised against a target that represents "clearly good enough"
 * and clipped at 1, so a window with a 200-block cliff cannot buy its way out
 * of being a single-biome wasteland. Weights favour biome count, because that
 * is the stated goal and the hardest of the three to find.
 */
import { World } from './anvil.mjs'
import { join } from 'node:path'

export const PATCH = 128
const STRIDE = 16          // windows start on chunk boundaries
const Y_MIN = -64
const Y_MAX = 320

// Blocks that are ON the terrain rather than part of it. The surface height
// of a column should be the ground, not the top of the oak growing out of it.
const COVER = new Set([
  'minecraft:air', 'minecraft:cave_air', 'minecraft:void_air',
  'minecraft:snow', 'minecraft:short_grass', 'minecraft:tall_grass',
  'minecraft:fern', 'minecraft:large_fern', 'minecraft:dead_bush',
  'minecraft:sugar_cane', 'minecraft:vine', 'minecraft:bamboo',
])
const isLog = n => n.includes('_log') || n.includes('_stem') || n.includes('_wood')
const isLeaf = n => n.includes('_leaves')
const isFluid = n => n === 'minecraft:water' || n === 'minecraft:lava'

/**
 * One pass over a seed's generated area, producing per-column summaries.
 * Everything the window scoring needs is derived from these, so the
 * expensive region decode happens once per seed rather than once per window.
 */
export function survey(world, radius, { log = console.log } = {}) {
  const size = radius * 2
  const height = new Int16Array(size * size)     // ground surface, fluids ignored
  const water = new Uint8Array(size * size)      // column is under water
  const tree = new Uint8Array(size * size)       // a log stands here
  const biome = new Array(size * size)

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const wx = x - radius
      const wz = z - radius
      const i = z * size + x
      let ground = Y_MIN
      let sawFluid = false
      let sawLog = false
      // Top down: the first solid non-cover, non-fluid block is the surface.
      for (let y = Y_MAX; y >= Y_MIN; y--) {
        const b = world.block(wx, y, wz)
        if (!b) break
        if (isFluid(b)) { sawFluid = true; continue }
        if (isLog(b)) { sawLog = true; continue }
        if (COVER.has(b) || isLeaf(b)) continue
        ground = y
        break
      }
      height[i] = ground
      water[i] = sawFluid ? 1 : 0
      tree[i] = sawLog ? 1 : 0
      biome[i] = world.biome(wx, ground, wz)
    }
    if (z % 64 === 0) log(`      column scan ${z}/${size}`)
  }
  return { size, radius, height, water, tree, biome }
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]

/** Score one window whose lower corner is at survey-local (ox, oz). */
export function scoreWindow(s, ox, oz) {
  const heights = []
  const biomes = new Map()
  let trees = 0
  let wet = 0
  for (let z = oz; z < oz + PATCH; z++) {
    for (let x = ox; x < ox + PATCH; x++) {
      const i = z * s.size + x
      heights.push(s.height[i])
      trees += s.tree[i]
      wet += s.water[i]
      const b = s.biome[i]
      if (b) biomes.set(b, (biomes.get(b) ?? 0) + 1)
    }
  }
  heights.sort((a, b) => a - b)
  const relief = pct(heights, 0.95) - pct(heights, 0.05)
  const treePct = trees / heights.length
  const waterPct = wet / heights.length

  /*
   * A biome that clips one corner of the window is not a biome you can walk
   * to. Anything under 2% of the columns is noise from a boundary wobbling
   * across the edge, and counting it inflates every window near a border.
   */
  const solid = [...biomes.entries()].filter(([, n]) => n / heights.length >= 0.02)
  solid.sort((a, b) => b[1] - a[1])

  const n = (v, target) => Math.min(1, v / target)
  const score =
    n(solid.length, 4) * 50 +        // four distinct biomes is a real nexus
    n(relief, 60) * 30 +             // 60 blocks of relief is a mountain
    n(treePct, 0.10) * 20            // a tenth of columns wooded is dense forest

  return {
    score, relief, treePct, waterPct,
    biomeCount: solid.length,
    biomes: solid,
    peak: heights[heights.length - 1],
    median: pct(heights, 0.5),
  }
}

/** Best windows for one seed, best first. */
export function bestWindows(s, keep = 3) {
  const out = []
  for (let oz = 0; oz + PATCH <= s.size; oz += STRIDE) {
    for (let ox = 0; ox + PATCH <= s.size; ox += STRIDE) {
      const r = scoreWindow(s, ox, oz)
      // World coordinates of the window's lower corner.
      r.x = ox - s.radius
      r.z = oz - s.radius
      out.push(r)
    }
  }
  out.sort((a, b) => b.score - a.score)
  return out.slice(0, keep)
}

export const worldFor = dir => new World(join(dir, 'world', 'region'))
