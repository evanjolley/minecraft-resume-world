import { test, expect } from './fixtures.js'
import {
  waitTicks, waitFrames, teleport, look, useGamemode, doubleTapFly, setBlock,
  getBlock, isFlying, ID,
} from './helpers/world.js'
import { shot, shotRegion } from './helpers/shots.js'

/*
 * SIXTEEN ROTATIONS, which is Evan's fourth report on signs:
 *
 *   "4. only bidrection, should face based on the angle I place them at."
 *
 * ("bidrection" is four directions seen from the front, and he is right about
 * the symptom either way: a sign planted while facing north-east squared up
 * to north.)
 *
 * Vanilla stores ROTATION 0..15 and picks it as
 * `RotationSegment.convertToSegment(getRotation() + 180)`, which is
 * `Math.round(deg * 16/360) & 15` on the player's yaw turned half way round.
 * Sixteen ids here, one per segment, and segment s faces along noa's forward
 * at s * 22.5 degrees.
 *
 * WHAT THIS FILE HAS TO PROVE, and the third one is the whole reason sixteen
 * was declined the first time:
 *
 *   1. SIXTEEN, not four. Sixteen headings must give sixteen ids, and the
 *      off-axis ones must be genuinely off-axis -- a board turned 22.5
 *      degrees is wide in x AND in z, which no axis-aligned board ever is.
 *
 *   2. THE HALF TURN SURVIVED. A sign faces back at whoever planted it, and
 *      that fact used to live in a map of compass opposites. It moved into an
 *      angle, which is precisely the kind of move that flips a sign 180
 *      degrees and passes every test that only counts rotations.
 *
 *   3. THE OUTLINE AND THE PICK AGREE. blockMeshes.js's old note called a
 *      rotated shape "the one thing in this file whose collision and hitbox
 *      must be declared apart from its mesh". They agree here for a reason
 *      worth asserting rather than trusting: vanilla's sign outline is ONE
 *      axis-aligned constant shared by all sixteen states, and highlight.js
 *      and targeting.js read the same `targetShapeBoxesFor`. Both halves are
 *      checked -- that the table says one box sixteen times, and that a real
 *      pick at a real 22.5-degree sign lands on it and draws a wireframe.
 *
 * Ids duplicated rather than imported, the suite's rule: a renumber should
 * fail here loudly. It already did once -- see the note in 76-signs.
 */
const SIGN_BASE = 660
const SEGMENTS = 16
/** The four segments that have compass names, and this world's names. */
const NAMED = { south: 0, west: 4, north: 8, east: 12 }

const PY = 200
const CX = 40
const CZ = 20

/** noa's forward, which is what a segment's board normal is built from. */
const forward = (h) => [Math.sin(h), 0, Math.cos(h)]

/** A stone floor in mid-air. 76-signs' room, without the wall. */
async function signFloor(page, r = 8) {
  await useGamemode(page, 'creative')
  // doubleTapFly TOGGLES, so calling it blind on a player who is already
  // flying turns flight OFF -- 73-targeting records finding that the hard way.
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
        for (let dy = 1; dy <= 6; dy++) window.noa.setBlock(air, cx + dx, y + dy, cz + dz)
      }
    }
  }, [CX, CZ, PY, r, ID.stone, ID.air])
  await waitTicks(page, 4)
}

/**
 * The world-space bounding box of a block id's mesh, in block pixels, plus
 * the distinct face normals in it. 76-signs' meshBox with the normals added,
 * because a rotated board's ORIENTATION is the thing at issue and a bounding
 * box alone cannot tell 22.5 degrees from 67.5.
 */
