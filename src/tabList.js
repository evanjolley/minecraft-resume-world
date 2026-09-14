import { SCALE, FONT_PX, px } from './hud.js'

/*
 * Minecraft's player list -- the thing you get by holding Tab.
 *
 * Every number below comes from PlayerTabOverlay (net.minecraft.client.gui.
 * components.PlayerTabOverlay, and its pre-1.13 name GuiPlayerTabOverlay).
 * The layout has not moved since 1.8, so the 1.11 and 1.19.2 sources agree
 * line for line; where they differ it is only in how the sprite is addressed.
 * The wiki page (minecraft.wiki/w/Player_list) documents the BEHAVIOUR -- the
 * ping buckets, the greyed-out spectator, the hat layer -- and none of the
 * geometry, which is why the numbers here are cited to the class instead.
 *
 * VANILLA'S LAYOUT, in GUI pixels (render(), reading top to bottom):
 *
 *   list = sorted(players)[0 : 80]          hard cap, 80 entries
 *   for (cols = 1; rows > 20; rows = ceil(n / cols)) cols++
 *                                           MAX_ROWS_PER_COL = 20, then it
 *                                           spills sideways
 *   colW = min(cols * (9 + widestName + 13), screenW - 50) / cols
 *   x0   = screenW / 2 - (colW * cols + (cols - 1) * 5) / 2
 *   y0   = 10                               anchored to the TOP, not centred
 *   row k:  x = x0 + col * (colW + 5)
 *           y = y0 + rowIndex * 9           9 tall, the font's line height
 *           fill(x, y, x + colW, y + 8, 0x20FFFFFF)     the per-row plate
 *           head 8x8 at x, then x += 9
 *           name with shadow at x
 *           ping 10x8 at (x_beforeHead + colW - 11)
 *   panel background: fill(cx - w/2 - 1, y0 - 1, cx + w/2 + 1, y0 + rows*9,
 *                          Integer.MIN_VALUE)
 *
 * The two magic constants in colW are the two fixed-width columns: 9 is the
 * head (8 wide plus a 1px gutter) and 13 is the ping icon (10 wide) plus the
 * 3px of padding that keeps the longest name off it.
 *
 * THE ALPHAS ARE NOT CHAT'S. Chat's log rows are 0x7F000000 and its input bar
 * is 0x80000000; the debug screen's per-line plate is 0x90505050. The tab list
 * uses a THIRD pair: Integer.MIN_VALUE (0x80000000, black at alpha 128) for the
 * panel, and 553648127 (0x20FFFFFF, WHITE at alpha 32) for each row. The row
 * plate being white is the detail that reads wrong if you assume it is black:
 * it LIGHTENS the panel it sits on rather than darkening it, which is what
 * gives the list its banded look.
 *
 * WHAT IS NOT REPRODUCED, and why:
 *
 *   header / footer   setHeader/setFooter are driven by a server packet
 *                     (ClientboundTabListPacket). There is no server, so there
 *                     is nothing to draw. The geometry above already leaves
 *                     room for them -- the panel's width is a max() over the
 *                     header lines -- and that max is simply over zero lines.
 *   scoreboard score  the `list` display slot. No scoreboard in this world.
 *   spectator style   grey italics via colour -1862270977. There is no
 *                     spectator gamemode here, so the branch would be dead.
 *   the 80-entry cap  kept as a constant and applied, because it costs one
 *                     line and it is the kind of limit that is a bug the day
 *                     it stops being theoretical.
 */

/** PlayerTabOverlay.MAX_ROWS_PER_COL. */
const MAX_ROWS_PER_COL = 20
/** `list.subList(0, Math.min(list.size(), 80))`. */
const MAX_ENTRIES = 80
const ROW_H = 9          // font line height; the plate inside it is 8 tall
const ROW_PLATE_H = 8
const HEAD = 8           // the face crop, 8x8 GUI px
const HEAD_COL = 9       // head plus its 1px gutter (`k2 += 9`)
const PING_W = 10, PING_H = 8
const PING_COL = 13      // ping width plus the 3px that keeps names off it
const COL_GAP = 5
const TOP = 10
const SCREEN_MARGIN = 50 // `width - 50`, the widest the panel may ever get

/*
 * Minecraft's font is variable width and this one is not: Monocraft advances
 * exactly 6 GUI px per glyph (see hud.js FONT_PX), so a string's width is its
 * length times 6 rather than a sum over a glyph table. That is a REAL
 * difference from vanilla -- "Illillil" and "MWMWMWMW" are the same width here
 * and are not in Minecraft -- and it is the same approximation chat.js and the
 * debug screen already make, because the font in this world genuinely is
 * monospaced. Names are capped at 16 characters by identity.js, so the error
 * this can accumulate is bounded and small.
 */
