#!/usr/bin/env node
/*
 * Builds public/textures/ from a chosen source.
 *
 *   npm run textures            -> Pixel Perfection CE (committed, CC-BY-SA-4.0)
 *   npm run textures:vanilla    -> your own Minecraft install
 *
 * public/textures/ is generated and gitignored. That split exists for one
 * reason: Mojang's textures are not redistributable. Extracting them from a
 * copy of Minecraft you own, onto your own machine, is fine; committing them
 * to a public repo or serving them from a public site is redistribution.
 * Keeping the output untracked makes the wrong thing hard to do by accident.
 */
import { mkdirSync, rmSync, readdirSync, copyFileSync, existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir, tmpdir } from 'node:os'
import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'textures')
const UI = join(ROOT, 'public', 'ui')
const source = (process.argv.find(a => a.startsWith('--source=')) || '--source=ce').split('=')[1]

/* Block key -> texture file name in a vanilla Minecraft jar. */
const VANILLA = {
  dirt: 'dirt', stone: 'stone', cobble: 'cobblestone', planks: 'oak_planks',
  bedrock: 'bedrock', gravel: 'gravel', andesite: 'andesite', diorite: 'diorite',
  granite: 'granite', coal_ore: 'coal_ore', iron_ore: 'iron_ore', gold_ore: 'gold_ore',
  redstone_ore: 'redstone_ore', lapis_ore: 'lapis_ore', diamond_ore: 'diamond_ore',
  emerald_ore: 'emerald_ore',
}

/* Which textures each held-item atlas needs, as [side, top, bottom]. */
const HELD = { grass: ['grass_side', 'grass_top', 'dirt'] }
for (const k of Object.keys(VANILLA)) {
  const key = k === 'cobble' ? 'cobblestone' : k
  HELD[key] = [k, k, k]
}

const png = (name) => join(OUT, `${name}.png`)
const ui = (name) => join(UI, `${name}.png`)

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
  },
  inventory: { inventory: [0, 0, 176, 166] },
}

