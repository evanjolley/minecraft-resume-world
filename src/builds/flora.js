/*
 * WHAT GROWS: trees, bamboo, grass, ferns, flowers, mushrooms, lily pads,
 * and the odd boulder.
 *
 * ------------------------------------------------------------------------
 * PLACED THE WAY VANILLA PLACES THEM, per 16 x 16 chunk.
 *
 * Minecraft decorates a chunk by running each of its biome's placed
 * features a COUNT of times at random positions in it: a forest asks for 10
 * trees, plains for one every twenty chunks, a bamboo jungle for thirty
 * mostly-bushes. Grass and flowers are RANDOM PATCHES -- RandomPatchFeature
 * picks a centre, then makes `tries` attempts at centre plus
 * (nextInt(spread + 1) - nextInt(spread + 1)) on each axis, so a patch is a
 * clump, densest in the middle, and two patches overlap into a meadow. That
 * is transcribed below as `patch`, and it is why the grass here comes in
 * drifts rather than as an even sprinkle.
 *
 * The counts are vanilla's where vanilla's look right at this scale and
 * NAMED where they are not: plains trees are 0.5 a chunk rather than 0.05,
 * because a 288-block world has room for perhaps eight chunks of open
 * prairie and vanilla's rate would leave chapter 1's whole biome treeless.
 * ------------------------------------------------------------------------
 * KEPT OFF THE WALK. Trees stand back from the path by their own reach plus
 * three, so a canopy never closes over it and never leans into a plot.
 * Grass and flowers may come right up to the path's edge -- that is where a
 * verge has them -- but never onto it, never inside the spawn clearing, and
 * never inside a plot, which the voxel writer refuses anyway.
 */
import { hash, rng, perlin } from './noise.js'
import { BIOME, BAMBOO } from './biomes.js'
import { TREES, REACH } from './trees.js'
import { nearSpawn, SPAWN_CLEAR } from './path.js'

/*
 * TREES PER CHUNK, and which ones, per biome. Each row is the count and a
 * weighted list, from the vanilla placed feature named on the row
 * (VegetationPlacements / TreePlacements, 1.21).
 */
const TREE_TABLE = {
  /* trees_plains: FANCY_OAK_BEES_0002 one time in three, else OAK_BEES. */
  [BIOME.PLAINS]: { count: 0.5, pick: [['fancyOak', 1], ['oak', 2]] },
  /* trees_birch_and_oak: BIRCH 20%, FANCY_OAK 10%, else OAK. Count 10. */
  [BIOME.FOREST]: { count: 9, pick: [['birch', 2], ['fancyOak', 1], ['oak', 7]] },
  /* trees_birch: BIRCH, count 10. */
  [BIOME.BIRCH]: { count: 9, pick: [['birch', 1]] },
  /* dark_forest_vegetation: huge mushrooms 2.5% each, DARK_OAK 66.7%,
   * BIRCH 20%, FANCY_OAK 10%. On a 4 x 4 grid in vanilla, sixteen a chunk. */
  [BIOME.DARK]: {
    count: 14,
    pick: [['brownMushroom', 0.025], ['redMushroom', 0.025], ['darkOak', 0.667],
      ['birch', 0.2], ['fancyOak', 0.1]],
  },
  /* bamboo_jungle: FANCY_OAK 5%, JUNGLE_BUSH 50%, MEGA_JUNGLE 33% (small
   * jungle trees here; see trees.js), count 30. Fewer here, because the
   * bamboo is the jungle. */
  [BIOME.BAMBOO]: { count: 8, pick: [['fancyOak', 0.05], ['jungleBush', 0.5], ['jungle', 0.45]] },
  /* The river's banks: a plains rate, oak and birch. */
  [BIOME.RIVERLANDS]: { count: 0.8, pick: [['oak', 2], ['fancyOak', 1], ['birch', 1]] },
  /* trees_taiga: PINE one in three, else SPRUCE. Count 10. */
  [BIOME.TAIGA]: { count: 9, pick: [['pine', 1], ['spruce', 2]] },
  /* trees_windswept_hills: SPRUCE 66%, FANCY_OAK 10%, else OAK; count 0
   * plus 10% of one. A little more here, for the same reason as plains. */
  [BIOME.HILLS]: { count: 0.7, pick: [['spruce', 0.66], ['fancyOak', 0.1], ['oak', 0.24]] },
  /* jagged_peaks: no trees at all. */
  [BIOME.PEAKS]: { count: 0, pick: [] },
}

