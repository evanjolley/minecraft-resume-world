import { test, expect } from './fixtures.js'
import { waitTicks, chatCommand, grantOp, look } from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * The sky against Java Edition 1.21's own arithmetic (src/celestial.js), and
 * the dome, stars and moon phases that draw it (src/skyDome.js, src/sky.js).
 */

const celestial = (page, fn, ...args) => page.evaluate(async ([f, a]) => {
  const m = await import('/src/celestial.js')
  return m[f](...a)
}, [fn, args])

const atTime = async (page, t) => {
  await page.evaluate((tt) => { window.game.sky.setRunning(false); window.game.sky.setTime(tt) }, t)
  await waitTicks(page, 3)
}

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.game.sky.setRunning(true))
})

test.describe('the clock bends the way vanilla bends it', () => {
  test('noon is overhead, midnight is underfoot, and tick 0 is already morning', async ({ page }) => {
    expect(await celestial(page, 'celestialAngle', 6000)).toBeCloseTo(0, 6)
    expect(await celestial(page, 'celestialAngle', 18000)).toBeCloseTo(0.5, 6)
    // DimensionType.timeOfDay(0): (1.5 + 0.5 - cos(0.75 pi)/2) / 3.
    expect(await celestial(page, 'celestialAngle', 0)).toBeCloseTo(0.78452, 4)
  })

  test('the sun is up from about 23215 to about 12785, so day outlasts night', async ({ page }) => {
    const up = async (t) => (await celestial(page, 'sunDirection',
      await celestial(page, 'celestialAngle', t)))[1] > 0
    expect(await up(23300)).toBe(true)
    expect(await up(23100)).toBe(false)
    expect(await up(12700)).toBe(true)
    expect(await up(12900)).toBe(false)
  })

  test('the sun mesh is above the player at tick 0 and rises in the east (-X)', async ({ page }) => {
    await atTime(page, 0)
    const s = await page.evaluate(() => {
      const noa = window.noa
      const sun = noa.rendering.getScene().meshes.find(m => m.name === 'sun')
      const g = [0, 0, 0]
      noa.localToGlobal([sun.position.x, sun.position.y, sun.position.z], g)
      const p = noa.ents.getPosition(noa.playerEntity)
      return { dy: g[1] - p[1], dx: g[0] - p[0], on: sun.isEnabled() }
    })
    expect(s.on).toBe(true)
    expect(s.dy).toBeGreaterThan(0)
    expect(s.dx).toBeLessThan(0)
  })

  test('sky light is Level.getSkyDarken: 1 at noon, 0.2 at midnight', async ({ page }) => {
    await atTime(page, 6000)
    expect(await page.evaluate(() => window.noa.rendering.light.intensity)).toBeCloseTo(1, 3)
    await atTime(page, 18000)
    expect(await page.evaluate(() => window.noa.rendering.light.intensity)).toBeCloseTo(0.2, 3)
  })

  test('clouds take ClientLevel.getCloudColor, dim blue at midnight', async ({ page }) => {
    await atTime(page, 18000)
    const c = await page.evaluate(() => {
      const m = window.game.sky.clouds.mesh.material.emissiveColor
      return [m.r, m.g, m.b]
    })
    expect(c[0]).toBeCloseTo(0.1, 3)
    expect(c[2]).toBeCloseTo(0.15, 3)
  })
})

