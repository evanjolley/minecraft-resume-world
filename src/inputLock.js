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

  const apply = () => {
    const locked = reasons.size > 0
    if (locked === applied) return
    applied = locked

    if (locked) {
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
