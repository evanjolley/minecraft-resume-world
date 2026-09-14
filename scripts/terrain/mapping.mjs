#!/usr/bin/env node
/*
 * Turns a `minecraft:` block id into a key from src/blocks.js, or says why it
 * cannot.
 *
 * The engine renders full cubes. That single fact decides most of this file:
 * anything vanilla draws as a cross, a stalk, a layer, a pane or a fitted
 * model has no representation here, and pretending otherwise would put a
 * solid cube of grass-blade texture in the world. Those become air and are
 * REPORTED, because a silent drop is how a forest floor quietly loses its
 * undergrowth and nobody can say when.
 *
 * Identity is the fallback, not the rule. Most stone-family names match a
 * key exactly once the namespace is stripped, but the ones that do not are
 * the common ones -- grass_block is `grass`, oak_planks is `planks` -- so
 * every candidate is checked against the real key set from blocks.js rather
 * than assumed.
 */
import { BLOCK_TYPES } from '../../src/blocks.js'

// Only full cubes. Slabs and stairs exist in blocks.js as separate oriented
// keys for player building; terrain import must not pick them up by name.
export const CUBE_KEYS = new Set(
  BLOCK_TYPES.filter(b => !/_slab|_stairs/.test(b.key)).map(b => b.key),
)

/*
 * Fluids. Another agent is adding `water` and `lava` to blocks.js right now,
 * so these keys do not resolve against CUBE_KEYS yet and are whitelisted
 * rather than looked up. If that work lands differently, this is the one
 * place that has to change.
 */
export const PENDING_KEYS = new Set(['water', 'lava'])

const RENAMES = {
  grass_block: 'grass',
  oak_planks: 'planks',
  /*
   * Infested blocks are visually identical to the block they imitate -- that
   * is their whole point. The silverfish inside is an entity the engine has
   * no concept of, so mapping them to the plain block loses nothing a player
   * could see, where dropping them to air would punch holes in a mountain.
   */
  infested_stone: 'stone',
  infested_cobblestone: 'cobblestone',
  infested_deepslate: 'deepslate',
  infested_stone_bricks: 'stone_bricks',
  infested_mossy_stone_bricks: 'mossy_stone_bricks',
  infested_cracked_stone_bricks: 'cracked_stone_bricks',
  infested_chiseled_stone_bricks: 'chiseled_stone_bricks',
}

/*
 * Cross-shaped and non-cube plant life. Every one of these is dropped to air.
 * Listed explicitly rather than pattern-matched, so adding engine support for
 * any of them later is a deliberate edit and not a silent behaviour change.
 */
export const CROSS_PLANTS = new Set([
  'short_grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush', 'seagrass',
  'tall_seagrass', 'kelp', 'kelp_plant', 'vine', 'glow_lichen', 'sugar_cane',
  'bamboo', 'bamboo_sapling', 'sweet_berry_bush', 'cactus', 'lily_pad',
  'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'cornflower',
  'lily_of_the_valley', 'oxeye_daisy', 'wither_rose', 'torchflower',
  'pitcher_plant',
  'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'sunflower',
  'lilac', 'rose_bush', 'peony', 'pitcher_plant', 'pink_petals',
  'oak_sapling', 'spruce_sapling', 'birch_sapling', 'jungle_sapling',
  'acacia_sapling', 'dark_oak_sapling', 'cherry_sapling', 'mangrove_propagule',
  'pale_oak_sapling', 'brown_mushroom', 'red_mushroom', 'crimson_roots',
  'warped_roots', 'nether_sprouts', 'twisting_vines', 'twisting_vines_plant',
  'weeping_vines', 'weeping_vines_plant', 'cave_vines', 'cave_vines_plant',
  'hanging_roots', 'big_dripleaf', 'big_dripleaf_stem', 'small_dripleaf',
  'spore_blossom', 'azalea', 'flowering_azalea',
  'wheat', 'carrots', 'potatoes', 'beetroots', 'pumpkin_stem', 'melon_stem',
  'attached_pumpkin_stem', 'attached_melon_stem', 'nether_wart', 'cocoa',
  'dead_bush', 'fire', 'soul_fire', 'torch', 'wall_torch', 'soul_torch',
  'lantern', 'sea_pickle', 'turtle_egg', 'frogspawn', 'sculk_vein',
  'dripstone', 'pointed_dripstone', 'amethyst_cluster',
  'small_amethyst_bud', 'medium_amethyst_bud', 'large_amethyst_bud',
  'cobweb', 'tripwire', 'rail', 'powered_rail', 'detector_rail',
  'activator_rail', 'ladder', 'chain', 'end_rod', 'lightning_rod',
  'scaffolding', 'conduit', 'bell', 'flower_pot', 'decorated_pot',
])

/*
 * Structures put doors, fences, chests, signs and beds in the world. They are
 * real blocks with real collision, but every one needs a mesh or a
 * multi-block state the engine has no notion of. Dropped, and reported
 * separately from plants because the fix is different: plants want a cross
 * renderer, these want per-block models.
 */
