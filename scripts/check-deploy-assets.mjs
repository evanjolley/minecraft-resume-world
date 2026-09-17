#!/usr/bin/env node
/*
 * Asserts that what is about to be deployed carries only redistributable art.
 *
 * Both asset builds can emit from two sources: a committed, openly licensed
 * set, or an extraction from a local Minecraft install. The second is fine on
 * your own machine and is copyright infringement on a public site. Nothing
 * about the output says which one it is -- an atlas is an atlas -- so each
 * build stamps a .source marker, and this reads it back.
 *
 * It runs against dist/, NOT public/. public/ is a developer's working state
 * and is allowed to be vanilla; dist/ is the artifact that ships, and vite
 * copies public/ into it wholesale. dist/ is therefore the last point where
 * the question "is this legal to serve" still has a checkable answer.
 *
 * Rejected: trusting build:deploy's pinned --source flags. They are correct
 * today and they are a convention, and a convention is exactly what a rushed
 * edit to a script line breaks. This is the assertion that notices.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')

// [directory, the one source that may be served, what the other one is]
const REQUIRED = [
  ['textures', 'ce', 'Mojang textures from a local Minecraft install'],
  ['sounds', 'free', 'Mojang audio from a local Minecraft install'],
]

/*
 * Directories that must not ship at all, and why that is a different rule
 * from the markers above. Textures and sounds have a redistributable source,
 * so the question is WHICH source built them. Terrain has no cleared source:
 * it is the output of Mojang's world generator and nobody has established
 * whether that may be republished (docs/DEPLOYMENT.md carries the question).
 * Until someone does, the answer is that it does not leave this machine.
 *
 * HALF OF THAT PROBLEM IS NOW GONE, and it is worth being precise about
 * which half, because the rule below did not change and a reader could
 * reasonably assume nothing did.
 *
 *   OVERWORLD -- CLEAN. It is no longer imported at all. src/flatworld.js
 *     generates it in the browser from a layer preset, so there is no
 *     terrain.bin, nothing to forbid, and nothing of Mojang's in it.
 *   NETHER -- UNCHANGED. public/terrain/nether.bin is still an extraction
 *     from a locally generated world, and this rule is still the thing
 *     keeping it off a public site.
 *   MOUNTAINS -- NEW, AND REFUSED BY THE RULE THAT WAS ALREADY HERE.
 *     public/terrain/mountains.bin is a 256-block cut of seed
 *     434533485056755 and is the same open question as the Nether, twice
 *     over by volume.
 *
 * THE PARAGRAPH BELOW USED TO SAY "the next imported asset should be refused
 * by default, not permitted by an omission", and that was written before
 * there was a next one. It was the right call: a rule narrowed to nether.bin
 * would have let mountains.bin through in silence. The rule needed no edit
 * and this comment is the only thing that changed.
 *
 * SO WHAT DOES A DEPLOYED BUILD CONTAIN? One world: the generated superflat
 * overworld. `npm run build:deploy` deletes dist/terrain wholesale, so
 * neither imported world's asset ships, and BOTH `/world mountains` and
 * `/dimension nether` fail there with a 404 that src/dimensions.js reports
 * to the player -- the same behaviour the Nether has had since b5e2255, now
 * applying to two rows instead of one. Adding a second import did not make a
 * deployable build dirtier; it made the generated world stop being the only
 * world, which is a different sentence and is why this note exists.
 *
 * The rule stays as a DIRECTORY rule rather than naming files.
 *
 * KNOWN CONSEQUENCE, not a bug in this file: `npm run build:deploy` deletes
 * dist/terrain wholesale, so a deployed build has no Nether asset and
 * `/dimension nether` fails there with a 404 that src/dimensions.js reports
 * to the player. That was already true before the overworld was generated.
 *
 * This is not belt-and-braces over .assetsignore. That file governs what
 * wrangler uploads; this governs what the build is allowed to produce, and
 * only one of them fails loudly.
 */
