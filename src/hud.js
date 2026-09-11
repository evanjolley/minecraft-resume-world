import { createItemIcon } from './blockIcon.js'
import { itemName } from './items.js'
import { HOTBAR_SIZE } from './inventory.js'
import { armorPoints } from './armor.js'
import { MAX_HEALTH, MAX_FOOD } from './survival.js'

/*
 * The survival HUD, built from Minecraft's own sprites at its own geometry.
 *
 * Every number below is in Minecraft GUI pixels, multiplied by SCALE. That is
 * the whole trick to making this look right: Minecraft's HUD is a fixed
 * pixel-art layout, so approximating it with CSS boxes always reads as
 * slightly off. Blitting the real sprites at integer scale does not.
 *
 * Reference geometry (GUI px):
 *   hotbar sprite   182 x 22, item slots 16x16 at x = 3 + i*20, y = 3
 *   selection       24 x 24, drawn at x = i*20 - 1, y = -1
 *   hearts / food    9 x 9, pitch 8 (they overlap by a pixel)
 *   armor            9 x 9, same row geometry, drawn ABOVE the hearts
 *   xp bar         182 x 5
 */
export const SCALE = 2

/** Full diamond is 20 points, the same 10-icon scale as hearts and hunger. */
export const MAX_ARMOR = 20

/*
 * Minecraft's font advances 6 GUI pixels per character. Monocraft's advance is
 * 2/3 em, so font-size = 6 * SCALE / (2/3) = 18px at SCALE 2 lands exactly on
 * that grid.
 *
 * The sprite geometry here was always GUI-exact; these text sizes were not --
 * they were eyeballed at 13px and 15px, which is why chat (built to the grid)
 * came out visibly larger than the item counts.
 */
export const FONT_PX = SCALE * 6 / (2 / 3)
const HOTBAR_W = 182, HOTBAR_H = 22
const SLOT_PITCH = 20, SLOT_INSET = 3, SLOT_SIZE = 16
const SEL_SIZE = 24

/*
 * The vertical stack, straight out of Gui.java, in GUI pixels measured UP from
 * the bottom of the screen -- which is the bottom of the hotbar, and therefore
 * the bottom edge of #hud:
 *
 *   hotbar            0..22   renderHotbar blits at y = screenHeight - 22
 *   xp bar           24..29   renderExperienceBar: screenHeight - 32 + 3
 *   hearts, hunger   30..39   renderPlayerHealth: screenHeight - 39
 *   armor            40..49   the same row geometry, one row higher
 *   held item name   50..59   renderSelectedItemName: screenHeight - 59
 *
 * Every gap is 1 GUI px except the one under the xp bar, which is 2. They were
 * 5px, 3px and 1px of eyeballed CSS margin, which is where the half-pixel rows
 * came from.
 *
 * HELD_NAME_BOTTOM is the number this table exists for. Minecraft anchors the
 * name to the BOTTOM OF THE SCREEN -- not to whatever happens to be under it
 * -- so it stays at 50 whether the armor row is drawn or not. Stacking it in
 * the flex column instead made it move, and with the armor row absent it
 * landed on the hearts. Rejected: adding a margin until they stopped touching,
 * which fixes the symptom at whatever SCALE it was eyeballed at.
 *
 * NOT reproduced: vanilla adds 14 to that y in creative (`if
 * (!gameMode.canHurtPlayer())`), where there are no hearts to clear. Which
 * gamemode is live is gamemode.js's to know and this file has no handle on it.
 */
const TEXT_LINE = 9          // Minecraft's font line height, glyph plus descender
const HELD_NAME_BOTTOM = 50
const GAP_UNDER_XP = 2       // the wide one: the level number sits in it
const GAP_UNDER_HEARTS = 1
const GAP_UNDER_ARMOR = 1

const px = (n) => `${n * SCALE}px`

