import { createEmitter } from './emitter.js'
import { SURFACE_PHYSICS } from './blocks.js'
import { everyBody } from './entityBox.js'

/*
 * Minecraft Java Edition movement, mapped onto noa's physics.
 *
 * Minecraft runs a fixed 20 ticks/sec integer-ish simulation. noa runs a
 * continuous force/impulse model. They don't map exactly, so the approach is:
 * match the numbers a player can actually FEEL, and let the rest differ.
 *
 * What players feel, in priority order:
 *   1. Jump apex 1.2522 blocks. This is why you clear a 1-block step but
 *      never a 2-block one. Every parkour jump in Minecraft is designed
 *      around this exact number.
 *   2. Ground speeds: walk 4.317 b/s, sprint 5.612, sneak 1.295.
 *   3. No hold-to-jump-higher, no air jumps, no stepping up full blocks.
 *
 * MC per-tick values converted to per-second:
 *   gravity   0.08 blocks/tick^2  ->  0.08 / 0.05^2  = 32 blocks/s^2
 *   jump vel  0.42 blocks/tick    ->  0.42 / 0.05    = 8.4 blocks/s
 *
 * MC IS THE TABLE OF MINECRAFT'S OWN NUMBERS, not just the movement ones.
 * Movement is most of it and is why the table lives in this file, but every
 * entry is a fact about MINECRAFT rather than about this engine, and that is
 * what makes them shareable. sky.js, particles.js, weather.js, itemEntity.js,
 * chat.js and items.js each used to restate the tick rate privately, under
 * five different names between them (TICKS_PER_SECOND three times, TPS,
 * TICK_MS). One fact, one spelling.
 */
