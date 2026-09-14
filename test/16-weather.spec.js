import { test, expect } from './fixtures.js'
import {
  chatCommand, grantOp, useGamemode, teleport, look, waitTicks, waitFrames,
  measureFps, OP_PASSPHRASE,
} from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * Weather: the rain volume, the cloud slab, the storm clock and lightning.
 *
 * The rule this file exists to protect: every one of those is a number the
 * game publishes, so every one of them is checkable, and none of them was
 * checked by anything `npm test` ran. This file is scripts/verify-weather.mjs
 * moved into the harness -- same assertions, same measured constants, now run
 * by the suite instead of by whoever remembered the script existed.
 *
 * Why that move mattered, recorded because the shape of the mistake outlives
 * it: the script used to install its own weather system before measuring, from
 * back when main.js did not. main.js picked it up, and the script's call
 * quietly became a SECOND rain volume, a second thunder clock and a second
 * ambience bed beside the real ones -- with window.game.weather repointed at
 * the copy while /weather went on driving main.js's. Every assertion was
 * reading the wrong object and nothing failed. A verification that sets up
 * what it verifies goes stale silently; one that runs on the shared booted
 * world cannot.
 *
 * It measures the LIVE system -- window.game.weather -- and nothing else.
 *
 * Screenshots are EVIDENCE, not assertions, per helpers/shots.js. Anything a
 * number can answer is answered by a number below; the shots are for "do the
 * clouds look like Minecraft's", which no assertion here can honestly settle.
 *
 * Deliberately NOT duplicated here, because the suite already has them:
 *   - /weather's wording and its two-line parse failure: 11-commands.spec.js.
 *   - the cloud layer's DRIFT and its refusal to step backwards over a cell
 *     boundary: 07-daynight.spec.js, which traces it over a sprint.
 * A second copy of a check is the same problem as a check nobody runs.
 */

/** Vanilla's cloud altitude, and the slab's shape. See sky.js. */
const CLOUD_Y = 192.33
const CLOUD_CELL = 12
const CLOUD_DEPTH = 4

/*
 * Ramps are 0.01 per MINECRAFT tick and weather.js converts real time into
 * Minecraft ticks, so a storm arrives in five wall-clock seconds whatever the
 * frame rate. noa ticks at 30 Hz, not 20, which is why a full ramp is ~150
 * ticks rather than 100 -- 200 leaves room for a stalled software-GL frame.
 */
const RAMP_TICKS = 200

const weatherState = (page) => page.evaluate(() => {
  const w = window.game.weather
  return {
    kind: w.kind,
    rainLevel: w.rainLevel,
    thunderLevel: w.thunderLevel,
    isRaining: w.isRaining(),
    isThundering: w.isThundering(),
  }
})

/** Weather is op-gated world state, and resetWorld deops between tests. */
async function requestWeather(page, kind, duration = 12000) {
  await grantOp(page)
  const r = await page.evaluate(([k, d]) =>
    window.game.authority.requestWeather(k, d), [kind, duration])
  expect(r.ok, `requestWeather(${kind}) was refused: ${r.error}`).toBe(true)
}

/*
 * Set it and wait for it to have ARRIVED, rather than for a fixed stretch.
 * The ramp is the thing one test below times; everywhere else the interesting
 * state is the storm at full strength, and polling the level the game
 * publishes gets there in five seconds on a fast machine instead of always
 * paying the slowest case.
 */
async function stormArrives(page, kind) {
  await requestWeather(page, kind)
  await page.waitForFunction(([k]) => {
    const w = window.game.weather
    return k === 'thunder' ? w.isThundering() : w.rainLevel > 0.99
  }, [kind], { timeout: 30_000, polling: 50 })
}

/** Back to a dry world, and wait for the drops to actually stop. */
async function skyClears(page) {
  await requestWeather(page, 'clear', 24000)
  await page.waitForFunction(() => window.game.weather.rainLevel === 0,
    null, { timeout: 30_000, polling: 50 })
}

/*
 * Weather is page-lifetime state that resetWorld does NOT put back -- it
 * outlives a test the way the game mode does, and a spec left in the rain
 * changes the light level and the frame rate for whatever runs next. At file
 * scope, not inside the first describe: a hook in a describe runs when THAT
 * block ends, which here would be before a single drop had fallen.
 */
test.afterAll(async ({ world }) => {
  await skyClears(world.page)
  await world.page.evaluate(async (pass) => {
    const a = window.game.authority
    await a.requestOp(pass)
    await a.requestGamerule('doWeatherCycle', 'true')
    await a.requestDeop()
  }, OP_PASSPHRASE)
})