async function buildHeldAtlases() {
  mkdirSync(join(OUT, 'held'), { recursive: true })
  for (const [key, [side, top, bottom]] of Object.entries(HELD)) {
    // One 48x16 strip of [side | top | bottom]; heldItem.js maps the box's
    // six faces onto the right third with Babylon faceUV.
    const tiles = await Promise.all([side, top, bottom].map(async (n, i) => ({
      input: await sharp(png(n)).resize(16, 16, { kernel: 'nearest' }).toBuffer(),
      left: i * 16, top: 0,
    })))
    await sharp({ create: { width: 48, height: 16, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(tiles).png().toFile(join(OUT, 'held', `${key}.png`))
  }
}

async function uiFromAtlases(dir) {
  mkdirSync(UI, { recursive: true })
  for (const [atlas, crops] of Object.entries(UI_ATLAS_CROPS)) {
    const file = join(dir, `${atlas}.png`)
    for (const [name, [left, top, width, height]] of Object.entries(crops)) {
      await sharp(file).extract({ left, top, width, height }).png().toFile(ui(name))
    }
  }
  console.log(`  sliced ${Object.values(UI_ATLAS_CROPS).reduce((n, c) => n + Object.keys(c).length, 0)} UI sprites from atlases`)
}

async function uiFromVanilla(jar, tmp) {
  mkdirSync(UI, { recursive: true })
  const SPRITES = {
    hotbar: 'gui/sprites/hud/hotbar', hotbar_selection: 'gui/sprites/hud/hotbar_selection',
    heart_full: 'gui/sprites/hud/heart/full', heart_half: 'gui/sprites/hud/heart/half',
    heart_empty: 'gui/sprites/hud/heart/container',
    food_full: 'gui/sprites/hud/food_full', food_half: 'gui/sprites/hud/food_half',
    food_empty: 'gui/sprites/hud/food_empty',
    xp_bg: 'gui/sprites/hud/experience_bar_background',
    xp_fill: 'gui/sprites/hud/experience_bar_progress',
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
  const SRC = join(ROOT, 'textures-src', 'ce')
  mkdirSync(join(OUT, 'held'), { recursive: true })
  for (const f of readdirSync(SRC)) {
    if (f === 'held') continue
    copyFileSync(join(SRC, f), join(OUT, f))
  }
  for (const f of readdirSync(join(SRC, 'held'))) {
    copyFileSync(join(SRC, 'held', f), join(OUT, 'held', f))
  }
  await uiFromAtlases(join(SRC, 'gui'))
  console.log(`built ${readdirSync(OUT).length - 1} textures from Pixel Perfection CE`)
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

  const want = [
    ...Object.values(VANILLA), 'grass_block_top', 'grass_block_side',
    'grass_block_side_overlay', ...Array.from({ length: 10 }, (_, i) => `destroy_stage_${i}`),
  ].map(n => `assets/minecraft/textures/block/${n}.png`)
  want.push('assets/minecraft/textures/environment/sun.png',
            'assets/minecraft/textures/environment/moon_phases.png',
            'assets/minecraft/textures/colormap/grass.png')
  execFileSync('unzip', ['-q', '-o', '-j', jar, ...want, '-d', tmp])

  mkdirSync(OUT, { recursive: true })
  const t = (n) => join(tmp, `${n}.png`)

  for (const [key, file] of Object.entries(VANILLA)) copyFileSync(t(file), png(key))

  /*
   * Grass needs the biome colormap. In modern Minecraft grass_block_top and
   * grass_block_side_overlay ship GREYSCALE and are tinted at runtime, so
   * copying them straight out gives you a white lawn. The colormap is indexed
   * by temperature and downfall; plains is 0.8 / 0.4, which lands at (51,173).
   */
  const cmap = await sharp(t('grass')).raw().toBuffer({ resolveWithObject: true })
  const px = (51 + 173 * cmap.info.width) * cmap.info.channels
  const tint = { r: cmap.data[px], g: cmap.data[px + 1], b: cmap.data[px + 2] }
  console.log(`  biome tint from colormap: rgb(${tint.r}, ${tint.g}, ${tint.b})`)

  /*
   * Multiply each channel by the tint, which is what Minecraft's shader does.
   * sharp's .tint() is NOT the same operation -- it re-chromas while
   * preserving luminance, and on these greyscale sources it returned the
   * image unchanged, leaving a white lawn.
   */
  const multiplyTint = async (file) => {
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    for (let i = 0; i < data.length; i += 4) {
      data[i] = (data[i] * tint.r) / 255
      data[i + 1] = (data[i + 1] * tint.g) / 255
      data[i + 2] = (data[i + 2] * tint.b) / 255
    }
    return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer()
  }

  await sharp(await multiplyTint(t('grass_block_top'))).toFile(png('grass_top'))

  // The green fringe on the sides is the tinted overlay over the dirt side.
  const overlay = await multiplyTint(t('grass_block_side_overlay'))
  await sharp(t('grass_block_side')).ensureAlpha()
    .composite([{ input: overlay }]).png().toFile(png('grass_side'))

  // Ten destroy stages stacked into the 16x160 strip crackOverlay.js expects,
  // flattened to black so it acts as a pure alpha mask.
  const frames = await Promise.all(Array.from({ length: 10 }, (_, i) =>
    sharp(t(`destroy_stage_${i}`)).resize(16, 16, { kernel: 'nearest' }).ensureAlpha().raw().toBuffer()))
  const strip = Buffer.alloc(16 * 160 * 4)
  frames.forEach((f, i) => {
    for (let p = 0; p < 16 * 16; p++) {
      const o = (i * 256 + p) * 4
      strip[o] = 0; strip[o + 1] = 0; strip[o + 2] = 0; strip[o + 3] = f[p * 4 + 3]
    }
  })
  await sharp(strip, { raw: { width: 16, height: 160, channels: 4 } }).png().toFile(png('crack'))

  await sharp(t('sun')).png().toFile(png('sun'))
  const moon = await sharp(t('moon_phases')).metadata()
  const cell = Math.floor(moon.width / 4)
  await sharp(t('moon_phases')).extract({ left: 0, top: 0, width: cell, height: cell })
    .png().toFile(png('moon'))

  // Clouds and the first-person hand have no vanilla equivalent we can use,
  // so they stay on the CC-licensed pack.
  for (const f of ['cloud.png', 'hand.png']) {
    copyFileSync(join(ROOT, 'textures-src', 'ce', f), join(OUT, f))
  }

  await uiFromVanilla(jar, tmp)

  rmSync(tmp, { recursive: true, force: true })
  console.log(`extracted vanilla textures from Minecraft ${picked}`)
  console.log('\n  These are Mojang assets. Fine on your own machine; do NOT')
  console.log('  commit them or deploy them publicly. public/textures/ is')
  console.log('  gitignored so this stays hard to do by accident.\n')
}

rmSync(OUT, { recursive: true, force: true })
rmSync(UI, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
if (source === 'vanilla') await fromVanilla()
else await fromCE()
await buildHeldAtlases()
console.log(`held atlases: ${readdirSync(join(OUT, 'held')).length}`)