export const MC = {
  /*
   * The clock everything in Minecraft is actually counted in. noa ticks at 30
   * Hz and this number is NOT that -- every per-tick value below is converted
   * to per-second at the point of definition precisely so that the two rates
   * never have to meet.
   */
  TICKS_PER_SECOND: 20,
  TICK_MS: 50,

  GRAVITY: 32,
  JUMP_APEX: 1.2522,

  WALK_SPEED: 4.317,
  SPRINT_SPEED: 5.612,
  SNEAK_SPEED: 1.295,

  PLAYER_HEIGHT: 1.8,
  PLAYER_WIDTH: 0.6,
  EYE_HEIGHT: 1.62,
  // Minecraft's sneaking eye height. The 0.35 drop from 1.62 is what you see.
  SNEAK_EYE_HEIGHT: 1.27,
  SNEAK_HEIGHT: 1.5,

  // Fall damage begins after 3 blocks, then 1 half-heart per extra block.
  FALL_SAFE_BLOCKS: 3,

  // Minecraft adds 0.2 blocks/tick forward on a sprint jump; per second that
  // is 0.2 / 0.05 = 4 blocks/s of extra horizontal launch.
  SPRINT_JUMP_BOOST: 4,

  /*
   * Creative flight, derived the same way the ground speeds were.
   *
   * Abilities.flyingSpeed is 0.05 blocks/tick of acceleration, and a flying
   * player keeps 0.91 of their horizontal velocity each tick, so the terminal
   * speed is 0.05 / (1 - 0.91) = 0.556 blocks/tick = 11.1 b/s. The number the
   * game actually settles at is 10.89, because the drag is applied on the
   * following tick rather than the same one; 10.89 is what players measure and
   * so 10.89 is what goes here. Sprinting doubles flyingSpeed outright.
   *
   * Vertical is a different pair of numbers: flyingSpeed * 3 per tick against
   * a much heavier 0.6 retention, giving 0.15 / 0.4 = 0.375 blocks/tick =
   * 7.5 b/s. Rising is deliberately slower than flying forwards -- that
   * asymmetry is a lot of why creative flight feels like flight and not like
   * a noclip camera.
   */
  FLY_SPEED: 10.89,
  FLY_SPRINT_SPEED: 21.78,
  FLY_VERTICAL_SPEED: 7.5,

  /*
   * The two retentions flight is built out of, kept as Minecraft's own
   * per-tick multipliers rather than as rates. `Player.travel` is four lines
   * long and both numbers are in it:
   *
   *   if (this.getAbilities().flying) {
   *     double d2 = this.getDeltaMovement().y;
   *     super.travel(input);                     // 0.91 lands on x and z here
   *     this.setDeltaMovement(...with(Y, d2 * 0.6));
   *   }
   *
   * The y line is the whole of vanilla's vertical flight model: it throws away
   * gravity AND the 0.98 vertical air drag that super.travel just applied, and
   * replaces them with a flat 0.6. The horizontal keeps travelInAir's 0.91,
   * which is the same 0.91 every airborne entity gets.
   *
   * They used to be one number here, FLY_VERTICAL_RESPONSE = 10.2, which was
   * 0.6 correctly resampled as a continuous rate (-ln(0.6) * 20 = 10.216) and
   * was applied only to the vertical. It was not wrong; it was half the model.
   * Nothing at all was applied horizontally, so a flier who let go of W kept
   * their speed against noa's airDrag alone and coasted 68 blocks over ten
   * seconds where vanilla stops inside 5.5 blocks and a second and a half.
   * That gap is what "the slowdown time of flying isn't a match" is.
   */
  FLY_RETENTION: 0.91,
  FLY_VERTICAL_RETENTION: 0.6,

  /* ---------------- ground you can slip on ---------------- *
   *
   * Block.getFriction, the number this file calls SLIPPERINESS because higher
   * means MORE slide: 0.6 for almost every block in the game, and the
   * exceptions live in blocks.js next to the blocks that have them.
   *
   * AIR_FRICTION is the 0.91 that multiplies it. LivingEntity.travelInAir:
   *
   *   float f = this.onGround() ? blockBelow.getFriction() : 1.0F;
   *   float f1 = f * 0.91F;
   *   ... setDeltaMovement(vec3.x * f1, d0 * f2, vec3.z * f1)
   *
   * so the per-tick horizontal retention is 0.546 on ordinary ground, 0.8918
   * on ice, and 0.91 in mid-air -- and the airborne figure does NOT depend on
   * what you jumped off, which is why nothing below touches air control.
   *
   * GROUND_ACCEL_NUMERATOR is getFrictionInfluencedSpeed's 0.21600002, the
   * other half of what slipperiness does:
   *
   *   speed * (0.21600002F / (friction * friction * friction))
   *
   * 0.6^3 is 0.216, so the constant exists precisely to make ordinary ground
   * come out at 1x. On ice the cube makes you push at 0.23x. Ice is slow to
   * start AND slow to stop; only the second half is the famous one.
   */
  DEFAULT_FRICTION: 0.6,
  AIR_FRICTION: 0.91,
  GROUND_ACCEL_NUMERATOR: 0.21600002,

  // Mid-jump steering authority, as a fraction of the ground figure. Named
  // because being IN A FLUID cancels it -- see installSpeedModes.
  AIR_CONTROL: 0.2,

  /* ---------------- fluids ---------------- *
   *
   * Movement in water and lava, from LivingEntity.travel()'s fluid branches.
   * Accelerations convert straight across -- a tick is 0.05 s, so b/tick^2
   * times 400 is b/s^2 -- and the two drag coefficients do NOT, which is the
   * long story in fluids.js and the reason they are derived from terminal
   * speeds instead. Read that before changing any of these six.
   */

  WATER_GRAVITY: 2,      // 0.005 b/tick^2, gravity 0.08 / 16
  LAVA_GRAVITY: 8,       // 0.02  b/tick^2, gravity 0.08 / 4
  SWIM_UP_ACCEL: 16,     // 0.04  b/tick^2, LivingEntity.jumpInLiquid, both fluids
  SINK_DOWN_ACCEL: 16,   // 0.04  b/tick^2, Entity.goDownInWater -- the exact
                         // mirror of jumpInLiquid, same magnitude, and like it
                         // there is no ground check: aiStep calls it on
                         // `isInWater() && isShiftKeyDown() && isAffectedByFluids()`.

  /*
   * HOW DEEP THE WATER HAS TO BE BEFORE IT TAKES YOUR JUMP AWAY, and this is
   * the number that says jumpInLiquid and jumpFromGround are an EITHER/OR
   * rather than a pair.
   *
   * LivingEntity.aiStep, 1.21.8 (Mojang-mapped, `sis1cat/minecraftsodium-1.21.8`,
   * src/net/minecraft/world/entity/LivingEntity.java around line 2758):
   *
   *   boolean bl = this.isInWater() && g > 0.0;
   *   double h = this.getFluidJumpThreshold();
   *   if (!bl || this.onGround() && !(g > h)) {
   *     if (!this.isInLava() || this.onGround() && !(g > h)) {
   *       if ((this.onGround() || bl && g <= h) && this.noJumpDelay == 0) {
   *         this.jumpFromGround();  this.noJumpDelay = 10;
   *       }
   *     } else this.jumpInLiquid(FluidTags.LAVA);
   *   } else this.jumpInLiquid(FluidTags.WATER);
   *
   * `g` is getFluidHeight, measured UP FROM THE BOTTOM OF THE BOX, and `h` is
   * Entity.getFluidJumpThreshold: `getEyeHeight() < 0.4 ? 0.0 : 0.4`. A 1.62
   * eye is comfortably over 0.4, so for a player it is a flat 0.4.
   *
   * Collapse those three branches for the one-fluid-at-a-time case this world
   * has -- water and lava separately, and both come out identical:
   *
   *   in a fluid: jumpFromGround iff (onGround && g <= 0.4), else jumpInLiquid
   *
   * So you can hop through a puddle of level-7 flow (1/9 of a block deep) and
   * you cannot leap out of a pond, because a still source is 8/9 = 0.889 deep
   * and that takes the jump away.
   *
   * The `onGround` half of that needs no code here. noa only hands out an
   * impulse when you are grounded or have air jumps left, and installPhysics
   * sets airJumps to 0 -- so an airborne body has no ground jump to take. What
   * the gate in fluids.js tests is the depth alone.
   */
  FLUID_JUMP_THRESHOLD: 0.4,

  /*
   * The VERTICAL VELOCITY RETENTION, which is the one number in this block
   * that is not an acceleration and not a speed.
   *
   * Entity.travel's fluid branch multiplies motion by `(f, 0.8, f)` in water
   * and `(0.5, 0.5, 0.5)` in lava -- note the vertical multiplier in water is
   * a hardcoded 0.8 even when the horizontal one is 0.9 for sprint-swimming.
   * This is a per-tick decay independent of gravity, and it is what sets how
   * fast a plunge bleeds off, which the terminal speeds below say nothing
   * about. fluids.js explains why noa's linear drag cannot reproduce both.
   */
  WATER_RETENTION: 0.8,
  LAVA_RETENTION: 0.5,

  /*
   * Terminal sinking speeds, in blocks/second. `v' = 0.8v - 0.005` settles at
   * 0.025 b/tick in water; `v' = 0.5v - 0.02` at 0.04 b/tick in lava. These
   * are what fluids.js solves its drag coefficients backwards from -- the
   * coefficients themselves are facts about noa, not about Minecraft, so they
   * do not live in this table.
   */
  WATER_SINK_SPEED: 0.5,
  LAVA_SINK_SPEED: 0.8,

  /*
   * And the same two with sneak held. goDownInWater stacks on top of the
   * passive sink, so the recurrence becomes `u' = 0.8u - 0.045` in water and
   * `u' = 0.5u - 0.06` in lava: 0.225 and 0.12 b/tick, 4.5 and 2.4 b/s.
   * Like the climb speeds, these are a CHECK rather than a tuning knob --
   * fluids.js reproduces them from the accelerations and drag above without
   * being told them, which is what says the model is right.
   */
  WATER_SNEAK_SINK_SPEED: 4.5,
  LAVA_SNEAK_SINK_SPEED: 2.4,

  // Horizontal. `v' = 0.8(v + 0.02)` settles at 0.1 b/tick in water and
  // `v' = 0.5(v + 0.02)` at 0.04 b/tick in lava. The wiki's measured figure
  // for water is 1.97; the code's own answer is used.
  SWIM_SPEED: 2.0,
  LAVA_SPEED: 0.8,

  /* ---------------- breath, drowning, burning ---------------- *
   *
   * Entity.getMaxAirSupply() is 300 ticks -- fifteen seconds, ten bubbles of
   * thirty ticks each. What is easy to get wrong is that damage does not start
   * when the bar empties: LivingEntity.baseTick keeps decrementing past zero
   * and only hurts you at exactly -20, so the first hit is at SIXTEEN seconds
   * and then every second after, because the counter is reset to 0 rather than
   * to -20 each time.
   */
  AIR_TICKS: 300,
  AIR_BUBBLES: 10,
  DROWN_GRACE_TICKS: 20,
  DROWN_DAMAGE: 2,
  // Entity.increaseAirSupply: +4 per tick, so empty to full takes 3.75 s.
  AIR_REFILL_PER_TICK: 4,

  /*
   * Entity.lavaHurt is 4 damage and setSecondsOnFire(15), called every tick
   * you are in lava. The i-frame rule in LivingEntity.hurt lets an equal hit
   * through after half the 20-tick window, so 4 lands every 10 ticks: EIGHT
   * health a second, not four. Burning afterwards is 1 a second, and is
   * suppressed while you are still in the lava.
   */
  LAVA_DAMAGE: 4,
  LAVA_DAMAGE_INTERVAL: 0.5,
  BURN_SECONDS: 15,
  FIRE_DAMAGE: 1,
  FIRE_INTERVAL: 1,
}

// Calibrated, not derived. See the comment at its use site.
const JUMP_IMPULSE = 9.585

/*
 * The fastest a sprint jump can launch you: a steady sprint plus one boost.
 * Derived from the two table entries either side of it, and the ceiling the
 * boost is clamped to. See the long comment at its use site for why a chain
 * of hops needs a ceiling at all.
 */
const SPRINT_JUMP_LAUNCH = MC.SPRINT_SPEED + MC.SPRINT_JUMP_BOOST

