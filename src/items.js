import { BLOCK_TYPES, BLOCK_BY_ID } from './blocks.js'

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
export const ITEM_BASE = 1000

/** Minecraft's default stack size. Tools and armor override it to 1. */
export const DEFAULT_STACK = 64

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
 * NOTHING READS `speed` YET. Mining lives in interact.js, which this change
 * does not own, so the numbers are defined and left unwired on purpose --
 * see the report for the one-line integration point.
 */
export const TIERS = {
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

const TOOLS = []
for (const [tier, prefix] of Object.entries(TOOL_PREFIX)) {
  for (const tool of ['pickaxe', 'axe', 'shovel', 'hoe', 'sword']) {
    TOOLS.push({ key: `${prefix}_${tool}`, name: `${titleCase(prefix)} ${titleCase(tool)}`, tier, tool, stack: 1 })
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
  { key: 'shears', name: 'Shears', stack: 1 },
  { key: 'flint_and_steel', name: 'Flint and Steel', stack: 1 },
  { key: 'bucket', name: 'Bucket', stack: 16 },
  { key: 'bowl', name: 'Bowl' },
  { key: 'bow', name: 'Bow', stack: 1 },
  { key: 'arrow', name: 'Arrow' },
  { key: 'fishing_rod', name: 'Fishing Rod', stack: 1 },
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

export const ITEM_BY_ID = new Map(ITEMS.map(i => [i.id, i]))
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
export function toolOf(id) {
  const def = ITEM_BY_ID.get(id)
  if (!def?.tool) return null
  return { tool: def.tool, tier: def.tier, ...TIERS[def.tier] }
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
