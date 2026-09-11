import { BLOCK_TYPES, BLOCK_BY_ID } from './blocks.js'
import { MC } from './physics.js'

/*
 * The item registry.
 *
 * Everything holdable is an ITEM. Some items place a block; most do not. That
 * distinction is the whole reason this file exists: the inventory used to
 * store block ids, which worked only for as long as every holdable thing
 * happened to be a block. A stick is not a block and never will be, so the
 * first recipe that produces one breaks the model rather than extending it.
 *
 * So: `stack.id` is an ITEM id, and placing asks the item what block it
 * places. `itemPlaces(id)` answers 0 for a stick, a pickaxe, a torch and
 * anything else the world cannot hold as a voxel.
 *
 * ITEM IDS SHARE THE BLOCK NUMBER SPACE. Every block's item has the SAME id
 * as the block -- item 4 is cobblestone and places block 4 -- and items with
 * no block start at ITEM_BASE, well clear of the 355 blocks in the table.
 *
 * That is deliberate and it is what Minecraft itself did before the flattening:
 * numeric ids 1-255 were blocks, 256+ were items, and an item id below 256
 * meant "the block of the same number". Two independent numberings would have
 * been tidier on paper and would have meant rewriting every existing call site
 * -- interact.js adds a block drop by block id, main.js seeds the hotbar by
 * block id, and the test suite asserts on those numbers. A renumbering that
 * touches files this change does not own, to express a fact (item 4 places
 * block 4) that is true anyway, buys nothing.
 *
 * Item ids are WORLD DATA the moment anything is saved. Append, never
 * renumber -- same rule as blocks.js, and for the same reason.
 */

/**
 * Where item ids that have no block begin.
 *
 * 1000 rather than 356 so the block table can keep growing (it went 18 -> 355
 * in one commit) without ever colliding, and so a bare id in a debugger says
 * which registry it came from at a glance.
 */
const ITEM_BASE = 1000

/** Minecraft's default stack size. Tools and armor override it to 1. */
const DEFAULT_STACK = 64

/* ------------------------------------------------------------------ *
 * Tool materials.
 *
 * `speed` is Minecraft's Tiers.getSpeed(): the multiplier applied to mining
 * rate when the tool is correct for the block. `level` is the harvest tier
 * that decides whether a block drops anything at all (stone 1, iron 2,
 * diamond 3, netherite 4). `attack` is the item's attack damage attribute --
 * the player's own base 1 is added on top, which is why a wooden sword reads
 * as 4 in the tooltip and 3 here.
 *
 * `speed` and `level` are read by `miningSeconds` and `canHarvest` at the
 * bottom of this file, which is where Minecraft's break-time formula lives.
 * They were defined and deliberately unwired for one commit, because the raw
 * hardness the formula needs did not exist yet.
 *
 * `attack` AND `uses` ARE READ BY NOTHING, AND THAT IS SETTLED -- it does not
 * need re-litigating on the next sweep. Vanilla's Tier record carries all
 * four, and keeping the table whole is what makes it checkable against the
 * wiki at a glance; two of the four happened to be the two this world needed
 * first. `attack` is combat, which docs/FUTURE.md files under "Not worth
 * building" deliberately. `uses` is durability, which nothing has ruled out
 * and which is a MINING feature rather than a combat one -- a pickaxe wearing
 * out is much the likelier of the two to land.
 *
 * What is NOT fine is a caller having to guess which of the four matter, so
 * `toolOf` names the two it returns rather than spreading the row into its
 * result. The table is reference data; the function's shape is the API.
 */
const TIERS = {
  wood: { level: 0, speed: 2, attack: 3, uses: 59 },
  stone: { level: 1, speed: 4, attack: 4, uses: 131 },
  iron: { level: 2, speed: 6, attack: 5, uses: 250 },
  // Gold is the joke tier: fastest in the game and made of wet paper.
  gold: { level: 0, speed: 12, attack: 3, uses: 32 },
  diamond: { level: 3, speed: 8, attack: 6, uses: 1561 },
  netherite: { level: 4, speed: 9, attack: 7, uses: 2031 },
}

