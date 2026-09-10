import { ARMOR_SLOTS } from './items.js'

/*
 * The recipe book. Data only -- crafting.js is what matches it.
 *
 * Recipes name items by KEY, not by id, because that is how vanilla's own
 * recipe JSON reads and because a table of 120 numbers is unreviewable. Keys
 * are resolved to ids once, at load, by crafting.js.
 *
 * Two shapes, matching Minecraft exactly:
 *
 *   shaped     a pattern of rows. Position matters relative to the other
 *              ingredients, but NOT relative to the grid -- see crafting.js.
 *   shapeless  a bag of ingredients in any arrangement.
 *
 * An ingredient is either an item key ("iron_ingot") or a TAG ("#planks"),
 * which stands for any one of a set. Tags are what make one stick recipe
 * cover twelve woods instead of twelve recipes covering one each -- and they
 * are vanilla's own mechanism, not an invention here.
 *
 * WHAT IS DELIBERATELY ABSENT: anything that needs a furnace (glass, ingots
 * from ore, charcoal, terracotta, smooth stone), anything that needs dye
 * (coloured wool, concrete, stained glass), anything needing slabs or other
 * non-cube blocks as an INGREDIENT (barrel, chiseled variants), netherite
 * gear, which is smithing rather than crafting, and the chest and the shield,
 * neither of which has an item sprite to draw (see items.js). Each is a separate system,
 * and a recipe whose ingredient can never exist is worse than no recipe.
 */

/* ------------------------------------------------------------------ *
 * Tags
 * ------------------------------------------------------------------ */

const WOODS = [
  // [tag prefix, planks key, log-shaped blocks that make those planks]
  ['oak', 'planks', ['oak_log', 'stripped_oak_log', 'oak_wood', 'stripped_oak_wood']],
  ['spruce', 'spruce_planks', ['spruce_log', 'stripped_spruce_log', 'spruce_wood', 'stripped_spruce_wood']],
  ['birch', 'birch_planks', ['birch_log', 'stripped_birch_log', 'birch_wood', 'stripped_birch_wood']],
  ['jungle', 'jungle_planks', ['jungle_log', 'stripped_jungle_log', 'jungle_wood', 'stripped_jungle_wood']],
  ['acacia', 'acacia_planks', ['acacia_log', 'stripped_acacia_log', 'acacia_wood', 'stripped_acacia_wood']],
  ['dark_oak', 'dark_oak_planks', ['dark_oak_log', 'stripped_dark_oak_log', 'dark_oak_wood', 'stripped_dark_oak_wood']],
  ['mangrove', 'mangrove_planks', ['mangrove_log', 'stripped_mangrove_log', 'mangrove_wood', 'stripped_mangrove_wood']],
  ['cherry', 'cherry_planks', ['cherry_log', 'stripped_cherry_log', 'cherry_wood', 'stripped_cherry_wood']],
  ['pale_oak', 'pale_oak_planks', ['pale_oak_log', 'stripped_pale_oak_log', 'pale_oak_wood', 'stripped_pale_oak_wood']],
  ['crimson', 'crimson_planks', ['crimson_stem', 'stripped_crimson_stem', 'crimson_hyphae', 'stripped_crimson_hyphae']],
  ['warped', 'warped_planks', ['warped_stem', 'stripped_warped_stem', 'warped_hyphae', 'stripped_warped_hyphae']],
]

export const TAGS = {
  planks: [...WOODS.map(([, planks]) => planks), 'bamboo_planks'],
  logs: WOODS.flatMap(([, , logs]) => logs),
  coals: ['coal', 'charcoal'],
  /*
   * Vanilla splits these two even though they currently list the same three
   * blocks: #stone_tool_materials is what a stone pickaxe is made of,
   * #stone_crafting_materials is what a furnace is made of. Kept split
   * because they are different questions and have diverged before.
   */
  stone_tool_materials: ['cobblestone', 'blackstone', 'cobbled_deepslate'],
  stone_crafting_materials: ['cobblestone', 'blackstone', 'cobbled_deepslate'],
}

