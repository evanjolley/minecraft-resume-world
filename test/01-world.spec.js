import { test, expect } from './fixtures.js'
import { ID, ISLAND_HALF, SURFACE_Y, getBlock } from './helpers/world.js'
import { shot } from './helpers/shots.js'

test.describe('world generation', () => {
  test('the page boots with no errors, failed requests or 404s', async ({ bootErrors }) => {
    // Missing textures land here first: a 404 on /textures/*.png never throws,
    // it just renders the block untextured, which no numeric assertion sees.
    expect(bootErrors).toEqual([])
  })

  test('the island stops dead at 80 blocks wide on both axes', async ({ page }) => {
    // 80 wide spanning -40..39, so 39 is the last solid column and 40 is void.
    // Off by one here means every parkour jump near the rim is wrong.
    expect(await getBlock(page, 39, SURFACE_Y - 1, 0)).toBe(ID.grass)
    expect(await getBlock(page, 40, SURFACE_Y - 1, 0)).toBe(ID.air)
    expect(await getBlock(page, -ISLAND_HALF, SURFACE_Y - 1, 0)).toBe(ID.grass)
    expect(await getBlock(page, -ISLAND_HALF - 1, SURFACE_Y - 1, 0)).toBe(ID.air)

    expect(await getBlock(page, 0, SURFACE_Y - 1, 39)).toBe(ID.grass)
    expect(await getBlock(page, 0, SURFACE_Y - 1, 40)).toBe(ID.air)
    expect(await getBlock(page, 0, SURFACE_Y - 1, -ISLAND_HALF)).toBe(ID.grass)
    expect(await getBlock(page, 0, SURFACE_Y - 1, -ISLAND_HALF - 1)).toBe(ID.air)
  })

  test('the strata run grass, dirt, bedrock, void from y=63 down', async ({ page }) => {
    expect(await getBlock(page, 0, SURFACE_Y, 0)).toBe(ID.air)
    expect(await getBlock(page, 0, 63, 0)).toBe(ID.grass)
    expect(await getBlock(page, 0, 62, 0)).toBe(ID.dirt)
    expect(await getBlock(page, 0, 61, 0)).toBe(ID.dirt)
    // DIRT_DEPTH is 3 measured from the grass, so 62/61/60 are dirt and 59 is
    // the first stone-region voxel. Which block it is there is noise-decided
    // (stone, a variant or an ore), so the honest assertion is "solid, and
    // not dirt" rather than pinning a specific id.
    expect(await getBlock(page, 0, 60, 0)).toBe(ID.dirt)
    const below = await getBlock(page, 0, 59, 0)
    expect(below).not.toBe(ID.dirt)
    expect(below).not.toBe(ID.air)

    expect(await getBlock(page, 0, 0, 0)).toBe(ID.bedrock)
    expect(await getBlock(page, 0, -1, 0)).toBe(ID.air)
    expect(await getBlock(page, 17, -1, -23)).toBe(ID.air)
  })

  test('the player comes to rest standing on the grass, not inside it', async ({ page }) => {
    const [x, y, z] = await page.evaluate(() =>
      [...window.noa.ents.getPositionData(window.noa.playerEntity).position])
    expect(y).toBeCloseTo(SURFACE_Y, 2)
    expect(x).toBeCloseTo(0.5, 3)
    expect(z).toBeCloseTo(0.5, 3)
  })

  test('the world renders something other than a blank canvas', async ({ page }) => {
    // Visual by nature: "did WebGL initialise and did terrain mesh" has no
    // honest numeric form from outside the page, so this is the screenshot.
    // The weak version -- asserting a canvas element exists -- passes even
    // when swiftshader never came up, which is exactly the failure it should
    // have caught, so it is deliberately not asserted here.
    await shot(page, 'world-noon')
  })
})
