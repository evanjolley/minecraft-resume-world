import { EFFECT_BY_KEY } from './effects.js'
import { MC } from './physics.js'
import { entitiesInBox, entityBox } from './entityBox.js'
/* The cycle. See the note at the top of the file: this binding is in the
 * temporal dead zone while items.js is still evaluating, so it may only be
 * touched from inside a function body. */
import { itemId } from './items.js'

/*
 * POTIONS. Wave two: the items that deliver the effects wave one built.
 *
 * effects.js is the engine and it is READ-ONLY to this file. Every duration
 * and every amplifier below is passed straight through to `effects.give`, and
 * nothing here re-implements a single one of the twenty effects. If a number
 * in this file is wrong, one potion is wrong; if a number in effects.js is
 * wrong, everything is. That split is the whole reason wave one shipped
 * without a bottle in it.
 *
 * ---------------------------------------------------------------------------
 * WHAT A POTION IS IN 1.21, AND WHY THAT IS NOT WHAT IT IS HERE.
 *
 * Vanilla has THREE potion items -- `potion`, `splash_potion`,
 * `lingering_potion` -- and the actual potion rides on them as a DATA
 * COMPONENT, `minecraft:potion_contents`:
 *
 *   public record PotionContents(Optional<Holder<Potion>> potion,
 *       Optional<Integer> customColor, List<MobEffectInstance> customEffects,
 *       Optional<String> customName)
 *
 * (It was an NBT tag, `Potion: "minecraft:strong_healing"`, until the 1.20.5
 * component rewrite. Anything you remember about potion NBT is two versions
 * stale, which is exactly the trap this note exists to mark.)
 *
 * This world's inventory stores `{ id, count }` and nothing else. There is no
 * component system, no per-stack data, and adding one for potions means
 * touching the inventory, the crafting grid, the drop entity, the hotbar and
 * every equality test between two stacks -- five files, four of them owned by
 * other people this pass.
 *
 * So a potion is an ITEM here: `potion_swiftness` and `potion_long_swiftness`
 * are two registered items with two ids, the way `oak_slab` and `oak_stairs`
 * are. That is the pre-flattening arrangement -- a potion used to be item 373
 * with a damage value, which is the same trick a different way round -- and it
 * costs exactly one thing: a custom potion cannot exist, because there is no
 * `customEffects` list to put one in. Nothing in this world can make one
 * (there is no brewing stand and no /give with components), so the cost is
 * currently zero and will stay zero until brewing lands.
 *
 * Rejected: one `potion` item plus a parallel Map from slot to contents.
 * Stacks get copied, split, merged and thrown; a side table keyed by slot goes
 * wrong the first time one moves, and it goes wrong silently.
 *
 * ---------------------------------------------------------------------------
 * THE IMPORT CYCLE, because it is real and it is load-bearing.
 *
 * items.js imports this file at the top level (it needs the table to build the
 * item rows) and this file imports `itemId` back from items.js. That is a
 * cycle, and it works for one reason only: `itemId` is called from inside
 * functions, never at module evaluation time. ESM gives the second module a
 * live binding that is in the temporal dead zone until the first finishes, so
 * a top-level `itemId(...)` here would throw at load. Everything above the
 * `installPotions` line is therefore data with no lookups in it.
 */

/** Vanilla's `Consumable.DEFAULT_CONSUME_SECONDS` is 1.6F, and
 *  `consumeTicks()` is `(int)(consumeSeconds * 20.0F)` -- so 32 ticks.
 *  Not a constant named DRINK_DURATION any more; 1.21 moved it into the
 *  `minecraft:consumable` component, which is why the old 32 is still 32. */
export const DRINK_TICKS = 32
export const DRINK_SECONDS = DRINK_TICKS / MC.TICKS_PER_SECOND

/*
 * `PotionContents.BASE_POTION_COLOR = -13083194`, which as ARGB is
 * 0xFF385DC6. It is what `getColorOr` falls back to when a potion has no
 * visible effects, and it is the blue of a plain water bottle.
 */
export const WATER_COLOR = 0x385DC6

/* ------------------------------------------------------------------ *
 * THE TABLE, transcribed from Potions.java in
 * sis1cat/minecraftsodium-1.21.8 (a Mojang-mapped 1.21.8 decompile) and
 * cross-checked against minecraft.wiki/w/Potion. The two agree tick for
 * tick; the only differences are the wiki rounding 432 ticks up to 0:22 and
 * 450 up to 0:23 for display.
 *
 * `MobEffectInstance(effect, duration)` leaves the amplifier at 0, so a row
 * with no `amp` is level I. Durations are in TICKS because that is the unit
 * vanilla states them in and the unit effects.js counts in; converting to
 * seconds here would put a rounding step between the source and the engine.
 *
 * WHICH VARIANTS EXIST IS NOT A PATTERN. This is the part that is wrong if
 * you write it from memory:
 *
 *   long_ AND strong_   leaping, swiftness, slowness, turtle_master,
 *                       poison, regeneration, strength
 *   long_ ONLY          night_vision, invisibility, fire_resistance,
 *                       water_breathing, weakness, slow_falling
 *   strong_ ONLY        healing, harming        (an instant has no duration
 *                                                to extend)
 *   NEITHER             water, mundane, thick, awkward, luck, wind_charged,
 *                       weaving, oozing, infested
 *
 * The registry id is `long_swiftness`; the NAME passed to `new Potion(...)`
 * is the bare `swiftness` for all three variants, which is why vanilla's
 * three Potions of Swiftness share one display string and are told apart only
 * by the duration in the tooltip. See POTION_ITEMS for what this world does
 * about that instead.
 * ------------------------------------------------------------------ */

/**
 * Every vanilla potion, keyed by its registry id.
 *
 * `effects` is the list vanilla's Potion carries. Turtle Master is the only
 * one with two, and it is the reason this is a list rather than a single
 * effect+duration+amp triple: a shape that could not hold it would have to be
 * widened later, and Turtle Master is the potion most likely to be got wrong
 * (Slowness IV plus Resistance III, not Slowness IV plus Resistance IV).
 */
