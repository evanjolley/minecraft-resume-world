/*
 * The Escape menu, and the Controls screen behind it.
 *
 * Laid out to match Minecraft's pause menu: a title, one full-width button,
 * paired rows, then a full-width quit at the bottom.
 *
 * The world keeps running underneath. Minecraft only pauses in singleplayer;
 * on a server the sky keeps moving and other players keep walking around
 * while your menu is open, which is the behaviour that matters here.
 */

const LINKS = [
  { label: 'My Resume', href: '/EvanJolley_Resume.pdf' },
  { label: 'Controls', action: 'controls' },
  { label: 'Previous Company', href: 'https://nologo.com' },
  { label: 'Current Company', href: 'https://patronus.ai' },
  { label: 'Bilibili Channel', href: 'https://space.bilibili.com/3546866255923376' },
  { label: 'Source Code', href: 'https://github.com/evanjolley/minecraft-resume-world' },
]

const CONTROLS = [
  ['W A S D', 'Move'],
  ['Space', 'Jump'],
  ['Ctrl, or double-tap W', 'Sprint'],
  ['Shift', 'Sneak (and stops you walking off edges)'],
  ['Left click (hold)', 'Mine a block'],
  ['Right click', 'Place a block'],
  ['1 - 9, or scroll', 'Change hotbar slot'],
  ['E', 'Inventory'],
  ['F5', 'Change camera view'],
  ['Esc', 'This menu'],
]

/*
 * Re-acquiring pointer lock after the menu closes.
 *
 * Browsers impose a cooldown (~1.25s in Chrome) after the USER presses Escape
 * to exit pointer lock: requestPointerLock is silently rejected during it.
 * That is the bug where closing the menu left a live OS cursor over a
 * menu-less world until you clicked again.
 *
 * So: ask immediately, then keep asking until it takes. main.js also re-locks
 * on any click as a backstop, since a click always carries fresh user
 * activation.
 */
export function requestLockPersistently(noa) {
  noa.container.setPointerLock(true)
  let tries = 0
  const timer = setInterval(() => {
    if (noa.container.hasPointerLock || ++tries > 14) return clearInterval(timer)
    noa.container.setPointerLock(true)
  }, 150)
}

export function installMenu(noa, { inputLock, inventory, survival }) {
  const screen = document.getElementById('pause')
  const controls = document.getElementById('controls')
  const buttonRows = document.getElementById('pause-buttons')

  const mkButton = (label, onClick, { wide = false, href = null } = {}) => {
    // Anchors for real links so middle-click and copy-link-address behave
    // normally; buttons for everything else.
    const el = document.createElement(href ? 'a' : 'button')
    el.className = 'mc-button' + (wide ? ' wide' : '')
    el.textContent = label
    if (href) {
      el.href = href
      el.target = '_blank'
      // noopener is not optional on target=_blank: without it the opened page
      // gets a handle on this window via window.opener.
      el.rel = 'noopener noreferrer'
    }
    if (onClick) el.addEventListener('click', onClick)
    return el
  }

  const setOpen = (open) => {
    screen.classList.toggle('hidden', !open)
    document.body.classList.toggle('menu-open', open)
    if (open) {
      inputLock.lock('menu')
      noa.container.setPointerLock(false)
    } else {
      controls.classList.add('hidden')
      inputLock.unlock('menu')
    }
  }

  /* ---- build the button layout ---- */
  const backRow = document.createElement('div')
  backRow.className = 'button-row'
  backRow.appendChild(mkButton('Back to Game', () => {
    setOpen(false)
    requestLockPersistently(noa)
  }, { wide: true }))
  buttonRows.appendChild(backRow)

  for (let i = 0; i < LINKS.length; i += 2) {
    const row = document.createElement('div')
    row.className = 'button-row'
    for (const item of LINKS.slice(i, i + 2)) {
      row.appendChild(
        item.action === 'controls'
          ? mkButton(item.label, () => controls.classList.toggle('hidden'))
          : mkButton(item.label, null, { href: item.href }),
      )
    }
    buttonRows.appendChild(row)
  }

  const quitRow = document.createElement('div')
  quitRow.className = 'button-row'
  quitRow.appendChild(mkButton('Save and Quit to Title', () => {
    // window.close() only works on windows a script opened, so a normal tab
    // ignores it silently. With no title screen to return to, the honest
    // equivalent is to close the menu and hand the cursor back, leaving the
    // world running behind an un-captured mouse.
    setOpen(false)
    window.close()
  }, { wide: true }))
  buttonRows.appendChild(quitRow)

  /* ---- controls screen ---- */
  const list = document.getElementById('controls-list')
  for (const [key, what] of CONTROLS) {
    const k = document.createElement('dt')
    k.textContent = key
    const v = document.createElement('dd')
    v.textContent = what
    list.append(k, v)
  }
  document.getElementById('controls-close')
    .addEventListener('click', () => controls.classList.add('hidden'))

  /*
   * Escape. The browser exits pointer lock on Escape by itself and does not
   * deliver the keydown to the page, so this menu cannot be opened by
   * listening for the key -- it hangs off the resulting lostPointerLock
   * instead. Closing it, when the cursor is already free, does use keydown.
   */
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape') return
    if (inventory.open) return   // inventory.js handles its own close
    if (survival.dead) return
    if (!screen.classList.contains('hidden')) {
      setOpen(false)
      requestLockPersistently(noa)
    }
  })

  return { open: () => setOpen(true), close: () => setOpen(false),
           get isOpen() { return !screen.classList.contains('hidden') } }
}
