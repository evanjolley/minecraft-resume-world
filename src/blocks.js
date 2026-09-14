import {
  SHAPE_BOXES, buildShapeMesh, createMaterialCache,
  installNonCubeCollision, installPlacementOrientation, installThinInstanceUploadFix,
} from './blockMeshes.js'

/*
 * Block definitions.
 *
 * One table drives everything: noa's material/block registration, the
 * inventory's names and icons, how long a block takes to break, and -- via
 * scripts/build-textures.mjs importing this file -- which texture files the
 * build pipeline has to produce. That import is the point: a block can't
 * reference a texture the pipeline doesn't know about, because there is only
 * one list. The old arrangement kept a parallel copy of the names in the build
 * script, which drifts the moment anyone adds a block.
 *
 * Texture names here are VANILLA Minecraft texture file names
 * (`assets/minecraft/textures/block/<name>.png`). Both sources are keyed the
 * same way -- Pixel Perfection CE is a real Minecraft resource pack, so it
 * uses the same names -- which is what lets one table serve both. The old
 * short names (`cobble`, `planks`) were renamed to match; nothing outside this
 * file and the build script ever saw them.
 *
 * Block id 0 is hardcoded by noa as "air". Never register over it.
 *
 * Ids 1-17 are load-bearing: island.js generates terrain from them and any
 * world data saved before this table assumes them. Append, never renumber.
 * BLOCK_TYPES is asserted to be contiguous from 1 at the bottom of this file,
 * because a gap makes noa silently register untextured filler blocks.
 *
 * `hardness` is BARE-HANDED SECONDS, not Minecraft's raw hardness value.
 * Minecraft computes break time as hardness * 1.5 for blocks a tool isn't
 * required for, and hardness * 5 when the correct tool is required and you
 * don't have it. There are no tools here, so the seconds are baked in -- see
 * `T()` below, which does that conversion so the raw Minecraft number stays
 * visible in the table.
 */

/**
 * Minecraft hardness -> bare-handed seconds.
 * `tool` is whether the block requires the correct tool to drop anything,
 * which is also what decides the 5x vs 1.5x multiplier.
 */
/*
 * Break time, from Minecraft's raw hardness.
 *
 * Bare-handed, a block that wants no particular tool takes hardness * 1.5
 * seconds; one that REQUIRES a tool you don't have takes hardness * 5.
 *
 * This used to return only the multiplied seconds, which threw away both the
 * raw hardness and which multiplier applied -- and those are exactly what the
 * tool formula needs (time = hardness * 1.5 / toolSpeed). It now returns both
 * and `normaliseHardness` below splits them out, so every consumer of
 * `def.hardness` keeps reading plain seconds and nothing had to change.
 */
const T = (hardness, tool = true) => ({ __hardness: true, raw: hardness, tool })

const bareHandSeconds = (raw, tool) => +(raw * (tool ? 5 : 1.5)).toFixed(3)

/**
 * Rewrites each entry's `hardness` to bare-handed seconds and records
 * `rawHardness` / `requiresTool` alongside it.
 */
function normaliseHardness(types) {
  for (const b of types) {
    const h = b.hardness
    if (h && h.__hardness) {
      b.rawHardness = h.raw
      b.requiresTool = h.tool
      b.hardness = bareHandSeconds(h.raw, h.tool)
    } else {
      // Bedrock, which is Infinity and requires nothing because nothing works.
      b.rawHardness = h
      b.requiresTool = false
    }
  }
  return types
}

/*
 * Biome tints. Minecraft ships grass and most leaves GREYSCALE and multiplies
 * them by a per-biome colour at render time; a pack that does the same gives
 * you a white lawn if you just copy the file out. These are the plains-biome
 * colours, and the build applies them only when the source texture actually
 * looks greyscale -- some packs (including CE, for birch and spruce) ship
 * pre-coloured leaves, and tinting those twice turns them to mud.
 */
const GRASS = [0x91, 0xbd, 0x59]
const FOLIAGE = [0x77, 0xab, 0x2f]
const SPRUCE = [0x61, 0x99, 0x61]
const BIRCH = [0x80, 0xa7, 0x55]
// Cherry leaves aren't biome-tinted at all in Minecraft; this only exists so
// the CE fallback (derived from a greyscale leaf) doesn't come out grey.
const CHERRY = [0xe8, 0xa5, 0xc4]

/* ------------------------------------------------------------------ *
 * Core -- ids 1-17, frozen. island.js builds the world out of these.
 * ------------------------------------------------------------------ */

const CORE = [
  { id: 1, key: 'grass', name: 'Grass Block',
    top: 'grass_block_top', bottom: 'dirt', side: 'grass_block_side',
    hardness: T(0.6, false), drops: 2 },
  { id: 2, key: 'dirt', name: 'Dirt', all: 'dirt', hardness: T(0.5, false) },
  // Stone drops cobblestone unless mined with Silk Touch.
  { id: 3, key: 'stone', name: 'Stone', all: 'stone', hardness: T(1.5), drops: 4 },
  { id: 4, key: 'cobblestone', name: 'Cobblestone', all: 'cobblestone', hardness: T(2) },
  { id: 5, key: 'planks', name: 'Oak Planks', all: 'oak_planks', hardness: T(2, false) },

  // Unbreakable, like the real thing. interact.js checks for this.
  { id: 6, key: 'bedrock', name: 'Bedrock', all: 'bedrock', hardness: Infinity },

  { id: 7, key: 'gravel', name: 'Gravel', all: 'gravel', hardness: T(0.6, false) },
  { id: 8, key: 'andesite', name: 'Andesite', all: 'andesite', hardness: T(1.5) },
  { id: 9, key: 'diorite', name: 'Diorite', all: 'diorite', hardness: T(1.5) },
  { id: 10, key: 'granite', name: 'Granite', all: 'granite', hardness: T(1.5) },

  // All ores are hardness 3.0 in Minecraft and require a pickaxe, so bare
  // handed they take 15 seconds each.
  { id: 11, key: 'coal_ore', name: 'Coal Ore', all: 'coal_ore', hardness: T(3) },
  { id: 12, key: 'iron_ore', name: 'Iron Ore', all: 'iron_ore', hardness: T(3) },
  { id: 13, key: 'gold_ore', name: 'Gold Ore', all: 'gold_ore', hardness: T(3) },
  { id: 14, key: 'redstone_ore', name: 'Redstone Ore', all: 'redstone_ore', hardness: T(3) },
  { id: 15, key: 'lapis_ore', name: 'Lapis Lazuli Ore', all: 'lapis_ore', hardness: T(3) },
  { id: 16, key: 'diamond_ore', name: 'Diamond Ore', all: 'diamond_ore', hardness: T(3) },
  { id: 17, key: 'emerald_ore', name: 'Emerald Ore', all: 'emerald_ore', hardness: T(3) },
]

/* ------------------------------------------------------------------ *
 * Stone and rock. Everything a pickaxe is nominally required for and
 * that isn't an ore, a brick with a colour, or from the Nether.
 * ------------------------------------------------------------------ */

