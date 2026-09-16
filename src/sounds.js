import { BLOCK_BY_ID, BLOCK_TYPES } from './blocks.js'
// For the air meter only. hud.js draws the bubbles off these same two
// constants, so counting them here counts exactly what the player can see.
import { MC } from './physics.js'

/*
 * Minecraft's block sounds, played through Web Audio.
 *
 * The samples come out of your own Minecraft install via
 * `npm run sounds`, into public/sounds/ -- which is gitignored, because
 * Mojang's audio is no more redistributable than their textures. If that
 * script was never run there is no manifest, and everything here degrades to
 * silence rather than throwing. A world with no sound is fine; a world that
 * dies on startup because someone skipped a build step is not.
 *
 * Not everything here hangs off a block. The player's own sounds -- hurt,
 * death, the two fall-damage thumps -- and the GUI click come from a flat list
 * of samples rather than the block grid, and are wired to survival.js's hurt
 * and death events. Same manifest, same voices, different lookup.
 *
 * FIDELITY. Minecraft doesn't give blocks individual sounds, it gives them a
 * SoundType -- one of about a dozen families, six of which this palette can
 * reach. Each family has a handful of numbered samples and the game picks one
 * at random, which is the entire reason footsteps don't sound like a metronome.
 * The same samples get reused across events at different pitch and volume:
 * `step` covers footsteps, the mining hit tick AND the landing thud, while
 * `dig` covers both breaking and placing. That reuse is Minecraft's design,
 * not a corner cut here.
 *
 * AUTOPLAY. Browsers refuse to start an AudioContext without a user gesture,
 * so the context is created on the first click/keypress rather than at
 * install time. Everything before that point is safe to call and does nothing.
 */

/* ------------------------------------------------------------------ *
 * SoundType families.
 *
 * Minecraft never gives a block its own sound. It gives it a SoundType, and a
 * SoundType is a (volume, pitch) pair plus a set of events, shared by every
 * block declared with it. So the job here is two tables, not one: which family
 * a block belongs to (GROUP_RULES), and what that family does to the mix
 * (SOUND_GROUPS). Neither one knows which files exist -- the manifest owns
 * that -- which is what lets the same mapping serve the vanilla build and the
 * six-family free set.
 *
 * `from` is the family to play when the build did not extract this one. It is
 * load-bearing in both directions: the free set has six families total, and
 * even the vanilla build only extracts the families this world walks on. A
 * sculk block on a free build plays stone -- which is exactly what it played
 * before this table existed. The mapping is complete; the extraction is a dial.
 *
 * WHERE THE NUMBERS COME FROM. `minecraft/sounds.json` in your own asset
 * index (1.21.8, index 26) carries the per-sample volume and pitch of every
 * event, and it is the citation for every non-1.0 below: block.mud.step is
 * volume 0.5, block.packed_mud.step is 0.3 at pitch 0.95, block.mud_bricks.*
 * is 0.5, block.azalea_leaves.step is 0.85. Everything unmarked plays at 1.0
 * there.
 *
 * The two exceptions live in SoundType rather than in sounds.json, and both
 * matter more than anything in the paragraph above. block.metal.step IS
 * step/stone1-6 and block.glass.step IS step/stone1-6 -- identical files. The
 * only thing that makes an iron block ring rather than thud is
 * SoundType.METAL's 1.5 pitch, and glass differs from stone only on break.
 * Reading sounds.json alone would have made both of them "stone" and called it
 * accurate.
 */
export const SOUND_GROUPS = {
  /* The six the build has always produced, from both sources. */
  stone: { volume: 1.0, pitch: 1.0 },
  // SoundType.GRASS's own volume, which multiplies sounds.json's 1.0. This
  // predates the mapping work and is kept: grass IS the quiet one.
  grass: { volume: 0.6, pitch: 1.0 },
  wood: { volume: 1.0, pitch: 1.0 },
  gravel: { volume: 1.0, pitch: 1.0 },
  sand: { volume: 1.0, pitch: 1.0 },
  snow: { volume: 1.0, pitch: 1.0 },

  /* Extracted by the vanilla build, because the terrain patch is made of them. */
  deepslate: { volume: 1.0, pitch: 1.0, from: 'stone' },
  tuff: { volume: 1.0, pitch: 1.0, from: 'stone' },
  moss: { volume: 1.0, pitch: 1.0, from: 'grass' },
  sculk: { volume: 1.0, pitch: 1.0, from: 'stone' },
  calcite: { volume: 1.0, pitch: 1.0, from: 'stone' },
  amethyst: { volume: 1.0, pitch: 1.0, from: 'stone' },
  basalt: { volume: 1.0, pitch: 1.0, from: 'stone' },
  cloth: { volume: 1.0, pitch: 1.0, from: 'grass' },

  /*
   * Mapped but not extracted: every one of these resolves through `from`
   * today. They are here rather than folded into their fallback because the
   * mapping is the thing that has to stay true -- the day `npm run sounds`
   * grows a family, the blocks that belong to it are already named.
   */
  metal: { volume: 1.0, pitch: 1.5, from: 'stone' },   // SoundType.METAL
  glass: { volume: 1.0, pitch: 1.0, from: 'stone' },   // stone steps, glass break
  copper: { volume: 1.0, pitch: 1.0, from: 'stone' },
  dripstone: { volume: 1.0, pitch: 1.0, from: 'stone' },
  netherrack: { volume: 1.0, pitch: 1.0, from: 'stone' },
  nether_bricks: { volume: 1.0, pitch: 1.0, from: 'stone' },
  nether_ore: { volume: 1.0, pitch: 1.0, from: 'stone' },
  netherite: { volume: 1.0, pitch: 1.0, from: 'stone' },
  bone_block: { volume: 1.0, pitch: 1.0, from: 'stone' },
  froglight: { volume: 1.0, pitch: 1.0, from: 'stone' },
  resin: { volume: 1.0, pitch: 1.0, from: 'stone' },
  coral: { volume: 1.0, pitch: 1.0, from: 'stone' },
  nether_wood: { volume: 1.0, pitch: 1.0, from: 'wood' },
  cherry_wood: { volume: 1.0, pitch: 1.0, from: 'wood' },
  bamboo_wood: { volume: 1.0, pitch: 1.0, from: 'wood' },
  stem: { volume: 1.0, pitch: 1.0, from: 'wood' },
  cherry_leaves: { volume: 1.0, pitch: 1.0, from: 'grass' },
  nylium: { volume: 1.0, pitch: 1.0, from: 'grass' },
  netherwart: { volume: 1.0, pitch: 1.0, from: 'grass' },
  shroomlight: { volume: 1.0, pitch: 1.0, from: 'grass' },
  sponge: { volume: 1.0, pitch: 1.0, from: 'grass' },
  honey: { volume: 1.0, pitch: 1.0, from: 'grass' },
  slime: { volume: 1.0, pitch: 1.0, from: 'grass' },
  rooted_dirt: { volume: 1.0, pitch: 1.0, from: 'gravel' },
  soul_sand: { volume: 1.0, pitch: 1.0, from: 'sand' },
  soul_soil: { volume: 1.0, pitch: 1.0, from: 'sand' },
  mud: { volume: 0.5, pitch: 1.0, from: 'gravel' },
  packed_mud: { volume: 0.3, pitch: 0.95, from: 'stone' },
  mud_bricks: { volume: 0.5, pitch: 1.0, from: 'stone' },
}

