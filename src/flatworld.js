/*
 * The superflat generator. A preset in, a world out.
 *
 * ------------------------------------------------------------------------
 * WHAT THIS REPLACED, AND WHAT THAT BOUGHT
 *
 * The overworld used to be a 128x128 cut of REAL Minecraft 1.21.8 terrain,
 * seed 12345, shipped as public/terrain/terrain.bin and looked up by
 * island.js. That asset is gone from the overworld's boot path, and two
 * things went with it:
 *
 *   - 981KB raw / 404KB gzipped, against a ~1.27MB JS bundle. The single
 *     largest thing the page downloaded, larger than all of the code.
 *
 *   - The licence question. DECISIONS.md #1 records it and
 *     scripts/check-deploy-assets.mjs enforces it: terrain.bin is the output
 *     of Mojang's world generator and nobody has established that it may be
 *     republished. Terrain THIS FILE generates is not their output, so for
 *     the overworld the question simply stops applying. It is NOT resolved
 *     for the Nether, which is still an import -- see the FORBIDDEN note in
 *     check-deploy-assets.mjs.
 *
 * The owner asked for flat ground to build on. He weighed a plains generator
 * and chose superflat FOR NOW, which is why the preset is a parameter and
 * the ladder of blocks is data: swapping in a plains generator should be a
 * new module and one changed row in src/dimensions.js, not surgery here.
 * ------------------------------------------------------------------------
 * THE SHAPE IT EMITS, AND WHY IT IS THE IMPORTER'S SHAPE
 *
 * `flatPatch` returns exactly what src/terrainFormat.js's `decode` returns:
 * { width, depth, yMin, yTop, palette, cols }. That is deliberate and it is
 * the main design decision in this file.
 *
 * REJECTED -- giving island.js a second code path: a `source` object with
 * `imported` and `generated` implementations and a method call in
 * getVoxelID. It reads cleaner in the abstract and it is worse here, for two
 * reasons. getVoxelID runs once per voxel per chunk -- millions of times for
 * one world -- so a polymorphic call in it is a real cost paid to express a
 * difference that only matters once, at load. And two lookup paths is two
 * things that can disagree about the barrier, the bounds or the palette,
 * which is the class of bug this repo has spent the most time on.
 *
 * So the distinction between "generated" and "imported" lives where it is
 * actually a distinction -- in src/dimensions.js, where a dimension row
 * either names an `asset` to fetch or a `generate` thunk to call, and in
 * island.js, which has one entry point for each. Past that point there is
 * one world representation and one lookup, and that is the point.
 *
 * It also scales to the plains generator that is coming. A plains world is
 * not a repeated column, but it is still 128x128 columns of block ids, which
 * is this structure with the sharing below turned off.
 */
import { stampBuilds } from './builds/index.js'

/*
 * Minecraft's own Classic Flat preset, from minecraft.wiki's Superflat page:
 *
 *   {"biome":"minecraft:plains","layers":[
 *     {"block":"minecraft:bedrock","height":1},
 *     {"block":"minecraft:dirt","height":2},
 *     {"block":"minecraft:grass_block","height":1}]}
 *
 * Four blocks: bedrock, two dirt, a grass block on top. In vanilla that puts
 * bedrock at y=-64 and the grass at y=-61, so you stand at y=-60. Here the
 * ladder is anchored to a surface height instead (see `flatPatch`), because
 * this world's spawn height is a number twelve spec files import and vanilla's
 * world floor is not.
 *
 * `block` names are BLOCK_TYPES keys from src/blocks.js, not Minecraft ids --
 * the same keys the imported palette uses, which is why island.js's
 * palette-index -> engine-id table works unchanged for both. The translation
 * from `minecraft:grass_block` to `grass` is scripts/terrain/mapping.mjs's
 * job and it is deliberately not repeated: this preset is already written in
 * the game's own vocabulary.
 */
export const FLAT_PRESETS = {
  classic: {
    label: 'Classic Flat',
    /* Recorded, not used. This engine has no biomes; the preset does, and
     * dropping the field would lose the only note of what a future biome
     * layer should say about this ground. */
    biome: 'minecraft:plains',
    layers: [
      { block: 'bedrock', height: 1 },
      { block: 'dirt', height: 2 },
      { block: 'grass', height: 1 },
    ],
  },

  /*
   * A second preset, kept because a list with one entry is not a parameter,
   * it is a constant with extra steps. This is vanilla's "The Void" minus the
   * void: one layer of stone, nothing else, for when you want to see the
   * shape of a build without dirt and grass reading as ground.
   */
  stoneSlab: {
    label: 'Stone Slab',
    biome: 'minecraft:the_void',
    layers: [{ block: 'stone', height: 1 }],
  },
}

