#!/usr/bin/env node
/*
 * Builds public/textures/ from a chosen source.
 *
 *   npm run textures            -> rebuild whatever is already installed
 *   npm run textures:ce         -> Pixel Perfection CE (committed, CC-BY-SA-4.0)
 *   npm run textures:vanilla    -> your own Minecraft install
 *
 * The plain `textures` script deliberately names no source, so it means
 * "build this again" rather than "switch to CE". It used to mean the latter,
 * and running it to check an unrelated change to this file silently replaced
 * a developer's vanilla textures with CE -- a five-second command that undoes
 * a deliberate choice and says nothing about it. Switching sources is now
 * something you can only ask for by name.
 *
 * public/textures/ is generated and gitignored. That split exists for one
 * reason: Mojang's textures are not redistributable. Extracting them from a
 * copy of Minecraft you own, onto your own machine, is fine; committing them
 * to a public repo or serving them from a public site is redistribution.
 * Keeping the output untracked makes the wrong thing hard to do by accident.
 *
 * The list of textures to produce is NOT kept here. It's imported from
 * src/blocks.js, which is the same list noa registers materials from, so a
 * block cannot reference a texture the build doesn't know to produce. The
 * previous arrangement duplicated the names in both files and only found out
 * they'd drifted when a block rendered as missing-texture checkerboard.
 *
 * Three artifacts come out of one decode pass:
 *   - textures/<name>.png    one per material, for blockIcon.js's CSS cubes
 *   - textures/atlasN.png    vertical strips noa uploads as sampler2DArray
 *   - textures/held/<key>.png  48x16 [side|top|bottom] strips for heldItem.js
 */
import {
  mkdirSync, rmSync, readdirSync, copyFileSync, existsSync, readFileSync,
  writeFileSync, renameSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir, tmpdir } from 'node:os'
import sharp from 'sharp'
import { ITEM_TEXTURES } from '../src/items.js'

import {
  BLOCK_TYPES, MATERIALS, ATLAS_PAGES, MATERIAL_RECIPES, faceMaterials,
} from '../src/blocks.js'
import { ANIMATIONS, STANDALONE, atlasLayout } from '../src/terrainAnimation.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = join(ROOT, 'public')
const CE_SRC = join(ROOT, 'textures-src', 'ce')

/*
 * Output is built into a staging directory and swapped in at the end.
 *
 * Building in place meant deleting public/textures first and regenerating it
 * over several seconds, during which a running dev server 404s every texture
 * and the world renders as missing-texture checkerboard. Staging reduces that
 * window to a directory rename.
 */
const STAGE = join(PUBLIC, '.build')
const OUT = join(STAGE, 'textures')
const UI = join(STAGE, 'ui')
const SKINS = join(STAGE, 'skins')

// Records which source produced the current build, so `npm install` can
// rebuild the SAME one instead of silently reverting a vanilla build to CE.
const MARKER = join(PUBLIC, 'textures', '.source')

const arg = (name, fallback) => {
  const found = process.argv.find(a => a.startsWith(`--${name}=`))
  return found ? found.split('=')[1] : fallback
}

const ensureOnly = process.argv.includes('--ensure')
let source = arg('source', null)

if (!source) {
  source = existsSync(MARKER) ? readFileSync(MARKER, 'utf8').trim() : 'ce'
}

/*
 * --ensure is what postinstall runs. If a usable build is already present it
 * does nothing at all, so installing a dependency never disturbs the textures
 * a developer deliberately chose.
 *
 * "Usable" used to mean "more than five files exist", which was true of a
 * build made before the palette grew -- so pulling new blocks and running
 * `npm install` left the old textures in place and every new material
 * resolved to a 404. The check is now against what blocks.js actually asks
 * for: every atlas page present, and at least as many PNGs as materials.
 */
/*
 * Item sprites and the GUI art that only crafting/armor needs.
 *
 * `resolve(name, from)` differs per source, so both paths share this and only
 * supply the lookup. Items are flat 16x16 sprites, unlike blocks -- they are
 * NOT atlas pages, because they're drawn by the DOM inventory rather than by
 * the terrain shader.
 */
async function emitItems(resolve) {
  const dir = join(OUT, 'item')
  mkdirSync(dir, { recursive: true })
  const missing = []
  for (const { name, from } of ITEM_TEXTURES) {
    const src = await resolve(name, from)
    // A missing sprite is a reportable gap, not a crash. One absent file
    // used to take the whole build down and leave public/ half-written.
    if (!src || !existsSync(src)) { missing.push(name); continue }
    // Same first-square-frame rule as blocks: some item textures are
    // vertical animation strips.
    const meta = await sharp(src).metadata()
    const frame = Math.min(meta.width, meta.height)
    await sharp(src).extract({ left: 0, top: 0, width: frame, height: frame })
      .resize(TILE, TILE, { kernel: 'nearest' }).ensureAlpha()
      .png().toFile(join(dir, `${name}.png`))
  }
  return missing
}

/*
 * The empty-slot hints Minecraft draws in armor and offhand slots. Those live
 * at gui/sprites/container/slot/ from 1.20.2, which CE (pack_format 6)
 * predates entirely -- so for CE they're derived from that pack's own armor
 * item art: desaturated, darkened and made translucent, which is what the
 * vanilla hints look like anyway.
 */
async function deriveSlotHint(src, out) {
  const { data, info } = await sharp(src).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true })
  for (let i = 0; i < data.length; i += 4) {
    const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
    const grey = Math.round(lum * 0.45)
    data[i] = data[i + 1] = data[i + 2] = grey
    data[i + 3] = Math.round(data[i + 3] * 0.55)
  }
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png().toFile(out)
}

function looksComplete() {
  const dir = join(PUBLIC, 'textures')
  if (!existsSync(MARKER)) return false
  if (!ATLAS_PAGES.every(p => existsSync(join(dir, p.file)))) return false
  // Without this, switching sources after items existed leaves the old
  // item sprites in place and they silently belong to the wrong pack.
  const itemDir = join(dir, 'item')
  if (!existsSync(itemDir)) return false
  if (readdirSync(itemDir).length < ITEM_TEXTURES.length) return false
  return readdirSync(dir).filter(f => f.endsWith('.png')).length >= MATERIALS.length
}

if (ensureOnly && looksComplete()) {
  console.log(`textures already built from "${source}" -- leaving them alone`)
  process.exit(0)
}

const TILE = 16

