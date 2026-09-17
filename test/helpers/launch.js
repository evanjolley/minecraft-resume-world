/*
 * The launch flags, in one place, because getting them wrong doesn't fail
 * loudly -- the page loads, noa constructs, and then WebGL context creation
 * returns null and you get a black canvas with a vague Babylon warning.
 *
 * Headless Chromium's default GL path has no rasteriser, so:
 *   --use-gl=angle + --use-angle=swiftshader  route WebGL to the CPU backend
 *   --enable-unsafe-swiftshader              Chrome 119+ refuses swiftshader
 *                                            for WebGL without it
 *
 * Rejected alternative: `headless: false` under Xvfb. It works and is faster,
 * but it needs a display server nobody on macOS has, and this suite has to run
 * on whatever laptop the next agent is holding.
 */
export const GL_FLAGS = process.env.NO_GL_FLAGS ? [] : [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  /*
   * --mute-audio, because the owner could hear the suite.
   *
   * The comment on helpers/audio.js says headless Chromium has no audio
   * device and therefore nothing can listen -- true of a plain headless run,
   * and NOT true of every way this suite gets launched. A headed run (which
   * agents reach for whenever pointer lock or a real user gesture matters)
   * has a very real audio device, and it is the machine the owner is playing
   * on. Thirty specs firing footsteps and block breaks out of a background
   * browser is the result.
   *
   * SAFE FOR THE SOUND SPECS, and that is why it is a flag rather than a
   * change to sounds.js: helpers/audio.js observes the graph being BUILT --
   * it patches AudioBufferSourceNode's start() and connect() and hashes the
   * decoded PCM -- so it never reads output level. Muting the device leaves
   * every one of those assertions looking at exactly what it looked at
   * before.
   *
   * Rejected: muting in sounds.js behind an automation check. That makes the
   * thing under test behave differently when tested, which is the one change
   * a sound suite must never make.
   */
  '--mute-audio',
]

/*
 * The escape hatch, for one specific question.
 *
 * Several physics measurements pass under swiftshader and fail under WebKit,
 * and the suspect is not the engine but the FRAME RATE: swiftshader renders
 * the spawn frame at ~2 fps where WebKit manages ~30, and a tick loop fed a
 * 500 ms dt behaves differently from one fed 33 ms. If that is the cause then
 * a GPU-backed Chrome fails them too, and "it passes in Chromium" has been a
 * statement about the rasteriser all along.
 *
 *   NO_GL_FLAGS=1 npm test -- --project=chromium test/30-water-entry.spec.js
 *
 * Off by default, and deliberately not a config `projects` entry: headless
 * Chromium without these flags has no rasteriser at all on a machine with no
 * display, so this is a local diagnostic, not a target anything can depend on.
 */
