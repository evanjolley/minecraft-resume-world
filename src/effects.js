import { MC } from './physics.js'
import { everyBody } from './entityBox.js'

/*
 * STATUS EFFECTS.
 *
 * Wave one of potions, and deliberately the half with no potions in it.
 *
 * Everything in brewing depends on effects existing and nothing about effects
 * depends on brewing, so this is the layer that can be built, measured and
 * trusted on its own. Vanilla makes the same split: `/effect give` exists
 * precisely so that an effect can be handed out with no item involved, and
 * `MobEffectInstance` knows nothing about a bottle. A splash potion is then a
 * thrown entity that calls into THIS, which is a wave-two file.
 *
 * WHAT AN EFFECT IS, here and in vanilla: a registry entry (an id, a colour, a
 * category) plus a per-entity INSTANCE (an amplifier and a remaining duration).
 * The registry is data and lives at the top; the instance is state and lives in
 * `live`, keyed by entity. Nothing in this file stores a number that belongs to
 * a specific player, which is what lets the same code run Evan.
 *
 * ---------------------------------------------------------------------------
 * THE CLOCK IS THE WHOLE DESIGN PROBLEM.
 *
 * Minecraft counts effect durations in ticks and every interval rule in the
 * game is stated as a MODULO on that integer counter:
 *
 *   regeneration   i = 50 >> amplifier;  fires when duration % i == 0
 *   poison         i = 25 >> amplifier
 *   wither         i = 40 >> amplifier
 *
 * Those shifts are why Regeneration II heals twice as fast as Regeneration I,
 * and why Poison II is exactly 12 ticks apart rather than "a bit quicker". A
 * float seconds countdown with a `>= interval` timer reproduces the average
 * and not the number: 50 >> 1 is 25 and 50 / 2 is 25.0, which agree, but
 * 25 >> 2 is 6 and 25 / 4 is 6.25, which do not, and Poison III is the level
 * where a timer starts drifting a tick per hit away from the game.
 *
 * So this file keeps a real integer tick counter and steps it in whole ticks,
 * accumulating noa's variable dt. noa ticks at 30 Hz and Minecraft at 20, and
 * the two rates never meet anywhere in here: dt goes into `carry`, whole
 * MC.TICK_MS slices come out, and every rule below is written against the
 * integer.
 *
 * Rejected: driving this off noa's tick count directly and scaling the
 * durations by 30/20. It is one multiplication and it destroys the modulo --
 * `duration % 6` against a counter that advances 1.5 times per game tick skips
 * hits at random, which reads as poison that sometimes stutters.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE DOES NOT OWN.
 *
 * It does not apply damage, heal, or read health. It asks a VITALS adapter,
 * registered per entity, because survival.js owns the player's health and has
 * "the one gate" in it for creative invulnerability and the fallDamage rule.
 * Poison routing around that gate would poison a creative player, which is a
 * bug you would not find for months. An entity with no vitals registered still
 * gets movement, particles and the HUD -- the health effects simply have
 * nobody to talk to, which is the correct answer for a body that has no health
 * rather than an error.
 */

/* ------------------------------------------------------------------ *
 * The registry.
 * ------------------------------------------------------------------ */

/*
 * Vanilla's three categories. They are not decoration: the HUD sorts
 * beneficial icons above harmful ones, milk-like effects care about it, and
 * the day a beacon exists it filters on it.
 */
export const BENEFICIAL = 'beneficial'
export const HARMFUL = 'harmful'
export const NEUTRAL = 'neutral'

/*
 * THE HUD SPLITS ON BENEFICIAL, NOT ON "NOT HARMFUL", and that is a real trap.
 *
 * Gui.renderEffects keeps two counters and chooses between them with
 * `holder.value().isBeneficial()`, which is `category == BENEFICIAL` and
 * nothing else. So Glowing, Bad Omen, Trial Omen and Raid Omen -- all NEUTRAL
 * -- are drawn in the SECOND row, next to Poison and Wither. A three-way split
 * or a `category !== HARMFUL` test both look more sensible and both put them
 * in the wrong row.
 */
export const isBeneficial = (def) => def.category === BENEFICIAL

/*
 * COLOUR IS DATA FROM MOJANG, not a palette choice.
 *
 * Each of these is the literal int handed to the MobEffect constructor in
 * MobEffects.java, which is what tints the swirl particles and (in vanilla)
 * the potion bottle. They are written as hex because that is how they read in
 * the source; `0x33EBFF` is speed's 3402751.
 *
 * SIX OF THESE WERE WRONG FROM MEMORY before they were fetched, and the six
 * are worth naming because they are the ones everyone has a stale picture of:
 * Speed is a bright cyan and not a dusty blue, Strength is GOLD and not the
 * red the 1.8 potion was, Poison is a pale olive and not the vivid green,
 * Wither is a warm grey-brown and not near-black, Slow Falling is pink-cream,
 * and Luck is a lighter green. Anything that "looks about right" in this table
 * is the thing to distrust.
 *
 * Getting one wrong is invisible in code review and obvious on screen, so they
 * are transcribed rather than remembered -- see the report for which mirror.
 */