/* ------------------------------------------------------------------ *
 * Pixel Perfection CE is a pack_format 6 (Minecraft 1.16) pack, so it
 * predates Caves & Cliffs, copper, deepslate, mangrove/cherry/pale oak,
 * bamboo wood, sculk and froglights. 95 of the 427 materials have no
 * CE original at all.
 *
 * The alternative was to skip those blocks under CE -- but block ids are
 * world data, so a block that exists under one source and not the other
 * means saved builds decode differently depending on which textures you
 * happen to have. So every block exists under both sources, and the ones
 * CE can't draw get a colour-multiplied derivative of the nearest CE
 * texture instead. It reads as "the right family, wrong pack" rather than
 * as a bug, and derivatives of a CC-BY-SA pack are themselves CC-BY-SA,
 * which is recorded in textures-src/ce/NOTICE.txt.
 *
 * `mul` is a per-channel multiplier expressed as an 8-bit colour, the same
 * operation Minecraft's own biome tinting uses. [255,255,255] is a copy.
 * ------------------------------------------------------------------ */

const DEEPSLATE = [140, 148, 160]
const DEEPSLATE_DARK = [112, 120, 134]
const TUFF = [198, 204, 188]
const COPPER = [255, 150, 110]
const EXPOSED = [215, 165, 135]
const WEATHERED = [150, 200, 165]
const OXIDIZED = [110, 215, 180]

const sub = (from, mul = [255, 255, 255]) => ({ from, mul })

/*
 * Items CE has no art for, same reasoning as the block substitutes: dropping
 * them would make item ids mean different things depending on which texture
 * source you built with, and ids are save data. Colour-shifted from the
 * nearest CE item instead -- "right family, wrong pack" rather than blank.
 */
/*
 * Which item's art each empty armor/offhand slot hint is derived from, for
 * sources that predate gui/sprites/container/slot/ (added in 1.20.2).
 * Vanilla has the real sprites and uses these names directly.
 */
const SLOT_HINT_SOURCE = {
  helmet: 'iron_helmet',
  chestplate: 'iron_chestplate',
  leggings: 'iron_leggings',
  boots: 'iron_boots',
  shield: 'iron_ingot',   // no flat shield sprite exists; vanilla renders it 3D
}

const CE_ITEM_SUBSTITUTES = {
  copper_ingot: sub('gold_ingot', [200, 115, 75]),
  raw_copper: sub('gold_ingot', [190, 110, 80]),
  raw_iron: sub('iron_ingot', [215, 175, 155]),
  raw_gold: sub('gold_ingot', [235, 195, 90]),
  amethyst_shard: sub('diamond', [190, 130, 235]),
}

const CE_SUBSTITUTES = {
  // Caves & Cliffs stone
  tuff: sub('andesite', TUFF),
  polished_tuff: sub('polished_andesite', TUFF),
  tuff_bricks: sub('stone_bricks', TUFF),
  chiseled_tuff: sub('chiseled_stone_bricks', TUFF),
  chiseled_tuff_top: sub('polished_andesite', TUFF),
  chiseled_tuff_bricks: sub('chiseled_stone_bricks', TUFF),
  chiseled_tuff_bricks_top: sub('stone_bricks', TUFF),
  calcite: sub('polished_diorite', [252, 250, 243]),
  dripstone_block: sub('granite', [200, 185, 170]),
  amethyst_block: sub('purpur_block', [190, 130, 235]),
  budding_amethyst: sub('purpur_block', [175, 115, 220]),
  moss_block: sub('grass_block_top', [160, 215, 105]),

  // Deepslate, which is stone's palette shifted cold and dark
  deepslate: sub('stone', DEEPSLATE),
  deepslate_top: sub('stone', DEEPSLATE),
  cobbled_deepslate: sub('cobblestone', DEEPSLATE),
  polished_deepslate: sub('polished_andesite', DEEPSLATE),
  deepslate_bricks: sub('stone_bricks', DEEPSLATE),
  cracked_deepslate_bricks: sub('cracked_stone_bricks', DEEPSLATE),
  deepslate_tiles: sub('stone_bricks', DEEPSLATE_DARK),
  cracked_deepslate_tiles: sub('cracked_stone_bricks', DEEPSLATE_DARK),
  chiseled_deepslate: sub('chiseled_stone_bricks', DEEPSLATE),
  reinforced_deepslate_top: sub('chiseled_stone_bricks', DEEPSLATE_DARK),
  reinforced_deepslate_bottom: sub('stone_bricks', DEEPSLATE_DARK),
  reinforced_deepslate_side: sub('stone_bricks', DEEPSLATE_DARK),

  // Soil
  rooted_dirt: sub('dirt', [232, 226, 220]),
  mud: sub('dirt', [150, 150, 165]),
  packed_mud: sub('coarse_dirt', [215, 197, 178]),
  mud_bricks: sub('bricks', [190, 235, 215]),

  // Ores. The deepslate ones are the CE ore with deepslate's shift on top,
  // which keeps the ore speckles reading as the right mineral.
  copper_ore: sub('iron_ore', [255, 190, 150]),
  ...Object.fromEntries(['coal', 'iron', 'gold', 'redstone', 'lapis', 'diamond', 'emerald']
    .map(o => [`deepslate_${o}_ore`, sub(`${o}_ore`, DEEPSLATE)])),
  deepslate_copper_ore: sub('iron_ore', [190, 150, 130]),

  raw_iron_block: sub('iron_block', [235, 215, 195]),
  raw_copper_block: sub('iron_block', [255, 165, 120]),
  raw_gold_block: sub('gold_block', [255, 240, 200]),

  // Copper, all four oxidation stages, off iron's metal texture
  copper_block: sub('iron_block', COPPER),
  exposed_copper: sub('iron_block', EXPOSED),
  weathered_copper: sub('iron_block', WEATHERED),
  oxidized_copper: sub('iron_block', OXIDIZED),
  cut_copper: sub('stone_bricks', COPPER),
  exposed_cut_copper: sub('stone_bricks', EXPOSED),
  weathered_cut_copper: sub('stone_bricks', WEATHERED),
  oxidized_cut_copper: sub('stone_bricks', OXIDIZED),
  chiseled_copper: sub('chiseled_stone_bricks', COPPER),
  exposed_chiseled_copper: sub('chiseled_stone_bricks', EXPOSED),
  weathered_chiseled_copper: sub('chiseled_stone_bricks', WEATHERED),
  oxidized_chiseled_copper: sub('chiseled_stone_bricks', OXIDIZED),
  copper_bulb: sub('redstone_lamp', [255, 175, 120]),
  // Grate is the only cutout in this group, so the base has to be a cutout too.
  copper_grate: sub('iron_bars', COPPER),

  smooth_basalt: sub('basalt_top', [190, 190, 200]),

  // Sculk, off warped wart -- the only teal-on-dark texture CE has
  sculk: sub('warped_wart_block', [90, 110, 120]),
  sculk_catalyst_top: sub('warped_wart_block', [140, 160, 170]),
  sculk_catalyst_side: sub('warped_wart_block', [100, 115, 125]),
  sculk_catalyst_bottom: sub('warped_wart_block', [90, 110, 120]),

  // Froglights, off sea lantern, which is already a glowing tile
  ochre_froglight_side: sub('sea_lantern', [255, 205, 110]),
  ochre_froglight_top: sub('sea_lantern', [255, 220, 140]),
  verdant_froglight_side: sub('sea_lantern', [150, 235, 150]),
  verdant_froglight_top: sub('sea_lantern', [175, 240, 175]),
  pearlescent_froglight_side: sub('sea_lantern', [245, 190, 225]),
  pearlescent_froglight_top: sub('sea_lantern', [250, 210, 235]),

  resin_block: sub('honeycomb_block', [255, 150, 110]),
  resin_bricks: sub('bricks', [255, 190, 150]),

  // 1.19+ woods, each off the closest CE wood
  mangrove_planks: sub('dark_oak_planks', [225, 140, 130]),
  mangrove_log: sub('dark_oak_log', [220, 150, 140]),
  mangrove_log_top: sub('dark_oak_log_top', [220, 150, 140]),
  stripped_mangrove_log: sub('stripped_dark_oak_log', [230, 150, 140]),
  stripped_mangrove_log_top: sub('stripped_dark_oak_log_top', [230, 150, 140]),
  cherry_planks: sub('birch_planks', [235, 175, 180]),
  cherry_log: sub('birch_log', [190, 150, 155]),
  cherry_log_top: sub('birch_log_top', [235, 175, 180]),
  stripped_cherry_log: sub('stripped_birch_log', [235, 165, 170]),
  stripped_cherry_log_top: sub('stripped_birch_log_top', [235, 165, 170]),
  pale_oak_planks: sub('birch_planks', [245, 240, 235]),
  pale_oak_log: sub('birch_log', [235, 235, 235]),
  pale_oak_log_top: sub('birch_log_top', [240, 235, 230]),
  stripped_pale_oak_log: sub('stripped_birch_log', [245, 242, 238]),
  stripped_pale_oak_log_top: sub('stripped_birch_log_top', [245, 242, 238]),
  bamboo_planks: sub('birch_planks', [235, 215, 140]),
  bamboo_mosaic: sub('birch_planks', [228, 203, 128]),
  bamboo_block: sub('stripped_birch_log', [230, 215, 130]),
  bamboo_block_top: sub('stripped_birch_log_top', [220, 210, 140]),
  stripped_bamboo_block: sub('stripped_birch_log', [242, 222, 142]),
  stripped_bamboo_block_top: sub('stripped_birch_log_top', [242, 222, 142]),

  // Leaves are greyscale in CE too, so these get biome-tinted downstream
  // exactly like the leaves CE does have.
  mangrove_leaves: sub('oak_leaves'),
  cherry_leaves: sub('oak_leaves'),
  pale_oak_leaves: sub('oak_leaves', [225, 228, 222]),

  chiseled_bookshelf_side: sub('oak_planks'),
  chiseled_bookshelf_top: sub('oak_planks'),
  chiseled_bookshelf_empty: sub('bookshelf'),

  tinted_glass: sub('black_stained_glass', [210, 210, 210]),

  /*
   * CE ships no water or lava texture at all -- it is a 1.16 pack built on top
   * of vanilla for the animated fluids, and animated fluids are the one thing
   * this atlas cannot carry anyway (one still layer per material, no time).
   *
   * Ice stands in for water because it is the only blue-white block texture in
   * the pack, and it is already blue, so the biome tint in blocks.js is skipped
   * by the greyscale test and only the forced alpha applies. Magma stands in
   * for lava unmultiplied: it is the same molten-crust artwork, just cooler.
   */
  water_still: sub('ice', [150, 180, 235]),
  lava_still: sub('magma', [255, 255, 255]),
}

