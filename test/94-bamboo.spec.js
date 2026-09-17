/*
 * Bamboo, the plant, and the one thing this file has to be able to tell
 * apart: a CANE from a CUBE.
 *
 * The report was "bamboo texture is wrong". The texture was fine; the block
 * was `bamboo_block`, the 1.20 wood-set cube, stacked into a pillar. So the
 * assertion that matters is not "is there bamboo" -- a pillar of
 * `bamboo_block` passes that -- it is "is the thing in the world THINNER than
 * a cube", measured in pixels, against a real `bamboo_block` standing beside
 * it in the same shot.
 *
 * Vanilla's numbers are the target: a cane is `Block.box(6.5, 0, 6.5, 9.5,
 * 16, 9.5)`, three pixels of sixteen, so a cane should be about 3/16 of a
 * cube wide. The leaves are `from [0.8, 0, 8] to [15.2, 16, 8]`, 14.4 of
 * sixteen, so a leafy segment should be nearly five times the cane.
 */
import { expect } from '@playwright/test'
import sharp from 'sharp'
import { test } from './fixtures.js'
import {
  SURFACE_Y, resetWorld, setBlock, teleport, look, useGamemode,
} from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * Block ids, typed out rather than imported, for the reason helpers/world.js
 * gives about its own ID table: if somebody renumbers the palette these specs
 * should FAIL rather than quietly follow it. The shape numbers below ARE
 * imported, because those are the thing under test.
 */
const BAMBOO = 684
const BAMBOO_SMALL = 685
const BAMBOO_LARGE = 686
const BAMBOO_V = (v) => 684 + v * 3
const BAMBOO_SAPLING = 696
const BAMBOO_BLOCK = 219   // the 1.20 wood-set cube -- the control
const AIR = 0

const EYE = SURFACE_Y + 1
const E = Math.PI / 2

/*
 * EVERYTHING MEASURABLE IS BUILT IN THE AIR, and the first version of this
 * file was not, which is why the note is here. The default world stopped
 * being superflat -- it is a forest now -- and a pixel test that separates
 * bamboo from sky by "is it green" measures oak canopy instead the moment a
 * tree is behind the subject. Twenty blocks up there is nothing behind these
 * stalks but sky and cloud, and cloud is grey. The thicket shot stays at eye
 * level, because a thicket standing in a forest is what it will actually be.
 *
 * SPECTATOR, and not as a convenience. Teleporting to y+23 and waiting 700 ms
 * for the frame to settle means falling for 700 ms: the first run of this
 * measured three oak trees from the canopy it landed on and reported a cane
 * 22 pixels wide. Spectator is the only thing here that makes "stand still in
 * the air" true rather than approximately true.
 */
const SKY_Y = SURFACE_Y + 20

/** Hang in the air at eye level with a subject, and stay there. */
async function hover(page, x, y, z, heading, pitch = 0) {
  await useGamemode(page, 'spectator')
  await teleport(page, x, y, z)
  await look(page, { heading, pitch })
  await page.waitForTimeout(700)
}

/**
 * Is this pixel BACKGROUND -- sky or cloud?
 *
 * Asked the other way round on purpose. The first version of this asked "is
 * it green", which is the obvious test and quietly excluded the control: a
 * `bamboo_block` face is (230, 215, 130), yellow-green, whose red channel
 * BEATS its green. It scored ten pixels wide next to a cane's fourteen and
 * the ratio came out backwards. Anything that is not sky and not cloud is the
 * subject, which is true of both textures and of nothing behind them.
 */
const isSky = (r, g, b) =>
  b > r + 25 || (Math.abs(r - g) < 18 && Math.abs(g - b) < 18 && r > 140)
const isPlant = (r, g, b) => !isSky(r, g, b)

/** Screenshot and hand back a row-addressable RGB reader. */
async function frame(page) {
  const png = await page.screenshot()
  const { data, info } = await sharp(png).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true })
  return {
    width: info.width,
    height: info.height,
    /** The x of every plant pixel on one row. */
    plantXs(y, x0 = 0, x1 = info.width) {
      const out = []
      for (let x = x0; x < x1; x++) {
        const i = (y * info.width + x) * 4
        if (isPlant(data[i], data[i + 1], data[i + 2])) out.push(x)
      }
      return out
    },
  }
}