test.describe('weather', () => {
  /* Asserted rather than assumed. If main.js ever stops installing weather,
   * the failure should be this line rather than a hundred confusing NaNs. */
  test('main.js installed the weather system', async ({ page }) => {
    const installed = await page.evaluate(() =>
      typeof window.game.weather?.isRaining === 'function')
    expect(installed, 'window.game.weather is not the live system').toBe(true)
  })

  test('/weather takes vanilla\'s duration units', async ({ page }) => {
    await grantOp(page)
    const out = await chatCommand(page, '/weather thunder 1d')
    expect(out.map(l => l.text).join(' | '),
      'a duration in days was not accepted').toContain('Set the weather to thunder')
  })

  test('doWeatherCycle false freezes the weather clock', async ({ page }) => {
    await grantOp(page)
    /*
     * The rule gates the COUNTDOWN and nothing else -- which is exactly what
     * vanilla gates. The ramps and /weather itself run either way, so turning
     * it off freezes the weather you are in rather than stopping a storm
     * mid-fall. Only timeLeft can see the difference.
     */
    await chatCommand(page, '/gamerule doWeatherCycle false')
    const frozen = await page.evaluate(() => window.game.weather.timeLeft)
    await waitTicks(page, 40)
    const stillFrozen = await page.evaluate(() => window.game.weather.timeLeft)
    expect(stillFrozen, `clock ran from ${frozen} to ${stillFrozen} with the rule off`)
      .toBe(frozen)

    await chatCommand(page, '/gamerule doWeatherCycle true')
    const runningA = await page.evaluate(() => window.game.weather.timeLeft)
    await waitTicks(page, 40)
    const runningB = await page.evaluate(() => window.game.weather.timeLeft)
    // 40 ticks is ~27 Minecraft ticks off the countdown; 10 is well inside
    // that and still two orders of magnitude away from a frozen clock.
    expect(runningB, `clock only moved ${(runningA - runningB).toFixed(1)} ticks`
      + ' with the rule back on').toBeLessThan(runningA - 10)
  })
})

/*
 * The cloud SLAB. Its motion is 07-daynight's; what is checked here is that it
 * is one mesh, the right shape, at the right altitude, and that it does not
 * ride up and down with the player.
 */
test.describe('cloud layer', () => {
  const readClouds = (page) => page.evaluate(() => {
    const scene = window.noa.rendering.getScene()
    const c = window.game.sky.clouds
    return {
      named: scene.meshes.filter(m => m.name === 'clouds').length,
      withCloudMat: scene.meshes.filter(m => m.material?.name === 'cloud-mat').length,
      cells: c.cells,
      quads: c.quads,
      height: c.height,
      cell: c.cell,
      depth: c.depth,
      registered: !!c.mesh.metadata?.noa_added_to_scene,
    }
  })

  test('the whole sky is one mesh, registered with noa\'s octree',
    async ({ page }) => {
      const c = await readClouds(page)
      expect(c.named, `${c.named} meshes named 'clouds'`).toBe(1)
      expect(c.withCloudMat, `${c.withCloudMat} meshes using cloud-mat`).toBe(1)
      // A mesh noa's selection octree has never heard of is silently never
      // drawn, which no other assertion in this file would notice.
      expect(c.registered, 'the cloud mesh is not in noa\'s octree').toBe(true)
    })

  test('it is a 3D slab of 12-block cells at vanilla\'s altitude',
    async ({ page }) => {
      const c = await readClouds(page)
      expect(c.cell, `cell size ${c.cell}`).toBe(CLOUD_CELL)
      expect(c.depth, `slab thickness ${c.depth}`).toBe(CLOUD_DEPTH)
      expect(Math.abs(c.height - CLOUD_Y), `clouds sit at y=${c.height}`)
        .toBeLessThan(0.001)
      // Fancy clouds are boxes, so the naive build is six faces a cell. Any
      // number below that is proof the shared faces between neighbouring
      // cells were dropped -- the difference between ~12k quads and ~30k.
      expect(c.quads, `${c.quads} quads for ${c.cells} cells`
        + ` (uncalled-for would be ${c.cells * 6})`).toBeLessThan(c.cells * 6)
    })

  test('the layer holds world altitude through a jump', async ({ page }) => {
    const sample = await page.evaluate(() => new Promise((resolve) => {
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
        if (++n >= 40) { noa.off('tick', fn); resolve(ys) }
      }
      noa.on('tick', fn)
    }))
    const spread = Math.max(...sample) - Math.min(...sample)
    expect(spread, `layer moved ${spread.toExponential(2)} blocks over a jump`)
      .toBeLessThan(0.001)
  })

  test('the clouds look like Minecraft\'s', async ({ page }) => {
    // Visual by nature: cell size, altitude and the box shading only read as
    // right together, and from underneath as well as from below the horizon.
    await look(page, { pitch: -0.30 })
    await shot(page, 'clouds-noon')
    await look(page, { pitch: -0.75 })
    await shot(page, 'clouds-underside')
  })
})