/* ------------------------------------------------------------------ *
 * Pixel plumbing
 * ------------------------------------------------------------------ */

/**
 * Decode any source PNG to a 16x16 RGBA raw buffer.
 *
 * Two shapes have to survive this: animation strips (magma, sea lantern,
 * prismarine ship as 16x32 up to 16x512 vertical frame stacks) and packs at
 * a resolution other than 16. Cropping to the first square frame handles
 * both, and is what "still frame of the animation" means -- noa's atlas has
 * one layer per material and no notion of time.
 */
async function decode(file) {
  const img = sharp(file)
  const { width, height } = await img.metadata()
  const frame = Math.min(width, height)
  return sharp(file)
    .extract({ left: 0, top: 0, width: frame, height: frame })
    .resize(TILE, TILE, { kernel: 'nearest' })
    .ensureAlpha()
    .raw().toBuffer()
}

/**
 * Decode an animation strip to N separate 16x16 frames.
 *
 * Vanilla ships an animated texture as a vertical stack of square frames, so
 * frame i is the square at y = i * width. `decode()` above deliberately takes
 * only the first one; this takes them all, and is the only reason this build
 * can produce a moving texture at all.
 *
 * If the source is too short -- which is every substituted CE texture, since
 * CE ships no animated fluids -- frame 0 is repeated. The layout stays
 * identical either way, which is what lets src/terrainAnimation.js compute
 * layer indices without asking the build what it managed to find.
 */
async function decodeFrames(file, count) {
  const { width, height } = await sharp(file).metadata()
  const available = Math.floor(height / width)
  const out = []
  for (let i = 0; i < count; i++) {
    const top = Math.min(i, available - 1) * width
    out.push(await sharp(file)
      .extract({ left: 0, top, width, height: width })
      .resize(TILE, TILE, { kernel: 'nearest' })
      .ensureAlpha()
      .raw().toBuffer())
  }
  return out
}

/**
 * Check this build's idea of an animation against the pack's own `.mcmeta`.
 *
 * src/terrainAnimation.js carries frame counts and timings as constants
 * because the runtime needs them synchronously, before any fetch. Constants
 * copied out of a jar rot. This is what stops them: every build that has a
 * `.mcmeta` to read compares it field by field and throws on a disagreement,
 * so the numbers are verified rather than trusted.
 */
function verifyMcmeta(dir, name, anim) {
  const meta = join(dir, `${name}.png.mcmeta`)
  if (!existsSync(meta)) return false
  const a = JSON.parse(readFileSync(meta, 'utf8')).animation
  if (!a) return false
  const want = (label, mine, theirs) => {
    if (JSON.stringify(mine) !== JSON.stringify(theirs)) {
      throw new Error(`${name}: terrainAnimation.js says ${label} ${JSON.stringify(mine)}, `
        + `${name}.png.mcmeta says ${JSON.stringify(theirs)}`)
    }
  }
  want('frametime', anim.frametime, a.frametime ?? 1)
  want('order', anim.order, a.frames ?? null)
  want('interpolate', anim.interpolate, !!a.interpolate)
  return true
}

