/*
 * Input lock, shared by every UI layer that needs the player to stop moving.
 *
 * Crucially this does NOT pause the world. noa keeps ticking, the day/night
 * cycle keeps running, and once there are other players they keep moving
 * around while your menu is open -- which is how Minecraft multiplayer
 * behaves. Only YOUR input is detached.
 *
 * Reference-counted by reason rather than a single boolean, because the
 * states genuinely overlap: you can die while the inventory is open. With a
 * boolean, closing the inventory would hand control back to a corpse.
 */
export function createInputLock(noa) {
  const reasons = new Set()
  const player = noa.playerEntity
  const baseSensitivity = noa.camera.sensitivityMult
  let applied = false

  /*
   * Detaching the movement component covers walking and nothing else, because
   * it only covers the inputs NOA reads. Our own tick handlers poll
   * noa.inputs.state straight off the keyboard -- sneak for the camera drop
   * and the edge guard, sprint for the FOV -- and that object keeps tracking
   * keys whatever is attached. So Shift in an open menu still crouched the
   * camera, and a double-tapped W still widened the FOV, both while the
   * player stood perfectly still.
   *
   * The fix is at the source rather than at each reader: while locked, key
   * PRESSES never reach game-inputs' bookkeeping at all, so state is honestly
   * false and every poller is correct without knowing this exists.
   *
   * filterEvents is game-inputs' own hook for this, and returning false from
   * it skips the whole update -- no state write, no press count, no event.
   *
   * Rejected: wrapping noa.inputs.state in a Proxy that returns false while
   * locked. It reads like the tidier version and it corrupts the library,
   * because game-inputs READS state[name] to decide whether to write it
   * (`if (XOR(currstate, ct))`). Feed that a lie and a key released during a
   * menu never gets written back to false, so it stays latched forever and
   * the player is stuck walking into a wall. Cost me a passing test to find.
   *
   * Rejected: noa.inputs.disabled, which suppresses the binding events but
   * still tracks state -- the exact half that does not help here. chat.js
   * rejected it for the same reason.
   *
   * RELEASES ARE NEVER FILTERED, whatever is open. A key pressed before the
   * menu opened has already been counted, and swallowing its keyup would
   * leave the count stuck above zero -- the same latch, by a different route.
   */
  const PRESS_SURVIVES_LOCK = new Set([
    // E closes the inventory, and the inventory is itself a lock holder.
    // Filtering this is how you build a screen nobody can get out of.
    'inventory',
  ])

  noa.inputs.filterEvents = (ev, bindingName) => {
    if (!applied) return true
    if (!String(ev && ev.type).endsWith('down')) return true
    return PRESS_SURVIVES_LOCK.has(bindingName)
  }

  /*
   * Minecraft calls KeyMapping.releaseAll() when a screen opens, which is why
   * closing one while still holding W leaves you standing there until you let
   * go and press again. Synthesising the keyup rather than zeroing state by
   * hand is what keeps game-inputs' press counts in step: it runs the same
   * path a real release does. A keyup for a key it never saw pressed is a
   * no-op inside the library, so this cannot leak the other way.
   *
   * Mouse buttons are skipped -- they are not keyboard codes, and holding
   * fire into a menu is already handled by interact.js's own guard.
   */
  const releaseHeldKeys = () => {
    for (const [name, codes] of Object.entries(noa.inputs.getBindings())) {
      if (!noa.inputs.state[name]) continue
      for (const code of codes) {
        if (code.startsWith('Mouse')) continue
        window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }))
      }
    }
  }

  const apply = () => {
    const locked = reasons.size > 0
    if (locked === applied) return
    applied = locked

    if (locked) {
      // Before anything else, and deliberately after `applied` is set so the
      // filter above is already live: nothing pressed can re-latch behind it.
      releaseHeldKeys()

      // Zeroing sensitivity is enough to stop looking: noa's
      // applyInputsToCamera early-returns when it is 0.
      noa.camera.sensitivityMult = 0

      // Detaching the component is the only reliable way to stop movement.
      // `receivesInputs` re-copies noa.inputs.state into the movement
      // component every tick, so zeroing movement fields gets overwritten on
      // the very next tick. This is why holding W into a menu used to keep
      // you running.
      noa.ents.removeComponent(player, noa.ents.names.receivesInputs)

      const move = noa.ents.getMovement(player)
      move.running = false
      move.jumping = false

      // Kill horizontal momentum too, or you coast for a second after the
      // menu opens. Vertical is left alone so you still fall normally.
      const body = noa.ents.getPhysics(player).body
      body.velocity[0] = 0
      body.velocity[2] = 0
    } else {
      noa.camera.sensitivityMult = baseSensitivity
      if (!noa.ents.hasComponent(player, noa.ents.names.receivesInputs)) {
        noa.ents.addComponent(player, noa.ents.names.receivesInputs)
      }
    }
  }

  return {
    lock(reason) { reasons.add(reason); apply() },
    unlock(reason) { reasons.delete(reason); apply() },
    has(reason) { return reasons.has(reason) },
    get locked() { return reasons.size > 0 },
  }
}
