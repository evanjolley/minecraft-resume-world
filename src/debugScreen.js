import { CreateLineSystem } from '@babylonjs/core/Meshes/Builders/linesBuilder'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Color3 } from '@babylonjs/core/Maths/math.color'

import { FONT_PX, px } from './hud.js'

/*
 * Minecraft's F3 debug screen.
 *
 * Reference: the wiki's own default-profile screenshot (Default Debug Menu.png)
 * plus the "Information lines" table on https://minecraft.wiki/w/Debug_screen.
 * Everything below either reproduces a vanilla line verbatim or is absent. The
 * lines vanilla has that this world cannot honestly fill are listed at the
 * bottom of this comment with the reason, because a debug screen full of "n/a"
 * is worse than a short one that is entirely true.
 *
 * WHAT VANILLA DRAWS (1.21-era, verified against the reference screenshot):
 *
 *   left, top-anchored             right, right-aligned
 *   ------------------             --------------------
 *   <fps> fps T: <max> vsync       Minecraft <V> (<V>/<M>/<S>)
 *   (blank)                        (blank)
 *   <clouds> B: <biomeblend>       Integrated server @ <ms> ms, <tx> tx, <rx> rx
 *   Filtering: <mode>              (blank)
 *   (blank)                        Java: <version>
 *   Mem: <P>% <used>/<total>MB     <threads>x <cpu name>
 *   Allocation rate: <A>MB/s       Display: <w>x<h> (<vendor>)
 *   Allocated: <AP>% <AR>MB        <renderer>
 *   (blank)                        OpenGL <version>
 *   XYZ: <x> / <y> / <z>           (blank)
 *   Block: <bx> <by> <bz>          Targeted Block: <x>, <y>, <z>
 *   Chunk: <cx> <cy> <cz> [<rx> <rz> in r.<a>.<b>.mca]
 *   Facing: <dir> (Towards <axis>) (<yaw> / <pitch>)
 *   <dimension> FC: <n>
 *   Section-relative: <x> <y> <z>
 *
 * Note the decimal counts, which are the detail everyone gets wrong: X and Z
 * carry THREE decimals and Y carries FIVE ("4745.761 / 86.00000 / 1638.450").
 * Yaw and pitch carry one each.
 *
 * WHAT IS CUT, AND WHY (each of these is "no such thing here", not "hard"):
 *
 *   Biome                  the terrain asset has no per-column biome data. The
 *                          one genuine gap rather than a genuine absence -- see
 *                          the note on BIOME below.
 *   Server Light           STILL CUT, but for ONE reason now instead of two.
 *                          The reason that went away: its content is a (sky,
 *                          block) pair, and the sky half exists as of
 *                          2026-09-16. The reason that has not: THERE IS NO
 *                          SERVER. Vanilla's line is the authoritative copy a
 *                          server holds, printed beside the client's so you
 *                          can see them disagree; here there is only one copy,
 *                          and printing it twice under two headings would
 *                          invent an agreement between two things rather than
 *                          invent a number. Which is worse, not better.
 *   CH / SH heightmaps     server-side acceleration structures. No server, and
 *                          island.js answers a column by scanning it.
 *   Local Difficulty       no difficulty system, no regional difficulty.
 *   Day #<n>               sky.js keeps time modulo one day (TICKS_PER_DAY) and
 *                          never counts days, so the number does not exist.
 *   NoiseRouter / Biome builder
 *                          this world is an EXTRACT of a real Minecraft world,
 *                          not a live generator. There are no noise values.
 *   Allocation rate / Allocated
 *                          GC concepts. A JS heap has no allocation rate the
 *                          runtime will tell you about.
 *   Java: <version>        no JVM.
 *   <threads>x <cpu name>  navigator.hardwareConcurrency gives the thread count
 *                          and the browser deliberately withholds the CPU name.
 *                          "8x" on its own is half of vanilla's line, so the
 *                          line goes rather than showing a stump.
 *   Filtering / B: <blend> / <clouds>
 *                          video options that do not exist as options here.
 *   Targeted Fluid         noa.targetedBlock only ever reports solids, so a
 *                          fluid is never the target.
 *   Targeted Entity        noa has no entity raycast.
 *   Entity spawn counts, sound counts, post effects, SD, aB, FC
 *                          systems this world does not have.
 *
 * WHAT IS KEPT THAT NEEDED AN ARGUMENT:
 *
 *   Mem:                   performance.memory is Chrome-only, non-standard, and
 *                          reports the JS heap ONLY -- it does not see the GPU
 *                          buffers that are most of this app's footprint. Kept
 *                          anyway because vanilla's Mem: line is also a heap
 *                          number and is also not the process RSS, so the line
 *                          means the same thing it means in Minecraft. On a
 *                          browser without it the line is OMITTED rather than
 *                          printed as a dash: see MEMORY below.
 *   <dimension>            there is one dimension and it can never change, so
 *                          the line is decoration. Kept because vanilla's game
 *                          version line is equally constant and nobody calls
 *                          that decoration -- it is the line that names where
 *                          you are. "FC:" is dropped; there is no forceload.
 *   Integrated server @    there is no server, but there IS an in-process fixed
 *                          -rate tick loop, which is exactly what a singleplayer
 *                          integrated server is. tx/rx are dropped because
 *                          there is no transport yet; they come back with it.
 */

