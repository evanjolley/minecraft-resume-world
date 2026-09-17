import { test, expect } from './fixtures.js'
import {
  HEADING, ID, PAD_X0, PAD_Y, PAD_Z, look, settleOnGround, usePad, waitTicks,
} from './helpers/world.js'

/*
 * YOU CANNOT LEAP OUT OF A POND, AND YOU CAN STILL GET OUT OF ONE.
 *
 * Reported from play: "i can currently jump too high in water. Its like im
 * propelled up if i jump from one block depth."
 *
 * He was right, and the cause is that Minecraft CHOOSES between two jumps
 * where this world was adding them. LivingEntity.aiStep, 1.21.8:
 *
 *   in a fluid: jumpFromGround iff (onGround && fluidHeight <= 0.4),
 *               else jumpInLiquid
 *
 * jumpInLiquid is a flat +0.04 b/tick^2 while the key is held; jumpFromGround
 * is the 0.42 b/tick impulse. In one-block-deep water your feet are on the
 * bottom, so noa called you grounded and handed you the full impulse -- on top
 * of buoyancy AND on top of the climb this world applies as a force. Three
 * upward contributions against vanilla's one.
 *
 * THE TWO ASSERTIONS ARE A PAIR AND NEITHER IS SUFFICIENT.
 *
 *   1. the launch is gone
 *   2. you can still get out onto the bank
 *
 * (2) passes with the gate and without it, which is exactly what a safety net
 * is for -- it is not there to catch this bug, it is there to catch the fix.
 * (2) is the one that makes (1) safe to ship. A gate that kills the jump and
 * leaves you treading water in a one-block puddle for ever is a worse bug than
 * the one being fixed -- fluids.js's header records that an earlier version of
 * the buoyancy did exactly that, pinning the player 0.96 blocks under the
 * surface with jump held. The way out is not the jump: it is the climb
 * carrying you to the surface and the coast over the lip.
 *
 * THE RIG IS A STONE TRAY, not a hole in the world. The overworld is superflat
 * with no water in it, and a pool dug into terrain is a pool whose walls the
 * flow engine can eat. Nine by five of stone with a three by three of source
 * water sunk into the middle of it: the water has nowhere to flow, the stone
 * around it is the bank, and it is the same pond on every engine whatever the
 * terrain does next. 28-underwater and 41-fluid-flow build their own water for
 * the same reason.
 *
 * THE BANK RUNS FOUR BLOCKS PAST THE POND and that is not padding. It was one
 * block wide first, and the climb-out test failed reading y=136 -- he got out
 * of the water exactly as he should have, kept walking, and fell off the kerb
 * back to the terrain. A shore you can stand on is the difference between
 * measuring the climb and measuring a drop.
 */

/** The tray sits along the pad, far enough from PAD_X0 that usePad's own
 *  strip of cleared air is not part of it. */
const TRAY = { x0: PAD_X0 + 6, z0: PAD_Z - 2, floorY: PAD_Y - 1 }

/** Where the player stands: the middle of the 3x3 of water, feet on the
 *  tray floor, exactly the one-block depth the report names. */
const MIDDLE = [TRAY.x0 + 2.5, PAD_Y, TRAY.z0 + 2.5]