/** Force every non-transparent pixel's alpha, in place. Fully transparent
 *  pixels stay transparent -- a cutout texture must not gain a ghost. */
function setAlpha(buf, a) {
  for (let i = 3; i < buf.length; i += 4) if (buf[i] > 0) buf[i] = a
  return buf
}

/** Multiply RGB by an 8-bit colour, in place. Alpha is untouched. */
function multiply(buf, [r, g, b]) {
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = (buf[i] * r) / 255
    buf[i + 1] = (buf[i + 1] * g) / 255
    buf[i + 2] = (buf[i + 2] * b) / 255
  }
  return buf
}

/**
 * Mean chroma, 0..1. Used to decide whether a tint is wanted.
 *
 * Minecraft tints grass and leaves at render time and ships them greyscale,
 * but packs aren't consistent about it -- CE draws birch and spruce leaves
 * pre-coloured and cherry leaves are full-colour even in vanilla. Applying a
 * tint to an already-coloured texture turns it to mud, so the tint is applied
 * only when the source really is close to grey.
 */
function chroma(buf) {
  let total = 0, n = 0
  for (let i = 0; i < buf.length; i += 4) {
    if (buf[i + 3] === 0) continue
    const max = Math.max(buf[i], buf[i + 1], buf[i + 2])
    const min = Math.min(buf[i], buf[i + 1], buf[i + 2])
    total += max === 0 ? 0 : (max - min) / max
    n++
  }
  return n ? total / n : 0
}

const GREY_ENOUGH_TO_TINT = 0.22

/** Alpha-composite `over` onto `base`, in place. */
function composite(base, over) {
  for (let i = 0; i < base.length; i += 4) {
    const a = over[i + 3] / 255
    if (a === 0) continue
    for (let c = 0; c < 3; c++) base[i + c] = over[i + c] * a + base[i + c] * (1 - a)
    base[i + 3] = Math.max(base[i + 3], over[i + 3])
  }
  return base
}

const toPng = (raw, w, h) => sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png()

/**
 * Run tasks with a bounded number in flight.
 *
 * ~800 PNG encodes serially took most of a minute; sharp releases the event
 * loop during libvips work, so the only thing needed is to keep several in
 * flight. Unbounded Promise.all over all of them is worse, not better -- it
 * queues 800 libvips jobs and spends the time in contention.
 */
async function pooled(items, limit, fn) {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++])
  })
  await Promise.all(workers)
}

/* ------------------------------------------------------------------ *
 * Sources
 * ------------------------------------------------------------------ */

/**
 * Resolve every material name to a file path, per source.
 * Returns { path(name) -> file, substituted: Set<string> }.
 */
function resolver(dir, allowSubstitutes) {
  const file = (n) => join(dir, `${n}.png`)
  const substituted = new Map()
  const need = new Set(MATERIALS)
  for (const r of Object.values(MATERIAL_RECIPES)) if (r.overlay) need.add(r.overlay)

  const missing = []
  for (const name of need) {
    if (existsSync(file(name))) continue
    const s = allowSubstitutes && CE_SUBSTITUTES[name]
    if (!s) { missing.push(name); continue }
    if (!existsSync(file(s.from))) { missing.push(`${name} (via ${s.from})`); continue }
    substituted.set(name, s)
  }
  if (missing.length) {
    throw new Error(`no source texture for ${missing.length} material(s):\n  ${missing.join('\n  ')}`)
  }
  return { file, substituted }
}

/**
 * Decode every material into a Map of name -> 16x16 RGBA buffer, applying
 * substitution, biome tint and overlay compositing along the way.
 */
async function decodeAll(dir, allowSubstitutes) {
  const { file, substituted } = resolver(dir, allowSubstitutes)
  const raw = new Map()
  const need = new Set(MATERIALS)
  for (const r of Object.values(MATERIAL_RECIPES)) if (r.overlay) need.add(r.overlay)

  await pooled([...need], 16, async (name) => {
    const s = substituted.get(name)
    const buf = await decode(file(s ? s.from : name))
    if (s) multiply(buf, s.mul)
    raw.set(name, buf)
  })

  let tinted = 0
  for (const [name, recipe] of Object.entries(MATERIAL_RECIPES)) {
    const buf = raw.get(name)
    if (!buf) continue
    if (recipe.tint && chroma(buf) < GREY_ENOUGH_TO_TINT) { multiply(buf, recipe.tint); tinted++ }
    // A flat alpha, for a material whose translucency is a property of the
    // BLOCK rather than of the artwork. Vanilla bakes 180 into water_still.png
    // already, so this is a no-op there and the whole reason it exists is the
    // substituted sources, which are opaque.
    if (recipe.alpha !== undefined) setAlpha(buf, recipe.alpha)
    if (recipe.overlay) {
      const over = Buffer.from(raw.get(recipe.overlay))
      if (recipe.overlayTint && chroma(over) < GREY_ENOUGH_TO_TINT) multiply(over, recipe.overlayTint)
      composite(buf, over)
    }
  }
  /*
   * Animation frames, stashed on the Map the callers already pass around.
   *
   * A property on `raw` rather than a second return value because both source
   * paths do `decodeAll(...)` -> `writeTextures(raw)` -> `buildHeldAtlases(raw)`
   * and only the middle one wants frames. Changing the shape would have edited
   * four call sites to tell three of them something they do not use.
   */
  const frames = new Map()
  let verified = 0
  for (const [name, anim] of Object.entries(ANIMATIONS)) {
    if (!raw.has(name)) continue
    const s = substituted.get(name)
    const bufs = await decodeFrames(file(s ? s.from : name), anim.frames)
    if (!s && verifyMcmeta(dir, name, anim)) verified++
    const recipe = MATERIAL_RECIPES[name] || {}
    // The greyscale test has to run on the UNTOUCHED frame: `raw` was tinted
    // in place by the loop above, so asking it whether it is grey enough to
    // tint now answers "no" for exactly the textures that were.
    const tint = recipe.tint && chroma(bufs[0]) < GREY_ENOUGH_TO_TINT
    for (const buf of bufs) {
      if (s) multiply(buf, s.mul)
      if (tint) multiply(buf, recipe.tint)
      if (recipe.alpha !== undefined) setAlpha(buf, recipe.alpha)
    }
    frames.set(name, bufs)
  }

  /*
   * Standalone runs have no material in blocks.js to hang off, so they are
   * decoded by name and their absence is survivable: CE ships no portal
   * texture, and a flat purple tile is a better failure than a crash in a
   * build whose whole point is that both sources produce the same world.
   */
  for (const [name, anim] of Object.entries(STANDALONE)) {
    if (existsSync(file(name))) {
      frames.set(name, await decodeFrames(file(name), anim.frames))
      verifyMcmeta(dir, name, anim)
    } else {
      const flat = Buffer.alloc(TILE * TILE * 4)
      for (let i = 0; i < flat.length; i += 4) {
        flat[i] = 94; flat[i + 1] = 27; flat[i + 2] = 152; flat[i + 3] = 200
      }
      frames.set(name, Array.from({ length: anim.frames }, () => Buffer.from(flat)))
    }
  }
  raw.frames = frames

  const frameCount = [...frames.values()].reduce((n, f) => n + f.length, 0)
  console.log(`  decoded ${raw.size} textures (${substituted.size} substituted, ${tinted} biome-tinted)`)
  console.log(`  ${frameCount} animation frames across ${frames.size} textures `
    + `(${verified} verified against .mcmeta)`)
  return raw
}

