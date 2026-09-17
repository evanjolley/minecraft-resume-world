import { createItemIcon } from './blockIcon.js'
import { itemName } from './items.js'
import { HOTBAR_SIZE } from './inventory.js'
import { armorPoints } from './armor.js'
import { MAX_HEALTH, MAX_FOOD } from './survival.js'
import { MC } from './physics.js'

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
const MAX_ARMOR = 20

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

/*
 * The air bubbles share the armor row's height -- Gui.renderPlayerHealth blits
 * them at `screenHeight - 39 - 10`, which is the same 40..49 band the table
 * above gives armor -- but on the RIGHT, above the food bar rather than above
 * the hearts. Left and right of one row, so the two never collide no matter
 * what either is doing.
 *
 * Anchored like HELD_NAME_BOTTOM rather than stacked in the flex column, and
 * for the same reason plus one more: the armor row removes itself at zero
 * points, and a bubble row sharing that flow would vanish with it every time a
 * visitor swam without armor on -- which is every time.
 */
const AIR_BOTTOM = 40
const GAP_UNDER_XP = 2       // the wide one: the level number sits in it
const GAP_UNDER_HEARTS = 1
const GAP_UNDER_ARMOR = 1

/**
 * GUI pixels to CSS pixels. Exported because chat.js and inventory.js both
 * lay themselves out in Minecraft's GUI pixels against this same SCALE, and
 * each had its own identical copy of this line. Three copies of a conversion
 * is three chances for one of them to be multiplying by the wrong thing --
 * and the whole reason SCALE is a single constant is that the HUD, the chat
 * overlay and the container panels have to agree on it exactly.
 */
export const px = (n) => `${n * SCALE}px`

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
function iconRow(container, count, kind, rightToLeft, withBlink = false) {
  const icons = []
  for (let i = 0; i < count; i++) {
    const wrap = document.createElement('div')
    wrap.className = 'icon-slot'
    wrap.style.width = px(9)
    wrap.style.height = px(9)
    // pitch 8 not 9: Minecraft's icons overlap by one pixel
    wrap.style.left = px(rightToLeft ? (count - 1 - i) * 8 : i * 8)

    const empty = spriteEl(`/ui/${kind}_empty.png`, 9, 9)
    /*
     * The pale "blinking" heart, drawn BETWEEN the container and the live
     * heart. Only the health row asks for it. It is a third layer rather than
     * a swap of `fill`'s image because vanilla genuinely draws two hearts in
     * the same 9x9 cell during the flash -- the lagging one underneath and the
     * live one on top -- and the live one has to win where both exist.
     */
    const blink = withBlink ? spriteEl(`/ui/${kind}_full_blink.png`, 9, 9) : null
    if (blink) { blink.classList.add('blink'); blink.style.opacity = '0' }
    const fill = spriteEl(`/ui/${kind}_full.png`, 9, 9)
    fill.classList.add('fill')
    wrap.append(empty, ...(blink ? [blink] : []), fill)
    container.appendChild(wrap)
    icons.push({ wrap, empty, blink, fill, kind })
  }
  return icons
}

/**
 * @param layer   which sprite in the cell to paint -- 'fill' is the live row,
 *   'blink' the pale one underneath it.
 * @param suffix  sprite-name suffix, so the same full/half/empty decision
 *   drives `heart_full.png` and `heart_full_blink.png` from one place.
 */
function paintRow(icons, value, layer = 'fill', suffix = '') {
  icons.forEach((icon, i) => {
    const el = icon[layer]
    if (!el) return
    const points = value - i * 2
    if (points >= 2) {
      el.style.backgroundImage = `url(/ui/${icon.kind}_full${suffix}.png)`
      el.style.opacity = '1'
    } else if (points > 0) {
      el.style.backgroundImage = `url(/ui/${icon.kind}_half${suffix}.png)`
      el.style.opacity = '1'
    } else {
      el.style.opacity = '0'
    }
  })
}

