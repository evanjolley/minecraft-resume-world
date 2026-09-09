import { SPAWN, VOID_Y } from './island.js'

/*
 * Void death and respawn.
 *
 * With open void on all sides, falling off is the first thing every visitor
 * does, deliberately. In Minecraft that kills you rather than teleporting
 * you home, so it routes through survival state and the death screen.
 */
export function installRespawn(noa, survival) {
  const player = noa.playerEntity
  const body = () => noa.ents.getPhysics(player).body

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
    survival.reset()
  }

  noa.on('tick', () => {
    if (survival.dead) return
    const y = noa.ents.getPositionData(player).position[1]
    if (y <= VOID_Y) survival.onVoidFall()
  })

  document.getElementById('respawn-btn').addEventListener('click', respawn)

  return respawn
}