const GLYPH_W = 6
const textWidth = (s) => s.length * GLYPH_W

/*
 * PING.
 *
 * `renderPingIcon` buckets PlayerInfo.getLatency() into six sprites. In
 * icons.png they are one 10x8 column at (0, 176 + j*8); since 1.20.2 they are
 * separate files, gui/sprites/icon/ping_{1..5} and ping_unknown. j=0 is the
 * BEST signal (five bars) and j=4 the worst, which is the opposite of the file
 * names, so the table below stores the bar count and not the sprite index --
 * "how many bars" is the thing that is actually true.
 *
 *   latency < 0      ping_unknown   the red cross ("no measurement yet")
 *   latency < 150    5 bars
 *   latency < 300    4 bars
 *   latency < 600    3 bars
 *   latency < 1000   2 bars
 *   otherwise        1 bar
 */
export function pingBars(ms) {
  if (!(ms >= 0)) return 0        // 0 means unknown; also catches null/NaN
  if (ms < 150) return 5
  if (ms < 300) return 4
  if (ms < 600) return 3
  if (ms < 1000) return 2
  return 1
}

/*
 * The ping sprite is NOT among the GUI sprites this repo extracts.
 * build-textures.mjs slices eleven things out of icons.png (hearts, food,
 * armor, air, the xp bar) and the ping column is not one of them, in either
 * the atlas path or the 1.21 per-file path. Adding it there would be the
 * tidier fix and that file is not this change's to edit -- so the sprite is
 * reconstructed here instead, from the vanilla pixels.
 *
 * It is drawn rather than stored as a blob because the sprite is describable
 * in four lines. Read out of 1.21.8's gui/sprites/icon/ping_*.png, the whole
 * thing is one rule:
 *
 *   bar k (k = 0..4) is a 1px column at x = 2k, running y = 5-k .. 6
 *   its drop shadow is the same column offset by (+1, +1)
 *   lit bars are #00ff21 over shadow #00870f
 *   dead bars are #5b5b5b over shadow #383838
 *
 * A shorter left bar and a taller right one, which is the signal-strength
 * staircase everyone recognises. `ping_unknown` is a red cross and is NOT
 * derivable from that rule, so it is stored as the one literal below.
 *
 * Rejected: shipping six PNGs in public/ui/. They would be the only sprites in
 * that directory that build-textures.mjs did not write, so the next run of it
 * would leave them behind as orphans that look generated and are not.
 */
const PING_LIT = '#00ff21', PING_LIT_SHADOW = '#00870f'
const PING_DEAD = '#5b5b5b', PING_DEAD_SHADOW = '#383838'
/*
 * ping_unknown, verbatim: a palette and one character per pixel, read out of
 * 1.21.8's gui/sprites/icon/ping_unknown.png. `.` is transparent.
 *
 * Stored rather than derived because it is a red cross drawn OVER the dead
 * staircase, and the four odd colours in the middle of the palette are where
 * the cross's shadow overlaps a grey bar -- Mojang blended those by hand, and
 * no compositing rule reproduces them. Sixteen bytes of data beats a rule that
 * is nearly right.
 */
const PING_UNKNOWN_PALETTE = ['ff0000', '820000', '161616', '1b1b1b', '0d0d0d', '2d2d2d', '383838', '5b5b5b']
const PING_UNKNOWN_ROWS = [
  '..........',
  '.ab....ab.',
  '..ab..abcd',
  '...ababefg',
  '..h.abcdhg',
  'h.fababghg',
  'hgabcdabhg',
  '.abe.g.abg',
]

/** One 10x8 sprite as a data URL, cached -- every row shares the same image. */
const pingCache = new Map()
function pingSprite(bars) {
  if (pingCache.has(bars)) return pingCache.get(bars)
  const c = document.createElement('canvas')
  c.width = PING_W; c.height = PING_H
  const g = c.getContext('2d')
  if (bars === 0) {
    PING_UNKNOWN_ROWS.forEach((row, y) => {
      for (let x = 0; x < PING_W; x++) {
        const ch = row[x]
        if (ch === '.') continue
        g.fillStyle = `#${PING_UNKNOWN_PALETTE[ch.charCodeAt(0) - 97]}`
        g.fillRect(x, y, 1, 1)
      }
    })
  } else {
    for (let k = 0; k < 5; k++) {
      const lit = k < bars
      const top = 5 - k, h = k + 2
      g.fillStyle = lit ? PING_LIT_SHADOW : PING_DEAD_SHADOW
      g.fillRect(2 * k + 1, top + 1, 1, h)
      g.fillStyle = lit ? PING_LIT : PING_DEAD
      g.fillRect(2 * k, top, 1, h)
    }
  }
  const url = c.toDataURL()
  pingCache.set(bars, url)
  return url
}