/*
 * GROUND COVER PER CHUNK, at HALF vanilla's grass counts (see PLANT_REACH
 * below for why). `grass` is patches of 32 tries at spread 7
 * (PATCH_GRASS, PATCH_GRASS_JUNGLE, PATCH_TAIGA_GRASS), with the fern share
 * of the taiga and jungle mixes; `tall` patches of double tall grass or
 * large fern; `flowers` the biome's flower patches; `mush` mushrooms.
 */
const COVER = {
  [BIOME.PLAINS]: { grass: 3, fern: 0, tall: 0.8, flowers: 0.9, mush: 0 },
  [BIOME.FOREST]: { grass: 1, fern: 0, tall: 0.2, flowers: 0.5, mush: 0.2 },
  [BIOME.BIRCH]: { grass: 1, fern: 0, tall: 0.2, flowers: 0.5, mush: 0.2 },
  [BIOME.DARK]: { grass: 1, fern: 0.1, tall: 0.1, flowers: 0.2, mush: 1.0 },
  [BIOME.BAMBOO]: { grass: 5, fern: 0.25, tall: 0.6, flowers: 0, mush: 0 },
  [BIOME.RIVERLANDS]: { grass: 2.5, fern: 0, tall: 0.6, flowers: 0.6, mush: 0 },
  [BIOME.TAIGA]: { grass: 2, fern: 0.8, tall: 0.8, flowers: 0.1, mush: 0.4 },
  [BIOME.HILLS]: { grass: 1, fern: 0.1, tall: 0.2, flowers: 0.3, mush: 0 },
  [BIOME.PEAKS]: { grass: 0, fern: 0, tall: 0, flowers: 0, mush: 0 },
}

/** Ground a plant or a tree may stand on. Vanilla's `dirt` tag, more or
 *  less: grass, dirt, podzol, coarse and rooted dirt, moss. */
const SOIL = new Set(['grass', 'dirt', 'podzol', 'coarse_dirt', 'rooted_dirt', 'moss_block'])

/** Pick from a weighted list. */
function pick(list, u) {
  let total = 0
  for (const [, w] of list) total += w
  let t = u * total
  for (const [k, w] of list) { t -= w; if (t <= 0) return k }
  return list[list.length - 1][0]
}

/** A fractional count, as vanilla's countExtra does: the integer part
 *  always, the fraction as a chance of one more. */
const countOf = (c, r) => Math.floor(c) + (r() < c - Math.floor(c) ? 1 : 0)

/*
 * THE FLOWERS, by biome and by place.
 *
 * Plains (FLOWER_PLAINS) choose by a noise field: where it is low, tulips
 * of one colour; elsewhere poppy, azure bluet, oxeye daisy, cornflower or
 * dandelion. Forests (FLOWER_DEFAULT) are dandelions and poppies two to one,
 * and FOREST_FLOWERS adds lilac, rose bush, peony and lily of the valley.
 * The riverbanks borrow the plains mix and add blue orchids, which in
 * vanilla are the swamp's.
 */
const TULIPS = ['red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip']
function flowerFor(biome, x, z, r) {
  if (biome === BIOME.PLAINS || biome === BIOME.RIVERLANDS) {
    const n = perlin(x / 48 + 300, z / 48 + 300)
    if (n < -0.25) return TULIPS[Math.floor(hash(x >> 4, z >> 4, 31) * 4)]
    const mix = biome === BIOME.RIVERLANDS
      ? ['poppy', 'azure_bluet', 'oxeye_daisy', 'dandelion', 'blue_orchid', 'cornflower']
      : ['poppy', 'azure_bluet', 'oxeye_daisy', 'cornflower', 'dandelion', 'dandelion']
    return mix[Math.floor(r() * mix.length)]
  }
  if (biome === BIOME.FOREST || biome === BIOME.BIRCH) {
    const u = r()
    if (u < 0.35) return ['lilac', 'rose_bush', 'peony', 'lily_of_the_valley'][Math.floor(r() * 4)]
    return u < 0.78 ? 'dandelion' : 'poppy'
  }
  return r() < 0.66 ? 'dandelion' : 'poppy'
}

