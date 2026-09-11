#!/usr/bin/env node
/*
 * Verification for the cloud layer and the weather system.
 *
 *   node scripts/verify-weather.mjs            # against a running dev server
 *   SHOTS=/tmp/shots node scripts/verify-weather.mjs
 *
 * NOT a test in test/ -- that directory belongs to another agent this pass --
 * so this is a standalone script with the same launch flags the suite uses.
 * It prints a PASS/FAIL line per assertion and exits non-zero on any failure.
 *
 * It measures the LIVE weather system -- `window.game.weather`, the one
 * main.js stood up -- and nothing else.
 *
 * It used to install its own on top, back when main.js did not yet import
 * installWeather and this script was the only place the wiring ran. main.js
 * imports it now, so that call had quietly become a SECOND rain volume, a
 * second thunder clock and a second ambience bed running beside the real ones,
 * with `window.game.weather` repointed at the copy while `/weather` went on
 * driving main.js's. Every assertion below was reading the wrong object. The
 * lesson is worth more than the fix: a verification script that sets up what
 * it verifies stops testing the real thing the moment the real wiring lands,
 * and does it without failing.
 *
 * Screenshots are EVIDENCE, not assertions. Anything a number can answer is
 * answered by a number below; a screenshot is for "do the clouds look like
 * Minecraft's", which no assertion here can honestly settle.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = process.env.SHOTS || ROOT
const URL = process.env.URL || 'http://localhost:5173/'

/* The same three flags test/helpers/launch.js uses. Headless Chromium has no
 * rasteriser, so without them WebGL context creation returns null and every
 * screenshot is a black canvas with no error anywhere. */
const GL_FLAGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   ${detail}` : ''}`)
}

mkdirSync(SHOTS, { recursive: true })

const browser = await chromium.launch({ args: GL_FLAGS })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
// Several agents edit src/ at once and every save pushes an HMR reload that
// would destroy the page mid-measurement. Same mute the suite uses.
await page.routeWebSocket(/^wss?:\/\/localhost:5173\//, () => {})

await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!(window.noa && window.game), null, { timeout: 60_000, polling: 100 })
await page.waitForFunction(() => {
  const g = window.noa.getBlock.bind(window.noa)
  return g(39, 63, 0) !== 0 && g(0, 63, 39) !== 0 && g(0, 0, 0) !== 0
}, null, { timeout: 90_000, polling: 200 })
await page.waitForFunction(() => window.noa.ents.getPhysics(window.noa.playerEntity).body.atRestY() < 0,
  null, { timeout: 30_000, polling: 50 })
// THE camera gotcha: noa only recomputes the view direction inside
// applyInputsToCamera, which early-returns without pointer lock.
await page.evaluate(() => { window.noa.camera.sensitivityMultOutsidePointerlock = 1 })

