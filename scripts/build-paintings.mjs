#!/usr/bin/env node
/*
 * Builds public/paintings/ -- every painting's art, from two very different
 * sources, into one directory the game can fetch by name.
 *
 *   paintings-src/<file>   -> public/paintings/<name>.png          (Evan's)
 *   the local 1.21.x jar   -> public/paintings/vanilla/<name>.png  (Mojang's)
 *
 *
 * WHY THIS IS NOT PART OF scripts/build-textures.mjs, which is the obvious
 * place to put it and the wrong one, for three separate reasons:
 *
 *   1. LICENCE. build-textures.mjs writes public/textures/, which is
 *      gitignored wholesale because it may hold Mojang art. Custom painting
 *      art is Evan's and MUST be committed, or a clone of this repo builds a
 *      world with a hole in the wall where the photograph goes. Those two
 *      rules cannot both be applied to one directory.
 *   2. SOURCE INDEPENDENCE. build-textures.mjs emits from `vanilla` or `ce`
 *      and stamps a .source marker saying which. A custom painting is neither
 *      -- it is the same file in both builds -- so it has no business being
 *      under a marker that claims to describe it.
 *   3. IT REWRITES THE WHOLE TREE. `npm run textures` stages into
 *      public/.build and renames over public/textures, so anything this
 *      script wrote in there would silently vanish the next time somebody
 *      changed a block texture. public/paintings/ is ours alone and nothing
 *      else touches it.
 *
 *
 * THE FORMAT TRAP, which is the reason this file validates instead of just
 * converting. millardnorth4.jpg on Evan's Desktop is an AVIF file with a
 * .jpg extension -- a browser would refuse it, sharp would decode it anyway,
 * and either way the extension is a lie. Source images arrive from
 * screenshots, downloads and phone exports and their names mean nothing, so
 * every source is probed for its REAL format and a mismatch is reported.
 *
 * (sharp names that one HEIF rather than AVIF, because AVIF is a HEIF
 * container with an AV1 payload. The warning prints whatever sharp found, so
 * it stays honest without this script needing a format table of its own.)
 *
 * It is a warning and not an error, deliberately: sharp decodes AVIF, WebP,
 * PNG, JPEG, TIFF and GIF regardless of what the file is called, so a
 * mislabelled file still builds correctly. What must never happen is that it
 * builds INCORRECTLY in silence -- an unreadable source, a source whose
 * aspect ratio has been cropped past recognition, or a source that is missing
 * -- and all three of those exit non-zero with the filename in the message.
 *
 * Rejected: normalising every source to PNG in paintings-src/ and checking
 * those in. It doubles what is committed, it throws away the original, and
 * the 357 KB WebP is smaller than the PNG it would become.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

import { CUSTOM_PAINTINGS, CUSTOM_PX_PER_BLOCK, VANILLA_PX_PER_BLOCK, PAINTINGS }
  from '../src/paintings.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'paintings-src')
const OUT = join(ROOT, 'public', 'paintings')
const VANILLA_OUT = join(OUT, 'vanilla')

const onlyVanilla = process.argv.includes('--vanilla')
const onlyCustom = process.argv.includes('--custom')

/*
 * How far the crop may be from the frame's aspect ratio before it is a
 * mistake rather than a trim. 15% is wide enough to take a 1.568:1 photo into
 * a 1.5:1 frame (4.5% off) without complaint and narrow enough to catch the
 * failure that actually happens -- a landscape source typed into a portrait
 * row, which is 2.25x off and would throw away two thirds of the picture.
 */
const CROP_TOLERANCE = 0.15

/** Real format, from the file's own bytes rather than from its name. */
async function probe(file) {
  try {
    const meta = await sharp(file).metadata()
    if (!meta.width || !meta.height) throw new Error('no dimensions')
    return meta
  } catch (err) {
    throw new Error(`cannot decode ${file}: ${err.message}\n`
      + '  If this is a format sharp does not read, convert it first:\n'
      + `    sips -s format png "${file}" --out "${file.replace(/\.\w+$/, '.png')}"`)
  }
}

/**
 * One custom painting: crop to the frame's aspect ratio, scale to
 * CUSTOM_PX_PER_BLOCK, write a PNG.
 *
 * CENTRE CROP, not a squash and not a letterbox. A squash makes a building
 * lean, which is the one thing a photograph hung next to the building must
 * not do; a letterbox puts bars inside the frame, which reads as a bug. The
 * cost is that the ends of a too-wide source are lost, and the tolerance
 * check above is what stops that being lost silently.
 */