/**
 * Every vanilla effect, in registry order. `id` is the numeric id, which is
 * what a future potion NBT and a future network packet will both speak in;
 * `key` is what `/effect give` takes.
 *
 * `name` is vanilla's en_us string, because a HUD tooltip that says
 * "Instant Health" and a command that prints "Applied effect Instant Health"
 * have to agree and there is exactly one place to get that from.
 */
export const EFFECTS = [
  { id: 1,  key: 'speed',               name: 'Speed',                 category: BENEFICIAL, color: 0x33EBFF },
  { id: 2,  key: 'slowness',            name: 'Slowness',              category: HARMFUL,    color: 0x8BAFE0 },
  { id: 3,  key: 'haste',               name: 'Haste',                 category: BENEFICIAL, color: 0xD9C043 },
  { id: 4,  key: 'mining_fatigue',      name: 'Mining Fatigue',        category: HARMFUL,    color: 0x4A4217 },
  { id: 5,  key: 'strength',            name: 'Strength',              category: BENEFICIAL, color: 0xFFC700 },
  { id: 6,  key: 'instant_health',      name: 'Instant Health',        category: BENEFICIAL, color: 0xF82423, instant: true },
  { id: 7,  key: 'instant_damage',      name: 'Instant Damage',        category: HARMFUL,    color: 0xA9656A, instant: true },
  { id: 8,  key: 'jump_boost',          name: 'Jump Boost',            category: BENEFICIAL, color: 0xFDFF84 },
  { id: 9,  key: 'nausea',              name: 'Nausea',                category: HARMFUL,    color: 0x551D4A },
  { id: 10, key: 'regeneration',        name: 'Regeneration',          category: BENEFICIAL, color: 0xCD5CAB },
  { id: 11, key: 'resistance',          name: 'Resistance',            category: BENEFICIAL, color: 0x9146F0 },
  { id: 12, key: 'fire_resistance',     name: 'Fire Resistance',       category: BENEFICIAL, color: 0xFF9900 },
  { id: 13, key: 'water_breathing',     name: 'Water Breathing',       category: BENEFICIAL, color: 0x98DAC0 },
  { id: 14, key: 'invisibility',        name: 'Invisibility',          category: BENEFICIAL, color: 0xF6F6F6 },
  { id: 15, key: 'blindness',           name: 'Blindness',             category: HARMFUL,    color: 0x1F1F23 },
  { id: 16, key: 'night_vision',        name: 'Night Vision',          category: BENEFICIAL, color: 0xC2FF66 },
  { id: 17, key: 'hunger',              name: 'Hunger',                category: HARMFUL,    color: 0x587653 },
  { id: 18, key: 'weakness',            name: 'Weakness',              category: HARMFUL,    color: 0x484D48 },
  { id: 19, key: 'poison',              name: 'Poison',                category: HARMFUL,    color: 0x87A363 },
  { id: 20, key: 'wither',              name: 'Wither',                category: HARMFUL,    color: 0x736156 },
  { id: 21, key: 'health_boost',        name: 'Health Boost',          category: BENEFICIAL, color: 0xF87D23 },
  { id: 22, key: 'absorption',          name: 'Absorption',            category: BENEFICIAL, color: 0x2552A5 },
  { id: 23, key: 'saturation',          name: 'Saturation',            category: BENEFICIAL, color: 0xF82423, instant: true },
  { id: 24, key: 'glowing',             name: 'Glowing',               category: NEUTRAL,    color: 0x94A061 },
  { id: 25, key: 'levitation',          name: 'Levitation',            category: HARMFUL,    color: 0xCEFFFF },
  { id: 26, key: 'luck',                name: 'Luck',                  category: BENEFICIAL, color: 0x59C106 },
  { id: 27, key: 'unluck',              name: 'Bad Luck',              category: HARMFUL,    color: 0xC0A44D },
  { id: 28, key: 'slow_falling',        name: 'Slow Falling',          category: BENEFICIAL, color: 0xF3CFB9 },
  { id: 29, key: 'conduit_power',       name: 'Conduit Power',         category: BENEFICIAL, color: 0x1DC2D1 },
  { id: 30, key: 'dolphins_grace',      name: "Dolphin's Grace",       category: BENEFICIAL, color: 0x88A3BE },
  { id: 31, key: 'bad_omen',            name: 'Bad Omen',              category: NEUTRAL,    color: 0x0B6138 },
  { id: 32, key: 'hero_of_the_village', name: 'Hero of the Village',   category: BENEFICIAL, color: 0x44FF44 },
  { id: 33, key: 'darkness',            name: 'Darkness',              category: HARMFUL,    color: 0x292721 },
  { id: 34, key: 'trial_omen',          name: 'Trial Omen',            category: NEUTRAL,    color: 0x16A6A6 },
  { id: 35, key: 'raid_omen',           name: 'Raid Omen',             category: NEUTRAL,    color: 0xDE4058 },
  { id: 36, key: 'wind_charged',        name: 'Wind Charged',          category: HARMFUL,    color: 0xBDC9FF },
  { id: 37, key: 'weaving',             name: 'Weaving',               category: HARMFUL,    color: 0x78695A },
  { id: 38, key: 'oozing',              name: 'Oozing',                category: HARMFUL,    color: 0x99FFA3 },
  { id: 39, key: 'infested',            name: 'Infested',              category: HARMFUL,    color: 0x8C9B8C },
]