test.describe('rain', () => {
  test('rain ramps to full in five seconds', async ({ page }) => {
    await skyClears(page)
    await requestWeather(page, 'rain')
    await waitTicks(page, RAMP_TICKS)
    const w = await weatherState(page)
    expect(w.rainLevel, `rain level ${w.rainLevel.toFixed(2)} after the ramp`)
      .toBeGreaterThan(0.95)
    expect(w.isRaining, 'a world at full rain level does not read as raining')
      .toBe(true)
  })

  test('the volume is one mesh drawing from a pool that recycles',
    async ({ page, flatGround }) => {
      /*
       * Out in the open, which this world does not have on the ground.
       *
       * The `open === columns` assertion below means "every column of the rain
       * footprint has clear sky". Spawn is under a dark forest canopy and 370
       * of 441 columns are sheltered by leaves -- which is the shelter code
       * working, not failing. A scan of the whole patch found no 21x21 patch
       * of GROUND with open sky over it anywhere: it is a forest against a
       * mountain. So the test builds the clearing it is talking about, which
       * is the same flat open surface the old island handed it for free.
       */
      await flatGround.build()
      await stormArrives(page, 'rain')

      /*
       * Give the footprint its documented catch-up frames.
       *
       * particles.js rebuilds all 441 columns only when the player crosses a
       * block boundary HORIZONTALLY, and sweeps an eighth of them per frame
       * otherwise -- moving straight up onto the pad is a purely vertical move,
       * so the grid still describes the same columns and only the scan window
       * changed. That is the intended design (441 column scans a frame is the
       * thing it is avoiding), not a bug, and eight frames is what it costs.
       * Without this the test reads the footprint mid-sweep and sees the forest
       * canopy it left behind two hundred blocks below.
       */
      await waitFrames(page, 16)
      const r = await page.evaluate(() => {
        const rain = window.game.weather.rain
        const scene = window.noa.rendering.getScene()
        const meshes = scene.meshes.filter(m => m.name === 'rain')
        return {
          meshes: meshes.length,
          verts: meshes[0].getTotalVertices(),
          live: rain.live,
          capacity: rain.capacity,
          recycled: rain.recycled,
          open: rain.openColumns,
          columns: rain.columns,
          // In the failure message, because "some columns are sheltered" is
          // almost always "the player is not where the test thinks".
          at: [...window.noa.ents.getPositionData(window.noa.playerEntity).position],
        }
      })
      expect(r.meshes, `${r.meshes} meshes named 'rain'`).toBe(1)
      expect(r.live, `${r.live} live drops of a ${r.capacity} pool`)
        .toBeLessThanOrEqual(r.capacity)
      /*
       * The pool is the whole design: slots are swap-removed and refilled,
       * never allocated. `recycled` counting up while the vertex buffer stays
       * exactly capacity x 4 is what separates "reuses slots" from "leaks a
       * mesh's worth of drops a minute".
       */
      expect(r.recycled, 'no slot was ever reused').toBeGreaterThan(0)
      expect(r.verts, `buffer is ${r.verts} verts for a ${r.capacity} pool`)
        .toBe(r.capacity * 4)
      // Out in the open, every column of the footprint should be raining in.
      expect(r.open, `${r.open} of ${r.columns} columns unsheltered under open sky,`
        + ` standing at ${r.at.map(v => v.toFixed(1)).join(', ')}`)
        .toBe(r.columns)

      await look(page, { heading: 0.8, pitch: -0.05 })
      await shot(page, 'rain')
    })

  test('the rain bed plays while it is raining', async ({ page }) => {
    await stormArrives(page, 'rain')
    /*
     * The autoplay gate. sounds.js will not build an AudioContext without a
     * trusted gesture and rainAudio.js hangs off that same context, so without
     * this the assertion measures the browser's autoplay policy rather than
     * anything in this repo. KeyZ is bound to nothing -- helpers/audio.js says
     * at length why the gesture key has to be a key that does nothing.
     */
    await page.keyboard.press('KeyZ')
    await page.waitForFunction(() => window.game.sounds.state === 'running',
      null, { timeout: 15_000, polling: 50 })
    const bed = await page.evaluate(() => window.game.weather.ambience.running)
    expect(bed, 'the rain ambience bed never started').toBe(true)
  })

  test('no rain falls under a roof, and the player reads as sheltered',
    async ({ page, terrain }) => {
      await stormArrives(page, 'rain')
      const roof = await page.evaluate(async () => {
        const p = window.noa.ents.getPositionData(window.noa.playerEntity).position
        return {
          x: Math.floor(p[0]), y: Math.floor(p[1]), z: Math.floor(p[2]),
          top: Math.floor(p[1]) + 4,
        }
      })
      // 9x9 of planks four blocks up, registered with the undo fixture: a slab
      // of planks left in the air over spawn is the next spec's problem
      // otherwise, and the fixture puts it back even if an assertion throws.
      await terrain.keep(
        [roof.x - 4, roof.top, roof.z - 4], [roof.x + 4, roof.top, roof.z + 4])
      await grantOp(page)
      await page.evaluate(async ({ x, z, top }) => {
        await window.game.authority.requestFill({
          from: [x - 4, top, z - 4], to: [x + 4, top, z + 4], id: window.game.itemId('planks'),
        })
      }, roof)

      /*
       * Waited in FRAMES, not ticks, and that is the one thing this check got
       * wrong as a script.
       *
       * particles.js rescans the 441-column footprint an EIGHTH at a time per
       * rendered frame -- that sweep is what notices a roof going up over your
       * head without paying 441 column scans every frame. So the roof becomes
       * visible to the rain after eight frames, not after any number of ticks.
       * The script waited 30 ticks, which is eight frames only if the machine
       * is managing 30 fps; under software GL on a busy laptop it is four, and
       * the check failed with drops still falling indoors. 24 frames is three
       * full sweeps.
       */
      await waitFrames(page, 24)

      const sheltered = await page.evaluate(({ x, z, top }) => {
        const rain = window.game.weather.rain
        const pos = rain.mesh.getVerticesData('position')
        const col = rain.mesh.getVerticesData('color')
        /*
         * Vertex positions are world coordinates -- the mesh carries the
         * origin offset -- so a drop under the roof is one below `top` inside
         * its footprint. Alpha is what decides whether a slot is DRAWN:
         * retired slots keep their last position and are blanked in the colour
         * buffer, so reading positions alone counts ghosts.
         */
        let under = 0, above = 0
        const strays = []
        for (let i = 0, c = 0; i < pos.length; i += 12, c += 16) {
          if (col[c + 3] <= 0) continue
          // The CENTRE of the quad, not corner 0: a drop is billboarded around
          // its own x/z, so its corners sit up to half a width either side and
          // a drop just outside the roof reads as just inside it.
          const px = (pos[i] + pos[i + 3]) / 2
          const py = pos[i + 1]
          const pz = (pos[i + 2] + pos[i + 5]) / 2
          // The fill covers blocks x-4..x+4, i.e. world x in [x-4, x+5). A drop
          // at exactly x+5 is in the next column along, which has open sky.
          if (!(px >= x - 4 && px < x + 5 && pz >= z - 4 && pz < z + 5)) continue
          if (py < top) { under++; strays.push([+px.toFixed(2), +py.toFixed(2), +pz.toFixed(2)]) }
          else above++
        }
        return { under, above, strays: strays.slice(0, 5), sheltered: rain.sheltered }
      }, roof)

      expect(sheltered.under, `${sheltered.under} drops under the roof`
        + ` (${sheltered.above} landing on top of it): ${JSON.stringify(sheltered.strays)}`)
        .toBe(0)
      /*
       * Not the same claim as the drops above. Vanilla swaps the rain audio to
       * its muffled variant when the heightmap above you is higher than you
       * are, which a roof four blocks up satisfies while rain still falls on
       * top of it -- so this is the audio's test, not the volume's.
       */
      expect(sheltered.sheltered, 'the player does not read as sheltered under a roof')
        .toBe(true)

      await look(page, { heading: 0.8, pitch: -0.05 })
      await shot(page, 'rain-sheltered')
    })

  /*
   * Measured clear, then raining, then clear again. One before/after pair on a
   * software rasteriser is not a measurement -- the first window catches the
   * page still warming up -- and the recovery number is what proves the cost
   * is the rain rather than the clock.
   */
  test('rain costs less than a third of the frame rate', async ({ page }) => {
    await skyClears(page)
    const clearA = await measureFps(page, 2000)

    await stormArrives(page, 'rain')
    const raining = await measureFps(page, 2000)

    await skyClears(page)
    const clearB = await measureFps(page, 2000)

    // Against the WORSE of the two dry windows, so a machine that got busy
    // during the run reads as a slow dry baseline rather than as cheap rain.
    const worst = Math.min(clearA, clearB)
    expect(raining, `${clearA.toFixed(1)} / ${clearB.toFixed(1)} fps clear,`
      + ` ${raining.toFixed(1)} fps raining (software GL)`)
      .toBeGreaterThan(worst * 0.66)
  })
})