const STONE = [
  { id: 18, key: 'smooth_stone', name: 'Smooth Stone', all: 'smooth_stone', hardness: T(2) },
  { id: 19, key: 'stone_bricks', name: 'Stone Bricks', all: 'stone_bricks', hardness: T(1.5) },
  { id: 20, key: 'mossy_stone_bricks', name: 'Mossy Stone Bricks', all: 'mossy_stone_bricks', hardness: T(1.5) },
  { id: 21, key: 'cracked_stone_bricks', name: 'Cracked Stone Bricks', all: 'cracked_stone_bricks', hardness: T(1.5) },
  { id: 22, key: 'chiseled_stone_bricks', name: 'Chiseled Stone Bricks', all: 'chiseled_stone_bricks', hardness: T(1.5) },
  { id: 23, key: 'mossy_cobblestone', name: 'Mossy Cobblestone', all: 'mossy_cobblestone', hardness: T(2) },
  { id: 24, key: 'polished_andesite', name: 'Polished Andesite', all: 'polished_andesite', hardness: T(1.5) },
  { id: 25, key: 'polished_diorite', name: 'Polished Diorite', all: 'polished_diorite', hardness: T(1.5) },
  { id: 26, key: 'polished_granite', name: 'Polished Granite', all: 'polished_granite', hardness: T(1.5) },
  { id: 27, key: 'bricks', name: 'Bricks', all: 'bricks', hardness: T(2) },
  { id: 28, key: 'obsidian', name: 'Obsidian', all: 'obsidian', hardness: T(50) },
  { id: 29, key: 'crying_obsidian', name: 'Crying Obsidian', all: 'crying_obsidian', hardness: T(50) },
  // The vanilla file is `magma`, not `magma_block`, and it's an animation strip.
  { id: 30, key: 'magma_block', name: 'Magma Block', all: 'magma', hardness: T(0.5) },

  // Caves & Cliffs stone. Pixel Perfection CE is a 1.16 pack and has none of
  // this -- see CE_SUBSTITUTES in build-textures.mjs for what it draws instead.
  { id: 31, key: 'tuff', name: 'Tuff', all: 'tuff', hardness: T(1.5) },
  { id: 32, key: 'polished_tuff', name: 'Polished Tuff', all: 'polished_tuff', hardness: T(1.5) },
  { id: 33, key: 'tuff_bricks', name: 'Tuff Bricks', all: 'tuff_bricks', hardness: T(1.5) },
  { id: 34, key: 'chiseled_tuff', name: 'Chiseled Tuff',
    top: 'chiseled_tuff_top', bottom: 'chiseled_tuff_top', side: 'chiseled_tuff', hardness: T(1.5) },
  { id: 35, key: 'chiseled_tuff_bricks', name: 'Chiseled Tuff Bricks',
    top: 'chiseled_tuff_bricks_top', bottom: 'chiseled_tuff_bricks_top', side: 'chiseled_tuff_bricks', hardness: T(1.5) },
  { id: 36, key: 'calcite', name: 'Calcite', all: 'calcite', hardness: T(0.75) },
  { id: 37, key: 'dripstone_block', name: 'Dripstone Block', all: 'dripstone_block', hardness: T(1.5) },
  { id: 38, key: 'amethyst_block', name: 'Block of Amethyst', all: 'amethyst_block', hardness: T(1.5) },
  { id: 39, key: 'budding_amethyst', name: 'Budding Amethyst', all: 'budding_amethyst', hardness: T(1.5) },
  { id: 40, key: 'moss_block', name: 'Moss Block', all: 'moss_block', hardness: T(0.1, false) },

  // Deepslate drops cobbled deepslate, the same way stone drops cobblestone.
  { id: 41, key: 'deepslate', name: 'Deepslate',
    top: 'deepslate_top', bottom: 'deepslate_top', side: 'deepslate', hardness: T(3), drops: 42 },
  { id: 42, key: 'cobbled_deepslate', name: 'Cobbled Deepslate', all: 'cobbled_deepslate', hardness: T(3.5) },
  { id: 43, key: 'polished_deepslate', name: 'Polished Deepslate', all: 'polished_deepslate', hardness: T(3.5) },
  { id: 44, key: 'deepslate_bricks', name: 'Deepslate Bricks', all: 'deepslate_bricks', hardness: T(3.5) },
  { id: 45, key: 'cracked_deepslate_bricks', name: 'Cracked Deepslate Bricks', all: 'cracked_deepslate_bricks', hardness: T(3.5) },
  { id: 46, key: 'deepslate_tiles', name: 'Deepslate Tiles', all: 'deepslate_tiles', hardness: T(3.5) },
  { id: 47, key: 'cracked_deepslate_tiles', name: 'Cracked Deepslate Tiles', all: 'cracked_deepslate_tiles', hardness: T(3.5) },
  { id: 48, key: 'chiseled_deepslate', name: 'Chiseled Deepslate', all: 'chiseled_deepslate', hardness: T(3.5) },
  { id: 49, key: 'reinforced_deepslate', name: 'Reinforced Deepslate',
    top: 'reinforced_deepslate_top', bottom: 'reinforced_deepslate_bottom',
    side: 'reinforced_deepslate_side', hardness: Infinity },
]

/* ------------------------------------------------------------------ *
 * Sandstone. Both colours follow the same shape: the plain block is a
 * pillar (distinct top and bottom), and the three variants reuse the
 * plain top and bottom with a different side.
 * ------------------------------------------------------------------ */

const sandstoneSet = (from, prefix, label) => {
  const top = `${prefix}_top`, bottom = `${prefix}_bottom`
  return [
    { id: from, key: prefix, name: label, top, bottom, side: prefix },
    { id: from + 1, key: `chiseled_${prefix}`, name: `Chiseled ${label}`,
      top, bottom, side: `chiseled_${prefix}` },
    { id: from + 2, key: `cut_${prefix}`, name: `Cut ${label}`,
      top, bottom, side: `cut_${prefix}` },
    // Smooth sandstone is the top texture on all six faces -- there is no
    // `smooth_sandstone.png` in the game at all.
    { id: from + 3, key: `smooth_${prefix}`, name: `Smooth ${label}`, all: top },
  ].map(b => ({ hardness: T(0.8), ...b }))
}

const SANDSTONE = [
  ...sandstoneSet(50, 'sandstone', 'Sandstone'),
  ...sandstoneSet(54, 'red_sandstone', 'Red Sandstone'),
]

/* ------------------------------------------------------------------ *
 * Ground: dirt variants, the loose blocks, and mud.
 * ------------------------------------------------------------------ */

const GROUND = [
  { id: 58, key: 'coarse_dirt', name: 'Coarse Dirt', all: 'coarse_dirt', hardness: T(0.5, false) },
  { id: 59, key: 'rooted_dirt', name: 'Rooted Dirt', all: 'rooted_dirt', hardness: T(0.5, false) },
  // Grass-likes drop plain dirt, same rule as the grass block.
  { id: 60, key: 'podzol', name: 'Podzol',
    top: 'podzol_top', bottom: 'dirt', side: 'podzol_side', hardness: T(0.5, false), drops: 2 },
  { id: 61, key: 'mycelium', name: 'Mycelium',
    top: 'mycelium_top', bottom: 'dirt', side: 'mycelium_side', hardness: T(0.5, false), drops: 2 },
  { id: 62, key: 'clay', name: 'Clay', all: 'clay', hardness: T(0.6, false) },
  { id: 63, key: 'sand', name: 'Sand', all: 'sand', hardness: T(0.5, false) },
  { id: 64, key: 'red_sand', name: 'Red Sand', all: 'red_sand', hardness: T(0.5, false) },
  { id: 65, key: 'mud', name: 'Mud', all: 'mud', hardness: T(0.5, false) },
  { id: 66, key: 'packed_mud', name: 'Packed Mud', all: 'packed_mud', hardness: T(1, false) },
  { id: 67, key: 'mud_bricks', name: 'Mud Bricks', all: 'mud_bricks', hardness: T(1.5) },
  // Snow is one of the few blocks that genuinely requires a shovel.
  { id: 68, key: 'snow_block', name: 'Snow Block', all: 'snow', hardness: T(0.2) },
]

/* ------------------------------------------------------------------ *
 * Ice. Translucent, so `alpha` -- which puts them on the atlas page
 * that gets alpha blending, and tells noa not to cull their neighbours.
 * ------------------------------------------------------------------ */

const ICE = [
  { id: 69, key: 'ice', name: 'Ice', all: 'ice', hardness: T(0.5, false), alpha: true },
  { id: 70, key: 'packed_ice', name: 'Packed Ice', all: 'packed_ice', hardness: T(0.5, false) },
  { id: 71, key: 'blue_ice', name: 'Blue Ice', all: 'blue_ice', hardness: T(2.8, false) },
]

/* ------------------------------------------------------------------ *
 * Ores and the blocks you smelt them into.
 * ------------------------------------------------------------------ */

