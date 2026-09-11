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

/*
 * The button rows, written out rather than derived by pairing a flat list two
 * at a time. Adding Credits made the count odd, and a pairing loop would have
 * dropped whichever entry fell last onto a row of its own, full width, looking
 * like an accident. Spelled out, the row that stands alone is the resume --
 * which is the point of the whole site, and the one that has earned it.
 */
const ROWS = [
  [{ label: 'My Resume', href: '/EvanJolley_Resume.pdf' }],
  [{ label: 'Controls', sheet: 'controls' }, { label: 'Credits', sheet: 'credits' }],
  [{ label: 'Previous Company', href: 'https://nologo.com' },
   { label: 'Current Company', href: 'https://patronus.ai' }],
  [{ label: 'Bilibili Channel', href: 'https://space.bilibili.com/3546866255923376' },
   { label: 'Source Code', href: 'https://github.com/evanjolley/minecraft-resume-world' }],
]

const REPO = 'https://github.com/evanjolley/minecraft-resume-world'

/*
 * Attribution.
 *
 * This used to be 9px grey type pinned to the bottom-right of the HUD, and it
 * is gone from there -- but it could not simply be deleted. Pixel Perfection
 * CE is CC BY-SA 4.0 and the sound set is a mix of CC0, CC BY and CC BY-SA;
 * every one of those licences except CC0 requires credit wherever the work is
 * distributed, and this page IS the distribution. Dropping the line would have
 * put the project out of compliance, not tidied it.
 *
 * The pause menu is where it went, because CC's own terms say the conditions
 * may be satisfied "in any reasonable manner based on the medium, means, and
 * context", explicitly including a link to a resource that carries the
 * details. A Credits entry one click from Escape, naming every author and
 * linking the full NOTICE, is that for a game. Rejected: a line in the README,
 * which is not what a visitor is handed -- the page is.
 *
 * Each row is [term, ...parts]; a part is a string or a link.
 */
const link = (label, href) => ({ label, href })

const CREDITS = [
  ['Textures',
   'Pixel Perfection CE by Hugh "XSSheep" Rutland, ',
   link('CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/'),
   '. The grass side texture here is a derivative of it, under the same licence.'],
  ['Sounds',
   "VoxeLibre's mcl_sounds plus four sounds from OpenGameArt, CC0, CC BY and CC BY-SA. Every file, author, licence and source URL is listed in ",
   link('sounds/NOTICE.txt', '/sounds/NOTICE.txt'), '.'],
  ['Type',
   'Monocraft by Idrees Hassan, ', link('SIL OFL 1.1', '/fonts/OFL.txt'), '.'],
  ['Engine',
   link('noa-engine', 'https://github.com/fenomas/noa'), ' by Andy Hall, MIT, on ',
   link('Babylon.js', 'https://www.babylonjs.com/'), ', Apache 2.0.'],
]

/*
 * The texture notice links into the repository rather than to
 * /textures/NOTICE.txt, which is the obvious sibling of the sounds link and
 * does not exist: scripts/build-textures.mjs, unlike build-sounds.mjs, never
 * copies its NOTICE into public/. A link that 404s is worse than a longer one
 * that resolves. Fixing the build script would be the better answer and is not
 * this change's to make.
 */
const CREDITS_NOTE = [
  'The texture pack\u2019s full notice, including every file derived from it, is in the repository at ',
  link('textures-src/ce/NOTICE.txt', `${REPO}/blob/main/textures-src/ce/NOTICE.txt`),
  '.',
]

/** One credits fragment: a plain string, or a link that opens in a new tab. */
function creditNode(part) {
  if (typeof part === 'string') return document.createTextNode(part)
  const a = document.createElement('a')
  a.textContent = part.label
  a.href = part.href
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  return a
}

const CONTROLS = [
  ['W A S D', 'Move'],
  ['Space', 'Jump'],
  ['Ctrl, or double-tap W', 'Sprint'],
  ['Shift', 'Sneak (and stops you walking off edges)'],
  ['Left click (hold)', 'Mine a block'],
  ['Right click', 'Place a block'],
  ['1 - 9, or scroll', 'Change hotbar slot'],
  ['Q', 'Drop the held item (ctrl+Q for the whole stack)'],
  ['E', 'Inventory'],
  ['T', 'Chat'],
  ['/', 'Chat, with a command started'],
  ['F5', 'Camera: first person, behind, then facing you'],
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

export function installMenu(noa, { inputLock, inventory, inventoryScreen, survival }) {
  const screen = document.getElementById('pause')
  const buttonRows = document.getElementById('pause-buttons')

  /*
   * Controls and Credits are the same kind of thing: a full-screen sheet laid
   * over the pause menu. Neither can be opened from under the other -- each
   * one covers the buttons -- but routing both through one function is what
   * lets closing the menu clear whichever happens to be up, without setOpen
   * having to name them.
   */
  const sheets = {
    controls: document.getElementById('controls'),
    credits: document.getElementById('credits'),
  }
  const openSheet = (which) => {
    // Re-pressing the button that opened a sheet closes it, which is how the
    // Controls button behaved before there was a second sheet to coordinate.
    const already = which && !sheets[which].classList.contains('hidden')
    for (const el of Object.values(sheets)) el.classList.add('hidden')
    if (which && !already) sheets[which].classList.remove('hidden')
  }

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
    // Only one screen at a time. Escape normally closes the inventory before
    // ever reaching here, but nothing else guarantees it.
    if (open && inventory.open) inventoryScreen.setOpen(false)
    screen.classList.toggle('hidden', !open)
    document.body.classList.toggle('menu-open', open)
    if (open) {
      inputLock.lock('menu')
      noa.container.setPointerLock(false)
    } else {
      openSheet(null)
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

  for (const items of ROWS) {
    const row = document.createElement('div')
    row.className = 'button-row'
    for (const item of items) {
      row.appendChild(
        item.sheet
          ? mkButton(item.label, () => openSheet(item.sheet))
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

  /* ---- the two sheets ---- */
  const list = document.getElementById('controls-list')
  for (const [key, what] of CONTROLS) {
    const k = document.createElement('dt')
    k.textContent = key
    const v = document.createElement('dd')
    v.textContent = what
    list.append(k, v)
  }

  const creditsList = document.getElementById('credits-list')
  for (const [term, ...parts] of CREDITS) {
    const k = document.createElement('dt')
    k.textContent = term
    const v = document.createElement('dd')
    v.append(...parts.map(creditNode))
    creditsList.append(k, v)
  }
  document.getElementById('credits-note').append(...CREDITS_NOTE.map(creditNode))

  for (const id of ['controls-close', 'credits-close']) {
    document.getElementById(id).addEventListener('click', () => openSheet(null))
  }

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