function spriteEl(src, w, h) {
  const el = document.createElement('div')
  el.className = 'sprite'
  el.style.backgroundImage = `url(${src})`
  el.style.width = px(w)
  el.style.height = px(h)
  return el
}

/*
 * Health, food and armor are all in HALF units (20 = 10 icons), so each icon
 * is full, half or empty. Rendering `value / 2` rounded is the classic bug
 * that makes half-hearts disappear, so each icon is decided explicitly.
 *
 * The half case tests `points > 0`, not `points === 1`, because health is a
 * FLOAT once armor is involved -- armor.js reduces 4 damage to 3.28, not to
 * 3. An exact comparison renders that sliver of a heart as empty, which is
 * how you get a player who looks dead and isn't. Minecraft rounds the icon
 * up for exactly this reason.
 */
function iconRow(container, count, kind, rightToLeft) {
  const icons = []
  for (let i = 0; i < count; i++) {
    const wrap = document.createElement('div')
    wrap.className = 'icon-slot'
    wrap.style.width = px(9)
    wrap.style.height = px(9)
    // pitch 8 not 9: Minecraft's icons overlap by one pixel
    wrap.style.left = px(rightToLeft ? (count - 1 - i) * 8 : i * 8)

    const empty = spriteEl(`/ui/${kind}_empty.png`, 9, 9)
    const fill = spriteEl(`/ui/${kind}_full.png`, 9, 9)
    fill.classList.add('fill')
    wrap.append(empty, fill)
    container.appendChild(wrap)
    icons.push({ fill, kind })
  }
  return icons
}

function paintRow(icons, value) {
  icons.forEach(({ fill, kind }, i) => {
    const points = value - i * 2
    if (points >= 2) {
      fill.style.backgroundImage = `url(/ui/${kind}_full.png)`
      fill.style.opacity = '1'
    } else if (points > 0) {
      fill.style.backgroundImage = `url(/ui/${kind}_half.png)`
      fill.style.opacity = '1'
    } else {
      fill.style.opacity = '0'
    }
  })
}