/*
 * Armor materials, in Minecraft's own numbers: defense points per piece and
 * armor toughness. Both feed the damage formula in armor.js -- points are the
 * bar you see, toughness is what stops a big hit from punching through it.
 *
 * Chainmail and netherite have no crafting recipe in vanilla (chainmail is
 * loot only, netherite is smithing). They exist here anyway because the armor
 * SLOTS have to handle them, and because leaving them out would mean the tier
 * table and the recipe table disagreed about what armor is.
 */
const ARMOR_MATERIALS = {
  leather: { helmet: 1, chestplate: 3, leggings: 2, boots: 1, toughness: 0 },
  chainmail: { helmet: 2, chestplate: 5, leggings: 4, boots: 1, toughness: 0 },
  iron: { helmet: 2, chestplate: 6, leggings: 5, boots: 2, toughness: 0 },
  gold: { helmet: 2, chestplate: 5, leggings: 3, boots: 1, toughness: 0 },
  diamond: { helmet: 3, chestplate: 8, leggings: 6, boots: 3, toughness: 2 },
  netherite: { helmet: 3, chestplate: 8, leggings: 6, boots: 3, toughness: 3 },
}

/** The four armor slots, in the order the inventory sprite draws them. */
export const ARMOR_SLOTS = ['helmet', 'chestplate', 'leggings', 'boots']

/*
 * Vanilla's item keys are not derived from the material name in one rule:
 * gold is "golden_" on tools and armor, and leather armor is the only set
 * whose pieces are not <material>_<piece>. Both are spelled out rather than
 * special-cased in a template, because the key IS the texture file name and a
 * clever rule that is wrong gives you a 404 instead of an error.
 */
const TOOL_PREFIX = { wood: 'wooden', stone: 'stone', iron: 'iron', gold: 'golden', diamond: 'diamond', netherite: 'netherite' }

/* ------------------------------------------------------------------ *
 * The items that are not blocks.
 *
 * `texture` is a vanilla item texture name
 * (`assets/minecraft/textures/item/<name>.png`), keyed the same way blocks.js
 * keys block textures, so one build pipeline can serve both. It defaults to
 * the item's key, which is right for all but a handful.
 * ------------------------------------------------------------------ */

const MATERIALS = [
  'stick', 'coal', 'charcoal', 'iron_ingot', 'gold_ingot', 'copper_ingot',
  'netherite_ingot', 'netherite_scrap', 'iron_nugget', 'gold_nugget',
  'diamond', 'emerald', 'lapis_lazuli', 'redstone', 'quartz', 'amethyst_shard',
  'raw_iron', 'raw_gold', 'raw_copper', 'flint', 'clay_ball', 'brick',
  'nether_brick', 'leather', 'string', 'feather', 'gunpowder', 'paper',
  'book', 'wheat', 'sugar_cane', 'bamboo', 'slime_ball',
].map(key => ({ key, name: titleCase(key) }))

/*
 * Items that would be blocks in Minecraft but cannot be here.
 *
 * A torch and a ladder are both non-cube geometry, and this world is
 * 355 full cubes -- noa supports custom block meshes via `blockMesh` and
 * nothing here uses it yet (docs/FUTURE.md calls that out as the thing
 * standing between this and importing real builds). So they craft, they
 * stack, they sit in the inventory, and `itemPlaces` says 0.
 *
 * Including them rather than dropping their recipes is the deliberate choice:
 * a torch recipe that produces nothing is a hole a visitor notices, while an
 * item that exists and cannot yet be placed is exactly what it looks like --
 * a block that hasn't been modelled. When blockMesh lands, these gain a
 * `places` and every recipe below is already correct.
 */
const UNPLACEABLE = [
  // `from: 'block'` because that is where vanilla keeps their art too:
  // models/item/torch.json is an `item/generated` whose layer0 is
  // `block/torch`. There is no textures/item/torch.png in the game.
  { key: 'torch', name: 'Torch', from: 'block' },
  { key: 'ladder', name: 'Ladder', from: 'block' },
]