/*
 * THE HEAD.
 *
 * `PlayerFaceRenderer.draw` blits TWO 8x8 crops of the skin into the same 8x8
 * cell: the face at (8, 8) and the hat layer at (40, 8), both against a 64x64
 * texture. The hat on top is the half people forget, and it is why Evan's head
 * here has his hair and not his scalp.
 *
 * Vanilla skips the hat until the player is within render distance (the wiki
 * calls this out) because the model-part flags ride on the entity, not on the
 * profile. Both characters in this world are always loaded, so the hat is
 * always composited.
 *
 * Composited in a canvas rather than stacked as two CSS background layers:
 * two layers would need two background-position/size pairs that have to stay
 * in step with SCALE, and the result is one image either way. Done once per
 * SKIN, not once per row.
 *
 * This deliberately does not go near playerModel.js. That file owns the 3D
 * skin material and its UV layout; this is a 2D crop of the same PNG, and
 * sharing code between them would couple a HUD element to the renderer.
 */
const faceCache = new Map()
function faceUrl(skin) {
  if (faceCache.has(skin)) return faceCache.get(skin)
  const c = document.createElement('canvas')
  c.width = HEAD; c.height = HEAD
  const g = c.getContext('2d')
  const entry = { url: null, canvas: c, listeners: new Set() }
  const img = new Image()
  img.onload = () => {
    g.clearRect(0, 0, HEAD, HEAD)
    g.drawImage(img, 8, 8, 8, 8, 0, 0, HEAD, HEAD)    // face
    g.drawImage(img, 40, 8, 8, 8, 0, 0, HEAD, HEAD)   // hat overlay, on top
    entry.url = c.toDataURL()
    for (const fn of entry.listeners) fn(entry.url)
    entry.listeners.clear()
  }
  img.src = skin
  faceCache.set(skin, entry)
  return entry
}

/**
 * Hold Tab, see who is here.
 *
 * @param {object} noa
 * @param {object} deps
 * @param {object} deps.roster       identity.js. The ONLY source of names.
 * @param {object} [deps.inputLock]  read, never taken -- see the key handler.
 * @param {(entry) => string} [deps.skinOf]   entry -> skin PNG url
 * @param {(entry) => number} [deps.pingOf]   entry -> latency in ms
 */