/**
 * What a ground jump would have given him, and what the swim bob should.
 *
 * VANILLA'S FIGURE IS DERIVED, not guessed at. Holding jump on the bottom of
 * one-block-deep water, jumpInLiquid runs until isInWater goes false, which is
 * when the feet clear the fluid surface -- 8/9 of a block, because a still
 * source is 0.889 tall. You arrive there at the climb's terminal 0.175 b/tick
 * and coast 0.175^2 / (2 * 0.08) = 0.191 blocks further under gravity. So
 * 0.889 + 0.191 = 1.08 blocks above the pond floor.
 *
 * This world reads a little over that and the reason is known and deliberate:
 * `atFeet` is voxel-granular, so the climb runs until the feet clear the whole
 * CELL at 1.0 rather than the surface at 0.889. Same coast on the end of it
 * -- 3.5^2 / (2 * 32) is the same 0.191 in b/s -- so the expected peak here is
 * 1.19. It measures 1.277, and the last tenth of that is the transient: the
 * climb is still accelerating toward its terminal when the feet clear the cell.
 *
 * THE BAND'S JOB IS TO SEPARATE A BOB FROM A JUMP. Take the gate out and the
 * same measurement reads 2.209 blocks -- a full ground jump stacked on the
 * climb and the buoyancy, which is the report. 1.45 sits between them with
 * room on both sides, and well clear of MC.JUMP_APEX's 1.2522 on dry land.
 */
const VANILLA_BOB = 1.08
const BOB_CEILING = 1.45

/** Build the tray, fill it, and stand the player in the middle of it. */
async function usePond(page) {
  // The pad first, purely to get the player up to y=200 with the chunks
  // loaded and the writes landing -- usePad already polls until setBlock
  // sticks, which is the part that is fiddly.
  const removePad = await usePad(page, { length: 4 })

  await page.evaluate(([x0, z0, floorY, stone, middle]) => {
    const noa = window.noa
    const water = window.game.fluids.ids.water
    const y = floorY + 1
    for (let dx = 0; dx <= 8; dx++) {
      for (let dz = 0; dz <= 4; dz++) {
        const x = x0 + dx
        const z = z0 + dz
        noa.setBlock(stone, x, floorY, z)
        // The 3x3 of water sits in the middle; every other column of the slab
        // is a block of stone standing one proud of the pond floor -- the
        // bank. It runs four blocks past the rim on the +x side so that
        // climbing out and then walking is landing on a shore rather than
        // stepping off a kerb into the sky.
        const pond = dx >= 1 && dx <= 3 && dz >= 1 && dz <= 3
        noa.setBlock(pond ? water : stone, x, y, z)
        // And clear the headroom, or the tray is a ceiling and nothing rises.
        for (let dy = 1; dy <= 4; dy++) noa.setBlock(0, x, y + dy, z)
      }
    }
    noa.ents.setPosition(noa.playerEntity, middle)
    const b = noa.ents.getPhysics(noa.playerEntity).body
    b.velocity[0] = b.velocity[1] = b.velocity[2] = 0
  }, [TRAY.x0, TRAY.z0, TRAY.floorY, ID.stone, MIDDLE])

  // Let him settle onto the tray floor and let fluids.js register the water.
  await waitTicks(page, 12)

  return async () => {
    await page.evaluate(([x0, z0, floorY]) => {
      const noa = window.noa
      for (let dx = 0; dx <= 8; dx++) {
        for (let dz = 0; dz <= 4; dz++) {
          for (let dy = 0; dy <= 2; dy++) noa.setBlock(0, x0 + dx, floorY + dy, z0 + dz)
        }
      }
    }, [TRAY.x0, TRAY.z0, TRAY.floorY])
    await removePad()
  }
}

/**
 * Record the highest the player's feet get, and HOW MANY TICKS went into the
 * answer.
 *
 * The tick count is not decoration. A sampler that never fired returns
 * `peak - start = 0`, which sails through "the launch is gone" and asserts
 * nothing at all -- this repo has shipped a probe that passed vacuously
 * before. So the count comes back with the number and the test checks it
 * first.
 */
async function armPeak(page) {
  await page.evaluate(() => {
    const noa = window.noa
    const y = () => noa.ents.getPositionData(noa.playerEntity).position[1]
    const start = y()
    let peak = start
    let ticks = 0
    const fn = () => { ticks++; const c = y(); if (c > peak) peak = c }
    noa.on('tick', fn)
    window.__peak = () => { noa.off('tick', fn); return { rise: peak - start, ticks } }
  })
}

const readPeak = (page) => page.evaluate(() => window.__peak())