/*
 * The one genuine gap.
 *
 * public/terrain/terrain.json carries format, generator, minecraftVersion,
 * seed, world, palette and spawn -- and no per-column biome. The extractor
 * never wrote one, so Biome cannot be filled from the current asset and this
 * file does not pretend otherwise by printing a guess.
 *
 * Cost of closing it, for whoever decides: the patch is 128x128, so a
 * per-column biome map is 16,384 entries. The spawn scan already found only a
 * handful of distinct biomes in sight, so a palette of ~8 names plus one byte
 * per column is 16KB raw and a few KB run-length encoded -- noise next to the
 * 981KB terrain.bin. Re-extraction is ~90 seconds because .mcgen/ still holds
 * the generated worlds. The reason it is not done here is that the terrain
 * pipeline is verified voxel-for-voxel (4,096,000 checks) and two other
 * systems read its output; re-running it for one cosmetic line is not this
 * change's call to make.
 */

/*
 * LIGHT, and the line is now whole.
 *
 * Vanilla prints `Client Light: 15 (15 sky, 0 block)` -- a combined level
 * followed by the two channels it was taken from. Both halves are real:
 *
 *   block   window.blockLight.getBlockLight(x, y, z). Stand on a glowstone and
 *           it reads 14; walk away and it falls one per block.
 *
 *   sky     window.blockLight.getSkyLight(x, y, z). 15 under open sky, 0 under
 *           a roof, and 15 at the bottom of a shaft because sky light does not
 *           decay downward. This slot PRINTED AS `-` until 2026-09-16, because
 *           sky light did not exist and a `0` would have been a lie in the one
 *           place on this screen where people read numbers off. The `-` is
 *           gone; nothing else about the line moved, which was the point of
 *           carrying a null through `readLight` rather than omitting a field.
 *
 * The combined value is `max(sky, block)`, which is vanilla's. NOT
 * `max(sky * daylight, block)`: the number vanilla prints is the raw stored
 * level, the same at midnight as at noon, and the clock lives in the shader
 * and in entityLight.js. A combined value that changed as the sun moved would
 * be a different fact under the same label.
 *
 * WHERE IT SITS: vanilla puts these lines between the CH/SH heightmaps and
 * Local Difficulty. Both of those are cut here, along with Biome, so the line
 * lands at the foot of the block that survived rather than in the middle of a
 * gap that no longer exists.
 *
 * The line is OMITTED ENTIRELY if window.blockLight is absent -- the same
 * shape as MEMORY below. main.js installs the engine long before this screen
 * can be opened, so that path is for a build that dropped blockLight.js, and
 * for it the honest output is no line at all.
 */

/*
 * The asset version.
 *
 * <M> is read live from /textures/.source, which build-textures.mjs writes and
 * check-deploy-assets.mjs guards -- so the debug screen surfaces the exact fact
 * the deploy gate cares about ("vanilla" vs "ce") rather than a copy of it.
 *
 * <V> is pinned. It is terrain.json's minecraftVersion, and terrain.json is
 * gitignored (generated) and is stripped from dist/ at deploy, so there is
 * nothing to read it from at runtime. Rejected: importing the JSON at build
 * time -- it would make `vite build` fail on a fresh clone that has not run
 * `npm run terrain` yet. The right fix is for terrainFormat.js's VOX1 header to
 * carry the version so this constant can go; that is a change to a verified
 * pipeline and is left as a flagged follow-up.
 */
const MC_VERSION = '1.21.8'

/*
 * Minecraft's chunk, not noa's.
 *
 * noa meshes in 32-voxel chunks (main.js chunkSize) and that number is what the
 * "C:" line reports, because that is what the engine actually loads. The
 * "Chunk:" line uses 16, because a chunk in the COORDINATE sense is a Minecraft
 * chunk -- it is the unit this terrain was extracted in, and the region-file
 * arithmetic below (32x32 chunks per region) only means anything at 16. F3+G
 * draws 16 to match the line it belongs to.
 */
const CHUNK = 16
const REGION = 32

/*
 * Vanilla's colours, which are NOT chat's.
 *
 * Chat draws 0x80000000 -- half-transparent black. The debug screen draws
 * 0x90505050, a lighter grey at higher alpha, which is why F3 text stays
 * readable over a bright sky where chat would disappear. Text is 0xE0E0E0 with
 * NO drop shadow; every other text layer in this HUD has one.
 */
const BG = 'rgba(80, 80, 80, 0.565)'
const FG = '#e0e0e0'

/** Minecraft's font line height. Rows touch: the pitch IS the height. */
const LINE = 9

