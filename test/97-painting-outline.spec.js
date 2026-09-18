import { test, expect } from './fixtures.js'
import {
  waitTicks, waitFrames, teleport, look, useGamemode, doubleTapFly,
  getBlock, isFlying, targetedBlock, ID,
} from './helpers/world.js'

/*
 * A PAINTING IS OUTLINED AS A PAINTING, NOT AS ONE OF ITS BLOCKS.
 *
 * THE BUG. A 3x2 painting is six `painting_wall_*` blocks showing ONE picture
 * -- paintingArt.js's whole argument for making it a block at all -- and the
 * selection outline is a function of the block. So the crosshair drew a box
 * around one sixth of a photograph. Honest about the voxel and wrong about the
 * thing, and it disagreed with the consequence: breaking ANY of the six takes
 * the whole painting off the wall.
 *
 * VANILLA HAS NO ANSWER TO COPY, which is worth saying because every other
 * decision in highlight.js is transcribed from one. A vanilla painting is an
 * entity, `renderHitOutline` never runs on one, and what a player sees is the
 * entity's own selection box around the whole rectangle. Same shape, arrived
 * at from the other end.
 *
 * MEASURED, NOT PHOTOGRAPHED. The claim is an extent in blocks, and a
 * screenshot of a black wireframe on a grey wall cannot tell three blocks from
 * one. So this reads the LinesMesh: its vertex bounds for the size, and its
 * position for where the rectangle is anchored. Both halves are needed -- a
 * 3x2 box drawn from the targeted cell is the right size two blocks from where
 * it belongs.
 */

const PY = 200
const CX = -40
const CZ = 70

/** blocks.js: the four painting facings, north first and canonical. */
const PAINTING = { north: 680, south: 681, east: 682, west: 683 }

/** A stone floor in mid-air with a back wall, well away from every other spec. */
async function room(page, r = 6) {
  await useGamemode(page, 'creative')
  if (!await isFlying(page)) await doubleTapFly(page)
  await teleport(page, CX + 0.5, PY + 2, CZ + 0.5)
  await page.waitForFunction(([x, y, z]) => {
    const w = window.noa.world
    const CS = w._chunkSize
    const c = w._storage.getChunkByIndexes(
      Math.floor(x / CS), Math.floor(y / CS), Math.floor(z / CS))
    return !!c && !c.isDisposed
  }, [CX, PY, CZ], { timeout: 20_000 })
  await page.evaluate(([cx, cz, y, rr, stone, air]) => {
    for (let dx = -rr; dx <= rr; dx++) {
      for (let dz = -rr; dz <= rr; dz++) {
        window.noa.setBlock(stone, cx + dx, y, cz + dz)
        for (let dy = 1; dy <= 7; dy++) window.noa.setBlock(air, cx + dx, y + dy, cz + dz)
      }
    }
    // One wall, on the -z side, for a painting to hang on facing south.
    for (let i = -rr; i <= rr; i++) {
      for (let dy = 1; dy <= 6; dy++) window.noa.setBlock(stone, cx + i, y + dy, cz - rr)
    }
  }, [CX, CZ, PY, r, ID.stone, ID.air])
  await waitTicks(page, 4)
}

/* ------------------------------------------------------------------ *
 * 2. The painting outline
 * ------------------------------------------------------------------ */

/**
 * The selection outline as it stands right now: the size of its own geometry,
 * and where that geometry is parked.
 *
 * Read off the LinesMesh rather than screenshotted, because the claim is
 * about extent in blocks and a photograph of a black wireframe on a grey wall
 * cannot measure three blocks from one.
 */
const outline = (page) => page.evaluate(() => {
  const mesh = window.noa.rendering.getScene().getMeshByName('block-highlight')
  if (!mesh || !mesh.isEnabled()) return null
  const p = mesh.getVerticesData('position')
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[i + k]); hi[k] = Math.max(hi[k], p[i + k])
    }
  }
  return {
    vertices: p.length / 3,
    lo, hi,
    size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]],
    // Where the mesh sits, in the same local frame globalToLocal returns.
    position: [mesh.position.x, mesh.position.y, mesh.position.z],
  }
})

