import { test, expect } from './fixtures.js'
import {
  waitTicks, teleport, settleOnGround, look, HEADING, SURFACE_Y, ID,
} from './helpers/world.js'
import { shot } from './helpers/shots.js'

/*
 * Entities respond to the clock.
 *
 * THE BUG THIS FILE EXISTS FOR: the player model, the NPC, the first-person
 * arm and the held item were all pinned to a constant emissive floor -- 0.45,
 * typed at three different construction sites. Babylon ADDS emissive rather
 * than modulating it, so that constant was brightness the sky's light could
 * never take away. At midnight the terrain went dark and every model in the
 * world stayed lit, which is what the owner saw.
 *
 * A test that only checks "the material exists" passes on that bug, and so
 * does one that only checks "emissive is not zero". The assertion has to be
 * that the number MOVED, and that it moved with the same `level` the sun's
 * light runs on -- because the failure mode being ruled out is precisely two
 * brightness sources that disagree.
 *
 * NO HARDCODED WORLD COORDINATES in here on purpose. Materials are found
 * through the scene and through window.game, and the screenshots are taken
 * from wherever spawn happens to be, so the island being remapped underneath
 * this file cannot break it.
 */

const NOON = 6000
const MIDNIGHT = 18000

/**
 * Every entity material in the scene, plus the light level driving them.
 *
 * Read from the SCENE rather than from a list of known materials, so an
 * entity added later is covered by this file without anyone remembering to
 * come back -- which is the same reason the emissive number moved into
 * entityLight.js in the first place.
 */
const sample = (page) => page.evaluate(() => {
  const scene = window.noa.rendering.getScene()
  const named = (m) => ({ name: m.name, e: m.emissiveColor.r, a: m.ambientColor.r })
  const game = window.game
  const mats = [
    game.skinMaterial,               // the player, and the first-person arm
    game.held.item.material,         // the held item viewmodel
    // Every NPC builds its own skin material, named `skin-<id>`.
    ...scene.materials.filter((m) => /^skin-/.test(m.name)),
  ].filter(Boolean)
  return {
    light: scene.lights.find((l) => l.name === 'light')?.intensity ?? null,
    mats: mats.map(named),
  }
})

const atTime = async (page, t) => {
  await page.evaluate((v) => window.game.sky.setTime(v), t)
  await waitTicks(page, 3)
  return sample(page)
}

test.describe('entity lighting follows the day/night cycle', () => {
  test('every entity material dims from noon to midnight, with the sun',
    async ({ page }) => {
      const noon = await atTime(page, NOON)
      const midnight = await atTime(page, MIDNIGHT)

      // Guard the guard: if the sky itself stopped moving, the rest of this
      // would "pass" by comparing two identical frozen numbers.
      expect(noon.light, `sun intensity at noon was ${noon.light}`)
        .toBeGreaterThan(0.9)
      expect(midnight.light, `sun intensity at midnight was ${midnight.light}`)
        .toBeLessThan(0.3)

      expect(noon.mats.length,
        'found no entity materials at all -- this test proved nothing')
        .toBeGreaterThan(1)

      for (let i = 0; i < noon.mats.length; i++) {
        const [d, n] = [noon.mats[i], midnight.mats[i]]
        const where = `${d.name}: noon ${d.e.toFixed(3)}, midnight ${n.e.toFixed(3)}`

        /*
         * THE ASSERTION THAT CATCHES THE ORIGINAL BUG. A constant floor --
         * any constant, 0.45 or otherwise -- gives a ratio of exactly 1.
         * Minecraft's night sky light is roughly a fifth of noon's, and
         * sky.js floors it at 0.18, so anything above half is a model that
         * is not really following the clock.
         */
        expect(n.e, `${where} -- the emissive floor did not move`)
          .toBeLessThan(d.e * 0.5)
        expect(n.e, `${where} -- entities went pure black at midnight`)
          .toBeGreaterThan(0)

        /*
         * And it is the SAME source, not a second curve that happens to
         * also go down. Vanilla's entity shader floors face shading at
         * 0.4 of the light level (light.glsl's `* 0.6 + 0.4`), which is
         * what entityLight.js implements.
         */
        expect(d.e, `${where} -- noon emissive is not 0.4 of the sun`)
          .toBeCloseTo(noon.light * 0.4, 2)
        expect(n.e, `${where} -- midnight emissive is not 0.4 of the sun`)
          .toBeCloseTo(midnight.light * 0.4, 2)

        /*
         * ambientColor has to stay zero. noa leaves it white and Babylon adds
         * that term on top of emissive, so a white one would be a SECOND
         * uncontrolled floor -- the same trap nametag.js, crackOverlay.js,
         * particles.js and sky.js each carry a line against.
         */
        expect(d.a, `${where} -- ambientColor is not zeroed`).toBe(0)
      }
    })

  test('the clock drives it continuously, not just at the two extremes',
    async ({ page }) => {
      // 12000 is vanilla's sunset tick: the sun exactly on the horizon, so
      // the sky is mid-way down rather than already floored. A material wired
      // to `if (night)` somewhere passes the test above and fails this one --
      // and so does one sampled past 12800, where sky.js's daylight curve has
      // already bottomed out and dusk reads identical to midnight.
      const noon = await atTime(page, NOON)
      const dusk = await atTime(page, 12000)
      const midnight = await atTime(page, MIDNIGHT)
      const e = (s) => s.mats[0].e
      expect(e(dusk), `noon ${e(noon).toFixed(3)}, dusk ${e(dusk).toFixed(3)},`
        + ` midnight ${e(midnight).toFixed(3)}`).toBeLessThan(e(noon))
      expect(e(dusk)).toBeGreaterThan(e(midnight))
    })

  test('the model and the ground darken together', async ({ page }) => {
    /*
     * Visual, and the whole point of the change: a number can say the
     * emissive moved, but only a screenshot says the model and the terrain
     * around it now read as being in the same world at midnight.
     *
     * Third person, because it is the only view that puts the full model and
     * the ground it stands on in one frame. F5 rather than a private setter,
     * so this also proves the path a player uses.
     */
    await page.keyboard.press('F5')
    await page.waitForFunction(() => !window.game.perspective.isFirstPerson)
    try {
      await atTime(page, NOON)
      await waitTicks(page, 2)
      await shot(page, 'entity-light-noon')

      await atTime(page, MIDNIGHT)
      await waitTicks(page, 2)
      await shot(page, 'entity-light-midnight')
    } finally {
      // resetWorld does not restore the camera mode, so this has to. Cycle
      // rather than set: F5 is the only door in.
      for (let i = 0; i < 3; i++) {
        if (await page.evaluate(() => window.game.perspective.isFirstPerson)) break
        await page.keyboard.press('F5')
      }
    }
  })
})

