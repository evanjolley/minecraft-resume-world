#!/usr/bin/env node
/*
 * Builds public/sounds/ from a chosen source.
 *
 *   npm run sounds            -> rebuild whatever is already installed
 *   npm run sounds:free       -> the committed free set (sounds-src/free)
 *   npm run sounds:vanilla    -> your own Minecraft install
 *
 * The plain `sounds` script names no source on purpose -- see the same note in
 * build-textures.mjs. "Build this again" and "switch back to the committed
 * set" are different requests and used to be the same command.
 *
 * Same two-source shape as build-textures.mjs, and for the same reason.
 * Mojang's audio is no more redistributable than their textures: extracting it
 * from a copy of Minecraft you own, onto your own machine, is fine; committing
 * it to a public repo or serving it from a public site is redistribution.
 * public/sounds/ is gitignored so the wrong thing is hard to do by accident.
 *
 * The difference from the texture build is which half is the better one. CE is
 * a genuine alternative to vanilla's art; the free sound set is NOT a
 * genuine alternative to vanilla's audio -- it is other people's field
 * recordings of gravel and wood, and it sounds like a different game. It is
 * here because the deployed site was silent, and a world where walking makes
 * a noise beats a world where nothing does. `sounds:vanilla` stays the
 * higher-fidelity local build, exactly as `textures:vanilla` is.
 *
 * BOTH SOURCES EMIT THE SAME NAMES. `step/grass1`, `dig/stone3`,
 * `damage/hit1`, `damage/fallbig`, `random/click_stereo` -- vanilla's original
 * flat asset layout, even for files that have never been near a Minecraft
 * install. That is deliberate: src/sounds.js and test/12-sounds.spec.js both
 * name samples by that path, neither is this script's to edit, and a
 * `free/`-prefixed parallel naming would have meant teaching them which source
 * built the manifest. The manifest is the contract; the source is an
 * implementation detail behind it.
 *
 * WHERE THE VANILLA SOUNDS ACTUALLY LIVE. Not in the version jar -- textures
 * are, audio isn't. The launcher downloads every sound into
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
 *
 * Two tables come out of either source, not one. GROUPS x KINDS is the block
 * grid -- every SoundType family crossed with step and dig. SETS is everything
 * that has no block behind it: the player's own hurt, death and fall sounds,
 * and the GUI click. They're separate because the block grid is a cross
 * product with discovered variant counts and SETS is an explicit list of
 * paths, and folding either into the other's shape costs more than a second
 * loop.
 */