/*
 * NOT HERE, and the reason is the same for both: a CHEST and a SHIELD have no
 * flat 16x16 sprite anywhere in Minecraft. Both are drawn from an entity
 * model (textures/entity/chest/normal.png, textures/entity/shield_base.png)
 * wrapped around geometry, so there is nothing to blit into a slot. Faking
 * one by cropping the entity sheet gives you a smear that reads as a bug, and
 * neither has a block in this world's palette to place anyway. Their recipes
 * are absent for the same reason -- see recipes.js.
 */

/*
 * `model` is the vanilla item model PARENT, and it is here rather than in the
 * renderer because it is a fact about the item, not about the view. It decides
 * the display transform an extruded sprite is held with -- see DISPLAY in
 * itemModel.js. Absent means `item/generated`, which is vanilla's default and
 * covers every ingot, gem and lump below.
 *
 * The distinction is only visible in THIRD person. `item/handheld` rotates the
 * sprite -90 about Y and 55 about Z and scales it to 0.85, which is what lays
 * a blade along the fist; `item/generated` leaves it unrotated at 0.55, which
 * is what makes an ingot sit flat. Both share firstperson_righthand verbatim.
 */
const TOOLS = []
for (const [tier, prefix] of Object.entries(TOOL_PREFIX)) {
  for (const tool of ['pickaxe', 'axe', 'shovel', 'hoe', 'sword']) {
    TOOLS.push({ key: `${prefix}_${tool}`, name: `${titleCase(prefix)} ${titleCase(tool)}`, tier, tool, stack: 1, model: 'handheld' })
  }
}

const ARMOR = []
for (const [material, points] of Object.entries(ARMOR_MATERIALS)) {
  const prefix = material === 'gold' ? 'golden' : material
  for (const slot of ARMOR_SLOTS) {
    ARMOR.push({
      key: `${prefix}_${slot}`, name: `${titleCase(prefix)} ${titleCase(slot)}`,
      stack: 1,
      armor: { slot, material, points: points[slot], toughness: points.toughness },
    })
  }
}

const GEAR = [
  // Model parents copied from the vanilla files one at a time rather than
  // inferred from "is it a tool", because the answer is not derivable: shears
  // and flint and steel are handheld, a bucket and a bow are not.
  { key: 'shears', name: 'Shears', stack: 1, model: 'handheld' },
  { key: 'flint_and_steel', name: 'Flint and Steel', stack: 1, model: 'handheld' },
  { key: 'bucket', name: 'Bucket', stack: 16 },
  { key: 'bowl', name: 'Bowl' },
  /*
   * Vanilla's bow.json is item/generated with its OWN thirdperson override
   * (rotation [-80, 260, -40]) so it points away from you as if nocked. Left
   * as plain generated here: reproducing it means a fourth entry in DISPLAY
   * for one item that cannot be drawn, and generated is the honest parent.
   */
  { key: 'bow', name: 'Bow', stack: 1 },
  { key: 'arrow', name: 'Arrow' },
  // handheld_rod is handheld mirrored in Y and pushed 2 units further out --
  // the rod sticks forward past the fist instead of lying across it.
  { key: 'fishing_rod', name: 'Fishing Rod', stack: 1, model: 'handheld_rod' },
]

function titleCase(key) {
  return key.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')
}

/* ------------------------------------------------------------------ *
 * Assembly
 * ------------------------------------------------------------------ */

/** Every block, as an item that places itself. */
const BLOCK_ITEMS = BLOCK_TYPES.map(b => ({
  id: b.id, key: b.key, name: b.name, places: b.id, block: b,
}))

const NON_BLOCK = [...MATERIALS, ...UNPLACEABLE, ...TOOLS, ...ARMOR, ...GEAR]
  .map((def, i) => ({
    id: ITEM_BASE + i,
    places: 0,
    texture: def.texture ?? def.key,
    // Which vanilla texture directory the sprite comes out of.
    from: 'item',
    stack: DEFAULT_STACK,
    ...def,
  }))

