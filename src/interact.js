import { BLOCK_BY_ID } from './blocks.js'
import { itemPlaces } from './items.js'
import { createEmitter } from './emitter.js'

/*
 * Breaking and placing blocks.
 *
 * Minecraft's survival mining is a hold-to-break with a per-block duration,
 * not creative mode's instant break. The `hardness` numbers in blocks.js are
 * already bare-handed seconds, so this is just a timer.
 *
 * The fiddly part is cancellation. Progress has to reset when you release
 * the button OR when your crosshair moves to a different block, otherwise
 * you can "bank" progress by chewing on several blocks in turn and pop them
 * all instantly. Tracking the target's coordinates, not just whether a
 * target exists, is what closes that hole.
 *
 * Breaking, placing and mining progress are all published as events. Sounds
 * and particles are the first subscribers, but they won't be the last -- once
 * there's a network layer, "a block changed" is exactly what has to go over
 * the wire, and it should not have to be re-derived by diffing the world.
 *
 * NOTHING HERE WRITES TO THE WORLD DIRECTLY. Every break and every place is a
 * request to authority.js, which is the single function a server will one day
 * validate. That is also why adventure mode's refusal is not spelled out in
 * this file: it is one branch there rather than three here. The capability
 * checks that DO appear below are user interface, not enforcement -- they stop
 * the crack overlay from animating a break that is going to be refused.
 */

/*
 * Creative's break rate. Vanilla breaks instantly but rate-limits a held
 * button to one block every 5 game ticks, which is 250 ms; without that,
 * dragging across a wall at 30 fps deletes it faster than you can see.
 */
const CREATIVE_BREAK_INTERVAL_MS = 250

