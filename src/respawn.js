import { SPAWN, VOID_Y } from './island.js'
import { deathMessage } from './deathMessages.js'
import { cancelPersistentLock } from './menu.js'

/*
 * Void death, input freeze, and respawn.
 *
 * WHAT CHANGED WITH THE IMPORTED WORLD. This used to be the FIRST thing every
 * visitor did: the island floated in open void and walking off the rim was
 * the intended introduction. The world is now a 128x128 cut of real Minecraft
 * terrain with barrier walls on all four sides and unbreakable bedrock under
 * it, so there is nowhere left to fall off. Void death is still real, still
 * below the world floor at y=-64 (island.js: VOID_Y = -70), and still routes
 * through survival state and the death screen -- but it is now reachable only
 * by /tp, exactly as it is in Minecraft.
 *
 * The code below is unchanged and deliberately so. Falling is still how you
 * die from a height, the corpse freeze still matters (see the long note
 * under it), and a world that gains a hole in its floor tomorrow -- a
 * creative-mode dig, a portal, a build -- finds this already working.
 */
/**
 * @param playerName  a FUNCTION returning the local player's bare name, not a
 *   string. Same trap chat.js documents under `speaker`: the name changes
 *   while the page is open (the NPC asks for it), so a string captured here
 *   would put whatever you were called at boot on every death screen forever.
 *   The roster stays the owner; this only asks.
 */
export function installRespawn(noa, survival, inputLock, { playerName = () => '' } = {}) {
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
   * a couple of blocks below wherever you entered the void, which is well
   * inside the remove distance of 5 chunks. Nothing is evicted at that point.
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
      // Ask for the lock to be dropped, and cancel anything still asking for
      // it. Neither is load-bearing on its own -- see the invariant below.
      cancelPersistentLock()
      noa.container.setPointerLock(false)
      stopCorpse()
    } else {
      releaseCorpse()
    }
  }

  survival.onChange((s) => setFrozen(s.dead))

  /*
   * THE INVARIANT, rather than a fourth guard: while `survival.dead` is true,
   * the pointer is never locked.
   *
   * setFrozen above releases the lock on the way into death, and that is
   * enough only when nothing is already asking for it. The case it cannot
   * cover is `/kill`, and it is worth spelling out because it looks like it
   * should already work:
   *
   *   Enter submits the chat line -> chat.js closes the bar and, because you
   *   are still alive at that instant, asks for pointer lock back -> the
   *   command then runs and kills you -> setFrozen calls setPointerLock(false).
   *
   * That last call does nothing at all. Browsers grant pointer lock
   * ASYNCHRONOUSLY, so the request is still in flight and
   * `document.pointerLockElement` is still null. micro-game-shell compares
   * what you want against that -- `if (!!want === hasPL) return` -- decides
   * you already have no lock, and never reaches exitPointerLock. A moment
   * later the browser grants the lock that was asked for while you were
   * alive, and the death screen is up with no cursor to press Respawn with.
   * Same shape for menu.js's requestLockPersistently, whose retry timer can
   * outlive by two seconds the menu-close that started it.
   *
   * So it is enforced where it cannot be raced instead of at each caller: the
   * ONLY way to become locked is a grant, and every grant emits this event.
   * Hand the lock straight back if it lands on a corpse and no future caller
   * has to remember that death exists. This runs on pointerlockchange, ahead
   * of paint, so there is no frame drawn with the cursor missing.
   *
   * Rejected: another `if (survival.dead) return` in chat.js and menu.js.
   * Three files already reason about pointer lock, and a guard only covers
   * the callers you thought of -- whereas this bug is a request made
   * legitimately, while alive, that simply lands too late.
   */
  noa.container.on('gainedPointerLock', () => {
    if (survival.dead) noa.container.setPointerLock(false)
  })

  /*
   * THE SAME SENTENCE CHAT GETS, under "You Died!", which is what vanilla's
   * DeathScreen shows. Both sides call deathMessage() rather than one reading
   * the other's rendered text, so there is exactly one place the wording lives.
   *
   * Hung off onDeath, not onChange, and that is the whole point of the death
   * event existing: onChange fires for every heal and hunger tick and carries
   * no cause, so a subscriber there could only ever write "died".
   *
   * ORDER, and it is subtle. survival commits state and fires changed() BEFORE
   * died.emit, so hud.js has already unhidden #death by the time this runs.
   * Both happen inside one tick, ahead of paint, so the screen never shows a
   * frame with an empty line -- but the margin is one synchronous call stack,
   * not a guarantee, which is why the text is written on the event rather than
   * scheduled.
   */
  const label = document.getElementById('death-message')
  survival.onDeath((detail) => { label.textContent = deathMessage(playerName(), detail) })

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

    // Cleared on the way out, not on the way in. The screen is hidden either
    // way, so this buys nothing visually -- it buys that the element never
    // holds a stale sentence from a death two respawns ago, which is the kind
    // of thing that makes a later test pass for the wrong reason.
    label.textContent = ''

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