import {
  mkdirSync, rmSync, readdirSync, copyFileSync, existsSync, readFileSync,
  writeFileSync, renameSync, statSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
// The block -> SoundType mapping, imported rather than restated: there is one
// table, and this script is the thing that can prove it covers the palette.
import { SOUND_GROUPS, unmappedBlocks } from '../src/sounds.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = join(ROOT, 'public')
const FREE_SRC = join(ROOT, 'sounds-src', 'free')
const ASSETS = join(homedir(), 'Library', 'Application Support', 'minecraft', 'assets')

/*
 * Staged then swapped in, exactly like the texture build. Writing in place
 * means a running dev server 404s every sound for however long the copy takes;
 * a directory rename shrinks that window to nothing.
 */
const STAGE = join(PUBLIC, '.build-sounds')
const OUT = join(STAGE, 'sounds')
const LIVE = join(PUBLIC, 'sounds')

// Records which source produced the current build, so `npm install` can
// rebuild the SAME one instead of silently reverting a vanilla build to free.
const MARKER = join(LIVE, '.source')

const arg = (name, fallback) => {
  const found = process.argv.find(a => a.startsWith(`--${name}=`))
  return found ? found.split('=')[1] : fallback
}

const ensureOnly = process.argv.includes('--ensure')
let source = arg('source', null)
if (!source) source = existsSync(MARKER) ? readFileSync(MARKER, 'utf8').trim() : 'free'
if (source !== 'free' && source !== 'vanilla') {
  throw new Error(`unknown sound source "${source}" -- expected free or vanilla`)
}

/*
 * Minecraft's sound groups.
 *
 * These are the six SoundType families the block palette can reach. Only four
 * of them are reachable TODAY -- src/sounds.js maps grass, dirt/gravel and
 * planks and falls everything else through to stone -- but sand and snow are
 * built anyway, because the alternative is discovering they're missing on the
 * day someone adds a sand block.
 *
 * `dig` covers both breaking and placing: Minecraft plays the same samples for
 * both, at a different pitch. `step` covers footsteps, the mining hit tick and
 * the landing thud, again the same samples at different pitch and volume --
 * that reuse is Minecraft's design, not a shortcut taken here.
 */
const GROUPS = ['grass', 'stone', 'wood', 'gravel', 'sand', 'snow']
const KINDS = ['step', 'dig']

/*
 * The families only a vanilla install can supply, added when the world stopped
 * being a hand-built island of six block types and became a 128x128 patch of
 * real Minecraft terrain. Every one of these is in that patch: walking on
 * deepslate, tuff, moss or sculk played stone before this table existed.
 *
 * Two shapes, because Minecraft has two asset layouts and never finished
 * migrating. The six above live in the ORIGINAL flat tree (`step/grass1.ogg`),
 * and so does wool, under its pre-1.13 name `cloth`. Everything added since
 * 1.16 lives under `block/<family>/step1.ogg` with breaks called `break`
 * rather than `dig`. `flat`/`dir` is which of the two a family uses; the
 * emitted name is the same either way, so the manifest contract is unchanged.
 *
 * NOT the whole SoundType list. src/sounds.js maps every block to its real
 * family -- about forty of them -- and the ones absent here resolve through
 * that table's `from` chain to the nearest family that IS built. Extracting
 * all forty would roughly quadruple the sample count, and test/helpers/audio.js
 * decodes and fingerprints every sample in the manifest once per run. These
 * are the families the terrain actually walks on, plus wool, which is sixteen
 * blocks in the inventory and is one flat copy away.
 *
 * Rejected: reading the file lists out of `minecraft/sounds.json` (it is in
 * the asset index, and it is where sounds.js's volume numbers are cited from)
 * instead of naming directories here. It would be more faithful -- it knows
 * that block.ancient_debris.step IS block/basalt/step* -- and it would make
 * the build depend on parsing a second format for a handful of paths that
 * have not moved since 1.16.
 */
const VANILLA_ONLY = {
  cloth: { flat: 'cloth' },      // SoundType.WOOL. Renamed in-game, not on disk.
  deepslate: { dir: 'deepslate' },
  tuff: { dir: 'tuff' },
  moss: { dir: 'moss' },
  sculk: { dir: 'sculk' },
  calcite: { dir: 'calcite' },
  amethyst: { dir: 'amethyst' },
  basalt: { dir: 'basalt' },
}

/*
 * The sounds with no block behind them: sample set -> the asset paths vanilla's
 * own sounds.json draws that set from, verbatim.
 *
 * Still the original flat layout. `entity/player/hurt/*` DOES exist in the
 * index and is the tempting-looking modern name, but it only holds the
 * drowning, freezing, fire and berry-bush variants -- the plain hurt every
 * damage type in this world uses is `damage/hit1-3`, one directory over.
 *
 * hurt and death share `damage/hit1-3`. That reads like a copy-paste slip and
 * isn't: entity.player.hurt and entity.player.death list the same three
 * samples in sounds.json, and are distinguished by WHEN they play rather than
 * by what they play. Giving death its own sample would be inventing one.
 *
 * fallbig/fallsmall are one sample each and unnumbered, which is the other
 * reason these can't ride on the group grid -- that loop counts upward from 1
 * until it misses.
 */
const SETS = {
  hurt: ['damage/hit1', 'damage/hit2', 'damage/hit3'],
  fallBig: ['damage/fallbig'],
  fallSmall: ['damage/fallsmall'],
  uiClick: ['random/click_stereo'],

  /*
   * Picking an item up off the floor, added when drops landed. Vanilla's
   * entity.item.pickup is `random/pop`, played at DOUBLE pitch -- that squeak
   * is the whole character of the sound, and sounds.js's MIX does the
   * doubling. Until this existed sounds.js fell back to the UI click pitched
   * into the same register; the fallback is still there and still correct for
   * a manifest built before today.
   */
  pickup: ['random/pop'],

  /* ------------------------------------------------------------------ *
   * Potions. Three events, read out of sounds.json in asset index 26
   * (1.21.8) on this machine rather than from memory:
   *
   *   entity.generic.drink        -> random/drink
   *   entity.splash_potion.throw  -> random/bow
   *   entity.splash_potion.break  -> random/glass1, glass2, glass3
   *
   * THE THROW REALLY IS THE BOW. entity.splash_potion.throw, .egg.throw,
   * .snowball.throw, .ender_pearl.throw and .wind_charge.throw all name
   * `random/bow` and are separated only by the pitch the caller passes --
   * 0.4 / (rand * 0.4 + 0.8), which drops it a fifth. A file called
   * `throw.ogg` does not exist to be extracted, and looking for one is the
   * half hour this note saves.
   *
   * LINGERING SHARES BOTH. entity.lingering_potion.throw is another
   * random/bow, and there is no entity.lingering_potion.break at all --
   * ThrownPotion fires level event 2002 or 2007 either way, and 2007's only
   * difference is the particle. Two rows, not four.
   * ------------------------------------------------------------------ */
  drink: ['random/drink'],
  potionThrow: ['random/bow'],
  shatter: ['random/glass1', 'random/glass2', 'random/glass3'],

  /* ------------------------------------------------------------------ *
   * Water.
   *
   * Every one of these is in the flat `liquid/*` and `ambient/underwater/*`
   * layout, which is the same shape the four sets above already use -- so
   * this is rows, not a new extraction path. Verified present in asset index
   * 26 (1.21.8) on this machine.
   *
   * Vanilla's event names, for anyone tracing these back to sounds.json:
   *   splash        entity.generic.splash          (and entity.player.splash)
   *   splashHigh    entity.player.splash.high_speed
   *   swim          entity.generic.swim
   *   waterAmbient  block.water.ambient
   *   underwater*   ambient.underwater.loop / .enter / .exit
   *   lava*         block.lava.ambient / block.lava.pop
   *
   * EIGHTEEN SWIM SAMPLES is vanilla's own count, not enthusiasm. Swimming
   * fires one roughly every six ticks for as long as you hold a direction, so
   * it is the most repeated sound in the game after footsteps, and six
   * variants would read as a loop within one length of a pond.
   *
   * NOT EXTRACTED -- ambient.underwater.loop.additions, twenty-one files of
   * whale song, bubbles, crackles and distant dark. They are the good half of
   * being underwater in vanilla and they are also twenty-one more files to
   * cover a state this world's ocean can hold you in for about fifteen
   * seconds before you drown. Left on the table deliberately; the loop bed is
   * the part you actually hear.
   * ------------------------------------------------------------------ */
  splash: ['liquid/splash', 'liquid/splash2'],
  splashHigh: ['liquid/heavy_splash'],
  swim: Array.from({ length: 18 }, (_, i) => `liquid/swim${i + 1}`),
  waterAmbient: ['liquid/water'],
  underwaterLoop: ['ambient/underwater/underwater_ambience'],
  underwaterEnter: ['ambient/underwater/enter1', 'ambient/underwater/enter2',
    'ambient/underwater/enter3'],
  underwaterExit: ['ambient/underwater/exit1', 'ambient/underwater/exit2',
    'ambient/underwater/exit3'],
  lavaAmbient: ['liquid/lava'],
  lavaPop: ['liquid/lavapop'],
  // entity.player.breath -- the bubble popping off the air meter. The one
  // water sound that is a HUD sound rather than a world sound, which is why
  // it lives under ui/ and plays flat.
  breath: ['ui/hud/hud_bubble'],
}

/* ------------------------------------------------------------------ *
 * The free set.
 *
 * Every file under sounds-src/free/ is redistributable and attributed by name
 * in sounds-src/free/NOTICE.txt. Read that file before adding to these tables:
 * a sample with no traceable author is the one thing that cannot go in here,
 * whatever it sounds like.
 *
 * The bulk is VoxeLibre's mcl_sounds, chosen over Minetest Game's `default`
 * for paperwork rather than for sound -- the two share most of their audio,
 * and only VoxeLibre maps every individual file to an author, a licence and a
 * source URL. A NOTICE that said "one of these seven people made one of these
 * files" is not attribution.
 *
 * The mapping is hand-written rather than derived from filenames because the
 * two projects cut their audio along different lines. Minetest separates
 * `dig` (the loop while you swing) from `dug` (the block breaking); this world
 * has no dig loop, so `dig/*` is fed from the `dug` and `place` samples, which
 * are the ones that fire at the same moment ours do.
 * ------------------------------------------------------------------ */
const FREE = {
  step: {
    grass: ['voxelibre/default_grass_footstep.1', 'voxelibre/default_grass_footstep.2',
      'voxelibre/default_grass_footstep.3'],
    stone: ['voxelibre/default_hard_footstep.1', 'voxelibre/default_hard_footstep.2',
      'voxelibre/default_hard_footstep.3'],
    wood: ['voxelibre/default_wood_footstep.1', 'voxelibre/default_wood_footstep.2'],
    gravel: ['voxelibre/default_gravel_footstep.1', 'voxelibre/default_gravel_footstep.2',
      'voxelibre/default_gravel_footstep.3', 'voxelibre/default_gravel_footstep.4'],
    sand: ['voxelibre/default_sand_footstep.1', 'voxelibre/default_sand_footstep.2',
      'voxelibre/default_sand_footstep.3'],
    /*
     * SNOW COMES FROM ELSEWHERE. VoxeLibre does have snow footsteps, and its
     * README credits them to "Unknown authors" -- which is the one provenance
     * this repo refuses, whatever the licence next to it says. qubodup's dry
     * snow steps are CC0 by a named person, and there are exactly four of
     * them, which is the count vanilla's snow group has.
     *
     * Rejected: VoxeLibre's cloth samples, which are attributed and would have
     * passed. They are a muffled rustle rather than a crunch, and substituting
     * a different material when a correctly-licensed recording of the RIGHT
     * material exists is a worse trade than the texture build's colour-shifted
     * blocks, where no alternative existed at all.
     */
    snow: ['opengameart/qubodup_snow_step_dry1', 'opengameart/qubodup_snow_step_dry2',
      'opengameart/qubodup_snow_step_dry3', 'opengameart/qubodup_snow_step_dry4'],
  },
  dig: {
    grass: ['voxelibre/default_dug_node.1', 'voxelibre/default_dug_node.2',
      'voxelibre/default_dig_crumbly'],
    stone: ['voxelibre/default_dig_cracky.1', 'voxelibre/default_dig_cracky.2',
      'voxelibre/default_dig_cracky.3'],
    wood: ['voxelibre/default_dig_choppy.1', 'voxelibre/default_dig_choppy.2',
      'voxelibre/default_dig_choppy.3'],
    gravel: ['voxelibre/default_gravel_dug.1', 'voxelibre/default_gravel_dug.2',
      'voxelibre/default_gravel_dug.3'],
    // Sand has no dug sample in either upstream. Gravel's digging sound is the
    // nearest crunch, and MIX drops break/place 20% in pitch, so it does not
    // read as gravel played twice.
    sand: ['voxelibre/default_gravel_dig.1', 'voxelibre/default_gravel_dig.2'],
    /*
     * SNOW'S dig IS ITS step, byte for byte, and that is not a shortcut -- it
     * is what vanilla does. Minecraft ships one snow recording under two
     * names, which is why test/12-sounds.spec.js asserts exactly four
     * step/dig fingerprint collisions and no others. Emitting the same four
     * files twice reproduces that property instead of breaking it.
     */
    snow: ['opengameart/qubodup_snow_step_dry1', 'opengameart/qubodup_snow_step_dry2',
      'opengameart/qubodup_snow_step_dry3', 'opengameart/qubodup_snow_step_dry4'],
  },
  /*
   * The player's own sounds, plus the two interface ones. Keyed by the vanilla
   * path so the manifest reads identically whichever source built it.
   *
   * ONE GAP, stated rather than papered over: hurt has ONE sample where
   * vanilla has three. sounds.js's `vary` gives it a triangular pitch spread
   * per play, which is what stops repeated damage reading as a metronome, so
   * one sample is survivable where one FLAT sample would not be.
   *
   * Rejected: qubodup's CC0 pain grunts, which would have made three. They
   * are a different person's voice from VoxeLibre's hurt sample, and three
   * samples that are obviously two different people getting hurt is worse
   * than one sample repeated. Replacing all three would mean throwing away
   * the one hurt sound a Minecraft clone has already judged fit for the job.
   */
  /*
   * THE POTION SOUNDS HAVE NO FREE EQUIVALENT, and this is the note rather
   * than a substitution.
   *
   * sounds-src/free is 31 files: VoxeLibre's footsteps and digging, one hurt,
   * one fall, and three Kenney/qubodup interface and snow samples. There is
   * no gulp in it, no glass, and no bowstring. So `npm run build:deploy`
   * ships a game where drinking a potion and shattering one on a wall are
   * SILENT, and the local vanilla build is the only one that has them.
   *
   * That is stated here rather than papered over, because the three ways to
   * paper over it are all worse. Re-pitching the UI click into a "gulp" is a
   * fabricated sound with no author to put in NOTICE.txt. Playing the gravel
   * dig as breaking glass is a different material, which is the substitution
   * this table's snow note already refuses when a correct recording exists.
   * And adding a `fallback` in sounds.js's MIX would make the gap invisible
   * -- the deployed site would make SOME noise and nobody would ever look.
   *
   * play() on a set the manifest does not carry is already a silent no-op, so
   * nothing breaks; it is just quiet. Filling it properly means finding three
   * CC0 recordings with named authors and adding them to NOTICE.txt, which is
   * sourcing work rather than code and is not this change.
   */
  sets: {
    'damage/hit1': 'voxelibre/player_damage',
    'damage/fallbig': 'voxelibre/player_falling_damage',
    // Deliberately NOT a second copy of fallbig: two sets playing identical
    // bytes read as one sound fired twice, and would add a fifth fingerprint
    // collision to a suite that asserts there are exactly four.
    'damage/fallsmall': 'opengameart/macro_jump_landing',
    'random/click_stereo': 'opengameart/kenney_ui_click',
    'random/pop': 'opengameart/kenney_ui_pickup',
  },
}

/* ------------------------------------------------------------------ */

const manifest = { source: null, groups: {}, sets: {} }
const missing = []
let files = 0, bytes = 0

/** Copy one source file to a logical name under OUT, and count it. */
function emit(logical, src) {
  mkdirSync(join(OUT, dirname(logical)), { recursive: true })
  copyFileSync(src, join(OUT, `${logical}.ogg`))
  files++
  bytes += statSync(src).size
}

/*
 * --ensure is what postinstall runs. If a usable build is already present it
 * does nothing at all, so installing a dependency never disturbs the sounds a
 * developer deliberately chose.
 *
 * "Usable" is checked against the manifest's own claims rather than against a
 * file count: the manifest is a promise that those samples are fetchable, and
 * a build left half-swapped by a killed process would satisfy any cheaper
 * test while 404ing at runtime.
 */
function looksComplete() {
  const path = join(LIVE, 'manifest.json')
  if (!existsSync(path) || !existsSync(MARKER)) return false
  let m
  try { m = JSON.parse(readFileSync(path, 'utf8')) } catch { return false }
  for (const [group, kinds] of Object.entries(m.groups ?? {})) {
    for (const [kind, count] of Object.entries(kinds)) {
      for (let i = 1; i <= count; i++) {
        if (!existsSync(join(LIVE, kind, `${group}${i}.ogg`))) return false
      }
    }
  }
  for (const paths of Object.values(m.sets ?? {})) {
    for (const p of paths) if (!existsSync(join(LIVE, `${p}.ogg`))) return false
  }
  return true
}

if (ensureOnly && looksComplete()) {
  console.log(`sounds already built from "${source}" -- leaving them alone`)
  process.exit(0)
}

function fromFree() {
  if (!existsSync(FREE_SRC)) throw new Error(`no free sound set at ${FREE_SRC}`)
  // Names carry their own upstream directory, so which project a sample came
  // from is readable at the table rather than only in NOTICE.txt.
  const file = (name) => join(FREE_SRC, `${name}.ogg`)

  for (const kind of KINDS) {
    for (const group of GROUPS) {
      const names = FREE[kind][group] ?? []
      let n = 0
      for (const name of names) {
        const src = file(name)
        if (!existsSync(src)) { missing.push(`${kind}/${group}: ${name}.ogg`); continue }
        // Numbered from 1 by POSITION, not by the upstream filename's own
        // number -- sounds.js picks a variant by counting, so a hole here
        // would 404 the tail of the group.
        emit(`${kind}/${group}${++n}`, src)
      }
      if (n === 0) missing.push(`${kind}/${group}*`)
      else (manifest.groups[group] ??= {})[kind] = n
    }
  }

  for (const [set, paths] of Object.entries(SETS)) {
    const kept = []
    for (const path of paths) {
      const name = FREE.sets[path]
      // Not every vanilla path has a free equivalent, and hurt2/hurt3 are the
      // live example. Absent is a gap to report, not an error: an unlisted
      // sample is simply one fewer variant to pick from.
      if (!name) { missing.push(path); continue }
      const src = file(name)
      if (!existsSync(src)) { missing.push(`${path}: ${name}.ogg`); continue }
      emit(path, src)
      kept.push(path)
    }
    if (kept.length) manifest.sets[set] = kept
  }

  manifest.source = 'free set (sounds-src/free -- see NOTICE.txt)'
  copyFileSync(join(FREE_SRC, 'NOTICE.txt'), join(OUT, 'NOTICE.txt'))
  console.log('built from the committed free set')
}

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

function fromVanilla() {
  const { objects, label, index } = loadIndex()

  // Upper bound on the per-group variant count. Counts are NOT uniform --
  // grass/stone/wood have six step samples, gravel and snow four, sand five --
  // so the real number is discovered by counting upward until a miss.
  const MAX_VARIANTS = 8

  // The hashed blob behind a logical asset path, or null. An index entry is
  // not a promise the file is on disk: the launcher fetches assets lazily.
  const blobFor = (logical) => {
    const entry = objects[logical]
    if (!entry) return null
    const blob = join(ASSETS, 'objects', entry.hash.slice(0, 2), entry.hash)
    return existsSync(blob) ? blob : null
  }

  /*
   * `source(kind, i)` is the only thing that differs between a flat family and
   * a modern one, so the counting loop is written once. It still counts upward
   * until a miss rather than trusting a number: the counts are not uniform
   * (grass has six steps, gravel four, sand five, amethyst fourteen) and an
   * index entry is not a promise the launcher has fetched the file.
   */
  const families = [
    ...GROUPS.map(g => [g, (kind, i) => `${kind}/${g}${i}`]),
    ...Object.entries(VANILLA_ONLY).map(([g, where]) => [g, where.flat
      ? (kind, i) => `${kind}/${where.flat}${i}`
      // `dig` is this project's name for the set; on disk the modern layout
      // calls the same recordings `break`.
      : (kind, i) => `block/${where.dir}/${kind === 'dig' ? 'break' : 'step'}${i}`]),
  ]

  for (const kind of KINDS) {
    for (const [group, source] of families) {
      let n = 0
      for (let i = 1; i <= MAX_VARIANTS; i++) {
        const blob = blobFor(`minecraft/sounds/${source(kind, i)}.ogg`)
        // The numbering is contiguous, so the first gap IS the end of the
        // group. Continuing past it would let a hole in the middle go
        // unnoticed.
        if (!blob) break
        emit(`${kind}/${group}${i}`, blob)
        n++
      }
      if (n === 0) missing.push(`${kind}/${group}*`)
      else (manifest.groups[group] ??= {})[kind] = n
    }
  }

  /*
   * Unlike the group loop, a missing entry here does NOT stop the set. That
   * loop breaks on the first gap because the numbering is contiguous and a gap
   * IS the end; these are an enumeration, so a hole is just a hole and the
   * samples after it are still worth having.
   */
  for (const [set, paths] of Object.entries(SETS)) {
    const kept = []
    for (const path of paths) {
      const blob = blobFor(`minecraft/sounds/${path}.ogg`)
      if (!blob) { missing.push(path); continue }
      // Copied out under their real vanilla paths, so public/sounds mirrors
      // the asset tree and the manifest can name a sample with the same
      // string the client fetches. A flattened name would need a second
      // mapping to undo.
      emit(path, blob)
      kept.push(path)
    }
    // An empty set is omitted rather than written as []: sounds.js reads a
    // present set as a promise that those files are there to fetch, and a
    // missing one as nothing to play.
    if (kept.length) manifest.sets[set] = kept
  }

  manifest.source = label
  manifest.index = index
  writeFileSync(join(OUT, 'NOTICE.txt'),
    `Extracted from a local Minecraft install (${label}, asset index ${index})\n` +
    `by scripts/build-sounds.mjs.\n\n` +
    `These are Mojang assets. Fine on your own machine; NOT redistributable.\n` +
    `public/sounds/ is gitignored so they stay local-only.\n`)
  console.log(`extracted vanilla sounds from ${label}`)
}

const started = Date.now()
rmSync(STAGE, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

if (source === 'vanilla') fromVanilla()
else fromFree()

if (files === 0) throw new Error(`extracted nothing from source "${source}"`)

/*
 * The manifest is what the client reads. sounds.js needs the per-group variant
 * counts to pick a random sample, and hardcoding them there would mean two
 * places to edit and a class of silent 404s whenever they disagree. Its
 * presence also doubles as the "were sounds ever built?" check -- a missing
 * manifest is how sounds.js decides to stay quiet instead of throwing.
 */
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))
writeFileSync(join(OUT, '.source'), source)