/** The widest unbroken run in a sorted list of x coordinates. */
function widestRun(xs) {
  let best = 0, run = 0
  for (let i = 0; i < xs.length; i++) {
    run = i > 0 && xs[i] === xs[i - 1] + 1 ? run + 1 : 1
    if (run > best) best = run
  }
  return best
}

/** Twelve stalks, scattered rather than gridded. */
const THICKET = [
  [6, -5], [7, -2], [6, 1], [8, 4], [9, -6], [10, -1],
  [11, 3], [12, -4], [13, 0], [9, 6], [12, 6], [14, -2],
]

/** Clear a box, so a rerun never measures the previous test's bamboo. */
async function clear(page, [x0, z0], [x1, z1], top = SURFACE_Y + 12) {
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      for (let y = SURFACE_Y; y <= top; y++) await setBlock(page, AIR, x, y, z)
    }
  }
}

/**
 * One stalk, the way `BambooStalkBlock.growBamboo` leaves one: bare cane all
 * the way up, SMALL one below the top, LARGE on top.
 */
async function stalk(page, x, z, height, variant = 0, y0 = SURFACE_Y) {
  const base = BAMBOO_V(variant)
  for (let i = 0; i < height; i++) {
    const id = i === height - 1 ? base + 2 : i === height - 2 ? base + 1 : base
    await setBlock(page, id, x, y0 + i, z)
  }
}