export function installTabList(noa, { roster, inputLock, skinOf, pingOf } = {}) {
  const root = document.createElement('div')
  root.id = 'tab-list'
  root.className = 'hidden'
  const panel = document.createElement('div')
  panel.id = 'tab-panel'
  root.appendChild(panel)
  document.body.appendChild(root)

  const skinFor = skinOf ?? (() => '/skins/default.png')

  /*
   * WHAT PING MEANS WHEN THERE IS NO SERVER.
   *
   * There is no transport, so there is no round trip to time, and every honest
   * answer is "0". That is not a cop-out: it is exactly what vanilla
   * SINGLEPLAYER reports. The integrated server fills PlayerInfo.latency with
   * 0, 0 falls in the `< 150` bucket, and singleplayer therefore draws a full
   * five-bar icon next to your own name. Mirroring that is mirroring vanilla,
   * not papering over a gap.
   *
   * Rejected: hiding the icon until there is a real number. The icon is part of
   * the row's geometry -- colW reserves 13px for it whether or not it is drawn
   * -- so hiding it would leave a hole that has to be explained, and it would
   * be the one place this overlay stops looking like Minecraft.
   *
   * Rejected: a fake number that drifts, so it "looks alive". A made-up
   * latency is a lie the UI tells convincingly, and the next person to read it
   * would have no way to tell it from a measurement.
   *
   * WHAT DROPS IN LATER: this function. `pingOf(entry)` is the whole seam. A
   * socket writes `entry.latency` (or the connection keeps its own map) and
   * main.js passes a real reader here; pingBars, the sprite, the column
   * reservation and the row layout do not change, because none of them knows
   * where the number came from. That is the reason the default is a FUNCTION
   * and not the constant 0 inlined at the call site.
   */
  const pingFor = pingOf ?? (() => 0)

  /*
   * The name, asked for fresh, every paint.
   *
   * Not `entry.name`, and emphatically not a string built once at install time
   * and kept: the roster is the source of truth for what someone is called and
   * it can change under us (the rename arrives through a tool call, and in the
   * multiplayer end state it arrives from the server). Reading through
   * displayNameOf means this overlay cannot drift out of step with the
   * nametag, chat, or the agent.
   *
   * NO RANK PREFIX. Two different mechanisms put a tag in front of a name on a
   * real server, and only one of them reaches the tab list:
   *
   *   - A SCOREBOARD TEAM prefix. PlayerTabOverlay.getNameForDisplay returns
   *     PlayerInfo.getTabListDisplayName() and falls back to
   *     PlayerTeam.formatNameForTeam(team, name) -- so a team prefix DOES show
   *     here. It also shows above the head, because EntityRenderer passes
   *     getDisplayName() to the nametag.
   *   - A CHAT PLUGIN prefix (LuckPerms, EssentialsX). It rewrites the chat
   *     FORMAT string. Nothing has touched the profile or the team, so it
   *     appears on the chat line and nowhere else -- not in the tab list, not
   *     above the head.
   *
   * This world's `[Admin]` is the second kind. identity.js says so outright
   * and chat.js is the only file that applies it; the floating nameplate was
   * asked to show it, tried it, and had it rejected. So the consistent answer
   * -- the same answer on all three surfaces -- is that the tab list shows
   * `Evan`, not `[Admin] Evan`.
   *
   * Rejected: reading `[Admin]` as a team prefix so it could appear here. It
   * would be a faithful screenshot of SOME server, and it would put the rank
   * back on a surface that already turned it down once, on the strength of a
   * mechanism this world does not implement.
   */
  const nameOf = (entry) => roster.displayNameOf(entry.id)

  /*
   * SORTING, minus the two keys this world cannot have.
   *
   * PlayerInfoComparator is a three-key ComparisonChain: spectators last, then
   * team name, then player name case-insensitively. There is no spectator
   * gamemode and no scoreboard team here, so the first two keys are constant
   * for every entry and the chain collapses to the third. Written as the third
   * key alone rather than as a chain with two dead comparisons.
   *
   * Worth watching happen: the list is sorted by name and the visitor's name
   * CHANGES mid-session, so "Evan, Guest" becomes "Adam, Evan" the moment he
   * introduces himself. That re-order is vanilla's behaviour and it falls out
   * for free precisely because nothing here caches a display string.
   */
  const sorted = () => roster.list()
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: 'base' }))
    .slice(0, MAX_ENTRIES)


  /* ---- layout ---- */

  /** The row model, before any of it is pixels. Exposed for the test suite. */
  function rows() {
    return sorted().map((entry) => ({
      id: entry.id,
      name: nameOf(entry),
      ping: pingFor(entry),
      bars: pingBars(pingFor(entry)),
      skin: skinFor(entry),
    }))
  }

  /*
   * Vanilla's column split, verbatim:
   *
   *   for (cols = 1; rows > 20; rows = (n + cols - 1) / cols) cols++
   *
   * Integer division, so `(n + cols - 1) / cols` is ceil(n / cols). It reads
   * like it could loop forever and it cannot: rows shrinks every pass. With
   * two entries it exits immediately at one column, which is all this world
   * will ever need -- and it is eleven characters, so the version that hardcodes
   * one column and a comment saying "multiplayer later" is strictly longer.
   */
  function columnise(n) {
    let cols = 1
    let perCol = n
    while (perCol > MAX_ROWS_PER_COL) { cols++; perCol = Math.ceil(n / cols) }
    return { cols, perCol }
  }

  function paint() {
    const model = rows()
    const n = model.length
    panel.replaceChildren()
    if (n === 0) return

    const { cols, perCol } = columnise(n)
    // Screen width in GUI px. Vanilla's `width` is already the scaled GUI
    // width; ours is CSS px, so it is divided by the same SCALE the HUD uses.
    const screenW = Math.floor(window.innerWidth / SCALE)

    let widest = 0
    for (const r of model) widest = Math.max(widest, textWidth(r.name))

    const colW = Math.floor(
      Math.min(cols * (HEAD_COL + widest + PING_COL), screenW - SCREEN_MARGIN) / cols,
    )
    const panelW = colW * cols + (cols - 1) * COL_GAP

    /*
     * The panel plate. Vanilla fills from (cx - w/2 - 1, TOP - 1) to
     * (cx + w/2 + 1, TOP + rows*9): one pixel of bleed on the left, right and
     * top, and on the bottom the extra pixel comes for free because the rows
     * are 9 apart but only 8 tall.
     */
    panel.style.width = px(panelW + 2)
    panel.style.height = px(perCol * ROW_H + 1)
    panel.style.top = px(TOP - 1)

    for (let i = 0; i < n; i++) {
      const col = Math.floor(i / perCol)
      const rowIndex = i % perCol
      const r = model[i]

      const row = document.createElement('div')
      row.className = 'tab-row'
      row.style.left = px(1 + col * (colW + COL_GAP))
      row.style.top = px(1 + rowIndex * ROW_H)
      row.style.width = px(colW)
      row.style.height = px(ROW_PLATE_H)

      const head = document.createElement('div')
      head.className = 'tab-head'
      head.style.width = head.style.height = px(HEAD)
      const face = faceUrl(r.skin)
      if (face.url) head.style.backgroundImage = `url(${face.url})`
      // The skin PNG may still be decoding on the first open. Patch this one
      // element when it lands rather than repainting the list, which would
      // throw away a perfectly good layout to change one background-image.
      else face.listeners.add((url) => { head.style.backgroundImage = `url(${url})` })
      row.appendChild(head)

      const name = document.createElement('div')
      name.className = 'tab-name'
      name.textContent = r.name
      name.style.left = px(HEAD_COL)
      name.style.fontSize = `${FONT_PX}px`
      // Vanilla draws the row's text on the font's 9px line with no padding;
      // the glyphs sit in the top 8. Matching that is what keeps the name
      // optically centred against the 8px plate.
      name.style.lineHeight = px(ROW_H)
      row.appendChild(name)

      const ping = document.createElement('div')
      ping.className = 'tab-ping'
      ping.style.width = px(PING_W)
      ping.style.height = px(PING_H)
      // `x + colW - 11`, measured from the row's left edge -- which is BEFORE
      // the head, because vanilla passes `k2 - 9` back in after advancing past
      // it. Getting that wrong shifts the icon 9px right, off the plate.
      ping.style.left = px(colW - 11)
      ping.style.backgroundImage = `url(${pingSprite(r.bars)})`
      row.appendChild(ping)

      panel.appendChild(row)
    }
  }

  /* ---- the key ---- */

  /*
   * Tab is an OVERLAY, not a screen -- the same distinction F3 makes in
   * debugScreen.js, and for the same reason. In Minecraft you can walk, mine
   * and fall while the player list is up; it is drawn in the HUD pass and takes
   * no input. So this reads `inputLock` and never calls lock(): the world keeps
   * ticking, the movement component stays attached, and holding Tab while
   * running does not so much as break stride.
   *
   * The lock is read for one thing only, and it is chat: while the chat bar is
   * open every keystroke is text, and vanilla's Tab in the chat bar is command
   * completion, not the player list. Taking the whole lock rather than just
   * chat matches the debug screen -- any state that means "keys are not
   * gameplay right now" should mean it for this key too.
   *
   * preventDefault runs UNCONDITIONALLY, before that guard, and that is the
   * part that is easy to get wrong. Tab's browser default is to move focus,
   * and it fires whether or not this overlay wants the key: unguarded, Tab in
   * the chat bar would blur the input mid-sentence, and Tab during play would
   * walk the focus ring onto #game or the address bar and send the next
   * keystroke somewhere else entirely.
   */
  let open = false

  function setOpen(next) {
    if (next === open) return
    open = next
    root.classList.toggle('hidden', !open)
    if (open) paint()
  }

  function onKeyDown(e) {
    if (e.code !== 'Tab') return
    e.preventDefault()
    if (e.repeat) return            // held keys autorepeat; one open is enough
    if (inputLock && inputLock.locked) return
    setOpen(true)
  }

  function onKeyUp(e) {
    if (e.code !== 'Tab') return
    e.preventDefault()
    setOpen(false)
  }

  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('keyup', onKeyUp)
  /*
   * A tab-out never delivers the keyup. Without this the overlay would still
   * be on screen when you came back, with no key held to close it -- the same
   * stuck-modifier bug debugScreen.js documents for F3, and the reason Tab is
   * especially prone to it is that Tab is exactly the key that moves focus
   * away in the first place.
   */
  window.addEventListener('blur', () => setOpen(false))

  /*
   * Repaint on roster change, but only while open.
   *
   * The list is up for a second at a time and the only things that can move in
   * it are a rename and a join/leave, both of which come through this one
   * channel (identity.js deliberately has one). So there is no tick handler
   * here: a per-frame repaint of a static two-row list would be pure cost.
   * Ping is the one value that will want polling once it is real, and that is
   * a decision for whoever wires up the transport.
   */
  roster.onChange(() => { if (open) paint() })

  return {
    get isOpen() { return open },
    /** The rows as data, BEFORE they are pixels. For the console and tests. */
    rows,
    paint,
    dispose() {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
      root.remove()
    },
  }
}
