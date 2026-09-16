import { test, expect } from './fixtures.js'
import {
  teleport, settleOnGround, aim, waitTicks, waitFrames, HEADING, SURFACE_Y,
} from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * EVAN IS TALLER THAN YOU, BY TWO INCHES.
 *
 * "I want to make the Evan character slightly taller than the user of the
 * site. Because I am slightly tall in real life."
 *
 * The number is not a taste call. Minecraft's player box is 1.8 blocks and
 * the game's own scale reads that as six feet; Evan is 6'2"; so the ratio is
 * 74/72 and he is 1.85 blocks. npc.js states that and this file holds it to
 * it.
 *
 * WHY EVERY ASSERTION BELOW IS A DIFFERENCE AND NOT A LITERAL. A test that
 * says `height === 1.85` passes just as happily on the day someone decides
 * 6'2" should have been 6'3", and it also passes on the day the PLAYER
 * accidentally becomes 1.85 -- which is the actual regression this guards,
 * because "slightly taller" is a relationship and not a size. So the shape of
 * every check here is: his number, against the player's number, at the ratio
 * npc.js derived.
 *
 * PROVEN TO DISCRIMINATE. Setting NPC_HEIGHT_SCALE back to 1 fails the first
 * four tests in this file -- reported in full where each one is asserted.
 *
 * What it CANNOT check is whether two inches reads as "slightly". Nothing a
 * number knows answers that, so the last test is a side-on screenshot of the
 * two of them standing together and a human looks at it.
 */

/** Exactly what npc.js derived, restated here so the test would notice if
 *  someone changed the constant without meaning to. 6'2" over 6'0". */
const EXPECTED_SCALE = 74 / 72

/** Everything about the two bodies, read in ONE evaluate so the pair is
 *  always the same frame. Two round trips is two frames, and the player is
 *  a body with a walk bob. */
const bodies = (page) => page.evaluate(() => {
  const { aiEvan, perspective } = window.game
  const ents = window.noa.ents
  const evanPos = ents.getPositionData(aiEvan.entity)
  const playerPos = ents.getPositionData(window.noa.playerEntity)
  return {
    evan: {
      declared: aiEvan.height,
      eye: aiEvan.eyeHeight,
      boxHeight: evanPos.height,
      boxWidth: evanPos.width,
      // The world-space top of the AABB entityBox.js builds, computed the way
      // entityBox does it -- off `position`, which is the bottom centre.
      feet: evanPos.position[1],
      scaling: [...aiEvan.model.root.scaling.asArray()],
    },
    player: {
      boxHeight: playerPos.height,
      boxWidth: playerPos.width,
      scaling: [...perspective.model.root.scaling.asArray()],
    },
  }
})

test('his body is the player ratio taller, and the player is untouched',
  async ({ page }) => {
    /*
     * FAILS AT SCALE 1 with:
     *   Error: expect(received).toBeCloseTo(expected)
     *   Expected: 1.0277777777777777
     *   Received: 1
     * which is the whole claim in one line.
     */
    const { evan, player } = await bodies(page)

    // The player is 1.8 and MUST stay 1.8 -- physics.js's jump apex, sneak
    // eye drop and one-block step are all calibrated against it.
    expect(player.boxHeight, 'the PLAYER got taller, which is the one thing '
      + 'that must not happen').toBeCloseTo(1.8, 5)

    expect(evan.boxHeight / player.boxHeight).toBeCloseTo(EXPECTED_SCALE, 6)
    expect(evan.boxHeight).toBeCloseTo(evan.declared, 6)
    // The difference, stated as itself: two inches of a six-foot man.
    expect(evan.boxHeight - player.boxHeight).toBeCloseTo(1.8 * (2 / 72), 6)

    // SLIGHTLY. A guard on the adjective rather than on the number -- half a
    // block taller is a different character, and this is the assertion that
    // catches someone "fixing" the multiplier by an order of magnitude.
    expect(evan.boxHeight - player.boxHeight).toBeLessThan(0.2)

    // Width is NOT scaled: 0.6 is what STEP_PROBE, ARRIVE_RADIUS and every
    // gap he walks through are sized against.
    expect(evan.boxWidth).toBeCloseTo(player.boxWidth, 6)
  })

