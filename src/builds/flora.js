/*
 * TREES ON BOTH SIDES, AND THE STUFF UNDER THEM.
 *
 * ------------------------------------------------------------------------
 * THE MISTAKE THIS FILE IS WRITTEN TO AVOID is an avenue. A tree every eight
 * blocks down both sides of a path is a corridor, and a corridor of trees is
 * exactly the same error as the corridor of buildings the owner asked us to
 * stop making -- "do not wall the path in... less cramped".
 *
 * So density is a slow noise field (28 blocks), which gives thickets and
 * clearings tens of blocks across, and the path's own margin is kept CLEAR
 * for two to four blocks so the walk always has shoulders. Where the field
 * says "thick" the wood closes in to the edge of that margin; where it says
 * "thin" you can see two hundred blocks across open grass. The variation is
 * the feature. An even scatter at the same average density would use the same
 * number of trees to produce a landscape with no places in it.
 *
 * SPECIES BY REGION, not per tree. Picking a species per tree from a hash
 * gives you a fruit salad -- every wood in the game every twenty blocks,
 * which no forest anywhere looks like. A second slow noise field decides
 * which wood a REGION is, so you walk out of birch and into spruce, and the
 * boundary between them is a thing you notice.
 * ------------------------------------------------------------------------
 * THERE ARE NO PLANTS IN THIS GAME, which shapes the undergrowth completely.
 * No grass tufts, no ferns, no flowers, no saplings, no mushrooms -- the
 * block table is 659 cubes, slabs, stairs and one torch. So "lined with life"
 * has to be built out of what exists:
 *
 *   - a single leaves block on the ground is a BUSH, and it is the workhorse
 *   - two or three logs in a row are a FALLEN LOG
 *   - one log with a leaf on it is a STUMP with something growing out of it
 *   - moss and podzol patches are LEAF LITTER
 *
 * Every one of those is a cube, and they read correctly anyway, because what
 * makes undergrowth read is variation in height and colour at the scale of
 * one or two blocks -- which is what these are.
 */
import { KIND, at, onMap, hash, smoothNoise, nearSpawn, SPAWN_CLEAR } from './land.js'
import { BIOME, DENSITY, speciesAt } from './biomes.js'

/** How far from the path anything may grow. Two blocks of clear shoulder
 *  everywhere, and up to five where the noise thins the wood out. */
function margin(x, z) {
  /*
   * FOUR TO EIGHT, and it was two to five until the first screenshot from
   * spawn. Trees at two blocks are a palisade: the canopy closes overhead,
   * the path becomes a tunnel, and "less cramped than the previous build" is
   * exactly what it is not. The number that matters is not the gap to the
   * trunk, it is the gap to the CANOPY, which is another two or three blocks
   * in on every tree.
   */
  return 4 + Math.round(4 * smoothNoise(x, z, 33, 313))
}

/** Distance in columns to the nearest path, spur or bridge, capped -- a
 *  dilation rather than a per-column search, because the per-column version
 *  is 65,536 searches of a 13x13 window and this is one pass over the few
 *  thousand columns that are actually path. */
function pathDistance(model) {
  const R = 7
  const d = new Uint8Array(model.kind.length).fill(255)
  const seeds = []
  for (let i = 0; i < model.kind.length; i++) {
    const k = model.kind[i]
    if (k === KIND.PATH || k === KIND.SPUR || k === KIND.BRIDGE) { d[i] = 0; seeds.push(i) }
  }
  for (const i of seeds) {
    const x0 = i % 256, z0 = (i / 256) | 0
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const x = x0 + dx, z = z0 + dz
        if (!onMap(x, z)) continue
        const v = Math.round(Math.hypot(dx, dz))
        if (v > R) continue
        const j = at(x, z)
        if (v < d[j]) d[j] = v
      }
    }
  }
  return d
}

/**
 * The wood a tree is made of, and it comes from the BIOME now.
 *
 * REPLACED -- a five-band noise field that had nothing to do with anything
 * else in the world. It was the right answer while there was one biome: you
 * walked out of birch and into spruce and the boundary was a thing you
 * noticed, which is all a single landscape can offer. It is the wrong answer
 * now, because the owner's complaint was that the surroundings were uniform,
 * and a species field that ignores the place is uniform in the way that
 * matters -- the same salad everywhere, just shuffled.
 *
 * `gap` is how deep inside its biome the column is (see src/builds/biomes.js),
 * and it is what makes the birch forest soften to mixed woodland at its
 * edges instead of stopping at a line.
 */
function species(model, x, z) {
  const i = at(x, z)
  return speciesAt(model.biome[i], x, z, model.gap[i])
}