const FORBIDDEN = [
  ['terrain', 'imported Minecraft terrain (the Nether and the mountain patch),'
    + ' licence unresolved -- see docs/DEPLOYMENT.md'],
  /*
   * MOJANG'S 51 PAINTING TEXTURES, and this rule was written the same hour
   * the hole was made, because the hole is the exact one the note at the top
   * of FORBIDDEN_FILES warns about: "Gitignoring a file has never once kept
   * it out of a deploy in this repo."
   *
   * public/paintings/vanilla/ is extracted from a local Minecraft install by
   * `npm run paintings`. It is gitignored for the same reason
   * public/textures/ is -- and gitignore governs git, while vite copies
   * public/ into dist/ WHOLESALE. A `vite build` on the machine that ran the
   * extraction therefore shipped all 51 of them, silently, with no .source
   * marker to notice because a marker describes a BUILD and this directory
   * is a copy.
   *
   * A DIRECTORY RULE RATHER THAN A MARKER, which is the same shape as the
   * terrain rule above and for the same reason: the question here is not
   * "which source built this" but "is this here at all", and that is
   * answered by a path. `npm run build:deploy` now removes it, exactly as it
   * removes dist/terrain; this is the assertion that notices when somebody
   * edits that line.
   *
   * NOT the custom paintings. public/paintings/*.png is Evan's own art,
   * committed on purpose, and a deployed world is meant to have it -- that
   * is the whole point of the pipeline. What a deploy does NOT get is
   * vanilla's art, so every vanilla variant draws a blank canvas there.
   * docs/paintings.md carries the separate, open question of whether a
   * third-party photograph should be served at all.
   */
  ['paintings/vanilla', "Mojang's painting textures from a local Minecraft"
    + ' install -- same rule as dist/textures, see docs/paintings.md'],
]

/*
 * Single files under the same rule. Evan's CAPE is Mojang art granted to his
 * account rather than anything he drew, so serving it is redistribution --
 * the same open question as the terrain (docs/DEPLOYMENT.md). His SKIN is
 * not in here and is deliberately allowed.
 *
 * A file rather than a .source marker, unlike the textures above, because
 * the two questions are different shapes. "Which pack built this atlas" is
 * invisible in the output and needs a marker to answer. "Is the cape here"
 * is answered by its path, and checking the artifact beats trusting a note
 * the build left about itself.
 *
 * `npm run build:deploy` passes --no-cape, so the normal path never trips
 * this. It exists for the abnormal one: public/skins/ is a developer's
 * working state, it is allowed to hold the cape, and vite copies public/
 * into dist/ WHOLESALE. Gitignoring a file has never once kept it out of a
 * deploy in this repo.
 */
const FORBIDDEN_FILES = [
  ['skins/evan-cape.png', "Evan's Mojang cape, licence unresolved -- see docs/DEPLOYMENT.md."
    + ' Build with `npm run build:deploy`, which passes --no-cape'],
]

const problems = []
for (const [dir, why] of FORBIDDEN) {
  if (existsSync(join(DIST, dir))) problems.push(`dist/${dir}/ exists: ${why}`)
}
for (const [file, why] of FORBIDDEN_FILES) {
  if (existsSync(join(DIST, file))) problems.push(`dist/${file} exists: ${why}`)
}

for (const [dir, allowed, otherwise] of REQUIRED) {
  const marker = join(DIST, dir, '.source')
  if (!existsSync(marker)) {
    problems.push(`dist/${dir}/ has no .source marker -- cannot tell what it holds`)
    continue
  }
  const found = readFileSync(marker, 'utf8').trim()
  if (found !== allowed) {
    problems.push(
      `dist/${dir}/ was built from "${found}", not "${allowed}" -- that is ${otherwise}`)
  }
}

if (problems.length) {
  console.error('\nREFUSING TO DEPLOY. This build is not redistributable:\n')
  for (const p of problems) console.error(`  - ${p}`)
  console.error('\nRebuild with `npm run build:deploy`, which pins both sources.\n')
  process.exit(1)
}

console.log('deploy assets: textures=ce, sounds=free, no terrain, no vanilla painting art,'
  + ' no cape -- redistributable')