const DEFAULT_GROUP = 'stone'

/*
 * Block key -> family, by RULE rather than by row.
 *
 * The old table had four entries and let 634 blocks fall through to stone,
 * which was fine for a hand-built island of six block types and is why the
 * 128x128 Minecraft patch came out sounding like a quarry: leaves, logs, moss,
 * sculk, deepslate, tuff, snow and packed ice were all stone.
 *
 * Rules, not rows, because blocks.js GENERATES most of its palette --
 * `woodSet()` makes six rows per wood, `dyed()` sixteen per colour family,
 * `nonCubeSet()` ten per stone -- and anything hand-listed against a generated
 * palette is wrong one commit after it is written. Every rule here keys on the
 * same naming convention those generators use.
 *
 * ORDER IS THE WHOLE DESIGN. First match wins, so the specific families come
 * before the general ones: cherry before wood, nylium before nether, deepslate
 * before ore. Read it top to bottom as "is it this? no, then is it this?".
 *
 * DIRT IS GRAVEL. That looks like a bug and isn't: `Blocks.DIRT` is declared
 * with SoundType.GRAVEL, so dirt crunches rather than rustles. Only the grass
 * BLOCK gets SoundType.GRASS.
 *
 * `null` is a deliberate silence, not a gap -- see the fluids rule.
 *
 * Rejected: deriving the family from the block's texture name, which would
 * have covered the non-cube families for free (a slab carries its source
 * cube's `all`). It reads the wrong thing: `oak_wood` is textured `oak_log`
 * and `smooth_quartz` is textured `quartz_block_bottom`, so the texture is a
 * statement about pixels and the key is the statement about material.
 *
 * Rejected: adding a `sound:` field to blocks.js, which would be the most
 * direct expression of this and is another agent's file to change. If this
 * table ever needs a block that its name cannot classify, that is the fix.
 */
const GROUP_RULES = [
  /*
   * Fluids and the world wall first, because "water" contains no clue and
   * every later rule would be a coin flip on it.
   *
   * Vanilla fluids have no step or dig sound at all -- swimming and splashing
   * are their own events, wired in fluids.js, not a SoundType -- so this is a
   * silence that means silence. play() reads null as "nothing to play here".
   */
  /*
   * The eight flow levels per fluid (blocks.js's flowSet) are matched by the
   * same line rather than by a second rule, because the reason is the same
   * reason: a flowing water block is water. Vanilla does not give it a
   * SoundType either -- it is one BlockDynamicLiquid with a level in its
   * metadata, and metadata carries no sound.
   */
  [/^(water|lava)(_[1-7]|_falling)?$/, null, 'fluids have no SoundType'],
  // The invisible wall around the patch. You can stand on top of it, so it
  // needs a sound; vanilla's barrier declares no SoundType and inherits stone.
  [/^barrier$/, 'stone', 'vanilla barrier inherits SoundType.STONE'],

  /* ---- foliage, before anything that matches a wood name ---- */
  [/^cherry_leaves$/, 'cherry_leaves', 'SoundType.CHERRY_LEAVES'],
  // Every other leaf in the palette is SoundType.GRASS -- which is the fix for
  // "walking on leaves sounds like stone". Azalea leaves have their own family
  // in vanilla; this world has no azalea.
  [/_leaves$/, 'grass', 'SoundType.GRASS'],

  /* ---- the nether, before the wood and stone rules eat it ---- */
  [/nylium$/, 'nylium', 'SoundType.NYLIUM'],
  [/wart_block$/, 'netherwart', 'SoundType.WART_BLOCK'],
  [/^shroomlight$/, 'shroomlight', 'SoundType.SHROOMLIGHT'],
  [/^(stripped_)?(crimson|warped)_/, 'nether_wood', 'SoundType.NETHER_WOOD'],
  [/^netherrack$/, 'netherrack', 'SoundType.NETHERRACK'],
  [/nether_brick/, 'nether_bricks', 'SoundType.NETHER_BRICKS'],
  // Nether ores and gilded blackstone share block/nether_ore in sounds.json.
  [/^(nether_gold_ore|nether_quartz_ore|gilded_blackstone)$/, 'nether_ore', 'SoundType.NETHER_ORE'],
  [/^soul_sand$/, 'soul_sand', 'SoundType.SOUL_SAND'],
  [/^soul_soil$/, 'soul_soil', 'SoundType.SOUL_SOIL'],
  [/^ancient_debris$/, 'basalt', 'block.ancient_debris.step IS block/basalt/step*'],
  [/basalt$/, 'basalt', 'SoundType.BASALT'],
  [/^netherite_block$/, 'netherite', 'SoundType.NETHERITE_BLOCK'],
  [/^bone_block$/, 'bone_block', 'SoundType.BONE_BLOCK'],
  [/^glowstone$/, 'glass', 'SoundType.GLASS'],
  [/froglight$/, 'froglight', 'SoundType.FROGLIGHT'],
  [/^resin/, 'resin', 'SoundType.RESIN / RESIN_BRICKS'],

  /* ---- the deep dark, before the ore and brick rules ---- */
  // Deepslate ores are SoundType.DEEPSLATE, not SoundType.STONE, so this has
  // to beat the ore rule below. Vanilla splits DEEPSLATE_BRICKS and
  // DEEPSLATE_TILES off as their own SoundTypes; folded here, because those
  // two are step-and-place variations on the same recordings and the build
  // extracts one deepslate family.
  [/deepslate/, 'deepslate', 'SoundType.DEEPSLATE'],
  // Same fold for SCULK_CATALYST, which is its own SoundType over the same
  // block/sculk samples.
  [/^sculk/, 'sculk', 'SoundType.SCULK'],
  [/^moss_block$/, 'moss', 'SoundType.MOSS'],
  [/tuff/, 'tuff', 'SoundType.TUFF / TUFF_BRICKS'],
  [/^calcite$/, 'calcite', 'SoundType.CALCITE'],
  [/amethyst/, 'amethyst', 'SoundType.AMETHYST'],
  [/^dripstone_block$/, 'dripstone', 'SoundType.DRIPSTONE_BLOCK'],

  /* ---- ground ---- */
  [/^grass$/, 'grass', 'SoundType.GRASS -- the grass BLOCK, and only it'],
  [/^rooted_dirt$/, 'rooted_dirt', 'SoundType.ROOTED_DIRT'],
  // Dirt, podzol, mycelium, clay and gravel are all SoundType.GRAVEL.
  [/^(dirt|coarse_dirt|podzol|mycelium|clay|gravel)$/, 'gravel', 'SoundType.GRAVEL'],
  [/^(sand|red_sand)$/, 'sand', 'SoundType.SAND'],
  // Concrete powder is SAND; set concrete is STONE, and the rule below it.
  [/_concrete_powder$/, 'sand', 'SoundType.SAND'],
  [/^mud$/, 'mud', 'SoundType.MUD'],
  [/^packed_mud$/, 'packed_mud', 'SoundType.PACKED_MUD'],
  [/^mud_bricks$/, 'mud_bricks', 'SoundType.MUD_BRICKS'],
  [/^snow_block$/, 'snow', 'SoundType.SNOW'],
  // ICE IS GLASS. All three ices are SoundType.GLASS, which steps on stone --
  // so this changes nothing today and stops being a lie the day glass breaks
  // get their own samples.
  [/^(ice|packed_ice|blue_ice)$/, 'glass', 'SoundType.GLASS'],

  /* ---- wood, in order of specificity ---- */
  [/^(stripped_)?cherry_/, 'cherry_wood', 'SoundType.CHERRY_WOOD'],
  [/bamboo/, 'bamboo_wood', 'SoundType.BAMBOO_WOOD'],
  [/mushroom/, 'wood', 'SoundType.WOOD'],
  [/^(planks|melon|pumpkin|carved_pumpkin|jack_o_lantern|bookshelf|chiseled_bookshelf|crafting_table|note_block|jukebox|barrel|loom|cartography_table|fletching_table|smithing_table|beehive|bee_nest)$/,
    'wood', 'SoundType.WOOD'],
  [/_(planks|log|wood|stem|hyphae)$/, 'wood', 'SoundType.WOOD'],
  // The marker rule. Slabs and stairs are not classified by the words "slab"
  // and "stairs" -- they fall through to the stripper below, which re-runs
  // these rules against the family name the source cube carries.
  [/_(slab|slab_top|stairs)$|_stairs_/, null, 'HANDLED BY THE NON-CUBE STRIPPER'],

  /* ---- soft things ---- */
  [/_wool$/, 'cloth', 'SoundType.WOOL -- step/cloth, dig/cloth'],
  [/^(hay_block|dried_kelp_block|tnt|target)$/, 'grass', 'SoundType.GRASS'],
  [/^honeycomb_block$/, 'coral', 'SoundType.CORAL_BLOCK'],
  [/^honey_block$/, 'honey', 'SoundType.HONEY_BLOCK'],
  [/^slime_block$/, 'slime', 'SoundType.SLIME_BLOCK -- the slime mob samples'],
  [/sponge$/, 'sponge', 'SoundType.SPONGE / WET_SPONGE'],
  [/glass$/, 'glass', 'SoundType.GLASS'],
  [/^(redstone_lamp|sea_lantern)$/, 'glass', 'SoundType.GLASS'],

  /* ---- metal ---- */
  // The six mineral blocks are METAL; coal and the three RAW blocks are STONE,
  // which is why this names them one by one instead of matching `_block$`.
  [/^(iron|gold|diamond|emerald|lapis|redstone)_block$/, 'metal', 'SoundType.METAL'],
  // Every copper block, cut, chiseled, oxidised, bulb or grate. COPPER_BULB
  // and COPPER_GRATE are separate SoundTypes over the same block/copper
  // samples; folded.
  // Copper ORE is stone, and so are the three raw-metal blocks -- so those
  // leave before the copper rule sees them.
  [/^(copper_ore|raw_copper_block)$/, 'stone', 'SoundType.STONE'],
  [/copper/, 'copper', 'SoundType.COPPER'],

  /*
   * Stone last, and deliberately enumerated rather than left as a catch-all.
   *
   * A trailing `[/./, 'stone']` would make this table impossible to be wrong
   * about -- and impossible to notice being wrong, which is the failure this
   * whole change exists to fix. Anything that reaches the end of these rules
   * unmatched is REPORTED (see unmappedBlocks below), and the sound build and
   * test/12-sounds.spec.js both fail on a non-empty report.
   */
  [/stone|cobble|brick|sandstone|quartz|purpur|prismarine|terracotta|concrete|obsidian|magma_block|andesite|diorite|granite|_ore$|^(coal|iron|gold|diamond|emerald|lapis|redstone|copper)_block$|^raw_\w+_block$|^(furnace|blast_furnace|smoker|piston|sticky_piston|dispenser|dropper|observer|bedrock|lodestone|respawn_anchor)$/,
    'stone', 'SoundType.STONE'],
]