const DOUBLE = new Set(['tall_grass', 'large_fern', 'lilac', 'rose_bush', 'peony'])

/*
 * HOW MUCH GROUND COVER, and it is a frame-rate decision as much as a look.
 *
 * Every plant is an object-mesh instance, and noa draws every instance in
 * every loaded chunk every frame (thin instances are not culled one by one).
 * Measured on the test rig's SwiftShader at spawn: no plants 25 fps, the
 * first pass's 19,000 plants 12 fps. So the grass patch counts in COVER are
 * half of vanilla's, and beyond PLANT_REACH blocks of the walk only one plant
 * in FAR_SHARE survives: the verge a visitor walks past is full, the hillside
 * two hundred blocks off is sparse, and nobody can tell the difference from
 * the path. About 6,000 plants; 18 fps on the same rig.
 */
const PLANT_REACH = 22
const FAR_SHARE = 0.15

/**
 * Plant everything. `V` is the voxel writer, `model` the finished land
 * model (heights, kinds, biomes, surfaces, and `dWalk` / `dWater`, the
 * distances to the nearest walk and water column).
 *
 * @returns counts by kind, for the console and the specs
 */
export function plantAll(V, model, KIND) {
  const { W, D } = model
  const stats = { trees: 0, bamboo: 0, plants: 0, boulders: 0, lily: 0 }

  /* May a tree of this reach stand at (x, z)? */
  const treeOk = (x, z, reach) => {
    if (x < 0 || x >= W || z < 0 || z >= D) return false
    const i = z * W + x
    if (model.kind[i] !== KIND.FIELD || model.standing[i]) return false
    if (!SOIL.has(model.top[i])) return false
    if (model.dWalk[i] < reach + 3) return false
    if (model.dPlot[i] < reach + 2) return false
    if (model.dWater[i] < 2) return false
    if (nearSpawn(x, z, SPAWN_CLEAR + 6)) return false
    return true
  }

  /* 1. TREES, chunk by chunk. */
  const stands = []
  for (let cz = 0; cz < D; cz += 16) {
    for (let cx = 0; cx < W; cx += 16) {
      const r = rng(Math.imul(cx + 1, 0x9e3779b1) ^ Math.imul(cz + 1, 0x85ebca6b) ^ 0x7ee5)
      const centre = Math.min(D - 1, cz + 8) * W + Math.min(W - 1, cx + 8)
      const row = TREE_TABLE[model.biome[centre]]
      /* Bamboo stands first, in the bamboo jungle: vanilla's BambooFeature
       * runs before the trees' canopies would crop the stalks. */
      if (model.biome[centre] === BIOME.BAMBOO) {
        for (let k = 0; k < 7; k++) {
          const x = cx + Math.floor(r() * 16), z = cz + Math.floor(r() * 16)
          if (x >= W || z >= D) continue
          const i = z * W + x
          if (model.biome[i] !== BIOME.BAMBOO) continue
          if (!treeOk(x, z, 2)) continue
          stands.push([x, z])
        }
      }
      if (!row || row.count === 0) continue
      const n = countOf(row.count, r)
      for (let k = 0; k < n; k++) {
        const x = cx + Math.floor(r() * 16), z = cz + Math.floor(r() * 16)
        if (x >= W || z >= D) continue
        const i = z * W + x
        /* The column's own biome decides the species, so the chunk's count
         * is the chunk's and the edge of a wood is mixed. */
        const brow = TREE_TABLE[model.biome[i]]
        if (!brow || brow.pick.length === 0) continue
        const kind = pick(brow.pick, r())
        if (!treeOk(x, z, REACH[kind])) continue
        if (TREES[kind](V, x, model.h[i], z)) {
          model.standing[i] = 1
          stats.trees++
        }
      }
    }
  }
  for (const [x, z] of stands) stats.bamboo += bambooStand(V, model, x, z, KIND)

  /* 2. GROUND COVER: random patches, chunk by chunk. */
  const plantAt = (x, z, key) => {
    if (x < 0 || x >= W || z < 0 || z >= D) return false
    const i = z * W + x
    if (model.kind[i] !== KIND.FIELD || model.standing[i]) return false
    if (model.top[i] !== 'grass' && model.top[i] !== 'podzol' && model.top[i] !== 'coarse_dirt') return false
    if (model.dWalk[i] < 1.5 || model.dWater[i] < 1) return false
    if (model.dWalk[i] > PLANT_REACH && hash(x, z, 977) > FAR_SHARE) return false
    if (nearSpawn(x, z, SPAWN_CLEAR)) return false
    const y = model.h[i]
    if (!V.open(x, y, z)) return false
    if (DOUBLE.has(key)) {
      if (!V.open(x, y + 1, z)) return false
      V.put(x, y, z, key)
      V.put(x, y + 1, z, `${key}_top`)
    } else {
      V.put(x, y, z, key)
    }
    model.standing[i] = 1
    stats.plants++
    return true
  }
  const patch = (r, cx, cz, tries, spread, choose) => {
    const ox = cx + Math.floor(r() * 16), oz = cz + Math.floor(r() * 16)
    for (let t = 0; t < tries; t++) {
      const x = ox + Math.floor(r() * (spread + 1)) - Math.floor(r() * (spread + 1))
      const z = oz + Math.floor(r() * (spread + 1)) - Math.floor(r() * (spread + 1))
      if (x < 0 || x >= W || z < 0 || z >= D) continue
      const key = choose(model.biome[z * W + x], x, z)
      if (key) plantAt(x, z, key)
    }
  }
  for (let cz = 0; cz < D; cz += 16) {
    for (let cx = 0; cx < W; cx += 16) {
      const r = rng(Math.imul(cx + 3, 0x27d4eb2d) ^ Math.imul(cz + 5, 0x165667b1) ^ 0xf10a)
      const centre = Math.min(D - 1, cz + 8) * W + Math.min(W - 1, cx + 8)
      const c = COVER[model.biome[centre]]
      if (!c) continue
      /* Tall plants first, so the short grass does not take their ground. */
      for (let k = countOf(c.tall, r); k > 0; k--) {
        patch(r, cx, cz, 16, 5, (b) => {
          if (b === BIOME.PEAKS) return null
          return (b === BIOME.TAIGA || b === BIOME.BAMBOO) && r() < 0.6 ? 'large_fern' : 'tall_grass'
        })
      }
      for (let k = countOf(c.flowers, r); k > 0; k--) {
        const fx = cx + 8, fz = cz + 8
        patch(r, cx, cz, 16, 5, (b) => (b === BIOME.PEAKS ? null : flowerFor(b, fx, fz, r)))
      }
      for (let k = countOf(c.mush, r); k > 0; k--) {
        patch(r, cx, cz, 8, 4, (b) => (b === BIOME.PEAKS ? null : r() < 0.5 ? 'brown_mushroom' : 'red_mushroom'))
      }
      for (let k = countOf(c.grass, r); k > 0; k--) {
        patch(r, cx, cz, 32, 7, (b) => {
          const cb = COVER[b]
          if (!cb || cb.grass === 0) return null
          return r() < cb.fern ? 'fern' : 'short_grass'
        })
      }
    }
  }

  /* 3. LILY PADS on the lake and the slack water at the river's edges:
   *    vanilla's PATCH_WATERLILY, ten tries a patch. Only on water one block
   *    deep or more with air above, and never under a bridge. */
  for (let i = 0; i < W * D; i++) {
    if (model.kind[i] !== KIND.WATER) continue
    const x = i % W, z = (i / W) | 0
    const lake = model.lake[i] === 2
    if (hash(x, z, 913) > (lake ? 0.06 : 0.02)) continue
    if (!lake && model.depth[i] > 1) continue
    if (V.put(x, -1, z, 'lily_pad')) stats.lily++
  }

  /* 4. BOULDERS in the taiga and the hills: vanilla's FOREST_ROCK, a blob
   *    of mossy cobblestone sat in the ground. */
  for (let cz = 0; cz < D; cz += 16) {
    for (let cx = 0; cx < W; cx += 16) {
      const r = rng(Math.imul(cx + 7, 0x3c6ef372) ^ Math.imul(cz + 9, 0x2545f491) ^ 0xb01d)
      const centre = Math.min(D - 1, cz + 8) * W + Math.min(W - 1, cx + 8)
      const b = model.biome[centre]
      if (b !== BIOME.TAIGA && b !== BIOME.HILLS) continue
      if (r() > 0.3) continue
      const x = cx + Math.floor(r() * 16), z = cz + Math.floor(r() * 16)
      if (!treeOk(x, z, 1)) continue
      const y = model.h[z * W + x]
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 2) continue
            if (r() < 0.25) continue
            V.rock(x + dx, y + dy, z + dz, r() < 0.7 ? 'mossy_cobblestone' : 'cobblestone')
          }
        }
      }
      model.standing[z * W + x] = 1
      stats.boulders++
    }
  }
  return stats
}