/**
 * One tree, drawn at (x, z) standing on ground height `base`.
 *
 * `model` is here for one reason and it is a defect the hills found: A LEAF
 * MAY NOT BE WRITTEN INTO THE GROUND. On flat land a canopy is five blocks
 * up and never meets anything, so `s.set` unconditionally was correct for as
 * long as the world was flat. On a hillside the tree below you has its crown
 * at the height of the slope above it, and every one of those leaf blocks was
 * being stamped straight through the hill -- leaves buried in stone, and a
 * hole in the mountainside wherever one landed on the surface column. It also
 * silently broke the slope measurement, because a column whose top block is a
 * leaf reads as four blocks lower than it is.
 *
 * Vanilla has the same situation and the opposite rule: leaves only replace
 * air. The stamper has no read, on purpose (see its header -- it writes
 * columns once, between generation and install), so the model is the thing
 * that knows where the ground is. Air starts at local y = h.
 */
function tree(s, x, z, base, kind, model) {
  const log = `${kind}_log`, leaf = `${kind}_leaves`
  const blob = (cx, cy, cz, rad, jitter) => {
    const ri = Math.ceil(rad)
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -ri; dz <= ri; dz++) {
        for (let dx = -ri; dx <= ri; dx++) {
          const dist = Math.hypot(dx, dz * 1.0, dy * 1.6)
          if (dist > rad) continue
          // The outer shell is punched through by the coordinate hash, so the
          // canopy has holes in it and is not a smooth ellipsoid.
          if (dist > rad - 0.8 && hash(cx + dx, cz + dz, jitter + dy) < 0.45) continue
          const px = cx + dx, pz = cz + dz
          if (!onMap(px, pz)) continue
          if (cy + dy < model.h[at(px, pz)]) continue      // it is inside the hill
          s.set(px, cy + dy, pz, leaf)
        }
      }
    }
  }

  const tall = (n, lo, hi) => lo + Math.floor(n * (hi - lo + 1))
  const n = hash(x, z, 11)

  if (kind === 'spruce') {
    const h = tall(n, 7, 11)
    s.pillar(x, z, base, base + h - 1, log)
    // Layered and conical: wide low, narrow high, a cap on top. The shape is
    // what makes a spruce a spruce; the colour does half the work and the
    // silhouette does the other half.
    for (let k = 0, y = base + 3; y < base + h; y += 2, k++) {
      blob(x, y, z, Math.max(1.2, 3.2 - k * 0.6), 17 + k)
    }
    s.set(x, base + h, z, leaf)
    return
  }
  if (kind === 'dark_oak') {
    const h = tall(n, 5, 7)
    s.pillar(x, z, base, base + h - 1, log)
    blob(x, base + h - 1, z, 3.4, 23)
    blob(x, base + h, z, 2.4, 29)
    return
  }
  if (kind === 'cherry') {
    const h = tall(n, 4, 6)
    s.pillar(x, z, base, base + h - 1, log)
    blob(x, base + h, z, 3.6, 31)
    return
  }
  if (kind === 'birch') {
    const h = tall(n, 6, 9)
    s.pillar(x, z, base, base + h - 1, log)
    blob(x, base + h - 1, z, 2.1, 37)
    blob(x, base + h, z, 1.6, 41)
    return
  }
  if (kind === 'jungle') {
    /* Tall and bare up the trunk with the crown right at the top, which is
     * the silhouette that makes a jungle read as a jungle from underneath --
     * you are in a hall of trunks with a roof a long way up. */
    const h = tall(n, 9, 13)
    s.pillar(x, z, base, base + h - 1, log)
    blob(x, base + h - 1, z, 3.1, 53)
    blob(x, base + h + 1, z, 2.0, 59)
    return
  }
  if (kind === 'mangrove') {
    /* Short, and it stands on its roots. Four one-block legs around the
     * trunk are the cheapest thing that reads as a mangrove, and the river
     * is the only place they appear. */
    const h = tall(n, 4, 6)
    s.pillar(x, z, base, base + h - 1, log)
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (hash(x + dx, z + dz, 61) < 0.5) continue
      if (onMap(x + dx, z + dz)) s.set(x + dx, base, z + dz, log)
    }
    blob(x, base + h, z, 2.6, 67)
    return
  }
  // oak
  const h = tall(n, 5, 8)
  s.pillar(x, z, base, base + h - 1, log)
  blob(x, base + h - 1, z, 2.7, 43)
  blob(x, base + h, z, 1.9, 47)
}

/*
 * A BAMBOO STAND, which is what the bamboo jungle is actually made of.
 *
 * There is no bamboo PLANT in this block table -- the 683 keys are cubes,
 * slabs, stairs, a torch and some signs -- but there is `bamboo_block`, which
 * is vanilla's bundled-bamboo cube, and a 1x1 column of it eight high is a
 * stalk. A handful of stalks at slightly different heights in a two-block
 * radius is a clump, and clumps at the density below are a thicket you cannot
 * see through, which is the whole experience of the biome.
 *
 * BAMBOO AND NOT CHERRY BLOSSOM, on the owner's instruction: "dont use cherry
 * blossom for china, too on the nose". The agreed fallback if bamboo proved
 * unworkable was meadow, and it was not needed.
 */