const ORES = [
  { id: 72, key: 'copper_ore', name: 'Copper Ore', all: 'copper_ore', hardness: T(3) },
  { id: 73, key: 'nether_gold_ore', name: 'Nether Gold Ore', all: 'nether_gold_ore', hardness: T(3) },
  { id: 74, key: 'nether_quartz_ore', name: 'Nether Quartz Ore', all: 'nether_quartz_ore', hardness: T(3) },

  // Deepslate ores are hardness 4.5 rather than 3.0 -- 50% slower than the
  // stone versions, which is the whole reason mining deep feels different.
  ...['coal', 'iron', 'copper', 'gold', 'redstone', 'lapis', 'diamond', 'emerald']
    .map((ore, i) => ({
      id: 75 + i, key: `deepslate_${ore}_ore`,
      name: `Deepslate ${ore[0].toUpperCase()}${ore.slice(1)} Ore`,
      all: `deepslate_${ore}_ore`, hardness: T(4.5),
    })),

  { id: 83, key: 'ancient_debris', name: 'Ancient Debris',
    top: 'ancient_debris_top', bottom: 'ancient_debris_top', side: 'ancient_debris_side', hardness: T(30) },

  { id: 84, key: 'coal_block', name: 'Block of Coal', all: 'coal_block', hardness: T(5) },
  { id: 85, key: 'iron_block', name: 'Block of Iron', all: 'iron_block', hardness: T(5) },
  { id: 86, key: 'gold_block', name: 'Block of Gold', all: 'gold_block', hardness: T(3) },
  { id: 87, key: 'diamond_block', name: 'Block of Diamond', all: 'diamond_block', hardness: T(5) },
  { id: 88, key: 'emerald_block', name: 'Block of Emerald', all: 'emerald_block', hardness: T(5) },
  { id: 89, key: 'lapis_block', name: 'Block of Lapis Lazuli', all: 'lapis_block', hardness: T(3) },
  { id: 90, key: 'redstone_block', name: 'Block of Redstone', all: 'redstone_block', hardness: T(5) },
  { id: 91, key: 'netherite_block', name: 'Block of Netherite', all: 'netherite_block', hardness: T(50) },
  { id: 92, key: 'raw_iron_block', name: 'Block of Raw Iron', all: 'raw_iron_block', hardness: T(5) },
  { id: 93, key: 'raw_copper_block', name: 'Block of Raw Copper', all: 'raw_copper_block', hardness: T(5) },
  { id: 94, key: 'raw_gold_block', name: 'Block of Raw Gold', all: 'raw_gold_block', hardness: T(5) },
]

/* ------------------------------------------------------------------ *
 * Copper, in all four oxidation stages. The waxed variants are omitted
 * deliberately: they are pixel-identical to the unwaxed ones, so they'd
 * cost 16 more block ids and 0 new pixels.
 * ------------------------------------------------------------------ */

const OXIDATION = [['', ''], ['exposed_', 'Exposed '], ['weathered_', 'Weathered '], ['oxidized_', 'Oxidized ']]

const copperSet = (from, suffix, label) => OXIDATION.map(([p, P], i) => ({
  id: from + i, key: `${p}${suffix}`, name: `${P}${label}`,
  all: `${p}${suffix}`, hardness: T(3),
}))

const COPPER = [
  // The plain block is the one irregular name in the family: `copper_block`
  // fresh, then just `exposed_copper` / `weathered_copper` / `oxidized_copper`.
  { id: 95, key: 'copper_block', name: 'Block of Copper', all: 'copper_block', hardness: T(3) },
  ...OXIDATION.slice(1).map(([p, P], i) => ({
    id: 96 + i, key: `${p}copper`, name: `${P}Copper`, all: `${p}copper`, hardness: T(3),
  })),
  ...copperSet(99, 'cut_copper', 'Cut Copper'),
  ...copperSet(103, 'chiseled_copper', 'Chiseled Copper'),
  { id: 107, key: 'copper_bulb', name: 'Copper Bulb', all: 'copper_bulb', hardness: T(3) },
  { id: 108, key: 'copper_grate', name: 'Copper Grate', all: 'copper_grate', hardness: T(3), alpha: true },
]

/* ------------------------------------------------------------------ *
 * Quartz, purpur, end stone.
 * ------------------------------------------------------------------ */

const QUARTZ_END = [
  { id: 109, key: 'quartz_block', name: 'Block of Quartz',
    top: 'quartz_block_top', bottom: 'quartz_block_bottom', side: 'quartz_block_side', hardness: T(0.8) },
  { id: 110, key: 'chiseled_quartz_block', name: 'Chiseled Quartz Block',
    top: 'chiseled_quartz_block_top', bottom: 'chiseled_quartz_block_top',
    side: 'chiseled_quartz_block', hardness: T(0.8) },
  { id: 111, key: 'quartz_pillar', name: 'Quartz Pillar',
    top: 'quartz_pillar_top', bottom: 'quartz_pillar_top', side: 'quartz_pillar', hardness: T(0.8) },
  // Smooth quartz has no texture of its own; it's the plain block's bottom.
  { id: 112, key: 'smooth_quartz', name: 'Smooth Quartz', all: 'quartz_block_bottom', hardness: T(0.8) },
  { id: 113, key: 'quartz_bricks', name: 'Quartz Bricks', all: 'quartz_bricks', hardness: T(0.8) },
  { id: 114, key: 'purpur_block', name: 'Purpur Block', all: 'purpur_block', hardness: T(1.5) },
  { id: 115, key: 'purpur_pillar', name: 'Purpur Pillar',
    top: 'purpur_pillar_top', bottom: 'purpur_pillar_top', side: 'purpur_pillar', hardness: T(1.5) },
  { id: 116, key: 'end_stone', name: 'End Stone', all: 'end_stone', hardness: T(3) },
  { id: 117, key: 'end_stone_bricks', name: 'End Stone Bricks', all: 'end_stone_bricks', hardness: T(3) },
]

/* ------------------------------------------------------------------ *
 * Prismarine. All four are animation strips in vanilla; the build takes
 * the first frame, since noa's atlas is one still layer per material.
 * ------------------------------------------------------------------ */

const PRISMARINE = [
  { id: 118, key: 'prismarine', name: 'Prismarine', all: 'prismarine', hardness: T(1.5) },
  { id: 119, key: 'prismarine_bricks', name: 'Prismarine Bricks', all: 'prismarine_bricks', hardness: T(1.5) },
  { id: 120, key: 'dark_prismarine', name: 'Dark Prismarine', all: 'dark_prismarine', hardness: T(1.5) },
  { id: 121, key: 'sea_lantern', name: 'Sea Lantern', all: 'sea_lantern', hardness: T(0.3, false) },
]

/* ------------------------------------------------------------------ *
 * The Nether.
 * ------------------------------------------------------------------ */