export const ITEMS = [...BLOCK_ITEMS, ...NON_BLOCK]

const ITEM_BY_ID = new Map(ITEMS.map(i => [i.id, i]))
export const ITEM_BY_KEY = new Map(ITEMS.map(i => [i.key, i]))

// Same guard blocks.js applies to block ids, for the same reason: a duplicate
// key here means two items silently share a slot in every lookup below, and
// the symptom is a recipe producing the wrong thing three files away.
if (ITEM_BY_KEY.size !== ITEMS.length) {
  const seen = new Set()
  const dupe = ITEMS.find(i => seen.has(i.key) || (seen.add(i.key), false))
  throw new Error(`duplicate item key "${dupe?.key}"`)
}

/** id -> definition. Undefined for an id that was never registered. */
export const item = (id) => ITEM_BY_ID.get(id)

/** key -> id. Throws, because every caller is a hardcoded recipe or a test:
 *  a typo should stop the module evaluating, not resolve to undefined. */
export function itemId(key) {
  const def = ITEM_BY_KEY.get(key)
  if (!def) throw new Error(`no such item: "${key}"`)
  return def.id
}

/** The block this item places, or 0 for the many that place nothing. */
export const itemPlaces = (id) => ITEM_BY_ID.get(id)?.places ?? 0

/** Whether this item has a block, which is also whether it renders as a cube. */
export const isBlockItem = (id) => itemPlaces(id) !== 0

export const itemName = (id) => ITEM_BY_ID.get(id)?.name ?? String(id)

export const stackMax = (id) => ITEM_BY_ID.get(id)?.stack ?? DEFAULT_STACK

/** Tool data, or null. `tool` is the shape, `tier` the material. */
function toolOf(id) {
  const def = ITEM_BY_ID.get(id)
  if (!def?.tool) return null
  // Picked out rather than spread. Spreading the row also handed every caller
  // `attack` and `uses`, which nothing reads -- see the note on TIERS above.
  const { level, speed } = TIERS[def.tier]
  return { tool: def.tool, tier: def.tier, level, speed }
}

/** Armor data, or null. */
export const armorOf = (id) => ITEM_BY_ID.get(id)?.armor ?? null

/**
 * Every item texture the build pipeline has to produce, as
 * `{ name, from }` -- `from` being the vanilla texture subdirectory to read
 * it out of. Output is always `textures/item/<name>.png`.
 *
 * Exported for the same reason blocks.js exports MATERIALS: so the build
 * script reads the list from the one file that defines it instead of keeping
 * a parallel copy that drifts. Block items are absent -- they render as CSS
 * cubes off the block textures that already exist.
 */
export const ITEM_TEXTURES = NON_BLOCK.map(({ texture, from }) => ({ name: texture, from }))

/*
 * Sanity: every block item must resolve back to its block. Cheap, and it
 * catches the one mistake that would be invisible -- BLOCK_TYPES growing a
 * gap after this module was written.
 */
for (const i of BLOCK_ITEMS) {
  if (!BLOCK_BY_ID.has(i.places)) throw new Error(`item "${i.key}" places unknown block ${i.places}`)
}