/*
 * The non-cube families, which blocks.js generates ten rows at a time from one
 * source cube: `<prefix>_slab`, `<prefix>_slab_top`, `<prefix>_stairs` and
 * seven more stair states. They take the SOURCE block's family, the same way
 * nonCubeSet() already gives them the source's texture and hardness.
 *
 * Stripping the suffix and re-running the rules is what makes that automatic:
 * `cherry_stairs_north_top` -> `cherry` -> cherry_wood, `deepslate_brick_slab`
 * -> `deepslate_brick` -> deepslate. No family list, so a new one inherits its
 * sound the day it is declared.
 */
const NON_CUBE_SUFFIX = /_(slab|slab_top|stairs)$|_stairs_(north|south|east|west)_(top|bottom)$/

/** The family for a block key, or null for a deliberate silence. */
function ruleFor(key) {
  for (const [pattern, group, why] of GROUP_RULES) {
    if (!pattern.test(key)) continue
    // The non-cube marker rule: fall through to the stripped key rather than
    // answering, so a slab is never classified by the word "slab".
    if (why === 'HANDLED BY THE NON-CUBE STRIPPER') break
    return { group, why }
  }
  const stripped = key.replace(NON_CUBE_SUFFIX, '')
  if (stripped !== key) {
    /*
     * A non-cube family's prefix is one of two things. Usually it is a
     * material name the rules above already answer -- `deepslate_brick`,
     * `smooth_sandstone`, `purpur`. For the eight wood families it is the bare
     * wood (`oak`, `cherry`), which names no block at all, so it is asked
     * again as `<wood>_planks` -- which is exactly the cube nonCubeSet() built
     * it from.
     */
    const inherited = ruleFor(stripped) ?? ruleFor(`${stripped}_planks`)
    if (inherited) return { group: inherited.group, why: `${inherited.why} (from ${stripped})` }
  }
  return null
}

/*
 * Resolved once at module load for the whole palette, not per footstep. 638
 * regex walks is nothing at import and would be a per-frame cost during a
 * mining burst.
 */
const RULE_BY_KEY = new Map(BLOCK_TYPES.map(b => [b.key, ruleFor(b.key)]))

/** Which rule claimed a block key, as { group, why }, or null if none did. */
export const soundRuleForKey = (key) => RULE_BY_KEY.get(key) ?? null

/**
 * Every registered block no rule claims.
 *
 * This is the whole point of enumerating stone instead of catching all: an
 * unmapped block is a name, in a list, at build time and in the test suite --
 * not a block that silently sounds like a rock. The sound build fails on it
 * and so does test/12-sounds.spec.js.
 */
export const unmappedBlocks = () =>
  BLOCK_TYPES.filter(b => !RULE_BY_KEY.get(b.key)).map(b => b.key)

/** The SoundType family for a block id, or null for air and for fluids. */
function groupForBlock(id) {
  if (!id) return null
  const def = BLOCK_BY_ID.get(id)
  if (!def) return null
  const rule = RULE_BY_KEY.get(def.key)
  // A block with no rule still makes a noise -- silence would be a worse bug
  // than a wrong one, and unmappedBlocks() is what makes this visible instead
  // of permanent.
  if (!rule) return DEFAULT_GROUP
  return rule.group
}