// Swap the staged build in. Renames are near-instant, so a dev server sees at
// most a flicker rather than seconds of missing sounds.
const old = `${LIVE}.old`
rmSync(old, { recursive: true, force: true })
if (existsSync(LIVE)) renameSync(LIVE, old)
renameSync(OUT, LIVE)
rmSync(old, { recursive: true, force: true })
rmSync(STAGE, { recursive: true, force: true })

console.log(`${files} sounds, ${(bytes / 1024).toFixed(0)} KB`)
for (const [group, kinds] of Object.entries(manifest.groups)) {
  console.log(`  ${group.padEnd(7)} step x${kinds.step ?? 0}  dig x${kinds.dig ?? 0}`)
}
for (const [set, paths] of Object.entries(manifest.sets)) {
  console.log(`  ${set.padEnd(9)} x${paths.length}  ${paths.join(' ')}`)
}
if (missing.length) console.log(`  no sample for: ${missing.join(', ')}`)

/*
 * The drift check, and the reason this import exists.
 *
 * A block src/sounds.js cannot classify does not crash and does not go silent
 * -- it plays stone, the way all 634 unmapped blocks did before that table
 * was written. Which is precisely why it has to fail HERE: the symptom is a
 * world that sounds slightly wrong, and nobody files that as a bug.
 *
 * Fatal rather than a warning. The world was shipped for weeks with leaves
 * that sounded like flagstone because nothing anywhere said so out loud.
 */