/* ------------------------------------------------------------------ *
 * Mining: which tool, how fast, and whether anything drops.
 *
 * This is the other half of the TIERS table above, which sat defined and
 * unread until blocks.js started keeping `rawHardness` and `requiresTool`
 * alongside the bare-handed seconds. With those two, Minecraft's real formula
 * drops straight in -- no approximation, no second table of hand-tuned times.
 *
 * THE FORMULA, from Player.getDestroySpeed and BlockState.getDestroyProgress:
 *
 *   speed      = the tool's tier speed if the tool suits the BLOCK, else 1
 *   canHarvest = the block needs no tool, OR the tool suits it AND the tier
 *                level is high enough
 *   ticks      = ceil(rawHardness * (canHarvest ? 30 : 100) / speed)
 *
 * Three things in there are easy to get wrong and all three are deliberate:
 *
 * 1. SPEED DOES NOT CHECK THE TIER. DiggerItem.getDestroySpeed returns the
 *    tier's speed whenever the block is in the tool's mineable tag, whatever
 *    the harvest level. So a wooden pickaxe on diamond ore really is faster
 *    than a bare hand -- it is simply faster at producing nothing.
 * 2. THE 30 vs 100 IS THE WHOLE PENALTY. Mining something you cannot harvest
 *    takes 3.33x as long as mining it with the right tier, and that single
 *    branch is where blocks.js's `hardness * 5` bare-handed numbers came from
 *    (100/20 = 5 seconds per point of hardness at speed 1).
 * 3. TIMES ARE QUANTISED TO WHOLE TICKS. Progress accumulates once a tick and
 *    the block pops when it crosses 1, so stone with an iron pickaxe is 8
 *    ticks (0.4s), not 7.5 -- which is exactly the number the wiki prints.
 *
 * Verified against the wiki's stone row: hand 7.5, wooden 1.15, stone 0.6,
 * iron 0.4, diamond 0.3, netherite 0.25, gold 0.2. All seven come out exact.
 *
 * Enchantments, haste, being underwater and mining in mid-air are all absent.
 * Each is another multiplier in the same expression, and none of them exist in
 * this world yet.
 * ------------------------------------------------------------------ */

/*
 * Which tool suits which block.
 *
 * Vanilla answers this with block TAGS -- mineable/pickaxe, mineable/axe and
 * so on -- which are data files this project does not ship. So it is derived
 * from the block key instead, in the order below, and the order is what makes
 * it work: snow_block and the concrete powders are `requiresTool` blocks that
 * want a SHOVEL, so the material rules have to be consulted before the
 * "requires a tool, so it must be stone" fallback.
 *
 * Derived rather than spelled out per block because the palette is 355 long
 * and grows by whole families at a time -- a table would be wrong the first
 * time someone adds a wood set. It is a guess for exactly the blocks where
 * being wrong costs nothing (no tool in this world speeds up glass or wool by
 * enough for anyone to notice) and exact for every block that gates a drop.
 */
const SHOVEL_KEYS = new Set([
  'grass', 'dirt', 'coarse_dirt', 'rooted_dirt', 'podzol', 'mycelium', 'mud',
  'gravel', 'sand', 'red_sand', 'clay', 'soul_sand', 'soul_soil', 'snow_block',
])
const AXE_KEYS = new Set([
  'planks', 'crafting_table', 'bookshelf', 'chiseled_bookshelf', 'barrel',
  'loom', 'cartography_table', 'fletching_table', 'smithing_table', 'jukebox',
  'note_block', 'beehive', 'bee_nest', 'melon', 'pumpkin', 'carved_pumpkin',
  'jack_o_lantern', 'brown_mushroom_block', 'red_mushroom_block',
  'mushroom_stem', 'bamboo_block', 'stripped_bamboo_block', 'bamboo_mosaic',
])
const HOE_KEYS = new Set([
  'hay_block', 'dried_kelp_block', 'sponge', 'wet_sponge', 'moss_block',
  'nether_wart_block', 'warped_wart_block', 'shroomlight', 'sculk',
  'sculk_catalyst', 'target',
])
/* Blocks a pickaxe helps with that do NOT require one to drop. */
const PICKAXE_KEYS = new Set(['ice', 'packed_ice', 'blue_ice'])

const endsWithAny = (key, parts) => parts.some(p => key.endsWith(p))

/** The tool class a block is mined with, or null if no tool helps. */
function toolForBlock(id) {
  const def = BLOCK_BY_ID.get(id)
  if (!def) return null
  const key = def.key
  if (SHOVEL_KEYS.has(key) || key.endsWith('_concrete_powder')) return 'shovel'
  if (AXE_KEYS.has(key) || endsWithAny(key, ['_planks', '_log', '_wood', '_stem', '_hyphae'])) return 'axe'
  if (HOE_KEYS.has(key) || key.endsWith('_leaves')) return 'hoe'
  if (key.endsWith('_wool')) return 'shears'
  if (def.requiresTool || PICKAXE_KEYS.has(key)) return 'pickaxe'
  return null
}