const frames = (n) => page.evaluate((c) => new Promise((r) => {
  let left = c
  const step = () => (--left <= 0 ? r() : requestAnimationFrame(step))
  requestAnimationFrame(step)
}), n)
const ticks = (n) => page.evaluate((c) => new Promise((r) => {
  let left = c
  const fn = () => { if (--left <= 0) { window.noa.off('tick', fn); r() } }
  window.noa.on('tick', fn)
}), n)
const look = async (heading, pitch) => {
  await page.evaluate(([h, p]) => {
    const c = window.noa.camera
    window.noa.inputs.pointerState.dx = 0
    window.noa.inputs.pointerState.dy = 0
    c.heading = ((h % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    c.pitch = p
  }, [heading, pitch])
  await frames(3)
}
const shot = (name) => page.screenshot({ path: join(SHOTS, `${name}.png`) })
const fps = (ms = 2000) => page.evaluate((window_ms) => new Promise((resolve) => {
  let n = 0
  const t0 = performance.now()
  const step = () => {
    const dt = performance.now() - t0
    if (dt >= window_ms) return resolve((n * 1000) / dt)
    n++
    requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}), ms)

/* ---------- the live system, not one of our own ---------- */

/* Asserted rather than assumed. If main.js ever stops installing weather, the
 * failure should be this line rather than a hundred confusing NaNs below. */
check('main.js installed the weather system',
  await page.evaluate(() => typeof window.game.weather?.isRaining === 'function'))

await page.evaluate(async () => {
  await window.game.authority.requestOp('diamond-pickaxe')
})

/* The autoplay gate. sounds.js will not build an AudioContext without a real
 * user gesture, and rainAudio.js hangs off that same context -- so without
 * this the ambience assertion below would be measuring the browser's autoplay
 * policy rather than anything in this repo. KeyZ is bound to nothing. */
await page.keyboard.press('KeyZ')
await page.waitForFunction(() => window.game.sounds.state === 'running',
  null, { timeout: 15_000, polling: 50 }).catch(() => {})

/* ---------- the command, driven through chat like a player would ---------- */

const chatCommand = async (text) => {
  const before = await page.evaluate(() =>
    document.querySelectorAll('#chat-lines .chat-line').length)
  await page.keyboard.press('Slash')
  await page.waitForFunction(() => window.game.chat.isOpen, null, { timeout: 5000 })
  await page.keyboard.type(text.replace(/^\//, ''))
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !window.game.chat.isOpen, null, { timeout: 5000 })
  // Commands are async all the way down -- the authority returns a promise --
  // so a granted request lands a microtask after Enter, not during it.
  await ticks(2)
  return page.evaluate((n) => [...document.querySelectorAll('#chat-lines .chat-line')]
    .slice(n).map(el => ({ kind: el.dataset.kind, text: el.textContent })), before)
}

const setRain = await chatCommand('/weather rain')
check('/weather rain reports vanilla\'s wording',
  setRain.some(l => l.kind === 'system' && l.text.includes('Set the weather to rain')),
  JSON.stringify(setRain.map(l => l.text)))

const badWeather = await chatCommand('/weather sideways')
check('/weather still parses like vanilla',
  badWeather.filter(l => l.kind === 'error').length === 2,
  JSON.stringify(badWeather.map(l => l.text)))

const withDuration = await chatCommand('/weather thunder 1d')
check('/weather takes vanilla\'s duration units',
  withDuration.some(l => l.text.includes('Set the weather to thunder')),
  JSON.stringify(withDuration.map(l => l.text)))

/* doWeatherCycle: it gates the COUNTDOWN and nothing else. */
await chatCommand('/gamerule doWeatherCycle false')
const frozen = await page.evaluate(() => window.game.weather.timeLeft)
await ticks(40)
const stillFrozen = await page.evaluate(() => window.game.weather.timeLeft)
await chatCommand('/gamerule doWeatherCycle true')
const runningA = await page.evaluate(() => window.game.weather.timeLeft)
await ticks(40)
const runningB = await page.evaluate(() => window.game.weather.timeLeft)
check('doWeatherCycle false freezes the weather clock',
  frozen === stillFrozen && runningB < runningA - 10,
  `frozen ${frozen} -> ${stillFrozen}, running ${runningA} -> ${runningB.toFixed(0)}`)

await chatCommand('/weather clear 1d')
await ticks(200)

/* ---------- clouds ---------- */

const cloud = await page.evaluate(() => {
  const scene = window.noa.rendering.getScene()
  const c = window.game.sky.clouds
  return {
    named: scene.meshes.filter(m => m.name === 'clouds').length,
    withCloudMat: scene.meshes.filter(m => m.material && m.material.name === 'cloud-mat').length,
    cells: c.cells,
    quads: c.quads,
    verts: c.mesh.getTotalVertices(),
    height: c.height,
    cell: c.cell,
    depth: c.depth,
    registered: !!(c.mesh.metadata && c.mesh.metadata.noa_added_to_scene),
  }
})
check('the cloud layer is ONE mesh', cloud.named === 1 && cloud.withCloudMat === 1,
  `${cloud.named} named 'clouds', ${cloud.withCloudMat} using cloud-mat`)
check('it is registered with noa\'s octree', cloud.registered)
check('it is a 3D slab, 12-block cells, 4 blocks thick',
  cloud.cell === 12 && cloud.depth === 4, `cell ${cloud.cell}, depth ${cloud.depth}`)
check('vanilla cloud altitude', Math.abs(cloud.height - 192.33) < 0.001, `y=${cloud.height}`)
check('interior faces are culled', cloud.quads < cloud.cells * 6,
  `${cloud.quads} quads for ${cloud.cells} cells (6/cell would be ${cloud.cells * 6})`)

// Altitude under a jump: the layer must not ride up and down with the player.
await page.evaluate(() => { window.__ys = [] })
const jumpSample = await page.evaluate(() => new Promise((resolve) => {
  const noa = window.noa
  const mesh = window.game.sky.clouds.mesh
  const ys = []
  const body = noa.ents.getPhysics(noa.playerEntity).body
  let n = 0
  const fn = () => {
    if (n === 2) body.applyImpulse([0, 8, 0])
    // The mesh is positioned in noa's LOCAL frame, which is rebased as you
    // travel; the world altitude is what must hold still.
    const g = noa.localToGlobal([mesh.position.x, mesh.position.y, mesh.position.z], [])
    ys.push(g[1])
    if (++n >= 40) { noa.off('tick', fn); resolve({ ys, player: noa.ents.getPositionData(noa.playerEntity).position[1] }) }
  }
  noa.on('tick', fn)
}))
const spread = Math.max(...jumpSample.ys) - Math.min(...jumpSample.ys)
check('the layer holds world altitude through a jump', spread < 0.001,
  `spread ${spread.toExponential(2)} blocks over 40 ticks`)

// Drift: west, 0.6 blocks/sec.
const drift = await page.evaluate(() => new Promise((resolve) => {
  const noa = window.noa
  const mesh = window.game.sky.clouds.mesh
  const at = () => noa.localToGlobal([mesh.position.x, mesh.position.y, mesh.position.z], [])[0]
  const x0 = at()
  const t0 = performance.now()
  setTimeout(() => resolve({ dx: at() - x0, secs: (performance.now() - t0) / 1000 }), 1500)
}))
const speed = drift.dx / drift.secs
check('clouds drift west at 0.6 blocks/sec', speed < -0.4 && speed > -0.8,
  `${speed.toFixed(3)} blocks/sec on x`)

await page.evaluate(() => window.game.sky.setTime(6000))
await frames(4)
await look(0, -0.30)
await shot('preview-clouds')
await look(0, -0.75)
await shot('preview-clouds-under')

/* ---------- rain ---------- */

/* Measured clear, then raining, then clear again. One before/after pair on a
 * software rasteriser is not a measurement -- the first window catches the
 * page still warming up -- and the recovery number is what proves the cost is
 * the rain rather than the clock. */
const fpsClearA = await fps(2000)

await page.evaluate(() => window.game.authority.requestWeather('rain', 12000))
/* Vanilla's ramp is 0.01 per MINECRAFT tick, so five real seconds -- and noa's
 * tick loop runs at 30 Hz, not 20, which is why this is 180 and not 100. */
await ticks(200)

const raining = await page.evaluate(() => ({
  level: window.game.weather.rainLevel,
  isRaining: window.game.weather.isRaining(),
  live: window.game.weather.rain.live,
  capacity: window.game.weather.rain.capacity,
  recycled: window.game.weather.rain.recycled,
  open: window.game.weather.rain.openColumns,
  columns: window.game.weather.rain.columns,
  meshes: window.noa.rendering.getScene().meshes.filter(m => m.name === 'rain').length,
  verts: window.noa.rendering.getScene().meshes.find(m => m.name === 'rain').getTotalVertices(),
}))
check('rain ramps to full in five seconds', raining.level > 0.95, `level ${raining.level.toFixed(2)}`)
check('the rain volume is ONE mesh', raining.meshes === 1)
check('drops are drawn from a fixed pool', raining.live <= raining.capacity,
  `${raining.live} live of ${raining.capacity}`)
check('the pool RECYCLES rather than leaking',
  raining.recycled > 0 && raining.verts === raining.capacity * 4,
  `${raining.recycled} slots reused, buffer still ${raining.verts} verts`)
check('rain covers the open columns', raining.open === raining.columns,
  `${raining.open} of ${raining.columns} unsheltered under open sky`)

const fpsRaining = await fps(2000)

await look(0.8, -0.05)
await shot('preview-rain')

/* ---------- shelter ---------- */

const roof = await page.evaluate(async () => {
  const p = window.noa.ents.getPositionData(window.noa.playerEntity).position
  const x = Math.floor(p[0]), y = Math.floor(p[1]), z = Math.floor(p[2])
  const top = y + 4
  const ID = window.game.itemId('planks')
  await window.game.authority.requestFill({
    from: [x - 4, top, z - 4], to: [x + 4, top, z + 4], id: ID,
  })
  return { x, y, z, top }
})
await ticks(30)

const sheltered = await page.evaluate(({ x, z, top }) => {
  const rain = window.game.weather.rain
  const mesh = rain.mesh
  const pos = mesh.getVerticesData('position')
  const col = mesh.getVerticesData('color')
  /*
   * Vertex positions are world coordinates -- the mesh carries the origin
   * offset -- so a drop under the roof is one below `top` inside its
   * footprint. Alpha is what decides whether a slot is DRAWN: retired slots
   * keep their last position and are blanked in the colour buffer, so reading
   * positions alone counts ghosts.
   */
  let under = 0, above = 0
  const strays = []
  for (let i = 0, c = 0; i < pos.length; i += 12, c += 16) {
    if (col[c + 3] <= 0) continue
    // The CENTRE of the quad, not corner 0: a drop is billboarded around its
    // own x/z, so its corners sit up to half a width either side and a drop
    // just outside the roof reads as just inside it.
    const px = (pos[i] + pos[i + 3]) / 2
    const py = pos[i + 1]
    const pz = (pos[i + 2] + pos[i + 5]) / 2
    // The fill covers blocks x-4..x+4, i.e. world x in [x-4, x+5). A drop at
    // exactly x+5 is in the next column along, which has open sky over it.
    const inside = px >= x - 4 && px < x + 5 && pz >= z - 4 && pz < z + 5
    if (!inside) continue
    if (py < top) { under++; strays.push([+px.toFixed(2), +py.toFixed(2), +pz.toFixed(2)]) }
    else above++
  }
  return { under, above, strays: strays.slice(0, 5), sheltered: rain.sheltered, open: rain.openColumns }
}, roof)
check('no rain falls under the roof', sheltered.under === 0,
  `${sheltered.under} drops below it, ${sheltered.above} landing on top of it` +
  (sheltered.under ? ` -- ${JSON.stringify(sheltered.strays)}` : ''))
check('the player reads as sheltered', sheltered.sheltered === true)

await look(0.8, -0.05)
await shot('preview-rain-sheltered')

await page.evaluate(async ({ x, z, top }) => {
  await window.game.authority.requestFill({ from: [x - 4, top, z - 4], to: [x + 4, top, z + 4], id: 0 })
}, roof)
await ticks(20)

/* ---------- thunder ---------- */

await page.evaluate(() => window.game.authority.requestWeather('thunder', 6000))
await ticks(220)
const storm = await page.evaluate(() => ({
  rain: window.game.weather.rainLevel,
  thunder: window.game.weather.thunderLevel,
  isThundering: window.game.weather.isThundering(),
  light: window.noa.rendering.light.intensity,
  sky: window.noa.rendering.getScene().clearColor.asArray().slice(0, 3),
}))
check('thunder darkens the light past rain alone', storm.light < 0.75,
  `light ${storm.light.toFixed(3)}, thunder level ${storm.thunder.toFixed(2)}`)
check('a thunderstorm is thundering', storm.isThundering === true)

const audio = await page.evaluate(() => ({
  context: window.game.sounds.state,
  bed: window.game.weather.ambience.running,
}))
check('the rain bed is playing', audio.bed === true || audio.context !== 'running',
  `audio context ${audio.context}, bed ${audio.bed}`)

/*
 * The flash is two Minecraft ticks -- a tenth of a second -- which is shorter
 * than a software-GL screenshot takes, so it is held open for the exposure
 * rather than hoped for. Measured as well as photographed: a screenshot cannot
 * tell you whether the sky brightened by 0.45 or by 0.045.
 */
const dark = await page.evaluate(() => ({
  sky: window.noa.rendering.getScene().clearColor.asArray().slice(0, 3),
  light: window.noa.rendering.light.intensity,
}))
const lit = await page.evaluate(() => new Promise((resolve) => {
  // Sampled on the very next tick after a strike. A setInterval would be a
  // race: the flash is three of noa's 30 Hz ticks long and a timer starved by
  // a software rasteriser can miss the whole window.
  window.game.weather.strike()
  const fn = () => {
    window.noa.off('tick', fn)
    resolve({
      sky: window.noa.rendering.getScene().clearColor.asArray().slice(0, 3),
      light: window.noa.rendering.light.intensity,
      bolts: window.game.weather.bolts,
    })
  }
  window.noa.on('tick', fn)
}))
check('lightning washes the sky and the light',
  lit.sky[2] > dark.sky[2] + 0.1 && lit.light > dark.light + 0.15,
  `sky blue ${dark.sky[2].toFixed(2)} -> ${lit.sky[2].toFixed(2)}, ` +
  `light ${dark.light.toFixed(2)} -> ${lit.light.toFixed(2)}, ${lit.bolts} bolts`)

await look(0.8, -0.05)
// Held open for the exposure: a tick handler, not a timer, for the same reason.
await page.evaluate(() => {
  window.__flash = () => window.game.weather.strike()
  window.noa.on('tick', window.__flash)
})
await ticks(3)
await shot('preview-thunder')
await page.evaluate(() => { window.noa.off('tick', window.__flash) })

/* ---------- above the clouds, and dusk ---------- */

await page.evaluate(async () => {
  await window.game.authority.requestWeather('clear', 24000)
})
await ticks(200)
const fpsClearB = await fps(2000)
const worst = Math.min(fpsClearA, fpsClearB)
check('rain costs less than a third of the frame rate', fpsRaining > worst * 0.66,
  `${fpsClearA.toFixed(1)} / ${fpsClearB.toFixed(1)} fps clear, ` +
  `${fpsRaining.toFixed(1)} fps raining (software GL)`)

await page.evaluate(async () => {
  await window.game.authority.requestGamemode('spectator')
  await window.game.authority.requestTeleport(0, 235, 0)
})
await ticks(40)
await look(0.6, 0.55)
await shot('preview-clouds-above')

await page.evaluate(async () => {
  await window.game.authority.requestGamemode('survival')
  await window.game.authority.requestTeleport(0, 68, 0)
  window.game.sky.setTime(12200)
})
await ticks(20)
await look(0, -0.32)
await shot('preview-clouds-sunset')

check('nothing threw', errors.length === 0, errors.slice(0, 3).join(' | '))

console.log(`\n${failures ? `${failures} FAILED` : 'all checks passed'}`)
await browser.close()
process.exit(failures ? 1 : 0)