export const EFFECT_BY_KEY = new Map(EFFECTS.map(e => [e.key, e]))
export const EFFECT_BY_ID = new Map(EFFECTS.map(e => [e.id, e]))

/*
 * `/effect give` with no duration. Vanilla's EffectCommand defaults to 30
 * seconds for a timed effect, and -1 is its sentinel for `infinite`.
 */
export const DEFAULT_SECONDS = 30
export const INFINITE = -1
/* Vanilla clamps the seconds argument to 1_000_000, which is ~11.5 days. */
export const MAX_SECONDS = 1000000

/* ------------------------------------------------------------------ *
 * The numbers each effect is made of.
 *
 * These are split out from the registry because the registry is a TABLE and
 * these are FORMULAS. Keeping `0.20` next to `speed` in the row above would
 * read fine and would have nowhere to put the two different things Strength
 * and Resistance do with their amplifier.
 * ------------------------------------------------------------------ */

/*
 * Movement speed, as a MULTIPLIER on whatever physics.js decided you were
 * doing -- walking, sprinting, sneaking, swimming.
 *
 * Vanilla hangs an attribute modifier on `minecraft:movement_speed` with
 * operation ADD_MULTIPLIED_TOTAL and amount 0.2 per level for Speed, -0.15 per
 * level for Slowness. ADD_MULTIPLIED_TOTAL is the one that multiplies the
 * running total at the end, which is why it composes with sprinting rather
 * than replacing it: sprinting is its own 1.3x further down the same pipeline,
 * so Speed I while sprinting is 5.612 * 1.2 and not 4.317 * 1.2 * 1.3.
 *
 * This world has no attribute system -- physics.js assigns `move.maxSpeed` an
 * absolute number every tick from MC.WALK_SPEED and friends. A multiplier
 * applied to that assignment is exactly ADD_MULTIPLIED_TOTAL with one modifier
 * in the bucket, which is the only case that exists here. The day a second
 * source of movement speed appears (soul speed, a beacon) they multiply, which
 * is also what vanilla does for two ADD_MULTIPLIED_TOTAL modifiers.
 *
 * SLOWNESS CANNOT GO NEGATIVE. At Slowness VII (amplifier 6) the naive sum is
 * 1 - 0.15*7 = -0.05, and vanilla clamps the attribute at its minimum of 0
 * rather than walking you backwards. Slowness VI is the level that pins you.
 */
const SPEED_PER_LEVEL = 0.20
const SLOWNESS_PER_LEVEL = -0.15

/*
 * Jump Boost, as a multiplier on the launch VELOCITY.
 *
 * LivingEntity.getJumpPower adds `0.1F * (amplifier + 1)` to the 0.42
 * blocks/tick base, so Jump Boost I launches at 0.52 -- a velocity ratio of
 * 0.52 / 0.42 = 1.238. Height goes as v^2, so the apex is 1.533x
 * MC.JUMP_APEX, which is 1.919 blocks. That is the number that matters: it is
 * why Jump Boost I clears a two-block step and Jump Boost II clears three.
 *
 * MULTIPLIER, NOT A REPLACEMENT, and this is the rule physics.js's header
 * asks for in so many words. JUMP_IMPULSE is 9.585 and is NOT sqrt(2gh): it
 * was binary-searched in a browser against noa applying a full step of gravity
 * on the launch tick. Anything that recomputed a jump impulse from an apex
 * would throw that calibration away and be wrong by the same few percent every
 * time. Scaling it keeps the calibration and scales the outcome.
 *
 * Negative amplifiers are real -- vanilla's /effect accepts them and Jump
 * Boost with amplifier -1 gives 0.42 - 0.1 = 0.32, a shorter jump -- so this
 * is written as arithmetic rather than as a lookup, and clamped at zero so a
 * deep negative cannot produce an imaginary jump.
 */
const JUMP_TICK_BASE = 0.42
const JUMP_PER_LEVEL = 0.1

/*
 * Resistance. LivingEntity.getDamageAfterMagicAbsorb, verbatim:
 *
 *   int i = (effect.getAmplifier() + 1) * 5;
 *   int j = 25 - i;
 *   float f = amount * j;
 *   amount = Math.max(f / 25.0F, 0.0F);
 *
 * So each level is 20% off, and Resistance V (amplifier 4) is total immunity
 * -- which is why vanilla's potions stop at Resistance II and the higher
 * levels are command-only. The max() is what stops Resistance VI from HEALING
 * you, which the arithmetic would otherwise do.
 */
const RESISTANCE_PER_LEVEL = 5
const RESISTANCE_SCALE = 25