test('the MODEL is taller too, uniformly, so the skin is not stretched',
  async ({ page }) => {
    /*
     * The failure this exists for is a taller hitbox with a 1.8-sized model:
     * nothing renders differently, the nametag floats over nothing, and the
     * only symptom anyone would ever report is a block you cannot place.
     *
     * FAILS AT SCALE 1 with:
     *   Error: expect(received).toBeCloseTo(expected)
     *   Expected: 1.0277777777777777
     *   Received: 1
     * on the scaling ratio below.
     */
    const { evan, player } = await bodies(page)

    // Same ratio as the body. A model and a hitbox that disagree is the bug.
    expect(evan.scaling[1] / player.scaling[1]).toBeCloseTo(EXPECTED_SCALE, 6)

    // UNIFORM. Scaling Y alone is the cheap way to get a tall model and it
    // gives him an elongated head and a smeared face, because the skin is a
    // fixed 64x64 image over boxes with Minecraft's proportions.
    expect(evan.scaling[0]).toBeCloseTo(evan.scaling[1], 6)
    expect(evan.scaling[2]).toBeCloseTo(evan.scaling[1], 6)

    // And the player's model is still vanilla's 0.9375/16.
    expect(player.scaling[1]).toBeCloseTo(0.9375 / 16, 6)
  })

test('his eyes are his own height up, so he looks slightly DOWN at you',
  async ({ page }) => {
    /*
     * The head tracking aims eye-to-eye. Both eye heights were MC.EYE_HEIGHT
     * before, so they cancelled and he looked dead level; the two inches only
     * become visible in the render when his eye height moves with him.
     *
     * FAILS AT SCALE 1: `Expected: > 1.62, Received: 1.62`.
     */
    const { evan, player } = await bodies(page)
    expect(evan.eye).toBeGreaterThan(1.62)
    expect(evan.eye / 1.62).toBeCloseTo(EXPECTED_SCALE, 6)
    // Same fraction of his body that 1.62 is of 1.8 -- derived, not a second
    // tuned number.
    expect(evan.eye / evan.declared).toBeCloseTo(1.62 / player.boxHeight, 6)
  })

test('the nametag rides up with him rather than sitting at your head height',
  async ({ page }) => {
    /*
     * nametag.js places at NAMETAG_OFFSET = bbHeight + 0.5 and then lifts the
     * plane's CENTRE by (LINE_H - 1) / 2 font pixels, so the mesh y is
     *   feet + height + 0.5 + 4 * 0.025
     * and the only variable in it is the height npc.js handed over. This
     * asserts the tag is above where a 1.8 tag would have been, by exactly
     * the difference in the two bodies.
     *
     * FAILS AT SCALE 1 with:
     *   Error: expect(received).toBeGreaterThan(expected)
     *   Expected: > 2.4
     *   Received:   2.4
     * -- and the strict comparison is there BECAUSE the two toBeCloseTo lines
     * under it do not discriminate on their own. At scale 1 they read
     * `0 === 0` and pass, which is exactly the passing-looking failure this
     * file is supposed to be immune to. Caught by running it at scale 1.
     */
    const { evan, player } = await bodies(page)

    const tagY = await page.evaluate(() => {
      const { aiEvan } = window.game
      const rpos = window.noa.ents.getPositionData(aiEvan.entity)._renderPosition
      // The see-through pass; both meshes are placed identically.
      return { mesh: aiEvan.nametag.meshes[0].position.y, feet: rpos[1] }
    })

    const above = tagY.mesh - tagY.feet
    const PX = 0.025, LINE_H = 9
    const expected = (h) => h + 0.5 + ((LINE_H - 1) / 2) * PX

    // STRICTLY above where a 1.8 tag would have been. This is the assertion
    // that fails if the height stops being passed through to nametag.js.
    expect(above).toBeGreaterThan(expected(player.boxHeight))
    expect(above).toBeCloseTo(expected(evan.declared), 4)
    // ...and the lift over where the player-height version put it.
    expect(above - expected(player.boxHeight))
      .toBeCloseTo(evan.declared - player.boxHeight, 6)
  })

test('the AABB follows the height, so placement sees the taller body',
  async ({ page }) => {
    /*
     * entityBox.js builds max[1] as `position[1] + p.height`, so this SHOULD
     * be automatic -- and "should be automatic" is exactly the thing worth an
     * assertion, because the alternative implementation (a hardcoded 1.8 in
     * the box builder) looks identical from the outside until the day the
     * heights differ.
     *
     * HONEST LIMIT, worth writing down rather than overclaiming: at 1.85 with
     * his feet on a voxel boundary, the SET of whole cells he blocks is the
     * same as at 1.8 -- feet and feet+1, because 1.85 and 1.8 both land
     * inside the same cell. The taller box blocks a taller COLUMN only when
     * his feet are more than 0.15 up a block. So what is checked here is the
     * derivation, not a new refusal; 38-npc-body.spec.js owns the refusal
     * itself and still passes with the taller box.
     */
    const box = await page.evaluate(() => {
      const { aiEvan } = window.game
      const p = window.noa.ents.getPositionData(aiEvan.entity)
      const hw = p.width / 2
      const [x, y, z] = p.position
      return {
        min: [x - hw, y, z - hw],
        max: [x + hw, y + p.height, z + hw],
        declared: aiEvan.height,
      }
    })
    expect(box.max[1] - box.min[1]).toBeCloseTo(box.declared, 6)
    // The cell one block above his feet is inside him, which is what the
    // placement refusal in 38-npc-body.spec.js leans on.
    expect(box.max[1]).toBeGreaterThan(Math.floor(box.min[1]) + 1)
  })