/*
 * The compass, and the one thing on this screen that is NOT a copy of vanilla.
 *
 * Minecraft is right-handed (+X east, +Y up, +Z south): stand facing south
 * there and west is on your right. Babylon's scene is LEFT-handed
 * (useRightHandedSystem is false, noa's default), so stand facing +Z here and
 * +X is on your RIGHT. Measured rather than assumed, and now measured in a
 * spec rather than in a comment: test/25-orientation.spec.js projects a point
 * at +X through the scene's full transform at heading 0 and finds it on the
 * right of the screen.
 *
 * So the axes cannot carry Minecraft's cardinal names AND turn like a compass.
 * Pick one:
 *
 *   (a) keep vanilla's pairing (east = +X, west = -X). Turning right from north
 *       then reads north -> west -> south -> east, anticlockwise. This is what
 *       shipped first and it is what Evan caught by walking it: "I am looking
 *       north, then I turn right, then I'm looking west."
 *   (b) keep the compass turning clockwise, and let +X be west here.
 *
 * (b), for two reasons. A compass that turns the wrong way is wrong in the only
 * way a player can perceive. And it makes the "Towards" half true as well: walk
 * west in this world and X goes UP, so "west (Towards positive X)" is something
 * you can verify by walking, where vanilla's "negative X" would contradict the
 * Block: line printed directly above it.
 *
 * The happy consequence is that the yaw conversion becomes the identity. noa's
 * heading 0 faces +Z, which is south; 90 degrees faces +X, which is west here
 * -- and Minecraft's yaw is 0 at south and 90 at west. Same numbers, no flip.
 * The sign flip that used to sit in mcYaw WAS the bug.
 *
 * WHAT THE TERRAIN FLIP CHANGED HERE: nothing in the table below, and that is
 * the interesting part. When this table was first written the terrain asset
 * was a MIRROR IMAGE of the Minecraft world it was cut from, and the honest
 * reading of the note above it was "the labels have been bent to fit a
 * mirrored world". scripts/terrain/extract.mjs now mirrors X while writing the
 * asset, so the world is a faithful copy -- and the table did not move,
 * because the reason for it was never the terrain. It was Babylon.
 *
 * The one line that WAS bent has been straightened, in blockMeshes.js: it used
 * the (a) labels with a geometry table mirrored to cancel them, which placed
 * stairs correctly under names that were the wrong way round. Both halves were
 * flipped together and it now agrees with this table. Still not merged with
 * it: the two answer different questions, and renaming one without the other
 * is exactly how stairs start placing backwards.
 *
 * STILL NOT VANILLA, and cannot be: real Minecraft prints "east (Towards
 * positive X)". This world prints "east (Towards negative X)", because east
 * genuinely is -X here. Flipping the terrain's Z instead of its X would have
 * bought vanilla's X pairing and lost vanilla's Z pairing -- the same sentence
 * with the axes swapped -- so there is no arrangement that makes both halves
 * of this line read like the wiki.
 */
const FACINGS = [
  { name: 'south', towards: 'positive Z' },   // yaw 0,   noa heading 0
  { name: 'west', towards: 'positive X' },    // yaw 90,  noa heading PI/2
  { name: 'north', towards: 'negative Z' },   // yaw 180, noa heading PI
  { name: 'east', towards: 'negative X' },    // yaw 270, noa heading 3PI/2
]

/*
 * noa's heading into Minecraft's yaw. Per the compass note above the two
 * frames agree once +X is read as west, so all this does is fold the angle
 * into Minecraft's -180..180 range.
 *
 * Pitch needs no conversion at all: noa's rotateX sends [0, 0, 1] toward
 * negative Y for a positive angle, and Minecraft's positive pitch is also
 * looking down, so degrees go straight across.
 */
function mcYaw(heading) {
  const deg = heading * 180 / Math.PI
  return ((deg + 180) % 360 + 360) % 360 - 180
}

/** Floor division that stays correct for negatives -- `-1 / 16 | 0` is 0. */
const floorDiv = (n, d) => Math.floor(n / d)

/*
 * A frame-rate sample that is honest about both halves of vanilla's line.
 *
 * `fps` is frames counted over a rolling second. `T:` in vanilla is the frame
 * cap; in a browser requestAnimationFrame is capped by the display, so the cap
 * is the display's refresh rate -- and the way to learn that without asking for
 * a permission is to watch the SHORTEST frame delta you see. A slow frame
 * stretches the average; nothing makes a frame arrive faster than the panel
 * allows, so the minimum converges on the true refresh and stays there.
 */