export const POTIONS = {
  water: { effects: [] },
  mundane: { effects: [] },
  thick: { effects: [] },
  awkward: { effects: [] },

  night_vision: { effects: [{ key: 'night_vision', ticks: 3600 }] },
  long_night_vision: { base: 'night_vision', effects: [{ key: 'night_vision', ticks: 9600 }] },

  invisibility: { effects: [{ key: 'invisibility', ticks: 3600 }] },
  long_invisibility: { base: 'invisibility', effects: [{ key: 'invisibility', ticks: 9600 }] },

  leaping: { effects: [{ key: 'jump_boost', ticks: 3600 }] },
  long_leaping: { base: 'leaping', effects: [{ key: 'jump_boost', ticks: 9600 }] },
  strong_leaping: { base: 'leaping', effects: [{ key: 'jump_boost', ticks: 1800, amp: 1 }] },

  fire_resistance: { effects: [{ key: 'fire_resistance', ticks: 3600 }] },
  long_fire_resistance: { base: 'fire_resistance', effects: [{ key: 'fire_resistance', ticks: 9600 }] },

  swiftness: { effects: [{ key: 'speed', ticks: 3600 }] },
  long_swiftness: { base: 'swiftness', effects: [{ key: 'speed', ticks: 9600 }] },
  strong_swiftness: { base: 'swiftness', effects: [{ key: 'speed', ticks: 1800, amp: 1 }] },

  slowness: { effects: [{ key: 'slowness', ticks: 1800 }] },
  long_slowness: { base: 'slowness', effects: [{ key: 'slowness', ticks: 4800 }] },
  strong_slowness: { base: 'slowness', effects: [{ key: 'slowness', ticks: 400, amp: 3 }] },

  turtle_master: {
    effects: [
      { key: 'slowness', ticks: 400, amp: 3 },
      { key: 'resistance', ticks: 400, amp: 2 },
    ],
  },
  long_turtle_master: {
    base: 'turtle_master',
    effects: [
      { key: 'slowness', ticks: 800, amp: 3 },
      { key: 'resistance', ticks: 800, amp: 2 },
    ],
  },
  strong_turtle_master: {
    base: 'turtle_master',
    effects: [
      { key: 'slowness', ticks: 400, amp: 5 },
      { key: 'resistance', ticks: 400, amp: 3 },
    ],
  },

  water_breathing: { effects: [{ key: 'water_breathing', ticks: 3600 }] },
  long_water_breathing: { base: 'water_breathing', effects: [{ key: 'water_breathing', ticks: 9600 }] },

  // Duration 1 on an instant is vanilla's own placeholder -- an
  // InstantenousMobEffect never enters the active list, so the number is
  // never counted down. effects.js does not store it at all.
  healing: { effects: [{ key: 'instant_health', ticks: 1 }] },
  strong_healing: { base: 'healing', effects: [{ key: 'instant_health', ticks: 1, amp: 1 }] },
  harming: { effects: [{ key: 'instant_damage', ticks: 1 }] },
  strong_harming: { base: 'harming', effects: [{ key: 'instant_damage', ticks: 1, amp: 1 }] },

  poison: { effects: [{ key: 'poison', ticks: 900 }] },
  long_poison: { base: 'poison', effects: [{ key: 'poison', ticks: 1800 }] },
  strong_poison: { base: 'poison', effects: [{ key: 'poison', ticks: 432, amp: 1 }] },

  regeneration: { effects: [{ key: 'regeneration', ticks: 900 }] },
  long_regeneration: { base: 'regeneration', effects: [{ key: 'regeneration', ticks: 1800 }] },
  strong_regeneration: { base: 'regeneration', effects: [{ key: 'regeneration', ticks: 450, amp: 1 }] },

  strength: { effects: [{ key: 'strength', ticks: 3600 }] },
  long_strength: { base: 'strength', effects: [{ key: 'strength', ticks: 9600 }] },
  strong_strength: { base: 'strength', effects: [{ key: 'strength', ticks: 1800, amp: 1 }] },

  weakness: { effects: [{ key: 'weakness', ticks: 1800 }] },
  long_weakness: { base: 'weakness', effects: [{ key: 'weakness', ticks: 4800 }] },

  luck: { effects: [{ key: 'luck', ticks: 6000 }] },

  slow_falling: { effects: [{ key: 'slow_falling', ticks: 1800 }] },
  long_slow_falling: { base: 'slow_falling', effects: [{ key: 'slow_falling', ticks: 4800 }] },

  wind_charged: { effects: [{ key: 'wind_charged', ticks: 3600 }] },
  weaving: { effects: [{ key: 'weaving', ticks: 3600 }] },
  oozing: { effects: [{ key: 'oozing', ticks: 3600 }] },
  infested: { effects: [{ key: 'infested', ticks: 3600 }] },
}