/**
 * Point the crosshair at the CENTRE of one cell, from wherever the player is
 * standing, by measuring rather than by guessing a pitch.
 *
 * A hand-picked pitch is how 83-sign-edit's photographs ended up looking over
 * the top of a sign: the eye is 1.6 blocks above the feet `teleport` takes,
 * so "level with the block" is a different angle for every distance. This
 * reads the camera's real target position and solves for the two angles.
 *
 * heading 0 faces +z and pi/2 faces +x (helpers/world.js's HEADING table), so
 * the heading is atan2(dx, dz); pitch is positive DOWNWARD.
 */
const lookAtCell = async (page, cell) => {
  /*
   * TWICE, and that is not superstition. noa's camera target is an entity
   * that FOLLOWS the player rather than being the player, so the frame after
   * a teleport it is still where the player used to be -- and the angles
   * solved from it aim at the old spot. The first pass settles the camera,
   * the second solves against a camera that has stopped moving. Without it
   * this test passed alone and failed as the first test in the file, which is
   * the worst way for a spec to be wrong.
   */
  await aimOnce(page, cell)
  await aimOnce(page, cell)
}

const aimOnce = async (page, [x, y, z]) => {
  const angles = await page.evaluate(([a, b, c]) => {
    const noa = window.noa
    const eye = noa.camera.getTargetPosition
      ? [...noa.camera.getTargetPosition()]
      : (() => {
        const p = [...noa.ents.getPosition(noa.playerEntity)]
        p[1] += noa.ents.getState(noa.camera.cameraTarget, 'followsEntity').offset[1]
        return p
      })()
    const dx = (a + 0.5) - eye[0], dy = (b + 0.5) - eye[1], dz = (c + 0.5) - eye[2]
    return { heading: Math.atan2(dx, dz), pitch: Math.atan2(-dy, Math.hypot(dx, dz)) }
  }, [x, y, z])
  await look(page, angles)
}

/** The anchor cell of a painting, in noa's local frame, for comparison. */
const localOf = (page, [x, y, z]) => page.evaluate(([a, b, c]) => {
  const out = [0, 0, 0]
  window.noa.globalToLocal([a, b, c], null, out)
  return out
}, [x, y, z])

/** 87-paintings' two-step: the blocks, then the art registered on them. */
const hang = (page, [x, y, z], facing, name, id) => page.evaluate(
  ([a, b, c, f, n, blockId]) => {
    const normal = { north: [0, 0, -1], south: [0, 0, 1], west: [1, 0, 0], east: [-1, 0, 0] }[f]
    const right = [-normal[2], 0, normal[0]]
    const v = { millard_north: [3, 2], kebab: [1, 1] }[n]
    for (let u = 0; u < v[0]; u++) {
      for (let h = 0; h < v[1]; h++) {
        window.noa.setBlock(blockId, a + right[0] * u, b + h, c + right[2] * u)
      }
    }
    return window.game.paintings.registerPainting(a, b, c, f, n)
  }, [x, y, z, facing, name, id])

