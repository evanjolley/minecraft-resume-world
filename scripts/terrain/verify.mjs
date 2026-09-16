#!/usr/bin/env node
/*
 * Decodes the emitted asset and checks it against the region files it came
 * from, block for block.
 *
 * This exists because every failure mode of an RLE encoder produces a file
 * that looks fine. Wrong varint continuation, an off-by-one in a run length,
 * a palette index written before the palette was complete -- all of them
 * yield a plausible number of plausible bytes, and the first sign of trouble
 * is terrain that looks subtly wrong in a browser weeks later. Comparing
 * against the source is the only check that actually proves anything.
 *
 * The decoder itself now lives in src/terrainFormat.js, because island.js
 * needs one too and two readers of one binary format drift. That gives up
 * something this file used to have -- the decoder was deliberately written
 * fresh, so a round trip proved more than that the encoder agreed with
 * itself. What still stands guard is the comparison below: this checks the
 * decoded bytes against the REGION FILES, not against the encoder, so a
 * format written down wrong still fails here even with one shared reader.
 *
 * ------------------------------------------------------------------------
 * THE X MIRROR, AND HOW THIS STAYS A CHECK RATHER THAN A TAUTOLOGY
 *
 * extract.mjs now mirrors X on the way out (see MIRROR_X there), so the naive
 * repair to this file is to paste the same `size - 1 - x` into the comparison
 * and call it done. That repair is worthless: both sides would then be wrong
 * in the same way for any mirror at all -- including no mirror, or one off by
 * one -- and 4,096,000 green voxels would prove nothing about orientation.
 *
 * Three things keep it honest, and they are three different kinds of argument:
 *
 *   1. THE MAPPING IS DERIVED THE OTHER WAY ROUND. extract walks asset columns
 *      and asks which source X to read. This file walks SOURCE X and computes
 *      which asset column must hold it. `mirrorX` is deliberately NOT imported
 *      -- the two files have to agree having each derived it separately, which
 *      is what catches the off-by-one that a shared helper would hide.
 *
 *   2. A PROOF THAT THE CHECK DISCRIMINATES, from the asset alone. If the
 *      patch were symmetric about its own X midline, then "matches mirrored"
 *      and "matches unmirrored" would be the same statement and passing would
 *      say nothing. So this counts voxels where column x and column
 *      width-1-x disagree. Every one of those is a voxel at which an
 *      UNMIRRORED asset would have failed check 1. The count is printed, and
 *      a symmetric patch is a hard error rather than a quiet pass.
 *
 *   3. AN ANCHOR THROUGH REAL WORLD COORDINATES. The manifest's spawn record
 *      carries both an asset column (`x`) and a Minecraft coordinate
 *      (`worldX`), and src/island.js builds the whole game's origin out of the
 *      first one. This checks that the two describe the same place, by reading
 *      the region file at `worldX` and finding that block in asset column `x`.
 *      That path never touches the mirror formula at all.
 *
 * Between them: 1 says the bytes are right, 2 says 1 could have failed, 3 says
 * the number island.js is built on points at the same column.
 * ------------------------------------------------------------------------
 * TWO DIMENSIONS, ONE CHECKER.
 *
 *   node scripts/terrain/verify.mjs              the overworld (terrain.bin)
 *   node scripts/terrain/verify.mjs nether       the Nether (nether.bin)
 *
 * The extractors are deliberately two files (see the long note at the top of
 * nether.mjs) and the verifier is deliberately one, which is not a
 * contradiction. The extractors differ because they answer different
 * questions -- where is the ground, what is the build height. The verifier
 * asks one question, "does this asset match the region files it claims to
 * come from", and that question has no dimension in it: every input it needs
 * is in the manifest. Checks 1, 2 and 3 are unchanged, byte for byte, for
 * both.
 *
 * Check 4 is new and is only asked of dimensions whose spawn rule this file
 * can state. It exists because checks 1-3 share a blind spot: they prove the
 * asset faithfully reproduces the source world, and a spawn point buried in
 * solid netherrack is faithfully reproduced too. The overworld's spawn rule
 * is scan-down-from-the-sky and the thing that can go wrong with it (leaves)
 * is already a solved bug with a comment; the Nether's rule is new, so it is
 * the one with a check under it.
 * ------------------------------------------------------------------------
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WORK } from './generate.mjs'
import { worldFor } from './scan.mjs'
import { classify } from './mapping.mjs'
import { decode } from '../../src/terrainFormat.js'
import { bounds, WORLDS } from '../../src/island.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = join(ROOT, 'public', 'terrain')

/** What the source block at a Minecraft coordinate should decode to. */
const wantAt = (world, wx, y, wz) =>
  classify(world.block(wx, y, wz) ?? 'minecraft:air').key ?? 'air'

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  /*
   * Which asset. The dimension decides three things and nothing else: the
   * file names, which generated world directory holds the source, and which
   * subdirectory of it the regions are in. Everything below reads those out
   * of this table and out of the manifest, and never branches on the name
   * again -- so a third dimension is a row here.
   */
  const DIMENSIONS = {
    /*
     * THE OVERWORLD IS NO LONGER IMPORTED, so there is no asset here to check
     * against region files. src/flatworld.js generates it from a preset at
     * boot; nothing is extracted, nothing is shipped, and the question this
     * whole file answers -- "do these bytes match the world they came from"
     * -- has no subject.
     *
     * A ROW THAT SAYS SO, rather than deleting the row. Two rejected
     * alternatives, both worse:
     *
     *   - Exit 0 silently. `npm run terrain:verify` would then pass having
     *     checked nothing, which is the single most dangerous thing a
     *     verifier can do: a green check is a claim, and this one would be
     *     false.
     *   - Delete `overworld` so the name errors as unknown. Accurate and
     *     useless -- the reader learns that a name they reasonably expected
     *     does not exist, not why.
     *
     * The import pipeline this row used to drive is INTACT (scripts/terrain/
     * extract.mjs, scan.mjs, the seeds). The Nether still needs it, and a
     * generated plains overworld may yet want a real world to sample from.
     */
    overworld: { generated: 'src/flatworld.js' },
    nether: { asset: 'nether', dir: seed => `seed-${seed}-nether` },
    /*
     * The mountain patch: 256 blocks square, cut from seed 434533485056755.
     *
     * A ROW AND NOTHING ELSE, which was the claim the comment above made and
     * this is the first time it has been tested. Checks 1, 2 and 3 are
     * unchanged byte for byte -- the width, the corner, the vertical range
     * and the spawn all come out of the manifest, and check 3's origin now
     * comes from island.js's WORLDS table by NAME, so it asks the same
     * question of a 256-wide world pinned at (191, 48) that it asked of a
     * 128-wide one pinned at (87, 56).
     */
    mountains: {
      asset: 'mountains', dir: seed => `seed-${seed}`,
      /* The world's NAME in this game is not the Minecraft dimension its
       * region files live in. 'mountains' is an overworld cut; scan.mjs's
       * worldFor needs the second word, not the first, or it looks for a
       * DIM-1 that is not there and reads every block as air. */
      mcDim: 'overworld',
    },
  }
  const dimension = process.argv[2] ?? 'overworld'
  const dim = DIMENSIONS[dimension]
  if (!dim) {
    console.error(`unknown dimension ${JSON.stringify(dimension)}; try: ${Object.keys(DIMENSIONS).join(', ')}`)
    process.exit(1)
  }

  if (dim.generated) {
    console.log(`the ${dimension} is GENERATED by ${dim.generated} -- there is no asset to verify.`)
    console.log('  Nothing is fetched at boot and nothing ships, so the licence question')
    console.log('  DECISIONS.md #1 records does not apply to it. What the generated world')
    console.log('  actually contains is checked in the browser, by test/01-world.spec.js.')
    console.log(`\n  For the dimension that IS still imported:  npm run terrain:verify nether`)
    process.exit(0)
  }

  const manifest = JSON.parse(readFileSync(join(OUT, `${dim.asset}.json`), 'utf8'))
  const d = decode(readFileSync(join(OUT, `${dim.asset}.bin`)))
  const world = worldFor(join(WORK, dim.dir(manifest.seed)), dim.mcDim ?? dimension)
  const { x: x0, z: z0 } = manifest.world

  // The asset says which way its X runs. This file does not take that as
  // permission -- it requires the one value it knows how to check.
  if (manifest.world.xOrder !== 'descending') {
    console.error(`manifest world.xOrder is ${JSON.stringify(manifest.world.xOrder)}; expected "descending"`)
    process.exit(1)
  }

  /*
   * 1. Every voxel, against the region files.
   *
   * Walk the SOURCE patch. `wx` is a real Minecraft X; the asset column that
   * must hold it is the distance from the patch's LAST column back to wx,
   * because the asset is written east-to-west. Derived here rather than
   * imported, on purpose.
   */
  const xLast = x0 + d.width - 1
  let checked = 0
  const bad = []
  for (let z = 0; z < d.depth; z++) {
    for (let wx = x0; wx <= xLast; wx++) {
      const ax = xLast - wx
      const col = d.cols[z * d.width + ax]
      for (let y = d.yMin; y <= d.yTop; y++) {
        const got = d.palette[col[y - d.yMin]]
        const want = wantAt(world, wx, y, z0 + z)
        checked++
        if (got !== want && bad.length < 10) {
          bad.push(`asset (${ax},${y},${z}) = world (${wx},${y},${z0 + z}): want ${want}, got ${got}`)
        }
      }
    }
    if (z % 32 === 0) console.log(`    checked row ${z}/${d.depth}`)
  }

  /*
   * 2. Could check 1 have failed? Count voxels the asset does not share with
   * its own X reflection. Comparing the asset to itself needs no region reads
   * and no formula shared with the encoder: it is a statement about the data.
   *
   * An unmirrored asset -- the bug this commit fixes -- differs from the
   * correct one at exactly these voxels, so a large count here is a lower
   * bound on how loudly check 1 would have complained about one.
   */
  let asymmetric = 0
  const height = d.yTop - d.yMin + 1
  for (let z = 0; z < d.depth; z++) {
    for (let x = 0; x < d.width >> 1; x++) {
      const a = d.cols[z * d.width + x]
      const b = d.cols[z * d.width + (d.width - 1 - x)]
      for (let i = 0; i < height; i++) if (a[i] !== b[i]) asymmetric += 2
    }
  }

  /*
   * 3. The anchor island.js is built on. PATCH_ORIGIN_X is spawn.x, and
   * MIN_X is -PATCH_ORIGIN_X, so this is the game's own origin checked
   * against the real Minecraft column the scan chose.
   *
   * Both dimensions are pinned to the SAME origin on purpose -- see the patch
   * corner note in nether.mjs -- so this check is what holds that pinning
   * true. A Nether asset extracted from the wrong corner fails here even
   * though every one of its 2,097,152 voxels is a faithful copy of the
   * region files, because check 1 knows nothing about where the patch is
   * supposed to be.
   */
  const sp = manifest.spawn
  const anchorWant = wantAt(world, sp.worldX, sp.y - 1, sp.worldZ)
  const anchorGot = d.palette[d.cols[sp.z * d.width + sp.x][sp.y - 1 - d.yMin]]
  const anchor = []
  if (anchorGot !== anchorWant) {
    anchor.push(`spawn column: asset (${sp.x},${sp.y - 1},${sp.z}) is ${anchorGot}, ` +
                `but world (${sp.worldX},${sp.y - 1},${sp.worldZ}) is ${anchorWant}`)
  }
  /*
   * PER WORLD now. This used to read island.js's MIN_X/MIN_Z, which were the
   * overworld's and were the only origin there was. With three worlds at two
   * different corners, reading one world's constant while checking another's
   * asset is a check that passes for the wrong reason -- so it asks
   * `bounds(dimension)` for the origin of the world whose asset is on the
   * table.
   */
  const b = bounds(dimension)
  if (-b.minX !== sp.x || -b.minZ !== sp.z) {
    anchor.push(`src/island.js puts the ${dimension} origin at asset column ` +
                `(${-b.minX}, ${-b.minZ}), but the manifest's spawn is (${sp.x}, ${sp.z})`)
  }
  if (d.width !== b.maxX - b.minX + 1 || d.depth !== b.maxZ - b.minZ + 1) {
    anchor.push(`the asset is ${d.width}x${d.depth}, but src/island.js's WORLDS row for ` +
                `${dimension} describes ${b.maxX - b.minX + 1}x${b.maxZ - b.minZ + 1}`)
  }

  /*
   * 4. Nether only: is the spawn a place a player can actually be?
   *
   * The rule pickNetherSpawn implements is written out in full at its
   * definition; this restates only the parts that are observable in the
   * finished asset, and restates them from the ASSET rather than from the
   * source world so that an encoder that lost the floor still fails.
   *
   *   - the block under the feet is solid, and it is not lava
   *   - the two blocks at the feet and the head are air
   *   - four more blocks of air above that, the headroom clause
   *   - and the roof over the whole patch is bedrock, which is the one-line
   *     proof that the vertical range is not off by one. A patch shifted down
   *     a layer would put air at yTop in most columns; shifted up, netherrack.
   */
  const spawnIssues = []
  /*
   * The mountain world's spawn rule, restated from the ASSET.
   *
   * Its rule is not "scan down from the sky" -- the column was picked by ray
   * test in scripts/terrain/seed-view.mjs, which is a claim about what you can
   * SEE and says nothing about whether you can stand there. So the standable
   * half gets a check, and so does the one integer src/island.js hardcodes
   * about this world: WORLDS.mountains.surfaceY. That constant going stale is
   * the exact failure the Nether's check 4 exists to catch, and there is now a
   * second world with the same exposure.
   */
  if (dimension === 'mountains') {
    const at = (ax, y, az) => d.palette[d.cols[az * d.width + ax][y - d.yMin]]
    const under = at(sp.x, sp.y - 1, sp.z)
    if (under === 'air' || under === 'lava' || under === 'water') {
      spawnIssues.push(`spawn stands on ${under}; a floor is required`)
    }
    for (let dy = 0; dy < 3; dy++) {
      const b2 = at(sp.x, sp.y + dy, sp.z)
      if (b2 !== 'air') spawnIssues.push(`spawn headroom blocked at +${dy} by ${b2}`)
    }
    if (sp.y !== WORLDS[dimension].surfaceY) {
      spawnIssues.push(`the manifest spawns at y=${sp.y} but src/island.js's WORLDS row ` +
                       `says surfaceY ${WORLDS[dimension].surfaceY}`)
    }
    /*
     * And the floor is bedrock, which is the same one-line proof of the
     * vertical range the Nether gets from its roof. A patch shifted a layer
     * would put deepslate at yMin in most columns.
     */
    let floor = 0
    for (let i = 0; i < d.width * d.depth; i++) {
      if (d.palette[d.cols[i][0]] === 'bedrock') floor++
    }
    if (floor !== d.width * d.depth) {
      spawnIssues.push(`the bottom layer y=${d.yMin} is bedrock in ${floor} of ` +
                       `${d.width * d.depth} columns, not all of them -- the range is wrong`)
    }
    console.log(`bedrock floor: ${floor}/${d.width * d.depth} columns at y=${d.yMin}`)
  }
  if (dimension === 'nether') {
    const at = (ax, y, az) => d.palette[d.cols[az * d.width + ax][y - d.yMin]]
    const under = at(sp.x, sp.y - 1, sp.z)
    if (under === 'air' || under === 'lava') {
      spawnIssues.push(`spawn stands on ${under}; the rule requires a solid non-lava floor`)
    }
    for (let dy = 0; dy < 6; dy++) {
      const b = at(sp.x, sp.y + dy, sp.z)
      if (b !== 'air') spawnIssues.push(`spawn headroom blocked at +${dy} by ${b} (six clear required)`)
    }
    let roof = 0
    for (let i = 0; i < d.width * d.depth; i++) {
      if (d.palette[d.cols[i][d.yTop - d.yMin]] === 'bedrock') roof++
    }
    if (roof !== d.width * d.depth) {
      spawnIssues.push(`the top layer y=${d.yTop} is bedrock in ${roof} of ${d.width * d.depth} columns, ` +
                       `not all of them -- the vertical range is wrong`)
    }
    console.log(`bedrock roof: ${roof}/${d.width * d.depth} columns at y=${d.yTop}`)
  }

  console.log(`decoded ${d.magic} ${d.width}x${d.depth}, y ${d.yMin}..${d.yTop}, ${d.palette.length} keys`)
  console.log(`checked ${checked.toLocaleString()} voxels against the region files`)
  console.log(`${asymmetric.toLocaleString()} voxels differ from their own X reflection ` +
              `(${(asymmetric / checked * 100).toFixed(1)}% -- an unmirrored asset would fail on these)`)
  console.log(`spawn anchor: asset column (${sp.x}, ${sp.z}) = world (${sp.worldX}, ${sp.worldZ}), ${anchorGot}`)

  if (bad.length) {
    console.error(`MISMATCHES:\n  ${bad.join('\n  ')}`)
    process.exit(1)
  }
  if (anchor.length) {
    console.error(`SPAWN ANCHOR:\n  ${anchor.join('\n  ')}`)
    process.exit(1)
  }
  if (spawnIssues.length) {
    console.error(`SPAWN RULE:\n  ${spawnIssues.join('\n  ')}`)
    process.exit(1)
  }
  /*
   * Deliberately last, and deliberately fatal. If this ever trips, the run
   * above passed without being able to tell a mirrored asset from an
   * unmirrored one, and "every voxel matches" would be a sentence with no
   * content. Better to fail and make someone find a new way to prove it.
   */
  if (asymmetric < checked / 100) {
    console.error(`this patch is nearly symmetric in X (${asymmetric} differing voxels). ` +
                  `The orientation check above cannot discriminate and is not evidence.`)
    process.exit(1)
  }
  console.log('every voxel matches')
}