test.describe('thunder', () => {
  test('a thunderstorm darkens the world past rain alone', async ({ page }) => {
    await stormArrives(page, 'thunder')
    const storm = await page.evaluate(() => ({
      light: window.noa.rendering.light.intensity,
      thunder: window.game.weather.thunderLevel,
    }))
    const w = await weatherState(page)
    expect(w.isThundering, 'a thunderstorm does not read as thundering').toBe(true)
    // Noon, so the light is at its maximum when the sky is clear. Rain alone
    // takes it to ~0.8; only the storm on top of it gets below this.
    expect(storm.light, `light ${storm.light.toFixed(3)} at thunder level`
      + ` ${storm.thunder.toFixed(2)}`).toBeLessThan(0.75)
  })

  test('lightning washes the sky and the light', async ({ page }) => {
    await stormArrives(page, 'thunder')
    const read = () => page.evaluate(() => ({
      sky: window.noa.rendering.getScene().clearColor.asArray().slice(0, 3),
      light: window.noa.rendering.light.intensity,
    }))
    const dark = await read()

    /*
     * The strike is FORCED rather than waited for. Vanilla's odds are one bolt
     * per ~500 ticks, so waiting for a natural one is a coin flip with a
     * 25-second period -- the definition of a flaky test. weather.strike() is
     * exported for exactly this.
     *
     * And it is sampled on the very next tick. A setTimeout would be a race:
     * the flash is two Minecraft ticks, a tenth of a second, and a timer
     * starved by a software rasteriser can miss the whole window. Measured as
     * well as photographed, because a screenshot cannot tell you whether the
     * sky brightened by 0.45 or by 0.045.
     */
    const lit = await page.evaluate(() => new Promise((resolve) => {
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

    expect(lit.sky[2], `sky blue ${dark.sky[2].toFixed(2)} -> ${lit.sky[2].toFixed(2)}`)
      .toBeGreaterThan(dark.sky[2] + 0.1)
    expect(lit.light, `light ${dark.light.toFixed(2)} -> ${lit.light.toFixed(2)}`)
      .toBeGreaterThan(dark.light + 0.15)
    expect(lit.bolts, 'strike() did not count a bolt').toBeGreaterThan(0)

    await look(page, { heading: 0.8, pitch: -0.05 })
    // Held open for the exposure with a tick handler rather than hoped for: a
    // two-tick flash is shorter than a software-GL screenshot takes.
    await page.evaluate(() => {
      window.__flash = () => window.game.weather.strike()
      window.noa.on('tick', window.__flash)
    })
    await waitTicks(page, 3)
    await shot(page, 'thunder')
    await page.evaluate(() => { window.noa.off('tick', window.__flash) })
  })
})

test.describe('the sky from elsewhere', () => {
  test('the clouds from above and at dusk', async ({ page }) => {
    await skyClears(page)
    // Spectator, because a survival player at y=235 is a falling player.
    await useGamemode(page, 'spectator')
    await teleport(page, 0, 235, 0)
    await waitTicks(page, 20)
    await look(page, { heading: 0.6, pitch: 0.55 })
    await shot(page, 'clouds-above')

    await useGamemode(page, 'survival')
    await teleport(page, 0, 68, 0)
    // 12200 is just past sunset, where the cloud tint and the sky gradient
    // disagree most -- the frame that catches a cloud layer lit by the wrong
    // half of the day.
    await page.evaluate(() => window.game.sky.setTime(12200))
    await waitTicks(page, 20)
    await look(page, { pitch: -0.32 })
    await shot(page, 'clouds-sunset')
  })
})