/* ------------------------------------------------------------------ *
 * The damage animation, from Gui.renderPlayerStats.
 *
 * Losing health without any of this reads as a number going down. Three
 * separate things in vanilla make a hit read as a hit, and all three are
 * driven by ONE integer -- Minecraft's tick counter -- which is why they are
 * in one place here:
 *
 *   1. For 20 ticks after damage, the hearts you just lost keep being drawn
 *      in a washed-out variant and the containers switch to their white
 *      outline, both toggling on and off every 3 ticks.
 *   2. At 4 half-hearts or less -- two hearts -- every heart jitters one pixel
 *      down or not, a fresh draw of the coin each tick.
 *   3. A regeneration wave -- deliberately absent, see REGEN below.
 *
 * The lagging value in (1) is the point of the whole effect: vanilla holds
 * the PRE-hit health for a second and flashes those hearts, so you see what
 * you lost rather than just what you have left.
 * ------------------------------------------------------------------ */

/*
 * Vanilla's own names for these, so the code below can be read against the
 * decompile: healthUpdateCounter (BLINK_TICKS), the /3 %2 alternation, and
 * the 1000 ms after which lastPlayerHealth catches up.
 *
 * NOT implemented: vanilla's `else if (i > playerHealth && hurtResistantTime
 * > 0)` branch, which blinks for 10 ticks when you are HEALED during
 * invulnerability frames. That gate is the whole point of it -- it fires for
 * an instant-health potion landing on top of a hit, not for ordinary regen --
 * and this world has neither potions nor i-frames. Adding the branch without
 * the gate would make the four-second food regen flash the bar, which vanilla
 * never does.
 */
export const BLINK_TICKS = 20
const BLINK_HALF_PERIOD = 3
const SETTLE_MS = 1000
const TICK_MS = 50
/** `if (i <= 4)` -- ceil(health) in HALF hearts, so two hearts, not five. */
const JITTER_BELOW = 4

/**
 * Is the flash lit, with `left` ticks still to run on the counter?
 *
 * Pulled out as a pure function of one integer because that is exactly what it
 * is, and because it is the only part of this animation whose timing a test
 * can pin honestly: the DOM only changes as fast as the page renders, and the
 * headless browser the suite runs in manages about seven frames a second --
 * far too coarse to measure a 150 ms pulse off the screen.
 *
 * Over the 20 ticks it yields three three-tick pulses, at 17..15, 11..9 and
 * 5..3. Call it 150-300 ms, 450-600 ms and 750-900 ms after the hit.
 */
export const heartFlashOn = (left) =>
  left > 0 && Math.floor(left / BLINK_HALF_PERIOD) % 2 === 1

/*
 * java.util.Random, forty-eight bits of it, because the jitter is not "some
 * noise" -- it is `rand.setSeed(updateCounter * 312871)` then one nextInt(2)
 * per heart, drawn high index to low. Reseeding from the tick is what makes
 * the row change once per TICK rather than once per rendered frame, and a
 * Math.random() per heart per frame is visibly faster and mushier than the
 * real thing.
 *
 * Two details that look like typos and are not. The seed is an INT
 * multiplication in Java, so it wraps at 2^31 (hence Math.imul) and is then
 * sign-extended into a long. And nextInt(2) on a power of two reduces to the
 * top bit of next(31), which is bit 47 of the state -- no rejection loop.
 */
const LCG_MULT = 0x5DEECE66Dn
const LCG_MASK = (1n << 48n) - 1n

function tickCoinFlips(tick) {
  let s = (BigInt.asUintN(64, BigInt(Math.imul(tick, 312871))) ^ LCG_MULT) & LCG_MASK
  return () => {
    s = (s * LCG_MULT + 0xBn) & LCG_MASK
    return Number((s >> 47n) & 1n)
  }
}

/**
 * Builds the per-tick painter for the health row. Closes over the three
 * pieces of state vanilla keeps as fields on Gui.
 *
 * @returns (health, tick, nowMs) -> void
 */