const meshOf = (page, id) => page.evaluate((blockId) => {
  const mesh = window.noa.registry._blockMeshLookup[blockId]
  if (!mesh) return null
  const p = mesh.getVerticesData('position')
  const n = mesh.getVerticesData('normal')
  if (!p) return null
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[i + k]); hi[k] = Math.max(hi[k], p[i + k])
    }
  }
  /*
   * The horizontal normals in the mesh, ranked by how much AREA carries each.
   *
   * By area and not by vertex count, which is the version of this that was
   * written first and was wrong: every quad is four vertices whatever its
   * size, so counting vertices made the board's 16x8 face and the post's
   * 4/3 x 28/3 face tie, and the answer came out of emit order.
   *
   * WHICH WAY THE BOARD FACES is deliberately not answered here. The board's
   * front and back are the same area, so no measurement of this mesh can
   * separate them -- and it does not need to: the mesh's claim is the AXIS
   * the board lies across, and which way along it a sign faces is settled by
   * the placement test above, which is the only place the question has a
   * player in it.
   */
  const idx = mesh.getIndices()
  const area = new Map()
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]]
    if (Math.abs(n[a * 3 + 1]) > 0.01) continue
    const u = [p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]]
    const v = [p[c * 3] - p[a * 3], p[c * 3 + 1] - p[a * 3 + 1], p[c * 3 + 2] - p[a * 3 + 2]]
    const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const k = `${n[a * 3].toFixed(4)},${n[a * 3 + 2].toFixed(4)}`
    area.set(k, (area.get(k) ?? 0) + Math.hypot(...cr) / 2)
  }
  const normals = [...area.entries()].sort((x, y) => y[1] - x[1])
    .map(([k, a]) => ({ n: k.split(',').map(Number), area: a }))
  // Mesh space puts x and z at -0.5..0.5 and y at 0..1; blocks.js's boxes are
  // 0..1. Shifted back, then to pixels, the way 76-signs reads them.
  return {
    lo: [(lo[0] + 0.5) * 16, lo[1] * 16, (lo[2] + 0.5) * 16],
    hi: [(hi[0] + 0.5) * 16, hi[1] * 16, (hi[2] + 0.5) * 16],
    normals,
  }
}, id)

/**
 * Plant a sign by LOOKING and writing the canonical id, which is what a
 * hotbar click does. The canonical is the only id
 * installPlacementOrientation rewrites, so this is the whole placement path
 * and not a shortcut past it.
 */
async function plant(page, heading, [x, y, z]) {
  await setBlock(page, ID.stone, x, y - 1, z)
  await look(page, { heading, pitch: 0.3 })
  await page.evaluate(([id, bx, by, bz]) => {
    window.noa.targetedBlock = { normal: [0, 1, 0], position: [bx, by - 1, bz] }
    window.noa._pickResult.position[1] = by
    window.noa.setBlock(id, bx, by, bz)
  }, [SIGN_BASE, x, y, z])
  return getBlock(page, x, y, z)
}

/**
 * Plant a sign that FACES a given segment, by looking from where its reader
 * will stand.
 *
 * The half turn is right here in the arithmetic, which is the point: to get a
 * board facing segment s you look along segment s + 8, because a sign faces
 * back at you. Writing it out rather than hiding it behind a constant is what
 * makes the two callers below readable -- and it is the same `+ 180` vanilla
 * applies in `convertToSegment(getRotation() + 180)`.
 */
async function plantFacing(page, segment, pos) {
  const step = (Math.PI * 2) / SEGMENTS
  return plant(page, ((segment + SEGMENTS / 2) % SEGMENTS) * step, pos)
}