for (const [wood, , logs] of WOODS) TAGS[`${wood}_logs`] = logs

/* ------------------------------------------------------------------ *
 * Builders
 * ------------------------------------------------------------------ */

const shaped = (result, count, pattern, key) => ({ type: 'shaped', result, count, pattern, key })
const shapeless = (result, count, ingredients) => ({ type: 'shapeless', result, count, ingredients })

/** The 2x2 "four of X make one Y" that half of Minecraft's block recipes are. */
const square4 = (result, from, count = 1) =>
  shaped(result, count, ['XX', 'XX'], { X: from })

/** The 3x3 "nine of X make a block of X", and the shapeless way back. */
const packed9 = (block, unit, backCount = 9) => [
  shaped(block, 1, ['XXX', 'XXX', 'XXX'], { X: unit }),
  shapeless(unit, backCount, [block]),
]

/* ------------------------------------------------------------------ *
 * Wood
 * ------------------------------------------------------------------ */

const WOOD_RECIPES = [
  ...WOODS.map(([wood, planks]) => shapeless(planks, 4, [`#${wood}_logs`])),
  // Bamboo is the one wood you cannot get planks from a log of: the block is
  // nine bamboo, and it yields two planks rather than four.
  shaped('bamboo_block', 1, ['XXX', 'XXX', 'XXX'], { X: 'bamboo' }),
  shapeless('bamboo_planks', 2, ['bamboo_block']),

  // The four "wood"/"hyphae" blocks are 2x2 of the matching log, all-bark.
  ...WOODS.map(([wood, , logs]) => square4(logs[2], logs[0], 3)),

  shaped('stick', 4, ['X', 'X'], { X: '#planks' }),
]

/* ------------------------------------------------------------------ *
 * Tools and armor
 *
 * Generated, because the five tool shapes and four armor shapes are identical
 * across every material -- writing them out is 45 near-identical blocks in
 * which exactly one character differs, which is where a transcription error
 * hides. The shapes themselves are vanilla's, character for character.
 * ------------------------------------------------------------------ */

const TOOL_PATTERNS = {
  pickaxe: ['XXX', ' # ', ' # '],
  axe: ['XX', 'X#', ' #'],
  shovel: ['X', '#', '#'],
  hoe: ['XX', ' #', ' #'],
  sword: ['X', 'X', '#'],
}

const ARMOR_PATTERNS = {
  helmet: ['XXX', 'X X'],
  chestplate: ['X X', 'XXX', 'XXX'],
  leggings: ['XXX', 'X X', 'X X'],
  boots: ['X X', 'X X'],
}

/** [item-key prefix, the ingredient one piece is made of]. */
const TOOL_MATERIALS = [
  ['wooden', '#planks'],
  ['stone', '#stone_tool_materials'],
  ['iron', 'iron_ingot'],
  ['golden', 'gold_ingot'],
  ['diamond', 'diamond'],
]

const ARMOR_MATERIALS = [
  ['leather', 'leather'],
  ['iron', 'iron_ingot'],
  ['golden', 'gold_ingot'],
  ['diamond', 'diamond'],
]

const GEAR_RECIPES = [
  ...TOOL_MATERIALS.flatMap(([prefix, X]) =>
    Object.entries(TOOL_PATTERNS).map(([tool, pattern]) =>
      shaped(`${prefix}_${tool}`, 1, pattern, { X, '#': 'stick' }))),

  ...ARMOR_MATERIALS.flatMap(([prefix, X]) =>
    ARMOR_SLOTS.map(slot => shaped(`${prefix}_${slot}`, 1, ARMOR_PATTERNS[slot], { X }))),

  shaped('shears', 1, [' X', 'X '], { X: 'iron_ingot' }),
  shaped('bucket', 1, ['X X', ' X '], { X: 'iron_ingot' }),
  shaped('bowl', 4, ['X X', ' X '], { X: '#planks' }),
  shaped('bow', 1, [' XS', 'X S', ' XS'], { X: 'stick', S: 'string' }),
  shaped('arrow', 4, ['F', 'S', 'E'], { F: 'flint', S: 'stick', E: 'feather' }),
  shaped('fishing_rod', 1, ['  X', ' XS', 'X S'], { X: 'stick', S: 'string' }),
  shapeless('flint_and_steel', 1, ['iron_ingot', 'flint']),
]

