import { MAX_NAME_LENGTH } from './nickname.js'
import { clearLocal } from './persistence.js'

/*
 * THE PROFILE SCREEN: your name, and signing in.
 *
 * Reached from the pause menu, never put in front of the world. A visitor
 * plays the instant the page loads, as Guest; picking a name and signing in
 * are both things you can do later, or never. Three ways to get a name, all
 * ending in the same roster.setName:
 *
 *   - tell AI Evan (his set_player_name tool)
 *   - /nick <name>
 *   - this screen
 *
 * Signing in is a passkey (docs/decisions.md says why not email or Google).
 * The buttons only appear when the Worker says login is enabled and the
 * browser can make a passkey, so a deploy without secrets shows no dead
 * button.
 *
 * Drawn INSIDE #pause, the way the Controls sheet sits over the menu: when
 * the menu closes this goes with it, and the menu's input lock already
 * covers it, so there is no second lock to keep straight.
 */

export function installProfile({ roster, localId, account, persist, chat, menuButtons }) {
  const pause = document.getElementById('pause')

  const panel = document.createElement('div')
  panel.id = 'profile'
  panel.className = 'hidden'
  panel.innerHTML = `
    <h1>Profile</h1>
    <label class="profile-label" for="profile-name">Name</label>
    <div class="profile-row">
      <input id="profile-name" maxlength="${MAX_NAME_LENGTH}" autocomplete="nickname" spellcheck="false">
      <button id="profile-save" class="mc-button">Save</button>
    </div>
    <p id="profile-error" class="profile-error" role="alert"></p>
    <p id="profile-status" class="profile-status"></p>
    <div class="button-row" id="profile-auth"></div>
    <button id="profile-done" class="mc-button">Done</button>`
  pause.appendChild(panel)

  const style = document.createElement('style')
  style.textContent = `
    #profile { position: absolute; inset: 0; z-index: 25; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 10px; background: rgba(0,0,0,0.82); }
    #profile.hidden { display: none; }
    #pause.profile-open > h1, #pause.profile-open > #pause-buttons { visibility: hidden; }
    #profile h1 { margin: 0 0 8px; font-size: 20px; font-weight: 400; color: #fff;
      text-shadow: 2px 2px 0 #3f3f3f; }
    #profile .profile-label { width: 400px; color: #a0a0a0; font-size: 13px; }
    #profile .profile-row { display: flex; gap: 8px; width: 400px; }
    #profile input { flex: 1; font: inherit; font-size: 15px; color: #e0e0e0; background: #000;
      border: 2px solid #a0a0a0; padding: 8px; outline: none; }
    #profile input:focus { border-color: #fff; }
    #profile .profile-row .mc-button { width: 110px; }
    #profile .profile-error { min-height: 16px; margin: 0; color: #ff5555; font-size: 13px;
      text-shadow: 1px 1px 0 #3f1515; width: 400px; }
    #profile .profile-status { margin: 0; color: #d8d8d8; font-size: 13px; width: 400px;
      text-shadow: 2px 2px 0 #3f3f3f; line-height: 1.4; }
    #profile #profile-auth { width: 400px; }
    #profile #profile-auth:empty { display: none; }
    #profile #profile-done { width: 200px; margin-top: 8px; }`
  document.head.appendChild(style)

  const $ = (id) => document.getElementById(id)
  const input = $('profile-name')
  const error = $('profile-error')
  const status = $('profile-status')
  const auth = $('profile-auth')

  const say = (text) => chat?.addMessage({ text, kind: 'system' })

  /**
   * Rename, with the server's say for an account. The local roster moves
   * first so the nametag updates on the spot; a server refusal moves it back.
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async function rename(name) {
    const before = roster.displayNameOf(localId)
    const res = await account.saveNickname(name)
    if (!res.ok) return res
    if (res.name !== before) roster.setName(localId, res.name)
    return { ok: true, name: res.name }
  }

  /*
   * A name set anywhere else (AI Evan's tool) also reaches an account's
   * stored profile. Guarded so the echo of our own rename does not loop.
   */
  let syncing = false
  roster.onChange((entry) => {
    if (!entry.local || entry.removed || syncing) return
    if (!account.state.account || account.state.nickname === entry.name) return
    syncing = true
    account.saveNickname(entry.name).finally(() => { syncing = false })
  })

  /* An account's stored name wins over whatever this browser remembered. */
  account.onChange((st) => {
    if (st.account && st.nickname && st.nickname !== roster.displayNameOf(localId)) {
      roster.setName(localId, st.nickname)
    }
    render()
  })

  function busy(on) {
    for (const b of panel.querySelectorAll('button')) b.disabled = on
  }

  function button(label, fn) {
    const b = document.createElement('button')
    b.className = 'mc-button'
    b.textContent = label
    b.addEventListener('click', fn)
    return b
  }

  function render() {
    const st = account.state
    status.textContent = st.account
      ? 'Signed in. Your world and your conversations with Evan follow you to any device you sign in on.'
      : 'Playing as a guest. Your world is saved in this browser.'
        + (st.login ? ' Sign in to keep it on every device.' : '')
    auth.replaceChildren()
    if (!st.login || !account.passkeysSupported()) return
    if (st.account) {
      auth.append(button('Sign Out', signOut))
    } else {
      auth.append(button('Create Passkey', register), button('Sign In', signIn))
    }
  }

  async function register() {
    busy(true); error.textContent = ''
    const res = await account.register(roster.displayNameOf(localId))
    busy(false)
    if (!res.ok) { error.textContent = res.error; return }
    await persist?.sync()
    say('Signed in. Your world now follows you.')
    render()
  }

  async function signIn() {
    busy(true); error.textContent = ''
    const res = await account.login()
    if (!res.ok) { busy(false); error.textContent = res.error; return }
    if (res.switched) {
      // This browser was showing someone else's (a guest's) world. Load theirs.
      persist?.pause()
      await clearLocal()
      location.reload()
      return
    }
    busy(false)
    await persist?.sync()
    say('Signed in.')
    render()
  }

  async function signOut() {
    busy(true)
    await persist?.sync()
    persist?.pause()
    await clearLocal()
    roster.forget()
    await account.logout()
    location.reload()
  }

  async function save() {
    error.textContent = ''
    const res = await rename(input.value)
    if (!res.ok) { error.textContent = res.error; return }
    input.value = res.name
    error.textContent = ''
    menuButton.textContent = label()
  }

  $('profile-save').addEventListener('click', save)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); save() }
    e.stopPropagation()
  })
  $('profile-done').addEventListener('click', () => close())

  const open = () => {
    input.value = roster.displayNameOf(localId)
    error.textContent = ''
    render()
    panel.classList.remove('hidden')
    pause.classList.add('profile-open')
    input.focus()
    input.select()
  }
  const close = () => {
    panel.classList.add('hidden')
    pause.classList.remove('profile-open')
    menuButton.textContent = label()
  }

  /* The pause-menu entry, a full-width row above Save and Quit. */
  const label = () => `Profile: ${roster.displayNameOf(localId)}`
  const menuButton = button(label(), open)
  menuButton.id = 'profile-open'
  const row = document.createElement('div')
  row.className = 'button-row'
  row.appendChild(menuButton)
  menuButtons.insertBefore(row, menuButtons.lastElementChild)
  roster.onChange((entry) => { if (entry.local) menuButton.textContent = label() })

  /* /nick, open to everyone: it only ever renames you. */
  chat?.command('nick', 'Changes your name: /nick <name>', async ([name]) => {
    if (!name) return chat.parseError('/nick')
    const res = await rename(name)
    if (!res.ok) chat.addMessage({ text: res.error, kind: 'error' })
    else say(`You are now ${res.name}`)
  })

  /* The menu closing (Back to Game, Escape) closes this too, so the next
   * Escape opens the menu and not a profile panel left up from last time. */
  new MutationObserver(() => {
    if (pause.classList.contains('hidden') && !panel.classList.contains('hidden')) close()
  }).observe(pause, { attributes: true, attributeFilter: ['class'] })

  render()
  return { open, close, rename, get isOpen() { return !panel.classList.contains('hidden') } }
}