export function installPhysics(noa) {
  // noa's global gravity, not the engine option, so the number stays next to
  // the comment explaining where it came from.
  noa.physics.gravity = [0, -MC.GRAVITY, 0]

  // noa ships the player body with gravityMultiplier = 2, so the global
  // gravity above was silently doubling to 64 b/s^2 and every jump came out
  // at roughly a third of its proper height. This line is why the apex
  // arithmetic wasn't matching reality.
  noa.ents.getPhysics(noa.playerEntity).body.gravityMultiplier = 1

  const move = noa.ents.getMovement(noa.playerEntity)

  // THE INFINITE JUMP. noa's `debug: true` option runs a block it literally
  // labels "temp hacks for development", and one of those hacks is
  // `ents.getMovement(1).airJumps = 999`. Nothing to do with tuning.
  // We want Minecraft: exactly one jump, from the ground, no exceptions.
  move.airJumps = 0

  // Minecraft gives you a single upward impulse and gravity takes over.
  // noa by default keeps applying `jumpForce` for `jumpTime` ms while the
  // key is held, which is a Mario-style variable-height jump. Zeroing both
  // is what makes every jump identical regardless of how long you hold space.
  move.jumpForce = 0
  move.jumpTime = 0

  // The closed form sqrt(2*g*h) gives 8.95, but that is NOT what to use.
  // noa applies the jump impulse and a full step of gravity in the same
  // physics step, so roughly g/tickrate of the launch velocity is gone
  // before the body ever moves. Air drag then takes a little more.
  // This number was calibrated by binary-searching the real apex in a
  // browser until it landed on MC.JUMP_APEX. Re-run that if you change
  // gravity, the tick rate, or air drag.
  move.jumpImpulse = JUMP_IMPULSE

  move.maxSpeed = MC.WALK_SPEED

  // How hard we push toward maxSpeed. Minecraft reaches full walking speed
  // in a few ticks, so this wants to be brisk rather than floaty.
  move.moveForce = 40
  move.responsiveness = 15

  // Air control. Minecraft lets you steer mid-jump but barely: ground
  // acceleration is 0.1/tick against 0.02 in air, roughly a 1:5 ratio.
  // Getting this wrong is the single biggest "feels off" giveaway, because
  // too high lets you rescue jumps you should have missed.
  move.airMoveMult = MC.AIR_CONTROL

  move.standingFriction = 4
  move.runningFriction = 0

  return move
}

/*
 * Sprint and sneak, to Minecraft's actual rules.
 *
 * Minecraft starts a sprint two ways, and only one of them was implemented
 * before, which is why sprinting felt broken: almost nobody holds Ctrl, they
 * double-tap W.
 *
 *   - hold Ctrl while moving forward
 *   - double-tap forward within 7 ticks (350 ms), which LATCHES until
 *     something below cancels it
 *
 * A sprint ends when you release forward, start sneaking, or drop to 6 food
 * or less (3 shanks). Minecraft also breaks it when you collide head-on with
 * a wall; that one is skipped here because noa gives no clean head-on
 * collision signal and the effect is barely noticeable.
 *
 * The FOV kick is not decoration. Sprinting is only 30% faster than walking,
 * which is genuinely hard to perceive on its own -- the widening view is how
 * Minecraft tells you it engaged.
 */

// Minecraft's default vertical FOV, and the multiplier it applies to sprint.
const BASE_FOV_DEG = 70
const SPRINT_FOV_MULT = 1.1
const DOUBLE_TAP_MS = 350

/* ------------------------------------------------------------------ *
 * Minecraft's own recurrence, for the two places noa's model cannot reach
 * ------------------------------------------------------------------ */

/*
 * WHY THIS EXISTS WHEN THERE IS A REJECTION TWO HUNDRED LINES DOWN THAT
 * LOOKS LIKE IT FORBIDS IT. Read that one first: the sprint-jump clamp
 * rejects "raising drag to Minecraft's 0.91" because the flat-ground
 * 7.34 b/s average, MC.SPRINT_JUMP_BOOST and JUMP_IMPULSE are all balanced
 * against noa's drag, and moving it re-opens three calibrated numbers.
 *
 * THAT REJECTION STILL STANDS, and nothing here disturbs it, because it is
 * about ORDINARY GROUND AND MID-AIR -- which is where every calibrated
 * number in this file was measured. What follows runs in exactly two
 * situations, neither of them ordinary:
 *
 *   1. standing on a block whose slipperiness or speed factor is not the
 *      default -- ice, blue ice, slime, soul sand. Four block ids.
 *   2. flying.
 *
 * On grass, stone, and in mid-air over either, the lookup misses, this code
 * returns without touching a thing, and walking is bit-for-bit what it was.
 * That is the layering the ice question came down to, and it works because
 * BOTH of vanilla's per-block numbers can be expressed as a ratio against
 * the 0.6 case, and both ratios are exactly 1 at 0.6:
 *
 *   speed    (0.6/f)^3 * (1 - 0.91*0.6) / (1 - 0.91*f*speedFactor)
 *   retain   0.91 * f * speedFactor      (against 0.546 on ordinary ground)
 *
 * So MC.WALK_SPEED, MC.SPRINT_SPEED and MC.SNEAK_SPEED stay exactly where
 * they are and get multiplied by a number that is 1.0000 unless you are
 * standing on one of four blocks. Adopting vanilla's model wholesale --
 * replacing responsiveness/drag everywhere with (v + a) * f -- would have
 * been the other answer, and it re-opens jump apex, walk speed, sprint-jump
 * average and air control simultaneously to fix a block nobody has built
 * with yet. Rejected on the same grounds the drag change was.
 *
 * WHAT IT ACTUALLY DOES, where it is engaged, is stop using noa's movement
 * model rather than bend it. noa pushes with `responsiveness * (S - v)`
 * capped at moveForce, which reaches its target in about four ticks however
 * slippery the ground is -- and "how long it takes to reach the target" IS
 * the ice mechanic, so there is nothing to scale. So moveForce and both
 * ground frictions go to zero and the velocity is written directly from
 * Minecraft's recurrence instead. It is a takeover with a hard boundary,
 * not a tuning.
 *
 * NOT REPRODUCED, and each is a separate mechanic rather than a corner cut:
 *   - the slime block's bounce (Block.getJumpFactor 0.5 and the landing
 *     bounce-back in Entity.bounceUp). Slime's 0.8 slipperiness is here;
 *     its trampoline is not.
 *   - the honey block, which shares soul sand's 0.4 speed factor and adds a
 *     0.5 jump factor and wall-sliding. blocks.js has no honey block to
 *     hang it on -- the block does not exist in this world yet, and adding
 *     one needs a texture the build pipeline has to be told about.
 *   - frosted ice (0.98), which only exists under Frost Walker boots.
 */

/**
 * One axis, advanced by Minecraft's `v' = (v + a) * retain`.
 *
 * THE SUBTLETY IS THE DIVISION AT THE END, and it is the same
 * one-step-ahead correction fluids.js's dragFor() carries. This runs in
 * noa's 'tick' event, which fires AFTER the physics step -- so the number
 * written here is not the velocity that moves the player, it is the
 * velocity noa will apply its global airDrag to and THEN move with.
 * Dividing the drag back out means the displacement per tick is exactly
 * Minecraft's, which is the thing a player can actually see. Skip it and
 * everything here reads 0.33% slow.
 *
 * `retain` is Minecraft's per-20-Hz-tick figure and is resampled onto noa's
 * tick rate by exponent, which is legal for the same reason it is legal in
 * fluids.js's sinkTransient: it is a pure geometric decay with the
 * acceleration already separated out of it, so `r^(20*dt)` has the same
 * continuous rate at any tick rate.
 */
function driveAxis(body, axis, dtSec, retain, target, drag) {
  const f = retain ** (MC.TICKS_PER_SECOND * dtSec)
  const mult = Math.max(1 - (drag * dtSec) / body.mass, 0)
  const v = f * body.velocity[axis] + target * (1 - f)
  body.velocity[axis] = mult > 0 ? v / mult : v
}

/**
 * The speed multiplier and per-tick retention a block produces, as ratios
 * against ordinary ground. Both are exactly 1 and 0.546 when the block is
 * ordinary, which is what makes this safe to layer.
 */