/*
 * Event -> which sample set, and Minecraft's mix for it.
 *
 * The pitch numbers are Minecraft's exactly: break and place at 0.8, the
 * mining hit tick at 0.5 (which is what makes mining sound heavier than
 * walking on the same block), landing at 0.75.
 *
 * The VOLUMES are lifted. Minecraft plays footsteps at volume * 0.15, which is
 * judged against music, ambience and mobs; as the only sound in an otherwise
 * silent world that lands somewhere near inaudible. The ratios between events
 * are kept, the absolute floor is raised.
 */
const MIX = {
  step: { set: 'step', volume: 0.34, pitch: 1.0 },
  hit: { set: 'step', volume: 0.22, pitch: 0.5 },
  land: { set: 'step', volume: 0.55, pitch: 0.75 },
  break: { set: 'dig', volume: 0.8, pitch: 0.8 },
  place: { set: 'dig', volume: 0.8, pitch: 0.8 },

  /*
   * `shared` marks the sets that aren't keyed by block family -- there is one
   * hurt sound for the whole game, not one per material -- so play() looks
   * them up in manifest.sets and ignores whatever block it was handed.
   *
   * hurt and death deliberately name the SAME set. Vanilla's
   * entity.player.death and entity.player.hurt both list damage/hit1-3; they
   * are two events over one set of samples, and inventing a distinct death
   * sample to make them differ would be less faithful, not more.
   *
   * So there is NO `death` entry in the manifest and there should not be one.
   * `lastPlayed` on a killing blow reads { event: 'death', set: 'hurt' }, which
   * looks like a set that was forgotten and is not -- this is the note that
   * stops the next reader "fixing" it.
   *
   * The real gap is the other way: the free sound set ships ONE hurt sample
   * where vanilla has three, so the `vary` below is carrying repetition on its
   * own. Known, and left. The CC0 grunts that would have filled it were
   * audibly a different person from damage/hit1, and three voices taking turns
   * is worse than one voice at three pitches.
   *
   * `vary` is Minecraft's getVoicePitch: (rand - rand) * 0.2 + 1.0. Two rolls
   * subtracted, not one scaled, which gives a triangular spread clustered near
   * 1.0. It matters far more here than on a footstep -- three samples heard
   * back to back while something is chewing through your hearts read as a
   * three-note loop without it.
   */
  hurt: { set: 'hurt', shared: true, volume: 0.85, pitch: 1.0, vary: 0.2 },
  death: { set: 'hurt', shared: true, volume: 0.85, pitch: 1.0, vary: 0.2 },

  /*
   * Vanilla plays both fall thumps at full volume and lets the samples carry
   * the difference, and that's kept -- but they sit under the hurt sound here
   * rather than level with it. A damaging fall fires three sounds into the
   * same frame (fall thump, landing thud, hurt) and three voices near 0.85
   * into a 0.9 master is a sum that clips. That's a mix decision, not a
   * fidelity claim.
   */
  fallBig: { set: 'fallBig', shared: true, volume: 0.7, pitch: 1.0 },
  fallSmall: { set: 'fallSmall', shared: true, volume: 0.7, pitch: 1.0 },

  // Minecraft's GUI clicks are quiet on purpose: SimpleSoundInstance.forUI
  // hardcodes volume 0.25 while everything else in this table plays at 1.0.
  // Lifted with the rest of the mix, kept the quietest thing in it.
  uiClick: { set: 'uiClick', shared: true, volume: 0.35, pitch: 1.0 },

  /*
   * Picking an item up off the floor. Vanilla's Player.take:
   *   playSound(ITEM_PICKUP, 0.2, ((rand - rand) * 0.7 + 1) * 2)
   * -- so the pitch really is doubled, and the spread really is that wide.
   * That squeak is the whole character of the sound, and a pop played at 1.0
   * sounds like a different game.
   *
   * THE SAMPLE IS WRONG AND SAYS SO. entity.item.pickup is `random/pop`, and
   * scripts/build-sounds.mjs does not extract it -- that file is not this
   * change's to edit. `fallback` is what runs meanwhile: the UI click,
   * pitched into the same register, which is a short dry tick and lands
   * surprisingly close. The day `pickup: ['random/pop']` is added to SETS the
   * manifest wins and this line stops mattering.
   */
  pickup: { set: 'pickup', fallback: 'uiClick', shared: true, volume: 0.3, pitch: 2.0, vary: 0.7 },

  /* ------------------------------------------------------------------ *
   * Water. All `shared`, because none of them hangs off a block.
   *
   * That is not a shortcut around GROUP_RULES' `[/^(water|lava)$/, null]` --
   * that line is still right. Vanilla fluids genuinely have no SoundType;
   * water's noises are ENTITY events (entity.generic.splash, .swim) and
   * AMBIENT events (ambient.underwater.*), which is why they are here with
   * hurt and the UI click rather than in the block grid.
   *
   * Volumes are vanilla's own where sounds.json publishes one:
   * ambient.underwater.loop 0.65, .enter 0.5, .exit 0.3, block.water.ambient
   * 0.75-1.0 at pitch 0.5-1.5. Splash and swim are mixed by ear against the
   * footsteps they play alongside -- Entity.playSwimSound scales its volume
   * by how hard you are moving, which this does not reproduce.
   * ------------------------------------------------------------------ */
  splash: { set: 'splash', shared: true, volume: 0.6, pitch: 1.0, vary: 0.2 },
  splashHigh: { set: 'splashHigh', shared: true, volume: 0.7, pitch: 1.0, vary: 0.2 },
  swim: { set: 'swim', shared: true, volume: 0.3, pitch: 1.0, vary: 0.4 },
  // The pitch spread really is that wide -- block.water.ambient is declared
  // 0.5 to 1.5 in sounds.json, which is why a pond never sounds like a loop.
  waterAmbient: { set: 'waterAmbient', shared: true, volume: 0.35, pitch: 1.0, vary: 0.5 },
  underwaterEnter: { set: 'underwaterEnter', shared: true, volume: 0.5, pitch: 1.0 },
  underwaterExit: { set: 'underwaterExit', shared: true, volume: 0.3, pitch: 1.0 },
  lavaAmbient: { set: 'lavaAmbient', shared: true, volume: 0.4, pitch: 1.0, vary: 0.2 },
  lavaPop: { set: 'lavaPop', shared: true, volume: 0.4, pitch: 1.0, vary: 0.3 },
  // The bubble leaving the air meter. A HUD sound, so flat and dry.
  breath: { set: 'breath', shared: true, volume: 0.5, pitch: 1.0, vary: 0.1 },
}

// Minecraft's LivingEntity.getFallDamageSound: more than 4 half-hearts of fall
// damage is a "big" fall. Not a distance -- the damage number is what's tested,
// which is why a fall onto slime or with feather falling stays quiet.
const BIG_FALL_DAMAGE = 4

// Minecraft plays the mining hit sound every 4 ticks while you hold the button.
const HIT_INTERVAL = 0.2

