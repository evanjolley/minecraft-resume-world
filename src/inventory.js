import { createItemIcon } from './blockIcon.js'
import { SCALE as HUD_SCALE, FONT_PX } from './hud.js'
import { stackMax, armorOf, ARMOR_SLOTS, itemId } from './items.js'
import { findRecipe, consumeGrid } from './crafting.js'

/*
 * Inventory model + the container screens.
 *
 * Layout matches Minecraft: 36 slots total, where 0-8 ARE the hotbar and
 * 9-35 are the main grid. They're one array rather than two, because in
 * Minecraft they genuinely are one inventory: shift-clicking and stack
 * merging move items between them freely, and two arrays means writing
 * every operation twice and getting the boundary wrong.
 *
 * A stack is `{ id, count }` where `id` is an ITEM id (see items.js), not a
 * block id. For every block those are the same number, which is why nothing
 * outside this file had to change; for a stick or a pickaxe there is no block
 * at all, and `itemPlaces()` is what interact.js asks before placing.
 *
 * Around that sit four more containers, all of them slots the inventory
 * sprite has always drawn and nothing has ever filled:
 *
 *   armor    4 slots, helmet down to boots, only accepting matching pieces
 *   offhand  1 slot, holds anything
 *   craft    the 2x2 (or the 3x3 at a table), plus its result
 *
 * They are separate arrays rather than an extension of `slots` because they
 * are separate CONTAINERS -- `add()` must never drop a pickaxe into the
 * helmet slot, and a 41-long array with magic indices is exactly how that
 * happens.
 */

export const HOTBAR_SIZE = 9
export const TOTAL_SLOTS = 36
/** Minecraft's default. Per-item limits live in items.js; this is the ceiling. */
export const STACK_MAX = 64

/** The containers a click can address. `main` is slots 0-35. */
export const AREAS = ['main', 'armor', 'offhand', 'craft', 'result']