export function surfaceModel({ friction, speedFactor }) {
  const retain = MC.AIR_FRICTION * friction * speedFactor
  const plain = MC.AIR_FRICTION * MC.DEFAULT_FRICTION
  /*
   * getFrictionInfluencedSpeed is `speed * (0.21600002 / friction^3)`, and
   * dividing that by itself at 0.6 cancels the 0.21600002 outright -- which
   * is the algebra that makes ordinary ground come out at exactly 1 rather
   * than at 0.99999998. MC.GROUND_ACCEL_NUMERATOR is kept in the table as
   * the fact it is; it is deliberately not used here.
   */
  const accel = (MC.DEFAULT_FRICTION / friction) ** 3
  return { retain, speedMult: (accel * (1 - plain)) / (1 - retain) }
}

/**
 * Ownership of the horizontal, for whoever is driving it this tick.
 *
 * ONE OWNER PER TICK, and that is the reason this is a thing at all rather
 * than two copies of four lines. Both callers have to zero move.moveForce to
 * get noa's push out of the way, and an earlier arrangement where flight and
 * the ground each set it themselves had them fighting over it on the tick a
 * flight ends: flight restores the force, the ground takes it away again,
 * and which one lands depends on call order.
 */
function createDrive(noa, move) {
  const player = noa.playerEntity

  // Captured from the live component, so installPhysics stays the one place
  // these are chosen.
  const base = {
    moveForce: move.moveForce,
    standing: move.standingFriction,
    running: move.runningFriction,
  }
  let held = false

  const hold = (on) => {
    if (on === held) return
    held = on
    /*
     * Both frictions, not just the standing one. noa's movement component
     * assigns `body.friction = runningFriction` while you hold a key and
     * `standingFriction` while you don't, and voxel-physics-engine's
     * applyFrictionByAxis is a Coulomb brake against the ground -- which on
     * ice is precisely the thing that must not happen. standingFriction 4 is
     * what stops the player in two ticks today.
     */
    move.moveForce = on ? 0 : base.moveForce
    move.standingFriction = on ? 0 : base.standing
    move.runningFriction = on ? 0 : base.running
  }

  const dragOf = (b) => (b.airDrag >= 0 ? b.airDrag : noa.physics.airDrag)

  /*
   * The block being STOOD ON. Vanilla asks
   * getBlockPosBelowThatAffectsMyMovement, which is the feet minus 0.5000001
   * -- the same "a resting player's y IS the block boundary" problem
   * installMovementFeedback's groundBlock and preventWalkingOffEdge both
   * solve, and solved the same way.
   *
   * ONE SAMPLE AT THE CENTRE, where fluids.js scans every column the box
   * covers. Vanilla samples one point too (the box centre, floored), so this
   * is fidelity rather than a shortcut: stand with half your body off the
   * edge of an ice block and vanilla gives you the block under your centre.
   */
  const under = () => {
    const p = noa.ents.getPositionData(player).position
    return noa.getBlock(Math.floor(p[0]), Math.floor(p[1] - FOOT_PROBE), Math.floor(p[2]))
  }

  return {
    /** Hand the horizontal back to noa. Idempotent. */
    release: () => hold(false),

    /** The non-default surface under the feet, or null for ordinary ground. */
    surface: () => SURFACE_PHYSICS.get(under()) ?? null,

    /**
     * Drive x and z toward `speed` along the movement heading.
     *
     * The heading is `move.heading`, which noa's receivesInputs builds from
     * the camera and the movement keys -- so strafing steers this, unlike the
     * sprint-jump boost below, which vanilla takes off the body yaw instead.
     * Here the heading is right: vanilla's moveRelative is fed the same
     * forward/strafe pair.
     */
    horizontal(b, dtSec, retain, speed) {
      hold(true)
      // `move.running` is false when no movement key is down, and heading
      // keeps its last value there -- so it has to gate the target, not just
      // the speed.
      const t = move.running ? speed : 0
      const drag = dragOf(b)
      driveAxis(b, 0, dtSec, retain, t * Math.sin(move.heading), drag)
      driveAxis(b, 2, dtSec, retain, t * Math.cos(move.heading), drag)
    },

    /** Drive y toward `target` (signed). Nothing to take over: noa's
     *  movement component never touches the vertical except to jump. */
    vertical(b, dtSec, retain, target) {
      driveAxis(b, 1, dtSec, retain, target, dragOf(b))
    },
  }
}

/*
 * Flight, for creative and spectator.
 *
 * Minecraft's flight is not "gravity off". Three things have to change
 * together or it reads as a bug rather than as flying:
 *
 *   1. Gravity stops, but only while airborne under your own power.
 *   2. Full air control. Walking physics gives you a fifth of your ground
 *      acceleration in the air (airMoveMult, see installPhysics) because
 *      steering a jump should be hard; steering a flight should not be.
 *   3. Vertical velocity is DRIVEN, not impulsed. Space and Shift ease you
 *      toward a fixed climb/dive rate and releasing both eases you back to a
 *      hover -- which is why a flying player stops dead in the air instead of
 *      arcing like a jump.
 *
 * BOTH AXES RUN MINECRAFT'S OWN RECURRENCE (see createDrive above), and the
 * horizontal one is the fix for "flying does not slow down like vanilla".
 * Vanilla's two retentions are 0.91 sideways and 0.6 vertically, and the
 * asymmetry is most of the feel: let go of W at cruise and you glide about
 * 5.5 blocks over a second and a half, but let go of Space and you stop
 * inside half a block. Only the vertical half of that was modelled before,
 * and the horizontal had NO decay at all beyond noa's global airDrag -- 68
 * blocks of coast over ten seconds, measured, and never actually stopping.
 *
 * The toggle is Minecraft's: double-tap jump within 7 ticks. It hangs off the
 * keydown EVENT for the same reason the sprint double-tap does -- a tap can
 * begin and end between two 30 Hz ticks and polled state never sees it.
 *
 * NOCLIP is the one thing here that reaches outside the player. noa asks
 * `noa.physics.testSolid` whether a voxel blocks a body, and there is no
 * per-body override, so a spectator swaps that function for one that says
 * "nothing is solid". That is GLOBAL: it would also un-collide any other
 * physics body in the world. There is exactly one today (the player). If mobs
 * or thrown items ever exist, this has to become a per-body flag inside
 * voxel-physics-engine instead.
 *
 * Rejected: removing the physics component from the player while spectating,
 * which is what noclip "should" be. perspective.js, survival.js and this file
 * all read `getPhysics(player).body` every tick and would throw on the first
 * one.
 */
