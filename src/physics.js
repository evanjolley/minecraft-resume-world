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

  // Fall damage begins after 3 blocks, then 1 half-heart per extra block.
  FALL_SAFE_BLOCKS: 3,
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

/**
 * Sprint and sneak. Minecraft's bindings: Ctrl sprints, Shift sneaks.
 * Sneak also halves nothing else here yet; edge-protection (refusing to walk
 * off a ledge while sneaking) is a separate behaviour, noted in the README.
 */
export function installSpeedModes(noa, move) {
  noa.inputs.bind('sprint', 'ControlLeft')
  noa.inputs.bind('sneak', 'ShiftLeft')

  noa.on('tick', () => {
    const sprinting = noa.inputs.state.sprint
    const sneaking = noa.inputs.state.sneak

    // Sneak wins when both are held, same as Minecraft.
    move.maxSpeed = sneaking ? MC.SNEAK_SPEED
      : sprinting ? MC.SPRINT_SPEED
      : MC.WALK_SPEED

    if (sneaking) preventWalkingOffEdge(noa)
  })
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

// Probed from the player's LEADING edge, not their centre. Testing the centre
// (or "is any corner still supported") lets you creep forward until your rear
// corner leaves the block, which strands you hanging off the rim instead of
// stopping on it. Small, since half the player width is already added.
const EDGE_LOOKAHEAD = 0.1

function preventWalkingOffEdge(noa) {
  const player = noa.playerEntity
  const body = noa.ents.getPhysics(player).body

  // Only while actually standing on something. Airborne, Minecraft lets you
  // fall regardless of whether sneak is held.
  if (body.atRestY() >= 0) return

  const dat = noa.ents.getPositionData(player)
  const [x, y, z] = dat.position
  const half = dat.width / 2

  // The block layer directly beneath the feet. The small bias matters: the
  // player's y sits exactly ON the boundary when resting, and Math.floor of
  // an exact integer would sample the block they're standing IN, not on.
  const below = Math.floor(y - 0.1)

  // Is the ground solid under the strip the leading edge is about to cross?
  // Both ends of that strip are checked so a corner overhanging a diagonal
  // gap still counts as unsupported.
  const supported = (px, pz) =>
    noa.getBlock(Math.floor(px), below, Math.floor(pz - half)) !== 0 ||
    noa.getBlock(Math.floor(px), below, Math.floor(pz + half)) !== 0

  const supportedZ = (px, pz) =>
    noa.getBlock(Math.floor(px - half), below, Math.floor(pz)) !== 0 ||
    noa.getBlock(Math.floor(px + half), below, Math.floor(pz)) !== 0

  const v = body.velocity
  const reach = half + EDGE_LOOKAHEAD

  if (v[0] !== 0 && !supported(x + Math.sign(v[0]) * reach, z)) v[0] = 0
  if (v[2] !== 0 && !supportedZ(x, z + Math.sign(v[2]) * reach)) v[2] = 0
}