/*
 * A BAMBOO STAND: six to eleven stalks in a five-block square, six to
 * fifteen tall, each a column of separate blocks with its leaves only at the
 * top and one offset variant all the way up. See BAMBOO in biomes.js for the
 * three rules. One stand in five also turns the ground under it to podzol,
 * which is BambooFeature's `probability` of a podzol disc.
 */
function bambooStand(V, model, x, z, KIND) {
  const { W, D } = model
  let placed = 0
  const podzol = hash(x, z, 421) < 0.2
  const n = 6 + Math.floor(hash(x, z, 71) * 6)
  for (let k = 0; k < n; k++) {
    const px = x + Math.round((hash(x, z, 401 + k) - 0.5) * 5)
    const pz = z + Math.round((hash(x, z, 431 + k) - 0.5) * 5)
    if (px < 0 || px >= W || pz < 0 || pz >= D) continue
    const j = pz * W + px
    if (model.kind[j] !== KIND.FIELD || model.standing[j]) continue
    if (model.dWalk[j] < 3 || model.dPlot[j] < 2) continue
    if (!SOIL.has(model.top[j])) continue
    const foot = model.h[j]
    /* As tall as the hash says, or as tall as the open air above it is: a
     * stalk that grew into a canopy would lose its leaves to the leaves
     * already there, and a stalk with no leaves is a green stick. */
    let h = 6 + Math.floor(hash(px, pz, 457) * 10)
    let room = 0
    while (room < h && V.open(px, foot + room, pz)) room++
    h = room
    if (h < 3) continue
    const v = Math.floor(hash(px, pz, 463) * 4) & 3
    for (let y = 0; y < h - 2; y++) V.put(px, foot + y, pz, BAMBOO.cane[v])
    V.put(px, foot + h - 2, pz, BAMBOO.small[v])
    V.put(px, foot + h - 1, pz, BAMBOO.large[v])
    if (podzol) V.surface(px, pz, 'podzol')
    model.standing[j] = 1
    placed++
  }
  for (let k = 0; k < 3; k++) {
    const px = x + Math.round((hash(x, z, 467 + k) - 0.5) * 6)
    const pz = z + Math.round((hash(x, z, 479 + k) - 0.5) * 6)
    if (px < 0 || px >= W || pz < 0 || pz >= D) continue
    const j = pz * W + px
    if (model.kind[j] !== KIND.FIELD || model.standing[j] || model.dWalk[j] < 2) continue
    if (!SOIL.has(model.top[j])) continue
    if (V.put(px, model.h[j], pz, BAMBOO.sapling)) model.standing[j] = 1
  }
  return placed
}