function createFlight(noa, move, drive) {
  const player = noa.playerEntity
  const body = () => noa.ents.getPhysics(player).body

  // The real solidity test, kept so noclip can be switched back off.
  const solidTest = noa.physics.testSolid
  const groundAirMoveMult = move.airMoveMult

  let mayFly = false
  let alwaysFlying = false   // spectator: flight is the mode, not a toggle
  let flying = false
  let lastJumpPress = -Infinity
  /*
   * Has this flight ever actually left the ground?
   *
   * Landing ends flight, but you almost always START a flight standing still
   * on the ground -- double-tapping space is how you take off. Without this
   * flag the take-off tick sees `atRestY() < 0`, calls that a landing, and
   * cancels the flight you just began, so the double-tap appears to do
   * nothing at all.
   */
  let liftedOff = false

  const setFlying = (on) => {
    if (flying === on) return
    flying = on
    liftedOff = false
    body().gravityMultiplier = on ? 0 : 1
    move.airMoveMult = on ? 1 : groundAirMoveMult
    // Leaving flight with residual lift would launch you; leaving it with
    // residual fall speed would bill you for fall damage you didn't earn.
    if (!on) body().velocity[1] = 0
  }

  const setNoClip = (on) => {
    noa.physics.testSolid = on ? () => false : solidTest
  }

  noa.inputs.down.on('jump', () => {
    if (!mayFly || alwaysFlying) return
    const now = performance.now()
    if (now - lastJumpPress < DOUBLE_TAP_MS) {
      setFlying(!flying)
      // Consume the pair, or a triple-tap toggles twice.
      lastJumpPress = -Infinity
      return
    }
    lastJumpPress = now
  })

  return {
    get flying() { return flying },
    get mayFly() { return mayFly },

    /** Called by gamemode.js with the capability row for the new mode. */
    setAbilities(caps) {
      mayFly = caps.mayFly
      alwaysFlying = caps.startsFlying
      setNoClip(caps.noClip)
      if (!mayFly) setFlying(false)
      else if (caps.startsFlying) setFlying(true)
      // Creative keeps whatever flight state you were already in, which is
      // vanilla: /gamemode creative twice does not drop you out of the sky.
    },

    /**
     * Driven from installSpeedModes' tick so there is one tick handler.
     * `speed` is the flight gear for this tick, passed in rather than read
     * off move.maxSpeed so the sprint gear change lands on the tick it
     * happens rather than the one after.
     */
    tick(dt, S, speed) {
      if (!flying) return
      const b = body()

      /*
       * Landing ends flight in creative -- vanilla clears abilities.flying the
       * moment you touch ground, which is how you stop flying without ever
       * finding the double-tap. A spectator never lands, because nothing is
       * solid to them.
       */
      if (!alwaysFlying) {
        if (b.atRestY() >= 0) liftedOff = true
        else if (liftedOff) { setFlying(false); return }
      }

      const dtSec = dt / 1000

      /*
       * Space and Shift together cancel, which is vanilla: LocalPlayer.aiStep
       * builds an integer from (jump ? +1 : 0) + (sneak ? -1 : 0) and skips
       * the impulse entirely when it comes out zero.
       */
      const up = (S.jump ? 1 : 0) - (S.sneak ? 1 : 0)
      drive.vertical(b, dtSec, MC.FLY_VERTICAL_RETENTION, up * MC.FLY_VERTICAL_SPEED)
      drive.horizontal(b, dtSec, MC.FLY_RETENTION, speed)
    },
  }
}

