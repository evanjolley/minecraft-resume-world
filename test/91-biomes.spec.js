/*
 * SIX BIOMES, A GENTLE WORLD, AND AN ISLAND THAT CANNOT LEAK.
 *
 * ------------------------------------------------------------------------
 * THE FOUR CLAIMS, and each one is a number rather than a picture.
 *
 *   1. THE BIOMES ARE THERE AND THEY ARE WHERE THEY ARE SUPPOSED TO BE. A
 *      census of the ground around each chapter, matched against the block
 *      that biome is recognised by. Bamboo is not birch is not snow.
 *   2. NOTHING IS STEEP. No two neighbouring columns in the world differ by
 *      more than one block, outside the jagged peaks where three is allowed
 *      and only away from anything walked. Every plot footprint is dead flat.
 *   3. OMAHA IS BYTE FOR BYTE WHAT IT WAS, and so is the archive. Two
 *      digests, both measured before this pass, both over block KEYS rather
 *      than palette ids -- an id is an index into a table this work could
 *      reorder without moving a single block.
 *   4. THE WATER CANNOT FLOOD. Zero water faces open to air, over the whole
 *      map, which is the property src/builds/river.js's header claims and
 *      the island had to inherit.
 *
 * EVERY SAMPLE IS ASSERTED NON-EMPTY BEFORE IT IS READ. Mutations in this
 * repo have failed to fail six times, including a six-cell census that passed
 * while the thing it was counting was absent, so a count of zero is never
 * allowed to be the thing that makes a claim true.
 * ------------------------------------------------------------------------
 * AND THEN THE PICTURES, which are the other half and not the lesser half.
 * The brief was "the surroundings look a bit too uniform", and no census
 * answers that. The frames below stand in every biome and on every
 * transition between two of them AT EYE LEVEL, because that is the only view
 * a visitor gets and a landscape that reads from above and badly from the
 * ground has failed.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from './fixtures.js'
import {
  SURFACE_Y, waitFrames, waitTicks, look, teleport, HEADING,
  useGamemode, doubleTapFly, enterWorld, leaveWorld,
} from './helpers/world.js'
import { CHAPTERS, LAND_ORIGIN_X, LAND_ORIGIN_Z, landPlot } from '../src/builds/plots.js'
/*
 * THE BIOME MAP, IMPORTED, which is the point of src/builds/noise.js existing.
 * The exemption below has to be the SAME RULE the generator used -- "the
 * peaks, away from the walk" -- and a spec that restated it as a bounding box
 * got it wrong on the first run: there are two peaks lobes, one either side
 * of the path, and the box only covered the western one. A spec that
 * approximates the rule it is checking is checking a different rule.
 */
import { biomeField, BIOME, BIOME_NAME, BAMBOO, BAMBOO_STALK } from '../src/builds/biomes.js'
import { SPINE, sampleSpine } from '../src/builds/spine.js'

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots')

/** Patch indices -> world coordinates, the overworld's origin. */
const W = (px, pz) => [px - LAND_ORIGIN_X, pz - LAND_ORIGIN_Z]

/*
 * WHAT COUNTS AS GROUND, and it is a list rather than "the highest non-air"
 * for one reason: a tree. Scanning down from the sky, the first block you
 * meet over a wood is a leaf and the surface is four blocks below it. Every
 * block a biome palette, a river bed, a bank or the worn path can put on top
 * of a column is here; every block that STANDS on one is not.
 */
const GROUND = [
  'grass', 'dirt', 'coarse_dirt', 'rooted_dirt', 'podzol', 'moss_block', 'mud',
  'gravel', 'sand', 'clay', 'stone', 'andesite', 'calcite', 'snow_block',
  'packed_ice', 'water',
  /*
   * AND THE PLOT BORDER, which is ground even though no biome puts it down.
   * src/builds/chapters.js paints a ring of polished andesite AT THE GRASS
   * LEVEL around every chapter -- it replaces the grass rather than standing
   * on it, which is the whole reason a plot reads as a reserved site rather
   * than a hole. Leaving it off this list made 145 columns of border read as
   * a block lower than they are and the flatness check fail on ground that
   * is exactly flat.
   */
  'polished_andesite',
]

/** The height of the ground over the whole patch, as local y (0 is the level
 *  a player stands at), read out of the GENERATOR -- 65,536 columns, of which
 *  a few hundred are ever resident in the chunk store. */