test('landing is unchanged: a taller box grows upward from the same feet',
  async ({ page }) => {
    /*
     * noa's entity position is the bottom CENTRE, so the solver stops his
     * FEET on the same voxel face whatever his height is -- SPAWN_DROP does
     * not have to scale with him. Stated as a test because the opposite is
     * the natural assumption and would be a silent half-block offset.
     */
    await page.evaluate(() => {
      window.game.aiEvan._setTalking(false)
      window.game.aiEvan._reset()
    })
    await page.waitForFunction(() => window.game.aiEvan.grounded, null, { timeout: 5000 })

    const settled = await page.evaluate(() => ({
      pos: [...window.game.aiEvan.position],
      home: window.game.aiEvan.home,
      grounded: window.game.aiEvan.grounded,
    }))
    expect(settled.grounded).toBe(true)
    // Level with the column he was aimed at, exactly as before he grew.
    expect(settled.pos[1]).toBeCloseTo(settled.home[1], 3)
  })

test('screenshot: the two of them standing together, side on', async ({ page }) => {
  /*
   * THE ONLY THING THAT CAN ANSWER "IS SLIGHTLY RIGHT".
   *
   * Both models in one frame, from the side, on the same ground, at the same
   * distance from the camera. Any of those three missing and the picture
   * argues for whatever you already believed: perspective alone can make a
   * 1.8 model look taller than a 1.85 one if it is a block nearer.
   *
   * THE VANTAGE IS +X, which is the one direction from his column that
   * 38-npc-body.spec.js has already established is not inside a tree -- he
   * stands in dense forest and every spot that looks like a camera position
   * here is a trunk.
   *
   * Third-person BACK rather than spectator: noclip is global (physics.js),
   * so a spectating camera would freeze the man it came to photograph.
   */
  const evan = await page.evaluate(() => [...window.game.aiEvan.position])

  /*
   * SEPARATED ALONG Z AND PHOTOGRAPHED ALONG X, and getting that pair the
   * wrong way round is the mistake this comment exists to stop being made
   * twice. The first attempt put the player 1.2 blocks along Z and aimed the
   * camera down -Z as well -- so the offset was pure DEPTH, the player stood
   * directly in front of Evan and hid him completely, and the shot was one
   * man with two nametags. The separation has to be perpendicular to the
   * camera or it is not a comparison.
   */
  await teleport(page, evan[0], SURFACE_Y + 2, evan[2] + 1.4)
  await settleOnGround(page)

  // Facing -X, so the third-person camera swings out to +X and the Z offset
  // above lands as screen-horizontal. Pitch level, because looking DOWN at a
  // pair of people is exactly the angle that flattens a height difference out
  // of a picture.
  await aim(page, { heading: HEADING.eastMinusX, pitch: 0 })

  for (let i = 0; i < 3 && await page.evaluate(() => window.game.perspective.mode) !== 'third-back'; i++) {
    await page.keyboard.press('F5')
    await waitFrames(page, 2)
  }
  expect(await page.evaluate(() => window.game.perspective.mode)).toBe('third-back')

  await waitTicks(page, 5)
  await waitFrames(page, 3)
  await shot(page, 'npc-evan-height-beside-player')

  // Back to first person so the next spec in the file order inherits a normal
  // camera -- resetWorld does not touch perspective.
  for (let i = 0; i < 3 && await page.evaluate(() => window.game.perspective.mode) !== 'first'; i++) {
    await page.keyboard.press('F5')
    await waitFrames(page, 2)
  }
})

/* ------------------------------------------------------------------ *
 * AND HE SURVIVES A WORLD CHANGE
 * ------------------------------------------------------------------ */

/*
 * `/world mountains` does not rebuild anything -- it reassigns the world name
 * and noa re-requests every chunk. His column was computed once at boot
 * against the superflat's voxels, so before this pass he kept the overworld's
 * altitude in a world whose ground is somewhere else entirely: buried in rock
 * in the mountains, standing on nothing in the Nether.
 *
 * WHAT DISCRIMINATES, and it is not "he is somewhere plausible". The failure
 * is quiet by construction -- an NPC at y=136 in the mountains looks fine in
 * every number except the one nobody prints. So each world is asked the two
 * questions that are only both true if he actually landed there:
 *
 *   - solid, non-leaf ground immediately under his feet
 *   - air AT his feet, i.e. he is standing on the world rather than inside it
 *
 * Those are the same two 38-npc-body.spec.js asks about the boot placement,
 * which is the point: a world change costs him exactly the arrival he got at
 * boot, because it re-runs it rather than skipping to an altitude.
 */