/* ------------------------------------------------------------------ *
 * Blocks, and the things you make out of stone
 * ------------------------------------------------------------------ */

const BLOCK_RECIPES = [
  shaped('crafting_table', 1, ['XX', 'XX'], { X: '#planks' }),
  shaped('furnace', 1, ['XXX', 'X X', 'XXX'], { X: '#stone_crafting_materials' }),
  shaped('blast_furnace', 1, ['III', 'IFI', 'SSS'], { I: 'iron_ingot', F: 'furnace', S: 'smooth_stone' }),
  shaped('smoker', 1, [' L ', 'LFL', ' L '], { L: '#logs', F: 'furnace' }),
  shaped('bookshelf', 1, ['XXX', 'BBB', 'XXX'], { X: '#planks', B: 'book' }),
  shaped('loom', 1, ['SS', 'XX'], { S: 'string', X: '#planks' }),
  shaped('cartography_table', 1, ['PP', 'XX', 'XX'], { P: 'paper', X: '#planks' }),
  shaped('fletching_table', 1, ['FF', 'XX', 'XX'], { F: 'flint', X: '#planks' }),
  shaped('smithing_table', 1, ['II', 'XX', 'XX'], { I: 'iron_ingot', X: '#planks' }),
  shaped('jukebox', 1, ['XXX', 'XDX', 'XXX'], { X: '#planks', D: 'diamond' }),
  shaped('note_block', 1, ['XXX', 'XRX', 'XXX'], { X: '#planks', R: 'redstone' }),
  shaped('ladder', 3, ['S S', 'SSS', 'S S'], { S: 'stick' }),

  // Redstone-adjacent. None of them DO anything here -- there is no redstone
  // simulation -- but they are blocks in the palette and these are their
  // recipes, so leaving them out would be an arbitrary hole.
  shaped('piston', 1, ['XXX', 'CIC', 'CRC'],
    { X: '#planks', C: 'cobblestone', I: 'iron_ingot', R: 'redstone' }),
  shapeless('sticky_piston', 1, ['piston', 'slime_ball']),
  shaped('observer', 1, ['CCC', 'RRQ', 'CCC'], { C: 'cobblestone', R: 'redstone', Q: 'quartz' }),
  shaped('dispenser', 1, ['CCC', 'CBC', 'CRC'], { C: 'cobblestone', B: 'bow', R: 'redstone' }),
  shaped('dropper', 1, ['CCC', 'C C', 'CRC'], { C: 'cobblestone', R: 'redstone' }),
  shaped('target', 1, [' R ', 'RHR', ' R '], { R: 'redstone', H: 'hay_block' }),
  shaped('redstone_lamp', 1, [' R ', 'RGR', ' R '], { R: 'redstone', G: 'glowstone' }),
  shaped('tnt', 1, ['GSG', 'SGS', 'GSG'], { G: 'gunpowder', S: 'sand' }),
  shaped('respawn_anchor', 1, ['OOO', 'GGG', 'OOO'], { O: 'crying_obsidian', G: 'glowstone' }),
  shaped('lodestone', 1, ['SSS', 'SNS', 'SSS'], { S: 'chiseled_stone_bricks', N: 'netherite_ingot' }),

  // Torch and the pumpkin lamp. `#coals` is why charcoal works too.
  shaped('torch', 4, ['C', 'S'], { C: '#coals', S: 'stick' }),
  shapeless('jack_o_lantern', 1, ['carved_pumpkin', 'torch']),

  // Stone-cutting by hand: the 2x2 that turns rough into polished.
  square4('stone_bricks', 'stone', 4),
  square4('polished_andesite', 'andesite', 4),
  square4('polished_diorite', 'diorite', 4),
  square4('polished_granite', 'granite', 4),
  square4('polished_blackstone', 'blackstone', 4),
  square4('polished_blackstone_bricks', 'polished_blackstone', 4),
  square4('polished_deepslate', 'cobbled_deepslate', 4),
  square4('deepslate_bricks', 'polished_deepslate', 4),
  square4('deepslate_tiles', 'deepslate_bricks', 4),
  square4('polished_tuff', 'tuff', 4),
  square4('tuff_bricks', 'polished_tuff', 4),
  square4('sandstone', 'sand', 1),
  square4('cut_sandstone', 'sandstone', 4),
  square4('red_sandstone', 'red_sand', 1),
  square4('cut_red_sandstone', 'red_sandstone', 4),
  square4('quartz_block', 'quartz', 1),
  square4('quartz_bricks', 'quartz_block', 4),
  square4('end_stone_bricks', 'end_stone', 4),
  square4('nether_bricks', 'nether_brick', 1),
  square4('bricks', 'brick', 1),
  square4('mud_bricks', 'packed_mud', 4),
  square4('amethyst_block', 'amethyst_shard', 1),
  square4('clay', 'clay_ball', 1),
  square4('white_wool', 'string', 1),
  square4('cut_copper', 'copper_block', 4),
  square4('exposed_cut_copper', 'exposed_copper', 4),
  square4('weathered_cut_copper', 'weathered_copper', 4),
  square4('oxidized_cut_copper', 'oxidized_copper', 4),

  shaped('quartz_pillar', 2, ['Q', 'Q'], { Q: 'quartz_block' }),
  shaped('purpur_pillar', 2, ['P', 'P'], { P: 'purpur_block' }),
  shapeless('andesite', 2, ['diorite', 'cobblestone']),
  shapeless('granite', 1, ['diorite', 'quartz']),
  shaped('diorite', 2, ['QC', 'CQ'], { Q: 'quartz', C: 'cobblestone' }),
  shapeless('packed_mud', 1, ['mud', 'wheat']),
  shaped('tinted_glass', 2, [' A ', 'AGA', ' A '], { A: 'amethyst_shard', G: 'glass' }),

  shaped('paper', 3, ['SSS'], { S: 'sugar_cane' }),
  shapeless('book', 1, ['paper', 'paper', 'paper', 'leather']),

  // Storage blocks, both ways. `packed9` writes the pair, because a block
  // that cannot be unpacked is the classic half-implemented recipe.
  ...packed9('coal_block', 'coal'),
  ...packed9('iron_block', 'iron_ingot'),
  ...packed9('gold_block', 'gold_ingot'),
  ...packed9('copper_block', 'copper_ingot'),
  ...packed9('diamond_block', 'diamond'),
  ...packed9('emerald_block', 'emerald'),
  ...packed9('redstone_block', 'redstone'),
  ...packed9('lapis_block', 'lapis_lazuli'),
  ...packed9('netherite_block', 'netherite_ingot'),
  ...packed9('raw_iron_block', 'raw_iron'),
  ...packed9('raw_gold_block', 'raw_gold'),
  ...packed9('raw_copper_block', 'raw_copper'),
  ...packed9('slime_block', 'slime_ball'),
  ...packed9('hay_block', 'wheat'),

  // Nuggets are the one storage pair that is nine-to-one in the other
  // direction: nine nuggets make an ingot, one ingot makes nine nuggets.
  shaped('iron_ingot', 1, ['NNN', 'NNN', 'NNN'], { N: 'iron_nugget' }),
  shapeless('iron_nugget', 9, ['iron_ingot']),
  shaped('gold_ingot', 1, ['NNN', 'NNN', 'NNN'], { N: 'gold_nugget' }),
  shapeless('gold_nugget', 9, ['gold_ingot']),
]

export const RECIPES = [...WOOD_RECIPES, ...GEAR_RECIPES, ...BLOCK_RECIPES]