/*
 * Strength and Weakness, on the damage you DEAL.
 *
 * Both are flat, in half-hearts, added to the attack rather than multiplied:
 * ATTACK_DAMAGE with operation ADD_VALUE, +3 per level for Strength and -4 per
 * level for Weakness. They were multiplicative long ago (Strength was +130%
 * in 1.8) and the 1.8 numbers are the ones everybody remembers, which is
 * exactly why they are transcribed here from a 1.21 mirror instead.
 */
const STRENGTH_PER_LEVEL = 3
const WEAKNESS_PER_LEVEL = -4

/*
 * The ticking effects, as vanilla's shift expressions.
 *
 * THE SHIFT IS THE POINT. `50 >> amplifier` halves the interval per level and
 * FLOORS, so Regeneration III is 50 >> 2 = 12 ticks and not 12.5. Once the
 * shift reaches zero -- Regeneration at amplifier 6, Poison at 5 -- vanilla's
 * guard `i > 0 ? duration % i == 0 : true` fires on EVERY tick, which is how
 * Poison VI kills a full-health player in a second.
 */
const REGEN_INTERVAL = 50
const POISON_INTERVAL = 25
const WITHER_INTERVAL = 40

/*
 * Instant health and instant damage, both `<< amplifier` -- they DOUBLE per
 * level rather than adding, which is why Instant Damage II is 12 half-hearts
 * and takes a full-health unarmoured player from 20 to 8.
 */
const INSTANT_HEALTH_BASE = 4
const INSTANT_DAMAGE_BASE = 6

/* Absorption grants 4 half-hearts -- two hearts -- per level. */
const ABSORPTION_PER_LEVEL = 4
/* Health Boost raises MAX health by 4 half-hearts per level. */
const HEALTH_BOOST_PER_LEVEL = 4

/*
 * Levitation, from LivingEntity.travel:
 *   deltaY += (0.05 * (amplifier + 1) - deltaY) * 0.2
 * an exponential approach to 0.05*(level) blocks/tick upward, which is 1 b/s
 * per level. Written per-second here because noa's body velocity is per-second
 * and the 0.2 is resampled at the use site.
 */
const LEVITATION_SPEED_PER_LEVEL = 0.05 * MC.TICKS_PER_SECOND  // 1 block/s

/*
 * Slow Falling replaces gravity with 0.01 blocks/tick^2 against the usual
 * 0.08 -- one eighth. In 1.21 this is an attribute (`minecraft:gravity`,
 * ADD_VALUE -0.07); as a ratio it is the same number and a ratio is what noa
 * takes, since a body carries `gravityMultiplier` rather than its own g.
 */
const SLOW_FALLING_GRAVITY = 0.01 / 0.08

/*
 * Jump Boost's OTHER half: +1 block of safe fall distance per level, as an
 * ADD_VALUE modifier on `minecraft:safe_fall_distance` over its 3.0 default.
 * Separate from the jump height, which is the hardcoded addend above.
 */
const JUMP_SAFE_FALL_PER_LEVEL = 1

/* Haste and Mining Fatigue, on dig speed. +20% and -30% per level, the latter
 * multiplicative and clamped at four levels in vanilla's own formula. */
const HASTE_PER_LEVEL = 0.20
const MINING_FATIGUE_FACTOR = 0.3

/* ------------------------------------------------------------------ *
 * The manager.
 * ------------------------------------------------------------------ */

/**
 * @param vitalsFor  entity id -> a health adapter, or null. See the header:
 *   this file never touches health directly, so that survival.js's one gate
 *   keeps being the only place creative invulnerability is decided.
 */