export function installHUD(noa, { inventory, survival }) {
  const hud = document.getElementById('hud')
  hud.style.width = px(HOTBAR_W)

  /* The gaps between the rows, from the stack above. In here rather than in
     the stylesheet so the whole layout answers to one SCALE. */
  document.getElementById('xp-row').style.marginBottom = px(GAP_UNDER_XP)
  document.getElementById('status').style.marginBottom = px(GAP_UNDER_HEARTS)
  document.getElementById('armor-row').style.marginBottom = px(GAP_UNDER_ARMOR)

  /* ---- hotbar ---- */
  const bar = document.getElementById('hotbar')
  bar.style.width = px(HOTBAR_W)
  bar.style.height = px(HOTBAR_H)
  bar.style.backgroundImage = 'url(/ui/hotbar.png)'

  const selection = spriteEl('/ui/hotbar_selection.png', SEL_SIZE, SEL_SIZE)
  selection.id = 'hotbar-selection'
  bar.appendChild(selection)

  const slots = []
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    const cell = document.createElement('div')
    cell.className = 'hotbar-slot'
    cell.style.left = px(SLOT_INSET + i * SLOT_PITCH)
    cell.style.top = px(SLOT_INSET)
    cell.style.width = px(SLOT_SIZE)
    cell.style.height = px(SLOT_SIZE)
    bar.appendChild(cell)
    slots.push(cell)
  }

  const label = document.getElementById('held-name')
  // Positioned, not stacked -- see HELD_NAME_BOTTOM. The line box is pinned to
  // Minecraft's 9px font line as well, because a default line-height lets the
  // glyphs hang below the element box and reach the hearts on their own.
  label.style.bottom = px(HELD_NAME_BOTTOM)
  label.style.height = px(TEXT_LINE)
  label.style.lineHeight = px(TEXT_LINE)
  label.style.fontSize = `${FONT_PX}px`
  let labelTimer = null
  let lastNamed = -1

  inventory.onChange((inv) => {
    selection.style.left = px(inv.selected * SLOT_PITCH - 1)
    selection.style.top = px(-1)

    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const cell = slots[i]
      cell.textContent = ''
      const stack = inv.slots[i]
      if (!stack) continue
      cell.appendChild(createItemIcon(stack.id, SLOT_SIZE * SCALE))
      if (stack.count > 1) {
        const n = document.createElement('span')
        n.className = 'count'
        n.textContent = stack.count
        cell.appendChild(n)
      }
    }

    // Minecraft flashes the held item's name above the hotbar when you switch
    // slots, then fades it. Only on an actual slot change, or every inventory
    // mutation would re-trigger it.
    if (inv.selected !== lastNamed) {
      lastNamed = inv.selected
      const stack = inv.slots[inv.selected]
      label.textContent = stack ? itemName(stack.id) : ''
      label.classList.toggle('visible', !!stack)
      clearTimeout(labelTimer)
      labelTimer = setTimeout(() => label.classList.remove('visible'), 2000)
    }
  })

  /* ---- armor, hearts, food, xp ---- */
  /*
   * Minecraft hides the armor bar entirely at zero points rather than showing
   * ten empty outlines -- the row is simply absent until you put something on,
   * and the hearts move down to fill the space. Reproducing that is one
   * classList toggle and it is most of what makes the bar look native.
   */
  const armorEl = document.getElementById('armor')
  const armorRow = document.getElementById('armor-row')
  armorEl.style.height = px(9)
  armorEl.style.width = px(9 + 8 * (MAX_ARMOR / 2 - 1))
  const armorIcons = iconRow(armorEl, MAX_ARMOR / 2, 'armor', false)

  inventory.onChange((inv) => {
    const points = armorPoints(inv)
    armorRow.classList.toggle('hidden', points <= 0)
    paintRow(armorIcons, points)
  })

  const heartsEl = document.getElementById('hearts')
  const hungerEl = document.getElementById('hunger')
  heartsEl.style.height = hungerEl.style.height = px(9)
  heartsEl.style.width = hungerEl.style.width = px(9 + 8 * (MAX_HEALTH / 2 - 1))

  const hearts = iconRow(heartsEl, MAX_HEALTH / 2, 'heart', false)
  // Minecraft fills the food bar from the right edge inward.
  const food = iconRow(hungerEl, MAX_FOOD / 2, 'food', true)

  const xpBg = document.getElementById('xp-bar')
  xpBg.style.width = px(HOTBAR_W)
  xpBg.style.height = px(5)
  xpBg.style.backgroundImage = 'url(/ui/xp_bg.png)'
  const xpFill = document.getElementById('xp-fill')
  xpFill.style.height = px(5)
  xpFill.style.backgroundImage = 'url(/ui/xp_fill.png)'
  xpFill.style.backgroundSize = `${HOTBAR_W * SCALE}px ${5 * SCALE}px`
  const xpLevel = document.getElementById('xp-level')

  survival.onChange((s) => {
    paintRow(hearts, s.health)
    paintRow(food, s.food)
    xpFill.style.width = px(HOTBAR_W * s.xpProgress)
    xpLevel.textContent = s.xpLevel > 0 ? s.xpLevel : ''
    document.getElementById('death').classList.toggle('hidden', !s.dead)
  })

  /* ---- coordinate readout ---- */
  const coords = document.getElementById('coords')
  const player = noa.playerEntity
  // Throttled to 5Hz. Writing textContent every frame forces layout work
  // sixty times a second for a number that changes far slower.
  let last = 0
  noa.on('tick', () => {
    const now = performance.now()
    if (now - last < 200) return
    last = now
    const p = noa.ents.getPositionData(player).position
    coords.textContent = `${Math.floor(p[0])} ${Math.floor(p[1])} ${Math.floor(p[2])}`
  })
}
