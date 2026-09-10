import { BLOCK_BY_ID } from './blocks.js'
import { createBlockIcon } from './blockIcon.js'
import { SCALE as HUD_SCALE } from './hud.js'

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
 * The inventory screen, drawn over Minecraft's own container sprite.
 *
 * Slot positions are Minecraft's, in GUI pixels, scaled up:
 *   main 3x9 grid  x = 8 + col*18, y = 84 + row*18
 *   hotbar row     x = 8 + col*18, y = 142
 *   items          16x16
 *
 * Built once and shown/hidden rather than rebuilt on open: 36 slots of DOM is
 * cheap to keep and expensive to thrash.
 */
const GUI_W = 176, GUI_H = 166

/*
 * The character shown in the inventory window.
 *
 * Minecraft renders a live 3D model there. This composes the same skin as a
 * flat front-facing figure from the skin's front-facing rects, which reads
 * correctly at this size and costs nothing -- a second WebGL camera and
 * render target for a 52x70 window would be far more machinery than the
 * result justifies.
 *
 * Rects are the FRONT faces of the standard 64x64 wide layout.
 */
const DOLL = [
  { name: 'head',  rect: [8, 8, 8, 8],   x: 4,  y: 0 },
  { name: 'body',  rect: [20, 20, 8, 12], x: 4, y: 8 },
  { name: 'armR',  rect: [44, 20, 4, 12], x: 0, y: 8 },
  { name: 'armL',  rect: [36, 52, 4, 12], x: 12, y: 8 },
  { name: 'legR',  rect: [4, 20, 4, 12],  x: 4, y: 20 },
  { name: 'legL',  rect: [20, 52, 4, 12], x: 8, y: 20 },
]
/*
 * Minecraft's preview window spans x 26-78, y 8-78 in GUI pixels, and in
 * modern versions the sprite paints that recess opaque BLACK -- the figure is
 * meant to sit on it, so the dark window is correct rather than a hole.
 * Origin centres the 16x32 figure inside it.
 */
const DOLL_SCALE = 4
const DOLL_ORIGIN = { x: 36, y: 11 }
const SLOT_PITCH = 18, SLOT_SIZE = 16
const GRID_X = 8, GRID_Y = 84, BAR_Y = 142

export function installInventoryScreen(noa, inv, inputLock) {
  const screen = document.getElementById('inventory')
  const panel = document.getElementById('inv-panel')
  const carried = document.getElementById('inv-carried')

  const px = (n) => `${n * HUD_SCALE}px`
  panel.style.width = px(GUI_W)
  panel.style.height = px(GUI_H)
  panel.style.backgroundImage = 'url(/ui/inventory.png)'
  carried.style.width = carried.style.height = px(SLOT_SIZE)

  /* ---- character preview ---- */
  const doll = document.createElement('div')
  doll.id = 'inv-doll'
  doll.style.left = px(DOLL_ORIGIN.x)
  doll.style.top = px(DOLL_ORIGIN.y)
  for (const part of DOLL) {
    const el = document.createElement('div')
    el.className = 'doll-part'
    const [sx, sy, w, h] = part.rect
    el.style.width = `${w * DOLL_SCALE}px`
    el.style.height = `${h * DOLL_SCALE}px`
    el.style.left = `${part.x * DOLL_SCALE}px`
    el.style.top = `${part.y * DOLL_SCALE}px`
    el.style.backgroundImage = 'url(/skins/default.png)'
    el.style.backgroundSize = `${64 * DOLL_SCALE}px ${64 * DOLL_SCALE}px`
    el.style.backgroundPosition = `-${sx * DOLL_SCALE}px -${sy * DOLL_SCALE}px`
    doll.appendChild(el)
  }
  panel.appendChild(doll)

  const cells = []
  const makeCell = (index, gx, gy) => {
    const cell = document.createElement('div')
    cell.className = 'slot'
    cell.style.left = px(gx)
    cell.style.top = px(gy)
    cell.style.width = cell.style.height = px(SLOT_SIZE)
    cell.addEventListener('mousedown', (e) => {
      e.preventDefault()
      inv.clickSlot(index, e.button === 2 ? 'right' : 'left')
    })
    cell.addEventListener('contextmenu', e => e.preventDefault())
    panel.appendChild(cell)
    cells[index] = cell
  }

  // 9-35 fill the main grid, 0-8 the hotbar row beneath it -- the same
  // mapping Minecraft uses, which is why shift-clicking works the way it does.
  for (let i = HOTBAR_SIZE; i < TOTAL_SLOTS; i++) {
    const n = i - HOTBAR_SIZE
    makeCell(i, GRID_X + (n % 9) * SLOT_PITCH, GRID_Y + Math.floor(n / 9) * SLOT_PITCH)
  }
  for (let i = 0; i < HOTBAR_SIZE; i++) makeCell(i, GRID_X + i * SLOT_PITCH, BAR_Y)

  const paintSlot = (cell, stack) => {
    cell.textContent = ''
    if (!stack) return
    cell.appendChild(createBlockIcon(stack.id, SLOT_SIZE * HUD_SCALE))
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

  // The carried stack follows the pointer, but only while the screen is open:
  // otherwise this listener runs on every mouse move during play.
  document.addEventListener('mousemove', (e) => {
    if (!inv.open) return
    const half = (SLOT_SIZE * HUD_SCALE) / 2
    carried.style.transform = `translate(${e.clientX - half}px, ${e.clientY - half}px)`
  })

  const setOpen = (open) => {
    // inv.open is set FIRST because releasing pointer lock below fires
    // lostPointerLock, and main.js reads this flag to decide whether that
    // event should open the pause menu.
    inv.open = open
    screen.classList.toggle('hidden', !open)
    document.body.classList.toggle('inv-open', open)

    // Pointer lock and a mouse-driven UI are mutually exclusive; releasing the
    // lock is what brings the cursor back. The world keeps ticking, so the sky
    // moves and other players would keep walking behind it, as in Minecraft
    // multiplayer.
    if (open) inputLock.lock('inventory')
    else inputLock.unlock('inventory')
    noa.container.setPointerLock(!open)
  }

  /*
   * noa's default bindings put KeyE on "alt-fire" (place block) alongside
   * Mouse3, and bind() APPENDS rather than replaces -- so one press of E fired
   * both handlers, placing a block on the way to opening the inventory. The
   * alt-fire handler runs first, while inv.open is still false, so its own
   * guard could never catch it.
   *
   * Rebind alt-fire to the mouse only before claiming E.
   */
  noa.inputs.unbind('alt-fire')
  noa.inputs.bind('alt-fire', 'Mouse3')
  noa.inputs.bind('inventory', 'KeyE')
  noa.inputs.down.on('inventory', () => setOpen(!inv.open))

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && inv.open) setOpen(false)
  })

  return { setOpen }
}