const NETHER = [
  { id: 122, key: 'netherrack', name: 'Netherrack', all: 'netherrack', hardness: T(0.4) },
  { id: 123, key: 'nether_bricks', name: 'Nether Bricks', all: 'nether_bricks', hardness: T(2) },
  { id: 124, key: 'cracked_nether_bricks', name: 'Cracked Nether Bricks', all: 'cracked_nether_bricks', hardness: T(2) },
  { id: 125, key: 'chiseled_nether_bricks', name: 'Chiseled Nether Bricks', all: 'chiseled_nether_bricks', hardness: T(2) },
  { id: 126, key: 'red_nether_bricks', name: 'Red Nether Bricks', all: 'red_nether_bricks', hardness: T(2) },
  { id: 127, key: 'soul_sand', name: 'Soul Sand', all: 'soul_sand', hardness: T(0.5, false) },
  { id: 128, key: 'soul_soil', name: 'Soul Soil', all: 'soul_soil', hardness: T(0.5, false) },
  { id: 129, key: 'glowstone', name: 'Glowstone', all: 'glowstone', hardness: T(0.3, false) },
  { id: 130, key: 'shroomlight', name: 'Shroomlight', all: 'shroomlight', hardness: T(1, false) },
  { id: 131, key: 'nether_wart_block', name: 'Nether Wart Block', all: 'nether_wart_block', hardness: T(1, false) },
  { id: 132, key: 'warped_wart_block', name: 'Warped Wart Block', all: 'warped_wart_block', hardness: T(1, false) },
  // Nylium is a grass-like: mining it gives plain netherrack.
  { id: 133, key: 'crimson_nylium', name: 'Crimson Nylium',
    top: 'crimson_nylium', bottom: 'netherrack', side: 'crimson_nylium_side', hardness: T(0.4), drops: 122 },
  { id: 134, key: 'warped_nylium', name: 'Warped Nylium',
    top: 'warped_nylium', bottom: 'netherrack', side: 'warped_nylium_side', hardness: T(0.4), drops: 122 },
  { id: 135, key: 'basalt', name: 'Basalt',
    top: 'basalt_top', bottom: 'basalt_top', side: 'basalt_side', hardness: T(1.25) },
  { id: 136, key: 'polished_basalt', name: 'Polished Basalt',
    top: 'polished_basalt_top', bottom: 'polished_basalt_top', side: 'polished_basalt_side', hardness: T(1.25) },
  { id: 137, key: 'smooth_basalt', name: 'Smooth Basalt', all: 'smooth_basalt', hardness: T(1.25) },
  { id: 138, key: 'blackstone', name: 'Blackstone',
    top: 'blackstone_top', bottom: 'blackstone_top', side: 'blackstone', hardness: T(1.5) },
  { id: 139, key: 'polished_blackstone', name: 'Polished Blackstone', all: 'polished_blackstone', hardness: T(2) },
  { id: 140, key: 'polished_blackstone_bricks', name: 'Polished Blackstone Bricks', all: 'polished_blackstone_bricks', hardness: T(1.5) },
  { id: 141, key: 'cracked_polished_blackstone_bricks', name: 'Cracked Polished Blackstone Bricks', all: 'cracked_polished_blackstone_bricks', hardness: T(1.5) },
  { id: 142, key: 'chiseled_polished_blackstone', name: 'Chiseled Polished Blackstone', all: 'chiseled_polished_blackstone', hardness: T(1.5) },
  { id: 143, key: 'gilded_blackstone', name: 'Gilded Blackstone', all: 'gilded_blackstone', hardness: T(1.5) },
  { id: 144, key: 'bone_block', name: 'Bone Block',
    top: 'bone_block_top', bottom: 'bone_block_top', side: 'bone_block_side', hardness: T(2) },
  { id: 145, key: 'lodestone', name: 'Lodestone',
    top: 'lodestone_top', bottom: 'lodestone_top', side: 'lodestone_side', hardness: T(3.5) },
  // The anchor has five charge states; this is the uncharged one.
  { id: 146, key: 'respawn_anchor', name: 'Respawn Anchor',
    top: 'respawn_anchor_top_off', bottom: 'respawn_anchor_bottom',
    side: 'respawn_anchor_side0', hardness: T(50) },
]

/* ------------------------------------------------------------------ *
 * Post-1.16 oddments that don't belong to any of the sets above.
 * ------------------------------------------------------------------ */

const MODERN = [
  { id: 147, key: 'sculk', name: 'Sculk', all: 'sculk', hardness: T(0.2, false) },
  { id: 148, key: 'sculk_catalyst', name: 'Sculk Catalyst',
    top: 'sculk_catalyst_top', bottom: 'sculk_catalyst_bottom',
    side: 'sculk_catalyst_side', hardness: T(3, false) },
  ...['ochre', 'verdant', 'pearlescent'].map((c, i) => ({
    id: 149 + i, key: `${c}_froglight`, name: `${c[0].toUpperCase()}${c.slice(1)} Froglight`,
    top: `${c}_froglight_top`, bottom: `${c}_froglight_top`, side: `${c}_froglight_side`,
    hardness: T(0.3, false),
  })),
  { id: 152, key: 'resin_block', name: 'Block of Resin', all: 'resin_block', hardness: T(1, false) },
  { id: 153, key: 'resin_bricks', name: 'Resin Bricks', all: 'resin_bricks', hardness: T(1.5) },
]

/* ------------------------------------------------------------------ *
 * Wood. Every set is the same five or six blocks, so it's generated
 * rather than typed out 12 times: planks, log, wood (the all-bark
 * block), the two stripped versions, and leaves.
 *
 * `from` is written out at each call site so the ids stay greppable --
 * a running counter would be shorter and would silently renumber
 * everything downstream the first time someone inserts a wood type.
 * ------------------------------------------------------------------ */

const woodSet = (from, wood, label, o = {}) => {
  const log = o.log ?? `${wood}_log`           // crimson/warped are "stems"
  const logWord = o.logWord ?? 'Log'
  const woodWord = o.woodWord ?? 'wood'        // crimson/warped are "hyphae"
  const woodLabel = o.woodLabel ?? 'Wood'

  const rows = []
  // Oak planks are id 5, from before this table existed, so the oak set
  // starts at its log instead.
  if (!o.skipPlanks) {
    rows.push({ key: `${wood}_planks`, name: `${label} Planks`, all: `${wood}_planks` })
  }
  rows.push(
    { key: log, name: `${label} ${logWord}`, top: `${log}_top`, bottom: `${log}_top`, side: log },
    { key: `stripped_${log}`, name: `Stripped ${label} ${logWord}`,
      top: `stripped_${log}_top`, bottom: `stripped_${log}_top`, side: `stripped_${log}` },
    // "Wood" / "hyphae" is bark on all six faces -- no texture of its own.
    { key: `${wood}_${woodWord}`, name: `${label} ${woodLabel}`, all: log },
    { key: `stripped_${wood}_${woodWord}`, name: `Stripped ${label} ${woodLabel}`, all: `stripped_${log}` },
  )
  if (o.leaves !== false) {
    // `leafTint` is separate from having leaves at all: vanilla ships most
    // leaves greyscale and tints them per biome, but pale oak's are already
    // the colour they should be, so tinting them would be wrong.
    rows.push({ key: `${wood}_leaves`, name: `${label} Leaves`, all: `${wood}_leaves`,
      hardness: T(0.2, false), alpha: true, tint: o.leafTint })
  }
  return rows.map((r, i) => ({ id: from + i, hardness: T(2, false), ...r }))
}

const WOOD = [
  ...woodSet(154, 'oak', 'Oak', { skipPlanks: true, leafTint: FOLIAGE }),
  ...woodSet(159, 'spruce', 'Spruce', { leafTint: SPRUCE }),
  ...woodSet(165, 'birch', 'Birch', { leafTint: BIRCH }),
  ...woodSet(171, 'jungle', 'Jungle', { leafTint: FOLIAGE }),
  ...woodSet(177, 'acacia', 'Acacia', { leafTint: FOLIAGE }),
  ...woodSet(183, 'dark_oak', 'Dark Oak', { leafTint: FOLIAGE }),
  ...woodSet(189, 'mangrove', 'Mangrove', { leafTint: FOLIAGE }),
  ...woodSet(195, 'cherry', 'Cherry', { leafTint: CHERRY }),
  ...woodSet(201, 'pale_oak', 'Pale Oak'),

  // Nether "wood" has no leaves and uses stem/hyphae naming.
  ...woodSet(207, 'crimson', 'Crimson', { log: 'crimson_stem', logWord: 'Stem', woodWord: 'hyphae', woodLabel: 'Hyphae', leaves: false }),
  ...woodSet(212, 'warped', 'Warped', { log: 'warped_stem', logWord: 'Stem', woodWord: 'hyphae', woodLabel: 'Hyphae', leaves: false }),

  // Bamboo breaks the pattern completely: no leaves, no "wood" block, and an
  // extra plank variant, so it's written out.
  { id: 217, key: 'bamboo_planks', name: 'Bamboo Planks', all: 'bamboo_planks', hardness: T(2, false) },
  { id: 218, key: 'bamboo_mosaic', name: 'Bamboo Mosaic', all: 'bamboo_mosaic', hardness: T(2, false) },
  { id: 219, key: 'bamboo_block', name: 'Block of Bamboo',
    top: 'bamboo_block_top', bottom: 'bamboo_block_top', side: 'bamboo_block', hardness: T(2, false) },
  { id: 220, key: 'stripped_bamboo_block', name: 'Block of Stripped Bamboo',
    top: 'stripped_bamboo_block_top', bottom: 'stripped_bamboo_block_top',
    side: 'stripped_bamboo_block', hardness: T(2, false) },
]

/* ------------------------------------------------------------------ *
 * The 16-colour families: wool, concrete, concrete powder, terracotta,
 * glazed terracotta, stained glass. All follow `<colour>_<suffix>`.
 * ------------------------------------------------------------------ */

