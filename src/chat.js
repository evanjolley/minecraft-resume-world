import { SCALE } from './hud.js'

/*
 * Minecraft's chat: the message log that floats above the hotbar and fades on
 * its own, plus the input line you get from T or /.
 *
 * Every number here is a real one out of Java Edition's ChatComponent and
 * ChatScreen, in GUI pixels, multiplied by hud.js's SCALE -- same convention
 * as the rest of the HUD. Approximating chat by eye is exactly the sort of
 * thing that reads as "Minecraft-ish" instead of Minecraft.
 *
 * The world does NOT pause while chat is open. Only your input is detached,
 * via inputLock -- see inputLock.js for why that distinction matters.
 *
 * There is no multiplayer yet, so `send` defaults to a loopback that echoes
 * your own message back at you. That is the seam for the Durable Object
 * transport in docs/FUTURE.md: swap `send` for a socket write, and have the
 * socket's onmessage call `addMessage()`. Nothing in the UI writes to the log
 * directly, so nothing else has to change.
 */

/* ---- geometry, in Minecraft GUI pixels ---- */
const WIDTH = 320             // default "Chat Width" setting
const LINE = 9                // one line of Minecraft's font
const PAD_L = 4, PAD_R = 8    // ChatComponent fills -4 .. width+8 around the text
const LINES_UNFOCUSED = 10    // default "Chat Line Count"
const LINES_FOCUSED = 20
const BAR_H = 12              // ChatScreen's EditBox height
const BAR_INSET = 2           // it fills 2 .. width-2, 2 above the screen bottom
const BAR_TEXT_INSET = 4      // the EditBox itself sits at x = 4, borderless
const FONT_PX = 18            // Monocraft's advance is 2/3 em, so 18px = 6 GUI px

/*
 * Minecraft parks the chat log 40 GUI px above the bottom of the screen,
 * which lands it one pixel clear of the hearts. This HUD is four pixels
 * taller than Minecraft's (index.html gives #hud a bottom margin, and the XP
 * row leaves room for the level number), so the log is lifted to match.
 */
const BOTTOM = 44

/* ---- behaviour ---- */
const MAX_LENGTH = 256        // Minecraft's cap since 1.11; it was 100 before
const SCROLLBACK = 100        // ChatComponent trims allMessages to 100
const FADE_TICKS = 200        // 10 seconds at 20 tps, of which the last 1s fades
const TICK_MS = 50            // Minecraft's tick, not noa's
const BLINK_MS = 300          // EditBox blinks on `frame / 6 % 2`, i.e. 6 ticks

/*
 * Chat colours are Minecraft's formatting codes. Join and leave notices are
 * yellow (§e) in vanilla; command errors are red (§c).
 */
const COLORS = {
  chat: 0xffffff,
  system: 0xffffff,
  join: 0xffff55,   // §e
  error: 0xff5555,  // §c
}

