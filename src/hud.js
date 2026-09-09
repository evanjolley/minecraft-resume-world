import { createBlockIcon } from './blockIcon.js'
import { BLOCK_BY_ID } from './blocks.js'
import { HOTBAR_SIZE } from './inventory.js'
import { MAX_HEALTH, MAX_FOOD } from './survival.js'

/*
 * The survival HUD: hotbar, hearts, hunger, XP bar, coordinate readout.
 *
 * Health and food are in half-units (20 = 10 icons), so each icon reads two
 * points: full, half, or empty. Rendering that as `value / 2` rounded is the
 * bug that makes half-hearts vanish, so each icon is decided explicitly.
 */

function iconRow(container, count, fullSrc) {
  const icons = []
  for (let i = 0; i < count; i++) {
    const wrap = document.createElement('div')
    wrap.className = 'icon-slot'

    // Minecraft draws a dark empty socket behind every icon and layers the
    // full or half icon on top. Two stacked images, not one swapped image.
    const bg = document.createElement('img')
    bg.src = fullSrc
    bg.className = 'icon-bg'

    const fg = document.createElement('img')
    fg.src = fullSrc
    fg.className = 'icon-fg'

    wrap.append(bg, fg)
    container.appendChild(wrap)
    icons.push(fg)
  }
  return icons
}

function paintRow(icons, value) {
  icons.forEach((fg, i) => {
    const points = value - i * 2
    // full = 2 points at this icon, half = 1, empty = 0 or less
    fg.style.clipPath = points >= 2 ? 'none' : points === 1 ? 'inset(0 50% 0 0)' : 'inset(0 100% 0 0)'
    fg.style.opacity = points > 0 ? '1' : '0'
  })
}

export function installHUD(noa, { inventory, survival }) {
  /* ---- hotbar ---- */
  const bar = document.getElementById('hotbar')
  const slots = []
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    const cell = document.createElement('div')
    cell.className = 'hotbar-slot'
    bar.appendChild(cell)
    slots.push(cell)
  }

  const label = document.getElementById('held-name')
  let labelTimer = null
  let lastNamed = -1

  inventory.onChange((inv) => {
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const cell = slots[i]
      cell.classList.toggle('selected', i === inv.selected)
      cell.textContent = ''
      const stack = inv.slots[i]
      if (!stack) continue
      cell.appendChild(createBlockIcon(stack.id, 32))
      if (stack.count > 1) {
        const n = document.createElement('span')
        n.className = 'count'
        n.textContent = stack.count
        cell.appendChild(n)
      }
    }

    // Minecraft flashes the held item's name above the hotbar when you
    // switch slots, then fades it. Only on an actual change of slot,
    // otherwise every inventory mutation re-triggers it.
    if (inv.selected !== lastNamed) {
      lastNamed = inv.selected
      const stack = inv.slots[inv.selected]
      label.textContent = stack ? (BLOCK_BY_ID.get(stack.id)?.name ?? '') : ''
      label.classList.toggle('visible', !!stack)
      clearTimeout(labelTimer)
      labelTimer = setTimeout(() => label.classList.remove('visible'), 2000)
    }
  })

  /* ---- hearts and hunger ---- */
  const hearts = iconRow(document.getElementById('hearts'), MAX_HEALTH / 2, '/ui/heart.png')
  const food = iconRow(document.getElementById('hunger'), MAX_FOOD / 2, '/ui/hunger.png')

  const xpFill = document.getElementById('xp-fill')
  const xpLevel = document.getElementById('xp-level')

  survival.onChange((s) => {
    paintRow(hearts, s.health)
    paintRow(food, s.food)
    xpFill.style.width = `${s.xpProgress * 100}%`
    xpLevel.textContent = s.xpLevel > 0 ? s.xpLevel : ''
    document.getElementById('death').classList.toggle('hidden', !s.dead)
  })

  /* ---- coordinate readout ---- */
  const coords = document.getElementById('coords')
  const player = noa.playerEntity
  // Throttled to 5Hz. Writing textContent every frame forces layout work
  // sixty times a second for a number that changes meaningfully far slower.
  let last = 0
  noa.on('tick', () => {
    const now = performance.now()
    if (now - last < 200) return
    last = now
    const p = noa.ents.getPositionData(player).position
    coords.textContent = `${Math.floor(p[0])} ${Math.floor(p[1])} ${Math.floor(p[2])}`
  })
}