const unmapped = unmappedBlocks()
if (unmapped.length) {
  throw new Error(
    `${unmapped.length} block(s) in blocks.js have no SoundType family in ` +
    `src/sounds.js and would play stone: ${unmapped.join(', ')}`)
}

/*
 * Every family a block can be mapped to has to END somewhere this build
 * produced, or those blocks are silent rather than approximate. Walking the
 * `from` chain here is what lets sounds.js name families the build has never
 * heard of (metal, glass, honey) without that being a bug waiting to happen.
 */
const unreachable = Object.keys(SOUND_GROUPS).filter(group => {
  let g = group
  for (let i = 0; g && i < 8; i++) {
    if (manifest.groups[g]) return false
    g = SOUND_GROUPS[g].from
  }
  return true
})
if (unreachable.length) {
  throw new Error(`sound families with no built samples to fall back to: ${unreachable.join(', ')}`)
}
console.log(`  ${Object.keys(SOUND_GROUPS).length} SoundType families mapped, ` +
  `${Object.keys(manifest.groups).length} built, 0 blocks unmapped`)

if (source === 'vanilla') {
  console.log('\n  These are Mojang assets. Fine on your own machine; do NOT')
  console.log('  commit them or deploy them publicly. public/sounds/ is')
  console.log('  gitignored so this stays hard to do by accident.\n')
}
console.log(`active sound source: ${source} (${((Date.now() - started) / 1000).toFixed(1)}s)`)