/* ------------------------------------------------------------------ *
 * Block light on entities
 * ------------------------------------------------------------------ */

/*
 * THE HALF THAT WAS MISSING UNTIL src/blockLight.js SHIPPED.
 *
 * Everything above this line tests the SKY half -- a model darkening with the
 * clock. Vanilla's entity light is max(skyLight * daylight, blockLight), and
 * until the light engine existed there was no second term to test. There is
 * now, and these are its tests.
 *
 * READ entityLight.js's "THE MAX, AND THE HALF OF IT THAT IS A PLACEHOLDER"
 * before adding to this section. The sky term here is still DAYLIGHT ALONE --
 * sky light does not exist -- so a dark room is dark because the clock says
 * midnight, not because it has a roof. That is why every test below sets the
 * time before it asserts anything, and why none of them claims a cave is dark.
 *
 * The block ids are duplicated from blocks.js for the reason helpers/world.js
 * gives for duplicating the others: a renumbering should fail these, not
 * silently follow along.
 */
const GLOWSTONE = 129

/** Room centre, on the flat platform 36-face-shading.spec.js builds on. */
const CX = 20
const CZ = 20
const FLOOR = SURFACE_Y
const CEIL = FLOOR + 4
const R = 3

/** A sealed stone box with clear air inside. Same shape as spec 56's. */
async function buildRoom(page) {
  await page.evaluate(([cx, cz, floor, ceil, r, stone, air]) => {
    for (let dx = -r - 1; dx <= r + 1; dx++) {
      for (let dz = -r - 1; dz <= r + 1; dz++) {
        for (let y = floor; y <= ceil; y++) {
          const wall = dx === -r - 1 || dx === r + 1 || dz === -r - 1 || dz === r + 1
          const cap = y === floor || y === ceil
          window.noa.setBlock(wall || cap ? stone : air, cx + dx, y, cz + dz)
        }
      }
    }
  }, [CX, CZ, FLOOR, CEIL, R, ID.stone, ID.air])
  await waitTicks(page, 4)
}

const setBlock = (page, id, x, y, z) =>
  page.evaluate(([i, a, b, c]) => window.noa.setBlock(i, a, b, c), [id, x, y, z])

/**
 * The player's skin material, the block light the engine says is at his feet,
 * and the sun -- read in ONE evaluate so the three cannot be sampled a tick
 * apart and disagree.
 *
 * `diffuse` is in here because emissive alone cannot catch a half-wired
 * version: entityLight.js puts the floor in emissive and the face-shaded 0.6
 * in diffuseColor, and a change that moved only the first would light a model
 * to roughly half what the same light level buys outdoors.
 */
