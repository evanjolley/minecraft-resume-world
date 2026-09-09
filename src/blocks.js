/*
 * Block definitions.
 *
 * One table drives everything: noa's material/block registration, the
 * inventory's names and icons, and how long a block takes to break. Keeping
 * it in a single place is the reason adding a block later is one entry
 * rather than four edits in four files.
 *
 * noa splits appearance into materials (a texture) and blocks (a voxel type
 * pointing at up to six materials). That split is what lets grass wear green
 * on top, dirt underneath, and a transition strip on its sides.
 *
 * Block id 0 is hardcoded by noa as "air". Never register over it.
 *
 * Textures are Pixel Perfection by Hugh "XSSheep" Rutland, CC-BY-SA-4.0.
 */

export const BLOCK_TYPES = [
  {
    id: 1, key: 'grass', name: 'Grass Block',
    top: 'grass_top', bottom: 'dirt', side: 'grass_side',
    // Seconds to break bare-handed, from the Minecraft wiki.
    hardness: 0.6,
    // Minecraft drops dirt from a grass block, not another grass block.
    drops: 2,
  },
  { id: 2, key: 'dirt', name: 'Dirt', all: 'dirt', hardness: 0.75, drops: 2 },
  // Stone drops cobblestone unless mined with Silk Touch.
  { id: 3, key: 'stone', name: 'Stone', all: 'stone', hardness: 7.5, drops: 4 },
  { id: 4, key: 'cobblestone', name: 'Cobblestone', all: 'cobble', hardness: 10, drops: 4 },
  { id: 5, key: 'planks', name: 'Oak Planks', all: 'planks', hardness: 3, drops: 5 },
]

const MATERIALS = ['grass_top', 'grass_side', 'dirt', 'stone', 'cobble', 'planks']

// id -> definition, for the O(1) lookups the inventory and mining do per frame.
export const BLOCK_BY_ID = new Map(BLOCK_TYPES.map(b => [b.id, b]))

/** The texture names to draw on an inventory icon's three visible faces. */
export function iconFaces(def) {
  return {
    top: def.all || def.top,
    side: def.all || def.side,
  }
}

export function registerBlocks(noa) {
  for (const name of MATERIALS) {
    noa.registry.registerMaterial(name, { textureURL: `${name}.png` })
  }

  const ids = {}
  for (const def of BLOCK_TYPES) {
    // A 3-element material array means [top, bottom, sides]. noa also takes
    // 1 (all faces), 2 ([top+bottom, sides]) or 6 (each face individually).
    const material = def.all
      ? def.all
      : [def.top, def.bottom, def.side]
    ids[def.key] = noa.registry.registerBlock(def.id, { material })
  }
  return ids
}
