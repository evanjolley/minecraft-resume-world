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
  /*
   * WHICH SCREENS ARE OPEN, and this Set is the whole point of it living here.
   *
   * Four conditions around the codebase used to answer that question by
   * enumerating each other -- main.js's lostPointerLock guard and its
   * click-to-recapture guard, and chat.js twice. N screens each keeping a list
   * of N-1 peers, and the copies had already drifted apart: menu.js's Escape
   * guard named the inventory and death and not chat, and got away with it
   * only because chat's capture-phase handler eats the key first. The day a
   * fifth screen lands (signs and written books, docs/FUTURE.md item 1) every
   * one of those conditions is silently wrong and nothing fails.
   *
   * This file already knew the answer. Every screen calls lock('chat'),
   * lock('inventory'), lock('menu'), lock('dead') on the way in and unlock on
   * the way out, so the roster is a by-product of the thing they already do.
   * A new screen is correct in all four places for free, which is the only
   * version of this that stops recurring.
   *
   * ORDERING, which is load-bearing and is why this can be trusted at all:
   * every screen locks BEFORE it touches pointer lock. It has to -- releasing
   * the lock fires lostPointerLock synchronously and main.js reads this to
   * decide whether that event opens the pause menu. Both chat.js and
   * inventory.js comment the same trap about their own open flags; it is the
   * same trap and the same answer.
   *
   * NOT simply `reasons`, though today it is the same set. A lock is "stop
   * reading my input" and a screen is "there is a panel in front of the
   * world", and those coincide right now because every holder is a panel.
   * When something locks input without being a screen -- a cutscene, a
   * teleport settle -- it passes `{ screen: false }` and the four guards stay
   * right. Rejected: a hand-maintained SCREENS list of known reasons here.
   * That is the same four-place list with three places deleted, and signs
   * would still have to remember to edit it.
   */
  const screens = new Set()

  /*
   * WHEN THE LAST SCREEN CLOSED, which is a different question from whether
   * one is open, and main.js needs both.
   *
   * UNVERIFIED -- this models a browser nothing in this repo has ever run in.
   * The pause menu does not open on a keydown at all: main.js opens it off
   * lostPointerLock, because Chrome exits pointer lock on Escape and does NOT
   * deliver the key to the page. inventory.js's Escape comment records that
   * FIREFOX DOES deliver it. If that is right, Firefox runs both: the
   * synchronous keydown handler closes the open screen, and the pointer-lock
   * change arrives afterwards as its own task -- by which time "is a screen
   * open" is false and the guard waves through a pause menu that opens on top
   * of the world you just got back.
   *
   * A boolean cannot express that. The guard has to be able to ask "did a
   * screen close JUST NOW", so the answer is a timestamp.
   *
   * Read from a source comment, not from a browser: Firefox is not in the
   * suite's projects (test/playwright.config.js runs chromium and webkit) and
   * docs/browsers.md §5 is explicit that no headless engine grants real
   * pointer lock anyway. Do not record this as fixed until somebody presses
   * Escape in a real Firefox window.
   */
  let lastScreenClosedAt = -Infinity

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
    /**
     * @param {string} reason
     * @param {{ screen?: boolean }} [opts] `screen: false` for a lock that is
     *   not a panel in front of the world. See the note on `screens` above.
     */
    lock(reason, { screen = true } = {}) {
      reasons.add(reason)
      if (screen) screens.add(reason)
      apply()
    },
    unlock(reason) {
      reasons.delete(reason)
      // Only a SCREEN closing stamps the clock, and only if it was really
      // open -- unlock() is called unconditionally in a couple of places.
      if (screens.delete(reason)) lastScreenClosedAt = performance.now()
      apply()
    },
    has(reason) { return reasons.has(reason) },
    get locked() { return reasons.size > 0 },

    /** Is any screen up? The question main.js asks before opening the menu. */
    anyScreenOpen() { return screens.size > 0 },

    /**
     * Is any screen up OTHER than mine? What a screen asks about its peers --
     * "may I open", "may I take the cursor back" -- without naming one of
     * them. Passing your own reason rather than reading it off a `this` is
     * what keeps this a plain query: chat asks the same question whether or
     * not chat is currently holding a lock, which matters because it calls
     * this on the way out, after its own unlock has already run.
     */
    otherScreenOpen(mine) {
      for (const reason of screens) if (reason !== mine) return true
      return false
    },

    /**
     * Did a screen close inside the last `ms`? See lastScreenClosedAt above
     * for the Firefox ordering this exists for, and for the fact that the
     * ordering is read rather than observed.
     */
    screenClosedWithin(ms) { return performance.now() - lastScreenClosedAt < ms },
  }
}