function heartAnimation(hearts) {
  let displayHealth = MAX_HEALTH   // vanilla lastPlayerHealth: the lagging one
  let prevHealth = MAX_HEALTH      // vanilla playerHealth: strictly last frame
  let blinkUntilTick = -1          // vanilla healthUpdateCounter
  /*
   * -Infinity, not 0. Vanilla's lastSystemTime starts at 0 against a
   * wall-clock millisecond count, so its `now - lastSystemTime > 1000` is true
   * from the first frame and displayHealth simply tracks health until
   * something hits you. performance.now() starts near zero instead, so a
   * literal 0 here would hold displayHealth stale for the first second of the
   * page -- during boot, where a fall onto the island is entirely possible.
   */
  let settledAt = -Infinity

  return (health, tick, nowMs) => {
    const h = Math.ceil(health)

    /*
     * Read the flag BEFORE updating the counter, exactly as vanilla does. It
     * means the frame that takes the hit is not yet blinking; the flash starts
     * on the next one. Computing it after would make the first half-period
     * one tick short.
     */
    const blinking = heartFlashOn(blinkUntilTick - tick)

    if (h < prevHealth) {
      settledAt = nowMs
      blinkUntilTick = tick + BLINK_TICKS
    }
    if (nowMs - settledAt > SETTLE_MS) {
      displayHealth = h
      settledAt = nowMs
    }
    prevHealth = h

    // The containers. Vanilla swaps the sprite, it does not tint.
    const container = `url(/ui/heart_empty${blinking ? '_blink' : ''}.png)`
    for (const icon of hearts) icon.empty.style.backgroundImage = container

    // The hearts you had a moment ago, pale, under the ones you have now.
    paintRow(hearts, blinking ? displayHealth : 0, 'blink', '_blink')

    /*
     * The jitter. Applied as an inline `top` in GUI pixels, which is zero at
     * rest -- the row's resting position is the stylesheet's `top: 0` either
     * way, so nothing here can shift the HUD grid when the animation is off.
     * Descending, because that is the order vanilla draws in and therefore the
     * order it consumes the random sequence in.
     */
    const flip = tickCoinFlips(tick)
    for (let i = hearts.length - 1; i >= 0; i--) {
      hearts[i].wrap.style.top = px(h <= JITTER_BELOW ? flip() : 0)
    }
  }
}

/*
 * The bubble row. Not built with iconRow/paintRow above, and that is the
 * decision worth recording: those assume Minecraft's full/half/empty triple,
 * and air has none of it. There is no half bubble, and there is no empty
 * bubble either -- neither texture source ships one (1.21's air_empty.png
 * exists and is nine by nine of pure transparency), because Minecraft draws
 * NOTHING where a spent bubble was rather than an outline. Bending the
 * three-state helper into a two-state row with a hole in it would have cost
 * more than forty lines of its own.
 */
function airRow(hud) {
  const row = document.createElement('div')
  row.id = 'air-row'
  row.style.position = 'absolute'
  row.style.right = '0'
  row.style.bottom = px(AIR_BOTTOM)
  row.style.width = px(9 + 8 * (MC.AIR_BUBBLES - 1))
  row.style.height = px(9)
  hud.appendChild(row)

  // Right to left, pitch 8, the same one-pixel overlap the hearts have.
  const bubbles = []
  for (let i = 0; i < MC.AIR_BUBBLES; i++) {
    const b = spriteEl('/ui/air_full.png', 9, 9)
    b.style.inset = 'auto'
    b.style.top = '0'
    b.style.right = px(i * 8)
    row.appendChild(b)
    bubbles.push(b)
  }

  return (air) => {
    /*
     * Vanilla's own arithmetic, verbatim:
     *   full    = ceil((air - 2) * 10 / max)
     *   partial = ceil(air * 10 / max) - full
     * and it draws `full` normal bubbles then `partial` bursting ones. The -2
     * is what makes the leading bubble spend a moment mid-pop instead of
     * blinking out, and dropping it is the difference between a meter that
     * drains and one that stutters.
     */
    const full = Math.ceil(((air - 2) * MC.AIR_BUBBLES) / MC.AIR_TICKS)
    const shown = Math.ceil((air * MC.AIR_BUBBLES) / MC.AIR_TICKS)
    bubbles.forEach((b, i) => {
      b.style.display = i < shown ? 'block' : 'none'
      b.style.backgroundImage = `url(/ui/air_${i < full ? 'full' : 'bursting'}.png)`
    })
    // Minecraft hides the row outright at a full meter, the way it hides the
    // armor row at zero. The bar is only ever on screen while it matters.
    row.style.display = air >= MC.AIR_TICKS ? 'none' : 'block'
  }
}

/* ------------------------------------------------------------------ *
 * Status effect icons, from Gui.renderEffects.
 *
 * GEOMETRY, in GUI pixels, and it is the opposite corner of the screen from
 * everything else in this file:
 *
 *   background   24 x 24, at x = guiWidth - 25 * n, y = 1
 *   icon         18 x 18, at (x + 3, y + 3)
 *   second row   y = 1 + 26 = 27
 *
 * TWO ROWS, SPLIT ON isBeneficial() AND NOT ON "not harmful". Vanilla keeps
 * two counters and chooses with `holder.value().isBeneficial()`, which is
 * `category == BENEFICIAL` exactly -- so the NEUTRAL effects (Glowing, Bad
 * Omen, Trial Omen, Raid Omen) are drawn in the BOTTOM row next to Poison. A
 * three-way split looks more sensible and is wrong.
 *
 * NO DURATION TEXT. This is the detail worth stating because it is easy to
 * "fix": vanilla's HUD row has no numbers on it at all -- the countdown lives
 * in the inventory screen's effect panel, which this world does not have. What
 * the HUD does instead is FADE the icon when the effect is nearly out.
 * ------------------------------------------------------------------ */

