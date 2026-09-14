#!/usr/bin/env node
/*
 * Boots Mojang's 1.21.8 dedicated server headlessly, once per seed, and makes
 * it generate a square of real chunks around the origin.
 *
 * Why a real server and not a JS reimplementation of the world generator:
 * there isn't a faithful one. Cubiomes and its ports approximate biome
 * placement well enough for seed-hunting, but they do not place a single
 * block -- no terrain shape, no ore, no trees. The only thing that produces
 * the blocks vanilla would produce is vanilla, so the pipeline pays for a JVM
 * once at build time and never again.
 *
 * Chunks are forced into existence with `forceload`, not by waiting for the
 * server's own "Preparing spawn area". Since 1.20.5 the spawn-chunk radius
 * defaults to 2, so booting a server generates roughly 5x5 chunks and stops --
 * nowhere near the 128x128 blocks this needs. forceload is the documented way
 * to say "generate exactly this rectangle" and it reports progress, so a run
 * that is merely slow looks different from one that is stuck.
 *
 * The area generated is deliberately LARGER than the 128x128 patch we want.
 * The patch location is chosen afterwards, by scoring windows (see scan.mjs),
 * because world spawn lands wherever the generator felt like putting it and
 * is very often a shoreline with nothing interesting in view.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const WORK = join(HERE, '..', '..', '.mcgen')
export const JAR = join(WORK, 'server-1.21.8.jar')
export const MC_VERSION = '1.21.8'

// The Minecraft launcher already downloaded the exact JRE Mojang pairs with
// 1.21.8 (java-runtime-delta, Java 21). Reusing it avoids a second multi-
// hundred-megabyte JDK install, and -- more usefully -- guarantees the server
// runs on the runtime it was tested against rather than whatever `java` is.
const LAUNCHER_JRE = join(
  process.env.HOME, 'Library', 'Application Support', 'minecraft', 'runtime',
  'java-runtime-delta', 'mac-os-arm64', 'java-runtime-delta',
  'jre.bundle', 'Contents', 'Home', 'bin', 'java',
)
const JAVA = existsSync(LAUNCHER_JRE) ? LAUNCHER_JRE : 'java'

// forceload refuses more than 256 chunks in one command, so the square is
// issued as a grid of at-most-16x16-chunk commands.
const MAX_SIDE = 16

const properties = seed => [
  `level-seed=${seed}`,
  /*
   * Port 0 means "let the OS pick a free one". Nothing ever connects to these
   * servers -- they exist to run the world generator and exit -- so the port
   * is pure ceremony, and picking it by hand was the single biggest source of
   * wasted runs here. Two servers on one port do not queue: the second dies
   * with BindException during init, the JVM still exits 0, and a run that
   * generated nothing looks exactly like one that worked, only faster. Fixed
   * per-lane ports fixed that until a stale server from an earlier run held
   * the port and broke it again. Port 0 cannot collide with anything, ever.
   */
  'server-port=0',
  'level-type=minecraft:normal',
  'level-name=world',
  'online-mode=false',
  'generate-structures=true',
  // Nothing connects to this server, so every per-player system is dead
  // weight. Small view/simulation distances keep it from generating chunks
  // we did not ask for while forceload does the real work.
  'view-distance=2',
  'simulation-distance=2',
  'spawn-protection=0',
  'max-players=1',
  'allow-nether=false',
  'spawn-monsters=false',
  'spawn-npcs=false',
  'spawn-animals=true',
  // Region files are only safe to parse once they are actually on disk.
  // save-all flush covers that, but this removes the OS-buffering question
  // entirely for the price of a slower generate we run a handful of times.
  'sync-chunk-writes=true',
  /*
   * Disable the watchdog. It exists to kill a server whose main thread has
   * hung, and it cannot tell that apart from a main thread legitimately busy
   * generating a thousand chunks in one go -- so at the default 60s it
   * crash-reports a perfectly healthy generate, and does it more often the
   * more lanes are competing for cores. Nothing connects to these servers,
   * so there is no hang for it to protect anyone from.
   */
  'max-tick-time=-1',
].join('\n') + '\n'

/**
 * Generate `radius` blocks in every direction from the origin for one seed.
 * Returns the world directory. Idempotent: an already-generated seed is
 * reused unless `fresh` is set.
 */
export async function generateSeed(seed, radius, { fresh = false, log = console.log } = {}) {
  const dir = join(WORK, `seed-${seed}`)
  const region = join(dir, 'world', 'region')
  if (fresh) rmSync(dir, { recursive: true, force: true })
  if (existsSync(region)) { log(`  seed ${seed}: already generated, reusing`); return dir }

  mkdirSync(dir, { recursive: true })
  // Mojang requires explicit EULA acceptance; without it the server writes a
  // fresh eula.txt and exits immediately, which looks exactly like a crash.
  writeFileSync(join(dir, 'eula.txt'), 'eula=true\n')
  writeFileSync(join(dir, 'server.properties'), properties(seed))

  const cMin = Math.floor(-radius / 16)
  const cMax = Math.floor((radius - 1) / 16)
  const commands = []
  for (let cx = cMin; cx <= cMax; cx += MAX_SIDE) {
    for (let cz = cMin; cz <= cMax; cz += MAX_SIDE) {
      const x2 = Math.min(cx + MAX_SIDE - 1, cMax)
      const z2 = Math.min(cz + MAX_SIDE - 1, cMax)
      // forceload takes BLOCK coordinates and resolves them to the containing
      // chunk, so chunk corners are multiplied back up by 16.
      commands.push(`forceload add ${cx * 16} ${cz * 16} ${x2 * 16} ${z2 * 16}`)
    }
  }

  const started = Date.now()
  log(`  seed ${seed}: generating ${radius * 2}x${radius * 2} blocks in ${commands.length} forceload batches`)

  await new Promise((resolve, reject) => {
    const proc = spawn(JAVA, ['-Xmx3G', '-jar', JAR, 'nogui'], { cwd: dir })
    let buffered = ''
    let sent = false
    let done = 0

    const feed = () => {
      for (const c of commands) proc.stdin.write(c + '\n')
      // save-all flush forces every generated chunk out of memory and into
      // the region files before the process goes away. Without it a fast
      // `stop` can leave the most recent chunks unwritten.
      proc.stdin.write('save-all flush\n')
      proc.stdin.write('stop\n')
    }

    const onLine = line => {
      // "Done (12.345s)! For help..." is the server's ready signal. Sending
      // commands before it appears silently drops them.
      if (!sent && /\bDone \(/.test(line)) { sent = true; feed() }
      if (/Added .* chunk|chunks? forced/i.test(line)) {
        done++
        if (done % 4 === 0) log(`    ...${done}/${commands.length} batches`)
      }
      if (/ERROR|Exception/i.test(line)) log(`    ! ${line.trim()}`)
    }

    proc.stdout.on('data', d => {
      buffered += d
      const lines = buffered.split('\n')
      buffered = lines.pop()
      for (const l of lines) onLine(l)
    })
    proc.stderr.on('data', d => log(`    ! ${String(d).trim().slice(0, 200)}`))
    proc.on('error', reject)
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`server exited ${code} for seed ${seed}`))
      resolve()
    })
  })

  // Trust the region files, not the exit code. See the server-port comment.
  const written = existsSync(region) ? readdirSync(region).filter(f => f.endsWith('.mca')) : []
  if (!written.length) throw new Error(`seed ${seed} produced no region files`)

  log(`  seed ${seed}: done in ${((Date.now() - started) / 1000).toFixed(0)}s (${written.length} region files)`)
  return dir
}
