import { test, expect } from './fixtures.js'
import { chatCommand, grantOp, position, look, waitTicks, playerName } from './helpers/world.js'

/*
 * The commands, against Java Edition 1.21's syntax and en_us.json wording.
 * /time has its own block in test/120-vanilla-sky.spec.js, and /summon and
 * /kill @e in test/121-mobs.spec.js.
 */

const sys = (out) => out.filter(l => l.kind === 'system').map(l => l.text)
const errs = (out) => out.filter(l => l.kind === 'error').map(l => l.text)

test.beforeEach(async ({ page }) => { await grantOp(page) })

test.describe('/tp', () => {
  test('a target before the position, and rotation after it', async ({ page }) => {
    const name = await playerName(page)
    expect(sys(await chatCommand(page, '/tp @s 3 150 4 90 10')))
      .toEqual([`Teleported ${name} to 3.500000, 150.000000, 4.500000`])
    const cam = await page.evaluate(() => [window.noa.camera.heading, window.noa.camera.pitch])
    expect(cam[0]).toBeCloseTo(Math.PI / 2, 3)
    expect(cam[1]).toBeCloseTo(10 * Math.PI / 180, 3)
    // Your own name works as a target; somebody else's finds nobody.
    expect(sys(await chatCommand(page, `/tp ${name} 0 150 0`))).toHaveLength(1)
    expect(errs(await chatCommand(page, '/tp Notch 0 150 0'))).toEqual(['No entity was found'])
  })

  test('decimals are taken as written, and ~ is not centered', async ({ page }) => {
    await chatCommand(page, '/tp 2.25 150 -3.75')
    const [x, , z] = await position(page)
    expect(x).toBeCloseTo(2.25, 2)
    expect(z).toBeCloseTo(-3.75, 2)
    await chatCommand(page, '/tp ~1 ~ ~')
    expect((await position(page))[0]).toBeCloseTo(3.25, 1)
  })

  test('^ is local: left, up, forward from where you look', async ({ page }) => {
    await chatCommand(page, '/tp 0.5 150 0.5')
    // Heading 0 faces +Z here, so ^ ^ ^3 is three blocks along +Z.
    await look(page, { heading: 0, pitch: 0 })
    const [x0, , z0] = await position(page)
    await chatCommand(page, '/tp ^ ^ ^3')
    const [x1, , z1] = await position(page)
    expect(z1 - z0).toBeCloseTo(3, 1)
    expect(x1 - x0).toBeCloseTo(0, 1)
    // ^1 is to the LEFT. Facing +Z (south), left is east, which is -X here.
    await chatCommand(page, '/tp ^1 ^ ^')
    const [x2] = await position(page)
    expect(x2 - x1).toBeCloseTo(-1, 1)
    // Mixing ^ with anything else is a parse error, as in vanilla.
    expect(errs(await chatCommand(page, '/tp ^ ~ ^')))
      .toEqual(['Cannot mix world & local coordinates (everything must either use ^ or not)'])
  })
})

test.describe('/give', () => {
  test('/give <target> <item> [count], vanilla\'s form', async ({ page }) => {
    const name = await playerName(page)
    expect(sys(await chatCommand(page, '/give @s diamond 3'))).toEqual([`Gave 3 [Diamond] to ${name}`])
    expect(sys(await chatCommand(page, `/give ${name} minecraft:stick`))).toEqual([`Gave 1 [Stick] to ${name}`])
    expect(errs(await chatCommand(page, '/give Notch diamond 1'))).toEqual(['No player was found'])
  })

  test('more than 100 stacks is refused, and what does not fit is dropped', async ({ page }) => {
    expect(errs(await chatCommand(page, '/give @s diamond 6401')))
      .toEqual(["Can't give more than 6400 of [Diamond]"])
    const before = await page.evaluate(() => window.game.drops.list.length)
    // 36 slots of 64 is 2304; the other 196 land at your feet.
    const out = await chatCommand(page, '/give @s cobblestone 2500')
    expect(sys(out)[0]).toMatch(/^Gave 2500 \[Cobblestone\] to /)
    const dropped = await page.evaluate((n) => window.game.drops.list.slice(n)
      .reduce((s, d) => s + d.count, 0), before)
    expect(dropped).toBe(2500 - 36 * 64)
  })
})

test.describe('the wording', () => {
  test('/weather thunder and /gamerule say what vanilla says', async ({ page }) => {
    expect(sys(await chatCommand(page, '/weather thunder 100'))).toEqual(['Set the weather to rain & thunder'])
    expect(sys(await chatCommand(page, '/weather clear'))).toEqual(['Set the weather to clear'])
    expect(sys(await chatCommand(page, '/gamerule fallDamage')))
      .toEqual(['Gamerule fallDamage is currently set to: true'])
    await waitTicks(page, 2)
  })
})
