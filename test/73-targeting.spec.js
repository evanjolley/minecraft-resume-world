import { test, expect } from './fixtures.js'
import {
  waitTicks, waitFrames, teleport, look, useGamemode, doubleTapFly, setBlock,
  getBlock, eyeHeight, holdMouse, targetedBlock, isFlying, ID, HEADING,
} from './helpers/world.js'
import { shotRegion } from './helpers/shots.js'

/*
 * BLOCK TARGETING IS SUB-VOXEL, and this file is the evidence.
 *
 * Reported from play: "I can click ABOVE a slab and break it. That is not the
 * same as real minecraft. I would have to click the torch itself, not just
 * anywhere in the 1x1x1 box around the torch." Both halves of that are one
 * cause -- noa's picker walked voxels and asked one boolean per voxel, so a
 * cell was either entirely targetable or entirely not, and the block's real
 * shape (which collision has read since non-cube blocks landed) had no say.
 *
 * Vanilla's is `BlockGetter.clip` with `ClipContext.Block.OUTLINE`: the ray is
 * clipped against each block's outline shape, a miss inside a cell KEEPS
 * TRAVERSING, and the hit direction is the shape's face. Read in 1.21.8,
 * cited in src/targeting.js.
 *
 * Most of what follows fires rays directly at `noa.pick` rather than pointing
 * a camera. That is not a shortcut around the real path -- it is the same
 * function the crosshair calls, reached with coordinates that can be written
 * down. "Aim two tenths of a block left of a torch" is a sentence a pitch and
 * a heading cannot say precisely, and the whole claim here is about tenths of
 * a block. The camera path is exercised too, at the bottom, where it has to
 * be: placing a torch on a slab's side and mining a torch are about what the
 * player's own ray does.
 */

/** Mid-air over spawn, the same reasoning as 66-torch.spec.js's room. */
const PY = 200
const CX = -24
const CZ = 64

/*
 * Ids duplicated rather than imported, the convention helpers/world.js states:
 * if someone renumbers the block table these should fail loudly rather than
 * quietly follow along.
 */
const TORCH = 655

/** Where each specimen stands, all on one stone floor at y = PY. */
const CUBE_AT = [CX, PY + 1, CZ]
const SLAB_AT = [CX + 3, PY + 1, CZ]
const STAIR_AT = [CX + 6, PY + 1, CZ]
const TORCH_AT = [CX + 9, PY + 1, CZ]
/** How far in front of each specimen its backstop sits. */
const BACKSTOP = 3

/**
 * Fire a ray at the picker and report it the way noa's own per-frame
 * targeting does: floor the returned point for the adjacent cell, subtract
 * the normal for the block itself. Reproducing that arithmetic rather than
 * reading `noa.targetedBlock` is what lets a test aim somewhere the camera
 * cannot be pointed.
 */
const pick = (page, from, dir) => page.evaluate(([f, d]) => {
  const noa = window.noa
  const r = noa.pick(f, d, 12, noa.blockTargetIdCheck)
  if (!r) return null
  const adjacent = r.position.map(Math.floor)
  const normal = [...r.normal]
  return {
    cell: adjacent.map((a, i) => a - normal[i]),
    adjacent,
    normal,
    id: noa.getBlock(...adjacent.map((a, i) => a - normal[i])),
  }
}, [from, dir])

/*
 * Creative flight, re-established per test.
 *
 * The `page` fixture resets the gamemode between tests, so the flight the
 * beforeAll switched on is gone by the time any of these run -- and without
 * it a teleport into open air is a fall, which drags the crosshair off the
 * thing the test just aimed at. Every camera test starts here.
 */
async function hover(page, x, y, z) {
  await useGamemode(page, 'creative')
  // doubleTapFly TOGGLES. Called blind on a player who is already flying it
  // turns flight off, and the symptom is that every OTHER aim in a test works
  // -- which is exactly how this was found.
  if (!await isFlying(page)) await doubleTapFly(page)
  const eh = await eyeHeight(page)
  await teleport(page, x, y - eh, z)
  await look(page, { heading: HEADING.southPlusZ, pitch: 0 })
  await waitTicks(page, 3)
}