async function buildCustom(p) {
  const src = join(SRC, p.source)
  if (!existsSync(src)) {
    throw new Error(`painting "${p.name}" names paintings-src/${p.source}, which does not exist`)
  }
  const meta = await probe(src)

  const declared = extname(p.source).slice(1).toLowerCase()
  const actual = meta.format.toLowerCase()
  const aliases = { jpg: 'jpeg', tif: 'tiff' }
  if ((aliases[declared] ?? declared) !== actual) {
    console.warn(`  ! ${p.source} is actually ${actual.toUpperCase()}, not ${declared.toUpperCase()}.`
      + ' Decoded anyway; rename it so the next reader is not misled.')
  }

  const want = p.w / p.h
  const have = meta.width / meta.height
  const off = Math.abs(have - want) / want
  if (off > CROP_TOLERANCE) {
    throw new Error(
      `painting "${p.name}" is ${p.w}x${p.h} (${want.toFixed(3)}:1) but ${p.source} is `
      + `${meta.width}x${meta.height} (${have.toFixed(3)}:1), ${(off * 100).toFixed(0)}% off.\n`
      + '  Cropping to the frame would throw away most of the picture. Either change\n'
      + '  w/h in src/paintings.js to match the image, or crop the source first.')
  }

  const w = p.w * CUSTOM_PX_PER_BLOCK
  const h = p.h * CUSTOM_PX_PER_BLOCK
  mkdirSync(OUT, { recursive: true })
  const file = join(OUT, `${p.name}.png`)
  await sharp(src)
    // `cover` + `centre` IS the centre crop: fill the box, trim the overflow
    // evenly off both ends. `lanczos3` because the downscale here is 5:1 and
    // a box filter turns brickwork into moire at that ratio.
    .resize(w, h, { fit: 'cover', position: 'centre', kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toFile(file)

  const kb = Math.round((w * h * 4) / 1024)
  const cropped = Math.round(Math.abs(meta.width - meta.height * want) / 2)
  console.log(`  ${p.name}: ${meta.width}x${meta.height} ${actual} -> ${w}x${h}`
    + ` (${p.w}x${p.h} blocks @ ${CUSTOM_PX_PER_BLOCK}px, ${kb} KB on the GPU`
    + `${cropped ? `, ${cropped}px trimmed off each side` : ''})`)
  return { name: p.name, bytes: w * h * 4 }
}

/** The newest fully-installed release, same rule build-textures.mjs uses. */
function findJar() {
  const versions = join(homedir(), 'Library', 'Application Support', 'minecraft', 'versions')
  if (!existsSync(versions)) return null
  const picked = readdirSync(versions)
    .filter(v => /^\d+\.\d+(\.\d+)?$/.test(v) && existsSync(join(versions, v, `${v}.jar`)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .pop()
  return picked ? join(versions, picked, `${picked}.jar`) : null
}

/*
 * Mojang's 51 variants plus back.png, straight out of the jar at their native
 * 16 px/block.
 *
 * NOT AN ERROR WHEN THERE IS NO JAR. This is the CE case and the CI case and
 * the fresh-clone case, and in all three the right answer is a world with
 * working custom paintings and no vanilla art -- not a build that refuses to
 * run. src/paintingArt.js draws a placeholder for art it cannot fetch, so the
 * failure is visible in the world rather than fatal in the terminal.
 */
function buildVanilla() {
  const jar = findJar()
  if (!jar) {
    console.log('  no Minecraft install found -- skipping vanilla painting art.')
    console.log('  Custom paintings still build; vanilla ones draw a placeholder.')
    return 0
  }
  rmSync(VANILLA_OUT, { recursive: true, force: true })
  mkdirSync(VANILLA_OUT, { recursive: true })
  execFileSync('unzip', ['-q', '-o', '-j', jar,
    'assets/minecraft/textures/painting/*', '-d', VANILLA_OUT])

  /*
   * The jar is the authority on sizes and this is where a disagreement gets
   * caught. src/paintings.js's table was READ OFF these files; if a future
   * version resizes a variant or adds one, the table is now wrong and the
   * painting would be stretched. Cheaper to say so here than to notice it on
   * a wall.
   */
  let n = 0
  for (const f of readdirSync(VANILLA_OUT)) {
    if (!f.endsWith('.png')) { rmSync(join(VANILLA_OUT, f)); continue }
    n++
    const name = f.slice(0, -4)
    if (name === 'back') continue
    const v = PAINTINGS.get(name)
    if (!v) { console.warn(`  ! ${name} is in the jar and not in src/paintings.js`); continue }
    const { width, height } = sizeOf(join(VANILLA_OUT, f))
    if (width !== v.w * VANILLA_PX_PER_BLOCK || height !== v.h * VANILLA_PX_PER_BLOCK) {
      console.warn(`  ! ${name} is ${width}x${height} in the jar but ${v.w}x${v.h} blocks`
        + ` in src/paintings.js -- one of them is wrong`)
    }
  }
  for (const v of PAINTINGS.values()) {
    if (!v.custom && !existsSync(join(VANILLA_OUT, `${v.name}.png`))) {
      console.warn(`  ! src/paintings.js lists "${v.name}", which is not in this jar`)
    }
  }
  console.log(`  ${n} vanilla painting textures from ${jar.split('/').pop()}`)
  return n
}

/**
 * PNG width/height out of the IHDR.
 *
 * Read by hand rather than with sharp because this check runs 52 times and
 * sharp's metadata() is async -- the whole vanilla path is synchronous unzip
 * plus this, and making it async to read two integers that live at a fixed
 * byte offset is not a trade worth making. A PNG's IHDR is always the first
 * chunk: 8 bytes of signature, 8 of chunk header, then width and height.
 */
function sizeOf(file) {
  const buf = readFileSync(file)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

const run = async () => {
  console.log('paintings:')
  if (!onlyVanilla) {
    let total = 0
    for (const p of CUSTOM_PAINTINGS) total += (await buildCustom(p)).bytes
    console.log(`  ${CUSTOM_PAINTINGS.length} custom painting(s),`
      + ` ${(total / 1024 / 1024).toFixed(2)} MB of GPU texture between them`)
  }
  if (!onlyCustom) buildVanilla()
  // A marker for nobody to read, unlike textures/.source -- this one is here
  // so `ls public/paintings` explains itself six months from now.
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'README.txt'),
    'Generated by `npm run paintings`. See docs/paintings.md.\n'
    + '<name>.png is Evan\'s own art and IS committed.\n'
    + 'vanilla/ is extracted from a local Minecraft install and is NOT committed.\n')
}

run().catch(err => {
  console.error(`\npaintings build failed:\n  ${err.message}\n`)
  process.exit(1)
})