const enterWorld = (page, name) =>
  page.evaluate(n => window.game.dimensions.enter(n), name)

/** Where he is, and what is immediately above and below him, read out of
 *  noa's own chunk store rather than out of island.js's generator. */
const standing = (page) => page.evaluate(() => {
  const { aiEvan } = window.game
  const [x, y, z] = aiEvan.position
  const fx = Math.floor(x), fz = Math.floor(z), fy = Math.round(y)
  return {
    pos: [x, y, z],
    grounded: aiEvan.grounded,
    under: window.noa.getBlock(fx, fy - 1, fz),
    feet: window.noa.getBlock(fx, fy, fz),
    head: window.noa.getBlock(fx, fy + 1, fz),
    world: window.game.dimensions.active,
  }
})

/** He is put down by the SOLVER, so give the chunks time to arrive and the
 *  drop time to finish. The gate holds him frozen until both. */
async function settleEvan(page) {
  await waitTicks(page, 25)
  await page.waitForFunction(() => window.game.aiEvan.grounded,
    null, { timeout: 15_000, polling: 50 })
  await waitTicks(page, 3)
}

test.describe('a world change moves him with it', () => {
  test.afterEach(async ({ page }) => {
    if (await page.evaluate(() => window.game.dimensions.active) !== 'overworld') {
      await enterWorld(page, 'overworld')
      await settleEvan(page)
    }
  })

  for (const world of ['mountains', 'nether']) {
    test(`he lands on real ground in the ${world}, not inside it`, async ({ page }) => {
      const before = await standing(page)
      expect(before.world).toBe('overworld')

      const res = await enterWorld(page, world)
      expect(res.ok, `could not reach the ${world}: ${res.error}`).toBe(true)
      await settleEvan(page)

      const after = await standing(page)
      expect(after.world).toBe(world)

      /*
       * HE MOVED. The overworld's floor and the mountains' are sixty blocks
       * apart and the Nether's is sixty below that, so staying put is the
       * bug and this is the assertion that used to fail.
       */
      expect(Math.abs(after.pos[1] - before.pos[1]),
        `he kept the overworld's altitude in the ${world}`).toBeGreaterThan(5)

      // Ground under him, air at his feet: he is ON the world, not IN it.
      expect(after.grounded, `he never landed in the ${world}`).toBe(true)
      expect(after.under, `nothing under his feet in the ${world}`).not.toBe(0)
      expect(after.feet, `he is buried in the ${world}`).toBe(0)
      expect(after.head, `his head is inside a block in the ${world}`).toBe(0)

      /*
       * And he is inside the patch rather than out past its border, which is
       * the other way a wrong column reads as "somewhere plausible".
       * terrainInfo reports the origin and the width rather than the corners,
       * so the corners are derived the way island.js's own `bounds` does it.
       */
      const t = await page.evaluate(() => window.game.terrain)
      expect(Math.floor(after.pos[0])).toBeGreaterThanOrEqual(-t.originX)
      expect(Math.floor(after.pos[0])).toBeLessThanOrEqual(t.width - t.originX - 1)
      expect(Math.floor(after.pos[2])).toBeGreaterThanOrEqual(-t.originZ)
      expect(Math.floor(after.pos[2])).toBeLessThanOrEqual(t.depth - t.originZ - 1)
    })
  }

  test('and he comes home again', async ({ page }) => {
    const home = await standing(page)

    expect((await enterWorld(page, 'mountains')).ok).toBe(true)
    await settleEvan(page)
    expect((await enterWorld(page, 'overworld')).ok).toBe(true)
    await settleEvan(page)

    const back = await standing(page)
    expect(back.world).toBe('overworld')
    expect(back.grounded).toBe(true)
    // The superflat's floor is one number, so this is exact.
    expect(back.pos[1]).toBeCloseTo(home.pos[1], 2)
    expect(back.under).not.toBe(0)
    expect(back.feet).toBe(0)
  })

  test('he is still the taller one wherever he is standing', async ({ page }) => {
    /*
     * The height is a property of the character and not of the world, and the
     * relocate path rebuilds nothing -- but it does touch the body, so this
     * is the cheap guard that says it did not touch the SIZE of it.
     */
    expect((await enterWorld(page, 'mountains')).ok).toBe(true)
    await settleEvan(page)
    const { evan, player } = await bodies(page)
    expect(evan.boxHeight / player.boxHeight).toBeCloseTo(EXPECTED_SCALE, 6)
    expect(player.boxHeight).toBeCloseTo(1.8, 5)
  })
})