test.describe('the dome', () => {
  test('the horizon is the fog color and the zenith is the sky color at noon', async ({ page }) => {
    await atTime(page, 6000)
    const d = await page.evaluate(() => ({
      up: window.game.sky.dome.colorToward([0, 1, 0]),
      horizon: window.game.sky.dome.colorToward([0, 0, 1]),
    }))
    const sky = await celestial(page, 'skyColor', 0)
    const fog = await celestial(page, 'fogColor', 0)
    for (let i = 0; i < 3; i++) {
      expect(d.up[i]).toBeCloseTo(sky[i], 3)
      expect(d.horizon[i]).toBeCloseTo(fog[i], 3)
    }
    // Fog is paler than sky: that gradient is the point of the dome.
    expect(d.horizon[0]).toBeGreaterThan(d.up[0])
  })

  test('the sunset glow sits on the sun\'s side of the sky only', async ({ page }) => {
    await atTime(page, 12600)
    const d = await page.evaluate(() => ({
      west: window.game.sky.dome.colorToward([1, 0.05, 0]),
      east: window.game.sky.dome.colorToward([-1, 0.05, 0]),
      up: window.game.sky.dome.colorToward([0, 1, 0]),
    }))
    // The sun sets at +X (west), so the orange is there.
    expect(d.west[0] - d.west[2]).toBeGreaterThan(d.east[0] - d.east[2] + 0.1)
    // And the zenith did not turn orange with it, which it used to.
    expect(d.up[0]).toBeLessThan(d.up[2])
    await look(page, { heading: Math.PI / 2, pitch: -0.1 })
    await shot(page, 'sky-sunset-glow')
  })

  test('vanilla\'s star field: seed 10842, out at night, gone at noon', async ({ page }) => {
    const n = await page.evaluate(async () => (await import('/src/skyDome.js')).vanillaStars().length)
    // 1500 draws, keeping the ones inside the unit ball and outside r=0.1:
    // pi/6 of them, give or take.
    expect(n).toBeGreaterThan(700)
    expect(n).toBeLessThan(880)
    await atTime(page, 18000)
    const night = await page.evaluate(() => ({
      on: window.game.sky.dome.stars.isEnabled(),
      alpha: window.game.sky.dome.stars.material.alpha,
      quads: window.game.sky.dome.starCount,
    }))
    expect(night.on).toBe(true)
    expect(night.alpha).toBeCloseTo(0.5, 3)
    expect(night.quads).toBe(n)
    await atTime(page, 6000)
    expect(await page.evaluate(() => window.game.sky.dome.stars.isEnabled())).toBe(false)
  })

  test('the moon shows a new phase each day, full on day 0', async ({ page }) => {
    await atTime(page, 18000)
    expect(await page.evaluate(() => window.game.sky.moonPhase)).toBe(0)
    await atTime(page, 3 * 24000 + 18000)
    const m = await page.evaluate(() => {
      const moon = window.noa.rendering.getScene().meshes.find(x => x.name === 'moon')
      const t = moon.material.emissiveTexture
      return { phase: window.game.sky.moonPhase, u: t.uOffset, v: t.vOffset, day: window.game.sky.day }
    })
    expect(m).toEqual({ phase: 3, u: 0.75, v: 0, day: 3 })
    await atTime(page, 5 * 24000 + 18000)
    expect(await page.evaluate(() => {
      const t = window.noa.rendering.getScene().meshes.find(x => x.name === 'moon').material.emissiveTexture
      return [t.uOffset, t.vOffset]
    })).toEqual([0.25, 0.5])
  })

  test('the sun is a disc, not a square', async ({ page }) => {
    // The CE sun shipped opaque black around the disc and drew as a square.
    const corner = await page.evaluate(() => new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const c = document.createElement('canvas')
        c.width = img.width; c.height = img.height
        const g = c.getContext('2d')
        g.drawImage(img, 0, 0)
        resolve([...g.getImageData(0, 0, 1, 1).data])
      }
      img.src = '/textures/sun.png'
    }))
    expect(corner[3]).toBe(0)
  })
})

test.describe('/time, as TimeCommand has it', () => {
  test.beforeEach(async ({ page }) => { await grantOp(page) })

  test('units, and the reported numbers', async ({ page }) => {
    const sys = (out) => out.filter(l => l.kind === 'system').map(l => l.text)
    expect(sys(await chatCommand(page, '/time set 0.5d'))).toEqual(['Set the time to 12000'])
    expect(sys(await chatCommand(page, '/time set 30000'))).toEqual(['Set the time to 30000'])
    expect(sys(await chatCommand(page, '/time query day'))).toEqual(['The time is 1'])
    const q = sys(await chatCommand(page, '/time query daytime'))[0]
    expect(Number(q.match(/(\d+)$/)[1])).toBeGreaterThanOrEqual(6000)
    expect(Number(q.match(/(\d+)$/)[1])).toBeLessThan(6200)
    const g = sys(await chatCommand(page, '/time query gametime'))[0]
    expect(g).toMatch(/^The time is \d+$/)
    // /time add reports the resulting time of day, wrapped.
    await chatCommand(page, '/time set 23000')
    const add = sys(await chatCommand(page, '/time add 2000'))[0]
    expect(Number(add.match(/(\d+)$/)[1])).toBeLessThan(1200)
    expect(await page.evaluate(() => window.game.sky.day)).toBe(1)
  })
})
