/*
 * Block definitions.
 *
 * One table drives everything: noa's material/block registration, the
 * inventory's names and icons, and how long a block takes to break.
 *
 * Textures are Pixel Perfection Continued Edition, CC-BY-SA-4.0, which is a
 * real Minecraft resource pack (original by Hugh "XSSheep" Rutland). It
 * predates Caves & Cliffs, so there is no deepslate, copper or tuff -- which
 * is why island.js generates 1.16-era strata rather than 1.18+.
 *
 * Block id 0 is hardcoded by noa as "air". Never register over it.
 *
 * Ids 1-5 are load-bearing: they predate this table and any world data saved
 * before it assumes them. Append, never renumber.
 *
 * `hardness` is BARE-HANDED SECONDS, not Minecraft's raw hardness value.
 * Minecraft computes break time as hardness * 1.5 for blocks a tool isn't
 * required for, and hardness * 5 when the correct tool is required and you
 * don't have it. There are no tools here, so the seconds are baked in.
 */

export const BLOCK_TYPES = [
  { id: 1, key: 'grass', name: 'Grass Block',
    top: 'grass_top', bottom: 'dirt', side: 'grass_side',
    hardness: 0.9, drops: 2 },
  { id: 2, key: 'dirt', name: 'Dirt', all: 'dirt', hardness: 0.75 },
  // Stone drops cobblestone unless mined with Silk Touch.
  { id: 3, key: 'stone', name: 'Stone', all: 'stone', hardness: 7.5, drops: 4 },
  { id: 4, key: 'cobblestone', name: 'Cobblestone', all: 'cobble', hardness: 10 },
  { id: 5, key: 'planks', name: 'Oak Planks', all: 'planks', hardness: 3 },

  // Unbreakable, like the real thing. interact.js checks for this.
  { id: 6, key: 'bedrock', name: 'Bedrock', all: 'bedrock', hardness: Infinity },

  { id: 7, key: 'gravel', name: 'Gravel', all: 'gravel', hardness: 0.9 },
  { id: 8, key: 'andesite', name: 'Andesite', all: 'andesite', hardness: 7.5 },
  { id: 9, key: 'diorite', name: 'Diorite', all: 'diorite', hardness: 7.5 },
  { id: 10, key: 'granite', name: 'Granite', all: 'granite', hardness: 7.5 },

  // All ores are hardness 3.0 in Minecraft and require a pickaxe, so bare
  // handed they take 15 seconds each.
  { id: 11, key: 'coal_ore', name: 'Coal Ore', all: 'coal_ore', hardness: 15 },
  { id: 12, key: 'iron_ore', name: 'Iron Ore', all: 'iron_ore', hardness: 15 },
  { id: 13, key: 'gold_ore', name: 'Gold Ore', all: 'gold_ore', hardness: 15 },
  { id: 14, key: 'redstone_ore', name: 'Redstone Ore', all: 'redstone_ore', hardness: 15 },
  { id: 15, key: 'lapis_ore', name: 'Lapis Lazuli Ore', all: 'lapis_ore', hardness: 15 },
  { id: 16, key: 'diamond_ore', name: 'Diamond Ore', all: 'diamond_ore', hardness: 15 },
  { id: 17, key: 'emerald_ore', name: 'Emerald Ore', all: 'emerald_ore', hardness: 15 },
]

const MATERIALS = [
  'grass_top', 'grass_side', 'dirt', 'stone', 'cobble', 'planks', 'bedrock',
  'gravel', 'andesite', 'diorite', 'granite', 'coal_ore', 'iron_ore',
  'gold_ore', 'redstone_ore', 'lapis_ore', 'diamond_ore', 'emerald_ore',
]

// id -> definition, for the O(1) lookups mining and the inventory do per frame.
export const BLOCK_BY_ID = new Map(BLOCK_TYPES.map(b => [b.id, b]))

/** The texture names to draw on an inventory icon's three visible faces. */
export function iconFaces(def) {
  return { top: def.all || def.top, side: def.all || def.side }
}

export function registerBlocks(noa) {
  for (const name of MATERIALS) {
    noa.registry.registerMaterial(name, { textureURL: `${name}.png` })
  }

  const ids = {}
  for (const def of BLOCK_TYPES) {
    // A 3-element material array means [top, bottom, sides]. noa also takes
    // 1 (all faces), 2 ([top+bottom, sides]) or 6 (each face individually).
    const material = def.all ? def.all : [def.top, def.bottom, def.side]
    ids[def.key] = noa.registry.registerBlock(def.id, { material })
  }
  return ids
}