// Downward blocks/sec below which a ground contact isn't really a landing.
const LAND_MIN_SPEED = 3

/*
 * Voices. An AudioBufferSourceNode is one-shot by spec -- it cannot be
 * restarted -- so the source itself is unavoidably per-play. What IS poolable
 * is everything downstream, and that's the expensive part: a PannerNode
 * allocation per footstep would mean a few hundred per minute of walking.
 *
 * Two pools rather than one, because a "non-positional" sound routed through a
 * panner sitting exactly on the listener is undefined-ish territory in the
 * spec, and the workaround costs more than a second four-entry array.
 */
const POSITIONAL_VOICES = 16
const FLAT_VOICES = 8

/*
 * Swimming. Vanilla's Entity.playSwimSound fires on a distance travelled
 * rather than on a clock -- `nextStep` at 0.35 of a block-move -- which comes
 * out at roughly one stroke every six ticks at swim speed. A clock is close
 * enough here and does not need the odometer footsteps already own.
 */
const SWIM_INTERVAL = 0.3

/* block.water.ambient is a random one-shot, not a loop. Vanilla picks its gap
 * out of the same ambient scheduler every other block sound uses; this is a
 * plain uniform, which sounds the same and is one line. */
const ambientGap = () => 2 + Math.random() * 6

/*
 * The flowing-water trickle. See the long note at its call site for where the
 * two numbers come from: vanilla samples 667 positions per tick and rolls
 * 1/64, this samples 32 and rolls 667/(64*32) for the same expected rate.
 */
const FLOW_SOUND_SAMPLES = 32
const FLOW_SOUND_CHANCE = 667 / (64 * FLOW_SOUND_SAMPLES)
/* Vanilla's box is 16 either side of the camera on every axis. */
const rand16 = () => Math.floor(Math.random() * 33) - 16

/*
 * How loud the underwater bed sits. Vanilla's ambient.underwater.loop is 0.65,
 * and the synthesised stand-in below is quieter because it is broadband and
 * never stops -- a filtered noise bed at the same number is a hiss you notice.
 */
const BED_VOLUME = 0.5
const SYNTH_BED_VOLUME = 0.28

/* Two seconds of white noise. Same trick as rainAudio.js, and deliberately
 * NOT imported from it: that module owns the rain graph, and reaching into it
 * for a buffer helper would make the two dispose together. */
function noiseBuffer(ctx, seconds = 2) {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  return buf
}