function bambooStand(s, x, z, base, model) {
  const n = 3 + Math.floor(hash(x, z, 71) * 4)
  for (let k = 0; k < n; k++) {
    const dx = Math.round((hash(x, z, 401 + k) - 0.5) * 4)
    const dz = Math.round((hash(x, z, 431 + k) - 0.5) * 4)
    const px = x + dx, pz = z + dz
    if (!onMap(px, pz)) continue
    const j = at(px, pz)
    if (model.kind[j] !== KIND.FIELD) continue
    const foot = model.h[j]
    const h = 5 + Math.floor(hash(px, pz, 457) * 8)
    s.pillar(px, pz, foot, foot + h - 1, 'bamboo_block')
    /* A frond on the tallest ones. Jungle leaves rather than nothing: a
     * stalk that stops dead reads as a fencepost. */
    if (h > 9) s.set(px, foot + h, pz, 'jungle_leaves')
  }
}

/**
 * Plant the whole map: trees on a jittered grid, then the ground cover.
 *
 * THE GRID IS JITTERED, which is the cheap half of a Poisson disc and the
 * half that matters. One candidate per 4x4 cell, displaced up to three blocks
 * by its own hash: no two trees closer than about two blocks, none of the
 * rows or columns a regular grid would leave, and no rejection loop.
 */
export function plantForest(s, model) {
  const dist = pathDistance(model)

  for (let cz = 0; cz < 256; cz += 4) {
    for (let cx = 0; cx < 256; cx += 4) {
      const x = cx + Math.floor(hash(cx, cz, 53) * 4)
      const z = cz + Math.floor(hash(cx, cz, 59) * 4)
      if (!onMap(x, z)) continue
      const j = at(x, z)
      if (model.kind[j] !== KIND.FIELD) continue
      if (nearSpawn(x, z, SPAWN_CLEAR + 4)) continue
      if (dist[j] < margin(x, z)) continue

      // Thickets and clearings. The exponent bites the low end harder, so a
      // clearing is genuinely empty rather than merely sparse.
      const density = smoothNoise(x, z, 28, 503) ** 1.6
      /*
       * AND THE BIOME'S OWN SHARE OF IT. The noise decides where the wood is
       * thick and where it opens out; DENSITY decides how much wood there is
       * to be thick WITH. The plains take 14% of the candidate sites and the
       * birch forest takes 92%, and that one multiplier is most of the
       * difference between a prairie with trees in it and a forest -- more
       * than any amount of choosing the right leaf block.
       */
      const biome = model.biome[j]
      if (hash(x, z, 61) > density * (DENSITY[biome] ?? 0.5)) continue

      /*
       * THE TREELINE. Nothing grows on the top of a mountain, and a spruce
       * standing in the snow at twelve blocks up is the single detail that
       * would make the peaks read as a green hill with white paint on it.
       * Twelve is where peaksGround switches from stone to snow.
       */
      if (biome === BIOME.PEAKS && model.h[j] >= 11) continue

      // Nothing may lean over a plot or into the water: a canopy is 4 blocks
      // across and the stamper's forbid guard would (correctly) throw.
      /* SIX, not four. Four is the canopy radius, which cleared the plot
       * boundary and then stood a tree directly in front of a marker -- the
       * one thing in a plot that has to be legible from the path. */
      if (!clearOfReserved(model, x, z, 6)) continue

      /* The bamboo jungle is mostly stalks and a few real trees through them,
       * which is what the vanilla biome is. The roll is per site rather than
       * per region so the two are interleaved rather than zoned. */
      if (biome === BIOME.BAMBOO && hash(x, z, 73) < 0.72) {
        bambooStand(s, x, z, model.h[j], model)
        continue
      }

      tree(s, x, z, model.h[j], species(model, x, z), model)
    }
  }

  groundCover(s, model, dist)
}

/** True if nothing within `r` is a plot, water or path -- the test a canopy
 *  has to pass before it is drawn, because leaves spread wider than trunks. */
function clearOfReserved(model, x, z, r) {
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      if (!onMap(x + dx, z + dz)) return false
      const k = model.kind[at(x + dx, z + dz)]
      if (k === KIND.PLOT || k === KIND.WATER || k === KIND.SHALLOW || k === KIND.BRIDGE) return false
    }
  }
  return true
}

/*
 * WHAT IS LYING ON THE FLOOR, per biome. Three blocks each, picked by the
 * coordinate hash, so the litter is the same kind of thing the biome's
 * surface is made of rather than a forest floor scattered over a snowfield.
 */