const DYES = [
  ['white', 'White'], ['orange', 'Orange'], ['magenta', 'Magenta'], ['light_blue', 'Light Blue'],
  ['yellow', 'Yellow'], ['lime', 'Lime'], ['pink', 'Pink'], ['gray', 'Gray'],
  ['light_gray', 'Light Gray'], ['cyan', 'Cyan'], ['purple', 'Purple'], ['blue', 'Blue'],
  ['brown', 'Brown'], ['green', 'Green'], ['red', 'Red'], ['black', 'Black'],
]

/** Ids run `from`..`from+15` in Minecraft's canonical dye order. Never reorder. */
const dyed = (from, suffix, label, props) => DYES.map(([c, C], i) => ({
  id: from + i, key: `${c}_${suffix}`, name: `${C} ${label}`, all: `${c}_${suffix}`, ...props,
}))

const WOOL = dyed(221, 'wool', 'Wool', { hardness: T(0.8, false) })
const CONCRETE = dyed(237, 'concrete', 'Concrete', { hardness: T(1.8) })
const CONCRETE_POWDER = dyed(253, 'concrete_powder', 'Concrete Powder', { hardness: T(0.5, false) })

const TERRACOTTA = [
  { id: 269, key: 'terracotta', name: 'Terracotta', all: 'terracotta', hardness: T(1.25) },
  ...dyed(270, 'terracotta', 'Terracotta', { hardness: T(1.25) }),
  // Glazed terracotta is directional in Minecraft (the pattern rotates per
  // face). noa has no per-face rotation, so all six faces get the same tile.
  ...dyed(286, 'glazed_terracotta', 'Glazed Terracotta', { hardness: T(1.4) }),
]

const GLASS = [
  { id: 302, key: 'glass', name: 'Glass', all: 'glass', hardness: T(0.3, false), alpha: true },
  { id: 303, key: 'tinted_glass', name: 'Tinted Glass', all: 'tinted_glass', hardness: T(0.3, false), alpha: true },
  ...dyed(304, 'stained_glass', 'Stained Glass', { hardness: T(0.3, false), alpha: true }),
]

/* ------------------------------------------------------------------ *
 * Utility blocks -- the ones with a distinct front face, plus the
 * plants-that-are-cubes and the odds and ends.
 * ------------------------------------------------------------------ */