export function installSounds(noa, deps = {}) {
  const { interaction, movement, survival, fluids } = deps

  let ctx = null
  let master = null
  let manifest = null
  let encoded = null      // logical name -> ArrayBuffer, fetched before the gesture
  let buffers = new Map() // logical name -> AudioBuffer, decoded after it
  let decodeErrors = []
  let positional = []
  let flat = []
  let nextPositional = 0
  let nextFlat = 0

  /*
   * The manifest is fetched immediately, long before there's a context to play
   * through, for two reasons: it's the "were sounds ever built?" check, and
   * fetching the samples on the click itself would put a few hundred KB of
   * network between the click and the first sound.
   */
  const loading = fetch('/sounds/manifest.json')
    .then(r => (r.ok ? r.json() : null))
    .then(async (m) => {
      if (!m) return
      manifest = m
      encoded = new Map()
      const jobs = []
      const grab = (name) => jobs.push(fetch(`/sounds/${name}.ogg`)
        .then(r => (r.ok ? r.arrayBuffer() : null))
        .then(buf => { if (buf) encoded.set(name, buf) })
        .catch(() => {}))

      for (const [group, sets] of Object.entries(m.groups)) {
        for (const [set, count] of Object.entries(sets)) {
          for (let i = 1; i <= count; i++) grab(`${set}/${group}${i}`)
        }
      }
      // `sets` is the non-block half of the manifest, and it names its samples
      // by their real vanilla path (`damage/hit1`) instead of deriving one from
      // a count -- fallbig and fallsmall aren't numbered, so there is nothing to
      // count. Optional so a public/sounds built before these existed still
      // loads its block sounds instead of throwing.
      for (const paths of Object.values(m.sets ?? {})) paths.forEach(grab)

      await Promise.all(jobs)
      if (ctx) await decodeAll()
    })
    .catch(() => { /* no sounds built; stay silent */ })

  async function decodeAll() {
    if (!ctx || !encoded) return
    const jobs = []
    for (const [name, data] of encoded) {
      if (buffers.has(name)) continue
      // decodeAudioData detaches the ArrayBuffer, so each one gets a copy --
      // without it a second decode pass (context recreated after a suspend)
      // throws on an already-detached buffer.
      jobs.push(ctx.decodeAudioData(data.slice(0))
        .then(buf => buffers.set(name, buf))
        .catch(err => decodeErrors.push(`${name}: ${err.message}`)))
    }
    await Promise.all(jobs)
  }

  function buildGraph() {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return false
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = 0.9
    master.connect(ctx.destination)

    for (let i = 0; i < POSITIONAL_VOICES; i++) {
      const panner = ctx.createPanner()
      /*
       * equalpower, not HRTF. HRTF convolves per node and we may have a dozen
       * live at once during a mining burst; for a game that only needs "which
       * side is that on, and how far", the cheap model is the right trade.
       */
      panner.panningModel = 'equalpower'
      panner.distanceModel = 'inverse'
      // Minecraft's block sounds carry about 16 blocks. refDistance is the
      // radius inside which there's no falloff at all -- roughly arm's reach.
      panner.refDistance = 3
      panner.rolloffFactor = 1.2
      panner.maxDistance = 48
      const gain = ctx.createGain()
      gain.connect(panner)
      panner.connect(master)
      positional.push({ gain, panner })
    }
    for (let i = 0; i < FLAT_VOICES; i++) {
      const gain = ctx.createGain()
      gain.connect(master)
      flat.push({ gain })
    }
    return true
  }

  /* ------------------------------------------------------------------ *
   * The underwater bed.
   *
   * A LOOP, so it cannot go through play(): every voice in the pools above is
   * a one-shot fired and forgotten, and an AudioBufferSourceNode cannot be
   * restarted once stopped. The pattern is rainAudio.js's -- one source
   * started once and never stopped, with the gain as the switch, ramped
   * rather than snapped.
   *
   * WHAT A FREE OR CE BUILD SOUNDS LIKE. `npm run build:deploy` runs
   * `sounds:free`, and sounds-src/free/ has no water sample of any kind --
   * there is no CC0 recording of Minecraft's underwater ambience and there is
   * not going to be one. So the bed is SYNTHESISED when the manifest has no
   * `underwaterLoop`: white noise through a 260 Hz lowpass, which is what a
   * few feet of water does to every sound above it. It is a dull, wide,
   * pressureless rumble with no detail in it -- noticeably emptier than
   * Mojang's recording, which has current and creak and distant movement in
   * it, but unmistakably "your head is under water" rather than silence.
   *
   * Rejected: shipping an unattributed sample, which is the one thing
   * sounds-src/free/NOTICE.txt exists to prevent. Rejected too: leaving a
   * deploy silent under water, which is what happens today and is a
   * regression against the vanilla build rather than a neutral gap.
   *
   * On a deploy the one-shots -- splash, swim, the enter/exit gulps -- are
   * simply absent, because FREE has no mapping for them. That is the existing
   * behaviour for any set the free build does not carry, and it stays visible
   * rather than being papered over with a `fallback` to something that is not
   * water.
   * ------------------------------------------------------------------ */
  let bedGain = null
  let bedSynthetic = false

  function buildBed() {
    if (bedGain) return true
    if (!ctx || ctx.state !== 'running') return false
    bedGain = ctx.createGain()
    bedGain.gain.value = 0

    const loopPath = manifest?.sets?.underwaterLoop?.[0]
    const loopBuf = loopPath && buffers.get(loopPath)
    const src = ctx.createBufferSource()
    src.loop = true

    if (loopBuf) {
      src.buffer = loopBuf
      src.connect(bedGain)
    } else {
      bedSynthetic = true
      src.buffer = noiseBuffer(ctx)
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 260
      // Flat, no resonance: a peak at the cutoff makes noise whistle, and
      // water has no pitch in it.
      lp.Q.value = 0.4
      src.connect(lp).connect(bedGain)
    }
    bedGain.connect(master)
    src.start()
    return true
  }

  function setUnderwaterBed(on) {
    // Don't build a graph just to play silence at somebody who is dry.
    if (!on && !bedGain) return
    if (!buildBed()) return
    const target = on ? (bedSynthetic ? SYNTH_BED_VOLUME : BED_VOLUME) : 0
    // setTargetAtTime, not a ramp: this is called every tick and a ramp
    // scheduled every tick fights the one before it.
    bedGain.gain.setTargetAtTime(target, ctx.currentTime, 0.12)
  }

  /*
   * The gesture gate. The listener stays attached until the context is
   * actually running, because a context can also be created suspended (Chrome
   * does this when the page loads without interaction) and because switching
   * tabs can suspend it again later.
   */
  const unlock = () => {
    if (!ctx && !buildGraph()) return
    if (ctx.state !== 'running') ctx.resume().catch(() => {})
    decodeAll()
    if (ctx.state === 'running') {
      for (const ev of ['mousedown', 'touchstart', 'keydown']) {
        window.removeEventListener(ev, unlock, true)
      }
    }
  }
  for (const ev of ['mousedown', 'touchstart', 'keydown']) {
    // Capture phase, because menus and the chat box stop propagation on some
    // of these and the gate would never fire for a player who types first.
    window.addEventListener(ev, unlock, true)
  }

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

  /**
   * Pick one variant at random, the way Minecraft does, and return its logical
   * name rather than its buffer -- the name is what `lastPlayed` reports, and a
   * decoded AudioBuffer tells a caller nothing about which sample it is.
   *
   * @param group a SoundType family, or null for one of the shared sets.
   */
  function sampleName(set, group) {
    if (!manifest) return null
    if (!group) {
      const paths = manifest.sets?.[set]
      return paths?.length ? pick(paths) : null
    }
    const built = builtGroup(group)
    const count = built && manifest.groups[built]?.[set]
    return count ? `${set}/${built}${1 + Math.floor(Math.random() * count)}` : null
  }

  /*
   * A family -> the family whose samples this build actually produced.
   *
   * Walks SOUND_GROUPS' `from` chain until it lands on something the manifest
   * carries. Two things depend on it: the free set, which has six families and
   * would otherwise play silence for the other thirty, and families like metal
   * and glass which have no samples of their own in ANY build -- vanilla's
   * block.metal.step IS step/stone1-6.
   *
   * Only the SAMPLES fall back. The mix stays with the family the block was
   * actually mapped to, which is the entire reason an iron block rings: it
   * plays stone's recording at SoundType.METAL's 1.5 pitch.
   */
  function builtGroup(group) {
    let g = group
    // Bounded rather than a visited-set, because the chains are two or three
    // links and a cycle here is a typo in SOUND_GROUPS, not a runtime state.
    for (let i = 0; g && i < 8; i++) {
      if (manifest.groups?.[g]) return g
      g = SOUND_GROUPS[g]?.from
    }
    return null
  }

  const local = [0, 0, 0]
  let lastPlayed = null

  /**
   * @param event one of MIX's keys
   * @param group a SoundType family name, or a block id to derive one from.
   *              Ignored for the `shared` events, which have no block.
   * @param worldPos [x,y,z] to play it at, or null for a non-positional sound
   */
  function play(event, group = null, worldPos = null) {
    if (!ctx || ctx.state !== 'running') return false
    const mix = MIX[event]
    if (!mix) return false
    if (mix.shared) group = null
    else {
      if (typeof group === 'number') group = groupForBlock(group)
      // No family means air, or a block id blocks.js has never heard of.
      if (!group) return false
    }
    // `fallback` covers an event whose real sample the sound build does not
    // produce yet. It is a stand-in, never a second choice for a set that
    // simply failed to load -- that case should stay silent and visible.
    const set = (mix.fallback && !manifest?.sets?.[mix.set]) ? mix.fallback : mix.set
    const name = sampleName(set, group)
    const buf = name && buffers.get(name)
    if (!buf) return false

    const voice = worldPos
      ? positional[nextPositional = (nextPositional + 1) % positional.length]
      : flat[nextFlat = (nextFlat + 1) % flat.length]

    const src = ctx.createBufferSource()
    src.buffer = buf
    // Minecraft pitches by resampling, so playbackRate is the faithful knob --
    // a lower pitch is genuinely a longer sound, which is why the mining tick
    // at 0.5 reads as a heavy thunk rather than a clipped one.
    // The family's own (volume, pitch) -- Minecraft's SoundType pair --
    // multiplied into the event's. Taken from the MAPPED family, not from
    // whichever one's samples the build fell back to.
    const family = (group && SOUND_GROUPS[group]) || { volume: 1, pitch: 1 }
    const pitch = mix.pitch * family.pitch
    src.playbackRate.value = mix.vary
      ? pitch * (1 + (Math.random() - Math.random()) * mix.vary)
      : pitch
    voice.gain.gain.value = mix.volume * family.volume

    if (worldPos) {
      /*
       * Panner coordinates are LOCAL, not world. noa rebases the world origin
       * as you travel and the listener is fed from the Babylon camera, which
       * lives in that rebased frame -- mixing the two puts every sound
       * hundreds of blocks off once you've walked far enough.
       */
      noa.globalToLocal(worldPos, null, local)
      const p = voice.panner
      if (p.positionX) {
        p.positionX.value = local[0]
        p.positionY.value = local[1]
        p.positionZ.value = local[2]
      } else {
        p.setPosition(local[0], local[1], local[2])
      }
    }

    src.connect(voice.gain)
    src.start()
    // Sources are garbage once played; dropping the connection keeps a
    // stopped node from pinning the pooled gain in the graph.
    src.onended = () => { try { src.disconnect() } catch { /* already gone */ } }
    lastPlayed = { event, set, name, group }
    return true
  }

  /*
   * The listener follows the RENDER camera rather than the player entity, so
   * third person hears from where you're actually looking rather than from
   * inside your own head. Its basis vectors come straight out of the camera's
   * world matrix -- noa.camera.getDirection() is only recomputed under pointer
   * lock, so it goes stale the moment a menu opens.
   */
  noa.on('beforeRender', () => {
    if (!ctx || ctx.state !== 'running') return
    const cam = noa.rendering.camera
    if (!cam) return
    const m = cam.getWorldMatrix().m
    const l = ctx.listener
    if (l.positionX) {
      l.positionX.value = m[12]; l.positionY.value = m[13]; l.positionZ.value = m[14]
      l.forwardX.value = m[8]; l.forwardY.value = m[9]; l.forwardZ.value = m[10]
      l.upX.value = m[4]; l.upY.value = m[5]; l.upZ.value = m[6]
    } else {
      l.setPosition(m[12], m[13], m[14])
      l.setOrientation(m[8], m[9], m[10], m[4], m[5], m[6])
    }
  })

  /* ---- wiring ---- */

  const center = (p) => [p[0] + 0.5, p[1] + 0.5, p[2] + 0.5]
  const unsubscribe = []

  if (interaction) {
    unsubscribe.push(interaction.onBlockBreak(({ id, position }) => {
      play('break', id, center(position))
    }))
    unsubscribe.push(interaction.onBlockPlace(({ id, position }) => {
      play('place', id, center(position))
    }))

    /*
     * The mining tick. Progress arrives every frame, so this rate-limits to
     * Minecraft's every-four-ticks rather than firing sixty times a second.
     * The timer resets on release, not on completion, so tapping the button
     * repeatedly can't machine-gun the sound.
     */
    let sinceHit = HIT_INTERVAL
    unsubscribe.push(interaction.onBreakProgress(({ id, position, dt }) => {
      if (!position) { sinceHit = HIT_INTERVAL; return }
      sinceHit += dt
      if (sinceHit < HIT_INTERVAL) return
      sinceHit = 0
      play('hit', id, center(position))
    }))
  }

  if (survival) {
    /*
     * Vanilla plays EITHER the hurt sound or the death sound on a hit, never
     * both -- LivingEntity.hurt branches on isDeadOrDying() and the killing
     * blow gets only the death sound. survival emits hurt and then death, so
     * the hurt handler is the one that has to stand down.
     */
    unsubscribe.push(survival.onHurt(({ amount, health, cause }) => {
      /*
       * The fall thump is its OWN event, on top of the hurt sound, and it is
       * not the landing thud already wired below: that one is the block you
       * hit, played on every landing, and this one is your legs, played only
       * when the landing cost you hearts.
       */
      if (cause === 'fall') play(amount > BIG_FALL_DAMAGE ? 'fallBig' : 'fallSmall')

      /*
       * Every cause this world can produce -- fall, starve, void, generic --
       * takes the plain hurt sound. Vanilla only swaps it for damage types
       * carrying a DamageEffects other than HURT, which is fire, drowning,
       * freezing and sweet berry bushes, none of which exist here. There are
       * samples for all four in the asset index; wiring them to causes that
       * can't happen would be inventing fidelity.
       */
      if (health > 0) play('hurt')
    }))

    /*
     * Every way to die emits this -- damage(), onVoidFall() and /kill all end
     * in died.emit -- so one subscription covers all three. It did not always:
     * onVoidFall used to zero health without emitting, and the void is the
     * death every visitor of this world finds first, on purpose.
     */
    unsubscribe.push(survival.onDeath(() => play('death')))
  }

  /*
   * ui.button.click, delegated off the document instead of wired per button.
   * The pause menu builds its rows at runtime and the death screen's button is
   * static markup -- neither file is this module's to edit, and a listener
   * that goes looking for .mc-button when the press happens needs no
   * cooperation from either. Every button in this project carries that class:
   * the pause rows, both sheet Done buttons and Respawn.
   *
   * MOUSEDOWN, NOT CLICK. Vanilla plays the sound on press --
   * AbstractWidget.mouseClicked calls playDownSound the moment the button goes
   * down, and never waits for the release. A `click` listener fires on mouseUP,
   * which is late enough to feel like lag on a button you hold for a beat, and
   * silent entirely if you press a button and drag off it.
   *
   * Not `pointerdown`, which would also cover touch: pointerdown fires BEFORE
   * mousedown, and the autoplay gate above is a mousedown listener. The gate
   * has to go first or the very first button a visitor ever presses has no
   * context to play through. Both being mousedown is what guarantees it --
   * capture runs outermost first, so the gate's listener on `window` is always
   * ahead of this one on `document`.
   *
   * Capture phase for the same reason the gate uses it: screens that stop
   * propagation would otherwise swallow their own click sound.
   *
   * NOT wired: the inventory's .gui-slot cells. Vanilla's container slots are
   * silent -- picking a stack up and putting it down makes no sound at all --
   * so adding one there would be inventing feedback, not restoring it.
   */
  const onUiClick = (e) => {
    if (e.target instanceof Element && e.target.closest('.mc-button')) play('uiClick')
  }
  document.addEventListener('mousedown', onUiClick, true)
  unsubscribe.push(() => document.removeEventListener('mousedown', onUiClick, true))

  /* ------------------------------------------------------------------ *
   * Water.
   *
   * All of it hangs off fluids.js's sensor rather than off events, because
   * fluids.js has none to offer -- and adding some would mean editing a file
   * this change does not own. `feet` and `eyes` are already separated there
   * for exactly the reason this needs them separated: the splash is your body
   * hitting the water and follows the FEET; everything that sounds like being
   * submerged follows the EYES. Chest-deep in a pond you splash and you do
   * not get the ambience.
   * ------------------------------------------------------------------ */
  if (fluids) {
    const body = () => noa.ents.getPhysics(noa.playerEntity)?.body
    /* The flow engine arrives on the same object, but later -- installFluids
     * runs after installSounds in main.js -- so it is read per tick rather
     * than captured here. Undefined until then, and the guard says so. */
    const flowMeta = (id) => fluids.flow?.metaOf(id)

    let wasFeet = null
    let wasEyes = null
    let sinceSwim = 0
    let untilAmbient = ambientGap()
    let untilLavaPop = 0
    let lastBubbles = null

    const onFluidTick = (dtMs) => {
      const dt = dtMs / 1000
      const feet = fluids.feet
      const eyes = fluids.eyes

      /* ---- hitting the water ---- */
      if (feet === 'water' && wasFeet !== 'water') {
        /*
         * Vanilla splits the splash on how hard you arrived:
         * entity.player.splash.high_speed is the one you get for diving in,
         * and the plain splash is the one you get for walking in. The real
         * rule is Entity.getFluidFallingAdjustedMovement's fall distance;
         * vertical speed is what this world can actually measure, and 8 b/s
         * is about a two-block drop.
         */
        const vy = body()?.velocity[1] ?? 0
        play(vy < -8 ? 'splashHigh' : 'splash')
      }

      /* ---- going under, and coming back up ---- */
      if (eyes === 'water' && wasEyes !== 'water') play('underwaterEnter')
      if (eyes !== 'water' && wasEyes === 'water') play('underwaterExit')
      // The bed is an EAR STATE, not a thing in the world, so it is flat and
      // it follows the eyes rather than the body.
      setUnderwaterBed(eyes === 'water')

      /* ---- swimming ---- */
      const b = body()
      const moving = b && Math.hypot(b.velocity[0], b.velocity[2]) > 0.8
      if ((feet === 'water' || eyes === 'water') && moving) {
        sinceSwim += dt
        if (sinceSwim >= SWIM_INTERVAL) { sinceSwim = 0; play('swim') }
      } else {
        // Reset rather than freeze, so pushing off after treading water
        // starts a stroke instead of finishing a half-elapsed one.
        sinceSwim = SWIM_INTERVAL
      }

      /*
       * ---- the trickle of a run of water you can HEAR but not be in ----
       *
       * Vanilla, BlockLiquid.randomDisplayTick (MCP-919):
       *
       *     if (this.blockMaterial == Material.water) {
       *         int i = state.getValue(LEVEL);
       *         if (i > 0 && i < 8) {
       *             if (rand.nextInt(64) == 0) {
       *                 worldIn.playSound(x + 0.5, y + 0.5, z + 0.5,
       *                     "liquid.water", rand.nextFloat() * 0.25F + 0.75F,
       *                     rand.nextFloat() * 1.0F + 0.5F, false);
       *             }
       *         }
       *     }
       *
       * `i > 0 && i < 8` is FLOWING water specifically -- a source is 0 and a
       * still pool never makes this noise. It is the sound of a run, which is
       * exactly the thing that just got a shape.
       *
       * No new sample and no change to build-sounds.mjs: `liquid/water.ogg` is
       * already extracted, and sounds.js already declares it as `waterAmbient`
       * for the submerged ambience. Same event, second trigger. (Checked
       * before planning to add one, which is the cheap half of this.)
       *
       * THE SAMPLING RATE IS DERIVED, not guessed. RenderGlobal calls
       * randomDisplayTick on 667 random positions in a 32^3 box around the
       * camera every tick, and each flowing cell it lands on rolls 1/64. This
       * cannot afford 667 getBlock calls per tick, so it takes SAMPLES of them
       * and raises the probability to keep the expected rate identical:
       *     p = 667 / (64 * SAMPLES)
       * With 32 samples that is 0.326. Same sound, same frequency, one
       * twentieth of the reads.
       *
       * SILENT IN THE FREE BUILD, and that is worth stating rather than
       * discovering. `npm run sounds:free` has no liquid sample of any kind --
       * sounds-src/free carries footsteps, digging, damage and two UI clicks
       * and nothing else -- so the deploy has no splash, no swim and now no
       * trickle. play() on a missing set is already a no-op, so this is quiet
       * rather than broken, which is the same bargain every other water sound
       * in this block already made.
       */
      if (flowMeta) {
        for (let n = 0; n < FLOW_SOUND_SAMPLES; n++) {
          const p = noa.ents.getPosition(noa.playerEntity)
          const x = Math.floor(p[0]) + rand16()
          const y = Math.floor(p[1]) + rand16()
          const z = Math.floor(p[2]) + rand16()
          const m = flowMeta(noa.getBlock(x, y, z))
          if (!m || m.fluid !== 'water' || m.level === 0 || m.falling) continue
          if (Math.random() < FLOW_SOUND_CHANCE) { play('waterAmbient'); break }
        }
      }

      /* ---- the ambience under it all ---- */
      if (eyes === 'water') {
        untilAmbient -= dt
        if (untilAmbient <= 0) { untilAmbient = ambientGap(); play('waterAmbient') }
      } else {
        untilAmbient = ambientGap()
      }

      /* ---- lava ---- */
      if (feet === 'lava') {
        untilLavaPop -= dt
        if (untilLavaPop <= 0) {
          untilLavaPop = 0.5 + Math.random() * 2.5
          // block.lava.pop is the crackle and block.lava.ambient is the roar.
          // Vanilla fires pop from the block and ambient from the fluid; both
          // are flat here because you are standing in it.
          play(Math.random() < 0.7 ? 'lavaPop' : 'lavaAmbient')
        }
      } else {
        untilLavaPop = 0
      }

      /*
       * The air meter losing a bubble. Watched rather than subscribed to:
       * survival.js emits nothing for it, and the HUD draws ten bubbles off
       * the same clamped counter, so counting them here is reading exactly
       * what the player can see. Only on the way DOWN -- refilling is silent
       * in vanilla too.
       */
      if (survival && eyes === 'water') {
        const bubbles = Math.ceil((survival.air * MC.AIR_BUBBLES) / MC.AIR_TICKS)
        if (lastBubbles !== null && bubbles < lastBubbles) play('breath')
        lastBubbles = bubbles
      } else {
        lastBubbles = null
      }

      wasFeet = feet
      wasEyes = eyes
    }

    noa.on('tick', onFluidTick)
    unsubscribe.push(() => noa.off('tick', onFluidTick))
  }

  if (movement) {
    // Non-positional: it's your own feet. A panner would put them a fraction of
    // a block below the listener and pan them as you look down.
    unsubscribe.push(movement.onFootstep(({ blockId }) => play('step', blockId)))
    unsubscribe.push(movement.onLand(({ blockId, speed }) => {
      // Below this you didn't fall, you brushed the ground -- resting against
      // a ledge or stepping down a fraction of a block re-fires the contact.
      // A real jump lands at ~8.9 b/s, so this only filters the noise.
      if (speed > LAND_MIN_SPEED) play('land', blockId)
    }))
  }

  return {
    play,
    groupForBlock,
    /*
     * The mapping itself, for the console and for the test suite. `unmapped`
     * is the one that matters: it is the same list scripts/build-sounds.mjs
     * refuses to build against, asked at runtime, so a block added after the
     * last sound build still gets caught.
     */
    groups: SOUND_GROUPS,
    ruleForKey: soundRuleForKey,
    unmapped: unmappedBlocks,
    /*
     * The underwater bed, for the console and for the test suite. `synthetic`
     * is the one that matters: it says whether this build is playing Mojang's
     * recording or the filtered-noise stand-in, which is the difference
     * between a local run and a deploy and is otherwise unanswerable from
     * outside the audio graph.
     */
    get underwaterBed() {
      return { running: !!bedGain, synthetic: bedSynthetic, gain: bedGain?.gain.value ?? 0 }
    },
    /** 'off' until the gesture gate fires, then the real AudioContext state. */
    get state() { return ctx ? ctx.state : 'off' },
    get context() { return ctx },
    get manifest() { return manifest },
    get decoded() { return buffers.size },
    get decodeErrors() { return decodeErrors },
    /*
     * Which sample the last play() actually reached for, as
     * { event, set, name }. Here because the graph can't answer it: a started
     * AudioBufferSourceNode exposes a decoded buffer, not the file it came
     * from, and hurt and death share a sample set -- so "did dying make a
     * different sound than getting hit" is otherwise unanswerable from
     * outside. Null until something plays.
     */
    get lastPlayed() { return lastPlayed },
    /** Resolves once the samples are fetched; decoding still waits on a gesture. */
    ready: () => loading,
    dispose() { unsubscribe.forEach(fn => fn()) },
  }
}