export function createEffects(noa, { vitalsFor = () => null } = {}) {
  /*
   * entity id -> Map(effect key -> instance).
   *
   * A Map of Maps rather than an array of {entity, key, ...} rows, because
   * every hot question here is "does THIS entity have THIS effect" -- the
   * movement multiplier asks it twice a tick, the damage path asks it on every
   * hit -- and a row scan would be a linear search under all of them.
   *
   * KEYED BY ENTITY ID, which is what makes Evan work for free. noa recycles
   * ids when entities are destroyed, so `prune` below drops entries for bodies
   * that no longer exist rather than letting a dead id's poison land on
   * whatever is issued that number next.
   */
  const live = new Map()

  /** Instances that expired or were cleared this tick, for the HUD and sounds. */
  const listeners = new Set()
  const notify = () => { for (const fn of listeners) fn() }

  /*
   * The integer tick counter, and the accumulator that feeds it. See the
   * header: every interval rule below is a modulo on `ticks`, so this has to
   * be a whole number that advances exactly 20 times a second regardless of
   * what noa's dt did.
   */
  let carry = 0

  const mapFor = (entity) => {
    let m = live.get(entity)
    if (!m) { m = new Map(); live.set(entity, m) }
    return m
  }

  /**
   * MobEffectInstance.update's rule, and it is not "the new one wins".
   *
   * Vanilla replaces the existing instance only if the incoming one is
   * STRICTLY BETTER: a higher amplifier always wins, an equal amplifier wins
   * only if it lasts longer. So drinking a Swiftness I on top of thirty
   * seconds of Swiftness II does nothing at all, which is the behaviour every
   * player relies on and the one a naive `set()` would break.
   *
   * Rejected: vanilla's full `hiddenEffect` chain, where the weaker instance
   * is stashed and RESTORED when the stronger one expires. It is genuinely the
   * rule -- Speed II for 10s over Speed I for 5 minutes leaves you with 4m50s
   * of Speed I -- and it is a linked list of instances per effect for a case
   * nothing in this world can produce yet, since only /effect grants anything.
   * Recorded so that wave two adds it where it belongs, which is the moment
   * two potions can overlap.
   */
  const stronger = (next, prev) =>
    next.amplifier > prev.amplifier ||
    (next.amplifier === prev.amplifier && durationOf(next) > durationOf(prev))

  const durationOf = (i) => (i.ticks === INFINITE ? Infinity : i.ticks)

  /**
   * Hand an entity an effect.
   *
   * @param seconds    INFINITE for vanilla's `infinite`, which stores -1 and
   *   never counts down. Stored as the sentinel rather than as a huge number
   *   so the HUD can print the infinity symbol instead of "11:34:00".
   * @param hidden     vanilla's `hideParticles`: no swirl, no HUD icon.
   * @returns {boolean} whether anything changed, which is what /effect prints.
   */
  function give(entity, key, seconds = DEFAULT_SECONDS, amplifier = 0, hidden = false) {
    const def = EFFECT_BY_KEY.get(key)
    if (!def) return false

    /*
     * INSTANT EFFECTS ARE NOT STORED. Vanilla's InstantenousMobEffect returns
     * true from `isInstantenous` and is applied once at the moment it lands,
     * never entering the active list -- which is why an instant health potion
     * has no HUD icon and no duration. Storing it with a 1-tick duration is
     * the obvious shortcut and it would flash an icon for a frame and heal on
     * a tick boundary rather than immediately.
     */
    if (def.instant) {
      applyInstant(entity, def, amplifier)
      return true
    }

    const ticks = seconds === INFINITE
      ? INFINITE
      : Math.max(1, Math.round(seconds * MC.TICKS_PER_SECOND))
    const next = { key, amplifier, ticks, hidden, def }
    const m = mapFor(entity)
    const prev = m.get(key)
    if (prev && !stronger(next, prev)) return false
    m.set(key, next)
    onApplied(entity, def, amplifier)
    notify()
    return true
  }

  /**
   * @param key  omitted clears everything, which is what milk does and what
   *   `/effect clear <targets>` does.
   * @returns {number} how many were removed -- /effect clear reports it.
   */
  function clear(entity, key = null) {
    const m = live.get(entity)
    if (!m || m.size === 0) return 0
    if (key === null) {
      const n = m.size
      for (const inst of m.values()) onRemoved(entity, inst)
      m.clear()
      notify()
      return n
    }
    const inst = m.get(key)
    if (!inst) return 0
    onRemoved(entity, inst)
    m.delete(key)
    notify()
    return 1
  }

  /**
   * Every live instance on an entity, in the order the HUD draws them.
   *
   * Vanilla sorts with `Ordering.natural().reverse()` over
   * MobEffectInstance.compareTo, which ranks on (ambient first), then
   * (infinite), then (duration), then (the colour int) -- reversed, so the
   * LONGEST-remaining effect is drawn leftmost and a nearly-expired one sits
   * out on the right where it is about to disappear. Sorting by registry id
   * instead reads fine and makes the icons jump when one expires, because the
   * whole row re-packs rather than losing its last cell.
   *
   * The row split is the caller's job -- see isBeneficial.
   */
  function active(entity) {
    const m = live.get(entity)
    if (!m) return []
    return [...m.values()].sort((a, b) =>
      durationOf(b) - durationOf(a) || b.def.color - a.def.color)
  }

  const instance = (entity, key) => live.get(entity)?.get(key) ?? null
  const has = (entity, key) => live.get(entity)?.has(key) ?? false
  /** Vanilla's display level: amplifier 0 is "I". Returns 0 when absent, so
   *  `level * PER_LEVEL` is the multiplier arithmetic with no branch. */
  const level = (entity, key) => {
    const i = instance(entity, key)
    return i ? i.amplifier + 1 : 0
  }

  /* ---------------- what each effect actually does ---------------- */

  /*
   * ONE-SHOT EFFECTS, applied at the moment the instance lands rather than on
   * a tick. Absorption and Health Boost are both in here and they are NOT the
   * same thing, which is the classic confusion:
   *
   *   Absorption  ADDS a temporary pool of yellow hearts on TOP of your 20.
   *               Damage eats them first. They do not regenerate and they
   *               vanish when the effect ends, whatever is left of them.
   *   Health Boost RAISES your maximum to 20 + 4*level. It grants no health --
   *               you are 20/24 until something heals you -- and when it ends
   *               your current health is clamped back down.
   *
   * Re-application has to be idempotent-ish rather than cumulative: vanilla
   * removes the old modifier before adding the new one, so Absorption II on
   * top of Absorption I is 8 hearts and not 12. `prev` is passed in for
   * exactly that subtraction.
   */
  function onApplied(entity, def, amplifier) {
    const v = vitalsFor(entity)
    if (!v) return
    if (def.key === 'absorption') {
      /*
       * MAX, not a sum, and not a replacement. AbsorptionMobEffect's whole
       * body is
       *   setAbsorptionAmount(max(getAbsorptionAmount(), 4 * (1 + i)))
       * so Absorption II landing on a half-eaten Absorption I shield tops it
       * up to 8 and never DOWN to 8 -- and re-applying the same level on a
       * shield you have already spent does not refill it, because the old
       * value is smaller and the new one wins. A subtract-the-old-add-the-new
       * scheme (which is what an attribute modifier would do) gets the
       * refill case wrong in the direction the player notices.
       */
      v.setAbsorption?.(Math.max(v.absorption ?? 0,
        ABSORPTION_PER_LEVEL * (amplifier + 1)))
    }
    if (def.key === 'health_boost') {
      v.setBonusMaxHealth?.(HEALTH_BOOST_PER_LEVEL * (amplifier + 1))
    }
  }

  function onRemoved(entity, inst) {
    const v = vitalsFor(entity)
    if (!v) return
    if (inst.key === 'absorption') v.setAbsorption?.(0)
    if (inst.key === 'health_boost') v.setBonusMaxHealth?.(0)
  }

  /*
   * Instant health and instant damage. `4 << amplifier` and `6 << amplifier`
   * -- a SHIFT, so each level doubles.
   *
   * NOT reproduced: the undead inversion, where instant health hurts a zombie
   * and instant damage heals it. It is real and it is a property of the mob,
   * and this world has one NPC who is a person. The hook is `v.undead`, unset
   * everywhere, so the day a zombie exists it is a flag rather than a rewrite.
   */
  function applyInstant(entity, def, amplifier) {
    const v = vitalsFor(entity)
    if (!v) return
    if (def.key === 'saturation') { v.feed?.(amplifier + 1); return }
    const heal = def.key === 'instant_health'
    const amount = (heal ? INSTANT_HEALTH_BASE : INSTANT_DAMAGE_BASE) * (2 ** Math.max(0, amplifier))
    if (heal === !v.undead) v.heal(amount)
    else v.damage(amount, 'magic')
  }

  /*
   * THE TICKING EFFECTS, on vanilla's modulo.
   *
   * `duration % i === 0` is tested against the REMAINING duration, counting
   * down, which is what makes the first hit land a fraction of a second after
   * the effect is applied rather than immediately.
   */
  function tickEffect(entity, inst, remaining) {
    const v = vitalsFor(entity)
    if (!v) return
    const amp = inst.amplifier
    switch (inst.key) {
      case 'regeneration': {
        const i = REGEN_INTERVAL >> Math.max(0, amp)
        // The `health < maxHealth` guard is vanilla's and is not redundant:
        // heal() clamps anyway, but the guard is what stops a full-health
        // player firing the heal particle and the stat every 50 ticks.
        if ((i > 0 ? remaining % i === 0 : true) && v.health < v.maxHealth) v.heal(1)
        break
      }
      case 'poison': {
        const i = POISON_INTERVAL >> Math.max(0, amp)
        if (i > 0 ? remaining % i === 0 : true) {
          /*
           * POISON CANNOT KILL. Vanilla's guard is literally
           * `if (entity.getHealth() > 1.0F)`, so it stops at half a heart --
           * which is why a cave spider is terrifying and not lethal, and why
           * "poison damage" in a death message does not exist. Wither has no
           * such guard and that asymmetry is the whole difference between the
           * two effects.
           */
          if (v.health > 1) v.damage(1, 'magic')
        }
        break
      }
      case 'wither': {
        const i = WITHER_INTERVAL >> Math.max(0, amp)
        if (i > 0 ? remaining % i === 0 : true) v.damage(1, 'wither')
        break
      }
      case 'hunger':
        // Vanilla adds 0.005 * (amplifier+1) exhaustion per tick. This world
        // runs with hunger drain switched off by design (survival.js says
        // why), so the call is made and survival decides.
        v.exhaust?.(0.005 * (amp + 1))
        break
      case 'saturation':
        v.feed?.(amp + 1)
        break
    }
  }

  /* ---------------- the queries other files ask ---------------- */

  /**
   * Movement speed multiplier. physics.js multiplies whatever it decided
   * `move.maxSpeed` should be by this, which is ADD_MULTIPLIED_TOTAL -- see
   * SPEED_PER_LEVEL for why that composes correctly with sprinting.
   */
  function speedMultiplier(entity) {
    const s = level(entity, 'speed') * SPEED_PER_LEVEL
    const w = level(entity, 'slowness') * SLOWNESS_PER_LEVEL
    // Clamped at zero: Slowness VII sums below -1, and vanilla's attribute
    // floor pins you in place rather than reversing you.
    return Math.max(0, 1 + s + w)
  }

  /** Jump launch-velocity multiplier. See JUMP_PER_LEVEL. */
  function jumpMultiplier(entity) {
    const lv = level(entity, 'jump_boost')
    if (lv === 0) return 1
    return Math.max(0, (JUMP_TICK_BASE + JUMP_PER_LEVEL * lv) / JUMP_TICK_BASE)
  }

  /**
   * How far you may fall unhurt, in blocks.
   *
   * SEPARATE FROM THE JUMP HEIGHT, and it surprised me too. In 1.21 Jump Boost
   * hangs a `minecraft:safe_fall_distance` modifier of +1.0 per level on top of
   * the 3.0 default -- it is not a consequence of jumping higher, it is its own
   * modifier, which is why Jump Boost stops you hurting yourself on the way
   * down from the jump it just gave you. survival.js reads this instead of
   * MC.FALL_SAFE_BLOCKS.
   */
  const safeFallBlocks = (entity) =>
    MC.FALL_SAFE_BLOCKS + level(entity, 'jump_boost') * JUMP_SAFE_FALL_PER_LEVEL

  /**
   * Gravity multiplier, for Slow Falling.
   *
   * @param falling  vanilla's `deltaY <= 0` gate. getEffectiveGravity only
   *   swaps in the 0.01 while you are DESCENDING, so Slow Falling does not
   *   float you higher on the way up -- it only softens the way down. A flat
   *   multiplier applied in both directions is the obvious version and it
   *   turns every jump into a moon jump, which is not what the effect does.
   */
  const gravityMultiplier = (entity, falling = true) =>
    falling && has(entity, 'slow_falling') ? SLOW_FALLING_GRAVITY : 1

  /** Upward speed Levitation is pulling toward, blocks/second. 0 when absent. */
  const levitationSpeed = (entity) =>
    level(entity, 'levitation') * LEVITATION_SPEED_PER_LEVEL

  /**
   * Damage TAKEN, after armor.
   *
   * ORDER MATTERS AND IT IS ARMOR FIRST. Vanilla's LivingEntity.actuallyHurt
   * calls getDamageAfterArmorAbsorb and then feeds its result into
   * getDamageAfterMagicAbsorb, which is where Resistance lives. Armor is a
   * subtraction of points scaled by the hit size; Resistance is a flat
   * percentage. Doing Resistance first and armor second gives a DIFFERENT
   * answer, because armor.js's `points - damage / f` term depends on the
   * damage: shrink the hit before armor sees it and armor's points count for
   * proportionally more, so a resisted player in iron takes less than vanilla
   * would give them. See the report for the source that settles it.
   *
   * armor.js stays pure and untouched -- it is still (stacks, damage) ->
   * damage -- and main.js composes the two in the order named here.
   */
  function damageTaken(entity, amount, cause = 'generic') {
    if (amount <= 0) return amount
    if (FIRE_CAUSES.has(cause) && has(entity, 'fire_resistance')) return 0
    const lv = level(entity, 'resistance')
    if (lv === 0) return amount
    const j = RESISTANCE_SCALE - lv * RESISTANCE_PER_LEVEL
    return Math.max(0, (amount * j) / RESISTANCE_SCALE)
  }

  /*
   * What Fire Resistance is resistance to. Vanilla flags these on the damage
   * type (`is_fire`) rather than naming them, which is the better model and
   * would be four files of tags here for four causes. survival.js and
   * fluids.js between them produce exactly these.
   */
  const FIRE_CAUSES = new Set(['onFire', 'lava', 'inFire', 'fireball'])

  /** Damage DEALT, in half-hearts added. Strength and Weakness are flat. */
  const damageBonus = (entity) =>
    level(entity, 'strength') * STRENGTH_PER_LEVEL +
    level(entity, 'weakness') * WEAKNESS_PER_LEVEL

  /**
   * Dig speed multiplier: Haste is +20% per level and Mining Fatigue is a
   * 0.3^level cut, which is why Mining Fatigue III makes a stone block take
   * thirty-seven times as long.
   */
  function digMultiplier(entity) {
    let m = 1 + level(entity, 'haste') * HASTE_PER_LEVEL
    const f = level(entity, 'mining_fatigue')
    if (f > 0) m *= MINING_FATIGUE_FACTOR ** Math.min(f, 4)
    return m
  }

  /** Water Breathing: survival.js asks before it drains a breath. */
  const breathes = (entity) =>
    has(entity, 'water_breathing') || has(entity, 'conduit_power')

  /** Fire Resistance also stops you catching fire at all, not just the damage. */
  const fireproof = (entity) => has(entity, 'fire_resistance')

  /*
   * THE SWIRL COLOUR, AND IT IS NOT A BLEND -- this one changed under us.
   *
   * The remembered rule is `PotionUtils.getColor`: sum each effect's channels
   * weighted by (amplifier + 1), divide by the total weight, emit one blended
   * colour. That was right for years and it is GONE in 1.21.8 --
   * MobEffectUtil no longer has a colour function at all. What replaced it:
   * each instance carries its own ColorParticleOption, the entity syncs the
   * LIST, and LivingEntity.tickEffects picks a uniformly random one per spawn:
   *
   *   int i = this.isInvisible() ? 15 : 4;
   *   int j = allAmbient ? 5 : 1;
   *   if (random.nextInt(i * j) == 0) addParticle(Util.getRandom(list, random), ...)
   *
   * So a player with Poison and Regeneration emits olive and pink particles
   * INTERLEAVED, not a muddy brown average, and the spawn rate does not grow
   * with the number of effects -- it is 1-in-4 per tick either way.
   *
   * Reproducing the average would have been fewer lines and would have been
   * the 1.20 game. The visible difference is exactly the case worth getting
   * right: two effects at once is when you most want to see which two.
   *
   * Hidden instances are excluded, which is what `hideParticles` means.
   * Returns null when there is nothing to draw, so the caller has a cheap
   * "skip this entity" test rather than a black particle.
   */
  function swirlColor(entity) {
    const m = live.get(entity)
    if (!m || m.size === 0) return null
    /* Reservoir sample of size one, so this never allocates an array on a
     * path that runs for every affected entity every frame. */
    let chosen = null, seen = 0
    for (const inst of m.values()) {
      if (inst.hidden) continue
      seen++
      if (Math.random() * seen < 1) chosen = inst
    }
    if (!chosen) return null
    const c = chosen.def.color
    return [((c >> 16) & 0xff) / 255, ((c >> 8) & 0xff) / 255, (c & 0xff) / 255]
  }

  /*
   * Vanilla's swirl spawn chance, as a probability per MINECRAFT tick. The
   * ambient dimming (alpha 38/255 for a beacon's effects) has nothing to grant
   * ambient effects yet, so only the 1-in-4 and the invisible 1-in-15 apply.
   */
  const SWIRL_CHANCE = 1 / 4
  const SWIRL_CHANCE_INVISIBLE = 1 / 15
  const swirlChance = (entity) =>
    has(entity, 'invisibility') ? SWIRL_CHANCE_INVISIBLE : SWIRL_CHANCE

  /* ---------------- the clock ---------------- */

  /*
   * ONE TICK HANDLER FOR EVERY ENTITY, rather than one per entity.
   *
   * The alternative is an effects component on each body, which is noa's own
   * idiom and is what a bigger game would do. It loses on the thing this file
   * exists for: the tick counter has to be shared, because `duration % i` is
   * only meaningful against a clock that advances once per game tick for
   * everyone. Two entities on two accumulators would poison on two different
   * phases, and the bug would look like a rounding error.
   */
  function step() {
    for (const [entity, m] of live) {
      if (m.size === 0) continue
      for (const inst of [...m.values()]) {
        if (inst.ticks !== INFINITE) {
          inst.ticks--
          if (inst.ticks <= 0) {
            onRemoved(entity, inst)
            m.delete(inst.key)
            notify()
            continue
          }
        }
        /*
         * The modulo runs against the remaining duration AFTER the decrement,
         * which is the order vanilla uses (tick() decrements then calls the
         * effect). An off-by-one here shifts every hit by one tick, which is
         * invisible at Regeneration I and a 17% error at Regeneration IV.
         */
        tickEffect(entity, inst, inst.ticks === INFINITE ? 0 : inst.ticks)
      }
    }
  }

  /*
   * Entities that no longer exist, dropped.
   *
   * noa reuses entity ids. An NPC destroyed while poisoned would leave its
   * instances behind under an id that gets handed to the next entity created,
   * and that entity would silently inherit the poison. Cheap because `live` is
   * nearly always one or two entries -- only entities that HAVE an effect are
   * in it at all.
   */
  function prune() {
    if (live.size === 0) return
    const alive = new Set(everyBody(noa))
    for (const entity of live.keys()) {
      if (!alive.has(entity)) live.delete(entity)
    }
  }

  let sincePrune = 0
  noa.on('tick', (dtMs) => {
    carry += dtMs
    /*
     * Capped catch-up. A backgrounded tab hands back a multi-second dt, and
     * replaying four hundred ticks in one frame would run a minute of poison
     * instantly -- which is a death on returning to the tab. Vanilla's server
     * has the same problem and solves it the same way (it skips, it does not
     * catch up). Four ticks is a fifth of a second of slack.
     */
    if (carry > MC.TICK_MS * 4) carry = MC.TICK_MS * 4
    while (carry >= MC.TICK_MS) {
      carry -= MC.TICK_MS
      step()
    }
    sincePrune += dtMs
    if (sincePrune > 1000) { sincePrune = 0; prune() }
  })

  return {
    give, clear, active, has, level, instance,
    speedMultiplier, jumpMultiplier, gravityMultiplier, levitationSpeed,
    safeFallBlocks, damageTaken, damageBonus, digMultiplier, breathes,
    fireproof, swirlColor, swirlChance,
    /** For the HUD and for the specs: fires whenever the active set changes. */
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    /** Every entity currently carrying anything. The particle layer walks it. */
    get affected() {
      const out = []
      for (const [entity, m] of live) if (m.size) out.push(entity)
      return out
    },
    /** Test and reset seam -- resetWorld calls it between specs. */
    clearAll() { for (const entity of [...live.keys()]) clear(entity) },
  }
}
