import { SPAWN, VOID_Y } from './island.js'

/*
 * Void death, input freeze, and respawn.
 *
 * With open void on all sides, falling off is the first thing every visitor
 * does, deliberately. In Minecraft that kills you rather than teleporting
 * you home, so it routes through survival state and the death screen.
 */
export function installRespawn(noa, survival, inputLock) {
  const player = noa.playerEntity
  const body = () => noa.ents.getPhysics(player).body

  /*
   * Death freezes input through the shared lock, which also releases pointer
   * lock so the cursor comes back and the Respawn button is clickable. The
   * world keeps running behind the screen.
   */
  const setFrozen = (on) => {
    if (on) inputLock.lock('dead')
    else inputLock.unlock('dead')
    if (on) noa.container.setPointerLock(false)
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