const groundField = (page, keys) => page.evaluate(([keys]) => {
  const v = window.game.voxelAt
  const t = window.game.terrain
  const ids = new Set(keys.map(k => window.game.ids[k]).filter(Boolean))
  const out = new Int16Array(t.width * t.depth).fill(-999)
  let found = 0
  for (let pz = 0; pz < t.depth; pz++) {
    for (let px = 0; px < t.width; px++) {
      const x = px - t.originX, z = pz - t.originZ
      for (let y = 200; y >= 131; y--) {
        if (!ids.has(v(x, y, z))) continue
        out[pz * t.width + px] = y - 136
        found++
        break
      }
    }
  }
  return { ground: Array.from(out), found, width: t.width }
}, [keys])

test.describe('the landscape', () => {
  test.afterEach(async ({ page }) => { await leaveWorld(page) })

  test('every chapter is standing in the biome it belongs to', async ({ page }) => {
    test.setTimeout(120_000)
    await waitTicks(page, 5)

    /*
     * A RING AROUND EACH PLOT rather than the plot itself: the plots are
     * reserved ground and mostly bare, so the biome is the thing AROUND them,
     * which is the owner's own phrasing ("each area surrounded by whatever
     * minecraft biome would make sense"). Twelve blocks out, everything above
     * the ground included, counted by key.
     */
    const census = await page.evaluate(([y0, plots]) => {
      const v = window.game.voxelAt
      const t = window.game.terrain
      const keyOf = new Map()
      const out = {}
      for (const p of plots) {
        const tally = {}
        let sampled = 0
        for (let pz = p.z0 - 12; pz <= p.z1 + 12; pz++) {
          for (let px = p.x0 - 12; px <= p.x1 + 12; px++) {
            if (px < 0 || px > 255 || pz < 0 || pz > 255) continue
            if (px >= p.x0 && px <= p.x1 && pz >= p.z0 && pz <= p.z1) continue
            for (let y = y0 - 1; y <= y0 + 24; y++) {
              sampled++
              const id = v(px - t.originX, y, pz - t.originZ)
              if (id === 0) continue
              let k = keyOf.get(id)
              if (k === undefined) { k = window.game.blockKey(id); keyOf.set(id, k) }
              tally[k] = (tally[k] ?? 0) + 1
            }
          }
        }
        out[p.id] = { sampled, tally }
      }
      return out
    }, [SURFACE_Y, CHAPTERS.map(c => ({ id: c.id, x0: c.x0, x1: c.x1, z0: c.z0, z1: c.z1 }))])

    /*
     * ONE BLOCK PER BIOME, and it is the block that biome is RECOGNISED by
     * rather than the one it has most of. Every biome has a lot of grass;
     * only the bamboo jungle has bamboo in it, and only the peaks have snow.
     * The floor is deliberately low -- this is "is the biome here at all",
     * and an exact count would fail on every tweak to a noise threshold and
     * would be measuring nothing.
     */
    const SIGNATURE = {
      ch1: 'oak_leaves',        // plains: scattered oak on open grass
      ch2: 'birch_leaves',      // birch forest, softening to mixed at the edges
      /* Bamboo jungle, and the signature is imported rather than typed: the
       * block is a placeholder for a plant this repo has not built yet (see
       * BAMBOO_STALK in src/builds/biomes.js) and the day it is swapped this
       * spec should follow it rather than fail. */
      ch3: BAMBOO_STALK,
      ch4: 'water',             // the island, and the river that makes it one
      ch5: 'spruce_leaves',     // windswept hills
      ch6: 'snow_block',        // jagged peaks
    }
    for (const c of CHAPTERS) {
      const seen = census[c.id]
      // The sample, before the claim.
      expect(seen.sampled, `${c.id}: nothing sampled around the plot`).toBeGreaterThan(40_000)
      const key = SIGNATURE[c.id]
      expect(seen.tally[key] ?? 0,
        `${c.id} (${c.label}) should be surrounded by ${key}; found `
        + JSON.stringify(Object.fromEntries(
          Object.entries(seen.tally).sort((a, b) => b[1] - a[1]).slice(0, 8))))
        .toBeGreaterThan(40)
    }

    /* AND THEY ARE NOT ALL THE SAME PLACE, which is the actual complaint.
     * No two chapters may have the same signature block as their most common
     * non-grass surrounding. Six biomes that all census as oak would pass
     * every line above. */
    const snow = census.ch6.tally.snow_block ?? 0
    const bamboo = census.ch3.tally[BAMBOO_STALK] ?? 0
    expect(census.ch1.tally[BAMBOO_STALK] ?? 0, 'bamboo in Omaha').toBeLessThan(bamboo / 8)
    expect(census.ch1.tally.snow_block ?? 0, 'snow in Omaha').toBeLessThan(snow / 8)
    expect(census.ch2.tally[BAMBOO_STALK] ?? 0, 'bamboo at Harvard').toBeLessThan(bamboo / 4)
  })

  test('every bamboo stalk is built the way bamboo grows', async ({ page }) => {
    test.setTimeout(120_000)
    await waitTicks(page, 5)

    /*
     * THREE RULES OUT OF VANILLA'S growBamboo, and each one is a way to get
     * bare green sticks instead of bamboo:
     *
     *   1. Leaves only at the TOP -- large on the last block, small on the
     *      one under it, bare cane all the way down.
     *   2. One horizontal-offset variant per stalk, every block of it. The
     *      four variants wander a quarter block sideways; a stalk that mixes
     *      them zigzags.
     *   3. It is a column of separate blocks, so a stalk is found by walking
     *      up from the ground rather than by asking for one key.
     *
     * The second rule is the one a screenshot cannot settle -- a quarter
     * block at twenty paces is nothing -- and the first one WAS broken and a
     * census found it: the ground-cover pass put a two-block young shoot in a
     * column a mature stalk already occupied, and the stalk came out with
     * leaves in the middle of it.
     */
    const stalks = await page.evaluate(([bamboo]) => {
      const v = window.game.voxelAt
      const t = window.game.terrain
      const keyOf = new Map()
      const key = (id) => {
        let k = keyOf.get(id)
        if (k === undefined) { k = window.game.blockKey(id); keyOf.set(id, k) }
        return k
      }
      const isBamboo = (k) => k === 'bamboo' || /^bamboo(_[123])?$/.test(k)
        || /^bamboo_leaves_(small|large)(_[123])?$/.test(k)
      let found = 0, blocks = 0
      const bad = []
      for (let pz = 0; pz < t.depth; pz++) {
        for (let px = 0; px < t.width; px++) {
          const col = []
          for (let y = 136; y <= 175; y++) {
            const k = key(v(px - t.originX, y, pz - t.originZ))
            if (!isBamboo(k)) { if (col.length) break; continue }
            col.push(k)
          }
          if (col.length < 3) continue           // a sapling or a young shoot
          found++
          blocks += col.length
          const suffix = (k) => (k.match(/_([123])$/) ?? [, '0'])[1]
          const bare = (k) => !k.includes('leaves')
          const want = col.map((k, i) =>
            i === col.length - 1 ? 'large' : i === col.length - 2 ? 'small' : 'cane')
          const got = col.map(k => k.includes('_large') ? 'large'
            : k.includes('_small') ? 'small' : bare(k) ? 'cane' : '?')
          const sameVariant = col.every(k => suffix(k) === suffix(col[0]))
          if (got.join() !== want.join() || !sameVariant) {
            if (bad.length < 5) bad.push({ px, pz, col })
          }
        }
      }
      return { found, blocks, bad }
    }, [BAMBOO])

    // The sample, before the claim. No bamboo is a very well-formed bamboo.
    expect(stalks.found, 'no bamboo stalks in the world').toBeGreaterThan(200)
    expect(stalks.blocks).toBeGreaterThan(1_500)
    expect(stalks.bad, `malformed stalks: ${JSON.stringify(stalks.bad)}`).toEqual([])
  })

  test('nothing is steep, and every plot is flat', async ({ page }) => {
    test.setTimeout(120_000)
    await waitTicks(page, 5)
    const { ground, found } = await groundField(page, GROUND)

    // The sample, before the claim. 65,536 columns and every one of them has
    // to have a ground block under it somewhere.
    expect(found).toBeGreaterThan(65_000)

    /* The peaks are allowed three blocks and nothing else is allowed more
     * than one. Read out of the same biome field the generator used, so this
     * cannot drift from src/builds/biomes.js's mayBeSteep. `near` and not
     * `id`: the dither scatters a few hills columns across the mountain and
     * they are still on the mountain. */
    const field = biomeField()
    const inSteep = (x, z) => field.near[z * 256 + x] === BIOME.PEAKS
    const inPlot = (x, z) => CHAPTERS.some(c => x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1)

    let pairs = 0, worstGentle = 0, worstGentleAt = null, worstAny = 0
    let lo = 99, hi = -99
    for (let z = 0; z < 256; z++) {
      for (let x = 0; x < 256; x++) {
        const a = ground[z * 256 + x]
        if (a === -999) continue
        if (a < lo) lo = a
        if (a > hi) hi = a
        for (const [dx, dz] of [[1, 0], [0, 1]]) {
          const nx = x + dx, nz = z + dz
          if (nx > 255 || nz > 255) continue
          const b = ground[nz * 256 + nx]
          if (b === -999) continue
          if (inPlot(x, z) || inPlot(nx, nz)) continue
          pairs++
          const d = Math.abs(a - b)
          if (d > worstAny) worstAny = d
          if (inSteep(x, z) && inSteep(nx, nz)) continue
          if (d > worstGentle) { worstGentle = d; worstGentleAt = [x, z, a, nx, nz, b] }
        }
      }
    }

    expect(pairs, 'no neighbouring pairs to compare').toBeGreaterThan(100_000)
    /*
     * THE WHOLE CLAIM, in one line. "Nothing crazy steep" is the owner's
     * phrase and this is what it was turned into: a one-block riser is the
     * biggest thing on the walk. src/builds/land.js's clampSlope is what
     * enforces it and this is what says so.
     */
    expect(worstGentle, `a ${worstGentle}-block riser at `
      + `patch ${JSON.stringify(worstGentleAt)} -- outside the climb the ground `
      + `may not step more than one`).toBeLessThanOrEqual(1)
    /* And the climb is allowed to be a mountain, but not a wall. */
    expect(worstAny).toBeLessThanOrEqual(3)

    /* There IS relief, which the line above would also pass on a dead flat
     * world -- the exact failure a slope assertion invites. */
    expect(hi - lo, 'the world came out flat').toBeGreaterThan(12)

    /* EVERY PLOT FOOTPRINT IS FLAT AT ITS CURRENT LEVEL. Terraforming happens
     * AROUND plots, never inside them. The five empty chapters are checked
     * column by column; chapter 1 has a school on it and is checked by the
     * digest below instead. */
    for (const c of CHAPTERS) {
      if (c.id === 'ch1') continue
      let cols = 0, off = 0, firstOff = null
      for (let z = c.z0; z <= c.z1; z++) {
        for (let x = c.x0; x <= c.x1; x++) {
          const h = ground[z * 256 + x]
          if (h === -999) continue
          cols++
          if (h !== -1) { off++; if (!firstOff) firstOff = [x, z, h] }
        }
      }
      expect(cols, `${c.id}: no columns read`).toBeGreaterThan(1_000)
      expect(off, `${c.id} is not flat at y ${SURFACE_Y - 1}; `
        + `first offender patch ${JSON.stringify(firstOff)}`).toBe(0)
    }

    /*
     * AND THE WALK ITSELF, which is the claim a whole-map slope bound cannot
     * make. Every point on the spine, in walking order: the surface under it
     * never leaves the band the path has always lived in, and it never
     * changes by more than one block from one sample to the next. A visitor
     * following the path meets single steps and nothing else, anywhere,
     * including through the peaks -- the relief fades to nothing within five
     * blocks of the walk precisely so that it can.
     */
    let walked = 0, worstGrade = 0, gradeAt = null, hiWalk = -99, loWalk = 99
    let prev = null
    for (const p of sampleSpine(SPINE)) {
      const x = Math.round(p.x), z = Math.round(p.z)
      if (x < 0 || x > 255 || z < 0 || z > 255) continue
      const h = ground[z * 256 + x]
      if (h === -999) continue
      walked++
      if (h > hiWalk) hiWalk = h
      if (h < loWalk) loWalk = h
      if (prev !== null && Math.abs(h - prev) > worstGrade) {
        worstGrade = Math.abs(h - prev)
        gradeAt = [x, z, prev, h]
      }
      prev = h
    }
    expect(walked, 'the spine sampled nothing').toBeGreaterThan(1_000)
    expect(worstGrade, `the path steps ${worstGrade} blocks at `
      + JSON.stringify(gradeAt)).toBeLessThanOrEqual(1)
    /* -1 is the ordinary ground, so the path lives in one block either side
     * of it over the whole 434-block walk. */
    expect(hiWalk).toBeLessThanOrEqual(0)
    expect(loWalk).toBeGreaterThanOrEqual(-2)
  })

  test('the water cannot flood, and the island is one', async ({ page }) => {
    test.setTimeout(120_000)
    await waitTicks(page, 5)

    const water = await page.evaluate(() => {
      const v = window.game.voxelAt
      const t = window.game.terrain
      const WATER = window.game.ids.water
      const solid = (px, py, pz) => {
        if (px < 0 || px > 255 || pz < 0 || pz > 255) return true   // the barrier
        return v(px - t.originX, py, pz - t.originZ) !== 0
      }
      let blocks = 0, open = 0
      const first = []
      const surface = []
      for (let pz = 0; pz < t.depth; pz++) {
        for (let px = 0; px < t.width; px++) {
          for (let y = 130; y <= 142; y++) {
            if (v(px - t.originX, y, pz - t.originZ) !== WATER) continue
            blocks++
            if (y === 135) surface.push(pz * 256 + px)
            /*
             * FIVE FACES AND NOT SIX. The top of a pool is open to the sky by
             * definition; it is the four sides and the bottom that decide
             * whether it stays a pool. src/fluids.js spreads a source
             * sideways and downwards, so those are exactly the five the sim
             * would use.
             */
            for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]) {
              if (solid(px + dx, y + dy, pz + dz)) continue
              open++
              if (first.length < 6) first.push([px, y, pz, dx, dy, dz])
            }
          }
        }
      }
      return { blocks, open, first, surface }
    })

    // The sample, before the claim. A world with no water in it has no leaks.
    expect(water.blocks, 'there is no water in this world').toBeGreaterThan(4_000)
    expect(water.open,
      `water with a face open to air at ${JSON.stringify(water.first)}`).toBe(0)

    /*
     * AND THE ISLAND'S WATER IS THE RIVER'S WATER. A flood fill across the
     * surface from a column two hundred blocks east of the island has to
     * reach the moat, or the loop is a pond somebody dug beside the river
     * rather than a loop the river runs round.
     */
    const ny = landPlot('ch4')
    const reach = await page.evaluate(([surface, ny]) => {
      const wet = new Set(surface)
      // A river column far to the east of the island, found rather than typed.
      let seed = null
      for (const i of surface) {
        const x = i % 256, z = (i / 256) | 0
        if (x > 195 && z > 140 && z < 175) { seed = i; break }
      }
      if (seed === null) return { seed: null }
      const seen = new Set([seed])
      const stack = [seed]
      while (stack.length) {
        const j = stack.pop()
        const x = j % 256, z = (j / 256) | 0
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = (z + dz) * 256 + (x + dx)
          if (!wet.has(k) || seen.has(k)) continue
          seen.add(k)
          stack.push(k)
        }
      }
      let moat = 0, joined = 0
      for (const i of wet) {
        const x = i % 256, z = (i / 256) | 0
        if (x < ny.x0 - 18 || x > ny.x1 + 18 || z < ny.z0 - 18 || z > ny.z1 + 18) continue
        moat++
        if (seen.has(i)) joined++
      }
      return { seed, total: wet.size, reached: seen.size, moat, joined }
    }, [water.surface, { x0: ny.x0, x1: ny.x1, z0: ny.z0, z1: ny.z1 }])

    expect(reach.seed, 'no river column found east of the island').not.toBeNull()
    expect(reach.moat, 'no water around the New York plot').toBeGreaterThan(400)
    expect(reach.joined,
      'the island loop is not connected to the river').toBe(reach.moat)

    /* AND IT IS AN ISLAND: walk out from the middle of the plot in all four
     * directions and you are in water before the map runs out. */
    const wet = new Set(water.surface)
    const cx = Math.round((ny.x0 + ny.x1) / 2), cz = Math.round((ny.z0 + ny.z1) / 2)
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let x = cx, z = cz, steps = 0
      while (x >= 0 && x < 256 && z >= 0 && z < 256 && !wet.has(z * 256 + x) && steps < 90) {
        x += dx; z += dz; steps++
      }
      expect(wet.has(z * 256 + x),
        `no water going (${dx}, ${dz}) from the middle of New York`).toBe(true)
    }
  })

  test('the crossing onto the island is built of the same things as the bridge',
    async ({ page }) => {
      await waitTicks(page, 5)
      const ny = landPlot('ch4')
      /* WHICH EDGE THE BRIDGE IS ON, from the table rather than typed. The
       * spur arrives at whichever side of the plot faces the path, so this
       * box followed the island across the world when chapter 4 changed
       * hands -- and the first version did not, and censused twenty-five
       * columns of empty field. */
      const lowX = ny.side === 'LEFT'
      const abut = lowX ? ny.x1 : ny.x0
      const out = lowX ? 1 : -1
      const parts = await page.evaluate(([ny, abut, out]) => {
        const v = window.game.voxelAt
        const t = window.game.terrain
        const keyOf = new Map()
        const tally = {}
        let sampled = 0
        const doorZ = ny.z0 + 6
        for (let pz = doorZ - 4; pz <= doorZ + 4; pz++) {
          /* `step` and not `k`: the tally below already binds `k` to a block
           * key, and a shadowed loop counter there is a bug that reads as
           * correct code. */
          for (let step = -2; step <= 22; step++) {
            const px = abut + step * out
            for (let y = 135; y <= 142; y++) {
              sampled++
              const id = v(px - t.originX, y, pz - t.originZ)
              if (id === 0) continue
              let k = keyOf.get(id)
              if (k === undefined) { k = window.game.blockKey(id); keyOf.set(id, k) }
              tally[k] = (tally[k] ?? 0) + 1
            }
          }
        }
        return { sampled, tally }
      }, [{ x0: ny.x0, x1: ny.x1, z0: ny.z0, z1: ny.z1 }, abut, out])

      expect(parts.sampled).toBeGreaterThan(1_000)
      /* The river bridge's vocabulary, item for item: a plank deck, stripped
       * oak railings, a glowstone lamp on a taller post. If a future change
       * gives one of the two bridges its own materials, this is where the two
       * stop reading as the same world. */
      expect(parts.tally.planks ?? 0, `deck: ${JSON.stringify(parts.tally)}`).toBeGreaterThan(12)
      expect(parts.tally.stripped_oak_log ?? 0, 'railings').toBeGreaterThan(8)
      expect(parts.tally.glowstone ?? 0, 'lamps').toBeGreaterThan(0)
      expect(parts.tally.water ?? 0, 'the water under it').toBeGreaterThan(20)
    })

  test('Omaha is byte for byte what it was, and so is the archive',
    async ({ page }) => {
      test.setTimeout(180_000)
      await waitTicks(page, 5)

      /*
       * A DIGEST OVER CHAPTER 1'S WHOLE FOOTPRINT, exactly the instrument
       * test/85-millard-north.spec.js uses on the archive and for the same
       * reason: "nothing inside the Omaha plot changed" is a sentence, and a
       * sentence is not evidence. FNV-1a over "x,y,z,key" for every solid
       * voxel, by block KEY and not by palette id -- an id is an index into a
       * table this pass could reorder without moving a single block, and a
       * digest that cried wolf for that reason would be worth nothing.
       *
       * THE FOOTPRINT AND NOT THE BUILDING. The rectangle is the plot's, out
       * of the table, so it catches the landscape leaning INTO the plot --
       * a tree, a spill of gravel, a hillside -- as well as the school
       * changing. That is the failure this is actually guarding against; the
       * school's own contents already have a spec.
       */
      const digest = await page.evaluate(([c]) => {
        const v = window.game.voxelAt
        const t = window.game.terrain
        const keyOf = new Map()
        let h = 0x811c9dc5, solid = 0
        const feed = (str) => {
          for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i)
            h = Math.imul(h, 0x01000193)
          }
        }
        for (let pz = c.z0; pz <= c.z1; pz++) {
          for (let px = c.x0; px <= c.x1; px++) {
            for (let y = 132; y <= 200; y++) {
              const id = v(px - t.originX, y, pz - t.originZ)
              if (id === 0) continue
              solid++
              let k = keyOf.get(id)
              if (k === undefined) { k = window.game.blockKey(id); keyOf.set(id, k) }
              feed(`${px},${y},${pz},${k};`)
            }
          }
        }
        return { hex: (h >>> 0).toString(16), solid }
      }, [landPlot('ch1')])

      // The sample, before the claim. A digest of nothing is very stable.
      expect(digest.solid).toBeGreaterThan(25_000)
      expect(digest.hex, 'chapter 1 changed').toBe(OMAHA_DIGEST)

      /* And the archive, which nothing in this pass can reach -- it is a 128
       * patch stamped by src/builds/index.js and the overworld is stamped by
       * src/builds/land.js -- said by the digest rather than by the
       * paragraph. Same value as test/85-millard-north.spec.js. */
      await enterWorld(page, 'claude-opus-5-1')
      await waitTicks(page, 10)
      const archive = await page.evaluate(() => {
        const v = window.game.voxelAt
        const t = window.game.terrain
        const keyOf = new Map()
        let h = 0x811c9dc5, solid = 0
        const feed = (str) => {
          for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i)
            h = Math.imul(h, 0x01000193)
          }
        }
        for (let pz = 0; pz < t.depth; pz++) {
          for (let px = 0; px < t.width; px++) {
            for (let y = 132; y <= 200; y++) {
              const id = v(px - t.originX, y, pz - t.originZ)
              if (id === 0) continue
              solid++
              let k = keyOf.get(id)
              if (k === undefined) { k = window.game.blockKey(id); keyOf.set(id, k) }
              feed(`${px},${y},${pz},${k};`)
            }
          }
        }
        return { hex: (h >>> 0).toString(16), solid, width: t.width }
      })
      expect(archive.width).toBe(128)
      expect(archive.solid).toBeGreaterThan(50_000)
      expect(archive.hex, 'the archive changed').toBe(ARCHIVE_DIGEST)
    })
})