const samplePlayer = (page) => page.evaluate(() => {
  const noa = window.noa
  const p = noa.ents.getPosition(noa.playerEntity)
  const mat = window.game.skinMaterial
  return {
    light: window.blockLight.getBlockLight(p[0], p[1], p[2]),
    sky: window.blockLight.getSkyLight(p[0], p[1], p[2]),
    emissive: mat.emissiveColor.r,
    diffuse: mat.diffuseColor.r,
    sun: noa.rendering.getScene().lights.find((l) => l.name === 'light')?.intensity ?? null,
  }
})

/** The same three numbers for the NPC, off HIS material and HIS position. */
const sampleEvan = (page) => page.evaluate(() => {
  const scene = window.noa.rendering.getScene()
  const mat = scene.materials.find((m) => /^skin-/.test(m.name))
  const p = window.game.aiEvan.position
  return {
    name: mat?.name ?? null,
    light: window.blockLight.getBlockLight(p[0], p[1], p[2]),
    emissive: mat ? mat.emissiveColor.r : null,
    diffuse: mat ? mat.diffuseColor.r : null,
    at: [...p],
  }
})

/** How dark a voxel with no light of any kind is. blockLight.js's LIGHT_FLOOR. */
const LIGHT_FLOOR = 0.05

test.describe('entity lighting reads block light at the entity', () => {
  test('a glowstone lights the player in a dark sealed room, and taking it'
    + ' away puts him back', async ({ page, terrain }) => {
    await terrain.keep([CX - R - 1, FLOOR, CZ - R - 1], [CX + R + 1, CEIL, CZ + R + 1])
    await buildRoom(page)
    await page.evaluate((v) => window.game.sky.setTime(v), MIDNIGHT)
    await teleport(page, CX + 0.5, FLOOR + 1, CZ + 0.5)
    await settleOnGround(page)
    await waitTicks(page, 3)

    const dark = await samplePlayer(page)
    // Guard the guard. If the room were lit by something else, or the clock
    // had not moved, the comparison below would be two identical numbers.
    expect(dark.light, 'the sealed room already had block light in it').toBe(0)
    expect(dark.sun, `sun intensity at midnight was ${dark.sun}`).toBeLessThan(0.3)
    /*
     * THESE TWO NUMBERS MOVED WHEN SKY LIGHT LANDED, and the move is the
     * point. They used to be `dark.sun * 0.4` and a gain of exactly 1 -- the
     * player in a sealed room lit by the midnight sun, because `skyTerm` was
     * the daylight level with sky light treated as 15 everywhere. The room is
     * sealed, so the real sky level in it is 0, and what is left is the
     * lightmap floor. He is now dark because of the ROOF and not because of
     * the clock, which is what the whole change was for.
     *
     * LIGHT_FLOOR duplicated from blockLight.js rather than imported, for the
     * reason helpers/world.js gives for duplicating the block ids: if someone
     * retunes it, this should fail rather than quietly follow along.
     */
    expect(dark.sky, 'the sealed room let sky light in').toBe(0)
    expect(dark.emissive, `emissive ${dark.emissive.toFixed(4)} at sky 0`)
      .toBeCloseTo(LIGHT_FLOOR * 0.4, 3)
    expect(dark.diffuse, `diffuse ${dark.diffuse.toFixed(4)} at sky 0`)
      .toBeCloseTo(0.6 * LIGHT_FLOOR / dark.sun, 2)

    // One block east of his feet. The feet voxel is air, so it takes 14.
    await setBlock(page, GLOWSTONE, CX + 1, FLOOR + 1, CZ)
    await waitTicks(page, 3)
    const lit = await samplePlayer(page)

    expect(lit.light, 'the glowstone did not reach the voxel he is standing in')
      .toBeGreaterThan(0)
    /*
     * THE ASSERTION. Not "it got brighter" -- the emissive has to be the
     * FLOOR OF THE LIGHT LEVEL THE ENGINE ACTUALLY STORED, which is what ties
     * this file to blockLight.js rather than to a second brightness source
     * that happens to also go up. ENTITY_FLOOR is 0.4 and MAX_LIGHT is 15.
     */
    expect(lit.emissive,
      `block light ${lit.light}, emissive ${lit.emissive.toFixed(3)}`)
      .toBeCloseTo(lit.light / 15 * 0.4, 2)
    expect(lit.emissive, 'the glowstone did not brighten him at all')
      .toBeGreaterThan(dark.emissive * 3)
    // And the face-shaded 0.6 came with it, or he is a cardboard cutout.
    expect(lit.diffuse, `diffuse gain was ${lit.diffuse.toFixed(3)}`)
      .toBeCloseTo(0.6 * (lit.light / 15) / lit.sun, 1)

    await setBlock(page, ID.air, CX + 1, FLOOR + 1, CZ)
    await waitTicks(page, 3)
    const out = await samplePlayer(page)
    expect(out.light, 'removing the glowstone left light behind').toBe(0)
    expect(out.emissive, 'he stayed lit after the glowstone was gone')
      .toBeCloseTo(dark.emissive, 3)
    expect(out.diffuse).toBeCloseTo(dark.diffuse, 3)
  })

  test('Evan is lit by the glowstone next to HIM, and the player is not',
    async ({ page, terrain }) => {
      /*
       * The per-entity half, and the only test that can catch the version of
       * this that "works": one probe, wired to the player, shared by every
       * material. That version passes the test above and fails this one --
       * the NPC would brighten when the PLAYER walked up to a torch and stay
       * dark standing on one.
       */
      await page.evaluate((v) => window.game.sky.setTime(v), MIDNIGHT)
      /*
       * WALK THE PLAYER OFF FIRST, and this is not tidiness -- Evan spawns a
       * few blocks from the player and the first run of this test measured
       * block light 11 at the player's feet from Evan's ring. The control
       * half of the test needs him genuinely out of range, which at 15 levels
       * of falloff means further away than the room the test above builds.
       */
      await teleport(page, CX + 0.5, FLOOR + 2, CZ + 0.5)
      await waitTicks(page, 5)

      const before = await sampleEvan(page)
      expect(before.name, 'found no skin-<id> material -- no NPC in the scene')
        .toMatch(/^skin-/)
      expect(before.light, 'something was already lighting Evan').toBe(0)

      const [ex, ey, ez] = before.at
      const fx = Math.floor(ex), fy = Math.floor(ey), fz = Math.floor(ez)
      await terrain.keep([fx - 2, fy - 1, fz - 2], [fx + 2, fy + 1, fz + 2])
      /*
       * A ring of four rather than one block. He has a brain and a body, and
       * a step in any direction between the setBlock and the sample would
       * leave a single glowstone behind him and this test failing for a
       * reason that has nothing to do with lighting.
       */
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        await setBlock(page, GLOWSTONE, fx + dx, fy, fz + dz)
      }
      await waitTicks(page, 4)

      const lit = await sampleEvan(page)
      const player = await samplePlayer(page)
      expect(lit.light, 'the glowstones did not reach his feet').toBeGreaterThan(0)
      expect(lit.emissive,
        `Evan: block light ${lit.light}, emissive ${lit.emissive.toFixed(3)}`)
        .toBeCloseTo(lit.light / 15 * 0.4, 2)
      expect(lit.emissive, 'Evan did not brighten -- his material has no probe,'
        + ' or it is pointed at the player').toBeGreaterThan(before.emissive * 3)

      /*
       * The player is at spawn, nowhere near those glowstones, so HIS
       * material must not have moved. This is the assertion that fails if
       * every material shares one probe.
       */
      expect(player.light, 'the player is standing in the glowstones too --'
        + ' this test proved nothing').toBe(0)
      expect(player.emissive, `player emissive ${player.emissive.toFixed(3)}`)
        .toBeCloseTo(player.sun * 0.4, 2)
    })

  test('the payoff, in two frames: a model in a dark room, with the glowstone'
    + ' and without it', async ({ page, terrain }) => {
    await terrain.keep([CX - R - 1, FLOOR, CZ - R - 1], [CX + R + 1, CEIL, CZ + R + 1])
    await buildRoom(page)
    await page.evaluate((v) => window.game.sky.setTime(v), MIDNIGHT)
    // Third person, for the same reason the day/night screenshot above uses
    // it: it is the only view with the whole model in frame.
    await page.keyboard.press('F5')
    await page.waitForFunction(() => !window.game.perspective.isFirstPerson)
    try {
      await teleport(page, CX + 0.5, FLOOR + 1, CZ + 0.5)
      await settleOnGround(page)
      await look(page, { heading: HEADING.northMinusZ, pitch: 0.2 })
      await waitTicks(page, 3)
      await shot(page, 'entity-block-light-off')

      await setBlock(page, GLOWSTONE, CX + 1, FLOOR + 1, CZ)
      await waitTicks(page, 4)
      await shot(page, 'entity-block-light-on')

      await setBlock(page, ID.air, CX + 1, FLOOR + 1, CZ)
      await waitTicks(page, 3)
    } finally {
      for (let i = 0; i < 3; i++) {
        if (await page.evaluate(() => window.game.perspective.isFirstPerson)) break
        await page.keyboard.press('F5')
      }
    }
  })
})