const feetFluid = (page) => page.evaluate(() => window.game.fluids.feet)
const playerY = (page) =>
  page.evaluate(() => window.noa.ents.getPositionData(window.noa.playerEntity).position[1])

test.describe('jumping in water', () => {
  test('one block of water takes the ground jump away and leaves the swim bob',
    async ({ page }) => {
      const restore = await usePond(page)
      try {
        // The sample is only worth reading if he is actually standing in the
        // water, on the bottom. Both, before anything is measured.
        expect(await feetFluid(page)).toBe('water')
        expect(await page.evaluate(
          () => window.noa.ents.getPhysics(window.noa.playerEntity).body.atRestY() < 0)).toBe(true)

        await armPeak(page)
        await page.keyboard.down('Space')
        await page.waitForTimeout(600)
        await page.keyboard.up('Space')
        const { rise, ticks } = await readPeak(page)

        expect(ticks, 'the peak sampler never ran').toBeGreaterThan(10)
        console.log(`  peak rise in one-block water: ${rise.toFixed(4)} blocks (${ticks} ticks)`)
        expect(rise, `rose ${rise.toFixed(3)} blocks -- vanilla's bob is ${VANILLA_BOB}`)
          .toBeLessThan(BOB_CEILING)
        // And it is a bob rather than nothing: the climb still lifts him out
        // of a one-block pond, which is the half the next test leans on.
        expect(rise, `rose only ${rise.toFixed(3)} blocks`).toBeGreaterThan(0.8)
      } finally {
        await restore()
        await settleOnGround(page)
      }
    })

  test('and you can still climb out of the pond onto the bank', async ({ page }) => {
    const restore = await usePond(page)
    try {
      /*
       * Space and W together, aimed at the rim. This is how you leave water in
       * Minecraft and it is the assertion that says the gate did not trade one
       * bug for a worse one. The rim's top is one block above the pond floor,
       * so landing on it means the feet finished above PAD_Y.
       */
      await look(page, { heading: HEADING.westPlusX })
      await page.keyboard.down('Space')
      await page.keyboard.down('KeyW')
      /*
       * LONG ENOUGH TO GET OUT, SHORT ENOUGH NOT TO WALK OFF THE FAR SIDE.
       * The climb takes about half a second to lift him the block and the swim
       * is 2 b/s across a block and a half of water; on the bank he is back to
       * 4.3 b/s, and the slab is not infinite. 2500 ms measured a fall off the
       * end -- y=187 and dropping -- which passes for a failure of the climb
       * and is not one.
       */
      await page.waitForTimeout(1400)
      await page.keyboard.up('KeyW')
      await page.keyboard.up('Space')
      await waitTicks(page, 20)

      const y = await playerY(page)
      expect(y, `finished at y=${y.toFixed(3)}, rim top is ${PAD_Y + 1}`)
        .toBeGreaterThanOrEqual(PAD_Y + 0.9)
      expect(await feetFluid(page), 'still in the water').toBe(null)
    } finally {
      await page.keyboard.up('KeyW').catch(() => {})
      await page.keyboard.up('Space').catch(() => {})
      await restore()
      await settleOnGround(page)
    }
  })

  /*
   * THE GATE IS A DEPTH, NOT "ANY WATER", and this is where that is proved.
   *
   * Entity.getFluidJumpThreshold is 0.4 for anything with an eye over 0.4 up,
   * and getFluidHeight is measured from the BOTTOM OF THE BOX -- so the same
   * block of water gates you or does not depending on where in it your feet
   * are. A source is 8/9 = 0.889 tall, so feet at 0.4 into the cell leave
   * 0.489 of water above them (gated) and feet at 0.6 leave 0.289 (not).
   *
   * Driven by moving the player rather than by placing a shallow flow, because
   * this way the ONLY thing that differs between the two measurements is two
   * tenths of a block of height. A level-7 puddle would also change the block,
   * the buoyancy and the drag, and then a pass would not be attributable.
   */
  test('the gate is the 0.4 fluid-jump threshold, measured from the feet',
    async ({ page }) => {
      const restore = await usePond(page)
      try {
        const jumpingAt = async (y) => page.evaluate(async ([pos]) => {
          const noa = window.noa
          const b = noa.ents.getPhysics(noa.playerEntity).body
          const was = b.gravityMultiplier
          // Held still, so the depth under test is the depth that is measured
          // and not wherever he sank to while the ticks went by.
          b.gravityMultiplier = 0
          noa.ents.setPosition(noa.playerEntity, pos)
          b.velocity[0] = b.velocity[1] = b.velocity[2] = 0
          const seen = await new Promise((resolve) => {
            let n = 0
            const fn = () => {
              // Read AFTER the entity systems have run, which the tick event
              // is: order 20 wrote `jumping` from the key, order 25 is the
              // gate, order 30 is the jump. What survives to here is the
              // gate's answer.
              if (++n >= 3) { noa.off('tick', fn); resolve(window.game.move.jumping) }
            }
            noa.on('tick', fn)
          })
          b.gravityMultiplier = was
          return seen
        }, [[MIDDLE[0], y, MIDDLE[2]]])

        await page.keyboard.down('Space')
        // Feet 0.4 into the cell: 0.489 of water above them, over the line.
        const deep = await jumpingAt(PAD_Y + 0.4)
        // Feet 0.6 in: 0.289 above them, under it. The jump survives.
        const shallow = await jumpingAt(PAD_Y + 0.6)
        await page.keyboard.up('Space')

        expect(deep, '0.489 deep should have been gated').toBe(false)
        expect(shallow, '0.289 deep should not have been gated').toBe(true)
      } finally {
        await page.keyboard.up('Space').catch(() => {})
        await restore()
        await settleOnGround(page)
      }
    })

  /*
   * ANY BODY, NOT THE PLAYER.
   *
   * Evan has a `movement` component with the player's own jumpImpulse copied
   * into it (npc.js), and the last fluid fix in this file was shipped
   * player-only and came straight back as "Evan moves super fast" in water.
   * So the gate is written over every movement state rather than over
   * noa.playerEntity, and this asserts that by standing a bare entity in the
   * pond -- a body with no brain, no input and no special case anywhere.
   *
   * It is a throwaway entity rather than Evan himself because Evan writes his
   * own `move.jumping` every tick from his pathfinder, so a cleared flag could
   * be his decision rather than the gate's. The last expectation keeps him
   * honestly in scope: he holds the component the gate iterates.
   */
  test('the gate is on every body with a movement component, not on the player',
    async ({ page }) => {
      const restore = await usePond(page)
      try {
        const out = await page.evaluate(async ([wet, dry]) => {
          const noa = window.noa
          const id = noa.ents.add(wet, 0.6, 1.8, null, null, false, false)
          noa.ents.addComponent(id, noa.ents.names.movement, {})
          const move = noa.ents.getMovement(id)
          const tick = () => new Promise((resolve) => {
            const fn = () => { noa.off('tick', fn); resolve() }
            noa.on('tick', fn)
          })

          move.jumping = true
          await tick()
          const inWater = move.jumping

          noa.ents.setPosition(id, dry)
          move.jumping = true
          await tick()
          const onLand = move.jumping

          noa.ents.deleteEntity(id)
          return { inWater, onLand }
        }, [MIDDLE, [MIDDLE[0], PAD_Y + 3, MIDDLE[2]]])

        expect(out.inWater, 'a non-player body kept its jump in the pond').toBe(false)
        expect(out.onLand, 'the gate fired on a body that was not in water').toBe(true)

        expect(await page.evaluate(
          () => !!window.noa.ents.getMovement(window.game.aiEvan.entity)),
        'Evan has no movement component, so the gate would miss him').toBe(true)
      } finally {
        await restore()
        await settleOnGround(page)
      }
    })
})