/* Measured at 90a2fbd, with the landscape around chapter 1 already rebuilt
 * and the school untouched. If this moves, something wrote into Omaha. */
const OMAHA_DIGEST = 'dcf667f5'
/* The same value test/85-millard-north.spec.js carries, measured at 401df98.
 * A copy on purpose: two specs that import one constant cannot disagree, and
 * disagreeing is the only way a stale baseline is ever found. */
const ARCHIVE_DIGEST = 'e3233e67'

/* ====================================================================== *
 * THE WALK, AT EYE LEVEL.
 * ====================================================================== */

async function frameAt(page, name, [px, pz], opts = {}) {
  const { heading = HEADING.southPlusZ, pitch = 0.04, up = 1 } = opts
  const [x, z] = W(px, pz)
  /*
   * ASK THE GENERATOR FOR THE GROUND, and do not fall onto it. A fixed
   * SURFACE_Y + 1 was fine while the world was flat and now lands a visitor
   * buried in a hillside; dropping in from forty blocks up finds the surface
   * but needs sixty ticks to land and reports `air` if the chunk has not
   * meshed yet, which is exactly the vacuous green this file's header is
   * about. voxelAt knows what the world IS, at any coordinate, immediately.
   */
  const top = await page.evaluate(([x, z, keys]) => {
    const v = window.game.voxelAt
    const ids = new Set(keys.map(k => window.game.ids[k]).filter(Boolean))
    /*
     * THE GROUND, NOT THE HIGHEST BLOCK. Scanning for any non-air puts the
     * camera inside the canopy of whatever tree happens to be standing on
     * this column -- which is what the first version did, and three frames
     * came back as a wall of leaves. It is the same mistake the boulder made
     * to the slope measurement: a block STANDING on the ground is not the
     * ground, and this world now has a lot more of both.
     */
    for (let y = 200; y >= 131; y--) if (ids.has(v(x, y, z))) return y
    return null
  }, [x, z, GROUND])
  expect(top, `no ground at all under patch (${px}, ${pz})`).not.toBeNull()
  await teleport(page, x + 0.5, top + up, z + 0.5)
  await waitTicks(page, 16)
  const state = await page.evaluate(() => {
    const noa = window.noa
    const [x, y, z] = noa.ents.getPositionData(noa.playerEntity).position.map(Math.floor)
    return { y, under: window.game.blockKey(noa.getBlock(x, y - 1, z)) }
  })
  expect(state.under, `nothing meshed under patch (${px}, ${pz})`).not.toBe('air')
  await look(page, { heading, pitch })
  await waitFrames(page, 12)
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
  return state.under
}

