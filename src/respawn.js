import { SPAWN, VOID_Y } from './island.js'

/*
 * Void death, input freeze, and respawn.
 *
 * With open void on all sides, falling off is the first thing every visitor
 * does, deliberately. In Minecraft that kills you rather than teleporting
 * you home, so it routes through survival state and the death screen.
 */
export function installRespawn(noa, survival) {
  const player = noa.playerEntity
  const body = () => noa.ents.getPhysics(player).body

  // Captured, not hardcoded to 1, so a future sensitivity setting survives
  // a death without being silently reset.
  const baseSensitivity = noa.camera.sensitivityMult

  let frozen = false

  /*
   * Freezing a dead player takes three separate things, and missing any one
   * of them leaves the death screen half-broken:
   *
   *  1. Release pointer lock. Without this the cursor stays captured and the
   *     Respawn button is literally unclickable -- the bug that started this.
   *  2. Zero camera sensitivity. noa's applyInputsToCamera() early-returns
   *     when sensitivity is 0, which stops looking around for free.
   *  3. Detach the `receivesInputs` component. That component copies
   *     noa.inputs.state into the movement component every tick, so merely
   *     zeroing movement fields gets overwritten on the next tick. Removing
   *     the component is the only reliable stop. Road not taken: zeroing
   *     noa.inputs.state each tick, which races with the component depending
   *     on system ordering.
   */
  const setFrozen = (on) => {
    if (on === frozen) return
    frozen = on

    if (on) {
      noa.camera.sensitivityMult = 0
      noa.ents.removeComponent(player, noa.ents.names.receivesInputs)

      const move = noa.ents.getMovement(player)
      move.running = false
      move.jumping = false

      // Kill horizontal drift so the corpse doesn't keep sliding.
      const b = body()
      b.velocity[0] = 0
      b.velocity[2] = 0

      noa.container.setPointerLock(false)
    } else {
      noa.camera.sensitivityMult = baseSensitivity
      if (!noa.ents.hasComponent(player, noa.ents.names.receivesInputs)) {
        noa.ents.addComponent(player, noa.ents.names.receivesInputs)
      }
    }
  }

  survival.onChange((s) => setFrozen(s.dead))

  const respawn = () => {
    noa.ents.setPosition(player, SPAWN)

    // SUBTLE, and the bug you'd hit without it: teleporting moves you but
    // does nothing to your momentum. After an 80-block drop you're falling
    // fast, so you'd respawn and punch straight back down through the
    // island at that same speed.
    const b = body()
    b.velocity[0] = 0
    b.velocity[1] = 0
    b.velocity[2] = 0

    // And this one: fall tracking has to be cleared too, or the survival
    // system lands you at spawn and immediately bills you for the fall you
    // already died from.
    survival.clearFallTracking()

    // reset() flips `dead` back to false, which unfreezes via onChange.
    survival.reset()

    // MUST be called synchronously inside the click handler. Browsers only
    // grant pointer lock from a real user gesture, so deferring this into a
    // promise or timeout gets it silently refused and leaves you cursor-bound
    // on a live world.
    noa.container.setPointerLock(true)
  }

  noa.on('tick', () => {
    if (survival.dead) return
    const y = noa.ents.getPositionData(player).position[1]
    if (y <= VOID_Y) survival.onVoidFall()
  })

  document.getElementById('respawn-btn').addEventListener('click', respawn)

  return respawn
}