/* ------------------------------------------------------------------ *
 * Outputs
 * ------------------------------------------------------------------ */

async function writeTextures(raw) {
  // One file per material. Only blockIcon.js reads these -- terrain uses the
  // atlases -- but the inventory icons are plain CSS background-images, and
  // slicing an atlas in CSS would mean hardcoding every material's row.
  await pooled(MATERIALS, 16, async (name) => {
    await toPng(raw.get(name), TILE, TILE).toFile(join(OUT, `${name}.png`))
  })

  /*
   * Atlas pages. noa's material plugin uploads a vertical strip as a
   * sampler2DArray and infers the layer count from height/width, so a page
   * is literally its tiles' raw buffers concatenated -- 16x16 tiles stacked
   * vertically are already contiguous scanlines in that order, so there is
   * no compositing to do.
   */
  const layout = atlasLayout()
  for (const page of layout) {
    // The page's materials first, at the indices noa meshed them with, then
    // every animation frame appended after them. Nothing static moves, which
    // is why adding frames does not invalidate a save or a chunk.
    const tiles = page.names.map(n => raw.get(n))
    for (const { name, frame } of page.extra) tiles.push(raw.frames.get(name)[frame])
    await toPng(Buffer.concat(tiles), TILE, TILE * tiles.length).toFile(join(OUT, page.file))
  }
  console.log(`  ${MATERIALS.length} textures, ${layout.length} atlas pages `
    + `(${layout.map(p => p.layers).join('+')} layers, `
    + `${layout.reduce((n, p) => n + p.extra.length, 0)} of them animation frames)`)
}

async function buildHeldAtlases(raw) {
  mkdirSync(join(OUT, 'held'), { recursive: true })
  // Invisible blocks (the world-edge barrier) have no face textures to strip,
  // and nothing can hold one anyway.
  const held = BLOCK_TYPES.filter(def => !def.invisible)
  await pooled(held, 16, async (def) => {
    // One 48x16 strip of [side | top | bottom]; heldItem.js maps the box's
    // six faces onto the right third with Babylon faceUV. Built by copying
    // scanlines rather than with three sharp composites, because at 355
    // blocks that was three quarters of the build time.
    const [side, , top, bottom] = faceMaterials(def)
    const src = [raw.get(side), raw.get(top), raw.get(bottom)]
    const strip = Buffer.alloc(48 * TILE * 4)
    for (let y = 0; y < TILE; y++) {
      for (let t = 0; t < 3; t++) {
        src[t].copy(strip, (y * 48 + t * TILE) * 4, y * TILE * 4, (y + 1) * TILE * 4)
      }
    }
    await toPng(strip, 48, TILE).toFile(join(OUT, 'held', `${def.key}.png`))
  })
  console.log(`  ${held.length} held-item atlases`)
}

/*
 * Normalised UI sprite set, so the HUD can be written once against fixed
 * names and sizes regardless of which source is active.
 *
 * The two sources are shaped completely differently: classic packs pack
 * everything into a few atlases at fixed offsets, while Minecraft 1.21 ships
 * one file per sprite. Both are reduced to the same output here.
 */
const UI_ATLAS_CROPS = {
  // from widgets.png
  widgets: {
    hotbar: [0, 0, 182, 22],
    hotbar_selection: [0, 22, 24, 24],
    button: [0, 66, 200, 20],
    button_hover: [0, 86, 200, 20],
  },
  // from icons.png
  icons: {
    heart_empty: [16, 0, 9, 9], heart_full: [52, 0, 9, 9], heart_half: [61, 0, 9, 9],
    food_empty: [16, 27, 9, 9], food_full: [52, 27, 9, 9], food_half: [61, 27, 9, 9],
    xp_bg: [0, 64, 182, 5], xp_fill: [0, 69, 182, 5],
    // Verified against the vanilla sprites by luminance.
    armor_empty: [16, 9, 9, 9], armor_half: [25, 9, 9, 9], armor_full: [34, 9, 9, 9],
    /*
     * Air bubbles. There are only TWO of them, not the three every other row
     * here has: the legacy sheet ships a full bubble and a bursting one and no
     * empty container at all, because Minecraft draws nothing where a spent
     * bubble was. 1.21 kept that -- its air_empty.png exists and is 9x9 of
     * pure transparency -- so neither source is sliced for one.
     */
    air_full: [16, 18, 9, 9], air_bursting: [25, 18, 9, 9],
  },
  inventory: { inventory: [0, 0, 176, 166] },
}

const ui = (name) => join(UI, `${name}.png`)

async function uiFromAtlases(dir) {
  mkdirSync(UI, { recursive: true })
  for (const [atlas, crops] of Object.entries(UI_ATLAS_CROPS)) {
    const file = join(dir, `${atlas}.png`)
    for (const [name, [left, top, width, height]] of Object.entries(crops)) {
      await sharp(file).extract({ left, top, width, height }).png().toFile(ui(name))
    }
  }
  await deriveBlinkHearts()
  console.log(`  sliced ${Object.values(UI_ATLAS_CROPS).reduce((n, c) => n + Object.keys(c).length, 0)} UI sprites from atlases`)
}

/*
 * The damage-flash hearts, for the atlas path only.
 *
 * Legacy icons.png HAS slots for them -- u=25 for the blinking container, 70
 * and 79 for the pale full and half heart, which is where 1.8's
 * `16 + k3 * 9` and `j6 + 54 / + 63` land. CE fills all three with a byte-for-
 * byte copy of the unhighlighted sprite (checked: the 9x9 crops hash equal),
 * so slicing them would build a flash you cannot see. They are derived here
 * instead.
 *
 * One formula for all three: lerp every opaque pixel 60% toward white. That is
 * not a guess -- it reproduces vanilla's blinking heart red exactly
 * (19 -> 161, and 255 stays 255). Where it falls short is the container, whose
 * black outline vanilla replaces with pure white and this lands on grey. A
 * second hand-tuned rule for one sprite in a fallback path was not worth it;
 * grey on black still reads as a flash.
 */
