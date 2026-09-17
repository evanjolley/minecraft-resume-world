import { SCALE, px } from './hud.js'
import { cancelPersistentLock } from './menu.js'
import { isSignId } from './blocks.js'
import { SIGN_LINES, setSignText, signTextAt } from './signText.js'

/*
 * THE SIGN EDIT SCREEN, and it is the fifth screen in this world.
 *
 * Evan's third report on signs was "ui to add text does not open on place,
 * should be copied from vanilla". Vanilla's rule is in `SignItem`, one line,
 * and it is worth quoting because it settles where the hook goes:
 *
 *   updateCustomBlockEntityTag(...)
 *     ... if (level.getBlockEntity(pos) instanceof SignBlockEntity sbe
 *             && state.getBlock() instanceof SignBlock sb)
 *           sb.openTextEdit(player, sbe, true);
 *
 * It hangs off the ITEM being used, not off the block appearing. So this
 * screen is opened from `interaction.onBlockPlace`, which fires only when a
 * player uses a stack -- and NOT from a setBlock wrap, which is where
 * signText.js and installPlacementOrientation both live. A /setblock or a
 * build stamping a plot must not stop the world and ask for four lines, and
 * hooking setBlock is exactly how it would.
 *
 *
 * WHAT MAKES THIS THE FIFTH SCREEN AND NOT THE FIFTH COPY OF A SCREEN.
 *
 * inputLock.js's `screens` note predicted this file by name: "the day a fifth
 * screen lands (signs and written books, docs/FUTURE.md item 1) every one of
 * those conditions is silently wrong and nothing fails". Four conditions
 * around the codebase used to answer "is a screen open" by enumerating each
 * other. They ask inputLock now, and inputLock learns about this screen from
 * the `lock('sign')` it already has to call. So there is no list to join, and
 * that is the whole reason this file is short.
 *
 * Three traps are inherited rather than rediscovered, and all three are
 * written up where they were first paid for:
 *
 *   1. THE ORDERING. `inputLock.lock()` happens BEFORE pointer lock is
 *      touched. Releasing the lock fires lostPointerLock synchronously and
 *      main.js reads inputLock to decide whether that event opens the pause
 *      menu. chat.js and inventory.js both comment this about their own open
 *      flags; here the flag IS the lock, which removes the chance to get the
 *      order wrong in one direction and not the other.
 *
 *   2. THE CANCEL. `cancelPersistentLock()` on the way in. inventory.js has
 *      had it since the retry loop was written; chat.js did not, and closing
 *      one screen then opening another let the first one's loop steal the
 *      cursor mid-sentence. A screen that opens the instant you place a block
 *      is the MOST likely of the five to land inside somebody else's retry
 *      window, because placing a block is the first thing you do after
 *      closing the inventory you took the sign out of.
 *
 *   3. THE CAPTURE PHASE. The keydown listener is on `document` in the
 *      capture phase, which is chat.js's trick and its reasoning verbatim:
 *      noa's game-inputs listens on `window` while bubbling, and interact.js,
 *      perspective.js and menu.js all listen on `document` while bubbling. A
 *      capture listener sees the event first, so one stopPropagation keeps W
 *      from walking, E from opening the inventory, the number row from
 *      changing hotbar slots, and ESCAPE FROM OPENING THE PAUSE MENU -- which
 *      is commit 98c3e86's fixed bug and the obvious way to reintroduce it.
 *
 *
 * FOUR REAL <input> ELEMENTS, not one canvas with a hand-drawn caret.
 *
 * Rejected: chat.js's arrangement, which is one input with `caret-color:
 * transparent` and a separate span drawing Minecraft's own blinking cursor.
 * That is right for chat, where there is one line and Minecraft's cursor is a
 * visible part of the chat bar's look. It is four times the work here for a
 * screen whose text is drawn ON THE SIGN ITSELF -- the panel is a way to type,
 * not the thing you are looking at. Four inputs also give arrow-key movement
 * between lines, selection and IME for free, and `document.activeElement` is
 * then the answer to "which line is the cursor on" rather than a fifth piece
 * of state to keep in step.
 *
 * LIVE, and that is the feature rather than a nicety. Vanilla renders the
 * sign as you type. Every keystroke calls setSignText, which rebuilds one
 * sign's mesh -- 60 characters is 240 vertices, and signText.js's whole
 * design is that a sign costs a vertex buffer and not a texture, so a rebuild
 * per keystroke is affordable in a way a rebuild per keystroke of a
 * 720x312 canvas would not have been.
 */