const EFFECT_CELL = 24
const EFFECT_ICON = 18
const EFFECT_INSET = 3
const EFFECT_PITCH = 25   // 24 plus a one-pixel gap
const EFFECT_ROW_PITCH = 26
const EFFECT_TOP = 1

/**
 * Vanilla's blink, verbatim from Gui.renderEffects, and it is an ALPHA on the
 * icon rather than flashing text:
 *
 *   int n = 10 - m / 20;
 *   f = clamp(m / 10.0F / 5.0F * 0.5F, 0, 0.5F)
 *       + cos(m * PI / 5.0F) * clamp(n / 10.0F * 0.25F, 0, 0.25F);
 *
 * Two halves doing two jobs. The first term is a BASELINE that sags from 0.5
 * toward 0 as the duration runs out, so the icon dims overall. The second is a
 * cosine on a 10-tick period whose AMPLITUDE grows from nothing to 0.25 as the
 * effect nears its end, so the pulse gets stronger exactly when it matters.
 * Writing this as a simple on/off blink loses the second property, which is
 * the one that makes a nearly-expired effect read as urgent.
 *
 * @param ticks  duration remaining. Above 200 there is no blink at all.
 */
export function effectAlpha(ticks) {
  if (ticks > 200 || ticks < 0) return 1
  const n = 10 - ticks / 20
  const a = Math.min(0.5, Math.max(0, (ticks / 10 / 5) * 0.5)) +
    Math.cos((ticks * Math.PI) / 5) * Math.min(0.25, Math.max(0, (n / 10) * 0.25))
  return Math.min(1, Math.max(0, a))
}

const EFFECT_ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']

/**
 * The effect row, rebuilt on change and repainted for the blink every tick.
 *
 * TWO SEPARATE CADENCES, and that split is the point. The cells are torn down
 * and rebuilt only when the SET of effects changes -- which is rare -- while
 * the alpha is written every frame, which is a style assignment on an element
 * that already exists. Rebuilding the DOM at 30 Hz to animate an opacity is
 * the version that works and quietly costs a frame.
 *
 * NO ICON ART EXISTS IN THIS WORLD. Vanilla blits `mob_effect/<name>.png`, 39
 * sprites that scripts/build-textures.mjs does not extract -- and that script
 * is owned by another agent this pass. So the 18x18 is filled with the
 * effect's OWN COLOUR, which is real data from MobEffects.java rather than
 * invented art, plus the roman numeral for level II and up. The numeral is a
 * deliberate departure: vanilla puts it in the inventory panel and not on the
 * HUD, and without either a sprite or a numeral three coloured squares are
 * unreadable. It comes out the moment the sprites land.
 */