/** Fly to the rig and wait for its chunk, then build. See 66-torch for why. */
async function buildRig(page) {
  await useGamemode(page, 'creative')
  await doubleTapFly(page)
  await teleport(page, CX + 0.5, PY + 3, CZ + 0.5)
  await page.waitForFunction(([x, y, z]) => {
    const w = window.noa.world
    const CS = w._chunkSize
    const c = w._storage.getChunkByIndexes(
      Math.floor(x / CS), Math.floor(y / CS), Math.floor(z / CS))
    return !!c && !c.isDisposed
  }, [CX, PY, CZ], { timeout: 20_000 })

  await page.evaluate(async ([cx, py, cz, backstop]) => {
    const noa = window.noa
    const { BLOCK_TYPES } = await import('/src/blocks.js')
    const id = k => BLOCK_TYPES.find(d => d.key === k).id
    /*
     * A wall of backstops behind the specimens, and NO FLOOR.
     *
     * The backstop is the whole point of the first assertion: "the ray
     * carried on" is only checkable if there is something for it to carry on
     * TO. The missing floor is just as deliberate -- every camera test below
     * has to put the player's EYE at a specific height, and an eye height is
     * a foot height minus 1.62, which for a specimen sitting on a floor is
     * inside the floor. Flying in open air is the only way to aim a level
     * crosshair at something a block and a half off the ground.
     */
    for (let x = -2; x <= 12; x++) {
      noa.world.setBlockID(3, cx + x, py + 1, cz + backstop)
      noa.world.setBlockID(3, cx + x, py + 2, cz + backstop)
    }
    // The one exception: a torch needs a block under it or attachment.js
    // breaks it off the moment it is placed.
    noa.world.setBlockID(3, cx + 9, py, cz)
    noa.world.setBlockID(3, cx, py + 1, cz)                       // full cube
    noa.world.setBlockID(id('oak_slab'), cx + 3, py + 1, cz)      // bottom slab
    noa.world.setBlockID(id('oak_stairs'), cx + 6, py + 1, cz)    // south, bottom
    noa.world.setBlockID(id('torch'), cx + 9, py + 1, cz)         // floor torch
  }, [CX, PY, CZ, BACKSTOP])
  await waitTicks(page, 4)
}

