import { createEmitter } from './emitter.js'

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
 */

export const MC = {
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

  // The 0.6 vertical retention above, expressed as the continuous rate that
  // reaches the same terminal speed in the same time: 0.6 per 1/20 s means
  // velocity decays as e^(-10.2t).
  FLY_VERTICAL_RESPONSE: 10.2,
}

// Calibrated, not derived. See the comment at its use site.
const JUMP_IMPULSE = 9.585

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
  move.airMoveMult = 0.2

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
export function createFlight(noa, move) {
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

    /** Driven from installSpeedModes' tick so there is one tick handler. */
    tick(dt, S) {
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

      const target = ((S.jump ? 1 : 0) - (S.sneak ? 1 : 0)) * MC.FLY_VERTICAL_SPEED
      const k = 1 - Math.exp(-(dt / 1000) * MC.FLY_VERTICAL_RESPONSE)
      b.velocity[1] += (target - b.velocity[1]) * k
    },
  }
}

export function installSpeedModes(noa, move, survival) {
  noa.inputs.bind('sprint', 'ControlLeft')
  noa.inputs.bind('sneak', 'ShiftLeft')

  const camera = noa.rendering.camera
  const baseFov = (BASE_FOV_DEG * Math.PI) / 180
  camera.fov = baseFov

  const flight = createFlight(noa, move)

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

    flight.tick(dt, S)

    // Sneak beats sprint when both are somehow active. Sprinting doubles
    // flight speed rather than adding to it, which is Minecraft's rule and is
    // why creative flight has two very different gears.
    move.maxSpeed = flight.flying
      ? (sprinting ? MC.FLY_SPRINT_SPEED : MC.FLY_SPEED)
      : sneaking ? MC.SNEAK_SPEED
      : sprinting ? MC.SPRINT_SPEED
      : MC.WALK_SPEED

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
     */
    const body = noa.ents.getPhysics(noa.playerEntity).body
    // Not while flying: space is climb there, not jump, and a flier can sit
    // grounded with it held -- which under this condition would hand out a
    // boost every single tick.
    if (S.jump && sprinting && !flight.flying && body.atRestY() < 0) {
      const h = move.heading
      body.velocity[0] += Math.sin(h) * MC.SPRINT_JUMP_BOOST
      body.velocity[2] += Math.cos(h) * MC.SPRINT_JUMP_BOOST
    }

    if (sneaking) preventWalkingOffEdge(noa)
  })

  return { isSprinting: () => sprinting, flight, ...installMovementFeedback(noa) }
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
 * Done PER AXIS on purpose. Cancelling the whole horizontal velocity the
 * moment any edge is near freezes you in place at a corner and feels broken;
 * cancelling only the component that heads out over nothing lets you still
 * slide along the rim, which is what Minecraft does.
 */

/*
 * Sneak edge-protection.
 *
 * The first version zeroed body.velocity and that was NOT enough. noa's
 * movement component pushes with body.applyForce(), and a queued force is
 * integrated on the next physics step regardless of what velocity was set to.
 * So each tick re-accelerated from zero and you crept off the rim at about a
 * third speed -- a brake rather than a barrier. Measured: sneaking east from
 * x=39.5 ended at x=40.58, y=62.73. Off the edge, just slowly.
 *
 * So this restores POSITION instead of trying to cancel motion. Per axis, so
 * sliding along a rim still works: only the axis that left solid ground gets
 * put back.
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

