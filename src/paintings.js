/*
 * THE PAINTING REGISTRY: every painting's name, its size in blocks, and where
 * its art comes from. Pure data and pure functions -- no Babylon, no noa.
 *
 * It is imported by BOTH the game (src/paintingArt.js draws from it) and the
 * build script (scripts/build-paintings.mjs emits PNGs from it), and that is
 * the whole reason it is its own file. A painting's size lives in exactly one
 * place, so a custom image whose art is built 3 blocks wide cannot be hung 2
 * blocks wide -- the two halves read the same row.
 *
 *
 * WHERE THE VANILLA TABLE CAME FROM. Not a wiki page and not memory: it is
 * `assets/minecraft/textures/painting/*.png` out of the 1.21.8 client jar,
 * with each file's pixel size divided by 16. 52 files, one of which is
 * `back.png` (the frame, not a variant), leaving 51 variants. Vanilla stores
 * the same numbers in the `painting_variant` registry as `width`/`height` in
 * BLOCKS; the art is the same fact in pixels and it is the copy this machine
 * can actually check. If the two ever disagree, the jar is what renders.
 *
 *
 * WHAT VANILLA IS AND WHAT THIS IS. In 1.21 a painting is an ENTITY
 * (`net.minecraft.world.entity.decoration.Painting`) hanging on a wall face.
 * Here it is a BLOCK, and src/paintingArt.js's header argues that at length.
 * The short version: everything a painting needs in this engine -- crosshair
 * targeting, a shape-accurate outline, mining, drops, "pops when its wall is
 * mined" -- is already built and all of it is keyed on block ids. An entity
 * would reimplement five working systems to match a class name.
 */

/** Vanilla's resolution: one painting pixel per 1/16 of a block. */
export const VANILLA_PX_PER_BLOCK = 16

/*
 * ...AND CUSTOM PAINTINGS DIVERGE, DELIBERATELY. This is the one number in
 * the file that is not vanilla's, and it is not a mistake.
 *
 * The point of a custom painting here is a PHOTOGRAPH hung next to the thing
 * it is a photograph of, so a visitor can compare the build to the building.
 * At vanilla's 16 px/block a 3x2 painting is 48x32 pixels. That is a legible
 * emblem and it is not a legible photograph -- you could not tell one school
 * from another at that size, which means the painting would fail at the only
 * job it has.
 *
 * COUNTED, because docs/FUTURE.md's sign entry was talked out of a bad idea
 * by arithmetic and this is the same question. A GPU texture is uncompressed
 * RGBA8, so the cost is 4 bytes per texel of a WxH block painting:
 *
 *     px/block   3x2 pixels   texture memory   x7 chapters
 *        16        48 x 32       6 KB            43 KB    illegible
 *        64       192 x 128     98 KB           688 KB    soft up close
 *   -->  128      384 x 256    393 KB           2.7 MB    <-- chosen
 *       256       768 x 512    1.5 MB          10.5 MB    diminishing
 *
 * 393 KB is LESS THAN ONE of the per-sign DynamicTextures src/signText.js
 * rejected at 899 KB each, and there will be seven paintings in this world
 * rather than a hundred signs. 2.7 MB for the whole set is a rounding error
 * against the terrain atlases, and it buys an image you can actually read.
 *
 * 256 was rejected on the seventh copy, not the first: one is fine, seven is
 * 10.5 MB for wall decoration, and the extra sharpness only shows if you
 * stand closer to the painting than you would stand to read it.
 *
 * Changing this number is a one-line change plus `npm run paintings`. It is a
 * constant rather than a per-painting field on purpose -- seven paintings at
 * seven resolutions is seven judgement calls, and nobody wants to make six of
 * them.
 */
export const CUSTOM_PX_PER_BLOCK = 128

/*
 * The 51 vanilla variants, grouped by size. Keyed by size because that is how
 * placement reads them: vanilla's `PaintingItem` asks "what fits in the space
 * I clicked" and picks from the answers, so the shape of this table is the
 * shape of the question.
 */
const VANILLA_BY_SIZE = {
  '1x1': ['alban', 'aztec', 'aztec2', 'bomb', 'kebab', 'meditative', 'plant', 'wasteland'],
  '1x2': ['graham', 'prairie_ride', 'wanderer'],
  '2x1': ['courbet', 'creebet', 'pool', 'sea', 'sunset'],
  '2x2': ['baroque', 'bust', 'earth', 'fire', 'humble', 'match', 'skull_and_roses',
    'stage', 'void', 'water', 'wind', 'wither'],
  '3x3': ['bouquet', 'cavebird', 'cotan', 'dennis', 'endboss', 'fern', 'owlemons',
    'sunflowers', 'tides'],
  '3x4': ['backyard', 'pond'],
  '4x2': ['changing', 'fighters', 'finding', 'lowmist', 'passage'],
  '4x3': ['donkey_kong', 'skeleton'],
  '4x4': ['burning_skull', 'orb', 'pigscene', 'pointer', 'unpacked'],
}