export function installInteraction(noa, inv, fx, authority) {
  const swing = fx.swing
  let breaking = null // { x, y, z, id, elapsed, total }
  let creativeCooldown = 0

  /*
   * SUBTLE, and the reason a break clears its own state before awaiting: a
   * granted request still resolves a microtask late, and the tick loop does
   * not wait. Leaving `breaking` set across the await means the next tick
   * starts a second break on a block that is already on its way out, and the
   * player is billed twice for it.
   */
  let pending = false

  /*
   * Is some UI layer holding the player's input?
   *
   * This used to test `inv.open`, which was only ever right by accident: the
   * inventory was the first screen to exist. inputLock is the shared,
   * reference-counted answer -- the inventory, the pause menu, the death
   * screen and chat all register with it -- so mining and placing now stop for
   * all four rather than just the one. Mining while the pause menu was open
   * and mining while dead were both possible before this.
   *
   * SUBTLE: inputLock detaches noa's movement component, which is why WASD
   * already stopped. It does NOT stop game-inputs from tracking the mouse, so
   * `inputs.state.fire` stays live under an open chat box and left-clicking
   * would happily mine through it. The two paths look the same and aren't.
   */
  const busy = () => fx.inputLock.locked

  const blockBreak = createEmitter()   // { id, position }
  const blockPlace = createEmitter()   // { id, position }
  const breakProgress = createEmitter() // { id, position, frac, dt }

  // Minecraft has no progress bar. Feedback is the crack overlay on the
  // block plus the arm swinging, so progress drives those instead.
  //
  // `dt` rides along because every subscriber so far needs to rate-limit
  // itself (the mining sound to every 4 ticks, crumb particles to their own
  // cadence) and this fires once per frame. Handing them the frame time is
  // cheaper and less error-prone than each keeping its own clock.
  const showProgress = (frac, pos, id = 0, dt = 0) => {
    fx.crack.update(frac, pos)
    breakProgress.emit({ id, position: pos ?? null, frac, dt })
  }

  const sameBlock = (a, pos) => a && a.x === pos[0] && a.y === pos[1] && a.z === pos[2]

  /*
   * Punching. Minecraft swings your arm on EVERY left click, whether or not
   * you hit anything -- swinging at thin air is most of what the button does.
   * Previously the swing only fired when a block was targeted, so clicking at
   * the sky did nothing at all.
   */
  noa.inputs.down.on('fire', () => { if (!busy()) swing.trigger() })

  /**
   * Take a block out of the world. The one exit from this module for a break,
   * whether it took nine tenths of a second or no time at all.
   *
   * Everything that follows the break -- the drop, the event, the sound -- is
   * inside the `ok` branch on purpose: a refused request must leave no trace,
   * and the day a server refuses one, that is the branch that already handles
   * it correctly.
   */
  const breakBlock = async (id, position) => {
    pending = true
    try {
      const res = await authority.requestBlockChange({ id: 0, position, cause: 'break' })
      if (!res.ok) return
      // Minecraft drops a different block than the one mined for some types:
      // grass gives dirt, stone gives cobblestone. Creative drops nothing at
      // all -- you already have every block.
      if (!authority.caps().infiniteResources) {
        inv.add(BLOCK_BY_ID.get(id)?.drops ?? id, 1)
      }
      // Emitted after the world has actually changed, so a subscriber that
      // reads the block back sees air rather than the block it's reacting to.
      // The id it wants is in the payload precisely because it's gone.
      blockBreak.emit({ id, position })
    } finally {
      pending = false
    }
  }

  /** Bedrock. Without this the timer runs forever and the crack overlay sits
   *  frozen on stage 0 while you chew on it. */
  const breakable = (def) => def && def.hardness !== Infinity

  noa.on('tick', (dt) => {
    swing.update(dt / 1000)
    creativeCooldown = Math.max(0, creativeCooldown - dt)
    if (busy()) { breaking = null; showProgress(0); return }

    // Keep swinging for as long as the button is held, target or not.
    if (noa.inputs.state.fire) swing.triggerIfIdle()

    const held = noa.inputs.state.fire
    const target = noa.targetedBlock
    const caps = authority.caps()

    if (!held || !target || !caps.mayBreak) {
      if (breaking) { breaking = null; showProgress(0) }
      return
    }

    const pos = target.position

    /*
     * Creative skips the timer entirely rather than running it with a
     * hardness of zero. Zero hardness would divide by zero in the progress
     * fraction, and more to the point the crack overlay has nothing to draw:
     * in creative there is no stage 1, the block is simply gone.
     */
    if (caps.instantBreak) {
      if (creativeCooldown > 0 || pending) return
      const id = noa.getBlock(pos[0], pos[1], pos[2])
      if (!breakable(BLOCK_BY_ID.get(id))) return
      creativeCooldown = CREATIVE_BREAK_INTERVAL_MS
      breakBlock(id, [pos[0], pos[1], pos[2]])
      return
    }

    if (!sameBlock(breaking, pos)) {
      const id = noa.getBlock(pos[0], pos[1], pos[2])
      const def = BLOCK_BY_ID.get(id)
      if (!breakable(def)) {
        /*
         * Bedrock. The timer never starts -- it would run forever -- but the
         * hit still happened, so progress is published with frac 0 rather
         * than not published at all. Vanilla keeps ticking the hit sound
         * while you punch something unbreakable; you simply never break it.
         *
         * frac 0 is also what keeps the crack overlay off (crackOverlay.js
         * hides itself at frac <= 0), so this is a hit without a stage.
         */
        breaking = null
        showProgress(0, pos, id, dt / 1000)
        return
      }
      breaking = { x: pos[0], y: pos[1], z: pos[2], id, elapsed: 0, total: def.hardness }
    }

    breaking.elapsed += dt / 1000
    const frac = Math.min(1, breaking.elapsed / breaking.total)
    showProgress(frac, pos, breaking.id, dt / 1000)

    if (frac >= 1) {
      const { id, x, y, z } = breaking
      breaking = null
      showProgress(0)
      breakBlock(id, [x, y, z])
    }
  })

  // Placing is instant, and consumes from the selected hotbar slot.
  noa.inputs.down.on('alt-fire', async () => {
    if (busy()) return
    const target = noa.targetedBlock
    if (!target) return

    /*
     * Using a block is checked FIRST, before the build permission and before
     * needing anything in hand: opening a crafting table is not building, so
     * it works in adventure mode with an empty hand. Sneaking suppresses it,
     * which is how Minecraft lets you place a block against a table rather
     * than opening it.
     */
    const [ux, uy, uz] = target.position
    if (!noa.inputs.state.sneak &&
        fx.useBlock?.(noa.getBlock(ux, uy, uz), target.position)) return

    const caps = authority.caps()
    if (!caps.mayBuild) return
    const stack = inv.selectedStack()
    if (!stack) return

    const [x, y, z] = target.adjacent

    // Don't let the player entomb themselves. Minecraft refuses to place a
    // block inside any entity's bounding box, and without this check you can
    // place a block into your own feet and end up stuck inside terrain.
    //
    // A spectator has no bounding box worth speaking of, but they cannot
    // build either, so this stays unconditional.
    const p = noa.ents.getPositionData(noa.playerEntity)
    const [px, py, pz] = p.position
    const w = p.width / 2
    const intersects =
      x + 1 > px - w && x < px + w &&
      z + 1 > pz - w && z < pz + w &&
      y + 1 > py && y < py + p.height
    if (intersects) return

    // A stack holds an ITEM, and most items place nothing at all.
    const id = itemPlaces(stack.id)
    if (!id) return
    const res = await authority.requestBlockChange({ id, position: [x, y, z], cause: 'place' })
    if (!res.ok) return
    // Creative's Abilities.instabuild: the stack never shrinks.
    if (!caps.infiniteResources) inv.consumeSelected()
    swing.trigger()
    blockPlace.emit({ id, position: [x, y, z] })
  })

  return {
    /** @param fn ({ id, position }) => void, called after the block is gone. */
    onBlockBreak: blockBreak.on,
    /** @param fn ({ id, position }) => void */
    onBlockPlace: blockPlace.on,
    /**
     * Per-frame mining progress. `position` is null whenever nothing is being
     * broken, which is the signal to reset any per-target state.
     * @param fn ({ id, position, frac, dt }) => void
     */
    onBreakProgress: breakProgress.on,
  }
}

/*
 * Hotbar selection. Minecraft binds this to the number row and the scroll
 * wheel, and puts camera perspective on F5 instead. We had scroll on zoom
 * before, which is the wrong reflex for anyone who has played the game.
 */
export function installHotbarControls(noa, inv, inputLock) {
  const busy = () => inputLock.locked

  document.addEventListener('keydown', (e) => {
    if (busy()) return
    const n = Number(e.key)
    if (Number.isInteger(n) && n >= 1 && n <= 9) inv.select(n - 1)
  })

  noa.on('tick', () => {
    // Scrolling belongs to whatever is on screen. Chat scrolls its backlog,
    // and without this guard reading history silently swapped your held item.
    if (busy()) return
    const scroll = noa.inputs.pointerState.scrolly
    if (scroll !== 0) inv.select(inv.selected + (scroll > 0 ? 1 : -1))
  })

  // F5 perspective cycling lives in perspective.js, which owns the player
  // model it has to show and hide.

}
