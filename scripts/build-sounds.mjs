#!/usr/bin/env node
/*
 * Builds public/sounds/ from your own Minecraft install.
 *
 *   npm run sounds
 *
 * Same deal as build-textures.mjs, and for the same reason: Mojang's audio is
 * no more redistributable than their textures. Extracting it from a copy of
 * Minecraft you own, onto your own machine, is fine; committing it to a public
 * repo or serving it from a public site is redistribution. public/sounds/ is
 * gitignored so the wrong thing is hard to do by accident.
 *
 * WHERE THE SOUNDS ACTUALLY LIVE. Not in the version jar -- textures are, audio
 * isn't. The launcher downloads every sound into
 *
 *   assets/objects/<first two hex chars of hash>/<full hash>
 *
 * with no extension and no hint of what it is, and
 * assets/indexes/<n>.json maps logical paths like
 * `minecraft/sounds/step/grass1.ogg` onto `{ hash, size }`. So the job is:
 * read the index, look up the paths we want, copy the hashed blobs out under
 * their real names.
 *
 * The index still uses Minecraft's ORIGINAL flat layout (`step/grass1.ogg`,
 * `dig/stone3.ogg`) rather than the modern `block/grass/step1.ogg` naming used
 * in sounds.json. Both exist in the asset tree; the flat one is what's
 * actually present for every group we need, so that's what gets read.
 */
import {
  mkdirSync, rmSync, readdirSync, copyFileSync, existsSync, readFileSync,
  writeFileSync, renameSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = join(ROOT, 'public')
const ASSETS = join(homedir(), 'Library', 'Application Support', 'minecraft', 'assets')

/*
 * Staged then swapped in, exactly like the texture build. Writing in place
 * means a running dev server 404s every sound for however long the copy takes;
 * a directory rename shrinks that window to nothing.
 */
const STAGE = join(PUBLIC, '.build-sounds')
const OUT = join(STAGE, 'sounds')
const LIVE = join(PUBLIC, 'sounds')

const ensureOnly = process.argv.includes('--ensure')

/*
 * Minecraft's sound groups, and how many numbered variants each has.
 *
 * These are the six SoundType families the block palette can reach. Counts are
 * NOT uniform -- grass/stone/wood have six step samples, gravel and snow four,
 * sand five -- and every group has exactly four dig samples. Guessing a fixed
 * count here silently 404s the tail of the shorter groups, so they're written
 * out and then verified against the index below.
 *
 * `dig` covers both breaking and placing: Minecraft plays the same samples for
 * both, at a different pitch. `step` covers footsteps, the mining hit tick and
 * the landing thud, again the same samples at different pitch and volume --
 * that reuse is Minecraft's design, not a shortcut taken here.
 */
const GROUPS = ['grass', 'stone', 'wood', 'gravel', 'sand', 'snow']
const KINDS = { step: 8, dig: 8 } // upper bounds; the real count is discovered

function loadIndex() {
  const indexes = join(ASSETS, 'indexes')
  if (!existsSync(indexes)) throw new Error(`no Minecraft assets found at ${ASSETS}`)

  /*
   * The index to read is whichever one the newest RELEASE points at, not the
   * highest-numbered file on disk. Snapshots ship their own index and sort
   * above releases, so picking by filename would quietly build from a snapshot
   * you launched once months ago.
   */
  const versions = join(homedir(), 'Library', 'Application Support', 'minecraft', 'versions')
  let picked = null, version = null
  if (existsSync(versions)) {
    const release = readdirSync(versions)
      .filter(v => /^\d+\.\d+(\.\d+)?$/.test(v) && existsSync(join(versions, v, `${v}.json`)))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop()
    if (release) {
      const meta = JSON.parse(readFileSync(join(versions, release, `${release}.json`), 'utf8'))
      if (meta.assetIndex?.id && existsSync(join(indexes, `${meta.assetIndex.id}.json`))) {
        picked = `${meta.assetIndex.id}.json`
        version = release
      }
    }
  }
  if (!picked) {
    picked = readdirSync(indexes).filter(f => f.endsWith('.json'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop()
    if (!picked) throw new Error(`no asset index in ${indexes}`)
  }

  const objects = JSON.parse(readFileSync(join(indexes, picked), 'utf8')).objects
  return { objects, label: version ? `Minecraft ${version}` : `asset index ${picked}`, index: picked }
}

const { objects, label, index } = loadIndex()

/*
 * --ensure is the no-op path, for anything that wants sounds present without
 * clobbering a build that's already there.
 */
if (ensureOnly && existsSync(join(LIVE, 'manifest.json'))) {
  console.log('sounds already built -- leaving them alone')
  process.exit(0)
}

rmSync(STAGE, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const manifest = { source: label, index, groups: {} }
const missing = []
let files = 0, bytes = 0

for (const kind of Object.keys(KINDS)) {
  mkdirSync(join(OUT, kind), { recursive: true })
  for (const group of GROUPS) {
    let n = 0
    for (let i = 1; i <= KINDS[kind]; i++) {
      const logical = `minecraft/sounds/${kind}/${group}${i}.ogg`
      const entry = objects[logical]
      // The numbering is contiguous, so the first gap IS the end of the group.
      // Continuing past it would let a hole in the middle go unnoticed.
      if (!entry) break

      const blob = join(ASSETS, 'objects', entry.hash.slice(0, 2), entry.hash)
      if (!existsSync(blob)) {
        // Indexed but never downloaded -- the launcher fetches assets lazily,
        // so an index entry is not a promise that the file is on disk.
        missing.push(logical)
        break
      }
      copyFileSync(blob, join(OUT, kind, `${group}${i}.ogg`))
      n++; files++; bytes += entry.size
    }
    if (n === 0) missing.push(`${kind}/${group}*`)
    ;(manifest.groups[group] ??= {})[kind] = n
  }
}

if (files === 0) throw new Error('extracted nothing -- is this a fresh Minecraft install that has never launched?')

/*
 * The manifest is what the client reads. sounds.js needs the per-group variant
 * counts to pick a random sample, and hardcoding them there would mean two
 * places to edit and a class of silent 404s whenever they disagree. Its
 * presence also doubles as the "were sounds ever built?" check -- a missing
 * manifest is how sounds.js decides to stay quiet instead of throwing.
 */
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))
writeFileSync(join(OUT, '.source'), 'vanilla')
writeFileSync(join(OUT, 'NOTICE.txt'),
  `Extracted from a local Minecraft install (${label}, asset index ${index})\n` +
  `by scripts/build-sounds.mjs.\n\n` +
  `These are Mojang assets. Fine on your own machine; NOT redistributable.\n` +
  `public/sounds/ is gitignored so they stay local-only.\n`)

// Swap the staged build in.
const old = `${LIVE}.old`
rmSync(old, { recursive: true, force: true })
if (existsSync(LIVE)) renameSync(LIVE, old)
renameSync(OUT, LIVE)
rmSync(old, { recursive: true, force: true })
rmSync(STAGE, { recursive: true, force: true })

console.log(`extracted ${files} sounds (${(bytes / 1024).toFixed(0)} KB) from ${label}`)
for (const [group, kinds] of Object.entries(manifest.groups)) {
  console.log(`  ${group.padEnd(7)} step x${kinds.step}  dig x${kinds.dig}`)
}
if (missing.length) console.log(`  not in the asset index: ${missing.join(', ')}`)
console.log('\n  These are Mojang assets. Fine on your own machine; do NOT')
console.log('  commit them or deploy them publicly. public/sounds/ is')
console.log('  gitignored so this stays hard to do by accident.\n')