test.describe('bamboo is a plant, not a cube', () => {
  test.beforeEach(async ({ page }) => { await resetWorld(page) })

  test('a cane is a fraction of a cube wide, and its leaves are not',
    async ({ page }) => {
      /*
       * THE CONTROL IS IN THE SAME SHOT. Measuring a cane on its own gives a
       * pixel count that means nothing without a scale, and a scale derived
       * from the FOV is a second thing to get wrong. A `bamboo_block` four
       * blocks to the north is the same distance, the same lens and the same
       * frame, so the ratio is the only number that has to be right.
       */
      await stalk(page, 7, 0, 8, 0, SKY_Y)
      for (let y = 0; y < 8; y++) await setBlock(page, BAMBOO_BLOCK, 7, SKY_Y + y, -4)

      await hover(page, 0.5, SKY_Y + 3, 0.5, E)
      await shot(page, 'bamboo-one-stalk')

      const f = await frame(page)
      /*
       * WHICH WINDOW HOLDS WHICH is asked of the frame rather than assumed.
       * This world's east is -x (blockMeshes.js's FACINGS note), so which
       * side of the crosshair the control lands on is a fact about a
       * convention two files away; splitting the frame down the middle put
       * the cane exactly on the seam the first time this ran. So: find every
       * run on the row, take the one nearest the crosshair as the cane and
       * the widest of the rest as the cube.
       */
      /*
       * Both rows are ABOVE the treetops, which at this altitude means above
       * y = 430 or so in the frame. A row through the forest would measure
       * oak, and asking "is it not sky" makes that failure silent rather than
       * loud -- which is why the windows below are explicit too.
       */
      const half = Math.round(f.height / 2)
      const caneRow = half - 10      // bare cane, below the fronds
      const leafRow = half - 200     // large leaves, near the top

      const runs = (y) => {
        const xs = f.plantXs(y)
        const out = []
        for (const x of xs) {
          const last = out[out.length - 1]
          if (last && x === last.x1 + 1) last.x1 = x
          else out.push({ x0: x, x1: x })
        }
        return out.map(r => ({ ...r, w: r.x1 - r.x0 + 1, c: (r.x0 + r.x1) / 2 }))
      }
      const widest = (rs) => rs.slice().sort((a, b) => b.w - a.w)[0]
      const caneRuns = runs(caneRow)
      const caneRun = widest(caneRuns.filter(r => r.c > 540 && r.c < 740))
      const cubeRun = widest(caneRuns.filter(r => r.c > 800 && r.c < 1100))
      const leafRun = widest(runs(leafRow).filter(r => r.c > 540 && r.c < 740))

      /*
       * ASSERT THE SAMPLE IS NON-EMPTY BEFORE ASSERTING ANYTHING ABOUT IT.
       * A row with nothing on it makes every ratio below NaN, and NaN
       * comparisons are false, which is a test that fails for the right
       * reason by accident and passes for the wrong one whenever somebody
       * flips a `<` to a `>`.
       */
      expect(caneRun, 'nothing on the cane row -- the shot is empty').toBeTruthy()
      expect(cubeRun, 'nothing on the cube row -- the control is missing').toBeTruthy()
      expect(leafRun, 'nothing on the leaf row').toBeTruthy()
      const cube = cubeRun.w, cane = caneRun.w, leaf = leafRun.w

      console.log(`cube ${cube}px  cane ${cane}px  leaf ${leaf}px`)

      // Both are really there. A test that passes because nothing rendered is
      // the failure this repo has hit before.
      expect(cube).toBeGreaterThan(8)
      expect(cane).toBeGreaterThan(1)

      /*
       * 3/16 = 0.1875 is vanilla; measured, it is 14px against 116px = 0.12,
       * the cane being a block further off than the control. The bound is
       * 0.30 -- loose enough for a pixel of antialiasing either side and for
       * the two subjects not being at identical range, tight enough that the
       * cube scores 1.0 and fails by a factor of three. Building the cane as
       * a full cube, which is the bug that started this, reports 1.0.
       */
      expect(cane / cube).toBeLessThan(0.30)

      /*
       * ...and the leaves are 14.4/16 against the cane's 3/16, which is 4.8x.
       * Measured: 67px against 14px, 4.79. A stalk whose leaf planes never
       * got drawn scores 1.0.
       */
      expect(leaf / cane).toBeGreaterThan(2.5)
    })

  test('a dozen stalks do not line up, and do not close into a wall',
    async ({ page }) => {
      /*
       * THE ONLY PLACE ANYONE WILL SEE THIS. A stalk that reads correctly
       * alone and as a green wall in a thicket has failed, so the thicket is
       * the shot that decides it.
       */
      await clear(page, [4, -8], [14, 8])
      let v = 0
      for (const [x, z] of THICKET) {
        await stalk(page, x, z, 6 + (v % 3), v % 4)
        v++
      }
      await setBlock(page, BAMBOO_SAPLING, 8, SURFACE_Y, 0)
      await setBlock(page, BAMBOO_SAPLING, 10, SURFACE_Y, 4)

      await teleport(page, 3.5, EYE, 0.5)
      await look(page, { heading: E, pitch: -0.15 })
      await page.waitForTimeout(700)
      await shot(page, 'bamboo-thicket-close')

      await teleport(page, -6.5, EYE, 0.5)
      await look(page, { heading: E, pitch: -0.12 })
      await page.waitForTimeout(700)
      await shot(page, 'bamboo-thicket-ten-blocks')

      /*
       * A THICKET IS MOSTLY NOT BAMBOO, which is the number that separates a
       * stand of canes from a hedge. Measured on a band above the horizon, so
       * everything green in it is bamboo: twelve stalks across eleven blocks
       * of width should leave most of the sky showing.
       */
      /*
       * MEASURED ON A COPY IN THE SKY, not on the shot above. The two
       * screenshots are evidence and are taken in the forest because that is
       * where bamboo will stand; the coverage number needs a background that
       * is not itself green, so the same twelve stalks are rebuilt twenty
       * blocks up and measured there.
       */
      v = 0
      for (const [x, z] of THICKET) {
        await stalk(page, x, z, 6 + (v % 3), v % 4, SKY_Y)
        v++
      }
      await hover(page, -6.5, SKY_Y + 3, 0.5, E)
      await shot(page, 'bamboo-thicket-against-sky')

      const f = await frame(page)
      const half = Math.round(f.height / 2)
      let plant = 0, total = 0
      for (let y = half - 60; y < half + 60; y += 5) {
        plant += f.plantXs(y, 300, 1000).length
        total += 700
      }
      const cover = plant / total
      console.log(`thicket coverage ${(cover * 100).toFixed(1)}%`)
      expect(cover).toBeGreaterThan(0.02)   // there IS bamboo
      expect(cover).toBeLessThan(0.55)      // and it is not a wall
    })

  test('you walk through bamboo, and you can still aim at it',
    async ({ page }) => {
      await clear(page, [4, -6], [10, 6])
      await stalk(page, 6, 0, 5)
      /*
       * Vanilla COLLIDES (BambooStalkBlock.SHAPE_COLLISION, a 3x16x3 column)
       * and this world does not -- blockMeshes.js's PASS_THROUGH note has the
       * reason, which is that the XZ offset lives in the mesh and not in the
       * box list. Asserted rather than left implicit, because it is a
       * deliberate deviation and the only way anyone finds out that it got
       * quietly reverted is by walking into a stalk.
       */
      await teleport(page, 6.5, SURFACE_Y, 0.5)
      await page.waitForTimeout(400)
      const [x, , z] = await page.evaluate(() => {
        const p = window.noa.entities.getPosition(window.noa.playerEntity)
        return [p[0], p[1], p[2]]
      })
      expect(Math.abs(x - 6.5)).toBeLessThan(0.3)
      expect(Math.abs(z - 0.5)).toBeLessThan(0.3)
    })
})