test.describe('the crosshair hits the shape, not the cell', () => {
  test.beforeAll(async ({ world }) => {
    await buildRig(world.page)
  })

  test('the rig is actually there', async ({ page }) => {
    /*
     * A probe that passed on an empty sample has shipped from this repo
     * before. Everything below asserts what a ray did NOT hit, which is
     * exactly the shape of claim that passes vacuously in an empty world, so
     * the sample is checked first and the rest of the file is worthless
     * without it.
     */
    expect(await getBlock(page, ...CUBE_AT)).toBe(ID.stone)
    expect(await getBlock(page, ...TORCH_AT)).toBe(TORCH)
    // The slab and the stair by SHAPE rather than by id: the ids are
    // generated per wood and per half, so a literal here would be a number
    // nobody could check against blocks.js by eye.
    const shapes = await page.evaluate(async (cells) => {
      const { BLOCK_BY_ID } = await import('/src/blocks.js')
      return cells.map(c => BLOCK_BY_ID.get(window.noa.getBlock(...c))?.shape ?? null)
    }, [SLAB_AT, STAIR_AT])
    expect(shapes).toEqual(['slab_bottom', 'stairs_north_bottom'])
    expect(await getBlock(page, SLAB_AT[0], SLAB_AT[1], SLAB_AT[2] + BACKSTOP))
      .toBe(ID.stone)
  })

  test('a ray through the air above a slab reaches the block behind it',
    async ({ page }) => {
      const [x, y, z] = SLAB_AT
      /*
       * THE REPORTED BUG, as two rays three quarters of a block apart.
       *
       * Both travel down the same line of cells and both pass through the
       * slab's cell. The high one goes over the slab (which is half a block
       * tall) and must come out the other side; the low one goes into it.
       */
      const over = await pick(page, [x + 0.5, y + 0.75, z - 2], [0, 0, 1])
      expect(over, 'nothing was hit at all -- is the backstop there?').not.toBeNull()
      expect(over.cell, `aiming above the slab targeted ${JSON.stringify(over)}`)
        .toEqual([x, y, z + BACKSTOP])

      const into = await pick(page, [x + 0.5, y + 0.25, z - 2], [0, 0, 1])
      expect(into.cell, 'aiming at the slab missed it').toEqual([x, y, z])
      // The face the SHAPE presented, which for a side hit is the same face a
      // cube would have shown. The interesting normals are below.
      expect(into.normal).toEqual([0, 0, -1])
    })

  test('a ray beside a torch reaches the block behind it', async ({ page }) => {
    const [x, y, z] = TORCH_AT
    /*
     * Vanilla's torch outline is box(6, 0, 6, 10, 10, 10) -- four pixels
     * wide, centred. 0.2 across the cell is outside it and 0.5 is dead
     * centre, so these two rays are 0.3 of a block apart and must disagree.
     */
    const past = await pick(page, [x + 0.2, y + 0.3, z - 2], [0, 0, 1])
    expect(past, 'nothing was hit at all').not.toBeNull()
    expect(past.cell, `aiming beside the torch targeted ${JSON.stringify(past)}`)
      .toEqual([x, y, z + BACKSTOP])

    const hit = await pick(page, [x + 0.5, y + 0.3, z - 2], [0, 0, 1])
    expect(hit.cell, 'aiming at the torch missed it').toEqual([x, y, z])
    expect(hit.id, 'the torch is not targetable any more').toBe(TORCH)
  })

  test('a ray over a torch reaches the block behind it', async ({ page }) => {
    // The other half of the report: the cell is 1.0 tall and the torch is
    // 0.625, so there is a third of a block of nothing above it.
    const [x, y, z] = TORCH_AT
    const over = await pick(page, [x + 0.5, y + 0.8, z - 2], [0, 0, 1])
    expect(over.cell, `aiming over the torch targeted ${JSON.stringify(over)}`)
      .toEqual([x, y, z + BACKSTOP])
  })

  test('the hit normal is the face of the shape, not the face of the cell',
    async ({ page }) => {
      const [x, y, z] = SLAB_AT
      /*
       * Straight down onto a bottom slab. The shape's face is its top at
       * y + 0.5, which is INSIDE the cell -- the cell's own top face is at
       * y + 1 and the ray crossed it without touching anything.
       *
       * `adjacent` is what a placement lands in and is the reason this
       * matters beyond bookkeeping: it must be the cell above the slab, not
       * the slab's own cell, and getting there means the picker handed noa a
       * point that floors into the right place. Vanilla agrees -- clicking
       * the top of a bottom slab gives Direction.UP and places above it.
       */
      const above = await pick(page, [x + 0.5, y + 4, z + 0.5], [0, -1, 0])
      expect(above.cell).toEqual([x, y, z])
      expect(above.normal).toEqual([0, 1, 0])
      expect(above.adjacent).toEqual([x, y + 1, z])

      // And the stair's tread, which is the same claim on a two-box shape:
      // the top of the LOW box, reached by a ray that went past the tall one.
      const [sx, sy, sz] = STAIR_AT
      const tread = await pick(page, [sx + 0.5, sy + 4, sz + 0.75], [0, -1, 0])
      expect(tread.cell).toEqual([sx, sy, sz])
      expect(tread.normal).toEqual([0, 1, 0])
      expect(tread.adjacent).toEqual([sx, sy + 1, sz])

      /*
       * THE NORMAL THAT A CELL-GRANULAR PICKER CANNOT PRODUCE, and the only
       * one of these that is really a discriminator on its own.
       *
       * This ray comes in shallow from in front and above: it crosses into
       * the slab's cell through the cell's -z SIDE face, a tenth of a block
       * above the slab, and only then descends onto the slab's TOP. noa's
       * picker reports the face of the cell it entered, so it would answer
       * [0, 0, -1] and hang a wall torch off the front. The answer has to be
       * [0, 1, 0], and `adjacent` has to be the cell above.
       */
      const grazed = await pick(page, [x + 0.5, y + 1.5, z - 0.9], [0, -1, 1])
      expect(grazed.cell, JSON.stringify(grazed)).toEqual([x, y, z])
      expect(grazed.normal, `entered through the side, hit the top: ${JSON.stringify(grazed)}`)
        .toEqual([0, 1, 0])
      expect(grazed.adjacent).toEqual([x, y + 1, z])
    })

  test('a torch is still targetable and still minable', async ({ page }) => {
    /*
     * THE REGRESSION THIS FILE IS MOST LIKELY TO CATCH. A torch opts out of
     * COLLISION (blockMeshes.js's PASS_THROUGH_SHAPES) and the collision
     * table is the one the physics resolver reads. Targeting reads a second
     * view of the same table with those holes filled back in, and the day
     * someone hands the picker the collision view instead, torches become
     * unmineable and this is what says so.
     *
     * Driven by the camera, not by pick(): the claim is about the player's
     * own ray reaching it, and about interact.js still running a break timer.
     */
    const [x, y, z] = TORCH_AT
    await hover(page, x + 0.5, y + 0.3, z - 1.6)

    const target = await targetedBlock(page)
    expect(target, 'the crosshair is on nothing').not.toBeNull()
    expect(target.blockID, `the crosshair is on ${JSON.stringify(target)}`).toBe(TORCH)

    /*
     * Broken in creative, which is one click rather than a timer. The timer
     * itself is 06-mining's subject and is not what could regress here; what
     * could regress is the torch being unreachable, and a break that lands at
     * all proves the whole path -- pick, targetedBlock, interact.js, the
     * authority -- still reaches it.
     */
    await holdMouse(page, 150)
    expect(await getBlock(page, x, y, z), 'the torch survived being mined').toBe(ID.air)
    await setBlock(page, TORCH, x, y, z)
    await waitTicks(page, 2)
  })

  test('what is placed against a block comes from the face and the height hit',
    async ({ page }) => {
      /*
       * THE NORMAL AND THE SUB-VOXEL HIT HEIGHT, END TO END.
       *
       * installPlacementOrientation resolves a wall torch's facing from
       * `targetedBlock.normal` and a slab's half from `_pickResult.position`,
       * and both of those now come out of a picker this change rewrote. A
       * unit test can fake them -- 17-non-cube.spec.js does exactly that --
       * so what is worth doing here is the part it cannot: aiming a real
       * camera and checking what the real pick handed downstream.
       *
       * Aimed eight tenths up the cube's -z face. A picker that reported the
       * CENTRE of the struck cell would say 0.5 and place a bottom slab; a
       * picker that lost the fraction to its own adjacency arithmetic would
       * do the same. Only the true hit height gives a top slab.
       *
       * AGAINST THE FULL CUBE, not the slab, and the reason is worth writing
       * down because the obvious test does not exist: a torch cannot hang on
       * a slab here at all. installAttachment asks noa for the support
       * block's SOLIDITY, and every non-cube registers solid:false so its own
       * collision can be hand-rolled -- so a slab supports nothing. Vanilla
       * refuses the same placement for a better reason (a bottom slab's side
       * is not a sturdy face), so the behaviour is right and the mechanism is
       * a coincidence. Worth its own look one day; not this change.
       */
      const [x, y, z] = CUBE_AT
      await hover(page, x + 0.5, y + 0.8, z - 1.6)

      const target = await targetedBlock(page)
      expect(target, 'the crosshair is on nothing').not.toBeNull()
      expect(target.position, `aimed at the cube, got ${JSON.stringify(target)}`)
        .toEqual([x, y, z])
      expect(target.adjacent).toEqual([x, y, z - 1])

      const place = async (key) => {
        await page.evaluate(async (k) => {
          const { BLOCK_TYPES } = await import('/src/blocks.js')
          const inv = window.game.inventory
          const id = BLOCK_TYPES.find(d => d.key === k).id
          inv.add(id, 8)
          // `add` fills the first FREE slot, so the second call in this test
          // lands in slot 1 and selecting 0 blind would place the leftovers
          // of the first. Found the hard way: a torch that came out a slab.
          inv.select(inv.slots.findIndex(s => s && s.id === id))
        }, key)
        await waitTicks(page, 2)
        await holdMouse(page, 120, 'right')
        await waitTicks(page, 3)
        const id = await getBlock(page, x, y, z - 1)
        const shape = await page.evaluate(async (i) => {
          const { BLOCK_BY_ID } = await import('/src/blocks.js')
          return BLOCK_BY_ID.get(i)?.shape ?? null
        }, id)
        await setBlock(page, ID.air, x, y, z - 1)
        await waitTicks(page, 2)
        return { id, shape }
      }

      const slab = await place('oak_slab')
      expect(slab.shape, `clicking high on a side face placed ${slab.id}`)
        .toBe('slab_top')

      /*
       * north = -z in this world (see the FACINGS note in blockMeshes.js), and
       * a wall torch's facing names the way it POINTS, away from the wall
       * holding it. We hit the cube's -z face, so the torch points -z.
       */
      const torch = await place('torch')
      expect(torch.shape, `placing against the cube gave block ${torch.id}`)
        .toBe('torch_wall_north')
    })
})