/*
 * Minecraft's drop shadow is not a fixed grey -- it is the text colour with
 * every channel multiplied by 0.25, offset one font pixel down and right.
 * White gives the #3f3f3f the rest of this HUD hardcodes; yellow gives
 * #3f3f15, which is why Minecraft's shadows look tinted rather than muddy.
 */
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`
const shadowOf = (n) =>
  hex(((n >> 2) & 0x3f0000) | ((n >> 2) & 0x3f00) | ((n >> 2) & 0x3f))

/*
 * ChatComponent.getTimeFactor. Fully opaque for 180 ticks, then a squared
 * ramp to nothing over the last 20. Squared, not linear: the message holds
 * its brightness and then drops away, which is what makes chat readable right
 * up to the moment it vanishes.
 */
function timeFactor(ticks) {
  const d = Math.min(1, Math.max(0, (1 - ticks / FADE_TICKS) * 10))
  return d * d
}

/*
 * ChatScreen.normalizeChatMessage: trim, then collapse runs of whitespace.
 * Sending is refused outright when nothing is left, but the screen still
 * closes -- pressing Enter on an empty box is how you dismiss chat.
 */
const normalize = (s) => s.trim().replace(/\s+/g, ' ')

export function installChat(noa, {
  inputLock,
  inventory,
  menu,
  survival,
  requestPointerLock,
  name = 'Player',
  send = null,
} = {}) {
  const px = (n) => `${n * SCALE}px`

  const root = document.getElementById('chat')
  const lines = document.getElementById('chat-lines')
  const bar = document.getElementById('chat-bar')
  const input = document.getElementById('chat-input')
  const caret = document.getElementById('chat-caret')

  /* ---- static layout ---- */
  root.style.bottom = px(BOTTOM)
  root.style.width = px(PAD_L + WIDTH + PAD_R)
  root.style.maxHeight = px(LINES_UNFOCUSED * LINE)

  bar.style.height = px(BAR_H)
  bar.style.bottom = px(BAR_INSET)
  bar.style.left = bar.style.right = px(BAR_INSET)
  input.style.fontSize = caret.style.fontSize = px(FONT_PX / SCALE)
  input.style.lineHeight = caret.style.lineHeight = px(BAR_H)
  // The EditBox is at screen x = 4 while its background starts at x = 2.
  input.style.paddingLeft = px(BAR_TEXT_INSET - BAR_INSET)
  input.maxLength = MAX_LENGTH
  // EditBox draws the mid-string cursor as fill(x, y-1, x+1, y+10): one GUI
  // pixel wide, eleven tall, starting one pixel above the glyph box.
  caret.style.setProperty('--caret-w', px(1))
  caret.style.setProperty('--caret-h', px(11))
  caret.style.setProperty('--caret-top', px((BAR_H - 8) / 2 - 1))

  let open = false
  const log = []       // { el, addedAt, alpha }
  const history = []   // messages you have sent, oldest first
  let historyPos = -1  // -1 = not browsing
  let draft = ''       // what you were typing before you started browsing

  /* ------------------------------------------------------------------ *
   * The log
   * ------------------------------------------------------------------ */

  /**
   * The one way anything gets into chat. A network transport calls this with
   * whatever the server sent; `send` below calls it for local echo.
   * @param {{ text: string, kind?: 'chat'|'system'|'join'|'error' }} msg
   */
  const addMessage = ({ text, kind = 'chat' }) => {
    const color = COLORS[kind] ?? COLORS.chat
    const el = document.createElement('div')
    el.className = 'chat-line'
    el.dataset.kind = kind
    el.textContent = String(text).slice(0, MAX_LENGTH)
    el.style.color = hex(color)
    el.style.textShadow = `${SCALE}px ${SCALE}px 0 ${shadowOf(color)}`
    el.style.lineHeight = px(LINE)
    el.style.fontSize = px(FONT_PX / SCALE)
    el.style.paddingLeft = px(PAD_L)
    el.style.paddingRight = px(PAD_R)
    lines.appendChild(el)

    const entry = { el, addedAt: performance.now(), alpha: -1 }
    log.push(entry)
    // Trimming the DOM as well as the array: 100 lines is Minecraft's cap and
    // also roughly where keeping dead nodes around stops being free.
    while (log.length > SCROLLBACK) log.shift().el.remove()
    paint()
    return entry
  }

  /*
   * Per-frame alpha. Both the text and its background get multiplied by the
   * fade factor, which is why an old message's dark box fades out with it
   * rather than leaving a row of empty rectangles behind.
   *
   * Rejected: a CSS transition per line. It cannot express Minecraft's
   * hold-then-square-ramp curve, and it drifts from the game clock.
   */
  const paint = () => {
    const now = performance.now()
    for (const entry of log) {
      const a = open ? 1 : timeFactor((now - entry.addedAt) / TICK_MS)
      // Writing style.opacity every tick for every line forces style
      // recalculation on lines that are sitting at a flat 0 or 1.
      if (Math.abs(a - entry.alpha) < 0.004) continue
      entry.alpha = a
      entry.el.style.opacity = a
    }
  }


  /* ------------------------------------------------------------------ *
   * Commands
   * ------------------------------------------------------------------ */

  const commands = new Map()

  /**
   * Register a command. Deliberately a one-liner:
   *   chat.command('time', 'Sets the time of day', (args) => ...)
   * @param {(args: string[], chat: object) => void} run
   */
  const command = (cmdName, description, run) => {
    commands.set(cmdName, { name: cmdName, description, run })
  }

  command('help', 'Shows a list of commands', () => {
    for (const cmd of [...commands.values()].sort((a, b) => a.name < b.name ? -1 : 1)) {
      addMessage({ text: `/${cmd.name} - ${cmd.description}`, kind: 'system' })
    }
  })

  const runCommand = (raw) => {
    const [cmdName, ...args] = raw.slice(1).split(' ').filter(Boolean)
    const cmd = commands.get(cmdName)
    if (!cmd) {
      // Vanilla's exact two-line rejection, including the caret line that
      // points at where the parser gave up.
      addMessage({ text: 'Unknown or incomplete command, see below for error', kind: 'error' })
      addMessage({ text: `${raw}<--[HERE]`, kind: 'error' })
      return
    }
    cmd.run(args, api)
  }

  /* ------------------------------------------------------------------ *
   * Sending
   * ------------------------------------------------------------------ */

  // The default transport. Local only, so your message comes straight back to
  // you; a socket write goes here instead once there is one.
  const transport = send ?? ((text) => addMessage({ text: `<${name}> ${text}`, kind: 'chat' }))

  const submit = () => {
    const text = normalize(input.value)
    setOpen(false)
    if (!text) return

    // Commands go in the recall history too, which is how Minecraft behaves
    // and is most of what makes repeating a long /tp bearable. Vanilla's
    // recentChat has no size cap and skips only an immediate repeat, so
    // hammering Enter on the same message does not fill the history with it.
    if (history[history.length - 1] !== text) history.push(text)

    if (text.startsWith('/')) runCommand(text)
    else transport(text)
  }

  /* ------------------------------------------------------------------ *
   * Open / close
   * ------------------------------------------------------------------ */

  const setOpen = (next, prefill = '') => {
    if (next === open) return
    // `open` is set BEFORE pointer lock is touched, because releasing the
    // lock fires lostPointerLock and main.js reads this flag to decide
    // whether that event should open the pause menu. Same ordering trap as
    // inventory.js.
    open = next
    bar.classList.toggle('hidden', !open)
    root.style.maxHeight = px((open ? LINES_FOCUSED : LINES_UNFOCUSED) * LINE)
    root.classList.toggle('focused', open)

    if (open) {
      inputLock.lock('chat')
      input.value = prefill
      historyPos = -1
      draft = ''
      // Pointer lock and a text field are mutually exclusive: you cannot see
      // what you are typing with the cursor captured.
      noa.container.setPointerLock(false)
      input.focus()
      // Chrome puts the caret at index 0 on focus() for a programmatically
      // filled field, which lands you *before* the slash after pressing /.
      input.setSelectionRange(input.value.length, input.value.length)
    } else {
      input.blur()
      input.value = ''
      inputLock.unlock('chat')
      document.getElementById('game').focus()
      if (!menu?.isOpen && !inventory?.open && !survival?.dead) requestPointerLock?.()
    }
    paint()
  }

  /* ------------------------------------------------------------------ *
   * Keys
   * ------------------------------------------------------------------ */

  /*
   * This runs in the CAPTURE phase on document, which is the whole trick.
   *
   * noa's key handling (game-inputs) listens on `window` in the bubble phase,
   * and interact.js / perspective.js / menu.js all listen on `document`, also
   * bubbling. A capture-phase listener on document sees the event before any
   * of them, so one stopPropagation here is enough to keep W from walking,
   * E from placing a block, the number row from switching hotbar slots and
   * Escape from opening the pause menu -- while still letting the character
   * reach the input, because stopPropagation does not cancel default actions.
   *
   * Rejected: noa.inputs.disabled. It suppresses the binding *events* but
   * still tracks key state, so noa would think W was held, and it does
   * nothing at all about the plain document listeners in the other modules.
   */
  document.addEventListener('keydown', (e) => {
    if (!open) {
      // Never steal the browser's own chords: Ctrl+T is a new tab.
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (inventory?.open || menu?.isOpen || survival?.dead) return
      // Matching on e.key, not e.code: "/" is Shift+7 on a German layout and
      // the key is what Minecraft binds.
      if (e.key === 't' || e.key === 'T') { e.preventDefault(); setOpen(true, '') }
      else if (e.key === '/') { e.preventDefault(); setOpen(true, '/') }
      return
    }

    // Everything below is chat's, whether or not it is a key chat uses.
    e.stopPropagation()

    if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
    else if (e.key === 'Enter') { e.preventDefault(); submit() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); recall(-1) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); recall(1) }
  }, true)

  /*
   * keyup is deliberately NOT stopped.
   *
   * Hold W, press T: noa already saw the keydown and has `forward` latched
   * on. If the keyup were swallowed too, that latch would survive until the
   * next press, and closing chat would hand you a player already running.
   * Letting keyup through clears it. A keyup for a key noa never saw pressed
   * is a no-op inside game-inputs, so nothing leaks the other way.
   */

  /*
   * Up and Down walk the sent-message history. Minecraft stashes whatever you
   * had half-typed on the way up and gives it back when you come back past
   * the newest entry, which is the difference between the history being
   * useful and it eating your sentence.
   */
  const recall = (dir) => {
    if (!history.length) return
    if (historyPos === -1) {
      if (dir > 0) return   // already at the draft; nothing newer to go to
      draft = input.value
      historyPos = history.length
    }
    historyPos = Math.min(history.length, Math.max(0, historyPos + dir))
    input.value = historyPos === history.length ? draft : history[historyPos]
    if (historyPos === history.length) historyPos = -1
    input.setSelectionRange(input.value.length, input.value.length)
  }

  /* ------------------------------------------------------------------ *
   * The caret
   * ------------------------------------------------------------------ */

  /*
   * Minecraft draws its own caret, and it changes shape: an underscore when
   * you are at the end of the line, a thin vertical bar when you are inside
   * it. The browser's native caret is hidden (caret-color: transparent) and
   * this is drawn instead.
   *
   * Positioning by character index only works because Monocraft is
   * monospaced, which is also why FONT_PX above lands on a whole number of
   * GUI pixels. Measuring text would be the general answer and is not needed.
   */
  const ADVANCE = FONT_PX * (2 / 3)

  const paintCaret = () => {
    if (!open) return
    const i = input.selectionStart ?? input.value.length
    // Vanilla shows the underscore only when there is still room to type;
    // a full 256-character line gets the mid-string bar instead.
    const atEnd = i >= input.value.length && input.value.length < MAX_LENGTH
    caret.textContent = atEnd ? '_' : ''
    caret.classList.toggle('bar', !atEnd)
    // Relative to #chat-bar, which already starts at BAR_INSET, so only the
    // difference counts -- the same offset the input's padding uses.
    caret.style.left = `${(BAR_TEXT_INSET - BAR_INSET) * SCALE + i * ADVANCE - input.scrollLeft}px`
    // 6 ticks on, 6 ticks off, against Minecraft's 20 tps clock.
    caret.style.visibility =
      Math.floor(performance.now() / BLINK_MS) % 2 === 0 ? 'visible' : 'hidden'
  }

  /*
   * One tick listener for both, not two: noa's emitter warns past ten
   * listeners and this HUD is already close to it. Driven off the tick rather
   * than rAF so the fade stops with the rest of the world when the tab is
   * backgrounded.
   */
  noa.on('tick', () => { paint(); paintCaret() })

  /* ------------------------------------------------------------------ *
   * API
   * ------------------------------------------------------------------ */

  const api = {
    addMessage,
    command,
    open: (prefill = '') => setOpen(true, prefill),
    close: () => setOpen(false),
    get isOpen() { return open },
    // multiplayer.player.joined / .left, both yellow in vanilla.
    announceJoin: (who) => addMessage({ text: `${who} joined the game`, kind: 'join' }),
    announceLeave: (who) => addMessage({ text: `${who} left the game`, kind: 'join' }),
    // For the transport that does not exist yet: read-only views of state a
    // network layer will want.
    get history() { return history.slice() },
    get commands() { return [...commands.keys()] },
  }
  return api
}
