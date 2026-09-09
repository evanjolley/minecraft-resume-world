import { BLOCK_BY_ID } from './blocks.js'
import { createBlockIcon } from './blockIcon.js'

/*
 * Inventory model + the inventory screen.
 *
 * Layout matches Minecraft: 36 slots total, where 0-8 ARE the hotbar and
 * 9-35 are the main grid. They're one array rather than two, because in
 * Minecraft they genuinely are one inventory: shift-clicking and stack
 * merging move items between them freely, and two arrays means writing
 * every operation twice and getting the boundary wrong.
 */

export const HOTBAR_SIZE = 9
export const TOTAL_SLOTS = 36
export const STACK_MAX = 64

export function createInventory() {
  const inv = {
    slots: new Array(TOTAL_SLOTS).fill(null), // null | { id, count }
    selected: 0,
    // The stack glued to the mouse pointer while the screen is open.
    carried: null,
    open: false,
  }

  const listeners = new Set()
  const changed = () => listeners.forEach(fn => fn(inv))
  inv.onChange = fn => { listeners.add(fn); fn(inv); return () => listeners.delete(fn) }
  inv.emitChange = changed

  /**
   * Add items, Minecraft's ordering: top up existing partial stacks first,
   * then fall into empty slots. Doing it in that order is what stops a
   * 64-stack of dirt fragmenting across six slots.
   * @returns leftover count that didn't fit
   */
  inv.add = (id, count = 1) => {
    let left = count
    for (let i = 0; i < TOTAL_SLOTS && left > 0; i++) {
      const s = inv.slots[i]
      if (s && s.id === id && s.count < STACK_MAX) {
        const room = STACK_MAX - s.count
        const put = Math.min(room, left)
        s.count += put
        left -= put
      }
    }
    for (let i = 0; i < TOTAL_SLOTS && left > 0; i++) {
      if (!inv.slots[i]) {
        const put = Math.min(STACK_MAX, left)
        inv.slots[i] = { id, count: put }
        left -= put
      }
    }
    changed()
    return left
  }

  inv.selectedStack = () => inv.slots[inv.selected]

  /** Consume one item from the selected hotbar slot, for block placement. */
  inv.consumeSelected = () => {
    const s = inv.slots[inv.selected]
    if (!s) return null
    const id = s.id
    s.count--
    if (s.count <= 0) inv.slots[inv.selected] = null
    changed()
    return id
  }

  inv.select = (i) => {
    inv.selected = ((i % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE
    changed()
  }

  /*
   * Click handling, matching Minecraft's rules exactly:
   *   left  + empty hand -> take the whole stack
   *   left  + full hand  -> drop it, merging if same type, else swap
   *   right + empty hand -> take half (rounded up)
   *   right + full hand  -> place a single item
   */
  inv.clickSlot = (index, button) => {
    const slot = inv.slots[index]
    const half = button === 'right'

    if (!inv.carried) {
      if (!slot) return
      if (half) {
        const take = Math.ceil(slot.count / 2)
        inv.carried = { id: slot.id, count: take }
        slot.count -= take
        if (slot.count <= 0) inv.slots[index] = null
      } else {
        inv.carried = slot
        inv.slots[index] = null
      }
      changed()
      return
    }

    if (!slot) {
      if (half) {
        inv.slots[index] = { id: inv.carried.id, count: 1 }
        inv.carried.count--
        if (inv.carried.count <= 0) inv.carried = null
      } else {
        inv.slots[index] = inv.carried
        inv.carried = null
      }
      changed()
      return
    }

    if (slot.id === inv.carried.id) {
      const room = STACK_MAX - slot.count
      const put = half ? Math.min(1, room) : Math.min(inv.carried.count, room)
      slot.count += put
      inv.carried.count -= put
      if (inv.carried.count <= 0) inv.carried = null
    } else if (!half) {
      // Different item types swap, which is how Minecraft lets you shuffle
      // a full inventory without needing a free slot.
      const tmp = inv.slots[index]
      inv.slots[index] = inv.carried
      inv.carried = tmp
    }
    changed()
  }

  return inv
}

/*
 * The inventory screen. Built once and shown/hidden, rather than rebuilt on
 * open: 36 slots of DOM is cheap to keep around and expensive to thrash.
 */
export function installInventoryScreen(noa, inv, inputLock) {
  const screen = document.getElementById('inventory')
  const grid = document.getElementById('inv-grid')
  const bar = document.getElementById('inv-hotbar')
  const carried = document.getElementById('inv-carried')

  const cells = []
  const makeCell = (index, parent) => {
    const cell = document.createElement('div')
    cell.className = 'slot'
    cell.addEventListener('mousedown', (e) => {
      e.preventDefault()
      inv.clickSlot(index, e.button === 2 ? 'right' : 'left')
    })
    cell.addEventListener('contextmenu', e => e.preventDefault())
    parent.appendChild(cell)
    cells[index] = cell
  }

  // 9-35 in the main grid, then 0-8 in the hotbar row beneath it, which is
  // the same visual order Minecraft uses.
  for (let i = HOTBAR_SIZE; i < TOTAL_SLOTS; i++) makeCell(i, grid)
  for (let i = 0; i < HOTBAR_SIZE; i++) makeCell(i, bar)

  const paintSlot = (cell, stack) => {
    cell.textContent = ''
    if (!stack) return
    cell.appendChild(createBlockIcon(stack.id, 32))
    if (stack.count > 1) {
      const n = document.createElement('span')
      n.className = 'count'
      n.textContent = stack.count
      cell.appendChild(n)
    }
  }

  inv.onChange(() => {
    for (let i = 0; i < TOTAL_SLOTS; i++) paintSlot(cells[i], inv.slots[i])
    paintSlot(carried, inv.carried)
    carried.classList.toggle('hidden', !inv.carried)
  })

  // The carried stack follows the pointer. Only while the screen is open,
  // otherwise this listener fires on every mouse move during play.
  document.addEventListener('mousemove', (e) => {
    if (!inv.open) return
    carried.style.transform = `translate(${e.clientX + 8}px, ${e.clientY + 8}px)`
  })

  const setOpen = (open) => {
    // inv.open is set FIRST because releasing pointer lock below fires
    // lostPointerLock, and main.js reads this flag to decide whether that
    // event should open the pause menu.
    inv.open = open
    screen.classList.toggle('hidden', !open)
    document.body.classList.toggle('inv-open', open)

    // Pointer lock and a mouse-driven UI are mutually exclusive; releasing
    // the lock is what brings the cursor back. The world keeps ticking, so
    // the sky moves and other players would keep walking around behind it,
    // exactly as Minecraft multiplayer does.
    if (open) inputLock.lock('inventory')
    else inputLock.unlock('inventory')
    noa.container.setPointerLock(!open)
  }

  noa.inputs.bind('inventory', 'KeyE')
  noa.inputs.down.on('inventory', () => setOpen(!inv.open))

  // Escape closes the screen rather than only releasing the cursor.
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && inv.open) setOpen(false)
  })

  return { setOpen }
}