function effectRows(container, effects, noa) {
  const rows = [
    Object.assign(document.createElement('div'), { className: 'effect-row' }),
    Object.assign(document.createElement('div'), { className: 'effect-row' }),
  ]
  rows[1].style.marginTop = px(EFFECT_ROW_PITCH - EFFECT_CELL)
  container.style.top = px(EFFECT_TOP)
  container.style.right = px(EFFECT_TOP)
  container.append(...rows)

  /* Live cells, so the per-frame alpha write does not have to re-query. */
  let cells = []

  function rebuild() {
    for (const row of rows) row.textContent = ''
    cells = []
    for (const inst of effects.active(noa.playerEntity)) {
      if (inst.hidden) continue
      const cell = document.createElement('div')
      cell.className = 'effect-cell'
      cell.dataset.effect = inst.key
      cell.style.width = px(EFFECT_CELL)
      cell.style.height = px(EFFECT_CELL)
      // The one-pixel gap between cells, which is the 25 pitch minus the 24
      // sprite. On the row-reverse axis this is the LEFT margin.
      cell.style.marginLeft = px(EFFECT_PITCH - EFFECT_CELL)

      const icon = document.createElement('div')
      icon.className = 'effect-icon'
      icon.style.left = icon.style.top = px(EFFECT_INSET)
      icon.style.width = icon.style.height = px(EFFECT_ICON)
      icon.style.background = `#${inst.def.color.toString(16).padStart(6, '0')}`
      cell.appendChild(icon)

      if (inst.amplifier > 0) {
        const lv = document.createElement('span')
        lv.className = 'effect-level'
        lv.style.fontSize = `${FONT_PX * 0.75}px`
        lv.textContent = EFFECT_ROMAN[inst.amplifier] ?? String(inst.amplifier + 1)
        cell.appendChild(lv)
      }

      // isBeneficial, not `!== HARMFUL`: see the header.
      rows[inst.def.category === 'beneficial' ? 0 : 1].appendChild(cell)
      cells.push({ icon, inst })
    }
  }

  effects.onChange(rebuild)
  rebuild()

  noa.on('tick', () => {
    for (const { icon, inst } of cells) {
      icon.style.opacity = inst.ticks < 0 ? '1' : effectAlpha(inst.ticks)
    }
  })

  /** For the specs: how many icons are drawn, and in which row. */
  return {
    get count() { return cells.length },
    get keys() { return cells.map(c => c.inst.key) },
    rowKeys: (i) => [...rows[i].children].map(el => el.dataset.effect),
  }
}

export function installHUD(noa, { inventory, survival, effects = null }) {
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

  const hearts = iconRow(heartsEl, MAX_HEALTH / 2, 'heart', false, true)
  // Minecraft fills the food bar from the right edge inward.
  const food = iconRow(hungerEl, MAX_FOOD / 2, 'food', true)

  /* Effects, if anything wired them. Optional so hud.js still installs in a
     world built before effects.js existed -- which is what a bisect boots. */
  const effectRow = effects
    ? effectRows(document.getElementById('effects'), effects, noa)
    : null

  const xpBg = document.getElementById('xp-bar')
  xpBg.style.width = px(HOTBAR_W)
  xpBg.style.height = px(5)
  xpBg.style.backgroundImage = 'url(/ui/xp_bg.png)'
  const xpFill = document.getElementById('xp-fill')
  xpFill.style.height = px(5)
  xpFill.style.backgroundImage = 'url(/ui/xp_fill.png)'
  xpFill.style.backgroundSize = `${HOTBAR_W * SCALE}px ${5 * SCALE}px`
  const xpLevel = document.getElementById('xp-level')

  const paintAir = airRow(hud)

  /*
   * REGEN: vanilla's travelling bob (`if (i6 == l2) j4 -= 2`, where l2 is
   * `updateCounter % ceil(maxHealth + 5)` -- 25 ticks for 20 health) is gated
   * on `isPotionActive(Potion.regeneration)`, the POTION, not on healing. This
   * world has no effects system, so wiring the wave to survival.js's food
   * regen would be a bob vanilla never shows. Left out rather than
   * approximated; it is four lines the day effects exist.
   */
  const animateHearts = heartAnimation(hearts)
  /*
   * Per FRAME, with the tick number re-derived from the wall clock rather
   * than counted. Both halves of that are deliberate.
   *
   * Per frame because that is where vanilla does it -- renderPlayerStats is
   * called from the HUD render, not from the game tick, and it reads
   * updateCounter rather than advancing it. On noa's 30 Hz 'tick' instead, the
   * flash arrived up to a tick late and, worse, paints landed in bursts
   * whenever the render loop fell behind: the first pulse measured 290 ms in
   * from a hit rather than Minecraft's 150.
   *
   * Derived from the clock because counting handler calls would run the whole
   * animation at whatever rate this machine happens to render at, which is the
   * kind of thing that looks fine on the machine it was written on.
   */
  const bootedAt = performance.now()
  let health = MAX_HEALTH
  noa.on('beforeRender', () => {
    const now = performance.now()
    animateHearts(health, Math.floor((now - bootedAt) / TICK_MS), now)
  })

  survival.onChange((s) => {
    paintAir(s.air)
    health = s.health
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

  /*
   * The effect row, for the specs. A screenshot proves the icons LOOK right
   * and cannot prove which row a neutral effect landed in, because both rows
   * are coloured squares -- so the split that is easy to get wrong is the one
   * thing exposed as data rather than left to a pixel assertion.
   */
  return { effects: effectRow }
}