/*
 * The outline, which is the other half of the report: "HITBOXES when hovering
 * over a block are currently only on the side you're facing, like a 2d
 * hitbox."
 *
 * Screenshots rather than assertions, and deliberately so -- helpers/shots.js
 * states the rule. "The wireframe traces the shape" is a claim about a picture
 * and the honest way to check it is to look at the picture. What CAN be
 * asserted without eyes is asserted: that noa's own one-face plane is gone,
 * and that the mesh we draw instead has the right number of line segments for
 * the shape being looked at, which is the difference between a cube's twelve
 * edges and a stair's twenty-four.
 */
test.describe('the selection outline traces the block', () => {
  test.beforeAll(async ({ world }) => {
    await buildRig(world.page)
  })

  /** Stand back and look at one specimen, then photograph the crosshair. */
  async function photograph(page, [x, y, z], name) {
    // Far enough back that the whole block fits in the crop. At 2.6 blocks a
    // cube overflows a 160px crosshair crop entirely and the picture shows a
    // wall of texture with no edges in it, which is a photograph of nothing.
    await hover(page, x + 0.5, y + 0.5, z - 4.5)
    await waitFrames(page, 3)
    await shotRegion(page, name, 'centre')
    return page.evaluate(() => {
      const noa = window.noa
      const mesh = noa.rendering.getScene().meshes.find(m => m.name === 'block-highlight')
      return {
        targeted: noa.targetedBlock ? [...noa.targetedBlock.position] : null,
        id: noa.targetedBlock ? noa.targetedBlock.blockID : 0,
        enabled: !!mesh && mesh.isEnabled(),
        // Two vertices per segment. A box is 12 segments; noa's plane was 1
        // quad's worth of outline and 4 vertices of fill.
        vertices: mesh ? mesh.getTotalVertices() : 0,
        // noa's own highlight plane must never have been built at all.
        noaPlane: !!noa.rendering._highlightMesh,
      }
    })
  }

  test('a full block, a slab, a stair and a torch each get their own wireframe',
    async ({ page }) => {
      const cube = await photograph(page, CUBE_AT, 'targeting-outline-cube')
      const slab = await photograph(page, SLAB_AT, 'targeting-outline-slab')
      const stair = await photograph(page, STAIR_AT, 'targeting-outline-stair')
      const torch = await photograph(page, TORCH_AT, 'targeting-outline-torch')
      const all = JSON.stringify({ cube, slab, stair, torch })

      for (const [name, got] of Object.entries({ cube, slab, stair, torch })) {
        expect(got.enabled, `looking at the ${name} drew no outline -- ${all}`).toBe(true)
        expect(got.noaPlane, `noa's own highlight plane was built -- ${all}`).toBe(false)
      }
      expect(cube.id, all).toBe(ID.stone)
      expect(torch.id, all).toBe(TORCH)

      /*
       * One box is four uprights of 2 vertices plus two rings of 5, which is
       * 8 + 10 = 18 vertices. A stair is two boxes and so exactly double.
       * Asserting the count rather than the picture is what makes "the stair
       * outlines BOTH its boxes" a thing a machine can check.
       */
      expect(cube.vertices, all).toBe(18)
      expect(slab.vertices, all).toBe(18)
      expect(torch.vertices, all).toBe(18)
      expect(stair.vertices, `a stair is two boxes -- ${all}`).toBe(36)
    })
})