test.describe('a painting is outlined as a painting', () => {
  test('the outline is the whole 3x2 rectangle, anchored at its bottom-left',
    async ({ page }) => {
      await room(page)
      /*
       * A south-facing painting on the -z wall. Its normal is +z, so
       * `viewerRight` is -x and the rectangle grows toward -x and upward from
       * the anchor -- which is why the cell aimed at below is two to the -x
       * and one up, i.e. the far corner from the anchor. Aiming at the anchor
       * itself would let a per-cell outline pass by accident.
       */
      const anchor = [CX + 1, PY + 2, CZ - 5]
      await hang(page, anchor, 'south', 'millard_north', PAINTING.south)
      await waitTicks(page, 3)

      const aimAt = [anchor[0] - 2, anchor[1] + 1, anchor[2]]
      expect(await getBlock(page, ...aimAt), 'the far cell of the painting is missing')
        .toBe(PAINTING.south)

      // Stand back from that cell and aim at its centre.
      await teleport(page, aimAt[0] + 0.5, aimAt[1] - 1, aimAt[2] + 3.5)
      await waitTicks(page, 2)
      await lookAtCell(page, aimAt)
      await waitFrames(page, 3)

      /*
       * THE SAMPLE, and it is two readings. The crosshair is on the cell this
       * test means, and the outline mesh exists at all -- without both, the
       * size assertion below is a measurement of nothing.
       */
      const t = await targetedBlock(page)
      expect(t?.position, 'the crosshair is not on the far cell of the painting')
        .toEqual(aimAt)

      const o = await outline(page)
      expect(o, 'no selection outline is being drawn').not.toBeNull()
      expect(o.vertices, 'the outline mesh has no geometry').toBeGreaterThan(0)

      /*
       * THREE BLOCKS WIDE, TWO TALL, and a sixteenth deep -- the painting,
       * not the cell. Before the fix this read 1 x 1 x 0.0625, which is the
       * mutation: drop the paintingOutline call in highlight.js and the width
       * and height both collapse to 1.
       */
      expect(o.size[0]).toBeCloseTo(3, 5)
      expect(o.size[1]).toBeCloseTo(2, 5)
      expect(o.size[2]).toBeCloseTo(1 / 16, 5)

      /*
       * ...AND IT IS PARKED ON THE ANCHOR, not on the cell under the
       * crosshair. Geometry alone cannot show this: a 3x2 box drawn from the
       * targeted cell is the right size in the wrong place, two blocks off.
       * The tolerance is for highlight.js's VIEW_OFFSET nudge toward the
       * camera, which is distance/4096 and therefore a millimetre here.
       */
      const want = await localOf(page, anchor)
      expect(o.position[0]).toBeCloseTo(want[0], 1)
      expect(o.position[1]).toBeCloseTo(want[1], 1)
      expect(o.position[2]).toBeCloseTo(want[2], 1)
    })

  test('a 1x1 painting and a plain block are still outlined as one cell',
    async ({ page }) => {
      await room(page)
      /*
       * The other half of the rule, and the one that would catch a "paintings
       * are always three wide" fix. A kebab is 1x1, so its rectangle IS its
       * cell and the outline must not grow.
       */
      const anchor = [CX - 3, PY + 2, CZ - 5]
      await hang(page, anchor, 'south', 'kebab', PAINTING.south)
      await waitTicks(page, 3)

      await teleport(page, anchor[0] + 0.5, anchor[1] - 1, anchor[2] + 3.5)
      await waitTicks(page, 2)
      await lookAtCell(page, anchor)
      await waitFrames(page, 3)

      expect((await targetedBlock(page))?.position).toEqual(anchor)
      const o = await outline(page)
      expect(o, 'no selection outline is being drawn').not.toBeNull()
      expect(o.size[0]).toBeCloseTo(1, 5)
      expect(o.size[1]).toBeCloseTo(1, 5)

      /*
       * And a stone block, aimed at immediately afterwards, which is the
       * cache's turn: the outline mesh is rebuilt only when the key changes,
       * so a painting key that failed to change would leave a painting's
       * wireframe floating over a stone wall.
       */
      const stone = [anchor[0] + 6, anchor[1], anchor[2] - 1]
      expect(await getBlock(page, ...stone), 'nothing to aim at').toBe(ID.stone)
      await teleport(page, stone[0] + 0.5, stone[1] - 1, stone[2] + 3.5)
      await waitTicks(page, 2)
      await lookAtCell(page, stone)
      await waitFrames(page, 3)

      expect((await targetedBlock(page))?.position).toEqual(stone)
      const cube = await outline(page)
      expect(cube.size[0]).toBeCloseTo(1, 5)
      expect(cube.size[1]).toBeCloseTo(1, 5)
      expect(cube.size[2]).toBeCloseTo(1, 5)
    })
})