async function deriveBlinkHearts() {
  for (const [from, to] of [
    ['heart_empty', 'heart_empty_blink'],
    ['heart_full', 'heart_full_blink'],
    ['heart_half', 'heart_half_blink'],
  ]) {
    const img = sharp(ui(from)).ensureAlpha()
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue
      for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] + (255 - data[i + c]) * 0.6)
    }
    await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
      .png().toFile(ui(to))
  }
}

async function uiFromVanilla(jar, tmp) {
  mkdirSync(UI, { recursive: true })
  const SPRITES = {
    hotbar: 'gui/sprites/hud/hotbar', hotbar_selection: 'gui/sprites/hud/hotbar_selection',
    heart_full: 'gui/sprites/hud/heart/full', heart_half: 'gui/sprites/hud/heart/half',
    heart_empty: 'gui/sprites/hud/heart/container',
    /*
     * The damage flash. Vanilla ships these as real art, not as a tint: the
     * container's outline is white instead of black, and the heart is a washed
     * red (255,19,19 -> 255,161,161). Extracting them is why the flash reads
     * as Minecraft's rather than as a CSS filter's.
     */
    heart_empty_blink: 'gui/sprites/hud/heart/container_blinking',
    heart_full_blink: 'gui/sprites/hud/heart/full_blinking',
    heart_half_blink: 'gui/sprites/hud/heart/half_blinking',
    food_full: 'gui/sprites/hud/food_full', food_half: 'gui/sprites/hud/food_half',
    food_empty: 'gui/sprites/hud/food_empty',
    xp_bg: 'gui/sprites/hud/experience_bar_background',
    xp_fill: 'gui/sprites/hud/experience_bar_progress',
    // See the note in UI_ATLAS_CROPS: no empty bubble, by design in both sources.
    air_full: 'gui/sprites/hud/air', air_bursting: 'gui/sprites/hud/air_bursting',
    button: 'gui/sprites/widget/button', button_hover: 'gui/sprites/widget/button_highlighted',
  }
  execFileSync('unzip', ['-q', '-o', '-j', jar,
    ...Object.values(SPRITES).map(p => `assets/minecraft/textures/${p}.png`),
    'assets/minecraft/textures/gui/container/inventory.png', '-d', tmp])
  for (const [name, path] of Object.entries(SPRITES)) {
    copyFileSync(join(tmp, `${path.split('/').pop()}.png`), ui(name))
  }
  // The container sheet is a 256x256 page; the inventory GUI is its top-left
  // 176x166. Minecraft draws it by blitting exactly that region.
  await sharp(join(tmp, 'inventory.png'))
    .extract({ left: 0, top: 0, width: 176, height: 166 }).png().toFile(ui('inventory'))
  console.log(`  extracted ${Object.keys(SPRITES).length + 1} UI sprites`)
}

async function fromCE() {
  const raw = await decodeAll(join(CE_SRC, 'block'), true)
  await writeTextures(raw)
  await buildHeldAtlases(raw)

  // Non-block art the pack ships pre-derived: the crack strip, sun, moon,
  // clouds and the first-person hand.
  for (const f of readdirSync(CE_SRC)) {
    if (f.endsWith('.png')) copyFileSync(join(CE_SRC, f), join(OUT, f))
  }
  /*
   * The attribution travels with the textures. CC-BY-SA requires it wherever
   * the work is distributed, and public/ is what gets deployed -- the source
   * tree is not. build-sounds.mjs already does this for audio; textures did
   * not, so /textures/NOTICE.txt 404'd for anyone who followed the credit.
   */
  copyFileSync(join(CE_SRC, 'NOTICE.txt'), join(OUT, 'NOTICE.txt'))

  await uiFromAtlases(join(CE_SRC, 'gui'))

  /*
   * Items. CE keeps its own `item/` subset; the five post-1.16 items it
   * predates are colour-shifted from the nearest one it does have, and block
   * items resolve from `block/` since vanilla's own item model for torches
   * and ladders is a flat block texture.
   */
  const missingItems = await emitItems(async (name, from) => {
    if (from === 'block') return join(CE_SRC, 'block', `${name}.png`)
    const direct = join(CE_SRC, 'item', `${name}.png`)
    if (existsSync(direct)) return direct
    const s = CE_ITEM_SUBSTITUTES[name]
    if (!s) return null
    const base = join(CE_SRC, 'item', `${s.from}.png`)
    if (!existsSync(base)) return null
    // Reuse the block substitutes' own multiply, so a CE item derivative is
    // produced exactly the way a CE block derivative is.
    const tinted = join(OUT, 'item', `.tmp-${name}.png`)
    mkdirSync(join(OUT, 'item'), { recursive: true })
    const { data, info } = await sharp(base).ensureAlpha().raw()
      .toBuffer({ resolveWithObject: true })
    multiply(data, s.mul)
    await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
      .png().toFile(tinted)
    return tinted
  })
  for (const f of readdirSync(join(OUT, 'item'))) {
    if (f.startsWith('.tmp-')) rmSync(join(OUT, 'item', f))
  }
  if (missingItems.length) console.log(`  no CE art for: ${missingItems.join(' ')}`)

  await sharp(join(CE_SRC, 'gui', 'crafting_table.png'))
    .extract({ left: 0, top: 0, width: 176, height: 166 })
    .png().toFile(join(UI, 'crafting_table.png'))

  // Empty-slot hints, derived from CE's own armor art -- see deriveSlotHint.
  for (const [slot, art] of Object.entries(SLOT_HINT_SOURCE)) {
    const src = join(OUT, 'item', `${art}.png`)
    if (existsSync(src)) await deriveSlotHint(src, join(UI, `slot_${slot}.png`))
  }

  mkdirSync(SKINS, { recursive: true })
  // Normalised to RGBA: skins ship as palette PNGs, and the model's material
  // needs a predictable alpha channel for the hat/jacket overlay layers.
  await sharp(join(CE_SRC, 'entity', 'steve.png')).ensureAlpha().png().toFile(join(SKINS, 'default.png'))
  console.log('built from Pixel Perfection CE')
}