/* ------------------------------------------------------------------ *
 * WHICH OF THEM THIS WORLD SHIPS, and the rule is one sentence:
 *
 *   A POTION WHOSE EFFECT NOTHING IN THIS WORLD CONSUMES IS A POTION THAT
 *   LIES, AND IT IS WORSE THAN A MISSING POTION.
 *
 * effects.js's report ended with four effects whose maths is complete and
 * whose consumer does not exist: Strength and Weakness (`damageBonus`, and
 * there is no melee), Haste and Mining Fatigue (`digMultiplier`). Haste and
 * Mining Fatigue have no potion in vanilla at all, so there was never
 * anything to cut -- and `digMultiplier` is now wired into interact.js, so
 * `/effect give haste` is real even though no bottle grants it.
 *
 * Strength and Weakness DO have potions, and they are cut. A Potion of
 * Strength in the creative menu that changes no number anywhere is the exact
 * thing this rule exists to prevent.
 *
 * The same test cuts more than the report predicted, and each one is a
 * missing CONSUMER rather than a missing effect:
 *
 *   night_vision, invisibility   In the registry, with the right colours, and
 *                                nothing reads them. Invisibility thins the
 *                                particle swirl (effects.js's swirlChance)
 *                                and that is all it does. Night Vision would
 *                                be a light-level floor in sky.js;
 *                                Invisibility would be a hide in
 *                                playerModel.js. Both are one line in a file
 *                                this pass does not own. See the report.
 *   luck                         Vanilla's Luck biases loot tables. There are
 *                                no loot tables here -- itemEntity.js drops a
 *                                fixed item per block -- so there is no roll
 *                                to bias.
 *   wind_charged, weaving,       All four are ON-DEATH effects of a mob
 *   oozing, infested             (a wind burst, cobwebs, slimes, silverfish).
 *                                There are no mobs, and the player dying does
 *                                not spawn anything.
 *   mundane, thick, awkward      Brewing intermediates with no effects at
 *                                all. They exist to be a step in a brewing
 *                                stand, and the brewing stand is wave three.
 *                                Shipping them now is three grey bottles that
 *                                do nothing and lead nowhere.
 *
 * WATER IS SHIPPED even though it has no effects, and that is not a
 * contradiction: a Water Bottle does not claim to do anything. It is the
 * recognisable base of the whole system, it drinks, and it hands back a glass
 * bottle -- which is exactly what vanilla's does.
 * ------------------------------------------------------------------ */
export const SHIPPED = [
  'water',
  'swiftness', 'long_swiftness', 'strong_swiftness',
  'slowness', 'long_slowness', 'strong_slowness',
  'leaping', 'long_leaping', 'strong_leaping',
  'slow_falling', 'long_slow_falling',
  'water_breathing', 'long_water_breathing',
  'fire_resistance', 'long_fire_resistance',
  'healing', 'strong_healing',
  'harming', 'strong_harming',
  'poison', 'long_poison', 'strong_poison',
  'regeneration', 'long_regeneration', 'strong_regeneration',
  'turtle_master', 'long_turtle_master', 'strong_turtle_master',
]

/** The ones deliberately left out, with the reason, so the report and the
 *  spec read from the same list rather than from the prose above. */
export const WITHHELD = {
  night_vision: 'no consumer: nothing reads night_vision (sky.js would)',
  long_night_vision: 'no consumer: nothing reads night_vision (sky.js would)',
  invisibility: 'no consumer: nothing reads invisibility (playerModel.js would)',
  long_invisibility: 'no consumer: nothing reads invisibility (playerModel.js would)',
  strength: 'no consumer: damageBonus has no melee to feed',
  long_strength: 'no consumer: damageBonus has no melee to feed',
  strong_strength: 'no consumer: damageBonus has no melee to feed',
  weakness: 'no consumer: damageBonus has no melee to feed',
  long_weakness: 'no consumer: damageBonus has no melee to feed',
  luck: 'no consumer: no loot tables to bias',
  wind_charged: 'no consumer: an on-death effect, and there are no mobs',
  weaving: 'no consumer: an on-death effect, and there are no mobs',
  oozing: 'no consumer: an on-death effect, and there are no mobs',
  infested: 'no consumer: an on-death effect, and there are no mobs',
  mundane: 'a brewing intermediate with no effects; brewing is wave three',
  thick: 'a brewing intermediate with no effects; brewing is wave three',
  awkward: 'a brewing intermediate with no effects; brewing is wave three',
}

/* ------------------------------------------------------------------ *
 * Colour.
 *
 * `PotionContents.getColorOptional`, verbatim in shape: a per-channel mean
 * over the effects, WEIGHTED BY (amplifier + 1), with integer division.
 *
 *   for each visible effect:
 *     n = amplifier + 1
 *     r += n * red(effectColor);  g += ...;  b += ...;  total += n
 *   colour = (r / total, g / total, b / total)
 *
 * The weighting is why `strong_turtle_master` is not the same colour as
 * `turtle_master`: the amplifiers move from (3, 2) to (5, 3), so Slowness's
 * share of the mix goes from 4/7 to 6/10. A "one colour per base potion"
 * table looks right, reads right, and gets that one wrong -- which is the
 * reason this is computed rather than transcribed.
 *
 * Derived from effects.js's own colour table, so a correction there reaches
 * the bottles without anybody remembering to copy it.
 * ------------------------------------------------------------------ */
export function potionColor(id) {
  const p = POTIONS[id]
  let r = 0, g = 0, b = 0, total = 0
  for (const e of p.effects) {
    const def = EFFECT_BY_KEY.get(e.key)
    if (!def) continue
    const n = (e.amp ?? 0) + 1
    r += n * ((def.color >> 16) & 0xFF)
    g += n * ((def.color >> 8) & 0xFF)
    b += n * (def.color & 0xFF)
    total += n
  }
  if (total === 0) return WATER_COLOR
  return (Math.floor(r / total) << 16) | (Math.floor(g / total) << 8) | Math.floor(b / total)
}

/** `[r, g, b]`, which is the shape the texture build's `multiply` wants. */
export const potionTint = (id) => {
  const c = potionColor(id)
  return [(c >> 16) & 0xFF, (c >> 8) & 0xFF, c & 0xFF]
}

