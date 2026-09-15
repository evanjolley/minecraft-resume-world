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