export const NON_CUBE_STRUCTURE = new Set([
  'chest', 'trapped_chest', 'ender_chest', 'barrel_open', 'furnace_lit',
  'oak_door', 'spruce_door', 'birch_door', 'jungle_door', 'acacia_door',
  'dark_oak_door', 'iron_door', 'crimson_door', 'warped_door',
  'mangrove_door', 'cherry_door', 'bamboo_door', 'pale_oak_door', 'copper_door',
  'oak_trapdoor', 'spruce_trapdoor', 'birch_trapdoor', 'jungle_trapdoor',
  'acacia_trapdoor', 'dark_oak_trapdoor', 'iron_trapdoor',
  'oak_fence', 'spruce_fence', 'birch_fence', 'jungle_fence', 'acacia_fence',
  'dark_oak_fence', 'nether_brick_fence', 'mangrove_fence', 'bamboo_fence',
  'oak_fence_gate', 'spruce_fence_gate', 'birch_fence_gate',
  'jungle_fence_gate', 'acacia_fence_gate', 'dark_oak_fence_gate',
  'cobblestone_wall', 'mossy_cobblestone_wall', 'stone_brick_wall',
  'mossy_stone_brick_wall', 'andesite_wall', 'diorite_wall', 'granite_wall',
  'sandstone_wall', 'red_sandstone_wall', 'brick_wall', 'nether_brick_wall',
  'blackstone_wall', 'deepslate_brick_wall', 'tuff_wall', 'mud_brick_wall',
  'cobbled_deepslate_wall', 'polished_deepslate_wall',
  'oak_sign', 'oak_wall_sign', 'spruce_sign', 'birch_sign', 'jungle_sign',
  'acacia_sign', 'dark_oak_sign', 'oak_hanging_sign',
  'white_bed', 'red_bed', 'yellow_bed', 'lime_bed', 'blue_bed', 'cyan_bed',
  'iron_bars', 'glass_pane', 'white_stained_glass_pane',
  'oak_pressure_plate', 'stone_pressure_plate', 'lever', 'stone_button',
  'oak_button', 'redstone_wire', 'repeater', 'comparator', 'tripwire_hook',
  'cauldron', 'water_cauldron', 'brewing_stand', 'enchanting_table',
  'anvil', 'grindstone', 'stonecutter', 'lectern', 'composter',
  'campfire', 'soul_campfire', 'candle', 'skeleton_skull', 'player_head',
  'carpet', 'white_carpet', 'light_gray_carpet', 'brown_carpet',
  'end_portal_frame', 'spawner',
  /*
   * Thin ground layers. They read like full blocks in a palette and are not:
   * each one is a few pixels tall and sits ON a block rather than being one.
   * leaf_litter is the one that matters -- it is new in 1.21 and covers a
   * dark forest floor by the thousand, so mistaking it for a cube puts a
   * solid brown slab over the forest, and mistaking it for "needs a new
   * block" sends someone off to make a texture for something that cannot be
   * rendered anyway.
   */
  'leaf_litter', 'pink_petals', 'moss_carpet', 'snow',
  /*
   * Sculk sensor and shrieker are block-height but not cubes -- both have
   * inset, non-full models with their own top geometry.
   */
  'sculk_sensor', 'calibrated_sculk_sensor', 'sculk_shrieker',
  'piston_head', 'moving_piston', 'bubble_column', 'structure_void',
  'pitcher_crop', 'chiseled_bookshelf_occupied',
])

/** Vanilla air in all its forms. Not a drop -- genuinely nothing. */
export const AIRS = new Set(['air', 'cave_air', 'void_air'])

/**
 * Classify one `minecraft:` id.
 * Returns { kind, key } where kind is one of:
 *   'air'      nothing to store
 *   'mapped'   resolves to an existing full-cube key
 *   'pending'  resolves to a key another agent is adding (water/lava)
 *   'plant'    cross-shaped; dropped to air, reported
 *   'structure' needs a mesh the engine lacks; dropped to air, reported
 *   'missing'  a plain cube with no key yet; needs a new block
 */
export function classify(id) {
  const bare = id.replace(/^minecraft:/, '').replace(/\[.*$/, '')
  if (AIRS.has(bare)) return { kind: 'air', key: null }

  if (bare === 'water' || bare === 'flowing_water') return { kind: 'pending', key: 'water' }
  if (bare === 'lava' || bare === 'flowing_lava') return { kind: 'pending', key: 'lava' }

  if (CROSS_PLANTS.has(bare)) return { kind: 'plant', key: null }
  if (NON_CUBE_STRUCTURE.has(bare)) return { kind: 'structure', key: null }
  // Suffix families are large and keep growing; matching the tail catches the
  // variants the explicit lists above will inevitably miss.
  if (/_slab$|_stairs$|_wall$|_fence$|_fence_gate$|_door$|_trapdoor$|_sign$|_bed$|_pane$|_carpet$|_button$|_pressure_plate$|_banner$|_head$|_skull$|_candle$|_shulker_box$/.test(bare)) {
    return { kind: 'structure', key: null }
  }

  if (bare in RENAMES) {
    const to = RENAMES[bare]
    return to && CUBE_KEYS.has(to) ? { kind: 'mapped', key: to } : { kind: 'structure', key: null }
  }
  if (CUBE_KEYS.has(bare)) return { kind: 'mapped', key: bare }
  return { kind: 'missing', key: null }
}
