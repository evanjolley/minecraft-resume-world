import { createBlockIcon } from './blockIcon.js'
import { BLOCK_BY_ID } from './blocks.js'
import { HOTBAR_SIZE } from './inventory.js'
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
 *   xp bar         182 x 5
 */
export const SCALE = 2

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
 * Health and food are in HALF units (20 = 10 icons), so each icon is full,
 * half or empty. Rendering `value / 2` rounded is the classic bug that makes
 * half-hearts disappear, so each icon is decided explicitly.
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
    } else if (points === 1) {
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
      cell.appendChild(createBlockIcon(stack.id, SLOT_SIZE * SCALE))
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
      label.textContent = stack ? (BLOCK_BY_ID.get(stack.id)?.name ?? '') : ''
      label.classList.toggle('visible', !!stack)
      clearTimeout(labelTimer)
      labelTimer = setTimeout(() => label.classList.remove('visible'), 2000)
    }
  })

  /* ---- hearts, food, xp ---- */
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