function createFrameCounter() {
  let frames = 0, fps = 0, windowStart = performance.now(), prev = windowStart
  let minDelta = Infinity, cap = 0
  return {
    frame() {
      const now = performance.now()
      const delta = now - prev
      prev = now
      // A tab-out delivers one 3000ms "frame". It is not a frame.
      if (delta > 0 && delta < 1000 && delta < minDelta) minDelta = delta
      frames++
      if (now - windowStart >= 1000) {
        fps = Math.round(frames * 1000 / (now - windowStart))
        cap = minDelta === Infinity ? 0 : Math.round(1000 / minDelta)
        frames = 0
        minDelta = Infinity
        windowStart = now
      }
    },
    get fps() { return fps },
    /*
     * Reset every window rather than kept for the life of the page. A
     * lifetime minimum latches onto the single luckiest frame since boot and
     * then never moves -- it read "185" on a machine managing eight frames a
     * second, which is the opposite of useful. Per-window, the number says
     * what it should: on a healthy machine it pins to the panel's refresh,
     * and on a struggling one it collapses toward the frame rate, which is
     * how you tell "vsync is holding me at 60" from "I am GPU bound".
     */
    get cap() { return cap },
  }
}

/*
 * GPU identity.
 *
 * WEBGL_debug_renderer_info is the only way to get the real adapter string, and
 * browsers increasingly refuse it (Firefox gates it behind a pref; Chrome
 * returns a generalised string). When it is refused, the UNMASKED_* queries
 * throw or return undefined and the plain RENDERER is still there -- that is
 * "WebKit WebGL" on Safari, which is useless but true. Read once: the strings
 * cannot change for the life of the context, and the extension lookup is not
 * free.
 */
function readGL(noa) {
  try {
    const gl = noa.rendering.getScene().getEngine()._gl
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    return {
      vendor: (ext && gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)) || gl.getParameter(gl.VENDOR),
      renderer: (ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER),
      version: gl.getParameter(gl.VERSION),
    }
  } catch {
    return { vendor: '', renderer: '', version: '' }
  }
}

/*
 * The runtime line, standing in for "Java: 21.0.9".
 *
 * userAgentData.brands is the modern, un-spoofed list and it is Chromium-only;
 * everywhere else the UA string is what there is. Both paths answer the same
 * question vanilla's line answers -- which runtime is executing this -- so the
 * line survives the JVM's absence even though nothing else in that block does.
 */
function readRuntime() {
  const brands = navigator.userAgentData?.brands
  if (brands) {
    // The list carries a deliberate junk entry ("Not;A Brand") to break naive
    // parsers. Take the last real one, which is the actual browser.
    const real = brands.filter(b => !/not[^a-z]*a[^a-z]*brand/i.test(b.brand))
    const b = real[real.length - 1]
    if (b) return `${b.brand}: ${b.version}`
  }
  const m = navigator.userAgent.match(/(Firefox|Chrome|Version)\/([\d.]+)/)
  return m ? `${m[1] === 'Version' ? 'Safari' : m[1]}: ${m[2]}` : navigator.userAgent
}

