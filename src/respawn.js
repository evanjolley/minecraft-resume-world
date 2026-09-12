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
   * THE reason respawning used to drop you into a half-drawn world.
   *
   * inputLock stops you steering while dead but deliberately leaves gravity
   * alone, so the corpse kept accelerating down the void for as long as the
   * death screen was up -- measured at y = -904 after six seconds. noa loads
   * chunks in a 3D box around you (chunkRemoveDistance [6, 5]), so somewhere
   * past 160 blocks below the island every single island chunk falls outside
   * the vertical remove distance and is unloaded. Terrain meshes went 63 -> 0
   * inside two seconds of dying. Respawn then teleported you home onto a
   * world with no geometry left, and you sat watching ~63 chunks regenerate
   * and re-mesh.
   *
   * Note the shape of it: dying is NOT what unloads the world. Death happens
   * at y = -60, which is chunk -2 against the island's chunk 2 -- four apart,
   * well inside the remove distance of 5. Nothing is evicted at that point.
   * It is the seconds you then spend reading "You Died!" that do it, which is
   * why the bug looked like it had nothing to do with how long you waited.
   *
   * So: stop the body at the moment of death and every island chunk stays
   * resident however long you linger, and respawn is instant because there is
   * nothing to reload.
   *
   * This is also the more faithful behaviour, not just the convenient one.
   * Minecraft loads chunks by COLUMN -- there is no vertical unload at all --
   * so a corpse falling through the void there never costs you the world.
   * noa's 3D chunking is the engine difference, and freezing the corpse is
   * the smallest change that puts Minecraft's observable behaviour back.
   *
   * Rejected: raising chunkRemoveDistance. It cannot work -- the fall is
   * unbounded, so any distance is exceeded by waiting a little longer -- and
   * those constants are calibrated, not knobs.
   *
   * Rejected: covering the world with a loading screen until the chunks come
   * back. That hides the symptom and still costs you the seconds.
   */
  let savedGravity = null

  const stopCorpse = () => {
    const b = body()
    b.velocity[0] = 0
    b.velocity[1] = 0
    b.velocity[2] = 0
    /*
     * Saved rather than assumed to be 1, because physics.js owns this field
     * too: creative flight sets it to 0. Restoring a hardcoded 1 would hand a
     * dead flying player gravity back on respawn.
     */
    if (savedGravity === null) savedGravity = b.gravityMultiplier
    b.gravityMultiplier = 0
  }

  const releaseCorpse = () => {
    if (savedGravity === null) return
    body().gravityMultiplier = savedGravity
    savedGravity = null
  }

  /*
   * Death freezes input through the shared lock, which also releases pointer
   * lock so the cursor comes back and the Respawn button is clickable. The
   * world keeps running behind the screen.
   */
  const setFrozen = (on) => {
    if (on) inputLock.lock('dead')
    else inputLock.unlock('dead')
    if (on) {
      noa.container.setPointerLock(false)
      stopCorpse()
    } else {
      releaseCorpse()
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