const LITTER = {
  [BIOME.PLAINS]: ['coarse_dirt', 'dirt', 'podzol'],
  [BIOME.BIRCH]: ['podzol', 'coarse_dirt', 'moss_block'],
  [BIOME.BAMBOO]: ['moss_block', 'podzol', 'rooted_dirt'],
  [BIOME.RIVERLANDS]: ['sand', 'gravel', 'clay'],
  [BIOME.HILLS]: ['gravel', 'coarse_dirt', 'andesite'],
  [BIOME.PEAKS]: ['snow_block', 'gravel', 'stone'],
}

/*
 * THE GROUND COVER, and it is denser NEAR the path on purpose.
 *
 * "It is lined with life... density varies -- thick in places, sparse in
 * others." The thing being lined is the path, so the bushes, logs and litter
 * crowd the first four blocks off the edge and thin out into the wood. That
 * is also where a walker can see them: a fallen log ninety blocks into the
 * forest is a block nobody will ever stand next to.
 */
function groundCover(s, model, dist) {
  for (let z = 0; z < 256; z++) {
    for (let x = 0; x < 256; x++) {
      const j = at(x, z)
      const kind = model.kind[j]
      if (kind !== KIND.FIELD && kind !== KIND.BANK) continue
      if (nearSpawn(x, z, SPAWN_CLEAR)) continue
      const d = dist[j]
      if (d === 0) continue

      const base = model.h[j]
      const near = d <= 4
      const roll = hash(x, z, 67)
      const wood = species(model, x, z)
      const biome = model.biome[j]

      /*
       * Leaf litter: a change of GROUND rather than something standing on it,
       * which is what stops the verge reading as mown grass with props on it.
       *
       * IT IS THE BIOME'S LITTER NOW. The three blocks below were podzol,
       * coarse dirt and moss everywhere, which is a forest floor -- correct
       * for the birch wood, wrong on a prairie and absurd on a snowfield.
       * Each biome names its own three, and the peaks name snow, which is how
       * the treeline gets a ragged edge instead of a contour line.
       */
      if (kind === KIND.FIELD && smoothNoise(x, z, 6, 601) > (near ? 0.62 : 0.74)) {
        const mix = LITTER[biome] ?? LITTER[BIOME.BIRCH]
        model.surface[j] = mix[Math.floor(hash(x, z, 71) * mix.length)]
        s.set(x, base - 1, z, model.surface[j])
      }

      /*
       * A BOULDER, and it is the only ground cover that is not made of wood.
       * The windswept hills and the peaks have almost no trees by design --
       * the wind is the reason there are none -- and a biome whose ground
       * cover is "bushes and fallen logs" with the bushes and logs turned off
       * is bare ground. Two or three stone blocks in a heap is what is
       * actually lying about up there.
       */
      if ((biome === BIOME.HILLS || biome === BIOME.PEAKS) && roll < (near ? 0.05 : 0.022)) {
        const rock = hash(x, z, 77) < 0.5 ? 'cobblestone'
          : hash(x, z, 79) < 0.5 ? 'stone' : 'andesite'
        s.set(x, base, z, rock)
        if (hash(x, z, 83) < 0.35 && onMap(x + 1, z) && model.kind[at(x + 1, z)] === KIND.FIELD) {
          s.set(x + 1, model.h[at(x + 1, z)], z, rock)
        }
        continue
      }

      /* Bamboo shoots: one or two blocks of stalk on their own, away from
       * the stands. Undergrowth in a bamboo jungle is more bamboo. */
      if (biome === BIOME.BAMBOO && roll < (near ? 0.09 : 0.05)) {
        s.pillar(x, z, base, base + (hash(x, z, 89) < 0.5 ? 1 : 2), 'bamboo_block')
        continue
      }

      if (roll < (near ? 0.055 : 0.02)) {
        s.set(x, base, z, `${wood}_leaves`)                 // a bush
      } else if (roll < (near ? 0.070 : 0.026)) {
        s.set(x, base, z, `${wood}_log`)                    // a stump
        if (hash(x, z, 79) < 0.5) s.set(x, base + 1, z, `${wood}_leaves`)
      } else if (roll < (near ? 0.078 : 0.030)) {
        // A fallen log: two or three, in a line, in whichever direction the
        // hash picks. It is the one piece of ground cover that has an
        // ORIENTATION, which is why it reads as a thing that fell.
        const along = hash(x, z, 83) < 0.5
        const n = 2 + (hash(x, z, 97) < 0.4 ? 1 : 0)
        for (let k = 0; k < n; k++) {
          const px = x + (along ? k : 0), pz = z + (along ? 0 : k)
          if (!onMap(px, pz)) break
          const jj = at(px, pz)
          if (model.kind[jj] !== KIND.FIELD) break
          s.set(px, model.h[jj], pz, `${wood}_log`)
        }
      }
    }
  }
}