const UTILITY = [
  // `front` makes this a six-face block; registerBlocks() expands it.
  { id: 320, key: 'crafting_table', name: 'Crafting Table',
    top: 'crafting_table_top', bottom: 'oak_planks',
    side: 'crafting_table_side', front: 'crafting_table_front', hardness: T(2.5, false) },
  { id: 321, key: 'furnace', name: 'Furnace',
    top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'furnace_front', hardness: T(3.5) },
  { id: 322, key: 'blast_furnace', name: 'Blast Furnace',
    top: 'blast_furnace_top', bottom: 'blast_furnace_top',
    side: 'blast_furnace_side', front: 'blast_furnace_front', hardness: T(3.5) },
  { id: 323, key: 'smoker', name: 'Smoker',
    top: 'smoker_top', bottom: 'smoker_bottom', side: 'smoker_side', front: 'smoker_front', hardness: T(3.5) },
  { id: 324, key: 'bookshelf', name: 'Bookshelf',
    top: 'oak_planks', bottom: 'oak_planks', side: 'bookshelf', hardness: T(1.5, false) },
  { id: 325, key: 'chiseled_bookshelf', name: 'Chiseled Bookshelf',
    top: 'chiseled_bookshelf_top', bottom: 'chiseled_bookshelf_top',
    side: 'chiseled_bookshelf_side', front: 'chiseled_bookshelf_empty', hardness: T(1.5, false) },

  { id: 326, key: 'tnt', name: 'TNT',
    top: 'tnt_top', bottom: 'tnt_bottom', side: 'tnt_side', hardness: 0 },
  { id: 327, key: 'melon', name: 'Melon',
    top: 'melon_top', bottom: 'melon_top', side: 'melon_side', hardness: T(1, false) },
  { id: 328, key: 'pumpkin', name: 'Pumpkin',
    top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side', hardness: T(1, false) },
  { id: 329, key: 'carved_pumpkin', name: 'Carved Pumpkin',
    top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side', front: 'carved_pumpkin', hardness: T(1, false) },
  { id: 330, key: 'jack_o_lantern', name: 'Jack o\'Lantern',
    top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side', front: 'jack_o_lantern', hardness: T(1, false) },
  { id: 331, key: 'hay_block', name: 'Hay Bale',
    top: 'hay_block_top', bottom: 'hay_block_top', side: 'hay_block_side', hardness: T(0.5, false) },
  { id: 332, key: 'dried_kelp_block', name: 'Dried Kelp Block',
    top: 'dried_kelp_top', bottom: 'dried_kelp_bottom', side: 'dried_kelp_side', hardness: T(0.5, false) },
  { id: 333, key: 'honeycomb_block', name: 'Honeycomb Block', all: 'honeycomb_block', hardness: T(0.6, false) },
  { id: 334, key: 'slime_block', name: 'Slime Block', all: 'slime_block', hardness: 0, alpha: true },
  { id: 335, key: 'sponge', name: 'Sponge', all: 'sponge', hardness: T(0.6, false) },
  { id: 336, key: 'wet_sponge', name: 'Wet Sponge', all: 'wet_sponge', hardness: T(0.6, false) },

  { id: 337, key: 'note_block', name: 'Note Block', all: 'note_block', hardness: T(0.8, false) },
  { id: 338, key: 'jukebox', name: 'Jukebox',
    top: 'jukebox_top', bottom: 'jukebox_side', side: 'jukebox_side', hardness: T(2, false) },
  { id: 339, key: 'redstone_lamp', name: 'Redstone Lamp', all: 'redstone_lamp', hardness: T(0.3, false) },
  { id: 340, key: 'target', name: 'Target',
    top: 'target_top', bottom: 'target_top', side: 'target_side', hardness: T(0.5, false) },
  { id: 341, key: 'observer', name: 'Observer',
    top: 'observer_top', bottom: 'observer_top', side: 'observer_side', front: 'observer_front', hardness: T(3) },
  { id: 342, key: 'piston', name: 'Piston',
    top: 'piston_top', bottom: 'piston_bottom', side: 'piston_side', hardness: T(1.5) },
  { id: 343, key: 'sticky_piston', name: 'Sticky Piston',
    top: 'piston_top_sticky', bottom: 'piston_bottom', side: 'piston_side', hardness: T(1.5) },
  { id: 344, key: 'dispenser', name: 'Dispenser',
    top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'dispenser_front', hardness: T(3.5) },
  { id: 345, key: 'dropper', name: 'Dropper',
    top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'dropper_front', hardness: T(3.5) },

  { id: 346, key: 'barrel', name: 'Barrel',
    top: 'barrel_top', bottom: 'barrel_bottom', side: 'barrel_side', hardness: T(2.5, false) },
  { id: 347, key: 'loom', name: 'Loom',
    top: 'loom_top', bottom: 'loom_bottom', side: 'loom_side', front: 'loom_front', hardness: T(2.5, false) },
  { id: 348, key: 'cartography_table', name: 'Cartography Table',
    top: 'cartography_table_top', bottom: 'dark_oak_planks',
    side: 'cartography_table_side1', front: 'cartography_table_side3', hardness: T(2.5, false) },
  { id: 349, key: 'fletching_table', name: 'Fletching Table',
    top: 'fletching_table_top', bottom: 'birch_planks',
    side: 'fletching_table_side', front: 'fletching_table_front', hardness: T(2.5, false) },
  { id: 350, key: 'smithing_table', name: 'Smithing Table',
    top: 'smithing_table_top', bottom: 'smithing_table_bottom',
    side: 'smithing_table_side', front: 'smithing_table_front', hardness: T(2.5, false) },
  { id: 351, key: 'beehive', name: 'Beehive',
    top: 'beehive_end', bottom: 'beehive_end', side: 'beehive_side', front: 'beehive_front', hardness: T(0.6, false) },
  { id: 352, key: 'bee_nest', name: 'Bee Nest',
    top: 'bee_nest_top', bottom: 'bee_nest_bottom', side: 'bee_nest_side', front: 'bee_nest_front', hardness: T(0.3, false) },

  // Mushroom blocks are all-pores in the inventory; the caps only appear on
  // faces exposed to air, which is per-face state noa can't express.
  { id: 353, key: 'brown_mushroom_block', name: 'Brown Mushroom Block', all: 'brown_mushroom_block', hardness: T(0.2, false) },
  { id: 354, key: 'red_mushroom_block', name: 'Red Mushroom Block', all: 'red_mushroom_block', hardness: T(0.2, false) },
  { id: 355, key: 'mushroom_stem', name: 'Mushroom Stem', all: 'mushroom_stem', hardness: T(0.2, false) },
]

/* ------------------------------------------------------------------ *
 * Non-cube blocks: slabs and stairs.
 *
 * Everything above this line is a full cube drawn by noa's terrain mesher.
 * Everything below is a custom `blockMesh` -- see blockMeshes.js, which owns
 * the geometry and the sub-voxel collision noa does not provide.
 *
 * A family is TEN ids: two slabs (bottom, top) and eight stairs (four facings
 * times upright/upside-down). The variants exist as ids because a block id is
 * the only per-voxel state noa has -- there is no metadata or blockstate --
 * so orientation has to BE the id.
 *
 * They are ids, but they are not ten items. Every variant drops the family's
 * canonical id, so breaking any of the eight oak stairs gives you one "Oak
 * Stairs", and placing it picks the variant back out from where you're looking
 * (blockMeshes.js's installPlacementOrientation). The inventory never sees the
 * other nine.
 *
 * Families are restricted to source blocks with a SINGLE texture on all six
 * faces. A cuboid mesh can only carry one Babylon material without splitting
 * into submeshes, and Minecraft's three-texture families are mostly ones whose
 * stair/slab form uses one texture anyway -- Smooth Sandstone is sandstone_top
 * on every face, Smooth Quartz is quartz_block_bottom. So this costs the
 * plain-sandstone and plain-quartz stairs and nothing else.
 * ------------------------------------------------------------------ */

/**
 * The eight stair states, in id order. INDEX 0 IS CANONICAL: it is the one
 * with the plain `<family>_stairs` key, the one the item places, and the one
 * every other variant drops. Never reorder -- these are ids.
 */
const STAIR_STATES = [
  ['north', 'bottom'], ['south', 'bottom'], ['east', 'bottom'], ['west', 'bottom'],
  ['north', 'top'], ['south', 'top'], ['east', 'top'], ['west', 'top'],
]

/**
 * Canonical block id -> (facing, half) -> the id to actually place.
 * Filled in by nonCubeSet below; read by installPlacementOrientation.
 * @type {Map<number, (facing: string, half: string) => number>}
 */
const NON_CUBE_VARIANTS = new Map()

/**
 * Ten blocks derived from one cube. `source` supplies the texture and the
 * hardness, so a stone brick stair takes exactly as long to break as a stone
 * brick -- which is Minecraft's rule and also means there is only one place to
 * change it.
 */
function nonCubeSet(from, prefix, source, label) {
  if (!source) throw new Error(`non-cube family "${prefix}" has no source block`)
  if (!source.all) {
    throw new Error(`non-cube family "${prefix}" needs a single-texture source, got "${source.key}"`)
  }
  const stairFrom = from + 2

  NON_CUBE_VARIANTS.set(from, (_facing, half) => (half === 'top' ? from + 1 : from))
  NON_CUBE_VARIANTS.set(stairFrom, (facing, half) =>
    stairFrom + STAIR_STATES.findIndex(([f, h]) => f === facing && h === half))

  const rows = [
    { id: from, key: `${prefix}_slab`, name: `${label} Slab`, shape: 'slab_bottom' },
    { id: from + 1, key: `${prefix}_slab_top`, name: `${label} Slab`, shape: 'slab_top', drops: from },
    ...STAIR_STATES.map(([facing, half], i) => ({
      id: stairFrom + i,
      key: i === 0 ? `${prefix}_stairs` : `${prefix}_stairs_${facing}_${half}`,
      name: `${label} Stairs`,
      shape: `stairs_${facing}_${half}`,
      ...(i === 0 ? {} : { drops: stairFrom }),
    })),
  ]
  return rows.map(r => ({ all: source.all, hardness: source.hardness, ...r }))
}

/* Every cube, so a family can look its source up by key. */
const CUBES = [
  ...CORE, ...STONE, ...SANDSTONE, ...GROUND, ...ICE, ...ORES, ...COPPER,
  ...QUARTZ_END, ...PRISMARINE, ...NETHER, ...MODERN, ...WOOD,
  ...WOOL, ...CONCRETE, ...CONCRETE_POWDER, ...TERRACOTTA, ...GLASS, ...UTILITY,
]
const CUBE_BY_KEY = new Map(CUBES.map(b => [b.key, b]))

/*
 * `[firstId, keyPrefix, sourceBlockKey, label]`. The stride is ten and the
 * ids are written out rather than accumulated, same reasoning as woodSet
 * above: a running counter silently renumbers everything downstream the first
 * time a family is inserted, and these are save data.
 */
const NON_CUBE_FAMILIES = [
  // Wood
  [356, 'oak', 'planks', 'Oak'],
  [366, 'spruce', 'spruce_planks', 'Spruce'],
  [376, 'birch', 'birch_planks', 'Birch'],
  [386, 'jungle', 'jungle_planks', 'Jungle'],
  [396, 'acacia', 'acacia_planks', 'Acacia'],
  [406, 'dark_oak', 'dark_oak_planks', 'Dark Oak'],
  [416, 'mangrove', 'mangrove_planks', 'Mangrove'],
  [426, 'cherry', 'cherry_planks', 'Cherry'],

  // Stone
  [436, 'stone', 'stone', 'Stone'],
  [446, 'smooth_stone', 'smooth_stone', 'Smooth Stone'],
  [456, 'cobblestone', 'cobblestone', 'Cobblestone'],
  [466, 'mossy_cobblestone', 'mossy_cobblestone', 'Mossy Cobblestone'],
  [476, 'stone_brick', 'stone_bricks', 'Stone Brick'],
  [486, 'mossy_stone_brick', 'mossy_stone_bricks', 'Mossy Stone Brick'],
  [496, 'brick', 'bricks', 'Brick'],
  [506, 'polished_andesite', 'polished_andesite', 'Polished Andesite'],
  [516, 'polished_diorite', 'polished_diorite', 'Polished Diorite'],
  [526, 'polished_granite', 'polished_granite', 'Polished Granite'],

  // Deep and dark
  [536, 'cobbled_deepslate', 'cobbled_deepslate', 'Cobbled Deepslate'],
  [546, 'deepslate_brick', 'deepslate_bricks', 'Deepslate Brick'],
  [556, 'polished_blackstone_brick', 'polished_blackstone_bricks', 'Polished Blackstone Brick'],
  [566, 'nether_brick', 'nether_bricks', 'Nether Brick'],
  [576, 'end_stone_brick', 'end_stone_bricks', 'End Stone Brick'],

  // Decorative
  [586, 'purpur', 'purpur_block', 'Purpur'],
  [596, 'prismarine_brick', 'prismarine_bricks', 'Prismarine Brick'],
  [606, 'dark_prismarine', 'dark_prismarine', 'Dark Prismarine'],
  [616, 'smooth_quartz', 'smooth_quartz', 'Smooth Quartz'],
  [626, 'smooth_sandstone', 'smooth_sandstone', 'Smooth Sandstone'],
]

const NON_CUBE = NON_CUBE_FAMILIES.flatMap(
  ([from, prefix, sourceKey, label]) => nonCubeSet(from, prefix, CUBE_BY_KEY.get(sourceKey), label))

/* ------------------------------------------------------------------ *
 * Fluids.
 *
 * Last in the table on purpose. These two ids are the contract the terrain
 * importer generates against, so they have to be stable, and appending is the
 * only way to add an id without renumbering someone's save data.
 *
 * A fluid is NOT a block you can interact with, and that falls out of flags
 * rather than out of special cases:
 *   - `fluid: true` makes noa register it non-solid, so you walk into it.
 *   - non-solid means `noa.blockTargetIdCheck` (bottom of this file) skips it,
 *     so the crosshair raycast passes straight through and neither mining nor
 *     placement ever names a fluid.
 *   - `hardness: Infinity` is the belt to that braces: interact.js's
 *     `breakable()` tests exactly this, so even a raycast that somehow landed
 *     on water could not start a break.
 *   - items.js drops fluids from its block-item list, so /give water and a
 *     creative-inventory water bucket-that-isn't don't exist. Vanilla has no
 *     water ITEM either -- it has a bucket, which is a different thing.
 *
 * Rejected: registering them as normal non-opaque blocks and doing the
 * swimming in physics.js by sampling block ids per tick. noa already carries
 * a fluid flag all the way down into voxel-physics-engine's buoyancy pass,
 * and reimplementing that on top would mean two disagreeing notions of "am I
 * in water" -- one for rendering and one for movement.
 *
 * `fluidDensity` and `viscosity` are passed and are, in noa 0.33, DEAD. The
 * registry stores them in blockProps and nothing ever reads them back:
 * voxel-physics-engine's applyFluidForces uses the engine-global
 * `self.fluidDensity`, and the drag term uses the global `self.fluidDrag`.
 * They are spelled out anyway because they are the right values and because
 * the day noa starts honouring them is the day lava should get thicker on its
 * own. fluids.js is where the per-fluid difference actually happens today.
 */

/*
 * Minecraft ships `water_still.png` GREYSCALE with alpha 180/255 baked in and
 * multiplies it by a per-biome `water_color` at render time -- the same
 * arrangement as grass and leaves above. 0x3F76E4 is the default, used by
 * plains, ocean and most of the overworld; swamps and mangrove swamps have
 * their own and are not reproduced, because nothing here knows about biomes.
 *
 * Lava is the opposite: `lava_still.png` is fully coloured and fully opaque in
 * the file, so it gets no tint and no alpha, and it stays on the opaque atlas
 * page. That difference is why water is `alpha: true` and lava is not.
 */
/* Exported because underwater.js reuses it as the FOG colour -- which is
 * exactly what vanilla does, it reuses the biome water tint for water fog.
 * Two copies of a hex triple is how they stop agreeing. */
export const WATER_TINT = [0x3f, 0x76, 0xe4]

const FLUIDS = [
  {
    id: 636, key: 'water', name: 'Water', all: 'water_still',
    hardness: Infinity, fluid: true, alpha: true, tint: WATER_TINT,
    // The alpha vanilla bakes into the PNG. Restated here so a source that
    // ships opaque water (Pixel Perfection CE has no water texture at all and
    // is substituted from ice) comes out translucent too.
    alphaLevel: 180,
    /*
     * Minecraft's water density is 1.0 relative to the player, and the game
     * gives a swimming player near-neutral buoyancy: you sink, but at about a
     * fortieth of free-fall. See fluids.js for how that is actually produced.
     */
    fluidDensity: 1.0,
    viscosity: 0.8,
  },
  {
    id: 637, key: 'lava', name: 'Lava', all: 'lava_still',
    hardness: Infinity, fluid: true,
    // Lava's per-tick velocity retention is 0.5 against water's 0.8 -- it is
    // roughly four times as thick to move through.
    fluidDensity: 1.0,
    viscosity: 0.5,
  },
]

/*
 * The world edge.
 *
 * Minecraft's barrier: solid, unbreakable, and drawn as absolutely nothing.
 * island.js stands a column of these outside the imported 128x128 patch so
 * you cannot walk off the world.
 *
 * `invisible: true` is this file's flag, not noa's, and three things read it:
 * the atlas builder skips it (it has no texture to put in a page), items.js
 * skips it (there is no barrier item to hold or place), and registerBlocks
 * below registers it with no material at all.
 *
 * WHY opaque: false ON AN INVISIBLE BLOCK -- and this is the part worth
 * checking rather than assuming, because the wrong answer is subtle.
 * noa's greedy mesher decides each face between two voxels like this:
 *   - both opaque            -> draw nothing
 *   - same face material     -> draw nothing
 *   - otherwise draw whichever side is opaque / has a material
 * With opaque:true, every face between the barrier wall and the terrain hits
 * the first rule and is CULLED -- the outermost blocks of the world lose their
 * outward faces and you can see straight into the ground along the entire
 * perimeter. With opaque:false and no material, barrier-vs-air hits the second
 * rule (both material 0, nothing drawn, which is what "invisible" means) and
 * barrier-vs-terrain falls through to the third and draws the TERRAIN's face.
 * Which is exactly right: the world keeps its skin and the wall has none.
 */
const BARRIER = [
  {
    id: 638, key: 'barrier', name: 'Barrier', invisible: true,
    hardness: Infinity,
  },
]

export const BLOCK_TYPES = normaliseHardness([...CUBES, ...NON_CUBE, ...FLUIDS, ...BARRIER])

// Ids must be contiguous from 1. noa fills any gap with a silently-registered
// filler block that has no material, which renders as untextured white and is
// a nightmare to trace back to a typo'd id three hundred rows up.
BLOCK_TYPES.forEach((def, i) => {
  if (def.id !== i + 1) throw new Error(`block id gap at "${def.key}": expected ${i + 1}, got ${def.id}`)
})

// id -> definition, for the O(1) lookups mining and the inventory do per frame.
export const BLOCK_BY_ID = new Map(BLOCK_TYPES.map(b => [b.id, b]))

/**
 * The six face materials for a block, in noa's order.
 *
 * noa reads a 3-element array as [top, bottom, sides] and a 6-element one as
 * per-face. `front` is the only reason we ever need the 6-element form: it's
 * one face of a furnace/crafting table, and noa's per-face slot 4 is the one
 * that lands on -z.
 */
export function faceMaterials(def) {
  if (def.all) return [def.all, def.all, def.all, def.all, def.all, def.all]
  const { top, bottom, side, front } = def
  if (!front) return [side, side, top, bottom, side, side]
  return [side, side, top, bottom, front, side]
}

/** The texture names to draw on an inventory icon's three visible faces. */
export function iconFaces(def) {
  return { top: def.all || def.top, side: def.all || def.side }
}

/* ------------------------------------------------------------------ *
 * Materials and the texture atlas.
 *
 * noa can either give every material its own Babylon material and its own
 * PNG, or it can take one vertical strip PNG and an `atlasIndex` per
 * material, upload it once as a sampler2DArray, and draw every block in the
 * chunk with a single material. At 18 materials the difference didn't
 * matter. At ~450 it decides whether this works at all: the per-material
 * path is 450 HTTP requests, 450 Babylon materials, and one sub-mesh per
 * material per chunk.
 *
 * The atlas is paged because WebGL2 only guarantees
 * GL_MAX_ARRAY_TEXTURE_LAYERS >= 256. Real desktop GPUs report 2048, but
 * "works on my machine" is exactly the failure this project can't debug
 * remotely, so pages are capped well under the floor. The cost of a page is
 * one extra sub-mesh per chunk that contains blocks from it, which is
 * nothing next to the risk.
 * ------------------------------------------------------------------ */

const ATLAS_PAGE_SIZE = 128

/*
 * Alpha materials are segregated onto their own pages, not interleaved.
 * noa turns on alpha blending for a whole atlas texture if ANY material in
 * it needs alpha, and putting opaque terrain into the transparent render
 * pass costs sorting artifacts for no reason.
 */
const opaqueNames = [], alphaNames = []
{
  const seen = new Set()
  const needsAlpha = new Set()
  for (const def of BLOCK_TYPES) {
    if (def.invisible || !def.alpha) continue
    for (const m of faceMaterials(def)) needsAlpha.add(m)
  }
  for (const def of BLOCK_TYPES) {
    // An invisible block has no texture names at all, and faceMaterials would
    // hand back six `undefined`s -- which would land in the atlas as a page
    // slot named "undefined" and send the build off looking for the file.
    if (def.invisible) continue
    for (const m of faceMaterials(def)) {
      if (seen.has(m)) continue
      seen.add(m)
      ;(needsAlpha.has(m) ? alphaNames : opaqueNames).push(m)
    }
  }
}

const page = (names, hasAlpha, out) => {
  for (let i = 0; i < names.length; i += ATLAS_PAGE_SIZE) {
    out.push({ file: `atlas${out.length}.png`, names: names.slice(i, i + ATLAS_PAGE_SIZE), hasAlpha })
  }
  return out
}

/** @type {{ file: string, names: string[], hasAlpha: boolean }[]} */
export const ATLAS_PAGES = page(alphaNames, true, page(opaqueNames, false, []))

/** Every texture name the build has to produce, in atlas order. */
export const MATERIALS = ATLAS_PAGES.flatMap(p => p.names)

/*
 * Materials that are more than "copy the source PNG".
 *
 * Kept as a map keyed by material rather than a flag on the block, because
 * tinting is a property of one face: a grass block's top is greyscale and
 * needs the biome colour, its side is not, and its bottom is shared with
 * plain dirt, which must not be tinted at all.
 */
export const MATERIAL_RECIPES = {
  grass_block_top: { tint: GRASS },
  // Minecraft draws the green fringe as a separate tinted overlay composited
  // over the dirt side. Flattening it here means the block face can stay
  // opaque, which keeps grass out of the alpha atlas.
  grass_block_side: { overlay: 'grass_block_side_overlay', overlayTint: GRASS },
}
for (const def of BLOCK_TYPES) {
  if (def.tint) MATERIAL_RECIPES[def.all] = { tint: def.tint }
  // Merged rather than assigned: water wants both a biome tint and a fixed
  // alpha, and writing a fresh object here would silently drop the tint the
  // line above just set.
  if (def.alphaLevel) (MATERIAL_RECIPES[def.all] ??= {}).alpha = def.alphaLevel
}

/*
 * The water surface, seen from underneath.
 *
 * noa's greedy mesher draws the top face of a water block once, single-sided,
 * facing up. Swim under it and there is nothing over your head -- which is the
 * other half of "go six blocks under the ocean, look up, and see clouds".
 *
 * The fix is one flag, and the interesting part is where it can be set.
 *
 * WHERE. There is no water material to reach at registration time. noa builds
 * terrain materials LAZILY, one per texture URL, the first time a chunk
 * containing that page is meshed -- and it calls `mat.freeze()` immediately
 * after building each one. So this hooks Babylon's "a material joined the
 * scene" observable and flips the flag as each one appears, which is before
 * the freeze because `makeStandardMaterial` adds to the scene in its
 * constructor.
 *
 * (`freeze()` would not actually have stopped this -- backface culling is
 * engine STATE applied in `_preBind` every draw, not a shader define. But it
 * costs nothing to be on the right side of the freeze, and the next flag
 * someone reaches for here might not be so forgiving.)
 *
 * WHAT IT COSTS. Materials are one per atlas PAGE, not one per block, so this
 * is the whole alpha page: water, ice, glass, stained glass, slime and every
 * leaf. Leaves and glass now draw their far faces too. That is more overdraw
 * in the transparent pass and it is also, as it happens, what vanilla's fancy
 * leaves look like from outside a tree. The opaque pages are untouched, which
 * is where all the terrain actually is.
 *
 * REJECTED -- giving water its own atlas page so the flag lands on nothing
 * else. It is the precise fix and it costs a new page, an edit to
 * scripts/build-textures.mjs (another agent's file this pass) and one more
 * sub-mesh per chunk that contains water.
 *
 * REJECTED -- a `blockMesh` for water, the way blockMeshes.js does slabs. It
 * takes water off the terrain mesher entirely: a per-block Babylon mesh for
 * every voxel of a 27-block-deep ocean, to solve a problem one boolean solves.
 */
function installDoubleSidedTranslucents(noa) {
  const alphaFiles = ATLAS_PAGES.filter(p => p.hasAlpha).map(p => p.file)
  const scene = noa.rendering.getScene()
  scene.onNewMaterialAddedObservable.add((mat) => {
    // `terrain-textured-<blockMatID>`, from noa's terrainMaterials.js. The id
    // is what turns the name back into a texture URL; nothing else in the
    // scene uses that prefix.
    if (!mat.name.startsWith('terrain-textured-')) return
    const url = noa.registry.getMaterialData(+mat.name.split('-')[2])?.texture
    if (!url || !alphaFiles.some(f => url.endsWith(f))) return
    mat.backFaceCulling = false
  })
}

export function registerBlocks(noa) {
  const slot = new Map()
  ATLAS_PAGES.forEach((p, pageIndex) => {
    p.names.forEach((name, i) => slot.set(name, [pageIndex, i]))
  })

  for (const [name, [pageIndex, index]] of slot) {
    noa.registry.registerMaterial(name, {
      textureURL: ATLAS_PAGES[pageIndex].file,
      atlasIndex: index,
      texHasAlpha: ATLAS_PAGES[pageIndex].hasAlpha,
    })
  }

  /*
   * Non-cube blocks need a Babylon mesh per id, so the scene and a material
   * cache are built once here rather than per block.
   *
   * `shapeById` is a sparse id -> boxes array. It is the ONE piece of state
   * both the renderer and the collision resolver read, which is what stops a
   * stair from being drawn one shape and collided as another.
   */
  const scene = noa.rendering.getScene()
  const materialFor = createMaterialCache(noa)
  const shapeById = []

  const ids = {}
  for (const def of BLOCK_TYPES) {
    if (def.shape) {
      const boxes = SHAPE_BOXES[def.shape]
      if (!boxes) throw new Error(`block "${def.key}" wants unknown shape "${def.shape}"`)
      shapeById[def.id] = boxes
      ids[def.key] = noa.registry.registerBlock(def.id, {
        /*
         * NO `material`, and this is not an oversight. noa's greedy mesher
         * never consults the object-block lookup: it draws a terrain face for
         * any block that HAS a face material, `blockMesh` or not. Passing one
         * here gets you a full cube drawn over the top of the custom mesh, and
         * the symptom is a slab that looks exactly like a normal block while
         * colliding correctly as half a one -- which took a close-up
         * side-by-side against a real cube to notice at all.
         *
         * The texture still reaches the mesh, via `materialFor(def.all)`; it
         * just doesn't go through noa's terrain path.
         */
        // solid:false hands collision entirely to blockMeshes.js -- noa's
        // sweep only understands whole cubes, and a half-height cube is worse
        // than no cube. opaque:false so the terrain next door still draws the
        // faces a slab doesn't actually cover.
        solid: false,
        opaque: false,
        blockMesh: buildShapeMesh(scene, def.key, boxes, materialFor(def.all)),
      })
      continue
    }
    if (def.invisible) {
      // Solid so it stops you; not opaque so it does not cull the faces of the
      // terrain it stands against; no material so it draws nothing. See the
      // BARRIER note above for why the middle one is load-bearing.
      ids[def.key] = noa.registry.registerBlock(def.id, { solid: true, opaque: false })
      continue
    }
    ids[def.key] = noa.registry.registerBlock(def.id, {
      material: faceMaterials(def),
      // A non-opaque block must not have its neighbours' faces culled, or you
      // see straight through the world from inside a glass box.
      opaque: !def.alpha,
      /*
       * noa's BlockOptions constructor takes `fluid` and derives solid:false
       * and opaque:false from it, so passing the flag alone would be enough
       * for water. Lava is passed opaque:true deliberately and that is NOT an
       * oversight: vanilla lava is on the solid render layer and hides
       * whatever is behind it, so leaving it non-opaque draws the terrain
       * inside a lava lake through the surface.
       */
      fluid: def.fluid === true,
      fluidDensity: def.fluidDensity,
      viscosity: def.viscosity,
    })
  }

  /*
   * noa's crosshair raycast picks "any solid voxel" by default, and non-cube
   * blocks are deliberately not solid -- without this you would look straight
   * through a staircase and be unable to mine one. The pick stays voxel-
   * granular either way: aiming at the empty half of a slab's cell still
   * targets the slab, because fast-voxel-raycast has no notion of a shape.
   */
  const solidity = noa.registry.getBlockSolidity
  /*
   * ...and an invisible block must NOT be targetable, or the crosshair stops
   * on thin air at the world edge and draws a selection box around nothing.
   * Minecraft does the same: a barrier is only pickable while you are holding
   * one, and nobody here can hold one.
   */
  const invisible = new Set(BLOCK_TYPES.filter(b => b.invisible).map(b => b.id))
  noa.blockTargetIdCheck = (id) =>
    !invisible.has(id) && (solidity(id) || shapeById[id] !== undefined)

  installDoubleSidedTranslucents(noa)
  installThinInstanceUploadFix(noa)
  installNonCubeCollision(noa, shapeById)
  installPlacementOrientation(noa, NON_CUBE_VARIANTS)

  return ids
}