/* ------------------------------------------------------------------ *
 * Names.
 *
 * Vanilla's en_us.json (read out of the 1.21.8 jar) gives one string per BASE
 * potion, shared by all three variants:
 *
 *   item.minecraft.potion.effect.swiftness        Potion of Swiftness
 *   item.minecraft.splash_potion.effect.swiftness Splash Potion of Swiftness
 *   item.minecraft.potion.effect.water            Water Bottle
 *   item.minecraft.potion.effect.turtle_master    Potion of the Turtle Master
 *
 * and tells the three apart in the TOOLTIP, which prints the effect and its
 * duration ("Speed II (1:30)").
 *
 * THIS WORLD APPENDS THE DURATION TO THE NAME INSTEAD, and that is a
 * deliberate deviation from vanilla's string. The reason is the owner's own,
 * about the ten stair variants that used to be in the creative menu: "he
 * clicked what looked like a prismarine block and got upside-down stairs. Ten
 * entries deep in a scroll, sharing one name and one texture." Three Potions
 * of Swiftness sharing one name and one sprite is that bug again, and the
 * tooltip this world has renders one line -- inventory.js's `tooltip.attach`
 * is handed `[itemName(stack.id)]` -- so there is no second line to put the
 * duration on without editing a file this pass does not own.
 *
 * So the information vanilla puts on line two goes in the parentheses, and it
 * is vanilla's own formatting for it: level in Roman numerals when above I,
 * duration as m:ss. Rejected: "(Extended)" and "(Enhanced)", which are
 * wiki words rather than game words and tell you less than the number does.
 * ------------------------------------------------------------------ */

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI']