export function createInventory() {
  const inv = {
    slots: new Array(TOTAL_SLOTS).fill(null), // null | { id, count }
    /** Helmet, chestplate, leggings, boots -- ARMOR_SLOTS order. */
    armor: new Array(4).fill(null),
    /** One slot. An array of one so every container reads the same way. */
    offhand: new Array(1).fill(null),
    /*
     * The crafting grid currently open. `size` is 2 in the inventory and 3 at
     * a crafting table; `cells` is always size*size, reallocated on the swap
     * rather than kept at 9 and partly ignored -- a 9-cell array pretending
     * to be a 2x2 is how a recipe ends up matching against cells the player
     * cannot see.
     */
    craft: { size: 2, cells: new Array(4).fill(null), result: null },
    selected: 0,
    // The stack glued to the mouse pointer while a screen is open.
    carried: null,
    open: false,
  }

  const listeners = new Set()
  const changed = () => listeners.forEach(fn => fn(inv))
  inv.onChange = fn => { listeners.add(fn); fn(inv); return () => listeners.delete(fn) }
  inv.emitChange = changed

  /** The backing array for a container name. */
  const container = (area) => (
    area === 'armor' ? inv.armor
      : area === 'offhand' ? inv.offhand
        : area === 'craft' ? inv.craft.cells
          : inv.slots
  )

  /**
   * Add items, Minecraft's ordering: top up existing partial stacks first,
   * then fall into empty slots. Doing it in that order is what stops a
   * 64-stack of dirt fragmenting across six slots.
   *
   * Only ever touches the main 36. Armor, offhand and the crafting grid are
   * placed by hand, never by a pickup.
   * @returns leftover count that didn't fit
   */
  inv.add = (id, count = 1) => {
    const max = stackMax(id)
    let left = count
    for (let i = 0; i < TOTAL_SLOTS && left > 0; i++) {
      const s = inv.slots[i]
      if (s && s.id === id && s.count < max) {
        const room = max - s.count
        const put = Math.min(room, left)
        s.count += put
        left -= put
      }
    }
    for (let i = 0; i < TOTAL_SLOTS && left > 0; i++) {
      if (!inv.slots[i]) {
        const put = Math.min(max, left)
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

  /**
   * Take items out of the selected slot to be thrown on the floor.
   *
   * Separate from consumeSelected because the two answer different questions:
   * placing wants "one item is gone, here is what it was", while Q wants the
   * STACK it just removed, since something has to go on the floor with a count
   * on it. Minecraft's Q takes one and Ctrl+Q takes the lot.
   *
   * @returns {{id: number, count: number}|null}
   */
  inv.takeSelected = (all = false) => {
    const s = inv.slots[inv.selected]
    if (!s) return null
    const count = all ? s.count : 1
    s.count -= count
    if (s.count <= 0) inv.slots[inv.selected] = null
    changed()
    return { id: s.id, count }
  }

  /**
   * Where items with nowhere to go end up: `(id, count) => void`, set by
   * itemEntity.js to throw them on the floor the way Minecraft does.
   *
   * A hook rather than an import because the inventory MODEL must keep working
   * with no renderer attached -- the test suite drives it directly, and half
   * this file is UI that a headless model has no business needing. Unset, the
   * items go back into the inventory, which is where they used to go.
   */
  inv.dropper = null

  /** Give up a stack: onto the floor if anything is listening, else back in. */
  const discard = (id, count) => {
    if (inv.dropper) inv.dropper(id, count)
    else inv.add(id, count)
  }

  inv.select = (i) => {
    inv.selected = ((i % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE
    changed()
  }

  /* ---------------- crafting ---------------- */

  /*
   * Recompute what the grid makes. Called after every mutation of it rather
   * than lazily on paint, because the RESULT SLOT IS A SLOT: you can click it,
   * and a lazily-computed result means the click and the display can disagree.
   */
  const refreshResult = () => {
    const { cells, size } = inv.craft
    const hit = findRecipe(cells, size, size)
    inv.craft.result = hit ? { id: hit.id, count: hit.count } : null
  }
  inv.refreshResult = refreshResult

  /**
   * Swap the grid between 2x2 and 3x3, returning whatever was in the old one.
   *
   * Minecraft throws the grid's contents on the floor when you close the
   * screen, and now so does this -- `discard` routes them to the dropped-item
   * entities if any are installed. It used to hand them back to the inventory,
   * which was the stand-in for exactly this.
   */
  inv.setCraftSize = (size) => {
    for (const s of inv.craft.cells) if (s) discard(s.id, s.count)
    inv.craft = { size, cells: new Array(size * size).fill(null), result: null }
    changed()
  }

  /** Empty the grid out. Called when a screen closes. */
  inv.clearCraft = () => {
    let moved = false
    for (let i = 0; i < inv.craft.cells.length; i++) {
      const s = inv.craft.cells[i]
      if (!s) continue
      inv.craft.cells[i] = null
      discard(s.id, s.count)
      moved = true
    }
    // A carried stack has nowhere to go either, and Minecraft drops that too.
    if (inv.carried) { discard(inv.carried.id, inv.carried.count); inv.carried = null; moved = true }
    if (moved) { refreshResult(); changed() }
  }

  /**
   * Take the crafted result.
   *
   * Take-only: nothing can be PUT here, which is why this is its own function
   * rather than a branch in clickSlot. Vanilla's shift-click "craft as many as
   * fit" is not implemented -- see the report.
   */
  const takeResult = () => {
    const result = inv.craft.result
    if (!result) return
    const max = stackMax(result.id)
    if (inv.carried) {
      // Merging onto a full hand is refused rather than clamped: a partial
      // craft would consume the ingredients for items you didn't receive.
      if (inv.carried.id !== result.id) return
      if (inv.carried.count + result.count > max) return
      inv.carried.count += result.count
    } else {
      inv.carried = { id: result.id, count: result.count }
    }
    consumeGrid(inv.craft.cells)
    refreshResult()
    changed()
  }

  /* ---------------- clicking ---------------- */

  /**
   * Whether a container will accept an item at all.
   * Armor slots are the only picky ones, and they are picky the way
   * Minecraft's are: a helmet slot takes helmets.
   */
  const accepts = (area, index, id) => {
    if (area !== 'armor') return true
    return armorOf(id)?.slot === ARMOR_SLOTS[index]
  }

  /*
   * Click handling, matching Minecraft's rules exactly:
   *   left  + empty hand -> take the whole stack
   *   left  + full hand  -> drop it, merging if same type, else swap
   *   right + empty hand -> take half (rounded up)
   *   right + full hand  -> place a single item
   *
   * `area` defaults to the main 36 so every existing caller -- and the test
   * suite, which drives this directly -- keeps working unchanged.
   */
  inv.clickSlot = (index, button, area = 'main') => {
    if (area === 'result') { takeResult(); return }

    const cells = container(area)
    const slot = cells[index]
    const half = button === 'right'

    if (!inv.carried) {
      if (!slot) return
      if (half) {
        const take = Math.ceil(slot.count / 2)
        inv.carried = { id: slot.id, count: take }
        slot.count -= take
        if (slot.count <= 0) cells[index] = null
      } else {
        inv.carried = slot
        cells[index] = null
      }
      if (area === 'craft') refreshResult()
      changed()
      return
    }

    if (!accepts(area, index, inv.carried.id)) return

    const max = stackMax(inv.carried.id)

    if (!slot) {
      if (half) {
        cells[index] = { id: inv.carried.id, count: 1 }
        inv.carried.count--
        if (inv.carried.count <= 0) inv.carried = null
      } else {
        // An armor or offhand slot holds at most one item's stack limit, and
        // for armor that limit is 1 -- so a stack of boots would be illegal
        // anyway. Splitting here rather than special-casing armor keeps the
        // rule as "a slot never holds more than the item allows".
        if (inv.carried.count > max) {
          cells[index] = { id: inv.carried.id, count: max }
          inv.carried.count -= max
        } else {
          cells[index] = inv.carried
          inv.carried = null
        }
      }
      if (area === 'craft') refreshResult()
      changed()
      return
    }

    if (slot.id === inv.carried.id) {
      const room = max - slot.count
      const put = half ? Math.min(1, room) : Math.min(inv.carried.count, room)
      slot.count += put
      inv.carried.count -= put
      if (inv.carried.count <= 0) inv.carried = null
    } else if (!half) {
      // Different item types swap, which is how Minecraft lets you shuffle
      // a full inventory without needing a free slot.
      const tmp = cells[index]
      cells[index] = inv.carried
      inv.carried = tmp
    }
    if (area === 'craft') refreshResult()
    changed()
  }

  /** Equip a piece into the slot it belongs in. Convenience for tests and
   *  for whatever eventually shift-clicks armor from the main grid. */
  inv.equip = (id) => {
    const a = armorOf(id)
    if (!a) return false
    inv.armor[ARMOR_SLOTS.indexOf(a.slot)] = { id, count: 1 }
    changed()
    return true
  }

  return inv
}

/*
 * The container screens, drawn over Minecraft's own sprites.
 *
 * Slot positions are Minecraft's, in GUI pixels, scaled up. Every one of
 * these came out of the vanilla menu classes rather than off a ruler:
 *
 *   InventoryMenu   armor    x = 8,  y = 8 + i*18      (helmet .. boots)
 *                   offhand  x = 77, y = 62
 *                   craft    x = 98 + c*18, y = 18 + r*18
 *                   result   x = 154, y = 28
 *   CraftingMenu    craft    x = 30 + c*18, y = 17 + r*18
 *                   result   x = 124, y = 35
 *   both            main 3x9 x = 8 + c*18, y = 84 + r*18
 *                   hotbar   x = 8 + c*18, y = 142
 *                   items    16x16
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

const ARMOR_ORIGIN = { x: 8, y: 8 }
const OFFHAND_ORIGIN = { x: 77, y: 62 }
const CRAFT_2 = { grid: { x: 98, y: 18 }, result: { x: 154, y: 28 } }
const CRAFT_3 = { grid: { x: 30, y: 17 }, result: { x: 124, y: 35 } }

/*
 * The faint outlines Minecraft blits into an EMPTY armor or offhand slot, so
 * you can tell which one takes boots before you own any. They are separate
 * sprites (gui/sprites/container/slot/*), not part of the container sheet,
 * which is why the panel looked blank without them.
 */
const SLOT_HINTS = { armor: ARMOR_SLOTS, offhand: ['shield'] }

/*
 * Container titles. Minecraft draws these as TEXT, not as part of the sprite,
 * at coordinates the menu class carries: CraftingScreen puts "Crafting" at
 * (28, 6) and every container puts "Inventory" at (8, imageHeight - 94).
 *
 * The survival inventory has no labels at all -- it has the player model
 * instead -- so only the crafting table gets them.
 */
const CRAFT_TABLE_LABELS = [
  { text: 'Crafting', x: 28, y: 6 },
  { text: 'Inventory', x: 8, y: GUI_H - 94 },
]
/** Minecraft's container label colour, 0x404040. */
const LABEL_COLOR = '#404040'

export function installInventoryScreen(noa, inv, inputLock) {
  const screen = document.getElementById('inventory')
  const panel = document.getElementById('inv-panel')
  const tableScreen = document.getElementById('crafting')
  const tablePanel = document.getElementById('craft-panel')
  const carried = document.getElementById('inv-carried')

  const px = (n) => `${n * HUD_SCALE}px`
  carried.style.width = carried.style.height = px(SLOT_SIZE)

  for (const [el, sprite] of [[panel, 'inventory'], [tablePanel, 'crafting_table']]) {
    el.style.width = px(GUI_W)
    el.style.height = px(GUI_H)
    el.style.backgroundImage = `url(/ui/${sprite}.png)`
  }

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

  /*
   * One cell factory for both panels and all five containers.
   *
   * A cell records which (area, index) it addresses and paints itself; the
   * screens differ only in where the cells sit. Road not taken: a second copy
   * of this for the crafting table, which is how the two screens would end up
   * with subtly different click semantics.
   */
  const cells = []
  const makeCell = (host, area, index, gx, gy) => {
    const cell = document.createElement('div')
    /*
     * TWO CLASSES, and the distinction is load-bearing.
     *
     * `.gui-slot` is every cell on a panel and carries all the styling.
     * `.slot` means specifically one of the PLAYER'S 36 -- the container that
     * is the same nine hotbar slots you see in the world plus the 27 above
     * them. The armor, offhand and crafting cells are slots on the screen but
     * they are not the player's inventory, and "how many slots does the
     * player have" is a question that has to keep answering 36 however many
     * containers get drawn next to it.
     */
    cell.className = `gui-slot gui-slot-${area}${area === 'main' ? ' slot' : ''}`
    const hint = SLOT_HINTS[area]?.[index]
    if (hint) cell.dataset.hint = `url(/ui/slot_${hint}.png)`
    cell.style.left = px(gx)
    cell.style.top = px(gy)
    cell.style.width = cell.style.height = px(SLOT_SIZE)
    cell.addEventListener('mousedown', (e) => {
      e.preventDefault()
      inv.clickSlot(index, e.button === 2 ? 'right' : 'left', area)
    })
    cell.addEventListener('contextmenu', e => e.preventDefault())
    host.appendChild(cell)
    cells.push({ el: cell, area, index })
    return cell
  }

  /** The 36 main slots plus a crafting grid, laid out on one panel. */
  const buildPanel = (host, size, geom) => {
    // 9-35 fill the main grid, 0-8 the hotbar row beneath it -- the same
    // mapping Minecraft uses, which is why shift-clicking works the way it does.
    for (let i = HOTBAR_SIZE; i < TOTAL_SLOTS; i++) {
      const n = i - HOTBAR_SIZE
      makeCell(host, 'main', i, GRID_X + (n % 9) * SLOT_PITCH, GRID_Y + Math.floor(n / 9) * SLOT_PITCH)
    }
    for (let i = 0; i < HOTBAR_SIZE; i++) makeCell(host, 'main', i, GRID_X + i * SLOT_PITCH, BAR_Y)

    for (let i = 0; i < size * size; i++) {
      makeCell(host, 'craft', i,
        geom.grid.x + (i % size) * SLOT_PITCH,
        geom.grid.y + Math.floor(i / size) * SLOT_PITCH)
    }
    makeCell(host, 'result', 0, geom.result.x, geom.result.y)
  }

  buildPanel(panel, 2, CRAFT_2)
  for (let i = 0; i < ARMOR_SLOTS.length; i++) {
    makeCell(panel, 'armor', i, ARMOR_ORIGIN.x, ARMOR_ORIGIN.y + i * SLOT_PITCH)
  }
  makeCell(panel, 'offhand', 0, OFFHAND_ORIGIN.x, OFFHAND_ORIGIN.y)

  buildPanel(tablePanel, 3, CRAFT_3)
  for (const { text, x, y } of CRAFT_TABLE_LABELS) {
    const el = document.createElement('div')
    el.className = 'gui-label'
    el.textContent = text
    el.style.left = px(x)
    el.style.top = px(y)
    el.style.fontSize = `${FONT_PX}px`
    el.style.color = LABEL_COLOR
    tablePanel.appendChild(el)
  }

  const paintSlot = (cell, stack) => {
    cell.textContent = ''
    // The hint outline is the slot's own background, so it vanishes the
    // moment something covers it -- same as Minecraft, which skips the blit
    // entirely for an occupied slot.
    if (cell.dataset.hint) cell.style.backgroundImage = stack ? 'none' : cell.dataset.hint
    if (!stack) return
    cell.appendChild(createItemIcon(stack.id, SLOT_SIZE * HUD_SCALE))
    if (stack.count > 1) {
      const n = document.createElement('span')
      n.className = 'count'
      n.textContent = stack.count
      cell.appendChild(n)
    }
  }

  /*
   * SUBTLE: the crafting cells on the HIDDEN panel are painted too. They
   * address the same `inv.craft.cells`, so leaving them stale means the 3x3
   * still shows the last 2x2's contents for one frame when it opens -- and
   * painting hidden DOM costs nothing next to the alternative of tracking
   * which panel is live.
   */
  const stackAt = ({ area, index }) => (
    area === 'result' ? inv.craft.result
      : area === 'craft' ? inv.craft.cells[index]
        : area === 'armor' ? inv.armor[index]
          : area === 'offhand' ? inv.offhand[index]
            : inv.slots[index]
  )

  inv.onChange(() => {
    for (const cell of cells) paintSlot(cell.el, stackAt(cell))
    paintSlot(carried, inv.carried)
    carried.classList.toggle('hidden', !inv.carried)
  })

  // The carried stack follows the pointer, but only while a screen is open:
  // otherwise this listener runs on every mouse move during play.
  document.addEventListener('mousemove', (e) => {
    if (!inv.open) return
    const half = (SLOT_SIZE * HUD_SCALE) / 2
    carried.style.transform = `translate(${e.clientX - half}px, ${e.clientY - half}px)`
  })

  /*
   * Which screen is showing. Both set `inv.open`, because every guard outside
   * this file -- the pause menu, chat, mining, pointer lock -- asks "is a
   * container open", not "which one". Adding a second flag would mean finding
   * and updating all of them, in files this change does not own.
   */
  let current = null // null | 'inventory' | 'table'

  const show = (which) => {
    if (current === which) return
    // Leaving a screen empties its crafting grid, exactly as closing a
    // container in Minecraft does.
    if (current) inv.clearCraft()
    current = which

    // inv.open is set FIRST because releasing pointer lock below fires
    // lostPointerLock, and main.js reads this flag to decide whether that
    // event should open the pause menu.
    inv.open = !!which
    screen.classList.toggle('hidden', which !== 'inventory')
    tableScreen.classList.toggle('hidden', which !== 'table')
    document.body.classList.toggle('inv-open', inv.open)

    if (which) inv.setCraftSize(which === 'table' ? 3 : 2)

    // Pointer lock and a mouse-driven UI are mutually exclusive; releasing the
    // lock is what brings the cursor back. The world keeps ticking, so the sky
    // moves and other players would keep walking behind it, as in Minecraft
    // multiplayer.
    if (inv.open) inputLock.lock('inventory')
    else inputLock.unlock('inventory')
    noa.container.setPointerLock(!inv.open)
    inv.emitChange()
  }

  const setOpen = (open) => show(open ? 'inventory' : null)

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
  // E CLOSES whichever screen is open, rather than swapping a crafting table
  // for the inventory. That is Minecraft's behaviour and it is the one a
  // player's hands already know.
  noa.inputs.down.on('inventory', () => show(current ? null : 'inventory'))

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && current) show(null)
  })

  /**
   * Right-clicking a block that has a screen.
   *
   * Handed to interact.js rather than hooked from here, because interact.js
   * owns the right-click and a second listener on the same input would race
   * it -- the same bug the alt-fire rebind above exists to fix.
   *
   * @returns true if the block was consumed, which is interact.js's signal
   *   not to place anything.
   */
  const CRAFTING_TABLE = itemId('crafting_table')
  const useBlock = (blockId) => {
    if (blockId !== CRAFTING_TABLE) return false
    show('table')
    return true
  }

  const api = { setOpen, useBlock, openCraftingTable: () => show('table'), current: () => current }

  /*
   * Hung off the model as well as returned.
   *
   * `inv.open` was already a view flag living on the model, so this is the
   * same trade made once more and for the same reason: everything that needs
   * the screen already has the inventory, and `window.game.inventory` is
   * exposed while the screen handle is not. Road not taken: threading the
   * handle through main.js to each caller, which is three more parameters to
   * express one fact.
   */
  inv.screen = api
  return api
}
