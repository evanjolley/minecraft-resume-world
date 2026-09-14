/*
 * The block mapping report: every distinct minecraft: id in the chosen patch,
 * what it becomes, and how many there are.
 *
 * Sorted by count throughout. A block appearing 40,000 times decides how the
 * world looks; one appearing twice is a curiosity. A report sorted
 * alphabetically buries that distinction and invites equal effort on both.
 */
import { build, CHOSEN } from '../build-terrain.mjs'
import { classify } from './mapping.mjs'

const { seed, x, z } = CHOSEN
if (seed == null || x == null || z == null) {
  console.error('set SEED, PATCH_X, PATCH_Z')
  process.exit(1)
}

const { counts } = await build({ seed, x, z, log: () => {} })

const buckets = { mapped: [], pending: [], missing: [], plant: [], structure: [] }
let air = 0
for (const [id, n] of counts) {
  const { kind, key } = classify(id)
  if (kind === 'air') { air += n; continue }
  buckets[kind].push({ id, n, key })
}
for (const b of Object.values(buckets)) b.sort((a, b2) => b2.n - a.n)

const total = [...counts.values()].reduce((a, b) => a + b, 0)
const show = (title, rows, note) => {
  const sum = rows.reduce((a, r) => a + r.n, 0)
  console.log(`\n## ${title} -- ${rows.length} ids, ${sum.toLocaleString()} blocks`)
  if (note) console.log(`   ${note}`)
  for (const r of rows) {
    console.log(`   ${String(r.n).padStart(9)}  ${r.id.replace('minecraft:', '').padEnd(30)} ${r.key ? '-> ' + r.key : '-> (air)'}`)
  }
}

console.log(`patch seed ${seed} at (${x}, ${z}); ${total.toLocaleString()} voxels, ${air.toLocaleString()} air`)
show('MAPPED CLEANLY', buckets.mapped)
show('MAPPED TO PENDING KEYS', buckets.pending,
  'water and lava are being added to src/blocks.js by another agent. These map to those keys on the assumption they land.')
show('NEEDS A NEW BLOCK', buckets.missing,
  'Plain full cubes with no key in blocks.js. Adding these is a texture plus a BLOCK_TYPES entry.')
show('DROPPED: CROSS-SHAPED PLANTS', buckets.plant,
  'No cross renderer in the engine. Rendering these as cubes would put solid blocks of grass-blade texture in the world.')
show('DROPPED: STRUCTURALLY UNSUPPORTED', buckets.structure,
  'Needs a per-block mesh or multi-block state the engine has no notion of.')