/** Vanilla's `potion.withDuration` formatting: floor to whole seconds. */
export function formatDuration(ticks) {
  const s = Math.floor(ticks / MC.TICKS_PER_SECOND)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/*
 * The display name of the base potion, from the jar's lang file. Only the
 * shipped bases are here -- adding a row is what "ship another potion" means.
 * `the Turtle Master` is lower-cased on purpose: that is the vanilla string.
 */
const BASE_NAME = {
  water: 'Water Bottle',
  swiftness: 'Potion of Swiftness',
  slowness: 'Potion of Slowness',
  leaping: 'Potion of Leaping',
  slow_falling: 'Potion of Slow Falling',
  water_breathing: 'Potion of Water Breathing',
  fire_resistance: 'Potion of Fire Resistance',
  healing: 'Potion of Healing',
  harming: 'Potion of Harming',
  poison: 'Potion of Poison',
  regeneration: 'Potion of Regeneration',
  turtle_master: 'Potion of the Turtle Master',
}

/** `swiftness` for all three of swiftness / long_ / strong_. */
export const baseOf = (id) => POTIONS[id].base ?? id

/**
 * "Potion of Swiftness (3:00)", "Potion of Swiftness II (1:30)",
 * "Splash Potion of Poison (0:45)", "Water Bottle".
 *
 * The suffix is built from the FIRST effect, which is right for every potion
 * in the game: Turtle Master's two are the only multi-effect case and they
 * share a duration, so quoting Slowness's is quoting both.
 */
export function potionName(id, form = 'drink') {
  const base = BASE_NAME[baseOf(id)]
  if (!base) throw new Error(`no display name for potion "${id}"`)
  const name = form === 'splash' ? base.replace(/^Potion|^Water Bottle/, m =>
    m === 'Potion' ? 'Splash Potion' : 'Splash Water Bottle') : base
  const list = POTIONS[id].effects
  const [first] = list
  if (!first) return name
  /*
   * A MULTI-EFFECT POTION SHOWS EVERY LEVEL, slash-separated. Turtle Master
   * is the only one in the game, and it is the one case where a single Roman
   * numeral is actively wrong: "Potion of the Turtle Master VI" reads as a
   * potion of level six, when what it means is Slowness VI AND Resistance IV.
   * Vanilla prints the two on two tooltip lines; with one line to spend they
   * become "IV/III" and "VI/IV", which is also the only thing that tells the
   * normal and enhanced variants apart -- they share a duration.
   */
  const levels = list.map(e => ROMAN[e.amp ?? 0])
  const level = levels.every(l => l === 'I') ? '' : ` ${levels.join('/')}`
  // An instant has no duration worth printing -- vanilla's tooltip prints
  // "Instant Health" with no time in brackets either.
  const dur = EFFECT_BY_KEY.get(first.key)?.instant ? '' : ` (${formatDuration(first.ticks)})`
  return `${name}${level}${dur}`
}

/* ------------------------------------------------------------------ *
 * The item rows, which items.js splices into its own registry.
 *
 * Built here rather than there because everything they need -- the table, the
 * colour maths, the naming rule -- is here, and items.js's job is to number
 * them and hand them the same `id`/`key`/`texture` shape every other item has.
 *
 * ONE SPRITE PER POTION rather than one per colour. The extended and enhanced
 * variants of a potion share a colour, so `potion_swiftness.png` and
 * `potion_long_swiftness.png` come out byte-identical, and 54 sprites at
 * ~200 bytes is 11 KB of duplication. Rejected: keying the sprite on the
 * colour (`potion_33ebff.png`) and letting the duplicates collapse. It saves
 * 5 KB, it makes the build output unreadable, and it puts a de-duplication
 * step between the item and its art -- which is exactly where
 * `strong_turtle_master`, the one potion whose colour differs from its own
 * base, would have gone wrong.
 * ------------------------------------------------------------------ */

/**
 * `stacksTo(1)`, straight from `Items.java`. It is not the tool rule -- it is
 * there because in vanilla two potions of different contents are different
 * stacks of one item and merging them would lose one. Here they really are
 * different items, so the 1 is inherited rather than required; kept because
 * the thing it stops (sixty-four Potions of Healing in one slot) is not
 * something vanilla lets you do.
 */
const POTION_STACK = 1

export const POTION_ITEMS = SHIPPED.flatMap(id => [
  {
    key: `potion_${id}`,
    name: potionName(id, 'drink'),
    stack: POTION_STACK,
    potion: { id, form: 'drink' },
    texture: `potion_${id}`,
    /*
     * The two-layer `item/generated` model, exactly as
     * models/item/potion.json has it:
     *   layer0  item/potion_overlay  the liquid, greyscale, TINTED
     *   layer1  item/potion          the glass, full colour, untinted
     * Bottom first, so the glass goes OVER the liquid -- which is why a
     * potion reads as coloured fluid seen through a bottle rather than as a
     * bottle painted a colour. build-textures.mjs bakes the tint in.
     */
    layers: [
      { texture: 'potion_overlay', tint: potionTint(id) },
      { texture: 'potion' },
    ],
  },
  {
    key: `splash_potion_${id}`,
    name: potionName(id, 'splash'),
    stack: POTION_STACK,
    potion: { id, form: 'splash' },
    texture: `splash_potion_${id}`,
    // Same liquid, different glass: splash_potion.json swaps layer1 for
    // `item/splash_potion`, which is the round-bottomed bottle you cannot
    // stand up. layer0 is the identical overlay.
    layers: [
      { texture: 'potion_overlay', tint: potionTint(id) },
      { texture: 'splash_potion' },
    ],
  },
])

/* ------------------------------------------------------------------ *
 * SPLASH: the numbers, before the machinery that uses them.
 *
 * All five from ThrownSplashPotion.java and AbstractThrownPotion.java in the
 * 1.21.8 decompile. The falloff in particular is quoted rather than
 * remembered, because the shape everyone half-remembers (a linear ramp on
 * distance) and the real one (a linear ramp on the SQUARE ROOT of the squared
 * distance, which is the same thing, computed the long way) agree -- and the
 * bit that does not agree with memory is what it is measured FROM.
 * ------------------------------------------------------------------ */

/** `AbstractThrownPotion.SPLASH_RANGE = 4.0`, `SPLASH_RANGE_SQ = 16.0`. */
export const SPLASH_RANGE = 4
/** `aABB.inflate(4.0, 2.0, 4.0)` -- the broad-phase box is FLAT. Four blocks
 *  out horizontally and only two vertically, which is why a potion at your
 *  feet misses somebody on the roof two blocks up and one across. */
export const SPLASH_INFLATE = [4, 2, 4]

/**
 * Vanilla's falloff, verbatim:
 *
 *   double d = aABB.distanceToSqr(livingEntity.getBoundingBox().inflate(g));
 *   if (d < 16.0) {
 *     double e = 1.0 - Math.sqrt(d) / 4.0;
 *
 * so potency is 1.0 touching the impact point and 0.0 at four blocks, linear
 * in between. Two things about it are easy to get wrong:
 *
 * 1. `d` IS BOX-TO-BOX, not centre-to-centre. A 1.8-tall player standing
 *    where the potion broke is at distance 0 and takes the full dose. (1.21.1
 *    and earlier used `this.distanceToSqr(livingEntity)` -- centre to centre
 *    -- plus an explicit `if (livingEntity == directHitTarget) e = 1.0` to
 *    patch up the direct-hit case. The box version makes that patch
 *    unnecessary and is what 1.21.8 does.)
 * 2. THERE IS NO 0.75. Splash potions gave three quarters of the drinkable
 *    duration in 1.8 and the rule was removed in 15w31a; the modern knob is
 *    the `potion_duration_scale` component, and `Items.SPLASH_POTION` does
 *    not carry one, so it defaults to 1.0. Lingering carries 0.25 and a
 *    tipped arrow 0.125. Implementing 0.75 here would be implementing 1.8.
 *
 * @param {number} distSq squared distance from the impact box to the target box
 * @returns {number} potency in 0..1, or 0 outside the range
 */
export const splashPotency = (distSq) =>
  distSq < SPLASH_RANGE * SPLASH_RANGE ? 1 - Math.sqrt(distSq) / SPLASH_RANGE : 0

/**
 * The duration a splashed timed effect actually lands with.
 *
 *   int i = mobEffectInstance.mapDuration(ix -> (int)(e * ix * f + 0.5));
 *   if (!mobEffectInstance2.endsWithin(20)) livingEntity.addEffect(...)
 *
 * `(int)(x + 0.5)` on a non-negative float is `Math.floor(x + 0.5)`, not
 * `Math.round` -- they agree everywhere here, and the floor is what the
 * source says. `f` is the duration scale, 1.0 for splash.
 *
 * THE 20-TICK FLOOR IS NOT A ROUNDING GUARD. `endsWithin(20)` throws the
 * effect away entirely, so the outer edge of a splash gives nothing at all
 * rather than giving you a Speed I that expires before the swirl starts.
 *
 * @returns {number} ticks, or 0 for "do not apply this at all"
 */
export function splashTicks(ticks, potency, scale = 1) {
  const out = Math.floor(potency * ticks * scale + 0.5)
  return out <= 20 ? 0 : out
}

/* ------------------------------------------------------------------ *
 * The thrown entity's physics, from ThrowablePotionItem and
 * ThrowableProjectile. Expressed per TICK, the way vanilla states them, and
 * converted at the point of use -- the same convention itemEntity.js uses for
 * its own 0.04 gravity.
 * ------------------------------------------------------------------ */

const TPS = MC.TICKS_PER_SECOND
/** `Projectile.spawnProjectileFromRotation(..., -20.0F, 0.5F, 1.0F)`: the
 *  throw is aimed twenty degrees ABOVE where you are looking, which is what
 *  makes a splash potion arc onto a target instead of into the floor. */
export const THROW_PITCH_OFFSET = -20 * Math.PI / 180
/** `ThrowablePotionItem.PROJECTILE_SHOOT_POWER = 0.5F` blocks/tick. */
export const THROW_SPEED = 0.5 * TPS
/** `AbstractThrownPotion.getDefaultGravity() = 0.05`, which OVERRIDES
 *  ThrowableProjectile's 0.03. A potion falls faster than a snowball. */
export const THROW_GRAVITY = 0.05 * TPS * TPS
/** `ThrowableProjectile.applyInertia()`: 0.99 per tick in air. */
export const THROW_DRAG_PER_TICK = 0.99
/** A potion's hitbox is 0.25 on a side. */
export const THROW_SIZE = 0.25
/** Nothing should fly forever if it somehow never hits anything. */
const MAX_FLIGHT_SECONDS = 20

/* ================================================================== *
 * THE RUNTIME.
 *
 * Two verbs: drink, and throw. Everything above this line is data and pure
 * functions, which is what lets a spec assert vanilla's numbers without a
 * browser -- see test/92-potions.spec.js.
 * ================================================================== */

/**
 * @param noa
 * @param deps inventory, effects, inputLock, authority, vitalsFor, sounds
 * @returns handles for the console and the test suite
 */
export function installPotions(noa, {
  inventory, effects, inputLock, authority, vitalsFor = () => null, sounds = null,
} = {}) {
  const scene = noa.rendering.getScene()

  /*
   * BABYLON IS LOADED DYNAMICALLY HERE, and it is not a code-splitting trick.
   *
   * scripts/build-textures.mjs imports items.js under BARE NODE to read
   * ITEM_TEXTURES, items.js imports this file for the potion table, and
   * Babylon's deep paths (`@babylonjs/core/Meshes/Builders/planeBuilder`) have
   * no file extension -- only a bundler resolves those, node throws
   * ERR_MODULE_NOT_FOUND. A static import at the top of this file therefore
   * breaks `npm run textures`, which is a build step, from a rendering detail.
   *
   * A dynamic import is not in the static graph, so node never follows it and
   * Vite still bundles it. `gfx` is null for the first frames after load,
   * which is why meshFor bails rather than throwing -- nothing can be in the
   * air that early anyway.
   *
   * Rejected: splitting the table into a fourth file so items.js could import
   * data without reaching rendering. It is the tidier graph and it is a file
   * whose entire reason for existing is a module resolver's opinion about
   * file extensions.
   */
  let gfx = null
  Promise.all([
    import('@babylonjs/core/Meshes/Builders/planeBuilder'),
    import('@babylonjs/core/Materials/Textures/texture'),
    import('@babylonjs/core/Maths/math.color'),
  ]).then(([plane, tex, color]) => {
    gfx = { CreatePlane: plane.CreatePlane, Texture: tex.Texture, Color3: color.Color3 }
  })

  /* Resolved lazily, INSIDE the closure, for the cycle reason at the top of
   * this file: items.js is still evaluating when this module is loaded. */
  let ids = null
  const itemIds = () => {
    if (!ids) {
      ids = { byItem: new Map(), glassBottle: itemId('glass_bottle') }
      for (const row of POTION_ITEMS) ids.byItem.set(itemId(row.key), row.potion)
    }
    return ids
  }

  /** The potion a held stack is, or null for everything else in the game. */
  const potionOf = (stack) => (stack ? itemIds().byItem.get(stack.id) ?? null : null)

  /* ---------------- applying a potion to somebody ---------------- */

  /**
   * Hand every effect of a potion to an entity.
   *
   * `potency` is splash's falloff and is 1 for a drink. It does two different
   * things depending on the effect, which is vanilla's split and is the part
   * worth reading twice:
   *
   *   timed effects    potency scales the DURATION, and a result of 20 ticks
   *                    or less is dropped entirely.
   *   instant effects  potency scales the MAGNITUDE. Instant Health at the
   *                    edge of a splash heals less; it does not heal briefly,
   *                    because there is no "briefly" to heal for.
   *
   * THE INSTANT PATH DOES NOT GO THROUGH effects.give, and that is the one
   * place this file duplicates arithmetic that belongs to effects.js.
   * `give(entity, key, seconds, amplifier)` has nowhere to put a magnitude
   * scale, so a splashed Instant Damage at half potency cannot be expressed
   * through it. effects.js is read-only this pass; the change it wants is a
   * sixth argument on `give`, or an exported `applyInstant(entity, key, amp,
   * scale)`. Reported rather than made. Note the drink path DOES go through
   * `give` -- potency is exactly 1 there, so there is nothing to scale and no
   * reason to take the private route.
   */
  function applyPotion(entity, id, potency = 1) {
    const applied = []
    for (const e of POTIONS[id].effects) {
      const def = EFFECT_BY_KEY.get(e.key)
      const amp = e.amp ?? 0
      if (def?.instant) {
        if (applyInstant(entity, e.key, amp, potency)) applied.push(e.key)
        continue
      }
      const ticks = potency === 1 ? e.ticks : splashTicks(e.ticks, potency)
      if (ticks <= 0) continue
      if (effects.give(entity, e.key, ticks / TPS, amp)) applied.push(e.key)
    }
    return applied
  }

  /*
   * HealOrHarmMobEffect.applyInstantenousEffect, verbatim:
   *
   *   int j = (int)(d * (double)(4 << i) + 0.5);   // heal
   *   int j = (int)(d * (double)(6 << i) + 0.5);   // harm
   *
   * `4 << amplifier` is a SHIFT, so Healing II is 8 health and not 6, and the
   * shift is what effects.js writes as `2 ** amplifier` against the same base.
   *
   * Instant Damage goes through `v.damage(n, 'magic')`, which is survival.js's
   * ONE GATE -- so a creative player is immune to a Potion of Harming for the
   * same reason they are immune to lava, in the same line of code, and Evan
   * (who has no vitals adapter) takes none of it because there is nothing to
   * take it with.
   */
  function applyInstant(entity, key, amp, potency) {
    const v = vitalsFor(entity)
    if (!v) return false
    const heal = key === 'instant_health'
    const base = (heal ? 4 : 6) * (2 ** Math.max(0, amp))
    const amount = Math.floor(potency * base + 0.5)
    if (amount <= 0) return false
    if (heal) v.heal(amount)
    else v.damage(amount, 'magic')
    return true
  }

  /* ---------------- drinking ---------------- */

  /*
   * 32 ticks of holding the button, and it is a HOLD rather than a click
   * because that is the only thing in this world that has ever been one.
   *
   * The state is three fields rather than a timer object: what you are
   * drinking, which slot it came out of, and how far in you are. The slot
   * matters -- scrolling the hotbar mid-drink has to cancel, or you swallow a
   * potion out of a slot you are no longer holding.
   */
  let drinking = null // { id, slot, elapsed }

  const cancelDrink = () => { drinking = null }

  /** 0 while not drinking, 0..1 while you are. What the HUD would draw. */
  const drinkProgress = () => (drinking ? Math.min(1, drinking.elapsed / DRINK_SECONDS) : 0)

  /**
   * Swallow it.
   *
   * The empty bottle is `Item.Properties.usingConvertsTo(GLASS_BOTTLE)`, which
   * in 1.21 is the `use_remainder` component. It is NOT given in creative --
   * `UseRemainder.convertIntoRemainder` checks `abilities.instabuild` the same
   * way `ItemStack.consume` does -- so a creative player drinks forever and
   * never accumulates bottles, which is also the only behaviour that makes
   * sense when the stack never shrank.
   */
  function finishDrink() {
    const { id, slot } = drinking
    drinking = null
    const applied = applyPotion(noa.playerEntity, id, 1)
    if (!authority.caps().infiniteResources) {
      // A potion is stacksTo(1), so this is always a straight swap rather
      // than bucket.js's shrink-and-hand-back dance.
      inventory.slots[slot] = { id: itemIds().glassBottle, count: 1 }
      inventory.emitChange()
    }
    sounds?.drink?.()
    return applied
  }

  /* ---------------- throwing ---------------- */

  /** Every splash potion currently in the air. A plain array with its own
   *  integrator, exactly as itemEntity.js keeps its drops -- and for the
   *  extra reason that a noa entity would have a physics component, which is
   *  what entityBox.js counts as a BODY. A potion that splashed itself, and
   *  that you could not place a block through, would both follow from that. */
  const flying = []

  const meshes = new Map()
  function meshFor(itemKey) {
    let m = meshes.get(itemKey)
    if (m) return m
    if (!gfx) return null
    m = gfx.CreatePlane(`splash-${itemKey}`, { size: THROW_SIZE * 2, sideOrientation: 2 }, scene)
    m.material = noa.rendering.makeStandardMaterial(`splash-${itemKey}-mat`)
    const tex = new gfx.Texture(`/textures/item/${itemKey}.png`, scene, true, false,
      gfx.Texture.NEAREST_SAMPLINGMODE)
    tex.hasAlpha = true
    m.material.diffuseTexture = tex
    m.material.useAlphaFromDiffuseTexture = true
    m.material.specularColor = new gfx.Color3(0, 0, 0)
    m.material.backFaceCulling = false
    m.isPickable = false
    m.alwaysSelectAsActiveMesh = true
    m.setEnabled(false)
    noa.rendering.addMeshToScene(m)
    meshes.set(itemKey, m)
    return m
  }

  /**
   * Throw one.
   *
   * `Projectile.spawnProjectileFromRotation(this::createPotion, level, stack,
   *  player, -20.0F, PROJECTILE_SHOOT_POWER, 1.0F)` -- pitch offset -20
   * degrees, power 0.5 blocks/tick, uncertainty 1.0. The uncertainty is
   * vanilla's random spread and is dropped here on purpose: this world has one
   * thrower and no mobs, and a spread that only ever makes YOUR throw miss is
   * a frustration with no counterpart.
   *
   * The direction conversion is bucket.js's, deliberately character for
   * character: noa's heading gives forward = (sin h, cos h) and its pitch is
   * positive looking DOWN. If one of the two is ever wrong they are both
   * wrong together, which is far easier to find than one of them being wrong.
   */
  function throwSplash(id, itemKey) {
    const p = noa.ents.getPositionData(noa.playerEntity).position
    const eye = [p[0], p[1] + (noa.inputs.state.sneak ? MC.SNEAK_EYE_HEIGHT : MC.EYE_HEIGHT), p[2]]
    // MINUS the offset, because noa's pitch is already inverted relative to
    // Minecraft's: vanilla adds -20 to an xRot that is positive looking down.
    const pitch = noa.camera.pitch + THROW_PITCH_OFFSET
    const h = noa.camera.heading
    const cp = Math.cos(pitch)
    const dir = [Math.sin(h) * cp, -Math.sin(pitch), Math.cos(h) * cp]
    const shot = {
      id, itemKey,
      x: eye[0], y: eye[1], z: eye[2],
      vx: dir[0] * THROW_SPEED, vy: dir[1] * THROW_SPEED, vz: dir[2] * THROW_SPEED,
      age: 0,
    }
    flying.push(shot)
    sounds?.throw?.()
    return shot
  }

  const solid = (x, y, z) => {
    const b = noa.getBlock(x, y, z)
    return b !== 0 && noa.registry.getBlockSolidity(b)
  }

  /**
   * Break it, and dose everything in range.
   *
   * THE BOX IS FLAT. `aABB.inflate(4.0, 2.0, 4.0)` on the potion's own 0.25
   * hitbox gives 8.25 x 4.25 x 8.25, which is the cuboid the wiki quotes --
   * four blocks out sideways and two up. It is a BROAD PHASE only: the
   * potency test below cuts it to a four-block sphere, so the corners of the
   * box get nothing.
   *
   * `entitiesInBox` is entityBox.js's, and it was written general "because
   * punching was coming". An area effect is the same query with a bigger box,
   * which is the whole reason it was not called `canPlaceAt`.
   */
  function breakPotion(shot) {
    const min = [shot.x - THROW_SIZE / 2 - SPLASH_INFLATE[0],
                 shot.y - THROW_SIZE / 2 - SPLASH_INFLATE[1],
                 shot.z - THROW_SIZE / 2 - SPLASH_INFLATE[2]]
    const max = [shot.x + THROW_SIZE / 2 + SPLASH_INFLATE[0],
                 shot.y + THROW_SIZE / 2 + SPLASH_INFLATE[1],
                 shot.z + THROW_SIZE / 2 + SPLASH_INFLATE[2]]
    const impact = {
      min: [shot.x - THROW_SIZE / 2, shot.y - THROW_SIZE / 2, shot.z - THROW_SIZE / 2],
      max: [shot.x + THROW_SIZE / 2, shot.y + THROW_SIZE / 2, shot.z + THROW_SIZE / 2],
    }
    const hits = []
    for (const entity of entitiesInBox(noa, min, max)) {
      const box = entityBox(noa, entity)
      if (!box) continue
      const potency = splashPotency(boxDistanceSq(impact, box))
      if (potency <= 0) continue
      hits.push({ entity, potency, applied: applyPotion(entity, shot.id, potency) })
    }
    sounds?.shatter?.()
    return { at: [shot.x, shot.y, shot.z], color: potionColor(shot.id), hits }
  }

  /*
   * `AABB.distanceToSqr(other)`: the per-axis gap, zero where the boxes
   * overlap, squared and summed. Two boxes that touch or intersect are at
   * distance 0, which is what makes a direct hit full strength without the
   * explicit `if (target == directHit) e = 1.0` older versions needed.
   */
  function boxDistanceSq(a, b) {
    let sum = 0
    for (let i = 0; i < 3; i++) {
      const gap = Math.max(0, a.min[i] - b.max[i], b.min[i] - a.max[i])
      sum += gap * gap
    }
    return sum
  }

  /* The last few impacts, for the spec and the console. Bounded, because a
   * list nobody drains is a leak wearing a feature's clothes. */
  const splashed = []
  const SPLASH_LOG = 16
  const trimLog = () => { while (splashed.length > SPLASH_LOG) splashed.shift() }

  /* ---------------- the clock ---------------- */

  noa.on('tick', (dtMs) => {
    const dt = dtMs / 1000

    /* Drinking. The guards are checked every tick rather than only at the
     * start, because all three can change mid-drink: opening the inventory,
     * scrolling the hotbar, and dropping the stack. */
    if (drinking) {
      const stack = inventory.slots[drinking.slot]
      if (inputLock.locked || !noa.inputs.state['alt-fire'] ||
          inventory.selected !== drinking.slot ||
          !stack || potionOf(stack)?.id !== drinking.id) {
        cancelDrink()
      } else {
        drinking.elapsed += dt
        if (drinking.elapsed >= DRINK_SECONDS) finishDrink()
      }
    }

    for (let i = flying.length - 1; i >= 0; i--) {
      const s = flying[i]
      s.age += dt
      /* Gravity then drag then move, which is ThrowableProjectile.tick's own
       * order. Drag is per TICK, so it is raised to the number of ticks this
       * frame was -- a frame at 60 fps is half a tick and must not apply a
       * whole tick of 0.99. */
      s.vy -= THROW_GRAVITY * dt
      const drag = THROW_DRAG_PER_TICK ** (dt * TPS)
      s.vx *= drag; s.vy *= drag; s.vz *= drag

      /* Substepped for the same reason itemEntity.js substeps: a potion
       * leaves the hand at 10 blocks a second and would otherwise step
       * through a one-block wall between frames. */
      const dist = Math.hypot(s.vx, s.vy, s.vz) * dt
      const steps = Math.max(1, Math.ceil(dist / (THROW_SIZE * 0.8)))
      let hit = false
      for (let k = 0; k < steps && !hit; k++) {
        s.x += s.vx * dt / steps
        s.y += s.vy * dt / steps
        s.z += s.vz * dt / steps
        if (solid(Math.floor(s.x), Math.floor(s.y), Math.floor(s.z))) hit = true
      }
      if (hit || s.age > MAX_FLIGHT_SECONDS) {
        flying.splice(i, 1)
        if (hit) splashed.push(breakPotion(s))
        continue
      }
    }
  })

  noa.on('beforeRender', () => {
    trimLog()
    for (const m of meshes.values()) m.setEnabled(false)
    const local = []
    for (const s of flying) {
      const m = meshFor(s.itemKey)
      if (!m) continue
      noa.globalToLocal([s.x, s.y, s.z], null, local)
      m.position.set(local[0], local[1], local[2])
      // Face the camera. A thrown potion in vanilla is a billboarded sprite
      // too -- ThrownItemRenderer extends EntityRenderer with a billboard.
      m.rotation.y = noa.camera.heading
      m.rotation.x = -noa.camera.pitch
      m.setEnabled(true)
    }
  })

  /*
   * The right-click.
   *
   * A third listener on 'alt-fire', alongside interact.js's and bucket.js's,
   * and the precedence is the same one bucket.js documents: interact.js runs
   * first and takes the inputLock if it opened a screen, so `inputLock.locked`
   * is already true by the time this runs. A potion's `places` is 0, so
   * interact.js's placement path does nothing for it either.
   *
   * SPLASH IS A CLICK AND DRINKING IS A HOLD, which is vanilla:
   * SplashPotionItem.use returns SUCCESS immediately, while PotionItem's
   * consumable component makes it a 32-tick use.
   */
  noa.inputs.down.on('alt-fire', () => {
    if (inputLock.locked || drinking) return
    const stack = inventory.selectedStack()
    const potion = potionOf(stack)
    if (!potion) return
    if (potion.form === 'splash') {
      const key = `splash_potion_${potion.id}`
      throwSplash(potion.id, key)
      if (!authority.caps().infiniteResources) inventory.consumeSelected()
      return
    }
    drinking = { id: potion.id, slot: inventory.selected, elapsed: 0 }
  })

  return {
    /* Pure-ish seams the spec drives without an input layer. */
    applyPotion,
    throwSplash: (id) => throwSplash(id, `splash_potion_${id}`),
    breakPotion,
    potionOf,
    /** Force the drink to complete now, which is how a spec measures a
     *  duration without waiting 1.6 real seconds for every potion. */
    drinkNow(id) {
      drinking = { id, slot: inventory.selected, elapsed: DRINK_SECONDS }
      return finishDrink()
    },
    get drinking() { return drinking ? drinking.id : null },
    drinkProgress,
    cancelDrink,
    get flying() { return flying },
    get splashed() { return splashed },
  }
}