async function fromVanilla() {
  const versions = join(homedir(), 'Library', 'Application Support', 'minecraft', 'versions')
  if (!existsSync(versions)) throw new Error(`no Minecraft install found at ${versions}`)
  // Prefer the highest numeric release; snapshots sort oddly so they're skipped.
  const picked = readdirSync(versions)
    .filter(v => /^\d+\.\d+(\.\d+)?$/.test(v) && existsSync(join(versions, v, `${v}.jar`)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop()
  if (!picked) throw new Error('no release jar found (only snapshots?)')

  const jar = join(versions, picked, `${picked}.jar`)
  const tmp = join(tmpdir(), `mcjar-${process.pid}`)
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })

  /*
   * Extracting one `block/` path per material means a 450-entry unzip
   * argument list, and unzip fails the whole run if any single pattern
   * matches nothing. Pulling the whole block directory in one pass is
   * faster and makes a missing texture surface later, by name, in
   * resolver() -- which can say which material wanted it.
   */
  execFileSync('unzip', ['-q', '-o', '-j', jar, 'assets/minecraft/textures/block/*', '-d', tmp])
  execFileSync('unzip', ['-q', '-o', '-j', jar,
    'assets/minecraft/textures/environment/sun.png',
    'assets/minecraft/textures/environment/moon_phases.png',
    'assets/minecraft/textures/colormap/grass.png', '-d', tmp])

  const t = (n) => join(tmp, `${n}.png`)

  /*
   * The plains-biome grass colour, read from the game's own colormap rather
   * than hardcoded. The map is indexed by temperature and downfall; plains
   * is 0.8 / 0.4, which lands at (51, 173).
   *
   * blocks.js also carries a hardcoded plains colour, for the CE build where
   * there's no colormap to read. They agree to within a couple of units.
   */
  const cmap = await sharp(t('grass')).raw().toBuffer({ resolveWithObject: true })
  const px = (51 + 173 * cmap.info.width) * cmap.info.channels
  const tint = [cmap.data[px], cmap.data[px + 1], cmap.data[px + 2]]
  console.log(`  biome tint from colormap: rgb(${tint.join(', ')})`)
  MATERIAL_RECIPES.grass_block_top.tint = tint
  MATERIAL_RECIPES.grass_block_side.overlayTint = tint

  const raw = await decodeAll(tmp, false)
  await writeTextures(raw)
  await buildHeldAtlases(raw)

  // Ten destroy stages stacked into the 16x160 strip crackOverlay.js expects,
  // flattened to black so it acts as a pure alpha mask.
  const frames = await Promise.all(Array.from({ length: 10 }, (_, i) => decode(t(`destroy_stage_${i}`))))
  const strip = Buffer.alloc(TILE * 160 * 4)
  frames.forEach((f, i) => {
    for (let p = 0; p < TILE * TILE; p++) {
      const o = (i * 256 + p) * 4
      strip[o] = 0; strip[o + 1] = 0; strip[o + 2] = 0; strip[o + 3] = f[p * 4 + 3]
    }
  })
  await toPng(strip, TILE, 160).toFile(join(OUT, 'crack.png'))

  /*
   * Sun and moon ship with NO alpha channel -- they are solid squares on
   * black, and Minecraft hides the black with additive blending. Rather than
   * fight Babylon's blend modes, alpha is derived from luminance here: black
   * becomes fully transparent and the disc keeps its soft edge. Same visual
   * result as additive, but plain alpha blending renders it.
   */
  const alphaFromLuminance = async (input, out) => {
    const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    for (let i = 0; i < data.length; i += 4) {
      const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114)
      data[i + 3] = Math.min(255, Math.round(lum * 1.25))
    }
    await toPng(data, info.width, info.height).toFile(out)
  }

  await alphaFromLuminance(t('sun'), join(OUT, 'sun.png'))
  const moon = await sharp(t('moon_phases')).metadata()
  const cell = Math.floor(moon.width / 4)
  const moonCell = await sharp(t('moon_phases'))
    .extract({ left: 0, top: 0, width: cell, height: cell }).png().toBuffer()
  await alphaFromLuminance(moonCell, join(OUT, 'moon.png'))

  // Clouds and the first-person hand have no vanilla equivalent we can use,
  // so they stay on the CC-licensed pack.
  for (const f of ['cloud.png', 'hand.png']) copyFileSync(join(CE_SRC, f), join(OUT, f))

  await uiFromVanilla(jar, tmp)

  /* Items, and the GUI art only crafting and armor need. */
  const itemTmp = join(tmp, 'item')
  const blockTmp = join(tmp, 'block')
  mkdirSync(itemTmp, { recursive: true })
  mkdirSync(blockTmp, { recursive: true })
  execFileSync('unzip', ['-q', '-o', '-j', jar, 'assets/minecraft/textures/item/*', '-d', itemTmp])
  execFileSync('unzip', ['-q', '-o', '-j', jar, 'assets/minecraft/textures/block/*', '-d', blockTmp])
  const missingItems = await emitItems(async (name, from) => {
    const src = join(from === 'block' ? blockTmp : itemTmp, `${name}.png`)
    return existsSync(src) ? src : null
  })
  if (missingItems.length) console.log(`  missing from jar: ${missingItems.join(' ')}`)

  execFileSync('unzip', ['-q', '-o', '-j', jar,
    'assets/minecraft/textures/gui/sprites/hud/armor_full.png',
    'assets/minecraft/textures/gui/sprites/hud/armor_half.png',
    'assets/minecraft/textures/gui/sprites/hud/armor_empty.png',
    'assets/minecraft/textures/gui/container/crafting_table.png',
    ...Object.keys(SLOT_HINT_SOURCE).map(n =>
      `assets/minecraft/textures/gui/sprites/container/slot/${n}.png`), '-d', tmp])
  for (const n of ['armor_full', 'armor_half', 'armor_empty']) {
    copyFileSync(join(tmp, `${n}.png`), join(UI, `${n}.png`))
  }
  for (const n of Object.keys(SLOT_HINT_SOURCE)) {
    const src = join(tmp, `${n}.png`)
    if (existsSync(src)) copyFileSync(src, join(UI, `slot_${n}.png`))
  }
  await sharp(join(tmp, 'crafting_table.png'))
    .extract({ left: 0, top: 0, width: 176, height: 166 })
    .png().toFile(join(UI, 'crafting_table.png'))

  // The default player skin. 64x64 wide (classic 4px arms) -- the model in
  // playerModel.js is UV-mapped for that layout, not the 3px slim variant.
  mkdirSync(SKINS, { recursive: true })
  execFileSync('unzip', ['-q', '-o', '-j', jar,
    'assets/minecraft/textures/entity/player/wide/steve.png', '-d', tmp])
  await sharp(join(tmp, 'steve.png')).ensureAlpha().png().toFile(join(SKINS, 'default.png'))

  rmSync(tmp, { recursive: true, force: true })
  console.log(`extracted vanilla textures from Minecraft ${picked}`)
  console.log('\n  These are Mojang assets. Fine on your own machine; do NOT')
  console.log('  commit them or deploy them publicly. public/textures/ is')
  console.log('  gitignored so this stays hard to do by accident.\n')
}