/*
 * The four that a placed painting will never roll.
 *
 * 1.21 gates random selection on the `#minecraft:placeable` painting-variant
 * tag, and earth/wind/fire/water are outside it: they are obtainable only by
 * giving yourself the item with the variant already stamped on it. They stay
 * in the table above because they EXIST and something may want to hang one
 * deliberately; they are excluded from the roll so that clicking a 2x2 wall
 * gives the same eight-in-twelve odds it gives in vanilla.
 */
const NOT_PLACEABLE = new Set(['earth', 'wind', 'fire', 'water'])

/** name -> { name, w, h, custom:false, placeable } for all 51. */
export const VANILLA_VARIANTS = new Map(
  Object.entries(VANILLA_BY_SIZE).flatMap(([size, names]) => {
    const [w, h] = size.split('x').map(Number)
    return names.map(name => [name, {
      name, w, h, custom: false, placeable: !NOT_PLACEABLE.has(name),
    }])
  }))

/*
 * ------------------------------------------------------------------
 * CUSTOM PAINTINGS: Evan's own images, one per chapter.
 *
 * ADD A ROW HERE AND RUN `npm run paintings`. That is the entire process for
 * the next six. The row says what the image is called in the world, which
 * file on disk it comes from, and how many blocks across and down it hangs;
 * the build script crops the source to that aspect ratio and writes
 * public/paintings/<name>.png at CUSTOM_PX_PER_BLOCK. Nothing else needs
 * editing -- not blocks.js, not the item, not the renderer.
 *
 * `source` is relative to paintings-src/. The source file is COMMITTED next
 * to this row rather than left on somebody's Desktop, because the build has
 * to be reproducible on a machine that is not Evan's. See docs/paintings.md
 * for the licensing note that comes with that.
 *
 * SIZE IS AN ASPECT RATIO DECISION, and it is the one that goes wrong. The
 * source is cropped to w:h, never squashed, so a landscape photograph in a
 * portrait frame loses its ends. millardnorth2.webp is 2000x1276 -- 1.568:1,
 * a hair wider than 3:2 -- so it hangs 3 WIDE by 2 HIGH and gives up 43
 * pixels off each side. "2x3" was the request and 2x3 is the portrait
 * reading of those numbers; a landscape photograph in a 2-wide, 3-tall frame
 * would have been cropped to its middle third.
 *
 * AND VANILLA HAS NEITHER 2x3 NOR 3x2. Check the table above: the sizes are
 * 1x1, 1x2, 2x1, 2x2, 3x3, 3x4, 4x2, 4x3, 4x4, and there is no 6-block
 * rectangle of any orientation among them. So a custom painting is not a
 * vanilla variant with a different picture in it -- the size Evan asked for
 * does not exist in Minecraft, and being able to declare one is half of what
 * this file is for.
 * ------------------------------------------------------------------
 */
export const CUSTOM_PAINTINGS = [
  {
    name: 'millard_north',
    title: 'Millard North High School',
    source: 'millardnorth2.webp',
    w: 3,
    h: 2,
  },
]

/** name -> { name, w, h, custom:true, ... } */
export const CUSTOM_VARIANTS = new Map(
  CUSTOM_PAINTINGS.map(p => [p.name, { ...p, custom: true, placeable: false }]))

/** Every painting in the world, vanilla and custom, by name. */
export const PAINTINGS = new Map([...VANILLA_VARIANTS, ...CUSTOM_VARIANTS])

/**
 * The variants that a player clicking a wall may be given, largest first.
 *
 * LARGEST FIRST because that is vanilla's rule and it is not obvious: 1.21's
 * `PaintingItem.placePainting` collects every variant that fits, then keeps
 * only those of the maximum area. Click a 4x4 wall and you never get a 1x1 --
 * you get one of the five 4x4s. Sorting here means the caller filters by fit
 * and takes the first area it meets.
 */
export const PLACEABLE = [...VANILLA_VARIANTS.values()]
  .filter(v => v.placeable)
  .sort((a, b) => (b.w * b.h) - (a.w * a.h))

/**
 * Where a painting's art file lives, as a URL the browser can fetch.
 *
 * TWO DIRECTORIES, AND THE SPLIT IS A LICENCE BOUNDARY, not a tidiness one.
 * Custom art is Evan's and is committed; vanilla art is Mojang's, is
 * extracted from a local install by `npm run paintings`, and is gitignored
 * under public/paintings/vanilla/ for exactly the reason public/textures/ is.
 * A deployed build therefore HAS the custom paintings and does NOT have the
 * vanilla ones -- see the missing-art note in src/paintingArt.js, which is
 * what draws instead.
 */
export const artUrl = (name) =>
  CUSTOM_VARIANTS.has(name)
    ? `paintings/${name}.png`
    : `paintings/vanilla/${name}.png`

/** The frame: vanilla's painting/back.png, the same 16x16 on every painting. */
export const BACK_ART_URL = 'paintings/vanilla/back.png'