test.describe('the geometry, without rendering it', () => {
  test('the shapes are vanilla, and the four variants really differ',
    async ({ page }) => {
      const g = await page.evaluate(() => {
        const m = window.__blockMeshes
        return m ? null : null
      })
      // The module is not reachable from the page, so read it in node.
      const { SHAPE_BOXES, SHAPE_ROTATION, BAMBOO_VARIANTS, bambooShapeKey } =
        await import('../src/blockMeshes.js')
      expect(g).toBe(null)

      const cane = SHAPE_BOXES[bambooShapeKey(0, 'none')]
      expect(cane).toHaveLength(1)
      // Block.box(6.5, 0, 6.5, 9.5, 16, 9.5) -- bamboo1_age1.json.
      expect(cane[0]).toEqual([6.5 / 16, 0, 6.5 / 16, 9.5 / 16, 1, 9.5 / 16])

      const leafy = SHAPE_BOXES[bambooShapeKey(0, 'large')]
      expect(leafy).toHaveLength(3)
      // from [0.8, 0, 8] to [15.2, 16, 8], and the same turned a quarter.
      expect(leafy[1]).toEqual([0.8 / 16, 0, 0.5, 15.2 / 16, 1, 0.5])
      expect(leafy[2]).toEqual([0.5, 0, 0.8 / 16, 0.5, 1, 15.2 / 16])

      /*
       * THE OFFSETS ARE THE POINT OF HAVING FOUR IDS. Four variants that all
       * sit at the centre of their cell are four names for one block and a
       * thicket that lines up like a fence, which is the failure this asserts
       * against. Vanilla's ladder spans +/-0.25, so distinct offsets are at
       * least a 16th of a block apart.
       */
      const offs = Array.from({ length: BAMBOO_VARIANTS }, (_, v) =>
        SHAPE_ROTATION[bambooShapeKey(v, 'none')].translate)
      expect(offs).toHaveLength(4)
      for (const [dx, , dz] of offs) {
        expect(Math.abs(dx)).toBeLessThanOrEqual(0.25)
        expect(Math.abs(dz)).toBeLessThanOrEqual(0.25)
      }
      const spread = Math.max(...offs.map(o => o[0])) - Math.min(...offs.map(o => o[0]))
      expect(spread).toBeGreaterThan(0.25)

      /*
       * ...and the UVs are cut before the offset is applied, which is the
       * wall-torch bug wearing bamboo's clothes. The box list is the
       * UNMOVED cane in every variant; only `translate` differs.
       */
      for (let v = 1; v < BAMBOO_VARIANTS; v++) {
        expect(SHAPE_BOXES[bambooShapeKey(v, 'none')][0]).toEqual(cane[0])
      }
    })
})