export function installSpeedModes(noa, move, survival, fluids = null) {
  /*
   * THE EFFECTS SEAM.
   *
   * Speed, Slowness, Jump Boost, Slow Falling and Levitation all change
   * movement, and this file's header is explicit that its constants are
   * fitted backwards from Minecraft and are not to be disturbed. So they are
   * MULTIPLIERS applied on top of whatever the tick below decided, and nothing
   * in the table changes: MC.WALK_SPEED is still 4.317 and JUMP_IMPULSE is
   * still the browser-calibrated 9.585, and Speed I is 4.317 * 1.2.
   *
   * A NULL-OBJECT DEFAULT, not an optional chain at four call sites. Physics
   * is installed long before effects.js exists -- main.js builds the movement
   * before it has anything to hand it -- so this starts as the identity and is
   * replaced by `setEffects` once there is something to ask. The tick below
   * then has no branch in it at all, which matters because it runs 30 times a
   * second and because a `?.` that silently returns undefined into an
   * arithmetic expression is how you get a NaN velocity.
   *
   * Rejected: reaching into effects.js from here. That makes physics depend on
   * the status system, and the status system already depends on physics for
   * MC. Passing the multipliers in keeps the arrow pointing one way.
   */
  let effects = {
    speedMultiplier: () => 1,
    jumpMultiplier: () => 1,
    gravityMultiplier: () => 1,
    levitationSpeed: () => 0,
  }

  noa.inputs.bind('sprint', 'ControlLeft')
  noa.inputs.bind('sneak', 'ShiftLeft')

  const camera = noa.rendering.camera
  const baseFov = (BASE_FOV_DEG * Math.PI) / 180
  camera.fov = baseFov

  const drive = createDrive(noa, move)
  const flight = createFlight(noa, move, drive)

  let sprinting = false
  let lastForwardPress = -Infinity

  /*
   * Sneak camera drop. Minecraft's eye height is 1.62 standing and 1.27
   * sneaking, a 0.35 block drop, and seeing the view dip is most of how
   * sneaking reads as sneaking.
   *
   * noa points its camera at a separate `cameraTarget` entity that follows
   * the player with a fixed offset, so the drop is a change to that offset
   * rather than anything touching the player body.
   */
  const follow = noa.ents.getState(noa.camera.cameraTarget, 'followsEntity')
  let eyeHeight = MC.EYE_HEIGHT

  /*
   * Double-tap detection hangs off noa's keydown EVENT, not off polling
   * inputs.state each tick. A quick tap can begin and end entirely between
   * two ticks, so polling misses the first press outright and the double-tap
   * never registers -- which is exactly how this failed the first time.
   */
  noa.inputs.down.on('forward', () => {
    const now = performance.now()
    if (now - lastForwardPress < DOUBLE_TAP_MS) sprinting = true
    lastForwardPress = now
  })

  noa.on('tick', (dt) => {
    const S = noa.inputs.state
    const forward = S.forward

    /*
     * While flying, Shift is descend rather than sneak. Every sneak rule below
     * -- the slow walk, the camera drop, the edge protection -- would fight
     * that, so sneak is read through this instead of off S directly.
     */
    const sneaking = S.sneak && !flight.flying

    if (S.sprint && forward) sprinting = true

    // Cancels, in Minecraft's order of precedence.
    if (!forward) sprinting = false
    if (sneaking) sprinting = false
    if (survival && survival.food <= 6 && !flight.flying) sprinting = false

    /*
     * Being in a fluid beats everything except flying. Minecraft's fluid
     * branch in LivingEntity.travel replaces the whole ground-movement path
     * rather than scaling it, so sneaking or sprinting in water gets you the
     * same 2 b/s -- there is no slow swim and no fast swim without the crawl
     * pose, which this world does not have.
     *
     * The value comes back pre-compensated for fluid drag; see fluids.js's
     * maxSpeed() for why assigning the raw 2.0 measures 20% slow.
     */
    const swim = flight.flying ? null : fluids?.maxSpeed() ?? null

    /*
     * Full steering authority in a fluid, and this is fidelity rather than
     * convenience. Minecraft's water branch calls moveRelative with the same
     * input weight whether or not your feet are on anything -- there is no
     * air-control penalty underwater, because you are not in the air. Leaving
     * airMoveMult at 0.2 caps the push at moveForce*0.2 = 8, and the cap binds
     * before the speed target does: swimming then settles at whatever that
     * force balances the drag at, 1.73 b/s, regardless of what maxSpeed says.
     * That is how this first measured 13% slow with an exactly right maxSpeed.
     */
    if (!flight.flying) move.airMoveMult = swim !== null ? 1 : MC.AIR_CONTROL

    // Sneak beats sprint when both are somehow active. Sprinting doubles
    // flight speed rather than adding to it, which is Minecraft's rule and is
    // why creative flight has two very different gears.
    const flySpeed = sprinting ? MC.FLY_SPRINT_SPEED : MC.FLY_SPEED
    move.maxSpeed = flight.flying
      ? flySpeed
      : swim !== null ? swim
      : sneaking ? MC.SNEAK_SPEED
      : sprinting ? MC.SPRINT_SPEED
      : MC.WALK_SPEED

    /*
     * Speed and Slowness, applied AFTER the gear is chosen, which is what
     * makes them compose the way vanilla's ADD_MULTIPLIED_TOTAL does: Speed I
     * while sprinting is 5.612 * 1.2 = 6.734 and not 4.317 * 1.2 * 1.3. That
     * is not a rounding difference -- it is 6.734 against 6.735 here by luck,
     * but at Speed II sprinting it is 7.857 against 7.857 and at Slowness II
     * SWIMMING the two disagree outright, because the swim branch replaces the
     * ground speed rather than scaling it.
     *
     * FLIGHT IS SCALED TOO, deliberately, and vanilla agrees: flyingSpeed is
     * multiplied by the movement-speed attribute in Player.travel, so Speed
     * makes creative flight faster in the real game as well.
     */
    const speedEffect = effects.speedMultiplier(noa.playerEntity)
    move.maxSpeed *= speedEffect

    /*
     * Jump Boost, as a scale on the CALIBRATED impulse rather than a recompute
     * from an apex. See the header: 9.585 is not sqrt(2gh), it absorbs a full
     * step of gravity that noa applies on the launch tick, and anything that
     * re-derived it from a target height would throw that away.
     */
    move.jumpImpulse = JUMP_IMPULSE * effects.jumpMultiplier(noa.playerEntity)

    const body = noa.ents.getPhysics(noa.playerEntity).body

    /*
     * Exactly one thing owns the horizontal each tick, and it is decided
     * here. flight.tick RETURNS WITHOUT DRIVING if the flight ended this tick
     * -- landing clears it -- which is why the ground branch below re-reads
     * flight.flying rather than assuming an else.
     */
    /*
     * THE SCALED GEAR, not the raw one, and this line is the whole of a bug
     * that the comment above described as already fixed.
     *
     * `move.maxSpeed` is scaled by Speed and Slowness a few lines up and its
     * comment says "FLIGHT IS SCALED TOO, deliberately" -- and it was, on a
     * field nothing reads while you are flying. createDrive zeroes moveForce
     * for the duration of a flight, so noa's movement component never pushes
     * and never consults maxSpeed; the number that actually moves a flier is
     * the one handed to flight.tick, and that was the unscaled local. Two
     * writers, one fact, and the writer with the comment on it was the one
     * nobody read.
     *
     * Kept as a separate argument rather than re-read off move.maxSpeed
     * inside flight.tick, for the reason tick's own docblock gives: the
     * sprint gear change has to land on the tick it happens.
     */
    flight.tick(dt, S, flySpeed * speedEffect)

    /*
     * Ice, slime and soul sand. The lookup misses for every ordinary block,
     * and a miss releases the takeover and leaves walking exactly as it was
     * -- which is the whole safety argument, so it is one branch rather than
     * a scale factor applied everywhere. Airborne is excluded because
     * vanilla's air friction is a flat 0.91 that does not care what you
     * jumped off; being in a fluid is excluded because fluids.js owns that
     * case outright.
     */
    const surface = flight.flying || swim !== null || body.atRestY() >= 0
      ? null : drive.surface()
    if (surface) {
      const { retain, speedMult } = surfaceModel(surface)
      drive.horizontal(body, dt / 1000, retain, move.maxSpeed * speedMult)
    } else if (!flight.flying) {
      drive.release()
    }

    // Minecraft eases this over a few ticks rather than snapping, which is
    // what stops it reading as a glitch.
    const targetEye = sneaking ? MC.SNEAK_EYE_HEIGHT : MC.EYE_HEIGHT
    eyeHeight += (targetEye - eyeHeight) * Math.min(1, (dt / 1000) * 14)
    follow.offset[1] = eyeHeight

    // Ease the FOV rather than snapping it, the way Minecraft does.
    const targetFov = sprinting ? baseFov * SPRINT_FOV_MULT : baseFov
    camera.fov += (targetFov - camera.fov) * Math.min(1, (dt / 1000) * 9)

    /*
     * Sprint-jumping. Minecraft adds a forward impulse on the tick a sprint
     * jump starts, which is why sprint-jumping covers noticeably more ground
     * than sprinting alone -- and the entire basis of parkour distance.
     *
     * THE CONDITION IS "a jump is starting this tick", NOT "space was just
     * pressed". It used to be the key's rising edge, and that is only the same
     * thing for the first jump of a run: hold space down -- which is how
     * everyone actually bunny-hops -- and noa's movement component starts a
     * fresh jump on every tick you are on the ground, while the rising edge
     * fires exactly once. So the second hop onwards got no boost and you
     * settled back to plain sprint speed, which is the "sprint-jumping has
     * friction" symptom: measured 5.58 b/s with space held against 7.25 b/s
     * when the boost landed on every jump. Vanilla polls the jump key while
     * grounded and has no edge in it at all.
     *
     * `S.jump && grounded` is the same test noa's movement component makes one
     * step earlier in this very tick (entity systems run before the tick
     * event), so the boost lands on exactly the ticks an impulse does -- once
     * per ground contact, because the next tick is airborne.
     *
     * THAT EQUIVALENCE WAS RE-VERIFIED against noa 0.33 while chasing the
     * hill-jolt below, because it is the thing everyone suspects first and it
     * is not the bug. receivesInputs (order 20) copies inputs.jump into
     * move.jumping, movement (order 30) reads it in the same tick, and its
     * grounded branch clears _isJumping before testing it -- so every grounded
     * tick with space held starts a brand new noa jump, exactly when this
     * fires. Traced over staircases of every pitch from 45 degrees to 1-in-5:
     * the longest run of consecutive grounded-with-jump ticks was 1, every
     * time. There is nothing to de-duplicate.
     *
     * THE CLAMP IS THE FIX, and the jolt is a compounding bug, not a
     * double-fire one. The boost is an unconditional `+= 4 b/s` on a velocity
     * that is only ever brought back down by air drag, and air drag needs the
     * whole hop to do it: a flat-ground hop lands 15 ticks later at 5.60, so
     * the launch is always 5.60 + 4 = 9.60 and the cycle is a closed loop.
     * CLIMBING SHORTENS THE HOP. You land on a tread a block higher, a third
     * of the way through the arc, still carrying 6.05 -- and the next boost
     * takes you to 10.05, which lands you higher again at 6.28, then 10.28,
     * then 10.39. Measured on a stone staircase, and the excess over the flat
     * launch is exactly the jolt: a hop that is visibly faster than the hop
     * before it, only on a slope, which is precisely the report. The same
     * mechanism runs away outright in a 2-block-high pocket, where the hop is
     * six ticks and the chain reached 39 b/s -- seven times sprint speed.
     *
     * Minecraft has no clamp and does not need one: its horizontal air drag
     * is 0.91 per tick, three times fiercer than what noa's movement component
     * manages against a capped push, so a vanilla chain is back at sprint
     * speed before the next jump however early it lands. This is that outcome
     * stated directly. The ceiling is SPRINT_SPEED + SPRINT_JUMP_BOOST -- what
     * one sprint jump from a steady sprint gives you, both numbers already in
     * the table -- so it is derived, not tuned, and on flat ground it is a
     * no-op: the launch there measures 9.605 against a ceiling of 9.612.
     *
     * Rejected: Minecraft's own LivingEntity.noJumpDelay, ten ticks of jump
     * cooldown, which bounds the contact rate at the source and is the more
     * faithful rule. Ten Minecraft ticks is 0.5 s and noa's flat-ground hop
     * cycle is fifteen 30 Hz ticks, which is also 0.5 s -- the cooldown would
     * expire on the exact tick the player lands, so whether hop two keeps its
     * boost would come down to float residue in the countdown. The regression
     * guard for the bunny-hop fix is "a boost on every hop"; a rule that
     * decides that by a rounding error is not worth its extra fidelity.
     *
     * Rejected: raising drag to Minecraft's 0.91 so the chain converges on its
     * own. That is the real difference, but drag is what the flat-ground
     * 7.34 b/s average is balanced on, and MC.SPRINT_JUMP_BOOST and
     * JUMP_IMPULSE are both calibrated against it. Changing it re-opens three
     * numbers to fix one.
     */
    // Not while flying: space is climb there, not jump, and a flier can sit
    // grounded with it held -- which under this condition would hand out a
    // boost every single tick.
    // Not in a fluid either: space is the swim climb there, and a player
    // standing on a lake bed with it held would collect a boost every tick.
    if (S.jump && sprinting && !flight.flying && swim === null && body.atRestY() < 0) {
      /*
       * ALONG WHERE YOU LOOK, NOT ALONG WHERE YOU ARE STEERING.
       *
       * Minecraft's is `-sin(getYRot()) * 0.2, cos(getYRot()) * 0.2` in
       * LivingEntity.jumpFromGround, and getYRot() is the BODY YAW -- the way
       * the player faces. The movement input never enters it. Strafing while
       * you sprint-jump therefore gives you exactly the same forward impulse
       * as not strafing; the sideways part of the hop has to be earned a tick
       * at a time out of the 0.02/tick air acceleration.
       *
       * This used to read `move.heading`, and noa's receivesInputs builds
       * that by rotating the camera heading by the movement keys -- 45 degrees
       * for W+D. So the whole 4 b/s went in diagonally and 2.828 of it was
       * sideways, IN ONE TICK, against the 0.368 b/s that one tick of vanilla
       * air-strafing buys. Measured on the flat pad: sprint east at 5.575,
       * press D and Space together, and the launch tick read
       * vz = -2.828 with vx only 8.403. Held down, that settles to about
       * vz = -4.0 for the rest of the flight. That is the "I press jump and a
       * side button and launch to the side" report, and it is 7.7x vanilla.
       *
       * Rejected: blaming airMoveMult, which is the obvious suspect and is
       * innocent. One tick of air strafe here buys 0.2464 b/s sideways against
       * 1.2318 on the ground -- a ratio of 0.2000, which is Minecraft's
       * 0.02/0.1 to four decimals. The steering authority was never wrong;
       * only the impulse's direction was.
       */
      const h = noa.camera.heading
      body.velocity[0] += Math.sin(h) * MC.SPRINT_JUMP_BOOST
      body.velocity[2] += Math.cos(h) * MC.SPRINT_JUMP_BOOST

      /*
       * Scaled, not truncated per axis. The boost goes in along the facing
       * and the velocity being clamped may point somewhere else entirely --
       * strafing, or coming off a wall -- so clamping x and z independently
       * would rotate the player's direction of travel as a side effect. One
       * scalar on both keeps the direction and only takes the magnitude down.
       */
      const speed = Math.hypot(body.velocity[0], body.velocity[2])
      if (speed > SPRINT_JUMP_LAUNCH) {
        const k = SPRINT_JUMP_LAUNCH / speed
        body.velocity[0] *= k
        body.velocity[2] *= k
      }
    }

    if (sneaking) preventWalkingOffEdge(noa)
  })

  /*
   * Slow Falling and Levitation, on every body rather than on the player --
   * the water-drag and jump fixes both had to be extended past
   * noa.playerEntity and this is the same shape, so it is written that way
   * from the start.
   *
   * GRAVITY IS A PER-BODY MULTIPLIER in noa, not a global, which is lucky:
   * installPhysics already sets the player's to 1 to undo noa's default of 2,
   * so writing it every tick is the same kind of assignment and not a new
   * mechanism.
   *
   * LEVITATION FIGHTS THE INTEGRATOR and this is the honest, partial version.
   * Vanilla replaces the gravity step outright inside travelInAir:
   *   deltaY += (0.05 * (amplifier + 1) - deltaY) * 0.2
   * noa has no such seam -- its solver applies gravity, drag and collision in
   * one step we do not get between -- so gravity is switched OFF for a
   * levitating body and the same exponential approach is run here against the
   * body's velocity. The 0.2 per Minecraft tick is resampled to noa's dt the
   * same way createDrive does it, because a fixed 0.2 against a variable dt
   * approaches at whatever the frame rate happens to be.
   *
   * AND THIS TICK IS THE LOWEST-RANKED WRITER OF THAT FIELD, which is the
   * whole of the one `continue` below. Writing gravity every tick is only
   * "the same kind of assignment" as the one-off further up this file if
   * nobody else is assigning it too, and three other places are: `setFlying`
   * (0 while you fly), respawn.js's `stopCorpse` (0 while you are dead), and
   * npc.js's frozen branch (0 while Evan hangs over an unloaded chunk). This
   * loop landed after all of them and runs after all of them, so it won, and
   * creative flight quietly stopped holding anyone up -- you flew and fell at
   * the same time, at a full 32 b/s^2.
   *
   * IT REACHED THE SUITE AS A TARGETING BUG, which is why this comment is
   * long. Three assertions in 73-targeting.spec.js say "the crosshair is on
   * nothing" while aiming a level camera at a torch from a block and a half
   * away, and every one of them had sunk out of the air before the aim was
   * read. Nothing in targeting.js, highlight.js or blockMeshes.js was wrong;
   * the rays fired directly at `noa.pick` in the same file never stopped
   * passing, because those do not need the player to be anywhere.
   *
   * npc.js hit exactly this bug against exactly this field one commit later
   * and fixed it by taking a `gravityFor` provider, so the shape had already
   * been named here: two owners, one field, no error, later writer wins.
   *
   * THE RULE IS "ZERO IS SOMEBODY ELSE'S". Every other owner of this field
   * writes 0 and only 0 -- they all mean "no gravity at all, and not because
   * of a potion" -- and each hands ownership back by writing a real
   * multiplier again (`setFlying(false)` writes 1, `releaseCorpse` restores
   * what it saved). So a body sitting at 0 that this loop did not zero is not
   * this loop's to touch. Slow Falling's multiplier is 0.125 and never 0, so
   * the only 0 written here is Levitation's, and `levitated` is the record of
   * having written it.
   *
   * Rejected: a claim/release registry that respawn.js and npc.js call into.
   * It is the general answer, and it is three more files edited to say
   * something the values already say without ambiguity.
   *
   * Rejected: remembering the last value written and skipping when the field
   * has changed since. It reads like the same idea and it wedges -- flight
   * hands back a literal 1 rather than whatever this loop last wrote, so a
   * body that flew while under Slow Falling would never be written again.
   */
  /** Bodies whose current gravity of 0 is Levitation's, which is to say ours. */
  const levitated = new WeakSet()
  noa.on('tick', (dt) => {
    const dtSec = dt / 1000
    for (const entity of everyBody(noa)) {
      const body = noa.ents.getPhysics(entity)?.body
      if (!body) continue
      // Flight, death, or the NPC floor guard is driving this body. Leave it
      // alone entirely: a frozen corpse must not levitate either.
      if (body.gravityMultiplier === 0 && !levitated.has(body)) continue
      const lift = effects.levitationSpeed(entity)
      if (lift > 0) {
        body.gravityMultiplier = 0
        levitated.add(body)
        // 1 - 0.8^(ticks elapsed): the same resampling createDrive uses, so a
        // 30 Hz frame and a 60 Hz frame reach the target at the same RATE.
        const k = 1 - 0.8 ** (MC.TICKS_PER_SECOND * dtSec)
        body.velocity[1] += (lift - body.velocity[1]) * k
      } else {
        levitated.delete(body)
        // Vanilla's gate: Slow Falling only applies while descending, so it
        // softens the landing without floating the jump.
        body.gravityMultiplier = effects.gravityMultiplier(entity, body.velocity[1] <= 0)
      }
    }
  })

  return {
    isSprinting: () => sprinting,
    flight,
    /** Hand the movement system something that knows about status effects. */
    setEffects(next) { effects = next },
    ...installMovementFeedback(noa),
  }
}

