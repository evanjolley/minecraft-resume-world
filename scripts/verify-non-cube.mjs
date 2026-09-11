#!/usr/bin/env node
/*
 * Verification for slabs and stairs.
 *
 *   npm run dev                       # in another terminal
 *   node scripts/verify-non-cube.mjs  # [baseURL] [--fps]
 *
 * This SHOULD be a spec in test/, and belongs there the moment that directory
 * is free to edit. It is a standalone script only because the change that
 * added non-cube blocks did not own test/.
 *
 * What it is for: the collision claims in the README are not the kind of thing
 * a unit test can make. "You can walk onto a slab" means walking a real player
 * onto a real slab and reading back the Y they come to rest at, which is what
 * this does -- it holds W for a second and a half and measures.
 */
import { chromium } from '@playwright/test'

const BASE = process.argv.find(a => a.startsWith('http')) || 'http://localhost:5173'
const WANT_FPS = process.argv.includes('--fps')

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`)
}

// Software GL, so this runs the same on a laptop and in CI.
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } })

const netFailures = []
const pageErrors = []
page.on('requestfailed', r => netFailures.push(`${r.url()} :: ${r.failure()?.errorText}`))
page.on('response', r => { if (r.status() >= 400) netFailures.push(`${r.url()} :: HTTP ${r.status()}`) })
page.on('pageerror', e => pageErrors.push(String(e)))
page.on('console', m => { if (m.type() === 'error') pageErrors.push(m.text()) })

await page.goto(BASE, { waitUntil: 'load' })
await page.waitForFunction(() => window.noa && window.game, null, { timeout: 30000 })
await page.waitForFunction(() => window.noa.world.playerChunkLoaded, null, { timeout: 30000 })
await page.waitForTimeout(2500)

/*
 * The camera only recomputes its direction vector inside applyInputsToCamera,
 * which early-returns without pointer lock -- so setting heading from a script
 * does nothing until this is on. See the README's flythrough gotcha.
 */
await page.evaluate(() => { window.noa.camera.sensitivityMultOutsidePointerlock = 1 })

/* ---------------- ids round-trip ---------------- */

const placement = await page.evaluate(async () => {
  const noa = window.noa
  const { BLOCK_TYPES } = await import('/src/blocks.js')
  const defs = BLOCK_TYPES.filter(d => d.shape)
  const [sx, , sz] = noa.ents.getPositionData(noa.playerEntity).position
  const x0 = Math.floor(sx) + 8, z0 = Math.floor(sz), y0 = 72
  const bad = []
  defs.forEach((d, i) => {
    const x = x0 + (i % 20), z = z0 + Math.floor(i / 20)
    // setBlockID, not noa.setBlock: this asserts the id round-trips, not the
    // placement-orientation rule, which is tested separately below.
    noa.world.setBlockID(d.id, x, y0, z)
    const got = noa.getBlock(x, y0, z)
    if (got !== d.id) bad.push(`${d.key}: wrote ${d.id}, read ${got}`)
  })
  return { count: defs.length, bad }
})
check(`all ${placement.count} non-cube blocks place and read back`,
  placement.bad.length === 0, placement.bad.slice(0, 5).join(' | '))

const meshed = await page.evaluate(() => {
  let meshes = 0, instances = 0
  for (const m of window.noa.rendering.getScene().meshes) {
    if (m.metadata?.noa_object_base_mesh && m.thinInstanceCount > 0) {
      meshes++; instances += m.thinInstanceCount
    }
  }
  return { meshes, instances }
})
check('every one of them is instanced into the scene',
  meshed.meshes >= placement.count, JSON.stringify(meshed))

/* ---------------- placement orientation ---------------- */

const orient = await page.evaluate(async () => {
  const noa = window.noa
  const { BLOCK_TYPES, BLOCK_BY_ID } = await import('/src/blocks.js')
  const id = k => BLOCK_TYPES.find(d => d.key === k).id
  const [sx, , sz] = noa.ents.getPositionData(noa.playerEntity).position
  const x = Math.floor(sx) - 10, z = Math.floor(sz), y = 76
  const shape = () => BLOCK_BY_ID.get(noa.getBlock(x, y, z)).shape
  const out = {}

  // Clicked the top face of the block below: bottom half.
  noa._pickResult.position[1] = y
  noa.targetedBlock = { position: [x, y - 1, z], normal: [0, 1, 0], adjacent: [x, y, z] }
  for (const [dir, heading] of [['south', 0], ['east', Math.PI / 2], ['north', Math.PI], ['west', 3 * Math.PI / 2]]) {
    noa.camera.heading = heading
    noa.setBlock(id('oak_stairs'), x, y, z)
    out[dir] = shape()
  }
  noa.camera.heading = 0
  noa.setBlock(id('oak_slab'), x, y, z); out.slabFromTop = shape()

  // Clicked the bottom face of the block above: top half.
  noa.targetedBlock = { position: [x, y + 1, z], normal: [0, -1, 0], adjacent: [x, y, z] }
  noa.setBlock(id('oak_slab'), x, y, z); out.slabFromBelow = shape()
  noa.setBlock(id('oak_stairs'), x, y, z); out.stairsUpsideDown = shape()

  // Clicked high, then low, on a side face.
  noa.targetedBlock = { position: [x + 1, y, z], normal: [1, 0, 0], adjacent: [x, y, z] }
  noa._pickResult.position[1] = y + 0.8
  noa.setBlock(id('oak_slab'), x, y, z); out.slabSideHigh = shape()
  noa._pickResult.position[1] = y + 0.2
  noa.setBlock(id('oak_slab'), x, y, z); out.slabSideLow = shape()

  noa.setBlock(0, x, y, z)
  noa.targetedBlock = null
  return out
})
check('stairs face the way the player is looking',
  ['south', 'east', 'north', 'west'].every(d => orient[d] === `stairs_${d}_bottom`),
  JSON.stringify(orient))
check('the clicked face decides the half',
  orient.slabFromTop === 'slab_bottom' && orient.slabFromBelow === 'slab_top' &&
  orient.stairsUpsideDown === 'stairs_south_top' &&
  orient.slabSideHigh === 'slab_top' && orient.slabSideLow === 'slab_bottom',
  JSON.stringify(orient))

/* ---------------- collision ---------------- */

const teleport = (x, y, z) => page.evaluate(([x, y, z]) => {
  const noa = window.noa
  noa.ents.setPosition(noa.playerEntity, [x, y, z])
  const b = noa.ents.getPhysics(noa.playerEntity).body
  b.velocity[0] = b.velocity[1] = b.velocity[2] = 0
  window.game.survival.clearFallTracking?.()
}, [x, y, z])
const pos = () => page.evaluate(() => [...window.noa.ents.getPositionData(window.noa.playerEntity).position])
const walkEast = async (ms) => {
  await page.evaluate(() => { window.noa.camera.heading = Math.PI / 2 })
  await page.keyboard.down('w')
  await page.waitForTimeout(ms)
  await page.keyboard.up('w')
  await page.waitForTimeout(500)
}

const rig = await page.evaluate(async () => {
  const noa = window.noa
  const { BLOCK_TYPES } = await import('/src/blocks.js')
  const id = k => BLOCK_TYPES.find(d => d.key === k).id
  const STONE = 3
  const [sx, , sz] = noa.ents.getPositionData(noa.playerEntity).position
  const bx = Math.floor(sx) + 20, bz = Math.floor(sz) + 20, by = 70

  for (let x = 0; x < 20; x++) for (let z = 0; z < 10; z++) noa.world.setBlockID(STONE, bx + x, by, bz + z)
  // a slab floor wide enough that a second of walking stays on it
  for (let x = 2; x < 8; x++) for (let z = 2; z < 6; z++) {
    noa.world.setBlockID(id('stone_brick_slab'), bx + x, by + 1, bz + z)
  }
  // a five-step staircase climbing east, supported like a real build
  for (let n = 0; n < 5; n++) for (let z = 2; z < 6; z++) {
    noa.world.setBlockID(id('oak_stairs_east_bottom'), bx + 8 + n, by + 1 + n, bz + z)
    for (let f = 0; f < n; f++) noa.world.setBlockID(STONE, bx + 8 + n, by + 1 + f, bz + z)
  }
  // a landing, so the climb test has somewhere to stop
  for (let x = 13; x < 18; x++) for (let z = 2; z < 6; z++) noa.world.setBlockID(STONE, bx + x, by + 5, bz + z)
  noa.world.setBlockID(id('stone_brick_slab_top'), bx + 15, by + 7, bz + 3)
  // a plain cube wall, to prove full blocks are still not steppable. Its own
  // z lane, clear of the slab floor, so walking into it is the only thing the
  // last check can be measuring.
  for (let z = 7; z < 10; z++) noa.world.setBlockID(STONE, bx + 4, by + 1, bz + z)
  return { bx, by, bz }
})

await teleport(rig.bx + 3.5, rig.by + 6, rig.bz + 3.5)
await page.waitForTimeout(1500)
let p = await pos()
check('falls onto a bottom slab and rests at half height',
  Math.abs(p[1] - (rig.by + 1.5)) < 0.02, `y=${p[1].toFixed(4)}, want ${rig.by + 1.5}`)

await teleport(rig.bx + 0.5, rig.by + 1, rig.bz + 3.5)
await page.waitForTimeout(600)
await walkEast(1200)
p = await pos()
check('walks up onto a slab without jumping',
  Math.abs(p[1] - (rig.by + 1.5)) < 0.02 && p[0] > rig.bx + 2 && p[0] < rig.bx + 8,
  `x=${p[0].toFixed(2)} y=${p[1].toFixed(4)}, want y=${rig.by + 1.5}`)

await teleport(rig.bx + 7.5, rig.by + 1, rig.bz + 3.5)
await page.waitForTimeout(600)
const from = await pos()
await walkEast(2600)
p = await pos()
check('climbs a five-step staircase without jumping',
  p[1] >= rig.by + 5.98 && p[0] > rig.bx + 12,
  `(${from[0].toFixed(1)}, ${from[1].toFixed(1)}) -> (${p[0].toFixed(1)}, ${p[1].toFixed(3)}), top is ${rig.by + 6}`)

await teleport(rig.bx + 15.5, rig.by + 11, rig.bz + 3.5)
await page.waitForTimeout(1800)
p = await pos()
check('rests on the upper half of a top slab',
  Math.abs(p[1] - (rig.by + 8)) < 0.02, `y=${p[1].toFixed(4)}, want ${rig.by + 8}`)

// The parkour invariant: a full cube is a wall, not a step.
await teleport(rig.bx + 1.5, rig.by + 1, rig.bz + 8.5)
await page.waitForTimeout(600)
await walkEast(1500)
p = await pos()
check('a full cube is still not steppable',
  Math.abs(p[1] - (rig.by + 1)) < 0.02 && p[0] < rig.bx + 4,
  `x=${p[0].toFixed(3)} y=${p[1].toFixed(3)}, should stop at the block face`)

/* ---------------- frame rate ---------------- */

if (WANT_FPS) {
  const fps = async () => {
    await page.waitForTimeout(1500)
    const runs = []
    for (let i = 0; i < 3; i++) {
      runs.push(await page.evaluate(() => new Promise(done => {
        let frames = 0
        const t0 = performance.now()
        const tick = () => {
          frames++
          if (performance.now() - t0 < 3000) requestAnimationFrame(tick)
          else done(frames / ((performance.now() - t0) / 1000))
        }
        requestAnimationFrame(tick)
      })))
    }
    // Best of three: the interesting number is the cost of the geometry, not
    // of whatever else the machine was doing.
    return Math.max(...runs)
  }
  const look = () => page.evaluate(([r]) => {
    const noa = window.noa
    noa.ents.setPosition(noa.playerEntity, [r.bx, r.by + 14, r.bz - 10])
    const b = noa.ents.getPhysics(noa.playerEntity).body
    b.velocity[0] = b.velocity[1] = b.velocity[2] = 0
    b.gravityMultiplier = 0
    noa.camera.heading = 0
    noa.camera.pitch = 0.45
  }, [rig])
  const carpet = (kinds, n) => page.evaluate(async ([r, kinds, n]) => {
    const noa = window.noa
    const { BLOCK_TYPES } = await import('/src/blocks.js')
    const ids = kinds.map(k => BLOCK_TYPES.find(d => d.key === k).id)
    const half = Math.floor(Math.sqrt(n) / 2)
    let i = 0
    for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) noa.world.setBlockID(0, r.bx + x, r.by + 8, r.bz + z)
    for (let x = -half; x <= half; x++) for (let z = -half; z <= half; z++) {
      noa.world.setBlockID(ids[i % ids.length], r.bx + x, r.by + 8, r.bz + z); i++
    }
    return i
  }, [rig, kinds, n])

  await carpet([], 0)
  await look()
  console.log(`      fps, nothing placed:            ${(await fps()).toFixed(1)}`)
  const families = ['oak', 'spruce', 'birch', 'stone', 'cobblestone', 'brick', 'purpur', 'smooth_quartz', 'dark_prismarine']
  const mixed = families.flatMap(f => [`${f}_slab`, `${f}_stairs`, `${f}_stairs_east_bottom`])
  for (const [label, kinds, n] of [
    ['441 slabs of one block id', ['oak_slab'], 441],
    ['441 non-cubes, 27 block ids', mixed, 441],
    ['1089 non-cubes, 27 block ids', mixed, 1089],
    ['1089 full cubes, for scale', ['cobblestone'], 1089],
  ]) {
    const placed = await carpet(kinds, n)
    await look()
    console.log(`      fps, ${label.padEnd(30)} ${(await fps()).toFixed(1)}  (${placed} blocks)`)
  }
}

check('no failed asset requests', netFailures.length === 0, netFailures.slice(0, 8).join(' | '))
check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 5).join(' | '))

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`)
await browser.close()
process.exit(results.every(Boolean) ? 0 : 1)