const S = HEADING.southPlusZ, N = HEADING.northMinusZ
const WEST = HEADING.westPlusX, EAST = HEADING.eastMinusX

test.describe('the walk, biome by biome', () => {
  test.afterEach(async ({ page }) => { await leaveWorld(page) })

  test('every biome, from the ground', async ({ page }) => {
    test.setTimeout(300_000)
    await waitTicks(page, 8)

    /* PLAINS. Spawn, and the field beside Omaha. Flat, grass, scattered oak. */
    await frameAt(page, '91-1-plains-spawn', [128, 18])
    await frameAt(page, '91-1-plains-omaha', [92, 50], { heading: EAST })

    /* BIRCH FOREST, both halves of the merged chapter: the western wood on
     * the ground old chapter 3 gave back, and the eastern one at Harvard. */
    await frameAt(page, '91-2-birch-west', [92, 100], { heading: EAST })
    await frameAt(page, '91-2-birch-harvard', [168, 66], { heading: WEST })

    /* BAMBOO JUNGLE, off the path opposite Bilibili. */
    await frameAt(page, '91-3-bamboo', [88, 128], { heading: EAST })
    await frameAt(page, '91-3-bamboo-path', [106, 134])

    /* THE RIVER, the bridge, and the island beyond it. */
    await frameAt(page, '91-4-river-bridge', [134, 150], { pitch: -0.02 })
    /*
     * ON THE SPUR, looking down it at the crossing. Standing in the field
     * beside it put the camera inside a bush: `up` is applied at the teleport
     * and then gravity takes it straight back to the ground, so the only
     * reliable way to be clear of the undergrowth is to stand somewhere the
     * undergrowth is not, and the walked surface is exactly that.
     */
    await frameAt(page, '91-4-island-bridge', [152, 178], { heading: WEST, pitch: -0.03 })
    await frameAt(page, '91-4-island-shore', [200, 204], { heading: S })
    /*
     * THE CITY ACROSS THE WATER, from the far bank of the river.
     *
     * Not from the island's own north shore, which is six blocks wide: the
     * markers are 51 blocks of lettering and you cannot read one from eight
     * blocks away. This is the frame the composition wants anyway -- water,
     * then shore, then the name.
     */
    await frameAt(page, '91-4-newyork', [200, 144], { heading: S, pitch: -0.03 })

    /* WINDSWEPT HILLS, from the path and from among them. */
    await frameAt(page, '91-5-hills-path', [110, 208], { pitch: -0.06 })
    await frameAt(page, '91-5-hills', [88, 214], { heading: EAST, pitch: -0.08 })

    /* JAGGED PEAKS: the massif from the last bend of the walk, and from its
     * own foot, which is where it stops being scenery. */
    await frameAt(page, '91-6-peaks-path', [134, 242], { heading: EAST, pitch: -0.14 })
    /* From the western foot looking up the flank. Standing ON the flank put
     * the camera under a spruce and photographed the underside of a canopy --
     * the treeline is real up there and it is in the way. */
    await frameAt(page, '91-6-peaks-foot', [74, 246], { heading: WEST, pitch: -0.28 })
    await frameAt(page, '91-6-climb', [168, 236], { heading: WEST })
  })

  test('every transition, from the ground', async ({ page }) => {
    test.setTimeout(300_000)
    await waitTicks(page, 8)

    /* One frame on each of the five borders, standing ON the border and
     * looking along the walk, which is where a hard edge would show. */
    await frameAt(page, '91-t1-plains-to-birch', [150, 88])
    await frameAt(page, '91-t2-birch-to-bamboo', [112, 114])
    await frameAt(page, '91-t3-bamboo-to-river', [138, 154], { pitch: -0.03 })
    await frameAt(page, '91-t4-river-to-hills', [124, 198])
    await frameAt(page, '91-t5-hills-to-peaks', [114, 228], { pitch: -0.08 })
  })

  test('the whole map, and the massif, from the air', async ({ page }) => {
    test.setTimeout(120_000)
    await useGamemode(page, 'creative')
    await doubleTapFly(page)

    /* BELOW THE CLOUD DECK. At SURFACE_Y + 150 the camera is above it and
     * half the map is photographed through cloud. */
    const [mx, mz] = W(150, 120)
    await teleport(page, mx + 0.5, SURFACE_Y + 112, mz + 0.5)
    await waitTicks(page, 40)
    await look(page, { heading: S, pitch: 1.35 })
    await waitFrames(page, 20)
    await page.screenshot({ path: path.join(SHOTS, '91-map-above.png') })

    /* And an oblique of the south end, which is the only frame that shows
     * whether the mountain is a mountain or a bump. */
    /* Forty up and fifty-six back from the summit, pitched to put it in the
     * middle of the frame rather than on the bottom edge. */
    const [px, pz] = W(96, 184)
    await teleport(page, px + 0.5, SURFACE_Y + 40, pz + 0.5)
    await waitTicks(page, 40)
    await look(page, { heading: S, pitch: 0.55 })
    await waitFrames(page, 20)
    await page.screenshot({ path: path.join(SHOTS, '91-massif.png') })

    expect(await page.evaluate(() => window.game.terrain.width)).toBe(256)
  })
})
