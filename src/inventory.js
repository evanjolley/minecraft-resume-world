import { createItemIcon } from './blockIcon.js'
import { SCALE as HUD_SCALE, FONT_PX, px } from './hud.js'
import { stackMax, armorOf, ARMOR_SLOTS, itemId, itemName } from './items.js'
import { TABS, tabItems, searchItems, creativeListClick, fullStack } from './creative.js'
import { findRecipe, consumeGrid, smeltingResult, burnTicks } from './crafting.js'
import { createFurnaces, FURNACE_BLOCKS, INPUT, FUEL, OUTPUT } from './furnace.js'
/*
 * Not a layering violation despite the direction it points: menu.js exports
 * these two as free functions over `noa` and imports nothing back, so the
 * dependency is one-way and the retry loop stays a single shared timer. The
 * alternative -- inventory.js growing its own copy of the loop -- gives two
 * timers that can fight over the lock, which is exactly the bug the "one loop
 * at a time" note in menu.js exists to prevent.
 */
import { requestLockPersistently, cancelPersistentLock } from './menu.js'

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
const TOTAL_SLOTS = 36

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

  /*
   * Area name -> the array behind it. THE one place that mapping is written.
   *
   * `inv.craft.cells` is read through `inv` on every call rather than captured,
   * because setCraftSize REPLACES the array when you open a crafting table --
   * a captured reference would go on addressing the closed screen's 2x2.
   *
   * 'result' is deliberately absent: it is a single stack, not an array, so it
   * has no index to subscript. `stackAt`/`slotSet` below are where the result
   * slot joins in, and they are the entry points anything outside the click
   * machinery should use.
   */
  const container = (area) => (
    area === 'armor' ? inv.armor
      : area === 'offhand' ? inv.offhand
        : area === 'craft' ? inv.craft.cells
          : area === 'furnace' ? (inv.openFurnace?.slots ?? NO_FURNACE)
            : inv.slots
  )

  /*
   * What `container('furnace')` answers with when no furnace is open.
   *
   * A frozen three-null array rather than null, because every caller does
   * `container(area)[index]` and a null here would throw from a repaint that
   * lands one frame after the screen closed. Frozen so a stray write is a
   * TypeError at the moment of the bug rather than an item vanishing into a
   * shared scratch array.
   */
  const NO_FURNACE = Object.freeze([null, null, null])

  /*
   * THE WORLD'S FURNACES, on the inventory model.
   *
   * They live here rather than in main.js for the same reason `inv.screen`
   * does: everything that needs them already has the inventory, and the
   * alternative is threading a fifth handle through main.js -- a file two
   * other agents are editing right now. furnace.js owns the mechanics; this
   * owns nothing but the reference and which one is open.
   */
  inv.furnaces = createFurnaces()
  /** The furnace state behind the open furnace screen, or null. */
  inv.openFurnace = null
  inv.setFurnace = (f) => { inv.openFurnace = f; changed() }

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
   * rather than a branch in clickSlot. This is the PLAIN click; the
   * shift-click "craft as many as fit" is a different code path entirely and
   * lives in quickMoveStack below, which is also true of vanilla -- ResultSlot
   * splits them into onTake and onQuickCraft.
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
    if (area === 'armor') return armorOf(id)?.slot === ARMOR_SLOTS[index]
    if (area !== 'furnace') return true
    /*
     * The furnace's own two picky slots, both vanilla:
     *
     *   FurnaceResultSlot.mayPlace  returns false unconditionally -- the
     *     output is take-only, exactly like the crafting result.
     *   FurnaceFuelSlot.mayPlace    `isFuel(stack) || isBucket(stack)`, which
     *     is why you cannot park a stack of dirt in the fuel slot. The bucket
     *     half is vanilla's allowance for the EMPTY bucket a lava bucket
     *     leaves behind -- it burns for nothing, but it has to be allowed back
     *     into the slot it appears in. The lava bucket itself needs no
     *     special case here: it is in FUELS now (recipes.js), so `burnTicks`
     *     already says yes.
     */
    if (index === OUTPUT) return false
    if (index === FUEL) return burnTicks(id) > 0 || id === BUCKET
    return true
  }
  const BUCKET = itemId('bucket')

  /* ---------------- shift-click (quick move) ---------------- */

  /*
   * Minecraft's shift-click, taken from the decompiled source rather than
   * from the wiki, because the two disagree in three places and the source
   * wins all three (each disagreement is flagged where it bites).
   *
   * Three vanilla pieces make the feature, and you need all of them:
   *
   *   AbstractContainerMenu.moveItemStackTo   the two-pass mover
   *   <Menu>.quickMoveStack                   a per-screen chain of ranges
   *   AbstractContainerMenu.doClick           the QUICK_MOVE repeat loop
   *
   * Build only the first two and you get a shift-click that crafts exactly
   * one item, which is the bug every Minecraft player spots in the first ten
   * seconds -- because "craft until the grid runs out" is not in the crafting
   * code at all, it is in doClick's while loop.
   */

  /*
   * CONTAINER INDICES ARE NOT INVENTORY INDICES. This is the one mapping the
   * whole feature turns on, so it is spelled out rather than derived.
   *
   * quickMoveStack's ranges index the MENU's slot list -- the order the screen
   * calls addSlot in -- and that order is not `inv.slots`:
   *
   *   InventoryMenu (the 2x2 player screen)   CraftingMenu (the table)
   *     0       result                          0      result
   *     1-4     craft 0-3                       1-9    craft 0-8
   *     5-8     armor 0-3 (helmet..boots)      10-36   slots 9-35
   *     9-35    slots 9-35                     37-45   slots 0-8
   *    36-44    slots 0-8
   *    45       offhand 0
   *
   * The trap is the player's own 36. Minecraft's Inventory stores the hotbar
   * at 0-8 and the main grid at 9-35 -- exactly as `inv.slots` does -- but the
   * MENU adds the main grid FIRST and the hotbar LAST. So container 9-35 and
   * inventory 9-35 coincide by luck, while container 36-44 means inventory
   * 0-8. Read 36-44 as "the last nine of inv.slots" and shift-clicking from
   * the hotbar quietly moves the wrong row, in a way that looks correct until
   * something lands on the boundary.
   *
   * Note also what the crafting table does NOT have: no armor slots, no
   * offhand. Vanilla's CraftingMenu really does stop at 46, which is why
   * shift-clicking a helmet at a table can never equip it.
   */
  /*
   * The furnace's menu, AbstractFurnaceMenu's own addSlot order:
   *
   *     0      input
   *     1      fuel
   *     2      output
   *     3-29   slots 9-35        the main grid
   *    30-38   slots 0-8         the hotbar, LAST, same trap as above
   *
   * No armor, no offhand and no crafting grid -- a furnace screen cannot
   * equip a helmet, for the same reason a crafting table cannot.
   */
  const buildFurnaceMenu = () => {
    const slots = [
      { area: 'furnace', index: INPUT },
      { area: 'furnace', index: FUEL },
      { area: 'furnace', index: OUTPUT },
    ]
    for (let i = HOTBAR_SIZE; i < TOTAL_SLOTS; i++) slots.push({ area: 'main', index: i })
    for (let i = 0; i < HOTBAR_SIZE; i++) slots.push({ area: 'main', index: i })
    return slots
  }

  const buildMenu = (gridSize) => {
    const slots = [{ area: 'result', index: 0 }]
    for (let i = 0; i < gridSize * gridSize; i++) slots.push({ area: 'craft', index: i })
    if (gridSize === 2) for (let i = 0; i < 4; i++) slots.push({ area: 'armor', index: i })
    for (let i = HOTBAR_SIZE; i < TOTAL_SLOTS; i++) slots.push({ area: 'main', index: i })
    for (let i = 0; i < HOTBAR_SIZE; i++) slots.push({ area: 'main', index: i })
    if (gridSize === 2) slots.push({ area: 'offhand', index: 0 })
    return slots
  }

  /*
   * The range constants, under vanilla's own field names so the chains below
   * read against the source line for line. Ends are EXCLUSIVE, as
   * moveItemStackTo's `endIndex` is.
   *
   * Built once. The descriptors hold indices, not stacks, so they survive
   * setCraftSize reallocating `inv.craft.cells` underneath them.
   */
  const INV_MENU = {
    slots: buildMenu(2),
    chain: quickMoveInventoryMenu,
    RESULT: 0,
    CRAFT_START: 1, CRAFT_END: 5,
    ARMOR_START: 5, ARMOR_END: 9,
    INV_START: 9, INV_END: 36,
    USE_ROW_START: 36, USE_ROW_END: 45,
    SHIELD_SLOT: 45,
  }
  const FURNACE_MENU = {
    slots: buildFurnaceMenu(),
    chain: quickMoveFurnaceMenu,
    // Named INPUT/FUEL/RESULT to match the three slots, not vanilla's bare
    // 0/1/2 -- the chain below reads on the names.
    INPUT_SLOT: 0, FUEL_SLOT: 1, RESULT: 2,
    INV_START: 3, INV_END: 30,
    USE_ROW_START: 30, USE_ROW_END: 39,
  }
  const TABLE_MENU = {
    slots: buildMenu(3),
    chain: quickMoveCraftingMenu,
    RESULT: 0,
    CRAFT_START: 1, CRAFT_END: 10,
    INV_START: 10, INV_END: 37,
    USE_ROW_START: 37, USE_ROW_END: 46,
  }

  /*
   * Which screen's menu is live.
   *
   * Keyed off the grid size rather than off the screen handle, because the
   * MODEL has to answer this with no DOM attached -- the test suite drives
   * clickSlot directly. `craft.size` is the model's own record of which
   * container it is currently part of: 2 for the player inventory, 3 for a
   * crafting table, set by show() on open and put back on close.
   */
  const openMenu = () => (
    inv.openFurnace ? FURNACE_MENU : inv.craft.size === 3 ? TABLE_MENU : INV_MENU)

  /**
   * Slot.getItem, over whichever container the descriptor names.
   *
   * Hung off `inv` as well, because installInventoryScreen needs exactly this
   * to paint a cell and had its own five-branch copy of it -- which meant two
   * independent answers to "which array is 'offhand'", in a file where adding a
   * container means finding both. The screen is a separate function with no
   * access to this closure, so exposing the read is the only way to share it.
   * Road not taken: exporting `container` instead, which would hand the screen
   * a mutable array and invite it to write through it.
   */
  const slotGet = (d) => (d.area === 'result' ? inv.craft.result : container(d.area)[d.index])
  inv.stackAt = slotGet

  /** Slot.set / Slot.setByPlayer. */
  const slotSet = (d, stack) => {
    if (d.area === 'result') inv.craft.result = stack
    else container(d.area)[d.index] = stack
  }

  /**
   * Slot.mayPlace. ResultSlot.mayPlace returns false unconditionally; armor
   * slots are picky; everything else takes anything. `accepts` already
   * encodes the armor rule for ordinary clicks, so this is the result slot
   * plus a delegation rather than a second copy of the rule.
   */
  const mayPlace = (d, stack) => d.area !== 'result' && accepts(d.area, d.index, stack.id)

  /**
   * Slot.getMaxStackSize(stack) = min(the slot's own cap, the item's cap).
   * No slot here caps below 64: vanilla's ArmorSlot caps at 1, but every
   * armor item in items.js is already `stack: 1`, so the item's cap is the
   * whole answer and a slot cap would only restate it.
   */
  const slotMaxStackSize = (stack) => stackMax(stack.id)

  /**
   * AbstractContainerMenu.moveItemStackTo, verbatim.
   *
   * `stack` is the LIVE stack out of the source slot and is mutated in place,
   * exactly as vanilla mutates its ItemStack; `count === 0` is ItemStack.EMPTY.
   * Returns whether anything moved, which is all quickMoveStack looks at.
   *
   * TWO PASSES, and their order is the part people feel:
   *
   *   1. top up every compatible stack already in the range
   *   2. only then, drop what is left into the FIRST empty slot
   *
   * Fusing them into one loop is the obvious simplification and it is wrong:
   * 40 cobblestone shift-clicked past an empty slot into a row holding a
   * 30-stack would land in the empty slot and fragment, where Minecraft fills
   * the 30 up to 64 and puts the remaining 6 in the empty one.
   *
   * `reverseDirection` walks the range from the far end. Only the crafting
   * RESULT slot ever passes true, in both menus, and that is why a crafted
   * item lands in your RIGHTMOST free hotbar slot instead of the first free
   * slot of your inventory.
   */
  const moveItemStackTo = (menu, stack, startIndex, endIndex, reverseDirection) => {
    let moved = false
    let i = reverseDirection ? endIndex - 1 : startIndex
    const inRange = () => (reverseDirection ? i >= startIndex : i < endIndex)
    const step = () => { i += reverseDirection ? -1 : 1 }

    // ItemStack.isStackable(). Unstackable items skip the merge pass outright,
    // which is why two pickaxes never combine into one slot.
    if (stackMax(stack.id) > 1) {
      while (stack.count > 0 && inRange()) {
        const target = slotGet(menu.slots[i])
        /*
         * NO mayPlace CHECK HERE, and that is vanilla rather than an
         * oversight on our part: the merge pass tests only "same item", and
         * only the empty-slot pass below asks the slot whether it will accept
         * the item at all. Unobservable in these two screens -- nothing in
         * range refuses an item it is already holding -- but reproducing it
         * keeps the two passes honestly different from each other.
         */
        if (target && target.id === stack.id) {
          const sum = target.count + stack.count
          const max = slotMaxStackSize(stack)
          if (sum <= max) {
            stack.count = 0
            target.count = sum
            moved = true
          } else if (target.count < max) {
            stack.count -= max - target.count
            target.count = max
            moved = true
          }
        }
        step()
      }
    }

    if (stack.count > 0) {
      i = reverseDirection ? endIndex - 1 : startIndex
      while (inRange()) {
        const d = menu.slots[i]
        if (!slotGet(d) && mayPlace(d, stack)) {
          /*
           * ONE empty slot, then `break`. Vanilla does not keep filling, and
           * the break is load-bearing the moment a slot's cap is lower than
           * the stack being moved -- the remainder stays on the stack and the
           * caller decides what happens to it. With everything capped at 64
           * there is no remainder today; keeping the break costs nothing and
           * keeps that true by construction rather than by luck.
           */
          const put = Math.min(stack.count, slotMaxStackSize(stack))
          slotSet(d, { id: stack.id, count: put })
          stack.count -= put
          moved = true
          break
        }
        step()
      }
    }

    return moved
  }

  /**
   * Player.getEquipmentSlotForItem: where an item equips itself. Armor
   * answers its own piece, a shield would answer 'offhand', everything else
   * answers 'mainhand'.
   *
   * items.js has no shield, so the offhand branch of the chain below is
   * dormant. Kept anyway, because deleting it would change the ORDER of the
   * chain, and the order is the specification.
   */
  const equipmentSlotForItem = (id) => armorOf(id)?.slot ?? 'mainhand'

  /**
   * InventoryMenu.quickMoveStack's if/else chain, verbatim.
   *
   * Returns false where vanilla returns ItemStack.EMPTY -- "refuse the whole
   * click, change nothing else" -- and true otherwise.
   */
  function quickMoveInventoryMenu(m, index, stack) {
    const equip = equipmentSlotForItem(stack.id)
    /*
     * Vanilla writes the armor destination as `8 - equipmentslot.getIndex()`,
     * where the EquipmentSlot indices run FEET 0, LEGS 1, CHEST 2, HEAD 3 --
     * i.e. it counts BACKWARDS from the boots slot at 8 to the helmet at 5.
     * ARMOR_SLOTS runs helmet-first, so the same number is ARMOR_START + i,
     * and writing it that way is what stops the boots landing on your head.
     */
    const armorAt = ARMOR_SLOTS.indexOf(equip)
    const armorSlot = armorAt < 0 ? -1 : m.ARMOR_START + armorAt

    if (index === m.RESULT) {
      if (!moveItemStackTo(m, stack, m.INV_START, m.USE_ROW_END, true)) return false
      /*
       * slot.onQuickCraft(itemstack1, itemstack) belongs here. All it does is
       * add (original count - remaining count) to ResultSlot.removeCount so
       * that checkTakeAchievements can award the "crafted N of X" statistic
       * and the recipe unlock once per batch instead of once per item. There
       * are no stats, advancements or recipe book here, so there is nothing
       * for it to accumulate -- the half of that path that IS observable is
       * the ingredient spend, and that happens in onTake below.
       */
    } else if (index >= m.CRAFT_START && index < m.CRAFT_END) {
      if (!moveItemStackTo(m, stack, m.INV_START, m.USE_ROW_END, false)) return false
    } else if (index >= m.ARMOR_START && index < m.ARMOR_END) {
      if (!moveItemStackTo(m, stack, m.INV_START, m.USE_ROW_END, false)) return false
    } else if (armorSlot >= 0 && !slotGet(m.slots[armorSlot])) {
      /*
       * An armor piece equips itself -- but ONLY into an EMPTY slot. Vanilla
       * guards on `!slots.get(8 - index).hasItem()`, so a second helmet while
       * you are already wearing one falls through to the plain main<->hotbar
       * moves below instead of swapping with the one you have on.
       *
       * The one-slot range (i, i+1) is also what makes this land in the
       * helmet slot rather than the first free slot anywhere.
       */
      if (!moveItemStackTo(m, stack, armorSlot, armorSlot + 1, false)) return false
    } else if (equip === 'offhand' && !slotGet(m.slots[m.SHIELD_SLOT])) {
      if (!moveItemStackTo(m, stack, m.SHIELD_SLOT, m.SHIELD_SLOT + 1, false)) return false
    } else if (index >= m.INV_START && index < m.INV_END) {
      if (!moveItemStackTo(m, stack, m.USE_ROW_START, m.USE_ROW_END, false)) return false
    } else if (index >= m.USE_ROW_START && index < m.USE_ROW_END) {
      if (!moveItemStackTo(m, stack, m.INV_START, m.INV_END, false)) return false
    } else if (!moveItemStackTo(m, stack, m.INV_START, m.USE_ROW_END, false)) {
      return false
    }
    return true
  }

  /**
   * CraftingMenu.quickMoveStack's if/else chain, verbatim.
   *
   * THE WIKI IS WRONG HERE, and this is the branch to read twice. The
   * Inventory page says shift-clicking "immediately moves it between the
   * inventory and the hotbar", full stop. At a crafting table the source
   * tries the 3x3 GRID FIRST -- moveItemStackTo(stack, 1, 10, false) -- and
   * only falls back to the hotbar<->main swap when the grid refuses, which it
   * does only when all nine cells are occupied. So with any free cell,
   * shift-clicking a stack in your inventory LOADS THE GRID with it.
   *
   * Verified identical in 1.20.1 and 1.21.1, so it is not a version quirk.
   */
  function quickMoveCraftingMenu(m, index, stack) {
    if (index === m.RESULT) {
      // access.execute(... onCraftedBy ...) sits here in vanilla: the item's
      // own "you just made me" callback. Nothing in items.js has one.
      if (!moveItemStackTo(m, stack, m.INV_START, m.USE_ROW_END, true)) return false
      // slot.onQuickCraft -- see the note in the InventoryMenu chain.
    } else if (index >= m.INV_START && index < m.USE_ROW_END) {
      if (!moveItemStackTo(m, stack, m.CRAFT_START, m.CRAFT_END, false)) {
        if (index < m.USE_ROW_START) {
          if (!moveItemStackTo(m, stack, m.USE_ROW_START, m.USE_ROW_END, false)) return false
        } else if (!moveItemStackTo(m, stack, m.INV_START, m.USE_ROW_START, false)) return false
      }
    } else if (!moveItemStackTo(m, stack, m.INV_START, m.USE_ROW_END, false)) {
      return false
    }
    return true
  }

  /**
   * AbstractFurnaceMenu.quickMoveStack's if/else chain, verbatim.
   *
   * THIS IS THE PART PEOPLE NOTICE. Shift-clicking at a furnace does not
   * mean "move it to the other half of the screen": vanilla asks what the
   * item IS. A smeltable goes to the input slot, a fuel goes to the fuel
   * slot, and only something that is neither falls through to the ordinary
   * main<->hotbar swap. Shift-click a stack of raw iron and a stack of coal
   * into an open furnace and it starts running without you aiming at a slot
   * once.
   *
   * The question is asked in that ORDER, and the order is visible: a log is
   * both smeltable (into charcoal) and fuel, and vanilla sends it to the
   * INPUT slot, not the fuel slot. Reversing the two tests would make every
   * log in the game fuel and charcoal unobtainable.
   *
   *   } else if (index != 1 && index != 0) {
   *     if (this.canSmelt(itemstack1)) {
   *       if (!this.moveItemStackTo(itemstack1, 0, 1, false)) return EMPTY;
   *     } else if (this.isFuel(itemstack1)) {
   *       if (!this.moveItemStackTo(itemstack1, 1, 2, false)) return EMPTY;
   *     } else if ...
   *
   * Note what the first branch is NOT: it is not "is this slot the input or
   * the fuel slot, send it to the inventory" written twice. Clicking IN the
   * input or fuel slot is the final `else`, which empties that slot into the
   * player -- the whole player, both rows, in one range.
   */
  function quickMoveFurnaceMenu(m, index, stack) {
    if (index === m.RESULT) {
      /*
       * Reversed, like both crafting results: a smelted ingot lands in your
       * rightmost free hotbar slot. FurnaceResultSlot.onTake also awards the
       * accumulated smelting experience here -- there is no XP system in this
       * world for it to award into, which is the one piece of the furnace
       * that is honestly missing rather than deliberately cut.
       */
      if (!moveItemStackTo(m, stack, m.INV_START, m.USE_ROW_END, true)) return false
    } else if (index !== m.FUEL_SLOT && index !== m.INPUT_SLOT) {
      if (smeltingResult(stack.id)) {
        if (!moveItemStackTo(m, stack, m.INPUT_SLOT, m.INPUT_SLOT + 1, false)) return false
      } else if (burnTicks(stack.id)) {
        if (!moveItemStackTo(m, stack, m.FUEL_SLOT, m.FUEL_SLOT + 1, false)) return false
      } else if (index >= m.INV_START && index < m.INV_END) {
        if (!moveItemStackTo(m, stack, m.USE_ROW_START, m.USE_ROW_END, false)) return false
      } else if (index >= m.USE_ROW_START && index < m.USE_ROW_END) {
        if (!moveItemStackTo(m, stack, m.INV_START, m.INV_END, false)) return false
      }
    } else if (!moveItemStackTo(m, stack, m.INV_START, m.USE_ROW_END, false)) {
      return false
    }
    return true
  }

  /**
   * The tail both quickMoveStack overrides share, character for character.
   *
   * Returns vanilla's `itemstack` -- a COPY of the stack as it was before the
   * move -- or null for ItemStack.EMPTY. That distinction is the only thing
   * the repeat loop terminates on, which is why this returns the copy rather
   * than a boolean.
   */
  const quickMoveStack = (menu, index) => {
    const d = menu.slots[index]
    const live = slotGet(d)
    if (!live) return null                          // slot.hasItem()
    const original = { id: live.id, count: live.count }

    if (!menu.chain(menu, index, live)) return null

    if (live.count <= 0) slotSet(d, null)           // slot.setByPlayer(EMPTY)

    /*
     * Defensive in vanilla and kept for the same reason: a chain that moved
     * nothing has already bailed out above, so the only way here is a future
     * range that turns out to be a no-op. Returning EMPTY is what stops the
     * repeat loop spinning on it.
     */
    if (live.count === original.count) return null

    // slot.onTake. Only ResultSlot overrides it, and what it does is spend
    // the grid: ONE item out of every occupied cell, per craft.
    if (d.area === 'result') {
      consumeGrid(inv.craft.cells)
      /*
       * Container.setChanged -> slotsChanged -> slotChangedCraftingGrid. This
       * has to happen BEFORE the repeat loop looks at the slot again, because
       * the refreshed result is exactly what that loop terminates on.
       */
      refreshResult()
      /*
       * player.drop(itemstack1, false). A result that only PARTLY fitted does
       * not go back in the slot -- it goes on the floor. Surprising, and it
       * is the reason crafting into a nearly-full inventory can cost you the
       * ingredients for items you never receive. The wiki's "moves it
       * straight to the inventory" does not mention it.
       */
      if (live.count > 0) discard(live.id, live.count)
    }

    return original
  }

  /**
   * AbstractContainerMenu.doClick's ClickType.QUICK_MOVE case, verbatim.
   *
   * THIS LOOP IS THE REPEATED CRAFTING. quickMoveStack is called again and
   * again for as long as it moved something AND the slot has refilled with
   * the same item. For an ordinary slot that is one iteration, because the
   * slot is empty the second time round. For the crafting result, taking it
   * spends the grid and the grid immediately produces another one, so it runs
   * until the grid runs dry or the inventory stops accepting.
   *
   * Road not taken: a `while (result && roomSomewhere)` loop written specially
   * for the result slot. It agrees in the easy case and is wrong in every
   * partial one -- notably the last craft that only half fits, which vanilla
   * performs anyway and then drops the remainder on the floor.
   */
  const quickMove = (area, index) => {
    const menu = openMenu()
    const at = menu.slots.findIndex(d => d.area === area && d.index === index)
    // A slot the open screen does not have: armor and offhand while a
    // crafting table is up. Vanilla cannot even express the click -- there is
    // no such cell on the screen to aim at.
    if (at < 0) return

    let moved = quickMoveStack(menu, at)
    // ItemStack.isSameItem(slot.getItem(), moved). An empty slot is never
    // "the same item", and that is what ends the ordinary one-shot case.
    while (moved && slotGet(menu.slots[at])?.id === moved.id) {
      moved = quickMoveStack(menu, at)
    }

    // Any of those moves can have changed the crafting grid -- pulling an
    // ingredient out of it, or, at a table, pushing one in -- and the result
    // is derived from the grid.
    refreshResult()
    changed()
  }

  /*
   * Click handling, matching Minecraft's rules exactly:
   *   left  + empty hand -> take the whole stack
   *   left  + full hand  -> drop it, merging if same type, else swap
   *   right + empty hand -> take half (rounded up)
   *   right + full hand  -> place a single item
   *
   * `area` defaults to the main 36 and `shift` to false, so every existing
   * caller -- and the test suite, which drives this directly -- keeps working
   * unchanged. Shift-click is a fourth argument rather than a second entry
   * point because that is how vanilla models it too: one doClick, branching
   * on ClickType. A parallel `inv.shiftClick()` would have to re-derive every
   * guard this function already owns.
   */
  inv.clickSlot = (index, button, area = 'main', shift = false) => {
    /*
     * Shift-click is dispatched FIRST because vanilla dispatches on the click
     * TYPE before it ever looks at the slot: doClick's QUICK_MOVE case runs to
     * completion without consulting the carried stack once. So shift-clicking
     * while you are holding a stack moves the SLOT's items and leaves your
     * hand exactly as it was -- it does not swap, merge or drop.
     *
     * Both buttons quick-move. Vanilla's guard is `button == 0 || button == 1`,
     * which is either of them, so `button` is deliberately unread here.
     */
    if (shift) { quickMove(area, index); return }

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

  /** Equip a piece into the slot it belongs in. Convenience for tests and for
   *  anything that wants to dress the player without going through a click;
   *  shift-clicking armor takes the quickMove path above instead. */
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

/* ------------------------------------------------------------------ *
 * The furnace screen.
 *
 * GEOMETRY is AbstractFurnaceMenu's addSlot calls and AbstractFurnaceScreen's
 * renderBg, in GUI pixels, same discipline as every panel above:
 *
 *   input     56, 17
 *   fuel      56, 53
 *   output   116, 35
 *   flame     56, 36, 14x14, and it BURNS DOWN -- vanilla blits
 *             (14 - k) pixels into the sprite and k pixels tall at
 *             y + 36 + 14 - k, where k = 13 * litTime / litDuration
 *   arrow     79, 34, 24x16, filled left to right to
 *             l = 24 * cookingProgress / cookingTotalTime
 *   title     centred: titleLabelX = (imageWidth - font.width(title)) / 2
 *
 * DRAWN, NOT BLITTED, and for exactly the reason the creative picker is (see
 * the long note at the bottom of this file): the art is
 * gui/container/furnace.png in the vanilla jar, and THE CE PACK HAS NO
 * FURNACE GUI AT ALL -- its gui/ directory is five files, crafting_table,
 * inventory, icons, widgets and heart_legacy. A deploy ships CE, so extracting
 * furnace.png would give a panel that looks right in development and 404s in
 * production. So the panel, the slot recesses, the flame and the arrow are
 * built from Minecraft's GUI palette in CSS at the same GUI-pixel scale, and
 * they look identical in both builds.
 *
 * What the flame and the arrow MEAN is not approximated: both are driven from
 * the furnace's own two clocks, scaled by vanilla's own 13 and 24.
 * ------------------------------------------------------------------ */
const FURNACE_SLOTS = {
  [INPUT]: { x: 56, y: 17 },
  [FUEL]: { x: 56, y: 53 },
  [OUTPUT]: { x: 116, y: 35 },
}
const FLAME = { x: 56, y: 36, w: 14, h: 14, steps: 13 }
const ARROW = { x: 79, y: 34, w: 24, h: 16, steps: 24 }
/** getLitProgress / getBurnProgress, both clamped to their sprite's width. */
const litProgress = (f) => (f.burnTotal > 0
  ? Math.min(FLAME.steps, Math.round((f.burn * FLAME.steps) / f.burnTotal)) : 0)
const burnProgress = (f) => (f.cookTotal > 0
  ? Math.min(ARROW.steps, Math.round((f.cook * ARROW.steps) / f.cookTotal)) : 0)

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

/* ------------------------------------------------------------------ *
 * The hover tooltip.
 *
 * Reported from play: "When I hover over a block in inv i think it should say
 * the name of it? I believe this is true minecraft behavior." It is, in every
 * container -- and what this world had was `el.title`, the BROWSER's tooltip,
 * on the creative list and the tabs only. That is why the report exists: the
 * native one appears after a second of stillness, in the OS's font, nowhere
 * near where Minecraft puts it, and the survival inventory, the crafting
 * grid, the armor slots and the hotbar row had none at all.
 *
 * WHERE THE NUMBERS COME FROM. minecraft.wiki/w/Tooltip describes behaviour
 * and not pixels ("next to the cursor"; "Long tooltips no longer get cut off
 * at the edge of the screen" in 1.19.3 22w42a), so the colours below were
 * SAMPLED from vanilla's own sprites, which the wiki does host:
 * minecraft.wiki/w/Java_Edition_GUI_textures lists tooltip/background.png and
 * tooltip/frame.png, and reading their pixels gives
 *
 *   background   0xF0100010   #100010 at alpha 240/255
 *   frame        0x505000FF at the top fading to 0x5028007F at the bottom,
 *                a 1px line inset 1px from the background's edge
 *
 * which are the constants everyone quotes at Minecraft's tooltips, confirmed
 * against the art rather than copied from memory.
 *
 * The geometry is vanilla's layout: the text origin is 12 GUI px right and
 * 12 GUI px ABOVE the cursor, the box reaches 4 GUI px beyond the text on
 * every side (1 px of background, the 1 px frame, then 2 px of gap), and
 * lines are 10 GUI px apart. Near an edge the box flips to the cursor's left
 * and is clamped on screen rather than being allowed to run off it, which is
 * the 22w42a behaviour above.
 *
 * NOT reproduced: vanilla notches one pixel out of each corner of the
 * background so it reads as rounded. Four 2px corners on a box this size is
 * invisible next to the cost of four more elements per tooltip.
 * ------------------------------------------------------------------ */
const TIP_CURSOR_OFFSET = 12
const TIP_PAD = 4
function createTooltip() {
  const el = document.createElement('div')
  el.id = 'gui-tooltip'
  el.className = 'hidden'
  const inner = document.createElement('div')
  inner.className = 'tip-inner'
  el.appendChild(inner)
  document.body.appendChild(el)

  const hide = () => el.classList.add('hidden')

  /** @param {string[]} lines first is the name, any rest are dimmed. */
  const show = (lines, clientX, clientY) => {
    inner.textContent = ''
    for (const [i, text] of lines.entries()) {
      const line = document.createElement('div')
      line.className = 'tip-line'
      line.textContent = text
      line.style.fontSize = `${FONT_PX}px`
      if (i > 0) line.classList.add('tip-dim')
      inner.appendChild(line)
    }
    el.classList.remove('hidden')
    move(clientX, clientY)
  }

  /*
   * Positioned only after the text is in, because the flip-at-the-edge test
   * needs the width, and the width is whatever the longest line measured to.
   * `offsetWidth` here is a forced layout -- once per tooltip move, on a
   * screen where the world is the only thing animating, which is the cheap
   * end of a trade that would otherwise mean measuring text by hand.
   */
  const move = (clientX, clientY) => {
    const w = el.offsetWidth, h = el.offsetHeight
    const edge = TIP_PAD * HUD_SCALE
    let left = clientX + (TIP_CURSOR_OFFSET - TIP_PAD) * HUD_SCALE
    if (left + w > window.innerWidth) {
      left = Math.max(edge, clientX - (TIP_CURSOR_OFFSET - TIP_PAD) * HUD_SCALE - w)
    }
    const top = clientY - (TIP_CURSOR_OFFSET + TIP_PAD) * HUD_SCALE
    el.style.transform = `translate(${Math.round(left)}px, ${
      Math.round(Math.min(Math.max(top, edge), window.innerHeight - h - edge))}px)`
  }

  /**
   * Make an element show a tooltip while the pointer is over it.
   *
   * `lines()` is asked on every move rather than once at attach: a slot's
   * contents change under a motionless pointer every time you click, and the
   * creative list's 45 cells are a scrolling WINDOW onto 731 entries, so the
   * item under the pointer changes with the wheel and not with the mouse.
   * Returning null means "nothing to say", which is how an empty slot and a
   * cell past the end of the listing both stay silent.
   */
  const attach = (target, lines) => {
    const update = (e) => {
      const text = lines()
      if (!text) return hide()
      show(text, e.clientX, e.clientY)
    }
    target.addEventListener('mouseenter', update)
    target.addEventListener('mousemove', update)
    target.addEventListener('mouseleave', hide)
  }

  return { attach, hide }
}

/*
 * `gamemode` is here for ONE question: does E open the survival screen or the
 * creative picker. It is optional so the model-only callers and the older
 * tests keep working -- absent, this behaves exactly as it did, which is the
 * survival screen for everybody.
 */
export function installInventoryScreen(noa, inv, inputLock, gamemode = null) {
  const screen = document.getElementById('inventory')
  const panel = document.getElementById('inv-panel')
  const tableScreen = document.getElementById('crafting')
  const tablePanel = document.getElementById('craft-panel')
  const furnaceScreen = document.getElementById('furnace')
  const furnacePanel = document.getElementById('furnace-panel')
  const creativeScreen = document.getElementById('creative')
  const creativePanel = document.getElementById('creative-panel')
  const carried = document.getElementById('inv-carried')

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
  /*
   * ONE tooltip element for every container on every screen, created here and
   * handed to the creative screen below along with makeCell -- same reasoning
   * as the cell factory. Two of them would be two things that can disagree
   * about where Minecraft puts a tooltip.
   */
  const tooltip = createTooltip()

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
    // The address, on the element. The creative screen's pick-block listener
    // sits on the PANEL rather than on each cell (it has to run before the
    // cell's own handler), so it finds a cell by hit-test and needs to ask it
    // what it addresses.
    cell.dataset.area = area
    cell.dataset.index = index
    const hint = SLOT_HINTS[area]?.[index]
    if (hint) cell.dataset.hint = `url(/ui/slot_${hint}.png)`
    cell.style.left = px(gx)
    cell.style.top = px(gy)
    cell.style.width = cell.style.height = px(SLOT_SIZE)
    cell.addEventListener('mousedown', (e) => {
      e.preventDefault()
      // e.shiftKey off the REAL event, rather than tracking Shift ourselves
      // from keydown/keyup: a keyup that lands while the window is unfocused
      // is missed, and then every click is a shift-click.
      inv.clickSlot(index, e.button === 2 ? 'right' : 'left', area, e.shiftKey)
    })
    cell.addEventListener('contextmenu', e => e.preventDefault())
    /*
     * The name of what is in the slot -- and NOTHING while you are carrying a
     * stack, which is vanilla: AbstractContainerScreen only renders the
     * hovered slot's tooltip when the cursor is empty, because otherwise the
     * box sits under the stack you are dragging and covers where you are
     * about to drop it.
     */
    tooltip.attach(cell, () => {
      if (inv.carried) return null
      const stack = inv.stackAt({ area, index })
      return stack ? [itemName(stack.id)] : null
    })
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

  /* ---- the furnace panel ---- */
  furnacePanel.style.width = px(GUI_W)
  furnacePanel.style.height = px(GUI_H)
  // The player's own 36, at the same coordinates every container screen uses.
  for (let i = HOTBAR_SIZE; i < TOTAL_SLOTS; i++) {
    const n = i - HOTBAR_SIZE
    makeCell(furnacePanel, 'main', i,
      GRID_X + (n % 9) * SLOT_PITCH, GRID_Y + Math.floor(n / 9) * SLOT_PITCH)
      .classList.add('drawn-slot')
  }
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    makeCell(furnacePanel, 'main', i, GRID_X + i * SLOT_PITCH, BAR_Y).classList.add('drawn-slot')
  }
  for (const [index, at] of Object.entries(FURNACE_SLOTS)) {
    makeCell(furnacePanel, 'furnace', Number(index), at.x, at.y).classList.add('drawn-slot')
  }

  /*
   * The flame and the arrow. Two elements each: the dark shape vanilla's
   * background sprite paints, and the lit part drawn over it. The lit part is
   * CLIPPED rather than resized -- a 14px-tall flame scaled to 4px is a
   * squashed flame, where vanilla shows the bottom 4 pixels of a full one.
   */
  const gauge = (cls, at) => {
    const el = document.createElement('div')
    el.className = `furnace-gauge ${cls}`
    el.style.left = px(at.x)
    el.style.top = px(at.y)
    el.style.width = px(at.w)
    el.style.height = px(at.h)
    const fill = document.createElement('div')
    fill.className = 'gauge-fill'
    el.appendChild(fill)
    furnacePanel.appendChild(el)
    return fill
  }
  const flameFill = gauge('furnace-flame', FLAME)
  const arrowFill = gauge('furnace-arrow', ARROW)

  const furnaceTitle = document.createElement('div')
  furnaceTitle.className = 'gui-label furnace-title'
  furnaceTitle.style.top = px(6)
  furnaceTitle.style.fontSize = `${FONT_PX}px`
  furnaceTitle.style.color = LABEL_COLOR
  furnacePanel.appendChild(furnaceTitle)
  {
    const el = document.createElement('div')
    el.className = 'gui-label'
    el.textContent = 'Inventory'
    el.style.left = px(8)
    el.style.top = px(GUI_H - 94)
    el.style.fontSize = `${FONT_PX}px`
    el.style.color = LABEL_COLOR
    furnacePanel.appendChild(el)
  }

  /**
   * Paint the two gauges from the open furnace's clocks.
   *
   * Cheap on purpose -- two style writes -- because this runs on every tick
   * while the screen is open, unlike the slot repaint, which rebuilds icons
   * and only runs when the contents actually change.
   */
  const paintGauges = () => {
    const f = inv.openFurnace
    const k = f ? litProgress(f) : 0
    const l = f ? burnProgress(f) : 0
    // Anchored at the BOTTOM: the flame burns down, not up.
    flameFill.style.height = `${(k / FLAME.steps) * 100}%`
    arrowFill.style.width = `${(l / ARROW.steps) * 100}%`
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
  inv.onChange(() => {
    for (const cell of cells) paintSlot(cell.el, inv.stackAt(cell))
    paintSlot(carried, inv.carried)
    carried.classList.toggle('hidden', !inv.carried)
  })

  /*
   * THE FURNACES TICK HERE, and they tick whether or not a screen is open.
   *
   * `dt` is milliseconds; furnaces.advance converts it to Minecraft's 20 Hz
   * itself, because noa's tick is 30 Hz and counting engine ticks would make
   * every number in recipes.js 1.5x wrong.
   *
   * Installed from the SCREEN installer rather than from main.js, which is the
   * one thing here that is not obviously right: a furnace is world state and
   * main.js is where world state is wired. It is here because main.js is a
   * shared file with two other agents in it today, and because inventory.js
   * already owns `inv.furnaces`. Worth moving when the traffic dies down.
   *
   * The repaint is split in two on purpose. The gauges are two style writes
   * and run every tick; the SLOTS rebuild item icons, so they are repainted
   * only when a smelt actually moved something -- compared by a cheap
   * signature rather than by trusting the tick count, because a furnace that
   * is burning changes its clocks 20 times a second and its contents once
   * every 200.
   */
  const slotSignature = (f) => (f ? f.slots.map(x => (x ? `${x.id}x${x.count}` : '-')).join() : '')
  let lastSignature = ''
  noa.on('tick', (dt) => {
    inv.furnaces.advance(dt)
    if (current !== 'furnace') return
    paintGauges()
    const sig = slotSignature(inv.openFurnace)
    if (sig === lastSignature) return
    lastSignature = sig
    inv.emitChange()
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
  /*
   * The creative picker, built here rather than in its own installer so it
   * can be handed makeCell and paintSlot -- the player's nine hotbar slots
   * appear on BOTH screens, and they must click identically on both.
   */
  const creative = buildCreativeScreen(inv, {
    screen: creativeScreen, panel: creativePanel, makeCell, paintSlot, tooltip,
    repaint: () => inv.emitChange(),
  })

  let current = null // null | 'inventory' | 'creative' | 'table' | 'furnace'

  /*
   * `at` is the furnace's state, and only the furnace screen takes one.
   *
   * A second parameter rather than a separate showFurnace(): every rule this
   * function owns -- pointer lock, the input lock, emptying the crafting grid
   * on the way out, hiding the tooltip -- applies to the furnace too, and a
   * parallel entry point is how one of them gets forgotten.
   */
  const show = (which, at = null) => {
    if (current === which && inv.openFurnace === at) return
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
    creativeScreen.classList.toggle('hidden', which !== 'creative')
    furnaceScreen.classList.toggle('hidden', which !== 'furnace')
    /*
     * The furnace KEEPS ITS CONTENTS when you close it -- that is the whole
     * difference between it and a crafting grid, and it is why clearCraft
     * above has no furnace equivalent. All that is dropped here is the
     * REFERENCE, so `openMenu()` goes back to answering the player's own
     * screen and the burning carries on in inv.furnaces without a screen.
     */
    inv.openFurnace = which === 'furnace' ? at : null
    if (at) {
      furnaceTitle.textContent = itemName(itemId(at.kind))
      paintGauges()
    }
    if (which === 'creative') creative.opened()
    // A tooltip outlives the screen it was drawn over otherwise: the pointer
    // never leaves the cell, it is the cell that goes away, so no mouseleave
    // ever fires and the box is still sitting there over the world.
    tooltip.hide()
    document.body.classList.toggle('inv-open', inv.open)

    // Set on CLOSE as well as on open. `craft.size` is how the model knows
    // which container it is part of -- openMenu() reads it to pick between
    // InventoryMenu and CraftingMenu -- so leaving it at 3 after a table
    // closes would have the next shift-click use the table's slot ranges
    // against the player's own screen.
    inv.setCraftSize(which === 'table' ? 3 : 2)

    // Pointer lock and a mouse-driven UI are mutually exclusive; releasing the
    // lock is what brings the cursor back. The world keeps ticking, so the sky
    // moves and other players would keep walking behind it, as in Minecraft
    // multiplayer.
    /*
     * Closing ASKS PERSISTENTLY for the lock instead of once.
     *
     * inputLock.unlock() only restores look sensitivity; it does not bring
     * the mouse back under the crosshair. A single setPointerLock(true) did
     * ask -- but when the close came from Escape the browser is inside its
     * ~1.25 s post-Escape cooldown and silently rejects it, so the screen
     * went away and the OS cursor stayed. See the note above
     * requestLockPersistently in menu.js.
     *
     * Cancelling on OPEN matters just as much: without it, a close followed
     * quickly by a reopen leaves the old retry loop still asking, and it
     * would grab the lock out from under the screen you just opened.
     */
    if (inv.open) inputLock.lock('inventory')
    else inputLock.unlock('inventory')
    if (inv.open) { cancelPersistentLock(); noa.container.setPointerLock(false) }
    else requestLockPersistently(noa)
    inv.emitChange()
  }

  /*
   * Which screen E opens. `infiniteResources` rather than a mode-name test,
   * because that is the capability the picker IS -- gamemode.js's whole point
   * is that nothing outside it names a mode, and a fifth mode with infinite
   * resources should get this screen without an edit here.
   */
  const playerScreen = () => (gamemode?.caps?.infiniteResources ? 'creative' : 'inventory')

  const setOpen = (open) => show(open ? playerScreen() : null)

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
  noa.inputs.down.on('inventory', () => show(current ? null : playerScreen()))

  /*
   * Escape closes the open screen, and that is ALL it does. While a screen is
   * up, this handler OWNS the key: capture phase on document, copied from
   * chat.js, which sees the event before every bubbling listener on the page
   * and stops it there. menu.js's Escape handler, interact.js, perspective.js
   * and noa's own bindings all listen in the bubble phase, so one
   * stopPropagation is enough and it does not depend on the order main.js
   * happens to install them in.
   *
   * WHY IT MATTERS, because it is one keypress doing two jobs: this used to
   * bubble, and main.js installs the inventory screen before the menu, so on
   * one Escape this ran first and cleared `inv.open` -- and every guard
   * downstream that reads `inventory.open` to decide "a screen is already
   * handling this" was then reading a flag that had just been falsified by
   * the handler ahead of it. menu.js's own keydown guard is the one that
   * looks like that, and it survives the race only because that handler can
   * only ever CLOSE the pause menu. Owning the key outright is cheaper than
   * auditing every future reader of the flag.
   *
   * NOT covered by this, and worth knowing: the pause menu does not open on a
   * keydown at all. main.js opens it from `lostPointerLock`, because Chrome
   * eats the Escape that exits pointer lock. A browser that DOES deliver that
   * keydown (Firefox does) while the inventory somehow holds the lock would
   * run this handler synchronously and main.js's async lock guard afterwards,
   * against an `inventory.open` this already cleared. Fixing that means
   * widening the guard in main.js, which is not this file's to widen.
   *
   * Rejected: installing the menu before the inventory in main.js. It works
   * by accident and breaks the next time someone moves a line.
   * Rejected: a "who owns Escape" arbiter module. One more indirection for
   * two screens; revisit at three.
   *
   * keyup is deliberately not touched -- see chat.js's note on why swallowing
   * it leaves noa with a key latched down.
   */
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || !current) return
    e.stopPropagation()
    show(null)
  }, true)

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
  const useBlock = (blockId, position) => {
    if (blockId === CRAFTING_TABLE) { show('table'); return true }
    /*
     * A furnace screen is bound to a POSITION, not to a block id: two
     * furnaces side by side are two separate machines with separate
     * contents. `furnaces.at` creates the state on first use, which is this
     * world's stand-in for a block entity -- see the note in furnace.js about
     * what that costs when a furnace is broken and replaced.
     */
    const kind = FURNACE_BLOCKS.get(blockId)
    if (!kind) return false
    show('furnace', inv.furnaces.at(position, kind))
    return true
  }

  const api = {
    setOpen, useBlock, openCraftingTable: () => show('table'), current: () => current,
    /** Open a furnace by world position, for the console and the test suite --
     *  the same path a right-click takes, minus aiming at one. */
    openFurnace: (position, kind = 'furnace') =>
      show('furnace', inv.furnaces.at(position, kind)),
    /*
     * The picker's handle, for the test suite and the console. Exposed rather
     * than reached through the DOM because "which tab is showing" and "how far
     * is it scrolled" are state, and a spec that asserts on them by reading
     * class names is a spec that breaks when the CSS changes.
     */
    creative,
  }

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

/* ==================================================================== *
 * The creative item picker.
 *
 * A SECOND SCREEN, not a change to the first. In creative, E opens this
 * instead of the survival inventory; the survival screen, its crafting grid
 * and its shift-click rules are untouched and still what every other mode
 * gets. Road not taken: one screen with a creative "mode" flag, which would
 * have put a `if (creative)` inside clickSlot -- the one function in this
 * file whose rules are transcribed from vanilla and must stay that way.
 *
 * GEOMETRY is vanilla's CreativeModeInventoryScreen / ItemPickerMenu, in GUI
 * pixels, same discipline as the survival panel above:
 *
 *   panel        195 x 136
 *   item grid    9 x 5 at x = 9 + col*18, y = 18 + row*18
 *   hotbar       x = 9 + i*18, y = 112        (the player's own 0-8)
 *   scroll track x = 175, y = 18, 12 wide, 112 tall; scroller 12 x 15
 *   search box   x = 82, y = 6, 80 x 9
 *   tabs         26 x 32 at a pitch of 28; the top row at y = -28 so its
 *                bottom four pixels overlap the panel, the bottom row at
 *                y = 132 so its top four do
 *
 * DRAWN, NOT BLITTED, and this is the one deliberate departure from the
 * "match Minecraft's sprite grid" rule the rest of the GUI follows. The art
 * for this screen lives at gui/container/creative_inventory/ and
 * gui/sprites/container/creative_inventory/, and NEITHER SOURCE CAN SUPPLY
 * IT for both builds: the vanilla jar has it, and the CE pack -- which is
 * what a deploy ships, because build:deploy runs textures:ce -- has no
 * creative_inventory directory at all (it has four GUI files: widgets,
 * icons, inventory, crafting_table). A sprite that exists in development and
 * 404s in production is worse than no sprite, so the panel, the slot recesses
 * and the tabs are built from Minecraft's GUI palette in CSS instead, at the
 * same GUI-pixel scale. It looks identical in both builds, which is the
 * property that mattered.
 *
 * Those colours are Minecraft's own, not picked by eye: panel #c6c6c6, the
 * highlight #ffffff, the shadow #555555, a slot recess #8b8b8b with #373737
 * above-left and #ffffff below-right.
 * ==================================================================== */
const CREATIVE_W = 195, CREATIVE_H = 136
const LIST_COLS = 9, LIST_ROWS = 5
const LIST_ORIGIN = { x: 9, y: 18 }
const CREATIVE_BAR_Y = 112
const SCROLL = { x: 175, y: 18, w: 12, h: 112, thumb: 15 }
const DESTROY_SLOT = { x: 173, y: CREATIVE_BAR_Y }
const SEARCH_BOX = { x: 82, y: 6, w: 80, h: 9 }
const TAB_W = 26, TAB_H = 32, TAB_PITCH = 28, TAB_OVERLAP = 4

/*
 * The Survival Inventory tab's extra containers.
 *
 * Vanilla lays its 27 main slots at y = 18 and its hotbar at y = 112, which
 * is what the constants above already give, and then sits the armor and
 * offhand around a live player preview on tab_inventory.png. There is no such
 * sprite here (see the note above), and no preview to arrange them around, so
 * the four armor slots and the offhand go down the right-hand column -- the
 * strip the scrollbar occupies on every other tab and which is empty on this
 * one. Flagged rather than quietly done: it is the one place this screen's
 * layout is not vanilla's.
 */
const INV_TAB_ARMOR_X = 173
const INV_TAB_ARMOR_Y = 18

/**
 * The creative screen.
 *
 * Takes the same `makeCell`/`paintSlot` machinery the survival panel uses, as
 * arguments rather than by importing anything: one cell factory means one set
 * of click semantics for the player's own slots on both screens, which is the
 * property that stops the two drifting apart.
 */
function buildCreativeScreen(inv, { screen, panel, makeCell, paintSlot, tooltip, repaint }) {
  panel.style.width = px(CREATIVE_W)
  panel.style.height = px(CREATIVE_H)

  let tab = TABS[0]
  let scrollRow = 0
  let query = ''

  /* ---- title, which is just the tab's name ---- */
  const title = document.createElement('div')
  title.className = 'gui-label'
  title.style.left = px(8)
  title.style.top = px(6)
  title.style.fontSize = `${FONT_PX}px`
  title.style.color = LABEL_COLOR
  panel.appendChild(title)

  /* ---- the search field, shown only on the Search tab ---- */
  const search = document.createElement('input')
  search.id = 'creative-search'
  search.type = 'text'
  search.spellcheck = false
  search.style.left = px(SEARCH_BOX.x)
  search.style.top = px(SEARCH_BOX.y - 2)
  search.style.width = px(SEARCH_BOX.w)
  search.style.height = px(SEARCH_BOX.h + 3)
  search.style.fontSize = `${FONT_PX}px`
  panel.appendChild(search)

  /* ---- the 45 visible list cells ----
   * FORTY-FIVE, for 731 entries. The cells are a WINDOW onto the list, not
   * the list: `scrollRow` decides which entries they show. Building a cell
   * per entry would be 731 divs rebuilt on every tab change, and the icons
   * are three transformed faces each. */
  const listCells = []
  for (let r = 0; r < LIST_ROWS; r++) {
    for (let c = 0; c < LIST_COLS; c++) {
      const el = document.createElement('div')
      el.className = 'gui-slot drawn-slot creative-cell'
      el.style.left = px(LIST_ORIGIN.x + c * SLOT_PITCH)
      el.style.top = px(LIST_ORIGIN.y + r * SLOT_PITCH)
      el.style.width = el.style.height = px(SLOT_SIZE)
      /*
       * The NAME, and only the name. This line used to carry the block key as
       * well, because ten entries in a stair family shared one name and the
       * key was the only thing that told them apart. The family is one entry
       * now (see the note at the top of creative.js), so there is nothing left
       * to disambiguate and the tooltip is plain vanilla again.
       */
      tooltip.attach(el, () => {
        if (!el.dataset.item || inv.carried) return null
        return [itemName(Number(el.dataset.item))]
      })
      panel.appendChild(el)
      listCells.push(el)
    }
  }

  /* ---- the player's own slots, through the shared cell factory ---- */
  const hotbarCells = []
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    hotbarCells.push(makeCell(panel, 'main', i, LIST_ORIGIN.x + i * SLOT_PITCH, CREATIVE_BAR_Y))
  }
  const invTabCells = []
  for (let i = HOTBAR_SIZE; i < TOTAL_SLOTS; i++) {
    const n = i - HOTBAR_SIZE
    invTabCells.push(makeCell(panel, 'main', i,
      LIST_ORIGIN.x + (n % 9) * SLOT_PITCH, LIST_ORIGIN.y + Math.floor(n / 9) * SLOT_PITCH))
  }
  for (let i = 0; i < ARMOR_SLOTS.length; i++) {
    invTabCells.push(makeCell(panel, 'armor', i, INV_TAB_ARMOR_X, INV_TAB_ARMOR_Y + i * SLOT_PITCH))
  }
  invTabCells.push(makeCell(panel, 'offhand', 0, INV_TAB_ARMOR_X, INV_TAB_ARMOR_Y + 4 * SLOT_PITCH))
  for (const el of [...hotbarCells, ...invTabCells]) el.classList.add('drawn-slot')

  /*
   * The destroy slot. Vanilla puts it on the Survival Inventory tab only, at
   * (173, 112) -- the space to the right of the hotbar, which on every other
   * tab is the bottom of the scrollbar.
   *
   * Not a `makeCell`, because it is not a slot: nothing is ever stored in it.
   * It is a bin with a lid drawn on it, and giving it an (area, index) would
   * have meant inventing a sixth container for something that holds nothing.
   */
  const destroy = document.createElement('div')
  destroy.className = 'gui-slot drawn-slot creative-destroy'
  destroy.style.left = px(DESTROY_SLOT.x)
  destroy.style.top = px(DESTROY_SLOT.y)
  destroy.style.width = destroy.style.height = px(SLOT_SIZE)
  tooltip.attach(destroy, () => ['Destroy Item', 'shift-click to clear your inventory'])
  panel.appendChild(destroy)

  /* ---- the scrollbar ---- */
  const track = document.createElement('div')
  track.className = 'creative-track'
  track.style.left = px(SCROLL.x)
  track.style.top = px(SCROLL.y)
  track.style.width = px(SCROLL.w)
  track.style.height = px(SCROLL.h)
  const thumb = document.createElement('div')
  thumb.className = 'creative-thumb'
  thumb.style.width = px(SCROLL.w)
  thumb.style.height = px(SCROLL.thumb)
  track.appendChild(thumb)
  panel.appendChild(track)

  /* ---- the tabs ---- */
  const tabEls = new Map()
  for (const t of TABS) {
    const el = document.createElement('div')
    el.className = `gui-tab gui-tab-${t.row}`
    el.style.left = px(t.column * TAB_PITCH)
    el.style.top = px(t.row === 'top' ? -(TAB_H - TAB_OVERLAP) : CREATIVE_H - TAB_OVERLAP)
    el.style.width = px(TAB_W)
    el.style.height = px(TAB_H)
    tooltip.attach(el, () => [t.label])
    const icon = createItemIcon(itemId(t.icon), SLOT_SIZE * HUD_SCALE)
    icon.classList.add('gui-tab-icon')
    el.appendChild(icon)
    el.addEventListener('mousedown', (e) => { e.preventDefault(); selectTab(t) })
    panel.appendChild(el)
    tabEls.set(t.id, el)
  }

  /** The item ids the current tab is showing, in order. */
  const listing = () => (tab.special === 'search' ? searchItems(query)
    : tab.special ? [] : tabItems(tab.id))

  const maxScroll = () => Math.max(0, Math.ceil(listing().length / LIST_COLS) - LIST_ROWS)

  /*
   * Paint the 45 cells from the window at `scrollRow`.
   *
   * The item id is stashed on the element rather than looked up again by the
   * click handler, because "what is in this cell" is a question about the
   * scroll position at the moment you clicked, and re-deriving it from a
   * scroll that a wheel event may already have moved is how you place the
   * wrong block.
   */
  const paintList = () => {
    const ids = listing()
    const first = scrollRow * LIST_COLS
    listCells.forEach((el, i) => {
      const id = ids[first + i]
      el.dataset.item = id ?? ''
      paintSlot(el, id ? { id, count: 1 } : null)
      // A count of 1 on every entry would be 45 little white "1"s. The list
      // is an infinite source; a number on it means nothing.
      el.querySelector('.count')?.remove()
    })
    const max = maxScroll()
    thumb.style.transform = `translateY(${max ? (scrollRow / max) * (SCROLL.h - SCROLL.thumb) * HUD_SCALE : 0}px)`
    // Vanilla has a whole second sprite for this (scroller_disabled.png), so
    // a tab that fits on one page says so rather than showing a thumb that
    // will not move.
    thumb.classList.toggle('disabled', max === 0)
  }

  const selectTab = (t) => {
    tab = t
    scrollRow = 0
    title.textContent = t.label
    for (const [id, el] of tabEls) el.classList.toggle('selected', id === t.id)
    const isInventory = t.special === 'inventory'
    const isSearch = t.special === 'search'
    panel.classList.toggle('on-inventory-tab', isInventory)
    search.classList.toggle('hidden', !isSearch)
    // The edit box sits where the title does, so vanilla drops the title on
    // this one tab rather than drawing text under a text field.
    title.classList.toggle('hidden', isSearch)
    for (const el of listCells) el.classList.toggle('hidden', isInventory)
    for (const el of invTabCells) el.classList.toggle('hidden', !isInventory)
    destroy.classList.toggle('hidden', !isInventory)
    track.classList.toggle('hidden', isInventory)
    // Vanilla's Search tab takes focus the moment you open it, so you can
    // start typing without aiming at the field first.
    if (isSearch) search.focus()
    else search.blur()
    paintList()
  }

  const scrollBy = (rows) => {
    const next = Math.max(0, Math.min(maxScroll(), scrollRow + rows))
    if (next === scrollRow) return
    scrollRow = next
    paintList()
  }

  panel.addEventListener('wheel', (e) => {
    e.preventDefault()
    // One row per notch, as vanilla does. 731 entries is 82 rows, which is a
    // long way at one row a notch -- which is what Search is for, and what
    // dragging the thumb is for.
    scrollBy(Math.sign(e.deltaY))
  }, { passive: false })

  /* Dragging the thumb, and clicking the track to jump. Both resolve to the
   * same "which row is this Y" question, so both go through one function. */
  const scrollToY = (clientY) => {
    const box = track.getBoundingClientRect()
    const half = (SCROLL.thumb * HUD_SCALE) / 2
    const span = box.height - SCROLL.thumb * HUD_SCALE
    const f = span > 0 ? (clientY - box.top - half) / span : 0
    scrollRow = Math.max(0, Math.min(maxScroll(), Math.round(f * maxScroll())))
    paintList()
  }
  let dragging = false
  track.addEventListener('mousedown', (e) => { e.preventDefault(); dragging = true; scrollToY(e.clientY) })
  document.addEventListener('mousemove', (e) => { if (dragging) scrollToY(e.clientY) })
  document.addEventListener('mouseup', () => { dragging = false })

  search.addEventListener('input', () => { query = search.value; scrollRow = 0; paintList() })
  // The search field swallows keys that would otherwise reach the game -- E
  // would close the screen mid-word, and the digits are the hotbar.
  search.addEventListener('keydown', (e) => { if (e.code !== 'Escape') e.stopPropagation() })

  /* ---- clicking the list ---- */
  for (const el of listCells) {
    el.addEventListener('contextmenu', e => e.preventDefault())
    el.addEventListener('mousedown', (e) => {
      e.preventDefault()
      const id = Number(el.dataset.item)
      if (!id) return
      // Middle-click is pick-block: "middle-clicking a slot in an inventory
      // grabs a full stack of the item while leaving the item in the slot"
      // (minecraft.wiki/w/Inventory). On an infinite list, "leaving it" is
      // free.
      inv.carried = e.button === 1
        ? fullStack(id)
        : creativeListClick(inv.carried, id, {
          button: e.button === 2 ? 'right' : 'left', shift: e.shiftKey,
        })
      inv.emitChange()
    })
  }

  /*
   * Middle-click on one of the PLAYER's slots, which the shared cell factory
   * does not handle: it only knows left and right. Vanilla's pick-block works
   * on any slot in any inventory in creative and copies rather than moves, so
   * this is a capture-phase listener on the panel -- it runs before the
   * cell's own handler and stops it, rather than the cell needing to know
   * what mode the game is in.
   */
  panel.addEventListener('mousedown', (e) => {
    if (e.button !== 1) return
    const cell = e.target.closest('.gui-slot-main, .gui-slot-armor, .gui-slot-offhand')
    if (!cell) return
    e.preventDefault()
    e.stopPropagation()
    const stack = inv.stackAt({ area: cell.dataset.area, index: Number(cell.dataset.index) })
    if (stack) { inv.carried = fullStack(stack.id); inv.emitChange() }
  }, true)

  /*
   * The destroy slot. Plain click bins what you are carrying; shift-click
   * empties the lot -- "Shift + clicking on the button clears the entire
   * inventory, including the hotbar, off-hand slot, and armor slots"
   * (minecraft.wiki/w/Creative). It really is every container, which is why
   * this writes through the arrays rather than looping the 36.
   */
  destroy.addEventListener('contextmenu', e => e.preventDefault())
  destroy.addEventListener('mousedown', (e) => {
    e.preventDefault()
    if (e.shiftKey) {
      inv.slots.fill(null)
      inv.armor.fill(null)
      inv.offhand.fill(null)
    }
    inv.carried = null
    inv.emitChange()
  })

  /*
   * Number keys over the list: "Pressing a number key while hovering over an
   * item instantly places one full stack of that item into the hotbar slot
   * that corresponds with the number" (minecraft.wiki/w/Creative_inventory).
   *
   * On `document` rather than per cell, because a keydown goes to the focused
   * element and a div is never focused -- the hovered cell is found by
   * elementFromPoint at press time instead.
   */
  let pointer = { x: 0, y: 0 }
  document.addEventListener('mousemove', (e) => { pointer = { x: e.clientX, y: e.clientY } })
  document.addEventListener('keydown', (e) => {
    if (screen.classList.contains('hidden')) return
    if (document.activeElement === search) return
    const n = /^Digit([1-9])$/.exec(e.code)
    if (!n) return
    const el = document.elementFromPoint(pointer.x, pointer.y)
    if (!el?.classList.contains('creative-cell')) return
    const id = Number(el.dataset.item)
    if (!id) return
    inv.slots[Number(n[1]) - 1] = fullStack(id)
    inv.emitChange()
  })

  // No onChange here: every cell makeCell built is already in the shared
  // `cells` list that installInventoryScreen repaints, including these.
  selectTab(TABS[0])

  return {
    /*
     * Called when the screen opens. Clears the query, which vanilla does NOT
     * do -- it remembers what you typed. Reset here anyway: a stale filter is
     * invisible until you notice the list is short, and "I opened the picker
     * and half my blocks were gone" is a worse bug than "it forgot my search".
     */
    opened: () => { query = ''; search.value = ''; selectTab(tab) },
    selectTab: (id) => selectTab(TABS.find(t => t.id === id) ?? TABS[0]),
    currentTab: () => tab.id,
    scrollTo: (row) => { scrollRow = Math.max(0, Math.min(maxScroll(), row)); paintList() },
    scrollRow: () => scrollRow,
    maxScroll,
    listing,
    repaint: () => { paintList(); repaint() },
  }
}