/*
 * Footsteps and landings, as events.
 *
 * These are movement facts, not sound: "the player's feet hit block X" is
 * something a footprint decal, a network packet or a screen shake would want
 * just as much as an audio clip does. Nothing here knows what a sound is.
 *
 * FOOTSTEP CADENCE is Minecraft's, and it is distance-based rather than
 * time-based. Minecraft accumulates `sqrt(dx^2 + dz^2) * 0.6` and fires a step
 * each time that crosses a whole number, so a step lands every 1/0.6 blocks
 * travelled. Getting this from a timer instead would be the obvious shortcut
 * and would sound wrong immediately: sprinting wouldn't quicken the rhythm and
 * sneaking wouldn't slow it.
 *
 * LANDING reports an impact SPEED, not a fall distance. survival.js already
 * tracks peak height to work out fall damage, and re-deriving that here would
 * be the same bookkeeping in two places, drifting apart the first time either
 * is touched. Vertical velocity is right there in the physics body and is what
 * feedback actually wants to scale against. If survival.js ever publishes its
 * own landing event with a real fall distance, that's the better source and
 * this should defer to it.
 */
const STEP_DISTANCE = 1 / 0.6

function installMovementFeedback(noa) {
  const footstep = createEmitter()
  const land = createEmitter()

  const player = noa.playerEntity
  let travelled = STEP_DISTANCE // fire on the first step out of spawn, not 1.6 blocks in
  let lastX = null, lastZ = null
  let wasOnGround = true
  let fallSpeed = 0

  /*
   * The block being STOOD ON, which is one below the feet -- and the bias
   * matters. A resting player's y sits exactly on the block boundary, so
   * Math.floor(y) samples the air they're standing in rather than the ground
   * they're standing on. Same trick preventWalkingOffEdge uses below.
   */
  const groundBlock = (pos) =>
    noa.getBlock(Math.floor(pos[0]), Math.floor(pos[1] - 0.1), Math.floor(pos[2]))

  noa.on('tick', () => {
    const body = noa.ents.getPhysics(player).body
    const pos = noa.ents.getPositionData(player).position
    const onGround = body.atRestY() < 0

    if (!onGround) {
      // Sampled every airborne tick because the contact itself zeroes the
      // velocity -- read it after landing and it's always 0.
      fallSpeed = Math.max(0, -body.velocity[1])
    }

    if (onGround && !wasOnGround) {
      land.emit({ position: [pos[0], pos[1], pos[2]], blockId: groundBlock(pos), speed: fallSpeed })
      // A landing counts as a step's worth of noise, so the next footstep
      // shouldn't also fire half a block later.
      travelled = 0
      fallSpeed = 0
    }
    wasOnGround = onGround

    if (lastX !== null && onGround) {
      const dx = pos[0] - lastX
      const dz = pos[2] - lastZ
      travelled += Math.sqrt(dx * dx + dz * dz)
      if (travelled >= STEP_DISTANCE) {
        travelled = 0
        const blockId = groundBlock(pos)
        // Zero is air: you can be "at rest" against a block edge with nothing
        // underneath, and a footstep on nothing has no material to sound like.
        if (blockId) footstep.emit({ position: [pos[0], pos[1], pos[2]], blockId })
      }
    }
    lastX = pos[0]
    lastZ = pos[2]
  })

  return {
    /** @param fn ({ position, blockId }) => void */
    onFootstep: footstep.on,
    /** @param fn ({ position, blockId, speed }) => void, speed in blocks/sec downward. */
    onLand: land.on,
  }
}

