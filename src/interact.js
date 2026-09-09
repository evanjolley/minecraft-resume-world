import { BLOCK_BY_ID } from './blocks.js'

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
 */
export function installInteraction(noa, inv, fx) {
  let breaking = null // { x, y, z, id, elapsed, total }

  // Minecraft has no progress bar. Feedback is the crack overlay on the
  // block plus the arm swinging, so progress drives those instead.
  const showProgress = (frac, pos) => fx.crack.update(frac, pos)

  const sameBlock = (a, pos) => a && a.x === pos[0] && a.y === pos[1] && a.z === pos[2]

  noa.on('tick', (dt) => {
    if (inv.open) { breaking = null; showProgress(0); return }

    const held = noa.inputs.state.fire
    const target = noa.targetedBlock

    if (!held || !target) {
      if (breaking) { breaking = null; showProgress(0) }
      return
    }

    // Keep the arm swinging for as long as the button is down.
    fx.held.swingIfIdle()

    const pos = target.position
    if (!sameBlock(breaking, pos)) {
      const id = noa.getBlock(pos[0], pos[1], pos[2])
      const def = BLOCK_BY_ID.get(id)
      // Infinity marks bedrock. Without this the timer runs forever and the
      // crack overlay sits frozen on stage 0 while you chew on it.
      if (!def || def.hardness === Infinity) { breaking = null; showProgress(0); return }
      breaking = { x: pos[0], y: pos[1], z: pos[2], id, elapsed: 0, total: def.hardness }
    }

    breaking.elapsed += dt / 1000
    const frac = Math.min(1, breaking.elapsed / breaking.total)
    showProgress(frac, pos)

    if (frac >= 1) {
      const def = BLOCK_BY_ID.get(breaking.id)
      noa.setBlock(0, breaking.x, breaking.y, breaking.z)
      // Minecraft drops a different block than the one mined for some types:
      // grass gives dirt, stone gives cobblestone.
      inv.add(def.drops ?? breaking.id, 1)
      breaking = null
      showProgress(0)
    }
  })

  // Placing is instant, and consumes from the selected hotbar slot.
  noa.inputs.down.on('alt-fire', () => {
    if (inv.open) return
    const target = noa.targetedBlock
    if (!target) return
    const stack = inv.selectedStack()
    if (!stack) return

    const [x, y, z] = target.adjacent

    // Don't let the player entomb themselves. Minecraft refuses to place a
    // block inside any entity's bounding box, and without this check you can
    // place a block into your own feet and end up stuck inside terrain.
    const p = noa.ents.getPositionData(noa.playerEntity)
    const [px, py, pz] = p.position
    const w = p.width / 2
    const intersects =
      x + 1 > px - w && x < px + w &&
      z + 1 > pz - w && z < pz + w &&
      y + 1 > py && y < py + p.height
    if (intersects) return

    noa.setBlock(stack.id, x, y, z)
    inv.consumeSelected()
    fx.held.swing()
  })

  return {}
}

/*
 * Hotbar selection. Minecraft binds this to the number row and the scroll
 * wheel, and puts camera perspective on F5 instead. We had scroll on zoom
 * before, which is the wrong reflex for anyone who has played the game.
 */
export function installHotbarControls(noa, inv) {
  document.addEventListener('keydown', (e) => {
    if (inv.open) return
    const n = Number(e.key)
    if (Number.isInteger(n) && n >= 1 && n <= 9) inv.select(n - 1)
  })

  noa.on('tick', () => {
    if (inv.open) return
    const scroll = noa.inputs.pointerState.scrolly
    if (scroll !== 0) inv.select(inv.selected + (scroll > 0 ? 1 : -1))
  })

  // F5 cycles first person -> third person -> third person front, same as MC.
  const DISTANCES = [0, 5, 5]
  let mode = 0
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'F5') return
    e.preventDefault()
    mode = (mode + 1) % 3
    noa.camera.zoomDistance = DISTANCES[mode]
  })
}