/*
 * Harvest level, from vanilla's needs_stone_tool / needs_iron_tool /
 * needs_diamond_tool block tags. Only consulted for blocks that require a tool
 * at all, so everything absent is level 0 -- a wooden pickaxe.
 *
 * Copper is a rule rather than a list because the copper family is eleven
 * blocks (ore, raw block, block, cut, chiseled, grate, bulb, and three
 * oxidation stages of most of those) that all sit at stone level.
 */
const NEEDS_STONE = new Set([
  'iron_ore', 'deepslate_iron_ore', 'iron_block', 'raw_iron_block',
  'lapis_ore', 'deepslate_lapis_ore', 'lapis_block',
])
const NEEDS_IRON = new Set([
  'gold_ore', 'deepslate_gold_ore', 'nether_gold_ore', 'gold_block', 'raw_gold_block',
  'redstone_ore', 'deepslate_redstone_ore',
  'diamond_ore', 'deepslate_diamond_ore', 'diamond_block',
  'emerald_ore', 'deepslate_emerald_ore', 'emerald_block',
])
const NEEDS_DIAMOND = new Set([
  'obsidian', 'crying_obsidian', 'netherite_block', 'ancient_debris', 'respawn_anchor',
])

/** The tier level needed to get a drop out of this block. */
function harvestLevel(id) {
  const key = BLOCK_BY_ID.get(id)?.key
  if (!key) return 0
  if (NEEDS_DIAMOND.has(key)) return 3
  if (NEEDS_IRON.has(key)) return 2
  if (NEEDS_STONE.has(key) || key.includes('copper')) return 1
  return 0
}

/**
 * DiggerItem.getDestroySpeed: the tier's speed when the tool suits the block,
 * 1 otherwise. A sword reads as 1 on everything here -- vanilla gives it 1.5
 * flat and 15 on cobwebs, neither of which is a block in this world.
 */
function destroySpeed(blockId, heldItemId) {
  const tool = toolOf(heldItemId)
  if (!tool) return 1
  return tool.tool === toolForBlock(blockId) ? tool.speed : 1
}

/**
 * Will this block give up its drop to this item? False is a real answer, not
 * an error: it is stone punched by hand, or diamond ore hit with stone.
 */
function canHarvest(blockId, heldItemId = 0) {
  const def = BLOCK_BY_ID.get(blockId)
  if (!def) return false
  if (!def.requiresTool) return true
  const tool = toolOf(heldItemId)
  if (!tool || tool.tool !== toolForBlock(blockId)) return false
  return tool.level >= harvestLevel(blockId)
}

/**
 * How long this block takes to break with this item, in seconds.
 * Infinity for bedrock, which is how interact.js already spells unbreakable.
 */
export function miningSeconds(blockId, heldItemId = 0) {
  const def = BLOCK_BY_ID.get(blockId)
  if (!def || !Number.isFinite(def.rawHardness)) return Infinity
  const ticks = def.rawHardness * (canHarvest(blockId, heldItemId) ? 30 : 100) /
    destroySpeed(blockId, heldItemId)
  // At least one tick. A hardness of 0 (TNT, slime) is instant in vanilla, and
  // instant here means one tick rather than a division by zero downstream.
  return Math.max(1, Math.ceil(ticks)) / MC.TICKS_PER_SECOND
}

/**
 * The item a broken block leaves on the floor, or 0 for nothing.
 *
 * blocks.js already knows that grass gives dirt and stone gives cobblestone.
 * What this adds is the tool gate in front of it: the block still breaks when
 * your tier is too low, it just leaves nothing behind.
 *
 * Ores drop THEMSELVES rather than coal, diamonds and lapis. That is silk
 * touch behaviour, it is what this world already did, and changing it means
 * an ore -> item table in a file this change does not own.
 */
export function dropFor(blockId, heldItemId = 0) {
  if (!canHarvest(blockId, heldItemId)) return 0
  const def = BLOCK_BY_ID.get(blockId)
  if (!def) return 0
  return def.drops ?? blockId
}