/* ------------------------------------------------------------------ *
 * EVAN'S SKIN, and the cape question.
 *
 * Source: skins-src/jollyboys/, committed, with provenance in its
 * SOURCE.txt. Emitted from BOTH sources above rather than from either one,
 * because it has nothing to do with where the block textures came from --
 * it is Evan's own account art, not Mojang's palette.
 *
 * THE CAPE IS SEPARABLE ON PURPOSE. The skin is Evan's appearance; the cape
 * is a Mojang asset granted to an account, and whether it may be SERVED is
 * an open question (docs/DEPLOYMENT.md). So `--no-cape` produces a build
 * with a correct, capeless Evan in it, and build:deploy passes it. Rejected:
 * deciding the question here, and rejected: shipping the cape and relying on
 * .assetsignore -- vite copies public/ into dist/ wholesale, so "gitignored"
 * and "not deployed" are different facts and this repo has confused them
 * twice already.
 */
const wantsCape = !process.argv.includes('--no-cape')
const EVAN_SRC = join(ROOT, 'skins-src', 'jollyboys')

/*
 * LEGACY 64x32 -> 64x64, transcribed from Mojang's own conversion
 * (SkinTextureDownloader.processLegacySkin).
 *
 * A pre-1.8 sheet carries ONE arm and ONE leg; the game drew the other side
 * by mirroring at render time. The 64x64 layout gives every limb its own
 * region, so the mirroring has to happen once, here, in the pixels.
 *
 * Each row is [srcX, srcY, dx, dy, w, h]: copy that rect to (srcX+dx,
 * srcY+dy), flipped horizontally. The offsets look arbitrary and are not --
 * a mirrored limb also SWAPS its left and right side faces, which is why
 * e.g. the right leg's right face (0,20) lands on the left leg's left face
 * (24,52) rather than straight across.
 *
 * Getting this wrong is not subtle once you look: the classic failure is a
 * left arm whose shading runs the wrong way, or a seam down the front.
 * Verified by screenshot from the front, not by reading these numbers.
 */
const LEGACY_LIMB_COPIES = [
  // right leg -> left leg
  [4, 16, 16, 32, 4, 4], [8, 16, 16, 32, 4, 4],
  [0, 20, 24, 32, 4, 12], [4, 20, 16, 32, 4, 12],
  [8, 20, 8, 32, 4, 12], [12, 20, 16, 32, 4, 12],
  // right arm -> left arm
  [44, 16, -8, 32, 4, 4], [48, 16, -8, 32, 4, 4],
  [40, 20, 0, 32, 4, 12], [44, 20, -8, 32, 4, 12],
  [48, 20, -16, 32, 4, 12], [52, 20, -8, 32, 4, 12],
]

/*
 * The base (non-overlay) regions, which vanilla forces opaque after the
 * conversion. Old skin editors left stray alpha-0 pixels in them, and the
 * model has no second layer behind the base, so a transparent pixel there is
 * a HOLE you can see the sky through. JollyBoys' sheet has transparent
 * pixels inside this box; whether any of them land on a sampled face was not
 * worth establishing when vanilla's answer is "force them all opaque".
 */
const BASE_LAYER_REGIONS = [
  [0, 0, 32, 16],   // head
  [0, 16, 64, 16],  // body, right arm, right leg
  [16, 48, 16, 16], // left leg, after conversion
  [32, 48, 16, 16], // left arm, after conversion
]

async function emitEvanSkin() {
  const src = join(EVAN_SRC, 'skin.png')
  const meta = await sharp(src).metadata()
  const legacy = meta.height === 32
  if (meta.width !== 64 || (meta.height !== 32 && meta.height !== 64)) {
    throw new Error(`skins-src/jollyboys/skin.png is ${meta.width}x${meta.height}, not a skin`)
  }

  // Top half in place, bottom half transparent -- exactly what vanilla's
  // `new NativeImage(64, 64)` + copyFrom + fillRect(0,32,64,32,0) leaves.
  const px = Buffer.alloc(64 * 64 * 4)
  const { data } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  data.copy(px, 0, 0, Math.min(data.length, 64 * 64 * 4))

  const at = (x, y) => (y * 64 + x) * 4
  if (legacy) {
    for (const [sx, sy, dx, dy, w, h] of LEGACY_LIMB_COPIES) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          // flipX: the destination's left edge is the source's right edge.
          px.copy(px, at(sx + dx + x, sy + dy + y),
            at(sx + w - 1 - x, sy + y), at(sx + w - 1 - x, sy + y) + 4)
        }
      }
    }
  }
  for (const [x0, y0, w, h] of BASE_LAYER_REGIONS) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) px[at(x, y) + 3] = 255
  }
  /*
   * NOT implemented: vanilla's doNotchTransparencyHack, which blanks the hat
   * layer when a pre-alpha skin filled it with opaque colour. playerModel.js
   * draws no overlay layer at all, so it would be dead code -- and this
   * particular sheet's hat region already has transparency, so the hack
   * would decline to fire anyway.
   */
  await toPng(px, 64, 64).toFile(join(SKINS, 'evan.png'))
  return legacy
}

const started = Date.now()
rmSync(STAGE, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
if (source === 'vanilla') await fromVanilla()
else await fromCE()

writeFileSync(join(OUT, '.source'), source)

/*
 * Evan last, so it runs whichever source built the blocks. Inside the
 * staging dir like everything else, so a rebuild never leaves public/skins/
 * holding a converted skin and no cape (or the reverse) for a second and a
 * half while a dev server is reading it.
 */
const wasLegacy = await emitEvanSkin()
if (wantsCape) {
  await sharp(join(EVAN_SRC, 'cape.png')).ensureAlpha().png().toFile(join(SKINS, 'evan-cape.png'))
}
console.log(`  evan skin: ${wasLegacy ? '64x32 legacy, converted to 64x64' : '64x64'}`
  + `, cape ${wantsCape ? 'included (LOCAL ONLY -- see docs/DEPLOYMENT.md)' : 'excluded'}`)

// Swap the staged build in. Renames are near-instant, so a dev server sees at
// most a flicker rather than seconds of missing textures.
for (const name of ['textures', 'ui', 'skins']) {
  const live = join(PUBLIC, name)
  const staged = join(STAGE, name)
  if (!existsSync(staged)) continue
  const old = `${live}.old`
  rmSync(old, { recursive: true, force: true })
  if (existsSync(live)) renameSync(live, old)
  renameSync(staged, live)
  rmSync(old, { recursive: true, force: true })
}
rmSync(STAGE, { recursive: true, force: true })
console.log(`active texture source: ${source} (${((Date.now() - started) / 1000).toFixed(1)}s)`)