test.describe('a sign takes the angle it was planted at', () => {
  test('sixteen headings give sixteen different signs', async ({ page }) => {
    await signFloor(page)

    /*
     * Headings spaced a sixteenth of a turn apart, each landing in the MIDDLE
     * of its own bucket rather than on a boundary -- on a boundary the
     * rounding is a coin flip and a failure would be about float noise
     * instead of about the feature.
     */
    const step = (Math.PI * 2) / SEGMENTS
    const placed = []
    for (let i = 0; i < SEGMENTS; i++) {
      const id = await plant(page, i * step, [CX - 6 + i, PY + 1, CZ + 5])
      placed.push({ i, heading: i * step, id })
    }

    // The sample, before anything is concluded from it.
    expect(placed).toHaveLength(SEGMENTS)
    expect(placed.every(p => p.id >= SIGN_BASE && p.id < SIGN_BASE + SEGMENTS),
      JSON.stringify(placed)).toBe(true)

    // Sixteen headings, sixteen DISTINCT signs. Four rotations passed the old
    // version of this by giving four ids sixteen times.
    const distinct = new Set(placed.map(p => p.id))
    expect(distinct.size, JSON.stringify(placed)).toBe(SEGMENTS)

    /*
     * AND THE HALF TURN. For each one, the board's normal must point back
     * along the direction the player was looking -- not merely be different
     * from its neighbours. This is the assertion that catches a sign family
     * that turns sixteen ways and faces all of them backwards.
     */
    for (const { heading, id } of placed) {
      const seg = id - SIGN_BASE
      const n = forward(seg * step)
      const f = forward(heading)
      const dot = n[0] * f[0] + n[2] * f[2]
      expect(dot, `heading ${heading.toFixed(3)} -> segment ${seg} faces the wrong way`)
        .toBeLessThan(-0.9)
    }
  })

  test('the four compass segments are exactly where they always were',
    async ({ page }) => {
      /*
       * The four that had names before sixteen landed, checked against the
       * numbers 76-signs has asserted since signs shipped: a board one block
       * wide, 4/3 of a pixel thick, and exactly axis-aligned. If the sixteen
       * are a quarter turn out of step, or a half, these four are the four
       * that say so in whole numbers rather than in decimals.
       */
      const seen = []
      for (const [name, seg] of Object.entries(NAMED)) {
        const mesh = await meshOf(page, SIGN_BASE + seg)
        expect(mesh, `no mesh for ${name} (segment ${seg})`).not.toBeNull()
        const want = forward(seg * (Math.PI * 2) / SEGMENTS)
        /*
         * The two biggest horizontal faces in the mesh are the board's front
         * and back, and both must be perpendicular to the board -- i.e.
         * parallel to the segment's own vector. Checked as |dot| so the front
         * and back are the same assertion.
         */
        for (const { n } of mesh.normals.slice(0, 2)) {
          const dot = n[0] * want[0] + n[1] * want[2]
          expect(Math.abs(dot), `${name}: a board face is not square to it`)
            .toBeCloseTo(1, 9)
        }
        // Exactly axis-aligned, not 1e-16 away from it. segmentNormal snaps
        // sin(PI) to zero for precisely this reason.
        const face = mesh.normals[0].n
        expect(Math.abs(face[0]) % 1, name).toBeCloseTo(0, 12)
        expect(Math.abs(face[1]) % 1, name).toBeCloseTo(0, 12)
        seen.push(name)
      }
      expect(seen).toHaveLength(4)

      // South (segment 0) is the canonical, so it is the one whose board must
      // span x and be thin in z. 76-signs asserts this pair too; here it is
      // the anchor the other twelve are measured against.
      const south = await meshOf(page, SIGN_BASE + NAMED.south)
      expect(south.hi[0] - south.lo[0]).toBeCloseTo(16, 5)
      expect(south.hi[2] - south.lo[2]).toBeCloseTo(4 / 3, 5)
    })

  test('an off-axis sign is genuinely off-axis', async ({ page }) => {
    /*
     * The twelve that are new. A board turned 22.5 degrees has no thin axis
     * at all: its footprint is wide in x AND in z, and its width is
     * 16*cos(22.5) + (4/3)*sin(22.5) on both. Asserting the exact number
     * rather than "wider than 4/3" is what distinguishes a real 22.5-degree
     * turn from a 45-degree one, which would also be wide on both.
     */
    const rad = (deg) => (deg * Math.PI) / 180
    const spanFor = (deg) => 16 * Math.abs(Math.cos(rad(deg))) + (4 / 3) * Math.abs(Math.sin(rad(deg)))

    let checked = 0
    for (const seg of [1, 2, 3, 5, 7, 9, 11, 13, 15]) {
      const mesh = await meshOf(page, SIGN_BASE + seg)
      expect(mesh, `no mesh for segment ${seg}`).not.toBeNull()
      const deg = seg * 22.5
      /*
       * The board lies ACROSS the segment's vector, so its x extent is the
       * 16-pixel width projected on x -- 16*|cos| -- plus the thickness
       * projected the other way. z is the same sum with sin and cos swapped,
       * which is spanFor(deg + 90).
       */
      expect(mesh.hi[0] - mesh.lo[0], `segment ${seg} x span`)
        .toBeCloseTo(spanFor(deg), 4)
      expect(mesh.hi[2] - mesh.lo[2], `segment ${seg} z span`)
        .toBeCloseTo(spanFor(deg + 90), 4)
      // Neither axis is the thin one, which is the whole difference from four.
      expect(mesh.hi[0] - mesh.lo[0], `segment ${seg} is axis-aligned in x`)
        .toBeGreaterThan(4 / 3 + 0.01)
      expect(mesh.hi[2] - mesh.lo[2], `segment ${seg} is axis-aligned in z`)
        .toBeGreaterThan(4 / 3 + 0.01)

      /*
       * AND WHICH WAY IT TURNED, which the spans cannot say: |cos| and |sin|
       * are the same at +22.5 and -22.5, so a sign family that rotated the
       * wrong way round would pass every line above it.
       *
       * Found by running the mutation rather than by reading the code --
       * negating `deg` in blockMeshes.js's signRotation left this whole file
       * green, and the damage it does is real: the mesh would face one way
       * while signText.js put the words on the other side of the board.
       *
       * The four COMPASS segments still cannot catch it and never will. A
       * board is symmetric under a half turn, so negating segment 4 produces
       * segment 12's mesh, which is geometrically the same object -- there is
       * nothing there to observe. The off-axis twelve are where the sign of
       * the angle becomes visible, which is one more thing four rotations
       * could not have told us.
       */
      const want = forward((deg * Math.PI) / 180)
      for (const { n } of mesh.normals.slice(0, 2)) {
        const dot = n[0] * want[0] + n[1] * want[2]
        // Precision 3, not 9: meshOf keys its normals to four decimals so two
        // faces of one plane land in one bucket, which caps how exact a dot
        // product built from them can be. Mutation B lands at 0.707, so three
        // decimals is four orders of magnitude of headroom.
        expect(Math.abs(dot), `segment ${seg} turned the wrong way`).toBeCloseTo(1, 3)
      }
      checked++
    }
    // A loop that ran zero times would have proved nothing above.
    expect(checked).toBe(9)
  })

  test('every rotation is aimed at through the same box, and the outline is that box',
    async ({ page }) => {
      /*
       * HALF ONE: the table. Vanilla's SignBlock.SHAPE is box(4,0,4,12,16,12),
       * one constant with no rotateHorizontal around it, shared by all sixteen
       * states. So every standing sign here declares the identical outline --
       * which is what makes a rotated sign's hitbox honest without deriving
       * anything from a rotated mesh.
       */
      const VANILLA = [4 / 16, 0, 4 / 16, 12 / 16, 1, 12 / 16]
      const boxes = await page.evaluate(([base, n]) => {
        const out = []
        for (let s = 0; s < n; s++) {
          out.push({
            s,
            target: window.game.shapes.targetShapeBoxesFor(base + s) ?? null,
            // Pass-through: there is no collider at all to disagree with the
            // mesh, which is the other half of why sixteen is affordable.
            collide: window.game.shapes.shapeBoxesFor(base + s) ?? null,
          })
        }
        return out
      }, [SIGN_BASE, SEGMENTS])

      expect(boxes).toHaveLength(SEGMENTS)
      for (const { s, target, collide } of boxes) {
        expect(target, `segment ${s} declares no outline`).not.toBeNull()
        expect(target, `segment ${s} outline`).toHaveLength(1)
        for (let k = 0; k < 6; k++) {
          expect(target[0][k], `segment ${s} outline component ${k}`)
            .toBeCloseTo(VANILLA[k], 9)
        }
        expect(collide, `segment ${s} collides, and a sign must not`).toBeNull()
      }

      /*
       * HALF TWO: the pick. A table agreeing with itself is not the claim --
       * the claim is that the crosshair finds a 22.5-degree sign and the
       * wireframe drawn round it is the box the crosshair used. highlight.js
       * and targeting.js both read targetShapeBoxesFor, so this is checking
       * that the wiring is real, not that two numbers are equal.
       */
      await signFloor(page)
      const [x, y, z] = [CX, PY + 1, CZ - 3]
      const id = await plantFacing(page, 2, [x, y, z])
      expect(id, 'the specimen is not an off-axis sign').toBe(SIGN_BASE + 2)

      /*
       * AIM DOWN AT THE BOARD rather than standing level with it.
       *
       * The board spans y + 0.58 .. y + 1.08 and a standing player's eye is
       * 1.62 above their feet, so a camera on the same floor looks OVER the
       * top -- the mistake 76-signs records finding in its own photographs.
       * The obvious fix, flying the feet down until the eye lines up, puts
       * the body inside the floor, where the physics ejects it and the
       * crosshair ends up on the stone under its own boots. (Both were tried;
       * this is the third version.) A small downward pitch costs nothing and
       * has no body in it: atan(0.8 / 3.5) is where the board's middle sits
       * from three and a half blocks back.
       */
      await teleport(page, x + 0.5, y, z + 3.5)
      await look(page, { heading: Math.PI, pitch: Math.atan2(0.8, 3.5) })
      await waitTicks(page, 3)
      await waitFrames(page, 3)

      const aimed = await page.evaluate(() => {
        const noa = window.noa
        const mesh = noa.rendering.getScene().meshes.find(m => m.name === 'block-highlight')
        const t = noa.targetedBlock
        const b = mesh?.getBoundingInfo?.()
        return {
          id: t ? t.blockID : 0,
          at: t ? [...t.position] : null,
          enabled: !!mesh && mesh.isEnabled(),
          // In LOCAL mesh coordinates, so noa's origin rebasing cannot move
          // the number this is compared against.
          lo: b ? [b.minimum.x, b.minimum.y, b.minimum.z] : null,
          hi: b ? [b.maximum.x, b.maximum.y, b.maximum.z] : null,
        }
      })

      expect(aimed.id, `the crosshair found ${JSON.stringify(aimed)}`).toBe(SIGN_BASE + 2)
      expect(aimed.at).toEqual([x, y, z])
      expect(aimed.enabled, 'no outline was drawn').toBe(true)
      /*
       * The wireframe's extent is vanilla's box: 8 pixels square and the full
       * height of the block. An outline derived from the ROTATED MESH instead
       * would be 16.5 pixels across here, which is the failure this catches.
       */
      for (const k of [0, 1, 2]) {
        expect(aimed.hi[k] - aimed.lo[k], `outline span on axis ${k}`)
          .toBeCloseTo(k === 1 ? 1 : 0.5, 4)
      }

      await shotRegion(page, 'sign-rotation-outline', 'centre')
    })
})