export function installDebugScreen(noa, deps = {}) {
  const { particles, drops, inputLock, interaction } = deps

  const root = document.createElement('div')
  root.id = 'debug'
  root.className = 'hidden'
  const leftCol = document.createElement('div')
  leftCol.id = 'debug-left'
  const rightCol = document.createElement('div')
  rightCol.id = 'debug-right'
  root.append(leftCol, rightCol)
  document.body.appendChild(root)

  // The layout is in Minecraft GUI pixels against hud.js's SCALE, exactly like
  // the hotbar and chat. Vanilla draws the first glyph at (2, 2) with the
  // background starting one pixel earlier, which is the 1/1 split below.
  for (const col of [leftCol, rightCol]) {
    col.style.top = px(1)
    col.style.fontSize = `${FONT_PX}px`
    col.style.lineHeight = px(LINE)
  }
  leftCol.style.left = px(1)
  rightCol.style.right = px(1)

  const gl = readGL(noa)
  const runtime = readRuntime()
  const frames = createFrameCounter()

  // Fetched rather than hardcoded -- see MC_VERSION. A failure leaves the field
  // empty instead of guessing, which is the honest failure for a line whose
  // whole job is to say which asset set is loaded.
  let texSource = ''
  fetch('/textures/.source').then(r => r.ok ? r.text() : '').then(t => { texSource = t.trim() }).catch(() => {})

  /* ---- tick timing ---- */
  /*
   * How long a tick actually takes, measured the way vanilla measures its
   * integrated server: wall time spent INSIDE the tick, not the interval
   * between ticks. Those differ by exactly the idle time, which is the whole
   * point -- an interval measurement reads a flat 33.3ms whether the world is
   * asleep or on fire.
   *
   * Done by decorating the tick CALL rather than by bracketing a pair of 'tick'
   * listeners, which is what this did first and which measured a flat 0.0ms.
   * noa emits 'tick' as the LAST thing it does, after physics, meshing and the
   * entity systems, so two listeners can only ever bracket the listeners
   * registered between them -- and installing at one point in main.js means
   * that is a handful of them at best. Decorating catches the engine's own
   * work too, which is most of it; itemEntity.js decorates authority the same
   * way.
   *
   * The seam is `noa.container._shell.onTick`, NOT `noa.tick`. container.js
   * does `this._shell.onTick = noa.tick.bind(noa)` once at construction, so
   * the shell holds a bound reference and reassigning noa.tick afterwards is
   * silently ignored -- which is how the first version of this line built,
   * ran, and reported zero without ever failing. `_shell` is internal; if a
   * noa upgrade moves it the guard below leaves the line reading 0.0 rather
   * than throwing on boot.
   *
   * An exponential average rather than a window: vanilla smooths its number
   * too, and a raw per-tick figure at 30Hz is a blur.
   */
  let tickMs = 0
  const shell = noa.container._shell
  const innerTick = shell && shell.onTick
  if (innerTick) {
    shell.onTick = (dt) => {
      const t0 = performance.now()
      innerTick(dt)
      const elapsed = performance.now() - t0
      tickMs = tickMs === 0 ? elapsed : tickMs * 0.9 + elapsed * 0.1
    }
  }
  noa.on('beforeRender', () => frames.frame())

  /* ---- the sample ---- */

  /**
   * Everything the screen shows, as data. Split from rendering so a spec can
   * assert the VALUES -- that position tracks the player, that the targeted
   * block is the one under the crosshair -- instead of scraping glyphs out of
   * a div and hoping.
   */
  function sample() {
    const p = noa.ents.getPositionData(noa.playerEntity).position
    const [x, y, z] = p
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z)
    const cx = floorDiv(bx, CHUNK), cy = floorDiv(by, CHUNK), cz = floorDiv(bz, CHUNK)

    const yaw = mcYaw(noa.camera.heading)
    const pitch = noa.camera.pitch * 180 / Math.PI
    /*
     * Vanilla's own bucketing, from Direction.fromYRot: `floor(yaw / 90 + 0.5)
     * & 3`, indexing SOUTH, WEST, NORTH, EAST in that order. The + 0.5 centres
     * each quadrant on its cardinal, so 44 degrees is still south rather than
     * flipping to west at 45 the way a bare divide would. The & 3 -- not a
     * modulo -- is what keeps it right for negative yaws: -1 % 4 is -1 in
     * JavaScript, and -1 & 3 is 3, which is east.
     */
    const facing = FACINGS[Math.floor(yaw / 90 + 0.5) & 3]

    const world = noa.world
    const target = noa.targetedBlock

    return {
      fps: frames.fps,
      cap: frames.cap,
      tickMs,
      tickRate: noa.tickRate,
      mem: readMemory(),

      position: [x, y, z],
      block: [bx, by, bz],
      chunk: [cx, cy, cz],
      // Vanilla's region arithmetic: 32x32 chunks per region file, and the
      // bracket shows where the chunk sits INSIDE that file. The mask is what
      // makes it right for negative coordinates, where a remainder is not.
      region: [cx >> 5, cz >> 5],
      regionChunk: [cx & (REGION - 1), cz & (REGION - 1)],
      sectionRelative: [bx & (CHUNK - 1), by & (CHUNK - 1), bz & (CHUNK - 1)],
      // One Map lookup, on the same 30Hz tick as everything else on this
      // screen and only while it is open. See the LIGHT note above.
      light: readLight(bx, by, bz),
      facing: facing.name,
      towards: facing.towards,
      yaw,
      pitch,
      dimension: 'minecraft:overworld',

      chunks: world._chunksKnown.count(),
      chunksPending: world._chunksPending.count(),
      chunksToMesh: world._chunksToMesh.count() + world._chunksToMeshFirst.count(),
      renderDistance: noa.world._chunkAddDistance[0],

      // Entities noa is simulating, which is every drop plus the NPC plus you.
      entities: noa.ents.getStatesList(noa.ents.names.position).length,
      drops: drops ? drops.count : 0,
      particles: particles ? particles.live : 0,

      version: MC_VERSION,
      source: texSource,
      runtime,
      display: [noa.container.canvas.width, noa.container.canvas.height],
      gl,

      target: target ? {
        position: [...target.position],
        id: target.blockID,
        name: deps.blockName ? deps.blockName(target.blockID) : String(target.blockID),
      } : null,
    }
  }

  /*
   * Memory.
   *
   * performance.memory is Chrome-only and non-standard, and it reports the JS
   * heap, so it misses the Babylon vertex buffers that dominate this app. It is
   * still the same KIND of number vanilla shows -- a managed heap, not the
   * process -- so the line is kept where it exists and dropped where it does
   * not. Returning null rather than zeros is what lets the renderer omit the
   * line instead of printing "Mem: 0% 0/0MB", which would be a lie in a place
   * people read numbers off.
   */
  function readMemory() {
    const m = performance.memory
    if (!m || !m.jsHeapSizeLimit) return null
    const MB = 1024 * 1024
    return {
      used: Math.round(m.usedJSHeapSize / MB),
      total: Math.round(m.jsHeapSizeLimit / MB),
      percent: Math.round(m.usedJSHeapSize / m.jsHeapSizeLimit * 100),
    }
  }

  /**
   * Both light channels where the player is standing, or null if there is no
   * engine.
   *
   * `sky` was null here until sky light landed, and the renderer printed it as
   * `-`. Keeping the field rather than leaving it out was the bet that the day
   * would cost one assignment and no change anywhere else. It did.
   *
   * `getSkyLight` is probed for rather than assumed, so a build running an
   * older blockLight.js falls back to the dash instead of printing
   * `undefined`.
   */
  function readLight(x, y, z) {
    const engine = typeof window !== 'undefined' ? window.blockLight : null
    if (!engine) return null
    return {
      block: engine.getBlockLight(x, y, z),
      sky: engine.getSkyLight ? engine.getSkyLight(x, y, z) : null,
    }
  }

  /* ---- the lines ---- */

  const f3 = (n, d) => n.toFixed(d)

  function leftLines(s) {
    const lines = [
      // vsync is not a setting here: requestAnimationFrame IS vsync, always.
      `${s.fps} fps T: ${s.cap || 'inf'} vsync`,
      '',
      // "(s)" and "aB:" are vanilla's sort state and buffer pool, neither of
      // which noa has. The rest map one to one.
      `C: ${s.chunks} D: ${s.renderDistance}, pC: ${String(s.chunksPending).padStart(3, '0')}, `
        + `pU: ${String(s.chunksToMesh).padStart(2, '0')}`,
      `E: ${s.entities}`,
      `P: ${s.particles}`,
      '',
    ]
    if (s.mem) {
      lines.push(`Mem: ${s.mem.percent}% ${s.mem.used}/${s.mem.total}MB`, '')
    }
    lines.push(
      // Three decimals on X and Z, five on Y. Vanilla's own asymmetry.
      `XYZ: ${f3(s.position[0], 3)} / ${f3(s.position[1], 5)} / ${f3(s.position[2], 3)}`,
      `Block: ${s.block[0]} ${s.block[1]} ${s.block[2]}`,
      `Chunk: ${s.chunk[0]} ${s.chunk[1]} ${s.chunk[2]} `
        + `[${s.regionChunk[0]} ${s.regionChunk[1]} in r.${s.region[0]}.${s.region[1]}.mca]`,
      `Facing: ${s.facing} (Towards ${s.towards}) (${f3(s.yaw, 1)} / ${f3(s.pitch, 1)})`,
      s.dimension,
      // Vanilla zero-pads these to two digits.
      `Section-relative: ${s.sectionRelative.map(n => String(n).padStart(2, '0')).join(' ')}`,
    )
    if (s.light) {
      // Vanilla's exact shape: `Client Light: 15 (15 sky, 0 block)`, where the
      // leading number is the max of the two. See LIGHT at the top.
      const sky = s.light.sky === null ? '-' : s.light.sky
      const combined = s.light.sky === null
        ? s.light.block : Math.max(s.light.sky, s.light.block)
      lines.push(`Client Light: ${combined} (${sky} sky, ${s.light.block} block)`)
    }
    return lines
  }

  function rightLines(s) {
    const lines = [
      `Minecraft ${s.version} (${s.version}/${s.source || '?'})`,
      '',
      // No transport, so no ", 0 tx, 0 rx". The budget after the slash is the
      // tick interval, which is what makes the first number mean anything.
      `Integrated server @ ${f3(s.tickMs, 1)}/${f3(1000 / s.tickRate, 1)} ms`,
      '',
      s.runtime,
      `Display: ${s.display[0]}x${s.display[1]} (${s.gl.vendor})`,
      s.gl.renderer,
      s.gl.version,
    ]
    if (s.target) {
      lines.push(
        '',
        `Targeted Block: ${s.target.position[0]}, ${s.target.position[1]}, ${s.target.position[2]}`,
        s.target.name,
      )
    }
    return lines
  }

  /*
   * Painting.
   *
   * One <div> per line, reused across frames -- the count changes only when the
   * Mem or Targeted Block blocks appear, so the pool grows to the high-water
   * mark and then stops. Rejected: rebuilding innerHTML each frame, which is
   * simpler and throws away every layout box sixty times a second on text that
   * is mostly identical between frames.
   *
   * An empty line gets no background: vanilla's blank separators are gaps, not
   * grey bars, and giving a zero-width div a background paints a 2px stub.
   */
  function paint(col, lines) {
    while (col.childElementCount < lines.length) {
      const el = document.createElement('div')
      el.className = 'debug-line'
      el.style.height = px(LINE)
      el.style.padding = `0 ${px(1)}`
      col.appendChild(el)
    }
    while (col.childElementCount > lines.length) col.lastElementChild.remove()

    lines.forEach((text, i) => {
      const el = col.children[i]
      if (el.textContent !== text) el.textContent = text
      el.style.background = text ? BG : 'none'
    })
  }

  /* ---- chunk borders (F3+G) ---- */
  /*
   * Vanilla draws the boundary of the chunk you are standing in and of its
   * neighbours. This draws the one you are in, as a wireframe column spanning
   * the world's full height, because that is the part that answers the question
   * people press F3+G to ask: where does this chunk end.
   *
   * Built as a DOM-free Babylon LinesMesh rather than a shader, and REBUILT
   * only when the chunk changes -- a lines mesh is cheap to make and free to
   * leave alone, and rebuilding it per frame would cost more than the rest of
   * this file put together.
   */
  let borderMeshes = []
  let borderChunkKey = ''
  let bordersOn = false

  function updateBorders(s) {
    if (!bordersOn) {
      borderMeshes.forEach(m => m.dispose())
      borderMeshes = []
      borderChunkKey = ''
      return
    }
    const key = `${s.chunk[0]},${s.chunk[2]}`
    if (key === borderChunkKey && borderMeshes.length) return
    borderChunkKey = key
    borderMeshes.forEach(m => m.dispose())
    borderMeshes = buildChunkBorder(s.chunk[0], s.chunk[2])
  }

  /*
   * Vanilla's cage, not four corner posts.
   *
   * The first version of this drew one wireframe box per chunk, and from
   * INSIDE the chunk -- which is the only place you ever are when you press
   * F3+G -- it was invisible: the four verticals sit at the corners, behind
   * whatever terrain is between you and them. Vanilla solves that by drawing a
   * dense cage you are standing in the middle of:
   *
   *   blue verticals every 2 blocks along all four chunk edges
   *   yellow verticals at the four corners
   *   yellow horizontal rings at every 16-block section boundary
   *
   * Two meshes rather than one, because a Babylon LinesMesh carries a single
   * `color` for the whole mesh. Rejected: one mesh with per-vertex colours,
   * which CreateLineSystem supports -- it needs a parallel colour array the
   * same shape as the points and buys nothing here, since there are exactly
   * two colours and they never change.
   */
  function buildChunkBorder(cx, cz) {
    const scene = noa.rendering.getScene()
    const x0 = cx * CHUNK, z0 = cz * CHUNK
    const x1 = x0 + CHUNK, z1 = z0 + CHUNK
    // The world's own vertical extent, from island.js's floor to above its
    // ceiling. A cage that stops at the player's feet answers nothing.
    const y0 = -70, y1 = 190

    const blue = [], yellow = []
    for (let d = 2; d < CHUNK; d += 2) {
      blue.push([[x0 + d, y0, z0], [x0 + d, y1, z0]])
      blue.push([[x0 + d, y0, z1], [x0 + d, y1, z1]])
      blue.push([[x0, y0, z0 + d], [x0, y1, z0 + d]])
      blue.push([[x1, y0, z0 + d], [x1, y1, z0 + d]])
    }
    for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) {
      yellow.push([[x, y0, z], [x, y1, z]])
    }
    // Section boundaries. `- (y0 & 15)` snaps the first ring onto a real
    // multiple of 16 rather than onto the world floor, which is not one.
    for (let y = y0 - (y0 & (CHUNK - 1)); y <= y1; y += CHUNK) {
      yellow.push([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [x0, y, z0]])
    }

    return [
      addLines(scene, 'debug-chunk-border', yellow, new Color3(1, 1, 0)),
      addLines(scene, 'debug-chunk-border-cage', blue, new Color3(0.25, 0.45, 1)),
    ]
  }

  /* ---- hitboxes (F3+B) ---- */
  /*
   * Vanilla draws every entity's collision box plus a line out of its eyes.
   * Here that is the player box and each dropped item's box, taken from the
   * physics bodies rather than from the render meshes -- which is the whole
   * point of the key. A model that does not fit its hitbox is exactly the bug
   * F3+B exists to show, and reading the mesh would hide it.
   */
  let hitboxMesh = null
  let hitboxesOn = false

  function updateHitboxes() {
    if (hitboxMesh) { hitboxMesh.dispose(); hitboxMesh = null }
    if (!hitboxesOn) return
    const scene = noa.rendering.getScene()
    const lines = []
    for (const state of noa.ents.getStatesList(noa.ents.names.physics)) {
      const aabb = state.body?.aabb
      if (!aabb) continue
      const [x0, y0, z0] = aabb.base
      const [x1, y1, z1] = aabb.max
      for (const [a, b] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) {
        lines.push([[a, y0, b], [a, y1, b]])
      }
      for (const yy of [y0, y1]) {
        lines.push([[x0, yy, z0], [x1, yy, z0], [x1, yy, z1], [x0, yy, z1], [x0, yy, z0]])
      }
    }
    if (!lines.length) return
    hitboxMesh = addLines(scene, 'debug-hitboxes', lines, new Color3(1, 1, 1))
  }

  /*
   * One LinesMesh from many disconnected segments. CreateLineSystem rather than
   * CreateLines because the latter draws a single polyline -- feed it a box and
   * it joins the last corner back to the first through the middle of the world.
   *
   * `updatable: false` is the default and is what we want: these are rebuilt by
   * disposal, not by rewriting vertices, because they change only when you
   * cross a chunk edge rather than every frame.
   */
  function addLines(scene, name, lines, color) {
    const mesh = CreateLineSystem(name, {
      lines: lines.map(seg => seg.map(([a, b, c]) => new Vector3(a, b, c))),
    }, scene)
    mesh.color = color
    /*
     * The vertices above are ABSOLUTE world coordinates, and [0, 0, 0] is what
     * converts them: addMeshToScene runs the origin through globalToLocal and
     * parks the mesh at the negated offset, so absolute vertices land in the
     * right place -- and noa shifts every mesh it knows about when it re-bases
     * the origin, so they stay there. Skipping addMeshToScene and setting
     * mesh.position by hand renders correctly at spawn and drifts the further
     * you walk, which is the worst way for it to be wrong.
     */
    noa.rendering.addMeshToScene(mesh, false, [0, 0, 0])
    return mesh
  }

  /* ---- the key ---- */
  /*
   * F3 is an OVERLAY, not a screen.
   *
   * It must not touch inputLock: the world keeps running, you keep walking, and
   * -- unlike the inventory or the pause menu -- there is nothing on screen to
   * click. That is also why the CSS does not hide it on `body.inv-open`: in
   * vanilla the debug text stays visible behind an open inventory, because it
   * is drawn in the HUD pass before any screen renders.
   *
   * Chat is the one guard. While the chat bar is open every keystroke is text,
   * and an unguarded listener would swallow the "3" in "f3" -- or rather, would
   * toggle the debug screen every time someone typed the letter f3 is bound to.
   * inputLock.locked covers the inventory and the pause menu too, and taking
   * the whole lock rather than just chat is deliberate: any state that means
   * "keys are not gameplay right now" should mean it for this key as well.
   */
  let open = false
  const held = new Set()

  function onKeyDown(e) {
    if (e.code === 'F3') held.add('F3')
    if (e.repeat) return
    if (inputLock && inputLock.locked) return

    if (e.code === 'F3') {
      // Chrome has no default for F3 but Firefox opens quick-find, which steals
      // the key and leaves the overlay working only every other press.
      e.preventDefault()
      return
    }
    if (!held.has('F3')) return

    if (e.code === 'KeyG') { e.preventDefault(); bordersOn = !bordersOn; combo = true }
    else if (e.code === 'KeyB') { e.preventDefault(); hitboxesOn = !hitboxesOn; updateHitboxes(); combo = true }
  }

  /*
   * Why the toggle is on keyUP and why `combo` exists.
   *
   * Vanilla's rule: F3 alone toggles the overlay, F3+G toggles borders and does
   * NOT toggle the overlay. You cannot know which one happened until the key
   * comes back up, so the decision has to wait for the release -- and the
   * release has to know whether a second key arrived in the meantime. Toggling
   * on keydown instead is the obvious version and it makes every F3+G flash the
   * debug screen on and off on the way past.
   */
  let combo = false

  function onKeyUp(e) {
    if (e.code !== 'F3') return
    held.delete('F3')
    if (combo) { combo = false; return }
    if (inputLock && inputLock.locked) return
    toggle()
  }

  function toggle() {
    open = !open
    root.classList.toggle('hidden', !open)
    // The little always-on coordinate readout is this repo's own, and F3 is a
    // strict superset of it. Two coordinate displays at once is just clutter.
    document.getElementById('coords')?.classList.toggle('hidden', open)
    if (!open) { bordersOn = false; hitboxesOn = false; updateBorders(sample()); updateHitboxes() }
  }

  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('keyup', onKeyUp)
  // A tab-out never delivers keyup, so F3 would stay "held" and the next G
  // press would toggle borders out of nowhere.
  window.addEventListener('blur', () => { held.clear(); combo = false })

  /*
   * Repainting.
   *
   * On 'tick' (30Hz) rather than 'beforeRender': the numbers are read off a
   * 30Hz simulation, so painting at 60-144Hz writes the same text twice and
   * pays for layout twice. hud.js throttles its coordinate readout to 5Hz for
   * the same reason, and that is too slow here -- F3's whole job is to show you
   * a number moving.
   */
  noa.on('tick', () => {
    if (!open) return
    const s = sample()
    paint(leftCol, leftLines(s))
    paint(rightCol, rightLines(s))
    updateBorders(s)
    if (hitboxesOn) updateHitboxes()
  })

  return {
    get isOpen() { return open },
    get chunkBorders() { return bordersOn },
    get hitboxes() { return hitboxesOn },
    toggle,
    sample,
    /** The exact text on screen, for the test suite. */
    lines: () => ({ left: leftLines(sample()), right: rightLines(sample()) }),
    dispose() {
      if (innerTick) shell.onTick = innerTick
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
      root.remove()
    },
  }
}