/*
 * Sneak edge-protection: Minecraft refuses to let you walk off a ledge while
 * sneaking. On an island surrounded entirely by void this stops being a
 * nicety and becomes the difference between building near the rim and
 * repeatedly dying at it.
 *
 * IT RESTORES POSITION, it does not cancel motion. The first version zeroed
 * body.velocity and that was NOT enough: noa's movement component pushes with
 * body.applyForce(), and a queued force is integrated on the next physics step
 * regardless of what velocity was set to. So each tick re-accelerated from
 * zero and you crept off the rim at about a third speed -- a brake rather than
 * a barrier. Measured: sneaking east from x=39.5 ended at x=40.58, y=62.73.
 * Off the edge, just slowly.
 *
 * Done PER AXIS on purpose, and for two reasons that point the same way.
 * Undoing the whole horizontal move the moment any edge is near freezes you at
 * a corner and feels broken; putting back only the axis that left solid ground
 * lets you still slide along the rim, which is what Minecraft does.
 */

// How far under the feet to look for support.
const FOOT_PROBE = 0.1

let safeX = null
let safeZ = null

function preventWalkingOffEdge(noa) {
  const player = noa.playerEntity
  const body = noa.ents.getPhysics(player).body

  // Airborne, Minecraft lets you fall whether or not sneak is held.
  if (body.atRestY() >= 0) {
    safeX = safeZ = null
    return
  }

  const dat = noa.ents.getPositionData(player)
  const [x, y, z] = dat.position
  const half = dat.width / 2
  const below = Math.floor(y - FOOT_PROBE)

  /*
   * ANY part of the player's box over solid ground counts as support, which
   * means you can overhang an edge a long way while sneaking.
   *
   * That is not a looseness to be tightened -- it is the entire mechanic.
   * Minecraft's Entity.maybeBackOffFromEdge shortens the movement until the
   * box still finds something beneath it, and the box is 0.6 wide against a
   * 1.0 block, so a sneaking player really can hang most of their body over
   * the void. Bridging depends on it: you walk to the edge, overhang, and
   * place a block into the space under your own feet.
   *
   * An earlier version required all four corners, reasoning that a sliver of
   * overlap should not count as standing. It stopped the player with the box
   * fully on the block -- and made bridging impossible, which is the whole
   * reason anyone sneaks.
   */
  const grounded = (px, pz) => {
    for (const dx of [-half, half]) {
      for (const dz of [-half, half]) {
        if (noa.getBlock(Math.floor(px + dx), below, Math.floor(pz + dz)) !== 0) return true
      }
    }
    return false
  }

  if (grounded(x, z)) {
    safeX = x
    safeZ = z
    return
  }

  // We're over nothing. Work out which axis did it and undo just that one.
  const xIsSafe = safeX !== null && grounded(safeX, z)
  const zIsSafe = safeZ !== null && grounded(x, safeZ)

  let nx = x
  let nz = z
  if (xIsSafe) {
    nx = safeX
    body.velocity[0] = 0
  } else if (zIsSafe) {
    nz = safeZ
    body.velocity[2] = 0
  } else {
    if (safeX !== null) { nx = safeX; body.velocity[0] = 0 }
    if (safeZ !== null) { nz = safeZ; body.velocity[2] = 0 }
  }

  if (nx !== x || nz !== z) noa.ents.setPosition(player, [nx, y, nz])
}