test.describe('what sixteen rotations look like', () => {
  test('photographs: a fan of signs, each planted at its own angle',
    async ({ page }) => {
      await signFloor(page)
      /*
       * Eight signs in a row, every OTHER segment, each planted by looking at
       * its own heading and each labelled with the segment it should have
       * taken. Reading the labels against the boards is the check no
       * assertion above can make: the numbers prove the ids differ, the
       * picture proves the boards do.
       */
      const step = (Math.PI * 2) / SEGMENTS
      const placed = []
      for (let i = 0; i < 8; i++) {
        const seg = i * 2
        const x = CX - 7 + i * 2
        const id = await plantFacing(page, seg, [x, PY + 1, CZ])
        placed.push(id - SIGN_BASE)
        await page.evaluate(([bx, by, bz, label]) => {
          window.game.signs.setSignText(bx, by, bz, [label, 'deg', String(Number(label) * 22.5)])
        }, [x, PY + 1, CZ, String(seg)])
      }
      expect(placed).toEqual([0, 2, 4, 6, 8, 10, 12, 14])
      await waitTicks(page, 4)

      /*
       * From the south, level with the boards. NOT from above: 76-signs
       * records that a shot taken 1.3 blocks up looks over the top of a sign,
       * and a board is 8 pixels tall.
       */
      await teleport(page, CX - 0.5, PY + 1, CZ + 6)
      await look(page, { heading: Math.PI, pitch: Math.atan2(0.8, 6) })
      await waitTicks(page, 3)
      await waitFrames(page, 3)
      await shot(page, 'sign-rotation-fan-south')

      /*
       * And close enough on two of them to READ the labels, which is the
       * check the wide shot cannot make: the label says which segment the
       * board should be at, and docs/builds/README.md's rule is that a
       * derivation is not a check and a mirrored label is how three builds
       * shipped backwards text.
       */
      await teleport(page, CX - 4.5, PY + 1, CZ + 2.6)
      await look(page, { heading: Math.PI, pitch: Math.atan2(0.8, 2.6) })
      await waitTicks(page, 3)
      await waitFrames(page, 3)
      await shotRegion(page, 'sign-rotation-labels', 'centre')

      /*
       * And from above, where the fan reads as a fan -- the one view in which
       * sixteen angles are obviously sixteen angles rather than eight boards
       * of slightly different widths. Pitch is POSITIVE to look down here;
       * the first version of this shot used -0.45 and photographed the sky.
       */
      await teleport(page, CX - 0.5, PY + 5, CZ + 5)
      await look(page, { heading: Math.PI, pitch: 0.75 })
      await waitFrames(page, 4)
      await shot(page, 'sign-rotation-fan-above')
    })
})