/**
 * Compile a preset into a world.
 *
 * What it is about to do: turn the layer list into ONE column of palette
 * indices running from the world floor up to the ceiling, then hand every
 * (x, z) in the patch that same column.
 *
 * @param opts.preset    a row from FLAT_PRESETS
 * @param opts.width     patch size on x -- island.js's PATCH_SIZE
 * @param opts.depth     patch size on z
 * @param opts.surfaceY  the y a player STANDS AT. The topmost layer block
 *                       sits at surfaceY - 1, so the ladder is anchored to
 *                       its top and grows DOWNWARD; adding layers to a preset
 *                       does not move the ground out from under anybody.
 * @param opts.ceilingY  top of the encoded range. Air from the surface up to
 *                       here, and this is also where island.js stops the
 *                       barrier wall -- so it is the build height.
 * @returns the same object shape src/terrainFormat.js's decode() returns
 */
export function flatPatch({ preset, width, depth, surfaceY, ceilingY, builds = stampBuilds }) {
  const layers = preset.layers
  const thickness = layers.reduce((n, l) => n + l.height, 0)
  const yMin = surfaceY - thickness
  const yTop = ceilingY
  if (yTop < surfaceY) throw new Error(`flatPatch: ceilingY ${yTop} is below surfaceY ${surfaceY}`)

  /*
   * Palette index 0 is 'air' by convention, matching the importer's output.
   * island.js special-cases the KEY 'air' rather than the index, so this is a
   * convention rather than a contract -- but a generated world that reads
   * differently from an imported one in a hex dump is a debugging tax for no
   * gain.
   */
  const palette = ['air']
  const indexOf = (key) => {
    const at = palette.indexOf(key)
    return at === -1 ? palette.push(key) - 1 : at
  }

  const height = yTop - yMin + 1
  const column = new Uint16Array(height) // zero-filled: air all the way up
  let y = yMin
  for (const layer of layers) {
    const idx = indexOf(layer.block)
    for (let n = 0; n < layer.height; n++) column[y++ - yMin] = idx
  }

  /*
   * THE SHARED COLUMN, which is the one thing here worth a second look.
   *
   * Every (x, z) points at the SAME Uint16Array. 16384 references to 69
   * entries instead of 16384 copies -- about 2MB of allocation that a flat
   * world has no use for, and 16384 fewer typed arrays for the GC to walk.
   *
   * It is safe only because this structure is READ-ONLY. getVoxelID indexes
   * into it and nothing in src/ ever writes to `cols` -- player edits go
   * through noa's own voxel store, not back into the generator, which is
   * exactly the property that lets the planned persistence layer be a DIFF
   * against generation. If a future generator ever wants to write into a
   * column, it must allocate per column; a plains generator does that
   * naturally because its columns genuinely differ.
   */
  const cols = new Array(width * depth).fill(column)

  const world = { magic: 'GEN1', width, depth, yMin, yTop, palette, cols }

  /*
   * AND THEN THE BUILDS, which is the only thing in this file that is not
   * about superflat ground.
   *
   * This is the last moment the world is mutable. src/island.js installs it
   * on the next line of its caller and from then on it is read only -- six
   * million reads to mesh it, and never a write. So a structure is columns
   * rewritten ONCE, here, and getVoxelID stays two subtractions and an array
   * read forever. See the long note at the top of src/builds/index.js for the
   * two alternatives (a runtime chunk hook, a setBlock storm at boot) and why
   * both are worse than they look.
   *
   * WHY A PARAMETER rather than a bare call: `builds: null` gives you the
   * empty superflat world back, which is what a spec that wants to measure
   * the ground wants, and it is how the dimension table would turn the builds
   * off for a second generated dimension without this file learning about
   * dimensions. It defaults ON because the world having a road in it is the
   * normal case now, and a default of "empty" would mean the day somebody
   * adds a generated dimension they silently get an empty overworld too.
   *
   * SHARED COLUMN, HANDLED: the stamper clones a column the first time it
   * writes to it. Read the COPY ON WRITE note in src/builds/stamp.js before
   * writing anything that touches `cols` -- every column here is the SAME
   * Uint16Array, and one careless write moves the ground under the whole map.
   */
  if (builds) builds(world, surfaceY)

  return world
}