/* ---- geometry, in Minecraft GUI pixels, like the rest of the HUD ---- */
const PANEL_W = 180
const ROW_H = 14
const PAD = 8
/** Monocraft's advance is 2/3 em, so 18px of font is 6 GUI px of advance. */
const FONT_PX = 18

/*
 * Vanilla enforces `SignBlockEntity.getMaxTextLineWidth() = 90` PIXELS in the
 * edit screen, not a character count. Monocraft being monospaced at 6 turns
 * that into 15 characters exactly, which is the number signText.js truncates
 * at -- so the input's maxlength and the renderer's slice are the same rule
 * applied twice rather than two rules that happen to agree today.
 */
const MAX_LINE_WIDTH = 90
const GLYPH_W = 6
const MAX_CHARS = Math.floor(MAX_LINE_WIDTH / GLYPH_W)

/**
 * @param {*} noa
 * @param {{ inputLock: *, requestPointerLock?: () => void }} deps
 */
export function installSignScreen(noa, { inputLock, requestPointerLock }) {
  const root = document.getElementById('sign-edit')
  const panel = document.getElementById('sign-edit-panel')
  if (!root || !panel) throw new Error('sign-edit markup missing from index.html')

  /*
   * `px()` already multiplies by SCALE (hud.js), so these are GUI pixels
   * passed through once and not twice. Passing them twice is how the first
   * version of this screen came out four times life size with a 72px font --
   * caught by a screenshot, which is the only thing that could have caught it.
   */
  panel.style.width = px(PANEL_W)
  panel.style.padding = px(PAD)

  const inputs = []
  for (let i = 0; i < SIGN_LINES; i++) {
    const line = document.createElement('input')
    line.className = 'sign-edit-line'
    line.type = 'text'
    line.maxLength = MAX_CHARS
    line.spellcheck = false
    // A blank line is legal and common -- a two-line sign is two blanks --
    // so autocomplete and autocapitalise are both off rather than tuned.
    line.autocomplete = 'off'
    line.autocapitalize = 'off'
    line.style.height = px(ROW_H)
    // chat.js's exact expression: FONT_PX is already CSS pixels at SCALE 2,
    // so px() would double it. Same constant, same divide, same reason.
    line.style.fontSize = px(FONT_PX / SCALE)
    line.dataset.line = String(i)
    panel.appendChild(line)
    inputs.push(line)
  }

  const done = document.createElement('button')
  done.id = 'sign-edit-done'
  done.className = 'mc-button'
  done.textContent = 'Done'
  panel.appendChild(done)

  /** The sign being edited, or null. Doubles as the open flag. */
  let editing = null

  /*
   * Push what is typed onto the block, every keystroke.
   *
   * Read straight off the inputs rather than from a parallel array: the DOM
   * is already the model here, and a second copy would be a second thing to
   * keep in step for no gain. Trailing blank lines are sent as-is because
   * signText.js drops them itself (`if (!text) continue`), and trimming them
   * here would mean line 4 could not be cleared once it had been typed.
   */
  const push = () => {
    if (!editing) return
    const { x, y, z } = editing
    setSignText(x, y, z, inputs.map(i => i.value))
  }

  for (const line of inputs) line.addEventListener('input', push)

  /**
   * Open on a coordinate, if there is really a sign there.
   *
   * The guard is not defensive padding. `onBlockPlace` reports the CANONICAL
   * id the item placed, and the id that actually landed is whichever of the
   * twenty rotations the placement seam resolved to -- so this has to read
   * the world back anyway, and having read it, "is it still a sign" is free.
   * It is also the honest answer for a sign placed somewhere it cannot
   * survive: installAttachment breaks it on the same tick, and a screen
   * editing a block that is already gone is worse than no screen.
   */
  const open = (x, y, z) => {
    if (editing) return false
    if (!isSignId(noa.getBlock(x, y, z))) return false
    editing = { x, y, z }

    /*
     * LOCK FIRST. See trap 1 in the header -- everything below this line can
     * fire lostPointerLock synchronously, and main.js reads inputLock to
     * decide whether that event is a pause menu.
     */
    inputLock.lock('sign')
    root.classList.remove('hidden')
    document.body.classList.add('sign-open')

    // Whatever the sign already says, which is blank for a sign just placed
    // and is not for one being edited a second time.
    const existing = signTextAt(x, y, z)
    inputs.forEach((line, i) => { line.value = existing?.lines?.[i] ?? '' })

    // Trap 2: kill any retry loop still running from the screen you just
    // closed, before releasing the lock, or it takes the cursor back mid-word.
    cancelPersistentLock()
    noa.container.setPointerLock(false)

    // Vanilla opens with the cursor on line 1.
    inputs[0].focus()
    inputs[0].setSelectionRange(inputs[0].value.length, inputs[0].value.length)
    return true
  }

  const close = () => {
    if (!editing) return
    push()
    editing = null
    for (const line of inputs) line.blur()
    root.classList.add('hidden')
    document.body.classList.remove('sign-open')
    inputLock.unlock('sign')
    document.getElementById('game').focus()
    /*
     * AND THE CROSSHAIR COMES BACK, which is the half of Escape that
     * 98c3e86 fixed and that this screen is the obvious way to break again.
     * Asked of inputLock rather than of four named peers, and asked AFTER
     * the unlock above, so the question is "is anything else open" and stays
     * right if the order ever changes. `requestLockPersistently` is what
     * main.js injects: one request lands inside the browser's ~1.25 s
     * post-Escape cooldown and is dropped without a word.
     */
    if (!inputLock.otherScreenOpen('sign')) requestPointerLock?.()
  }

  done.addEventListener('click', (e) => { e.preventDefault(); close() })

  /** Which of the four is focused, or -1. The DOM is the state. */
  const currentLine = () => inputs.indexOf(document.activeElement)

  const moveTo = (i) => {
    const line = inputs[Math.min(SIGN_LINES - 1, Math.max(0, i))]
    line.focus()
    // Vanilla lands the cursor at the end of the line you moved onto rather
    // than keeping a column, which is what its single-line EditBox per row
    // does for free and what this reproduces deliberately.
    line.setSelectionRange(line.value.length, line.value.length)
  }

  /* Trap 3: capture phase on document. chat.js's note is the long version. */
  document.addEventListener('keydown', (e) => {
    if (!editing) return
    // Everything while this screen is up is this screen's, whether or not it
    // is a key this screen uses.
    e.stopPropagation()

    if (e.key === 'Escape') { e.preventDefault(); close() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveTo(currentLine() - 1) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); moveTo(currentLine() + 1) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      /*
       * Enter on the last line finishes, and on any other line moves down.
       * That is vanilla: its Done button and its Enter are the same action
       * only once there is nowhere left to go.
       */
      const i = currentLine()
      if (i < 0 || i >= SIGN_LINES - 1) close()
      else moveTo(i + 1)
    }
  }, true)

  /*
   * keyup is deliberately NOT stopped, for chat.js's reason exactly: a key
   * held when the screen opened has already been counted by game-inputs, and
   * swallowing its release would leave the count latched and hand the player
   * back a character already walking.
   */

  return {
    /** @returns {boolean} whether a screen actually opened. */
    open,
    close,
    get isOpen() { return editing !== null },
    /** Which sign is being edited, for the console and the test suite. */
    get editingAt() { return editing ? [editing.x, editing.y, editing.z] : null },
    /** The four lines as typed, which is what the sign is showing right now. */
    lines: () => inputs.map(i => i.value),
  }
}
